/** 内核与前端之间的提醒协议，不依赖 DOM 或内核 API。 */
export const REMINDER_DUE_METHOD = 'reminder-due';
export const REMINDER_DAY_METHOD = 'reminder-day-changed';

export interface ReminderDueEvent {
    key: string;
    frontendKey: string;
    title: string;
    message: string;
    event: 'time-reminder' | 'habit-reminder' | 'daily-reminders';
    reminderInfo?: any;
    reminders?: any[];
    logicalDate: string;
    createdAt: number;
}

export interface ReminderEventSnapshot {
    logicalDate: string;
    events: ReminderDueEvent[];
}
