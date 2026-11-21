// Run with: node --test scripts/test-task-notes-storage.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const loadTaskActionUndo = require('./lib/task-action-undo.cjs');

const root = path.resolve(__dirname, '..');

function createHarness({ conflictOnce = false } = {}) {
    const state = {
        ignoreContent: '# user comment\n/assets/keep-*.png\n/assets/manual.png\n',
        ignoreRevision: 1,
        conflictInjected: false,
        files: new Map(), // workspace relative path e.g. /data/assets/xxx.png -> Uint8Array/string
        pluginData: new Map(), // plugin relative path e.g. notes/task-1.md -> string
        reminders: {},
        settings: { datatransfer: {} },
        fetchLog: [],
        removedFiles: [],
        loadedNoteFiles: [],
    };

    const apiMock = {
        async fetchSyncPost(url, data = {}) {
            state.fetchLog.push({ url, data: JSON.parse(JSON.stringify(data)) });
            if (url === '/api/asset/getAssetCleanupIgnore') {
                return {
                    code: 0,
                    data: {
                        content: state.ignoreContent,
                        revision: String(state.ignoreRevision),
                    },
                };
            }
            if (url === '/api/asset/addAssetCleanupIgnore') {
                const paths = Array.isArray(data.paths) ? data.paths : [];
                const lines = state.ignoreContent ? state.ignoreContent.split(/\r?\n/) : [];
                const normalizedExisting = new Set(lines.map(l => l.trim()).filter(Boolean));
                let added = 0;
                for (const p of paths) {
                    const normalized = String(p).replace(/^\/+/, '');
                    const literal = '/' + normalized.replace(/([*\[\]()+^${}|])/g, '\\$1');
                    if (!normalizedExisting.has(literal)) {
                        lines.push(literal);
                        normalizedExisting.add(literal);
                        added++;
                    }
                }
                state.ignoreContent = lines.filter((line, idx, arr) => idx < arr.length - 1 || line !== '').join('\n') + '\n';
                state.ignoreRevision++;
                return { code: 0, data: { addedCount: added, revision: String(state.ignoreRevision) } };
            }
            if (url === '/api/asset/setAssetCleanupIgnore') {
                if (conflictOnce && !state.conflictInjected) {
                    state.conflictInjected = true;
                    state.ignoreContent += '/assets/concurrent.png\n';
                    state.ignoreRevision++;
                    return { code: 409, msg: 'conflict', data: { revision: String(state.ignoreRevision) } };
                }
                if (data.expectedRevision !== undefined && String(data.expectedRevision) !== String(state.ignoreRevision)) {
                    return { code: 409, msg: 'conflict', data: { revision: String(state.ignoreRevision) } };
                }
                state.ignoreContent = data.content || '';
                state.ignoreRevision++;
                return { code: 0, data: { revision: String(state.ignoreRevision) } };
            }
            if (url === '/api/file/removeFile') {
                state.removedFiles.push(data.path);
                state.files.delete(data.path);
                return { code: 0, data: null };
            }
            return { code: 0, data: null };
        },
        async getFileBlob(filePath) {
            const content = state.files.get(filePath);
            if (!content) return null;
            return new Blob([content], { type: 'image/png' });
        },
        async putFile(filePath, _isDir, file) {
            const text = typeof file === 'string' ? file : await file.text();
            state.files.set(filePath, text);
            return { code: 0, data: null };
        },
        async removeFile(filePath) {
            state.removedFiles.push(filePath);
            state.files.delete(filePath);
            return { code: 0, data: null };
        },
        async readDir(dirPath) {
            const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
            const entries = [];
            for (const key of state.files.keys()) {
                if (key.startsWith(prefix)) {
                    const name = key.slice(prefix.length);
                    if (name && !name.includes('/')) {
                        entries.push({ name, isDir: false });
                    }
                }
            }
            return entries;
        },
    };

    const plugin = {
        name: 'siyuan-plugin-task-note-management',
        async loadReminderData() {
            return JSON.parse(JSON.stringify(state.reminders));
        },
        async saveReminderData(data) {
            state.reminders = JSON.parse(JSON.stringify(data));
        },
        async saveSettings(settings) {
            state.settings = JSON.parse(JSON.stringify(settings));
        },
        async readTaskNoteFile(noteId) {
            const relPath = `notes/${noteId}.md`;
            state.loadedNoteFiles.push(relPath);
            return state.pluginData.has(relPath) ? state.pluginData.get(relPath) : null;
        },
        async writeTaskNoteFile(noteId, content) {
            state.pluginData.set(`notes/${noteId}.md`, content);
        },
        async removeTaskNoteFile(noteId) {
            state.pluginData.delete(`notes/${noteId}.md`);
        },
        async loadData(relPath) {
            if (relPath === 'reminder.json') return JSON.parse(JSON.stringify(state.reminders));
            state.loadedNoteFiles.push(relPath);
            return state.pluginData.has(relPath) ? state.pluginData.get(relPath) : null;
        },
        async saveData(relPath, data) {
            if (relPath === 'reminder.json') {
                state.reminders = JSON.parse(JSON.stringify(data));
                return;
            }
            state.pluginData.set(relPath, typeof data === 'string' ? data : JSON.stringify(data));
        },
        async removeData(relPath) {
            state.pluginData.delete(relPath);
        },
    };

    async function mockFetch(url, init = {}) {
        const body = init?.body;
        if (url === '/api/file/getFile') {
            const parsed = typeof body === 'string' ? JSON.parse(body) : {};
            const content = state.files.get(parsed.path);
            if (!content) {
                return { ok: true, status: 202, blob: async () => null, json: async () => ({ code: 404 }) };
            }
            return {
                ok: true,
                status: 200,
                blob: async () => new Blob([content], { type: 'image/png' }),
                text: async () => String(content),
                json: async () => ({ code: 0 }),
            };
        }
        if (url === '/api/file/putFile' && body && typeof body.get === 'function') {
            const targetPath = body.get('path');
            const file = body.get('file');
            const text = typeof file === 'string' ? file : await file.text();
            state.files.set(targetPath, text);
            return { ok: true, status: 200, json: async () => ({ code: 0, data: null }) };
        }
        const payload = typeof body === 'string' && body ? JSON.parse(body) : {};
        const resp = await apiMock.fetchSyncPost(url, payload);
        return {
            ok: true,
            status: 200,
            json: async () => resp,
        };
    }

    const fakeGlobal = {
        ...globalThis,
        fetch: mockFetch,
        siyuan: { client: { fetch: mockFetch } },
    };

    const moduleCache = new Map();
    const mocks = new Map([
        [path.join(root, 'src/api.ts'), apiMock],
        [path.join(root, 'src/pluginInstance.ts'), { i18n: key => key }],
        [path.join(root, 'src/utils/dateUtils.ts'), { getLogicalDateString: () => '2026-11-21', getLocalDateString: () => '2026-11-21' }],
        [path.join(root, 'src/utils/projectIcon.ts'), { sanitizeProjectIcon: v => v }],
        [path.join(root, 'src/utils/projectUtils.ts'), {}],
        [path.join(root, 'src/components/dataManager/repeatUtils.ts'), {}],
    ]);

    function load(filename) {
        const resolved = path.resolve(filename);
        if (mocks.has(resolved)) return mocks.get(resolved);
        if (moduleCache.has(resolved)) return moduleCache.get(resolved).exports;
        const mod = { exports: {} };
        moduleCache.set(resolved, mod);
        const compiled = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
            fileName: resolved,
        }).outputText;
        const localRequire = specifier => {
            if (specifier === 'siyuan') return { showMessage: () => {} };
            if (specifier.startsWith('.')) {
                const base = path.resolve(path.dirname(resolved), specifier);
                return load(base.endsWith('.ts') ? base : `${base}.ts`);
            }
            return require(specifier);
        };
        new Function('require', 'module', 'exports', 'globalThis', compiled)(localRequire, mod, mod.exports, fakeGlobal);
        return mod.exports;
    }

    return {
        state,
        apiMock,
        mockFetch,
        plugin,
        assetCleanupIgnore: load(path.join(root, 'src/utils/assetCleanupIgnore.ts')),
        taskNoteStorage: load(path.join(root, 'src/utils/taskNoteStorage.ts')),
        dataMigration: load(path.join(root, 'src/components/dataManager/dataMigration.ts')),
    };
}

