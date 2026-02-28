/*
 * Copyright (c) 2024 by [author]. All Rights Reserved.
 * @Author       : [author]
 * @Date         : [date]
 * @FilePath     : /src/utils/icsUtils.ts
 * @LastEditTime : [date]
 * @Description  : ICS export and upload utilities
 */

import * as ics from 'ics';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { lunarToSolar, solarToLunar } from './lunarUtils';
import { pushErrMsg, pushMsg, putFile, getBlockKramdown, uploadCloud, getFileBlob } from '../api';
import { Constants } from 'siyuan';

const useShell = async (cmd: 'showItemInFolder' | 'openPath', filePath: string) => {
    try {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.send(Constants.SIYUAN_CMD, {
            cmd,
            filePath: filePath,
        });
    } catch (error) {
        await pushErrMsg('当前客户端不支持打开插件数据文件夹');
    }
};

export async function exportIcsFile(
    plugin: any,
    openFolder: boolean = true,
    isSilent: boolean = false,
    filterType: 'all' | 'completed' | 'uncompleted' = 'all'
) {
    try {
        const dataDir = 'data/storage/petal/siyuan-plugin-task-note-management';
        const reminders = await plugin.loadReminderData();

        // 辅助函数：解析日期为 [year, month, day]
        function parseDateArray(dateStr: string): [number, number, number] | null {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const parts = dateStr.split('-').map(n => parseInt(n, 10));
            if (parts.length !== 3 || parts.some(isNaN)) return null;
            return [parts[0], parts[1], parts[2]];
        }

        // 辅助函数：解析时间为 [hour, minute]
        function parseTimeArray(timeStr: string): [number, number] | null {
            if (!timeStr || typeof timeStr !== 'string') return null;
            const parts = timeStr.split(':').map(n => parseInt(n, 10));
            if (parts.length < 2 || parts.some(isNaN)) return null;
            return [parts[0], parts[1]];
        }

        const events: any[] = [];

        function buildRRuleFromRepeat(repeat: any, startDateStr: string) {
            if (!repeat || !repeat.enabled) return null;
            const parts: string[] = [];
            const type = repeat.type || 'daily';
            switch (type) {
                case 'daily':
                    parts.push('FREQ=DAILY');
                    break;
                case 'weekly':
                    parts.push('FREQ=WEEKLY');
                    if (Array.isArray(repeat.weekDays) && repeat.weekDays.length) {
                        const map = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
                        const byday = repeat.weekDays
                            .map((d: number) => map[d])
                            .filter(Boolean)
                            .join(',');
                        if (byday) parts.push(`BYDAY=${byday}`);
                    }
                    break;
                case 'monthly':
                    parts.push('FREQ=MONTHLY');
                    if (Array.isArray(repeat.monthDays) && repeat.monthDays.length) {
                        parts.push(`BYMONTHDAY=${repeat.monthDays.join(',')}`);
                    }
                    break;
                case 'yearly':
                    parts.push('FREQ=YEARLY');
                    if (Array.isArray(repeat.months) && repeat.months.length) {
                        parts.push(`BYMONTH=${repeat.months.join(',')}`);
                    }
                    if (Array.isArray(repeat.monthDays) && repeat.monthDays.length) {
                        parts.push(`BYMONTHDAY=${repeat.monthDays.join(',')}`);
                    }
                    break;
                case 'custom':
                    parts.push('FREQ=DAILY');
                    if (Array.isArray(repeat.weekDays) && repeat.weekDays.length) {
                        const map = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
                        const byday = repeat.weekDays
                            .map((d: number) => map[d])
                            .filter(Boolean)
                            .join(',');
                        if (byday) parts.push(`BYDAY=${byday}`);
                    }
                    if (Array.isArray(repeat.monthDays) && repeat.monthDays.length) {
                        parts.push(`BYMONTHDAY=${repeat.monthDays.join(',')}`);
                    }
                    if (Array.isArray(repeat.months) && repeat.months.length) {
                        parts.push(`BYMONTH=${repeat.months.join(',')}`);
                    }
                    break;
                default:
                    parts.push('FREQ=DAILY');
            }

            if (repeat.interval && repeat.interval > 1) {
                parts.push(`INTERVAL=${repeat.interval}`);
            }

            if (repeat.endType === 'count' && repeat.endCount) {
                parts.push(`COUNT=${repeat.endCount}`);
            } else if (repeat.endType === 'date' && repeat.endDate) {
                try {
                    const dt = new Date(repeat.endDate + 'T23:59:59');
                    const until = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}T${String(dt.getUTCHours()).padStart(2, '0')}${String(dt.getUTCMinutes()).padStart(2, '0')}${String(dt.getUTCSeconds()).padStart(2, '0')}Z`;
                    parts.push(`UNTIL=${until}`);
                } catch (e) {
                    console.warn('构建 UNTIL 失败', e);
                }
            }

            return parts.join(';');
        }

        const reminderMap: { [id: string]: any } = reminders;
        const rootIds = Object.keys(reminderMap).filter(i => !reminderMap[i].parentId);

        for (const id of rootIds) {
            const r = reminderMap[id];
            if (!r.date) continue;

            const title = r.title || '无标题';
            let description = r.note || '';

            try {
                const children = Object.keys(reminderMap)
                    .map(k => reminderMap[k])
                    .filter((item: any) => item.parentId === id);
                for (const child of children) {
                    try {
                        const childTitle = child.title || '无标题子任务';
                        const childNote = child.note || '';
                        const childHasTime = !!(child.time || child.date);

                        if (childHasTime) {
                            let childStartDateArray = parseDateArray(child.date || r.date);
                            if (!childStartDateArray) continue;

                            // 如果子任务也有重复设置，调整起始日期
                            if (child.repeat && child.repeat.enabled) {
                                const originalDate = new Date(childStartDateArray[0], childStartDateArray[1] - 1, childStartDateArray[2]);

                                if (child.repeat.type === 'weekly' && Array.isArray(child.repeat.weekDays) && child.repeat.weekDays.length > 0) {
                                    const originalDay = originalDate.getDay();

                                    if (!child.repeat.weekDays.includes(originalDay)) {
                                        let adjustedDate = new Date(originalDate);

                                        for (let i = 1; i <= 7; i++) {
                                            adjustedDate.setDate(originalDate.getDate() + i);
                                            if (child.repeat.weekDays.includes(adjustedDate.getDay())) {
                                                childStartDateArray = [
                                                    adjustedDate.getFullYear(),
                                                    adjustedDate.getMonth() + 1,
                                                    adjustedDate.getDate()
                                                ];
                                                break;
                                            }
                                        }
                                    }
                                } else if (child.repeat.type === 'monthly' && Array.isArray(child.repeat.monthDays) && child.repeat.monthDays.length > 0) {
                                    const originalDay = originalDate.getDate();

                                    if (!child.repeat.monthDays.includes(originalDay)) {
                                        const sortedDays = [...child.repeat.monthDays].sort((a, b) => a - b);
                                        const laterDays = sortedDays.filter(d => d > originalDay);

                                        if (laterDays.length > 0) {
                                            const adjustedDate = new Date(originalDate);
                                            adjustedDate.setDate(laterDays[0]);
                                            childStartDateArray = [
                                                adjustedDate.getFullYear(),
                                                adjustedDate.getMonth() + 1,
                                                adjustedDate.getDate()
                                            ];
                                        } else {
                                            const adjustedDate = new Date(originalDate);
                                            adjustedDate.setMonth(originalDate.getMonth() + 1);
                                            adjustedDate.setDate(sortedDays[0]);
                                            childStartDateArray = [
                                                adjustedDate.getFullYear(),
                                                adjustedDate.getMonth() + 1,
                                                adjustedDate.getDate()
                                            ];
                                        }
                                    }
                                } else if (child.repeat.type === 'yearly' && Array.isArray(child.repeat.months) && child.repeat.months.length > 0 &&
                                    Array.isArray(child.repeat.monthDays) && child.repeat.monthDays.length > 0) {
                                    const originalMonth = originalDate.getMonth() + 1;
                                    const originalDay = originalDate.getDate();

                                    const matchesMonth = child.repeat.months.includes(originalMonth);
                                    const matchesDay = child.repeat.monthDays.includes(originalDay);

                                    if (!matchesMonth || !matchesDay) {
                                        const sortedMonths = [...child.repeat.months].sort((a, b) => a - b);
                                        const sortedDays = [...child.repeat.monthDays].sort((a, b) => a - b);

                                        let adjustedDate = new Date(originalDate);
                                        let found = false;

                                        if (matchesMonth) {
                                            const laterDays = sortedDays.filter(d => d > originalDay);
                                            if (laterDays.length > 0) {
                                                adjustedDate.setDate(laterDays[0]);
                                                found = true;
                                            }
                                        }

                                        if (!found) {
                                            const laterMonths = sortedMonths.filter(m => m > originalMonth);
                                            if (laterMonths.length > 0) {
                                                adjustedDate.setMonth(laterMonths[0] - 1);
                                                adjustedDate.setDate(sortedDays[0]);
                                                found = true;
                                            } else {
                                                adjustedDate.setFullYear(originalDate.getFullYear() + 1);
                                                adjustedDate.setMonth(sortedMonths[0] - 1);
                                                adjustedDate.setDate(sortedDays[0]);
                                                found = true;
                                            }
                                        }

                                        if (found) {
                                            childStartDateArray = [
                                                adjustedDate.getFullYear(),
                                                adjustedDate.getMonth() + 1,
                                                adjustedDate.getDate()
                                            ];
                                        }
                                    }
                                }
                            }
                            const childStartTimeArray = child.time
                                ? parseTimeArray(child.time)
                                : null;
                            const childEndDateArray = child.endDate
                                ? parseDateArray(child.endDate)
                                : childStartDateArray;
                            const childEndTimeArray = child.endTime
                                ? parseTimeArray(child.endTime)
                                : null;

                            const childEvent: any = {
                                uid: `${child.id || ''}-${child.date || ''}${child.time ? '-' + child.time.replace(/:/g, '') : ''}@siyuan`,
                                title: childTitle,
                                description: childNote,
                                status: child.completed ? 'CONFIRMED' : 'TENTATIVE', // 不能用CONFIRM，否则outlook会把全天高亮
                            };

                            let childMatches = true;
                            if (filterType === 'completed' && !child.completed) childMatches = false;
                            if (filterType === 'uncompleted' && child.completed) childMatches = false;

                            if (!childMatches) continue;

                            if (childStartTimeArray) {
                                childEvent.start = [
                                    ...childStartDateArray,
                                    ...childStartTimeArray,
                                ];
                                if (childEndTimeArray && childEndDateArray) {
                                    childEvent.end = [
                                        ...childEndDateArray,
                                        ...childEndTimeArray,
                                    ];
                                } else {
                                    const startDt = new Date(
                                        childStartDateArray[0],
                                        childStartDateArray[1] - 1,
                                        childStartDateArray[2],
                                        childStartTimeArray[0],
                                        childStartTimeArray[1]
                                    );
                                    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
                                    childEvent.end = [
                                        endDt.getFullYear(),
                                        endDt.getMonth() + 1,
                                        endDt.getDate(),
                                        endDt.getHours(),
                                        endDt.getMinutes(),
                                    ];
                                }
                            } else {
                                childEvent.start = childStartDateArray;
                                const nextDay = new Date(
                                    childStartDateArray[0],
                                    childStartDateArray[1] - 1,
                                    childStartDateArray[2]
                                );
                                nextDay.setDate(nextDay.getDate() + 1);
                                childEvent.end = [
                                    nextDay.getFullYear(),
                                    nextDay.getMonth() + 1,
                                    nextDay.getDate(),
                                ];
                            }

                            if (child.createdAt) {
                                const created = new Date(child.createdAt);
                                childEvent.created = [
                                    created.getUTCFullYear(),
                                    created.getUTCMonth() + 1,
                                    created.getUTCDate(),
                                    created.getUTCHours(),
                                    created.getUTCMinutes(),
                                    created.getUTCSeconds(),
                                ];
                            }

                            if (!child.completed && childStartTimeArray) {
                                childEvent.alarms = [
                                    {
                                        action: 'display',
                                        description: childTitle,
                                        trigger: { before: true, minutes: 15 },
                                    },
                                ];
                            }

                            if (child.repeat && child.repeat.enabled) {
                                try {
                                    const childRrule = buildRRuleFromRepeat(
                                        child.repeat,
                                        child.date || r.date
                                    );
                                    if (childRrule) {
                                        childEvent.recurrenceRule = childRrule;
                                    }
                                } catch (e) {
                                    console.warn('构建子任务 RRULE 失败', e, child);
                                }
                            }

                            events.push(childEvent);
                        } else {
                            const prefix = '\n- ';
                            description += `${prefix}${childTitle}${childNote ? '：' + childNote : ''}`;
                        }
                    } catch (ce) {
                        console.error('处理子任务失败:', ce, child);
                    }
                }
            } catch (e) {
                console.warn('处理子任务出错', e);
            }

            // Check parent filter
            let parentMatches = true;
            if (filterType === 'completed' && !r.completed) parentMatches = false;
            if (filterType === 'uncompleted' && r.completed) parentMatches = false;

            if (!parentMatches) continue;

            let startDateArray = parseDateArray(r.date);
            if (!startDateArray) continue;

            // 如果是重复任务，调整起始日期为第一个符合条件的日期
            if (r.repeat && r.repeat.enabled) {
                const originalDate = new Date(startDateArray[0], startDateArray[1] - 1, startDateArray[2]);

                if (r.repeat.type === 'weekly' && Array.isArray(r.repeat.weekDays) && r.repeat.weekDays.length > 0) {
                    const originalDay = originalDate.getDay();

                    // 如果起始日期的星期不在weekDays列表中，找到下一个符合条件的日期
                    if (!r.repeat.weekDays.includes(originalDay)) {
                        let adjustedDate = new Date(originalDate);

                        // 最多向后查找7天
                        for (let i = 1; i <= 7; i++) {
                            adjustedDate.setDate(originalDate.getDate() + i);
                            if (r.repeat.weekDays.includes(adjustedDate.getDay())) {
                                startDateArray = [
                                    adjustedDate.getFullYear(),
                                    adjustedDate.getMonth() + 1,
                                    adjustedDate.getDate()
                                ];
                                break;
                            }
                        }
                    }
                } else if (r.repeat.type === 'monthly' && Array.isArray(r.repeat.monthDays) && r.repeat.monthDays.length > 0) {
                    const originalDay = originalDate.getDate();

                    // 如果起始日期不在monthDays列表中，找到下一个符合条件的日期
                    if (!r.repeat.monthDays.includes(originalDay)) {
                        // 在当月查找
                        const sortedDays = [...r.repeat.monthDays].sort((a, b) => a - b);
                        const laterDays = sortedDays.filter(d => d > originalDay);

                        if (laterDays.length > 0) {
                            // 使用当月的下一个日期
                            const adjustedDate = new Date(originalDate);
                            adjustedDate.setDate(laterDays[0]);
                            startDateArray = [
                                adjustedDate.getFullYear(),
                                adjustedDate.getMonth() + 1,
                                adjustedDate.getDate()
                            ];
                        } else {
                            // 使用下个月的第一个日期
                            const adjustedDate = new Date(originalDate);
                            adjustedDate.setMonth(originalDate.getMonth() + 1);
                            adjustedDate.setDate(sortedDays[0]);
                            startDateArray = [
                                adjustedDate.getFullYear(),
                                adjustedDate.getMonth() + 1,
                                adjustedDate.getDate()
                            ];
                        }
                    }
                } else if (r.repeat.type === 'yearly' && Array.isArray(r.repeat.months) && r.repeat.months.length > 0 &&
                    Array.isArray(r.repeat.monthDays) && r.repeat.monthDays.length > 0) {
                    const originalMonth = originalDate.getMonth() + 1;
                    const originalDay = originalDate.getDate();

                    // 检查当前日期是否匹配
                    const matchesMonth = r.repeat.months.includes(originalMonth);
                    const matchesDay = r.repeat.monthDays.includes(originalDay);

                    if (!matchesMonth || !matchesDay) {
                        // 需要找到下一个符合条件的日期
                        const sortedMonths = [...r.repeat.months].sort((a, b) => a - b);
                        const sortedDays = [...r.repeat.monthDays].sort((a, b) => a - b);

                        let adjustedDate = new Date(originalDate);
                        let found = false;

                        // 如果当前月份在列表中，但日期不对，尝试当月的后续日期
                        if (matchesMonth) {
                            const laterDays = sortedDays.filter(d => d > originalDay);
                            if (laterDays.length > 0) {
                                adjustedDate.setDate(laterDays[0]);
                                found = true;
                            }
                        }

                        // 如果当月没找到，查找后续月份
                        if (!found) {
                            const laterMonths = sortedMonths.filter(m => m > originalMonth);
                            if (laterMonths.length > 0) {
                                // 使用今年的下一个月份
                                adjustedDate.setMonth(laterMonths[0] - 1);
                                adjustedDate.setDate(sortedDays[0]);
                                found = true;
                            } else {
                                // 使用明年的第一个月份
                                adjustedDate.setFullYear(originalDate.getFullYear() + 1);
                                adjustedDate.setMonth(sortedMonths[0] - 1);
                                adjustedDate.setDate(sortedDays[0]);
                                found = true;
                            }
                        }

                        if (found) {
                            startDateArray = [
                                adjustedDate.getFullYear(),
                                adjustedDate.getMonth() + 1,
                                adjustedDate.getDate()
                            ];
                        }
                    }
                }
            }

            const startTimeArray = r.time ? parseTimeArray(r.time) : null;
            const endDateArray = r.endDate ? parseDateArray(r.endDate) : startDateArray;
            const endTimeArray = r.endTime ? parseTimeArray(r.endTime) : null;

            const event: any = {
                uid: `${id}-${r.date}${r.time ? '-' + r.time.replace(/:/g, '') : ''}@siyuan`,
                title: title,
                description: description,
                status: r.completed ? 'CONFIRMED' : 'TENTATIVE',
            };

            if (startTimeArray) {
                event.start = [...startDateArray, ...startTimeArray];
                if (endTimeArray && endDateArray) {
                    event.end = [...endDateArray, ...endTimeArray];
                } else {
                    const startDt = new Date(
                        startDateArray[0],
                        startDateArray[1] - 1,
                        startDateArray[2],
                        startTimeArray[0],
                        startTimeArray[1]
                    );
                    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
                    event.end = [
                        endDt.getFullYear(),
                        endDt.getMonth() + 1,
                        endDt.getDate(),
                        endDt.getHours(),
                        endDt.getMinutes(),
                    ];
                }
            } else {
                event.start = startDateArray;
                if (
                    endDateArray &&
                    (endDateArray[0] !== startDateArray[0] ||
                        endDateArray[1] !== startDateArray[1] ||
                        endDateArray[2] !== startDateArray[2])
                ) {
                    const endDate = new Date(
                        endDateArray[0],
                        endDateArray[1] - 1,
                        endDateArray[2]
                    );
                    endDate.setDate(endDate.getDate() + 1);
                    event.end = [
                        endDate.getFullYear(),
                        endDate.getMonth() + 1,
                        endDate.getDate(),
                    ];
                } else {
                    const nextDay = new Date(
                        startDateArray[0],
                        startDateArray[1] - 1,
                        startDateArray[2]
                    );
                    nextDay.setDate(nextDay.getDate() + 1);
                    event.end = [
                        nextDay.getFullYear(),
                        nextDay.getMonth() + 1,
                        nextDay.getDate(),
                    ];
                }
            }

            if (r.createdAt) {
                const created = new Date(r.createdAt);
                event.created = [
                    created.getUTCFullYear(),
                    created.getUTCMonth() + 1,
                    created.getUTCDate(),
                    created.getUTCHours(),
                    created.getUTCMinutes(),
                    created.getUTCSeconds(),
                ];
            }

            if (!r.completed && startTimeArray) {
                event.alarms = [
                    {
                        action: 'display',
                        description: title,
                        trigger: { before: true, minutes: 15 },
                    },
                ];
            }

            if (r.repeat && r.repeat.enabled) {
                // 特殊处理：农历年事件，生成今年和明年两个普通事件
                if (r.repeat.type === 'lunar-yearly') {
                    try {
                        const lunarMonth = r.repeat.lunarMonth;
                        const lunarDay = r.repeat.lunarDay;
                        const isLeap = !!r.repeat.isLeapMonth;
                        const nowYear = new Date().getFullYear();
                        for (let offset = 0; offset < 2; offset++) {
                            const y = nowYear + offset;
                            const solar = lunarToSolar(y, lunarMonth, lunarDay, isLeap);
                            if (!solar) continue;
                            const occDateArr = parseDateArray(solar);
                            if (!occDateArr) continue;

                            const occEvent: any = {
                                uid: `${id}-${solar}@siyuan`,
                                title: title,
                                description: description,
                                status: r.completed ? 'CONFIRMED' : 'TENTATIVE',
                            };

                            if (startTimeArray) {
                                occEvent.start = [...occDateArr, ...startTimeArray];
                                if (endTimeArray) {
                                    occEvent.end = [
                                        ...parseDateArray(r.endDate || solar)!,
                                        ...endTimeArray,
                                    ];
                                } else {
                                    const startDt = new Date(
                                        occDateArr[0],
                                        occDateArr[1] - 1,
                                        occDateArr[2],
                                        startTimeArray[0],
                                        startTimeArray[1]
                                    );
                                    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
                                    occEvent.end = [
                                        endDt.getFullYear(),
                                        endDt.getMonth() + 1,
                                        endDt.getDate(),
                                        endDt.getHours(),
                                        endDt.getMinutes(),
                                    ];
                                }
                            } else {
                                occEvent.start = occDateArr;
                                const nextDay = new Date(
                                    occDateArr[0],
                                    occDateArr[1] - 1,
                                    occDateArr[2]
                                );
                                nextDay.setDate(nextDay.getDate() + 1);
                                occEvent.end = [
                                    nextDay.getFullYear(),
                                    nextDay.getMonth() + 1,
                                    nextDay.getDate(),
                                ];
                            }

                            if (r.createdAt) {
                                const created = new Date(r.createdAt);
                                occEvent.created = [
                                    created.getUTCFullYear(),
                                    created.getUTCMonth() + 1,
                                    created.getUTCDate(),
                                    created.getUTCHours(),
                                    created.getUTCMinutes(),
                                    created.getUTCSeconds(),
                                ];
                            }

                            if (!r.completed && startTimeArray) {
                                occEvent.alarms = [
                                    {
                                        action: 'display',
                                        description: title,
                                        trigger: { before: true, minutes: 15 },
                                    },
                                ];
                            }

                            events.push(occEvent);
                        }
                        // 已经为 lunar-yearly 展开为独立事件，跳过后续的 RRULE 处理与基础事件
                        continue;
                    } catch (e) {
                        console.warn('处理农历重复事件失败', e, r);
                    }
                }

                // 农历每月:在当前年和下一年范围内遍历每天,匹配农历日并生成独立事件
                if (r.repeat.type === 'lunar-monthly') {
                    try {
                        const lunarDay = r.repeat.lunarDay;
                        if (!lunarDay) {
                            console.warn('lunar-monthly 缺少 lunarDay', r);
                        } else {
                            const nowYear = new Date().getFullYear();
                            const startDate = new Date(nowYear, 0, 1);
                            const endDate = new Date(nowYear + 1, 11, 31);
                            for (
                                let d = new Date(startDate);
                                d <= endDate;
                                d.setDate(d.getDate() + 1)
                            ) {
                                const year = d.getFullYear();
                                const month = (d.getMonth() + 1).toString().padStart(2, '0');
                                const day = d.getDate().toString().padStart(2, '0');
                                const solarStr = `${year}-${month}-${day}`;
                                try {
                                    const lunar = solarToLunar(solarStr);
                                    if (lunar && lunar.day === lunarDay) {
                                        const occDateArr = parseDateArray(solarStr);
                                        if (!occDateArr) continue;
                                        const occEvent: any = {
                                            uid: `${id}-${solarStr}@siyuan`,
                                            title: title,
                                            description: description,
                                            status: r.completed ? 'CONFIRMED' : 'TENTATIVE',
                                        };

                                        if (startTimeArray) {
                                            occEvent.start = [...occDateArr, ...startTimeArray];
                                            if (endTimeArray) {
                                                occEvent.end = [
                                                    ...parseDateArray(r.endDate || solarStr)!,
                                                    ...endTimeArray,
                                                ];
                                            } else {
                                                const startDt = new Date(
                                                    occDateArr[0],
                                                    occDateArr[1] - 1,
                                                    occDateArr[2],
                                                    startTimeArray[0],
                                                    startTimeArray[1]
                                                );
                                                const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
                                                occEvent.end = [
                                                    endDt.getFullYear(),
                                                    endDt.getMonth() + 1,
                                                    endDt.getDate(),
                                                    endDt.getHours(),
                                                    endDt.getMinutes(),
                                                ];
                                            }
                                        } else {
                                            occEvent.start = occDateArr;
                                            const nextDay = new Date(
                                                occDateArr[0],
                                                occDateArr[1] - 1,
                                                occDateArr[2]
                                            );
                                            nextDay.setDate(nextDay.getDate() + 1);
                                            occEvent.end = [
                                                nextDay.getFullYear(),
                                                nextDay.getMonth() + 1,
                                                nextDay.getDate(),
                                            ];
                                        }

                                        if (r.createdAt) {
                                            const created = new Date(r.createdAt);
                                            occEvent.created = [
                                                created.getUTCFullYear(),
                                                created.getUTCMonth() + 1,
                                                created.getUTCDate(),
                                                created.getUTCHours(),
                                                created.getUTCMinutes(),
                                                created.getUTCSeconds(),
                                            ];
                                        }

                                        if (!r.completed && startTimeArray) {
                                            occEvent.alarms = [
                                                {
                                                    action: 'display',
                                                    description: title,
                                                    trigger: { before: true, minutes: 15 },
                                                },
                                            ];
                                        }

                                        events.push(occEvent);
                                    }
                                } catch (le) {
                                    // ignore conversion errors for specific dates
                                }
                            }
                        }
                        // 已展开为独立事件,跳过后续 RRULE 与基础事件
                        continue;
                    } catch (e) {
                        console.warn('处理农历每月事件失败', e, r);
                    }
                }

                // 处理其他重复类型的 RRULE
                try {
                    const rrule = buildRRuleFromRepeat(r.repeat, r.date);
                    event.recurrenceRule = rrule;
                } catch (e) {
                    console.warn('构建 RRULE 失败', e, r);
                }
            }

            events.push(event);
        }

        const { error, value } = ics.createEvents(events, {
            productId: 'siyuan-plugin-task-note-management',
            method: 'PUBLISH',
            calName: '思源任务笔记管理',
        });

        if (error) {
            console.error('ICS 生成失败:', error);
            await pushErrMsg('ICS 生成失败: ' + error.message);
            return;
        }

        let normalized = value as string;

        const outPath = dataDir + '/reminders.ics';
        await putFile(outPath, false, new Blob([normalized], { type: 'text/calendar' }));
        if (openFolder) {
            await useShell('showItemInFolder', window.siyuan.config.system.workspaceDir + '/' + outPath);
        }
        if (!isSilent) {
            await pushMsg(`ICS 文件已生成: ${outPath} (共 ${events.length} 个事件)`);
        }
    } catch (err) {
        console.error('导出 ICS 失败:', err);
        await pushErrMsg('导出 ICS 失败');
    }
}

export async function uploadIcsToCloud(plugin: any, settings: any, silent: boolean = false) {
    try {
        const syncMethod = settings.icsSyncMethod || 'siyuan';

        // 获取ICS文件名，若未设置则自动生成并持久化到设置
        let icsFileName = settings.icsFileName;
        if (!icsFileName || icsFileName.trim() === '') {
            const genId = (window.Lute && typeof window.Lute.NewNodeID === 'function')
                ? window.Lute.NewNodeID()
                : Date.now().toString(36);
            icsFileName = `reminder-${genId}`;
            settings.icsFileName = icsFileName;
            try {
                await plugin.saveSettings(settings);
                try {
                    window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
                } catch (e) {
                    /* ignore */
                }
            } catch (e) {
                console.warn('保存自动生成的 ICS 文件名失败:', e);
            }
            await pushMsg(`未设置 ICS 文件名，已自动生成: ${icsFileName}.ics`);
        }

        // 确保文件名不包含.ics后缀
        icsFileName = icsFileName.replace(/\.ics$/i, '');
        const fullFileName = `${icsFileName}.ics`;

        // 1. 调用 exportIcsFile 生成 ICS 文件
        const filterType = settings.icsTaskFilter || 'all';
        await exportIcsFile(plugin, false, true, filterType);

        // 2. 读取生成的 reminders.ics 文件
        const dataDir = 'data/storage/petal/siyuan-plugin-task-note-management';
        const icsPath = dataDir + '/reminders.ics';

        const icsBlob = await getFileBlob(icsPath);
        if (!icsBlob) {
            await pushErrMsg('reminders.ics 文件不存在，请先生成 ICS 文件');
            return;
        }

        const icsContent = await icsBlob.text();

        // 根据同步方式选择不同的上传逻辑
        if (syncMethod === 's3') {
            // S3 同步方式
            await uploadToS3(settings, icsContent, fullFileName, plugin, silent);
        } else {
            // 思源服务器同步方式
            await uploadToSiyuan(settings, icsContent, plugin, silent);
        }
    } catch (err) {
        console.error('上传ICS到云端失败:', err);
        await pushErrMsg('上传ICS到云端失败: ' + (err.message || err));
    }
}

/**
 * 上传到S3存储
 */
async function uploadToS3(settings: any, icsContent: string, fileName: string, plugin: any, silent: boolean = false) {
    try {
        // 获取S3配置：如果启用"使用思源S3设置"，则从思源配置读取；否则使用插件配置
        let s3Bucket: string;
        let s3Endpoint: string;
        let s3Region: string;
        let s3AccessKeyId: string;
        let s3AccessKeySecret: string;
        let s3StoragePath: string;
        let s3ForcePathStyle: boolean;
        let s3TlsVerify: boolean;

        if (settings.s3UseSiyuanConfig) {
            // 使用思源的S3配置
            const siyuanS3 = window.siyuan?.config?.sync?.s3;
            if (!siyuanS3) {
                await pushErrMsg('未找到思源的S3配置，请先在思源设置中配置S3同步');
                return;
            }
            s3Bucket = settings.s3Bucket || siyuanS3.bucket || '';
            s3Endpoint = siyuanS3.endpoint || '';
            s3Region = siyuanS3.region || 'auto';
            s3AccessKeyId = siyuanS3.accessKey || '';
            s3AccessKeySecret = siyuanS3.secretKey || '';
            s3StoragePath = settings.s3StoragePath || ''; // 存储路径使用插件配置，可覆盖思源默认
            s3ForcePathStyle = siyuanS3.pathStyle !== false; // 思源的pathStyle
            s3TlsVerify = !siyuanS3.skipTlsVerify; // 思源的skipTlsVerify取反
        } else {
            // 使用插件的S3配置
            s3Bucket = settings.s3Bucket || '';
            s3Endpoint = settings.s3Endpoint || '';
            s3Region = settings.s3Region || 'auto';
            s3AccessKeyId = settings.s3AccessKeyId || '';
            s3AccessKeySecret = settings.s3AccessKeySecret || '';
            s3StoragePath = settings.s3StoragePath || '';
            s3ForcePathStyle = settings.s3ForcePathStyle === true;
            s3TlsVerify = settings.s3TlsVerify !== false;
        }

        // 验证S3配置
        if (!s3Bucket || !s3Endpoint || !s3AccessKeyId || !s3AccessKeySecret) {
            await pushErrMsg('S3配置不完整，请检查Bucket、Endpoint、AccessKeyId和AccessKeySecret');
            return;
        }

        // 处理endpoint，如果没有协议前缀则自动添加https://
        let endpoint = s3Endpoint.trim();
        if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
            endpoint = 'https://' + endpoint;
        }

        // 创建S3客户端配置
        const s3Config: any = {
            region: s3Region || 'auto', // 使用配置的region，默认为auto
            endpoint: endpoint,
            credentials: {
                accessKeyId: s3AccessKeyId,
                secretAccessKey: s3AccessKeySecret,
            },
            forcePathStyle: s3ForcePathStyle, // 使用配置的addressing风格
        };

        // 如果禁用TLS验证，配置requestHandler
        if (s3TlsVerify === false) {
            // 在Node.js环境中禁用TLS验证
            if (typeof require !== 'undefined') {
                try {
                    const https = require('https');
                    const { NodeHttpHandler } = require('@smithy/node-http-handler');
                    s3Config.requestHandler = new NodeHttpHandler({
                        httpsAgent: new https.Agent({
                            rejectUnauthorized: false,
                        }),
                    });
                } catch (e) {
                    console.warn('无法配置TLS验证选项:', e);
                }
            }
        }

        const s3Client = new S3Client(s3Config);

        // 构建S3存储路径
        let storagePath = s3StoragePath || '';
        // 确保路径格式正确
        if (storagePath && !storagePath.endsWith('/')) {
            storagePath += '/';
        }
        if (storagePath && storagePath.startsWith('/')) {
            storagePath = storagePath.substring(1);
        }

        const s3Key = storagePath + fileName;

        // 上传到S3
        const command = new PutObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
            Body: icsContent,
            ContentType: 'text/calendar',
        });

        await s3Client.send(command);

        // 构建云端链接
        let cloudUrl: string;
        if (settings.s3CustomDomain) {
            // 使用自定义域名
            cloudUrl = `https://${settings.s3CustomDomain}/${s3Key}`;
        } else {
            // 使用标准S3 URL
            if (s3ForcePathStyle === true) {
                // Path-style: https://endpoint/bucket/key
                cloudUrl = endpoint;
                if (!cloudUrl.endsWith('/')) {
                    cloudUrl += '/';
                }
                cloudUrl += `${s3Bucket}/${s3Key}`;
            } else {
                // Virtual hosted style: https://bucket.endpoint/key
                // 从endpoint中提取协议和域名
                const urlMatch = endpoint.match(/^(https?:\/\/)(.+)$/);
                if (urlMatch) {
                    const protocol = urlMatch[1];
                    const domain = urlMatch[2].replace(/\/$/, ''); // 移除末尾的斜杠
                    cloudUrl = `${protocol}${s3Bucket}.${domain}/${s3Key}`;
                } else {
                    // 如果无法解析，回退到path-style
                    cloudUrl = endpoint;
                    if (!cloudUrl.endsWith('/')) {
                        cloudUrl += '/';
                    }
                    cloudUrl += `${s3Bucket}/${s3Key}`;
                }
            }
        }

        settings.icsCloudUrl = cloudUrl;
        settings.icsLastSyncAt = new Date().toISOString();

        // 保存设置到文件
        await plugin.saveSettings(settings);

        // 触发设置更新事件，刷新UI
        try {
            window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
        } catch (e) {
            console.warn('触发设置更新事件失败:', e);
        }

        if (!silent) {
            await pushMsg(`ICS文件已上传到S3: ${cloudUrl}`);
        }
        console.log('ICS 文件上传到 S3 成功');
    } catch (err) {
        console.error('上传到S3失败:', err);
        throw new Error('上传到S3失败: ' + (err.message || err));
    }
}

/**
 * 上传到思源服务器
 */
async function uploadToSiyuan(settings: any, icsContent: string, plugin: any, silent: boolean = false) {
    try {
        // 检查是否配置了文件名，若未配置则自动生成并持久化
        let icsFileName = settings.icsFileName;
        if (!icsFileName || icsFileName.trim() === '') {
            const genId = (window.Lute && typeof window.Lute.NewNodeID === 'function')
                ? window.Lute.NewNodeID()
                : Date.now().toString(36);
            icsFileName = `reminder-${genId}`;
            settings.icsFileName = icsFileName;
            try {
                await plugin.saveSettings(settings);
                try {
                    window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
                } catch (e) { }
            } catch (e) {
                console.warn('保存自动生成的 ICS 文件名失败:', e);
            }
            await pushMsg(`未设置 ICS 文件名，已自动生成: ${icsFileName}.ics`);
        }

        // 确保不包含 .ics 后缀
        icsFileName = icsFileName.replace(/\.ics$/i, '');
        const fullFileName = `${icsFileName}.ics`;

        // 写入到 data/assets/<fullFileName>
        const assetPath = `data/assets/${fullFileName}`;
        const blob = new Blob([icsContent], { type: 'text/calendar' });
        await putFile(assetPath, false, blob);

        // 使用 uploadCloud 上传资源，传入 paths 参数和 silent 参数
        await uploadCloud([`assets/${fullFileName}`], silent);

        // 构建云端链接（若可用）并记录上次同步时间
        try {
            const userId = window.siyuan?.user?.userId || '';
            if (userId) {
                const filename = fullFileName;
                const fullUrl = `https://assets.b3logfile.com/siyuan/${userId}/assets/${filename}`;
                settings.icsCloudUrl = fullUrl;
            }
        } finally {
            // 记录上次成功同步时间并保存设置
            try {
                settings.icsLastSyncAt = new Date().toISOString();
                await plugin.saveSettings(settings);

                try {
                    window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
                } catch (e) {
                    console.warn('触发设置更新事件失败:', e);
                }
            } catch (e) {
                console.warn('保存 ICS 同步时间失败:', e);
            }
        }

    } catch (err) {
        console.error('上传到思源服务器失败:', err);
        throw new Error('上传到思源服务器失败: ' + (err.message || err));
    }
}