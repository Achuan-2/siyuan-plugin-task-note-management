const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// 加载完整通知模块，替换思源窗口、存储和系统通知运行时。
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/services/ReminderNotificationService.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const repeatSource = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/dataManager/repeatUtils.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const dates = { getLocalDateString: () => '2026-10-08', getLogicalDateString: () => '2026-10-08', getLocalDateTimeString: () => '2026-10-08 09:30:00' };
const repeat = { exports: {} };
new Function('require', 'module', 'exports', repeatSource)(
    name => name === '../../utils/dateUtils' ? dates : name === '../../pluginInstance' ? { i18n: () => '' }
        : name === '../../utils/lunarUtils' || name === '../../utils/reminderSkipDate' ? {} : require(name), repeat, repeat.exports
);

function fixture(data = {}, platform = 'win32', version = '42.0.0') {
    const notices = [];
    class NativeNotification {
        static isSupported() { return true; }
        constructor(options) { this.options = options; this.handlers = {}; notices.push(this); }
        on(name, callback) { this.handlers[name] = callback; }
        show() { this.shown = true; }
        close() { this.closed = true; this.handlers.close?.({ reason: 'applicationHidden' }); }
    }
    class BrowserNotification {
        static permission = 'granted';
        constructor(title, options) { this.title = title; this.options = options; notices.push(this); }
        close() { this.closed = true; this.onclose?.(); }
    }
    const window = {
        Notification: BrowserNotification, focus() {}, dispatchEvent() {},
        require: () => ({ process: { platform, versions: { electron: version } }, Notification: NativeNotification })
    };
    const exports = {};
    const checks = [];
    const savedHabits = [];
    const dependencies = {
        siyuan: { showMessage() {}, Dialog: class {} },
        '../api': { updateBindBlockAtrrs: async () => {} },
        '../pluginInstance': { i18n: () => '' },
        '../components/panel/HabitPanel': { HabitPanel: {
            cloneHabitData: habit => JSON.parse(JSON.stringify(habit)),
            saveHabitDirectly: async (habit, plugin) => savedHabits.push({ habit, plugin })
        } },
        '../components/dialog/HabitDayDialog': { HabitDayDialog: class {
            constructor(habit, date, onSave, plugin) {
                this.check = { habit, date, onSave, plugin };
            }
            openAddEntryDialog() { checks.push(this.check); }
            show() { assert.fail('通知打卡应直接打开添加弹窗'); }
        } },
        '../utils/dateUtils': dates,
        '../components/dataManager/repeatUtils': repeat.exports
    };
    new Function('exports', 'require', 'window', 'Notification', 'CustomEvent', compiled)(
        exports, name => {
            assert.ok(name in dependencies, `未配置依赖: ${name}`);
            return dependencies[name];
        }, window, BrowserNotification, class CustomEvent {}
    );
    const host = {
        isInMobileApp: false,
        loadReminderData: async () => data, loadHabitData: async () => data,
        saveReminderData: async () => { harness.writes = (harness.writes || 0) + 1; },
        updateMobileNotification: async () => {}, playTaskCompleteSound: async () => {}, updateBadges() {}
    };
    const harness = new exports.ReminderNotificationService(host, async task => { harness.started = task; }, () => {});
    harness.focusWindow = () => {};
    harness.showActions = info => { harness.dialog = info; };
    return { harness, notices, checks, savedHabits, host, dependencies };
}

test('普通任务完成联动子任务、更新时间和进度，重复点击不再保存', async () => {
    const data = {
        task: { id: 'task', title: '最新标题', customProgress: 30 },
        child: { id: 'child', parentId: 'task', customProgress: 0 },
        other: { id: 'other' }
    };
    const { harness } = fixture(data);
    await harness.handleAction({ id: 'task', title: '旧标题' }, 'pomodoro');
    assert.equal(harness.started.title, '最新标题');
    await harness.handleAction({ id: 'task' }, 'complete');
    assert.equal(data.task.completed, true);
    assert.equal(data.child.completed, true);
    assert.equal(data.child.customProgress, 100);
    assert.equal(data.task.completedTime, '2026-10-08 09:30:00');
    assert.equal(data.other.completed, undefined);
    await harness.handleAction({ id: 'task' }, 'complete');
    assert.equal(harness.writes, 1);
});

