// Run with: pnpm exec node --test scripts/test-project-panel-display.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const zh = require('../i18n/zh_CN.json');
const filename = path.join(__dirname, '../src/components/panel/ProjectPanel.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const classNode = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ProjectPanel');
const names = new Set([
    'initUI', 'renderProjects', 'renderProjectsAsChecklist', 'buildProjectFolderTree', 'createFolderGroupElement',
    'createProjectListElement', 'appendProjectStatistics', 'fillProjectTopLevelCounts', 'showMoreMenu',
    'restorePanelSettings', 'savePanelSettings', 'normalizeSortCriteria', 'getActiveSortCriteria', 'syncLegacySortStateFromCriteria',
    'createStartedElement', 'createCountdownElement', 'formatProjectTime', 'calculateDaysDifference', 'parseTitle',
    'getDocumentTreeIndent', 'applyDocumentTreeGuides', 'applyDocumentTreeRowIndent', 'loadProjects',
    'applyCategoryFilter', 'applySearchFilter',
]);
const members = classNode.members.filter(node => ts.isPropertyDeclaration(node) || ts.isConstructorDeclaration(node)
    || names.has(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
const normalize = source.statements.find(node => node.name?.getText(source) === 'normalizeProjectPanelSortCriteria').getText(source).replace(/^export /, '');
const code = ts.transpileModule(`const PROJECT_PANEL_SORT_METHODS = new Set(['priority', 'title']);
    ${normalize}\nclass Panel { ${members} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

class Element {
    constructor(tag = 'div') {
        this.tag = tag; this.children = []; this.dataset = {}; this.handlers = {}; this.attributes = {}; this.className = '';
        this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
        this.scrollTop = 0;
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: name => { this.className += ` ${name}`; },
            remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); },
        };
    }
    get firstChild() { return this.children[0]; }
    appendChild(child) {
        if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
        this.children.push(child); child.parent = this; return child;
    }
    set innerHTML(value) { this.html = value; this.children = []; this.text = ''; }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent || '').join(''); }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasChildNodes() { return this.children.length > 0; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    querySelectorAll(selector) {
        const className = selector.match(/^\.([\w-]+)/)?.[1];
        const attribute = selector.match(/\[data-([\w-]+)="([^"]*)"\]/);
        const key = attribute?.[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const matches = child => (className ? child.classList.contains(className) : child.tag === selector)
            && (!attribute || child.dataset[key] === attribute[2]);
        return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const i18n = (key, params = {}) => (zh[key] || key).replace(/\$\{([^}]+)\}/g, (_, name) => params[name] ?? `\${${name}}`);
const flush = () => new Promise(resolve => setImmediate(resolve));
const project = (extra = {}) => ({ id: 'p', title: '项目', status: 'active', color: '#aaa', startDate: '2026-11-10', ...extra });

function fixture(saved = {}, projects = []) {
    const persisted = { unrelated: 'preserved', ...saved };
    const folders = [{ id: 'work', name: '工作' }, { id: 'research', name: '科研', parentId: 'work' }];
    const metrics = { counts: 0, pomodoro: 0, focus: 0, reads: 0, done: 3, menus: [] };
    const statuses = { getStatuses: () => [{ id: 'active', name: '正在进行', icon: '⏳' }], getStatusById: id => ({ id, name: id }), initialize: async () => {} };
    const manager = { loadProjects: async () => {}, getProjectKanbanStatuses: async () => [
        { id: 'doing', name: '进行中', icon: '⏳' }, { id: 'completed', name: '已完成', icon: '✅' },
    ] };
    const dependencies = {
        document: { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }) },
        Menu: class { constructor() { this.items = []; metrics.menus.push(this); } addItem(item) { this.items.push(item); } addSeparator() {} open() {} },
        ProjectManager: { getInstance: () => manager }, ProjectFolderManager: { getInstance: () => ({ getFolders: () => folders }) },
        StatusManager: { getInstance: () => statuses }, CategoryManager: { getInstance: () => ({ getCategoryById: () => null }) },
        ProjectKanbanView: { countTopLevelTasksByStatus: () => { metrics.counts++; return { counts: { doing: 1, completed: metrics.done }, completed: metrics.done }; } },
        getAllReminders: async () => { metrics.reads++; return {}; },
        setTaskMetadataText: (element, text) => { element.textContent = text; },
        getLogicalDateString: () => '2026-11-12', getLocaleTag: () => 'zh-CN', compareDateStrings: (a, b) => a.localeCompare(b), i18n,
    };
    const Panel = new Function(...Object.keys(dependencies), `${code}; return Panel;`)(...Object.values(dependencies));
    for (const method of ['initializeAsync', 'renderStatusFilter', 'updateCategoryFilterButtonText', 'updateSortButtonTitle', 'bindFolderDragEvents', 'addTaskDropTarget', 'sortProjects']) {
        Panel.prototype[method] = () => {};
    }
    Panel.prototype.isDragDisabledBySortMode = () => true;
    Panel.prototype.countProjectTotalPomodoro = async () => { metrics.pomodoro++; return 5; };
    Panel.prototype.countProjectTotalFocusTime = async () => { metrics.focus++; return 90; };
    const plugin = {
        loadSettings: async () => ({ ...persisted }), saveSettings: async value => Object.assign(persisted, value),
        loadProjectData: async () => Object.fromEntries(projects.map(item => [item.id, item])),
    };
    const panel = new Panel(new Element(), plugin);
    panel.initUI();
    panel.reminderDataCache = {};
    return { panel, persisted, metrics };
}

test('忽略旧视图选项，统一文件夹树并保留嵌套层级和项目状态标签', async () => {
    const { panel } = fixture({ projectPanelViewMode: 'card' });
    await panel.restorePanelSettings();
    panel.renderProjects([project({ folderId: 'research' })]);
    await flush();
    assert.equal(panel.container.querySelector('.project-view-mode-select'), null);
    assert.ok(panel.projectsContainer.classList.contains('project-document-tree'));
    assert.deepEqual(panel.projectsContainer.querySelectorAll('.project-folder-group').map(item => item.dataset.folderId), ['work', 'research']);
    assert.ok(panel.projectsContainer.querySelector('.project-status-tag'));
    assert.ok(panel.projectsContainer.querySelector('.project-counts-dynamic'));
});

test('四项显示开关的所有组合独立生效，全部关闭不产生空统计容器或计算', async () => {
    for (let mask = 0; mask < 16; mask++) {
        const { panel, metrics } = fixture();
        const keys = ['showDates', 'showTaskCounts', 'showPomodoro', 'showProgress'];
        keys.forEach((key, index) => { panel[key] = !!(mask & (1 << index)); });
        const element = panel.createProjectListElement(project());
        await flush();
        ['.project-list-meta-date', '.project-counts-dynamic', '.project-count--pomodoro', '.project-progress-wrapper']
            .forEach((selector, index) => assert.equal(!!element.querySelector(selector), panel[keys[index]], `${mask}: ${selector}`));
        assert.equal(metrics.counts > 0, panel.showTaskCounts || panel.showProgress);
        assert.equal(metrics.pomodoro > 0, panel.showPomodoro);
        assert.equal(metrics.focus > 0, panel.showPomodoro);
        if (!(mask & 14)) assert.equal(element.querySelector('.project-item__counts'), null);
    }
});

test('日期包含已开始天数或截止倒计时，关闭日期仍保留优先级和状态', () => {
    const { panel } = fixture();
    assert.ok(panel.createProjectListElement(project()).textContent.includes('已开始2天'));
    assert.ok(panel.createProjectListElement(project({ endDate: '2026-11-15' })).textContent.includes('还剩3天'));
    assert.ok(panel.createProjectListElement(project({ startDate: '', endDate: '2026-11-15' })).textContent.includes('2026年11月15日'));
    panel.showDates = false;
    const element = panel.createProjectListElement(project({ priority: 'high' }));
    assert.ok(element.querySelector('.project-priority-label'));
    assert.ok(element.querySelector('.project-status-tag'));
});

test('更多菜单四项开关立即刷新并持久化，恢复时保留明确关闭的值', async () => {
    const { panel, persisted, metrics } = fixture();
    panel.renderProjects([project()]);
    panel.showMoreMenu({ target: { closest: () => null }, clientX: 0, clientY: 0 });
    const submenu = metrics.menus[0].items.find(item => item.label === zh.displaySettings).submenu;
    assert.equal(submenu.length, 4);
    const selectors = ['.project-list-meta-date', '.project-counts-dynamic', '.project-count--pomodoro', '.project-progress-wrapper'];
    for (let index = 0; index < submenu.length; index++) {
        assert.equal(submenu[index].icon, 'iconSelect');
        await submenu[index].click();
        assert.equal(panel.projectsContainer.querySelector(selectors[index]), null);
    }
    assert.equal(persisted.unrelated, 'preserved');
    const restored = fixture(persisted).panel;
    await restored.restorePanelSettings();
    for (const key of ['showDates', 'showTaskCounts', 'showPomodoro', 'showProgress']) assert.equal(restored[key], false);
});

test('隐藏任务数量后，任务更新仍刷新番茄统计和独立进度条', async () => {
    const { panel, metrics } = fixture();
    panel.showTaskCounts = false;
    panel.renderProjects([project()]);
    await flush();
    assert.equal(panel.projectsContainer.querySelector('.project-progress-text').textContent, '75%');
    metrics.done = 1;
    await panel.reminderUpdatedHandler({ detail: { projectId: 'p' } });
    assert.equal(panel.projectsContainer.querySelector('.project-progress-text').textContent, '50%');
    assert.ok(panel.projectsContainer.querySelector('.project-count--pomodoro').textContent.includes('1h 30m'));
    assert.equal(metrics.pomodoro, 2);
});

test('关闭全部统计时加载项目不读取任务数据，默认仍展示所有信息', async () => {
    const { panel, metrics } = fixture({}, [project()]);
    assert.ok(panel.showDates && panel.showTaskCounts && panel.showPomodoro && panel.showProgress);
    panel.showTaskCounts = panel.showPomodoro = panel.showProgress = false;
    await panel.loadProjects();
    assert.equal(metrics.reads, 0);
    assert.equal(metrics.counts, 0);
    assert.equal(metrics.pomodoro, 0);
});

test('番茄与专注时间选项开启时，即使累计时长为零也显示 0m', async () => {
    const { panel } = fixture();
    panel.countProjectTotalFocusTime = async () => 0;
    panel.renderProjects([project()]);
    await flush();
    assert.ok(panel.projectsContainer.querySelector('.project-count--pomodoro').textContent.includes('⏱ 0m'));
});