test('assetCleanupIgnore: 路径提取、转义、HTML 图片转换以及冲突重试保留已有规则', async () => {
    const { state, assetCleanupIgnore } = createHarness({ conflictOnce: true });

    assert.equal(assetCleanupIgnore.normalizeGlobalAssetPath('/assets/a/b.png?t=1#hash'), 'assets/a/b.png');
    assert.equal(assetCleanupIgnore.normalizeGlobalAssetPath('assets/foo (1)+[2].png'), 'assets/foo (1)+[2].png');
    assert.equal(assetCleanupIgnore.normalizeGlobalAssetPath('https://example.com/a.png'), null);

    assert.equal(
        assetCleanupIgnore.formatAssetCleanupIgnoreLiteral('assets/shot (1)+[a].png'),
        '/assets/shot \\(1\\)\\+\\[a\\].png'
    );

    const legacyHtml = '前缀 <img src="/data/storage/petal/siyuan-plugin-task-note-management/assets/old.png" alt="旧图" /> 后缀';
    const converted = assetCleanupIgnore.convertLegacyHtmlImgToMarkdown(legacyHtml);
    assert.equal(converted, '前缀 ![旧图](/data/storage/petal/siyuan-plugin-task-note-management/assets/old.png) 后缀');
    assert.deepEqual(
        assetCleanupIgnore.extractLegacyPluginAssetPaths(converted),
        ['/data/storage/petal/siyuan-plugin-task-note-management/assets/old.png']
    );

    const md = '文本 ![图1](assets/pic-1.png "title") 和 [附件](assets/doc (1).pdf) 与 <img src="/assets/pic-2.jpg" />';
    assert.deepEqual(
        assetCleanupIgnore.extractNoteAssetPaths(md).sort(),
        ['assets/doc (1).pdf', 'assets/pic-1.png', 'assets/pic-2.jpg']
    );

    // 添加再移除（带 409 冲突重试）：应保留注释、通配符和并发写入的新规则
    await assetCleanupIgnore.addAssetCleanupIgnore(['assets/pic-1.png', 'assets/doc (1).pdf']);
    assert.ok(state.ignoreContent.includes('/assets/pic-1.png'));
    assert.ok(state.ignoreContent.includes('/assets/doc \\(1\\).pdf'));

    const removed = await assetCleanupIgnore.removeAssetCleanupIgnore(['assets/pic-1.png']);
    assert.equal(removed, true);
    assert.ok(!state.ignoreContent.includes('/assets/pic-1.png'));
    assert.ok(state.ignoreContent.includes('# user comment'));
    assert.ok(state.ignoreContent.includes('/assets/keep-*.png'));
    assert.ok(state.ignoreContent.includes('/assets/manual.png'));
    assert.ok(state.ignoreContent.includes('/assets/concurrent.png'));
    assert.ok(state.ignoreContent.includes('/assets/doc \\(1\\).pdf'));
});

