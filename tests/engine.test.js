// Testes do motor de regras (rodam em Node: node tests/engine.test.js)
const assert = require("assert");
const E = require("../app.js");

let passed = 0;
function test(name, fn) {
    try { fn(); console.log("✅ " + name); passed++; }
    catch (e) { console.error("❌ " + name + "\n   " + e.message); process.exitCode = 1; }
}

function makeState(roles) {
    // roles: { id: ROLE_KEY }
    const players = {};
    for (const [id, role] of Object.entries(roles)) {
        players[id] = { name: id, role, alive: true, lastProtected: null, lastGifted: null, mutedToday: false, doubleVote: false };
    }
    return { players, night: 1, actions: {}, pendingPotion: null, log: [], privates: [], winner: null };
}

// ---------- Setup ----------
test("setup válido para 5-10 jogadores", () => {
    assert.strictEqual(E.computeSetup(4), null);
    assert.strictEqual(E.computeSetup(5).length, 5);
    assert.strictEqual(E.computeSetup(11), null);
    const s = E.computeSetup(8);
    assert.strictEqual(s.filter(r => r === "ALDEAO").length, 4);
});

test("distribuição dá um papel a cada jogador", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const map = E.assignRoles(ids);
    assert.strictEqual(Object.keys(map).length, 6);
    assert.ok(Object.values(map).includes("NECROMANTE"));
    assert.strictEqual(Object.values(map).filter(r => r === "ALDEAO").length, 2);
});

// ---------- Validação de ações ----------
test("Mago não pode proteger o mesmo alvo duas noites seguidas", () => {
    const st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    st.players.m.lastProtected = "v1";
    const bad = E.validateAction(st, "m", "mago_shield", "v1");
    assert.strictEqual(bad.ok, false);
    const ok = E.validateAction(st, "m", "mago_shield", "p");
    assert.strictEqual(ok.ok, true);
});

test("Bruxa não pode presentear o mesmo alvo duas noites seguidas", () => {
    const st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    st.players.w.lastGifted = "v1";
    assert.strictEqual(E.validateAction(st, "w", "bruxa_gift", "v1", "desmaio").ok, false);
    assert.strictEqual(E.validateAction(st, "w", "bruxa_gift", "m", "forca").ok, true);
});

test("Ressurreição: só 1x por partida, exige mortos e nenhum Zumbi ativo", () => {
    const st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    // sem mortos
    assert.strictEqual(E.validateAction(st, "n", "necro_revive", null).ok, false);
    // com morto
    st.players.v1.alive = false;
    assert.strictEqual(E.validateAction(st, "n", "necro_revive", null).ok, true);
    // já usada
    st.actions.necroReviveUsed = true;
    assert.strictEqual(E.validateAction(st, "n", "necro_revive", null).ok, false);
    // zumbi ativo bloqueia
    delete st.actions.necroReviveUsed;
    st.players.v1.role = "ZUMBI"; st.players.v1.alive = true;
    assert.strictEqual(E.validateAction(st, "n", "necro_revive", null).ok, false);
});

test("Aldeão não tem ação noturna", () => {
    const st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    assert.strictEqual(E.validateAction(st, "v1", "mago_shield", "m").ok, false);
});

// ---------- Resolução da noite ----------
test("Necromante mata; escudo no alvo impede a morte", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO", v2: "ALDEAO" });
    st.actions = { necroKill: { by: "n", targetId: "v1" }, magoShield: { by: "m", targetId: "v1" } };
    let after = E.resolveNight(st, E.mulberry32(1));
    assert.strictEqual(after.players.v1.alive, true, "escudo deveria salvar");
    assert.ok(after.log.some(l => l.type === "shield"));

    st.actions = { necroKill: { by: "n", targetId: "v2" }, magoShield: { by: "m", targetId: "v1" } };
    after = E.resolveNight(st, E.mulberry32(1));
    assert.strictEqual(after.players.v2.alive, false, "sem escudo deve morrer");
});

test("Zumbi mata o Mago ignorando o escudo", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", z: "ZUMBI", v1: "ALDEAO" });
    st.actions = { necroKill: { by: "n", targetId: "v1" }, zumbiSniff: { by: "z", targetId: "m" }, magoShield: { by: "m", targetId: "m" } };
    const after = E.resolveNight(st, E.mulberry32(2));
    assert.strictEqual(after.players.m.alive, false, "zumbi ignora escudo");
    assert.ok(after.log.some(l => l.cause === "zumbi"));
});

test("Zumbi que erra o farejo não mata ninguém", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", z: "ZUMBI", v1: "ALDEAO" });
    st.actions = { zumbiSniff: { by: "z", targetId: "v1" } };
    const after = E.resolveNight(st, E.mulberry32(3));
    assert.strictEqual(after.players.v1.alive, true);
});

test("Paladino recebe aura e Radar Sombrio", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", z: "ZUMBI", v1: "ALDEAO" });
    st.actions = { paladinoCheck: { by: "p", targetId: "n" }, zumbiSniff: { by: "z", targetId: "v1" } };
    const after = E.resolveNight(st, E.mulberry32(4));
    const privs = after.privates.filter(x => x.to === "p");
    assert.ok(privs.some(x => /CORROMPI/.test(x.text)));
    assert.ok(privs.some(x => x.text.includes("Radar Sombrio") && x.text.includes("v1")));
});

