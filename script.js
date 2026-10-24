/* =========================================================
   MARIO JUMP — versão melhorada
   Feito por Jarlisson Brito

   Como funciona (resumo):
   - Um "loop" roda ~60 vezes por segundo (requestAnimationFrame).
   - A cada quadro movemos os canos, aplicamos gravidade no Mario
     e testamos se as caixas de colisão se encostaram.
   - O tempo entre quadros (dt) deixa o jogo na mesma velocidade
     em qualquer computador.
   ========================================================= */

// ---------- Elementos da página ----------
const board        = document.getElementById('board');
const mario        = document.getElementById('mario');
const pipesBox     = document.getElementById('pipes');
const ground       = document.getElementById('ground');
const clouds       = document.getElementById('clouds');
const cloudsFar    = document.getElementById('clouds-far');
const scoreEl      = document.getElementById('score');
const levelEl      = document.getElementById('level');
const bestEl       = document.getElementById('best');
const levelUpEl    = document.getElementById('level-up');
const startScreen  = document.getElementById('start-screen');
const pauseScreen  = document.getElementById('pause-screen');
const overScreen   = document.getElementById('gameover-screen');
const finalScoreEl = document.getElementById('final-score');
const newRecordEl  = document.getElementById('new-record');
const btnRestart   = document.getElementById('btn-restart');
const btnPause     = document.getElementById('btn-pause');
const btnSound     = document.getElementById('btn-sound');

const MARIO_IMG    = 'assets/images/mario.gif';
const GAMEOVER_IMG = 'assets/images/game-over.png';

// ---------- Configurações do jogo ----------
const CONFIG = {
    baseSpeed: 430,          // velocidade dos canos (px/s) no nível 1, em tela de 900px
    speedPerLevel: 0.12,     // +12% de velocidade a cada nível
    maxSpeedMult: 2.3,       // limite de velocidade
    pointsPerLevel: 400,     // pontos para subir de nível
    jumpHeight: 0.52,        // altura do pulo segurando (fração da altura do tabuleiro)
    shortHop: 0.40,          // altura do pulo com um toque rápido (sempre passa qualquer cano)
    timeToPeak: 0.36,        // segundos até o topo do pulo
    marioSize: 130,          // largura do Mario em tela grande
    jumpBuffer: 0.12,        // segundos: apertar um pouco antes de cair ainda vale
};

// ---------- Estado ----------
let state = 'start';         // 'start' | 'playing' | 'paused' | 'dying' | 'over'
let pipes = [];
let score = 0;
let level = 1;
let best = loadBest();
let lastTime = 0;
let nextPipeIn = 0;          // distância (px) até o próximo cano
let cloudX = 0, cloudFarX = 0, groundX = 0;
let jumpPressedAt = -1;      // momento em que o jogador apertou pular
let holding = false;         // segurando o botão de pulo?
let soundOn = true;

// Medidas (atualizadas quando a janela muda de tamanho)
let W = 0, H = 0, groundH = 0, marioW = 0, marioLeft = 0, scale = 1;

const player = { y: 0, vy: 0, onGround: true };

// ---------- Utilidades ----------
const rand  = (min, max) => Math.random() * (max - min) + min;
const pad   = (n) => String(Math.floor(n)).padStart(5, '0');
const now   = () => performance.now() / 1000;

function loadBest() {
    try { return Number(localStorage.getItem('mario-jump-best')) || 0; }
    catch { return 0; }
}

function saveBest(value) {
    try { localStorage.setItem('mario-jump-best', String(value)); } catch { /* sem armazenamento */ }
}

function measure() {
    W = board.clientWidth;
    H = board.clientHeight;
    groundH = ground.offsetHeight;
    // tudo (Mario, canos, velocidade) cresce/diminui junto com o tabuleiro
    scale = Math.min(1, Math.max(0.5, Math.min(W / 900, H / 500)));
    if (state !== 'dying' && state !== 'over') {
        mario.style.width = `${CONFIG.marioSize * scale}px`;
        marioW = mario.offsetWidth;
        marioLeft = mario.offsetLeft;
    }
}

// Física do pulo calculada a partir da altura desejada
function gravity()  { return (2 * CONFIG.jumpHeight * H) / (CONFIG.timeToPeak ** 2); }
function jumpSpeed(){ return gravity() * CONFIG.timeToPeak; }

function currentSpeed() {
    const mult = Math.min(CONFIG.maxSpeedMult, 1 + CONFIG.speedPerLevel * (level - 1));
    return CONFIG.baseSpeed * mult * scale;
}

// ---------- Sons (gerados pelo navegador, sem arquivos) ----------
let audioCtx = null;

function beep(freqStart, freqEnd, duration, type = 'square', volume = 0.08, delay = 0) {
    if (!soundOn) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const t = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, t);
        osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + duration);
    } catch { /* navegador sem áudio */ }
}

