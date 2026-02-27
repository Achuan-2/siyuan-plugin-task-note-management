import * as chrono from 'chrono-node';
import { parseLunarDateText, getCurrentYearLunarToSolar, solarToLunar, lunarToSolar } from "./lunarUtils";

/**
 * 获取本地日期字符串（YYYY-MM-DD格式）
 * 解决时区问题，确保在东八区正确显示日期
 */
let dayStartMinutes = 0;

function formatDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 获取当前的语言区域标识符（BCP 47格式，如 zh-CN, en-US）
 */
export function getLocaleTag(): string {
    const lang = (window as any).siyuan?.config?.lang || 'zh_CN';
    return lang.replace('_', '-');
}

function parseTimeToMinutes(value?: string | number): number {
    if (typeof value === 'number') {
        const h = Math.max(0, Math.min(23, Math.floor(value)));
        return h * 60;
    }
    if (typeof value === 'string') {
        const m = value.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (m) {
            const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
            const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
            return h * 60 + min;
        }
    }
    return 0;
}

export function getDayStartAdjustedDate(date: Date): Date {
    if (!dayStartMinutes) return date;
    return new Date(date.getTime() - dayStartMinutes * 60 * 1000);
}

export function setDayStartTime(value?: string | number): void {
    dayStartMinutes = parseTimeToMinutes(value);
}

export function getDayStartMinutes(): number {
    return dayStartMinutes;
}

export function getLocalDateString(date?: Date): string {
    const d = date || new Date();
    return formatDateString(d);
}

export function getLogicalDateString(date?: Date): string {
    const d = date || new Date();
    const adjusted = getDayStartAdjustedDate(d);
    return formatDateString(adjusted);
}

export function getRelativeDateString(daysOffset: number, baseDate?: Date): string {
    const base = getDayStartAdjustedDate(baseDate || new Date());
    const dateOnly = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    dateOnly.setDate(dateOnly.getDate() + daysOffset);
    return formatDateString(dateOnly);
}

/**
 * 获取本地时间字符串（HH:MM格式）
 */
