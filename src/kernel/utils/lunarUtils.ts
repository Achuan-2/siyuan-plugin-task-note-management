/**
 * 内核专用轻量农历工具（1899–2100 年查表实现，替代单体大库 lunar-typescript）。
 * 编码规则（每一年 17 bit，与 lunar-typescript 1900-01-01 ~ 2100-12-31 逐日校验 100% 一致）：
 * - bit 16: 闰月是否大月（1 = 30天，0 = 29天）
 * - bits 15..4: 农历正月..腊月是否大月（bit 15 对应正月，bit 4 对应腊月）
 * - bits 3..0: 闰月月份（0 表示无闰月，1..12 表示闰几月）
 */

const LUNAR_START_YEAR = 1899;
// 农历 1899 年正月初一对应的公历日期：1899-02-10
const LUNAR_ANCHOR_UTC = Date.UTC(1899, 1, 10);
const MS_PER_DAY = 86_400_000;

const LUNAR_YEAR_TABLE: readonly number[] = [
    0x0ab50, 0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255,
    0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566,
    0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, 0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0,
    0x0d2b2, 0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60,
    0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0,
    0x195a6, 0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50,
    0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950,
    0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, 0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0,
    0x0d260, 0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2,
    0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4,
    0x0aae0, 0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6,
    0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, 0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, 0x0e968,
    0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, 0x0d520,
];

function getLunarYearDays(code: number): number {
    let days = 0;
    for (let month = 1; month <= 12; month++) {
        days += ((code >> (16 - month)) & 1) ? 30 : 29;
    }
    if (code & 0xf) {
        days += ((code >> 16) & 1) ? 30 : 29;
    }
    return days;
}

/**
 * 将公历日期转换为农历（闰月月份以负数表示，与 lunar-typescript 保持一致）。
 */
export function solarToLunar(solarDate: string): { month: number; day: number } {
    const [year, month, day] = solarDate.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        throw new RangeError(`Invalid solar date: ${solarDate}`);
    }

    let offset = Math.round((Date.UTC(year, month - 1, day) - LUNAR_ANCHOR_UTC) / MS_PER_DAY);
    if (offset < 0) {
        throw new RangeError(`Solar date out of supported range (1899-02-10 ~ 2100-12-31): ${solarDate}`);
    }

    let yearIndex = 0;
    while (yearIndex < LUNAR_YEAR_TABLE.length) {
        const yearDays = getLunarYearDays(LUNAR_YEAR_TABLE[yearIndex]);
        if (offset < yearDays) break;
        offset -= yearDays;
        yearIndex++;
    }

    if (yearIndex >= LUNAR_YEAR_TABLE.length) {
        throw new RangeError(`Solar date out of supported range (${LUNAR_START_YEAR} ~ ${LUNAR_START_YEAR + LUNAR_YEAR_TABLE.length - 1}): ${solarDate}`);
    }

    const code = LUNAR_YEAR_TABLE[yearIndex];
    const leapMonth = code & 0xf;
    let isLeap = false;
    let lunarMonth = 1;

    while (lunarMonth <= 12) {
        const monthDays = isLeap
            ? (((code >> 16) & 1) ? 30 : 29)
            : (((code >> (16 - lunarMonth)) & 1) ? 30 : 29);

        if (offset < monthDays) {
            return {
                month: isLeap ? -lunarMonth : lunarMonth,
                day: offset + 1,
            };
        }

        offset -= monthDays;
        if (!isLeap && leapMonth === lunarMonth) {
            isLeap = true;
        } else {
            isLeap = false;
            lunarMonth++;
        }
    }

    throw new RangeError(`Failed to convert solar date: ${solarDate}`);
}

/**
 * 将农历日期转换为公历日期字符串 (YYYY-MM-DD)，失败返回 null。
 */
export function lunarToSolar(year: number, lunarMonth: number, lunarDay: number, isLeapMonth: boolean = false): string | null {
    const targetMonth = Math.abs(lunarMonth);
    const useLeap = isLeapMonth || lunarMonth < 0;
    const yearIndex = year - LUNAR_START_YEAR;
    if (yearIndex < 0 || yearIndex >= LUNAR_YEAR_TABLE.length || targetMonth < 1 || targetMonth > 12 || lunarDay < 1 || lunarDay > 30) {
        return null;
    }

    const code = LUNAR_YEAR_TABLE[yearIndex];
    const leapMonth = code & 0xf;
    if (useLeap && leapMonth !== targetMonth) return null;

    const targetMonthDays = useLeap
        ? (((code >> 16) & 1) ? 30 : 29)
        : (((code >> (16 - targetMonth)) & 1) ? 30 : 29);

    let effectiveDay = lunarDay;
    if (effectiveDay > targetMonthDays) {
        // 特殊处理腊月三十：若当年腊月只有 29 天则回退至腊月廿九（除夕），与 src/utils/lunarUtils.ts 一致
        if (targetMonth === 12 && lunarDay === 30 && !useLeap) {
            effectiveDay = 29;
        } else {
            return null;
        }
    }

    let offset = 0;
    for (let i = 0; i < yearIndex; i++) {
        offset += getLunarYearDays(LUNAR_YEAR_TABLE[i]);
    }
    for (let m = 1; m < targetMonth; m++) {
        offset += ((code >> (16 - m)) & 1) ? 30 : 29;
        if (leapMonth === m) {
            offset += ((code >> 16) & 1) ? 30 : 29;
        }
    }
    if (useLeap) {
        offset += ((code >> (16 - targetMonth)) & 1) ? 30 : 29;
    }
    offset += effectiveDay - 1;

    const date = new Date(LUNAR_ANCHOR_UTC + offset * MS_PER_DAY);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function getCurrentYearLunarToSolar(lunarMonth: number, lunarDay: number): string | null {
    return lunarToSolar(new Date().getFullYear(), lunarMonth, lunarDay);
}

export function parseLunarDateText(_text: string): { month: number; day: number; year?: number } | null {
    return null;
}

export function formatLunarMonth(month: number): string {
    const lunarMonths = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
    return lunarMonths[month] || `${month}月`;
}

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
