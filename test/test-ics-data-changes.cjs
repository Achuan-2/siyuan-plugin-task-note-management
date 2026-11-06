const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const { PluginDataChanges } = createKernelLoader()('src/utils/pluginDataChanges.ts');
const root = path.resolve(__dirname, '..');

function compile(source) {
    return ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
}

function members(file, className, names) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    const selected = declaration.members.filter(member => names.includes(member.name?.getText(ast))
        || (ts.isConstructorDeclaration(member) && names.includes('constructor')));
    assert.equal(selected.length, names.length);
    return selected.map(member => member.getText(ast)).join('\n');
}

function directoryFixture() {
    const directories = {
        '': ['habit.json', 'habitGroup.json', 'reminder.json', 'reminder-settings.json', 'ics-subscriptions.json']
            .map(name => ({ name, isDir: false, updated: 1 })),
        habitCheckin: [{ name: 'reading.json', isDir: false, updated: 1 }],
        Subscribe: [{ name: 'work.json', isDir: false, updated: 1 }],
    };
    const tracker = new PluginDataChanges(async (directory, strict) => {
        assert.equal(strict, true);
        return structuredClone(directories[directory.replace(/^\/plugin\/?/, '')] || []);
    }, () => '/plugin');
    return { tracker, directories };
}

test('目录快照识别订阅、习惯明细的修改、新增、删除，未变化时无刷新', async () => {
    const { tracker, directories } = directoryFixture();
    tracker.commit(await tracker.scan());
    assert.equal(tracker.changed(await tracker.scan()).size, 0);
    directories.Subscribe[0].updated++;
    assert.deepEqual([...tracker.changed(await tracker.scan())], ['subscriptions']);
    tracker.commit(await tracker.scan());
    directories.habitCheckin.push({ name: 'new.json', isDir: false, updated: 2 });
    assert.deepEqual([...tracker.changed(await tracker.scan())], ['habits']);
    tracker.commit(await tracker.scan());
    directories.habitCheckin = [];
    assert.deepEqual([...tracker.changed(await tracker.scan())], ['habits']);
});

test('秒级时间戳相同的近期覆盖保守刷新，跨设备同步强制刷新', async () => {
    const { tracker, directories } = directoryFixture();
    directories.habitCheckin[0].updated = 100;
    const baseline = await tracker.scan();
    baseline.startedAt = 100;
    tracker.commit(baseline);
    assert.ok(tracker.changed(await tracker.scan()).has('habits'));
    tracker.commit(await tracker.scan());
    assert.equal(tracker.changed(await tracker.scan()).size, 0);
    assert.ok(tracker.changed(await tracker.scan(), true).has('habits'));
});

function pluginFixture() {
    const { tracker, directories } = directoryFixture();
    const calls = [], events = [];
    const dependencies = {
        PomodoroRecordManager: { getInstance: () => ({ reloadRecords: async () => calls.push('pomodoros') }) },
        HabitGroupManager: { getInstance: () => ({ initialize: async () => calls.push('habitGroupManager') }) },
        window: { dispatchEvent: event => events.push(event) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        console: { warn() {} },
    };
    const body = compile(`class Fixture { ${members('src/index.ts', 'ReminderPlugin', ['onDataChanged'])} }`);
    const Plugin = new Function(...Object.keys(dependencies), `${body}; return Fixture;`)(...Object.values(dependencies));
    const plugin = new Plugin();
    plugin.pluginDataChanges = tracker;
    plugin.subscriptionTasksCache = { work: { stale: true } };
    for (const [method, label] of Object.entries({
        loadSettings: 'settings', loadReminderData: 'reminders', loadProjectData: 'projects',
        loadProjectStatus: 'statuses', loadCategories: 'categories', loadHabitData: 'habits',
        loadHabitGroupData: 'habitGroups', loadHolidayData: 'holidays', loadSubscriptionData: 'subscriptions',
    })) plugin[method] = async () => { calls.push(label); };
    return { plugin, tracker, directories, calls, events };
}

test('真实 onDataChanged：订阅写入只刷新订阅，不重载习惯或番茄记录', async () => {
    const f = pluginFixture();
    f.plugin.isInMobileApp = true;
    f.tracker.commit(await f.tracker.scan());
    f.directories.Subscribe[0].updated++;
    await f.plugin.onDataChanged('overwrite');
    assert.deepEqual(f.calls, ['subscriptions']);
    assert.deepEqual(f.plugin.subscriptionTasksCache, {});
    assert.deepEqual(f.events.map(event => [event.type, event.detail?.source]), [['reminderUpdated', 'icsSubscription']]);
    f.calls.length = 0;
    f.events.length = 0;
    await f.plugin.onDataChanged();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.events, []);
});

