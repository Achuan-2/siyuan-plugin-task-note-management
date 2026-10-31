// Run with: node --test scripts/test-quick-reminder-status.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const relative = 'src/components/dialog/QuickReminderDialog.ts';
const content = process.env.QUICK_REMINDER_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.QUICK_REMINDER_SOURCE_REF}:${relative}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, relative), 'utf8');
const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
const names = ['renderStatusSelector', 'updateKanbanStatusSelector',
    'normalizeGroupVisibleStatusIds', 'filterKanbanStatusesBySelectedGroup'];
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'QuickReminderDialog')
    .members.filter(node => names.includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class StatusDialog { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

const defaults = [
    { id: 'doing', name: '进行中' },
    { id: 'short_term', name: '短期' },
    { id: 'completed', name: '已完成' },
];
const projectStatuses = [...defaults, { id: 'waiting', name: 'waiting' }];

function fixture({ defaultStatus = 'waiting', reminder, group } = {}) {
    const timers = [];
    const StatusDialog = new Function('ProjectManager', 'i18n', 'setTimeout', `${code};return StatusDialog;`)(
        { getInstance: () => ({ getDefaultKanbanStatuses: () => defaults }) }, key => key,
        callback => timers.push(callback),
    );
    const selector = {
        style: {}, options: [],
        querySelector: () => selector.options.find(option => option.classList.contains('selected')),
        querySelectorAll: () => selector.options,
        set innerHTML(html) {
            // 仅模拟状态选项和事件；HTML 与状态选择逻辑均由真实方法生成。
            this.options = [...html.matchAll(/class="task-status-option ([^"]*)" data-status-type="([^"]*)"/g)]
                .map(([, className, id]) => {
                    const classes = new Set(className.split(' '));
                    return {
                        style: {}, handlers: {},
                        classList: {
                            contains: name => classes.has(name),
                            add: name => classes.add(name),
                            remove: name => classes.delete(name),
                        },
                        getAttribute: name => name === 'data-status-type' ? id : null,
                        addEventListener(name, callback) { this.handlers[name] = callback; },
                    };
                });
        },
    };
    const dialog = Object.assign(new StatusDialog(), {
        defaultStatus, reminder, showKanbanStatus: 'term', currentKanbanStatuses: [],
        currentActiveProjectGroups: group ? [group] : [],
        dialog: { element: { querySelector: id => id === '#quickStatusSelector'
            ? selector : id === '#quickCustomGroupSelector' ? { value: group?.id || '' } : null } },
        syncCompletedTimeVisibility() {},
    });
    return {
        dialog, selector,
        selected: () => selector.querySelector()?.getAttribute('data-status-type'),
        async initialize(statuses) {
            dialog.renderStatusSelector();
            // 项目选择器异步加载期间，允许原有的零延迟初始化计时器先执行。
            for (const callback of timers.splice(0)) callback();
            await Promise.resolve();
            dialog.currentKanbanStatuses = statuses;
            dialog.updateKanbanStatusSelector();
        },
    };
}

test('项目状态异步加载后，新建任务选中入口传入的自定义 waiting 状态', async () => {
    const view = fixture();
    await view.initialize(projectStatuses);
    assert.equal(view.selected(), 'waiting');
});

test('自定义分组只显示允许的状态，并选中入口传入的自定义状态', async () => {
    const view = fixture({ group: { id: 'group', visibleStatusIds: ['short_term', 'waiting'] } });
    await view.initialize(projectStatuses);
    assert.equal(view.selected(), 'waiting');
    assert.deepEqual(view.selector.options.map(option => option.getAttribute('data-status-type')), ['short_term', 'waiting']);
});

test('用户手动切换状态后，重新渲染仍保留用户选择', async () => {
    const view = fixture();
    await view.initialize(projectStatuses);
    const option = view.selector.options.find(item => item.getAttribute('data-status-type') === 'short_term');
    option.handlers.click({ currentTarget: option });
    view.dialog.updateKanbanStatusSelector();
    assert.equal(view.selected(), 'short_term');
});

test('无项目时仍初始化内置状态，失效状态回退到第一项', async () => {
    const view = fixture({ defaultStatus: 'short_term' });
    await view.initialize([]);
    assert.equal(view.selected(), 'short_term');
    const invalid = fixture({ defaultStatus: 'deleted-status' });
    await invalid.initialize(projectStatuses);
    assert.equal(invalid.selected(), 'doing');
});

test('编辑任务保留自定义状态，已完成任务优先选中已完成', async () => {
    const custom = fixture({ defaultStatus: 'doing', reminder: { kanbanStatus: 'waiting' } });
    await custom.initialize(projectStatuses);
    assert.equal(custom.selected(), 'waiting');
    const completed = fixture({ reminder: { completed: true, kanbanStatus: 'waiting' } });
    await completed.initialize(projectStatuses);
    assert.equal(completed.selected(), 'completed');
});
