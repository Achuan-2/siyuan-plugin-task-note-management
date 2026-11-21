const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const blockA = '20261121000000-abcdefg';
const blockB = '20261121000001-hijklmn';
const docId = '20261121000002-opqrstu';
const blockUrl = id => `siyuan://blocks/${id}`;
const blockLink = id => `[Open Linked Block](${blockUrl(id)})`;

function fixture() {
    const subscription = {
        id: 'subscription', type: 'dida', projectId: 'project', enabled: true,
        didaToken: 'fixture-token', didaSelectedProjects: [{ id: 'list', name: 'List' }],
    };
    const remote = new Map();
    const writes = [];
    const blockUpdates = [];
    let local = {};
    let nextWriteStatus = 200;
    let createdSortOrder;

    const fetch = async (url, { method, body }) => {
        const endpoint = new URL(url).pathname.replace('/open/v1', '');
        if (endpoint === '/project') return Response.json(subscription.didaSelectedProjects);
        if (endpoint === '/project/list/data') return Response.json({ tasks: [...remote.values()] });
        if (endpoint === '/task/completed') return Response.json([]);
        assert.equal(method, 'POST');
        const payload = JSON.parse(body);
        writes.push(payload);
        const status = nextWriteStatus;
        nextWriteStatus = 200;
        if (status !== 200) return Response.json({ errorMessage: 'Rate limit' }, { status });
        const id = payload.id || `remote-${remote.size + 1}`;
        const task = { ...remote.get(id), ...payload, id, projectId: 'list' };
        if (!payload.id && createdSortOrder !== undefined) task.sortOrder = createdSortOrder;
        remote.set(id, task);
        return Response.json(task);
    };

    const dependencies = {
        '../api': {
            putFile: async (_path, _isDir, body) => { local = JSON.parse(await body.text()); },
            getBlockByID: async id => ({ id, root_id: docId }),
            updateBindBlockAtrrs: async (id, _plugin, reminders) => {
                blockUpdates.push([id, Object.values(reminders).filter(task => task.blockId === id).map(task => task.id)]);
            },
        },
        '../pluginInstance': { i18n: () => '' },
        './icsImport': { resolveDefaultKanbanStatus: async () => 'todo' },
        './caldavSubscription': {},
        './taskNoteStorage': {
            getTaskNotePreviewText: task => task.noteSummary || '',
            loadTaskNote: async () => '完整的任务备注',
        },
    };
    const modules = new Map();
    const load = name => {
        if (name in dependencies) return dependencies[name];
        if (!name.startsWith('.')) return require(name);
        if (!modules.has(name)) {
            const source = fs.readFileSync(path.join(__dirname, '../src/utils', `${name}.ts`), 'utf8');
            const code = ts.transpileModule(source, {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
            }).outputText;
            const exports = {};
            modules.set(name, exports);
            const window = {
                Lute: { NewNodeID: () => `local-${++nextId}` },
                dispatchEvent() {},
            };
            new Function('require', 'exports', 'fetch', 'window', 'console', code)(load, exports, fetch, window, { ...console, warn() {} });
        }
        return modules.get(name);
    };
    let nextId = 0;
    const api = load('./icsSubscription');
    const plugin = {
        loadSubscriptionData: async () => ({ subscriptions: { [subscription.id]: subscription } }),
        loadSubscriptionTasks: async () => structuredClone(local),
        loadReminderData: async () => ({}),
        saveReminderData: async () => {},
        loadProjectData: async () => ({}),
    };
    return {
        remote, writes, blockUpdates, subscription,
        sync: async () => assert.equal((await api.syncSubscription(plugin, subscription)).success, true),
        get: id => Object.values(local).find(task => task.didaTaskId === id),
        save: task => api.saveReminders(plugin, { [task.id]: task }),
        rateLimitNextWrite: () => { nextWriteStatus = 429; },
        setCreatedSortOrder: value => { createdSortOrder = value; },
    };
}

test('绑定任务创建、换绑和解绑只更新滴答详情里的思源链接', async () => {
    const f = fixture();
    await f.save({ id: 'local', projectId: 'project', title: '整理实验记录', notes: true, blockId: blockA, docId });
    assert.equal(f.writes[0].title, '整理实验记录');
    assert.equal(f.writes[0].content, `${blockLink(blockA)}\n\n完整的任务备注`);

    const task = f.get('remote-1');
    await f.save({ ...task, blockId: blockB });
    assert.equal(f.writes[1].content, `${blockLink(blockB)}\n\n完整的任务备注`);
    await f.save({ ...f.get('remote-1'), blockId: null, docId: null });
    assert.equal(f.writes[2].content, '完整的任务备注');
    await f.sync();
    assert.equal(f.get('remote-1').blockId, null);
    assert.equal(f.writes.length, 3);
});

