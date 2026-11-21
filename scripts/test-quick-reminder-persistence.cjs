// Run with: pnpm exec node --test scripts/test-quick-reminder-persistence.cjs
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
assert.equal(source.parseDiagnostics.length, 0);
const names = ['saveReminder', 'onProjectChange', 'applyProjectChange', 'renderCustomGroupSelector', 'onCustomGroupChange'];
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'QuickReminderDialog')
    .members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Subject { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const clone = value => structuredClone(value);
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture() {
    const original = {
        id: 'task', title: '绑定任务', blockId: 'block', docId: 'doc', projectId: 'old-project',
        customGroupId: 'old-group', kanbanStatus: 'short_term', pomodoroCount: 3,
    };
    const state = {
        data: { task: clone(original), child: { id: 'child', parentId: 'task', blockId: 'child-block', projectId: 'old-project' } },
        writes: [], callbacks: [], messages: [], errors: [], refreshed: [], closed: false,
        notification: async () => {}, beforeWrite: async () => {}, fail: false,
    };
    const projectManager = {
        getProjectCustomGroups: async () => [{ id: 'new-group', name: '新分组' }],
        getProjectKanbanStatuses: async () => [{ id: 'short_term' }],
        getDefaultKanbanStatuses: () => [{ id: 'short_term' }],
    };
    const dependencies = {
        require: name => name.endsWith('/api') ? { addBlockProjectId: async () => {}, setBlockProjectIds: async () => {} }
            : { ProjectManager: { getInstance: () => projectManager } },
        i18n: key => key, showMessage: message => state.messages.push(message),
        getLogicalDateString: () => '2026-11-17', compareDateStrings: (a, b) => a.localeCompare(b),
        getBlockByID: async () => ({ id: 'block', root_id: 'doc' }),
        updateBindBlockAtrrs: async id => {
            assert.ok(state.writes.length > 0, '块属性只能在任务保存成功后更新');
            state.refreshed.push(id);
        },
        window: { dispatchEvent() {} }, CustomEvent: class {},
        console: { error: (...args) => state.errors.push(args), warn() {}, debug() {} },
    };
    const Subject = new Function(...Object.keys(dependencies), `${code}; return Subject;`)(...Object.values(dependencies));
    const fields = Object.fromEntries(Object.entries({
        quickReminderTitle: '编辑绑定任务', quickBlockInput: 'block', quickProjectSelector: 'new-project',
        quickCustomGroupSelector: 'new-group', quickMilestoneSelector: '',
        quickReminderDate: '', quickReminderEndDate: '',
    }).map(([id, value]) => [`#${id}`, { value }]));
    fields['#quickConfirmBtn'] = { disabled: false };
    fields['#quickCustomGroup'] = { style: {} };
    const dialog = Object.assign(new Subject(), {
        mode: 'edit', reminder: clone(original), selectedCategoryIds: [], selectedTagIds: [], customTimes: [],
        tempSubtasks: [], currentKanbanStatuses: [{ id: 'short_term' }], repeatConfig: { enabled: false },
        dialog: { element: { querySelector: selector => fields[selector] || null } },
        extractBlockId: value => value, filterKanbanStatusesBySelectedGroup: statuses => statuses,
        getEstimatedPomodoroDurationValue() {}, getCustomProgressValue() {},
        validateCustomReminderTimes: () => true, applyStartDateOnlyOverdueOverride() {},
        applyReminderSkipDateOverrides() {}, applyCompletedInstanceSnapshots() {},
        renderMilestoneSelector: async () => {}, renderTagsSelector: async () => {}, updateKanbanStatusSelector() {},
        plugin: {
            loadReminderData: async () => clone(state.data),
            saveReminderData: async data => {
                await state.beforeWrite();
                if (state.fail) throw new Error('write failed');
                state.data = clone(data);
                state.writes.push(clone(data));
            },
            updateMobileNotification: async () => state.notification(),
        },
        onSaved: task => {
            state.callbacks.push(clone(task));
        },
        destroyDialog: () => { state.closed = true; },
    });
    return { dialog, state, fields, projectManager };
}

test('修改项目和分组时保留块绑定、番茄统计，父子任务一次落盘后再同步块属性', async () => {
    const f = fixture();
    f.state.data.task.pomodoroCount = 4;
    f.state.data.task.repeat = { instances: { '2026-11-16': { completed: true } } };
    await f.dialog.saveReminder();
    assert.deepEqual(f.state.errors, []);
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.callbacks.length, 1);
    assert.equal(f.state.closed, true);
    assert.equal(f.state.data.task.blockId, 'block');
    assert.equal(f.state.data.task.pomodoroCount, 4);
    assert.equal(f.state.data.task.repeat.instances['2026-11-16'].completed, true);
    for (const id of ['task', 'child']) {
        assert.equal(f.state.data[id].projectId, 'new-project');
        assert.equal(f.state.data[id].customGroupId, 'new-group');
    }
    assert.deepEqual(f.state.refreshed.sort(), ['block', 'child-block']);
});

