const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
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
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ browserWindow = false, waitForLoad = false, abortPlay = false } = {}) {
    const timeouts = new Map();
    let nextTimeout = 0;
    const setTimeout = (callback, delay) => {
        timeouts.set(++nextTimeout, { callback, delay });
        return nextTimeout;
    };
    const clearTimeout = id => timeouts.delete(id);
    const runTimeouts = delay => {
        for (const [id, item] of timeouts) {
            if (item.delay !== delay) continue;
            timeouts.delete(id);
            item.callback();
        }
    };

    class Audio extends EventEmitter {
        constructor(src = 'data:audio/wav;base64,AAAA') {
            super();
            Object.assign(this, { src, paused: true, loop: false, volume: 1, readyState: 0, currentTime: 0, plays: 0 });
        }
        addEventListener(name, handler) { this.on(name, handler); }
        removeEventListener(name, handler) { this.off(name, handler); }
        load() { if (!waitForLoad) this.ready(); }
        ready() { this.readyState = 3; this.emit('loadeddata'); }
        pause() { this.paused = true; this.emit('pause'); }
        play() {
            this.plays++;
            if (abortPlay && this.plays === 1) return Promise.reject({ name: 'AbortError' });
            this.paused = false;
            return Promise.resolve();
        }
    }
    const audios = [];
    const rendererWindow = {};
    const document = {
        getElementById: id => audios.find(audio => audio.id === id),
        createElement: () => new Audio(),
        body: { appendChild: audio => audios.push(audio) },
        querySelectorAll: () => audios
    };
    const context = vm.createContext({ window: rendererWindow, document, setTimeout, clearTimeout });
    const playbackWindow = {
        isDestroyed: () => false,
        webContents: { executeJavaScript: script => Promise.resolve(vm.runInContext(script, context)) }
    };
    const popups = [];
    class Popup extends EventEmitter {
        constructor() {
            super();
            popups.push(this);
            this.webContents = new EventEmitter();
        }
        setMenu() {}
        loadURL() {}
        isDestroyed() { return !!this.destroyed; }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    class Dialog {
        constructor(options) { this.options = options; }
        destroy() { this.options.destroyCallback(); }
    }
    const dependencies = {
        siyuan: { Dialog, showMessage() {} },
        '../../pluginInstance': { i18n: key => key },
        '../../utils/audioUtils': { resolveAudioPath: async src => src }
    };
    const notifications = [];
    class Notification {
        constructor(title, options) {
            this.title = title;
            this.options = options;
            notifications.push(this);
        }
        close() {}
    }
    Notification.permission = 'granted';
    const module = { exports: {} };
    const window = {
        require: () => ({ remote: {
            BrowserWindow: Popup,
            screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) }
        } }),
        Notification,
        setTimeout,
        clearTimeout
    };
    new Function('require', 'module', 'exports', 'window', 'setTimeout', 'clearTimeout', 'Notification', compiled)(
        name => dependencies[name] || {}, module, module.exports, window, setTimeout, clearTimeout, Notification
    );
    const Timer = module.exports.PomodoroTimer;
    if (browserWindow) Timer.browserWindowInstance = playbackWindow;
    const timer = Object.create(Timer.prototype);
    const startedSources = [];
    Object.assign(timer, {
        settings: { pomodoroEndPopupWindow: true }, audioPlaybackGeneration: 0,
        audioInitialized: true, isWindowClosed: false, activeSources: new Map(),
        workEndAudio: new Audio(), breakEndAudio: new Audio(), randomRestSounds: [],
        workEndVolume: 1, breakEndVolume: 1,
        resumeAudioContext: async () => {}, preloadAudioBuffer: async () => ({}),
        getCacheKey: src => src, getCssVariable: () => '',
        getPomodoroBrowserWindowFontConfig: () => ({ fontFamily: 'sans-serif', fontFaceCss: '' }),
        audioCtx: {
            createBufferSource: () => {
                const source = { connect() {}, start() { startedSources.push(this); }, stop() { this.stopped = true; } };
                return source;
            },
            createGain: () => ({ gain: {}, connect() {} })
        }
    });
    // 弹窗销毁执行真实 stopAllAudio，覆盖正在播放和待播放的两类音源。
    timer.openSiyuanDialog('结束', '结束', '🍅', 0, true);
    return { timer, audios, popups, startedSources, notifications, runTimeouts };
}

