// Run with: node --test test/test-habit-monthly-repeat.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');

const load = createKernelLoader();
const utils = load('src/utils/habitUtils.ts');
const monthly = load('src/utils/monthlyRepeat.ts');
const repeat = load('src/components/dataManager/repeatUtils.ts');
const schedule = load('src/services/ReminderSchedule.ts');
const frequency = (rules, interval = 1) => ({
    type: 'monthly', monthlyRepeatMode: 'weekday', monthlyWeekRules: rules, interval
});
const habit = (freq) => ({
    id: 'habit', title: '月末复盘', startDate: '2024-01-01', target: 1,
    frequency: freq, checkIns: {}, checkInEmojis: [{ emoji: '✅', value: 1 }], reminderTimes: ['09:00']
});
const dateKey = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

test('逐月枚举独立核对所有序号和星期，覆盖闰年及不存在的第五个星期', () => {
    for (let year = 2024; year <= 2027; year++) {
        for (let month = 0; month < 12; month++) {
            const lastDay = new Date(year, month + 1, 0).getDate();
            for (let weekday = 0; weekday < 7; weekday++) {
                const dates = Array.from({ length: lastDay }, (_, i) => i + 1)
                    .filter(day => new Date(year, month, day).getDay() === weekday);
                for (const order of [1, 2, 3, 4, 5, -1]) {
                    const expected = order === -1 ? dates.at(-1) : dates[order - 1] ?? null;
                    assert.equal(monthly.getMonthlyWeekdayDate(year, month, order, weekday), expected);
                    const value = habit(frequency([{ order, weekday }]));
                    for (let day = 1; day <= lastDay; day++) {
                        assert.equal(utils.shouldCheckInOnDate(value, dateKey(year, month, day)), day === expected);
                    }
                }
            }
        }
    }
});

test('多条规则、跨年间隔与重复任务生成日期一致', () => {
    const value = habit(frequency([{ order: 1, weekday: 1 }, { order: -1, weekday: 5 }], 2));
    value.startDate = '2025-11-10';
    const instances = repeat.generateRepeatInstances({ id: 'task', date: value.startDate,
        repeat: { ...value.frequency, enabled: true } }, '2025-11-01', '2026-04-30', 100);
    assert.deepEqual(instances.map(item => item.date), ['2025-11-28', '2026-01-05', '2026-01-30', '2026-03-02', '2026-03-27']);
    for (let date = new Date(2025, 10, 1); date <= new Date(2026, 3, 30); date.setDate(date.getDate() + 1)) {
        const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
        assert.equal(utils.shouldCheckInOnDate(value, key), instances.some(item => item.date === key), key);
    }
});

test('规则去重、兼容单规则旧字段，无效规则不回退到按日期', () => {
    assert.deepEqual(monthly.getMonthlyWeekRules({ monthlyRepeatMode: 'weekday', monthlyWeekRules: [
        { order: -1, weekday: 5 }, { order: 1, weekday: 0 }, { order: -1, weekday: 5 },
        { order: 6, weekday: 1 }, { order: 1, weekday: 7 }, { order: 1.5, weekday: 1 }
    ] }), [{ order: 1, weekday: 0 }, { order: -1, weekday: 5 }]);
    assert.deepEqual(monthly.getMonthlyWeekRules({ monthlyRepeatMode: 'weekday', monthlyWeekOrder: -1, monthlyWeekday: 5 }), [{ order: -1, weekday: 5 }]);
    const invalid = habit({ ...frequency([]), monthDays: [1] });
    assert.equal(utils.shouldCheckInOnDate(invalid, '2026-11-01'), false);
    const dates = habit({ type: 'monthly', monthDays: [1, 15], interval: 2 });
    assert.equal(utils.shouldCheckInOnDate(dates, '2024-01-15'), true);
    assert.equal(utils.shouldCheckInOnDate(dates, '2024-02-15'), false);
    assert.equal(utils.shouldCheckInOnDate(dates, '2024-03-15'), true);
});

