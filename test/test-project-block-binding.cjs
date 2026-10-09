const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const clone = value => JSON.parse(JSON.stringify(value));

function fixture(t) {
    const root = path.resolve(__dirname, '..');
    const modules = new Map();
    function load(filename) {
        // 项目管理器不使用这些前端 API；保留真实管理器、存储和内核块 API 流程。
        if (filename === path.join(root, 'src/api.ts')) return {};
        if (filename === path.join(root, 'src/pluginInstance.ts')) return { i18n: key => key };
        if (modules.has(filename)) return modules.get(filename).exports;
        const module = { exports: {} };
        modules.set(filename, module);
        const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText;
        const localRequire = name => {
            if (!name.startsWith('.')) return require(name);
            const target = path.resolve(path.dirname(filename), name);
            return load(path.extname(target) ? target : target + '.ts');
        };
        new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
        return module.exports;
    }

    let projects = { _initializedDefaultInbox: true };
    const attrs = {};
    const writes = [];
    const original = global.siyuan;
    global.siyuan = { client: { async fetch(url, options) {
        const body = JSON.parse(options.body);
        let data;
        if (url === '/api/attr/getBlockAttrs') {
            data = attrs[body.id] || {};
        } else {
            assert.equal(url, '/api/attr/setBlockAttrs');
            attrs[body.id] = { ...attrs[body.id], ...body.attrs };
            writes.push(body);
            data = null;
        }
        return { ok: true, json: async () => ({ code: 0, data }) };
    } } };
    t.after(() => { global.siyuan = original; });

    const plugin = {
        loadProjectData: async () => clone(projects),
        saveProjectData: async data => { projects = clone(data); },
        loadProjectStatus: async () => [{ id: 'active', name: '测试状态', isArchived: false }]
    };
    const { ProjectManager } = load(path.join(root, 'src/components/dataManager/projectManager.ts'));
    const { createProjectTool } = load(path.join(root, 'src/kernel/tools/projectTools.ts'));
    const manager = ProjectManager.getInstance(plugin);
    const tool = createProjectTool(
        { countByProject: async () => ({ total: 0 }) }, manager, {},
        { listProjectGroups: async () => [], folderExists: async () => true }
    );
    return { tool, manager, attrs, writes, saved: () => clone(projects) };
}

test('MCP 创建项目自动保存块绑定并追加项目属性，查询可读取绑定', async t => {
    assert.equal(typeof window, 'undefined');
    const f = fixture(t);
    assert.equal(f.tool.config.inputSchema.properties.blockId.type, 'string');
    f.attrs['20261009120000-abcdefg'] = { 'custom-task-projectId': 'other', 'custom-note': '保留' };
    const created = await f.tool.handler({
        action: 'create_project', name: '测试项目', blockId: ' 20261009120000-abcdefg '
    });
    assert.equal(created.success, true);
    const project = created.data;
    assert.equal(project.blockId, '20261009120000-abcdefg');
    assert.equal(f.saved()[project.id].blockId, project.blockId);
    assert.equal(f.saved()[project.id].title, '测试项目');
    assert.equal(f.attrs[project.blockId]['custom-task-projectId'], `other,${project.id}`);
    assert.equal(f.attrs[project.blockId]['custom-note'], '保留');
    const found = await f.tool.handler({ action: 'search_project', keyword: '测试项目' });
    assert.equal(found.data[0].blockId, project.blockId);
    const detail = await f.tool.handler({ action: 'get_project', projectId: project.id });
    assert.equal(detail.data.blockId, project.blockId);
});

test('修改名称保留绑定，同块绑定不重复，换绑和解绑保留其他项目属性', async t => {
    const f = fixture(t);
    const created = await f.tool.handler({ action: 'create_project', name: '测试项目', blockId: 'old-block' });
    const id = created.data.id;
    f.attrs['old-block']['custom-task-projectId'] = `first,${id},last`;
    const renamed = await f.tool.handler({ action: 'update_project', projectId: id, name: '新名称' });
    assert.equal(renamed.data.blockId, 'old-block');
    await f.tool.handler({ action: 'update_project', projectId: id, blockId: 'old-block' });
    assert.equal(f.writes.length, 1);
    f.attrs['new-block'] = { 'custom-task-projectId': 'another', 'custom-note': '保留' };
    const rebound = await f.tool.handler({ action: 'update_project', projectId: id, blockId: 'new-block' });
    assert.equal(rebound.success, true);
    assert.equal(f.saved()[id].blockId, 'new-block');
    assert.equal(f.attrs['old-block']['custom-task-projectId'], 'first,last');
    assert.equal(f.attrs['new-block']['custom-task-projectId'], `another,${id}`);
    const unbound = await f.tool.handler({ action: 'update_project', projectId: id, blockId: '' });
    assert.equal(unbound.success, true);
    assert.equal(f.saved()[id].blockId, '');
    assert.equal(f.attrs['new-block']['custom-task-projectId'], 'another');
    assert.equal(f.attrs['new-block']['custom-note'], '保留');
});

test('已有未绑定项目可以通过 MCP 补绑，未提供块 ID 时正常创建', async t => {
    const f = fixture(t);
    const created = await f.tool.handler({ action: 'create_project', name: '未绑定项目' });
    assert.equal(created.success, true);
    assert.equal(created.data.blockId, undefined);
    assert.equal(f.writes.length, 0);
    const bound = await f.tool.handler({ action: 'update_project', projectId: created.data.id, blockId: 'block' });
    assert.equal(bound.success, true);
    assert.equal(f.saved()[created.data.id].blockId, 'block');
    assert.equal(f.attrs.block['custom-task-projectId'], created.data.id);
});

test('错误的块 ID 参数类型返回错误且不修改项目和块属性', async t => {
    const f = fixture(t);
    const created = await f.tool.handler({ action: 'create_project', name: '测试项目', blockId: 123 });
    assert.equal(created.success, false);
    assert.match(created.error, /blockId.*字符串/);
    assert.equal(Object.keys(f.saved()).filter(id => !id.startsWith('_')).length, 0);
    const valid = await f.tool.handler({ action: 'create_project', name: '测试项目', blockId: 'block' });
    const before = f.saved();
    const updated = await f.tool.handler({ action: 'update_project', projectId: valid.data.id, blockId: 123 });
    assert.equal(updated.success, false);
    assert.deepEqual(f.saved(), before);
    assert.equal(f.writes.length, 1);
});
