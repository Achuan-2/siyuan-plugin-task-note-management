const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const taskSort = {};
new Function('exports', compile(read('src/utils/taskSort.ts')))(taskSort);
const source = ts.createSourceFile('EisenhowerMatrixView.ts',
    read('src/components/panel/EisenhowerMatrixView.ts'), ts.ScriptTarget.Latest, true);
const names = new Set(['taskSortCriteria', 'groupByProject', 'pendingSortSave', 'loadSortSettings', 'saveSortSettings',
    'setupEventListeners', 'updateSortButtonTitle', 'showSortMenu', 'getProjectOrder', 'compareTasks', 'renderMatrix', 'renderTaskTree',
    'compareManualTaskOrder', 'canReorderTasks', 'getTaskSortId', 'getManualSortSiblings',
    'pendingManualReorder', 'handleTaskReorder', 'reorderTasksManually']);
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'EisenhowerMatrixView')
    .members.filter(node => names.has(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
const defaults = source.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations[0].name.getText(source) === 'DEFAULT_MATRIX_SORT').getText(source);
const makeMatrix = new Function('document', 'window', 'SortMenuDialog', 'AVAILABLE_SORT_METHODS', 'i18n', 'getSortConfigSummary',
    'getAllReminders', 'saveReminders',
    ...Object.keys(taskSort), compile(`${defaults}\nclass Matrix { ${methods} }`) + ';return Matrix;');

const priority = { method: 'priority', order: 'desc' };
const criterion = (method, order = 'asc') => ({ method, order });

class Element extends EventTarget {
    children = [];
    style = {};
    classList = { add() {} };
    set innerHTML(_) { this.children = []; }
    appendChild(child) { this.children.push(child); }
    setAttribute() {}
}

async function fixture(settings = {}, tasks) {
    const first = { id: 'later', priority: 'high', projectId: 'a', projectName: 'A', endDate: '2026-11-30', sort: 0 };
    const second = { id: 'sooner', priority: 'high', projectId: 'b', projectName: 'B', endDate: '2026-11-24', sort: 10 };
    const child = { id: 'child', parentId: 'later', priority: 'high', projectId: 'a', endDate: '2026-11-22' };
    const filteredTasks = tasks || [first, second, child];
    const sortButton = new Element();
    const content = new Element();
    const sortId = task => task.originalId || task.id;
    let reminderData = Object.fromEntries(filteredTasks.map(task => [sortId(task), { ...task, id: sortId(task) }]));
    let dialogOptions;
    class SortDialog {
        constructor(options) { dialogOptions = options; }
        show() {}
    }
    const Matrix = makeMatrix({ createElement: () => new Element() }, new EventTarget(), SortDialog,
        ['priority', 'endDate', 'project', 'category', 'completed'].map(key => ({ key })), key => key,
        ({ criteria }) => criteria.map(c => c.method).join(', '), async () => structuredClone(reminderData),
        async (_plugin, data) => { reminderData = data; }, ...Object.values(taskSort));
    const plugin = {
        loadSettings: async () => settings,
        saveSettings: async value => { settings = structuredClone(value); },
    };
    const open = async () => {
        const view = Object.assign(new Matrix(), {
            plugin, isMobileClient: true, filteredTasks, quadrants: [{ key: 'important-urgent', tasks: filteredTasks }],
            container: {
                querySelector: selector => selector === '.task-sort-btn' ? sortButton
                    : selector === '[data-quadrant-content="important-urgent"]' ? content : null,
                querySelectorAll: () => [],
            },
            projectManager: { getProjectById: () => undefined },
            categoryManager: { getCategories: () => [] },
            collapsedProjects: new Map(), collapsedTasks: new Set(),
            reminderUpdatedHandler() {}, projectUpdatedHandler() {}, settingsUpdatedHandler() {},
            createTaskElement: (task, level) => Object.assign(new Element(), { id: task.id, level }),
            async refresh() {
                for (const task of filteredTasks) task.sort = reminderData[sortId(task)].sort;
                this.renderMatrix();
            },
        });
        await view.loadSortSettings();
        view.renderMatrix();
        return view;
    };
    const view = await open();
    view.setupEventListeners();
    sortButton.dispatchEvent(new Event('click'));
    return { view, content, menu: dialogOptions, open, getSettings: () => settings, getReminderData: () => reminderData };
}

test('打开四象限排序菜单后可实时组合排序，取消分组时父子任务保持嵌套', async () => {
    const f = await fixture({ projectSortOrder: ['a', 'b'], sortCriteria: [criterion('title')] });
    assert.deepEqual(f.menu.currentCriteria, [priority]);
    assert.equal(f.menu.grouping.value, 'project');
    const criteria = [priority, criterion('endDate')];
    await Promise.all([f.menu.onChange([priority]), f.menu.onChange(criteria)]);
    await f.menu.grouping.onChange('none');
    assert.deepEqual(f.content.children.map(card => [card.id, card.level]), [
        ['sooner', 0], ['later', 0], ['child', 1],
    ]);
    const reopened = await f.open();
    assert.equal(reopened.groupByProject, false);
    assert.deepEqual(reopened.taskSortCriteria, criteria);
    assert.deepEqual(f.getSettings().sortCriteria, [criterion('title')]);
});

test('保留已有项目自定义顺序，项目降序可以调整组之间的顺序', async () => {
    const f = await fixture({ projectSortOrder: ['b', 'a'], projectSortMode: 'custom' });
    const rootIds = () => f.content.children.map(group => group.children[1].children[0].id);
    assert.deepEqual(rootIds(), ['sooner', 'later']);
    await f.menu.onChange([criterion('project', 'desc')]);
    assert.deepEqual(rootIds(), ['later', 'sooner']);
});

test('单选叉号清空当前条件，实时切换手动排序并在重开后恢复', async () => {
    const f = await fixture({ eisenhowerGroupByProject: false, eisenhowerSortCriteria: [criterion('endDate')] });
    const source = ts.createSourceFile('SortMenuDialog.ts',
        read('src/components/dialog/SortMenuDialog.ts'), ts.ScriptTarget.Latest, true);
    const names = ['renderCurrentSingleItem', 'createRemoveButton', 'removeCriterion', 'notifyChange'];
    const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'SortMenuDialog')
        .members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
    const SortDialog = new Function('document', 'i18n', 'getSortCriterionName',
        compile(`class SortDialog { ${methods} }`) + ';return SortDialog;')(
        { createElement: () => new Element() }, key => key, criterion => criterion.method);
    const wrapper = new Element();
    const item = new Element();
    const dialog = Object.assign(new SortDialog(), {
        options: f.menu, selectedCriteria: [...f.menu.currentCriteria], isMultiSelect: false,
        dialog: { element: { querySelector: selector => selector.endsWith('-item') ? item : wrapper } },
        renderAvailableOptions() {}, renderSelectedList() {},
    });
    dialog.renderCurrentSingleItem();
    const remove = item.children.find(child => child.textContent === '✕');
    assert.ok(remove);
    remove.dispatchEvent(new Event('click'));
    await f.view.pendingSortSave;
    assert.equal(wrapper.style.display, '');
    assert.deepEqual(item.children.map(child => child.textContent), ['manual']);
    assert.equal(f.content.children[0].id, 'later');
    assert.deepEqual(f.getSettings().eisenhowerSortCriteria, []);
    assert.deepEqual((await f.open()).taskSortCriteria, []);
});

