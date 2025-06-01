'use strict';
/**
 * Класс Entity — базовый для игрока и ботов.
 */
class Entity {
    /**
     * Конструктор сущности.
     * @param {number} id — уникальный идентификатор.
     * @param {string} name — отображаемое имя сущности.
     * @param {string} color — цвет для отображения территорий.
     * @param {number} popStart — начальное население.
     * @param {number} minGrowth — минимальный коэффициент роста.
     * @param {number} maxGrowth — максимальный коэффициент роста.
     */
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        /** @type {number} */
        this.id = id;
        /** @type {string} */
        this.name = name;
        /** @type {string} */
        this.color = color;
        /** @type {number} */
        this.population = popStart;
        /** @type {Set<string>} набор ячеек (ячейка кодируется как "x,y") */
        this.area = new Set();
        /** @type {number} минимальный темп роста */
        this.minGrowth = minGrowth;
        /** @type {number} максимальный темп роста */
        this.maxGrowth = maxGrowth;
        /** @type {object|null} объект действия расширения или атаки */
        this.expandAction = null;
        this.attackAction = null;
        /** @type {object|null} информация для отрисовки лейбла (позиция и размер шрифта) */
        this.labelInfo = null;
    }

    /**
     * Вычислить максимальную вместимость населения для сущности.
     * @returns {number}
     */
    getPopulationCap() {
        const BASE_POP = 100;
        const POP_PER_CELL = 5;
        return BASE_POP + this.area.size * POP_PER_CELL;
    }

    /**
     * Обновить население (логистический рост) за прошедшее время dt.
     * @param {number} dt — миллисекунды с последнего обновления.
     */
    updatePopulation(dt) {
        const P = this.population;
        const Pmax = this.getPopulationCap();
        if (Pmax <= 0) return;
        // Формула логистического роста: dP/dt = rate * P
        // rate = minGrowth + (maxGrowth - minGrowth) * frac
        const frac = (4 * P * (Pmax - P)) / (Pmax * Pmax);
        const rate = this.minGrowth + (this.maxGrowth - this.minGrowth) * frac;
        const dPdt = rate * P;
        this.population += dPdt * (dt / 1000);
        // Ограничение по верхней и нижней границе
        if (this.population > Pmax) this.population = Pmax;
        if (this.population < 0) this.population = 0;
    }
}

/**
 * Класс Player — наследник Entity для игрока.
 */
class Player extends Entity {
    /**
     * Конструктор игрока.
     * @param {number} id — идентификатор.
     * @param {string} name — имя игрока.
     * @param {string} color — цвет отображения.
     * @param {number} popStart — начальное население.
     * @param {number} minGrowth — минимальный рост.
     * @param {number} maxGrowth — максимальный рост.
     */
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        super(id, name, color, popStart, minGrowth, maxGrowth);
    }
}

/**
 * Класс Bot — наследник Entity для ботов.
 */
class Bot extends Entity {
    /**
     * Конструктор бота.
     * @param {number} id — идентификатор.
     * @param {string} name — отображаемое имя бота.
     * @param {string} color — цвет для покраски клеток.
     * @param {number} popStart — начальное население.
     * @param {number} minGrowth — минимальный рост.
     * @param {number} maxGrowth — максимальный рост.
     */
    constructor(id, name, color, popStart, minGrowth, maxGrowth) {
        super(id, name, color, popStart, minGrowth, maxGrowth);
    }
}

/**
 * Класс Game — главный контроллер игры.
 */
