import { updateBindBlockAtrrs } from '../api';
import { addDaysToDate, getDaysDifference, getRepeatInstanceOriginalKey, getRepeatInstanceState } from '../components/dataManager/repeatUtils';
import { i18n } from '../pluginInstance';
import { TaskActionUndo } from './taskActionUndo';
import { cloneTaskData } from './taskUndoPatch';

const copyQueues = new WeakMap<object, Promise<void>>();

/** 绝对日期提醒随新系列起点平移，时刻和相对天数配置保持原值。 */
function shiftReminderTimes(times: any[], offset: number): any[] {
    const shift = (value: any) => typeof value === 'string'
        ? value.replace(/^\d{4}-\d{2}-\d{2}(?=[T ]|$)/, date => addDaysToDate(date, offset)) : value;
    return times.map(entry => {
        if (typeof entry === 'string') return shift(entry);
        const copy = { ...entry, time: shift(entry.time), endTime: shift(entry.endTime) };
        if (entry.overrides) {
            copy.overrides = Object.fromEntries(Object.entries(entry.overrides).map(([date, value]: [string, any]) => [
                addDaysToDate(date, offset), { ...value, time: shift(value.time), endTime: shift(value.endTime) }
            ]));
        }
        return copy;
    });
}

/** 创建新的任务记录，保留配置，清除完成、通知、计时和视图投影数据。 */
function copyTaskConfiguration(source: any): any {
    const copy = cloneTaskData(source);
    for (const key of Object.keys(copy)) {
        if (key.startsWith('__')) delete copy[key];
    }
    for (const key of [
        'originalId', 'instanceId', 'instanceDate', 'isRepeatInstance', 'isRepeated', 'isRepeatedInstance',
        'isSpanningTodayCompletedInstance', 'isSpanningTodayUncompletedInstance',
        'completedTime', 'notified', 'notifiedTime', 'notifiedTimes', 'notifiedCustomTime',
        'dailyCompletions', 'dailyCompletionsTimes', 'dailyDessertCompleted', 'dailyDessertCompletedTimes',
        'dailyDessertIgnored', 'todayIgnored', 'pomodoroCount', 'instancePomodoroCount', 'hasActivePomodoroTimer',
        'deleted', 'modifiedAt', 'preservedFromSeriesEdit', 'created', 'createdTime', 'updatedTime',
    ]) delete copy[key];
    if (copy.repeat) {
        delete copy.repeat.instances;
        delete copy.repeat.excludeDates;
    }
    copy.completed = false;
    if (copy.kanbanStatus === 'completed' || copy.kanbanStatus === 'abandoned') copy.kanbanStatus = 'doing';
    return copy;
}