test('taskNoteStorage: 拆分保存 notes/<id>.md、仅存引用与摘要、按需单条加载与共享资源引用计数', async () => {
    const { state, plugin, taskNoteStorage } = createHarness();
    taskNoteStorage.invalidateTaskNoteCache();

    // 1. 保存两个任务的备注，其中 shared.png 被两个任务共用，unique.png 仅被 task-1 引用
    const saved1 = await taskNoteStorage.saveTaskNote(
        plugin,
        'task-1',
        '第一行 **重点**\n\n![shared](assets/shared.png)\n![unique](assets/unique.png)'
    );
    const saved2 = await taskNoteStorage.saveTaskNote(
        plugin,
        'task-2',
        '任务二备注 ![shared](assets/shared.png)'
    );

    const task1 = { id: 'task-1', title: '任务一' };
    const task2 = { id: 'task-2', title: '任务二' };
    taskNoteStorage.applyTaskNoteMetadata(task1, saved1);
    taskNoteStorage.applyTaskNoteMetadata(task2, saved2);
    state.reminders = { 'task-1': task1, 'task-2': task2 };

    // reminder.json 只保留 notes: true、摘要和 noteAssets，不保留正文 note
    assert.equal(task1.notes, true);
    assert.equal(task1.note, undefined);
    assert.equal(task1.noteSummary, '第一行 重点 [shared] [unique]');
    assert.deepEqual(task1.noteAssets.sort(), ['assets/shared.png', 'assets/unique.png']);
    assert.equal(state.pluginData.get('notes/task-1.md'), '第一行 **重点**\n\n![shared](assets/shared.png)\n![unique](assets/unique.png)');
    assert.ok(state.ignoreContent.includes('/assets/shared.png'));
    assert.ok(state.ignoreContent.includes('/assets/unique.png'));

    // 清空内存缓存后，只加载 task-1，验证只读取了 notes/task-1.md，没有读取 notes/task-2.md
    taskNoteStorage.invalidateTaskNoteCache();
    state.loadedNoteFiles.length = 0;
    const loaded1 = await taskNoteStorage.loadTaskNote(plugin, task1);
    assert.ok(loaded1.includes('assets/unique.png'));
    assert.deepEqual(state.loadedNoteFiles, ['notes/task-1.md']);

    // 2. 删除 task-1：应删除 notes/task-1.md，从 assets-cleanup-ignore 移除 unique.png，保留仍被 task-2 引用的 shared.png
    const beforeIndex = taskNoteStorage.buildTaskNoteIndex(state.reminders);
    const remainingReminders = { 'task-2': task2 };
    const diff = taskNoteStorage.diffTaskNoteIndex(beforeIndex, remainingReminders);
    assert.deepEqual(diff.removedTasks.map(t => t.id), ['task-1']);
    assert.deepEqual(Array.from(diff.keepNoteIds), ['task-2']);

    await taskNoteStorage.cleanupDeletedTaskNotes(plugin, diff.removedTasks, remainingReminders, {
        keepNoteIds: diff.keepNoteIds,
    });
    assert.equal(state.pluginData.has('notes/task-1.md'), false);
    assert.equal(state.pluginData.has('notes/task-2.md'), true);
    assert.ok(!state.ignoreContent.includes('/assets/unique.png'));
    assert.ok(state.ignoreContent.includes('/assets/shared.png'));

    // 3. 删除 task-2 后，shared.png 不再被任何任务引用，应从 assets-cleanup-ignore 移除
    const afterIndex = taskNoteStorage.buildTaskNoteIndex(remainingReminders);
    const diff2 = taskNoteStorage.diffTaskNoteIndex(afterIndex, {});
    await taskNoteStorage.cleanupDeletedTaskNotes(plugin, diff2.removedTasks, {}, {
        keepNoteIds: diff2.keepNoteIds,
    });
    assert.equal(state.pluginData.has('notes/task-2.md'), false);
    assert.ok(!state.ignoreContent.includes('/assets/shared.png'));
});

