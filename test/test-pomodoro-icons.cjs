const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const iconsModule = { exports: {} };
new Function('module', 'exports', compile(fs.readFileSync(
    path.join(root, 'src/components/render/pomodoroIcons.ts'), 'utf8'
)))(iconsModule, iconsModule.exports);
const icons = iconsModule.exports;

const source = fs.readFileSync(path.join(root, 'src/components/panel/PomodoroTimer.ts'), 'utf8');
const ast = ts.createSourceFile('PomodoroTimer.ts', source, ts.ScriptTarget.Latest, true);
const timer = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const method = timer.members.find(node => node.name?.getText(ast) === 'generateBrowserWindowHTML');
const Timer = new Function('i18n', ...Object.keys(icons), `${compile(`class Timer { ${method.getText(ast)} }`)}; return Timer;`)(
    key => key, ...Object.values(icons)
);

function fixture(style = 'ring', state = {}) {
    const subject = Object.assign(new Timer(), {
        settings: { pomodoroDockPosition: 'right', workDuration: 25, breakDuration: 5, longBreakDuration: 15 },
        getMiniWindowStyle: () => style,
        getDockPositionEmoji: () => '➡️',
    });
    const html = subject.generateBrowserWindowHTML('action', 'control', {
        isWorkPhase: true, isRunning: true, isPaused: false, completedPomodoros: 2, timeLeft: 1500, totalTime: 1500,
        ...state
    }, '25:00', 'work', '1h', '2h', '#fff', '#222', '#eee', '#ccc', '#ddd', '#eee',
    '<task & title>', false, true, 3, '#7c7', 0, 'sans-serif', '');
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    return { html, script };
}

function element() {
    let markup = '', writes = 0;
    const attributes = new Map();
    return {
        style: {}, classList: { toggle() {} }, textContent: '',
        getAttribute: key => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
        get innerHTML() { return markup; },
        set innerHTML(value) { markup = value; writes++; },
        get writes() { return writes; },
    };
}

test('all icon states use self-contained colored SVG and preserve label escaping', () => {
    for (const [key, svg] of Object.entries(icons.POMODORO_ICON_SVGS)) {
        assert.equal(icons.renderPomodoroIcons(key), svg, key);
        assert.match(svg, /<svg[^>]*viewBox="0 0 24 24"/);
        assert.match(svg, /(?:fill|stroke)="#[0-9a-f]+"/i);
        assert.doesNotMatch(svg, /<image|<use|https?:\/\/(?!www\.w3\.org)/);
    }
    const html = icons.renderPomodoroIcons('▶️ <task & "name">');
    assert.match(html, /<svg/);
    assert.match(html, /&lt;task &amp; &quot;name&quot;&gt;/);
    assert.doesNotMatch(html, /▶️|<task/);
    for (const emoji of ['🍅', '🍵', '🧘', '🧘‍♀️', '💪', '⏱', '⏱️', '🎲']) {
        assert.equal(icons.renderPomodoroIcons(emoji), emoji);
    }
});

