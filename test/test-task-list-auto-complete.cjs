const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/utils', file), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(name => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, exports);
    return exports;
}

const sorting = load('taskListAutoSort.ts', { './taskListSort': {} });
const { TaskListAutoCompleter } = load('taskListAutoComplete.ts', { './taskListAutoSort': sorting });

function item(id, marker = ' ', children = [], type = 'NodeListItem', subtype = 't') {
    return { id, marker, children, type, subtype };
}

function descendants(node) {
    return node.children.flatMap(child => [child, ...descendants(child)]);
}

function element(node) {
    return {
        getAttribute: key => ({ 'data-node-id': node.id, 'data-task': node.marker })[key] ?? null,
        querySelector: () => null,
        querySelectorAll: () => descendants(node)
            .filter(child => child.type === 'NodeListItem' && child.subtype === 't').map(element),
    };
}

function fixture(t, nodes = []) {
    const previousParser = global.DOMParser;
    let parses = 0;
    global.DOMParser = class {
        parseFromString(html) {
            parses++;
            const roots = JSON.parse(html || '[]');
            return { querySelectorAll: () => roots.flatMap(root => [root, ...descendants(root)])
                .filter(node => node.type === 'NodeListItem' && node.subtype === 't').map(element) };
        }
    };
    t.after(() => { global.DOMParser = previousParser; });
    let enabled = true;
    let queue = Promise.resolve();
    const calls = [], errors = [];
    const allNodes = () => nodes.flatMap(root => [root, ...descendants(root)]);
    const request = async (url, data) => {
        calls.push({ url, data });
        if (url.endsWith('getBlockDOM')) {
            const root = allNodes().find(node => node.id === data.id);
            return { dom: JSON.stringify(root ? [root] : []) };
        }
        assert.equal(url, '/api/block/batchUpdateTaskListItemMarker');
        for (const { id, marker } of data.items) allNodes().find(node => node.id === id).marker = marker;
    };
    const options = {
        request, app: 'app', canComplete: () => enabled,
        enqueue: work => {
            const pending = queue.then(work);
            queue = pending.catch(() => {});
            return pending;
        },
        onError: error => errors.push(error),
    };
    const completer = new TaskListAutoCompleter(options);
    t.after(() => completer.destroy());
    const event = (id, before = ' ', after = 'X') => ({
        cmd: 'transactions', app: 'app', data: [{
            doOperations: [{ action: 'update', data: JSON.stringify([item(id, after)]) }],
            undoOperations: [{ action: 'update', data: JSON.stringify([item(id, before)]) }],
        }],
    });
    return {
        completer, options, calls, errors, event,
        drain: async () => { await queue; await Promise.resolve(); },
        setEnabled: value => { enabled = value; },
        parses: () => parses,
        writes: () => calls.filter(call => call.url.endsWith('batchUpdateTaskListItemMarker')),
    };
}

test('勾选父项批量完成全部层级的子任务，保留正文、已完成项及外部任务', async t => {
    const grandchild = item('grandchild', '/');
    const child = item('child', ' ', [grandchild]);
    const done = item('done', 'X', [item('below-done')]);
    const ordinary = item('ordinary', ' ', [item('nested-task', '-')], 'NodeListItem', 'u');
    const parent = item('parent', 'X', [child, done, ordinary, item('paragraph', ' ', [], 'NodeParagraph')]);
    const sibling = item('sibling');
    parent.note = '正文和自定义属性';
    const env = fixture(t, [parent, sibling]);
    env.completer.handleTransactions(env.event('parent'));
    await env.drain();
    assert.deepEqual(env.writes().map(call => call.data.items), [[
        { id: 'child', marker: 'x' }, { id: 'grandchild', marker: 'x' },
        { id: 'below-done', marker: 'x' }, { id: 'nested-task', marker: 'x' },
    ]]);
    assert.equal(done.marker, 'X');
    assert.equal(ordinary.marker, ' ');
    assert.equal(sibling.marker, ' ');
    assert.equal(parent.note, '正文和自定义属性');
    assert.deepEqual(env.errors, []);
});

