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
 * 将中文相对日期词归一化为具体日期字符串，便于后续统一解析
 */
function normalizeRelativeDateKeywords(text: string): { normalizedText: string; hasRelativeDateKeyword: boolean } {
    const relativeDateKeywords: Array<{ pattern: RegExp; offset: number }> = [
        { pattern: /大后天/g, offset: 3 },
        { pattern: /后天/g, offset: 2 },
        { pattern: /明天|明日/g, offset: 1 },
        { pattern: /今天|今日/g, offset: 0 },
    ];

    let normalizedText = text;
    let hasRelativeDateKeyword = false;

    relativeDateKeywords.forEach(({ pattern, offset }) => {
        normalizedText = normalizedText.replace(pattern, () => {
            hasRelativeDateKeyword = true;
            return `${getRelativeDateString(offset)} `;
        });
    });

    return {
        normalizedText: normalizedText.trim(),
        hasRelativeDateKeyword
    };
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

/**
 * 将中文时间数字转换为阿拉伯数字，以解决 chrono-node 的解析 Bug (如 "十二点十五" 会错误解析为 "2:15")
 */
function zhTimeToArabic(text: string): string {
    const zhNumMap: Record<string, number> = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

    const convert = (numStr: string) => {
        if (numStr === '十') return 10;
        if (numStr.length === 1) return zhNumMap[numStr];
        if (numStr.length === 2) {
            if (numStr[0] === '十') return 10 + zhNumMap[numStr[1]];
            if (numStr[1] === '十') return zhNumMap[numStr[0]] * 10;
        }
        if (numStr.length === 3 && numStr[1] === '十') {
            return zhNumMap[numStr[0]] * 10 + zhNumMap[numStr[2]];
        }
        return numStr;
    };

    let result = text;
    // 处理带单位的时间，如 "十二点", "十五分", "十二小时"
    result = result.replace(/([零〇一二两三四五六七八九十]+)(点|时|分|个?小时)/g, (_match, numStr, unit) => {
        const arab = convert(numStr);
        return (typeof arab === 'number' ? arab.toString() : numStr) + unit;
    });

    // 处理无单位的分钟，如 "十二点十五"
    result = result.replace(/(\d{1,2})[点时]([零〇一二两三四五六七八九十]{1,3})(?=(?:[^零〇一二两三四五六七八九十]|$))/g, (_match, h, mStr) => {
        const mArab = convert(mStr);
        return h + '点' + (typeof mArab === 'number' ? mArab.toString() : mStr);
    });

    return result;
}

/**
 * 预处理时间文本，规范化常见的歧义表达
 * 1. 去除时间修饰词（下午/晚上等）与数字/中文数字之间的空格：「下午 1点」→「下午1点」
 * 2. 去除「下午/晚上」与已是 24h 制时间（12-23）搭配时的冗余修饰：「下午13点」→「13：00」
 * 3. 将「中午+1/2点」转为「下午+1/2点」，避免 chrono 解析为凌晨：「中午一点半」→「下午一点半」
 * 4. 展开「X点半」（X=13-23）为标准时间字符串：「13点半」→「13:30」
 */
function preprocessTimeText(text: string): string {
    let result = zhTimeToArabic(text);

    // 1. 去除时间段修饰词与后续数字/中文数字之间的空格
    result = result.replace(/(下午|上午|早上|晚上|中午|傍晚)\s+(\d)/g, '$1$2');
    result = result.replace(/(下午|上午|早上|晚上|中午|傍晚)\s+([一二三四五六七八九十])/g, '$1$2');

    // 2. 去除「下午/晚上/傍晚」与已是 12-23 的小时数搭配时的冗余前缀
    //    「下午13点半」→「13:30」, 「晚上21点」→「21点」
    result = result.replace(/(?:下午|晚上|傍晚)(1[2-9]|2[0-3])([点时:：])([0-5]\d)?(?:分)?/g, (_, h, _sep, min) => {
        const hh = h.padStart(2, '0');
        const mm = (min || '00').padStart(2, '0');
        return `${hh}:${mm}`;
    });

    // 3. 将「中午」+一/1/两/2 点 转为「下午」，避免 chrono 解析成凌晨
    result = result.replace(/中午([一1])/g, '下午$1');
    result = result.replace(/中午([两2])/g, '下午$1');

    // 4. 展开「X点半」（X=13..23）→「X:30」
    result = result.replace(/\b(1[3-9]|2[0-3])点半\b/g, '$1:30');
    // 展开「X点YY分」（X=13..23）→「X:YY」
    result = result.replace(/\b(1[3-9]|2[0-3])点([0-5]\d)分?\b/g, '$1:$2');

    return result;
}

/**
 * 当没有明确日期时，根据时间是否已过推算日期（今天 or 明天）
 */
function getDateForTimeOrTomorrow(hour: number, minute: number): { date: string; hasDate: false } {
    const now = new Date();
    const todayWithTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (todayWithTime <= now) {
        // 该时间今天已过，默认明天
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return { date: formatDateString(tomorrow), hasDate: false };
    }
    return { date: getLogicalDateString(), hasDate: false };
}

function getLeadingTimeClause(text: string): string {
    return text.split(/[，。,.；;！!？?\n]/, 1)[0].trim();
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
                // 允许出现多次分隔符（例如：明天8点到10点，到处走走），需尝试寻找最合适的分割点
                if (parts.length >= 2) {
                    for (let i = 1; i < parts.length; i++) {
                        const left = parts.slice(0, i).join(sep);
                        const right = parts.slice(i).join(sep);

                        const startResult = parseNaturalDateTimeInner(left);
                        const endResult = parseNaturalDateTimeInner(right);

                        if ((startResult.date || startResult.time) && (endResult.date || endResult.time)) {
                            // 补齐逻辑：如果结束部分没有显式日期只有时间，使用起始部分的日期
                            let endDate = endResult.date;
                            let hasEndDate = endResult.hasDate;
                            if (!endResult.hasDate && endResult.time && startResult.date) {
                                endDate = startResult.date;
                                hasEndDate = true;
                            }

                            // PM 上下文传播：若起始部分含下午/晚上修饰词，而结束部分没有时间段修饰词
                            // （但凌晨/深夜等 AM 修饰词除外），尝试对结束时间应用 PM（小时 < 12 时 +12）
                            // 仅当 PM 调整后结束时间仍大于起始时间（同一天内不跨午夜）时才应用，
                            // 否则保持原样（视为 AM），由下方跨午夜逻辑处理。
                            const pmIndicator = /下午|晚上|傍晚/;
                            // 凌晨/深夜 明确表示 AM，不能被 PM 传播覆盖
                            const anyTimeOfDay = /上午|下午|早上|晚上|中午|傍晚|凌晨|深夜/;
                            const rightLeadingClause = getLeadingTimeClause(right);
                            let endTime = endResult.time;
                            if (pmIndicator.test(left) && !anyTimeOfDay.test(rightLeadingClause) && endTime) {
                                const [endH, endM] = endTime.split(':').map(Number);
                                if (endH < 12) {
                                    const pmEndH = endH + 12;
                                    // 只有 PM 版本不跨午夜（pmEnd > start）时才采用 PM
                                    if (startResult.time) {
                                        const [startH, startM] = startResult.time.split(':').map(Number);
                                        const startMins = startH * 60 + startM;
                                        const pmEndMins = pmEndH * 60 + endM;
                                        if (pmEndMins > startMins) {
                                            endTime = `${pmEndH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                                        }
                                        // 否则：保持 AM（如 01:00），跨午夜逻辑会处理次日
                                    } else {
                                        endTime = `${pmEndH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                                    }
                                }
                            }

                            // 跨午夜检测：若起止同一天，但开始时间 > 结束时间，说明跨越了午夜，结束日期 +1 天
                            if (startResult.time && endTime && endDate) {
                                const [startH, startM] = startResult.time.split(':').map(Number);
                                const [endH2, endM2] = endTime.split(':').map(Number);
                                const startMins = startH * 60 + startM;
                                const endMins = endH2 * 60 + endM2;
                                if (startMins > endMins) {
                                    // 结束时间在次日
                                    const endDateObj = new Date(endDate + 'T00:00:00');
                                    endDateObj.setDate(endDateObj.getDate() + 1);
                                    endDate = formatDateString(endDateObj);
                                }
                            }

                            return {
                                date: startResult.date,
                                time: startResult.time,
                                hasTime: startResult.hasTime,
                                hasDate: startResult.hasDate,
                                endDate: endDate,
                                endTime: endTime,
                                hasEndTime: endResult.hasTime || !!endResult.time,
                                hasEndDate: hasEndDate,
                            };
                        }
                    }
                }
            }
        }

        return parseNaturalDateTimeInner(processedText);
    } catch (error) {
        console.error('解析自然语言日期时间失败:', error);
        return {};
    }
}

