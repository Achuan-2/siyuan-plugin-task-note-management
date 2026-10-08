const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

// 执行真实管理器、MCP handler 和清理逻辑，仅替换思源运行时及日期查询依赖。
function createLoader() {
    const modules = new Map();
    const mocks = new Map([
        [path.join(root, 'src/utils/dateUtils.ts'), { getLogicalDateString: () => '2026-10-08' }],
        [path.join(root, 'src/utils/reminderTaskLogic.ts'), { ReminderTaskLogic: {} }],
        [path.join(root, 'src/kernel/utils/siyuanApi.ts'), {}],
    ]);

    function load(filename) {
        if (mocks.has(filename)) return mocks.get(filename);
        if (modules.has(filename)) return modules.get(filename).exports;
        const module = { exports: {} };
        modules.set(filename, module);
        const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
            fileName: filename,
        });
        const localRequire = specifier => specifier.startsWith('.')
            ? load(path.resolve(path.dirname(filename), `${specifier}.ts`))
            : require(specifier);
        new Function('require', 'module', 'exports', result.outputText)(localRequire, module, module.exports);
        return module.exports;
    }

    return relative => load(path.join(root, relative));
}

function existingTask(id = 'existing', extra = {}) {
    return {
        id, title: '面板中的任务', date: '2026-10-08', completed: false,
        createdAt: '2026-10-08T00:00:00.000Z', projectId: 'project', ...extra,
    };
}

function createFixture(initial = { existing: existingTask() }) {
    const load = createLoader();
    const state = { data: clone(initial), writes: 0, readError: null, writeError: null };
    const plugin = {
        async loadData(filename) {
            assert.equal(filename, 'reminder.json');
            if (state.readError) throw state.readError;
            const snapshot = clone(state.data);
            await new Promise(resolve => setImmediate(resolve));
            return snapshot;
        },
        async saveData(filename, data) {
            assert.equal(filename, 'reminder.json');
            if (state.writeError) throw state.writeError;
            const snapshot = clone(data);
            await new Promise(resolve => setImmediate(resolve));
            state.data = snapshot;
            state.writes++;
        },
    };
    const { ReminderManager } = load('src/components/dataManager/reminderManager.ts');
    const manager = ReminderManager.getInstance(plugin);
    const { createTaskTool } = load('src/kernel/tools/taskTools.ts');
    const tool = createTaskTool(manager, {}, {});
    return { manager, tool, state };
}

test('MCP create_task 保留初始化后面板保存的完成状态及其他最新数据', async () => {
    const { manager, tool, state } = createFixture({
        existing: existingTask(), removed: existingTask('removed'),
    });
    await manager.initialize();
    Object.assign(state.data.existing, {
        completed: true,
        completedTime: '2026-10-08T02:00:00.000Z',
        kanbanStatus: 'completed',
        dailyCompletions: { '2026-10-08': true },
        repeat: { enabled: true, instances: { '2026-10-08': { completed: true } } },
    });
    delete state.data.removed;
    state.data.panelCreated = existingTask('panelCreated');
    const before = clone(state.data);

    const result = await tool.handler({ action: 'create_task', title: 'AI 新建的任务' });
    assert.equal(result.success, true);
    assert.deepEqual(state.data.existing, before.existing);
    assert.deepEqual(state.data.panelCreated, before.panelCreated);
    assert.equal(state.data.removed, undefined);
    assert.equal(state.data[result.data.id].title, 'AI 新建的任务');
    assert.equal(state.data[result.data.id].completed, false);
});

