import { showMessage } from "siyuan";
import { i18n } from "../pluginInstance";
import { PomodoroRecordManager } from "./pomodoroRecord";
import { ProjectManager, type MilestoneDateDisplayInfo } from "./projectManager";

const PROJECT_KANBAN_TAB_TYPE = "project_kanban_tab";
const BLOCK_POMODORO_COUNT_ATTR = "custom-task-pomodoro-count";
const BLOCK_POMODORO_MINUTES_ATTR = "custom-task-pomodoro-minutes";
const INSTANCE_EVENT_ID_SUFFIX_REGEX = /^(.*)_\d{4}-\d{2}-\d{2}$/;

interface PomodoroStats {
    count: number;
    minutes: number;
}

interface BoundReminderDateDisplayInfo {
    reminderId: string;
    displayText: string;
    displayType: "schedule" | "completed";
}

export class TaskNoteDOMManager {
    private plugin: any;

    private processingBlockButtons: Set<string> = new Set();
    private outlinePrefixCache: Map<string, string> = new Map();
    private protyleObservers: WeakMap<Element, MutationObserver> = new WeakMap();
    private protyleDebounceTimers: WeakMap<Element, number> = new WeakMap();
    private currentHeadingIds: Set<string> = new Set();
    private pomodoroStatsByEventId: Map<string, PomodoroStats> = new Map();
    private pomodoroStatsByBaseEventId: Map<string, PomodoroStats> = new Map();
    private pomodoroStatsCacheUpdatedAt = 0;
    private pomodoroStatsLoadingPromise: Promise<void> | null = null;
    private latestPomodoroSummaryTaskByBlock: Map<string, number> = new Map();
    private latestBindReminderDateTaskByBlock: Map<string, number> = new Map();
    private lastBoundReminderDateDisplayByBlock: Map<string, BoundReminderDateDisplayInfo> = new Map();
    private latestMilestoneDateTaskByBlock: Map<string, number> = new Map();
    private lastMilestoneDateDisplayByBlock: Map<string, MilestoneDateDisplayInfo> = new Map();
    private dialogPreloadTimer: number | null = null;
    private dialogsPreloaded = false;

    constructor(plugin: any) {
        this.plugin = plugin;
        const onReminderUpdated = () => {
            this.invalidatePomodoroStatsCache();
            this.refreshBoundReminderDateButtonsForAllProtyles();
        };
        window.addEventListener("reminderUpdated", onReminderUpdated as EventListener);
        this.scheduleDialogPreload();
        this.plugin.addCleanup(() => {
            window.removeEventListener("reminderUpdated", onReminderUpdated as EventListener);
            if (this.dialogPreloadTimer) {
                window.clearTimeout(this.dialogPreloadTimer);
                this.dialogPreloadTimer = null;
            }
        });
    }

    private scheduleDialogPreload() {
        if (this.dialogsPreloaded || this.dialogPreloadTimer) return;
        this.dialogPreloadTimer = window.setTimeout(() => {
            this.dialogPreloadTimer = null;
            this.preloadDialogs();
        }, 1200);
    }

    private preloadDialogs() {
        if (this.dialogsPreloaded) return;
        this.dialogsPreloaded = true;
        void Promise.allSettled([
            import("../components/BlockRemindersDialog"),
            import("../components/PomodoroSessionsDialog"),
        ]);
    }

    private isPluginManagedNode(node: Node | null): boolean {
        if (!node) return false;
        if (node instanceof Element) {
            return !!(node.matches?.('[data-plugin-added="reminder-plugin"]') || node.closest?.('[data-plugin-added="reminder-plugin"]'));
        }
        if (node.nodeType === Node.TEXT_NODE) {
            return this.isPluginManagedNode(node.parentElement);
        }
        return false;
    }

    private shouldIgnoreMutation(mutation: MutationRecord): boolean {
        if (mutation.type === "attributes") {
            return this.isPluginManagedNode(mutation.target);
        }
        if (mutation.type === "childList") {
            const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
            if (changedNodes.length === 0) return false;
            return changedNodes.every((node) => this.isPluginManagedNode(node));
        }
        return false;
    }

    private refreshBoundReminderDateButtonsForAllProtyles() {
        document.querySelectorAll(".protyle").forEach((protyleElement) => {
            const protyle = (protyleElement as any).protyle;
            if (!protyle?.element) return;
            this._scanProtyleForButtons(protyle);
        });
    }

    private parsePomodoroMetric(value?: string | null): number {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
        return Math.floor(numericValue);
    }

    private formatPomodoroDuration(totalMinutes: number): string {
        const safeMinutes = Math.max(0, Math.floor(Number(totalMinutes) || 0));
        const hours = Math.floor(safeMinutes / 60);
        const minutes = safeMinutes % 60;
        if (hours <= 0) return `${minutes}${i18n("minutes") || "分钟"}`;
        if (minutes === 0) return `${hours}h`;
        return `${hours}h ${minutes}${i18n("minutes") || "分钟"}`;
    }

    private getPomodoroSummaryText(totalCount: number, totalMinutes: number): string {
        return `🍅 ${Math.max(0, totalCount)} · ⏱ ${this.formatPomodoroDuration(totalMinutes)}`;
    }

    private normalizeReminderIds(rawValue?: string | string[] | null): string[] {
        if (!rawValue) return [];
        const values = Array.isArray(rawValue) ? rawValue : String(rawValue).split(",");
        return Array.from(new Set(values.map((id) => String(id).trim()).filter((id) => id)));
    }

    private getReminderIdsKey(reminderIds: string[]): string {
        return this.normalizeReminderIds(reminderIds).join(",");
    }

    private getEmptyPomodoroStats(): PomodoroStats {
        return { count: 0, minutes: 0 };
    }

    private accumulatePomodoroStats(target: PomodoroStats, source?: PomodoroStats | null) {
        if (!source) return;
        target.count += Math.max(0, Math.floor(Number(source.count) || 0));
        target.minutes += Math.max(0, Math.floor(Number(source.minutes) || 0));
    }

    private setPomodoroStats(targetMap: Map<string, PomodoroStats>, key: string, count: number, minutes: number) {
        const current = targetMap.get(key) || this.getEmptyPomodoroStats();
        current.count += Math.max(0, Math.floor(Number(count) || 0));
        current.minutes += Math.max(0, Math.floor(Number(minutes) || 0));
        targetMap.set(key, current);
    }

    private invalidatePomodoroStatsCache() {
        this.pomodoroStatsByEventId = new Map();
        this.pomodoroStatsByBaseEventId = new Map();
        this.pomodoroStatsCacheUpdatedAt = 0;
        this.pomodoroStatsLoadingPromise = null;
    }

    private async ensurePomodoroStatsCache(force = false): Promise<void> {
        const cacheTtlMs = 3000;
        const now = Date.now();
        if (!force && this.pomodoroStatsCacheUpdatedAt > 0 && now - this.pomodoroStatsCacheUpdatedAt < cacheTtlMs) {
            return;
        }
        if (this.pomodoroStatsLoadingPromise) {
            await this.pomodoroStatsLoadingPromise;
            return;
        }

        this.pomodoroStatsLoadingPromise = (async () => {
            try {
                const recordManager = PomodoroRecordManager.getInstance(this.plugin);
                await recordManager.initialize();
                const records = (recordManager as any).records || {};
                const statsByEventId = new Map<string, PomodoroStats>();
                const statsByBaseEventId = new Map<string, PomodoroStats>();

                for (const dateKey of Object.keys(records)) {
                    const record = records[dateKey];
                    const sessions = Array.isArray(record?.sessions) ? record.sessions : [];
                    for (const session of sessions) {
                        if (!session || session.type !== "work") continue;
                        const eventId = String(session.eventId || "").trim();
                        if (!eventId) continue;
                        const count = Math.max(0, Math.floor(Number(recordManager.calculateSessionCount(session)) || 0));
                        const minutes = Math.max(0, Math.floor(Number(session.duration) || 0));
                        if (count <= 0 && minutes <= 0) continue;
                        this.setPomodoroStats(statsByEventId, eventId, count, minutes);
                    }
                }

                for (const [eventId, stats] of statsByEventId.entries()) {
                    this.setPomodoroStats(statsByBaseEventId, eventId, stats.count, stats.minutes);
                    const matched = eventId.match(INSTANCE_EVENT_ID_SUFFIX_REGEX);
                    if (matched && matched[1]) {
                        this.setPomodoroStats(statsByBaseEventId, matched[1], stats.count, stats.minutes);
                    }
                }

                this.pomodoroStatsByEventId = statsByEventId;
                this.pomodoroStatsByBaseEventId = statsByBaseEventId;
                this.pomodoroStatsCacheUpdatedAt = Date.now();
            } catch (error) {
                console.warn("加载番茄会话缓存失败:", error);
                this.pomodoroStatsByEventId = new Map();
                this.pomodoroStatsByBaseEventId = new Map();
                this.pomodoroStatsCacheUpdatedAt = Date.now();
            } finally {
                this.pomodoroStatsLoadingPromise = null;
            }
        })();

        await this.pomodoroStatsLoadingPromise;
    }

