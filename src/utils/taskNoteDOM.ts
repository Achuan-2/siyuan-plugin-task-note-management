import { i18n } from "../pluginInstance";

const PROJECT_KANBAN_TAB_TYPE = "project_kanban_tab";

export class TaskNoteDOMManager {
    private plugin: any;

    private processingBlockButtons: Set<string> = new Set();
    private outlinePrefixCache: Map<string, string> = new Map();
    private protyleObservers: WeakMap<Element, MutationObserver> = new WeakMap();
    private protyleDebounceTimers: WeakMap<Element, number> = new WeakMap();
    private currentHeadingIds: Set<string> = new Set();

    constructor(plugin: any) {
        this.plugin = plugin;
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
            if (data.cmd === "transactions" && data.data) {
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

        const blockEl = (node.hasAttribute("data-node-id") ? node : node.closest("[data-node-id]")) as HTMLElement;
        if (!blockEl) return;

        const blockId = blockEl.getAttribute("data-node-id");
        if (!blockId) return;

        const rawAttr = blockEl.getAttribute("custom-task-projectid");
        const hasBind = blockEl.hasAttribute("custom-bind-reminders");
        const rawMilestones = blockEl.getAttribute("custom-bind-milestones");
        const milestoneProjectId = blockEl.getAttribute("custom-task-projectid");

        const projectIds = rawAttr ? rawAttr.split(",").map((s) => s.trim()).filter((s) => s) : [];
        const milestoneIds = rawMilestones ? rawMilestones.split(",").map((s) => s.trim()).filter((s) => s) : [];

        const info = {
            projectIds,
            hasBind,
            milestoneIds,
            milestoneProjectId: milestoneProjectId || undefined,
            element: blockEl,
        };

        if (!rawAttr && !hasBind && !rawMilestones) {
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

            const selector = "div[data-node-id][custom-task-projectid], .protyle-wysiwyg[custom-task-projectid], div[data-node-id][custom-bind-reminders], .protyle-wysiwyg[custom-bind-reminders], div[data-node-id][custom-bind-milestones], .protyle-wysiwyg[custom-bind-milestones]";
            const allBlocks = Array.from(protyle.element.querySelectorAll(selector)) as Element[];

            if (allBlocks.length === 0) {
                this._cleanupOrphanedButtons(protyle);
                return;
            }

            const blocksToProcess = new Map<string, { projectIds: string[]; hasBind: boolean; milestoneIds: string[]; milestoneProjectId?: string; element: Element }>();

            for (const node of allBlocks) {
                const blockId = node.getAttribute("data-node-id") || this._getBlockIdFromElement(node);
                if (!blockId) continue;

                const rawAttr = node.getAttribute("custom-task-projectid");
                const projectIds = rawAttr ? rawAttr.split(",").map((s) => s.trim()).filter((s) => s) : [];
                const hasBind = node.hasAttribute("custom-bind-reminders");
                const rawMilestones = node.getAttribute("custom-bind-milestones");
                const milestoneIds = rawMilestones ? rawMilestones.split(",").map((s) => s.trim()).filter((s) => s) : [];
                const milestoneProjectId = node.getAttribute("custom-task-projectid") || undefined;

                blocksToProcess.set(blockId, {
                    projectIds,
                    hasBind,
                    milestoneIds,
                    milestoneProjectId,
                    element: node,
                });
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
                                    const relevantChildren = el.querySelectorAll?.("div[data-node-id][custom-task-projectid], div[data-node-id][custom-bind-reminders], .protyle-wysiwyg[custom-task-projectid], .protyle-wysiwyg[custom-bind-reminders]");
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
                attributeFilter: ["custom-task-projectid", "custom-bind-reminders", "custom-bind-milestones", "updated", "bookmark"],
            });

            const attrObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
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

    public _getBlockIdFromElement(element: Element): string | null {
        let id = element.getAttribute("data-node-id");
        if (id) return id;

        if (element.classList.contains("protyle-wysiwyg")) {
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
    }

    public _processBlockButtons(protyle: any, blockId: string, info: { projectIds: string[]; hasBind: boolean; milestoneIds?: string[]; milestoneProjectId?: string; element: Element }) {
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

        const existingBindBtn = container.querySelector(`.block-bind-reminders-btn[data-block-id="${blockId}"]`) as HTMLElement;
        if (info.hasBind) {
            if (!existingBindBtn) {
                const bindBtn = this._createBindButton(blockId);
                container.appendChild(bindBtn);
            } else if (existingBindBtn.parentElement !== container) {
                container.appendChild(existingBindBtn);
            }
        } else if (existingBindBtn) {
            existingBindBtn.remove();
        }

        const existingMilestoneBtn = container.querySelector(`.block-milestone-btn[data-block-id="${blockId}"]`) as HTMLElement;
        if (info.milestoneIds && info.milestoneIds.length > 0 && info.milestoneProjectId) {
            if (!existingMilestoneBtn) {
                const milestoneBtn = this._createMilestoneButton(blockId, info.milestoneProjectId, info.milestoneIds);
                container.appendChild(milestoneBtn);
            } else {
                existingMilestoneBtn.dataset.milestoneIds = info.milestoneIds.join(",");
                existingMilestoneBtn.dataset.projectId = info.milestoneProjectId;
                if (existingMilestoneBtn.parentElement !== container) {
                    container.appendChild(existingMilestoneBtn);
                }
            }
        } else if (existingMilestoneBtn) {
            existingMilestoneBtn.remove();
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
        btn.title = i18n("openProjectKanban");

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
        btn.title = "查看绑定任务";

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

    public _createMilestoneButton(blockId: string, projectId: string, milestoneIds: string[]): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "block-milestone-btn block__icon fn__flex-center ariaLabel";
        btn.setAttribute("aria-label", "查看里程碑任务");
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
        btn.innerHTML = `<span style="font-size:14px;line-height:1">🚩</span>`;
        btn.dataset.blockId = blockId;
        btn.dataset.projectId = projectId;
        btn.dataset.milestoneIds = milestoneIds.join(",");
        btn.setAttribute("data-plugin-added", "reminder-plugin");
        btn.title = "查看里程碑任务";

        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const firstMilestoneId = milestoneIds[0];
                if (!firstMilestoneId) return;

                const projectData = await this.plugin.loadProjectData();
                const project = projectData[projectId];

                let milestone: any = null;
                let groupId: string | null = null;

                if (project?.milestones) {
                    milestone = project.milestones.find((m: any) => m.id === firstMilestoneId);
                }

                if (!milestone) {
                    const { ProjectManager } = await import("./projectManager");
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
                let kanbanView = this.plugin.tabViews.get(tabId);

                if (kanbanView && typeof kanbanView.showMilestoneTasksDialog === "function") {
                    await kanbanView.showMilestoneTasksDialog(milestone, groupId);
                } else {
                    const { ProjectKanbanView } = await import("../components/ProjectKanbanView");
                    const tempContainer = document.createElement("div");
                    const tempView = new ProjectKanbanView(tempContainer, this.plugin, projectId);
                    await tempView.showMilestoneTasksDialog(milestone, groupId);
                }
            } catch (err) {
                console.error("打开里程碑任务对话框失败:", err);
            }
        });

        return btn;
    }
}
