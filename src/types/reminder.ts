import type { ReminderSkipWeekendMode } from "../utils/reminderSkipDate";

export interface ReminderTime {
    time: string;
    endTime?: string;
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
    blockId?: string;    // 绑定思源块 ID
    docId?: string;      // 绑定思源文档 ID
    projectId?: string;  // 项目 ID
    priority?: "high" | "medium" | "low" | "none"; // 优先级
    categoryId?: string; // 分类 ID
    endDate?: string;    // 结束日期 YYYY-MM-DD
    endTime?: string;    // 结束时间 HH:MM
    repeat?: any;        // 重复配置
    parentId?: string;   // 父任务 ID
    completedTime?: string; // 完成时间
    sort?: number;       // 排序号
    customProgress?: number; // 自定义进度条百分比 (0-100)
    linkedHabitId?: string; // 绑定习惯 ID
    linkedHabitSyncPomodoroToday?: boolean; // 是否同步番茄钟到习惯
    linkedHabitAutoCheckInOnComplete?: boolean; // 完成任务时是否自动打卡习惯
    linkedHabitAutoCheckInOptionKey?: string; // 自动打卡选项 Key
    linkedHabitAutoCheckInEmoji?: string; // 自动打卡 Emoji
    treatStartDateAsDeadline?: boolean; // 只有开始日期且无截止日期时，是否按过期任务处理
    reminderSkipWeekendMode?: ReminderSkipWeekendMode; // 跳过周末模式；未设置时跟随全局设置
    reminderSkipWeekends?: boolean; // 旧字段：是否跳过周末提醒；未设置时跟随全局设置
    reminderSkipHolidays?: boolean; // 是否跳过节假日提醒；未设置时跟随全局设置
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
