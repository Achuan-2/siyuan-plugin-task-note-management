import { Dialog, showMessage } from "siyuan";
import type ReminderPlugin from "../index";
import { sendNotification } from "../api";
import { HabitPanel } from "../components/panel/HabitPanel";
import { HabitDayDialog } from "../components/dialog/HabitDayDialog";
import { i18n } from "../pluginInstance";
import { getLocalDateTimeString, getLogicalDateString } from "../utils/dateUtils";
import {
    generateRepeatInstances, getRepeatInstanceOriginalKey, getRepeatInstanceState,
    getInstanceField, setRepeatInstanceCompletion
} from "../components/dataManager/repeatUtils";

export interface ReminderNotificationInfo {
    id?: string;
    notificationKind?: 'task' | 'habit';
    title?: string;
    blockId?: string;
    originalId?: string;
    instanceId?: string;
    isRepeatInstance?: boolean;
    isRepeatedInstance?: boolean;
    date?: string;
}

type NotificationActionKind = 'pomodoro' | 'complete' | 'checkIn';
interface NotificationAction {
    text: string;
    action: NotificationActionKind;
}

// 只依赖通知操作需要的插件能力，番茄钟入口通过回调注入。
type NotificationHost = Pick<ReminderPlugin,
    'isInMobileApp' | 'loadHabitData' | 'saveHabitPartial' | 'loadReminderData' | 'saveReminderData' |
    'updateMobileNotification' | 'playTaskCompleteSound'>;

/** 管理系统通知、兼容操作框和按钮操作，不负责到期提醒的扫描与调度。 */
export class ReminderNotificationService {
    private desktopReminderNotifications = new Set<{ close: () => void }>();

    constructor(
        private readonly plugin: NotificationHost,
        private readonly startPomodoro: (reminder: any) => Promise<void>,
        private readonly updateBadges: () => void
    ) { }

    private getActions(reminderInfo?: ReminderNotificationInfo): NotificationAction[] {
        if (!reminderInfo?.id) return [];
        if (reminderInfo.notificationKind === 'habit') {
            return [{ text: i18n('checkInAction') || '打卡', action: 'checkIn' }];
        }
        return [
            { text: i18n('startPomodoro') || '开始番茄钟', action: 'pomodoro' },
            { text: i18n('completeTaskAction') || '完成任务', action: 'complete' }
        ];
    }

    private focusWindow() {
        try {
            const remote = (window as any).require?.('@electron/remote');
            const currentWindow = remote?.getCurrentWindow();
            if (currentWindow?.isMinimized()) currentWindow.restore();
            currentWindow?.show();
            currentWindow?.focus();
        } catch (error) {
            console.debug('恢复通知所属窗口失败:', error);
        }
        window.focus();
    }

    private async handleAction(reminderInfo: ReminderNotificationInfo, action: NotificationActionKind) {
        try {
            this.focusWindow();
            // 通知可能停留很久，操作前读取最新数据，避免覆盖后续编辑或重复完成。
            if (action === 'checkIn') {
                const habits = await this.plugin.loadHabitData(true);
                const habit = habits[reminderInfo.id];
                if (!habit || habit.abandoned) return;
                const dialog = new HabitDayDialog(
                    HabitPanel.cloneHabitData(habit)!,
                    getLogicalDateString(),
                    async updatedHabit => {
                        await HabitPanel.saveHabitDirectly(updatedHabit, this.plugin);
                    },
                    this.plugin
                );
                dialog.openAddEntryDialog();
                return;
            }

            const data = await this.plugin.loadReminderData(true);
            const isInstance = !!(reminderInfo.isRepeatInstance || reminderInfo.isRepeatedInstance);
            const taskId = isInstance ? reminderInfo.originalId : reminderInfo.id;
            const task = data[taskId];
            const instanceDate = isInstance ? getRepeatInstanceOriginalKey(reminderInfo) : undefined;
            const state = instanceDate ? getRepeatInstanceState(task, instanceDate) : undefined;
            if (!task || task.completed || state?.completed || state?.deleted) return;

            if (action === 'pomodoro') {
                const currentTask = isInstance
                    ? {
                        ...task,
                        ...generateRepeatInstances(task, instanceDate, instanceDate).find(instance => getRepeatInstanceOriginalKey(instance) === instanceDate),
                        ...state,
                        id: reminderInfo.id, originalId: taskId, isRepeatInstance: true, instanceId: reminderInfo.instanceId || reminderInfo.id
                    }
                    : task;
                await this.startPomodoro(currentTask);
                return;
            }

            await this.completeTask(data, taskId, instanceDate);
        } catch (error) {
            console.error('执行通知操作失败:', error);
            showMessage(i18n('operationFailed'), 3000, 'error');
        }
    }