export function getLocalTimeString(date?: Date): string {
    const d = date || new Date();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function getLocalDateTimeString(date?: Date): string {
    const d = date || new Date();

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 从Date对象获取本地日期时间
 */
export function getLocalDateTime(date: Date): { dateStr: string; timeStr: string } {
    return {
        dateStr: getLocalDateString(date),
        timeStr: getLocalTimeString(date)
    };
}


/**
 * 比较两个日期字符串（YYYY-MM-DD格式）
 * 返回值：-1表示date1早于date2，0表示相等，1表示date1晚于date2
 * @param date1 
 * @param date2 
 * @returns 
 */
export function compareDateStrings(date1: string, date2: string): number {
    if (date1 < date2) return -1;
    if (date1 > date2) return 1;
    return 0;
}

/**
 * 验证日期有效性
 */
export function isValidDate(year: number, month: number, day: number): boolean {
    // 基本范围检查
    if (year < 1900 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    // 创建Date对象进行更精确的验证
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day;
}

// 初始化全局 chrono 解析器
const chronoParser: any = chrono.zh.casual.clone();

// 配置 chrono 选项
chronoParser.option = {
    ...chronoParser.option,
    forwardDate: false // 优先解析未来日期
};

// 添加自定义解析器来处理紧凑日期格式和其他特殊格式
chronoParser.refiners.push({
    refine: (_context: any, results: any[]) => {
        results.forEach(result => {
            const text = result.text;

            // 处理YYYYMMDD格式
            const compactMatch = text.match(/^(\d{8})$/);
            if (compactMatch) {
                const dateStr = compactMatch[1];
                const year = parseInt(dateStr.substring(0, 4));
                const month = parseInt(dateStr.substring(4, 6));
                const day = parseInt(dateStr.substring(6, 8));

                // 验证日期有效性
                if (isValidDate(year, month, day)) {
                    result.start.assign('year', year);
                    result.start.assign('month', month);
                    result.start.assign('day', day);
                }
            }

            // 处理其他数字格式 (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD)
            const standardMatch = text.match(/^(\d{4})[-\/\.年](\d{1,2})[-\/\.月日](\d{1,2})[日号]?$/);
            if (standardMatch) {
                const year = parseInt(standardMatch[1]);
                const month = parseInt(standardMatch[2]);
                const day = parseInt(standardMatch[3]);

                if (isValidDate(year, month, day)) {
                    result.start.assign('year', year);
                    result.start.assign('month', month);
                    result.start.assign('day', day);
                }
            }
        });

        return results;
    }
});

/**
 * 解析自然语言日期时间
 */
export interface ParseResult {
    date?: string;
    time?: string;
    hasTime?: boolean;
    hasDate?: boolean;
    endDate?: string;
    endTime?: string;
    hasEndTime?: boolean;
    hasEndDate?: boolean;
}

/**
 * 解析自然语言日期时间
 */
export function parseNaturalDateTime(text: string): ParseResult {
    try {
        // 预处理文本，处理一些特殊格式
        let processedText = text.trim();

        // 截止 / 到期 识别
        const deadlineMatch = processedText.match(/^(?:截止|到期|deadline|until)\s*(.*)$/i);
        if (deadlineMatch) {
            const result = parseNaturalDateTime(deadlineMatch[1]);
            return {
                endDate: result.date,
                endTime: result.time,
                hasEndTime: result.hasTime || !!result.time,
                // 如果是截止，通常起始日期默认为今天（或者不填，由 UI 处理）
                // 但为了识别结果能预览，可以把解析出来的赋给 date/time 如果它们为空
                date: undefined,
                time: undefined,
                hasTime: false
            };
        }

        // 范围识别 (14:20-16:00, 2026.01.23-2026.01.25 等)
        // 排除掉 YYYY-MM-DD 中的杠，杠两边如果是时间或完整日期
        const rangeSeparators = [" - ", "-", "~", "至", "到", " to "];
        for (const sep of rangeSeparators) {
            if (processedText.includes(sep)) {
                // 简单的启发式对杠进行判断：如果是 YYYY-MM-DD，不要按这个杠切
                if (sep === "-" && /^\d{4}-\d{2}-\d{2}$/.test(processedText)) continue;

                const parts = processedText.split(sep);
                if (parts.length === 2) {
                    const startResult = parseNaturalDateTime(parts[0]);
                    const endResult = parseNaturalDateTime(parts[1]);

                    if (startResult.date || startResult.time || endResult.date || endResult.time) {
                        // 补齐逻辑：如果结束部分没有显式日期只有时间，使用起始部分的日期
                        let endDate = endResult.date;
                        let hasEndDate = endResult.hasDate;
                        if (!endResult.hasDate && endResult.time && startResult.date) {
                            endDate = startResult.date;
                            hasEndDate = true;
                        }

                        return {
                            date: startResult.date,
                            time: startResult.time,
                            hasTime: startResult.hasTime,
                            hasDate: startResult.hasDate,
                            endDate: endDate,
                            endTime: endResult.time,
                            hasEndTime: endResult.hasTime || !!endResult.time,
                            hasEndDate: hasEndDate,
                            // 继承年份逻辑：如果结束日期识别到了但没有年份（或者识别为今年）而开始日期有不同年份
                            // 实际场景：2025.12.30-01.02，需要把 endDate 改为 2026
                            // 此处简化处理，由后续逻辑统一处理日期连贯性
                        };
                    }
                }
            }
        }

        // 原有的单日期解析逻辑...

        // --- 优先提取末尾时间 (针对 "任务0：14:20" 这种场景) ---
        // 匹配模式：(起始/空格/中英文冒号) + (1-2位数字) + (中英文冒号/点) + (2位数字) + (可选分) + 结尾
        const trailingTimePattern = /(?:^|[\s:：])(\d{1,2})[:：点](\d{2})(?:分)?$/;
        const trailingTimeMatch = processedText.match(trailingTimePattern);
        if (trailingTimeMatch) {
            const h = parseInt(trailingTimeMatch[1]);
            const m = parseInt(trailingTimeMatch[2]);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

                // 检查剩余部分是否包含日期信息
                // 获取匹配开始的位置（包括前缀空格或冒号）
                const matchIndex = trailingTimeMatch.index || 0;
                const remainingText = processedText.substring(0, matchIndex).trim();

                if (remainingText) {
                    // 尝试解析剩余部分的日期
                    const dateResult = parseNaturalDateTime(remainingText);
                    if (dateResult.date) {
                        return {
                            ...dateResult,
                            time: timeStr,
                            hasTime: true
                        };
                    }
                }

                // 没识别到日期，默认今天
                return {
                    date: getLogicalDateString(),
                    time: timeStr,
                    hasTime: true,
                    hasDate: false
                };
            }
        }

        // 处理包含8位数字日期的情况
        const compactDateInTextMatch = processedText.match(/(?:^|.*?)(\d{8})(?:\s|$|.*)/);
        if (compactDateInTextMatch) {
            const dateStr = compactDateInTextMatch[1];
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);

            // 验证日期有效性
            if (isValidDate(parseInt(year), parseInt(month), parseInt(day))) {
                // 检查是否还有时间信息
                const textWithoutDate = processedText.replace(dateStr, '').trim();
                let timeResult = null;

                if (textWithoutDate) {
                    // 尝试从剩余文本中解析时间
                    const timeMatch = textWithoutDate.match(/(\d{1,2})[点时:](\d{1,2})?[分]?/);
                    if (timeMatch) {
                        const hour = parseInt(timeMatch[1]);
                        const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

                        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                            const hourStr = hour.toString().padStart(2, '0');
                            const minuteStr = minute.toString().padStart(2, '0');
                            timeResult = `${hourStr}:${minuteStr}`;
                        }
                    }
                }

                return {
                    date: `${year}-${month}-${day}`,
                    time: timeResult || undefined,
                    hasTime: !!timeResult,
                    hasDate: true
                };
            }
        }

        // 处理多种标准日期格式 (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY年MM月DD日)
        // 支持可选的时间后缀 (16:00, 16点, 16点30分等)
        const datePattern = /(\d{4})[-\/\.年](\d{1,2})[-\/\.月日](\d{1,2})[日号]?/;
        const timePattern = /(?:\s+|T)?(\d{1,2})[:点](\d{1,2})?(?:分)?/;

        const fullMatch = processedText.match(new RegExp(datePattern.source + "(?:" + timePattern.source + ")?"));
        if (fullMatch) {
            const year = parseInt(fullMatch[1]);
            const month = parseInt(fullMatch[2]);
            const day = parseInt(fullMatch[3]);

            if (isValidDate(year, month, day)) {
                const monthStr = month.toString().padStart(2, '0');
                const dayStr = day.toString().padStart(2, '0');

                let timeResult = undefined;
                if (fullMatch[4]) { // hour matched
                    const hour = parseInt(fullMatch[4]);
                    const minute = fullMatch[5] ? parseInt(fullMatch[5]) : 0;
                    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                        timeResult = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                    }
                }

                return {
                    date: `${year}-${monthStr}-${dayStr}`,
                    time: timeResult,
                    hasTime: !!timeResult,
                    hasDate: true
                };
            }
        }

        // 处理 月/日 格式 (MM-DD, MM/DD, MM.DD, MM月DD日, MM日DD日)
        // 移除了 ^ 和 $ 锚点
        const monthDayPattern = /(\d{1,2})[-\/\.月日](\d{1,2})[日号]?/;
        const monthDayMatch = processedText.match(new RegExp(monthDayPattern.source + "(?:" + timePattern.source + ")?"));
        if (monthDayMatch) {
            const year = new Date().getFullYear();
            const month = parseInt(monthDayMatch[1]);
            const day = parseInt(monthDayMatch[2]);

            if (isValidDate(year, month, day)) {
                const monthStr = month.toString().padStart(2, '0');
                const dayStr = day.toString().padStart(2, '0');

                let timeResult = undefined;
                if (monthDayMatch[3]) { // hour matched (offset changed because year group is gone)
                    const hour = parseInt(monthDayMatch[3]);
                    const minute = monthDayMatch[4] ? parseInt(monthDayMatch[4]) : 0;
                    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                        timeResult = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                    }
                }

                return {
                    date: `${year}-${monthStr}-${dayStr}`,
                    time: timeResult,
                    hasTime: !!timeResult,
                    hasDate: true
                };
            }
        }

        // 处理农历日期格式（例如：八月廿一、正月初一、农历七月十三）
        // 如果文本包含“农历”关键字，则强制以农历解析（例如“农历7月13”、“农历七月二十”等）
        if (/农历/.test(text) || /农历/.test(processedText)) {
            const lunarDate = parseLunarDateText(processedText);
            if (lunarDate) {
                // 如果只识别到日期（month === 0），使用当前月作为默认月
                if (lunarDate.month === 0) {
                    try {
                        const cur = solarToLunar(getLogicalDateString());
                        lunarDate.month = cur.month;
                    } catch (e) {
                        // ignore and fall back
                    }
                }

                if (lunarDate.month > 0) {
                    const solarDate = lunarDate.year ?
                        lunarToSolar(lunarDate.year, lunarDate.month, lunarDate.day) :
                        getCurrentYearLunarToSolar(lunarDate.month, lunarDate.day);

                    if (solarDate) {
                        return {
                            date: solarDate,
                            hasTime: false,
                            hasDate: true
                        };
                    }
                }
            }
        }

        // 使用chrono解析其他格式
        const results = chronoParser.parse(processedText, new Date(), { forwardDate: false });

        if (results.length === 0) {
            return {};
        }

        const result = results[0];
        const parsedDate = result.start.date();

        // 格式化日期，使用本地时间避免时区导致日期跳变
        const year = parsedDate.getFullYear();
        const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
        const day = parsedDate.getDate().toString().padStart(2, '0');
        const date = `${year}-${month}-${day}`;

        // 检查是否包含明确的日期/时间信息
        const hasDate = result.start.isCertain('year') || result.start.isCertain('month') || result.start.isCertain('day');
        const hasTime = result.start.isCertain('hour') && result.start.isCertain('minute');
        let time = undefined;

        if (hasTime) {
            const hours = parsedDate.getHours().toString().padStart(2, '0');
            const minutes = parsedDate.getMinutes().toString().padStart(2, '0');
            time = `${hours}:${minutes}`;
        }

        return { date, time, hasTime, hasDate };
    } catch (error) {
        console.error('解析自然语言日期时间失败:', error);
        return {};
    }
}