test('拉回时从详情或整个链接标题恢复绑定，普通的思源链接保留在备注', async () => {
    const f = fixture();
    f.remote.set('details', { id: 'details', projectId: 'list', title: '远端任务', content: `${blockLink(blockA)}\n\n正文` });
    f.remote.set('title', { id: 'title', projectId: 'list', title: `[旧任务 [附录]](${blockUrl(blockB)})` });
    const reference = `[参考资料](${blockUrl(blockA)})`;
    f.remote.set('reference', { id: 'reference', projectId: 'list', title: '普通任务', content: reference });
    await f.sync();
    assert.equal(f.get('details').blockId, blockA);
    assert.equal(f.get('details').docId, docId);
    assert.equal(f.get('details').note, '正文');
    assert.equal(f.get('title').blockId, blockB);
    assert.equal(f.get('title').title, '旧任务 [附录]');
    assert.equal(f.get('reference').blockId, undefined);
    assert.equal(f.get('reference').note, reference);
    assert.deepEqual(f.blockUpdates, [[blockA, [f.get('details').id]], [blockB, [f.get('title').id]]]);

    f.remote.get('title').title = '远端改名';
    await f.sync();
    assert.equal(f.get('title').title, '远端改名');
    assert.equal(f.get('title').blockId, blockB);
    assert.equal(f.blockUpdates.length, 2);
    assert.equal(f.writes.length, 0);
});

test('限流后的解绑保留本地状态，重新保存清除远端链接并保留检查事项', async () => {
    const f = fixture();
    f.remote.set('checklist', {
        id: 'checklist', projectId: 'list', title: '检查清单', content: '正文',
        desc: `${blockLink(blockA)}\n\n原有描述`, items: [{ title: '第一项' }],
    });
    await f.sync();
    assert.equal(f.get('checklist').note, '正文\n\n原有描述\n\n- [ ] 第一项');

    f.rateLimitNextWrite();
    await f.save({ ...f.get('checklist'), blockId: null, docId: null });
    assert.equal(f.get('checklist').didaBlockSyncPending, true);
    await f.sync();
    assert.equal(f.get('checklist').blockId, null);
    assert.equal(f.remote.get('checklist').desc, `${blockLink(blockA)}\n\n原有描述`);

    await f.save(f.get('checklist'));
    assert.equal(f.get('checklist').didaBlockSyncPending, undefined);
    assert.equal(f.remote.get('checklist').content, '正文');
    assert.equal(f.remote.get('checklist').desc, '原有描述');
    assert.deepEqual(f.remote.get('checklist').items, [{ title: '第一项' }]);
    await f.sync();
    assert.equal(f.get('checklist').blockId, null);
});

test('滴答任务的 sortOrder 转为看板降序，远端换序时更新原任务', async () => {
    const f = fixture();
    f.remote.set('older', { id: 'older', projectId: 'list', sortOrder: 0 });
    f.remote.set('newer', { id: 'newer', projectId: 'list', sortOrder: -1099511627776 });
    f.remote.set('last', { id: 'last', projectId: 'list', sortOrder: 1099511627776 });
    await f.sync();

    const order = () => [...f.remote.keys()].sort((a, b) => f.get(b).sort - f.get(a).sort);
    assert.deepEqual(order(), ['newer', 'older', 'last']);
    assert.equal(f.get('older').sort, 0);
    const oldTaskId = f.get('older').id;

    f.remote.get('older').sortOrder = -2199023255552;
    delete f.remote.get('newer').sortOrder;
    await f.sync();
    assert.deepEqual(order(), ['older', 'newer', 'last']);
    assert.equal(f.get('older').id, oldTaskId);
    assert.equal(f.get('newer').sort, 1099511627776);
    assert.equal(f.writes.length, 0);
});

test('在思源新建滴答任务时立即保存创建响应中的排序值', async () => {
    const f = fixture();
    f.setCreatedSortOrder(-3298534883328);
    await f.save({ id: 'local', projectId: 'project', title: '新任务', sort: 10 });
    assert.equal(f.get('remote-1').sort, 3298534883328);
    assert.equal(f.writes[0].sortOrder, undefined);

    f.setCreatedSortOrder(undefined);
    await f.save({ id: 'fallback', projectId: 'project', title: '没有远端排序值', sort: 20 });
    assert.equal(f.get('remote-2').sort, 20);
});

test('新建滴答订阅项目默认手动降序，编辑订阅保留项目自己的排序条件', () => {
    const file = fs.readFileSync(path.join(__dirname, '../src/components/settings/icsSubscriptionPanel.svelte'), 'utf8');
    const [, script] = file.match(/<script lang="ts">([\s\S]*?)<\/script>/);
    const ast = ts.createSourceFile('subscription.ts', script, ts.ScriptTarget.Latest, true);
    let expression;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'project'
            && node.initializer && ts.isObjectLiteralExpression(node.initializer)
            && node.initializer.properties.some(property => property.name?.getText(ast) === 'isSubscription')) {
            expression = node.initializer.getText(ast);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(expression);
    const buildProject = new Function('type', 'isNew', 'existingProj', `
        const displayDefaults = {}, projectId = 'project', folder = { id: 'folder' };
        const name = 'Subscription', subId = 'subscription', sort = 10;
        return (${expression});
    `);
    const project = buildProject('dida', true, {});
    assert.deepEqual(project.sortCriteria, [{ method: 'manual', order: 'desc' }]);
    assert.equal(project.sortRule, 'manual');
    assert.equal(project.sortOrder, 'desc');
    const custom = [{ method: 'priority', order: 'desc' }, { method: 'manual', order: 'asc' }];
    assert.deepEqual(buildProject('dida', false, { sortCriteria: custom }).sortCriteria, custom);
    assert.equal(buildProject('caldav', true, {}).sortCriteria, undefined);
});
