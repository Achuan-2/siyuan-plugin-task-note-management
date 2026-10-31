// Run with: node --test scripts/test-project-kanban-data.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

function extract(relative, className, names) {
    const content = process.env.KANBAN_SOURCE_REF
        ? execFileSync('git', ['show', `${process.env.KANBAN_SOURCE_REF}:${relative}`], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(path.join(root, relative), 'utf8');
    const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
    const members = className
        ? source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className).members
        : source.statements;
    return members.filter(node => names.includes(node.name?.getText(source)))
        .map(node => node.getText(source).replace(/^export /, '')).join('\n');
}

// 执行真实看板方法及全量任务读写函数，仅替换思源、订阅和界面依赖。
const methods = extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
    'getReminders', 'editTask', 'showTaskNotePreview', 'setReminderPinned',
    'batchUpdateTasks', 'findOrCreateUiTask', 'getAllDescendantIds',
    'prepareCrossProjectMove', 'getDroppedTaskIds', 'isTaskDrag', 'bindProjectTabDropTarget', 'unbindProjectTabDropTarget',
    'handleDrop', 'buildCustomGroupDropUpdates', 'buildStatusDropUpdates',
    'addDropZoneEvents', 'addCustomGroupDropZoneEvents', 'addStatusSubGroupDropEvents', 'addTaskDragEvents',
    'dispatchReminderUpdate',
]);
const persistence = extract('src/utils/icsSubscription.ts', null, ['getAllReminders', 'saveReminders']);
const code = ts.transpileModule(`${persistence}\nclass Board { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

test('看板通知阶段只排队，不在防抖前重复读取，仍忽略自身和无关项目更新', async () => {
    const handlers = new Map();
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', ['initializeAsync'])} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const Board = new Function('window', 'document', compiled + '; return Board;')(
        { addEventListener: (name, handler) => handlers.set(name, handler) }, { addEventListener: () => {} },
    );
    let preloads = 0, queued = 0;
    const board = Object.assign(new Board(), {
        kanbanInstanceId: 'self', categoryManager: { initialize: async () => {} },
        loadProject: async () => {}, loadKanbanMode: async () => {}, loadKanbanSortConfig: async () => {},
        initUI: () => {}, loadTasks: async () => {}, checkVip: () => {},
        isProjectInCurrentView: id => id === 'A', reminderData: { old: {} },
        getReminders: async () => { preloads++; }, queueLoadTasks: () => { queued++; return Promise.resolve(); },
    });
    await board.initializeAsync();
    const notify = detail => handlers.get('reminderUpdated')({ detail });
    notify({ source: 'self' }); notify({ projectId: 'B' });
    assert.equal(queued, 0);
    notify({ oldProjectId: 'B', newProjectId: 'A' }); notify({});
    assert.equal(preloads, 0);
    assert.equal(queued, 2);
    assert.equal(board.reminderData, null);
});

function task(id, projectId, kanbanStatus = 'doing') {
    return { id, title: id, projectId, kanbanStatus, completed: false };
}

function fixture(initial) {
    const state = { data: clone(initial), writes: 0, reads: [], dialog: null, events: [] };
    class QuickReminderDialog {
        constructor(_date, _time, callback) { state.dialog = { callback }; }
        show() {}
    }
    const Board = new Function('loadSubscriptions', 'QuickReminderDialog', 'i18n', 'showMessage',
        'getLogicalDateString', 'Constants', 'window', 'CustomEvent', code + ';return Board;')(
        async () => ({ subscriptions: {} }), QuickReminderDialog, key => key, () => {}, () => '2026-10-31',
        { SIYUAN_DROP_GUTTER: 'siyuan-gutter', SIYUAN_DROP_FILE: 'siyuan-file', SIYUAN_DROP_TAB: 'siyuan-tab' },
        { dispatchEvent: event => state.events.push(event) },
        class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    );
    const plugin = {
        async loadReminderData(force) {
            state.reads.push(force);
            return state.data;
        },
        async saveReminderData(data) {
            state.data = clone(data);
            state.writes++;
        },
    };
    function board(projectId, visibleProjects = [projectId]) {
        return Object.assign(new Board(), {
            plugin, projectId, kanbanInstanceId: `board-${projectId}`, tasks: [], reminderData: null, canCreateTask: true,
            projectManager: { async getProjectKanbanStatuses() {
                return ['doing', 'todo', 'waiting', 'completed'].map(id => ({ id }));
            } },
            isAggregateView: visibleProjects.length > 1,
            isTaskInCurrentView: item => visibleProjects.includes(item.projectId),
            toViewTask: item => ({ ...item }),
            getTaskStatus: item => item.completed ? 'completed' : item.kanbanStatus || 'doing',
            getTaskRealProjectId: item => item.projectId,
            resolveAggregateGroupTarget: () => null,
            getFallbackStatusForGroupDrop: async () => null,
            clearDropZoneHighlights() {}, clearAllIndicators() {}, updateIndicator() {},
            calculateAdjacentInsertSort: (_task, before) => before ? 90 : 110,
            getTaskSortValue: item => item.sort || 0,
            sortTasks() {}, renderKanban() {},
            async queueLoadTasks() {}, async refreshRecurringMobileNotifications() {},
        });
    }
    return { state, board };
}

test('旧看板后续保存保留另一个项目新增的 Waiting/TODO 任务及跨项目移动结果', async () => {
    const { state, board } = fixture({ source: task('source', 'A'), moved: task('moved', 'A') });
    const sourceBoard = board('A');
    await sourceBoard.getReminders();

    // 模拟另一个看板已成功保存；源看板尚未处理广播刷新。
    state.data = {
        source: task('source', 'A'), moved: task('moved', 'B', 'waiting'),
        todo: task('todo', 'B', 'todo'), waiting: task('waiting', 'B', 'waiting'),
    };
    const expected = clone(state.data);
    await sourceBoard.setReminderPinned(expected.source, true);

    assert.equal(state.writes, 1);
    assert.deepEqual(state.data, { ...expected, source: { ...expected.source, pinned: true } });
});

test('旧目标看板保存不会丢掉刚移入的任务，也不会复活已删除任务', async () => {
    const { state, board } = fixture({ target: task('target', 'B', 'waiting'), removed: task('removed', 'B') });
    const targetBoard = board('B');
    await targetBoard.getReminders();
    state.data = { target: state.data.target, moved: task('moved', 'B') };

    await targetBoard.setReminderPinned(state.data.target, true);

    assert.ok(state.data.moved);
    assert.equal(state.data.removed, undefined);
    assert.equal(state.data.target.pinned, true);
});

test('实际跨项目批量移动后进入 Waiting，继续操作两个看板均保留全部任务', async () => {
    const { state, board } = fixture({
        moved: task('moved', 'A'), source: task('source', 'A'), todo: task('todo', 'B', 'todo'),
    });
    const sourceBoard = board('A'), targetBoard = board('B');
    await sourceBoard.getReminders();
    await targetBoard.getReminders();
    await sourceBoard.batchUpdateTasks(['moved'], { projectId: 'B' });
    assert.equal(state.data.moved.projectId, 'B');

    await targetBoard.batchUpdateTasks(['moved'], { kanbanStatus: 'waiting' });
    assert.equal(state.data.moved.kanbanStatus, 'waiting');
    await sourceBoard.setReminderPinned(state.data.source, true);

    assert.deepEqual(Object.keys(state.data).sort(), ['moved', 'source', 'todo']);
    assert.deepEqual(state.data.moved, task('moved', 'B', 'waiting'));
    assert.deepEqual(state.data.todo, task('todo', 'B', 'todo'));
    assert.equal(state.writes, 3);
});

for (const method of ['editTask', 'showTaskNotePreview']) {
    for (const aggregate of [false, true]) {
        test(`${method}：${aggregate ? '聚合' : '普通'}看板转出任务只移除卡片，全量数据保留目标项目任务`, async () => {
            const { state, board } = fixture({ moved: task('moved', 'A'), other: task('other', 'B', 'waiting') });
            const sourceBoard = board('A', aggregate ? ['A', 'C'] : ['A']);
            await sourceBoard.getReminders();
            sourceBoard.tasks = [clone(state.data.moved)];
            await sourceBoard[method](sourceBoard.tasks[0]);

            const saved = task('moved', 'B', 'waiting');
            state.data = { ...state.data, moved: saved };
            await state.dialog.callback(saved);

            assert.equal(sourceBoard.tasks.length, 0);
            assert.deepEqual(sourceBoard.reminderData.moved, saved);
            assert.deepEqual(sourceBoard.reminderData.other, state.data.other);
            assert.equal(state.writes, 0);
        });
    }
}

test('每次取全量数据使用插件最新缓存，并保留显式强制读取选项', async () => {
    const { state, board } = fixture({ first: task('first', 'A') });
    const view = board('A');
    await view.getReminders();
    state.data = { second: task('second', 'B') };
    assert.deepEqual(await view.getReminders(), state.data);
    await view.getReminders(true);
    assert.deepEqual(state.reads, [false, false, true]);
});

function element(groupId) {
    const listeners = new Map();
    const classes = new Set();
    const el = {
        dataset: groupId ? { groupId } : {}, style: {}, outerHTML: '<div></div>',
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
        contains: node => node === el,
        closest: () => groupId ? el : null,
        getBoundingClientRect: () => ({ top: 0, height: 100 }),
        addEventListener(type, handler, options) {
            const handlers = listeners.get(type) || new Set();
            handlers.add(handler);
            listeners.set(type, handlers);
            options?.signal?.addEventListener('abort', () => handlers.delete(handler));
        },
        async fire(type, event) {
            for (const handler of listeners.get(type) || []) {
                await handler(event);
                if (event.immediateStopped) break;
            }
        },
    };
    return el;
}

function dragEvent(ids, type = 'application/vnd.siyuan.kanban-task-move') {
    const values = new Map(ids ? [[type, JSON.stringify(ids)]] : []);
    return {
        clientY: 10, relatedTarget: null,
        dataTransfer: {
            get types() { return [...values.keys()]; },
            getData: key => values.get(key) || '',
            setData: (key, value) => values.set(key, value),
        },
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.immediateStopped = true; },
    };
}

test('拖到另一项目页签标题移动任务，并保留目标项目原有任务', async () => {
    const { state, board } = fixture({ source: task('source', 'A'), target: task('target', 'B', 'waiting') });
    const header = element(), targetBoard = board('B');
    targetBoard.bindProjectTabDropTarget(header);
    const event = dragEvent(['source']);
    await header.fire('dragover', event);
    assert.equal(event.prevented, true);
    assert.equal(header.classList.contains('kanban-project-tab-drop-active'), true);
    await header.fire('drop', event);
    assert.equal(state.data.source.projectId, 'B');
    assert.deepEqual(state.data.target, task('target', 'B', 'waiting'));
    assert.equal(state.writes, 1);
    assert.equal(header.classList.contains('kanban-project-tab-drop-active'), false);
    assert.equal(state.events.at(-1).detail.projectId, undefined, '移动广播同时触发源看板刷新');
    assert.equal(state.events.at(-1).detail.source, 'board-B');
});

test('页签批量移动保持父子关系，移动单个子任务则脱离源项目父任务', async () => {
    for (const ids of [['child', 'parent'], ['child']]) {
        const { state, board } = fixture({
            parent: task('parent', 'A'), child: { ...task('child', 'A'), parentId: 'parent' },
            grandchild: { ...task('grandchild', 'A'), parentId: 'child' },
        });
        const targetBoard = board('B'), header = element();
        targetBoard.bindProjectTabDropTarget(header);
        await header.fire('drop', dragEvent(ids));
        assert.equal(state.data.child.projectId, 'B');
        assert.equal(state.data.grandchild.projectId, 'B');
        assert.equal(state.data.grandchild.parentId, 'child');
        assert.equal(state.data.child.parentId, ids.includes('parent') ? 'parent' : undefined);
        assert.equal(state.data.parent.projectId, ids.includes('parent') ? 'B' : 'A');
    }
});

test('跨项目清理项目专属字段，自定义状态不兼容时回退，已完成子任务保留完成状态', async () => {
    const { state, board } = fixture({
        parent: { ...task('parent', 'A', 'source-only'), customGroupId: 'old-group', milestoneId: 'old-milestone', tagIds: ['old-tag'] },
        child: { ...task('child', 'A', 'completed'), completed: true, parentId: 'parent', customGroupId: 'old-group' },
    });
    await board('B').batchUpdateTasks(['parent'], { projectId: 'B' });
    assert.equal(state.data.parent.kanbanStatus, 'doing');
    assert.equal(state.data.parent.customGroupId, undefined);
    assert.equal(state.data.parent.milestoneId, undefined);
    assert.equal(state.data.parent.tagIds, undefined);
    assert.equal(state.data.child.customGroupId, undefined);
    assert.equal(state.data.child.completed, true);
    assert.equal(state.data.child.kanbanStatus, 'completed');
    assert.equal(state.data.child.parentId, 'parent');
});

test('同项目拖到页签标题不改变任务配置、不写入数据', async () => {
    const initial = { source: { ...task('source', 'B'), customGroupId: 'group', tagIds: ['tag'], milestoneId: 'milestone' } };
    const { state, board } = fixture(initial);
    const header = element();
    board('B').bindProjectTabDropTarget(header);
    await header.fire('drop', dragEvent(['source']));
    assert.deepEqual(state.data, initial);
    assert.equal(state.writes, 0);
});

test('页签关闭后移除拖放监听，聚合项目页签不接收直接移动', async () => {
    const { state, board } = fixture({ source: task('source', 'A') });
    const targetBoard = board('B'), header = element();
    targetBoard.bindProjectTabDropTarget(header);
    targetBoard.unbindProjectTabDropTarget();
    await header.fire('drop', dragEvent(['source']));
    board('B', ['B', 'C']).bindProjectTabDropTarget(header);
    await header.fire('drop', dragEvent(['source']));
    assert.equal(state.writes, 0);
});

for (const target of ['status', 'group', 'subgroup']) {
    test(`跨看板拖到 ${target} 区域：单个及批量任务写入目标项目、状态或分组`, async () => {
        for (const multi of [false, true]) {
            const { state, board } = fixture({ source: task('source', 'A'), other: task('other', 'A') });
            const targetBoard = board('B'), zone = element(target === 'subgroup' ? 'group-B' : undefined);
            if (target === 'status') targetBoard.addDropZoneEvents(zone, 'waiting');
            if (target === 'group') targetBoard.addCustomGroupDropZoneEvents(zone, 'group-B');
            if (target === 'subgroup') targetBoard.addStatusSubGroupDropEvents(zone, 'waiting');
            const ids = multi ? ['source', 'other'] : ['source'];
            const event = dragEvent(ids, multi ? 'application/vnd.siyuan.kanban-tasks' : 'application/x-reminder');
            if (!multi) event.dataTransfer.setData('application/x-reminder', JSON.stringify({ id: 'source' }));
            await zone.fire('dragover', event);
            assert.equal(event.prevented, true);
            await zone.fire('drop', event);
            for (const id of ids) {
                assert.equal(state.data[id].projectId, 'B');
                assert.equal(state.data[id].kanbanStatus, target === 'group' ? 'doing' : 'waiting');
                assert.equal(state.data[id].customGroupId, target === 'status' ? undefined : 'group-B');
            }
        }
    });
}

test('真实任务拖拽事件携带 ID，跨看板落到任务卡片后移动并排到目标前', async () => {
    const { state, board } = fixture({ source: task('source', 'A'), target: { ...task('target', 'B', 'waiting'), sort: 100 } });
    const sourceBoard = board('A'), targetBoard = board('B');
    const sourceEl = element(), targetEl = element(), event = dragEvent();
    sourceBoard.addTaskDragEvents(sourceEl, state.data.source);
    await sourceEl.fire('dragstart', event);
    assert.equal(event.stopped, true);
    assert.deepEqual(JSON.parse(event.dataTransfer.getData('application/vnd.siyuan.kanban-task-move')), ['source']);
    targetBoard.addTaskDragEvents(targetEl, state.data.target);
    await targetEl.fire('drop', event);
    assert.equal(state.data.source.projectId, 'B');
    assert.equal(state.data.source.kanbanStatus, 'waiting');
    assert.equal(state.data.source.sort, 90);
    assert.equal(event.immediateStopped, true);
    assert.equal(state.writes, 1);
});

test('跨看板批量落到任务卡片时保持顺序，避免同卡片内部监听器重复保存', async () => {
    const { state, board } = fixture({ first: task('first', 'A'), second: task('second', 'A'), target: { ...task('target', 'B'), sort: 100 } });
    const targetBoard = board('B'), targetEl = element();
    targetBoard.addTaskDragEvents(targetEl, state.data.target);
    targetEl.addEventListener('drop', () => assert.fail('内部批量排序监听器不应再接收外部任务'));
    await targetEl.fire('drop', dragEvent(['first', 'second'], 'application/vnd.siyuan.kanban-tasks'));
    assert.equal(state.data.first.projectId, 'B');
    assert.equal(state.data.second.projectId, 'B');
    assert.ok(state.data.first.sort < state.data.second.sort);
    assert.ok(state.data.second.sort < state.data.target.sort);
    assert.equal(state.writes, 1);
});

test('忽略页签上的文档拖拽和无效任务列表', async () => {
    const { state, board } = fixture({ source: task('source', 'A') });
    const targetBoard = board('B'), header = element();
    targetBoard.bindProjectTabDropTarget(header);
    await header.fire('drop', dragEvent(['source'], 'siyuan-file'));
    const invalid = dragEvent([]);
    invalid.dataTransfer.setData('application/vnd.siyuan.kanban-task-move', '{invalid');
    await header.fire('drop', invalid);
    assert.equal(state.writes, 0);
});
