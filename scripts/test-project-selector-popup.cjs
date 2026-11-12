// Run with: pnpm exec node --test scripts/test-project-selector-popup.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/dialog/ProjectSelectorPopup.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

// Minimal DOM for tree structure and event checks; native select behavior still needs host validation.
class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.handlers = {};
        this.className = '';
        this.style = { setProperty() {}, removeProperty() {} };
        this.classList = {
            add: name => { this.className += ` ${name}`; },
            contains: name => this.className.split(/\s+/).includes(name),
        };
    }
    set innerHTML(value) { this.html = value; this.children = []; }
    appendChild(child) { this.children.push(child); return child; }
    add(option) { this.appendChild(option); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    contains(target) { return this === target || this.children.some(child => child.contains?.(target)); }
    querySelectorAll(selector) {
        const name = selector.match(/^\.([\w-]+)/)?.[1];
        const matches = child => name && child.classList?.contains(name)
            && (!selector.includes('[data-value]') || child.dataset.value !== undefined);
        return this.children.flatMap(child => [
            ...(matches(child) ? [child] : []), ...(child.querySelectorAll?.(selector) || []),
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const statuses = [
    { id: 'active', name: '正在进行' }, { id: 'someday', name: '未来也许' },
    { id: 'archived', name: '已归档', isArchived: true }, { id: 'custom', name: '自定义状态' },
];
const projects = [
    { id: 'roi', name: 'ROI 成像', status: 'active', folderId: 'research' },
    { id: 'future', name: '未来成像', status: 'someday', folderId: 'future-folder' },
    { id: 'archived', name: '归档', status: 'archived', folderId: 'archived-folder' },
    { id: 'subscription', name: '订阅', status: 'active', isSubscription: true, folderId: 'subscription-folder' },
    { id: 'root', name: '根项目', status: 'custom' },
];
const folders = [
    { id: 'work', name: '工作' }, { id: 'research', name: '科研', parentId: 'work' },
    { id: 'empty-child', name: '空子文件夹', parentId: 'work' }, { id: 'empty', name: '空文件夹' },
    { id: 'future-folder', name: '未来' }, { id: 'archived-folder', name: '归档' },
    { id: 'subscription-folder', name: '订阅' },
];

async function fixture(options = {}) {
    const manager = {
        initialize: async () => {}, getProjects: () => projects,
        getStatusManager: () => ({ getStatuses: () => statuses }),
        getProjectById: id => projects.find(project => project.id === id),
    };
    const folderManager = { initialize: async () => {}, getFolders: () => folders };
    const exports = {};
    const requireMock = name => name.includes('projectFolderManager')
        ? { ProjectFolderManager: { getInstance: () => folderManager } }
        : name.includes('projectManager') ? { ProjectManager: { getInstance: () => manager } }
            : { i18n: key => key };
    new Function('require', 'exports', 'document', 'Option', code)(
        requireMock, exports, { createElement: tag => new Element(tag) },
        function Option(text, value) { this.text = text; this.value = value; },
    );
    const popup = new exports.ProjectSelectorPopup({
        plugin: { settings: { defaultProjectSelectorViewMode: 'status' } },
        container: new Element('div'), excludeSubscription: true, ...options,
    });
    await popup.initialize();
    return popup;
}
const folderIds = popup => popup.listContainer.querySelectorAll('.project-folder-group').map(item => item.dataset.folderId);
const projectIds = popup => popup.getVisibleProjectIds();

test('默认全部项目使用文件夹树，隐藏各层空文件夹并保留有项目的祖先', async () => {
    const popup = await fixture();
    assert.equal(popup.statusSelect.value, 'all');
    assert.deepEqual(popup.statusSelect.children.map(option => option.value), ['all', 'active', 'someday', 'custom']);
    assert.equal(popup.container.querySelector('.project-selector-tabs'), null);
    assert.deepEqual(folderIds(popup), ['work', 'research', 'future-folder']);
    assert.deepEqual(projectIds(popup), ['', 'roi', 'future', 'root']);
});

test('切换状态和搜索组合筛选项目，更新计数且不改变已选项目', async () => {
    const popup = await fixture({ selectedId: 'future' });
    popup.statusSelect.value = 'active';
    popup.statusSelect.handlers.change();
    assert.deepEqual(folderIds(popup), ['work', 'research']);
    assert.deepEqual(projectIds(popup), ['', 'roi']);
    const counts = popup.listContainer.querySelectorAll('.project-folder-count');
    assert.deepEqual(counts.map(item => item.textContent), ['(1)', '(1)']);
    assert.equal(popup.selectedId, 'future');
    popup.showQuery('ROI 成像');
    assert.deepEqual(projectIds(popup), ['roi']);
    popup.showQuery('未来');
    assert.deepEqual(folderIds(popup), []);
    assert.deepEqual(projectIds(popup), []);
    popup.statusSelect.value = 'all';
    popup.statusSelect.handlers.change();
    assert.deepEqual(projectIds(popup), ['future']);
});

test('保留调用方的项目白名单和归档限制', async () => {
    const popup = await fixture({ allowedProjectIds: ['archived', 'roi'], includeNoProject: false });
    assert.deepEqual(projectIds(popup), ['roi']);
    const withArchived = await fixture({ excludeArchived: false });
    withArchived.statusSelect.value = 'archived';
    withArchived.statusSelect.handlers.change();
    assert.deepEqual(projectIds(withArchived), ['', 'archived']);
    assert.deepEqual(folderIds(withArchived), ['archived-folder']);
});

test('多选全选与取消全选只影响筛选结果，保留隐藏项目的选择', async () => {
    const popup = await fixture({ isMultiSelect: true, selectedIds: new Set(['future']) });
    popup.statusSelect.value = 'active';
    popup.statusSelect.handlers.change();
    const event = { stopPropagation() {} };
    popup.container.querySelector('.select-all-btn').handlers.click(event);
    assert.deepEqual([...popup.selectedIds].sort(), ['future', 'none', 'roi']);
    popup.container.querySelector('.deselect-all-btn').handlers.click(event);
    assert.deepEqual([...popup.selectedIds], ['future']);
    popup.selectedIds = new Set(['all']);
    popup.container.querySelector('.deselect-all-btn').handlers.click(event);
    assert.deepEqual([...popup.selectedIds].sort(), ['future', 'root']);
});

test('状态下拉框保留原生鼠标行为，搜索与状态之间切换焦点不关闭弹层', async () => {
    const searchInput = new Element('input');
    const popup = await fixture({ searchInput });
    let hides = 0;
    popup.hide = () => { hides++; };
    popup.searchInput.handlers.blur({ relatedTarget: popup.statusSelect });
    popup.statusSelect.handlers.blur({ relatedTarget: searchInput });
    assert.equal(hides, 0);
    let prevented = false;
    popup.container.handlers.mousedown({ button: 0, target: popup.statusSelect, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    popup.statusSelect.handlers.blur({ relatedTarget: null });
    assert.equal(hides, 1);
});
