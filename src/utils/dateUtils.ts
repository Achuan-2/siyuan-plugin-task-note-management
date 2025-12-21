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

function getDayStartAdjustedDate(date: Date): Date {
    if (!dayStartMinutes) return date;
    return new Date(date.getTime() - dayStartMinutes * 60 * 1000);
}

export function setDayStartTime(value?: string | number): void {
    dayStartMinutes = parseTimeToMinutes(value);
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
 */
export function compareDateStrings(date1: string, date2: string): number {
    if (date1 < date2) return -1;
    if (date1 > date2) return 1;
    return 0;
}
