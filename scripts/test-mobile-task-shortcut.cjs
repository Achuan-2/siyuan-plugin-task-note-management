// Run with: node --test scripts/test-mobile-task-shortcut.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/render/MobileTaskShortcut.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function environment(checkVip = async () => true, globals = {}) {
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
    new Function('require', 'exports', 'localStorage', ...Object.keys(globals), source)(requireMock, exports, localStorage, ...Object.values(globals));
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

function positionEnvironment({ visualViewport = true } = {}) {
    const eventTarget = () => {
        const listeners = new Map();
        return {
            listeners,
            addEventListener: (type, listener) => listeners.set(type, listener),
            removeEventListener: type => listeners.delete(type),
            emit: type => listeners.get(type)?.(),
        };
    };
    const observers = [];
    class Observer {
        constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
        observe(target) { this.targets.push(target); }
        disconnect() { this.targets = []; }
    }
    const frames = new Map();
    let frameId = 0;
    const viewport = Object.assign(eventTarget(), { offsetTop: 0, height: 800 });
    const window = Object.assign(eventTarget(), {
        innerWidth: 400, innerHeight: 800,
        visualViewport: visualViewport ? viewport : null,
        requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame(id) { frames.delete(id); },
    });
    const toolbar = {
        hidden: true, top: 752, height: 48,
        classList: { contains: () => toolbar.hidden },
        getBoundingClientRect: () => toolbar.hidden
            ? { top: 0, bottom: 0, width: 0, height: 0 }
            : { top: toolbar.top, bottom: toolbar.top + toolbar.height, width: 400, height: toolbar.height },
    };
    const document = { body: {}, getElementById: () => toolbar };
    const env = environment(undefined, { window, document, MutationObserver: Observer, ResizeObserver: Observer });
    Object.assign(env.button, {
        style: { left: '374px', top: '676px' }, offsetWidth: 52, offsetHeight: 52,
        classList: { add() {}, remove() {} },
        getBoundingClientRect: () => ({ left: parseFloat(env.button.style.left), top: parseFloat(env.button.style.top), width: 52, height: 52 }),
    });
    env.shortcut.preferredTop = 676;
    env.shortcut.watchPosition();
    return { ...env, window, viewport, toolbar, observers, frames,
        flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    };
}

test('键盘压缩可见区域时上移并避让工具栏，收起后恢复原位置且不改写存储', () => {
    const env = positionEnvironment();
    env.shortcut.savePosition();
    const saved = env.storage.get('siyuan-task-shortcut-pos');
    env.viewport.height = 480;
    env.toolbar.hidden = false;
    env.toolbar.top = 432;
    env.viewport.emit('resize');
    env.flush();
    assert.equal(env.button.style.top, '372px');
    assert.equal(env.button.style.left, '374px');
    env.shortcut.savePosition();
    assert.equal(env.storage.get('siyuan-task-shortcut-pos'), saved);
    env.toolbar.hidden = true;
    env.viewport.height = 800;
    env.viewport.emit('resize');
    env.flush();
    assert.equal(env.button.style.top, '676px');
});

test('无 visualViewport 时响应宿主窗口和工具栏变化，自由停放按钮也保持避让', () => {
    const env = positionEnvironment({ visualViewport: false });
    env.shortcut.dockState = null;
    env.button.style.left = '160px';
    env.window.innerHeight = 480;
    env.window.emit('resize');
    env.flush();
    assert.equal(env.button.style.top, '428px');
    env.toolbar.hidden = false;
    env.toolbar.top = 400;
    env.observers[0].callback();
    env.flush();
    assert.equal(env.button.style.top, '340px');
    assert.equal(env.button.style.left, '160px');
    env.toolbar.top = 300;
    env.observers[1].callback();
    env.flush();
    assert.equal(env.button.style.top, '240px');
});

test('可见区域滚动后限制上下边界，顶部为零的已保存位置不会被重置', () => {
    const env = positionEnvironment();
    env.shortcut.preferredTop = 0;
    env.shortcut.applyDock();
    assert.equal(env.button.style.top, '0px');
    env.viewport.offsetTop = 100;
    env.viewport.height = 400;
    env.viewport.emit('scroll');
    env.flush();
    assert.equal(env.button.style.top, '100px');
    env.shortcut.preferredTop = 676;
    env.shortcut.applyDock();
    assert.equal(env.button.style.top, '448px');
});

test('移除按钮时清理监听、观察器和待执行的位置更新', () => {
    const env = positionEnvironment();
    env.button.remove = () => {};
    env.window.emit('resize');
    assert.equal(env.frames.size, 1);
    env.shortcut.removeButton();
    assert.equal(env.frames.size, 0);
    assert.equal(env.window.listeners.size, 0);
    assert.equal(env.viewport.listeners.size, 0);
    assert.ok(env.observers.every(observer => observer.targets.length === 0));
    assert.equal(env.shortcut.button, null);
});
