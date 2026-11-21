import type { SortCriterion } from './sortConfig';

interface SortableTask {
    id?: string;
    title?: string;
    priority?: string;
    date?: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    createdTime?: string;
    createdAt?: string;
}

function compareDates(a: SortableTask, b: SortableTask, byEndDate: boolean): number {
    const dateA = byEndDate ? a.endDate || a.date : a.date;
    const dateB = byEndDate ? b.endDate || b.date : b.date;
    if (!dateA || !dateB) return Number(!dateA) - Number(!dateB);

    const timeA = byEndDate && a.endDate ? a.endTime || a.time : a.time;
    const timeB = byEndDate && b.endDate ? b.endTime || b.time : b.time;
    const timestampA = new Date(`${dateA}T${timeA || '00:00'}`).getTime();
    const timestampB = new Date(`${dateB}T${timeB || '00:00'}`).getTime();
    if (isNaN(timestampA) || isNaN(timestampB)) {
        return Number(isNaN(timestampA)) - Number(isNaN(timestampB));
    }
    if (timestampA !== timestampB) return timestampA - timestampB;

    const spanningA = !!(a.endDate && a.date && a.endDate !== a.date);
    const spanningB = !!(b.endDate && b.date && b.endDate !== b.date);
    if (spanningA !== spanningB) return Number(spanningB) - Number(spanningA);
    return spanningA ? 0 : Number(!timeA) - Number(!timeB);
}

export function compareTaskCreatedTime(a: SortableTask, b: SortableTask): number {
    return new Date(a.createdTime || a.createdAt || 0).getTime()
        - new Date(b.createdTime || b.createdAt || 0).getTime();
}

const PRIORITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

/** 比较单个字段，项目与分类等依赖视图数据的条件由调用方提供。 */
export function compareTaskFields(a: SortableTask, b: SortableTask, criterion: SortCriterion): number {
    const direction = criterion.order === 'desc' ? -1 : 1;
    switch (criterion.method) {
        case 'time':
        case 'startDate': {
            const datePresence = Number(!(a.date || a.endDate)) - Number(!(b.date || b.endDate));
            return direction * (datePresence || compareDates(a, b, false));
        }
        case 'endDate':
            return direction * compareDates(a, b, true);
        case 'priority':
            return direction * ((PRIORITY_ORDER[a.priority] || 0) - (PRIORITY_ORDER[b.priority] || 0));
        case 'title':
            return direction * (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase(), 'zh-CN');
        case 'created':
            return direction * compareTaskCreatedTime(a, b);
        default:
            return 0;
    }
}

export function compareTaskCategories(a: string, b: string, categoryOrder: ReadonlyMap<string, number>): number {
    const getOrder = (value: string) => {
        const ids = String(value || '').split(',').map(id => id.trim()).filter(Boolean);
        const bestOrder = ids.reduce((best, id) => Math.min(best, categoryOrder.get(id) ?? Infinity), Infinity);
        if (Number.isFinite(bestOrder)) return bestOrder;
        return ids[0] && ids[0] !== 'none' ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
    };
    return getOrder(a) - getOrder(b);
}

export function compareTaskCompletedTime(
    a: SortableTask, b: SortableTask, completedA: string, completedB: string, order: SortCriterion['order'],
): number {
    const direction = order === 'desc' ? -1 : 1;
    if (completedA && completedB) {
        return direction * (new Date(completedA).getTime() - new Date(completedB).getTime());
    }
    if (completedA || completedB) return completedA ? -1 : 1;

    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date && b.date) {
        const dateDiff = new Date(`${a.date}T${a.time || '00:00'}`).getTime()
            - new Date(`${b.date}T${b.time || '00:00'}`).getTime();
        if (dateDiff) return direction * dateDiff;
    }
    const createdDiff = compareTaskCreatedTime(a, b);
    return createdDiff !== 0 ? direction * createdDiff : (a.id || '').localeCompare(b.id || '');
}
