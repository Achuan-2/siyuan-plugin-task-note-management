const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/components/panel/PomodoroTimer.ts');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const names = ['getPomodoroCategoryText', 'updatePomodoroCategoryDisplay', 'selectPomodoroCategory', 'openPomodoroCategoryMenu'];
const code = ts.transpileModule(`class PomodoroTimer { ${declaration.members.filter(node => names.includes(node.name?.getText(ast))).map(node => node.getText(ast)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const categories = [{ id: 'pc_work', name: '工作分类', color: '#123456' }, { id: 'pc_break', name: '休息分类', color: '#654321' }];
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
function fixture(native = false, hostMenuZIndex) {
    const menus = [], messages = [], writes = [], events = [], focusChanges = [];
    class Menu {
        constructor(_id, close) { this.items = []; this.closeCallback = close; this.element = { style: {} }; menus.push(this); }
        addItem(item) { this.items.push(item); }
        append(item) { this.items.push(item); }
        addSeparator() { this.items.push({ type: 'separator' }); }
        open(position) { this.position = position; if (hostMenuZIndex !== undefined) this.element.style.zIndex = String(hostMenuZIndex); }
        popup(options) { this.options = options; }
        close() { this.closeCallback?.(); }
    }
    const label = { textContent: '' }, properties = {};
    const button = {
        querySelector: () => label, style: { setProperty: (key, value) => properties[key] = value },
        setAttribute(key, value) { this[key] = value; }, getBoundingClientRect: () => ({ left: 100, bottom: 60 }),
    };
    const remote = {
        Menu, MenuItem: class { constructor(item) { Object.assign(this, item); } },
        getCurrentWindow: () => ({ show: () => focusChanges.push('show'), focus: () => focusChanges.push('focus') }),
    };
    const window = { require: () => remote, dispatchEvent: event => events.push(event.type) };
    const Timer = new Function('Menu', 'window', 'loadPomodoroCategories', 'i18n', 'showMessage', 'CustomEvent', 'console', `${code}; return PomodoroTimer;`)(
        Menu, window, async () => categories, key => key, key => messages.push(key), class { constructor(type) { this.type = type; } }, { error() {} },
    );
    const owner = { webContents: {}, isDestroyed: () => false, setAlwaysOnTop: () => focusChanges.push('pin') };
    const timer = Object.assign(new Timer(), {
        plugin: {}, reminder: { id: 'task' }, pomodoroCategories: categories,
        isWorkPhase: true, phaseStartTime: 1000, isWindowClosed: false, categorySelectionPending: false,
        workCategoryId: 'pc_work', breakCategoryId: undefined, activeWorkSessionId: 'active-session',
        container: native ? owner : { querySelector: () => button },
        recordManager: { updateSessionCategory: async (...args) => { writes.push(args); return true; } },
        updateBrowserWindowDisplay() {}, managePomodoroCategories: async () => { focusChanges.push('manage'); },
        resolveSwitchMenuZIndex: () => 101,
    });
    Timer.browserWindowInstance = native ? owner : null;
    return { timer, menus, messages, writes, events, focusChanges, button, label, properties, owner, phase: { work: true, start: 1000, eventId: 'task' } };
}

test('紧凑标签只显示分类名，完整说明保留在辅助标签中', () => {
    const f = fixture();
    f.timer.updatePomodoroCategoryDisplay();
    assert.equal(f.label.textContent, '工作分类');
    assert.equal(f.button['aria-label'], 'pomodoroCategory: 工作分类');
    assert.equal(f.properties['--pomodoro-category-color'], '#123456');
    f.timer.isWorkPhase = false;
    f.timer.updatePomodoroCategoryDisplay();
    assert.equal(f.label.textContent, 'uncategorized');
});

test('分类菜单保留宿主较高的层级，避免移动端遮罩拦截触摸', async () => {
    for (const [hostZIndex, expectedZIndex] of [[1002, '1002'], [20, '101']]) {
        const f = fixture(false, hostZIndex);
        await f.timer.openPomodoroCategoryMenu(f.button);
        assert.equal(f.menus[0].element.style.zIndex, expectedZIndex);
    }
});

for (const native of [false, true]) test(`${native ? '独立窗口原生' : '普通窗口'}菜单单选立即保存，不激活主窗口或改变置顶`, async () => {
    const f = fixture(native);
    await f.timer.openPomodoroCategoryMenu(f.button);
    const menu = f.menus[0];
    assert.equal(menu.items.length, 5);
    assert.deepEqual(menu.items.slice(0, 3).map(item => item.checked), [false, true, false]);
    if (native) {
        assert.equal(menu.options.window, f.owner);
        assert.ok(menu.items.slice(0, 3).every(item => item.type === 'radio'));
    } else {
        assert.deepEqual(menu.position, { x: 100, y: 60 });
        assert.equal(menu.element.style.zIndex, '101');
    }
    await menu.items[2].click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.timer.workCategoryId, 'pc_break');
    assert.deepEqual(f.writes, [['active-session', 'pc_break']]);
    assert.deepEqual(f.focusChanges, []);
    assert.deepEqual(f.events, ['reminderUpdated']);
    await menu.items.at(-1).click();
    assert.deepEqual(f.focusChanges, ['manage']);
});

test('休息选择独立保存，不修改工作记录；菜单过期后拒绝应用到新阶段', async () => {
    const f = fixture();
    f.timer.isWorkPhase = false;
    await f.timer.openPomodoroCategoryMenu(f.button);
    await f.menus[0].items[2].click();
    assert.equal(f.timer.breakCategoryId, 'pc_break');
    assert.equal(f.timer.workCategoryId, 'pc_work');
    assert.deepEqual(f.writes, []);
    f.timer.isWorkPhase = true;
    await f.menus[0].items[0].click();
    assert.deepEqual(f.messages, ['pomodoroCategoryPhaseChanged']);
    assert.equal(f.timer.workCategoryId, 'pc_work');
});

test('记录尚未创建完成时等待原 ID，保存期间拒绝重复点击，失败后恢复原分类', async () => {
    const f = fixture(), creating = deferred(), saving = deferred();
    f.timer.activeWorkSessionId = null;
    f.timer.activeWorkSessionStartPromise = creating.promise;
    f.timer.recordManager.updateSessionCategory = (...args) => { f.writes.push(args); return saving.promise; };
    const pending = f.timer.selectPomodoroCategory('pc_break', f.phase);
    assert.equal(f.timer.categorySelectionPending, true);
    assert.equal(f.button.disabled, true);
    await f.timer.selectPomodoroCategory(undefined, f.phase);
    assert.equal(f.timer.workCategoryId, 'pc_break');
    creating.resolve('created-session');
    await Promise.resolve();
    assert.deepEqual(f.writes, [['created-session', 'pc_break']]);
    saving.reject(new Error('disk error'));
    await pending;
    assert.equal(f.timer.workCategoryId, 'pc_work');
    assert.equal(f.timer.categorySelectionPending, false);
    assert.equal(f.button.disabled, false);
    assert.deepEqual(f.messages, ['operationFailed']);
});
