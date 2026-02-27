import { Dialog } from "siyuan";
import { Habit } from "./HabitPanel";
import { DEFAULT_SETTINGS } from "../index";
import { i18n } from "../pluginInstance";

export class HabitCalendarDialog {
    private plugin: any;
    private dialog: Dialog;
    private currentView: 'week' | 'month' = 'week';
    private currentDate: Date = new Date();
    private draggedHabitId: string | null = null;
    private habitOrder: string[] = [];

    constructor(plugin?: any) {
        this.plugin = plugin;
        this.loadHabitOrder();
    }

    show() {
        this.dialog = new Dialog({
            title: i18n("calendarTitle"),
            content: '<div id="habitCalendarContainer"></div>',
            width: "1100px",
            height: "81vh"
        });

        const container = this.dialog.element.querySelector('#habitCalendarContainer') as HTMLElement;
        if (!container) return;

        // 禁止内容编辑
        container.contentEditable = 'false';

        this.renderCalendar(container);
    }

    private async renderCalendar(container: HTMLElement) {
        container.innerHTML = ''; // 清空容器以避免累积内容
        container.className = 'habit-calendar-container';

        // 读取习惯数据和排序
        const habitData = await this.plugin.loadHabitData();
        const habits: Habit[] = Object.values(habitData || {});

        // 初始化或更新习惯顺序
        if (this.habitOrder.length === 0 || this.habitOrder.length !== habits.length) {
            this.habitOrder = habits.map(h => h.id);
        }

        // 按照保存的顺序排序习惯
        const sortedHabits = this.sortHabitsByOrder(habits);

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'habit-calendar-toolbar';

        // 视图切换 - 滑动开关样式
        const viewToggle = document.createElement('div');
        viewToggle.className = 'habit-calendar-view-toggle';

        const weekBtn = document.createElement('button');
        weekBtn.className = this.currentView === 'week' ? 'view-toggle-btn active' : 'view-toggle-btn';
        weekBtn.textContent = i18n("habitCalendarWeekView");
        weekBtn.addEventListener('click', () => {
            this.currentView = 'week';
            this.renderCalendar(container);
        });

        const monthBtn = document.createElement('button');
        monthBtn.className = this.currentView === 'month' ? 'view-toggle-btn active' : 'view-toggle-btn';
        monthBtn.textContent = i18n("habitCalendarMonthView");
        monthBtn.addEventListener('click', () => {
            this.currentView = 'month';
            this.renderCalendar(container);
        });

        viewToggle.appendChild(weekBtn);
        viewToggle.appendChild(monthBtn);

        toolbar.appendChild(viewToggle);

        // 导航按钮
        const navigation = document.createElement('div');
        navigation.className = 'habit-calendar-navigation';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'b3-button';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', () => {
            if (this.currentView === 'week') {
                this.currentDate.setDate(this.currentDate.getDate() - 7);
            } else {
                this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            }
            this.renderCalendar(container);
        });

        const todayBtn = document.createElement('button');
        todayBtn.className = 'b3-button';
        todayBtn.textContent = i18n("today");
        todayBtn.addEventListener('click', () => {
            this.currentDate = new Date();
            this.renderCalendar(container);
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'b3-button';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', () => {
            if (this.currentView === 'week') {
                this.currentDate.setDate(this.currentDate.getDate() + 7);
            } else {
                this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            }
            this.renderCalendar(container);
        });

        // 获取weekStartDay设置（默认周一）
        let weekStartDay = DEFAULT_SETTINGS.weekStartDay ?? 1;
        try {
            if (this.plugin && typeof this.plugin.loadSettings === 'function') {
                const settings = await this.plugin.loadSettings();
                if (settings && typeof settings.weekStartDay === 'number') {
                    weekStartDay = settings.weekStartDay;
                }
            }
        } catch (err) {
            console.warn('获取周开始日配置失败，使用默认值', err);
        }

        const dateLabel = document.createElement('span');
        dateLabel.className = 'habit-calendar-date-label';
        dateLabel.textContent = this.getDateRangeLabel(weekStartDay);

        navigation.appendChild(prevBtn);
        navigation.appendChild(todayBtn);
        navigation.appendChild(dateLabel);
        navigation.appendChild(nextBtn);

        toolbar.appendChild(viewToggle);
        toolbar.appendChild(navigation);

        container.appendChild(toolbar);

        // 日历内容
        const calendarContent = document.createElement('div');
        calendarContent.className = 'habit-calendar-content';

        if (this.currentView === 'week') {
            this.renderWeekView(calendarContent, sortedHabits, weekStartDay);
        } else {
            this.renderMonthView(calendarContent, sortedHabits);
        }

        container.appendChild(calendarContent);
    }

    private getDateRangeLabel(weekStartDay: number = DEFAULT_SETTINGS.weekStartDay): string {
        if (this.currentView === 'week') {
            const weekStart = new Date(this.currentDate);
            const offset = (weekStart.getDay() - (weekStartDay ?? DEFAULT_SETTINGS.weekStartDay) + 7) % 7;
            weekStart.setDate(weekStart.getDate() - offset);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            return i18n("calendarDateRangeWeek", {
                year: String(weekStart.getFullYear()),
                m1: String(weekStart.getMonth() + 1),
                d1: String(weekStart.getDate()),
                m2: String(weekEnd.getMonth() + 1),
                d2: String(weekEnd.getDate())
            });
        } else {
            return i18n("calendarDateRangeMonth", {
                year: String(this.currentDate.getFullYear()),
                month: String(this.currentDate.getMonth() + 1)
            });
        }
    }

    private renderWeekView(container: HTMLElement, habits: Habit[], weekStartDay: number = DEFAULT_SETTINGS.weekStartDay) {
        const grid = document.createElement('div');
        grid.className = 'habit-calendar-grid week-view';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = '150px repeat(7, 1fr)';
        grid.style.gap = '8px';

        // 表头
        const habitHeader = document.createElement('div');
        habitHeader.className = 'grid-header habit-header';
        habitHeader.contentEditable = 'false';
        habitHeader.textContent = i18n("habitColumnHeader");
        grid.appendChild(habitHeader);

        const weekStart = new Date(this.currentDate);
        // 根据用户设置的周开始日计算本周起始日期
        const offset = (weekStart.getDay() - (weekStartDay ?? DEFAULT_SETTINGS.weekStartDay) + 7) % 7;
        weekStart.setDate(weekStart.getDate() - offset);

        const weekdayNamesArr = i18n("calendarWeekNames").split(',');
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const th = document.createElement('div');
            th.className = 'grid-header date-header';
            th.contentEditable = 'false';
            const weekday = (weekStartDay + i) % 7;
            th.textContent = `${weekdayNamesArr[weekday]} ${date.getMonth() + 1}/${date.getDate()}`;
            grid.appendChild(th);
        }

        // 表体
        habits.forEach((habit, habitIndex) => {
            const nameCell = document.createElement('div');
            nameCell.className = 'grid-cell habit-name-cell';
            nameCell.contentEditable = 'false';
            nameCell.textContent = habit.title;
            nameCell.draggable = true;
            nameCell.dataset.habitId = habit.id;
            nameCell.dataset.habitIndex = String(habitIndex);

            // 拖拽事件
            this.addDragListeners(nameCell, habit);

            grid.appendChild(nameCell);

            for (let i = 0; i < 7; i++) {
                const date = new Date(weekStart);
                date.setDate(date.getDate() + i);
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

                const cell = document.createElement('div');
                cell.className = 'grid-cell date-cell';
                cell.contentEditable = 'false';

                const checkIn = habit.checkIns?.[dateStr];
                if (checkIn && checkIn.status && checkIn.status.length > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'date-badge';

                    const statuses = checkIn.status.filter(Boolean);

                    // 根据emoji数量添加不同的class
                    if (statuses.length >= 7) {
                        badge.classList.add('count-many');
                    } else if (statuses.length >= 4) {
                        badge.classList.add(`count-${statuses.length}`);
                    } else if (statuses.length >= 2) {
                        badge.classList.add(`count-${statuses.length}`);
                    }

                    // 兼容旧逻辑
                    if (statuses.length > 1) {
                        badge.classList.add('multi');
                    }

                    // 显示所有emoji
                    statuses.forEach(s => {
                        const span = document.createElement('span');
                        span.className = 'emoji';
                        span.textContent = s;
                        badge.appendChild(span);
                    });
                    cell.appendChild(badge);
                } else {
                    cell.classList.add('empty');
                    // 空状态也可以有一个占位圆圈
                    const emptyBadge = document.createElement('div');
                    emptyBadge.className = 'date-badge empty-badge';
                    cell.appendChild(emptyBadge);
                }

                grid.appendChild(cell);
            }
        });

        container.appendChild(grid);
    }

    private renderMonthView(container: HTMLElement, habits: Habit[]) {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const grid = document.createElement('div');
        grid.className = 'habit-calendar-grid month-view';
        grid.style.display = 'grid';
        // 增加最小宽度到60px以容纳多个emoji
        grid.style.gridTemplateColumns = `150px repeat(${daysInMonth}, minmax(60px, 1fr))`;
        grid.style.gap = '8px';

        // 表头
        const habitHeader = document.createElement('div');
        habitHeader.className = 'grid-header habit-header';
        habitHeader.contentEditable = 'false';
        habitHeader.textContent = i18n("habitColumnHeader");
        grid.appendChild(habitHeader);

        for (let day = 1; day <= daysInMonth; day++) {
            const th = document.createElement('div');
            th.className = 'grid-header date-header';
            th.contentEditable = 'false';
            th.textContent = String(day);
            grid.appendChild(th);
        }

        // 表体
        habits.forEach((habit, habitIndex) => {
            const nameCell = document.createElement('div');
            nameCell.className = 'grid-cell habit-name-cell';
            nameCell.contentEditable = 'false';
            nameCell.textContent = habit.title;
            nameCell.draggable = true;
            nameCell.dataset.habitId = habit.id;
            nameCell.dataset.habitIndex = String(habitIndex);

            // 拖拽事件
            this.addDragListeners(nameCell, habit);

            grid.appendChild(nameCell);

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

                const cell = document.createElement('div');
                cell.className = 'grid-cell date-cell';
                cell.contentEditable = 'false';

                const checkIn = habit.checkIns?.[dateStr];
                if (checkIn && checkIn.status && checkIn.status.length > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'date-badge';

                    const statuses = checkIn.status.filter(Boolean);

                    // 根据emoji数量添加不同的class
                    if (statuses.length >= 7) {
                        badge.classList.add('count-many');
                    } else if (statuses.length >= 4) {
                        badge.classList.add(`count-${statuses.length}`);
                    } else if (statuses.length >= 2) {
                        badge.classList.add(`count-${statuses.length}`);
                    }

                    // 兼容旧逻辑
                    if (statuses.length > 1) {
                        badge.classList.add('multi');
                    }

                    // 显示所有emoji
                    statuses.forEach(s => {
                        const span = document.createElement('span');
                        span.className = 'emoji';
                        span.textContent = s;
                        badge.appendChild(span);
                    });
                    cell.appendChild(badge);
                } else {
                    cell.classList.add('empty');
                    const emptyBadge = document.createElement('div');
                    emptyBadge.className = 'date-badge empty-badge';
                    cell.appendChild(emptyBadge);
                }

                grid.appendChild(cell);
            }
        });

        container.appendChild(grid);
    }

    /**
     * 按照保存的顺序排序习惯
     */
    private sortHabitsByOrder(habits: Habit[]): Habit[] {
        if (!this.habitOrder || this.habitOrder.length === 0) {
            return habits;
        }

        const sorted = [];
        const habitMap = new Map(habits.map(h => [h.id, h]));

        // 先按保存的顺序添加
        for (const id of this.habitOrder) {
            if (habitMap.has(id)) {
                sorted.push(habitMap.get(id)!);
                habitMap.delete(id);
            }
        }

        // 添加新增的习惯（不在顺序列表中的）
        for (const habit of habitMap.values()) {
            sorted.push(habit);
        }

        return sorted;
    }

    /**
     * 添加拖拽监听器
     */
    private addDragListeners(element: HTMLElement, habit: Habit) {
        element.addEventListener('dragstart', (e: DragEvent) => {
            this.draggedHabitId = habit.id;
            element.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', habit.id);
            }
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedHabitId = null;
            // 移除所有drop-target类
            const container = this.dialog.element.querySelector('.habit-calendar-content');
            if (container) {
                container.querySelectorAll('.drop-target-top, .drop-target-bottom').forEach(el => {
                    el.classList.remove('drop-target-top', 'drop-target-bottom');
                });
            }
        });

        element.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (this.draggedHabitId && this.draggedHabitId !== habit.id) {
                // 计算鼠标在元素中的相对位置
                const rect = element.getBoundingClientRect();
                const mouseY = e.clientY;
                const elementMiddle = rect.top + rect.height / 2;

                // 移除之前的类
                element.classList.remove('drop-target-top', 'drop-target-bottom');

                // 根据鼠标位置添加不同的类
                if (mouseY < elementMiddle) {
                    element.classList.add('drop-target-top');
                } else {
                    element.classList.add('drop-target-bottom');
                }

                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
            }
        });

        element.addEventListener('dragleave', () => {
            element.classList.remove('drop-target-top', 'drop-target-bottom');
        });

        element.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            element.classList.remove('drop-target-top', 'drop-target-bottom');

            if (!this.draggedHabitId || this.draggedHabitId === habit.id) {
                return;
            }

            // 计算鼠标在元素中的相对位置
            const rect = element.getBoundingClientRect();
            const mouseY = e.clientY;
            const elementMiddle = rect.top + rect.height / 2;
            const insertBefore = mouseY < elementMiddle;

            // 更新习惯顺序
            const draggedIndex = this.habitOrder.indexOf(this.draggedHabitId);
            let targetIndex = this.habitOrder.indexOf(habit.id);

            if (draggedIndex !== -1 && targetIndex !== -1) {
                // 移除被拖拽的项
                const [draggedId] = this.habitOrder.splice(draggedIndex, 1);

                // 重新计算目标索引（因为移除可能改变了索引）
                targetIndex = this.habitOrder.indexOf(habit.id);

                // 根据鼠标位置决定插入位置
                if (insertBefore) {
                    // 插入到目标之前
                    this.habitOrder.splice(targetIndex, 0, draggedId);
                } else {
                    // 插入到目标之后
                    this.habitOrder.splice(targetIndex + 1, 0, draggedId);
                }

                // 保存新的顺序
                await this.saveHabitOrder();

                // 重新渲染 - 获取正确的容器元素
                const container = this.dialog.element.querySelector('#habitCalendarContainer') as HTMLElement;
                if (container) {
                    this.renderCalendar(container);
                }
            }
        });
    }

    /**
     * 保存习惯顺序到localStorage
     */
    private async saveHabitOrder() {
        try {
            localStorage.setItem('habit-calendar-order', JSON.stringify(this.habitOrder));
        } catch (err) {
            console.error('保存习惯顺序失败:', err);
        }
    }

    /**
     * 从localStorage加载习惯顺序
     */
    private loadHabitOrder() {
        try {
            const saved = localStorage.getItem('habit-calendar-order');
            if (saved) {
                this.habitOrder = JSON.parse(saved);
            }
        } catch (err) {
            console.error('加载习惯顺序失败:', err);
            this.habitOrder = [];
        }
    }
}
