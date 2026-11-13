// pnpm exec node --test scripts/test-pomodoro-audio-start.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8');
const ast = ts.createSourceFile('PomodoroTimer.ts', source, ts.ScriptTarget.Latest, true);
const timerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const names = ['initAudio', 'preloadBrowserWindowBackgroundAudio', 'playSoundInBrowserWindow', 'getAudioDataUrlForBW'];
const methods = timerClass.members.filter(node => names.includes(node.name?.getText(ast)))
    .map(node => node.getText(ast)).join('\n');
const code = ts.transpileModule(`class PomodoroTimer { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
    const elements = new Map();
    const requests = [];
    let loadCalls = 0, playCalls = 0;
    class Audio extends EventTarget {
        paused = true;
        readyState = 0;
        networkState = 0;
        currentTime = 0;
        load() { loadCalls++; this.networkState = 2; }
        pause() { this.paused = true; }
        play() { playCalls++; this.paused = false; return Promise.resolve(); }
        finishLoading() { this.readyState = 2; this.dispatchEvent(new Event('loadeddata')); }
    }
    const context = vm.createContext({
        window: { pomodoroAudioGeneration: 1 },
        document: {
            body: { appendChild(audio) { elements.set(audio.id, audio); } },
            getElementById: id => elements.get(id),
            createElement: () => new Audio()
        },
        setTimeout: () => 1, clearTimeout() {}
    });
    const owner = { isDestroyed: () => false,
        webContents: { executeJavaScript: async script => vm.runInContext(script, context) } };
    const Timer = new Function('window', 'resolveAudioPath', 'console', `${code}; return PomodoroTimer;`)(
        { require() {} }, async src => src, { warn() {} });
    const timer = Object.assign(new Timer(), {
        settings: {}, audioPlaybackGeneration: 1,
        bwAudioDataUrlCache: new Map(), bwAudioDataUrlRequests: new Map(),
        workAudio: { src: 'blob:work' }, breakAudio: { src: 'blob:break' }, longBreakAudio: { src: 'blob:longBreak' },
        async fetchAudioDataUrlForBW(src) {
            requests.push(src);
            const dataUrl = 'data:audio/wav;base64,' + Buffer.from(src).toString('base64');
            this.bwAudioDataUrlCache.set(src, dataUrl);
            return dataUrl;
        }
    });
    Timer.browserWindowInstance = owner;
    Timer.browserWindowTimer = timer;
    Timer.bwAudioPlaybackGeneration = 1;
    return { timer, Timer, owner, elements, requests,
        get loadCalls() { return loadCalls; }, get playCalls() { return playCalls; } };
}

test('窗口预加载三个阶段背景音且保持静音，开始时直接复用已加载元素', async () => {
    const f = fixture();
    await f.timer.preloadBrowserWindowBackgroundAudio(f.owner);
    assert.equal(f.elements.size, 3);
    assert.equal(f.loadCalls, 3);
    assert.equal(f.playCalls, 0);
    for (const audio of f.elements.values()) audio.finishLoading();
    assert.equal(await f.timer.playSoundInBrowserWindow('blob:work', { loop: true, volume: 0.4 }), true);
    assert.equal(f.playCalls, 1);
    assert.equal(f.loadCalls, 3, '开始时不能重新加载已预加载的背景音');
    assert.equal(f.requests.length, 3, '开始时不能重新读取和转换音频');
    const work = [...f.elements.values()][0];
    assert.equal(work.loop, true);
    assert.equal(work.volume, 0.4);
    await f.timer.preloadBrowserWindowBackgroundAudio(f.owner);
    assert.equal(work.paused, false, '重复预加载不能打断正在播放的声音');
    assert.equal(f.loadCalls, 3);
});

test('预加载仍在读取数据时点击开始，共享加载进度而不重新 load', async () => {
    const f = fixture();
    f.timer.breakAudio = f.timer.longBreakAudio = null;
    await f.timer.preloadBrowserWindowBackgroundAudio(f.owner);
    const playing = f.timer.playSoundInBrowserWindow('blob:work', { loop: true });
    await flush();
    assert.equal(f.loadCalls, 1);
    assert.equal(f.playCalls, 0);
    [...f.elements.values()][0].finishLoading();
    assert.equal(await playing, true);
    assert.equal(f.playCalls, 1);
});

test('等待预加载时暂停或结束，加载完成不能重新响起', async () => {
    const f = fixture();
    f.timer.breakAudio = f.timer.longBreakAudio = null;
    await f.timer.preloadBrowserWindowBackgroundAudio(f.owner);
    const playing = f.timer.playSoundInBrowserWindow('blob:work', { loop: true });
    await flush();
    f.timer.audioPlaybackGeneration++;
    f.Timer.bwAudioPlaybackGeneration++;
    // 实际 stopAllAudio 同步更新子窗口播放代次；这里通过窗口脚本模拟该动作。
    await f.owner.webContents.executeJavaScript('window.pomodoroAudioGeneration = 2');
    [...f.elements.values()][0].finishLoading();
    assert.equal(await playing, false);
    assert.equal(f.playCalls, 0);
});

test('窗口已经换任务时，旧实例异步预加载不能写入新任务窗口', async () => {
    const f = fixture();
    let release;
    f.timer.getAudioDataUrlForBW = () => new Promise(resolve => { release = resolve; });
    f.timer.breakAudio = f.timer.longBreakAudio = null;
    const loading = f.timer.preloadBrowserWindowBackgroundAudio(f.owner);
    f.Timer.browserWindowTimer = {};
    release('data:audio/wav;base64,AAAA');
    await loading;
    assert.equal(f.elements.size, 0);
});

test('关闭结束弹窗设置时也提前转换背景音，不依赖首次播放触发', async () => {
    const f = fixture();
    f.timer.settings = { workSound: 'work', breakSound: 'break', longBreakSound: 'longBreak' };
    f.timer.createPreloadedAudio = async src => src ? { src: 'blob:' + src } : null;
    f.timer.preloadAudioBuffer = async () => null;
    await f.timer.initAudio();
    await flush();
    assert.deepEqual(f.requests.sort(), ['blob:break', 'blob:longBreak', 'blob:work']);
});
