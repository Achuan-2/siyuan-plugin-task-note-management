/**
 * 农历工具类
 * 使用 lunar-typescript 库进行农历与公历转换
 */
import { Lunar, Solar } from 'lunar-typescript';

/**
 * 将公历日期转换为农历
 * @param solarDate 公历日期 (YYYY-MM-DD)
 * @returns 农历月份和日期 {month: number, day: number}
 */
export function solarToLunar(solarDate: string): { month: number; day: number } {
    const [year, month, day] = solarDate.split('-').map(Number);
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();

    return {
        month: lunar.getMonth(),
        day: lunar.getDay()
    };
}

/**
 * 将农历日期转换为公历
 * @param year 公历年份
 * @param lunarMonth 农历月份 (1-12)
 * @param lunarDay 农历日 (1-30)
 * @param isLeapMonth 是否闰月，默认false
 * @returns 公历日期字符串 (YYYY-MM-DD) 或 null（如果日期无效）
 */
export function lunarToSolar(year: number, lunarMonth: number, lunarDay: number, isLeapMonth: boolean = false): string | null {
    try {
        // 创建农历对象，如果是闰月需要特殊处理
        let lunar;
        if (isLeapMonth) {
            // 闰月用负数表示，例如闰四月为-4
            lunar = Lunar.fromYmd(year, -Math.abs(lunarMonth), lunarDay);
        } else {
            lunar = Lunar.fromYmd(year, lunarMonth, lunarDay);
        }

        const solar = lunar.getSolar();

        const solarYear = solar.getYear();
        const solarMonth = solar.getMonth().toString().padStart(2, '0');
        const solarDay = solar.getDay().toString().padStart(2, '0');

        return `${solarYear}-${solarMonth}-${solarDay}`;
    } catch (error) {
        // 特殊处理腊月三十：如果当年腊月只有29天（小月），则使用腊月廿九（除夕）
        if (lunarMonth === 12 && lunarDay === 30 && !isLeapMonth) {
            try {
                const lunar = Lunar.fromYmd(year, 12, 29);
                const solar = lunar.getSolar();
                const solarYear = solar.getYear();
                const solarMonth = solar.getMonth().toString().padStart(2, '0');
                const solarDay = solar.getDay().toString().padStart(2, '0');
                return `${solarYear}-${solarMonth}-${solarDay}`;
            } catch {
                console.error('Invalid lunar date:', error);
                return null;
            }
        }
        console.error('Invalid lunar date:', error);
        return null;
    }
}

/**
 * 获取下一个农历月的公历日期
 * @param currentDate 当前公历日期 (YYYY-MM-DD)
 * @param lunarDay 农历日 (1-30)
 * @returns 下一个对应农历日的公历日期 (YYYY-MM-DD)
 */
export function getNextLunarMonthlyDate(currentDate: string, lunarDay: number): string | null {
    const [year, month, day] = currentDate.split('-').map(Number);
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();

    // 先尝试当月的农历日期
    let nextLunarMonth = lunar.getMonth();
    let nextLunarYear = lunar.getYear();

    // 如果当前农历日期还没到指定日期，使用当月
    if (lunar.getDay() < lunarDay) {
        const solarDate = lunarToSolar(nextLunarYear, nextLunarMonth, lunarDay);
        if (solarDate && solarDate > currentDate) {
            return solarDate;
        }
    }

    // 否则，使用下个月
    nextLunarMonth += 1;
    if (nextLunarMonth > 12) {
        nextLunarMonth = 1;
        nextLunarYear += 1;
    }

    return lunarToSolar(nextLunarYear, nextLunarMonth, lunarDay);
}

/**
 * 获取下一个农历年的公历日期
 * @param currentDate 当前公历日期 (YYYY-MM-DD)
 * @param lunarMonth 农历月份 (1-12)
 * @param lunarDay 农历日 (1-30)
 * @returns 下一个对应农历日期的公历日期 (YYYY-MM-DD)
 */
export function getNextLunarYearlyDate(currentDate: string, lunarMonth: number, lunarDay: number): string | null {
    const [year, month, day] = currentDate.split('-').map(Number);
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();

    let nextLunarYear = lunar.getYear();

    // 先尝试今年的农历日期
    const thisYearDate = lunarToSolar(nextLunarYear, lunarMonth, lunarDay);
    if (thisYearDate && thisYearDate > currentDate) {
        return thisYearDate;
    }

    // 否则，使用明年
    nextLunarYear += 1;
    return lunarToSolar(nextLunarYear, lunarMonth, lunarDay);
}

/**
 * 解析农历日期文本，例如 "八月廿一"、"大年初一","正月初一"、"农历七月十三"、"2000年 农历 七月初三"
 * @param text 农历日期文本
 * @returns {month: number, day: number, year?: number} 或 null
 */
