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
    'getReminders', 'editTask', 'showTaskNotePreview', 'handleOptimisticNoteSaved',
    'updateTaskNoteElement', 'handleTaskNoteClick', 'setReminderPinned', 'setPriority',
    'updateTaskElementDOM', 'batchUpdateTasks', 'findOrCreateUiTask', 'getAllDescendantIds',
    'prepareCrossProjectMove', 'getDroppedTaskIds', 'isTaskDrag', 'bindProjectTabDropTarget', 'unbindProjectTabDropTarget',
    'handleDrop', 'buildCustomGroupDropUpdates', 'buildStatusDropUpdates',
    'addDropZoneEvents', 'addCustomGroupDropZoneEvents', 'addStatusSubGroupDropEvents', 'addTaskDragEvents',
    'dispatchReminderUpdate',
]);
const persistence = extract('src/utils/icsSubscription.ts', null, ['getAllReminders', 'saveReminders']);
const repeatHelpers = extract('src/components/dataManager/repeatUtils.ts', null, [
    'ensureRepeatInstances', 'parseReminderInstanceId', 'patchRepeatInstanceState',
]);
const code = ts.transpileModule(`${persistence}\n${repeatHelpers}\nclass Board { ${methods} }`, {
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
    let preloads = 0, queued = 0, projectLoads = 0;
    const delays = [];
    const board = Object.assign(new Board(), {
        lifecycle: { listen: (_target, name, handler) => handlers.set(name, handler) },
        kanbanInstanceId: 'self', categoryManager: { initialize: async () => {} },
        loadProject: async () => { projectLoads++; }, loadKanbanMode: async () => {}, loadKanbanSortConfig: async () => {},
        initUI: () => {}, loadTasks: async () => {}, checkVip: () => {},
        syncDisplaySettingsCheckboxes() {},
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
    // 标签定义更新走项目通知，相关看板加载配置并重绘任务，无关项目不刷新。
    await handlers.get('projectUpdated')({ detail: { projectId: 'B' } });
    assert.equal(projectLoads, 1);
    assert.equal(queued, 3);
    await handlers.get('projectUpdated')({ detail: { projectId: 'A' } });
    assert.equal(projectLoads, 2);
    assert.equal(queued, 4);
});

test('设置标签子菜单保留标签勾选操作，并在底部提供编辑入口；空项目也能编辑标签', () => {
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', ['buildTaskTagMenuItems'])} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const Board = new Function('i18n', compiled + ';return Board;')(key => key);
    const calls = [];
    const board = Object.assign(new Board(), {
        buildTagMenuItemHTML: (tag, selected) => `${tag.name}:${selected}`,
        toggleTaskTag: (task, id) => calls.push([task.id, id]),
        getTaskRealProjectId: task => task.projectId,
        showManageTagsDialog: projectId => calls.push(['edit', projectId]),
    });
    const menu = board.buildTaskTagMenuItems({ id: 'task', projectId: 'A', tagIds: ['one'] }, [{ id: 'one', name: 'label' }]);
    assert.equal(menu[0].label, 'label:true');
    assert.equal(menu[1].type, 'separator');
    assert.equal(menu[2].label, 'editTag');
    menu[0].click();
    menu[2].click();
    assert.deepEqual(calls, [['task', 'one'], ['edit', 'A']]);
    const emptyMenu = board.buildTaskTagMenuItems({}, []);
    assert.equal(emptyMenu.length, 1);
    assert.equal(emptyMenu[0].label, 'editTag');
});

function projectTagsFixture() {
    const state = { data: { A: { title: 'A', tags: [{ id: 'tag', name: 'old', color: '#111111' }] }, B: { title: 'B' } }, events: [], fail: false };
    const compiled = ts.transpileModule(`class Manager { ${extract('src/components/dataManager/projectManager.ts', 'ProjectManager', [
        'setProjectTags', 'getProjectById', 'saveProjects',
    ])} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const Manager = new Function('window', 'CustomEvent', 'console', compiled + ';return Manager;')(
        { dispatchEvent: event => { state.events.push({ event, persisted: clone(state.data) }); } },
        class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        { error() {} },
    );
    const manager = Object.assign(new Manager(), {
        projects: Object.entries(clone(state.data)).map(([id, project]) => ({ ...project, id })),
        plugin: {
            loadProjectData: async () => clone(state.data),
            saveProjectData: async data => {
                if (state.fail) throw new Error('write failed');
                state.data = clone(data);
            },
        },
    });
    return { state, manager };
}

test('编辑项目标签名称和颜色后，保存成功才通知对应项目看板刷新，并同步管理器缓存', async () => {
    const { state, manager } = projectTagsFixture();
    const tags = [{ id: 'tag', name: 'new name', color: '#ff0000' }];
    await manager.setProjectTags('A', tags);
    assert.deepEqual(state.events.map(({ event }) => [event.type, event.detail]), [['projectUpdated', { projectId: 'A' }]]);
    assert.deepEqual(state.events[0].persisted.A.tags, tags);
    assert.deepEqual(manager.getProjectById('A').tags, tags);
    assert.deepEqual(state.data.B, { title: 'B' });
    await manager.saveProjects();
    assert.deepEqual(state.data.A.tags, tags);
    await manager.setProjectTags('A', []);
    assert.deepEqual(state.events.at(-1).event.detail, { projectId: 'A' });
    assert.deepEqual(state.data.A.tags, []);
});

test('标签保存失败或项目不存在时不发送成功通知，也不覆盖项目缓存', async () => {
    const { state, manager } = projectTagsFixture();
    const original = clone(manager.getProjectById('A').tags);
    state.fail = true;
    await assert.rejects(manager.setProjectTags('A', []), /write failed/);
    assert.equal(state.events.length, 0);
    assert.deepEqual(manager.getProjectById('A').tags, original);
    await manager.setProjectTags('missing', []);
    assert.equal(state.events.length, 0);
});

function task(id, projectId, kanbanStatus = 'doing') {
    return { id, title: id, projectId, kanbanStatus, completed: false };
}

function milestoneFilterFixture(initial, folder) {
    const state = { data: clone(initial), folder: folder && clone(folder), writes: 0, errors: [] };
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
        'loadProject', 'restoreMilestoneFilters', 'saveMilestoneFilters', 'applyMilestoneFilterChange', 'getSingleFilteredMilestoneId',
        'milestoneMap', 'milestoneFilterGroups', 'archivedMilestonesByStatus', 'buildMilestoneMap', 'getMilestoneFilterSections',
        'getAggregateGroupId', 'getAggregateSafeId', 'isStatusVisibleForGroup', 'getVisibleStatusesForGroup',
        'normalizeGroupVisibleStatusIds', 'hasUngroupedMilestoneFilter', 'shouldDisplayUngroupedColumn',
    ])} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const Board = new Function('ProjectFolderManager', 'i18n', 'showMessage', 'console', compiled + ';return Board;')(
        { getInstance: () => ({ getFolderById: () => state.folder }) }, key => key,
        message => assert.fail(message), { error: (...args) => state.errors.push(args) },
    );
    const cached = clone(initial);
    const plugin = {
        loadProjectData: async () => clone(state.data),
        saveProjectData: async data => { state.data = clone(data); state.writes++; },
    };
    const board = (projectId = 'A', aggregate = false) => Object.assign(new Board(), {
        plugin, projectId, projectManager: { getProjectById: id => cached[id] },
        isAggregateView: aggregate, aggregateProjectIds: ['A', 'B'],
        viewOptions: aggregate ? { folderId: 'folder' } : {},
        selectedFilterMilestones: new Map(), multiSelectMilestoneFilters: new Set(),
        milestoneFilterSaveQueue: Promise.resolve(), milestoneFiltersLoaded: false,
        getProjectCustomGroupsForView: async () => [], refreshAggregateProjectContext() {},
        queueLoadTasks: async () => {}, updateMilestoneFilterButtonsState() {},
        saveFolderKanbanSetting: async partial => {
            state.folder.kanbanSettings = { ...state.folder.kanbanSettings, ...clone(partial) };
        },
    });
    return { state, plugin, board, cached };
}

test('状态列列出没有任务的默认及分组里程碑，已归档项仍按历史任务显示', async () => {
    const f = milestoneFilterFixture({
        A: {
            milestones: [{ id: 'default' }, { id: 'history', archived: true }, { id: 'unused-history', archived: true }],
            customGroups: [
                { id: 'group', name: '分组', visibleStatusIds: ['doing'], milestones: [{ id: 'group-milestone' }] },
                { id: 'old-group', name: '已归档分组', archived: true, milestones: [{ id: 'old-group-milestone' }] },
            ],
        },
    });
    const board = f.board();
    board.kanbanMode = 'status';
    board.kanbanStatuses = [{ id: 'doing' }, { id: 'completed' }];
    await board.buildMilestoneMap();
    const optionsFor = status => board.getMilestoneFilterSections(status).flatMap(section => section.milestones.map(m => m.id));
    assert.deepEqual(optionsFor('doing'), ['default', 'group-milestone']);
    assert.deepEqual(optionsFor('completed'), ['default']);
    board.archivedMilestonesByStatus.set('completed', new Set(['history']));
    assert.deepEqual(optionsFor('completed'), ['default', 'history']);
});

test('聚合看板的分组和任务列表显示各自配置的空里程碑', async () => {
    const f = milestoneFilterFixture({
        A: { milestones: [{ id: 'default-A' }], customGroups: [{ id: 'group', name: '分组' }] },
        B: { milestones: [{ id: 'default-B' }, { id: 'archived-B', archived: true }] },
    });
    const board = f.board('folder', true);
    await board.buildMilestoneMap();
    for (const mode of ['custom', 'list']) {
        board.kanbanMode = mode;
        const optionsFor = groupId => board.getMilestoneFilterSections(groupId).flatMap(section => section.milestones.map(m => m.id));
        assert.deepEqual(optionsFor(board.getAggregateGroupId('A')), ['default-A']);
        assert.deepEqual(optionsFor(board.getAggregateGroupId('B')), ['default-B']);
        assert.deepEqual(optionsFor(board.getAggregateGroupId('A', 'group')), []);
    }
});

test('默认里程碑可以从空的未分组列筛选，已激活的筛选仍能从该列清除', async () => {
    const board = milestoneFilterFixture({ A: { milestones: [{ id: 'default' }] } }).board();
    await board.buildMilestoneMap();
    board.shouldDisplayGroupBySettings = () => true;
    assert.equal(board.shouldDisplayUngroupedColumn([], '2026-11-21'), true);
    board.shouldDisplayGroupBySettings = () => false;
    assert.equal(board.shouldDisplayUngroupedColumn([], '2026-11-21'), false);
    board.selectedFilterMilestones.set('ungrouped', new Set(['default']));
    assert.equal(board.shouldDisplayUngroupedColumn([], '2026-11-21'), true);
});

test('关闭重开项目看板恢复各列和分组的里程碑选择及多选模式，新建任务仍跟随单个里程碑', async () => {
    const f = milestoneFilterFixture({ A: { title: 'A' }, B: { title: 'B' } });
    const board = f.board();
    await board.loadProject();
    assert.equal(board.selectedFilterMilestones.size, 0);
    board.selectedFilterMilestones.set('doing', new Set(['v7.2.0']));
    board.selectedFilterMilestones.set('group', new Set(['__no_milestone__', 'v7.1.0']));
    board.multiSelectMilestoneFilters.add('group');
    board.applyMilestoneFilterChange();
    board.disposed = true;
    await board.milestoneFilterSaveQueue;
    const reopened = f.board();
    await reopened.loadProject();
    assert.deepEqual([...reopened.selectedFilterMilestones.get('doing')], ['v7.2.0']);
    assert.deepEqual([...reopened.selectedFilterMilestones.get('group')], ['__no_milestone__', 'v7.1.0']);
    assert.deepEqual([...reopened.multiSelectMilestoneFilters], ['group']);
    assert.equal(reopened.getSingleFilteredMilestoneId('doing'), 'v7.2.0');
    assert.deepEqual(f.cached.A.milestoneFilterState, f.state.data.A.milestoneFilterState);
});

test('全部任务、无里程碑和多选清空选择在重开后保持各自含义', async () => {
    const f = milestoneFilterFixture({ A: { title: 'A' } });
    const board = f.board();
    await board.loadProject();
    board.selectedFilterMilestones.set('doing', new Set());
    board.multiSelectMilestoneFilters.add('doing');
    board.selectedFilterMilestones.set('waiting', new Set(['__no_milestone__']));
    await board.saveMilestoneFilters();
    const reopened = f.board();
    await reopened.loadProject();
    assert.equal(reopened.selectedFilterMilestones.get('doing').size, 0);
    assert.equal(reopened.multiSelectMilestoneFilters.has('doing'), true);
    assert.equal(reopened.getSingleFilteredMilestoneId('waiting'), undefined);
    reopened.selectedFilterMilestones.delete('waiting');
    await reopened.saveMilestoneFilters();
    const allTasks = f.board();
    await allTasks.loadProject();
    assert.equal(allTasks.selectedFilterMilestones.has('waiting'), false);
    assert.equal(allTasks.selectedFilterMilestones.has('doing'), true);
});

test('快速切换串行保存最后一次选择，并保留最新项目字段及其他项目数据', async () => {
    const f = milestoneFilterFixture({ A: { title: 'A' }, B: { title: 'B', milestoneFilterState: { selections: { doing: ['other'] }, multiSelectGroups: [] } } });
    const board = f.board();
    await board.loadProject();
    f.state.data.A.note = 'new note';
    let release, started;
    const firstStarted = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const save = f.plugin.saveProjectData;
    f.plugin.saveProjectData = async data => {
        if (!f.state.writes) { started(); await gate; }
        await save(data);
    };
    board.selectedFilterMilestones.set('doing', new Set(['old']));
    const first = board.saveMilestoneFilters();
    await firstStarted;
    board.selectedFilterMilestones.set('doing', new Set(['latest']));
    const latest = board.saveMilestoneFilters();
    release();
    await Promise.all([first, latest]);
    assert.deepEqual(f.state.data.A.milestoneFilterState.selections.doing, ['latest']);
    assert.equal(f.state.data.A.note, 'new note');
    assert.deepEqual(f.state.data.B.milestoneFilterState.selections.doing, ['other']);
    assert.equal(f.state.writes, 2);
});

test('文件夹看板独立恢复和保存筛选，不继承或覆盖首个项目的筛选', async () => {
    const initial = { A: { title: 'A', milestoneFilterState: { selections: { doing: ['project'] }, multiSelectGroups: [] } }, B: { title: 'B' } };
    const f = milestoneFilterFixture(initial, { id: 'folder', kanbanSettings: { kanbanMode: 'custom' } });
    const board = f.board('folder', true);
    await board.loadProject();
    assert.equal(board.selectedFilterMilestones.size, 0);
    board.selectedFilterMilestones.set('agg_A_group', new Set(['folder-milestone']));
    await board.saveMilestoneFilters();
    const reopened = f.board('folder', true);
    await reopened.loadProject();
    assert.deepEqual([...reopened.selectedFilterMilestones.get('agg_A_group')], ['folder-milestone']);
    assert.equal(f.state.folder.kanbanSettings.kanbanMode, 'custom');
    assert.deepEqual(f.state.data, initial);
    assert.equal(f.state.writes, 0);
});

test('保存失败后后续选择仍能持久化，配置刷新不会覆盖当前待保存的选择', async () => {
    const f = milestoneFilterFixture({ A: { title: 'A' } });
    const board = f.board();
    await board.loadProject();
    const save = f.plugin.saveProjectData;
    f.plugin.saveProjectData = async () => { throw new Error('write failed'); };
    board.selectedFilterMilestones.set('doing', new Set(['first']));
    await board.saveMilestoneFilters();
    assert.equal(f.state.errors.length, 1);
    board.selectedFilterMilestones.set('doing', new Set(['latest']));
    await board.loadProject();
    assert.deepEqual([...board.selectedFilterMilestones.get('doing')], ['latest']);
    f.plugin.saveProjectData = save;
    await board.saveMilestoneFilters();
    assert.deepEqual(f.state.data.A.milestoneFilterState.selections.doing, ['latest']);
});

function fixture(initial) {
    const state = { data: clone(initial), writes: 0, reads: [], dialog: null, events: [], preloadedNotes: [] };
    const undoModule = loadTaskActionUndo({
        i18n: key => key,
        saveReminders: (plugin, data) => plugin.saveReminderData(data),
    });
    // 本套回归关注数据读写，底部提示由 test-task-action-undo.cjs 单独验证。
    class TaskActionUndo extends undoModule.TaskActionUndo { show() {} }
    class QuickReminderDialog {
        constructor(_date, _time, callback, _slot, options) { state.dialog = { callback, options }; }
        show() {}
    }
    const TaskRenderer = {
        async preloadNoteImages(note) { state.preloadedNotes.push(note); },
        createNoteElement(item, _ctx, onNoteClick) {
            if (!item.note) return null;
            const noteEl = {
                className: 'reminder-item__note',
                classList: { contains: name => name === 'reminder-item__note' },
                childNodes: [{ textContent: item.note }],
                style: { cssText: item.note.includes('<img') ? 'max-height: none; display: block;' : 'max-height: 3em;' },
                onNoteClick,
                replaceChildren(...nodes) { this.childNodes = nodes; },
                remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
            };
            return noteEl;
        },
        getPriorityDisplayStyle() { return 'background'; },
        applyPriorityDisplayStyle() {},
    };
    const Board = new Function('loadSubscriptions', 'QuickReminderDialog', 'TaskRenderer', 'i18n', 'showMessage',
        'getLogicalDateString', 'getLocalDateString', 'Constants', 'window', 'document', 'CustomEvent', 'TaskActionUndo', 'getTaskStatusUndoMessage', code + ';return Board;')(
        async () => ({ subscriptions: {} }), QuickReminderDialog, TaskRenderer, key => key, () => {}, () => '2026-10-31', () => '2026-10-31',
        { SIYUAN_DROP_GUTTER: 'siyuan-gutter', SIYUAN_DROP_FILE: 'siyuan-file', SIYUAN_DROP_TAB: 'siyuan-tab' },
        { dispatchEvent: event => state.events.push(event) },
        { createElement: () => ({ className: '', innerHTML: '', remove() {} }) },
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

function createCardElement(id, initialClasses = ['reminder-item', 'kanban-task', 'reminder-priority-none']) {
    const classes = new Set(initialClasses);
    const attrs = new Map([['data-task-id', id], ['data-priority', 'none']]);
    const infoChildren = [
        { className: 'reminder-item__title-container', classList: { contains: name => name === 'reminder-item__title-container' } },
        { className: 'reminder-item__time-container', classList: { contains: name => name === 'reminder-item__time-container' } },
        { className: 'reminder-item__pomodoro-count', classList: { contains: name => name === 'reminder-item__pomodoro-count' } },
        { className: 'reminder-item__project-tags', classList: { contains: name => name === 'reminder-item__project-tags' } },
    ];
    const info = {
        children: infoChildren,
        insertBefore(node, ref) {
            node.parent = info;
            const index = ref ? info.children.indexOf(ref) : -1;
            if (index >= 0) info.children.splice(index, 0, node);
            else info.children.push(node);
            return node;
        },
    };
    return {
        dataset: { taskId: id },
        info,
        style: {},
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
        },
        setAttribute: (name, value) => attrs.set(name, String(value)),
        getAttribute: name => attrs.get(name),
        querySelector(selector) {
            if (selector === '.reminder-item__note') return info.children.find(c => c.className === 'reminder-item__note') || null;
            if (selector === '.reminder-item__info') return info;
            return null;
        },
    };
}

test('showTaskNotePreview：保存备注原地更新卡片 DOM，不触发整板重绘或重载，并同步重复实例状态', async () => {
    const normal = { ...task('t1', 'A'), note: '' };
    const repeatTemplate = { ...task('rep1', 'A'), repeat: { enabled: true, type: 'daily', instances: {} } };
    const repeatInstance = {
        ...task('rep1_2026-10-31', 'A'),
        isRepeatInstance: true,
        originalId: 'rep1',
        date: '2026-10-31',
        note: '旧实例备注',
    };
    const { state, board } = fixture({ t1: normal, rep1: repeatTemplate });
    const kanban = board('A');
    let renders = 0, reloads = 0;
    kanban.renderKanban = async () => { renders++; };
    kanban.queueLoadTasks = async () => { reloads++; };
    kanban.getRepeatInstanceOriginalDate = item => item.date;
    await kanban.getReminders();

    const card1 = createCardElement('t1');
    const cardRep = createCardElement('rep1_2026-10-31');
    kanban.container = {
        querySelectorAll: selector => {
            if (selector === '[data-task-id="t1"]') return [card1];
            if (selector === '[data-task-id="rep1_2026-10-31"]') return [cardRep];
            return [];
        },
        querySelector: selector => {
            if (selector === '[data-task-id="t1"]' || selector === '.kanban-task[data-task-id="t1"]') return card1;
            if (selector === '[data-task-id="rep1_2026-10-31"]') return cardRep;
            return null;
        },
    };
    kanban.tasks = [normal, repeatInstance];

    // 1. 新增备注：插在番茄钟与标签之间，且不触发整板重绘
    await kanban.showTaskNotePreview(normal);
    await state.dialog.callback({ ...normal, note: '新增备注' });
    assert.equal(renders, 0);
    assert.equal(reloads, 0);
    assert.equal(normal.note, '新增备注');
    assert.equal(kanban.reminderData.t1.note, '新增备注');
    assert.deepEqual(state.preloadedNotes, ['新增备注']);
    assert.equal(card1.info.children[3].className, 'reminder-item__note');
    assert.equal(card1.info.children[4].className, 'reminder-item__project-tags');

    // 2. 修改已有备注：复用原 DOM 节点仅更新内容和样式
    const existingNoteEl = card1.querySelector('.reminder-item__note');
    await state.dialog.callback({ ...normal, note: '<img src="/data/storage/petal/siyuan-plugin-task-note-management/assets/a.png">' });
    assert.equal(card1.querySelector('.reminder-item__note'), existingNoteEl);
    assert.match(existingNoteEl.style.cssText, /max-height: none/);
    assert.equal(renders, 0);

    // 3. 清空备注：直接移除备注节点
    await state.dialog.callback({ ...normal, note: '' });
    assert.equal(card1.querySelector('.reminder-item__note'), null);
    assert.equal(normal.note, undefined);
    assert.equal(renders, 0);

    // 4. 重复实例：保留实例 id、原地更新并修补 reminderData.instances，不触发重载
    await kanban.showTaskNotePreview(repeatInstance);
    assert.equal(state.dialog.options.reminder.id, 'rep1_2026-10-31');
    await state.dialog.callback({
        ...state.dialog.options.reminder,
        note: '新实例备注',
        isRepeatInstance: true,
    });
    assert.equal(renders, 0);
    assert.equal(reloads, 0);
    assert.equal(repeatInstance.note, '新实例备注');
    assert.equal(kanban.reminderData.rep1.repeat.instances['2026-10-31'].note, '新实例备注');
    assert.equal(cardRep.querySelector('.reminder-item__note')?.childNodes[0].textContent, '新实例备注');

    // 5. 启用搜索关键字时，备注改动会触发看板重绘以刷新过滤结果
    kanban.searchKeyword = '关键词';
    await state.dialog.callback({ ...normal, note: '包含关键词' });
    assert.equal(renders, 1);
});

test('看板切换优先级同步 reminder-priority-* 类名，并共享任务侧栏备注样式', async () => {
    const item = { ...task('p1', 'A'), priority: 'none' };
    const { board } = fixture({ p1: item });
    const kanban = board('A');
    const card = createCardElement('p1');
    kanban.tasks = [item];
    kanban.container = {
        querySelector: selector => (selector.includes('p1') ? card : null),
    };
    kanban.clearCompletionMoveTimer = () => {};

    await kanban.setPriority(item, 'high');
    assert.equal(card.classList.contains('reminder-priority-high'), true);
    assert.equal(card.classList.contains('reminder-priority-none'), false);
    assert.equal(card.getAttribute('data-priority'), 'high');

    item.priority = 'low';
    kanban.updateTaskElementDOM('p1', { priority: 'low' });
    assert.equal(card.classList.contains('reminder-priority-low'), true);
    assert.equal(card.classList.contains('reminder-priority-high'), false);
    assert.equal(card.getAttribute('data-priority'), 'low');

    const indexScss = fs.readFileSync(path.join(root, 'src/index.scss'), 'utf8');
    assert.match(indexScss, /\.reminder-panel,\s*\.TN-project-kanban-view\s*\{[\s\S]*?\.reminder-item__note\s*\{/);
});

test('分组页签默认统计未完成任务数量（不含放弃），并保留显式模式配置', async () => {
    const compiled = ts.transpileModule(`class Board { ${extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
        'groupTabCountMode', 'loadProject', 'appendCustomGroupTabCount',
    ])} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const created = [];
    const doc = {
        createElement: tag => {
            const el = { tag, className: '', textContent: '' };
            created.push(el);
            return el;
        },
    };
    const Board = new Function('document', 'i18n', 'showMessage', 'ProjectFolderManager', 'console', compiled + ';return Board;')(
        doc, key => key, () => {}, { getInstance: () => ({ getFolderById: () => null }) }, { error() {} },
    );

    const createBoard = project => Object.assign(new Board(), {
        projectId: 'A',
        isAggregateView: false,
        milestoneFiltersLoaded: true,
        plugin: {
            loadSettings: async () => ({}),
            loadProjectData: async () => ({ A: project }),
        },
        getProjectCustomGroupsForView: async () => [],
        getTaskStatus: item => item.kanbanStatus || 'doing',
        isAbandonedTask: item => item.kanbanStatus === 'abandoned',
    });

    const freshBoard = createBoard({ id: 'A' });
    assert.equal(freshBoard.groupTabCountMode, 'unfinished');

    await freshBoard.loadProject();
    assert.equal(freshBoard.groupTabCountMode, 'unfinished');

    const tasks = [
        { id: 't1', kanbanStatus: 'doing', completed: false },
        { id: 't2', kanbanStatus: 'short_term', completed: false },
        { id: 't2_sub', parentId: 't2', kanbanStatus: 'doing', completed: false },
        { id: 't3', kanbanStatus: 'completed', completed: true },
        { id: 't4', kanbanStatus: 'abandoned', completed: false },
    ];
    const button = { children: [], appendChild(child) { this.children.push(child); } };
    freshBoard.appendCustomGroupTabCount(button, tasks);
    assert.equal(button.children[0].textContent, '2');

    for (const mode of ['doing', 'unfinished', 'all']) {
        const board = createBoard({ id: 'A', groupTabCountMode: mode });
        await board.loadProject();
        assert.equal(board.groupTabCountMode, mode);
    }

    const unknownBoard = createBoard({ id: 'A', groupTabCountMode: 'unknown' });
    await unknownBoard.loadProject();
    assert.equal(unknownBoard.groupTabCountMode, 'unfinished');
});
