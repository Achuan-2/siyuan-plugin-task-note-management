import { pushErrMsg, pushMsg, putFile, getFile, removeFile } from '../api';
import { ParsedIcsEvent, parseIcsFile, isEventPast, resolveDefaultKanbanStatus } from './icsImport';
import { deleteCalDavTask, fetchCalDavEvents, putCalDavTask } from './caldavSubscription';
import { i18n } from "../pluginInstance";

export interface IcsSubscription {
    id: string;
    name: string;
    type?: 'ics' | 'caldav';
    provider?: 'generic' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';
    readonly?: boolean; // Whether CalDAV write-back is disabled (e.g. DingTalk is read-only)
    url: string;
    username?: string;
    password?: string;
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
    caldavEditable?: boolean;
    caldavDeletable?: boolean;
    createdAt: string;
}

export function isSubscriptionEditable(subscription: any): boolean {
    if (!subscription || subscription.type !== 'caldav') return false;
    if (subscription.readonly === true) return false;
    const provider = subscription.provider || 'generic';
    if (provider === 'wecom') return true;
    if (provider === 'dingtalk') return false;
    if (provider === 'feishu') return false;
    if (provider === 'qq') return false;
    return subscription.caldavEditable !== false;
}

export function isSubscriptionDeletable(subscription: any): boolean {
    if (!subscription || subscription.type !== 'caldav') return false;
    if (subscription.readonly === true) return false;
    const provider = subscription.provider || 'generic';
    if (provider === 'wecom') return true;
    if (provider === 'dingtalk') return true;
    if (provider === 'feishu') return false;
    if (provider === 'qq') return true;
    return subscription.caldavDeletable !== false;
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
 * Get all reminders including subscriptions.
 * This merges reminder.json with all subscription files.
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

                    // Skip manually deleted tasks — they exist in the file to prevent
                    // re-appearing after sync, but should never be shown in the UI
                    if (task.manualDelete) {
                        updatedSubTasks[key] = task;
                        return;
                    }

                    // 处理重复事件 - 无需生成实例，直接透传
                    if (task.repeat && task.repeat.enabled) {
                        updatedSubTasks[key] = task;

                        allReminders[key] = {
                            ...task,
                            isSubscribed: true,
                            subscriptionId: subscription.id,
                            subscriptionType: subscription.type || task.subscriptionType || 'ics',
                            showNoteInCalendar: subscription.showNoteInCalendar,
                            caldavEditable: isSubscriptionEditable(subscription),
                            caldavDeletable: isSubscriptionDeletable(subscription),
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
                            subscriptionType: subscription.type || task.subscriptionType || 'ics',
                            showNoteInCalendar: subscription.showNoteInCalendar,
                            caldavEditable: isSubscriptionEditable(subscription),
                            caldavDeletable: isSubscriptionDeletable(subscription),
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

function isCalDavSubscription(subscription: IcsSubscription | undefined): boolean {
    return subscription?.type === 'caldav';
}

interface CalDavCapabilities {
    canCreate: boolean;   // Can PUT new events to server
    canUpdate: boolean;   // Can PUT updates to existing events
    canDelete: boolean;   // Can DELETE events from server
}

/**
 * Returns the write capabilities for a CalDAV subscription.
 */
function getProviderCapabilities(subscription: IcsSubscription): CalDavCapabilities {
    const editable = isSubscriptionEditable(subscription);
    const deletable = isSubscriptionDeletable(subscription);
    return {
        canCreate: editable,
        canUpdate: editable,
        canDelete: deletable
    };
}

function stripRuntimeSubscriptionFields(reminder: any): any {
    const { isSubscribed, subscriptionId, subscriptionType, showNoteInCalendar, caldavEditable, caldavDeletable, ...cleanReminder } = reminder;
    return cleanReminder;
}

function normalizeSubscriptionTasksForCompare(tasks: any): any {
    const normalized: any = {};
    Object.entries(tasks || {}).forEach(([id, task]) => {
        normalized[id] = stripRuntimeSubscriptionFields(task);
    });
    return normalized;
}

async function syncCalDavTaskChanges(
    subscription: IcsSubscription,
    currentTasks: any,
    nextTasks: any
): Promise<any> {
    const caps = getProviderCapabilities(subscription);
    const syncedTasks = { ...(nextTasks || {}) };

    // Preserve any existing manualDelete markers (don't lose them on save)
    for (const [id, task] of Object.entries(currentTasks || {}) as [string, any][]) {
        if (task.manualDelete && !syncedTasks[id]) {
            syncedTasks[id] = task;
        }
    }

    // Handle deletions: tasks in currentTasks but removed from nextTasks
    for (const [id, currentTask] of Object.entries(currentTasks || {}) as [string, any][]) {
        if (currentTask.manualDelete) continue; // already handled above
        if (syncedTasks[id] && !syncedTasks[id].manualDelete) continue; // still exists
        // Task was deleted locally
        if (caps.canDelete) {
            try {
                await deleteCalDavTask(subscription, currentTask);
            } catch (e: any) {
                console.warn(`[CalDAV] DELETE failed for task ${id}, skipping:`, e?.message || e);
            }
            // Let it be removed (not re-added to syncedTasks)
        } else {
            // Cannot delete from server — mark locally so it won't reappear after sync
            console.warn(`[CalDAV] Provider "${subscription.provider}" does not support DELETE. Marking task ${id} as manualDelete.`);
            syncedTasks[id] = { ...currentTask, manualDelete: true };
        }
    }

    // Handle creates and updates
    for (const [id, nextTask] of Object.entries(syncedTasks) as [string, any][]) {
        if (nextTask.manualDelete) continue; // skip soft-deleted tasks

        const currentTask = currentTasks?.[id];
        const isNew = !nextTask.caldavHref; // no href means not yet on server

        if (!isNew && currentTask &&
            isSameReminderPayload(stripRuntimeSubscriptionFields(currentTask), nextTask)) {
            continue; // no changes
        }

        const shouldPut = isNew ? caps.canCreate : caps.canUpdate;
        if (!shouldPut) {
            console.warn(`[CalDAV] Provider "${subscription.provider}" does not support ${isNew ? 'CREATE' : 'UPDATE'}. Skipping task ${id}.`);
            continue;
        }

        try {
            const result = await putCalDavTask(subscription, nextTask);
            syncedTasks[id] = {
                ...nextTask,
                caldavHref: result.href,
                caldavEtag: result.etag,
                caldavRawIcs: result.rawIcs,
                subscriptionType: 'caldav'
            };
        } catch (e: any) {
            console.warn(`[CalDAV] PUT failed for task ${id}, keeping local state:`, e?.message || e);
        }
    }

    return syncedTasks;
}

async function saveSubscriptionReminderTasks(
    plugin: any,
    subscription: IcsSubscription,
    nextTasks: any
): Promise<void> {
    const currentTasks = await loadSubscriptionTasks(plugin, subscription.id);
    
    // Merge the incoming updates (nextTasks) into the full list of current tasks
    const mergedTasks = { ...(currentTasks || {}) };
    Object.keys(nextTasks || {}).forEach(id => {
        mergedTasks[id] = nextTasks[id];
    });

    let tasksToSave = mergedTasks;

    if (isCalDavSubscription(subscription)) {
        tasksToSave = await syncCalDavTaskChanges(subscription, currentTasks, tasksToSave);
    }

    if (
        !isSameReminderPayload(
            normalizeSubscriptionTasksForCompare(currentTasks),
            normalizeSubscriptionTasksForCompare(tasksToSave)
        )
    ) {
        await saveSubscriptionTasks(plugin, subscription.id, tasksToSave);
    }
}

export async function deleteSubscriptionReminderTask(plugin: any, reminder: any): Promise<void> {
    if (!reminder?.subscriptionId) return;

    const subscriptionData = await loadSubscriptions(plugin);
    const subscription = subscriptionData.subscriptions?.[reminder.subscriptionId];
    if (!subscription) return;

    const currentTasks = await loadSubscriptionTasks(plugin, reminder.subscriptionId);

    if (isCalDavSubscription(subscription)) {
        const caps = getProviderCapabilities(subscription);
        if (caps.canDelete) {
            // Delete from server (ignore errors — file will be cleaned up anyway)
            try {
                await deleteCalDavTask(subscription, reminder);
            } catch (e: any) {
                console.warn('[CalDAV] DELETE failed, removing locally anyway:', e?.message || e);
            }
            // Remove from local file
            if (currentTasks && currentTasks[reminder.id]) {
                delete currentTasks[reminder.id];
                await saveSubscriptionTasks(plugin, reminder.subscriptionId, currentTasks);
            }
        } else {
            // Provider does not support DELETE — mark locally so it won't reappear after sync
            console.warn(`[CalDAV] Provider "${subscription.provider}" does not support DELETE. Marking task as manualDelete.`);
            if (currentTasks && currentTasks[reminder.id]) {
                currentTasks[reminder.id] = { ...currentTasks[reminder.id], manualDelete: true };
                await saveSubscriptionTasks(plugin, reminder.subscriptionId, currentTasks);
            }
        }
        return;
    }

    // Non-CalDAV (plain ICS): just remove from local file
    if (currentTasks && currentTasks[reminder.id]) {
        delete currentTasks[reminder.id];
        await saveSubscriptionTasks(plugin, reminder.subscriptionId, currentTasks);
    }
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
                subRemindersBySubId[reminder.subscriptionId][id] = stripRuntimeSubscriptionFields(reminder);
            } else {
                localReminders[id] = reminder;
            }
        });

        // Save local reminders
        await plugin.saveReminderData(localReminders);

        // Save each subscription's tasks
        for (const subId of Object.keys(subRemindersBySubId)) {
            const subscription = subscriptionData.subscriptions[subId];
            if (subscription) {
                await saveSubscriptionReminderTasks(plugin, subscription, subRemindersBySubId[subId]);
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

async function buildTasksFromSubscriptionEvents(
    plugin: any,
    subscription: IcsSubscription,
    events: Array<ParsedIcsEvent & Record<string, any>>
): Promise<any> {
    const existingTasks = await loadSubscriptionTasks(plugin, subscription.id);

    // Build set of manually-deleted UIDs so they don't reappear after sync
    const manuallyDeletedUids = new Set<string>();
    const manuallyDeletedTasks: any = {};
    for (const [id, task] of Object.entries(existingTasks) as [string, any][]) {
        if (task.manualDelete) {
            manuallyDeletedTasks[id] = task;
            if (task.uid) manuallyDeletedUids.add(task.uid);
        }
    }

    if (events.length === 0) {
        // Preserve manualDelete entries even when server returns no events
        return { ...manuallyDeletedTasks };
    }

    const existingTasksByUid = new Map<string, any>();
    for (const task of Object.values(existingTasks) as any[]) {
        if (task.uid && !task.manualDelete) {
            existingTasksByUid.set(task.uid, task);
        }
    }

    const defaultKanbanStatus = await resolveDefaultKanbanStatus(plugin, subscription.projectId);
    const tasks: any = {};
    const subscriptionType = subscription.type || 'ics';

    for (const event of events) {
        // Skip events the user has manually deleted locally
        if (event.uid && manuallyDeletedUids.has(event.uid)) continue;

        const existingTask = event.uid ? existingTasksByUid.get(event.uid) : undefined;
        const preserveCompleted = existingTask?.completed === true;

        const id =
            existingTask?.id ||
            window.Lute?.NewNodeID?.() ||
            `${subscription.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const isPast = isEventPast(event);
        const isCompleted = preserveCompleted ? existingTask.completed : event.completed || isPast;

        if (existingTask) {
            tasks[id] = {
                ...existingTask,
                title: event.title,
                date: event.date,
                time: event.time,
                endDate: event.endDate,
                endTime: event.endTime,
                repeat: event.repeat,
                completed: isCompleted,
                completedAt: preserveCompleted ? existingTask.completedAt : undefined,
                kanbanStatus: isCompleted ? 'completed' : (existingTask.kanbanStatus === 'completed' ? defaultKanbanStatus : existingTask.kanbanStatus),
                subscriptionId: subscription.id,
                subscriptionType,
                isSubscribed: true,
                showNoteInCalendar: subscription.showNoteInCalendar,
                caldavEditable: isSubscriptionEditable(subscription),
                caldavDeletable: isSubscriptionDeletable(subscription),
            };
        } else {
            tasks[id] = {
                id,
                ...event,
                note: event.description,
                projectId: subscription.projectId,
                categoryId: subscription.categoryId,
                priority: subscription.priority || 'none',
                tagIds: subscription.tagIds || [],
                completed: isCompleted,
                completedAt: undefined,
                kanbanStatus: isCompleted ? 'completed' : defaultKanbanStatus,
                createdAt: event.createdAt || new Date().toISOString(),
                subscriptionId: subscription.id,
                subscriptionType,
                isSubscribed: true,
                showNoteInCalendar: subscription.showNoteInCalendar,
                caldavEditable: isSubscriptionEditable(subscription),
                caldavDeletable: isSubscriptionDeletable(subscription),
            };
        }
    }

    // Re-attach manually deleted tasks so the markers persist across syncs
    Object.assign(tasks, manuallyDeletedTasks);

    return tasks;
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
        const subscriptionType = subscription.type || 'ics';
        let events: Array<ParsedIcsEvent & Record<string, any>>;

        if (subscriptionType === 'caldav') {
            const remoteEvents = await fetchCalDavEvents(subscription);
            events = remoteEvents.map(remoteEvent => ({
                ...remoteEvent.event,
                caldavHref: remoteEvent.href,
                caldavEtag: remoteEvent.etag,
                caldavRawIcs: remoteEvent.rawIcs
            }));
        } else {
            const icsContent = await fetchIcsContent(subscription.url);
            events = await parseIcsFile(icsContent);
        }

        if (events.length === 0) {
            // Clear subscription file if no events
            await saveSubscriptionTasks(plugin, subscription.id, {});
            return { success: true, eventsCount: 0 };
        }

        const tasks = await buildTasksFromSubscriptionEvents(plugin, subscription, events);

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
            await pushErrMsg(`日历订阅同步完成：成功 ${successCount} 个，失败 ${errorCount} 个`);
        } else {
            await pushMsg(`日历订阅同步成功：已同步 ${successCount} 个日历`);
        }
    } catch (error) {
        console.error('Failed to sync all subscriptions:', error);
        await pushErrMsg('日历订阅同步失败: ' + (error.message || error));
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
