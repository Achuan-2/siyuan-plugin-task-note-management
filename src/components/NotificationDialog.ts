import { t } from "../utils/i18n";
import { openTab } from "siyuan";
import { getLogicalDateString } from "../utils/dateUtils";
import { openBlock } from "../api"

interface ReminderInfo {
    id: string;
    blockId: string;
    title: string;
    note?: string;
    priority: string;
    categoryId?: string;
    categoryName?: string;
    categoryColor?: string;
    categoryIcon?: string;
    time?: string;
    date: string;
    endDate?: string;
    isAllDay?: boolean;
}

export class NotificationDialog {
    private element: HTMLElement;
    private static instances: NotificationDialog[] = [];
    private static readonly MAX_NOTIFICATIONS = 5;
    private reminderInfo: ReminderInfo | ReminderInfo[];
    private isAllDayBatch: boolean = false;

    constructor(reminderInfo: ReminderInfo | ReminderInfo[], isAllDayBatch: boolean = false) {
        this.reminderInfo = reminderInfo;
        this.isAllDayBatch = isAllDayBatch;
        this.createElement();
        this.show();
        NotificationDialog.instances.push(this);

        // 限制同时显示的通知数量
        if (NotificationDialog.instances.length > NotificationDialog.MAX_NOTIFICATIONS) {
            const oldestNotification = NotificationDialog.instances.shift();
            if (oldestNotification) {
                oldestNotification.destroy();
            }
        }
    }

