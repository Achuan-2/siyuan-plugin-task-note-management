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
    const state = { data: clone(initial), writes: 0, events: [], blocks: [], notifications: [], messages: [], reads: [], localReads: [], confirmations: [] };
    const timers = new Map();
    const listeners = new Map();
    let timerId = 0;
    const document = { body: element('body'), createElement: element, activeElement: null };
    const dependencies = {
        document,
        window: {
            addEventListener(name, handler) {
                if (!listeners.has(name)) listeners.set(name, new Set());
                listeners.get(name).add(handler);
            },
            removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
            dispatchEvent(event) {
                state.events.push(event);
                for (const handler of listeners.get(event.type) || []) handler(event);
            },
        },
        confirm(_title, _message, accept) {
            const pending = Promise.resolve().then(accept);
            state.confirmations.push(pending);
            return pending;
        },
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
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
    return { ...undoModule, state, timers, listeners, document, dependencies, plugin,
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

test('同一撤回记录不能重复或并发提交，失败后可重试且仍能撤回', async () => {
    const f = fixture({ task: { id: 'task' } }), action = f.action();
    f.state.failWrite = true;
    await assert.rejects(action.save({}), /write failed/);
    f.state.failWrite = false;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const save = f.plugin.saveReminderData;
    f.plugin.saveReminderData = async data => { await gate; await save(data); };
    const first = action.save({});
    await assert.rejects(action.save({ unexpected: { id: 'unexpected' } }), /only commit one operation/);
    release();
    await first;
    await assert.rejects(action.save({}), /only commit one operation/);
    assert.equal(f.state.writes, 1);
    assert.equal(await action.undo(), true);
    assert.deepEqual(f.state.data, { task: { id: 'task' } });
});

test('共享实例操作拒绝缺失任务和非周期任务，不产生写入或撤回提示', async () => {
    const f = fixture({ plain: { id: 'plain' } });
    await assert.rejects(f.saveExcludedTaskInstance(f.plugin, f.state.data, 'missing', '2026-11-08'), /originalEventMissing/);
    await assert.rejects(f.saveExcludedTaskInstance(f.plugin, f.state.data, 'plain', '2026-11-08'), /notRecurringEvent/);
    assert.equal(f.state.writes, 0);
    assert.equal(f.document.body.children.length, 0);
    assert.deepEqual(f.state.data, { plain: { id: 'plain' } });
});

test('共享日期排除保持幂等，普通删除保留实例历史，文档删除按需清除历史', () => {
    const f = fixture();
    const task = { repeat: { instances: { '2026-11-08': { note: 'edited' } } } };
    f.excludeRepeatInstance(task, '2026-11-08');
    f.excludeRepeatInstance(task, '2026-11-08');
    assert.deepEqual(task.repeat.excludeDates, ['2026-11-08']);
    assert.deepEqual(task.repeat.instances['2026-11-08'], { note: 'edited' });
    f.excludeRepeatInstance(task, '2026-11-08', { clearState: true });
    assert.equal(task.repeat.instances['2026-11-08'], undefined);
});

test('提示保留 3 秒，悬停和聚焦暂停计时，新提示替换旧提示且卸载清理', async () => {
    const f = fixture({ task: { id: 'task' } }), action = f.action();
    await action.save({}); action.show('deleted');
    let toast = f.document.body.children[0];
    assert.equal(toast.children[1].attributes['aria-label'], 'undoTaskAction');
    assert.equal([...f.timers.values()][0].delay, 3000);
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
        'deleteRepeatInstanceState', 'getRepeatInstanceOriginalKey', 'isRepeatInstanceCompleted', 'getRepeatInstanceCompletedTime', 'patchRepeatInstanceState',
    ]);
    const globals = { ...f.dependencies, TaskActionUndo: f.TaskActionUndo,
        saveExcludedTaskInstance: f.saveExcludedTaskInstance, excludeRepeatInstance: f.excludeRepeatInstance,
        getTaskStatusUndoMessage: f.getTaskStatusUndoMessage,
        getLocalDateTimeString: () => '2026-11-08 12:00:00', getLocalDateString: () => '2026-11-08',
        getLogicalDateString: () => '2026-11-08', getLocalDateTime: () => ({ dateStr: '2026-11-08', timeStr: '12:00' }) };
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

test('日历删除普通任务及保留已完成实例的系列删除都可撤回', async () => {
    for (const keepCompleted of [false, true]) {
        const before = { task: { id: 'task', title: 'task', ...(keepCompleted ? { repeat: { enabled: true, type: 'daily' } } : {}) } };
        const f = fixture(before);
        f.dependencies.createCompletedInstanceReminders = () => ({ kept: { id: 'kept', completed: true } });
        const view = compileView(f, 'src/components/panel/CalendarView.ts', 'CalendarView', ['performDeleteEvent']);
        Object.assign(view, { calendar: { getEvents: () => [] }, refreshEvents: async () => {} });
        await view.performDeleteEvent('task', keepCompleted);
        assert.equal(f.state.data.task, undefined);
        assert.equal(!!f.state.data.kept, keepCompleted);
        await f.document.body.children[0].children[1].fire('click');
        assert.deepEqual(f.state.data, before);
    }
});

test('日历和四象限的单实例删除撤回恢复排除日期', async () => {
    for (const className of ['CalendarView', 'EisenhowerMatrixView']) {
        const before = { series: { id: 'series', repeat: { enabled: true, type: 'daily', excludeDates: ['2026-11-01'] } } };
        const f = fixture(before);
        const view = compileView(f, `src/components/panel/${className}.ts`, className, ['deleteInstanceOnly', 'addExcludedDate']);
        Object.assign(view, { calendar: { getEvents: () => [] }, loadTasks: async () => {} });
        await view.deleteInstanceOnly({ id: 'series_2026-11-08', title: 'series', date: '2026-11-08', originalId: 'series',
            extendedProps: { originalId: 'series', date: '2026-11-08' } });
        await f.state.confirmations.at(-1);
        assert.ok(f.state.data.series.repeat.excludeDates.includes('2026-11-08'));
        await f.document.body.children[0].children[1].fire('click');
        assert.deepEqual(f.state.data, before);
    }
});

test('日历删除提醒时间可撤回，并保留确认期间新增的其他任务', async () => {
    const before = { task: { id: 'task', reminderTimes: [{ time: '12:00' }, { time: '18:00' }] } };
    const f = fixture(before);
    const confirm = f.dependencies.confirm;
    f.dependencies.confirm = (...args) => {
        f.state.data.newTask = { id: 'newTask' };
        return confirm(...args);
    };
    const view = compileView(f, 'src/components/panel/CalendarView.ts', 'CalendarView', ['deleteReminderTimeEvent']);
    Object.assign(view, { getReminderTimeEventIndex: () => 0, calendar: { getEventById: () => null }, refreshEvents: async () => {} });
    await view.deleteReminderTimeEvent({ id: 'time', title: 'task', start: '2026-11-08', extendedProps: { originalId: 'task' } });
    assert.deepEqual(f.state.data.task.reminderTimes, [{ time: '18:00' }]);
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, { ...before, newTask: { id: 'newTask' } });
});

test('四象限删除父子任务后一并撤回，不覆盖期间新建的任务', async () => {
    const before = { p: { id: 'p', title: 'parent' }, c: { id: 'c', parentId: 'p' } };
    const f = fixture(before);
    const view = compileView(f, 'src/components/panel/EisenhowerMatrixView.ts', 'EisenhowerMatrixView', ['deleteTask']);
    Object.assign(view, { allTasks: Object.values(before), refresh: async () => {} });
    await view.deleteTask(before.p);
    await f.state.confirmations.at(-1);
    assert.deepEqual(f.state.data, {});
    f.state.data.other = { id: 'other' };
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, { ...before, other: { id: 'other' } });
});

