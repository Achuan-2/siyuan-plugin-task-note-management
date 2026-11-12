// Run with: node --test scripts/test-project-kanban-touch-drag.cjs
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
const filename = 'src/components/panel/ProjectKanbanView.ts';
const source = ts.createSourceFile(filename, fs.readFileSync(path.join(rootPath, filename), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['ensureMobileTaskDrag', 'getMobileTaskDropTarget', 'handleMobileTaskDrop', 'scrollMobileTaskDrag',
    'getTaskFromElement', 'canDropForSort', 'canBecomeSiblingOf', 'canSetAsParentChild', 'isDescendant',
    'setParentChildRelation', 'handleBecomeSiblingDrop', 'reorderTasks', 'getAllDescendantIds', 'destroy'];
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ProjectKanbanView').members
    .filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
const boardCode = compile(`class Board { ${methods} }`) + ';return Board;';

class Target extends EventTarget {
    listeners = new Set();
    addEventListener(type, listener, options) { super.addEventListener(type, listener, options); this.listeners.add(listener); }
    removeEventListener(type, listener, options) { super.removeEventListener(type, listener, options); this.listeners.delete(listener); }
}
class Element extends Target {
    children = [];
    dataset = {};
    style = {};
    computed = { overflowX: 'visible', overflowY: 'visible' };
    isConnected = true;
    maxTop = 2000;
    maxLeft = 0;
    top = 0;
    left = 0;
    classList = Object.assign(new Set(), {
        remove: (...names) => names.forEach(name => this.classList.delete(name)),
        contains: name => this.classList.has(name),
    });
    constructor(tag = 'div') { super(); this.tag = tag; }
    get scrollTop() { return this.top; }
    set scrollTop(value) { this.top = Math.max(0, Math.min(this.maxTop, value)); }
    get scrollLeft() { return this.left; }
    set scrollLeft(value) { this.left = Math.max(0, Math.min(this.maxLeft, value)); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() { this.isConnected = false; this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    contains(node) { while (node) { if (node === this) return true; node = node.parentElement; } return false; }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) {
            if (selector.split(',').some(part => {
                const match = part.trim();
                if (match === '.kanban-task[data-task-id]') return node.classList.has('kanban-task') && !!node.dataset.taskId;
                if (match.startsWith('.')) return node.classList.has(match.slice(1));
                if (match === '[data-type="a"]') return node.dataset.type === 'a';
                if (match === '[data-href]') return !!node.dataset.href;
                return match === node.tag;
            })) return node;
        }
        return null;
    }
    querySelector(selector) {
        const id = selector.match(/data-task-id="([^"]+)"/)?.[1];
        for (const child of this.children) {
            if (id && child.dataset.taskId === id) return child;
            const result = child.querySelector(selector);
            if (result) return result;
        }
        return null;
    }
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 320, bottom: 400, width: 320, height: 400 }; }
}

