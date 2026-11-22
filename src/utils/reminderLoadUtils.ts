import { getLogicalDateString } from "./dateUtils";
import { RepeatInstanceState } from "../components/dialog/RepeatSettingsDialog";
import { cloneTaskData } from './taskUndoPatch';

export function isWritableSubscriptionType(subscriptionType?: string): boolean {
    return subscriptionType === 'caldav' || subscriptionType === 'dida';
}

export function isSubscriptionEditable(subscription: any): boolean {
    if (!subscription || !isWritableSubscriptionType(subscription.type)) return false;
    if (subscription.readonly === true) return false;
    if (subscription.type === 'dida') {
        return subscription.caldavEditable !== false;
    }
    const provider = subscription.provider || 'generic';
    if (provider === 'wecom') return true;
    if (provider === 'dingtalk') return false;
    if (provider === 'feishu') return false;
    if (provider === 'qq') return false;
    return subscription.caldavEditable !== false;
}

export function isSubscriptionDeletable(subscription: any): boolean {
    if (!subscription || !isWritableSubscriptionType(subscription.type)) return false;
    if (subscription.readonly === true) return false;
    if (subscription.type === 'dida') {
        return subscription.caldavDeletable !== false;
    }
    const provider = subscription.provider || 'generic';
    if (provider === 'wecom') return true;
    if (provider === 'qq') return true;
    if (provider === 'feishu' || provider === 'dingtalk') {
        return subscription.caldavDeletable === true;
    }
    return subscription.caldavDeletable !== false;
}

