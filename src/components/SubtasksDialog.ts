import { Dialog, showMessage, confirm } from "siyuan";
import { } from "../api";
import { i18n } from "../pluginInstance";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { PasteTaskDialog } from "./PasteTaskDialog";

export class SubtasksDialog {
    private dialog: Dialog;
    private parentId: string;
    private plugin: any;
    private subtasks: any[] = [];
    private onUpdate?: () => void;
    private draggingId: string | null = null;
    private currentSort: 'priority' | 'time' | 'createdAt' | 'title' = 'priority';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private isTempMode: boolean = false; // 是否为临时模式（新建任务的子任务）
    private tempSubtasks: any[] = []; // 临时子任务列表
    private onTempSubtasksUpdate?: (subtasks: any[]) => void; // 临时子任务更新回调
    private isInstanceEdit: boolean = false; // 是否为编辑单个重复实例模式
    private isModifyAllInstances: boolean = false; // 是否为编辑所有重复实例模式

    constructor(
        parentId: string,
        plugin: any,
        onUpdate?: () => void,
        tempSubtasks: any[] = [],
        onTempSubtasksUpdate?: (subtasks: any[]) => void,
        isInstanceEdit?: boolean,
        isModifyAllInstances?: boolean
    ) {
        this.parentId = parentId;
        this.plugin = plugin;
        this.onUpdate = onUpdate;
        // 如果 parentId 为空，说明是新建任务的临时子任务模式
        this.isTempMode = !parentId;
        this.tempSubtasks = tempSubtasks || [];
        this.onTempSubtasksUpdate = onTempSubtasksUpdate;
        this.isInstanceEdit = isInstanceEdit || false;
        this.isModifyAllInstances = isModifyAllInstances || false;
    }

    public async show() {
        if (this.isTempMode) {
            // 临时模式：使用传入的临时子任务列表
            this.subtasks = [...this.tempSubtasks];
        } else {
            await this.loadSubtasks();
        }

        this.dialog = new Dialog({
            title: this.renderDialogTitle(),
            content: `
                <div class="subtasks-dialog" style="padding: 16px; display: flex; flex-direction: column; gap: 16px; max-height: 80vh;">
                    <div class="subtasks-header" style="display: flex; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--b3-border-color);">
                        <button id="sortBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>
                            ${i18n("sort") || "排序"}
                        </button>
                    </div>
                    <div id="subtasksList" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 100px;max-height: 500px;">
                        <!-- 子任务列表 -->
                    </div>
                    <div class="subtasks-actions" style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--b3-border-color);">
                        <button id="pasteSubtaskBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                            ${i18n("pasteSubtasks") || "粘贴新建"}
                        </button>
                        <button id="addSubtaskBtn" class="b3-button b3-button--primary">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("createSubtask") || "创建子任务"}
                        </button>
                        <button id="closeSubtasksBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                            ${i18n("close") || "关闭"}
                        </button>
                    </div>
                </div>
            `,
            width: "420px",
            destroyCallback: () => {
                if (this.onUpdate) this.onUpdate();
            }
        });

        this.renderSubtasks();
        this.bindEvents();
    }

    private renderDialogTitle(): string {
        const baseTitle = this.isTempMode
            ? (i18n("newSubtasks") || "新建子任务")
            : (i18n("subtasks") || "子任务");
        const sortNames = {
            'priority': i18n('sortByPriority') || '按优先级',
            'time': i18n('sortByTime') || '按时间',
            'createdAt': i18n('sortByCreated') || '按创建时间',
            'title': i18n('sortByTitle') || '按标题'
        };
        const orderText = this.currentSortOrder === 'asc' ? '↑' : '↓';
        return `${baseTitle} (${sortNames[this.currentSort]}${orderText})`;
    }

