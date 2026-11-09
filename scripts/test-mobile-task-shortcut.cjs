// Run with: node --test scripts/test-mobile-task-shortcut.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/render/MobileTaskShortcut.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function environment(checkVip = async () => true) {
    const storage = new Map();
    let upgrades = 0;
    let opened = 0;
    const exports = {};
    const requireMock = name => {
        if (name === 'siyuan') return { getFrontend: () => 'mobile', showMessage() {} };
        if (name.endsWith('/pluginInstance')) return { i18n: key => key };
        if (name.endsWith('/vip/vip')) return { VipManager: { isVip: checkVip } };
        return {};
    };
    const localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };
    new Function('require', 'exports', 'localStorage', source)(requireMock, exports, localStorage);
    const shortcut = new exports.MobileTaskShortcut({ openVipDialog() { upgrades++; } });
    const button = { isConnected: true };
    shortcut.button = button;
    shortcut.expandButton = () => {};
    shortcut.createDialog = () => { opened++; shortcut.dialog = {}; };
    return { shortcut, storage, button, get upgrades() { return upgrades; }, get opened() { return opened; } };
}

test('非 VIP 保留入口，只打开开通弹窗而不创建快捷面板', async () => {
    const env = environment(async () => false);
    await env.shortcut.openDialog();
    assert.equal(env.upgrades, 1);
    assert.equal(env.opened, 0);
    assert.equal(env.shortcut.button, env.button);
    assert.equal(env.shortcut.dialog, null);
});

test('VIP 校验中的重复点击不重复创建窗口', async () => {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const env = environment(() => pending);
    const first = env.shortcut.openDialog();
    await env.shortcut.openDialog();
    assert.equal(env.opened, 0);
    resolve(true);
    await first;
    assert.equal(env.opened, 1);
    assert.equal(env.upgrades, 0);
    await env.shortcut.openDialog();
    assert.equal(env.opened, 1);
});

test('等待 VIP 校验期间组件销毁或入口移除，不再打开窗口', async () => {
    for (const remove of [env => { env.shortcut.disposed = true; }, env => { env.button.isConnected = false; }, env => { env.shortcut.button = { isConnected: true }; }]) {
        let resolve;
        const env = environment(() => new Promise(done => { resolve = done; }));
        const opening = env.shortcut.openDialog();
        remove(env);
        resolve(true);
        await opening;
        assert.equal(env.opened, 0);
        assert.equal(env.upgrades, 0);
    }
});

test('恢复已保存顺序，过滤重复和失效页签并补齐新增面板', () => {
    const env = environment();
    env.storage.set('siyuan-task-shortcut-tab-order', JSON.stringify(['calendar', 'calendar', 'missing', 'habit']));
    assert.deepEqual(env.shortcut.getTabs().map(tab => tab.id), ['calendar', 'habit', 'task', 'project']);
    env.storage.set('siyuan-task-shortcut-tab-order', '{}');
    assert.deepEqual(env.shortcut.getTabs().map(tab => tab.id), ['task', 'project', 'habit', 'calendar']);
});