test('块绑定任务删除后弹窗保持打开，撤回无需等待书签更新即可解析恢复任务', async () => {
    const before = { task: { id: 'task', title: 'task', blockId: 'block' } };
    const f = fixture(before);
    const view = compileView(f, 'src/components/dialog/BlockRemindersDialog.ts', 'BlockRemindersDialog', ['deleteReminder', 'resolveBoundReminders']);
    let destroyed = false, visible = [];
    Object.assign(view, { blockId: 'block', dialog: { destroy() { destroyed = true; } } });
    f.dependencies.window.addEventListener('reminderUpdated', () => { visible = view.resolveBoundReminders(f.state.data, []); });
    await view.deleteReminder(before.task);
    assert.equal(destroyed, false);
    assert.deepEqual(visible, []);
    await f.document.body.children[0].children[1].fire('click');
    assert.equal(destroyed, false);
    assert.deepEqual(visible, [before.task]);
});

test('块绑定实例删除可撤回，旧书签缺失时仍能恢复独立绑定的实例', async () => {
    const before = { series: { id: 'series', repeat: { enabled: true, instances: { '2026-11-08': { blockId: 'block', title: 'bound' } } } } };
    const f = fixture(before);
    f.dependencies.resolveRepeatReminderTimes = times => times;
    const view = compileView(f, 'src/components/dialog/BlockRemindersDialog.ts', 'BlockRemindersDialog', ['deleteReminder', 'resolveBoundReminders']);
    view.blockId = 'block';
    await view.deleteReminder({ id: 'series_2026-11-08', originalId: 'series', instanceDate: '2026-11-08', isRepeatInstance: true });
    assert.deepEqual(view.resolveBoundReminders(f.state.data, []), []);
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, before);
    assert.equal(view.resolveBoundReminders(f.state.data, [])[0].id, 'series_2026-11-08');
});

