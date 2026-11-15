const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function methods(relative, names) {
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.find(ts.isClassDeclaration).members
        .filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
}
function compile(source) {
    return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const quickMethods = methods('src/components/dialog/QuickReminderDialog.ts', [
    'mountPomodoroTab', 'switchQuickDialogTab', 'updateQuickDialogSaveButtonState', 'saveReminder',
]);
function quickFixture({ date = '2026-11-14', time = '23:30', endDate = '2026-11-15', endTime = '01:00', mount } = {}) {
    const fields = new Map();
    const field = selector => {
        if (!fields.has(selector)) fields.set(selector, { value: '', style: {}, disabled: false });
        return fields.get(selector);
    };
    const calls = [], messages = [];
    const save = async () => { calls.push('saved'); };
    class Form {
        constructor(id) { assert.ok(id.startsWith('manual-')); }
        async mountAddSessionForm(panel, options) {
            calls.push({ panel, options });
            if (mount) await mount();
            return save;
        }
    }
    const Quick = new Function('PomodoroSessionsDialog', 'console', 'showMessage', 'i18n',
        compile(`class Quick { ${quickMethods} };`) + '; return Quick;')(Form, { error() {} }, text => messages.push(text), key => key);
    const view = Object.assign(new Quick(), {
        dialog: { element: { querySelector: field } },
        initialDate: date, initialTime: time, initialEndDate: endDate, initialEndTime: endTime,
        activeDialogTab: 'task', activeDetailTab: 'settings', allowPomodoroRecord: true,
        updateQuickDialogTabStyles() {}, applyReadOnlyMode() {},
        mountSubtasksTab: async () => {},
    });
    return { view, calls, messages, field };
}

test('切换补录页时延迟加载一次，预填跨午夜范围且保存任务草稿', async () => {
    const f = quickFixture();
    f.field('#quickReminderTitle').value = '任务草稿';
    assert.equal(f.calls.length, 0);
    await f.view.switchQuickDialogTab('pomodoro');
    assert.equal(f.calls.length, 1);
    const options = f.calls[0].options;
    assert.equal(options.startTime.getTime(), new Date('2026-11-14T23:30').getTime());
    assert.equal(options.endTime.getTime(), new Date('2026-11-15T01:00').getTime());
    assert.equal(options.saveButton, f.field('#quickConfirmBtn'));
    assert.equal(f.field('#quickTaskTabPanel').style.display, 'none');
    assert.equal(f.field('#quickPomodoroTabPanel').style.display, '');
    await f.view.switchQuickDialogTab('task');
    assert.equal(f.field('#quickReminderTitle').value, '任务草稿');
    assert.equal(f.field('#quickPomodoroTabPanel').style.display, 'none');
    await f.view.switchQuickDialogTab('pomodoro');
    assert.equal(f.calls.length, 1);
    await f.view.saveReminder();
    assert.deepEqual(f.calls.slice(1), ['saved']);
});

test('全天划选只使用所选日期，不把排他的结束日期作为整天时长', async () => {
    const f = quickFixture({ date: '2026-10-01', time: null, endDate: '2026-10-03', endTime: null });
    await f.view.switchQuickDialogTab('pomodoro');
    assert.equal(f.calls[0].options.startTime.getTime(), new Date('2026-10-01T09:00').getTime());
    assert.equal(f.calls[0].options.endTime, undefined);
});

test('慢速加载只阻止补录保存，切回任务可以继续，重复切换不重复挂载', async () => {
    let resolve;
    const gate = new Promise(yes => { resolve = yes; });
    const f = quickFixture({ mount: () => gate });
    const loading = f.view.switchQuickDialogTab('pomodoro');
    assert.equal(f.field('#quickConfirmBtn').disabled, true);
    await f.view.switchQuickDialogTab('task');
    assert.equal(f.field('#quickConfirmBtn').disabled, false);
    const loadingAgain = f.view.switchQuickDialogTab('pomodoro');
    assert.equal(f.calls.length, 1);
    resolve();
    await Promise.all([loading, loadingAgain]);
    assert.equal(f.field('#quickConfirmBtn').disabled, false);
});

test('加载失败后保留窗口，重新进入补录页可以重试', async () => {
    let fail = true;
    const f = quickFixture({ mount: () => { if (fail) throw new Error('load failed'); } });
    await f.view.switchQuickDialogTab('pomodoro');
    assert.deepEqual(f.messages, ['loadingFailed']);
    assert.equal(f.field('#quickConfirmBtn').disabled, true);
    assert.equal(f.view.pomodoroFormMount, undefined);
    fail = false;
    await f.view.switchQuickDialogTab('pomodoro');
    assert.equal(f.field('#quickConfirmBtn').disabled, false);
});

test('保存期间切换任务页仍阻止重复提交，加载期间快捷键不写入', async () => {
    const f = quickFixture();
    await f.view.switchQuickDialogTab('pomodoro');
    let resolve, writes = 0;
    f.view.savePomodoroSession = async () => { writes++; await new Promise(yes => { resolve = yes; }); };
    f.view.isFormInitializing = true;
    await f.view.saveReminder();
    assert.equal(writes, 0);
    f.view.isFormInitializing = false;
    const saving = f.view.saveReminder();
    await f.view.switchQuickDialogTab('task');
    await f.view.saveReminder();
    assert.equal(writes, 1);
    assert.equal(f.field('#quickConfirmBtn').disabled, true);
    resolve();
    await saving;
    assert.equal(f.field('#quickConfirmBtn').disabled, false);
});

const calendarMethods = methods('src/components/panel/CalendarView.ts', ['handleDateSelect', 'createQuickReminder']);
function calendarFixture() {
    const dialogs = [];
    class Quick {
        constructor(...args) { this.args = args; dialogs.push(this); }
        show() { this.shown = true; }
    }
    const dateStr = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dateTime = date => ({ dateStr: dateStr(date), timeStr: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` });
    const Calendar = new Function('QuickReminderDialog', 'getLocalDateTime', 'getLocalDateString',
        compile(`class Calendar { ${calendarMethods} };`) + '; return Calendar;')(Quick, dateTime, dateStr);
    let unselected = 0;
    const view = Object.assign(new Calendar(), {
        calendar: { unselect() { unselected++; }, view: { type: 'timeGridWeek' } },
        currentProjectFilter: new Set(['project']), currentCategoryFilter: new Set(['category']),
        plugin: {}, forceHideTooltip() {}, isClickInAllDayArea: () => false,
    });
    return { view, dialogs, unselected: () => unselected };
}

test('日历定时与全天划选均开放补录页，保留原有任务日期和筛选默认值', () => {
    const f = calendarFixture();
    f.view.handleDateSelect({ start: new Date('2026-11-14T23:30'), end: new Date('2026-11-15T01:00'), allDay: false });
    const args = f.dialogs[0].args;
    assert.deepEqual(args.slice(0, 2), ['2026-11-14', '23:30']);
    assert.deepEqual(args[3], { isTimeRange: true, endDate: '2026-11-15', endTime: '01:00' });
    assert.equal(args[4].allowPomodoroRecord, true);
    assert.equal(args[4].defaultProjectId, 'project');
    f.view.handleDateSelect({ start: new Date('2026-11-14T00:00'), end: new Date('2026-11-15T00:00'), allDay: true });
    assert.equal(f.dialogs[1].args[1], null);
    assert.equal(f.dialogs[1].args[3].endDate, '2026-11-14');
    assert.equal(f.dialogs[1].args[4].allowPomodoroRecord, true);
    assert.equal(f.unselected(), 2);
});

test('日历双击也开放补录页，习惯专用日历保持原有划选限制', () => {
    const f = calendarFixture();
    f.view.createQuickReminder({ date: new Date('2026-11-14T10:00'), allDay: false });
    assert.equal(f.dialogs[0].args[4].allowPomodoroRecord, true);
    f.view.openedFromHabitPanel = true;
    f.view.handleDateSelect({});
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.unselected(), 1);
});
