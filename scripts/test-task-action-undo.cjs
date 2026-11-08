// Run with: node --test scripts/test-task-action-undo.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const loadTaskActionUndo = require('./lib/task-action-undo.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '..');

function element(tag) {
    return {
        tag, children: [], listeners: {}, attributes: {}, hovered: false,
        append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); },
        remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        matches() { return this.hovered; },
        contains(node) { return this === node || this.children.some(child => child.contains(node)); },
        fire(name) { return this.listeners[name]?.(); },
    };
}

function fixture(initial = {}) {
    const state = { data: clone(initial), writes: 0, events: [], blocks: [], notifications: [], messages: [], reads: [], localReads: [] };
    const timers = new Map();
    let timerId = 0;
    const document = { body: element('body'), createElement: element, activeElement: null };
    const dependencies = {
        document,
        window: { dispatchEvent: event => state.events.push(event) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        i18n: key => key,
        showMessage: (...args) => state.messages.push(args),
        updateBindBlockAtrrs: async id => state.blocks.push(id),
        async getAllReminders(_plugin, ...args) { state.reads.push(args); return clone(state.data); },
        async saveReminders(_plugin, data) {
            if (state.failWrite) throw new Error('write failed');
            state.data = clone(data); state.writes++;
        },
    };
    const undoModule = loadTaskActionUndo(dependencies);
    const plugin = {
        async loadReminderData(force) {
            state.localReads.push(force);
            return clone(Object.fromEntries(Object.entries(state.data).filter(([, task]) => !task.isSubscribed)));
        },
        async saveReminderData(data) {
            if (state.failWrite) throw new Error('write failed');
            const subscriptions = Object.fromEntries(Object.entries(state.data).filter(([, task]) => task.isSubscribed));
            state.data = { ...subscriptions, ...clone(data) };
            state.writes++;
        },
        updateBadges() {},
        updateMobileNotification: async task => state.notifications.push(task.id),
        cancelMobileNotification: async id => state.notifications.push(`cancel:${id}`),
    };
    return { ...undoModule, state, timers, document, dependencies, plugin,
        action: () => new undoModule.TaskActionUndo(plugin, state.data) };
}

test('完成父子任务后恢复完成时间、进度和原状态，保留其他项目新任务及后续标题编辑', async () => {
    const before = {
        parent: { id: 'parent', title: 'parent', completed: false, customProgress: 35, blockId: 'p' },
        child: { id: 'child', parentId: 'parent', completed: false, customProgress: 60, blockId: 'c' },
    };
    const f = fixture(before), action = f.action();
    for (const task of Object.values(f.state.data)) Object.assign(task, { completed: true, completedTime: '2026-11-08 12:00:00', customProgress: 100 });
    await action.save(f.state.data);
    f.state.data.parent.title = 'edited';
    f.state.data.other = { id: 'other', projectId: 'B' };
    assert.equal(await action.undo(), true);
    assert.deepEqual(f.state.data, { ...before, parent: { ...before.parent, title: 'edited' }, other: { id: 'other', projectId: 'B' } });
    assert.deepEqual(new Set(f.state.blocks), new Set(['p', 'c']));
    assert.deepEqual(new Set(f.state.notifications), new Set(['parent', 'child']));
    assert.equal(f.state.events.at(-1).type, 'reminderUpdated');
    assert.deepEqual(f.state.reads, []);
    assert.deepEqual(f.state.localReads, [undefined]);
    assert.deepEqual(f.state.events.at(-1).detail, { taskUndo: true, refreshDelayMs: 0 });
    assert.equal(await action.undo(), false);
});

test('删除系列及子任务并保留完成实例后，撤回恢复系列并移除本次生成的独立记录', async () => {
    const before = {
        series: { id: 'series', repeat: { enabled: true, type: 'daily', instances: { '2026-11-01': { completed: true } } } },
        child: { id: 'child', parentId: 'series' },
    };
    const f = fixture(before), action = f.action();
    await action.save({ kept: { id: 'kept', completed: true } });
    f.state.data.newTask = { id: 'newTask' };
    assert.equal(await action.undo(), true);
    assert.deepEqual(f.state.data, { ...before, newTask: { id: 'newTask' } });
    assert.ok(f.state.notifications.includes('cancel:kept'));
});

test('重复实例状态和今日忽略可恢复，保留未被修改的日期记录', async () => {
    const before = { series: { id: 'series', repeat: { enabled: true, instances: {
        '2026-11-07': { completed: true }, '2026-11-08': { kanbanStatus: 'waiting', note: 'note' },
    } }, todayIgnored: ['2026-11-01'] } };
    const f = fixture(before), action = f.action();
    f.state.data.series.repeat.instances['2026-11-08'].kanbanStatus = 'abandoned';
    f.state.data.series.todayIgnored.push('2026-11-08');
    await action.save(f.state.data);
    f.state.data.series.repeat.instances['2026-11-09'] = { title: 'future' };
    assert.equal(await action.undo(), true);
    before.series.repeat.instances['2026-11-09'] = { title: 'future' };
    assert.deepEqual(f.state.data, before);
});

test('任务状态或已删除任务的 ID 被再次修改时，拒绝整次撤回且不写盘', async () => {
    const f = fixture({ p: { id: 'p', completed: false }, c: { id: 'c', completed: false } });
    const action = f.action();
    await action.save({ p: { id: 'p', completed: true }, c: { id: 'c', completed: true } });
    f.state.data.p.completed = false;
    assert.equal(await action.undo(), false);
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.data.c.completed, true);
    assert.equal(f.state.messages.at(-1)[0], 'taskUndoConflict');
    const deletion = f.action();
    await deletion.save({ c: f.state.data.c });
    f.state.data.p = { id: 'p', title: 'another task' };
    assert.equal(await deletion.undo(), false);
    assert.equal(f.state.data.p.title, 'another task');
});