test('通知等待期间刷新并新增任务，编辑结束不会拿旧快照覆盖新增任务及其绑定', async () => {
    const f = fixture();
    let notifications = 0;
    f.state.notification = async () => {
        if (++notifications !== 1) return;
        f.state.data = clone(f.state.data);
        f.state.data.newTask = { id: 'newTask', blockId: 'new-block', pomodoroCount: 2 };
        f.state.data.task.note = '其他窗口更新';
    };
    await f.dialog.saveReminder();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.state.errors, []);
    assert.equal(f.state.data.newTask.blockId, 'new-block');
    assert.equal(f.state.data.task.note, '其他窗口更新');
    assert.equal(f.state.writes.length, 1);
});

test('写入尚未完成时保持弹窗、不回调，连按确认也只提交一次', async () => {
    const f = fixture(), gate = deferred();
    f.state.beforeWrite = () => gate.promise;
    const pending = f.dialog.saveReminder();
    await drain();
    const before = { closed: f.state.closed, callbacks: f.state.callbacks.length, disabled: f.fields['#quickConfirmBtn'].disabled };
    await f.dialog.saveReminder();
    gate.resolve();
    await pending;
    assert.deepEqual(before, { closed: false, callbacks: 0, disabled: true });
    assert.equal(f.state.writes.length, 1);
});

test('保存父任务会等待列表中的子任务标题提交，失败时保留弹窗', async () => {
    const f = fixture(), gate = deferred();
    f.dialog.subtasksDialog = { finishInlineTitle: () => gate.promise };
    const pending = [f.dialog.saveReminder(), f.dialog.saveReminder()];
    await drain();
    assert.equal(f.state.writes.length, 0);
    f.state.data.child.title = '行内改名';
    gate.resolve(true);
    await Promise.all(pending);
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.data.child.title, '行内改名');

    const failed = fixture();
    failed.dialog.subtasksDialog = { finishInlineTitle: async () => false };
    await failed.dialog.saveReminder();
    assert.equal(failed.state.writes.length, 0);
    assert.equal(failed.state.closed, false);
});

test('保存失败不关闭或通知面板，解除提交锁后可以重试', async () => {
    const f = fixture();
    f.state.fail = true;
    await f.dialog.saveReminder();
    assert.equal(f.state.closed, false);
    assert.equal(f.state.callbacks.length, 0);
    assert.equal(f.dialog.isSaving, false);
    assert.equal(f.fields['#quickConfirmBtn'].disabled, false);
    assert.deepEqual(f.state.messages, ['updateReminderFailed']);
    assert.deepEqual(f.state.refreshed, []);
    f.state.fail = false;
    await f.dialog.saveReminder();
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.closed, true);
});

test('编辑期间已被删除的任务不会因旧弹窗保存而复活', async () => {
    const f = fixture();
    delete f.state.data.task;
    await f.dialog.saveReminder();
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.closed, false);
});

for (const blockId of ['', 'new-block']) {
    test(`主动${blockId ? '更换' : '清除'}绑定后，只在落盘成功后刷新原块`, async () => {
        const f = fixture();
        f.fields['#quickBlockInput'].value = blockId;
        await f.dialog.saveReminder();
        assert.deepEqual(f.state.errors, []);
        assert.equal(f.state.data.task.blockId, blockId || null);
        assert.ok(f.state.refreshed.includes('block'));
        if (blockId) assert.ok(f.state.refreshed.includes(blockId));
        else assert.equal(f.state.data.task.docId, undefined);
        assert.equal(f.state.writes.length, 1);
    });
}

test('新建绑定任务首次写入就包含 docId，无需再写整份任务文件', async () => {
    const f = fixture();
    f.dialog.mode = 'quick';
    f.dialog.reminder = undefined;
    await f.dialog.saveReminder();
    assert.deepEqual(f.state.errors, []);
    const created = Object.values(f.state.data).find(task => task.id.startsWith('reminder_'));
    assert.equal(created.blockId, 'block');
    assert.equal(created.docId, 'doc');
    assert.equal(f.state.writes.length, 1);
});

