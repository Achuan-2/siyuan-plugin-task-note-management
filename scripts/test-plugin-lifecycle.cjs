// Run with: node --test scripts/test-plugin-lifecycle.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = text => ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
async function drain() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function loadMethods(relative, name, methods, globals = {}) {
    const source = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === name);
    const members = declaration.members.filter(node => methods.includes(node.name?.getText(source)));
    assert.equal(members.length, methods.length);
    return new Function(...Object.keys(globals), compile(`class Subject { ${members.map(node => node.getText(source)).join('\n')} }`) + '; return Subject;')(...Object.values(globals));
}
function clock() {
    const timers = new Map();
    let id = 0;
    return {
        timers,
        setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    };
}

test('Dock 缺失时共用等待任务，元素出现、超时及关闭均释放全部资源', async () => {
    const c = clock(), observers = [];
    let found = null, queries = 0;
    const document = { documentElement: {}, querySelector() { queries++; return found; } };
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
    }
    const exports = {};
    new Function('exports', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', compile(read('src/utils/elementWaiter.ts')))(
        exports, document, Observer, c.setTimeout, c.clearTimeout,
    );
    const waiter = new exports.ElementWaiter(document);
    const pending = waiter.wait('.dock');
    for (let i = 0; i < 100; i++) assert.equal(waiter.wait('.dock'), pending);
    assert.equal(observers.length, 1);
    assert.equal(c.timers.size, 1);
    assert.equal(queries, 1);
    // 等待期间没有轮询，不依赖帧回调。
    const previousQueries = queries;
    await drain();
    assert.equal(queries, previousQueries);
    found = {};
    observers[0].callback();
    assert.equal(await pending, found);
    assert.equal(c.timers.size, 0);
    found = null;
    const timedOut = waiter.wait('.missing');
    [...c.timers.values()][0].callback();
    assert.equal(await timedOut, null);
    const cancelled = [waiter.wait('.one'), waiter.wait('.two')];
    waiter.dispose(); waiter.dispose();
    assert.deepEqual(await Promise.all(cancelled), [null, null]);
    assert.equal(await waiter.wait('.closed'), null);
    assert.equal(c.timers.size, 0);
    assert.ok(observers.every(observer => !observer.active));
});

function pluginFixture() {
    const c = clock(), window = Object.assign(new EventTarget(), c);
    let uploads = 0, migrations = 0;
    const network = deferred();
    const manager = { initialize: async () => {}, closeStorage: async () => {} };
    const Plugin = loadMethods('src/index.ts', 'ReminderPlugin', ['onload', 'onunload', 'addCleanup'], {
        window, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
        document: { querySelectorAll: () => [] },
        console: { log() {}, warn() {} },
        isInMobileApp: () => false, registerCustomIcons() {}, setPluginInstance() {},
        TaskNoteDOMManager: class {}, ChangelogUtils: { checkAndNotify() {} },
        PomodoroRecordManager: { getInstance: () => manager },
        CategoryManager: { getInstance: () => manager }, ProjectManager: { getInstance: () => manager },
        PomodoroManager: { getInstance: () => ({ cleanup() {} }) },
        getFrontend: () => 'browser-desktop', getLogicalDateString: () => '2026-11-05',
        performDataMigration: async () => { migrations++; },
        initIcsSync: () => { uploads++; return network.promise; },
        initIcsSubscriptionSync: async () => {}, cleanupIcsSync() {},
        dismissTaskUndo() {},
    });
    const bus = new Map();
    const plugin = Object.assign(new Plugin(), {
        storageDisposed: false, cleanupFunctions: [], pendingPomodoroDates: new Set(), tabViews: new Map(),
        eventBus: { on: (name, fn) => bus.set(fn, name), off: (name, fn) => bus.delete(fn) },
        initializeUI: async () => {}, loadSettings: async () => ({}), getPomodoroSettings: async () => ({}),
        enableAudioOnUserInteraction() {}, initCoordinator() {},
        handleDocumentTreeMenu() {},
        reminderNotifications: { destroy() {} }, elementWaiter: { dispose() {} },
        destroyAuxiliaryViews() {},
        loadReminderData: async () => ({}), loadProjectData: async () => ({}),
        loadHabitData: async () => ({}), loadHabitGroupData: async () => [], loadHolidayData: async () => ({}),
    });
    return { plugin, c, network, bus, manager, get uploads() { return uploads; }, get migrations() { return migrations; } };
}

