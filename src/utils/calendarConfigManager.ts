import { Plugin } from "siyuan";
import { getFile, removeFile } from "../api";

const CALENDAR_CONFIG_FILE = '/data/storage/petal/siyuan-plugin-task-note-management/calendar-config.json';
export const CALENDAR_CONFIG_UPDATED_EVENT = 'calendarConfigUpdated';

export interface CalendarConfig {
    colorBy: 'category' | 'priority' | 'project';
    viewMode: 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays' | 'dayGridMultiDays' | 'listMultiDays';
    viewType: 'timeline' | 'kanban' | 'list';
    dockViewMode: 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays' | 'dayGridMultiDays' | 'listMultiDays';
    dockViewType: 'timeline' | 'kanban' | 'list';
    showLunar: boolean;
    showPomodoro: boolean;
    showPomodoroBreakTime: boolean; // 显示番茄钟休息时间
    pomodoroUseTaskColor: boolean; // 番茄钟工作时间使用任务上色方式
    completionFilter: 'all' | 'completed' | 'incomplete';
    showCrossDayTasks: boolean;
    crossDayThreshold: number;
    showSubtasks: boolean;
    showRepeatTasks: boolean;
    repeatInstanceLimit: number;
    showHiddenTasks: boolean; // 显示不在日历视图显示的任务
    showEventCheckbox: boolean; // 显示日历事件前的复选框
    showCompletedTaskTime: boolean; // 显示任务完成时间（总开关）
    showCompletedTaskTimeTimed: boolean; // 显示非全天（定时）任务的完成时间
    showCompletedTaskTimeAllDay: boolean; // 显示全天任务的完成时间
    showCompletedTaskTimeNoDate: boolean; // 显示无日期任务的完成时间
    completedTaskTimeUseTaskColor: boolean; // 完成任务时间使用任务上色方式
    showTasks: boolean; // 是否显示任务
    showHabits: boolean; // 是否显示习惯
    multiDaysCount: number; // 多天视图显示的天数，默认为3天
}

export class CalendarConfigManager {
    private static instance: CalendarConfigManager;
    private config: CalendarConfig;
    private plugin: Plugin;

