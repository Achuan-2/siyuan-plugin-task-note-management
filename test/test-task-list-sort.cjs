const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function evaluate(source, dependencies = {}) {
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
        assert.ok(name in dependencies, `Missing test dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports);
    return module.exports;
}

const utils = evaluate(fs.readFileSync(path.join(root, 'src/utils/taskListSort.ts'), 'utf8'));

function block(type, id, subtype = 't', marker = ' ') {
    const attrs = { 'data-type': type, 'data-node-id': id, 'data-subtype': subtype, 'data-task': marker };
    return {
        dataset: { nodeId: id }, children: [], parentElement: null,
        getAttribute: key => attrs[key] ?? null,
        hasAttribute: key => key in attrs,
        matches: selector => selector.includes(`data-type="${type}"`) && selector.includes(`data-subtype="${subtype}"`),
        querySelector: () => null,
    };
}

function list(markers, id = 'root') {
    const result = block('NodeList', id);
    result.children = markers.map((marker, index) => {
        const item = block('NodeListItem', `${id}-${index}`, 't', marker);
        item.parentElement = result;
        item.children = [{ text: '子块保留', custom: 'keep' }];
        return item;
    });
    return result;
}

function move(items, operations) {
    for (const operation of operations) {
        const index = items.findIndex(item => item.dataset.nodeId === operation.id);
        const [item] = items.splice(index, 1);
        const previous = operation.previousID ? items.findIndex(node => node.dataset.nodeId === operation.previousID) : -1;
        items.splice(previous + 1, 0, item);
    }
}

test('全部六项完成状态组合置顶/追加置底，逆事务恢复顺序且不改写任务子块', () => {
    for (let mask = 0; mask < 64; mask++) for (const position of ['top', 'bottom']) {
        const parent = list(Array.from({ length: 6 }, (_, index) => mask & (1 << index) ? index % 2 ? 'x' : 'X' : ' '));
        const original = [...parent.children];
        const nested = original.map(item => item.children);
        const done = original.filter(item => item.getAttribute('data-task').toUpperCase() === 'X');
        const todo = original.filter(item => !done.includes(item));
        const lastTodoIndex = original.indexOf(todo.at(-1));
        const oldCompleted = original.slice(lastTodoIndex + 1);
        const newlyCompleted = done.filter(item => !oldCompleted.includes(item));
        const expected = position === 'top' ? [...done, ...todo] : [...todo, ...oldCompleted, ...newlyCompleted];
        const plan = utils.createTaskSortPlan(parent, position);
        if (plan) move(parent.children, plan.doOperations);
        assert.deepEqual(parent.children, expected);
        assert.equal(utils.createTaskSortPlan(parent, position), null);
        if (plan) move(parent.children, plan.undoOperations);
        assert.deepEqual(parent.children, original);
        parent.children.forEach((item, index) => assert.equal(item.children, nested[index]));
    }
});

test('进行中、取消、自定义状态不算完成，兼容旧版 action 标记，忽略普通列表', () => {
    const parent = list(['X', '/', '-', '?', ' ']);
    const legacy = parent.children.at(-1);
    const getAttribute = legacy.getAttribute;
    legacy.getAttribute = key => key === 'data-task' ? null : getAttribute(key);
    legacy.querySelector = () => ({ getAttribute: () => 'x' });
    const plan = utils.createTaskSortPlan(parent, 'bottom');
    move(parent.children, plan.doOperations);
    assert.deepEqual(parent.children.map(item => item.dataset.nodeId), ['root-1', 'root-2', 'root-3', 'root-4', 'root-0']);
    assert.equal(utils.createTaskSortPlan(block('NodeList', 'ordinary', 'u'), 'top'), null);
});

test('新完成任务追加到已有完成任务之后，连续移动始终以列表末项为锚点', () => {
    const parent = list(['X', ' ', 'x', ' ', 'X', 'x']);
    const original = [...parent.children];
    const plan = utils.createTaskSortPlan(parent, 'bottom');
    assert.deepEqual(plan.doOperations, [
        { action: 'move', id: 'root-0', parentID: 'root', previousID: 'root-5' },
        { action: 'move', id: 'root-2', parentID: 'root', previousID: 'root-0' },
    ]);
    move(parent.children, plan.doOperations);
    assert.deepEqual(parent.children.map(item => item.dataset.nodeId),
        ['root-1', 'root-3', 'root-4', 'root-5', 'root-0', 'root-2']);
    assert.equal(utils.createTaskSortPlan(parent, 'bottom'), null);
    move(parent.children, plan.undoOperations);
    assert.deepEqual(parent.children, original);
});

test('列表块与列表项定位同级列表，多选去重，聚焦任务项保留接口解析目标', () => {
    const parent = list(['X', ' ']);
    const focused = block('NodeListItem', 'focused');
    assert.deepEqual(utils.getTaskListSortTargets([parent, ...parent.children, focused, block('NodeParagraph', 'text')]),
        [{ id: 'root', kind: 'list' }, { id: 'focused', kind: 'item' }]);
});

function apiFixture() {
    const parent = list(['X', ' ']);
    const calls = [];
    global.DOMParser = class {
        parseFromString(value) {
            assert.equal(value, 'snapshot');
            return { querySelectorAll: () => [parent] };
        }
    };
    const request = async (url, data) => {
        calls.push({ url, data });
        if (url.endsWith('getBlockSiblingID')) return { parent: 'root' };
        if (url.endsWith('getBlockDOM')) return { dom: 'snapshot' };
        if (url === '/api/transactions') {
            move(parent.children, data.transactions[0].doOperations);
            return [];
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    return { parent, calls, request };
}

test('读取完整快照并去重提交一个事务，已排序的列表不重复提交', async () => {
    const env = apiFixture();
    const targets = [{ id: 'root', kind: 'list' }, { id: 'root-0', kind: 'item' }];
    await utils.sortTaskLists(targets, 'bottom', env.request, { app: 'app', session: 'plugin' }, () => true);
    assert.equal(env.calls.filter(call => call.url.endsWith('getBlockDOM')).length, 1);
    const transactions = env.calls.filter(call => call.url === '/api/transactions');
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].data.session, 'plugin');
    assert.deepEqual(transactions[0].data.transactions[0].undoOperations,
        [{ action: 'move', id: 'root-0', parentID: 'root', previousID: '' }]);
    await utils.sortTaskLists(targets, 'bottom', env.request, { app: 'app', session: 'plugin' }, () => true);
    assert.equal(env.calls.filter(call => call.url === '/api/transactions').length, 1);
});

test('只读或读取期间卸载不提交排序，接口失败向菜单传播', async () => {
    const env = apiFixture();
    const targets = [{ id: 'root', kind: 'list' }];
    await utils.sortTaskLists(targets, 'bottom', env.request, { app: 'app', session: 'plugin' }, () => false);
    assert.equal(env.calls.length, 0);
    let writable = true;
    await utils.sortTaskLists(targets, 'bottom', async (...args) => {
        const value = await env.request(...args);
        writable = false;
        return value;
    }, { app: 'app', session: 'plugin' }, () => writable);
    assert.equal(env.calls.some(call => call.url === '/api/transactions'), false);
    await assert.rejects(utils.sortTaskLists(targets, 'bottom', async () => { throw new Error('network'); },
        { app: 'app', session: 'plugin' }, () => true), /network/);
});

function menuFixture(readOnly = false, settings = {}) {
    const env = apiFixture();
    const errors = [];
    const source = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPlugin');
    const methods = cls.members.filter(node => ['handleBlockMenu', 'addTaskListSortMenu'].includes(node.name?.getText(ast)));
    const Fixture = evaluate('import { getTaskListSortTargets, sortTaskLists, i18n, showMessage, fetchSyncPost } from "test-utils";\n' +
        `export class Fixture { ${methods.map(node => node.getText(ast)).join('\n')} }`, {
        'test-utils': { ...utils, i18n: key => key, showMessage: message => errors.push(message),
            fetchSyncPost: async (...args) => ({ code: 0, data: await env.request(...args) }) },
    }).Fixture;
    global.window = { siyuan: { config: { editor: { readOnly } } } };
    const plugin = new Fixture();
    Object.assign(plugin, { taskListSortQueue: Promise.resolve(), storageDisposed: false,
        app: { appId: 'app' }, name: 'plugin', settings: { pomodoroDirectStart: true, ...settings }, hasListChildren: () => false });
    const items = [];
    const detail = { blockElements: [env.parent.children[0]], menu: { addItem: item => items.push(item) },
        protyle: { options: { action: [] } } };
    plugin.handleBlockMenu({ detail });
    return { ...env, plugin, items, errors, detail };
}

test('现有块菜单入口提供两个排序操作，并保留设置任务和番茄钟菜单', async () => {
    const env = menuFixture();
    const sort = env.items.find(item => item.label === 'taskListSort');
    assert.deepEqual(sort.submenu.map(item => item.label), ['completedTasksToBottom', 'completedTasksToTop']);
    assert.ok(env.items.some(item => item.label === 'setTimeReminder'));
    assert.ok(env.items.some(item => item.label === 'startPomodoro'));
    await sort.submenu[0].click();
    assert.equal(env.calls.filter(call => call.url === '/api/transactions').length, 1);
    env.plugin.storageDisposed = true;
    const count = env.calls.length;
    await sort.submenu[1].click();
    assert.equal(env.calls.length, count);
    assert.deepEqual(env.errors, []);
});

test('只读菜单禁用，普通段落不显示任务排序菜单', async () => {
    const env = menuFixture(true);
    const sort = env.items.find(item => item.label === 'taskListSort');
    assert.ok(sort.submenu.every(item => item.disabled));
    await sort.submenu[0].click();
    assert.equal(env.calls.length, 0);
    const items = [];
    env.plugin.handleBlockMenu({ detail: { ...env.detail, blockElements: [block('NodeParagraph', 'text')],
        menu: { addItem: item => items.push(item) } } });
    assert.equal(items.some(item => item.label === 'taskListSort'), false);
});

test('关闭任务排序隐藏菜单，并阻止已打开菜单继续排序', async () => {
    const disabled = menuFixture(false, { enableTaskListSort: false });
    assert.equal(disabled.items.some(item => ['taskListSort', 'completedTasksToBottom', 'completedTasksToTop'].includes(item.label)), false);
    assert.ok(disabled.items.some(item => item.label === 'setTimeReminder'));
    assert.ok(disabled.items.some(item => item.label === 'startPomodoro'));

    const env = menuFixture();
    const sort = env.items.find(item => item.label === 'taskListSort');
    env.plugin.settings.enableTaskListSort = false;
    await sort.submenu[0].click();
    assert.equal(env.calls.length, 0);
});

for (const mode of ['bottom', 'top']) {
    test(`固定 ${mode} 模式直接显示对应菜单并执行排序，只读时禁用`, async () => {
        const settings = { enableTaskListSort: true, taskListSortMenuMode: mode };
        const env = menuFixture(false, settings);
        if (mode === 'top') env.parent.children.reverse();
        const label = mode === 'bottom' ? 'completedTasksToBottom' : 'completedTasksToTop';
        const otherLabel = mode === 'bottom' ? 'completedTasksToTop' : 'completedTasksToBottom';
        assert.equal(env.items.some(item => item.label === 'taskListSort' || item.label === otherLabel), false);
        const item = env.items.find(item => item.label === label);
        assert.ok(item);
        assert.equal(item.submenu, undefined);
        await item.click();
        assert.equal(env.calls.filter(call => call.url === '/api/transactions').length, 1);
        assert.equal(env.parent.children[mode === 'bottom' ? 1 : 0].getAttribute('data-task'), 'X');

        const readOnly = menuFixture(true, settings);
        const disabled = readOnly.items.find(item => item.label === label);
        assert.equal(disabled.disabled, true);
        await disabled.click();
        assert.equal(readOnly.calls.length, 0);
    });
}
