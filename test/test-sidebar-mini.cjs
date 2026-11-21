const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function extractMethod(filePath, className, methodName) {
    const source = fs.readFileSync(path.join(root, filePath), 'utf8');
    const ast = ts.createSourceFile(path.basename(filePath), source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    const method = cls.members.find(node => node.name?.getText(ast) === methodName);
    assert.ok(method, `${className}.${methodName} not found in ${filePath}`);
    return method.getText(ast);
}

test('习惯一周打卡范围按周起始日计算，跨月和跨年也能正确落在当前自然周', () => {
    const methodText = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'getWeekStartDate');
    const Fixture = new Function('getLogicalDateString', compile(
        `class Fixture {
            constructor(weekStartDay = 1) { this.weekStartDay = weekStartDay; }
            ${methodText}
        }`
    ) + '; return Fixture;')(() => '2026-11-17');
    const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

    const mondayStart = new Fixture(1);
    for (const [today, first, last] of [
        ['2026-11-17', '2026-11-16', '2026-11-22'],
        ['2026-12-02', '2026-11-30', '2026-12-06'],
        ['2027-01-02', '2026-12-28', '2027-01-03'],
    ]) {
        const start = mondayStart.getWeekStartDate(today);
        assert.equal(localDate(start), first);
        start.setDate(start.getDate() + 6);
        assert.equal(localDate(start), last);
    }
    assert.equal(mondayStart.getWeekStartDate().getDate(), 16);

    const sundayStart = new Fixture(0);
    assert.equal(localDate(sundayStart.getWeekStartDate('2026-11-17')), '2026-11-15');
    assert.equal(localDate(sundayStart.getWeekStartDate('2027-01-02')), '2026-12-27');
});

test('任务迷你悬浮详情避免重复同日时间并保留子元素无障碍标签', () => {
    const methodText = extractMethod('src/components/render/TaskRenderer.ts', 'TaskRenderer', 'updateMiniTaskTooltip');
    const Fixture = new Function('i18n', 'getRepeatDescription', compile(
        `class Fixture {
            static getReminderTimeEntries() { return []; }
            static normalizeCustomProgress(v) { return typeof v === 'number' ? v : undefined; }
            ${methodText}
        }`
    ) + '; return Fixture;')(key => key, () => 'daily');

    const makeEl = (initialAttrs = {}, initialClasses = []) => {
        const attrs = new Map(Object.entries(initialAttrs));
        const classes = new Set(initialClasses);
        return {
            dataset: {},
            attrs,
            classes,
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name),
            },
            getAttribute: name => attrs.get(name) ?? null,
            setAttribute: (name, value) => attrs.set(name, String(value)),
            removeAttribute: name => attrs.delete(name),
            querySelector: () => null,
        };
    };

    const titleEl = makeEl({ 'aria-label': '打开绑定块: 测试任务' }, ['ariaLabel']);
    const timeEl = makeEl({ 'aria-label': '今天 · 点击修改时间', title: '今天' }, ['ariaLabel']);
    const row = makeEl({}, ['ariaLabel']);
    row.querySelector = selector => {
        if (selector === '.reminder-item__title') return titleEl;
        if (selector === '.reminder-item__time') return timeEl;
        return null;
    };

    const projectCache = new Map([['t1', { docTitle: '周报文档' }]]);
    Fixture.updateMiniTaskTooltip(row, {
        id: 't1',
        title: '测试任务',
        date: '2026-11-21',
        endDate: '2026-11-21',
    }, {
        viewMode: 'mini',
        today: '2026-11-21',
        projectCache,
    });

    assert.ok(row.dataset.miniTaskTooltip.includes('task-mini-tooltip__rows'));
    assert.ok(row.dataset.miniTaskTooltip.includes('<span>2026-11-21</span>'));
    assert.ok(!row.dataset.miniTaskTooltip.includes('2026-11-21 ~ 2026-11-21'));
    assert.ok(row.dataset.miniTaskTooltip.includes('周报文档'));
    assert.equal(row.classList.contains('ariaLabel'), false);
    assert.equal(titleEl.classList.contains('ariaLabel'), false);
    assert.equal(timeEl.classList.contains('ariaLabel'), false);
    assert.equal(titleEl.getAttribute('aria-label'), '打开绑定块: 测试任务');
    assert.equal(timeEl.getAttribute('aria-label'), '今天 · 点击修改时间');
    assert.equal(timeEl.getAttribute('title'), null);
});

test('任务迷你悬浮卡片优先显示在侧栏右侧并与当前行对齐，空间不足时自动翻转', () => {
    const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
    const { computeMiniTaskHoverPosition } = createKernelLoader()('src/components/render/miniTaskTouchTooltip.ts');

    const tooltipSize = { width: 220, height: 140 };
    const viewport = { width: 1440, height: 900 };

    // 1. 左侧停靠栏：悬浮卡片出现在侧栏右侧且与当前行顶部对齐
    const leftDockPos = computeMiniTaskHoverPosition(
        { left: 50, top: 120, right: 300, bottom: 156, width: 250, height: 36 },
        { left: 42, top: 0, right: 320, bottom: 900, width: 278, height: 900 },
        tooltipSize,
        viewport,
        { x: 140, y: 138 }
    );
    assert.deepEqual(leftDockPos, { left: 328, top: 120 });

    // 2. 左侧停靠栏底部任务：右侧显示且纵向贴底不溢出视口
    const bottomRowPos = computeMiniTaskHoverPosition(
        { left: 50, top: 820, right: 300, bottom: 856, width: 250, height: 36 },
        { left: 42, top: 0, right: 320, bottom: 900, width: 278, height: 900 },
        tooltipSize,
        viewport,
        { x: 140, y: 838 }
    );
    assert.deepEqual(bottomRowPos, { left: 328, top: 752 });

    // 3. 右侧停靠栏：右侧空间不足，自动翻转到侧栏左侧
    const rightDockPos = computeMiniTaskHoverPosition(
        { left: 1140, top: 200, right: 1390, bottom: 236, width: 250, height: 36 },
        { left: 1120, top: 0, right: 1400, bottom: 900, width: 280, height: 900 },
        tooltipSize,
        viewport,
        { x: 1200, y: 218 }
    );
    assert.deepEqual(rightDockPos, { left: 892, top: 200 });

    // 4. 宽屏面板且鼠标靠左：在鼠标右侧就近显示，不跑到屏幕最右端
    const widePanelPos = computeMiniTaskHoverPosition(
        { left: 40, top: 180, right: 1000, bottom: 216, width: 960, height: 36 },
        { left: 20, top: 0, right: 1020, bottom: 900, width: 1000, height: 900 },
        tooltipSize,
        viewport,
        { x: 120, y: 198 }
    );
    assert.deepEqual(widePanelPos, { left: 136, top: 180 });
});

