import {
    addAssetCleanupIgnore,
    extractNoteAssetPaths,
    reconcileRemovedTaskAssets,
    type AssetCleanupApiPost,
} from "./assetCleanupIgnore";

export const TASK_NOTES_DIR = "notes";
const MAX_NOTE_CACHE_SIZE = 200;
const NOTE_SUMMARY_MAX_LENGTH = 120;

export interface TaskNoteMetadata {
    notes: boolean;
    noteSummary?: string;
    noteAssets?: string[];
}

export interface ResolvedTaskNoteRef {
    hasNote: boolean;
    noteId: string;
    fallbackNoteId?: string;
    inlineNote?: string;
    summary: string;
    assets: string[];
}

// 有界 LRU 缓存，避免大量任务备注常驻内存
const noteContentCache = new Map<string, string>();
const noteInFlightLoads = new Map<string, Promise<string>>();
const noteRevisionMap = new Map<string, number>();

function touchCache(noteId: string, content: string): void {
    if (noteContentCache.has(noteId)) {
        noteContentCache.delete(noteId);
    }
    noteContentCache.set(noteId, content);
    if (noteContentCache.size > MAX_NOTE_CACHE_SIZE) {
        const oldestKey = noteContentCache.keys().next().value;
        if (oldestKey !== undefined) {
            noteContentCache.delete(oldestKey);
        }
    }
}

export function bumpTaskNoteRevision(noteId: string): number {
    const next = (noteRevisionMap.get(noteId) || 0) + 1;
    noteRevisionMap.set(noteId, next);
    return next;
}

export function getTaskNoteRevision(noteId: string): number {
    return noteRevisionMap.get(noteId) || 0;
}

export function getCachedTaskNote(noteId: string): string | undefined {
    if (!noteId) return undefined;
    const cached = noteContentCache.get(noteId);
    if (cached !== undefined) {
        touchCache(noteId, cached);
    }
    return cached;
}

export function setCachedTaskNote(noteId: string, content: string): void {
    if (!noteId) return;
    touchCache(noteId, content);
    bumpTaskNoteRevision(noteId);
}

export function invalidateTaskNoteCache(noteId?: string): void {
    if (!noteId) {
        noteContentCache.clear();
        noteInFlightLoads.clear();
        for (const key of noteRevisionMap.keys()) {
            noteRevisionMap.set(key, (noteRevisionMap.get(key) || 0) + 1);
        }
        return;
    }
    noteContentCache.delete(noteId);
    noteInFlightLoads.delete(noteId);
    bumpTaskNoteRevision(noteId);
}

/**
 * 净化任务 ID 用作 `notes/<id>.md` 文件名（常规任务 ID 仅含字母、数字、下划线和连字符，保持原样）。
 */
export function sanitizeTaskNoteId(noteId: string): string {
    return String(noteId || "")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\.{2,}/g, "_");
}

export function getTaskNoteStorageName(noteId: string): string {
    return `${TASK_NOTES_DIR}/${sanitizeTaskNoteId(noteId)}.md`;
}

export function getTaskNoteFullPath(pluginName: string, noteId: string): string {
    return `/data/storage/petal/${pluginName}/${getTaskNoteStorageName(noteId)}`;
}

/**
 * 从 Markdown 生成短摘要，仅保留必要纯文本，存入 reminder.json 用于列表搜索、通知和轻量预览。
 */