class Game {
    /**
     * Конструктор игры.
     */
    constructor() {
        /** @type {HTMLCanvasElement} элемент canvas */
        this.canvas = document.getElementById('gameCanvas');
        /** @type {CanvasRenderingContext2D} контекст рисования */
        this.ctx = this.canvas.getContext('2d');

        /** @type {number} ширина карты в клетках */
        this.mapWidth = 0;
        /** @type {number} высота карты в клетках */
        this.mapHeight = 0;
        /** @type {number} размер клетки в пикселях */
        this.CELL_SIZE = 40;

        /** @type {Array<Array<number>>} 2D-массив картовых данных (0 — пусто, иначе id сущности) */
        this.map = [];

        /** @type {Object.<number, Entity>} словарь сущностей (игрок + боты) */
        this.entities = {};

        /** @type {number} id игрока (фиксирован) */
        this.playerId = 1;
        /** @type {number} следующий доступный id для бота */
        this.nextBotId = 2;

        // Параметры генерации и поведения
        this.GLOBAL_MIN_GROWTH = 0.02;
        this.GLOBAL_MAX_GROWTH = 0.10;
        this.BOT_EXPANSION_PERCENT = 0.20;

        // Камера и зум
        this.zoomLevel = 1.0;
        this.minZoom = 0.1;
        this.MAX_ZOOM = 20.0;
        this.cameraX = 0;
        this.cameraY = 0;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // Таймеры
        this.lastTime = 0;
        this.leaderTimer = 0;
        this.lastRender = 0;
        this.botDecideTimer = 0;

        // Флаг окончания игры
        this.isGameOver = false;

        // Привязка обработчиков
        this._bindUIElements();
        this._attachEventListeners();
    }

    /**
     * Привязывает элементы DOM к свойствам класса.
     * Используются наименования, отражающие назначение каждого элемента.
     */
    _bindUIElements() {
        this.menuElem = document.getElementById('menu');
        this.guideElem = document.getElementById('guide');
        this.startButton = document.getElementById('startButton');
        this.guideButton = document.getElementById('guideButton');
        this.backButton = document.getElementById('backButton');
        this.playerNameInput = document.getElementById('playerName');
        this.botDifficultySelect = document.getElementById('botDifficulty');
        this.mapSizeSelect = document.getElementById('mapSize');
        this.playerNameDisplay = document.getElementById('playerNameDisplay');

        this.infoPanel = document.getElementById('infoPanel');
        this.popCountElem = document.getElementById('popCount');
        this.popCapElem = document.getElementById('popCap');
        this.growthRateElem = document.getElementById('growthRateText');
        this.territoryPercentElem = document.getElementById('territoryPercent');

        this.leaderboardElem = document.getElementById('leaderboard');
        this.leaderListElem = document.getElementById('leaderList');

        this.notificationsElem = document.getElementById('notifications');
        this.notifListElem = document.getElementById('notifList');

        this.sendPercentInput = document.getElementById('sendPercent');
        this.sendPercentValue = document.getElementById('sendPercentValue');
        this.bottomControls = document.getElementById('bottomControls');

        this.warInfoElem = document.getElementById('warInfo');
        this.warListElem = document.getElementById('warList');
    }

    /**
     * Прикрепляет все необязательные слушатели событий.
     * Слушатели назначаются «ненавязчиво» (в JS).
     */
    _attachEventListeners() {
        // Клик по кнопке "Играть"
        this.startButton.addEventListener('click', () => this._handleStart());

        // Кнопка "Гайд" открывает страницу с инструкцией
        this.guideButton.addEventListener('click', () => {
            this.menuElem.style.display = 'none';
            this.guideElem.style.display = 'flex';
        });

        // Кнопка "Назад к меню"
        this.backButton.addEventListener('click', () => {
            this.guideElem.style.display = 'none';
            this.menuElem.style.display = 'flex';
        });

        // Зум колесом мыши
        this.canvas.addEventListener('wheel', (e) => this._handleZoom(e));

        // Панорамирование карты
        this.canvas.addEventListener('mousedown', (e) => this._startPan(e));
        this.canvas.addEventListener('mousemove', (e) => this._pan(e));
        this.canvas.addEventListener('mouseup', () => this._endPan());
        this.canvas.addEventListener('mouseleave', () => this._endPan());

        // Клик игрока по карте (атака/расширение)
        this.canvas.addEventListener('click', (e) => this._handlePlayerClick(e));

        // Обновление отправляемого процента
        this.sendPercentInput.addEventListener('input', () => {
            this.sendPercentValue.textContent = `${this.sendPercentInput.value}%`;
        });

        // Изменение размеров окна
        window.addEventListener('resize', () => {
            this._resizeCanvas();
            this._recalcMinZoom();
            this._clampCamera();
        });
    }

