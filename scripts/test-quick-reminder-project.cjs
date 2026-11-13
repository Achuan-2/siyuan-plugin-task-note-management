// Run with: node --test scripts/test-quick-reminder-project.cjs
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
const dialogClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'QuickReminderDialog');
const methods = dialogClass.members.filter(node => ['renderProjectSelector', 'onProjectChange', 'saveReminder'].includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class ProjectDialog { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture({ projectId = 'project', initialize = async () => {}, useProjectChange = false,
    projectCategoryId = 'category-a, category-b' } = {}) {
    let popupOptions;
    class Popup {
        constructor(options) { popupOptions = options; }
        initialize() { return initialize(); }
        updateSelection(id) { popupOptions.valueInput.value = id; }
    }
    const projectManager = {
        getProjectById: () => ({ categoryId: projectCategoryId }),
        getProjectCustomGroups: async () => [],
        getProjectKanbanStatuses: async () => [],
        getDefaultKanbanStatuses: () => [],
    };
    const ProjectDialog = new Function('ProjectSelectorPopup', 'console', 'require', `${code}; return ProjectDialog;`)(
        Popup, { error() {} }, moduleId => {
            assert.equal(moduleId, '../dataManager/projectManager');
            return { ProjectManager: { getInstance: () => projectManager } };
        },
    );
    const categoryButtons = ['', 'category-a', 'category-b', 'manual-category'].map(id => {
        const classes = new Set(id ? [] : ['selected']);
        return {
            getAttribute: name => name === 'data-category' ? id : null,
            classList: {
                add: name => classes.add(name), remove: name => classes.delete(name),
                contains: name => classes.has(name),
            },
        };
    });
    const fields = {
        '#quickProjectSelector': { value: '' },
        '#quickProjectSearchInput': { value: '' },
        '#quickProjectDropdown': {},
        '#quickReminderTitle': { value: 'edited task' },
        '#quickReminderDate': { value: '' },
        '#quickReminderEndDate': { value: '' },
        '#quickCustomGroup': { style: {} },
        '.category-selector': { querySelectorAll: () => categoryButtons },
    };
    const state = { saved: [], closed: false, projectChanges: [] };
    const dialog = Object.assign(new ProjectDialog(), {
        mode: 'batch_edit', isFormInitializing: false,
        defaultProjectId: projectId, reminder: { id: 'task', projectId },
        currentKanbanStatuses: [], selectedCategoryIds: [], selectedTagIds: [], customTimes: [],
        repeatConfig: { enabled: false },
        projectManager,
        dialog: { element: { querySelector: selector => fields[selector] || null } },
        onProjectChange: async function (id, isUserSelection) {
            state.projectChanges.push(id);
            if (useProjectChange) await ProjectDialog.prototype.onProjectChange.call(this, id, isUserSelection);
        },
        renderMilestoneSelector: async () => {}, renderTagsSelector: async () => {},
        updateKanbanStatusSelector() {},
        filterKanbanStatusesBySelectedGroup: statuses => statuses,
        getEstimatedPomodoroDurationValue() {}, getCustomProgressValue() {},
        validateCustomReminderTimes: () => true,
        applyStartDateOnlyOverdueOverride() {}, applyReminderSkipDateOverrides() {},
        applyCompletedInstanceSnapshots() {},
        onSaved: task => state.saved.push(task),
        destroyDialog: () => { state.closed = true; },
    });
    return { dialog, fields, state, categoryButtons, select: id => {
        fields['#quickProjectSelector'].value = id;
        return popupOptions.onSelect(id);
    } };
}

test('项目列表仍在加载时，默认项目已写入表单，不会暂时变成无项目', async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const f = fixture({ initialize: () => pending });
    const rendering = f.dialog.renderProjectSelector();
    const valueWhileLoading = f.fields['#quickProjectSelector'].value;
    finish();
    await rendering;
    assert.equal(valueWhileLoading, 'project');
    assert.equal(f.fields['#quickProjectSelector'].value, 'project');
});

test('项目选择器加载失败后保存，仍保留入口传入的所属项目', async () => {
    const f = fixture({ initialize: async () => { throw new Error('read failed'); } });
    await f.dialog.renderProjectSelector();
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].projectId, 'project');
});

test('限定项目入口在列表加载失败后，仍保留第一个允许的项目', async () => {
    const f = fixture({ projectId: '', initialize: async () => { throw new Error('read failed'); } });
    f.dialog.allowedProjectIds = ['allowed'];
    await f.dialog.renderProjectSelector();
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].projectId, 'allowed');
});

