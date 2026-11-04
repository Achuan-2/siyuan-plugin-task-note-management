import type { PomodoroManager } from "../../components/dataManager/pomodoroRecord";
import type { SummaryManager } from "../../components/dataManager/summaryManager";
import type { ToolDefinition } from "./common";
import {
    objectSchema,
    wrapHandler,
    successResponse,
    errorResponse,
} from "./common";
import {
    assertString,
    assertDateString,
    assertOptionalString,
    assertOptionalEnum,
    assertOptionalBoolean,
    assertOptionalNumber,
} from "../utils/validation";

const STATS_ACTIONS = ["get_focuses_by_time", "get_focus", "create_focus", "delete_focus", "get_task_summary"] as const;
type StatsAction = typeof STATS_ACTIONS[number];

const FILTER_PRESETS = ["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "custom"] as const;

function getDateRangeByFilter(filter: typeof FILTER_PRESETS[number]): { startDate: string; endDate: string } {
    const today = new Date();
    const format = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const addDays = (d: Date, days: number) => {
        const result = new Date(d);
        result.setDate(result.getDate() + days);
        return result;
    };

    const startOfWeek = (d: Date) => {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.getFullYear(), d.getMonth(), diff);
    };

    const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

    switch (filter) {
        case "today":
            return { startDate: format(today), endDate: format(today) };
        case "yesterday": {
            const d = addDays(today, -1);
            return { startDate: format(d), endDate: format(d) };
        }
        case "thisWeek": {
            const start = startOfWeek(today);
            return { startDate: format(start), endDate: format(addDays(start, 6)) };
        }
        case "lastWeek": {
            const start = addDays(startOfWeek(today), -7);
            return { startDate: format(start), endDate: format(addDays(start, 6)) };
        }
        case "thisMonth": {
            const start = startOfMonth(today);
            return { startDate: format(start), endDate: format(endOfMonth(today)) };
        }
        case "lastMonth": {
            const start = startOfMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
            const end = endOfMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
            return { startDate: format(start), endDate: format(end) };
        }
        default:
            throw new Error("自定义范围需要提供 startDate 和 endDate");
    }
}

export function createStatsTool(pomodoroManager: PomodoroManager, summaryManager: SummaryManager): ToolDefinition {
    return {
        name: "stats",
        config: {
            title: "数据统计",
            description: "数据统计操作。Actions: get_focuses_by_time(按时间查询专注), get_focus(获取专注记录), create_focus(创建专注记录), delete_focus(删除专注记录), get_task_summary(任务摘要 Markdown)。",
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        description: "操作类型",
                        enum: STATS_ACTIONS,
                    },
                    // get_focuses_by_time / get_task_summary(custom)
                    startDate: { type: "string", description: "开始日期 YYYY-MM-DD" },
                    endDate: { type: "string", description: "结束日期 YYYY-MM-DD" },
                    eventId: { type: "string", description: "按事件 ID 过滤" },
                    // get_focus / delete_focus
                    sessionId: { type: "string", description: "专注记录 ID" },
                    // create_focus
                    type: { type: "string", enum: ["work", "shortBreak", "longBreak"], description: "专注类型" },
                    eventTitle: { type: "string", description: "关联事件标题" },
                    startTime: { type: "string", description: "开始时间 ISO 字符串" },
                    endTime: { type: "string", description: "结束时间 ISO 字符串" },
                    duration: { type: "number", description: "持续分钟数" },
                    plannedDuration: { type: "number", description: "计划持续分钟数" },
                    completed: { type: "boolean", description: "是否完成" },
                    note: { type: "string", description: "备注" },
                    // get_task_summary
                    filter: {
                        type: "string",
                        enum: FILTER_PRESETS,
                        description: "日期范围预设",
                    },
                    showPomodoro: { type: "boolean", description: "是否显示专注统计" },
                    showHabit: { type: "boolean", description: "是否显示习惯统计" },
                },
                required: ["action"],
            },
        },
        handler: wrapHandler(async (input) => {
            const action = assertEnum(input.action, "action", STATS_ACTIONS);
            await pomodoroManager.reloadRecords();

            switch (action) {
                case "get_focuses_by_time": {
                    const startDate = assertDateString(input.startDate, "startDate");
                    const endDate = assertDateString(input.endDate, "endDate");
                    const eventId = assertOptionalString(input.eventId, "eventId");
                    const sessions = await pomodoroManager.getFocusesByTime(startDate, endDate, eventId);
                    return successResponse(sessions);
                }

                case "get_focus": {
                    const sessionId = assertString(input.sessionId, "sessionId");
                    const result = await pomodoroManager.getFocusById(sessionId);
                    if (!result) return errorResponse(`专注记录不存在: ${sessionId}`);
                    return successResponse(result.session);
                }

                case "create_focus": {
                    const session = await pomodoroManager.createFocus({
                        type: input.type as any,
                        eventId: assertOptionalString(input.eventId, "eventId"),
                        eventTitle: assertOptionalString(input.eventTitle, "eventTitle"),
                        startTime: assertString(input.startTime, "startTime"),
                        endTime: assertString(input.endTime, "endTime"),
                        duration: assertOptionalNumber(input.duration, "duration"),
                        plannedDuration: assertOptionalNumber(input.plannedDuration, "plannedDuration"),
                        completed: assertOptionalBoolean(input.completed, "completed"),
                        note: assertOptionalString(input.note, "note"),
                    });
                    return successResponse(session);
                }

                case "delete_focus": {
                    const sessionId = assertString(input.sessionId, "sessionId");
                    const success = await pomodoroManager.deleteFocus(sessionId);
                    return successResponse({ success });
                }

                case "get_task_summary": {
                    let startDate: string;
                    let endDate: string;

                    const filter = assertOptionalEnum(input.filter, "filter", FILTER_PRESETS);
                    if (filter) {
                        const range = getDateRangeByFilter(filter);
                        startDate = range.startDate;
                        endDate = range.endDate;
                    } else {
                        const now = new Date();
                        const year = now.getFullYear();
                        const month = String(now.getMonth() + 1).padStart(2, "0");
                        const day = String(now.getDate()).padStart(2, "0");
                        const today = `${year}-${month}-${day}`;

                        startDate = input.startDate ? assertDateString(input.startDate, "startDate") : today;
                        endDate = input.endDate ? assertDateString(input.endDate, "endDate") : today;
                    }

                    const showPomodoro = assertOptionalBoolean(input.showPomodoro, "showPomodoro");
                    const showHabit = assertOptionalBoolean(input.showHabit, "showHabit");

                    const markdown = await summaryManager.getTaskSummary(startDate, endDate, {
                        showPomodoro: showPomodoro ?? true,
                        showHabit: showHabit ?? true,
                    });
                    return successResponse({ markdown, startDate, endDate });
                }

                default:
                    return errorResponse(`未知的统计操作: ${action}`);
            }
        }),
    };
}

function assertEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    if (value === undefined || value === null) {
        throw new Error(`缺少必填字段: ${field}`);
    }
    const str = assertString(value, field);
    if (!allowed.includes(str as T)) {
        throw new Error(`字段 ${field} 必须是 ${allowed.join(" / ")} 之一`);
    }
    return str as T;
}
