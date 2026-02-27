import { Plugin } from "siyuan";
import { getFile, removeFile } from "../api";

const CALENDAR_CONFIG_FILE = '/data/storage/petal/siyuan-plugin-task-note-management/calendar-config.json';

export interface CalendarConfig {
    colorBy: 'category' | 'priority' | 'project';
    viewMode: 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays' | 'dayGridMultiDays' | 'listMultiDays';
    viewType: 'timeline' | 'kanban' | 'list';
    showLunar: boolean;
    showPomodoro: boolean;
    completionFilter: 'all' | 'completed' | 'incomplete';
    showCrossDayTasks: boolean;
    crossDayThreshold: number;
    showSubtasks: boolean;
    showRepeatTasks: boolean;
    repeatInstanceLimit: number;
    showHiddenTasks: boolean; // 显示不在日历视图显示的任务
    showCompletedTaskTime: boolean; // 显示已完成任务时间
    showCompletedTaskTimeOnlyWithoutDate: boolean; // 只显示没有日期的任务的完成时间
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
            showLunar: true, // 默认显示农历
            showPomodoro: true, // 默认显示番茄专注时间
            completionFilter: 'all', // 默认显示全部状态
            showCrossDayTasks: true, // 默认显示跨天任务
            crossDayThreshold: -1, // 默认显示全部天数 (-1表示不限制)
            showSubtasks: true, // 默认显示子任务
            showRepeatTasks: true, // 默认显示重复任务
            repeatInstanceLimit: -1, // 默认显示全部实例 (-1表示不限制)
            showHiddenTasks: false, // 默认不显示隐藏任务
            showCompletedTaskTime: true, // 默认显示已完成任务时间
            showCompletedTaskTimeOnlyWithoutDate: false, // 默认显示所有已完成任务的时间
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
            settings.calendarShowLunar = this.config.showLunar;
            settings.calendarShowPomodoro = this.config.showPomodoro;
            settings.calendarCompletionFilter = this.config.completionFilter;
            settings.calendarShowCrossDayTasks = this.config.showCrossDayTasks;
            settings.calendarCrossDayThreshold = this.config.crossDayThreshold;
            settings.calendarShowSubtasks = this.config.showSubtasks;
            settings.calendarShowRepeatTasks = this.config.showRepeatTasks;
            settings.calendarRepeatInstanceLimit = this.config.repeatInstanceLimit;
            settings.calendarShowHiddenTasks = this.config.showHiddenTasks;
            settings.calendarShowCompletedTaskTime = this.config.showCompletedTaskTime;
            settings.calendarShowCompletedTaskTimeOnlyWithoutDate = this.config.showCompletedTaskTimeOnlyWithoutDate;
            settings.calendarMultiDaysCount = this.config.multiDaysCount;
            await (this.plugin as any).saveSettings(settings);
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
                colorBy: settings.calendarColorBy || 'priority',
                viewMode: viewMode as any,
                viewType: settings.calendarViewType || 'timeline',
                showLunar: settings.calendarShowLunar !== false, // 默认为 true
                showPomodoro: settings.calendarShowPomodoro !== false, // 默认为 true
                completionFilter: (settings.calendarCompletionFilter as any) || 'all',
                showCrossDayTasks: settings.calendarShowCrossDayTasks !== false, // 默认为 true
                crossDayThreshold: settings.calendarCrossDayThreshold !== undefined ? settings.calendarCrossDayThreshold : -1, // 默认为 -1
                showSubtasks: settings.calendarShowSubtasks !== false, // 默认为 true
                showRepeatTasks: settings.calendarShowRepeatTasks !== false, // 默认为 true
                repeatInstanceLimit: settings.calendarRepeatInstanceLimit !== undefined ? settings.calendarRepeatInstanceLimit : -1, // 默认为 -1
                showHiddenTasks: settings.calendarShowHiddenTasks === true, // 默认为 false
                showCompletedTaskTime: settings.calendarShowCompletedTaskTime !== false, // 默认为 true
                showCompletedTaskTimeOnlyWithoutDate: settings.calendarShowCompletedTaskTimeOnlyWithoutDate === true, // 默认为 false
                multiDaysCount: settings.calendarMultiDaysCount !== undefined ? settings.calendarMultiDaysCount : 3 // 默认为3天
            };
        } catch (error) {
            console.warn('Failed to load calendar config, using defaults:', error);
            this.config = {
                colorBy: 'priority',
                viewMode: 'timeGridWeek',
                viewType: 'timeline',
                showLunar: true,
                showPomodoro: true,
                completionFilter: 'all',
                showCrossDayTasks: true,
                crossDayThreshold: -1,
                showSubtasks: true,
                showRepeatTasks: true,
                repeatInstanceLimit: -1,
                showHiddenTasks: false,
                showCompletedTaskTime: true,
                showCompletedTaskTimeOnlyWithoutDate: false,
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

    public async setShowCompletedTaskTime(show: boolean) {
        this.config.showCompletedTaskTime = show;
        await this.saveConfig();
    }

    public getShowCompletedTaskTime(): boolean {
        return this.config.showCompletedTaskTime !== undefined ? this.config.showCompletedTaskTime : true;
    }

    public async setShowCompletedTaskTimeOnlyWithoutDate(show: boolean) {
        this.config.showCompletedTaskTimeOnlyWithoutDate = show;
        await this.saveConfig();
    }

    public getShowCompletedTaskTimeOnlyWithoutDate(): boolean {
        return this.config.showCompletedTaskTimeOnlyWithoutDate !== undefined ? this.config.showCompletedTaskTimeOnlyWithoutDate : false;
    }

    public async setMultiDaysCount(count: number) {
        this.config.multiDaysCount = count;
        await this.saveConfig();
    }

    public getMultiDaysCount(): number {
        return this.config.multiDaysCount !== undefined ? this.config.multiDaysCount : 3;
    }

    public getConfig(): CalendarConfig {
        return { ...this.config };
    }
}