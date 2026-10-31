// pnpm exec node --test scripts/test-pomodoro-phase-menu.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8');
const ast = ts.createSourceFile('PomodoroTimer.ts', source, ts.ScriptTarget.Latest, true);
const timerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const names = ['showNativePhaseMenuPopup', 'hideNativePhaseMenuPopup', 'callMethod'];
const methods = timerClass.members.filter(node => names.includes(node.name?.getText(ast)))
    .map(node => node.getText(ast)).join('\n');
const hostCode = ts.transpileModule(`class PomodoroTimer { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const rendererCode = source.slice(source.indexOf('        let phaseMenuOpen ='),
    source.indexOf("        document.addEventListener('click', e =>", source.indexOf('        let phaseMenuOpen =')))
    .replaceAll('${actionChannel}', 'pomodoro-action-test');

function fixture({ failPopup = false } = {}) {
    const requests = [];
    const menus = [];
    const actions = [];
    const errors = [];
    const elements = new Map();
    const element = (id, rect = {}) => {
        const classes = new Set(['show']);
        const attributes = {};
        const node = {
            attributes,
            classList: {
                contains: name => classes.has(name),
                remove: name => classes.delete(name),
                add: name => classes.add(name)
            },
            setAttribute: (name, value) => { attributes[name] = value; },
            getBoundingClientRect: () => rect,
            closest: selector => selector.includes(`#${id}`) ? node : null
        };
        elements.set(id, node);
        return node;
    };
    const root = element('switchMenu', { right: 188 });
    const trigger = element('phaseMenuTrigger', { top: 68 });
    const body = element('body');
    let hit = root;
    const context = vm.createContext({
        window: { addEventListener() {} },
        document: { body, getElementById: id => elements.get(id), elementFromPoint: () => hit },
        ipcRenderer: { send: (...args) => requests.push(args) }
        // 故意不提供 remote：番茄钟子窗口没有启用 remote 时仍须能够展开菜单。
    });
    vm.runInContext(rendererCode, context);
    const owner = {
        isDestroyed: () => false,
        getContentBounds: () => ({ x: 100, y: 200 }),
        webContents: {
            getZoomFactor: () => 1.5,
            executeJavaScript: script => { vm.runInContext(script, context); return Promise.resolve(); }
        }
    };
    const remote = {
        screen: { getCursorScreenPoint: () => ({ x: 250, y: 350 }) },
        Menu: { buildFromTemplate: items => {
            const menu = {
                items,
                popup(options) {
                    if (failPopup) throw new Error('popup failed');
                    this.options = options;
                },
                closePopup() { this.options?.callback(); }
            };
            menus.push(menu);
            return menu;
        } }
    };
    const Timer = new Function('window', 'i18n', 'console', `${hostCode}; return PomodoroTimer;`)(
        { require: () => remote }, key => key, { error: (...args) => errors.push(args) }
    );
    Timer.browserWindowInstance = owner;
    const timer = new Timer();
    for (const method of ['startWorkTime', 'startShortBreak', 'startLongBreak']) timer[method] = () => actions.push(method);
    const flush = () => {
        for (const [, method, ...args] of requests.splice(0)) timer.callMethod(method, ...args);
    };
    return { context, root, trigger, menus, actions, errors, owner, flush,
        open() { vm.runInContext('showPhaseMenu()', context); flush(); },
        close() { vm.runInContext('closeSwitchMenu()', context); flush(); },
        hitOutside() { hit = null; }
    };
}

test('子窗口无 remote 时，通过 IPC 展开原生二级菜单，保持一级菜单并适配缩放', () => {
    const view = fixture();
    view.open();
    assert.equal(view.menus.length, 1);
    assert.equal(view.menus[0].items.length, 3);
    assert.equal(view.menus[0].options.window, view.owner);
    assert.equal(view.menus[0].options.x, 285);
    assert.equal(view.menus[0].options.y, 102);
    assert.equal(view.root.classList.contains('show'), true);
    assert.equal(view.trigger.attributes['aria-expanded'], 'true');
    view.open();
    assert.equal(view.menus.length, 1);
});

for (const [index, method] of ['startWorkTime', 'startShortBreak', 'startLongBreak'].entries()) {
    test(`二级菜单正确执行 ${method} 并关闭菜单`, () => {
        const view = fixture();
        view.open();
        view.menus[0].items[index].click();
        view.menus[0].options.callback();
        assert.deepEqual(view.actions, [method]);
        assert.equal(view.root.classList.contains('show'), false);
        assert.equal(view.trigger.attributes['aria-expanded'], 'false');
    });
}

test('取消二级菜单后可重新展开，过期回调不影响新菜单', () => {
    const view = fixture();
    view.open();
    const first = view.menus[0];
    first.options.callback();
    assert.equal(view.root.classList.contains('show'), true);
    view.open();
    first.options.callback();
    assert.equal(view.trigger.attributes['aria-expanded'], 'true');
    view.close();
    assert.equal(view.trigger.attributes['aria-expanded'], 'false');
    assert.equal(view.root.classList.contains('show'), false);
});

test('原生菜单关闭回调早于选择回调时，选择状态仍会关闭一级菜单', () => {
    const view = fixture();
    view.open();
    view.menus[0].options.callback();
    view.menus[0].items[1].click();
    assert.deepEqual(view.actions, ['startShortBreak']);
    assert.equal(view.root.classList.contains('show'), false);
});

test('点击窗口外空白处同时关闭两级菜单', () => {
    const view = fixture();
    view.open();
    view.hitOutside();
    view.menus[0].options.callback();
    assert.equal(view.root.classList.contains('show'), false);
});

test('原生菜单创建失败后恢复展开状态，允许再次尝试', () => {
    const view = fixture({ failPopup: true });
    view.open();
    assert.equal(view.trigger.attributes['aria-expanded'], 'false');
    assert.equal(view.errors.length, 1);
    view.open();
    assert.equal(view.menus.length, 2);
});
