export interface LinkedTaskPomodoroDayStats {
    count: number;
    focusMinutes: number;
}

export interface LinkedHabitPomodoroBuildResult {
    statsByHabit: Map<string, Map<string, LinkedTaskPomodoroDayStats>>;
    taskHabitMap: Map<string, string>;
    taskIdsByHabit: Map<string, Set<string>>;
}

const DATE_SUFFIX_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSessionCount(session: any): number {
    if (typeof session?.count === "number" && Number.isFinite(session.count)) {
        return Math.max(1, Math.round(session.count));
    }
    return 1;
}

export function buildLinkedHabitTaskMaps(reminderData: Record<string, any>): {
    taskHabitMap: Map<string, string>;
    taskIdsByHabit: Map<string, Set<string>>;
} {
    const taskHabitMap = new Map<string, string>();
    const taskIdsByHabit = new Map<string, Set<string>>();

    for (const reminder of Object.values(reminderData || {})) {
        if (!reminder || !reminder.id || !reminder.linkedHabitId) continue;
        if (!reminder.linkedHabitSyncPomodoroToday) continue;

        const reminderId = String(reminder.id);
        const habitId = String(reminder.linkedHabitId);
        taskHabitMap.set(reminderId, habitId);

        if (!taskIdsByHabit.has(habitId)) {
            taskIdsByHabit.set(habitId, new Set<string>());
        }
        taskIdsByHabit.get(habitId)!.add(reminderId);
    }

    return { taskHabitMap, taskIdsByHabit };
}

export function resolveLinkedHabitIdForSession(eventId: string, taskHabitMap: Map<string, string>): string | undefined {
    if (!eventId) return undefined;

    const direct = taskHabitMap.get(eventId);
    if (direct) return direct;

    const lastUnderscoreIndex = eventId.lastIndexOf("_");
    if (lastUnderscoreIndex <= 0) return undefined;

    const suffix = eventId.substring(lastUnderscoreIndex + 1);
    if (!DATE_SUFFIX_PATTERN.test(suffix)) return undefined;

    const originalId = eventId.substring(0, lastUnderscoreIndex);
    return taskHabitMap.get(originalId);
}

export function resolveLinkedSourceTaskIdForSession(eventId: string, taskHabitMap: Map<string, string>): string | undefined {
    if (!eventId) return undefined;
    if (taskHabitMap.has(eventId)) return eventId;

    const lastUnderscoreIndex = eventId.lastIndexOf("_");
    if (lastUnderscoreIndex <= 0) return undefined;

    const suffix = eventId.substring(lastUnderscoreIndex + 1);
    if (!DATE_SUFFIX_PATTERN.test(suffix)) return undefined;

    const originalId = eventId.substring(0, lastUnderscoreIndex);
    return taskHabitMap.has(originalId) ? originalId : undefined;
}

export function buildLinkedHabitPomodoroData(
    reminderData: Record<string, any>,
    records: Record<string, any>,
    calculateSessionCount?: (session: any) => number
): LinkedHabitPomodoroBuildResult {
    const { taskHabitMap, taskIdsByHabit } = buildLinkedHabitTaskMaps(reminderData || {});
    const statsByHabit = new Map<string, Map<string, LinkedTaskPomodoroDayStats>>();

    if (taskHabitMap.size === 0) {
        return { statsByHabit, taskHabitMap, taskIdsByHabit };
    }

    const countResolver = calculateSessionCount || normalizeSessionCount;

    for (const [date, record] of Object.entries(records || {})) {
        const sessions = Array.isArray((record as any)?.sessions) ? (record as any).sessions : [];

        for (const session of sessions) {
            if (!session || session.type !== "work" || !session.eventId) continue;

            const habitId = resolveLinkedHabitIdForSession(session.eventId, taskHabitMap);
            if (!habitId) continue;

            if (!statsByHabit.has(habitId)) {
                statsByHabit.set(habitId, new Map<string, LinkedTaskPomodoroDayStats>());
            }
            const byDate = statsByHabit.get(habitId)!;
            const current = byDate.get(date) || { count: 0, focusMinutes: 0 };

            current.count += Math.max(0, Number(countResolver(session)) || 0);
            current.focusMinutes += Math.max(0, Number(session.duration) || 0);

            byDate.set(date, current);
        }
    }

    return { statsByHabit, taskHabitMap, taskIdsByHabit };
}

export function getLinkedTaskPomodoroStatsByDate(
    statsByHabit: Map<string, Map<string, LinkedTaskPomodoroDayStats>>,
    habitId: string,
    date: string
): LinkedTaskPomodoroDayStats {
    const habitStats = statsByHabit.get(habitId);
    if (!habitStats) return { count: 0, focusMinutes: 0 };
    return habitStats.get(date) || { count: 0, focusMinutes: 0 };
}

export function getLinkedTaskPomodoroTotalStats(
    statsByHabit: Map<string, Map<string, LinkedTaskPomodoroDayStats>>,
    habitId: string
): LinkedTaskPomodoroDayStats {
    const habitStats = statsByHabit.get(habitId);
    if (!habitStats) return { count: 0, focusMinutes: 0 };

    let count = 0;
    let focusMinutes = 0;
    habitStats.forEach((stats) => {
        count += stats.count || 0;
        focusMinutes += stats.focusMinutes || 0;
    });

    return { count, focusMinutes };
}

export function getLinkedTaskIdsForHabit(
    taskIdsByHabit: Map<string, Set<string>>,
    habitId: string
): string[] {
    const set = taskIdsByHabit.get(habitId);
    if (!set || set.size === 0) return [];
    return Array.from(set);
}

export function isEventIdFromTaskWithInstances(eventId: string, taskIdSet: Set<string>): boolean {
    if (!eventId || taskIdSet.size === 0) return false;
    if (taskIdSet.has(eventId)) return true;

    const lastUnderscoreIndex = eventId.lastIndexOf("_");
    if (lastUnderscoreIndex <= 0) return false;
    const suffix = eventId.substring(lastUnderscoreIndex + 1);
    if (!DATE_SUFFIX_PATTERN.test(suffix)) return false;

    const originalId = eventId.substring(0, lastUnderscoreIndex);
    return taskIdSet.has(originalId);
}
