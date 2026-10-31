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
    isMiniMode = false, miniStyle = 'ring' } = {}) {
    const menus = [];
    const actions = [];
    const mainWindowCalls = [];
    let volumeClosed = 0;
    let fullscreen = false;
    let pendingFullscreen = false;
    const windowCalls = [];
    const owner = Object.assign(new EventEmitter(), {
        webContents: { executeJavaScript: async () => {} },
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
        Menu: class {
            constructor() { this.items = []; menus.push(this); }
            append(item) { this.items.push(item); }
            popup(options) { this.options = options; }
        },
        MenuItem: class { constructor(options) { Object.assign(this, options); } }
    };
    const Timer = new Function('window', 'i18n', 'console', `${hostCode}; return PomodoroTimer;`)(
        { require: () => remote, focus: () => mainWindowCalls.push('domFocus') }, key => key, { warn() {} }
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
    return { menus, actions, owner, timer, mainWindowCalls, windowCalls, Timer,
        get volumeClosed() { return volumeClosed; },
        open(mini = false) {
            vm.runInContext(`${mini ? 'toggleMiniSwitchMenu' : 'toggleSwitchMenu'}({ stopPropagation() {} })`, context);
            return menus.at(-1);
        }
    };
}

test('普通模式设置菜单和状态二级菜单属于同一个原生菜单树', () => {
    const view = fixture();
    const menu = view.open();
    assert.equal(menu.options.window, view.owner);
    assert.equal(menu.items.length, 5);
    assert.equal(menu.items[1].label, '🔄 pomodoroSwitchStatus');
    assert.equal(menu.items[1].submenu.length, 3);
    assert.equal(view.volumeClosed, 1);
});

test('迷你模式复用相同的完整原生菜单入口', () => {
    const view = fixture();
    const normal = view.open();
    const mini = view.open(true);
    assert.deepEqual(mini.items.map(item => item.label), normal.items.map(item => item.label));
    assert.equal(mini.options.window, view.owner);
});

test('原生菜单保留模式、状态、修改时长和设置操作', () => {
    const view = fixture();
    const menu = view.open();
    menu.items[0].click();
    for (const item of menu.items[1].submenu) item.click();
    menu.items[2].click();
    menu.items[3].click();
    assert.deepEqual(view.actions, ['toggleMode', 'startWorkTime', 'startShortBreak', 'startLongBreak',
        'editTime', ['openSetting', 'pomodoroSettings']]);
});

test('每次展开使用当前计时模式和阶段更新标签与时长编辑权限', () => {
    const view = fixture();
    const countdown = view.open();
    assert.equal(countdown.items[0].label, '⏱ switchToCountUp');
    assert.equal(countdown.items[2].enabled, true);
    view.timer.isCountUp = true;
    const countUp = view.open();
    assert.equal(countUp.items[0].label, '🍅 switchToCountdown');
    assert.equal(countUp.items[2].enabled, false);
    view.timer.isWorkPhase = false;
    assert.equal(view.open().items[2].enabled, true);
});

test('点击番茄钟设置时显示并聚焦思源窗口', () => {
    const view = fixture();
    view.open().items[3].click();
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
    view.open().items[3].click();
    assert.deepEqual(view.mainWindowCalls, ['show', 'domFocus']);
    assert.deepEqual(view.actions, [['openSetting', 'pomodoroSettings']]);
});

test('普通和迷你菜单支持进入全屏，原生事件完成后菜单变为退出全屏', () => {
    for (const isMiniMode of [false, true]) {
        const view = fixture({ isMiniMode });
        const item = view.open(isMiniMode).items[4];
        assert.equal(item.label, '⛶ fullscreenMode');
        item.click();
        assert.deepEqual(view.windowCalls, [['aspectRatio', 0], ['fullscreen', true]]);
        assert.equal(view.timer.isMiniMode, isMiniMode);
        view.owner.finishFullscreenTransition();
        assert.equal(view.timer.isFullscreen, true);
        assert.equal(view.open(isMiniMode).items[4].label, '⛶ exitFullscreen');
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