export function buildTaskNoteSummary(markdown: string, maxLength = NOTE_SUMMARY_MAX_LENGTH): string {
    if (!markdown || typeof markdown !== "string") return "";
    let text = markdown;
    // 移除思源 Kramdown IAL 属性块 {: ... }
    text = text.replace(/\{:[^}]*\}/g, " ");
    // HTML 图片转占位文本
    text = text.replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_m, alt) => (alt ? `[${alt}]` : "[图片]"));
    text = text.replace(/<img\b[^>]*>/gi, "[图片]");
    // Markdown 图片转占位文本
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt) => (alt ? `[${alt}]` : "[图片]"));
    // Markdown 链接保留显示文本
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // 思源块引用 ((id "text")) 或 ((id 'text')) 保留锚文本
    text = text.replace(/\(\(\s*[0-9]{14}-[a-zA-Z0-9]{7}\s+["']([^"']+)["']\s*\)\)/g, "$1");
    // 去除常见 Markdown 标记与 HTML 标签
    text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, " ").replace(/```/g, " "));
    text = text.replace(/`([^`]+)`/g, "$1");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/^[ \t]*(?:#{1,6}|[-*+]\s+\[[ xX/-]\]|[-*+]|\d+\.|>)\s*/gm, "");
    text = text.replace(/[*_~==]+/g, "");
    text = text.replace(/\u200b/g, "");
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * 构建写入 reminder.json 的备注元数据（notes: true、摘要和资源引用，不包含正文）。
 */
export function buildTaskNoteMetadata(markdown: string): TaskNoteMetadata {
    const trimmed = typeof markdown === "string" ? markdown.trim() : "";
    if (!trimmed) {
        return { notes: false };
    }
    const summary = buildTaskNoteSummary(trimmed);
    const assets = extractNoteAssetPaths(trimmed);
    const meta: TaskNoteMetadata = { notes: true };
    if (summary) meta.noteSummary = summary;
    if (assets.length > 0) meta.noteAssets = assets;
    return meta;
}

/**
 * 将备注元数据应用到任务或重复实例对象上，并移除大文本 `note` 字段。
 */
export function applyTaskNoteMetadata(
    target: Record<string, any>,
    metadata: TaskNoteMetadata,
    options?: { isRepeatInstance?: boolean; parentHasNote?: boolean }
): void {
    if (!target || typeof target !== "object") return;
    delete target.note;
    delete target.noteId;

    if (metadata.notes) {
        target.notes = true;
        if (metadata.noteSummary) target.noteSummary = metadata.noteSummary;
        else delete target.noteSummary;
        if (metadata.noteAssets && metadata.noteAssets.length > 0) target.noteAssets = metadata.noteAssets;
        else delete target.noteAssets;
    } else {
        delete target.noteSummary;
        delete target.noteAssets;
        if (options?.isRepeatInstance && options?.parentHasNote) {
            // 显式清空某个重复实例的备注，阻止其回退继承模板备注
            target.notes = false;
        } else {
            delete target.notes;
        }
    }
}

export function hasTaskNote(task: any): boolean {
    if (!task || typeof task !== "object") return false;
    if (typeof task.note === "string" && task.note.trim().length > 0) return true;
    return task.notes === true;
}

/**
 * 解析任务（含重复实例）的备注引用信息。
 */
export function resolveTaskNoteRef(task: any): ResolvedTaskNoteRef {
    if (!task || typeof task !== "object") {
        return { hasNote: false, noteId: "", summary: "", assets: [] };
    }
    const inlineNote = typeof task.note === "string" && task.note.trim().length > 0 ? task.note : undefined;
    const summary = typeof task.noteSummary === "string" ? task.noteSummary : (inlineNote ? buildTaskNoteSummary(inlineNote) : "");
    const assets = Array.isArray(task.noteAssets)
        ? task.noteAssets.filter((x: unknown): x is string => typeof x === "string" && !!x)
        : (inlineNote ? extractNoteAssetPaths(inlineNote) : []);

    if (inlineNote) {
        return {
            hasNote: true,
            noteId: String(task.noteId || task.id || ""),
            inlineNote,
            summary,
            assets,
        };
    }

    if (task.notes !== true) {
        return {
            hasNote: false,
            noteId: String(task.noteId || task.id || ""),
            summary: "",
            assets: [],
        };
    }

    const explicitNoteId = typeof task.noteId === "string" && task.noteId ? task.noteId : "";
    const originalId = typeof task.originalId === "string" && task.originalId ? task.originalId : "";
    const isInstance = !!(task.isRepeatInstance || task.isRepeated || task.isRepeatedInstance || task.isInstance);
    const id = String(task.id || "");
    const noteId = explicitNoteId || id || originalId;
    const fallbackNoteId = isInstance && originalId && originalId !== noteId ? originalId : undefined;

    return {
        hasNote: true,
        noteId,
        fallbackNoteId,
        summary,
        assets,
    };
}

/**
 * 展开重复任务实例时解析实例的备注字段（区分继承模板、独立覆写、显式清空）。
 */
export function resolveExpandedInstanceNoteFields(
    reminder: any,
    instanceState: any,
    instanceDate: string
): {
    note?: string;
    notes?: boolean;
    noteId?: string;
    noteSummary?: string;
    noteAssets?: string[];
} {
    // 1. 新结构：实例显式清空备注
    if (instanceState && instanceState.notes === false) {
        return {
            note: "",
            notes: false,
            noteId: undefined,
            noteSummary: undefined,
            noteAssets: undefined,
        };
    }
    // 2. 新结构：实例有独立备注文件
    if (instanceState && instanceState.notes === true) {
        return {
            note: undefined,
            notes: true,
            noteId: `${reminder.id}_${instanceDate}`,
            noteSummary: instanceState.noteSummary,
            noteAssets: instanceState.noteAssets,
        };
    }
    // 3. 兼容旧结构或订阅任务：实例有内联 note 字段
    if (instanceState && typeof instanceState.note === "string") {
        const has = instanceState.note.trim().length > 0;
        return {
            note: instanceState.note,
            notes: has ? true : false,
            noteId: has ? `${reminder.id}_${instanceDate}` : undefined,
            noteSummary: has ? buildTaskNoteSummary(instanceState.note) : undefined,
            noteAssets: has ? extractNoteAssetPaths(instanceState.note) : undefined,
        };
    }
    // 4. 继承父模板的拆分备注
    if (reminder?.notes === true) {
        return {
            note: undefined,
            notes: true,
            noteId: reminder.id,
            noteSummary: reminder.noteSummary,
            noteAssets: reminder.noteAssets,
        };
    }
    // 5. 继承父模板的内联备注（订阅任务或未迁移任务）
    const parentInline = typeof reminder?.note === "string" ? reminder.note : "";
    return {
        note: parentInline,
        notes: parentInline.trim() ? true : undefined,
        noteId: parentInline.trim() ? reminder?.id : undefined,
        noteSummary: parentInline.trim() ? buildTaskNoteSummary(parentInline) : undefined,
        noteAssets: parentInline.trim() ? extractNoteAssetPaths(parentInline) : undefined,
    };
}

/**
 * 同步获取当前可用于搜索、通知或即时预览的备注文本（优先内存缓存与内联文本，回退到摘要）。
 */
export function getTaskNotePreviewText(task: any): string {
    const ref = resolveTaskNoteRef(task);
    if (!ref.hasNote) return "";
    if (ref.inlineNote) return ref.inlineNote;
    const cached = getCachedTaskNote(ref.noteId) ?? (ref.fallbackNoteId ? getCachedTaskNote(ref.fallbackNoteId) : undefined);
    if (cached !== undefined && cached.trim()) return cached;
    return ref.summary || "";
}

/**
 * 生成用于卡片局部更新比对的备注签名键（包含内容 revision，保存备注后立即感知变更）。
 */
export function getTaskNoteRenderKey(task: any): string {
    const ref = resolveTaskNoteRef(task);
    if (!ref.hasNote) return "";
    if (ref.inlineNote !== undefined) return `inline:${ref.inlineNote}`;
    const rev = getTaskNoteRevision(ref.noteId);
    const fallbackRev = ref.fallbackNoteId ? getTaskNoteRevision(ref.fallbackNoteId) : 0;
    return `file:${ref.noteId}:${rev}:${fallbackRev}:${ref.summary}`;
}

function shouldUseDirectFileApi(plugin: any): boolean {
    if (plugin && typeof plugin.readTaskNoteFile === "function") return false;
    return (
        typeof window !== "undefined" &&
        typeof fetch === "function" &&
        !!plugin?.name &&
        typeof (window as any).siyuan !== "undefined"
    );
}

async function readNoteFileRaw(plugin: any, noteId: string): Promise<string> {
    const storageName = getTaskNoteStorageName(noteId);

    if (plugin && typeof plugin.readTaskNoteFile === "function") {
        const res = await plugin.readTaskNoteFile(noteId);
        return typeof res === "string" ? res : "";
    }

    if (shouldUseDirectFileApi(plugin)) {
        const fullPath = getTaskNoteFullPath(plugin.name, noteId);
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                body: JSON.stringify({ path: fullPath }),
            });
            // 思源内核对不存在的文件返回 HTTP 202 + JSON { code: 404 }
            if (!response.ok || response.status === 202) {
                return "";
            }
            return await response.text();
        } catch (err) {
            console.warn("Failed to read task note file:", fullPath, err);
            return "";
        }
    }

    if (plugin && typeof plugin.loadData === "function") {
        // 避免 Plugin.loadData 的永久缓存占满内存
        if (plugin.data && typeof plugin.data === "object") {
            delete plugin.data[storageName];
        }
        const data = await plugin.loadData(storageName);
        if (plugin.data && typeof plugin.data === "object") {
            delete plugin.data[storageName];
        }
        return typeof data === "string" ? data : "";
    }

    return "";
}

