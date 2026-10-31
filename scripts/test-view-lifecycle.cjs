// Run with: node --test scripts/test-view-lifecycle.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = content => ts.transpileModule(content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class TrackedTarget extends EventTarget {
    listeners = new Map();
    addEventListener(type, handler, options) {
        super.addEventListener(type, handler, options);
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler, options) {
        super.removeEventListener(type, handler, options);
        this.listeners.get(type)?.delete(handler);
    }
    get listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}

function environment() {
    const timers = new Map(), frames = new Map(), observers = [], warnings = [];
    const classes = new Map();
    let nextId = 0;
    const window = Object.assign(new TrackedTarget(), {
        setTimeout: callback => { timers.set(++nextId, callback); return nextId; },
        clearTimeout: id => timers.delete(id),
    });
    const document = Object.assign(new TrackedTarget(), { hidden: false, documentElement: {}, body: { style: {} } });
    class Observer {
        disconnected = 0;
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected++; }
    }
    const exports = {};
    new Function('exports', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'console',
        compile(fs.readFileSync(path.join(root, 'src/utils/viewLifecycle.ts'), 'utf8')))(
        exports, window, callback => { frames.set(++nextId, callback); return nextId; }, id => frames.delete(id),
        { warn: (...args) => warnings.push(args) },
    );
    function loadClass(relative, className, methods) {
        const key = `${relative}:${methods.join(',')}`;
        if (classes.has(key)) return classes.get(key);
        const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
        const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className).members;
        const content = members.filter(node => methods.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
        const loaded = new Function('window', 'document', 'MutationObserver', 'ResizeObserver', 'HTMLElement', 'clearTimeout', 'console', 'i18n', 'showMessage', 'CALENDAR_CONFIG_UPDATED_EVENT',
            compile(`class ${className} { ${content} }`) + `; return ${className};`)(
            window, document, Observer, Observer, class {}, window.clearTimeout, { error: () => {} }, key => key, () => {}, 'calendarConfigUpdated',
        );
        classes.set(key, loaded);
        return loaded;
    }
    async function tick() {
        const entry = timers.entries().next().value;
        assert.ok(entry, 'Expected scheduled timer');
        timers.delete(entry[0]);
        await entry[1]();
    }
    return { window, document, timers, frames, observers, warnings, loadClass, tick, ViewLifecycle: exports.ViewLifecycle };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('资源手动释放与整体销毁幂等，清理失败不阻断后续资源', () => {
    const e = environment(), scope = new e.ViewLifecycle();
    let calls = 0;
    const remove = scope.listen(e.window, 'update', () => calls++);
    e.window.dispatchEvent(new Event('update'));
    remove(); remove();
    scope.addCleanup(() => calls++);
    scope.addCleanup(() => { throw new Error('单个清理失败'); });
    scope.dispose(); scope.dispose();
    scope.listen(e.window, 'update', () => calls++);
    scope.addCleanup(() => calls++);
    e.window.dispatchEvent(new Event('update'));
    assert.equal(calls, 3);
    assert.equal(e.window.listenerCount, 0);
    assert.equal(e.warnings.length, 1);
});

test('销毁会取消延迟回调和绘制，已取出的旧回调也不执行', async () => {
    const e = environment(), scope = new e.ViewLifecycle();
    let calls = 0;
    scope.timeout(() => calls++);
    scope.frame(() => calls++);
    const timer = [...e.timers.values()][0], frame = [...e.frames.values()][0];
    scope.dispose();
    timer(); frame(0);
    scope.timeout(() => calls++); scope.frame(() => calls++);
    assert.equal(calls, 0);
    assert.equal(e.timers.size, 0);
    assert.equal(e.frames.size, 0);
});