test('移动端任务迷你点击在选择模式下不拦截番茄钟任务选择，且重复点击同一行可收起详情卡', () => {
    const methodText = extractMethod('src/components/panel/ReminderPanel.ts', 'ReminderPanel', 'handleMiniTaskTouchClick');
    class FakeElement {
        constructor(matchesMap = {}) {
            this.matchesMap = matchesMap;
            this.dataset = {};
        }
        closest(selector) {
            return this.matchesMap[selector] || null;
        }
        contains(node) {
            return node === this || Object.values(this.matchesMap).includes(node);
        }
    }

    let openCount = 0;
    let closeCount = 0;
    const Fixture = new Function('Element', 'showMiniTaskTouchTooltip', compile(
        `class Fixture {
            constructor() {
                this.disposed = false;
                this.viewMode = 'mini';
                this.isMobileClient = true;
                this.isMultiSelectMode = false;
                this.selectionOptions = undefined;
                this.container = { contains: () => true };
            }
            ${methodText}
        }`
    ) + '; return Fixture;')(FakeElement, (_row, _html, onClose) => {
        openCount++;
        return () => {
            closeCount++;
            onClose?.();
        };
    });

    const row = new FakeElement();
    row.dataset.miniTaskTooltip = '<div>detail</div>';
    const target = new FakeElement({ '.reminder-item--mini': row });

    const makeEvent = () => {
        let prevented = false;
        let stopped = false;
        return {
            target,
            preventDefault: () => { prevented = true; },
            stopImmediatePropagation: () => { stopped = true; },
            get prevented() { return prevented; },
            get stopped() { return stopped; },
        };
    };

    const panel = new Fixture();
    // 1. 选择模式（番茄钟任务选择器）下不拦截点击
    panel.selectionOptions = { onSelectTask: async () => {} };
    const selectionEvent = makeEvent();
    panel.handleMiniTaskTouchClick(selectionEvent);
    assert.equal(selectionEvent.prevented, false);
    assert.equal(openCount, 0);

    // 2. 正常侧栏模式：首次点击打开，再次点击同一行收起
    panel.selectionOptions = undefined;
    const firstTap = makeEvent();
    panel.handleMiniTaskTouchClick(firstTap);
    assert.equal(firstTap.prevented, true);
    assert.equal(openCount, 1);

    const secondTap = makeEvent();
    panel.handleMiniTaskTouchClick(secondTap);
    assert.equal(secondTap.prevented, true);
    assert.equal(openCount, 1);
    assert.equal(closeCount, 1);
});

test('迷你习惯番茄目标已有专注时长但无打卡记录时，不显示叉号或未打卡且菜单提供查看当日记录入口', () => {
    const startMethod = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'getWeekStartDate');
    const weekMethod = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'createWeekCheckIns');

    const createdButtons = [];
    const openedMenus = [];
    class FakeEl {
        constructor(tag) {
            this.tag = tag;
            this.children = [];
            this.dataset = {};
            this.attrs = new Map();
            this.listeners = new Map();
            this.classes = new Set();
            this.style = { setProperty: () => {} };
            this.classList = {
                add: (...names) => names.forEach(name => this.classes.add(name)),
                contains: name => this.classes.has(name),
            };
        }
        appendChild(child) { this.children.push(child); return child; }
        append(...items) { items.forEach(item => this.children.push(item)); }
        setAttribute(k, v) { this.attrs.set(k, String(v)); }
        addEventListener(type, fn) { this.listeners.set(type, fn); }
        getBoundingClientRect() { return { left: 10, bottom: 20 }; }
    }
    const fakeDocument = {
        createElement: tag => {
            const el = new FakeEl(tag);
            if (tag === 'button') createdButtons.push(el);
            return el;
        },
    };
    class FakeMenu {
        constructor(id) { this.id = id; this.items = []; openedMenus.push(this); }
        addSeparator() { this.items.push({ type: 'separator' }); }
        addItem(item) { this.items.push(item); }
        open() {}
    }
    let openedDialogDate = null;
    class FakeHabitDayDialog {
        constructor(_habit, date) { this.date = date; }
        show() { openedDialogDate = this.date; }
    }

    const ringCalls = [];
    const Fixture = new Function(
        'document', 'getComputedStyle', 'Menu', 'HabitDayDialog', 'i18n',
        'getLogicalDateString', 'getLocalDateString', 'isHabitActiveOnDate',
        'shouldCheckInOnDate', 'isHabitCheckInDayComplete', 'getHabitSuccessfulCheckInCount',
        'ringCalls', 'FakeEl',
        compile(`class Fixture {
            constructor() { this.container = {}; this.plugin = {}; this.weekStartDay = 1; }
            getHabitGoalType() { return 'pomodoro'; }
            getHabitProgressOnDate(_h, date) {
                const current = date === '2026-11-16' ? 30 : date === '2026-11-17' ? 15 : 0;
                return { current, target: 30, count: { current: 0, target: 1 }, pomodoro: { current, target: 30 } };
            }
            getHabitFocusMinutesByDate(_id, date) {
                return date === '2026-11-16' ? 30 : date === '2026-11-17' ? 15 : 0;
            }
            getHabitProgressColor() { return '#ff6347'; }
            getHabitProgressDescription(_h, date) {
                return date === '2026-11-16' ? '30m/30m' : date === '2026-11-17' ? '15m/30m' : '0m/30m';
            }
            createMiniCheckInRing(percentage, symbols) {
                ringCalls.push({ percentage, symbols });
                return new FakeEl('svg');
            }
            cloneHabit(h) { return JSON.parse(JSON.stringify(h)); }
            createCheckInSubmenu() { return [{ type: 'separator' }, { label: 'edit' }]; }
            ${startMethod}
            ${weekMethod}
        }`) + '; return Fixture;'
    )(
        fakeDocument,
        () => ({ color: '#000' }),
        FakeMenu,
        FakeHabitDayDialog,
        key => key === 'weekdayNames' ? '日,一,二,三,四,五,六' : key,
        () => '2026-11-17',
        d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        () => true,
        () => true,
        (_h, date) => date === '2026-11-16',
        () => 0,
        ringCalls,
        FakeEl
    );

    const fixture = new Fixture();
    fixture.createWeekCheckIns({ id: 'h1', title: '专注', checkIns: {}, frequency: { type: 'daily' } }, '2026-11-17', true);

    assert.equal(createdButtons.length, 7);
    // 2026-11-16（周一）：30/30 达标但无 checkIns，应显示完成态和番茄图标，而非 × / 未打卡
    assert.deepEqual(ringCalls[0], { percentage: 100, symbols: ['🍅'] });
    assert.equal(createdButtons[0].classList.contains('habit-card__week-day--done'), true);
    assert.equal(createdButtons[0].classList.contains('habit-mini__day--recorded'), true);
    assert.ok(createdButtons[0].title.includes('habitWeekCompleted'));

    // 2026-11-17（周二，今天）：15/30 未达标但有番茄进度，应显示半完成态和番茄图标，而非 ○ / 未打卡
    assert.deepEqual(ringCalls[1], { percentage: 50, symbols: ['🍅'] });
    assert.equal(createdButtons[1].classList.contains('habit-card__week-day--today'), true);
    assert.equal(createdButtons[1].classList.contains('habit-mini__day--recorded'), true);
    assert.equal(createdButtons[1].classList.contains('habit-mini__day--partial'), true);
    assert.ok(createdButtons[1].title.includes('habitWeekIncomplete'));

    // 2026-11-18（周三，未来日期）：应显示 ○ 而非 ×
    assert.deepEqual(ringCalls[2], { percentage: 0, symbols: '○' });

    // 点击日期按钮弹出快捷打卡菜单，且不以分隔线开头并把“查看或编辑此日记录”放在“编辑打卡选项”上方
    createdButtons[1].listeners.get('click')({ stopPropagation: () => {} });
    assert.equal(openedMenus.length, 1);
    assert.notEqual(openedMenus[0].items[0].type, 'separator');
    const viewRecordsIndex = openedMenus[0].items.findIndex(item => item.label === 'habitMiniViewDayRecords');
    const editOptionsIndex = openedMenus[0].items.findIndex(item => item.label === 'edit');
    assert.ok(viewRecordsIndex >= 0);
    assert.ok(editOptionsIndex > viewRecordsIndex);
    openedMenus[0].items[viewRecordsIndex].click();
    assert.equal(openedDialogDate, '2026-11-17');

    // 右键日期按钮直接打开查看/编辑当日记录弹窗
    openedDialogDate = null;
    createdButtons[0].listeners.get('contextmenu')({ preventDefault: () => {}, stopPropagation: () => {} });
    assert.equal(openedDialogDate, '2026-11-16');

    // 标准视图日期按钮同样保持左键弹出打卡菜单、右键打开当日记录弹窗
    createdButtons.length = 0;
    openedMenus.length = 0;
    openedDialogDate = null;
    fixture.createWeekCheckIns({ id: 'h1', title: '专注', checkIns: {}, frequency: { type: 'daily' } }, '2026-11-17', false);
    assert.equal(createdButtons.length, 7);
    assert.ok(createdButtons[1].title.includes('habitMiniDayActionHint'));
    assert.equal(createdButtons[0].children[1].textContent, '✓');
    assert.equal(createdButtons[1].children[1].textContent, '🍅');
    assert.equal(createdButtons[2].children[1].textContent, '·');
    createdButtons[1].listeners.get('click')({ stopPropagation: () => {} });
    assert.equal(openedMenus.length, 1);
    assert.equal(openedDialogDate, null);
    createdButtons[1].listeners.get('contextmenu')({ preventDefault: () => {}, stopPropagation: () => {} });
    assert.equal(openedDialogDate, '2026-11-17');
});