test('文档任务的普通任务和重复实例删除都可撤回', async () => {
    for (const instance of [false, true]) {
        const before = { task: { id: 'task', title: 'task', ...(instance ? { repeat: { enabled: true, instances: { '2026-11-08': { title: 'instance' } } } } : {}) } };
        const f = fixture(before);
        const view = compileView(f, 'src/components/dialog/DocumentReminderDialog.ts', 'DocumentReminderDialog', ['performDeleteReminder', 'deleteRepeatInstance', 'deleteNormalReminder']);
        await view.performDeleteReminder(instance ? { id: 'task_2026-11-08', originalId: 'task', instanceDate: '2026-11-08', isRepeatInstance: true } : before.task);
        assert.equal(instance ? f.state.data.task.repeat.excludeDates[0] : f.state.data.task, instance ? '2026-11-08' : undefined);
        await f.document.body.children[0].children[1].fire('click');
        assert.deepEqual(f.state.data, before);
    }
});

test('子任务弹窗删除已保存任务及 ghost 实例后都可撤回', async () => {
    for (const instance of [false, true]) {
        const before = { task: { id: 'task', title: 'task', projectId: 'A' }, child: { id: 'child', parentId: 'task' } };
        const f = fixture(before);
        const view = compileView(f, 'src/components/dialog/SubtasksDialog.ts', 'SubtasksDialog', ['deleteSubtask']);
        Object.assign(view, { isTempMode: false, isInstanceEdit: instance, isModifyAllInstances: false, loadSubtasks: async () => {}, renderSubtasks() {} });
        await view.deleteSubtask(instance ? 'task_2026-11-08' : 'task');
        await f.state.confirmations.at(-1);
        assert.equal(instance ? f.state.data.task.repeat.excludeDates[0] : f.state.data.task, instance ? '2026-11-08' : undefined);
        await f.document.body.children[0].children[1].fire('click');
        assert.deepEqual(f.state.data, before);
    }
});

test('子任务右键和更多按钮打开思源菜单，只读时仅保留查看', async () => {
    const f = fixture();
    const menus = [], actions = [];
    f.dependencies.Menu = class {
        constructor() { this.items = []; menus.push(this); }
        addItem(item) { this.items.push(item); }
        open(position) { this.position = position; }
    };
    f.dependencies.openBlock = id => { actions.push(['block', id]); };
    const view = compileView(f, 'src/components/dialog/SubtasksDialog.ts', 'SubtasksDialog', ['showSubtaskActionMenu']);
    Object.assign(view, {
        startInlineSubtask: id => actions.push(['create', id]),
        editSubtask: task => actions.push(['edit', task.id]),
        deleteSubtask: id => actions.push(['delete', id]),
        finishPendingChanges: async () => true,
    });
    const row = { getBoundingClientRect: () => ({ right: 100, bottom: 60 }) };
    view.showSubtaskActionMenu({ id: 'first', blockId: 'block' }, row, { type: 'contextmenu', clientX: 20, clientY: 40 });
    assert.deepEqual(menus[0].position, { x: 20, y: 40 });
    assert.deepEqual(menus[0].items.map(item => item.label), ['createSubtask', 'openBoundBlock', 'edit', 'delete']);
    for (const item of menus[0].items) await item.click();
    assert.deepEqual(actions, [['create', 'first'], ['block', 'block'], ['edit', 'first'], ['delete', 'first']]);

    view.readOnly = true;
    view.showSubtaskActionMenu({ id: 'second' }, row, { type: 'click' });
    assert.deepEqual(menus[1].position, { x: 100, y: 64, isLeft: true });
    assert.deepEqual(menus[1].items.map(item => item.label), ['viewTasks']);
    await menus[1].items[0].click();
    assert.deepEqual(actions.at(-1), ['edit', 'second']);
});