test('真实 onDataChanged：习惯修改仍重载习惯；订阅和本地任务同时变化不标记为纯订阅', async () => {
    const f = pluginFixture();
    f.tracker.commit(await f.tracker.scan());
    f.directories.habitCheckin[0].updated++;
    await f.plugin.onDataChanged('overwrite');
    assert.deepEqual(f.calls, ['habits']);
    assert.deepEqual(f.events.map(event => event.type), ['reminderUpdated', 'habitUpdated']);
    f.calls.length = 0;
    f.events.length = 0;
    f.directories.Subscribe[0].updated++;
    f.directories[''].find(entry => entry.name === 'reminder.json').updated++;
    await f.plugin.onDataChanged('overwrite');
    assert.deepEqual(f.calls.sort(), ['reminders', 'subscriptions']);
    assert.equal(f.events[0].detail, undefined);
});

test('真实 onDataChanged：目录读取失败回退全量，刷新失败不提交快照，跨设备同步保留刷新', async () => {
    const f = pluginFixture();
    f.tracker.commit(await f.tracker.scan());
    f.directories.habitCheckin[0].updated++;
    const load = f.plugin.loadHabitData;
    f.plugin.loadHabitData = async () => { throw new Error('read failed'); };
    await f.plugin.onDataChanged('overwrite');
    assert.deepEqual(f.events, []);
    f.plugin.loadHabitData = load;
    await f.plugin.onDataChanged('overwrite');
    assert.deepEqual(f.calls, ['habits']);
    f.calls.length = 0;
    await f.plugin.onDataChanged('sync');
    assert.ok(f.calls.includes('habits'));
    assert.ok(f.calls.includes('pomodoros'));
    f.calls.length = 0;
    f.tracker.scan = async () => { throw new Error('directory unavailable'); };
    await f.plugin.onDataChanged('overwrite');
    assert.ok(f.calls.includes('habits'));
    assert.ok(f.calls.includes('reminders'));
});

function subscriptionFixture() {
    let tasks = {}, remote = [];
    const writes = [], events = [];
    const dependencies = {
        '../api': { putFile: async (_path, _dir, blob, app) => {
            assert.equal(app, 'current-window');
            tasks = JSON.parse(await blob.text());
            writes.push(tasks);
        } },
        './icsImport': { parseIcsFile: async () => remote, isEventPast: () => false, resolveDefaultKanbanStatus: async () => 'todo' },
        './caldavSubscription': {}, '../pluginInstance': {},
    };
    const exports = {};
    new Function('exports', 'require', 'fetch', 'window', 'CustomEvent', compile(fs.readFileSync(path.join(root, 'src/utils/icsSubscription.ts'), 'utf8')))(
        exports, name => { assert.ok(name in dependencies, name); return dependencies[name]; },
        async () => ({ ok: true, text: async () => 'ICS' }),
        { dispatchEvent: event => events.push(event) },
        class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    );
    const plugin = { app: { appId: 'current-window' }, loadSubscriptionTasks: async () => structuredClone(tasks) };
    const subscription = { id: 'work', name: '工作', url: 'https://example.test/calendar.ics', projectId: 'project' };
    return { sync: () => exports.syncSubscription(plugin, subscription), writes, events,
        setTasks: value => { tasks = value; }, setRemote: value => { remote = value; }, getTasks: () => tasks };
}