test('启用不等待云端同步；迁移仍在核心流程内完成，禁用取消未执行的预热和同步', async () => {
    const e = pluginFixture();
    await e.plugin.onload();
    assert.equal(e.migrations, 1);
    assert.equal(e.uploads, 0);
    const ics = [...e.c.timers.values()].find(timer => timer.delay === 0);
    assert.ok(ics);
    ics.callback();
    await drain();
    assert.equal(e.uploads, 1);
    e.plugin.onunload();
    assert.equal(e.c.timers.size, 0);
    assert.equal(e.bus.size, 0);
    e.network.resolve();
    await drain();
    assert.equal(e.c.timers.size, 0);

    const cancelled = pluginFixture();
    await cancelled.plugin.onload();
    cancelled.plugin.onunload();
    assert.equal(cancelled.c.timers.size, 0);
    assert.equal(cancelled.uploads, 0);
});

test('核心分类与项目并行加载，初始化中禁用后不再注册资源', async () => {
    const e = pluginFixture(), loading = deferred();
    let started = 0;
    e.manager.initialize = () => { started++; return loading.promise; };
    const running = e.plugin.onload();
    await drain();
    assert.equal(started, 3); // 番茄后台初始化以及分类、项目两个独立初始化。
    e.plugin.onunload();
    loading.resolve();
    await running;
    assert.equal(e.migrations, 0);
    assert.equal(e.bus.size, 0);
    assert.equal(e.c.timers.size, 0);
    let releases = 0;
    e.plugin.addCleanup(() => releases++);
    assert.equal(releases, 1);
    assert.equal(e.plugin.cleanupFunctions.length, 0);
});

test('禁用先停观察器再销毁面板和 DOM，重复禁用不会重复清理', () => {
    const e = pluginFixture(), order = [];
    e.plugin.cleanupFunctions.push(() => order.push('observer'));
    for (const name of ['reminderPanel', 'projectPanel', 'habitPanel']) {
        e.plugin[name] = { destroy: () => order.push(name) };
    }
    e.plugin.destroyAuxiliaryViews = () => order.push('view');
    e.plugin.onunload(); e.plugin.onunload();
    assert.deepEqual(order, ['observer', 'reminderPanel', 'projectPanel', 'habitPanel', 'view']);
});

for (const [name, stages] of [
    ['ReminderPanel', ['category', 'pomodoro', 'settings', 'refreshReminderSkipDateContext', 'loadSortConfig', 'loadCustomFilters', 'updateFilterSelect', 'loadFilterTab']],
    ['ProjectPanel', ['category', 'status', 'restorePanelSettings', 'folder']],
    ['HabitPanel', ['group', 'pomodoro', 'loadCollapseStates', 'restorePanelSettings']],
]) {
    test(`${name} 在任意初始化阶段关闭后均不重新添加监听器`, async () => {
        for (const stage of [...stages, null]) {
            const pending = deferred();
            let reached = false, loadsAfterClose = 0;
            const call = key => () => {
                if (key === stage) { reached = true; return pending.promise; }
                return Promise.resolve({});
            };
            const window = new EventTarget(), document = new EventTarget();
            const listeners = new Map();
            for (const target of [window, document]) {
                target.addEventListener = (name, fn) => listeners.set(fn, name);
                target.removeEventListener = (name, fn) => listeners.delete(fn);
            }
            const Panel = loadMethods(`src/components/panel/${name}.ts`, name, ['initializeAsync', 'destroy'], {
                window, document, getFrontend: () => 'desktop',
                ProjectFolderManager: { getInstance: () => ({ initialize: call('folder') }) },
            });
            const panel = Object.assign(new Panel(), {
                disposed: false, categoryManager: { initialize: call('category') }, statusManager: { initialize: call('status') },
                groupManager: { initialize: call('group') }, pomodoroRecordManager: { initialize: call('pomodoro') },
                plugin: { loadSettings: call('settings') }, pomodoroManager: { cleanupInactiveTimer() {} },
                completionRemovalTimers: new Map(), reminderLoadVersion: 0, stopDragScroll() {},
                saveCollapseStates() {}, initUI() {}, addReminderDialogStyles() {},
                reminderUpdatedHandler() {}, projectUpdatedHandler() {}, habitUpdatedHandler() {},
                sortConfigUpdatedHandler() {}, settingsUpdatedHandler() {},
                loadReminders: () => { loadsAfterClose++; }, loadProjects: () => { loadsAfterClose++; }, loadHabits: () => { loadsAfterClose++; },
            });
            for (const key of stages.filter(key => !['category', 'status', 'group', 'pomodoro', 'settings', 'folder'].includes(key))) panel[key] = call(key);
            const running = panel.initializeAsync();
            await drain();
            if (stage) assert.equal(reached, true, `未到达 ${stage}`);
            else assert.ok(listeners.size > 0);
            panel.destroy(); panel.destroy();
            pending.resolve({});
            await running;
            assert.equal(listeners.size, 0, stage);
            assert.equal(loadsAfterClose, stage ? 0 : 1, stage);
        }
    });
}