const sounds = {
    jump:     () => beep(350, 900, 0.15),
    level:    () => [523, 659, 784, 1047].forEach((f, i) => beep(f, f, 0.12, 'square', 0.07, i * 0.09)),
    gameOver: () => [494, 392, 330, 262].forEach((f, i) => beep(f, f * 0.97, 0.22, 'triangle', 0.12, i * 0.18)),
};

// ---------- Canos ----------
function spawnPipe(offset = 0) {
    const width = rand(62, 92) * scale;
    // alguns canos mais altos, mas nunca mais altos que o pulo curto
    const maxH = H * 0.24;
    const height = Math.min(maxH, width * (375 / 293) * rand(0.85, 1.2));
    const img = document.createElement('img');
    img.src = 'assets/images/pipe.png';
    img.className = 'pipe';
    img.alt = '';
    img.draggable = false;
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    pipesBox.appendChild(img);

    const pipe = { el: img, x: W + offset, w: width, h: height };
    pipes.push(pipe);
    return pipe;
}

function scheduleNextPipe() {
    const speed = currentSpeed();
    // tempo entre canos diminui um pouco nos níveis altos
    const minT = Math.max(0.75, 1.05 - level * 0.04);
    const maxT = Math.max(1.3, 2.0 - level * 0.08);
    nextPipeIn = speed * rand(minT, maxT);

    // A partir do nível 3, às vezes aparece um cano duplo
    if (level >= 3 && Math.random() < 0.25) {
        const first = spawnPipe();
        const second = spawnPipe(first.w + 4 * scale);
        // cano duplo é sempre baixinho, para dar para pular
        [first, second].forEach(p => {
            p.h = Math.min(H * 0.2, p.w * (375 / 293) * 0.85);
            p.el.style.height = `${p.h}px`;
        });
        nextPipeIn += second.w + 4 * scale;
    } else {
        spawnPipe();
    }
}

function clearPipes() {
    pipes.forEach(p => p.el.remove());
    pipes = [];
}

// ---------- Colisão ----------
// A imagem do Mario tem espaço vazio em volta; usamos uma caixa menor e "justa".
function marioBox() {
    const bottom = groundH + player.y;
    return {
        left:   marioLeft + marioW * 0.26,
        right:  marioLeft + marioW * 0.76,
        bottom: bottom + marioW * 0.04,
        top:    bottom + marioW * 0.72,
    };
}

function hits(pipe, box) {
    const pLeft = pipe.x + pipe.w * 0.1;
    const pRight = pipe.x + pipe.w * 0.9;
    const pTop = groundH + pipe.h * 0.96;
    return box.right > pLeft && box.left < pRight && box.bottom < pTop;
}

// ---------- Controles ----------
function pressJump() {
    if (state === 'start') { startGame(); }
    else if (state === 'over') { startGame(); return; }
    else if (state === 'paused') { togglePause(); return; }
    if (state !== 'playing') return;
    holding = true;
    jumpPressedAt = now();
}

function releaseJump() {
    holding = false;
    // pulo variável: soltar cedo deixa o pulo mais baixo,
    // mas ele sempre chega pelo menos à altura do "pulo curto"
    if (state === 'playing' && player.vy > 0) cutJump();
}

function tryJump() {
    if (jumpPressedAt < 0) return;
    if (now() - jumpPressedAt > CONFIG.jumpBuffer) { jumpPressedAt = -1; return; }
    if (player.onGround) {
        player.vy = jumpSpeed();
        player.onGround = false;
        jumpPressedAt = -1;
        sounds.jump();
        if (!holding) cutJump(); // já soltou: pulo curto
    }
}

function cutJump() {
    const g = gravity();
    const target = CONFIG.shortHop * H;
    const peakNow = player.y + (player.vy ** 2) / (2 * g);
    if (peakNow <= target) return;
    const vyForTarget = Math.sqrt(2 * g * Math.max(0, target - player.y));
    player.vy = Math.min(player.vy, Math.max(vyForTarget, 0));
}

const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];

document.addEventListener('keydown', (e) => {
    if (JUMP_KEYS.includes(e.code)) {
        e.preventDefault();
        if (!e.repeat) pressJump();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
        togglePause();
    } else if (e.code === 'KeyM') {
        toggleSound();
    }
});

document.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.code)) releaseJump();
});

board.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    pressJump();
});
window.addEventListener('pointerup', releaseJump);
window.addEventListener('pointercancel', releaseJump);

btnRestart.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
btnPause.addEventListener('click', (e) => { e.currentTarget.blur(); togglePause(); });
btnSound.addEventListener('click', (e) => { e.currentTarget.blur(); toggleSound(); });

// Pausa sozinho se o jogador trocar de aba
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause();
});

