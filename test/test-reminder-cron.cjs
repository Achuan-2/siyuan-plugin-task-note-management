const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const load = createKernelLoader();
const { ReminderCronService } = load('src/services/ReminderCronService.ts');
const { buildReminderSchedule } = load('src/services/ReminderSchedule.ts');
const { KernelReminderService } = load('src/kernel/reminderService.ts');
const { KernelReminderWatcher } = load('src/kernel/reminderWatcher.ts');
const { setDayStartTime } = load('src/utils/dateUtils.ts');

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const tick = async (t, ms) => { t.mock.timers.tick(ms); await flush(); };
function clock(t, time = '2026-10-08T09:29:00') {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(time).getTime() });
}

test('真实 Croner 到整分钟才执行业务，空闲期间不会扫描存储', async t => {
    clock(t);
    let reads = 0, checks = 0;
    const service = new ReminderCronService({
        readSchedule: async () => { reads++; return { times: new Set(['09:30']), dayStart: '03:00' }; },
        check: async () => { checks++; }, onError: error => { throw error; }
    });
    await service.start();
    const initialReads = reads;
    assert.equal(checks, 1);
    await tick(t, 30_000);
    assert.equal(reads, initialReads);
    assert.equal(checks, 1);
    await tick(t, 30_000);
    assert.equal(checks, 2);
    await service.stop();
    await tick(t, 60_000);
    assert.equal(checks, 2);
});

test('修改提醒时间会取消旧任务，连续变更只重建一次', async t => {
    clock(t);
    let time = '09:30', reads = 0;
    const calls = [];
    const service = new ReminderCronService({
        readSchedule: async () => { reads++; return { times: new Set([time]), dayStart: '03:00' }; },
        check: async now => calls.push(now.getTime()), onError: error => { throw error; }
    });
    await service.start();
    time = '09:31';
    const before = reads;
    service.notifyChanged(); service.notifyChanged(); service.notifyChanged();
    await tick(t, 250);
    assert.equal(reads, before + 2); // 变更计划及当前分钟检查后的重试计划刷新。
    const afterChange = calls.length;
    await tick(t, 30_000);
    await tick(t, 29_750);
    assert.equal(calls.length, afterChange);
    await tick(t, 30_000);
    await tick(t, 30_000);
    assert.equal(calls.length, afterChange + 1);
    await service.stop();
});

test('自然日和逻辑日边界都重建计划，并能触发新一天的任务', async t => {
    clock(t, '2026-10-08T23:59:30');
    const dates = [];
    let checks = 0;
    const service = new ReminderCronService({
        readSchedule: async now => { dates.push(now.getDate()); return { times: new Set(['00:01']), dayStart: '03:00' }; },
        check: async () => { checks++; }, onError: error => { throw error; }
    });
    await service.start();
    assert.ok(service.jobs.has('clock:03:00'));
    await tick(t, 30_000);
    assert.equal(dates.at(-1), 9);
    assert.equal(checks, 2);
    await tick(t, 30_000); await tick(t, 30_000);
    assert.equal(checks, 3);
    await service.stop();
});

test('卸载发生在异步读取计划期间，也不能重新创建定时任务', async t => {
    clock(t);
    let release;
    const service = new ReminderCronService({
        readSchedule: () => new Promise(resolve => { release = resolve; }),
        check: async () => assert.fail('stopped service must not check'), onError: error => { throw error; }
    });
    const started = service.start();
    const stopped = service.stop();
    release({ times: new Set(['09:30']), dayStart: '03:00' });
    await Promise.all([started, stopped]);
    assert.equal(service.jobs.size, 0);
});

test('慢发送跨越下一提醒分钟时，保留下一分钟的到期上下文', async t => {
    clock(t);
    const calls = [];
    let release;
    const service = new ReminderCronService({
        readSchedule: async () => ({ times: new Set(['09:30', '09:31']), dayStart: '03:00' }),
        check: async now => {
            calls.push(now.getMinutes());
            if (now.getMinutes() === 30) await new Promise(resolve => { release = resolve; });
        }, onError: error => { throw error; }
    });
    await service.start();
    await tick(t, 30_000); await tick(t, 30_000);
    await tick(t, 30_000); await tick(t, 30_000);
    assert.deepEqual(calls, [29, 30]);
    release(); await flush();
    assert.deepEqual(calls, [29, 30, 31]);
    await service.stop();
});

test('读取计划失败时仅安排恢复任务，恢复成功后移除', async t => {
    clock(t);
    let fail = true, errors = 0;
    const service = new ReminderCronService({
        readSchedule: async () => {
            if (fail) throw new Error('temporary read failure');
            return { times: new Set(['09:30']), dayStart: '03:00' };
        }, check: async () => {}, onError: () => errors++
    });
    await service.start();
    assert.ok(errors > 0);
    assert.ok(service.jobs.has('recovery'));
    fail = false;
    await tick(t, 30_000);
    assert.equal(service.jobs.has('recovery'), false);
    assert.ok(service.jobs.has('clock:09:30'));
    await service.stop();
});

