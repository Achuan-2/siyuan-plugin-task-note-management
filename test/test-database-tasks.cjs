const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function evaluate(source, dependencies = {}) {
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
        assert.ok(name in dependencies, `未提供测试依赖 ${name}`);
        return dependencies[name];
    }, module, module.exports);
    return module.exports;
}

const sourceUtils = evaluate(fs.readFileSync(path.join(root, 'src/utils/databaseTaskSource.ts'), 'utf8'));

// 从真实类中读取方法，在隔离的插件/DOM 环境中执行，避免初始化完整思源界面。
function loadMethods(filename, className, methods, dependencies) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    assert.ok(declaration, `未找到类 ${className}`);
    const members = declaration.members.filter(member => methods.includes(member.name?.getText(ast)));
    assert.equal(members.length, methods.length);
    const imports = Object.keys(dependencies).map((name, i) =>
        `const dependency${i} = require(${JSON.stringify(name)});`).join('\n');
    const bindings = Object.keys(dependencies).map((name, i) =>
        `const { ${Object.keys(dependencies[name]).join(', ')} } = dependency${i};`).join('\n');
    return evaluate(`${imports}\n${bindings}\nexport class Fixture { ${members.map(node => node.getText(ast)).join('\n')} }`, dependencies).Fixture;
}

function context(rows = [], ids) {
    return {
        element: {
            getAttribute: name => ({ 'data-av-id': 'database', 'data-node-id': 'carrier', 'custom-sy-av-view': 'view' })[name],
            querySelector: () => null,
        },
        selectRowElements: rows,
        selectRowIds: ids,
    };
}

function row(id, title, blockId, detached = false) {
    const text = { textContent: title, getAttribute: name => name === 'data-id' ? blockId : null };
    const cell = { getAttribute: name => name === 'data-detached' && detached ? 'true' : null, querySelector: () => text };
    return { getAttribute: name => name === 'data-id' ? id : null, querySelector: () => cell };
}

test('数据库选择去重，绑定块 ID 与独立条目 ID 分离，定位链接保留视图和分组', async () => {
    const selection = context([row('bound-item', '绑定任务', 'real-block'), row('detached-item', '独立任务', 'detached-item', true)]);
    selection.selectRowPoints = [{ itemID: 'detached-item', groupID: 'group' }];
    const sources = await sourceUtils.readDatabaseTaskSources(selection, () => assert.fail('可见主键无需 API'));
    assert.equal(sources[0].blockId, 'real-block');
    assert.equal(sources[1].blockId, undefined);
    assert.equal(sources[1].title, '独立任务');
    const url = new URL(sources[1].url);
    assert.equal(url.pathname, '/carrier');
    assert.equal(url.searchParams.get('avItemID'), 'detached-item');
    assert.equal(url.searchParams.get('avViewID'), 'view');
    assert.equal(url.searchParams.get('avGroupID'), 'group');
    assert.deepEqual(sourceUtils.getDatabaseSelectedIds(context([], ['one', 'one', 'two'])), ['one', 'two']);
    assert.deepEqual(sourceUtils.getDatabaseSelectedIds(context()), []);
});

test('隐藏或虚拟滚动的主键按条目 ID 获取，缺失条目中止操作', async () => {
    const sources = await sourceUtils.readDatabaseTaskSources(context([], ['item']), async (url, data) => {
        assert.equal(url, '/api/av/getAttributeViewKeys');
        assert.deepEqual(data, { id: 'item', avID: 'database', itemID: 'item' });
        return [{ avID: 'database', keyValues: [{ key: { type: 'block' }, values: [
            { blockID: 'other', block: { id: 'wrong', content: '错误条目' } },
            { blockID: 'item', block: { id: 'real-block', content: '隐藏主键' } },
        ] }] }];
    });
    assert.equal(sources[0].blockId, 'real-block');
    assert.equal(sources[0].title, '隐藏主键');
    await assert.rejects(sourceUtils.readDatabaseTaskSources(context([], ['missing']), async () => []), /无法读取/);
});

function menuFixture() {
    const dialogs = [];
    const batches = [];
    const errors = [];
    const Fixture = loadMethods('src/index.ts', 'ReminderPlugin', ['handleDatabaseMenu'], {
        './api': { request: () => assert.fail('可见主键不应调用 API') },
        'test-utils': {
            ...sourceUtils,
            i18n: key => key,
            showMessage: message => errors.push(message),
            QuickReminderDialog: class {
                constructor(_date, _time, _callback, _range, options) { dialogs.push(options); }
                async show() {}
            },
            BatchReminderDialog: class { async showDatabaseItems(sources) { batches.push(sources); } },
            createSharedPomodoroStartSubmenu: options => [{ click: () => options.startPomodoro(15) }],
        },
    });
    const plugin = new Fixture();
    plugin.settings = { pomodoroDirectStart: true };
    plugin.getInheritedProjectAndGroup = async () => ({ projectId: 'project' });
    plugin.getAutoDetectDateTimeEnabled = async () => true;
    const blockTasks = [], blockTimers = [], itemTimers = [];
    plugin.handleMultipleBlocks = async ids => blockTasks.push(ids);
    plugin.startPomodoroForBlock = async (...args) => blockTimers.push(args);
    plugin.startPomodoroForReminder = async (...args) => itemTimers.push(args);
    const menu = selection => {
        const items = [];
        plugin.handleDatabaseMenu({ detail: { ...selection, menu: { addItem: item => items.push(item) } } });
        return items;
    };
    return { plugin, menu, dialogs, batches, errors, blockTasks, blockTimers, itemTimers };
}

