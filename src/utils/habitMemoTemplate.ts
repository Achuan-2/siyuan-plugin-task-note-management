import type { Habit, HabitCheckInEntry } from "./habitUtils";

export const DEFAULT_HABIT_MEMO_SYNC_TEMPLATE = `- \${date} \${time} 习惯名：\${habitName}，打卡情况：\${habitCheckinEmoji}

    - 备注：\${habitMemo}`;

type HabitMemoTemplateValues = Record<string, string>;

function getCleanText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function normalizeHabitMemoTimestamp(timestamp?: string): string {
    const raw = getCleanText(timestamp);
    if (!raw) return "";
    const normalized = raw.replace("T", " ");
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    if (match) return `${match[1]} ${match[2]}`;
    return normalized;
}

function getTimestampParts(timestamp?: string): { dateTime: string; date: string; time: string } {
    const dateTime = normalizeHabitMemoTimestamp(timestamp);
    const match = dateTime.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
    return {
        dateTime,
        date: match?.[1] || "",
        time: match?.[2] || "",
    };
}

function createTemplateValues(habit: Habit, entry: HabitCheckInEntry): HabitMemoTemplateValues {
    const { dateTime, date, time } = getTimestampParts(entry.timestamp);
    const habitName = habit.title || "未命名习惯";
    const checkInEmoji = entry.emoji || "";
    const checkInMeaning = entry.meaning || "";
    const memo = getCleanText(entry.note);
    const status = checkInEmoji || checkInMeaning || "";

    return {
        dateTime,
        timestamp: dateTime,
        date,
        time,
        habitId: habit.id || "",
        habitName,
        habitTitle: habitName,
        habitCheckinEmoji: checkInEmoji,
        habitCheckInEmoji: checkInEmoji,
        habitEmoji: checkInEmoji,
        emoji: checkInEmoji,
        habitCheckinMeaning: checkInMeaning,
        habitCheckInMeaning: checkInMeaning,
        habitCheckinStatus: status,
        habitCheckInStatus: status,
        status,
        habitMemo: memo,
        habitCheckinMemo: memo,
        habitCheckInMemo: memo,
        memo,
        note: memo,
    };
}

function removeEmptyMemoLines(template: string, memo: string): string {
    if (memo) return template;
    const memoVariablePattern = /\$\{(?:habitMemo|habitCheckinMemo|habitCheckInMemo|memo|note)\}|\$(?:habitMemo|habitCheckinMemo|habitCheckInMemo|memo|note)\}/g;
    return template
        .split(/\r?\n/)
        .filter(line => {
            memoVariablePattern.lastIndex = 0;
            if (!memoVariablePattern.test(line)) return true;
            const withoutMemoPart = line
                .replace(memoVariablePattern, "")
                .replace(/备注\s*[:：]?|memo\s*[:：]?|note\s*[:：]?/gi, "")
                .replace(/[-*+\s]/g, "");
            return !!withoutMemoPart;
        })
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
}

export function renderHabitMemoSyncTemplate(
    template: string | undefined,
    habit: Habit,
    entry: HabitCheckInEntry
): string {
    const values = createTemplateValues(habit, entry);
    const rawTemplate = getCleanText(template) || DEFAULT_HABIT_MEMO_SYNC_TEMPLATE;
    const templateWithoutEmptyMemo = removeEmptyMemoLines(rawTemplate, values.habitMemo);
    const rendered = templateWithoutEmptyMemo
        .replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match, key) => values[key] ?? "")
        .replace(/\$(habitMemo|habitCheckinMemo|habitCheckInMemo|memo|note)\}/g, (_match, key) => values[key] ?? "");

    if (rendered.trim()) return rendered;
    return renderHabitMemoSyncTemplate(DEFAULT_HABIT_MEMO_SYNC_TEMPLATE, habit, entry);
}