test('计划保留重复实例的提前提醒、移动实例、节假日和习惯逻辑日规则', async () => {
    setDayStartTime('03:00');
    const plan = await buildReminderSchedule({
        advance: { id: 'advance', date: '2026-10-09', reminderTimes: [{ time: '2026-10-08T09:10' }] },
        repeat: { id: 'repeat', date: '2026-10-01', time: '09:20', repeat: { enabled: true, type: 'weekly', interval: 1,
            weekdays: [4], instances: { '2026-10-01': { date: '2026-10-08', time: '09:21' }, '2026-10-08': { completed: true } } } },
        skipped: { id: 'skipped', date: '2026-10-07', endDate: '2026-10-09', time: '09:40', reminderSkipHolidays: true }
    }, { habit: { id: 'habit', startDate: '2026-10-01', frequency: { type: 'daily' }, reminderTimes: ['09:50'] } },
    { todayStartTime: '03:00', dailyNotificationEnabled: true, dailyNotificationTime: 8 },
    { '2026-10-08': { type: 'holiday' } }, new Date('2026-10-08T09:00:00'));
    assert.deepEqual([...plan.times].sort(), ['08:00', '09:10', '09:21', '09:50']);
});

test('失败通知由一次性 Croner 重试，成功后移除重试任务', async t => {
    clock(t, '2026-10-08T09:30:00');
    const files = {
        'reminder-settings.json': { reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom' },
        'reminder.json': { task: { id: 'task', date: '2026-10-08', time: '09:30', title: '测试' } }
    };
    let attempts = 0, fail = true;
    const scheduler = new KernelReminderService({
        loadData: async path => files[path], saveData: async (path, data) => { files[path] = data; }
    }, { fetch: async path => path === '/api/system/getConf' ? { json: async () => ({}) } : {
        ok: true, json: async () => { attempts++; return { code: 0, data: { status: fail ? 500 : 200, body: '{}' } }; }
    } }, { info: async () => {}, warn: async () => {}, error: async () => {} });
    await scheduler.start();
    assert.equal(attempts, 1);
    assert.ok(scheduler.cron.jobs.has('retry'));
    fail = false;
    await tick(t, 30_000);
    assert.equal(attempts, 2);
    assert.equal(scheduler.cron.jobs.has('retry'), false);
    await tick(t, 30_000);
    assert.equal(attempts, 2);
    await scheduler.stop();
});

test('内核监听数据文件和新建子目录，忽略自己的发送状态；卸载恢复原处理器', async () => {
    let changes = 0;
    const watched = new Set();
    const previous = async () => {};
    const runtime = { event: { handler: previous }, storage: { watcher: {
        add: async path => watched.add(path), remove: async path => watched.delete(path)
    } } };
    const directories = { '.': [{ name: 'habitCheckin', isDir: true }], habitCheckin: [] };
    const watcher = new KernelReminderWatcher(runtime, { readDir: async path => directories[path] || [] }, () => changes++);
    await watcher.start();
    assert.deepEqual([...watched].sort(), ['.', 'habitCheckin']);
    await runtime.event.handler({ type: 'fs-notify', detail: { path: 'habitCheckin\\habit.json' } });
    await runtime.event.handler({ type: 'fs-notify', detail: { path: 'reminder-settings.json' } });
    await runtime.event.handler({ type: 'fs-notify', detail: { path: 'kernel-webhook-notify.json' } });
    assert.equal(changes, 2);
    directories['.'].push({ name: 'Subscribe', isDir: true });
    await runtime.event.handler({ type: 'fs-notify', detail: { path: 'Subscribe', operation: 'CREATE' } });
    await watcher.refreshDirectories();
    assert.ok(watched.has('Subscribe'));
    await watcher.stop();
    assert.equal(watched.size, 0);
    assert.equal(runtime.event.handler, previous);
});

test('无页面时文件变更自动替换内核计划，并广播给已连接客户端', async t => {
    clock(t);
    const files = {
        'reminder-settings.json': { reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom' },
        'reminder.json': { task: { id: 'task', date: '2026-10-08', time: '09:30', title: '任务' } }
    };
    const broadcasts = [], watched = new Set();
    let reads = 0, sends = 0;
    const storage = {
        loadData: async path => { reads++; return files[path]; },
        saveData: async (path, data) => { files[path] = data; }, readDir: async () => []
    };
    const runtime = {
        event: { handler: null }, rpc: { broadcast: async (...args) => broadcasts.push(args) },
        storage: { watcher: { add: async path => watched.add(path), remove: async path => watched.delete(path) } }
    };
    const scheduler = new KernelReminderService(storage, {
        fetch: async path => path === '/api/system/getConf' ? { json: async () => ({}) } : {
            ok: true, json: async () => { sends++; return { code: 0, data: { status: 200, body: '{}' } }; }
        }
    }, { info: async () => {}, warn: async () => {}, error: async () => {} }, runtime);
    await scheduler.start();
    const before = reads;
    await tick(t, 30_000);
    assert.equal(reads, before);
    files['reminder.json'].task.time = '09:31';
    await runtime.event.handler({ type: 'fs-notify', detail: { path: 'reminder.json', operation: 'WRITE' } });
    await tick(t, 250);
    assert.deepEqual(broadcasts.filter(([method]) => method === 'reminder-schedule-updated'),
        [['reminder-schedule-updated', { path: 'reminder.json' }]]);
    await tick(t, 29_750);
    assert.equal(sends, 0);
    await tick(t, 30_000); await tick(t, 30_000);
    assert.equal(sends, 1);
    await scheduler.stop();
    assert.equal(watched.size, 0);
    assert.equal(runtime.event.handler, null);
});
