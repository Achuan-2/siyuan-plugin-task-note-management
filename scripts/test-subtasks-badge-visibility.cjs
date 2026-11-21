// Run with: node --test scripts/test-subtasks-badge-visibility.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function extractClassMethods(relativePath, className, methodNames) {
    const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const source = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    assert.ok(cls, `Class ${className} not found in ${relativePath}`);
    const members = cls.members
        .filter(node => methodNames.includes(node.name?.getText(source)))
        .map(node => node.getText(source))
        .join('\n');
    const transpiled = ts.transpileModule(`class Extracted { ${members} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    return new Function(`${transpiled}; return Extracted;`)();
}

const SubtasksMethods = extractClassMethods(
    'src/components/dialog/SubtasksDialog.ts',
    'SubtasksDialog',
    [
        'getResolvedTempParentTask',
        'getResolvedRootParentTask',
        'getRenderedParentId',
        'getSubtaskBadgeVisibility',
        'refreshDisplay',
    ]
);

const QuickDialogMethods = extractClassMethods(
    'src/components/dialog/QuickReminderDialog.ts',
    'QuickReminderDialog',
    [
        'getCurrentProjectId',
        'getCurrentCustomGroupId',
        'getCurrentStatus',
        'getCurrentMilestoneId',
        'getCurrentCategoryId',
        'getCurrentTagIds',
        'getCurrentPriority',
        'getTempParentTask',
        'getCurrentTitle',
        'mountSubtasksTab',
    ]
);

function createSubtasksHarness({
    parentId = 'root',
    isTempMode = false,
    parentTaskCache = null,
    tempParentTask = null,
    subtasks = [],
} = {}) {
    return Object.assign(new SubtasksMethods(), {
        parentId,
        isTempMode,
        parentTaskCache,
        tempParentTask,
        subtasks,
        closed: false,
    });
}

test('直属子任务的分类、标签和里程碑与父任务相同时均隐藏', () => {
    const parent = {
        id: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-b, cat-a',
        milestoneId: 'ms-1',
        tags: ['tag-2', 'tag-1'],
        tagIds: ['ptag-2', 'ptag-1'],
    };
    const child = {
        id: 'child-1',
        parentId: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-a,cat-b',
        milestoneId: 'ms-1',
        tags: ['tag-1', 'tag-2'],
        tagIds: ['ptag-1', 'ptag-2'],
    };
    const harness = createSubtasksHarness({
        parentId: 'root',
        parentTaskCache: parent,
        subtasks: [child],
    });
    const visibility = harness.getSubtaskBadgeVisibility(
        child,
        'root',
        harness.getResolvedRootParentTask(),
        new Map([[child.id, child]])
    );
    assert.deepEqual(visibility, {
        showCategoryBadge: false,
        showMilestoneBadge: false,
        showTagBadge: false,
        showProjectTagBadge: false,
    });
});

test('子任务仅部分属性与父任务不同时，仅显示不同的属性', () => {
    const parent = {
        id: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-a',
        milestoneId: 'ms-1',
        tags: ['tag-1'],
        tagIds: ['ptag-1'],
    };
    const child = {
        id: 'child-1',
        parentId: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-a,cat-b',
        milestoneId: 'ms-1',
        tags: ['tag-1'],
        tagIds: ['ptag-1', 'ptag-2'],
    };
    const harness = createSubtasksHarness({
        parentId: 'root',
        parentTaskCache: parent,
        subtasks: [child],
    });
    const visibility = harness.getSubtaskBadgeVisibility(
        child,
        'root',
        harness.getResolvedRootParentTask(),
        new Map([[child.id, child]])
    );
    assert.deepEqual(visibility, {
        showCategoryBadge: true,
        showMilestoneBadge: false,
        showTagBadge: false,
        showProjectTagBadge: true,
    });
});

test('项目不同但 tagIds 相同时不隐藏项目标签', () => {
    const parent = {
        id: 'root',
        projectId: 'proj-1',
        tagIds: ['ptag-1'],
    };
    const child = {
        id: 'child-1',
        parentId: 'root',
        projectId: 'proj-2',
        tagIds: ['ptag-1'],
    };
    const harness = createSubtasksHarness({
        parentId: 'root',
        parentTaskCache: parent,
        subtasks: [child],
    });
    const visibility = harness.getSubtaskBadgeVisibility(
        child,
        'root',
        harness.getResolvedRootParentTask(),
        new Map([[child.id, child]])
    );
    assert.equal(visibility.showProjectTagBadge, true);
});

test('多级嵌套子任务按直接父任务比较分类、标签和里程碑', () => {
    const rootTask = {
        id: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-a',
        milestoneId: 'ms-1',
        tagIds: ['ptag-1'],
    };
    const level1 = {
        id: 'child-1',
        parentId: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-a',
        milestoneId: 'ms-2',
        tagIds: ['ptag-2'],
    };
    const grandChildSameAsDirectParent = {
        id: 'grand-1',
        parentId: 'child-1',
        projectId: 'proj-1',
        categoryId: 'cat-a',
        milestoneId: 'ms-2',
        tagIds: ['ptag-2'],
    };
    const grandChildSameAsRootNotDirect = {
        id: 'grand-2',
        parentId: 'child-1',
        projectId: 'proj-1',
        categoryId: 'cat-a',
        milestoneId: 'ms-1',
        tagIds: ['ptag-1'],
    };
    const subtasks = [level1, grandChildSameAsDirectParent, grandChildSameAsRootNotDirect];
    const subtasksById = new Map(subtasks.map(t => [t.id, t]));
    const harness = createSubtasksHarness({
        parentId: 'root',
        parentTaskCache: rootTask,
        subtasks,
    });
    const resolvedRoot = harness.getResolvedRootParentTask();

    assert.deepEqual(
        harness.getSubtaskBadgeVisibility(level1, 'root', resolvedRoot, subtasksById),
        {
            showCategoryBadge: false,
            showMilestoneBadge: true,
            showTagBadge: true,
            showProjectTagBadge: true,
        }
    );
    assert.deepEqual(
        harness.getSubtaskBadgeVisibility(grandChildSameAsDirectParent, 'root', resolvedRoot, subtasksById),
        {
            showCategoryBadge: false,
            showMilestoneBadge: false,
            showTagBadge: true,
            showProjectTagBadge: false,
        }
    );
    assert.deepEqual(
        harness.getSubtaskBadgeVisibility(grandChildSameAsRootNotDirect, 'root', resolvedRoot, subtasksById),
        {
            showCategoryBadge: false,
            showMilestoneBadge: true,
            showTagBadge: true,
            showProjectTagBadge: true,
        }
    );
});

test('编辑模式下父任务表单未保存修改（含清空）会实时覆盖缓存并触发子任务页签刷新', async () => {
    const selectors = {
        '#quickProjectSelector': { value: 'proj-1' },
        '#quickCustomGroupSelector': { value: '' },
        '#quickMilestoneSelector': { value: '' },
        '#quickReminderTitle': { value: 'Parent' },
        '#quickStatusSelector .task-status-option.selected': null,
        '#quickPrioritySelector .priority-option.selected': null,
        '#quickSubtasksTabPanel': { dataset: { mounted: 'true' } },
    };
    let refreshed = 0;
    const quickDialog = Object.assign(new QuickDialogMethods(), {
        isFormInitializing: false,
        selectedCategoryIds: [],
        selectedTagIds: [],
        reminder: {
            id: 'root',
            projectId: 'proj-1',
            categoryId: 'cat-a',
            milestoneId: 'ms-1',
            tagIds: ['ptag-1'],
            tags: ['custom-1'],
        },
        subtasksDialog: {
            refreshDisplay() {
                refreshed += 1;
            },
        },
        dialog: {
            element: {
                querySelector: selector => selectors[selector] || null,
            },
        },
    });

    const liveParent = quickDialog.getTempParentTask();
    assert.equal(liveParent.categoryId, undefined);
    assert.equal(liveParent.milestoneId, undefined);
    assert.equal(liveParent.tagIds, undefined);
    assert.deepEqual(liveParent.tags, ['custom-1']);

    const harness = createSubtasksHarness({
        parentId: 'root',
        parentTaskCache: quickDialog.reminder,
        tempParentTask: () => quickDialog.getTempParentTask(),
    });
    const child = {
        id: 'child-1',
        parentId: 'root',
        projectId: 'proj-1',
        categoryId: 'cat-a',
        milestoneId: 'ms-1',
        tagIds: ['ptag-1'],
        tags: ['custom-1'],
    };
    const visibility = harness.getSubtaskBadgeVisibility(
        child,
        'root',
        harness.getResolvedRootParentTask(),
        new Map([[child.id, child]])
    );
    assert.deepEqual(visibility, {
        showCategoryBadge: true,
        showMilestoneBadge: true,
        showTagBadge: false,
        showProjectTagBadge: true,
    });

    await quickDialog.mountSubtasksTab();
    assert.equal(refreshed, 1);
});

test('TaskRenderer 渲染自定义标签与项目标签受 showTagBadge / showProjectTagBadge 控制', () => {
    const rendererSource = fs.readFileSync(path.join(root, 'src/components/render/TaskRenderer.ts'), 'utf8');
    assert.match(rendererSource, /showTagBadge\?:\s*boolean/);
    assert.match(rendererSource, /showProjectTagBadge\?:\s*boolean/);
    assert.match(rendererSource, /context\.showTagBadge !== false && task\.tags/);
    assert.match(rendererSource, /context\.showProjectTagBadge !== false && task\.projectId && task\.tagIds/);
});