test('单条绑定条目复用块操作，独立条目填入标题及链接并独立计时', async () => {
    const f = menuFixture();
    let items = f.menu(context([row('bound-item', '绑定任务', 'real-block')]));
    await items[0].click();
    await items[1].click();
    assert.deepEqual(f.blockTasks, [['real-block']]);
    assert.deepEqual(f.blockTimers, [['real-block', undefined]]);
    items = f.menu(context([row('item', '明天整理数据', 'item', true)]));
    await items[0].click();
    await items[1].click();
    assert.equal(f.dialogs[0].defaultTitle, '明天整理数据');
    assert.equal(f.dialogs[0].defaultProjectId, 'project');
    assert.equal(f.dialogs[0].defaultBlockId, undefined);
    assert.match(f.dialogs[0].defaultUrl, /avItemID=item/);
    const [timer] = f.itemTimers[0];
    assert.equal(timer.id, 'av:database:item');
    assert.equal(timer.blockId, undefined);
    assert.equal(timer.isBlockPomodoro, true);
    assert.equal(timer.url, f.dialogs[0].defaultUrl);
    assert.deepEqual(f.errors, []);
});

test('时长预设传入真实启动流程，多选只显示批量任务菜单，空选择无菜单', async () => {
    const f = menuFixture();
    f.plugin.settings.pomodoroDirectStart = false;
    const items = f.menu(context([row('item', '独立任务', null, true)]));
    await items[1].submenu[0].click();
    assert.equal(f.itemTimers[0][1], 15);
    const batch = f.menu(context([row('one', '一', null, true), row('two', '二', 'block')]));
    assert.equal(batch.length, 1);
    await batch[0].click();
    assert.equal(f.batches[0].length, 2);
    assert.deepEqual(f.menu(context()), []);
});

test('混合批量保存只给真实块写绑定属性，独立条目保存定位链接', async t => {
    const writes = [], queries = [], inherited = [], events = [];
    let saved;
    const Fixture = loadMethods('src/components/dialog/BatchReminderDialog.ts', 'SmartBatchDialog',
        ['initializeBlockSettings', 'saveBatchReminders', 'getBlockDepth'], {
            '../../api': {
                sql: async query => { queries.push(query); return [{ id: 'real-block', root_id: 'document' }]; },
                updateBindBlockAtrrs: async id => writes.push(id),
            },
            'test-utils': { i18n: key => key, showMessage: () => {}, getLogicalDateString: () => '2026-10-09' },
        });
    const oldWindow = global.window, oldEvent = global.CustomEvent;
    global.window = { dispatchEvent: event => events.push(event.type) };
    global.CustomEvent = class { constructor(type) { this.type = type; } };
    t.after(() => { global.window = oldWindow; global.CustomEvent = oldEvent; });
    const f = new Fixture();
    f.plugin = {
        settings: {}, loadReminderData: async () => ({}), loadHolidayData: async () => ({}),
        saveReminderData: async data => { saved = data; },
        getInheritedProjectAndGroup: async id => { inherited.push(id); return { projectId: 'project' }; },
    };
    const sources = await sourceUtils.readDatabaseTaskSources(context([
        row('one', '独立任务', 'one', true), row('two', '绑定任务', 'real-block'),
    ]), () => assert.fail());
    f.autoDetectedData = sources.map(source => ({ blockId: source.id, content: source.title, databaseSource: source }));
    f.blockSettings = new Map();
    f.showLoadingDialog = f.closeLoadingDialog = () => {};
    await f.initializeBlockSettings();
    await f.saveBatchReminders({ destroy() {} });
    assert.deepEqual(inherited, ['carrier', 'real-block']);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /in \('real-block'\)/);
    assert.deepEqual(writes, ['real-block']);
    const values = Object.values(saved);
    assert.equal(values.length, 2);
    const detached = values.find(item => item.title === '独立任务');
    assert.equal(detached.blockId, undefined);
    assert.equal(detached.url, sources[0].url);
    assert.equal(detached.projectId, 'project');
    assert.equal(values.find(item => item.title === '绑定任务').docId, 'document');
    assert.deepEqual(events, ['reminderUpdated', 'projectUpdated']);
});

test('独立条目番茄钟点击标题打开条目链接，不查询虚构的块', async t => {
    const opened = [];
    const Fixture = loadMethods('src/components/panel/PomodoroTimer.ts', 'PomodoroTimer',
        ['openRelatedNote', 'handleTaskTitleClick'], {
            'test-utils': {
                i18n: key => key, showMessage: () => assert.fail('应直接打开条目'),
                getBlockByID: () => assert.fail('不应读取独立条目为块'), openBlock: () => assert.fail(),
            },
        });
    const previous = global.window;
    global.window = { open: url => opened.push(url) };
    t.after(() => { global.window = previous; });
    const f = new Fixture();
    f.reminder = { url: 'siyuan://blocks/carrier?avItemID=item&avStandalone=1' };
    f.hasBoundBlock = async () => false;
    f.openTaskEditDialog = () => assert.fail('应打开条目');
    await f.handleTaskTitleClick();
    assert.deepEqual(opened, [f.reminder.url]);
});