    /**
     * Обработчик нажатия кнопки "Играть": скрывает меню и запускает игру.
     */
    _handleStart() {
        const playerName = this.playerNameInput.value.trim() || 'Игрок';
        this.playerNameDisplay.textContent = playerName;
        this.menuElem.style.display = 'none';
        document.body.classList.add('with-controls');
        this.infoPanel.style.display = 'block';
        this.leaderboardElem.style.display = 'block';
        this.bottomControls.style.display = 'flex';
        this.warInfoElem.style.display = 'block';
        this.initGame(playerName);
    }

    /**
     * Инициализация игры: применение настроек, создание карты и сущностей, запуск цикла.
     * @param {string} playerName — имя игрока.
     */
    initGame(playerName) {
        this.isGameOver = false;               // Сбрасываем флаг окончания игры
        this._applySettings();
        this._resizeCanvas();
        this._recalcMinZoom();
        this._generateMapArray();
        this._initEntities(playerName);
        this._clampCamera();
        requestAnimationFrame((timestamp) => this._gameLoop(timestamp));
    }

    /**
     * Применяет настройки из меню (размер карты).
     */
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

    /**
     * Настраивает размер canvas под размер окна.
     */
    _resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    /**
     * Пересчитывает минимальный зум, чтобы всю карту было видно.
     */
    _recalcMinZoom() {
        const zoomX = this.canvas.width / (this.mapWidth * this.CELL_SIZE);
        const zoomY = this.canvas.height / (this.mapHeight * this.CELL_SIZE);
        const base = Math.min(zoomX, zoomY, 1);
        this.minZoom = base * 0.5;
        if (this.zoomLevel < this.minZoom) {
            this.zoomLevel = this.minZoom;
        }
    }

