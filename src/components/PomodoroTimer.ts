import { showMessage, confirm, getFrontend, Dialog } from "siyuan";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { getBlockByID, openBlock, sendNotification } from "../api";
import { i18n } from "../pluginInstance";
import { resolveAudioPath } from "../utils/audioUtils";


export class PomodoroTimer {
    // 静态变量：跟踪全局的BrowserWindow实例
    private static browserWindowInstance: any = null;
    private static browserWindowTimer: PomodoroTimer | null = null;

    private reminder: any;
    private settings: any;
    private container: HTMLElement;
    private timeDisplay: HTMLElement;
    private statusDisplay: HTMLElement;

    private startPauseBtn: HTMLElement;
    private stopBtn: HTMLElement;
    private circularProgress: SVGCircleElement;
    private expandToggleBtn: HTMLElement;
    private statsContainer: HTMLElement;
    private todayFocusDisplay: HTMLElement;
    private weekFocusDisplay: HTMLElement;
    private modeToggleBtn: HTMLElement;
    private minimizeBtn: HTMLElement;
    private mainSwitchBtn: HTMLElement; // 新增：主切换按钮
    private switchMenu: HTMLElement; // 新增：切换菜单
    private soundControlBtn: HTMLElement; // 新增：声音控制按钮
    private volumeSlider: HTMLInputElement; // 新增：音量滑块
    private volumeContainer: HTMLElement; // 新增：音量容器
    private minimizedView: HTMLElement;
    private minimizedIcon: HTMLElement;
    private minimizedBg: HTMLElement;
    private minimizedOverlay: HTMLElement;
    private restoreBtn: HTMLElement;
    private fullscreenBtn: HTMLElement; // 新增：全屏模式按钮
    private exitFullscreenBtn: HTMLElement; // 新增：退出全屏按钮
    private plugin: any; // 插件实例引用，用于调用插件方法

    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private isWorkPhase: boolean = true;
    private isLongBreak: boolean = false;
    private isCountUp: boolean = false;
    private isBackgroundAudioMuted: boolean = false; // 新增：背景音静音状态
    private backgroundVolume: number = 1; // 新增：背景音音量
    private timeLeft: number = 0; // 倒计时剩余时间
    private timeElapsed: number = 0; // 正计时已用时间
    private breakTimeLeft: number = 0; // 休息时间剩余
    private totalTime: number = 0;
    private completedPomodoros: number = 0; // 完成的番茄数量
    private timer: number = null;
    private isExpanded: boolean = true;
    private isMinimized: boolean = false;
    private startTime: number = 0; // 记录开始时间
    private pausedTime: number = 0; // 记录暂停时累计的时间


    // 新增：当前阶段的原始设定时长（用于统计）
    private currentPhaseOriginalDuration: number = 0; // 当前阶段的原始设定时长（分钟）
    // 新增：自动模式相关属性
    private autoMode: boolean = false; // 自动模式状态
    private longBreakInterval: number = 4; // 长休息间隔
    private autoTransitionTimer: number = null; // 自动切换定时器

    private workAudio: HTMLAudioElement = null;
    private breakAudio: HTMLAudioElement = null;
    private longBreakAudio: HTMLAudioElement = null;
    private workEndAudio: HTMLAudioElement = null; // 工作结束提示音
    private breakEndAudio: HTMLAudioElement = null; // 休息结束提示音
    private recordManager: PomodoroRecordManager;
    private audioInitialized: boolean = false;
    private audioInitPromise: Promise<void> | null = null;
    private audioUnlockHandler: ((event: Event) => void) | null = null;
    private audioInitFailTimestamp: number | null = null; // 上次初始化失败时间（ms）
    private readonly AUDIO_INIT_RETRY_BACKOFF: number = 10000; // 失败重试退避（ms）

    private isWindowClosed: boolean = false; // 新增：窗口关闭状态标记
    private pendingSettings: any = null; // pending settings when update skipped due to running

    // 随机微休息相关（改为定期检查机制，类似index.ts）
    private randomRestSounds: HTMLAudioElement[] = [];
    private randomRestEnabled: boolean = false;
    private randomRestEndSound: HTMLAudioElement = null;
    private randomRestEndSoundTimer: number = null; // 结束声音定时器
    private randomRestCount: number = 0; // 随机微休息完成计数
    private randomRestCheckTimer: number = null; // 定期检查定时器
    private randomRestNextTriggerTime: number = 0; // 下次触发时间
    private randomRestWindow: any = null; // 新增：随机微休息弹窗
    private pomodoroEndWindow: any = null; // 新增：番茄钟结束弹窗

    private systemNotificationEnabled: boolean = true; // 新增：系统弹窗开关
    private randomRestSystemNotificationEnabled: boolean = true; // 新增：随机微休息系统通知开关
    private randomRestAutoClose: boolean = true // 新增：随机微休息系统通知自动关闭
    private randomRestAutoCloseDelay: number = 5; // 新增：随机微休息系统通知自动关闭延迟

    private isFullscreen: boolean = false; // 新增：全屏模式状态
    private escapeKeyHandler: ((e: KeyboardEvent) => void) | null = null; // 新增：ESC键监听器
    private lastPomodoroTriggerTime: number = -1; // 新增：防止重复触发番茄钟完成逻辑
    private isTabMode: boolean = false; // 是否为Tab模式
    private currentCircumference: number = 2 * Math.PI * 36; // 当前圆周长度，用于进度计算
    private isMiniMode: boolean = false; // BrowserWindow 迷你模式状态
    private isDocked: boolean = false; // BrowserWindow 吸附模式状态
    private normalWindowBounds: { x: number; y: number; width: number; height: number } | null = null; // 保存正常窗口位置和大小
    private inheritedWindowBounds: { x: number; y: number; width: number; height: number } | null = null; // 继承的窗口位置信息

    constructor(reminder: any, settings: any, isCountUp: boolean = false, inheritState?: any, plugin?: any, container?: HTMLElement, orphanedWindow?: any) {
        this.reminder = reminder;
        this.settings = settings;
        this.isCountUp = isCountUp; // 设置计时模式
        this.plugin = plugin; // 保存插件实例引用
        this.isTabMode = !!container; // 如果提供了container参数，则为Tab模式
        this.timeLeft = settings.workDuration * 60;
        this.totalTime = this.timeLeft;
        this.recordManager = PomodoroRecordManager.getInstance();

        // 初始化当前阶段的原始时长（分钟）
        this.currentPhaseOriginalDuration = settings.workDuration;

        // 初始化声音设置
        this.isBackgroundAudioMuted = settings.backgroundAudioMuted || false;
        this.backgroundVolume = Math.max(0, Math.min(1, settings.backgroundVolume || 0.5));

        // 初始化系统弹窗设置
        this.systemNotificationEnabled = settings.systemNotification !== false;

        // 初始化随机微休息设置
        this.randomRestEnabled = settings.randomRestEnabled || false;
        this.randomRestSystemNotificationEnabled = settings.randomRestSystemNotification !== false; // 新增
        this.randomRestAutoClose = true;
        this.randomRestAutoCloseDelay = 5;

        // 初始化自动模式设置
        this.autoMode = settings.autoMode || false;
        this.longBreakInterval = Math.max(1, settings.longBreakInterval || 4);

        // 初始化系统弹窗功能
        this.initSystemNotification();



        // 在用户首次交互时解锁音频播放
        this.attachAudioUnlockListeners();

        // 在 BrowserWindow 模式下，设置定期音频权限检查
        if (!this.isTabMode) {
            this.setupBrowserWindowAudioMaintenance();
        }

        // 如果有继承状态，应用继承的状态
        // 如果有继承状态，应用继承的状态
        if (inheritState && inheritState.isRunning) {
            // 无论是否同任务，只要是继承运行状态，就视为上一段专注结束，先记录
            // 注意：这会导致同任务继承时被拆分为两条记录，但能保证时间统计准确
            this.recordPartialWorkSession(inheritState.reminderId, inheritState.reminderTitle, inheritState);
            this.applyInheritedState(inheritState);
            // reminderUpdate事件触发更新
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        }

        if (orphanedWindow) {
            PomodoroTimer.browserWindowInstance = orphanedWindow;
            this.container = orphanedWindow;
            PomodoroTimer.browserWindowTimer = this;
            this.registerIPCListeners(orphanedWindow);
            this.updateBrowserWindowDisplay(orphanedWindow);
            // CRITICAL: Restore the tick loop if it was running and we recovered state
            // (State recovery happens in recoverOrphanedWindow before constructor for properties,
            // but we need to start the loop if it was running)
            // Check inheritState or just local properties?
            // Since we passed dummyReminder which was populated with title/id,
            // but 'isRunning' etc. were NOT passed to constructor directly via inheritState in recoverOrphanedWindow.
            // We need to sync them in recoverOrphanedWindow or here.
            // Let's assume recoverOrphanedWindow updated the properties on the 'timer' instance AFTER creation?
            // NO, `new` returns the instance. 
            // We need to apply state in constructor if possible, OR allow recoverOrphanedWindow to update it.
            // But valid tick loop needs to start.

            // Let's defer "init components" which loads audio etc.
            this.initComponents(container, orphanedWindow);
        } else {
            this.findAndAttachOrphanedWindow();
            this.initComponents(container);
        }
    }

    /**
     * 应用继承的番茄钟状态
     */
    private applyInheritedState(inheritState: any) {

        // 继承基本状态
        this.isWorkPhase = inheritState.isWorkPhase;
        this.isLongBreak = inheritState.isLongBreak;

        // 判断是否是任务继承（任务ID不同）
        const isTaskInheritance = inheritState.reminderId && this.reminder.id && inheritState.reminderId !== this.reminder.id;

        // 仅在非任务切换或任务切换且保留进度时，才继承番茄数
        // 如果是新任务，重置番茄钟数量，避免显示错误的已完成数
        if (isTaskInheritance) {
            this.completedPomodoros = 0;
            console.log(`[PomodoroTimer] 任务切换：重置番茄钟计数，继承时间：${inheritState.timeLeft}s`);
        } else {
            this.completedPomodoros = inheritState.completedPomodoros || 0;
        }

        // 根据计时模式应用不同的时间状态
        if (this.isCountUp) {
            // 正计时模式
            if (inheritState.isWorkPhase) {
                this.timeElapsed = inheritState.timeElapsed || 0;
                this.breakTimeLeft = 0;
            } else {
                // 休息阶段：继承剩余休息时间和已用工作时间
                this.timeElapsed = inheritState.timeElapsed || 0;
                this.breakTimeLeft = inheritState.breakTimeLeft || (this.isLongBreak ?
                    this.settings.longBreakDuration * 60 : this.settings.breakDuration * 60);
            }

            // 恢复模式：正计时保持原有逻辑
            this.pausedTime = this.timeElapsed;
            this.startTime = Date.now() - (this.timeElapsed * 1000);

        } else {
            // 倒计时模式
            // 强制将剩余时间视为新阶段的总时长，避免后续统计时错误地使用原始workDuration
            const remainingSecs = Math.max(0, inheritState.timeLeft || 0);
            this.timeLeft = remainingSecs;
            this.totalTime = remainingSecs;
            this.timeElapsed = 0;
            this.pausedTime = 0;

            // 设置当前阶段的原始时长（分钟），用于后续统计
            this.currentPhaseOriginalDuration = Math.round(remainingSecs / 60);

            // 由于视作新阶段，重置开始时间
            this.startTime = Date.now();
        }

        // 继承运行状态，但新番茄钟开始时不暂停
        this.isRunning = inheritState.isRunning && !inheritState.isPaused;
        this.isPaused = false;

        // 保存继承的窗口位置信息（稍后在窗口创建后应用）
        if (inheritState.windowBounds) {
            this.inheritedWindowBounds = inheritState.windowBounds;
            console.log('[PomodoroTimer] 已保存继承的窗口位置:', this.inheritedWindowBounds);
        }

        // 继承窗口模式状态（吸附模式和迷你模式）
        if (inheritState.isDocked !== undefined) {
            this.isDocked = inheritState.isDocked;
            console.log('[PomodoroTimer] 继承吸附模式状态:', this.isDocked);
        }
        if (inheritState.isMiniMode !== undefined) {
            this.isMiniMode = inheritState.isMiniMode;
            console.log('[PomodoroTimer] 继承迷你模式状态:', this.isMiniMode);
        }

        // 继承保存的正常窗口位置（用于从吸附模式恢复）
        if (inheritState.normalWindowBounds) {
            this.normalWindowBounds = inheritState.normalWindowBounds;
            console.log('[PomodoroTimer] 继承保存的正常窗口位置:', this.normalWindowBounds);
        }
    }

