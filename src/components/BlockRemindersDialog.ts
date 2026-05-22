import { Dialog, showMessage, confirm, Menu } from "siyuan";
import { getBlockByID, updateBindBlockAtrrs, getBlockReminderIds, openBlock } from "../api";
import { getLocaleTag, getLogicalDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { i18n } from "../pluginInstance";
import { TaskRenderer } from "./render/TaskRenderer";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";

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
    private pomodoroRecordManager: PomodoroRecordManager;
    private allRemindersMap: Map<string, any> = new Map();
    private milestoneMap: Map<string, any> = new Map();
    private projectDataMap: Map<string, any> = new Map();
    private reminderUpdatedHandler: (event: CustomEvent) => void;

    constructor(blockId: string, plugin: any) {
        this.blockId = blockId;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance();
        this.projectManager = ProjectManager.getInstance(plugin);
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(plugin);
    }

    async show() {
        try {
            // 确保 ProjectManager 已初始化
            await this.projectManager.initialize();
            await this.pomodoroRecordManager.initialize();
            await this.buildMilestoneMap();

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
                await this.buildMilestoneMap();
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
            await this.renderReminders(container, reminders);

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
                const item = await this.createReminderItem(reminder);
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
                const item = await this.createReminderItem(reminder);
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
                    projectId: instanceMod.projectId !== undefined ? instanceMod.projectId : originalReminder.projectId,
                    customGroupId: instanceMod.customGroupId !== undefined ? instanceMod.customGroupId : originalReminder.customGroupId,
                    customGroupName: instanceMod.customGroupName !== undefined ? instanceMod.customGroupName : originalReminder.customGroupName
                };
            })
            .filter(Boolean);
    }

    private async createReminderItem(reminder: any): Promise<HTMLElement> {
        const stats = await this.pomodoroRecordManager.resolveReminderPomodoroStats(reminder, this.allRemindersMap);

        const renderReminder = {
            ...reminder,
            completedTime: reminder.completedTime || reminder.completedAt,
            ...stats
        };
        const projectCache = new Map<string, any>();
        if (renderReminder.projectId) {
            try {
                const projectCacheEntry = this.getProjectCacheEntry(renderReminder);
                if (projectCacheEntry) {
                    projectCache.set(renderReminder.id, projectCacheEntry);
                }
            } catch (error) {
                console.error('加载项目信息失败:', error);
            }
        }

        const allTasks = Array.from(this.allRemindersMap.values());
        if (!allTasks.some((task: any) => task.id === renderReminder.id)) {
            allTasks.push(renderReminder);
        }

        const renderedItem = TaskRenderer.render(
            renderReminder,
            {
                plugin: this.plugin,
                today: getLogicalDateString(),
                showProjectBadge: true,
                showCategoryBadge: true,
                allTasks,
                categoryManager: this.categoryManager,
                milestoneMap: this.milestoneMap,
                projectCache,
                isMobileClient: this.plugin?.isInMobileApp,
                formatCompletedTime: (timeStr: string) => this.formatCompletedTime(timeStr)
            },
            {
                onCheckboxClick: (task: any, checked: boolean) => {
                    void this.toggleReminderComplete(task, checked);
                },
                onMoreClick: (task: any, element: HTMLElement, event: MouseEvent) => {
                    this.showReminderActionMenu(task, this.getMenuPosition(element, event));
                },
                onCardDoubleClick: (task: any) => {
                    void this.openEditDialog(task);
                },
                onTitleClick: (task: any) => {
                    const targetId = task.blockId || task.docId;
                    if (targetId) {
                        openBlock(targetId);
                    }
                },
                onNoteClick: (task: any) => {
                    void this.openEditDialog(task, 'note');
                },
                onTimeClick: (task: any) => {
                    void this.openEditDialog(task);
                },
                onMilestoneClick: (task: any) => {
                    const milestone = task.milestoneId ? this.milestoneMap.get(task.milestoneId) : null;
                    if (milestone?.blockId) {
                        openBlock(milestone.blockId);
                    }
                }
            },
            0,
            allTasks
        );
        renderedItem.setAttribute('draggable', 'false');
        renderedItem.style.marginBottom = '8px';
        return renderedItem;

    }

    private getMenuPosition(element: HTMLElement, event: MouseEvent): { clientX: number; clientY: number } {
        if (event.type === 'contextmenu' || event.clientX || event.clientY) {
            return { clientX: event.clientX, clientY: event.clientY };
        }
        const rect = element.getBoundingClientRect();
        return { clientX: rect.right, clientY: rect.bottom + 4 };
    }

    private showReminderActionMenu(reminder: any, position: { clientX: number; clientY: number }) {
        const menu = new Menu("blockReminderActionMenu");

        menu.addItem({
            iconHTML: "📝",
            label: i18n("edit") || "编辑",
            click: () => {
                void this.openEditDialog(reminder);
            }
        });

        menu.addItem({
            iconHTML: "🗑️",
            label: i18n("delete") || "删除",
            click: () => {
                void this.deleteReminder(reminder);
            }
        });

        menu.open({
            x: position.clientX,
            y: position.clientY
        });
    }

    private async openEditDialog(reminder: any, mode: 'edit' | 'note' = 'edit') {
        try {
            const { QuickReminderDialog } = await import('./QuickReminderDialog');
            const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                blockId: this.blockId,
                reminder,
                plugin: this.plugin,
                mode
            });
            dialog.show();
        } catch (err) {
            console.error('打开编辑对话框失败:', err);
            showMessage(i18n("openModifyDialogFailed") || '打开修改对话框失败，请重试', 3000, 'error');
        }
    }

    private async buildMilestoneMap() {
        this.milestoneMap.clear();
        try {
            const projectData = await this.loadProjectDataMap();
            Object.entries(projectData).forEach(([projectId, project]: [string, any]) => {
                const projectName = project?.title || project?.name;
                (project?.milestones || []).forEach((milestone: any) => {
                    this.milestoneMap.set(milestone.id, { ...milestone, projectId, projectName });
                });
                (project?.customGroups || []).forEach((group: any) => {
                    (group?.milestones || []).forEach((milestone: any) => {
                        this.milestoneMap.set(milestone.id, {
                            ...milestone,
                            projectId,
                            projectName: group?.name ? `${projectName || ''} - ${group.name}` : projectName
                        });
                    });
                });
            });
        } catch (error) {
            console.error('构建里程碑映射失败:', error);
        }
    }

    private async loadProjectDataMap(): Promise<Record<string, any>> {
        const loadedProjectData = await this.plugin.loadProjectData?.();
        const projectData = loadedProjectData && typeof loadedProjectData === 'object' ? loadedProjectData : {};

        this.projectDataMap.clear();
        Object.entries(projectData).forEach(([projectId, project]: [string, any]) => {
            if (!projectId.startsWith('_') && project && typeof project === 'object') {
                this.projectDataMap.set(projectId, project);
            }
        });

        return projectData;
    }

    private getProjectCacheEntry(reminder: any): any | null {
        const projectId = reminder?.projectId;
        if (!projectId) return null;

        const storedProject = this.projectDataMap.get(projectId);
        const managerProject = this.projectManager.getProjectById(projectId);
        if (!storedProject && !managerProject) return null;

        const customGroups = Array.isArray(storedProject?.customGroups)
            ? storedProject.customGroups
            : (Array.isArray(managerProject?.customGroups) ? managerProject.customGroups : []);
        const projectName = storedProject?.title || storedProject?.name || managerProject?.name || projectId;
        const project = {
            ...storedProject,
            ...managerProject,
            id: projectId,
            title: storedProject?.title || storedProject?.name || managerProject?.name || projectId,
            name: projectName,
            color: storedProject?.color || managerProject?.color || this.projectManager.getProjectColor(projectId),
            customGroups
        };
        const customGroup = reminder.customGroupId
            ? customGroups.find((group: any) => group?.id === reminder.customGroupId)
            : undefined;

        return {
            project,
            customGroup,
            customGroupName: customGroup?.name || reminder.customGroupName
        };
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
