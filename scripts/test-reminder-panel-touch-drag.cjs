// Run with: pnpm exec node --test scripts/test-reminder-panel-touch-drag.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const rootPath = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

class Target extends EventTarget {
    listeners = new Map();
    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
        this.listeners.get(type)?.delete(listener);
    }
    get listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}

class Element extends Target {
    constructor(tag = 'div') {
        super();
        this.tag = tag;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.classList = new Set();
        this.classList.remove = (...names) => names.forEach(name => this.classList.delete(name));
        this.classList.contains = name => this.classList.has(name);
        this.isConnected = true;
        this.scrollTop = 0;
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
        this.isConnected = false;
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    contains(node) {
        while (node) { if (node === this) return true; node = node.parentElement; }
        return false;
    }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) {
            if (selector === '.reminder-item[data-reminder-id]') {
                if (node.dataset.reminderId) return node;
            } else if (selector.split(',').some(part => {
                const match = part.trim();
                if (match.startsWith('.')) return node.classList.has(match.slice(1));
                if (match === '[data-type="a"]') return node.dataset.type === 'a';
                if (match === '[data-href]') return !!node.dataset.href;
                return match === node.tag;
            })) return node;
        }
        return null;
    }
    getBoundingClientRect() {
        return this.rect || { left: 0, top: 0, right: 320, bottom: 400, width: 320, height: 400 };
    }
}

function environment(initialTasks = [{ id: 'a', title: 'A', sort: 0 }, { id: 'b', title: 'B', sort: 10 }, { id: 'c', title: 'C', sort: 20 }]) {
    let now = 0, nextId = 0;
    const timers = new Map(), frames = new Map();
    const window = Object.assign(new Target(), {
        setTimeout(callback, delay) { timers.set(++nextId, { callback, due: now + delay }); return nextId; },
        clearTimeout(id) { timers.delete(id); },
    });
    const document = Object.assign(new Target(), { hidden: false, body: new Element('body'), createElement: tag => new Element(tag) });
    const root = new Element();
    document.body.appendChild(root);
    const rows = new Map(initialTasks.map((task, index) => {
        const row = root.appendChild(new Element());
        row.dataset.reminderId = task.id;
        row.getBoundingClientRect = () => ({ left: 0, right: 320, width: 320, height: 80, top: 60 + index * 100 - root.scrollTop, bottom: 140 + index * 100 - root.scrollTop });
        return [task.id, row];
    }));
    document.elementFromPoint = (x, y) => x < 0 || x > 320 || y < 0 || y > 400 ? null
        : [...rows.values()].find(row => y >= row.getBoundingClientRect().top && y <= row.getBoundingClientRect().bottom) || root;
    const requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
    const cancelAnimationFrame = id => frames.delete(id);
    const modules = new Map();
    function load(relative) {
        if (modules.has(relative)) return modules.get(relative);
        const exports = {};
        new Function('require', 'exports', 'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date',
            compile(fs.readFileSync(path.join(rootPath, relative), 'utf8')))(
            name => load(path.relative(rootPath, path.resolve(path.dirname(path.join(rootPath, relative)), name + '.ts'))),
            exports, window, document, requestAnimationFrame, cancelAnimationFrame, { now: () => now }, { now: () => now },
        );
        modules.set(relative, exports);
        return exports;
    }
    const { LongPressTaskDrag } = load('src/utils/longPressTaskDrag.ts');
    const filename = 'src/components/panel/ReminderPanel.ts';
    const source = ts.createSourceFile(filename, fs.readFileSync(path.join(rootPath, filename), 'utf8'), ts.ScriptTarget.Latest, true);
    const names = ['ensureMobileTaskDrag', 'getMobileTaskDropTarget', 'addDragFunctionality', 'isDragDisabledBySortMode',
        'canDropHere', 'wouldCreateCycle', 'isSameNonPrioritySortGroup', 'getNonPrioritySortGroupKey', 'getDropType',
        'handleDrop', 'setParentRelation', 'removeParentRelation', 'isSameLevelSort', 'reorderReminders', 'reorderPriorityGroup', 'updateItemSort'];
    const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPanel').members
        .filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
    const state = { data: Object.fromEntries(initialTasks.map(task => [task.id, clone(task)])), writes: 0, loads: 0, errors: [], indicator: null };
    const Panel = new Function('LongPressTaskDrag', 'window', 'document', 'getAllReminders', 'saveReminders', 'parseReminderInstanceId', 'i18n', 'showMessage',
        compile(`class Panel { ${methods} }`) + ';return Panel;')(
        LongPressTaskDrag, window, document, async () => clone(state.data), async (_plugin, data) => { state.data = clone(data); state.writes++; },
        () => null, key => key, message => state.errors.push(message),
    );
    const panel = Object.assign(new Panel(), {
        remindersContainer: root, currentRemindersCache: clone(initialTasks), isMobileClient: true, plugin: {},
        getActiveSortCriteria: () => [{ method: 'priority', order: 'asc' }],
        showDropIndicator: (element, point) => { state.indicator = { id: element.dataset.reminderId, type: panel.getDropType(element, point) }; },
        hideDropIndicator: () => { state.indicator = null; }, updateDOMOrder() {},
        loadReminders: async () => { state.loads++; panel.currentRemindersCache = clone(Object.values(state.data)); },
    });
    for (const task of initialTasks) panel.addDragFunctionality(rows.get(task.id), task);
    function send(type, { target = rows.get('a'), x = 100, y = 100, id = 1, count = 1, changedId = id } = {}) {
        const event = new Event(type, { cancelable: true });
        const point = { clientX: x, clientY: y, identifier: id, target };
        Object.assign(event, {
            touches: type === 'touchend' || type === 'touchcancel' ? [] : Array.from({ length: count }, (_, i) => ({ ...point, identifier: id + i })),
            changedTouches: [{ ...point, identifier: changedId }],
        });
        Object.defineProperty(event, 'target', { value: target });
        (type === 'touchstart' || type === 'click' || type === 'contextmenu' || type === 'pointercancel' ? root : document).dispatchEvent(event);
        return event;
    }
    function advance(ms) {
        now += ms;
        for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    }
    function frame() {
        now += 16;
        for (const [id, callback] of [...frames]) { frames.delete(id); callback(now); }
    }
    return { panel, state, root, rows, document, window, timers, frames, send, advance, frame,
        order: () => Object.values(state.data).sort((a, b) => a.sort - b.sort).map(task => task.id),
        settle: () => new Promise(resolve => setImmediate(resolve)),
    };
}

