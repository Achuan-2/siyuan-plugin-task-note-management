const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const { ReminderTaskLogic } = createKernelLoader()('src/utils/reminderTaskLogic.ts');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
function members(file, className, names) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    const selected = cls.members.filter(node => names.includes(node.name?.getText(ast)));
    assert.equal(selected.length, names.length);
    return compile(`class ${className} { ${selected.map(node => node.getText(ast)).join('\n')} }`);
}
class Element {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; this.listeners = {}; this.isConnected = true; this.value = ''; }
    append(...elements) { this.children.push(...elements); }
    appendChild(element) { this.append(element); return element; }
    replaceChildren(...elements) { this.children = elements; this.textContent = ''; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
}
const pickerCode = compile(fs.readFileSync(path.join(root, 'src/components/dialog/PomodoroTaskPicker.ts'), 'utf8'));
function pickerFixture() {
    const notices = [], selected = [];
    const data = {
        a: { id: 'a', title: '<b>写作</b>', date: '2026-11-16', completed: false, projectId: 'p' },
        b: { id: 'b', title: '阅读', completed: false },
        done: { id: 'done', title: '完成', completed: true },
        abandoned: { id: 'abandoned', title: '放弃', kanbanStatus: 'abandoned' },
        custom: { id: 'custom', title: '完成状态', kanbanStatus: 'completed' }
    };
    const plugin = { loadProjectData: async () => ({ p: { name: '研究项目' } }) };
    const exports = {};
    new Function('require', 'exports', 'document', pickerCode)(name => {
        if (name === 'siyuan') return { showMessage: (...args) => notices.push(args) };
        if (name.endsWith('/pluginInstance')) return { i18n: key => key };
        if (name.endsWith('/dateUtils')) return { getLogicalDateString: () => '2026-11-16' };
        if (name.endsWith('/reminderLoadUtils')) return { getEnvironmentSafeAllReminders: async () => structuredClone(data) };
        if (name.endsWith('/reminderTaskLogic')) return { ReminderTaskLogic };
        throw new Error(name);
    }, exports, { createElement: () => new Element() });
    return { ...exports, container: new Element(), plugin, data, notices, selected };
}

test('选择列表只列出未完成任务，支持按标题和项目搜索并以文本显示任务标题', async () => {
    const view = pickerFixture();
    await view.mountPomodoroTaskPicker(view.container, view.plugin, async task => view.selected.push(task));
    const [search, list] = view.container.children;
    assert.equal(list.children.length, 2);
    assert.equal(list.children[0].children[0].textContent, '<b>写作</b>');
    search.value = '研究项目'; search.listeners.input();
    assert.equal(list.children.length, 1);
    search.value = '阅读'; search.listeners.input();
    assert.equal(list.children.length, 1);
    await list.children[0].listeners.click();
    assert.equal(view.selected[0].id, 'b');
});

test('任务在弹窗打开后已完成或删除时拒绝绑定，刷新列表且保留弹窗', async () => {
    for (const remove of [false, true]) {
        const view = pickerFixture();
        await view.mountPomodoroTaskPicker(view.container, view.plugin, async task => view.selected.push(task));
        if (remove) delete view.data.a; else view.data.a.completed = true;
        await view.container.children[1].children[0].listeners.click();
        assert.equal(view.selected.length, 0);
        assert.equal(view.notices[0][0], 'pomodoroTaskUnavailable');
        assert.equal(view.container.children[1].children.length, 1);
    }
});

test('空列表和无匹配搜索显示空状态，不创建新任务', async () => {
    const view = pickerFixture();
    await view.mountPomodoroTaskPicker(view.container, view.plugin, async () => assert.fail('No selection expected'));
    view.container.children[0].value = 'does not exist';
    view.container.children[0].listeners.input();
    assert.equal(view.container.children[1].textContent, 'noAllUncompletedReminders');
});

