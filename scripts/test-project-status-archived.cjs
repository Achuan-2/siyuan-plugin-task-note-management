// Run with: pnpm.cmd exec node --test scripts/test-project-status-archived.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(
    path.join(__dirname, '../src/components/dataManager/statusManager.ts'),
    'utf8'
);
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function createStatusManagerModule() {
    const exports = {};
    const requireMock = name => {
        if (name.includes('pluginInstance')) {
            return { i18n: key => key };
        }
        throw new Error(`Unexpected require: ${name}`);
    };
    new Function('require', 'exports', code)(requireMock, exports);
    return exports;
}

test('自定义状态支持设置/取消归档隐藏效果，且仍可被删除', async () => {
    const { StatusManager } = createStatusManagerModule();
    let persisted = [
        { id: 'active', name: '正在进行', icon: '⏳', isArchived: false },
        { id: 'someday', name: '未来也许', icon: '💭', isArchived: false },
        { id: 'archived', name: '已归档', icon: '📥', isArchived: true },
    ];
    const plugin = {
        loadProjectStatus: async () => persisted.map(s => ({ ...s })),
        saveProjectStatus: async data => { persisted = data.map(s => ({ ...s })); },
    };

    const manager = StatusManager.getInstance(plugin);
    await manager.initialize();

    const cancelled = await manager.addStatus({ name: '取消', icon: '📝', isArchived: true });
    assert.equal(cancelled.isArchived, true);
    assert.equal(manager.isArchivedStatus(cancelled.id), true);
    assert.equal(manager.isBuiltInArchivedStatus(cancelled.id), false);

    // 可以取消默认隐藏
    const updatedOff = await manager.updateStatus(cancelled.id, { isArchived: false });
    assert.equal(updatedOff, true);
    assert.equal(manager.isArchivedStatus(cancelled.id), false);

    // 重新设为默认隐藏
    const updatedOn = await manager.updateStatus(cancelled.id, { isArchived: true });
    assert.equal(updatedOn, true);
    assert.equal(manager.isArchivedStatus(cancelled.id), true);

    // 即使设为默认隐藏，自定义状态仍允许删除
    const deletedCustom = await manager.deleteStatus(cancelled.id);
    assert.equal(deletedCustom, true);
    assert.equal(manager.getStatusById(cancelled.id), undefined);
});

test('内置已归档状态始终保持归档隐藏且不可删除', async () => {
    const { StatusManager } = createStatusManagerModule();
    let persisted = [
        { id: 'active', name: '正在进行', icon: '⏳', isArchived: false },
        { id: 'archived', name: '已归档', icon: '📥', isArchived: true },
    ];
    const plugin = {
        loadProjectStatus: async () => persisted.map(s => ({ ...s })),
        saveProjectStatus: async data => { persisted = data.map(s => ({ ...s })); },
    };

    const manager = StatusManager.getInstance(plugin);
    await manager.initialize();

    assert.equal(manager.isBuiltInArchivedStatus('archived'), true);
    assert.equal(manager.isArchivedStatus('archived'), true);

    // 尝试将内置 archived 的 isArchived 设为 false 时应保持为 true
    await manager.updateStatus('archived', { isArchived: false });
    assert.equal(manager.getStatusById('archived')?.isArchived, true);
    assert.equal(manager.isArchivedStatus('archived'), true);

    // 内置 archived 不可删除
    const deletedBuiltIn = await manager.deleteStatus('archived');
    assert.equal(deletedBuiltIn, false);
    assert.ok(manager.getStatusById('archived'));
});
