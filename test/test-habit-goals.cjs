const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');

const load = createKernelLoader();
const utils = load('src/utils/habitUtils.ts');
const linked = load('src/utils/linkedHabitPomodoro.ts');
const date = '2026-10-08';
const clone = value => JSON.parse(JSON.stringify(value));

function habit(count = 0, overrides = {}) {
    return {
        id: 'habit', title: '复习', goalType: 'either', target: 2,
        pomodoroTargetHours: 0, pomodoroTargetMinutes: 20,
        startDate: '2026-10-01', frequency: { type: 'daily' },
        checkInEmojis: [{ emoji: '✅', countsAsSuccess: true }, { emoji: '❌', countsAsSuccess: false }],
        checkIns: { [date]: { count, status: Array(count).fill('✅'), timestamp: `${date} 09:00` } },
        ...overrides
    };
}

test('组合目标任一达标即可，两项部分进度不能相加达标', () => {
    for (const [count, minutes, expected] of [[0, 0, false], [1, 10, false], [2, 0, true], [0, 20, true], [2, 20, true]]) {
        const value = habit(count);
        const options = { getPomodoroFocusMinutes: () => minutes };
        assert.equal(utils.isHabitCompletedOnDate(value, date, options), expected);
        assert.equal(utils.isHabitCheckInDayComplete(value, date, options), expected);
        const progress = utils.getHabitProgressOnDate(value, date, options);
        assert.deepEqual(progress.count, { current: count, target: 2 });
        assert.deepEqual(progress.pomodoro, { current: minutes, target: 20 });
        const buckets = utils.getTodayHabitBuckets([value], date, options);
        assert.equal(buckets.completedHabits.length, expected ? 1 : 0);
        assert.equal(buckets.pendingHabits.length, expected ? 0 : 1);
    }
});

test('组合目标只统计成功状态，并兼容旧 count 记录和缺少时长字段的数据', () => {
    const failed = habit(2, { checkIns: { [date]: { count: 2, entries: [{ emoji: '✅' }, { emoji: '❌' }] } } });
    assert.equal(utils.isHabitCompletedOnDate(failed, date), false);
    assert.equal(utils.isHabitCompletedOnDate(failed, date, { getPomodoroFocusMinutes: () => 20 }), true);
    assert.equal(utils.isHabitCompletedOnDate(habit(2, { checkIns: { [date]: { count: 2 } } }), date), true);
    assert.equal(utils.getHabitPomodoroTargetMinutes(habit(0, { pomodoroTargetHours: undefined, pomodoroTargetMinutes: undefined })), 30);
});

test('已有次数、番茄和未设置类型的习惯保留原有判断', () => {
    const options = { getPomodoroFocusMinutes: () => 20 };
    assert.equal(utils.isHabitCompletedOnDate(habit(0, { goalType: 'count' }), date, options), false);
    assert.equal(utils.isHabitCompletedOnDate(habit(2, { goalType: undefined }), date), true);
    assert.equal(utils.isHabitCompletedOnDate(habit(2, { goalType: 'pomodoro' }), date), false);
    assert.equal(utils.isHabitCompletedOnDate(habit(0, { goalType: 'pomodoro' }), date, options), true);
    assert.equal(utils.getHabitPomodoroTargetMinutes({ goalType: 'pomodoro', target: 45 }), 45);
});

// 加载完整前端类，只替换思源宿主与无关依赖，直接调用真实保存/事件生成方法。
function loadFrontend(file, manager, messages = []) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    const dependencies = {
        '../../utils/habitUtils': utils,
        '../../utils/linkedHabitPomodoro': linked,
        '../../utils/dateUtils': {
            getLogicalDateString: () => date,
            getRelativeDateString: offset => {
                const value = new Date(`${date}T12:00:00`);
                value.setDate(value.getDate() + offset);
                return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
            },
            getLocalDateString: value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
            getLocalDateTimeString: () => `${date} 09:30:00`,
            compareDateStrings: (a, b) => a.localeCompare(b)
        },
        '../dataManager/pomodoroRecord': { PomodoroRecordManager: { getInstance: () => manager } },
        '../../pluginInstance': { i18n: key => key },
        siyuan: { showMessage: (...args) => messages.push(args) }
    };
    class FormData {
        constructor(form) { this.values = form.values; }
        get(key) { return this.values[key] ?? null; }
    }
    new Function('require', 'module', 'exports', 'FormData', compiled)(
        name => dependencies[name] || {}, module, module.exports, FormData
    );
    return module.exports;
}

