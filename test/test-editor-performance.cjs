// pnpm exec node --test test/test-editor-performance.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/render/taskNoteDOM.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', code)(() => ({}), loaded, loaded.exports);
const { TaskNoteDOMManager } = loaded.exports;

// 只模拟观察器所需的 DOM 表面，执行真实管理器的过滤、调度和销毁逻辑。
class ElementStub {
    constructor(attrs = {}, classes = []) {
        this.attrs = attrs;
        this.classes = new Set(classes);
        this.children = [];
        this.parentElement = null;
        this.isConnected = true;
        this.nodeType = 1;
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    matches(selector) {
        return selector.split(',').some(part => {
            part = part.trim();
            if (part.startsWith('.')) return this.classes.has(part.slice(1));
            const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
            return attr && attr[1] in this.attrs && (attr[2] === undefined || this.attrs[attr[1]] === attr[2]);
        });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelector(selector) {
        for (const child of this.children) {
            if (child.matches(selector)) return child;
            const match = child.querySelector(selector);
            if (match) return match;
        }
        return null;
    }
    append(child) { this.children.push(child); child.parentElement = this; return child; }
}

function fixture(t) {
    const originals = { window: global.window, Element: global.Element, Node: global.Node, MutationObserver: global.MutationObserver };
    const timers = new Map();
    const events = new Map();
    const observers = [];
    const cleanups = [];
    let nextTimer = 0;
    let time = 0;
    global.Element = ElementStub;
    global.Node = { TEXT_NODE: 3 };
    global.window = {
        setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, at: time + delay }); return nextTimer; },
        clearTimeout: id => timers.delete(id),
        addEventListener: () => {}, removeEventListener: () => {},
    };
    global.MutationObserver = class {
        constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
        observe(element, options) { this.element = element; this.options = options; }
        disconnect() { this.disconnected = true; }
    };
    const plugin = {
        eventBus: { on: (name, handler) => events.set(name, handler), off: name => events.delete(name) },
        addCleanup: callback => cleanups.push(callback),
    };
    const manager = new TaskNoteDOMManager(plugin);
    const scans = [];
    manager._scanProtyleForButtons = protyle => scans.push(protyle);
    manager.isProtyleVisible = protyle => !manager.disposed && protyle.element.isConnected && !protyle.hidden;
    const protyle = { element: new ElementStub() };
    manager.addBlockProjectButtonsToProtyle(protyle);
    scans.length = 0;
    const advance = delay => {
        time += delay;
        for (const [id, timer] of [...timers]) if (timer.at <= time) {
            timers.delete(id);
            timer.callback();
        }
    };
    const cleanup = () => cleanups.forEach(callback => callback());
    t.after(() => { cleanup(); Object.assign(global, originals); });
    return { manager, protyle, observers, scans, advance, events, timers, cleanups, cleanup };
}

function childChange(target, addedNodes = [], removedNodes = []) {
    return { type: 'childList', target, addedNodes, removedNodes };
}
function attrChange(target, attributeName, oldValue) {
    return { type: 'attributes', target, attributeName, oldValue };
}

test('连续 1000 次普通文字、行内格式和 updated 变化不调度全文扫描', t => {
    const env = fixture(t);
    const block = new ElementStub({ 'data-node-id': 'paragraph', updated: 'new' });
    const text = { nodeType: 3, parentElement: block };
    for (let index = 0; index < 1000; index++) env.observers[0].callback([
        childChange(block, [text], [text]),
        childChange(block, [new ElementStub({}, ['bold'])]),
        attrChange(block, 'updated', 'old'),
    ]);
    env.advance(100);
    assert.equal(env.scans.length, 0);
    assert.equal(env.observers.length, 1);
    assert.equal(env.observers[0].options.attributeFilter.includes('updated'), false);
    assert.equal(env.observers[0].options.attributeFilter.includes('bookmark'), false);
});

test('绑定属性变化合并刷新，移除绑定仍刷新，相同属性值不刷新', t => {
    const env = fixture(t);
    const block = new ElementStub({ 'custom-bind-reminders': 'task-a' });
    for (let index = 0; index < 10; index++) env.observers[0].callback([
        attrChange(block, 'custom-bind-reminders', 'task-b'),
    ]);
    env.advance(99);
    assert.equal(env.scans.length, 0);
    env.advance(1);
    assert.equal(env.scans.length, 1);
    assert.equal(env.manager.protyleDebounceTimers.size, 0);
    env.observers[0].callback([attrChange(block, 'custom-bind-reminders', 'task-a')]);
    env.advance(100);
    assert.equal(env.scans.length, 1);
    delete block.attrs['custom-bind-reminders'];
    env.observers[0].callback([attrChange(block, 'custom-bind-reminders', 'task-a')]);
    env.advance(100);
    assert.equal(env.scans.length, 2);
});

