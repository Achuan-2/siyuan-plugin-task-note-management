// Run with: pnpm exec node --test scripts/test-project-copy.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const zh = require('../i18n/zh_CN.json');

const filename = path.join(__dirname, '../src/components/dataManager/projectManager.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(data, { failSave = false } = {}) {
    const events = [];
    const saves = [];
    const plugin = {
        loadProjectData: async () => data,
        saveProjectData: async next => {
            if (failSave) throw new Error('Save failed');
            saves.push(next);
        },
        loadReminderData: () => { throw new Error('Must not access tasks'); },
        saveReminderData: () => { throw new Error('Must not modify tasks'); },
    };
    const module = { exports: {} };
    const dependencies = {
        '../../api': {},
        './statusManager': { StatusManager: { getInstance: () => ({}) } },
        '../../pluginInstance': {
            i18n: (key, params = {}) => zh[key].replace(/\$\{([^}]+)\}/g, (_, name) => params[name]),
        },
    };
    new Function('require', 'exports', 'window', 'CustomEvent', code)(
        name => {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        },
        module.exports,
        { dispatchEvent: event => events.push(event) },
        class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    );
    const manager = new module.exports.ProjectManager(plugin);
    return { manager, events, saves };
}

test('空副本保留分组、标签和看板设置，并清除任务关联、绑定、里程碑和运行状态', async () => {
    const source = {
        id: 'source', title: '🧪 实验', folderId: 'research', status: 'active', archived: false,
        categoryId: 'work', priority: 'high', color: '#123456', sort: 20,
        kanbanMode: 'custom', customGroupTabsMode: true, statusTabsMode: false,
        customGroupStatusDisplayMode: 'tabs', groupTabCountMode: 'unfinished',
        showCompletedSubtasks: false, hideEmptyStatusBars: true,
        sortCriteria: [{ method: 'priority', order: 'desc' }],
        kanbanStatuses: [{ id: 'waiting', name: '等待', color: '#abcdef' }],
        customGroups: [{
            id: 'group', name: '准备', icon: '🧪', color: '#aabbcc', sort: 10, archived: false,
            visibleStatusIds: ['waiting'], blockId: 'group-block', milestones: [{ id: 'milestone' }],
        }],
        tags: [{ id: 'tag', name: '实验', color: '#112233' }],
        blockId: 'project-block', note: '原项目备注', milestones: [{ id: 'milestone' }],
        startDate: '2026-01-01', endDate: '2026-01-02', createdTime: 'old', updatedTime: 'old',
        isSubscription: true, subscriptionId: 'subscription',
        activeCustomGroupTabId: 'group', activeStatusTabId: 'waiting',
        milestoneFilterState: { selections: { group: ['milestone'] } }, tasks: ['task'],
    };
    const data = { source, sibling: { id: 'sibling', folderId: 'research', sort: 80 }, _settings: { saved: true } };
    const original = structuredClone(data);
    const { manager, saves, events } = fixture(data);
    const result = await manager.duplicateEmptyProject('source');
    const copy = saves[0][result.id];
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.title, '🧪 实验（副本）');
    assert.equal(copy.sort, 90);
    assert.equal(copy.note, '');
    assert.equal(copy.folderId, 'research');
    assert.equal(copy.priority, 'high');
    assert.equal(copy.customGroupTabsMode, true);
    assert.equal(copy.statusTabsMode, false);
    assert.equal(copy.showCompletedSubtasks, false);
    assert.deepEqual(copy.kanbanStatuses, source.kanbanStatuses);
    assert.deepEqual(copy.sortCriteria, source.sortCriteria);
    assert.notEqual(copy.customGroups[0].id, 'group');
    assert.equal(copy.customGroups[0].name, '准备');
    assert.equal(copy.customGroups[0].icon, '🧪');
    assert.deepEqual(copy.customGroups[0].visibleStatusIds, ['waiting']);
    assert.notEqual(copy.tags[0].id, 'tag');
    assert.equal(copy.tags[0].name, '实验');
    assert.equal(copy.tags[0].color, '#112233');
    for (const key of ['blockId', 'milestones', 'startDate', 'endDate', 'isSubscription', 'subscriptionId',
        'activeCustomGroupTabId', 'activeStatusTabId', 'milestoneFilterState', 'tasks']) {
        assert.equal(Object.hasOwn(copy, key), false, key);
    }
    assert.equal(Object.hasOwn(copy.customGroups[0], 'blockId'), false);
    assert.equal(Object.hasOwn(copy.customGroups[0], 'milestones'), false);
    assert.notEqual(copy.createdTime, 'old');
    assert.equal(copy.createdTime, copy.updatedTime);
    assert.deepEqual(data, original);
    assert.deepEqual(saves[0]._settings, data._settings);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'projectUpdated');
    assert.equal(events[0].detail.projectId, copy.id);
    assert.equal(manager.getProjectColor(copy.id), '#123456');

    copy.customGroups[0].visibleStatusIds.push('doing');
    copy.customGroups[0].name = '副本分组';
    copy.tags[0].name = '副本标签';
    copy.kanbanStatuses[0].name = '副本状态';
    copy.sortCriteria[0].order = 'asc';
    assert.deepEqual(data, original, 'Editing copy must not mutate original configuration');
});

test('重复创建时避开同名项目，排序仅参考同文件夹且忽略元数据', async () => {
    const { manager, saves } = fixture({
        source: { title: '项目', sort: 10 },
        copy: { title: '项目（副本）', sort: 20 },
        other: { title: '其他', folderId: 'elsewhere', sort: 999 },
        _metadata: { sort: 5000 },
    });
    const result = await manager.duplicateEmptyProject('source');
    const copy = saves[0][result.id];
    assert.equal(copy.title, '项目（副本） 2');
    assert.equal(copy.sort, 30);
    assert.deepEqual(copy.customGroups, []);
    assert.deepEqual(copy.tags, []);
    assert.equal(Object.hasOwn(copy, 'showTaskCategories'), false, 'Unset settings should keep inheriting defaults');
});

test('兼容旧版字符串标签且不改写原数据', async () => {
    const data = { source: { title: '旧项目', tags: ['实验', '分析'] } };
    const { manager, saves } = fixture(data);
    const result = await manager.duplicateEmptyProject('source');
    saves[0][result.id].tags.push('新标签');
    assert.deepEqual(data.source.tags, ['实验', '分析']);
});

test('原项目已被删除时不保存也不发送更新', async () => {
    const { manager, saves, events } = fixture({});
    assert.equal(await manager.duplicateEmptyProject('missing'), undefined);
    assert.equal(saves.length, 0);
    assert.equal(events.length, 0);
});

test('保存失败时不更改原项目、管理器缓存或发送成功事件', async () => {
    const data = { source: { id: 'source', title: '项目', tags: [] } };
    const { manager, saves, events } = fixture(data, { failSave: true });
    await assert.rejects(manager.duplicateEmptyProject('source'), /Save failed/);
    assert.deepEqual(Object.keys(data), ['source']);
    assert.equal(manager.projects.length, 0);
    assert.equal(saves.length, 0);
    assert.equal(events.length, 0);
});
