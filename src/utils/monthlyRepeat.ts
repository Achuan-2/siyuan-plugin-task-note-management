export type MonthlyRepeatMode = 'date' | 'weekday';
export type MonthlyWeekOrder = 1 | 2 | 3 | 4 | 5 | -1;

export interface MonthlyWeekRule {
    order: MonthlyWeekOrder;
    weekday: number;
}

export interface MonthlyRepeatFields {
    monthlyRepeatMode?: MonthlyRepeatMode;
    monthlyWeekRules?: MonthlyWeekRule[];
    monthlyWeekOrder?: MonthlyWeekOrder;
    monthlyWeekday?: number;
}

// 习惯和重复任务共用规则归一化及日期计算，避免两种入口产生不同日期。
export function getMonthlyWeekRules(config: MonthlyRepeatFields): MonthlyWeekRule[] {
    if (config?.monthlyRepeatMode !== 'weekday') return [];

    const rules: MonthlyWeekRule[] = [];
    const seen = new Set<string>();
    const appendRule = (orderValue: unknown, weekdayValue: unknown) => {
        const order = Number(orderValue);
        const weekday = Number(weekdayValue);
        if (!Number.isInteger(order) || !(order === -1 || (order >= 1 && order <= 5)) ||
            !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return;
        const key = `${order}:${weekday}`;
        if (seen.has(key)) return;
        seen.add(key);
        rules.push({ order: order as MonthlyWeekOrder, weekday });
    };

    if (Array.isArray(config.monthlyWeekRules)) {
        config.monthlyWeekRules.forEach(rule => appendRule(rule?.order, rule?.weekday));
    }
    if (rules.length === 0) appendRule(config.monthlyWeekOrder, config.monthlyWeekday);

    const rank = (rule: MonthlyWeekRule) => (rule.order === -1 ? 6 : rule.order) * 10 +
        (rule.weekday === 0 ? 7 : rule.weekday);
    return rules.sort((a, b) => rank(a) - rank(b));
}

// month 使用 Date 的 0..11；当月不存在第五个星期几时返回 null。
export function getMonthlyWeekdayDate(year: number, month: number, order: number, weekday: number): number | null {
    if (!Number.isInteger(order) || !(order === -1 || (order >= 1 && order <= 5)) ||
        !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;

    const lastDay = new Date(year, month + 1, 0).getDate();
    if (order === -1) {
        const daysBack = (new Date(year, month, lastDay).getDay() - weekday + 7) % 7;
        return lastDay - daysBack;
    }
    const daysToFirst = (weekday - new Date(year, month, 1).getDay() + 7) % 7;
    const targetDay = 1 + daysToFirst + (order - 1) * 7;
    return targetDay <= lastDay ? targetDay : null;
}