test('taskNoteStorage: 重复任务实例支持继承模板备注、独立覆盖及显式清空 (notes: false)', () => {
    const { taskNoteStorage } = createHarness();
    const series = {
        id: 'series-1',
        notes: true,
        noteSummary: '模板备注',
        noteAssets: ['assets/tpl.png'],
    };

    // 未覆盖实例：继承模板 notes/noteSummary，noteId 指向模板 ID
    const inherited = taskNoteStorage.resolveExpandedInstanceNoteFields(series, undefined, '2026-11-21');
    assert.equal(inherited.notes, true);
    assert.equal(inherited.noteId, 'series-1');
    assert.equal(inherited.noteSummary, '模板备注');

    // 实例有独立备注：指向 series-1_2026-11-22
    const overridden = taskNoteStorage.resolveExpandedInstanceNoteFields(
        series,
        { notes: true, noteSummary: '单日覆盖', noteAssets: ['assets/day.png'] },
        '2026-11-22'
    );
    assert.equal(overridden.notes, true);
    assert.equal(overridden.noteId, 'series-1_2026-11-22');
    assert.equal(overridden.noteSummary, '单日覆盖');

    // 实例显式清空备注（notes: false）：不继承模板备注
    const cleared = taskNoteStorage.resolveExpandedInstanceNoteFields(
        series,
        { notes: false },
        '2026-11-23'
    );
    assert.equal(cleared.notes, false);
    assert.equal(cleared.noteSummary, undefined);
    assert.equal(taskNoteStorage.hasTaskNote(cleared), false);
});

