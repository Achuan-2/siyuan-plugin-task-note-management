import { Dialog, showMessage, confirm } from "siyuan";
import { getBlockByID, updateBindBlockAtrrs, getBlockReminderIds } from "../api";
// import { getLocalDateTimeString, getRelativeDateString } from "../utils/dateUtils";
import { getLocaleTag } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";

/**
 * 块绑定任务查看对话框
 * 显示绑定到特定块的所有任务，支持完成和删除操作
 */
export class BlockRemindersDialog {
    private dialog: Dialog;
    private blockId: string;
    private plugin: any;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private today: string;
    private reminderUpdatedHandler: (event: CustomEvent) => void;

    constructor(blockId: string, plugin: any) {
        this.blockId = blockId;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance();
        this.projectManager = ProjectManager.getInstance(plugin);
        this.today = new Date().toISOString().split('T')[0];
    }

    async show() {
        try {
            // 确保 ProjectManager 已初始化
            await this.projectManager.initialize();

            // 获取块信息
            const block = await getBlockByID(this.blockId);
            if (!block) {
                showMessage("块不存在", 3000, "error");
                return;
            }

            // 获取绑定的提醒ID
            const reminderIds = await getBlockReminderIds(this.blockId);
            if (reminderIds.length === 0) {
                showMessage("该块没有绑定任务", 3000, "info");
                return;
            }

            // 获取提醒数据
            const reminderData = await this.plugin.loadReminderData();
            const reminders = reminderIds
                .map(id => reminderData[id])
                .filter(r => r); // 过滤掉不存在的提醒

            if (reminders.length === 0) {
                showMessage("该块没有绑定任务", 3000, "info");
                return;
            }

            // 创建对话框
            this.dialog = new Dialog({
                title: `块绑定任务 - ${block.content.substring(0, 30)}${block.content.length > 30 ? '...' : ''}`,
                content: `<div id="blockRemindersContent" style="min-height: 200px; max-height: 500px; overflow-y: auto;padding: 20px;"></div>`,
                width: "600px",
                height: "auto",
                destroyCallback: () => {
                    if (this.reminderUpdatedHandler) {
                        window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
                    }
                }
            });

            // 监听提醒更新事件
            this.reminderUpdatedHandler = async () => {
                const updatedReminderData = await this.plugin.loadReminderData();
                const updatedReminderIds = await getBlockReminderIds(this.blockId);
                const updatedReminders = updatedReminderIds
                    .map(id => updatedReminderData[id])
                    .filter(r => r);
                const updatedContainer = this.dialog.element.querySelector("#blockRemindersContent") as HTMLElement;
                if (updatedContainer) {
                    await this.renderReminders(updatedContainer, updatedReminders);
                }
            };
            window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);

            // 渲染任务列表
            const container = this.dialog.element.querySelector("#blockRemindersContent") as HTMLElement;
            this.renderReminders(container, reminders);

        } catch (error) {
            console.error("显示块绑定任务失败:", error);
            showMessage("加载失败", 3000, "error");
        }
    }

    private async renderReminders(container: HTMLElement, reminders: any[]) {
        container.innerHTML = '';

        if (reminders.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--b3-theme-on-surface-light);">该块没有绑定任务</div>`;
            return;
        }

        // 按完成状态分组
        const incompleteReminders = reminders.filter(r => !r.completed);
        const completedReminders = reminders.filter(r => r.completed);

        // 渲染未完成任务
        if (incompleteReminders.length > 0) {
            const incompleteSection = document.createElement('div');
            incompleteSection.style.marginBottom = '20px';

            const incompleteTitle = document.createElement('h3');
            incompleteTitle.textContent = `未完成 (${incompleteReminders.length})`;
            incompleteTitle.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 10px; color: var(--b3-theme-on-surface);';
            incompleteSection.appendChild(incompleteTitle);

            for (const reminder of incompleteReminders) {
                const item = await this.createReminderItem(reminder, false);
                incompleteSection.appendChild(item);
            }

            container.appendChild(incompleteSection);
        }

        // 渲染已完成任务
        if (completedReminders.length > 0) {
            const completedSection = document.createElement('div');

            const completedTitle = document.createElement('h3');
            completedTitle.textContent = `已完成 (${completedReminders.length})`;
            completedTitle.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 10px; color: var(--b3-theme-on-surface); opacity: 0.7;';
            completedSection.appendChild(completedTitle);

            for (const reminder of completedReminders) {
                const item = await this.createReminderItem(reminder, true);
                completedSection.appendChild(item);
            }

            container.appendChild(completedSection);
        }
    }

    private async createReminderItem(reminder: any, isCompleted: boolean): Promise<HTMLElement> {
        const item = document.createElement('div');
        item.className = 'reminder-item';

        // 优先级设置
        const priority = reminder.priority || 'none';
        let backgroundColor = '';
        let borderColor = '';
        switch (priority) {
            case 'high':
                backgroundColor = 'var(--b3-card-error-background)';
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = 'var(--b3-card-warning-background)';
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = 'var(--b3-card-info-background)';
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = 'var(--b3-theme-surface-lighter)';
                borderColor = 'var(--b3-theme-surface-lighter)';
        }
        item.style.backgroundColor = backgroundColor;
        item.style.border = `2px solid ${borderColor}`;
        item.style.borderRadius = '4px';
        item.style.padding = '12px';
        item.style.marginBottom = '8px';

        if (isCompleted) {
            item.style.opacity = '0.5';
        }

        const contentEl = document.createElement('div');
        contentEl.className = 'reminder-item__content';
        contentEl.style.display = 'flex';
        contentEl.style.alignItems = 'flex-start';
        contentEl.style.gap = '8px';

        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isCompleted;
        checkbox.style.marginTop = '2px';
        checkbox.style.flexShrink = '0';
        checkbox.addEventListener('change', async () => {
            await this.toggleReminderComplete(reminder, checkbox.checked);
        });
        contentEl.appendChild(checkbox);

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'reminder-item__info';
        infoEl.style.flex = '1';
        infoEl.style.minWidth = '0';

        // 标题
        const titleEl = document.createElement('div');
        titleEl.className = 'reminder-item__title';
        titleEl.textContent = reminder.title || '无标题';
        titleEl.style.fontSize = '14px';
        titleEl.style.fontWeight = '500';
        titleEl.style.marginBottom = '4px';
        titleEl.style.wordBreak = 'break-word';
        if (isCompleted) {
            titleEl.style.textDecoration = 'line-through';
        }
        infoEl.appendChild(titleEl);

        // 时间容器
        const timeContainer = document.createElement('div');
        timeContainer.className = 'reminder-item__time-container';
        timeContainer.style.display = 'flex';
        timeContainer.style.alignItems = 'center';
        timeContainer.style.gap = '8px';
        timeContainer.style.marginBottom = '4px';
        timeContainer.style.flexWrap = 'wrap';

        // 重复图标
        if (reminder.repeat?.enabled) {
            const repeatIcon = document.createElement('span');
            repeatIcon.textContent = '🔄';
            repeatIcon.title = '重复任务';
            timeContainer.appendChild(repeatIcon);
        }

        // 时间信息
        if (reminder.date) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-item__time';
            const timeText = this.formatReminderTime(reminder.date, reminder.time, this.today, reminder.endDate, reminder.endTime);
            timeEl.textContent = '🗓' + timeText;
            timeEl.style.fontSize = '12px';
            timeEl.style.color = 'var(--b3-theme-on-surface-light)';
            timeContainer.appendChild(timeEl);

            const countdownEl = this.createReminderCountdownElement(reminder);
            if (countdownEl) {
                timeContainer.appendChild(countdownEl);
            }
        }

        infoEl.appendChild(timeContainer);

        // 已完成时间
        if (isCompleted && reminder.completedAt) {
            const completedEl = document.createElement('div');
            completedEl.className = 'reminder-item__completed-time';
            completedEl.textContent = `✅ ${this.formatCompletedTime(reminder.completedAt)}`;
            completedEl.style.fontSize = '12px';
            completedEl.style.marginTop = '4px';
            completedEl.style.opacity = '0.95';
            infoEl.appendChild(completedEl);
        }

        // 备注
        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';
            noteEl.textContent = reminder.note;
            noteEl.style.fontSize = '12px';
            noteEl.style.color = 'var(--b3-theme-on-surface-light)';
            noteEl.style.marginTop = '4px';
            infoEl.appendChild(noteEl);
        }

        // 项目信息
        if (reminder.projectId) {
            try {
                const project = this.projectManager.getProjectById(reminder.projectId);
                if (project) {
                    const projectInfo = document.createElement('div');
                    projectInfo.className = 'reminder-item__project';
                    projectInfo.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        font-size: 11px;
                        background-color: ${project.color}20;
                        color: ${project.color};
                        border: 1px solid ${project.color}40;
                        border-radius: 12px;
                        padding: 2px 8px;
                        margin-top: 4px;
                        font-weight: 500;
                    `;

                    if (project.icon) {
                        const iconSpan = document.createElement('span');
                        iconSpan.textContent = project.icon;
                        iconSpan.style.fontSize = '10px';
                        projectInfo.appendChild(iconSpan);
                    }

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = '📂' + project.name;
                    projectInfo.appendChild(nameSpan);

                    infoEl.appendChild(projectInfo);
                }
            } catch (error) {
                console.error('加载项目信息失败:', error);
            }
        }

        // 分类标签（支持多分类）
        if (reminder.categoryId) {
            const categoryIds = typeof reminder.categoryId === 'string' ? reminder.categoryId.split(',') : [reminder.categoryId];
            const categoriesContainer = document.createElement('div');
            categoriesContainer.className = 'reminder-item__categories';
            categoriesContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            let hasValidCategory = false;
            categoryIds.forEach((catId: string) => {
                const id = catId.trim();
                if (!id) return;

                const category = this.categoryManager.getCategoryById(id);
                if (category) {
                    hasValidCategory = true;
                    const categoryTag = document.createElement('div');
                    categoryTag.className = 'reminder-item__category';
                    categoryTag.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 2px;
                        font-size: 11px;
                        background-color: ${category.color}20;
                        color: ${category.color};
                        border: 1px solid ${category.color}40;
                        border-radius: 12px;
                        padding: 2px 8px;
                        font-weight: 500;
                    `;

                    if (category.icon) {
                        const iconSpan = document.createElement('span');
                        iconSpan.textContent = category.icon;
                        iconSpan.style.fontSize = '10px';
                        categoryTag.appendChild(iconSpan);
                    }

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = category.name;
                    categoryTag.appendChild(nameSpan);

                    categoriesContainer.appendChild(categoryTag);
                }
            });

            if (hasValidCategory) {
                infoEl.appendChild(categoriesContainer);
            }
        }

        // 项目标签
        if (reminder.projectId && reminder.tagIds && reminder.tagIds.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'reminder-item__tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            try {
                const projectTags = await this.projectManager.getProjectTags(reminder.projectId);
                const tagMap = new Map(projectTags.map(t => [t.id, t]));

                reminder.tagIds.forEach((tagId: string) => {
                    const tag = tagMap.get(tagId);
                    if (tag) {
                        const tagEl = document.createElement('span');
                        tagEl.className = 'reminder-item__tag';
                        tagEl.style.cssText = `
                            display: inline-flex;
                            align-items: center;
                            padding: 2px 8px;
                            font-size: 11px;
                            border-radius: 12px;
                            background: ${tag.color}20;
                            border: 1px solid ${tag.color};
                            color: var(--b3-theme-on-surface);
                            font-weight: 500;
                        `;
                        tagEl.textContent = `#${tag.name}`;
                        tagsContainer.appendChild(tagEl);
                    }
                });
            } catch (error) {
                console.error('加载项目标签失败:', error);
            }

            infoEl.appendChild(tagsContainer);
        }

        contentEl.appendChild(infoEl);

        // 操作按钮
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

        // 编辑按钮
        const editBtn = document.createElement('button');
        editBtn.className = 'b3-button b3-button--text';
        editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
        editBtn.title = '编辑';
        editBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const { QuickReminderDialog } = await import('./QuickReminderDialog');
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId: this.blockId,
                    reminder: reminder,
                    plugin: this.plugin,
                    mode: 'edit'
                });
                dialog.show();
            } catch (err) {
                console.error('打开编辑对话框失败:', err);
                showMessage('无法打开编辑对话框', 3000, 'error');
            }
        });
        actions.appendChild(editBtn);

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--text';
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.title = '删除';
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.deleteReminder(reminder);
        });
        actions.appendChild(deleteBtn);

        contentEl.appendChild(actions);
        item.appendChild(contentEl);

        const openEditDialog = async () => {
            try {
                const { QuickReminderDialog } = await import('./QuickReminderDialog');
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId: this.blockId,
                    reminder: reminder,
                    plugin: this.plugin,
                    mode: 'edit'
                });
                dialog.show();
            } catch (err) {
                console.error('打开编辑对话框失败:', err);
                showMessage('无法打开编辑对话框', 3000, 'error');
            }
        };

        // 右键编辑：直接打开 QuickReminderDialog 编辑该任务
        item.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openEditDialog();
        });

        return item;
    }

    private async toggleReminderComplete(reminder: any, completed: boolean) {
        try {
            const reminderData = await this.plugin.loadReminderData();
            if (reminderData[reminder.id]) {
                reminderData[reminder.id].completed = completed;
                if (completed) {
                    reminderData[reminder.id].completedAt = new Date().toISOString();
                } else {
                    delete reminderData[reminder.id].completedAt;
                }
                await this.plugin.saveReminderData(reminderData);

                // 更新块的书签状态
                await updateBindBlockAtrrs(this.blockId, this.plugin);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                showMessage(completed ? "任务已完成" : "任务已取消完成", 2000);
            }
        } catch (error) {
            console.error("切换任务完成状态失败:", error);
            showMessage("操作失败", 3000, "error");
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string, endTime?: string): string {
        // 简化版本，从ReminderPanel复制
        const now = new Date();
        const targetDate = new Date(date + (time ? 'T' + time : ''));
        const isToday = date === today;
        const isTomorrow = date === new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const isYesterday = date === new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        let dateStr = '';
        if (isToday) {
            dateStr = '今天';
        } else if (isTomorrow) {
            dateStr = '明天';
        } else if (isYesterday) {
            dateStr = '昨天';
        } else {
            const diffDays = Math.floor((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            if (diffDays > 0 && diffDays <= 7) {
                const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                dateStr = weekdays[targetDate.getDay()];
            } else {
                dateStr = date;
            }
        }

        let timeStr = '';
        if (time) {
            timeStr = time;
        }

        if (endDate && endDate !== date) {
            const endDateStr = endDate === today ? '今天' : endDate;
            const endTimeStr = endTime || '';
            return `${dateStr} ${timeStr} - ${endDateStr} ${endTimeStr}`.trim();
        }

        return `${dateStr} ${timeStr}`.trim();
    }

    private createReminderCountdownElement(reminder: any): HTMLElement | null {
        if (!reminder.date) return null;

        const now = new Date();
        const targetDate = new Date(reminder.date + (reminder.time ? 'T' + reminder.time : ''));
        const diffMs = targetDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

        if (diffDays < 0) return null; // 已过期

        const countdownEl = document.createElement('span');
        countdownEl.className = 'reminder-countdown';
        countdownEl.style.cssText = 'font-size: 11px; color: var(--b3-theme-on-surface-light); background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 10px;';

        if (diffDays === 0) {
            countdownEl.textContent = '今天到期';
            countdownEl.style.background = 'rgba(255, 193, 7, 0.1)';
            countdownEl.style.color = '#ffc107';
        } else if (diffDays === 1) {
            countdownEl.textContent = '明天到期';
        } else if (diffDays <= 7) {
            countdownEl.textContent = `${diffDays}天后`;
        } else {
            return null; // 不显示太远的倒计时
        }

        return countdownEl;
    }

    private formatCompletedTime(completedTime: string): string {
        const completed = new Date(completedTime);
        const now = new Date();
        const diffMs = now.getTime() - completed.getTime();
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

        if (diffDays === 0) {
            return `今天 ${completed.toLocaleTimeString(getLocaleTag(), { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffDays === 1) {
            return `昨天 ${completed.toLocaleTimeString(getLocaleTag(), { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffDays <= 7) {
            return `${diffDays}天前 ${completed.toLocaleTimeString(getLocaleTag(), { hour: '2-digit', minute: '2-digit' })}`;
        } else {
            return completed.toLocaleDateString(getLocaleTag());
        }
    }

    private async deleteReminder(reminder: any) {
        await confirm(
            "确认删除",
            `确定要删除任务 "${reminder.title}"？`,
            async () => {
                // 用户确认删除
                try {
                    const reminderData = await this.plugin.loadReminderData();
                    delete reminderData[reminder.id];
                    await this.plugin.saveReminderData(reminderData);

                    // 更新块的书签状态
                    await updateBindBlockAtrrs(this.blockId, this.plugin);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    const reminderIds = await getBlockReminderIds(this.blockId);
                    const reminders = reminderIds
                        .map(id => reminderData[id])
                        .filter(r => r);

                    if (reminders.length === 0) {
                        // 如果没有任务了，关闭对话框
                        this.dialog.destroy();
                        showMessage("所有任务已删除", 2000);
                    } else {
                        showMessage("任务已删除", 2000);
                    }
                } catch (error) {
                    console.error("删除任务失败:", error);
                    showMessage("删除失败", 3000, "error");
                }
            }
        );
    }
}
