// Run with: node --test scripts/test-project-kanban-scroll.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const relative = 'src/components/panel/ProjectKanbanView.ts';
const content = process.env.KANBAN_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.KANBAN_SOURCE_REF}:${relative}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, relative), 'utf8');
const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ProjectKanbanView').members;
const method = members.find(node => node.name?.getText(source) === 'rerenderTaskListContainer').getText(source);
const code = ts.transpileModule(`class Board { ${method} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

class Element {
    constructor(id) {
        this.dataset = id ? { taskId: id } : {};
        this.children = [];
        this.parentElement = null;
        this.style = { minHeight: '' };
        this.offsetHeight = 800;
        this.maxScrollTop = 2000;
        this.scrollTop = 0;
        this.scrollLeft = 0;
    }
    get scrollTop() { return this.top; }
    set scrollTop(value) { this.top = Math.max(0, Math.min(this.maxScrollTop, value)); }
    get childNodes() { return this.children; }
    querySelectorAll() { return this.children.filter(child => child.dataset.taskId); }
    remove() {
        const parent = this.parentElement;
        if (!parent) return;
        parent.children.splice(parent.children.indexOf(this), 1);
        this.parentElement = null;
        parent.onRemove?.();
    }
    insertBefore(child, anchor) {
        child.remove();
        const index = anchor ? this.children.indexOf(anchor) : this.children.length;
        this.children.splice(index, 0, child);
        child.parentElement = this;
    }
}

function fixture() {
    const document = { createElement: () => new Element() };
    const Board = new Function('document', code + ';return Board;')(document);
    // 覆盖内层状态任务列表、外层列和横向看板，滚动状态相互独立。
    const outside = new Element(), root = new Element(), horizontal = new Element();
    const column = new Element(), list = new Element();
    outside.insertBefore(root, null);
    root.insertBefore(horizontal, null);
    horizontal.insertBefore(column, null);
    column.insertBefore(list, null);
    root.scrollTop = 30;
    horizontal.scrollLeft = 420;
    column.scrollTop = 640;
    list.scrollTop = 280;
    const tasks = [{ id: 'parent' }, { id: 'child', parentId: 'parent', completed: true }];
    tasks.forEach(task => list.insertBefore(new Element(task.id), null));
    const loadMore = new Element();
    list.insertBefore(loadMore, null);
    const frames = [];
    const savedState = { containerScrollLeft: 99, columnScrollTopMap: { doing: 100 } };
    const board = Object.assign(new Board(), {
        container: root, tasks, _savedScrollState: savedState,
        lifecycle: { frame: callback => frames.push(callback) },
        getTaskListGroupId: () => 'group',
        getTaskListStatus: () => 'doing',
        augmentTasksWithDescendants: tasks => tasks,
        renderTasksInColumn: (host, tasks) => tasks.forEach(task => host.insertBefore(new Element(task.id), null)),
    });
    // 模拟被移除的卡片原本是浏览器滚动锚点，移除时各层滚动位置发生调整。
    list.onRemove = () => {
        root.scrollTop = 0;
        horizontal.scrollLeft = 0;
        column.scrollTop = 0;
        list.scrollTop = 0;
    };
    return { board, tasks, outside, root, horizontal, column, list, loadMore, frames, savedState };
}

test('子任务完成后局部重绘保持各级滚动位置及加载更多按钮', () => {
    const { board, tasks, root, horizontal, column, list, loadMore, savedState } = fixture();
    board.rerenderTaskListContainer(list, tasks[1]);
    assert.equal(list.scrollTop, 280);
    assert.equal(column.scrollTop, 640);
    assert.equal(horizontal.scrollLeft, 420);
    assert.equal(root.scrollTop, 30);
    assert.deepEqual(list.children.map(child => child.dataset.taskId), ['parent', 'child', undefined]);
    assert.equal(list.children[2], loadMore);
    assert.equal(board._savedScrollState, savedState, '局部刷新不能消费或覆盖整页刷新的快照');
});

test('完成后内容收缩时，在解除占位高度后按有效范围恢复滚动', () => {
    const { board, tasks, column, list, frames } = fixture();
    let minHeight = '20px';
    Object.defineProperty(list.style, 'minHeight', {
        get: () => minHeight,
        set: value => {
            minHeight = value;
            if (value === '20px') {
                // 模拟完成子任务折叠后代，实际内容高度降低。
                list.maxScrollTop = 160;
                column.maxScrollTop = 500;
                list.scrollTop = list.scrollTop;
                column.scrollTop = column.scrollTop;
            }
        },
    });
    board.rerenderTaskListContainer(list, tasks[1]);
    frames.splice(0).forEach(callback => callback());
    assert.equal(list.style.minHeight, '20px');
    assert.equal(list.scrollTop, 160);
    assert.equal(column.scrollTop, 500);
});

test('连续完成子任务后继续滚动，不会被旧帧回调拉回', () => {
    const { board, tasks, column, list, frames } = fixture();
    board.rerenderTaskListContainer(list, tasks[1]);
    column.scrollTop = 720;
    list.scrollTop = 350;
    board.rerenderTaskListContainer(list, tasks[1]);
    assert.equal(column.scrollTop, 720);
    assert.equal(list.scrollTop, 350);
    column.scrollTop = 900;
    frames.splice(0).forEach(callback => callback());
    assert.equal(column.scrollTop, 900);
});

test('卡片生成失败时保留原列表和原滚动位置', () => {
    const { board, tasks, column, list } = fixture();
    const children = [...list.children];
    board.renderTasksInColumn = () => { throw new Error('render failed'); };
    assert.throws(() => board.rerenderTaskListContainer(list, tasks[1]), /render failed/);
    assert.deepEqual(list.children, children);
    assert.equal(list.style.minHeight, '');
    assert.equal(column.scrollTop, 640);
    assert.equal(list.scrollTop, 280);
});

test('恢复范围截至当前看板，不覆盖宿主外层的滚动变化', () => {
    const { board, tasks, outside, list } = fixture();
    const onRemove = list.onRemove;
    list.onRemove = () => { onRemove(); outside.scrollTop = 99; };
    board.rerenderTaskListContainer(list, tasks[1]);
    assert.equal(outside.scrollTop, 99);
});

test('触底增量加载按批追加任务而不重绘已有卡片，加载完自动移除哨兵并释放观察器', () => {
    const taskHierarchyCode = ts.transpileModule(
        fs.readFileSync(path.join(root, 'src/utils/taskHierarchy.ts'), 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
    ).outputText;
    const hierarchyExports = {};
    new Function('exports', taskHierarchyCode)(hierarchyExports);

    const extracted = [
        'pageSize', 'pageIndexMap', 'scrollLoadCleanups',
        'clearScrollLoadObservers', 'pruneDisconnectedScrollLoadObservers',
        'findVerticalScrollContainer', 'renderPaginatedTaskList',
    ].map(name => members.find(node => node.name?.getText(source) === name).getText(source)).join('\n');
    const incrementalCode = ts.transpileModule(`class Board { ${extracted} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;

    class DomNode {
        constructor(tag = 'div', id = '') {
            this.tag = tag;
            this.className = '';
            this.dataset = id ? { taskId: id } : {};
            this.attributes = {};
            this.children = [];
            this.parentElement = null;
            this.isConnected = false;
            this.classList = {
                contains: name => this.className.split(/\s+/).includes(name),
            };
        }
        setAttribute(k, v) { this.attributes[k] = v; }
        _syncConnected(connected) {
            this.isConnected = connected;
            this.children.forEach(c => c._syncConnected(connected));
        }
        appendChild(child) {
            if (child.tag === '#fragment') {
                [...child.children].forEach(node => this.appendChild(node));
                return child;
            }
            child.remove();
            this.children.push(child);
            child.parentElement = this;
            child._syncConnected(this.isConnected);
            return child;
        }
        insertBefore(child, anchor) {
            if (child.tag === '#fragment') {
                [...child.children].forEach(node => this.insertBefore(node, anchor));
                return child;
            }
            child.remove();
            const index = anchor ? this.children.indexOf(anchor) : this.children.length;
            this.children.splice(index < 0 ? this.children.length : index, 0, child);
            child.parentElement = this;
            child._syncConnected(this.isConnected);
            return child;
        }
        remove() {
            if (!this.parentElement) return;
            const list = this.parentElement.children;
            const idx = list.indexOf(this);
            if (idx >= 0) list.splice(idx, 1);
            this.parentElement = null;
            this._syncConnected(false);
        }
    }

    const observers = [];
    class FakeIntersectionObserver {
        constructor(callback, options) {
            this.callback = callback;
            this.options = options;
            this.targets = new Set();
            this.disconnected = false;
            observers.push(this);
        }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.disconnected = true; this.targets.clear(); }
        trigger(isIntersecting) {
            this.callback([{ isIntersecting }]);
        }
    }

    const doc = {
        createElement: tag => new DomNode(tag),
        createDocumentFragment: () => new DomNode('#fragment'),
    };
    const Board = new Function('document', 'IntersectionObserver', 'TaskHierarchyIndex', 'getComputedStyle', incrementalCode + ';return Board;')(
        doc, FakeIntersectionObserver, hierarchyExports.TaskHierarchyIndex,
        el => ({ overflowY: el.className.includes('kanban-column-content') ? 'auto' : 'visible' }),
    );

    const frames = [];
    const renderedBatches = [];
    let fullRenderCalls = 0;
    const rootEl = new DomNode('div');
    rootEl.isConnected = true;
    const scrollColumn = new DomNode('div');
    scrollColumn.className = 'kanban-column-content';
    const listContainer = new DomNode('div');
    listContainer.className = 'custom-group-tasks';
    rootEl.appendChild(scrollColumn);
    scrollColumn.appendChild(listContainer);

    const board = Object.assign(new Board(), {
        container: rootEl,
        disposed: false,
        pageSize: 2,
        lifecycle: { frame: cb => frames.push(cb) },
        renderKanban: () => { fullRenderCalls++; },
        renderTaskTree: (host, batchRoots, hierarchy) => {
            renderedBatches.push(batchRoots.map(t => t.id));
            for (const item of batchRoots) {
                host.appendChild(new DomNode('div', item.id));
                for (const child of hierarchy.children(item.id)) {
                    host.appendChild(new DomNode('div', child.id));
                }
            }
        },
    });

    const tasks = [
        { id: 'r1' }, { id: 'r1-c1', parentId: 'r1' },
        { id: 'r2' },
        { id: 'r3' },
        { id: 'r4' },
        { id: 'r5' },
    ];

    const { totalTop } = board.renderPaginatedTaskList(listContainer, tasks, 'status-mode-g1', 'doing');
    assert.equal(totalTop, 5);
    assert.deepEqual(renderedBatches, [['r1', 'r2']]);
    assert.deepEqual(listContainer.children.map(n => n.dataset.taskId || n.className), ['r1', 'r1-c1', 'r2', 'kanban-scroll-sentinel']);

    const firstNodeRef = listContainer.children[0];
    // 下一帧挂载观察器，识别滚动容器并设置预加载边距
    frames.splice(0).forEach(cb => cb());
    assert.equal(observers.length, 1);
    assert.equal(observers[0].options.root, scrollColumn);
    assert.equal(observers[0].options.rootMargin, '300px 0px');

    // 第一次触底：只追加 r3, r4，不重绘已有卡片也不触发 renderKanban
    observers[0].trigger(true);
    assert.equal(fullRenderCalls, 0);
    assert.equal(listContainer.children[0], firstNodeRef);
    assert.deepEqual(renderedBatches, [['r1', 'r2'], ['r3', 'r4']]);
    assert.deepEqual(listContainer.children.map(n => n.dataset.taskId || n.className), ['r1', 'r1-c1', 'r2', 'r3', 'r4', 'kanban-scroll-sentinel']);
    assert.equal(board.pageIndexMap['status-mode-g1'], 2);
    assert.equal(observers[0].disconnected, false);

    // 下一帧重新观察哨兵后再次触底：追加最后一批 r5，自动销毁观察器并移除哨兵
    frames.splice(0).forEach(cb => cb());
    assert.equal(observers[0].targets.size, 1);
    observers[0].trigger(true);
    assert.deepEqual(renderedBatches, [['r1', 'r2'], ['r3', 'r4'], ['r5']]);
    assert.deepEqual(listContainer.children.map(n => n.dataset.taskId), ['r1', 'r1-c1', 'r2', 'r3', 'r4', 'r5']);
    assert.equal(observers[0].disconnected, true);
    assert.equal(board.scrollLoadCleanups.size, 0);

    // 重新渲染或销毁视图时清理未完成的观察器
    listContainer.children = [];
    board.pageIndexMap['status-mode-g1'] = 1;
    board.renderPaginatedTaskList(listContainer, tasks, 'status-mode-g1', 'doing');
    frames.splice(0).forEach(cb => cb());
    assert.equal(observers.length, 2);
    board.clearScrollLoadObservers();
    assert.equal(observers[1].disconnected, true);
    assert.equal(listContainer.children.some(n => n.className === 'kanban-scroll-sentinel'), false);

    // 验证 CSS 视口外绘制跳过与哨兵样式
    const kanbanScss = fs.readFileSync(path.join(root, 'src/styles/projectKanban.scss'), 'utf8');
    assert.match(kanbanScss, /\.kanban-task\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*auto\s+76px;/);
    assert.match(kanbanScss, /\.kanban-scroll-sentinel\s*\{/);
});
