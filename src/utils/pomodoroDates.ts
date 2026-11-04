import type { PomodoroSession } from '../components/dataManager/pomodoroRecord';

function localWallTime(session: Pick<PomodoroSession, 'startTime' | 'timezoneOffsetMinutes'>): number {
    const date = new Date(session.startTime);
    const offset = Number.isFinite(session.timezoneOffsetMinutes) ? session.timezoneOffsetMinutes : date.getTimezoneOffset();
    return date.getTime() - offset * 60000;
}

/** 按记录开始时的本地自然日分片，与用户的一天起始时间无关。 */
export function getPomodoroCalendarDate(session: Pick<PomodoroSession, 'startTime' | 'timezoneOffsetMinutes'>, fallback: string): string {
    const wallTime = localWallTime(session);
    return Number.isFinite(wallTime) ? new Date(wallTime).toISOString().slice(0, 10) : fallback;
}

export function getPomodoroLogicalDate(session: PomodoroSession, fallback: string, dayStartMinutes: number): string {
    const wallTime = localWallTime(session);
    return Number.isFinite(wallTime) ? new Date(wallTime - dayStartMinutes * 60000).toISOString().slice(0, 10) : fallback;
}

export function attachPomodoroStorageMetadata(session: PomodoroSession, storageDate: string): PomodoroSession {
    const date = new Date(session.startTime);
    const end = new Date(session.endTime);
    // 无时区字符串先按当前设备解析，再存为绝对时间；否则换设备后偏移元数据无法稳定日期。
    return { ...session, storageDate,
        startTime: Number.isFinite(date.getTime()) ? date.toISOString() : session.startTime,
        endTime: Number.isFinite(end.getTime()) ? end.toISOString() : session.endTime,
        timezoneOffsetMinutes: Number.isFinite(session.timezoneOffsetMinutes) ? session.timezoneOffsetMinutes : date.getTimezoneOffset() };
}
