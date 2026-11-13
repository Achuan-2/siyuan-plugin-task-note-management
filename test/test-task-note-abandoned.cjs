const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const transpile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const indexSource = ts.createSourceFile('index.ts', fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const pluginClass = indexSource.statements.find(node => ts.isClassDeclaration(node));
const methodNames = new Set(['areAllBoundRemindersAbandoned', 'buildBoundReminderDateDisplayInfo']);
const methods = pluginClass.members.filter(node => methodNames.has(node.name?.getText(indexSource)))
    .map(node => node.getText(indexSource)).join('\n');
const Plugin = new Function('getLogicalDateString', 'i18n', transpile(`class Plugin { ${methods} }; return Plugin;`))(
    () => '2026-11-13', key => key
);
const domExports = {};
new Function('require', 'exports', transpile(fs.readFileSync(path.join(__dirname, '../src/components/render/taskNoteDOM.ts'), 'utf8')))(
    () => ({}), domExports
);

function fixture(reminders) {
    const plugin = new Plugin();
    plugin.reminderDataCache = reminders;
    plugin.normalizeReminderDateText = value => value || '';
    plugin.normalizeReminderTimeText = value => value || '';
    plugin.isReminderOverdueForBoundDateDisplay = () => false;
    plugin.parseReminderScheduleTimestamp = date => Date.parse(date);
    plugin.formatReminderScheduleDisplayText = reminder => reminder.date || '自定义提醒';
    plugin.getBoundReminderDateDisplayInfoSync = ids => plugin.buildBoundReminderDateDisplayInfo(ids, plugin.reminderDataCache);
    const manager = Object.create(domExports.TaskNoteDOMManager.prototype);
    Object.assign(manager, {
        plugin,
        latestBindReminderDateTaskByBlock: new Map(), latestMilestoneDateTaskByBlock: new Map(),
        lastBoundReminderDateDisplayByBlock: new Map(), lastMilestoneDateDisplayByBlock: new Map(),
        getBoundPomodoroStatsFromCache: () => ({ count: 0, minutes: 0 }),
        getSelfPomodoroStats: () => ({ count: 0, minutes: 0 }),
        refreshBindReminderDateButton: async () => {},
    });
    const buttons = new Map();
    const container = {
        querySelector: selector => buttons.get(selector.match(/^\.([\w-]+)/)?.[1]) || null,
        querySelectorAll: () => [],
        appendChild(button) { buttons.set(button.className, button); button.parentElement = this; },
    };
    function button(className) {
        return { className, dataset: {}, parentElement: container, remove() { buttons.delete(className); } };
    }
    let ids = Object.keys(reminders);
    const block = {
        classList: { contains: () => false },
        getAttribute: name => name === 'data-node-id' ? 'block' : name === 'custom-bind-reminders' ? ids.join(',') : null,
    };
    manager._findButtonContainer = () => container;
    manager._findTrackedSourceForBlock = () => block;
    manager._createMilestoneButton = () => button('block-milestone-btn');
    manager._updateMilestoneButton = () => {};
    manager.getMilestoneDateDisplayInfoSync = () => ({ displayText: '2026-11-15' });
    manager.getMilestoneDateDisplayInfo = async () => ({ displayText: '2026-11-15' });
    manager._createBindReminderDateButton = () => button('block-bind-reminder-date');
    manager._updateBindReminderDateButton = () => {};
    manager.ensureBindReminderDateButtonOrder = (target, blockId, dateButton) => target.appendChild(dateButton);
    const protyle = { element: { querySelector: () => block } };
    const render = () => manager._processBlockButtons(protyle, 'block', {
        projectIds: [], hasBind: true, bindReminderIds: ids,
        milestoneIds: ['milestone'], milestoneProjectId: 'project', element: block,
    });
    container.appendChild(button('block-bind-reminders-btn'));
    return { plugin, manager, buttons, container, button, protyle, render, setIds: value => { ids = value; } };
}

test('已放弃任务不参与日期选择，混合绑定仍显示未放弃任务的日期', () => {
    const f = fixture({
        abandoned: { id: 'abandoned', kanbanStatus: 'abandoned', date: '2026-11-13' },
        active: { id: 'active', date: '2026-11-14' },
    });
    assert.equal(f.plugin.getBoundReminderDateDisplayInfoSync(['abandoned']), null);
    assert.equal(f.plugin.getBoundReminderDateDisplayInfoSync(['abandoned', 'active']).reminderId, 'active');
    assert.equal(f.plugin.areAllBoundRemindersAbandoned([]), false);
    assert.equal(f.plugin.areAllBoundRemindersAbandoned(['missing']), false);
    assert.equal(f.plugin.areAllBoundRemindersAbandoned(['abandoned', 'active']), false);
    assert.equal(f.plugin.areAllBoundRemindersAbandoned(['abandoned']), true);
});

test('放弃后移除已有日期和里程碑，恢复任务后重新显示', async () => {
    const task = { id: 'task', date: '2026-11-14' };
    const f = fixture({ task });
    f.render();
    assert.ok(f.buttons.has('block-bind-reminder-date'));
    assert.ok(f.buttons.has('block-milestone-btn'));
    // 模拟状态改变时，旧日期仍保存在渲染缓存中。
    task.kanbanStatus = 'abandoned';
    f.render();
    assert.equal(f.buttons.has('block-bind-reminder-date'), false);
    assert.equal(f.buttons.has('block-milestone-btn'), false);
    assert.equal(f.manager.lastBoundReminderDateDisplayByBlock.has('block'), false);
    assert.equal(f.manager.lastMilestoneDateDisplayByBlock.has('block'), false);
    assert.ok(f.buttons.has('block-bind-reminders-btn'));
    task.kanbanStatus = 'doing';
    f.render();
    assert.ok(f.buttons.has('block-bind-reminder-date'));
    assert.ok(f.buttons.has('block-milestone-btn'));
});

test('无日期的已放弃任务及同名块任务也隐藏里程碑，独立里程碑正常显示', () => {
    const f = fixture({ block: { id: 'block', kanbanStatus: 'abandoned' } });
    f.render();
    assert.equal(f.buttons.has('block-milestone-btn'), false);
    f.setIds([]);
    f.render();
    assert.ok(f.buttons.has('block-milestone-btn'));
});

test('放弃前发起的异步里程碑刷新不会恢复旧显示', async () => {
    const task = { id: 'task', date: '2026-11-14' };
    const f = fixture({ task });
    let finish;
    f.manager.getMilestoneDateDisplayInfo = () => new Promise(resolve => { finish = resolve; });
    f.container.appendChild(f.button('block-milestone-btn'));
    const pending = f.manager.refreshMilestoneDateButton(f.protyle, 'block', 'project', ['milestone']);
    task.kanbanStatus = 'abandoned';
    finish({ displayText: '2026-11-15' });
    await pending;
    assert.equal(f.buttons.has('block-milestone-btn'), false);
    assert.equal(f.manager.lastMilestoneDateDisplayByBlock.has('block'), false);
});