    private async loadSubtasks() {
        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析可能存在的实例信息 (id_YYYY-MM-DD)
        let targetParentId = this.parentId;
        let instanceDate: string | undefined;

        const lastUnderscoreIndex = this.parentId.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = this.parentId.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetParentId = this.parentId.substring(0, lastUnderscoreIndex);
                instanceDate = potentialDate;
            }
        }

        // 1. 获取直接以 this.parentId 为父任务的任务（可能是真正的实例子任务或普通子任务）
        const directChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === this.parentId);

        // 2. 如果是实例视图，则尝试从模板中获取 ghost 子任务
        let ghostChildren: any[] = [];
        if (instanceDate && targetParentId !== this.parentId) {
            const templateChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === targetParentId);
            ghostChildren = templateChildren
                .filter(child => {
                    // 过滤掉在当前日期隐藏的 ghost 子任务
                    const isHidden = child.repeat?.excludeDates?.includes(instanceDate);
                    return !isHidden;
                })
                .map(child => {
                    const ghostId = `${child.id}_${instanceDate}`;
                    // 检查此实例是否已完成
                    const isCompleted = child.repeat?.completedInstances?.includes(instanceDate) || false;

                    // 查找针对此子任务实例的修改（如果存在）
                    const instanceMod = child.repeat?.instanceModifications?.[instanceDate] || {};

                    return {
                        ...child,
                        ...instanceMod,
                        id: ghostId,
                        parentId: this.parentId, // 链接到当前实例父任务
                        isRepeatInstance: true,
                        originalId: child.id,
                        completed: isCompleted,
                        title: instanceMod.title || child.title || '(无标题)',
                    };
                });
        }

        // 合并数据，避免重复（如果已存在真实的实例子任务，则以真实子任务优先）
        const combined = [...directChildren];
        ghostChildren.forEach(ghost => {
            if (!combined.some(r => r.id === ghost.id)) {
                combined.push(ghost);
            }
        });

        this.subtasks = combined;
        this.subtasks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }

    private renderSubtasks() {
        const listEl = this.dialog.element.querySelector("#subtasksList") as HTMLElement;
        if (!listEl) return;

        // 先排序
        this.sortSubtasks();

        // 添加拖拽指示器样式（添加到 dialog 的容器中，避免被 innerHTML 覆盖）
        const dialogContent = this.dialog.element.querySelector(".subtasks-dialog") || this.dialog.element;
        if (!dialogContent.querySelector("#subtask-drag-styles")) {
            const styleEl = document.createElement("style");
            styleEl.id = "subtask-drag-styles";
            styleEl.textContent = `
                .subtask-item {
                    position: relative;
                }
                .subtask-item.drag-indicator-top::before,
                .subtask-item.drag-indicator-bottom::after {
                    content: "";
                    position: absolute;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: var(--b3-theme-primary);
                    border-radius: 2px;
                    z-index: 10;
                    box-shadow: 0 0 4px var(--b3-theme-primary);
                }
                .subtask-item.drag-indicator-top::before {
                    top: -2px;
                }
                .subtask-item.drag-indicator-bottom::after {
                    bottom: -2px;
                }
                .subtask-item.drag-indicator-top {
                    transform: translateY(2px);
                }
                .subtask-item.drag-indicator-bottom {
                    transform: translateY(-2px);
                }
                .subtask-item.dragging {
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
                .subtask-item.drag-disabled {
                    cursor: default;
                }
                .subtask-item.drag-disabled .subtask-drag-handle {
                    opacity: 0.2;
                    cursor: default;
                }
            `;
            dialogContent.appendChild(styleEl);
        }

        if (this.subtasks.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 20px;">${i18n("noSubtasks") || "暂无子任务"}</div>`;
            return;
        }

        // 只在优先级排序时启用拖拽
        const isDragEnabled = this.currentSort === 'priority';

        listEl.innerHTML = this.subtasks.map(task => {
            const priorityIcon = this.getPriorityIcon(task.priority);
            const dragHandle = isDragEnabled ? `<div class="subtask-drag-handle" style="cursor: move; opacity: 0.5;">⋮⋮</div>` : `<div class="subtask-drag-handle" style="cursor: default; opacity: 0.2;">⋮⋮</div>`;
            return `
            <div class="subtask-item ${isDragEnabled ? '' : 'drag-disabled'}" data-id="${task.id}" draggable="${isDragEnabled}" style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-border); border-radius: 4px; cursor: ${isDragEnabled ? 'move' : 'default'}; transition: all 0.2s;">
                ${dragHandle}
                <input type="checkbox" ${task.completed ? 'checked' : ''} class="subtask-checkbox" style="margin: 0;">
                <div class="subtask-title" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${task.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
                    ${priorityIcon} ${task.title}
                </div>
                <div class="subtask-ops" style="display: flex; gap: 4px; opacity: 0.6;">
                    <button class="b3-button b3-button--outline b3-button--small edit-subtask-btn" title="${i18n("edit")}" style="padding: 4px;">
                        <svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#iconEdit"></use></svg>
                    </button>
                    <button class="b3-button b3-button--outline b3-button--small delete-subtask-btn" title="${i18n("delete")}" style="padding: 4px;">
                        <svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#iconTrashcan"></use></svg>
                    </button>
                </div>
            </div>
        `;
        }).join("");

        // Bind events for each item
        listEl.querySelectorAll(".subtask-item").forEach(item => {
            const id = item.getAttribute("data-id");
            const task = this.subtasks.find(t => t.id === id);

            item.querySelector(".subtask-checkbox")?.addEventListener("change", (e) => {
                this.toggleSubtask(id, (e.target as HTMLInputElement).checked);
            });

            item.querySelector(".edit-subtask-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.editSubtask(task);
            });

            item.querySelector(".delete-subtask-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteSubtask(id);
            });

            // Hover effect for ops
            item.addEventListener("mouseenter", () => {
                (item.querySelector(".subtask-ops") as HTMLElement).style.opacity = "1";
                (item as HTMLElement).style.borderColor = "var(--b3-theme-primary)";
            });
            item.addEventListener("mouseleave", () => {
                (item.querySelector(".subtask-ops") as HTMLElement).style.opacity = "0.6";
                (item as HTMLElement).style.borderColor = "var(--b3-theme-border)";
            });

            // 只在优先级排序时绑定拖拽事件
            if (isDragEnabled) {
                this.addDragAndDrop(item as HTMLElement);
            }
        });
    }

    private getPriorityIcon(priority: string): string {
        switch (priority) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            case 'low': return '🔵';
            default: return '⚪';
        }
    }

    private bindEvents() {
        this.dialog.element.querySelector("#addSubtaskBtn")?.addEventListener("click", () => {
            this.addSubtask();
        });

        this.dialog.element.querySelector("#pasteSubtaskBtn")?.addEventListener("click", () => {
            this.showPasteSubtaskDialog();
        });

        this.dialog.element.querySelector("#closeSubtasksBtn")?.addEventListener("click", () => {
            this.dialog.destroy();
        });

        this.dialog.element.querySelector("#sortBtn")?.addEventListener("click", (e) => {
            this.showSortMenu(e as MouseEvent);
        });
    }

    private showSortMenu(event: MouseEvent) {
        if (document.querySelector('.subtasks-sort-menu')) {
            return;
        }

        const menuEl = document.createElement('div');
        menuEl.className = 'subtasks-sort-menu';
        menuEl.style.cssText = `
            position: fixed;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 6px;
            padding: 8px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 180px;
        `;

        const sortOptions: { key: 'priority' | 'time' | 'createdAt' | 'title', label: string, icon: string }[] = [
            { key: 'priority', label: i18n('sortByPriority') || '按优先级', icon: '🎯' },
            { key: 'time', label: i18n('sortByTime') || '按设定时间', icon: '🕐' },
            { key: 'createdAt', label: i18n('sortByCreated') || '按创建时间', icon: '📅' },
            { key: 'title', label: i18n('sortByTitle') || '按标题', icon: '📝' },
        ];

        sortOptions.forEach((option, index) => {
            // 创建排序方式行容器
            const rowEl = document.createElement('div');
            rowEl.style.cssText = `
                display: flex;
                gap: 4px;
                align-items: center;
            `;

            // 标签
            const labelEl = document.createElement('span');
            labelEl.style.cssText = `
                flex: 1;
                font-size: 13px;
                color: var(--b3-theme-on-surface);
                padding: 0 4px;
            `;
            labelEl.textContent = `${option.icon} ${option.label}`;
            rowEl.appendChild(labelEl);

            // 降序按钮
            const descBtn = document.createElement('button');
            const isDescActive = this.currentSort === option.key && this.currentSortOrder === 'desc';
            descBtn.className = 'b3-button b3-button--small';
            descBtn.style.cssText = `
                padding: 4px 8px;
                font-size: 12px;
                min-width: 32px;
                ${isDescActive ? 'background: var(--b3-theme-primary); color: white;' : ''}
            `;
            descBtn.textContent = '↓';
            descBtn.title = i18n('descendingOrder') || '降序';
            descBtn.addEventListener('click', () => {
                this.currentSort = option.key;
                this.currentSortOrder = 'desc';
                this.sortSubtasks();
                this.renderSubtasks();
                // 更新标题
                const titleEl = this.dialog.element.querySelector('.b3-dialog__header');
                if (titleEl) {
                    titleEl.textContent = this.renderDialogTitle();
                }
                closeMenu();
            });
            rowEl.appendChild(descBtn);

            // 升序按钮
            const ascBtn = document.createElement('button');
            const isAscActive = this.currentSort === option.key && this.currentSortOrder === 'asc';
            ascBtn.className = 'b3-button b3-button--small';
            ascBtn.style.cssText = `
                padding: 4px 8px;
                font-size: 12px;
                min-width: 32px;
                ${isAscActive ? 'background: var(--b3-theme-primary); color: white;' : ''}
            `;
            ascBtn.textContent = '↑';
            ascBtn.title = i18n('ascendingOrder') || '升序';
            ascBtn.addEventListener('click', () => {
                this.currentSort = option.key;
                this.currentSortOrder = 'asc';
                this.sortSubtasks();
                this.renderSubtasks();
                // 更新标题
                const titleEl = this.dialog.element.querySelector('.b3-dialog__header');
                if (titleEl) {
                    titleEl.textContent = this.renderDialogTitle();
                }
                closeMenu();
            });
            rowEl.appendChild(ascBtn);

            menuEl.appendChild(rowEl);

            // 添加分隔线（除了最后一个）
            if (index < sortOptions.length - 1) {
                const hr = document.createElement('hr');
                hr.style.cssText = `
                    margin: 4px 0;
                    border: none;
                    border-top: 1px solid var(--b3-theme-border);
                `;
                menuEl.appendChild(hr);
            }
        });

        document.body.appendChild(menuEl);

        // 定位菜单
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        menuEl.style.left = `${rect.left}px`;
        menuEl.style.top = `${rect.bottom + 4}px`;

        // 点击外部关闭
        const closeMenu = () => {
            if (menuEl.parentNode) {
                menuEl.parentNode.removeChild(menuEl);
            }
            document.removeEventListener('click', handleClickOutside);
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (!menuEl.contains(e.target as Node)) {
                closeMenu();
            }
        };

        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }

    private sortSubtasks() {
        switch (this.currentSort) {
            case 'priority':
                this.subtasks.sort((a, b) => {
                    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                    const priorityA = priorityOrder[a.priority || 'none'] || 0;
                    const priorityB = priorityOrder[b.priority || 'none'] || 0;

                    // 首先按优先级排序（高优先级在前）
                    const priorityDiff = priorityB - priorityA;
                    if (priorityDiff !== 0) {
                        // 升序时低优先级在前，降序时高优先级在前
                        return this.currentSortOrder === 'asc' ? -priorityDiff : priorityDiff;
                    }

                    // 同优先级内按手动排序（sort 值小的在前）
                    const sortDiff = (a.sort || 0) - (b.sort || 0);
                    if (sortDiff !== 0) {
                        return sortDiff;
                    }

                    // 最后按创建时间排序（最新创建的在前）
                    const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                    const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                    return timeB - timeA;
                });
                break;
            case 'time':
                this.subtasks.sort((a, b) => {
                    // 无日期的任务始终排在有日期任务之后（不受升降序影响）
                    const hasDateA = !!a.date;
                    const hasDateB = !!b.date;

                    if (!hasDateA && !hasDateB) {
                        // 都没有日期，按优先级排序
                        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                        const priorityDiff = (priorityOrder[b.priority || 'none'] || 0) - (priorityOrder[a.priority || 'none'] || 0);
                        if (priorityDiff !== 0) return priorityDiff;
                        // 优先级相同按 sort
                        return (a.sort || 0) - (b.sort || 0);
                    }
                    if (!hasDateA) return 1;
                    if (!hasDateB) return -1;

                    // 都有日期，按时间排序
                    const dateA = a.date || '9999-12-31';
                    const dateB = b.date || '9999-12-31';
                    const timeA = a.time || '00:00';
                    const timeB = b.time || '00:00';
                    const dtA = `${dateA}T${timeA}`;
                    const dtB = `${dateB}T${timeB}`;

                    let timeResult = dtA.localeCompare(dtB);
                    if (timeResult !== 0) {
                        // 升序：时间早的在前；降序：时间晚的在前
                        return this.currentSortOrder === 'asc' ? timeResult : -timeResult;
                    }

                    // 时间相同时，按 sort 值排序
                    return (a.sort || 0) - (b.sort || 0);
                });
                break;
            case 'createdAt':
                this.subtasks.sort((a, b) => {
                    const result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                    return this.currentSortOrder === 'asc' ? result : -result;
                });
                break;
            case 'title':
                this.subtasks.sort((a, b) => {
                    const result = (a.title || '').localeCompare(b.title || '');
                    return this.currentSortOrder === 'asc' ? result : -result;
                });
                break;
        }
    }

    private async addSubtask() {
        let parentTask: any = null;

        if (!this.isTempMode) {
            const reminderData = await this.plugin.loadReminderData() || {};
            
            // 解析可能存在的实例信息 (id_YYYY-MM-DD)
            let targetParentId = this.parentId;
            const lastUnderscoreIndex = this.parentId.lastIndexOf('_');
            if (lastUnderscoreIndex !== -1) {
                const potentialDate = this.parentId.substring(lastUnderscoreIndex + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                    targetParentId = this.parentId.substring(0, lastUnderscoreIndex);
                }
            }
            
            // 获取原始父任务（支持重复实例）
            parentTask = reminderData[targetParentId];
        }

        // 计算所有子任务的最大 sort 值
        const maxSort = this.subtasks.reduce((max, t) => Math.max(max, t.sort || 0), 0);
        const newSort = maxSort + 1000;

        const dialog = new QuickReminderDialog(undefined, undefined, async (newReminder) => {
            if (!newReminder) return;

            // 设置 sort 值为最大值+1000，确保放在最后
            newReminder.sort = newSort;

            if (this.isTempMode) {
                // 临时模式：将新子任务添加到临时列表
                newReminder.parentId = '__TEMP_PARENT__';
                newReminder.isTempSubtask = true;

                // 检查是否已存在（避免重复添加）
                const exists = this.subtasks.some(t => t.id === newReminder.id);
                if (!exists) {
                    this.subtasks.push(newReminder);
                    this.renderSubtasks();
                }
            } else {
                // 正常模式：检查是否是当前父任务的子任务
                if (newReminder.parentId === this.parentId) {
                    const exists = this.subtasks.some(t => t.id === newReminder.id);
                    if (!exists) {
                        this.subtasks.push(newReminder);
                        this.renderSubtasks();
                    }
                }
                // 延迟重新加载以确保数据已保存到存储
                setTimeout(async () => {
                    await this.loadSubtasks();
                    this.renderSubtasks();
                }, 100);
            }
        }, undefined, {
            mode: 'quick',
            defaultParentId: this.isTempMode ? '__TEMP_PARENT__' : this.parentId,
            // 继承父任务的项目、分组、状态等属性
            defaultProjectId: parentTask?.projectId,
            defaultCustomGroupId: parentTask?.customGroupId,
            defaultStatus: parentTask?.kanbanStatus,
            defaultMilestoneId: parentTask?.milestoneId,
            defaultCategoryId: parentTask?.categoryId,
            defaultPriority: parentTask?.priority,
            defaultSort: newSort, // 传入预计算的 sort 值，确保保存时一致
            plugin: this.plugin,
            skipSave: this.isTempMode // 临时模式下跳过保存，通过回调返回数据
        });
        dialog.show();
    }

    private async editSubtask(task: any) {
        const dialog = new QuickReminderDialog(undefined, undefined, async (modifiedReminder) => {
            if (!modifiedReminder) return;

            // 乐观更新：直接更新本地数组中的任务
            const index = this.subtasks.findIndex(t => t.id === modifiedReminder.id);
            if (index !== -1) {
                this.subtasks[index] = { ...this.subtasks[index], ...modifiedReminder };
                this.renderSubtasks();

                // 临时模式：通知外部更新
                if (this.isTempMode && this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
            }

            if (!this.isTempMode) {
                // 正常模式：延迟重新加载以确保数据已保存到存储
                setTimeout(async () => {
                    await this.loadSubtasks();
                    this.renderSubtasks();
                }, 100);
            }
        }, undefined, {
            mode: 'edit',
            reminder: task,
            plugin: this.plugin,
            skipSave: this.isTempMode // 临时模式下跳过保存，通过回调更新
        });
        dialog.show();
    }

    private async toggleSubtask(id: string, completed: boolean) {
        // 临时模式：只更新本地状态
        if (this.isTempMode) {
            const index = this.subtasks.findIndex(t => t.id === id);
            if (index !== -1) {
                this.subtasks[index].completed = completed;
                if (completed) {
                    this.subtasks[index].completedTime = new Date().toISOString();
                } else {
                    delete this.subtasks[index].completedTime;
                }
                this.renderSubtasks();
                if (this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
            }
            return;
        }

        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析 ID，判断是否为实例
        let targetId = id;
        let date: string | undefined;
        const lastUnderscoreIndex = id.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = id.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetId = id.substring(0, lastUnderscoreIndex);
                date = potentialDate;
            }
        }

        const task = reminderData[targetId];
        if (!task) return;

        // 保存任务信息用于后续事件触发
        const taskProjectId = task.projectId;

        if (date) {
            // 重复实例逻辑：将完成状态记录在 repeat 对象中
            if (!task.repeat) task.repeat = {};
            if (!task.repeat.completedInstances) task.repeat.completedInstances = [];
            if (!task.repeat.completedTimes) task.repeat.completedTimes = {};

            if (completed) {
                if (!task.repeat.completedInstances.includes(date)) {
                    task.repeat.completedInstances.push(date);
                }
                task.repeat.completedTimes[date] = new Date().toISOString();
            } else {
                const idx = task.repeat.completedInstances.indexOf(date);
                if (idx > -1) {
                    task.repeat.completedInstances.splice(idx, 1);
                }
                delete task.repeat.completedTimes[date];
            }
        } else {
            // 普通任务逻辑
            task.completed = completed;
            if (completed) {
                task.completedTime = new Date().toISOString();
            } else {
                delete task.completedTime;
            }
        }

        await this.plugin.saveReminderData(reminderData);
        await this.loadSubtasks();
        this.renderSubtasks();
        
        // 触发更新事件通知其他组件
        if (taskProjectId) {
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: {
                    projectId: taskProjectId
                }
            }));
        }
        
        // 通知父组件更新
        if (this.onUpdate) {
            this.onUpdate();
        }
    }

    private async deleteSubtask(id: string) {
        // 临时模式：仅从本地列表删除
        if (this.isTempMode) {
            const index = this.subtasks.findIndex(t => t.id === id);
            if (index !== -1) {
                const taskTitle = this.subtasks[index].title || '无标题';
                confirm(
                    i18n("confirmDelete") || "确认删除",
                    `确定要删除临时子任务 "${taskTitle}" 吗？`,
                    async () => {
                        this.subtasks.splice(index, 1);
                        this.renderSubtasks();
                        if (this.onTempSubtasksUpdate) {
                            this.onTempSubtasksUpdate([...this.subtasks]);
                        }
                    }
                );
            }
            return;
        }

        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析 ID
        let targetId = id;
        let date: string | undefined;
        const lastUnderscoreIndex = id.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = id.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetId = id.substring(0, lastUnderscoreIndex);
                date = potentialDate;
            }
        }

        const task = reminderData[targetId];
        if (!task) return;

        // 保存任务信息用于后续事件触发
        const taskProjectId = task.projectId;

        // 定义执行删除的函数
        const doDelete = async () => {
            // Recursive delete
            const deleteRecursive = async (idToDelete: string) => {
                const children = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === idToDelete);
                for (const child of children) {
                    await deleteRecursive(child.id);
                }
                // 取消移动端通知
                await this.plugin.cancelMobileNotification(idToDelete);
                delete reminderData[idToDelete];
            };

            await deleteRecursive(targetId);
            await this.plugin.saveReminderData(reminderData);
            await this.loadSubtasks();
            this.renderSubtasks();
            
            // 触发更新事件通知其他组件
            if (taskProjectId) {
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: {
                        projectId: taskProjectId
                    }
                }));
            }
            
            // 通知父组件更新
            if (this.onUpdate) {
                this.onUpdate();
            }
            
            showMessage(i18n("deleteSuccess"));
        };

        if (date) {
            // 判断是否为编辑单个实例模式（非编辑所有实例）
            const isEditingSingleInstance = this.isInstanceEdit && !this.isModifyAllInstances;
            
            if (isEditingSingleInstance) {
                // 编辑单个实例：将此 ghost 子任务在当前日期标记为隐藏
                // 而不是删除整个模板
                confirm(
                    i18n("confirmDelete") || "确认删除",
                    `确定要在此日期隐藏子任务 "${task.title}" 吗？\n此操作仅影响当前日期的实例，不会影响其他日期的该子任务。`,
                    async () => {
                        // 将 ghost 子任务标记为在当前日期隐藏
                        if (!task.repeat) task.repeat = {};
                        if (!task.repeat.excludeDates) task.repeat.excludeDates = [];
                        if (!task.repeat.excludeDates.includes(date)) {
                            task.repeat.excludeDates.push(date);
                        }
                        await this.plugin.saveReminderData(reminderData);
                        await this.loadSubtasks();
                        this.renderSubtasks();
                        
                        // 触发更新事件
                        if (taskProjectId) {
                            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                                detail: { projectId: taskProjectId }
                            }));
                        }
                        if (this.onUpdate) {
                            this.onUpdate();
                        }
                        
                        showMessage(i18n("hideSuccess") || "已隐藏");
                    }
                );
            } else {
                // 编辑所有实例：删除整个模板任务
                const ghostConfirmMsg = `确定要删除此子任务的原始模板吗？\n删除后所有日期的该子任务都将消失。\n\n任务标题: ${task.title}`;
                confirm(
                    i18n("confirmDelete") || "确认删除",
                    ghostConfirmMsg,
                    async () => {
                        await doDelete();
                    }
                );
            }
            return;
        }

        // Count subtasks of this task
        const childrenCount = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === targetId).length;
        let confirmMsg = i18n("confirmDeleteTask", { title: task.title }) || `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`;
        if (childrenCount > 0) {
            confirmMsg += `\n${i18n("includesNSubtasks", { count: childrenCount.toString() }) || `此任务包含 ${childrenCount} 个子任务，它们也将被一并删除。`}`;
        }

        // Use siyuan confirm
        confirm(
            i18n("confirmDelete") || "确认删除",
            confirmMsg,
            async () => {
                await doDelete();
            }
        );
    }

    private addDragAndDrop(item: HTMLElement) {
        item.addEventListener("dragstart", (e) => {
            const id = item.getAttribute("data-id");
            if (e.dataTransfer && id) {
                e.dataTransfer.setData("text/plain", id);
                e.dataTransfer.effectAllowed = "move";
            }
            this.draggingId = id;
            item.style.opacity = "0.5";
            item.classList.add("dragging");
        });

        item.addEventListener("dragend", () => {
            this.draggingId = null;
            item.style.opacity = "1";
            item.classList.remove("dragging");
            this.clearAllDragIndicators();
        });

        item.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

            const targetId = item.getAttribute("data-id");

            if (this.draggingId && targetId && this.draggingId !== targetId) {
                // 根据鼠标位置判断是显示上方还是下方指示器
                const rect = item.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const isUpperHalf = offsetY < rect.height / 2;

                this.showDragIndicator(item, isUpperHalf ? 'top' : 'bottom');
            }
        });

        item.addEventListener("dragleave", (e) => {
            // 只有当真正离开元素时才清除指示器
            const rect = item.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                this.clearDragIndicator(item);
            }
        });

        item.addEventListener("drop", async (e) => {
            e.preventDefault();

            const draggingId = e.dataTransfer?.getData("text/plain");
            const targetId = item.getAttribute("data-id");

            if (draggingId && targetId && draggingId !== targetId) {
                // 根据鼠标位置决定插入到目标上方还是下方
                const rect = item.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const insertBefore = offsetY < rect.height / 2;

                await this.reorderSubtasks(draggingId, targetId, insertBefore);
            }

            this.clearAllDragIndicators();
        });
    }

    private showDragIndicator(item: HTMLElement, position: 'top' | 'bottom') {
        // 先清除所有指示器
        this.clearAllDragIndicators();

        // 添加对应的指示器类
        if (position === 'top') {
            item.classList.add("drag-indicator-top");
        } else {
            item.classList.add("drag-indicator-bottom");
        }
    }

    private clearDragIndicator(item: HTMLElement) {
        item.classList.remove("drag-indicator-top", "drag-indicator-bottom");
    }

    private clearAllDragIndicators() {
        const listEl = this.dialog.element?.querySelector("#subtasksList") as HTMLElement;
        if (listEl) {
            listEl.querySelectorAll(".subtask-item").forEach(el => {
                el.classList.remove("drag-indicator-top", "drag-indicator-bottom");
            });
        }
    }

    private getDraggingId(e: DragEvent): string | null {
        // DataTransfer is sometimes not available in dragover in some browsers/environments
        // but for Siyuan/Electron it should be fine.
        return e.dataTransfer?.getData("text/plain") || null;
    }

    private async reorderSubtasks(draggingId: string, targetId: string, insertBefore: boolean = true) {
        const draggingIndex = this.subtasks.findIndex(t => t.id === draggingId);
        let targetIndex = this.subtasks.findIndex(t => t.id === targetId);

        if (draggingIndex === -1 || targetIndex === -1) return;

        // 如果插入到目标下方，调整目标索引
        if (!insertBefore) {
            targetIndex += 1;
        }

        // 如果拖拽项在目标项之前，且要插入到目标之后，需要调整索引
        if (draggingIndex < targetIndex) {
            targetIndex -= 1;
        }

        const [movedTask] = this.subtasks.splice(draggingIndex, 1);
        this.subtasks.splice(targetIndex, 0, movedTask);

        // 自动调整优先级：获取目标位置的优先级，如果被拖拽任务优先级不同则修改
        const targetTask = this.subtasks.find(t => t.id === targetId);
        if (targetTask && movedTask.priority !== targetTask.priority) {
            movedTask.priority = targetTask.priority;
        }

        // 更新 sort 值
        this.subtasks.forEach((task: any, index: number) => {
            task.sort = index * 10;
        });

        if (this.isTempMode) {
            // 临时模式：只更新本地状态
            if (this.onTempSubtasksUpdate) {
                this.onTempSubtasksUpdate([...this.subtasks]);
            }
            this.renderSubtasks();
            showMessage(i18n("sortUpdated") || "排序已更新");
            return;
        }

        // 正常模式：保存到数据库
        const reminderData = await this.plugin.loadReminderData() || {};
        // Update sort values in reminderData
        this.subtasks.forEach((task: any, index: number) => {
            const sortVal = index * 10;
            if (reminderData[task.id]) {
                reminderData[task.id].sort = sortVal;
            }
        });

        // 同步优先级修改到存储
        if (reminderData[draggingId]) {
            reminderData[draggingId].priority = movedTask.priority;
        }

        await this.plugin.saveReminderData(reminderData);
        this.renderSubtasks();

        // 触发更新事件通知其他组件
        if (movedTask?.projectId) {
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: {
                    projectId: movedTask.projectId
                }
            }));
        }

        showMessage(i18n("sortUpdated") || "排序已更新");
    }

    // 显示粘贴新建子任务对话框
    private async showPasteSubtaskDialog() {
        let parentTask: any = null;
        
        if (!this.isTempMode) {
            const reminderData = await this.plugin.loadReminderData() || {};
            
            // 解析可能存在的实例信息 (id_YYYY-MM-DD)
            let targetParentId = this.parentId;
            const lastUnderscoreIndex = this.parentId.lastIndexOf('_');
            if (lastUnderscoreIndex !== -1) {
                const potentialDate = this.parentId.substring(lastUnderscoreIndex + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                    targetParentId = this.parentId.substring(0, lastUnderscoreIndex);
                }
            }
            
            // 获取原始父任务（支持重复实例）
            const originalTask = reminderData[targetParentId];
            
            // 判断是否为编辑单个实例模式（非编辑所有实例）
            const isEditingSingleInstance = this.isInstanceEdit && !this.isModifyAllInstances;
            
            if (isEditingSingleInstance) {
                // 编辑单个实例：创建一个虚拟父任务对象，使用实例ID作为parentId
                // 这样创建的子任务会是普通子任务，只属于当前实例
                parentTask = {
                    ...originalTask,
                    id: this.parentId, // 使用实例ID
                    originalId: targetParentId, // 保留原始任务ID
                    isRepeatInstance: true
                };
            } else {
                // 编辑所有实例或普通任务：使用原始任务
                // 这样创建的子任务会成为ghost子任务模板
                parentTask = originalTask;
            }
        }

        const pasteDialog = new PasteTaskDialog({
            plugin: this.plugin,
            parentTask: parentTask,
            projectId: parentTask?.projectId,
            customGroupId: parentTask?.customGroupId,
            defaultStatus: parentTask?.kanbanStatus || 'todo',
            isTempMode: this.isTempMode,
            onTasksCreated: (createdTasks) => {
                // 临时模式：将创建的任务添加到本地数组
                for (const task of createdTasks) {
                    const exists = this.subtasks.some(t => t.id === task.id);
                    if (!exists) {
                        this.subtasks.push(task);
                    }
                }
                this.subtasks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
                this.renderSubtasks();
                if (this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
            },
            onSuccess: async (totalCount) => {
                if (!this.isTempMode) {
                    showMessage(`${totalCount} ${i18n("subtasksCreated") || "个子任务已创建"}`);
                    // 重新加载子任务列表
                    await this.loadSubtasks();
                    this.renderSubtasks();
                    // 触发更新事件通知其他组件
                    const projectId = parentTask?.projectId;
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { projectId }
                    }));
                }
                if (this.onUpdate) {
                    this.onUpdate();
                }
            },
            onError: (error) => {
                console.error('批量创建子任务失败:', error);
                showMessage(i18n("batchCreateFailed") || "批量创建任务失败");
            }
        });

        await pasteDialog.show();
    }
}
