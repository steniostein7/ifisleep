"use strict";

// ============================================================================
// ⚖️ ÁRBITRO — lógica de fases/validação SEM dependência de Firebase/DOM.
// O mesmo código roda:
//   • no NAVEGADOR  → host da sala (app.js) aplica via RTDB direto
//   • na CLOUD FUNCTION → arbitrate/index.js (admin RTDB) — modo "árbitro"
// Cada função recebe dados "crus" e devolve os dados já transformados; quem
// chama é responsável por persistir.
// ============================================================================

const E = (typeof require !== "undefined" && typeof window === "undefined")
    ? require("./engine.js")
    : globalThis.IIS_ENGINE;

const NIGHT_STEP_MS = 60000;   // timeout por passo da noite
const DAWN_MS   = 25000;       // dilema da poção
const DAY_MS    = 180000;      // debate na praça
const VOTE_MS   = 60000;       // julgamento secreto
const HANG_MS   = 15000;       // exibição do veredito

function phaseBase(phase) { return String(phase || "").replace(/_\d+$/, ""); }

// Quem deve agir no passo atual da noite (lista de uids).
function currentStepActors(state, stepIndex) {
    const kind = E.NIGHT_ORDER[stepIndex];
    const roleId = { NECRO: "NECROMANTE", ZUMBI: "ZUMBI", PALADINO: "PALADINO", MAGO: "MAGO", BRUXA: "BRUXA" }[kind];
    const id = E.idByRole(state, roleId);
    if (!id || !state.players[id].alive) return [];
    // Zumbi criado nesta noite ainda não age.
    if (roleId === "ZUMBI" && state.players[id].zombieSince === state.night) return [];
    return [id];
}

function stepDone(state, stepIndex) {
    const actors = currentStepActors(state, stepIndex);
    const kind = E.NIGHT_ORDER[stepIndex];
    const actKey = {
        NECRO: ["necroKill", "necroRevive"], ZUMBI: ["zumbiSniff"],
        PALADINO: ["paladinoCheck"], MAGO: ["magoShield"], BRUXA: ["bruxaGift"],
    }[kind];
    return actors.every(a => actKey.some(k => state.actions[k] && state.actions[k].by === a));
}

// Valida um pedido de ação noturna vindo de um cliente autenticado.
// Retorna { ok } ou { ok:false, reason }. NÃO muta nada.
function validateNightRequest(state, room, uid, req) {
    if (!state) return { ok: false, reason: "Partida não iniciada." };
    if (phaseBase(room.phase) !== "night") return { ok: false, reason: "Não é noite." };
    const step = state.stepIndex ?? 0;
    if (step >= E.NIGHT_ORDER.length) return { ok: false, reason: "A noite já terminou." };
    const actors = currentStepActors(state, step);
    if (!actors.includes(uid)) return { ok: false, reason: "Não é a sua vez de agir." };
    const c = E.validateAction(state, uid, req.kind, req.targetId, req.extra);
    if (!c.ok) return { ok: false, reason: c.reason };
    return { ok: true };
}

// Aplica uma ação noturna validada ao estado (retorna novo estado).
function applyNightAction(state, uid, req) {
    const s = JSON.parse(JSON.stringify(state));
    const check = E.validateAction(s, uid, req.kind, req.targetId, req.extra);
    if (!check.ok) return { state: s, rejected: check.reason };
    const key = {
        necro_kill: "necroKill", necro_revive: "necroRevive", zumbi_sniff: "zumbiSniff",
        paladino_check: "paladinoCheck", mago_shield: "magoShield", bruxa_gift: "bruxaGift",
    }[req.kind];
    s.actions[key] = { by: uid, targetId: req.targetId || null, potion: req.extra || null };
    if (req.kind === "necro_revive") s.actions.necroReviveUsed = true;
    return { state: s, rejected: null };
}

// Decide o próximo passo após registrar ações. Descritor puro:
//  { action:"advanceStep", stepIndex } | { action:"endNight" } | { action:"wait" }
function planAfterAction(state) {
    const step = state.stepIndex ?? 0;
    if (stepDone(state, step)) {
        if (step + 1 < E.NIGHT_ORDER.length) {
            return { action: "advanceStep", stepIndex: step + 1 };
        }
        return { action: "endNight" };
    }
    return { action: "wait" };
}

