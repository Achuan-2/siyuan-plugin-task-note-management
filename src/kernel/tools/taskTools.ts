import type { ReminderManager } from "../../components/dataManager/reminderManager";
import type { CategoryManager } from "../../components/dataManager/categoryManager";
import type { ProjectManager } from "../../components/dataManager/projectManager";
import type { ReminderTime } from "../../types/reminder";
import type { ToolDefinition } from "./common";
import {
    getBlockByID,
    updateBindBlockAtrrs,
    addBlockProjectId,
    setBlockProjectIds,
} from "../utils/siyuanApi";
import {
    objectSchema,
    wrapHandler,
    successResponse,
    errorResponse,
} from "./common";
import {
    assertDefined,
    assertString,
    assertDateString,
    assertOptionalString,
    assertOptionalDateString,
    assertOptionalTimeString,
    assertOptionalEnum,
    assertOptionalBoolean,
    assertOptionalNumber,
    assertArray,
    assertOptionalObject,
    ValidationError,
} from "../utils/validation";

const TASK_ACTIONS = ["search_task", "get_task", "create_task", "update_task", "delete_task", "list_categories"] as const;
type TaskAction = typeof TASK_ACTIONS[number];

const REMINDER_TIME_ENTRY_SCHEMA = {
    type: "object",
    description: "一条额外提醒。time 可为 HH:MM，或带日期的 YYYY-MM-DDTHH:MM（例如提前一天提醒）",
    properties: {
        time: { type: "string", description: "提醒时刻，格式 HH:MM 或 YYYY-MM-DDTHH:MM" },
        endTime: { type: "string", description: "提醒结束时刻，可选；格式同 time" },
        note: { type: "string", description: "本次提醒的附加备注，可选" },
    },
    required: ["time"],
};

const REMINDER_TIMES_SCHEMA = {
    type: "array",
    description: "额外提醒时间列表。传 [] 可在 update_task 中清除全部额外提醒",
    items: REMINDER_TIME_ENTRY_SCHEMA,
};