    /**
     * 获取当前番茄钟状态，用于状态继承
     */
    /**
     * 获取当前番茄钟状态，用于状态继承
     */
    public getCurrentState() {
        // 如果正在运行，计算实时状态
        let currentTimeElapsed = this.timeElapsed;
        let currentTimeLeft = this.timeLeft;
        let currentBreakTimeLeft = this.breakTimeLeft;

        if (this.isRunning && !this.isPaused && this.startTime > 0) {
            const currentTime = Date.now();
            const realElapsedTime = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    currentTimeElapsed = realElapsedTime;
                } else {
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;
                    currentBreakTimeLeft = totalBreakTime - realElapsedTime;
                }
            } else {
                currentTimeLeft = this.totalTime - realElapsedTime;
                currentTimeElapsed = realElapsedTime;
            }
        }

        // 获取BrowserWindow窗口位置信息（如果存在）
        let windowBounds: { x: number; y: number; width: number; height: number } | undefined;
        try {
            if (PomodoroTimer.browserWindowInstance && !PomodoroTimer.browserWindowInstance.isDestroyed()) {
                windowBounds = PomodoroTimer.browserWindowInstance.getBounds();
            }
        } catch (e) {
            console.warn('[PomodoroTimer] 无法获取窗口位置信息:', e);
        }

        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            isWorkPhase: this.isWorkPhase,
            isLongBreak: this.isLongBreak,
            isCountUp: this.isCountUp,
            timeElapsed: currentTimeElapsed,
            timeLeft: Math.max(0, currentTimeLeft),
            breakTimeLeft: Math.max(0, currentBreakTimeLeft),
            totalTime: this.totalTime,
            completedPomodoros: this.completedPomodoros,
            reminderTitle: this.reminder.title,
            reminderId: this.reminder.id,
            currentPhaseOriginalDuration: this.currentPhaseOriginalDuration,
            startTime: this.startTime,
            randomRestCount: this.randomRestCount,
            randomRestEnabled: this.randomRestEnabled,
            todayFocusMinutes: this.recordManager.getTodayFocusTime(),
            weekFocusMinutes: this.recordManager.getWeekFocusTime(),
            windowBounds: windowBounds, // 窗口位置信息
            isDocked: this.isDocked, // 新增：吸附模式状态
            isMiniMode: this.isMiniMode, // 新增：迷你模式状态
            normalWindowBounds: this.normalWindowBounds, // 新增：保存的正常窗口位置
            randomRestNextTriggerTime: this.randomRestNextTriggerTime // 新增：记录下次随机休息时间
        };
    }

    /**
     * 获取CSS变量的值
     */
    private getCssVariable(variableName: string): string {
        try {
            if (typeof document === 'undefined' || typeof window === 'undefined') return '';
            const root = document.documentElement;
            const styles = window.getComputedStyle(root);
            return styles.getPropertyValue(variableName).trim();
        } catch {
            return '';
        }
    }

    /**
     * 调整颜色亮度（简单实现）
     */
    private adjustColor(color: string, amount: number): string {
        // 简单实现：如果有透明度或复杂颜色，直接返回原色
        if (color.includes('rgba') || color.includes('hsl')) return color;
        // 对于十六进制颜色，简单调整
        if (color.startsWith('#')) {
            const num = parseInt(color.slice(1), 16);
            const r = Math.min(255, Math.max(0, (num >> 16) + amount));
            const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
            const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
            return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
        }
        return color;
    }

    /**
     * 获取番茄钟配色方案
     */
    private getPomodoroColors() {
        return {
            background: this.getCssVariable('--b3-theme-background'),
            onBackground: this.getCssVariable('--b3-theme-on-background'),
            surface: this.getCssVariable('--b3-theme-surface'),
            backgroundLight: this.getCssVariable('--b3-theme-background-light'),
            successBackground: this.getCssVariable('--b3-card-success-background'),
            errorColor: this.getCssVariable('--b3-card-error-color')
        };
    }

    /**
     * 根据吸附位置获取对应的 emoji
     */
    private getDockPositionEmoji(position: string): string {
        const emojiMap: Record<string, string> = {
            'top': '⬆️',
            'bottom': '⬇️',
            'left': '⬅️',
            'right': '➡️'
        };
        // 使用传入值，如果没有则使用 settings 中的值，最后使用默认值 'top'
        const pos = position || this.settings?.pomodoroDockPosition || 'top';
        return emojiMap[pos] || '⬆️';
    }

    private async initComponents(container?: HTMLElement, orphanedWindow?: any) {
        await this.recordManager.initialize();
        await this.initAudio();

        if (orphanedWindow) {
            // If recovering, we already have the window (orphanedWindow).
            // We just need to update stats and perhaps ensure listeners (which we did in constructor).
            // NO call to createWindow here.
        } else {
            await this.createWindow(container);
        }

        this.updateStatsDisplay();
    }

    private async initAudio() {
        // 初始化工作背景音
        if (this.settings.workSound) {
            try {
                const resolved = await resolveAudioPath(this.settings.workSound);
                this.workAudio = new Audio(resolved);
                this.workAudio.loop = true;
                this.workAudio.volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.workAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载工作背景音:', error);
            }
        }

        // 初始化短时休息背景音
        if (this.settings.breakSound) {
            try {
                const resolved = await resolveAudioPath(this.settings.breakSound);
                this.breakAudio = new Audio(resolved);
                this.breakAudio.loop = true;
                this.breakAudio.volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.breakAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载短时休息背景音:', error);
            }
        }

        // 初始化长时休息背景音
        if (this.settings.longBreakSound) {
            try {
                const resolved = await resolveAudioPath(this.settings.longBreakSound);
                this.longBreakAudio = new Audio(resolved);
                this.longBreakAudio.loop = true;
                this.longBreakAudio.volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.longBreakAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载长时休息背景音:', error);
            }
        }

        // 初始化工作结束提示音（音量不受静音影响）
        if (this.settings.workEndSound) {
            try {
                const resolved = await resolveAudioPath(this.settings.workEndSound);
                this.workEndAudio = new Audio(resolved);
                this.workEndAudio.volume = 1;
                this.workEndAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载工作结束提示音:', error);
            }
        }

        // 初始化休息结束提示音（音量不受静音影响）
        if (this.settings.breakEndSound) {
            try {
                const resolved = await resolveAudioPath(this.settings.breakEndSound);
                this.breakEndAudio = new Audio(resolved);
                this.breakEndAudio.volume = 1;
                this.breakEndAudio.preload = 'auto';
            } catch (error) {
                console.warn('无法加载休息结束提示音:', error);
            }
        }

        // 初始化随机微休息
        if (this.randomRestEnabled && this.settings.randomRestSounds) {
            await this.initRandomRestSounds();
        }

        // 初始化随机微休息结束声音
        if (this.randomRestEnabled && this.settings.randomRestEndSound) {
            await this.initRandomRestEndSound();
        }
    }

    private attachAudioUnlockListeners() {
        if (this.audioInitialized || this.audioUnlockHandler) {
            return;
        }

        const handler = () => {
            this.detachAudioUnlockListeners();
            this.initializeAudioPlayback();
        };

        this.audioUnlockHandler = handler;

        ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            document.addEventListener(eventName, handler, { capture: true });
        });
    }

    private detachAudioUnlockListeners() {
        if (!this.audioUnlockHandler) {
            return;
        }

        ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            document.removeEventListener(eventName, this.audioUnlockHandler!);
        });

        this.audioUnlockHandler = null;
    }

    private async initRandomRestSounds() {
        try {
            const soundPath = this.settings.randomRestSounds || '';

            this.randomRestSounds = [];
            if (soundPath) {
                try {
                    const resolved = await resolveAudioPath(soundPath);
                    const audio = new Audio(resolved);
                    audio.volume = 1; // 随机微休息固定音量，不受背景音静音影响
                    audio.preload = 'auto';

                    // 监听加载事件
                    audio.addEventListener('canplaythrough', () => {
                    });

                    audio.addEventListener('error', (e) => {
                        console.error(`随机微休息加载失败: ${soundPath}`, e);
                    });

                    this.randomRestSounds.push(audio);
                } catch (error) {
                    console.warn(`无法创建随机微休息: ${soundPath}`, error);
                }
            }

        } catch (error) {
            console.warn('初始化随机微休息失败:', error);
        }
    }

    private async initRandomRestEndSound() {
        try {
            const path = this.settings.randomRestEndSound || '';
            if (path) {
                const resolved = await resolveAudioPath(path);
                this.randomRestEndSound = new Audio(resolved);
                this.randomRestEndSound.volume = 1; // 固定音量，不受背景音静音影响
                this.randomRestEndSound.preload = 'auto';


                // 监听加载事件
                this.randomRestEndSound.addEventListener('canplaythrough', () => {
                });


                this.randomRestEndSound.addEventListener('error', (e) => {
                    console.error('随机微休息结束声音加载失败:', e);
                });


            }
        } catch (error) {
            console.warn('无法创建随机微休息结束声音:', error);
        }
    }

    private async playRandomRestSound() {
        if (!this.randomRestEnabled) {
            console.warn('随机微休息未启用或无可用音频文件');
            return;
        }

        try {
            if (!this.audioInitialized) {
                await this.initializeAudioPlayback();
            }
            // 仅使用第一个配置的提示音（若存在）。不再做随机选择。
            const selectedAudio = (this.randomRestSounds && this.randomRestSounds.length > 0) ? this.randomRestSounds[0] : null;

            if (selectedAudio) {
                // 等待音频加载完成
                if (selectedAudio.readyState < 3) {
                    await this.waitForAudioLoad(selectedAudio);
                }

                // 确保音量设置正确（不受背景音静音影响）
                selectedAudio.volume = 1;
            } else {
                // 未配置提示音时，仍然要打开弹窗提示并显示系统通知（见要求2）
                console.debug('[PomodoroTimer] 未配置随机微休息提示音，跳过音频播放，但会显示弹窗与系统通知');
            }

            // 与全局提示音播放机制对齐：避免与 index.ts 中的提示音冲突
            const pluginAny = this.plugin as any;
            // 如果存在可播放的音频，则尝试播放；若全局已有提示音在播放，则只跳过音频播放，不跳过弹窗与系统通知。
            if (selectedAudio) {
                if (pluginAny && pluginAny.isPlayingNotificationSound) {
                    let retried = 0;
                    const maxRetries = 5;
                    while (pluginAny.isPlayingNotificationSound && retried < maxRetries) {
                        await new Promise(res => setTimeout(res, 200));
                        retried++;
                    }
                    if (pluginAny.isPlayingNotificationSound) {
                        console.warn('[PomodoroTimer] 检测到已有全局提示音在播放，跳过本次音频播放以避免重叠');
                        // 继续走弹窗与系统通知流程
                    }
                }

                // 标记全局为正在播放（与 index.ts 的行为一致），并播放音频
                let clearGlobalFlagTimer: any = null;
                try {
                    if (pluginAny) {
                        try { pluginAny.isPlayingNotificationSound = true; } catch { }
                        clearGlobalFlagTimer = setTimeout(() => {
                            try { pluginAny.isPlayingNotificationSound = false; } catch { }
                        }, 10000);
                    }

                    const played = await this.safePlayAudio(selectedAudio);
                    if (!played) {
                        console.warn('随机微休息播放失败或被阻止');
                        this.audioInitialized = false;
                        this.attachAudioUnlockListeners();
                    }
                } finally {
                    if (pluginAny) {
                        try { pluginAny.isPlayingNotificationSound = false; } catch { }
                    }
                    if (clearGlobalFlagTimer) {
                        clearTimeout(clearGlobalFlagTimer);
                    }
                }
            }

            // 打开弹窗提示
            this.openRandomRestWindow();

            // 显示系统通知
            if (this.randomRestSystemNotificationEnabled) {
                this.showSystemNotification(
                    i18n('randomRestSettings'),
                    i18n('randomRest', { duration: this.settings.randomRestBreakDuration }),
                    this.randomRestAutoClose ? this.randomRestAutoCloseDelay : undefined
                );
            }

            // 清理之前的结束声音定时器（如果存在）
            if (this.randomRestEndSoundTimer) {
                clearTimeout(this.randomRestEndSoundTimer);
                this.randomRestEndSoundTimer = null;
            }

            // 使用设置中的微休息时间播放结束声音
            if (this.randomRestEndSound) {
                const breakDurationSeconds = Number(this.settings.randomRestBreakDuration) || 0;
                const breakDuration = Math.max(0, breakDurationSeconds * 1000);

                this.randomRestEndSoundTimer = window.setTimeout(async () => {
                    try {
                        // 使用 safePlayAudio 播放结束声音，保证在权限允许时能播放
                        const playedEnd = await this.safePlayAudio(this.randomRestEndSound);
                        if (playedEnd) {
                        } else {
                            console.warn('随机微休息结束声音被阻止或播放失败（等待用户交互以解锁）');
                        }
                    } catch (error) {
                        // safePlayAudio 应不会抛出，但以防万一记录警告
                        console.warn('播放随机微休息结束声音时发生异常:', error);
                    } finally {
                        this.closeRandomRestWindow();
                        // 随机微休息微休息结束，增加计数并持久化
                        try {
                            // 随机微休息计数仅在内存中维护
                            this.randomRestCount++;
                            this.updateDisplay();
                        } catch (err) {
                            console.warn('更新随机微休息计数失败:', err);
                        }
                        // 无论音频是否播放成功，都显示系统通知
                        if (this.randomRestSystemNotificationEnabled) {
                            this.showSystemNotification(
                                i18n('randomRestSettings'),
                                i18n('randomRestComplete') || '微休息时间结束，可以继续专注工作了！',
                                this.randomRestAutoClose ? this.randomRestAutoCloseDelay : undefined
                            );
                        }
                        this.randomRestEndSoundTimer = null;
                    }
                }, breakDuration);
            } else {
                const breakDurationSeconds = Number(this.settings.randomRestBreakDuration) || 0;
                const breakDuration = Math.max(0, breakDurationSeconds * 1000);

                this.randomRestEndSoundTimer = window.setTimeout(() => {
                    this.closeRandomRestWindow();
                    // 随机微休息微休息结束，增加计数并持久化
                    try {
                        // 随机微休息计数仅在内存中维护
                        this.randomRestCount++;
                        this.updateDisplay();
                    } catch (err) {
                        console.warn('更新随机微休息计数失败:', err);
                    }
                    if (this.randomRestSystemNotificationEnabled) {
                        this.showSystemNotification(
                            i18n('randomRestSettings'),
                            i18n('randomRestComplete') || '微休息时间结束，可以继续专注工作了！'
                        );
                    }
                    this.randomRestEndSoundTimer = null;
                }, breakDuration);
            }

        } catch (error) {
            console.error('播放随机微休息失败:', error);
        }
    }

    /**
     * 启动随机微休息的定期检查机制（类似index.ts的定时任务提醒）
     * 每30秒检查一次是否需要播放随机微休息，确保不会遗漏
     */
    private startRandomRestTimer(preserveExistingNextTime: boolean = false) {
        if (!this.randomRestEnabled || !this.isWorkPhase) {
            this.stopRandomRestTimer();
            return;
        }

        // 如果已经在运行，先停止
        this.stopRandomRestTimer();

        // 初始化下次触发时间
        if (!preserveExistingNextTime || !this.randomRestNextTriggerTime || this.randomRestNextTriggerTime <= Date.now()) {
            this.randomRestNextTriggerTime = this.calculateNextRandomRestTime();
        }

        // 启动定期检查定时器（每5秒检查一次，防止错过）
        this.randomRestCheckTimer = window.setInterval(() => {
            this.checkRandomRestTrigger();
        }, 5000);

        // 立即执行一次检查
        this.checkRandomRestTrigger();
    }

    /**
     * 计算下次随机微休息的触发时间
     */
    private calculateNextRandomRestTime(): number {
        const minInterval = (Number(this.settings.randomRestMinInterval) || 1) * 60 * 1000;
        const maxInterval = (Number(this.settings.randomRestMaxInterval) || 1) * 60 * 1000;
        const actualMaxInterval = Math.max(minInterval, maxInterval);

        // 在最小和最大间隔之间随机选择
        const randomInterval = minInterval + Math.random() * (actualMaxInterval - minInterval);
        const nextTime = Date.now() + randomInterval;

        console.log(`[PomodoroTimer] 下次随机微休息时间: ${new Date(nextTime).toLocaleTimeString()} (间隔: ${Math.round(randomInterval / 1000 / 60)}分钟)`);

        // 提示音响起具体时间
        return nextTime;
    }

    /**
     * 检查是否需要触发随机微休息（定期检查机制）
     */
    private checkRandomRestTrigger() {
        if (!this.randomRestEnabled || !this.isWorkPhase || !this.isRunning || this.isPaused) {
            return;
        }

        const now = Date.now();

        // 如果当前时间已达到或超过下次触发时间，则播放提示音
        if (now >= this.randomRestNextTriggerTime) {
            // 播放随机微休息
            this.playRandomRestSound().catch(error => {
                console.warn('播放随机微休息失败:', error);
            });

            // 计算下次触发时间
            this.randomRestNextTriggerTime = this.calculateNextRandomRestTime();
        }

    }

    /**
     * 停止随机微休息的定期检查机制
     */
    private stopRandomRestTimer() {
        if (this.randomRestCheckTimer) {
            clearInterval(this.randomRestCheckTimer);
            this.randomRestCheckTimer = null;
        }
        // 清理结束声音定时器
        if (this.randomRestEndSoundTimer) {
            clearTimeout(this.randomRestEndSoundTimer);
            this.randomRestEndSoundTimer = null;
        }
        this.closeRandomRestWindow();
    }



    private closeRandomRestWindow() {
        if (this.randomRestWindow) {
            try {
                this.randomRestWindow.destroy();
            } catch (e) {
                // ignore
            }
            this.randomRestWindow = null;
        }
    }

    private openPomodoroEndWindow() {
        if (!this.settings.pomodoroEndPopupWindow) return;

        const frontend = getFrontend();
        const isMobile = frontend.endsWith('mobile');
        const isBrowserDesktop = frontend === 'browser-desktop';

        const title = i18n('pomodoroWorkEnd') || '工作结束';
        const message = i18n('pomodoroWorkEndDesc') || '工作时间结束，起来走走喝喝水吧！';

        // 非电脑客户端使用思源内部 Dialog
        if (isMobile || isBrowserDesktop) {
            this.openSiyuanDialog(title, message, '🍅');
            return;
        }

        this.openPomodoroEndWindowImpl(title, message, '🍅');
    }

    private closePomodoroEndWindow() {
        if (this.pomodoroEndWindow) {
            try {
                this.pomodoroEndWindow.destroy();
            } catch (e) {
                // ignore
            }
            this.pomodoroEndWindow = null;
        }
    }

    private openRandomRestWindow() {
        if (!this.settings.randomRestPopupWindow) return;

        const frontend = getFrontend();
        const isMobile = frontend.endsWith('mobile');
        const isBrowserDesktop = frontend === 'browser-desktop';

        const title = i18n('randomRestTitle') || '随机微休息';
        const message = i18n('randomRest', { duration: this.settings.randomRestBreakDuration }) || 'Time for a quick break!';
        const autoCloseDelay = Number(this.settings.randomRestBreakDuration) || 0;

        // 非电脑客户端使用思源内部 Dialog
        if (isMobile || isBrowserDesktop) {
            this.openSiyuanDialog(title, message, '🎲', autoCloseDelay);
            return;
        }

        this.openRandomRestWindowImpl(title, message, '🎲', autoCloseDelay);
    }

    /**
     * 使用思源内部 Dialog 显示弹窗（用于非电脑客户端）
     * @param title 标题
     * @param message 消息内容
     * @param icon 图标
     * @param autoCloseDelay 自动关闭延迟（秒），0表示不自动关闭
     */
    private openSiyuanDialog(title: string, message: string, icon: string, autoCloseDelay: number = 0) {
        try {
            const dialog = new Dialog({
                title: `${icon} ${title}`,
                content: `<div style="padding: 20px; text-align: center; font-size: 16px;">${message}</div>`,
                width: "360px",
                height: "auto"
            });

            // 如果设置了自动关闭，延迟关闭弹窗
            if (autoCloseDelay > 0) {
                setTimeout(() => {
                    try {
                        dialog.destroy();
                    } catch (e) {
                        // ignore
                    }
                }, autoCloseDelay * 1000);
            }
        } catch (e) {
            console.error('[PomodoroTimer] Failed to open siyuan dialog:', e);
            // 降级使用 showMessage
            showMessage(`${icon} ${title}: ${message}`, autoCloseDelay > 0 ? autoCloseDelay * 1000 : 3000);
        }
    }

    /**
     * 创建 BrowserWindow 确认弹窗
     * @param title 标题
     * @param message 消息内容
     * @param onConfirm 确认回调
     * @param onCancel 取消回调（可选）
     */
    private openConfirmWindow(title: string, message: string, onConfirm: () => void, onCancel?: () => void) {
        try {
            let electron: any;
            try {
                electron = (window as any).require('electron');
            } catch (e) {
                console.error("[PomodoroTimer] Failed to require electron", e);
                return;
            }

            let remote = electron.remote;
            if (!remote) {
                try {
                    remote = (window as any).require('@electron/remote');
                } catch (e) { }
            }

            if (!remote) {
                console.error("[PomodoroTimer] Failed to get electron remote");
                return;
            }

            const BrowserWindowConstructor = remote.BrowserWindow;
            if (!BrowserWindowConstructor) {
                console.error("[PomodoroTimer] Failed to get BrowserWindow constructor");
                return;
            }

            const screen = remote.screen || electron.screen;
            if (!screen) {
                console.error("[PomodoroTimer] Failed to get screen object");
                return;
            }

            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

            const winWidth = 480;
            const winHeight = 240;
            const x = Math.floor((screenWidth - winWidth) / 2);
            const y = Math.floor((screenHeight - winHeight) / 2);

            const confirmWindow = new BrowserWindowConstructor({
                width: winWidth,
                height: winHeight,
                x: x,
                y: y,
                frame: true,
                alwaysOnTop: true,
                resizable: false,
                movable: true,
                skipTaskbar: true,
                hasShadow: true,
                transparent: false,
                parent: null, // 确保独立窗口，不依赖主窗口
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                    webSecurity: false,
                    autoplayPolicy: 'no-user-gesture-required'
                },
                title: title,
                show: false,
                backgroundColor: this.getCssVariable('--b3-theme-background')
            });

            confirmWindow.setMenu(null);

            const colors = this.getPomodoroColors();
            const bgColor = colors.background || '#ffffff';
            const textColor = colors.onBackground || '#333333';
            const btnBgColor = colors.surface || '#f0f0f0';
            const btnHoverBgColor = colors.surface ? this.adjustColor(colors.surface, -10) : '#e0e0e0';
            const confirmBtnColor = '#4CAF50';
            const confirmBtnHoverColor = '#45a049';

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            background-color: ${bgColor};
                            color: ${textColor};
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            font-family: "Segoe UI", "Microsoft YaHei", -apple-system, sans-serif;
                            padding: 20px;
                            box-sizing: border-box;
                        }
                        .container {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            width: 100%;
                        }
                        .title {
                            font-size: 20px;
                            font-weight: bold;
                            margin-bottom: 20px;
                            color: ${textColor};
                        }
                        .message {
                            font-size: 16px;
                            margin-bottom: 30px;
                            text-align: center;
                            line-height: 1.5;
                        }
                        .buttons {
                            display: flex;
                            gap: 12px;
                        }
                        button {
                            padding: 10px 24px;
                            font-size: 14px;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-family: inherit;
                            transition: background-color 0.2s;
                        }
                        .btn-confirm {
                            background-color: ${confirmBtnColor};
                            color: white;
                        }
                        .btn-confirm:hover {
                            background-color: ${confirmBtnHoverColor};
                        }
                        .btn-cancel {
                            background-color: ${btnBgColor};
                            color: ${textColor};
                        }
                        .btn-cancel:hover {
                            background-color: ${btnHoverBgColor};
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="title">${title}</div>
                        <div class="message">${message}</div>
                        <div class="buttons">
                            <button class="btn-confirm" onclick="handleConfirm()">确认</button>
                            <button class="btn-cancel" onclick="handleCancel()">取消</button>
                        </div>
                    </div>
                    <script>
                        const { ipcRenderer } = require('electron');
                        function handleConfirm() {
                            ipcRenderer.send('confirm-result', true);
                        }
                        function handleCancel() {
                            ipcRenderer.send('confirm-result', false);
                        }
                    </script>
                </body>
                </html>
            `;

            // 监听确认结果
            const { ipcMain } = remote;
            const handleConfirmResult = (_event: any, result: boolean) => {
                if (result) {
                    onConfirm();
                } else if (onCancel) {
                    onCancel();
                }
                ipcMain.removeListener('confirm-result', handleConfirmResult);
                if (confirmWindow && !confirmWindow.isDestroyed()) {
                    confirmWindow.destroy();
                }
            };
            ipcMain.on('confirm-result', handleConfirmResult);

            confirmWindow.once('ready-to-show', () => {
                confirmWindow.show();
                confirmWindow.focus();
                confirmWindow.setAlwaysOnTop(true, "screen-saver");
            });

            confirmWindow.on('closed', () => {
                ipcMain.removeListener('confirm-result', handleConfirmResult);
            });

            confirmWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

        } catch (e) {
            console.error("[PomodoroTimer] Failed to open confirm window", e);
        }
    }

    private openPomodoroEndWindowImpl(title: string, message: string, icon: string) {
        try {
            // 关闭之前的番茄钟结束弹窗
            this.closePomodoroEndWindow();

            let electron: any;
            try {
                electron = (window as any).require('electron');
            } catch (e) {
                console.error("[PomodoroTimer] Failed to require electron", e);
                return;
            }

            let remote = electron.remote;
            if (!remote) {
                try {
                    remote = (window as any).require('@electron/remote');
                } catch (e) { }
            }

            if (!remote) {
                console.error("[PomodoroTimer] Failed to get electron remote");
                return;
            }

            const BrowserWindowConstructor = remote.BrowserWindow;
            if (!BrowserWindowConstructor) {
                console.error("[PomodoroTimer] Failed to get BrowserWindow constructor");
                return;
            }

            const screen = remote.screen || electron.screen;
            if (!screen) {
                console.error("[PomodoroTimer] Failed to get screen object");
                return;
            }

            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

            const winWidth = screenWidth;
            const winHeight = screenHeight;

            this.pomodoroEndWindow = new BrowserWindowConstructor({
                width: winWidth,
                height: winHeight,
                frame: true,
                alwaysOnTop: false,
                center: true,
                resizable: true,
                movable: true,
                skipTaskbar: true,
                hasShadow: true,
                transparent: false,
                parent: null, // 确保独立窗口，不依赖主窗口
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: false,
                    autoplayPolicy: 'no-user-gesture-required'
                },
                title: title,
                show: false,
                backgroundColor: this.getCssVariable('--b3-theme-background')
            });

            this.pomodoroEndWindow.setMenu(null);

            const bgColor = this.getCssVariable('--b3-theme-background');
            const textColor = this.getCssVariable('--b3-theme-on-background');

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data:;">
                    <style>
                        body {
                            background-color: ${bgColor};
                            color: ${textColor};
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            font-family: "Segoe UI", "Microsoft YaHei", -apple-system, sans-serif;
                            overflow: hidden;
                            user-select: none;
                            box-sizing: border-box;
                            padding: 20px;
                            text-align: center;
                        }
                        .container {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            animation: fadeIn 0.5s ease;
                            width: 100%;
                        }
                        .icon { 
                            font-size: 80px; 
                            margin-bottom: 24px; 
                            animation: bounce 2s infinite;
                            line-height: 1;
                        }
                        .title { 
                            font-size: 32px; 
                            font-weight: bold; 
                            margin-bottom: 24px; 
                            color: ${textColor};
                        }
                        .message { 
                            font-size: 20px; 
                            font-weight: normal; 
                            opacity: 0.9; 
                            line-height: 1.6;
                            word-wrap: break-word;
                            max-width: 90%;
                        }
                        @keyframes bounce {
                            0%, 20%, 50%, 80%, 100% {transform: translateY(0);}
                            40% {transform: translateY(-20px);}
                            60% {transform: translateY(-10px);}
                        }
                        @keyframes fadeIn {
                            from { opacity: 0; transform: scale(0.9); }
                            to { opacity: 1; transform: scale(1); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">${icon}</div>
                        <div class="title">${title}</div>
                        <div class="message">${message}</div>
                    </div>
                </body>
                </html>
            `;

            this.pomodoroEndWindow.once('ready-to-show', () => {
                if (this.pomodoroEndWindow) {
                    this.pomodoroEndWindow.show();
                    this.pomodoroEndWindow.focus();
                    this.pomodoroEndWindow.setAlwaysOnTop(true, "screen-saver");

                    // 延迟将番茄钟BrowserWindow也置顶，确保在弹窗之上
                    setTimeout(() => {
                        if (PomodoroTimer.browserWindowInstance && !PomodoroTimer.browserWindowInstance.isDestroyed()) {
                            try {
                                PomodoroTimer.browserWindowInstance.moveTop();
                                PomodoroTimer.browserWindowInstance.showInactive();
                            } catch (e) {
                                console.warn('[PomodoroTimer] 无法置顶番茄钟窗口:', e);
                            }
                        }
                    }, 100);
                }
            });

            this.pomodoroEndWindow.on('closed', () => {
                this.pomodoroEndWindow = null;
            });

            this.pomodoroEndWindow.webContents.on('will-navigate', (e: any) => {
                e.preventDefault();
            });

            this.pomodoroEndWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));


        } catch (e) {
            console.error("[PomodoroTimer] Failed to open pomodoro end window", e);
        }
    }

    private openRandomRestWindowImpl(title: string, message: string, icon: string, autoCloseDelay?: number) {
        try {
            // 只关闭之前的随机微休息弹窗，不关闭番茄钟弹窗
            this.closeRandomRestWindow();

            let electron: any;
            try {
                electron = (window as any).require('electron');
            } catch (e) {
                console.error("[PomodoroTimer] Failed to require electron", e);
                return;
            }

            // 尝试多种方式获取 remote 和 BrowserWindow
            let remote = electron.remote;
            if (!remote) {
                try {
                    remote = (window as any).require('@electron/remote');
                } catch (e) {
                    // ignore
                }
            }

            if (!remote) {
                console.error("[PomodoroTimer] Failed to get electron remote");
                return;
            }

            const BrowserWindowConstructor = remote.BrowserWindow;
            if (!BrowserWindowConstructor) {
                console.error("[PomodoroTimer] Failed to get BrowserWindow constructor");
                return;
            }

            // 获取屏幕尺寸
            const screen = remote.screen || electron.screen;
            if (!screen) {
                console.error("[PomodoroTimer] Failed to get screen object");
                return;
            }

            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

            const winWidth = screenWidth;
            const winHeight = screenHeight;

            this.randomRestWindow = new BrowserWindowConstructor({
                width: winWidth,
                height: winHeight,
                frame: true,
                alwaysOnTop: false,
                center: true,
                resizable: true,
                movable: true,
                skipTaskbar: true,
                hasShadow: true,
                transparent: false,
                parent: null, // 确保独立窗口，不依赖主窗口
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: false, // 允许加载本地资源
                    autoplayPolicy: 'no-user-gesture-required'
                },
                title: title,
                show: false,
                backgroundColor: this.getCssVariable('--b3-theme-background')
            });

            // 移除默认菜单
            this.randomRestWindow.setMenu(null);

            const bgColor = this.getCssVariable('--b3-theme-background');
            const textColor = this.getCssVariable('--b3-theme-on-background');

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <!-- 允许内联样式和脚本 -->
                    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data:;">
                    <style>
                        body {
                            background-color: ${bgColor};
                            color: ${textColor};
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            font-family: "Segoe UI", "Microsoft YaHei", -apple-system, sans-serif;
                            overflow: hidden;
                            user-select: none;
                            box-sizing: border-box;
                            padding: 20px;
                            text-align: center;
                        }
                        .container {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            animation: fadeIn 0.5s ease;
                            width: 100%;
                        }
                        .icon { 
                            font-size: 80px; 
                            margin-bottom: 24px; 
                            animation: bounce 2s infinite;
                            line-height: 1;
                        }
                        .title { 
                            font-size: 32px; 
                            font-weight: bold; 
                            margin-bottom: 24px; 
                            color: ${textColor};
                        }
                        .message { 
                            font-size: 20px; 
                            font-weight: normal; 
                            opacity: 0.9; 
                            line-height: 1.6;
                            word-wrap: break-word;
                            max-width: 90%;
                        }
                        .countdown {
                            font-size: 48px;
                            font-weight: bold;
                            margin-top: 30px;
                            color: ${textColor};
                            font-family: monospace;
                        }
                        @keyframes bounce {
                            0%, 20%, 50%, 80%, 100% {transform: translateY(0);}
                            40% {transform: translateY(-20px);}
                            60% {transform: translateY(-10px);}
                        }
                        @keyframes fadeIn {
                            from { opacity: 0; transform: scale(0.9); }
                            to { opacity: 1; transform: scale(1); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">${icon}</div>
                        <div class="title">${title}</div>
                        <div class="message">${message}</div>
                        <div id="countdown" class="countdown"></div>
                    </div>
                    <script>
                        const delay = ${autoCloseDelay || 0};
                        if (delay > 0) {
                            let remaining = delay;
                            const el = document.getElementById('countdown');
                            if (el) {
                                el.textContent = remaining;
                                const timer = setInterval(() => {
                                    remaining--;
                                    if (remaining >= 0) {
                                        el.textContent = remaining;
                                    } else {
                                        clearInterval(timer);
                                    }
                                }, 1000);
                            }
                        }
                    </script>
                </body>
                </html>
            `;

            // 监听 ready-to-show 事件后再显示窗口，防止闪烁
            this.randomRestWindow.once('ready-to-show', () => {
                if (this.randomRestWindow) {
                    this.randomRestWindow.show();
                    this.randomRestWindow.focus();
                    // 强制置顶
                    this.randomRestWindow.setAlwaysOnTop(true, "screen-saver");

                    // 延迟将番茄钟BrowserWindow也置顶，确保在弹窗之上
                    setTimeout(() => {
                        if (PomodoroTimer.browserWindowInstance && !PomodoroTimer.browserWindowInstance.isDestroyed()) {
                            try {
                                PomodoroTimer.browserWindowInstance.setAlwaysOnTop(true, "screen-saver", 1);
                                PomodoroTimer.browserWindowInstance.moveTop();
                                PomodoroTimer.browserWindowInstance.showInactive();
                            } catch (e) {
                                console.warn('[PomodoroTimer] 无法置顶番茄钟窗口:', e);
                            }
                        }
                    }, 100);
                }
            });

            this.randomRestWindow.on('closed', () => {
                this.randomRestWindow = null;
            });

            // 防止窗口被意外导航
            this.randomRestWindow.webContents.on('will-navigate', (e: any) => {
                e.preventDefault();
            });

            this.randomRestWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

            if (autoCloseDelay) {
                setTimeout(() => {
                    this.closeRandomRestWindow();
                }, (autoCloseDelay + 1) * 1000); // 增加1秒延迟，让倒计时显示为0
            }


        } catch (e) {
            console.error("[PomodoroTimer] Failed to open random notification window", e);
        }
    }






    private async initializeAudioPlayback(force: boolean = false) {
        if (this.audioInitialized && !force) {
            return;
        }

        if (this.audioInitPromise && !force) {
            try {
                await this.audioInitPromise;
            } catch {
                // 已有的初始化失败被忽略，等待后续用户手势重试
            }
            return;
        }

        // 在 BrowserWindow 模式下，音频会在 BrowserWindow 内播放（有 autoplayPolicy: 'no-user-gesture-required'）
        // 因此跳过主窗口的音频初始化，避免 NotAllowedError
        const isBrowserWindow = !this.isTabMode && PomodoroTimer.browserWindowInstance;
        if (isBrowserWindow) {
            this.audioInitialized = true;
            this.detachAudioUnlockListeners();
            return;
        }

        // 如果最近一次初始化失败且在退避时间内，避免重复尝试主动解锁，改为等待用户手势
        if (!force && this.audioInitFailTimestamp && (Date.now() - this.audioInitFailTimestamp) < this.AUDIO_INIT_RETRY_BACKOFF) {
            this.attachAudioUnlockListeners();
            return;
        }

        // 如果窗口不可见或未获得焦点，跳过自动静默播放尝试，等待用户手势
        try {
            if (!force && typeof document !== 'undefined') {
                const vis = (document as any).visibilityState;
                const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
                if (vis !== 'visible' || !hasFocus) {
                    this.attachAudioUnlockListeners();
                    return;
                }
            }
        } catch (e) {
            // 忽略可见性检查错误，继续尝试初始化
        }

        this.audioInitPromise = (async () => {
            try {
                // 创建一个静默音频来获取播放权限
                const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
                silentAudio.volume = 0;
                try {
                    await silentAudio.play();
                    silentAudio.pause();
                } catch (e: any) {
                    // 如果被拒绝（非用户手势），记录失败时间并注册解锁监听，优雅退出
                    console.warn('静默音频播放受限:', e);
                    if (e && e.name === 'NotAllowedError') {
                        this.audioInitFailTimestamp = Date.now();
                        this.audioInitialized = false;
                        this.attachAudioUnlockListeners();
                        return;
                    }
                    // 其他错误继续向外抛
                    throw e;
                }

                const audioLoadPromises: Array<Promise<void>> = [];

                if (this.workAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.workAudio));
                }
                if (this.breakAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.breakAudio));
                }
                if (this.longBreakAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.longBreakAudio));
                }
                if (this.workEndAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.workEndAudio));
                }
                if (this.breakEndAudio) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.breakEndAudio));
                }

                if (this.randomRestSounds.length > 0) {
                    this.randomRestSounds.forEach((audio) => {
                        audioLoadPromises.push(this.waitForAudioLoad(audio));
                    });
                }

                if (this.randomRestEndSound) {
                    audioLoadPromises.push(this.waitForAudioLoad(this.randomRestEndSound));
                }

                await Promise.allSettled(audioLoadPromises);

                // 尝试对各个音频元素执行一次静音播放以在用户手势期间解锁它们
                try {
                    const unlockAttempts: Array<Promise<void>> = [];

                    const tryUnlockAudio = async (audio?: HTMLAudioElement) => {
                        if (!audio) return;
                        try {
                            const originalVolume = audio.volume;
                            try {
                                audio.volume = 0; // 静音播放以避免打扰
                            } catch { }
                            try {
                                await audio.play();
                                audio.pause();
                                try { audio.currentTime = 0; } catch { }
                            } catch (e) {
                                // 单个音频解锁失败不应阻止整体初始化
                                console.warn('尝试对音频执行静音播放以解锁失败:', e);
                            } finally {
                                try {
                                    audio.volume = originalVolume;
                                } catch { }
                            }
                        } catch (e) {
                            console.warn('解锁音频时出错:', e);
                        }
                    };

                    // 对随机微休息数组尝试解锁
                    if (this.randomRestSounds && this.randomRestSounds.length > 0) {
                        this.randomRestSounds.forEach((a) => unlockAttempts.push(tryUnlockAudio(a)));
                    }

                    // 对随机微休息结束声音尝试解锁
                    if (this.randomRestEndSound) {
                        unlockAttempts.push(tryUnlockAudio(this.randomRestEndSound));
                    }

                    // 对工作/休息结束提示音也尝试解锁（以防用户选择这些作为随机微休息）
                    if (this.workEndAudio) unlockAttempts.push(tryUnlockAudio(this.workEndAudio));
                    if (this.breakEndAudio) unlockAttempts.push(tryUnlockAudio(this.breakEndAudio));

                    await Promise.allSettled(unlockAttempts);
                } catch (unlockError) {
                    console.warn('执行音频解锁尝试时出现错误:', unlockError);
                }

                this.audioInitialized = true;
                this.detachAudioUnlockListeners();
            } catch (error) {
                this.audioInitialized = false;
                console.warn('无法获取音频播放权限:', error);
                this.attachAudioUnlockListeners();
                throw error;
            } finally {
                this.audioInitPromise = null;
            }
        })();

        try {
            await this.audioInitPromise;
        } catch {
            // 忽略异常，等待下一次用户交互重新尝试
        }
    }

    /**
     * 等待音频文件加载完成
     */
    private waitForAudioLoad(audio: HTMLAudioElement): Promise<void> {
        return new Promise((resolve, reject) => {
            if (audio.readyState >= 3) { // HAVE_FUTURE_DATA
                resolve();
                return;
            }

            const onLoad = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error('音频加载失败'));
            };

            const onTimeout = () => {
                cleanup();
                console.warn('音频加载超时，但继续执行');
                resolve(); // 超时时也resolve，避免阻塞
            };

            const cleanup = () => {
                audio.removeEventListener('canplaythrough', onLoad);
                audio.removeEventListener('error', onError);
                clearTimeout(timeoutId);
            };

            audio.addEventListener('canplaythrough', onLoad);
            audio.addEventListener('error', onError);

            // 设置5秒超时
            const timeoutId = setTimeout(onTimeout, 5000);

            // 触发加载
            audio.load();
        });
    }


    private waitForPlaybackStart(audio: HTMLAudioElement): Promise<boolean> {
        return new Promise((resolve) => {
            if (!audio.paused && audio.currentTime > 0) {
                resolve(true);
                return;
            }

            const cleanup = () => {
                audio.removeEventListener('playing', onPlaying);
                audio.removeEventListener('timeupdate', onTimeUpdate);
                audio.removeEventListener('ended', onEnded);
                audio.removeEventListener('error', onError);
                clearTimeout(timeoutId);
            };

            const onPlaying = () => {
                cleanup();
                resolve(true);
            };

            const onTimeUpdate = () => {
                if (audio.currentTime > 0) {
                    cleanup();
                    resolve(true);
                }
            };

            const onEnded = () => {
                cleanup();
                resolve(audio.currentTime > 0);
            };

            const onError = () => {
                cleanup();
                resolve(false);
            };

            audio.addEventListener('playing', onPlaying);
            audio.addEventListener('timeupdate', onTimeUpdate);
            audio.addEventListener('ended', onEnded);
            audio.addEventListener('error', onError);

            const timeoutId = window.setTimeout(() => {
                cleanup();
                resolve(!audio.paused && audio.currentTime > 0);
            }, 1000);
        });
    }

    /**
     * 在 BrowserWindow 的渲染进程内播放音频（通过 webContents.executeJavaScript）
     * 返回是否成功播放
     */
    private async playSoundInBrowserWindow(src: string, opts?: { loop?: boolean; volume?: number }): Promise<boolean> {
        if (!src) return false;
        try {
            const win = PomodoroTimer.browserWindowInstance;
            if (!win || win.isDestroyed && win.isDestroyed()) {
                console.warn('[PomodoroTimer] BrowserWindow 不存在或已销毁');
                return false;
            }

            // 使用 resolveAudioPath 解析路径，支持 petal 文件夹中的文件
            let resolvedSrc = src;
            if (!src.startsWith('blob:') && !src.startsWith('file:')) {
                resolvedSrc = await resolveAudioPath(src);
            }

            if (!resolvedSrc) {
                console.warn('[PomodoroTimer] 无法解析音频路径:', src);
                return false;
            }

            const safeSrc = resolvedSrc.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`');
            const loop = !!(opts && opts.loop);
            const volume = typeof (opts && opts.volume) === 'number' ? (opts!.volume) : 1;

            const script = `(async function(){
                try {
                    const id = 'pomodoro-audio-' + encodeURIComponent('${safeSrc}').replace(/[^a-zA-Z0-9]/g, '_');
                    let a = document.getElementById(id);
                    if (!a) {
                        a = document.createElement('audio');
                        a.id = id;
                        a.preload = 'auto';
                        a.style.display = 'none';
                        document.body.appendChild(a);
                    }
                    a.loop = ${loop};
                    a.volume = ${volume};
                    
                    // 如果 src 相同且可以播放，直接播放
                    if (a.src === '${safeSrc}' && a.readyState >= 2) {
                        try { a.currentTime = 0; } catch(e) {}
                        await a.play();
                        return {ok:true};
                    }
                    
                    // 否则等待加载完成
                    return new Promise((resolve) => {
                        const onCanPlay = async () => {
                            a.removeEventListener('canplaythrough', onCanPlay);
                            a.removeEventListener('error', onError);
                            try {
                                try { a.currentTime = 0; } catch(e) {}
                                await a.play();
                                resolve({ok:true});
                            } catch (playErr) {
                                resolve({ok:false, err: playErr.name || playErr.message || 'play failed'});
                            }
                        };
                        const onError = (e) => {
                            a.removeEventListener('canplaythrough', onCanPlay);
                            a.removeEventListener('error', onError);
                            const errMsg = a.error ? \`\${a.error.code}:\${a.error.message || 'unknown'}\` : 'load error';
                            resolve({ok:false, err: errMsg});
                        };
                        
                        a.addEventListener('canplaythrough', onCanPlay);
                        a.addEventListener('error', onError);
                        
                        // 设置超时
                        setTimeout(() => {
                            a.removeEventListener('canplaythrough', onCanPlay);
                            a.removeEventListener('error', onError);
                            resolve({ok:false, err: 'timeout'});
                        }, 5000);
                        
                        a.src = '${safeSrc}';
                        a.load();
                    });
                } catch (e) { 
                    return {ok:false, err: (e && e.name) ? e.name : (e && e.message) ? e.message : String(e)}; 
                }
            })()`;

            const res = await win.webContents.executeJavaScript(script, true);
            if (res && res.ok) {
                return true;
            }
            // 如果返回错误，记录详细信息
            if (res && res.err) {
                console.warn('[PomodoroTimer] BrowserWindow 音频播放失败:', res.err, 'src:', src);
            }
            return false;
        } catch (e) {
            console.warn('[PomodoroTimer] playSoundInBrowserWindow failed', e);
            return false;
        }
    }

    private async stopAllAudioInBrowserWindow(): Promise<void> {
        try {
            const win = PomodoroTimer.browserWindowInstance;
            if (!win || win.isDestroyed && win.isDestroyed()) return;
            const script = `(function(){
                try {
                    const nodes = Array.from(document.querySelectorAll('[id^="pomodoro-audio-"]'));
                    nodes.forEach(n => {
                        try { n.pause(); n.currentTime = 0; } catch(e) {}
                    });
                } catch(e) {}
            })()`;
            await win.webContents.executeJavaScript(script, true);
        } catch (e) {
            console.warn('[PomodoroTimer] stopAllAudioInBrowserWindow failed', e);
        }
    }

    private async setBrowserWindowAudioVolume(volume: number, playIfNeeded: boolean = false): Promise<void> {
        try {
            const win = PomodoroTimer.browserWindowInstance;
            if (!win || (win.isDestroyed && win.isDestroyed())) return;
            const script = `(function(){
                try {
                    const nodes = Array.from(document.querySelectorAll('[id^="pomodoro-audio-"]'));
                    nodes.forEach(n => {
                        try {
                            n.volume = ${Number('' + 0)}; // placeholder
                        } catch(e) {}
                    });
                    // set volume in a safe loop to support dynamic volume
                    nodes.forEach(n => {
                        try { n.volume = ${volume}; } catch(e) {}
                        try {
                            if (${playIfNeeded}) {
                                n.play().catch(()=>{});
                            } else {
                                if (${volume} === 0) { n.pause(); }
                            }
                        } catch(e) {}
                    });
                } catch(e) {}
            })()`;
            await win.webContents.executeJavaScript(script, true);
        } catch (e) {
            console.warn('[PomodoroTimer] setBrowserWindowAudioVolume failed', e);
        }
    }

    private async safePlayAudio(audio: HTMLAudioElement): Promise<boolean> {
        if (!audio) return false;

        try {
            // 如果在 BrowserWindow 模式，优先在窗口内播放音频以避开主窗口的 autoplay 限制
            // 这样可以利用 BrowserWindow 的 autoplayPolicy: 'no-user-gesture-required' 设置
            const isBrowserWindow = !this.isTabMode && PomodoroTimer.browserWindowInstance;
            if (isBrowserWindow) {
                try {
                    const src = audio.src || '';
                    const loop = !!audio.loop;
                    const volume = typeof audio.volume === 'number' ? audio.volume : 1;
                    const played = await this.playSoundInBrowserWindow(src, { loop, volume });
                    if (played) {
                        return true;
                    }
                    console.warn('[PomodoroTimer] BrowserWindow 音频播放失败，尝试回退到主进程播放');
                    // 如果窗口播放也失败，继续尝试本地播放（后续逻辑会处理权限错误）
                } catch (e) {
                    console.warn('在 BrowserWindow 中播放音频失败，回退到主进程播放:', e);
                }
            }

            // 确保音频已初始化（仅在非 BrowserWindow 模式或 BrowserWindow 播放失败时才需要）
            if (!this.audioInitialized) {
                await this.initializeAudioPlayback();
                // 如果初始化未成功（例如受限于 autoplay 策略），直接返回 false，避免重复激进尝试
                if (!this.audioInitialized) {
                    return false;
                }
            }

            // 检查音频是否准备就绪
            if (audio.readyState < 3) {
                await this.waitForAudioLoad(audio);
            }

            // 重置音频到开始位置
            try {
                audio.currentTime = 0;
            } catch (e) {
                // 某些浏览器在未准备好时设置currentTime会抛错，忽略
            }

            // 播放音频
            await audio.play();
            return true;
        } catch (error: any) {
            console.warn('音频播放失败:', error);

            if (error && error.name === 'NotAllowedError') {
                this.audioInitialized = false;
                // 在 BrowserWindow 模式下，更积极地重新初始化
                const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';
                if (isBrowserWindow) {
                }
                // 强制重新初始化音频播放权限
                try {
                    await this.initializeAudioPlayback(true);
                    // 重新尝试播放
                    if (audio.readyState >= 3) {
                        try {
                            audio.currentTime = 0;
                        } catch { }
                        await audio.play();
                        return true;
                    }
                } catch (retryError) {
                    console.warn('强制重新初始化后播放仍失败:', retryError);
                }
                // 不抛出异常，返回 false 让调用方决定后续动作
                return false;
            } else if (error && error.name === 'AbortError') {
                // 延迟一小段时间后重试（安全地捕捉错误）
                setTimeout(async () => {
                    try {
                        if (audio.readyState >= 3) {
                            try {
                                audio.currentTime = 0;
                            } catch { }
                            await audio.play();
                        }
                    } catch (delayedError) {
                        console.warn('延迟重试也失败:', delayedError);
                    }
                }, 100);
                return false;
            }

            return false;
        }
    }

    private async createWindow(targetContainer?: HTMLElement) {
        // 检测前端类型
        const frontend = getFrontend();
        const isMobile = frontend.endsWith('mobile');
        const isBrowserDesktop = frontend === 'browser-desktop';

        // 如果提供了 targetContainer，则创建 DOM 元素（Tab 模式）
        if (this.isTabMode && targetContainer) {
            this.createDOMWindow(targetContainer);
            return;
        }

        // 移动端或浏览器桌面端强制使用 DOM 窗口（因为不支持 BrowserWindow）
        if (isMobile || isBrowserDesktop) {
            // 创建一个悬浮的 DOM 窗口
            const container = document.createElement('div');
            document.body.appendChild(container);
            this.createDOMWindow(container);
            return;
        }

        // 桌面端创建 BrowserWindow（全局窗口模式）
        try {
            await this.createBrowserWindow();
        } catch (e) {
            this.createDOMWindow(targetContainer);
        }
    }

    private createDOMWindow(targetContainer: HTMLElement) {
        // 创建番茄钟容器
        this.container = document.createElement('div');
        this.container.className = 'pomodoro-timer-window';

        // 根据模式应用不同样式
        if (this.isTabMode && targetContainer) {
            // Tab模式：创建占满容器的布局，不使用悬浮窗口样式
            this.container.style.cssText = `
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
                overflow: hidden;
                box-sizing: border-box;
            `;
        } else {
            // 悬浮窗口模式
            this.container.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 240px;
                background: var(--b3-theme-background);
                border: 1px solid var(--b3-table-border-color);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                user-select: none;
                backdrop-filter: blur(16px);
                transition: transform 0.2s ease, opacity 0.2s ease;
                overflow: hidden;
            `;
        }

        // 创建最小化视图
        this.createMinimizedView();

        // 标题栏
        const header = document.createElement('div');
        header.className = 'pomodoro-header';
        header.style.cssText = `
            padding: 6px;
            background: var(--b3-theme-surface);
            border-radius: 12px 12px 0 0;
            border-bottom: 1px solid var(--b3-table-border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        `;

        const title = document.createElement('div');
        title.className = 'pomodoro-title';
        title.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        // 最小化按钮（替换原来的🍅图标）
        this.minimizeBtn = document.createElement('button');
        this.minimizeBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 16px;
            line-height: 1;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        this.minimizeBtn.innerHTML = '⭕';
        this.minimizeBtn.title = i18n('miniMode');
        this.minimizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMinimize();
        });

        const titleText = document.createElement('span');
        title.appendChild(this.minimizeBtn);
        title.appendChild(titleText);

        const headerButtons = document.createElement('div');
        headerButtons.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        // 创建主切换按钮和悬浮菜单
        const switchContainer = document.createElement('div');
        switchContainer.className = 'pomodoro-switch-container';
        switchContainer.style.cssText = `
            position: relative;
            display: flex;
            align-items: center;
        `;

        // 主切换按钮（根据当前状态显示不同图标）
        this.mainSwitchBtn = document.createElement('button');
        this.mainSwitchBtn.className = 'pomodoro-main-switch';
        this.mainSwitchBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // 根据当前状态设置主按钮图标
        this.updateMainSwitchButton();

        // 创建悬浮菜单
        this.switchMenu = document.createElement('div');
        this.switchMenu.className = 'pomodoro-switch-menu';
        this.switchMenu.style.cssText = `
            position: absolute;
            top: 100%;
            right: 0;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(8px);
            z-index: 1000;
            display: none;
            flex-direction: column;
            padding: 4px;
            min-width: 120px;
            margin-top: 4px;
        `;

        // 计时模式切换按钮
        this.modeToggleBtn = document.createElement('button');
        this.modeToggleBtn.className = 'pomodoro-menu-item';
        this.modeToggleBtn.style.cssText = this.getMenuItemStyle();
        this.modeToggleBtn.innerHTML = `${this.isCountUp ? '🍅' : '⏱️'} ${this.isCountUp ? (i18n('switchToCountdown') || '切换到倒计时') : (i18n('switchToCountUp') || '切换到正计时')}`;
        this.modeToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMode();
            this.hideSwitchMenu();
        });
        this.initMenuItemHoverEffects(this.modeToggleBtn);

        // 工作时间按钮
        const workBtn = document.createElement('button');
        workBtn.className = 'pomodoro-menu-item';
        workBtn.style.cssText = this.getMenuItemStyle();
        workBtn.innerHTML = `💪 ${i18n('pomodoroWork') || '工作时间'}`;
        workBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startWorkTime();
            this.hideSwitchMenu();
        });
        this.initMenuItemHoverEffects(workBtn);

        // 短时休息按钮
        const shortBreakBtn = document.createElement('button');
        shortBreakBtn.className = 'pomodoro-menu-item';
        shortBreakBtn.style.cssText = this.getMenuItemStyle();
        shortBreakBtn.innerHTML = `🍵 ${i18n('pomodoroBreak') || '短时休息'}`;
        shortBreakBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startShortBreak();
            this.hideSwitchMenu();
        });
        this.initMenuItemHoverEffects(shortBreakBtn);

        // 长时休息按钮
        const longBreakBtn = document.createElement('button');
        longBreakBtn.className = 'pomodoro-menu-item';
        longBreakBtn.style.cssText = this.getMenuItemStyle();
        longBreakBtn.innerHTML = `🧘 ${i18n('pomodoroLongBreak') || '长时休息'}`;
        longBreakBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startLongBreak();
            this.hideSwitchMenu();
        });
        this.initMenuItemHoverEffects(longBreakBtn);

        // 将菜单项添加到菜单中
        this.switchMenu.appendChild(this.modeToggleBtn);
        this.switchMenu.appendChild(workBtn);
        this.switchMenu.appendChild(shortBreakBtn);
        this.switchMenu.appendChild(longBreakBtn);

        // 将按钮和菜单添加到容器中
        switchContainer.appendChild(this.mainSwitchBtn);
        switchContainer.appendChild(this.switchMenu);

        // 主按钮点击事件
        this.mainSwitchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleSwitchMenu();
        });

        // 主按钮悬停效果
        this.mainSwitchBtn.addEventListener('mouseenter', () => {
            this.mainSwitchBtn.style.opacity = '1';
            this.mainSwitchBtn.style.transform = 'scale(1.1)';
        });

        this.mainSwitchBtn.addEventListener('mouseleave', () => {
            this.mainSwitchBtn.style.opacity = '0.7';
            this.mainSwitchBtn.style.transform = 'scale(1)';
        });

        // 点击外部关闭菜单
        document.addEventListener('click', (e) => {
            if (!switchContainer.contains(e.target as Node)) {
                this.hideSwitchMenu();
            }
        });

        // 展开/折叠按钮（仅在Tab模式下显示）
        this.expandToggleBtn = document.createElement('button');
        this.expandToggleBtn.className = 'pomodoro-expand-toggle';
        this.expandToggleBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: none;
            align-items: center;
            justify-content: center;
        `;
        this.expandToggleBtn.innerHTML = this.isExpanded ? '📉' : '📈';
        this.expandToggleBtn.title = this.isExpanded ? i18n('collapse') || '折叠' : i18n('expand') || '展开';
        this.expandToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleExpand();
        });

        // 全屏模式切换按钮
        this.fullscreenBtn = document.createElement('button');
        this.fullscreenBtn.className = 'pomodoro-fullscreen-btn';
        this.fullscreenBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        this.fullscreenBtn.innerHTML = '↕️';
        this.fullscreenBtn.title = i18n('fullscreenMode') || '全屏模式';
        this.fullscreenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleFullscreen();
        });



        const closeBtn = document.createElement('button');
        closeBtn.className = 'pomodoro-close';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 16px;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.2s;
        `;
        closeBtn.innerHTML = '×';
        closeBtn.title = i18n('close') || '关闭';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });

        // 创建吸附模式按钮（DOM窗口专用）
        const dockBtn = document.createElement('button');
        dockBtn.className = 'pomodoro-dock-btn';
        dockBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        dockBtn.innerHTML = this.getDockPositionEmoji(this.settings.pomodoroDockPosition);
        dockBtn.title = i18n('dockToEdge') || '吸附到屏幕边缘';
        // 保存引用以便后续更新
        (this as any).dockBtnElement = dockBtn;
        dockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleDOMWindowDock();
        });
        dockBtn.addEventListener('mouseenter', () => {
            dockBtn.style.opacity = '1';
            dockBtn.style.transform = 'scale(1.1)';
        });
        dockBtn.addEventListener('mouseleave', () => {
            dockBtn.style.opacity = '0.7';
            dockBtn.style.transform = 'scale(1)';
        });

        // 左侧按钮：最小化 + 吸附 + 模式切换
        title.appendChild(this.minimizeBtn);
        title.appendChild(dockBtn);
        title.appendChild(switchContainer);

        headerButtons.appendChild(this.expandToggleBtn);
        headerButtons.appendChild(this.fullscreenBtn);
        headerButtons.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(headerButtons);

        // 主体内容
        const content = document.createElement('div');
        content.className = 'pomodoro-content';
        content.style.cssText = `
            padding: 0px 16px 6px;
        `;

        // 事件名称显示
        const eventTitle = document.createElement('div');
        eventTitle.className = 'pomodoro-event-title';
        eventTitle.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
            text-align: center;
            border-radius: 6px;
            border: 1px solid var(--b3-theme-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 5px;
            cursor: pointer;
            transition: all 0.2s ease;
            padding: 4px 8px;
            font-family: var(--b3-font-family) !important;
            max-width: 100%;
            box-sizing: border-box;
            pointer-events: auto;
            user-select: none;
        `;
        eventTitle.textContent = this.reminder.title || i18n("unnamedNote");
        eventTitle.title = i18n("openNote") + ': ' + (this.reminder.title || i18n("unnamedNote"));

        // 添加悬停效果
        eventTitle.addEventListener('mouseenter', () => {
            eventTitle.style.backgroundColor = 'var(--b3-theme-surface-hover)';
            eventTitle.style.borderColor = 'var(--b3-theme-primary)';
        });
        eventTitle.addEventListener('mouseleave', () => {
            eventTitle.style.backgroundColor = 'transparent';
            eventTitle.style.borderColor = 'var(--b3-theme-border)';
        });

        // 添加点击事件
        eventTitle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openRelatedNote();
        });

        // 主要布局容器
        const mainContainer = document.createElement('div');
        mainContainer.className = 'pomodoro-main-container';
        mainContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 10px;
        `;

        // 左侧圆环进度条
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            position: relative;
            width: 80px;
            height: 80px;
            flex-shrink: 0;
        `;

        // 创建 SVG 圆环
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `
            width: 80px;
            height: 80px;
            transform: rotate(-90deg);
        `;
        svg.setAttribute('viewBox', '0 0 80 80');

        // 背景圆环
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '40');
        bgCircle.setAttribute('cy', '40');
        bgCircle.setAttribute('r', '36');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', '#e0e0e0');
        bgCircle.setAttribute('stroke-width', '6');
        bgCircle.setAttribute('opacity', '0.3');

        // 进度圆环
        this.circularProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.circularProgress.setAttribute('cx', '40');
        this.circularProgress.setAttribute('cy', '40');
        this.circularProgress.setAttribute('r', '36');
        this.circularProgress.setAttribute('fill', 'none');
        this.circularProgress.setAttribute('stroke', '#FF6B6B');
        this.circularProgress.setAttribute('stroke-width', '6');
        this.circularProgress.setAttribute('stroke-linecap', 'round');

        const circumference = 2 * Math.PI * 36;
        this.currentCircumference = circumference; // 保存当前圆周长度
        this.circularProgress.style.cssText = `
            stroke-dasharray: ${circumference};
            stroke-dashoffset: ${circumference};
            transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
        `;

        svg.appendChild(bgCircle);
        svg.appendChild(this.circularProgress);

        // 圆环中心的控制按钮容器
        const centerContainer = document.createElement('div');
        centerContainer.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            align-items: center;
            justify-content: center;
            width: 60px;
            height: 60px;
        `;

        // 状态图标
        const statusIcon = document.createElement('div');
        statusIcon.className = 'pomodoro-status-icon';
        statusIcon.style.cssText = `
            font-size: 28px;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            transition: opacity 0.2s ease;
        `;
        statusIcon.innerHTML = '🍅';

        this.startPauseBtn = document.createElement('button');
        this.startPauseBtn.className = 'circle-control-btn';
        this.startPauseBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.9);
            border: none;
            cursor: pointer;
            font-size: 18px;
            color: var(--b3-theme-on-surface);
            padding: 0;
            border-radius: 50%;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(4px);
        `;
        this.startPauseBtn.innerHTML = '▶️';
        this.startPauseBtn.addEventListener('click', () => this.toggleTimer());

        this.stopBtn = document.createElement('button');
        this.stopBtn.className = 'circle-control-btn';
        this.stopBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.9);
            border: none;
            cursor: pointer;
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            padding: 0;
            border-radius: 50%;
            transition: all 0.2s ease;
            display: none;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) translateX(16px);
            opacity: 0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(4px);
        `;
        this.stopBtn.innerHTML = '⏹';
        this.stopBtn.addEventListener('click', () => this.resetTimer());

        // 添加悬浮效果
        centerContainer.addEventListener('mouseenter', () => {
            // 状态图标变透明
            statusIcon.style.opacity = '0.3';

            if (!this.isRunning) {
                this.startPauseBtn.style.opacity = '1';
                this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
                this.stopBtn.style.opacity = '0';
                this.stopBtn.style.display = 'none';
            } else if (this.isPaused) {
                // 暂停状态：显示继续按钮和停止按钮
                // 根据按钮大小自适应计算间距
                const startBtnWidth = parseFloat(getComputedStyle(this.startPauseBtn).width) || 32;
                const stopBtnWidth = parseFloat(getComputedStyle(this.stopBtn).width) || 28;
                const gap = Math.max(4, startBtnWidth * 0.15); // 按钮之间的间距，至少4px
                const startOffset = -(stopBtnWidth / 2 + gap / 2);
                const stopOffset = startBtnWidth / 2 + gap / 2;

                this.startPauseBtn.style.opacity = '1';
                this.stopBtn.style.opacity = '1';
                this.stopBtn.style.display = 'flex';
                this.startPauseBtn.style.transform = `translate(-50%, -50%) translateX(${startOffset}px)`;
                this.stopBtn.style.transform = `translate(-50%, -50%) translateX(${stopOffset}px)`;
            } else {
                // 运行状态：显示暂停按钮
                this.startPauseBtn.style.opacity = '1';
                this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
                this.stopBtn.style.opacity = '0';
                this.stopBtn.style.display = 'none';
            }
        });

        centerContainer.addEventListener('mouseleave', () => {
            // 状态图标恢复
            statusIcon.style.opacity = '1';

            // 隐藏所有按钮并重置位置
            this.startPauseBtn.style.opacity = '0';
            this.stopBtn.style.opacity = '0';
            this.stopBtn.style.display = 'none';
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
            this.stopBtn.style.transform = 'translate(-50%, -50%) translateX(16px)';
        });

        centerContainer.appendChild(statusIcon);
        centerContainer.appendChild(this.startPauseBtn);
        centerContainer.appendChild(this.stopBtn);

        progressContainer.appendChild(svg);
        progressContainer.appendChild(centerContainer);

        // 右侧时间和状态信息
        const timeInfo = document.createElement('div');
        timeInfo.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        this.statusDisplay = document.createElement('div');
        this.statusDisplay.className = 'pomodoro-status';
        this.statusDisplay.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface-variant);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        this.statusDisplay.textContent = i18n('pomodoroWork') || '工作时间';

        this.timeDisplay = document.createElement('div');
        this.timeDisplay.className = 'pomodoro-time';
        this.timeDisplay.style.cssText = `
            font-size: 24px;
            font-weight: 700;
            color: var(--b3-theme-on-surface);
            font-variant-numeric: tabular-nums;
            line-height: 1.2;
            cursor: pointer;
            user-select: none;
            border-radius: 4px;
            padding: 2px 4px;
            transition: background-color 0.2s;
        `;
        this.timeDisplay.title = i18n('editTime') || '双击编辑时间';

        // 添加双击事件监听器
        this.timeDisplay.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.editTime();
        });

        // 添加悬停效果
        this.timeDisplay.addEventListener('mouseenter', () => {
            this.timeDisplay.style.backgroundColor = 'var(--b3-theme-surface-hover)';
        });
        this.timeDisplay.addEventListener('mouseleave', () => {
            this.timeDisplay.style.backgroundColor = 'transparent';
        });

        // 番茄数量显示（正计时模式下显示）
        const pomodoroCountContainer = document.createElement('div');
        pomodoroCountContainer.className = 'pomodoro-count';
        pomodoroCountContainer.style.cssText = `
            font-size: 14px;
            color: var(--b3-theme-on-surface-variant);
            display: flex;
            align-items: center;
            gap: 4px;
            justify-content: space-between;
            width: 100%;
        `;

        // 番茄数量左侧部分
        const pomodoroCountLeft = document.createElement('div');
        pomodoroCountLeft.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;
        // 番茄图标与计数
        pomodoroCountLeft.innerHTML = '';
        const pomodoroIcon = document.createElement('span');
        pomodoroIcon.textContent = '🍅';
        pomodoroIcon.style.cssText = `font-size:14px;`;
        const pomodoroCountSpan = document.createElement('span');
        pomodoroCountSpan.id = 'pomodoroCount';
        pomodoroCountSpan.textContent = this.completedPomodoros.toString();
        pomodoroCountSpan.style.cssText = `font-weight:600; margin-left:4px;`;
        pomodoroCountLeft.appendChild(pomodoroIcon);
        pomodoroCountLeft.appendChild(pomodoroCountSpan);

        // 随机微休息启用时显示骰子图标（靠右，紧邻番茄计数）
        const diceEl = document.createElement('span');
        diceEl.className = 'pomodoro-dice';
        diceEl.textContent = '🎲';
        diceEl.title = i18n('randomRestTitle') || '随机微休息';
        diceEl.style.cssText = `
            margin-left:8px;
            font-size:14px;
            cursor:default;
            opacity:0.9;
            display: ${this.randomRestEnabled ? 'inline' : 'none'};
        `;
        pomodoroCountLeft.appendChild(diceEl);

        // 随机微休息计数显示（紧邻骰子）
        const randomCountEl = document.createElement('span');
        randomCountEl.id = 'randomRestCount';
        randomCountEl.textContent = this.randomRestCount.toString();
        randomCountEl.style.cssText = `
            margin-left:4px;
            font-size:12px;
            color: var(--b3-theme-on-surface-variant);
            display: ${this.randomRestEnabled ? 'inline' : 'none'};
        `;
        pomodoroCountLeft.appendChild(randomCountEl);

        // 音量控制容器（右侧）
        const volumeControlContainer = document.createElement('div');
        volumeControlContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            position: relative;
        `;

        // 创建声音控制按钮
        this.soundControlBtn = document.createElement('button');
        this.soundControlBtn.className = 'pomodoro-sound-control';
        this.soundControlBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface-variant);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        `;
        this.soundControlBtn.innerHTML = this.isBackgroundAudioMuted ? '🔇' : '🔊';
        this.soundControlBtn.title = this.isBackgroundAudioMuted ? i18n('enableBackgroundAudio') || '开启背景音' : i18n('muteBackgroundAudio') || '静音背景音';

        // 创建音量控制容器
        this.createVolumeControl();

        // 将音量容器添加到声音按钮的父容器中
        volumeControlContainer.appendChild(this.soundControlBtn);
        volumeControlContainer.appendChild(this.volumeContainer);

        // 组装番茄数量容器
        pomodoroCountContainer.appendChild(pomodoroCountLeft);
        pomodoroCountContainer.appendChild(volumeControlContainer);

        // 添加声音控制按钮事件
        this.soundControlBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleBackgroundAudio();
        });

        // 添加音量控制悬浮事件
        this.addVolumeControlEvents(volumeControlContainer);

        timeInfo.appendChild(this.statusDisplay);
        timeInfo.appendChild(this.timeDisplay);
        timeInfo.appendChild(pomodoroCountContainer);

        mainContainer.appendChild(progressContainer);
        mainContainer.appendChild(timeInfo);

        // 统计信息容器
        this.statsContainer = document.createElement('div');
        this.statsContainer.className = 'pomodoro-stats';
        this.statsContainer.style.cssText = `
            display: ${this.isExpanded ? 'flex' : 'none'};
            justify-content: space-between;
            padding: 12px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            transition: all 0.3s ease;
            width: 100%;
            box-sizing: border-box;
        `;

        const todayStats = document.createElement('div');
        todayStats.style.cssText = `
            flex: 1;
            text-align: center;
            padding: 0 8px;
        `;

        const todayLabel = document.createElement('div');
        todayLabel.style.cssText = `
            font-size: 11px;
            color: var(--b3-theme-on-surface-variant);
            margin-bottom: 4px;
        `;
        todayLabel.textContent = i18n('todayFocus') || '今日专注';

        this.todayFocusDisplay = document.createElement('div');
        this.todayFocusDisplay.style.cssText = `
            font-size: 16px;
            font-weight: 600;
            color: #FF6B6B;
        `;

        todayStats.appendChild(todayLabel);
        todayStats.appendChild(this.todayFocusDisplay);

        const weekStats = document.createElement('div');
        weekStats.style.cssText = `
            flex: 1;
            text-align: center;
            padding: 0 8px;
            border-left: 1px solid var(--b3-theme-border);
        `;

        const weekLabel = document.createElement('div');
        weekLabel.style.cssText = `
            font-size: 11px;
            color: var(--b3-theme-on-surface-variant);
            margin-bottom: 4px;
        `;
        weekLabel.textContent = i18n('weekFocus') || '本周专注';

        this.weekFocusDisplay = document.createElement('div');
        this.weekFocusDisplay.style.cssText = `
            font-size: 16px;
            font-weight: 600;
            color: #4CAF50;
        `;

        weekStats.appendChild(weekLabel);
        weekStats.appendChild(this.weekFocusDisplay);

        this.statsContainer.appendChild(todayStats);
        this.statsContainer.appendChild(weekStats);

        content.appendChild(eventTitle);
        content.appendChild(mainContainer);
        content.appendChild(this.statsContainer);

        // 根据模式调整按钮显示和布局
        if (this.isTabMode) {
            // Tab模式下隐藏某些不需要的按钮
            this.minimizeBtn.style.display = 'none';
            this.fullscreenBtn.style.display = 'none';
            closeBtn.style.display = 'none'; // 隐藏关闭按钮

            // Tab模式下默认隐藏header，不占用空间
            header.style.display = 'none';
            header.style.position = 'absolute';
            header.style.top = '0';
            header.style.left = '0';
            header.style.right = '0';
            header.style.zIndex = '1000';
            header.style.borderRadius = '0';
            header.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

            // 创建悬浮设置按钮
            const settingsBtn = document.createElement('button');
            settingsBtn.className = 'pomodoro-settings-btn';
            settingsBtn.style.cssText = `
                position: absolute;
                top: 8px;
                right: 8px;
                width: 32px;
                height: 32px;
                background: var(--b3-theme-surface);
                border: 1px solid var(--b3-theme-border);
                border-radius: 50%;
                color: var(--b3-theme-on-surface);
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.6;
                transition: all 0.2s ease;
                z-index: 999;
            `;
            settingsBtn.innerHTML = '🔄';
            settingsBtn.title = i18n('settings') || '设置';

            // 设置按钮悬停效果
            settingsBtn.addEventListener('mouseenter', () => {
                settingsBtn.style.opacity = '1';
                settingsBtn.style.transform = 'scale(1.1)';
            });
            settingsBtn.addEventListener('mouseleave', () => {
                settingsBtn.style.opacity = '0.6';
                settingsBtn.style.transform = 'scale(1)';
            });

            // 点击设置按钮切换header显示
            let headerVisible = false;
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                headerVisible = !headerVisible;
                header.style.display = headerVisible ? 'flex' : 'none';
            });

            // 点击其他区域关闭header
            this.container.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                // 排除eventTitle和设置按钮的点击
                if (headerVisible &&
                    !header.contains(target) &&
                    target !== settingsBtn &&
                    !target.classList.contains('pomodoro-event-title') &&
                    !target.closest('.pomodoro-event-title')) {
                    headerVisible = false;
                    header.style.display = 'none';
                }
            });

            // 将设置按钮添加到容器
            this.container.appendChild(settingsBtn);

            // Tab模式下强制展开统计信息
            this.isExpanded = true;
            this.statsContainer.style.display = 'flex';

            // Tab模式：调整元素样式以适配大屏幕
            // Tab模式下header已经设置为悬浮，这里不需要重复设置
            // header的悬浮样式在上面已经设置好

            // 调整content样式 - 占据全部空间（header已隐藏）
            content.style.cssText = `
                padding: 1vh 1vw;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                box-sizing: border-box;
                position: relative;
            `;

            // 事件标题使用相对单位
            eventTitle.style.fontSize = 'clamp(14px, 3vh, 32px)';
            eventTitle.style.padding = 'clamp(4px, 1vh, 16px) clamp(8px, 2vw, 32px)';
            eventTitle.style.marginBottom = 'clamp(5px, 2vh, 20px)';
            eventTitle.style.flexShrink = '0';

            // 主容器使用flex和相对单位
            mainContainer.style.cssText = `
                display: flex;
                align-items: center;
                gap: 2vw;
                margin-bottom: 1vh;
                flex-shrink: 1;
                min-height: 0;
            `;

            // 放大圆环
            progressContainer.style.width = '300px';
            progressContainer.style.height = '300px';

            svg.style.width = '300px';
            svg.style.height = '300px';
            svg.setAttribute('viewBox', '0 0 300 300');

            // 调整圆环参数
            const radius = 140;
            bgCircle.setAttribute('cx', '150');
            bgCircle.setAttribute('cy', '150');
            bgCircle.setAttribute('r', radius.toString());
            bgCircle.setAttribute('stroke-width', '12');
            this.circularProgress.setAttribute('cx', '150');
            this.circularProgress.setAttribute('cy', '150');
            this.circularProgress.setAttribute('r', radius.toString());
            this.circularProgress.setAttribute('stroke-width', '12');

            const newCircumference = 2 * Math.PI * radius;
            this.currentCircumference = newCircumference; // 更新当前圆周长度
            // 先设置 strokeDasharray，不要设置初始 offset，让 updateDisplay 来计算
            this.circularProgress.setAttribute('stroke-dasharray', newCircumference.toString());
            this.circularProgress.setAttribute('stroke-dashoffset', newCircumference.toString()); // 初始为完全隐藏
            this.circularProgress.style.transition = 'stroke-dashoffset 0.3s ease, stroke 0.3s ease';

            // 放大中心控制区域
            centerContainer.style.width = '220px';
            centerContainer.style.height = '220px';

            // 放大状态图标
            statusIcon.style.fontSize = '100px';

            // 放大控制按钮
            this.startPauseBtn.style.width = '80px';
            this.startPauseBtn.style.height = '80px';
            this.startPauseBtn.style.fontSize = '40px';

            this.stopBtn.style.width = '70px';
            this.stopBtn.style.height = '70px';
            this.stopBtn.style.fontSize = '35px';

            // Tab模式下的统计容器样式 - 自适应宽度和高度
            this.statsContainer.style.cssText = `
                display: flex;
                justify-content: space-between;
                padding: clamp(8px, 1vh, 16px) clamp(12px, 2vw, 24px);
                background: var(--b3-theme-surface);
                border-radius: 8px;
                transition: all 0.3s ease;
                width: 100%;
                max-width: 100%;
                flex-shrink: 0;
                margin-top: auto;
                box-sizing: border-box;
            `;

            // Tab模式初始化完成后立即更新显示，确保进度圆圈正确
            // 延迟一下确保DOM已渲染
            setTimeout(() => {
                this.updateDisplay();
            }, 0);
        }

        // 添加最小化视图到容器（所有模式都需要）
        this.container.appendChild(this.minimizedView);
        this.container.appendChild(header);
        this.container.appendChild(content);

        // 根据模式添加到不同位置
        if (this.isTabMode && targetContainer) {
            // Tab模式：添加到指定容器
            targetContainer.appendChild(this.container);
            // 添加响应式布局监听
            this.setupResponsiveLayout(targetContainer, progressContainer, svg, bgCircle, centerContainer, statusIcon);
        } else {
            // 悬浮窗口模式：添加到body并启用拖拽
            this.makeDraggable(header);
            document.body.appendChild(this.container);
        }

        // 更新显示
        this.updateDisplay();
    }

    private createVolumeControl() {
        // 创建音量控制容器
        this.volumeContainer = document.createElement('div');
        this.volumeContainer.className = 'pomodoro-volume-container';
        this.volumeContainer.style.cssText = `
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 20px;
            padding: 8px 12px;
            display: none;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(8px);
            z-index: 1000;
            white-space: nowrap;
            min-width: 120px;
        `;

        // 音量图标
        const volumeIcon = document.createElement('span');
        volumeIcon.style.cssText = `
            font-size: 14px;
            opacity: 0.7;
        `;
        volumeIcon.textContent = '🔊';

        // 音量滑块
        this.volumeSlider = document.createElement('input') as HTMLInputElement;
        this.volumeSlider.type = 'range';
        this.volumeSlider.min = '0';
        this.volumeSlider.max = '1';
        this.volumeSlider.step = '0.1';
        this.volumeSlider.value = this.backgroundVolume.toString();
        this.volumeSlider.style.cssText = `
            flex: 1;
            height: 4px;
            background: var(--b3-theme-surface-lighter);
            border-radius: 2px;
            outline: none;
            cursor: pointer;
            -webkit-appearance: none;
            appearance: none;
        `;

        // 滑块样式
        const style = document.createElement('style');
        style.textContent = `
            .pomodoro-volume-container input[type="range"]::-webkit-slider-thumb {
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: var(--b3-theme-primary);
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
            .pomodoro-volume-container input[type="range"]::-moz-range-thumb {
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: var(--b3-theme-primary);
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
        `;
        document.head.appendChild(style);

        // 音量百分比显示
        const volumePercent = document.createElement('span');
        volumePercent.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface-variant);
            min-width: 30px;
            text-align: right;
        `;
        volumePercent.textContent = Math.round(this.backgroundVolume * 100) + '%';

        // 滑块事件
        this.volumeSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const volume = parseFloat(target.value);
            this.backgroundVolume = volume;
            volumePercent.textContent = Math.round(volume * 100) + '%';
            this.updateAudioVolume();
        });

        this.volumeContainer.appendChild(volumeIcon);
        this.volumeContainer.appendChild(this.volumeSlider);
        this.volumeContainer.appendChild(volumePercent);
    }

    private addVolumeControlEvents(container: HTMLElement) {
        let hoverTimer: number = null;

        // 鼠标进入事件
        container.addEventListener('mouseenter', () => {
            // 清除可能存在的隐藏定时器
            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }

            // 只有在非静音状态下才显示音量控制
            if (!this.isBackgroundAudioMuted) {
                this.volumeContainer.style.display = 'flex';
                // 添加动画效果
                this.volumeContainer.style.opacity = '0';
                this.volumeContainer.style.transform = 'translateY(-50%) scale(0.9)';

                requestAnimationFrame(() => {
                    this.volumeContainer.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                    this.volumeContainer.style.opacity = '1';
                    this.volumeContainer.style.transform = 'translateY(-50%) scale(1)';
                });
            }
        });

        // 鼠标离开事件
        container.addEventListener('mouseleave', () => {
            // 延迟隐藏，给用户时间移动到音量控制上
            hoverTimer = window.setTimeout(() => {
                this.volumeContainer.style.opacity = '0';
                this.volumeContainer.style.transform = 'translateY(-50%) scale(0.9)';

                setTimeout(() => {
                    this.volumeContainer.style.display = 'none';
                    this.volumeContainer.style.transition = 'none';
                }, 200);
            }, 300);
        });

        // 音量容器本身的悬浮事件，防止鼠标移动到音量控制上时隐藏
        this.volumeContainer.addEventListener('mouseenter', () => {
            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }
        });

        this.volumeContainer.addEventListener('mouseleave', () => {
            hoverTimer = window.setTimeout(() => {
                this.volumeContainer.style.opacity = '0';
                this.volumeContainer.style.transform = 'translateY(-50%) scale(0.9)';

                setTimeout(() => {
                    this.volumeContainer.style.display = 'none';
                    this.volumeContainer.style.transition = 'none';
                }, 200);
            }, 100);
        });
    }

    private toggleBackgroundAudio() {
        this.isBackgroundAudioMuted = !this.isBackgroundAudioMuted;

        // 判断是否为 BrowserWindow 模式
        const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';

        if (isBrowserWindow) {
            // BrowserWindow 模式：更新窗口显示
            // 在窗口中同步音量
            try {
                if (this.isBackgroundAudioMuted) {
                    this.setBrowserWindowAudioVolume(0, false);
                } else {
                    this.setBrowserWindowAudioVolume(this.backgroundVolume, true);
                }
            } catch (e) { }
            this.updateBrowserWindowDisplay(this.container as any);
        } else {
            // DOM 模式：更新按钮显示
            if (this.soundControlBtn) {
                this.soundControlBtn.innerHTML = this.isBackgroundAudioMuted ? '🔇' : '🔊';
                this.soundControlBtn.title = this.isBackgroundAudioMuted ? i18n('enableBackgroundAudio') || '开启背景音' : i18n('muteBackgroundAudio') || '静音背景音';
            }
        }

        // 更新音频音量
        this.updateAudioVolume();

        // 如果是 BrowserWindow 模式且存在窗口，也同步窗口内的音频元素音量
        try {
            const isBrowserWindow2 = !this.isTabMode && PomodoroTimer.browserWindowInstance;
            if (isBrowserWindow2) {
                const vol = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;
                this.setBrowserWindowAudioVolume(vol, !this.isBackgroundAudioMuted);
            }
        } catch (e) { }

        // 如果取消静音，确保音量控制事件正常工作
        if (!this.isBackgroundAudioMuted && !isBrowserWindow) {
            // 重新更新音量滑块显示
            const volumePercent = this.volumeContainer?.querySelector('span:last-child');
            if (volumePercent) {
                volumePercent.textContent = Math.round(this.backgroundVolume * 100) + '%';
            }
            if (this.volumeSlider) {
                this.volumeSlider.value = this.backgroundVolume.toString();
            }
        }

        // 立即隐藏音量控制（如果是静音）
        if (this.isBackgroundAudioMuted && this.volumeContainer && !isBrowserWindow) {
            this.volumeContainer.style.display = 'none';
        }

        const statusText = this.isBackgroundAudioMuted ? (i18n('backgroundAudioMuted') || '背景音已静音') : (i18n('backgroundAudioEnabled') || '背景音已开启');
        showMessage(statusText, 1500);
    }

    private updateAudioVolume() {
        const volume = this.isBackgroundAudioMuted ? 0 : this.backgroundVolume;

        if (this.workAudio) {
            this.workAudio.volume = volume;
        }
        if (this.breakAudio) {
            this.breakAudio.volume = volume;
        }
        if (this.longBreakAudio) {
            this.longBreakAudio.volume = volume;
        }
    }
    private createMinimizedView() {
        this.minimizedView = document.createElement('div');
        this.minimizedView.className = 'pomodoro-minimized-view';
        this.minimizedView.style.cssText = `
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
        `;

        // 进度背景
        this.minimizedBg = document.createElement('div');
        this.minimizedBg.className = 'pomodoro-minimized-bg';
        this.minimizedBg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: conic-gradient(from -90deg,
                var(--progress-color, #FF6B6B) var(--progress-angle, 0deg),
                rgba(255, 255, 255, 0.1) var(--progress-angle, 0deg));
            transition: all 0.3s ease;
        `;

        // 覆盖层（自动适配主题）
        this.minimizedOverlay = document.createElement('div');
        this.minimizedOverlay.className = 'pomodoro-minimized-overlay';
        this.minimizedOverlay.style.cssText = `
            position: absolute;
            top: 2px;
            left: 2px;
            right: 2px;
            bottom: 2px;
            background: var(--b3-theme-background);
            opacity: 0.9;
            border-radius: 50%;
            z-index: 1;
        `;

        // 中心图标
        this.minimizedIcon = document.createElement('div');
        this.minimizedIcon.className = 'pomodoro-minimized-icon';
        this.minimizedIcon.style.cssText = `
            position: relative;
            z-index: 2;
            font-size: 24px;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
            user-select: none;
            cursor: pointer;
        `;
        this.minimizedIcon.innerHTML = '🍅';

        // 恢复按钮
        this.restoreBtn = document.createElement('button');
        this.restoreBtn.className = 'pomodoro-restore-btn';
        this.restoreBtn.style.cssText = `
            position: absolute;
            top: 25px;
            right: 21px;
            width: 15px;
            height: 15px;
            background: var(--b3-theme-primary);
            color: #fff;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            font-size: 10px;
            display: none;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            transition: all 0.2s ease;
            z-index: 10;
        `;
        this.restoreBtn.innerHTML = '↗';
        this.restoreBtn.title = i18n('restoreWindow') || '恢复窗口';
        this.restoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.restore();
        });

        // 添加按钮悬停效果
        this.restoreBtn.addEventListener('mouseenter', () => {
            this.restoreBtn.style.background = 'var(--b3-theme-primary-light)';
            this.restoreBtn.style.transform = 'scale(1.1)';
        });
        this.restoreBtn.addEventListener('mouseleave', () => {
            this.restoreBtn.style.background = 'var(--b3-theme-primary)';
            this.restoreBtn.style.transform = 'scale(1)';
        });

        this.minimizedView.appendChild(this.minimizedBg);
        this.minimizedView.appendChild(this.minimizedOverlay);
        this.minimizedView.appendChild(this.minimizedIcon);
        this.minimizedView.appendChild(this.restoreBtn);

        // 最小化视图悬停时显示恢复按钮
        this.minimizedView.addEventListener('mouseenter', () => {
            this.restoreBtn.style.display = 'flex';
        });
        this.minimizedView.addEventListener('mouseleave', () => {
            this.restoreBtn.style.display = 'none';
        });

        // 为最小化视图添加拖拽支持
        this.minimizedView.addEventListener('mousedown', (e) => {
            if (e.target !== this.restoreBtn && !this.restoreBtn.contains(e.target as Node)) {
                // 触发容器的拖拽，因为最小化视图在容器内部
                const mousedownEvent = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    clientX: e.clientX,
                    clientY: e.clientY
                });
                this.container.dispatchEvent(mousedownEvent);
            }
        });
    }

    private toggleMinimize() {
        if (this.isMinimized) {
            this.restore();
        } else {
            this.minimize();
        }
    }

    private minimize() {
        this.isMinimized = true;

        // 添加最小化动画类
        this.container.classList.add('minimizing');

        setTimeout(() => {
            this.container.classList.remove('minimizing');
            this.container.classList.add('minimized');
            this.updateMinimizedDisplay();
        }, 300);
    }

    private restore() {
        this.isMinimized = false;

        // 添加展开动画类
        this.container.classList.remove('minimized');

        setTimeout(() => {
            // 恢复时不显示统计数据
            // this.isExpanded = false;
            // this.statsContainer.style.display = 'none';
            // this.expandToggleBtn.innerHTML = '📈';
            // this.expandToggleBtn.title = '展开';
            this.updateDisplay();
        }, 300);
    }

    private updateMinimizedDisplay() {
        if (!this.isMinimized) return;

        // 计算进度
        let progress = 0;
        let color = '#FF6B6B'; // 默认工作时间颜色

        if (this.isCountUp) {
            if (this.isWorkPhase) {
                // 正计时工作时间：显示当前番茄的进度
                const pomodoroLength = this.settings.workDuration * 60;
                const currentCycleTime = this.timeElapsed % pomodoroLength;
                progress = currentCycleTime / pomodoroLength;
                color = '#FF6B6B';
            } else {
                // 正计时休息时间：显示休息进度
                const totalBreakTime = this.isLongBreak ?
                    this.settings.longBreakDuration * 60 :
                    this.settings.breakDuration * 60;
                progress = (totalBreakTime - this.breakTimeLeft) / totalBreakTime;
                color = this.isLongBreak ? '#9C27B0' : '#4CAF50';
            }
        } else {
            // 倒计时模式：显示完成进度
            progress = (this.totalTime - this.timeLeft) / this.totalTime;
            if (this.isWorkPhase) {
                color = '#FF6B6B';
            } else {
                color = this.isLongBreak ? '#9C27B0' : '#4CAF50';
            }
        }

        // 确保进度在0-1范围内
        progress = Math.max(0, Math.min(1, progress));

        // 转换为角度（360度 = 100%进度）
        const angle = progress * 360;

        // 更新CSS变量
        this.minimizedBg.style.setProperty('--progress-color', color);
        this.minimizedBg.style.setProperty('--progress-angle', `${angle}deg`);

        // 更新图标
        if (this.isWorkPhase) {
            this.minimizedIcon.innerHTML = this.isCountUp ? '⏱️' : '🍅';
        } else {
            this.minimizedIcon.innerHTML = this.isLongBreak ? '🧘' : '🍵';
        }
    }

    private makeDraggable(handle: HTMLElement) {
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;

        const startDrag = (e: MouseEvent) => {
            // 如果点击的是恢复按钮，不触发拖拽
            if (e.target === this.restoreBtn || this.restoreBtn.contains(e.target as Node)) {
                return;
            }

            // 如果是最小化视图或非按钮区域，允许拖拽
            if (this.isMinimized || !(e.target as Element).closest('button')) {
                e.preventDefault();
                isDragging = true;

                const rect = this.container.getBoundingClientRect();
                initialX = e.clientX - rect.left;
                initialY = e.clientY - rect.top;

                this.container.style.transition = 'none';
                this.container.style.pointerEvents = 'none';

                // 最小化状态下保持指针事件
                if (this.isMinimized) {
                    this.container.style.pointerEvents = 'auto';
                    // 确保恢复按钮的事件不被阻止
                    this.restoreBtn.style.pointerEvents = 'auto';
                } else {
                    const buttons = this.container.querySelectorAll('button');
                    buttons.forEach(btn => {
                        (btn as HTMLElement).style.pointerEvents = 'auto';
                    });
                }

                document.addEventListener('mousemove', drag);
                document.addEventListener('mouseup', stopDrag);
            }
        };

        // 为头部和容器都添加拖拽监听
        handle.addEventListener('mousedown', startDrag);
        this.container.addEventListener('mousedown', (e) => {
            if (this.isMinimized) {
                startDrag(e);
            }
        });

        const drag = (e: MouseEvent) => {
            if (!isDragging) return;

            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            const maxX = window.innerWidth - this.container.offsetWidth;
            const maxY = window.innerHeight - this.container.offsetHeight;

            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));

            // 清除原有的定位样式，使用left和top进行拖拽定位
            this.container.style.left = currentX + 'px';
            this.container.style.top = currentY + 'px';
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        };

        const stopDrag = () => {
            isDragging = false;
            this.container.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
            this.container.style.pointerEvents = 'auto';

            document.removeEventListener('mousemove', drag);
            document.removeEventListener('mouseup', stopDrag);
        };
    }

    /**
     * 获取菜单项的样式
     */
    private getMenuItemStyle(): string {
        return `
            background: none;
            border: none;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            line-height: 1;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            text-align: left;
            white-space: nowrap;
        `;
    }

    /**
     * 初始化菜单项悬停效果
     */
    private initMenuItemHoverEffects(menuItem: HTMLElement) {
        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = 'var(--b3-theme-surface-hover)';
        });

        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'none';
        });
    }

    /**
     * 更新主切换按钮的显示
     */
    private updateMainSwitchButton() {
        if (!this.mainSwitchBtn) return;

        let icon = '🔄'; // 默认设置图标
        let title = i18n('switcherMenu') || '切换菜单';


        this.mainSwitchBtn.innerHTML = icon;
        this.mainSwitchBtn.title = title;
    }

    /**
     * 切换显示/隐藏切换菜单
     */
    private toggleSwitchMenu() {
        if (this.switchMenu.style.display === 'flex') {
            this.hideSwitchMenu();
        } else {
            this.showSwitchMenu();
        }
    }

    /**
     * 显示切换菜单
     */
    private showSwitchMenu() {
        this.switchMenu.style.display = 'flex';
        // 更新菜单内容
        this.updateSwitchMenuContent();

        // 添加动画效果
        this.switchMenu.style.opacity = '0';
        this.switchMenu.style.transform = 'translateY(-10px) scale(0.95)';

        requestAnimationFrame(() => {
            this.switchMenu.style.transition = 'all 0.2s ease';
            this.switchMenu.style.opacity = '1';
            this.switchMenu.style.transform = 'translateY(0) scale(1)';
        });
    }

    /**
     * 隐藏切换菜单
     */
    private hideSwitchMenu() {
        this.switchMenu.style.transition = 'all 0.2s ease';
        this.switchMenu.style.opacity = '0';
        this.switchMenu.style.transform = 'translateY(-10px) scale(0.95)';

        setTimeout(() => {
            this.switchMenu.style.display = 'none';
        }, 200);
    }

    /**
     * 更新切换菜单的内容
     */
    private updateSwitchMenuContent() {
        if (!this.modeToggleBtn) return;

        // 更新计时模式切换按钮的文字
        this.modeToggleBtn.innerHTML = `${this.isCountUp ? '🍅' : '⏱️'} ${this.isCountUp ? (i18n('switchToCountdown') || '切换到倒计时') : (i18n('switchToCountUp') || '切换到正计时')}`;
    }

    private toggleMode() {
        if (this.isRunning) {
            showMessage(i18n('pleaseStopTimerFirst') || '请先停止当前计时器再切换模式', 2000);
            return;
        }

        this.isCountUp = !this.isCountUp;

        // 更新主按钮和菜单内容
        this.updateMainSwitchButton();
        this.updateSwitchMenuContent();

        // 如果是BrowserWindow模式，更新窗口内容
        if (PomodoroTimer.browserWindowInstance && !PomodoroTimer.browserWindowInstance.isDestroyed()) {
            this.updateBrowserWindowContent(PomodoroTimer.browserWindowInstance);
        }

        // 重置状态
        this.resetTimer();

        const modeText = this.isCountUp ? (i18n('countUpMode') || '正计时') : (i18n('countdownMode') || '倒计时');
        showMessage((i18n('switchedToMode') || '已切换到') + modeText + (i18n('mode') || '模式'), 2000);
    }

    /**
     * 设置响应式布局，根据窗口大小调整元素尺寸
     */
    private setupResponsiveLayout(
        container: HTMLElement,
        progressContainer: HTMLElement,
        svg: SVGSVGElement,
        bgCircle: SVGCircleElement,
        centerContainer: HTMLElement,
        statusIcon: HTMLElement
    ) {
        const updateLayout = () => {
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;

            // 获取content区域的实际可用高度（减去header高度）
            const header = this.container.querySelector('.pomodoro-header') as HTMLElement;
            const headerHeight = header ? header.offsetHeight : 40;
            const availableHeight = containerHeight - headerHeight;

            // 根据容器大小计算元素尺寸，考虑宽度和可用高度
            const minDimension = Math.min(containerWidth * 0.9, availableHeight * 0.6);

            // 圆环大小：动态计算，最小100px，最大500px
            let circleSize = Math.max(100, Math.min(500, minDimension));
            let radius = circleSize / 2.2;

            // 根据圆环大小动态计算描边宽度
            const strokeWidth = Math.max(4, Math.min(15, circleSize * 0.08));

            // 更新圆环尺寸
            progressContainer.style.width = `${circleSize}px`;
            progressContainer.style.height = `${circleSize}px`;
            svg.style.width = `${circleSize}px`;
            svg.style.height = `${circleSize}px`;
            svg.setAttribute('viewBox', `0 0 ${circleSize} ${circleSize}`);

            const center = circleSize / 2;
            bgCircle.setAttribute('cx', center.toString());
            bgCircle.setAttribute('cy', center.toString());
            bgCircle.setAttribute('r', radius.toString());
            bgCircle.setAttribute('stroke-width', strokeWidth.toString());
            this.circularProgress.setAttribute('cx', center.toString());
            this.circularProgress.setAttribute('cy', center.toString());
            this.circularProgress.setAttribute('r', radius.toString());
            this.circularProgress.setAttribute('stroke-width', strokeWidth.toString());

            // 更新进度条周长
            const circumference = 2 * Math.PI * radius;
            this.currentCircumference = circumference; // 更新当前圆周长度
            this.circularProgress.style.strokeDasharray = `${circumference}`;
            // 不要在这里设置offset，让updateDisplay根据当前进度计算

            // 更新中心控制区域
            const centerSize = circleSize * 0.7;
            centerContainer.style.width = `${centerSize}px`;
            centerContainer.style.height = `${centerSize}px`;

            // 更新状态图标大小
            const iconSize = circleSize * 0.3;
            statusIcon.style.fontSize = `${iconSize}px`;

            // 更新控制按钮大小
            const btnSize = circleSize * 0.25;
            this.startPauseBtn.style.width = `${btnSize}px`;
            this.startPauseBtn.style.height = `${btnSize}px`;
            this.startPauseBtn.style.fontSize = `${btnSize * 0.5}px`;

            const stopBtnSize = btnSize * 0.85;
            this.stopBtn.style.width = `${stopBtnSize}px`;
            this.stopBtn.style.height = `${stopBtnSize}px`;
            this.stopBtn.style.fontSize = `${stopBtnSize * 0.5}px`;

            // 更新时间显示大小 - 使用circleSize作为基准更合理
            const timeSize = Math.max(24, Math.min(100, circleSize * 0.25));
            this.timeDisplay.style.fontSize = `${timeSize}px`;

            // 更新状态文字大小
            const statusSize = Math.max(12, Math.min(28, circleSize * 0.1));
            this.statusDisplay.style.fontSize = `${statusSize}px`;

            // 更新事件标题大小
            const eventTitle = this.container.querySelector('.pomodoro-event-title') as HTMLElement;
            if (eventTitle) {
                const titleSize = Math.max(12, Math.min(50, availableHeight * 0.05));
                eventTitle.style.fontSize = `${titleSize}px`;
                eventTitle.style.padding = `${Math.max(4, titleSize * 0.3)}px ${Math.max(8, titleSize * 0.6)}px`;
                // 确保标题在小窗口下也能正常显示省略号
                eventTitle.style.maxWidth = `${Math.max(110, containerWidth - 40)}px`;
                eventTitle.style.minWidth = '0'; // 允许缩小
            }

            // 更新统计信息大小
            if (this.statsContainer) {
                const statsVisible = availableHeight > 250; // 高度太小时隐藏统计
                this.statsContainer.style.display = statsVisible ? 'flex' : 'none';

                if (statsVisible) {
                    const statsSize = Math.max(15, Math.min(16, availableHeight * 0.04));
                    const statsValueSize = Math.max(20, Math.min(28, availableHeight * 0.07));

                    const statLabels = this.statsContainer.querySelectorAll('div[style*="font-size: 11px"], div[style*="font-size: 16px"]');
                    statLabels.forEach((label: HTMLElement) => {
                        if (label.textContent === (i18n('todayFocus') || '今日专注') ||
                            label.textContent === (i18n('weekFocus') || '本周专注')) {
                            label.style.fontSize = `${statsSize}px`;
                        }
                    });

                    if (this.todayFocusDisplay) this.todayFocusDisplay.style.fontSize = `${statsValueSize}px`;
                    if (this.weekFocusDisplay) this.weekFocusDisplay.style.fontSize = `${statsValueSize}px`;

                    // 自适应padding和宽度
                    this.statsContainer.style.padding = `${Math.max(8, availableHeight * 0.02)}px ${Math.max(12, containerWidth * 0.02)}px`;
                    this.statsContainer.style.width = '100%';
                    this.statsContainer.style.maxWidth = '100%';
                }
            }

            // 更新番茄计数和音量控制按钮的字体大小
            const pomodoroCount = this.container.querySelector('.pomodoro-count') as HTMLElement;
            if (pomodoroCount) {
                const countSize = Math.max(12, Math.min(50, availableHeight * 0.035));
                pomodoroCount.style.fontSize = `${countSize}px`;
            }

            const soundControlBtn = this.container.querySelector('.pomodoro-sound-control') as HTMLElement;
            if (soundControlBtn) {
                const soundControlSize = Math.max(12, Math.min(50, availableHeight * 0.035));
                soundControlBtn.style.fontSize = `${soundControlSize}px`;
            }

            // 强制重新渲染进度
            this.updateDisplay();
        };

        // 初始化时执行一次
        setTimeout(updateLayout, 100);

        // 监听Resize事件
        const resizeObserver = new ResizeObserver(() => {
            updateLayout();
        });

        resizeObserver.observe(container);
    }

    private toggleExpand() {
        this.isExpanded = !this.isExpanded;

        if (this.isExpanded) {
            this.statsContainer.style.display = 'flex';
            this.expandToggleBtn.innerHTML = '📉';
            this.expandToggleBtn.title = i18n('collapse') || '折叠';
            this.container.style.height = 'auto';
        } else {
            this.statsContainer.style.display = 'none';
            this.expandToggleBtn.innerHTML = '📈';
            this.expandToggleBtn.title = i18n('expand') || '展开';
            this.container.style.height = 'auto';
        }

        if (this.isExpanded) {
            this.updateStatsDisplay();
        }
    }

    private async updateStatsDisplay() {
        if (!this.isExpanded) return;

        try {
            const todayTime = this.recordManager.getTodayFocusTime();
            const weekTime = this.recordManager.getWeekFocusTime();

            // BrowserWindow 模式：更新窗口内容
            if (!this.isTabMode && this.container && (this.container as any).webContents) {
                const todayTimeStr = this.recordManager.formatTime(todayTime);
                const weekTimeStr = this.recordManager.formatTime(weekTime);
                // BrowserWindow 中没有主题变量，使用内联颜色以保证进度可见
                const dailyFocusGoalHours = this.settings.dailyFocusGoal ?? 0;
                const surfaceColor = this.getCssVariable('--b3-theme-surface');
                const successColor = this.getCssVariable('--b3-card-success-background');
                const warnColor = '#FF6B6B';
                let progress = 0;
                let color = warnColor;
                if (dailyFocusGoalHours > 0) {
                    const goalMinutes = dailyFocusGoalHours * 60;
                    progress = Math.min((todayTime / goalMinutes) * 100, 100);
                    color = todayTime >= goalMinutes ? 'rgb(76, 175, 80)' : warnColor;
                }

                // 计算吸附模式下的当前番茄钟进度（仅基于当前番茄钟会话）
                let dockProgress = 0;
                try {
                    if (this.isWorkPhase && this.currentPhaseOriginalDuration > 0 && this.isRunning) {
                        const totalSeconds = this.currentPhaseOriginalDuration * 60;
                        if (this.isCountUp) {
                            dockProgress = Math.min((this.timeElapsed / totalSeconds) * 100, 100);
                        } else {
                            const elapsed = Math.max(0, totalSeconds - this.timeLeft);
                            dockProgress = Math.min((elapsed / totalSeconds) * 100, 100);
                        }
                    } else {
                        // 未开始或非工作阶段时，吸附进度应为 0
                        dockProgress = 0;
                    }
                } catch (e) {
                    dockProgress = 0;
                }

                await (this.container as any).webContents.executeJavaScript(`
                    try {
                        if (document.getElementById('todayFocusTime')) {
                            document.getElementById('todayFocusTime').textContent = '${todayTimeStr.replace(/'/g, "\\'")}';
                        }
                        if (document.getElementById('weekFocusTime')) {
                            document.getElementById('weekFocusTime').textContent = '${weekTimeStr.replace(/'/g, "\\'")}';
                        }
                        const stats=document.querySelector('.pomodoro-stats');
                        if(stats) stats.style.background = 'linear-gradient(to right, ${successColor} ${progress}%, ${surfaceColor} ${progress}%)';
                        const todayEl=document.getElementById('todayFocusTime'); if(todayEl) todayEl.style.color='${color}';
                        // 如果处于吸附模式，更新进度条高度（显示当前番茄钟进度，未开始为 0）
                        const dockFill = document.getElementById('dockedProgressBar');
                        if(dockFill) dockFill.style.height = (Math.max(0, Math.min(100, ${dockProgress})) + '%');
                    } catch(e) { console.error('[PomodoroTimer] updateStatsDisplay script error:', e); }
                `);
                return;
            }

            // DOM 模式：直接更新元素
            if (!this.todayFocusDisplay || !this.weekFocusDisplay) {
                return;
            }

            this.todayFocusDisplay.textContent = this.recordManager.formatTime(todayTime);
            this.weekFocusDisplay.textContent = this.recordManager.formatTime(weekTime);

            const dailyFocusGoalHours = this.settings.dailyFocusGoal ?? 0;
            if (dailyFocusGoalHours > 0) {
                const goalMinutes = dailyFocusGoalHours * 60;
                const progress = Math.min((todayTime / goalMinutes) * 100, 100);
                if (this.statsContainer) {
                    this.statsContainer.style.background = `linear-gradient(to right, var(--b3-card-success-background) ${progress}%, var(--b3-theme-surface) ${progress}%)`;
                }

                if (todayTime >= goalMinutes) {
                    this.todayFocusDisplay.style.color = 'rgb(76, 175, 80)';
                } else {
                    this.todayFocusDisplay.style.color = '#FF6B6B';
                }
            } else {
                if (this.statsContainer) {
                    this.statsContainer.style.background = 'var(--b3-theme-surface)';
                }
                this.todayFocusDisplay.style.color = '#FF6B6B';
            }
        } catch (error) {
            console.error('更新统计显示失败:', error);
            if (this.todayFocusDisplay) this.todayFocusDisplay.textContent = '0m';
            if (this.weekFocusDisplay) this.weekFocusDisplay.textContent = '0m';
        }
    }

    private updateDisplay() {
        // 如果窗口已关闭，不执行任何更新
        if (this.isWindowClosed) {
            return;
        }

        let displayTime: number;
        let minutes: number;
        let seconds: number;

        if (this.isCountUp) {
            // 正计时模式
            if (this.isWorkPhase) {
                // 工作时间：正计时显示
                displayTime = this.timeElapsed;
                minutes = Math.floor(displayTime / 60);
                seconds = displayTime % 60;
            } else {
                // 休息时间：倒计时显示
                displayTime = this.breakTimeLeft;
                minutes = Math.floor(displayTime / 60);
                seconds = displayTime % 60;
            }
        } else {
            // 倒计时模式
            displayTime = this.timeLeft;
            minutes = Math.floor(displayTime / 60);
            seconds = displayTime % 60;
        }

        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // BrowserWindow 模式：使用统一的更新方法
        if (!this.isTabMode && this.container && (this.container as any).webContents) {
            try {
                if (!(this.container as any).isDestroyed()) {
                    this.updateBrowserWindowDisplay(this.container);
                    return;
                } else {
                    // BrowserWindow 被销毁（例如系统休眠恢复后），停止计时器
                    console.warn('[PomodoroTimer] BrowserWindow was destroyed, stopping timer');
                    this.close();
                    return;
                }
            } catch (error) {
                // 如果检查 isDestroyed() 时出错，也认为窗口已销毁
                console.warn('[PomodoroTimer] Error checking window state, assuming destroyed:', error);
                this.close();
                return;
            }
        }

        // DOM 模式：直接更新元素
        if (!this.timeDisplay) return;

        this.timeDisplay.textContent = timeStr;

        // 进度条逻辑
        let progress: number;
        // 使用当前实际的圆周长度（由响应式布局计算）
        const circumference = this.currentCircumference;

        if (this.isCountUp && this.isWorkPhase) {
            // 正计时工作时间：根据番茄时长计算当前番茄的进度
            const pomodoroLength = this.settings.workDuration * 60;
            const currentCycleTime = this.timeElapsed % pomodoroLength;
            progress = currentCycleTime / pomodoroLength;
        } else if (this.isCountUp && !this.isWorkPhase) {
            // 正计时休息时间：倒计时进度
            const totalBreakTime = this.isLongBreak ?
                this.settings.longBreakDuration * 60 :
                this.settings.breakDuration * 60;
            progress = (totalBreakTime - this.breakTimeLeft) / totalBreakTime;
        } else {
            // 倒计时模式
            progress = ((this.totalTime - this.timeLeft) / this.totalTime);
        }

        const offset = circumference * (1 - progress);
        if (this.circularProgress) {
            this.circularProgress.style.strokeDashoffset = offset.toString();
        }

        // 更新颜色和状态显示
        let color = '#FF6B6B';
        let statusText = i18n('pomodoroWork') || '工作时间';
        let statusIconHtml = this.isCountUp ? '⏱️' : '🍅';

        if (!this.isWorkPhase) {
            if (this.isLongBreak) {
                color = '#9C27B0';
                statusText = i18n('pomodoroLongBreak') || '长时休息';
                statusIconHtml = '🧘‍♀️';
            } else {
                color = '#4CAF50';
                statusText = i18n('pomodoroBreak') || '短时休息';
                statusIconHtml = '🍵';
            }
        }

        if (this.circularProgress) {
            this.circularProgress.setAttribute('stroke', color);
        }
        if (this.statusDisplay) {
            this.statusDisplay.textContent = statusText;
        }

        // 更新状态图标
        const statusIcon = this.container?.querySelector('.pomodoro-status-icon');
        if (statusIcon) {
            statusIcon.innerHTML = statusIconHtml;
        }

        // 更新番茄数量
        const pomodoroCountElement = this.container?.querySelector('#pomodoroCount');
        if (pomodoroCountElement) {
            pomodoroCountElement.textContent = this.completedPomodoros.toString();
        }
        // 同步骰子图标显示状态
        const diceEl = this.container?.querySelector('.pomodoro-dice') as HTMLElement | null;
        if (diceEl) {
            try {
                diceEl.style.display = this.randomRestEnabled ? 'inline' : 'none';
            } catch (e) {
                // 忽略DOM更新错误
            }
        }
        // 更新随机微休息计数显示
        const randomCountEl = this.container?.querySelector('#randomRestCount') as HTMLElement | null;
        if (randomCountEl) {
            try {
                randomCountEl.textContent = this.randomRestCount.toString();
                randomCountEl.style.display = this.randomRestEnabled ? 'inline' : 'none';
            } catch (e) {
                // 忽略DOM更新错误
            }
        }

        // 更新DOM窗口吸附模式的进度条
        if (this.isDocked && !this.isTabMode && !(this.container as any)?.webContents) {
            this.updateDockedProgressBar();
        }

        // 更新按钮状态和位置
        if (!this.startPauseBtn) return;

        if (!this.isRunning) {
            this.startPauseBtn.innerHTML = '▶️';
            // 重置按钮位置
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
            if (this.stopBtn) this.stopBtn.style.display = 'none';
        } else if (this.isPaused) {
            this.startPauseBtn.innerHTML = '▶️';
            if (this.stopBtn) {
                this.stopBtn.style.display = 'flex';
                // 暂停状态下自动设置按钮位置，避免重叠
                const startBtnWidth = parseFloat(getComputedStyle(this.startPauseBtn).width) || 32;
                const stopBtnWidth = parseFloat(getComputedStyle(this.stopBtn).width) || 28;
                const gap = Math.max(4, startBtnWidth * 0.15);
                const startOffset = -(stopBtnWidth / 2 + gap / 2);
                const stopOffset = startBtnWidth / 2 + gap / 2;
                this.startPauseBtn.style.transform = `translate(-50%, -50%) translateX(${startOffset}px)`;
                this.stopBtn.style.transform = `translate(-50%, -50%) translateX(${stopOffset}px)`;
            }
        } else {
            this.startPauseBtn.innerHTML = '⏸';
            // 重置按钮位置
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
            this.stopBtn.style.display = 'none';
        }

        // 如果是最小化状态，更新最小化显示
        if (this.isMinimized) {
            this.updateMinimizedDisplay();
            return;
        }
    }

    private toggleTimer() {
        // 确保在用户手势上下文中初始化音频
        if (!this.audioInitialized) {
            this.initializeAudioPlayback();
        }

        // 检查是否是 BrowserWindow 模式
        const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';

        if (!this.isRunning) {
            this.startTimer();
        } else {
            if (this.isPaused) {
                this.resumeTimer();
            } else {
                this.pauseTimer();

                // 只在非 BrowserWindow 模式下直接操作 DOM
                if (!isBrowserWindow) {
                    // 暂停后立即显示继续和停止按钮，使用自适应间距
                    const statusIcon = this.container.querySelector('.pomodoro-status-icon') as HTMLElement;
                    if (statusIcon) {
                        statusIcon.style.opacity = '0.3';
                    }

                    // 根据按钮大小自适应计算间距
                    const startBtnWidth = parseFloat(getComputedStyle(this.startPauseBtn).width) || 32;
                    const stopBtnWidth = parseFloat(getComputedStyle(this.stopBtn).width) || 28;
                    const gap = Math.max(4, startBtnWidth * 0.15); // 按钮之间的间距，至少4px
                    const startOffset = -(stopBtnWidth / 2 + gap / 2);
                    const stopOffset = startBtnWidth / 2 + gap / 2;

                    this.startPauseBtn.style.opacity = '1';
                    this.stopBtn.style.opacity = '1';
                    this.stopBtn.style.display = 'flex';
                    this.startPauseBtn.style.transform = `translate(-50%, -50%) translateX(${startOffset}px)`;
                    this.stopBtn.style.transform = `translate(-50%, -50%) translateX(${stopOffset}px)`;
                }
            }
        }

        // 立即更新显示
        this.updateDisplay();
    }

    private async startTimer() {
        this.isRunning = true;
        this.isPaused = false;

        // 确保音频播放权限已被获取（特别是为了结束提示音），强制重新初始化以处理权限丢失
        await this.initializeAudioPlayback(true);

        // 改进的时间继承逻辑
        if (this.startTime === 0) {
            // 新番茄钟或重置后的首次启动
            if (this.isCountUp) {
                // 正计时模式：从已有的时间开始
                this.startTime = Date.now() - (this.timeElapsed * 1000);
            } else {
                // 倒计时模式：从已有的进度开始
                const elapsedTime = this.totalTime - this.timeLeft;
                this.startTime = Date.now() - (elapsedTime * 1000);
            }
        } else {
            // 继承状态后的启动，调整开始时间以保持正确的经过时间
            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    // 正计时工作时间：基于当前已用时间重新计算开始时间
                    this.startTime = Date.now() - (this.timeElapsed * 1000);
                } else {
                    // 正计时休息时间：基于剩余时间重新计算开始时间
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;
                    const usedBreakTime = totalBreakTime - this.breakTimeLeft;
                    this.startTime = Date.now() - (usedBreakTime * 1000);
                }
            } else {
                // 倒计时模式：基于剩余时间重新计算开始时间
                const elapsedTime = this.totalTime - this.timeLeft;
                this.startTime = Date.now() - (elapsedTime * 1000);
            }
        }



        // 播放对应的背景音
        if (this.isWorkPhase && this.workAudio) {
            await this.safePlayAudio(this.workAudio);
        } else if (!this.isWorkPhase) {
            if (this.isLongBreak && this.longBreakAudio) {
                await this.safePlayAudio(this.longBreakAudio);
            } else if (!this.isLongBreak && this.breakAudio) {
                await this.safePlayAudio(this.breakAudio);
            }
        }

        // 启动随机微休息定时器（仅在工作时间）
        if (this.isWorkPhase) {
            this.startRandomRestTimer();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.timer = window.setInterval(() => {
            // 如果窗口已关闭，停止定时器
            if (this.isWindowClosed) {
                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = null;
                }
                return;
            }

            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    // 正计时工作时间：elapsedSinceStart 已经包含了继承的时间
                    // 因为 startTime = Date.now() - (继承的秒数 * 1000)
                    this.timeElapsed = elapsedSinceStart;

                    // 检查是否完成一个番茄
                    const pomodoroLength = this.settings.workDuration * 60;
                    const currentCycleTime = this.timeElapsed % pomodoroLength;

                    if (this.timeElapsed > 0 && currentCycleTime === 0) {
                        if (this.lastPomodoroTriggerTime !== this.timeElapsed) {
                            this.lastPomodoroTriggerTime = this.timeElapsed;
                            this.completePomodoroPhase();
                        }
                    }
                } else {
                    // 正计时休息时间：倒计时显示
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;

                    this.breakTimeLeft = totalBreakTime - elapsedSinceStart;

                    if (this.breakTimeLeft <= 0) {
                        this.breakTimeLeft = 0;
                        this.completeBreakPhase();
                    }
                }
            } else {
                // 倒计时模式：elapsedSinceStart 已经包含了继承的时间
                this.timeLeft = this.totalTime - elapsedSinceStart;

                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }

            this.updateDisplay();
        }, 500);


        // 更新显示
        this.updateDisplay();
    }
    private async pauseTimer() {
        this.isPaused = true;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // 记录暂停时已经经过的时间（单位：秒）
        const currentTime = Date.now();
        this.pausedTime = Math.floor((currentTime - this.startTime) / 1000);

        // 停止随机微休息定时器
        this.stopRandomRestTimer();

        // 暂停所有背景音
        this.stopAllAudio();

        // 更新显示
        this.updateDisplay();
    }

    private async resumeTimer() {
        this.isPaused = false;

        // 确保音频播放权限已被获取（特别是为了结束提示音），强制重新初始化以处理权限丢失
        await this.initializeAudioPlayback(true);

        // 重新计算开始时间，保持已暂停的时间
        // 注意：startTime 应该是"如果从0开始计时应该在什么时候开始"
        // 所以是 现在 - pausedTime（已经过的秒数）
        this.startTime = Date.now() - (this.pausedTime * 1000);


        // 恢复对应的背景音
        if (this.isWorkPhase && this.workAudio) {
            await this.safePlayAudio(this.workAudio);
        } else if (!this.isWorkPhase) {
            if (this.isLongBreak && this.longBreakAudio) {
                await this.safePlayAudio(this.longBreakAudio);
            } else if (!this.isLongBreak && this.breakAudio) {
                await this.safePlayAudio(this.breakAudio);
            }
        }

        // 重新启动随机微休息定时器（仅在工作时间）
        if (this.isWorkPhase) {
            this.startRandomRestTimer();
        }

        this.timer = window.setInterval(() => {
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    // 正计时：直接使用从开始到现在的总时间
                    this.timeElapsed = elapsedSinceStart;

                    const pomodoroLength = this.settings.workDuration * 60;
                    const currentCycleTime = this.timeElapsed % pomodoroLength;

                    if (this.timeElapsed > 0 && currentCycleTime === 0) {
                        if (this.lastPomodoroTriggerTime !== this.timeElapsed) {
                            this.lastPomodoroTriggerTime = this.timeElapsed;
                            this.completePomodoroPhase();
                        }
                    }
                } else {
                    const totalBreakTime = this.isLongBreak ?
                        this.settings.longBreakDuration * 60 :
                        this.settings.breakDuration * 60;

                    this.breakTimeLeft = totalBreakTime - elapsedSinceStart;

                    if (this.breakTimeLeft <= 0) {
                        this.breakTimeLeft = 0;
                        this.completeBreakPhase();
                    }
                }
            } else {
                // 倒计时：从总时间减去已经过的时间
                this.timeLeft = this.totalTime - elapsedSinceStart;

                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }

            this.updateDisplay();
        }, 500);

        // 更新显示
        this.updateDisplay();
    }

    private async startWorkTime() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomRestTimer(); // 停止随机微休息

        this.isWorkPhase = true;
        this.isLongBreak = false;
        this.isRunning = false;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间
        this.lastPomodoroTriggerTime = -1; // 重置上次触发时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.workDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            // 不重置番茄计数，保持累计
            // this.completedPomodoros = 0;
        } else {
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
        }

        this.updateDisplay();
        this.updateMainSwitchButton(); // 更新主按钮显示
        showMessage('💪 ' + (i18n('pomodoroWork') || '开始工作时间'));
    }

    private async startShortBreak() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomRestTimer(); // 停止随机微休息

        this.isWorkPhase = false;
        this.isLongBreak = false;
        this.isRunning = false;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间
        this.lastPomodoroTriggerTime = -1; // 重置上次触发时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.breakDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = this.settings.breakDuration * 60;
        } else {
            this.timeLeft = this.settings.breakDuration * 60;
            this.totalTime = this.timeLeft;
        }

        this.updateDisplay();
        this.updateMainSwitchButton(); // 更新主按钮显示
        showMessage('🍵 ' + (i18n('pomodoroBreak') || '开始短时休息'));
    }

    private async startLongBreak() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomRestTimer(); // 停止随机微休息

        this.isWorkPhase = false;
        this.isLongBreak = true;
        this.isRunning = false;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间
        this.lastPomodoroTriggerTime = -1; // 重置上次触发时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.longBreakDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = this.settings.longBreakDuration * 60;
        } else {
            this.timeLeft = this.settings.longBreakDuration * 60;
            this.totalTime = this.timeLeft;
        }

        this.updateDisplay();
        this.updateMainSwitchButton(); // 更新主按钮显示
        showMessage('🧘 ' + (i18n('pomodoroLongBreak') || '开始长时休息'));
    }

    private async resetTimer() {
        // 如果在工作阶段中途停止（正计时或倒计时都有可能），询问用户是否将已用时间记录为一次番茄计时
        if (this.isWorkPhase) {
            // 计算已用秒数：正计时直接使用 timeElapsed，倒计时使用 totalTime - timeLeft
            const elapsedSeconds = this.isCountUp ? this.timeElapsed : (this.totalTime - this.timeLeft);
            if (elapsedSeconds > 0) {
                const minutes = Math.floor(elapsedSeconds / 60);
                const eventId = this.reminder.id;
                const eventTitle = this.reminder.title || '番茄专注';

                // 检查是否是 BrowserWindow 模式
                const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';

                if (isBrowserWindow) {
                    // BrowserWindow 模式：使用自定义确认弹窗
                    this.openConfirmWindow(
                        i18n('pomodoroStopConfirmTitle') || '中断番茄钟',
                        String(i18n('pomodoroStopConfirmContent', { minutes: minutes.toString() }) || `检测到你已专注 ${minutes} 分钟，是否将此次专注记录为番茄？`),
                        async () => {
                            try {
                                await this.recordManager.recordWorkSession(
                                    Math.max(1, minutes),
                                    eventId,
                                    eventTitle,
                                    this.currentPhaseOriginalDuration,
                                    this.isCountUp,
                                    this.isCountUp
                                );
                                this.updateStatsDisplay();
                                showMessage(i18n('pomodoroRecorded') || '已记录此次专注', 2000);
                                // 触发 reminderUpdated 事件
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            } catch (err) {
                                console.error('记录番茄专注失败:', err);
                                showMessage(i18n('pomodoroRecordFailed') || '记录失败', 3000);
                            }
                        }
                    );
                } else {
                    // 普通模式：使用思源 confirm 弹窗
                    await confirm(
                        i18n('pomodoroStopConfirmTitle') || '中断番茄钟',
                        String(i18n('pomodoroStopConfirmContent', { minutes: minutes.toString() }) || `检测到你已专注 ${minutes} 分钟，是否将此次专注记录为番茄？`),
                        async () => {
                            try {
                                await this.recordManager.recordWorkSession(
                                    Math.max(1, minutes),
                                    eventId,
                                    eventTitle,
                                    this.currentPhaseOriginalDuration,
                                    this.isCountUp,
                                    this.isCountUp
                                );
                                this.updateStatsDisplay();
                                showMessage(i18n('pomodoroRecorded') || '已记录此次专注', 2000);
                                // 触发 reminderUpdated 事件
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            } catch (err) {
                                console.error('记录番茄专注失败:', err);
                                showMessage(i18n('pomodoroRecordFailed') || '记录失败', 3000);
                            }
                        }
                    );
                }
            }
        }

        this.isRunning = false;
        this.isPaused = false;
        this.isWorkPhase = true;
        this.isLongBreak = false;
        this.timeElapsed = 0;
        this.breakTimeLeft = 0;
        this.pausedTime = 0; // 重置暂停时间
        this.startTime = 0; // 重置开始时间
        // 注释掉清空番茄计数的代码，保持总计数
        // this.completedPomodoros = 0;

        // BrowserWindow 模式下没有 statusDisplay DOM 元素
        if (this.statusDisplay) {
            this.statusDisplay.textContent = i18n('pomodoroWork') || '工作时间';
        }

        // 重置当前阶段的原始时长为工作时长
        this.currentPhaseOriginalDuration = this.settings.workDuration;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomRestTimer(); // 停止随机微休息

        if (this.isCountUp) {
            this.timeElapsed = 0;
        } else {
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
        }

        // 重置按钮位置（仅 DOM 模式）
        if (this.startPauseBtn) {
            this.startPauseBtn.style.transform = 'translate(-50%, -50%)';
        }
        if (this.stopBtn) {
            this.stopBtn.style.display = 'none';
            this.stopBtn.style.transform = 'translate(-50%, -50%) translateX(16px)';
        }

        this.updateDisplay();
        this.updateMainSwitchButton(); // 更新主按钮显示

        // 非自动模式下，更新统计显示
        if (!this.autoMode) {
            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        }

        // 如果有 pending 设置（在运行时跳过的设置更新），现在应用它们
        if (this.pendingSettings) {
            await this.updateState(
                this.pendingSettings.reminder,
                this.pendingSettings.settings,
                this.pendingSettings.isCountUp,
                this.pendingSettings.inheritState,
                false, // 不强制，因为现在已经停止了
                false  // 显示通知
            );
        }
    }

    /**
     * 初始化系统弹窗功能
     */
    private async initSystemNotification() {
        if (!this.systemNotificationEnabled) {
            return;
        }

        try {
            // 动态导入node-notifier，避免在不支持的环境中报错
            if (typeof require !== 'undefined') {
            }
        } catch (error) {
            console.warn('初始化系统弹窗失败，将禁用此功能:', error);
            this.systemNotificationEnabled = false;
        }
    }

    /**
     * 显示系统弹窗通知
     */
    private showSystemNotification(title: string, message: string, autoCloseDelay?: number) {
        if (!this.systemNotificationEnabled) {
            return;
        }

        // 判断是否是移动端
        const frontend = getFrontend();
        const isMobile = frontend.endsWith('mobile');

        if (isMobile) {
            // 手机端：使用内核接口进行系统通知
            try {
                sendNotification(title, message);
            } catch (error) {
                console.warn('手机端发送系统通知失败:', error);
            }
            return;
        }

        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                // 使用浏览器通知作为备选方案
                const notification = new Notification(title, {
                    icon: '/favicon.ico',
                    body: message,
                    requireInteraction: !autoCloseDelay,
                    silent: false
                });

                // 点击通知时的处理
                notification.onclick = () => {
                    window.focus();
                    notification.close();
                };

                // 如果设置了自动关闭延迟
                if (autoCloseDelay && autoCloseDelay > 0) {
                    setTimeout(() => {
                        notification.close();
                    }, autoCloseDelay * 1000);
                }
            }
        } catch (error) {
            console.warn('显示系统弹窗失败:', error);
        }
    }


    // 完成番茄阶段（正计时模式）
    private async completePomodoroPhase() {
        // 正计时模式下不停止计时器，只记录番茄数量
        if (!this.isCountUp) {
            // 倒计时模式才停止计时器
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }

            this.stopAllAudio();
            this.stopRandomRestTimer(); // 添加停止随机微休息

            // 播放工作结束提示音
            if (this.workEndAudio) {
                await this.safePlayAudio(this.workEndAudio);
            }

            // 打开番茄钟结束弹窗（如果启用），休息结束后才关闭
            this.openPomodoroEndWindow();

            // 显示系统弹窗通知
            if (this.systemNotificationEnabled) {
                const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');
                this.showSystemNotification(
                    `🍅 ${i18n('pomodoroWorkEnd') || '工作番茄完成！'}`,
                    `「${eventTitle}」${i18n('pomodoroWorkEndDesc') || '的工作时间已结束，是时候休息一下了！'}`
                );
            } else {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                showMessage(`🍅 ${i18n('pomodoroWorkCompleted') || '工作番茄完成！开始休息吧～'}`, 3000);
            }

            // 切换到休息阶段
            this.isWorkPhase = false;
            this.isLongBreak = false;
            this.isRunning = false;
            this.isPaused = false;
            this.breakTimeLeft = this.settings.breakDuration * 60;

            this.updateDisplay();
            this.updateMainSwitchButton(); // 更新主按钮

            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);

            // 清理 pending 设置
            this.pendingSettings = null;
            // 倒计时模式：记录完成的工作番茄（每个实例独立记录）
            const eventId = this.reminder.id;
            const eventTitle = this.reminder.title || '番茄专注';

            // 计算实际完成的时间（分钟）
            const actualDuration = Math.round(this.totalTime / 60);

            await this.recordManager.recordWorkSession(
                actualDuration,
                eventId,
                eventTitle,
                actualDuration,
                true,
                false
            );
            // 触发 reminderUpdated 事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        } else {
            // 正计时模式完成番茄后也要停止随机微休息
            this.stopRandomRestTimer();
        }

        // 更新番茄数量（正计时和倒计时都需要）
        this.completedPomodoros++;
        await this.updateReminderPomodoroCount();
        // 触发 reminderUpdated 事件
        window.dispatchEvent(new CustomEvent('reminderUpdated'));

        // 正计时模式下静默更新显示，不记录时间（时间在手动停止时统一记录）
        if (this.isCountUp) {
            setTimeout(() => {
                this.updateStatsDisplay();
                this.updateDisplay(); // 更新番茄数量显示
            }, 100);
        }
    }

    // 完成休息阶段（正计时模式）
    private async completeBreakPhase() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.stopAllAudio();
        this.stopRandomRestTimer(); // 添加停止随机微休息

        // 休息结束，关闭番茄钟结束弹窗
        this.closePomodoroEndWindow();

        // 播放休息结束提示音
        if (this.breakEndAudio) {
            await this.safePlayAudio(this.breakEndAudio);
        }

        // 显示系统弹窗通知
        const breakType = this.isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息');

        if (this.systemNotificationEnabled) {
            const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');
            this.showSystemNotification(
                `☕ ${breakType}结束！`,
                `「${eventTitle}」的${breakType}已结束，准备开始下一个工作阶段吧！`
            );
        }

        // 记录完成的休息时间（每个实例独立记录）
        const eventId = this.reminder.id;
        const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');

        await this.recordManager.recordBreakSession(
            this.currentPhaseOriginalDuration,
            eventId,
            eventTitle,
            this.currentPhaseOriginalDuration,
            this.isLongBreak,
            true
        );

        // 检查是否启用自动模式并进入下一阶段
        if (this.autoMode) {
            showMessage(`☕ ${breakType}${i18n('pomodoroBreakEndAutoWork') || '结束！自动开始下一个工作阶段'}`, 3000);

            // 自动切换到工作阶段
            setTimeout(() => {
                this.autoSwitchToWork();
            }, 1000); // 延迟1秒切换
        } else {
            showMessage(`☕ ${breakType}${i18n('pomodoroBreakEndAutoWork') || '结束！自动开始下一个工作阶段'}`, 3000);

            this.isWorkPhase = true;
            this.isLongBreak = false;
            this.isRunning = false;
            this.isPaused = false;
            this.breakTimeLeft = 0;

            // 更新 DOM 显示（如果存在）
            if (this.statusDisplay) this.statusDisplay.textContent = i18n('pomodoroWork') || '工作时间';
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
            // 设置当前阶段的原始时长
            this.currentPhaseOriginalDuration = this.settings.workDuration;

            this.updateDisplay();
            this.updateMainSwitchButton(); // 更新主按钮

            // 如果是独立 BrowserWindow，额外推送一次状态更新
            try {
                if (!this.isTabMode && this.container && (this.container as any).webContents) {
                    this.updateBrowserWindowDisplay(this.container);
                }
            } catch (e) { }

            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        }
    }

    // 完成阶段（倒计时模式）
    private async completePhase() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.stopAllAudio();
        this.stopRandomRestTimer(); // 添加停止随机微休息

        if (this.isWorkPhase) {
            // 工作阶段结束，停止随机微休息

            // 打开番茄钟结束弹窗（如果启用），休息结束后才关闭
            this.openPomodoroEndWindow();

            // 显示系统弹窗通知
            if (this.systemNotificationEnabled) {
                const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');
                this.showSystemNotification(
                    `🍅 ${i18n('pomodoroWorkEnd') || '工作时间结束！'}`,
                    `「${eventTitle}」${i18n('pomodoroWorkEndDesc') || '的工作时间已结束，是时候休息一下了！'}`
                );
            }

            // 播放工作结束提示音

            if (this.workEndAudio) {
                await this.safePlayAudio(this.workEndAudio);
            }            // 记录完成的工作番茄（每个实例独立记录）
            const eventId = this.reminder.id;
            const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');

            // 计算实际完成的时间（分钟）
            // 在倒计时模式下，实际完成时间 = totalTime（设定的总时间）
            const actualDuration = Math.round(this.totalTime / 60);

            await this.recordManager.recordWorkSession(
                actualDuration,
                eventId,
                eventTitle,
                actualDuration,
                true,
                false
            );

            // 更新番茄数量计数
            this.completedPomodoros++;
            await this.updateReminderPomodoroCount();

            // 判断是否应该进入长休息
            const shouldTakeLongBreak = this.completedPomodoros > 0 &&
                this.completedPomodoros % this.longBreakInterval === 0;

            // 检查是否启用自动模式
            if (this.autoMode) {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                if (!this.systemNotificationEnabled) {
                    showMessage(`🍅 ${i18n('pomodoroWorkEndAutoBreak') || '工作时间结束！自动开始休息'}`, 3000);
                }

                // 自动切换到休息阶段
                setTimeout(() => {
                    this.autoSwitchToBreak(shouldTakeLongBreak);
                }, 1000);
            } else {                // 非自动模式下，也要根据番茄钟数量判断休息类型
                if (shouldTakeLongBreak) {
                    // 只有在系统弹窗关闭时才显示思源笔记弹窗
                    if (!this.systemNotificationEnabled) {
                        showMessage(`🍅 ${(i18n('pomodoroCompletedLongBreak') || '工作时间结束！已完成${count}个番茄，开始长时休息').replace('${count}', String(this.completedPomodoros))}`, 3000);
                    }
                    this.isWorkPhase = false;
                    this.isLongBreak = true;
                    // 只在 DOM 模式下更新 statusDisplay
                    if (this.statusDisplay) {
                        this.statusDisplay.textContent = i18n('pomodoroLongBreak') || '长时休息';
                    }
                    this.timeLeft = this.settings.longBreakDuration * 60;
                    this.totalTime = this.timeLeft;
                    // 设置当前阶段的原始时长
                    this.currentPhaseOriginalDuration = this.settings.longBreakDuration;
                } else {
                    // 只有在系统弹窗关闭时才显示思源笔记弹窗
                    if (!this.systemNotificationEnabled) {
                        showMessage(`🍅 ${i18n('pomodoroWorkEndAutoBreak') || '工作时间结束！开始短时休息'}`, 3000);
                    }
                    this.isWorkPhase = false;
                    this.isLongBreak = false;
                    // 只在 DOM 模式下更新 statusDisplay
                    if (this.statusDisplay) {
                        this.statusDisplay.textContent = i18n('pomodoroBreak') || '短时休息';
                    }
                    this.timeLeft = this.settings.breakDuration * 60;
                    this.totalTime = this.timeLeft;
                    // 设置当前阶段的原始时长
                    this.currentPhaseOriginalDuration = this.settings.breakDuration;
                }
                this.isRunning = false;
                this.isPaused = false;
                this.updateDisplay();
            }
        } else {
            // 休息结束，关闭番茄钟结束弹窗
            this.closePomodoroEndWindow();

            // 播放休息结束提示音
            if (this.breakEndAudio) {
                await this.safePlayAudio(this.breakEndAudio);
            }

            // 记录完成的休息时间（每个实例独立记录）
            const eventId = this.reminder.id;
            const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');

            await this.recordManager.recordBreakSession(
                this.currentPhaseOriginalDuration,
                eventId,
                eventTitle,
                this.currentPhaseOriginalDuration,
                this.isLongBreak,
                true
            );

            const breakType = this.isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息');

            // 显示系统弹窗通知
            if (this.systemNotificationEnabled) {
                const eventTitle = this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');
                this.showSystemNotification(
                    `☕ ${breakType}结束！`,
                    `「${eventTitle}」的${breakType}已结束，准备开始下一个番茄钟吧！`
                );
            }

            // 检查是否启用自动模式
            if (this.autoMode) {
                // 只有在系统弹窗关闭时才显示思源笔记弹窗
                showMessage(`☕ ${breakType}${i18n('pomodoroBreakEndAutoWork') || '结束！自动开始下一个番茄钟'}`, 3000);

                // 自动切换到工作阶段
                setTimeout(() => {
                    this.autoSwitchToWork();
                }, 1000);
            } else {
                // 非自动模式：切换到工作阶段（不自动开始）
                if (!this.systemNotificationEnabled) {
                    showMessage(`☕ ${breakType}${i18n('pomodoroBreakEndSwitchWork') || '结束！切换到工作时间（不自动开始）'}`, 3000);
                }
                this.isWorkPhase = true;
                this.isLongBreak = false;
                if (this.statusDisplay) this.statusDisplay.textContent = i18n('pomodoroWork') || '工作时间';
                this.timeLeft = this.settings.workDuration * 60;
                this.totalTime = this.timeLeft;
                // 设置当前阶段的原始时长
                this.currentPhaseOriginalDuration = this.settings.workDuration;
                this.isRunning = false;
                this.isPaused = false;
                this.updateDisplay();
                this.updateMainSwitchButton();
                try {
                    if (!this.isTabMode && this.container && (this.container as any).webContents) {
                        this.updateBrowserWindowDisplay(this.container);
                    }
                } catch (e) { }
            }
        }

        // 如果不是自动模式，更新统计显示
        if (!this.autoMode) {
            setTimeout(() => {
                this.updateStatsDisplay();
            }, 100);
        }

        // 如果有 pending 设置（在运行时跳过的设置更新），现在应用它们
        if (this.pendingSettings) {
            await this.updateState(
                this.pendingSettings.reminder,
                this.pendingSettings.settings,
                this.pendingSettings.isCountUp,
                this.pendingSettings.inheritState,
                false, // 不强制，因为现在已经停止了
                false  // 显示通知
            );
        }
    }
    /**
 * 自动切换到休息阶段
 * @param isLongBreak 是否为长休息
 */
    private async autoSwitchToBreak(isLongBreak: boolean = false) {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        // 停止所有音频和定时器
        this.stopAllAudio();
        this.stopRandomRestTimer();
        if (this.autoTransitionTimer) {
            clearTimeout(this.autoTransitionTimer);
            this.autoTransitionTimer = null;
        }

        // 设置休息阶段
        this.isWorkPhase = false;
        this.isLongBreak = isLongBreak;
        this.isRunning = true;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间

        const breakDuration = isLongBreak ? this.settings.longBreakDuration : this.settings.breakDuration;

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = breakDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = breakDuration * 60;
        } else {
            this.timeLeft = breakDuration * 60;
            this.totalTime = this.timeLeft;
        }

        // 播放对应的背景音
        if (isLongBreak && this.longBreakAudio) {
            await this.safePlayAudio(this.longBreakAudio);
        } else if (!isLongBreak && this.breakAudio) {
            await this.safePlayAudio(this.breakAudio);
        }

        // 开始计时
        this.startTime = Date.now();
        this.timer = window.setInterval(() => {
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                this.breakTimeLeft = breakDuration * 60 - elapsedSinceStart;
                if (this.breakTimeLeft <= 0) {
                    this.breakTimeLeft = 0;
                    this.completeBreakPhase();
                }
            } else {
                this.timeLeft = this.totalTime - elapsedSinceStart;
                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }
            this.updateDisplay();
        }, 500);

        this.updateDisplay();
        this.updateStatsDisplay();

        const breakType = isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息');
    }

    /**
     * 自动切换到工作阶段
     */
    private async autoSwitchToWork() {
        if (!this.audioInitialized) {
            await this.initializeAudioPlayback();
        }

        // 停止所有音频和定时器
        this.stopAllAudio();
        this.stopRandomRestTimer();
        if (this.autoTransitionTimer) {
            clearTimeout(this.autoTransitionTimer);
            this.autoTransitionTimer = null;
        }

        // 设置工作阶段
        this.isWorkPhase = true;
        this.isLongBreak = false;
        this.isRunning = true;
        this.isPaused = false;
        this.pausedTime = 0; // 重置暂停时间

        // 设置当前阶段的原始时长
        this.currentPhaseOriginalDuration = this.settings.workDuration;

        if (this.isCountUp) {
            this.timeElapsed = 0;
            this.breakTimeLeft = 0;
        } else {
            this.timeLeft = this.settings.workDuration * 60;
            this.totalTime = this.timeLeft;
        }

        // 播放工作背景音
        if (this.workAudio) {
            await this.safePlayAudio(this.workAudio);
        }

        // 启动随机微休息定时器
        if (this.isWorkPhase) {
            this.startRandomRestTimer();
        }

        // 开始计时
        this.startTime = Date.now();
        this.timer = window.setInterval(() => {
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                this.timeElapsed = elapsedSinceStart;

                const pomodoroLength = this.settings.workDuration * 60;
                const currentCycleTime = this.timeElapsed % pomodoroLength;
                if (this.timeElapsed > 0 && currentCycleTime === 0) {
                    this.completePomodoroPhase();
                }
            } else {
                this.timeLeft = this.totalTime - elapsedSinceStart;
                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }
            this.updateDisplay();
        }, 500);

        this.updateDisplay();
        this.updateStatsDisplay();

    }

    private stopAllAudio() {
        // 如果是 BrowserWindow 模式，优先在窗口内停止音频
        try {
            const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';
            if (isBrowserWindow && this.container && (this.container as any).webContents) {
                try {
                    this.stopAllAudioInBrowserWindow();
                    return;
                } catch (e) {
                    console.warn('在 BrowserWindow 中停止音频失败，回退到主进程停止:', e);
                }
            }
        } catch (e) { }

        if (this.workAudio) {
            this.workAudio.pause();
            try { this.workAudio.currentTime = 0; } catch (e) { }
        }
        if (this.breakAudio) {
            this.breakAudio.pause();
            try { this.breakAudio.currentTime = 0; } catch (e) { }
        }
        if (this.longBreakAudio) {
            this.longBreakAudio.pause();
            try { this.longBreakAudio.currentTime = 0; } catch (e) { }
        }
    }

    private async updateReminderPomodoroCount() {
        try {
            const reminderData = await this.plugin.loadReminderData();

            // 每个实例（包括重复实例）使用自己的ID来保存番茄钟计数
            const targetId = this.reminder.id;

            // 对于重复实例，需要确保在 reminderData 中存在对应的条目
            // 因为重复实例不会直接保存在 reminderData 中，所以需要特殊处理
            if (this.reminder.isRepeatInstance) {
                // 获取原始任务
                const originalReminder = reminderData[this.reminder.originalId];
                if (!originalReminder) {
                    console.warn('未找到原始提醒项:', this.reminder.originalId);
                    return;
                }

                // 为重复实例创建独立的番茄钟计数记录（保存在 repeat.instancePomodoroCount 中）
                if (!originalReminder.repeat) {
                    originalReminder.repeat = {};
                }
                if (!originalReminder.repeat.instancePomodoroCount) {
                    originalReminder.repeat.instancePomodoroCount = {};
                }

                // 使用实例ID作为key保存番茄钟计数
                if (typeof originalReminder.repeat.instancePomodoroCount[targetId] !== 'number') {
                    originalReminder.repeat.instancePomodoroCount[targetId] = 0;
                }
                originalReminder.repeat.instancePomodoroCount[targetId]++;

                await this.plugin.saveReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

            } else {
                // 普通任务直接保存
                if (reminderData[targetId]) {
                    if (typeof reminderData[targetId].pomodoroCount !== 'number') {
                        reminderData[targetId].pomodoroCount = 0;
                    }

                    reminderData[targetId].pomodoroCount++;
                    await this.plugin.saveReminderData(reminderData);
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                } else {
                    console.warn('未找到对应的提醒项:', targetId);
                }
            }
        } catch (error) {
            console.error('更新提醒番茄数量失败:', error);
        }
    }

    private editTime() {
        // 如果是BrowserWindow模式，使用专门的编辑方法
        if (!this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined') {
            this.editTimeInBrowserWindow(this.container as any);
            return;
        }

        // 如果正在运行且未暂停，则不允许编辑
        if (this.isRunning && !this.isPaused) {

            showMessage(i18n('editTimeNotAllowed') || '请先暂停计时器再编辑时间', 2000);
            return;
        }

        let currentTimeString: string;

        if (this.isCountUp) {
            if (this.isWorkPhase) {
                // 正计时工作模式，不允许编辑
                return;
            } else {
                // 正计时休息模式，编辑剩余休息时间
                const currentMinutes = Math.floor(this.breakTimeLeft / 60);
                const currentSeconds = this.breakTimeLeft % 60;
                currentTimeString = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')}`;
            }
        } else {
            // 倒计时模式，编辑当前时间
            const currentMinutes = Math.floor(this.timeLeft / 60);
            const currentSeconds = this.timeLeft % 60;
            currentTimeString = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')}`;
        }

        // 创建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTimeString;

        // 根据是否全屏模式设置不同的样式
        if (this.isFullscreen) {
            input.style.cssText = `
                font-size: 20vh !important;
                font-weight: 600 !important;
                color: var(--b3-theme-on-surface);
                background: transparent;
                border: 2px solid var(--b3-theme-primary);
                border-radius: 8px;
                padding: 2vh 1vw;
                width: 60vw;
                text-align: center;
                font-variant-numeric: tabular-nums;
                outline: none;
                text-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
                line-height: 1;
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            `;
        } else {
            input.style.cssText = `
                font-size: 24px;
                font-weight: 700;
                color: var(--b3-theme-on-surface);
                background: var(--b3-theme-surface);
                border: 2px solid var(--b3-theme-primary);
                border-radius: 4px;
                padding: 2px 4px;
                width: 80px;
                max-width: 200px;
                text-align: center;
                font-variant-numeric: tabular-nums;
                outline: none;
            `;
        }
        input.placeholder = 'MM:SS';

        // 替换时间显示
        const parent = this.timeDisplay.parentNode;
        parent.replaceChild(input, this.timeDisplay);
        input.focus();
        input.select();

        // 标记编辑状态，防止重复操作
        let isEditingFinished = false;

        // 处理输入完成
        const finishEdit = () => {
            if (isEditingFinished) return;
            isEditingFinished = true;

            // 检查输入框是否仍在父节点中
            if (input.parentNode !== parent) {
                return;
            }

            const inputValue = input.value.trim();
            let newTimeInSeconds = this.parseTimeStringToSeconds(inputValue);

            if (newTimeInSeconds === null) {
                showMessage(i18n('invalidTimeFormat') || '时间格式无效，请使用 MM:SS 格式（如 25:00）', 3000);
                parent.replaceChild(this.timeDisplay, input);
                return;
            }

            // 限制时间范围（1秒到999分59秒）
            if (newTimeInSeconds < 1 || newTimeInSeconds > 59999) {
                showMessage(i18n('timeRangeLimit') || '时间必须在 00:01 到 999:59 之间', 3000);
                parent.replaceChild(this.timeDisplay, input);
                return;
            }            // 更新对应的时间
            if (this.isCountUp && !this.isWorkPhase) {
                // 正计时休息模式
                this.breakTimeLeft = newTimeInSeconds;
                // 更新当前休息阶段的原始时长
                this.currentPhaseOriginalDuration = Math.floor(newTimeInSeconds / 60);
            } else if (!this.isCountUp) {
                // 倒计时模式
                this.timeLeft = newTimeInSeconds;
                this.totalTime = newTimeInSeconds;
                // 更新当前阶段的原始时长
                this.currentPhaseOriginalDuration = Math.floor(newTimeInSeconds / 60);
            }

            // 恢复时间显示
            parent.replaceChild(this.timeDisplay, input);
            this.updateDisplay();

            const minutes = Math.floor(newTimeInSeconds / 60);
            const seconds = newTimeInSeconds % 60;
            const phaseText = this.isWorkPhase ? (i18n('pomodoroWork') || '工作时间') : (this.isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息'));
            showMessage(`${phaseText}${i18n('setTo') || '已设置为'} ${minutes}:${seconds.toString().padStart(2, '0')}`, 2000);
        };

        // 处理取消编辑
        const cancelEdit = () => {
            if (isEditingFinished) return;
            isEditingFinished = true;

            // 检查输入框是否仍在父节点中
            if (input.parentNode === parent) {
                parent.replaceChild(this.timeDisplay, input);
            }
        };

        // 事件监听
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });

        // 限制输入格式
        input.addEventListener('input', () => {
            let value = input.value;
            value = value.replace(/[^0-9:]/g, '')

            // 增加长度限制，支持到 999:59
            if (value.length > 6) {
                value = value.substring(0, 6);
            }

            input.value = value;
        });
    }

    private parseTimeStringToSeconds(timeStr: string): number | null {
        if (!timeStr) return null;

        let minutes = 0;
        let seconds = 0;

        if (timeStr.includes(':')) {
            const parts = timeStr.split(':');
            if (parts.length > 2) return null;

            // 处理像 "25:" 或 ":30" 这样的输入
            minutes = parts[0] ? parseInt(parts[0], 10) : 0;
            seconds = parts[1] ? parseInt(parts[1], 10) : 0;
        } else {
            // 纯数字输入
            const numStr = timeStr.trim();

            // 如果是4位数字，自动识别为 MMSS 格式（如 0010 = 00:10）
            if (numStr.length === 4 && /^\d{4}$/.test(numStr)) {
                minutes = parseInt(numStr.substring(0, 2), 10);
                seconds = parseInt(numStr.substring(2, 4), 10);
            } else {
                // 其他情况视为分钟数
                minutes = parseInt(numStr, 10);
                seconds = 0;
            }
        }

        if (isNaN(minutes) || isNaN(seconds)) return null;
        if (minutes < 0 || seconds < 0) return null;
        if (seconds >= 60) return null;

        return minutes * 60 + seconds;
    }

    /**
     * 在BrowserWindow中编辑时间
     */
    private editTimeInBrowserWindow(window: any) {
        if (!window || window.isDestroyed()) {
            return;
        }

        // 如果正在运行且未暂停，则不允许编辑
        if (this.isRunning && !this.isPaused) {
            showMessage(i18n('editTimeNotAllowed') || '请先暂停计时器再编辑时间', 2000);
            return;
        }

        let currentTimeString: string;
        if (this.isCountUp) {
            if (this.isWorkPhase) {
                return; // 正计时工作模式，不允许编辑
            } else {
                const currentMinutes = Math.floor(this.breakTimeLeft / 60);
                const currentSeconds = this.breakTimeLeft % 60;
                currentTimeString = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')}`;
            }
        } else {
            const currentMinutes = Math.floor(this.timeLeft / 60);
            const currentSeconds = this.timeLeft % 60;
            currentTimeString = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')}`;
        }

        const editScript = `
            (function() {
                const timeDisplay = document.getElementById('timeDisplay');
                if (!timeDisplay) return;

                const parent = timeDisplay.parentNode;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = '${currentTimeString}';
                input.placeholder = 'MM:SS';
                input.style.cssText = \`
                    font-size: clamp(18px, 10vmin, 16vh);
                    font-weight: 700;
                    color: var(--b3-theme-on-surface);
                    background: var(--b3-theme-surface);
                    border: 2px solid var(--b3-theme-primary);
                    border-radius: 4px;
                    padding: 2px 4px;
                    width: clamp(80px, 30vw, 1000px);
                    text-align: center;
                    font-variant-numeric: tabular-nums;
                    outline: none;
                    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                \`;

                parent.replaceChild(input, timeDisplay);
                input.focus();
                input.select();

                let isEditingFinished = false;

                const finishEdit = () => {
                    if (isEditingFinished) return;
                    isEditingFinished = true;

                    if (input.parentNode !== parent) return;

                    const inputValue = input.value.trim();
                    parent.replaceChild(timeDisplay, input);

                    // 通知主进程应用新时间
                    require('electron').ipcRenderer.send('pomodoro-time-edit-${window.id}', inputValue);
                };

                const cancelEdit = () => {
                    if (isEditingFinished) return;
                    isEditingFinished = true;
                    if (input.parentNode === parent) {
                        parent.replaceChild(timeDisplay, input);
                    }
                };

                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        finishEdit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    }
                });

                input.addEventListener('input', () => {
                    let value = input.value;
                    value = value.replace(/[^0-9:]/g, '');
                    if (value.length > 6) {
                        value = value.substring(0, 6);
                    }
                    input.value = value;
                });
            })();
        `;

        try {
            // 先设置 IPC 监听器，再执行 JavaScript
            let electron: any;
            try {
                electron = (window as any).require('electron');
            } catch (e) {
                try {
                    electron = (global as any).require('electron');
                } catch (e2) {
                    console.error('[PomodoroTimer] Cannot get electron module');
                    return;
                }
            }

            let remote = electron.remote;
            if (!remote) {
                try {
                    remote = (window as any).require('@electron/remote');
                } catch (e) {
                    try {
                        remote = (global as any).require('@electron/remote');
                    } catch (e2) {
                        console.error('[PomodoroTimer] Cannot get remote module');
                        return;
                    }
                }
            }

            const ipcMain = remote?.ipcMain;
            if (!ipcMain) {
                console.error('[PomodoroTimer] Cannot get ipcMain');
                return;
            }

            const editHandler = (_event: any, inputValue: string) => {
                const newTimeInSeconds = this.parseTimeStringToSeconds(inputValue);

                if (newTimeInSeconds === null) {
                    showMessage(i18n('invalidTimeFormat') || '时间格式不正确，请使用 MM:SS 格式', 2000);
                    this.updateBrowserWindowDisplay(window);
                    return;
                }

                if (newTimeInSeconds < 1 || newTimeInSeconds > 59999) {
                    showMessage(i18n('timeRangeLimit') || '时间范围应在 00:01 到 999:59 之间', 2000);
                    this.updateBrowserWindowDisplay(window);
                    return;
                }

                if (this.isCountUp && !this.isWorkPhase) {
                    this.breakTimeLeft = newTimeInSeconds;
                } else if (!this.isCountUp) {
                    this.timeLeft = newTimeInSeconds;
                    this.totalTime = newTimeInSeconds;
                }

                this.updateBrowserWindowDisplay(window);

                const minutes = Math.floor(newTimeInSeconds / 60);
                const seconds = newTimeInSeconds % 60;
                const phaseText = this.isWorkPhase ? (i18n('pomodoroWork') || '工作时间') : (this.isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息'));
                showMessage(`${phaseText}${i18n('setTo') || '已设置为'} ${minutes}:${seconds.toString().padStart(2, '0')}`, 2000);

                // 移除监听器
                ipcMain.removeListener(`pomodoro-time-edit-${window.id}`, editHandler);
            };

            ipcMain.once(`pomodoro-time-edit-${window.id}`, editHandler);

            // 执行 JavaScript 创建输入框
            window.webContents.executeJavaScript(editScript).catch((e: any) => console.error(e));
        } catch (error) {
            console.error('[PomodoroTimer] editTimeInBrowserWindow error:', error);
        }
    }

    show() {
        // 如果番茄钟继承了运行状态，自动开始计时
        setTimeout(() => {
            if (this.isRunning && !this.isPaused) {
                this.startTimer();
            }
        }, 100);
    }

    /**
     * 设置计时模式
     * @param isCountUp true为正计时模式，false为倒计时模式
     */
    public setCountUpMode(isCountUp: boolean) {
        // 如果正在运行，先停止
        if (this.isRunning) {
            this.resetTimer();
        }

        this.isCountUp = isCountUp;

        // 检查是否是 BrowserWindow 模式
        const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';

        if (!isBrowserWindow && this.modeToggleBtn) {
            // 更新模式切换按钮标题
            this.modeToggleBtn.title = this.isCountUp ? (i18n('switchToCountdown') || '切换到倒计时') : (i18n('switchToCountUp') || '切换到正计时');
        }

        // 更新标题图标（仅在非 BrowserWindow 模式）
        const titleIcon = !isBrowserWindow ? this.container.querySelector('.pomodoro-title span') : null;
        if (titleIcon) {
            titleIcon.textContent = this.isCountUp ? '🍅' : '🍅';
        }

        // 重置状态并更新显示
        this.resetTimer();
    }

    close() {
        this.isWindowClosed = true; // 标记窗口已关闭

        if (this.timer) {
            clearInterval(this.timer);
        }

        // 清理自动切换定时器
        if (this.autoTransitionTimer) {
            clearTimeout(this.autoTransitionTimer);
            this.autoTransitionTimer = null;
        }

        this.stopAllAudio();
        this.stopRandomRestTimer(); // 停止随机微休息
        this.detachAudioUnlockListeners();

        if (this.isFullscreen) {
            this.exitFullscreen();
        }
        if (this.exitFullscreenBtn && this.exitFullscreenBtn.parentNode) {
            this.exitFullscreenBtn.parentNode.removeChild(this.exitFullscreenBtn);
        }

        // 关闭BrowserWindow实例
        if (this.container && typeof (this.container as any).close === 'function') {
            // 如果container是BrowserWindow
            try {
                if (PomodoroTimer.browserWindowInstance === this.container) {
                    (this.container as any).destroy();
                }
            } catch (e) {
                console.error('[PomodoroTimer] Failed to close BrowserWindow:', e);
            }
        } else if (this.container && this.container.parentNode) {
            // 如果是DOM元素
            this.container.parentNode.removeChild(this.container);
        }

        // 清理 pending 设置
        this.pendingSettings = null;
    }

    destroy() {
        this.isWindowClosed = true; // 标记窗口已关闭
        this.close();
    }

    /**
     * 检查番茄钟窗口是否仍然存在
     * @returns 如果窗口存在且未被关闭返回true，否则返回false
     */
    public isWindowActive(): boolean {
        if (this.isWindowClosed) {
            return false;
        }

        // 检查是否是 BrowserWindow 模式
        // 注意：this.container 类型定义为 HTMLElement，但在 BrowserWindow 模式下会被赋值为 BrowserWindow 实例
        const containerAny = this.container as any;
        if (!this.isTabMode && containerAny && typeof containerAny.isDestroyed === 'function') {
            return !containerAny.isDestroyed();
        }

        // 检查DOM元素是否仍然存在且在文档中
        return this.container &&
            this.container.parentNode &&
            document.contains(this.container);
    }

    /**
     * 外部暂停番茄钟（供其他组件调用）
     */
    public pauseFromExternal() {
        if (this.isRunning && !this.isPaused) {
            this.pauseTimer();
        }
    }

    /**
     * 外部恢复番茄钟（供其他组件调用）
     */
    public resumeFromExternal() {
        if (this.isRunning && this.isPaused) {
            this.resumeTimer();
        }
    }

    /**
     * 更新番茄钟状态（用于跨窗口同步）
     * @param reminder 新的提醒对象
     * @param settings 新的设置
     * @param isCountUp 是否正计时
     * @param inheritState 要继承的状态
     */
    public async updateState(reminder: any, settings: any, isCountUp: boolean, inheritState?: any, force: boolean = false, suppressNotification: boolean = false) {

        // 如果正在运行且未暂停，且没有强制更新标记，则跳过更新（避免影响正在运行的计时器）
        if (!force && this.isRunning && !this.isPaused) {
            // Don't modify the current instance settings while it is running.
            // Store pendingSettings indicator if caller or plugin needs to know about it.
            this.pendingSettings = { reminder, settings, isCountUp, inheritState, timestamp: Date.now() };
            return;
        }

        // 停止当前计时器
        if (this.isRunning) {
            // 如果是任务切换，先记录当前任务的进度
            if (inheritState && reminder.id && this.reminder.id && reminder.id !== this.reminder.id) {
                await this.recordPartialWorkSession();
            }
            await this.pauseTimer();
        }

        // 停止所有音频
        this.stopAllAudio();

        // 更新基本信息
        this.reminder = reminder;
        this.settings = settings;
        this.isCountUp = isCountUp;
        // 已经应用了新的设置，清理 pending 状态
        this.pendingSettings = null;
        // 更新音频/随机提示相关设置
        try {
            this.isBackgroundAudioMuted = (settings.backgroundAudioMuted || false);
            this.backgroundVolume = Math.max(0, Math.min(1, settings.backgroundVolume || 0.5));
            this.systemNotificationEnabled = settings.pomodoroSystemNotification !== false;
            this.randomRestEnabled = settings.randomRestEnabled || false;
            this.randomRestSystemNotificationEnabled = settings.randomRestSystemNotification !== false;
            this.randomRestAutoClose = true; // 新增
            this.randomRestAutoCloseDelay = 5; // 新增
            this.autoMode = settings.autoMode || false;
            this.longBreakInterval = Math.max(1, settings.longBreakInterval || 4);
        } catch (e) {
            console.warn('更新番茄钟设置时解析新设置失败:', e);
        }

        // 重新初始化音频（如果设置改变）
        this.initAudio();
        // 更新音量状态
        this.updateAudioVolume();

        // 如果有继承状态，应用它
        if (inheritState) {
            this.applyInheritedState(inheritState);

            // 只有当不是任务切换继承时，才根据新的设置重新计算总时长
            // (任务切换时，applyInheritedState 已经正确设置了 totalTime 为剩余时间)
            const isTaskInheritance = inheritState.reminderId && this.reminder.id && inheritState.reminderId !== this.reminder.id;

            console.log(`[PomodoroTimer] updateState: isTaskInheritance=${isTaskInheritance}, inheritId=${inheritState.reminderId}, currentId=${this.reminder.id}`);

            if (!isTaskInheritance) {
                // 根据新的设置和继承的状态重新计算总时长 (totalTime)
                try {
                    if (!this.isCountUp) {
                        if (this.isWorkPhase) {
                            const oldTotal = (inheritState.currentPhaseOriginalDuration || this.currentPhaseOriginalDuration) * 60;
                            const elapsed = typeof inheritState.timeElapsed === 'number' ? inheritState.timeElapsed : (oldTotal - (inheritState.timeLeft || oldTotal));
                            const newTotal = (settings.workDuration || this.settings.workDuration) * 60;
                            this.totalTime = newTotal;
                            const newLeft = Math.max(0, newTotal - elapsed);
                            this.timeLeft = newLeft;
                        } else {
                            // 休息阶段
                            const oldBreakTotal = (inheritState.currentPhaseOriginalDuration || (this.isLongBreak ? this.settings.longBreakDuration : this.settings.breakDuration)) * 60;
                            const breakElapsed = (typeof inheritState.breakTimeLeft === 'number') ? Math.max(0, oldBreakTotal - inheritState.breakTimeLeft) : 0;
                            const newBreakTotal = (this.isLongBreak ? (settings.longBreakDuration || this.settings.longBreakDuration) : (settings.breakDuration || this.settings.breakDuration)) * 60;
                            this.totalTime = newBreakTotal;
                            const newBreakLeft = Math.max(0, newBreakTotal - breakElapsed);
                            this.breakTimeLeft = newBreakLeft;
                        }
                    } else {
                        // 正计时模式：更新时间计数器的原始时长以便统计/界面显示
                        if (this.isWorkPhase) {
                            this.currentPhaseOriginalDuration = settings.workDuration || this.currentPhaseOriginalDuration;
                        } else if (this.isLongBreak) {
                            this.currentPhaseOriginalDuration = settings.longBreakDuration || this.currentPhaseOriginalDuration;
                        } else {
                            this.currentPhaseOriginalDuration = settings.breakDuration || this.currentPhaseOriginalDuration;
                        }
                    }
                } catch (e) {
                    console.warn('更新继承状态时重新计算时间失败:', e);
                }
            }
        } else {
            // 否则重置为初始状态
            this.isRunning = false;
            this.isPaused = false;
            this.isWorkPhase = true;
            this.isLongBreak = false;
            this.timeLeft = settings.workDuration * 60;
            this.timeElapsed = 0;
            this.breakTimeLeft = 0;
            this.totalTime = this.timeLeft;
            this.currentPhaseOriginalDuration = settings.workDuration;
        }

        // 检查是否是 BrowserWindow 模式
        const isBrowserWindow = !this.isTabMode && this.container && typeof (this.container as any).webContents !== 'undefined';

        // 更新事件标题显示（在更新其他显示之前，仅在非 BrowserWindow 模式）
        if (!isBrowserWindow) {
            const eventTitle = this.container.querySelector('.pomodoro-event-title') as HTMLElement;
            if (eventTitle) {
                eventTitle.textContent = reminder.title || (i18n('unnamedNote') || '未命名笔记');
                eventTitle.title = (i18n('openNote') || '打开笔记') + ': ' + (reminder.title || (i18n('unnamedNote') || '未命名笔记'));
            } else {
                console.warn('PomodoroTimer: 未找到标题元素');
            }
        }

        // 更新显示
        this.updateDisplay();
        this.updateStatsDisplay();

        // 如果之前在运行，现在继续运行
        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            await this.resumeTimer();
        }

        // 根据随机微休息开关，重新启动或停止随机微休息定时器
        if (this.randomRestEnabled) {
            if (this.isWorkPhase && this.isRunning && !this.isPaused) {
                this.startRandomRestTimer();
            }
        } else {
            this.stopRandomRestTimer();
        }

        // 同步更新音量滑块UI（如果存在）
        if (this.volumeSlider) {
            try {
                this.volumeSlider.value = (this.backgroundVolume || 0).toString();
                const volumePercent = this.volumeContainer?.querySelector('span:last-child');
                if (volumePercent) {
                    volumePercent.textContent = Math.round((this.backgroundVolume || 0) * 100) + '%';
                }
            } catch (e) {
                console.warn('更新音量滑块UI失败:', e);
            }
        }

        // 当 updateState 被动触发（如广播、跨窗口同步）或在 caller 需要禁止提示时，传入 suppressNotification=true
        if (!suppressNotification) {
            showMessage(i18n('pomodoroUpdated') || '番茄钟已更新', 1500);
        }
    }

    /**
     * 打开相关笔记
     */
    private async openRelatedNote() {
        try {
            // 获取块ID
            let blockId = this.reminder.blockId;

            // 如果是重复事件实例，使用原始事件的blockId
            if (this.reminder.isRepeatInstance && this.reminder.originalId) {
                const reminderData = await this.plugin.loadReminderData();
                const originalReminder = reminderData[this.reminder.originalId];
                if (originalReminder) {
                    blockId = originalReminder.blockId;
                }
            }

            if (!blockId) {
                showMessage(i18n('cannotGetNoteId') || '无法获取笔记ID', 2000);
                return;
            }

            // 检查块是否存在
            const block = await getBlockByID(blockId);
            if (!block) {
                showMessage(i18n('noteNotExist') || '笔记不存在或已被删除', 3000);
                return;
            }

            openBlock(blockId)

            showMessage(i18n('openingNote') || '正在打开笔记...', 1000);

        } catch (error) {
            console.error('打开笔记失败:', error);
            showMessage(i18n('openNoteFailed') || '打开笔记失败', 2000);
        }
    }

    private toggleFullscreen() {
        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    /**
     * DOM窗口吸附模式切换
     */
    private toggleDOMWindowDock() {
        if (this.isDocked) {
            this.exitDOMWindowDock();
        } else {
            this.enterDOMWindowDock();
        }
    }

    /**
     * 进入DOM窗口吸附模式
     */
    private enterDOMWindowDock() {
        if (!this.container || this.isTabMode) return;

        this.isDocked = true;
        this.container.classList.add('docked-mode');

        // 保存当前位置和大小
        if (!this.normalWindowBounds) {
            const rect = this.container.getBoundingClientRect();
            this.normalWindowBounds = {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
            };
        }

        // 隐藏 header
        const header = this.container.querySelector('.pomodoro-header') as HTMLElement;
        if (header) {
            header.style.display = 'none';
        }

        // 隐藏 content
        const content = this.container.querySelector('.pomodoro-content') as HTMLElement;
        if (content) {
            content.style.display = 'none';
        }

        // 应用吸附样式
        const position = this.settings.pomodoroDockPosition || 'right';
        this.container.style.position = 'fixed';
        this.container.style.zIndex = '10000';

        if (position === 'right') {
            this.container.style.width = '8px';
            this.container.style.height = '100vh';
            this.container.style.right = '0';
            this.container.style.left = 'auto';
            this.container.style.top = '0';
            this.container.style.bottom = '0';
        } else if (position === 'left') {
            this.container.style.width = '8px';
            this.container.style.height = '100vh';
            this.container.style.left = '0';
            this.container.style.right = 'auto';
            this.container.style.top = '0';
            this.container.style.bottom = '0';
        } else if (position === 'top') {
            this.container.style.width = '100vw';
            this.container.style.height = '8px';
            this.container.style.top = '0';
            this.container.style.left = '0';
            this.container.style.right = '0';
            this.container.style.bottom = 'auto';
        } else if (position === 'bottom') {
            this.container.style.width = '100vw';
            this.container.style.height = '8px';
            this.container.style.bottom = '0';
            this.container.style.left = '0';
            this.container.style.right = '0';
            this.container.style.top = 'auto';
        }

        this.container.style.borderRadius = '0';
        this.container.style.boxShadow = 'none';

        // 创建进度条容器（如果不存在）
        this.createDockedProgressBar(position);

        showMessage(i18n('enterDockMode') || '已进入吸附模式，点击进度条恢复正常', 2000);
    }

    /**
     * 退出DOM窗口吸附模式
     */
    private exitDOMWindowDock() {
        if (!this.container) return;

        this.isDocked = false;
        this.container.classList.remove('docked-mode');

        // 移除进度条容器
        const progressContainer = this.container.querySelector('.dom-docked-progress-container') as HTMLElement;
        if (progressContainer) {
            progressContainer.remove();
        }

        // 恢复 header 显示
        const header = this.container.querySelector('.pomodoro-header') as HTMLElement;
        if (header) {
            header.style.display = 'flex';
        }

        // 恢复 content 显示
        const content = this.container.querySelector('.pomodoro-content') as HTMLElement;
        if (content) {
            content.style.display = 'block';
            content.style.padding = '0px 16px 6px';
        }

        // 恢复原始样式
        this.container.style.position = 'fixed';
        this.container.style.width = '240px';
        this.container.style.height = 'auto';
        this.container.style.borderRadius = '12px';
        this.container.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.15)';

        // 恢复位置
        if (this.normalWindowBounds) {
            this.container.style.left = this.normalWindowBounds.x + 'px';
            this.container.style.top = this.normalWindowBounds.y + 'px';
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        } else {
            this.container.style.right = '20px';
            this.container.style.bottom = '20px';
            this.container.style.left = 'auto';
            this.container.style.top = 'auto';
        }

        showMessage(i18n('exitDockMode') || '已退出吸附模式', 1500);
    }

    /**
     * 创建DOM窗口吸附模式的进度条
     */
    private createDockedProgressBar(position: string) {
        if (!this.container) return;

        // 移除旧的进度条
        const oldProgress = this.container.querySelector('.dom-docked-progress-container');
        if (oldProgress) oldProgress.remove();

        const isHorizontal = position === 'top' || position === 'bottom';
        const isBottom = position === 'bottom';

        // 创建外层容器（全尺寸点击区域）
        const container = document.createElement('div');
        container.className = 'dom-docked-progress-container';
        container.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            cursor: pointer;
            pointer-events: auto;
            z-index: 10001;
        `;

        // 创建背景层（灰色轨道）
        const track = document.createElement('div');
        track.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(128, 128, 128, 0.3);
        `;

        // 创建进度填充层
        const fill = document.createElement('div');
        fill.className = 'dom-docked-progress-fill';
        fill.style.cssText = `
            position: absolute;
            ${isHorizontal
                ? (isBottom ? 'left: 0; bottom: 0; height: 100%; width: 0%;' : 'left: 0; top: 0; height: 100%; width: 0%;')
                : 'bottom: 0; left: 0; width: 100%; height: 0%;'}
            background: #4CAF50;
            transition: ${isHorizontal ? 'width' : 'height'} 0.5s ease, background-color 0.3s ease;
        `;

        container.appendChild(track);
        container.appendChild(fill);

        // 点击整个区域恢复正常
        container.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[PomodoroTimer] Docked progress bar clicked, restoring window');
            this.exitDOMWindowDock();
        });

        // 悬停效果
        container.addEventListener('mouseenter', () => {
            fill.style.filter = 'brightness(1.2)';
        });
        container.addEventListener('mouseleave', () => {
            fill.style.filter = 'brightness(1)';
        });

        this.container.appendChild(container);

        // 更新进度
        this.updateDockedProgressBar();
    }

    /**
     * 更新DOM窗口吸附模式的进度条
     */
    private updateDockedProgressBar() {
        if (!this.container || !this.isDocked) return;

        const progressFill = this.container.querySelector('.dom-docked-progress-fill') as HTMLElement;
        if (!progressFill) return;

        const position = this.settings.pomodoroDockPosition || 'right';
        const isHorizontal = position === 'top' || position === 'bottom';

        let progress = 0;
        if (this.isCountUp) {
            progress = 0;
        } else if (this.totalTime > 0) {
            progress = (this.totalTime - this.timeLeft) / this.totalTime;
        }

        progress = Math.max(0, Math.min(1, progress));

        if (isHorizontal) {
            progressFill.style.width = (progress * 100) + '%';
        } else {
            progressFill.style.height = (progress * 100) + '%';
        }

        // 根据阶段改变颜色
        let color = '#FF6B6B'; // 红色-工作
        if (!this.isWorkPhase) {
            if (this.isLongBreak) {
                color = '#9C27B0'; // 紫色-长休息
            } else {
                color = '#4CAF50'; // 绿色-短休息
            }
        }
        progressFill.style.background = color;
    }

    private enterFullscreen() {
        this.isFullscreen = true;
        this.container.classList.add('fullscreen');

        // 创建退出全屏按钮
        this.exitFullscreenBtn = document.createElement('button');
        this.exitFullscreenBtn.className = 'pomodoro-exit-fullscreen';
        this.exitFullscreenBtn.textContent = i18n('exitFullscreenMode') || '退出全屏';
        this.exitFullscreenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.exitFullscreen();
        });
        document.body.appendChild(this.exitFullscreenBtn);

        this.addEscapeKeyListener();
        showMessage(i18n('enterFullscreenMode') || '已进入全屏模式，按ESC或点击右上角按钮退出', 2000);
    }

    private exitFullscreen() {
        this.isFullscreen = false;
        this.container.classList.remove('fullscreen');

        // 移除退出全屏按钮
        if (this.exitFullscreenBtn && this.exitFullscreenBtn.parentNode) {
            this.exitFullscreenBtn.parentNode.removeChild(this.exitFullscreenBtn);
        }

        this.removeEscapeKeyListener();
        showMessage(i18n('exitFullscreenMode') || '已退出全屏模式', 1500);
    }

    private addEscapeKeyListener() {
        this.escapeKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isFullscreen) {
                e.preventDefault();
                this.exitFullscreen();
            }
        };
        document.addEventListener('keydown', this.escapeKeyHandler);
    }

    /**
     * 记录当前任务的部分专注时间（用于切换任务继承时或意外关闭时）
     * @param forceId 可选，强制使用指定的任务ID
     * @param forceTitle 可选，强制使用指定的任务标题
     * @param state 可选，使用指定的状态数据
     */
    public async recordPartialWorkSession(forceId?: string, forceTitle?: string, state?: any) {
        // 只有工作阶段需要记录
        const isWork = state ? state.isWorkPhase : this.isWorkPhase;
        if (!isWork) return;

        let elapsedSecs = 0;
        if (state) {
            elapsedSecs = state.timeElapsed || 0;
        } else {
            if (this.startTime > 0) {
                elapsedSecs = Math.floor((Date.now() - this.startTime) / 1000);
            } else {
                elapsedSecs = this.timeElapsed;
            }
        }

        // 至少专注了 10 秒才记录，避免误触或频繁切换产生的碎片记录
        if (elapsedSecs < 10) return;

        const eventId = forceId || this.reminder.id;
        const eventTitle = forceTitle || this.reminder.title || (i18n('pomodoroFocusDefault') || '番茄专注');
        const minutes = elapsedSecs / 60;
        const originalDuration = state ? state.currentPhaseOriginalDuration : this.currentPhaseOriginalDuration;

        try {
            await this.recordManager.recordWorkSession(
                minutes,
                eventId,
                eventTitle,
                originalDuration || 25,
                false, // 标记为未完成（中途切换或手动停止）
                state ? state.isCountUp : this.isCountUp
            );
            console.log(`[PomodoroTimer] 已记录部分专注时间: ${eventTitle}, ${Math.round(minutes * 10) / 10}分钟`);
        } catch (error) {
            console.error('[PomodoroTimer] 记录部分专注时间失败:', error);
        }
    }

    private removeEscapeKeyListener() {
        if (this.escapeKeyHandler) {
            document.removeEventListener('keydown', this.escapeKeyHandler);
            this.escapeKeyHandler = null;
        }
    }

    private async createBrowserWindow() {
        this.isWindowClosed = false; // 重置窗口关闭状态，确保计时器逻辑能正常运行
        try {
            let electron: any;
            try {
                electron = (window as any).require('electron');
            } catch (e) {
                console.error("[PomodoroTimer] Failed to require electron", e);
                throw new Error('Cannot require electron');
            }

            let remote = electron.remote;
            if (!remote) {
                try {
                    remote = (window as any).require('@electron/remote');
                } catch (e) { }
            }

            if (!remote) {
                console.error("[PomodoroTimer] Failed to get electron remote");
                throw new Error('Cannot get electron remote');
            }

            const BrowserWindowConstructor = remote.BrowserWindow;
            if (!BrowserWindowConstructor) {
                console.error("[PomodoroTimer] Failed to get BrowserWindow constructor");
                throw new Error('Cannot get BrowserWindow constructor');
            }

            // 检查是否已有BrowserWindow实例
            let pomodoroWindow = PomodoroTimer.browserWindowInstance;

            if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
                // 复用已有窗口，更新内容

                // 如果有之前的Timer实例，先尝试从旧实例同步窗口模式状态
                const oldTimer = PomodoroTimer.browserWindowTimer;
                if (oldTimer && oldTimer !== this) {
                    try {
                        // 只有在没有继承状态时，才从旧实例复制模式状态
                        // 如果有继承状态（通过applyInheritedState设置），则保持继承的状态
                        // 检查是否已经通过继承设置了状态（通过检查是否与默认值不同）
                        const hasInheritedState = this.isDocked !== false || this.isMiniMode !== false;

                        if (!hasInheritedState) {
                            // 复制吸附/迷你与窗口 bounds 状态，保证新实例反映实际窗口行为
                            this.isDocked = !!oldTimer.isDocked;
                            this.isMiniMode = !!oldTimer.isMiniMode;
                            this.normalWindowBounds = oldTimer.normalWindowBounds ? { ...oldTimer.normalWindowBounds } : null;
                        } else {
                            console.log('[PomodoroTimer] 保持继承的窗口模式状态，不从旧实例覆盖');
                        }
                    } catch (err) {
                        console.warn('[PomodoroTimer] 同步旧实例窗口模式失败:', err);
                    }
                } else {
                    // 如果没有旧实例，尝试从窗口 DOM class 推断当前模式（作为兜底）
                    try {
                        const classes: string = await pomodoroWindow.webContents.executeJavaScript('Array.from(document.body.classList).join(" ")');
                        if (classes && typeof classes === 'string') {
                            this.isDocked = classes.includes('docked-mode');
                            this.isMiniMode = classes.includes('mini-mode');
                        }
                    } catch (err) {
                        // ignore
                    }
                }

                // 更新当前实例引用
                PomodoroTimer.browserWindowTimer = this;
                this.container = pomodoroWindow;

                // 重新生成并加载HTML内容
                await this.updateBrowserWindowContent(pomodoroWindow);

                // 显示窗口
                pomodoroWindow.show();
                pomodoroWindow.focus();

                return;
            }

            // 创建新窗口

            const screen = remote.screen || electron.screen;
            if (!screen) {
                console.error("[PomodoroTimer] Failed to get screen object");
                throw new Error('Cannot get screen object');
            }

            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

            let winWidth = 240;
            let winHeight = 235;
            let x = screenWidth - winWidth - 20;
            let y = screenHeight - winHeight - 20;
            let transparent = false;
            let backgroundColor = this.getCssVariable('--b3-theme-background');

            if (this.isDocked) {
                // Docked mode settings
                const barWidth = 8;
                const position = this.settings.pomodoroDockPosition || 'right';

                if (position === 'top') {
                    winWidth = screenWidth;
                    winHeight = barWidth;
                    x = 0;
                    y = 0;
                } else if (position === 'left') {
                    winWidth = barWidth;
                    winHeight = screenHeight;
                    x = 0;
                    y = 0;
                } else if (position === 'bottom') {
                    winWidth = screenWidth;
                    winHeight = barWidth;
                    x = 0;
                    y = screenHeight - barWidth;
                } else {
                    // Default to right
                    winWidth = barWidth;
                    winHeight = screenHeight;
                    x = screenWidth - barWidth;
                    y = 0;
                }

                // User defined debug position - kept logic same as original but now flexible

                transparent = true;
                backgroundColor = '#00000000';
            } else if (this.isMiniMode) {
                // 迷你模式：设置为小圆形窗口
                const size = 120;
                winWidth = size;
                winHeight = size;
                // 如果有继承的窗口位置，使用它；否则使用默认位置
                if (this.inheritedWindowBounds) {
                    x = this.inheritedWindowBounds.x;
                    y = this.inheritedWindowBounds.y;
                    console.log('[PomodoroTimer] 迷你模式使用继承的窗口位置:', this.inheritedWindowBounds);
                }
            } else {
                // 非吸附模式：优先使用 normalWindowBounds（从吸附模式恢复时的正常位置）
                // 然后才使用 inheritedWindowBounds（任务切换时的继承位置）
                if (this.normalWindowBounds) {
                    // 优先使用保存的正常窗口位置（从吸附/迷你模式恢复时）
                    x = this.normalWindowBounds.x;
                    y = this.normalWindowBounds.y;
                    if (this.normalWindowBounds.width && this.normalWindowBounds.height) {
                        winWidth = this.normalWindowBounds.width;
                        winHeight = this.normalWindowBounds.height;
                    }
                    console.log('[PomodoroTimer] 使用保存的正常窗口位置:', this.normalWindowBounds);
                } else if (this.inheritedWindowBounds) {
                    // 如果没有保存的正常位置，使用继承的窗口位置（任务切换时）
                    x = this.inheritedWindowBounds.x;
                    y = this.inheritedWindowBounds.y;
                    if (this.inheritedWindowBounds.width && this.inheritedWindowBounds.height) {
                        winWidth = this.inheritedWindowBounds.width;
                        winHeight = this.inheritedWindowBounds.height;
                    }
                    console.log('[PomodoroTimer] 使用继承的窗口位置:', this.inheritedWindowBounds);
                }
            }

            pomodoroWindow = new BrowserWindowConstructor({
                width: winWidth,
                height: winHeight,
                x: x,
                y: y,
                frame: false,
                alwaysOnTop: true,
                movable: true,
                skipTaskbar: false,
                hasShadow: !this.isDocked,
                resizable: !this.isDocked && !this.isMiniMode,
                transparent: transparent,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                    webSecurity: false,
                    enableRemoteModule: true,
                    autoplayPolicy: 'no-user-gesture-required'
                },
                minWidth: 1,
                minHeight: 1,
                show: false,
                backgroundColor: backgroundColor
            });

            // 确保新窗口启用 @electron/remote，否则子窗口内无法获取 remote 导致按钮失效
            try {
                const remoteMain = (window as any).require?.('@electron/remote/main');
                if (remoteMain?.enable && pomodoroWindow?.webContents) {
                    remoteMain.enable(pomodoroWindow.webContents);
                }
            } catch (err) {
                console.warn('[PomodoroTimer] enable remote for window failed:', err);
            }

            pomodoroWindow.setMenu(null);

            const bgColor = this.getCssVariable('--b3-theme-background');
            const textColor = this.getCssVariable('--b3-theme-on-background');
            const surfaceColor = this.getCssVariable('--b3-theme-surface');
            const borderColor = this.adjustColor(this.getCssVariable('--b3-theme-surface'), 20);
            const hoverColor = this.adjustColor(this.getCssVariable('--b3-theme-surface'), 10);
            const successColor = this.getCssVariable('--b3-card-success-background');
            const dailyFocusGoal = this.settings.dailyFocusGoal || 0;

            const currentState = this.getCurrentState();
            const timeStr = this.formatTime(currentState.isCountUp ? currentState.timeElapsed : currentState.timeLeft);
            const statusText = currentState.isWorkPhase ? (i18n('pomodoroWork') || '工作时间') :
                (currentState.isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息'));

            const todayTimeStr = this.recordManager.formatTime(this.recordManager.getTodayFocusTime());
            const weekTimeStr = this.recordManager.formatTime(this.recordManager.getWeekFocusTime());

            const actionChannel = `pomodoro-action-${pomodoroWindow.id}`;
            const controlChannel = `pomodoro-control-${pomodoroWindow.id}`;
            const ipcMain = (remote as any).ipcMain;

            const htmlContent = this.generateBrowserWindowHTML(actionChannel, controlChannel, currentState, timeStr, statusText, todayTimeStr, weekTimeStr, bgColor, textColor, surfaceColor, borderColor, hoverColor, this.getCssVariable('--b3-theme-background-light'), this.reminder.title || (i18n('unnamedNote') || '未命名笔记'), this.isBackgroundAudioMuted, this.randomRestEnabled, this.randomRestCount, successColor, dailyFocusGoal);

            this.container = pomodoroWindow as any;

            // 保存窗口实例到静态变量
            PomodoroTimer.browserWindowInstance = pomodoroWindow;
            PomodoroTimer.browserWindowTimer = this;

            pomodoroWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

            // Resume background audio if needed (for fresh window)
            if (!this.isBackgroundAudioMuted && this.isRunning && !this.isPaused) {
                let src = '';
                if (this.isWorkPhase) src = this.settings.workSound;
                else if (this.isLongBreak) src = this.settings.longBreakSound;
                else src = this.settings.breakSound;

                if (src) {
                    setTimeout(async () => {
                        await this.playSoundInBrowserWindow(src, { loop: true, volume: this.backgroundVolume });
                    }, 500);
                }
            }

            // 恢复逻辑计时循环（修复切换吸附模式/窗口重建后丢失计时功能和数据记录的问题）
            if (this.isRunning && !this.isPaused) {
                this.startTickLoop();
                if (this.isWorkPhase && this.randomRestEnabled) {
                    this.startRandomRestTimer();
                }
            }

            // 监听渲染进程的操作请求（通过主进程 IPC）
            const actionHandler = (_event: any, method: string) => {
                this.callMethod(method);
            };
            const controlHandler = (_event: any, action: string, pinState?: boolean) => {
                switch (action) {
                    case 'pin':
                        pomodoroWindow.setAlwaysOnTop(!!pinState);
                        break;
                    case 'minimize':
                        pomodoroWindow.minimize();
                        break;
                    case 'close':
                        pomodoroWindow.destroy();
                        break;
                    // heartbeat 已移除以避免向已销毁对象发送 IPC
                    case 'toggleMiniMode':
                        this.toggleBrowserWindowMiniMode(pomodoroWindow);
                        break;
                    case 'toggleDock':
                        this.toggleBrowserWindowDock(pomodoroWindow, screen);
                        break;
                    case 'restoreFromDocked':
                        this.restoreFromDocked(pomodoroWindow, screen);
                        break;
                    default:
                        break;
                }
            };

            ipcMain?.on(actionChannel, actionHandler);
            ipcMain?.on(controlChannel, controlHandler);

            pomodoroWindow.once('ready-to-show', () => {
                pomodoroWindow.show();

                // 如果继承了迷你模式状态，应用迷你模式设置
                if (this.isMiniMode) {
                    console.log('[PomodoroTimer] 应用继承的迷你模式设置');
                    const size = 120;
                    pomodoroWindow.setSize(size, size);
                    pomodoroWindow.setResizable(false);

                    // 添加迷你模式样式
                    setTimeout(() => {
                        if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
                            pomodoroWindow.webContents.executeJavaScript(`
document.body.classList.add('mini-mode');
document.body.classList.remove('docked-mode');
`).catch((e: any) => console.error('[PomodoroTimer] 应用迷你模式样式失败:', e));
                        }
                    }, 100);
                } else if (this.isDocked) { // 吸附模式下的鼠标穿透处理
                    this.setupDockedMouseEvents(pomodoroWindow);
                }

                // 渲染完毕后推送当前状态
                const self = this;
                setTimeout(() => {
                    if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
                        self.updateBrowserWindowDisplay(pomodoroWindow);
                        self.updateStatsDisplay();
                    }
                }, 200);
            });

            pomodoroWindow.on('closed', () => {
                this.isWindowClosed = true;
                this.stopAllAudio();
                this.stopRandomRestTimer();

                // 清理静态变量引用
                if (PomodoroTimer.browserWindowInstance === pomodoroWindow) {
                    PomodoroTimer.browserWindowInstance = null;
                }
                if (PomodoroTimer.browserWindowTimer === this) {
                    PomodoroTimer.browserWindowTimer = null;
                }

                // 清理计时器
                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = null;
                }
                if (this.autoTransitionTimer) {
                    clearTimeout(this.autoTransitionTimer);
                    this.autoTransitionTimer = null;
                }

                this.detachAudioUnlockListeners();

                // 移除IPC监听器
                ipcMain?.removeListener(actionChannel, actionHandler);
                ipcMain?.removeListener(controlChannel, controlHandler);
            });

            // 监听窗口销毁事件（在系统休眠恢复等情况下可能先于closed事件触发）
            pomodoroWindow.on('destroyed', () => {
                console.warn('[PomodoroTimer] BrowserWindow was destroyed unexpectedly');
                this.isWindowClosed = true;
                this.stopAllAudio();
                this.stopRandomRestTimer();

                // 清理静态变量引用
                if (PomodoroTimer.browserWindowInstance === pomodoroWindow) {
                    PomodoroTimer.browserWindowInstance = null;
                }
                if (PomodoroTimer.browserWindowTimer === this) {
                    PomodoroTimer.browserWindowTimer = null;
                }

                // 清理计时器
                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = null;
                }
                if (this.autoTransitionTimer) {
                    clearTimeout(this.autoTransitionTimer);
                    this.autoTransitionTimer = null;
                }

                this.detachAudioUnlockListeners();

                // 移除IPC监听器
                ipcMain?.removeListener(actionChannel, actionHandler);
                ipcMain?.removeListener(controlChannel, controlHandler);
            });

        } catch (error) {
            console.error('创建番茄钟窗口失败:', error);
            throw error;
        }
    }

    public static async recoverOrphanedWindow(plugin: any, settings: any): Promise<PomodoroTimer | null> {
        // Scan first, BEFORE creating any instance to avoid side effects (like opening a new window)
        const win = await PomodoroTimer.scanForOrphanedWindow();

        if (win) {
            console.log('[PomodoroTimer] Found orphan during recovery scan', win.id);

            let recoveredReminder = { id: 'recovered', title: 'Recovering...' };
            let recoveredState = null;

            // Try to recover state BEFORE creating the instance
            try {
                recoveredState = await win.webContents.executeJavaScript('window.localState');
                if (recoveredState) {
                    if (recoveredState.reminderTitle) recoveredReminder.title = recoveredState.reminderTitle;
                    if (recoveredState.reminderId) recoveredReminder.id = recoveredState.reminderId;
                    if (recoveredState.blockId) (recoveredReminder as any).blockId = recoveredState.blockId;
                }
            } catch (e) {
                console.warn('[PomodoroTimer] Failed to pre-recover state', e);
            }

            // Create timer with potentially recovered info, PASSING THE FOUND WINDOW
            const timer = new PomodoroTimer(recoveredReminder, settings, false, null, plugin, undefined, win);

            // Apply full state if available
            if (recoveredState) {
                timer.isRunning = recoveredState.isRunning;
                timer.isPaused = recoveredState.isPaused;
                timer.isWorkPhase = recoveredState.isWorkPhase;
                timer.isLongBreak = recoveredState.isLongBreak;
                timer.isCountUp = recoveredState.isCountUp;

                timer.timeLeft = recoveredState.timeLeft || 0;
                timer.timeElapsed = recoveredState.timeElapsed || 0;
                timer.breakTimeLeft = recoveredState.breakTimeLeft || 0;
                timer.totalTime = recoveredState.totalTime || 0;

                timer.completedPomodoros = recoveredState.completedPomodoros || 0;
                timer.startTime = recoveredState.startTime || Date.now();
                timer.pausedTime = recoveredState.pausedTime || 0;
                timer.currentPhaseOriginalDuration = recoveredState.currentPhaseOriginalDuration || settings.workDuration;

                // Restore Reminder/Block IDs explicitly
                if (recoveredState.reminderId) timer.reminder.id = recoveredState.reminderId;
                if (recoveredState.blockId) timer.reminder.blockId = recoveredState.blockId;

                // Restore random notification state
                timer.randomRestEnabled = recoveredState.randomRestEnabled || false;
                timer.randomRestCount = recoveredState.randomRestCount || 0;
                if (recoveredState.randomRestNextTriggerTime) {
                    timer.randomRestNextTriggerTime = recoveredState.randomRestNextTriggerTime;
                }

                // Resume logic loop if needed
                if (timer.isRunning && !timer.isPaused) {
                    timer.startTickLoop();
                    // FIX: 恢复随机微休息定时器（如果启用且在工作阶段）
                    if (timer.randomRestEnabled && timer.isWorkPhase) {
                        timer.startRandomRestTimer(true);
                    }
                } else {
                    // If paused or stopped, ensure UI reflects it
                }

                // Try to recover mode (docked/mini) from DOM classes
                try {
                    const classes: string = await win.webContents.executeJavaScript('Array.from(document.body.classList).join(" ")');
                    if (classes && typeof classes === 'string') {
                        (timer as any).isDocked = classes.includes('docked-mode');
                        (timer as any).isMiniMode = classes.includes('mini-mode');
                    }
                } catch (err) {
                    console.warn('[PomodoroTimer] Failed to detect window mode during recovery', err);
                }

                // FIX: 如果恢复为吸附模式，需要设置鼠标穿透
                if (timer.isDocked) {
                    console.log('[PomodoroTimer] 恢复吸附模式，设置鼠标穿透');
                    timer.setupDockedMouseEvents(win);
                }

                // Force UI update to match the restored state immediately
                timer.updateBrowserWindowDisplay(win);
            }

            return timer;
        }
        return null;
    }

    private static async scanForOrphanedWindow(): Promise<any> {
        try {
            let remote: any;
            try { remote = (window as any).require('@electron/remote'); }
            catch (e) { try { remote = (window as any).require('electron').remote; } catch (e2) { } }
            if (!remote) return null;

            const wins = remote.BrowserWindow.getAllWindows();
            for (const win of wins) {
                if (win.isDestroyed()) continue;
                try {
                    // Method 1: Check injected flag
                    let isPomodoro = await win.webContents.executeJavaScript('window.isPomodoroWindow === true').catch(() => false);

                    // Method 2: Check window title (fallback)
                    if (!isPomodoro) {
                        try {
                            const title = win.getTitle();
                            if (title === 'Pomodoro Timer') {
                                isPomodoro = true;
                            }
                        } catch (e) { }
                    }

                    if (isPomodoro) return win;
                } catch (e) { }
            }
        } catch (e) { }
        return null;
    }

    private async findAndAttachOrphanedWindow() {
        if (this.isTabMode) return;

        if (PomodoroTimer.browserWindowInstance) return;

        try {
            const win = await PomodoroTimer.scanForOrphanedWindow();
            if (win) {
                if (PomodoroTimer.browserWindowInstance === win) return;

                console.log('[PomodoroTimer] Found orphaned window, attaching...', win.id);

                // 1. Recover State FROM the window
                try {
                    const recoveredState = await win.webContents.executeJavaScript('window.localState');
                    console.log('[PomodoroTimer] Recovered state:', recoveredState);

                    if (recoveredState) {
                        this.isRunning = recoveredState.isRunning;
                        this.isPaused = recoveredState.isPaused;
                        this.isWorkPhase = recoveredState.isWorkPhase;
                        this.isLongBreak = recoveredState.isLongBreak;
                        this.isCountUp = recoveredState.isCountUp;
                        this.timeLeft = recoveredState.timeLeft;
                        this.timeElapsed = recoveredState.timeElapsed;
                        this.breakTimeLeft = recoveredState.breakTimeLeft || 0;
                        this.totalTime = recoveredState.totalTime;
                        this.completedPomodoros = recoveredState.completedPomodoros || 0;
                        this.startTime = recoveredState.startTime || 0;
                        this.pausedTime = recoveredState.pausedTime || 0;
                        this.currentPhaseOriginalDuration = recoveredState.currentPhaseOriginalDuration || this.settings.workDuration;

                        // Restore random notification state
                        this.randomRestEnabled = recoveredState.randomRestEnabled || false;
                        this.randomRestCount = recoveredState.randomRestCount || 0;

                        if (recoveredState.reminderTitle) {
                            this.reminder.title = recoveredState.reminderTitle;
                        }
                        if (recoveredState.reminderId) {
                            this.reminder.id = recoveredState.reminderId;
                        }
                        if (recoveredState.blockId) {
                            this.reminder.blockId = recoveredState.blockId;
                        }
                    }
                } catch (e) {
                    console.warn('[PomodoroTimer] Failed to extract state from orphaned window', e);
                }

                PomodoroTimer.browserWindowInstance = win;
                this.container = win;
                PomodoroTimer.browserWindowTimer = this;

                this.registerIPCListeners(win);

                this.updateBrowserWindowDisplay(win);

                if (this.isRunning && !this.isPaused) {
                    this.startTickLoop();
                    // FIX: 恢复随机微休息定时器（如果启用且在工作阶段）
                    if (this.randomRestEnabled && this.isWorkPhase) {
                        this.startRandomRestTimer();
                    }
                }
            }
        } catch (e) {
            console.error('Error scanning for orphaned windows:', e);
        }
    }

    private startTickLoop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = window.setInterval(() => {
            if (this.isWindowClosed) {
                if (this.timer) { clearInterval(this.timer); this.timer = null; }
                return;
            }
            const currentTime = Date.now();
            const elapsedSinceStart = Math.floor((currentTime - this.startTime) / 1000);

            if (this.isCountUp) {
                if (this.isWorkPhase) {
                    this.timeElapsed = elapsedSinceStart;
                    const pomodoroLength = this.settings.workDuration * 60;
                    if (this.timeElapsed > 0 && this.timeElapsed % pomodoroLength === 0) {
                        if (this.lastPomodoroTriggerTime !== this.timeElapsed) {
                            this.lastPomodoroTriggerTime = this.timeElapsed;
                            this.completePomodoroPhase();
                        }
                    }
                } else {
                    const totalBreakTime = this.isLongBreak ? this.settings.longBreakDuration * 60 : this.settings.breakDuration * 60;
                    this.breakTimeLeft = totalBreakTime - elapsedSinceStart;
                    if (this.breakTimeLeft <= 0) {
                        this.breakTimeLeft = 0;
                        this.completeBreakPhase();
                    }
                }
            } else {
                this.timeLeft = this.totalTime - elapsedSinceStart;
                if (this.timeLeft <= 0) {
                    this.timeLeft = 0;
                    this.completePhase();
                }
            }
        }, 500);
    }

    private registerIPCListeners(pomodoroWindow: any) {
        if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;

        try {
            const electronReq = (window as any).require;
            const remote = electronReq?.('@electron/remote') || electronReq?.('electron')?.remote;
            const ipcMain = remote?.ipcMain;

            if (!ipcMain) return;

            const actionChannel = `pomodoro-action-${pomodoroWindow.id}`;
            const controlChannel = `pomodoro-control-${pomodoroWindow.id}`;

            // Remove old listeners just in case
            ipcMain.removeAllListeners(actionChannel);
            ipcMain.removeAllListeners(controlChannel);

            let screen: any = null;
            try {
                screen = remote?.screen;
            } catch (e) { }

            const actionHandler = (_event: any, method: string) => {
                this.callMethod(method);
            };

            const controlHandler = (_event: any, action: string, pinState?: boolean) => {
                switch (action) {
                    case 'pin':
                        pomodoroWindow.setAlwaysOnTop(!!pinState);
                        break;
                    case 'minimize':
                        pomodoroWindow.minimize();
                        break;
                    case 'close':
                        pomodoroWindow.destroy();
                        break;
                    case 'toggleMiniMode':
                        this.toggleBrowserWindowMiniMode(pomodoroWindow);
                        break;
                    case 'toggleDock':
                        this.toggleBrowserWindowDock(pomodoroWindow, screen);
                        break;
                    case 'restoreFromDocked':
                        this.restoreFromDocked(pomodoroWindow, screen);
                        break;
                    default:
                        break;
                }
            };

            ipcMain.on(actionChannel, actionHandler);
            ipcMain.on(controlChannel, controlHandler);

            // Clean up on close
            pomodoroWindow.once('closed', () => {
                ipcMain.removeListener(actionChannel, actionHandler);
                ipcMain.removeListener(controlChannel, controlHandler);
            });
            pomodoroWindow.once('destroyed', () => {
                ipcMain.removeListener(actionChannel, actionHandler);
                ipcMain.removeListener(controlChannel, controlHandler);
            });

            // 在吸附模式下启用鼠标可以穿透透明区域（仅进度条响应鼠标）
            // FIX: 恢复孤儿窗口时也需要设置鼠标穿透
            if (this.isDocked && pomodoroWindow && !pomodoroWindow.isDestroyed()) {
                this.setupDockedMouseEvents(pomodoroWindow);
            }

        } catch (e) {
            console.error('Error registering IPC listeners:', e);
        }
    }

    /**
     * 设置吸附模式下的鼠标穿透事件
     * 使窗口透明区域鼠标穿透，仅进度条响应鼠标
     */
    private setupDockedMouseEvents(pomodoroWindow: any) {
        if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;

        try {
            const electronReq = (window as any).require;
            const remote = electronReq?.('@electron/remote') || electronReq?.('electron')?.remote;
            const ipcMain = remote?.ipcMain;

            if (!ipcMain) {
                console.warn('[PomodoroTimer] ipcMain not available');
                return;
            }

            const mouseEventsChannel = `pomodoro-mouse-${pomodoroWindow.id}`;

            // 先移除旧监听器，避免重复
            ipcMain.removeAllListeners(mouseEventsChannel);

            const mouseHandler = (_event: any, ignore: boolean) => {
                if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
                    try {
                        if (ignore) {
                            pomodoroWindow.setIgnoreMouseEvents(true, { forward: true });
                        } else {
                            pomodoroWindow.setIgnoreMouseEvents(false);
                        }
                    } catch (e) {
                        console.warn('[PomodoroTimer] setIgnoreMouseEvents failed', e);
                    }
                }
            };

            ipcMain.on(mouseEventsChannel, mouseHandler);
            console.log('[PomodoroTimer] Mouse events listener registered');

            // 注入鼠标事件监听脚本
            pomodoroWindow.webContents.executeJavaScript(`
                (function() {
                    try {
                        const ipc = window.require('electron').ipcRenderer;
                        const channel = '${mouseEventsChannel}';
                        const bar = document.querySelector('.progress-bar-container');
                        
                        if (!bar) {
                            console.error('[PomodoroTimer] Progress bar container not found');
                            return;
                        }
                        
                        // 移除旧的事件监听器（如果存在）
                        bar.onmouseenter = null;
                        bar.onmouseleave = null;
                        
                        bar.addEventListener('mouseenter', () => {
                            console.log('[PomodoroTimer] Mouse entered progress bar');
                            ipc.send(channel, false); // 不忽略鼠标（捕获点击）
                        });
                        bar.addEventListener('mouseleave', () => {
                            console.log('[PomodoroTimer] Mouse left progress bar');
                            ipc.send(channel, true); // 忽略鼠标（穿透）
                        });
                        
                        // 检查鼠标是否已经在进度条上
                        const rect = bar.getBoundingClientRect();
                        const isMouseOver = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2) === bar;
                        
                        if (isMouseOver) {
                            console.log('[PomodoroTimer] Mouse already over progress bar');
                            ipc.send(channel, false);
                        } else {
                            // 默认设置为穿透
                            ipc.send(channel, true);
                        }
                    } catch (e) {
                        console.error('[PomodoroTimer] Error in mouse events script:', e);
                    }
                })();
            `).catch((e: any) => console.error('[PomodoroTimer] Failed to inject mouse events script', e));

            // 确保清理函数移除这个监听器
            const cleanup = () => {
                ipcMain?.removeListener(mouseEventsChannel, mouseHandler);
            };
            pomodoroWindow.once('closed', cleanup);
            pomodoroWindow.once('destroyed', cleanup);
        } catch (e) {
            console.error('[PomodoroTimer] setupDockedMouseEvents error:', e);
        }
    }

    private generateBrowserWindowHTML(
        actionChannel: string,
        controlChannel: string,
        currentState: any,
        timeStr: string,
        statusText: string,
        todayTimeStr: string,
        weekTimeStr: string,
        bgColor: string,
        textColor: string,
        surfaceColor: string,
        borderColor: string,
        hoverColor: string,
        backgroundLightColor: string,
        reminderTitle: string,
        isBackgroundAudioMuted: boolean,
        randomRestEnabled: boolean,
        randomRestCount: number,
        successColor: string,
        dailyFocusGoal: number,
        miniModeTitle?: string,
        dockModeTitle?: string
    ): string {
        // 设置默认值
        miniModeTitle = miniModeTitle || (i18n('miniMode') || '迷你模式');
        dockModeTitle = dockModeTitle || (i18n('dockToEdge') || '吸附到屏幕边缘');
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Pomodoro Timer</title>
    <script>window.isPomodoroWindow = true;</script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: ${this.isDocked ? 'transparent !important' : bgColor};
            color: ${textColor};
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden;
            user-select: none;
            height: 100vh;
            display: flex;
            flex-direction: column;
            min-width: 1px !important;
        }
        .custom-titlebar {
            -webkit-app-region: drag;
            padding: 6px;
            border-bottom: 1px solid ${borderColor};
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .titlebar-left, .titlebar-buttons { display: flex; align-items: center; gap: 4px; }
        .titlebar-btn {
            -webkit-app-region: no-drag;
            background: none;
            border: none;
            color: ${textColor};
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: clamp(12px, 3vmin, 2.4vh);
            opacity: 0.7;
            transition: all 0.2s;
        }
        .titlebar-btn:hover { opacity: 1; background: ${hoverColor}; }
        .titlebar-btn.close-btn:hover { background: #e81123; color: white; }
        .pin-btn.active { opacity: 1 !important; background: ${hoverColor} !important;  }
        .switch-container { position: relative; }
        .switch-menu {
            position: absolute;
            top: 100%;
            left: 0;
            background: ${surfaceColor};
            border: 1px solid ${borderColor};
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            display: none;
            flex-direction: column;
            padding: 4px;
            min-width: 120px;
            margin-top: 4px;
        }
        .switch-menu.show { display: flex; }
        .menu-item {
            background: none;
            border: none;
            color: ${textColor};
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: clamp(11px, 2.8vmin, 1.3vh);
            text-align: left;
            transition: background 0.2s;
        }
        .menu-item:hover { background: ${hoverColor}; }
        .pomodoro-content {
            flex: 1;
            padding: 0 16px 6px;
            display: flex;
            flex-direction: column;
        }
        .pomodoro-event-title {
            font-size: clamp(12px, 3vmin, 5vh);
            font-weight: 600;
            text-align: center;
            border-radius: 6px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-bottom: 5px;
            cursor: pointer;
            padding: 4px 8px;
            transition: all 0.2s;
        }
        .pomodoro-event-title:hover { background: ${hoverColor}; border-color: #4CAF50; }
        .pomodoro-main-container { display: flex; align-items: center; justify-content: center; gap: clamp(16px, 4vw, 8vw); margin-bottom: 10px; flex: 1; }
        .progress-container { position: relative; width: clamp(80px, 45vmin, 40vh); height: clamp(80px, 45vmin, 40vh); flex-shrink: 1; min-width: 80px; }
        .progress-ring { width: 100%; height: 100%; transform: rotate(-90deg); }
        .progress-ring-bg { fill: none; stroke: ${backgroundLightColor}; stroke-width: 6; opacity: 0.3; }
        .progress-ring-circle {
            fill: none;
            stroke: #FF6B6B;
            stroke-width: 6;
            stroke-linecap: round;
            stroke-dasharray: 226.19;
            stroke-dashoffset: 226.19;
            transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;
        }
        .center-content {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            align-items: center;
            justify-content: center;
            width: 75%;
            height: 75%;
        }
        .pomodoro-status-icon {
            font-size: clamp(14px, 10vmin, 8vh);
            transition: opacity 0.2s;
            position: absolute;
            z-index: 1;
        }
        .control-buttons {
            display: flex;
            gap: 4px;
            position: absolute;
            z-index: 2;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .progress-container:hover .control-buttons { opacity: 1; }
        .progress-container:hover .pomodoro-status-icon { opacity: 0.3; }
        .circle-control-btn {
            background: rgba(255, 255, 255, 0.9);
            border: none;
            cursor: pointer;
            font-size: clamp(16px, 9vmin, 6vh);
            color: #333;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            width: clamp(32px, 16vmin, 11vh);
            height: clamp(32px, 16vmin, 11vh);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            transition: all 0.2s;
        }
        .circle-control-btn:hover { transform: scale(1.1); }
        .time-info { display: flex; flex-direction: column; gap: 4px; }
        .pomodoro-status {
            font-size: clamp(10px, 2.5vmin, 3vh);
            opacity: 0.7;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .pomodoro-time {
            font-size: clamp(18px, 10vmin, 16vh);
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            line-height: 1.2;
            cursor: pointer;
            border-radius: 4px;
            padding: 2px 4px;
            transition: background 0.2s;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            max-width: 40vw;
            text-align: center;
        }
        .pomodoro-time:hover { background: ${hoverColor}; }
        .pomodoro-count {
            font-size: clamp(12px, 3vmin, 2.5vh);
            opacity: 0.7;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .pomodoro-dice { margin-left: 8px; font-size: clamp(12px, 3vmin, 2.5vh); opacity: 0.9; }
        .pomodoro-stats {
            display: flex;
            justify-content: space-between;
            padding: 12px;
            background: ${surfaceColor};
            border-radius: 8px;
        }
        .stat-item { flex: 1; text-align: center; padding: 0 8px; }
        .stat-item:first-child { border-right: 1px solid ${borderColor}; }
        .stat-label { font-size: clamp(9px, 2.2vmin, 1.8vh); opacity: 0.7; margin-bottom: 4px; }
        .stat-value { font-size: clamp(14px, 3.5vmin, 2.8vh); font-weight: 600; color: #FF6B6B; }
        
        /* 迷你模式样式 */
        body.mini-mode .custom-titlebar { display: none; }
        body.mini-mode .pomodoro-content { 
            -webkit-app-region: drag;
            padding: 0; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            cursor: move;
        }
        body.mini-mode .pomodoro-event-title,
        body.mini-mode .time-info,
        body.mini-mode .pomodoro-stats { display: none; }
        body.mini-mode .pomodoro-main-container { 
            -webkit-app-region: drag;
            margin: 0; 
        }
        body.mini-mode .progress-container { 
            -webkit-app-region: drag;
            width: calc(100vw - 20px); 
            height: calc(100vh - 20px); 
            max-width: calc(100vh - 20px);
            max-height: calc(100vw - 20px);
            cursor: move;
        }
        body.mini-mode .center-content {
            -webkit-app-region: no-drag;
            cursor: pointer;
        }
        body.mini-mode .control-buttons {
            -webkit-app-region: no-drag;
        }
        body.mini-mode .pomodoro-status-icon { 
            -webkit-app-region: no-drag;
            font-size: clamp(24px, 15vmin, 12vh);
            cursor: pointer;
        }
        body.mini-mode .circle-control-btn { 
            -webkit-app-region: no-drag;
            width: clamp(24px, 18vmin, 12vh); 
            height: clamp(24px, 18vmin, 12vh);
            font-size: clamp(12px, 9vmin, 6vh);
        }
        .mini-restore-btn {
            -webkit-app-region: no-drag;
            position: absolute;
            top: 8px;
            right: 8px;
            width: 24px;
            height: 24px;
            background: var(--b3-theme-primary, #4CAF50);
            color: #fff;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            font-size: 14px;
            display: none;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            transition: all 0.2s ease;
            z-index: 100;
            opacity: 0;
        }
        body:not(.mini-mode) .mini-restore-btn { display: none !important; }
        body.mini-mode .progress-container:hover .mini-restore-btn {
            display: flex;
            opacity: 1;
        }
        .mini-restore-btn:hover {
            background: var(--b3-theme-primary-light, #66BB6A);
            transform: scale(1.1);
        }
        
        /* 吸附模式样式 */
        body.docked-mode { background: transparent !important; overflow: hidden; }
        body.docked-mode .custom-titlebar,
        body.docked-mode .pomodoro-event-title,
        body.docked-mode .time-info,
        body.docked-mode .pomodoro-stats,
        body.docked-mode .pomodoro-main-container { display: none; }
        body.docked-mode .pomodoro-content { display: none; padding: 0; height: 100vh; display: flex; align-items: stretch; }
        
        body.docked-mode .progress-bar-container {
            display: flex;
            ${(this.settings.pomodoroDockPosition === 'top' || this.settings.pomodoroDockPosition === 'bottom') ?
                `flex-direction: row;
             justify-content: flex-start;
             width: 100%;
             height: 8px;` :
                `flex-direction: column;
             justify-content: flex-end;
             width: 8px;
             height: 100%;`
            }
            background: rgba(128, 128, 128, 0.3);
            cursor: pointer;
            position: relative;
        }
        body.docked-mode .progress-bar-fill {
            ${(this.settings.pomodoroDockPosition === 'top' || this.settings.pomodoroDockPosition === 'bottom') ?
                `width: 0%;
             height: 100%;
             transition: width 0.5s ease, background-color 0.3s ease;` :
                `width: 100%;
             height: 0%;
             transition: height 0.5s ease, background-color 0.3s ease;`
            }
            background: #4CAF50;
        }
        body:not(.docked-mode) .progress-bar-container { display: none; }
    </style>
</head>
</head>
<body class="${this.isDocked ? 'docked-mode' : ''} ${this.isMiniMode ? 'mini-mode' : ''}">
    <div class="custom-titlebar">
        <div class="titlebar-left">
            <button class="titlebar-btn" id="miniModeBtn" onclick="toggleMiniMode()" title="${miniModeTitle}">
                ⭕
            </button>
            <button class="titlebar-btn" id="dockBtn" onclick="toggleDock()" title="${dockModeTitle}">
                ${this.getDockPositionEmoji(this.settings.pomodoroDockPosition)}
            </button>
            <div class="switch-container">
                <button class="titlebar-btn" id="statusBtn" onclick="toggleSwitchMenu(event)">
                    🔄
                </button>
                <div class="switch-menu" id="switchMenu">
                    <button class="menu-item" onclick="callMethod('toggleMode')">
                        ${currentState.isCountUp ? '🍅' : '⏱'} ${currentState.isCountUp ? (i18n('switchToCountdown') || '切换到倒计时') : (i18n('switchToCountUp') || '切换到正计时')}
                    </button>
                    <button class="menu-item" onclick="callMethod('startWorkTime')">💪 ${i18n('pomodoroWork') || '工作时间'}</button>
                    <button class="menu-item" onclick="callMethod('startShortBreak')">🍵 ${i18n('pomodoroBreak') || '短时休息'}</button>
                    <button class="menu-item" onclick="callMethod('startLongBreak')">🧘 ${i18n('pomodoroLongBreak') || '长时休息'}</button>
                </div>
            </div>
        </div>
        <div class="titlebar-buttons">
            <button class="titlebar-btn" id="soundBtn" onclick="callMethod('toggleBackgroundAudio')">
                ${isBackgroundAudioMuted ? '🔇' : '🔊'}
            </button>
            <button class="titlebar-btn pin-btn active" id="pinBtn" onclick="togglePin()" title="${i18n('cancelPin') || '取消置顶'}">📌</button>
            <button class="titlebar-btn" onclick="minimizeWindow()">─</button>
            <button class="titlebar-btn close-btn" onclick="closeWindow()">×</button>
        </div>
    </div>
    <div class="pomodoro-content">
        <div class="progress-bar-container" onclick="restoreFromDocked()">
            <div class="progress-bar-fill" id="dockedProgressBar"></div>
        </div>
        <div class="pomodoro-event-title" onclick="callMethod('openRelatedNote')">
            ${reminderTitle}
        </div>
        <div class="pomodoro-main-container">
            <div class="progress-container">
                <svg class="progress-ring" viewBox="0 0 80 80">
                    <circle class="progress-ring-bg" cx="40" cy="40" r="36"></circle>
                    <circle class="progress-ring-circle" id="progressCircle" cx="40" cy="40" r="36"></circle>
                </svg>
                <div class="center-content" ondblclick="handleDoubleClick()">
                    <div class="pomodoro-status-icon" id="statusIcon">🍅</div>
                    <div class="control-buttons">
                        <button class="circle-control-btn" onclick="callMethod('toggleTimer')">▶️</button>
                        <button class="circle-control-btn" id="stopBtn" onclick="callMethod('resetTimer')" style="display:none">⏹</button>
                    </div>
                </div>
                <button class="mini-restore-btn" onclick="toggleMiniMode()" title="${i18n('restoreWindow') || '恢复窗口'}">↗</button>
            </div>
            <div class="time-info">
                <div class="pomodoro-status" id="statusDisplay">${statusText}</div>
                <div class="pomodoro-time" id="timeDisplay" ondblclick="callMethod('editTime')">${timeStr}</div>
                <div class="pomodoro-count">
                    <span>🍅</span>
                    <span id="pomodoroCount">${currentState.completedPomodoros}</span>
                    <span class="pomodoro-dice" id="diceIcon" style="display:${randomRestEnabled ? 'inline' : 'none'}">🎲</span>
                    <span id="randomCount" style="display:${randomRestEnabled ? 'inline' : 'none'}">${randomRestCount}</span>
                </div>
            </div>
        </div>
        <div class="pomodoro-stats">
            <div class="stat-item">
                <div class="stat-label">${i18n('todayFocus') || '今日专注'}</div>
                <div class="stat-value" id="todayFocusTime">${todayTimeStr}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">${i18n('weekFocus') || '本周专注'}</div>
                <div class="stat-value" id="weekFocusTime">${weekTimeStr}</div>
            </div>
        </div>
    </div>
    <script>
        const { ipcRenderer } = require('electron');
        let remote;
        
        // Robustly try to get remote
        try {
            remote = require('@electron/remote');
        } catch (e) {
            try {
                remote = require('electron').remote;
            } catch (e2) {
                if (typeof window.require === 'function') {
                    try {
                        remote = window.require('@electron/remote');
                    } catch (e3) {
                        try {
                            remote = window.require('electron').remote;
                        } catch (e4) {}
                    }
                }
            }
        }

        let isPinned = true;
        
        // Initialize local state from arguments
        let localState = ${JSON.stringify(currentState)};
        // Expose localState globally for recovery
        window.localState = localState;
        
        let settings = ${JSON.stringify({
                workDuration: this.settings.workDuration,
                breakDuration: this.settings.breakDuration,
                longBreakDuration: this.settings.longBreakDuration,
                dailyFocusGoal: dailyFocusGoal,
                pomodoroDockPosition: this.settings.pomodoroDockPosition || 'top'
            })};

        function callMethod(method) {
            ipcRenderer.send('${actionChannel}', method);
            closeSwitchMenu();
        }
        
        function closeSwitchMenu() {
            const m = document.getElementById('switchMenu');
            if (m) m.classList.remove('show');
        }
        
        document.addEventListener('click', e => {
            if (!e.target.closest('.switch-container')) closeSwitchMenu();
        });
        
        function toggleSwitchMenu(e) {
            e.stopPropagation();
            const m = document.getElementById('switchMenu');
            if (m) m.classList.toggle('show');
        }
        
        function togglePin() {
            isPinned = !isPinned;
            ipcRenderer.send('${controlChannel}', 'pin', isPinned);
            const btn = document.getElementById('pinBtn');
            if (btn) {
                if (isPinned) {
                    btn.classList.add('active');
                    btn.title = '${i18n('cancelPin') || '取消置顶'}';
                } else {
                    btn.classList.remove('active');
                    btn.title = '${i18n('pinWindow') || '置顶窗口'}';
                }
            }
        }
        
        function minimizeWindow() {
            ipcRenderer.send('${controlChannel}', 'minimize');
        }
        
        function closeWindow() {
            ipcRenderer.send('${controlChannel}', 'close');
        }
        
        function toggleMiniMode() {
            ipcRenderer.send('${controlChannel}', 'toggleMiniMode');
        }
        
        function toggleDock() {
            ipcRenderer.send('${controlChannel}', 'toggleDock');
        }
        
        function restoreFromDocked() {
            ipcRenderer.send('${controlChannel}', 'restoreFromDocked');
        }
        
        function handleDoubleClick() {
            if (document.body.classList.contains('mini-mode')) {
                ipcRenderer.send('${controlChannel}', 'toggleMiniMode');
            }
        }

        // --- Independent Timer Logic ---
        
        function formatTime(seconds) {
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return \`\${m.toString().padStart(2, '0')}:\${s.toString().padStart(2, '0')}\`;
        }

        function calculateProgress(state) {
            let progress = 0;
            if (state.isCountUp && state.isWorkPhase) {
                const pomodoroLength = settings.workDuration * 60;
                const currentCycleTime = state.timeElapsed % pomodoroLength;
                progress = currentCycleTime / pomodoroLength;
            } else if (state.isCountUp && !state.isWorkPhase) {
                const totalBreakTime = state.isLongBreak ?
                    settings.longBreakDuration * 60 :
                    settings.breakDuration * 60;
                progress = (totalBreakTime - state.breakTimeLeft) / totalBreakTime;
            } else {
                progress = state.totalTime > 0 ? ((state.totalTime - state.timeLeft) / state.totalTime) : 0;
            }
            return Math.max(0, Math.min(1, progress));
        }

        function render() {
            if (!localState) return;

            // 1. Calculate Time to Display
            let displayTime = 0;
            if (localState.isCountUp) {
                displayTime = localState.isWorkPhase ? localState.timeElapsed : localState.breakTimeLeft;
            } else {
                displayTime = localState.timeLeft;
            }
            const timeStr = formatTime(displayTime);
            
            // 2. Update Time Display
            const timeDisplay = document.getElementById('timeDisplay');
            if (timeDisplay && timeDisplay.textContent !== timeStr) {
                timeDisplay.textContent = timeStr;
            }

            // 3. Update Progress Circle
            const progress = calculateProgress(localState);
            const circumference = 226.19;
            const offset = circumference * (1 - progress);
            const circle = document.getElementById('progressCircle');
            if (circle) {
                circle.style.strokeDashoffset = offset;
            }
            
            // 4. Update Docked Mode Progress
            const dockPos = '${this.settings.pomodoroDockPosition || "right"}';
            const dockedBar = document.getElementById('dockedProgressBar');
            if (dockedBar) {
                if (dockPos === 'top' || dockPos === 'bottom') {
                    dockedBar.style.width = (progress * 100) + '%';
                    // Height is handled by CSS (100%) but ensuring it here doesn't hurt
                    dockedBar.style.height = '100%'; 
                } else {
                    dockedBar.style.height = (progress * 100) + '%';
                    // Width is handled by CSS (100%)
                    dockedBar.style.width = '100%';
                }
            }

            // 5. Update Status Text/Icon
             let statusText = '${i18n('pomodoroWork') || '工作时间'}';
            let statusIcon = '🍅';
            let color = '#FF6B6B'; // Default red

            if (!localState.isWorkPhase) {
                if (localState.isLongBreak) {
                    statusText = '${i18n('pomodoroLongBreak') || '长时休息'}';
                    statusIcon = '🧘';
                    color = '#9C27B0';
                } else {
                    statusText = '${i18n('pomodoroBreak') || '短时休息'}';
                    statusIcon = '🍵';
                    color = '#4CAF50';
                }
            } else {
                // Work phase
                 statusText = '${i18n('pomodoroWork') || '工作时间'}';
                 statusIcon = '🍅';
                 color = '#FF6B6B';
            }
            
            const statusDisplay = document.getElementById('statusDisplay');
            if (statusDisplay && statusDisplay.textContent !== statusText) statusDisplay.textContent = statusText;
            
            const statusIconEl = document.getElementById('statusIcon');
            if (statusIconEl && statusIconEl.textContent !== statusIcon) statusIconEl.textContent = statusIcon;

            if (circle) circle.style.stroke = color;
            if (dockedBar) dockedBar.style.backgroundColor = color;
            
            // 6. Update Controls
            const stopBtn = document.getElementById('stopBtn');
            const playBtn = document.querySelector('.circle-control-btn'); // First one is Play/Pause
            
            if (localState.isRunning) {
                if (localState.isPaused) {
                     if (playBtn) playBtn.textContent = '▶️';
                     if (stopBtn) stopBtn.style.display = 'flex';
                } else {
                     if (playBtn) playBtn.textContent = '⏸';
                     if (stopBtn) stopBtn.style.display = 'none';
                }
            } else {
                 if (playBtn) playBtn.textContent = '▶️';
                 if (stopBtn) stopBtn.style.display = 'none';
            }
            
            // 7. Update Counts
            const pomodoroCount = document.getElementById('pomodoroCount');
            if (pomodoroCount) pomodoroCount.textContent = localState.completedPomodoros;

            // 8. Update Stats and Title
            if (localState.todayFocusTime) {
                const el = document.getElementById('todayFocusTime');
                if (el) el.textContent = localState.todayFocusTime;
            }
            if (localState.weekFocusTime) {
                 const el = document.getElementById('weekFocusTime');
                 if (el) el.textContent = localState.weekFocusTime;
            }
            if (localState.reminderTitle) {
                 const el = document.querySelector('.pomodoro-event-title');
                 if (el) {
                     el.textContent = localState.reminderTitle;
                     el.title = '${i18n('openNote') || '打开笔记'}' + ': ' + localState.reminderTitle;
                 }
            }

            // 8.1 Update Today's Focus Progress Bar (Gradient background)
            const dailyGoalHours = settings.dailyFocusGoal || 0;
            const statsContainer = document.querySelector('.pomodoro-stats');
            if (statsContainer) {
                const todayMins = localState.todayFocusMinutes || 0;
                const surfCol = '${surfaceColor}';
                if (dailyGoalHours > 0) {
                    const goalMins = dailyGoalHours * 60;
                    const progress = Math.min((todayMins / goalMins) * 100, 100);
                    const succCol = '${successColor}';
                    statsContainer.style.background = "linear-gradient(to right, " + succCol + " " + progress + "%, " + surfCol + " " + progress + "%)";
                    
                    const todayEl = document.getElementById('todayFocusTime');
                    if (todayEl) {
                        todayEl.style.color = todayMins >= goalMins ? 'rgb(76, 175, 80)' : '#FF6B6B';
                    }
                } else {
                    statsContainer.style.background = surfCol;
                    const todayEl = document.getElementById('todayFocusTime');
                    if (todayEl) todayEl.style.color = '#FF6B6B';
                }
            }

            // 9. Update Random Notification Count
            const randomCountDisp = document.getElementById('randomCount');
            const diceIcon = document.getElementById('diceIcon');
            
            if (localState.randomRestEnabled) {
                 if (randomCountDisp) {
                     randomCountDisp.textContent = localState.randomRestCount;
                     randomCountDisp.style.display = 'inline';
                 }
                 if (diceIcon) diceIcon.style.display = 'inline';
            } else {
                 if (randomCountDisp) randomCountDisp.style.display = 'none';
                 if (diceIcon) diceIcon.style.display = 'none';
            }

            // 10. Update Sound Button (reflect mute state)
            const soundBtn = document.getElementById('soundBtn');
            if (soundBtn) {
                soundBtn.textContent = localState.isBackgroundAudioMuted ? '🔇' : '🔊';
                soundBtn.title = localState.isBackgroundAudioMuted ? '${i18n('enableBackgroundAudio') || '开启背景音'}' : '${i18n('muteBackgroundAudio') || '静音背景音'}';
            }
            
            // 11. Update Dock Button Emoji based on position
            const dockBtn = document.getElementById('dockBtn');
            if (dockBtn) {
                const posEmojiMap = {
                    'top': '⬆️',
                    'bottom': '⬇️',
                    'left': '⬅️',
                    'right': '➡️'
                };
                const emoji = posEmojiMap[settings.pomodoroDockPosition] || '➡️';
                if (dockBtn.textContent !== emoji) {
                    dockBtn.textContent = emoji;
                }
            }
        }

        // Main Timer Loop (independent of main window)
        setInterval(() => {
            if (localState.isRunning && !localState.isPaused) {
                const now = Date.now();
                // startTime is the timestamp when the timer logic says "start"
                // elapsed = now - startTime (in seconds)
                const elapsed = Math.floor((now - localState.startTime) / 1000);
                
                if (localState.isCountUp) {
                     if (localState.isWorkPhase) {
                         localState.timeElapsed = elapsed;
                     } else {
                         const totalBreakTime = localState.isLongBreak ? settings.longBreakDuration * 60 : settings.breakDuration * 60;
                         localState.breakTimeLeft = Math.max(0, totalBreakTime - elapsed);
                     }
                } else {
                     localState.timeLeft = Math.max(0, localState.totalTime - elapsed);
                }
                
                render();
            }
        }, 100);

        // API called by Main Process to update state
        window.updateLocalState = (newState, newSettings) => {
            localState = { ...localState, ...newState };
            // Update global exposed state
            window.localState = localState;
            
            if (newSettings) {
                settings = { ...settings, ...newSettings };
            }
            render();
        }
        
        // Initial render
        render();

    </script>
</body>
</html>`;
    }

    /**
     * 更新BrowserWindow的内容（用于复用窗口并更新任务）
     */
    private async updateBrowserWindowContent(pomodoroWindow: any) {
        if (!pomodoroWindow || pomodoroWindow.isDestroyed()) {
            console.error('[PomodoroTimer] Window is destroyed, cannot update content');
            return;
        }

        try {
            const currentState = this.getCurrentState();
            const actionChannel = `pomodoro-action-${pomodoroWindow.id}`;
            const controlChannel = `pomodoro-control-${pomodoroWindow.id}`;
            const colors = this.getPomodoroColors();
            const borderColor = this.adjustColor(colors.surface, 20);
            const hoverColor = this.adjustColor(colors.surface, 10);

            const htmlContent = this.generateBrowserWindowHTML(
                actionChannel,
                controlChannel,
                currentState,
                this.formatTime(currentState.isCountUp ? currentState.timeElapsed : currentState.timeLeft),
                currentState.isWorkPhase ? (i18n('pomodoroWork') || '工作时间') : (currentState.isLongBreak ? (i18n('pomodoroLongBreak') || '长时休息') : (i18n('pomodoroBreak') || '短时休息')),
                this.recordManager.formatTime(this.recordManager.getTodayFocusTime()),
                this.recordManager.formatTime(this.recordManager.getWeekFocusTime()),
                colors.background,
                colors.onBackground,
                colors.surface,
                borderColor,
                hoverColor,
                colors.backgroundLight,
                this.reminder.title || (i18n('unnamedNote') || '未命名笔记'),
                this.isBackgroundAudioMuted,
                this.randomRestEnabled,
                this.randomRestCount,
                colors.successBackground,
                (this.settings.dailyFocusGoal || 0)
            );

            // 重新加载窗口内容
            await pomodoroWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

            // 加载完成后，根据当前实例的模式（迷你/吸附）修正窗口大小、bounds 和 DOM class
            try {
                if (this.isMiniMode) {
                    if (!this.normalWindowBounds) {
                        try { this.normalWindowBounds = pomodoroWindow.getBounds(); } catch (e) { this.normalWindowBounds = null; }
                    }
                    try {
                        pomodoroWindow.setSize(120, 120);
                        pomodoroWindow.setResizable(false);
                    } catch (e) { }
                    try {
                        await pomodoroWindow.webContents.executeJavaScript(`document.body.classList.add('mini-mode');document.body.classList.remove('docked-mode');`);
                    } catch (e) { }
                } else if (this.isDocked) {
                    if (!this.normalWindowBounds) {
                        try { this.normalWindowBounds = pomodoroWindow.getBounds(); } catch (e) { this.normalWindowBounds = null; }
                    }
                    try {
                        const electronReq = (window as any).require;
                        const remote = electronReq?.('@electron/remote') || electronReq?.('electron')?.remote || (window as any).require('electron')?.remote;
                        const screen = remote?.screen || (electronReq?.('electron')?.screen || null);
                        if (screen && screen.getPrimaryDisplay) {
                            const primary = screen.getPrimaryDisplay();
                            const { width: sw, height: sh } = primary.workAreaSize;
                            const barWidth = 8;
                            const position = this.settings.pomodoroDockPosition || 'right';

                            if (position === 'top') {
                                pomodoroWindow.setBounds({ x: 0, y: 0, width: sw, height: barWidth });
                            } else if (position === 'left') {
                                pomodoroWindow.setBounds({ x: 0, y: 0, width: barWidth, height: sh });
                            } else if (position === 'bottom') {
                                pomodoroWindow.setBounds({ x: 0, y: sh - barWidth, width: sw, height: barWidth });
                            } else {
                                // Default right
                                pomodoroWindow.setBounds({ x: sw - barWidth, y: 0, width: barWidth, height: sh });
                            }
                            pomodoroWindow.setResizable(false);
                        }
                    } catch (e) { }
                    try {
                        await pomodoroWindow.webContents.executeJavaScript(`document.body.classList.add('docked-mode');document.body.classList.remove('mini-mode');`);
                    } catch (e) { }
                } else {
                    // 正常窗口，恢复可拖拽大小
                    try {
                        pomodoroWindow.setResizable(true);
                        if (this.normalWindowBounds) {
                            pomodoroWindow.setBounds(this.normalWindowBounds);
                            this.normalWindowBounds = null;
                        } else {
                            pomodoroWindow.setSize(240, 235);
                        }
                    } catch (e) { }
                    try {
                        await pomodoroWindow.webContents.executeJavaScript(`document.body.classList.remove('mini-mode');document.body.classList.remove('docked-mode');`);
                    } catch (e) { }
                }
            } catch (err) {
                console.warn('[PomodoroTimer] 应用窗口模式到复用窗口时出错:', err);
            }

            // Resume background audio if needed (because recreating window kills the audio)
            if (!this.isBackgroundAudioMuted && this.isRunning && !this.isPaused) {
                let src = '';
                if (this.isWorkPhase) src = this.settings.workSound;
                else if (this.isLongBreak) src = this.settings.longBreakSound;
                else src = this.settings.breakSound;

                if (src) {
                    // Slight delay to ensure DOM is ready, and resolve audio path before playing
                    setTimeout(async () => {
                        await this.playSoundInBrowserWindow(src, { loop: true, volume: this.backgroundVolume });
                    }, 500);
                }
            }

            // 设置窗口事件监听器（如果需要重新注册）
            const electronReq = (window as any).require;
            const ipcMain = electronReq?.('electron')?.remote?.ipcMain || electronReq?.('@electron/remote')?.ipcMain || electronReq?.('electron')?.ipcMain;

            if (ipcMain) {
                // 清理旧的监听器
                const oldActionChannel = `pomodoro-action-${pomodoroWindow.id}`;
                const oldControlChannel = `pomodoro-control-${pomodoroWindow.id}`;
                ipcMain.removeAllListeners(oldActionChannel);
                ipcMain.removeAllListeners(oldControlChannel);

                // 解析 screen（用于 dock 操作）
                let screen: any = null;
                try {
                    const remote = electronReq?.('@electron/remote') || electronReq?.('electron')?.remote || (window as any).require('electron')?.remote;
                    screen = remote?.screen || electronReq?.('electron')?.screen || null;
                } catch (e) {
                    screen = null;
                }

                // 添加新的监听器，包含迷你/吸附/恢复等操作
                const actionHandler = (_event: any, method: string) => {
                    this.callMethod(method);
                };
                const controlHandler = (_event: any, action: string, pinState?: boolean) => {
                    switch (action) {
                        case 'pin':
                            pomodoroWindow.setAlwaysOnTop(!!pinState);
                            break;
                        case 'minimize':
                            pomodoroWindow.minimize();
                            break;
                        case 'close':
                            pomodoroWindow.destroy();
                            break;
                        // heartbeat 已移除以避免向已销毁对象发送 IPC
                        case 'toggleMiniMode':
                            this.toggleBrowserWindowMiniMode(pomodoroWindow);
                            break;
                        case 'toggleDock':
                            this.toggleBrowserWindowDock(pomodoroWindow, screen);
                            break;
                        case 'restoreFromDocked':
                            this.restoreFromDocked(pomodoroWindow, screen);
                            break;
                        default:
                            break;
                    }
                };

                ipcMain.on(actionChannel, actionHandler);
                ipcMain.on(controlChannel, controlHandler);
            }

            // 在吸附模式下启用鼠标可以穿透透明区域（仅进度条响应鼠标）
            // FIX: 延迟执行确保 DOM 完全加载并稳定
            if (this.isDocked && pomodoroWindow && !pomodoroWindow.isDestroyed()) {
                setTimeout(() => {
                    if (this.isDocked && !pomodoroWindow.isDestroyed()) {
                        this.setupDockedMouseEvents(pomodoroWindow);
                    }
                }, 500);
            }

            // FIX: 恢复随机微休息定时器（如果启用且在工作阶段且正在运行）
            if (this.randomRestEnabled && this.isWorkPhase && this.isRunning && !this.isPaused) {
                this.startRandomRestTimer();
            }

        } catch (error) {
            console.error('[PomodoroTimer] 更新窗口内容失败:', error);
        }
    }

    /**
     * 更新独立窗口的显示
     */
    private updateBrowserWindowDisplay(window: any) {
        if (!window) return;
        try {
            if (window.isDestroyed && window.isDestroyed()) return;
        } catch (error) { return; }

        try {
            const currentState = this.getCurrentState();

            // Add extra info needed for display
            (currentState as any).todayFocusTime = this.recordManager.formatTime(this.recordManager.getTodayFocusTime());
            (currentState as any).weekFocusTime = this.recordManager.formatTime(this.recordManager.getWeekFocusTime());

            const settingsUpdate = {
                workDuration: this.settings.workDuration,
                breakDuration: this.settings.breakDuration,
                longBreakDuration: this.settings.longBreakDuration,
                dailyFocusGoal: (this.settings.dailyFocusGoal || 0),
                pomodoroDockPosition: this.settings.pomodoroDockPosition || 'top'
            };

            // Send state to window using executeJavaScript
            const enhancedState = Object.assign({}, currentState, { isBackgroundAudioMuted: this.isBackgroundAudioMuted });
            const script = `if(window.updateLocalState) window.updateLocalState(${JSON.stringify(enhancedState)}, ${JSON.stringify(settingsUpdate)});`;

            window.webContents.executeJavaScript(script).catch(() => { });

        } catch (error) {
            console.warn('[PomodoroTimer] updateBrowserWindowDisplay failed', error);
        }
    }


    /**
     * 供 BrowserWindow 调用的方法
     */
    public callMethod(method: string, ...args: any[]) {
        try {
            switch (method) {
                case 'toggleTimer':
                    this.toggleTimer();
                    break;
                case 'resetTimer':
                    this.resetTimer();
                    break;
                case 'startWorkTime':
                    this.startWorkTime();
                    break;
                case 'startShortBreak':
                    this.startShortBreak();
                    break;
                case 'startLongBreak':
                    this.startLongBreak();
                    break;
                case 'toggleMode':
                    this.toggleMode();
                    break;
                case 'openRelatedNote':
                    this.openRelatedNote();
                    break;
                case 'editTime':
                    this.editTime();
                    break;
                case 'toggleBackgroundAudio':
                    this.toggleBackgroundAudio();
                    break;
                default:
                    console.warn('[PomodoroTimer] Unknown method:', method);
            }

            // 方法调用后更新窗口显示
            if (this.container && typeof (this.container as any).webContents !== 'undefined') {
                const self = this;
                setTimeout(() => self.updateBrowserWindowDisplay(self.container), 100);
            }
        } catch (error) {
            console.error('[PomodoroTimer] callMethod error:', method, error);
        }
    }

    /**
     * 切换 BrowserWindow 的迷你模式
     */
    private toggleBrowserWindowMiniMode(pomodoroWindow: any) {
        if (!pomodoroWindow || pomodoroWindow.isDestroyed()) {
            return;
        }

        try {
            // 如果窗口是最大化状态，先退出最大化
            if (pomodoroWindow.isMaximized && pomodoroWindow.isMaximized()) {
                pomodoroWindow.unmaximize();
                // 等待窗口恢复正常大小后再执行模式切换
                setTimeout(() => {
                    this.toggleBrowserWindowMiniMode(pomodoroWindow);
                }, 300);
                return;
            }

            this.isMiniMode = !this.isMiniMode;

            if (this.isMiniMode) {
                // 进入迷你模式
                // 保存当前窗口大小和位置
                if (!this.normalWindowBounds) {
                    this.normalWindowBounds = pomodoroWindow.getBounds();
                }

                // 设置为圆形小窗口
                const size = 120;
                pomodoroWindow.setSize(size, size);
                pomodoroWindow.setResizable(false);

                // 添加迷你模式样式
                pomodoroWindow.webContents.executeJavaScript(`
document.body.classList.add('mini-mode');
document.body.classList.remove('docked-mode');
`).catch((e: any) => console.error(e));
            } else {
                // 退出迷你模式
                if (this.normalWindowBounds) {
                    pomodoroWindow.setBounds(this.normalWindowBounds);
                    this.normalWindowBounds = null;
                } else {
                    pomodoroWindow.setSize(240, 235);
                }
                pomodoroWindow.setResizable(true);

                // 移除迷你模式样式
                pomodoroWindow.webContents.executeJavaScript(`
document.body.classList.remove('mini-mode');
`).catch((e: any) => console.error(e));
            }

            // 更新显示
            setTimeout(() => this.updateBrowserWindowDisplay(pomodoroWindow), 100);
        } catch (error) {
            console.error('[PomodoroTimer] toggleBrowserWindowMiniMode error:', error);
        }
    }

    /**
     * 切换 BrowserWindow 的吸附模式
     */
    private toggleBrowserWindowDock(pomodoroWindow: any, _screen: any) {
        if (!pomodoroWindow || pomodoroWindow.isDestroyed()) {
            return;
        }

        try {
            if (!this.isDocked) {
                // Entering docked mode -> Save current bounds
                if (!pomodoroWindow.isMaximized()) {
                    this.normalWindowBounds = pomodoroWindow.getBounds();
                }
                this.isDocked = true;
            } else {
                // Leaving docked mode
                this.isDocked = false;
            }

            // Close and recreate window to apply transparent/non-transparent settings
            pomodoroWindow.destroy();

            // Wait briefly for cleanup then recreate
            setTimeout(() => {
                this.createBrowserWindow();
            }, 100);

        } catch (error) {
            console.error('[PomodoroTimer] toggleBrowserWindowDock error:', error);
        }
    }

    /**
     * 从吸附模式恢复到正常模式
     */
    private restoreFromDocked(pomodoroWindow: any, screen: any) {
        if (!pomodoroWindow || pomodoroWindow.isDestroyed() || !this.isDocked) {
            return;
        }

        // 调用 toggleDock 来恢复
        this.toggleBrowserWindowDock(pomodoroWindow, screen);
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(Math.abs(seconds) / 60);
        const secs = Math.floor(Math.abs(seconds) % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} `;
    }

    /**
     * 在 BrowserWindow 模式下设置音频权限维护机制
     * 注意：由于 BrowserWindow 创建时设置了 autoplayPolicy: 'no-user-gesture-required'
     * 并且音频会在 BrowserWindow 内播放，因此不需要在主窗口维护音频权限
     * 这个方法主要用于兼容性，实际上 initializeAudioPlayback 会在 BrowserWindow 模式下直接返回
     */
    public async updateSettings(settings: any) {
        const oldDockPosition = this.settings?.pomodoroDockPosition;
        this.settings = settings;

        // 更新 DOM 模式下吸附按钮的 emoji（无论是否处于吸附模式）
        if ((this as any).dockBtnElement) {
            (this as any).dockBtnElement.innerHTML = this.getDockPositionEmoji(settings.pomodoroDockPosition);
        }

        const pomodoroWindow = PomodoroTimer.browserWindowInstance;
        if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
            // Update window content to reflect new settings (like dock position)
            // updateBrowserWindowContent 内部会根据 this.isDocked 状态设置鼠标穿透
            await this.updateBrowserWindowContent(pomodoroWindow);
        } else if (this.isDocked && !this.isTabMode) {
            // DOM 窗口吸附模式：如果吸附位置改变，重新应用吸附样式
            if (oldDockPosition !== settings.pomodoroDockPosition) {
                console.log('[PomodoroTimer] Dock position changed, reapplying dock style');
                // 先退出再重新进入吸附模式以应用新位置
                this.exitDOMWindowDock();
                this.enterDOMWindowDock();
            }
        }
    }

    private setupBrowserWindowAudioMaintenance() {
        // 每5分钟检查一次音频权限（在 BrowserWindow 模式下会被跳过）
        setInterval(async () => {
            if (this.isRunning && !this.isPaused && !this.isWindowClosed) {
                try {
                    await this.initializeAudioPlayback(true);
                } catch (error) {
                    console.warn('[PomodoroTimer] 定期音频权限检查失败:', error);
                }
            }
        }, 5 * 60 * 1000); // 5分钟

        // 监听窗口焦点事件（在 BrowserWindow 模式下会被跳过）
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('focus', async () => {
                if (!this.isWindowClosed) {
                    try {
                        await this.initializeAudioPlayback(true);
                    } catch (error) {
                        console.warn('[PomodoroTimer] 窗口焦点事件音频权限检查失败:', error);
                    }
                }
            });
        }
    }
}