test('标准视图一周打卡：无需打卡显示横线，过去未完成显示叉号，当天和未来未完成显示圆点', () => {
    const startMethod = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'getWeekStartDate');
    const weekMethod = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'createWeekCheckIns');

    const createdButtons = [];
    class FakeEl {
        constructor(tag) {
            this.tag = tag;
            this.children = [];
            this.dataset = {};
            this.attrs = new Map();
            this.listeners = new Map();
            this.classes = new Set();
            this.style = { setProperty: () => {} };
            this.classList = {
                add: (...names) => names.forEach(name => this.classes.add(name)),
                contains: name => this.classes.has(name),
            };
        }
        appendChild(child) { this.children.push(child); return child; }
        append(...items) { items.forEach(item => this.children.push(item)); }
        setAttribute(k, v) { this.attrs.set(k, String(v)); }
        addEventListener(type, fn) { this.listeners.set(type, fn); }
    }
    const fakeDocument = {
        createElement: tag => {
            const el = new FakeEl(tag);
            if (tag === 'button') createdButtons.push(el);
            return el;
        },
    };

    const Fixture = new Function(
        'document', 'getComputedStyle', 'Menu', 'HabitDayDialog', 'i18n',
        'getLogicalDateString', 'getLocalDateString', 'isHabitActiveOnDate',
        'shouldCheckInOnDate', 'isHabitCheckInDayComplete', 'getHabitSuccessfulCheckInCount',
        compile(`class Fixture {
            constructor() { this.container = {}; this.plugin = {}; this.weekStartDay = 1; }
            getHabitGoalType() { return 'count'; }
            getHabitProgressOnDate() {
                return { current: 0, target: 1, count: { current: 0, target: 1 }, pomodoro: { current: 0, target: 0 } };
            }
            getHabitFocusMinutesByDate() { return 0; }
            getHabitProgressColor() { return '#4caf50'; }
            getHabitProgressDescription() { return ''; }
            cloneHabit(h) { return JSON.parse(JSON.stringify(h)); }
            createCheckInSubmenu() { return []; }
            ${startMethod}
            ${weekMethod}
        }`) + '; return Fixture;'
    )(
        fakeDocument,
        () => ({ color: '#000' }),
        class {},
        class {},
        key => key === 'weekdayNames' ? '日,一,二,三,四,五,六' : key,
        () => '2026-11-18',
        d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        () => true,
        // 仅周一(16)、周三(18)、周五(20)有计划，周二(17)与周四(19)无需打卡
        (_h, date) => ['2026-11-16', '2026-11-18', '2026-11-20'].includes(date),
        () => false,
        () => 0
    );

    const fixture = new Fixture();
    fixture.createWeekCheckIns({ id: 'h2', title: '健身', checkIns: {}, frequency: { type: 'weekly', weekdays: [1, 3, 5] } }, '2026-11-18', false);

    assert.equal(createdButtons.length, 7);
    assert.equal(createdButtons[0].children[1].textContent, '×'); // 16号（周一，过去应打卡未完成）
    assert.equal(createdButtons[1].children[1].textContent, '—'); // 17号（周二，无需打卡）
    assert.equal(createdButtons[2].children[1].textContent, '·'); // 18号（周三，今日应打卡未完成）
    assert.equal(createdButtons[3].children[1].textContent, '—'); // 19号（周四，无需打卡）
    assert.equal(createdButtons[4].children[1].textContent, '·'); // 20号（周五，未来应打卡）
});

test('习惯统计周/月视图日格状态：无计划显示横线、过去未完成打叉、部分打卡返回打卡项与进度百分比', () => {
    const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
    const { getHabitDayVisualState } = createKernelLoader()('src/utils/habitUtils.ts');

    const countHabit = {
        id: 'h-count',
        title: '喝水',
        startDate: '2026-11-16',
        frequency: { type: 'weekly', weekdays: [1, 3, 5] },
        goalType: 'count',
        target: 4,
        checkInEmojis: [
            { emoji: '💧', meaning: '一杯', countsAsSuccess: true },
            { emoji: '🥤', meaning: '饮料', countsAsSuccess: false },
        ],
        checkIns: {
            '2026-11-16': { count: 2, status: ['💧', '💧'], entries: [{ emoji: '💧' }, { emoji: '💧' }] },
            '2026-11-18': { count: 4, status: ['💧', '💧', '💧', '💧'], entries: [{ emoji: '💧' }, { emoji: '💧' }, { emoji: '💧' }, { emoji: '💧' }] },
        },
    };

    // 开始日期之前：无计划 -> 横线
    const beforeStart = getHabitDayVisualState(countHabit, '2026-11-15', '2026-11-21');
    assert.equal(beforeStart.required, false);
    assert.equal(beforeStart.fallbackSymbol, '—');

    // 16号（周一）：2/4 未达标但有打卡项 -> partial + 50% + 显示打卡项
    const partialDay = getHabitDayVisualState(countHabit, '2026-11-16', '2026-11-21');
    assert.equal(partialDay.done, false);
    assert.equal(partialDay.isPartial, true);
    assert.equal(partialDay.percentage, 50);
    assert.deepEqual(partialDay.displayEmojis, ['💧', '💧']);
    assert.equal(partialDay.fallbackSymbol, '');

    // 17号（周二）：无计划 -> 横线
    const unplannedDay = getHabitDayVisualState(countHabit, '2026-11-17', '2026-11-21');
    assert.equal(unplannedDay.required, false);
    assert.equal(unplannedDay.isPartial, false);
    assert.equal(unplannedDay.fallbackSymbol, '—');

    // 18号（周三）：4/4 已完成 -> done + 100%
    const doneDay = getHabitDayVisualState(countHabit, '2026-11-18', '2026-11-21');
    assert.equal(doneDay.done, true);
    assert.equal(doneDay.isPartial, false);
    assert.equal(doneDay.percentage, 100);
    assert.deepEqual(doneDay.displayEmojis, ['💧', '💧', '💧', '💧']);

    // 20号（周五）：过去有计划未打卡 -> 打叉
    const missedDay = getHabitDayVisualState(countHabit, '2026-11-20', '2026-11-21');
    assert.equal(missedDay.required, true);
    assert.equal(missedDay.done, false);
    assert.equal(missedDay.isPartial, false);
    assert.equal(missedDay.fallbackSymbol, '×');

    // 23号（下周一）：未来有计划未打卡 -> 空白（不提前打叉）
    const futureDay = getHabitDayVisualState(countHabit, '2026-11-23', '2026-11-21');
    assert.equal(futureDay.required, true);
    assert.equal(futureDay.fallbackSymbol, '');

    // 番茄目标已有专注时长但未达标 -> partial + 50% + 🍅
    const pomodoroHabit = {
        id: 'h-pomo',
        title: '阅读',
        startDate: '2026-11-01',
        frequency: { type: 'daily' },
        goalType: 'pomodoro',
        pomodoroTargetMinutes: 30,
        checkIns: {},
    };
    const partialPomo = getHabitDayVisualState(pomodoroHabit, '2026-11-20', '2026-11-21', {
        getPomodoroFocusMinutes: () => 15,
    });
    assert.equal(partialPomo.done, false);
    assert.equal(partialPomo.isPartial, true);
    assert.equal(partialPomo.percentage, 50);
    assert.deepEqual(partialPomo.displayEmojis, ['🍅']);
});

