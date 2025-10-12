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
        const lunar = Lunar.fromYmd(year, lunarMonth, lunarDay);
        if (isLeapMonth) {
            lunar.setLeap(true);
        }
        const solar = lunar.getSolar();
        
        const solarYear = solar.getYear();
        const solarMonth = solar.getMonth().toString().padStart(2, '0');
        const solarDay = solar.getDay().toString().padStart(2, '0');
        
        return `${solarYear}-${solarMonth}-${solarDay}`;
    } catch (error) {
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
 * 解析农历日期文本，例如 "八月廿一"、"正月初一"
 * @param text 农历日期文本
 * @returns {month: number, day: number} 或 null
 */
export function parseLunarDateText(text: string): { month: number; day: number } | null {
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
    
    // 匹配 "八月廿一" 格式
    const monthDayPattern = /^(.+月)(.+)$/;
    const match = text.match(monthDayPattern);
    
    if (match) {
        const monthText = match[1];
        const dayText = match[2];
        
        const month = lunarMonthMap[monthText];
        const day = lunarDayMap[dayText];
        
        if (month && day) {
            return { month, day };
        }
    }
    
    // 只匹配日期 "廿一"、"初一" 等
    const day = lunarDayMap[text];
    if (day) {
        return { month: 0, day }; // month 为 0 表示只有日期
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
