class Entity {
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.population = popStart;
        this.area = new Set(); // Numeric indices
        this.minGrowth = minGrowth;
        this.maxGrowth = maxGrowth;
        this.expandAction = null;
        this.attackActions = new Map(); // Поддержка нескольких атак
        this.incomingAttacks = new Map(); // Отслеживание входящих атак
        this.labelInfo = null;
        this.areaChanged = true;
        this.borderCells = { emptyBorders: new Set(), enemyBorders: new Set() };
    }

    getPopulationCap() {
        const BASE_POP = 100;
        const POP_PER_CELL = 5;
        return BASE_POP + this.area.size * POP_PER_CELL;
    }

    updatePopulation(dt) {
        const P = this.population;
        const Pmax = this.getPopulationCap();
        if (Pmax <= 0) return;
        const frac = (4 * P * (Pmax - P)) / (Pmax * Pmax);
        const rate = this.minGrowth + (this.maxGrowth - this.minGrowth) * frac;
        const dPdt = rate * P;
        this.population += dPdt * (dt / 1000);
        if (this.population > Pmax) this.population = Pmax;
        if (this.population < 0) this.population = 0;
    }

    getBorderCells(game) {
        if (this.areaChanged) {
            this._computeBorderCells(game);
            this.areaChanged = false;
        }
        return this.borderCells;
    }

    _computeBorderCells(game) {
        this.borderCells = { emptyBorders: new Set(), enemyBorders: new Set() };
        this.area.forEach((index) => {
            const neighbors = game._getNeighbors(index);
            neighbors.forEach((nIndex) => {
                const nOwner = game.map[Math.floor(nIndex / game.mapWidth)][nIndex % game.mapWidth];
                if (nOwner === 0) {
                    this.borderCells.emptyBorders.add(nIndex);
                } else if (nOwner !== this.id) {
                    this.borderCells.enemyBorders.add(nIndex);
                }
            });
        });
    }
}

class Player extends Entity {
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        super(id, name, color, popStart, minGrowth, maxGrowth);
    }
}