    private getBoundPomodoroStatsFromCache(reminderIds: string[]): PomodoroStats {
        const totals = this.getEmptyPomodoroStats();
        const normalizedIds = this.normalizeReminderIds(reminderIds);
        for (const reminderId of normalizedIds) {
            const stats = this.pomodoroStatsByBaseEventId.get(reminderId) || this.pomodoroStatsByEventId.get(reminderId);
            this.accumulatePomodoroStats(totals, stats);
        }
        return totals;
    }

    public initOutlinePrefixObserver() {
        let updateTimeout: number | null = null;
        let lastObservedElement: Element | null = null;
        let currentObserver: MutationObserver | null = null;

        const debouncedUpdate = () => {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = window.setTimeout(() => {
                const outline = document.querySelector(".file-tree.sy__outline");
                if (!outline) return;
                this.updateOutlinePrefixes();
            }, 0);
        };

        const createObserver = (element: Element) => {
            const observer = new MutationObserver((mutations) => {
                const hasSignificantChange = mutations.some((mutation) => {
                    if (mutation.type === "childList") {
                        return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
                    }
                    if (mutation.type === "attributes") {
                        return mutation.attributeName === "data-node-id" || mutation.attributeName === "aria-label";
                    }
                    if (mutation.type === "characterData") {
                        return true;
                    }
                    return false;
                });
                if (hasSignificantChange) debouncedUpdate();
            });

            observer.observe(element, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
                attributeFilter: ["data-node-id", "aria-label"],
            });
            return observer;
        };

