// Testes da máquina de fases do Árbitro (rodam em Node: node tests/arbiter.test.js)
const assert = require("assert");
const E = require("../engine.js");
const A = require("../arbiter.js");

let passed = 0;
function test(name, fn) {
    try { fn(); console.log("✅ " + name); passed++; }
    catch (e) { console.error("❌ " + name + "\n   " + e.message); process.exitCode = 1; }
}

function makeState(roles, night = 1) {
    const players = {};
    for (const [id, role] of Object.entries(roles)) {
        players[id] = { name: id, role, alive: true, lastProtected: null, lastGifted: null, mutedToday: false, doubleVote: false };
    }
    return { players, night, stepIndex: 0, actions: {}, votes: {}, pendingPotion: null, log: [], privates: [], winner: null };
}

const FULL = {
    n: "NECROMANTE", z: "ZUMBI", p: "PALADINO", m: "MAGO", w: "BRUXA",
    a1: "ALDEAO", a2: "ALDEAO", a3: "ALDEAO",
};

// ---------- phaseBase ----------
test("phaseBase extrai o tipo da fase", () => {
    assert.strictEqual(A.phaseBase("night_3"), "night");
    assert.strictEqual(A.phaseBase("dawn_1"), "dawn");
    assert.strictEqual(A.phaseBase("finished"), "finished");
});

// ---------- Ordem da Noite ----------
test("ordem da noite segue o manual: NECRO→ZUMBI→PALADINO→MAGO→BRUXA", () => {
    const s = makeState(FULL);
    assert.deepStrictEqual(A.currentStepActors(s, 0), ["n"]);
    assert.deepStrictEqual(A.currentStepActors(s, 1), ["z"]);
    assert.deepStrictEqual(A.currentStepActors(s, 2), ["p"]);
    assert.deepStrictEqual(A.currentStepActors(s, 3), ["m"]);
    assert.deepStrictEqual(A.currentStepActors(s, 4), ["w"]);
});

test("passo sem ator ativo é pulado automaticamente (planAfterAction)", () => {
    // Sem Zumbi na partida: passo 1 não tem atores → stepDone true → avança.
    const s = makeState({ n: "NECROMANTE", p: "PALADINO", m: "MAGO", w: "BRUXA", a1: "ALDEAO" });
    assert.strictEqual(A.stepDone(s, 1), true, "zumbi ausente deve contar como feito");
});

test("Zumbi criado nesta noite ainda não age", () => {
    const s = makeState(FULL);
    s.players.z.zombieSince = s.night;
    assert.deepStrictEqual(A.currentStepActors(s, 1), []);
});

// ---------- Validação de pedidos ----------
test("validateNightRequest rejeita quem não é o ator do passo", () => {
    const room = { phase: "night_1" };
    const s = makeState(FULL);
    const bad = A.validateNightRequest(s, room, "a1", { kind: "necro_kill", targetId: "a2" });
    assert.strictEqual(bad.ok, false);
});

test("validateNightRequest aceita o ator correto no passo correto", () => {
    const room = { phase: "night_1" };
    const s = makeState(FULL);
    const ok = A.validateNightRequest(s, room, "n", { kind: "necro_kill", targetId: "a2" });
    assert.strictEqual(ok.ok, true);
});

test("applyNightAction registra intenção e planAfterAction avança o passo", () => {
    const s = makeState(FULL);
    const r = A.applyNightAction(s, "n", { kind: "necro_kill", targetId: "a2" });
    assert.strictEqual(r.rejected, null);
    assert.strictEqual(r.state.actions.necroKill.by, "n");
    const plan = A.planAfterAction(r.state);
    assert.strictEqual(plan.action, "advanceStep");
    assert.strictEqual(plan.stepIndex, 1);
});

test("applyNightAction rejeita ação inválida sem mutar estado", () => {
    const s = makeState(FULL);
    const before = JSON.stringify(s);
    const r = A.applyNightAction(s, "n", { kind: "necro_kill", targetId: "fantasma" });
    assert.notStrictEqual(r.rejected, null);
    assert.strictEqual(JSON.stringify(s), before);
});

// ---------- Fim da noite / amanhecer ----------
test("endNight sem poção pendente vai direto para o dia com deadline", () => {
    const s = makeState(FULL);
    s.actions = {}; // ninguém agiu
    const out = A.endNight(s, 1000);
    assert.match(out.phase, /^day_/);
    assert.strictEqual(out.dayDeadline, 1000 + A.DAY_MS);
});

