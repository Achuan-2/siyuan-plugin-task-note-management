<script lang="ts">
import { onMount, tick } from "svelte";
import type { Habit } from "../HabitPanel";
import { HabitDayDialog } from "../HabitDayDialog";
import { HabitStatsDialog } from "./HabitStatsDialog";
import { DEFAULT_SETTINGS } from "../../index";
import { PomodoroRecordManager } from "../../utils/pomodoroRecord";
import { getLogicalDateString } from "../../utils/dateUtils";
import { HabitGroupManager, type HabitGroup } from "../../utils/habitGroupManager";
import { i18n } from "../../pluginInstance";
import {
    getHabitGoalType as getHabitGoalTypeUtil,
    getHabitPomodoroTargetMinutes as getHabitPomodoroTargetMinutesUtil,
    shouldCheckInOnDate as shouldCheckInOnDateUtil,
    getHabitReminderTimes
} from "../../utils/habitUtils";

export let plugin: any;

type TabKey = "overview" | "week" | "month" | "year";
type OverviewSubTab = "active" | "ended" | "abandoned"; // 概览页的子Tab

type HabitOverviewStats = {
    totalCheckIns: number;
    checkInDays: number;
    streak: number;
    todayPomodoro: number;
    totalPomodoro: number;
    todayPomodoroMinutes: number;
    totalPomodoroMinutes: number;
};

type HabitGroupSection = {
    groupId: string;
    groupName: string;
    habits: Habit[];
};

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const COLOR_POOL = [
    "#7bc96f", "#6ccff6", "#f7a8b8", "#c49bff", "#f4b183",
    "#82c4c3", "#89b4fa", "#f9c97f", "#a3d9a5", "#e8a8ff",
    "#ff9e80", "#9ad0f5", "#ffd166", "#90be6d", "#ffadad"
];

let activeTab: TabKey = "overview";
let overviewSubTab: OverviewSubTab = "active"; // 概览页子Tab：active进行中, ended已结束, abandoned已放弃
let habits: Habit[] = [];
let groupList: HabitGroup[] = [];
let groupedSections: HabitGroupSection[] = [];
let loading = true;
let errorMessage = "";
let weekStartDay = DEFAULT_SETTINGS.weekStartDay ?? 1;
let weekOffset = 0;
let monthOffset = 0;
let yearOffset = 0;
let pomodoroRecordManager: PomodoroRecordManager | null = null;
let pomodoroReady = false;
let pomodoroStatsRevision = 0;
let overviewListEl: HTMLDivElement | null = null;
let weekListEl: HTMLDivElement | null = null;
let monthPanelEl: HTMLDivElement | null = null;
let yearListEl: HTMLDivElement | null = null;

onMount(async () => {
    await Promise.all([loadWeekStartDay(), initPomodoro(), loadGroups(), loadHabits()]);
});

async function initPomodoro() {
    try {
        pomodoroRecordManager = PomodoroRecordManager.getInstance(plugin);
        await pomodoroRecordManager.initialize();
        await pomodoroRecordManager.refreshData(true);
        pomodoroReady = true;
        pomodoroStatsRevision += 1;
    } catch (error) {
        console.warn("初始化番茄统计失败，概览将不显示番茄统计", error);
        pomodoroReady = false;
    }
}

async function loadGroups() {
    try {
        const manager = HabitGroupManager.getInstance();
        await manager.initialize();
        groupList = manager.getAllGroups();
    } catch (error) {
        console.warn("加载习惯分组失败", error);
        groupList = [];
    }
}

async function loadWeekStartDay() {
    try {
        if (plugin && typeof plugin.loadSettings === "function") {
            const settings = await plugin.loadSettings();
            if (settings && typeof settings.weekStartDay === "number") {
                weekStartDay = settings.weekStartDay;
            }
        }
    } catch (error) {
        console.warn("读取 weekStartDay 失败，使用默认值", error);
    }
}

async function loadHabits() {
    loading = true;
    errorMessage = "";
    try {
        if (pomodoroRecordManager) {
            await pomodoroRecordManager.refreshData();
            pomodoroStatsRevision += 1;
        }
        const habitData = await plugin.loadHabitData();
        habits = Object.values(habitData || {}) as Habit[];
    } catch (error) {
        console.error("加载习惯数据失败:", error);
        errorMessage = "加载习惯数据失败";
        habits = [];
    } finally {
        loading = false;
    }
}

function getDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTodayDateKey(): string {
    return getDateKey(new Date());
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function getWeekStart(date: Date): Date {
    const start = new Date(date);
    const offset = (start.getDay() - weekStartDay + 7) % 7;
    start.setDate(start.getDate() - offset + weekOffset * 7);
    start.setHours(0, 0, 0, 0);
    return start;
}

function getCurrentWeekDates(): Date[] {
    const start = getWeekStart(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function getPriorityValue(priority?: string): number {
    switch (priority) {
        case "high": return 3;
        case "medium": return 2;
        case "low": return 1;
        default: return 0;
    }
}

function sortHabitsLikePanel(source: Habit[]): Habit[] {
    const copy = [...source];
    copy.sort((a, b) => {
        const pa = getPriorityValue(a.priority);
        const pb = getPriorityValue(b.priority);
        if (pa !== pb) return pb - pa;

        const sa = (a as any).sort || 0;
        const sb = (b as any).sort || 0;
        if (sa !== sb) return sa - sb;

        return (a.title || "").localeCompare(b.title || "", "zh-CN", { sensitivity: "base" });
    });
    return copy;
}

function buildGroupedSections(input: Habit[]): HabitGroupSection[] {
    const grouped = new Map<string, Habit[]>();
    input.forEach(habit => {
        const groupId = habit.groupId || "none";
        if (!grouped.has(groupId)) grouped.set(groupId, []);
        grouped.get(groupId)!.push(habit);
    });

    const sections: HabitGroupSection[] = [];
    const rendered = new Set<string>();

    groupList.forEach(group => {
        if (!grouped.has(group.id)) return;
        sections.push({
            groupId: group.id,
            groupName: group.name,
            habits: sortHabitsLikePanel(grouped.get(group.id)!)
        });
        rendered.add(group.id);
    });

    if (grouped.has("none")) {
        sections.push({
            groupId: "none",
            groupName: i18n("noneGroupName") || "未分组",
            habits: sortHabitsLikePanel(grouped.get("none")!)
        });
        rendered.add("none");
    }

    grouped.forEach((list, groupId) => {
        if (rendered.has(groupId)) return;
        sections.push({
            groupId,
            groupName: groupId,
            habits: sortHabitsLikePanel(list)
        });
    });

    return sections;
}

function getSuccessCheckInCount(habit: Habit, dateStr: string): number {
    const checkIn = habit.checkIns?.[dateStr];
    if (!checkIn) return 0;

    const emojis: string[] = [];
    if (checkIn.entries && checkIn.entries.length > 0) {
        checkIn.entries.forEach(entry => {
            if (entry.emoji) emojis.push(entry.emoji);
        });
    } else if (checkIn.status && checkIn.status.length > 0) {
        checkIn.status.forEach(emoji => {
            if (emoji) emojis.push(emoji);
        });
    }

    const successFromEmoji = emojis.filter(emoji => {
        const config = habit.checkInEmojis?.find(item => item.emoji === emoji);
        return config ? config.countsAsSuccess !== false : true;
    }).length;

    // 兼容旧数据：只有在没有 status/entries 且有 count 时才使用 count
    if (emojis.length === 0 && typeof checkIn.count === "number" && checkIn.count > 0) {
        return checkIn.count;
    }
    return successFromEmoji;
}

function getHabitGoalType(habit: Habit): "count" | "pomodoro" {
    return getHabitGoalTypeUtil(habit);
}

function getHabitPomodoroTargetMinutes(habit: Habit): number {
    return getHabitPomodoroTargetMinutesUtil(habit);
}

function getHabitPomodoroFocusMinutes(habit: Habit, dateStr: string): number {
    if (!pomodoroReady || !pomodoroRecordManager) return 0;
    const direct = pomodoroRecordManager.getEventFocusTime(habit.id, dateStr) || 0;
    const sessions = pomodoroRecordManager.getDateSessions(dateStr) || [];
    const fromInstances = sessions
        .filter(s => s.type === "work" && s.eventId && s.eventId.startsWith(`${habit.id}_`))
        .reduce((sum, s) => sum + (s.duration || 0), 0);
    return Math.max(direct, fromInstances);
}

function getCheckInEmojis(habit: Habit, dateStr: string): string[] {
    const checkIn = habit.checkIns?.[dateStr];
    if (!checkIn) return [];

    if (checkIn.entries && checkIn.entries.length > 0) {
        return checkIn.entries.map(entry => entry.emoji).filter(Boolean);
    }
    if (checkIn.status && checkIn.status.length > 0) {
        return checkIn.status.filter(Boolean);
    }
    // 兼容旧数据：只有 count 时，用自动打卡emoji或🍅兜底显示
    if (typeof checkIn.count === "number" && checkIn.count > 0) {
        const fallback = habit.autoCheckInEmoji || "🍅";
        return Array.from({ length: Math.min(checkIn.count, 8) }, () => fallback);
    }
    return [];
}

// 获取打卡详情，返回时间和备注的格式化字符串数组
function getCheckInDetails(habit: Habit, dateStr: string): string[] {
    const checkIn = habit.checkIns?.[dateStr];
    if (!checkIn) return [];

    if (checkIn.entries && checkIn.entries.length > 0) {
        return checkIn.entries.map(entry => {
            const timeText = entry.timestamp ? entry.timestamp.slice(11, 16) : ''; // HH:MM 格式
            const noteText = entry.note?.trim();
            if (timeText && noteText) {
                return `${entry.emoji || '📝'} ${timeText} ${noteText}`;
            } else if (timeText) {
                return `${entry.emoji || '📝'} ${timeText}`;
            } else if (noteText) {
                return `${entry.emoji || '📝'} ${noteText}`;
            }
            return entry.emoji || '📝';
        });
    }
    return [];
}

function shouldCheckInOnDate(habit: Habit, dateStr: string): boolean {
    return shouldCheckInOnDateUtil(habit, dateStr);
}

function hasRequiredDateInRange(habit: Habit, dates: Date[]): boolean {
    return dates.some(day => shouldCheckInOnDate(habit, getDateKey(day)));
}

function getFrequencyText(frequency: Habit["frequency"]): string {
    const { type, interval, weekdays, monthDays, months } = frequency;
    switch (type) {
        case "daily":
            return interval ? i18n("freqEveryNDays", { n: String(interval) }) : i18n("freqEveryDay");
        case "weekly":
            if (weekdays && weekdays.length > 0) {
                const weekdayNamesArr = i18n("weekdayNames").split(",");
                const days = weekdays.map((d: number) => weekdayNamesArr[d] || String(d)).join(",");
                return i18n("freqWeekdays", { days });
            }
            return interval ? i18n("freqEveryNWeeks", { n: String(interval) }) : i18n("freqEveryWeek");
        case "monthly":
            if (monthDays && monthDays.length > 0) {
                return i18n("freqMonthDays", { days: monthDays.join(",") });
            }
            return interval ? i18n("freqEveryNMonths", { n: String(interval) }) : i18n("freqEveryMonth");
        case "yearly":
            if (months && months.length > 0) {
                const monthStr = months.join(",");
                if (monthDays && monthDays.length > 0) {
                    return i18n("freqYearMonthDays", { months: monthStr, days: monthDays.join(",") });
                }
                return i18n("freqYearMonths", { months: monthStr });
            }
            return interval ? i18n("freqEveryNYears", { n: String(interval) }) : i18n("freqEveryYear");
        case "ebbinghaus":
            return i18n("ebbinghausRepeat");
        default:
            return i18n("freqEveryDay");
    }
}

function isHabitEnded(habit: Habit): boolean {
    if (habit.abandoned) return false; // 已放弃的习惯不归为已结束
    if (!habit.endDate) return false;
    const today = getTodayDateKey();
    return habit.endDate < today;
}

function isHabitAbandoned(habit: Habit): boolean {
    return habit.abandoned === true;
}

function getHabitDateRangeText(habit: Habit): string {
    if (habit.endDate) {
        return `${habit.startDate} ~ ${habit.endDate}`;
    }
    return `${habit.startDate} ${i18n("timeStart") || "起"}`;
}

function isCheckInComplete(habit: Habit, dateStr: string): boolean {
    if (getHabitGoalType(habit) === "pomodoro") {
        const target = getHabitPomodoroTargetMinutes(habit);
        const current = getHabitPomodoroFocusMinutes(habit, dateStr);
        return current >= target;
    }
    const target = habit.target || 1;
    return getSuccessCheckInCount(habit, dateStr) >= target;
}

function countTotalCheckIns(habit: Habit): number {
    let total = 0;
    Object.values(habit.checkIns || {}).forEach(checkIn => {
        if (checkIn.entries && checkIn.entries.length > 0) {
            total += checkIn.entries.length;
        } else if (checkIn.status && checkIn.status.length > 0) {
            total += checkIn.status.length;
        } else if (typeof checkIn.count === "number") {
            total += checkIn.count;
        }
    });

    if (total === 0 && typeof habit.totalCheckIns === "number") {
        return habit.totalCheckIns;
    }
    return total;
}

function calculateStreak(habit: Habit): number {
    const completedDates = Object.keys(habit.checkIns || {})
        .filter(dateStr => isCheckInComplete(habit, dateStr))
        .sort();

    if (completedDates.length === 0) return 0;

    const completedSet = new Set(completedDates);
    let streak = 0;
    let current = new Date();
    current.setHours(0, 0, 0, 0);

    while (true) {
        const key = getDateKey(current);
        if (!completedSet.has(key)) break;
        streak++;
        current = addDays(current, -1);
    }

    return streak;
}

function getOverviewStats(habit: Habit, _revision: number): HabitOverviewStats {
    const checkInDays = Object.keys(habit.checkIns || {})
        .filter(dateStr => isCheckInComplete(habit, dateStr)).length;
    const today = getLogicalDateString();
    let todayPomodoro = 0;
    let totalPomodoro = 0;
    let todayPomodoroMinutes = 0;
    let totalPomodoroMinutes = 0;

    if (pomodoroReady && pomodoroRecordManager) {
        const daySessions = pomodoroRecordManager.getDateSessions(today) || [];
        daySessions.forEach(session => {
            if (
                session.type === "work" &&
                (session.eventId === habit.id || session.eventId.startsWith(`${habit.id}_`))
            ) {
                todayPomodoro += pomodoroRecordManager!.calculateSessionCount(session as any);
                todayPomodoroMinutes += session.duration || 0;
            }
        });

        const directTotalCount = pomodoroRecordManager.getEventTotalPomodoroCount(habit.id) || 0;
        const repeatTotalCount = pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(habit.id) || 0;
        totalPomodoro = Math.max(directTotalCount, repeatTotalCount);

        const directTotalMinutes = pomodoroRecordManager.getEventTotalFocusTime(habit.id) || 0;
        const repeatTotalMinutes = pomodoroRecordManager.getRepeatingEventTotalFocusTime(habit.id) || 0;
        totalPomodoroMinutes = Math.max(directTotalMinutes, repeatTotalMinutes);

        // 兼容旧数据索引，避免今日数据显示为 0
        todayPomodoro = Math.max(todayPomodoro, pomodoroRecordManager.getEventPomodoroCount(habit.id, today) || 0);
        todayPomodoroMinutes = Math.max(todayPomodoroMinutes, pomodoroRecordManager.getEventFocusTime(habit.id, today) || 0);
    }

    return {
        totalCheckIns: countTotalCheckIns(habit),
        checkInDays,
        streak: calculateStreak(habit),
        todayPomodoro,
        totalPomodoro,
        todayPomodoroMinutes,
        totalPomodoroMinutes
    };
}

function formatMinutes(minutes: number): string {
    const safe = Math.max(0, Math.floor(minutes || 0));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    if (hours > 0) {
        return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
}



// 根据 emoji 数量获取对应的字体大小类名
function getEmojiCountClass(count: number): string {
    if (count === 1) return 'emoji-count-1';
    if (count <= 4) return 'emoji-count-2-4';
    if (count <= 8) return 'emoji-count-5-8';
    if (count <= 12) return 'emoji-count-9-12';
    return 'emoji-count-12plus';
}

function applyAlphaToColor(color: string, alpha: number): string {
    const safeAlpha = Math.min(1, Math.max(0, alpha));
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
    return color;
}

function getHabitColor(habit: Habit): string {
    const alpha = 0.75;
    const defaultColor = '#69bf77';
    if (habit.color && /^#[0-9a-fA-F]{6}$/.test(habit.color)) {
        return applyAlphaToColor(habit.color, alpha);
    }
    return applyAlphaToColor(defaultColor, alpha);
}

function getWeekRangeText(): string {
    const weekDates = getCurrentWeekDates();
    if (weekDates.length === 0) return "";
    const start = weekDates[0];
    const end = weekDates[weekDates.length - 1];
    return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
}

function getMonthDate(): Date {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
}

function getMonthTitle(): string {
    const monthDate = getMonthDate();
    return `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`;
}

function getCurrentYear(): number {
    return new Date().getFullYear() + yearOffset;
}

function getYearTitle(): string {
    return `${getCurrentYear()}年`;
}

function getYearMonthRows(year: number): Array<{ month: number; cells: Array<Date | null> }> {
    const rows: Array<{ month: number; cells: Array<Date | null> }> = [];
    for (let month = 0; month < 12; month++) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const cells: Array<Date | null> = [];
        for (let day = 1; day <= 31; day++) {
            if (day <= daysInMonth) {
                cells.push(new Date(year, month, day));
            } else {
                cells.push(null);
            }
        }
        rows.push({ month, cells });
    }
    return rows;
}

function getYearHabitStats(habit: Habit, year: number): {
    yearCheckInCount: number;
    yearCheckInDays: number;
    completionRate: number;
} {
    const yearPrefix = `${year}-`;
    let yearCheckInCount = 0;
    let yearCheckInDays = 0;

    Object.entries(habit.checkIns || {}).forEach(([dateStr]) => {
        if (!dateStr.startsWith(yearPrefix)) return;

        const emojis = getCheckInEmojis(habit, dateStr);
        yearCheckInCount += emojis.length;
        if (isCheckInComplete(habit, dateStr)) {
            yearCheckInDays += 1;
        }
    });

    const daysInYear = new Date(year, 11, 31).getDate() === 31
        ? (new Date(year, 1, 29).getMonth() === 1 ? 366 : 365)
        : 365;
    const completionRate = daysInYear > 0 ? (yearCheckInDays / daysInYear) * 100 : 0;

    return {
        yearCheckInCount,
        yearCheckInDays,
        completionRate
    };
}

function getWeekdayOrder(): number[] {
    return Array.from({ length: 7 }, (_, i) => (weekStartDay + i) % 7);
}

function getMonthCells(): Array<Date | null> {
    const monthDate = getMonthDate();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadBlanks = (firstDay.getDay() - weekStartDay + 7) % 7;
    const cells: Array<Date | null> = [];

    for (let i = 0; i < leadBlanks; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
        cells.push(new Date(year, month, day));
    }
    return cells;
}

async function openHabitStats(habit: Habit) {
    const habitCopy: Habit = JSON.parse(JSON.stringify(habit));
    // 对于已结束的习惯，默认显示最后一次打卡的月份和年份视图
    const defaultToLastCheckIn = isHabitEnded(habit);
    const dialog = new HabitStatsDialog(habitCopy, async (updatedHabit) => {
        try {
            const habitData = await plugin.loadHabitData();
            habitData[updatedHabit.id] = updatedHabit;
            await plugin.saveHabitData(habitData);
            window.dispatchEvent(new CustomEvent("habitUpdated"));
            await loadHabits();
        } catch (error) {
            console.error("保存习惯统计变更失败:", error);
        }
    }, plugin, defaultToLastCheckIn);
    dialog.show();
}

async function openHabitDayEditor(habit: Habit, dateStr: string) {
    const habitCopy: Habit = JSON.parse(JSON.stringify(habit));
    const dayDialog = new HabitDayDialog(habitCopy, dateStr, async (updatedHabit: Habit) => {
            const scrollTop = getActiveScrollTop();
            const habitData = await plugin.loadHabitData();
            habitData[updatedHabit.id] = updatedHabit;
            await plugin.saveHabitData(habitData);
            window.dispatchEvent(new CustomEvent("habitUpdated"));
            await loadHabits();
            await tick();
            setActiveScrollTop(scrollTop);
        }, plugin);
    dayDialog.show();
}

function getActiveScrollTop(): number {
    switch (activeTab) {
        case "overview":
            return overviewListEl?.scrollTop || 0;
        case "week":
            return weekListEl?.scrollTop || 0;
        case "month":
            return monthPanelEl?.scrollTop || 0;
        case "year":
            return yearListEl?.scrollTop || 0;
        default:
            return 0;
    }
}

function setActiveScrollTop(top: number) {
    switch (activeTab) {
        case "overview":
            if (overviewListEl) overviewListEl.scrollTop = top;
            break;
        case "week":
            if (weekListEl) weekListEl.scrollTop = top;
            break;
        case "month":
            if (monthPanelEl) monthPanelEl.scrollTop = top;
            break;
        case "year":
            if (yearListEl) yearListEl.scrollTop = top;
            break;
    }
}

function prevWeek() {
    weekOffset = weekOffset - 1;
}

function nextWeek() {
    weekOffset = weekOffset + 1;
}

function resetWeek() {
    weekOffset = 0;
}

function prevMonth() {
    monthOffset = monthOffset - 1;
}

function nextMonth() {
    monthOffset = monthOffset + 1;
}

function resetMonth() {
    monthOffset = 0;
}

function prevYear() {
    yearOffset = yearOffset - 1;
}

function nextYear() {
    yearOffset = yearOffset + 1;
}

function resetYear() {
    yearOffset = 0;
}

$: groupedSections = buildGroupedSections(habits);
$: currentWeekDates = (() => {
    weekOffset;
    weekStartDay;
    return getCurrentWeekDates();
})();

$: weekRangeText = (() => {
    weekOffset;
    weekStartDay;
    return getWeekRangeText();
})();

$: monthTitle = (() => {
    monthOffset;
    return getMonthTitle();
})();

$: weekdayOrder = (() => {
    weekStartDay;
    return getWeekdayOrder();
})();

$: monthCells = (() => {
    monthOffset;
    weekStartDay;
    return getMonthCells();
})();

$: currentYear = (() => {
    yearOffset;
    return getCurrentYear();
})();

$: yearTitle = (() => {
    yearOffset;
    return getYearTitle();
})();

$: yearMonthRows = (() => {
    currentYear;
    return getYearMonthRows(currentYear);
})();

$: weekVisibleSections = groupedSections
    .map(section => ({
        ...section,
        habits: section.habits.filter(habit => !isHabitEnded(habit) && !isHabitAbandoned(habit) && hasRequiredDateInRange(habit, currentWeekDates))
    }))
    .filter(section => section.habits.length > 0);

$: monthVisibleDates = monthCells.filter((day): day is Date => day instanceof Date);

$: monthVisibleSections = groupedSections
    .map(section => ({
        ...section,
        habits: section.habits.filter(habit => !isHabitEnded(habit) && !isHabitAbandoned(habit) && hasRequiredDateInRange(habit, monthVisibleDates))
    }))
    .filter(section => section.habits.length > 0);

$: yearVisibleDates = yearMonthRows.flatMap(row => row.cells.filter((day): day is Date => day instanceof Date));

$: yearVisibleSections = groupedSections
    .map(section => ({
        ...section,
        habits: section.habits.filter(habit => !isHabitEnded(habit) && hasRequiredDateInRange(habit, yearVisibleDates))
    }))
    .filter(section => section.habits.length > 0);
</script>

<div class="habit-stats-root">
    <div class="stats-nav">
        <button class:active={activeTab === "overview"} on:click={() => activeTab = "overview"}>概览</button>
        <button class:active={activeTab === "week"} on:click={() => activeTab = "week"}>周打卡视图</button>
        <button class:active={activeTab === "month"} on:click={() => activeTab = "month"}>月打卡视图</button>
        <button class:active={activeTab === "year"} on:click={() => activeTab = "year"}>年视图</button>
    </div>

    {#if loading}
        <div class="state-block">加载中...</div>
    {:else if errorMessage}
        <div class="state-block error">{errorMessage}</div>
    {:else if habits.length === 0}
        <div class="state-block">暂无习惯数据</div>
    {:else if activeTab === "overview"}
        <div class="overview-sub-nav">
            <button class:active={overviewSubTab === "active"} on:click={() => overviewSubTab = "active"}>
                {i18n("habitStatusActive") || "进行中"}
            </button>
            <button class:active={overviewSubTab === "ended"} on:click={() => overviewSubTab = "ended"}>
                {i18n("habitStatusEnded") || "已结束"}
            </button>
            <button class:active={overviewSubTab === "abandoned"} on:click={() => overviewSubTab = "abandoned"}>
                {i18n("habitStatusAbandoned") || "已放弃"}
            </button>
        </div>
        <div class="overview-list" bind:this={overviewListEl}>
            {#each groupedSections.map(section => ({
                ...section,
                habits: section.habits.filter(h => {
                    if (overviewSubTab === "active") return !isHabitEnded(h) && !isHabitAbandoned(h);
                    if (overviewSubTab === "ended") return isHabitEnded(h);
                    if (overviewSubTab === "abandoned") return isHabitAbandoned(h);
                    return true;
                })
            })).filter(section => section.habits.length > 0) as section}
                <div class="hs-overview-group-block">
                    <div class="hs-overview-group-header">
                        <span class="group-name">{section.groupName} ({section.habits.length})</span>
                    </div>

                    <div class="hs-overview-group-content">
                        {#each section.habits as habit}
                            {@const stats = getOverviewStats(habit, pomodoroStatsRevision)}
                            {@const reminderTimes = getHabitReminderTimes(habit)}
                            <div class="overview-card">
                                <div class="overview-main">
                                    <div class="habit-title-row">
                                        <div class="habit-title">{habit.icon || "🌱"} {habit.title}</div>
                                        <button class="view-btn" on:click={() => openHabitStats(habit)}>查看统计</button>
                                    </div>
                                    <div class="habit-meta-row">
                                        <span class="habit-meta-item">
                                            <span class="habit-meta-icon">🔄</span>
                                            <span>{getFrequencyText(habit.frequency)}</span>
                                        </span>
                                        <span class="habit-meta-item">
                                            <span class="habit-meta-icon">📅</span>
                                            <span>{getHabitDateRangeText(habit)}</span>
                                        </span>
                                        {#if reminderTimes.length > 0}
                                            <span class="habit-meta-item">
                                                <span class="habit-meta-icon">⏰</span>
                                                <span>{reminderTimes.map(t => t.time).join(', ')}</span>
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="stat-grid">
                                        <div class="stat-item">
                                            <div class="stat-value">{stats.totalCheckIns}</div>
                                            <div class="stat-label">总打卡次数</div>
                                        </div>
                                        <div class="stat-item">
                                            <div class="stat-value">{stats.checkInDays}</div>
                                            <div class="stat-label">打卡天数</div>
                                        </div>
                                        <div class="stat-item">
                                            <div class="stat-value">{stats.streak}</div>
                                            <div class="stat-label">连续打卡天数</div>
                                        </div>
                                    </div>
                                    {#if stats.totalPomodoro > 0 || stats.totalPomodoroMinutes > 0}
                                        <div class="pomodoro-row">
                                            <div class="pomodoro-item">
                                                <span class="pomodoro-label">🍅 今日番茄钟</span>
                                                <span class="pomodoro-value">{stats.todayPomodoro}（{formatMinutes(stats.todayPomodoroMinutes)}）</span>
                                            </div>
                                            <div class="pomodoro-item">
                                                <span class="pomodoro-label">🍅 总番茄钟</span>
                                                <span class="pomodoro-value">{stats.totalPomodoro}（{formatMinutes(stats.totalPomodoroMinutes)}）</span>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {:else if activeTab === "week"}
        <div class="week-panel">
            <div class="panel-toolbar">
                <button class="nav-btn" on:click={prevWeek}>◀</button>
                <div class="date-range">{weekRangeText}</div>
                <div class="toolbar-right">
                    <button class="today-btn" on:click={resetWeek}>本周</button>
                    <button class="nav-btn" on:click={nextWeek}>▶</button>
                </div>
            </div>

            <div class="week-list" bind:this={weekListEl}>
                {#if weekVisibleSections.length === 0}
                    <div class="state-block">本周没有需要打卡的习惯</div>
                {:else}
                    {#each weekVisibleSections as section}
                        <div class="group-mini-header">{section.groupName} ({section.habits.length})</div>
                        {#each section.habits as habit}
                            <div class="week-row">
                                <div class="week-habit-name ariaLabel" aria-label={habit.title}>{habit.icon || "🌱"} {habit.title}</div>
                                <div class="week-cells">
                                    {#each currentWeekDates as day, dayIndex}
                                    {@const dateStr = getDateKey(day)}
                                    {@const isToday = dateStr === getTodayDateKey()}
                                    {@const required = shouldCheckInOnDate(habit, dateStr)}
                                    {@const done = isCheckInComplete(habit, dateStr)}
                                    {@const emojis = getCheckInEmojis(habit, dateStr)}
                                    {@const checkInDetails = getCheckInDetails(habit, dateStr)}
                                    <div
                                        class="week-cell {done ? 'done' : ''} {!required ? 'not-required' : ''} {isToday ? 'today' : ''} ariaLabel"
                                        style={`--habit-color: ${getHabitColor(habit)};`}
                                        aria-label={`${WEEKDAY_NAMES[(weekStartDay + dayIndex) % 7]}${checkInDetails.length > 0 ? '\n' + checkInDetails.join('\n') : (done ? "\n已打卡" : "\n未打卡")}`}
                                        on:click={() => openHabitDayEditor(habit, dateStr)}
                                    >
                                            {#if emojis.length > 0}
                                                <div class="week-cell-emojis {getEmojiCountClass(emojis.length)} {emojis.length >= 6 ? 'wrap-bottom' : ''}">
                                                    {#each emojis as emoji}
                                                        <span class="week-cell-emoji-item">{emoji}</span>
                                                    {/each}
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    {/each}
                {/if}
            </div>
        </div>
    {:else if activeTab === "month"}
        <div class="month-panel" bind:this={monthPanelEl}>
            <div class="panel-toolbar">
                <button class="nav-btn" on:click={prevMonth}>◀</button>
                <div class="date-range">{monthTitle}</div>
                <div class="toolbar-right">
                    <button class="today-btn" on:click={resetMonth}>本月</button>
                    <button class="nav-btn" on:click={nextMonth}>▶</button>
                </div>
            </div>

            {#if monthVisibleSections.length === 0}
                <div class="state-block">本月没有需要打卡的习惯</div>
            {:else}
                {#each monthVisibleSections as section}
                    <div class="group-mini-header">{section.groupName} ({section.habits.length})</div>
                    <div class="month-card-grid">
                        {#each section.habits as habit}
                            <div class="month-card">
                                <div class="month-card-title">{habit.icon || "🌱"} {habit.title}</div>
                                <div class="month-weekdays">
                                    {#each weekdayOrder as weekday}
                                        <span>{WEEKDAY_NAMES[weekday]}</span>
                                    {/each}
                                </div>
                                <div class="month-days">
                                    {#each monthCells as day}
                                        {#if !day}
                                            <div class="month-day empty"></div>
                                        {:else}
                                            {@const dateStr = getDateKey(day)}
                                            {@const isToday = dateStr === getTodayDateKey()}
                                            {@const required = shouldCheckInOnDate(habit, dateStr)}
                                            {@const done = isCheckInComplete(habit, dateStr)}
                                            {@const dayEmojis = getCheckInEmojis(habit, dateStr)}
                                            {@const dayCheckInDetails = getCheckInDetails(habit, dateStr)}
                                            <div
                                                class="month-day {done ? 'done' : ''} {!required ? 'not-required' : ''} {isToday ? 'today' : ''} ariaLabel"
                                                style={`--habit-color: ${getHabitColor(habit)};`}
                                                aria-label={`${dateStr}${dayCheckInDetails.length > 0 ? '\n' + dayCheckInDetails.join('\n') : (done ? "\n已打卡" : "\n未打卡")}`}
                                                on:click={() => openHabitDayEditor(habit, dateStr)}
                                            >
                                                <div class="month-day-content">
                                                    <div class="month-day-date">{day.getDate()}</div>
                                                    {#if dayEmojis.length > 0}
                                                        <div class="month-day-emojis {getEmojiCountClass(dayEmojis.length)} {dayEmojis.length >= 6 ? 'wrap-bottom' : ''}">
                                                            {#each dayEmojis as emoji}
                                                                <span>{emoji}</span>
                                                            {/each}
                                                        </div>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/if}
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/each}
            {/if}
        </div>
    {:else}
        <div class="year-panel">
            <div class="panel-toolbar">
                <button class="nav-btn" on:click={prevYear}>◀</button>
                <div class="date-range">{yearTitle}</div>
                <div class="toolbar-right">
                    <button class="today-btn" on:click={resetYear}>今年</button>
                    <button class="nav-btn" on:click={nextYear}>▶</button>
                </div>
            </div>

            <div class="year-list" bind:this={yearListEl}>
                {#if yearVisibleSections.length === 0}
                    <div class="state-block">今年没有需要打卡的习惯</div>
                {:else}
                    {#each yearVisibleSections as section}
                        <div class="group-mini-header">{section.groupName} ({section.habits.length})</div>
                        {#each section.habits as habit}
                            {@const yStats = getYearHabitStats(habit, currentYear)}
                            <div class="year-card" style={`--habit-color: ${getHabitColor(habit)};`}>
                                <div class="year-card-header">
                                    <div class="year-card-title">{habit.icon || "🌱"} {habit.title}</div>
                                    <div class="year-card-meta">
                                        <span>{yStats.completionRate.toFixed(0)}%</span>
                                        <span>{yStats.yearCheckInDays}天</span>
                                    </div>
                                </div>

                                <div class="year-grid">
                                    {#each yearMonthRows as monthRow}
                                        <div class="year-month-row">
                                            <div class="year-month-label">{monthRow.month + 1}月</div>
                                            <div class="year-month-cells">
                                                {#each monthRow.cells as day}
                                                    {#if !day}
                                                        <div class="year-day empty"></div>
                                                    {:else}
                                                        {@const dateStr = getDateKey(day)}
                                                        {@const isToday = dateStr === getTodayDateKey()}
                                                        {@const required = shouldCheckInOnDate(habit, dateStr)}
                                                        {@const done = isCheckInComplete(habit, dateStr)}
                                                        {@const dayEmojis = getCheckInEmojis(habit, dateStr)}
                                                        {@const dayCheckInDetails = getCheckInDetails(habit, dateStr)}
                                                        <div
                                                            class="year-day {done ? 'done' : ''} {!required ? 'not-required' : ''} {isToday ? 'today' : ''} ariaLabel"
                                                            aria-label={`${dateStr}${dayCheckInDetails.length > 0 ? '\n' + dayCheckInDetails.join('\n') : (done ? "\n已打卡" : "\n未打卡")}`}
                                                            on:click={() => openHabitDayEditor(habit, dateStr)}
                                                        >
                                                            {#if dayEmojis.length > 0}
                                                                <div class="year-day-emojis {getEmojiCountClass(dayEmojis.length)} {dayEmojis.length >= 4 ? 'dense' : ''} {dayEmojis.length >= 7 ? 'tiny' : ''}">
                                                                    {#each dayEmojis as emoji}
                                                                        <span>{emoji}</span>
                                                                    {/each}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                    {/if}
                                                {/each}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    {/each}
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .habit-stats-root {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .stats-nav {
        display: flex;
        gap: 8px;
        border-bottom: 1px solid var(--b3-border-color);
        padding-bottom: 10px;
        flex-wrap: wrap;
    }

    .stats-nav button {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 8px;
        padding: 6px 12px;
        cursor: pointer;
    }

    .stats-nav button.active {
        border-color: var(--b3-theme-primary);
        color: #fff;
        background: var(--b3-theme-primary);
    }

    .overview-sub-nav {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
        padding: 0 2px;
    }

    .overview-sub-nav button {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 4px 12px;
        cursor: pointer;
        font-size: 13px;
    }

    .overview-sub-nav button.active {
        border-color: var(--b3-theme-primary);
        color: var(--b3-theme-primary);
        background: color-mix(in srgb, var(--b3-theme-primary) 10%, transparent);
        font-weight: 600;
    }

    .state-block {
        padding: 26px 12px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
    }

    .state-block.error {
        color: var(--b3-theme-error);
    }

    .overview-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow: auto;
        padding-right: 4px;
    }

    .hs-overview-group-block {
        border: 0;
        border-radius: 0;
        background: transparent;
        overflow: visible;
        margin-bottom: 6px;
    }

    .hs-overview-group-header {
        width: 100%;
        border: 0 !important;
        background: transparent;
        color: var(--b3-theme-on-surface);
        text-align: left;
        padding: 2px 2px 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        appearance: none;
        box-shadow: none;
    }

    .hs-overview-group-content {
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow: visible;
        max-height: none;
    }

    .group-mini-header {
        font-weight: 700;
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        margin: 8px 2px 6px;
    }

    .overview-card {
        border: 0;
        background: color-mix(in srgb, var(--b3-theme-surface) 86%, transparent 14%);
        border-radius: 12px;
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
        min-height: 92px;
        overflow: visible;
        box-shadow: none;
    }

    .overview-main {
        flex: 1;
        min-width: 0;
    }

    .habit-title {
        font-size: 16px;
        font-weight: 600;
        word-break: break-word;
        white-space: normal;
        flex: 0 1 auto;
    }

    .habit-title-row {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        margin-bottom: 4px;
        width: fit-content;
        max-width: 100%;
    }

    .habit-meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .habit-meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .habit-meta-icon {
        font-size: 11px;
    }

    .stat-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(90px, 1fr));
        gap: 6px;
    }

    .stat-item {
        border-radius: 8px;
        background: var(--b3-theme-background);
        padding: 6px 8px;
        text-align: center;
    }

    .stat-value {
        font-size: 18px;
        font-weight: 700;
        color: var(--b3-theme-primary);
    }

    .stat-label {
        font-size: 12px;
        margin-top: 4px;
        color: var(--b3-theme-on-surface-light);
    }

    .pomodoro-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }

    .pomodoro-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-background);
        border-radius: 999px;
        padding: 4px 8px;
    }

    .pomodoro-value {
        color: var(--b3-theme-primary);
        font-weight: 600;
    }

    .view-btn {
        border: 1px solid var(--b3-theme-primary);
        color: var(--b3-theme-primary);
        background: transparent;
        border-radius: 8px;
        padding: 6px 10px;
        cursor: pointer;
        white-space: nowrap;
    }

    .panel-toolbar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 10px;
    }

    .nav-btn {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        border-radius: 8px;
        width: 34px;
        height: 30px;
        cursor: pointer;
    }

    .date-range {
        min-width: 180px;
        text-align: center;
        font-weight: 600;
    }

    .toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .today-btn {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 8px;
        height: 30px;
        padding: 0 10px;
        cursor: pointer;
    }

    .week-panel {
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .week-list {
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-right: 4px;
    }

    .week-row {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        border-radius: 12px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: minmax(140px, 1fr) auto;
        align-items: center;
        gap: 12px;
    }

    .week-habit-name {
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .week-cells {
        display: grid;
        grid-template-columns: repeat(7, 28px);
        gap: 6px;
    }

    .week-cell {
        width: 28px;
        height: 28px;
        border-radius: 9px;
        background: var(--b3-theme-surface-lighter);
        border: 1px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding: 1px;
        box-sizing: border-box;
        contain: layout style;
    }

    .week-cell.done {
        background: color-mix(in srgb, var(--habit-color) 70%, white 30%);
    }
    .week-cell.today {
        border-color: var(--b3-theme-primary) !important;
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--b3-theme-primary) 35%, transparent 65%);
    }

    .week-cell.not-required {
        opacity: 0.32;
    }

    .week-cell.not-required.done {
        opacity: 0.6;
    }

    .week-cell-emojis {
        width: 100%;
        height: 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        align-content: center;
        gap: 0 1px;
        line-height: 1;
        text-align: center;
        font-size: clamp(8px, 40%, 12px);
    }

    .week-cell-emojis.emoji-count-1 {
        font-size: clamp(12px, 60%, 18px);
    }
    .week-cell-emojis.emoji-count-2-4 {
        font-size: clamp(10px, 50%, 14px);
    }
    .week-cell-emojis.emoji-count-5-8 {
        font-size: clamp(8px, 40%, 11px);
    }
    .week-cell-emojis.emoji-count-9-12 {
        font-size: clamp(6px, 30%, 9px);
    }
    .week-cell-emojis.emoji-count-12plus {
        font-size: clamp(5px, 25%, 7px);
    }

    .week-cell-emojis.wrap-bottom {
        justify-content: center;
        padding-bottom: 1px;
        font-size: clamp(6px, 30%, 9px);
    }

    .week-cell-emoji-item {
        font-size: inherit;
        line-height: 1;
        transform: none;
    }

    .month-panel {
        display: flex;
        flex-direction: column;
        overflow: auto;
        padding-right: 4px;
    }

    .month-card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
        margin-bottom: 8px;
    }

    .month-card {
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        border-radius: 14px;
        padding: 12px;
        container-type: inline-size;
        min-width: 280px;
    }

    .month-card-title {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .month-weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
        margin-bottom: 6px;
        color: var(--b3-theme-on-surface-light);
        font-size: 12px;
        text-align: center;
    }

    .month-days {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
    }

    .month-day {
        aspect-ratio: 1;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-surface);
        border: 1px solid transparent;
        padding: 2px;
        box-sizing: border-box;
        min-height: 32px;
        contain: layout style;
    }

    .month-day.done {
        background: color-mix(in srgb, var(--habit-color) 65%, white 35%);
        font-weight: 600;
    }
    .month-day.today {
        border-color: var(--b3-theme-primary) !important;
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--b3-theme-primary) 35%, transparent 65%);
    }

    .month-day.not-required {
        opacity: 0.36;
    }

    .month-day.not-required.done {
        opacity: 0.62;
    }

    .month-day.empty {
        background: transparent;
    }

    .month-day-content {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 1px;
        overflow: hidden;
    }

    .month-day-date {
        font-size: 10px;
        line-height: 1;
        color: var(--b3-theme-on-surface-light);
        margin-top: 1px;
        flex-shrink: 0;
        z-index: 1;
        background: inherit;
        border-radius: 2px;
        padding: 0 2px;
    }

    .month-day-emojis {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-content: center;
        gap: 0 1px;
        line-height: 1;
        flex: 1;
        width: 100%;
        min-height: 0;
        overflow: hidden;
    }

    .month-day-emojis.wrap-bottom {
        align-content: flex-end;
        justify-content: center;
        padding-bottom: 1px;
        mask-image: none;
        -webkit-mask-image: none;
    }



    /* 月视图 emoji 字体大小 - 基于 month-card 容器查询 */
    .month-card .month-day-emojis {
        font-size: clamp(6px, 4cqw, 12px);
    }
    .month-card .month-day-emojis.emoji-count-1 {
        font-size: clamp(10px, 4cqw, 18px);
    }
    .month-card .month-day-emojis.emoji-count-2-4 {
        font-size: clamp(8px, 2.5cqw, 14px);
    }
    .month-card .month-day-emojis.emoji-count-5-8 {
        font-size: clamp(6px, 2cqw, 11px);
    }
    .month-card .month-day-emojis.emoji-count-9-12 {
        font-size: clamp(5px, 2cqw, 9px);
    }
    .month-card .month-day-emojis.emoji-count-12plus {
        font-size: clamp(4px, 1.5cqw, 7px);
    }


    .year-panel {
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .year-list {
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-right: 4px;
    }

    .year-card {
        border-radius: 16px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        padding: 12px;
    }

    .year-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
    }

    .year-card-title {
        font-size: 15px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .year-card-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        color: color-mix(in srgb, var(--habit-color) 70%, var(--b3-theme-on-surface-light) 30%);
        font-weight: 600;
        white-space: nowrap;
    }

    .year-grid {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .year-month-row {
        display: grid;
        grid-template-columns: 34px 1fr;
        align-items: center;
        gap: 4px;
    }

    .year-month-label {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        text-align: right;
    }

    .year-month-cells {
        display: grid;
        grid-template-columns: repeat(31, minmax(0, 1fr));
        gap: 2px;
        container-type: inline-size;
    }

    .year-day {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 3px;
        background: color-mix(in srgb, var(--b3-theme-surface-lighter) 85%, white 15%);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding: 1px;
        box-sizing: border-box;
        min-height: 16px;
        contain: layout style;
    }

    .year-day.done {
        background: color-mix(in srgb, var(--habit-color) 78%, white 22%);
    }
    .year-day.today {
        border: 1px solid var(--b3-theme-primary);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--b3-theme-primary) 35%, transparent 65%);
    }

    .year-day.not-required {
        opacity: 0.34;
    }

    .year-day.not-required.done {
        opacity: 0.6;
    }

    .year-day.empty {
        background: transparent;
    }

    .year-day-emojis {
        width: 100%;
        height: 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        align-content: center;
        gap: 0 1px;
        font-size: clamp(4px, 2.5cqw, 10px);
        line-height: 1;
    }

    .year-day-emojis.emoji-count-1 {
        font-size: clamp(6px, 4cqw, 12px);
    }
    .year-day-emojis.emoji-count-2-4 {
        font-size: clamp(5px, 3cqw, 9px);
    }
    .year-day-emojis.emoji-count-5-8 {
        font-size: clamp(4px, 2.5cqw, 8px);
    }
    .year-day-emojis.emoji-count-9-12 {
        font-size: clamp(3px, 2cqw, 6px);
    }
    .year-day-emojis.emoji-count-12plus {
        font-size: clamp(2px, 1.5cqw, 5px);
    }

    .year-day-emojis span {
        font-size: inherit;
        line-height: 1;
        transform: none;
    }

    .year-day-emojis.dense {
        font-size: clamp(3px, 2cqw, 8px);
    }

    .year-day-emojis.tiny {
        font-size: clamp(2px, 1.5cqw, 6px);
    }
</style>