test('插入嵌套绑定块、移除绑定块及重建按钮容器仍刷新', t => {
    const env = fixture(t);
    const wrapper = new ElementStub();
    wrapper.append(new ElementStub({ 'custom-bind-milestones': 'milestone' }));
    const attrContainer = new ElementStub({}, ['protyle-attr']);
    const replacement = new ElementStub();
    replacement.append(new ElementStub({ 'data-plugin-added': 'reminder-plugin' }));
    for (const mutation of [
        childChange(env.protyle.element, [wrapper]),
        childChange(env.protyle.element, [], [wrapper]),
        childChange(env.protyle.element, [attrContainer]),
        childChange(env.protyle.element, [], [replacement]),
    ]) {
        env.observers[0].callback([mutation]);
        env.advance(100);
    }
    assert.equal(env.scans.length, 4);
});

test('插件按钮自身文字及子节点更新不形成观察器反馈循环', t => {
    const env = fixture(t);
    const button = new ElementStub({ 'data-plugin-added': 'reminder-plugin' });
    const inner = button.append(new ElementStub());
    env.observers[0].callback([
        childChange(inner, [new ElementStub()], [{ nodeType: 3, parentElement: null }]),
        childChange(env.protyle.element, [button]),
    ]);
    env.advance(100);
    assert.equal(env.scans.length, 0);
});

test('销毁文档取消待执行扫描，多次开关文档不累积卸载闭包', t => {
    const env = fixture(t);
    const cleanupCount = env.cleanups.length;
    const block = new ElementStub({ 'custom-task-projectid': 'project' });
    for (let index = 0; index < 100; index++) {
        const protyle = { element: new ElementStub() };
        env.manager.addBlockProjectButtonsToProtyle(protyle);
        const observer = env.observers.at(-1);
        observer.callback([attrChange(block, 'custom-task-projectid', null)]);
        env.events.get('destroy-protyle')({ detail: { protyle } });
        assert.equal(observer.disconnected, true);
    }
    env.scans.length = 0;
    env.advance(100);
    assert.equal(env.scans.length, 0);
    assert.equal(env.manager.protyleObservers.size, 1);
    assert.equal(env.manager.protyleDebounceTimers.size, 0);
    assert.equal(env.cleanups.length, cleanupCount);
    env.cleanup();
    assert.equal(env.manager.protyleObservers.size, 0);
    assert.equal(env.timers.size, 0);
});

test('多个编辑器各自刷新，隐藏编辑器不扫描，卸载后不再注册监听', t => {
    const env = fixture(t);
    const other = { element: new ElementStub() };
    env.manager.addBlockProjectButtonsToProtyle(other);
    env.scans.length = 0;
    const mutations = [attrChange(new ElementStub({ 'custom-bind-reminders': 'task' }), 'custom-bind-reminders', null)];
    for (const observer of env.observers) observer.callback(mutations);
    other.hidden = true;
    env.advance(100);
    assert.deepEqual(env.scans, [env.protyle]);
    env.cleanup();
    env.manager.addBlockProjectButtonsToProtyle(other);
    assert.equal(env.observers.length, 2);
});

test('文档加载和切换事件合并初始化，关闭文档及卸载取消延迟任务', async t => {
    const env = fixture(t);
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = window.setTimeout;
    global.clearTimeout = window.clearTimeout;
    t.after(() => { global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout; });
    const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
    const ast = ts.createSourceFile('index.ts', indexSource, ts.ScriptTarget.Latest, true);
    const pluginClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPlugin');
    const method = pluginClass.members.find(node => node.name?.getText(ast) === 'onLayoutReady');
    const compiled = ts.transpileModule(`class PluginFixture { ${method.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const PluginFixture = new Function('BatchReminderDialog', compiled + '; return PluginFixture;')(class {});
    const events = new Map();
    const cleanups = [];
    let breadcrumbs = 0;
    let scans = 0;
    let habitSyncs = 0;
    const plugin = Object.assign(new PluginFixture(), {
        registerCommands: () => {}, loadSettings: async () => ({ enableCalendarTopBar: false }),
        addCleanup: callback => cleanups.push(callback),
        syncHabitPomodoroAutoCheckIns: async () => { habitSyncs++; },
        eventBus: { on: (name, callback) => events.set(name, callback), off: name => events.delete(name) },
        taskNoteDOM: {
            isProtyleVisible: () => true,
            addBreadcrumbReminderButton: () => { breadcrumbs++; },
            addBlockProjectButtonsToProtyle: () => { scans++; },
            addBreadcrumbButtonsToExistingProtyles: () => {}, initOutlinePrefixObserver: () => {},
        },
    });
    await plugin.onLayoutReady();
    for (const name of ['loaded-protyle-static', 'loaded-protyle-dynamic', 'switch-protyle']) {
        events.get(name)({ detail: { protyle: env.protyle } });
    }
    env.advance(500);
    assert.equal(breadcrumbs, 1);
    assert.equal(scans, 1);
    events.get('switch-protyle')({ detail: { protyle: env.protyle } });
    events.get('destroy-protyle')({ detail: { protyle: env.protyle } });
    env.advance(500);
    assert.equal(scans, 1);
    events.get('switch-protyle')({ detail: { protyle: env.protyle } });
    for (const cleanup of cleanups) cleanup();
    // 管理器预加载另行清理，防止运行与该测试无关的弹窗 import。
    env.cleanup();
    env.advance(4000);
    assert.equal(scans, 1);
    assert.equal(habitSyncs, 0);
    assert.equal(events.size, 0);
});
