"use strict";

// ============================================================================
// ⚙️ MOTOR DE REGRAS — "If I Sleep..." (puro, sem Firebase/DOM)
// Roda no navegador (UI + host da sala) e nas Cloud Functions (arbitro).
// Compartilhado via require('./engine.js') no Node e import './engine.js' no browser.
// ============================================================================

const ROLES = {
    ALDEAO:     { key: "Aldeão",      faction: "aldeia",   aura: "pura" },
    MAGO:       { key: "Mago",        faction: "aldeia",   aura: "pura" },
    PALADINO:   { key: "Paladino",    faction: "aldeia",   aura: "pura" },
    BRUXA:      { key: "Bruxa",       faction: "neutra",   aura: "pura" },
    NECROMANTE: { key: "Necromante",  faction: "vilao",    aura: "corrompida" },
    ZUMBI:      { key: "Zumbi",       faction: "vilao",    aura: "corrompida" },
};

// Ordem da noite conforme o manual: Necromante > Zumbi > Paladino > Mago > Bruxa.
const NIGHT_ORDER = ["NECRO", "ZUMBI", "PALADINO", "MAGO", "BRUXA"];

function shuffleArray(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// RNG determinística (testes e sorteios reproduzíveis)
function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// ----------------------------------------------------------------------------
// Bardo: banco de rimas com variáveis ${nome}
// ----------------------------------------------------------------------------
const BARDO = {
    nightStart: [
        "O sol se esconde, a fogueira crepita. A noite é escura e a morte não hesita.",
        "As sombras avançam, a taverna silencia. Quem verá a luz do próximo dia?",
        "Fechem as portas, apaguem a luz. Aquele que dorme, o destino conduz.",
        "A lua cobre o rosto, o corvo grasna no telhado. Durmam bem, aldeões... se forem abençoados.",
    ],
    deathMurder: [
        "${nome} fechou os olhos pra dormir, mas o sono eterno veio descobrir.",
        "Um grito na noite, depois silêncio e dor. ${nome} não verá o raiar do sol.",
        "A capa negra passou pela janela de ${nome}. O que ficou para trás não tem mais nome.",
    ],
    deathZombie: [
        "Dentes e garras onde havia um lar. ${nome} caiu sob o peso de quem não devia andar.",
        "O cheiro podre encontrou ${nome} no escuro. O que o Necromante ergueu, não conhece muro.",
    ],
    deathHang: [
        "A corda rangeu, a vila assistiu. ${nome} pagou pelo que fez — ou pelo que fingiu.",
        "Na praça central, o corpo balança ao vento. ${nome} foi julgado; este foi o julgamento.",
        "A forca não erra quando a vila assim quer. ${nome} subiu ao palco e não desceu outra vez.",
    ],
    shieldSaved: [
        "${nome} deveria estar morto, mas algo brilhou. Um escudo arcano a morte travou.",
        "A lâmina sombria encontrou vidro azul. ${nome} vive — protegido por força virtual.",
    ],
    resurrection: [
        "O cemitério gemeu, a terra se abriu. ${nome} voltou — mas o que havia em si fugiu.",
        "O Necromante chamou, e a voz foi atendida. ${nome} levantou... com outra vida.",
    ],
    noDeaths: [
        "A noite passou quieta, sem luto nem pranto. Hoje a vila acorda — ao menos por enquanto.",
        "Ninguém morreu dormindo, que alívio estranho! Mas o Bardo desconfia: ainda há sangue no banho.",
    ],
    potionArrived: [
        "Um frasco na soleira, sem dono e sem sinal. ${nome} acorda cedo com um dom criminal.",
    ],
    voteTie: [
        "Os dedos se apontaram em número igual. A forca hoje repousa — ninguém vai pro final.",
    ],
    winVillage: [
        "A fogueira arde alta, o corvo emudeceu. A ameaça caiu — e a vila renasceu.",
    ],
    winNecro: [
        "Contem os vivos, contem os mortos: a conta chegou. O Necromante sorri — a vila sucumbiu.",
        "Não há mais inocentes pra puxar a alavanca. A noite venceu, e a escuridão avança.",
    ],
    winWitch: [
        "Enquanto heróis e vilões caíam no lamaçal, a Bruxa escapou — e esse era o seu final.",
        "A neutralidade paga: quem viu o jogo inteiro? A Bruxa segue viva, sumida no horizonte incerto.",
    ],
    zombieGibberish: [
        "Grrr arg blub", "Nharg grok sss", "Ughh rrr arghh", "Blorg gruu nh", "Kzzt garg rhoo",
        "Mnngh zrr glhu", "Argh fssst nuu", "Grokk nhar rr", "Zzzarg mhru gl", "Urgh blrr ssnh",
    ],
    zombieNames: [
        "Rlhw nag", "Vom zgur", "Qixu brat", "Nho gral", "Zwib narf", "Ulg remn",
        "Thra guun", "Skiv nol", "Morv azik", "Nurl beth", "Grak xuun", "Zeph irna",
    ],

    // Sorteia uma rima e substitui variáveis ${nome} etc.
    say(bank, vars = {}, rng = Math.random) {
        const pool = this[bank];
        if (!pool || !pool.length) return "";
        let line = pool[Math.floor(rng() * pool.length)];
        for (const [k, v] of Object.entries(vars)) {
            line = line.replaceAll("${" + k + "}", v);
        }
        return line;
    },
};

// Textos das habilidades exibidos no botão "Lembrar minha Habilidade"
const HELP_TEXT = {
    "Aldeão": "🧑‍🌾 Você não tem habilidade noturna. Sua arma é a dedução, o debate e o voto na forca.",
    "Mago": "🧙‍♂️ À noite, escolha alguém para receber o Escudo Mágico: ele ignora a morte causada pelo Necromante. Não pode proteger a mesma pessoa duas noites seguidas. O escudo NÃO funciona contra o Zumbi.",
    "Paladino": "🛡️ À noite, investigue alguém: o Bardo dirá se a aura é Pura (Aldeão, Mago, Bruxa) ou Corrompida (Necromante, Zumbi). Se houver um Zumbi na partida, você também recebe um aviso secreto de quem ele farejou.",
    "Bruxa": "🧪 À noite, envie um Presente Misterioso (poção do Desmaio ou da Força) para alguém. Ao amanhecer, o alvo escolhe beber ou descartar sem saber o conteúdo. Você não pode enviar para o mesmo jogador duas noites seguidas. Vença apenas se sobreviver até o fim!",
    "Necromante": "💀 À noite, mate alguém — ou, uma única vez na partida, invoque a Ressurreição: um morto aleatório volta como o Zumbi (e todos ficam sabendo). Vença quando os vilões vivos alcançarem os inocentes vivos.",
    "Zumbi": "🧟 À noite, fareje: acerte o Mago e ele morre ignorando qualquer escudo; erre e o ataque falha. De dia, suas palavras saem embaralhadas e seus botões de voto viram nonsense embaralhado. Você vence com o Necromante.",
};

const MANUAL_HTML = `
<b>Ciclo:</b> Noite (ações secretas) → Amanhecer (dilema da poção) → Dia (debate + votação secreta na forca).<br><br>
<b>Facções:</b> A <b>Aldeia</b> vence eliminando Necromante e Zumbi. O <b>Necromante</b> vence quando vilões vivos ≥ inocentes vivos. A <b>Bruxa</b> (neutra) vence se chegar viva ao fim.<br><br>
<b>Papéis:</b> 🧙‍♂️ Mago (escudo noturno, inútil contra Zumbi) · 🛡️ Paladino (investiga auras + radar do Zumbi) · 💀 Necromante (mata ou ressuscita alguém como Zumbi, 1x por partida) · 🧟 Zumbi (fareja o Mago; fala e vota embaralhado) · 🧪 Bruxa (poções do Desmaio/Força) · 🧑‍🌾 Aldeões (só dedução e voto).<br><br>
<b>Poções:</b> Desmaio = mutado e sem voto naquele dia. Força = voto duplo naquele dia. O alvo pode descartar o frasco.<br><br>
<b>Votação:</b> totalmente secreta; o resultado só sai após a contagem. Empate = ninguém sobe à forca.
`;

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

// Lista de role-keys válida para N jogadores, ou null.
function computeSetup(n) {
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) return null;
    const base = ["NECROMANTE", "MAGO", "PALADINO", "BRUXA"];
    const villagers = n - base.length;
    return [...base, ...Array(villagers).fill("ALDEAO")];
}