test('任务迷你视图跨天任务：未来开始显示开始日期，已开始或过去开始显示结束日期', () => {
    const panelMethod = extractMethod('src/components/panel/ReminderPanel.ts', 'ReminderPanel', 'formatReminderTime');
    const rendererMethod = extractMethod('src/components/render/TaskRenderer.ts', 'TaskRenderer', 'formatReminderTime');

    const i18nMap = { today: '今天', tomorrow: '明天' };
    const i18n = key => i18nMap[key] || key;
    const compareDateStrings = (a, b) => a.localeCompare(b);
    const getLogicalDateString = () => '2026-11-21';
    const getRelativeDateString = offset => offset === 1 ? '2026-11-22' : '2026-11-21';
    const getLocaleTag = () => 'zh-CN';
    const getSolarDateLunarString = () => '';

    const PanelFixture = new Function(
        'i18n', 'compareDateStrings', 'getLogicalDateString', 'getRelativeDateString', 'getLocaleTag', 'getSolarDateLunarString',
        compile(`class PanelFixture {
            constructor(viewMode = 'mini') { this.viewMode = viewMode; }
            getReminderLogicalDate(date) { return date || ''; }
            ${panelMethod}
        }`) + '; return PanelFixture;'
    )(i18n, compareDateStrings, getLogicalDateString, getRelativeDateString, getLocaleTag, getSolarDateLunarString);

    const RendererFixture = new Function(
        'i18n', 'compareDateStrings', 'getLogicalDateString', 'getRelativeDateString', 'getLocaleTag', 'getSolarDateLunarString',
        compile(`class RendererFixture {
            static getReminderLogicalDate(date) { return date || ''; }
            ${rendererMethod}
        }`) + '; return RendererFixture;'
    )(i18n, compareDateStrings, getLogicalDateString, getRelativeDateString, getLocaleTag, getSolarDateLunarString);

    const miniPanel = new PanelFixture('mini');
    const standardPanel = new PanelFixture('standard');
    const fmt = date => new Date(date + 'T00:00:00').toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

    // 开始日期在过去/今天：mini 显示结束日期（及结束时间），当天有具体时间时省略“今天”；标准视图显示范围
    assert.equal(miniPanel.formatReminderTime('2026-11-18', '', '2026-11-21', '2026-11-21', ''), '今天');
    assert.equal(miniPanel.formatReminderTime('2026-11-18', '09:00', '2026-11-21', '2026-11-21', '13:00'), '13:00');
    assert.equal(miniPanel.formatReminderTime('2026-11-18', '', '2026-11-21', '2026-11-22', ''), '明天');
    assert.equal(miniPanel.formatReminderTime('2026-11-18', '', '2026-11-21', '2026-11-25', ''), fmt('2026-11-25'));
    assert.equal(miniPanel.formatReminderTime('2026-11-21', '', '2026-11-21', '2026-11-25', ''), fmt('2026-11-25'));
    assert.equal(miniPanel.formatReminderTime('2026-11-18', '09:00', '2026-11-21', '2026-11-25', '18:00'), `${fmt('2026-11-25')} 18:00`);
    assert.equal(miniPanel.formatReminderTime('2026-11-18', '09:00', '2026-11-21', '2026-11-25', ''), fmt('2026-11-25'));
    assert.equal(standardPanel.formatReminderTime('2026-11-18', '', '2026-11-21', '2026-11-25', ''), `${fmt('2026-11-18')} → ${fmt('2026-11-25')}`);

    // 开始日期在未来：mini 显示开始日期（及开始时间）
    assert.equal(miniPanel.formatReminderTime('2026-11-22', '', '2026-11-21', '2026-11-25', ''), '明天');
    assert.equal(miniPanel.formatReminderTime('2026-11-23', '09:00', '2026-11-21', '2026-11-25', '18:00'), `${fmt('2026-11-23')} 09:00`);
    assert.equal(miniPanel.formatReminderTime('2026-11-23', '', '2026-11-21', '2026-11-25', '18:00'), fmt('2026-11-23'));

    // 当天任务：极简视图有具体时间仅显示时间，无时间显示“今天”；标准视图保持“今天 时间”
    assert.equal(miniPanel.formatReminderTime('2026-11-21', '13:00', '2026-11-21'), '13:00');
    assert.equal(miniPanel.formatReminderTime('2026-11-21', '', '2026-11-21'), '今天');
    assert.equal(miniPanel.formatReminderTime('2026-11-21', '09:00', '2026-11-21', '2026-11-21', '11:00'), '09:00');
    assert.equal(miniPanel.formatReminderTime('2026-11-22', '13:00', '2026-11-21'), '明天 13:00');
    assert.equal(standardPanel.formatReminderTime('2026-11-21', '13:00', '2026-11-21'), '今天 13:00');

    // TaskRenderer 默认实现与 ReminderPanel 保持一致
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-21', '13:00', '2026-11-21', undefined, undefined, undefined, { viewMode: 'mini' }),
        '13:00'
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-21', '', '2026-11-21', undefined, undefined, undefined, { viewMode: 'mini' }),
        '今天'
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-18', '09:00', '2026-11-21', '2026-11-21', '13:00', undefined, { viewMode: 'mini' }),
        '13:00'
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-18', '09:00', '2026-11-21', '2026-11-25', '18:00', undefined, { viewMode: 'mini' }),
        `${fmt('2026-11-25')} 18:00`
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-18', '09:00', '2026-11-21', '2026-11-25', '', undefined, { viewMode: 'mini' }),
        fmt('2026-11-25')
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-23', '09:00', '2026-11-21', '2026-11-25', '18:00', undefined, { viewMode: 'mini' }),
        `${fmt('2026-11-23')} 09:00`
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-22', '', '2026-11-21', '2026-11-25', '', undefined, { viewMode: 'mini' }),
        '明天'
    );
    assert.equal(
        RendererFixture.formatReminderTime('2026-11-18', '', '2026-11-21', '2026-11-25', '', undefined, { viewMode: 'standard' }),
        `${fmt('2026-11-18')} → ${fmt('2026-11-25')}`
    );
});

test('极简视图文案更新且勾选极简视图时隐藏不适用的显示设置项', () => {
    const zh = JSON.parse(fs.readFileSync(path.join(root, 'i18n/zh_CN.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8'));
    assert.equal(zh.panelViewMini, '极简');
    assert.equal(en.panelViewMini, 'Minimal');

    const methodText = extractMethod('src/components/panel/ReminderPanel.ts', 'ReminderPanel', 'showMoreMenu');
    const openedMenus = [];
    class FakeMenu {
        constructor(id) { this.id = id; this.items = []; openedMenus.push(this); }
        addItem(item) { this.items.push(item); }
        addSeparator() { this.items.push({ type: 'separator' }); }
        open() {}
    }

    const createPanelViewMenu = (mode, onChange) => ({
        icon: 'iconEye',
        label: 'panelView',
        submenu: ['standard', 'mini'].map(value => ({
            icon: mode === value ? 'iconSelect' : '',
            label: value === 'mini' ? 'panelViewMini' : 'panelViewStandard',
            click: () => onChange(value),
        })),
    });

    const Fixture = new Function(
        'Menu', 'i18n', 'createPanelViewMenu', 'PasteTaskDialog', 'CategoryManageDialog', 'VipManager', 'HTMLElement',
        compile(`class Fixture {
            constructor(viewMode) {
                this.viewMode = viewMode;
                this.showProjectKanbanStatus = true;
                this.showCompletedSubtasks = false;
                this.clipTitleToOneLine = false;
                this.showTaskCardDocumentTitle = true;
                this.isMultiSelectMode = false;
                this.selectionOptions = { onSelectTask: async () => {} };
                this.container = { dataset: {} };
                this.plugin = {};
            }
            async savePanelSettings() {}
            async loadReminders() {}
            ${methodText}
        }`) + '; return Fixture;'
    )(FakeMenu, key => key, createPanelViewMenu, class {}, class {}, { getInstance: () => ({ isVip: () => false }) }, class {});

    const event = { currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) }, clientX: 10, clientY: 20 };

    // 极简视图：隐藏显示项目看板状态、标题限制一行显示、任务卡片显示文档标题
    new Fixture('mini').showMoreMenu(event);
    const miniDisplayMenu = openedMenus.at(-1).items.find(item => item.label === 'displaySettings');
    const miniLabels = miniDisplayMenu.submenu.map(item => item.label);
    assert.deepEqual(miniLabels, ['panelView', 'showCompletedSubtasks']);

    // 标准视图：完整保留全部显示设置项
    new Fixture('standard').showMoreMenu(event);
    const standardDisplayMenu = openedMenus.at(-1).items.find(item => item.label === 'displaySettings');
    const standardLabels = standardDisplayMenu.submenu.map(item => item.label);
    assert.deepEqual(standardLabels, [
        'panelView',
        'showProjectKanbanStatus',
        'showCompletedSubtasks',
        'clipTitleToOneLine',
        'showTaskCardDocumentTitle',
    ]);
});