test('关闭开关时不解析事务或请求接口，重新开启立即对新勾选生效', async t => {
    const env = fixture(t, [item('parent', 'x', [item('child')])]);
    env.setEnabled(false);
    env.completer.handleTransactions(env.event('parent'));
    await env.drain();
    assert.equal(env.parses(), 0);
    assert.deepEqual(env.calls, []);
    env.setEnabled(true);
    env.completer.handleTransactions(env.event('parent'));
    await env.drain();
    assert.equal(env.writes().length, 1);
});

test('取消勾选、编辑已完成正文、撤销、移动及其他客户端事务均不联动', async t => {
    const env = fixture(t, [item('parent', 'X', [item('child')])]);
    const undo = env.event('parent');
    undo.context = { isUndoReplay: true };
    const remote = env.event('parent');
    remote.app = 'other-app';
    const move = env.event('parent');
    move.data[0].doOperations[0].action = 'move';
    for (const event of [env.event('parent', 'X', ' '), env.event('parent', 'X', 'X'), undo, remote, move]) {
        env.completer.handleTransactions(event);
    }
    await env.drain();
    assert.deepEqual(env.calls, []);
});

test('普通正文连续编辑 1000 次不创建 HTML 文档或请求接口', async t => {
    const env = fixture(t);
    const event = { cmd: 'transactions', data: [{ doOperations: [{
        action: 'update', data: '<div data-type="NodeParagraph">普通输入</div>',
    }] }] };
    for (let index = 0; index < 1000; index++) env.completer.handleTransactions(event);
    await env.drain();
    assert.equal(env.parses(), 0);
    assert.deepEqual(env.calls, []);
});

test('读取最新完整快照，父项已取消、删除或没有未完成子项时不写入', async t => {
    const env = fixture(t, [item('unchecked', ' ', [item('child')]), item('done', 'X', [item('done-child', 'x')])]);
    for (const id of ['unchecked', 'deleted', 'done']) env.completer.handleTransactions(env.event(id));
    await env.drain();
    assert.equal(env.writes().length, 0);
    assert.equal(env.calls.length, 3);
});

test('重叠父子完成事务和重复广播不重复写入，接口广播不会递归触发', async t => {
    const env = fixture(t, [item('parent', 'X', [item('child', 'X', [item('grandchild')])])]);
    env.completer.handleTransactions(env.event('parent'));
    env.completer.handleTransactions(env.event('child'));
    env.completer.handleTransactions(env.event('parent'));
    await env.drain();
    assert.equal(env.writes().length, 1);
    assert.deepEqual(env.writes()[0].data.items, [{ id: 'grandchild', marker: 'x' }]);
    const broadcast = env.event('grandchild');
    delete broadcast.data[0].undoOperations;
    const callCount = env.calls.length;
    env.completer.handleTransactions(broadcast);
    await env.drain();
    assert.equal(env.calls.length, callCount);
});

test('排队后关闭开关或销毁时停止操作', async t => {
    const env = fixture(t, [item('parent', 'X', [item('child')])]);
    env.completer.handleTransactions(env.event('parent'));
    env.setEnabled(false);
    await env.drain();
    assert.deepEqual(env.calls, []);
    env.setEnabled(true);
    env.completer.handleTransactions(env.event('parent'));
    env.completer.destroy();
    await env.drain();
    assert.deepEqual(env.calls, []);
});

test('快照请求期间关闭开关时不写入，接口失败通过错误回调报告', async t => {
    const env = fixture(t, [item('parent', 'X', [item('child')])]);
    const request = env.options.request;
    env.options.request = async (...args) => {
        const response = await request(...args);
        env.setEnabled(false);
        return response;
    };
    env.completer.handleTransactions(env.event('parent'));
    await env.drain();
    assert.equal(env.writes().length, 0);
    env.setEnabled(true);
    const failure = new Error('test request failure');
    env.options.request = async () => { throw failure; };
    env.completer.handleTransactions(env.event('parent'));
    await env.drain();
    assert.deepEqual(env.errors, [failure]);
});