test('移动日期的重复任务完成原始实例及子任务，保留其他实例', async () => {
    const data = {
        task: { id: 'task', repeat: { enabled: true, instances: { '2026-10-07': { date: '2026-10-08' } } } },
        ghost: { id: 'ghost', parentId: 'task' },
        child: { id: 'child', parentId: 'task_2026-10-07' }
    };
    const { harness } = fixture(data);
    const info = { id: 'task_2026-10-07', originalId: 'task', isRepeatInstance: true, date: '2026-10-08' };
    await harness.handleAction(info, 'complete');
    assert.equal(data.task.repeat.instances['2026-10-07'].completed, true);
    assert.equal(data.task.repeat.instances['2026-10-07'].date, '2026-10-08');
    assert.equal(data.task.repeat.instances['2026-10-08'], undefined);
    assert.equal(data.task.completed, undefined);
    assert.equal(data.ghost.repeat.instances['2026-10-07'].completed, true);
    assert.equal(data.child.completed, true);
});

test('删除的任务或实例不能从旧通知中启动或完成', async () => {
    const { harness } = fixture({ task: { id: 'task', repeat: { instances: { '2026-10-08': { deleted: true } } } } });
    await harness.handleAction({ id: 'missing' }, 'complete');
    await harness.handleAction({ id: 'task_2026-10-08', originalId: 'task', isRepeatInstance: true }, 'pomodoro');
    assert.equal(harness.writes, undefined);
    assert.equal(harness.started, undefined);
});

test('习惯通知直接打开添加打卡弹窗，保存前不写入并使用当前逻辑日期', async () => {
    const habit = { id: 'habit', checkInEmojis: [{ emoji: '✅', promptNote: true }] };
    const { harness, checks, savedHabits, host } = fixture({ habit });
    await harness.handleAction({ id: 'habit', notificationKind: 'habit', date: '2026-10-07' }, 'checkIn');
    assert.equal(checks.length, 1);
    assert.deepEqual(checks[0].habit, habit);
    assert.notEqual(checks[0].habit, habit);
    assert.equal(checks[0].date, '2026-10-08');
    assert.equal(checks[0].plugin, host);
    assert.equal(savedHabits.length, 0);
    checks[0].habit.checkIns = { '2026-10-08': { count: 2, status: ['✅', '⭐'] } };
    assert.equal(habit.checkIns, undefined);
    await checks[0].onSave(checks[0].habit);
    assert.equal(savedHabits.length, 1);
    assert.equal(savedHabits[0].habit, checks[0].habit);
    assert.equal(savedHabits[0].plugin, host);
});

test('已放弃或已删除的习惯不会从旧通知打开打卡弹窗', async () => {
    const habit = { id: 'habit' };
    const { harness, checks } = fixture({ habit });
    habit.abandoned = true;
    await harness.handleAction({ id: 'habit', notificationKind: 'habit' }, 'checkIn');
    await harness.handleAction({ id: 'missing', notificationKind: 'habit' }, 'checkIn');
    assert.equal(checks.length, 0);
});

test('原生通知按钮分别路由任务操作，兼容新旧事件参数并防止重复执行', async () => {
    for (const event of [{ actionIndex: 1 }, {}]) {
        const { harness, notices } = fixture();
        const calls = [];
        harness.handleAction = async (info, action) => calls.push([info.id, action]);
        await harness.show('任务', '内容', { id: 'task' });
        assert.equal(notices[0].options.actions.length, 2);
        notices[0].handlers.action(event, 1);
        notices[0].handlers.click();
        assert.deepEqual(calls, [['task', 'complete']]);
        assert.equal(notices[0].closed, true);
    }
    const { harness, notices } = fixture();
    await harness.show('习惯', '内容', { id: 'habit', notificationKind: 'habit' });
    assert.equal(notices[0].options.actions.length, 1);
});