async function writeNoteFileRaw(plugin: any, noteId: string, content: string): Promise<void> {
    const storageName = getTaskNoteStorageName(noteId);

    if (plugin && typeof plugin.writeTaskNoteFile === "function") {
        await plugin.writeTaskNoteFile(noteId, content);
        return;
    }

    if (shouldUseDirectFileApi(plugin)) {
        const { putFile } = await import("../api");
        const fullPath = getTaskNoteFullPath(plugin.name, noteId);
        const blob = new Blob([content], { type: "text/markdown; charset=utf-8" });
        await putFile(fullPath, false, blob);
        return;
    }

    if (plugin && typeof plugin.saveData === "function") {
        await plugin.saveData(storageName, content);
        if (plugin.data && typeof plugin.data === "object") {
            delete plugin.data[storageName];
        }
    }
}

async function removeNoteFileRaw(plugin: any, noteId: string): Promise<void> {
    const storageName = getTaskNoteStorageName(noteId);

    if (plugin && typeof plugin.removeTaskNoteFile === "function") {
        await plugin.removeTaskNoteFile(noteId);
        return;
    }

    if (shouldUseDirectFileApi(plugin)) {
        try {
            const { removeFile } = await import("../api");
            const fullPath = getTaskNoteFullPath(plugin.name, noteId);
            await removeFile(fullPath);
        } catch {
            // 文件不存在时静默忽略
        }
        return;
    }

    if (plugin && typeof plugin.removeData === "function") {
        try {
            await plugin.removeData(storageName);
        } catch {
            // ignore missing file
        }
        if (plugin.data && typeof plugin.data === "object") {
            delete plugin.data[storageName];
        }
    }
}