test('已开始的异步业务操作仍完成，不因关闭视图取消写入', async () => {
    const e = environment(), scope = new e.ViewLifecycle(), saving = deferred();
    let writes = 0;
    scope.timeout(async () => { await saving.promise; writes++; });
    const running = e.tick();
    scope.dispose();
    saving.resolve();
    await running;
    assert.equal(writes, 1);
});

function calendarFixture(e) {
    const CalendarView = e.loadClass('src/components/panel/CalendarView.ts', 'CalendarView', [
        'bindUpdateListeners', 'observeCalendarPopovers', 'addResizeListeners', 'debounceResize', 'destroy',
    ]);
    const counts = { updates: 0, settings: 0, destroyed: 0, resize: 0 };
    const view = Object.assign(new CalendarView(), {
        lifecycle: new e.ViewLifecycle(), disposed: false, refreshVersion: 0,
        calendarViewInstanceId: 'calendar', colorCache: new Map(),
        container: { querySelectorAll: () => [], innerHTML: '' },
        eventReconciler: { clear: () => {} },
        calendar: { destroy: () => counts.destroyed++, updateSize: () => counts.resize++ },
        isCalendarVisible: () => true, addWheelZoomListener: () => {},
        refreshEvents: () => counts.updates++, updateSettings: async () => counts.settings++,
    });
    return { view, counts };
}

test('连续开关日历 50 次，窗口/文档监听、3 类观察器和延迟绘制均归零', async () => {
    const e = environment();
    for (let i = 0; i < 50; i++) {
        const { view, counts } = calendarFixture(e);
        const begin = e.observers.length;
        view.bindUpdateListeners({});
        view.observeCalendarPopovers({});
        assert.equal(e.window.listenerCount, 5);
        assert.equal(e.document.listenerCount, 1);
        assert.equal(e.observers.length - begin, 3);
        e.window.dispatchEvent(new Event('projectColorUpdated'));
        assert.equal(counts.updates, 1);
        e.window.dispatchEvent(new Event('resize'));
        view.lifecycle.frame(() => counts.resize++);
        view.destroy(); view.destroy();
        e.window.dispatchEvent(new Event('reminderUpdated'));
        e.window.dispatchEvent(new Event('projectColorUpdated'));
        e.window.dispatchEvent(new Event('reminderSettingsUpdated'));
        for (const observer of e.observers.slice(begin)) {
            assert.equal(observer.disconnected, 1);
            observer.callback([{ type: 'attributes', attributeName: 'data-theme-mode', addedNodes: [] }]);
        }
        assert.equal(counts.updates, 1);
        assert.equal(counts.settings, 0);
        assert.equal(counts.destroyed, 1);
        assert.equal(e.window.listenerCount, 0);
        assert.equal(e.document.listenerCount, 0);
        assert.equal(e.timers.size, 0);
        assert.equal(e.frames.size, 0);
    }
});

function boardFixture(e, overrides = {}) {
    const Board = e.loadClass('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
        'initializeAsync', 'queueLoadTasks', 'loadTasks', 'destroy', 'attachResizeHandle',
    ]);
    const counts = { ui: 0, rendered: 0, unbound: 0, stopped: 0 };
    const board = Object.assign(new Board(), {
        lifecycle: new e.ViewLifecycle(), disposed: false, isLoading: false,
        categoryManager: { initialize: async () => {} }, loadProject: async () => {},
        loadKanbanMode: async () => {}, loadKanbanSortConfig: async () => {},
        initUI: () => counts.ui++, checkVip: async () => {},
        container: { innerHTML: '' }, tasks: [], completionMoveTimers: new Map(), collapsedTasks: new Set(),
        unbindProjectTabDropTarget: () => counts.unbound++, stopDragScroll: () => counts.stopped++,
        captureScrollState: () => {}, refreshReminderSkipDateContext: async () => {}, buildMilestoneMap: async () => {},
        renderKanban: () => counts.rendered++, ...overrides,
    });
    return { board, counts };
}

