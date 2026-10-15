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
const autoUtils = evaluate(fs.readFileSync(path.join(root, 'src/utils/taskListAutoSort.ts'), 'utf8'), {
    './taskListSort': utils,
});

function block(type, id, subtype = 't', marker = ' ') {
    const attrs = { 'data-type': type, 'data-node-id': id, 'data-subtype': subtype, 'data-task': marker };
    return {
        dataset: { nodeId: id }, children: [], parentElement: null,
        getAttribute: key => attrs[key] ?? null,
        setAttribute: (key, value) => { attrs[key] = value; },
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
    const methods = cls.members.filter(node => ['handleBlockMenu', 'addTaskListSortMenu', 'addTaskListAutoSortMenu'].includes(node.name?.getText(ast)));
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

function autoSortFixture(parents) {
    const snapshots = new Map();
    const calls = [];
    const errors = [];
    let writable = true;
    let queue = Promise.resolve();
    let nextSnapshot = 0;
    const snapshot = (items, lists = []) => {
        const key = `snapshot-${++nextSnapshot}`;
        snapshots.set(key, { items, lists });
        return key;
    };
    global.DOMParser = class {
        parseFromString(value) {
            assert.ok(snapshots.has(value), `Unknown DOM snapshot: ${value}`);
            const dom = snapshots.get(value);
            return { querySelectorAll: selector => selector.includes('data-type="NodeList"') ? dom.lists : dom.items };
        }
    };
    const request = async (url, data) => {
        calls.push({ url, data });
        const parent = parents.find(parent => parent.dataset.nodeId === data.id);
        if (url.endsWith('getBlockSiblingID')) {
            return { parent: parents.find(parent => parent.children.some(item => item.dataset.nodeId === data.id))?.dataset.nodeId };
        }
        if (url.endsWith('getBlockDOM')) return { dom: snapshot(parent.children, [parent]) };
        if (url.endsWith('setBlockAttrs')) {
            for (const [key, value] of Object.entries(data.attrs)) parent.setAttribute(key, value);
            return null;
        }
        if (url === '/api/transactions') {
            for (const transaction of data.transactions) {
                const parent = parents.find(parent => parent.dataset.nodeId === transaction.doOperations[0].parentID);
                move(parent.children, transaction.doOperations);
            }
            return [];
        }
        throw new Error(`Unexpected auto-sort request: ${url}`);
    };
    const sorter = new autoUtils.TaskListAutoSorter({
        request,
        enqueue: work => {
            const pending = queue.then(work);
            queue = pending.catch(() => {});
            return pending;
        },
        context: { app: 'app', session: 'plugin' },
        canSort: () => writable,
        onError: error => errors.push(error),
    });
    function complete(changes) {
        const before = [];
        const after = [];
        for (const [item, marker] of changes) {
            before.push(block('NodeListItem', item.dataset.nodeId, 't', item.getAttribute('data-task')));
            item.setAttribute('data-task', marker);
            after.push(block('NodeListItem', item.dataset.nodeId, 't', marker));
        }
        return { cmd: 'transactions', app: 'app', data: [{
            undoOperations: [{ action: 'update', data: snapshot(before) }],
            doOperations: [{ action: 'update', data: snapshot(after) }],
        }] };
    }
    return { sorter, calls, errors, complete, drain: () => queue, setWritable: value => { writable = value; } };
}

test('自动排序开关保存到当前列表，重建控制器可读取，取消后清除，聚焦列表项能定位父列表', async () => {
    const parent = list([' ', 'X']);
    let env = autoSortFixture([parent]);
    const targets = [{ id: 'root-0', kind: 'item' }];
    await env.sorter.toggle(targets, 'bottom', () => true);
    assert.equal(parent.getAttribute(autoUtils.TASK_LIST_AUTO_SORT_ATTR), 'bottom');
    env = autoSortFixture([parent]);
    assert.deepEqual(await env.sorter.getStates(targets), [{ id: 'root', position: 'bottom' }]);
    await env.sorter.toggle(targets, 'bottom', () => true);
    assert.equal(parent.getAttribute(autoUtils.TASK_LIST_AUTO_SORT_ATTR), '');
    assert.deepEqual(await env.sorter.getStates(targets), [{ id: 'root', position: null }]);
});

test('已开启列表持续追加新完成任务，包括最后一个未完成任务；其他列表和嵌套子列表不继承', async () => {
    const parent = list([' ', ' ', 'X']);
    const other = list([' ', 'X'], 'other');
    const nested = list([' ', 'X'], 'nested');
    parent.children[0].children.push(nested);
    const env = autoSortFixture([parent, other, nested]);
    await env.sorter.toggle([{ id: 'root', kind: 'list' }], 'bottom', () => true);
    const first = parent.children[0];
    const last = parent.children[1];
    env.sorter.handleTransactions(env.complete([[first, 'X'], [other.children[0], 'X'], [nested.children[0], 'X']]));
    await env.drain();
    assert.deepEqual(parent.children.map(item => item.dataset.nodeId), ['root-1', 'root-2', 'root-0']);
    assert.deepEqual(other.children.map(item => item.dataset.nodeId), ['other-0', 'other-1']);
    assert.deepEqual(nested.children.map(item => item.dataset.nodeId), ['nested-0', 'nested-1']);
    env.sorter.handleTransactions(env.complete([[last, 'x']]));
    await env.drain();
    assert.deepEqual(parent.children.map(item => item.dataset.nodeId), ['root-2', 'root-0', 'root-1']);
    assert.equal(env.calls.filter(call => call.url === '/api/transactions').length, 2);
    assert.equal(parent.getAttribute(autoUtils.TASK_LIST_AUTO_SORT_ATTR), 'bottom');
    assert.deepEqual(env.errors, []);
});

test('取消开关、只读、卸载以及其他客户端事务不自动排序', async () => {
    const parent = list([' ', 'X']);
    const env = autoSortFixture([parent]);
    const targets = [{ id: 'root', kind: 'list' }];
    await env.sorter.toggle(targets, 'bottom', () => true);
    await env.sorter.toggle(targets, 'bottom', () => true);
    env.sorter.handleTransactions(env.complete([[parent.children[0], 'X']]));
    await env.drain();
    assert.equal(env.calls.some(call => call.url === '/api/transactions'), false);
    env.setWritable(false);
    await env.sorter.toggle(targets, 'bottom', () => true);
    const count = env.calls.length;
    env.sorter.handleTransactions(env.complete([[parent.children[0], 'X']]));
    await env.drain();
    assert.equal(env.calls.length, count);
    env.setWritable(true);
    await env.sorter.toggle(targets, 'bottom', () => true);
    parent.children[0].setAttribute('data-task', ' ');
    const event = env.complete([[parent.children[0], 'X']]);
    event.app = 'another-app';
    const remoteCount = env.calls.length;
    env.sorter.handleTransactions(event);
    await env.drain();
    assert.equal(env.calls.length, remoteCount);
});

test('同批完成多个任务只提交一个事务，按列表原顺序追加且可以撤销', async () => {
    const parent = list([' ', 'X', ' ', ' ']);
    const env = autoSortFixture([parent]);
    await env.sorter.toggle([{ id: 'root', kind: 'list' }], 'bottom', () => true);
    const original = [...parent.children];
    env.sorter.handleTransactions(env.complete([
        [parent.children[2], 'X'], [parent.children[0], 'X'], [parent.children[3], 'X'],
    ]));
    await env.drain();
    assert.deepEqual(parent.children.map(item => item.dataset.nodeId), ['root-1', 'root-0', 'root-2', 'root-3']);
    const transactions = env.calls.filter(call => call.url === '/api/transactions');
    assert.equal(transactions.length, 1);
    move(parent.children, transactions[0].data.transactions[0].undoOperations);
    assert.deepEqual(parent.children, original);
});

test('事务仅在从未完成转为完成时触发，正文编辑、取消完成、排序回声及撤销不触发', () => {
    const parent = list([' ', 'X']);
    const env = autoSortFixture([parent]);
    assert.deepEqual(autoUtils.getNewlyCompletedTaskIds(env.complete([[parent.children[0], 'X']])), ['root-0']);
    assert.deepEqual(autoUtils.getNewlyCompletedTaskIds(env.complete([[parent.children[0], 'X']])), []);
    assert.deepEqual(autoUtils.getNewlyCompletedTaskIds(env.complete([[parent.children[0], ' ']])), []);
    const replay = env.complete([[parent.children[0], 'X']]);
    replay.context = { isUndoReplay: true };
    assert.deepEqual(autoUtils.getNewlyCompletedTaskIds(replay), []);
    assert.deepEqual(autoUtils.getNewlyCompletedTaskIds({ cmd: 'transactions', data: [{
        doOperations: [{ action: 'move', id: 'root-0', previousID: 'root-1' }],
    }] }), []);
});

test('固定顶部方向只将本次完成项移到最前，事务可以撤销', async () => {
    const parent = list(['X', ' ', ' ']);
    const env = autoSortFixture([parent]);
    await env.sorter.toggle([{ id: 'root', kind: 'list' }], 'top', () => true);
    const original = [...parent.children];
    env.sorter.handleTransactions(env.complete([[parent.children[2], 'X']]));
    await env.drain();
    assert.deepEqual(parent.children.map(item => item.dataset.nodeId), ['root-2', 'root-0', 'root-1']);
    const transaction = env.calls.find(call => call.url === '/api/transactions').data.transactions[0];
    move(parent.children, transaction.undoOperations);
    assert.deepEqual(parent.children, original);
});

test('菜单显示开关独立于手动排序，菜单勾选反映当前列表状态，点击可持续开启或取消', async () => {
    const env = menuFixture(false, { enableTaskListSort: false });
    const auto = autoSortFixture([env.parent]);
    env.plugin.taskListAutoSorter = auto.sorter;
    const items = [];
    const open = () => {
        items.length = 0;
        env.plugin.handleBlockMenu({ detail: { ...env.detail, menu: { addItem: item => items.push(item) } } });
        return items.find(item => item.label === 'taskListAutoSort');
    };
    let item = open();
    assert.ok(item);
    await item.click();
    item = open();
    let checked = '';
    const element = { setAttribute() {}, removeAttribute() {}, insertAdjacentHTML: (_position, html) => { checked = html; } };
    item.bind(element);
    // 等待绑定时读取快照及菜单刷新完成。
    await new Promise(resolve => setImmediate(resolve));
    assert.match(checked, /b3-menu__checked/);
    await item.click();
    assert.equal(env.parent.getAttribute(autoUtils.TASK_LIST_AUTO_SORT_ATTR), '');
    env.plugin.settings.showTaskListAutoSortMenu = false;
    assert.equal(open(), undefined);
});

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