        const wsMainHandler = (event: CustomEvent) => {
            const data = event.detail;
            if (data?.cmd === "setAppearance") {
                debouncedUpdate();
                return;
            }
            if (data?.cmd === "transactions" && data.data) {
                let shouldUpdate = false;
                for (const transaction of data.data) {
                    if (transaction.doOperations) {
                        for (const op of transaction.doOperations) {
                            if (op.action === "updateAttrs") {
                                let hasBookmarkUpdate = false;
                                if (op.data?.new && "bookmark" in op.data.new) {
                                    hasBookmarkUpdate = true;
                                }
                                if (op.data && "bookmark" in op.data && !op.data.new) {
                                    hasBookmarkUpdate = true;
                                }
                                if (hasBookmarkUpdate && this.currentHeadingIds.has(op.id)) {
                                    shouldUpdate = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (shouldUpdate) break;
                }
                if (shouldUpdate) debouncedUpdate();
            }
        };

        this.plugin.eventBus.on("ws-main", wsMainHandler);

        const checkInterval = setInterval(() => {
            const outlineContainer = document.querySelector(".file-tree.sy__outline");
            if (outlineContainer !== lastObservedElement) {
                if (currentObserver) {
                    currentObserver.disconnect();
                }
                lastObservedElement = outlineContainer;
                if (outlineContainer) {
                    currentObserver = createObserver(outlineContainer);
                    debouncedUpdate();
                }
            }
        }, 2000);

        setTimeout(() => {
            const outlineContainer = document.querySelector(".file-tree.sy__outline");
            if (outlineContainer && !currentObserver) {
                lastObservedElement = outlineContainer;
                currentObserver = createObserver(outlineContainer);
                debouncedUpdate();
            } else if (outlineContainer) {
                debouncedUpdate();
            }
        }, 500);

        this.plugin.addCleanup(() => {
            if (currentObserver) currentObserver.disconnect();
            this.plugin.eventBus.off("ws-main", wsMainHandler);
            clearInterval(checkInterval);
            if (updateTimeout) clearTimeout(updateTimeout);
        });
    }

    public addBreadcrumbButtonsToExistingProtyles() {
        document.querySelectorAll(".protyle").forEach((protyleElement) => {
            const protyle = (protyleElement as any).protyle;
            if (protyle) {
                this.addBreadcrumbReminderButton(protyle);
                this.addBlockProjectButtonsToProtyle(protyle);
            }
        });
    }

    public async updateOutlinePrefixes() {
        try {
            const settings = await this.plugin.loadSettings();
            if (!settings.enableOutlinePrefix) return;

            const outline = document.querySelector(".file-tree.sy__outline");
            if (!outline) return;

            const headingLis = outline.querySelectorAll("li[data-type=\"NodeHeading\"]");
            if (headingLis.length === 0) return;

            const blockIds: string[] = [];
            const liMap = new Map<string, HTMLElement>();
            headingLis.forEach((li) => {
                const blockId = (li as HTMLElement).getAttribute("data-node-id");
                if (blockId) {
                    blockIds.push(blockId);
                    liMap.set(blockId, li as HTMLElement);
                }
            });

            if (blockIds.length === 0) return;

            this.currentHeadingIds = new Set(blockIds);

            const { sql } = await import("../api");
            const idsStr = blockIds.map((id) => `'${id}'`).join(",");
            const sqlQuery = `SELECT block_id, value FROM attributes WHERE block_id IN (${idsStr}) AND name = 'bookmark' LIMIT -1`;
            const attrsResults = await sql(sqlQuery);

            const bookmarkMap = new Map<string, string>();
            if (attrsResults && Array.isArray(attrsResults)) {
                attrsResults.forEach((row: any) => {
                    bookmarkMap.set(row.block_id, row.value || "");
                });
            }

            blockIds.forEach((blockId) => {
                const li = liMap.get(blockId);
                if (!li) return;

                const textElement = li.querySelector(".b3-list-item__text") as HTMLElement;
                if (!textElement) return;

                const hasAttribute = bookmarkMap.has(blockId);
                const isManaged = this.outlinePrefixCache.has(blockId);

                if (!hasAttribute && !isManaged) {
                    return;
                }

                const bookmark = hasAttribute ? (bookmarkMap.get(blockId) || "") : "";

                let prefix = "";
                if (bookmark === "✅") {
                    prefix = "✅ ";
                } else if (bookmark === "⏰") {
                    prefix = "⏰ ";
                }

                if (!hasAttribute) {
                    this.outlinePrefixCache.delete(blockId);
                } else {
                    this.outlinePrefixCache.set(blockId, prefix);
                }

                const currentText = textElement.textContent || "";
                const textWithoutPrefix = currentText.replace(/^[✅⏰]\s*/, "");
                const targetText = prefix + textWithoutPrefix;

                if (currentText !== targetText) {
                    textElement.textContent = targetText;
                }
            });

            const currentBlockIdSet = new Set(blockIds);
            for (const cachedId of this.outlinePrefixCache.keys()) {
                if (!currentBlockIdSet.has(cachedId)) {
                    this.outlinePrefixCache.delete(cachedId);
                }
            }
        } catch (error) {
            console.error("[大纲前缀] 更新失败:", error);
        }
    }

    public async addBreadcrumbReminderButton(protyle: any) {
        if (!protyle || !protyle.element) return;

        const breadcrumb = protyle.element.querySelector(".protyle-breadcrumb");
        if (!breadcrumb) return;

        const docButton = breadcrumb.querySelector("button[data-type=\"doc\"]");
        if (!docButton) return;

        const documentId = protyle.block?.rootID;
        if (!documentId) return;

        const projectData = await this.plugin.loadProjectData();
        const isProject = projectData && projectData.hasOwnProperty(documentId);

        const existingProjectButton = breadcrumb.querySelector(".project-breadcrumb-btn");
        if (isProject) {
            if (!existingProjectButton) {
                const projectBtn = document.createElement("button");
                projectBtn.className = "project-breadcrumb-btn block__icon fn__flex-center ariaLabel";
                projectBtn.setAttribute("aria-label", i18n("projectManagement"));
                projectBtn.innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#iconProject"></use></svg>`;
                projectBtn.style.cssText = `
                    margin-right: 4px;
                    padding: 4px;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    border-radius: 4px;
                    color: var(--b3-theme-on-background);
                    opacity: 0.7;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                `;

                projectBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.plugin.openProjectKanbanTab(projectData[documentId].blockId, projectData[documentId].title);
                });
                breadcrumb.insertBefore(projectBtn, docButton);
            }
        } else if (existingProjectButton) {
            existingProjectButton.remove();
        }
    }

    public _processSingleBlock(protyle: any, node: Element) {
        if (!node || !(node as any).getAttribute) return;

        const isDocumentLevel = node.classList.contains("protyle-wysiwyg");
        const hasTrackedAttrsOnNode =
            node.hasAttribute("custom-task-projectid") ||
            node.hasAttribute("custom-bind-reminders") ||
            node.hasAttribute("custom-bind-milestones") ||
            node.hasAttribute(BLOCK_POMODORO_COUNT_ATTR) ||
            node.hasAttribute(BLOCK_POMODORO_MINUTES_ATTR);
        const blockEl = (node.hasAttribute("data-node-id") ? node : node.closest("[data-node-id]")) as HTMLElement | null;
        const blockId = node.getAttribute("data-node-id") || this._getBlockIdFromElement(node);
        if (!blockId) return;
        if (!isDocumentLevel && !blockEl) return;

        // 对于非文档级且不带目标属性的节点变更，不直接执行删除；先尝试定位真实属性载体节点
        if (!isDocumentLevel && !hasTrackedAttrsOnNode) {
            const trackedSource = this._findTrackedSourceForBlock(protyle, blockId);
            if (trackedSource && trackedSource !== node) {
                this._processSingleBlock(protyle, trackedSource);
            }
            return;
        }

        const attrSource = (isDocumentLevel || hasTrackedAttrsOnNode ? node : blockEl) as Element;
        const rawAttr = attrSource.getAttribute("custom-task-projectid");
        const bindReminderIds = this.normalizeReminderIds(attrSource.getAttribute("custom-bind-reminders"));
        const hasBind = bindReminderIds.length > 0;
        const rawMilestones = attrSource.getAttribute("custom-bind-milestones");
        const milestoneProjectId = attrSource.getAttribute("custom-task-projectid");
        const pomodoroTotalCount = this.parsePomodoroMetric(attrSource.getAttribute(BLOCK_POMODORO_COUNT_ATTR));
        const pomodoroTotalMinutes = this.parsePomodoroMetric(attrSource.getAttribute(BLOCK_POMODORO_MINUTES_ATTR));

        const projectIds = rawAttr ? rawAttr.split(",").map((s) => s.trim()).filter((s) => s) : [];
        const milestoneIds = rawMilestones ? rawMilestones.split(",").map((s) => s.trim()).filter((s) => s) : [];

        const info = {
            projectIds,
            hasBind,
            bindReminderIds,
            milestoneIds,
            milestoneProjectId: milestoneProjectId || undefined,
            pomodoroTotalCount,
            pomodoroTotalMinutes,
            element: attrSource,
        };

        if (!rawAttr && !hasBind && !rawMilestones && pomodoroTotalCount <= 0 && pomodoroTotalMinutes <= 0) {
            const trackedSource = this._findTrackedSourceForBlock(protyle, blockId);
            if (trackedSource && trackedSource !== attrSource) return;
            const btns = protyle.element.querySelectorAll(`[data-block-id="${blockId}"][data-plugin-added="reminder-plugin"]`);
            if (btns.length > 0) {
                btns.forEach((b: Element) => b.remove());
            }
            return;
        }

        if (this.processingBlockButtons.has(blockId)) return;

        this.processingBlockButtons.add(blockId);
        try {
            this._processBlockButtons(protyle, blockId, info);
        } finally {
            this.processingBlockButtons.delete(blockId);
        }
    }

    public _scanProtyleForButtons(protyle: any) {
        try {
            if (!protyle || !protyle.element) return;

            const selector = `[custom-task-projectid], [custom-bind-reminders], [custom-bind-milestones], [${BLOCK_POMODORO_COUNT_ATTR}], [${BLOCK_POMODORO_MINUTES_ATTR}]`;
            const allBlocks = Array.from(protyle.element.querySelectorAll(selector)) as Element[];

            if (allBlocks.length === 0) {
                this._cleanupOrphanedButtons(protyle);
                return;
            }

            const blocksToProcess = new Map<string, {
                projectIds: string[];
                hasBind: boolean;
                bindReminderIds: string[];
                milestoneIds: string[];
                milestoneProjectId?: string;
                pomodoroTotalCount: number;
                pomodoroTotalMinutes: number;
                element: Element
            }>();

            for (const node of allBlocks) {
                const blockId = node.getAttribute("data-node-id") || this._getBlockIdFromElement(node);
                if (!blockId) continue;

                const rawAttr = node.getAttribute("custom-task-projectid");
                const projectIds = rawAttr ? rawAttr.split(",").map((s) => s.trim()).filter((s) => s) : [];
                const bindReminderIds = this.normalizeReminderIds(node.getAttribute("custom-bind-reminders"));
                const hasBind = bindReminderIds.length > 0;
                const rawMilestones = node.getAttribute("custom-bind-milestones");
                const milestoneIds = rawMilestones ? rawMilestones.split(",").map((s) => s.trim()).filter((s) => s) : [];
                const milestoneProjectId = node.getAttribute("custom-task-projectid") || undefined;
                const pomodoroTotalCount = this.parsePomodoroMetric(node.getAttribute(BLOCK_POMODORO_COUNT_ATTR));
                const pomodoroTotalMinutes = this.parsePomodoroMetric(node.getAttribute(BLOCK_POMODORO_MINUTES_ATTR));

                const existing = blocksToProcess.get(blockId);
                if (existing) {
                    const mergedProjectIds = Array.from(new Set([...existing.projectIds, ...projectIds]));
                    const mergedBindReminderIds = Array.from(new Set([...(existing.bindReminderIds || []), ...bindReminderIds]));
                    const mergedMilestoneIds = Array.from(new Set([...(existing.milestoneIds || []), ...milestoneIds]));
                    blocksToProcess.set(blockId, {
                        projectIds: mergedProjectIds,
                        hasBind: mergedBindReminderIds.length > 0,
                        bindReminderIds: mergedBindReminderIds,
                        milestoneIds: mergedMilestoneIds,
                        milestoneProjectId: milestoneProjectId || existing.milestoneProjectId,
                        pomodoroTotalCount: Math.max(existing.pomodoroTotalCount, pomodoroTotalCount),
                        pomodoroTotalMinutes: Math.max(existing.pomodoroTotalMinutes, pomodoroTotalMinutes),
                        element: existing.element.classList.contains("protyle-wysiwyg") ? existing.element : node,
                    });
                } else {
                    blocksToProcess.set(blockId, {
                        projectIds,
                        hasBind,
                        bindReminderIds,
                        milestoneIds,
                        milestoneProjectId,
                        pomodoroTotalCount,
                        pomodoroTotalMinutes,
                        element: node,
                    });
                }
            }

            this._cleanupOrphanedButtons(protyle, blocksToProcess);

            for (const [blockId, info] of blocksToProcess) {
                if (this.processingBlockButtons.has(blockId)) continue;
                this.processingBlockButtons.add(blockId);
                try {
                    this._processBlockButtons(protyle, blockId, info);
                } finally {
                    this.processingBlockButtons.delete(blockId);
                }
            }
        } catch (error) {
            console.error("扫描块按钮失败:", error);
        }
    }

    public async addBlockProjectButtonsToProtyle(protyle: any) {
        if (!protyle || !protyle.element) return;

        this._scanProtyleForButtons(protyle);

        if (!this.protyleObservers.has(protyle.element)) {
            const observer = new MutationObserver((mutations) => {
                let shouldUpdate = false;
                for (const mutation of mutations) {
                    if (this.shouldIgnoreMutation(mutation)) {
                        continue;
                    }
                    if (mutation.type === "attributes") {
                        shouldUpdate = true;
                        const target = mutation.target as Element;
                        this._processSingleBlock(protyle, target);
                    } else if (mutation.type === "childList") {
                        if (mutation.addedNodes.length > 0) {
                            shouldUpdate = true;
                            mutation.addedNodes.forEach((node) => {
                                if (node.nodeType === 1) {
                                    const el = node as Element;
                                    this._processSingleBlock(protyle, el);
                                    const relevantChildren = el.querySelectorAll?.(
                                        `[custom-task-projectid], [custom-bind-reminders], [custom-bind-milestones], [${BLOCK_POMODORO_COUNT_ATTR}], [${BLOCK_POMODORO_MINUTES_ATTR}]`
                                    );
                                    if (relevantChildren && relevantChildren.length > 0) {
                                        relevantChildren.forEach((child) => this._processSingleBlock(protyle, child));
                                    }
                                }
                            });
                        }
                        if (mutation.removedNodes.length > 0) {
                            shouldUpdate = true;
                        }
                    }
                }

                if (shouldUpdate) {
                    const element = protyle.element;
                    const existingTimer = this.protyleDebounceTimers.get(element);
                    if (existingTimer) {
                        window.clearTimeout(existingTimer);
                    }

                    const timer = window.setTimeout(() => {
                        this._scanProtyleForButtons(protyle);
                    }, 50);

                    this.protyleDebounceTimers.set(element, timer);
                }
            });

            observer.observe(protyle.element, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    "custom-task-projectid",
                    "custom-bind-reminders",
                    "custom-bind-milestones",
                    BLOCK_POMODORO_COUNT_ATTR,
                    BLOCK_POMODORO_MINUTES_ATTR,
                    "updated",
                    "bookmark",
                ],
            });

            const attrObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (this.shouldIgnoreMutation(m)) {
                        continue;
                    }
                    if (m.target instanceof Element && m.target.classList.contains("protyle-attr")) {
                        const block = m.target.closest("[data-node-id]");
                        if (block) this._processSingleBlock(protyle, block);
                    }
                }
            });
            attrObserver.observe(protyle.element, {
                childList: true,
                subtree: true,
            });

            this.protyleObservers.set(protyle.element, observer);

            this.plugin.addCleanup(() => {
                observer.disconnect();
                attrObserver.disconnect();
                this.protyleObservers.delete(protyle.element);
            });
        }
    }

    public _findTrackedSourceForBlock(protyle: any, blockId: string): Element | null {
        if (!protyle?.element || !blockId) return null;

        const trackedCandidates = Array.from(
            protyle.element.querySelectorAll(
                `[custom-task-projectid], [custom-bind-reminders], [custom-bind-milestones], [${BLOCK_POMODORO_COUNT_ATTR}], [${BLOCK_POMODORO_MINUTES_ATTR}]`
            )
        ) as Element[];
        for (const candidate of trackedCandidates) {
            if (this._getBlockIdFromElement(candidate) === blockId) {
                return candidate;
            }
        }

        return null;
    }

    public _getBlockIdFromElement(element: Element): string | null {
        let id = element.getAttribute("data-node-id");
        if (id) return id;

        if (element.classList.contains("protyle-wysiwyg")) {
            const protyleRoot = element.closest(".protyle") as any;
            const titleEl = protyleRoot?.querySelector(".protyle-top .protyle-title[data-node-id], .protyle-top .protyle-title");
            id = titleEl?.getAttribute("data-node-id") || titleEl?.closest("[data-node-id]")?.getAttribute("data-node-id") || null;
            if (!id) {
                id = protyleRoot?.protyle?.block?.rootID || null;
            }
        }

        if (!id && element.classList.contains("protyle-wysiwyg")) {
            const prev = element.previousElementSibling;
            if (prev?.classList.contains("protyle-top")) {
                const titleEl = prev.querySelector(".protyle-title");
                id = titleEl?.getAttribute("data-node-id") || titleEl?.closest("[data-node-id]")?.getAttribute("data-node-id") || null;
            }
        }

        if (!id) {
            id = element.closest("[data-node-id]")?.getAttribute("data-node-id") || null;
        }

        return id;
    }

    public _cleanupOrphanedButtons(protyle: any, activeBlocks?: Map<string, any>) {
        if (!activeBlocks) return;

        const activeBlockIds = new Set(activeBlocks.keys());
        const rootId = protyle?.block?.rootID;
        const trackedCandidates = Array.from(
            protyle?.element?.querySelectorAll?.(
                `[custom-task-projectid], [custom-bind-reminders], [custom-bind-milestones], [${BLOCK_POMODORO_COUNT_ATTR}], [${BLOCK_POMODORO_MINUTES_ATTR}]`
            ) || []
        ) as Element[];
        const docLevelAttrNode = trackedCandidates.find((node) => {
            const id = this._getBlockIdFromElement(node);
            return rootId ? id === rootId : !!id;
        }) || null;
        if (docLevelAttrNode) {
            const docBlockId = this._getBlockIdFromElement(docLevelAttrNode) || rootId;
            if (docBlockId) activeBlockIds.add(docBlockId);
        }

        const projectButtons = Array.from(protyle.element.querySelectorAll(".block-project-btn")) as HTMLElement[];
        const seen = new Set<string>();
        for (const btn of projectButtons) {
            const blockId = btn.dataset.blockId || btn.closest("[data-node-id]")?.getAttribute("data-node-id");
            const projectId = btn.dataset.projectId || btn.getAttribute("data-project-id") || "";
            const key = `${blockId || ""}|${projectId}`;

            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }

            if (seen.has(key)) {
                btn.remove();
                continue;
            }
            seen.add(key);
        }

        const bindButtons = Array.from(protyle.element.querySelectorAll(".block-bind-reminders-btn")) as HTMLElement[];
        const seenBind = new Set<string>();
        for (const btn of bindButtons) {
            const blockId = btn.dataset.blockId || btn.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenBind.has(blockId)) {
                btn.remove();
                continue;
            }
            seenBind.add(blockId);
        }

        const bindDateButtons = Array.from(protyle.element.querySelectorAll(".block-bind-reminder-date")) as HTMLElement[];
        const seenBindDate = new Set<string>();
        for (const btn of bindDateButtons) {
            const blockId = btn.dataset.blockId || btn.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenBindDate.has(blockId)) {
                btn.remove();
                continue;
            }
            seenBindDate.add(blockId);
        }

        const milestoneButtons = Array.from(protyle.element.querySelectorAll(".block-milestone-btn")) as HTMLElement[];
        const seenMilestone = new Set<string>();
        for (const btn of milestoneButtons) {
            const blockId = btn.dataset.blockId || btn.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenMilestone.has(blockId)) {
                btn.remove();
                continue;
            }
            seenMilestone.add(blockId);
        }

        const milestoneDateButtons = Array.from(protyle.element.querySelectorAll(".block-milestone-date")) as HTMLElement[];
        const seenMilestoneDate = new Set<string>();
        for (const btn of milestoneDateButtons) {
            const blockId = btn.dataset.blockId || btn.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenMilestoneDate.has(blockId)) {
                btn.remove();
                continue;
            }
            seenMilestoneDate.add(blockId);
        }

        const pomodoroSummaryButtons = Array.from(protyle.element.querySelectorAll(".block-pomodoro-summary")) as HTMLElement[];
        const seenPomodoroSummary = new Set<string>();
        for (const btn of pomodoroSummaryButtons) {
            const blockId = btn.dataset.blockId || btn.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenPomodoroSummary.has(blockId)) {
                btn.remove();
                continue;
            }
            seenPomodoroSummary.add(blockId);
        }
    }

    public _processBlockButtons(protyle: any, blockId: string, info: {
        projectIds: string[];
        hasBind: boolean;
        bindReminderIds?: string[];
        milestoneIds?: string[];
        milestoneProjectId?: string;
        pomodoroTotalCount?: number;
        pomodoroTotalMinutes?: number;
        element: Element
    }) {
        const blockEl = (info.element && info.element.getAttribute("data-node-id") === blockId)
            ? (info.element as HTMLElement)
            : (protyle.element.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement);

        if (!blockEl) return;

        const container = this._findButtonContainer(blockEl, info.element);
        if (!container) return;

        const existingProjectButtons = new Map<string, HTMLElement>();
        container.querySelectorAll(`.block-project-btn[data-block-id="${blockId}"]`).forEach((btn: HTMLElement) => {
            const pid = btn.dataset.projectId;
            if (pid) existingProjectButtons.set(pid, btn);
        });

        for (const pid of info.projectIds) {
            const existingBtn = existingProjectButtons.get(pid);
            if (!existingBtn) {
                const btn = this._createProjectButton(pid, blockId);
                container.appendChild(btn);
            } else if (existingBtn.parentElement !== container) {
                container.appendChild(existingBtn);
            }
        }

        for (const [pid, btn] of existingProjectButtons) {
            if (!info.projectIds.includes(pid)) {
                btn.remove();
            }
        }

        const linkedReminderIds = this.normalizeReminderIds(info.bindReminderIds).filter((id) => id !== blockId);
        const existingBindBtn = container.querySelector(`.block-bind-reminders-btn[data-block-id="${blockId}"]`) as HTMLElement;
        const existingBindDateBtn = container.querySelector(`.block-bind-reminder-date[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (linkedReminderIds.length > 0) {
            if (!existingBindBtn) {
                const bindBtn = this._createBindButton(blockId);
                container.appendChild(bindBtn);
            } else if (existingBindBtn.parentElement !== container) {
                container.appendChild(existingBindBtn);
            }
            if (existingBindDateBtn && existingBindDateBtn.parentElement !== container) {
                container.appendChild(existingBindDateBtn);
            }
            const syncDisplayInfo =
                this.getBoundReminderDateDisplayInfoSyncFromPlugin(linkedReminderIds) ||
                this.lastBoundReminderDateDisplayByBlock.get(blockId) ||
                null;
            if (syncDisplayInfo?.displayType === "completed") {
                this.lastBoundReminderDateDisplayByBlock.delete(blockId);
                if (existingBindDateBtn) {
                    existingBindDateBtn.remove();
                }
            } else if (syncDisplayInfo) {
                this.lastBoundReminderDateDisplayByBlock.set(blockId, syncDisplayInfo);
                if (!existingBindDateBtn) {
                    const dateBtn = this._createBindReminderDateButton(
                        blockId,
                        syncDisplayInfo.reminderId,
                        syncDisplayInfo.displayText,
                        syncDisplayInfo.displayType
                    );
                    this.ensureBindReminderDateButtonOrder(container, blockId, dateBtn);
                } else {
                    this._updateBindReminderDateButton(
                        existingBindDateBtn,
                        syncDisplayInfo.reminderId,
                        syncDisplayInfo.displayText,
                        syncDisplayInfo.displayType
                    );
                    this.ensureBindReminderDateButtonOrder(container, blockId, existingBindDateBtn);
                }
            }
            void this.refreshBindReminderDateButton(protyle, blockId, linkedReminderIds);
        } else if (existingBindBtn) {
            existingBindBtn.remove();
            if (existingBindDateBtn) {
                existingBindDateBtn.remove();
            }
            this.lastBoundReminderDateDisplayByBlock.delete(blockId);
        } else if (existingBindDateBtn) {
            existingBindDateBtn.remove();
            this.lastBoundReminderDateDisplayByBlock.delete(blockId);
        }

        const existingMilestoneBtn = container.querySelector(`.block-milestone-btn[data-block-id="${blockId}"]`) as HTMLElement;
        const existingMilestoneDateBtn = container.querySelector(`.block-milestone-date[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (info.milestoneIds && info.milestoneIds.length > 0 && info.milestoneProjectId) {
            if (!existingMilestoneBtn) {
                const milestoneBtn = this._createMilestoneButton(blockId, info.milestoneProjectId, info.milestoneIds);
                container.appendChild(milestoneBtn);
            } else {
                if (existingMilestoneBtn.parentElement !== container) {
                    container.appendChild(existingMilestoneBtn);
                }
            }
            if (existingMilestoneDateBtn) {
                existingMilestoneDateBtn.remove();
            }
            const syncMilestoneDateInfo =
                this.getMilestoneDateDisplayInfoSync(info.milestoneProjectId, info.milestoneIds) ||
                this.lastMilestoneDateDisplayByBlock.get(blockId) ||
                null;
            const milestoneBtn = (container.querySelector(`.block-milestone-btn[data-block-id="${blockId}"]`) as HTMLElement | null);
            if (syncMilestoneDateInfo) {
                this.lastMilestoneDateDisplayByBlock.set(blockId, syncMilestoneDateInfo);
                if (milestoneBtn) {
                    this._updateMilestoneButton(
                        milestoneBtn,
                        info.milestoneProjectId,
                        info.milestoneIds,
                        syncMilestoneDateInfo.displayText
                    );
                }
            } else if (milestoneBtn) {
                this.lastMilestoneDateDisplayByBlock.delete(blockId);
                this._updateMilestoneButton(milestoneBtn, info.milestoneProjectId, info.milestoneIds, "");
            }
            void this.refreshMilestoneDateButton(protyle, blockId, info.milestoneProjectId, info.milestoneIds);
        } else if (existingMilestoneBtn) {
            existingMilestoneBtn.remove();
            if (existingMilestoneDateBtn) {
                existingMilestoneDateBtn.remove();
            }
            this.lastMilestoneDateDisplayByBlock.delete(blockId);
        } else if (existingMilestoneDateBtn) {
            existingMilestoneDateBtn.remove();
            this.lastMilestoneDateDisplayByBlock.delete(blockId);
        }

        const selfPomodoroCount = Math.max(0, Math.floor(Number(info.pomodoroTotalCount || 0)));
        const selfPomodoroMinutes = Math.max(0, Math.floor(Number(info.pomodoroTotalMinutes || 0)));
        const linkedPomodoroStats = this.getBoundPomodoroStatsFromCache(linkedReminderIds);
        const pomodoroTotalCount = selfPomodoroCount + linkedPomodoroStats.count;
        const pomodoroTotalMinutes = selfPomodoroMinutes + linkedPomodoroStats.minutes;
        const hasPomodoroSummary = pomodoroTotalCount > 0 || pomodoroTotalMinutes > 0;
        const existingPomodoroBtn = container.querySelector(`.block-pomodoro-summary[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (hasPomodoroSummary) {
            if (!existingPomodoroBtn) {
                const pomodoroBtn = this._createPomodoroSummaryButton(blockId, pomodoroTotalCount, pomodoroTotalMinutes, linkedReminderIds);
                container.appendChild(pomodoroBtn);
            } else {
                const prevCount = this.parsePomodoroMetric(existingPomodoroBtn.dataset.pomodoroTotalCount);
                const prevMinutes = this.parsePomodoroMetric(existingPomodoroBtn.dataset.pomodoroTotalMinutes);
                const prevReminderIdsKey = this.getReminderIdsKey(existingPomodoroBtn.dataset.pomodoroIncludeEventIds);
                const nextReminderIdsKey = this.getReminderIdsKey(linkedReminderIds);
                if (prevCount !== pomodoroTotalCount || prevMinutes !== pomodoroTotalMinutes || prevReminderIdsKey !== nextReminderIdsKey) {
                    this._updatePomodoroSummaryButton(existingPomodoroBtn, pomodoroTotalCount, pomodoroTotalMinutes, linkedReminderIds);
                }
                if (existingPomodoroBtn.parentElement !== container) {
                    container.appendChild(existingPomodoroBtn);
                }
            }
        } else if (existingPomodoroBtn) {
            existingPomodoroBtn.remove();
        }

        void this.refreshPomodoroSummaryWithMergedSessions(
            protyle,
            blockId,
            selfPomodoroCount,
            selfPomodoroMinutes,
            linkedReminderIds
        );
    }

    private async refreshPomodoroSummaryWithMergedSessions(
        protyle: any,
        blockId: string,
        selfPomodoroCount: number,
        selfPomodoroMinutes: number,
        linkedReminderIds: string[]
    ) {
        const nextTaskId = (this.latestPomodoroSummaryTaskByBlock.get(blockId) || 0) + 1;
        this.latestPomodoroSummaryTaskByBlock.set(blockId, nextTaskId);
        try {
            await this.ensurePomodoroStatsCache();
        } catch {
            return;
        }
        if (this.latestPomodoroSummaryTaskByBlock.get(blockId) !== nextTaskId) {
            return;
        }

        const linkedStats = this.getBoundPomodoroStatsFromCache(linkedReminderIds);
        const mergedCount = Math.max(0, Math.floor(selfPomodoroCount + linkedStats.count));
        const mergedMinutes = Math.max(0, Math.floor(selfPomodoroMinutes + linkedStats.minutes));
        const hasPomodoroSummary = mergedCount > 0 || mergedMinutes > 0;

        const trackedSource =
            this._findTrackedSourceForBlock(protyle, blockId) ||
            (protyle?.element?.querySelector?.(".protyle-wysiwyg") as Element | null);
        const blockEl = (protyle?.element?.querySelector?.(`[data-node-id="${blockId}"]`) as HTMLElement | null) ||
            (trackedSource as HTMLElement | null);
        if (!trackedSource || !blockEl) return;

        const container = this._findButtonContainer(blockEl, trackedSource);
        if (!container) return;

        const existingPomodoroBtn = container.querySelector(`.block-pomodoro-summary[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (!hasPomodoroSummary) {
            if (existingPomodoroBtn) {
                existingPomodoroBtn.remove();
            }
            return;
        }

        if (!existingPomodoroBtn) {
            container.appendChild(this._createPomodoroSummaryButton(blockId, mergedCount, mergedMinutes, linkedReminderIds));
            return;
        }
        this._updatePomodoroSummaryButton(existingPomodoroBtn, mergedCount, mergedMinutes, linkedReminderIds);
        if (existingPomodoroBtn.parentElement !== container) {
            container.appendChild(existingPomodoroBtn);
        }
    }

    public _findButtonContainer(blockEl: HTMLElement, sourceElement: Element): HTMLElement | null {
        const isDocumentLevel = sourceElement.classList.contains("protyle-wysiwyg");

        if (isDocumentLevel) {
            const protyleRoot = sourceElement.closest(".protyle");
            if (protyleRoot) {
                const titleElement = protyleRoot.querySelector(".protyle-top .protyle-title.protyle-wysiwyg--attr") ||
                    protyleRoot.querySelector(".protyle-top .protyle-title");
                if (!titleElement) return null;
                const attr = Array.from(titleElement.children).find((c) => c.classList.contains("protyle-attr"));
                return (attr || titleElement) as HTMLElement;
            }
        } else {
            const directAttr = Array.from(blockEl.children).find((child) => child.classList.contains("protyle-attr"));
            if (directAttr) return directAttr as HTMLElement;

            return (blockEl.querySelector(".protyle-title") || blockEl.firstElementChild) as HTMLElement;
        }

        return null;
    }

    private async getBoundReminderDateDisplayInfoFromPlugin(reminderIds: string[]): Promise<BoundReminderDateDisplayInfo | null> {
        if (!this.plugin || typeof this.plugin.getBoundReminderDateDisplayInfo !== "function") return null;
        const info = await this.plugin.getBoundReminderDateDisplayInfo(reminderIds);
        if (!info || typeof info !== "object") return null;
        const reminderId = String((info as any).reminderId || "").trim();
        const displayText = String((info as any).displayText || "").trim();
        const displayType = (info as any).displayType === "completed" ? "completed" : "schedule";
        if (!reminderId || !displayText) return null;
        return {
            reminderId,
            displayText,
            displayType
        };
    }

    private getBoundReminderDateDisplayInfoSyncFromPlugin(reminderIds: string[]): BoundReminderDateDisplayInfo | null {
        if (!this.plugin || typeof this.plugin.getBoundReminderDateDisplayInfoSync !== "function") return null;
        const info = this.plugin.getBoundReminderDateDisplayInfoSync(reminderIds);
        if (!info || typeof info !== "object") return null;
        const reminderId = String((info as any).reminderId || "").trim();
        const displayText = String((info as any).displayText || "").trim();
        const displayType = (info as any).displayType === "completed" ? "completed" : "schedule";
        if (!reminderId || !displayText) return null;
        return {
            reminderId,
            displayText,
            displayType
        };
    }

    private getMilestoneDateDisplayInfoSync(projectId: string, milestoneIds: string[]): MilestoneDateDisplayInfo | null {
        try {
            const projectManager = ProjectManager.getInstance(this.plugin);
            return projectManager.getMilestoneDateDisplayInfoSync(projectId, milestoneIds);
        } catch (error) {
            console.warn("同步获取里程碑日期展示信息失败:", error);
            return null;
        }
    }

    private async getMilestoneDateDisplayInfo(projectId: string, milestoneIds: string[]): Promise<MilestoneDateDisplayInfo | null> {
        try {
            const projectManager = ProjectManager.getInstance(this.plugin);
            return await projectManager.getMilestoneDateDisplayInfo(projectId, milestoneIds);
        } catch (error) {
            console.warn("获取里程碑日期展示信息失败:", error);
            return null;
        }
    }

    private async refreshMilestoneDateButton(protyle: any, blockId: string, projectId: string, milestoneIds: string[]) {
        const normalizedMilestoneIds = this.normalizeReminderIds(milestoneIds);
        const nextTaskId = (this.latestMilestoneDateTaskByBlock.get(blockId) || 0) + 1;
        this.latestMilestoneDateTaskByBlock.set(blockId, nextTaskId);
        if (!projectId || normalizedMilestoneIds.length === 0) {
            this.lastMilestoneDateDisplayByBlock.delete(blockId);
            const legacyDateBtn = protyle?.element?.querySelector?.(`.block-milestone-date[data-block-id="${blockId}"]`) as HTMLElement | null;
            if (legacyDateBtn) legacyDateBtn.remove();
            const existingBtn = protyle?.element?.querySelector?.(`.block-milestone-btn[data-block-id="${blockId}"]`) as HTMLElement | null;
            if (existingBtn) this._updateMilestoneButton(existingBtn, projectId, normalizedMilestoneIds, "");
            return;
        }

        const displayInfo = await this.getMilestoneDateDisplayInfo(projectId, normalizedMilestoneIds);
        if (this.latestMilestoneDateTaskByBlock.get(blockId) !== nextTaskId) {
            return;
        }

        const trackedSource =
            this._findTrackedSourceForBlock(protyle, blockId) ||
            (protyle?.element?.querySelector?.(".protyle-wysiwyg") as Element | null);
        const blockEl = (protyle?.element?.querySelector?.(`[data-node-id="${blockId}"]`) as HTMLElement | null) ||
            (trackedSource as HTMLElement | null);
        if (!trackedSource || !blockEl) return;

        const container = this._findButtonContainer(blockEl, trackedSource);
        if (!container) return;

        const legacyDateBtn = container.querySelector(`.block-milestone-date[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (legacyDateBtn) legacyDateBtn.remove();
        const existingBtn = container.querySelector(`.block-milestone-btn[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (!displayInfo) {
            this.lastMilestoneDateDisplayByBlock.delete(blockId);
            if (existingBtn) {
                this._updateMilestoneButton(existingBtn, projectId, normalizedMilestoneIds, "");
            }
            return;
        }

        this.lastMilestoneDateDisplayByBlock.set(blockId, displayInfo);

        if (existingBtn) {
            this._updateMilestoneButton(existingBtn, projectId, normalizedMilestoneIds, displayInfo.displayText);
        }
    }

    private async refreshBindReminderDateButton(protyle: any, blockId: string, reminderIds: string[]) {
        const normalizedReminderIds = this.normalizeReminderIds(reminderIds);
        const nextTaskId = (this.latestBindReminderDateTaskByBlock.get(blockId) || 0) + 1;
        this.latestBindReminderDateTaskByBlock.set(blockId, nextTaskId);
        if (normalizedReminderIds.length === 0) {
            this.lastBoundReminderDateDisplayByBlock.delete(blockId);
            const existingDateBtn = protyle?.element?.querySelector?.(`.block-bind-reminder-date[data-block-id="${blockId}"]`) as HTMLElement | null;
            if (existingDateBtn) existingDateBtn.remove();
            return;
        }

        let displayInfo: BoundReminderDateDisplayInfo | null = null;
        try {
            displayInfo = await this.getBoundReminderDateDisplayInfoFromPlugin(normalizedReminderIds);
        } catch (error) {
            console.warn("获取绑定任务日期展示信息失败:", error);
            return;
        }

        if (this.latestBindReminderDateTaskByBlock.get(blockId) !== nextTaskId) {
            return;
        }

        const trackedSource =
            this._findTrackedSourceForBlock(protyle, blockId) ||
            (protyle?.element?.querySelector?.(".protyle-wysiwyg") as Element | null);
        const blockEl = (protyle?.element?.querySelector?.(`[data-node-id="${blockId}"]`) as HTMLElement | null) ||
            (trackedSource as HTMLElement | null);
        if (!trackedSource || !blockEl) return;

        const container = this._findButtonContainer(blockEl, trackedSource);
        if (!container) return;

        const existingDateBtn = container.querySelector(`.block-bind-reminder-date[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (!displayInfo || displayInfo.displayType === "completed") {
            this.lastBoundReminderDateDisplayByBlock.delete(blockId);
            if (existingDateBtn) existingDateBtn.remove();
            return;
        }

        this.lastBoundReminderDateDisplayByBlock.set(blockId, displayInfo);

        if (!existingDateBtn) {
            const dateBtn = this._createBindReminderDateButton(
                blockId,
                displayInfo.reminderId,
                displayInfo.displayText,
                displayInfo.displayType
            );
            this.ensureBindReminderDateButtonOrder(container, blockId, dateBtn);
            return;
        }

        this._updateBindReminderDateButton(existingDateBtn, displayInfo.reminderId, displayInfo.displayText, displayInfo.displayType);
        this.ensureBindReminderDateButtonOrder(container, blockId, existingDateBtn);
    }

    private ensureBindReminderDateButtonOrder(container: HTMLElement, blockId: string, dateBtn: HTMLElement) {
        const bindBtn = container.querySelector(`.block-bind-reminders-btn[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (bindBtn) {
            const nextElement = bindBtn.nextElementSibling;
            if (nextElement !== dateBtn) {
                if (nextElement) {
                    container.insertBefore(dateBtn, nextElement);
                } else {
                    container.appendChild(dateBtn);
                }
            } else if (dateBtn.parentElement !== container) {
                container.appendChild(dateBtn);
            }
            return;
        }
        if (dateBtn.parentElement !== container) {
            container.appendChild(dateBtn);
        }
    }

    public _createBindReminderDateButton(
        blockId: string,
        reminderId: string,
        displayText: string,
        displayType: "schedule" | "completed" = "schedule"
    ): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "block-bind-reminder-date block__icon fn__flex-center ariaLabel";
        btn.style.cssText = `
            margin-left: 6px;
            padding: 1px 6px;
            border: none;
            background: var(--b3-theme-surface-lighter);
            cursor: pointer;
            border-radius: 11px;
            color: var(--b3-theme-on-background);
            opacity: 0.9;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 22px;
            line-height: 1;
            max-width: 280px;
        `;
        btn.dataset.blockId = blockId;
        btn.setAttribute("data-plugin-added", "reminder-plugin");
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetReminderId = String(btn.dataset.reminderId || "").trim();
            if (!targetReminderId) return;
            try {
                if (this.plugin && typeof this.plugin.openReminderEditDialog === "function") {
                    await this.plugin.openReminderEditDialog(blockId, targetReminderId);
                    return;
                }

                const reminderData = await this.plugin.loadReminderData();
                const reminder = reminderData?.[targetReminderId];
                if (!reminder) {
                    showMessage(i18n("taskNotFound") || "任务不存在", 3000, "error");
                    return;
                }
                const { QuickReminderDialog } = await import("../components/QuickReminderDialog");
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId,
                    reminder,
                    plugin: this.plugin,
                    mode: "edit"
                });
                dialog.show();
            } catch (error) {
                console.error("打开绑定任务日期编辑对话框失败:", error);
                showMessage(i18n("openModifyDialogFailed") || "打开修改对话框失败，请重试", 3000, "error");
            }
        });

        const textEl = document.createElement("span");
        textEl.className = "block-bind-reminder-date__text";
        textEl.style.cssText = "font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        btn.appendChild(textEl);
        this._updateBindReminderDateButton(btn, reminderId, displayText, displayType);
        return btn;
    }

    public _updateBindReminderDateButton(
        btn: HTMLElement,
        reminderId: string,
        displayText: string,
        displayType: "schedule" | "completed" = "schedule"
    ) {
        const safeReminderId = String(reminderId || "").trim();
        const safeDisplayText = String(displayText || "").trim();
        const safeDisplayType = displayType === "completed" ? "completed" : "schedule";
        const prefix = safeDisplayType === "completed" ? "✅" : "🗓";
        const text = safeDisplayText ? `${prefix} ${safeDisplayText}` : prefix;
        const ariaText = safeDisplayType === "completed"
            ? `最近完成时间 ${safeDisplayText}，点击编辑任务日期`
            : `任务安排时间 ${safeDisplayText}，点击编辑任务日期`;

        if (btn.dataset.reminderId !== safeReminderId) {
            btn.dataset.reminderId = safeReminderId;
        }
        if (btn.dataset.displayType !== safeDisplayType) {
            btn.dataset.displayType = safeDisplayType;
        }
        if (btn.dataset.displayText !== safeDisplayText) {
            btn.dataset.displayText = safeDisplayText;
        }
        if (btn.title !== safeDisplayText) {
            btn.title = safeDisplayText;
        }

        let textEl = btn.querySelector(".block-bind-reminder-date__text") as HTMLElement | null;
        if (!textEl) {
            textEl = document.createElement("span");
            textEl.className = "block-bind-reminder-date__text";
            textEl.style.cssText = "font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            btn.appendChild(textEl);
        }
        if (textEl.textContent !== text) {
            textEl.textContent = text;
        }
        btn.classList.add("ariaLabel");
        if (btn.getAttribute("aria-label") !== ariaText) {
            btn.setAttribute("aria-label", ariaText);
        }
    }

    public _createPomodoroSummaryButton(blockId: string, totalCount: number, totalMinutes: number, includeEventIds: string[] = []): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "block-pomodoro-summary block__icon fn__flex-center ariaLabel";
        btn.style.cssText = `
            margin-left: 6px;
            padding: 1px 6px;
            border: none;
            background: var(--b3-theme-surface-lighter);
            cursor: pointer;
            border-radius: 11px;
            color: var(--b3-theme-on-background);
            opacity: 0.9;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 22px;
            line-height: 1;
            max-width: 200px;
        `;
        btn.dataset.blockId = blockId;
        btn.setAttribute("data-plugin-added", "reminder-plugin");
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const { PomodoroSessionsDialog } = await import("../components/PomodoroSessionsDialog");
                const linkedEventIds = this.normalizeReminderIds(btn.dataset.pomodoroIncludeEventIds);
                const includeInstances = btn.dataset.pomodoroIncludeInstances === "true";
                const dialog = new PomodoroSessionsDialog(
                    blockId,
                    this.plugin,
                    () => window.dispatchEvent(new CustomEvent("reminderUpdated")),
                    includeInstances,
                    {
                        defaultAddEventId: blockId,
                        includeEventIds: linkedEventIds,
                        dialogTitle: `🍅 ${i18n("viewPomodoros") || "番茄钟记录"}`
                    }
                );
                await dialog.show();
            } catch (error) {
                console.error("打开番茄记录对话框失败:", error);
                showMessage(i18n("operationFailed") || "操作失败", 3000);
            }
        });
        const textEl = document.createElement("span");
        textEl.className = "block-pomodoro-summary__text";
        textEl.style.cssText = "font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        btn.appendChild(textEl);
        this._updatePomodoroSummaryButton(btn, totalCount, totalMinutes, includeEventIds);
        return btn;
    }

    public _updatePomodoroSummaryButton(btn: HTMLElement, totalCount: number, totalMinutes: number, includeEventIds: string[] = []) {
        const text = this.getPomodoroSummaryText(totalCount, totalMinutes);
        const ariaText = `番茄总数 ${totalCount}，番茄总时长 ${this.formatPomodoroDuration(totalMinutes)}`;
        const countStr = String(totalCount);
        const minutesStr = String(totalMinutes);
        const normalizedEventIds = this.normalizeReminderIds(includeEventIds);
        const includeEventIdsStr = normalizedEventIds.join(",");
        if (btn.dataset.pomodoroTotalCount !== countStr) {
            btn.dataset.pomodoroTotalCount = countStr;
        }
        if (btn.dataset.pomodoroTotalMinutes !== minutesStr) {
            btn.dataset.pomodoroTotalMinutes = minutesStr;
        }
        if (btn.dataset.pomodoroIncludeEventIds !== includeEventIdsStr) {
            btn.dataset.pomodoroIncludeEventIds = includeEventIdsStr;
        }
        if (btn.dataset.pomodoroIncludeInstances !== "true") {
            btn.dataset.pomodoroIncludeInstances = "true";
        }
        let textEl = btn.querySelector(".block-pomodoro-summary__text") as HTMLElement | null;
        if (!textEl) {
            textEl = document.createElement("span");
            textEl.className = "block-pomodoro-summary__text";
            textEl.style.cssText = "font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            btn.appendChild(textEl);
        }
        if (textEl.textContent !== text) {
            textEl.textContent = text;
        }
        btn.classList.add("ariaLabel");
        if (btn.getAttribute("aria-label") !== ariaText) {
            btn.setAttribute("aria-label", ariaText);
        }
    }

    public _createProjectButton(projectId: string, blockId: string): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "block-project-btn block__icon fn__flex-center ariaLabel";
        btn.setAttribute("aria-label", `打开项目看板: ${this.plugin.projectDataCache[projectId]?.title}`);
        btn.style.cssText = `
            margin-left: 6px;
            padding: 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 3px;
            color: var(--b3-theme-on-background);
            opacity: 0.85;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
        `;
        btn.innerHTML = `<svg class="b3-list-item__graphic" style="width:14px;height:14px"><use xlink:href="#iconProject"></use></svg>`;
        btn.dataset.projectId = projectId;
        btn.dataset.blockId = blockId;
        btn.setAttribute("data-plugin-added", "reminder-plugin");
        btn.classList.add('ariaLabel'); btn.setAttribute('aria-label', i18n("openProjectKanban"));

        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const projectData = await this.plugin.loadProjectData();
                const project = projectData[projectId];
                const title = project ? project.title : projectId;
                this.plugin.openProjectKanbanTab(projectId, title);
            } catch (error) {
                console.error("打开项目看板失败:", error);
                this.plugin.openProjectKanbanTab(projectId, projectId);
            }
        });

        return btn;
    }

    public _createBindButton(blockId: string): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "block-bind-reminders-btn block__icon fn__flex-center ariaLabel";
        btn.setAttribute("aria-label", "查看绑定任务");
        btn.style.cssText = `
            margin-left: 6px;
            padding: 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 3px;
            color: var(--b3-theme-on-background);
            opacity: 0.85;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
        `;
        btn.innerHTML = `<span style="font-size:14px;line-height:1">📋</span>`;
        btn.dataset.blockId = blockId;
        btn.setAttribute("data-plugin-added", "reminder-plugin");
        btn.classList.add('ariaLabel'); btn.setAttribute('aria-label', "查看绑定任务");

        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const { BlockRemindersDialog } = await import("../components/BlockRemindersDialog");
                const dialog = new BlockRemindersDialog(blockId, this.plugin);
                await dialog.show();
            } catch (err) {
                console.error("打开块绑定任务对话框失败:", err);
            }
        });

        return btn;
    }

    private async openMilestoneTasksDialog(projectId: string, milestoneIds: string[]) {
        const normalizedMilestoneIds = this.normalizeReminderIds(milestoneIds);
        const firstMilestoneId = normalizedMilestoneIds[0];
        if (!firstMilestoneId) return;

        const projectData = await this.plugin.loadProjectData();
        const project = projectData[projectId];

        let milestone: any = null;
        let groupId: string | null = null;

        if (project?.milestones) {
            milestone = project.milestones.find((m: any) => m.id === firstMilestoneId);
        }

        if (!milestone) {
            const projectManager = ProjectManager.getInstance(this.plugin);
            const groups = await projectManager.getProjectCustomGroups(projectId);

            for (const group of groups) {
                if (group.milestones) {
                    milestone = group.milestones.find((m: any) => m.id === firstMilestoneId);
                    if (milestone) {
                        groupId = group.id;
                        break;
                    }
                }
            }
        }

        if (!milestone) {
            console.warn("Milestone not found:", firstMilestoneId);
            return;
        }

        const tabId = this.plugin.name + PROJECT_KANBAN_TAB_TYPE + projectId;
        const kanbanView = this.plugin.tabViews.get(tabId);

        if (kanbanView && typeof kanbanView.showMilestoneTasksDialog === "function") {
            await kanbanView.showMilestoneTasksDialog(milestone, groupId);
            return;
        }

        const { ProjectKanbanView } = await import("../components/ProjectKanbanView");
        const tempContainer = document.createElement("div");
        const tempView = new ProjectKanbanView(tempContainer, this.plugin, projectId);
        await tempView.showMilestoneTasksDialog(milestone, groupId);
    }

    public _createMilestoneButton(blockId: string, projectId: string, milestoneIds: string[]): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "block-milestone-btn block__icon fn__flex-center ariaLabel";
        btn.dataset.blockId = blockId;
        btn.setAttribute("data-plugin-added", "reminder-plugin");

        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const targetProjectId = String(btn.dataset.projectId || "").trim();
                const targetMilestoneIds = this.normalizeReminderIds(btn.dataset.milestoneIds);
                if (!targetProjectId || targetMilestoneIds.length === 0) return;
                await this.openMilestoneTasksDialog(targetProjectId, targetMilestoneIds);
            } catch (err) {
                console.error("打开里程碑任务对话框失败:", err);
            }
        });

        const textEl = document.createElement("span");
        textEl.className = "block-milestone-btn__text";
        textEl.style.cssText = "font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        btn.appendChild(textEl);
        this._updateMilestoneButton(btn, projectId, milestoneIds, "");
        return btn;
    }

    public _updateMilestoneButton(
        btn: HTMLElement,
        projectId: string,
        milestoneIds: string[],
        displayText: string = ""
    ) {
        const safeProjectId = String(projectId || "").trim();
        const safeMilestoneIds = this.normalizeReminderIds(milestoneIds);
        const milestoneIdsText = safeMilestoneIds.join(",");
        const safeDisplayText = String(displayText || "").trim();
        const text = safeDisplayText ? `🚩 ${safeDisplayText}` : "🚩";
        const ariaText = safeDisplayText
            ? `查看里程碑任务，日期 ${safeDisplayText}`
            : "查看里程碑任务";

        if (btn.dataset.projectId !== safeProjectId) {
            btn.dataset.projectId = safeProjectId;
        }
        if (btn.dataset.milestoneIds !== milestoneIdsText) {
            btn.dataset.milestoneIds = milestoneIdsText;
        }
        if (btn.dataset.displayText !== safeDisplayText) {
            btn.dataset.displayText = safeDisplayText;
        }

        btn.style.cssText = `
            margin-left: 6px;
            padding: 1px 6px;
            border: none;
            background: var(--b3-theme-surface-lighter);
            cursor: pointer;
            border-radius: 11px;
            color: var(--b3-theme-on-background);
            opacity: 0.9;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 22px;
            line-height: 1;
            max-width: 280px;
        `;

        if (btn.title !== safeDisplayText) {
            btn.title = safeDisplayText;
        }

        let textEl = btn.querySelector(".block-milestone-btn__text") as HTMLElement | null;
        if (!textEl) {
            textEl = document.createElement("span");
            textEl.className = "block-milestone-btn__text";
            textEl.style.cssText = "font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            btn.appendChild(textEl);
        }
        if (textEl.textContent !== text) {
            textEl.textContent = text;
        }
        btn.classList.add("ariaLabel");
        if (btn.getAttribute("aria-label") !== ariaText) {
            btn.setAttribute("aria-label", ariaText);
        }
    }

}