for (const mode of ['edit', 'batch_edit', 'quick']) {
    test(`${mode} 表单尚未填充完成时，保存入口不读取空字段、不回调、不关闭`, async () => {
        const f = fixture();
        Object.assign(f.dialog, {
            mode, isFormInitializing: true,
            dialog: { element: { querySelector() { throw new Error('表单尚未填充'); } } },
        });
        await f.dialog.saveReminder();
        assert.deepEqual(f.state.saved, []);
        assert.equal(f.state.closed, false);
    });
}

test('用户明确选择无项目后保存，允许清除已有项目', async () => {
    const f = fixture();
    await f.dialog.renderProjectSelector();
    await f.select('');
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].projectId, undefined);
    assert.equal(f.state.closed, true);
});

test('用户切换项目后保存使用新项目', async () => {
    const f = fixture();
    await f.dialog.renderProjectSelector();
    await f.select('another');
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].projectId, 'another');
});

for (const mode of ['quick', 'edit']) {
    test(`${mode} 无分类任务主动设置项目后，继承项目多分类并写入保存回调`, async () => {
        const f = fixture({ projectId: '', useProjectChange: true });
        Object.assign(f.dialog, { mode, skipSave: true });
        await f.dialog.renderProjectSelector();
        await f.select('project');
        assert.deepEqual(f.dialog.selectedCategoryIds, ['category-a', 'category-b']);
        assert.deepEqual(f.categoryButtons.filter(button => button.classList.contains('selected'))
            .map(button => button.getAttribute('data-category')), ['category-a', 'category-b']);
        await f.dialog.saveReminder();
        assert.equal(f.state.saved[0].categoryId, 'category-a,category-b');
        assert.equal(f.state.saved[0].projectId, 'project');
    });
}

test('编辑已有项目的无分类任务，仅初始化不会自动补上分类，主动改选项目后才继承', async () => {
    const f = fixture({ useProjectChange: true });
    Object.assign(f.dialog, { mode: 'edit', skipSave: true });
    await f.dialog.renderProjectSelector();
    assert.deepEqual(f.dialog.selectedCategoryIds, []);
    await f.select('another');
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].categoryId, 'category-a,category-b');
});

for (const mode of ['quick', 'edit']) {
    test(`${mode} 设置项目不覆盖手动选择或父任务继承的分类`, async () => {
        const f = fixture({ projectId: '', useProjectChange: true });
        Object.assign(f.dialog, { mode, skipSave: true, selectedCategoryIds: ['manual-category'] });
        await f.dialog.renderProjectSelector();
        await f.select('project');
        await f.dialog.saveReminder();
        assert.equal(f.state.saved[0].categoryId, 'manual-category');
    });
}

test('新建子任务带默认项目时，仍自动继承项目分类', async () => {
    const f = fixture({ useProjectChange: true });
    Object.assign(f.dialog, { mode: 'quick', skipSave: true, defaultParentId: 'parent' });
    await f.dialog.renderProjectSelector();
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].categoryId, 'category-a,category-b');
});

for (const projectCategoryId of ['', '  , ']) {
    test(`项目没有有效分类时，任务仍保存为无分类：${JSON.stringify(projectCategoryId)}`, async () => {
        const f = fixture({ projectId: '', useProjectChange: true, projectCategoryId });
        Object.assign(f.dialog, { mode: 'edit', skipSave: true });
        await f.dialog.renderProjectSelector();
        await f.select('project');
        await f.dialog.saveReminder();
        assert.equal(f.state.saved[0].categoryId, undefined);
        assert.equal(f.categoryButtons[0].classList.contains('selected'), true);
    });
}

test('批量编辑选择项目仍不自动填写分类，避免改变批量编辑语义', async () => {
    const f = fixture({ projectId: '', useProjectChange: true });
    await f.dialog.renderProjectSelector();
    await f.select('project');
    await f.dialog.saveReminder();
    assert.equal(f.state.saved[0].categoryId, undefined);
});

for (const options of [{}, { dateOnly: true }, { isInstanceEdit: true }]) {
    test(`编辑任务回调保留所属项目：${JSON.stringify(options)}`, async () => {
        const f = fixture();
        Object.assign(f.dialog, { mode: 'edit', skipSave: true, ...options });
        if (options.isInstanceEdit) f.dialog.reminder.isInstance = true;
        await f.dialog.renderProjectSelector();
        await f.dialog.saveReminder();
        assert.equal(f.state.saved[0].projectId, 'project');
        assert.equal(f.state.closed, true);
    });
}

test('保存按钮和快捷键共用初始化保护，编辑字段填充完成后才启用保存', () => {
    const show = dialogClass.members.find(node => node.name?.getText(source) === 'show').getText(source);
    assert.match(show, /this\.isFormInitializing = true/);
    assert.match(show, /id="quickConfirmBtn" disabled/);
    assert.ok(show.indexOf('this.isFormInitializing = false') > show.indexOf('await this.populateEditForm()'));
    assert.match(show, /confirmBtn\.disabled = false/);
});