test('侧栏今日分组和提醒调度只在最后一个周五生成待打卡及提醒', async () => {
    const value = habit(frequency([{ order: -1, weekday: 5 }]));
    for (const [date, expected] of [['2026-11-20', false], ['2026-11-27', true], ['2026-11-28', false]]) {
        assert.equal(utils.getTodayHabitBuckets([value], date).pendingHabits.length, Number(expected));
        const { times } = await schedule.buildReminderSchedule({}, { habit: value }, {}, {}, new Date(`${date}T08:00:00`));
        assert.equal(times.has('09:00'), expected);
    }
});

test('习惯统计和任务总结按相同规则计算应打卡日期并遵守起止日期', () => {
    const statsFile = 'src/components/stats/HabitStatsDialog.ts';
    const statsSource = ts.createSourceFile(statsFile, fs.readFileSync(path.join(__dirname, '..', statsFile), 'utf8'), ts.ScriptTarget.Latest, true);
    const members = statsSource.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'HabitStatsDialog').members;
    const methods = members.filter(node => ['isHabitWithinDateRange', 'shouldCheckInOnDate'].includes(node.name?.getText(statsSource)))
        .map(node => node.getText(statsSource)).join('\n');
    const summaryFile = 'src/components/stats/TaskSummaryTab.svelte';
    const summaryText = fs.readFileSync(path.join(__dirname, '..', summaryFile), 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
    const summarySource = ts.createSourceFile(summaryFile, summaryText, ts.ScriptTarget.Latest, true);
    const summaryFunction = summarySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'shouldCheckInOnDate');
    const code = ts.transpileModule(`class Stats { ${methods} }\n${summaryFunction.getText(summarySource)}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const { stats, summary } = new Function('shouldCheckInOnDateUtil', `${code}; return { stats: new Stats(), summary: shouldCheckInOnDate };`)(utils.shouldCheckInOnDate);
    const value = { ...habit(frequency([{ order: -1, weekday: 5 }])), startDate: '2026-10-31', endDate: '2026-11-30' };
    for (const [date, expected] of [['2026-10-30', false], ['2026-11-20', false], ['2026-11-27', true], ['2026-12-25', false]]) {
        assert.equal(stats.shouldCheckInOnDate(value, date), expected);
        assert.equal(summary(value, date), expected);
    }
});

// 只模拟频率表单需要的 DOM；执行真实构建、切换、增删和提交方法。
class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.listeners = {}; this.value = ''; }
    set innerHTML(html) { this.html = html; if (this.tagName === 'select') this.value = /value="([^"]*)"/.exec(html)?.[1] || ''; }
    get innerHTML() { return this.html || ''; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() { this.parent.children = this.parent.children.filter(item => item !== this); }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    change(value) { this.value = value; this.listeners.change?.(); }
    click() { if (!this.disabled) this.listeners.click?.(); }
    querySelectorAll(selector) {
        const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        return nodes.filter(node => {
            if (selector === '*') return true;
            if (selector.startsWith('.')) return (node.className || '').split(' ').includes(selector.slice(1));
            const match = /^(\w+)?\[name="([^"]+)"\]$/.exec(selector);
            return match ? (!match[1] || node.tagName === match[1]) && node.name === match[2] : node.tagName === selector;
        });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function editorFixture(value) {
    const messages = [], saved = [];
    const file = path.join(__dirname, '../src/components/dialog/HabitEditDialog.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const dependencies = {
        '../../utils/habitUtils': utils,
        '../../utils/monthlyRepeat': monthly,
        '../../pluginInstance': { i18n: key => key },
        '../../utils/dateUtils': { getLogicalDateString: () => '2026-11-13', getLocalDateTimeString: () => '2026-11-13 09:00:00' },
        siyuan: { showMessage: (...args) => messages.push(args) }
    };
    const module = { exports: {} };
    class FormData {
        constructor(form) { this.form = form; }
        get(key) { return this.form.values[key] ?? this.form.querySelector(`[name="${key}"]`)?.value ?? null; }
    }
    new Function('require', 'module', 'exports', 'document', 'FormData', code)(
        name => dependencies[name] || {}, module, module.exports,
        { createElement: tag => new Element(tag) }, FormData
    );
    const editor = new module.exports.HabitEditDialog(value, async result => saved.push(result));
    editor.dialog = { destroy() {} };
    const form = new Element('form');
    form.values = { title: '月末复盘', color: '#66bb6a', startDate: value?.startDate || '2026-11-01' };
    form.appendChild(editor.createFrequencyGroup());
    return { editor, form, saved, messages, submit: () => editor.handleSubmit(form, !value, value?.checkInEmojis || [{ emoji: '✅', value: 1 }], false) };
}

test('新建选择最后一个周五，切换模式保留草稿，保存及重新编辑完整恢复', async () => {
    const fixture = editorFixture(null);
    const { form } = fixture;
    const type = form.querySelector('[name="frequencyType"]');
    const mode = form.querySelector('[name="monthlyRepeatMode"]');
    type.change('monthly');
    mode.change('weekday');
    const row = form.querySelector('.habit-monthly-week-rule');
    assert.equal(row.parent.parent.style.display, 'flex');
    row.querySelector('[name="monthlyWeekOrder"]').value = '-1';
    row.querySelector('[name="monthlyWeekday"]').value = '5';
    form.querySelector('[name="interval"]').value = '2';
    mode.change('date');
    assert.equal(row.parent.parent.style.display, 'none');
    mode.change('weekday');
    await fixture.submit();
    assert.deepEqual(fixture.saved[0].frequency, frequency([{ order: -1, weekday: 5 }], 2));
    const reopened = editorFixture(fixture.saved[0]);
    assert.equal(reopened.form.querySelector('[name="monthlyRepeatMode"]').value, 'weekday');
    assert.equal(reopened.form.querySelector('[name="monthlyWeekOrder"]').value, '-1');
    assert.equal(reopened.form.querySelector('[name="monthlyWeekday"]').value, '5');
    await reopened.submit();
    assert.deepEqual(reopened.saved[0].frequency, fixture.saved[0].frequency);
});

test('多条规则增删并去重，切回按日期或其他频率后清除星期规则', async () => {
    const original = habit(frequency([{ order: 1, weekday: 1 }, { order: -1, weekday: 5 }]));
    const fixture = editorFixture(original);
    const { form } = fixture;
    const row = form.querySelector('.habit-monthly-week-rule');
    const add = row.parent.parent.children[1];
    add.click(); // 默认第一个周一，与第一条重复。
    assert.equal(form.querySelectorAll('.habit-monthly-week-rule').length, 3);
    await fixture.submit();
    assert.deepEqual(fixture.saved[0].frequency.monthlyWeekRules, original.frequency.monthlyWeekRules);
    row.querySelector('.habit-monthly-week-rule-remove').click();
    assert.equal(form.querySelectorAll('.habit-monthly-week-rule').length, 2);
    form.querySelector('.habit-monthly-week-rule-remove').click();
    assert.equal(form.querySelector('.habit-monthly-week-rule-remove').disabled, true);
    form.querySelector('[name="monthlyRepeatMode"]').change('date');
    const day = form.querySelectorAll('[name="monthDay"]')[14];
    day.checked = true;
    await fixture.submit();
    assert.deepEqual(fixture.saved[1].frequency, { type: 'monthly', monthDays: [15] });
    form.querySelector('[name="frequencyType"]').change('daily');
    await fixture.submit();
    assert.deepEqual(fixture.saved[2].frequency, { type: 'daily' });
    assert.deepEqual(original.frequency.monthlyWeekRules, [{ order: 1, weekday: 1 }, { order: -1, weekday: 5 }]);
});
