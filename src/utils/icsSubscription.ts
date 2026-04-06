import { pushErrMsg, pushMsg, putFile, getFile, removeFile } from '../api';
import { parseIcsFile, isEventPast, resolveDefaultKanbanStatus } from './icsImport';
import { i18n } from "../pluginInstance";

export interface IcsSubscription {
    id: string;
    name: string;
    url: string;
    projectId: string; // Required - must have a project
    categoryId?: string;
    priority?: 'high' | 'medium' | 'low' | 'none';
    syncInterval: 'manual' | '15min' | '30min' | 'hourly' | '4hour' | '12hour' | 'daily' | 'dailyAt';
    dailySyncTime?: string; // 每天同步时间点，格式 HH:MM（当 syncInterval 为 'dailyAt' 时使用）
    enabled: boolean;
    lastSync?: string; // ISO timestamp
    lastSyncStatus?: 'success' | 'error';
    lastSyncError?: string;
    tagIds?: string[];
    showInSidebar?: boolean;
    showInMatrix?: boolean;
    showNoteInCalendar?: boolean;
    createdAt: string;
}

export interface IcsSubscriptionData {
    subscriptions: { [id: string]: IcsSubscription };
}

const SUBSCRIPTION_DATA_FILE = 'ics-subscriptions.json';
const SUBSCRIBE_DIR = '/data/storage/petal/siyuan-plugin-task-note-management/Subscribe/';

/**
 * Get subscription file path
 */
function getSubscriptionFilePath(subscriptionId: string): string {
    return `${SUBSCRIBE_DIR}${subscriptionId}.json`;
}
export async function loadSubscriptions(plugin: any): Promise<IcsSubscriptionData> {
    if (plugin && typeof plugin.loadSubscriptionData === 'function') {
        return await plugin.loadSubscriptionData();
    }
    try {
        const data = await plugin.loadData(SUBSCRIPTION_DATA_FILE);
        return data || { subscriptions: {} };
    } catch (error) {
        console.error('Failed to load ICS subscriptions:', error);
        return { subscriptions: {} };
    }
}

/**
 * Save ICS subscriptions metadata
 */
export async function saveSubscriptions(plugin: any, data: IcsSubscriptionData): Promise<void> {
    try {
        await plugin.saveData(SUBSCRIPTION_DATA_FILE, data);
        if (plugin && typeof plugin.loadSubscriptionData === 'function') {
            await plugin.loadSubscriptionData(true);
        }
    } catch (error) {
        console.error('Failed to save ICS subscriptions:', error);
        throw error;
    }
}

/**
 * Load subscription tasks from its dedicated file
 */
export async function loadSubscriptionTasks(plugin: any, subscriptionId: string): Promise<any> {
    if (plugin && typeof plugin.loadSubscriptionTasks === 'function') {
        return await plugin.loadSubscriptionTasks(subscriptionId);
    }
    try {
        const filePath = getSubscriptionFilePath(subscriptionId);
        const response = await getFile(filePath);

        // Handle error objects
        if (response && typeof response.code === 'number' && response.code !== 0) {
            if (response.code !== 404) {
                console.error(`Failed to load subscription tasks for ${subscriptionId}:`, response);
            }
            return {};
        }

        if (!response) return {};

        if (typeof response === 'object') {
            return response;
        }

        if (typeof response === 'string') {
            try {
                return JSON.parse(response);
            } catch (e) {
                console.error(`Failed to parse subscription tasks for ${subscriptionId}:`, e);
                return {};
            }
        }

        return {};
    } catch (error) {
        console.error(`Failed to load subscription tasks for ${subscriptionId}:`, error);
        return {};
    }
}

/**
 * Save subscription tasks to its dedicated file
 */
export async function saveSubscriptionTasks(plugin: any, subscriptionId: string, tasks: any): Promise<void> {
    try {
        const filePath = getSubscriptionFilePath(subscriptionId);
        const content = JSON.stringify(tasks, null, 2);
        await putFile(filePath, false, new Blob([content]));

        // Refresh cache
        if (plugin && typeof plugin.loadSubscriptionTasks === 'function') {
            await plugin.loadSubscriptionTasks(subscriptionId, true);
        }
    } catch (error) {
        console.error(`Failed to save subscription tasks for ${subscriptionId}:`, error);
        throw error;
    }
}

/**
 * Get all reminders including subscriptions
 * This merges reminder.json with all subscription files
 */
/**
 * Get all reminders including subscriptions
 * This merges reminder.json with all subscription files
 * @param plugin The plugin instance
 * @param projectId Optional project ID to filter by
 * @param force Whether to force reload data from disk/network
 */