test('与文档树一致：短按不拖动，460ms 前移动超过 5px 保留为列表滚动', () => {
    const f = environment();
    assert.equal(f.send('touchstart').defaultPrevented, false);
    f.advance(459);
    assert.equal(f.panel.isDragging, undefined);
    assert.equal(f.send('touchmove', { y: 106 }).defaultPrevented, false);
    f.advance(500);
    assert.equal(f.frames.size, 0);
    f.send('touchend', { y: 106 });
    assert.equal(f.state.writes, 0);
    assert.equal(f.send('click').defaultPrevented, false);
});

for (const [y, type, expected] of [[165, 'before', ['a', 'c', 'b']], [235, 'after', ['b', 'a', 'c']]]) {
    test(`长按卡片拖到目标${type === 'before' ? '上' : '下'}边缘，复用真实排序保存逻辑`, async () => {
        const f = environment();
        f.send('touchstart', type === 'before' ? { target: f.rows.get('c'), y: 300 } : {}); f.advance(460);
        assert.equal(f.panel.isDragging, true);
        assert.equal(f.document.body.children.length, 2);
        assert.equal(f.send('touchmove', { y }).defaultPrevented, true);
        f.frame();
        assert.deepEqual(f.state.indicator, { id: 'b', type });
        assert.equal(f.send('touchend', { y }).defaultPrevented, true);
        await f.settle();
        assert.equal(f.state.writes, 1);
        assert.deepEqual(f.order(), expected);
        assert.equal(f.panel.isDragging, false);
        assert.equal(f.frames.size, 0);
        assert.equal(f.document.body.children.length, 1);
        assert.equal(f.state.indicator, null);
        assert.deepEqual(f.state.errors, []);
        assert.equal(f.send('click').defaultPrevented, true);
        f.advance(401);
        assert.equal(f.send('click').defaultPrevented, false);
    });
}

test('拖到卡片中间设置为子任务，保存 parentId 与父任务项目，保留其他数据', async () => {
    const f = environment([{ id: 'a', title: 'A' }, { id: 'b', title: 'B', projectId: 'project' }, { id: 'c', title: 'C', note: '保留' }]);
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
    assert.deepEqual(f.state.indicator, { id: 'b', type: 'set-parent' });
    f.send('touchend', { y: 200 }); await f.settle();
    assert.equal(f.state.data.a.parentId, 'b');
    assert.equal(f.state.data.a.projectId, 'project');
    assert.equal(f.state.data.c.note, '保留');
    assert.equal(f.state.writes, 1);
    assert.deepEqual(f.state.errors, []);
});

test('松手前重新命中落点，不使用上一次移动事件的旧落点', async () => {
    const f = environment();
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
    f.send('touchend', { y: 235 }); await f.settle();
    assert.equal(f.state.data.a.parentId, undefined);
    assert.deepEqual(f.order(), ['b', 'a', 'c']);
});