test('migrateTaskNotesAndAssets: 迁移旧版内联备注与插件私有图片到 notes/<id>.md 和全局 /data/assets/ 并加入 ignore', async () => {
    const { state, plugin, dataMigration } = createHarness();

    const legacyImgPath = '/data/storage/petal/siyuan-plugin-task-note-management/assets/legacy-1.png';
    const legacyInstanceImgPath = '/data/storage/petal/siyuan-plugin-task-note-management/assets/legacy-2.png';
    state.files.set(legacyImgPath, 'PNG_DATA_1');
    state.files.set(legacyInstanceImgPath, 'PNG_DATA_2');

    state.reminders = {
        't-legacy': {
            id: 't-legacy',
            title: '旧任务',
            note: `旧正文\n<img src="${legacyImgPath}" alt="截图" />`,
            repeat: {
                enabled: true,
                type: 'daily',
                instances: {
                    '2026-11-20': {
                        note: `实例正文 ![图2](${legacyInstanceImgPath})`,
                    },
                },
            },
        },
        't-empty': {
            id: 't-empty',
            title: '无备注任务',
            note: '   ',
        },
    };

    await dataMigration.migrateTaskNotesAndAssets(plugin, state.settings);
    assert.equal(state.settings.datatransfer.taskNotesSplitTransfer, true);

    // 验证主任务迁移结果
    const tLegacy = state.reminders['t-legacy'];
    assert.equal(tLegacy.notes, true);
    assert.equal(tLegacy.note, undefined);
    assert.equal(tLegacy.noteSummary, '旧正文 [截图]');
    assert.equal(tLegacy.noteAssets.length, 1);
    assert.ok(tLegacy.noteAssets[0].startsWith('assets/'));

    const migratedMd = state.pluginData.get('notes/t-legacy.md');
    assert.ok(migratedMd.includes(`![截图](${tLegacy.noteAssets[0]})`));
    assert.ok(!migratedMd.includes('/data/storage/petal/'));
    assert.equal(state.files.get(`/data/${tLegacy.noteAssets[0]}`), 'PNG_DATA_1');
    assert.ok(state.ignoreContent.includes(`/${tLegacy.noteAssets[0]}`));

    // 验证重复实例备注迁移结果
    const inst = tLegacy.repeat.instances['2026-11-20'];
    assert.equal(inst.notes, true);
    assert.equal(inst.note, undefined);
    assert.equal(inst.noteAssets.length, 1);
    assert.ok(inst.noteAssets[0].startsWith('assets/'));
    const migratedInstMd = state.pluginData.get('notes/t-legacy_2026-11-20.md');
    assert.ok(migratedInstMd.includes(`![图2](${inst.noteAssets[0]})`));
    assert.ok(state.ignoreContent.includes(`/${inst.noteAssets[0]}`));

    // 旧空白备注被清理
    assert.equal(state.reminders['t-empty'].note, undefined);
    assert.equal(state.reminders['t-empty'].notes, undefined);

    // 旧插件私有目录中已迁移的图片已被清理
    assert.ok(state.removedFiles.includes(legacyImgPath));
    assert.ok(state.removedFiles.includes(legacyInstanceImgPath));

    // 幂等性：再次执行迁移不再重复写入或调用 API
    const fetchCountAfterFirst = state.fetchLog.length;
    await dataMigration.migrateTaskNotesAndAssets(plugin, state.settings);
    assert.equal(state.fetchLog.length, fetchCountAfterFirst);
});