test('项目切换尚未加载完成时，保存入口不读取半填充的表单', async () => {
    const f = fixture(), gate = deferred();
    f.dialog.applyProjectChange = () => gate.promise;
    const pending = f.dialog.onProjectChange('new-project', true);
    await f.dialog.saveReminder();
    const writes = f.state.writes.length;
    gate.resolve();
    await pending;
    assert.equal(writes, 0);
    assert.equal(f.state.closed, false);
});

test('快速切换项目时串行处理，并跳过尚未执行的过时选择', async () => {
    const f = fixture(), gate = deferred(), calls = [];
    f.dialog.applyProjectChange = async project => {
        calls.push(project);
        if (project === 'first') await gate.promise;
        f.dialog.currentKanbanStatuses = [{ id: project }];
    };
    const first = f.dialog.onProjectChange('first', true);
    await drain();
    const second = f.dialog.onProjectChange('second', true);
    const last = f.dialog.onProjectChange('last', true);
    gate.resolve();
    await Promise.all([first, second, last]);
    assert.deepEqual(calls, ['first', 'last']);
    assert.equal(f.dialog.currentKanbanStatuses[0].id, 'last');
    assert.equal(f.dialog.projectChangeQueue, undefined);
});

test('切换项目清除旧项目分组与里程碑的默认值', async () => {
    const f = fixture();
    Object.assign(f.dialog, { defaultProjectId: 'old-project', defaultCustomGroupId: 'old-group', defaultMilestoneId: 'old-milestone' });
    f.dialog.applyProjectChange = async () => {};
    await f.dialog.onProjectChange('new-project', true);
    assert.equal(f.fields['#quickCustomGroupSelector'].value, '');
    assert.equal(f.dialog.defaultCustomGroupId, null);
    assert.equal(f.dialog.defaultMilestoneId, '');
});

test('再次选择当前项目时保留刚选的分组，不恢复弹窗打开时的默认分组', async () => {
    const f = fixture();
    Object.assign(f.dialog, { renderedProjectId: 'new-project', defaultCustomGroupId: 'old-group' });
    f.dialog.applyProjectChange = async () => {};
    await f.dialog.onProjectChange('new-project', true);
    assert.equal(f.dialog.defaultCustomGroupId, 'new-group');
});

test('项目关联选项加载失败后，后一次选择仍能执行并解除保存锁', async () => {
    const f = fixture();
    f.dialog.applyProjectChange = async project => {
        if (project === 'failed') throw new Error('read failed');
    };
    await assert.rejects(f.dialog.onProjectChange('failed', true), /read failed/);
    await f.dialog.onProjectChange('new-project', true);
    assert.equal(f.dialog.renderedProjectId, 'new-project');
    assert.equal(f.dialog.projectChangeQueue, undefined);
});

test('分组关联的里程碑仍在加载时不能保存，后续切换项目等待它完成', async () => {
    const f = fixture(), gate = deferred(), calls = [];
    f.dialog.renderMilestoneSelector = async () => { calls.push('group'); await gate.promise; };
    f.dialog.applyProjectChange = async () => calls.push('project');
    const group = f.dialog.onCustomGroupChange('old-project', 'new-group');
    await f.dialog.saveReminder();
    const project = f.dialog.onProjectChange('new-project', true);
    await drain();
    const before = [...calls];
    gate.resolve();
    await Promise.all([group, project]);
    assert.equal(f.state.writes.length, 0);
    assert.deepEqual(before, ['group']);
    assert.deepEqual(calls, ['group', 'project']);
});

test('反复渲染分组选择器只保留当前项目的一组事件', async () => {
    const f = fixture(), calls = [];
    const input = { value: '', addEventListener() { throw new Error('不应累积旧项目监听器'); } };
    const dropdown = { style: {}, querySelector: () => null, addEventListener: input.addEventListener };
    Object.assign(f.fields, {
        '#quickCustomGroupSearchInput': input, '#quickCustomGroupDropdown': dropdown,
    });
    f.dialog.onCustomGroupChange = async project => calls.push(project);
    await f.dialog.renderCustomGroupSelector('old-project');
    await f.dialog.renderCustomGroupSelector('new-project');
    await dropdown.onclick({ target: { closest: () => ({ getAttribute: name => name === 'data-value' ? 'new-group' : '新分组' }) } });
    assert.deepEqual(calls, ['new-project']);
});
