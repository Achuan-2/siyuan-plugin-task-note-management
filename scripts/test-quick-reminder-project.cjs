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
const methods = dialogClass.members.filter(node => ['renderProjectSelector', 'saveReminder'].includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class ProjectDialog { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture({ projectId = 'project', initialize = async () => {} } = {}) {
    let popupOptions;
    class Popup {
        constructor(options) { popupOptions = options; }
        initialize() { return initialize(); }
        updateSelection(id) { popupOptions.valueInput.value = id; }
    }
    const ProjectDialog = new Function('ProjectSelectorPopup', 'console', `${code}; return ProjectDialog;`)(
        Popup, { error() {} },
    );
    const fields = {
        '#quickProjectSelector': { value: '' },
        '#quickProjectSearchInput': { value: '' },
        '#quickProjectDropdown': {},
        '#quickReminderTitle': { value: 'edited task' },
        '#quickReminderDate': { value: '' },
        '#quickReminderEndDate': { value: '' },
    };
    const state = { saved: [], closed: false, projectChanges: [] };
    const dialog = Object.assign(new ProjectDialog(), {
        mode: 'batch_edit', isFormInitializing: false,
        defaultProjectId: projectId, reminder: { id: 'task', projectId },
        currentKanbanStatuses: [], selectedCategoryIds: [], selectedTagIds: [], customTimes: [],
        repeatConfig: { enabled: false },
        dialog: { element: { querySelector: selector => fields[selector] || null } },
        onProjectChange: async id => state.projectChanges.push(id),
        filterKanbanStatusesBySelectedGroup: statuses => statuses,
        getEstimatedPomodoroDurationValue() {}, getCustomProgressValue() {},
        validateCustomReminderTimes: () => true,
        applyStartDateOnlyOverdueOverride() {}, applyReminderSkipDateOverrides() {},
        applyCompletedInstanceSnapshots() {},
        onSaved: task => state.saved.push(task),
        destroyDialog: () => { state.closed = true; },
    });
    return { dialog, fields, state, select: id => {
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
