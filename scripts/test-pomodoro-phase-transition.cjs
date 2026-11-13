// pnpm exec node --test scripts/test-pomodoro-phase-transition.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/panel/PomodoroTimer.ts'), 'utf8');
const ast = ts.createSourceFile('PomodoroTimer.ts', source, ts.ScriptTarget.Latest, true);
const timerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroTimer');
const names = ['completePhase', 'completeBreakPhase', 'autoSwitchToBreak', 'autoSwitchToWork',
    'reconcileTimerState', 'stopForAutoTransition', 'getWorkSessionStartDate', 'ensureActiveWorkSessionStarted',
    'finishActiveWorkSession', 'recordCompletedWorkPhase', 'recordCompletedBreakPhase',
    'playAudioWithoutBlocking', 'playPhaseBackgroundAudio', 'resetPhaseTracking', 'startTimer', 'resumeTimer'];
const methods = timerClass.members.filter(node => names.includes(node.name?.getText(ast)))
    .map(node => node.getText(ast)).join('\n');
const code = ts.transpileModule(`class PomodoroTimer { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ autoMode = false, isWorkPhase = true, isCountUp = false,
    isLongBreak = false, completedPomodoros = 0, audioInitialized = true } = {}) {
    let now = 1_800_000_000_000;
    let nextId = 1;
    const intervals = new Map();
    const timeouts = new Map();
    const save = deferred(), audio = deferred(), init = deferred(), start = deferred();
    const calls = { records: [], starts: [], sounds: [], displays: [], notes: [], errors: [] };
    const clock = class extends Date { static now() { return now; } constructor(...args) { super(...(args.length ? args : [now])); } };
    const window = {
        setInterval: callback => { const id = nextId++; intervals.set(id, callback); return id; },
        setTimeout: callback => { const id = nextId++; timeouts.set(id, callback); return id; }
    };
    const Timer = new Function('window', 'Date', 'i18n', 'showMessage', 'setTimeout', 'clearTimeout', 'clearInterval', 'console',
        `${code}; return PomodoroTimer;`)(window, clock, key => key, () => {}, window.setTimeout,
        id => timeouts.delete(id), id => intervals.delete(id),
        { warn: (...args) => calls.errors.push(args), error: (...args) => calls.errors.push(args) });
    Timer.browserWindowInstance = { isDestroyed: () => false };
    const settings = { workDuration: 25, breakDuration: 5, longBreakDuration: 15 };
    const duration = isWorkPhase ? 25 : isLongBreak ? 15 : 5;
    const timer = Object.assign(new Timer(), {
        autoMode, isWorkPhase, isCountUp, isLongBreak, completedPomodoros, settings,
        reminder: { id: 'task-1', title: '测试任务' }, longBreakInterval: 4,
        isRunning: true, isPaused: false, isCompletingPhase: false, isWindowClosed: false,
        timeLeft: 0, breakTimeLeft: 0, totalTime: duration * 60,
        startTime: now - duration * 60000, phaseStartTime: now - duration * 60000,
        activeWorkSessionId: isWorkPhase ? 'old-session' : null,
        activeWorkSessionStartTime: isWorkPhase ? now - duration * 60000 : 0,
        currentPhaseOriginalDuration: duration, audioInitialized, audioPlaybackGeneration: 0,
        workAudio: { name: 'work' }, breakAudio: { name: 'break' }, longBreakAudio: { name: 'longBreak' },
        workEndAudio: { name: 'workEnd' }, breakEndAudio: { name: 'breakEnd' },
        stopAllAudio() { this.audioPlaybackGeneration++; },
        safePlayAudio(sound) { calls.sounds.push(sound.name); return audio.promise; },
        async initializeAudioPlayback() { await init.promise; this.audioInitialized = true; },
        recordManager: {
            finishWorkSession(...args) { calls.records.push(['finishWork', ...args]); return save.promise; },
            recordWorkSession(...args) { calls.records.push(['work', ...args]); return save.promise; },
            recordBreakSession(...args) { calls.records.push(['break', ...args]); return save.promise; },
            startWorkSession(...args) { calls.starts.push(args); return start.promise; }
        },
        updateDisplay() { calls.displays.push({ work: this.isWorkPhase, time: this.timeLeft, completing: this.isCompletingPhase }); },
        openPomodoroCompletionNotePopup: session => calls.notes.push(session)
    });
    for (const method of ['cancelAllMobileNotifications', 'stopRandomRestTimer', 'startRandomRestTimer',
        'closePomodoroEndWindow', 'openPomodoroEndWindow', 'updateMainSwitchButton', 'scheduleAllMobileNotifications',
        'updateStatsDisplay', 'updateReminderPomodoroCount', 'triggerHabitAutoCheckInAfterPomodoro']) timer[method] = () => {};
    return { timer, calls, save, audio, init, start, intervals, timeouts,
        advance(seconds) { now += seconds * 1000; for (const tick of [...intervals.values()]) tick(); } };
}

for (const autoMode of [false, true]) {
    for (const phase of ['work', 'break', 'longBreak', 'countUpBreak', 'countUpLongBreak']) {
        test(`${autoMode ? '自动' : '手动'}模式 ${phase} 结束不等待音频和存储`, async () => {
            const isWorkPhase = phase === 'work';
            const isCountUp = phase.startsWith('countUp');
            const isLongBreak = phase === 'longBreak' || phase === 'countUpLongBreak';
            const f = fixture({ autoMode, isWorkPhase, isCountUp, isLongBreak });
            const oldStartTime = f.timer.phaseStartTime;
            let settled = false;
            const completion = isCountUp ? f.timer.completeBreakPhase() : f.timer.completePhase();
            completion.then(() => { settled = true; });
            await flush();
            assert.equal(settled, true, '资源请求仍未完成时应已结束状态切换');
            assert.equal(f.timer.isWorkPhase, !isWorkPhase);
            assert.equal(f.timer.isRunning, autoMode);
            assert.equal(f.timer.isCompletingPhase, false);
            assert.equal(f.calls.displays.at(-1).completing, false, '及时同步解除子窗口的完成锁');
            assert.ok(f.calls.displays.some(state => state.work === !isWorkPhase));
            assert.equal(f.calls.records.length, 1);
            assert.equal(f.timer.completedPomodoros, isWorkPhase ? 1 : 0);
            const record = f.calls.records[0];
            const options = record.at(-1);
            assert.equal(options.startTime.getTime(), oldStartTime);
            assert.equal(options.endTime.getTime(), oldStartTime + (isWorkPhase ? 25 : isLongBreak ? 15 : 5) * 60000);
            if (!isWorkPhase) assert.equal(record[5], isLongBreak);
            if (autoMode) {
                f.advance(2);
                assert.equal(isCountUp ? f.timer.timeElapsed : f.timer.timeLeft, isCountUp ? 2 : (isWorkPhase ? 300 : 1500) - 2);
            }
            // 旧阶段慢存储完成，不能清空下一阶段的起点或记录 ID。
            const nextStartTime = f.timer.phaseStartTime;
            f.start.resolve('new-session');
            await flush();
            f.save.resolve({ id: 'old-session' });
            f.audio.resolve(true);
            await flush();
            assert.equal(f.timer.phaseStartTime, nextStartTime);
            if (autoMode && !isWorkPhase) assert.equal(f.timer.activeWorkSessionId, 'new-session');
            assert.equal(f.calls.notes.length, isWorkPhase ? 1 : 0);
        });
    }
}

test('第四个番茄结束立即进入长休息，音频初始化也不阻塞倒计时', async () => {
    const f = fixture({ autoMode: true, completedPomodoros: 3, audioInitialized: false });
    let settled = false;
    f.timer.completePhase().then(() => { settled = true; });
    await flush();
    assert.equal(settled, true);
    assert.equal(f.timer.isLongBreak, true);
    assert.equal(f.timer.timeLeft, 900);
    f.advance(3);
    assert.equal(f.timer.timeLeft, 897);
    f.init.resolve();
    await flush();
    assert.ok(f.calls.sounds.includes('longBreak'));
});

test('记录保存和音频失败不打断下一阶段，错误有日志', async () => {
    const f = fixture({ autoMode: true });
    await f.timer.completePhase();
    f.save.reject(new Error('disk unavailable'));
    f.audio.reject(new Error('audio unavailable'));
    await flush();
    assert.equal(f.timer.isCompletingPhase, false);
    f.advance(2);
    assert.equal(f.timer.timeLeft, 298);
    assert.ok(f.calls.errors.length >= 2);
    assert.equal(f.calls.notes.length, 0);
});

test('工作记录预创建未返回就结束时，完成记录使用原 ID 且不污染下一阶段', async () => {
    const f = fixture();
    f.timer.activeWorkSessionId = null;
    const start = f.timer.ensureActiveWorkSessionStarted();
    const duplicate = f.timer.ensureActiveWorkSessionStarted();
    assert.equal(f.calls.starts.length, 1);
    await f.timer.completePhase();
    assert.equal(f.timer.isWorkPhase, false);
    assert.equal(f.calls.records.length, 0);
    f.start.resolve('pending-old-session');
    await Promise.all([start, duplicate]);
    await flush();
    assert.equal(f.calls.records.length, 1);
    assert.equal(f.calls.records[0][1], 'pending-old-session');
    assert.equal(f.timer.activeWorkSessionId, null);
});

test('阶段切换后不再播放上一阶段尚未初始化的背景音', async () => {
    const f = fixture({ audioInitialized: false });
    await f.timer.autoSwitchToBreak();
    f.timer.stopAllAudio();
    f.init.resolve();
    await flush();
    assert.deepEqual(f.calls.sounds, []);
});

for (const phase of ['work', 'break', 'longBreak']) {
    test(`点击开始 ${phase} 时不等待记录保存就请求播放并启动计时`, async () => {
        const f = fixture({ isWorkPhase: phase === 'work', isLongBreak: phase === 'longBreak' });
        Object.assign(f.timer, { isRunning: false, startTime: 0, phaseStartTime: 0, activeWorkSessionId: null,
            activeWorkSessionStartTime: 0, timeLeft: f.timer.totalTime });
        f.init.resolve();
        await f.timer.startTimer();
        await flush();
        assert.deepEqual(f.calls.sounds, [phase]);
        assert.equal(f.calls.starts.length, phase === 'work' ? 1 : 0);
        assert.equal(f.timer.isRunning, true);
        assert.equal(f.intervals.size, 1);
        f.advance(2);
        assert.equal(f.timer.timeLeft, f.timer.totalTime - 2);
    });
}

test('暂停后恢复不等待音频就更新按钮和计时，音频就绪即请求播放', async () => {
    const f = fixture();
    Object.assign(f.timer, { isPaused: true, pausedTime: 30 });
    await f.timer.resumeTimer();
    assert.equal(f.timer.isPaused, false);
    assert.equal(f.intervals.size, 1);
    assert.equal(f.calls.displays.length, 1);
    f.advance(2);
    assert.equal(f.timer.timeLeft, 1500 - 32);
    f.init.resolve();
    await flush();
    assert.deepEqual(f.calls.sounds, ['work']);
});