function fixture(value, minutes) {
    const sessions = minutes ? [{ eventId: 'task', type: 'work', duration: minutes, startTime: `${date}T08:00:00` }] : [];
    const records = { [date]: { sessions } };
    const tasks = { task: { id: 'task', linkedHabitId: 'habit', linkedHabitSyncPomodoroToday: true } };
    const manager = {
        initialize: async () => {}, refreshData: async () => {},
        getSaveData: () => records, getEventFocusTime: () => 0, calculateSessionCount: () => 1
    };
    const { HabitPanel } = loadFrontend('src/components/panel/HabitPanel.ts', manager);
    const panel = Object.create(HabitPanel.prototype);
    panel.pomodoroRecordManager = manager;
    panel.linkedTaskPomodoroStats = linked.buildLinkedHabitPomodoroData(tasks, records).statsByHabit;
    const { CalendarView } = loadFrontend('src/components/panel/CalendarView.ts', manager);
    const calendar = Object.create(CalendarView.prototype);
    Object.assign(calendar, {
        plugin: { loadHabitData: async () => ({ habit: value }), loadReminderData: async () => tasks },
        pomodoroRecordManager: manager, linkedHabitPomodoroStats: new Map(),
        getOrderedHabitsForCalendar: async habits => habits,
        parseReminderTimeToDateTime: time => ({ time }),
        currentCompletionFilter: 'all', alwaysShowHabitReminderTime: true,
        showHabitCheckInTime: true, showReminderTime: true
    });
    return { panel, calendar };
}

test('面板与日历完成状态一致，支持绑定任务的番茄时长及完成筛选', async () => {
    for (const [count, minutes, expected] of [[2, 0, true], [0, 20, true], [1, 10, false]]) {
        for (const reminderTimes of [[], ['09:30']]) {
            const value = habit(count, { reminderTimes });
            const { panel, calendar } = fixture(value, minutes);
            const events = [];
            await calendar.addHabitEventsToList(events, date, date);
            assert.ok(events.length > 0);
            assert.equal(panel.isCompletedOnDate(value, date), expected);
            const progress = panel.getHabitProgressOnDate(value, date);
            for (const event of events) {
                assert.equal(event.extendedProps.completed, expected);
                assert.equal(event.extendedProps.goalType, 'either');
                assert.equal(event.extendedProps.countProgress, progress.count.current);
                assert.equal(event.extendedProps.pomodoroProgress, progress.pomodoro.current);
            }
            const types = events.map(event => event.extendedProps.type);
            assert.ok(types.includes(reminderTimes.length ? 'habitReminderTime' : 'habit'));
            if (count) assert.ok(types.includes('habitCheckInTime'));
            calendar.currentCompletionFilter = expected ? 'incomplete' : 'completed';
            const filtered = [];
            await calendar.addHabitEventsToList(filtered, date, date);
            assert.equal(filtered.length, 0);
        }
    }
});

