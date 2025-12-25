/*
 * Copyright (c) 2024 by [author]. All Rights Reserved.
 * @Author       : [author]
 * @Date         : [date]
 * @FilePath     : /src/utils/icsImport.ts
 * @LastEditTime : [date]
 * @Description  : ICS import utilities using ical.js
 */

import ICAL from 'ical.js';
import { pushErrMsg, pushMsg } from '../api';

export interface IcsImportOptions {
    project?: string;
    projectId?: string;
    tags?: string[];
    categoryId?: string;
    priority?: 'high' | 'medium' | 'low' | 'none';
}

export interface ParsedIcsEvent {
    uid: string;
    title: string;
    description?: string;
    date?: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    completed?: boolean;
    repeat?: any;
    createdAt?: string;
    subscriptionId?: string; // ID of the subscription this event belongs to
    isSubscribed?: boolean; // Whether this event is from a subscription (read-only)
}

/**
 * 解析ICS文件内容（使用 ical.js）
 */
export async function parseIcsFile(icsContent: string): Promise<ParsedIcsEvent[]> {
    try {
        const events: ParsedIcsEvent[] = [];

        // 使用 ical.js 解析
        const jcalData = ICAL.parse(icsContent);
        const comp = new ICAL.Component(jcalData);

        // 获取所有 VEVENT 组件
        const vevents = comp.getAllSubcomponents('vevent');

        for (const vevent of vevents) {
            const event = parseIcalEvent(vevent);
            if (event) {
                events.push(event);
            }
        }

        return events;
    } catch (error) {
        console.error('解析ICS文件失败:', error);
        throw new Error('解析ICS文件失败: ' + (error.message || error));
    }
}

/**
 * 解析单个事件（使用 ical.js 的 Component）
 */
