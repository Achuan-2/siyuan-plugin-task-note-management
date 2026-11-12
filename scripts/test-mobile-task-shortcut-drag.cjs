// Run with: pnpm exec node --test scripts/test-mobile-task-shortcut-drag.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class Target extends EventTarget {
    listeners = new Set();
    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
        this.listeners.add(listener);
    }
    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
        this.listeners.delete(listener);
    }
}
class Element extends Target {
    children = [];
    dataset = {};
    style = {};
    isConnected = true;
    classList = new Set();
    constructor() {
        super();
        this.classList.remove = name => this.classList.delete(name);
    }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, next) {
        child.remove();
        this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child);
        child.parentElement = this;
        child.isConnected = true;
        return child;
    }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
        this.isConnected = false;
    }
    get nextElementSibling() {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null;
    }
    contains(child) { return this.children.includes(child); }
    closest() { return this.dataset.tab ? this : null; }
    getBoundingClientRect() {
        const left = this.parentElement ? this.parentElement.children.indexOf(this) * 100 : 0;
        return { left, top: 0, width: this.parentElement ? 100 : 400, height: 60, bottom: 60 };
    }
    hasPointerCapture(id) { return this.capture === id; }
    setPointerCapture(id) { this.capture = id; }
    releasePointerCapture() { this.capture = null; }
}

function fixture() {
    let now = 1000, timerId = 0;
    const timers = new Map(), storage = new Map();
    const window = Object.assign(new Target(), {
        setTimeout(callback, delay) { timers.set(++timerId, { callback, due: now + delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
    });
    const document = Object.assign(new Target(), { hidden: false, body: new Element(), createElement: () => new Element() });
    const lifecycle = {};
    new Function('exports', 'window', compile(fs.readFileSync(path.join(root, 'src/utils/viewLifecycle.ts'), 'utf8')))(lifecycle, window);
    const source = ts.createSourceFile('MobileTaskShortcut.ts', fs.readFileSync(path.join(root, 'src/components/render/MobileTaskShortcut.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const method = source.statements.find(ts.isClassDeclaration).members.find(node => node.name?.getText(source) === 'setupTabReorder');
    const storageKey = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(source) === 'TAB_ORDER_STORAGE_KEY'));
    const Shortcut = new Function('ViewLifecycle', 'window', 'document', 'Element', 'Date', 'localStorage',
        compile(`${storageKey.getText(source)} class Shortcut { ${method.getText(source)} }`) + '; return Shortcut;')(
        lifecycle.ViewLifecycle, window, document, Element, { now: () => now }, { setItem: (key, value) => storage.set(key, value) },
    );
    const tabs = new Element(), panels = new Element();
    const shortcut = Object.assign(new Shortcut(), { tabButtons: new Map(), tabContainers: new Map() });
    for (const id of ['task', 'project', 'habit', 'calendar']) {
        const button = tabs.appendChild(new Element());
        button.dataset.tab = id;
        button.textContent = id;
        const panel = panels.appendChild(new Element());
        panel.dataset.tab = id;
        panel.draft = { text: '未保存的输入' };
        shortcut.tabButtons.set(id, button);
        shortcut.tabContainers.set(id, panel);
    }
    shortcut.setupTabReorder(tabs, panels);
    const order = (container = tabs) => container.children.map(child => child.dataset.tab);
    const send = (type, { x = 50, y = 30, count = 1, id = 7, pointerType = 'touch' } = {}) => {
        const event = new Event(type, { cancelable: true });
        const touch = { identifier: id, clientX: x, clientY: y };
        Object.assign(event, {
            touches: type === 'touchend' ? [] : Array.from({ length: count }, (_, i) => ({ ...touch, identifier: id + i })),
            changedTouches: [touch], clientX: x, clientY: y, pointerId: id, pointerType, isPrimary: true, button: 0,
        });
        Object.defineProperty(event, 'target', { value: shortcut.tabButtons.get('task') });
        const target = ['touchstart', 'pointerdown', 'click', 'contextmenu'].includes(type) ? tabs : document;
        target.dispatchEvent(event);
        return event;
    };
    return { shortcut, tabs, panels, document, window, timers, storage, order, send,
        advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
        },
    };
}

test('触摸无需 Pointer 事件即可长按排序；跟手预览、松手落点、面板草稿及存储保持正确', () => {
    const f = fixture();
    const panel = f.shortcut.tabContainers.get('task'), draft = panel.draft;
    f.send('touchstart');
    f.advance(459);
    assert.equal(f.document.body.children.length, 0);
    f.advance(1);
    assert.equal(f.document.body.children[0].textContent, 'task');
    assert.equal(f.send('touchmove', { x: 260 }).defaultPrevented, true);
    assert.deepEqual(f.order(), ['project', 'habit', 'task', 'calendar']);
    assert.equal(f.document.body.children[0].style.left, '260px');
    // 松手最后一帧的位置也必须参与排序。
    assert.equal(f.send('touchend', { x: 390 }).defaultPrevented, true);
    assert.deepEqual(f.order(), ['project', 'habit', 'calendar', 'task']);
    assert.deepEqual(f.order(f.panels), f.order());
    assert.equal(f.shortcut.tabContainers.get('task'), panel);
    assert.equal(panel.draft, draft);
    assert.deepEqual(JSON.parse(f.storage.get('siyuan-task-shortcut-tab-order')), f.order());
    assert.equal(f.document.body.children.length, 0);
    assert.equal(f.send('click').defaultPrevented, true);
    f.advance(401);
    assert.equal(f.send('click').defaultPrevented, false);
});

test('短按和长按前超过 5px 的移动不启动排序、不保存顺序', () => {
    for (const move of [false, true]) {
        const f = fixture();
        f.send('touchstart');
        f.advance(200);
        if (move) assert.equal(f.send('touchmove', { x: 56 }).defaultPrevented, false);
        f.send('touchend');
        f.advance(500);
        assert.equal(f.document.body.children.length, 0);
        assert.equal(f.storage.size, 0);
        assert.equal(f.send('click').defaultPrevented, false);
    }
});

test('多指、取消、失焦、隐藏和销毁均恢复原顺序，清理预览且不保存', () => {
    for (const cancel of [
        f => f.send('touchstart', { count: 2 }),
        f => f.send('touchcancel'),
        f => f.window.dispatchEvent(new Event('blur')),
        f => { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); },
        f => f.shortcut.tabDragCleanup(),
    ]) {
        const f = fixture();
        f.send('touchstart'); f.advance(460); f.send('touchmove', { x: 390 });
        cancel(f);
        assert.deepEqual(f.order(), ['task', 'project', 'habit', 'calendar']);
        assert.deepEqual(f.order(f.panels), f.order());
        assert.equal(f.storage.size, 0);
        assert.equal(f.document.body.children.length, 0);
        assert.equal(f.timers.size, 0);
        f.shortcut.tabDragCleanup();
        assert.equal(f.document.listeners.size + f.window.listeners.size + f.tabs.listeners.size, 0);
    }
});

test('触摸 Pointer 事件不重复启动，鼠标长按仍支持排序', () => {
    const f = fixture();
    f.send('pointerdown');
    assert.equal(f.timers.size, 0);
    f.send('pointerdown', { pointerType: 'mouse' }); f.advance(460);
    assert.equal(f.tabs.capture, 7);
    f.send('pointermove', { pointerType: 'mouse', x: 390 });
    f.send('pointerup', { pointerType: 'mouse', x: 390 });
    assert.deepEqual(f.order(), ['project', 'habit', 'calendar', 'task']);
    assert.equal(f.tabs.capture, null);
});
