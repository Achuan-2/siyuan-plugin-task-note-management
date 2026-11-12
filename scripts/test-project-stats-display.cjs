// Run with: pnpm exec node --test scripts/test-project-stats-display.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const zh = require('../i18n/zh_CN.json');

function load(relative, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(name => {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
    }, exports);
    return exports;
}
const i18n = (key, params = {}) => (zh[key] || key).replace(/\$\{([^}]+)\}/g, (_, name) => params[name] ?? `\${${name}}`);
const metadata = load('src/components/render/taskMetadataIcons.ts', {
    './tomatoIcon': load('src/components/render/tomatoIcon.ts'),
});
const startInfo = load('src/components/render/projectStartInfo.ts', {
    '../../pluginInstance': { i18n },
    '../../utils/dateUtils': { getLocaleTag: () => 'zh-CN', getLogicalDateString: () => '2026-11-12' },
    './taskMetadataIcons': metadata,
});

test('开始日期使用逻辑日期，区分已开始、今天开始和未来开始，无日期不显示', () => {
    assert.equal(startInfo.getProjectStartInfo('2026-11-10').relativeText, '已开始2天');
    assert.equal(startInfo.getProjectStartInfo('2026-11-12').relativeText, '今天开始');
    assert.equal(startInfo.getProjectStartInfo('2026-11-15').relativeText, '3天后开始');
    assert.equal(startInfo.getProjectStartInfo(undefined), null);
    assert.equal(startInfo.renderProjectStartInfo('invalid'), '');
    const html = startInfo.renderProjectStartInfo('2026-11-10');
    assert.match(html, /已开始2天/);
    assert.match(html, /2026年11月10日/);
    assert.match(html, /task-metadata-icon/);
});

test('开始天数按日历日计算，跨夏令时、跨年和闰日不多算一天', () => {
    const previousTimezone = process.env.TZ;
    try {
        process.env.TZ = 'America/New_York';
        assert.equal(startInfo.getProjectStartInfo('2026-10-31', '2026-11-02').relativeText, '已开始2天');
        assert.equal(startInfo.getProjectStartInfo('2026-03-07', '2026-03-09').relativeText, '已开始2天');
        assert.equal(startInfo.getProjectStartInfo('2024-02-28', '2024-03-01').relativeText, '已开始2天');
        assert.equal(startInfo.getProjectStartInfo('2025-12-31', '2026-01-01').relativeText, '已开始1天');
    } finally {
        if (previousTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    }
});

async function renderDialog({ statuses, startDate = '2026-11-10', groups = [] }) {
    const body = { style: {}, innerHTML: '' };
    const project = { id: 'project', title: '统计项目', startDate, endDate: '2026-12-31' };
    const manager = {
        getProjectKanbanStatuses: async () => statuses,
        getProjectCustomGroups: async () => groups,
    };
    const dialog = load('src/components/dialog/ProjectStatsDialog.ts', {
        '../render/taskMetadataIcons': metadata,
        '../render/projectStartInfo': startInfo,
        '../../pluginInstance': { i18n },
        siyuan: { Dialog: class { constructor() {
            this.element = { querySelector: () => body, querySelectorAll: () => [] };
        } } },
        '../panel/ProjectKanbanView': { ProjectKanbanView: { countTopLevelTasksByStatus: () => ({
            counts: Object.fromEntries(statuses.map(status => [status.id, 1])), completed: 1,
        }) } },
        '../../utils/icsSubscription': { getAllReminders: async () => ({}) },
        '../dataManager/projectManager': { ProjectManager: { getInstance: () => manager } },
        '../dataManager/pomodoroRecord': { PomodoroRecordManager: { getInstance: () => ({ records: {} }) } },
    });
    await dialog.showStatsDialogForProjects({}, '🎯', '统计项目', '统计', [project], 'project', {});
    return body.innerHTML;
}

test('右键统计及自定义分组统计采用看板的状态 Emoji、名称和顺序，不替换成 SVG', async () => {
    const html = await renderDialog({
        groups: [{ id: 'group', name: '分组' }],
        statuses: [
            { id: 'long_term', name: '长期', icon: '🤔' },
            { id: 'doing', name: '自定义进行', icon: '🚀' },
            { id: 'short_term', name: '短期', icon: '📋' },
            { id: 'completed', name: '已完成', icon: '✅' },
            { id: 'abandoned', name: '放弃', icon: '🚫' },
        ],
    });
    assert.match(html, /已开始2天/);
    assert.match(html, /2026年11月10日/);
    const icons = [...html.matchAll(/<span style="font-size:14px;">([\s\S]*?)<\/span>/g)].map(match => match[1]);
    assert.deepEqual(icons, ['🤔', '🚀', '📋', '✅', '🚫', '🤔', '🚀', '📋', '✅', '🚫']);
    assert.equal(html.match(/自定义进行/g).length, 2);
    assert.ok(!html.includes('🏃'));
    assert.ok(!html.includes('❌'));
});

test('自定义状态不额外添加默认 Emoji，动态名称和图标保持纯文本', async () => {
    const html = await renderDialog({
        startDate: '',
        statuses: [{ id: 'doing', name: '<自定义>', icon: '' }, { id: 'completed', name: '完成', icon: '<svg>图标</svg>' }],
    });
    assert.ok(html.includes('&lt;自定义&gt;'));
    assert.ok(html.includes('&lt;svg&gt;图标&lt;/svg&gt;'));
    assert.ok(!html.includes('📝'));
    assert.ok(!html.includes('project-start-info'));
});
