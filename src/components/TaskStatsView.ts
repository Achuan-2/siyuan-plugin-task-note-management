import { Dialog } from "siyuan";
import { showMessage } from "siyuan";
import { confirm } from "siyuan";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { t } from "../utils/i18n";
import { compareDateStrings, getLocalDateString, getLogicalDateString, getDayStartMinutes } from "../utils/dateUtils";
import { readReminderData, readProjectData, getFile } from "../api";
import { generateRepeatInstances } from "../utils/repeatUtils";
import { setLastStatsMode } from "./PomodoroStatsView";
import { init, use, EChartsType } from 'echarts/core';
import { PieChart, HeatmapChart, CustomChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GridComponent, TitleComponent, LegendComponent, CalendarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
type TaskSession = {
    id: string;
    date: string;
    eventTitle: string;
    projectId?: string;
    categoryId?: string;
    startTime?: string;
    duration: number;
    completed: boolean;
    type: 'task';
};

// 注册 ECharts 组件
use([
    PieChart,
    HeatmapChart,
    CustomChart,
    TooltipComponent,
    VisualMapComponent,
    GridComponent,
    TitleComponent,
    LegendComponent,
    CalendarComponent,
    CanvasRenderer
]);

export class TaskStatsView {
    private dialog: Dialog;
    private reminderData: Record<string, any> = {};
    private isLoading = false;
    private isReady = false;
    private timeFormatter: PomodoroRecordManager;
    private currentView: 'overview' | 'details' | 'records' | 'trends' | 'timeline' | 'heatmap' = 'overview';
    private currentTimeRange: 'today' | 'week' | 'month' | 'year' = 'today';
    private currentYear: number = parseInt(getLogicalDateString().split('-')[0], 10);
    private currentWeekOffset: number = 0; // 周偏移量，0表示本周，-1表示上周，1表示下周
    private currentMonthOffset: number = 0; // 月偏移量，0表示本月，-1表示上月，1表示下月
    private currentYearOffset: number = 0; // 年偏移量，0表示今年，-1表示去年，1表示明年
    private currentDetailGroup: 'task' | 'project' | 'category' = 'task';
    private projectNameMap: Record<string, string> = {};
    private categoryNameMap: Record<string, string> = {};

    constructor() {
        this.timeFormatter = PomodoroRecordManager.getInstance();
        this.createDialog();
    }

    private createDialog() {
        this.dialog = new Dialog({
            title: "✅ " + (t("taskStats") || "任务统计"),
            content: this.createContent(),
            width: "90vw",
            height: "85vh",
            destroyCallback: () => {
                // 清理资源
            }
        });
    }

    private getLogicalTimelineStartMinutes(): number {
        return getDayStartMinutes();
    }

    private getTimelineStartPercent(startTime: Date): number {
        const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
        const dayStartMinutes = this.getLogicalTimelineStartMinutes();
        const adjustedMinutes = (startMinutes - dayStartMinutes + 1440) % 1440;
        return adjustedMinutes / (24 * 60) * 100;
    }

    private formatTimelineHour(valueHours: number): string {
        const totalMinutes = Math.round(valueHours * 60 + this.getLogicalTimelineStartMinutes());
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    private createContent(): string {
        return `
            <div class="pomodoro-stats-view">
                <div class="stats-switch">
                    <button class="stats-switch-btn active" data-mode="task">
                        ✅ ${t("taskStats")}
                    </button>
                    <button class="stats-switch-btn" data-mode="pomodoro">
                        🍅 ${t("pomodoroStats")}
                    </button>
                </div>
                <!-- 导航标签 -->
                <div class="stats-nav">
                    <button class="nav-btn ${this.currentView === 'overview' ? 'active' : ''}" data-view="overview">
                        📊 ${t("overview")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'details' ? 'active' : ''}" data-view="details">
                        📈 ${t("taskDetails")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'records' ? 'active' : ''}" data-view="records">
                        📝 ${t("taskRecords")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'trends' ? 'active' : ''}" data-view="trends">
                        📉 ${t("taskTrends")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'timeline' ? 'active' : ''}" data-view="timeline">
                        ⏰ ${t("taskTimeline")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'heatmap' ? 'active' : ''}" data-view="heatmap">
                        🔥 ${t("yearlyHeatmap")}
                    </button>
                </div>

                <!-- 内容区域 -->
                <div class="stats-content">
                    ${this.renderCurrentView()}
                </div>
            </div>
        `;
    }

    private renderCurrentView(): string {
        if (!this.isReady) {
            return `<div class="no-data">${t("loading")}</div>`;
        }
        switch (this.currentView) {
            case 'overview':
                return this.renderOverview();
            case 'details':
                return this.renderDetails();
            case 'records':
                return this.renderRecords();
            case 'trends':
                return this.renderTrends();
            case 'timeline':
                return this.renderTimeline();
            case 'heatmap':
                return this.renderHeatmap();
            default:
                return this.renderOverview();
        }
    }

    private renderOverview(): string {
        const todayTime = this.getTodayTaskTime();
        const weekTime = this.getWeekTaskTime();
        const totalTime = this.getTotalTaskTime();

        return `
            <div class="overview-container">
                <div class="overview-cards">
                    <div class="overview-card today">
                        <div class="card-icon">🌅</div>
                        <div class="card-content">
                            <div class="card-title">${t("todayTask")}</div>
                            <div class="card-value">${this.formatTime(todayTime)}</div>
                            <div class="card-subtitle">${this.getTodayTaskCount()}个任务</div>
                        </div>
                    </div>
                    
                    <div class="overview-card week">
                        <div class="card-icon">📅</div>
                        <div class="card-content">
                            <div class="card-title">${t("weekTask")}</div>
                            <div class="card-value">${this.formatTime(weekTime)}</div>
                            <div class="card-subtitle">${this.getWeekTaskCount()}个任务</div>
                        </div>
                    </div>
                    
                    <div class="overview-card total">
                        <div class="card-icon">🏆</div>
                        <div class="card-content">
                            <div class="card-title">${t("totalTask")}</div>
                            <div class="card-value">${this.formatTime(totalTime)}</div>
                            <div class="card-subtitle">${this.getTotalTaskCount()}个任务</div>
                        </div>
                    </div>
                </div>

                <!-- 今日任务进度 -->
                <div class="today-progress">
                    <h3>📈 ${t("todayTaskProgress")}</h3>
                    ${this.renderTodayProgress()}
                </div>

                <!-- 最近7天趋势 -->
                <div class="recent-trend">
                    <h3>📊 ${t("recentTaskTrend")}</h3>
                    ${this.renderRecentTrend()}
                </div>
            </div>
        `;
    }

    private renderDetails(): string {
        const dateRangeText = this.getCurrentDateRangeText();
        return `
            <div class="details-container">
                <div class="details-header">
                    <div class="details-title">
                        <h3>📈 ${t("taskDetails")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'today' ? 'active' : ''}" data-range="today">
                            ${t("today")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${t("week")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${t("month")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${t("year")}
                        </button>
                        <div class="nav-arrows">
                            <button class="nav-arrow" data-action="prev">◀</button>
                            <button class="nav-arrow" data-action="next">▶</button>
                        </div>
                    </div>
                    <div class="details-group-selector">
                        <button class="details-group-btn ${this.currentDetailGroup === 'task' ? 'active' : ''}" data-group="task">
                            ${t("taskGroupByTask")}
                        </button>
                        <button class="details-group-btn ${this.currentDetailGroup === 'project' ? 'active' : ''}" data-group="project">
                            ${t("taskGroupByProject")}
                        </button>
                        <button class="details-group-btn ${this.currentDetailGroup === 'category' ? 'active' : ''}" data-group="category">
                            ${t("taskGroupByCategory")}
                        </button>
                    </div>
                </div>
                
                <div class="details-content">
                    ${this.renderTaskCategoryChart()}
                </div>
            </div>
        `;
    }

    private renderRecords(): string {
        const recentSessions = this.getRecentSessions(7);

        return `
            <div class="records-container">
                <div class="records-header">
                    <h3>📝 ${t("taskRecords")}</h3>
                    <div class="records-subtitle">${t("recent7DaysTasks")}</div>
                </div>
                
                <div class="records-list">
                    ${recentSessions.map(session => this.renderSessionRecord(session)).join('')}
                </div>
            </div>
        `;
    }

    private renderTrends(): string {
        const dateRangeText = this.getCurrentDateRangeText();
        return `
            <div class="trends-container">
                <div class="trends-header">
                    <div class="trends-title">
                        <h3>📉 ${t("taskTrends")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${t("thisWeek")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${t("thisMonth")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${t("thisYear")}
                        </button>
                        <div class="nav-arrows">
                            <button class="nav-arrow" data-action="prev">◀</button>
                            <button class="nav-arrow" data-action="next">▶</button>
                        </div>
                    </div>
                </div>
                
                <div class="trends-chart">
                    ${this.renderTrendsChart()}
                </div>
            </div>
        `;
    }

    private renderTimeline(): string {
        const dateRangeText = this.getCurrentDateRangeText();
        return `
            <div class="timeline-container">
                <div class="timeline-header">
                    <div class="timeline-title">
                        <h3>⏰ ${t("taskTimeline")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${t("thisWeek")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${t("thisMonth")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${t("thisYear")}
                        </button>
                        <div class="nav-arrows">
                            <button class="nav-arrow" data-action="prev">◀</button>
                            <button class="nav-arrow" data-action="next">▶</button>
                        </div>
                    </div>
                </div>
                
                <div class="timeline-chart">
                    ${this.renderTimelineChart()}
                </div>
            </div>
        `;
    }

    private renderHeatmap(): string {
        return `
            <div class="heatmap-container">
                <div class="heatmap-header">
                    <h3>🔥 ${t("yearlyHeatmap")}</h3>
                    <div class="year-selector">
                        <button class="nav-arrow" data-action="prev-year">◀</button>
                        <span class="current-year">${this.currentYear}</span>
                        <button class="nav-arrow" data-action="next-year">▶</button>
                    </div>
                </div>
                
                <div class="heatmap-chart">
                    ${this.renderHeatmapChart()}
                </div>

            </div>
        `;
    }

    private renderTodayProgress(): string {
        const todayTime = this.getTodayTaskTime();
        const todayCount = this.getTodayTaskCount();

        return `
            <div class="progress-info">
                <div class="progress-item">
                    <span class="progress-label">${t("completedTasks")}</span>
                    <span class="progress-value">${todayCount}</span>
                </div>
                <div class="progress-item">
                    <span class="progress-label">${t("taskTime")}</span>
                    <span class="progress-value">${this.formatTime(todayTime)}</span>
                </div>
            </div>
        `;
    }

    private renderRecentTrend(): string {
        const last7Days = this.getLast7DaysData();
        const maxTime = Math.max(...last7Days.map(d => d.value));
        const minHeight = 3; // 最小高度15%，确保可见性
        const maxHeight = 85; // 最大高度85%，留出空间显示标签

        return `
            <div class="trend-chart">
                ${last7Days.map(day => {
            let height;
            if (maxTime === 0) {
                // 所有数据都为0时，显示最小高度
                height = minHeight;
            } else if (day.value === 0) {
                // 当前数据为0时，显示更小的高度以区分
                height = minHeight;
            } else {
                // 按比例计算高度，确保在最小和最大高度之间
                const ratio = day.value / maxTime;
                height = minHeight + (maxHeight - minHeight) * ratio;
            }

            return `
                        <div class="trend-day">
                            <div class="trend-bar" style="height: ${height}%"></div>
                            <div class="trend-label">${day.label}</div>
                            <div class="trend-value">${this.formatTime(day.value)}</div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    private renderTaskCategoryChart(): string {
        const stats = this.getTaskCategoryStats();
        const total = Object.values(stats).reduce((sum: number, value: any) => sum + value.time, 0);

        if (total === 0) {
            return `<div class="no-data">${t("noData")}</div>`;
        }

        // 生成唯一的图表ID
        const chartId = `pie-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        return `
            <div class="category-chart">
                <div id="${chartId}" class="echarts-pie-chart" style="width: 100%; height: 400px;"></div>
            </div>
        `;
    }

    private renderSessionRecord(session: TaskSession): string {
        const dateForDisplay = new Date(`${session.date}T00:00:00`);
        const dateStr = dateForDisplay.toLocaleDateString('zh-CN');
        const timeStr = session.startTime
            ? new Date(session.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : t("allDayReminder") || "\u5168\u5929";

        return `
            <div class="record-item task">
                <div class="record-icon">
                    ${session.completed ? '\u2705' : '\u274c'}
                </div>
                <div class="record-content">
                    <div class="record-title">${session.eventTitle}</div>
                    <div class="record-meta">
                        <span class="record-date">${dateStr}</span>
                        <span class="record-time">${timeStr}</span>
                        <span class="record-duration">${session.duration}${t("minutes")}</span>
                        ${session.completed ? '<span class=\"record-completed\">\u2705</span>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    private renderTrendsChart(): string {
        const data = this.getTrendsData();
        const maxValue = Math.max(...data.map(d => d.value));
        const minHeight = 3; // 最小高度15%，确保可见性
        const maxHeight = 85; // 最大高度85%，留出空间显示标签

        return `
            <div class="trends-chart-container">
                <div class="chart-bars">
                    ${data.map(item => {
            let height;
            if (maxValue === 0) {
                // 所有数据都为0时，显示0高度
                height = 0;
            } else if (item.value === 0) {
                // 当前数据为0时，不显示高度
                height = 0;
            } else {
                // 按比例计算高度，确保在最小和最大高度之间
                const ratio = item.value / maxValue;
                height = minHeight + (maxHeight - minHeight) * ratio;
            }

            return `
                            <div class="chart-bar-container">
                                <div class="chart-bar" style="height: ${height}%"></div>
                                <div class="chart-label">${item.label}</div>
                                <div class="chart-value">${this.formatTime(item.value)}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    private renderTimelineChart(): string {
        // 生成唯一的图表ID
        const chartId = `timeline-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        return `
            <div class="timeline-echarts-container">
                <div id="${chartId}" class="echarts-timeline-chart" style="width: 100%; height: 600px;"></div>
            </div>
        `;
    }

    private renderHeatmapChart(): string {
        // 生成唯一的图表ID
        const chartId = `heatmap-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        return `
            <div class="heatmap-echarts-container">
                <div id="${chartId}" class="echarts-heatmap-chart" style="width: 100%; height: 180px;"></div>
            </div>
        `;
    }

    // 数据获取方法
    private async ensureDataReady() {
        if (this.isReady || this.isLoading) {
            return;
        }
        this.isLoading = true;
        try {
            const [reminderData, projectData, categories] = await Promise.all([
                readReminderData(),
                readProjectData(),
                this.readCategoryData()
            ]);
            this.reminderData = reminderData;
            this.projectNameMap = {};
            Object.entries(projectData || {}).forEach(([projectId, project]: [string, any]) => {
                if (projectId.startsWith('_')) {
                    return;
                }
                const name = project?.title || project?.name;
                if (name) {
                    this.projectNameMap[projectId] = name;
                }
            });
            this.categoryNameMap = {};
            (categories || []).forEach((category: any) => {
                if (category?.id && category?.name) {
                    this.categoryNameMap[category.id] = category.name;
                }
            });
        } catch (error) {
            console.error('任务统计加载失败:', error);
            this.reminderData = {};
            this.projectNameMap = {};
            this.categoryNameMap = {};
        } finally {
            this.isLoading = false;
            this.isReady = true;
        }
    }

    private formatTime(minutes: number): string {
        return this.timeFormatter.formatTime(minutes);
    }

    private getTotalTaskTime(): number {
        let totalTime = 0;
        Object.values(this.reminderData || {}).forEach((reminder: any) => {
            const session = this.buildTaskSession(reminder, reminder?.id);
            if (session) {
                totalTime += session.duration;
            }
        });
        return totalTime;
    }

    private getTodayTaskTime(): number {
        const dateStr = getLogicalDateString();
        return this.getSessionsForRange(dateStr, dateStr).reduce((sum, s) => sum + s.duration, 0);
    }

    private getWeekTaskTime(): number {
        const range = this.getWeekRange(0);
        return this.getSessionsForRange(range.start, range.end).reduce((sum, s) => sum + s.duration, 0);
    }

    private getTodayTaskCount(): number {
        const dateStr = getLogicalDateString();
        return this.getSessionsForRange(dateStr, dateStr).length;
    }

    private getWeekTaskCount(): number {
        const range = this.getWeekRange(0);
        return this.getSessionsForRange(range.start, range.end).length;
    }

    private getTotalTaskCount(): number {
        return Object.values(this.reminderData || {}).filter((reminder: any) => reminder && reminder.date).length;
    }

    private getLast7DaysData(): Array<{ label: string, value: number }> {
        const data = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            const value = this.getSessionsForRange(dateStr, dateStr)
                .reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: i === 0 ? t("today") : date.toLocaleDateString('zh-CN', { weekday: 'short' }),
                value
            });
        }

        return data;
    }

    private getTaskCategoryStats(): Record<string, { time: number, count: number }> {
        let sessions: TaskSession[] = [];

        if (!this.isReady) {
            return {};
        }

        // 构造当前时间范围的任务记录
        switch (this.currentTimeRange) {
            case 'today':
                sessions = this.getTodaySessionsWithOffset();
                break;
            case 'week':
                sessions = this.getWeekSessionsWithOffset();
                break;
            case 'month':
                sessions = this.getMonthSessionsWithOffset();
                break;
            case 'year':
                sessions = this.getYearSessionsWithOffset();
                break;
            default:
                sessions = this.getSessionsForRange(getLogicalDateString(), getLogicalDateString());
        }

        const stats: Record<string, { time: number, count: number }> = {};

        sessions.forEach(session => {
            const label = this.getDetailGroupLabel(session);
            if (!stats[label]) {
                stats[label] = { time: 0, count: 0 };
            }
            stats[label].time += session.duration;
            if (session.completed) {
                stats[label].count++;
            }
        });

        return stats;
    }

    private getTodaySessionsWithOffset(): TaskSession[] {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + this.currentWeekOffset);
        const dateStr = getLocalDateString(targetDate);
        return this.getSessionsForRange(dateStr, dateStr);
    }

    private getWeekSessionsWithOffset(): TaskSession[] {
        const range = this.getWeekRange(this.currentWeekOffset);
        return this.getSessionsForRange(range.start, range.end);
    }

    private getMonthSessionsWithOffset(): TaskSession[] {
        const range = this.getMonthRange(this.currentMonthOffset);
        return this.getSessionsForRange(range.start, range.end);
    }

    private getYearSessionsWithOffset(): TaskSession[] {
        const range = this.getYearRange(this.currentYearOffset);
        return this.getSessionsForRange(range.start, range.end);
    }

    private getRecentSessions(days: number): TaskSession[] {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - (days - 1));
        const sessions = this.getSessionsForRange(getLocalDateString(startDate), getLocalDateString(today));

        return sessions.sort((a, b) => {
            const aTime = a.startTime ? new Date(a.startTime).getTime() : new Date(`${a.date}T00:00:00`).getTime();
            const bTime = b.startTime ? new Date(b.startTime).getTime() : new Date(`${b.date}T00:00:00`).getTime();
            return bTime - aTime;
        });
    }

    private getTrendsData(): Array<{ label: string, value: number }> {
        switch (this.currentTimeRange) {
            case 'week':
                return this.getWeeklyTrendsData();
            case 'month':
                return this.getMonthlyTrendsData();
            case 'year':
                return this.getYearlyTrendsData();
            default:
                return this.getWeeklyTrendsData();
        }
    }

    private getWeeklyTrendsData(): Array<{ label: string, value: number }> {
        const data = [];
        const range = this.getWeekRange(this.currentWeekOffset);
        const start = new Date(range.start + 'T00:00:00');

        for (let i = 0; i < 7; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            const dateStr = getLocalDateString(date);
            const value = this.getSessionsForRange(dateStr, dateStr)
                .reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: date.toLocaleDateString('zh-CN', { weekday: 'short' }),
                value
            });
        }

        return data;
    }

    private getMonthlyTrendsData(): Array<{ label: string, value: number }> {
        const data = [];
        const range = this.getMonthRange(this.currentMonthOffset);
        const startDate = new Date(range.start + 'T00:00:00');
        const endDate = new Date(range.end + 'T00:00:00');
        const daysInMonth = endDate.getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(startDate.getFullYear(), startDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const time = this.getSessionsForRange(dateStr, dateStr)
                .reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: day.toString(),
                value: time
            });
        }

        return data;
    }

    private getYearlyTrendsData(): Array<{ label: string, value: number }> {
        const data = [];
        const months = ['1\u6708', '2\u6708', '3\u6708', '4\u6708', '5\u6708', '6\u6708', '7\u6708', '8\u6708', '9\u6708', '10\u6708', '11\u6708', '12\u6708'];
        const range = this.getYearRange(this.currentYearOffset);
        const year = parseInt(range.start.split('-')[0], 10);

        months.forEach((month, index) => {
            let monthlyTime = 0;
            const daysInMonth = new Date(year, index + 1, 0).getDate();

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, index, day);
                const dateStr = getLocalDateString(date);
                monthlyTime += this.getSessionsForRange(dateStr, dateStr)
                    .reduce((sum, s) => sum + s.duration, 0);
            }

            data.push({
                label: month,
                value: monthlyTime
            });
        });

        return data;
    }

    private getTimelineData(): Array<{ date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> }> {
        const data = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        switch (this.currentTimeRange) {
            case 'week':
                const weekRange = this.getWeekRange(this.currentWeekOffset);
                const startOfWeek = new Date(weekRange.start + 'T00:00:00');
                for (let i = 0; i < 7; i++) {
                    const date = new Date(startOfWeek);
                    date.setDate(startOfWeek.getDate() + i);
                    data.push(this.getTimelineDataForDate(date));
                }
                break;

            case 'month':
                data.push(this.getAverageTimelineDataForMonth());
                break;

            case 'year':
                data.push(this.getAverageTimelineDataForYear());
                break;

            default:
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(today.getDate() - i);
                    data.push(this.getTimelineDataForDate(date));
                }
        }

        return data;
    }

    private getTimelineDataForDate(date: Date): { date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> } {
        const dateStr = getLocalDateString(date);
        const sessions = this.getSessionsForRange(dateStr, dateStr).filter(s => s.startTime);

        const timelineSessions = sessions.map(session => {
            const startTime = new Date(session.startTime as string);
            const startPercent = this.getTimelineStartPercent(startTime);
            const widthPercent = session.duration / (24 * 60) * 100;

            return {
                type: session.type,
                title: session.eventTitle,
                duration: session.duration,
                startPercent,
                widthPercent
            };
        });

        return {
            date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
            sessions: timelineSessions
        };
    }

    private getAverageTimelineDataForMonth(): { date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> } {
        const range = this.getMonthRange(this.currentMonthOffset);
        const targetDate = new Date(range.start + 'T00:00:00');
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        const hourlyStats = new Array(24).fill(0);
        let totalDays = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const sessions = this.getSessionsForRange(dateStr, dateStr).filter(s => s.startTime);

            let hasData = false;
            sessions.forEach(session => {
                hasData = true;
                const startTime = new Date(session.startTime as string);
                const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
                const dayStartMinutes = this.getLogicalTimelineStartMinutes();
                const adjustedStartMinutes = (startMinutes - dayStartMinutes + 1440) % 1440;
                const duration = session.duration;

                let remainingDuration = duration;
                let currentHour = Math.floor(adjustedStartMinutes / 60);
                let currentMinute = adjustedStartMinutes % 60;
                let minutesCovered = 0;

                while (remainingDuration > 0 && minutesCovered < 24 * 60) {
                    const minutesLeftInHour = 60 - currentMinute;
                    const durationInThisHour = Math.min(remainingDuration, minutesLeftInHour);

                    hourlyStats[currentHour] += durationInThisHour;
                    remainingDuration -= durationInThisHour;
                    minutesCovered += durationInThisHour;

                    currentHour = (currentHour + 1) % 24;
                    currentMinute = 0;
                }
            });

            if (hasData) {
                totalDays++;
            }
        }

        const sessions = [];
        if (totalDays > 0) {
            for (let hour = 0; hour < 24; hour++) {
                const avgDuration = hourlyStats[hour] / totalDays;
                if (avgDuration > 1) {
                    const startPercent = (hour * 60) / (24 * 60) * 100;
                    const widthPercent = 60 / (24 * 60) * 100;

                    sessions.push({
                        type: 'task',
                        title: `${hour}:00-${hour + 1}:00 平均任务 ${avgDuration.toFixed(1)}分钟`,
                        duration: Math.round(avgDuration),
                        startPercent,
                        widthPercent
                    });
                }
            }
        }

        const monthName = targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
        return {
            date: `${monthName}平均分布`,
            sessions
        };
    }

    private getAverageTimelineDataForYear(): { date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> } {
        const range = this.getYearRange(this.currentYearOffset);
        const year = parseInt(range.start.split('-')[0], 10);

        const hourlyStats = new Array(24).fill(0);
        let totalDays = 0;

        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = getLocalDateString(date);
                const sessions = this.getSessionsForRange(dateStr, dateStr).filter(s => s.startTime);

                let hasData = false;
                sessions.forEach(session => {
                    hasData = true;
                    const startTime = new Date(session.startTime as string);
                const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
                const dayStartMinutes = this.getLogicalTimelineStartMinutes();
                const adjustedStartMinutes = (startMinutes - dayStartMinutes + 1440) % 1440;
                const duration = session.duration;

                let remainingDuration = duration;
                let currentHour = Math.floor(adjustedStartMinutes / 60);
                let currentMinute = adjustedStartMinutes % 60;
                let minutesCovered = 0;

                while (remainingDuration > 0 && minutesCovered < 24 * 60) {
                    const minutesLeftInHour = 60 - currentMinute;
                    const durationInThisHour = Math.min(remainingDuration, minutesLeftInHour);

                    hourlyStats[currentHour] += durationInThisHour;
                    remainingDuration -= durationInThisHour;
                    minutesCovered += durationInThisHour;

                    currentHour = (currentHour + 1) % 24;
                    currentMinute = 0;
                }
                });

                if (hasData) {
                    totalDays++;
                }
            }
        }

        const sessions = [];
        if (totalDays > 0) {
            for (let hour = 0; hour < 24; hour++) {
                const avgDuration = hourlyStats[hour] / totalDays;
                if (avgDuration > 1) {
                    const startPercent = (hour * 60) / (24 * 60) * 100;
                    const widthPercent = 60 / (24 * 60) * 100;

                    sessions.push({
                        type: 'task',
                        title: `${hour}:00-${hour + 1}:00 平均任务 ${avgDuration.toFixed(1)}分钟`,
                        duration: Math.round(avgDuration),
                        startPercent,
                        widthPercent
                    });
                }
            }
        }

        return {
            date: `${year}年平均分布`,
            sessions
        };
    }

    private getHeatmapData(year: number): Array<{ date: string, time: number, level: number }> {
        const data = [];
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31);

        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
            const dateStr = getLocalDateString(date);
            const time = this.getSessionsForRange(dateStr, dateStr)
                .reduce((sum, s) => sum + s.duration, 0);

            let level = 0;
            if (time > 0) level = 1;
            if (time > 60) level = 2;
            if (time > 120) level = 3;
            if (time > 240) level = 4;

            data.push({
                date: dateStr,
                time,
                level
            });
        }

        return data;
    }

    private buildTaskSession(reminder: any, sessionId: string): TaskSession | null {
        if (!reminder || !reminder.date) {
            return null;
        }
        const timing = this.getTaskTiming(reminder);
        const sessionDate = timing.startTime ? getLogicalDateString(timing.startTime) : reminder.date;
        return {
            id: sessionId,
            date: sessionDate,
            eventTitle: reminder.title || t("unnamedNote"),
            projectId: reminder.projectId || undefined,
            categoryId: reminder.categoryId || undefined,
            startTime: timing.startTime ? timing.startTime.toISOString() : undefined,
            duration: timing.duration,
            completed: !!reminder.completed,
            type: 'task'
        };
    }

    private async readCategoryData(): Promise<any[]> {
        try {
            const content = await getFile('data/storage/petal/siyuan-plugin-task-note-management/categories.json');
            if (!content || content?.code === 404) {
                return [];
            }
            const data = typeof content === 'string' ? JSON.parse(content) : content;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.warn('读取分类数据失败:', error);
            return [];
        }
    }

    private getDetailGroupLabel(session: TaskSession): string {
        switch (this.currentDetailGroup) {
            case 'project': {
                const projectName = session.projectId ? this.projectNameMap[session.projectId] : '';
                return projectName || t("uncategorizedProject");
            }
            case 'category': {
                const categoryName = session.categoryId ? this.categoryNameMap[session.categoryId] : '';
                return categoryName || t("uncategorizedCategory");
            }
            default:
                return session.eventTitle || t("uncategorized");
        }
    }

    private getTaskTiming(reminder: any): { startTime?: Date; duration: number } {
        if (!reminder?.date || !reminder?.time) {
            return { duration: 0 };
        }

        const startTime = new Date(`${reminder.date}T${reminder.time}:00`);
        let endTime: Date | null = null;

        if (reminder.endDate && reminder.endTime) {
            endTime = new Date(`${reminder.endDate}T${reminder.endTime}:00`);
        } else if (reminder.endTime) {
            endTime = new Date(`${reminder.date}T${reminder.endTime}:00`);
        } else {
            endTime = new Date(startTime);
            endTime.setMinutes(endTime.getMinutes() + 30);
            if (endTime.getDate() !== startTime.getDate()) {
                endTime.setDate(startTime.getDate());
                endTime.setHours(23, 59, 0, 0);
            }
        }

        const duration = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 60000));
        return { startTime, duration };
    }

    private isDateInRange(date: string, startDate: string, endDate: string): boolean {
        return compareDateStrings(date, startDate) >= 0 && compareDateStrings(date, endDate) <= 0;
    }

    private getSessionsForRange(startDate: string, endDate: string): TaskSession[] {
        const sessions: TaskSession[] = [];
        const reminders = Object.values(this.reminderData || {}) as any[];

        reminders.forEach((reminder) => {
            if (!reminder || typeof reminder !== 'object') {
                return;
            }
            const baseSession = this.buildTaskSession(reminder, reminder.id);
            if (baseSession && this.isDateInRange(baseSession.date, startDate, endDate)) {
                sessions.push(baseSession);
            }

            if (reminder.repeat?.enabled) {
                const instances = generateRepeatInstances(reminder, startDate, endDate);
                instances.forEach(instance => {
                    if (instance.date === reminder.date) {
                        return;
                    }
                    const instanceReminder = {
                        ...reminder,
                        date: instance.date,
                        time: instance.time,
                        endDate: instance.endDate,
                        endTime: instance.endTime,
                        completed: instance.completed ?? reminder.completed
                    };
                    const session = this.buildTaskSession(instanceReminder, instance.instanceId);
                    if (session) {
                        sessions.push(session);
                    }
                });
            }
        });

        return sessions;
    }

    private getWeekRange(weekOffset: number): { start: string; end: string } {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const startOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(today.getDate() + mondayOffset + (weekOffset * 7));
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        return {
            start: getLocalDateString(startOfWeek),
            end: getLocalDateString(endOfWeek)
        };
    }

    private getMonthRange(monthOffset: number): { start: string; end: string } {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const targetDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
        const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);

        return {
            start: getLocalDateString(targetDate),
            end: getLocalDateString(endDate)
        };
    }

    private getYearRange(yearOffset: number): { start: string; end: string } {
        const year = parseInt(getLogicalDateString().split('-')[0], 10) + yearOffset;
        return {
            start: `${year}-01-01`,
            end: `${year}-12-31`
        };
    }
    private getEventColor(index: number): string {
        const colors = ['#FF6B6B', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', '#795548', '#607D8B'];
        return colors[index % colors.length];
    }

    private getCurrentDateRangeText(): string {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        switch (this.currentTimeRange) {
            case 'today':
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
                return `${targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}（逻辑日）`;

            case 'week':
                const startOfWeek = new Date(today);
                const dayOfWeek = today.getDay();
                // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);

                return `${startOfWeek.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}（逻辑日）`;

            case 'month':
                const targetMonth = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
                return `${targetMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}（逻辑日）`;

            case 'year':
                const targetYear = today.getFullYear() + this.currentYearOffset;
                return `${targetYear}年`;

            default:
                return '';
        }
    }

    public async show() {
        setLastStatsMode('task');
        this.dialog.element.addEventListener('click', this.handleClick.bind(this));
        await this.ensureDataReady();
        this.updateContent();
    }

    private initPieChart(chartId: string) {
        // 延迟执行以确保DOM元素已渲染
        setTimeout(() => {
            const chartElement = this.dialog.element.querySelector(`#${chartId}`) as HTMLElement;
            if (!chartElement) {
                console.warn('Chart element not found:', chartId);
                return;
            }

            const stats = this.getTaskCategoryStats();
            const total = Object.values(stats).reduce((sum: number, value: any) => sum + value.time, 0);

            if (total === 0) return;

            // 初始化echarts实例
            const chart = init(chartElement);

            // 准备数据
            const data = Object.entries(stats).map(([category, data]: [string, any], index) => ({
                name: category,
                value: data.time,
                count: data.count,
                itemStyle: {
                    color: this.getTaskColor(index)
                }
            }));

            // 配置选项
            const option = {
                title: {
                    text: '',
                    left: 'center',
                    top: 20,
                    textStyle: {
                        fontSize: 16,
                        fontWeight: 'bold'
                    }
                },
                tooltip: {
                    trigger: 'item',
                    formatter: (params: any) => {
                        const percentage = ((params.value / total) * 100).toFixed(1);
                        const timeStr = this.formatTime(params.value);
                        const countStr = data.find(d => d.name === params.name)?.count || 0;
                        return `
                            <div style="padding: 8px;">
                                <div style="margin-bottom: 4px;">
                                    <span style="display: inline-block; width: 10px; height: 10px; background-color: ${params.color}; border-radius: 50%; margin-right: 8px;"></span>
                                    <strong>${params.name}</strong>
                                </div>
                                <div style="margin-bottom: 2px;">任务时间: ${timeStr}</div>
                                <div style="margin-bottom: 2px;">完成任务: ${countStr}个</div>
                                <div>占比: ${percentage}%</div>
                            </div>
                        `;
                    }
                },
                legend: {
                    orient: 'horizontal',
                    show: false,
                    left: 'center',
                    bottom: '5%',
                    formatter: (name: string) => {
                        const item = data.find(d => d.name === name);
                        if (item) {
                            const timeStr = this.formatTime(item.value);
                            return `${name} (${timeStr})`;
                        }
                        return name;
                    }
                },
                series: [
                    {
                        name: t("taskTime"),
                        type: 'pie',
                        radius: ['40%', '70%'],
                        center: ['50%', '45%'],
                        avoidLabelOverlap: false,
                        label: {
                            show: true,
                            position: 'outside',
                            formatter: (params: any) => {
                                const percentage = ((params.value / total) * 100).toFixed(1);
                                return `${params.name}\n${percentage}%`;
                            }
                        },
                        emphasis: {
                            label: {
                                show: true,
                                fontSize: 14,
                                fontWeight: 'bold'
                            },
                            itemStyle: {
                                shadowBlur: 10,
                                shadowOffsetX: 0,
                                shadowColor: 'rgba(0, 0, 0, 0.5)'
                            }
                        },
                        labelLine: {
                            show: true
                        },
                        data: data
                    }
                ]
            };

            // 设置配置项并渲染图表
            chart.setOption(option);

            // 响应式调整
            const resizeObserver = new ResizeObserver(() => {
                if (chart && !chart.isDisposed()) {
                    chart.resize();
                }
            });
            resizeObserver.observe(chartElement);

            // 存储chart实例以便后续清理
            (chartElement as any).__echartsInstance = chart;
            (chartElement as any).__resizeObserver = resizeObserver;
        }, 100);
    }

    private initHeatmapChart(chartId: string) {
        // 延迟执行以确保DOM元素已渲染
        setTimeout(() => {
            const chartElement = this.dialog.element.querySelector(`#${chartId}`) as HTMLElement;
            if (!chartElement) {
                console.warn('Heatmap chart element not found:', chartId);
                return;
            }

            const heatmapData = this.getHeatmapData(this.currentYear);

            if (heatmapData.length === 0) {
                chartElement.innerHTML = `<div class="no-data" style="text-align: center; padding: 50px;">${t("noData")}</div>`;
                return;
            }

            // 初始化echarts实例
            const chart = init(chartElement);

            // 准备热力图数据
            const startDate = new Date(this.currentYear, 0, 1);
            const endDate = new Date(this.currentYear, 11, 31);

            // 计算一年中的所有日期
            const dateList = [];
            const dataList = [];

            for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
                const localDateStr = getLocalDateString(date);

                // 查找对应的数据
                const dayData = heatmapData.find(d => d.date === localDateStr);
                const time = dayData ? dayData.time : 0;

                dateList.push(localDateStr);
                dataList.push([localDateStr, time]);
            }

            // 计算最大值用于颜色映射
            const maxValue = Math.max(...dataList.map(d => d[1] as number));

            // 配置选项 - GitHub风格热力图
            const option = {
                title: {
                    text: `${this.currentYear}年任务时间热力图`,
                    left: 'center',
                    top: 10,
                    textStyle: {
                        fontSize: 16,
                        fontWeight: 'bold'
                    }
                },
                tooltip: {
                    trigger: 'item',
                    formatter: (params: any) => {
                        const date = new Date(params.data[0]);
                        const dateStr = date.toLocaleDateString('zh-CN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                        const time = params.data[1];
                        if (time === 0) {
                            return `${dateStr}<br/>无任务记录`;
                        }
                        const timeStr = this.formatTime(time);
                        return `${dateStr}<br/>任务时间: ${timeStr}`;
                    }
                },
                visualMap: {
                    min: 0,
                    max: maxValue || 240,
                    calculable: false,
                    hoverLink: false,
                    orient: 'horizontal',
                    left: 'center',
                    bottom: 10,
                    itemWidth: 13,
                    itemHeight: 80,
                    inRange: {
                        color: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
                    },
                    text: [t("more"), t("less")],
                    textStyle: {
                        fontSize: 12
                    }
                },
                calendar: {
                    top: 50,
                    left: 40,
                    right: 20,
                    bottom: 60,
                    cellSize: 13,
                    range: this.currentYear,
                    itemStyle: {
                        borderWidth: 2,
                        borderColor: 'transparent',
                        borderRadius: 2
                    },
                    yearLabel: { show: false },
                    monthLabel: {
                        nameMap: 'ZH',
                        fontSize: 11
                    },
                    dayLabel: {
                        firstDay: 1,
                        nameMap: 'ZH',
                        fontSize: 10
                    },
                    splitLine: {
                        show: false
                    }
                },
                series: [{
                    type: 'heatmap',
                    coordinateSystem: 'calendar',
                    data: dataList,
                    itemStyle: {
                        borderRadius: 2
                    }
                }]
            };

            // 设置配置项并渲染图表
            chart.setOption(option);

            // 响应式调整
            const resizeObserver = new ResizeObserver(() => {
                if (chart && !chart.isDisposed()) {
                    chart.resize();
                }
            });
            resizeObserver.observe(chartElement);

            // 存储chart实例以便后续清理
            (chartElement as any).__echartsInstance = chart;
            (chartElement as any).__resizeObserver = resizeObserver;
        }, 100);
    }

    private initTimelineChart(chartId: string) {
        // 延迟执行以确保DOM元素已渲染
        setTimeout(() => {
            const chartElement = this.dialog.element.querySelector(`#${chartId}`) as HTMLElement;
            if (!chartElement) {
                console.warn('Timeline chart element not found:', chartId);
                return;
            }

            const timelineData = this.getTimelineData();

            if (timelineData.length === 0) {
                chartElement.innerHTML = `<div class="no-data" style="text-align: center; padding: 50px;">${t("noData")}</div>`;
                return;
            }

            // 初始化echarts实例
            const chart = init(chartElement);

            // 准备时间线数据
            const dates = timelineData.map(d => d.date);
            const series = [];

            // 检查是否是平均分布数据（只有一行数据且包含"平均分布"）
            const isAverageData = timelineData.length === 1 && timelineData[0].date.includes('平均分布');

            if (isAverageData) {
                // 平均分布数据的处理
                const dayData = timelineData[0];
                const data = [];

                dayData.sessions.forEach(session => {
                    const startHour = session.startPercent / 100 * 24;
                    const endHour = startHour + (session.widthPercent / 100 * 24);
                    const avgDuration = session.duration;

                    data.push([
                        startHour,  // x轴：开始时间
                        0,          // y轴：固定为0（只有一行）
                        endHour,    // 结束时间
                        session.title,
                        avgDuration
                    ]);
                });

                if (data.length > 0) {
                    series.push({
                        name: '平均任务时间',
                        type: 'custom',
                        renderItem: (params, api) => {
                            const start = api.value(0);
                            const end = api.value(2);
                            const duration = api.value(4);
                            const y = api.coord([0, 0])[1];
                            const startX = api.coord([start, 0])[0];
                            const endX = api.coord([end, 0])[0];

                            // 根据平均任务时长调整颜色深度和高度
                            const maxDuration = Math.max(...data.map(d => d[4]));
                            const intensity = duration / maxDuration;
                            const height = 30 + intensity * 20; // 基础高度30px，最大增加20px
                            const opacity = 0.6 + intensity * 0.4; // 透明度从0.6到1.0

                            return {
                                type: 'rect',
                                shape: {
                                    x: startX,
                                    y: y - height / 2,
                                    width: Math.max(endX - startX, 2), // 最小宽度2px
                                    height: height
                                },
                                style: {
                                    fill: '#FF6B6B',
                                    opacity: opacity
                                }
                            };
                        },
                        data: data,
                        tooltip: {
                            formatter: (params) => {
                                const duration = params.value[4];
                                const title = params.value[3];
                                const startTime = this.formatTimelineHour(params.value[0]);

return `${title}<br/>时间段: ${startTime}<br/>平均时长: ${duration}分钟`;
                            }
                        }
                    });
                }
            } else {
                // 原有的多天数据处理逻辑
                const sessionTypes = ['task'];
                const typeNames = {
                    'task': '\u4efb\u52a1\u65f6\u95f4'
                };
                const typeColors = {
                    'task': '#4CAF50'
                };

                sessionTypes.forEach(type => {
                    const data = [];

                    timelineData.forEach((dayData, dayIndex) => {
                        dayData.sessions.forEach(session => {
                            if (session.type === type) {
                                // 计算开始时间和结束时间（以小时为单位）
                                const startHour = session.startPercent / 100 * 24;
                                const endHour = startHour + (session.widthPercent / 100 * 24);

                                data.push([
                                    startHour,  // x轴：开始时间
                                    dayIndex,   // y轴：日期索引
                                    endHour,    // 结束时间
                                    session.title,
                                    session.duration
                                ]);
                            }
                        });
                    });

                    if (data.length > 0) {
                        series.push({
                            name: typeNames[type],
                            type: 'custom',
                            renderItem: (params, api) => {
                                const start = api.value(0);
                                const end = api.value(2);
                                const y = api.coord([0, api.value(1)])[1];
                                const startX = api.coord([start, 0])[0];
                                const endX = api.coord([end, 0])[0];
                                const height = 20;

                                return {
                                    type: 'rect',
                                    shape: {
                                        x: startX,
                                        y: y - height / 2,
                                        width: endX - startX,
                                        height: height
                                    },
                                    style: {
                                        fill: typeColors[type],
                                        opacity: 0.8
                                    }
                                };
                            },
                            data: data,
                            tooltip: {
                                formatter: (params) => {
                                    const duration = params.value[4];
                                    const title = params.value[3];
                                    const startTime = this.formatTimelineHour(params.value[0]);

return `${title}<br/>开始时间: ${startTime}<br/>持续时间: ${duration}分钟`;
                                }
                            }
                        });
                    }
                });
            }

            // 配置选项
            const chartTitle = isAverageData ?
                (timelineData[0].date.includes('\u6708') ? '\u6708\u5ea6\u5e73\u5747\u4efb\u52a1\u65f6\u95f4\u5206\u5e03' : '\u5e74\u5ea6\u5e73\u5747\u4efb\u52a1\u65f6\u95f4\u5206\u5e03') :
                '任务时间线';

            const option = {
                title: {
                    text: chartTitle,
                    left: 'center',
                    top: 10,
                    textStyle: {
                        fontSize: 16,
                        fontWeight: 'bold'
                    }
                },
                tooltip: {
                    trigger: 'item'
                },

                grid: {
                    left: 80,
                    right: 50,
                    top: 80,
                    bottom: 50
                },
                xAxis: {
                    type: 'value',
                    min: 0,
                    max: 24,
                    interval: 2,
                    axisLabel: {
                          formatter: (value) => {
                              return this.formatTimelineHour(value);
                          }
                      },
                    name: '时间',
                    nameLocation: 'middle',
                    nameGap: 30
                },
                yAxis: {
                    type: 'category',
                    data: isAverageData ? [timelineData[0].date.replace('平均分布', '')] : dates,
                    name: '',
                    nameLocation: 'middle',
                    nameGap: 50,
                    axisLabel: {
                        interval: 0
                    },
                    axisTick: {
                        length: 0  // 去除Y轴的ticklength
                    }
                },
                series: series
            };

            // 设置配置项并渲染图表
            chart.setOption(option);

            // 响应式调整
            const resizeObserver = new ResizeObserver(() => {
                if (chart && !chart.isDisposed()) {
                    chart.resize();
                }
            });
            resizeObserver.observe(chartElement);

            // 存储chart实例以便后续清理
            (chartElement as any).__echartsInstance = chart;
            (chartElement as any).__resizeObserver = resizeObserver;
        }, 100);
    }

    private getTaskColor(index: number): string {
        const colors = [
            '#FF6B6B', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
            '#00BCD4', '#795548', '#607D8B', '#E91E63', '#3F51B5',
            '#009688', '#8BC34A', '#CDDC39', '#FFC107', '#FF5722'
        ];
        return colors[index % colors.length];
    }

    private handleClick(event: Event) {
        const target = event.target as HTMLElement;

        if (target.classList.contains('stats-switch-btn')) {
            const mode = target.dataset.mode;
            if (mode === 'pomodoro') {
                setLastStatsMode('pomodoro');
                this.dialog.destroy();
                import("./PomodoroStatsView").then(({ PomodoroStatsView }) => {
                    const statsView = new PomodoroStatsView();
                    statsView.show();
                });
            }
            return;
        }

        if (target.classList.contains('details-group-btn')) {
            const group = target.dataset.group as any;
            if (group && group !== this.currentDetailGroup) {
                this.currentDetailGroup = group;
                this.updateContent();
            }
            return;
        }

        if (target.classList.contains('nav-btn')) {
            const view = target.dataset.view as any;
            if (view && view !== this.currentView) {
                this.currentView = view;

                // 当切换到任务趋势或任务时间线Tab时，默认设置为本周并重置偏移量
                if (view === 'trends' || view === 'timeline') {
                    this.currentTimeRange = 'week';
                    this.currentWeekOffset = 0;
                    this.currentMonthOffset = 0;
                    this.currentYearOffset = 0;
                }

                this.updateContent();
            }
        }

        if (target.classList.contains('range-btn')) {
            const range = target.dataset.range as any;
            if (range) {
                this.currentTimeRange = range;
                // 重置偏移量到当前时间段
                this.currentWeekOffset = 0;
                this.currentMonthOffset = 0;
                this.currentYearOffset = 0;
                this.updateContent();
            }
        }

        if (target.classList.contains('nav-arrow')) {
            const action = target.dataset.action;
            this.handleNavigation(action);
        }

        if (target.classList.contains('delete-btn')) {
            const sessionId = target.dataset.sessionId;
            if (sessionId) {
                this.handleDeleteSession(sessionId);
            }
        }
    }

    private async handleDeleteSession(_sessionId: string) {
        showMessage(t("taskStatsDeleteUnsupported") || "任务统计暂不支持删除记录", 3000, "error");
    }

    private showDeleteConfirmation(): Promise<boolean> {
        return new Promise((resolve) => {
            confirm(
                "删除番茄记录",
                "确定要删除此记录吗？此操作无法撤销",
                () => {
                    resolve(true);
                },
                () => {
                    resolve(false);
                }
            );
        });
    }

    private handleNavigation(action: string) {
        switch (action) {
            case 'prev-year':
                this.currentYear--;
                this.updateContent();
                break;
            case 'next-year':
                this.currentYear++;
                this.updateContent();
                break;
            case 'prev':
                this.navigatePrevious();
                break;
            case 'next':
                this.navigateNext();
                break;
        }
    }

    private navigatePrevious() {
        switch (this.currentTimeRange) {
            case 'today':
                this.currentWeekOffset--; // 复用weekOffset作为日偏移
                break;
            case 'week':
                this.currentWeekOffset--;
                break;
            case 'month':
                this.currentMonthOffset--;
                break;
            case 'year':
                this.currentYearOffset--;
                break;
        }
        this.updateContent();
    }

    private navigateNext() {
        switch (this.currentTimeRange) {
            case 'today':
                this.currentWeekOffset++; // 复用weekOffset作为日偏移
                break;
            case 'week':
                this.currentWeekOffset++;
                break;
            case 'month':
                this.currentMonthOffset++;
                break;
            case 'year':
                this.currentYearOffset++;
                break;
        }
        this.updateContent();
    }

    private updateContent() {
        // 清理之前的echarts实例
        this.cleanupCharts();

        const contentElement = this.dialog.element.querySelector('.stats-content');
        if (contentElement) {
            contentElement.innerHTML = this.renderCurrentView();
        }

        // 更新导航按钮状态
        this.dialog.element.querySelectorAll('.nav-btn').forEach(btn => {
            const element = btn as HTMLElement;
            element.classList.toggle('active', element.dataset.view === this.currentView);
        });

        // 更新时间范围按钮状态
        this.dialog.element.querySelectorAll('.range-btn').forEach(btn => {
            const element = btn as HTMLElement;
            element.classList.toggle('active', element.dataset.range === this.currentTimeRange);
        });

        // 更新详情分组按钮状态
        this.dialog.element.querySelectorAll('.details-group-btn').forEach(btn => {
            const element = btn as HTMLElement;
            element.classList.toggle('active', element.dataset.group === this.currentDetailGroup);
        });

        // 如果当前是详情视图，初始化饼图
        if (this.currentView === 'details') {
            const chartElement = this.dialog.element.querySelector('.echarts-pie-chart') as HTMLElement;
            if (chartElement) {
                this.initPieChart(chartElement.id);
            }
        }

        // 如果当前是热力图视图，初始化热力图
        if (this.currentView === 'heatmap') {
            const heatmapElement = this.dialog.element.querySelector('.echarts-heatmap-chart') as HTMLElement;
            if (heatmapElement) {
                this.initHeatmapChart(heatmapElement.id);
            }
        }

        // 如果当前是时间线视图，初始化时间线图表
        if (this.currentView === 'timeline') {
            const timelineElement = this.dialog.element.querySelector('.echarts-timeline-chart') as HTMLElement;
            if (timelineElement) {
                this.initTimelineChart(timelineElement.id);
            }
        }
    }

    private cleanupCharts() {
        // 清理所有echarts实例
        this.dialog.element.querySelectorAll('.echarts-pie-chart, .echarts-heatmap-chart, .echarts-timeline-chart').forEach(element => {
            const chartElement = element as any;
            if (chartElement.__echartsInstance) {
                chartElement.__echartsInstance.dispose();
                chartElement.__echartsInstance = null;
            }
            if (chartElement.__resizeObserver) {
                chartElement.__resizeObserver.disconnect();
                chartElement.__resizeObserver = null;
            }
        });
    }
}