test('看板初始化读数据期间关闭，不再继续创建界面或注册监听', async () => {
    const e = environment(), initializing = deferred();
    const { board, counts } = boardFixture(e, { categoryManager: { initialize: () => initializing.promise } });
    const running = board.initializeAsync();
    board.destroy();
    initializing.resolve();
    await running;
    assert.equal(counts.ui, 0);
    assert.equal(e.window.listenerCount, 0);
    assert.equal(e.document.listenerCount, 0);
});

test('看板初次加载期间关闭，完成读取后也不能补挂全局监听', async () => {
    const e = environment(), loading = deferred(), entered = deferred();
    const { board } = boardFixture(e, { loadTasks: () => { entered.resolve(); return loading.promise; } });
    const running = board.initializeAsync();
    await entered.promise;
    board.destroy();
    loading.resolve();
    await running;
    assert.equal(e.window.listenerCount, 0);
    assert.equal(e.document.listenerCount, 0);
});

test('看板排队加载未执行就关闭，等待者正常结束且定时器不残留', async () => {
    const e = environment();
    let loads = 0;
    const { board, counts } = boardFixture(e, { loadTasks: async () => loads++ });
    const pending = board.queueLoadTasks();
    board.destroy(); board.destroy();
    await pending;
    await board.queueLoadTasks();
    assert.equal(loads, 0);
    assert.equal(e.timers.size, 0);
    assert.equal(counts.unbound, 1);
    assert.equal(counts.stopped, 1);
});

test('看板实际读取任务中关闭，旧结果不提交且排队 Promise 不挂起', async () => {
    const e = environment(), loading = deferred(), entered = deferred();
    const { board, counts } = boardFixture(e, { getReminders: () => { entered.resolve(); return loading.promise; } });
    const pending = board.queueLoadTasks(), running = e.tick();
    await entered.promise;
    board.destroy();
    await pending;
    loading.resolve({ a: { id: 'a' } });
    await running;
    assert.equal(counts.rendered, 0);
    assert.equal(board.isLoading, false);
    assert.equal(e.timers.size, 0);
});

test('已完成初始化的看板销毁后移除全部全局监听及延迟移列任务', async () => {
    const e = environment();
    const { board } = boardFixture(e, { loadTasks: async () => {} });
    await board.initializeAsync();
    assert.equal(e.window.listenerCount, 3);
    assert.equal(e.document.listenerCount, 1);
    board.completionMoveTimers.set('a', board.lifecycle.timeout(() => assert.fail('关闭后移列')));
    board.destroy();
    assert.equal(e.window.listenerCount, 0);
    assert.equal(e.document.listenerCount, 0);
    assert.equal(e.timers.size, 0);
});

test('拖动列宽时关闭看板，移除文档监听并恢复光标，不触发保存', () => {
    const e = environment(), { board } = boardFixture(e);
    const classes = new Set(), handle = Object.assign(new TrackedTarget(), {
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    });
    const column = { offsetWidth: 300, style: {} };
    let saves = 0;
    board.saveColumnWidth = () => saves++;
    e.document.body.style.cursor = 'auto';
    e.document.body.style.userSelect = 'text';
    board.attachResizeHandle(handle, column, 'todo');
    const down = new Event('mousedown');
    Object.defineProperty(down, 'clientX', { value: 100 });
    handle.dispatchEvent(down);
    assert.equal(e.document.listenerCount, 2);
    assert.equal(e.document.body.style.cursor, 'col-resize');
    board.destroy();
    e.document.dispatchEvent(new Event('mouseup'));
    handle.dispatchEvent(down);
    assert.equal(e.document.listenerCount, 0);
    assert.equal(e.document.body.style.cursor, 'auto');
    assert.equal(e.document.body.style.userSelect, 'text');
    assert.equal(classes.has('resizing'), false);
    assert.equal(saves, 0);
});