async function loadNoteById(plugin: any, noteId: string, forceReload = false): Promise<string> {
    if (!noteId) return "";
    if (!forceReload) {
        const cached = getCachedTaskNote(noteId);
        if (cached !== undefined) return cached;
        const pending = noteInFlightLoads.get(noteId);
        if (pending) return pending;
    }

    const promise = (async () => {
        try {
            const content = await readNoteFileRaw(plugin, noteId);
            touchCache(noteId, content);
            return content;
        } finally {
            noteInFlightLoads.delete(noteId);
        }
    })();

    noteInFlightLoads.set(noteId, promise);
    return promise;
}

/**
 * 按需加载单个任务的备注 Markdown 正文。
 */
export async function loadTaskNote(
    plugin: any,
    taskOrId: any,
    options?: { forceReload?: boolean }
): Promise<string> {
    if (!taskOrId) return "";
    if (typeof taskOrId === "string") {
        return loadNoteById(plugin, taskOrId, options?.forceReload);
    }

    const ref = resolveTaskNoteRef(taskOrId);
    if (!ref.hasNote) return "";
    if (ref.inlineNote !== undefined) return ref.inlineNote;

    const primary = await loadNoteById(plugin, ref.noteId, options?.forceReload);
    if (primary || !ref.fallbackNoteId) {
        return primary;
    }
    return loadNoteById(plugin, ref.fallbackNoteId, options?.forceReload);
}

/**
 * 保存或清空单个任务的备注文件 `notes/<noteId>.md`，并同步维护 `assets-cleanup-ignore`。
 */
export async function saveTaskNote(
    plugin: any,
    noteId: string,
    markdown: string,
    options?: {
        previousAssets?: string[];
        allReminders?: Record<string, any>;
        apiPost?: AssetCleanupApiPost;
    }
): Promise<TaskNoteMetadata> {
    const normalizedMd = typeof markdown === "string" ? markdown.trim() : "";
    const metadata = buildTaskNoteMetadata(normalizedMd);
    const prevAssets = Array.isArray(options?.previousAssets) ? options!.previousAssets : [];
    const nextAssets = metadata.noteAssets || [];
    const nextSet = new Set(nextAssets);

    if (metadata.notes) {
        await writeNoteFileRaw(plugin, noteId, normalizedMd);
        setCachedTaskNote(noteId, normalizedMd);
        if (nextAssets.length > 0) {
            await addAssetCleanupIgnore(nextAssets, options?.apiPost).catch((err) => {
                console.warn("Failed to add task note assets to cleanup ignore:", err);
            });
        }
    } else {
        await removeNoteFileRaw(plugin, noteId);
        setCachedTaskNote(noteId, "");
    }

    const removedAssets = prevAssets.filter((p) => !nextSet.has(p));
    if (removedAssets.length > 0) {
        try {
            const reminders = options?.allReminders
                || (plugin && typeof plugin.loadReminderData === "function" ? await plugin.loadReminderData() : undefined);
            if (reminders && typeof reminders === "object") {
                await reconcileRemovedTaskAssets(removedAssets, reminders, options?.apiPost);
            }
        } catch (err) {
            console.warn("Failed to reconcile removed task note assets:", err);
        }
    }

    return metadata;
}