export function createTaskTool(
    reminderManager: ReminderManager,
    categoryManager: CategoryManager,
    projectManager: ProjectManager
): ToolDefinition {
    return {
        name: "task",
        config: {
            title: "任务与提醒管理",
            description: "任务与提醒管理操作。任务的 time 会在任务时刻提醒，reminderTimes 可设置一个或多个额外提醒。Actions: search_task(关键词/id/多条件搜索), get_task(获取单个任务详情), create_task(创建任务或提醒), update_task(批量更新任务或提醒), delete_task(删除任务), list_categories(列出分类)。",
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        description: "操作类型",
                        enum: TASK_ACTIONS,
                    },
                    // search / get
                    keyword: { type: "string", description: "关键词，匹配任务标题和备注" },
                    id: { type: "string", description: "任务 ID，精确匹配" },
                    projectId: { type: "string", description: "所属项目 ID" },
                    date: { type: "string", description: "日期 YYYY-MM-DD，或传入 'today'。创建任务或在 get_task 中指定重复实例时使用，可传入 '' 以创建无日期任务" },
                    priority: { type: "string", enum: ["high", "medium", "low", "none"], description: "优先级" },
                    status: { type: "string", description: "看板状态" },
                    completed: { type: "boolean", description: "是否已完成" },
                    limit: { type: "number", description: "返回数量上限，默认 50" },
                    // create / update
                    title: { type: "string", description: "任务标题" },
                    note: { type: "string", description: "备注" },
                    time: { type: "string", description: "任务开始时间 HH:MM；设置后会在该时刻提醒" },
                    reminderTimes: REMINDER_TIMES_SCHEMA,
                    endDate: { type: "string", description: "结束日期 YYYY-MM-DD" },
                    endTime: { type: "string", description: "结束时间 HH:MM" },
                    categoryId: { type: "string", description: "分类 ID" },
                    blockId: { type: "string", description: "绑定的思源块 ID，可选" },
                    url: { type: "string", description: "网页链接，可选" },
                    kanbanStatus: { type: "string", description: "看板状态，可选" },
                    customProgress: { type: "number", minimum: 0, maximum: 100, description: "自定义进度条百分比 (0-100)，可选" },
                    linkedHabitId: { type: "string", description: "关联的习惯 ID，可选" },
                    linkedHabitSyncPomodoroToday: { type: "boolean", description: "是否同步番茄钟到习惯，可选" },
                    linkedHabitAutoCheckInOnComplete: { type: "boolean", description: "是否在任务完成时自动打卡习惯，可选" },
                    linkedHabitAutoCheckInOptionKey: { type: "string", description: "自动打卡选项 Key，可选" },
                    linkedHabitAutoCheckInEmoji: { type: "string", description: "自动打卡 Emoji，可选" },
                    subtasks: {
                        type: "array",
                        description: "可选。创建任务时可以一并创建的子任务列表",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string", description: "子任务标题" },
                                note: { type: "string", description: "子任务备注" },
                                date: { type: "string", description: "子任务日期 YYYY-MM-DD" },
                                time: { type: "string", description: "子任务时间 HH:MM" },
                                reminderTimes: REMINDER_TIMES_SCHEMA,
                                endDate: { type: "string", description: "子任务结束日期 YYYY-MM-DD" },
                                endTime: { type: "string", description: "子任务结束时间 HH:MM" },
                                priority: { type: "string", enum: ["high", "medium", "low", "none"] },
                                categoryId: { type: "string", description: "子任务分类 ID" },
                                completed: { type: "boolean", description: "是否已完成" },
                                blockId: { type: "string", description: "子任务绑定的思源块 ID，可选" },
                                url: { type: "string", description: "子任务网页链接，可选" },
                                kanbanStatus: { type: "string", description: "子任务看板状态，可选" },
                                customProgress: { type: "number", minimum: 0, maximum: 100, description: "子任务自定义进度条百分比 (0-100)，可选" },
                                linkedHabitId: { type: "string", description: "子任务关联的习惯 ID，可选" },
                                linkedHabitSyncPomodoroToday: { type: "boolean", description: "是否同步番茄钟到习惯，可选" },
                                linkedHabitAutoCheckInOnComplete: { type: "boolean", description: "是否在任务完成时自动打卡习惯，可选" },
                                linkedHabitAutoCheckInOptionKey: { type: "string", description: "自动打卡选项 Key，可选" },
                                linkedHabitAutoCheckInEmoji: { type: "string", description: "自动打卡 Emoji，可选" }
                            },
                            required: ["title"]
                        }
                    },
                    repeat: {
                        type: "object",
                        description: "重复设置",
                        properties: {
                            enabled: { type: "boolean", description: "是否启用重复" },
                            type: { type: "string", enum: ["daily", "weekly", "monthly", "yearly", "custom", "ebbinghaus", "lunar-monthly", "lunar-yearly"], description: "重复类型" },
                            interval: { type: "number", description: "重复间隔" },
                            weekDays: { type: "array", items: { type: "number" }, description: "每周的哪几天 (0-6, 0为周日)" },
                            monthDays: { type: "array", items: { type: "number" }, description: "每月的哪几天 (1-31)" },
                            monthlyRepeatMode: { type: "string", enum: ["date", "week"], description: "每月重复方式：date(按日期)/week(按星期)" },
                            months: { type: "array", items: { type: "number" }, description: "每年的哪几个月 (1-12)" },
                            lunarDay: { type: "number", description: "农历日期（1-30）" },
                            lunarMonth: { type: "number", description: "农历月份（1-12）" },
                            endDate: { type: "string", description: "截止日期 YYYY-MM-DD" },
                            endCount: { type: "number", description: "重复次数限制" },
                            endType: { type: "string", enum: ["never", "date", "count"], description: "结束类型" },
                            ebbinghausPattern: { type: "array", items: { type: "number" }, description: "艾宾浩斯重复模式" },
                            reminderSkipWeekendMode: { type: "string", enum: ["none", "skip", "only_weekend"], description: "跳过周末模式" },
                            reminderSkipHolidays: { type: "boolean", description: "是否跳过节假日提醒" }
                        },
                        required: ["enabled", "type", "endType"]
                    },
                    // update
                    updates: {
                        type: "array",
                        description: "批量更新列表（update 操作必填）",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                title: { type: "string" },
                                note: { type: "string" },
                                date: { type: "string" },
                                time: { type: "string" },
                                reminderTimes: REMINDER_TIMES_SCHEMA,
                                endDate: { type: "string" },
                                endTime: { type: "string" },
                                priority: { type: "string", enum: ["high", "medium", "low", "none"] },
                                projectId: { type: "string" },
                                categoryId: { type: "string" },
                                completed: { type: "boolean" },
                                blockId: { type: "string" },
                                url: { type: "string" },
                                kanbanStatus: { type: "string" },
                                customProgress: { type: "number", minimum: 0, maximum: 100 },
                                linkedHabitId: { type: "string" },
                                linkedHabitSyncPomodoroToday: { type: "boolean" },
                                linkedHabitAutoCheckInOnComplete: { type: "boolean" },
                                linkedHabitAutoCheckInOptionKey: { type: "string" },
                                linkedHabitAutoCheckInEmoji: { type: "string" },
                                repeat: {
                                    type: "object",
                                    description: "重复设置",
                                    properties: {
                                        enabled: { type: "boolean" },
                                        type: { type: "string", enum: ["daily", "weekly", "monthly", "yearly", "custom", "ebbinghaus", "lunar-monthly", "lunar-yearly"] },
                                        interval: { type: "number" },
                                        weekDays: { type: "array", items: { type: "number" } },
                                        monthDays: { type: "array", items: { type: "number" } },
                                        monthlyRepeatMode: { type: "string", enum: ["date", "week"] },
                                        months: { type: "array", items: { type: "number" } },
                                        lunarDay: { type: "number" },
                                        lunarMonth: { type: "number" },
                                        endDate: { type: "string" },
                                        endCount: { type: "number" },
                                        endType: { type: "string", enum: ["never", "date", "count"] },
                                        ebbinghausPattern: { type: "array", items: { type: "number" } },
                                        reminderSkipWeekendMode: { type: "string", enum: ["none", "skip", "only_weekend"] },
                                        reminderSkipHolidays: { type: "boolean" }
                                    }
                                }
                            },
                            required: ["id"],
                        },
                    },
                },
                required: ["action"],
            },
        },
        handler: wrapHandler(async (input) => {
            const action = assertEnum(input.action, "action", TASK_ACTIONS);

            const ensureKanbanStatusExists = async (status: string | undefined, pId: string | undefined) => {
                if (!status) return;
                if (pId) {
                    const allowedStatuses = await projectManager.getProjectKanbanStatuses(pId);
                    const allowedStatusIds = allowedStatuses.map(s => s.id);
                    if (!allowedStatusIds.includes(status)) {
                        const newStatus = {
                            id: status,
                            name: status,
                            color: "#6c757d",
                            icon: "info",
                            isFixed: false,
                            sort: allowedStatuses.length > 0 ? Math.max(...allowedStatuses.map(s => s.sort)) + 1 : 1
                        };
                        await projectManager.setProjectKanbanStatuses(pId, [...allowedStatuses, newStatus]);
                    }
                }
            };

            const parseCustomProgress = (val: any, fieldName: string): number | undefined => {
                const num = assertOptionalNumber(val, fieldName);
                if (num === undefined) return undefined;
                return Math.max(0, Math.min(100, Math.round(num)));
            };

            switch (action) {
                case "search_task": {
                    await reminderManager.reload();
                    const options: any = {};
                    if (input.keyword) options.keyword = assertOptionalString(input.keyword, "keyword");
                    if (input.id) options.id = assertOptionalString(input.id, "id");
                    if (input.projectId) options.projectId = assertOptionalString(input.projectId, "projectId");
                    if (input.date) {
                        let dateVal = input.date;
                        if (dateVal === "today") {
                            const now = new Date();
                            const year = now.getFullYear();
                            const month = String(now.getMonth() + 1).padStart(2, "0");
                            const day = String(now.getDate()).padStart(2, "0");
                            dateVal = `${year}-${month}-${day}`;
                        }
                        options.date = assertOptionalDateString(dateVal, "date");
                    }
                    if (input.priority) options.priority = assertOptionalEnum(input.priority, "priority", ["high", "medium", "low", "none"]);
                    if (input.status) options.status = assertOptionalString(input.status, "status");
                    if (input.completed !== undefined) options.completed = assertOptionalBoolean(input.completed, "completed");
                    if (input.limit !== undefined) options.limit = assertOptionalNumber(input.limit, "limit");
                    const tasks = await reminderManager.searchReminders(options);
                    return successResponse(cleanObject(filterRepeatInstances(tasks, options.date)));
                }

                case "get_task": {
                    const id = assertString(input.id, "id");
                    const date = assertOptionalDateString(input.date, "date");
                    await reminderManager.reload();
                    
                    let targetId = id;
                    let targetDate = date;
                    const match = id.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
                    if (match) {
                        targetId = match[1];
                        targetDate = match[2];
                    }
                    
                    let task = await reminderManager.getReminderById(targetId);
                    if (!task) {
                        const allReminders = await reminderManager.getAllReminders();
                        for (const key of Object.keys(allReminders)) {
                            if (targetId === key || id.startsWith(key + "_")) {
                                task = allReminders[key];
                                break;
                            }
                        }
                    }
                    
                    if (!task) {
                        return errorResponse(`任务不存在: ${id}`);
                    }
                    
                    if (task.repeat?.enabled && targetDate) {
                        const settings = (reminderManager as any).plugin?.loadSettings ? await (reminderManager as any).plugin.loadSettings() : {};
                        const holidayData = (reminderManager as any).plugin?.loadHolidayData ? await (reminderManager as any).plugin.loadHolidayData() : {};
                        const allRawReminders = { [task.id]: task };
                        const expandedReminders = ReminderTaskLogic.generateAllRemindersWithInstances(allRawReminders, targetDate, settings, holidayData);
                        const instanceTask = expandedReminders.find(r => r.date === targetDate || r.id === id);
                        if (instanceTask) {
                            task = instanceTask;
                        }
                    }
                    
                    return successResponse(cleanObject(task));
                }

                case "create_task": {
                    const title = assertString(input.title, "title");
                    
                    const getTodayDateString = () => {
                        const now = new Date();
                        const year = now.getFullYear();
                        const month = String(now.getMonth() + 1).padStart(2, "0");
                        const day = String(now.getDate()).padStart(2, "0");
                        return `${year}-${month}-${day}`;
                    };

                    const rawDate = assertString(input.date, "date");
                    let date = rawDate === "" ? "" : assertDateString(rawDate, "date");

                    if (input.repeat && input.repeat.enabled && date === "") {
                        date = getTodayDateString();
                    }

                    if (input.projectId) {
                        await projectManager.loadProjects(true);
                        const exists = await projectManager.projectExists(assertString(input.projectId, "projectId"));
                        if (!exists) return errorResponse(`项目不存在: ${input.projectId}`);
                    }
                    if (input.categoryId) {
                        const exists = await categoryManager.categoryExists(assertString(input.categoryId, "categoryId"));
                        if (!exists) return errorResponse(`分类不存在: ${input.categoryId}`);
                    }

                    const blockId = assertOptionalString(input.blockId, "blockId");
                    let docId: string | undefined = undefined;
                    if (blockId) {
                        try {
                            const block = await getBlockByID(blockId);
                            docId = block?.root_id || (block?.type === 'd' ? block?.id : undefined);
                        } catch (error) {
                            console.error('获取绑定块信息失败:', error);
                        }
                    }

                    const inputCompleted = assertOptionalBoolean(input.completed, "completed");
                    const inputKanbanStatus = assertOptionalString(input.kanbanStatus, "kanbanStatus");
                    await ensureKanbanStatusExists(inputKanbanStatus, input.projectId ? assertString(input.projectId, "projectId") : undefined);

                    const completed = inputCompleted !== undefined 
                        ? inputCompleted 
                        : (inputKanbanStatus === 'completed' ? true : undefined);

                    const customProgress = parseCustomProgress(input.customProgress, "customProgress");

                    const linkedHabitId = assertOptionalString(input.linkedHabitId, "linkedHabitId");
                    const linkedHabitSyncPomodoroToday = assertOptionalBoolean(input.linkedHabitSyncPomodoroToday, "linkedHabitSyncPomodoroToday");
                    const linkedHabitAutoCheckInOnComplete = assertOptionalBoolean(input.linkedHabitAutoCheckInOnComplete, "linkedHabitAutoCheckInOnComplete");
                    const linkedHabitAutoCheckInOptionKey = assertOptionalString(input.linkedHabitAutoCheckInOptionKey, "linkedHabitAutoCheckInOptionKey");
                    const linkedHabitAutoCheckInEmoji = assertOptionalString(input.linkedHabitAutoCheckInEmoji, "linkedHabitAutoCheckInEmoji");

                    const parentTask = await reminderManager.createReminder({
                        title,
                        date,
                        note: assertOptionalString(input.note, "note"),
                        time: assertOptionalTimeString(input.time, "time"),
                        reminderTimes: parseReminderTimes(input.reminderTimes, "reminderTimes"),
                        endDate: assertOptionalDateString(input.endDate, "endDate"),
                        endTime: assertOptionalTimeString(input.endTime, "endTime"),
                        priority: assertOptionalEnum(input.priority, "priority", ["high", "medium", "low", "none"]),
                        projectId: assertOptionalString(input.projectId, "projectId"),
                        categoryId: assertOptionalString(input.categoryId, "categoryId"),
                        completed,
                        repeat: assertOptionalObject(input.repeat, "repeat"),
                        blockId,
                        docId,
                        url: assertOptionalString(input.url, "url"),
                        kanbanStatus: inputKanbanStatus,
                        customProgress,
                        linkedHabitId,
                        linkedHabitSyncPomodoroToday,
                        linkedHabitAutoCheckInOnComplete,
                        linkedHabitAutoCheckInOptionKey,
                        linkedHabitAutoCheckInEmoji,
                    });

                    if (blockId) {
                        try {
                            const projectId = assertOptionalString(input.projectId, "projectId");
                            if (projectId) {
                                await addBlockProjectId(blockId, projectId);
                            } else {
                                await setBlockProjectIds(blockId, []);
                            }
                            await updateBindBlockAtrrs(blockId, (reminderManager as any).plugin);
                        } catch (error) {
                            console.warn('同步绑定块属性失败:', error);
                        }
                    }

                    const subtasksResult: any[] = [];
                    if (input.subtasks && Array.isArray(input.subtasks)) {
                        for (const subtask of input.subtasks) {
                            const subTitle = assertString(subtask.title, "subtasks[].title");
                            
                            let subDate = "";
                            if (subtask.date !== undefined && subtask.date !== null) {
                                const rawSubDate = assertString(subtask.date, "subtasks[].date");
                                subDate = rawSubDate === "" ? "" : assertDateString(rawSubDate, "subtasks[].date");
                            }
                            if (subtask.repeat && subtask.repeat.enabled && subDate === "") {
                                subDate = getTodayDateString();
                            }

                            const subBlockId = assertOptionalString(subtask.blockId, "subtasks[].blockId");
                            let subDocId: string | undefined = undefined;
                            if (subBlockId) {
                                try {
                                    const block = await getBlockByID(subBlockId);
                                    subDocId = block?.root_id || (block?.type === 'd' ? block?.id : undefined);
                                } catch (error) {
                                    console.error('获取子任务绑定块信息失败:', error);
                                }
                            }

                            const subCompletedInput = assertOptionalBoolean(subtask.completed, "subtasks[].completed");
                            const subKanbanStatus = assertOptionalString(subtask.kanbanStatus, "subtasks[].kanbanStatus");
                            await ensureKanbanStatusExists(subKanbanStatus, input.projectId ? assertString(input.projectId, "projectId") : undefined);

                            const subCompleted = subCompletedInput !== undefined 
                                ? subCompletedInput 
                                : (subKanbanStatus === 'completed' ? true : undefined);

                            const subCustomProgress = parseCustomProgress(subtask.customProgress, "subtasks[].customProgress");

                            const subLinkedHabitId = assertOptionalString(subtask.linkedHabitId, "subtasks[].linkedHabitId");
                            const subLinkedHabitSyncPomodoroToday = assertOptionalBoolean(subtask.linkedHabitSyncPomodoroToday, "subtasks[].linkedHabitSyncPomodoroToday");
                            const subLinkedHabitAutoCheckInOnComplete = assertOptionalBoolean(subtask.linkedHabitAutoCheckInOnComplete, "subtasks[].linkedHabitAutoCheckInOnComplete");
                            const subLinkedHabitAutoCheckInOptionKey = assertOptionalString(subtask.linkedHabitAutoCheckInOptionKey, "subtasks[].linkedHabitAutoCheckInOptionKey");
                            const subLinkedHabitAutoCheckInEmoji = assertOptionalString(subtask.linkedHabitAutoCheckInEmoji, "subtasks[].linkedHabitAutoCheckInEmoji");

                            const subTask = await reminderManager.createReminder({
                                title: subTitle,
                                date: subDate,
                                note: assertOptionalString(subtask.note, "subtasks[].note"),
                                time: assertOptionalTimeString(subtask.time, "subtasks[].time"),
                                reminderTimes: parseReminderTimes(subtask.reminderTimes, "subtasks[].reminderTimes"),
                                endDate: assertOptionalDateString(subtask.endDate, "subtasks[].endDate"),
                                endTime: assertOptionalTimeString(subtask.endTime, "subtasks[].endTime"),
                                priority: assertOptionalEnum(subtask.priority, "subtasks[].priority", ["high", "medium", "low", "none"]),
                                projectId: assertOptionalString(input.projectId, "projectId"),
                                categoryId: assertOptionalString(subtask.categoryId, "subtasks[].categoryId"),
                                completed: subCompleted,
                                parentId: parentTask.id,
                                repeat: assertOptionalObject(subtask.repeat, "subtasks[].repeat"),
                                blockId: subBlockId,
                                docId: subDocId,
                                url: assertOptionalString(subtask.url, "subtasks[].url"),
                                kanbanStatus: subKanbanStatus,
                                customProgress: subCustomProgress,
                                linkedHabitId: subLinkedHabitId,
                                linkedHabitSyncPomodoroToday: subLinkedHabitSyncPomodoroToday,
                                linkedHabitAutoCheckInOnComplete: subLinkedHabitAutoCheckInOnComplete,
                                linkedHabitAutoCheckInOptionKey: subLinkedHabitAutoCheckInOptionKey,
                                linkedHabitAutoCheckInEmoji: subLinkedHabitAutoCheckInEmoji,
                            });

                            if (subBlockId) {
                                try {
                                    const projectId = assertOptionalString(input.projectId, "projectId");
                                    if (projectId) {
                                        await addBlockProjectId(subBlockId, projectId);
                                    } else {
                                        await setBlockProjectIds(subBlockId, []);
                                    }
                                    await updateBindBlockAtrrs(subBlockId, (reminderManager as any).plugin);
                                } catch (error) {
                                    console.warn('同步子任务绑定块属性失败:', error);
                                }
                            }
                            subtasksResult.push(subTask);
                        }
                    }

                    return successResponse(cleanObject({
                        ...parentTask,
                        subtasks: subtasksResult,
                    }));
                }

                case "update_task": {
                    const updates = assertArray(input.updates, "updates") as any[];
                    const normalized: any[] = [];
                    const plugin = (reminderManager as any).plugin;

                    for (const update of updates) {
                        assertDefined(update.id, "updates[].id");
                        const id = assertString(update.id, "updates[].id");

                        const existing = await reminderManager.getReminderById(id);
                        if (!existing) {
                            continue;
                        }

                        const oldBlockId = existing.blockId;
                        const newBlockId = update.blockId !== undefined ? assertOptionalString(update.blockId, "updates[].blockId") : oldBlockId;

                        const oldProjectId = existing.projectId;
                        const newProjectId = update.projectId !== undefined ? assertOptionalString(update.projectId, "updates[].projectId") : oldProjectId;

                        let docId = existing.docId;
                        if (update.blockId !== undefined) {
                            if (newBlockId) {
                                try {
                                    const block = await getBlockByID(newBlockId);
                                    docId = block?.root_id || (block?.type === 'd' ? block?.id : undefined);
                                } catch (error) {
                                    console.error('获取块信息失败:', error);
                                    docId = undefined;
                                }
                            } else {
                                docId = undefined;
                            }
                        }

                        const updateCompleted = assertOptionalBoolean(update.completed, "updates[].completed");
                        const updateKanbanStatus = assertOptionalString(update.kanbanStatus, "updates[].kanbanStatus");
                        await ensureKanbanStatusExists(updateKanbanStatus, newProjectId);

                        const completed = updateCompleted !== undefined 
                            ? updateCompleted 
                            : (updateKanbanStatus === 'completed' ? true : undefined);

                        const customProgress = parseCustomProgress(update.customProgress, "updates[].customProgress");

                        const linkedHabitId = update.linkedHabitId !== undefined ? assertOptionalString(update.linkedHabitId, "updates[].linkedHabitId") : undefined;
                        const linkedHabitSyncPomodoroToday = update.linkedHabitSyncPomodoroToday !== undefined ? assertOptionalBoolean(update.linkedHabitSyncPomodoroToday, "updates[].linkedHabitSyncPomodoroToday") : undefined;
                        const linkedHabitAutoCheckInOnComplete = update.linkedHabitAutoCheckInOnComplete !== undefined ? assertOptionalBoolean(update.linkedHabitAutoCheckInOnComplete, "updates[].linkedHabitAutoCheckInOnComplete") : undefined;
                        const linkedHabitAutoCheckInOptionKey = update.linkedHabitAutoCheckInOptionKey !== undefined ? assertOptionalString(update.linkedHabitAutoCheckInOptionKey, "updates[].linkedHabitAutoCheckInOptionKey") : undefined;
                        const linkedHabitAutoCheckInEmoji = update.linkedHabitAutoCheckInEmoji !== undefined ? assertOptionalString(update.linkedHabitAutoCheckInEmoji, "updates[].linkedHabitAutoCheckInEmoji") : undefined;

                        const normalizedUpdate: any = {
                            id,
                            title: assertOptionalString(update.title, "updates[].title"),
                            note: assertOptionalString(update.note, "updates[].note"),
                            date: assertOptionalDateString(update.date, "updates[].date"),
                            time: assertOptionalTimeString(update.time, "updates[].time"),
                            reminderTimes: parseReminderTimes(update.reminderTimes, "updates[].reminderTimes"),
                            endDate: assertOptionalDateString(update.endDate, "updates[].endDate"),
                            endTime: assertOptionalTimeString(update.endTime, "updates[].endTime"),
                            priority: assertOptionalEnum(update.priority, "updates[].priority", ["high", "medium", "low", "none"]),
                            projectId: assertOptionalString(update.projectId, "updates[].projectId"),
                            categoryId: assertOptionalString(update.categoryId, "updates[].categoryId"),
                            completed,
                            repeat: assertOptionalObject(update.repeat, "updates[].repeat"),
                            blockId: update.blockId !== undefined ? newBlockId : undefined,
                            docId: update.blockId !== undefined ? docId : undefined,
                            url: assertOptionalString(update.url, "updates[].url"),
                            kanbanStatus: updateKanbanStatus,
                            customProgress,
                            linkedHabitId,
                            linkedHabitSyncPomodoroToday,
                            linkedHabitAutoCheckInOnComplete,
                            linkedHabitAutoCheckInOptionKey,
                            linkedHabitAutoCheckInEmoji,
                        };

                        normalized.push(normalizedUpdate);

                        // 执行思源块的属性和书签同步
                        try {
                            if (oldBlockId && newBlockId !== oldBlockId) {
                                // 块绑定发生改变，解绑老块
                                await updateBindBlockAtrrs(oldBlockId, plugin);
                            }
                            if (newBlockId) {
                                if (newBlockId !== oldBlockId || newProjectId !== oldProjectId) {
                                    if (newProjectId) {
                                        await addBlockProjectId(newBlockId, newProjectId);
                                    } else {
                                        await setBlockProjectIds(newBlockId, []);
                                    }
                                }
                                await updateBindBlockAtrrs(newBlockId, plugin);
                            }
                        } catch (error) {
                            console.warn('同步更新绑定块属性失败:', id, error);
                        }
                    }

                    const tasks = await reminderManager.updateReminders(normalized);
                    return successResponse(cleanObject(tasks));
                }

                case "delete_task": {
                    const id = assertString(input.id, "id");
                    const success = await reminderManager.deleteReminder(id);
                    return successResponse({ success });
                }

                case "list_categories": {
                    const categories = await categoryManager.listCategories();
                    return successResponse(cleanObject(categories));
                }

                default:
                    return errorResponse(`未知的任务操作: ${action}`);
            }
        }),
    };
}

function assertEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    return assertOptionalEnum(value, field, allowed) as T;
}

function assertReminderTimeString(value: unknown, field: string): string {
    const str = assertString(value, field);
    if (!/^(?:\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2}$/.test(str)) {
        throw new ValidationError(`字段 ${field} 必须是 HH:MM 或 YYYY-MM-DDTHH:MM 格式的时间字符串`);
    }
    return str;
}

function parseReminderTimes(value: unknown, field: string): ReminderTime[] | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const items = assertArray<unknown>(value, field);
    return items.map((item, index) => {
        const itemField = `${field}[${index}]`;
        const entry = assertOptionalObject(item, itemField)!;
        return {
            time: assertReminderTimeString(entry.time, `${itemField}.time`),
            endTime: entry.endTime === undefined
                ? undefined
                : assertReminderTimeString(entry.endTime, `${itemField}.endTime`),
            note: assertOptionalString(entry.note, `${itemField}.note`),
        };
    });
}

function cleanObject<T>(obj: T): T {
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => cleanObject(item)) as any;
    }
    if (typeof obj === "object") {
        const result: any = {};
        for (const key of Object.keys(obj)) {
            const val = (obj as any)[key];
            if (val !== null && val !== undefined) {
                result[key] = cleanObject(val);
            }
        }
        return result;
    }
    return obj;
}

function filterRepeatInstances(obj: any, targetDate?: string): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => filterRepeatInstances(item, targetDate));
    }
    if (typeof obj === "object") {
        const result: any = {};
        for (const key of Object.keys(obj)) {
            if (key === "repeat" && obj.repeat && typeof obj.repeat === "object") {
                const { instances, ...restRepeat } = obj.repeat;
                if (targetDate && instances && typeof instances === "object") {
                    const filteredInstances: any = {};
                    if (instances[targetDate]) {
                        filteredInstances[targetDate] = instances[targetDate];
                    }
                    result.repeat = {
                        ...filterRepeatInstances(restRepeat, targetDate),
                        instances: filteredInstances
                    };
                } else {
                    result.repeat = filterRepeatInstances(restRepeat, targetDate);
                }
            } else {
                result[key] = filterRepeatInstances(obj[key], targetDate);
            }
        }
        return result;
    }
    return obj;
}
