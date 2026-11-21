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
    'setupEventListeners', 'updateSortButtonTitle', 'showSortMenu', 'getProjectOrder', 'compareTasks', 'renderMatrix', 'renderTaskTree']);
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'EisenhowerMatrixView')
    .members.filter(node => names.has(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
const defaults = source.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations[0].name.getText(source) === 'DEFAULT_MATRIX_SORT').getText(source);
const makeMatrix = new Function('document', 'window', 'SortMenuDialog', 'AVAILABLE_SORT_METHODS', 'i18n', 'getSortConfigSummary',
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

async function fixture(settings = {}) {
    const first = { id: 'later', priority: 'high', projectId: 'a', projectName: 'A', endDate: '2026-11-30', sort: 0 };
    const second = { id: 'sooner', priority: 'high', projectId: 'b', projectName: 'B', endDate: '2026-11-24', sort: 10 };
    const child = { id: 'child', parentId: 'later', priority: 'high', projectId: 'a', endDate: '2026-11-22' };
    const filteredTasks = [first, second, child];
    const sortButton = new Element();
    const content = new Element();
    let dialogOptions;
    class SortDialog {
        constructor(options) { dialogOptions = options; }
        show() {}
    }
    const Matrix = makeMatrix({ createElement: () => new Element() }, new EventTarget(), SortDialog,
        ['priority', 'endDate', 'project', 'category', 'completed'].map(key => ({ key })), key => key,
        ({ criteria }) => criteria.map(c => c.method).join(', '), ...Object.values(taskSort));
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
        });
        await view.loadSortSettings();
        view.renderMatrix();
        return view;
    };
    const view = await open();
    view.setupEventListeners();
    sortButton.dispatchEvent(new Event('click'));
    return { view, content, menu: dialogOptions, open, getSettings: () => settings };
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