for (const phase of ['workEndAudio', 'breakEndAudio']) {
    test(`${phase}：关闭弹窗取消尚未完成的音频初始化`, async () => {
        const { timer, startedSources } = fixture();
        const ready = deferred();
        timer.audioInitialized = false;
        timer.initializeAudioPlayback = async () => { await ready.promise; timer.audioInitialized = true; };
        const pending = timer.safePlayAudio(timer[phase]);
        timer.closePomodoroEndWindow();
        ready.resolve();
        assert.equal(await pending, false);
        assert.equal(startedSources.length, 0);
    });

    test(`${phase}：关闭弹窗取消仍在解码的循环音源，并允许下一次播放`, async () => {
        const { timer, startedSources } = fixture();
        const decoded = deferred();
        timer.preloadAudioBuffer = () => decoded.promise;
        const pending = timer.safePlayAudio(timer[phase]);
        await flush();
        timer.closePomodoroEndWindow();
        decoded.resolve({});
        assert.equal(await pending, false);
        assert.equal(startedSources.length, 0);
        timer.openSiyuanDialog('下一次', '结束', '🍅', 0, true);
        assert.equal(await timer.safePlayAudio(timer[phase]), true);
        assert.equal(startedSources[0].loop, true);
        timer.pomodoroEndDialog.destroy();
        assert.equal(startedSources[0].stopped, true);
        assert.equal(timer.activeSources.size, 0);
    });
}

test('独立窗口：关闭弹窗后音频下载完成也不能再次注入播放', async () => {
    const { timer, audios } = fixture({ browserWindow: true });
    const downloaded = deferred();
    timer.getAudioDataUrlForBW = () => downloaded.promise;
    const pending = timer.safePlayAudio(timer.workEndAudio);
    timer.closePomodoroEndWindow();
    downloaded.resolve('data:audio/wav;base64,AAAA');
    assert.equal(await pending, false);
    assert.equal(audios.length, 0);
});

test('独立窗口：关闭弹窗取消渲染进程中等待加载的循环音频', async () => {
    const { timer, audios } = fixture({ browserWindow: true, waitForLoad: true });
    const pending = timer.safePlayAudio(timer.breakEndAudio);
    await flush();
    assert.equal(audios.length, 1);
    assert.equal(audios[0].loop, true);
    timer.closePomodoroEndWindow();
    audios[0].ready();
    assert.equal(await pending, false);
    assert.equal(audios[0].plays, 0);
    assert.equal(audios[0].loop, false);
    assert.equal(audios[0]._userPaused, true);
});

test('独立窗口：关闭弹窗取消 AbortError 延迟重试，守护逻辑也不能重启声音', async () => {
    const { timer, audios, runTimeouts } = fixture({ browserWindow: true, abortPlay: true });
    const pending = timer.safePlayAudio(timer.workEndAudio);
    await flush();
    assert.equal(audios[0].plays, 1);
    // 先产生循环播放的 pause 守护定时器，再关闭弹窗。
    audios[0].pause();
    timer.closePomodoroEndWindow();
    runTimeouts(100);
    runTimeouts(200);
    assert.equal(await pending, false);
    audios[0].emit('ended');
    assert.equal(audios[0].plays, 1);
    assert.equal(audios[0].paused, true);
});

test('独立窗口：取消旧请求后，同一声音可重新播放，不复用旧的待播放请求', async () => {
    const { timer, audios } = fixture({ browserWindow: true, waitForLoad: true });
    const oldRequest = timer.safePlayAudio(timer.workEndAudio);
    await flush();
    timer.closePomodoroEndWindow();
    timer.openSiyuanDialog('下一次', '结束', '🍅', 0, true);
    const newRequest = timer.safePlayAudio(timer.workEndAudio);
    await flush();
    audios[0].ready();
    assert.equal(await oldRequest, false);
    assert.equal(await newRequest, true);
    assert.equal(audios[0].plays, 1);
    timer.closePomodoroEndWindow();
    assert.equal(audios[0].paused, true);
    assert.equal(audios[0].loop, false);
});

test('旧思源弹窗延迟回调不能停止新弹窗的声音', async () => {
    const { timer, startedSources } = fixture();
    const oldDialog = timer.pomodoroEndDialog;
    timer.openSiyuanDialog('下一次', '结束', '🍅', 0, true);
    const newDialog = timer.pomodoroEndDialog;
    await timer.safePlayAudio(timer.breakEndAudio);
    oldDialog.destroy();
    assert.equal(timer.pomodoroEndDialog, newDialog);
    assert.equal(startedSources[0].stopped, undefined);
    newDialog.destroy();
    assert.equal(startedSources[0].stopped, true);
});

