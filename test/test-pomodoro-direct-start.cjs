const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8'
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function fixture({ isCountUp = false, inheritState } = {}) {
    const audioReady = deferred();
    const intervals = new Map();
    const sessions = [];
    const messages = [];
    let nextInterval = 0;
    let now = 1000000;
    let windowsCreated = 0;
    class Clock extends Date { static now() { return now; } }
    const manager = {
        initialize: async () => {},
        startWorkSession: async (...args) => { sessions.push(args); return 'session-1'; }
    };
    const dependencies = {
        siyuan: { showMessage: (...args) => messages.push(args) },
        '../dataManager/pomodoroRecord': { PomodoroRecordManager: { getInstance: () => manager } },
        '../../pluginInstance': { i18n: key => key }
    };
    const module = { exports: {} };
    const window = {
        dispatchEvent() {},
        setInterval: callback => { intervals.set(++nextInterval, callback); return nextInterval; }
    };
    new Function('require', 'module', 'exports', 'window', 'clearInterval', 'Date', 'CustomEvent', compiled)(
        name => dependencies[name] || {}, module, module.exports, window,
        id => intervals.delete(id), Clock, class CustomEvent {}
    );
    const { PomodoroTimer } = module.exports;
    for (const method of ['initSystemNotification', 'attachAudioUnlockListeners',
        'findAndAttachOrphanedWindow', 'updateStatsDisplay', 'updateDisplay',
        'closePomodoroEndWindow', 'startRandomRestTimer', 'scheduleAllMobileNotifications',
        'recordPartialWorkSession']) {
        PomodoroTimer.prototype[method] = () => {};
    }
    PomodoroTimer.prototype.initAudio = () => audioReady.promise;
    PomodoroTimer.prototype.createWindow = async function () {
        windowsCreated++;
        this.container = {};
    };
    PomodoroTimer.prototype.initializeAudioPlayback = async () => {};
    const timer = new PomodoroTimer({ id: 'task', title: 'Task' }, {
        workDuration: 25, breakDuration: 5, longBreakDuration: 15
    }, isCountUp, inheritState);
    return { timer, sessions, intervals, messages, audioReady,
        get windowsCreated() { return windowsCreated; },
        advance(seconds) {
            now += seconds * 1000;
            for (const tick of intervals.values()) tick();
        }
    };
}

for (const isCountUp of [false, true]) {
    test(`${isCountUp ? '正计时' : '番茄钟'}打开后直接运行并创建专注记录`, async () => {
        const view = fixture({ isCountUp });
        const started = view.timer.show();
        view.audioReady.resolve();
        await started;
        assert.equal(view.timer.isRunning, true);
        assert.equal(view.timer.isPaused, false);
        assert.equal(view.intervals.size, 1);
        assert.equal(view.sessions.length, 1);
        assert.equal(view.sessions[0][3], isCountUp);
        view.advance(2);
        if (isCountUp) assert.equal(view.timer.timeElapsed, 2);
        else assert.equal(view.timer.timeLeft, 25 * 60 - 2);
    });
}

test('初始化未完成时等待准备就绪，再启动一次', async () => {
    const view = fixture();
    const first = view.timer.show();
    const second = view.timer.show();
    await Promise.resolve();
    assert.equal(view.timer.isRunning, false);
    assert.equal(view.windowsCreated, 0);
    assert.equal(view.sessions.length, 0);
    view.audioReady.resolve();
    await Promise.all([first, second]);
    assert.equal(view.windowsCreated, 1);
    assert.equal(view.sessions.length, 1);
    assert.equal(view.intervals.size, 1);
});

test('重复显示不会重置进度，也不会恢复用户之后暂停的计时', async () => {
    const view = fixture();
    view.audioReady.resolve();
    await view.timer.show();
    view.advance(3);
    await view.timer.show();
    assert.equal(view.timer.timeLeft, 25 * 60 - 3);
    view.intervals.clear();
    view.timer.timer = null;
    view.timer.isPaused = true;
    await view.timer.show();
    assert.equal(view.timer.isPaused, true);
    assert.equal(view.intervals.size, 0);
    assert.equal(view.sessions.length, 1);
});

test('初始化期间关闭后，不再创建窗口或启动计时', async () => {
    const view = fixture();
    const started = view.timer.show();
    view.timer.isWindowClosed = true;
    view.audioReady.resolve();
    await started;
    assert.equal(view.windowsCreated, 0);
    assert.equal(view.timer.isRunning, false);
    assert.equal(view.sessions.length, 0);
    assert.equal(view.intervals.size, 0);
});

test('确认切换后继承剩余进度并直接计时', async () => {
    const view = fixture({ inheritState: {
        isRunning: true, isPaused: false, isWorkPhase: true, isLongBreak: false,
        reminderId: 'previous-task', timeLeft: 600, timeElapsed: 900
    } });
    view.audioReady.resolve();
    await view.timer.show();
    assert.equal(view.timer.timeLeft, 600);
    assert.equal(view.intervals.size, 1);
    view.advance(2);
    assert.equal(view.timer.timeLeft, 598);
});

test('用户已手动启动时，自动启动入口不重复启动', async () => {
    const view = fixture();
    view.audioReady.resolve();
    await view.timer.componentsReady;
    await view.timer.startTimer();
    view.advance(2);
    await view.timer.show();
    assert.equal(view.timer.timeLeft, 25 * 60 - 2);
    assert.equal(view.sessions.length, 1);
    assert.equal(view.intervals.size, 1);
});