function inlineSubtaskFixture(initial = {}) {
    const f = fixture(initial);
    const view = compileView(f, 'src/components/dialog/SubtasksDialog.ts', 'SubtasksDialog', [
        'createInlineTitle', 'finishPendingChanges', 'finishInlineTitles', 'finishInlineTitle', 'closeInlineTitle', 'saveInlineTitle', 'writeInlineTitle',
        'buildInlineSubtask', 'parseInstanceParentId', 'getSubtaskStorageId', 'getResolvedTempParentTask',
        'placeInlineSubtask', 'applyInlineSortChanges', 'getReminderSortValue', 'getRenderedParentId', 'compareSubtasks', 'compareByCreatedTime',
    ]);
    Object.assign(view, {
        subtasks: [], dirtyInlineTitles: new Set(), renderSubtasks() {},
        getActiveSortCriteria: () => [], getRootElement: () => ({ querySelector: () => null }),
    });
    f.document.createElement = tag => Object.assign(element(tag), {
        isConnected: true,
        focus() {
            const previous = f.document.activeElement;
            if (previous === this) return;
            f.document.activeElement = this;
            previous?.fire('blur');
            this.fire('focus');
        },
    });
    return { ...f, view };
}

test('临时子任务在列表中回车连续创建，输入法确认和空标题不会新建', async () => {
    const f = inlineSubtaskFixture();
    const created = [];
    Object.assign(f.view, {
        isTempMode: true,
        tempParentTask: { projectId: 'project', kanbanStatus: 'waiting' },
        onTempSubtasksUpdate: tasks => { created.push(tasks); },
        openSubtaskDraft(parentId) {
            const row = element('div');
            f.document.body.append(row);
            const input = this.createInlineTitle(row, parentId);
            row.append(input);
            input.focus();
        },
    });
    const pressEnter = (input, isComposing = false) => input.listeners.keydown({
        key: 'Enter', isComposing, stopPropagation() {}, preventDefault() {},
    });
    f.view.openSubtaskDraft('__TEMP_PARENT__');
    pressEnter(f.view.inlineTitle.input);
    assert.equal(created.length, 0);
    const input = f.view.inlineTitle.input;
    input.value = '  第一条  ';
    pressEnter(input, true);
    assert.equal(created.length, 0);
    pressEnter(input);
    await f.view.inlineTitle.pending;
    assert.equal(created.length, 1);
    assert.equal(created[0][0].title, '第一条');
    assert.equal(created[0][0].projectId, 'project');
    assert.equal(created[0][0].kanbanStatus, 'waiting');
    assert.equal(f.view.inlineTitle.input.value, '');
    assert.equal(f.document.activeElement, f.view.inlineTitle.input);
    assert.equal(f.state.writes, 0);
});

test('已有子任务的输入框在保存前后保持同一节点，连续切换标题时按序保存', async () => {
    const f = inlineSubtaskFixture({ a: { id: 'a', title: 'First' }, b: { id: 'b', title: 'Second' } });
    const a = element('div'), b = element('div');
    const inputA = f.view.createInlineTitle(a, 'parent', { ...f.state.data.a });
    const inputB = f.view.createInlineTitle(b, 'parent', { ...f.state.data.b });
    a.append(inputA);
    b.append(inputB);
    let allowFirstWrite;
    const gate = new Promise(resolve => { allowFirstWrite = resolve; });
    const save = f.plugin.saveReminderData.bind(f.plugin);
    f.plugin.saveReminderData = async data => {
        if (f.state.writes === 0) await gate;
        await save(data);
    };
    let renders = 0;
    f.view.renderSubtasks = () => { renders++; };

    assert.equal(inputA.tag, 'textarea');
    inputA.focus();
    inputA.value = 'First edited';
    inputA.fire('input');
    inputB.focus();
    inputB.value = 'Second edited';
    inputB.fire('input');
    const saved = f.view.finishPendingChanges();
    assert.equal(f.state.writes, 0);
    allowFirstWrite();
    assert.equal(await saved, true);
    assert.equal(f.state.writes, 2);
    assert.equal(f.state.data.a.title, 'First edited');
    assert.equal(f.state.data.b.title, 'Second edited');
    assert.equal(renders, 0);
    assert.equal(a.children[0], inputA);
    assert.equal(b.children[0], inputB);
    assert.equal(f.document.activeElement, inputB);
    inputB.value = 'Cancelled';
    inputB.fire('input');
    inputB.listeners.keydown({ key: 'Escape', stopPropagation() {}, preventDefault() {} });
    assert.equal(inputB.value, 'Second edited');
    assert.equal(b.children[0], inputB);
});