    /**
     * Генерирует пустой 2D-массив карты.
     */
    _generateMapArray() {
        this.map = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => 0)
        );
    }

    /**
     * Инициализирует игрока и ботов на карте.
     * @param {string} playerName — имя игрока.
     */
    _initEntities(playerName) {
        this.entities = {};
        this.nextBotId = 2;

        // ===== Игрок =====
        const startPopPlayer = 1000;
        const botParams = this._getBotParameters();
        const centerX = Math.floor(this.mapWidth / 2);
        const centerY = Math.floor(this.mapHeight / 2);
        // Создаём объект игрока
        const player = new Player(
            this.playerId,
            playerName,
            '#4CAF50',
            startPopPlayer,
            this.GLOBAL_MIN_GROWTH,
            this.GLOBAL_MAX_GROWTH
        );
        this.entities[this.playerId] = player;
        // Устанавливаем стартовую клетку игрока по центру
        this.map[centerY][centerX] = this.playerId;
        player.area.add(`${centerX},${centerY}`);

        // ===== Боты =====
        let botCount = 10; // по умолчанию для medium
        const mapSizeChoice = this.mapSizeSelect.value;
        if (mapSizeChoice === 'small') botCount = 5;
        else if (mapSizeChoice === 'medium') botCount = 10;
        else botCount = 20;

        // Функция генерации случайного цвета в HEX
        const getRandomColor = () => {
            const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
            return `#${hex}`;
        };

        // Список занятых координат, чтобы не спауниться близко к другим
        const occupied = [{ x: centerX, y: centerY }];
        /**
         * Проверяет, что новые координаты находятся на расстоянии не менее 2 клеток от других.
         * @param {number} x
         * @param {number} y
         * @returns {boolean}
         */
        const isFarEnough = (x, y) => {
            for (const p of occupied) {
                if (Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) < 2) {
                    return false;
                }
            }
            return true;
        };

        /**
         * Возвращает случайные координаты для спавна бота.
         * @returns {{x: number, y: number}}
         */
        const getRandomSpawn = () => {
            let attempts = 0;
            while (attempts < 10000) {
                const x = Math.floor(Math.random() * this.mapWidth);
                const y = Math.floor(Math.random() * this.mapHeight);
                if (this.map[y][x] === 0 && isFarEnough(x, y)) {
                    return { x, y };
                }
                attempts++;
            }
            // Если не удалось найти подходящую клетку, вернуть центр (но туда уже заспаунены)
            return { x: centerX, y: centerY };
        };

        for (let i = 0; i < botCount; i++) {
            const id = this.nextBotId++;
            const color = getRandomColor();
            const botName = `Бот ${i + 1}`;
            const bot = new Bot(
                id,
                botName,
                color,
                botParams.popStart,
                botParams.minG,
                botParams.maxG
            );
            this.entities[id] = bot;
            const { x: bx, y: by } = getRandomSpawn();
            this.map[by][bx] = id;
            bot.area.add(`${bx},${by}`);
            occupied.push({ x: bx, y: by });
        }
    }

    /**
     * Возвращает параметры генерации бота в зависимости от выбранной сложности.
     * @returns {{minG: number, maxG: number, popStart: number}}
     */
    _getBotParameters() {
        const diff = this.botDifficultySelect.value;
        if (diff === 'easy') {
            return { minG: 0.025, maxG: 0.10, popStart: 800 };
        } else if (diff === 'medium') {
            return { minG: 0.02, maxG: 0.10, popStart: 900 };
        } else {
            return { minG: 0.03, maxG: 0.12, popStart: 1000 };
        }
    }

    /**
     * Основной цикл игры — обновляет состояние и рисует.
     * @param {number} ts — текущее время в миллисекундах.
     */
    _gameLoop(ts) {
        if (this.isGameOver) return; // Если игра окончена, больше не обновляем

        requestAnimationFrame((timestamp) => this._gameLoop(timestamp));

        if (!this.lastTime) this.lastTime = ts;
        const dt = ts - this.lastTime;

        // Обновляем население всех сущностей
        for (const id in this.entities) {
            this.entities[id].updatePopulation(dt);
        }

        // Решения ботов каждую секунду
        this.botDecideTimer += dt;
        if (this.botDecideTimer >= 1000) {
            for (const id in this.entities) {
                const entId = parseInt(id, 10);
                if (entId !== this.playerId) {
                    this._botDecideAction(entId);
                }
            }
            this.botDecideTimer = 0;
        }

        // Обрабатываем действия всех (расширение/атака)
        for (const id in this.entities) {
            this._processEntityActions(this.entities[id], ts);
        }

        // Обновляем UI: лидеров раз в 5 сек, военные действия каждый кадр
        this._updateLeaderboard(dt);
        this._updateWarInfo();

        // Проверяем условие победы/поражения
        this._checkVictory();

        // Ограничение отрисовки до 30 FPS
        if (ts - this.lastRender >= 1000 / 30) {
            this._draw();
            this.lastRender = ts;
        }

        this.lastTime = ts;
    }

    /**
     * Бот принимает решение каждую секунду: расширяться или атаковать.
     * @param {number} botId — id бота.
     */
    _botDecideAction(botId) {
        const bot = this.entities[botId];
        const P = bot.population;
        const Pmax = bot.getPopulationCap();
        // Если население слишком мало, ждем роста
        if (P < 0.6 * Pmax) return;

        // Получаем границы (пустые и вражеские клетки)
        const { emptyBorders, enemyBorders } = this._getBorderCellsFor(botId);

        // Пробуем расшириться
        if (emptyBorders.size > 0) {
            let budget = Math.floor(bot.population * this.BOT_EXPANSION_PERCENT);
            if (budget <= 0) return;
            bot.population -= budget;
            if (bot.population < 0) {
                budget += bot.population;
                bot.population = 0;
            }
            if (bot.expandAction) {
                bot.expandAction.budget += budget;
            } else {
                bot.expandAction = {
                    type: 'expandEmpty',
                    budget: budget,
                    lastStepTime: 0,
                    stepInterval: 30
                };
            }
            return;
        }

        // Если расширяться некуда, пробуем атаковать
        if (enemyBorders.size > 0) {
            const neigh = new Set();
            enemyBorders.forEach((cell) => {
                const [x, y] = cell.split(',').map(Number);
                const owner = this.map[y][x];
                if (owner !== botId) neigh.add(owner);
            });
            if (neigh.size > 0) {
                // Находим самого слабого из соседей
                let weakest = null;
                let minPop = Infinity;
                neigh.forEach((id) => {
                    const pop = this.entities[id].population;
                    if (pop < minPop) {
                        minPop = pop;
                        weakest = id;
                    }
                });
                if (weakest !== null) {
                    let budget = Math.floor(bot.population * this.BOT_EXPANSION_PERCENT);
                    if (budget <= 0) return;
                    bot.population -= budget;
                    if (bot.population < 0) {
                        budget += bot.population;
                        bot.population = 0;
                    }
                    if (bot.attackAction && bot.attackAction.targetBotId === weakest) {
                        bot.attackAction.budget += budget;
                    } else {
                        bot.attackAction = {
                            type: 'attackBot',
                            targetBotId: weakest,
                            budget: budget,
                            lastStepTime: 0,
                            stepInterval: 30
                        };
                    }
                    return;
                }
            }
        }
    }

    /**
     * Обрабатывает действие расширения или атаки для сущности.
     * @param {Entity} entity — текущая сущность.
     * @param {number} ts — текущее время (timestamp).
     */
    _processEntityActions(entity, ts) {
        // ----- Расширение -----
        const exp = entity.expandAction;
        if (exp && exp.budget > 0) {
            if (ts - exp.lastStepTime >= exp.stepInterval) {
                const { emptyBorders } = this._getBorderCellsFor(entity.id);
                if (emptyBorders.size === 0) {
                    entity.expandAction = null;
                } else {
                    const cell = emptyBorders.values().next().value;
                    const [x, y] = cell.split(',').map(Number);
                    if (this.map[y][x] === 0) {
                        this.map[y][x] = entity.id;
                        entity.area.add(cell);
                        entity.population = Math.max(0, entity.population - 1);
                    }
                    exp.budget--;
                    if (exp.budget <= 0) {
                        entity.expandAction = null;
                    }
                    entity.labelInfo = null; // сбросить лейбл, чтобы пересчитать
                    exp.lastStepTime = ts;
                }
            }
        }

        // ----- Атака -----
        const atk = entity.attackAction;
        if (atk && atk.budget > 0) {
            if (ts - atk.lastStepTime >= atk.stepInterval) {
                const { enemyBorders } = this._getBorderCellsFor(entity.id);
                const candidates = Array.from(enemyBorders).filter((cell) => {
                    const [x, y] = cell.split(',').map(Number);
                    return this.map[y][x] === atk.targetBotId;
                });
                if (candidates.length === 0) {
                    entity.attackAction = null;
                } else {
                    // Берём первую клетку и захватываем
                    const cell = candidates[0];
                    this._resolveBattle(entity.id, atk.targetBotId, cell);
                    atk.budget--;
                    if (atk.budget <= 0) {
                        entity.attackAction = null;
                    }
                }
                atk.lastStepTime = ts;
            }
        }
    }

    /**
     * Возвращает два множества: граничные пустые клетки и вражеские клетки для указанной сущности.
     * @param {number} entityId — id сущности.
     * @returns {{emptyBorders: Set<string>, enemyBorders: Set<string>}}
     */
    _getBorderCellsFor(entityId) {
        const dirs = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 }
        ];
        const emptyBorders = new Set();
        const enemyBorders = new Set();
        const entity = this.entities[entityId];

        entity.area.forEach((cell) => {
            const [x, y] = cell.split(',').map(Number);
            dirs.forEach((d) => {
                const nx = x + d.x;
                const ny = y + d.y;
                if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) return;
                const owner = this.map[ny][nx];
                if (owner === 0) {
                    emptyBorders.add(`${nx},${ny}`);
                } else if (owner !== entityId) {
                    enemyBorders.add(`${nx},${ny}`);
                }
            });
        });
        return { emptyBorders, enemyBorders };
    }

    /**
     * Обрабатывает клик игрока по карте: либо атака, либо расширение.
     * @param {MouseEvent} e — событие клика.
     */
    _handlePlayerClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clickX = Math.floor((e.clientX - rect.left - this.cameraX) / (this.CELL_SIZE * this.zoomLevel));
        const clickY = Math.floor((e.clientY - rect.top - this.cameraY) / (this.CELL_SIZE * this.zoomLevel));
        if (clickX < 0 || clickX >= this.mapWidth || clickY < 0 || clickY >= this.mapHeight) return;

        const clickedOwner = this.map[clickY][clickX];
        const player = this.entities[this.playerId];
        const { emptyBorders, enemyBorders } = this._getBorderCellsFor(this.playerId);

        // ----- Атака бота -----
        if (clickedOwner !== 0 && clickedOwner !== this.playerId) {
            // Отбираем соседние клетки, ведущие к этой цели
            const candidates = Array.from(enemyBorders).filter((cell) => {
                const [x, y] = cell.split(',').map(Number);
                return this.map[y][x] === clickedOwner;
            });
            if (candidates.length > 0) {
                const pct = parseInt(this.sendPercentInput.value, 10) / 100;
                let budgetTotal = Math.floor(player.population * pct);
                if (budgetTotal <= 0) return;
                player.population -= budgetTotal;
                if (player.population < 0) {
                    budgetTotal += player.population;
                    player.population = 0;
                }
                if (player.attackAction && player.attackAction.targetBotId === clickedOwner) {
                    player.attackAction.budget += budgetTotal;
                } else {
                    player.attackAction = {
                        type: 'attackBot',
                        targetBotId: clickedOwner,
                        budget: budgetTotal,
                        lastStepTime: 0,
                        stepInterval: 30
                    };
                }
            }
            return;
        }

        // ----- Расширение по пустой клетке -----
        if (clickedOwner === 0 && emptyBorders.size > 0) {
            const pct = parseInt(this.sendPercentInput.value, 10) / 100;
            let budgetTotal = Math.floor(player.population * pct);
            if (budgetTotal <= 0) return;
            player.population -= budgetTotal;
            if (player.population < 0) {
                budgetTotal += player.population;
                player.population = 0;
            }
            if (player.expandAction) {
                player.expandAction.budget += budgetTotal;
            } else {
                player.expandAction = {
                    type: 'expandEmpty',
                    budget: budgetTotal,
                    lastStepTime: 0,
                    stepInterval: 30
                };
            }
        }
    }

    /**
     * Разрешает битву: атакующая сущность тратит население, захватывает клетку.
     * @param {number} attackerId — id атакующего.
     * @param {number} defenderId — id защищающегося.
     * @param {string} cell — строковая координата "x,y".
     */
    _resolveBattle(attackerId, defenderId, cell) {
        const attacker = this.entities[attackerId];
        const [cx, cy] = cell.split(',').map(Number);
        // Атакующий теряет 1 популяцию за каждый захваченный шаг
        attacker.population = Math.max(0, attacker.population - 1);
        this.map[cy][cx] = attackerId;
        attacker.area.add(cell);
        const defender = this.entities[defenderId];
        defender.area.delete(cell);
        if (defender.labelInfo) defender.labelInfo = null;
        if (attacker.labelInfo) attacker.labelInfo = null;
    }

    /**
     * Обновляет таблицу лидеров раз в 5 секунд.
     * @param {number} dt — миллисекунды с последнего вызова.
     */
    _updateLeaderboard(dt) {
        this.leaderTimer += dt;
        if (this.leaderTimer < 5000) return;
        this.leaderTimer = 0;

        const stats = [];
        const totalCells = this.mapWidth * this.mapHeight;
        for (const id in this.entities) {
            const ent = this.entities[id];
            stats.push({
                name: ent.name,
                territoryPct: (ent.area.size / totalCells) * 100,
                population: Math.floor(ent.population),
                color: ent.color
            });
        }
        // Сортируем по территории, затем по населению
        stats.sort((a, b) => {
            if (b.territoryPct !== a.territoryPct) {
                return b.territoryPct - a.territoryPct;
            }
            return b.population - a.population;
        });

        // Очищаем и заполняем список лидеров
        this.leaderListElem.innerHTML = '';
        for (let i = 0; i < Math.min(5, stats.length); i++) {
            const s = stats[i];
            const li = document.createElement('li');
            const colorDot = `<span class="color-dot" style="background:${s.color};"></span>`;
            li.innerHTML = `${colorDot} ${s.name}: ${s.territoryPct.toFixed(2)}% (${s.population})`;
            this.leaderListElem.appendChild(li);
        }
    }

    /**
     * Обновляет окно "Военные действия" каждый кадр.
     */
    _updateWarInfo() {
        this.warListElem.innerHTML = '';
        const player = this.entities[this.playerId];
        // Действие расширения игрока
        const exp = player.expandAction;
        if (exp && exp.budget > 0) {
            const li = document.createElement('li');
            li.textContent = `Игрок: ${exp.budget} в расширении`;
            li.style.color = '#00FF00';
            this.warListElem.appendChild(li);
        }
        // Действие атаки игрока
        const patk = player.attackAction;
        if (patk && patk.budget > 0) {
            const botName = this.entities[patk.targetBotId]?.name || 'бот';
            const li = document.createElement('li');
            li.textContent = `Игрок: ${patk.budget} в атаке на ${botName}`;
            li.style.color = '#00CCFF';
            this.warListElem.appendChild(li);
        }
        // Боты, атакующие игрока
        for (const id in this.entities) {
            const ent = this.entities[id];
            if (ent.id === this.playerId) continue;
            const atk = ent.attackAction;
            if (atk && atk.budget > 0 && atk.targetBotId === this.playerId) {
                const li = document.createElement('li');
                li.textContent = `${ent.name}: ${atk.budget} в атаке на Игрок`;
                li.style.color = '#FF4444';
                this.warListElem.appendChild(li);
            }
        }
    }

    /**
     * Проверяет, занял ли кто-то 80% или более от игрового поля.
     * Если игрок занял ≥80% — выводит сообщение о победе.
     * Если любой бот занял ≥80% — выводит сообщение о поражении.
     */
    _checkVictory() {
        const totalCells = this.mapWidth * this.mapHeight;
        for (const id in this.entities) {
            const ent = this.entities[id];
            // Если какая-то сущность покрыла 80% или более клеток
            if (ent.area.size / totalCells >= 0.8) {
                if (parseInt(id, 10) === this.playerId) {
                    // Игрок победил
                    this.isGameOver = true;
                    alert('Поздравляем! Вы захватили 80% карты и выиграли!');
                } else {
                    // Бот победил — игрок проиграл
                    this.isGameOver = true;
                    alert(`К сожалению, бот "${ent.name}" занял 80% карты. Вы проиграли.`);
                }
                return;
            }
        }
    }

    /**
     * Рисует текущее состояние игры: карту, территории, границы, лейблы и UI.
     */
    _draw() {
        // Очистка фона
        this.ctx.fillStyle = varGet('--canvas-bg');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.translate(this.cameraX, this.cameraY);
        this.ctx.scale(this.zoomLevel, this.zoomLevel);

        // Рисуем пустую карту
        this.ctx.fillStyle = varGet('--canvas-empty');
        this.ctx.fillRect(0, 0, this.mapWidth * this.CELL_SIZE, this.mapHeight * this.CELL_SIZE);

        // Рисуем территории каждой сущности
        for (const id in this.entities) {
            const ent = this.entities[id];
            // Клетки территории
            ent.area.forEach((cell) => {
                const [x, y] = cell.split(',').map(Number);
                this.ctx.fillStyle = ent.color;
                this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
            });
            // Рисуем границы
            ent.area.forEach((cell) => {
                const [x, y] = cell.split(',').map(Number);
                const dirs = [
                    { dx: 0, dy: -1 },
                    { dx: 1, dy: 0 },
                    { dx: 0, dy: 1 },
                    { dx: -1, dy: 0 }
                ];
                for (const d of dirs) {
                    const nx = x + d.dx;
                    const ny = y + d.dy;
                    if (
                        nx < 0 ||
                        nx >= this.mapWidth ||
                        ny < 0 ||
                        ny >= this.mapHeight ||
                        this.map[ny][nx] !== ent.id
                    ) {
                        // Рисуем границу данной клетки
                        this.ctx.strokeStyle = (ent.id === this.playerId)
                            ? varGet('--border-player')
                            : varGet('--border-bot');
                        this.ctx.lineWidth = 2;
                        this.ctx.strokeRect(
                            x * this.CELL_SIZE,
                            y * this.CELL_SIZE,
                            this.CELL_SIZE,
                            this.CELL_SIZE
                        );
                        break;
                    }
                }
            });
            // Рисуем название в центре территории
            if (ent.area.size > 0) {
                if (!ent.labelInfo) {
                    // Рассчитываем границы (минимальный и максимальный X/Y)
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    ent.area.forEach((cell) => {
                        const [x, y] = cell.split(',').map(Number);
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    });
                    // Центр области в пикселях
                    const centerX = ((minX + maxX + 1) / 2) * this.CELL_SIZE;
                    const centerY = ((minY + maxY + 1) / 2) * this.CELL_SIZE;
                    // Размер коробки
                    const boxWidth = (maxX - minX + 1) * this.CELL_SIZE;
                    const boxHeight = (maxY - minY + 1) * this.CELL_SIZE;
                    // Вычисляем размер шрифта исходя из размеров коробки и длины имени
                    const baseSize = Math.min(
                        boxWidth / (ent.name.length * 0.6),
                        boxHeight * 0.5
                    );
                    const fontSize = Math.max(8, Math.floor(baseSize * 1.2));
                    ent.labelInfo = { x: centerX, y: centerY, size: fontSize };
                }
                // Рисуем текст
                this.ctx.font = `${ent.labelInfo.size}px Arial`;
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(ent.name, ent.labelInfo.x, ent.labelInfo.y);
            }
        }

        this.ctx.restore();

        // ===== Обновление UI: инфопанель игрока =====
        const player = this.entities[this.playerId];
        const Pmax = player.getPopulationCap();
        const P = player.population;
        const frac = (4 * P * (Pmax - P)) / (Pmax * Pmax);
        const rate = player.minGrowth + (player.maxGrowth - player.minGrowth) * frac;
        this.popCountElem.textContent = Math.floor(P);
        this.popCapElem.textContent = Pmax;
        this.growthRateElem.textContent = (rate * 100).toFixed(2);
        this.territoryPercentElem.textContent = ((player.area.size / (this.mapWidth * this.mapHeight)) * 100).toFixed(2);
    }

    /**
     * Обработчик масштабирования (зум) колесом мыши.
     * @param {WheelEvent} e
     */
    _handleZoom(e) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.MAX_ZOOM, this.zoomLevel * factor));
        this._clampCamera();
    }

    /**
     * Начало панорамирования (зажата левая кнопка мыши).
     * @param {MouseEvent} e
     */
    _startPan(e) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    }

    /**
     * Панорамирование карты при движении мыши.
     * @param {MouseEvent} e
     */
    _pan(e) {
        if (!this.isDragging) return;
        this.cameraX += e.clientX - this.lastMouseX;
        this.cameraY += e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this._clampCamera();
    }

    /**
     * Конец панорамирования (отпущена левая кнопка мыши или мышь покинула canvas).
     */
    _endPan() {
        this.isDragging = false;
    }

    /**
     * Ограничивает камеру, чтобы карта не выходила за пределы canvas.
     */
    _clampCamera() {
        const mapW = this.mapWidth * this.CELL_SIZE * this.zoomLevel;
        const mapH = this.mapHeight * this.CELL_SIZE * this.zoomLevel;

        if (mapW >= this.canvas.width) {
            const minX = this.canvas.width - mapW;
            this.cameraX = Math.max(minX, Math.min(0, this.cameraX));
        } else {
            const maxX = this.canvas.width - mapW;
            this.cameraX = Math.max(0, Math.min(maxX, this.cameraX));
        }

        if (mapH >= this.canvas.height) {
            const minY = this.canvas.height - mapH;
            this.cameraY = Math.max(minY, Math.min(0, this.cameraY));
        } else {
            const maxY = this.canvas.height - mapH;
            this.cameraY = Math.max(0, Math.min(maxY, this.cameraY));
        }
    }
}

/**
 * Утилита для получения CSS-переменной.
 * Используется для получения цветов из :root для отрисовки.
 * @param {string} variable — имя переменной с двумя дефисами, например "--canvas-bg".
 * @returns {string}
 */
function varGet(variable) {
    return getComputedStyle(document.documentElement).getPropertyValue(variable);
}

// При загрузке страницы создаём экземпляр игры
window.addEventListener('DOMContentLoaded', () => {
    new Game();
});
