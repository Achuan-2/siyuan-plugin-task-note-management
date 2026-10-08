const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const load = createKernelLoader();
const { KernelReminderService, WEBHOOK_STATE_FILE } = load('src/kernel/reminderService.ts');
const { FrontendReminderService } = load('src/services/FrontendReminderService.ts');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
const at = () => new Date('2026-10-08T09:30:10');

function fixture(t, overrides = {}) {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at().getTime() });
    const files = {
        'reminder-settings.json': { reminderWebhookEnabled: false, todayStartTime: '03:00', dailyNotificationEnabled: false },
        'reminder.json': { task: { id: 'task', date: '2026-10-08', time: '09:30', title: '任务', completed: false } },
        ...clone(overrides)
    };
    const handlers = new Map(), broadcasts = [], errors = [], requests = [];
    let failWebhook = false;
    const storage = {
        loadData: async file => clone(files[file]), saveData: async (file, data) => { files[file] = clone(data); },
        readDir: async () => []
    };
    const runtime = { rpc: { broadcast: async (method, data) => {
        broadcasts.push({ method, data: clone(data) });
        // 实际广播不等待前端 UI 处理完成。
        const params = Array.isArray(data) ? clone(data) : [clone(data)];
        for (const handler of handlers.get(method) || []) void handler(...params);
    } } };
    const client = { fetch: async url => url === '/api/system/getConf' ? { json: async () => ({}) } : {
        ok: true, json: async () => { requests.push(url); return { code: 0, data: { status: failWebhook ? 500 : 200, body: '{}' } }; }
    } };
    const logger = { info: async () => {}, warn: async () => {}, error: async error => errors.push(error) };
    let service = new KernelReminderService(storage, client, logger, runtime);
    function receiver(owner, options = {}) {
        const shown = [], marked = [], dates = [];
        let rpcFailure = false;
        const local = new Set();
        const frontend = new FrontendReminderService({
            owner, canReceive: () => true,
            bind(method, handler) { if (!handlers.has(method)) handlers.set(method, new Set()); handlers.get(method).add(handler); },
            unbind(method, handler) { handlers.get(method)?.delete(handler); },
            call: async (method, params) => {
                if (rpcFailure) throw new Error('kernel not ready');
                if (method === 'get-reminder-events') return service.getFrontendEvents();
                if (method === 'claim-reminder-event') return service.claimFrontendEvent(params.key, params.owner);
                if (method === 'ack-reminder-event') return service.acknowledgeFrontendEvent(params.key, params.owner);
                if (method === 'release-reminder-event') return service.releaseFrontendEvent(params.key, params.owner);
                assert.fail(`unexpected RPC ${method}`);
            },
            hasNotified: async event => { if (options.waitHas) await options.waitHas; return local.has(event.frontendKey); },
            markNotified: async event => { marked.push(event.frontendKey); local.add(event.frontendKey); },
            show: async event => { if (options.failShow) throw new Error('UI failed'); shown.push(clone(event)); },
            onLogicalDate: date => dates.push(date), onError: error => errors.push(error)
        });
        return { frontend, shown, marked, dates, setRpcFailure(value) { rpcFailure = value; } };
    }
    return { files, storage, service, broadcasts, errors, requests, receiver,
        setFailure(value) { failWebhook = value; },
        restart() { service = new KernelReminderService(storage, client, logger, runtime); return service; } };
}

test('关闭 Webhook 时，内核仍统一生成任务和习惯事件并推送前端', async t => {
    const f = fixture(t, { 'habit.json': { habit: { id: 'habit', title: '习惯', startDate: '2026-10-01',
        frequency: { type: 'daily' }, target: 1, reminderTimes: ['09:30'] } } });
    const front = f.receiver('desktop');
    front.frontend.start();
    await front.frontend.recover(); await flush();
    assert.equal(front.shown.length, 2);
    assert.deepEqual(front.shown.map(event => event.reminderInfo.notificationKind), ['task', 'habit']);
    assert.equal(f.requests.length, 0);
    assert.equal((await f.service.getFrontendEvents()).events.length, 0);
    front.frontend.stop();
});

test('两个窗口同时补取及接收广播，只允许一个窗口显示，每条事件独立领取', async t => {
    const f = fixture(t, { 'reminder.json': {
        a: { id: 'a', date: '2026-10-08', time: '09:30', title: '任务 A' },
        b: { id: 'b', date: '2026-10-08', time: '09:30', title: '任务 B' }
    } });
    const a = f.receiver('window-a'), b = f.receiver('window-b');
    a.frontend.start(); b.frontend.start();
    await Promise.all([a.frontend.recover(), b.frontend.recover()]); await flush();
    assert.equal(a.shown.length + b.shown.length, 2);
    const events = f.broadcasts.find(item => item.method === 'reminder-due').data.events;
    await Promise.all([a.frontend.receive(events), b.frontend.receive(events)]);
    assert.equal(a.shown.length + b.shown.length, 2);
    a.frontend.stop(); b.frontend.stop();
});