test('从已有标题回车时，手动顺序传递相邻任务，自动排序仍使用列表末尾的新建行', async () => {
    for (const automatic of [false, true]) {
        const f = inlineSubtaskFixture();
        if (automatic) f.view.getActiveSortCriteria = () => [{ method: 'title', order: 'asc' }];
        let insertion;
        f.view.openSubtaskDraft = (...args) => { insertion = args; };
        const input = f.view.createInlineTitle(element('div'), 'parent', { id: 'task-2', title: '2' });
        input.focus();
        input.listeners.keydown({ key: 'Enter', stopPropagation() {}, preventDefault() {} });
        await f.view.finishPendingChanges();
        assert.deepEqual(insertion, ['parent', automatic ? undefined : 'task-2']);
    }
});

test('相邻新建在临时任务和落盘任务中都保留同级顺序，兼容旧任务缺失 sort', async () => {
    for (const isTempMode of [true, false]) {
        const parentId = isTempMode ? '__TEMP_PARENT__' : 'parent';
        const before = {
            parent: { id: 'parent' },
            first: { id: 'first', parentId, createdAt: '2026-11-20T01:00:00Z' },
            second: { id: 'second', parentId, createdAt: '2026-11-20T02:00:00Z' },
            third: { id: 'third', parentId, createdAt: '2026-11-20T03:00:00Z' },
            nested: { id: 'nested', parentId: 'second', sort: 200 },
        };
        const f = inlineSubtaskFixture(before);
        f.view.isTempMode = isTempMode;
        f.view.subtasks = Object.values(clone(before)).filter(task => task.id !== 'parent');
        await f.view.writeInlineTitle({ id: 'inserted', parentId, afterTaskId: 'second' }, 'Inserted');
        await f.view.writeInlineTitle({ id: 'next', parentId, afterTaskId: 'inserted' }, 'Next');
        const tasks = isTempMode ? f.view.subtasks : Object.values(f.state.data);
        const siblings = tasks.filter(task => task.parentId === parentId).sort((a, b) => a.sort - b.sort);
        assert.deepEqual(siblings.map(task => task.id), ['first', 'second', 'inserted', 'next', 'third']);
        assert.equal(tasks.find(task => task.id === 'nested').sort, 200);
        assert.equal(f.state.writes, isTempMode ? 0 : 2);
    }
});

test('实例视图为相邻新建留出顺序时，只调整当前日期的模板子任务顺序', async () => {
    const date = '2026-11-21';
    const parentId = `parent_${date}`;
    const before = {
        parent: { id: 'parent' },
        a: { id: 'a', parentId: 'parent', sort: 0 },
        b: { id: 'b', parentId: 'parent', sort: 0 },
    };
    const f = inlineSubtaskFixture(before);
    f.view.subtasks = [before.a, before.b].map(task => ({ ...task, id: `${task.id}_${date}`, originalId: task.id, isRepeatInstance: true, parentId }));
    await f.view.writeInlineTitle({ id: 'adjacent', parentId, afterTaskId: `a_${date}` }, 'Inserted');
    assert.equal(f.state.data.adjacent.parentId, parentId);
    assert.equal(f.state.data.a.sort, 0);
    assert.equal(f.state.data.b.sort, 0);
    assert.equal(f.state.data.a.repeat.instances[date].sort, 10);
    assert.equal(f.state.data.adjacent.sort, 20);
    assert.equal(f.state.data.b.repeat.instances[date].sort, 30);
});