test('移动端长按手势：220ms 就绪反馈后移动进入拖拽，850ms 未明显移动弹出右键菜单，且禁拖时仍可弹出菜单', () => {
    const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
    const timers = new Map();
    let nextTimerId = 1;
    let now = 1000;

    const createEventTarget = () => {
        const listeners = new Map();
        return {
            listeners,
            addEventListener(type, fn) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            removeEventListener(type, fn) {
                const list = listeners.get(type);
                if (!list) return;
                const idx = list.indexOf(fn);
                if (idx >= 0) list.splice(idx, 1);
            },
            dispatch(type, event) {
                for (const fn of [...(listeners.get(type) || [])]) fn(event);
            },
        };
    };

    const fakeDoc = Object.assign(createEventTarget(), {
        hidden: false,
        body: { appendChild(el) { el.connected = true; } },
        createElement: () => ({
            className: '',
            textContent: '',
            style: {},
            remove() { this.connected = false; },
        }),
    });
    const fakeWindow = Object.assign(createEventTarget(), {
        setTimeout(fn, delay) {
            const id = nextTimerId++;
            timers.set(id, { fn, runAt: now + delay });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
    });
    const advanceBy = ms => {
        const target = now + ms;
        while (true) {
            const due = [...timers.entries()]
                .filter(([, item]) => item.runAt <= target)
                .sort((a, b) => a[1].runAt - b[1].runAt)[0];
            if (!due) break;
            const [id, item] = due;
            timers.delete(id);
            now = item.runAt;
            item.fn();
        }
        now = target;
    };

    const prevGlobals = {
        window: global.window,
        document: global.document,
        requestAnimationFrame: global.requestAnimationFrame,
        cancelAnimationFrame: global.cancelAnimationFrame,
        performance: global.performance,
    };
    const origDateNow = Date.now;
    global.window = fakeWindow;
    global.document = fakeDoc;
    global.requestAnimationFrame = () => 1;
    global.cancelAnimationFrame = () => {};
    global.performance = { now: () => now };
    Date.now = () => now;

    try {
        const { LongPressTaskDrag } = createKernelLoader()('src/utils/longPressTaskDrag.ts');
        const makeNode = () => {
            const classes = new Set();
            return Object.assign(createEventTarget(), {
                isConnected: true,
                scrollTop: 0,
                classList: {
                    add: (...names) => names.forEach(n => classes.add(n)),
                    remove: (...names) => names.forEach(n => classes.delete(n)),
                    contains: n => classes.has(n),
                },
                getBoundingClientRect: () => ({ left: 0, top: 0, right: 260, bottom: 400, width: 260, height: 400 }),
            });
        };

        const root = makeNode();
        const row = makeNode();
        root.contains = node => node === root || node === row;

        let draggable = true;
        const eventsLog = [];
        const drag = new LongPressTaskDrag(root, {
            getSource: () => ({ element: row, task: { id: 't1' }, title: '任务1', draggable }),
            onStart: () => eventsLog.push('drag:start'),
            onMove: () => eventsLog.push('drag:move'),
            onDrop: () => eventsLog.push('drag:drop'),
            onEnd: () => eventsLog.push('drag:end'),
            onContextMenu: (_source, point) => eventsLog.push(`menu:${point.clientX},${point.clientY}`),
            dragDelayMs: 220,
            contextMenuDelayMs: 850,
        });

        const touchEvent = (x, y, id = 1) => {
            const point = { identifier: id, clientX: x, clientY: y };
            return {
                target: row,
                touches: [point],
                changedTouches: [point],
                cancelable: true,
                prevented: false,
                stopped: false,
                preventDefault() { this.prevented = true; },
                stopImmediatePropagation() { this.stopped = true; },
            };
        };

        // 1. 按下后 100ms 立即大幅滑动 -> 正常列表滚动，既不拖拽也不弹菜单
        root.dispatch('touchstart', touchEvent(100, 100));
        advanceBy(100);
        const scrollMove = touchEvent(100, 140);
        fakeDoc.dispatch('touchmove', scrollMove);
        advanceBy(900);
        assert.equal(scrollMove.prevented, false);
        assert.deepEqual(eventsLog, []);

        // 2. 按住 220ms 后出现可拖拽就绪样式，随后在 550ms 时移动仍顺利进入拖拽并取消右键菜单
        root.dispatch('touchstart', touchEvent(100, 100));
        advanceBy(230);
        assert.equal(row.classList.contains('reminder-item--touch-drag-ready'), true);
        assert.deepEqual(eventsLog, []);
        advanceBy(320); // 550ms 仍在充足的拖拽窗口内，不会误弹菜单
        assert.deepEqual(eventsLog, []);
        const dragMove = touchEvent(100, 120);
        fakeDoc.dispatch('touchmove', dragMove);
        assert.equal(dragMove.prevented, true);
        assert.equal(row.classList.contains('reminder-item--touch-drag-ready'), false);
        assert.deepEqual(eventsLog, ['drag:start', 'drag:move']);
        advanceBy(500); // 超过 850ms 也不会误弹菜单
        assert.deepEqual(eventsLog, ['drag:start', 'drag:move']);
        const dragEnd = { ...touchEvent(100, 160), touches: [] };
        fakeDoc.dispatch('touchend', dragEnd);
        assert.deepEqual(eventsLog, ['drag:start', 'drag:move', 'drag:end', 'drag:drop']);

        // 3. 按住 850ms 且未明显位移（允许 <=6px 微抖）-> 清除就绪态、弹出右键菜单并吞掉后续 click
        eventsLog.length = 0;
        root.dispatch('touchstart', touchEvent(120, 200));
        advanceBy(400);
        fakeDoc.dispatch('touchmove', touchEvent(123, 202));
        advanceBy(450);
        assert.equal(row.classList.contains('reminder-item--touch-drag-ready'), false);
        assert.deepEqual(eventsLog, ['menu:123,202']);
        const strayClick = { target: row, cancelable: true, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        fakeDoc.dispatch('click', strayClick);
        assert.equal(strayClick.prevented, true);
        assert.equal(strayClick.stopped, true);

        // 4. 禁拖状态下（draggable=false），按住 850ms 未移动仍可弹出右键菜单
        eventsLog.length = 0;
        draggable = false;
        root.dispatch('touchstart', touchEvent(80, 90));
        advanceBy(850);
        assert.deepEqual(eventsLog, ['menu:80,90']);

        drag.dispose();
    } finally {
        Date.now = origDateNow;
        global.window = prevGlobals.window;
        global.document = prevGlobals.document;
        global.requestAnimationFrame = prevGlobals.requestAnimationFrame;
        global.cancelAnimationFrame = prevGlobals.cancelAnimationFrame;
        global.performance = prevGlobals.performance;
    }
});

test('项目管理与项目看板移动端接入统一的长按拖拽（220ms）与上下文菜单（850ms）配置', () => {
    const projectDragMethod = extractMethod('src/components/panel/ProjectPanel.ts', 'ProjectPanel', 'ensureMobileProjectDrag');
    const kanbanDragMethod = extractMethod('src/components/panel/ProjectKanbanView.ts', 'ProjectKanbanView', 'ensureMobileTaskDrag');

    const captured = [];
    class FakeLongPressTaskDrag {
        constructor(root, options) {
            this.root = root;
            this.options = options;
            captured.push(options);
        }
    }

    const menuCalls = [];
    const ProjectFixture = new Function(
        'LongPressTaskDrag', 'ProjectFolderManager', 'menuCalls',
        compile(`class ProjectFixture {
            constructor() {
                this.disposed = false;
                this.projectsContainer = { contains: () => true };
                this.currentProjectsCache = [{ id: 'p1', name: '项目A' }];
                this.folderTreeNodeMap = new Map([['f1', { folder: { id: 'f1', name: '目录1' }, projects: [], children: [], totalProjectCount: 0 }]]);
                this.plugin = {};
            }
            getProjectFromElement(el) { return this.currentProjectsCache.find(p => p.id === el.dataset.projectId); }
            isDragDisabledBySortMode() { return true; }
            showProjectContextMenu(point, project) { menuCalls.push(['project', project.id, point.clientX, point.clientY]); }
            showFolderContextMenu(point, folder) { menuCalls.push(['folder', folder.id, point.clientX, point.clientY]); }
            ${projectDragMethod}
        }`) + '; return ProjectFixture;'
    )(FakeLongPressTaskDrag, { getInstance: () => ({ getFolders: () => [] }) }, menuCalls);

    const KanbanFixture = new Function(
        'LongPressTaskDrag', 'menuCalls',
        compile(`class KanbanFixture {
            constructor() {
                this.disposed = false;
                this.isLoading = false;
                this.isMultiSelectMode = false;
                this.selectedTaskIds = new Set();
                this.container = { contains: () => true };
            }
            getTaskFromElement() { return { id: 't1', title: '看板任务' }; }
            toggleTaskSelection(id) { this.selectedTaskIds.add(id); }
            async showBatchContextMenu(point) { menuCalls.push(['batch', point.clientX, point.clientY]); }
            showSubscribedTaskContextMenu(point, task) { menuCalls.push(['sub', task.id, point.clientX, point.clientY]); }
            async showTaskContextMenu(point, task) { menuCalls.push(['task', task.id, point.clientX, point.clientY]); }
            ${kanbanDragMethod}
        }`) + '; return KanbanFixture;'
    )(FakeLongPressTaskDrag, menuCalls);

    // 1. 项目管理：支持项目和文件夹的长按，禁拖排序下 draggable=false 但仍可弹出上下文菜单
    const projectPanel = new ProjectFixture();
    projectPanel.ensureMobileProjectDrag();
    const projectOpts = captured.at(-1);
    assert.equal(projectOpts.dragDelayMs, 220);
    assert.equal(projectOpts.contextMenuDelayMs, 850);

    const projectEl = { dataset: { projectId: 'p1' }, closest: s => s === '.project-item[data-project-id]' ? projectEl : null };
    const projectSource = projectOpts.getSource(projectEl);
    assert.equal(projectSource.draggable, false);
    projectOpts.onContextMenu(projectSource, { clientX: 50, clientY: 60 });

    const folderEl = { dataset: { folderId: 'f1' }, closest: s => s === '.project-folder-header[data-folder-id]' ? folderEl : null };
    const folderSource = projectOpts.getSource(folderEl);
    assert.equal(folderSource.draggable, true);
    projectOpts.onContextMenu(folderSource, { clientX: 70, clientY: 80 });

    // 2. 项目看板：常规模式可拖可弹任务菜单，多选模式禁拖但仍可弹批量菜单
    const kanban = new KanbanFixture();
    kanban.ensureMobileTaskDrag();
    const kanbanOpts = captured.at(-1);
    assert.equal(kanbanOpts.dragDelayMs, 220);
    assert.equal(kanbanOpts.contextMenuDelayMs, 850);

    const taskEl = { dataset: { taskId: 't1' }, closest: s => s === '.kanban-task[data-task-id]' ? taskEl : null };
    const taskSource = kanbanOpts.getSource(taskEl);
    assert.equal(taskSource.draggable, true);
    kanbanOpts.onContextMenu(taskSource, { clientX: 90, clientY: 100 });

    kanban.isMultiSelectMode = true;
    const multiSource = kanbanOpts.getSource(taskEl);
    assert.equal(multiSource.draggable, false);
    kanbanOpts.onContextMenu(multiSource, { clientX: 110, clientY: 120 });

    assert.deepEqual(menuCalls, [
        ['project', 'p1', 50, 60],
        ['folder', 'f1', 70, 80],
        ['task', 't1', 90, 100],
        ['batch', 110, 120],
    ]);
});

test('日历视图移动端配置 220ms/250ms 长按拖动选区与 850ms 静止长按右键菜单', () => {
    const calendarSource = fs.readFileSync(path.join(root, 'src/components/panel/CalendarView.ts'), 'utf8');
    assert.ok(calendarSource.includes('longPressDelay: 250'));
    assert.ok(calendarSource.includes('eventLongPressDelay: 220'));
    assert.ok(calendarSource.includes('selectLongPressDelay: 250'));

    const setupMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'setupMobileEventTouchInteractions');
    const cancelMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'cancelMobileEventContextMenuTimer');

    const timers = new Map();
    let nextTimerId = 1;
    let now = 2000;
    const createTarget = () => {
        const listeners = new Map();
        return {
            addEventListener(type, fn) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            removeEventListener(type, fn) {
                const list = listeners.get(type);
                if (!list) return;
                const idx = list.indexOf(fn);
                if (idx >= 0) list.splice(idx, 1);
            },
            dispatch(type, ev) {
                for (const fn of [...(listeners.get(type) || [])]) fn(ev);
            },
        };
    };
    class FakeElement {
        constructor(matches = {}, classes = []) {
            this.matches = matches;
            this.classList = { contains: name => classes.includes(name) };
        }
        closest(sel) {
            const parts = sel.split(',').map(s => s.trim());
            for (const key of Object.keys(this.matches)) {
                if (parts.includes(key)) return this.matches[key];
            }
            return null;
        }
        querySelector() { return null; }
        getAttribute() { return null; }
    }
    const fakeDoc = Object.assign(createTarget(), { hidden: false });
    const fakeWin = createTarget();
    const advanceBy = ms => {
        const target = now + ms;
        while (true) {
            const due = [...timers.entries()].filter(([, item]) => item.runAt <= target).sort((a, b) => a[1].runAt - b[1].runAt)[0];
            if (!due) break;
            const [id, item] = due;
            timers.delete(id);
            now = item.runAt;
            item.fn();
        }
        now = target;
    };

    const prevGlobals = { document: global.document, window: global.window, Element: global.Element };
    const origNow = Date.now;
    global.document = fakeDoc;
    global.window = fakeWin;
    global.Element = FakeElement;
    Date.now = () => now;

    try {
        const menuCalls = [];
        const Fixture = new Function(
            'menuCalls',
            compile(`class Fixture {
                constructor() {
                    this.disposed = false;
                    this.calendarEventElMap = new WeakMap();
                    this.mobileEventContextTimer = 0;
                    this.mobileEventTouchSession = null;
                    this.suppressCalendarClickUntil = 0;
                    this.lifecycle = {
                        listen: (t, type, fn) => t.addEventListener(type, fn),
                        timeout: (fn, delay) => {
                            const id = ${'__setTimer'}(fn, delay);
                            return id;
                        },
                        clearTimeout: id => ${'__clearTimer'}(id),
                    };
                }
                async showEventContextMenu(point, ev) { menuCalls.push([ev.id, point.clientX, point.clientY]); }
                keepMobileEventSelected() {}
                clearMobileEventSelection() {}
                ${cancelMethod}
                ${setupMethod}
            }`).replace('__setTimer', 'this.__setTimer').replace('__clearTimer', 'this.__clearTimer') + '; return Fixture;'
        )(menuCalls);

        const fixture = new Fixture();
        fixture.__setTimer = (fn, delay) => { const id = nextTimerId++; timers.set(id, { fn, runAt: now + delay }); return id; };
        fixture.__clearTimer = id => timers.delete(id);

        // 模拟 FullCalendar 真实 DOM：事件节点本身是 <a class="fc-event">
        const eventEl = new FakeElement({ '.fc-event': null, a: null }, ['fc-event']);
        eventEl.matches['.fc-event'] = eventEl;
        eventEl.matches.a = eventEl;
        const innerLinkEl = new FakeElement({ a: null, '.fc-event': eventEl }, []);
        innerLinkEl.matches.a = innerLinkEl;
        const resizerEl = new FakeElement({ '.fc-event-resizer': true, '.fc-event': eventEl, a: eventEl }, []);
        const calendarEl = Object.assign(createTarget(), { contains: node => node === eventEl || node === resizerEl || node === innerLinkEl });
        fixture.calendarEventElMap.set(eventEl, { id: 'ev1', extendedProps: {} });
        fixture.setupMobileEventTouchInteractions(calendarEl);

        const touch = (target, x, y) => ({ target, touches: [{ identifier: 1, clientX: x, clientY: y }] });

        // 1. 触摸调整手柄或事件内部普通链接时不弹出上下文菜单
        calendarEl.dispatch('touchstart', touch(resizerEl, 50, 50));
        advanceBy(900);
        calendarEl.dispatch('touchstart', touch(innerLinkEl, 50, 50));
        advanceBy(900);
        assert.deepEqual(menuCalls, []);

        // 2. 长按期间拖动移动超过 8px -> 取消上下文菜单
        calendarEl.dispatch('touchstart', touch(eventEl, 100, 100));
        advanceBy(300);
        fakeDoc.dispatch('touchmove', touch(eventEl, 120, 100));
        advanceBy(600);
        assert.deepEqual(menuCalls, []);

        // 2.5 短按后即使仅在原始目标触发 touchend（模拟节点脱离 DOM 后 document 收不到 touchend），也不会延迟弹出右键菜单
        const detachedTarget = Object.assign(new FakeElement({ '.fc-event': eventEl, a: eventEl }, ['fc-event']), createTarget());
        calendarEl.contains = node => node === eventEl || node === resizerEl || node === innerLinkEl || node === detachedTarget;
        calendarEl.dispatch('touchstart', touch(detachedTarget, 100, 100));
        advanceBy(120);
        detachedTarget.dispatch('touchend', {});
        advanceBy(900);
        assert.deepEqual(menuCalls, []);

        // 2.6 长按拖动期间即使仅在脱离 DOM 的原始目标上触发 touchmove，也会取消右键菜单
        calendarEl.dispatch('touchstart', touch(detachedTarget, 100, 100));
        advanceBy(300);
        detachedTarget.dispatch('touchmove', touch(detachedTarget, 130, 150));
        advanceBy(700);
        assert.deepEqual(menuCalls, []);

        // 3. 静止长按 850ms -> 弹出事件右键菜单并吞掉后续 click
        calendarEl.dispatch('touchstart', touch(eventEl, 100, 100));
        advanceBy(850);
        assert.deepEqual(menuCalls, [['ev1', 100, 100]]);
        const clickEv = { cancelable: true, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        calendarEl.dispatch('click', clickEv);
        assert.equal(clickEv.prevented, true);
        assert.equal(clickEv.stopped, true);
    } finally {
        Date.now = origNow;
        global.document = prevGlobals.document;
        global.window = prevGlobals.window;
        global.Element = prevGlobals.Element;
    }
});

test('移动端日历短按未选中任务直接进入时间长度调整选中态，再次双击打开编辑', async () => {
    const clickMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'handleEventClick');
    const selectMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'selectCalendarEventForTouchResize');
    const getSelectedMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'getSelectedCalendarEventInstanceId');

    const actions = [];
    const dispatched = [];
    const Fixture = new Function(
        'actions', 'dispatched',
        compile(`class Fixture {
            constructor() {
                this.isDragging = false;
                this.suppressCalendarClickUntil = 0;
                this.lastEventClickTime = 0;
                this.lastEventClickId = null;
                this.eventClickTimeout = null;
                this.calendar = {
                    currentData: {
                        eventSelection: '',
                        dispatch: action => {
                            dispatched.push(action);
                            if (action.type === 'SELECT_EVENT') this.calendar.currentData.eventSelection = action.eventInstanceId;
                        },
                    },
                };
                this.lifecycle = {
                    timeout: fn => { fn(); return 1; },
                    clearTimeout: () => {},
                };
            }
            isMobileCalendarClient() { return true; }
            keepMobileEventSelected() {}
            cancelMobileEventContextMenuTimer() { actions.push('cancel-menu-timer'); }
            async openEventEditDialog(ev) { actions.push('edit:' + ev.id); }
            async executeSingleClickEventAction(info) { actions.push('single:' + info.event.id); }
            ${getSelectedMethod}
            ${selectMethod}
            ${clickMethod}
        }`) + '; return Fixture;'
    )(actions, dispatched);

    const fixture = new Fixture();
    const ev = { id: 'ev1', extendedProps: { blockId: 'b1' }, _instance: { instanceId: 'inst-1' } };

    // 1. 首次短按：直接派发 SELECT_EVENT（展示上下/左右调整边框），不跳转笔记，并清理长按菜单计时器
    await fixture.handleEventClick({ event: ev });
    assert.deepEqual(dispatched, [{ type: 'SELECT_EVENT', eventInstanceId: 'inst-1' }]);
    assert.deepEqual(actions, ['cancel-menu-timer']);

    // 2. 短时间再次点击（双击）：打开编辑弹窗
    await fixture.handleEventClick({ event: ev });
    assert.deepEqual(actions, ['cancel-menu-timer', 'cancel-menu-timer', 'edit:ev1']);
});

