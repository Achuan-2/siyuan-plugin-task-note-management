// node --test scripts/test-missing-bound-block.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const blockId = '20261114123456-abcdefg';
const apiCode = compile(fs.readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8'));

function fixture() {
    const calls = [], messages = [];
    let block = null, failure = null;
    const data = { task: { id: 'task', blockId, title: '保留任务', pomodoroCount: 3 } };
    const plugin = { settings: {}, loadReminderData: async () => data };
    const api = {};
    new Function('require', 'exports', apiCode)(name => {
        if (name === 'siyuan') return {
            async fetchSyncPost(url, data, headers, process) {
                calls.push({ url, data, process });
                const result = url === '/api/query/sql'
                    ? { code: 0, data: block ? [block] : [] }
                    : failure || { code: 0, data: {} };
                if (process !== false && result.code !== 0) messages.push(result.msg);
                return result;
            },
            showMessage: text => messages.push(text),
        };
        if (name.endsWith('/pomodoroRecord')) return { PomodoroRecordManager: { getInstance: () => ({
            initialize: async () => {}, getRepeatingEventTotalPomodoroCount: id => id === 'task' ? 3 : 0,
            getRepeatingEventTotalFocusTime: id => id === 'task' ? 75 : 0,
        }) } };
        if (name.endsWith('/pluginInstance')) return { i18n: key => key };
        return {};
    }, api);
    return { api, calls, messages, plugin, data,
        setBlock: value => { block = value; }, setFailure: value => { failure = value; } };
}

test('绑定块已删除时不写属性、不读取 Markdown，也不删除任务或清空绑定', async () => {
    const f = fixture(), original = structuredClone(f.data);
    await f.api.updateBindBlockAtrrs(blockId, f.plugin);
    assert.deepEqual(f.calls.map(call => call.url), ['/api/query/sql']);
    assert.deepEqual(f.data, original);
    assert.deepEqual(f.messages, []);
});

test('失效块恢复后重新同步，不缓存永久缺失状态', async () => {
    const f = fixture();
    await f.api.updateBindBlockAtrrs(blockId, f.plugin);
    f.setBlock({ id: blockId, type: 'p', subtype: '' });
    await f.api.updateBindBlockAtrrs(blockId, f.plugin);
    const writes = f.calls.filter(call => call.url === '/api/attr/setBlockAttrs');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.attrs['custom-bind-reminders'], 'task');
    assert.equal(writes[0].data.attrs['custom-task-pomodoro-count'], '3');
    assert.equal(writes[0].data.attrs['custom-task-pomodoro-minutes'], '75');
});

test('检查后块被删除时仅静默处理明确的块或树缺失响应', async () => {
    for (const msg of ['block not found', 'tree not found', `block not found [id=${blockId}]`, `block tree not found [id=${blockId}]`]) {
        const f = fixture();
        f.setFailure({ code: -1, msg, data: null });
        assert.equal(await f.api.setBlockAttrs(blockId, { bookmark: '' }), null);
        assert.deepEqual(await f.api.getBlockAttrs(blockId), {});
        assert.deepEqual(await f.api.getBlockKramdown(blockId), { id: blockId, kramdown: '' });
        assert.ok(f.calls.every(call => call.process === false));
        assert.deepEqual(f.messages, []);
    }
});

test('块属性和内容请求仍提示权限、锁定、存储等其他错误', async () => {
    for (const msg of ['permission denied', 'tree not found: disk error', 'block not found or its encrypted notebook is locked', '只读模式']) {
        const f = fixture();
        f.setFailure({ code: -1, msg, data: null });
        await f.api.setBlockAttrs(blockId, {});
        assert.deepEqual(f.messages, [msg]);
    }
});

test('普通 API 保留宿主原有错误提示行为', async () => {
    const f = fixture();
    f.setFailure({ code: -1, msg: 'tree not found', data: null });
    await f.api.request('/api/block/deleteBlock', { id: blockId });
    assert.equal(f.calls[0].process, undefined);
    assert.deepEqual(f.messages, ['tree not found']);
});

test('任务列表检测遇到已删除块返回 false，不弹错误', async () => {
    const f = fixture();
    f.setFailure({ code: -1, msg: 'tree not found', data: null });
    assert.equal(await f.api.isTaskListLikeBlock(blockId), false);
    assert.deepEqual(f.messages, []);
});

const timerSource = fs.readFileSync(path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8');
const timerAST = ts.createSourceFile('PomodoroTimer.ts', timerSource, ts.ScriptTarget.Latest, true);
const timerClass = timerAST.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const timerMethods = timerClass.members.filter(node => ['parsePomodoroMetric', 'updateBlockPomodoroAttrsByBlockId'].includes(node.name?.getText(timerAST)))
    .map(node => node.getText(timerAST)).join('\n');
const timerCode = compile(`class PomodoroTimer { ${timerMethods} }`);

function timerFixture() {
    let block = null, writes = 0, reads = 0, writeResult = {};
    const Timer = new Function('getBlockByID', 'getBlockAttrs', 'setBlockAttrs', 'BLOCK_POMODORO_COUNT_ATTR', 'BLOCK_POMODORO_MINUTES_ATTR',
        `${timerCode}; return PomodoroTimer;`)(async () => block, async () => { reads++; return {}; },
        async () => { writes++; return writeResult; }, 'custom-task-pomodoro-count', 'custom-task-pomodoro-minutes');
    const timer = new Timer();
    timer.blockPomodoroMetricCache = { blockId, count: 3, minutes: 75 };
    return { timer, get writes() { return writes; }, get reads() { return reads; },
        restore: () => { block = { id: blockId }; }, deleteBeforeWrite: () => { writeResult = null; } };
}

test('计时结束后绑定块已删除，即使有旧指标缓存也不再读写块属性', async () => {
    const f = timerFixture();
    assert.equal(await f.timer.updateBlockPomodoroAttrsByBlockId(blockId, 25), false);
    assert.equal(f.reads, 0);
    assert.equal(f.writes, 0);
    assert.equal(f.timer.blockPomodoroMetricCache, null);
    f.restore();
    assert.equal(await f.timer.updateBlockPomodoroAttrsByBlockId(blockId, 25), true);
    assert.equal(f.writes, 1);
});

test('计时结束写属性时块被删除，不发布成功的指标缓存', async () => {
    const f = timerFixture();
    f.restore();
    f.deleteBeforeWrite();
    assert.equal(await f.timer.updateBlockPomodoroAttrsByBlockId(blockId, 25), false);
    assert.equal(f.timer.blockPomodoroMetricCache, null);
});