// Distribui papéis: mapa id -> roleKey usando RNG injetável
function assignRoles(playerIds, rng = Math.random) {
    const roles = computeSetup(playerIds.length);
    if (!roles) return null;
    const shuffled = shuffleArray(playerIds, rng);
    const map = {};
    shuffled.forEach((id, i) => { map[id] = roles[i]; });
    return map;
}

// ----------------------------------------------------------------------------
// Estado da partida
// state = {
//   players: { id: { name, alive, role, lastProtected, lastGifted, mutedToday, doubleVote, zombieSince } },
//   night, stepIndex, actions, pendingPotion, log[], outbox{uid:[msg]}, votes{}, winner
// }
// ----------------------------------------------------------------------------

function newState(players, night = 1) {
    const p = {};
    for (const [id, pl] of Object.entries(players)) {
        p[id] = {
            name: pl.name, role: pl.role, alive: true,
            lastProtected: null, lastGifted: null,
            mutedToday: false, doubleVote: false,
        };
    }
    return { players: p, night, actions: {}, log: [], outbox: {}, votes: {}, winner: null };
}

function aliveIds(state) {
    return Object.keys(state.players).filter(id => state.players[id].alive);
}
function deadIds(state) {
    return Object.keys(state.players).filter(id => !state.players[id].alive);
}
function hasRole(state, role) {
    return Object.values(state.players).some(p => p.role === role);
}
function idByRole(state, role) {
    return Object.keys(state.players).find(id => state.players[id].role === role) || null;
}