export function parseLunarDateText(text: string): { month: number; day: number; year?: number } | null {
    // 预处理：移除出现的所有"农历"关键字（不局限于开头），并去除多余空白
    let processedText = text.replace(/农历/g, '').trim();

    let year: number | undefined = undefined;

    // 尝试匹配年份 (例如: "2000年", "2000")
    const yearMatch = processedText.match(/^(\d{4})[年\s]*/);
    if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        processedText = processedText.substring(yearMatch[0].length).trim();
    }

    // 农历月份映射
    const lunarMonthMap: { [key: string]: number } = {
        '正月': 1, '一月': 1,
        '二月': 2,
        '三月': 3,
        '四月': 4,
        '五月': 5,
        '六月': 6,
        '七月': 7,
        '八月': 8,
        '九月': 9,
        '十月': 10,
        '冬月': 11, '十一月': 11,
        '腊月': 12, '十二月': 12
    };

    // 农历日期映射
    const lunarDayMap: { [key: string]: number } = {
        '初一': 1, '初二': 2, '初三': 3, '初四': 4, '初五': 5,
        '初六': 6, '初七': 7, '初八': 8, '初九': 9, '初十': 10,
        '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
        '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
        '廿一': 21, '廿二': 22, '廿三': 23, '廿四': 24, '廿五': 25,
        '廿六': 26, '廿七': 27, '廿八': 28, '廿九': 29, '三十': 30
    };

    // 先尝试匹配数字月份 + 数字日期/中文日期（例如："7月13"、"7月13日"、"7月十三"、"7月 廿一"）
    const numericMonthDayRegex = /(\d{1,2})月\s*([\d]{1,2}|[初十廿一二三四五六七八九零十百]+)(?:日|号)?/;
    const numericMonthDayMatch = processedText.match(numericMonthDayRegex);
    if (numericMonthDayMatch) {
        const month = parseInt(numericMonthDayMatch[1], 10);
        let dayText = numericMonthDayMatch[2];
        let day = parseInt(dayText, 10);
        if (isNaN(day)) {
            // 不是纯数字，尝试从映射表中解析中文日期（如 十三、廿一 等）
            dayText = dayText.trim();
            day = lunarDayMap[dayText] || NaN;
        }

        if (!isNaN(month) && !isNaN(day)) {
            return { month, day, year };
        }
    }

    // 特殊处理"大年"：大年三十是腊月三十，大年初一是正月初一
    const daNianMatch = processedText.match(/^大年(.+)$/);
    if (daNianMatch) {
        const dayText = daNianMatch[1];
        const day = lunarDayMap[dayText];
        if (day) {
            // 大年三十（除夕）是腊月三十
            if (day === 30) {
                return { month: 12, day: 30, year };
            }
            // 大年初一（春节）是正月初一
            if (day === 1) {
                return { month: 1, day: 1, year };
            }
            // 其他情况默认按正月处理
            return { month: 1, day, year };
        }
    }

    // 再尝试匹配中文月份 + 中文日期（例如："八月廿一"、"正月初一"）
    const monthDayPattern = /^(.+月)(.+)$/;
    const match = processedText.match(monthDayPattern);

    if (match) {
        const monthText = match[1];
        const dayText = match[2];

        const month = lunarMonthMap[monthText];
        let day = lunarDayMap[dayText];

        // 如果日部分是阿拉伯数字（例如 "13"），将其解析为数字
        if ((!day || day === undefined) && /^\d{1,2}$/.test(dayText.trim())) {
            const dayNum = parseInt(dayText.trim(), 10);
            if (dayNum >= 1 && dayNum <= 30) {
                day = dayNum;
            }
        }

        if (month && day) {
            return { month, day, year };
        }
    }

    // 只匹配日期 "廿一"、"初一" 等（没有提到月份的情况）
    const day = lunarDayMap[processedText];
    if (day) {
        return { month: 0, day, year }; // month 为 0 表示只有日期
    }

    // 也尝试纯数字日期（如："13日"、"13号"、"13"）但不指定月份
    const numericDayMatch = processedText.match(/^(?:第)?(\d{1,2})(?:日|号)?$/);
    if (numericDayMatch) {
        const dayNum = parseInt(numericDayMatch[1], 10);
        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 30) {
            return { month: 0, day: dayNum, year };
        }
    }

    return null;
}

/**
 * 将当前年份的农历日期转换为公历日期字符串
 * @param lunarMonth 农历月份
 * @param lunarDay 农历日
 * @returns 公历日期字符串 (YYYY-MM-DD)
 */
export function getCurrentYearLunarToSolar(lunarMonth: number, lunarDay: number): string | null {
    const currentYear = new Date().getFullYear();
    return lunarToSolar(currentYear, lunarMonth, lunarDay);
}

/**
 * 将农历月份数字转换为中文
 * @param month 农历月份 (1-12)
 * @returns 中文月份名称
 */
export function formatLunarMonth(month: number): string {
    const lunarMonths = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
    return lunarMonths[month] || `${month}月`;
}

/**
 * 将农历日期数字转换为中文
 * @param day 农历日期 (1-30)
 * @returns 中文日期
 */
export function formatLunarDay(day: number): string {
    const lunarDays = [
        '', '初一', '初二', '初三', '初四', '初五',
        '初六', '初七', '初八', '初九', '初十',
        '十一', '十二', '十三', '十四', '十五',
        '十六', '十七', '十八', '十九', '二十',
        '廿一', '廿二', '廿三', '廿四', '廿五',
        '廿六', '廿七', '廿八', '廿九', '三十'
    ];
    return lunarDays[day] || `${day}日`;
}

/**
 * 格式化完整的农历日期为中文
 * @param month 农历月份 (1-12)
 * @param day 农历日期 (1-30)
 * @returns 格式化的农历日期，如 "八月十五"
 */
export function formatLunarDate(month: number, day: number): string {
    return `${formatLunarMonth(month)}${formatLunarDay(day)}`;
}

/**
 * 获取公历日期对应的农历日期字符串
 * @param solarDate 公历日期 (YYYY-MM-DD)
 * @returns 农历日期字符串，如 "八月十五"
 */
export function getSolarDateLunarString(solarDate: string): string {
    try {
        const lunar = solarToLunar(solarDate);
        return formatLunarDate(lunar.month, lunar.day);
    } catch (error) {
        console.error('Failed to get lunar string:', error);
        return '';
    }
}
