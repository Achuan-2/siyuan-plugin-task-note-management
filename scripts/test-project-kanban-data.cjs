// Run with: node --test scripts/test-project-kanban-data.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');
const loadTaskActionUndo = require('./lib/task-action-undo.cjs');

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

test('撤回使用严格读取，订阅读取失败不会回退旧缓存后写入', async () => {
    const compiled = ts.transpileModule(persistence, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const getAll = new Function('loadSubscriptions', 'console', compiled + ';return getAllReminders;')(
        async () => { throw new Error('subscription read failed'); }, { error() {} },
    );
    const data = { local: { id: 'local' } };
    const plugin = { loadReminderData: async () => data };
    assert.deepEqual(await getAll(plugin), data);
    await assert.rejects(getAll(plugin, undefined, true, undefined, { strict: true }), /subscription read failed/);
});

function statusLayoutFixture(project = {}) {
    function node() {
        const el = element();
        el.children = [];
        el.appendChild = child => { el.children.push(child); return child; };
        el.replaceChildren = () => { el.children = []; };
        el.setAttribute = () => {};
        el.classList.toggle = (name, enabled) => enabled ? el.classList.add(name) : el.classList.remove(name);
        Object.defineProperty(el, 'innerHTML', { set() { el.children = []; } });
        return el;
    }
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
        'getCustomGroupStatusDisplayMode', 'saveCustomGroupStatusDisplayMode', 'getActiveCustomGroupStatus',
        'renderCustomGroupColumnWithStatuses', 'renderCustomGroupStatusTabs', 'syncCustomGroupStatusDisplaySelect',
    ])} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const Board = new Function('document', 'i18n', compiled + ';return Board;')({ createElement: node }, key => key);
    const content = node(), count = node();
    const column = { querySelector: selector => selector === '.kanban-column-content' ? content : selector === '.kanban-column-count' ? count : null };
    const dropTargets = [];
    const board = Object.assign(new Board(), {
        project, projectId: 'A', kanbanMode: 'custom', statusTabsMode: false,
        customGroupTabsMode: project.customGroupTabsMode ?? true,
        displayCustomGroupStatusModeSelect: node(),
        activeGroupStatusTabIds: new Map(), hideEmptyStatusBars: false,
        container: { querySelector: () => column }, lifecycle: { frame: callback => callback() },
        getVisibleStatusesForGroup: () => ['doing', 'waiting', 'completed'].map(id => ({ id, name: id })),
        augmentTasksWithDescendants: tasks => tasks,
        createStatusGroupInCustomColumn: (group, tasks, status, _name, tabbed) => ({ group, tasks, status, tabbed }),
        addStatusSubGroupDropEvents: (button, status) => dropTargets.push({ button, status }),
        syncDisplaySettingsCheckboxes() {},
    });
    return { board, content, count, dropTargets };
}

test('外层分组看板只提供页签和列表，已有内层看板回退列表，恢复分组页签后可继续使用看板', () => {
    const { board, content } = statusLayoutFixture({ customGroupStatusDisplayMode: 'kanban', customGroupTabsMode: false });
    const select = board.displayCustomGroupStatusModeSelect;
    board.syncCustomGroupStatusDisplaySelect();
    assert.deepEqual(select.children.map(option => option.value), ['tabs', 'list']);
    assert.equal(select.value, 'list');
    board.renderCustomGroupColumnWithStatuses({ id: 'group' }, {});
    assert.equal(content.classList.contains('custom-group-column-content--status-board'), false);
    assert.equal(board.project.customGroupStatusDisplayMode, 'kanban');

    board.customGroupTabsMode = true;
    board.syncCustomGroupStatusDisplaySelect();
    assert.deepEqual(select.children.map(option => option.value), ['kanban', 'tabs', 'list']);
    assert.equal(select.value, 'kanban');
    board.renderCustomGroupColumnWithStatuses({ id: 'group' }, {});
    assert.equal(content.classList.contains('custom-group-column-content--status-board'), true);

    board.customGroupTabsMode = false;
    for (const mode of ['tabs', 'list']) {
        board.project.customGroupStatusDisplayMode = mode;
        board.syncCustomGroupStatusDisplaySelect();
        assert.deepEqual(select.children.map(option => option.value), ['tabs', 'list']);
        assert.equal(select.value, mode);
        assert.equal(board.getCustomGroupStatusDisplayMode(), mode);
    }
});

