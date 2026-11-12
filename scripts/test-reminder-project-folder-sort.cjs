// Run with: pnpm exec node --test scripts/test-reminder-project-folder-sort.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = text => ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
function load(relative) {
    const exports = {};
    new Function('exports', compile(fs.readFileSync(path.join(root, relative), 'utf8')))(exports);
    return exports;
}
const { buildProjectFolderOrderMap } = load('src/utils/projectFolderOrder.ts');
const { ProjectFolderManager } = load('src/components/dataManager/projectFolderManager.ts');
const { orderRemindersByGroup } = load('src/utils/reminderGrouping.ts');
function extract(relative, className, names) {
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    const members = className ? source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className).members : source.statements;
    return members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source).replace(/^export /, '')).join('\n');
}
const projectSort = extract('src/components/panel/ProjectPanel.ts', null, [
    'normalizeProjectPanelSortCriteria', 'buildProjectCategoryOrderMap', 'buildProjectStatusOrderMap',
    'getProjectPrimaryCategoryOrder', 'compareProjectBySetTime', 'compareProjectByCreatedAt',
    'compareProjectByPriorityWithManualSort', 'compareProjectByEndTime', 'compareProjectByCriterion', 'compareProjectsByPanelSort',
]);
const methods = extract('src/components/panel/ReminderPanel.ts', 'ReminderPanel', [
    'refreshProjectSortMetaCache', 'getProjectSortMeta', 'compareByProject', 'getReminderGroup', 'projectUpdatedHandler',
]);
const Panel = new Function('ProjectFolderManager', 'buildProjectFolderOrderMap', 'getLocaleTag', 'i18n', compile(`
    const PROJECT_PANEL_SORT_METHODS = new Set(['category', 'priority', 'time', 'startDate', 'endDate', 'created', 'title']);
    ${projectSort}
    class Panel { ${methods} }
`) + ';return Panel;')(ProjectFolderManager, buildProjectFolderOrderMap, () => 'zh-CN', key => key);

function fixture(folders = []) {
    const projects = {
        root: { title: '无文件夹项目', priority: 'high', sort: -100 },
        parent: { title: '工作直属项目', folderId: 'work', priority: 'high', sort: -90 },
        roi: { title: 'ROI成像软件', folderId: 'research', priority: 'high', sort: 0 },
        calcium: { title: '袁鹏组钙成像数据分析软件', folderId: 'research', priority: 'high', sort: 10 },
        archived: { title: '科研归档项目', folderId: 'research', priority: 'high', status: 'archived' },
        papers: { title: '文献', folderId: 'growth', priority: 'low', sort: 0 },
        hobby: { title: '博客', folderId: 'hobby', priority: 'high', sort: -80 },
        deleted: { title: '已删除文件夹的项目', folderId: 'deleted', priority: 'low' },
    };
    const plugin = {
        loadProjectData: async () => projects,
        loadSettings: async () => ({ projectPanelSortCriteria: [{ method: 'priority', order: 'desc' }] }),
        loadProjectStatus: async () => [{ id: 'active' }, { id: 'archived' }],
        loadData: async filename => {
            assert.equal(filename, 'project_folders.json');
            return folders;
        },
    };
    ProjectFolderManager.instance = undefined;
    const panel = Object.assign(new Panel(), {
        plugin, categoryManager: { getCategories: () => [] }, projectSortMetaCache: new Map(), reminderGroupMode: 'project',
    });
    const tasks = Object.keys(projects).map(id => ({ id, projectId: id }));
    return { panel, folders, tasks, projects };
}
const folders = () => [
    { id: 'hobby', name: '兴趣爱好', sort: 20 },
    { id: 'research', name: '科研项目', parentId: 'work', sort: 0 },
    { id: 'growth', name: '专业精进', sort: 10 },
    { id: 'work', name: '工作', sort: 0 },
];
const sortedIds = (panel, tasks, order = 'asc') => [...tasks].sort((a, b) => panel.compareByProject(a, b, order)).map(task => task.id);

test('项目排序与项目分组均优先遵循嵌套文件夹顺序，文件夹内保留状态和项目排序', async () => {
    const { panel, tasks } = fixture(folders());
    await panel.refreshProjectSortMetaCache();
    const expected = ['roi', 'calcium', 'archived', 'parent', 'papers', 'hobby', 'root', 'deleted'];
    assert.deepEqual(sortedIds(panel, tasks), expected);
    assert.deepEqual(orderRemindersByGroup(tasks, task => panel.getReminderGroup(task, '2026-11-12')).map(task => task.id), expected);
    assert.equal(panel.getReminderGroup({ projectId: 'roi' }, '').title, 'ROI成像软件');
});

test('降序只反转同文件夹同状态内的项目顺序，文件夹和状态顺序不反转', async () => {
    const { panel, tasks } = fixture(folders());
    await panel.refreshProjectSortMetaCache();
    assert.deepEqual(sortedIds(panel, tasks, 'desc'), ['calcium', 'roi', 'archived', 'parent', 'papers', 'hobby', 'deleted', 'root']);
});

test('无文件夹时保留原有项目排序，未知项目与无项目仍排在最后', async () => {
    const { panel, tasks } = fixture();
    await panel.refreshProjectSortMetaCache();
    assert.deepEqual(sortedIds(panel, [...tasks, { id: 'none' }, { id: 'unknown', projectId: 'unknown' }]),
        ['root', 'parent', 'hobby', 'roi', 'calcium', 'deleted', 'papers', 'archived', 'unknown', 'none']);
});

test('修改文件夹顺序或项目所属文件夹后重新加载顺序', async () => {
    const { panel, tasks, projects, folders: data } = fixture(folders());
    await panel.refreshProjectSortMetaCache();
    data.find(folder => folder.id === 'growth').sort = -10;
    projects.roi.folderId = 'hobby';
    await panel.refreshProjectSortMetaCache();
    assert.deepEqual(sortedIds(panel, tasks), ['papers', 'calcium', 'archived', 'parent', 'hobby', 'roi', 'root', 'deleted']);
});

test('文件夹顺序支持名称兜底、多级子文件夹及损坏的父级数据', () => {
    const data = [
        { id: 'b', name: 'B', sort: 0 }, { id: 'a', name: 'A', sort: 0 },
        { id: 'child', name: 'child', parentId: 'a', sort: 0 },
        { id: 'deep', name: 'deep', parentId: 'child', sort: 0 },
        { id: 'orphan', name: 'Z', parentId: 'missing', sort: 10 },
        { id: 'cycle', name: 'cycle', parentId: 'cycle', sort: 0 },
    ];
    assert.deepEqual([...buildProjectFolderOrderMap(data, 'en').keys()], ['deep', 'child', 'a', 'b', 'orphan', 'cycle']);
});

test('项目更新只在按项目排序或分组时刷新任务', () => {
    const { panel } = fixture();
    let loads = 0;
    panel.loadReminders = () => { loads++; };
    panel.getActiveSortCriteria = () => [{ method: 'time', order: 'asc' }];
    panel.projectUpdatedHandler();
    panel.reminderGroupMode = 'none';
    panel.projectUpdatedHandler();
    panel.getActiveSortCriteria = () => [{ method: 'project', order: 'asc' }];
    panel.projectUpdatedHandler();
    assert.equal(loads, 2);
});
