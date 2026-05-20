export const START_DATE_ONLY_OVERDUE_SETTING_KEY = 'treatStartDateOnlyAsOverdue';
export const START_DATE_ONLY_OVERDUE_TASK_KEY = 'treatStartDateAsDeadline';

export function getGlobalStartDateOnlyOverdue(settings?: any): boolean {
    return settings?.[START_DATE_ONLY_OVERDUE_SETTING_KEY] !== false;
}

export function shouldTreatStartDateOnlyAsOverdue(reminder: any, settings?: any): boolean {
    if (!reminder?.date || reminder?.endDate) return false;

    const taskValue = reminder?.[START_DATE_ONLY_OVERDUE_TASK_KEY];
    if (typeof taskValue === 'boolean') {
        return taskValue;
    }

    return getGlobalStartDateOnlyOverdue(settings);
}

export function isOpenEndedStartDateTask(reminder: any, settings?: any): boolean {
    return !!(reminder?.date && !reminder?.endDate && !shouldTreatStartDateOnlyAsOverdue(reminder, settings));
}

export function getStartDateOnlyOverdueOverrideValue(value: boolean, settings?: any): boolean | undefined {
    return value === getGlobalStartDateOnlyOverdue(settings) ? undefined : value;
}
