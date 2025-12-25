/*
 * ICS Subscription Management
 * Each subscription stores tasks in a separate JSON file in Subscribe/ directory
 */

import { pushErrMsg, pushMsg, putFile, getFile } from '../api';
import { parseIcsFile, isEventPast } from './icsImport';

export interface IcsSubscription {
    id: string;
    name: string;
    url: string;
    projectId: string; // Required - must have a project
    categoryId?: string;
    priority?: 'high' | 'medium' | 'low' | 'none';
    syncInterval: '15min' | '30min' | 'hourly' | '4hour' | '12hour' | 'daily';
    enabled: boolean;
    lastSync?: string; // ISO timestamp
    lastSyncStatus?: 'success' | 'error';
    lastSyncError?: string;
    tagIds?: string[];
    createdAt: string;
}

export interface IcsSubscriptionData {
    subscriptions: { [id: string]: IcsSubscription };
}

const SUBSCRIPTION_DATA_FILE = 'ics-subscriptions.json';
const SUBSCRIBE_DIR = 'data/storage/petal/siyuan-plugin-task-note-management/Subscribe/';

/**
 * Get subscription file path
 */
function getSubscriptionFilePath(subscriptionId: string): string {
    return `${SUBSCRIBE_DIR}${subscriptionId}.json`;
}

/**
 * Load ICS subscriptions metadata
 */
export async function loadSubscriptions(plugin: any): Promise<IcsSubscriptionData> {
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
    } catch (error) {
        console.error('Failed to save ICS subscriptions:', error);
        throw error;
    }
}

/**
 * Load subscription tasks from its dedicated file
 */
export async function loadSubscriptionTasks(subscriptionId: string): Promise<any> {
    try {
        const filePath = getSubscriptionFilePath(subscriptionId);
        const response = await getFile(filePath);

        // Handle error objects from Siyuan (like 404 Not Found)
        if (response && typeof response.code === 'number' && response.code !== 0) {
            if (response.code !== 404) {
                console.error(`Failed to load subscription tasks for ${subscriptionId}:`, response);
            }
            return {};
        }

        // If response is null or undefined, return empty
        if (!response) {
            return {};
        }

        // If it's already an object (fetchPost might have parsed it if it's JSON)
        if (typeof response === 'object') {
            return response;
        }

        // If it's a string, try to parse it
        if (typeof response === 'string') {
            try {
                return JSON.parse(response);
            } catch (e) {
                console.error(`Failed to parse subscription tasks for ${subscriptionId}:`, e);
                return {};
            }
        }

        // If it's a Buffer/Uint8Array (though getFile likely returns string or object)
        if (response.data) {
            return JSON.parse(new TextDecoder().decode(response.data));
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
export async function saveSubscriptionTasks(subscriptionId: string, tasks: any): Promise<void> {
    try {
        const filePath = getSubscriptionFilePath(subscriptionId);
        const content = JSON.stringify(tasks, null, 2);
        await putFile(filePath, false, new Blob([content]));
    } catch (error) {
        console.error(`Failed to save subscription tasks for ${subscriptionId}:`, error);
        throw error;
    }
}

/**
 * Get all reminders including subscriptions
 * This merges reminder.json with all subscription files
 */
export async function getAllReminders(plugin: any): Promise<any> {
    try {
        // Load main reminders
        const mainReminders = (await plugin.loadData('reminder.json')) || {};

        // Load subscription metadata
        const subscriptionData = await loadSubscriptions(plugin);
        const subscriptions = Object.values(subscriptionData.subscriptions);

        // Load and merge all subscription tasks
        let allReminders = { ...mainReminders };

        for (const subscription of subscriptions) {
            if (subscription.enabled) {
                const subTasks = await loadSubscriptionTasks(subscription.id);
                // Merge subscription tasks, marking them as read-only
                Object.keys(subTasks).forEach(key => {
                    allReminders[key] = {
                        ...subTasks[key],
                        isSubscribed: true,
                        subscriptionId: subscription.id,
                    };
                });
            }
        }

        return allReminders;
    } catch (error) {
        console.error('Failed to get all reminders:', error);
        // Fallback to main reminders only
        return (await plugin.loadData('reminder.json')) || {};
    }
}

/**
 * Save reminders back to their respective sources
 * This handles splitting local reminders from subscription tasks
 */
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
        await plugin.saveData('reminder.json', localReminders);

        // Save each subscription's tasks
        for (const subId of Object.keys(subRemindersBySubId)) {
            if (subscriptionData.subscriptions[subId]) {
                await saveSubscriptionTasks(subId, subRemindersBySubId[subId]);
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
        const response = await fetch(url, {
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
    try {
        // Fetch ICS content
        const icsContent = await fetchIcsContent(subscription.url);

        // Parse ICS file
        const events = await parseIcsFile(icsContent);

        if (events.length === 0) {
            // Clear subscription file if no events
            await saveSubscriptionTasks(subscription.id, {});
            return { success: true, eventsCount: 0 };
        }

        // Convert events to reminder format
        const tasks: any = {};
        for (const event of events) {
            const id = window.Lute?.NewNodeID?.() || `${subscription.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            tasks[id] = {
                id,
                ...event,
                // Apply subscription settings
                projectId: subscription.projectId,
                categoryId: subscription.categoryId,
                priority: subscription.priority || 'none',
                tagIds: subscription.tagIds || [],
                completed: event.completed || isEventPast(event),
                createdAt: event.createdAt || new Date().toISOString(),
                // Mark as subscribed (read-only)
                subscriptionId: subscription.id,
                isSubscribed: true,
            };
        }

        // Save to subscription's dedicated file
        await saveSubscriptionTasks(subscription.id, tasks);

        // Trigger update event
        window.dispatchEvent(new CustomEvent('reminderUpdated'));

        return { success: true, eventsCount: events.length };
    } catch (error) {
        console.error('Failed to sync subscription:', subscription.name, error);
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
 */
export function getSyncIntervalMs(interval: IcsSubscription['syncInterval']): number {
    const intervals = {
        '15min': 15 * 60 * 1000,
        '30min': 30 * 60 * 1000,
        'hourly': 60 * 60 * 1000,
        '4hour': 4 * 60 * 60 * 1000,
        '12hour': 12 * 60 * 60 * 1000,
        'daily': 24 * 60 * 60 * 1000,
    };
    return intervals[interval] || intervals['daily'];
}

/**
 * Remove subscription and its tasks file
 */
export async function removeSubscription(plugin: any, subscriptionId: string): Promise<void> {
    try {
        // Delete subscription tasks file
        await saveSubscriptionTasks(subscriptionId, {});

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
    subscription: IcsSubscription
): Promise<void> {
    try {
        const tasks = await loadSubscriptionTasks(subscription.id);
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

        await saveSubscriptionTasks(subscription.id, tasks);
        // Trigger update event
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    } catch (error) {
        console.error('Failed to update subscription task metadata:', error);
        throw error;
    }
}
