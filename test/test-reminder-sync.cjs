const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');

const load = createKernelLoader();
const { KernelFrontendReminderDelivery, FRONTEND_REMINDER_STATE_FILE } = load('src/kernel/frontendReminderDelivery.ts');
const { KernelReminderService, WEBHOOK_STATE_FILE, EMAIL_STATE_FILE } = load('src/kernel/reminderService.ts');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const now = () => new Date('2026-10-08T09:30:10');

function fixture(extra = {}) {
    const files = {
        'reminder-settings.json': { todayStartTime: '03:00', dailyNotificationEnabled: false },
        'reminder.json': { task: { id: 'task', title: '新任务', date: '2026-10-08', time: '10:00' } },
        ...clone(extra)
    };
    const writes = [];
    const storage = {
        loadData: async file => clone(files[file]),
        saveData: async (file, data) => { writes.push(file); files[file] = clone(data); },
        readDir: async () => []
    };
    const requests = [];
    const client = { fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: '{"errcode":0}' } }) };
    } };
    const logger = { info: async () => {}, warn: async () => {}, error: async () => {} };
    const service = new KernelReminderService(storage, client, logger);
    return { files, writes, storage, requests, service };
}

test('新建未到期任务后反复同步补取，不创建或重写通知状态文件', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) {
        assert.deepEqual((await f.service.getFrontendEvents(now())).events, []);
        await f.service.check(now());
    }
    assert.deepEqual(f.writes, []);
});

test('提醒已记录后反复检查及内核重启，不重写相同事件', async () => {
    const f = fixture({ 'reminder.json': { task: { id: 'task', date: '2026-10-08', time: '09:30' } } });
    await f.service.check(now());
    assert.deepEqual(f.writes, [FRONTEND_REMINDER_STATE_FILE]);
    for (let i = 0; i < 5; i++) await f.service.getFrontendEvents(now());
    const restarted = new KernelFrontendReminderDelivery(f.storage);
    await restarted.record([], now().getTime());
    assert.deepEqual(f.writes, [FRONTEND_REMINDER_STATE_FILE]);
});

test('事件写入失败后仍能重试保存，成功后停止重复写入', async () => {
    const f = fixture();
    const delivery = new KernelFrontendReminderDelivery(f.storage);
    const save = f.storage.saveData;
    let fail = true;
    f.storage.saveData = async (...args) => {
        if (fail) throw new Error('write failed');
        return save(...args);
    };
    const event = { key: 'event', event: 'time-reminder', createdAt: now().getTime() };
    await assert.rejects(delivery.record([event], now().getTime()), /write failed/);
    fail = false;
    await delivery.record([], now().getTime());
    assert.equal(f.files[FRONTEND_REMINDER_STATE_FILE].events.event.key, 'event');
    await delivery.record([], now().getTime());
    assert.deepEqual(f.writes, [FRONTEND_REMINDER_STATE_FILE]);
});

test('过期事件清理只写入一次，确认失败后可重新确认', async () => {
    const f = fixture({ [FRONTEND_REMINDER_STATE_FILE]: {
        events: { old: { key: 'old', createdAt: now().getTime() - 3 * 86400000 } }, delivered: { old: 1 }
    } });
    const delivery = new KernelFrontendReminderDelivery(f.storage);
    await delivery.record([], now().getTime());
    await delivery.record([], now().getTime());
    assert.deepEqual(f.files[FRONTEND_REMINDER_STATE_FILE], { events: {}, delivered: {} });
    assert.equal(f.writes.length, 1);
    await delivery.record([{ key: 'new', event: 'time-reminder', createdAt: now().getTime() }], now().getTime());
    assert.equal(await delivery.claim('new', 'desktop'), true);
    const save = f.storage.saveData;
    f.storage.saveData = async () => { throw new Error('ack failed'); };
    await assert.rejects(delivery.acknowledge('new', 'desktop'), /ack failed/);
    f.storage.saveData = save;
    await delivery.acknowledge('new', 'desktop');
    assert.ok(f.files[FRONTEND_REMINDER_STATE_FILE].delivered.new);
    const count = f.writes.length;
    await delivery.record([], now().getTime());
    assert.equal(f.writes.length, count);
});

for (const [name, settings, file] of [
    ['Webhook', { reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom' }, WEBHOOK_STATE_FILE],
    ['SMTP', { reminderEmailEnabled: true, reminderEmailTransport: 'smtp' }, EMAIL_STATE_FILE]
]) {
    test(`${name} 开启但没有到期事件时，不反复写入通道状态`, async () => {
        const f = fixture({ 'reminder-settings.json': settings });
        for (let i = 0; i < 5; i++) await f.service.check(now());
        assert.equal(f.writes.filter(path => path === file).length, 0);
    });
}

test('Webhook 成功发送后，重复扫描及重启不再写入或发送', async () => {
    const f = fixture({
        'reminder-settings.json': { reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom' },
        'reminder.json': { task: { id: 'task', date: '2026-10-08', time: '09:30' } }
    });
    await f.service.check(now());
    const count = f.writes.length;
    for (let i = 0; i < 5; i++) await f.service.getFrontendEvents(now());
    const restarted = new KernelReminderService(f.storage, { fetch: async () => assert.fail('unexpected resend') },
        { warn: async () => {}, info: async () => {}, error: async () => {} });
    await restarted.check(now());
    assert.equal(f.writes.length, count);
    assert.equal(f.requests.length, 1);
});
