import { Dialog } from "siyuan";
import { readReminderData, readProjectData } from "../api";
import { generateRepeatInstances } from "../utils/repeatUtils";
import { t } from "../utils/i18n";
import { getLocalDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { init, use } from 'echarts/core';
import { PieChart, HeatmapChart, CustomChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GridComponent, TitleComponent, LegendComponent, CalendarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

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

interface TaskSession {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    duration: number;
    completed: boolean;
    type: 'task';
    projectId?: string;
    categoryId?: string;
}

export class TaskTimeStatsView {
    private dialog: Dialog;
    private plugin?: any;
    private reminderData: Record<string, any> = {};
    private projectData: Record<string, any> = {};
    private categoryManager?: CategoryManager;
    private categoryMap: Map<string, string> = new Map();
    private sessionsCache: Map<string, TaskSession[]> = new Map();
    private isDataLoaded: boolean = false;
    private isDataLoading: boolean = false;
    private currentView: 'overview' | 'details' | 'records' | 'trends' | 'timeline' | 'heatmap' = 'overview';
    private currentTimeRange: 'today' | 'week' | 'month' | 'year' = 'today';
    private currentDetailGroup: 'task' | 'project' | 'category' = 'task';
    private currentYear: number = new Date().getFullYear();
    private currentWeekOffset: number = 0; // 周偏移量，0表示本周，-1表示上周，1表示下周
    private currentMonthOffset: number = 0; // 月偏移量，0表示本月，-1表示上月，1表示下月
    private currentYearOffset: number = 0; // 年偏移量，0表示今年，-1表示去年，1表示明年

    constructor(plugin?: any) {
        this.plugin = plugin;
        this.categoryManager = plugin ? CategoryManager.getInstance(plugin) : undefined;
        this.createDialog();
    }

    private createDialog() {
        this.dialog = new Dialog({
            title: "\u23F1 " + t("taskTimeStats"),
            content: this.createContent(),
            width: "90vw",
            height: "85vh",
            destroyCallback: () => {
                // 清理资源
            }
        });
    }

    private createContent(): string {
        return `
            <div class="pomodoro-stats-view">
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
        const totalTime = this.calculateTotalFocusTime();

        return `
            <div class="overview-container">
                <div class="overview-cards">
                    <div class="overview-card today">
                        <div class="card-icon">🌅</div>
                        <div class="card-content">
                            <div class="card-title">${t("taskToday")}</div>
                            <div class="card-value">${this.formatTime(todayTime)}</div>
                            <div class="card-subtitle">${t("tasksCount", { count: this.getTodayTaskCount().toString() })}</div>
                        </div>
                    </div>
                    
                    <div class="overview-card week">
                        <div class="card-icon">📅</div>
                        <div class="card-content">
                            <div class="card-title">${t("taskWeek")}</div>
                            <div class="card-value">${this.formatTime(weekTime)}</div>
                            <div class="card-subtitle">${t("tasksCount", { count: this.getWeekTaskCount().toString() })}</div>
                        </div>
                    </div>
                    
                    <div class="overview-card total">
                        <div class="card-icon">🏆</div>
                        <div class="card-content">
                            <div class="card-title">${t("totalTaskTime")}</div>
                            <div class="card-value">${this.formatTime(totalTime)}</div>
                            <div class="card-subtitle">${t("tasksCount", { count: this.getTotalTaskCount().toString() })}</div>
                        </div>
                    </div>
                </div>

                <!-- 今日任务进度 -->
                <div class="today-progress">
                    <h3>📈 ${t("todayProgress")}</h3>
                    ${this.renderTodayProgress()}
                </div>

                <!-- 最近7天趋势 -->
                <div class="recent-trend">
                    <h3>📊 ${t("recentTrend")}</h3>
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
                    <div class="detail-group-selector">
                        <button class="group-btn ${this.currentDetailGroup === 'task' ? 'active' : ''}" data-group="task">
                            ${t("detailGroupTask")}
                        </button>
                        <button class="group-btn ${this.currentDetailGroup === 'project' ? 'active' : ''}" data-group="project">
                            ${t("detailGroupProject")}
                        </button>
                        <button class="group-btn ${this.currentDetailGroup === 'category' ? 'active' : ''}" data-group="category">
                            ${t("detailGroupCategory")}
                        </button>
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
                    <div class="records-subtitle">${t("recent7DaysFocus")}</div>
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
        const todaySessions = this.getTodaySessions();
        const taskCount = todaySessions.length;

        return `
            <div class="progress-info">
                <div class="progress-item">
                    <span class="progress-label">${t("taskCount")}</span>
                    <span class="progress-value">${taskCount}</span>
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
        const date = new Date(session.startTime);
        const dateStr = date.toLocaleDateString('zh-CN');
        const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="record-item ${session.type}">
                <div class="record-icon">
                    &#x1F4DD;
                </div>
                <div class="record-content">
                    <div class="record-title">${session.title}</div>
                    <div class="record-meta">
                        <span class="record-date">${dateStr}</span>
                        <span class="record-time">${timeStr}</span>
                        <span class="record-duration">${session.duration}${t("minutes")}</span>
                        ${session.completed ? '<span class="record-completed">&#x2713;</span>' : ''}
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

    private formatTime(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
    }

    private async loadReminderData(): Promise<void> {
        if (this.isDataLoaded || this.isDataLoading) return;
        this.isDataLoading = true;

        try {
            const data = await readReminderData();
            if (data && typeof data === 'object' && !data.code && !data.msg) {
                this.reminderData = data;
            } else {
                this.reminderData = {};
            }
            try {
                const projectData = await readProjectData();
                this.projectData = projectData && typeof projectData === 'object' ? projectData : {};
            } catch (error) {
                console.warn('加载项目数据失败:', error);
                this.projectData = {};
            }

            if (this.categoryManager) {
                try {
                    await this.categoryManager.initialize();
                    const categories = this.categoryManager.getCategories();
                    this.categoryMap = new Map(categories.map(category => [category.id, category.name]));
                } catch (error) {
                    console.warn('加载分类数据失败:', error);
                    this.categoryMap.clear();
                }
            } else {
                this.categoryMap.clear();
            }
        } catch (error) {
            console.error('加载任务数据失败:', error);
            this.reminderData = {};
        } finally {
            this.isDataLoaded = true;
            this.isDataLoading = false;
            this.sessionsCache.clear();
        }
    }

    private getDateSessions(dateStr: string): TaskSession[] {
        if (!this.isDataLoaded) return [];
        const cached = this.sessionsCache.get(dateStr);
        if (cached) return cached;

        const sessions: TaskSession[] = [];
        const reminders = Object.values(this.reminderData || {});

        reminders.forEach((reminder: any) => {
            if (!reminder || typeof reminder !== 'object') return;

            if (reminder.date === dateStr) {
                const session = this.buildSessionFromReminder(reminder, reminder.id, dateStr);
                if (session) sessions.push(session);
            }

            if (reminder.repeat?.enabled) {
                const instances = generateRepeatInstances(reminder, dateStr, dateStr, 1);
                instances.forEach(instance => {
                    if (instance.date !== dateStr) return;
                    if (instance.date === reminder.date) return;
                    const instanceReminder = {
                        ...reminder,
                        ...instance,
                        completed: typeof instance.completed === 'boolean' ? instance.completed : reminder.completed
                    };
                    const session = this.buildSessionFromReminder(
                        instanceReminder,
                        instance.instanceId || `${reminder.id}_${instance.date}`,
                        instance.date
                    );
                    if (session) sessions.push(session);
                });
            }
        });

        this.sessionsCache.set(dateStr, sessions);
        return sessions;
    }

    private getTodaySessions(): TaskSession[] {
        const today = getLocalDateString(new Date());
        return this.getDateSessions(today);
    }

    private getWeekSessions(): TaskSession[] {
        const sessions: TaskSession[] = [];
        const today = new Date();
        const startOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(today.getDate() + mondayOffset);

        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.getDateSessions(dateStr));
        }

        return sessions;
    }

    private getTodayTaskTime(): number {
        return this.getTodaySessions().reduce((sum, session) => sum + session.duration, 0);
    }

    private getWeekTaskTime(): number {
        return this.getWeekSessions().reduce((sum, session) => sum + session.duration, 0);
    }

    private getSessionsInRange(startDate: string, endDate: string): TaskSession[] {
        if (!startDate || !endDate) return [];
        if (startDate > endDate) return [];

        const sessions: TaskSession[] = [];
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);

        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateStr = getLocalDateString(date);
            sessions.push(...this.getDateSessions(dateStr));
        }

        return sessions;
    }

    private getTotalRange(): { start: string; end: string } {
        const today = getLocalDateString(new Date());
        let start = today;
        let end = today;
        const reminders = Object.values(this.reminderData || {});

        reminders.forEach((reminder: any) => {
            if (!reminder || typeof reminder !== 'object') return;
            if (reminder.date && reminder.date < start) {
                start = reminder.date;
            }
            if (reminder.date && reminder.date > end) {
                end = reminder.date;
            }
            if (reminder.endDate && reminder.endDate > end) {
                end = reminder.endDate;
            }
            if (reminder.repeat?.endType === 'date' && reminder.repeat?.endDate && reminder.repeat.endDate > end) {
                end = reminder.repeat.endDate;
            }
        });

        return { start, end };
    }

    private buildSessionFromReminder(reminder: any, sessionId: string, fallbackDate: string): TaskSession | null {
        const date = reminder.date || fallbackDate;
        if (!date) return null;

        let start: Date;
        let end: Date;

        if (reminder.endDate) {
            if (reminder.time && reminder.endTime) {
                start = new Date(`${date}T${reminder.time}:00`);
                end = new Date(`${reminder.endDate}T${reminder.endTime}:00`);
            } else {
                start = new Date(`${date}T00:00:00`);
                end = new Date(`${reminder.endDate}T00:00:00`);
                end.setDate(end.getDate() + 1);
            }
        } else if (reminder.time) {
            start = new Date(`${date}T${reminder.time}:00`);
            if (reminder.endTime) {
                end = new Date(`${date}T${reminder.endTime}:00`);
            } else {
                end = new Date(start);
                end.setMinutes(end.getMinutes() + 30);
                if (end.getDate() !== start.getDate()) {
                    end = new Date(`${date}T23:59:00`);
                }
            }
        } else {
            start = new Date(`${date}T00:00:00`);
            end = new Date(start);
            end.setDate(end.getDate() + 1);
        }

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        if (end.getTime() < start.getTime()) {
            end = new Date(start);
        }

        const duration = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

        return {
            id: sessionId,
            title: reminder.title || t("unnamedNote"),
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            duration,
            completed: !!reminder.completed,
            type: 'task',
            projectId: reminder.projectId || undefined,
            categoryId: reminder.categoryId || undefined
        };
    }

    // 数据获取方法
    private calculateTotalFocusTime(): number {
        const { start, end } = this.getTotalRange();
        return this.getSessionsInRange(start, end)
            .reduce((total, session) => total + session.duration, 0);
    }

    private getTodayTaskCount(): number {
        const todaySessions = this.getTodaySessions();
        return todaySessions.length;
    }

    private getWeekTaskCount(): number {
        const weekSessions = this.getWeekSessions();
        return weekSessions.length;
    }

    private getTotalTaskCount(): number {
        const { start, end } = this.getTotalRange();
        return this.getSessionsInRange(start, end).length;
    }

    private getLast7DaysData(): Array<{ label: string, value: number }> {
        const data = [];
        const today = new Date();

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            const sessions = this.getDateSessions(dateStr);
            const value = sessions.reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: i === 0 ? t("today") : date.toLocaleDateString('zh-CN', { weekday: 'short' }),
                value
            });
        }

        return data;
    }

    private getTaskCategoryStats(): Record<string, { time: number, count: number }> {
        let sessions: TaskSession[] = [];

        // 根据当前时间范围和偏移量获取会话数据
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
                sessions = this.getTodaySessions();
        }

        const stats: Record<string, { time: number, count: number }> = {};

        sessions.forEach(session => {
            const groupName = this.getDetailGroupName(session);
            if (!stats[groupName]) {
                stats[groupName] = { time: 0, count: 0 };
            }
            stats[groupName].time += session.duration;
            stats[groupName].count++;
        });

        return stats;
    }

    private getDetailGroupName(session: TaskSession): string {
        switch (this.currentDetailGroup) {
            case 'project': {
                const projectId = session.projectId;
                const projectName = projectId && this.projectData[projectId]?.title;
                return projectName || t("uncategorized");
            }
            case 'category': {
                const categoryId = session.categoryId;
                const categoryName = categoryId ? this.categoryMap.get(categoryId) : undefined;
                return categoryName || t("uncategorized");
            }
            case 'task':
            default:
                return session.title || t("unnamedNote");
        }
    }

    private getTodaySessionsWithOffset(): TaskSession[] {
        const today = new Date();
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
        const dateStr = getLocalDateString(targetDate);
        return this.getDateSessions(dateStr);
    }

    private getWeekSessionsWithOffset(): TaskSession[] {
        const sessions = [];
        const today = new Date();

        // 计算目标周的开始日期（星期一）
        const startOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));

        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.getDateSessions(dateStr));
        }

        return sessions;
    }

    private getMonthSessionsWithOffset(): TaskSession[] {
        const sessions = [];
        const today = new Date();

        // 计算目标月份
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.getDateSessions(dateStr));
        }

        return sessions;
    }

    private getYearSessionsWithOffset(): TaskSession[] {
        const sessions = [];
        const today = new Date();
        const targetYear = today.getFullYear() + this.currentYearOffset;

        // 获取整年的数据
        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(targetYear, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, month, day);
                const dateStr = getLocalDateString(date);
                sessions.push(...this.getDateSessions(dateStr));
            }
        }

        return sessions;
    }

    private getRecentSessions(days: number): TaskSession[] {
        const sessions = [];
        const today = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.getDateSessions(dateStr));
        }

        return sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }

    private getTrendsData(): Array<{ label: string, value: number }> {
        // 根据当前时间范围返回趋势数据
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
        const today = new Date();

        // 计算目标周的开始日期（星期一）
        const startOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));

        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const dateStr = getLocalDateString(date);
            const sessions = this.getDateSessions(dateStr);
            const value = sessions.reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: date.toLocaleDateString('zh-CN', { weekday: 'short' }),
                value
            });
        }

        return data;
    }

    private getMonthlyTrendsData(): Array<{ label: string, value: number }> {
        // 实现月度趋势数据获取
        const data = [];
        const today = new Date();

        // 计算目标月份
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const sessions = this.getDateSessions(dateStr);
            const time = sessions.reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: day.toString(),
                value: time
            });
        }

        return data;
    }

    private getYearlyTrendsData(): Array<{ label: string, value: number }> {
        // 实现年度趋势数据获取
        const data = [];
        const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        const today = new Date();
        const targetYear = today.getFullYear() + this.currentYearOffset;

        months.forEach((month, index) => {
            let monthlyTime = 0;
            const daysInMonth = new Date(targetYear, index + 1, 0).getDate();

            // 计算该月的总任务时间
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, index, day);
                const dateStr = getLocalDateString(date);
                const sessions = this.getDateSessions(dateStr);
                monthlyTime += sessions.reduce((sum, s) => sum + s.duration, 0);
            }

            data.push({
                label: month,
                value: monthlyTime
            });
        });

        return data;
    }

    private getTimelineData(): Array<{ date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> }> {
        // 实现时间线数据获取
        const data = [];
        const today = new Date();

        // 根据当前时间范围和偏移量计算数据
        switch (this.currentTimeRange) {
            case 'week':
                // 显示指定周的7天（从星期一开始）
                const startOfWeek = new Date(today);
                const dayOfWeek = today.getDay();
                // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));

                for (let i = 0; i < 7; i++) {
                    const date = new Date(startOfWeek);
                    date.setDate(startOfWeek.getDate() + i);
                    data.push(this.getTimelineDataForDate(date));
                }
                break;

            case 'month':
                // 显示本月所有天的平均任务时间分布
                data.push(this.getAverageTimelineDataForMonth());
                break;

            case 'year':
                // 显示本年所有天的平均任务时间分布
                data.push(this.getAverageTimelineDataForYear());
                break;

            default:
                // 默认显示最近7天
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
        const sessions = this.getDateSessions(dateStr);

        const timelineSessions = sessions.map(session => {
            const startTime = new Date(session.startTime);
            const startPercent = (startTime.getHours() * 60 + startTime.getMinutes()) / (24 * 60) * 100;
            const widthPercent = Math.min(session.duration / (24 * 60) * 100, 100);

            return {
                type: session.type,
                title: session.title,
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
        const today = new Date();
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        // 创建24小时的时间段统计数组，按小时统计
        const hourlyStats = new Array(24).fill(0); // 24个小时
        let totalDays = 0;

        // 收集整个月的数据
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const sessions = this.getDateSessions(dateStr);

            let hasData = false;
            sessions.forEach(session => {
                hasData = true;
                const startTime = new Date(session.startTime);
                const startHour = startTime.getHours();
                const startMinute = startTime.getMinutes();
                const duration = session.duration;

                // 将任务时间分布到对应的小时中
                let remainingDuration = duration;
                let currentHour = startHour;
                let currentMinute = startMinute;

                while (remainingDuration > 0 && currentHour < 24) {
                    // 计算当前小时内剩余的分钟数
                    const minutesLeftInHour = 60 - currentMinute;
                    const durationInThisHour = Math.min(remainingDuration, minutesLeftInHour);

                    hourlyStats[currentHour] += durationInThisHour;
                    remainingDuration -= durationInThisHour;

                    // 移动到下一个小时
                    currentHour++;
                    currentMinute = 0;
                }
            });

            if (hasData) {
                totalDays++;
            }
        }

        // 计算平均值并转换为时间线格式
        const sessions = [];
        if (totalDays > 0) {
            for (let hour = 0; hour < 24; hour++) {
                const avgDuration = hourlyStats[hour] / totalDays;
                if (avgDuration > 1) { // 只显示平均时长超过1分钟的小时
                    const startPercent = (hour * 60) / (24 * 60) * 100;
                    const widthPercent = 60 / (24 * 60) * 100; // 1小时

                    sessions.push({
                        type: 'task',
                        title: `${hour}:00-${hour + 1}:00 平均任务时长 ${avgDuration.toFixed(1)}分钟`,
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
        const today = new Date();
        const targetYear = today.getFullYear() + this.currentYearOffset;

        // 创建24小时的时间段统计数组，按小时统计
        const hourlyStats = new Array(24).fill(0); // 24个小时
        let totalDays = 0;

        // 收集整年的数据
        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(targetYear, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, month, day);
                const dateStr = getLocalDateString(date);
                const sessions = this.getDateSessions(dateStr);

                let hasData = false;
                sessions.forEach(session => {
                    hasData = true;
                    const startTime = new Date(session.startTime);
                    const startHour = startTime.getHours();
                    const startMinute = startTime.getMinutes();
                    const duration = session.duration;

                    // 将任务时间分布到对应的小时中
                    let remainingDuration = duration;
                    let currentHour = startHour;
                    let currentMinute = startMinute;

                    while (remainingDuration > 0 && currentHour < 24) {
                        // 计算当前小时内剩余的分钟数
                        const minutesLeftInHour = 60 - currentMinute;
                        const durationInThisHour = Math.min(remainingDuration, minutesLeftInHour);

                        hourlyStats[currentHour] += durationInThisHour;
                        remainingDuration -= durationInThisHour;

                        // 移动到下一个小时
                        currentHour++;
                        currentMinute = 0;
                    }
                });

                if (hasData) {
                    totalDays++;
                }
            }
        }

        // 计算平均值并转换为时间线格式
        const sessions = [];
        if (totalDays > 0) {
            for (let hour = 0; hour < 24; hour++) {
                const avgDuration = hourlyStats[hour] / totalDays;
                if (avgDuration > 1) { // 只显示平均时长超过1分钟的小时
                    const startPercent = (hour * 60) / (24 * 60) * 100;
                    const widthPercent = 60 / (24 * 60) * 100; // 1小时

                    sessions.push({
                        type: 'task',
                        title: `${hour}:00-${hour + 1}:00 平均任务时长 ${avgDuration.toFixed(1)}分钟`,
                        duration: Math.round(avgDuration),
                        startPercent,
                        widthPercent
                    });
                }
            }
        }

        return {
            date: `${targetYear}年平均分布`,
            sessions
        };
    }

    private getHeatmapData(year: number): Array<{ date: string, time: number, level: number }> {
        const data = [];
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31);

        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
            const dateStr = getLocalDateString(date);
            const sessions = this.getDateSessions(dateStr);
            const time = sessions.reduce((sum, s) => sum + s.duration, 0);

            // 根据时间计算热力图等级 (0-4)
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

    private getEventColor(index: number): string {
        const colors = ['#FF6B6B', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', '#795548', '#607D8B'];
        return colors[index % colors.length];
    }

    private getCurrentDateRangeText(): string {
        const today = new Date();

        switch (this.currentTimeRange) {
            case 'today':
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
                return targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

            case 'week':
                const startOfWeek = new Date(today);
                const dayOfWeek = today.getDay();
                // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);

                return `${startOfWeek.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;

            case 'month':
                const targetMonth = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
                return `${targetMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}`;

            case 'year':
                const targetYear = today.getFullYear() + this.currentYearOffset;
                return `${targetYear}年`;

            default:
                return '';
        }
    }

    public show() {
        this.dialog.element.addEventListener('click', this.handleClick.bind(this));
        this.loadReminderData().then(() => this.updateContent());
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
                                <div style="margin-bottom: 2px;">任务时长: ${timeStr}</div>
                                <div style="margin-bottom: 2px;">任务数量: ${countStr}个</div>
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
                        name: '平均任务时长',
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
                                const start = Math.floor(params.value[0]);
                                const startMin = Math.round((params.value[0] - start) * 60);
                                const duration = params.value[4];
                                const title = params.value[3];
                                const startTime = `${start.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
                                return `${title}<br/>时间段: ${startTime}<br/>平均时长: ${duration}分钟`;
                            }
                        }
                    });
                }
            } else {
                // 原有的多天数据处理逻辑
                const sessionTypes = ['task'];
                const typeNames = {
                    'task': '任务时长'
                };
                const typeColors = {
                    'task': '#FF6B6B'
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
                                    const start = Math.floor(params.value[0]);
                                    const startMin = Math.round((params.value[0] - start) * 60);
                                    const duration = params.value[4];
                                    const title = params.value[3];
                                    const startTime = `${start.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
                                    return `${title}<br/>开始时间: ${startTime}<br/>持续时间: ${duration}分钟`;
                                }
                            }
                        });
                    }
                });
            }

            // 配置选项
            const chartTitle = isAverageData ?
                (timelineData[0].date.includes('月') ? '月度平均任务时长分布' : '年度平均任务时长分布') :
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
                            return `${value.toString().padStart(2, '0')}:00`;
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

        if (target.classList.contains('group-btn')) {
            const group = target.dataset.group as any;
            if (group && group !== this.currentDetailGroup) {
                this.currentDetailGroup = group;
                this.updateContent();
            }
        }

        if (target.classList.contains('nav-arrow')) {
            const action = target.dataset.action;
            this.handleNavigation(action);
        }

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

        this.dialog.element.querySelectorAll('.group-btn').forEach(btn => {
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




