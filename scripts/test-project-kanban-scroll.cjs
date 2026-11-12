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
