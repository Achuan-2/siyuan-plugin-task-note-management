const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function loadTypeScript(file) {
    const source = fs.readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const exports = {};
    new Function('require', 'exports', outputText)(
        relativePath => loadTypeScript(path.resolve(path.dirname(file), relativePath + '.ts')),
        exports,
    );
    return exports;
}

const { DEFAULT_TASK_VIEW_FILTERS, getTaskViewRows, parseTaskViewFilters, serializeTaskView } =
    loadTypeScript(path.resolve(__dirname, '../src/utils/taskView.ts'));

test('date overlap and status filter retain the ancestors of matching tasks', () => {
    const tasks = [
        { id: 'child', parentId: 'parent', title: '整理实验数据', date: '2026-10-01', endDate: '2026-10-05', projectId: 'research' },
        { id: 'parent', title: '实验项目', completed: true, projectId: 'research' },
        { id: 'sibling', parentId: 'parent', title: '跨项目任务', date: '2026-10-05', projectId: 'other' },
        { id: 'deadline', title: '只设截止日期', endDate: '2026-10-05', projectId: 'research' },
        { id: 'old', title: '更早的任务', date: '2026-10-04', projectId: 'research' },
        { id: 'undated', title: '未安排', projectId: 'research' },
    ];
    const filters = { projectId: 'research', status: 'open', start: '2026-10-05', end: '2026-10-06' };
    assert.deepEqual(getTaskViewRows(tasks, filters).map(row => [row.task.id, row.depth, row.matches]), [
        ['parent', 0, false],
        ['child', 1, true],
        ['deadline', 0, true],
    ]);
});

test('search combines title and note, and renders orphaned and cyclic data once', () => {
    const tasks = [
        { id: 'orphan', parentId: 'removed', title: '[实验数据](siyuan://blocks/20261005000000-data001)', noteSummary: '核查 RAW 文件' },
        { id: 'cycle-a', parentId: 'cycle-b', title: '实验数据', note: 'raw 文件' },
        { id: 'cycle-b', parentId: 'cycle-a', title: '父任务' },
        { id: 'other', title: 'RAW 合同' },
    ];
    const rows = getTaskViewRows(tasks, DEFAULT_TASK_VIEW_FILTERS, '实验 RAW');
    assert.deepEqual(rows.map(row => [row.task.id, row.matches]), [
        ['orphan', true], ['cycle-a', true], ['cycle-b', false],
    ]);
});

test('persisted payload refreshes the indexed titles and cannot close the custom block early', () => {
    const filters = { ...DEFAULT_TASK_VIEW_FILTERS, projectId: 'lab' };
    const tasks = [
        { id: 'a', title: '旧标题', projectId: 'lab' },
        { id: 'b', title: ';;;\n\r\n<测试>', projectId: 'lab', noteSummary: '私人备注' },
        { id: 'c', title: '其他项目', projectId: 'other' },
    ];
    const before = serializeTaskView(filters, tasks);
    assert.deepEqual(parseTaskViewFilters(before), filters);
    assert.match(before, /旧标题/);
    assert.doesNotMatch(before, /私人备注|其他项目|^\s*;;;\s*$/m);
    const after = serializeTaskView(filters, [{ ...tasks[0], title: '新标题' }, tasks[1]]);
    assert.match(after, /新标题/);
    assert.doesNotMatch(after, /旧标题/);
    assert.equal(after, serializeTaskView(filters, [tasks[1], { ...tasks[0], title: '新标题' }]));
    assert.equal(parseTaskViewFilters('Task view v2 {}'), undefined);
});
