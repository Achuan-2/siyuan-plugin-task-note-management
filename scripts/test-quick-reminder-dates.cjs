// Run with: pnpm exec node --test scripts/test-quick-reminder-dates.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const relative = 'src/components/dialog/QuickReminderDialog.ts';
const source = ts.createSourceFile(relative, fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'),
    ts.ScriptTarget.Latest, true);
const method = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'QuickReminderDialog')
    .members.find(node => node.name?.getText(source) === 'saveReminder').getText(source);
const code = ts.transpileModule(`class DateDialog { ${method} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(mode, values = {}) {
    const state = { callbacks: [], saves: [], messages: [], errors: [], closed: false };
    const dependencies = {
        i18n: key => key, showMessage: message => state.messages.push(message),
        getLogicalDateString: () => '2026-11-13',
        compareDateStrings: (a, b) => a.localeCompare(b),
        window: { dispatchEvent() {} }, CustomEvent: class {},
        console: { error: (...args) => state.errors.push(args), warn: (...args) => state.errors.push(args) },
    };
    const DateDialog = new Function(...Object.keys(dependencies), `${code}; return DateDialog;`)(...Object.values(dependencies));
    const fields = Object.fromEntries(Object.entries({
        quickReminderTitle: '人大代表选举', quickProjectSelector: '',
        quickReminderDate: '2026-11-16', quickReminderEndDate: '',
        quickReminderTime: '07:30', quickReminderEndTime: '09:40', ...values,
    }).map(([id, value]) => [`#${id}`, { value }]));
    const reminder = { id: 'task', title: '原任务', kanbanStatus: 'short_term' };
    const dialog = Object.assign(new DateDialog(), {
        mode, reminder: mode === 'edit' ? reminder : undefined,
        selectedCategoryIds: [], selectedTagIds: [], customTimes: [], tempSubtasks: [],
        currentKanbanStatuses: [{ id: 'short_term' }], repeatConfig: { enabled: false },
        dialog: { element: { querySelector: selector => fields[selector] || null } },
        filterKanbanStatusesBySelectedGroup: statuses => statuses,
        getEstimatedPomodoroDurationValue() {}, getCustomProgressValue() {},
        validateCustomReminderTimes: () => true,
        applyStartDateOnlyOverdueOverride() {}, applyReminderSkipDateOverrides() {}, applyCompletedInstanceSnapshots() {},
        plugin: {
            loadReminderData: async () => mode === 'edit' ? { task: structuredClone(reminder) } : {},
            saveReminderData: async data => state.saves.push(structuredClone(data)),
            updateMobileNotification: async () => {},
        },
        onSaved: task => state.callbacks.push(structuredClone(task)),
        destroyDialog: () => { state.closed = true; },
    });
    const save = async () => {
        await dialog.saveReminder();
        // 保存入口先回调再异步持久化；等待内存中的后台保存和通知结束。
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(state.errors, []);
    };
    return { dialog, state, save };
}

for (const mode of ['quick', 'edit', 'batch_edit']) {
    test(`${mode}：只有开始日期和起止时间可保存，回调与持久化保留空结束日期`, async () => {
        const f = fixture(mode);
        await f.save();
        assert.deepEqual(f.state.messages, []);
        assert.equal(f.state.closed, true);
        assert.equal(f.state.callbacks.length, 1);
        const tasks = [...f.state.callbacks, ...f.state.saves.map(data => Object.values(data)[0])];
        if (mode !== 'batch_edit') assert.ok(f.state.saves.length > 0);
        for (const task of tasks) {
            assert.equal(task.date, '2026-11-16');
            assert.equal(task.time, '07:30');
            assert.equal(task.endTime, '09:40');
            assert.ok(!task.endDate);
        }
    });

    for (const [label, values, message] of [
        ['同日结束时间早于开始时间', { quickReminderEndTime: '07:00' }, 'endDateCannotBeEarlier'],
        ['完全没有日期却设置起止时间', { quickReminderDate: '' }, 'timeRequiresDate'],
        ['完全没有日期却只设置结束时间', { quickReminderDate: '', quickReminderTime: '' }, 'timeRequiresDate'],
        ['开始时间没有开始日期', { quickReminderDate: '', quickReminderEndDate: '2026-11-17' }, 'timeRequiresDate'],
    ]) {
        test(`${mode}：${label}仍拦截，不关闭弹窗也不保存`, async () => {
            const f = fixture(mode, values);
            await f.save();
            assert.deepEqual(f.state.messages, [message]);
            assert.equal(f.state.closed, false);
            assert.deepEqual(f.state.callbacks, []);
            assert.deepEqual(f.state.saves, []);
        });
    }

    test(`${mode}：显式跨日时间段允许结束时间早于开始时间`, async () => {
        const f = fixture(mode, { quickReminderEndDate: '2026-11-17', quickReminderEndTime: '06:00' });
        await f.save();
        assert.deepEqual(f.state.messages, []);
        assert.equal(f.state.callbacks[0].endDate, '2026-11-17');
        assert.equal(f.state.callbacks[0].endTime, '06:00');
    });
}

test('重复任务：同日时间段无需补填结束日期即可保存配置', async () => {
    const f = fixture('batch_edit');
    f.dialog.repeatConfig = { enabled: true, type: 'daily' };
    await f.save();
    assert.deepEqual(f.state.messages, []);
    assert.equal(f.state.callbacks[0].repeat.type, 'daily');
    assert.equal(f.state.callbacks[0].endTime, '09:40');
    assert.ok(!f.state.callbacks[0].endDate);
});