    private constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.config = {
            colorBy: 'priority', // 默认按优先级上色
            viewMode: 'timeGridWeek', // 默认周视图
            viewType: 'timeline', // 默认视图类型
            dockViewMode: 'timeGridDay', // Dock 默认日视图
            dockViewType: 'timeline', // Dock 默认视图类型
            showLunar: true, // 默认显示农历
            showPomodoro: true, // 默认显示番茄专注时间
            showPomodoroBreakTime: true, // 默认显示番茄钟休息时间
            pomodoroUseTaskColor: false, // 默认不使用任务上色方式
            completionFilter: 'all', // 默认显示全部状态
            showCrossDayTasks: true, // 默认显示跨天任务
            crossDayThreshold: -1, // 默认显示全部天数 (-1表示不限制)
            showSubtasks: true, // 默认显示子任务
            showRepeatTasks: true, // 默认显示重复任务
            repeatInstanceLimit: -1, // 默认显示全部实例 (-1表示不限制)
            showHiddenTasks: false, // 默认不显示隐藏任务
            showEventCheckbox: true, // 默认显示日历事件前复选框
            showCompletedTaskTime: true, // 默认显示任务完成时间（总开关）
            showCompletedTaskTimeTimed: false, // 默认不显示非全天任务的完成时间
            showCompletedTaskTimeAllDay: true, // 默认显示全天任务的完成时间
            showCompletedTaskTimeNoDate: true, // 默认显示无日期任务的完成时间
            completedTaskTimeUseTaskColor: false, // 默认不使用任务上色方式
            showTasks: true, // 默认显示任务
            showHabits: true, // 默认显示习惯
            multiDaysCount: 3 // 默认显示3天
        };
    }

    public static getInstance(plugin: Plugin): CalendarConfigManager {
        if (!CalendarConfigManager.instance) {
            CalendarConfigManager.instance = new CalendarConfigManager(plugin);
        }
        return CalendarConfigManager.instance;
    }

    async initialize() {
        await this.loadConfig();
    }

    private async saveConfig() {
        try {
            const settings = await (this.plugin as any).loadSettings();
            settings.calendarColorBy = this.config.colorBy;
            settings.calendarViewMode = this.config.viewMode;
            settings.calendarViewType = this.config.viewType;
            settings.calendarDockViewMode = this.config.dockViewMode;
            settings.calendarDockViewType = this.config.dockViewType;
            settings.calendarShowLunar = this.config.showLunar;
            settings.calendarShowPomodoro = this.config.showPomodoro;
            settings.calendarShowPomodoroBreakTime = this.config.showPomodoroBreakTime;
            settings.calendarPomodoroUseTaskColor = this.config.pomodoroUseTaskColor;
            settings.calendarCompletionFilter = this.config.completionFilter;
            settings.calendarShowCrossDayTasks = this.config.showCrossDayTasks;
            settings.calendarCrossDayThreshold = this.config.crossDayThreshold;
            settings.calendarShowSubtasks = this.config.showSubtasks;
            settings.calendarShowRepeatTasks = this.config.showRepeatTasks;
            settings.calendarRepeatInstanceLimit = this.config.repeatInstanceLimit;
            settings.calendarShowHiddenTasks = this.config.showHiddenTasks;
            settings.showCalendarEventCheckbox = this.config.showEventCheckbox;
            settings.calendarShowCompletedTaskTime = this.config.showCompletedTaskTime;
            settings.calendarShowCompletedTaskTimeTimed = this.config.showCompletedTaskTimeTimed;
            settings.calendarShowCompletedTaskTimeAllDay = this.config.showCompletedTaskTimeAllDay;
            settings.calendarShowCompletedTaskTimeNoDate = this.config.showCompletedTaskTimeNoDate;
            settings.calendarCompletedTaskTimeUseTaskColor = this.config.completedTaskTimeUseTaskColor;
            settings.calendarShowTasks = this.config.showTasks;
            settings.calendarShowHabits = this.config.showHabits;
            settings.calendarMultiDaysCount = this.config.multiDaysCount;
            await (this.plugin as any).saveSettings(settings);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(CALENDAR_CONFIG_UPDATED_EVENT));
            }
        } catch (error) {
            console.error('Failed to save calendar config:', error);
            throw error;
        }
    }

    private async loadConfig() {
        try {
            const settings = await (this.plugin as any).loadSettings();

            // 检查是否存在旧的 calendar-config.json 文件，如果存在则导入并删除
            try {
                const oldCalendarContent = await getFile(CALENDAR_CONFIG_FILE);
                if (oldCalendarContent && oldCalendarContent.code !== 404) {
                    const oldCalendar = typeof oldCalendarContent === 'string' ? JSON.parse(oldCalendarContent) : oldCalendarContent;
                    if (oldCalendar && typeof oldCalendar === 'object') {
                        // 合并旧日历配置到新的 settings
                        if (oldCalendar.colorBy) settings.calendarColorBy = oldCalendar.colorBy;
                        if (oldCalendar.viewMode) settings.calendarViewMode = oldCalendar.viewMode;
                        await (this.plugin as any).saveSettings(settings);
                        // 删除旧文件
                        await removeFile(CALENDAR_CONFIG_FILE);
                        console.log('成功导入并删除旧的 calendar-config.json 文件');
                    }
                }
            } catch (error) {
                // 如果文件不存在或其他错误，忽略
                console.log('旧的 calendar-config.json 文件不存在或已处理');
            }

            // 处理旧版视图名称迁移：将 MultiDays7 转换为 MultiDays
            let viewMode = settings.calendarViewMode || 'timeGridWeek';
            if (viewMode.includes('MultiDays7')) {
                viewMode = viewMode.replace('MultiDays7', 'MultiDays');
            }

            this.config = {
                colorBy: settings.calendarColorBy || 'project',
                viewMode: viewMode as any,
                viewType: settings.calendarViewType || 'timeline',
                dockViewMode: (settings.calendarDockViewMode || 'timeGridDay') as any,
                dockViewType: settings.calendarDockViewType || 'timeline',
                showLunar: settings.calendarShowLunar !== false, // 默认为 true
                showPomodoro: settings.calendarShowPomodoro !== false, // 默认为 true
                showPomodoroBreakTime: settings.calendarShowPomodoroBreakTime !== false, // 默认为 true
                pomodoroUseTaskColor: settings.calendarPomodoroUseTaskColor === true, // 默认为 false
                completionFilter: (settings.calendarCompletionFilter as any) || 'all',
                showCrossDayTasks: settings.calendarShowCrossDayTasks !== false, // 默认为 true
                crossDayThreshold: settings.calendarCrossDayThreshold !== undefined ? settings.calendarCrossDayThreshold : -1, // 默认为 -1
                showSubtasks: settings.calendarShowSubtasks !== false, // 默认为 true
                showRepeatTasks: settings.calendarShowRepeatTasks !== false, // 默认为 true
                repeatInstanceLimit: settings.calendarRepeatInstanceLimit !== undefined ? settings.calendarRepeatInstanceLimit : -1, // 默认为 -1
                showHiddenTasks: settings.calendarShowHiddenTasks === true, // 默认为 false
                showEventCheckbox: settings.showCalendarEventCheckbox !== false, // 默认为 true
                showCompletedTaskTime: settings.calendarShowCompletedTaskTime !== false, // 默认为 true
                showCompletedTaskTimeTimed: settings.calendarShowCompletedTaskTimeTimed === true, // 默认为 false
                showCompletedTaskTimeAllDay: settings.calendarShowCompletedTaskTimeAllDay !== false, // 默认为 true
                showCompletedTaskTimeNoDate: settings.calendarShowCompletedTaskTimeNoDate !== false, // 默认为 true
                completedTaskTimeUseTaskColor: settings.calendarCompletedTaskTimeUseTaskColor === true, // 默认为 false
                showTasks: settings.calendarShowTasks !== false, // 默认为 true
                showHabits: settings.calendarShowHabits !== false, // 默认为 true
                multiDaysCount: settings.calendarMultiDaysCount !== undefined ? settings.calendarMultiDaysCount : 3 // 默认为3天
            };
        } catch (error) {
            console.warn('Failed to load calendar config, using defaults:', error);
            this.config = {
                colorBy: 'priority',
                viewMode: 'timeGridWeek',
                viewType: 'timeline',
                dockViewMode: 'timeGridDay',
                dockViewType: 'timeline',
                showLunar: true,
                showPomodoro: true,
                showPomodoroBreakTime: true,
                pomodoroUseTaskColor: false,
                completionFilter: 'all',
                showCrossDayTasks: true,
                crossDayThreshold: -1,
                showSubtasks: true,
                showRepeatTasks: true,
                repeatInstanceLimit: -1,
                showHiddenTasks: false,
                showEventCheckbox: true,
                showCompletedTaskTime: true,
                showCompletedTaskTimeTimed: false,
                showCompletedTaskTimeAllDay: true,
                showCompletedTaskTimeNoDate: true,
                completedTaskTimeUseTaskColor: false,
                showTasks: true,
                showHabits: true,
                multiDaysCount: 3
            };
            try {
                await this.saveConfig();
            } catch (saveError) {
                console.error('Failed to create initial calendar config:', saveError);
            }
        }
    }

    public async setColorBy(colorBy: 'category' | 'priority' | 'project') {
        this.config.colorBy = colorBy;
        await this.saveConfig();
    }

    public async setCompletionFilter(filter: 'all' | 'completed' | 'incomplete') {
        this.config.completionFilter = filter;
        await this.saveConfig();
    }

    public getColorBy(): 'category' | 'priority' | 'project' {
        return this.config.colorBy;
    }

    public async setViewMode(viewMode: 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays' | 'dayGridMultiDays' | 'listMultiDays') {
        this.config.viewMode = viewMode;
        await this.saveConfig();
    }

    public getViewMode(): 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays' | 'dayGridMultiDays' | 'listMultiDays' {
        return this.config.viewMode;
    }

    public async setViewType(viewType: 'timeline' | 'kanban' | 'list') {
        this.config.viewType = viewType;
        await this.saveConfig();
    }

    public getViewType(): 'timeline' | 'kanban' | 'list' {
        return this.config.viewType;
    }

    // Dock 侧边栏独立的视图模式
    public async setDockViewMode(viewMode: CalendarConfig['viewMode']) {
        this.config.dockViewMode = viewMode;
        await this.saveConfig();
    }

    public getDockViewMode(): CalendarConfig['viewMode'] {
        return this.config.dockViewMode;
    }

    public async setDockViewType(viewType: 'timeline' | 'kanban' | 'list') {
        this.config.dockViewType = viewType;
        await this.saveConfig();
    }

    public getDockViewType(): 'timeline' | 'kanban' | 'list' {
        return this.config.dockViewType;
    }

    public getCompletionFilter(): 'all' | 'completed' | 'incomplete' {
        return this.config.completionFilter || 'all';
    }

    public async setShowLunar(showLunar: boolean) {
        this.config.showLunar = showLunar;
        await this.saveConfig();
    }

    public getShowLunar(): boolean {
        return this.config.showLunar;
    }

    public async setShowPomodoro(showPomodoro: boolean) {
        this.config.showPomodoro = showPomodoro;
        await this.saveConfig();
    }

    public getShowPomodoro(): boolean {
        return this.config.showPomodoro;
    }

    public async setShowPomodoroBreakTime(show: boolean) {
        this.config.showPomodoroBreakTime = show;
        await this.saveConfig();
    }

    public getShowPomodoroBreakTime(): boolean {
        return this.config.showPomodoroBreakTime !== undefined ? this.config.showPomodoroBreakTime : true;
    }

    public async setPomodoroUseTaskColor(use: boolean) {
        this.config.pomodoroUseTaskColor = use;
        await this.saveConfig();
    }

    public getPomodoroUseTaskColor(): boolean {
        return this.config.pomodoroUseTaskColor === true;
    }

    public async setShowCrossDayTasks(show: boolean) {
        this.config.showCrossDayTasks = show;
        await this.saveConfig();
    }

    public getShowCrossDayTasks(): boolean {
        return this.config.showCrossDayTasks;
    }

    public async setCrossDayThreshold(threshold: number) {
        this.config.crossDayThreshold = threshold;
        await this.saveConfig();
    }

    public getCrossDayThreshold(): number {
        return this.config.crossDayThreshold !== undefined ? this.config.crossDayThreshold : -1;
    }

    public async setShowSubtasks(show: boolean) {
        this.config.showSubtasks = show;
        await this.saveConfig();
    }

    public getShowSubtasks(): boolean {
        return this.config.showSubtasks;
    }

    public async setShowRepeatTasks(show: boolean) {
        this.config.showRepeatTasks = show;
        await this.saveConfig();
    }

    public getShowRepeatTasks(): boolean {
        return this.config.showRepeatTasks;
    }

    public async setRepeatInstanceLimit(limit: number) {
        this.config.repeatInstanceLimit = limit;
        await this.saveConfig();
    }

    public getRepeatInstanceLimit(): number {
        return this.config.repeatInstanceLimit !== undefined ? this.config.repeatInstanceLimit : -1;
    }

    public async setShowHiddenTasks(show: boolean) {
        this.config.showHiddenTasks = show;
        await this.saveConfig();
    }

    public getShowHiddenTasks(): boolean {
        return this.config.showHiddenTasks !== undefined ? this.config.showHiddenTasks : false;
    }

    public async setShowEventCheckbox(show: boolean) {
        this.config.showEventCheckbox = show;
        await this.saveConfig();
    }

    public getShowEventCheckbox(): boolean {
        return this.config.showEventCheckbox !== false;
    }

    public async setShowCompletedTaskTime(show: boolean) {
        this.config.showCompletedTaskTime = show;
        await this.saveConfig();
    }

    public getShowCompletedTaskTime(): boolean {
        return this.config.showCompletedTaskTime !== undefined ? this.config.showCompletedTaskTime : true;
    }

    public async setShowCompletedTaskTimeTimed(show: boolean) {
        this.config.showCompletedTaskTimeTimed = show;
        await this.saveConfig();
    }

    public getShowCompletedTaskTimeTimed(): boolean {
        return this.config.showCompletedTaskTimeTimed !== undefined ? this.config.showCompletedTaskTimeTimed : false;
    }

    public async setShowCompletedTaskTimeAllDay(show: boolean) {
        this.config.showCompletedTaskTimeAllDay = show;
        await this.saveConfig();
    }

    public getShowCompletedTaskTimeAllDay(): boolean {
        return this.config.showCompletedTaskTimeAllDay !== undefined ? this.config.showCompletedTaskTimeAllDay : true;
    }

    public async setShowCompletedTaskTimeNoDate(show: boolean) {
        this.config.showCompletedTaskTimeNoDate = show;
        await this.saveConfig();
    }

    public getShowCompletedTaskTimeNoDate(): boolean {
        return this.config.showCompletedTaskTimeNoDate !== undefined ? this.config.showCompletedTaskTimeNoDate : true;
    }

    public async setCompletedTaskTimeUseTaskColor(use: boolean) {
        this.config.completedTaskTimeUseTaskColor = use;
        await this.saveConfig();
    }

    public getCompletedTaskTimeUseTaskColor(): boolean {
        return this.config.completedTaskTimeUseTaskColor === true;
    }

    public async setMultiDaysCount(count: number) {
        this.config.multiDaysCount = count;
        await this.saveConfig();
    }

    public getMultiDaysCount(): number {
        return this.config.multiDaysCount !== undefined ? this.config.multiDaysCount : 3;
    }

    public async setShowTasks(show: boolean) {
        this.config.showTasks = show;
        await this.saveConfig();
    }

    public getShowTasks(): boolean {
        return this.config.showTasks !== false;
    }

    public async setShowHabits(show: boolean) {
        this.config.showHabits = show;
        await this.saveConfig();
    }

    public getShowHabits(): boolean {
        return this.config.showHabits !== false;
    }

    public getConfig(): CalendarConfig {
        return { ...this.config };
    }
}
