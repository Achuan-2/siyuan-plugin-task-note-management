<script lang="ts">
import { onMount, onDestroy } from "svelte";

export let plugin: any;
let host: HTMLDivElement;
let statsView: any = null;

import { Dialog } from "siyuan";
import { showMessage } from "siyuan";
import { confirm } from "siyuan";
import { PomodoroRecordManager } from "../../utils/pomodoroRecord";
import { i18n } from "../../pluginInstance";
import { getLocalDateString, getLogicalDateString, getDayStartMinutes, getLocaleTag } from "../../utils/dateUtils";
import { init, use } from 'echarts/core';
import { PieChart, HeatmapChart, CustomChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GridComponent, TitleComponent, LegendComponent, CalendarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { setLastStatsMode } from "./statsMode";

type PomodoroSession = {
    id: string;
    type: 'work' | 'shortBreak' | 'longBreak';
    eventId: string;
    eventTitle: string;
    startTime: string;
    endTime: string;
    duration: number;
    plannedDuration: number;
    completed: boolean;
    isCountUp?: boolean;
    count?: number;
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

class PomodoroStatsView {
    private dialog: Dialog;
    private embeddedHost?: HTMLElement;
    private embeddedMode: boolean = false;
    private recordManager: PomodoroRecordManager;
    private currentView: 'overview' | 'details' | 'records' | 'trends' | 'timeline' | 'heatmap' = 'overview';
    private currentTimeRange: 'today' | 'week' | 'month' | 'year' = 'today';
    private currentYear: number = parseInt(getLogicalDateString().split('-')[0], 10);
    private currentWeekOffset: number = 0; // 周偏移量，0表示本周，-1表示上周，1表示下周
    private currentMonthOffset: number = 0; // 月偏移量，0表示本月，-1表示上月，1表示下月
    private currentYearOffset: number = 0; // 年偏移量，0表示今年，-1表示去年，1表示明年
    private plugin;
    constructor(plugin: any, embeddedHost?: HTMLElement) {
        this.recordManager = PomodoroRecordManager.getInstance();
        this.plugin = plugin;
        this.embeddedHost = embeddedHost;
        this.embeddedMode = !!embeddedHost;
        this.createDialog();
    }

    private createDialog() {
        if (this.embeddedHost) {
            this.embeddedHost.innerHTML = this.createContent();
            this.dialog = {
                element: this.embeddedHost,
                destroy: () => { }
            } as any;
            return;
        }

        this.dialog = new Dialog({
            title: "🍅 " + i18n("pomodoroStats"),
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
                ${this.embeddedMode ? '' : `
                    <div class="stats-switch">
                        <button class="stats-switch-btn" data-mode="task">
                            ✅ ${i18n("taskStats")}
                        </button>
                        <button class="stats-switch-btn active" data-mode="pomodoro">
                            🍅 ${i18n("pomodoroStats")}
                        </button>
                    </div>
                `}
                <!-- 导航标签 -->
                <div class="stats-nav">
                    <button class="nav-btn ${this.currentView === 'overview' ? 'active' : ''}" data-view="overview">
                        📊 ${i18n("overview")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'details' ? 'active' : ''}" data-view="details">
                        📈 ${i18n("focusDetails")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'records' ? 'active' : ''}" data-view="records">
                        📝 ${i18n("focusRecords")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'trends' ? 'active' : ''}" data-view="trends">
                        📉 ${i18n("focusTrends")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'timeline' ? 'active' : ''}" data-view="timeline">
                        ⏰ ${i18n("focusTimeline")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'heatmap' ? 'active' : ''}" data-view="heatmap">
                        🔥 ${i18n("yearlyHeatmap")}
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
        const todayTime = this.recordManager.getTodayFocusTime();
        const weekTime = this.recordManager.getWeekFocusTime();
        const totalTime = this.calculateTotalFocusTime();

        return `
            <div class="overview-container">
                <div class="overview-cards">
                    <div class="overview-card today">
                        <div class="card-icon">🌅</div>
                        <div class="card-content">
                            <div class="card-title">${i18n("todayFocus")}</div>
                            <div class="card-value">${this.recordManager.formatTime(todayTime)}</div>
                            <div class="card-subtitle">${this.getTodayPomodoroCount()}${i18n("pomodoroCountUnit")}</div>
                        </div>
                    </div>
                    
                    <div class="overview-card week">
                        <div class="card-icon">📅</div>
                        <div class="card-content">
                            <div class="card-title">${i18n("weekFocus")}</div>
                            <div class="card-value">${this.recordManager.formatTime(weekTime)}</div>
                            <div class="card-subtitle">${this.getWeekPomodoroCount()}${i18n("pomodoroCountUnit")}</div>
                        </div>
                    </div>
                    
                    <div class="overview-card total">
                        <div class="card-icon">🏆</div>
                        <div class="card-content">
                            <div class="card-title">${i18n("totalFocus")}</div>
                            <div class="card-value">${this.recordManager.formatTime(totalTime)}</div>
                            <div class="card-subtitle">${this.getTotalPomodoroCount()}${i18n("pomodoroCountUnit")}</div>
                        </div>
                    </div>
                </div>

                <!-- 今日专注进度 -->
                <div class="today-progress">
                    <h3>📈 ${i18n("todayProgress")}</h3>
                    ${this.renderTodayProgress()}
                </div>

                <!-- 最近7天趋势 -->
                <div class="recent-trend">
                    <h3>📊 ${i18n("recentTrend")}</h3>
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
                        <h3>📈 ${i18n("focusDetails")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'today' ? 'active' : ''}" data-range="today">
                            ${i18n("today")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${i18n("week")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${i18n("month")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${i18n("year")}
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
                    <h3>📝 ${i18n("focusRecords")}</h3>
                    <div class="records-subtitle">${i18n("recent7DaysFocus")}</div>
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
                        <h3>📉 ${i18n("focusTrends")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${i18n("thisWeek")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${i18n("thisMonth")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${i18n("thisYear")}
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
                        <h3>⏰ ${i18n("focusTimeline")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${i18n("thisWeek")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${i18n("thisMonth")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${i18n("thisYear")}
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
                    <h3>🔥 ${i18n("yearlyHeatmap")}</h3>
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
        const todayTime = this.recordManager.getTodayFocusTime();
        const todaySessions = this.recordManager.getTodaySessions();
        const completedPomodoros = todaySessions
            .filter(s => s.type === 'work')
            .reduce((sum, s) => sum + this.recordManager.calculateSessionCount(s), 0);

        return `
            <div class="progress-info">
                <div class="progress-item">
                    <span class="progress-label">${i18n("completedPomodoros")}</span>
                    <span class="progress-value">${completedPomodoros}</span>
                </div>
                <div class="progress-item">
                    <span class="progress-label">${i18n("focusTime")}</span>
                    <span class="progress-value">${this.recordManager.formatTime(todayTime)}</span>
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
                            <div class="trend-value">${this.recordManager.formatTime(day.value)}</div>
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
            return `<div class="no-data">${i18n("noData")}</div>`;
        }

        // 生成唯一的图表ID
        const chartId = `pie-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        return `
            <div class="category-chart">
                <div id="${chartId}" class="echarts-pie-chart" style="width: 100%; height: 400px;"></div>
            </div>
        `;
    }

    private renderSessionRecord(session: PomodoroSession): string {
        const date = new Date(session.startTime);
        const dateStr = date.toLocaleDateString(getLocaleTag());
        const timeStr = date.toLocaleTimeString(getLocaleTag(), { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="record-item ${session.type}">
                <div class="record-icon">
                    ${session.type === 'work' ? '🍅' : (session.type === 'longBreak' ? '🧘' : '☕')}
                </div>
                <div class="record-content">
                    <div class="record-title">${session.eventTitle}</div>
                    <div class="record-meta">
                        <span class="record-date">${dateStr}</span>
                        <span class="record-time">${timeStr}</span>
                        <span class="record-duration">${session.duration}${i18n("minutes")}</span>
                        ${session.completed ? '<span class="record-completed">✅</span>' : '<span class="record-incomplete">⏸</span>'}
                    </div>
                </div>
                <div class="record-actions">
                    <button class="delete-btn ariaLabel" data-session-id="${session.id}" aria-label="${i18n("delete")}">🗑️</button>
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
                                <div class="chart-value">${this.recordManager.formatTime(item.value)}</div>
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
    private calculateTotalFocusTime(): number {
        // 获取所有记录的总专注时间
        let totalTime = 0;
        const allRecords = (this.recordManager as any).records || {};

        Object.values(allRecords).forEach((record: any) => {
            if (record && record.totalWorkTime) {
                totalTime += record.totalWorkTime;
            }
        });

        return totalTime;
    }

    private getTodayPomodoroCount(): number {
        const todaySessions = this.recordManager.getTodaySessions();
        return todaySessions
            .filter(s => s.type === 'work')
            .reduce((sum, s) => sum + this.recordManager.calculateSessionCount(s), 0);
    }

    private getWeekPomodoroCount(): number {
        const weekSessions = this.recordManager.getWeekSessions();
        return weekSessions
            .filter(s => s.type === 'work')
            .reduce((sum, s) => sum + this.recordManager.calculateSessionCount(s), 0);
    }

    private getTotalPomodoroCount(): number {
        // 获取所有记录的总番茄钟数量
        let totalCount = 0;
        const allRecords = (this.recordManager as any).records || {};

        Object.values(allRecords).forEach((record: any) => {
            if (record && record.workSessions) {
                totalCount += record.workSessions;
            }
        });

        return totalCount;
    }

    private getLast7DaysData(): Array<{ label: string, value: number }> {
        const data = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const value = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: i === 0 ? i18n("today") : date.toLocaleDateString(getLocaleTag(), { weekday: 'short' }),
                value
            });
        }

        return data;
    }

    private getTaskCategoryStats(): Record<string, { time: number, count: number }> {
        let sessions: PomodoroSession[] = [];

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
                sessions = this.recordManager.getTodaySessions();
        }

        const stats: Record<string, { time: number, count: number }> = {};

        sessions.filter(s => s.type === 'work').forEach(session => {
            const category = session.eventTitle || i18n("uncategorized");
            if (!stats[category]) {
                stats[category] = { time: 0, count: 0 };
            }
            stats[category].time += session.duration;
            stats[category].count += this.recordManager.calculateSessionCount(session);
        });

        return stats;
    }

    private getTodaySessionsWithOffset(): PomodoroSession[] {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
        const dateStr = getLocalDateString(targetDate);
        return this.recordManager.getDateSessions(dateStr);
    }

    private getWeekSessionsWithOffset(): PomodoroSession[] {
        const sessions = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

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
            sessions.push(...this.recordManager.getDateSessions(dateStr));
        }

        return sessions;
    }

    private getMonthSessionsWithOffset(): PomodoroSession[] {
        const sessions = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        // 计算目标月份
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.recordManager.getDateSessions(dateStr));
        }

        return sessions;
    }

    private getYearSessionsWithOffset(): PomodoroSession[] {
        const sessions = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const targetYear = today.getFullYear() + this.currentYearOffset;

        // 获取整年的数据
        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(targetYear, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, month, day);
                const dateStr = getLocalDateString(date);
                sessions.push(...this.recordManager.getDateSessions(dateStr));
            }
        }

        return sessions;
    }

    private getRecentSessions(days: number): PomodoroSession[] {
        const sessions = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.recordManager.getDateSessions(dateStr));
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
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

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
            const sessions = this.recordManager.getDateSessions(dateStr);
            const value = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);

            data.push({
                label: date.toLocaleDateString(getLocaleTag(), { weekday: 'short' }),
                value
            });
        }

        return data;
    }

    private getMonthlyTrendsData(): Array<{ label: string, value: number }> {
        // 实现月度趋势数据获取
        const data = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        // 计算目标月份
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const time = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);

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
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const targetYear = today.getFullYear() + this.currentYearOffset;
        const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m =>
            new Date(targetYear, m - 1, 1).toLocaleDateString(getLocaleTag(), { month: 'short' })
        );

        months.forEach((month, index) => {
            let monthlyTime = 0;
            const daysInMonth = new Date(targetYear, index + 1, 0).getDate();

            // 计算该月的总专注时间
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, index, day);
                const dateStr = getLocalDateString(date);
                const sessions = this.recordManager.getDateSessions(dateStr);
                monthlyTime += sessions
                    .filter(s => s.type === 'work')
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
        // 实现时间线数据获取
        const data = [];
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

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
                // 显示本月所有天的平均专注时间分布
                data.push(this.getAverageTimelineDataForMonth());
                break;

            case 'year':
                // 显示本年所有天的平均专注时间分布
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
        const sessions = this.recordManager.getDateSessions(dateStr);

        const timelineSessions = sessions.map(session => {
            const startTime = new Date(session.startTime);
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
            date: date.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' }),
            sessions: timelineSessions
        };
    }

    private getAverageTimelineDataForMonth(): { date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> } {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();

        // 创建24小时的时间段统计数组，按小时统计
        const hourlyStats = new Array(24).fill(0); // 24个小时
        let totalDays = 0;

        // 收集整个月的数据
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);

            let hasData = false;
            sessions.filter(s => s.type === 'work').forEach(session => {
                hasData = true;
                const startTime = new Date(session.startTime);
                const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
                const dayStartMinutes = this.getLogicalTimelineStartMinutes();
                const adjustedStartMinutes = (startMinutes - dayStartMinutes + 1440) % 1440;
                const duration = session.duration;

                // 将专注时间分布到对应的逻辑小时中
                let remainingDuration = duration;
                let currentHour = Math.floor(adjustedStartMinutes / 60);
                let currentMinute = adjustedStartMinutes % 60;
                let minutesCovered = 0;

                while (remainingDuration > 0 && minutesCovered < 24 * 60) {
                    // 计算当前小时内剩余的分钟数
                    const minutesLeftInHour = 60 - currentMinute;
                    const durationInThisHour = Math.min(remainingDuration, minutesLeftInHour);

                    hourlyStats[currentHour] += durationInThisHour;
                    remainingDuration -= durationInThisHour;
                    minutesCovered += durationInThisHour;

                    // 移动到下一个逻辑小时
                    currentHour = (currentHour + 1) % 24;
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
                        type: 'work',
                        title: `${hour}:00-${hour + 1}:00 ${i18n("avgFocusHourTitle", { hour: `${hour}:00-${hour + 1}:00`, duration: avgDuration.toFixed(1) })}`,
                        duration: Math.round(avgDuration),
                        startPercent,
                        widthPercent
                    });
                }
            }
        }

        const monthName = targetDate.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'long' });
        return {
            date: `${monthName}${i18n("avgDistribution")}`,
            sessions
        };
    }

    private getAverageTimelineDataForYear(): { date: string, sessions: Array<{ type: string, title: string, duration: number, startPercent: number, widthPercent: number }> } {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
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
                const sessions = this.recordManager.getDateSessions(dateStr);

                let hasData = false;
                sessions.filter(s => s.type === 'work').forEach(session => {
                    hasData = true;
                    const startTime = new Date(session.startTime);
                    const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
                    const dayStartMinutes = this.getLogicalTimelineStartMinutes();
                    const adjustedStartMinutes = (startMinutes - dayStartMinutes + 1440) % 1440;
                    const duration = session.duration;

                    // 将专注时间分布到对应的逻辑小时中
                    let remainingDuration = duration;
                    let currentHour = Math.floor(adjustedStartMinutes / 60);
                    let currentMinute = adjustedStartMinutes % 60;
                    let minutesCovered = 0;

                    while (remainingDuration > 0 && minutesCovered < 24 * 60) {
                        // 计算当前小时内剩余的分钟数
                        const minutesLeftInHour = 60 - currentMinute;
                        const durationInThisHour = Math.min(remainingDuration, minutesLeftInHour);

                        hourlyStats[currentHour] += durationInThisHour;
                        remainingDuration -= durationInThisHour;
                        minutesCovered += durationInThisHour;

                        // 移动到下一个逻辑小时
                        currentHour = (currentHour + 1) % 24;
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
                        type: 'work',
                        title: `${hour}:00-${hour + 1}:00 ${i18n("avgFocusHourTitle", { hour: `${hour}:00-${hour + 1}:00`, duration: avgDuration.toFixed(1) })}`,
                        duration: Math.round(avgDuration),
                        startPercent,
                        widthPercent
                    });
                }
            }
        }

        return {
            date: `${i18n("yearText", { year: targetYear.toString() })}${i18n("avgDistribution")}`,
            sessions
        };
    }

    private getHeatmapData(year: number): Array<{ date: string, time: number, level: number }> {
        const data = [];
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31);

        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const time = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);

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
        const today = new Date(`${getLogicalDateString()}T00:00:00`);

        switch (this.currentTimeRange) {
            case 'today':
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
                return targetDate.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'long', day: 'numeric' });

            case 'week':
                const startOfWeek = new Date(today);
                const dayOfWeek = today.getDay();
                // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);

                return `${startOfWeek.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' })}`;

            case 'month':
                const targetMonth = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
                return targetMonth.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'long' });

            case 'year':
                const targetYear = today.getFullYear() + this.currentYearOffset;
                return i18n("yearText", { year: targetYear.toString() });

            default:
                return '';
        }
    }

    public show() {
        setLastStatsMode('pomodoro');
        this.dialog.element.addEventListener('click', this.handleClick.bind(this));
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
                        const timeStr = this.recordManager.formatTime(params.value);
                        const countStr = data.find(d => d.name === params.name)?.count || 0;
                        return `
                            <div style="padding: 8px;">
                                <div style="margin-bottom: 4px;">
                                    <span style="display: inline-block; width: 10px; height: 10px; background-color: ${params.color}; border-radius: 50%; margin-right: 8px;"></span>
                                    <strong>${params.name}</strong>
                                </div>
                                <div style="margin-bottom: 2px;">${i18n("focusTimeColon")}${timeStr}</div>
                                <div style="margin-bottom: 2px;">${i18n("completedPomodoroCountColon")}${countStr}${i18n("pomodoroCountUnit")}</div>
                                <div>${i18n("proportionOf")}${percentage}%</div>
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
                            const timeStr = this.recordManager.formatTime(item.value);
                            return `${name} (${timeStr})`;
                        }
                        return name;
                    }
                },
                series: [
                    {
                        name: i18n("focusTime"),
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
                chartElement.innerHTML = `<div class="no-data" style="text-align: center; padding: 50px;">${i18n("noData")}</div>`;
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
                    text: `${this.currentYear}${i18n("year")}${i18n("focusTime")}${i18n("yearlyHeatmap")}`,
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
                        const dateStr = date.toLocaleDateString(getLocaleTag(), {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                        const time = params.data[1];
                        if (time === 0) {
                            return `${dateStr}<br/>${i18n("noFocusRecord")}`;
                        }
                        const timeStr = this.recordManager.formatTime(time);
                        return `${dateStr}<br/>${i18n("focusTimeColon")}${timeStr}`;
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
                    text: [i18n("more"), i18n("less")],
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
                chartElement.innerHTML = `<div class="no-data" style="text-align: center; padding: 50px;">${i18n("noData")}</div>`;
                return;
            }

            // 初始化echarts实例
            const chart = init(chartElement);

            // 准备时间线数据
            const dates = timelineData.map(d => d.date);
            const series = [];

            // 检查是否是平均分布数据（只有一行数据且包含"平均分布"）
            const isAverageData = timelineData.length === 1 && timelineData[0].date.includes(i18n("avgDistribution"));

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
                        name: i18n("avgFocusLabel"),
                        type: 'custom',
                        renderItem: (params, api) => {
                            const start = api.value(0);
                            const end = api.value(2);
                            const duration = api.value(4);
                            const y = api.coord([0, 0])[1];
                            const startX = api.coord([start, 0])[0];
                            const endX = api.coord([end, 0])[0];

                            // 根据平均专注时长调整颜色深度和高度
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

                                return `${title}<br/>${i18n("timeSegmentColon")}${startTime}<br/>${i18n("avgDurationColon")}${duration}${i18n("minutes")}`;
                            }
                        }
                    });
                }
            } else {
                // 原有的多天数据处理逻辑
                const sessionTypes = ['work', 'shortBreak', 'longBreak'];
                const typeNames = {
                    'work': i18n("pomodoroWork"),
                    'shortBreak': i18n("pomodoroBreak"),
                    'longBreak': i18n("pomodoroLongBreak")
                };
                const typeColors = {
                    'work': '#FF6B6B',
                    'shortBreak': '#4CAF50',
                    'longBreak': '#2196F3'
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

                                    return `${title}<br/>${i18n("startTimeColon")}${startTime}<br/>${i18n("durationColon")}${duration}${i18n("minutes")}`;
                                }
                            }
                        });
                    }
                });
            }

            // 配置选项
            const chartTitle = isAverageData ?
                (timelineData[0].date.includes(i18n("months")) ? i18n("monthAvgFocusDistrib") : i18n("yearAvgFocusDistrib")) :
                i18n("focusTimeline");

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
                    name: i18n("xAxisTimeLabel"),
                    nameLocation: 'middle',
                    nameGap: 30
                },
                yAxis: {
                    type: 'category',
                    data: isAverageData ? [timelineData[0].date.replace(i18n("avgDistribution"), '')] : dates,
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
            if (this.embeddedMode) return;
            const mode = target.dataset.mode;
            if (mode === 'task') {
                setLastStatsMode('task');
            }
            return;
        }

        if (target.classList.contains('nav-btn')) {
            const view = target.dataset.view as any;
            if (view && view !== this.currentView) {
                this.currentView = view;

                // 当切换到专注趋势或专注时间线Tab时，默认设置为本周并重置偏移量
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

    private async handleDeleteSession(sessionId: string) {
        // 显示确认对话框
        const confirmed = await this.showDeleteConfirmation();
        if (!confirmed) return;

        try {
            const success = await this.recordManager.deleteSession(sessionId);
            if (success) {
                // 重新加载数据并更新视图
                await this.recordManager.refreshData();
                this.updateContent();
                showMessage(i18n("deleteSuccess"));
            } else {
                showMessage(i18n("deleteFailed"), 3000, "error");
            }
        } catch (error) {
            console.error('删除会话失败:', error);
            showMessage(i18n("deleteFailed"), 3000, "error");
        }
    }

    private showDeleteConfirmation(): Promise<boolean> {
        return new Promise((resolve) => {
            confirm(
                i18n("deleteRecordTitle"),
                i18n("deleteRecordConfirm"),
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


onMount(async () => {
    statsView = new PomodoroStatsView(plugin, host);
    statsView.show();
});

onDestroy(() => {
    try {
        statsView?.dialog?.destroy?.();
    } catch {
        // ignore
    }
});
</script>

<div class="stats-tab-host" bind:this={host}></div>

<style>
    .stats-tab-host { height: 100%; }
</style>