test('点击系统通知的习惯打卡按钮只打开一次添加弹窗', async () => {
    const { harness, notices, checks, savedHabits } = fixture({ habit: { id: 'habit' } });
    await harness.show('习惯', '内容', { id: 'habit', notificationKind: 'habit' });
    notices[0].handlers.action({ actionIndex: 0 });
    notices[0].handlers.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(checks.length, 1);
    assert.equal(checks[0].habit.id, 'habit');
    assert.equal(savedHabits.length, 0);
    assert.equal(notices[0].closed, true);
});

test('旧版 Windows 使用浏览器通知，点击后显示操作框', async () => {
    const { harness, notices } = fixture({}, 'win32', '40.0.0');
    const info = { id: 'task' };
    await harness.show('任务', '内容', info);
    notices[0].onclick();
    assert.equal(harness.dialog, info);
    assert.equal(notices[0].closed, true);
});

test('关闭原生习惯通知后忽略后续点击、打卡和失败回调', async () => {
    for (const event of [undefined, { reason: 'userCanceled' }, { reason: 'applicationHidden' }]) {
        const { harness, notices, checks } = fixture({ habit: { id: 'habit' } });
        await harness.show('习惯', '内容', { id: 'habit', notificationKind: 'habit' });
        notices[0].handlers.close(event);
        notices[0].handlers.click();
        notices[0].handlers.action({ actionIndex: 0 });
        notices[0].handlers.failed({}, 'late failure');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(harness.desktopReminderNotifications.size, 0);
        assert.equal(harness.dialog, undefined);
        assert.equal(checks.length, 0);
    }
});

test('原生通知超时进入通知中心后仍可点击打卡', async () => {
    const { harness, notices, checks } = fixture({ habit: { id: 'habit' } });
    await harness.show('习惯', '内容', { id: 'habit', notificationKind: 'habit' });
    notices[0].handlers.close({ reason: 'timedOut' });
    notices[0].handlers.action({ actionIndex: 0 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(checks.length, 1);
    assert.equal(harness.desktopReminderNotifications.size, 0);
});

test('关闭浏览器习惯通知后不再弹出操作框，正常点击只弹出一次', async () => {
    const { harness, notices } = fixture({}, 'win32', '40.0.0');
    const info = { id: 'habit', notificationKind: 'habit' };
    await harness.show('习惯', '内容', info);
    notices[0].onclose();
    notices[0].onclick();
    assert.equal(harness.dialog, undefined);
    assert.equal(harness.desktopReminderNotifications.size, 0);

    let dialogs = 0;
    harness.showActions = () => dialogs++;
    await harness.show('习惯', '内容', info);
    notices[1].onclick();
    notices[1].onclick();
    assert.equal(dialogs, 1);
});

test('销毁模块会关闭并清空未处理的系统通知', async () => {
    const { harness, notices } = fixture();
    await harness.show('任务', '内容', { id: 'task' });
    await harness.show('习惯', '内容', { id: 'habit', notificationKind: 'habit' });
    harness.destroy();
    assert.equal(harness.desktopReminderNotifications.size, 0);
    assert.ok(notices.every(notification => notification.closed));
    harness.destroy();
});

test('移动端仍调用内核通知接口并传递定时时间', async () => {
    const { harness, notices, host, dependencies } = fixture();
    host.isInMobileApp = true;
    const requests = [];
    dependencies['../api'].sendNotification = async (...args) => {
        requests.push(args);
        return 123;
    };
    const scheduledTime = '2026-10-08T09:30:00';
    assert.equal(await harness.show('任务', '内容', { blockId: 'block' }, scheduledTime), 123);
    assert.deepEqual(requests, [['任务', '内容', scheduledTime]]);
    assert.equal(notices.length, 0);
});