    private createElement() {
        this.element = document.createElement('div');
        this.element.className = 'reminder-notification';

        if (this.isAllDayBatch && Array.isArray(this.reminderInfo)) {
            this.createAllDayBatchContent();
        } else if (!Array.isArray(this.reminderInfo)) {
            this.createSingleReminderContent();
        }

        // 添加样式
        this.addStyles();

        // 绑定关闭事件
        const closeBtn = this.element.querySelector('.notification-close') as HTMLButtonElement;
        closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.destroy();
        });

        // 绑定跳转事件
        this.bindJumpEvents();
    }

    private createSingleReminderContent() {
        const reminder = this.reminderInfo as ReminderInfo;
        const { title, note, priority, categoryName, categoryColor, categoryIcon, time, date, endDate, isAllDay } = reminder;

        const priorityClass = priority !== 'none' ? `priority-${priority}` : '';

        // 构建时间显示
        let timeDisplay = '';
        if (isAllDay) {
            timeDisplay = endDate && endDate !== date ?
                `${date} → ${endDate} (全天)` :
                `${date} (全天)`;
        } else if (time) {
            timeDisplay = endDate && endDate !== date ?
                `${date} → ${endDate} ${time}` :
                `${date} ${time}`;
        } else {
            timeDisplay = endDate && endDate !== date ?
                `${date} → ${endDate}` :
                `${date}`;
        }

        // 构建分类显示
        let categoryDisplay = '';
        if (categoryName) {
            const icon = categoryIcon ? `${categoryIcon} ` : '';
            categoryDisplay = `
                <div class="notification-category">
                    <div class="category-dot" style="background-color: ${categoryColor || '#666'};"></div>
                    <span>${icon}${categoryName}</span>
                </div>
            `;
        }

        // 构建优先级显示
        let priorityDisplay = '';
        if (priority !== 'none') {
            const priorityText = priority === 'high' ? t("highPriority") :
                priority === 'medium' ? t("mediumPriority") :
                    priority === 'low' ? t("lowPriority") : '';
            priorityDisplay = `
                <div class="notification-priority">
                    <div class="priority-dot ${priority}"></div>
                    <span>${priorityText}</span>
                </div>
            `;
        }

        this.element.innerHTML = `
            <div class="notification-content ${priorityClass}">
                <div class="notification-header">
                    <div class="notification-icon">
                        <svg><use xlink:href="#iconClock"></use></svg>
                    </div>
                    <div class="notification-title-container">
                        <div class="notification-title" data-block-id="${reminder.blockId}">${this.escapeHtml(title)}</div>
                        <div class="notification-time">${timeDisplay}</div>
                    </div>
                    <button class="notification-close" aria-label="${t('close')}">
                        <svg><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                
                <div class="notification-meta">
                    ${priorityDisplay}
                    ${categoryDisplay}
                </div>
                
                ${note ? `<div class="notification-note">${this.escapeHtml(note)}</div>` : ''}
            </div>
        `;
    }

    private createAllDayBatchContent() {
        const reminders = this.reminderInfo as ReminderInfo[];
        const today = getLogicalDateString(); // 使用本地时间获取今日日期

        // 构建时间显示的辅助函数
        const getTimeDisplay = (reminder: ReminderInfo) => {
            if (reminder.isAllDay) {
                if (reminder.endDate && reminder.endDate !== reminder.date) {
                    return `${reminder.date} → ${reminder.endDate} (全天)`;
                }
                return '全天';
            } else if (reminder.time) {
                if (reminder.endDate && reminder.endDate !== reminder.date) {
                    return `${reminder.date} ${reminder.time} → ${reminder.endDate}`;
                }
                return reminder.time;
            } else {
                if (reminder.endDate && reminder.endDate !== reminder.date) {
                    return `${reminder.date} → ${reminder.endDate}`;
                }
                return '全天';
            }
        };

        // 判断是否过期 - 修改为考虑跨天事件的结束日期
        const isOverdue = (reminder: ReminderInfo) => {
            // 如果有结束日期，使用结束日期判断；否则使用开始日期
            const effectiveDate = reminder.endDate || reminder.date;
            return effectiveDate < today;
        };

        // 获取优先级文字
        const getPriorityText = (priority: string) => {
            return priority === 'high' ? '高' :
                priority === 'medium' ? '中' :
                    priority === 'low' ? '低' : '';
        };

        // 对提醒进行分类和排序
        const overdueReminders = reminders.filter(r => isOverdue(r));
        const todayTimedReminders = reminders.filter(r => !isOverdue(r) && !r.isAllDay && r.time);
        const todayAllDayReminders = reminders.filter(r => !isOverdue(r) && r.isAllDay);
        const todayNoTimeReminders = reminders.filter(r => !isOverdue(r) && !r.isAllDay && !r.time);

        // 对每个分类内部排序
        overdueReminders.sort((a, b) => a.date.localeCompare(b.date));
        todayTimedReminders.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        todayAllDayReminders.sort((a, b) => a.title.localeCompare(b.title));
        todayNoTimeReminders.sort((a, b) => a.title.localeCompare(b.title));

        // 合并排序后的数组
        const sortedReminders = [...overdueReminders, ...todayAllDayReminders, ...todayNoTimeReminders, ...todayTimedReminders,];

        this.element.innerHTML = `
            <div class="notification-content all-day-batch">
                <div class="notification-header">
                    <div class="notification-icon">
                        <svg><use xlink:href="#iconCalendar"></use></svg>
                    </div>
                    <div class="notification-title-container">
                        <div class="notification-title">今日事件 (${reminders.length})</div>
                        <div class="notification-time">${new Date().toLocaleDateString('zh-CN')}</div>
                    </div>
                    <button class="notification-close" aria-label="${t('close')}">
                        <svg><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                
                <div class="all-day-reminders-list">
                    ${sortedReminders.map(reminder => {
            const isReminderOverdue = isOverdue(reminder);
            const priorityText = getPriorityText(reminder.priority);
            const priorityClass = reminder.priority !== 'none' ? `priority-${reminder.priority}` : '';
            return `
                        <div class="all-day-reminder-item ${isReminderOverdue ? 'overdue' : ''} ${priorityClass}" data-block-id="${reminder.blockId}">
                            <div class="item-header">
                                <div class="item-title">
                                    ${isReminderOverdue ? '<span class="overdue-tag">过期</span>' : ''}
                                    ${this.escapeHtml(reminder.title)}
                                </div>
                                <div class="item-meta">
                                    ${reminder.priority !== 'none' ? `
                                        <div class="priority-indicator">
                                            <div class="priority-dot ${reminder.priority}"></div>
                                            <span class="priority-text">${priorityText}</span>
                                        </div>
                                    ` : ''}
                                    ${reminder.categoryName ? `
                                        <div class="category-indicator">
                                            <div class="category-dot" style="background-color: ${reminder.categoryColor || '#666'};"></div>
                                            <span>${reminder.categoryIcon ? `${reminder.categoryIcon} ` : ''}${reminder.categoryName}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="item-time ${isReminderOverdue ? 'overdue-time' : ''}">${getTimeDisplay(reminder)}</div>
                            ${reminder.note ? `<div class="item-note">${this.escapeHtml(reminder.note)}</div>` : ''}
                        </div>
                    `;
        }).join('')}
                </div>
            </div>
        `;
    }

    private bindJumpEvents() {
        if (this.isAllDayBatch) {
            // 为每个全天事件项绑定跳转事件
            const reminderItems = this.element.querySelectorAll('.all-day-reminder-item');
            reminderItems.forEach(item => {
                const titleElement = item.querySelector('.item-title') as HTMLElement;
                titleElement.style.cursor = 'pointer';
                titleElement.style.textDecoration = 'underline';
                titleElement.style.color = 'var(--b3-theme-primary)';

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const blockId = item.getAttribute('data-block-id');
                    if (blockId) {
                        this.jumpToBlock(blockId);
                    }
                });
            });
        } else {
            // 单个提醒的跳转事件
            const titleElement = this.element.querySelector('.notification-title') as HTMLElement;
            if (titleElement) {
                titleElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const blockId = titleElement.getAttribute('data-block-id');
                    if (blockId) {
                        this.jumpToBlock(blockId);
                    }
                });

                titleElement.style.cursor = 'pointer';
                titleElement.style.textDecoration = 'underline';
                titleElement.style.color = 'var(--b3-theme-primary)';
            }
        }
    }

    private addStyles() {
        if (document.querySelector('#reminder-notification-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'reminder-notification-styles';
        styles.textContent = `
            .reminder-notification {
                position: fixed;
                top: 20px;
                right: 50px;
                width: 350px;
                max-width: 300px;
                min-width: 300px;
                z-index: 200;
                animation: slideInRight 0.3s ease-out;
                margin-bottom: 10px;
                pointer-events: none;
            }

            .notification-content {
                background: var(--b3-theme-background);
                border: 1px solid var(--b3-theme-border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 12px;
                transition: all 0.2s ease;
                overflow: hidden;
                pointer-events: auto;
            }

            .notification-content:hover {
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
                transform: translateY(-1px);
            }

            .notification-content.all-day-batch {
                width: 300px;
                max-width: 300px;
                max-height: 400px;
                overflow-y: auto;
            }

            .notification-content.priority-high {
                border-left: 4px solid var(--b3-card-error-color) !important;
                background-color: var(--b3-card-error-background) !important;
            }

            .notification-content.priority-medium {
                border-left: 4px solid var(--b3-card-warning-color) !important;
                background-color: var(--b3-card-warning-background) !important;
            }

            .notification-content.priority-low {
                border-left: 4px solid var(--b3-card-info-color) !important;
                background-color: var(--b3-card-info-background) !important;
            }

            .notification-header {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 8px;
            }

            .notification-icon {
                flex-shrink: 0;
                color: var(--b3-theme-primary);
                margin-top: 2px;
            }

            .notification-icon svg {
                width: 16px;
                height: 16px;
            }

            .notification-title-container {
                flex: 1;
                min-width: 0;
            }

            .notification-title {
                font-weight: 500;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                margin-bottom: 4px;
                cursor: pointer;
                text-decoration: underline;
                transition: color 0.2s ease;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 100%;
                pointer-events: auto;
            }

            .notification-title:hover {
                color: var(--b3-theme-primary-light);
            }

            .notification-time {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                line-height: 1.3;
            }

            .notification-close {
                flex-shrink: 0;
                background: none;
                border: none;
                cursor: pointer;
                padding: 2px;
                border-radius: 4px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                transition: all 0.2s ease;
                pointer-events: auto;
            }

            .notification-close:hover {
                opacity: 1;
                background: var(--b3-theme-surface-lighter);
            }

            .notification-close svg {
                width: 14px;
                height: 14px;
            }

            .notification-meta {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 8px;
                flex-wrap: wrap;
            }

            .notification-priority {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: var(--b3-theme-on-surface);
            }

            .notification-priority .priority-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .notification-priority .priority-dot.high {
                background-color: var(--b3-card-error-color);
            }

            .notification-priority .priority-dot.medium {
                background-color: var(--b3-card-warning-color);
            }

            .notification-priority .priority-dot.low {
                background-color: var(--b3-card-info-color);
            }

            .notification-category {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: var(--b3-theme-on-surface);
            }

            .notification-category .category-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }

            .notification-note {
                color: var(--b3-theme-on-surface);
                font-size: 12px;
                line-height: 1.4;
                margin-top: 8px;
                padding: 8px;
                background: var(--b3-theme-surface);
                border-radius: 4px;
                border-left: 3px solid var(--b3-theme-primary-lighter);
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                text-overflow: ellipsis;
            }

            /* 全天事件列表样式 */
            .all-day-reminders-list {
                border-top: 1px solid var(--b3-theme-border);
                padding-top: 12px;
                max-height: 300px;
                overflow-y: auto;
            }

            .all-day-reminder-item {
                padding: 8px;
                margin-bottom: 8px;
                border-radius: 6px;
                background: var(--b3-theme-surface);
                border-left: 3px solid var(--b3-theme-primary-lighter);
                cursor: pointer;
                transition: all 0.2s ease;
                pointer-events: auto;
            }

            .all-day-reminder-item.priority-high {
                border-left-color: var(--b3-card-error-color) !important;
                background-color: var(--b3-card-error-background) !important;
            }

            .all-day-reminder-item.priority-medium {
                border-left-color: var(--b3-card-warning-color) !important;
                background-color: var(--b3-card-warning-background) !important;
            }

            .all-day-reminder-item.priority-low {
                border-left-color: var(--b3-card-info-color) !important;
                background-color: var(--b3-card-info-background) !important;
            }

            .all-day-reminder-item:hover {
                background: var(--b3-theme-surface-light);
            }

            .all-day-reminder-item.priority-high:hover {
                background-color: rgba(var(--b3-card-error-color-rgb), 0.15) !important;
            }

            .all-day-reminder-item.priority-medium:hover {
                background-color: rgba(var(--b3-card-warning-color-rgb), 0.15) !important;
            }

            .all-day-reminder-item.priority-low:hover {
                background-color: rgba(var(--b3-card-info-color-rgb), 0.15) !important;
            }

            .item-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 4px;
            }

            .item-title {
                font-weight: 500;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .item-meta {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }

            .item-meta .priority-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }

            .item-meta .priority-dot.high {
                background-color: var(--b3-card-error-color);
            }

            .item-meta .priority-dot.medium {
                background-color: var(--b3-card-warning-color);
            }

            .item-meta .priority-dot.low {
                background-color: var(--b3-card-info-color);
            }

            .category-indicator,.priority-indicator {
                display: flex;
                align-items: center;
                gap: 3px;
                font-size: 11px;
                color: var(--b3-theme-on-surface);
                max-width: 80px;
                overflow: hidden;
            }

            .category-indicator span {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .item-duration {
                font-size: 11px;
                color: var(--b3-theme-on-surface);
                margin-bottom: 4px;
            }

            .item-time {
                font-size: 11px;
                color: var(--b3-theme-on-surface);
                margin-bottom: 4px;
                font-weight: 500;
                background: var(--b3-theme-surface-lighter);
                padding: 2px 6px;
                border-radius: 3px;
                display: inline-block;
            }

            .item-time.overdue-time {
                color: var(--b3-card-error-color);
                background: rgba(var(--b3-card-error-color-rgb), 0.1);
            }

            .all-day-reminder-item.overdue {
                // border-left-color: var(--b3-card-error-color);
                // background: rgba(var(--b3-card-error-color-rgb), 0.05);
            }

            .all-day-reminder-item.overdue .item-title {
                color: var(--b3-card-error-color);
            }

            .overdue-tag {
                background: var(--b3-card-error-color);
                color: white;
                font-size: 10px;
                padding: 1px 4px;
                border-radius: 2px;
                margin-right: 4px;
                font-weight: 500;
            }

            .item-note {
                font-size: 11px;
                color: var(--b3-theme-on-surface);
                line-height: 1.3;
                padding: 4px 8px;
                background: var(--b3-theme-background);
                border-radius: 4px;
                margin-top: 4px;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                text-overflow: ellipsis;
            }

            /* 优先级对应的备注样式 - 全天事件项 */
            .all-day-reminder-item.priority-high .item-note {
                color: var(--b3-card-error-color) !important;
                background-color: rgba(var(--b3-card-error-color-rgb), 0.1) !important;
            }

            .all-day-reminder-item.priority-medium .item-note {
                color: var(--b3-card-warning-color) !important;
                background-color: rgba(var(--b3-card-warning-color-rgb), 0.1) !important;
            }

            .all-day-reminder-item.priority-low .item-note {
                color: var(--b3-card-info-color) !important;
                background-color: rgba(var(--b3-card-info-color-rgb), 0.1) !important;
            }

            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }

            .reminder-notification.closing {
                animation: slideOutRight 0.3s ease-in;
            }

            /* 多个通知时的堆叠效果 */
            .reminder-notification:nth-last-child(2) {
                transform: translateX(-5px) scale(0.98);
                opacity: 0.9;
            }

            .reminder-notification:nth-last-child(3) {
                transform: translateX(-10px) scale(0.96);
                opacity: 0.8;
            }

            .reminder-notification:nth-last-child(4) {
                transform: translateX(-15px) scale(0.94);
                opacity: 0.7;
            }

            .reminder-notification:nth-last-child(n+5) {
                transform: translateX(-20px) scale(0.92);
                opacity: 0.6;
            }
        `;
        document.head.appendChild(styles);
    }

    private async jumpToBlock(blockId?: string) {
        try {
            const targetBlockId = blockId || (this.reminderInfo as ReminderInfo).blockId;
            // 跳转到指定块
            openBlock(targetBlockId);

            // 关闭通知
            this.destroy();
        } catch (error) {
            console.error('跳转到块失败:', error);
        }
    }

    private show() {
        document.body.appendChild(this.element);

        // 调整已存在通知的位置
        this.updateNotificationPositions();
    }

    private updateNotificationPositions() {
        const notifications = document.querySelectorAll('.reminder-notification');
        notifications.forEach((notification, index) => {
            const element = notification as HTMLElement;
            element.style.bottom = `${20 + index * 100}px`; // 增加间距以容纳更多信息
        });
    }

    private destroy() {
        const index = NotificationDialog.instances.indexOf(this);
        if (index > -1) {
            NotificationDialog.instances.splice(index, 1);
        }

        this.element.classList.add('closing');
        setTimeout(() => {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            // 重新调整剩余通知的位置
            this.updateNotificationPositions();
        }, 300);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 静态方法：显示单个通知
    static show(reminderInfo: ReminderInfo) {
        return new NotificationDialog(reminderInfo, false);
    }

    // 静态方法：显示全天事件批量通知
    static showAllDayReminders(reminders: ReminderInfo[]) {
        return new NotificationDialog(reminders, true);
    }

    // 静态方法：清除所有通知
    static clearAll() {
        NotificationDialog.instances.forEach(instance => instance.destroy());
        NotificationDialog.instances = [];
    }
}
