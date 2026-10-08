const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/ReminderEventPresenter.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;

function fixture(system = true, internal = true, mobile = false) {
    const dialogs = [], notices = [];
    let sounds = 0;
    const exports = {};
    new Function('require', 'exports', compiled)(name => {
        if (name === '../components/dialog/NotificationDialog') return { NotificationDialog: {
            show: info => dialogs.push(info), showAllDayReminders: infos => dialogs.push(infos)
        } };
        if (name === '../pluginInstance') return { i18n: (key, params) => params?.count ? `${key}:${params.count}` : key };
        assert.fail(`unexpected dependency: ${name}`);
    }, exports);
    const presenter = new exports.ReminderEventPresenter({
        isInMobileApp: mobile, getCategory: () => ({ name: '工作', color: 'red', icon: '💼' }),
        playNotificationSound: async () => sounds++, getReminderSystemNotificationEnabled: async () => system,
        getShowInternalNotificationEnabled: async () => internal,
        showSystem: async (title, message, info) => notices.push({ title, message, info })
    });
    return { presenter, dialogs, notices, sounds: () => sounds };
}

test('任务和习惯事件保留分类、备注及通知操作所需的实例身份', async () => {
    const f = fixture();
    const event = { event: 'time-reminder', message: '09:30 重复任务（提前提醒）', reminderInfo: {
        id: 'task_2026-10-01', instanceId: 'task_2026-10-01', originalId: 'task', isRepeatInstance: true,
        categoryId: 'work', notificationKind: 'task', note: '提前提醒'
    } };
    await f.presenter.show(event);
    assert.equal(f.notices[0].info.originalId, 'task');
    assert.equal(f.notices[0].info.instanceId, 'task_2026-10-01');
    assert.equal(f.notices[0].info.categoryName, '工作');
    assert.equal(f.dialogs[0].note, '提前提醒');
    await f.presenter.show({ event: 'habit-reminder', message: '09:30 阅读', reminderInfo: { id: 'habit', notificationKind: 'habit' } });
    assert.equal(f.notices[1].info.notificationKind, 'habit');
    assert.equal(f.sounds(), 2);
});

test('每日汇总根据最新列表显示数量、分类和省略提示', async () => {
    const f = fixture();
    await f.presenter.show({ event: 'daily-reminders', reminders: [
        { id: 'a', title: '过期任务', time: '09:30', categoryId: 'work', isOverdue: true },
        { id: 'b', title: '全天任务', isAllDay: true }, { id: 'c', title: '第三个任务' }
    ] });
    assert.equal(f.dialogs[0].length, 3);
    assert.equal(f.notices[0].title, '📅 dailyRemindersNotification (3)');
    assert.match(f.notices[0].message, /⚠️ • 过期任务 ⏰09:30 \[工作\]/);
    assert.match(f.notices[0].message, /moreItems:1/);
});

test('内部通知和系统通知分别遵守设置，不会重复创建移动端系统通知', async () => {
    const disabled = fixture(false, false);
    await disabled.presenter.show({ event: 'habit-reminder', message: '阅读', reminderInfo: { id: 'habit' } });
    assert.equal(disabled.dialogs.length, 0);
    assert.equal(disabled.notices.length, 0);
    const mobile = fixture(true, true, true);
    await mobile.presenter.show({ event: 'time-reminder', message: '任务', reminderInfo: { id: 'task' } });
    assert.equal(mobile.dialogs.length, 1);
    assert.equal(mobile.notices.length, 0);
});
