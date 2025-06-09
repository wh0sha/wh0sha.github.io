class Entity {
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        this.id = id;
        this.name = name.slice(0, 10); // ограничиваем 10 символами
        this.color = color;
        this.population = popStart;
        this.area = new Set();
        this.minGrowth = minGrowth;
        this.maxGrowth = maxGrowth;
        this.expandAction = null;
        this.attackActions = new Map();
        this.incomingAttacks = new Map();
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
        this.area.forEach(index => {
            const neighbors = game._getNeighbors(index);
            neighbors.forEach(nIndex => {
                const owner = game.map[Math.floor(nIndex / game.mapWidth)][nIndex % game.mapWidth];
                if (owner === 0) {
                    this.borderCells.emptyBorders.add(nIndex);
                } else if (owner !== this.id) {
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
        this.ctx = this.canvas?.getContext('2d');
        this.mapWidth = this.mapHeight = 0;
        this.CELL_SIZE = 40;
        this.map = [];
        this.entities = {};
        this.playerId = 1;
        this.nextBotId = 2;
        this.GLOBAL_MIN_GROWTH = 0.02;
        this.GLOBAL_MAX_GROWTH = 0.10;
        this.zoomLevel = 1.0;
        this.minZoom = 0.1;
        this.MAX_ZOOM = 20.0;
        this.cameraX = this.cameraY = 0;
        this.isDragging = false;
        this.lastMouseX = this.lastMouseY = 0;
        this.lastTime = this.leaderTimer = this.lastRender = this.botDecideTimer = 0;
        this.isGameOver = false;
        this.offscreenCanvas = null;
        this.offscreenCtx = null;
        this.dirtyCells = new Set();
        this.sendPercent = 20;

        const blob = new Blob([`
            self.onmessage = function(e) {
                const botStates = e.data, actions = {};
                for (const botId in botStates) {
                    const state = botStates[botId];
                    const P = state.population, Pmax = state.populationCap;
                    if (P < 0.6 * Pmax) { actions[botId] = null; continue; }
                    if (state.emptyBorders.length > 0) {
                        actions[botId] = { type: 'expandEmpty', budget: Math.floor(P * 0.2) };
                    } else if (state.enemyBorders.length > 0) {
                        const cell = state.enemyBorders[0];
                        actions[botId] = { type: 'attackBot', targetBotId: state.enemyOwners[cell], budget: Math.floor(P * 0.2) };
                    } else {
                        actions[botId] = null;
                    }
                }
                self.postMessage(actions);
            };
        `], { type: 'application/javascript' });
        this.workerURL = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerURL);
        this.worker.onmessage = this._handleWorkerMessage.bind(this);
        this.worker.onerror = (e) => {
            console.error('Worker error:', e);
            this.isGameOver = true;
            alert('Произошла ошибка в работе ботов. Игра остановлена.');
        };

        this._bindUIElements();
        this._attachEventListeners();
    }

    destroy() {
        this.worker.terminate();
        URL.revokeObjectURL(this.workerURL);
        this.isGameOver = true;
    }

    _bindUIElements() {
        this.menuElem = document.getElementById('menu');
        this.guideElem = document.getElementById('guide');
        this.startButton = document.getElementById('startButton');
        this.backButton = document.getElementById('backButton');
        this.guideButton = document.getElementById('guideButton');
        this.playerNameInput = document.getElementById('playerName');
        this.botDifficultySelect = document.getElementById('botDifficulty');
        this.mapSizeSelect = document.getElementById('mapSize');
        this.sendPercentInput = document.getElementById('sendPercent');
        this.sendPercentValue = document.getElementById('sendPercentValue');

        if (!this.canvas || !this.ctx || !this.menuElem || !this.guideElem ||
            !this.startButton || !this.backButton || !this.guideButton ||
            !this.playerNameInput || !this.botDifficultySelect || !this.mapSizeSelect ||
            !this.sendPercentInput || !this.sendPercentValue) {
            throw new Error('One or more required DOM elements are missing.');
        }

        this.playerNameInput.setAttribute('maxlength', '10');
    }

    _attachEventListeners() {
        this.startButton.addEventListener('click', () => this._handleStart());
        this.guideButton.addEventListener('click', () => {
            this.menuElem.style.display = 'none';
            this.guideElem.style.display = 'block';
        });
        this.backButton.addEventListener('click', () => {
            this.guideElem.style.display = 'none';
            this.menuElem.style.display = 'block';
        });
        let lastZoomTime = 0, ZOOM_COOLDOWN = 100;
        this.canvas.addEventListener('wheel', e => {
            const now = Date.now();
            if (now - lastZoomTime < ZOOM_COOLDOWN) return;
            lastZoomTime = now;
            this._handleZoom(e);
        });
        this.canvas.addEventListener('mousedown', e => this._startPan(e));
        this.canvas.addEventListener('mousemove', e => this._pan(e));
        this.canvas.addEventListener('mouseup', () => this._endPan());
        this.canvas.addEventListener('mouseleave', () => this._endPan());
        this.canvas.addEventListener('click', e => this._handlePlayerClick(e));
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
        const name = this.playerNameInput.value.trim() || 'Игрок';
        this.menuElem.style.display = 'none';
        this.initGame(name);
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
        requestAnimationFrame(ts => this._gameLoop(ts));
    }

    _applySettings() {
        const size = this.mapSizeSelect.value;
        if (size === 'small') {
            this.mapWidth = 100; this.mapHeight = 75;
        } else if (size === 'medium') {
            this.mapWidth = 250; this.mapHeight = 188;
        } else {
            this.mapWidth = 500; this.mapHeight = 375;
        }
    }

    _resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    _recalcMinZoom() {
        const zx = this.canvas.width / (this.mapWidth * this.CELL_SIZE);
        const zy = this.canvas.height / (this.mapHeight * this.CELL_SIZE);
        this.minZoom = Math.min(zx, zy, 1) * 0.5;
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
        const startP = 1000;
        const botParams = this._getBotParameters();
        const cx = Math.floor(this.mapWidth / 2);
        const cy = Math.floor(this.mapHeight / 2);

        const player = new Player(this.playerId, playerName, '#4CAF50', startP,
            this.GLOBAL_MIN_GROWTH, this.GLOBAL_MAX_GROWTH);
        this.entities[this.playerId] = player;
        const pIdx = cy * this.mapWidth + cx;
        this.map[cy][cx] = this.playerId;
        player.area.add(pIdx);
        this.dirtyCells.add(pIdx);

        const botCountMap = { small: 5, medium: 10, large: 20 };
        const count = botCountMap[this.mapSizeSelect.value];
        const occupied = [{x:cx,y:cy}];
        const isFar = (x,y) => occupied.every(p => Math.max(Math.abs(x-p.x),Math.abs(y-p.y))>=2);
        const spawn = () => {
            for (let i=0; i<10000; i++){
                const x = Math.floor(Math.random()*this.mapWidth);
                const y = Math.floor(Math.random()*this.mapHeight);
                if (this.map[y][x]===0 && isFar(x,y)) return {x,y};
            }
            return {x:cx,y:cy};
        };

        const botNames = ['мипошка', 'шуга дедди', 'отчим', 'санечка', 'максимка', 'пес рыжик', 'ганзалис', 'данбас', 'казахстан', 'ветмо', 'лох', 'чмо'];
        let availableNames = [...botNames]; 

        for (let i=0; i<count; i++){
            const id = this.nextBotId++;
            const { x, y } = spawn();
            // Выбираем имя: если имена закончились, используем запасное
            let botName;
            if (availableNames.length > 0) {
                const nameIndex = Math.floor(Math.random() * availableNames.length);
                botName = availableNames.splice(nameIndex, 1)[0];
            } else {
                botName = `Бот ${i+1}`; // Запасное имя
            }
            const bot = new Bot(id, botName, `#${Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0')}`,
                botParams.popStart, botParams.minG, botParams.maxG);
            this.entities[id] = bot;
            const idx = y*this.mapWidth + x;
            this.map[y][x] = id;
            bot.area.add(idx);
            this.dirtyCells.add(idx);
            occupied.push({x,y});
        }
    }

    _getBotParameters() {
        const diff = this.botDifficultySelect.value;
        return {
            easy: { minG:0.025, maxG:0.10, popStart:800 },
            medium: { minG:0.02, maxG:0.10, popStart:900 },
            hard: { minG:0.03, maxG:0.12, popStart:1000 }
        }[diff];
    }

    _gameLoop(ts) {
        if (this.isGameOver) return;
        requestAnimationFrame(t => this._gameLoop(t));
        if (!this.lastTime) this.lastTime = ts;
        const dt = ts - this.lastTime;
        Object.values(this.entities).forEach(ent => ent.updatePopulation(dt));
        this.botDecideTimer += dt;
        if (this.botDecideTimer >= 1000) {
            const states = {};
            for (let id in this.entities) {
                if (+id === this.playerId) continue;
                const bot = this.entities[id];
                const b = bot.getBorderCells(this);
                const owners = {};
                b.enemyBorders.forEach(ix => {
                    owners[ix] = this.map[Math.floor(ix/this.mapWidth)][ix%this.mapWidth];
                });
                states[id] = {
                    population: bot.population,
                    populationCap: bot.getPopulationCap(),
                    emptyBorders: Array.from(b.emptyBorders),
                    enemyBorders: Array.from(b.enemyBorders),
                    enemyOwners: owners
                };
            }
            this.worker.postMessage(states);
            this.botDecideTimer = 0;
        }
        Object.values(this.entities).forEach(ent => this._processEntityActions(ent, ts));
        this._updateLeaderboard(dt);
        if (ts - this.lastRender >= 1000/30) {
            this._draw();
            this.lastRender = ts;
        }
        this.lastTime = ts;
    }

    _handleWorkerMessage(e) {
        const actions = e.data;
        for (let botId in actions) {
            const act = actions[botId];
            if (!act) continue;
            const bot = this.entities[botId];
            if (!bot) continue; // Проверяем, что бот существует
            if (act.type === 'expandEmpty') {
                bot.expandAction = { type:'expandEmpty', budget: act.budget, lastStepTime:0, stepInterval:15 };
                bot.population = Math.max(0, bot.population - act.budget);
                if (bot.population < 0) {
                    bot.expandAction.budget = Math.max(0, bot.expandAction.budget + bot.population);
                    bot.population = 0;
                }
            } else if (act.type === 'attackBot') {
                const existing = bot.attackActions.get(act.targetBotId);
                const step = this._calculateAttackInterval(act.budget, bot.population+act.budget, bot.getPopulationCap());
                if (existing) {
                    existing.budget += Math.max(0, act.budget);
                    existing.stepInterval = Math.min(existing.stepInterval, step);
                } else {
                    bot.attackActions.set(act.targetBotId, {
                        type:'attackBot', targetBotId: act.targetBotId,
                        budget: act.budget, lastStepTime:0, stepInterval: step
                    });
                }
                bot.population = Math.max(0, bot.population - act.budget);
                if (bot.population < 0) {
                    const atk = bot.attackActions.get(act.targetBotId);
                    atk.budget = Math.max(0, atk.budget + bot.population);
                    bot.population = 0;
                }
            }
        }
    }

    _processEntityActions(ent, ts) {
        const exp = ent.expandAction;
        if (exp && exp.budget > 0 && ts - exp.lastStepTime >= exp.stepInterval) {
            const { emptyBorders } = ent.getBorderCells(this);
            if (emptyBorders.size === 0) {
                ent.population = Math.min(ent.population+exp.budget, ent.getPopulationCap());
                ent.expandAction = null;
            } else {
                const idx = emptyBorders.values().next().value;
                const y = Math.floor(idx/this.mapWidth), x = idx%this.mapWidth;
                if (this.map[y][x] === 0) {
                    this.map[y][x] = ent.id;
                    ent.area.add(idx);
                    ent.population = Math.max(0, ent.population-1);
                    ent.areaChanged = true;
                    this.dirtyCells.add(idx);
                }
                exp.budget = Math.max(0, exp.budget - 1);
                if (exp.budget <= 0) exp = ent.expandAction = null;
                ent.labelInfo = null;
                exp && (exp.lastStepTime = ts);
            }
        }
        ent.attackActions.forEach((atk, tgt) => {
            if (atk.budget > 0 && ts - atk.lastStepTime >= atk.stepInterval) {
                const { enemyBorders } = ent.getBorderCells(this);
                const cands = Array.from(enemyBorders).filter(ix => 
                    this.map[Math.floor(ix/this.mapWidth)][ix%this.mapWidth] === tgt
                );
                if (cands.length === 0) {
                    ent.population = Math.min(ent.population+atk.budget, ent.getPopulationCap());
                    ent.attackActions.delete(tgt);
                } else {
                    this._resolveBattle(ent.id, tgt, cands[0]);
                    atk.budget = Math.max(0, atk.budget - 1);
                    if (atk.budget <= 0) ent.attackActions.delete(tgt);
                }
                atk.lastStepTime = ts;
            }
        });
    }

    _getNeighbors(idx) {
        const x = idx % this.mapWidth, y = Math.floor(idx/this.mapWidth);
        const n = [];
        if (x>0) n.push(idx-1);
        if (x<this.mapWidth-1) n.push(idx+1);
        if (y>0) n.push(idx-this.mapWidth);
        if (y<this.mapHeight-1) n.push(idx+this.mapWidth);
        return n;
    }

    _calculateAttackInterval(budget, pop, cap) {
        const base=15, mid=10, max=7.5, half=pop*0.5;
        if (budget <= half) return base;
        if (budget < cap) {
            const t = (budget-half)/(cap-half);
            return base - (base-mid)*t;
        }
        const excess = Math.min((budget-cap)/cap,1);
        return mid - (mid-max)*excess;
    }

    _handlePlayerClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clickX = Math.floor((e.clientX - rect.left - this.cameraX) / (this.CELL_SIZE * this.zoomLevel));
        const clickY = Math.floor((e.clientY - rect.top - this.cameraY) / (this.CELL_SIZE * this.zoomLevel));
        if (clickX < 0 || clickX >= this.mapWidth || clickY < 0 || clickY >= this.mapHeight) return;

        const clickedOwner = this.map[clickY][clickX];
        const player = this.entities[this.playerId];
        const minPopulation = 0.05 * player.getPopulationCap();
        const budgetTotal = Math.floor(player.population * (this.sendPercent / 100));
        if (budgetTotal <= 0 || player.population - budgetTotal < minPopulation) return;

        if (clickedOwner !== 0 && clickedOwner !== this.playerId) {
            const bot = this.entities[clickedOwner];
            if (!bot) return;

            // Проверяем, атакует ли бот игрока
            const incoming = bot.attackActions.get(this.playerId);
            if (incoming && incoming.budget > 0) {
                if (budgetTotal <= incoming.budget) {
                    // Игрок нейтрализует часть атаки бота
                    incoming.budget = Math.max(0, incoming.budget - budgetTotal);
                    player.population = Math.max(0, player.population - budgetTotal);
                    if (incoming.budget === 0) bot.attackActions.delete(this.playerId);
                    return;
                } else {
                    // Игрок полностью нейтрализует атаку бота, остаток идёт в атаку
                    const remainder = budgetTotal - incoming.budget;
                    player.population = Math.max(0, player.population - incoming.budget);
                    bot.attackActions.delete(this.playerId);
                    if (remainder > 0 && player.population - remainder >= minPopulation) {
                        player.population = Math.max(0, player.population - remainder);
                        this._queuePlayerAttack(clickedOwner, remainder);
                    }
                    return;
                }
            }

            // Если нет входящей атаки, создаём новую атаку игрока
            player.population = Math.max(0, player.population - budgetTotal);
            this._queuePlayerAttack(clickedOwner, budgetTotal);
            return;
        }

        if (clickedOwner === 0) {
            player.population = Math.max(0, player.population - budgetTotal);
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

    _handleWorkerMessage(e) {
        const actions = e.data;
        for (let botId in actions) {
            const act = actions[botId];
            if (!act) continue;
            const bot = this.entities[botId];
            if (!bot) continue;

            if (act.type === 'expandEmpty') {
                bot.expandAction = { type: 'expandEmpty', budget: act.budget, lastStepTime: 0, stepInterval: 15 };
                bot.population = Math.max(0, bot.population - act.budget);
                if (bot.population < 0) {
                    bot.expandAction.budget = Math.max(0, bot.expandAction.budget + bot.population);
                    bot.population = 0;
                }
            } else if (act.type === 'attackBot') {
                const targetId = act.targetBotId;
                const target = this.entities[targetId];
                if (!target) continue;

                // Проверяем, атакует ли цель бота
                const incoming = target.attackActions.get(botId);
                if (incoming && incoming.budget > 0) {
                    if (act.budget <= incoming.budget) {
                        // Бот нейтрализует часть атаки цели
                        incoming.budget = Math.max(0, incoming.budget - act.budget);
                        bot.population = Math.max(0, bot.population - act.budget);
                        if (incoming.budget === 0) target.attackActions.delete(botId);
                        continue;
                    } else {
                        // Бот нейтрализует атаку цели, остаток идёт в атаку
                        const remainder = act.budget - incoming.budget;
                        bot.population = Math.max(0, bot.population - incoming.budget);
                        target.attackActions.delete(botId);
                        if (remainder > 0) {
                            bot.population = Math.max(0, bot.population - remainder);
                            const step = this._calculateAttackInterval(remainder, bot.population + remainder, bot.getPopulationCap());
                            bot.attackActions.set(targetId, {
                                type: 'attackBot',
                                targetBotId: targetId,
                                budget: remainder,
                                lastStepTime: 0,
                                stepInterval: step
                            });
                        }
                        continue;
                    }
                }

                // Если нет входящей атаки, создаём новую атаку бота
                bot.population = Math.max(0, bot.population - act.budget);
                const step = this._calculateAttackInterval(act.budget, bot.population + act.budget, bot.getPopulationCap());
                bot.attackActions.set(targetId, {
                    type: 'attackBot',
                    targetBotId: targetId,
                    budget: act.budget,
                    lastStepTime: 0,
                    stepInterval: step
                });
            }
        }
    }

_processEntityActions(ent, ts) {
    const exp = ent.expandAction;
    if (exp && exp.budget > 0 && ts - exp.lastStepTime >= exp.stepInterval) {
        const { emptyBorders } = ent.getBorderCells(this);
        if (emptyBorders.size === 0) {
            ent.population = Math.min(ent.population + exp.budget, ent.getPopulationCap());
            ent.expandAction = null;
        } else {
            const idx = emptyBorders.values().next().value;
            const y = Math.floor(idx / this.mapWidth), x = idx % this.mapWidth;
            if (this.map[y][x] === 0) {
                this.map[y][x] = ent.id;
                ent.area.add(idx);
                ent.population = Math.max(0, ent.population - 1);
                ent.areaChanged = true;
                this.dirtyCells.add(idx);
            }
            exp.budget = Math.max(0, exp.budget - 1);
            if (exp.budget <= 0) ent.expandAction = null;
            ent.labelInfo = null;
            exp && (exp.lastStepTime = ts);
        }
    }

    ent.attackActions.forEach((atk, tgt) => {
        if (atk.budget > 0 && ts - atk.lastStepTime >= atk.stepInterval) {
            const target = this.entities[tgt];
            if (!target) {
                ent.population = Math.min(ent.population + atk.budget, ent.getPopulationCap());
                ent.attackActions.delete(tgt);
                return;
            }

            // Проверяем, есть ли встречная атака
            const incoming = target.attackActions.get(ent.id);
            if (incoming && incoming.budget > 0) {
                if (atk.budget <= incoming.budget) {
                    incoming.budget = Math.max(0, incoming.budget - atk.budget);
                    ent.population = Math.max(0, ent.population - atk.budget);
                    ent.attackActions.delete(tgt);
                    if (incoming.budget === 0) target.attackActions.delete(ent.id);
                } else {
                    atk.budget = Math.max(0, atk.budget - incoming.budget);
                    ent.population = Math.max(0, ent.population - incoming.budget);
                    target.attackActions.delete(ent.id);
                    if (atk.budget === 0) ent.attackActions.delete(tgt);
                }
                atk.lastStepTime = ts;
                return;
            }

            // Если нет встречной атаки, проводим атаку
            const { enemyBorders } = ent.getBorderCells(this);
            const cands = Array.from(enemyBorders).filter(ix => 
                this.map[Math.floor(ix / this.mapWidth)][ix % this.mapWidth] === tgt
            );
            if (cands.length === 0) {
                ent.population = Math.min(ent.population + atk.budget, ent.getPopulationCap());
                ent.attackActions.delete(tgt);
            } else {
                this._resolveBattle(ent.id, tgt, cands[0]);
                atk.budget = Math.max(0, atk.budget - 1);
                if (atk.budget <= 0) ent.attackActions.delete(tgt);
            }
            atk.lastStepTime = ts;
        }
    });
}

    _queuePlayerAttack(targetBotId, amount) {
        const player = this.entities[this.playerId];
        const existing = player.attackActions.get(targetBotId);
        const stepInterval = this._calculateAttackInterval(
            amount,
            player.population + amount,
            player.getPopulationCap()
        );

        if (existing) {
            existing.budget += Math.max(0, amount);
            existing.stepInterval = Math.min(existing.stepInterval, stepInterval);
        } else {
            player.attackActions.set(targetBotId, {
                type: 'attackBot',
                targetBotId: targetBotId,
                budget: amount,
                lastStepTime: 0,
                stepInterval: stepInterval
            });
        }
    }

    _resolveBattle(attId, defId, idx) {
        const at = this.entities[attId], df = this.entities[defId];
        if (!at || !df) return; // Проверяем, что обе сущности существуют
        const y = Math.floor(idx/this.mapWidth), x = idx%this.mapWidth;
        at.population = Math.max(0, at.population-1);
        this.map[y][x] = attId;
        at.area.add(idx);
        df.area.delete(idx);
        at.areaChanged = df.areaChanged = true;
        this.dirtyCells.add(idx);
        at.labelInfo = df.labelInfo = null;
        if (df.area.size === 0) {
            delete this.entities[defId];
        }
    }

    _updateLeaderboard(dt) {
        this.leaderTimer += dt;
        if (this.leaderTimer < 5000) return;
        this.leaderTimer = 0;
        const total = this.mapWidth*this.mapHeight;
        this.leaderStats = Object.values(this.entities).map(ent => ({
            name: ent.name,
            territoryPct: ent.area.size/total*100,
            population: Math.floor(ent.population),
            color: ent.color
        })).sort((a,b)=>b.territoryPct-a.territoryPct||b.population-a.population).slice(0,5);
        this._checkVictory();
    }

    _checkVictory() {
        const total = this.mapWidth*this.mapHeight;
        const botCount = Object.keys(this.entities).length - 1; // Исключаем игрока
        for (let id in this.entities) {
            const ent = this.entities[id];
            if (ent.area.size/total > 0.8) {
                this.isGameOver = true;
                alert(+id===this.playerId ?
                    'Поздравляем! Вы захватили более 50% карты и выиграли!' :
                    `К сожалению, бот "${ent.name}" занял более 80% карты. Вы проиграли.`
                );
                this.destroy();
                return;
            }
        }
        if (botCount === 0 && Object.keys(this.entities).length === 1) {
            this.isGameOver = true;
            alert('Поздравляем! Вы уничтожили всех ботов и выиграли!');
            this.destroy();
            return;
        }
    }

    _renderFullMap() {
        this.offscreenCtx.fillStyle = varGet('--canvas-empty');
        this.offscreenCtx.fillRect(0, 0, this.mapWidth*this.CELL_SIZE, this.mapHeight*this.CELL_SIZE);
        for (let y=0; y<this.mapHeight; y++){
            for (let x=0; x<this.mapWidth; x++){
                const ow = this.map[y][x];
                if (ow!==0) {
                    this.offscreenCtx.fillStyle = this.entities[ow]?.color || varGet('--canvas-empty');
                    this.offscreenCtx.fillRect(x*this.CELL_SIZE,y*this.CELL_SIZE,this.CELL_SIZE,this.CELL_SIZE);
                }
            }
        }
    }

    _draw() {
        this.ctx.fillStyle = varGet('--canvas-bg');
        this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);

        this.dirtyCells.forEach(idx => {
            const x = idx%this.mapWidth, y = Math.floor(idx/this.mapWidth);
            const ow = this.map[y][x];
            this.offscreenCtx.fillStyle = ow===0 ? varGet('--canvas-empty') : (this.entities[ow]?.color || varGet('--canvas-empty'));
            this.offscreenCtx.fillRect(x*this.CELL_SIZE,y*this.CELL_SIZE,this.CELL_SIZE,this.CELL_SIZE);
        });
        this.dirtyCells.clear();

        this.ctx.save();
        this.ctx.translate(this.cameraX,this.cameraY);
        this.ctx.scale(this.zoomLevel,this.zoomLevel);
        this.ctx.drawImage(this.offscreenCanvas,0,0);

        for (let id in this.entities) {
            const ent = this.entities[id];
            ent.area.forEach(idx => {
                const x = idx%this.mapWidth, y = Math.floor(idx/this.mapWidth);
                if (this._getNeighbors(idx).some(n => this.map[Math.floor(n/this.mapWidth)][n%this.mapWidth]!==ent.id)) {
                    this.ctx.strokeStyle = +id===this.playerId ? varGet('--border-player') : varGet('--border-bot');
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(x*this.CELL_SIZE,y*this.CELL_SIZE,this.CELL_SIZE,this.CELL_SIZE);
                }
            });
            if (ent.area.size>0) {
                if (!ent.labelInfo) {
                    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
                    ent.area.forEach(idx => {
                        const x=idx%this.mapWidth, y=Math.floor(idx/this.mapWidth);
                        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
                        minY=Math.min(minY,y); maxY=Math.max(maxY,y);
                    });
                    const centerX=((minX+maxX+1)/2)*this.CELL_SIZE;
                    const centerY=((minY+maxY+1)/2)*this.CELL_SIZE;
                    const boxW=(maxX-minX+1)*this.CELL_SIZE;
                    const boxH=(maxY-minY+1)*this.CELL_SIZE;
                    let fontSize = Math.max(8, Math.floor(Math.min(boxW/(ent.name.length*0.6), boxH*0.5)*1.2));
                    ent.labelInfo = { x: centerX, y: centerY, size: fontSize, minX, maxX };
                }
                let fs = ent.labelInfo.size;
                this.ctx.font = `${fs}px Arial`;
                const availW = (ent.labelInfo.maxX-ent.labelInfo.minX+1)*this.CELL_SIZE;
                while (fs>6 && this.ctx.measureText(ent.name).width>availW) {
                    fs--;
                    this.ctx.font = `${fs}px Arial`;
                }
                this.ctx.fillStyle = varGet('--text-color');
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(ent.name, ent.labelInfo.x, ent.labelInfo.y);
            }
        }

        this.ctx.restore();

        const pl = this.entities[this.playerId];
        const Pmax = pl.getPopulationCap(), P = pl.population;
        const frac = (4*P*(Pmax-P))/(Pmax*Pmax);
        const rate = pl.minGrowth + (pl.maxGrowth-pl.minGrowth)*frac;
        this.ctx.fillStyle = varGet('--text-color');
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'left'; this.ctxBiaseline = 'top';
        this.ctx.fillText(`Игрок: ${pl.name}`,10,10);
        this.ctx.fillText(`Популяция: ${Math.floor(P)} / ${Pmax}`,10,30);
        this.ctx.fillText(`Рост: ${(rate*100).toFixed(1)}%`,10,50);
        this.ctx.fillText(`Территория: ${((pl.area.size/(this.mapWidth*this.mapHeight))*100).toFixed(1)}%`,10,70);

        if (this.leaderStats) {
            this.ctx.textAlign = 'right';
            this.ctx.fillText('Лидеры:', this.canvas.width-150,10);
            this.leaderStats.forEach((s,i) => {
                this.ctx.fillStyle = s.color;
                this.ctx.fillRect(this.canvas.width-170,30+i*20,10,10);
                this.ctx.fillStyle = varGet('--text-color');
                this.ctx.fillText(`${s.name}: ${s.territoryPct.toFixed(1)}% (${s.population})`, this.canvas.width-20,35+i*20);
            });
        }

        const wars = [];
        const exp = pl.expandAction;
        if (exp && exp.budget > 0) wars.push(`Игрок: ${exp.budget} в расширении`);
        pl.attackActions.forEach((atk, tgt) => {
            if (atk.budget > 0) wars.push(`Игрок: ${atk.budget} в атаке на ${this.entities[tgt]?.name || 'Неизвестно'}`);
        });
        for (let id in this.entities) {
            if (+id === this.playerId) continue;
            this.entities[id].attackActions.forEach((atk, tgt) => {
                if (tgt === this.playerId && atk.budget > 0) wars.push(`${this.entities[id].name}: ${atk.budget} в атаке на Игрок`);
            });
        }
        if (wars.length) {
            this.ctx.fillStyle = varGet('--text-color');
            this.ctx.font = '16px Arial';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';
            const maxWidth = this.canvas.width - 20; // Ограничиваем ширину текста
            const startY = this.canvas.height - 20 - wars.length * 20;
            this.ctx.fillText('Войны:', 10, startY);
            wars.forEach((w, i) => {
                let displayText = w;
                while (this.ctx.measureText(displayText).width > maxWidth && displayText.length > 0) {
                    displayText = displayText.slice(0, -1);
                }
                if (displayText !== w) displayText += '...';
                this.ctx.fillText(displayText, 10, startY + 20 + i * 20);
            });
        }
    }

    _handleZoom(e) {
        e.preventDefault();
        const factor = e.deltaY<0 ? 1.1 : 0.9;
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.MAX_ZOOM, this.zoomLevel*factor));
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
        const w = this.mapWidth*this.CELL_SIZE*this.zoomLevel;
        const h = this.mapHeight*this.CELL_SIZE*this.zoomLevel;
        if (w >= this.canvas.width) {
            this.cameraX = Math.max(this.canvas.width-w, Math.min(0, this.cameraX));
        } else {
            this.cameraX = Math.max(0, Math.min(this.canvas.width-w, this.cameraX));
        }
        if (h >= this.canvas.height) {
            this.cameraY = Math.max(this.canvas.height-h, Math.min(0, this.cameraY));
        } else {
            this.cameraY = Math.max(0, Math.min(this.canvas.height-h, this.cameraY));
        }
    }
}

function varGet(variable) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return value || '#000000';
}

window.addEventListener('DOMContentLoaded', () => new Game());