const timerCode = members('src/components/panel/PomodoroTimer.ts', 'PomodoroTimer', ['bindTaskToTimer', 'openTaskEditDialog']);
function timerFixture({ existing = false } = {}) {
    const dialogs = [], updates = [], events = [];
    const task = { id: 'existing', title: '已有任务', projectId: 'p', blockId: 'block' };
    class QuickReminderDialog {
        constructor(date, time, saved, range, options) { Object.assign(this, { saved, options }); dialogs.push(this); }
        async show() {}
        async enableTaskSelection(selected, initial) { Object.assign(this, { selected, initial }); }
    }
    const Timer = new Function('require', 'window', 'i18n', 'document', 'CustomEvent', `${timerCode}; return PomodoroTimer;`)(
        () => ({ QuickReminderDialog }), { focus() {}, dispatchEvent: event => events.push(event.type) }, key => key,
        {}, class { constructor(type) { this.type = type; } }
    );
    const timer = Object.assign(new Timer(), {
        reminder: existing ? task : { id: 'pomodoro-standalone', title: '番茄专注' },
        isWindowClosed: false, isRunning: true, isPaused: true, timeLeft: 765, phaseStartTime: 123,
        activeWorkSessionId: 'session',
        recordManager: { updateSessionTask: async (...args) => { updates.push(args); return true; } },
        plugin: { loadReminderData: async () => ({ existing: task }) },
        container: { webContents: {}, isDestroyed: () => false },
        updateBrowserWindowDisplay: () => {}, updateStatsDisplay: () => {}
    });
    return { timer, task, dialogs, updates, events };
}

test('独立番茄钟标题弹窗提供创建任务和选择未完成任务入口，默认选择已有任务', async () => {
    const view = timerFixture();
    await view.timer.openTaskEditDialog();
    const dialog = view.dialogs[0];
    assert.equal(dialog.options.mode, 'quick');
    assert.equal(dialog.options.reminder, undefined);
    assert.equal(dialog.initial, true);
    await dialog.selected(view.task);
    assert.equal(view.timer.reminder.id, 'existing');
    assert.deepEqual(view.updates, [['session', 'existing', '已有任务']]);
    assert.equal(view.timer.timeLeft, 765);
    assert.equal(view.timer.phaseStartTime, 123);
    assert.equal(view.timer.isRunning, true);
    assert.equal(view.timer.isPaused, true);
});

test('已有任务仍可编辑，并提供选择其他未完成任务页签', async () => {
    const view = timerFixture({ existing: true });
    await view.timer.openTaskEditDialog();
    assert.equal(view.dialogs[0].options.mode, 'edit');
    assert.equal(view.dialogs[0].initial, false);
    await view.dialogs[0].saved({ ...view.task, title: '新标题' });
    assert.equal(view.timer.reminder.title, '新标题');
    assert.equal(view.updates[0][2], '新标题');
});

test('会话记录尚在创建时等待原记录，不另建记录；保存失败不更换当前任务', async () => {
    const view = timerFixture();
    let resolve;
    view.timer.activeWorkSessionId = null;
    view.timer.activeWorkSessionStartPromise = new Promise(done => { resolve = done; });
    const operation = view.timer.bindTaskToTimer(view.task);
    assert.equal(view.updates.length, 0);
    resolve('pending-session'); await operation;
    assert.equal(view.updates[0][0], 'pending-session');
    view.timer.recordManager.updateSessionTask = async () => false;
    const previous = view.timer.reminder;
    await assert.rejects(view.timer.bindTaskToTimer({ id: 'other', title: 'Other' }));
    assert.equal(view.timer.reminder, previous);
});

const dialogCode = members('src/components/dialog/QuickReminderDialog.ts', 'QuickReminderDialog', [
    'switchQuickDialogTab', 'enableTaskSelection', 'updateQuickDialogTabStyles'
]);
test('切换任务选择页签隐藏表单和保存删除操作，切回时恢复原任务表单', async () => {
    const elements = Object.fromEntries(['quickTaskTabPanel','quickSubtasksTabPanel','quickSubtasksTab',
        'quickReminderTabs','quickCurrentTaskTab','quickConfirmBtn','quickDeleteBtn','quickSelectTaskPanel',
        '.b3-dialog__content'].map(id => [id, new Element()]));
    const Dialog = new Function('i18n', 'document', `${dialogCode}; return QuickReminderDialog;`)(
        key => key, { createElement: () => new Element() });
    let mounted = 0;
    const dialog = Object.assign(new Dialog(), {
        dialog: { element: { querySelector: selector => elements[selector.replace(/^#/, '')] || null } },
        mountTaskSelectionTab: async () => { mounted++; }, applyReadOnlyMode() {}
    });
    await dialog.enableTaskSelection(async () => {}, true);
    assert.equal(dialog.activeDialogTab, 'select-task');
    assert.equal(elements.quickTaskTabPanel.style.display, 'none');
    assert.equal(elements.quickConfirmBtn.style.display, 'none');
    assert.equal(elements.quickDeleteBtn.style.display, 'none');
    assert.equal(mounted, 1);
    await dialog.switchQuickDialogTab('task');
    assert.equal(elements.quickTaskTabPanel.style.display, '');
    assert.equal(elements.quickConfirmBtn.style.display, '');
});
