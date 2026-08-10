// 1. Importações do Firebase pelo CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, get, child, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// 2. Configuração do seu Projeto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAyw7Q7NzfITBFdU1YSnL1sDnAbU86uezQ",
  authDomain: "if-i-sleep.firebaseapp.com",
  databaseURL: "https://if-i-sleep-default-rtdb.firebaseio.com",
  projectId: "if-i-sleep",
  storageBucket: "if-i-sleep.firebasestorage.app",
  messagingSenderId: "901443788902",
  appId: "1:901443788902:web:51241ea974a14d7852cda7"
};

// 3. Inicializando o Firebase e o Banco de Dados
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 4. Mapeando os elementos do HTML
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const btnJoin = document.getElementById('btn-join');
const welcomeMessage = document.getElementById('welcome-message');
const playersList = document.getElementById('players-list');
const btnStart = document.getElementById('btn-start');
const myRoleDisplay = document.getElementById('my-role-display');
const roleText = document.getElementById('role-text');

let myPlayerId = null; // Guardará a ID única do jogador neste navegador

// 5. Função para embaralhar os papéis (Algoritmo de Fisher-Yates)
function embaralhar(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 6. Evento: Quando o jogador entra na taverna
btnJoin.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    
    if (playerName !== "") {
        // Esconde o lobby e mostra a área do jogo
        lobbyScreen.style.display = "none";
        gameScreen.style.display = "block";
        welcomeMessage.innerText = `O Bardo afina o alaúde para ${playerName}...`;

        // Salva o jogador no banco de dados e guarda a ID dele
        const newPlayerRef = push(ref(db, 'lobby'));
        myPlayerId = newPlayerRef.key; 
        
        set(newPlayerRef, {
            nome: playerName,
            status: "vivo",
            papel: "aguardando"
        });

        // Fica escutando quem entra para atualizar a lista
        onValue(ref(db, 'lobby'), (snapshot) => {
            playersList.innerHTML = ""; 
            let playerCount = 0;
            
            snapshot.forEach((childSnapshot) => {
                playerCount++;
                const player = childSnapshot.val();
                const playerId = childSnapshot.key;
                
                const li = document.createElement('li');
                li.innerText = `🔥 ${player.nome}`;
                playersList.appendChild(li);

                // Se o jogo já distribuiu os papéis, revela o do jogador na tela dele
                if (playerId === myPlayerId && player.papel !== "aguardando") {
                    myRoleDisplay.style.display = "block";
                    roleText.innerText = player.papel;
                }
            });

            // Mostra o botão de começar se houver pelo menos 2 jogadores (para testes)
            if (playerCount >= 2) {
                btnStart.style.display = "inline-block";
            }
        });
    } else {
        alert("O Bardo exige um nome antes de deixá-lo entrar!");
    }
});

// 7. Evento: Quando o anfitrião clica em "Começar Jogo"
btnStart.addEventListener('click', () => {
    // Busca a lista de jogadores atual no banco
    get(child(ref(db), 'lobby')).then((snapshot) => {
        if (snapshot.exists()) {
            const jogadores = snapshot.val();
            const ids = Object.keys(jogadores);
            
            // Define os papéis básicos
            let papeis = ["Necromante", "Mago", "Paladino", "Bruxa"];
            
            // Preenche o resto com Aldeões, se houver mais jogadores
            while(papeis.length < ids.length) {
                papeis.push("Aldeão");
            }
            
            // Corta a lista de papéis para bater exatamente com a quantidade de jogadores (em testes)
            papeis = papeis.slice(0, ids.length); 
            
            // Mistura os papéis
            papeis = embaralhar(papeis);

            // Prepara a atualização do banco de dados com o papel de cada um
            let updates = {};
            ids.forEach((id, index) => {
                updates[`/lobby/${id}/papel`] = papeis[index];
            });
            
            // Salva os papéis no banco
            update(ref(db), updates);
            
            // Muda a fase do jogo para a Noite 1 (isso aciona todos os navegadores conectados)
            set(ref(db, 'estado_jogo/fase_atual'), 'noite_1');

            // Esconde o botão para não ser clicado de novo
            btnStart.style.display = "none";
        }
    });
});

