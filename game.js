const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('menu');
const infoPanel = document.getElementById('infoPanel');
const popCountEl = document.getElementById('popCount');
const popCapEl = document.getElementById('popCap');
const growthRateEl = document.getElementById('growthRateText');
const territoryPercentEl = document.getElementById('territoryPercent');
const startButton = document.getElementById('startButton');

let CELL_SIZE = 20;
const BASE_POPULATION_CAP = 100;
const POPULATION_PER_CELL = 5;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 200;

let BASE_GROWTH_RATE = 1.0;
let map = [];
let playerArea = new Set();
let currentPopulation = 10;
let territoryColor = '#4CAF50';

let cameraX = 0, cameraY = 0;
let isDragging = false;
let lastMouseX = 0, lastMouseY = 0;

function initGame() {
    applySettings();
    resizeCanvas();
    generateMap();
    spawnPlayer();
    infoPanel.style.display = 'block';
    requestAnimationFrame(gameLoop);
}

function applySettings() {
    const size = document.getElementById('mapSize').value;
    CELL_SIZE = size === 'small' ? 30 : size === 'large' ? 10 : 20;
    territoryColor = document.getElementById('territoryColor').value;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function generateMap() {
    map = Array.from({ length: MAP_HEIGHT }, () =>
        Array.from({ length: MAP_WIDTH }, () => 0)
    );
}

function spawnPlayer() {
    const x = Math.floor(MAP_WIDTH / 2);
    const y = Math.floor(MAP_HEIGHT / 2);
    map[y][x] = 1;
    playerArea.add(`${x},${y}`);
}

function getPopulationCap() {
    return BASE_POPULATION_CAP + playerArea.size * POPULATION_PER_CELL;
}

function calculateGrowthRate() {
    const cap = getPopulationCap();
    const ratio = currentPopulation / cap;
    if (cap === 0) return 0;

    if (ratio >= 1) return 0;
    if (ratio < 0.3) return BASE_GROWTH_RATE * 0.5;
    if (ratio < 0.7) return BASE_GROWTH_RATE;
    return BASE_GROWTH_RATE * (1.2 - ratio); // плавное замедление
}

function updatePopulation(dt) {
    const cap = getPopulationCap();
    const rate = calculateGrowthRate();
    if (currentPopulation < cap) {
        currentPopulation += rate * dt / 1000;
        if (currentPopulation > cap) currentPopulation = cap;
    }
}

function startExpansion() {
    if (currentPopulation < 10) return;
    const borders = getBorderCells();
    const budget = Math.min(Math.floor(currentPopulation * 0.2), borders.size);
    let count = 0;
    for (let cell of borders) {
        if (count >= budget) break;
        const [x, y] = cell.split(',').map(Number);
        map[y][x] = 1;
        playerArea.add(cell);
        count++;
    }
    currentPopulation -= count;
}

function getBorderCells() {
    const set = new Set();
    const dirs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
    for (let cell of playerArea) {
        const [x, y] = cell.split(',').map(Number);
        for (let d of dirs) {
            const nx = x + d.x;
            const ny = y + d.y;
            if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
                if (map[ny][nx] === 0) {
                    set.add(`${nx},${ny}`);
                }
            }
        }
    }
    return set;
}

function draw() {
    ctx.fillStyle = '#333'; // фон
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = territoryColor;
    playerArea.forEach(cell => {
        const [x, y] = cell.split(',').map(Number);
        const drawX = x * CELL_SIZE + cameraX;
        const drawY = y * CELL_SIZE + cameraY;
        ctx.fillRect(drawX, drawY, CELL_SIZE, CELL_SIZE);
    });

    // UI
    const cap = getPopulationCap();
    const rate = calculateGrowthRate();
    const percent = ((playerArea.size / (MAP_WIDTH * MAP_HEIGHT)) * 100).toFixed(2);

    popCountEl.textContent = Math.floor(currentPopulation);
    popCapEl.textContent = cap;
    growthRateEl.textContent = rate.toFixed(2);
    territoryPercentEl.textContent = percent;
}

function gameLoop(ts) {
    if (!window.lastTime) window.lastTime = ts;
    const dt = ts - window.lastTime;
    window.lastTime = ts;

    updatePopulation(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

// События
canvas.addEventListener('mousedown', e => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});
canvas.addEventListener('mousemove', e => {
    if (isDragging) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        cameraX += dx;
        cameraY += dy;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mouseleave', () => isDragging = false);
canvas.addEventListener('click', startExpansion);

window.addEventListener('resize', resizeCanvas);

startButton.addEventListener('click', () => {
    menu.style.display = 'none';
    initGame();
});