window.addEventListener('resize', measure);

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        pauseScreen.classList.remove('hidden');
        btnPause.textContent = '▶';
    } else if (state === 'paused') {
        state = 'playing';
        pauseScreen.classList.add('hidden');
        btnPause.textContent = '❚❚';
        lastTime = 0; // evita um "salto" depois da pausa
    }
}

function toggleSound() {
    soundOn = !soundOn;
    btnSound.classList.toggle('off', !soundOn);
    btnSound.setAttribute('aria-label', soundOn ? 'Som ligado' : 'Som desligado');
}

// ---------- Início e fim ----------
function startGame() {
    clearPipes();
    score = 0;
    level = 1;
    holding = false;
    jumpPressedAt = -1;
    player.y = 0;
    player.vy = 0;
    player.onGround = true;

    mario.src = MARIO_IMG;

    board.className = 'game-board';

    startScreen.classList.add('hidden');
    overScreen.classList.add('hidden');
    pauseScreen.classList.add('hidden');
    btnPause.textContent = '❚❚';

    measure();
    nextPipeIn = W * 0.35;
    updateHud();
    state = 'playing';
    lastTime = 0;
}

function gameOver() {
    state = 'dying';
    sounds.gameOver();

    // troca a imagem do Mario pela de game over e faz ele "cair"
    mario.src = GAMEOVER_IMG;
    mario.style.width = `${CONFIG.marioSize * scale * 0.6}px`;
    player.vy = jumpSpeed() * 0.7;
    player.onGround = false;

    const final = Math.floor(score);
    const isRecord = final > best;
    if (isRecord) { best = final; saveBest(best); }
    finalScoreEl.textContent = final;
    newRecordEl.style.display = isRecord ? '' : 'none';
    updateHud();

    setTimeout(() => {
        state = 'over';
        overScreen.classList.remove('hidden');
    }, 1100);
}

function updateHud() {
    scoreEl.textContent = pad(score);
    levelEl.textContent = level;
    bestEl.textContent = pad(best);
}

function levelUp() {
    level++;
    levelUpEl.textContent = `NÍVEL ${level}!`;
    levelUpEl.classList.remove('show');
    void levelUpEl.offsetWidth; // reinicia a animação
    levelUpEl.classList.add('show');
    board.className = `game-board sky-${Math.min(level, 5)}`;
    sounds.level();
}

// ---------- Loop principal ----------
function update(dt) {
    const speed = currentSpeed();

    // Mario: gravidade + pulo
    tryJump();
    if (!player.onGround) {
        player.vy -= gravity() * dt;
        player.y += player.vy * dt;
        if (player.y <= 0) {
            player.y = 0;
            player.vy = 0;
            player.onGround = true;
            tryJump(); // pulo "guardado" no buffer
        }
    }

    // Canos
    nextPipeIn -= speed * dt;
    if (nextPipeIn <= 0) scheduleNextPipe();

    const box = marioBox();
    for (const pipe of pipes) {
        pipe.x -= speed * dt;
        if (hits(pipe, box)) { gameOver(); return; }
    }
    // remove canos que saíram da tela
    pipes = pipes.filter(p => {
        if (p.x + p.w < -10) { p.el.remove(); return false; }
        return true;
    });

    // Fundo
    cloudX += speed * 0.12 * dt;
    cloudFarX += speed * 0.05 * dt;
    groundX += speed * dt;

    // Pontos e nível
    score += dt * 10 * (1 + 0.15 * (level - 1)); // ~10 pontos por segundo
    if (score >= level * CONFIG.pointsPerLevel) levelUp();
    updateHud();
}

function updateDying(dt) {
    player.vy -= gravity() * dt;
    player.y += player.vy * dt;
}

function render() {
    mario.style.bottom = `${groundH + player.y}px`;
    if (state === 'dying' || state === 'over') {
        mario.style.zIndex = 5; // cai por cima do chão
    } else {
        mario.style.zIndex = '';
    }
    for (const pipe of pipes) pipe.el.style.transform = `translateX(${pipe.x}px)`;
    clouds.style.backgroundPositionX = `${-cloudX}px`;
    cloudsFar.style.backgroundPositionX = `${-cloudFarX}px`;
    ground.style.backgroundPositionX = `${-groundX}px`;
}

function loop(t) {
    const time = t / 1000;
    const dt = lastTime ? Math.min(time - lastTime, 1 / 30) : 0; // limita dt para não atravessar canos
    lastTime = time;

    if (state === 'playing') update(dt);
    else if (state === 'dying') updateDying(dt);
    else if (state === 'start') { cloudX += 20 * dt; cloudFarX += 8 * dt; }

    render();
    requestAnimationFrame(loop);
}

// ---------- Começo ----------
newRecordEl.style.display = 'none';
measure();
updateHud();
requestAnimationFrame(loop);