test('编辑组合目标保存次数和时长，小时进位后重新编辑仍保留两项', async () => {
    const manager = {};
    const { HabitEditDialog } = loadFrontend('src/components/dialog/HabitEditDialog.ts', manager);
    const editor = Object.create(HabitEditDialog.prototype);
    const saved = [];
    Object.assign(editor, { habit: habit(1), onSave: async value => saved.push(value), dialog: { destroy() {} } });
    const values = {
        title: '复习', color: '#66bb6a', startDate: '2026-10-01', goalType: 'either',
        target: '3', pomodoroTargetHours: '0', pomodoroTargetMinutes: '75',
        autoCheckInAfterPomodoro: 'on', autoCheckInEmoji: '✅', checkInButtonType: 'countup'
    };
    const form = { values, querySelectorAll: () => [] };
    await editor.handleSubmit(form, false, editor.habit.checkInEmojis, false);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].goalType, 'either');
    assert.equal(saved[0].target, 3);
    assert.equal(saved[0].pomodoroTargetHours, 1);
    assert.equal(saved[0].pomodoroTargetMinutes, 15);
    assert.equal(saved[0].autoCheckInAfterPomodoro, true);
    assert.equal(saved[0].checkInButtonType, 'countup');
    editor.habit = saved[0];
    values.pomodoroTargetHours = '1'; values.pomodoroTargetMinutes = '15';
    await editor.handleSubmit(form, false, editor.habit.checkInEmojis, false);
    assert.equal(saved[1].target, 3);
    assert.equal(utils.getHabitPomodoroTargetMinutes(saved[1]), 75);
    assert.deepEqual(saved[1].checkIns, habit(1).checkIns);
});

test('组合目标拒绝零时长，切换为单项目标保留既有保存格式', async () => {
    const messages = [];
    const { HabitEditDialog } = loadFrontend('src/components/dialog/HabitEditDialog.ts', {}, messages);
    const editor = Object.create(HabitEditDialog.prototype);
    const saved = [];
    Object.assign(editor, { habit: habit(), onSave: async value => saved.push(value), dialog: { destroy() {} } });
    const values = { title: '复习', color: '#66bb6a', startDate: '2026-10-01', goalType: 'either', target: '2', pomodoroTargetHours: '0', pomodoroTargetMinutes: '0' };
    const form = { values, querySelectorAll: () => [] };
    await editor.handleSubmit(form, false, editor.habit.checkInEmojis, false);
    assert.equal(saved.length, 0);
    assert.ok(messages.some(args => args[2] === 'error'));
    values.goalType = 'count';
    await editor.handleSubmit(form, false, editor.habit.checkInEmojis, false);
    assert.equal(saved[0].target, 2);
    assert.equal(saved[0].pomodoroTargetMinutes, undefined);
    values.goalType = 'pomodoro'; values.pomodoroTargetMinutes = '20';
    await editor.handleSubmit(form, false, editor.habit.checkInEmojis, false);
    assert.equal(saved[1].target, 20);
    assert.equal(saved[1].pomodoroTargetMinutes, 20);
});

test('内核习惯管理保存并更新组合目标，不丢失另一项目标', async () => {
    const { HabitManager } = load('src/components/dataManager/habitManager.ts');
    const files = {};
    const manager = new HabitManager({
        loadData: async file => files[file] ? clone(files[file]) : null,
        saveData: async (file, value) => { files[file] = clone(value); }
    });
    const created = await manager.createHabit({ title: '复习', startDate: date, target: 2, goalType: 'either', pomodoroTargetHours: 0, pomodoroTargetMinutes: 20 });
    await manager.updateHabit(created.id, { target: 3 });
    const value = await manager.getHabit(created.id);
    assert.equal(value.goalType, 'either');
    assert.equal(value.target, 3);
    assert.equal(value.pomodoroTargetMinutes, 20);
    await manager.updateHabit(created.id, { pomodoroTargetMinutes: 30 });
    assert.equal(files['habit.json'][created.id].target, 3);
    assert.equal(files['habit.json'][created.id].pomodoroTargetMinutes, 30);
});

