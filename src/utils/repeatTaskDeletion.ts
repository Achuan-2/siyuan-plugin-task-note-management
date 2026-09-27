import { i18n } from '../pluginInstance';
import { confirmDialog } from '../libs/dialog';
import {
    addDaysToDate,
    generateRepeatInstances,
    getDaysDifference,
    getInstanceField,
    getRepeatInstanceCompletedTime,
    getRepeatInstanceOriginalKey,
    getRepeatInstanceState,
    isRepeatInstanceCompleted,
    parseReminderInstanceId,
    resolveRepeatReminderTimes,
} from '../components/dataManager/repeatUtils';
import type { HolidayData } from './reminderSkipDate';

interface RepeatDeletionOptions {
    settings?: any;
    holidayData?: HolidayData;
}

export function showDeleteRepeatTaskDialog(args: {
    title: string;
    description?: string;
    onConfirm: (keepCompletedInstances: boolean) => void | Promise<void>;
}): void {
    const content = document.createElement('div');
    const prompt = document.createElement('p');
    prompt.textContent = i18n('confirmDeleteRepeatInstances', { title: args.title });
    content.appendChild(prompt);
    if (args.description) {
        const description = document.createElement('p');
        description.textContent = args.description;
        content.appendChild(description);
    }

    const options = [
        { keepCompleted: true, label: i18n('deleteIncompleteInstancesOnly') },
        { keepCompleted: false, label: i18n('deleteIncludingCompletedInstances') },
    ];
    let keepCompletedInstances = true;
    const radioName = `delete-repeat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (const option of options) {
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer;';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = radioName;
        radio.checked = option.keepCompleted;
        radio.addEventListener('change', () => {
            if (radio.checked) keepCompletedInstances = option.keepCompleted;
        });
        const text = document.createElement('span');
        text.textContent = option.label;
        label.append(radio, text);
        content.appendChild(label);
    }

    confirmDialog({
        title: i18n('deleteAllInstances'),
        content,
        width: '460px',
        confirm: () => { void args.onConfirm(keepCompletedInstances); },
    });
}

function detachCompletedReminder(reminder: any): any {
    const snapshot = { ...reminder };
    // 已完成实例成为独立的本地任务，不再生成周期实例或参与订阅同步。
    for (const field of [
        'repeat', 'isRepeated', 'isRepeatedInstance', 'isRepeatInstance', 'originalId', 'instanceId', 'instanceDate',
        'deleted', 'modifiedAt', 'preservedFromSeriesEdit', 'isSubscribed', 'subscriptionId', 'subscriptionType',
        'caldavEditable', 'caldavDeletable', 'caldavHref', 'caldavEtag', 'caldavRawIcs',
    ]) {
        delete snapshot[field];
    }
    return snapshot;
}

export function createCompletedInstanceReminders(reminder: any, options: RepeatDeletionOptions = {}): Record<string, any> {
    const completedReminders: Record<string, any> = {};
    const excludedDates = new Set(reminder.repeat?.excludeDates || []);
    const completedDates = Object.keys(reminder.repeat?.instances || {}).filter(instanceDate => {
        const state = getRepeatInstanceState(reminder, instanceDate);
        return isRepeatInstanceCompleted(reminder, instanceDate) && !state?.deleted && state?.date !== null && !excludedDates.has(instanceDate);
    }).sort();
    if (completedDates.length === 0) return completedReminders;

    // 顺延实例的发生日可能不同于原周期日期，复用生成规则保留实际日期。
    const postponedInstances = reminder.repeat.skippedDateAction === 'postpone'
        ? generateRepeatInstances(reminder, completedDates[0], addDaysToDate(completedDates[completedDates.length - 1], 366), Number.MAX_SAFE_INTEGER, options)
        : [];
    const occurrenceDates = new Map(postponedInstances.map(instance => [getRepeatInstanceOriginalKey(instance), instance.date]));
    for (const instanceDate of completedDates) {
        const state = getRepeatInstanceState(reminder, instanceDate);
        const date = getInstanceField(state, 'date', occurrenceDates.get(instanceDate) || instanceDate);
        const defaultEndDate = reminder.date && reminder.endDate
            ? addDaysToDate(date, getDaysDifference(reminder.date, reminder.endDate))
            : undefined;
        const endDate = getInstanceField(state, 'endDate', defaultEndDate);
        const reminderTimes = getInstanceField(state, 'reminderTimes', reminder.reminderTimes);
        // 保留实例 ID，让番茄钟等历史记录仍能关联到这条已完成任务。
        const id = `${reminder.id}_${instanceDate}`;
        completedReminders[id] = detachCompletedReminder({
            ...reminder,
            ...Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)),
            id,
            date,
            endDate,
            reminderTimes: state.preservedFromSeriesEdit ? reminderTimes : resolveRepeatReminderTimes(
                reminderTimes, date, endDate, reminder.date, reminder.endDate
            ),
            completed: true,
            completedTime: getRepeatInstanceCompletedTime(reminder, instanceDate),
        });
    }
    return completedReminders;
}

/** 保留本次删除范围内的完成记录，并将子任务关联到保留的父实例。 */
export function createCompletedRemindersForDeletion(
    reminderData: Record<string, any>,
    taskIds: Set<string>,
    options: RepeatDeletionOptions = {},
): Record<string, any> {
    const retained: Record<string, any> = {};
    for (const id of taskIds) {
        const reminder = reminderData[id];
        if (!reminder || reminder.deleted || reminder.date === null) continue;
        const isInstance = reminder.isRepeatInstance || reminder.isRepeatedInstance || reminder.isRepeated;
        const hasInstanceStates = Object.keys(reminder.repeat?.instances || {}).length > 0;
        if (!isInstance && (reminder.repeat?.enabled || hasInstanceStates)) {
            Object.assign(retained, createCompletedInstanceReminders(reminder, options));
        } else if (reminder.completed) {
            retained[id] = detachCompletedReminder(reminder);
        }
    }

    for (const reminder of Object.values(retained)) {
        const parentId = reminder.parentId;
        if (!parentId || retained[parentId]) continue;
        const instanceDate = parseReminderInstanceId(reminder.id)?.instanceDate;
        const parentInstanceId = instanceDate ? `${parentId}_${instanceDate}` : '';
        if (parentInstanceId && (retained[parentInstanceId] || (!taskIds.has(parentId) && reminderData[parentId]?.repeat?.enabled))) {
            reminder.parentId = parentInstanceId;
        } else if (taskIds.has(parentId)) {
            // 父实例未保留时，已完成子任务独立显示，避免引用已删除的父任务。
            reminder.parentId = null;
        }
    }
    return retained;
}
