<script lang="ts">
    import { onMount, tick } from "svelte";
    import { i18n } from "../../pluginInstance";
    import { getLocalDateString, getLogicalDateString, getLocaleTag } from "../../utils/dateUtils";
    import { ProjectManager } from "../../utils/projectManager";
    import { generateRepeatInstances } from "@/utils/repeatUtils";
    import { PomodoroRecordManager } from "@/utils/pomodoroRecord";
    import { Dialog, showMessage, platformUtils } from "siyuan";

    export let plugin: any;
    export let calendar: any = null;

    type FilterType = "current" | "today" | "tomorrow" | "yesterday" | "thisWeek" | "nextWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";

    type TaskItem = {
        id: string;
        title: string;
        completed: boolean;
        completedTime?: string;
        priority: string;
        time?: string;
        endTime?: string;
        fullStartDate?: string;
        fullEndDate?: string;
        repeat?: any;
        repeatLabel?: string;
        note?: string;
        docTitle?: string;
        estimatedPomodoroDuration?: number;
        customGroupId?: string;
        customGroupName?: string;
        extendedProps?: any;
        depth?: number;
    };

    type ProjectGroup = {
        name: string;
        tasks: TaskItem[];
        groups: { name: string; tasks: TaskItem[] }[];
    };

    type HabitItem = {
        title: string;
        completed: boolean;
        target: number;
        successCount: number;
        emojis: string[];
        frequencyLabel: string;
    };

    type DateGroup = {
        date: string;
        formattedDate: string;
        projects: ProjectGroup[];
        pomodoroStats?: { count: number; minutes: number };
        habits?: HabitItem[];
    };

    type StatsData = {
        settings: {
            showPomodoro: boolean;
            showHabit: boolean;
        };
        pomodoro: {
            totalCount: number;
            totalHours: string;
            totalMinutes: number;
            byDate: { [date: string]: { count: number; minutes: number; taskStats: any } };
            allTimeTaskStats: { [id: string]: { count: number; minutes: number } };
        };
        habit: {
            total: number;
            completed: number;
            byDate: { [date: string]: HabitItem[] };
        };
    };

    // 基础筛选器（始终显示）
    const baseFilters: { id: Exclude<FilterType, "current" | "custom">; label: string }[] = [
        { id: "today", label: i18n("today") },
        { id: "tomorrow", label: i18n("tomorrow") },
        { id: "yesterday", label: i18n("yesterday") },
        { id: "thisWeek", label: i18n("thisWeek") },
        { id: "nextWeek", label: i18n("nextWeek") },
        { id: "lastWeek", label: i18n("lastWeek") },
        { id: "thisMonth", label: i18n("thisMonth") },
        { id: "lastMonth", label: i18n("lastMonth") },
    ];

    let currentFilter: FilterType = "today";
    let customStartDate: string = getLocalDateString(new Date());
    let customEndDate: string = getLocalDateString(new Date());
    let showCustomDatePicker: boolean = false;
    let loading = true;
    let dateGroups: DateGroup[] = [];
    let stats: StatsData | null = null;
    let totalTasks = 0;
    let completedTasks = 0;
    let projectManager: ProjectManager;
    let pomodoroRecordManager: PomodoroRecordManager | null = null;
    let lute: any = null;
    let contentEl: HTMLDivElement;
    
    // 显示开关（使用全局设置初始化，但允许临时修改）
    let showTaskNotes = false;
    let showPomodoro = true;
    let showHabit = true;

    onMount(async () => {
        projectManager = ProjectManager.getInstance(plugin);
        try {
            await projectManager.initialize();
        } catch (e) {
            console.warn("初始化项目管理器失败:", e);
        }
        try {
            pomodoroRecordManager = PomodoroRecordManager.getInstance(plugin);
            await pomodoroRecordManager.initialize();
        } catch (e) {
            console.warn("初始化番茄记录失败:", e);
        }
        try {
            if ((window as any).Lute) {
                lute = (window as any).Lute.New();
            }
        } catch (e) {
            console.error("初始化 Lute 失败:", e);
        }
        // 加载设置并初始化显示开关
        try {
            const settings = await plugin.loadSettings();
            showTaskNotes = settings.showTaskNotesInSummary !== false;
            showPomodoro = settings.showPomodoroInSummary !== false;
            showHabit = settings.showHabitInSummary !== false;
        } catch (e) {
            console.warn("加载设置失败:", e);
        }
        await loadData();
    });

    async function loadData() {
        loading = true;
        try {
            const dateRange = getFilterDateRange();
            const events = await getEventsForRange(dateRange.start, dateRange.end);
            stats = await calculateStats(dateRange.start, dateRange.end);
            const filteredEvents = filterEventsByDateRange(events, dateRange);
            const groupedTasks = await groupTasksByDateAndProject(filteredEvents, dateRange, stats, events);
            
            // 计算统计数据
            totalTasks = 0;
            completedTasks = 0;
            groupedTasks.forEach((projMap) => {
                projMap.forEach((tasks) => {
                    totalTasks += tasks.length;
                    tasks.forEach((t: any) => { if (t.completed) completedTasks++; });
                });
            });

            // 构建日期分组数据
            dateGroups = buildDateGroups(groupedTasks, dateRange, stats);
        } catch (error) {
            console.error("加载任务摘要失败:", error);
        } finally {
            loading = false;
        }
    }

    function buildDateGroups(
        groupedTasks: Map<string, Map<string, TaskItem[]>>,
        dateRange: { start: string; end: string; label: string },
        stats: StatsData
    ): DateGroup[] {
        const allDates = new Set<string>();
        groupedTasks.forEach((_, date) => allDates.add(date));
        if (showPomodoro) Object.keys(stats.pomodoro.byDate).forEach(date => allDates.add(date));
        if (showHabit) Object.keys(stats.habit.byDate).forEach(date => allDates.add(date));

        const sortedDates = Array.from(allDates).sort();
        const locale = (window as any).siyuan?.config?.lang === "zh_CN" ? "zh-CN" : "en-US";

        return sortedDates.map(date => {
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
            });

            const projects: ProjectGroup[] = [];
            const dateProjects = groupedTasks.get(date);
            
            if (dateProjects) {
                dateProjects.forEach((tasks, projectName) => {
                    const groupedTaskMap = new Map<string, TaskItem[]>();
                    const ungroupedTasks: TaskItem[] = [];
                    
                    tasks.forEach(task => {
                        const groupName = (task.customGroupName || "").trim();
                        if (groupName) {
                            if (!groupedTaskMap.has(groupName)) {
                                groupedTaskMap.set(groupName, []);
                            }
                            groupedTaskMap.get(groupName)!.push(task);
                        } else {
                            ungroupedTasks.push(task);
                        }
                    });

                    const groups: { name: string; tasks: TaskItem[] }[] = [];
                    groupedTaskMap.forEach((groupTasks, groupName) => {
                        groups.push({ name: groupName, tasks: groupTasks });
                    });

                    projects.push({
                        name: projectName,
                        tasks: ungroupedTasks,
                        groups,
                    });
                });
            }

            return {
                date,
                formattedDate,
                projects,
                pomodoroStats: showPomodoro ? stats.pomodoro.byDate[date] : undefined,
                habits: showHabit ? stats.habit.byDate[date] : undefined,
            };
        });
    }

    function getFilterDateRange(): { start: string; end: string; label: string } {
        if (currentFilter === "current") {
            return getCurrentViewDateRange();
        } else if (currentFilter === "custom") {
            return {
                start: customStartDate,
                end: customEndDate,
                label: `${customStartDate} ~ ${customEndDate}`,
            };
        }
        return getRange(currentFilter);
    }

    function getCurrentViewDateRange(): { start: string; end: string; label: string } {
        if (calendar && calendar.view) {
            const currentView = calendar.view;
            const startDate = getLocalDateString(currentView.activeStart);
            let endDate: string;
            if (currentView.type === "timeGridDay") {
                endDate = startDate;
            } else {
                const actualEndDate = new Date(currentView.activeEnd.getTime() - 24 * 60 * 60 * 1000);
                endDate = getLocalDateString(actualEndDate);
            }
            return { start: startDate, end: endDate, label: getCurrentViewInfo() };
        } else {
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return {
                start: getLocalDateString(monthStart),
                end: getLocalDateString(monthEnd),
                label: i18n("currentView"),
            };
        }
    }

    function getCurrentViewInfo(): string {
        if (calendar && calendar.view) {
            const currentView = calendar.view;
            const viewType = currentView.type;
            const startDate = currentView.activeStart;
            const locale = (window as any).siyuan?.config?.lang === "zh_CN" ? "zh-CN" : "en-US";
            switch (viewType) {
                case "dayGridMonth":
                    return i18n("yearMonthTemplate")
                        .replace("${y}", startDate.getFullYear().toString())
                        .replace("${m}", (startDate.getMonth() + 1).toString());
                case "timeGridWeek":
                    const actualWeekEnd = new Date(currentView.activeEnd.getTime() - 24 * 60 * 60 * 1000);
                    const weekStart = startDate.toLocaleDateString(locale, { month: "short", day: "numeric" });
                    const weekEnd = actualWeekEnd.toLocaleDateString(locale, { month: "short", day: "numeric" });
                    return `${weekStart} - ${weekEnd}`;
                case "timeGridDay":
                    return startDate.toLocaleDateString(locale, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        weekday: "long",
                    });
                default:
                    return i18n("currentView");
            }
        }
        return i18n("currentView");
    }

    function getRange(type: Exclude<FilterType, "current" | "custom">): { start: string; end: string; label: string } {
        const logicalToday = getLogicalDateString();
        let start: string;
        let end: string;
        let label = "";

        switch (type) {
            case "today":
                start = logicalToday;
                end = logicalToday;
                label = i18n("today");
                break;
            case "tomorrow": {
                const tomorrowDate = new Date(logicalToday);
                tomorrowDate.setDate(tomorrowDate.getDate() + 1);
                const tomorrow = getLocalDateString(tomorrowDate);
                start = tomorrow;
                end = tomorrow;
                label = i18n("tomorrow");
                break;
            }
            case "yesterday": {
                const yesterdayDate = new Date(logicalToday);
                yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                const yesterday = getLocalDateString(yesterdayDate);
                start = yesterday;
                end = yesterday;
                label = i18n("yesterday");
                break;
            }
            case "thisWeek": {
                const todayDate = new Date(logicalToday);
                const day = todayDate.getDay();
                const diff = todayDate.getDate() - day + (day === 0 ? -6 : 1);
                const startDate = new Date(todayDate);
                startDate.setDate(diff);
                const endDate = new Date(startDate);
                endDate.setDate(startDate.getDate() + 6);
                start = getLocalDateString(startDate);
                end = getLocalDateString(endDate);
                label = `${i18n("thisWeek")} (${start} ~ ${end})`;
                break;
            }
            case "nextWeek": {
                const todayDate = new Date(logicalToday);
                const day = todayDate.getDay();
                const diff = todayDate.getDate() - day + (day === 0 ? 1 : 8);
                const startDate = new Date(todayDate);
                startDate.setDate(diff);
                const endDate = new Date(startDate);
                endDate.setDate(startDate.getDate() + 6);
                start = getLocalDateString(startDate);
                end = getLocalDateString(endDate);
                label = `${i18n("nextWeek")} (${start} ~ ${end})`;
                break;
            }
            case "lastWeek": {
                const todayDate = new Date(logicalToday);
                const day = todayDate.getDay();
                const diff = todayDate.getDate() - day + (day === 0 ? -13 : -6);
                const startDate = new Date(todayDate);
                startDate.setDate(diff);
                const endDate = new Date(startDate);
                endDate.setDate(startDate.getDate() + 6);
                start = getLocalDateString(startDate);
                end = getLocalDateString(endDate);
                label = `${i18n("lastWeek")} (${start} ~ ${end})`;
                break;
            }
            case "thisMonth": {
                const todayDate = new Date(logicalToday);
                const startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
                const endDate = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
                start = getLocalDateString(startDate);
                end = getLocalDateString(endDate);
                label = i18n("thisMonth");
                break;
            }
            case "lastMonth": {
                const todayDate = new Date(logicalToday);
                const startDate = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
                const endDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0);
                start = getLocalDateString(startDate);
                end = getLocalDateString(endDate);
                label = i18n("lastMonth");
                break;
            }
            default:
                start = logicalToday;
                end = logicalToday;
                label = i18n("today");
        }
        return { start, end, label };
    }

    async function getEventsForRange(startDate: string, endDate: string) {
        try {
            const reminderData = await plugin.loadReminderData() || {};
            const events: any[] = [];

            for (const reminder of Object.values(reminderData) as any[]) {
                if (!reminder || typeof reminder !== "object") continue;

                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
                    const sameDateInstance = repeatInstances.find(i => i.date === reminder.date);
                    if (!sameDateInstance) {
                        addEventToList(events, reminder, reminder.id, false);
                    }

                    repeatInstances.forEach(instance => {
                        const originalKey = instance.date;
                        const completedInstances = reminder.repeat?.completedInstances || [];
                        const isInstanceCompleted = completedInstances.includes(originalKey);
                        const instanceModifications = reminder.repeat?.instanceModifications || {};
                        const instanceMod = instanceModifications[originalKey];

                        const instanceReminder = {
                            ...reminder,
                            date: instance.date,
                            endDate: instance.endDate,
                            time: instance.time,
                            endTime: instance.endTime,
                            completed: isInstanceCompleted,
                            note: instanceMod?.note || "",
                            customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : (instance as any).customGroupId ?? reminder.customGroupId,
                            docTitle: reminder.docTitle,
                        };

                        const uniqueInstanceId = `${reminder.id}_${originalKey}`;
                        addEventToList(events, instanceReminder, uniqueInstanceId, true, reminder.id);
                    });
                } else {
                    addEventToList(events, reminder, reminder.id, false);
                }
            }

            return events;
        } catch (error) {
            console.error("获取事件数据失败:", error);
            return [];
        }
    }

    function addEventToList(events: any[], reminder: any, eventId: string, isRepeated: boolean, originalId?: string) {
        const priority = reminder.priority || "none";
        let backgroundColor, borderColor;
        let isCompleted = false;
        if (isRepeated && originalId) {
            isCompleted = reminder.completed || false;
        } else {
            isCompleted = reminder.completed || false;
        }

        if (isCompleted) {
            backgroundColor = "#e3e3e3";
            borderColor = "#e3e3e3";
        }

        if (isRepeated) {
            backgroundColor = (backgroundColor || "") + "dd";
            borderColor = (borderColor || "") + "dd";
        }

        const classNames = [
            `reminder-priority-${priority}`,
            isRepeated ? "reminder-repeated" : "",
            isCompleted ? "completed" : "",
        ].filter(Boolean).join(" ");

        let taskLogicalDate = reminder.date;
        if (reminder.time && reminder.date) {
            try {
                const dateTimeStr = `${reminder.date} ${reminder.time}`;
                const taskDateTime = new Date(dateTimeStr.replace(" ", "T") + ":00");
                taskLogicalDate = getLogicalDateString(taskDateTime);
            } catch (e) {
                taskLogicalDate = reminder.date;
            }
        }

        const eventObj: any = {
            id: eventId,
            title: reminder.title || i18n("unnamedNote"),
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            textColor: isCompleted ? "#999999" : "#ffffff",
            className: classNames,
            extendedProps: {
                completed: isCompleted,
                completedTime: reminder.completedTime || null,
                note: reminder.note || "",
                dailyCompletions: reminder.dailyCompletions || {},
                date: reminder.date,
                endDate: reminder.endDate || null,
                time: reminder.time || null,
                endTime: reminder.endTime || null,
                priority: priority,
                categoryId: reminder.categoryId,
                projectId: reminder.projectId,
                customGroupId: reminder.customGroupId,
                blockId: reminder.blockId || reminder.id,
                parentId: reminder.parentId,
                docId: reminder.docId,
                docTitle: reminder.docTitle,
                isRepeated: isRepeated,
                originalId: originalId || reminder.id,
                repeat: reminder.repeat,
                estimatedPomodoroDuration: reminder.estimatedPomodoroDuration,
            },
        };

        if (reminder.endDate) {
            if (reminder.time && reminder.endTime) {
                eventObj.start = `${taskLogicalDate}T${reminder.time}:00`;
                eventObj.end = `${reminder.endDate}T${reminder.endTime}:00`;
                eventObj.allDay = false;
            } else {
                eventObj.start = taskLogicalDate;
                const endDate = new Date(reminder.endDate);
                endDate.setDate(endDate.getDate() + 1);
                eventObj.end = getLocalDateString(endDate);
                eventObj.allDay = true;
                if (reminder.time) {
                    eventObj.title = `${reminder.title || i18n("unnamedNote")} (${reminder.time})`;
                }
            }
        } else {
            if (reminder.time) {
                eventObj.start = `${taskLogicalDate}T${reminder.time}:00`;
                if (reminder.endTime) {
                    eventObj.end = `${taskLogicalDate}T${reminder.endTime}:00`;
                } else {
                    const startTime = new Date(`${taskLogicalDate}T${reminder.time}:00`);
                    const endTime = new Date(startTime);
                    endTime.setMinutes(endTime.getMinutes() + 30);
                    if (endTime.getDate() !== startTime.getDate()) {
                        endTime.setDate(startTime.getDate());
                        endTime.setHours(23, 59, 0, 0);
                    }
                    const endTimeStr = endTime.toTimeString().substring(0, 5);
                    eventObj.end = `${taskLogicalDate}T${endTimeStr}:00`;
                }
                eventObj.allDay = false;
            } else {
                if (reminder.date) {
                    eventObj.start = taskLogicalDate;
                } else if (reminder.completed && reminder.completedTime) {
                    try {
                        const completedDate = new Date(reminder.completedTime.replace(" ", "T") + ":00");
                        const completedLogicalDate = getLogicalDateString(completedDate);
                        eventObj.start = completedLogicalDate;
                    } catch (e) {}
                }
                eventObj.allDay = true;
                eventObj.display = "block";
            }
        }

        events.push(eventObj);
    }

    function filterEventsByDateRange(events: any[], dateRange: { start: string; end: string }): any[] {
        const includedEvents = events.filter(event => {
            let eventDate: string;
            if (event.start) {
                eventDate = event.start.split("T")[0];
            } else {
                eventDate = event.extendedProps.date;
            }

            if (!eventDate) return false;

            if (event.extendedProps.endDate) {
                const eventStart = eventDate;
                const eventEnd = event.extendedProps.endDate;
                const rangeStart = dateRange.start;
                const rangeEnd = dateRange.end;

                return (
                    (eventStart >= rangeStart && eventStart <= rangeEnd) ||
                    (eventEnd >= rangeStart && eventEnd <= rangeEnd) ||
                    (eventStart <= rangeStart && eventEnd >= rangeEnd)
                );
            }
            return eventDate >= dateRange.start && eventDate <= dateRange.end;
        });

        const additionalEvents: any[] = [];
        const undatedCandidates = events.filter(e => !e.extendedProps.date && e.extendedProps.parentId);

        if (undatedCandidates.length > 0) {
            includedEvents.forEach(parent => {
                const parentId = parent.extendedProps.originalId || parent.extendedProps.blockId || parent.id;
                const parentDate = parent.extendedProps.date;
                const myChildren = undatedCandidates.filter(c => c.extendedProps.parentId === parentId);

                myChildren.forEach(child => {
                    const newChild = { ...child };
                    newChild.extendedProps = { ...child.extendedProps };
                    newChild.extendedProps.date = parentDate;
                    newChild.start = parentDate;
                    if (parent.extendedProps.endDate) {
                        newChild.extendedProps.endDate = parent.extendedProps.endDate;
                    }
                    additionalEvents.push(newChild);
                });
            });
        }

        return [...includedEvents, ...additionalEvents];
    }

    async function groupTasksByDateAndProject(
        events: any[],
        dateRange: { start: string; end: string },
        stats?: StatsData,
        allEvents?: any[]
    ): Promise<Map<string, Map<string, TaskItem[]>>> {
        const grouped = new Map<string, Map<string, TaskItem[]>>();
        const projectData = await plugin.loadProjectData() || {};
        const customGroupNameCache = new Map<string, string>();

        const getCustomGroupName = (projectId?: string, customGroupId?: string): string => {
            if (!projectId || !customGroupId) return "";
            const cacheKey = `${projectId}::${customGroupId}`;
            if (customGroupNameCache.has(cacheKey)) {
                return customGroupNameCache.get(cacheKey) || "";
            }
            const groups = projectData[projectId]?.customGroups || [];
            const group = groups.find((g: any) => g.id === customGroupId);
            const name = group?.name || "";
            customGroupNameCache.set(cacheKey, name);
            return name;
        };

        const addedTasks = new Map<string, Set<string>>();

        const createItemFromEvent = (event: any, dateStrForPerDateCompleted: string): TaskItem => {
            const perDateCompleted = (d: string) => {
                const dc = event.extendedProps.dailyCompletions || {};
                return event.extendedProps.completed === true || dc[d] === true;
            };

            return {
                id: event.id,
                title: event.originalTitle || event.title,
                completed: typeof perDateCompleted === "function" ? perDateCompleted(dateStrForPerDateCompleted) : event.extendedProps.completed,
                completedTime: event.extendedProps.completedTime || null,
                priority: event.extendedProps.priority,
                time: event.extendedProps.time,
                endTime: event.extendedProps.endTime,
                fullStartDate: event.extendedProps.date,
                fullEndDate: event.extendedProps.endDate || null,
                repeat: event.extendedProps.repeat || null,
                repeatLabel: event.extendedProps.repeat ? formatRepeatLabel(event.extendedProps.repeat, event.extendedProps.date) : "",
                note: event.extendedProps.note,
                docTitle: event.extendedProps.docTitle,
                estimatedPomodoroDuration: event.extendedProps.estimatedPomodoroDuration,
                customGroupId: event.extendedProps.customGroupId || "",
                customGroupName: getCustomGroupName(event.extendedProps.projectId, event.extendedProps.customGroupId),
                extendedProps: event.extendedProps,
            };
        };

        const addTaskToDate = (dateStr: string, taskItem: TaskItem) => {
            const taskId = taskItem.id;
            if (!addedTasks.has(dateStr)) {
                addedTasks.set(dateStr, new Set());
            }
            if (addedTasks.get(dateStr)!.has(taskId)) {
                return;
            }

            const projectId = taskItem.extendedProps?.projectId || "no-project";
            const projectName = projectId === "no-project" ? i18n("noProject") : projectManager.getProjectName(projectId) || projectId;

            if (!grouped.has(dateStr)) {
                grouped.set(dateStr, new Map());
            }
            const dateGroup = grouped.get(dateStr)!;
            if (!dateGroup.has(projectName)) {
                dateGroup.set(projectName, []);
            }
            dateGroup.get(projectName)!.push(taskItem);

            addedTasks.get(dateStr)!.add(taskId);
        };

        events.forEach(event => {
            const startDate = event.extendedProps.date;
            const endDate = event.extendedProps.endDate;
            const time = event.extendedProps.time;

            const taskData = createItemFromEvent(event, startDate);

            let taskLogicalDate = startDate;
            if (time && startDate) {
                try {
                    const dateTimeStr = `${startDate} ${time}`;
                    const taskDateTime = new Date(dateTimeStr.replace(" ", "T") + ":00");
                    taskLogicalDate = getLogicalDateString(taskDateTime);
                } catch (e) {
                    taskLogicalDate = startDate;
                }
            }

            if (endDate && endDate !== startDate) {
                const start = new Date(Math.max(new Date(startDate).getTime(), new Date(dateRange.start).getTime()));
                const end = new Date(Math.min(new Date(endDate).getTime(), new Date(dateRange.end).getTime()));

                const currentDate = new Date(start);
                while (currentDate <= end) {
                    const dateStr = currentDate.toISOString().split("T")[0];
                    const item = { ...taskData };
                    item.completed = typeof taskData.completed === "function" ? (taskData as any)._perDateCompleted(dateStr) : taskData.completed;
                    addTaskToDate(dateStr, item);
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            } else if (startDate) {
                const item = { ...taskData };
                item.completed = typeof taskData.completed === "function" ? (taskData as any)._perDateCompleted(taskLogicalDate) : taskData.completed;
                addTaskToDate(taskLogicalDate, item);
            }

            if (event.extendedProps.completed && event.extendedProps.completedTime) {
                try {
                    const completedDate = new Date(event.extendedProps.completedTime.replace(" ", "T") + ":00");
                    const completedLogicalDate = getLogicalDateString(completedDate);

                    if ((!startDate || completedLogicalDate !== taskLogicalDate) &&
                        completedLogicalDate >= dateRange.start &&
                        completedLogicalDate <= dateRange.end) {
                        const completedItem = { ...taskData };
                        completedItem.completed = true;
                        addTaskToDate(completedLogicalDate, completedItem);
                    }
                } catch (e) {}
            }
        });

        if (stats && stats.pomodoro && stats.pomodoro.byDate && allEvents) {
            const eventMap = new Map<string, any>();
            allEvents.forEach(e => {
                const oid = e.extendedProps.originalId || e.id;
                if (!eventMap.has(oid)) {
                    eventMap.set(oid, e);
                } else {
                    if (!e.extendedProps.isRepeated) {
                        eventMap.set(oid, e);
                    }
                }
            });

            Object.keys(stats.pomodoro.byDate).forEach(dateStr => {
                if (dateStr < dateRange.start || dateStr > dateRange.end) return;
                const dayStats = stats.pomodoro.byDate[dateStr];
                if (dayStats && dayStats.taskStats) {
                    Object.keys(dayStats.taskStats).forEach(taskId => {
                        const event = eventMap.get(taskId);
                        if (event) {
                            const item = createItemFromEvent(event, dateStr);
                            addTaskToDate(dateStr, item);
                        }
                    });
                }
            });
        }

        grouped.forEach((projectMap) => {
            projectMap.forEach((tasks, projectName) => {
                const sortedTasks = sortTasksByHierarchy(tasks);
                projectMap.set(projectName, sortedTasks);
            });
        });

        return grouped;
    }

    function sortTasksByHierarchy(tasks: TaskItem[]): TaskItem[] {
        if (!tasks || tasks.length === 0) return [];

        const taskMap = new Map<string, TaskItem>();
        tasks.forEach(t => taskMap.set(t.id, t));

        const childrenMap = new Map<string, TaskItem[]>();
        const roots: TaskItem[] = [];

        tasks.forEach(task => {
            task.depth = 0;
            const parentId = task.extendedProps?.parentId;

            if (parentId && taskMap.has(parentId)) {
                if (!childrenMap.has(parentId)) {
                    childrenMap.set(parentId, []);
                }
                childrenMap.get(parentId)!.push(task);
            } else {
                roots.push(task);
            }
        });

        const result: TaskItem[] = [];

        const traverse = (nodes: TaskItem[], depth: number, parentCompleted: boolean) => {
            nodes.forEach(node => {
                if (parentCompleted) {
                    node.completed = true;
                }
                node.depth = depth;
                result.push(node);
                const children = childrenMap.get(node.id);
                if (children) {
                    traverse(children, depth + 1, node.completed);
                }
            });
        };

        traverse(roots, 0, false);
        return result;
    }

    async function calculateStats(startDate: string, endDate: string): Promise<StatsData> {
        const settings = await plugin.loadSettings();
        const reminderData = await plugin.loadReminderData() || {};

        // 番茄钟统计
        let totalPomodoros = 0;
        let totalMinutes = 0;
        const pomodoroByDate: { [date: string]: { count: number; minutes: number; taskStats: any } } = {};

        const rawAllTimeStats: { [id: string]: { count: number; minutes: number } } = {};
        if (pomodoroRecordManager) {
            const allRecords = (pomodoroRecordManager as any).records || {};
            Object.keys(allRecords).forEach(dateStr => {
                const record = allRecords[dateStr];
                if (record && record.sessions) {
                    record.sessions.forEach((s: any) => {
                        if (s.type === "work") {
                            const evtId = s.eventId;
                            if (evtId) {
                                if (!rawAllTimeStats[evtId]) rawAllTimeStats[evtId] = { count: 0, minutes: 0 };
                                rawAllTimeStats[evtId].count += pomodoroRecordManager!.calculateSessionCount(s);
                                rawAllTimeStats[evtId].minutes += s.duration || 0;
                            }
                        }
                    });
                }
            });
        }

        const allTimeTaskStats: { [id: string]: { count: number; minutes: number } } = {};
        Object.keys(rawAllTimeStats).forEach(id => {
            if (!allTimeTaskStats[id]) allTimeTaskStats[id] = { count: 0, minutes: 0 };
            allTimeTaskStats[id].count += rawAllTimeStats[id].count;
            allTimeTaskStats[id].minutes += rawAllTimeStats[id].minutes;
        });

        Object.keys(rawAllTimeStats).forEach(sourceId => {
            let currentId = sourceId;
            const statsToAdd = rawAllTimeStats[sourceId];
            let depth = 0;
            while (depth < 20) {
                let parentId: string | null = null;
                const reminder = reminderData[currentId];

                if (reminder && reminder.parentId) {
                    parentId = reminder.parentId;
                } else if (!reminder && currentId.includes("_")) {
                    const lastIdx = currentId.lastIndexOf("_");
                    if (lastIdx > 0) {
                        parentId = currentId.substring(0, lastIdx);
                    }
                }

                if (!parentId) break;

                if (!allTimeTaskStats[parentId]) allTimeTaskStats[parentId] = { count: 0, minutes: 0 };
                allTimeTaskStats[parentId].count += statsToAdd.count;
                allTimeTaskStats[parentId].minutes += statsToAdd.minutes;
                currentId = parentId;
                depth++;
            }
        });

        const start = new Date(startDate);
        const end = new Date(endDate);
        const current = new Date(start);

        while (current <= end) {
            const dateStr = getLogicalDateString(current);
            if (pomodoroRecordManager) {
                const record = (pomodoroRecordManager as any).records[dateStr];
                if (record) {
                    const dayTotal = record.sessions
                        ? record.sessions.reduce((sum: number, s: any) => {
                              if (s.type === "work") {
                                  return sum + pomodoroRecordManager!.calculateSessionCount(s);
                              }
                              return sum;
                          }, 0)
                        : record.workSessions || 0;

                    totalPomodoros += dayTotal;
                    totalMinutes += record.totalWorkTime || 0;

                    const rawTaskStats: { [id: string]: { count: number; minutes: number } } = {};
                    if (record.sessions) {
                        record.sessions.forEach((s: any) => {
                            if (s.type === "work") {
                                const evtId = s.eventId;
                                if (evtId) {
                                    if (!rawTaskStats[evtId]) rawTaskStats[evtId] = { count: 0, minutes: 0 };
                                    rawTaskStats[evtId].count += pomodoroRecordManager!.calculateSessionCount(s);
                                    rawTaskStats[evtId].minutes += s.duration || 0;
                                }
                            }
                        });
                    }

                    const aggregatedTaskStats: { [id: string]: { count: number; minutes: number } } = {};
                    Object.keys(rawTaskStats).forEach(id => {
                        if (!aggregatedTaskStats[id]) aggregatedTaskStats[id] = { count: 0, minutes: 0 };
                        aggregatedTaskStats[id].count += rawTaskStats[id].count;
                        aggregatedTaskStats[id].minutes += rawTaskStats[id].minutes;
                    });

                    Object.keys(rawTaskStats).forEach(sourceId => {
                        let currentId = sourceId;
                        const statsToAdd = rawTaskStats[sourceId];
                        let depth = 0;
                        while (depth < 20) {
                            let parentId: string | null = null;
                            const reminder = reminderData[currentId];

                            if (reminder && reminder.parentId) {
                                parentId = reminder.parentId;
                            } else if (!reminder && currentId.includes("_")) {
                                const lastIdx = currentId.lastIndexOf("_");
                                if (lastIdx > 0) {
                                    parentId = currentId.substring(0, lastIdx);
                                }
                            }

                            if (!parentId) break;

                            if (!aggregatedTaskStats[parentId]) aggregatedTaskStats[parentId] = { count: 0, minutes: 0 };
                            aggregatedTaskStats[parentId].count += statsToAdd.count;
                            aggregatedTaskStats[parentId].minutes += statsToAdd.minutes;
                            currentId = parentId;
                            depth++;
                        }
                    });

                    pomodoroByDate[getLocalDateString(current)] = {
                        count: dayTotal,
                        minutes: record.totalWorkTime || 0,
                        taskStats: aggregatedTaskStats,
                    };
                }
            }
            current.setDate(current.getDate() + 1);
        }

        // 习惯打卡统计
        const habitData = await plugin.loadHabitData();
        let totalHabitTargetDays = 0;
        let completedHabitDays = 0;
        const habitsByDate: { [date: string]: HabitItem[] } = {};

        const habits = Object.values(habitData) as any[];
        const dateList: string[] = [];
        const tempDate = new Date(start);
        while (tempDate <= end) {
            dateList.push(getLocalDateString(tempDate));
            tempDate.setDate(tempDate.getDate() + 1);
        }

        habits.forEach(habit => {
            dateList.forEach(dateStr => {
                if (shouldCheckInOnDate(habit, dateStr)) {
                    totalHabitTargetDays++;
                    const isComplete = isHabitComplete(habit, dateStr);
                    if (isComplete) {
                        completedHabitDays++;
                    }

                    if (!habitsByDate[dateStr]) habitsByDate[dateStr] = [];

                    const checkIn = habit.checkIns?.[dateStr];
                    const emojis: string[] = [];
                    if (checkIn) {
                        if (checkIn.entries && checkIn.entries.length > 0) {
                            checkIn.entries.forEach((entry: any) => {
                                if (entry.emoji) emojis.push(entry.emoji);
                            });
                        } else if (checkIn.status && checkIn.status.length > 0) {
                            emojis.push(...checkIn.status);
                        }
                    }

                    const successCount = emojis.filter(emoji => {
                        const emojiConfig = habit.checkInEmojis?.find((e: any) => e.emoji === emoji);
                        return emojiConfig ? emojiConfig.countsAsSuccess !== false : true;
                    }).length;

                    habitsByDate[dateStr].push({
                        title: habit.title,
                        completed: isComplete,
                        target: habit.target || 1,
                        successCount,
                        emojis: emojis.slice(0, 10),
                        frequencyLabel: getFrequencyLabel(habit),
                    });
                }
            });
        });

        return {
            settings: {
                showPomodoro: showPomodoro,
                showHabit: showHabit,
            },
            pomodoro: {
                totalCount: totalPomodoros,
                totalHours: (totalMinutes / 60).toFixed(1),
                totalMinutes: totalMinutes,
                byDate: pomodoroByDate,
                allTimeTaskStats: allTimeTaskStats,
            },
            habit: {
                total: totalHabitTargetDays,
                completed: completedHabitDays,
                byDate: habitsByDate,
            },
        };
    }

    function getFrequencyLabel(habit: any): string {
        const { frequency } = habit;
        if (!frequency) return i18n("daily");

        let label = "";
        const interval = frequency.interval || 1;

        switch (frequency.type) {
            case "daily":
                label = interval === 1 ? i18n("daily") : `${i18n("every")}${interval}${i18n("days")}`;
                break;
            case "weekly":
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    const days = frequency.weekdays.map((d: number) => {
                        const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                        return i18n(keys[d]);
                    }).join("、");
                    label = `${i18n("weekly")} (${days})`;
                } else {
                    label = interval === 1 ? i18n("weekly") : `${i18n("every")}${interval}${i18n("weeks")}`;
                }
                break;
            case "monthly":
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    label = `${i18n("monthly")} (${frequency.monthDays.join("、")}${i18n("day")})`;
                } else {
                    label = interval === 1 ? i18n("monthly") : `${i18n("every")}${interval}${i18n("months")}`;
                }
                break;
            case "yearly":
                label = i18n("yearly");
                break;
            case "ebbinghaus":
                label = i18n("ebbinghausRepeat");
                break;
            default:
                label = i18n("daily");
        }
        return label;
    }

    function shouldCheckInOnDate(habit: any, date: string): boolean {
        if (habit.startDate > date) return false;
        if (habit.endDate && habit.endDate < date) return false;

        const { frequency } = habit;
        const checkDate = new Date(`${date}T00:00:00`);
        const startDate = new Date(`${habit.startDate}T00:00:00`);

        switch (frequency?.type) {
            case "daily":
                if (frequency.interval) {
                    const daysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                    return daysDiff >= 0 && daysDiff % frequency.interval === 0;
                }
                return true;
            case "weekly":
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.interval) {
                    const weeksDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / (86400000 * 7));
                    return weeksDiff >= 0 && weeksDiff % frequency.interval === 0 && checkDate.getDay() === startDate.getDay();
                }
                return checkDate.getDay() === startDate.getDay();
            case "monthly":
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                if (frequency.interval) {
                    const monthsDiff = (checkDate.getFullYear() - startDate.getFullYear()) * 12 + (checkDate.getMonth() - startDate.getMonth());
                    return monthsDiff >= 0 && monthsDiff % frequency.interval === 0 && checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getDate() === startDate.getDate();
            case "yearly":
                if (frequency.months && frequency.months.length > 0) {
                    if (!frequency.months.includes(checkDate.getMonth() + 1)) return false;
                    if (frequency.monthDays && frequency.monthDays.length > 0) {
                        return frequency.monthDays.includes(checkDate.getDate());
                    }
                    return checkDate.getDate() === startDate.getDate();
                }
                if (frequency.interval) {
                    const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                    return yearsDiff >= 0 && yearsDiff % frequency.interval === 0 && checkDate.getMonth() === startDate.getMonth() && checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getMonth() === startDate.getMonth() && checkDate.getDate() === startDate.getDate();
            case "ebbinghaus":
                const ebbinghausDaysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                const ebbinghausPattern = [1, 2, 4, 7, 15];
                const maxPatternDay = 15;
                if (ebbinghausDaysDiff < 0) return false;
                if (ebbinghausDaysDiff === 0) return true;
                if (ebbinghausPattern.includes(ebbinghausDaysDiff)) return true;
                return ebbinghausDaysDiff > maxPatternDay && (ebbinghausDaysDiff - maxPatternDay) % 15 === 0;
        }
        return true;
    }

    function isHabitComplete(habit: any, dateStr: string): boolean {
        const checkIn = habit.checkIns?.[dateStr];
        if (!checkIn) return false;

        const emojis: string[] = [];
        if (checkIn.entries && checkIn.entries.length > 0) {
            checkIn.entries.forEach((entry: any) => {
                if (entry.emoji) emojis.push(entry.emoji);
            });
        } else if (checkIn.status && checkIn.status.length > 0) {
            emojis.push(...checkIn.status);
        }

        const successEmojis = emojis.filter(emoji => {
            const emojiConfig = habit.checkInEmojis?.find((e: any) => e.emoji === emoji);
            return emojiConfig ? emojiConfig.countsAsSuccess !== false : true;
        });

        return successEmojis.length >= (habit.target || 1);
    }

    function formatRepeatLabel(repeat: any, startDate?: string): string {
        if (!repeat || !repeat.type) return "";
        const interval = repeat.interval || 1;
        switch (repeat.type) {
            case "daily":
                return interval === 1 ? `🔄 ${i18n("daily") || "每天"}` : `🔄 ${i18n("every") || "每"}${interval}${i18n("days") || "天"}`;
            case "weekly": {
                if (repeat.weekDays && repeat.weekDays.length > 0) {
                    const days = repeat.weekDays.map((d: number) => {
                        const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                        return i18n(keys[d]);
                    }).join("、");
                    return `🔄 ${i18n("weekly") || "每周"} (${days})`;
                }
                if (startDate) {
                    try {
                        const sd = new Date(startDate + "T00:00:00");
                        const d = sd.getDay();
                        const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                        const dayLabel = i18n(keys[d]);
                        return `🔄 ${i18n("weekly") || "每周"}${dayLabel}`;
                    } catch (e) {}
                }
                return interval === 1 ? `🔄 ${i18n("weekly") || "每周"}` : `🔄 ${i18n("every") || "每"}${interval}${i18n("weeks") || "周"}`;
            }
            case "monthly": {
                if (repeat.monthDays && repeat.monthDays.length > 0) {
                    return `🔄 ${i18n("monthly") || "每月"} (${repeat.monthDays.join("、")}${i18n("day") || "日"})`;
                }
                return interval === 1 ? `🔄 ${i18n("monthly") || "每月"}` : `🔄 ${i18n("every") || "每"}${interval}${i18n("months") || "月"}`;
            }
            case "yearly":
                return `🔄 ${i18n("yearly") || "每年"}`;
            case "custom": {
                const parts: string[] = [];
                if (repeat.weekDays && repeat.weekDays.length) {
                    const days = repeat.weekDays.map((d: number) => i18n(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d]));
                    parts.push(`${i18n("weekly") || "每周"}(${days.join("、")})`);
                }
                if (repeat.monthDays && repeat.monthDays.length) {
                    parts.push(`${i18n("monthly") || "每月"}(${repeat.monthDays.join("、")}${i18n("day") || "日"})`);
                }
                if (repeat.months && repeat.months.length) {
                    parts.push(`${i18n("yearly") || "每年"}(${repeat.months.join("、")}${i18n("month") || "月"})`);
                }
                return `🔄 ${parts.join(" ")}`;
            }
            case "ebbinghaus":
                return `🔄 ${i18n("ebbinghaus") || "艾宾浩斯"}`;
            case "lunar-monthly":
                return `🔄 ${i18n("lunarMonthly") || "农历每月"}`;
            case "lunar-yearly":
                return `🔄 ${i18n("lunarYearly") || "农历每年"}`;
            default:
                return "";
        }
    }

    function formatDuration(minutes: number): string {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        if (h > 0) {
            return `${h} ${i18n("hourSymbol")} ${m} ${i18n("minuteSymbol")}`;
        }
        return `${m} ${i18n("minuteSymbol")}`;
    }

    function getDisplayTimeForDate(task: TaskItem, date: string): string {
        const sd = task.fullStartDate;
        const ed = task.fullEndDate;
        const st = task.time;
        const et = task.endTime;

        const wrap = (s: string) => (s ? ` (${s})` : "");

        if (!sd && !ed) {
            if (st) return wrap(st + (et ? `-${et}` : ""));
            return "";
        }

        if (!ed || sd === ed) {
            if (st && et) return wrap(`${st}-${et}`);
            if (st) return wrap(st);
            return "";
        }

        if (date === sd) {
            if (st) return wrap(`${st}-23:59`);
            return wrap(i18n("allDay"));
        }

        if (date === ed) {
            if (et) return wrap(`00:00-${et}`);
            return wrap(i18n("allDay"));
        }

        return wrap(`00:00-23:59`);
    }

    function formatMonthDay(dateStr: string): string {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        const m = d.getMonth() + 1;
        const day = d.getDate();
        return i18n("monthDayTemplate").replace("${m}", m.toString()).replace("${d}", day.toString());
    }

    function formatCompletedTime(completedTime: string, taskDate: string): string {
        if (!completedTime) return "";

        let actualCompletedDateStr: string;
        actualCompletedDateStr = completedTime.split(" ")[0];
        let completed: Date;
        completed = new Date(completedTime.replace(" ", "T") + ":00");

        const timeStr = completed.toLocaleTimeString(getLocaleTag(), { hour: "2-digit", minute: "2-digit" });
        const completedLogicalDate = getLogicalDateString(completed);

        if (completedLogicalDate === taskDate) {
            return i18n("completedAtTemplate").replace("${time}", timeStr);
        } else {
            const dateStr = formatMonthDay(actualCompletedDateStr);
            return i18n("completedAtWithDateTemplate").replace("${date}", dateStr).replace("${time}", timeStr);
        }
    }

    function getPomodoroStr(task: TaskItem, date: string): string {
        if (!stats) return "";
        const dayStats = stats.pomodoro.byDate[date];
        let dailyCount = 0;
        let dailyMinutes = 0;

        if (dayStats && dayStats.taskStats && dayStats.taskStats[task.id]) {
            const tStat = dayStats.taskStats[task.id];
            dailyCount = tStat.count;
            dailyMinutes = tStat.minutes;
        }

        let pomodoroStr = "";

        if (dailyCount > 0 || dailyMinutes > 0) {
            pomodoroStr = ` (🍅 ${dailyCount} | 🕒 ${formatDuration(dailyMinutes)}`;

            const isRepeated = task.extendedProps?.isRepeated;
            const isRecurring = task.repeat && task.repeat.enabled;
            const originalId = task.extendedProps?.originalId;
            const statsId = isRepeated && originalId ? originalId : task.id;

            if (stats.pomodoro.allTimeTaskStats && stats.pomodoro.allTimeTaskStats[statsId]) {
                const allStat = stats.pomodoro.allTimeTaskStats[statsId];

                if (isRecurring || isRepeated) {
                    pomodoroStr += ` / ${i18n("series")}: 🍅 ${allStat.count} | 🕒 ${formatDuration(allStat.minutes)}`;
                } else if (allStat.minutes > dailyMinutes + 1) {
                    pomodoroStr += ` / ${i18n("totalStats")}: 🍅 ${allStat.count} | 🕒 ${formatDuration(allStat.minutes)}`;
                }
            }
            pomodoroStr += `)`;
        } else {
            const isRepeated = task.extendedProps?.isRepeated;
            const isRecurring = task.repeat && task.repeat.enabled;
            const originalId = task.extendedProps?.originalId;
            const statsId = isRepeated && originalId ? originalId : task.id;

            if (stats.pomodoro.allTimeTaskStats && stats.pomodoro.allTimeTaskStats[statsId]) {
                const allStat = stats.pomodoro.allTimeTaskStats[statsId];
                if (allStat.minutes > 0) {
                    const label = isRecurring || isRepeated ? i18n("series") : i18n("totalStats");
                    pomodoroStr = ` (${label}: 🍅 ${allStat.count} | 🕒 ${formatDuration(allStat.minutes)})`;
                }
            }
        }

        return pomodoroStr;
    }

    function renderNote(note: string): string {
        if (!note) return "";
        if (lute) {
            return lute.Md2HTML(note);
        }
        return note;
    }

    function switchFilter(filter: FilterType) {
        currentFilter = filter;
        if (filter === "custom") {
            showCustomDatePicker = true;
        } else {
            showCustomDatePicker = false;
            loadData();
        }
    }

    function applyCustomDateRange() {
        if (customStartDate && customEndDate) {
            if (customStartDate > customEndDate) {
                showMessage(i18n("startDateAfterEndDate") || "开始日期不能晚于结束日期", 3000, "error");
                return;
            }
            loadData();
        }
    }

    // 复制功能
    async function copyContent(format: "rich" | "markdown" | "plain") {
        if (!contentEl) return;
        try {
            let content = "";
            if (format === "rich") {
                content = extractHTMLContent(contentEl);
                await copyHTMLToClipboard(content, htmlToPlainText(contentEl));
            } else if (format === "markdown") {
                content = htmlToMarkdown(contentEl);
                copyTextToClipboard(content);
            } else {
                content = htmlToPlainText(contentEl);
                copyTextToClipboard(content);
            }
        } catch (error) {
            console.error("复制失败:", error);
            showMessage(i18n("copyFailed"));
        }
    }

    function extractHTMLContent(container: HTMLElement): string {
        const clone = container.cloneNode(true) as HTMLElement;
        const isMultiDayView = dateGroups.length > 1;
        clone.querySelectorAll(".filter-buttons, .action-buttons, button").forEach(el => el.remove());
        if (!isMultiDayView) {
            clone.querySelectorAll(".task-summary-info-cards").forEach(el => el.remove());
        }
        return clone.innerHTML;
    }

    function htmlToMarkdown(container: HTMLElement): string {
        let markdown = "";
        const isMultiDayView = dateGroups.length > 1;

        // 添加标题
        const title = i18n("taskSummary");
        markdown += `# ${title}\n\n`;

        const dateRange = getFilterDateRange();
        markdown += `**${i18n("currentRange")}**: ${dateRange.label}\n`;
        markdown += `**${i18n("taskStatsCompletion")}**: ${i18n("completionStats").replace("${completed}", completedTasks.toString()).replace("${total}", totalTasks.toString())}\n\n`;

        if (isMultiDayView && stats) {
            if (showPomodoro) {
                markdown += `**${i18n("pomodoroFocusCard")}**: ${i18n("pomodoroStatsValue").replace("${count}", stats.pomodoro.totalCount.toString()).replace("${duration}", formatDuration(stats.pomodoro.totalMinutes))}\n`;
            }
            if (showHabit) {
                markdown += `**${i18n("habitCheckInCard")}**: ${i18n("habitStatsValue").replace("${completed}", stats.habit.completed.toString()).replace("${total}", stats.habit.total.toString())}\n`;
            }
            markdown += "\n";
        }

        dateGroups.forEach(dateGroup => {
            markdown += `## ${dateGroup.formattedDate}\n\n`;

            if (dateGroup.pomodoroStats && (dateGroup.pomodoroStats.count > 0 || dateGroup.pomodoroStats.minutes > 0)) {
                markdown += `${i18n("focusStatLine").replace("${count}", dateGroup.pomodoroStats.count.toString()).replace("${duration}", formatDuration(dateGroup.pomodoroStats.minutes))}\n\n`;
            }

            if (dateGroup.habits && dateGroup.habits.length > 0) {
                markdown += `### ${i18n("habitCheckInTitle")}\n\n`;
                dateGroup.habits.forEach(habit => {
                    const checkbox = habit.completed ? "[x]" : "[ ]";
                    const emojiStr = habit.emojis.length > 0 ? habit.emojis.join("") : i18n("noneVal");
                    markdown += `- ${checkbox} ${habit.title} (${i18n("frequency")}: ${habit.frequencyLabel}, ${i18n("targetTimes")}: ${habit.target}, ${i18n("todayCheckIn")}: ${emojiStr})\n`;
                });
                markdown += "\n";
            }

            dateGroup.projects.forEach(project => {
                markdown += `### ${project.name}\n\n`;

                project.tasks.forEach(task => {
                    const checkbox = task.completed ? "[x]" : "[ ]";
                    const indent = "  ".repeat(task.depth || 0);
                    let line = `${indent}- ${checkbox} ${task.title}`;
                    if (task.repeatLabel) {
                        line += ` (${task.repeatLabel})`;
                    }
                    const timeStr = getDisplayTimeForDate(task, dateGroup.date);
                    if (timeStr) {
                        line += timeStr;
                    }
                    const pomodoroStr = getPomodoroStr(task, dateGroup.date);
                    if (pomodoroStr) {
                        line += pomodoroStr;
                    }
                    if (task.completed && task.completedTime) {
                        line += ` ${formatCompletedTime(task.completedTime, dateGroup.date)}`;
                    }
                    markdown += line + "\n";

                    if (task.note) {
                        const noteLines = task.note.split(/\r?\n/);
                        noteLines.forEach(line => {
                            markdown += `${indent}  ${line}\n`;
                        });
                    }
                });

                project.groups.forEach(group => {
                    markdown += `#### ${group.name}\n\n`;
                    group.tasks.forEach(task => {
                        const checkbox = task.completed ? "[x]" : "[ ]";
                        const indent = "  ".repeat(task.depth || 0);
                        let line = `${indent}- ${checkbox} ${task.title}`;
                        if (task.repeatLabel) {
                            line += ` (${task.repeatLabel})`;
                        }
                        const timeStr = getDisplayTimeForDate(task, dateGroup.date);
                        if (timeStr) {
                            line += timeStr;
                        }
                        const pomodoroStr = getPomodoroStr(task, dateGroup.date);
                        if (pomodoroStr) {
                            line += pomodoroStr;
                        }
                        if (task.completed && task.completedTime) {
                            line += ` ${formatCompletedTime(task.completedTime, dateGroup.date)}`;
                        }
                        markdown += line + "\n";

                        if (task.note) {
                            const noteLines = task.note.split(/\r?\n/);
                            noteLines.forEach(line => {
                                markdown += `${indent}  ${line}\n`;
                            });
                        }
                    });
                });

                markdown += "\n";
            });

            markdown += "\n";
        });

        return markdown;
    }

    function htmlToPlainText(container: HTMLElement): string {
        let text = "";
        const isMultiDayView = dateGroups.length > 1;

        const title = i18n("taskSummary");
        text += `${title}\n${"-".repeat(title.length)}\n\n`;

        const dateRange = getFilterDateRange();
        text += `${i18n("currentRange")}：${dateRange.label}\n`;
        text += `${i18n("taskStatsCompletion")}：${i18n("completionStats").replace("${completed}", completedTasks.toString()).replace("${total}", totalTasks.toString())}\n\n`;

        if (isMultiDayView && stats) {
            if (showPomodoro) {
                text += `${i18n("pomodoroFocusCard")}：${i18n("pomodoroStatsValue").replace("${count}", stats.pomodoro.totalCount.toString()).replace("${duration}", formatDuration(stats.pomodoro.totalMinutes))}\n`;
            }
            if (showHabit) {
                text += `${i18n("habitCheckInCard")}：${i18n("habitStatsValue").replace("${completed}", stats.habit.completed.toString()).replace("${total}", stats.habit.total.toString())}\n`;
            }
            text += "\n";
        }

        dateGroups.forEach(dateGroup => {
            text += `${dateGroup.formattedDate}\n${"-".repeat(dateGroup.formattedDate.length)}\n\n`;

            if (dateGroup.pomodoroStats && (dateGroup.pomodoroStats.count > 0 || dateGroup.pomodoroStats.minutes > 0)) {
                text += `${i18n("focusStatLine").replace("${count}", dateGroup.pomodoroStats.count.toString()).replace("${duration}", formatDuration(dateGroup.pomodoroStats.minutes))}\n\n`;
            }

            if (dateGroup.habits && dateGroup.habits.length > 0) {
                text += `【${i18n("habitCheckInTitle")}】\n\n`;
                dateGroup.habits.forEach(habit => {
                    const checkbox = habit.completed ? "✅" : "⬜";
                    const emojiStr = habit.emojis.length > 0 ? habit.emojis.join("") : i18n("noneVal");
                    text += `${checkbox} ${habit.title} (${i18n("frequency")}: ${habit.frequencyLabel}, ${i18n("targetTimes")}: ${habit.target}, ${i18n("todayCheckIn")}: ${emojiStr})\n`;
                });
                text += "\n";
            }

            dateGroup.projects.forEach(project => {
                text += `【${project.name}】\n\n`;

                project.tasks.forEach(task => {
                    const checkbox = task.completed ? "✅" : "⬜";
                    const indent = "  ".repeat(task.depth || 0);
                    let line = `${indent}${checkbox} ${task.title}`;
                    if (task.repeatLabel) {
                        line += ` (${task.repeatLabel})`;
                    }
                    const timeStr = getDisplayTimeForDate(task, dateGroup.date);
                    if (timeStr) {
                        line += timeStr;
                    }
                    const pomodoroStr = getPomodoroStr(task, dateGroup.date);
                    if (pomodoroStr) {
                        line += pomodoroStr;
                    }
                    if (task.completed && task.completedTime) {
                        line += ` ${formatCompletedTime(task.completedTime, dateGroup.date)}`;
                    }
                    text += line + "\n";

                    if (task.note) {
                        const noteLines = task.note.split(/\r?\n/);
                        noteLines.forEach(line => {
                            text += `${indent}  ${line.trim()}\n`;
                        });
                    }
                });

                project.groups.forEach(group => {
                    text += `  【${group.name}】\n`;
                    group.tasks.forEach(task => {
                        const checkbox = task.completed ? "✅" : "⬜";
                        const indent = "  ".repeat(task.depth || 0);
                        let line = `${indent}${checkbox} ${task.title}`;
                        if (task.repeatLabel) {
                            line += ` (${task.repeatLabel})`;
                        }
                        const timeStr = getDisplayTimeForDate(task, dateGroup.date);
                        if (timeStr) {
                            line += timeStr;
                        }
                        const pomodoroStr = getPomodoroStr(task, dateGroup.date);
                        if (pomodoroStr) {
                            line += pomodoroStr;
                        }
                        if (task.completed && task.completedTime) {
                            line += ` ${formatCompletedTime(task.completedTime, dateGroup.date)}`;
                        }
                        text += line + "\n";

                        if (task.note) {
                            const noteLines = task.note.split(/\r?\n/);
                            noteLines.forEach(line => {
                                text += `${indent}  ${line.trim()}\n`;
                            });
                        }
                    });
                });

                text += "\n";
            });

            text += "\n";
        });

        return text;
    }

    function copyTextToClipboard(text: string) {
        platformUtils.writeText(text);
        showMessage(i18n("copiedToClipboard"));
    }

    async function copyHTMLToClipboard(html: string, fallbackText: string) {
        try {
            if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
                copyTextToClipboard(fallbackText);
                return;
            }
            const blob = new Blob([html], { type: "text/html" });
            const clipboardItem = new ClipboardItem({ "text/html": blob });
            await navigator.clipboard.write([clipboardItem]);
            showMessage(i18n("copiedToClipboard"));
        } catch (error) {
            console.error("复制富文本失败，回退为纯文本复制:", error);
            copyTextToClipboard(fallbackText);
        }
    }

    $: completionText = i18n("completionStats")
        .replace("${completed}", completedTasks.toString())
        .replace("${total}", totalTasks.toString());

    $: dateRangeLabel = stats ? getFilterDateRange().label : "";