/**
 * 从标题自动识别日期时间
 */
export function autoDetectDateTimeFromTitle(title: string): ParseResult & { cleanTitle?: string } {
    const parseResult = parseNaturalDateTime(title);

    if (!parseResult.date) {
        return { cleanTitle: title };
    }

    // 尝试从标题中移除已识别的时间表达式
    let cleanTitle = title;
    const timeExpressions = [
        /今天|今日/gi,
        /明天|明日/gi,
        /后天/gi,
        /大后天/gi,
        /下?周[一二三四五六日天]/gi,
        /下?星期[一二三四五六日天]/gi,
        /\d{4}年\d{1,2}月\d{1,2}[日号]/gi, // 新增年月日识别
        /\d{1,2}月\d{1,2}[日号]/gi,
        /\d{1,2}[点时]\d{0,2}[分]?/gi,
        /\d+天[后以]后/gi,
        /\d+小时[后以]后/gi,
        /(?:\d{4}年\s*)?农历\s*[\u4e00-\u9fa5\d]+月[\u4e00-\u9fa5\d]+/gi, // 识别农历（含可选年份）
        /\d{8}/gi, // 8位数字日期
        /\d{4}[年\-\/\.]\d{1,2}[月日\-\/\.]\d{1,2}[日号]?/gi, // 标准日期格式
        /\d{1,2}[月日]\d{1,2}[日号]/gi, // 月日识别 (含非标准日日格式)
        /\d{1,2}:\d{2}(?::\d{2})?/gi, // HH:MM or HH:MM:SS
    ];

    timeExpressions.forEach(pattern => {
        cleanTitle = cleanTitle.replace(pattern, '').trim();
    });

    // 清理多余的空格和标点
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、\s]+|[，。、\s]+$/g, '');

    return {
        ...parseResult,
        cleanTitle: cleanTitle // 允许返回空字符串，如果不允许则会在调用处无法区分是否整个标题都是日期
    };
}
