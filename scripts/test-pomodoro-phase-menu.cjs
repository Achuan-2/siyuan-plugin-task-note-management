// pnpm exec node --test scripts/test-pomodoro-phase-menu.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8');
const ast = ts.createSourceFile('PomodoroTimer.ts', source, ts.ScriptTarget.Latest, true);
const timerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const names = ['showNativeSwitchMenuPopup', 'openPomodoroSettings', 'callMethod'];
const methods = timerClass.members.filter(node => names.includes(node.name?.getText(ast)))
    .map(node => node.getText(ast)).join('\n');
const hostCode = ts.transpileModule(`class PomodoroTimer { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const rendererCode = source.slice(source.indexOf('        function toggleSwitchMenu(e)'),
    source.indexOf('        function applyMiniStyleClass()'))
    .replaceAll('${actionChannel}', 'pomodoro-action-test');

function fixture({ isCountUp = false, isWorkPhase = true, minimized = false, failFocus = false } = {}) {
    const menus = [];
    const actions = [];
    const mainWindowCalls = [];
    let volumeClosed = 0;
    const owner = { isDestroyed: () => false };
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
    const timer = Object.assign(new Timer(), { isCountUp, isWorkPhase,
        plugin: { openSetting: key => actions.push(['openSetting', key]) } });
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
    return { menus, actions, owner, timer, mainWindowCalls,
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
    assert.equal(menu.items.length, 4);
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
