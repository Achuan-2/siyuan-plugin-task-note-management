// Run with: node --test scripts/test-reminder-panel-sort.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const relative = 'src/components/panel/ReminderPanel.ts';
const content = process.env.REMINDER_PANEL_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.REMINDER_PANEL_SOURCE_REF}:${relative}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, relative), 'utf8');
const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
const names = ['normalizeSortCriteria', 'getActiveSortCriteria', 'getBuiltInDefaultSortCriteria',
    'sortReminders', 'sortByCriteria', 'compareByCriterion', 'compareByPriorityValue',
    'compareByEndDate', 'compareByTime', 'compareByTitle', 'compareByCreatedTime',
    'getPinnedSortRank', 'isReminderPinned', 'getReminderSortValue'];
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPanel')
    .members.filter(node => names.includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Panel { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const Panel = new Function(`${code}; return Panel;`)();

function sorted(tasks, criteria, originalRemindersCache = {}) {
    const panel = Object.assign(new Panel(), {
        currentTab: 'future', currentSortCriteria: criteria, originalRemindersCache,
        isTodayLikeView: () => false,
        getOriginalReminder: id => originalRemindersCache[id],
    });
    const reminders = [...tasks];
    panel.sortReminders(reminders);
    return reminders.map(task => task.id);
}
const criterion = (method, order = 'asc') => ({ method, order });
const tasks = [
    { id: 'high-late', priority: 'high', date: '2026-11-01', endDate: '2026-11-20', sort: 0 },
    { id: 'high-early', priority: 'high', date: '2026-11-02', endDate: '2026-11-15', sort: 10 },
    { id: 'low-late', priority: 'low', date: '2026-11-01', endDate: '2026-11-21', sort: -10 },
    { id: 'low-early', priority: 'low', date: '2026-11-02', endDate: '2026-11-16', sort: 20 },
];

for (const priorityOrder of ['asc', 'desc']) {
    for (const endDateOrder of ['asc', 'desc']) {
        test(`优先级${priorityOrder}后按结束日期${endDateOrder}，手动顺序不能截断第二条件`, () => {
            const groups = priorityOrder === 'asc' ? ['low', 'high'] : ['high', 'low'];
            const dates = endDateOrder === 'asc' ? ['early', 'late'] : ['late', 'early'];
            assert.deepEqual(sorted(tasks, [criterion('priority', priorityOrder), criterion('endDate', endDateOrder)]),
                groups.flatMap(group => dates.map(date => `${group}-${date}`)));
        });
    }
}

for (const method of ['time', 'title', 'created']) {
    test(`优先级相同后，后续${method}条件同样优先于手动顺序`, () => {
        const reminders = [
            { id: 'later', priority: 'medium', date: '2026-11-20', title: 'B', createdTime: '2026-11-02', sort: -10 },
            { id: 'earlier', priority: 'medium', date: '2026-11-15', title: 'A', createdTime: '2026-11-01', sort: 10 },
        ];
        assert.deepEqual(sorted(reminders, [criterion('priority'), criterion(method)]), ['earlier', 'later']);
    });
}

test('结束日期与优先级相同后，继续按第三个标题条件排序', () => {
    const reminders = [
        { id: 'b', priority: 'high', endDate: '2026-11-20', title: 'B', sort: -10 },
        { id: 'a', priority: 'high', endDate: '2026-11-20', title: 'A', sort: 10 },
    ];
    assert.deepEqual(sorted(reminders, [criterion('endDate'), criterion('priority'), criterion('title')]), ['a', 'b']);
});

for (const priorityOrder of ['asc', 'desc']) {
    test(`只按优先级${priorityOrder}时，同优先级仍按手动顺序升序排列`, () => {
        assert.deepEqual(sorted(tasks, [criterion('priority', priorityOrder)]), priorityOrder === 'asc'
            ? ['low-late', 'low-early', 'high-late', 'high-early']
            : ['high-late', 'high-early', 'low-late', 'low-early']);
    });
}

test('所有条件相同时，重复实例仍读取原任务手动顺序，再按创建时间兜底', () => {
    const reminders = [
        { id: 'first-new', originalId: 'first', isRepeatInstance: true, priority: 'high', endDate: '2026-11-20', sort: 100, createdTime: '2026-11-02' },
        { id: 'second', originalId: 'second', isRepeatInstance: true, priority: 'high', endDate: '2026-11-20', sort: -100, createdTime: '2026-10-01' },
        { id: 'first-old', originalId: 'first', isRepeatInstance: true, priority: 'high', endDate: '2026-11-20', sort: 100, createdTime: '2026-11-01' },
    ];
    assert.deepEqual(sorted(reminders, [criterion('priority', 'desc'), criterion('endDate', 'desc')], {
        first: { sort: 0 }, second: { sort: 10 },
    }), ['first-old', 'first-new', 'second']);
});

test('置顶任务仍优先于优先级和结束日期条件', () => {
    assert.deepEqual(sorted([
        { id: 'normal', priority: 'high', endDate: '2026-11-15' },
        { id: 'pinned', pinned: true, priority: 'low', endDate: '2026-11-20' },
    ], [criterion('priority', 'desc'), criterion('endDate')]), ['pinned', 'normal']);
});