test('按钮和进度条可正常操作，长按卡片不再触发宿主右键菜单', () => {
    const f = environment();
    for (const tag of ['button', 'input', 'a', 'progress']) {
        const control = f.rows.get('a').appendChild(new Element(tag));
        if (tag === 'progress') control.classList.add('reminder-item__progress-wrap');
        f.send('touchstart', { target: control }); f.advance(500);
        assert.equal(f.frames.size, 0);
        f.send('touchend', { target: control });
    }
    f.send('touchstart');
    assert.equal(f.send('contextmenu').defaultPrevented, true);
    f.advance(460);
    assert.equal(f.send('contextmenu').defaultPrevented, true);
});

test('绑定块的任务标题支持长按拖动，短按仍保留打开链接的点击', () => {
    const f = environment();
    const title = f.rows.get('a').appendChild(new Element('span'));
    title.classList.add('reminder-item__title');
    title.dataset.type = 'a'; title.dataset.href = 'siyuan://blocks/block';
    f.send('touchstart', { target: title }); f.advance(100); f.send('touchend', { target: title });
    assert.equal(f.send('click', { target: title }).defaultPrevented, false);
    assert.equal(f.frames.size, 0);
    f.send('touchstart', { target: title }); f.advance(460);
    assert.equal(f.panel.isDragging, true);
    f.send('touchcancel');
});

test('订阅任务、循环父子引用与禁用排序模式沿用现有落点检查', async () => {
    for (const extra of [{ parentId: 'a' }, { isSubscribed: true }]) {
        const f = environment([{ id: 'a' }, { id: 'b', ...extra }]);
        f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
        assert.equal(f.state.indicator, null);
        f.send('touchend', { y: 200 }); await f.settle();
        assert.equal(f.state.writes, 0);
    }
    for (const method of ['title', 'created']) {
        const f = environment();
        f.panel.getActiveSortCriteria = () => [{ method }];
        f.send('touchstart'); f.advance(500);
        assert.equal(f.frames.size, 0);
        assert.equal(f.send('touchmove', { y: 200 }).defaultPrevented, false);
    }
});

test('拖出列表或拖到已删除的任务时不保存，非法落点清除指示器', async () => {
    const f = environment();
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
    assert.ok(f.state.indicator);
    f.send('touchmove', { x: 500, y: 200 }); f.frame();
    assert.equal(f.state.indicator, null);
    f.send('touchend', { x: 500, y: 200 }); await f.settle();
    assert.equal(f.state.writes, 0);
    f.advance(500); f.send('touchstart'); f.advance(460);
    f.panel.currentRemindersCache = f.panel.currentRemindersCache.filter(task => task.id !== 'b');
    f.send('touchend', { y: 200 }); await f.settle();
    assert.equal(f.state.writes, 0);
});

test('手指停在边缘仍连续滚动，滚动后持续更新落点；松手立即停止', () => {
    const f = environment();
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 390 }); f.frame();
    const first = f.root.scrollTop;
    f.frame(); f.frame();
    assert.ok(first > 0);
    assert.ok(f.root.scrollTop > first);
    f.send('touchcancel');
    assert.equal(f.frames.size, 0);
});

for (const reason of ['touchcancel', 'pointercancel', 'blur', 'hidden', 'multi', 'identity', 'dispose', 'scroll', 'detached']) {
    test(`${reason} 取消手势，清理预览、计时器、指示器与监听，不提交保存`, async () => {
        const f = environment();
        f.send('touchstart');
        if (reason !== 'scroll') f.advance(460);
        const staleFrame = [...f.frames.values()][0];
        if (reason === 'blur') f.window.dispatchEvent(new Event('blur'));
        else if (reason === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
        else if (reason === 'multi') f.send('touchmove', { count: 2 });
        else if (reason === 'identity') f.send('touchend', { changedId: 2 });
        else if (reason === 'dispose') f.panel.mobileTaskDrag.dispose();
        else if (reason === 'scroll') f.root.dispatchEvent(new Event('scroll'));
        else if (reason === 'detached') { f.rows.get('a').remove(); f.frame(); }
        else f.send(reason);
        if (reason === 'dispose') staleFrame?.(1000);
        f.advance(500); f.send('touchend', { y: 200 }); await f.settle();
        assert.equal(f.state.writes, 0);
        assert.equal(f.frames.size, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.document.body.children.length, 1);
        assert.equal(f.state.indicator, null);
        f.panel.mobileTaskDrag.dispose();
        assert.equal(f.document.listenerCount, 0);
        assert.equal(f.window.listenerCount, 0);
        assert.equal(f.root.listenerCount, 0);
    });
}