// 8. O Ouvinte Mestre: Fica de olho na fase do jogo para mudar a tela de todos
onValue(ref(db, 'estado_jogo/fase_atual'), (snapshot) => {
    const fase = snapshot.val();
    
    if (fase === 'noite_1') {
        // Esconde a lista do lobby
        playersList.style.display = "none";
        
        // Altera o clima da tela
        welcomeMessage.innerText = "A Noite Caiu sobre a Taverna...";
        welcomeMessage.style.color = "#4a90e2"; // Tom azulado para noite
        
        // Chama a função que vai construir os botões noturnos (a ser programada no próximo passo)
        prepararNoite1();
    }
});

function prepararNoite1() {
    // 1. O Banco de Rimas do Bardo para o início da Noite
    const rimasNoite = [
        "O sol se esconde, a fogueira crepita. A noite é escura e a morte não hesita.",
        "As sombras avançam, a taverna silencia. Quem verá a luz do próximo dia?",
        "Fechem as portas, apaguem a luz. Aquele que dorme, o destino conduz."
    ];
    
    // Sorteia uma rima
    const rimaEscolhida = rimasNoite[Math.floor(Math.random() * rimasNoite.length)];
    
    // 2. Injeta a rima na tela
    const painelBardo = document.createElement('div');
    painelBardo.style.marginTop = "20px";
    painelBardo.style.padding = "15px";
    painelBardo.style.border = "1px solid #8b0000"; // Borda vermelho sangue
    painelBardo.style.backgroundColor = "#1a0000";
    
    const textoBardo = document.createElement('p');
    textoBardo.innerHTML = `🎶 <em>"${rimaEscolhida}"</em>`;
    textoBardo.style.fontSize = "1.2em";
    
    painelBardo.appendChild(textoBardo);
    gameScreen.appendChild(painelBardo);

    // 3. Sistema de explicação do papel
    const meuPapel = roleText.innerText; // Pega o papel que está na tela
    
    // Dicionário com o manual de regras resumido
    const manualHabilidades = {
        "Necromante": "💀 Sua Habilidade: Escolha um alvo para eliminar esta noite. (Uma vez por partida, você pode invocar a Ressurreição em um morto).",
        "Mago": "🧙‍♂️ Sua Habilidade: Escolha um jogador para receber o Escudo Mágico. Ele sobreviverá ao ataque do Necromante.",
        "Paladino": "🛡️ Sua Habilidade: Escolha um jogador para investigar. O Bardo revelará se a aura dele é Pura ou Corrompida.",
        "Bruxa": "🧪 Sua Habilidade: Envie a Poção do Desmaio ou da Força para alguém. Lembre-se: não envie poções para a mesma pessoa duas noites seguidas!",
        "Aldeão": "🧑‍🌾 Sua Habilidade: Nenhuma. Você apenas dorme. Preste atenção aos debates de amanhã para tentar enforcar o culpado no julgamento."
    };

    // Cria o botão de ajuda
    const btnAjuda = document.createElement('button');
    btnAjuda.innerText = "Lembrar minha Habilidade";
    btnAjuda.style.marginTop = "20px";
    btnAjuda.style.backgroundColor = "#333";
    
    // Cria o texto de explicação (começa invisível)
    const textoAjuda = document.createElement('p');
    textoAjuda.innerText = manualHabilidades[meuPapel] || "Aguardando revelação...";
    textoAjuda.style.display = "none";
    textoAjuda.style.color = "#aaa";
    textoAjuda.style.fontStyle = "italic";

    // Lógica do clique (mostra/esconde)
    btnAjuda.addEventListener('click', () => {
        if (textoAjuda.style.display === "none") {
            textoAjuda.style.display = "block";
            btnAjuda.innerText = "Esconder Habilidade";
        } else {
            textoAjuda.style.display = "none";
            btnAjuda.innerText = "Lembrar minha Habilidade";
        }
    });

    gameScreen.appendChild(btnAjuda);
    gameScreen.appendChild(textoAjuda);
    
    // 4. Container onde os botões de ação (atacar, proteger, etc) vão aparecer depois
    const painelAcoes = document.createElement('div');
    painelAcoes.id = "painel-acoes-noite";
    painelAcoes.style.marginTop = "30px";
    gameScreen.appendChild(painelAcoes);
}
