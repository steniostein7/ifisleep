"use strict";

// ============================================================================
// ⚠️ O MOTOR DE REGRAS PURO VIVE EM engine.js (+ máquina de fases em arbiter.js).
// Este arquivo é apenas a CAMADA FIREBASE + UI. Os testes unitários carregam
// engine.js diretamente:  node tests/engine.test.js
// ============================================================================

// ============================================================================
// Camada Firebase + UI (só roda no navegador)
// ============================================================================
if (typeof document !== "undefined" && typeof window !== "undefined") {

// O motor puro é carregado como módulo ES; os exports globais do script
// (ROLES, BARDO, funções...) são criados aqui para a UI usar.
import("./engine.js").then(() => {
    Object.assign(globalThis, globalThis.IIS_ENGINE);
    return import("./arbiter.js");
}).then(() => {
    Object.assign(globalThis, globalThis.IIS_ARBITER);
    main();
}).catch(err => {
    console.error("Falha ao carregar engine/arbiter:", err);
});

} else if (typeof module !== "undefined" && module.exports) {
    // Node: reexporta o engine para compatibilidade com testes legados.
    module.exports = require("./engine.js");
}

async function main() {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const FB = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const { getDatabase, ref, push, set, onValue, get, update, remove, runTransaction } = FB;

    const firebaseConfig = {
        apiKey: "AIzaSyAyw7Q7NzfITBFdU1YSnL1sDnAbU86uezQ",
        authDomain: "if-i-sleep.firebaseapp.com",
        databaseURL: "https://if-i-sleep-default-rtdb.firebaseio.com",
        projectId: "if-i-sleep",
        storageBucket: "if-i-sleep.firebasestorage.app",
        messagingSenderId: "901443788902",
        appId: "1:901443788902:web:51241ea974a14d7852cda7"
    };
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);

    // ---------- Sessão local ----------
    const myId = ("uid-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    try { sessionStorage.setItem("iis_uid", myId); } catch (e) {}

    // ---------- Elementos ----------
    const $ = id => document.getElementById(id);
    const screens = {
        entry: $("screen-entry"), lobby: $("screen-lobby"),
        game: $("screen-game"), end: $("screen-end"),
    };
    function showScreen(name) {
        for (const [k, el] of Object.entries(screens)) el.classList.toggle("active", k === name);
    }
    $("manual-body").innerHTML = MANUAL_HTML;

    // ---------- Estado local ----------
    let roomCode = null;
    let isHost = false;
    let myName = "";
    let latestRoom = null;   // snapshot bruto de rooms/{code}
    let latestState = null;  // snapshot de rooms/{code}/game/state
    let myPrivateMsgs = [];  // últimas vistas
    let toastQueueSeen = new Set();
    let actionSelection = null; // seleção de alvo na UI noturna
    let potionChoice = "desmaio";
    let voteSelection = null;
    let countdownInterval = null;

    // ---------- Código da sala ----------
    function genCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let c = "";
        for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
        return c;
    }

    // ---------- Entrada ----------
    $("btn-create").addEventListener("click", async () => {
        myName = $("player-name").value.trim();
        if (!myName) return alertError("O Bardo exige um nome antes de deixá-lo entrar!");
        let code = genCode();
        const exists = await get(ref(db, `rooms/${code}`));
        if (exists.exists()) code = genCode(); // colisão improvável; host re-tenta
        await set(ref(db, `rooms/${code}`), {
            createdAt: Date.now(),
            hostId: myId,
            phase: "lobby",
            players: { [myId]: { name: myName, joinedAt: Date.now() } },
            setup: { mode: "padrao" },
        });
        isHost = true;
        enterRoom(code);
    });

    $("btn-join").addEventListener("click", async () => {
        myName = $("player-name").value.trim();
        if (!myName) return alertError("O Bardo exige um nome antes de deixá-lo entrar!");
        const code = $("room-code-input").value.trim().toUpperCase();
        if (code.length !== 4) return alertError("Digite o código da taverna de 4 letras!");
        const snap = await get(ref(db, `rooms/${code}`));
        if (!snap.exists()) return alertError("Nenhuma taverna com esse código. O Bardo nunca ouviu falar dela.");
        const room = snap.val();
        if (room.phase !== "lobby") return alertError("Essa partida já começou! Espere a próxima ronda.");
        await update(ref(db, `rooms/${code}/players`), { [myId]: { name: myName, joinedAt: Date.now() } });
        isHost = (room.hostId === myId);
        enterRoom(code);
    });

    function alertError(msg) {
        // pequeno toast de erro
        toastPrivate("⚠️ " + msg, 4000);
    }

    function enterRoom(code) {
        roomCode = code;
        showScreen("lobby");
        $("room-code-display").textContent = code;
        attachListeners();          // listener mestre da sala (dirige toda a UI)
        attachActionRequestListener();
        attachPotionRequestListener();
        attachVoteRequestListener();
    }

    // ---------- Listeners principais ----------
    function attachListeners() {
        onValue(ref(db, `rooms/${roomCode}`), (snap) => {
            if (!snap.exists()) {
                alertError("A taverna fechou (sessão removida).");
                location.reload();
                return;
            }
            latestRoom = snap.val();
            latestState = latestRoom.game?.state || null;
            renderRoomFull(latestRoom);
        });
    }

    // ---------- Lobby render ----------
    function renderRoom(room) {
        if (room.phase !== "lobby") return; // jogo toma a tela em outro listener
        const ids = Object.keys(room.players || {});
        $("lobby-count").textContent = `(${ids.length}/${MAX_PLAYERS})`;
        const ul = $("lobby-players");
        ul.innerHTML = "";
        ids.forEach(id => {
            const li = document.createElement("li");
            li.textContent = "🔥 " + room.players[id].name;
            if (id === room.hostId) li.innerHTML += ' <span class="badge host">Anfitrião</span>';
            if (id === myId) li.innerHTML += ' <span class="badge">você</span>';
            ul.appendChild(li);
        });
        const valid = ids.length >= MIN_PLAYERS && ids.length <= MAX_PLAYERS;
        const rolesList = valid ? computeSetup(ids.length) : null;
        $("roles-explain").textContent = valid
            ? `Com ${ids.length} viajantes: 1 Necromante, 1 Mago, 1 Paladino, 1 Bruxa e ${ids.length - 4} Aldeões.`
            : `A vila precisa de ${MIN_PLAYERS} a ${MAX_PLAYERS} viajantes para o conto fazer sentido.`;
        const ul2 = $("setup-list");
        ul2.innerHTML = "";
        if (rolesList) {
            const readable = rolesList.map(r => ROLES[r].key);
            const counts = {};
            readable.forEach(r => counts[r] = (counts[r] || 0) + 1);
            for (const [r, c] of Object.entries(counts)) {
                const li = document.createElement("li");
                li.textContent = `${c}× ${r}`;
                ul2.appendChild(li);
            }
        }
        const startBtn = $("btn-start");
        startBtn.style.display = (isHost && valid) ? "inline-block" : "none";
        $("waiting-note").textContent = isHost
            ? (valid ? "Quando todos estiverem prontos, faça a noite cair." : "Aguardando mais viajantes...")
            : "O anfitrião fará a noite cair quando a vila estiver completa.";
    }

    // ---------- Iniciar jogo (host) ----------
    $("btn-start").addEventListener("click", async () => {
        if (!isHost || !latestRoom) return;
        const ids = Object.keys(latestRoom.players);
        if (ids.length < MIN_PLAYERS) return;
        const rolesMap = assignRoles(ids);
        if (!rolesMap) return;
        const players = {};
        for (const id of ids) {
            players[id] = {
                name: latestRoom.players[id].name,
                role: rolesMap[id],
                alive: true,
                lastProtected: null, lastGifted: null,
                mutedToday: false, doubleVote: false,
            };
        }
        const initialState = {
            players, night: 1, stepIndex: 0,
            actions: {}, pendingPotion: null,
            log: [], privates: {}, votes: {},
            winner: null, dayDeadline: null, voteDeadline: null,
            startedAt: Date.now(),
        };
        await update(ref(db, `rooms/${roomCode}`), {
            phase: "night_1",
            game: { state: initialState },
        });
    });

    // ---------- Máquina de fases (host) ----------
    // Fases: night_N → dawn_N → day_N → vote_N → hang_N → night_(N+1) ... | finished
    function phaseBase(phase) { return String(phase).replace(/_\d+$/, ""); }

    // Host: verifica se todos os agentes do passo atual agiram (ou timeout)
    function currentStepActors(state, stepIndex) {
        const kind = NIGHT_ORDER[stepIndex];
        const roleId = { NECRO: "NECROMANTE", ZUMBI: "ZUMBI", PALADINO: "PALADINO", MAGO: "MAGO", BRUXA: "BRUXA" }[kind];
        const id = idByRole(state, roleId);
        if (!id || !state.players[id].alive) return [];
        // Zumbi criado nesta noite não age
        if (roleId === "ZUMBI" && state.players[id].zombieSince === state.night) return [];
        return [id];
    }
    function stepDone(state, stepIndex) {
        const actors = currentStepActors(state, stepIndex);
        const kind = NIGHT_ORDER[stepIndex];
        const actKey = { NECRO: ["necroKill", "necroRevive"], ZUMBI: ["zumbiSniff"], PALADINO: ["paladinoCheck"], MAGO: ["magoShield"], BRUXA: ["bruxaGift"] }[kind];
        return actors.every(a => actKey.some(k => state.actions[k] && state.actions[k].by === a));
    }

    let hostNightTimer = null;
    let lastAdvanceTs = 0;

    // Timeout por passo da noite: se o agente não agir em NIGHT_STEP_MS,
    // o host pula o passo automaticamente (o jogador perde a ação).
    const NIGHT_STEP_MS = 60000;
    let stepDeadlineAt = null;   // timestamp local do deadline do passo atual
    let stepDeadlineFor = -1;    // night|step que originou o deadline

    function ensureStepDeadline(state, step) {
        const key = state.night + "|" + step;
        if (stepDeadlineFor !== key) {
            stepDeadlineFor = key;
            stepDeadlineAt = Date.now() + NIGHT_STEP_MS;
        }
        return stepDeadlineAt;
    }

    function watchPhaseForHost(room) {
        if (!isHost) return;
        const phase = room.phase || "lobby";
        const base = phaseBase(phase);
        const state = room.game?.state;
        if (!state) return;

        if (base === "night") {
            const step = state.stepIndex ?? 0;
            if (step >= NIGHT_ORDER.length) {
                goToEndOfNight(state, room);
                return;
            }
            if (stepDone(state, step)) {
                if (Date.now() - lastAdvanceTs > 500) {
                    lastAdvanceTs = Date.now();
                    advanceStep(state, room);
                }
                return;
            }
            // timeout do passo: força avanço sem ação registrada
            const dl = ensureStepDeadline(state, step);
            if (Date.now() >= dl && Date.now() - lastAdvanceTs > 500) {
                lastAdvanceTs = Date.now();
                advanceStep(state, room);
            }
        } else {
            stepDeadlineFor = -1; // reseta quando sai da noite
        }
    }

    async function advanceStep(state, room) {
        const next = (state.stepIndex ?? 0) + 1;
        await update(ref(db, `rooms/${roomCode}/game/state`), { stepIndex: next });
    }

    async function goToEndOfNight(state, room) {
        if (hostNightTimer) return; // evita corrida
        hostNightTimer = setTimeout(async () => {
            hostNightTimer = null;
            const fresh = await get(ref(db, `rooms/${roomCode}/game/state`));
            const st = fresh.val();
            if (!st || st.stepIndex < NIGHT_ORDER.length) return;
            const resolved = resolveNight(st);
            // monta privates por jogador (acumula histórico existente)
            const privates = st.privates || {};
            for (const pm of resolved.privates.splice(0)) {
                privates[pm.to] = (privates[pm.to] || []).concat([{ text: pm.text, at: Date.now() }]);
            }
            delete resolved.privates;
            resolved.privates = privates;
            resolved.stepIndex = 0;
            resolved.votes = {};
            stepDeadlineFor = -1;

            let nextPhase;
            if (resolved.winner) {
                nextPhase = "finished";
            } else if (resolved.pendingPotion) {
                nextPhase = "dawn_" + resolved.night;   // Amanhecer: dilema da poção
            } else {
                nextPhase = "day_" + resolved.night;    // sem poção pendente → dia direto
            }
            await update(ref(db, `rooms/${roomCode}`), {
                phase: nextPhase,
                "game/state": resolved,
                dayDeadline: nextPhase.startsWith("day_") ? Date.now() + DAY_MS : null,
            });
            if (resolved.winner) finalizeEnd(resolved);
        }, 300);
    }

    // ---------- Host: timers de amanhecer/dia/votação ----------
    const DAWN_MS = 25000;    // tempo do dilema da poção
    const DAY_MS = 180000;    // debate na praça
    const VOTE_MS = 60000;    // julgamento secreto
    const HANG_MS = 15000;    // exibição do veredito

    async function hostTimers(room) {
        if (!isHost) return;
        const phase = room.phase;
        const base = phaseBase(phase);
        const now = Date.now();

        if (base === "dawn" && !room.dawnDeadline) {
            await update(ref(db, `rooms/${roomCode}`), { dawnDeadline: now + DAWN_MS });
        }
        if (base === "dawn" && room.dawnDeadline && now >= room.dawnDeadline) {
            const st = room.game.state;
            const resolved = resolveDawn(st, null); // ninguém decidiu → descarte
            await update(ref(db, `rooms/${roomCode}`), {
                phase: "day_" + st.night, "game/state": resolved, dawnDeadline: null,
                dayDeadline: now + DAY_MS,
            });
        }
        if (base === "day" && !room.dayDeadline) {
            await update(ref(db, `rooms/${roomCode}`), { dayDeadline: now + DAY_MS });
        }
        if (base === "day" && room.dayDeadline && now >= room.dayDeadline) {
            await openVote(room);
        }
        if (base === "vote" && room.voteDeadline && now >= room.voteDeadline) {
            await closeVote(room);
        }
        if (base === "hang" && room.hangDeadline && now >= room.hangDeadline) {
            await startNextNight(room);
        }
    }

    async function openVote(room) {
        const st = room.game.state;
        await update(ref(db, `rooms/${roomCode}`), {
            phase: "vote_" + st.night,
            "game/state/votes": {},
            voteDeadline: Date.now() + VOTE_MS,
            dayDeadline: null,
        });
    }

    async function closeVote(room) {
        const st = room.game.state;
        const votes = st.votes || {};
        const res = tallyVotes(st, votes);
        const after = applyHanging(st, res.top);
        after.votes = {};
        if (after.winner) {
            await update(ref(db, `rooms/${roomCode}`), {
                phase: "hang_" + st.night,
                "game/state": after,
                "game/lastTally": res.counts,
                hangDeadline: Date.now() + HANG_MS,
                voteDeadline: null,
            });
            finalizeEnd(after);
            return;
        }
        await update(ref(db, `rooms/${roomCode}`), {
            phase: "hang_" + st.night,
            "game/state": after,
            "game/lastTally": res.counts,
            hangDeadline: Date.now() + HANG_MS,
            voteDeadline: null,
        });
    }

    async function startNextNight(room) {
        const st = room.game.state;
        if (st.winner) { finalizeEnd(st); return; }
        const next = JSON.parse(JSON.stringify(st));
        next.night = st.night + 1;
        next.stepIndex = 0;
        next.actions = {};
        next.pendingPotion = null;
        next.log = [];
        stepDeadlineFor = -1;
        await update(ref(db, `rooms/${roomCode}`), {
            phase: "night_" + next.night,
            "game/state": next,
            hangDeadline: null,
            dayDeadline: null,
            voteDeadline: null,
        });
    }

    let endFinalized = false;
    async function finalizeEnd(state) {
        if (endFinalized) return;
        endFinalized = true;
        const reveal = {};
        for (const [id, p] of Object.entries(state.players)) reveal[id] = { role: p.role, alive: p.alive };
        await update(ref(db, `rooms/${roomCode}`), { phase: "finished", "game/reveal": reveal, winner: state.winner });
    }

    // ---------- Render mestre (todos os clientes) ----------
    function renderRoomFull(room) {
        const phase = room.phase || "lobby";
        const base = phaseBase(phase);
        if (phase === "lobby") { showScreen("lobby"); renderRoom(room); return; }
        if (phase === "finished") { renderEnd(room); return; }
        showScreen("game");
        const state = room.game?.state;
        if (!state) return;
        renderGameTop(state, room);
        renderPhase(state, room, base);
        // Host-driven timers (rodados a cada snapshot)
        hostTimers(room);
        if (base === "night") watchPhaseForHost(room);
    }

    function myPlayer(state) { return state.players?.[myId] || null; }

    function renderGameTop(state, room) {
        const me = myPlayer(state);
        // identidade
        const roleKey = me ? ROLES[me.role]?.key : "?";
        $("my-role-card").innerHTML = me
            ? `<b>${esc(me.name)}</b> — ${roleKey}${!me.alive ? ' <span class="badge dead-badge">morto</span>' : ""}`
            : "—";
        $("help-text").textContent = me ? (HELP_TEXT[roleKey] || "") : "";
        // lista de vivos/mortos
        const ul = $("game-alive-list");
        ul.innerHTML = "";
        for (const p of Object.values(state.players)) {
            const li = document.createElement("li");
            li.textContent = (p.alive ? "🟢 " : "💀 ") + p.name;
            if (!p.alive) li.className = "dead-name";
            ul.appendChild(li);
        }
        // linha do bardo = última mensagem pública relevante
        const lastPublic = [...(state.log || [])].reverse().find(l => l.text);
        $("bardo-line").textContent = lastPublic ? lastPublic.text : BARDO.say("nightStart", {}, Math.random);
        // privadas
        renderPrivates(state);
    }

    function renderPrivates(state) {
        const list = (state.privates && state.privates[myId]) || [];
        const ul = $("private-log");
        ul.innerHTML = "";
        list.slice(-6).forEach(m => {
            const li = document.createElement("li");
            li.textContent = m.text;
            ul.appendChild(li);
            if (!toastQueueSeen.has(m.at)) {
                toastQueueSeen.add(m.at);
                toastPrivate("📜 Segredo do Bardo: " + m.text, 6000);
            }
        });
    }

    function toastPrivate(html, ms = 5000) {
        const div = document.createElement("div");
        div.className = "private-toast";
        div.innerHTML = html;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), ms);
    }

    function renderPhase(state, room, base) {
        const banner = $("phase-banner");
        hideAll(["panel-night", "panel-dawn", "panel-day", "panel-vote", "panel-hanging"]);
        const me = myPlayer(state);
        const night = state.night;

        if (base === "night") {
            banner.textContent = `🌙 Noite ${night}`;
            banner.className = "phase-banner phase-noite";
            $("panel-night").style.display = "block";
            renderNightPanel(state, room, me);
        } else if (base === "dawn") {
            banner.textContent = `☀️ Amanhecer da Noite ${night}`;
            banner.className = "phase-banner phase-amanhecer";
            $("panel-dawn").style.display = "block";
            const pend = state.pendingPotion;
            const iAmTarget = pend && pend.targetId === myId && me && me.alive;
            $("dawn-text").textContent = iAmTarget
                ? "Você acordou com um frasco escuro ao lado da cama. Nenhum rótulo. Nenhuma pista. Beber ou descartar?"
                : "Um frasco apareceu em alguma casa da vila. Aguardamos a coragem (ou a prudência) do destinatário...";
            $("btn-drink").style.display = iAmTarget ? "inline-block" : "none";
            $("btn-discard").style.display = iAmTarget ? "inline-block" : "none";
        } else if (base === "day") {
            banner.textContent = `☀️ Dia ${night} — Debate`;
            banner.className = "phase-banner phase-dia";
            $("panel-day").style.display = "block";
            renderChat(state, room, me);
        } else if (base === "vote") {
            banner.textContent = `⚖️ Julgamento Secreto — Dia ${night}`;
            banner.className = "phase-banner phase-votacao";
            $("panel-vote").style.display = "block";
            renderVotePanel(state, room, me);
        } else if (base === "hang") {
            banner.textContent = `🪢 Veredito — Dia ${night}`;
            banner.className = "phase-banner phase-votacao";
            $("panel-hanging").style.display = "block";
            renderHanging(state, room);
        }
    }

    function hideAll(ids) { ids.forEach(i => $(i).style.display = "none"); }

    // ---------- Painel da NOITE ----------
    function renderNightPanel(state, room, me) {
        const status = $("night-status");
        const area = $("night-action");
        area.innerHTML = "";
        if (!me) { status.textContent = "—"; return; }
        if (!me.alive) {
            status.textContent = "💀 Você observa a vila adormecida. Nada pode fazer esta noite.";
            return;
        }
        const step = state.stepIndex ?? 0;
        const myKind = { NECROMANTE: "NECRO", ZUMBI: "ZUMBI", PALADINO: "PALADINO", MAGO: "MAGO", BRUXA: "BRUXA" }[me.role];
        const myStepIdx = { NECRO: 0, ZUMBI: 1, PALADINO: 2, MAGO: 3, BRUXA: 4 }[myKind] ?? -1;
        const acted = nightHasActed(state, myId);

        status.innerHTML = `A vila dorme. Aguardando as sombras agirem... (${Math.min(step, NIGHT_ORDER.length)}/${NIGHT_ORDER.length} passos)`;

        if (!myKind) {
            status.innerHTML += "<br>🧑‍🌾 Você não tem ações esta noite. Durma e sonhe com traições.";
            return;
        }
        if (acted) {
            status.innerHTML += `<br>✅ Ação registrada. Aguarde o resto da noite passar.`;
            return;
        }
        if (myKind === "ZUMBI" && me.zombieSince === state.night) {
            status.innerHTML += "<br>🧟 Você acabou de sair da terra. Esta noite ainda cambaleia confusa.";
            return;
        }
        if (step !== myStepIdx) {
            status.innerHTML += `<br>⏳ Sua hora ainda não chegou (${["Necromante","Zumbi","Paladino","Mago","Bruxa"][myStepIdx]} age no passo ${myStepIdx + 1}).`;
            return;
        }

        // É a minha vez — construir UI da ação
        const pickable = aliveIds(state).filter(id => id !== myId);

        if (me.role === "NECROMANTE") {
            const canRevive = !state.actions.necroReviveUsed && !hasRole(state, "ZUMBI") && deadIds(state).length > 0;
            const modeSel = actionSelection?.mode || "kill";
            const div = document.createElement("div");
            div.innerHTML = `<p>💀 Escolha: matar ou invocar a Ressurreição?</p>`;
            const btnKill = mkBtn("🗡️ Matar um aldeão", modeSel === "kill" ? "primary selected" : "", () => { actionSelection = { mode: "kill" }; renderNightPanel(state, room, me); });
            const btnRevive = mkBtn("⚰️ Invocar Ressurreição (1× na partida)", modeSel === "revive" ? "primary selected" : "", () => { actionSelection = { mode: "revive" }; renderNightPanel(state, room, me); });
            btnRevive.disabled = !canRevive;
            const row = document.createElement("div"); row.append(btnKill, btnRevive); div.appendChild(row);

            if (modeSel === "kill") {
                div.appendChild(targetGrid(state, pickable, (id) => {
                    submitNightAction("necro_kill", id);
                }));
            } else {
                const p = document.createElement("p");
                p.textContent = "O Bardo sorteará um dos mortos para voltar como Zumbi. Confirma?";
                div.appendChild(p);
                div.appendChild(mkBtn("⚰️ Confirmar Ressurreição", "danger", () => submitNightAction("necro_revive", null)));
            }
            area.appendChild(div);
        }
        else if (me.role === "ZUMBI") {
            const div = document.createElement("div");
            div.innerHTML = `<p>🧟 Fareje a presa. Acerte o Mago e ele morre mesmo protegido. Erre e a noite não vale nada.</p>`;
            div.appendChild(targetGrid(state, pickable, (id) => submitNightAction("zumbi_sniff", id)));
            area.appendChild(div);
        }
        else if (me.role === "PALADINO") {
            const div = document.createElement("div");
            div.innerHTML = `<p>🛡️ Escolha alguém para investigar a aura.</p>`;
            div.appendChild(targetGrid(state, pickable, (id) => submitNightAction("paladino_check", id)));
            area.appendChild(div);
        }
        else if (me.role === "MAGO") {
            const options = pickable.filter(id => me.lastProtected !== id);
            const div = document.createElement("div");
            div.innerHTML = `<p>🧙‍♂️ Coloque o Escudo Mágico. (Bloqueia o Necromante, não o Zumbi.)${me.lastProtected ? "<br><span class='small'>Ontem você protegeu " + esc(state.players[me.lastProtected]?.name || "?") + " — escolha outro.</span>" : ""}</p>`;
            div.appendChild(targetGrid(state, options, (id) => submitNightAction("mago_shield", id)));
            area.appendChild(div);
        }
        else if (me.role === "BRUXA") {
            const options = pickable.filter(id => me.lastGifted !== id);
            const div = document.createElement("div");
            div.innerHTML = `<p>🧪 Escolha a poção e o alvo do Presente Misterioso.${me.lastGifted ? "<br><span class='small'>Ontem você presenteou " + esc(state.players[me.lastGifted]?.name || "?") + " — espalhe o caos em outra casa.</span>" : ""}</p>`;
            const b1 = mkBtn("😵 Poção do Desmaio", potionChoice === "desmaio" ? "selected primary" : "", () => { potionChoice = "desmaio"; renderNightPanel(state, room, me); });
            const b2 = mkBtn("💪 Poção da Força", potionChoice === "forca" ? "selected primary" : "", () => { potionChoice = "forca"; renderNightPanel(state, room, me); });
            div.append(b1, b2);
            div.appendChild(targetGrid(state, options, (id) => submitNightAction("bruxa_gift", id, potionChoice)));
            area.appendChild(div);
        }
    }

    function nightHasActed(state, id) {
        const a = state.actions || {};
        return Object.values(a).some(v => v && v.by === id);
    }

    function mkBtn(text, cls, fn) {
        const b = document.createElement("button");
        b.textContent = text;
        if (cls) b.className = cls;
        b.addEventListener("click", fn);
        return b;
    }

    function targetGrid(state, ids, onPick) {
        const wrap = document.createElement("div");
        wrap.className = "targets";
        ids.forEach(id => {
            const b = mkBtn(esc(state.players[id].name), "target-btn", () => onPick(id));
            wrap.appendChild(b);
        });
        if (!ids.length) {
            const p = document.createElement("p");
            p.textContent = "(Sem alvos válidos.)";
            wrap.appendChild(p);
        }
        return wrap;
    }

    // Cliente envia ação noturna → host valida e registra (anti-cheat simples)
    async function submitNightAction(kind, targetId, extra) {
        const state = latestState;
        if (!state) return;
        const check = validateAction(state, myId, kind, targetId, extra);
        if (!check.ok) return alertError(check.reason);
        const payload = { kind, targetId: check.targetId || targetId || null, extra: extra || null };
        if (isHost) {
            await hostApplyNightAction(payload);
        } else {
            await push(ref(db, `rooms/${roomCode}/actionRequests`), { by: myId, ...payload, at: Date.now() });
        }
    }

    async function hostApplyNightAction(req) {
        const snap = await get(ref(db, `rooms/${roomCode}/game/state`));
        const st = snap.val();
        if (!st) return;
        const check = validateAction(st, req.by, req.kind, req.targetId, req.extra);
        if (!check.ok) {
            // rejeição privada
            const privates = st.privates || {};
            privates[req.by] = (privates[req.by] || []).concat([{ text: "🚫 Ação recusada: " + check.reason, at: Date.now() }]);
            await update(ref(db, `rooms/${roomCode}/game/state`), { privates });
            return;
        }
        const upd = {};
        const key = { necro_kill: "necroKill", necro_revive: "necroRevive", zumbi_sniff: "zumbiSniff", paladino_check: "paladinoCheck", mago_shield: "magoShield", bruxa_gift: "bruxaGift" }[req.kind];
        upd[`actions/${key}`] = { by: req.by, targetId: req.targetId || null, potion: req.extra || null };
        if (req.kind === "necro_revive") upd["actions/necroReviveUsed"] = true;
        await update(ref(db, `rooms/${roomCode}/game/state`), upd);
    }

    // Host consome fila de pedidos de ação dos clientes
    function attachActionRequestListener() {
        onValue(ref(db, `rooms/${roomCode}/actionRequests`), async (snap) => {
            if (!isHost) return;
            const data = snap.val();
            if (!data) return;
            for (const [rid, req] of Object.entries(data)) {
                await hostApplyNightAction(req);
                await remove(ref(db, `rooms/${roomCode}/actionRequests/${rid}`));
            }
        });
    }

    // ---------- Amanhecer ----------
    $("btn-drink").addEventListener("click", () => submitPotionDecision("drink"));
    $("btn-discard").addEventListener("click", () => submitPotionDecision("discard"));
    async function submitPotionDecision(decision) {
        const payload = { by: myId, decision };
        if (isHost) await hostApplyPotion(payload);
        else await push(ref(db, `rooms/${roomCode}/potionRequests`), { ...payload, at: Date.now() });
    }
    async function hostApplyPotion(req) {
        const snap = await get(ref(db, `rooms/${roomCode}/game/state`));
        const st = snap.val();
        if (!st || !st.pendingPotion || st.pendingPotion.targetId !== req.by) return;
        const resolved = resolveDawn(st, req.decision);
        await update(ref(db, `rooms/${roomCode}`), {
            phase: "day_" + st.night,
            "game/state": resolved,
            dayDeadline: Date.now() + 180000,
            dawnDeadline: null,
        });
    }
    function attachPotionRequestListener() {
        onValue(ref(db, `rooms/${roomCode}/potionRequests`), async (snap) => {
            if (!isHost) return;
            const data = snap.val();
            if (!data) return;
            for (const [rid, req] of Object.entries(data)) {
                await hostApplyPotion(req);
                await remove(ref(db, `rooms/${roomCode}/potionRequests/${rid}`));
            }
        });
    }

    // ---------- Chat ----------
    let chatRenderedKeys = new Set();
    function renderChat(state, room, me) {
        const box = $("chat-box");
        const msgs = room.chat || {};
        for (const [k, m] of Object.entries(msgs)) {
            if (chatRenderedKeys.has(k)) continue;
            chatRenderedKeys.add(k);
            const div = document.createElement("div");
            const author = state.players[m.by]?.name || "???";
            if (m.system) {
                div.className = "msg system";
                div.textContent = "🎶 " + m.text;
            } else if (m.zombie) {
                div.className = "msg zombie";
                div.innerHTML = `<span class="author">${esc(author)} 🧟:</span> ${esc(m.text)}`;
            } else {
                div.className = "msg" + (state.players[m.by] && !state.players[m.by].alive ? " dead" : "");
                div.innerHTML = `<span class="author">${esc(author)}:</span> ${esc(m.text)}`;
            }
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;

        // controles
        const input = $("chat-input");
        const send = $("btn-send-chat");
        const muted = me && (me.mutedToday || !me.alive);
        input.disabled = !!muted;
        send.disabled = !!muted;
        $("chat-timer-note").textContent = muted
            ? (me.alive ? "😵 Você bebeu demais... sua voz sumiu hoje." : "💀 Os mortos assistem em silêncio.")
            : "";
        // host pode encerrar o debate
        $("btn-open-vote").style.display = isHost ? "inline-block" : "none";
    }

    $("btn-send-chat").addEventListener("click", sendChat);
    $("chat-input").addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
    async function sendChat() {
        const input = $("chat-input");
        const text = input.value.trim();
        if (!text || !latestState) return;
        const me = myPlayer(latestState);
        if (!me || !me.alive || me.mutedToday) return;
        input.value = "";
        const isZombie = me.role === "ZUMBI";
        const finalText = isZombie ? zombieGibberish(text) : text;
        await push(ref(db, `rooms/${roomCode}/chat`), {
            by: myId, text: finalText, zombie: isZombie, at: Date.now(),
        });
    }

    $("btn-open-vote").addEventListener("click", () => { if (isHost && latestRoom) openVote(latestRoom); });

    // ---------- Votação ----------
    function renderVotePanel(state, room, me) {
        const area = $("vote-area");
        area.innerHTML = "";
        const status = $("vote-status");
        if (!me || !me.alive) { status.textContent = "💀 Os mortos não decidem o destino da vila."; return; }
        if (me.mutedToday) { status.textContent = "😵 Sua garganta está fechada pela poção. Sem voto hoje."; return; }

        // Countdown (usando deadline do RTDB)
        tickCountdown($("vote-timer"), room.voteDeadline);

        const already = state.votes && state.votes[myId] !== undefined;
        if (already) {
            status.textContent = "✅ Voto registrado em segredo. Aguarde a contagem.";
            return;
        }
        if (me.role === "ZUMBI") {
            const ballot = zombieBallot(state, myId);
            const wrap = document.createElement("div"); wrap.className = "targets";
            ballot.forEach(opt => {
                const b = mkBtn(esc(opt.label), "target-btn", () => castVote(opt.value));
                wrap.appendChild(b);
            });
            wrap.appendChild(mkBtn("Pular Voto", "target-btn", () => castVote("skip")));
            area.appendChild(wrap);
            status.textContent = "🧟 Seus botões fazem sentido só pra você. Boa sorte.";
            return;
        }
        const targets = aliveIds(state).filter(id => id !== myId);
        const wrap = document.createElement("div"); wrap.className = "targets";
        targets.forEach(id => {
            wrap.appendChild(mkBtn(esc(state.players[id].name), "target-btn", () => castVote(id)));
        });
        wrap.appendChild(mkBtn("🙅 Pular Voto", "target-btn", () => castVote("skip")));
        area.appendChild(wrap);
        if (me.doubleVote) status.textContent = "💪 A poção da Força corre nas suas veias: seu voto vale 2.";
    }

    async function castVote(value) {
        if (isHost) await hostCastVote({ by: myId, value });
        else await push(ref(db, `rooms/${roomCode}/voteRequests`), { by: myId, value, at: Date.now() });
    }
    async function hostCastVote(req) {
        const snap = await get(ref(db, `rooms/${roomCode}/game/state`));
        const st = snap.val();
        if (!st) return;
        const voter = st.players[req.by];
        if (!voter || !voter.alive || voter.mutedToday) return;
        if (st.votes && st.votes[req.by] !== undefined) return;
        if (req.value !== "skip" && (!st.players[req.value] || !st.players[req.value].alive)) return;
        await update(ref(db, `rooms/${roomCode}/game/state/votes`), { [req.by]: req.value });
    }
    function attachVoteRequestListener() {
        onValue(ref(db, `rooms/${roomCode}/voteRequests`), async (snap) => {
            if (!isHost) return;
            const data = snap.val();
            if (!data) return;
            for (const [rid, req] of Object.entries(data)) {
                await hostCastVote(req);
                await remove(ref(db, `rooms/${roomCode}/voteRequests/${rid}`));
            }
        });
    }

    function tickCountdown(el, deadline) {
        if (countdownInterval) clearInterval(countdownInterval);
        const upd = () => {
            if (!deadline) { el.textContent = ""; return; }
            const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            el.textContent = `⏳ ${s}s`;
        };
        upd();
        countdownInterval = setInterval(upd, 500);
    }

    // ---------- Enforcamento / resultado ----------
    function renderHanging(state, room) {
        const hang = $("hang-text");
        const lastDeath = [...(state.log || [])].reverse().find(l => l.type === "hang" || l.type === "tie");
        hang.innerHTML = lastDeath ? `<p>${esc(lastDeath.text)}</p>` : "<p>A vila respira...</p>";
        const results = room.game?.lastTally || {};
        const box = $("vote-results");
        box.innerHTML = "<h4>Contagem revelada:</h4>";
        const entries = Object.entries(results);
        const max = Math.max(1, ...entries.map(e => e[1]));
        if (!entries.length) box.innerHTML += "<p class='small'>Ninguém foi votado.</p>";
        entries.sort((a, b) => b[1] - a[1]).forEach(([id, count]) => {
            const name = state.players[id]?.name || "?";
            const bar = document.createElement("div");
            bar.className = "vote-result-bar";
            bar.innerHTML = `<div class="fill" style="width:${Math.round(count / max * 100)}%">${esc(name)} — ${count} voto(s)</div>`;
            box.appendChild(bar);
        });
    }

    // ---------- Fim de jogo ----------
    function renderEnd(room) {
        showScreen("end");
        const winner = room.winner || room.game?.state?.winner;
        const titles = { aldeia: "🏘️ A Aldeia Venceu!", viloes: "💀 O Necromante Venceu!", bruxa: "🧪 A Bruxa Sobreviveu!" };
        $("end-title").textContent = titles[winner] || "Fim da Crônica";
        const banks = { aldeia: "winVillage", viloes: "winNecro", bruxa: "winWitch" };
        $("end-bardo").textContent = BARDO.say(banks[winner] || "noDeaths", {}, Math.random);
        const reveal = room.game?.reveal || {};
        const players = room.game?.state?.players || {};
        let html = "<h3>Os papéis eram:</h3><ul>";
        for (const [id, p] of Object.entries(players)) {
            const r = ROLES[reveal[id]?.role || p.role]?.key || "?";
            html += `<li>${esc(p.name)} — ${r} ${p.alive ? "🟢" : "💀"}</li>`;
        }
        html += "</ul>";
        $("end-summary").innerHTML = html;
    }

    $("btn-back-lobby").addEventListener("click", () => location.reload());

    // ---------- util ----------
    function esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // Loop de timers do host: deadlines não dependem apenas de snapshots
    // (se nada muda no banco, o tempo ainda precisa passar).
    setInterval(() => {
        if (isHost && latestRoom) {
            try { hostTimers(latestRoom); } catch (e) { console.warn(e); }
            try { watchPhaseForHost(latestRoom); } catch (e) { console.warn(e); }
        }
    }, 1000);

    // Export para testes em Node
    globalThis.__IIS__ = {
        ROLES, NIGHT_ORDER, BARDO, HELP_TEXT,
        shuffleArray, mulberry32, computeSetup, assignRoles, newState,
        validateAction, recordAction, resolveNight, resolveDawn,
        tallyVotes, applyHanging, checkWinner, zombieGibberish, zombieBallot,
        aliveIds, deadIds, hasRole, idByRole,
    };
}

// Export para testes em Node (quando não estamos no navegador)
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        ROLES, NIGHT_ORDER, BARDO, HELP_TEXT,
        shuffleArray, mulberry32, computeSetup, assignRoles, newState,
        validateAction, recordAction, resolveNight, resolveDawn,
        tallyVotes, applyHanging, checkWinner, zombieGibberish, zombieBallot,
        aliveIds, deadIds, hasRole, idByRole,
        MIN_PLAYERS, MAX_PLAYERS,
    };
}