// Valida se uma ação noturna é permitida neste momento.
// kind ∈ necro_kill | necro_revive | zumbi_sniff | paladino_check | mago_shield | bruxa_gift
function validateAction(state, actorId, kind, targetId, extra) {
    const actor = state.players[actorId];
    if (!actor || !actor.alive) return bad("Você não está vivo.");
    const target = targetId ? state.players[targetId] : null;
    switch (kind) {
        case "necro_kill":
            if (actor.role !== "NECROMANTE") return bad("Papel errado.");
            if (!target || !target.alive) return bad("Alvo inexistente.");
            return good({ targetId });
        case "necro_revive":
            if (actor.role !== "NECROMANTE") return bad("Papel errado.");
            if (state.actions.necroReviveUsed) return bad("A Ressurreição já foi usada nesta partida.");
            if (hasRole(state, "ZUMBI")) return bad("Já existe um Zumbi ativo.");
            if (deadIds(state).length === 0) return bad("Não há mortos para ressuscitar.");
            return good({});
        case "zumbi_sniff":
            if (actor.role !== "ZUMBI") return bad("Papel errado.");
            if (!target || !target.alive) return bad("Alvo inexistente.");
            return good({ targetId });
        case "paladino_check":
            if (actor.role !== "PALADINO") return bad("Papel errado.");
            if (!target || !target.alive) return bad("Alvo inexistente.");
            return good({ targetId });
        case "mago_shield":
            if (actor.role !== "MAGO") return bad("Papel errado.");
            if (!target || !target.alive) return bad("Alvo inexistente.");
            if (actor.lastProtected === targetId)
                return bad("Você não pode proteger o mesmo jogador em duas noites consecutivas.");
            return good({ targetId });
        case "bruxa_gift":
            if (actor.role !== "BRUXA") return bad("Papel errado.");
            if (!target || !target.alive) return bad("Alvo inexistente.");
            if (actor.lastGifted === targetId)
                return bad("A Bruxa não pode presentear o mesmo jogador duas noites seguidas.");
            if (extra !== "desmaio" && extra !== "forca")
                return bad("Escolha uma poção: desmaio ou forca.");
            return good({ targetId, potion: extra });
        default:
            return bad("Ação desconhecida.");
    }
}
const good = d => ({ ok: true, ...d });
const bad = r => ({ ok: false, reason: r });