    private async completeTask(data: Record<string, any>, taskId: string, instanceDate?: string) {
        const completedTime = getLocalDateTimeString(new Date());
        const affectedBlocks = new Set<string>();
        const affectedTasks = new Map<string, any>();
        const visited = new Set<string>();
        // 与任务面板保持一致：完成父任务时，也完成普通子任务或本次实例的子任务。
        const complete = (id: string, date?: string) => {
            const key = `${id}_${date || ''}`;
            if (visited.has(key) || !data[id]) return;
            visited.add(key);
            const task = data[id];
            const state = date ? getRepeatInstanceState(task, date) : undefined;
            if (state?.deleted) return;
            if (date) {
                if (!state?.completed) setRepeatInstanceCompletion(task, date, true, completedTime);
            } else {
                if (!task.completed) task.completedTime = completedTime;
                task.completed = true;
                if (task.customProgress !== undefined && task.customProgress !== null && task.customProgress !== '' && Number.isFinite(Number(task.customProgress))) {
                    task.customProgress = 100;
                }
            }
            const blockId = date ? getInstanceField(state, 'blockId', task.blockId) : task.blockId;
            if (blockId) affectedBlocks.add(blockId);
            affectedTasks.set(id, task);
            for (const child of Object.values(data)) {
                if (child.parentId === id) complete(child.id, date);
                else if (date && child.parentId === `${id}_${date}`) complete(child.id);
            }
        };
        complete(taskId, instanceDate);
        await this.plugin.saveReminderData(data);
        const { updateBindBlockAtrrs } = await import('../api');
        const updates = await Promise.allSettled([
            ...Array.from(affectedTasks.values(), task => this.plugin.updateMobileNotification(task)),
            ...Array.from(affectedBlocks, blockId => updateBindBlockAtrrs(blockId, this.plugin))
        ]);
        updates.forEach(result => {
            if (result.status === 'rejected') console.warn('完成任务后更新关联信息失败:', result.reason);
        });
        await this.plugin.playTaskCompleteSound();
        this.updateBadges();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    private showActions(reminderInfo: ReminderNotificationInfo) {
        const actions = this.getActions(reminderInfo);
        if (!actions.length) return;
        this.focusWindow();
        const dialog = new Dialog({
            title: reminderInfo.notificationKind === 'habit' ? i18n('habitReminder') : i18n('timeReminderNotification'),
            content: `<div class="b3-dialog__content"><div class="ft__breakword" data-notification-title></div></div>
                <div class="b3-dialog__action">${actions.map((_, index) => `<button class="b3-button b3-button--text" data-notification-action="${index}"></button>`).join('<div class="fn__space"></div>')}</div>`,
            width: '420px'
        });
        dialog.element.querySelector('[data-notification-title]').textContent = reminderInfo.title || i18n('unnamedNote');
        actions.forEach((action, index) => {
            const button = dialog.element.querySelector(`[data-notification-action="${index}"]`) as HTMLButtonElement;
            button.textContent = action.text;
            button.addEventListener('click', () => {
                dialog.destroy();
                void this.handleAction(reminderInfo, action.action);
            });
        });
    }

    /**
     * 显示系统弹窗通知，桌面原生通知支持直接操作任务和习惯。
     * @param title 通知标题
     * @param message 通知消息
     * @param reminderInfo 提醒信息（可选，用于点击跳转）
     * @param scheduledTime 定时发送时间（可选，用于移动端定时通知）
     */
    public async show(title: string, message: string, reminderInfo?: ReminderNotificationInfo, scheduledTime?: Date | string): Promise<number | undefined> {
        // 判断是否是移动端
        if (this.plugin.isInMobileApp) {
            // 手机端：使用内核接口进行系统通知
            try {
                // 如果有预定时间，则传递时间戳进行定时通知
                if (scheduledTime) {
                    return await sendNotification(title, message, scheduledTime);
                } else {
                    return await sendNotification(title, message);
                }
            } catch (error) {
                console.warn('手机端发送系统通知失败:', error);
            }
            return;
        }

        try {
            const actions = this.getActions(reminderInfo);
            // Windows 在 Electron 42 起支持原生 action 回调；旧版点击通知后提供操作框。
            try {
                const remote = (window as any).require?.('@electron/remote');
                const runtimeProcess = remote?.process;
                const supportsActions = runtimeProcess?.platform === 'darwin'
                    || (runtimeProcess?.platform === 'win32' && parseInt(runtimeProcess.versions.electron, 10) >= 42);
                if (actions.length && supportsActions && remote.Notification?.isSupported()) {
                    const notification = new remote.Notification({
                        title, body: message, timeoutType: 'never',
                        actions: actions.map(action => ({ type: 'button', text: action.text }))
                    });
                    this.desktopReminderNotifications.add(notification);
                    let handled = false;
                    notification.on('close', (event: { reason?: string }) => {
                        // 超时后通知仍可能留在通知中心；主动关闭则结束本次交互。
                        if (event?.reason === 'timedOut') return;
                        handled = true;
                        this.desktopReminderNotifications.delete(notification);
                    });
                    notification.on('action', (event: any, legacyIndex?: number) => {
                        const index = typeof event?.actionIndex === 'number' ? event.actionIndex : legacyIndex;
                        if (handled || !this.desktopReminderNotifications.has(notification) || !actions[index]) return;
                        handled = true;
                        notification.close();
                        this.desktopReminderNotifications.delete(notification);
                        void this.handleAction(reminderInfo, actions[index].action);
                    });
                    notification.on('click', () => {
                        if (handled || !this.desktopReminderNotifications.has(notification)) return;
                        handled = true;
                        notification.close();
                        this.desktopReminderNotifications.delete(notification);
                        this.showActions(reminderInfo);
                    });
                    notification.on('failed', (_event: any, error: string) => {
                        if (handled || !this.desktopReminderNotifications.has(notification)) return;
                        handled = true;
                        console.warn('原生系统通知失败:', error);
                        this.desktopReminderNotifications.delete(notification);
                        this.showActions(reminderInfo);
                    });
                    notification.show();
                    return;
                }
            } catch (error) {
                console.debug('原生通知不可用，回退浏览器通知:', error);
            }
            if ('Notification' in window && Notification.permission === 'granted') {
                // 使用浏览器通知
                const notification = new Notification(title, {
                    body: message,
                    requireInteraction: true,
                    silent: false, // 使用我们自己的音频
                });
                this.desktopReminderNotifications.add(notification);
                let handled = false;
                notification.onclose = () => {
                    handled = true;
                    this.desktopReminderNotifications.delete(notification);
                };

                // 点击通知时的处理
                notification.onclick = () => {
                    if (handled || !this.desktopReminderNotifications.has(notification)) return;
                    handled = true;
                    this.focusWindow();
                    notification.close();
                    this.desktopReminderNotifications.delete(notification);

                    if (actions.length) {
                        this.showActions(reminderInfo);
                        return;
                    }

                    // 如果有提醒信息，跳转到相关块
                    if (reminderInfo && reminderInfo.blockId) {
                        try {
                            import("../api").then(({ openBlock }) => {
                                openBlock(reminderInfo.blockId);
                            });
                        } catch (error) {
                            console.warn('跳转到块失败:', error);
                        }
                    }
                };


            } else if ('Notification' in window && Notification.permission === 'default') {
                // 请求通知权限
                Notification.requestPermission().then(async permission => {
                    if (permission === 'granted') {
                        // 权限获取成功，递归调用显示通知
                        await this.show(title, message, reminderInfo, scheduledTime);
                    }
                });
            }
        } catch (error) {
            console.warn('显示系统弹窗失败:', error);
        }
    }

    public destroy(): void {
        this.desktopReminderNotifications.forEach(notification => {
            try { notification.close(); } catch (error) { console.debug('关闭系统通知失败:', error); }
        });
        this.desktopReminderNotifications.clear();
    }
}