test('真实订阅同步：相同远端数据不写文件或通知，实际修改和清空仍保存并通知', async () => {
    const f = subscriptionFixture();
    f.setRemote([{ uid: 'event', title: '会议', date: '2099-01-01' }]);
    assert.equal((await f.sync()).success, true);
    assert.equal(f.writes.length, 1);
    assert.equal(f.events[0].detail.source, 'icsSubscription');
    await f.sync();
    assert.equal(f.writes.length, 1);
    assert.equal(f.events.length, 1);
    f.setRemote([{ uid: 'event', title: '会议改名', date: '2099-01-01' }]);
    await f.sync();
    assert.equal(f.writes.length, 2);
    f.setRemote([]);
    await f.sync();
    assert.deepEqual(f.getTasks(), {});
    assert.equal(f.events.length, 3);
    await f.sync();
    assert.equal(f.writes.length, 3);
});

test('空订阅同步保留手动删除标记，避免事件重新出现', async () => {
    const f = subscriptionFixture();
    const deleted = { id: 'deleted', uid: 'hidden', manualDelete: true };
    f.setTasks({ deleted });
    await f.sync();
    assert.deepEqual(f.getTasks(), { deleted });
    assert.equal(f.writes.length, 0);
});

test('真实习惯面板事件处理：忽略订阅通知，保留本地任务和习惯更新', () => {
    const timers = new Map();
    const manager = { getInstance: () => ({}) };
    const body = compile(`class Fixture { ${members('src/components/panel/HabitPanel.ts', 'HabitPanel', ['constructor'])}
        initializeAsync() {} loadHabits() {} }`);
    const Panel = new Function('HabitGroupManager', 'PomodoroRecordManager', 'setTimeout', 'clearTimeout', `${body}; return Fixture;`)(
        manager, manager, callback => { timers.set(1, callback); return 1; }, id => timers.delete(id),
    );
    const panel = new Panel({}, {});
    panel.reminderUpdatedHandler({ detail: { source: 'icsSubscription' } });
    assert.equal(timers.size, 0);
    panel.reminderUpdatedHandler({ detail: { _fromSync: true, source: 'icsSubscription' } });
    assert.equal(timers.size, 0);
    panel.reminderUpdatedHandler({});
    assert.equal(timers.size, 1);
    timers.clear();
    panel.habitUpdatedHandler();
    assert.equal(timers.size, 1);
});

test('文件接口把写入前端标识传给内核，保持未指定 app 的调用兼容', async () => {
    const source = fs.readFileSync(path.join(root, 'src/api.ts'), 'utf8');
    const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
    const method = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'putFile');
    const exports = {}, forms = [];
    new Function('exports', 'request', compile(method.getText(ast)))(exports, async (url, form) => {
        assert.equal(url, '/api/file/putFile');
        forms.push(form);
    });
    await exports.putFile('/plugin/Subscribe/work.json', false, new Blob(['{}']), 'current-window');
    await exports.putFile('/plugin/Subscribe/work.json', false, new Blob(['{}']));
    assert.equal(forms[0].get('app'), 'current-window');
    assert.equal(forms[1].get('app'), null);
});

test('真实跨窗口协调：保留订阅来源，接收事件不再次广播', () => {
    const listeners = {}, sent = [], events = [], badges = [];
    class Channel {
        postMessage(message) { sent.push(message); }
    }
    const window = {
        addEventListener: (type, handler) => { listeners[type] = handler; },
        dispatchEvent: event => { events.push(event); listeners[event.type]?.(event); },
    };
    const body = compile(`class Fixture { ${members('src/index.ts', 'ReminderPlugin', ['initCoordinator'])} }`);
    const Plugin = new Function('BroadcastChannel', 'window', 'CustomEvent', `${body}; return Fixture;`)(
        Channel, window, class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    );
    const plugin = new Plugin();
    Object.assign(plugin, { getWorkspaceScopedChannelName: value => value, addCleanup() {},
        updateBadges() {}, updateProjectBadges() {}, updateHabitBadges: () => badges.push('habit') });
    plugin.initCoordinator();
    listeners.reminderUpdated({ type: 'reminderUpdated', detail: { source: 'icsSubscription' } });
    assert.deepEqual(sent, [{ type: 'reminderUpdated', source: 'icsSubscription' }]);
    plugin.coordinatorChannel.onmessage({ data: sent[0] });
    assert.equal(sent.length, 1);
    assert.equal(events[0].detail.source, 'icsSubscription');
    assert.equal(events[0].detail._fromSync, true);
    assert.deepEqual(badges, []);
});