function environment(initialTasks = ['a', 'b', 'c'].map((id, index) => ({ id, title: id, projectId: 'project', sort: index * 10 }))) {
    let now = 0, nextId = 0;
    const timers = new Map(), frames = new Map();
    const window = Object.assign(new Target(), {
        setTimeout(callback, delay) { timers.set(++nextId, { callback, due: now + delay }); return nextId; },
        clearTimeout(id) { timers.delete(id); },
    });
    const document = Object.assign(new Target(), { hidden: false, body: new Element('body'), createElement: tag => new Element(tag) });
    const root = document.body.appendChild(new Element());
    root.computed.overflowY = 'auto';
    const rows = new Map(initialTasks.map((task, index) => {
        const row = root.appendChild(new Element());
        row.dataset.taskId = task.id;
        row.classList.add('kanban-task');
        row.getBoundingClientRect = () => ({ left: 0, right: 320, width: 320, height: 80, top: 60 + index * 100 - root.scrollTop, bottom: 140 + index * 100 - root.scrollTop });
        return [task.id, row];
    }));
    document.elementFromPoint = (x, y) => x < 0 || x > 320 || y < 0 || y > 400 ? null
        : [...rows.values()].find(row => y >= row.getBoundingClientRect().top && y <= row.getBoundingClientRect().bottom) || root;
    const requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
    const modules = new Map();
    function load(relative) {
        if (modules.has(relative)) return modules.get(relative);
        const exports = {};
        new Function('require', 'exports', 'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date',
            compile(fs.readFileSync(path.join(rootPath, relative), 'utf8')))(
            name => load(path.relative(rootPath, path.resolve(path.dirname(path.join(rootPath, relative)), name + '.ts'))),
            exports, window, document, requestAnimationFrame, id => frames.delete(id), { now: () => now }, { now: () => now },
        );
        modules.set(relative, exports);
        return exports;
    }
    const { LongPressTaskDrag } = load('src/utils/longPressTaskDrag.ts');
    const state = { data: Object.fromEntries(initialTasks.map(task => [task.id, clone(task)])), writes: 0, errors: [], messages: [], indicator: null };
    const saveReminders = async (_plugin, data) => { state.data = clone(data); state.writes++; };
    const Board = new Function('LongPressTaskDrag', 'document', 'getComputedStyle', 'saveReminders', 'i18n', 'showMessage', 'console',
        'getLogicalDateString', 'getLocalDateTimeString', boardCode)(
        LongPressTaskDrag, document, element => element.computed, saveReminders, key => key, message => state.messages.push(message),
        { error: (...args) => state.errors.push(args), log() {}, warn: (...args) => state.errors.push(args) },
        () => '2026-11-12', () => '2026-11-12 12:00:00',
    );
    const board = Object.assign(new Board(), {
        container: root, tasks: clone(initialTasks), projectId: 'project', kanbanMode: 'status', plugin: {},
        getReminders: async () => clone(state.data),
        getTaskStatus: task => task.completed ? 'completed' : task.kanbanStatus || 'doing',
        queueLoadTasks: async () => { board.tasks = clone(Object.values(state.data)); },
        updateIndicator: (type, element, position) => { state.indicator = type === 'none' ? null : { type, id: element.dataset.taskId, position }; },
        clearDropZoneHighlights: () => { state.indicator = null; },
        stopDragScroll() {}, syncCustomProgressOnCompletion() {}, dispatchReminderUpdate() {},
        reorderTasksDOM: () => false, refreshTaskElement() {}, updateTaskElementDOM() {},
        lifecycle: { dispose() {} }, unbindProjectTabDropTarget() {}, completionMoveTimers: new Map(),
    });
    board.ensureMobileTaskDrag();
    function send(type, { target = rows.get('a'), x = 100, y = 100, count = 1 } = {}) {
        const event = new Event(type, { cancelable: true });
        const point = { clientX: x, clientY: y, identifier: 1, target };
        Object.assign(event, { touches: type === 'touchend' || type === 'touchcancel' ? []
            : Array.from({ length: count }, (_, i) => ({ ...point, identifier: i + 1 })), changedTouches: [point] });
        Object.defineProperty(event, 'target', { value: target });
        (['touchstart', 'click', 'contextmenu', 'pointercancel'].includes(type) ? root : document).dispatchEvent(event);
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
    return { board, state, root, rows, document, window, timers, frames, send, advance, frame,
        order: () => Object.values(state.data).sort((a, b) => a.sort - b.sort).map(task => task.id),
        settle: () => new Promise(resolve => setImmediate(resolve)),
    };
}

test('短按和长按前的滑动保留点击与滚动，460ms 后才拖动', () => {
    const f = environment();
    f.send('touchstart'); f.advance(459);
    assert.equal(f.board.isDragging, undefined);
    assert.equal(f.send('touchmove', { y: 106 }).defaultPrevented, false);
    f.advance(500); f.send('touchend');
    assert.equal(f.frames.size, 0);
    assert.equal(f.send('click').defaultPrevented, false);
});

for (const mode of ['status', 'custom', 'list']) {
    for (const [y, position, expected] of [[165, 'top', ['a', 'c', 'b']], [235, 'bottom', ['b', 'a', 'c']]]) {
        test(`${mode} 模式长按后拖到卡片${position}，执行真实排序保存`, async () => {
            const f = environment();
            f.board.kanbanMode = mode;
            f.send('touchstart', position === 'top' ? { target: f.rows.get('c'), y: 300 } : {}); f.advance(460);
            assert.equal(f.board.isDragging, true);
            assert.equal(f.send('touchmove', { y }).defaultPrevented, true); f.frame();
            assert.deepEqual(f.state.indicator, { type: 'sort', id: 'b', position });
            f.send('touchend', { y }); await f.settle();
            assert.deepEqual(f.order(), expected);
            assert.equal(f.state.writes, 1);
            assert.deepEqual(f.state.errors, []);
            assert.equal(f.board.isDragging, false);
            assert.equal(f.state.indicator, null);
            assert.equal(f.document.body.children.length, 1);
            assert.equal(f.send('click').defaultPrevented, true);
        });
    }
}

test('拖到卡片中间设置子任务，继承父任务项目、分组与状态，保留最新全量数据', async () => {
    const f = environment([{ id: 'a' }, { id: 'b', projectId: 'project', customGroupId: 'group', kanbanStatus: 'long_term' }]);
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
    assert.deepEqual(f.state.indicator, { type: 'parentChild', id: 'b', position: 'middle' });
    f.state.data.newTask = { id: 'newTask', note: '拖动期间新建' };
    f.send('touchend', { y: 200 }); await f.settle();
    assert.equal(f.state.data.a.parentId, 'b');
    assert.equal(f.state.data.a.projectId, 'project');
    assert.equal(f.state.data.a.customGroupId, 'group');
    assert.equal(f.state.data.a.kanbanStatus, 'long_term');
    assert.equal(f.state.data.newTask.note, '拖动期间新建');
    assert.deepEqual(f.state.errors, []);
});

test('拖到子任务边缘成为其同级，拖到根任务边缘解除父子关系', async () => {
    for (const targetIsChild of [true, false]) {
        const tasks = ['a', 'b', 'c'].map((id, index) => ({ id, projectId: 'project', sort: index * 10 }));
        if (targetIsChild) tasks[1].parentId = 'c';
        else tasks[0].parentId = 'c';
        const f = environment(tasks);
        f.send('touchstart'); f.advance(460); f.send('touchend', { y: 165 }); await f.settle();
        assert.equal(f.state.data.a.parentId, targetIsChild ? 'c' : undefined);
        assert.ok(f.state.data.a.sort < f.state.data.b.sort);
        assert.equal(f.state.writes, 1);
        assert.deepEqual(f.state.errors, []);
    }
});

test('同父子任务中间落点使用排序提示，不误提示设置子任务', async () => {
    const f = environment([{ id: 'a', parentId: 'c', projectId: 'project' }, { id: 'b', parentId: 'c', projectId: 'project' }, { id: 'c' }]);
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
    assert.deepEqual(f.state.indicator, { type: 'sort', id: 'b', position: 'bottom' });
    f.send('touchend', { y: 200 }); await f.settle();
    assert.equal(f.state.data.a.parentId, 'c');
    assert.ok(f.state.data.a.sort > f.state.data.b.sort);
    assert.deepEqual(f.state.errors, []);
});

test('松手重新命中落点；拖出看板、目标删除或父任务拖向后代均不保存', async () => {
    const f = environment();
    f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
    f.send('touchend', { y: 235 }); await f.settle();
    assert.equal(f.state.data.a.parentId, undefined);
    assert.deepEqual(f.order(), ['b', 'a', 'c']);
    for (const reason of ['outside', 'deleted', 'descendant', 'self']) {
        const g = environment();
        g.send('touchstart'); g.advance(460);
        if (reason === 'deleted') g.board.tasks = g.board.tasks.filter(task => task.id !== 'b');
        if (reason === 'descendant') g.board.tasks.find(task => task.id === 'b').parentId = 'a';
        g.send('touchend', { x: reason === 'outside' ? 500 : 100, y: reason === 'self' ? 100 : 165 });
        await g.settle();
        assert.equal(g.state.writes, 0, reason);
    }
});

test('按钮、进度条和非标题链接不启动拖动；绑定标题仍支持长按', () => {
    const f = environment();
    for (const tag of ['button', 'input', 'a', 'progress']) {
        const control = f.rows.get('a').appendChild(new Element(tag));
        if (tag === 'progress') control.classList.add('reminder-item__progress-wrap');
        f.send('touchstart', { target: control }); f.advance(500);
        assert.equal(f.frames.size, 0);
        f.send('touchend');
    }
    const title = f.rows.get('a').appendChild(new Element('span'));
    title.classList.add('reminder-item__title'); title.dataset.type = 'a'; title.dataset.href = 'siyuan://blocks/id';
    f.send('touchstart', { target: title }); f.advance(460);
    assert.equal(f.board.isDragging, true);
    assert.equal(f.send('contextmenu').defaultPrevented, true);
    f.send('touchcancel');
});

test('多选与加载中不能启动拖动，订阅任务和重复实例不设置父子关系', () => {
    for (const property of ['isMultiSelectMode', 'isLoading']) {
        const f = environment(); f.board[property] = true;
        f.send('touchstart'); f.advance(500);
        assert.equal(f.frames.size, 0);
    }
    for (const extra of [{ isSubscribed: true }, { isRepeatInstance: true, originalId: 'original' }]) {
        const f = environment([{ id: 'a', ...extra }, { id: 'b' }]);
        const target = f.board.getMobileTaskDropTarget(f.board.tasks[0], { clientX: 100, clientY: 200 });
        assert.notEqual(target?.action, 'parent');
        assert.notEqual(target?.action, 'sibling');
    }
});

test('边缘持续滚动命中列及外层横向看板，刷新落点，松手停止', () => {
    const f = environment();
    const column = f.root.appendChild(new Element());
    column.computed.overflowY = 'auto';
    f.root.computed = { overflowX: 'auto', overflowY: 'auto' }; f.root.maxLeft = 2000;
    f.document.elementFromPoint = () => column;
    f.send('touchstart'); f.advance(460); f.send('touchmove', { x: 315, y: 390 }); f.frame();
    const firstTop = column.scrollTop, firstLeft = f.root.scrollLeft;
    f.frame(); f.frame();
    assert.ok(firstTop > 0 && column.scrollTop > firstTop);
    assert.ok(firstLeft > 0 && f.root.scrollLeft > firstLeft);
    assert.equal(f.root.scrollTop, 0, '内层可滚动时不重复滚动外层同一轴');
    f.send('touchcancel'); assert.equal(f.frames.size, 0);
});

for (const reason of ['touchcancel', 'pointercancel', 'blur', 'hidden', 'multi', 'refresh', 'destroy']) {
    test(`${reason} 清理预览、指示器、动画与监听，不保存`, async () => {
        const f = environment();
        f.send('touchstart'); f.advance(460); f.send('touchmove', { y: 200 }); f.frame();
        if (reason === 'blur') f.window.dispatchEvent(new Event('blur'));
        else if (reason === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
        else if (reason === 'multi') f.send('touchmove', { count: 2 });
        else if (reason === 'refresh') f.board.mobileTaskDrag.cancel();
        else if (reason === 'destroy') f.board.destroy();
        else f.send(reason);
        f.send('touchend', { y: 200 }); await f.settle();
        assert.equal(f.state.writes, 0);
        assert.equal(f.frames.size, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.document.body.children.length, 1);
        assert.equal(f.state.indicator, null);
        if (reason !== 'destroy') f.board.destroy();
        assert.equal(f.document.listeners.size, 0);
        assert.equal(f.window.listeners.size, 0);
        assert.equal(f.root.listeners.size, 0);
    });
}