test('旧原生弹窗关闭事件不会清空新弹窗，直接销毁新弹窗也会停止声音', async () => {
    const { timer, popups, startedSources } = fixture();
    timer.openPomodoroEndWindowImpl('工作结束', '结束', '🍅');
    const oldPopup = popups[0];
    oldPopup.emit('close');
    timer.openPomodoroEndWindowImpl('休息结束', '结束', '🍵');
    const newPopup = timer.pomodoroEndWindow;
    await timer.safePlayAudio(timer.breakEndAudio);
    oldPopup.emit('closed');
    assert.equal(timer.pomodoroEndWindow, newPopup);
    assert.equal(startedSources[0].stopped, undefined);
    newPopup.emit('destroyed');
    assert.equal(timer.pomodoroEndWindow, null);
    assert.equal(startedSources[0].stopped, true);
});

for (const testCase of [
    { method: 'completePhase', isWorkPhase: true, endAudio: 'workEndAudio', switchMethod: 'autoSwitchToBreak' },
    { method: 'completePhase', isWorkPhase: false, endAudio: 'breakEndAudio', switchMethod: 'autoSwitchToWork' },
    { method: 'completeBreakPhase', isWorkPhase: false, endAudio: 'breakEndAudio', switchMethod: 'autoSwitchToWork' }
]) {
    test(`${testCase.method}：自动切换后仍播放${testCase.endAudio}`, async () => {
        const { timer } = fixture({ browserWindow: true });
        const calls = [];
        let endSoundPlaying = false;
        Object.assign(timer, testCase, {
            autoMode: true,
            isCompletingPhase: false,
            timer: null,
            totalTime: 1500,
            completedPomodoros: 0,
            longBreakInterval: 4,
            currentPhaseOriginalDuration: 5,
            phaseStartTime: 0,
            isLongBreak: false,
            systemNotificationEnabled: false,
            pendingSettings: null,
            reminder: { id: 'task', title: '任务' },
            settings: { pomodoroEndPopupWindow: true, workDuration: 25, breakDuration: 5, longBreakDuration: 15 },
            recordManager: { recordBreakSession: async () => {} },
            cancelAllMobileNotifications() {},
            stopRandomRestTimer() {},
            openPomodoroEndWindow() {},
            closePomodoroEndWindow() {},
            finishActiveWorkSession: async () => null,
            openPomodoroCompletionNotePopup() {},
            updateReminderPomodoroCount: async () => {},
            triggerHabitAutoCheckInAfterPomodoro() {},
            stopForAutoTransition() {},
            updateDisplay() {},
            updateMainSwitchButton() {},
            updateStatsDisplay() {},
            stopAllAudio() { endSoundPlaying = false; },
            safePlayAudio: async audio => {
                if (audio === timer[testCase.endAudio]) {
                    endSoundPlaying = true;
                    calls.push('end');
                }
                return true;
            }
        });
        timer[testCase.switchMethod] = async () => {
            timer.stopAllAudio();
            calls.push('switch');
        };

        await timer[testCase.method]();
        assert.deepEqual(calls, ['switch', 'end']);
        assert.equal(endSoundPlaying, true);
    });
}

test('随机微休息开始和结束使用自定义声音，系统通知保持静默', async () => {
    const { timer, notifications, runTimeouts } = fixture();
    const played = [];
    timer.workEndAudio.readyState = 3;
    Object.assign(timer, {
        randomRestEnabled: true,
        randomRestSounds: [timer.workEndAudio],
        randomRestEndSound: timer.breakEndAudio,
        randomRestVolume: 0.4,
        randomRestEndVolume: 0.6,
        randomRestSystemNotificationEnabled: true,
        randomRestAutoClose: true,
        randomRestAutoCloseDelay: 5,
        randomRestCount: 0,
        settings: { randomRestBreakDuration: 5 },
        plugin: null,
        openRandomRestWindow() {},
        closeRandomRestWindow() {},
        updateDisplay() {},
        safePlayAudio: async audio => {
            played.push(audio);
            return true;
        }
    });

    await timer.playRandomRestSound();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].options.silent, true);
    assert.deepEqual(played, [timer.workEndAudio]);

    runTimeouts(5000);
    assert.equal(notifications.length, 2);
    assert.ok(notifications.every(notification => notification.options.silent === true));
    assert.deepEqual(played, [timer.workEndAudio, timer.breakEndAudio]);
});