test('分组内状态布局兼容旧页签开关，显式选择优先且切换后新建任务只在页签中跟随状态', () => {
    const { board } = statusLayoutFixture();
    assert.equal(board.getCustomGroupStatusDisplayMode(), 'list');
    board.statusTabsMode = true;
    assert.equal(board.getCustomGroupStatusDisplayMode(), 'tabs');
    board.activeGroupStatusTabIds.set('A:group', 'waiting');
    assert.equal(board.getActiveCustomGroupStatus('group'), 'waiting');
    for (const mode of ['kanban', 'list']) {
        board.project.customGroupStatusDisplayMode = mode;
        assert.equal(board.getCustomGroupStatusDisplayMode(), mode);
        assert.equal(board.getActiveCustomGroupStatus('group'), undefined);
    }
    board.project.customGroupStatusDisplayMode = 'unknown';
    assert.equal(board.getCustomGroupStatusDisplayMode(), 'tabs');
});

test('分组内状态布局分别保存到项目和文件夹，保留其他项目与看板设置', async () => {
    const data = { A: { statusTabsMode: true, customGroupTabsMode: true }, B: { customGroupStatusDisplayMode: 'tabs' } };
    const { board } = statusLayoutFixture(clone(data.A));
    let saved, folderSettings;
    board.plugin = { loadProjectData: async () => clone(data), saveProjectData: async value => { saved = value; } };
    await board.saveCustomGroupStatusDisplayMode('kanban');
    assert.deepEqual(saved, { ...data, A: { ...data.A, customGroupStatusDisplayMode: 'kanban' } });
    assert.equal(board.getCustomGroupStatusDisplayMode(), 'kanban');
    board.isAggregateView = true;
    board.saveFolderKanbanSetting = async value => { folderSettings = value; };
    saved = null;
    await board.saveCustomGroupStatusDisplayMode('list');
    assert.deepEqual(folderSettings, { customGroupStatusDisplayMode: 'list' });
    assert.equal(saved, null);
    assert.equal(board.getCustomGroupStatusDisplayMode(), 'list');
});

test('三种状态布局切换共用可见状态、空状态过滤及父子计数，清除旧布局并保留页签选择', async () => {
    const { board, content, count, dropTargets } = statusLayoutFixture();
    const group = { id: 'group' };
    const statuses = { doing: [{ id: 'p' }, { id: 'child', parentId: 'p' }], waiting: [{ id: 'w' }], completed: [], hidden: [{ id: 'h' }] };
    for (const mode of ['kanban', 'tabs', 'list', 'kanban']) {
        board.project.customGroupStatusDisplayMode = mode;
        board.renderCustomGroupColumnWithStatuses(group, statuses);
        assert.equal(content.children.length, 1);
        assert.equal(count.textContent, '2');
        assert.equal(content.classList.contains('custom-group-column-content--status-board'), mode === 'kanban');
        const groups = content.children[0];
        if (mode === 'tabs') {
            assert.deepEqual(groups.children[0].children.map(button => button.dataset.status), ['doing', 'waiting', 'completed']);
            await groups.children[0].children[1].fire('click', {});
            assert.equal(groups.children[1].children[0].status, 'waiting');
            assert.equal(board.getActiveCustomGroupStatus(group.id), 'waiting');
            assert.deepEqual(dropTargets.map(target => target.status), ['doing', 'waiting', 'completed']);
        } else {
            assert.deepEqual(groups.children.map(child => child.status), ['doing', 'waiting', 'completed']);
        }
    }
    board.hideEmptyStatusBars = true;
    board.project.customGroupStatusDisplayMode = 'tabs';
    board.renderCustomGroupColumnWithStatuses(group, statuses);
    assert.equal(board.getActiveCustomGroupStatus(group.id), 'waiting');
    board.renderCustomGroupColumnWithStatuses(group, { doing: statuses.doing });
    assert.equal(board.getActiveCustomGroupStatus(group.id), 'doing');
    board.renderCustomGroupColumnWithStatuses(group, {});
    assert.equal(board.getActiveCustomGroupStatus(group.id), undefined);
});

test('看板通知阶段只排队，不在防抖前重复读取，仍忽略自身和无关项目更新', async () => {
    const handlers = new Map();
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', ['initializeAsync'])} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const Board = new Function('window', 'document', compiled + '; return Board;')(
        { addEventListener: (name, handler) => handlers.set(name, handler) }, { addEventListener: () => {} },
    );
    let preloads = 0, queued = 0;
    const delays = [];
    const board = Object.assign(new Board(), {
        lifecycle: { listen: (_target, name, handler) => handlers.set(name, handler) },
        kanbanInstanceId: 'self', categoryManager: { initialize: async () => {} },
        loadProject: async () => {}, loadKanbanMode: async () => {}, loadKanbanSortConfig: async () => {},
        initUI: () => {}, loadTasks: async () => {}, checkVip: () => {},
        isProjectInCurrentView: id => id === 'A', reminderData: { old: {} },
        getReminders: async () => { preloads++; }, queueLoadTasks: delay => { queued++; delays.push(delay); return Promise.resolve(); },
    });
    await board.initializeAsync();
    const notify = detail => handlers.get('reminderUpdated')({ detail });
    notify({ source: 'self' }); notify({ projectId: 'B' });
    assert.equal(queued, 0);
    notify({ oldProjectId: 'B', newProjectId: 'A' }); notify({});
    assert.equal(preloads, 0);
    assert.equal(queued, 2);
    assert.equal(board.reminderData, null);
    notify({ taskUndo: true });
    assert.deepEqual(delays, [undefined, undefined, 0]);
});