test('写盘失败不显示撤回，无变化不显示提示', async () => {
    const f = fixture({ task: { id: 'task', completed: false } }), action = f.action();
    f.state.failWrite = true;
    await assert.rejects(action.save({}), /write failed/);
    action.show('deleted');
    assert.equal(f.document.body.children.length, 0);
    f.state.failWrite = false;
    const unchanged = f.action();
    await unchanged.save(f.state.data);
    unchanged.show('unchanged');
    assert.equal(f.timers.size, 0);
});

test('提示保留 6 秒，悬停和聚焦暂停计时，新提示替换旧提示且卸载清理', async () => {
    const f = fixture({ task: { id: 'task' } }), action = f.action();
    await action.save({}); action.show('deleted');
    let toast = f.document.body.children[0];
    assert.equal(toast.children[1].attributes['aria-label'], 'undoTaskAction');
    assert.equal([...f.timers.values()][0].delay, 6000);
    toast.hovered = true; toast.fire('mouseenter');
    assert.equal(f.timers.size, 0);
    toast.hovered = false; toast.fire('mouseleave');
    assert.equal(f.timers.size, 1);
    f.document.activeElement = toast.children[1]; toast.fire('focusin');
    assert.equal(f.timers.size, 0);
    f.document.activeElement = null; toast.fire('focusout');
    assert.equal(f.timers.size, 1);
    const next = f.action(); await next.save({ task: { id: 'task' } }); next.show('restored');
    assert.equal(f.document.body.children.length, 1);
    assert.notEqual(f.document.body.children[0], toast);
    assert.equal(f.timers.size, 1);
    f.dismissTaskUndo(f.plugin);
    assert.equal(f.document.body.children.length, 0);
    assert.equal(f.timers.size, 0);
    f.plugin.storageDisposed = true;
    next.show('late');
    assert.equal(f.document.body.children.length, 0);
});

test('点击撤回防止重复提交，失败后可重试，成功关闭提示', async () => {
    const f = fixture({ task: { id: 'task' } }), action = f.action();
    await action.save({}); action.show('deleted');
    const button = f.document.body.children[0].children[1];
    f.state.failWrite = true;
    const error = console.error; console.error = () => {};
    try { await button.fire('click'); } finally { console.error = error; }
    assert.equal(button.disabled, false);
    assert.equal(f.state.messages.at(-1)[0], 'taskUndoFailed');
    f.state.failWrite = false;
    const pending = button.fire('click');
    await button.fire('click');
    await pending;
    assert.equal(f.state.writes, 2);
    assert.deepEqual(f.state.data, { task: { id: 'task' } });
    assert.equal(f.document.body.children.length, 0);
    assert.equal(f.timers.size, 0);
});

test('超时清理提示，读取失败时保留数据且不写盘', async () => {
    const f = fixture({ task: { id: 'task' } }), action = f.action();
    await action.save({}); action.show('deleted');
    [...f.timers.values()][0].callback();
    assert.equal(f.document.body.children.length, 0);
    assert.equal(f.timers.size, 0);
    f.plugin.loadReminderData = async () => { throw new Error('read failed'); };
    await assert.rejects(action.undo(), /read failed/);
    assert.equal(f.state.writes, 1);
    assert.deepEqual(f.state.data, {});
});

test('本地删除和撤回不扫描或写入订阅，仍保留最新本地任务及订阅数据', async () => {
    const subscribed = { id: 'sub', isSubscribed: true, subscriptionId: 'feed', title: 'subscription' };
    const task = { id: 'task', title: 'local task' };
    const f = fixture({ task, sub: subscribed }), action = f.action();
    f.dependencies.getAllReminders = async () => { throw new Error('unexpected subscription read'); };
    f.dependencies.saveReminders = async () => { throw new Error('unexpected subscription write'); };
    await action.save({ sub: subscribed });
    f.state.data.newTask = { id: 'newTask', projectId: 'B' };
    assert.equal(await action.undo(), true);
    assert.deepEqual(f.state.data, { task, sub: subscribed, newTask: { id: 'newTask', projectId: 'B' } });
    assert.deepEqual(f.state.localReads, [undefined]);
});