export function isEventPast(event: any): boolean {
    const now = new Date();
    const formatDate = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const formatTime = (d: Date) => {
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    const today = formatDate(now);
    const currentTime = formatTime(now);

    if (!event.date) return false;

    const endD = event.endDate || event.date;
    const endT = event.endTime || event.time;

    if (endT) {
        if (endD < today) return true;
        if (endD > today) return false;
        return endT <= currentTime;
    } else {
        return endD < today;
    }
}

export async function getEnvironmentSafeAllReminders(
    plugin: any,
    projectId?: string,
    filterType?: 'sidebar' | 'matrix' | 'none'
): Promise<any> {
    try {
        const mainReminders = (plugin && typeof plugin.loadReminderData === 'function')
            ? await plugin.loadReminderData()
            : await plugin.loadData("reminder.json") || {};

        let filteredMainReminders = mainReminders;
        if (projectId) {
            filteredMainReminders = {};
            Object.keys(mainReminders).forEach(key => {
                const reminder = mainReminders[key];
                if (reminder && reminder.projectId === projectId) {
                    filteredMainReminders[key] = reminder;
                }
            });
        }

        const subscriptionData = (plugin && typeof plugin.loadSubscriptionData === 'function')
            ? await plugin.loadSubscriptionData()
            : await plugin.loadData("ics_subscriptions.json") || {};
        let subscriptions = subscriptionData ? Object.values(subscriptionData.subscriptions || {}) : [];

        if (projectId) {
            subscriptions = subscriptions.filter((sub: any) => sub.projectId === projectId);
        }

        let allReminders = { ...filteredMainReminders };

        for (const subscription of subscriptions as any[]) {
            if (subscription.enabled) {
                if (filterType === 'sidebar' && !subscription.showInSidebar) continue;
                if (filterType === 'matrix' && !subscription.showInMatrix) continue;

                const subTasks = (plugin && typeof plugin.loadSubscriptionTasks === 'function')
                    ? await plugin.loadSubscriptionTasks(subscription.id)
                    : await plugin.loadData(`subscribe/${subscription.id}.json`) || {};

                Object.keys(subTasks).forEach(key => {
                    const task = subTasks[key];
                    if (task.manualDelete) {
                        return;
                    }

                    if (task.repeat && task.repeat.enabled) {
                        allReminders[key] = {
                            ...task,
                            repeat: cloneTaskData(task.repeat),
                            isSubscribed: true,
                            subscriptionId: subscription.id,
                            subscriptionType: subscription.type || task.subscriptionType || 'ics',
                            showNoteInCalendar: subscription.showNoteInCalendar,
                            caldavEditable: isSubscriptionEditable(subscription),
                            caldavDeletable: isSubscriptionDeletable(subscription),
                        };
                    } else {
                        const isDida = (subscription.type || task.subscriptionType) === 'dida';
                        const isPast = isDida ? false : isEventPast(task);
                        const completed = task.completed || isPast;

                        allReminders[key] = {
                            ...task,
                            completed,
                            isSubscribed: true,
                            subscriptionId: subscription.id,
                            subscriptionType: subscription.type || task.subscriptionType || 'ics',
                            showNoteInCalendar: subscription.showNoteInCalendar,
                            caldavEditable: isSubscriptionEditable(subscription),
                            caldavDeletable: isSubscriptionDeletable(subscription),
                        };
                    }
                });
            }
        }

        return allReminders;
    } catch (error) {
        console.error('Failed to get environment safe reminders:', error);
        return {};
    }
}

/**
 * 清理 ReminderItem，移除默认值或空值的属性以减小文件体积
 */
export function cleanReminderItem(reminder: any): any {
    if (!reminder || typeof reminder !== 'object') return reminder;

    // 需要在为 falsy 时移除的键
    const falsyKeys = [
        'blockId',
        'docId',
        'isAvailableToday',
        'hideInCalendar',
        'notifiedTime',
        'url',
        'date',
        'time',
        'endDate',
        'endTime',
        'note',
        'notes',
        'noteSummary',
        'noteId',
        'categoryId',
        'projectId',
        'linkedHabitId',
        'linkedHabitSyncPomodoroToday',
        'linkedHabitAutoCheckInOnComplete',
        'linkedHabitAutoCheckInOptionKey',
        'linkedHabitAutoCheckInEmoji',
        'customGroupId',
        'milestoneId',
        'parentId',
        'completedTime',
        'pinned',
        'notified'
    ];

    for (const key of falsyKeys) {
        if (!reminder[key]) {
            delete reminder[key];
        }
    }

    // 彻底清除历史遗留属性
    delete reminder.notifiedCustomTime;

    // 默认或无效属性清理
    if (reminder.priority === 'none' || !reminder.priority) {
        delete reminder.priority;
    }

    if (reminder.sort === null || reminder.sort === undefined) {
        delete reminder.sort;
    }

    if (reminder.customProgress === null || reminder.customProgress === undefined) {
        delete reminder.customProgress;
    }

    if (reminder.estimatedPomodoroDuration === null || reminder.estimatedPomodoroDuration === undefined) {
        delete reminder.estimatedPomodoroDuration;
    }

    if (Array.isArray(reminder.tagIds) && reminder.tagIds.length === 0) {
        delete reminder.tagIds;
    }

    if (Array.isArray(reminder.noteAssets)) {
        const cleanedAssets = Array.from(new Set(reminder.noteAssets.filter((x: unknown) => typeof x === 'string' && x.trim())));
        if (cleanedAssets.length > 0) {
            reminder.noteAssets = cleanedAssets;
        } else {
            delete reminder.noteAssets;
        }
    } else if ('noteAssets' in reminder) {
        delete reminder.noteAssets;
    }

    if (Array.isArray(reminder.reminderTimes) && reminder.reminderTimes.length === 0) {
        delete reminder.reminderTimes;
    }

    if (reminder.repeat && !reminder.repeat.enabled) {
        const hasHistory = ['instances', 'excludeDates'].some(
            k => reminder.repeat[k] && Object.keys(reminder.repeat[k]).length > 0
        );
        if (!hasHistory) {
            delete reminder.repeat;
        }
    }

    if (reminder.repeat && reminder.repeat.instances) {
        const instances = reminder.repeat.instances;
        for (const [instanceDate, state] of Object.entries(instances)) {
            if (!state || typeof state !== 'object') {
                delete instances[instanceDate];
                continue;
            }
            cleanInstanceState(state as RepeatInstanceState, reminder, instanceDate);
            const remainingKeys = Object.keys(state).filter(
                k => k !== 'modifiedAt' && k !== 'preservedFromSeriesEdit'
            );
            if (remainingKeys.length === 0) {
                delete instances[instanceDate];
            }
        }
        if (Object.keys(instances).length === 0) {
            delete reminder.repeat.instances;
        }
    }

    return reminder;
}

/**
 * 清理单个重复事件实例状态对象，只保留与原始任务不同的属性以减少文件体积
 */
export function cleanInstanceState(state: RepeatInstanceState, reminder: any, expectedDate: string): void {
    if (!state || typeof state !== 'object') return;

    // 1. 日期特殊处理
    if (state.date === expectedDate) {
        delete state.date;
    }

    // 2. 提醒时间比较
    if (Object.prototype.hasOwnProperty.call(state, 'reminderTimes')) {
        const defaultTimes = reminder.reminderTimes;
        const newTimes = state.reminderTimes;
        const timesDiffers = () => {
            if (!defaultTimes && !newTimes) return false;
            if (!defaultTimes || !newTimes) return true;
            if (defaultTimes.length !== newTimes.length) return true;
            return JSON.stringify(defaultTimes) !== JSON.stringify(newTimes);
        };
        if (!timesDiffers()) {
            delete state.reminderTimes;
        }
    }

    // 3. 标签比较
    if (Object.prototype.hasOwnProperty.call(state, 'tagIds')) {
        const defaultTags = reminder.tagIds;
        const newTags = state.tagIds;
        const tagsDiffers = () => {
            if (!defaultTags && !newTags) return false;
            if (!defaultTags || !newTags) return true;
            if (defaultTags.length !== newTags.length) return true;
            return JSON.stringify(defaultTags.slice().sort()) !== JSON.stringify(newTags.slice().sort());
        };
        if (!tagsDiffers()) {
            delete state.tagIds;
        }
    }

    // 4. 其他属性逐个比较
    const keys = [
        'title', 'endDate', 'time', 'endTime', 'blockId', 'docId', 'url',
        'note', 'priority', 'notified', 'projectId', 'customGroupId',
        'milestoneId', 'kanbanStatus', 'estimatedPomodoroDuration',
        'customProgress', 'treatStartDateAsDeadline', 'reminderSkipWeekendMode',
        'reminderSkipHolidays', 'pinned', 'customReminderPreset', 'categoryId',
        'linkedHabitId', 'linkedHabitSyncPomodoroToday', 'linkedHabitAutoCheckInOnComplete',
        'linkedHabitAutoCheckInOptionKey', 'linkedHabitAutoCheckInEmoji',
        'hideInCalendar', 'isAvailableToday', 'availableStartDate', 'sort'
    ];

    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
            const val = (state as any)[key];
            const defaultVal = reminder[key];

            let isDifferent = false;
            if (key === 'note') {
                isDifferent = (val || '') !== (defaultVal || '');
            } else if (key === 'priority') {
                isDifferent = (val || 'none') !== (defaultVal || 'none');
            } else if (key === 'pinned' || key === 'hideInCalendar' || key === 'isAvailableToday') {
                isDifferent = !!val !== !!defaultVal;
            } else if (key === 'sort') {
                isDifferent = (val ?? 0) !== (defaultVal ?? 0);
            } else {
                if (!val && !defaultVal) {
                    isDifferent = false;
                } else {
                    isDifferent = val !== defaultVal;
                }
            }

            if (!isDifferent) {
                delete (state as any)[key];
            }
        }
    }

    // 彻底清除历史遗留属性及运行时临时属性
    delete (state as any).notifiedCustomTime;
    delete (state as any).noteId;

    // 拆分备注字段清理：
    // - state.notes === true 表示该实例拥有独立备注文件 notes/<id>_<date>.md，保留 notes / noteSummary / noteAssets
    // - state.notes === false 仅当父任务有备注时保留（表示显式清空），否则移除
    // - state.notes 未定义时移除 noteSummary / noteAssets（继承父任务）
    if (state.notes === true) {
        if (!state.noteSummary) delete state.noteSummary;
        if (Array.isArray(state.noteAssets) && state.noteAssets.length > 0) {
            state.noteAssets = Array.from(new Set(state.noteAssets.filter((x: unknown) => typeof x === 'string' && x.trim())));
            if (state.noteAssets.length === 0) delete state.noteAssets;
        } else {
            delete state.noteAssets;
        }
    } else if (state.notes === false) {
        delete state.noteSummary;
        delete state.noteAssets;
        if (reminder?.notes !== true) {
            delete state.notes;
        }
    } else {
        delete state.notes;
        delete state.noteSummary;
        delete state.noteAssets;
    }
}