function task(id, projectId, kanbanStatus = 'doing') {
    return { id, title: id, projectId, kanbanStatus, completed: false };
}

function fixture(initial) {
    const state = { data: clone(initial), writes: 0, reads: [], dialog: null, events: [] };
    const undoModule = loadTaskActionUndo({
        i18n: key => key,
        saveReminders: (plugin, data) => plugin.saveReminderData(data),
    });
    // 本套回归关注数据读写，底部提示由 test-task-action-undo.cjs 单独验证。
    class TaskActionUndo extends undoModule.TaskActionUndo { show() {} }
    class QuickReminderDialog {
        constructor(_date, _time, callback) { state.dialog = { callback }; }
        show() {}
    }
    const Board = new Function('loadSubscriptions', 'QuickReminderDialog', 'i18n', 'showMessage',
        'getLogicalDateString', 'Constants', 'window', 'CustomEvent', 'TaskActionUndo', 'getTaskStatusUndoMessage', code + ';return Board;')(
        async () => ({ subscriptions: {} }), QuickReminderDialog, key => key, () => {}, () => '2026-10-31',
        { SIYUAN_DROP_GUTTER: 'siyuan-gutter', SIYUAN_DROP_FILE: 'siyuan-file', SIYUAN_DROP_TAB: 'siyuan-tab' },
        { dispatchEvent: event => state.events.push(event) },
        class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        TaskActionUndo, undoModule.getTaskStatusUndoMessage,
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
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
        },
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

function groupTabSortFixture(groups) {
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
        'getCustomGroupTabSortTarget', 'clearCustomGroupTabDropIndicators', 'addCustomGroupTabDragEvents', 'reorderCustomGroupTabs',
    ])} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const state = { groups: clone(groups), writes: [], refreshes: 0, captures: 0, messages: [], buttons: [] };
    const Board = new Function('i18n', 'showMessage', compiled + ';return Board;')(key => key, message => state.messages.push(message));
    const board = Object.assign(new Board(), {
        projectId: 'P', activeCustomGroupTabId: 'b',
        aggregateProjectContext: new Map(), resolveAggregateGroupTarget: () => null,
        container: { querySelectorAll: () => state.buttons },
        projectManager: {
            getProjectCustomGroups: async projectId => clone(state.groups[projectId] || []),
            setProjectCustomGroups: async (projectId, value) => {
                state.writes.push({ projectId, groups: clone(value) });
                state.groups[projectId] = clone(value);
            },
        },
        captureScrollState: () => { state.captures++; },
        queueLoadTasks: async () => { state.refreshes++; },
    });
    const tab = id => {
        const button = element(id);
        button.getBoundingClientRect = () => ({ left: 100, width: 100 });
        state.buttons.push(button);
        board.addCustomGroupTabDragEvents(button, id);
        return button;
    };
    const over = (start, clientX) => Object.assign(dragEvent(), { dataTransfer: start.dataTransfer, clientX });
    return { board, state, tab, over };
}