test('订阅任务撤回仍使用严格全量读取和订阅保存', async () => {
    const before = { task: { id: 'task', isSubscribed: true, subscriptionId: 'feed', completed: false } };
    const f = fixture(before), action = f.action();
    let subscriptionWrites = 0;
    const save = f.dependencies.saveReminders;
    f.dependencies.saveReminders = async (...args) => { subscriptionWrites++; await save(...args); };
    await action.save({ task: { ...before.task, completed: true } });
    assert.equal(await action.undo(), true);
    assert.equal(subscriptionWrites, 2);
    assert.deepEqual(f.state.reads.at(-1), [undefined, true, undefined, { strict: true }]);
    assert.deepEqual(f.state.localReads, []);
    assert.deepEqual(f.state.data, before);
});

test('绑定块、徽章和通知仍未返回时，撤回已保存并立即关闭提示', async () => {
    const f = fixture({ task: { id: 'task', blockId: 'bound' } }), action = f.action();
    await action.save({}); action.show('deleted');
    let release, finished = false, effects = 0;
    const pendingEffect = new Promise(resolve => { release = resolve; });
    const slowEffect = () => { effects++; return pendingEffect; };
    f.dependencies.updateBindBlockAtrrs = slowEffect;
    f.plugin.updateBadges = slowEffect;
    f.plugin.updateMobileNotification = slowEffect;
    const click = f.document.body.children[0].children[1].fire('click').then(() => { finished = true; });
    try {
        for (let i = 0; i < 30; i++) await Promise.resolve();
        assert.equal(effects, 3);
        assert.equal(finished, true);
        assert.equal(f.document.body.children.length, 0);
        assert.equal(f.state.messages.at(-1)[0], 'taskActionUndone');
        assert.deepEqual(f.state.data, { task: { id: 'task', blockId: 'bound' } });
    } finally {
        release();
        await click;
    }
});