test('前端晚启动可补当前分钟，内核重启后已确认的事件不再补发', async t => {
    const f = fixture(t);
    await f.service.check();
    const front = f.receiver('late-window');
    front.frontend.start(); await front.frontend.recover();
    assert.equal(front.shown.length, 1);
    front.frontend.stop();
    f.restart();
    const restarted = f.receiver('restarted-window');
    restarted.frontend.start(); await restarted.frontend.recover();
    assert.equal(restarted.shown.length, 0);
    restarted.frontend.stop();
});

test('内核尚未就绪时前端不建立计时器，后续恢复连接可以补取提醒', async t => {
    const f = fixture(t);
    const front = f.receiver('early-window');
    front.setRpcFailure(true); front.frontend.start(); await front.frontend.recover();
    assert.equal(front.shown.length, 0);
    front.setRpcFailure(false); await front.frontend.recover();
    assert.equal(front.shown.length, 1);
    front.frontend.stop();
});

test('Webhook 失败重试不会重复桌面通知，Webhook 记录损坏也不阻止桌面推送', async t => {
    const f = fixture(t);
    Object.assign(f.files['reminder-settings.json'], { reminderWebhookEnabled: true,
        reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom' });
    f.setFailure(true);
    const front = f.receiver('desktop');
    front.frontend.start(); await front.frontend.recover();
    assert.equal(front.shown.length, 1);
    assert.equal(f.requests.length, 1);
    f.setFailure(false);
    await f.service.check(new Date('2026-10-08T09:31:10'));
    assert.equal(f.requests.length, 2);
    assert.equal(front.shown.length, 1);
    assert.equal(f.broadcasts.filter(item => item.method === 'reminder-due').length, 1);
    front.frontend.stop();
    // 新任务配合损坏的 Webhook 记录，仍能生成可补取的桌面事件。
    f.files[WEBHOOK_STATE_FILE] = { broken: true };
    f.files['reminder.json'].newTask = { id: 'newTask', date: '2026-10-08', time: '09:30', title: '新任务' };
    f.restart();
    const next = f.receiver('desktop-next');
    next.frontend.start(); await next.frontend.recover();
    assert.equal(next.shown.length, 1);
    assert.equal(next.shown[0].reminderInfo.id, 'newTask');
    next.frontend.stop();
});

test('补取不发送过期时间提醒，今日汇总补取使用最新未完成任务', async t => {
    const f = fixture(t, { 'reminder-settings.json': { reminderWebhookEnabled: false,
        dailyNotificationEnabled: true, dailyNotificationTime: '08:00' }, 'reminder.json': {
        task: { id: 'task', date: '2026-10-08', time: '09:30', title: '定点任务' },
        daily: { id: 'daily', date: '2026-10-08', title: '全天任务' }
    } });
    await f.service.check();
    t.mock.timers.tick(60_000);
    f.files['reminder.json'].task.completed = true;
    const front = f.receiver('late-window');
    front.frontend.start(); await front.frontend.recover();
    assert.equal(front.shown.length, 1);
    assert.equal(front.shown[0].event, 'daily-reminders');
    assert.deepEqual(front.shown[0].reminders.map(item => item.id), ['daily']);
    front.frontend.stop();
});

test('前端显示失败会释放领取，其他窗口可再次领取；过期租约也能重新领取', async t => {
    const f = fixture(t);
    const failed = f.receiver('failed-window', { failShow: true });
    failed.frontend.start(); await failed.frontend.recover(); failed.frontend.stop();
    const snapshot = await f.service.getFrontendEvents();
    assert.equal(await f.service.claimFrontendEvent(snapshot.events[0].key, 'disconnected-window'), true);
    assert.equal(await f.service.claimFrontendEvent(snapshot.events[0].key, 'other-window'), false);
    t.mock.timers.tick(30_001);
    const front = f.receiver('other-window');
    front.frontend.start(); await front.frontend.recover();
    assert.equal(front.shown.length, 1);
    front.frontend.stop();
});

test('卸载前端后不会响应事件，已领取且尚未展示的事件会释放', async t => {
    const f = fixture(t);
    await f.service.check();
    let release;
    const waitHas = new Promise(resolve => { release = resolve; });
    const front = f.receiver('desktop', { waitHas });
    front.frontend.start(); await flush();
    front.frontend.stop(); release(); await flush();
    const events = (await f.service.getFrontendEvents()).events;
    await front.frontend.receive(events);
    assert.equal(front.shown.length, 0);
    assert.equal(await f.service.claimFrontendEvent(events[0].key, 'another-window'), true);
    assert.equal([...f.broadcasts].filter(item => item.method === 'reminder-due').length, 1);
});