/**
 * 复制任务备注文件（用于复制任务、删除周期任务时保留已完成实例等场景）。
 */
export async function copyTaskNote(
    plugin: any,
    sourceTaskOrId: any,
    targetNoteId: string,
    options?: { apiPost?: AssetCleanupApiPost }
): Promise<TaskNoteMetadata> {
    const content = await loadTaskNote(plugin, sourceTaskOrId);
    if (!content.trim()) {
        return { notes: false };
    }
    return saveTaskNote(plugin, targetNoteId, content, { apiPost: options?.apiPost });
}

/**
 * 收集一批任务及其重复实例涉及的所有备注文件 ID 和引用的资产路径。
 */
export function collectNoteEntriesFromTasks(
    tasks: Iterable<any>
): { noteIds: string[]; assetPaths: string[] } {
    const noteIds = new Set<string>();
    const assetPaths = new Set<string>();

    const addAssets = (list: unknown, inlineNote?: unknown) => {
        if (Array.isArray(list)) {
            for (const item of list) {
                if (typeof item === "string" && item) assetPaths.add(item);
            }
        }
        if (typeof inlineNote === "string" && inlineNote) {
            for (const item of extractNoteAssetPaths(inlineNote)) {
                assetPaths.add(item);
            }
        }
    };

    for (const task of tasks) {
        if (!task || typeof task !== "object" || !task.id) continue;
        if (task.notes === true || (typeof task.note === "string" && task.note.trim())) {
            noteIds.add(String(task.id));
        }
        addAssets(task.noteAssets, task.note);

        const instances = task.repeat?.instances;
        if (instances && typeof instances === "object") {
            for (const [instanceDate, state] of Object.entries(instances as Record<string, any>)) {
                if (!state || typeof state !== "object") continue;
                if (state.notes === true || (typeof state.note === "string" && state.note.trim())) {
                    noteIds.add(`${task.id}_${instanceDate}`);
                }
                addAssets(state.noteAssets, state.note);
            }
        }
    }

    return {
        noteIds: Array.from(noteIds),
        assetPaths: Array.from(assetPaths),
    };
}

/**
 * 删除任务后，清理对应的 `notes/<id>.md` 文件并从 `assets-cleanup-ignore` 移除不再被任何剩余任务引用的资源。
 */
export async function cleanupDeletedTaskNotes(
    plugin: any,
    removedTasks: Iterable<any>,
    remainingReminders: Record<string, any> | null | undefined,
    options?: {
        keepNoteIds?: Set<string>;
        apiPost?: AssetCleanupApiPost;
    }
): Promise<{ deletedNoteIds: string[]; unignoredAssets: string[] }> {
    const taskList = Array.from(removedTasks).filter((t) => t && typeof t === "object");
    if (taskList.length === 0) {
        return { deletedNoteIds: [], unignoredAssets: [] };
    }

    const { noteIds, assetPaths } = collectNoteEntriesFromTasks(taskList);
    const keepNoteIds = options?.keepNoteIds;
    const targetNoteIds = keepNoteIds
        ? noteIds.filter((id) => !keepNoteIds.has(id))
        : noteIds;

    const allRemovedAssets = new Set<string>(assetPaths);

    // 若旧数据只有 notes: true 却缺失 noteAssets，删除文件前先读取提取其中的资源路径
    for (const task of taskList) {
        if (task.notes === true && (!Array.isArray(task.noteAssets) || task.noteAssets.length === 0)) {
            if (!keepNoteIds?.has(String(task.id))) {
                const md = await loadNoteById(plugin, String(task.id)).catch(() => "");
                for (const p of extractNoteAssetPaths(md)) allRemovedAssets.add(p);
            }
        }
        const instances = task.repeat?.instances;
        if (instances && typeof instances === "object") {
            for (const [instanceDate, state] of Object.entries(instances as Record<string, any>)) {
                if (state?.notes === true && (!Array.isArray(state.noteAssets) || state.noteAssets.length === 0)) {
                    const instId = `${task.id}_${instanceDate}`;
                    if (!keepNoteIds?.has(instId)) {
                        const md = await loadNoteById(plugin, instId).catch(() => "");
                        for (const p of extractNoteAssetPaths(md)) allRemovedAssets.add(p);
                    }
                }
            }
        }
    }

    await Promise.allSettled(
        targetNoteIds.map(async (noteId) => {
            await removeNoteFileRaw(plugin, noteId);
            invalidateTaskNoteCache(noteId);
        })
    );

    let unignoredAssets: string[] = [];
    if (allRemovedAssets.size > 0) {
        try {
            unignoredAssets = await reconcileRemovedTaskAssets(
                allRemovedAssets,
                remainingReminders,
                options?.apiPost
            );
        } catch (err) {
            console.warn("Failed to unignore assets for deleted tasks:", err);
        }
    }

    return { deletedNoteIds: targetNoteIds, unignoredAssets };
}

