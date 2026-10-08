import type { HabitManager } from "../../components/dataManager/habitManager";
import type { ToolDefinition } from "./common";
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
    assertNumber,
    assertOptionalNumber,
    assertOptionalEnum,
    assertOptionalDateString,
    assertObject,
    assertOptionalObject,
    assertOptionalArray,
    assertOptionalBoolean,
} from "../utils/validation";

const HABIT_ACTIONS = ["search_habit", "create_habit", "update_habit", "get_checkins", "upsert_checkins"] as const;
type HabitAction = typeof HABIT_ACTIONS[number];

export function createHabitTool(habitManager: HabitManager): ToolDefinition {
    return {
        name: "habit",
        config: {
            title: "习惯管理",
            description: "习惯管理操作。Actions: search_habit(搜索/列出习惯), create_habit(创建习惯), update_habit(修改习惯), get_checkins(打卡记录), upsert_checkins(创建/更新打卡)。",
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        description: "操作类型",
                        enum: HABIT_ACTIONS,
                    },
                    // search_habit
                    activeOnly: { type: "boolean", description: "仅返回未放弃的习惯" },
                    keyword: { type: "string", description: "关键词，匹配习惯名称" },
                    // update / get_checkins / upsert_checkins
                    id: { type: "string", description: "习惯 ID" },
                    // create / update
                    title: { type: "string", description: "习惯名称" },
                    target: { type: "number", description: "目标数量" },
                    goalType: { type: "string", enum: ["count", "pomodoro", "either"], description: "目标类型：次数、番茄时长或任一达标" },
                    pomodoroTargetHours: { type: "number", description: "番茄目标小时数" },
                    pomodoroTargetMinutes: { type: "number", description: "番茄目标分钟数" },
                    frequency: {
                        type: "object",
                        description: "频率设置",
                        properties: {
                            type: { type: "string", enum: ["daily", "weekly", "monthly", "yearly", "ebbinghaus", "custom"] },
                            interval: { type: "number" },
                            weekdays: { type: "array", items: { type: "number" } },
                            monthDays: { type: "array", items: { type: "number" } },
                            months: { type: "array", items: { type: "number" } },
                        },
                    },
                    startDate: { type: "string", description: "开始日期 YYYY-MM-DD" },
                    endDate: { type: "string", description: "结束日期 YYYY-MM-DD" },
                    icon: { type: "string", description: "图标" },
                    color: { type: "string", description: "颜色" },
                    abandoned: { type: "boolean" },
                    // get_checkins
                    startDateCheckin: { type: "string", description: "打卡记录开始日期 YYYY-MM-DD" },
                    endDateCheckin: { type: "string", description: "打卡记录结束日期 YYYY-MM-DD" },
                    // upsert_checkins
                    date: { type: "string", description: "打卡日期 YYYY-MM-DD" },
                    count: { type: "number", description: "打卡次数" },
                    status: { type: "array", items: { type: "string" }, description: "状态标签" },
                    entries: {
                        type: "array",
                        description: "打卡明细",
                        items: {
                            type: "object",
                            properties: {
                                emoji: { type: "string" },
                                timestamp: { type: "string" },
                                note: { type: "string" },
                                meaning: { type: "string" },
                                group: { type: "string" },
                            },
                            required: ["emoji"],
                        },
                    },
                },
                required: ["action"],
            },
        },
        handler: wrapHandler(async (input) => {
            const action = assertEnum(input.action, "action", HABIT_ACTIONS);

            switch (action) {
                case "search_habit": {
                    const activeOnly = assertOptionalBoolean(input.activeOnly, "activeOnly");
                    let habits = await habitManager.listHabits(activeOnly ?? false);
                    if (input.keyword) {
                        const kw = assertString(input.keyword, "keyword").toLowerCase();
                        habits = habits.filter((h) => h.title.toLowerCase().includes(kw));
                    }
                    const result = habits.map((h) => {
                        const { checkIns, hasNotify, totalCheckIns, ...base } = h as any;
                        return base;
                    });
                    return successResponse(result);
                }

                case "create_habit": {
                    const habit = await habitManager.createHabit({
                        title: assertString(input.title, "title"),
                        target: assertNumber(input.target, "target"),
                        goalType: assertEnum(input.goalType, "goalType", ["count", "pomodoro", "either"]),
                        pomodoroTargetHours: assertOptionalNumber(input.pomodoroTargetHours, "pomodoroTargetHours"),
                        pomodoroTargetMinutes: assertOptionalNumber(input.pomodoroTargetMinutes, "pomodoroTargetMinutes"),
                        frequency: assertObject(input.frequency, "frequency") as any,
                        startDate: assertDateString(input.startDate, "startDate"),
                        endDate: assertOptionalDateString(input.endDate, "endDate"),
                        icon: assertOptionalString(input.icon, "icon"),
                        color: assertOptionalString(input.color, "color"),
                    });
                    return successResponse(habit);
                }

                case "update_habit": {
                    const id = assertString(input.id, "id");
                    const habit = await habitManager.updateHabit(id, {
                        title: assertOptionalString(input.title, "title"),
                        target: assertOptionalNumber(input.target, "target"),
                        goalType: assertOptionalEnum(input.goalType, "goalType", ["count", "pomodoro", "either"]),
                        pomodoroTargetHours: assertOptionalNumber(input.pomodoroTargetHours, "pomodoroTargetHours"),
                        pomodoroTargetMinutes: assertOptionalNumber(input.pomodoroTargetMinutes, "pomodoroTargetMinutes"),
                        frequency: assertOptionalObject(input.frequency, "frequency") as any,
                        startDate: assertOptionalDateString(input.startDate, "startDate"),
                        endDate: assertOptionalDateString(input.endDate, "endDate"),
                        icon: assertOptionalString(input.icon, "icon"),
                        color: assertOptionalString(input.color, "color"),
                        abandoned: assertOptionalBoolean(input.abandoned, "abandoned"),
                    });
                    if (!habit) return errorResponse(`习惯不存在: ${id}`);
                    return successResponse(habit);
                }

                case "get_checkins": {
                    const id = assertString(input.id, "id");
                    const startDate = assertOptionalDateString(input.startDateCheckin, "startDateCheckin");
                    const endDate = assertOptionalDateString(input.endDateCheckin, "endDateCheckin");
                    const checkins = await habitManager.getHabitCheckins(id, startDate, endDate);
                    if (checkins === undefined) return errorResponse(`习惯不存在: ${id}`);
                    return successResponse(checkins);
                }

                case "upsert_checkins": {
                    const id = assertString(input.id, "id");
                    const date = assertDateString(input.date, "date");
                    const checkin = await habitManager.upsertHabitCheckins(id, {
                        date,
                        count: assertOptionalNumber(input.count, "count"),
                        status: assertOptionalArray(input.status, "status") as string[],
                        entries: assertOptionalArray(input.entries, "entries") as any[],
                    });
                    if (!checkin) return errorResponse(`习惯不存在: ${id}`);
                    return successResponse(checkin);
                }

                default:
                    return errorResponse(`未知的习惯操作: ${action}`);
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