test("endNight com presente da Bruxa abre o dilema do amanhecer", () => {
    const s = makeState(FULL);
    s.actions.bruxaGift = { by: "w", targetId: "a1", potion: "desmaio" };
    const out = A.endNight(s, 1000);
    assert.strictEqual(out.phase, "dawn_" + out.state.night);
    assert.strictEqual(out.dawnDeadline, 1000 + A.DAWN_MS);
});

test("resolveDawnPhase aplica a decisão e abre o dia", () => {
    const s = makeState(FULL);
    s.pendingPotion = { targetId: "a1", potion: "desmaio" };
    const out = A.resolveDawnPhase(s, "drink", 2000);
    assert.match(out.phase, /^day_/);
    assert.strictEqual(out.state.players.a1.mutedToday, true);
});

// ---------- Votação ----------
test("openVote limpa votos e define voteDeadline", () => {
    const s = makeState(FULL);
    s.votes = { stale: "x" };
    const out = A.openVote(s, 5000);
    assert.strictEqual(out.phase, "vote_" + s.night);
    assert.deepStrictEqual(out.state.votes, {});
    assert.strictEqual(out.voteDeadline, 5000 + A.VOTE_MS);
});

test("validateVote: vivo pode, morto não, mutado não, repetido não", () => {
    const s = makeState(FULL);
    assert.strictEqual(A.validateVote(s, "a1", "a2").ok, true);
    s.players.a2.alive = false;
    assert.strictEqual(A.validateVote(s, "a2", "a1").ok, false);
    s.players.a1.mutedToday = true;
    assert.strictEqual(A.validateVote(s, "a1", "a2").ok, false);
    s.players.a1.mutedToday = false;
    s.votes = { a1: "a2" };
    assert.strictEqual(A.validateVote(s, "a1", "skip").ok, false);
    assert.strictEqual(A.validateVote(s, "a1", "skip").dup, true);
});

test("closeVote apura com peso 2 e enforca o mais votado", () => {
    const s = makeState(FULL);
    s.players.a1.doubleVote = true;
    s.votes = { a1: "n", a2: "n", a3: "n", p: "a2", m: "a2", w: "skip", n: "a3", z: "skip" };
    const out = A.closeVote(s, 9000);
    assert.strictEqual(out.state.players.n.alive, false);
    assert.match(out.phase, /^hang_/);
    assert.strictEqual(out.hangDeadline, 9000 + A.HANG_MS);
});

test("startNextNight incrementa noite, limpa ações e mantém papéis", () => {
    const s = makeState(FULL);
    s.actions = { necroKill: { by: "n", targetId: "a2" } };
    const out = A.startNextNight(s);
    assert.strictEqual(out.phase, "night_2");
    assert.strictEqual(out.state.night, 2);
    assert.deepStrictEqual(out.state.actions, {});
    assert.strictEqual(out.state.players.w.role, "BRUXA");
});

test("startNextNight com vencedor termina o jogo", () => {
    const s = makeState(FULL);
    s.winner = "VILA";
    const out = A.startNextNight(s);
    assert.strictEqual(out.phase, "finished");
});

// ---------- Revelação final ----------
test("buildReveal expõe todos os papéis somente no fim", () => {
    const s = makeState(FULL);
    s.players.a2.alive = false;
    const r = A.buildReveal(s);
    assert.strictEqual(r.n.role, "NECROMANTE");
    assert.strictEqual(r.z.role, "ZUMBI");
    assert.strictEqual(r.a2.alive, false);
});


// ---------- foldOutboxIntoPrivates / clearQueues ----------
test("foldOutboxIntoPrivates move envelopes para privates e limpa outbox", () => {
    const s = makeState(FULL);
    s.outbox = { p: [{ type: "aura", text: "PU✨RA" }], m: [{ type: "gift", text: "frasco" }] };
    const folded = A.foldOutboxIntoPrivates(s);
    assert.deepStrictEqual(folded.outbox, {});
    assert.strictEqual(folded.privates.p.length, 1);
    assert.ok(folded.privates.m[0].at > 0);
    assert.notStrictEqual(folded, s, "não muta o estado original");
});

test("clearQueues retorna nulls para apagar as filas", () => {
    const q = A.clearQueues();
    assert.strictEqual(q.actionRequests, null);
    assert.strictEqual(q.potionRequests, null);
    assert.strictEqual(q.voteRequests, null);
});

console.log(`\n${passed} testes do árbitro passaram.`);
