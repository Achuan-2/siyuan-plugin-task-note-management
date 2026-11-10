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
    'toggleBrowserWindowMiniMode', 'toggleBrowserWindowDock'];
const methods = timerClass.members.filter(node => names.includes(node.name?.getText(ast)))
    .map(node => node.getText(ast)).join('\n');
const hostCode = ts.transpileModule(`class PomodoroTimer { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const rendererCode = source.slice(source.indexOf('        function toggleSwitchMenu(e)'),
    source.indexOf('        function applyMiniStyleClass()'))
    .replaceAll('${actionChannel}', 'pomodoro-action-test');

function fixture({ isCountUp = false, isWorkPhase = true, minimized = false, failFocus = false,
    isMiniMode = false, miniStyle = 'ring', dark = false } = {}) {
    const menus = [];
    const actions = [];
    const mainWindowCalls = [];
    let volumeClosed = 0;
    let fullscreen = false;
    let pendingFullscreen = false;
    const windowCalls = [];
    const rendererScripts = [];
    const owner = Object.assign(new EventEmitter(), {
        webContents: { executeJavaScript: async script => { rendererScripts.push(script); } },
        id: 1,
        isDestroyed: () => false,
        getBounds: () => fullscreen ? { x: 0, y: 0, width: 1920, height: 1080 } : { x: 120, y: 80, width: 150, height: 32 },
        getNormalBounds: () => ({ x: 120, y: 80, width: 150, height: 32 }),
        loadURL: async () => {},
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
    const Timer = new Function('window', 'i18n', 'console', 'getNativePomodoroMenuIcon', `${hostCode}; return PomodoroTimer;`)(
        { require: () => remote, focus: () => mainWindowCalls.push('domFocus') }, key => key, { warn() {} },
        (name, nativeImage, color) => ({ name, color })
    );
    Timer.browserWindowInstance = owner;
    const timer = Object.assign(new Timer(), { isCountUp, isWorkPhase, isMiniMode, container: owner,
        settings: { pomodoroMiniWindowStyle: miniStyle },
        reminder: { title: '测试任务' },
        recordManager: { getTodayFocusTime: () => 0, getWeekFocusTime: () => 0, formatTime: () => '0m' },
        updateBrowserWindowDisplay: () => {},
        plugin: { openSetting: key => actions.push(['openSetting', key]) } });
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
    return { menus, actions, owner, timer, mainWindowCalls, windowCalls, rendererScripts, Timer,
        get volumeClosed() { return volumeClosed; },
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
    assert.deepEqual(menu.items.map(item => item.label), ['🍅 pomodoroWork', '🍵 pomodoroBreak', '🧘 pomodoroLongBreak', 'switchToCountUp']);
    assert.ok(menu.items.every(item => !item.submenu));
    for (const item of menu.items) item.click();
    assert.deepEqual(view.actions, ['startWorkTime', 'startShortBreak', 'startLongBreak', 'toggleMode']);
    assert.equal(view.volumeClosed, 1);
});

test('迷你模式将状态放在首层，低频操作放在更多子菜单', () => {
    const view = fixture();
    const mini = view.open();
    assert.equal(mini.items.length, 5);
    assert.deepEqual(mini.items.slice(0, 3).map(item => item.label), ['🍅 pomodoroWork', '🍵 pomodoroBreak', '🧘 pomodoroLongBreak']);
    assert.equal(mini.items[3].label, 'switchToCountUp');
    assert.equal(mini.items[4].label, 'more');
    assert.equal(mini.items[4].submenu.length, 4);
    for (const item of mini.items[4].submenu) assert.equal(typeof item.click, 'function');
    assert.equal(mini.options.window, view.owner);
});

test('更多按钮只包含修改时长、设置、全屏和音量操作', () => {
    const view = fixture();
    const menu = view.open('more');
    assert.equal(menu.items.length, 4);
    assert.deepEqual(menu.items.map(item => item.icon.name), ['pencil', 'settings', 'fullscreen', 'volume']);
    assert.ok(menu.items.every(item => item.icon.color === '#333333'));
    assert.deepEqual(menu.items.map(item => item.label), ['pomodoroEditDuration', 'pomodoroSettings', 'fullscreenMode', 'backgroundVolume']);
    assert.equal(menu.items[2].accelerator, 'F11');
    menu.items[0].click();
    menu.items[1].click();
    assert.deepEqual(view.actions, ['editTime', ['openSetting', 'pomodoroSettings']]);
});

test('普通和迷你菜单从更多打开原有音量面板', () => {
    for (const isMiniMode of [false, true]) {
        const view = fixture({ isMiniMode });
        const item = isMiniMode ? view.open().items[4].submenu[3] : view.open('more').items[3];
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
    view.open('more').items[1].click();
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
    view.open('more').items[1].click();
    assert.deepEqual(view.mainWindowCalls, ['show', 'domFocus']);
    assert.deepEqual(view.actions, [['openSetting', 'pomodoroSettings']]);
});

test('普通和迷你菜单支持进入全屏，原生事件完成后菜单变为退出全屏', () => {
    for (const isMiniMode of [false, true]) {
        const view = fixture({ isMiniMode });
        const item = isMiniMode ? view.open().items[4].submenu[2] : view.open('more').items[2];
        assert.equal(item.label, 'fullscreenMode');
        item.click();
        assert.deepEqual(view.windowCalls, [['aspectRatio', 0], ['fullscreen', true]]);
        assert.equal(view.timer.isMiniMode, isMiniMode);
        view.owner.finishFullscreenTransition();
        assert.equal(view.timer.isFullscreen, true);
        const exitItem = isMiniMode ? view.open().items[4].submenu[2] : view.open('more').items[2];
        assert.equal(exitItem.label, 'exitFullscreen');
        assert.equal(exitItem.icon.name, 'exitFullscreen');
    }
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
