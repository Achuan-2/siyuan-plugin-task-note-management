import { Dialog, showMessage, confirm } from "siyuan";
import { getBlockByID, updateBindBlockAtrrs, getBlockReminderIds } from "../api";
// import { getLocalDateTimeString, getRelativeDateString } from "../utils/dateUtils";
import { getLocaleTag, getLogicalDateString, getRelativeDateString, compareDateStrings } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { i18n } from "../pluginInstance";
import { getSolarDateLunarString } from "../utils/lunarUtils";

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
    private allRemindersMap: Map<string, any> = new Map();
    private reminderUpdatedHandler: (event: CustomEvent) => void;

    constructor(blockId: string, plugin: any) {
        this.blockId = blockId;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance();
        this.projectManager = ProjectManager.getInstance(plugin);
    }

    async show() {
        try {
            // 确保 ProjectManager 已初始化
            await this.projectManager.initialize();

            // 获取块信息
            const block = await getBlockByID(this.blockId);
            if (!block) {
                showMessage(i18n("blockNotExistError") || "块不存在", 3000, "error");
                return;
            }

            // 获取绑定的提醒ID
            const reminderIds = await getBlockReminderIds(this.blockId);
            if (reminderIds.length === 0) {
                showMessage(i18n("noBoundTasks") || "该块没有绑定任务", 3000, "info");
                return;
            }

            // 获取提醒数据
            const reminderData = await this.plugin.loadReminderData();
            this.allRemindersMap = new Map(Object.entries(reminderData || {}));
            const reminders = this.resolveBoundReminders(reminderData, reminderIds);

            if (reminders.length === 0) {
                showMessage(i18n("noBoundTasks") || "该块没有绑定任务", 3000, "info");
                return;
            }

            // 创建对话框
            this.dialog = new Dialog({
                title: `${i18n("blockBoundTasks") || "块绑定任务"} - ${block.content.substring(0, 30)}${block.content.length > 30 ? '...' : ''}`,
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
                this.allRemindersMap = new Map(Object.entries(updatedReminderData || {}));
                const updatedReminderIds = await getBlockReminderIds(this.blockId);
                const updatedReminders = this.resolveBoundReminders(updatedReminderData, updatedReminderIds);
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
            console.error("Failed to show block bound tasks:", error);
            showMessage(i18n("loadFailed") || "加载失败", 3000, "error");
        }
    }

    private async renderReminders(container: HTMLElement, reminders: any[]) {
        container.innerHTML = '';

        if (reminders.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--b3-theme-on-surface-light);">${i18n("noBoundTasks") || "该块没有绑定任务"}</div>`;
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
            incompleteTitle.textContent = `${i18n("uncompleted") || "未完成"} (${incompleteReminders.length})`;
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
            completedTitle.textContent = `${i18n("completed") || "已完成"} (${completedReminders.length})`;
            completedTitle.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 10px; color: var(--b3-theme-on-surface); opacity: 0.7;';
            completedSection.appendChild(completedTitle);

            for (const reminder of completedReminders) {
                const item = await this.createReminderItem(reminder, true);
                completedSection.appendChild(item);
            }

            container.appendChild(completedSection);
        }
    }

    private resolveBoundReminders(reminderData: any, reminderIds: string[]): any[] {
        return reminderIds
            .map(id => {
                if (reminderData[id]) return reminderData[id];

                const splitIndex = id.lastIndexOf('_');
                if (splitIndex <= 0) return null;
                const originalId = id.substring(0, splitIndex);
                const instanceDate = id.substring(splitIndex + 1);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(instanceDate)) return null;

                const originalReminder = reminderData[originalId];
                const instanceMod = originalReminder?.repeat?.instanceModifications?.[instanceDate];
                if (!originalReminder || !instanceMod || instanceMod.blockId !== this.blockId) return null;
                if ((originalReminder.repeat?.excludeDates || []).includes(instanceDate)) return null;

                const completedInstances = originalReminder.repeat?.completedInstances || [];
                const completedTimes = originalReminder.repeat?.completedTimes || originalReminder.repeat?.instanceCompletedTimes || {};
                const completed = completedInstances.includes(instanceDate);

                return {
                    ...originalReminder,
                    ...instanceMod,
                    id,
                    originalId,
                    instanceDate,
                    isRepeatInstance: true,
                    completed,
                    completedAt: completed ? completedTimes[instanceDate] : undefined,
                    completedTime: completed ? completedTimes[instanceDate] : undefined,
                    projectId: instanceMod.projectId !== undefined ? instanceMod.projectId : originalReminder.projectId
                };
            })
            .filter(Boolean);
    }

    private normalizeCustomProgress(value: any): number | undefined {
        if (value === undefined || value === null || value === '') return undefined;
        const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
        if (!Number.isFinite(num)) return undefined;
        return Math.max(0, Math.min(100, Math.round(num)));
    }

    private getReminderProgressInfo(reminder: any): { shouldShow: boolean; percent: number } {
        const customPercent = this.normalizeCustomProgress(reminder?.customProgress);
        if (customPercent !== undefined) {
            return { shouldShow: true, percent: customPercent };
        }

        const children: any[] = [];
        this.allRemindersMap.forEach((r: any) => {
            if (r?.parentId === reminder?.id) children.push(r);
        });

        if (children.length === 0) {
            return { shouldShow: false, percent: 0 };
        }

        const completedCount = children.filter(c => c.completed).length;
        return {
            shouldShow: true,
            percent: Math.max(0, Math.min(100, Math.round((completedCount / children.length) * 100)))
        };
    }

    private getReminderLogicalDate(dateStr?: string, timeStr?: string): string {
        if (!dateStr) return '';
        if (timeStr) {
            try {
                return getLogicalDateString(new Date(`${dateStr}T${timeStr}`));
            } catch (e) {
                return dateStr;
            }
        }
        return dateStr;
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
        titleEl.textContent = reminder.title || i18n("untitledTask") || '无标题';
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
        if (reminder.repeat?.enabled || reminder.isRepeatInstance) {
            const repeatIcon = document.createElement('span');
            repeatIcon.textContent = '🔄';
            repeatIcon.classList.add('ariaLabel');
            repeatIcon.setAttribute('aria-label', reminder.repeat?.enabled ? (i18n("repeatTask") || '重复任务') : (i18n("repeatInstance") || '周期事件实例'));
            timeContainer.appendChild(repeatIcon);
        }

        // 时间信息
        const displayDate = reminder.date || reminder.endDate;
        const hasReminderTimes = Array.isArray(reminder.reminderTimes) && reminder.reminderTimes.length > 0;
        const reminderTimesOnlyText = !displayDate && hasReminderTimes ? this.formatReminderTimes(reminder) : '';
        if (displayDate || reminderTimesOnlyText) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-item__time';
            if (displayDate) {
                const displayTime = reminder.date ? reminder.time : (reminder.endTime || reminder.time);
                const timeText = this.formatReminderTime(displayDate, displayTime, undefined, reminder.endDate, reminder.endTime, reminder);
                timeEl.textContent = '🗓' + timeText;
            } else {
                timeEl.textContent = '⏰' + reminderTimesOnlyText;
            }
            timeEl.style.fontSize = '12px';
            timeEl.style.color = 'var(--b3-theme-on-surface-light)';
            timeContainer.appendChild(timeEl);

            if (!isCompleted) {
                const countdownEl = this.createReminderCountdownElement(reminder);
                if (countdownEl) {
                    timeContainer.appendChild(countdownEl);
                }
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
                            color: ${tag.color};
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

        const progressInfo = this.getReminderProgressInfo(reminder);
        if (progressInfo.shouldShow) {
            const progressContainer = document.createElement('div');
            progressContainer.className = 'reminder-progress-container';
            progressContainer.style.cssText = `
                margin-top: 6px;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const progressWrap = document.createElement('div');
            progressWrap.style.cssText = `
                flex: 1;
                min-width: 0;
                height: 8px;
                background: rgba(0, 0, 0, 0.08);
                border-radius: 6px;
                overflow: hidden;
            `;

            const progressBar = document.createElement('div');
            progressBar.className = 'reminder-progress-bar';
            progressBar.style.cssText = `
                height: 100%;
                width: ${progressInfo.percent}%;
                border-radius: 6px;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
            `;
            progressWrap.appendChild(progressBar);

            const percentText = document.createElement('span');
            percentText.className = 'reminder-progress-text';
            percentText.textContent = `${progressInfo.percent}%`;
            percentText.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
                min-width: 36px;
                text-align: right;
            `;

            progressContainer.appendChild(progressWrap);
            progressContainer.appendChild(percentText);
            infoEl.appendChild(progressContainer);
        }

        contentEl.appendChild(infoEl);

        // 操作按钮
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

        // 编辑按钮
        const editBtn = document.createElement('button');
        editBtn.className = 'b3-button b3-button--text';
        editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
        editBtn.classList.add('ariaLabel'); editBtn.setAttribute('aria-label', i18n("edit") || '编辑');
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
                showMessage(i18n("openModifyDialogFailed") || '打开修改对话框失败，请重试', 3000, 'error');
            }
        });
        actions.appendChild(editBtn);

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--text';
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.classList.add('ariaLabel'); deleteBtn.setAttribute('aria-label', i18n("delete") || '删除');
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
                showMessage(i18n("openModifyDialogFailed") || '打开修改对话框失败，请重试', 3000, 'error');
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
            if (reminder.isRepeatInstance && reminder.originalId && reminder.instanceDate && reminderData[reminder.originalId]) {
                const original = reminderData[reminder.originalId];
                if (!original.repeat) original.repeat = {};
                if (!original.repeat.completedInstances) original.repeat.completedInstances = [];
                if (!original.repeat.completedTimes) original.repeat.completedTimes = {};

                if (completed) {
                    if (!original.repeat.completedInstances.includes(reminder.instanceDate)) {
                        original.repeat.completedInstances.push(reminder.instanceDate);
                    }
                    original.repeat.completedTimes[reminder.instanceDate] = new Date().toISOString();
                } else {
                    original.repeat.completedInstances = original.repeat.completedInstances.filter((date: string) => date !== reminder.instanceDate);
                    delete original.repeat.completedTimes[reminder.instanceDate];
                }

                await this.plugin.saveReminderData(reminderData);
                await updateBindBlockAtrrs(this.blockId, this.plugin);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                showMessage(completed ? (i18n("taskCompleted") || "任务已完成") : (i18n("taskUncompleted") || "任务已取消完成"), 2000);
                return;
            }

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

                showMessage(completed ? (i18n("taskCompleted") || "任务已完成") : (i18n("taskUncompleted") || "任务已取消完成"), 2000);
            }
        } catch (error) {
            console.error("切换任务完成状态失败:", error);
            showMessage(i18n("operationFailed") || "操作失败", 3000, "error");
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string, endTime?: string, reminder?: any): string {
        if (!today) {
            today = getLogicalDateString();
        }

        const tomorrowStr = getRelativeDateString(1);

        // 使用逻辑日期（考虑一天起始时间）来判断“今天/明天/过去/未来”标签
        const logicalStart = this.getReminderLogicalDate(date, time);
        const logicalEnd = this.getReminderLogicalDate(endDate || date, endTime || time);

        let dateStr = '';
        if (logicalStart === today) {
            dateStr = i18n("today");
        } else if (logicalStart === tomorrowStr) {
            dateStr = i18n("tomorrow");
        } else {
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString(getLocaleTag(), {
                month: 'short',
                day: 'numeric'
            });
        }

        // 如果是农历循环事件，添加农历日期显示
        if (reminder?.repeat?.enabled && (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly')) {
            try {
                const lunarStr = getSolarDateLunarString(date);
                if (lunarStr) {
                    dateStr = `${dateStr} (${lunarStr})`;
                }
            } catch (error) {
                console.error('Failed to format lunar date:', error);
            }
        }

        let result = '';

        // 处理跨天事件
        if (endDate && endDate !== date) {
            let endDateStr = '';
            if (logicalEnd === today) {
                endDateStr = i18n("today");
            } else if (logicalEnd === tomorrowStr) {
                endDateStr = i18n("tomorrow");
            } else {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString(getLocaleTag(), {
                    month: 'short',
                    day: 'numeric'
                });
            }

            const startTimeStr = time ? ` ${time}` : '';
            const endTimeStr = endTime ? ` ${endTime}` : '';
            result = `${dateStr}${startTimeStr} → ${endDateStr}${endTimeStr}`;
        } else if (endTime && endTime !== time) {
            const startTimeStr = time || '';
            result = `${dateStr} ${startTimeStr} - ${endTime}`;
        } else {
            result = time ? `${dateStr} ${time}` : dateStr;
        }

        const reminderTimesText = this.formatReminderTimes(reminder, date, today);
        if (reminderTimesText) {
            result += ` ⏰${reminderTimesText}`;
        }

        return result;
    }

    private formatReminderTimes(reminder?: any, fallbackDate?: string, today: string = getLogicalDateString()): string {
        try {
            if (!reminder?.reminderTimes || !Array.isArray(reminder.reminderTimes) || reminder.reminderTimes.length === 0) {
                return '';
            }

            return reminder.reminderTimes.map((rtItem: any) => {
                if (!rtItem) return '';
                const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                const note = typeof rtItem === 'string' ? '' : String(rtItem.note || '').trim();
                if (!rt) return '';

                const s = String(rt).trim();
                let datePart: string | null = null;
                let timePart: string | null = null;

                if (s.includes('T')) {
                    const parts = s.split('T');
                    datePart = parts[0];
                    timePart = parts[1] || null;
                } else if (/^\d{4}-\d{2}-\d{2}\s+/.test(s)) {
                    const parts = s.split(/\s+/);
                    datePart = parts[0];
                    timePart = parts.slice(1).join(' ') || null;
                } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                    datePart = s;
                } else {
                    timePart = s;
                }

                const targetDate = datePart || fallbackDate || reminder.date || reminder.endDate || today;
                const logicalTarget = this.getReminderLogicalDate(targetDate, timePart || undefined);

                if (compareDateStrings(logicalTarget, today) < 0) return '';

                if (compareDateStrings(logicalTarget, today) === 0) {
                    const displayTime = timePart ? timePart.substring(0, 5) : '';
                    return note && displayTime ? `${displayTime}（${note}）` : (displayTime || note);
                }

                const d = new Date(targetDate + 'T00:00:00');
                const ds = d.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
                const displayTime = `${ds}${timePart ? ' ' + timePart.substring(0, 5) : ''}`;
                return note ? `${displayTime}（${note}）` : displayTime;
            }).filter(Boolean).join(', ');
        } catch (e) {
            console.warn('格式化 reminderTimes 失败', e);
            return '';
        }
    }

    private createReminderCountdownElement(reminder: any): HTMLElement | null {
        if (!reminder.date && !reminder.endDate) return null;

        const today = getLogicalDateString();
        let targetDate: string;
        let isOverdueEvent = false;
        let isStartedOnlyEvent = false;

        const startLogical = this.getReminderLogicalDate(reminder.date || reminder.endDate, reminder.time || reminder.endTime);
        const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
        const hasStartDate = !!reminder.date;
        const hasEndDate = !!reminder.endDate;
        const isOnlyEndDate = !hasStartDate && hasEndDate;
        const isOnlyStartDate = hasStartDate && !hasEndDate;
        const treatsOnlyStartAsDeadline = isOnlyStartDate && !!(reminder?.isRepeatInstance || reminder?.repeat?.enabled);
        const isSpanningRealEvent = !!(hasStartDate && hasEndDate && reminder.endDate !== reminder.date);

        if (isSpanningRealEvent) {
            const isInRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

            if (isInRange) {
                targetDate = endLogical;
            } else if (compareDateStrings(startLogical, today) > 0) {
                targetDate = startLogical;
            } else {
                if (!reminder.completed) {
                    targetDate = endLogical;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            }
        } else {
            if (compareDateStrings(startLogical, today) > 0) {
                targetDate = startLogical;
            } else if (compareDateStrings(startLogical, today) < 0) {
                if (!reminder.completed) {
                    targetDate = startLogical;
                    if (isOnlyStartDate && !treatsOnlyStartAsDeadline) {
                        isStartedOnlyEvent = true;
                    } else {
                        isOverdueEvent = true;
                    }
                } else {
                    return null;
                }
            } else {
                return null;
            }
        }

        const daysDiff = this.calculateReminderDaysDifference(targetDate, today);
        const isTargetEndForSpanning = isSpanningRealEvent && targetDate === endLogical;
        const isInRangeForSpanning = isSpanningRealEvent && compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

        if (daysDiff === 0 && !(isTargetEndForSpanning && isInRangeForSpanning)) {
            return null;
        }

        const countdownEl = document.createElement('span');
        countdownEl.className = 'reminder-countdown';

        const applyCountdownStyle = (colorVar: string, backgroundVar: string) => {
            countdownEl.style.cssText = `
                color: var(${colorVar});
                font-size: 12px;
                font-weight: 500;
                background: var(${backgroundVar});
                border: 1px solid var(${colorVar});
                border-radius: 4px;
                padding: 2px 6px;
                flex-shrink: 0;
            `;
        };

        if (isStartedOnlyEvent && daysDiff < 0) {
            applyCountdownStyle('--b3-card-success-color', '--b3-card-success-background');
            countdownEl.textContent = i18n("startedDays", { days: Math.abs(daysDiff).toString() });
        } else if (isOverdueEvent || daysDiff < 0) {
            applyCountdownStyle('--b3-font-color1', '--b3-font-background1');

            const overdueDays = Math.abs(daysDiff);
            countdownEl.textContent = overdueDays === 1 ?
                i18n("overdueBySingleDay") :
                i18n("overdueByDays", { days: overdueDays.toString() });
        } else {
            applyCountdownStyle('--b3-font-color4', '--b3-font-background4');

            if (isSpanningRealEvent) {
                const isInRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

                if (isInRange) {
                    applyCountdownStyle('--b3-font-color2', '--b3-font-background2');
                    countdownEl.textContent = daysDiff === 1 ?
                        i18n("spanningDaysLeftSingle") :
                        i18n("spanningDaysLeftPlural", { days: daysDiff.toString() });
                } else {
                    applyCountdownStyle('--b3-font-color4', '--b3-font-background4');
                    countdownEl.textContent = i18n("startInDays", { days: daysDiff.toString() });
                }
            } else if (isOnlyEndDate) {
                applyCountdownStyle('--b3-font-color2', '--b3-font-background2');
                countdownEl.textContent = i18n("endsInNDays", { days: daysDiff.toString() });
            } else {
                applyCountdownStyle('--b3-font-color4', '--b3-font-background4');
                countdownEl.textContent = i18n("startInDays", { days: daysDiff.toString() });
            }
        }

        return countdownEl;
    }

    private calculateReminderDaysDifference(targetDate: string, today: string): number {
        const target = new Date(targetDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffTime = target.getTime() - todayDate.getTime();
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    private formatCompletedTime(completedTime: string): string {
        const completed = new Date(completedTime);
        const now = new Date();
        const diffMs = now.getTime() - completed.getTime();
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        const cleanCompletedTemplate = (template: string) => template.replace(/^[\s(（]+/, '').replace(/[)）\s]+$/, '');
        const completedAtTemplate = cleanCompletedTemplate(i18n("completedAtTemplate") || "完成于 ${time}");
        const completedAtWithDateTemplate = cleanCompletedTemplate(i18n("completedAtWithDateTemplate") || "完成于 ${date} ${time}");
        const timeText = completed.toLocaleTimeString(getLocaleTag(), { hour: '2-digit', minute: '2-digit' });

        if (diffDays === 0) {
            return completedAtTemplate.replace("${time}", `${i18n("today") || "今天"} ${timeText}`);
        } else if (diffDays === 1) {
            return completedAtTemplate.replace("${time}", `${i18n("yesterday") || "昨天"} ${timeText}`);
        } else if (diffDays <= 7) {
            return completedAtTemplate.replace("${time}", `${i18n("daysAgo")?.replace("${days}", diffDays.toString()) || diffDays + "天前"} ${timeText}`);
        } else {
            return completedAtWithDateTemplate
                .replace("${date}", completed.toLocaleDateString(getLocaleTag()))
                .replace("${time}", timeText);
        }
    }

    private async deleteReminder(reminder: any) {
        await confirm(
            i18n("confirmDeleteTitle") || "确认删除",
            (i18n("confirmDeleteTask") || `确定要删除任务 "${reminder.title}"？`).replace("${title}", reminder.title),
            async () => {
                // 用户确认删除
                try {
                    if (reminder.isRepeatInstance && reminder.originalId && reminder.instanceDate) {
                        const reminderData = await this.plugin.loadReminderData();
                        const original = reminderData[reminder.originalId];
                        if (!original) {
                            throw new Error('原始重复任务不存在');
                        }
                        if (!original.repeat) original.repeat = {};
                        if (!original.repeat.excludeDates) original.repeat.excludeDates = [];
                        if (!original.repeat.excludeDates.includes(reminder.instanceDate)) {
                            original.repeat.excludeDates.push(reminder.instanceDate);
                        }
                        await this.plugin.saveReminderData(reminderData);
                    } else {
                        // 使用插件的 deleteReminder 方法，会自动取消移动端通知
                        await this.plugin.deleteReminder(reminder.id);
                    }
                    
                    const reminderData = await this.plugin.loadReminderData();

                    // 更新块的书签状态
                    await updateBindBlockAtrrs(this.blockId, this.plugin);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    const reminderIds = await getBlockReminderIds(this.blockId);
                    const reminders = this.resolveBoundReminders(reminderData, reminderIds);

                    if (reminders.length === 0) {
                        // 如果没有任务了，关闭对话框
                        this.dialog.destroy();
                        showMessage(i18n("allTasksDeleted") || "所有任务已删除", 2000);
                    } else {
                        showMessage(i18n("taskDeleted") || "任务已删除", 2000);
                    }
                } catch (error) {
                    console.error("删除任务失败:", error);
                    showMessage(i18n("deleteFailed") || "删除失败", 3000, "error");
                }
            }
        );
    }
}
