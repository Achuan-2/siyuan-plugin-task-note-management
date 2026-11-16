const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function methods(file, className, names) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    const selected = declaration.members.filter(node => names.includes(node.name?.getText(ast)));
    assert.equal(selected.length, names.length);
    return ts.transpileModule(`class ${className} { ${selected.map(node => node.getText(ast)).join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText;
}
const nativeCode = methods('src/components/panel/PomodoroTimer.ts', 'PomodoroTimer', [
    'isWindowFromWorkspace', 'scanForOrphanedWindow', 'toggleExistingStandaloneWindow', 'isStandaloneWindow', 'showFloatingWindow'
]);
const pluginCode = methods('src/index.ts', 'ReminderPlugin', ['syncPomodoroTopBar', 'togglePomodoroWindow']);

function nativeWindow({ workspace = 'workspace-a', visible = true, minimized = false, destroyed = false,
    pomodoro = true, title = 'Pomodoro Timer' } = {}) {
    const calls = [];
    return {
        calls,
        webContents: { executeJavaScript: async source => source.includes('isPomodoroWindow') ? pomodoro : workspace },
        getTitle: () => title,
        isDestroyed: () => destroyed,
        isVisible: () => visible,
        isMinimized: () => minimized,
        restore() { minimized = false; calls.push('restore'); },
        show() { visible = true; calls.push('show'); },
        hide() { visible = false; calls.push('hide'); },
        focus() { calls.push('focus'); }
    };
}
function nativeFixture(windows) {
    const remote = { BrowserWindow: { getAllWindows: () => windows } };
    const Timer = new Function('window', `${nativeCode}; return PomodoroTimer;`)({ require: () => remote, siyuan: { zIndex: 100 } });
    return { Timer, plugin: { getWorkspaceDir: () => 'workspace-a' } };
}

test('原生窗口可反复显示和隐藏，不结束、暂停或更换原计时器', async () => {
    const win = nativeWindow();
    const { Timer, plugin } = nativeFixture([win]);
    const running = { sessionId: 'session-a', remaining: 712, paused: false };
    Timer.browserWindowTimer = running;
    assert.equal(await Timer.toggleExistingStandaloneWindow(plugin), true);
    assert.equal(win.isVisible(), false);
    assert.deepEqual(win.calls, ['hide']);
    assert.equal(await Timer.toggleExistingStandaloneWindow(plugin), true);
    assert.equal(win.isVisible(), true);
    assert.deepEqual(win.calls, ['hide', 'show', 'focus']);
    assert.equal(Timer.browserWindowTimer, running);
    assert.deepEqual(running, { sessionId: 'session-a', remaining: 712, paused: false });
});

for (const visible of [false, true]) {
    test(`最小化时恢复并聚焦原窗口（Electron 可见性为 ${visible}）`, async () => {
        const win = nativeWindow({ minimized: true, visible });
        const { Timer, plugin } = nativeFixture([win]);
        await Timer.toggleExistingStandaloneWindow(plugin);
        assert.deepEqual(win.calls, ['restore', 'show', 'focus']);
    });
}

test('跨思源窗口只控制同工作区的番茄窗口，不接管计时或打开副本', async () => {
    const other = nativeWindow({ workspace: 'workspace-b' });
    const dialog = nativeWindow({ pomodoro: false, title: 'Pomodoro reminder' });
    const closed = nativeWindow({ destroyed: true });
    const current = nativeWindow({ visible: false });
    const { Timer, plugin } = nativeFixture([other, dialog, closed, current]);
    assert.equal(await Timer.toggleExistingStandaloneWindow(plugin), true);
    assert.deepEqual(current.calls, ['show', 'focus']);
    for (const win of [other, dialog, closed]) assert.deepEqual(win.calls, []);
    assert.equal(Timer.browserWindowTimer, undefined);
});

test('没有窗口、窗口已销毁或关闭、使用内部窗口时，不误判为可用独立窗口', async () => {
    const closed = nativeWindow({ destroyed: true });
    const { Timer, plugin } = nativeFixture([closed]);
    assert.equal(await Timer.toggleExistingStandaloneWindow(plugin), false);
    const timer = new Timer();
    timer.container = {};
    assert.equal(timer.isStandaloneWindow(), false);
    timer.container = nativeWindow();
    assert.equal(timer.isStandaloneWindow(), true);
    timer.isWindowClosed = true;
    assert.equal(timer.isStandaloneWindow(), false);
    timer.isWindowClosed = false;
    timer.isTabMode = true;
    assert.equal(timer.isStandaloneWindow(), false);
});

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function pluginFixture({ frontend = 'desktop', electron = true, current = null, windowExists = false,
    readiness = Promise.resolve(), failCreation = false, standalone = true, mobileApp = false, floating = true } = {}) {
    const buttons = [], created = [], notices = [], errors = [], existingCalls = [];
    const manager = {
        getCurrentPomodoroTimer: () => current,
        setCurrentPomodoroTimer: timer => { current = timer; },
        hasActivePomodoroTimer: () => !!current?.isWindowActive(),
        cleanupInactiveTimer: () => { if (current && !current.isWindowActive()) current = null; }
    };
    class Timer {
        static async toggleExistingStandaloneWindow(plugin) { existingCalls.push(plugin); return windowExists; }
        constructor(reminder, settings, isCountUp, inheritState, plugin) {
            Object.assign(this, { reminder, settings, isCountUp, plugin, showCalls: [], floatingShows: 0, destroyed: false });
            created.push(this);
        }
        async show(autoStart) {
            this.showCalls.push(autoStart);
            await readiness;
            if (failCreation) throw new Error('Cannot create window');
        }
        isStandaloneWindow() { return standalone && !this.destroyed; }
        async showFloatingWindow() { this.floatingShows++; return floating && !this.destroyed; }
        isWindowActive() { return !this.destroyed; }
        destroy() { this.destroyed = true; }
    }
    const settings = { globalWindowEnabled: false, workDuration: 45 };
    const Plugin = new Function('require', 'getFrontend', 'window', 'i18n', 'showMessage', 'PomodoroManager', 'console',
        `${pluginCode}; return ReminderPlugin;`)(
        () => ({ PomodoroTimer: Timer }), () => frontend, electron ? { require() {} } : {},
        key => key, (...args) => notices.push(args), { getInstance: () => manager }, { error: (...args) => errors.push(args) }
    );
    const plugin = Object.assign(new Plugin(), {
        isInMobileApp: mobileApp, storageDisposed: false, pomodoroTopBarBusy: false,
        addTopBar(options) { const element = { style: {} }; buttons.push({ ...options, element }); return element; },
        getPomodoroSettings: async () => settings
    });
    return { plugin, buttons, created, notices, errors, settings, manager, existingCalls };
}

test('桌面顶栏只注册一个番茄按钮，设置可即时隐藏和恢复按钮', async () => {
    const view = pluginFixture();
    view.plugin.syncPomodoroTopBar({});
    view.plugin.syncPomodoroTopBar({});
    assert.equal(view.buttons.length, 1);
    assert.equal(view.buttons[0].icon, 'iconTNPomodoro');
    view.plugin.syncPomodoroTopBar({ enablePomodoroTopBar: false });
    assert.equal(view.buttons[0].element.style.display, 'none');
    view.plugin.syncPomodoroTopBar({ enablePomodoroTopBar: true });
    assert.equal(view.buttons[0].element.style.display, '');
    const clicked = deferred();
    view.plugin.togglePomodoroWindow = () => { clicked.resolve(); };
    view.buttons[0].callback();
    await clicked.promise;
});

for (const options of [{ frontend: 'browser-desktop' }, { electron: false }]) {
    test(`不在不支持独立窗口的环境注册按钮：${JSON.stringify(options)}`, () => {
        const view = pluginFixture(options);
        view.plugin.syncPomodoroTopBar({});
        assert.equal(view.buttons.length, 0);
    });
}

for (const options of [
    { frontend: 'mobile', electron: false },
    { frontend: 'browser-mobile', electron: false },
    { frontend: 'desktop', mobileApp: true }
]) {
    test(`移动端菜单提供入口且只打开待开始内部悬浮窗：${JSON.stringify(options)}`, async () => {
        const view = pluginFixture(options);
        view.plugin.syncPomodoroTopBar({});
        assert.equal(view.buttons.length, 1);
        assert.equal(view.buttons[0].title, 'showPomodoroFloatingWindow');
        await view.plugin.togglePomodoroWindow();
        assert.equal(view.created.length, 1);
        assert.equal(view.created[0].settings.globalWindowEnabled, false);
        assert.deepEqual(view.created[0].showCalls, [false]);
        assert.equal(view.created[0].floatingShows, 1);
        assert.equal(view.existingCalls.length, 0, '不访问 Electron 或其他桌面窗口');
        view.plugin.syncPomodoroTopBar({ enablePomodoroTopBar: false });
        assert.equal(view.buttons[0].element.style.display, 'none');
    });
}

test('移动端反复点击只显示已有内部悬浮窗，不切换任务或计时状态', async () => {
    let reveals = 0;
    const current = {
        show: async value => assert.equal(value, false), isWindowActive: () => true,
        showFloatingWindow: async () => { reveals++; return true; },
        isPaused: true, timeLeft: 720, activeWorkSessionId: 'existing-session'
    };
    const view = pluginFixture({ frontend: 'mobile', electron: false, current });
    await view.plugin.togglePomodoroWindow();
    await view.plugin.togglePomodoroWindow();
    assert.equal(reveals, 2);
    assert.equal(view.created.length, 0);
    assert.equal(view.existingCalls.length, 0);
    assert.equal(current.isPaused, true);
    assert.equal(current.timeLeft, 720);
    assert.equal(current.activeWorkSessionId, 'existing-session');
});

test('移动端内部窗口已关闭时重新打开，不继承已结束的计时', async () => {
    const current = { show: async () => {}, isWindowActive: () => false, showFloatingWindow: async () => false };
    const view = pluginFixture({ frontend: 'mobile', electron: false, current });
    await view.plugin.togglePomodoroWindow();
    assert.equal(view.created.length, 1);
    assert.deepEqual(view.created[0].showCalls, [false]);
    assert.equal(view.created[0].settings.globalWindowEnabled, false);
});

test('移动端已有其他视图计时器时保留原实例，不创建第二个计时器', async () => {
    const current = { show: async () => {}, isWindowActive: () => true, showFloatingWindow: async () => false };
    const view = pluginFixture({ frontend: 'mobile', electron: false, current });
    await view.plugin.togglePomodoroWindow();
    assert.equal(view.created.length, 0);
    assert.equal(view.notices[0][0], 'pomodoroWindowInOtherView');
    assert.equal(view.manager.getCurrentPomodoroTimer(), current);
});

test('移动端悬浮窗创建失败时清理新实例，允许下次重试', async () => {
    const view = pluginFixture({ frontend: 'mobile', electron: false, floating: false });
    await view.plugin.togglePomodoroWindow();
    assert.equal(view.created[0].destroyed, true);
    assert.equal(view.manager.getCurrentPomodoroTimer(), null);
    assert.equal(view.plugin.pomodoroTopBarBusy, false);
});

test('内部悬浮窗唤出时等待初始化，恢复最小化与吸附并移入屏幕，不更改计时', async () => {
    const { Timer } = nativeFixture([]);
    const ready = deferred();
    const events = [];
    const container = { hidden: true, style: { display: 'none', visibility: 'hidden' } };
    const timer = Object.assign(new Timer(), {
        container, componentsReady: ready.promise, isMinimized: true, isDocked: true,
        isWindowActive: () => true, isStandaloneWindow: () => false,
        exitDOMWindowDock() { events.push('undock'); this.isDocked = false; },
        restore() { events.push('restore'); this.isMinimized = false; },
        ensureDomContainerWithinBounds: margin => events.push(['bounds', margin]),
        isRunning: true, isPaused: true, timeLeft: 300, activeWorkSessionId: 'same-record'
    });
    const operation = timer.showFloatingWindow();
    assert.equal(container.hidden, true);
    ready.resolve();
    assert.equal(await operation, true);
    assert.equal(container.hidden, false);
    assert.equal(container.style.display, '');
    assert.equal(container.style.visibility, '');
    assert.equal(container.style.zIndex, '101');
    assert.deepEqual(events, ['undock', 'restore', ['bounds', 8]]);
    assert.equal(timer.isPaused, true);
    assert.equal(timer.timeLeft, 300);
    assert.equal(timer.activeWorkSessionId, 'same-record');
    container.style.display = 'flex';
    await timer.showFloatingWindow();
    assert.equal(container.style.display, 'flex', '保留全屏布局的 display 设置');
});

for (const status of ['closed', 'tab', 'standalone']) {
    test(`内部悬浮窗唤出不会操作${status}计时器`, async () => {
        const { Timer } = nativeFixture([]);
        const timer = Object.assign(new Timer(), {
            componentsReady: Promise.resolve(), isTabMode: status === 'tab',
            isWindowActive: () => status !== 'closed', isStandaloneWindow: () => status === 'standalone'
        });
        assert.equal(await timer.showFloatingWindow(), false);
    });
}

test('首次点击打开独立待开始窗口，保留持久设置，连续点击不重复创建', async () => {
    const readiness = deferred();
    const view = pluginFixture({ readiness: readiness.promise });
    const first = view.plugin.togglePomodoroWindow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const second = view.plugin.togglePomodoroWindow();
    readiness.resolve();
    await Promise.all([first, second]);
    assert.equal(view.created.length, 1);
    const timer = view.created[0];
    assert.deepEqual(timer.showCalls, [false]);
    assert.equal(timer.settings.globalWindowEnabled, true);
    assert.equal(timer.settings.workDuration, 45);
    assert.equal(view.settings.globalWindowEnabled, false);
    assert.equal(view.manager.getCurrentPomodoroTimer(), timer);
    assert.equal(view.plugin.pomodoroTopBarBusy, false);
});

test('已有计时器时只等待窗口就绪并切换可见性，不新建或恢复暂停', async () => {
    const calls = [];
    const current = { show: async autoStart => calls.push(autoStart), isWindowActive: () => true };
    const view = pluginFixture({ current, windowExists: true });
    await view.plugin.togglePomodoroWindow();
    assert.deepEqual(calls, [false]);
    assert.equal(view.created.length, 0);
    assert.equal(view.manager.getCurrentPomodoroTimer(), current);
    assert.equal(view.existingCalls.length, 1);
});

test('其他思源窗口持有独立番茄钟时，控制原窗口，不建立本地实例', async () => {
    const view = pluginFixture({ windowExists: true });
    await view.plugin.togglePomodoroWindow();
    assert.equal(view.created.length, 0);
    assert.equal(view.manager.getCurrentPomodoroTimer(), null);
});

test('内部计时器仍在运行时给出提示，保留计时器且不建立副本', async () => {
    const current = { show: async () => {}, isWindowActive: () => true };
    const view = pluginFixture({ current });
    await view.plugin.togglePomodoroWindow();
    assert.equal(view.manager.getCurrentPomodoroTimer(), current);
    assert.equal(view.created.length, 0);
    assert.equal(view.notices[0][0], 'pomodoroWindowNotStandalone');
});

test('关闭后的失效引用被替换为新的待开始窗口', async () => {
    const current = { show: async () => {}, isWindowActive: () => false };
    const view = pluginFixture({ current });
    await view.plugin.togglePomodoroWindow();
    assert.equal(view.created.length, 1);
    assert.deepEqual(view.created[0].showCalls, [false]);
    assert.equal(view.manager.getCurrentPomodoroTimer(), view.created[0]);
});

for (const options of [{ failCreation: true }, { standalone: false }]) {
    test(`创建失败时释放新实例和忙碌状态：${JSON.stringify(options)}`, async () => {
        const view = pluginFixture(options);
        await view.plugin.togglePomodoroWindow();
        assert.equal(view.created[0].destroyed, true);
        assert.equal(view.manager.getCurrentPomodoroTimer(), null);
        assert.equal(view.plugin.pomodoroTopBarBusy, false);
        assert.equal(view.notices[0][0], 'operationFailed');
    });
}

test('初始化期间卸载插件时关闭新窗口，不留下计时器或错误提示', async () => {
    const readiness = deferred();
    const view = pluginFixture({ readiness: readiness.promise });
    const operation = view.plugin.togglePomodoroWindow();
    while (!view.created.length) await Promise.resolve();
    view.plugin.storageDisposed = true;
    readiness.resolve();
    await operation;
    assert.equal(view.created[0].destroyed, true);
    assert.equal(view.manager.getCurrentPomodoroTimer(), null);
    assert.equal(view.notices.length, 0);
});