test('无固定频率不进入待打卡和提醒计划，打卡后保留已完成记录', async () => {
    const value = habit(0, {
        goalType: 'count', target: 1, frequency: { type: 'none' },
        reminderTimes: ['09:30'], reminderTime: '09:30',
        reminderTimeModifications: { [date]: { reminderTimes: ['10:00'] } }
    });
    assert.equal(utils.shouldCheckInOnDate(value, date), false);
    assert.deepEqual(utils.getHabitReminderTimes(value), []);
    assert.deepEqual(utils.getHabitReminderTimesForDate(value, date), []);
    assert.deepEqual(utils.getTodayHabitBuckets([value], date), { dueHabits: [], pendingHabits: [], completedHabits: [] });
    const { buildReminderSchedule } = load('src/services/ReminderSchedule.ts');
    const schedule = await buildReminderSchedule({}, { habit: value }, {}, {}, new Date(`${date}T09:00:00`));
    assert.equal(schedule.times.size, 0);

    value.checkIns[date] = { count: 1, status: ['✅'], timestamp: `${date} 09:30:00` };
    const buckets = utils.getTodayHabitBuckets([value], date);
    assert.equal(buckets.dueHabits.length, 0);
    assert.equal(buckets.pendingHabits.length, 0);
    assert.deepEqual(buckets.completedHabits, [value]);
    assert.equal(utils.getHabitCompletedDaysCount(value), 1);
    assert.equal(utils.getHabitStreakDays(value, date), 0);
    for (const overrides of [{ abandoned: true }, { startDate: '2026-10-09' }, { endDate: '2026-10-07' }]) {
        assert.equal(utils.getTodayHabitBuckets([{ ...value, ...overrides }], date).completedHabits.length, 0);
    }
});

test('无固定频率在全部习惯可打卡，日历只展示实际记录', async () => {
    const value = habit(0, { goalType: 'count', target: 1, frequency: { type: 'none' }, reminderTimes: ['09:30'] });
    const { panel, calendar } = fixture(value, 0);
    panel.currentTab = 'all';
    assert.deepEqual(panel.applyFilter([value]), [value]);
    for (const tab of ['today', 'tomorrow', 'todayCompleted']) {
        panel.currentTab = tab;
        assert.deepEqual(panel.applyFilter([value]), []);
    }
    assert.equal(panel.getFrequencyText(value.frequency), 'freqNone');
    const empty = [];
    await calendar.addHabitEventsToList(empty, date, date);
    assert.equal(empty.length, 0);
    value.checkIns[date] = { count: 1, status: ['✅'], timestamp: `${date} 09:30:00` };
    const events = [];
    await calendar.addHabitEventsToList(events, date, '2026-10-09');
    assert.ok(events.some(event => event.extendedProps.type === 'habit'));
    assert.ok(events.some(event => event.extendedProps.type === 'habitCheckInTime'));
    assert.ok(events.every(event => event.extendedProps.date === date && event.extendedProps.type !== 'habitReminderTime'));
    panel.currentTab = 'todayCompleted';
    assert.deepEqual(panel.applyFilter([value]), [value]);
});

test('切换无固定频率并重新编辑保留历史，切回每天恢复计划', async () => {
    const { HabitEditDialog } = loadFrontend('src/components/dialog/HabitEditDialog.ts', {});
    const editor = Object.create(HabitEditDialog.prototype);
    const saved = [];
    const original = habit(1, { goalType: 'count', target: 1, frequency: { type: 'weekly', weekdays: [1] } });
    Object.assign(editor, { habit: original, onSave: async value => saved.push(value), dialog: { destroy() {} } });
    const values = { title: '理发', color: '#66bb6a', startDate: original.startDate, goalType: 'count', target: '1', frequencyType: 'none', interval: '3' };
    const form = { values, querySelectorAll: () => [] };
    for (const type of ['none', 'none', 'daily']) {
        values.frequencyType = type;
        await editor.handleSubmit(form, false, editor.habit.checkInEmojis, false);
        editor.habit = saved.at(-1);
        assert.deepEqual(editor.habit.checkIns, original.checkIns);
        assert.equal(editor.habit.id, original.id);
        assert.deepEqual(editor.habit.frequency, type === 'none' ? { type: 'none' } : { type: 'daily', interval: 3 });
    }
    assert.equal(utils.shouldCheckInOnDate(editor.habit, original.startDate), true);
});