test('移动端日历多天/周/日视图全天区域支持长按 220ms 拖动调整高度', () => {
    const methodText = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'setupAllDayResizer');
    const timers = new Map();
    let nextTimerId = 1;
    let now = 3000;

    const createNode = () => {
        const listeners = new Map();
        const classes = new Set();
        return {
            dataset: {},
            style: {},
            offsetHeight: 160,
            scrollHeight: 260,
            classList: {
                add: (...names) => names.forEach(n => classes.add(n)),
                remove: (...names) => names.forEach(n => classes.delete(n)),
                contains: n => classes.has(n),
            },
            setAttribute() {},
            addEventListener(type, fn) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            removeEventListener(type, fn) {
                const list = listeners.get(type);
                if (!list) return;
                const idx = list.indexOf(fn);
                if (idx >= 0) list.splice(idx, 1);
            },
            dispatch(type, ev) {
                for (const fn of [...(listeners.get(type) || [])]) fn(ev);
            },
        };
    };

    const advanceBy = ms => {
        const target = now + ms;
        while (true) {
            const due = [...timers.entries()].filter(([, item]) => item.runAt <= target).sort((a, b) => a[1].runAt - b[1].runAt)[0];
            if (!due) break;
            const [id, item] = due;
            timers.delete(id);
            now = item.runAt;
            item.fn();
        }
        now = target;
    };

    const fakeDoc = Object.assign(createNode(), {
        body: { style: {} },
        createElement: () => createNode(),
    });
    const fakeWin = Object.assign(createNode(), {
        innerHeight: 800,
        getComputedStyle: () => ({ maxHeight: '200px' }),
    });

    const prevGlobals = { document: global.document, window: global.window };
    global.document = fakeDoc;
    global.window = fakeWin;

    try {
        let hapticCount = 0;
        const Fixture = new Function(
            'i18n',
            compile(`class Fixture {
                constructor() {
                    this.disposed = false;
                    this.allDayHeight = 200;
                    this.isResizingAllDay = false;
                    this.startResizeY = 0;
                    this.startResizeHeight = 0;
                    this.lifecycle = {
                        listen: (t, type, fn) => { t.addEventListener(type, fn); return () => t.removeEventListener(type, fn); },
                        timeout: (fn, delay) => this.__setTimer(fn, delay),
                        clearTimeout: id => this.__clearTimer(id),
                        addCleanup: fn => fn,
                    };
                }
                triggerMobileTouchHaptic() { this.__onHaptic(); }
                ${methodText}
            }`) + '; return Fixture;'
        )(k => k);

        const fixture = new Fixture();
        fixture.__setTimer = (fn, delay) => { const id = nextTimerId++; timers.set(id, { fn, runAt: now + delay }); return id; };
        fixture.__clearTimer = id => timers.delete(id);
        fixture.__onHaptic = () => { hapticCount++; };

        let appendedResizer = null;
        const scroller = createNode();
        const harness = Object.assign(createNode(), {
            querySelector: () => appendedResizer,
            appendChild: child => { appendedResizer = child; return child; },
        });
        const allDayBody = {
            closest: sel => sel === '.fc-scroller' ? scroller : sel === '.fc-scroller-harness' ? harness : null,
        };
        const divider = createNode();
        const viewEl = {
            querySelector: sel => sel === '.fc-daygrid-body' ? allDayBody : sel === '.fc-timegrid-divider' ? divider : null,
        };

        fixture.setupAllDayResizer(viewEl);
        assert.ok(appendedResizer);

        const touch = y => ({
            touches: [{ identifier: 1, clientX: 100, clientY: y }],
            cancelable: true,
            prevented: false,
            stopped: false,
            preventDefault() { this.prevented = true; },
            stopImmediatePropagation() { this.stopped = true; },
        });

        // 1. 220ms 前快速滑动 -> 不进入高度调整（保留正常滚动）
        divider.dispatch('touchstart', touch(200));
        advanceBy(100);
        const fastScroll = touch(240);
        fakeDoc.dispatch('touchmove', fastScroll);
        advanceBy(200);
        assert.equal(fastScroll.prevented, false);
        assert.equal(fixture.allDayHeight, 200);

        // 2. 长按分隔线 220ms 后向下拖动 80px -> 全天高度从 200px 调整为 280px
        divider.dispatch('touchstart', touch(200));
        advanceBy(220);
        assert.equal(fixture.isResizingAllDay, true);
        assert.equal(appendedResizer.classList.contains('resizing'), true);
        assert.equal(hapticCount, 1);

        const dragMove = touch(280);
        fakeDoc.dispatch('touchmove', dragMove);
        assert.equal(dragMove.prevented, true);
        assert.equal(fixture.allDayHeight, 280);
        assert.equal(scroller.style.maxHeight, '280px');

        const dragEnd = { ...touch(280), touches: [] };
        fakeDoc.dispatch('touchend', dragEnd);
        assert.equal(fixture.isResizingAllDay, false);
        assert.equal(appendedResizer.classList.contains('resizing'), false);
    } finally {
        global.document = prevGlobals.document;
        global.window = prevGlobals.window;
    }
});

