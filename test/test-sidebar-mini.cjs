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

    const makeEl = (initialAttrs = {}) => {
        const attrs = new Map(Object.entries(initialAttrs));
        const classes = new Set();
        return {
            dataset: {},
            attrs,
            classes,
            classList: { add: (...names) => names.forEach(name => classes.add(name)) },
            getAttribute: name => attrs.get(name) ?? null,
            setAttribute: (name, value) => attrs.set(name, String(value)),
            removeAttribute: name => attrs.delete(name),
            querySelector: () => null,
        };
    };

    const titleEl = makeEl({ 'aria-label': '打开绑定块: 测试任务' });
    const timeEl = makeEl({ 'aria-label': '今天 · 点击修改时间', title: '今天' });
    const row = makeEl();
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

    assert.ok(row.dataset.miniTaskTooltip.includes('<span>2026-11-21</span>'));
    assert.ok(!row.dataset.miniTaskTooltip.includes('2026-11-21 ~ 2026-11-21'));
    assert.ok(row.dataset.miniTaskTooltip.includes('周报文档'));
    assert.equal(titleEl.getAttribute('aria-label'), '打开绑定块: 测试任务');
    assert.equal(timeEl.getAttribute('aria-label'), '今天 · 点击修改时间');
    assert.equal(timeEl.getAttribute('title'), null);
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
