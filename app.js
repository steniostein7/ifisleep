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

// Evento: Quando clicar no botão de Entrar
btnJoin.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    
    if (playerName !== "") {
        // 1. Esconde a tela de entrada e mostra o jogo
        lobbyScreen.style.display = "none";
        gameScreen.style.display = "block";
        welcomeMessage.innerText = `O Bardo afina o alaúde para ${playerName}...`;

        // 2. Cria um novo jogador na pasta "lobby" do banco de dados
        const newPlayerRef = push(ref(db, 'lobby'));
        set(newPlayerRef, {
            nome: playerName,
            status: "vivo",
            papel: "aguardando"
        });

        // 3. Escuta em TEMPO REAL todos os jogadores que entram
        const lobbyRef = ref(db, 'lobby');
        onValue(lobbyRef, (snapshot) => {
            playersList.innerHTML = ""; // Limpa a lista atual na tela
            
            // Passa por cada jogador no banco de dados e adiciona na tela
            snapshot.forEach((childSnapshot) => {
                const player = childSnapshot.val();
                const li = document.createElement('li');
                li.innerText = `🔥 ${player.nome}`;
                playersList.appendChild(li);
            });
        });
    } else {
        alert("O Bardo exige um nome antes de deixá-lo entrar!");
    }
});
