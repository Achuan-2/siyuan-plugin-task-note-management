const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const translations = require('../i18n/zh_CN.json');
const i18n = (key, params = {}) => translations[key]?.replace(/\$\{([^}]+)\}/g, (_, name) => params[name]);

function load(relative, mocks) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
        assert.ok(name in mocks, `Unexpected import: ${name}`);
        return mocks[name];
    }, module, module.exports);
    return module.exports;
}

function fixture(t, handler) {
    const original = { fetch: global.fetch, window: global.window };
    const calls = [];
    let counter = 0;
    global.window = { Lute: { NewNodeID: () => `20261029120000-${String(++counter).padStart(7, '0')}` } };
    global.fetch = async (url, options) => {
        const data = JSON.parse(options.body);
        calls.push({ url, data });
        const result = await handler(url, data);
        return { ok: !result.status || result.status === 200, status: result.status || 200, json: async () => result };
    };
    t.after(() => Object.assign(global, original));
    const { createDocumentWithMarkdown: create } = load('src/utils/documentCreation.ts', { '../pluginInstance': { i18n } });
    return { create, calls };
}

const success = data => ({ code: 0, data });
const resolved = (parent = null) => ({
    status: 'resolved', start: { id: null, revision: 'root-revision' },
    resolved: parent, nextIndex: parent ? 1 : 0, nameConditions: []
});

test('根路径使用新版接口，保留正文和返回 ID', async t => {
    const f = fixture(t, (url, data) => url.endsWith('resolveDocPath')
        ? success(resolved()) : success({ id: data.id }));
    const id = await f.create('notebook', '/test', '# 内容');
    assert.deepEqual(f.calls[0].data, { notebook: 'notebook', start: { kind: 'root' }, segments: [] });
    assert.deepEqual(f.calls[1].data, {
        notebook: 'notebook', parentID: null, id,
        title: { format: 'plain', text: 'test' }, markdown: '# 内容',
        expectedParentRevision: 'root-revision', nameConditions: []
    });
});

test('日期路径的缺失父级逐级创建，已有父级复用且正文仅写入最终文档', async t => {
    const parents = [];
    const f = fixture(t, (url, data) => {
        if (url.endsWith('resolveDocPath')) {
            const parent = parents.at(-1) || null;
            return success({ ...resolved(parent), status: parents.length < 2 ? 'missing' : 'resolved',
                nextIndex: parents.length,
                nameConditions: [{ parentID: parent?.id || null, title: data.segments[parents.length] || '2026-10-29', expectedID: null }] });
        }
        parents.push({ id: data.id, revision: `revision-${parents.length}` });
        return success({ id: data.id });
    });
    const id = await f.create('notebook', '/2026/2026-10-29/test', '正文');
    const writes = f.calls.filter(call => call.url.endsWith('createDocByParent'));
    assert.deepEqual(writes.map(call => [call.data.title.text, call.data.markdown]), [
        ['2026', ''], ['2026-10-29', ''], ['test', '正文']
    ]);
    assert.deepEqual(writes.map(call => call.data.parentID), [null, parents[0].id, parents[1].id]);
    assert.equal(writes[1].data.expectedParentRevision, 'revision-0');
    assert.equal(writes[1].data.nameConditions[0].title, '2026-10-29');
    assert.equal(id, parents[2].id);
});

test('已有日期父文档直接按身份创建，不重复创建父级', async t => {
    const f = fixture(t, (url, data) => url.endsWith('resolveDocPath')
        ? success(resolved({ id: 'date-doc', revision: 'revision' })) : success({ id: data.id }));
    await f.create('notebook', '/2026-10-29/test', '');
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].data.parentID, 'date-doc');
});

test('仅在只读接口不存在时回退旧版接口', async t => {
    const f = fixture(t, url => url.endsWith('resolveDocPath') ? { status: 404 } : success('legacy-id'));
    assert.equal(await f.create('notebook', '/date/test', '正文'), 'legacy-id');
    assert.equal(f.calls[1].url, '/api/filetree/createDocWithMd');
    assert.deepEqual(f.calls[1].data, { notebook: 'notebook', path: '/date/test', markdown: '正文' });
});