export async function getAllReminders(
    plugin: any,
    projectId?: string,
    force: boolean = false,
    filterType?: 'sidebar' | 'matrix' | 'none'
): Promise<any> {
    try {
        // Load main reminders
        const mainReminders = (await plugin.loadReminderData(force)) || {};

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

        // Load subscription metadata
        const subscriptionData = await loadSubscriptions(plugin);
        let subscriptions = Object.values(subscriptionData.subscriptions);

        if (projectId) {
            subscriptions = subscriptions.filter(sub => sub.projectId === projectId);
        }

        // Load and merge all subscription tasks
        let allReminders = { ...filteredMainReminders };

        for (const subscription of subscriptions) {
            if (subscription.enabled) {
                // 根据 context 过滤显示
                if (filterType === 'sidebar' && !subscription.showInSidebar) continue;
                if (filterType === 'matrix' && !subscription.showInMatrix) continue;
                const subTasks = await loadSubscriptionTasks(plugin, subscription.id);
                const updatedSubTasks: any = {};
                let subTasksUpdated = false;

                // Merge subscription tasks, marking them as read-only
                Object.keys(subTasks).forEach(key => {
                    const task = subTasks[key];

                    // 处理重复事件 - 无需生成实例，直接透传
                    if (task.repeat && task.repeat.enabled) {
                        updatedSubTasks[key] = task;

                        allReminders[key] = {
                            ...task,
                            isSubscribed: true,
                            subscriptionId: subscription.id,
                            showNoteInCalendar: subscription.showNoteInCalendar,
                        };
                    } else {
                        // 非重复事件的处理逻辑（原有逻辑）
                        const isPast = isEventPast(task);
                        const completed = task.completed || isPast;

                        // If event is past and not already marked as completed, update the JSON file
                        if (isPast && !task.completed) {
                            updatedSubTasks[key] = { ...task, completed: true };
                            subTasksUpdated = true;
                        } else {
                            updatedSubTasks[key] = task;
                        }

                        allReminders[key] = {
                            ...task,
                            completed,
                            isSubscribed: true,
                            subscriptionId: subscription.id,
                            showNoteInCalendar: subscription.showNoteInCalendar,
                        };
                    }
                });

                // Save updated subscription tasks if any were auto-completed
                if (subTasksUpdated) {
                    await saveSubscriptionTasks(plugin, subscription.id, updatedSubTasks);
                }
            }
        }

        return allReminders;
    } catch (error) {
        console.error('Failed to get all reminders:', error);
        // Fallback to main reminders only
        return (await plugin.loadReminderData()) || {};
    }
}

/**
 * Save reminders back to their respective sources
 * This handles splitting local reminders from subscription tasks
 */
function normalizeForCompare(value: any): any {
    if (Array.isArray(value)) {
        return value.map(item => normalizeForCompare(item));
    }
    if (value && typeof value === 'object') {
        const normalized: any = {};
        Object.keys(value)
            .sort()
            .forEach(key => {
                normalized[key] = normalizeForCompare(value[key]);
            });
        return normalized;
    }
    return value;
}

function isSameReminderPayload(a: any, b: any): boolean {
    return JSON.stringify(normalizeForCompare(a || {})) === JSON.stringify(normalizeForCompare(b || {}));
}

export async function saveReminders(plugin: any, allReminders: any): Promise<void> {
    try {
        const localReminders: any = {};
        const subRemindersBySubId: { [subId: string]: any } = {};

        // Load subscription data to know which subscriptions exist
        const subscriptionData = await loadSubscriptions(plugin);

        Object.keys(allReminders).forEach(id => {
            const reminder = allReminders[id];
            if (reminder.isSubscribed && reminder.subscriptionId) {
                if (!subRemindersBySubId[reminder.subscriptionId]) {
                    subRemindersBySubId[reminder.subscriptionId] = {};
                }
                // Don't save the extra fields we added during merge
                const { isSubscribed, ...cleanReminder } = reminder;
                subRemindersBySubId[reminder.subscriptionId][id] = cleanReminder;
            } else {
                localReminders[id] = reminder;
            }
        });

        // Save local reminders
        await plugin.saveReminderData(localReminders);

        // Save each subscription's tasks
        for (const subId of Object.keys(subRemindersBySubId)) {
            if (subscriptionData.subscriptions[subId]) {
                const nextTasks = subRemindersBySubId[subId];
                let shouldSave = true;
                try {
                    const currentTasks = await loadSubscriptionTasks(plugin, subId);
                    shouldSave = !isSameReminderPayload(currentTasks, nextTasks);
                } catch (error) {
                    console.warn(`Failed to compare subscription tasks for ${subId}, fallback to save`, error);
                }

                if (shouldSave) {
                    await saveSubscriptionTasks(plugin, subId, nextTasks);
                }
            }
        }
    } catch (error) {
        console.error('Failed to save reminders:', error);
        throw error;
    }
}