test('日历调整跨天事件长度时若 FullCalendar 传入 _def 缺失的 event，自动从 oldEvent 与 delta 还原且不报错', async () => {
    const addDurationMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'addCalendarDuration');
    const normalizeMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'normalizeCalendarMutationInfo');
    const resizeMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'handleEventResize');

    const updatedCalls = [];
    const Fixture = new Function(
        'updatedCalls',
        compile(`class Fixture {
            async refreshEvents() {}
            async updateEventTime(id, info, isResize) {
                updatedCalls.push({
                    id,
                    isResize,
                    start: info.event.start.toISOString().slice(0, 10),
                    end: info.event.end.toISOString().slice(0, 10),
                    type: info.event.extendedProps.type,
                });
            }
            ${addDurationMethod}
            ${normalizeMethod}
            ${resizeMethod}
        }`) + '; return Fixture;'
    )(updatedCalls);

    const brokenUpdatedEvent = {
        _def: undefined,
        get extendedProps() {
            return this._def.extendedProps; // 模拟 FullCalendar EventImpl.extendedProps 抛错
        },
    };
    const oldEvent = {
        id: 'task-1',
        title: '跨天任务',
        allDay: true,
        start: new Date('2026-11-20T00:00:00.000Z'),
        end: new Date('2026-11-23T00:00:00.000Z'),
        extendedProps: { type: 'task', date: '2026-11-20', endDate: '2026-11-22' },
        _def: { extendedProps: { type: 'task' } },
        _instance: { instanceId: 'inst-old' },
    };

    const fixture = new Fixture();
    await fixture.handleEventResize({
        event: brokenUpdatedEvent,
        oldEvent,
        startDelta: { years: 0, months: 0, days: 0, milliseconds: 0 },
        endDelta: { years: 0, months: 0, days: 2, milliseconds: 0 },
        revert() {},
    });

    assert.deepEqual(updatedCalls, [{
        id: 'task-1',
        isResize: true,
        start: '2026-11-20',
        end: '2026-11-25',
        type: 'task',
    }]);
});

