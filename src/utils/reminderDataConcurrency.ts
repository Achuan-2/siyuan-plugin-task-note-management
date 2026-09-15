import type { ReminderData } from "../types/reminder";

export interface ReminderDataConflict {
    reminderId: string;
    field?: string;
    reason: "created" | "deleted" | "updated";
}

export interface ReminderDataMergeResult {
    data: ReminderData;
    conflicts: ReminderDataConflict[];
    changed: boolean;
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function cloneReminderData(data: ReminderData | null | undefined): ReminderData {
    if (!data || typeof data !== "object") return {};
    return JSON.parse(JSON.stringify(data));
}

export function reminderValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (typeof left !== typeof right || left === null || right === null) return false;

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((item, index) => reminderValuesEqual(item, right[index]));
    }

    if (typeof left !== "object" || typeof right !== "object") return false;
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject);
    const rightKeys = Object.keys(rightObject);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every((key) =>
        hasOwn(rightObject, key) && reminderValuesEqual(leftObject[key], rightObject[key])
    );
}

export function createNextReminderUpdatedAt(previous?: string): string {
    const previousTime = previous ? Date.parse(previous) : Number.NaN;
    const nextTime = Number.isFinite(previousTime)
        ? Math.max(Date.now(), previousTime + 1)
        : Date.now();
    return new Date(nextTime).toISOString();
}

/**
 * 将界面从 base 修改到 desired 的字段级差异应用到最新数据 latest。
 * 不同任务、不同字段可自动合并；同一字段发生双向修改时报告冲突。
 */
export function mergeReminderDataChanges(
    baseInput: ReminderData | null | undefined,
    desiredInput: ReminderData | null | undefined,
    latestInput: ReminderData | null | undefined,
): ReminderDataMergeResult {
    const base = cloneReminderData(baseInput);
    const desired = cloneReminderData(desiredInput);
    const latest = cloneReminderData(latestInput);
    const merged = cloneReminderData(latest);
    const conflicts: ReminderDataConflict[] = [];
    let changed = false;

    const reminderIds = new Set([...Object.keys(base), ...Object.keys(desired)]);
    for (const reminderId of reminderIds) {
        const baseHas = hasOwn(base, reminderId);
        const desiredHas = hasOwn(desired, reminderId);
        const latestHas = hasOwn(latest, reminderId);

        if (!baseHas && desiredHas) {
            if (!latestHas) {
                merged[reminderId] = desired[reminderId];
                changed = true;
            } else if (!reminderValuesEqual(latest[reminderId], desired[reminderId])) {
                conflicts.push({ reminderId, reason: "created" });
            }
            continue;
        }

        if (baseHas && !desiredHas) {
            if (!latestHas) continue;
            if (reminderValuesEqual(latest[reminderId], base[reminderId])) {
                delete merged[reminderId];
                changed = true;
            } else {
                conflicts.push({ reminderId, reason: "deleted" });
            }
            continue;
        }

        if (!baseHas || !desiredHas || reminderValuesEqual(base[reminderId], desired[reminderId])) {
            continue;
        }
        if (!latestHas) {
            conflicts.push({ reminderId, reason: "deleted" });
            continue;
        }

        const baseReminder = base[reminderId] as unknown as Record<string, unknown>;
        const desiredReminder = desired[reminderId] as unknown as Record<string, unknown>;
        const latestReminder = latest[reminderId] as unknown as Record<string, unknown>;
        const mergedReminder = merged[reminderId] as unknown as Record<string, unknown>;
        const fields = new Set([...Object.keys(baseReminder), ...Object.keys(desiredReminder)]);
        let reminderChanged = false;

        for (const field of fields) {
            // 更新时间由合并入口统一生成，不能因为双方都更新它而制造伪冲突。
            if (field === "updatedAt") continue;
            const baseFieldHas = hasOwn(baseReminder, field);
            const desiredFieldHas = hasOwn(desiredReminder, field);
            const latestFieldHas = hasOwn(latestReminder, field);
            const baseValue = baseReminder[field];
            const desiredValue = desiredReminder[field];

            if (baseFieldHas === desiredFieldHas && reminderValuesEqual(baseValue, desiredValue)) {
                continue;
            }

            const latestStillAtBase = latestFieldHas === baseFieldHas
                && reminderValuesEqual(latestReminder[field], baseValue);
            const latestAlreadyAtDesired = latestFieldHas === desiredFieldHas
                && reminderValuesEqual(latestReminder[field], desiredValue);

            if (!latestStillAtBase && !latestAlreadyAtDesired) {
                conflicts.push({ reminderId, field, reason: "updated" });
                continue;
            }
            if (latestAlreadyAtDesired) continue;

            if (desiredFieldHas) {
                mergedReminder[field] = desiredValue;
            } else {
                delete mergedReminder[field];
            }
            changed = true;
            reminderChanged = true;
        }

        if (reminderChanged) {
            mergedReminder.updatedAt = createNextReminderUpdatedAt(
                typeof latestReminder.updatedAt === "string" ? latestReminder.updatedAt : undefined,
            );
        }
    }

    return { data: merged, conflicts, changed };
}

export function formatReminderDataConflicts(conflicts: ReminderDataConflict[]): string {
    const locations = conflicts.slice(0, 5).map((conflict) =>
        conflict.field ? `${conflict.reminderId}.${conflict.field}` : conflict.reminderId
    );
    const suffix = conflicts.length > locations.length ? ` 等 ${conflicts.length} 处` : "";
    return `任务数据已被其他操作修改，存在冲突：${locations.join("、")}${suffix}`;
}