test('MCP create_tasks 批量创建保留面板完成状态', async () => {
    const { manager, tool, state } = createFixture();
    await manager.initialize();
    state.data.existing.completed = true;
    const result = await tool.handler({
        action: 'create_tasks', tasks: [{ title: '批量任务 A' }, { title: '批量任务 B' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.data.tasks.length, 2);
    assert.equal(Object.keys(state.data).length, 3);
    assert.equal(state.data.existing.completed, true);
});

test('并发 MCP 创建和更新串行保存，不相互覆盖', async () => {
    const { manager, tool, state } = createFixture();
    await manager.initialize();
    state.data.existing.completed = true;
    const results = await Promise.all([
        ...Array.from({ length: 12 }, (_, index) => tool.handler({
            action: 'create_task', title: `并发任务 ${index}`,
        })),
        manager.updateReminders([{ id: 'existing', note: '保留完成状态的备注更新' }]),
    ]);
    assert.ok(results.slice(0, 12).every(result => result.success));
    assert.equal(Object.keys(state.data).length, 13);
    assert.equal(state.data.existing.completed, true);
    assert.equal(state.data.existing.note, '保留完成状态的备注更新');
});

test('更新只修改明确传入的字段，删除不复活其他已删除任务', async () => {
    const { manager, state } = createFixture({ existing: existingTask(), removed: existingTask('removed') });
    await manager.initialize();
    state.data.existing.completed = true;
    state.data.existing.completedTime = '2026-10-08T02:00:00.000Z';
    delete state.data.removed;
    await manager.updateReminders([{ id: 'existing', note: '新备注' }]);
    assert.equal(state.data.existing.completed, true);
    assert.equal(state.data.existing.completedTime, '2026-10-08T02:00:00.000Z');
    assert.equal(state.data.removed, undefined);
    const created = await manager.createReminder({ title: '待删除任务' });
    assert.equal(await manager.deleteReminder(created.id), true);
    assert.equal(state.data.existing.completed, true);
    assert.equal(state.data.removed, undefined);
    const writes = state.writes;
    assert.equal(await manager.deleteReminder('removed'), false);
    assert.equal(state.writes, writes);
});

test('查询读取最新完成状态、新增任务和删除结果', async () => {
    const { manager, state } = createFixture();
    await manager.initialize();
    state.data.existing.completed = true;
    state.data.new = existingTask('new');
    assert.equal((await manager.getReminderById('existing')).completed, true);
    assert.equal(await manager.reminderExists('new'), true);
    assert.deepEqual(await manager.countByProject('project'), { total: 2, undone: 1 });
    assert.equal((await manager.searchReminders({ completed: true })).length, 1);
    delete state.data.existing;
    assert.equal((await manager.getAllReminders()).existing, undefined);
});

test('读写失败不覆盖文件，后续操作仍能执行且不会写入失败任务', async () => {
    const { manager, tool, state } = createFixture();
    await manager.initialize();
    const before = clone(state.data);
    state.readError = new Error('读取失败');
    const failedRead = await tool.handler({ action: 'create_task', title: '读取失败的任务' });
    assert.equal(failedRead.success, false);
    assert.deepEqual(state.data, before);
    assert.equal(state.writes, 0);
    state.readError = null;
    state.writeError = new Error('写入失败');
    await assert.rejects(manager.createReminder({ title: '写入失败的任务' }), /写入失败/);
    assert.deepEqual(state.data, before);
    state.writeError = null;
    const created = await manager.createReminder({ title: '恢复后的任务' });
    assert.equal(state.data[created.id].title, '恢复后的任务');
    assert.equal(Object.keys(state.data).length, 2);
});

test('无效提醒数据不当作空文件覆盖，缺失文件仍可创建首条任务', async () => {
    for (const invalid of [[], 'invalid', 42]) {
        const { manager, state } = createFixture(invalid);
        await assert.rejects(manager.createReminder({ title: '任务' }), /数据格式无效/);
        assert.deepEqual(state.data, invalid);
        assert.equal(state.writes, 0);
    }
    const { manager, state } = createFixture(null);
    const created = await manager.createReminder({ title: '首条任务' });
    assert.equal(state.data[created.id].title, '首条任务');
});

test('内核存储向调用方传播提醒 JSON 损坏和读取错误', async () => {
    const previous = globalThis.siyuan;
    try {
        const { createKernelStorage } = createLoader()('src/kernel/storageAdapter.ts');
        globalThis.siyuan = { storage: { get: async () => ({ text: async () => '{invalid json' }) } };
        await assert.rejects(createKernelStorage().loadData('reminder.json'), SyntaxError);
        globalThis.siyuan = { storage: { get: async () => { throw new Error('permission denied'); } } };
        await assert.rejects(createKernelStorage().loadData('reminder.json'), /permission denied/);
        globalThis.siyuan = { storage: { get: async () => { throw new Error('file does not exist'); } } };
        assert.equal(await createKernelStorage().loadData('reminder.json'), null);
    } finally {
        globalThis.siyuan = previous;
    }
});
