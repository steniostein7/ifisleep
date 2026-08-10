// Importando do CDN para funcionar direto no navegador pelo GitHub Pages
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Sua configuração do Firebase (removi o Analytics, pois não precisaremos dele para o jogo)
const firebaseConfig = {
  apiKey: "AIzaSyAyw7Q7NzfITBFdU1YSnL1sDnAbU86uezQ",
  authDomain: "if-i-sleep.firebaseapp.com",
  databaseURL: "https://if-i-sleep-default-rtdb.firebaseio.com",
  projectId: "if-i-sleep",
  storageBucket: "if-i-sleep.firebasestorage.app",
  messagingSenderId: "901443788902",
  appId: "1:901443788902:web:51241ea974a14d7852cda7"
};

// Inicializa o Firebase e o Banco de Dados
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Mapeando os elementos do HTML
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

// Função para embaralhar os papéis (Algoritmo de Fisher-Yates)
function embaralhar(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Evento: Quando clicar no botão de Entrar
btnJoin.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    
    if (playerName !== "") {
        lobbyScreen.style.display = "none";
        gameScreen.style.display = "block";
        welcomeMessage.innerText = `O Bardo afina o alaúde para ${playerName}...`;

        // Cria o jogador e salva a ID dele
        const newPlayerRef = push(ref(db, 'lobby'));
        myPlayerId = newPlayerRef.key; 
        
        set(newPlayerRef, {
            nome: playerName,
            status: "vivo",
            papel: "aguardando"
        });

        // Escuta os jogadores entrando
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

                // Se o jogo já distribuiu os papéis, mostra na tela apenas o MEU papel
                if (playerId === myPlayerId && player.papel !== "aguardando") {
                    myRoleDisplay.style.display = "block";
                    roleText.innerText = player.papel;
                }
            });

            // Mostra o botão de começar jogo se tivermos pelo menos 2 pessoas (para facilitar seus testes!)
            // No jogo final, mudaremos para 5 ou mais.
            if (playerCount >= 2) {
                btnStart.style.display = "inline-block";
            }
        });
    } else {
        alert("O Bardo exige um nome antes de deixá-lo entrar!");
    }
});

// Evento: Quando alguém clicar em "Começar Jogo"
btnStart.addEventListener('click', () => {
    // Lê todos os jogadores atuais no lobby
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js').then((module) => {
        const get = module.get;
        const child = module.child;
        const update = module.update;

        get(child(ref(db), 'lobby')).then((snapshot) => {
            if (snapshot.exists()) {
                const jogadores = snapshot.val();
                const ids = Object.keys(jogadores);
                
                // Cria a lista de papéis baseada na quantidade de jogadores
                let papeis = ["Necromante", "Mago", "Paladino", "Bruxa"];
                
                // Preenche o resto com Aldeões
                while(papeis.length < ids.length) {
                    papeis.push("Aldeão");
                }
                
                // Se tiver pouca gente testando, corta os papéis para caber
                papeis = papeis.slice(0, ids.length); 
                
                papeis = embaralhar(papeis); // Mistura a sacola!

                // Atualiza o banco de dados com o papel de cada um
                let updates = {};
                ids.forEach((id, index) => {
                    updates[`/lobby/${id}/papel`] = papeis[index];
                });
                
                update(ref(db), updates);
                
                // Esconde o botão de começar para não clicarem duas vezes
                btnStart.style.display = "none";
            }
        });
    });
});
