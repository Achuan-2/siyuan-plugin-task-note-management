// Run with: node --test scripts/test-reminder-panel-new-task-date.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const relativePath = 'src/components/panel/ReminderPanel.ts';
const source = ts.createSourceFile(relativePath,
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), ts.ScriptTarget.Latest, true);
const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPanel').members;
const names = ['getActiveCustomFilterConfig', 'getCustomFilterConfig', 'getNewTaskDateAttributes', 'showNewTaskDialog'];
const methods = members.filter(node => names.includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Panel { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(tab = 'today', dateFilters, today = '2026-10-31') {
    const dialogs = [];
    const format = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    class QuickReminderDialog {
        constructor(...args) { this.args = args; dialogs.push(this); }
        show() { this.shown = true; }
    }
    const Panel = new Function('getLogicalDateString', 'getRelativeDateString', 'getLocalDateString',
        'QuickReminderDialog', 'i18n', 'showMessage', `${code}; return Panel;`)(
        () => today,
        offset => { const date = new Date(today + 'T00:00:00'); date.setDate(date.getDate() + offset); return format(date); },
        format, QuickReminderDialog, key => key, message => { throw new Error(message); },
    );
    const panel = Object.assign(new Panel(), {
        currentTab: tab, plugin: {}, allRemindersMap: new Map([['existing', { sort: 20000 }]]),
        customFilterCache: new Map([['custom_example', { dateFilters }]]),
    });
    return { panel, dialogs };
}

test('内置日期筛选填入对应日期，日期范围跨月且本周从周一开始', () => {
    const cases = [
        ['today', '2026-10-31', ''], ['tomorrow', '2026-11-01', ''],
        ['thisWeek', '2026-10-26', '2026-11-01'], ['future7', '2026-11-01', '2026-11-07'],
        ['futureAll', '2026-11-01', ''], ['overdue', '2026-10-30', ''],
        ['all', '2026-10-24', '2026-10-31'], ['noDate', '', ''],
        ['yesterdayCompleted', '2026-10-30', ''], ['todayCompleted', '2026-10-31', ''],
        ['allUncompleted', '2026-10-31', ''], ['completed', '2026-10-31', ''],
    ];
    for (const [tab, defaultDate, defaultEndDate] of cases) {
        assert.deepEqual(fixture(tab).panel.getNewTaskDateAttributes(), { defaultDate, defaultEndDate }, tab);
    }
});

test('自定义筛选使用配置日期，忽略开始日期修饰项，并遵循全部日期优先规则', () => {
    const cases = [
        [[{ type: 'start_only' }, { type: 'tomorrow' }], '2026-11-01', ''],
        [[{ type: 'today' }, { type: 'overdue' }], '2026-10-31', ''],
        [[{ type: 'none' }], '', ''],
        [[{ type: 'none' }, { type: 'all' }], '2026-10-31', ''],
        [[{ type: 'yesterday' }], '2026-10-30', ''],
        [[{ type: 'future' }], '2026-11-01', ''],
        [[{ type: 'next_7_days' }], '2026-10-31', '2026-11-07'],
        [[{ type: 'future_x_days', futureDays: 3 }], '2026-10-31', '2026-11-03'],
        [[{ type: 'future_x_days' }], '2026-10-31', '2026-11-14'],
        [[{ type: 'custom_range', startDate: '2026-12-20', endDate: '2027-01-05' }], '2026-12-20', '2027-01-05'],
        [[{ type: 'start_only' }], '2026-10-31', ''],
        [[], '2026-10-31', ''],
    ];
    for (const [filters, defaultDate, defaultEndDate] of cases) {
        assert.deepEqual(fixture('custom_custom_example', filters).panel.getNewTaskDateAttributes(),
            { defaultDate, defaultEndDate }, JSON.stringify(filters));
    }
});

test('年度范围使用当年日期，跨年范围不会生成开始晚于结束的日期', () => {
    const filter = { type: 'yearly_date_range', yearlyStartMonth: 11, yearlyStartDay: 1, yearlyEndMonth: 2, yearlyEndDay: 28 };
    for (const [today, defaultDate, defaultEndDate] of [
        ['2026-01-15', '2026-01-01', '2026-02-28'],
        ['2026-10-31', '2026-11-01', '2026-12-31'],
    ]) {
        assert.deepEqual(fixture('custom_custom_example', [filter], today).panel.getNewTaskDateAttributes(),
            { defaultDate, defaultEndDate });
    }
    assert.deepEqual(fixture('custom_custom_example', [{ ...filter, yearlyEndMonth: 12, yearlyEndDay: 25 }])
        .panel.getNewTaskDateAttributes(), { defaultDate: '2026-11-01', defaultEndDate: '2026-12-25' });
});

test('新建弹窗实际接收筛选日期和结束日期，保留排序与保存回调', async () => {
    const { panel, dialogs } = fixture('custom_custom_example', [
        { type: 'custom_range', startDate: '2026-12-20', endDate: '2027-01-05' },
    ]);
    let saved;
    panel.handleOptimisticSavedReminder = async reminder => { saved = reminder; };
    panel.showNewTaskDialog();
    const dialog = dialogs[0];
    assert.equal(dialog.shown, true);
    assert.equal(dialog.args[0], '2026-12-20');
    assert.deepEqual(dialog.args[3], { isTimeRange: true, endDate: '2027-01-05' });
    assert.equal(dialog.args[4].defaultSort, 30000);
    const reminder = { id: 'new' };
    await dialog.args[2](reminder);
    assert.equal(saved, reminder);
});

test('无日期视图新建时两个日期均留空，明天视图默认同一天结束', () => {
    for (const [tab, date] of [['noDate', ''], ['tomorrow', '2026-11-01']]) {
        const { panel, dialogs } = fixture(tab);
        panel.showNewTaskDialog();
        assert.equal(dialogs[0].args[0], date);
        assert.deepEqual(dialogs[0].args[3], { isTimeRange: !!date, endDate: date });
    }
});