test('拖动分组页签按左右半区插入，保存最新完整列表并保持当前选中分组', async () => {
    const { board, state, tab, over } = groupTabSortFixture({ P: [
        { id: 'c', sort: 40 }, { id: 'a', sort: 0 }, { id: 'filtered', sort: 10 },
        { id: 'archived', sort: 20, archived: true, note: 'keep' }, { id: 'b', sort: 30 },
    ] });
    const a = tab('a'), b = tab('b'), c = tab('c');
    const start = dragEvent();
    await c.fire('dragstart', start);
    assert.equal(start.dataTransfer.getData('application/vnd.siyuan.kanban-group-tab'), 'c');
    assert.equal(start.dataTransfer.getData('text/plain'), '');
    assert.equal(start.stopped, true);
    state.groups.P.push({ id: 'late', sort: 35 });
    const before = over(start, 110);
    await a.fire('dragover', before);
    assert.equal(a.classList.contains('custom-group-tab-drop-before'), true);
    assert.equal(before.immediateStopped, true);
    await a.fire('drop', over(start, 110));
    assert.deepEqual(state.groups.P.map(group => group.id), ['c', 'a', 'filtered', 'archived', 'b', 'late']);
    assert.equal(state.groups.P.find(group => group.id === 'archived').note, 'keep');
    assert.deepEqual(state.groups.P.map(group => group.sort), [0, 10, 20, 30, 40, 50]);
    assert.equal(board.activeCustomGroupTabId, 'b');
    assert.equal(state.refreshes, 1);
    assert.equal(state.captures, 1);
    assert.equal(a.classList.contains('custom-group-tab-drop-before'), false);
    await c.fire('dragend', {});

    const next = dragEvent();
    await a.fire('dragstart', next);
    await b.fire('dragover', over(next, 190));
    assert.equal(b.classList.contains('custom-group-tab-drop-after'), true);
    await b.fire('drop', over(next, 190));
    assert.deepEqual(state.groups.P.map(group => group.id), ['c', 'filtered', 'archived', 'b', 'a', 'late']);
    assert.equal(state.writes.length, 2);
});

test('分组页签排序忽略未分组、未变化和已删除分组，取消拖拽会清除插入标记', async () => {
    const { board, state, tab, over } = groupTabSortFixture({ P: [{ id: 'a', sort: 0 }, { id: 'b', sort: 10 }] });
    const a = tab('a'), b = tab('b'), ungrouped = tab('ungrouped');
    assert.equal(!!ungrouped.draggable, false);
    for (const [source, target, before] of [['a', 'b', true], ['b', 'a', false], ['a', 'a', true], ['missing', 'b', true], ['a', 'missing', true], ['a', 'ungrouped', true]]) {
        assert.equal(await board.reorderCustomGroupTabs(source, target, before), false);
    }
    const start = dragEvent();
    await a.fire('dragstart', start);
    await b.fire('dragover', over(start, 190));
    await a.fire('dragend', {});
    assert.equal(board.draggedGroupTabId, null);
    assert.equal(b.classList.contains('custom-group-tab-drop-after'), false);
    assert.equal(a.classList.contains('custom-group-tab-dragging'), false);
    await b.fire('drop', over(start, 190));
    assert.equal(state.writes.length, 0);
});

test('分组页签排序使用独立拖拽类型，不拦截任务或文档拖放', async () => {
    const { state, tab } = groupTabSortFixture({ P: [{ id: 'a' }, { id: 'b' }] });
    const a = tab('a'), b = tab('b');
    await a.fire('dragstart', dragEvent());
    let taskDrops = 0;
    b.addEventListener('drop', () => { taskDrops++; });
    for (const type of ['application/vnd.siyuan.kanban-task-move', 'application/x-reminder', 'siyuan-gutter']) {
        const event = dragEvent(['task'], type);
        await b.fire('dragover', event);
        assert.equal(event.prevented, undefined);
        await b.fire('drop', event);
        assert.equal(event.immediateStopped, undefined);
    }
    assert.equal(taskDrops, 3);
    assert.equal(state.writes.length, 0);
});

test('聚合分组页签仅在同一真实项目内排序，使用真实分组 ID 并刷新聚合上下文', async () => {
    const { board, state, tab } = groupTabSortFixture({ P: [{ id: 'a', sort: 0 }, { id: 'b', sort: 10 }], Q: [{ id: 'q', sort: 0 }] });
    board.isAggregateView = true;
    const targets = new Map([
        ['virtual-a', { projectId: 'P', customGroupId: 'a' }], ['virtual-b', { projectId: 'P', customGroupId: 'b' }],
        ['virtual-q', { projectId: 'Q', customGroupId: 'q' }], ['virtual-ungrouped', { projectId: 'P', customGroupId: null }],
    ]);
    board.resolveAggregateGroupTarget = id => targets.get(id);
    board.aggregateProjectContext.set('P', { project: {}, activeGroups: [] });
    assert.equal(!!tab('virtual-ungrouped').draggable, false);
    assert.equal(await board.reorderCustomGroupTabs('virtual-a', 'virtual-q', true), false);
    assert.equal(await board.reorderCustomGroupTabs('virtual-b', 'virtual-a', true), true);
    assert.equal(state.writes[0].projectId, 'P');
    assert.deepEqual(state.groups.P.map(group => group.id), ['b', 'a']);
    assert.deepEqual(board.aggregateProjectContext.get('P').activeGroups.map(group => group.id), ['b', 'a']);
    assert.deepEqual(state.groups.Q, [{ id: 'q', sort: 0 }]);
});

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
