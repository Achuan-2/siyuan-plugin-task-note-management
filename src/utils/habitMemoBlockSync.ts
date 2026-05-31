import { appendBlock, deleteBlock, setBlockAttrs, updateBlock } from "../api";
import { getPluginInstance } from "../pluginInstance";
import { normalizeHabitMemoTimestamp, renderHabitMemoSyncTemplate } from "./habitMemoTemplate";
import type { Habit, HabitCheckInEntry, HabitEmojiConfig } from "./habitUtils";


export type HabitMemoCheckInEntry = HabitCheckInEntry & {
    memoBlockId?: string;
    memoSyncKey?: string;
};

export type HabitMemoEmojiConfig = HabitEmojiConfig & {
    syncMemoToBlock?: boolean;
    memoBlockId?: string;
};

type HabitMemoSyncMode = "none" | "checkin" | "note";

type SyncHabitMemoBlockOptions = {
    habit: Habit;
    entry: HabitMemoCheckInEntry;
    emojiConfig?: HabitMemoEmojiConfig;
    previousEntry?: HabitMemoCheckInEntry;
};

function getCleanText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function createMemoSyncKey(habit: Habit, entry: HabitMemoCheckInEntry): string {
    if (entry.memoSyncKey) return entry.memoSyncKey;
    const random = Math.random().toString(36).slice(2, 8);
    return `${habit.id || "habit"}:${entry.timestamp || ""}:${entry.emoji || ""}:${Date.now()}:${random}`;
}

async function getHabitMemoSyncTemplate(): Promise<string | undefined> {
    try {
        const plugin = getPluginInstance();
        if (!plugin || typeof plugin.loadSettings !== "function") return undefined;
        const settings = await plugin.loadSettings();
        return typeof settings?.habitMemoSyncTemplate === "string"
            ? settings.habitMemoSyncTemplate
            : undefined;
    } catch (error) {
        console.warn("读取习惯打卡同步块模板失败:", error);
        return undefined;
    }
}

async function setHabitMemoAttrs(blockId: string, habit: Habit, entry: HabitMemoCheckInEntry) {
    const syncData = {
        id: habit.id || "",
        title: habit.title || "",
        timestamp: normalizeHabitMemoTimestamp(entry.timestamp),
        status: entry.emoji || "",
    };
    await setBlockAttrs(blockId, {
        "custom-tasknote-habit-sync": JSON.stringify(syncData),
    });
}

export async function syncHabitMemoBlock(options: SyncHabitMemoBlockOptions): Promise<void> {
    const { habit, entry, emojiConfig, previousEntry } = options;
    const note = getCleanText(entry.note);
    const existingBlockId = getCleanText(entry.memoBlockId) || getCleanText(previousEntry?.memoBlockId);
    const savedMode = getCleanText((habit as any).habitMemoSyncMode);
    const mode = (savedMode || (emojiConfig?.syncMemoToBlock === true ? "note" : "none")) as HabitMemoSyncMode;
    const shouldSync = mode === "checkin" || (mode === "note" && !!note);

    if (!shouldSync) {
        if (existingBlockId) {
            try {
                await deleteBlock(existingBlockId);
            } catch (error) {
                console.warn("删除习惯打卡备注同步块失败:", error);
            }
        }
        delete entry.memoBlockId;
        delete entry.memoSyncKey;
        return;
    }

    const targetBlockId = getCleanText(emojiConfig?.memoBlockId) || getCleanText((habit as any).habitMemoBlockId);
    const shouldUpdateExisting = !!existingBlockId;
    if (!targetBlockId && !shouldUpdateExisting) return;

    entry.memoSyncKey = entry.memoSyncKey || previousEntry?.memoSyncKey || createMemoSyncKey(habit, entry);
    const markdown = renderHabitMemoSyncTemplate(await getHabitMemoSyncTemplate(), habit, entry);

    try {
        if (existingBlockId) {
            await updateBlock("markdown", markdown, existingBlockId);
            entry.memoBlockId = existingBlockId;
            await setHabitMemoAttrs(existingBlockId, habit, entry);
            return;
        }

        const response = await appendBlock("markdown", markdown, targetBlockId);
        const createdBlockId = response?.[0]?.doOperations?.[0]?.id;
        if (!createdBlockId) return;

        entry.memoBlockId = createdBlockId;
        await setHabitMemoAttrs(createdBlockId, habit, entry);
    } catch (error) {
        console.warn("同步习惯打卡备注到块失败:", error);
    }
}

export async function deleteHabitMemoBlockForEntry(entry?: HabitMemoCheckInEntry | null): Promise<void> {
    const blockId = getCleanText(entry?.memoBlockId);
    if (!blockId) return;
    try {
        await deleteBlock(blockId);
    } catch (error) {
        console.warn("删除习惯打卡备注同步块失败:", error);
    }
}
