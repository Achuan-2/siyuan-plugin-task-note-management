import { Dialog } from "siyuan";
import type { Habit } from "./HabitPanel";
import { HabitDayDialog } from "./HabitDayDialog";
import { init, use, EChartsType } from 'echarts/core';
import { HeatmapChart, ScatterChart, CustomChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GridComponent, TitleComponent, LegendComponent, CalendarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { i18n } from "../pluginInstance";

// 注册 ECharts 组件
use([
    HeatmapChart,
    ScatterChart,
    CustomChart,
    TooltipComponent,
    VisualMapComponent,
    GridComponent,
    TitleComponent,
    LegendComponent,
    CalendarComponent,
    CanvasRenderer
]);

export class HabitStatsDialog {
    private dialog: Dialog;
    private habit: Habit;
    private currentMonthDate: Date = new Date();
    private currentTab: 'overview' | 'time' = 'overview';
    private currentTimeView: 'week' | 'month' | 'year' = 'week';
    private timeViewOffset: number = 0; // 用于周/月/年视图的偏移
    private yearViewOffset: number = 0; // 用于年度视图的偏移
    private chartInstances: EChartsType[] = [];
    private resizeObservers: ResizeObserver[] = [];

    private onSave?: (habit: Habit) => Promise<void>;

    constructor(habit: Habit, onSave?: (habit: Habit) => Promise<void>) {
        this.habit = habit;
        this.onSave = onSave;
    }

    show() {
        this.dialog = new Dialog({
            title: `${this.habit.title} - ${i18n("habitStats")}`,
            content: '<div id="habitStatsContainer"></div>',
            width: "900px",
            height: "850px",
            destroyCallback: () => {
                this.destroyCharts();
            }
        });

        const container = this.dialog.element.querySelector('#habitStatsContainer') as HTMLElement;
        if (!container) return;

        this.currentMonthDate = new Date();
        this.renderContainer(container);
    }

    private destroyCharts() {
        // 先断开所有 ResizeObserver
        this.resizeObservers.forEach(observer => {
            observer.disconnect();
        });
        this.resizeObservers = [];

        // 再销毁图表实例
        this.chartInstances.forEach(chart => {
            if (chart && !chart.isDisposed()) {
                chart.dispose();
            }
        });
        this.chartInstances = [];
    }

    private renderContainer(container: HTMLElement) {
        container.style.cssText = 'padding: 20px; overflow-y: auto; height: 100%;';
        container.innerHTML = '';

        // Tab 导航
        const tabNav = document.createElement('div');
        tabNav.style.cssText = 'display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--b3-theme-surface-lighter); padding-bottom: 12px;';

        const overviewTab = document.createElement('button');
        overviewTab.className = `b3-button ${this.currentTab !== 'overview' ? 'b3-button--outline' : ''}`;
        overviewTab.textContent = i18n("habitOverviewTab");
        overviewTab.style.cssText = this.currentTab === 'overview' ? 'font-weight: bold;' : '';
        overviewTab.addEventListener('click', () => {
            this.currentTab = 'overview';
            this.renderContainer(container);
        });

        const timeTab = document.createElement('button');
        timeTab.className = `b3-button ${this.currentTab !== 'time' ? 'b3-button--outline' : ''}`;
        timeTab.textContent = i18n("habitTimeTab");
        timeTab.style.cssText = this.currentTab === 'time' ? 'font-weight: bold;' : '';
        timeTab.addEventListener('click', () => {
            this.currentTab = 'time';
            this.renderContainer(container);
        });

        tabNav.appendChild(overviewTab);
        tabNav.appendChild(timeTab);
        container.appendChild(tabNav);

        // 内容区域
        const contentArea = document.createElement('div');
        container.appendChild(contentArea);

        if (this.currentTab === 'overview') {
            this.renderStats(contentArea);
        } else {
            this.renderTimeStats(contentArea);
        }
    }

    private renderStats(container: HTMLElement) {

        // 注意：月份切换工具栏已移动到 renderMonthlyView 内部以便只在月度视图显示

        // 统计摘要
        const summary = document.createElement('div');
        summary.style.cssText = 'margin-bottom: 24px;';

        const totalCheckIns = this.habit.totalCheckIns || 0;
        // 只统计达标的打卡天数
        const checkInDays = Object.keys(this.habit.checkIns || {}).filter(dateStr =>
            this.isCheckInComplete(dateStr)
        ).length;

        summary.innerHTML = `
            <h3 style="margin-bottom: 12px;">${i18n("historyCheckInTitle")}</h3>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                <div style="padding: 16px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${totalCheckIns}</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px;">${i18n("statsTotalCheckIns")}</div>
                </div>
                <div style="padding: 16px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${checkInDays}</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px;">${i18n("statsCheckInDays")}</div>
                </div>
                <div style="padding: 16px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${this.calculateStreak()}</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px;">${i18n("statsStreak")}</div>
                </div>
            </div>
        `;

        container.appendChild(summary);

        // Emoji统计
        const emojiStats = this.calculateEmojiStats();
        if (emojiStats.length > 0) {
            const emojiSection = document.createElement('div');
            emojiSection.style.cssText = 'margin-bottom: 24px;';

            const emojiTitle = document.createElement('h3');
            emojiTitle.textContent = i18n("statsCheckInDistrib");
            emojiTitle.style.marginBottom = '12px';
            emojiSection.appendChild(emojiTitle);

            const emojiGrid = document.createElement('div');
            emojiGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;';

            emojiStats.forEach(stat => {
                const card = document.createElement('div');
                card.style.cssText = 'padding: 12px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center; display: flex; flex-direction: column; align-items: center;';
                card.innerHTML = `
                    <div style="font-size: 32px; margin-bottom: 8px;">${stat.emoji}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-bottom: 4px;">${stat.count}次</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 8px;">${stat.percentage.toFixed(1)}%</div>
                    <div style="width: 60px; height: 80px; background: var(--b3-theme-surface-lighter); border-radius: 4px; position: relative; margin-top: auto;">
                        <div style="width: 100%; height: ${stat.percentage}%; background: #40c463; border-radius: 4px; position: absolute; bottom: 0; transition: height 0.3s ease;"></div>
                    </div>
                `;
                emojiGrid.appendChild(card);
            });

            emojiSection.appendChild(emojiGrid);
            container.appendChild(emojiSection);
        }

        // 月度视图
        const monthlyContainer = document.createElement('div');
        container.appendChild(monthlyContainer);
        this.renderMonthlyView(monthlyContainer);

        // 年度视图
        const yearlyContainer = document.createElement('div');
        container.appendChild(yearlyContainer);
        this.renderYearlyView(yearlyContainer);
    }

    private calculateStreak(): number {
        if (!this.habit.checkIns || Object.keys(this.habit.checkIns).length === 0) {
            return 0;
        }

        // 只统计达标的日期
        const completedDates = Object.keys(this.habit.checkIns)
            .filter(dateStr => this.isCheckInComplete(dateStr))
            .sort()
            .reverse();

        if (completedDates.length === 0) {
            return 0;
        }

        const today = this.formatLocalDate(new Date());
        let streak = 0;
        let currentDate = new Date(today);

        for (const dateStr of completedDates) {
            const checkDate = new Date(dateStr);
            const dayDiff = Math.floor((currentDate.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24));

            if (dayDiff === streak) {
                streak++;
            } else if (dayDiff > streak) {
                break;
            }
        }

        return streak;
    }

    private formatLocalDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 判断某天的打卡是否完成（达标）
     * @param dateStr 日期字符串 YYYY-MM-DD
     * @returns true表示达标，false表示未达标或未打卡
     */
    private isCheckInComplete(dateStr: string): boolean {
        const checkIn = this.habit.checkIns?.[dateStr];
        if (!checkIn) return false;

        // 获取当天所有打卡的emoji
        const emojis: string[] = [];
        if (checkIn.entries && checkIn.entries.length > 0) {
            // 使用新格式的entries
            checkIn.entries.forEach(entry => {
                if (entry.emoji) emojis.push(entry.emoji);
            });
        } else if (checkIn.status && checkIn.status.length > 0) {
            // 使用旧格式的status
            emojis.push(...checkIn.status);
        }

        // 过滤出认为是成功打卡的emoji
        const successEmojis = emojis.filter(emoji => {
            const emojiConfig = this.habit.checkInEmojis?.find(e => e.emoji === emoji);
            // 如果找不到配置或countsAsSuccess未定义，默认认为是成功打卡
            return emojiConfig ? (emojiConfig.countsAsSuccess !== false) : true;
        });

        const successCount = successEmojis.length;
        const target = this.habit.target || 1;
        return successCount >= target;
    }

    private calculateEmojiStats(): Array<{ emoji: string; count: number; percentage: number }> {
        const emojiCount: Record<string, number> = {};
        let total = 0;

        Object.values(this.habit.checkIns || {}).forEach(checkIn => {
            (checkIn.status || []).forEach(emoji => {
                emojiCount[emoji] = (emojiCount[emoji] || 0) + 1;
                total++;
            });
        });

        return Object.entries(emojiCount).map(([emoji, count]) => ({
            emoji,
            count,
            percentage: total === 0 ? 0 : (count / total) * 100
        })).sort((a, b) => b.count - a.count);
    }

    private renderMonthlyView(container: HTMLElement) {
        container.innerHTML = '';
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 24px;';

        // 月视图工具栏（只在月度视图显示）
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px; justify-content:center;';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'b3-button';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', () => {
            this.currentMonthDate.setMonth(this.currentMonthDate.getMonth() - 1);
            this.renderMonthlyView(container);
        });

        const todayBtn = document.createElement('button');
        todayBtn.className = 'b3-button';
        todayBtn.textContent = i18n("today");
        todayBtn.addEventListener('click', () => {
            this.currentMonthDate = new Date();
            this.renderMonthlyView(container);
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'b3-button';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', () => {
            this.currentMonthDate.setMonth(this.currentMonthDate.getMonth() + 1);
            this.renderMonthlyView(container);
        });

        const dateLabel = document.createElement('span');
        dateLabel.style.cssText = 'font-weight:bold; margin-left:8px;';
        dateLabel.textContent = this.getMonthLabel();

        toolbar.appendChild(prevBtn);
        toolbar.appendChild(todayBtn);
        toolbar.appendChild(nextBtn);
        toolbar.appendChild(dateLabel);

        const title = document.createElement('h3');
        title.textContent = i18n("statsMonthlyView");
        title.style.cssText = 'margin:0;';

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
        titleRow.appendChild(title);
        titleRow.appendChild(toolbar);
        section.appendChild(titleRow);

        const monthGrid = document.createElement('div');
        monthGrid.style.cssText = 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;';

        // 获取当前月份的所有日期
        const now = this.currentMonthDate || new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = this.formatLocalDate(date);
            const checkIn = this.habit.checkIns?.[dateStr];
            const isComplete = this.isCheckInComplete(dateStr);

            // 根据打卡状态设置背景色：达标为绿色，未达标为橙色，未打卡为默认
            let backgroundColor = 'var(--b3-theme-surface)';
            if (checkIn) {
                backgroundColor = isComplete ? 'var(--b3-theme-primary-lighter)' : 'rgba(250, 200, 88, 0.3)';
            }

            const dayCell = document.createElement('div');
            dayCell.style.cssText = `
                aspect-ratio: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                font-size: 12px;
                background: ${backgroundColor};
                border: 1px solid var(--b3-theme-surface-lighter);
            `;

            // 显示日期以及状态 emoji（支持多行、自动缩放字体）
            const contentWrap = document.createElement('div');
            contentWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; width:100%; height:100%; padding:6px; box-sizing:border-box; overflow:hidden;';

            const dateSpan = document.createElement('div');
            dateSpan.textContent = String(day);
            dateSpan.style.cssText = 'font-size:12px; color: var(--b3-theme-on-surface-light); width:100%; text-align:center;';
            contentWrap.appendChild(dateSpan);

            if (checkIn) {
                // 优先使用 entries（包含时间与备注），否则回退到旧的 status 数组
                const entries = checkIn.entries && checkIn.entries.length > 0 ? checkIn.entries : undefined;
                const statuses = entries ? entries.map(e => e.emoji).filter(Boolean) : (checkIn.status || []).filter(Boolean);
                const count = statuses.length;

                // 根据 emoji 数量计算字体大小
                let fontSize = 18;
                if (count > 12) fontSize = 10;
                else if (count > 8) fontSize = 12;
                else if (count > 4) fontSize = 14;
                else fontSize = 18;

                const emojiContainer = document.createElement('div');
                emojiContainer.style.cssText = `display:flex; flex-wrap:wrap; gap:2px; justify-content:center; align-items:center; width:100%;`;

                if (entries) {
                    // 每条 entry 都可能包含备注 note 与 timestamp
                    entries.forEach(entry => {
                        const span = document.createElement('span');
                        span.textContent = entry.emoji || '';
                        const timeText = entry.timestamp ? entry.timestamp : '';
                        const noteText = entry.note ? entry.note : '';
                        const titleParts = [] as string[];
                        if (timeText) titleParts.push(timeText);
                        if (noteText) titleParts.push(noteText);
                        span.title = titleParts.length > 0 ? `${entry.emoji || ''} - ${titleParts.join(' / ')}` : (entry.emoji || '');
                        span.style.cssText = `font-size:${fontSize}px; line-height:1;`; // 自动换行
                        emojiContainer.appendChild(span);
                    });

                    contentWrap.appendChild(emojiContainer);
                    const checkInCount = checkIn.count || 0;
                    const target = this.habit.target || 1;
                    const statusText = isComplete ? i18n("habitComplete") : `${checkInCount}/${target}`;
                    // 将每条 entry 的 emoji 与备注合并到 title 中，便于鼠标悬停查看
                    const entrySummary = entries.map(e => e.note ? `${e.emoji} (${e.note})` : e.emoji).join(' ');
                    dayCell.title = `${day}: ${entrySummary}\n${statusText}`;
                } else if (statuses.length > 0) {
                    statuses.forEach(s => {
                        const span = document.createElement('span');
                        span.textContent = s;
                        span.title = s;
                        span.style.cssText = `font-size:${fontSize}px; line-height:1;`;
                        emojiContainer.appendChild(span);
                    });

                    contentWrap.appendChild(emojiContainer);
                    const checkInCount = checkIn.count || 0;
                    const target = this.habit.target || 1;
                    const statusText = isComplete ? i18n("habitComplete") : `${checkInCount}/${target}`;
                    dayCell.title = `${day}: ${statuses.join(' ')}\n${statusText}`;
                } else {
                    const emptyPlaceholder = document.createElement('div');
                    emptyPlaceholder.style.cssText = 'width:12px; height:12px; border-radius:50%; background:var(--b3-theme-surface); margin-top:4px;';
                    contentWrap.appendChild(emptyPlaceholder);
                }
            } else {
                const emptyPlaceholder = document.createElement('div');
                emptyPlaceholder.style.cssText = 'width:12px; height:12px; border-radius:50%; background:var(--b3-theme-surface); margin-top:4px;';
                contentWrap.appendChild(emptyPlaceholder);
            }

            dayCell.appendChild(contentWrap);

            // 单击进入该日的历史打卡管理（快速添加/编辑）
            dayCell.addEventListener('click', (e) => {
                e.stopPropagation();
                const dayDialog = new HabitDayDialog(this.habit, dateStr, async (updatedHabit) => {
                    if (this.onSave) {
                        await this.onSave(updatedHabit);
                    } else {
                        this.habit = updatedHabit;
                    }
                    this.renderMonthlyView(container);
                });
                dayDialog.show();
            });

            monthGrid.appendChild(dayCell);
        }

        section.appendChild(monthGrid);
        container.appendChild(section);
    }

    private getMonthLabel(): string {
        const now = this.currentMonthDate || new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1);
        return i18n("monthLabelFormat", { year: String(year), month });
    }

    private renderYearlyView(container: HTMLElement) {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 24px;';

        // 年视图工具栏
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px; justify-content:center;';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'b3-button';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', () => {
            this.yearViewOffset--;
            this.rerenderYearlyView(container);
        });

        const todayBtn = document.createElement('button');
        todayBtn.className = 'b3-button';
        todayBtn.textContent = i18n("today");
        todayBtn.addEventListener('click', () => {
            this.yearViewOffset = 0;
            this.rerenderYearlyView(container);
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'b3-button';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', () => {
            this.yearViewOffset++;
            this.rerenderYearlyView(container);
        });

        const now = new Date();
        const year = now.getFullYear() + this.yearViewOffset;

        const dateLabel = document.createElement('span');
        dateLabel.style.cssText = 'font-weight:bold; margin-left:8px;';
        dateLabel.textContent = i18n("yearLabelFormat", { year: String(year) });

        toolbar.appendChild(prevBtn);
        toolbar.appendChild(todayBtn);
        toolbar.appendChild(nextBtn);
        toolbar.appendChild(dateLabel);

        const title = document.createElement('h3');
        title.textContent = i18n("habitYearlyView");
        title.style.cssText = 'margin:0;';

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
        titleRow.appendChild(title);
        titleRow.appendChild(toolbar);
        section.appendChild(titleRow);

        const yearGrid = document.createElement('div');
        yearGrid.style.cssText = 'display: grid; grid-template-columns: repeat(12, 1fr); gap: 8px;';

        for (let month = 0; month < 12; month++) {
            const monthCard = document.createElement('div');
            monthCard.style.cssText = 'padding: 8px; background: var(--b3-theme-surface); border-radius: 4px;';

            const monthName = document.createElement('div');
            monthName.textContent = i18n("monthNames").split(',')[month];
            monthName.style.cssText = 'font-size: 12px; font-weight: bold; margin-bottom: 4px; text-align: center;';
            monthCard.appendChild(monthName);

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            let checkInCount = 0;

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = this.formatLocalDate(date);
                // 只统计达标的打卡天数
                if (this.isCheckInComplete(dateStr)) {
                    checkInCount++;
                }
            }

            const countDiv = document.createElement('div');
            countDiv.textContent = `${checkInCount}${i18n("habitDays")}`;
            countDiv.style.cssText = 'font-size: 16px; font-weight: bold; text-align: center; color: var(--b3-theme-primary);';
            monthCard.appendChild(countDiv);

            yearGrid.appendChild(monthCard);
        }

        section.appendChild(yearGrid);
        container.appendChild(section);

        // 热力图容器
        const heatmapSection = document.createElement('div');
        heatmapSection.style.cssText = 'margin-top: 24px;';

        const heatmapTitle = document.createElement('h3');
        heatmapTitle.textContent = i18n("habitYearlyHeatmap");
        heatmapTitle.style.marginBottom = '12px';
        heatmapSection.appendChild(heatmapTitle);

        const heatmapContainer = document.createElement('div');
        heatmapContainer.style.cssText = 'width: 100%; height: 180px;';
        heatmapContainer.id = 'habitYearlyHeatmap';
        heatmapSection.appendChild(heatmapContainer);

        container.appendChild(heatmapSection);

        // 渲染热力图
        setTimeout(() => {
            this.renderYearlyHeatmap(heatmapContainer, year);
        }, 100);
    }

    private rerenderYearlyView(container: HTMLElement) {
        // 清空容器并重新渲染
        container.innerHTML = '';
        this.destroyCharts();
        this.renderYearlyView(container);
    }

    private renderYearlyHeatmap(container: HTMLElement, year: number) {
        const chart = init(container);
        this.chartInstances.push(chart);

        // 准备热力图数据
        const heatmapData: Array<[string, number]> = [];
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year, 11, 31);

        for (let d = new Date(yearStart); d <= yearEnd; d.setDate(d.getDate() + 1)) {
            const dateStr = this.formatLocalDate(new Date(d));
            const checkIn = this.habit.checkIns?.[dateStr];
            // 只有达标的打卡才计入热力图（未达标显示为0）
            const isComplete = this.isCheckInComplete(dateStr);
            const count = isComplete ? (checkIn.status?.length || 1) : 0;
            heatmapData.push([dateStr, count]);
        }

        // 计算最大值用于颜色映射
        const maxCount = Math.max(...heatmapData.map(d => d[1]), 1);

        const option: echarts.EChartsOption = {
            tooltip: {
                trigger: 'item',
                formatter: (params: any) => {
                    const date = params.data[0];
                    const count = params.data[1];
                    const dateObj = new Date(date);
                    const formattedDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
                    if (count === 0) {
                        return `${formattedDate}<br/>${i18n("habitNoCheckIn")}`;
                    }
                    return `${formattedDate}<br/>${i18n("habitCheckInCount")}: ${count}`;
                }
            },
            visualMap: {
                min: 0,
                max: maxCount,
                calculable: false,
                hoverLink: false,
                orient: 'horizontal',
                left: 'center',
                bottom: 0,
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
                top: 20,
                left: 40,
                right: 20,
                bottom: 40,
                cellSize: 13,
                range: year,
                itemStyle: {
                    borderWidth: 2,
                    borderColor: 'transparent',
                    borderRadius: 2
                },
                yearLabel: { show: false },
                dayLabel: {
                    firstDay: 1,
                    nameMap: i18n("calendarWeekNames").split(','),
                    fontSize: 10
                },
                monthLabel: {
                    nameMap: i18n("monthNames").split(','),
                    fontSize: 11
                },
                splitLine: {
                    show: false
                }
            },
            series: [{
                type: 'heatmap',
                coordinateSystem: 'calendar',
                data: heatmapData,
                itemStyle: {
                    borderRadius: 2
                }
            }]
        };

        chart.setOption(option);

        // 响应式
        const resizeObserver = new ResizeObserver(() => {
            if (chart && !chart.isDisposed()) {
                chart.resize();
            }
        });
        resizeObserver.observe(container);
        this.resizeObservers.push(resizeObserver);
    }

    // ==================== 时间统计 Tab ====================

    private renderTimeStats(container: HTMLElement) {
        // 销毁之前的图表实例
        this.destroyCharts();

        // 视图切换按钮
        const viewSelector = document.createElement('div');
        viewSelector.style.cssText = 'display: flex; gap: 8px; margin-bottom: 16px; align-items: center;';

        const views: Array<{ key: 'week' | 'month' | 'year', label: string }> = [
            { key: 'week', label: i18n("habitTimeWeekView") },
            { key: 'month', label: i18n("habitTimeMonthView") },
            { key: 'year', label: i18n("habitTimeYearView") }
        ];

        views.forEach(view => {
            const btn = document.createElement('button');
            btn.className = `b3-button ${this.currentTimeView !== view.key ? 'b3-button--outline' : ''}`;
            btn.textContent = view.label;
            btn.style.cssText = this.currentTimeView === view.key ? 'font-weight: bold;' : '';
            btn.addEventListener('click', () => {
                this.currentTimeView = view.key;
                this.timeViewOffset = 0;
                this.renderTimeStats(container);
            });
            viewSelector.appendChild(btn);
        });

        // 导航按钮
        const navContainer = document.createElement('div');
        navContainer.style.cssText = 'display: flex; gap: 8px; margin-left: auto; align-items: center;';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'b3-button';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', () => {
            this.timeViewOffset--;
            this.renderTimeStats(container);
        });

        const todayBtn = document.createElement('button');
        todayBtn.className = 'b3-button';
        todayBtn.textContent = i18n("today");
        todayBtn.addEventListener('click', () => {
            this.timeViewOffset = 0;
            this.renderTimeStats(container);
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'b3-button';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', () => {
            this.timeViewOffset++;
            this.renderTimeStats(container);
        });

        const dateRangeLabel = document.createElement('span');
        dateRangeLabel.style.cssText = 'font-weight: bold; margin-left: 8px;';
        dateRangeLabel.textContent = this.getTimeViewDateRange();

        navContainer.appendChild(prevBtn);
        navContainer.appendChild(todayBtn);
        navContainer.appendChild(nextBtn);
        navContainer.appendChild(dateRangeLabel);

        viewSelector.appendChild(navContainer);
        container.innerHTML = '';
        container.appendChild(viewSelector);

        // 图表容器
        const chartContainer = document.createElement('div');
        chartContainer.style.cssText = 'width: 100%; height: 500px; margin-top: 16px;';
        chartContainer.id = 'habitTimeChart';
        container.appendChild(chartContainer);

        // 根据视图渲染图表
        setTimeout(() => {
            switch (this.currentTimeView) {
                case 'week':
                    this.renderWeekTimeChart(chartContainer);
                    break;
                case 'month':
                    this.renderMonthTimeChart(chartContainer);
                    break;
                case 'year':
                    this.renderYearTimeChart(chartContainer);
                    break;
            }
        }, 100);
    }

    private getTimeViewDateRange(): string {
        const now = new Date();

        switch (this.currentTimeView) {
            case 'week': {
                const weekStart = this.getWeekStart(now);
                weekStart.setDate(weekStart.getDate() + this.timeViewOffset * 7);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                return `${this.formatLocalDate(weekStart)} ~ ${this.formatLocalDate(weekEnd)}`;
            }
            case 'month': {
                const targetMonth = new Date(now.getFullYear(), now.getMonth() + this.timeViewOffset, 1);
                return i18n("monthLabelFormat", { year: String(targetMonth.getFullYear()), month: String(targetMonth.getMonth() + 1) });
            }
            case 'year': {
                const targetYear = now.getFullYear() + this.timeViewOffset;
                return i18n("yearLabelFormat", { year: String(targetYear) });
            }
        }
    }

    private getWeekStart(date: Date): Date {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 周一为一周开始
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    private getCheckInTimeData(): Array<{ date: string; emoji: string; time: string; hour: number }> {
        const data: Array<{ date: string; emoji: string; time: string; hour: number }> = [];

        Object.entries(this.habit.checkIns || {}).forEach(([dateStr, checkIn]) => {
            // 优先使用 entries（详细记录）
            if (checkIn.entries && checkIn.entries.length > 0) {
                checkIn.entries.forEach(entry => {
                    if (entry.timestamp) {
                        const time = this.extractTimeFromTimestamp(entry.timestamp);
                        if (time) {
                            data.push({
                                date: dateStr,
                                emoji: entry.emoji,
                                time: time,
                                hour: parseInt(time.split(':')[0])
                            });
                        }
                    }
                });
            } else if (checkIn.timestamp && checkIn.status && checkIn.status.length > 0) {
                // 兼容旧格式：只有一个时间戳
                const time = this.extractTimeFromTimestamp(checkIn.timestamp);
                if (time) {
                    checkIn.status.forEach(emoji => {
                        data.push({
                            date: dateStr,
                            emoji: emoji,
                            time: time,
                            hour: parseInt(time.split(':')[0])
                        });
                    });
                }
            }
        });

        return data;
    }

    private extractTimeFromTimestamp(timestamp: string): string | null {
        // 支持格式: "2024-12-01 10:30:45" 或 "2024-12-01T10:30:45" 或 ISO格式
        const match = timestamp.match(/(\d{2}):(\d{2})/);
        if (match) {
            return `${match[1]}:${match[2]}`;
        }
        return null;
    }

    private renderWeekTimeChart(container: HTMLElement) {
        const chart = init(container);
        this.chartInstances.push(chart);

        const now = new Date();
        const weekStart = this.getWeekStart(now);
        weekStart.setDate(weekStart.getDate() + this.timeViewOffset * 7);

        // 获取本周日期
        const weekDates: string[] = [];
        const weekLabels: string[] = [];
        const weekdayNamesArr = i18n("weekdayNames").split(',');
        const dayNames = [
            weekdayNamesArr[1], weekdayNamesArr[2], weekdayNamesArr[3],
            weekdayNamesArr[4], weekdayNamesArr[5], weekdayNamesArr[6], weekdayNamesArr[0]
        ];

        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            weekDates.push(this.formatLocalDate(d));
            weekLabels.push(`${dayNames[i]}\n${d.getMonth() + 1}/${d.getDate()}`);
        }

        // 获取打卡数据
        const allData = this.getCheckInTimeData();
        const weekData = allData.filter(d => weekDates.includes(d.date));

        // 获取所有emoji及其颜色
        const emojiSet = new Set<string>();
        weekData.forEach(d => emojiSet.add(d.emoji));
        const emojis = Array.from(emojiSet);
        const colors = this.generateColors(emojis.length);

        // 构建散点数据: [x时间(小时), y日期索引, emoji索引]
        const seriesData: Array<{ emoji: string; data: Array<[number, number, string]> }> = emojis.map((emoji) => ({
            emoji,
            data: weekData
                .filter(d => d.emoji === emoji)
                .map(d => {
                    const dateIdx = weekDates.indexOf(d.date);
                    const timeParts = d.time.split(':');
                    const hour = parseInt(timeParts[0]) + parseInt(timeParts[1]) / 60;
                    return [hour, dateIdx, d.time] as [number, number, string];
                })
        }));

        const option: echarts.EChartsOption = {
            title: {
                text: i18n("habitTimeWeekChartTitle"),
                left: 'center',
                top: 10
            },
            tooltip: {
                trigger: 'item',
                formatter: (params: any) => {
                    const dateLabel = weekLabels[params.data[1]];
                    const time = params.data[2];
                    const meaning = this.getEmojiMeaning(params.seriesName);
                    return `${params.seriesName} ${meaning}<br/>${dateLabel.replace('\n', ' ')}<br/>${i18n("habitCheckInTime")}: ${time}`;
                }
            },
            legend: {
                data: emojis,
                bottom: 10,
                type: 'scroll',
                formatter: (name: string) => `${name} ${this.getEmojiMeaning(name)}`
            },
            grid: {
                left: 80,
                right: 40,
                top: 60,
                bottom: 60
            },
            xAxis: {
                type: 'value',
                name: i18n("habitTimeAxisLabel"),
                min: 0,
                max: 24,
                interval: 2,
                axisLabel: {
                    formatter: (value: number) => `${Math.floor(value)}:00`
                }
            },
            yAxis: {
                type: 'category',
                data: weekLabels,
                inverse: true
            },
            series: seriesData.map((s, idx) => ({
                name: s.emoji,
                type: 'scatter',
                symbolSize: 20,
                data: s.data,
                itemStyle: {
                    color: 'transparent'
                },
                label: {
                    show: true,
                    formatter: s.emoji,
                    position: 'inside',
                    fontSize: 16,
                    color: colors[idx]
                }
            }))
        };

        chart.setOption(option);

        // 响应式
        const resizeObserver = new ResizeObserver(() => {
            if (chart && !chart.isDisposed()) {
                chart.resize();
            }
        });
        resizeObserver.observe(container);
        this.resizeObservers.push(resizeObserver);
    }

    private renderMonthTimeChart(container: HTMLElement) {
        const chart = init(container);
        this.chartInstances.push(chart);

        const now = new Date();
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + this.timeViewOffset, 1);
        const year = targetMonth.getFullYear();
        const month = targetMonth.getMonth();

        // 获取本月所有日期
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthDates: string[] = [];
        for (let d = 1; d <= daysInMonth; d++) {
            monthDates.push(this.formatLocalDate(new Date(year, month, d)));
        }

        // 获取打卡数据
        const allData = this.getCheckInTimeData();
        const monthData = allData.filter(d => monthDates.includes(d.date));

        // 按emoji分组，统计每个小时的打卡次数
        const emojiSet = new Set<string>();
        monthData.forEach(d => emojiSet.add(d.emoji));
        const emojis = Array.from(emojiSet);

        if (emojis.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 100px; color: var(--b3-theme-on-surface-light);">${i18n("noData")}</div>`;
            return;
        }

        // 统计每个emoji在每个小时的打卡次数
        const emojiHourlyStats: Record<string, number[]> = {};
        const emojiTotalCount: Record<string, number> = {};
        emojis.forEach(emoji => {
            emojiHourlyStats[emoji] = new Array(24).fill(0);
            emojiTotalCount[emoji] = 0;
        });

        monthData.forEach(d => {
            const hour = parseInt(d.time.split(':')[0]);
            if (hour >= 0 && hour < 24) {
                emojiHourlyStats[d.emoji][hour]++;
            }
            emojiTotalCount[d.emoji]++;
        });

        // 构建 custom series 数据
        const series: any[] = [];
        const colors = this.generateColors(emojis.length);

        emojis.forEach((emoji, emojiIdx) => {
            const data: Array<[number, number, number, number, string]> = [];

            for (let hour = 0; hour < 24; hour++) {
                const count = emojiHourlyStats[emoji][hour];
                if (count > 0) {
                    data.push([
                        hour,       // x轴：开始小时
                        emojiIdx,   // y轴：emoji索引
                        hour + 1,   // 结束小时
                        count,      // 总次数
                        emoji       // emoji
                    ]);
                }
            }

            if (data.length > 0) {
                // 计算该emoji的最大次数用于颜色深度
                const maxCount = Math.max(...data.map(d => d[3]));

                series.push({
                    name: emoji,
                    type: 'custom',
                    renderItem: (_params: any, api: any) => {
                        const start = api.value(0);
                        const end = api.value(2);
                        const count = api.value(3);
                        const yIndex = api.value(1);
                        const y = api.coord([0, yIndex])[1];
                        const startX = api.coord([start, 0])[0];
                        const endX = api.coord([end, 0])[0];

                        // 根据打卡次数调整高度和透明度
                        const intensity = count / maxCount;
                        const height = 20 + intensity * 15;
                        const opacity = 0.5 + intensity * 0.5;

                        return {
                            type: 'rect',
                            shape: {
                                x: startX,
                                y: y - height / 2,
                                width: Math.max(endX - startX - 2, 4),
                                height: height
                            },
                            style: {
                                fill: colors[emojiIdx],
                                opacity: opacity
                            }
                        };
                    },
                    data: data,
                    tooltip: {
                        formatter: (params: any) => {
                            const hour = params.value[0];
                            const count = params.value[3];
                            const emoji = params.value[4];
                            const meaning = this.getEmojiMeaning(emoji);
                            return `${emoji} ${meaning}<br/>${hour}:00 - ${hour + 1}:00<br/>${i18n("habitCheckInCount")}: ${count}`;
                        }
                    }
                });
            }
        });

        const option: echarts.EChartsOption = {
            title: {
                text: i18n("habitTimeMonthChartTitle"),
                left: 'center',
                top: 10
            },
            tooltip: {
                trigger: 'item'
            },
            legend: {
                data: emojis,
                bottom: 5,
                type: 'scroll',
                formatter: (name: string) => `${name} ${this.getEmojiMeaning(name)}`
            },
            grid: {
                left: 60,
                right: 40,
                top: 60,
                bottom: 80
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: 24,
                interval: 2,
                axisLabel: {
                    formatter: (value: number) => `${value}:00`
                },
                name: i18n("habitTimeAxisLabel"),
                nameLocation: 'middle',
                nameGap: 25
            },
            yAxis: {
                type: 'category',
                data: emojis,
                axisLabel: {
                    fontSize: 14,
                    formatter: (value: string) => `${value} (${emojiTotalCount[value] || 0})`
                },
                axisTick: {
                    length: 0
                }
            },
            series: series
        };

        chart.setOption(option);

        // 响应式
        const resizeObserver = new ResizeObserver(() => {
            if (chart && !chart.isDisposed()) {
                chart.resize();
            }
        });
        resizeObserver.observe(container);
        this.resizeObservers.push(resizeObserver);
    }

    private renderYearTimeChart(container: HTMLElement) {
        const chart = init(container);
        this.chartInstances.push(chart);

        const now = new Date();
        const targetYear = now.getFullYear() + this.timeViewOffset;

        // 获取本年所有日期
        const yearStart = new Date(targetYear, 0, 1);
        const yearEnd = new Date(targetYear, 11, 31);
        const yearDates: string[] = [];
        for (let d = new Date(yearStart); d <= yearEnd; d.setDate(d.getDate() + 1)) {
            yearDates.push(this.formatLocalDate(new Date(d)));
        }

        // 获取打卡数据
        const allData = this.getCheckInTimeData();
        const yearData = allData.filter(d => yearDates.includes(d.date));

        // 按emoji分组，统计每个小时的打卡次数
        const emojiSet = new Set<string>();
        yearData.forEach(d => emojiSet.add(d.emoji));
        const emojis = Array.from(emojiSet);

        if (emojis.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 100px; color: var(--b3-theme-on-surface-light);">${i18n("noData")}</div>`;
            return;
        }

        // 统计每个emoji在每个小时的打卡次数
        const emojiHourlyStats: Record<string, number[]> = {};
        const emojiTotalCount: Record<string, number> = {};
        emojis.forEach(emoji => {
            emojiHourlyStats[emoji] = new Array(24).fill(0);
            emojiTotalCount[emoji] = 0;
        });

        yearData.forEach(d => {
            const hour = parseInt(d.time.split(':')[0]);
            if (hour >= 0 && hour < 24) {
                emojiHourlyStats[d.emoji][hour]++;
            }
            emojiTotalCount[d.emoji]++;
        });

        // 构建 custom series 数据
        const series: any[] = [];
        const colors = this.generateColors(emojis.length);

        emojis.forEach((emoji, emojiIdx) => {
            const data: Array<[number, number, number, number, string]> = [];

            for (let hour = 0; hour < 24; hour++) {
                const count = emojiHourlyStats[emoji][hour];
                if (count > 0) {
                    data.push([
                        hour,       // x轴：开始小时
                        emojiIdx,   // y轴：emoji索引
                        hour + 1,   // 结束小时
                        count,      // 总次数
                        emoji       // emoji
                    ]);
                }
            }

            if (data.length > 0) {
                // 计算该emoji的最大次数用于颜色深度
                const maxCount = Math.max(...data.map(d => d[3]));

                series.push({
                    name: emoji,
                    type: 'custom',
                    renderItem: (_params: any, api: any) => {
                        const start = api.value(0);
                        const end = api.value(2);
                        const count = api.value(3);
                        const yIndex = api.value(1);
                        const y = api.coord([0, yIndex])[1];
                        const startX = api.coord([start, 0])[0];
                        const endX = api.coord([end, 0])[0];

                        // 根据打卡次数调整高度和透明度
                        const intensity = count / maxCount;
                        const height = 20 + intensity * 15;
                        const opacity = 0.5 + intensity * 0.5;

                        return {
                            type: 'rect',
                            shape: {
                                x: startX,
                                y: y - height / 2,
                                width: Math.max(endX - startX - 2, 4),
                                height: height
                            },
                            style: {
                                fill: colors[emojiIdx],
                                opacity: opacity
                            }
                        };
                    },
                    data: data,
                    tooltip: {
                        formatter: (params: any) => {
                            const hour = params.value[0];
                            const count = params.value[3];
                            const emoji = params.value[4];
                            const meaning = this.getEmojiMeaning(emoji);
                            return `${emoji} ${meaning}<br/>${hour}:00 - ${hour + 1}:00<br/>${i18n("habitCheckInCount")}: ${count}`;
                        }
                    }
                });
            }
        });

        const option: echarts.EChartsOption = {
            title: {
                text: i18n("habitTimeYearChartTitle"),
                left: 'center',
                top: 10
            },
            tooltip: {
                trigger: 'item'
            },
            legend: {
                data: emojis,
                bottom: 5,
                type: 'scroll',
                formatter: (name: string) => `${name} ${this.getEmojiMeaning(name)}`
            },
            grid: {
                left: 60,
                right: 40,
                top: 60,
                bottom: 80
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: 24,
                interval: 2,
                axisLabel: {
                    formatter: (value: number) => `${value}:00`
                },
                name: i18n("habitTimeAxisLabel"),
                nameLocation: 'middle',
                nameGap: 25
            },
            yAxis: {
                type: 'category',
                data: emojis,
                axisLabel: {
                    fontSize: 14,
                    formatter: (value: string) => `${value} (${emojiTotalCount[value] || 0})`
                },
                axisTick: {
                    length: 0
                }
            },
            series: series
        };

        chart.setOption(option);

        // 响应式
        const resizeObserver = new ResizeObserver(() => {
            if (chart && !chart.isDisposed()) {
                chart.resize();
            }
        });
        resizeObserver.observe(container);
        this.resizeObservers.push(resizeObserver);
    }

    private generateColors(count: number): string[] {
        const baseColors = [
            '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
            '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0',
            '#ff9f7f', '#87c4ff', '#ffb980', '#d4a5a5', '#a5d4a5'
        ];

        const colors: string[] = [];
        for (let i = 0; i < count; i++) {
            colors.push(baseColors[i % baseColors.length]);
        }
        return colors;
    }

    // 根据emoji获取其含义
    private getEmojiMeaning(emoji: string): string {
        const emojiConfig = this.habit.checkInEmojis.find(e => e.emoji === emoji);
        return emojiConfig?.meaning || emoji;
    }
}
