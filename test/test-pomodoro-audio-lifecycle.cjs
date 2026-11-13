const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const ts = require('typescript');
const { loadPomodoroIcons } = require('./helpers/pomodoro-icon-loader.cjs');

const compiled = ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8'
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

const iconModule = { exports: loadPomodoroIcons() };

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ browserWindow = false, waitForLoad = false, abortPlay = false, runPopupScript = true } = {}) {
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
        removeAttribute(name) { if (name === 'src') this.src = ''; }
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
        constructor(options) {
            super();
            popups.push(this);
            this.options = options;
            this.audios = [];
            this.renderer = new EventEmitter();
            this.renderer.addEventListener = this.renderer.on.bind(this.renderer);
            const popupContext = vm.createContext({
                window: this.renderer,
                document: {
                    createElement: () => new Audio(),
                    body: { appendChild: audio => this.audios.push(audio) }
                },
                console
            });
            this.webContents = new EventEmitter();
            this.webContents.executeJavaScript = script => Promise.resolve(vm.runInContext(script, popupContext));
            this.webContents.setAudioMuted = muted => { this.muted = muted; };
        }
        setMenu() {}
        loadURL(url) {
            this.html = decodeURIComponent(url.split(',').slice(1).join(','));
            const script = this.html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
            if (script && runPopupScript) return this.webContents.executeJavaScript(script);
            return Promise.resolve();
        }
        isDestroyed() { return !!this.destroyed; }
        destroy() {
            this.renderer.emit('pagehide');
            this.renderer.emit('unload');
            this.destroyed = true;
            this.emit('closed');
        }
    }
    class Dialog {
        constructor(options) { this.options = options; }
        destroy() { this.options.destroyCallback(); }
    }
    const dependencies = {
        siyuan: { Dialog, showMessage() {}, getFrontend: () => 'desktop' },
        '../../pluginInstance': { i18n: key => key },
        '../render/pomodoroIcons': iconModule.exports,
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
        clearTimeout,
        setInterval: () => 1
    };
    new Function('require', 'module', 'exports', 'window', 'setTimeout', 'clearTimeout', 'Notification', compiled)(
        name => dependencies[name] || {}, module, module.exports, window, setTimeout, clearTimeout, Notification
    );
    const Timer = module.exports.PomodoroTimer;
    if (browserWindow) Timer.browserWindowInstance = playbackWindow;
    const timer = Object.create(Timer.prototype);
    const startedSources = [];
    Object.assign(timer, {
        settings: { pomodoroEndPopupWindow: true, pomodoroEndSoundLoop: true }, audioPlaybackGeneration: 0,
        bwAudioDataUrlCache: new Map(), bwAudioDataUrlRequests: new Map(),
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
    return { timer, audios, popups, startedSources, notifications, runTimeouts, Audio };
}

function microbreakFixture(browserWindow) {
    // 弹窗内的 DOM 倒计时由窗口自行执行；这里测试主窗口的定时器与关闭事件。
    const state = fixture({ browserWindow, runPopupScript: false });
    const { timer, Audio } = state;
    Object.assign(timer, {
        settings: { randomRestPopupWindow: true, randomRestBreakDuration: 5 },
        workAudio: Object.assign(new Audio('data:audio/wav;base64,WORK'), { loop: true }),
        workVolume: 0.5,
        randomRestEndSound: new Audio('data:audio/wav;base64,REST'),
        randomRestEndVolume: 0.6,
        randomRestEnabled: true,
        randomRestSystemNotificationEnabled: false,
        randomRestCount: 0,
        randomRestNextTriggerTime: Infinity,
        isWorkPhase: true,
        isRunning: true,
        isPaused: false,
        updateDisplay() {}
    });
    return state;
}

for (const browserWindow of [false, true]) {
    const mode = browserWindow ? '独立计时窗口' : '主窗口 AudioContext';
    for (const ending of ['定时结束', '轮询兜底', '手动关闭']) {
        test(`随机微休息 ${mode}：${ending}保留工作背景音和结束提示音`, async () => {
            const { timer, audios, popups, startedSources, runTimeouts } = microbreakFixture(browserWindow);
            assert.equal(await timer.safePlayAudio(timer.workAudio), true);
            const background = browserWindow ? audios[0] : startedSources[0];

            await timer.playRandomRestSound();
            assert.equal(popups.length, 1);
            assert.equal(timer.randomRestWindow, popups[0]);
            if (ending === '定时结束') {
                runTimeouts(5000);
            } else if (ending === '轮询兜底') {
                timer.randomRestWindowCloseTime = 1;
                timer.checkRandomRestTrigger();
            } else {
                popups[0].emit('close');
                popups[0].destroy();
                // 提前关闭弹窗仍保留本次微休息的结束计时。
                runTimeouts(5000);
            }
            await flush();

            assert.equal(timer.randomRestWindow, null);
            assert.equal(timer.randomRestCount, 1);
            assert.equal(timer.audioPlaybackGeneration, 0);
            assert.equal(background.loop, true);
            if (browserWindow) {
                assert.equal(background.paused, false);
                assert.equal(background.plays, 1);
                assert.equal(audios.length, 2);
                assert.equal(audios[1].paused, false);
                assert.equal(audios[1].loop, false);
            } else {
                assert.equal(background.stopped, undefined);
                assert.equal(startedSources.length, 2);
                assert.equal(startedSources[1].stopped, undefined);
                assert.equal(startedSources[1].loop, false);
            }
            // 计时器显式停止时仍能正常停止所有音频。
            timer.stopAllAudio();
            if (browserWindow) assert.ok(audios.every(audio => audio.paused));
            else assert.ok(startedSources.every(source => source.stopped));
        });
    }
}

test('随机微休息：旧弹窗延迟关闭不会清空新弹窗引用', () => {
    const { timer, popups } = microbreakFixture(false);
    timer.openRandomRestWindow();
    const previous = popups[0];
    timer.openRandomRestWindow();
    previous.emit('close');
    previous.emit('closed');
    assert.equal(timer.randomRestWindow, popups[1]);
    assert.equal(popups[1].isDestroyed(), false);
    timer.closeRandomRestWindow();
    assert.equal(popups[1].isDestroyed(), true);
});

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

for (const phase of ['workEndAudio', 'breakEndAudio']) {
    for (const loopSetting of [undefined, false, true]) {
        test(`${phase}：循环设置为 ${loopSetting} 时，原生弹窗、思源弹窗及独立计时窗口行为一致`, async () => {
            const native = fixture();
            native.timer.settings.pomodoroEndSoundLoop = loopSetting;
            native.timer.openPomodoroEndWindowImpl('结束', '结束', '🍅', native.timer[phase]);
            const popupAudio = native.timer.pomodoroEndWindow.audios[0];
            assert.equal(popupAudio.loop, loopSetting === true);
            assert.equal(popupAudio.plays, 1);
            await native.timer.safePlayAudio(native.timer[phase]);
            assert.equal(popupAudio.plays, 1, '后续播放请求不能重复提示音');

            const dialog = fixture();
            dialog.timer.settings.pomodoroEndSoundLoop = loopSetting;
            await dialog.timer.safePlayAudio(dialog.timer[phase]);
            assert.equal(dialog.startedSources[0].loop, loopSetting === true);

            const independent = fixture({ browserWindow: true });
            independent.timer.settings.pomodoroEndSoundLoop = loopSetting;
            independent.timer.settings.pomodoroEndPopupWindow = false;
            independent.timer.pomodoroEndDialog = null;
            await independent.timer.safePlayAudio(independent.timer[phase]);
            assert.equal(independent.audios[0].loop, loopSetting === true);
            assert.equal(independent.audios[0].plays, 1);
        });
    }

    test(`${phase}：原生结束弹窗加载后自行播放，关闭即释放自身音源`, async () => {
        const { timer, audios, startedSources } = fixture({ browserWindow: true });
        timer[phase].src = 'blob:cached-end-sound';
        timer.bwAudioDataUrlCache.set(timer[phase].src, 'data:audio/wav;base64,AAAA');
        timer.getAudioDataUrlForBW = () => { throw new Error('已缓存的提示音不应再次下载'); };
        timer.openPomodoroEndWindowImpl('结束', '结束', '🍅', timer[phase]);
        const popup = timer.pomodoroEndWindow;
        assert.equal(popup.options.webPreferences.backgroundThrottling, false);
        assert.equal(popup.audios.length, 1);
        assert.equal(popup.audios[0].plays, 1);
        assert.equal(popup.audios[0].loop, true);
        assert.equal(await timer.safePlayAudio(timer[phase]), true);
        assert.equal(popup.audios[0].plays, 1);
        assert.equal(audios.length, 0, '计时器窗口不能重复发声');
        assert.equal(startedSources.length, 0, '宿主窗口不能重复发声');

        popup.destroy();
        assert.equal(popup.audios[0].paused, true);
        assert.equal(popup.audios[0].src, '');
        assert.equal(await timer.safePlayAudio(timer[phase]), false, '关闭后自动切换的晚到回调不能补播');
        assert.equal(audios.length, 0);
    });
}

test('原生结束弹窗在下载完成前关闭或被替换，晚到的音频不能补播', async () => {
    const { timer, popups } = fixture({ browserWindow: true });
    const downloaded = deferred();
    timer.workEndAudio.src = 'blob:pending';
    timer.getAudioDataUrlForBW = () => downloaded.promise;
    timer.openPomodoroEndWindowImpl('旧结束', '结束', '🍅', timer.workEndAudio);
    const oldPopup = popups[0];
    assert.equal(oldPopup.audios.length, 0);
    timer.openPomodoroEndWindowImpl('新结束', '结束', '🍵', timer.breakEndAudio);
    const newPopup = timer.pomodoroEndWindow;
    downloaded.resolve('data:audio/wav;base64,AAAA');
    await flush();
    assert.equal(oldPopup.audios.length, 0);
    assert.equal(newPopup.audios.length, 1);
    assert.equal(await timer.safePlayAudio(timer.workEndAudio), false, '旧阶段不能在新弹窗期间补播');
    oldPopup.emit('closed');
    assert.equal(timer.pomodoroEndWindow, newPopup);
    assert.equal(newPopup.muted, undefined);
});

test('原生弹窗下载未完成就关闭，不会回退到其他窗口发声', async () => {
    const { timer, audios } = fixture({ browserWindow: true });
    const downloaded = deferred();
    timer.workEndAudio.src = 'blob:pending';
    timer.getAudioDataUrlForBW = () => downloaded.promise;
    timer.openPomodoroEndWindowImpl('结束', '结束', '🍅', timer.workEndAudio);
    const popup = timer.pomodoroEndWindow;
    popup.destroy();
    downloaded.resolve('data:audio/wav;base64,AAAA');
    await flush();
    assert.equal(popup.audios.length, 0);
    assert.equal(await timer.safePlayAudio(timer.workEndAudio), false);
    assert.equal(audios.length, 0);
});

for (const method of ['autoSwitchToBreak', 'autoSwitchToWork']) {
    test(`${method}：自动切换保留弹窗提示音，手动停止仍能静音`, async () => {
        const { timer } = fixture({ browserWindow: true });
        timer.openPomodoroEndWindowImpl('结束', '结束', '🍅', timer.workEndAudio);
        const popup = timer.pomodoroEndWindow;
        Object.assign(timer, {
            settings: { workDuration: 25, breakDuration: 5 },
            stopRandomRestTimer() {}, startRandomRestTimer() {},
            ensureActiveWorkSessionStarted: async () => {},
            scheduleAllMobileNotifications() {}, updateDisplay() {}, updateStatsDisplay() {}
        });
        await timer[method]();
        assert.equal(popup.muted, undefined);
        assert.equal(popup.audios[0].paused, false);
        timer.stopAllAudio();
        assert.equal(popup.muted, true);
        await timer.safePlayAudio(timer.workEndAudio);
        assert.equal(popup.muted, true, '晚到的播放调用不能撤销手动停止');
    });
}

test('音频预取和弹窗共享同一次数据转换，完成后复用缓存', async () => {
    const { timer } = fixture();
    const downloaded = deferred();
    let requests = 0;
    timer.fetchAudioDataUrlForBW = async src => {
        requests++;
        const data = await downloaded.promise;
        timer.bwAudioDataUrlCache.set(src, data);
        return data;
    };
    const preload = timer.getAudioDataUrlForBW('blob:test');
    const popup = timer.getAudioDataUrlForBW('blob:test');
    assert.equal(requests, 1);
    downloaded.resolve('data:audio/wav;base64,AAAA');
    assert.equal(await preload, await popup);
    await timer.getAudioDataUrlForBW('blob:test');
    assert.equal(requests, 1);
    assert.equal(timer.bwAudioDataUrlRequests.size, 0);
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
