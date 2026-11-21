// pnpm exec node --test scripts/test-pomodoro-phase-menu.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8');
const ast = ts.createSourceFile('PomodoroTimer.ts', source, ts.ScriptTarget.Latest, true);
const timerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const names = ['showNativeSwitchMenuPopup', 'openPomodoroSettings', 'callMethod', 'toggleFullscreen',
    'setBrowserWindowFullscreen', 'setupBrowserWindowFullscreen', 'exitFullscreen', 'getMiniWindowStyle',
    'getCurrentState', 'updateBrowserWindowContent', 'formatTime',
    'toggleBrowserWindowMiniMode', 'toggleBrowserWindowDock',
    'toggleRandomRest', 'applyRandomRestSettings', 'ensureRandomRestAudioInitialized', 'startRandomRestTimer',
    'stopRandomRestTimer', 'calculateNextRandomRestTime', 'checkRandomRestTrigger',
    'updateSwitchMenuContent', 'updateRandomRestToggleButton', 'updateSettings', 'shouldUseGlobalPomodoroWindow'];
const methods = timerClass.members.filter(node => names.includes(node.name?.getText(ast)))
    .map(node => node.getText(ast)).join('\n');
const hostCode = ts.transpileModule(`class PomodoroTimer { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const rendererCode = source.slice(source.indexOf('        function toggleSwitchMenu(e)'),
    source.indexOf('        function applyMiniStyleClass()'))
    .replaceAll('${actionChannel}', 'pomodoro-action-test');

function fixture({ isCountUp = false, isWorkPhase = true, minimized = false, failFocus = false,
    isMiniMode = false, miniStyle = 'ring', dark = false, randomRestEnabled = false,
    isRunning = false, isPaused = false, startTime = 0, timeLeft = 1500, totalTime = 1500 } = {}) {
    const menus = [];
    const actions = [];
    const messages = [];
    const mainWindowCalls = [];
    let volumeClosed = 0;
    let fullscreen = false;
    let pendingFullscreen = false;
    let displayUpdates = 0;
    let randomRestWindowClosed = 0;
    let nextIntervalId = 1;
    const activeIntervals = new Map();
    const activeTimeouts = new Map();
    const windowCalls = [];
    const rendererScripts = [];
    const owner = Object.assign(new EventEmitter(), {
        webContents: { executeJavaScript: async script => { rendererScripts.push(script); } },
        id: 1,
        isDestroyed: () => false,
        getBounds: () => fullscreen ? { x: 0, y: 0, width: 1920, height: 1080 } : { x: 120, y: 80, width: 150, height: 32 },
        getNormalBounds: () => ({ x: 120, y: 80, width: 150, height: 32 }),
        loadURL: async () => { actions.push('loadURL'); },
        isFullScreen: () => fullscreen,
        setFullScreenable: () => {},
        setAspectRatio: ratio => windowCalls.push(['aspectRatio', ratio]),
        setFullScreen: value => { pendingFullscreen = value; windowCalls.push(['fullscreen', value]); },
        finishFullscreenTransition() {
            fullscreen = pendingFullscreen;
            this.emit(fullscreen ? 'enter-full-screen' : 'leave-full-screen');
        }
    });
    const mainWindow = {
        isDestroyed: () => false,
        isMinimized: () => minimized,
        restore: () => mainWindowCalls.push('restore'),
        show: () => mainWindowCalls.push('show'),
        focus: () => {
            if (failFocus) throw new Error('focus failed');
            mainWindowCalls.push('focus');
        }
    };
    const remote = {
        getCurrentWindow: () => mainWindow,
        nativeImage: {},
        nativeTheme: { shouldUseDarkColors: dark },
        Menu: class {
            constructor() { this.items = []; menus.push(this); }
            append(item) { this.items.push(item); }
            popup(options) { this.options = options; }
        },
        MenuItem: class { constructor(options) { Object.assign(this, options); } }
    };
    const mockWindow = {
        require: () => remote,
        focus: () => mainWindowCalls.push('domFocus'),
        setInterval: (fn, delay) => {
            const id = nextIntervalId++;
            activeIntervals.set(id, { fn, delay });
            return id;
        }
    };
    const Timer = new Function('window', 'i18n', 'console', 'getNativePomodoroMenuIcon', 'showMessage', 'setPomodoroIcon', 'clearInterval', 'clearTimeout', `${hostCode}; return PomodoroTimer;`)(
        mockWindow, key => key, { warn() {}, log() {} },
        (name, nativeImage, color) => ({ name, color }),
        (msg, duration) => messages.push([msg, duration]),
        (el, text) => { if (el) el.text = text; },
        id => activeIntervals.delete(id),
        id => activeTimeouts.delete(id)
    );
    Timer.browserWindowInstance = owner;
    const timer = Object.assign(new Timer(), {
        isCountUp, isWorkPhase, isMiniMode, isRunning, isPaused, startTime, timeLeft, totalTime,
        randomRestEnabled, randomRestSounds: [], randomRestEndSound: null,
        randomRestCheckTimer: null, randomRestEndSoundTimer: null,
        randomRestNextTriggerTime: 0, randomRestWindowCloseTime: 0,
        container: owner,
        settings: { pomodoroMiniWindowStyle: miniStyle, randomRestMinInterval: 3, randomRestMaxInterval: 5 },
        reminder: { title: '测试任务' },
        recordManager: { getTodayFocusTime: () => 0, getWeekFocusTime: () => 0, formatTime: () => '0m' },
        updateDisplay: () => { displayUpdates++; },
        updateBrowserWindowDisplay: () => {},
        preloadBrowserWindowBackgroundAudio: async () => {},
        preloadAudioBuffer: async () => {},
        initRandomRestSounds: async () => { actions.push('initRandomRestSounds'); },
        initRandomRestEndSound: async () => { actions.push('initRandomRestEndSound'); },
        closeRandomRestWindow: () => { randomRestWindowClosed++; },
        scheduleAllMobileNotifications: async () => { actions.push('scheduleAllMobileNotifications'); },
        plugin: { openSetting: key => actions.push(['openSetting', key]) }
    });
    Timer.browserWindowTimer = timer;
    timer.setupBrowserWindowFullscreen(owner);
    for (const method of ['toggleMode', 'startWorkTime', 'startShortBreak', 'startLongBreak', 'editTime']) {
        timer[method] = () => actions.push(method);
    }
    const context = vm.createContext({
        closeVolumeMenu: () => { volumeClosed++; },
        closeSwitchMenu() {},
        ipcRenderer: { send: (channel, method, ...args) => {
            assert.equal(channel, 'pomodoro-action-test');
            timer.callMethod(method, ...args);
        } }
        // 子窗口无需 remote 或 HTML 菜单，普通和迷你模式均通过 IPC 打开完整原生菜单。
    });
    vm.runInContext(rendererCode, context);
    return { menus, actions, messages, owner, timer, mainWindowCalls, windowCalls, rendererScripts, Timer,
        activeIntervals, activeTimeouts,
        get volumeClosed() { return volumeClosed; },
        get displayUpdates() { return displayUpdates; },
        get randomRestWindowClosed() { return randomRestWindowClosed; },
        open(kind = 'all') {
            const entry = { all: 'toggleMiniSwitchMenu', status: 'toggleStatusMenu', more: 'toggleMoreMenu' }[kind];
            vm.runInContext(`${entry}({ stopPropagation() {} })`, context);
            return menus.at(-1);
        }
    };
}

test('状态按钮通过 IPC 打开工作休息状态和计时模式切换', () => {
    const view = fixture();
    const menu = view.open('status');
    assert.equal(menu.options.window, view.owner);
    assert.deepEqual(menu.items.map(item => item.label), ['pomodoroWork', 'pomodoroBreak', 'pomodoroLongBreak', 'switchToCountUp']);
    assert.deepEqual(menu.items.map(item => item.icon.name), ['work', 'shortBreak', 'longBreak', 'timer']);
    assert.ok(menu.items.every(item => !item.submenu));
    for (const item of menu.items) item.click();
    assert.deepEqual(view.actions, ['startWorkTime', 'startShortBreak', 'startLongBreak', 'toggleMode']);
    assert.equal(view.volumeClosed, 1);
});

test('迷你模式将状态放在首层，低频操作放在更多子菜单', () => {
    const view = fixture();
    const mini = view.open();
    assert.equal(mini.items.length, 5);
    assert.deepEqual(mini.items.slice(0, 3).map(item => item.label), ['pomodoroWork', 'pomodoroBreak', 'pomodoroLongBreak']);
    assert.deepEqual(mini.items.slice(0, 3).map(item => item.icon.name), ['work', 'shortBreak', 'longBreak']);
    assert.equal(mini.items[3].label, 'switchToCountUp');
    assert.equal(mini.items[4].label, 'more');
    assert.equal(mini.items[4].submenu.length, 5);
    for (const item of mini.items[4].submenu) assert.equal(typeof item.click, 'function');
    assert.equal(mini.options.window, view.owner);
});

test('更多按钮包含修改时长、随机微休息开关、设置、全屏和音量操作', () => {
    const view = fixture();
    const menu = view.open('more');
    assert.equal(menu.items.length, 5);
    assert.deepEqual(menu.items.map(item => item.icon.name), ['pencil', 'randomRest', 'settings', 'fullscreen', 'volume']);
    assert.ok(menu.items.every(item => item.icon.color === '#333333'));
    assert.deepEqual(menu.items.map(item => item.label), ['pomodoroEditDuration', 'enableRandomRest', 'pomodoroSettings', 'fullscreenMode', 'backgroundVolume']);
    assert.equal(menu.items[3].accelerator, 'F11');
    menu.items[0].click();
    menu.items[2].click();
    assert.deepEqual(view.actions, ['editTime', ['openSetting', 'pomodoroSettings']]);
});

test('普通和迷你菜单从更多打开原有音量面板', () => {
    for (const isMiniMode of [false, true]) {
        const view = fixture({ isMiniMode });
        const item = isMiniMode ? view.open().items[4].submenu[4] : view.open('more').items[4];
        assert.equal(item.label, 'backgroundVolume');
        assert.equal(item.icon.name, 'volume');
        item.click();
        assert.deepEqual(view.rendererScripts, ['toggleVolumeMenu()']);
    }
});

test('每次展开使用当前计时模式和阶段更新标签与时长编辑权限', () => {
    const view = fixture();
    const countdown = view.open('status');
    assert.equal(countdown.items[3].label, 'switchToCountUp');
    assert.equal(view.open('more').items[0].enabled, true);
    view.timer.isCountUp = true;
    const countUp = view.open('status');
    assert.equal(countUp.items[3].label, 'switchToCountdown');
    assert.equal(countUp.items[3].icon.name, 'hourglass');
    assert.equal(view.open('more').items[0].enabled, false);
    view.timer.isWorkPhase = false;
    assert.equal(view.open('more').items[0].enabled, true);
});

test('深色原生菜单的 SVG 图标使用浅色笔画', () => {
    const view = fixture({ dark: true });
    assert.ok(view.open('more').items.every(item => item.icon.color === '#e5e5e5'));
});

test('点击番茄钟设置时显示并聚焦思源窗口', () => {
    const view = fixture();
    view.open('more').items[2].click();
    assert.deepEqual(view.mainWindowCalls, ['show', 'focus']);
    assert.deepEqual(view.actions, [['openSetting', 'pomodoroSettings']]);
});

test('通过 IPC 打开番茄钟设置时恢复最小化的思源窗口', () => {
    const view = fixture({ minimized: true });
    view.timer.callMethod('openPomodoroSettings');
    assert.deepEqual(view.mainWindowCalls, ['restore', 'show', 'focus']);
    assert.deepEqual(view.actions, [['openSetting', 'pomodoroSettings']]);
});

test('窗口激活失败时仍然打开番茄钟设置', () => {
    const view = fixture({ failFocus: true });
    view.open('more').items[2].click();
    assert.deepEqual(view.mainWindowCalls, ['show', 'domFocus']);
    assert.deepEqual(view.actions, [['openSetting', 'pomodoroSettings']]);
});

test('普通和迷你菜单支持进入全屏，原生事件完成后菜单变为退出全屏', () => {
    for (const isMiniMode of [false, true]) {
        const view = fixture({ isMiniMode });
        const item = isMiniMode ? view.open().items[4].submenu[3] : view.open('more').items[3];
        assert.equal(item.label, 'fullscreenMode');
        item.click();
        assert.deepEqual(view.windowCalls, [['aspectRatio', 0], ['fullscreen', true]]);
        assert.equal(view.timer.isMiniMode, isMiniMode);
        view.owner.finishFullscreenTransition();
        assert.equal(view.timer.isFullscreen, true);
        const exitItem = isMiniMode ? view.open().items[4].submenu[3] : view.open('more').items[3];
        assert.equal(exitItem.label, 'exitFullscreen');
        assert.equal(exitItem.icon.name, 'exitFullscreen');
    }
});

test('更多菜单快捷开关随机微休息在计时中不中断主计时且仅启停微休息调度', () => {
    const startTime = Date.now() - 120000;
    const mainTimerHandle = { main: true };
    const view = fixture({
        randomRestEnabled: true,
        isRunning: true,
        isPaused: false,
        isWorkPhase: true,
        startTime,
        timeLeft: 1380,
        totalTime: 1500
    });
    view.timer.timer = mainTimerHandle;
    view.timer.settings.randomRestSounds = 'rest-start.mp3';
    view.timer.settings.randomRestEndSound = 'rest-end.mp3';
    view.timer.startRandomRestTimer();
    assert.equal(view.activeIntervals.size, 1);

    // 1. 当前已开启，菜单显示关闭随机微休息
    const disableItem = view.open('more').items[1];
    assert.equal(disableItem.label, 'disableRandomRest');
    assert.equal(disableItem.icon.name, 'randomRestOff');
    disableItem.click();

    assert.equal(view.timer.randomRestEnabled, false);
    assert.equal(view.activeIntervals.size, 0);
    assert.equal(view.timer.randomRestNextTriggerTime, 0);
    assert.equal(view.timer.randomRestWindowCloseTime, 0);
    assert.equal(view.randomRestWindowClosed >= 1, true);
    // 主计时器状态与窗口内容未被重置或重载
    assert.equal(view.timer.isRunning, true);
    assert.equal(view.timer.isPaused, false);
    assert.equal(view.timer.startTime, startTime);
    assert.equal(view.timer.timeLeft, 1380);
    assert.equal(view.timer.totalTime, 1500);
    assert.equal(view.timer.timer, mainTimerHandle);
    assert.equal(view.actions.includes('loadURL'), false);
    assert.deepEqual(view.messages.at(-1), ['randomRestTurnedOff', 1500]);

    // 2. 再次打开菜单显示开启随机微休息，点击后仅重启微休息调度并按需加载音频
    const enableItem = view.open('more').items[1];
    assert.equal(enableItem.label, 'enableRandomRest');
    assert.equal(enableItem.icon.name, 'randomRest');
    enableItem.click();

    assert.equal(view.timer.randomRestEnabled, true);
    assert.equal(view.activeIntervals.size, 1);
    assert.ok(view.timer.randomRestNextTriggerTime > Date.now());
    assert.equal(view.actions.includes('initRandomRestSounds'), true);
    assert.equal(view.actions.includes('initRandomRestEndSound'), true);
    assert.equal(view.timer.isRunning, true);
    assert.equal(view.timer.isPaused, false);
    assert.equal(view.timer.startTime, startTime);
    assert.equal(view.timer.timeLeft, 1380);
    assert.equal(view.timer.timer, mainTimerHandle);
    assert.equal(view.actions.includes('loadURL'), false);
    assert.deepEqual(view.messages.at(-1), ['randomRestTurnedOn', 1500]);
});

test('未运行、暂停或休息阶段切换随机微休息不会提前启动微休息定时器，也不修改计时状态', () => {
    for (const state of [
        { isRunning: false, isPaused: false, isWorkPhase: true },
        { isRunning: true, isPaused: true, isWorkPhase: true },
        { isRunning: true, isPaused: false, isWorkPhase: false }
    ]) {
        const view = fixture({ ...state, randomRestEnabled: false, timeLeft: 900, totalTime: 1500 });
        view.open('more').items[1].click();
        assert.equal(view.timer.randomRestEnabled, true);
        assert.equal(view.activeIntervals.size, 0);
        assert.equal(view.timer.isRunning, state.isRunning);
        assert.equal(view.timer.isPaused, state.isPaused);
        assert.equal(view.timer.timeLeft, 900);
        assert.equal(view.displayUpdates, 1);
    }
});

test('迷你菜单和 DOM 切换菜单同步更新随机微休息按钮文案', () => {
    const view = fixture({ isMiniMode: true, randomRestEnabled: false });
    view.timer.randomRestToggleBtn = {};
    view.timer.updateSwitchMenuContent();
    assert.equal(view.timer.randomRestToggleBtn.text, '🎲 enableRandomRest');

    const miniItem = view.open().items[4].submenu[1];
    assert.equal(miniItem.label, 'enableRandomRest');
    miniItem.click();
    assert.equal(view.timer.randomRestEnabled, true);
    assert.equal(view.timer.randomRestToggleBtn.text, '🎲 disableRandomRest');
    assert.equal(view.open().items[4].submenu[1].label, 'disableRandomRest');
});

test('插件设置开启或关闭随机微休息时不影响当前正在计时的番茄钟与自定义时长', () => {
    const startTime = Date.now() - 180000;
    const mainTimerHandle = { main: true };
    const view = fixture({
        randomRestEnabled: true,
        isRunning: true,
        isPaused: false,
        isWorkPhase: true,
        startTime,
        timeLeft: 720,
        totalTime: 900
    });
    view.timer.timer = mainTimerHandle;
    view.timer.settings = {
        ...view.timer.settings,
        workDuration: 15,
        randomRestEnabled: true,
        randomRestMinInterval: 3,
        randomRestMaxInterval: 5,
        randomRestBreakDuration: 10,
        randomRestSounds: 'start.mp3',
        randomRestEndSound: 'end.mp3',
        randomRestVolume: 0.8,
        randomRestEndVolume: 0.9
    };
    view.timer.pauseTimer = () => { assert.fail('设置开关随机微休息不得暂停主计时器'); };
    view.timer.resumeTimer = () => { assert.fail('设置开关随机微休息不得重启主计时器'); };
    view.timer.stopAllAudio = () => { assert.fail('设置开关随机微休息不得停止背景音频'); };
    view.timer.startRandomRestTimer();
    assert.equal(view.activeIntervals.size, 1);

    // 在插件设置中关闭随机微休息（全局默认时长为 25 分钟，但当前任务是 15 分钟）
    view.timer.applyRandomRestSettings({
        workDuration: 25,
        randomRestEnabled: false,
        randomRestMinInterval: 3,
        randomRestMaxInterval: 5,
        randomRestBreakDuration: 10,
        randomRestSounds: 'start.mp3',
        randomRestEndSound: 'end.mp3',
        randomRestVolume: 0.8,
        randomRestEndVolume: 0.9
    }, { syncEnabled: true });

    assert.equal(view.timer.randomRestEnabled, false);
    assert.equal(view.activeIntervals.size, 0);
    assert.equal(view.timer.isRunning, true);
    assert.equal(view.timer.isPaused, false);
    assert.equal(view.timer.startTime, startTime);
    assert.equal(view.timer.timeLeft, 720);
    assert.equal(view.timer.totalTime, 900);
    assert.equal(view.timer.settings.workDuration, 15);
    assert.equal(view.timer.timer, mainTimerHandle);
    assert.equal(view.actions.includes('loadURL'), false);

    // 在插件设置中重新开启随机微休息，重复同步保持幂等且不重置下次触发时间
    view.timer.applyRandomRestSettings({
        workDuration: 25,
        randomRestEnabled: true,
        randomRestMinInterval: 3,
        randomRestMaxInterval: 5,
        randomRestBreakDuration: 10,
        randomRestSounds: 'start.mp3',
        randomRestEndSound: 'end.mp3',
        randomRestVolume: 0.8,
        randomRestEndVolume: 0.9
    }, { syncEnabled: true });
    const scheduledTrigger = view.timer.randomRestNextTriggerTime;
    assert.equal(view.timer.randomRestEnabled, true);
    assert.equal(view.activeIntervals.size, 1);
    assert.ok(scheduledTrigger > Date.now());

    view.timer.applyRandomRestSettings({
        workDuration: 25,
        randomRestEnabled: true,
        randomRestMinInterval: 3,
        randomRestMaxInterval: 5,
        randomRestBreakDuration: 10,
        randomRestSounds: 'start.mp3',
        randomRestEndSound: 'end.mp3',
        randomRestVolume: 0.8,
        randomRestEndVolume: 0.9
    }, { syncEnabled: true });
    assert.equal(view.timer.randomRestNextTriggerTime, scheduledTrigger);
    assert.equal(view.timer.settings.workDuration, 15);
    assert.equal(view.timer.timeLeft, 720);
});

test('修改其他随机微休息参数时不会覆盖当前任务在更多菜单中手动关闭的状态', () => {
    const view = fixture({ randomRestEnabled: false, isRunning: true, isPaused: false, isWorkPhase: true });
    view.timer.applyRandomRestSettings({
        randomRestEnabled: true,
        randomRestMinInterval: 4,
        randomRestMaxInterval: 6,
        randomRestBreakDuration: 15
    }, { syncEnabled: false });

    assert.equal(view.timer.randomRestEnabled, false);
    assert.equal(view.timer.settings.randomRestBreakDuration, 15);
    assert.equal(view.activeIntervals.size, 0);
});

test('updateSettings 在窗口布局未变化时只同步显示，不重载独立窗口', async () => {
    const view = fixture({ isRunning: true, miniStyle: 'ring' });
    let displaySynced = 0;
    view.timer.supportsGlobalPomodoroWindow = () => true;
    view.timer.updateBrowserWindowDisplay = () => { displaySynced++; };
    view.timer.settings = {
        ...view.timer.settings,
        pomodoroDockPosition: 'right',
        pomodoroMiniWindowStyle: 'ring',
        globalWindowEnabled: true
    };
    await view.timer.updateSettings({
        ...view.timer.settings,
        dailyFocusGoal: 3
    });
    assert.equal(displaySynced, 1);
    assert.equal(view.actions.includes('loadURL'), false);
});

test('退出全屏恢复圆环比例，横条和极简保持自由比例且不改窗口大小', () => {
    for (const miniStyle of ['ring', 'horizontal', 'minimal']) {
        const view = fixture({ isMiniMode: true, miniStyle });
        view.timer.toggleFullscreen();
        view.owner.finishFullscreenTransition();
        view.timer.callMethod('exitFullscreen');
        view.owner.finishFullscreenTransition();
        assert.equal(view.timer.isFullscreen, false);
        assert.deepEqual(view.windowCalls.at(-1), ['aspectRatio', miniStyle === 'ring' ? 1 : 0]);
        assert.equal(view.timer.isMiniMode, true);
    }
});

test('窗口复用后全屏事件同步当前任务实例，重复设置不会累积监听器', () => {
    const view = fixture();
    const nextTimer = Object.assign(new view.Timer(), { isMiniMode: false, updateBrowserWindowDisplay() {} });
    view.Timer.browserWindowTimer = nextTimer;
    nextTimer.setupBrowserWindowFullscreen(view.owner);
    assert.equal(view.owner.listenerCount('enter-full-screen'), 1);
    assert.equal(view.owner.listenerCount('leave-full-screen'), 1);
    view.timer.toggleFullscreen();
    view.owner.finishFullscreenTransition();
    assert.equal(nextTimer.isFullscreen, true);
    assert.notEqual(view.timer.isFullscreen, true);
});

test('全屏切换任务时继承原窗口 bounds，重新加载不会把全屏窗口缩小', async () => {
    const view = fixture({ isMiniMode: true, miniStyle: 'horizontal' });
    view.timer.toggleFullscreen();
    view.owner.finishFullscreenTransition();
    const state = view.timer.getCurrentState();
    assert.equal(state.isFullscreen, true);
    assert.deepEqual(state.windowBounds, { x: 120, y: 80, width: 150, height: 32 });
    view.timer.getPomodoroColors = () => ({});
    view.timer.adjustColor = () => '#ccc';
    view.timer.getPomodoroBrowserWindowFontConfig = () => ({});
    view.timer.generateBrowserWindowHTML = () => '<html></html>';
    view.timer.isBackgroundAudioMuted = true;
    view.owner.setSize = view.owner.setBounds = () => { assert.fail('全屏重载不得修改窗口大小'); };
    await view.timer.updateBrowserWindowContent(view.owner);
    assert.equal(view.owner.isFullScreen(), true);
    assert.deepEqual(view.windowCalls.at(-1), ['aspectRatio', 0]);
});

test('全屏切换 mini 或吸附模式时等待原生退出完成后再执行', () => {
    for (const method of ['toggleBrowserWindowMiniMode', 'toggleBrowserWindowDock']) {
        const view = fixture();
        view.timer.toggleFullscreen();
        view.owner.finishFullscreenTransition();
        view.timer[method](view.owner);
        let switched = false;
        view.timer[method] = () => { switched = true; assert.equal(view.owner.isFullScreen(), false); };
        assert.equal(switched, false);
        assert.deepEqual(view.windowCalls.at(-1), ['fullscreen', false]);
        view.owner.finishFullscreenTransition();
        assert.equal(switched, true);
    }
});