test('行内新建保留重复实例的父子关系，改名只更新对应实例', async () => {
    const date = '2026-11-21';
    const before = {
        parent: { id: 'parent', kanbanStatus: 'completed', projectId: 'project' },
        child: { id: 'child', parentId: 'parent', title: '模板标题', repeat: { enabled: true, instances: { [date]: { note: '备注' } } } },
    };
    const f = inlineSubtaskFixture(before);
    const task = { ...before.child, id: `child_${date}`, originalId: 'child' };
    f.view.subtasks = [task];
    await f.view.writeInlineTitle({ id: 'new', parentId: `parent_${date}` }, '新建子任务');
    await f.view.writeInlineTitle({ task, parentId: `parent_${date}` }, '只改当前实例');
    assert.equal(f.state.data.new.parentId, `parent_${date}`);
    assert.equal(f.state.data.new.date, date);
    assert.equal(f.state.data.new.completed, false);
    assert.equal(f.state.data.new.projectId, 'project');
    assert.equal(f.state.data.child.title, '模板标题');
    assert.equal(f.state.data.child.repeat.instances[date].title, '只改当前实例');
    assert.equal(f.state.data.child.repeat.instances[date].note, '备注');
});

function subtaskDropFixture(initial) {
    const f = fixture(initial);
    const view = compileView(f, 'src/components/dialog/SubtasksDialog.ts', 'SubtasksDialog', [
        'getSubtaskDropPosition', 'canNestSubtaskDrop', 'wouldCreateSubtaskCycle', 'nestSubtask',
        'getVisibleSubtaskEntries', 'parseInstanceParentId', 'getReminderSortValue', 'finishPendingChanges',
        'setupSubtaskDragAndDrop', 'applySubtaskDrop', 'showSubtaskDropIndicator', 'hideSubtaskDropIndicator',
    ]);
    Object.assign(view, {
        parentId: 'root', subtasks: Object.values(clone(initial)), collapsedSubtaskIds: new Set(),
        renderSubtasks() {}, loadSubtasks: async () => {},
        compareSubtasks: (a, b) => a.sort - b.sort,
        canSortSubtaskDrop: (a, b) => a.parentId === b.parentId,
        finishInlineTitles() {},
    });
    return { ...f, view };
}

test('中间落点嵌套临时子任务并带上原有后代，上下边缘继续排序', async () => {
    const f = subtaskDropFixture({
        a: { id: 'a', parentId: '__TEMP_PARENT__', sort: 10 },
        b: { id: 'b', parentId: '__TEMP_PARENT__', sort: 20 },
        child: { id: 'child', parentId: 'a', sort: 10 },
    });
    const [a, b, child] = f.view.subtasks;
    const row = { getBoundingClientRect: () => ({ top: 100, height: 40 }) };
    const dropAt = (y, target = b) => f.view.getSubtaskDropPosition(row, { clientY: y }, a, target);
    f.view.isTempMode = true;
    assert.equal(dropAt(102), 'before');
    assert.equal(dropAt(138), 'after');
    assert.equal(dropAt(120), 'inside');
    assert.equal(dropAt(120, child), undefined);
    assert.equal(dropAt(120, a), undefined);
    f.view.canSortSubtaskDrop = () => false;
    assert.equal(dropAt(102), undefined);
    assert.equal(dropAt(120), 'inside');

    let temporary;
    f.view.onTempSubtasksUpdate = tasks => { temporary = tasks; };
    f.view.collapsedSubtaskIds.add('b');
    const card = () => Object.assign(element('div'), row, {
        style: {}, dataset: {}, classList: { add() {} },
        removeAttribute() { delete this.dataset.subtaskDrop; },
    });
    const source = card(), target = card();
    f.view.setupSubtaskDragAndDrop(source, a);
    f.view.setupSubtaskDragAndDrop(target, b);
    const event = { clientY: 120, preventDefault() {}, stopPropagation() {} };
    source.listeners.dragstart(event);
    target.listeners.dragover(event);
    assert.equal(target.dataset.subtaskDrop, 'inside');
    const drop = target.listeners.drop(event);
    assert.ok(f.view.finishPendingChanges());
    await drop;
    assert.equal(target.dataset.subtaskDrop, undefined);
    assert.equal(f.view.finishPendingChanges(), undefined);
    assert.equal(temporary.find(task => task.id === 'a').parentId, 'b');
    assert.equal(f.state.writes, 0);
    const rows = () => f.view.getVisibleSubtaskEntries().map(({ task, level }) => [task.id, level]);
    assert.deepEqual(rows(), [['b', 0], ['a', 1], ['child', 2]]);
    f.view.collapsedSubtaskIds.add('b');
    assert.deepEqual(rows(), [['b', 0]]);
});

