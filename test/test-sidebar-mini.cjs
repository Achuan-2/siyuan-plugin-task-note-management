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

test('迷你习惯的七天范围包含今天，跨月和跨年也不会变成自然周', () => {
    const methodText = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'getMiniCheckInStartDate');
    const Fixture = new Function('getLogicalDateString', compile(
        `class Fixture { ${methodText} }`
    ) + '; return Fixture;')(() => '2026-11-17');
    const fixture = new Fixture();
    for (const [today, first] of [
        ['2026-11-17', '2026-11-11'], ['2026-12-02', '2026-11-26'], ['2027-01-02', '2026-12-27'],
    ]) {
        const start = fixture.getMiniCheckInStartDate(today);
        const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        assert.equal(localDate(start), first);
        start.setDate(start.getDate() + 6);
        assert.equal(localDate(start), today);
    }
    assert.equal(fixture.getMiniCheckInStartDate().getDate(), 11);
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
    const startMethod = extractMethod('src/components/panel/HabitPanel.ts', 'HabitPanel', 'getMiniCheckInStartDate');
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
            constructor() { this.container = {}; this.plugin = {}; }
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
    // 2026-11-16（倒数第二天）：30/30 达标但无 checkIns，应显示完成态和番茄图标，而非 × / 未打卡
    assert.deepEqual(ringCalls[5], { percentage: 100, symbols: ['🍅'] });
    assert.equal(createdButtons[5].classList.contains('habit-card__week-day--done'), true);
    assert.equal(createdButtons[5].classList.contains('habit-mini__day--recorded'), true);
    assert.ok(createdButtons[5].title.includes('habitWeekCompleted'));

    // 2026-11-17（今天）：15/30 未达标但有番茄进度，应显示半完成态和番茄图标，而非 ○ / 未打卡
    assert.deepEqual(ringCalls[6], { percentage: 50, symbols: ['🍅'] });
    assert.equal(createdButtons[6].classList.contains('habit-mini__day--recorded'), true);
    assert.equal(createdButtons[6].classList.contains('habit-mini__day--partial'), true);
    assert.ok(createdButtons[6].title.includes('habitWeekIncomplete'));

    // 点击日期按钮弹出菜单：应包含查看/编辑当日记录入口，且不以分隔线开头
    createdButtons[6].listeners.get('click')({ stopPropagation: () => {} });
    assert.equal(openedMenus.length, 1);
    assert.notEqual(openedMenus[0].items[0].type, 'separator');
    const viewRecordsItem = openedMenus[0].items.find(item => item.label === 'habitMiniViewDayRecords');
    assert.ok(viewRecordsItem);
    viewRecordsItem.click();
    assert.equal(openedDialogDate, '2026-11-17');
});