test('移动端日历选中调整框保留 6000ms 且刷新事件后自动恢复，超时后自动取消选中', () => {
    const keepMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'keepMobileEventSelected');
    const clearMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'clearMobileEventSelection');
    const restoreMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'restoreMobileEventSelectionIfActive');
    const getSelectedMethod = extractMethod('src/components/panel/CalendarView.ts', 'CalendarView', 'getSelectedCalendarEventInstanceId');

    const timers = new Map();
    let nextId = 1;
    let now = 5000;
    const origNow = Date.now;
    Date.now = () => now;
    const advanceBy = ms => {
        const target = now + ms;
        while (true) {
            const due = [...timers.entries()].filter(([, item]) => item.runAt <= target).sort((a, b) => a[1].runAt - b[1].runAt)[0];
            if (!due) break;
            const [id, item] = due;
            timers.delete(id);
            now = item.runAt;
            item.fn();
        }
        now = target;
    };

    try {
        const actions = [];
        const currentData = {
            eventSelection: 'inst-old',
            dispatch(action) {
                actions.push(action);
                if (action.type === 'SELECT_EVENT') currentData.eventSelection = action.eventInstanceId;
                if (action.type === 'UNSELECT_EVENT') currentData.eventSelection = '';
            },
        };
        const Fixture = new Function(
            'currentData',
            compile(`class Fixture {
                constructor() {
                    this.isDragging = false;
                    this.mobileSelectedEventId = null;
                    this.mobileSelectedEventUntil = 0;
                    this.mobileSelectionExpireTimer = 0;
                    this.calendar = {
                        currentData,
                        getEventById: id => id === 'ev1' ? { id: 'ev1', _instance: { instanceId: 'inst-new' }, _context: currentData } : null,
                    };
                    this.lifecycle = {
                        timeout: (fn, delay) => this.__setTimer(fn, delay),
                        clearTimeout: id => this.__clearTimer(id),
                    };
                }
                ${getSelectedMethod}
                ${keepMethod}
                ${clearMethod}
                ${restoreMethod}
            }`) + '; return Fixture;'
        )(currentData);

        const fixture = new Fixture();
        fixture.__setTimer = (fn, delay) => { const id = nextId++; timers.set(id, { fn, runAt: now + delay }); return id; };
        fixture.__clearTimer = id => timers.delete(id);

        // 1. 选中事件后，即使经过 1500ms 且底层刷新产生了新 instanceId，仍自动恢复选中调整框
        fixture.keepMobileEventSelected('ev1');
        advanceBy(1500);
        currentData.eventSelection = '';
        fixture.restoreMobileEventSelectionIfActive();
        assert.equal(currentData.eventSelection, 'inst-new');

        // 2. 满 6000ms 无操作后自动取消选中
        advanceBy(4500);
        assert.equal(currentData.eventSelection, '');
        assert.equal(actions.at(-1).type, 'UNSELECT_EVENT');
    } finally {
        Date.now = origNow;
    }
});