function parseIcalEvent(vevent: ICAL.Component): ParsedIcsEvent | null {
    try {
        // 获取事件属性
        const event = new ICAL.Event(vevent);

        // 必须有 summary (标题)
        if (!event.summary) {
            return null;
        }

        const parsedEvent: ParsedIcsEvent = {
            uid: event.uid || '',
            title: event.summary,
        };

        // 描述
        if (event.description) {
            parsedEvent.description = event.description;
        }

        // 开始时间
        if (event.startDate) {
            const startDate = event.startDate.toJSDate();
            const dateStr = formatDate(startDate);

            // 检查是否是全天事件
            if (event.startDate.isDate) {
                parsedEvent.date = dateStr;
            } else {
                parsedEvent.date = dateStr;
                parsedEvent.time = formatTime(startDate);
            }
        }

        // 结束时间
        if (event.endDate) {
            const endDate = event.endDate.toJSDate();
            const endDateStr = formatDate(endDate);

            if (event.endDate.isDate) {
                // ICS all-day event endDate is exclusive (e.g., 2026-01-01 to 2026-01-02 is a 1-day event).
                // We convert it to inclusive (e.g., 2026-01-01 to 2026-01-01) for our task system.
                const inclusiveDate = new Date(endDate.getTime());
                inclusiveDate.setDate(inclusiveDate.getDate() - 1);
                parsedEvent.endDate = formatDate(inclusiveDate);
            } else {
                parsedEvent.endDate = endDateStr;
                parsedEvent.endTime = formatTime(endDate);
            }
        }

        // 状态
        const status = vevent.getFirstPropertyValue('status');
        if (status) {
            parsedEvent.completed = status === 'COMPLETED';
        }

        // 创建时间
        const created = vevent.getFirstPropertyValue('created');
        if (created && typeof created !== 'string' && 'toJSDate' in created) {
            parsedEvent.createdAt = (created as ICAL.Time).toJSDate().toISOString();
        }

        // 重复规则 (RRULE)
        if (event.isRecurring()) {
            const rrule = vevent.getFirstPropertyValue('rrule');
            if (rrule && typeof rrule !== 'string' && 'freq' in rrule) {
                parsedEvent.repeat = parseIcalRRule(rrule as ICAL.Recur);
            }
        }

        return parsedEvent;
    } catch (error) {
        console.error('解析事件失败:', error);
        return null;
    }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 格式化时间为 HH:MM
 */
export function formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Check if an event is in the past
 */
export function isEventPast(event: any): boolean {
    const now = new Date();
    const today = formatDate(now);
    const currentTime = formatTime(now);

    if (!event.date) return false;

    // Use endDate if available, otherwise use date
    // For timed events, also check endTime/time
    const endD = event.endDate || event.date;
    const endT = event.endTime || event.time;

    if (endT) {
        // Timed event
        if (endD < today) return true;
        if (endD > today) return false;
        // Same day, compare time
        return endT <= currentTime;
    } else {
        // All-day event
        if (event.endDate) {
            // endDate is now inclusive in our data
            // It is past only if today is strictly after the inclusive end date
            return event.endDate < today;
        } else {
            // If only start date is provided, it's past if today is after that date
            return event.date < today;
        }
    }
}



/**
 * 解析RRULE对象（使用 ical.js）
 */
function parseIcalRRule(rrule: ICAL.Recur): any {
    try {
        const repeat: any = {
            enabled: true,
        };

        // 频率 - 先设置默认类型
        if (rrule.freq) {
            const freqMap: { [key: string]: string } = {
                'DAILY': 'daily',
                'WEEKLY': 'weekly',
                'MONTHLY': 'monthly',
                'YEARLY': 'yearly',
            };
            repeat.type = freqMap[rrule.freq] || 'daily';
        }

        // 间隔
        if (rrule.interval) {
            repeat.interval = rrule.interval;
        }

        // 结束条件
        if (rrule.count) {
            repeat.endType = 'count';
            repeat.endCount = rrule.count;
        } else if (rrule.until) {
            repeat.endType = 'date';
            repeat.endDate = formatDate(rrule.until.toJSDate());
        } else {
            repeat.endType = 'never';
        }

        // 星期几 (BYDAY)
        if (rrule.parts && rrule.parts.BYDAY && rrule.parts.BYDAY.length > 0) {
            const dayMap: { [key: string]: number } = {
                'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
            };

            repeat.weekDays = rrule.parts.BYDAY.map(day => {
                // BYDAY 可能包含数字前缀（如 1MO），我们只需要后两个字符
                const dayStr = typeof day === 'string' ? day.slice(-2) : day;
                return dayMap[dayStr];
            }).filter(d => d !== undefined);

            // 如果有多个星期几，使用 custom 类型
            if (repeat.weekDays.length > 1) {
                repeat.type = 'custom';
            }
        }

        // 每月的日期 (BYMONTHDAY)
        if (rrule.parts && rrule.parts.BYMONTHDAY) {
            repeat.monthDays = Array.isArray(rrule.parts.BYMONTHDAY)
                ? rrule.parts.BYMONTHDAY
                : [rrule.parts.BYMONTHDAY];
        }

        // 月份 (BYMONTH)
        if (rrule.parts && rrule.parts.BYMONTH) {
            repeat.months = Array.isArray(rrule.parts.BYMONTH)
                ? rrule.parts.BYMONTH
                : [rrule.parts.BYMONTH];
        }

        return repeat;
    } catch (error) {
        console.error('解析RRULE失败:', error);
        return null;
    }
}

/**
 * 合并导入的事件到现有提醒数据
 */
export function mergeImportedEvents(
    existingReminders: any,
    importedEvents: ParsedIcsEvent[],
    options: IcsImportOptions
): any {
    const merged = { ...existingReminders };
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const event of importedEvents) {
        // 生成新的ID（使用时间戳+随机数）
        const id = window.Lute?.NewNodeID?.() || `imported-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // 检查是否已存在相同UID的事件
        const existingId = Object.keys(merged).find(key => {
            const reminder = merged[key];
            return reminder.uid === event.uid || reminder.title === event.title;
        });

        if (existingId) {
            // 更新现有事件
            merged[existingId] = {
                ...merged[existingId],
                ...event,
                // 应用批量设置
                projectId: options.projectId || merged[existingId].projectId,
                categoryId: options.categoryId || merged[existingId].categoryId,
                tags: options.tags || merged[existingId].tags,
                priority: options.priority || merged[existingId].priority,
            };
            updatedCount++;
        } else {
            // 添加新事件
            merged[id] = {
                id,
                ...event,
                // 应用批量设置
                projectId: options.projectId,
                categoryId: options.categoryId,
                tags: options.tags || [],
                priority: options.priority || 'none',
                completed: event.completed || isEventPast(event),
                createdAt: event.createdAt || new Date().toISOString(),
                // Preserve subscription metadata
                subscriptionId: event.subscriptionId,
                isSubscribed: event.isSubscribed,
            };
            addedCount++;
        }
    }

    return {
        merged,
        stats: {
            added: addedCount,
            updated: updatedCount,
            skipped: skippedCount,
            total: importedEvents.length,
        },
    };
}

/**
 * 导入ICS文件
 */
export async function importIcsFile(
    plugin: any,
    icsContent: string,
    options: IcsImportOptions
): Promise<{ added: number; updated: number; total: number }> {
    try {
        // 1. 解析ICS文件
        const events = await parseIcsFile(icsContent);

        if (events.length === 0) {
            await pushErrMsg('ICS文件中没有找到有效的事件');
            return { added: 0, updated: 0, total: 0 };
        }

        // 2. 加载现有提醒数据
        const existingReminders = (await plugin.loadData('reminder.json')) || {};

        // 3. 合并导入的事件
        const { merged, stats } = mergeImportedEvents(existingReminders, events, options);

        // 4. 保存合并后的数据
        await plugin.saveData('reminder.json', merged);

        // 5. 触发更新事件
        window.dispatchEvent(new CustomEvent('reminderUpdated'));

        await pushMsg(`ICS导入成功：新增 ${stats.added} 个，更新 ${stats.updated} 个，共 ${stats.total} 个事件`);

        return {
            added: stats.added,
            updated: stats.updated,
            total: stats.total,
        };
    } catch (error) {
        console.error('导入ICS文件失败:', error);
        await pushErrMsg('导入ICS文件失败: ' + (error.message || error));
        throw error;
    }
}