/**
 * 内部解析函数，不含范围切割逻辑
 */
function parseNaturalDateTimeInner(text: string): ParseResult {
    try {
        let processedText = preprocessTimeText(text.trim());
        const normalizedRelativeDate = normalizeRelativeDateKeywords(processedText);
        if (normalizedRelativeDate.hasRelativeDateKeyword) {
            processedText = normalizedRelativeDate.normalizedText;
        }

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

                // 没识别到日期：过期则默认明天，否则今天
                const { date: inferredDate, hasDate: inferredHasDate } = getDateForTimeOrTomorrow(h, m);
                return {
                    date: inferredDate,
                    time: timeStr,
                    hasTime: true,
                    hasDate: inferredHasDate
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
        // 1. 如果文本包含"农历"关键字，强制以农历解析
        // 2. 尝试直接解析纯农历格式（如"正月初一"、"腊月三十"、"大年二十九"等）
        const hasLunarKeyword = /农历/.test(processedText);
        const lunarDate = parseLunarDateText(processedText);
        if (lunarDate && (hasLunarKeyword || lunarDate.month > 0)) {
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

        // 无明确日期但有时间：若该时间当天已过，则默认到明天
        if (!hasDate && hasTime && time) {
            const [h, m] = time.split(':').map(Number);
            const { date: inferredDate } = getDateForTimeOrTomorrow(h, m);
            return { date: inferredDate, time, hasTime: true, hasDate: false };
        }

        return { date, time, hasTime, hasDate };
    } catch (error) {
        console.error('内部解析自然语言日期时间失败:', error);
        return {};
    }
}

/**
 * 从标题自动识别日期时间
 */
export function autoDetectDateTimeFromTitle(title: string, removeMode: 'none' | 'date' | 'all' = 'all'): ParseResult & { cleanTitle?: string } {
    const parseResult = parseNaturalDateTime(title);

    if (!parseResult.date || removeMode === 'none') {
        return { ...parseResult, cleanTitle: title };
    }

    // 尝试从标题中移除已识别的时间表达式
    let cleanTitle = title;

    // 时间相关的表达式
    const timeOnlyExpressions = [
        /早上|上午|中午|下午|晚上/gi,
        /[\d一二三四五六七八九十两零〇]+\s*[点时]\s*[\d一二三四五六七八九十两零〇]*\s*分?半?/gi,
        /\d{1,2}\s*:\s*\d{2}(?::\d{2})?/gi,
        /[点时]\s*[\d一二三四五六七八九十两零〇]+\s*分?/gi,
        /[\d一二三四五六七八九十两零〇半]+\s*个?小时[后以]后/gi,
    ];

    // 日期相关的表达式
    const dateOnlyExpressions = [
        /今天|今日/gi,
        /明天|明日/gi,
        /后天/gi,
        /大后天/gi,
        /下?周[一二三四五六日天]/gi,
        /下?星期[一二三四五六日天]/gi,
        // English weekdays (full and common abbreviations)
        /\b(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
        /\d{4}年\s*\d{1,2}月\s*\d{1,2}[日号]/gi,
        /\d{1,2}月\s*\d{1,2}[日号]/gi,
        /\d+\s*天[后以]后/gi,
        /(?:\d{4}年\s*)?农历\s*[\u4e00-\u9fa5\d]+月[\u4e00-\u9fa5\d]+/gi,
        /\d{8}/gi,
        /\d{4}[年\-\/\.]\s*\d{1,2}[月日\-\/\.]\s*\d{1,2}[日号]?/gi,
        /\d{1,2}[月日]\s*\d{1,2}[日号]/gi,
    ];

    // 其它连接词
    const otherExpressions = [
        /到|至|~|-/gi,
    ];

    let expressionsToRemove: RegExp[] = [];
    if (removeMode === 'all') {
        expressionsToRemove = [...dateOnlyExpressions, ...timeOnlyExpressions, ...otherExpressions];
    } else if (removeMode === 'date') {
        expressionsToRemove = dateOnlyExpressions;
    }

    expressionsToRemove.forEach(pattern => {
        cleanTitle = cleanTitle.replace(pattern, '').trim();
    });

    // 清理多余的空格和标点
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、,~至\- \s]+|[，。、,~至\- \s]+$/g, '');

    return {
        ...parseResult,
        cleanTitle: cleanTitle
    };
}