for (const name of ['ReminderPanel', 'HabitPanel']) {
    test(`${name} 番茄统计初始化失败仍加载列表，关闭后失败不会重新加载`, async () => {
        for (const closeBeforeFailure of [false, true]) {
            const pending = deferred(), warnings = [], calls = [];
            const Panel = loadMethods(`src/components/panel/${name}.ts`, name, ['initializeAsync'], {
                window: new EventTarget(), document: new EventTarget(),
                console: { warn: (...args) => warnings.push(args) },
            });
            const panel = Object.assign(new Panel(), {
                disposed: false,
                categoryManager: { initialize: async () => {} }, groupManager: { initialize: async () => {} },
                pomodoroRecordManager: { initialize: async () => { await pending.promise; throw new Error('permission denied'); } },
                plugin: { loadSettings: async () => ({}) },
                initUI: () => calls.push('ui'), loadReminders: () => calls.push('tasks'), loadHabits: () => calls.push('habits'),
                reminderUpdatedHandler() {}, habitUpdatedHandler() {}, sortConfigUpdatedHandler() {}, settingsUpdatedHandler() {},
                addReminderDialogStyles() {},
            });
            for (const method of ['refreshReminderSkipDateContext', 'loadSortConfig', 'loadCustomFilters',
                'updateFilterSelect', 'loadFilterTab', 'loadCollapseStates', 'restorePanelSettings']) panel[method] = async () => {};
            const running = panel.initializeAsync();
            await drain();
            if (closeBeforeFailure) panel.disposed = true;
            pending.resolve();
            await running;
            assert.equal(warnings.length, 1);
            assert.deepEqual(calls, closeBeforeFailure ? [] : ['ui', name === 'ReminderPanel' ? 'tasks' : 'habits']);
        }
    });
}

function icsFixture() {
    const intervals = new Map(), exports = {}, upload = deferred();
    let id = 0, uploads = 0;
    const require = name => {
        if (name === '../api') return { getFileStat: async () => ({ mtime: Date.now() }) };
        if (name === './icsExport') return { uploadIcsToCloud: () => { uploads++; return upload.promise; } };
        throw new Error(`Unexpected import: ${name}`);
    };
    new Function('exports', 'require', 'window', 'clearInterval', compile(read('src/utils/icsSync.ts')))(
        exports, require, { setInterval: callback => { intervals.set(++id, callback); return id; } }, id => intervals.delete(id),
    );
    const plugin = {
        loadSettings: async () => ({ icsSyncEnabled: true, icsSyncInterval: '15min' }),
        isPrimaryInstance: () => true,
    };
    return { exports, plugin, intervals, upload, get uploads() { return uploads; } };
}

test('ICS 正常启动仍立即同步，并注册轮询；关闭释放定时器', async () => {
    const e = icsFixture();
    const running = e.exports.initIcsSync(e.plugin);
    await drain();
    assert.equal(e.uploads, 1);
    e.upload.resolve();
    await running;
    await e.exports.initIcsSubscriptionSync(e.plugin);
    assert.equal(e.intervals.size, 2);
    e.exports.cleanupIcsSync(e.plugin);
    assert.equal(e.intervals.size, 0);
});

test('ICS 上传中禁用，上传结束后不会重建轮询', async () => {
    const e = icsFixture();
    const running = e.exports.initIcsSync(e.plugin);
    await drain();
    assert.equal(e.uploads, 1);
    e.exports.cleanupIcsSync(e.plugin);
    e.upload.resolve();
    await running;
    assert.equal(e.intervals.size, 0);
});

test('ICS 读取设置期间禁用，不会开始上传或重建定时器', async () => {
    const e = icsFixture(), settings = deferred();
    e.plugin.loadSettings = () => settings.promise;
    const running = e.exports.initIcsSync(e.plugin);
    e.exports.cleanupIcsSync(e.plugin);
    settings.resolve({ icsSyncEnabled: true, icsSyncInterval: '15min' });
    await running;
    assert.equal(e.uploads, 0);
    assert.equal(e.intervals.size, 0);
});
