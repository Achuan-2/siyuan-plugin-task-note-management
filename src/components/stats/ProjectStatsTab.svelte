<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { Menu, showMessage } from "siyuan";
    import { i18n } from "../../pluginInstance";
    import { ProjectManager } from "../dataManager/projectManager";
    import { CategoryManager } from "../dataManager/categoryManager";
    import { ProjectFolderManager } from "../dataManager/projectFolderManager";
    import { PomodoroRecordManager } from "../dataManager/pomodoroRecord";
    import { ProjectKanbanView } from "../panel/ProjectKanbanView";
    import { ProjectDialog } from "../dialog/ProjectDialog";
    import { getAllReminders } from "../../utils/icsSubscription";
    import ProjectStatCard from "./ProjectStatCard.svelte";
    import {
        parseTitle,
        countProjectTotalPomodoro,
        countProjectTotalFocusTime,
    } from "../dialog/ProjectStatsDialog";

    export let plugin: any;

    type StatusCount = {
        id: string;
        name: string;
        icon: string;
        count: number;
    };

    type ProjectStatItem = {
        id: string;
        project: any;
        title: string;
        emoji: string;
        color: string;
        priority: string;
        priorityLabel: string;
        statusCounts: StatusCount[];
        percentage: number;
        pomodoro: number;
        focusText: string;
        statusId: string;
        statusName: string;
        statusIcon: string;
        categories: { id: string; name: string; icon: string; color: string }[];
    };

    type FolderViewNode = {
        folder: any;
        items: ProjectStatItem[];
        children: FolderViewNode[];
        totalCount: number;
    };

    type FlatRow =
        | { type: "group"; key: string; icon: string; name: string; count: number; depth: number; collapsed: boolean }
        | { type: "project"; item: ProjectStatItem; depth: number };

    const priorityOrderMap: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

    let loading = true;
    let viewMode: "status" | "folder" = "status";
    let statusFilter = "all";
    let searchQuery = "";
    let statuses: any[] = [];
    let folders: any[] = [];
    let allStats: ProjectStatItem[] = [];
    let collapsedKeys = new Set<string>();

    let projectManager: ProjectManager;
    let categoryManager: CategoryManager;
    let reminderData: any = {};
    let settings: any = {};
    let holidayData: any = {};

    // 与项目侧栏一致的排序：优先级（高->低）-> 手动排序 sort -> 设定时间 -> 创建时间
    function compareProjects(a: any, b: any): number {
        const pa = priorityOrderMap[a?.priority || "none"] || 0;
        const pb = priorityOrderMap[b?.priority || "none"] || 0;
        if (pa !== pb) return pb - pa;

        const sortDiff = (a?.sort || 0) - (b?.sort || 0);
        if (sortDiff !== 0) return sortDiff;

        const timeDiff = compareBySetTime(a, b);
        if (timeDiff !== 0) return timeDiff;

        return compareByCreatedAt(a, b);
    }

    function compareBySetTime(a: any, b: any): number {
        const hasA = !!a?.startDate;
        const hasB = !!b?.startDate;
        if (!hasA && !hasB) return 0;
        if (!hasA) return 1;
        if (!hasB) return -1;
        return String(a.startDate).localeCompare(String(b.startDate));
    }

    function compareByCreatedAt(a: any, b: any): number {
        const timeA = a?.createdTime ? new Date(a.createdTime).getTime() : 0;
        const timeB = b?.createdTime ? new Date(b.createdTime).getTime() : 0;
        return timeA - timeB;
    }

    function isArchivedStatus(statusId: string, statusList: any[]): boolean {
        const status = statusList.find((s: any) => s.id === statusId);
        return !!status?.isArchived;
    }

    // 与项目侧栏 applySearchFilter 一致：标题 + 分类名称 + 自定义分组名称，按空格分词
    function matchesSearchText(item: ProjectStatItem, query: string): boolean {
        const trimmed = query.trim();
        if (!trimmed) return true;
        const terms = trimmed.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
        const p = item.project;
        const title = (p.title || p.name || "").toLowerCase();
        let categoryNames = "";
        if (p.categoryId) {
            categoryNames = p.categoryId
                .split(",")
                .filter((id: string) => id.trim())
                .map((id: string) => {
                    const category = categoryManager?.getCategoryById(id);
                    return (category?.name || "").toLowerCase();
                })
                .join(" ");
        }
        let customGroupNames = "";
        if (Array.isArray(p.customGroups)) {
            customGroupNames = p.customGroups.map((g: any) => (g.name || "").toLowerCase()).join(" ");
        }
        const searchText = `${title} ${categoryNames} ${customGroupNames}`;
        return terms.every((term) => searchText.includes(term));
    }

    // 过滤（状态 + 搜索）并排序。注意：过滤条件作为参数传入，保证 Svelte 响应式追踪
    function computeVisibleStats(
        items: ProjectStatItem[],
        statusFilterValue: string,
        query: string,
        statusList: any[]
    ): ProjectStatItem[] {
        return items
            .filter((item) => {
                const projectStatus = item.project.status || "active";
                if (statusFilterValue === "all") {
                    // 与项目侧栏一致：全部项目不显示已归档状态的项目
                    if (isArchivedStatus(projectStatus, statusList)) return false;
                } else if (projectStatus !== statusFilterValue) {
                    return false;
                }
                return matchesSearchText(item, query);
            })
            .sort((a, b) => compareProjects(a.project, b.project));
    }

    async function computeProjectStats(project: any): Promise<ProjectStatItem> {
        const parsed = parseTitle(project.title || project.name || "");
        let statusCounts: StatusCount[] = [];
        let percentage = 0;
        let pomodoro = 0;
        let focusText = "";
        try {
            const kanbanStatuses = await projectManager.getProjectKanbanStatuses(project.id);
            const result = ProjectKanbanView.countTopLevelTasksByStatus(
                project.id,
                reminderData,
                kanbanStatuses,
                settings,
                holidayData
            );
            const countsMap: Record<string, number> = result.counts || {};
            const completedCount = result.completed || countsMap["completed"] || 0;

            // 与项目侧栏一致：按项目的看板状态渲染各状态任务数
            if (Array.isArray(kanbanStatuses) && kanbanStatuses.length > 0) {
                statusCounts = kanbanStatuses.map((s: any) => ({
                    id: s.id,
                    name: s.name || s.id,
                    icon: s.icon || "",
                    count: s.id === "completed" ? completedCount : countsMap[s.id] || 0,
                }));
            } else {
                statusCounts = [
                    { id: "doing", name: i18n("doing") || "进行中", icon: "", count: countsMap["doing"] || 0 },
                    { id: "short_term", name: i18n("shortTerm") || "短期", icon: "", count: countsMap["short_term"] || 0 },
                    { id: "long_term", name: i18n("longTerm") || "长期", icon: "", count: countsMap["long_term"] || 0 },
                    { id: "completed", name: i18n("done") || "已完成", icon: "", count: completedCount },
                ];
            }

            // 与项目侧栏一致的进度口径：done / (非完成状态任务数 + done)
            const nonCompletedSum = Object.keys(countsMap).reduce(
                (sum, key) => (key === "completed" ? sum : sum + (countsMap[key] || 0)),
                0
            );
            const total = nonCompletedSum + completedCount;
            percentage = total === 0 ? 0 : Math.round((completedCount / total) * 100);

            pomodoro = await countProjectTotalPomodoro(plugin, project.id, reminderData);
            const focusMinutes = await countProjectTotalFocusTime(plugin, project.id, reminderData);
            focusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesShort(focusMinutes)}` : "";
        } catch (e) {
            console.warn(`Failed to calculate project statistics: ${project.id}`, e);
        }

        const priority = project.priority || "none";
        const priorityNames: Record<string, string> = {
            high: i18n("highPriority") || "高优先级",
            medium: i18n("mediumPriority") || "中优先级",
            low: i18n("lowPriority") || "低优先级",
        };

        const statusId = project.status || "active";
        const statusInfo = statuses.find((s: any) => s.id === statusId);

        // 与项目侧栏一致的分类标签
        const categories: { id: string; name: string; icon: string; color: string }[] = [];
        if (project.categoryId) {
            project.categoryId
                .split(",")
                .filter((id: string) => id.trim())
                .forEach((id: string) => {
                    const category = categoryManager?.getCategoryById(id);
                    if (category) {
                        categories.push({
                            id: category.id,
                            name: category.name,
                            icon: category.icon || "",
                            color: category.color,
                        });
                    }
                });
        }

        return {
            id: project.id,
            project,
            title: parsed.text || i18n("unnamedNote") || "未命名项目",
            emoji: parsed.emoji,
            color: project.color || "#cccccc",
            priority,
            priorityLabel: priorityNames[priority] || "",
            statusCounts,
            percentage,
            pomodoro,
            focusText,
            statusId,
            statusName: statusInfo?.name || statusId,
            statusIcon: statusInfo?.icon || "",
            categories,
        };
    }

    async function reload() {
        try {
            reminderData = (await getAllReminders(plugin)) || {};
            settings = (await plugin.loadSettings()) || {};
            holidayData = (await plugin.loadHolidayData?.()) || {};
            const projects = projectManager.getProjects().filter((p: any) => p && p.id);
            allStats = await Promise.all(projects.map((p: any) => computeProjectStats(p)));
        } catch (e) {
            console.error("Failed to load project statistics:", e);
            allStats = [];
        }
    }

    onMount(async () => {
        projectManager = ProjectManager.getInstance(plugin);
        try {
            await projectManager.initialize();
        } catch (e) {
            console.warn("Failed to initialize project manager:", e);
        }
        try {
            categoryManager = CategoryManager.getInstance(plugin);
            await categoryManager.initialize();
        } catch (e) {
            console.warn("Failed to initialize category manager:", e);
        }
        try {
            const folderManager = ProjectFolderManager.getInstance(plugin);
            await folderManager.initialize();
            folders = folderManager.getFolders() || [];
        } catch (e) {
            console.warn("Failed to initialize folder manager:", e);
        }
        try {
            const pomodoroRecordManager = PomodoroRecordManager.getInstance(plugin);
            await pomodoroRecordManager.initialize();
        } catch (e) {
            console.warn("Failed to initialize pomodoro records:", e);
        }

        statuses = projectManager.getStatusManager()?.getStatuses() || [];
        await reload();
        // 与项目侧栏视图保持一致：侧栏为文件夹（列表）视图时，默认也使用文件夹视图
        if (settings?.projectPanelViewMode === "list") {
            viewMode = "folder";
        }
        loading = false;

        window.addEventListener("projectUpdated", handleDataUpdated);
        window.addEventListener("reminderUpdated", handleDataUpdated);
    });

    onDestroy(() => {
        window.removeEventListener("projectUpdated", handleDataUpdated);
        window.removeEventListener("reminderUpdated", handleDataUpdated);
    });

    function handleDataUpdated() {
        reload();
    }

    function handleStatusChange(event: Event) {
        statusFilter = (event.currentTarget as HTMLSelectElement).value;
    }

    function formatMinutesShort(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    // ---------- 分组（状态 / 文件夹） ----------

    function toggleGroup(key: string) {
        if (collapsedKeys.has(key)) {
            collapsedKeys.delete(key);
        } else {
            collapsedKeys.add(key);
        }
        collapsedKeys = new Set(collapsedKeys);
    }

    // 按状态分组（与项目侧栏 all 视图一致：先按 statusManager 顺序，再补充其余状态）
    function buildStatusRows(
        items: ProjectStatItem[],
        collapsed: Set<string>,
        searching: boolean,
        statusList: any[]
    ): FlatRow[] {
        const byStatus = new Map<string, ProjectStatItem[]>();
        items.forEach((item) => {
            const st = item.project.status || "active";
            if (!byStatus.has(st)) byStatus.set(st, []);
            byStatus.get(st)!.push(item);
        });

        const rows: FlatRow[] = [];
        const pushGroup = (statusId: string, icon: string, name: string, groupItems: ProjectStatItem[]) => {
            const key = `status:${statusId}`;
            // 搜索时强制展开，保证匹配结果可见
            const isCollapsed = !searching && collapsed.has(key);
            rows.push({ type: "group", key, icon, name, count: groupItems.length, depth: 0, collapsed: isCollapsed });
            if (!isCollapsed) {
                groupItems.forEach((item) => rows.push({ type: "project", item, depth: 1 }));
            }
        };

        const rendered = new Set<string>();
        statusList.forEach((s: any) => {
            const groupItems = byStatus.get(s.id);
            if (groupItems && groupItems.length > 0) {
                rendered.add(s.id);
                pushGroup(s.id, s.icon || "", s.name || s.id, groupItems);
            }
        });
        byStatus.forEach((groupItems, statusId) => {
            if (rendered.has(statusId)) return;
            const statusInfo = statusList.find((s: any) => s.id === statusId);
            pushGroup(statusId, statusInfo?.icon || "", statusInfo?.name || statusId, groupItems);
        });
        return rows;
    }

    function buildFolderTree(items: ProjectStatItem[], parentId: string = ""): FolderViewNode[] {
        return folders
            .filter((folder: any) => (folder.parentId || "") === parentId)
            .sort((a: any, b: any) => {
                const sortDiff = (a.sort || 0) - (b.sort || 0);
                if (sortDiff !== 0) return sortDiff;
                return (a.name || "").localeCompare(b.name || "");
            })
            .map((folder: any) => {
                const children = buildFolderTree(items, folder.id);
                const folderItems = items
                    .filter((item) => (item.project.folderId || "") === folder.id)
                    .sort((a, b) => compareProjects(a.project, b.project));
                return {
                    folder,
                    items: folderItems,
                    children,
                    totalCount: folderItems.length + children.reduce((sum, child) => sum + child.totalCount, 0),
                };
            });
    }

    function flattenFolderTree(
        nodes: FolderViewNode[],
        collapsed: Set<string>,
        searching: boolean,
        depth: number = 0
    ): FlatRow[] {
        const rows: FlatRow[] = [];
        nodes.forEach((node) => {
            // 搜索时隐藏没有匹配项目的文件夹（与项目侧栏一致）
            if (searching && node.totalCount === 0) return;
            const key = `folder:${node.folder.id}`;
            // 搜索时强制展开，保证匹配结果可见
            const isCollapsed = !searching && collapsed.has(key);
            rows.push({
                type: "group",
                key,
                icon: node.folder.icon || "📂",
                name: node.folder.name || i18n("unnamedFolder"),
                count: node.totalCount,
                depth,
                collapsed: isCollapsed,
            });
            if (isCollapsed) return;
            node.items.forEach((item) => rows.push({ type: "project", item, depth: depth + 1 }));
            rows.push(...flattenFolderTree(node.children, collapsed, searching, depth + 1));
        });
        return rows;
    }

    function buildFolderRows(items: ProjectStatItem[], collapsed: Set<string>, searching: boolean): FlatRow[] {
        const validFolderIds = new Set(folders.map((f: any) => f.id));
        const inFolder = items.filter((item) => validFolderIds.has(item.project.folderId || ""));
        const rootItems = items.filter((item) => !validFolderIds.has(item.project.folderId || ""));
        const rows = flattenFolderTree(buildFolderTree(inFolder), collapsed, searching);
        rootItems.forEach((item) => rows.push({ type: "project", item, depth: 0 }));
        return rows;
    }

    $: visibleStats = computeVisibleStats(allStats, statusFilter, searchQuery, statuses);
    $: rows = viewMode === "status"
        ? buildStatusRows(visibleStats, collapsedKeys, !!searchQuery.trim(), statuses)
        : buildFolderRows(visibleStats, collapsedKeys, !!searchQuery.trim());

    // ---------- 右键菜单 ----------

    function handleCardContextMenu(event: CustomEvent) {
        const { event: mouseEvent, project } = event.detail;
        mouseEvent.preventDefault();
        const menu = new Menu("projectStatsContextMenu");
        menu.addItem({
            icon: "iconTNProject",
            label: i18n("openProjectKanban") || "打开项目看板",
            click: () => {
                try {
                    plugin.openProjectKanbanTab(project.id, project.title);
                } catch (error) {
                    console.error("Failed to open project kanban:", error);
                    showMessage(i18n("openProjectKanbanFailed"));
                }
            },
        });
        menu.addItem({
            iconHTML: "📝",
            label: i18n("edit") || "编辑项目",
            click: () => {
                const dialog = new ProjectDialog(project.id, plugin);
                dialog.show();
            },
        });
        menu.open({ x: mouseEvent.clientX, y: mouseEvent.clientY });
    }
</script>

<div class="project-stats-root">
    {#if loading}
        <div class="project-stats-empty">{i18n('loading')}</div>
    {:else}
        <div class="project-stats-toolbar">
            <div class="view-toggle">
                <button
                    class="filter-btn"
                    class:active={viewMode === "status"}
                    on:click={() => (viewMode = "status")}>{i18n('projectStatsByStatus')}</button
                >
                <button
                    class="filter-btn"
                    class:active={viewMode === "folder"}
                    on:click={() => (viewMode = "folder")}>{i18n('projectStatsByFolder')}</button
                >
            </div>
            <select
                class="project-status-select"
                value={statusFilter}
                on:change={handleStatusChange}
            >
                <option value="all">{i18n("allProjects") || "全部项目"}</option>
                {#each statuses as status (status.id)}
                    <option value={status.id}>{status.icon ? `${status.icon} ${status.name}` : status.name}</option>
                {/each}
            </select>
            <input
                type="text"
                class="project-search-input"
                placeholder={i18n("searchProject") || "搜索项目"}
                bind:value={searchQuery}
                spellcheck="false"
            />
        </div>

        {#if rows.length === 0}
            <div class="project-stats-empty">{i18n("noProjects") || "暂无项目"}</div>
        {:else}
            <div class="project-stat-list">
                {#each rows as row (row.type === "group" ? row.key : row.item.id)}
                    {#if row.type === "group"}
                        <button
                            class="group-header"
                            style="padding-left: {row.depth * 18 + 6}px;"
                            on:click={() => toggleGroup(row.key)}
                        >
                            <svg
                                class="group-arrow"
                                class:collapsed={row.collapsed}
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                            >
                                <path
                                    d="M6 9l6 6 6-6"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                            {#if row.icon}
                                <span class="group-icon">{row.icon}</span>
                            {/if}
                            <span class="group-name">{row.name}</span>
                            <span class="group-count">{row.count}</span>
                        </button>
                    {:else}
                        <div style="margin-left: {row.depth * 18}px;">
                            <ProjectStatCard item={row.item} on:contextmenu={handleCardContextMenu} />
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style>
    .project-stats-root {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        gap: 12px;
    }

    .project-stats-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        flex-wrap: wrap;
    }

    .view-toggle {
        display: flex;
        gap: 4px;
    }

    .filter-btn {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
    }

    .filter-btn.active {
        border-color: var(--b3-theme-primary);
        color: #fff;
        background: var(--b3-theme-primary);
    }

    .project-status-select {
        max-width: 180px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 13px;
        outline: none;
        cursor: pointer;
    }

    .project-status-select:focus {
        border-color: var(--b3-theme-primary);
    }

    .project-search-input {
        flex: 1;
        min-width: 140px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 13px;
        outline: none;
    }

    .project-search-input:focus {
        border-color: var(--b3-theme-primary);
    }

    .project-stats-empty {
        padding: 32px 0;
        text-align: center;
        font-size: 13px;
        opacity: 0.7;
        flex-shrink: 0;
    }

    .project-stat-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .group-header {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        font-size: 13px;
        font-weight: 600;
        padding: 4px 6px;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        border-radius: 6px;
        text-align: left;
    }

    .group-header:hover {
        background: var(--b3-theme-surface-lighter);
    }

    .group-arrow {
        flex-shrink: 0;
        opacity: 0.7;
        transition: transform 0.2s ease;
    }

    .group-arrow.collapsed {
        transform: rotate(-90deg);
    }

    .group-icon {
        font-size: 14px;
        flex-shrink: 0;
    }

    .group-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .group-count {
        font-size: 11px;
        opacity: 0.6;
        font-weight: normal;
        flex-shrink: 0;
    }
</style>