/** 读取落盘模板而非面板缓存，复制全部后代；重复实例复制为从该日期开始的新系列。 */
export function buildTaskTreeCopy(data: Record<string, any>, target: any): { rootId: string; tasks: Record<string, any> } {
    const sourceId = target.isRepeatInstance || target.isSpanningTodayCompletedInstance
        ? target.originalId : target.id;
    const source = data[sourceId];
    if (!source || source.isSubscribed) throw new Error(i18n('reminderNotExist'));

    const instanceKey = target.isRepeatInstance ? getRepeatInstanceOriginalKey(target) : '';
    const state = instanceKey ? getRepeatInstanceState(source, instanceKey) : undefined;
    if (state?.deleted || state?.date === null || source.repeat?.excludeDates?.includes(instanceKey)) {
        throw new Error(i18n('reminderNotExist'));
    }
    const rootSource = state ? { ...source, ...state } : source;
    const startDate = instanceKey ? (state?.date || target.date || instanceKey) : source.date;
    const dateOffset = source.date && startDate ? getDaysDifference(source.date, startDate) : 0;
    const children = new Map<string, string[]>();
    for (const [id, task] of Object.entries(data)) {
        if (!task?.parentId || task.isSubscribed) continue;
        if (!children.has(task.parentId)) children.set(task.parentId, []);
        children.get(task.parentId)!.push(id);
    }

    const entries = [{ id: sourceId, parentId: source.parentId, instanceOnly: false }];
    const seen = new Set([sourceId]);
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        // 同时收录仅添加到当前实例的子任务，使副本拥有完整的当前子树。
        const parentIds = instanceKey ? [entry.id, `${entry.id}_${instanceKey}`] : [entry.id];
        for (const parentId of parentIds) {
            for (const childId of children.get(parentId) || []) {
                if (seen.has(childId)) continue;
                seen.add(childId);
                entries.push({
                    id: childId,
                    parentId: entry.id,
                    instanceOnly: entry.instanceOnly || parentId !== entry.id
                });
            }
        }
    }

    const ids = new Map<string, string>();
    const reservedIds = new Set(Object.keys(data));
    const now = new Date().toISOString();
    for (const entry of entries) {
        let id: string;
        do {
            id = `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 11)}_${ids.size}`;
        } while (reservedIds.has(id));
        ids.set(entry.id, id);
        reservedIds.add(id);
    }

    const tasks: Record<string, any> = {};
    for (const entry of entries) {
        const original = data[entry.id];
        const copy = copyTaskConfiguration(entry.id === sourceId ? rootSource : original);
        if (instanceKey && !entry.instanceOnly) {
            if (original.date) copy.date = addDaysToDate(original.date, dateOffset);
            if (original.endDate) copy.endDate = addDaysToDate(original.endDate, dateOffset);
            // 实例覆盖里的提醒时间已经使用实际日期，只有模板提醒需要平移。
            if (copy.reminderTimes && !(entry.id === sourceId && state?.reminderTimes !== undefined)) {
                copy.reminderTimes = shiftReminderTimes(copy.reminderTimes, dateOffset);
            }
        }
        if (entry.id === sourceId && instanceKey) {
            copy.date = startDate;
            if (state && Object.prototype.hasOwnProperty.call(state, 'endDate')) copy.endDate = state.endDate;
        }
        copy.id = ids.get(entry.id)!;
        // 对损坏的循环关系断开根的父引用；正常复制子任务时仍保留其外部父任务。
        copy.parentId = entry.id === sourceId
            ? (seen.has(source.parentId) ? undefined : source.parentId)
            : ids.get(entry.parentId)!;
        copy.createdAt = now;
        copy.updatedAt = now;
        tasks[copy.id] = copy;
    }

    const rootId = ids.get(sourceId)!;
    const root = tasks[rootId];
    const sort = Number.isFinite(source.sort) ? source.sort : 0;
    const nextSort = Object.values(data).reduce((next, task: any) => {
        return task && task.parentId === source.parentId && task.projectId === source.projectId
            && Number.isFinite(task.sort) && task.sort > sort ? Math.min(next, task.sort) : next;
    }, Infinity);
    root.sort = Number.isFinite(nextSort) ? sort + (nextSort - sort) / 2 : sort + 10;
    return { rootId, tasks };
}

/** 两个面板共用串行写入，成功后统一刷新视图、通知和绑定块，并提供整棵子树撤回。 */
export function duplicateTaskTree(plugin: any, target: any): Promise<TaskActionUndo> {
    const pending = (copyQueues.get(plugin) || Promise.resolve()).then(async () => {
        const data = cloneTaskData(await plugin.loadReminderData() || {});
        const { tasks } = buildTaskTreeCopy(data, target);
        const undo = new TaskActionUndo(plugin, data);
        await undo.save({ ...data, ...tasks });
        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { refreshDelayMs: 0 } }));

        const blockIds = new Set<string>();
        for (const task of Object.values(tasks)) {
            if (task.blockId || task.docId) blockIds.add(task.blockId || task.docId);
        }
        const effects = [
            () => plugin.updateBadges?.(),
            ...Object.values(tasks).map(task => () => plugin.updateMobileNotification?.(task)),
            ...Array.from(blockIds, id => () => updateBindBlockAtrrs(id, plugin)),
        ];
        void Promise.allSettled(effects.map(effect => Promise.resolve().then(effect))).then(results => {
            for (const result of results) {
                if (result.status === 'rejected') console.warn('Failed to refresh copied task:', result.reason);
            }
        });
        return undo;
    });
    copyQueues.set(plugin, pending.then(() => undefined, () => undefined));
    return pending;
}