/**
 * Fetch ICS content from URL
 */
async function fetchIcsContent(url: string): Promise<string> {
    try {
        // Convert webcal:// and webcals:// protocols to http:// and https://
        // webcal:// is just an alias for http://
        // webcals:// is just an alias for https://
        let fetchUrl = url;
        if (url.startsWith('webcal://')) {
            fetchUrl = 'http://' + url.substring(9);
        } else if (url.startsWith('webcals://')) {
            fetchUrl = 'https://' + url.substring(10);
        }

        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'Accept': 'text/calendar, text/plain, */*',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const content = await response.text();
        return content;
    } catch (error) {
        console.error('Failed to fetch ICS from URL:', url, error);
        throw error;
    }
}

/**
 * Sync a single ICS subscription
 */
export async function syncSubscription(
    plugin: any,
    subscription: IcsSubscription
): Promise<{ success: boolean; error?: string; eventsCount?: number }> {
    if (!subscription) {
        console.error('syncSubscription: subscription is undefined');
        return { success: false, error: 'Subscription is undefined' };
    }
    try {
        // Fetch ICS content
        const icsContent = await fetchIcsContent(subscription.url);

        // Parse ICS file
        const events = await parseIcsFile(icsContent);

        if (events.length === 0) {
            // Clear subscription file if no events
            await saveSubscriptionTasks(plugin, subscription.id, {});
            return { success: true, eventsCount: 0 };
        }

        // Load existing tasks to merge with new data
        const existingTasks = await loadSubscriptionTasks(plugin, subscription.id);

        // Build a map of existing tasks by UID for quick lookup
        const existingTasksByUid = new Map<string, any>();
        for (const task of Object.values(existingTasks) as any[]) {
            if (task.uid) {
                existingTasksByUid.set(task.uid, task);
            }
        }

        // Resolve default kanban status based on subscription's project configuration
        const defaultKanbanStatus = await resolveDefaultKanbanStatus(plugin, subscription.projectId);

        // Convert events to reminder format and merge with existing data
        const tasks: any = {};
        for (const event of events) {
            // Check if there's an existing task with the same UID
            const existingTask = event.uid ? existingTasksByUid.get(event.uid) : undefined;

            // Determine if we should preserve the completed status
            // If the existing task is completed, preserve completed and completedAt
            const preserveCompleted = existingTask?.completed === true;

            const id = existingTask?.id || window.Lute?.NewNodeID?.() || `${subscription.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            const isPast = isEventPast(event);
            const isCompleted = preserveCompleted ? existingTask.completed : (event.completed || isPast);

            tasks[id] = {
                id,
                ...event,
                note: event.description,
                // Apply subscription settings
                projectId: subscription.projectId,
                categoryId: subscription.categoryId,
                priority: subscription.priority || 'none',
                tagIds: subscription.tagIds || [],
                // Preserve completed status if the existing task is completed
                completed: isCompleted,
                completedAt: preserveCompleted ? existingTask.completedAt : undefined,
                // 看板状态：已有任务保留原状态；新建任务按完成状态和项目配置决定
                kanbanStatus: existingTask?.kanbanStatus ||
                    (isCompleted ? 'completed' : defaultKanbanStatus),
                createdAt: existingTask?.createdAt || event.createdAt || new Date().toISOString(),
                // Mark as subscribed (read-only)
                subscriptionId: subscription.id,
                isSubscribed: true,
                showNoteInCalendar: subscription.showNoteInCalendar,
            };
        }

        // Save to subscription's dedicated file
        await saveSubscriptionTasks(plugin, subscription.id, tasks);

        // Trigger update event
        window.dispatchEvent(new CustomEvent('reminderUpdated'));

        return { success: true, eventsCount: events.length };
    } catch (error) {
        console.error('Failed to sync subscription:', subscription?.name || 'unknown', error);
        return {
            success: false,
            error: error.message || String(error),
        };
    }
}

/**
 * Sync all enabled subscriptions
 */
export async function syncAllSubscriptions(plugin: any): Promise<void> {
    try {
        const data = await loadSubscriptions(plugin);
        const subscriptions = Object.values(data.subscriptions).filter(sub => sub.enabled);

        if (subscriptions.length === 0) {
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const subscription of subscriptions) {
            const result = await syncSubscription(plugin, subscription);

            // Update subscription status
            subscription.lastSync = new Date().toISOString();
            subscription.lastSyncStatus = result.success ? 'success' : 'error';
            if (!result.success) {
                subscription.lastSyncError = result.error;
                errorCount++;
            } else {
                subscription.lastSyncError = undefined;
                successCount++;
            }

            data.subscriptions[subscription.id] = subscription;
        }

        // Save updated subscription data
        await saveSubscriptions(plugin, data);

        // Show notification
        if (errorCount > 0) {
            await pushErrMsg(`ICS订阅同步完成：成功 ${successCount} 个，失败 ${errorCount} 个`);
        } else {
            await pushMsg(`ICS订阅同步成功：已同步 ${successCount} 个日历`);
        }
    } catch (error) {
        console.error('Failed to sync all subscriptions:', error);
        await pushErrMsg('ICS订阅同步失败: ' + (error.message || error));
    }
}

/**
 * Get sync interval in milliseconds
 * 注意：dailyAt 模式也返回 24小时，实际同步时间由 calculateNextDailySyncTime 计算
 */
export function getSyncIntervalMs(interval: IcsSubscription['syncInterval']): number {
    const intervals = {
        'manual': Infinity, // 手动模式，永不自动同步
        '15min': 15 * 60 * 1000,
        '30min': 30 * 60 * 1000,
        'hourly': 60 * 60 * 1000,
        '4hour': 4 * 60 * 60 * 1000,
        '12hour': 12 * 60 * 60 * 1000,
        'daily': 24 * 60 * 60 * 1000,
        'dailyAt': 24 * 60 * 60 * 1000, // 每天一次，按指定时间点
    };
    return intervals[interval] || intervals['daily'];
}

/**
 * 计算 dailyAt 模式的下次同步时间
 * @param syncTime 同步时间点，格式 HH:MM
 * @returns 下次同步时间的毫秒时间戳
 */
export function calculateNextDailySyncTime(syncTime: string): number {
    const [hours, minutes] = syncTime.split(':').map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

    // 如果今天的时间已过，设置为明天
    if (target.getTime() < now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime();
}

/**
 * Remove subscription and its tasks file
 */
export async function removeSubscription(plugin: any, subscriptionId: string): Promise<void> {
    try {
        // Delete subscription tasks file
        const filePath = getSubscriptionFilePath(subscriptionId);
        await removeFile(filePath);

        // Trigger update event
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    } catch (error) {
        console.error('Failed to remove subscription:', error);
        throw error;
    }
}
/**
 * Update metadata for all tasks in a subscription
 */
export async function updateSubscriptionTaskMetadata(
    plugin: any,
    subscription: IcsSubscription
): Promise<void> {
    try {
        const tasks = await loadSubscriptionTasks(plugin, subscription.id);
        const taskIds = Object.keys(tasks);

        if (taskIds.length === 0) return;

        for (const id of taskIds) {
            tasks[id] = {
                ...tasks[id],
                projectId: subscription.projectId,
                categoryId: subscription.categoryId,
                priority: subscription.priority || 'none',
                tagIds: subscription.tagIds || [],
            };
        }

        await saveSubscriptionTasks(plugin, subscription.id, tasks);
        // Trigger update event
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    } catch (error) {
        console.error('Failed to update subscription task metadata:', error);
        throw error;
    }
}

/**
 * Sync holidays from ICS URL
 */
export async function syncHolidays(plugin: any, url: string): Promise<boolean> {
    try {
        const icsContent = await fetchIcsContent(url);
        const events = await parseIcsFile(icsContent);

        const holidayData: { [date: string]: { title: string, type: 'holiday' | 'workday' } } = {};
        for (const event of events) {
            if (event.date) {
                const title = event.title || '';
                let type: 'holiday' | 'workday' = 'holiday';
                // 通常节假日 ICS 中，补班会带有 “班” 字，放假带有 “休” 字
                if (title.includes('班') || title.toLowerCase().includes('work')) {
                    type = 'workday';
                } else if (title.includes('休') || title.toLowerCase().includes('holiday') || title.toLowerCase().includes('off')) {
                    type = 'holiday';
                }
                // 默认如果什么都没匹配到，也可以认为是holiday，因为这是节假日日历

                holidayData[event.date] = { title, type };
            }
        }

        await plugin.saveHolidayData(holidayData);
        return true;
    } catch (error) {
        console.error('Failed to sync holidays:', error);
        return false;
    }
}

/**
 * Load holidays
 */
export async function loadHolidays(plugin: any): Promise<{ [date: string]: { title: string, type: 'holiday' | 'workday' } }> {
    try {
        let data = await plugin.loadHolidayData();
        if (!data || Object.keys(data).length === 0) {
            // 如果数据不存在，检查设置，如果开启了节假日显示且有 URL，则自动同步
            const settings = await plugin.loadSettings();
            if (settings.calendarShowHoliday && settings.calendarHolidayIcsUrl) {
                pushMsg(i18n('downloadingHolidays'));
                const success = await syncHolidays(plugin, settings.calendarHolidayIcsUrl);
                if (success) {
                    data = await plugin.loadHolidayData();
                }
            }
        }
        return data || {};
    } catch (error) {
        return {};
    }
}
