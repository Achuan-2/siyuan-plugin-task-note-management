// Run with: pnpm exec node --test scripts/test-reminder-panel-grouping.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const today = '2026-11-12';
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const grouping = {};
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/utils/reminderGrouping.ts'), 'utf8')))(grouping);
const { orderRemindersByGroup, normalizeReminderGroupMode } = grouping;
const source = ts.createSourceFile('ReminderPanel.ts', fs.readFileSync(path.join(root, 'src/components/panel/ReminderPanel.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['getReminderGroup', 'getReminderDisplayGroup', 'getReminderTodayGroup', 'createTodayGroupHeader',
    'createReminderGroupHeader', 'renderRemindersIteratively', 'isSameNonPrioritySortGroup', 'handleOptimisticSavedReminder'];
const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPanel').members;
const methods = members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');

class Element {
    constructor() {
        this.dataset = {};
        this.attributes = {};
        this.events = {};
        const classes = new Set();
        this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
    }
    set innerHTML(value) {
        this.parts = new Map([...value.matchAll(/class="([^"]+)"/g)].map(match => [`.${match[1]}`, { textContent: '' }]));
    }
    querySelector(selector) { return this.parts?.get(selector) || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, callback) { this.events[name] = callback; }
}
const Panel = new Function('i18n', 'getRelativeDateString', 'getLogicalDateString', 'document', 'parseReminderInstanceId', 'renderTaskMetadataText', compile(`class Panel { ${methods} }`) + ';return Panel;')(
    key => key, () => '2026-11-13', () => today, { createElement: () => new Element() }, () => null, value => value,
);
function fixture(mode = 'date') {
    const rows = new Map();
    const panel = Object.assign(new Panel(), {
        reminderGroupMode: mode, collapsedReminderGroups: new Set(), collapsedTodayGroups: new Set(),
        currentTab: 'allUncompleted', currentRemindersCache: [],
        originalRemindersCache: {},
        projectSortMetaCache: new Map([
            ['b', { title: '项目 B', groupOrder: 0 }], ['a', { title: '项目 A', groupOrder: 1 }],
        ]),
        categoryManager: { getCategories: () => [{ id: 'b', name: '分类 B' }, { id: 'a', name: '分类 A' }] },
        shouldTreatOnlyStartDateAsDeadline: task => !task.startOnly,
        getReminderLogicalDate: (date, time) => time === '01:00' ? '2026-11-11' : date,
        isTodayLikeView: () => false, isTaskCollapsed: () => false,
        isDailyDessertTaskForDate: task => !!task.isAvailableToday,
        getActiveSortCriteria: () => [{ method: 'priority', order: 'asc' }],
        createReminderRenderIndexes(tasks) {
            return { visible: { byId: new Map(tasks.map(task => [task.id, task])), children: id => tasks.filter(task => task.parentId === id) } };
        },
        createReminderElementOptimized(task, _cache, _today, level) {
            if (!rows.has(task.id)) rows.set(task.id, new Element());
            const row = rows.get(task.id);
            row.dataset.reminderId = task.id;
            row.dataset.level = String(level);
            return row;
        },
        reconcileReminderElements(elements) { this.elements = elements; },
    });
    panel.remindersContainer = {
        querySelector: selector => (panel.elements || []).find(element => selector === `#${element.id}`) || null,
        querySelectorAll(selector) {
            const className = selector.match(/^\.([\w-]+)/)?.[1];
            const attributes = [...selector.matchAll(/\[data-([\w-]+)="([^"]*)"\]/g)];
            return [...new Set([...rows.values(), ...(panel.elements || [])])].filter(element =>
                (!className || element.classList.contains(className)) && attributes.every(([, name, value]) =>
                    element.dataset[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === value));
        },
    };
    return { panel, rows };
}
const ids = tasks => tasks.map(task => task.id);

test('项目分组沿用项目面板顺序，无项目在最后且项目名保持原文', () => {
    const { panel } = fixture('project');
    const tasks = [{ id: 'none' }, { id: 'a', projectId: 'a' }, { id: 'b', projectId: 'b' }];
    assert.deepEqual(ids(orderRemindersByGroup(tasks, task => panel.getReminderGroup(task, today))), ['b', 'a', 'none']);
    assert.equal(panel.getReminderGroup(tasks[1], today).title, '项目 A');
});

test('多分类按管理顺序归入一个分类，支持重复实例继承及显式清空', () => {
    const { panel } = fixture('category');
    panel.originalRemindersCache.original = { categoryId: 'a' };
    assert.equal(panel.getReminderGroup({ categoryId: 'a, b' }, today).key, 'category:b');
    assert.equal(panel.getReminderGroup({ isRepeatInstance: true, originalId: 'original' }, today).key, 'category:a');
    assert.equal(panel.getReminderGroup({ isRepeatInstance: true, originalId: 'original', categoryId: '' }, today).key, 'category:');
    assert.equal(panel.getReminderGroup({ categoryId: 'deleted' }, today).title, 'noCategory');
});

test('日期使用截止日期并覆盖逾期、今天、明天、未来和无截止日期', () => {
    const { panel } = fixture();
    const cases = [
        [{ date: today, endDate: '2026-11-15' }, 'date:future'],
        [{ date: '2026-11-01', endDate: today }, 'date:today'],
        [{ date: '2026-11-13' }, 'date:tomorrow'],
        [{ date: '2026-11-11' }, 'date:overdue'],
        [{}, 'date:none'],
        [{ date: today, startOnly: true }, 'date:none'],
        [{ date: today, time: '01:00' }, 'date:overdue'],
    ];
    cases.forEach(([task, key]) => assert.equal(panel.getReminderGroup(task, today).key, key));
});

test('优先级分组为高、中、低、无，组内保留已有排序', () => {
    const { panel } = fixture('priority');
    const tasks = [{ id: 'none' }, { id: 'low', priority: 'low' }, { id: 'high1', priority: 'high' },
        { id: 'medium', priority: 'medium' }, { id: 'high2', priority: 'high' }];
    assert.deepEqual(ids(orderRemindersByGroup(tasks, task => panel.getReminderGroup(task, today))), ['high1', 'high2', 'medium', 'low', 'none']);
});

test('父子按可见根分组，独立显示的子任务使用自己的分组，且不修改输入', () => {
    const { panel } = fixture('priority');
    const tasks = [{ id: 'child', parentId: 'parent', priority: 'high' }, { id: 'high', priority: 'high' },
        { id: 'parent', priority: 'low' }, { id: 'standalone', parentId: 'hidden', priority: 'high' }];
    const before = JSON.stringify(tasks);
    assert.deepEqual(ids(orderRemindersByGroup(tasks, task => panel.getReminderGroup(task, today))), ['high', 'standalone', 'child', 'parent']);
    assert.equal(JSON.stringify(tasks), before);
});

test('真实渲染生成单个组头，子任务跟随父任务，计数按根任务统计', () => {
    const { panel, rows } = fixture('priority');
    const tasks = [{ id: 'low', priority: 'low' }, { id: 'child', parentId: 'low', priority: 'high' },
        { id: 'high1', priority: 'high' }, { id: 'high2', priority: 'high' }];
    panel.renderRemindersIteratively(orderRemindersByGroup(tasks, task => panel.getReminderGroup(task, today)), new Map(), today);
    const headers = panel.elements.filter(element => !element.dataset.reminderId);
    assert.deepEqual(headers.map(header => header.dataset.reminderGroup), ['priority:high', 'priority:low']);
    assert.deepEqual(headers.map(header => header.querySelector('.reminder-section-header__count').textContent), ['2', '1']);
    assert.deepEqual(panel.elements.filter(element => element.dataset.reminderId).map(row => row.dataset.reminderId), ['high1', 'high2', 'low', 'child']);
    assert.equal(rows.get('child').dataset.reminderGroup, 'priority:low');
});

test('组头支持点击及键盘折叠，重新渲染保留折叠，恢复默认时清除隐藏状态', () => {
    const { panel, rows } = fixture('priority');
    const tasks = [{ id: 'low', priority: 'low' }, { id: 'high', priority: 'high' }];
    const render = () => panel.renderRemindersIteratively(orderRemindersByGroup(tasks, task => panel.getReminderGroup(task, today)), new Map(), today);
    render();
    panel.elements[0].events.click();
    assert.equal(rows.get('high').hidden, true);
    assert.equal(rows.get('low').hidden, false);
    render();
    assert.equal(rows.get('high').hidden, true);
    panel.elements[0].events.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(rows.get('high').hidden, false);
    panel.elements[0].events.click();
    panel.reminderGroupMode = 'none';
    panel.renderRemindersIteratively(tasks, new Map(), today);
    assert.equal(rows.get('high').hidden, false);
    assert.equal(rows.get('high').dataset.reminderGroup, undefined);
});

test('优先级排序也禁止跨显式分组拖拽，嵌套子任务按可见根判断', () => {
    const { panel } = fixture('project');
    const parent = { id: 'parent', projectId: 'a' };
    const child = { id: 'child', parentId: 'parent', projectId: 'b' };
    const other = { id: 'other', projectId: 'b' };
    panel.currentRemindersCache = [parent, child, other];
    assert.equal(panel.isSameNonPrioritySortGroup(parent, other), false);
    assert.equal(panel.isSameNonPrioritySortGroup(parent, child), true);
});

test('旧配置及非法分组值兼容为默认', () => {
    assert.equal(normalizeReminderGroupMode(undefined), 'none');
    assert.equal(normalizeReminderGroupMode('invalid'), 'none');
    assert.equal(normalizeReminderGroupMode('project'), 'project');
});

test('分组视图编辑或新建子任务后重算组头，仍自动展开父任务', async () => {
    const { panel } = fixture('priority');
    const parent = { id: 'parent', priority: 'low' };
    let reloads = 0;
    Object.assign(panel, {
        allRemindersMap: new Map([['parent', parent]]), currentRemindersCache: [parent],
        optimisticUpdatesCache: new Map(), userExpandedTasks: new Set(), collapsedTasks: new Set(['parent']),
        completedSubtaskCollapse: { setExpanded() {} }, invalidatePendingReminderLoad() {}, sortReminders() {},
        shouldShowInCurrentView: () => true, loadReminders: async () => { reloads++; },
    });
    panel.remindersContainer.querySelector = () => null;
    await panel.handleOptimisticSavedReminder({ id: 'child', parentId: 'parent', priority: 'high' });
    assert.equal(reloads, 1);
    assert.equal(panel.userExpandedTasks.has('parent'), true);
    assert.equal(panel.collapsedTasks.has('parent'), false);
    assert.equal(panel.optimisticUpdatesCache.get('child').priority, 'high');
});

function todayFixture(mode = 'priority') {
    const result = fixture(mode);
    result.panel.currentTab = 'today';
    result.panel.isTodayLikeView = () => true;
    const tasks = [
        { id: 'daily-high', priority: 'high', isAvailableToday: true, projectId: 'a', categoryId: 'a', date: today },
        { id: 'today-low', priority: 'low', projectId: 'b', categoryId: 'b', date: today },
        { id: 'daily-low', priority: 'low', isAvailableToday: true, projectId: 'b', categoryId: 'b', date: today },
        { id: 'today-high', priority: 'high', projectId: 'a', categoryId: 'a', date: today },
        { id: 'child', parentId: 'today-low', priority: 'high', isAvailableToday: true },
    ];
    result.render = () => {
        const ordered = orderRemindersByGroup(tasks, task => result.panel.getReminderDisplayGroup(task, today));
        result.panel.currentRemindersCache = ordered;
        result.panel.renderRemindersIteratively(ordered, new Map(), today);
    };
    return result;
}

test('今日任务的四种分组均保留今日任务 / 每日可做两级，子任务跟随根任务', () => {
    for (const mode of ['project', 'category', 'date', 'priority']) {
        const { panel, rows, render } = todayFixture(mode);
        render();
        const headers = panel.elements.filter(element => !element.dataset.reminderId);
        assert.deepEqual(headers.filter(header => !header.dataset.reminderTodayGroup).map(header => header.dataset.reminderGroup), ['today', 'daily']);
        assert.deepEqual([...new Set(headers.filter(header => header.dataset.reminderTodayGroup).map(header => header.dataset.reminderTodayGroup))], ['today', 'daily']);
        assert.equal(rows.get('child').dataset.reminderGroup, 'today');
        assert.equal(rows.get('child').dataset.reminderSubgroup, rows.get('today-low').dataset.reminderSubgroup);
        const dailyIndex = panel.elements.findIndex(element => element.dataset.reminderGroup === 'daily' && !element.dataset.reminderId);
        assert.ok(panel.elements.slice(0, dailyIndex).every(element => element.dataset.reminderId !== 'daily-high'));
        assert.ok(panel.elements.slice(dailyIndex).every(element => element.dataset.reminderId !== 'today-high'));
    }
});

test('同名二级组独立折叠，一级折叠隐藏组头和任务，展开保留二级折叠状态', () => {
    const { panel, rows, render } = todayFixture();
    render();
    const todayHigh = panel.elements.find(element => !element.dataset.reminderId && element.dataset.reminderGroup === 'today/priority:high');
    todayHigh.events.click();
    assert.equal(rows.get('today-high').hidden, true);
    assert.equal(rows.get('daily-high').hidden, false);
    panel.elements.find(element => element.id === 'today-tasks-section').events.click();
    assert.equal(rows.get('today-low').hidden, true);
    assert.equal(rows.get('child').hidden, true);
    assert.equal(todayHigh.hidden, true);
    assert.equal(rows.get('daily-high').hidden, false);
    render();
    assert.equal(rows.get('today-low').hidden, true);
    panel.elements.find(element => element.id === 'today-tasks-section').events.click();
    assert.equal(rows.get('today-high').hidden, true);
    assert.equal(rows.get('today-low').hidden, false);
    assert.equal(rows.get('child').hidden, false);
    assert.equal(panel.elements.find(element => element.dataset.reminderGroup === 'today/priority:high').hidden, false);
});

test('今日视图禁止跨一级分组拖拽，即使二级分组相同', () => {
    const { panel, rows, render } = todayFixture();
    render();
    assert.equal(panel.isSameNonPrioritySortGroup(panel.currentRemindersCache.find(task => task.id === 'today-high'),
        panel.currentRemindersCache.find(task => task.id === 'daily-high')), false);
    assert.equal(rows.get('daily-high').dataset.reminderSubgroup, 'daily/priority:high');
});
