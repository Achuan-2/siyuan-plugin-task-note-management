import { updateBindBlockAtrrs } from '../api';
import { parseReminderInstanceId } from '../components/dataManager/repeatUtils';
import { i18n } from '../pluginInstance';
import { deleteSubscriptionReminderTask, getAllReminders } from './icsSubscription';
import { createCompletedRemindersForDeletion } from './repeatTaskDeletion';
import { TaskActionUndo } from './taskActionUndo';
import type { HolidayData } from './reminderSkipDate';

/** 包括所有层级子任务及落盘的重复实例，损坏的循环关系也只访问一次。 */
export function collectTaskDeletionIds(data: Record<string, any>, targetId: string): Set<string> {
    const children = new Map<string, Set<string>>();
    for (const [id, task] of Object.entries(data)) {
        if (!task) continue;
        const originalId = task.originalId || parseReminderInstanceId(id)?.originalId;
        for (const parentId of [task.parentId, originalId]) {
            if (!parentId || parentId === id) continue;
            if (!children.has(parentId)) children.set(parentId, new Set());
            children.get(parentId)!.add(id);
        }
    }
    const ids = new Set([targetId]);
    for (const id of ids) {
        for (const childId of children.get(id) || []) ids.add(childId);
    }
    return ids;
}

/** 确认删除后读取最新全量数据，一次保存整个子树，并沿用现有撤回机制。 */
export async function deleteTaskTree(plugin: any, targetId: string, keepCompletedInstances = false, holidayData?: HolidayData): Promise<TaskActionUndo> {
    const data = await getAllReminders(plugin, undefined, true, 'none', { strict: true });
    if (!data[targetId]) throw new Error(i18n('reminderNotExist'));
    const undo = new TaskActionUndo(plugin, data);
    const ids = collectTaskDeletionIds(data, targetId);
    const retained = keepCompletedInstances
        ? createCompletedRemindersForDeletion(data, ids, { settings: plugin.settings, holidayData })
        : {};
    const blockIds = new Set<string>();
    const removed = Array.from(ids, id => data[id]).filter(Boolean);
    for (const task of removed) {
        if (task.blockId || task.docId) blockIds.add(task.blockId || task.docId);
        for (const state of Object.values(task.repeat?.instances || {}) as any[]) {
            if (state?.blockId || state?.docId) blockIds.add(state.blockId || state.docId);
        }
    }
    for (const id of ids) delete data[id];
    Object.assign(data, retained);
    await undo.save(data);

    // 数据成功保存后再清理通知和块属性，附带更新失败不阻止关闭弹窗。
    const effects = [
        ...Array.from(ids, id => () => plugin.cancelMobileNotification?.(id)),
        ...Array.from(blockIds, id => () => updateBindBlockAtrrs(id, plugin)),
        ...removed.filter(task => task.isSubscribed && task.subscriptionType === 'caldav')
            .map(task => () => deleteSubscriptionReminderTask(plugin, task)),
    ];
    void Promise.allSettled(effects.map(effect => Promise.resolve().then(effect))).then(results => {
        for (const result of results) {
            if (result.status === 'rejected') console.warn('Failed to refresh deleted task:', result.reason);
        }
    });
    return undo;
}
