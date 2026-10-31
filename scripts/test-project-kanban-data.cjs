// Run with: node --test scripts/test-project-kanban-data.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

function extract(relative, className, names) {
    const content = process.env.KANBAN_SOURCE_REF
        ? execFileSync('git', ['show', `${process.env.KANBAN_SOURCE_REF}:${relative}`], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(path.join(root, relative), 'utf8');
    const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
    const members = className
        ? source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className).members
        : source.statements;
    return members.filter(node => names.includes(node.name?.getText(source)))
        .map(node => node.getText(source).replace(/^export /, '')).join('\n');
}

// 执行真实看板方法及全量任务读写函数，仅替换思源、订阅和界面依赖。
const methods = extract('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', [
    'getReminders', 'editTask', 'showTaskNotePreview', 'setReminderPinned',
    'batchUpdateTasks', 'findOrCreateUiTask', 'getAllDescendantIds',
]);
const persistence = extract('src/utils/icsSubscription.ts', null, ['getAllReminders', 'saveReminders']);
const code = ts.transpileModule(`${persistence}\nclass Board { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function task(id, projectId, kanbanStatus = 'doing') {
    return { id, title: id, projectId, kanbanStatus, completed: false };
}

function fixture(initial) {
    const state = { data: clone(initial), writes: 0, reads: [], dialog: null };
    class QuickReminderDialog {
        constructor(_date, _time, callback) { state.dialog = { callback }; }
        show() {}
    }
    const Board = new Function('loadSubscriptions', 'QuickReminderDialog', 'i18n', 'showMessage',
        'getLogicalDateString', code + ';return Board;')(
        async () => ({ subscriptions: {} }), QuickReminderDialog, key => key, () => {}, () => '2026-10-31',
    );
    const plugin = {
        async loadReminderData(force) {
            state.reads.push(force);
            return state.data;
        },
        async saveReminderData(data) {
            state.data = clone(data);
            state.writes++;
        },
    };
    function board(projectId, visibleProjects = [projectId]) {
        return Object.assign(new Board(), {
            plugin, projectId, tasks: [], reminderData: null,
            isAggregateView: visibleProjects.length > 1,
            isTaskInCurrentView: item => visibleProjects.includes(item.projectId),
            toViewTask: item => ({ ...item }),
            getTaskStatus: item => item.completed ? 'completed' : item.kanbanStatus || 'doing',
            getTaskRealProjectId: item => item.projectId,
            sortTasks() {}, renderKanban() {}, dispatchReminderUpdate() {},
            async queueLoadTasks() {}, async refreshRecurringMobileNotifications() {},
        });
    }
    return { state, board };
}

test('旧看板后续保存保留另一个项目新增的 Waiting/TODO 任务及跨项目移动结果', async () => {
    const { state, board } = fixture({ source: task('source', 'A'), moved: task('moved', 'A') });
    const sourceBoard = board('A');
    await sourceBoard.getReminders();

    // 模拟另一个看板已成功保存；源看板尚未处理广播刷新。
    state.data = {
        source: task('source', 'A'), moved: task('moved', 'B', 'waiting'),
        todo: task('todo', 'B', 'todo'), waiting: task('waiting', 'B', 'waiting'),
    };
    const expected = clone(state.data);
    await sourceBoard.setReminderPinned(expected.source, true);

    assert.equal(state.writes, 1);
    assert.deepEqual(state.data, { ...expected, source: { ...expected.source, pinned: true } });
});

test('旧目标看板保存不会丢掉刚移入的任务，也不会复活已删除任务', async () => {
    const { state, board } = fixture({ target: task('target', 'B', 'waiting'), removed: task('removed', 'B') });
    const targetBoard = board('B');
    await targetBoard.getReminders();
    state.data = { target: state.data.target, moved: task('moved', 'B') };

    await targetBoard.setReminderPinned(state.data.target, true);

    assert.ok(state.data.moved);
    assert.equal(state.data.removed, undefined);
    assert.equal(state.data.target.pinned, true);
});

test('实际跨项目批量移动后进入 Waiting，继续操作两个看板均保留全部任务', async () => {
    const { state, board } = fixture({
        moved: task('moved', 'A'), source: task('source', 'A'), todo: task('todo', 'B', 'todo'),
    });
    const sourceBoard = board('A'), targetBoard = board('B');
    await sourceBoard.getReminders();
    await targetBoard.getReminders();
    await sourceBoard.batchUpdateTasks(['moved'], { projectId: 'B' });
    assert.equal(state.data.moved.projectId, 'B');

    await targetBoard.batchUpdateTasks(['moved'], { kanbanStatus: 'waiting' });
    assert.equal(state.data.moved.kanbanStatus, 'waiting');
    await sourceBoard.setReminderPinned(state.data.source, true);

    assert.deepEqual(Object.keys(state.data).sort(), ['moved', 'source', 'todo']);
    assert.deepEqual(state.data.moved, task('moved', 'B', 'waiting'));
    assert.deepEqual(state.data.todo, task('todo', 'B', 'todo'));
    assert.equal(state.writes, 3);
});

for (const method of ['editTask', 'showTaskNotePreview']) {
    for (const aggregate of [false, true]) {
        test(`${method}：${aggregate ? '聚合' : '普通'}看板转出任务只移除卡片，全量数据保留目标项目任务`, async () => {
            const { state, board } = fixture({ moved: task('moved', 'A'), other: task('other', 'B', 'waiting') });
            const sourceBoard = board('A', aggregate ? ['A', 'C'] : ['A']);
            await sourceBoard.getReminders();
            sourceBoard.tasks = [clone(state.data.moved)];
            await sourceBoard[method](sourceBoard.tasks[0]);

            const saved = task('moved', 'B', 'waiting');
            state.data = { ...state.data, moved: saved };
            await state.dialog.callback(saved);

            assert.equal(sourceBoard.tasks.length, 0);
            assert.deepEqual(sourceBoard.reminderData.moved, saved);
            assert.deepEqual(sourceBoard.reminderData.other, state.data.other);
            assert.equal(state.writes, 0);
        });
    }
}

test('每次取全量数据使用插件最新缓存，并保留显式强制读取选项', async () => {
    const { state, board } = fixture({ first: task('first', 'A') });
    const view = board('A');
    await view.getReminders();
    state.data = { second: task('second', 'B') };
    assert.deepEqual(await view.getReminders(), state.data);
    await view.getReminders(true);
    assert.deepEqual(state.reads, [false, false, true]);
});
