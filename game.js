const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const CELL_SIZE = 10;
let map_width, map_height;
let map = [];
let playerArea = new Set();

function init() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    map_width = Math.ceil(canvas.width / CELL_SIZE);
    map_height = Math.ceil(canvas.height / CELL_SIZE);
    
    map = Array(map_height).fill().map(() => Array(map_width).fill(0));

    const startX = Math.floor(map_width / 2);
    const startY = Math.floor(map_height / 2);
    
    map[startY][startX] = 1;
    playerArea.add(`${startX},${startY}`);
}

function expandOneLayer() {
    const newCells = [];
    const directions = [
        {x: 0, y: -1}, {x: 1, y: 0}, 
        {x: 0, y: 1}, {x: -1, y: 0}
    ];
    
    playerArea.forEach(cell => {
        const [x, y] = cell.split(',').map(Number);
        
        for (const dir of directions) {
            const nx = x + dir.x;
            const ny = y + dir.y;
            const key = `${nx},${ny}`;
            
            if (nx >= 0 && nx < map_width && 
                ny >= 0 && ny < map_height && 
                map[ny][nx] === 0) {
                
                map[ny][nx] = 1;
                newCells.push(key);
            }
        }
    });
    
    newCells.forEach(cell => playerArea.add(cell));
}

canvas.addEventListener('click', () => {
    expandOneLayer();
});

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < map_height; y++) {
        for (let x = 0; x < map_width; x++) {
            if (map[y][x] === 1) {
                ctx.fillStyle = '#FF5252';
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            ctx.strokeStyle = '#E0E0E0';
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }
    
    requestAnimationFrame(draw);
}

init();
draw();