test('titlebar controls use monochrome Lucide-style SVG while phase icons remain emoji', () => {
    for (const [key, svg] of Object.entries(icons.POMODORO_TOOLBAR_ICON_SVGS)) {
        assert.equal(icons.renderPomodoroToolbarIcon(key), svg);
        assert.match(svg, /stroke="currentColor"/);
        assert.doesNotMatch(svg, /(?:fill|stroke)="#/);
    }
    const { html } = fixture();
    const toolbar = html.slice(html.indexOf('<div class="custom-titlebar">'), html.indexOf('<div class="pomodoro-content">'));
    assert.match(toolbar, /<svg/);
    assert.doesNotMatch(toolbar, /(?:fill|stroke)="#/);
    assert.equal(icons.renderPomodoroIcons('🍅'), '🍅');
});

test('repeated timer ticks reuse the icon DOM; state changes replace the graphic', () => {
    const node = element();
    icons.setPomodoroIcon(node, '▶️');
    icons.setPomodoroIcon(node, '▶️');
    assert.equal(node.writes, 1);
    icons.setPomodoroIcon(node, '⏸');
    assert.equal(node.writes, 2);
    assert.equal(node.innerHTML, icons.POMODORO_ICON_SVGS['⏸']);
    icons.setPomodoroIcon(null, '🎲');
});

test('production minification preserves the self-contained renderer injected into independent windows', async () => {
    const { transformWithEsbuild } = await import('vite');
    const { code } = await transformWithEsbuild(fs.readFileSync(
        path.join(root, 'src/components/render/pomodoroIcons.ts'), 'utf8'
    ), 'pomodoroIcons.ts', { minify: true, format: 'cjs', target: 'es2020' });
    const compiledModule = { exports: {} };
    new Function('module', 'exports', code)(compiledModule, compiledModule.exports);
    const factory = compiledModule.exports.createPomodoroIconRenderer;
    const context = vm.createContext({});
    vm.runInContext(`const renderer = (${factory.toString()})(${JSON.stringify(icons.POMODORO_ICON_SVGS)});`, context);
    assert.equal(vm.runInContext("renderer.html('▶️')", context), icons.POMODORO_ICON_SVGS['▶️']);
});

test('normal and all mini layouts contain SVG controls and executable standalone scripts', () => {
    for (const style of ['ring', 'horizontal', 'minimal']) {
        for (const state of [{}, { isCountUp: true }, { isWorkPhase: false }, { isWorkPhase: false, isLongBreak: true }]) {
            const { html, script } = fixture(style, state);
            new vm.Script(script);
            const body = html.split('<body')[1].split('<script>')[0];
            assert.doesNotMatch(body, /⏹|▶️|🔊|📌/);
            assert.match(body, /id="diceIcon"[^>]*>🎲<\/span>/);
            const phase = state.isWorkPhase === false ? (state.isLongBreak ? '🧘' : '🍵') : (state.isCountUp ? '⏱' : '🍅');
            for (const id of ['statusIcon', 'miniStatusTrigger']) {
                assert.match(body, new RegExp(`id="${id}"[^>]*>${phase}</`));
            }
            for (const id of ['ringPlayPauseBtn', 'miniPlayPauseBtn',
                'stopBtn', 'miniStopBtn', 'miniMinimalStopBtn', 'soundBtn', 'pinBtn', 'dockBtn']) {
                assert.match(body, new RegExp(`id="${id}"[^>]*>[\\s\\S]*?<svg`), `${style}: ${id}`);
            }
            assert.match(body, /&lt;task &amp; title&gt;/);
        }
    }
});

test('standalone render preserves phase emoji and SVG controls during state updates', () => {
    const { script } = fixture();
    const runtime = ts.createSourceFile('renderer.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const functions = runtime.statements.filter(node => ts.isFunctionDeclaration(node) &&
        ['render', 'formatTime', 'calculateProgress', 'updateVolumeMenuUI'].includes(node.name.text)).map(node => node.getText(runtime)).join('\n');
    const bootstrap = script.slice(0, script.indexOf("const { ipcRenderer }"));
    const nodes = new Map();
    const document = {
        body: element(),
        getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
        querySelector() { return null; },
    };
    const context = vm.createContext({ document,
        settings: { workDuration: 25, breakDuration: 5, longBreakDuration: 15, pomodoroDockPosition: 'right' },
        localState: { isRunning: true, isWorkPhase: true, timeLeft: 1500, totalTime: 1500,
            workVolume: 0.5, breakVolume: 0.5, longBreakVolume: 0.5 },
        isVolumeSliderDragging: false,
        applyMiniStyleClass() {}, applyMiniResponsiveVars() {}, applyNormalResponsiveLayout() {},
    });
    vm.runInContext(bootstrap + functions, context);
    const steps = [
        [{}, '🍅', '⏸'],
        [{ isPaused: true }, '🍅', '▶️'],
        [{ isPaused: false, isWorkPhase: false }, '🍵', '⏸'],
        [{ isLongBreak: true }, '🧘', '⏸'],
        [{ isWorkPhase: true, isCountUp: true }, '⏱', '⏸'],
    ];
    for (const [state, status, play] of steps) {
        Object.assign(context.localState, state);
        vm.runInContext('render()', context);
        for (const id of ['statusIcon', 'miniStatusTrigger']) assert.equal(nodes.get(id).innerHTML, status);
        for (const id of ['ringPlayPauseBtn', 'miniPlayPauseBtn', 'miniMinimalPlayPauseBtn']) assert.equal(nodes.get(id).innerHTML, icons.POMODORO_ICON_SVGS[play]);
        assert.equal(nodes.get('dockBtn').innerHTML, icons.POMODORO_TOOLBAR_ICON_SVGS['➡️']);
        assert.equal(nodes.get('soundBtn').innerHTML, icons.POMODORO_TOOLBAR_ICON_SVGS['🔊']);
    }
    context.localState.isBackgroundAudioMuted = true;
    context.settings.pomodoroDockPosition = 'top';
    vm.runInContext('render()', context);
    assert.equal(nodes.get('soundBtn').innerHTML, icons.POMODORO_TOOLBAR_ICON_SVGS['🔇']);
    assert.equal(nodes.get('volumeMuteBtn').innerHTML, icons.POMODORO_ICON_SVGS['🔇']);
    assert.equal(nodes.get('dockBtn').innerHTML, icons.POMODORO_TOOLBAR_ICON_SVGS['⬆️']);
    const node = nodes.get('statusIcon');
    const writes = node.writes;
    vm.runInContext('render()', context);
    assert.equal(node.writes, writes);
});