</script>

<div class="task-summary-root">
    <div class="task-summary-toolbar">
        <div class="filter-buttons">
            {#if calendar}
                <button
                    class="filter-btn {currentFilter === 'current' ? 'active' : ''}"
                    on:click={() => switchFilter("current")}
                >
                    {i18n("currentView")}
                </button>
            {/if}
            {#each baseFilters as filter}
                <button
                    class="filter-btn {currentFilter === filter.id ? 'active' : ''}"
                    on:click={() => switchFilter(filter.id)}
                >
                    {filter.label}
                </button>
            {/each}
            <button
                class="filter-btn {currentFilter === 'custom' ? 'active' : ''}"
                on:click={() => switchFilter("custom")}
            >
                {i18n("customDateRange") || "自定义"}
            </button>
        </div>
        <div class="action-buttons">
            <button class="action-btn" on:click={() => copyContent("rich")}>
                <svg class="icon" viewBox="0 0 24 24"><use xlink:href="#iconCopy"></use></svg>
                {i18n("copyRichText")}
            </button>
            <button class="action-btn" on:click={() => copyContent("markdown")}>
                <svg class="icon" viewBox="0 0 24 24"><use xlink:href="#iconCopy"></use></svg>
                {i18n("copyAll")}
            </button>
            <button class="action-btn" on:click={() => copyContent("plain")}>
                <svg class="icon" viewBox="0 0 24 24"><use xlink:href="#iconCopy"></use></svg>
                {i18n("copyPlainText")}
            </button>
        </div>
    </div>

    {#if showCustomDatePicker}
        <div class="custom-date-picker">
            <div class="date-inputs">
                <div class="date-field">
                    <label for="custom-start-date">{i18n("startDate") || "开始日期"}</label>
                    <input id="custom-start-date" type="date" bind:value={customStartDate} />
                </div>
                <span class="date-separator">~</span>
                <div class="date-field">
                    <label for="custom-end-date">{i18n("endDate") || "结束日期"}</label>
                    <input id="custom-end-date" type="date" bind:value={customEndDate} />
                </div>
            </div>
            <button class="apply-btn" on:click={applyCustomDateRange}>
                {i18n("apply") || "应用"}
            </button>
        </div>
    {/if}

    {#if loading}
        <div class="state-block">加载中...</div>
    {:else if dateGroups.length === 0}
        <div class="state-block">{i18n("noTasks")}</div>
    {:else}
        <div class="task-summary-settings">
            <label class="switch-label">
                <input class="b3-switch" type="checkbox" bind:checked={showPomodoro} on:change={loadData} />
                {i18n("showPomodoroInSummary") || "显示番茄钟"}
            </label>
            <label class="switch-label">
                <input class="b3-switch" type="checkbox" bind:checked={showHabit} on:change={loadData} />
                {i18n("showHabitInSummary") || "显示习惯"}
            </label>
            <label class="switch-label">
                <input class="b3-switch" type="checkbox" bind:checked={showTaskNotes} />
                {i18n("showTaskNotes") || "显示任务备注"}
            </label>
        </div>
        <div class="task-summary-info-cards">
            <div class="info-card">
                <div class="info-label">{i18n("currentRange")}</div>
                <div class="info-value">{dateRangeLabel}</div>
            </div>
            <div class="info-card">
                <div class="info-label">{i18n("taskStatsCompletion")}</div>
                <div class="info-value">{completionText}</div>
            </div>
            {#if showPomodoro}
                <div class="info-card">
                    <div class="info-label">{i18n("pomodoroFocusCard")}</div>
                    <div class="info-value">
                        {i18n("pomodoroStatsValue")
                            .replace("${count}", stats.pomodoro.totalCount.toString())
                            .replace("${duration}", formatDuration(stats.pomodoro.totalMinutes))}
                    </div>
                </div>
            {/if}
            {#if showHabit}
                <div class="info-card">
                    <div class="info-label">{i18n("habitCheckInCard")}</div>
                    <div class="info-value">
                        {i18n("habitStatsValue")
                            .replace("${completed}", stats.habit.completed.toString())
                            .replace("${total}", stats.habit.total.toString())}
                    </div>
                </div>
            {/if}
        </div>

        <div class="task-summary-content" bind:this={contentEl}>
            {#each dateGroups as dateGroup}
                <div class="task-date-group">
                    <h3 class="task-date-title">{dateGroup.formattedDate}</h3>

                    {#if dateGroup.pomodoroStats && (dateGroup.pomodoroStats.count > 0 || dateGroup.pomodoroStats.minutes > 0)}
                        <div class="summary-stat-row">
                            {i18n("focusStatLine")
                                .replace("${count}", dateGroup.pomodoroStats.count.toString())
                                .replace("${duration}", formatDuration(dateGroup.pomodoroStats.minutes))}
                        </div>
                    {/if}

                    {#if dateGroup.habits && dateGroup.habits.length > 0}
                        <div class="task-project-group">
                            <h4 class="task-project-title">{i18n("habitCheckInTitle")}</h4>
                            <ul class="task-list">
                                {#each dateGroup.habits as habit}
                                    <li class="task-item habit-item {habit.completed ? 'completed' : ''}">
                                        <span class="task-checkbox">{habit.completed ? "✅" : "⬜"}</span>
                                        <span class="task-title">
                                            {habit.title}
                                            <span class="task-meta">
                                                ({i18n("frequency")}: {habit.frequencyLabel}, {i18n("targetTimes")}: {habit.target}, {i18n("todayCheckIn")}: {habit.emojis.length > 0 ? habit.emojis.join("") : i18n("noneVal")})
                                            </span>
                                        </span>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}

                    {#each dateGroup.projects as project}
                        <div class="task-project-group">
                            <h4 class="task-project-title">{project.name}</h4>
                            
                            {#if project.tasks.length > 0}
                                <ul class="task-list">
                                    {#each project.tasks as task}
                                        <li
                                            class="task-item {task.completed ? 'completed' : ''} priority-{task.priority}"
                                            style={task.depth && task.depth > 0 ? `padding-left: ${task.depth * 20}px` : ""}
                                        >
                                            <span class="task-checkbox">{task.completed ? "✅" : "⬜"}</span>
                                            <div class="task-body">
                                                <div class="task-line">
                                                    <span class="task-title">
                                                        {task.title}
                                                        {#if task.repeatLabel}
                                                            <span class="task-meta">({task.repeatLabel})</span>
                                                        {/if}
                                                        {#if getDisplayTimeForDate(task, dateGroup.date)}
                                                            <span class="task-meta">{getDisplayTimeForDate(task, dateGroup.date)}</span>
                                                        {/if}
                                                        {#if task.estimatedPomodoroDuration}
                                                            <span class="task-meta">({i18n("estimatedTime").replace("${duration}", task.estimatedPomodoroDuration.toString())})</span>
                                                        {/if}
                                                        {#if getPomodoroStr(task, dateGroup.date)}
                                                            <span class="task-meta">{getPomodoroStr(task, dateGroup.date)}</span>
                                                        {/if}
                                                        {#if task.completed && task.completedTime}
                                                            <span class="task-meta">{formatCompletedTime(task.completedTime, dateGroup.date)}</span>
                                                        {/if}
                                                    </span>
                                                </div>
                                                {#if task.note && showTaskNotes}
                                                    <div class="task-note">{@html renderNote(task.note)}</div>
                                                {/if}
                                            </div>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}

                            {#each project.groups as group}
                                <h5 class="task-custom-group-title">{group.name}</h5>
                                <ul class="task-list task-group-list">
                                    {#each group.tasks as task}
                                        <li
                                            class="task-item {task.completed ? 'completed' : ''} priority-{task.priority}"
                                            style={task.depth && task.depth > 0 ? `padding-left: ${task.depth * 20}px` : ""}
                                        >
                                            <span class="task-checkbox">{task.completed ? "✅" : "⬜"}</span>
                                            <div class="task-body">
                                                <div class="task-line">
                                                    <span class="task-title">
                                                        {task.title}
                                                        {#if task.repeatLabel}
                                                            <span class="task-meta">({task.repeatLabel})</span>
                                                        {/if}
                                                        {#if getDisplayTimeForDate(task, dateGroup.date)}
                                                            <span class="task-meta">{getDisplayTimeForDate(task, dateGroup.date)}</span>
                                                        {/if}
                                                        {#if task.estimatedPomodoroDuration}
                                                            <span class="task-meta">({i18n("estimatedTime").replace("${duration}", task.estimatedPomodoroDuration.toString())})</span>
                                                        {/if}
                                                        {#if getPomodoroStr(task, dateGroup.date)}
                                                            <span class="task-meta">{getPomodoroStr(task, dateGroup.date)}</span>
                                                        {/if}
                                                        {#if task.completed && task.completedTime}
                                                            <span class="task-meta">{formatCompletedTime(task.completedTime, dateGroup.date)}</span>
                                                        {/if}
                                                    </span>
                                                </div>
                                                {#if task.note && showTaskNotes}
                                                    <div class="task-note">{@html renderNote(task.note)}</div>
                                                {/if}
                                            </div>
                                        </li>
                                    {/each}
                                </ul>
                            {/each}
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .task-summary-root {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .task-summary-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        flex-wrap: wrap;
        gap: 8px;
    }

    .filter-buttons {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
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

    .action-buttons {
        display: flex;
        gap: 8px;
    }

    .action-btn {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .action-btn:hover {
        border-color: var(--b3-theme-primary);
    }

    .icon {
        width: 14px;
        height: 14px;
        fill: currentColor;
    }

    .custom-date-picker {
        display: flex;
        align-items: flex-end;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 8px;
        border: 1px solid var(--b3-border-color);
        margin-bottom: 16px;
    }

    .date-inputs {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
    }

    .date-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .date-field label {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .date-field input[type="date"] {
        padding: 6px 10px;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-surface);
        font-size: 13px;
    }

    .date-separator {
        color: var(--b3-theme-on-surface-light);
        font-size: 14px;
    }

    .apply-btn {
        border: 1px solid var(--b3-theme-primary);
        background: var(--b3-theme-primary);
        color: #fff;
        border-radius: 6px;
        padding: 6px 16px;
        font-size: 13px;
        cursor: pointer;
    }

    .apply-btn:hover {
        opacity: 0.9;
    }

    .state-block {
        padding: 26px 12px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
    }

    .task-summary-info-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
    }

    .info-card {
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 8px;
        border: 1px solid var(--b3-border-color);
    }

    .info-label {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .info-value {
        font-size: 14px;
        font-weight: bold;
        margin-top: 4px;
    }

    .task-summary-content {
        flex: 1;
        overflow-y: auto;
        padding-right: 4px;
    }

    .task-date-group {
        margin-bottom: 24px;
    }

    .task-date-title {
        color: var(--b3-theme-primary);
        border-bottom: 2px solid var(--b3-theme-primary);
        padding-bottom: 8px;
        margin-bottom: 16px;
        font-size: 16px;
        margin-top: 0;
    }

    .summary-stat-row {
        margin-bottom: 8px;
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        padding-left: 16px;
    }

    .task-project-group {
        margin-bottom: 16px;
        margin-left: 16px;
    }

    .task-project-title {
        color: var(--b3-theme-secondary);
        margin-bottom: 8px;
        font-size: 14px;
        margin-top: 0;
    }

    .task-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .task-custom-group-title {
        margin: 10px 0 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        font-weight: 600;
    }

    .task-group-list {
        margin-left: 8px;
    }

    .task-item {
        display: flex;
        align-items: flex-start;
        padding: 6px 0;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .task-item.completed {
        opacity: 0.6;
    }

    .task-item.completed .task-title {
        text-decoration: line-through;
    }

    .task-checkbox {
        margin-right: 8px;
        flex-shrink: 0;
    }

    .task-body {
        flex: 1;
        display: flex;
        flex-direction: column;
    }

    .task-line {
        display: flex;
        align-items: center;
    }

    .task-title {
        flex: 1;
        word-break: break-word;
        font-size: 14px;
    }

    .task-meta {
        color: #888;
        font-size: 12px;
    }

    .task-note {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin-top: 6px;
        margin-left: 0;
        white-space: pre-wrap;
    }

    .task-note :global(p) {
        margin: 0;
    }

    .priority-high .task-title {
        color: #e74c3c;
        font-weight: bold;
    }

    .priority-medium .task-title {
        color: #f39c12;
    }

    .priority-low .task-title {
        color: #3498db;
    }

    .habit-item {
        align-items: center;
    }

    .task-summary-settings {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
        padding: 8px 0;
    }

    .switch-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
    }
</style>