test('保存嵌套时读取最新数据并重新检查循环，按目标实例保存独立子任务', async () => {
    const f = subtaskDropFixture({
        a: { id: 'a', parentId: 'root_2026-11-21', sort: 10, projectId: 'a-project' },
        b: { id: 'b', parentId: 'root', sort: 20, projectId: 'b-project' },
        sibling: { id: 'sibling', parentId: 'b_2026-11-21', sort: 50 },
    });
    const a = f.view.subtasks[0];
    const b = { ...f.view.subtasks[1], id: 'b_2026-11-21', originalId: 'b', isRepeatInstance: true, parentId: 'root_2026-11-21' };
    f.view.subtasks[1] = b;
    assert.equal(f.view.canNestSubtaskDrop(b, a), false);
    f.state.data.b.parentId = 'a';
    await assert.rejects(f.view.nestSubtask('a', b.id), /Circular/);
    assert.equal(f.state.writes, 0);
    f.state.data.b.parentId = 'root';
    await f.view.nestSubtask('a', b.id);
    assert.deepEqual(f.state.localReads, [true, true]);
    assert.equal(f.state.data.a.parentId, b.id);
    assert.equal(f.state.data.a.sort, 60);
    assert.equal(f.state.data.a.projectId, 'a-project');
    assert.equal(f.state.data.b.parentId, 'root');
    assert.equal(f.state.events.at(-1).type, 'reminderUpdated');
});

test('文档任务和子任务弹窗响应撤回，关闭后移除刷新监听', async () => {
    for (const className of ['DocumentReminderDialog', 'SubtasksDialog']) {
        const f = fixture();
        let destroyed;
        f.dependencies.Dialog = class { constructor(options) { destroyed = options.destroyCallback; } };
        const lifecycleMethod = className === 'DocumentReminderDialog' ? 'createDialog' : 'show';
        const view = compileView(f, `src/components/dialog/${className}.ts`, className, ['reminderUpdatedHandler', lifecycleMethod]);
        let loads = 0;
        Object.assign(view, {
            createContent: () => '', ensureRenderDependencies: async () => {},
            loadReminders: async () => { loads++; }, loadSubtasks: async () => { loads++; },
            renderDialogTitle: () => '', renderContent: () => '', renderSubtasks() {}, bindEvents() {}, updateSortDisplay() {},
        });
        await view[lifecycleMethod]();
        const beforeUndo = loads;
        f.dependencies.window.dispatchEvent(new f.dependencies.CustomEvent('reminderUpdated', { detail: { taskUndo: true } }));
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.equal(loads, beforeUndo + 1);
        destroyed();
        assert.equal(f.listeners.get('reminderUpdated').size, 0);
        f.dependencies.window.dispatchEvent(new f.dependencies.CustomEvent('reminderUpdated', { detail: { taskUndo: true } }));
        assert.equal(loads, beforeUndo + 1);
    }
});

test('侧栏和四象限清理同块任务记录也可撤回，不影响其他任务', async () => {
    for (const [className, method] of [['ReminderPanel', 'deleteRemindersByBlockId'], ['EisenhowerMatrixView', 'deleteTaskByBlockId']]) {
        const before = { a: { id: 'a', blockId: 'gone' }, b: { id: 'b', blockId: 'gone' }, other: { id: 'other' } };
        const f = fixture(before);
        const view = compileView(f, `src/components/panel/${className}.ts`, className, [method]);
        Object.assign(view, { removeReminderFromDOM() {}, refresh: async () => {} });
        await view[method]('gone');
        assert.deepEqual(f.state.data, { other: before.other });
        await f.document.body.children[0].children[1].fire('click');
        assert.deepEqual(f.state.data, before);
    }
});

test('日历跳过首次发生可撤回，恢复开始日期及该次实例历史', async () => {
    const before = { task: { id: 'task', date: '2026-11-01', repeat: { enabled: true, type: 'daily', instances: { '2026-11-01': { completed: true } } } } };
    const f = fixture(before);
    const view = compileView(f, 'src/components/panel/CalendarView.ts', 'CalendarView', ['skipFirstOccurrence']);
    view.calculateNextDate = () => new Date('2026-11-08T12:00:00');
    await view.skipFirstOccurrence(before.task);
    assert.equal(f.state.data.task.date, '2026-11-08');
    await f.document.body.children[0].children[1].fire('click');
    assert.deepEqual(f.state.data, before);
});
