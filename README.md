# ⚔️ If I Sleep...

Jogo de **sobrevivência medieval e dedução social baseado em texto** (estilo Mafia/Werewolf), multijogador via navegador, com Firebase Realtime Database como transporte.

## 🗂 Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Telas: entrada, lobby (código da taverna), jogo (noite/amanhecer/dia/votação/forca) e fim. Tema sombrio medieval. |
| `app.js` | **Motor de regras puro** (exportado para testes no Node) + camada Firebase/UI. |
| `tests/engine.test.js` | 21 testes do motor (`node tests/engine.test.js`). |
| `firebase.json` / `database.rules.json` | Config de hosting e regras de desenvolvimento. |

## 🧠 Arquitetura

- **Host-authoritative**: quem cria a sala é o *host*. Clientes nunca escrevem no estado do jogo — eles publicam pedidos em filas (`actionRequests`, `potionRequests`, `voteRequests`) que o host **valida** (`validateAction`) e aplica. Isso impede cheating trivial (matar sem ser o Necromante, votar duas vezes, etc.).
- **Máquina de fases** por string no RTDB: `lobby → night_N → dawn_N → day_N → vote_N → hang_N → night_N+1 → ... → finished`. O host roda timers a cada snapshot + um loop de 1s (deadlines de amanhecer/dia/voto e timeout de 60s por passo da noite).
- **Ordem da noite** exatamente como o manual: Necromante → Zumbi → Paladino (+Radar Sombrio) → Mago → Bruxa. Cada papel age quando `stepIndex` chega na sua vez; ações são "intenções" registradas e resolvidas em conjunto ao fim da noite (`resolveNight`), respeitando escudo vs. morte, zumbi ignorando escudo, ressurreição, poção pendente para o amanhecer.
- **Bardo**: banco de rimas com variáveis (`${nome}`) sorteadas sem repetição óbvia — todas as mortes, salvamentos, ressurreições, empates e vitórias usam frases rimadas.
- **Maldições do Zumbi**: chat substituído por gibberish no envio; cédula de votação com nomes nonsense embaralhados (só "Pular Voto" legível).
- **Votação secreta**: votos ficam no estado mas a contagem só é revelada na tela da forca; empate = ninguém morre; peso 2 para quem bebeu a Poção da Força; mutados (Desmaio) não votam nem falam, mas podem ser enforcados.

## ▶️ Rodar localmente

```bash
npx --yes serve .        # ou qualquer servidor estático
node tests/engine.test.js
```

## 🚀 Deploy (Firebase)

```bash
npm --yes install -g firebase-tools
firebase login
firebase use --add            # projeto: if-i-sleep
firebase deploy
```

## ⚠️ Pendências importantes antes de divulgar

1. **Regras de segurança abertas** (`database.rules.json`): em produção qualquer pessoa pode ler/escrever em `rooms/*`. Ative **Anonymous Auth** e restrinja escrita de `game/state`, `log`, `privates` ao uid do host.
2. **Segredos visíveis no RTDB**: papéis e ações noturnas ficam no mesmo banco que todos leem. Funciona entre amigos; contra jogadores técnicos, migre a resolução para **Cloud Functions** (ou use criptografia por facção).
3. **Host desconectado** pausa a partida (não há eleição de novo host).
4. Decida oficialmente o **empate de vitória Bruxa × Aldeia** (hoje a Bruxa viva prevalece no placar final).