test('侧栏撤回立即排队刷新且不重读番茄记录，普通通知保持原行为', async () => {
    const file = 'src/components/panel/ReminderPanel.ts';
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(ts.isClassDeclaration);
    const constructor = declaration.members.find(ts.isConstructorDeclaration);
    const assignment = constructor.body.statements.find(statement =>
        ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) &&
        statement.expression.left.getText(source) === 'this.reminderUpdatedHandler');
    const code = ts.transpileModule(`class Panel { constructor() { ${assignment.getText(source)} } }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const f = fixture();
    const Panel = new Function('window', 'clearTimeout', code + '; return Panel;')(
        { setTimeout: f.dependencies.setTimeout }, f.dependencies.clearTimeout,
    );
    let loads = 0, statisticsReads = 0;
    const panel = Object.assign(new Panel(), {
        panelId: 'panel', loadReminders: () => { loads++; },
        pomodoroRecordManager: { refreshData: async () => { statisticsReads++; } },
    });
    panel.reminderUpdatedHandler({ detail: { taskUndo: true, refreshDelayMs: 0 } });
    const immediate = [...f.timers.values()][0];
    assert.equal(immediate.delay, 0);
    await immediate.callback();
    assert.equal(loads, 1);
    assert.equal(statisticsReads, 0);
    f.timers.clear();
    panel.reminderUpdatedHandler({ detail: {} });
    const normal = [...f.timers.values()][0];
    assert.equal(normal.delay, 100);
    await normal.callback();
    assert.equal(loads, 2);
    assert.equal(statisticsReads, 1);
});

function extract(file, className, names) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const members = className ? source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className).members : source.statements;
    return members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source).replace(/^export /, '')).join('\n');
}
function compileView(f, file, className, methods) {
    const repeat = extract('src/components/dataManager/repeatUtils.ts', null, [
        'ensureRepeatInstances', 'getRepeatInstanceState', 'setRepeatInstanceCompletion', 'getInstanceField',
        'parseReminderInstanceId',
    ]);
    const globals = { ...f.dependencies, TaskActionUndo: f.TaskActionUndo,
        getTaskStatusUndoMessage: f.getTaskStatusUndoMessage,
        getLocalDateTimeString: () => '2026-11-08 12:00:00', getLocalDateString: () => '2026-11-08' };
    const code = ts.transpileModule(`${repeat}\nclass View { ${extract(file, className, methods)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const View = new Function(...Object.keys(globals), code + ';return View;')(...Object.values(globals));
    return Object.assign(new View(), {
        plugin: f.plugin, panelId: 'sidebar', allRemindersMap: new Map(),
        getDescendantIdsFromCache: () => [], applyOptimisticCompletionForIds() {},
        normalizeCustomProgress: value => value, isTodayLikeView: () => false,
        loadReminders: async () => {}, getReminders: () => f.dependencies.getAllReminders(),
        dispatchReminderUpdate() {}, queueLoadTasks: async () => {}, refreshRecurringMobileNotifications: async () => {},
    });
}

test('真实侧栏完成入口：父子联动完成可一并撤回', async () => {
    const before = { p: { id: 'p', completed: false, customProgress: 20 }, c: { id: 'c', parentId: 'p', completed: false } };
    const f = fixture(before);
    const panel = compileView(f, 'src/components/panel/ReminderPanel.ts', 'ReminderPanel', ['toggleReminder', 'completeAllChildTasks', 'syncCustomProgressOnCompletion']);
    await panel.toggleReminder('p', true);
    assert.equal(f.state.data.c.completed, true);
    assert.equal(f.state.data.p.customProgress, 100);
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, before);
});

test('真实侧栏重复实例入口：撤回只恢复对应日期及 ghost 子任务', async () => {
    const before = { p: { id: 'p', repeat: { enabled: true, type: 'daily' } }, c: { id: 'c', parentId: 'p' } };
    const f = fixture(before);
    const panel = compileView(f, 'src/components/panel/ReminderPanel.ts', 'ReminderPanel', ['toggleReminder', 'completeAllChildTasks']);
    await panel.toggleReminder('p', true, true, '2026-11-08');
    assert.equal(f.state.data.c.repeat.instances['2026-11-08'].completed, true);
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, before);
});

test('两个视图的真实实例删除入口都能恢复 excludeDates', async () => {
    for (const className of ['ReminderPanel', 'ProjectKanbanView']) {
        const before = { p: { id: 'p', repeat: { enabled: true, excludeDates: ['2026-11-01'] } } };
        const f = fixture(before);
        const view = compileView(f, `src/components/panel/${className}.ts`, className, ['addExcludedDate']);
        const action = await view.addExcludedDate('p', '2026-11-08');
        assert.deepEqual(f.state.data.p.repeat.excludeDates, ['2026-11-01', '2026-11-08']);
        assert.equal(await action.undo(), true);
        assert.deepEqual(f.state.data, before);
    }
});

test('真实看板放弃入口：撤回恢复旧状态、完成时间和进度', async () => {
    const before = { p: { id: 'p', completed: true, completedTime: '2026-11-07 12:00:00', customProgress: 100, kanbanStatus: 'waiting' } };
    const f = fixture(before);
    const view = compileView(f, 'src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', ['changeTaskStatus']);
    Object.assign(view, {
        getTaskStatus: task => task.completed ? 'completed' : task.kanbanStatus,
        isAbandonedStatus: status => status === 'abandoned', getAllDescendantIds: () => [],
    });
    await view.changeTaskStatus(clone(before.p), 'abandoned');
    assert.equal(f.state.data.p.kanbanStatus, 'abandoned');
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, before);
});

test('真实侧栏删除入口：父子任务恢复，保留删除后创建的任务', async () => {
    const before = { p: { id: 'p', title: 'parent' }, c: { id: 'c', parentId: 'p' } };
    const f = fixture(before);
    const panel = compileView(f, 'src/components/panel/ReminderPanel.ts', 'ReminderPanel', [
        'performDeleteReminder', 'buildChildrenIndex', 'collectDescendantIds', 'buildInstanceKeysIndex',
    ]);
    Object.assign(panel, { removeReminderFromDOM() {}, updateParentProgressBar() {} });
    await panel.performDeleteReminder('p');
    assert.deepEqual(f.state.data, {});
    f.state.data.newTask = { id: 'newTask' };
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, { ...before, newTask: { id: 'newTask' } });
});

test('真实看板拖到已完成任务前：状态和排序可一并撤回', async () => {
    const before = {
        p: { id: 'p', projectId: 'A', completed: false, kanbanStatus: 'doing', sort: 0 },
        target: { id: 'target', projectId: 'A', completed: true, completedTime: '2026-11-07 12:00:00', sort: 10 },
    };
    const f = fixture(before);
    const view = compileView(f, 'src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', ['reorderTasks']);
    Object.assign(view, {
        projectId: 'A', tasks: [], kanbanMode: 'status',
        getTaskStatus: task => task.completed ? 'completed' : task.kanbanStatus,
        getAllDescendantIds: () => [], syncCustomProgressOnCompletion() {},
        reorderTasksDOM: () => true, refreshTaskElement() {},
    });
    assert.equal(await view.reorderTasks(clone(before.p), clone(before.target), true), true);
    assert.equal(f.state.data.p.completed, true);
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, before);
});
