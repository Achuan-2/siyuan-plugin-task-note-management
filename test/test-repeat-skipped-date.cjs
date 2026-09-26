const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTypeScript(relativePath, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    const localRequire = (id) => {
        if (!(id in dependencies)) throw new Error(`Unexpected import: ${id}`);
        return dependencies[id];
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

const skipDate = loadTypeScript('src/utils/reminderSkipDate.ts');
const repeat = loadTypeScript('src/components/dataManager/repeatUtils.ts', {
    '../../utils/dateUtils': {
        compareDateStrings: (left, right) => left.localeCompare(right),
        getLocalDateTimeString: (date) => date.toISOString()
    },
    '../../pluginInstance': { i18n: (key) => key },
    '../../utils/lunarUtils': {},
    '../../utils/reminderSkipDate': skipDate
});

const holidayData = {
    '2026-09-28': { type: 'holiday' },
    '2026-09-29': { type: 'holiday' }
};
const baseReminder = {
    id: 'weekly-task',
    date: '2026-09-28',
    endDate: '2026-09-29',
    reminderTimes: [{ time: '09:00', dayIndex: 1 }],
    repeat: {
        enabled: true,
        type: 'weekly',
        interval: 1,
        weekDays: [1],
        endType: 'never',
        reminderSkipHolidays: true
    }
};

const skipInstances = repeat.generateRepeatInstances(baseReminder, '2026-09-28', '2026-10-05', 100, { holidayData })
    .filter((instance) => !skipDate.shouldSkipReminderOnDate(instance, instance.date, {}, holidayData));
assert.deepEqual(skipInstances.map((instance) => instance.date), ['2026-10-05'], '默认跳过本周期');

const postponedReminder = {
    ...baseReminder,
    repeat: { ...baseReminder.repeat, skippedDateAction: 'postpone' }
};
const postponed = repeat.generateRepeatInstances(postponedReminder, '2026-09-30', '2026-10-05', 100, { holidayData });
assert.deepEqual(postponed.map((instance) => [instance.instanceId, instance.date, instance.endDate]), [
    ['weekly-task_2026-09-28', '2026-09-30', '2026-10-01'],
    ['weekly-task_2026-10-05', '2026-10-05', '2026-10-06']
]);
assert.equal(postponed[0].reminderTimes[0].time, '2026-09-30T09:00');

const weekendReminder = {
    ...postponedReminder,
    date: '2026-09-26',
    endDate: undefined,
    repeat: {
        ...postponedReminder.repeat,
        weekDays: [6],
        reminderSkipWeekendMode: 'saturdaySunday'
    }
};
const weekendPostponed = repeat.generateRepeatInstances(weekendReminder, '2026-09-30', '2026-09-30', 100, { holidayData });
assert.deepEqual(weekendPostponed.map((instance) => instance.instanceId), ['weekly-task_2026-09-26']);

const movedInstance = {
    ...postponedReminder,
    repeat: {
        ...postponedReminder.repeat,
        instances: { '2026-09-28': { date: '2026-10-02' } }
    }
};
const moved = repeat.generateRepeatInstances(movedInstance, '2026-09-28', '2026-10-02', 100, { holidayData });
assert.equal(moved[0].date, '2026-10-02', '手动修改的实例日期优先');

console.log('repeat skipped-date behavior OK');
