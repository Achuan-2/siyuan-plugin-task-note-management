// Run with: node --test scripts/test-repeat-window.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const relative = 'src/components/dataManager/repeatUtils.ts';
const source = fs.readFileSync(path.join(root, relative), 'utf8');
// 去掉查询区间跳转，保留优化前从原日期逐日遍历的实现作对照。
const legacySource = source.replace(/    const firstCandidate = new Date\(startDate[\s\S]*?    if \(currentDate < firstCandidate\) currentDate = firstCandidate;\r?\n/, '');
assert.notEqual(legacySource, source);

function loadRepeat(content) {
    const modules = new Map();
    let lunarCalls = 0;
    function load(filename) {
        if (filename.endsWith('pluginInstance.ts')) return { i18n: key => key };
        if (modules.has(filename)) return modules.get(filename).exports;
        const module = { exports: {} };
        modules.set(filename, module);
        const code = ts.transpileModule(filename === path.join(root, relative) ? content : fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText;
        const localRequire = name => {
            if (!name.startsWith('.')) return require(name);
            const target = path.resolve(path.dirname(filename), `${name}.ts`);
            const dependency = load(target);
            if (target.endsWith('lunarUtils.ts')) return { ...dependency, solarToLunar: (...args) => {
                lunarCalls++; return dependency.solarToLunar(...args);
            } };
            return dependency;
        };
        new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
        return module.exports;
    }
    return { ...load(path.join(root, relative)), lunarCalls: () => lunarCalls };
}
const current = loadRepeat(source), legacy = loadRepeat(legacySource);
function compare(reminder, start, end = start, options = {}, limit = 100) {
    const expected = legacy.generateRepeatInstances(reminder, start, end, limit, options);
    const actual = current.generateRepeatInstances(reminder, start, end, limit, options);
    assert.deepEqual(actual, expected);
    return actual;
}
const reminder = (repeat, extra = {}) => ({ id: 'repeat', title: 'task', date: '2025-12-01', time: '08:00',
    repeat: { enabled: true, type: 'daily', ...repeat }, ...extra });

test('所有重复规则保持原周期相位，查询区间与原逐日实现完全一致', () => {
    const rules = [
        { type: 'daily', interval: 3 }, { type: 'weekly', interval: 2, weekDays: [1, 3, 6] },
        { type: 'monthly', interval: 2, monthDays: [1, 15, 31] },
        { type: 'monthly', monthlyRepeatMode: 'week', monthlyWeekRules: [{ order: 1, weekday: 1 }, { order: -1, weekday: 5 }] },
        { type: 'yearly', interval: 1 }, { type: 'yearly', months: [2, 11], monthDays: [1, 5] },
        { type: 'custom', weekDays: [1, 5], months: [10, 11] },
        { type: 'ebbinghaus', ebbinghausPattern: [1, 2, 4, 7, 15] },
        { type: 'lunar-monthly', lunarDay: 15 }, { type: 'lunar-yearly', lunarMonth: 9, lunarDay: 26 },
    ];
    for (const rule of rules) {
        for (const ending of [{}, { endType: 'date', endDate: '2026-11-05' }, { endType: 'count', endCount: 2 }]) {
            compare(reminder({ ...rule, ...ending }), '2026-11-01', '2026-11-10');
        }
    }
});

test('查询早于任务开始、无原日期农历、排除和实例状态仍保持原结果', () => {
    compare(reminder({}), '2025-11-01', '2025-12-03');
    compare(reminder({ type: 'lunar-monthly', lunarDay: 15 }, { date: undefined }), '2026-11-01', '2026-11-10');
    const instances = {
        '2026-11-01': { completed: true, title: 'completed' },
        '2026-11-02': { deleted: true }, '2026-11-03': { date: null },
        '2026-11-04': { date: '2026-11-06', time: '09:30' },
        '2026-10-01': { date: '2026-11-05', preservedFromSeriesEdit: true, title: 'moved' },
    };
    compare(reminder({ excludeDates: ['2026-11-07'], instances }), '2026-11-01', '2026-11-08');
    compare(reminder({ instances }), '2026-11-01', '2026-11-08', {}, 2);
});

test('顺延仍能带入查询区间之前的周期，365 天回溯覆盖原 366 次尝试的边界', () => {
    const options = { settings: {}, holidayData: {} };
    compare(reminder({ skippedDateAction: 'postpone' }, { reminderSkipWeekendMode: 'weekend' }), '2026-11-02', '2026-11-02', options);
    const date = '2026-11-05';
    const holidayData = {};
    for (let day = 1; day <= 366; day++) holidayData[current.addDaysToDate(date, -day)] = { type: 'holiday' };
    // 使用真实节假日跳过规则，验证长假顺延与旧实现结果一致。
    const postponed = compare(reminder({ skippedDateAction: 'postpone' }, {
        date: current.addDaysToDate(date, -400), reminderSkipHolidays: true,
    }), date, date, { settings: {}, holidayData }, 1000);
    assert.equal(postponed.length, 366);
    assert.ok(postponed.some(instance => instance.instanceId === `repeat_${current.addDaysToDate(date, -365)}`));
    assert.ok(!postponed.some(instance => instance.instanceId === `repeat_${current.addDaysToDate(date, -366)}`));
});

test('几十年前的农历重复任务，单日查询只转换查询日，结果与旧实现一致', () => {
    const task = reminder({ type: 'lunar-yearly', lunarMonth: 9, lunarDay: 26 }, { date: '1990-01-01' });
    const before = current.lunarCalls();
    compare(task, '2026-11-05');
    assert.equal(current.lunarCalls() - before, 1);
    assert.ok(legacy.lunarCalls() > 10_000);
});