for (const [name, result, message] of [
    ['元数据未就绪', { code: -1, msg: 'document metadata is not ready', data: { reason: 'indexUnavailable' } }, /元数据尚未就绪/],
    ['同名父文档', success({ ...resolved(), status: 'ambiguous' }), /同名文档/],
    ['无权限', { status: 401 }, /HTTP 401/],
    ['无效响应', success({ ...resolved(), status: 'unexpected' }), /创建文档失败/]
]) {
    test(`${name}时停止，不回退或写入文档`, async t => {
        const f = fixture(t, () => result);
        await assert.rejects(f.create('notebook', '/date/test', ''), message);
        assert.equal(f.calls.length, 1);
    });
}

for (const [name, handler, message] of [
    ['内核拒绝写入', () => ({ code: -1, msg: 'parent document changed after planning' }), /parent document changed/],
    ['响应丢失', () => { throw new Error('network error'); }, /network error/],
    ['无效 ID', () => success({ id: 'wrong-id' }), /创建文档失败/],
    ['已落盘但后续失败', (_, data) => ({ code: -1, msg: 'sort failed', data: { id: data.id, commitState: 'sourceCommitted' } }), /sort failed/]
]) {
    test(`${name}时保留尝试 ID，不自动重试或回退`, async t => {
        const f = fixture(t, (url, data) => url.endsWith('resolveDocPath') ? success(resolved()) : handler(url, data));
        await assert.rejects(f.create('notebook', '/test', ''), error => {
            assert.match(error.message, message);
            assert.match(error.message, /20261029120000-0000001/);
            return true;
        });
        assert.equal(f.calls.length, 2);
    });
}

test('旧版失败不被 request 吞成 null', async t => {
    const f = fixture(t, url => url.endsWith('resolveDocPath') ? { status: 404 } : { code: -1, msg: 'legacy error' });
    await assert.rejects(f.create('notebook', '/test', ''), /legacy error/);
});

function dialogFixture(api) {
    const messages = [];
    const { BlockBindingDialog } = load('src/components/dialog/BlockBindingDialog.ts', {
        siyuan: { Dialog: class {}, showMessage: (...args) => messages.push(args) },
        '../../pluginInstance': { i18n }, '../../api': api
    });
    const button = { disabled: false };
    let destroyed = false;
    const dialog = Object.create(BlockBindingDialog.prototype);
    dialog.dialog = { element: { querySelector: selector => selector === '#quickCreateConfirmBtn'
        ? button : { getAttribute: () => 'document' } }, destroy: () => { destroyed = true; } };
    return { dialog, button, messages, destroyed: () => destroyed };
}

test('绑定对话框防重复确认，失败转义提示且保留对话框', async () => {
    const f = dialogFixture({});
    let fail;
    let calls = 0;
    f.dialog.handleDocumentConfirm = () => { calls++; return new Promise((_, reject) => { fail = reject; }); };
    const operation = f.dialog.handleConfirm();
    assert.equal(f.button.disabled, true);
    await f.dialog.handleConfirm();
    assert.equal(calls, 1);
    const originalError = console.error;
    console.error = () => {};
    try {
        fail(new Error('<b>error</b>\nretry'));
        await operation;
    } finally { console.error = originalError; }
    assert.equal(f.messages[0][0], '&lt;b&gt;error&lt;/b&gt;<br>retry');
    assert.equal(f.button.disabled, false);
    assert.equal(f.destroyed(), false);
});

test('绑定对话框保留笔记本解析及日期模板，成功后回调绑定并关闭', async () => {
    const f = dialogFixture({
        renderSprig: async text => text.replace('{{now | date "2006-01-02"}}', '2026-10-29'),
        createDocWithMd: async (...args) => {
            assert.deepEqual(args, ['notebook', '/2026-10-29/test', '正文']);
            return 'created-id';
        }
    });
    f.dialog.plugin = { loadSettings: async () => ({}) };
    f.dialog.notebooks = { notebooks: [{ id: 'notebook', name: '000-日历视图' }] };
    let bound;
    f.dialog.callback = id => { bound = id; };
    const inputs = { '#docTitleInput': 'test', '#docParentPathInput': '/000-日历视图/{{now | date "2006-01-02"}}/', '#docContentInput': '正文' };
    const originalQuery = f.dialog.dialog.element.querySelector;
    f.dialog.dialog.element.querySelector = selector => selector in inputs ? { value: inputs[selector] } : originalQuery(selector);
    await f.dialog.handleConfirm();
    assert.equal(bound, 'created-id');
    assert.equal(f.destroyed(), true);
});