/**
 * 撤回删除用：在删除前为即将移除的任务备注拍摄正文快照。
 */
export async function snapshotTaskNotes(
    plugin: any,
    tasks: Iterable<any>
): Promise<Map<string, string>> {
    const snapshots = new Map<string, string>();
    const { noteIds } = collectNoteEntriesFromTasks(tasks);
    await Promise.all(
        noteIds.map(async (noteId) => {
            const content = await loadNoteById(plugin, noteId).catch(() => "");
            if (content.trim()) {
                snapshots.set(noteId, content);
            }
        })
    );
    return snapshots;
}

/**
 * 撤回删除用：恢复快照中的备注文件，并重新将其引用的资产加入 `assets-cleanup-ignore`。
 */
export async function restoreTaskNotesFromSnapshot(
    plugin: any,
    snapshots: Map<string, string>,
    options?: { apiPost?: AssetCleanupApiPost }
): Promise<void> {
    if (!snapshots || snapshots.size === 0) return;
    const assetsToIgnore = new Set<string>();
    await Promise.all(
        Array.from(snapshots.entries()).map(async ([noteId, content]) => {
            if (!content.trim()) return;
            await writeNoteFileRaw(plugin, noteId, content);
            setCachedTaskNote(noteId, content);
            for (const asset of extractNoteAssetPaths(content)) {
                assetsToIgnore.add(asset);
            }
        })
    );
    if (assetsToIgnore.size > 0) {
        await addAssetCleanupIgnore(assetsToIgnore, options?.apiPost).catch((err) => {
            console.warn("Failed to restore assets to cleanup ignore after undo:", err);
        });
    }
}

/**
 * 对比保存前后的 reminder.json，自动找出被删除的任务及被清空/删除的重复实例备注，
 * 用于在 saveReminderData 中兜底清理备注文件和 assets-cleanup-ignore。
 */
export function diffRemovedTasksAndInstances(
    previousData: Record<string, any> | null | undefined,
    nextData: Record<string, any> | null | undefined
): { removedTasks: any[]; keepNoteIds: Set<string> } {
    const removedTasks: any[] = [];
    const keepNoteIds = new Set<string>();
    if (!previousData || typeof previousData !== "object") {
        return { removedTasks, keepNoteIds };
    }
    const next = nextData && typeof nextData === "object" ? nextData : {};

    for (const [id, task] of Object.entries(next)) {
        if (!task || typeof task !== "object") continue;
        if (task.notes === true) keepNoteIds.add(id);
        const instances = task.repeat?.instances;
        if (instances && typeof instances === "object") {
            for (const [date, state] of Object.entries(instances as Record<string, any>)) {
                if (state?.notes === true) keepNoteIds.add(`${id}_${date}`);
            }
        }
    }

    for (const [id, prevTask] of Object.entries(previousData)) {
        if (!prevTask || typeof prevTask !== "object") continue;
        const nextTask = next[id];
        if (!nextTask) {
            removedTasks.push(prevTask);
            continue;
        }
        // 任务仍在，但某个有独立备注的重复实例被移除
        const prevInstances = prevTask.repeat?.instances;
        const nextInstances = nextTask.repeat?.instances;
        if (prevInstances && typeof prevInstances === "object") {
            const removedInstances: Record<string, any> = {};
            for (const [date, prevState] of Object.entries(prevInstances as Record<string, any>)) {
                if (!prevState || typeof prevState !== "object") continue;
                const nextState = nextInstances?.[date];
                if (prevState.notes === true && (!nextState || nextState.deleted || nextState.notes !== true)) {
                    removedInstances[date] = prevState;
                }
            }
            if (Object.keys(removedInstances).length > 0) {
                removedTasks.push({
                    id,
                    repeat: { instances: removedInstances },
                });
            }
        }
    }

    return { removedTasks, keepNoteIds };
}

