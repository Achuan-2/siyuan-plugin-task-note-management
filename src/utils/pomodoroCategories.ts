import type { PomodoroDaySummary } from './pomodoroStore';

export interface PomodoroCategory { id: string; name: string; color: string; }
export const POMODORO_CATEGORIES_FILE = 'pomodoro_categories.json';
export const POMODORO_CATEGORIES_UPDATED = 'pomodoroCategoriesUpdated';

export function normalizePomodoroCategoryId(value?: string): string | undefined {
    return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export async function loadPomodoroCategories(plugin: any): Promise<PomodoroCategory[]> {
    const data = await plugin.loadData(POMODORO_CATEGORIES_FILE);
    // SiYuan's frontend SDK resolves missing files to its initial cache value, ''.
    if (data == null || data === '') return [];
    if (!Array.isArray(data) || data.some(item => !item || typeof item.id !== 'string' || !item.id
        || typeof item.name !== 'string' || !item.name.trim() || !/^#[\da-f]{6}$/i.test(item.color))
        || new Set(data.map(item => item.id)).size !== data.length) {
        throw new Error('Invalid pomodoro categories');
    }
    return data.map(item => ({ id: item.id, name: item.name, color: item.color }));
}

const writes = new WeakMap<object, Promise<unknown>>();
/** Read the latest list inside the queue so concurrent editors preserve other categories. */
export function changePomodoroCategories(plugin: any, change: (categories: PomodoroCategory[]) => PomodoroCategory[]) {
    const pending = (writes.get(plugin) || Promise.resolve()).then(async () => {
        const categories = change(await loadPomodoroCategories(plugin));
        await plugin.saveData(POMODORO_CATEGORIES_FILE, categories);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(POMODORO_CATEGORIES_UPDATED));
        return categories;
    });
    writes.set(plugin, pending.catch(() => {}));
    return pending;
}

export function getPomodoroCategoryStats(days: PomodoroDaySummary[], categories: PomodoroCategory[], type: 'work' | 'break') {
    const available = new Set(categories.map(category => category.id));
    const result: Record<string, { time: number; count: number }> = Object.create(null);
    const add = (id: string, time: number, count: number) => {
        const value = result[id] ||= { time: 0, count: 0 };
        value.time += time;
        value.count += count;
    };
    for (const day of days) {
        let time = 0, count = 0;
        for (const [id, value] of Object.entries(type === 'work' ? day.workByCategory : day.breakByCategory)) {
            add(available.has(id) ? id : '', value.duration, value.count);
            time += value.duration;
            count += value.count;
        }
        // Old records containing balances but no session details remain visible as uncategorized.
        const remainder = (type === 'work' ? day.totalWorkTime : day.totalBreakTime) - time;
        const countRemainder = type === 'work' ? day.workSessions - count : 0;
        if (remainder > 0 || countRemainder > 0) add('', Math.max(0, remainder), Math.max(0, countRemainder));
    }
    return result;
}
