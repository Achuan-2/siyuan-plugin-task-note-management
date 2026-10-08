const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// 只加载实际 Webhook 代码，避免在 Node 测试中初始化思源 UI 和插件生命周期。
const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const declarations = new Set([
    'STORAGE_NAME', 'WEBHOOK_JSON_TYPES', 'WEBHOOK_JSON_TEMPLATES', 'DEFAULT_WEBHOOK_JSON_TYPE',
    'isReminderWebhookJsonType', 'normalizeReminderWebhookJsonType', 'normalizeWebhookTemplateText',
    'inferReminderWebhookJsonType', 'resolveReminderWebhookJsonTemplate', 'assertWebhookResponse'
]);
const methods = new Set([
    'buildWebhookReminderInfo', 'replaceWebhookTemplateVariables', 'renderWebhookTemplateAsJsonText',
    'buildDefaultWebhookPayload', 'buildWebhookPayload', 'sendWebhookRequest',
    'sendReminderWebhookNotification', 'sendTestWebhook'
]);
const definitions = ast.statements.filter((node) => {
    if (ts.isVariableStatement(node)) {
        return node.declarationList.declarations.some((item) => declarations.has(item.name.getText(ast)));
    }
    return ts.isFunctionDeclaration(node) && declarations.has(node.name?.text);
});
const pluginClass = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'ReminderPlugin');
const webhookMethods = pluginClass.members.filter((node) => methods.has(node.name?.getText(ast)));
assert.equal(definitions.length, declarations.size, '应加载所有 Webhook 声明');
assert.equal(webhookMethods.length, methods.size, '应加载所有 Webhook 方法');

const compiled = ts.transpileModule([
    ...definitions.map((node) => node.getText(ast)),
    `class WebhookHarness { ${webhookMethods.map((node) => node.getText(ast)).join('\n')} }`,
    'exports.WebhookHarness = WebhookHarness;',
    'exports.inferType = inferReminderWebhookJsonType;',
].join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;

let frontend = 'desktop';
let responseStatus = 200;
let responseBody = '{"errcode":0,"errmsg":"ok"}';
const requests = [];
const warnings = [];
const moduleExports = {};
new Function('exports', 'getFrontend', 'forwardProxy', 'fetch', 'window', 'i18n', 'console', compiled)(
    moduleExports,
    () => frontend,
    async (url, method, payload) => {
        requests.push({ route: 'proxy', url, method, payload: JSON.parse(payload) });
        return { status: responseStatus, body: responseBody };
    },
    async (url, options) => {
        requests.push({ route: 'direct', url, method: options.method, payload: JSON.parse(options.body) });
        return {
            ok: responseStatus >= 200 && responseStatus < 300,
            status: responseStatus,
            text: async () => responseBody
        };
    },
    { setTimeout, clearTimeout },
    () => '',
    { warn: (...args) => warnings.push(args), error: () => {} }
);

async function main() {
    const { WebhookHarness, WEBHOOK_JSON_TEMPLATES: templates, inferType } = moduleExports;
    const plugin = new WebhookHarness();
    const url = 'https://example.invalid/webhook';
    const legacyTemplate = templates.wecom.replace('"msgtype"', '"msgType"');
    assert.equal(inferType(legacyTemplate), 'wecom', '旧版预设应仍识别为企业微信');
    assert.equal(inferType(templates.wecom), 'wecom');
    assert.equal(inferType('{"custom":true}'), 'custom');

    const message = '带有 "引号"、换行\n和反斜杠 \\ 的消息';
    const payload = plugin.buildWebhookPayload('标题', message, 'test', '', legacyTemplate, 'wecom');
    assert.deepEqual(payload, { msgtype: 'text', text: { content: `标题\n${message}` } });
    assert.deepEqual(plugin.buildWebhookPayload('标题', message, 'test', '', templates.feishu, 'feishu'), {
        msg_type: 'text', content: { text: `标题\n${message}` }
    });

    for (frontend of ['desktop', 'browser-desktop', 'browser-mobile']) {
        responseStatus = 200;
        responseBody = '{"errcode":0,"errmsg":"ok"}';
        assert.equal(await plugin.sendTestWebhook(url, legacyTemplate, 'wecom'), true);
        assert.equal(requests.at(-1).route, frontend === 'desktop' ? 'direct' : 'proxy');
        assert.equal(requests.at(-1).payload.msgtype, 'text');
        assert.equal(requests.at(-1).payload.msgType, undefined);

        for (const code of [40008, '93000']) {
            responseBody = JSON.stringify({ errcode: code, errmsg: 'invalid message type' });
            await assert.rejects(plugin.sendTestWebhook(url, '', 'wecom'), new RegExp(`${code}.*invalid message type`));
        }

        plugin.loadSettings = async () => ({
            reminderWebhookEnabled: true,
            reminderWebhookUrl: url,
            reminderWebhookJsonType: 'wecom',
            reminderWebhookJsonTemplate: legacyTemplate
        });
        const warningCount = warnings.length;
        await plugin.sendReminderWebhookNotification('提醒', '任务到期');
        assert.equal(warnings.length, warningCount + 1, '实际提醒同样应记录业务失败');
        assert.equal(requests.at(-1).payload.msgtype, 'text');

        responseBody = '{"errcode":0,"errmsg":"ok"}';
        await plugin.sendReminderWebhookNotification('提醒', '任务到期');
        assert.equal(warnings.length, warningCount + 1);

        responseStatus = 403;
        await assert.rejects(plugin.sendTestWebhook(url, '', 'wecom'), /HTTP 403/);
        responseStatus = 200;
        for (responseBody of ['', 'ok', '{"accepted":true}']) {
            assert.equal(await plugin.sendTestWebhook(url, '{"message":"${message}"}', 'custom'), true);
        }
        responseStatus = 204;
        responseBody = '';
        assert.equal(await plugin.sendTestWebhook(url, '{}', 'custom'), true);
    }
    console.log('Webhook payload, legacy settings, direct/proxy responses and reminder behavior OK');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