// Registra a intenção de um papel no estado (mutação).
function recordAction(state, actorId, kind, result) {
    const byKind = {
        necro_kill: "necroKill", necro_revive: "necroRevive",
        zumbi_sniff: "zumbiSniff", paladino_check: "paladinoCheck",
        mago_shield: "magoShield", bruxa_gift: "bruxaGift",
    };
    state.actions[byKind[kind]] = { by: actorId, ...result };
    if (kind === "necro_revive") state.actions.necroReviveUsed = true;
    return state;
}

// Executa toda a noite conforme a ORDEM DO MANUAL. Recebe as intenções coletadas
// em state.actions e retorna novo estado. Mensagens privadas vão para s.outbox
// (mapa uid -> [mensagens]); o árbitro as entrega por envelope e depois limpa.
function resolveNight(state, rng = Math.random) {
    const s = JSON.parse(JSON.stringify(state));
    const acts = s.actions;
    const deaths = [];       // [{id, cause}] causas: necro | zumbi
    const saveds = [];       // ids salvos pelo escudo
    s.log = []; s.outbox = {};
    // Lista de entrega (legado): cada pushPrivate também entra aqui como
    // { to, ...msg } para consumidores antigos (app.js host clássico).
    s.privates = [];

    const necroTargetId = acts.necroKill ? acts.necroKill.targetId : null;
    const shieldTargetId = acts.magoShield ? acts.magoShield.targetId : null;
    const reviveUsed = !!acts.necroRevive;

    // --- Passo 1: Necromante ---
    let resurrectedId = null;
    if (reviveUsed) {
        const dead = deadIds(s);
        if (dead.length > 0) {
            resurrectedId = dead[Math.floor(rng() * dead.length)];
            const z = s.players[resurrectedId];
            z.alive = true;
            z.role = "ZUMBI";
            z.zombieSince = s.night;
            s.log.push({ type: "resurrection", id: resurrectedId,
                text: BARDO.say("resurrection", { nome: z.name }, rng) });
        }
    } else if (necroTargetId && s.players[necroTargetId] && s.players[necroTargetId].alive) {
        if (necroTargetId === shieldTargetId) {
            saveds.push(necroTargetId);
            s.log.push({ type: "shield", id: necroTargetId,
                text: BARDO.say("shieldSaved", { nome: s.players[necroTargetId].name }, rng) });
        } else {
            deaths.push({ id: necroTargetId, cause: "necro" });
        }
    }

    // --- Passo 2: Zumbi fareja o Mago ---
    const zumbiId = idByRole(s, "ZUMBI");
    let zumbiSniffed = null;
    if (zumbiId && s.players[zumbiId].alive && acts.zumbiSniff && s.players[zumbiId].zombieSince !== s.night) {
        zumbiSniffed = acts.zumbiSniff.targetId;
        const t = s.players[zumbiSniffed];
        if (t && t.alive && !deaths.some(d => d.id === zumbiSniffed)) {
            if (t.role === "MAGO") deaths.push({ id: zumbiSniffed, cause: "zumbi" }); // ignora escudo
        }
    }

    // --- Passo 3: Paladino investiga (+ Radar Sombrio) ---
    const palId = idByRole(s, "PALADINO");
    if (palId && s.players[palId].alive && acts.paladinoCheck) {
        const t = s.players[acts.paladinoCheck.targetId];
        if (t) {
            const aura = ROLES[t.role] ? ROLES[t.role].aura : "pura";
            pushPrivate(s, palId, { type: "aura",
                text: `🔍 A aura de ${t.name} é ${aura === "pura" ? "PU✨RA" : "CORROMPI💀DA"}.` });
        }
        if (zumbiSniffed && s.players[zumbiSniffed]) {
            pushPrivate(s, palId, { type: "radar",
                text: `👃 Radar Sombrio: o Zumbi farejou ${s.players[zumbiSniffed].name} esta noite.` });
        }
    }

    // --- Passo 4: Mago registra escudo (efeito aplicado no passo 1) ---
    const magoId = idByRole(s, "MAGO");
    if (magoId && s.players[magoId].alive && shieldTargetId) {
        s.players[magoId].lastProtected = shieldTargetId;
    }

    // --- Passo 5: Bruxa envia presente (dilema resolve ao amanhecer) ---
    if (acts.bruxaGift) {
        const bId = acts.bruxaGift.by;
        s.players[bId].lastGifted = acts.bruxaGift.targetId;
        // Segredo do receptor: entregue apenas ao alvo (e à Bruxa, como lembrete).
        s.pendingPotion = { targetId: acts.bruxaGift.targetId, potion: acts.bruxaGift.potion };
        pushPrivate(s, acts.bruxaGift.targetId, { type: "gift",
            text: `🧪 Você encontrou um frasco misterioso em casa. Ao amanhecer, decida: beber ou descartar?` });
        pushPrivate(s, bId, { type: "giftSent",
            text: `🧪 Você enviou a Poção ${acts.bruxaGift.potion === "desmaio" ? "do Desmaio 😵" : "da Força 💪"} para ${s.players[acts.bruxaGift.targetId]?.name}.` });
    } else {
        s.pendingPotion = null;
    }

    // ---- Aplica mortes ----
    for (const d of deaths) {
        const v = s.players[d.id];
        if (!v || !v.alive) continue;
        v.alive = false;
        const bank = d.cause === "zumbi" ? "deathZombie" : "deathMurder";
        s.log.push({ type: "death", id: d.id, cause: d.cause,
            text: BARDO.say(bank, { nome: v.name }, rng) });
    }
    if (deaths.length === 0 && !reviveUsed && saveds.length === 0) {
        s.log.push({ type: "peace", text: BARDO.say("noDeaths", {}, rng) });
    }

    // Reset de efeitos diurnos de noites anteriores
    for (const p of Object.values(s.players)) { p.mutedToday = false; p.doubleVote = false; }

    s.actions = {};
    s.winner = checkWinner(s);
    return s;
}

