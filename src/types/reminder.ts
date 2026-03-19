export interface ReminderTime {
    time: string;
    note?: string;
}

export interface ReminderItem {
    id: string;          // 块 ID
    title: string;       // 笔记标题
    date: string;        // 提醒日期 YYYY-MM-DD
    time?: string;       // 提醒时间 HH:MM，可选
    reminderTimes?: (string | ReminderTime)[]; // 多个提醒时间 HH:MM 或 {time, note}
    notifiedTimes?: { [time: string]: boolean }; // 记录每个时间的提醒状态
    note?: string;       // 新增备注字段
    completed: boolean;  // 是否已完成
    createdAt: string;   // 创建时间
    notified?: boolean;
    kanbanStatus?: string;  // 任务类型：长期、短期或进行中
    url?: string;        // 网页链接，可选
}

export interface ReminderData {
    [blockId: string]: ReminderItem;
}

export type ViewMode = 'today' | 'overdue' | 'upcoming' | 'all';

export interface BatchReminderOptions {
    date: string;
    time?: string;
    blockIds: string[];
}