test('日历初始化及设置读取中关闭，异步返回后不再执行后续界面操作', async () => {
    for (const method of ['initUI', 'updateSettings', 'applyCollapseState']) {
        const e = environment(), pending = deferred();
        const CalendarView = e.loadClass('src/components/panel/CalendarView.ts', 'CalendarView', [method, 'destroy']);
        const view = Object.assign(new CalendarView(), {
            lifecycle: new e.ViewLifecycle(), disposed: false, refreshVersion: 0,
            categoryManager: { initialize: () => pending.promise },
            projectManager: { initialize: () => assert.fail('关闭后继续初始化') },
            plugin: { loadSettings: () => pending.promise },
            getTodayStartTime: () => pending.promise,
            container: { innerHTML: '' }, colorCache: new Map(), eventReconciler: { clear: () => {} },
        });
        const running = view[method]();
        view.destroy();
        pending.resolve({});
        await running;
        assert.equal(e.window.listenerCount, 0);
        assert.equal(e.document.listenerCount, 0);
    }
});

test('真实页签关闭回调调用看板销毁，并移除对应实例引用', () => {
    const relative = 'src/index.ts';
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    let destroy;
    function visit(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addTab') {
            const config = node.arguments[0];
            if (config && ts.isObjectLiteralExpression(config) && config.properties.some(property => property.name?.getText(source) === 'type' && property.initializer?.getText(source) === 'PROJECT_KANBAN_TAB_TYPE')) {
                destroy = config.properties.find(property => property.name?.getText(source) === 'destroy').initializer.getText(source);
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(destroy);
    let closed = 0;
    const view = { destroy: () => closed++ }, other = {};
    const thisPlugin = { tabViews: new Map([['current', view], ['other', other]]) };
    const close = new Function('thisPlugin', compile(`const close = ${destroy};`) + '; return close;')(thisPlugin);
    const tab = { _projectKanbanView: view };
    close.call(tab);
    assert.equal(closed, 1);
    assert.equal(tab._projectKanbanView, null);
    assert.deepEqual([...thisPlugin.tabViews.keys()], ['other']);
});

test('移动端弹窗主动关闭及插件卸载均销毁对应视图，日历停靠栏重建前释放旧实例', () => {
    const relative = 'src/index.ts';
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPlugin').members;
    const names = ['openCalendarTab', 'openProjectKanbanTab', 'destroyAuxiliaryViews', 'ensureCalendarDockRegistered'];
    const content = members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
    const dialogs = [], views = [];
    class Dialog {
        constructor(options) {
            this.options = options; dialogs.push(this);
            this.container = {};
            this.element = { querySelector: () => this.container };
        }
        destroy() { this.options.destroyCallback(); }
    }
    class View {
        destroyed = 0;
        constructor() { views.push(this); }
        destroy() { this.destroyed++; }
    }
    const Plugin = new Function('Dialog', 'CalendarView', 'ProjectKanbanView', 'getFrontend', 'i18n',
        compile(`class Plugin { ${content} }`) + '; return Plugin;')(Dialog, View, View, () => 'app-mobile', key => key);
    const plugin = Object.assign(new Plugin(), {
        mobileViewDialogs: new Set(), registeredDockKeys: new Set(),
        registerDockPanel: options => { plugin.dock = options; },
    });
    plugin.openCalendarTab();
    plugin.openProjectKanbanTab('p', '项目');
    assert.equal(plugin.mobileViewDialogs.size, 2);
    dialogs[0].destroy();
    assert.equal(views[0].destroyed, 1);
    assert.equal(plugin.mobileViewDialogs.size, 1);
    plugin.ensureCalendarDockRegistered();
    plugin.dock.init({});
    plugin.dock.init({});
    assert.equal(views[2].destroyed, 1);
    plugin.destroyAuxiliaryViews(); plugin.destroyAuxiliaryViews();
    assert.deepEqual(views.map(view => view.destroyed), [1, 1, 1, 1]);
    assert.equal(plugin.mobileViewDialogs.size, 0);
});