// Helpers de mensagens privadas (outbox por destinatário, entregue pelo árbitro
// via envelope em /rooms/{code}/inbox/{uid} e limado do estado a cada entrega).
function pushPrivate(state, to, msg) {
    if (!state.outbox) state.outbox = {};
    (state.outbox[to] = state.outbox[to] || []).push(msg);
    // Cópia para a fila de entrega legado ({ to, ...msg }) — usada pelo host
    // clássico do navegador; o árbitro das Functions usa apenas o outbox.
    if (Array.isArray(state.privates)) state.privates.push({ to, ...msg });
}
function drainOutbox(state) {
    // Retorna o outbox e limpa o estado (uso: árbitro entrega e segue adiante).
    const box = state.outbox || {};
    state.outbox = {};
    return box;
}

// Dilema do amanhecer: aplica a decisão do alvo sobre a poção.
function resolveDawn(state, decision /* 'drink' | 'discard' | null */, rng = Math.random) {
    const s = JSON.parse(JSON.stringify(state));
    const pend = s.pendingPotion;
    if (pend) {
        const t = s.players[pend.targetId];
        if (t && t.alive) {
            if (decision === "drink") {
                if (pend.potion === "desmaio") {
                    t.mutedToday = true;
                    s.log.push({ type: "system", text: `${t.name} bebeu o frasco misterioso ao amanhecer.` });
                } else {
                    t.doubleVote = true;
                    s.log.push({ type: "system", text: `${t.name} bebeu o frasco misterioso ao amanhecer.` });
                }
            } else if (decision === "discard") {
                s.log.push({ type: "system", text: `${t.name} desconfiou do frasco e o jogou na lareira.` });
            } else {
                s.log.push({ type: "system", text: `O tempo passou e ${t.name} deixou o frasco intocado.` });
            }
        }
        s.pendingPotion = null;
    }
    return s;
}

