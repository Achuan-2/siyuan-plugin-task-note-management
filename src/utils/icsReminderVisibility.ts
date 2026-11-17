export type IcsTaskFilter = 'all' | 'completed' | 'uncompleted';
export type IcsReminderVisibility = 'all' | 'hideCompleted' | 'none';

export function getIcsReminderVisibility(settings: any): IcsReminderVisibility {
    if (['all', 'hideCompleted', 'none'].includes(settings?.icsReminderVisibility)) {
        return settings.icsReminderVisibility;
    }
    // Read the earlier two-checkbox settings before applying the new default.
    if (settings?.icsHideAllReminderEvents === true) return 'none';
    return settings?.icsHideCompletedReminderEvents === false ? 'all' : 'hideCompleted';
}

function dateKey(parts: number[]): string {
    return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
}

function parseDate(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const result = new Date(`${value}T00:00:00`);
    return !isNaN(result.getTime()) && dateKey([result.getFullYear(), result.getMonth() + 1, result.getDate()]) === value ? result : null;
}

function shiftDay(value: string, offset: number): string {
    const date = parseDate(value)!;
    date.setDate(date.getDate() + offset);
    return dateKey([date.getFullYear(), date.getMonth() + 1, date.getDate()]);
}

function includeCompleted(filter: IcsTaskFilter, settings: any): boolean {
    return filter !== 'uncompleted' && getIcsReminderVisibility(settings) === 'all';
}

/** Completion dates are finite even for an open-ended daily reminder; use EXDATE instead of expanding it. */
function completedDates(reminder: any, everyDay: boolean, startDate: string): Set<string> {
    const dates = new Set<string>();
    for (const [date, completed] of Object.entries(reminder.dailyCompletions || {})) {
        if (completed === true && parseDate(date)) dates.add(date);
    }
    for (const [originalDate, rawState] of Object.entries(reminder.repeat?.instances || {})) {
        const state = rawState as any;
        if (!state?.completed || state.deleted || state.date === null || !parseDate(originalDate)) continue;
        const actualDate = state.date || originalDate;
        if (!parseDate(actualDate)) continue;
        if (everyDay) {
            const end = state.endDate || (reminder.date && reminder.endDate
                ? shiftDay(actualDate, Math.round((Date.parse(`${reminder.endDate}T00:00:00Z`) - Date.parse(`${reminder.date}T00:00:00Z`)) / 86400000))
                : actualDate);
            if (!parseDate(end)) continue;
            for (let date = actualDate; date <= end; date = shiftDay(date, 1)) dates.add(date);
        } else if (originalDate === reminder.date || actualDate === reminder.date || actualDate === startDate) {
            // A dated/relative reminder belongs to the task occurrence, even when it fires a day earlier.
            dates.add(startDate);
        }
    }
    return dates;
}

function cloneOccurrence(event: any, date: string): any {
    const dateParts = date.split('-').map(Number);
    const end = new Date(event.end[0], event.end[1] - 1, event.end[2], event.end[3], event.end[4]);
    const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dateKey(event.start)}T00:00:00Z`)) / 86400000);
    end.setDate(end.getDate() + offset);
    const copy = { ...event, start: [...dateParts, ...event.start.slice(3)],
        end: [end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes()], status: 'CONFIRMED' };
    delete copy.recurrenceRule;
    delete copy.exclusionDates;
    delete copy.alarms;
    return copy;
}

/** Filters only the independent ⏰ VEVENTs; task events and their existing alarms stay unchanged. */
export function filterIcsReminderEvent(event: any, reminder: any, everyDay: boolean, filter: IcsTaskFilter, settings: any,
    range: { start: string; end: string } | null = null): any[] {
    if (getIcsReminderVisibility(settings) === 'none' || reminder.hideInCalendar) return [];
    const showCompleted = includeCompleted(filter, settings);
    if (reminder.completed) {
        if (!showCompleted) return [];
        const copy = { ...event, status: 'CONFIRMED' };
        delete copy.alarms;
        return [copy];
    }

    const firstDate = dateKey(event.start);
    const completed = completedDates(reminder, everyDay, firstDate);
    if (!everyDay) {
        if (completed.has(firstDate)) {
            if (!showCompleted) return [];
            const copy = { ...event, status: 'CONFIRMED' };
            delete copy.alarms;
            return [copy];
        }
        return filter === 'completed' ? [] : [event];
    }

    const lastDate = reminder.date && reminder.endDate ? reminder.endDate : undefined;
    const completedInSeries = [...completed].filter(date => date >= firstDate && (!lastDate || date <= lastDate)).sort();
    if (filter === 'completed') {
        if (!showCompleted) return [];
        return completedInSeries.filter(date => !range || date >= range.start && date <= range.end).map((date, index) => ({ ...cloneOccurrence(event, date),
            uid: index === 0 ? event.uid : `${event.uid}-completed-${date}` }));
    }
    if (!showCompleted) {
        return [{ ...event, ...(completedInSeries.length ? {
            exclusionDates: [...(event.exclusionDates || []), ...completedInSeries.map(date => [...date.split('-').map(Number), ...event.start.slice(3)])],
        } : {}) }];
    }
    // Show completed reminders as history without allowing their embedded alarm to fire again.
    return [event, ...completedInSeries.map(date => ({ ...cloneOccurrence(event, date),
        recurrenceId: [...date.split('-').map(Number), ...event.start.slice(3)] }))];
}