class Bot extends Entity {
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        super(id, name, color, popStart, minGrowth, maxGrowth);
    }
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.CELL_SIZE = 40;
        this.map = [];
        this.entities = {};
        this.playerId = 1;
        this.nextBotId = 2;
        this.GLOBAL_MIN_GROWTH = 0.02;
        this.GLOBAL_MAX_GROWTH = 0.10;
        this.BOT_EXPANSION_PERCENT = 0.20;
        this.zoomLevel = 1.0;
        this.minZoom = 0.1;
        this.MAX_ZOOM = 20.0;
        this.cameraX = 0;
        this.cameraY = 0;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.lastTime = 0;
        this.leaderTimer = 0;
        this.lastRender = 0;
        this.botDecideTimer = 0;
        this.isGameOver = false;
        this.offscreenCanvas = null;
        this.offscreenCtx = null;
        this.dirtyCells = new Set();
        this.sendPercent = 20; // Значение по умолчанию для ползунка
        this.worker = new Worker(URL.createObjectURL(new Blob([`
            self.onmessage = function(e) {
                const botStates = e.data;
                const actions = {};
                for (const botId in botStates) {
                    const state = botStates[botId];
                    const P = state.population;
                    const Pmax = state.populationCap;
                    if (P < 0.6 * Pmax) {
                        actions[botId] = null;
                        continue;
                    }
                    if (state.emptyBorders.length > 0) {
                        const budget = Math.floor(P * 0.2);
                        actions[botId] = { type: 'expandEmpty', budget: budget };
                    } else if (state.enemyBorders.length > 0) {
                        const targetCell = state.enemyBorders[0];
                        const targetBotId = state.enemyOwners[targetCell];
                        const budget = Math.floor(P * 0.2);
                        actions[botId] = { type: 'attackBot', targetBotId: targetBotId, budget: budget };
                    } else {
                        actions[botId] = null;
                    }
                }
                self.postMessage(actions);
            };
        `], { type: 'application/javascript' })));
        this.worker.onmessage = this._handleWorkerMessage.bind(this);
        this._bindUIElements();
        this._attachEventListeners();
    }

    _bindUIElements() {
        this.menuElem = document.getElementById('menu');
        this.guideElem = document.getElementById('guide');
        this.startButton = document.getElementById('startButton');
        this.guideButton = document.getElementById('guideButton');
        this.backButton = document.getElementById('backButton');
        this.playerNameInput = document.getElementById('playerName');
        this.botDifficultySelect = document.getElementById('botDifficulty');
        this.mapSizeSelect = document.getElementById('mapSize');
        this.themeSelect = document.getElementById('themeSelect');
        this.sendPercentInput = document.getElementById('sendPercent');
        this.sendPercentValue = document.getElementById('sendPercentValue');
    }

    _attachEventListeners() {
        this.startButton.addEventListener('click', () => this._handleStart());
        this.guideButton.addEventListener('click', () => {
            this.menuElem.style.display = 'none';
            this.guideElem.style.display = 'flex';
        });
        this.backButton.addEventListener('click', () => {
            this.guideElem.style.display = 'none';
            this.menuElem.style.display = 'flex';
        });
        let lastZoomTime = 0;
        const ZOOM_COOLDOWN = 100;
        this.canvas.addEventListener('wheel', (e) => {
            const now = Date.now();
            if (now - lastZoomTime < ZOOM_COOLDOWN) return;
            lastZoomTime = now;
            this._handleZoom(e);
        });
        this.canvas.addEventListener('mousedown', (e) => this._startPan(e));
        this.canvas.addEventListener('mousemove', (e) => this._pan(e));
        this.canvas.addEventListener('mouseup', () => this._endPan());
        this.canvas.addEventListener('mouseleave', () => this._endPan());
        this.canvas.addEventListener('click', (e) => this._handlePlayerClick(e));
        this.sendPercentInput.addEventListener('input', () => {
            this.sendPercent = parseInt(this.sendPercentInput.value, 10);
            this.sendPercentValue.textContent = `${this.sendPercent}%`;
        });
        window.addEventListener('resize', () => {
            this._resizeCanvas();
            this._recalcMinZoom();
            this._clampCamera();
        });
    }

    _handleStart() {
        const playerName = this.playerNameInput.value.trim() || 'Игрок';
        this.menuElem.style.display = 'none';
        this.initGame(playerName);
    }

    initGame(playerName) {
        this.isGameOver = false;
        this._applySettings();
        this._resizeCanvas();
        this._recalcMinZoom();
        this._generateMapArray();
        this.offscreenCanvas = new OffscreenCanvas(this.mapWidth * this.CELL_SIZE, this.mapHeight * this.CELL_SIZE);
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        this._initEntities(playerName);
        this._renderFullMap();
        this._clampCamera();
        requestAnimationFrame((timestamp) => this._gameLoop(timestamp));
    }

    _applySettings() {
        const size = this.mapSizeSelect.value;
        if (size === 'small') {
            this.mapWidth = 100;
            this.mapHeight = 75;
        } else if (size === 'medium') {
            this.mapWidth = 250;
            this.mapHeight = 188;
        } else {
            this.mapWidth = 500;
            this.mapHeight = 375;
        }
    }

    _resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    _recalcMinZoom() {
        const zoomX = this.canvas.width / (this.mapWidth * this.CELL_SIZE);
        const zoomY = this.canvas.height / (this.mapHeight * this.CELL_SIZE);
        this.minZoom = Math.min(zoomX, zoomY, 1) * 0.5;
        if (this.zoomLevel < this.minZoom) this.zoomLevel = this.minZoom;
    }

    _generateMapArray() {
        this.map = Array.from({ length: this.mapHeight }, () => 
            Array.from({ length: this.mapWidth }, () => 0)
        );
    }

    _initEntities(playerName) {
        this.entities = {};
        this.nextBotId = 2;
        const startPopPlayer = 1000;
        const botParams = this._getBotParameters();
        const centerX = Math.floor(this.mapWidth / 2);
        const centerY = Math.floor(this.mapHeight / 2);
        const player = new Player(
            this.playerId,
            playerName,
            '#4CAF50',
            startPopPlayer,
            this.GLOBAL_MIN_GROWTH,
            this.GLOBAL_MAX_GROWTH
        );
        this.entities[this.playerId] = player;
        const playerIndex = centerY * this.mapWidth + centerX;
        this.map[centerY][centerX] = this.playerId;
        player.area.add(playerIndex);
        this.dirtyCells.add(playerIndex);
        let botCount = { small: 5, medium: 10, large: 20 }[this.mapSizeSelect.value];
        const getRandomColor = () => '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
        const occupied = [{ x: centerX, y: centerY }];
        const isFarEnough = (x, y) => occupied.every(p => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) >= 2);
        const getRandomSpawn = () => {
            for (let i = 0; i < 10000; i++) {
                const x = Math.floor(Math.random() * this.mapWidth);
                const y = Math.floor(Math.random() * this.mapHeight);
                if (this.map[y][x] === 0 && isFarEnough(x, y)) return { x, y };
            }
            return { x: centerX, y: centerY };
        };
        for (let i = 0; i < botCount; i++) {
            const id = this.nextBotId++;
            const bot = new Bot(
                id,
                `Бот ${i + 1}`,
                getRandomColor(),
                botParams.popStart,
                botParams.minG,
                botParams.maxG
            );
            this.entities[id] = bot;
            const { x: bx, y: by } = getRandomSpawn();
            const botIndex = by * this.mapWidth + bx;
            this.map[by][bx] = id;
            bot.area.add(botIndex);
            this.dirtyCells.add(botIndex);
            occupied.push({ x: bx, y: by });
        }
    }

    _getBotParameters() {
        const diff = this.botDifficultySelect.value;
        return {
            easy: { minG: 0.025, maxG: 0.10, popStart: 800 },
            medium: { minG: 0.02, maxG: 0.10, popStart: 900 },
            hard: { minG: 0.03, maxG: 0.12, popStart: 1000 }
        }[diff];
    }

    _gameLoop(ts) {
        if (this.isGameOver) return;
        requestAnimationFrame((timestamp) => this._gameLoop(timestamp));
        if (!this.lastTime) this.lastTime = ts;
        const dt = ts - this.lastTime;
        for (const id in this.entities) {
            this.entities[id].updatePopulation(dt);
        }
        this.botDecideTimer += dt;
        if (this.botDecideTimer >= 1000) {
            const botStates = {};
            for (const id in this.entities) {
                const entId = parseInt(id, 10);
                if (entId !== this.playerId) {
                    const bot = this.entities[id];
                    const borderCells = bot.getBorderCells(this);
                    const enemyOwners = {};
                    borderCells.enemyBorders.forEach(index => {
                        const y = Math.floor(index / this.mapWidth);
                        const x = index % this.mapWidth;
                        enemyOwners[index] = this.map[y][x];
                    });
                    botStates[id] = {
                        population: bot.population,
                        populationCap: bot.getPopulationCap(),
                        emptyBorders: Array.from(borderCells.emptyBorders),
                        enemyBorders: Array.from(borderCells.enemyBorders),
                        enemyOwners: enemyOwners
                    };
                }
            }
            this.worker.postMessage(botStates);
            this.botDecideTimer = 0;
        }
        for (const id in this.entities) {
            this._processEntityActions(this.entities[id], ts);
        }
        this._updateLeaderboard(dt);
        if (ts - this.lastRender >= 1000 / 30) {
            this._draw();
            this.lastRender = ts;
        }
        this.lastTime = ts;
    }

    _handleWorkerMessage(e) {
        const actions = e.data;
        for (const botId in actions) {
            const action = actions[botId];
            if (action) {
                const bot = this.entities[botId];
                if (action.type === 'expandEmpty') {
                    bot.expandAction = {
                        type: 'expandEmpty',
                        budget: action.budget,
                        lastStepTime: 0,
                        stepInterval: 15
                    };
                    bot.population -= action.budget;
                    if (bot.population < 0) {
                        bot.expandAction.budget += bot.population;
                        bot.population = 0;
                    }
                } else if (action.type === 'attackBot') {
                    const existingAttack = bot.attackActions.get(action.targetBotId);
                    const budget = action.budget;
                    const stepInterval = this._calculateAttackInterval(budget, bot.population + budget, bot.getPopulationCap());
                    if (existingAttack) {
                        existingAttack.budget += budget;
                        existingAttack.stepInterval = Math.min(existingAttack.stepInterval, stepInterval);
                    } else {
                        bot.attackActions.set(action.targetBotId, {
                            type: 'attackBot',
                            targetBotId: action.targetBotId,
                            budget: budget,
                            lastStepTime: 0,
                            stepInterval: stepInterval
                        });
                    }
                    bot.population -= budget;
                    if (bot.population < 0) {
                        bot.attackActions.get(action.targetBotId).budget += bot.population;
                        bot.population = 0;
                    }
                }
            }
        }
    }

    _processEntityActions(entity, ts) {
        const exp = entity.expandAction;
        if (exp && exp.budget > 0) {
            if (ts - exp.lastStepTime >= exp.stepInterval) {
                const { emptyBorders } = entity.getBorderCells(this);
                if (emptyBorders.size === 0) {
                    const newPopulation = Math.min(entity.population + exp.budget, entity.getPopulationCap());
                    entity.population = newPopulation;
                    entity.expandAction = null;
                } else {
                    const index = emptyBorders.values().next().value;
                    const y = Math.floor(index / this.mapWidth);
                    const x = index % this.mapWidth;
                    if (this.map[y][x] === 0) {
                        this.map[y][x] = entity.id;
                        entity.area.add(index);
                        entity.population = Math.max(0, entity.population - 1);
                        entity.areaChanged = true;
                        this.dirtyCells.add(index);
                    }
                    exp.budget--;
                    if (exp.budget <= 0) entity.expandAction = null;
                    entity.labelInfo = null;
                    exp.lastStepTime = ts;
                }
            }
        }
        entity.attackActions.forEach((atk, targetBotId) => {
            if (atk && atk.budget > 0) {
                if (ts - atk.lastStepTime >= atk.stepInterval) {
                    const { enemyBorders } = entity.getBorderCells(this);
                    const candidates = Array.from(enemyBorders).filter(index => 
                        this.map[Math.floor(index / this.mapWidth)][index % this.mapWidth] === targetBotId
                    );
                    if (candidates.length === 0) {
                        const newPopulation = Math.min(entity.population + atk.budget, entity.getPopulationCap());
                        entity.population = newPopulation;
                        entity.attackActions.delete(targetBotId);
                    } else {
                        const index = candidates[0];
                        this._resolveBattle(entity.id, targetBotId, index);
                        atk.budget--;
                        if (atk.budget <= 0) entity.attackActions.delete(targetBotId);
                    }
                    atk.lastStepTime = ts;
                }
            }
        });
    }

    _getNeighbors(index) {
        const x = index % this.mapWidth;
        const y = Math.floor(index / this.mapWidth);
        const neighbors = [];
        if (x > 0) neighbors.push(index - 1);
        if (x < this.mapWidth - 1) neighbors.push(index + 1);
        if (y > 0) neighbors.push(index - this.mapWidth);
        if (y < this.mapHeight - 1) neighbors.push(index + this.mapWidth);
        return neighbors;
    }

    _calculateAttackInterval(budget, population, populationCap) {
        const baseInterval = 15;
        const midSpeedInterval = 10;
        const maxSpeedInterval = 7.5;
        const halfPopulation = population * 0.5;
        let targetInterval;
        if (budget <= halfPopulation) {
            targetInterval = baseInterval;
        } else if (budget < populationCap) {
            const t = (budget - halfPopulation) / (populationCap - halfPopulation);
            targetInterval = baseInterval - (baseInterval - midSpeedInterval) * t;
        } else {
            const excess = budget - populationCap;
            const maxExcess = populationCap;
            const t = Math.min(excess / maxExcess, 1);
            targetInterval = midSpeedInterval - (midSpeedInterval - maxSpeedInterval) * t;
        }
        return targetInterval;
    }

    _handlePlayerClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clickX = Math.floor((e.clientX - rect.left - this.cameraX) / (this.CELL_SIZE * this.zoomLevel));
        const clickY = Math.floor((e.clientY - rect.top - this.cameraY) / (this.CELL_SIZE * this.zoomLevel));
        if (clickX < 0 || clickX >= this.mapWidth || clickY < 0 || clickY >= this.mapHeight) return;
        const clickedOwner = this.map[clickY][clickX];
        const player = this.entities[this.playerId];
        const { emptyBorders, enemyBorders } = player.getBorderCells(this);
        const clickIndex = clickY * this.mapWidth + clickX;

        const minPopulation = 0.05 * player.getPopulationCap();

        if (clickedOwner !== 0 && clickedOwner !== this.playerId) {
            const candidates = Array.from(enemyBorders).filter(index => 
                this.map[Math.floor(index / this.mapWidth)][index % this.mapWidth] === clickedOwner
            );
            if (candidates.length > 0) {
                const budgetTotal = Math.floor(player.population * (this.sendPercent / 100));
                if (budgetTotal <= 0 || player.population - budgetTotal < minPopulation) return;
                player.population -= budgetTotal;
                const existingAttack = player.attackActions.get(clickedOwner);
                const stepInterval = this._calculateAttackInterval(budgetTotal, player.population + budgetTotal, player.getPopulationCap());
                if (existingAttack) {
                    existingAttack.budget += budgetTotal;
                    existingAttack.stepInterval = Math.min(existingAttack.stepInterval, stepInterval);
                } else {
                    player.attackActions.set(clickedOwner, {
                        type: 'attackBot',
                        targetBotId: clickedOwner,
                        budget: budgetTotal,
                        lastStepTime: 0,
                        stepInterval: stepInterval
                    });
                }
            }
            return;
        }
        if (clickedOwner === 0 && emptyBorders.size > 0) {
            const budgetTotal = Math.floor(player.population * (this.sendPercent / 100));
            if (budgetTotal <= 0 || player.population - budgetTotal < minPopulation) return;
            player.population -= budgetTotal;
            if (player.expandAction) {
                player.expandAction.budget += budgetTotal;
            } else {
                player.expandAction = {
                    type: 'expandEmpty',
                    budget: budgetTotal,
                    lastStepTime: 0,
                    stepInterval: 15
                };
            }
        }
    }

    _resolveBattle(attackerId, defenderId, cellIndex) {
        const attacker = this.entities[attackerId];
        const defender = this.entities[defenderId];
        const y = Math.floor(cellIndex / this.mapWidth);
        const x = cellIndex % this.mapWidth;
        attacker.population = Math.max(0, attacker.population - 1);
        this.map[y][x] = attackerId;
        attacker.area.add(cellIndex);
        defender.area.delete(cellIndex);
        attacker.areaChanged = true;
        defender.areaChanged = true;
        this.dirtyCells.add(cellIndex);
        if (defender.labelInfo) defender.labelInfo = null;
        if (attacker.labelInfo) attacker.labelInfo = null;
    }

    _updateLeaderboard(dt) {
        this.leaderTimer += dt;
        if (this.leaderTimer < 5000) return;
        this.leaderTimer = 0;
        this.leaderStats = Object.values(this.entities).map(ent => ({
            name: ent.name,
            territoryPct: (ent.area.size / (this.mapWidth * this.mapHeight)) * 100,
            population: Math.floor(ent.population),
            color: ent.color
        })).sort((a, b) => b.territoryPct - a.territoryPct || b.population - a.population).slice(0, 5);
        this._checkVictory();
    }

    _checkVictory() {
        const totalCells = this.mapWidth * this.mapHeight;
        for (const id in this.entities) {
            const ent = this.entities[id];
            if (ent.area.size / totalCells >= 0.8) {
                this.isGameOver = true;
                alert(parseInt(id) === this.playerId ? 
                    'Поздравляем! Вы захватили 80% карты и выиграли!' : 
                    `К сожалению, бот "${ent.name}" занял 80% карты. Вы проиграли.`
                );
                return;
            }
        }
    }

    _renderFullMap() {
        this.offscreenCtx.fillStyle = varGet('--canvas-empty');
        this.offscreenCtx.fillRect(0, 0, this.mapWidth * this.CELL_SIZE, this.mapHeight * this.CELL_SIZE);
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                const owner = this.map[y][x];
                if (owner !== 0) {
                    this.offscreenCtx.fillStyle = this.entities[owner].color;
                    this.offscreenCtx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                }
            }
        }
    }

    _draw() {
        this.ctx.fillStyle = varGet('--canvas-bg');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Update dirty cells
        this.dirtyCells.forEach(index => {
            const x = index % this.mapWidth;
            const y = Math.floor(index / this.mapWidth);
            const owner = this.map[y][x];
            this.offscreenCtx.fillStyle = owner === 0 ? varGet('--canvas-empty') : this.entities[owner].color;
            this.offscreenCtx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
        });
        this.dirtyCells.clear();

        // Draw map
        this.ctx.save();
        this.ctx.translate(this.cameraX, this.cameraY);
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);

        // Draw borders and labels
        for (const id in this.entities) {
            const ent = this.entities[id];
            ent.area.forEach(index => {
                const x = index % this.mapWidth;
                const y = Math.floor(index / this.mapWidth);
                const neighbors = this._getNeighbors(index);
                if (neighbors.some(n => this.map[Math.floor(n / this.mapWidth)][n % this.mapWidth] !== ent.id)) {
                    this.ctx.strokeStyle = ent.id === this.playerId ? varGet('--border-player') : varGet('--border-bot');
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                }
            });
            if (ent.area.size > 0) {
                if (!ent.labelInfo) {
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    ent.area.forEach(index => {
                        const x = index % this.mapWidth;
                        const y = Math.floor(index / this.mapWidth);
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    });
                    const centerX = ((minX + maxX + 1) / 2) * this.CELL_SIZE;
                    const centerY = ((minY + maxY + 1) / 2) * this.CELL_SIZE;
                    const boxWidth = (maxX - minX + 1) * this.CELL_SIZE;
                    const boxHeight = (maxY - minY + 1) * this.CELL_SIZE;
                    const fontSize = Math.max(8, Math.floor(Math.min(boxWidth / (ent.name.length * 0.6), boxHeight * 0.5) * 1.2));
                    ent.labelInfo = { x: centerX, y: centerY, size: fontSize, minX, maxX };
                }
                this.ctx.font = `${ent.labelInfo.size}px Arial`;
                this.ctx.fillStyle = varGet('--text-color');
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';

                const textWidth = this.ctx.measureText(ent.name).width;
                const textLeft = ent.labelInfo.x - textWidth / 2;
                const textRight = ent.labelInfo.x + textWidth / 2;
                const stateLeft = ent.labelInfo.minX * this.CELL_SIZE;
                const stateRight = (ent.labelInfo.maxX + 1) * this.CELL_SIZE;

                if (textLeft < stateLeft || textRight > stateRight) {
                    const availableWidth = (ent.labelInfo.maxX - ent.labelInfo.minX + 1) * this.CELL_SIZE;
                    let truncatedText = ent.name;
                    while (this.ctx.measureText(truncatedText + '...').width > availableWidth && truncatedText.length > 0) {
                        truncatedText = truncatedText.slice(0, -1);
                    }
                    if (truncatedText.length < ent.name.length) {
                        truncatedText += '...';
                    }
                    this.ctx.fillText(truncatedText, ent.labelInfo.x, ent.labelInfo.y);
                } else {
                    this.ctx.fillText(ent.name, ent.labelInfo.x, ent.labelInfo.y);
                }
            }
        }
        this.ctx.restore();

        // Draw HUD
        const player = this.entities[this.playerId];
        const Pmax = player.getPopulationCap();
        const P = player.population;
        const frac = (4 * P * (Pmax - P)) / (Pmax * Pmax);
        const rate = player.minGrowth + (player.maxGrowth - player.minGrowth) * frac;
        this.ctx.fillStyle = varGet('--text-color');
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(`Игрок: ${player.name}`, 10, 10);
        this.ctx.fillText(`Популяция: ${Math.floor(P)} / ${Pmax}`, 10, 30);
        this.ctx.fillText(`Рост: ${(rate * 100).toFixed(2)}%`, 10, 50);
        this.ctx.fillText(`Территория: ${((player.area.size / (this.mapWidth * this.mapHeight)) * 100).toFixed(2)}%`, 10, 70);

        if (this.leaderStats) {
            this.ctx.textAlign = 'right';
            this.ctx.fillText('Лидеры:', this.canvas.width - 10, 10);
            this.leaderStats.forEach((s, i) => {
                this.ctx.fillStyle = s.color;
                this.ctx.fillRect(this.canvas.width - 150, 30 + i * 20, 10, 10);
                this.ctx.fillStyle = varGet('--text-color');
                this.ctx.fillText(`${s.name}: ${s.territoryPct.toFixed(2)}% (${s.population})`, this.canvas.width - 20, 35 + i * 20);
            });
        }

        this.ctx.textAlign = 'left';
        const wars = [];
        const exp = player.expandAction;
        if (exp && exp.budget > 0) wars.push(`Игрок: ${exp.budget} в расширении`);
        player.attackActions.forEach((atk, targetBotId) => {
            if (atk && atk.budget > 0) {
                wars.push(`Игрок: ${atk.budget} в атаке на ${this.entities[targetBotId]?.name || 'бот'}`);
            }
        });
        for (const id in this.entities) {
            if (id == this.playerId) continue;
            const bot = this.entities[id];
            bot.attackActions.forEach((atk, targetBotId) => {
                if (atk && atk.budget > 0 && targetBotId === this.playerId) {
                    wars.push(`${bot.name}: ${atk.budget} в атаке на Игрок`);
                }
            });
        }
        if (wars.length) {
            this.ctx.fillText('Войны:', 10, this.canvas.height - 20 - wars.length * 20);
            wars.forEach((w, i) => this.ctx.fillText(w, 10, this.canvas.height - 20 - (wars.length - 1 - i) * 20));
        }
    }

    _handleZoom(e) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.MAX_ZOOM, this.zoomLevel * factor));
        this._clampCamera();
    }

    _startPan(e) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    }

    _pan(e) {
        if (!this.isDragging) return;
        this.cameraX += e.clientX - this.lastMouseX;
        this.cameraY += e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this._clampCamera();
    }

    _endPan() {
        this.isDragging = false;
    }

    _clampCamera() {
        const mapW = this.mapWidth * this.CELL_SIZE * this.zoomLevel;
        const mapH = this.mapHeight * this.CELL_SIZE * this.zoomLevel;
        if (mapW >= this.canvas.width) {
            this.cameraX = Math.max(this.canvas.width - mapW, Math.min(0, this.cameraX));
        } else {
            this.cameraX = Math.max(0, Math.min(this.canvas.width - mapW, this.cameraX));
        }
        if (mapH >= this.canvas.height) {
            this.cameraY = Math.max(this.canvas.height - mapH, Math.min(0, this.cameraY));
        } else {
            this.cameraY = Math.max(0, Math.min(this.canvas.height - mapH, this.cameraY));
        }
    }
}

function varGet(variable) {
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

window.addEventListener('DOMContentLoaded', () => new Game());