// ---- Votação ----
// tallyVotes: votos { voterId: targetId|"skip" }, peso 2 para doubleVote.
function tallyVotes(state, votes) {
    const counts = {};
    for (const [voterId, targetId] of Object.entries(votes)) {
        const voter = state.players[voterId];
        if (!voter || !voter.alive) continue;
        if (voter.mutedToday) continue;              // mutada não vota
        if (!targetId || targetId === "skip") continue;
        const target = state.players[targetId];
        if (!target || !target.alive) continue;
        const weight = voter.doubleVote ? 2 : 1;
        counts[targetId] = (counts[targetId] || 0) + weight;
    }
    let top = null, max = 0;
    const tiedIds = [];
    for (const [id, c] of Object.entries(counts)) {
        if (c > max) { max = c; top = id; tiedIds.length = 0; tiedIds.push(id); }
        else if (c === max) { tiedIds.push(id); }
    }
    const tie = tiedIds.length > 1;
    return { counts, top: tie ? null : top, tie, total: max };
}

// Executa o enforcamento — retorna novo estado + texto.
function applyHanging(state, hangedId, rng = Math.random) {
    const s = JSON.parse(JSON.stringify(state));
    if (hangedId && s.players[hangedId] && s.players[hangedId].alive) {
        s.players[hangedId].alive = false;
        s.log.push({ type: "hang", id: hangedId,
            text: BARDO.say("deathHang", { nome: s.players[hangedId].name }, rng) });
    } else {
        s.log.push({ type: "tie", text: BARDO.say("voteTie", {}, rng) });
    }
    s.winner = checkWinner(s);
    return s;
}

// ---- Condições de vitória ----
// Regra oficial (empate Bruxa × Aldeia resolvido):
//   1. Vilões vencem imediatamente quando vilões vivos ≥ inocentes vivos.
//   2. Sem vilões vivos: a Bruxa vence APENAS se estiver viva (vitória neutra);
//      caso contrário a Aldeia vence.
function checkWinner(state) {
    const alive = aliveIds(state);
    const villains = alive.filter(id => ROLES[state.players[id].role]?.faction === "vilao");
    const innocents = alive.filter(id => ROLES[state.players[id].role]?.faction === "aldeia");
    const witchAlive = alive.some(id => state.players[id].role === "BRUXA");

    if (villains.length > 0 && villains.length >= innocents.length) return "viloes";
    if (villains.length === 0) return witchAlive ? "bruxa" : "aldeia";
    return null;
}

// Maldição do chat do Zumbi: texto vira sons incompreensíveis
function zombieGibberish(text, rng = Math.random) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const n = Math.max(2, Math.min(6, words.length));
    const out = [];
    for (let i = 0; i < n; i++) out.push(BARDO.zombieGibberish[Math.floor(rng() * BARDO.zombieGibberish.length)]);
    return out.join(" ");
}

// Cédula do Zumbi: nomes reais substituídos por nonsense embaralhado
function zombieBallot(state, myId, rng = Math.random) {
    const targets = aliveIds(state).filter(id => id !== myId);
    const names = shuffleArray(BARDO.zombieNames, rng);
    const order = shuffleArray(targets, rng);
    return order.map((id, i) => ({ label: names[i % names.length], value: id }));
}

// ---------------- Exportações (Node + browser) ----------------
const ENGINE = {
    ROLES, NIGHT_ORDER, BARDO, HELP_TEXT, MANUAL_HTML,
    shuffleArray, mulberry32, computeSetup, assignRoles, newState,
    validateAction, recordAction, resolveNight, resolveDawn,
    tallyVotes, applyHanging, checkWinner, zombieGibberish, zombieBallot,
    aliveIds, deadIds, hasRole, idByRole, pushPrivate, drainOutbox,
    MIN_PLAYERS, MAX_PLAYERS,
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = ENGINE;
}
if (typeof globalThis !== "undefined") {
    globalThis.IIS_ENGINE = ENGINE;
}