test("Ressurreição traz morto aleatório como Zumbi (anúncio público)", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO", v2: "ALDEAO" });
    st.players.v1.alive = false;
    st.actions = { necroRevive: { by: "n" }, necroReviveUsed: true };
    const after = E.resolveNight(st, E.mulberry32(5));
    assert.strictEqual(after.players.v1.alive, true);
    assert.strictEqual(after.players.v1.role, "ZUMBI");
    assert.ok(after.log.some(l => l.type === "resurrection"));
});

test("Bruxa registra poção pendente para o amanhecer", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    st.actions = { bruxaGift: { by: "w", targetId: "v1", potion: "desmaio" } };
    const after = E.resolveNight(st, E.mulberry32(6));
    assert.deepStrictEqual(after.pendingPotion, { targetId: "v1", potion: "desmaio" });
    assert.strictEqual(after.players.w.lastGifted, "v1");
});

// ---------- Amanhecer ----------
test("Beber desmaio muta; beber força dá voto duplo; descartar não faz nada", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    st.pendingPotion = { targetId: "v1", potion: "desmaio" };
    let after = E.resolveDawn(st, "drink");
    assert.strictEqual(after.players.v1.mutedToday, true);

    st.pendingPotion = { targetId: "v1", potion: "forca" };
    after = E.resolveDawn(st, "drink");
    assert.strictEqual(after.players.v1.doubleVote, true);

    st.pendingPotion = { targetId: "v1", potion: "forca" };
    after = E.resolveDawn(st, "discard");
    assert.strictEqual(after.players.v1.doubleVote, false);
    assert.strictEqual(after.pendingPotion, null);
});

// ---------- Votação ----------
test("Voto secreto: mais votado sobe à forca; empate nada faz", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO", v2: "ALDEAO" });
    let res = E.tallyVotes(st, { m: "v1", p: "v1", w: "skip", v1: "skip", v2: "skip" });
    assert.strictEqual(res.top, "v1");
    res = E.tallyVotes(st, { m: "v1", p: "v2" }); // empate 1x1 → ninguém sobe
    assert.strictEqual(res.top, null);
    assert.strictEqual(res.tie, true);
    res = E.tallyVotes(st, { m: "v1", p: "v1", w: "v2", v1: "v2", v2: "skip" }); // 2x2 também é empate
    assert.strictEqual(res.tie, true);
});

test("Poção da Força pesa 2; Desmaio anula o voto", () => {
    let st = makeState({ a: "ALDEAO", b: "ALDEAO", c: "ALDEAO", d: "NECROMANTE" });
    st.players.a.doubleVote = true;
    st.players.b.mutedToday = true;
    let res = E.tallyVotes(st, { a: "d", b: "d", c: "skip" });
    assert.strictEqual(res.counts.d, 2);
    st.players.a.doubleVote = false;
    res = E.tallyVotes(st, { a: "skip", b: "d", c: "skip" }); // mutado não vota
    assert.strictEqual(res.counts.d, undefined);
});

test("Enforcamento mata e anuncia com rima", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    const after = E.applyHanging(st, "n", E.mulberry32(7));
    assert.strictEqual(after.players.n.alive, false);
    assert.ok(after.log.some(l => l.type === "hang" && l.text.includes("n")));
});

// ---------- Vitória ----------
test("Vilões vencem quando alcançam os inocentes", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    st.players.m.alive = false; st.players.p.alive = false; st.players.v1.alive = false;
    // vivos: n(vilão)=1, inocentes=0 → vilões vencem
    assert.strictEqual(E.checkWinner(st), "viloes");
});

test("Aldeia vence ao eliminar todos os vilões", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO" });
    st.players.n.alive = false;
    // bruxa viva → neutra vence junto (regra: bruxa vence se sobreviver)
    assert.strictEqual(E.checkWinner(st), "bruxa");
    st.players.w.alive = false;
    assert.strictEqual(E.checkWinner(st), "aldeia");
});

test("Jogo continua enquanto houver vilão vivo e maioria aldeã", () => {
    let st = makeState({ n: "NECROMANTE", m: "MAGO", p: "PALADINO", w: "BRUXA", v1: "ALDEAO", v2: "ALDEAO" });
    assert.strictEqual(E.checkWinner(st), null);
});

// ---------- Zumbi: maldições ----------
test("Chat do Zumbi vira nonsense", () => {
    const g = E.zombieGibberish("eu sou o mago confiem em mim", E.mulberry32(8));
    assert.ok(g.length > 0);
    assert.ok(!g.toLowerCase().includes("confiem"), "texto original não pode vazar");
});

test("Cédula do Zumbi embaralha nomes e mantém valores reais ocultos", () => {
    const st = makeState({ n: "NECROMANTE", z: "ZUMBI", v1: "ALDEAO", v2: "ALDEAO" });
    const ballot = E.zombieBallot(st, "z", E.mulberry32(9));
    assert.strictEqual(ballot.length, 3); // n, v1, v2
    assert.ok(ballot.every(o => !["n", "v1", "v2"].includes(o.label)), "rótulos devem ser nonsense");
    assert.deepStrictEqual(ballot.map(o => o.value).sort(), ["n", "v1", "v2"]);
});

console.log(`\n${passed} testes passaram.`);