test('手动排序可跨优先级和项目拖动同级任务，重复实例的顺序写回原任务', async () => {
    const tasks = [
        { id: 'regular', projectId: 'a', priority: 'high', sort: 0 },
        { id: 'instance', projectId: 'b', priority: 'low', sort: 10, isRepeatInstance: true, originalId: 'repeating' },
        { id: 'child', parentId: 'regular', priority: 'high', sort: 23 },
        { id: 'pinned', priority: 'high', pinned: true, sort: 38 },
    ];
    const f = await fixture({ eisenhowerGroupByProject: false, eisenhowerSortCriteria: [] }, tasks);
    const cardIds = () => f.content.children.map(card => card.id);
    assert.equal(f.view.canReorderTasks(tasks[0], tasks[1]), true);
    assert.equal(f.view.canReorderTasks(tasks[0], tasks[2]), false);
    assert.equal(f.view.canReorderTasks(tasks[0], tasks[3]), false);
    f.view.groupByProject = true;
    assert.equal(f.view.canReorderTasks(tasks[0], tasks[1]), false);
    f.view.groupByProject = false;

    const drop = y => ({ clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) } });
    const event = drop(75);
    const write = f.view.handleTaskReorder('regular', 'instance', event);
    event.currentTarget = null;
    await write;
    assert.deepEqual(cardIds(), ['pinned', 'instance', 'regular', 'child']);
    const data = f.getReminderData();
    assert.deepEqual([data.regular.sort, data.repeating.sort, data.child.sort, data.pinned.sort], [10, 0, 23, 38]);
    assert.deepEqual([data.regular.priority, data.repeating.priority], ['high', 'low']);
    await f.view.handleTaskReorder('regular', 'instance', drop(25));
    assert.deepEqual(cardIds(), ['pinned', 'regular', 'child', 'instance']);
    await Promise.all([
        f.view.handleTaskReorder('regular', 'instance', drop(75)),
        f.view.handleTaskReorder('regular', 'instance', drop(25)),
    ]);
    assert.deepEqual(cardIds(), ['pinned', 'regular', 'child', 'instance']);
});