export interface TaskNoteIndexEntry {
    id: string;
    notes?: boolean;
    noteAssets?: string[];
    instanceNotes?: Record<string, { notes: true; noteAssets?: string[] }>;
}

export type TaskNoteIndex = Map<string, TaskNoteIndexEntry>;

/**
 * 为 reminder.json 构建轻量备注索引（仅记录有备注的任务 ID 及其资源引用），
 * 不受调用方原地修改 reminderDataCache 的影响。
 */
export function buildTaskNoteIndex(reminderData: Record<string, any> | null | undefined): TaskNoteIndex {
    const index: TaskNoteIndex = new Map();
    if (!reminderData || typeof reminderData !== "object") return index;

    for (const [id, task] of Object.entries(reminderData)) {
        if (!task || typeof task !== "object") continue;
        const hasOwnNote = task.notes === true;
        let instanceNotes: Record<string, { notes: true; noteAssets?: string[] }> | undefined;
        const instances = task.repeat?.instances;
        if (instances && typeof instances === "object") {
            for (const [date, state] of Object.entries(instances as Record<string, any>)) {
                if (state && typeof state === "object" && !state.deleted && state.notes === true) {
                    if (!instanceNotes) instanceNotes = {};
                    instanceNotes[date] = {
                        notes: true,
                        noteAssets: Array.isArray(state.noteAssets) ? [...state.noteAssets] : undefined,
                    };
                }
            }
        }
        if (hasOwnNote || instanceNotes) {
            index.set(id, {
                id,
                notes: hasOwnNote || undefined,
                noteAssets: hasOwnNote && Array.isArray(task.noteAssets) ? [...task.noteAssets] : undefined,
                instanceNotes,
            });
        }
    }

    return index;
}

/**
 * 对比旧的轻量备注索引与即将落盘的 nextData，找出已删除任务或已移除/清空的实例备注。
 */
export function diffTaskNoteIndex(
    previousIndex: TaskNoteIndex | null | undefined,
    nextData: Record<string, any> | null | undefined
): { removedTasks: any[]; keepNoteIds: Set<string> } {
    const removedTasks: any[] = [];
    const keepNoteIds = new Set<string>();
    if (!previousIndex || previousIndex.size === 0) {
        return { removedTasks, keepNoteIds };
    }
    const next = nextData && typeof nextData === "object" ? nextData : {};

    for (const [id, task] of Object.entries(next)) {
        if (!task || typeof task !== "object") continue;
        if (task.notes === true) keepNoteIds.add(id);
        const instances = task.repeat?.instances;
        if (instances && typeof instances === "object") {
            for (const [date, state] of Object.entries(instances as Record<string, any>)) {
                if (state && typeof state === "object" && !state.deleted && state.notes === true) {
                    keepNoteIds.add(`${id}_${date}`);
                }
            }
        }
    }

    for (const [id, prevEntry] of previousIndex.entries()) {
        const nextTask = next[id];
        if (!nextTask) {
            removedTasks.push({
                id,
                notes: prevEntry.notes,
                noteAssets: prevEntry.noteAssets,
                repeat: prevEntry.instanceNotes ? { instances: prevEntry.instanceNotes } : undefined,
            });
            continue;
        }
        if (prevEntry.instanceNotes) {
            const removedInstances: Record<string, any> = {};
            const nextInstances = nextTask.repeat?.instances;
            for (const [date, prevInst] of Object.entries(prevEntry.instanceNotes)) {
                const nextInst = nextInstances?.[date];
                if (!nextInst || nextInst.deleted || nextInst.notes !== true) {
                    removedInstances[date] = prevInst;
                }
            }
            if (Object.keys(removedInstances).length > 0) {
                removedTasks.push({
                    id,
                    repeat: { instances: removedInstances },
                });
            }
        }
    }

    return { removedTasks, keepNoteIds };
}
