const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const load = createKernelLoader();
const { WEBHOOK_JSON_TEMPLATES: templates, inferReminderWebhookJsonType: inferType, buildWebhookPayload } = load('src/services/webhookPayload.ts');
const { KernelWebhookScheduler, sendKernelWebhook } = load('src/kernel/webhookScheduler.ts');

test('共用 Payload 支持旧企业微信设置、飞书与含特殊字符的自定义模板', () => {
    const legacy = templates.wecom.replace('"msgtype"', '"msgType"');
    assert.equal(inferType(legacy), 'wecom');
    assert.equal(inferType(templates.wecom), 'wecom');
    assert.equal(inferType('{"custom":true}'), 'custom');
    const message = '带有 "引号"、换行\n和反斜杠 \\ 的消息';
    assert.deepEqual(buildWebhookPayload('标题', message, 'test', '', legacy, 'wecom'), {
        msgtype: 'text', text: { content: '标题\n' + message }
    });
    assert.deepEqual(buildWebhookPayload('标题', message, 'test', '', templates.feishu, 'feishu'), {
        msg_type: 'text', content: { text: '标题\n' + message }
    });
    assert.deepEqual(buildWebhookPayload('标题', message, 'test', '', '{"message":"${message}"}', 'custom'), { message });
});

test('内核传输检查代理 HTTP、目标 HTTP 及 Webhook 业务状态码', async () => {
    const url = 'https://example.invalid/webhook';
    const client = response => ({ fetch: async () => response });
    const proxy = (status, body) => ({ ok: true, json: async () => ({ code: 0, data: { status, body } }) });
    await assert.rejects(sendKernelWebhook(client({ ok: false, status: 403 }), url, {}), /HTTP 403/);
    await assert.rejects(sendKernelWebhook(client(proxy(500, '')), url, {}), /HTTP 500/);
    for (const code of [40008, '93000']) {
        await assert.rejects(sendKernelWebhook(client(proxy(200, JSON.stringify({ errcode: code, errmsg: 'invalid message type' }))), url, {}), /invalid message type/);
    }
    for (const body of ['', 'ok', '{"accepted":true}', '{"errcode":0}']) {
        await sendKernelWebhook(client(proxy(200, body)), url, {});
    }
    await sendKernelWebhook(client(proxy(204, '')), url, {});
    await assert.rejects(sendKernelWebhook(client(proxy(200, '')), 'file:///tmp/webhook', {}), /HTTP or HTTPS/);
});

test('测试 Webhook 使用与自动通知相同的内核传输，可测试尚未保存的配置', async () => {
    const requests = [];
    const client = { async fetch(path, options) {
        assert.equal(path, '/api/network/forwardProxy');
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: '{"errcode":0}' } }) };
    } };
    const scheduler = new KernelWebhookScheduler({}, client, {});
    assert.equal(await scheduler.testWebhook({ url: 'https://example.invalid/webhook', template: '', jsonType: 'wecom' }), true);
    assert.equal(JSON.parse(requests[0].payload).msgtype, 'text');
    await assert.rejects(scheduler.testWebhook({ url: 'https://example.invalid/webhook', template: '{invalid', jsonType: 'custom' }), /invalid template/);
});
