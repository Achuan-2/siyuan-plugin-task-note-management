const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');

// 仅提供渲染所需的 DOM 接口，执行真实的月/年视图和点击保存回调。
class Element {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.scrollTop = 0;
        this.classList = { add: () => {} };
    }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ''; }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { this.listeners.click?.({ stopPropagation() {} }); }
}

function descendants(element) {
    return [element, ...element.children.flatMap(descendants)];
}

function fixture(onSave) {
    const editors = [];
    const document = {
        createElement: tag => new Element(tag),
        getElementById: () => true
    };
    const dependencies = {
        siyuan: {},
        '../../utils/habitUtils': createKernelLoader()('src/utils/habitUtils.ts'),
        '../dialog/HabitDayDialog': {
            HabitDayDialog: class {
                constructor(habit, date, save) { Object.assign(this, { habit, date, save }); }
                show() { editors.push(this); }
            }
        },
        'echarts/core': { use() {} },
        '../../pluginInstance': { i18n: key => key === 'weekdayNames' ? '日,一,二,三,四,五,六' : key },
        '../../utils/dateUtils': { getLocaleTag: () => 'zh-CN' }
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/components/stats/HabitStatsDialog.ts'), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'document', compiled)(
        name => dependencies[name] || {}, module, module.exports, document
    );
    const habit = {
        id: 'habit', title: '阅读', target: 1, startDate: '2025-01-01',
        frequency: { type: 'daily' }, checkInEmojis: [{ emoji: '✅', countsAsSuccess: true }],
        checkIns: {}, totalCheckIns: 0
    };
    const stats = new module.exports.HabitStatsDialog(habit, onSave);
    // 使用历史月份和年份，验证刷新不会重置导航位置。
    stats.currentMonthDate = new Date(2025, 9, 1);
    stats.yearViewOffset = 2025 - new Date().getFullYear();
    const root = new Element();
    stats.dialog = { element: { querySelector: () => root } };
    stats.renderContainer(root);
    return { stats, root, editors };
}

function checkIn(editor, date) {
    // 新对象也必须替换统计弹窗内部的数据，不能依赖共享对象的原地修改。
    const updated = JSON.parse(JSON.stringify(editor.habit));
    updated.checkIns[date] = { count: 1, status: ['✅'], timestamp: `${date}T09:00:00` };
    updated.totalCheckIns = Object.keys(updated.checkIns).length;
    editor.habit = updated;
    return editor.save(updated);
}

function grids(root, className) {
    return descendants(root).filter(element => element.className === className);
}

function assertDateUpdated(root, date, completed) {
    for (const className of ['habit-month-grid', 'habit-year-grid']) {
        const cells = grids(root, className).flatMap(grid => grid.children);
        const cell = className === 'habit-month-grid'
            ? cells.filter(element => element.listeners.click)[Number(date.slice(-2)) - 1]
            : cells.find(element => element.attributes['aria-label']?.startsWith(date));
        assert.ok(cell, `${className} 包含 ${date}`);
        assert.equal(descendants(cell).some(element => element.textContent === '✅'), completed, className);
        assert.equal(cell.style.cssText.includes('color-mix'), completed, `${className} 完成底色`);
    }
}

test('月视图打开每日窗口，切换周内日期连续打卡后年视图和统计同步刷新', async () => {
    const saved = [];
    const { stats, root, editors } = fixture(async habit => { saved.push(habit); });
    root.scrollTop = 320;
    const day = grids(root, 'habit-month-grid')[0].children.find(element => element.listeners.click);
    day.click();
    const editor = editors[0];
    assert.ok(editor);
    for (const date of ['2025-10-01', '2025-10-02']) {
        await checkIn(editor, date);
        assertDateUpdated(root, date, true);
    }
    assert.equal(saved.length, 2);
    assert.equal(stats.habit, saved[1]);
    assert.equal(root.scrollTop, 320);
    assert.equal(stats.currentMonthDate.getMonth(), 9);
    assert.equal(stats.yearViewOffset, 2025 - new Date().getFullYear());
    assert.ok(descendants(root).some(element => element.innerHTML.includes('<span>2habitDays</span>')));
    assert.ok(descendants(root).some(element => element.innerHTML.includes('>2</div>') && element.innerHTML.includes('statsTotalCheckIns')));

    editor.habit.checkIns = {};
    editor.habit.totalCheckIns = 0;
    await editor.save(editor.habit);
    assertDateUpdated(root, '2025-10-01', false);
    assertDateUpdated(root, '2025-10-02', false);
});

test('年视图入口在没有外部保存回调时仍同步更新月视图', async () => {
    const { root, editors } = fixture();
    const day = grids(root, 'habit-year-grid')[9].children[1];
    day.click();
    assert.equal(editors[0].date, '2025-10-02');
    await checkIn(editors[0], editors[0].date);
    assertDateUpdated(root, '2025-10-02', true);
});

test('保存失败时不替换当前数据或重绘为已保存状态', async () => {
    const { stats, root, editors } = fixture(async () => { throw new Error('保存失败'); });
    const original = stats.habit;
    grids(root, 'habit-year-grid')[9].children[1].click();
    await assert.rejects(checkIn(editors[0], '2025-10-02'), /保存失败/);
    assert.equal(stats.habit, original);
    assertDateUpdated(root, '2025-10-02', false);
});
