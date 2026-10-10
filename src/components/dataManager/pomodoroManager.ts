import { PomodoroTimer } from "../panel/PomodoroTimer";

/**
 * 全局番茄钟管理器
 * 确保整个插件只有一个活动的番茄钟实例，避免重复创建
 */
export class PomodoroManager {
    private static instance: PomodoroManager | null = null;
    private currentPomodoroTimer: PomodoroTimer | null = null;

    private constructor() { }

    /**
     * 获取全局单例实例
     */
    public static getInstance(): PomodoroManager {
        if (!PomodoroManager.instance) {
            PomodoroManager.instance = new PomodoroManager();
        }
        return PomodoroManager.instance;
    }

    /**
     * 获取当前活动的番茄钟实例
     */
    public getCurrentPomodoroTimer(): PomodoroTimer | null {
        return this.currentPomodoroTimer;
    }

    /**
     * 设置当前活动的番茄钟实例
     */
    public setCurrentPomodoroTimer(timer: PomodoroTimer | null): void {
        this.currentPomodoroTimer = timer;
    }

    /**
     * 检查是否有活动的番茄钟实例且窗口仍然存在
     */
    public hasActivePomodoroTimer(): boolean {
        return this.currentPomodoroTimer !== null && this.currentPomodoroTimer.isWindowActive();
    }

    /**
     * 获取当前番茄钟的状态（如果存在）
     */
    public getCurrentState(): any {
        if (this.currentPomodoroTimer && this.currentPomodoroTimer.isWindowActive()) {
            return this.currentPomodoroTimer.getCurrentState();
        }
        return null;
    }

    /**
     * 暂停当前番茄钟（如果存在且正在运行）
     */
    public pauseCurrentTimer(): boolean {
        if (this.currentPomodoroTimer && this.currentPomodoroTimer.isWindowActive()) {
            try {
                this.currentPomodoroTimer.pauseFromExternal();
                return true;
            } catch (error) {
                console.error("Failed to pause current pomodoro timer:", error);
                return false;
            }
        }
        return false;
    }

    /**
     * 恢复当前番茄钟的运行（如果存在且已暂停）
     */
    public resumeCurrentTimer(): boolean {
        if (this.currentPomodoroTimer && this.currentPomodoroTimer.isWindowActive()) {
            try {
                this.currentPomodoroTimer.resumeFromExternal();
                return true;
            } catch (error) {
                console.error("Failed to resume pomodoro timer:", error);
                return false;
            }
        }
        return false;
    }

    /**
     * 关闭并清理当前番茄钟实例
     */
    public closeCurrentTimer(): void {
        if (this.currentPomodoroTimer) {
            try {
                // 检查窗口是否仍然活动，如果不活动则直接清理引用
                if (!this.currentPomodoroTimer.isWindowActive()) {
                    this.currentPomodoroTimer = null;
                    return;
                }
                this.currentPomodoroTimer.close();
            } catch (error) {
                console.error("Failed to close pomodoro timer instance:", error);
            }
            this.currentPomodoroTimer = null;
        }
    }

    /**
     * 销毁并清理当前番茄钟实例
     */
    public destroyCurrentTimer(): void {
        if (this.currentPomodoroTimer) {
            try {
                // 检查窗口是否仍然活动，如果不活动则直接清理引用
                if (!this.currentPomodoroTimer.isWindowActive()) {
                    this.currentPomodoroTimer = null;
                    return;
                }
                this.currentPomodoroTimer.destroy();
            } catch (error) {
                console.error("Failed to destroy pomodoro timer instance:", error);
            }
            this.currentPomodoroTimer = null;
        }
    }

    /**
     * 清理所有资源（在插件卸载时调用）
     * @param preserveStandaloneWindow 插件代码重载时保留独立窗口，交给新插件实例接管
     * @returns 是否成功保留了独立番茄钟窗口
     */
    public cleanup(preserveStandaloneWindow: boolean = false): boolean {
        let preserved = false;

        if (preserveStandaloneWindow && this.currentPomodoroTimer) {
            try {
                preserved = this.currentPomodoroTimer.detachForPluginReload();
            } catch (error) {
                console.warn("Failed to preserve pomodoro window for plugin reload; using normal unload cleanup:", error);
            }
        }

        if (preserved) {
            this.currentPomodoroTimer = null;
        } else {
            this.destroyCurrentTimer();
        }

        PomodoroManager.instance = null;
        return preserved;
    }

    /**
     * 清理无效的番茄钟引用（窗口已关闭但引用还在）
     */
    public cleanupInactiveTimer(): void {
        if (this.currentPomodoroTimer && !this.currentPomodoroTimer.isWindowActive()) {
            this.currentPomodoroTimer = null;
        }
    }

    /**
     * 更新当前番茄钟的设置
     */
    public async updateSettings(settings: any): Promise<void> {
        if (this.currentPomodoroTimer && this.currentPomodoroTimer.isWindowActive()) {
            try {
                await this.currentPomodoroTimer.updateSettings(settings);
            } catch (error) {
                console.error("Failed to update pomodoro timer settings:", error);
            }
        }
    }
}