test('TaskActionUndo: 删除带拆分备注和图片的任务后，撤回可完整恢复 notes/<id>.md 并重新加入 assets-cleanup-ignore', async () => {
    const { state, apiMock, mockFetch, plugin, taskNoteStorage } = createHarness();
    const prevSiyuan = globalThis.siyuan;
    globalThis.siyuan = { client: { fetch: mockFetch } };
    try {
        taskNoteStorage.invalidateTaskNoteCache();

        // 预先保存一条带图片的拆分备注
        const saved = await taskNoteStorage.saveTaskNote(plugin, 'undo-task', '重要笔记 ![图](assets/undo-pic.png)');
        const task = { id: 'undo-task', title: '可撤回任务' };
        taskNoteStorage.applyTaskNoteMetadata(task, saved);
        state.reminders = { 'undo-task': task };
        assert.ok(state.ignoreContent.includes('/assets/undo-pic.png'));

        // 构造模拟 plugin.saveReminderData（带 index 对比自动清理，与 src/index.ts 一致）
        let noteIndex = taskNoteStorage.buildTaskNoteIndex(state.reminders);
        const undoPlugin = {
            ...plugin,
            async saveReminderData(data) {
                const nextData = JSON.parse(JSON.stringify(data));
                const diff = taskNoteStorage.diffTaskNoteIndex(noteIndex, nextData);
                state.reminders = nextData;
                noteIndex = taskNoteStorage.buildTaskNoteIndex(nextData);
                if (diff.removedTasks.length > 0) {
                    await taskNoteStorage.cleanupDeletedTaskNotes(undoPlugin, diff.removedTasks, nextData, {
                        keepNoteIds: diff.keepNoteIds,
                    });
                }
            },
            updateBadges() {},
            updateMobileNotification: async () => {},
            cancelMobileNotification: async () => {},
        };

        const dependencies = {
            ...apiMock,
            document: {
                body: { append() {} },
                createElement: () => ({
                    setAttribute() {},
                    append() {},
                    addEventListener() {},
                    remove() {},
                    matches: () => false,
                    contains: () => false,
                }),
                activeElement: null,
            },
            window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
            CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
            i18n: k => k,
            showMessage() {},
            updateBindBlockAtrrs: async () => {},
            getAllReminders: async () => JSON.parse(JSON.stringify(state.reminders)),
            saveReminders: async (_p, d) => undoPlugin.saveReminderData(d),
        };

        const { TaskActionUndo } = loadTaskActionUndo(dependencies);
        const undo = new TaskActionUndo(undoPlugin, state.reminders);

        // 删除任务
        await undo.save({});
        assert.equal(state.reminders['undo-task'], undefined);
        assert.equal(state.pluginData.has('notes/undo-task.md'), false);
        assert.ok(!state.ignoreContent.includes('/assets/undo-pic.png'));

        // 撤回删除：恢复任务元数据、notes/undo-task.md 以及 assets-cleanup-ignore
        assert.equal(await undo.undo(), true);
        assert.equal(state.reminders['undo-task'].notes, true);
        assert.equal(state.pluginData.get('notes/undo-task.md'), '重要笔记 ![图](assets/undo-pic.png)');
        assert.ok(state.ignoreContent.includes('/assets/undo-pic.png'));
    } finally {
        globalThis.siyuan = prevSiyuan;
    }
});