// Resolução do fim da noite → estado + fase seguinte + deadlines.
function endNight(state, now) {
    const resolved = E.resolveNight(state);
    resolved.stepIndex = 0;
    resolved.votes = {};
    let nextPhase;
    if (resolved.winner) nextPhase = "finished";
    else if (resolved.pendingPotion) nextPhase = "dawn_" + resolved.night;
    else nextPhase = "day_" + resolved.night;
    return {
        state: resolved,
        phase: nextPhase,
        dayDeadline: nextPhase.startsWith("day_") ? now + DAY_MS : null,
        dawnDeadline: nextPhase.startsWith("dawn_") ? now + DAWN_MS : null,
    };
}

// Abre a votação secreta.
function openVote(state, now) {
    const s = JSON.parse(JSON.stringify(state));
    s.votes = {};
    return { state: s, phase: "vote_" + s.night, voteDeadline: now + VOTE_MS, dayDeadline: null };
}

// Fecha a votação: apura, enforca, calcula próxima fase.
function closeVote(state, now) {
    const votes = state.votes || {};
    const res = E.tallyVotes(state, votes);
    const after = E.applyHanging(state, res.top);
    after.votes = {};
    return {
        state: after,
        tally: res.counts,
        phase: "hang_" + state.night,
        hangDeadline: now + HANG_MS,
        voteDeadline: null,
        winner: after.winner,
    };
}

// Próxima noite (após o veredito), se ninguém venceu.
function startNextNight(state) {
    if (state.winner) return { phase: "finished", state };
    const next = JSON.parse(JSON.stringify(state));
    next.night = state.night + 1;
    next.stepIndex = 0;
    next.actions = {};
    next.pendingPotion = null;
    next.log = [];
    next.outbox = {};
    return {
        state: next,
        phase: "night_" + next.night,
        hangDeadline: null, dayDeadline: null, voteDeadline: null,
    };
}

// Amanhecer: aplica decisão da poção (ou timeout) e segue para o dia.
function resolveDawnPhase(state, decision, now) {
    const resolved = E.resolveDawn(state, decision);
    return {
        state: resolved,
        phase: "day_" + resolved.night,
        dayDeadline: now + DAY_MS,
        dawnDeadline: null,
    };
}

// Valida voto: vivo, não mutado, única vez, alvo válido.
function validateVote(state, uid, value) {
    const voter = state.players[uid];
    if (!voter || !voter.alive) return { ok: false };
    if (voter.mutedToday) return { ok: false };
    if (state.votes && state.votes[uid] !== undefined) return { ok: false, dup: true };
    if (value !== "skip" && (!state.players[value] || !state.players[value].alive)) return { ok: false };
    return { ok: true };
}

// Revelação final (fim de jogo): só o árbitro conhece os papéis até aqui.
function buildReveal(state) {
    const reveal = {};
    for (const [id, p] of Object.entries(state.players)) reveal[id] = { role: p.role, alive: p.alive };
    return reveal;
}

// Entrega os envelopes privados do outbox para dentro de state.privates
// (a UI só exibe a lista do próprio uid). Usado tanto pelo host clássico
// quanto pelas Cloud Functions ao registrar ações/resultados.
function foldOutboxIntoPrivates(state) {
    const s = JSON.parse(JSON.stringify(state));
    const privates = s.privates || {};
    for (const [uid, msgs] of Object.entries(s.outbox || {})) {
        if (!msgs || !msgs.length) continue;
        privates[uid] = (privates[uid] || []).concat(msgs.map(m => ({ ...m, at: Date.now() })));
    }
    s.privates = privates;
    s.outbox = {};
    return s;
}

// Remove pendências de fila ao trocar de fase (higiene da sala).
function clearQueues() {
    return { actionRequests: null, potionRequests: null, voteRequests: null };
}

// ---------------- Exportações (Node + browser) ----------------
const ARBITER = {
    NIGHT_STEP_MS, DAWN_MS, DAY_MS, VOTE_MS, HANG_MS,
    phaseBase, currentStepActors, stepDone, validateNightRequest,
    applyNightAction, planAfterAction, endNight, openVote, closeVote,
    startNextNight, resolveDawnPhase, validateVote, buildReveal,
    foldOutboxIntoPrivates, clearQueues,
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = ARBITER;
}
if (typeof globalThis !== "undefined") {
    globalThis.IIS_ARBITER = ARBITER;
}
