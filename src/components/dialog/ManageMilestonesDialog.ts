import { Dialog, showMessage, confirm, openEmoji, openBlock, platformUtils } from "siyuan";
import { i18n } from "../../pluginInstance";
import { getLogicalDateString, getLocalDateTimeString } from "../../utils/dateUtils";
import { ProjectManager } from "../../utils/projectManager";
import { saveReminders } from "../../utils/icsSubscription";
import { BlockBindingDialog } from "../BlockBindingDialog";
import { TaskRenderer } from "../render/TaskRenderer";

export async function showManageMilestonesDialog(view: any, groupId?: string) {
    const dialog = new Dialog({
        title: i18n('manageMilestones'),
        content: `
            <div class="manage-milestones-dialog" style="height: 100%; display: flex; flex-direction: column;">
                <div class="b3-dialog__content" style="flex: 1; overflow-y: auto; padding: 16px;">
                    <div id="milestonesGroupsContainer"></div>
                </div>
            </div>
        `,
        width: "650px",
        height: "600px"
    });

    const container = dialog.element.querySelector('#milestonesGroupsContainer') as HTMLElement;
    renderMilestonesInDialog(view, container, groupId);
}

export async function renderMilestonesInDialog(view: any, container: HTMLElement, groupId?: string) {
    try {
        const projectManager = view.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(view.projectId);
        const projectData = await view.plugin.loadProjectData() || {};
        const project = projectData[view.projectId];
        const defaultMilestones = project?.milestones || [];

        container.innerHTML = '';

        const isGlobalMode = !groupId;

        if (groupId) {
            const targetGroup = projectGroups.find(g => g.id === groupId);
            if (targetGroup) {
                const groupKey = targetGroup.id;
                const isCollapsed = view.collapsedMilestoneGroups.has(groupKey);
                const groupSection = createMilestoneSection(view, targetGroup.name, targetGroup.id, targetGroup.milestones || [], container, isCollapsed, false);
                container.appendChild(groupSection);
            }
            return;
        }

        const defaultGroupKey = 'global';
        const defaultIsCollapsed = view.collapsedMilestoneGroups.has(defaultGroupKey);
        const defaultSection = createMilestoneSection(view, i18n('defaultMilestones'), null, defaultMilestones, container, defaultIsCollapsed, isGlobalMode);
        container.appendChild(defaultSection);

        for (const group of projectGroups) {
            const groupKey = group.id;
            const isCollapsed = view.collapsedMilestoneGroups.has(groupKey);
            const groupSection = createMilestoneSection(view, group.name, group.id, group.milestones || [], container, isCollapsed, isGlobalMode);
            container.appendChild(groupSection);
        }
    } catch (error) {
        console.error(i18n('renderMilestonesFailed'), error);
        container.innerHTML = `<div style="color: var(--b3-theme-error); text-align: center;">${i18n('loadFailed')}</div>`;
    }
}

export function createMilestoneSection(view: any, title: string, groupId: string | null, milestones: any[], parentContainer: HTMLElement, isCollapsed: boolean, isGlobalMode: boolean = false): HTMLElement {
    const groupKey = groupId || 'global';
    const section = document.createElement('div');
    section.className = 'milestone-section';
    section.style.cssText = `
        margin-bottom: 24px;
        border: 1px solid var(--b3-theme-border);
        border-radius: 8px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 10px 16px;
        background: var(--b3-theme-surface-lighter);
        border-bottom: 1px solid var(--b3-theme-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: sticky;
        top: 0;
        z-index: 10;
    `;

    const titleEl = document.createElement('h4');
    titleEl.textContent = title;
    titleEl.style.margin = '0';
    header.appendChild(titleEl);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'b3-button b3-button--small';
    toggleBtn.innerHTML = isCollapsed ? '▶' : '🔽';
    toggleBtn.style.marginRight = '8px';
    toggleBtn.addEventListener('click', () => {
        if (view.collapsedMilestoneGroups.has(groupKey)) {
            view.collapsedMilestoneGroups.delete(groupKey);
            list.style.display = 'block';
            toggleBtn.innerHTML = '🔽';
        } else {
            view.collapsedMilestoneGroups.add(groupKey);
            list.style.display = 'none';
            toggleBtn.innerHTML = '▶';
        }
    });
    header.insertBefore(toggleBtn, titleEl);

    const addBtn = document.createElement('button');
    addBtn.className = 'b3-button b3-button--small b3-button--primary';
    addBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newMilestone')}`;
    addBtn.addEventListener('click', () => {
        const refreshCallback = () => renderMilestonesInDialog(view, parentContainer, isGlobalMode ? undefined : groupId);
        showMilestoneEditDialog(view, null, groupId, refreshCallback, milestones);
    });
    header.appendChild(addBtn);

    section.appendChild(header);

    const list = document.createElement('div');
    list.style.padding = '8px 16px';
    list.className = 'milestone-list';
    list.style.display = isCollapsed ? 'none' : 'block';

    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
        height: 2px;
        background: var(--b3-theme-primary);
        margin: 4px 0;
        display: none;
    `;
    list.appendChild(placeholder);

    let draggedMilestoneId: string | null = null;

    if (milestones.length === 0) {
        list.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6;">${i18n('noMilestones')}</div>`;
    } else {
        milestones.sort((a, b) => (a.sort || 0) - (b.sort || 0)).forEach(ms => {
            const item = document.createElement('div');
            item.className = 'milestone-item';
            item.dataset.msId = ms.id;
            item.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-bottom: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
                background: var(--b3-theme-surface);
                margin: 2px 0;
                border-radius: 4px;
            `;
            if (milestones.indexOf(ms) === milestones.length - 1) {
                item.style.borderBottom = 'none';
            }

            const info = document.createElement('div');
            info.style.cssText = `display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;`;

            const icon = document.createElement('span');
            icon.textContent = ms.icon || '🚩';
            info.appendChild(icon);

            const name = document.createElement('span');
            name.textContent = ms.name;
            name.style.cssText = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;`;
            if (ms.blockId) {
                name.style.textDecoration = 'underline dotted';
                name.style.color = 'var(--b3-protyle-inline-blockref-color)';
                name.style.cursor = 'pointer';
                name.setAttribute('data-type', 'a');
                name.setAttribute('data-href', `siyuan://blocks/${ms.blockId}`);
                name.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openBlock(ms.blockId);
                });
            }
            if (ms.archived) {
                name.style.textDecoration = (name.style.textDecoration ? name.style.textDecoration + ' ' : '') + 'line-through';
                name.style.opacity = '0.6';
            }
            info.appendChild(name);

            if (ms.startTime || ms.endTime) {
                const timeRange = document.createElement('span');
                timeRange.style.cssText = `font-size: 11px; color: var(--b3-theme-on-surface); opacity: 0.6; margin-left: 8px; flex-shrink: 0;`;
                const startDisp = ms.startTime || '?';
                const endDisp = ms.endTime || '?';
                timeRange.textContent = `${startDisp} ~ ${endDisp}`;
                info.appendChild(timeRange);
            }

            if (ms.archived) {
                const archivedTag = document.createElement('span');
                archivedTag.textContent = i18n('milestoneArchived');
                archivedTag.style.cssText = `font-size: 11px; padding: 1px 4px; background: var(--b3-theme-surface); border-radius: 4px; opacity: 0.7;`;
                info.appendChild(archivedTag);
            }

            item.appendChild(info);

            const actions = document.createElement('div');
            actions.style.cssText = `display: flex; gap: 8px;`;

            const viewTasksBtn = document.createElement('button');
            viewTasksBtn.className = 'b3-button b3-button--text';
            viewTasksBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg>';
            viewTasksBtn.classList.add('ariaLabel');
            viewTasksBtn.setAttribute('aria-label', i18n('viewTasks'));
            viewTasksBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showMilestoneTasksDialog(view, ms, groupId);
            });
            actions.appendChild(viewTasksBtn);

            const editBtn = document.createElement('button');
            editBtn.className = 'b3-button b3-button--text';
            editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const refreshCallback = () => renderMilestonesInDialog(view, parentContainer, isGlobalMode ? undefined : groupId);
                showMilestoneEditDialog(view, ms, groupId, refreshCallback, milestones);
            });
            actions.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'b3-button b3-button--text';
            deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                confirm(
                    i18n('delete'),
                    i18n('confirmDeleteMilestone').replace('${name}', ms.name),
                    async () => {
                        await deleteMilestone(view, ms.id, groupId);
                        renderMilestonesInDialog(view, parentContainer, isGlobalMode ? undefined : groupId);
                    },
                    () => {}
                );
            });
            actions.appendChild(deleteBtn);

            item.appendChild(actions);

            item.draggable = true;
            item.style.cursor = 'grab';

            item.addEventListener('dragstart', (ev) => {
                draggedMilestoneId = ms.id;
                item.style.opacity = '0.5';
                if (ev.dataTransfer) {
                    ev.dataTransfer.setData('text/plain', ms.id);
                    ev.dataTransfer.effectAllowed = 'move';
                }
            });

            item.addEventListener('dragend', () => {
                draggedMilestoneId = null;
                item.style.opacity = '1';
                placeholder.style.display = 'none';
            });

            list.appendChild(item);
        });

        list.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';

            const items = Array.from(list.querySelectorAll('.milestone-item')) as HTMLElement[];

            if (items.length === 0) {
                list.appendChild(placeholder);
                placeholder.style.display = 'block';
                return;
            }

            let inserted = false;
            for (const el of items) {
                if (el.dataset.msId === draggedMilestoneId) continue;
                const rect = el.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (ev.clientY < midY) {
                    list.insertBefore(placeholder, el);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                list.appendChild(placeholder);
            }
            placeholder.style.display = 'block';
        });

        list.addEventListener('drop', async (ev) => {
            ev.preventDefault();
            placeholder.style.display = 'none';
            const id = ev.dataTransfer?.getData('text/plain');
            if (!id) return;

            const movedMs = milestones.find(m => m.id === id);
            if (!movedMs) return;

            const otherMs = milestones.filter(m => m.id !== id);

            let insertPoint = otherMs.length;
            const children = Array.from(list.children);
            const placeholderIndex = children.indexOf(placeholder);

            for (let i = placeholderIndex + 1; i < children.length; i++) {
                const el = children[i] as HTMLElement;
                if (el.classList.contains('milestone-item')) {
                    const nextId = el.dataset.msId;
                    const nextIndex = otherMs.findIndex(m => m.id === nextId);
                    if (nextIndex !== -1) {
                        insertPoint = nextIndex;
                    }
                    break;
                }
            }

            otherMs.splice(insertPoint, 0, movedMs);

            otherMs.forEach((m, idx) => {
                m.sort = idx * 100;
            });

            if (groupId === null) {
                const projectData = await view.plugin.loadProjectData() || {};
                const project = projectData[view.projectId];
                if (project) {
                    project.milestones = otherMs;
                    await view.plugin.saveProjectData(projectData);
                }
            } else {
                const projectManager = ProjectManager.getInstance(view.plugin);
                const groups = await projectManager.getProjectCustomGroups(view.projectId);
                const group = groups.find((g: any) => g.id === groupId);
                if (group) {
                    group.milestones = otherMs;
                    await projectManager.setProjectCustomGroups(view.projectId, groups);
                }
            }

            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            renderMilestonesInDialog(view, parentContainer, groupId);
        });
    }

    section.appendChild(list);
    return section;
}

export async function showMilestoneTasksDialog(view: any, milestone: any, groupId: string | null) {
    const milestoneDateText = milestone.startTime || milestone.endTime
        ? ` (${milestone.startTime || '?'} ~ ${milestone.endTime || '?'})`
        : '';
    const tasksLabel = i18n('tasks') || '任务';
    const dialog = new Dialog({
        title: `${milestone.name}${milestoneDateText} - ${tasksLabel}`,
        content: `
            <div class="b3-dialog__content" style="padding: 0; display: flex; flex-direction: column; height: 100%;"></div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--text" id="milestoneTasksEditBtn">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                    ${i18n('editMilestone')}
                </button>
            </div>
        `,
        width: "600px",
        height: "70vh"
    });

    const content = dialog.element.querySelector('.b3-dialog__content') as HTMLElement;
    const editBtn = dialog.element.querySelector('#milestoneTasksEditBtn') as HTMLButtonElement | null;
    if (editBtn) {
        editBtn.classList.add('ariaLabel');
        editBtn.setAttribute('aria-label', i18n('editMilestone'));
        editBtn.addEventListener('click', async () => {
            dialog.destroy();
            await showMilestoneEditDialog(view, milestone, groupId, async () => {
                await view.loadTasks();
                await view.renderKanban();
            });
        });
    }

    await renderMilestoneTaskTree(view, content, milestone, groupId, dialog);
}

export async function renderMilestoneTaskTree(view: any, container: HTMLElement, milestone: any, groupId: string | null, dialog: Dialog) {
    container.innerHTML = '';

    const reminderData = await view.getReminders();

    const projectTasks = Object.values(reminderData).filter((reminder: any) =>
        reminder && reminder.projectId === view.projectId
    );

    const taskMap = new Map(projectTasks.map((t: any) => [t.id, t]));

    const relevantTasks = projectTasks.filter((t: any) => {
        if (groupId && groupId !== 'ungrouped') {
            const taskGroupId = t.customGroupId || 'ungrouped';
            if (groupId !== taskGroupId) {
                return false;
            }
        }

        let effectiveMilestoneId = t.milestoneId;
        if (!effectiveMilestoneId && t.parentId) {
            const parent = taskMap.get(t.parentId);
            if (parent) effectiveMilestoneId = parent.milestoneId;
        }

        return effectiveMilestoneId === milestone.id;
    });

    if (relevantTasks.length === 0) {
        container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--b3-theme-on-surface-light);">${i18n('noTasksInMilestone')}</div>`;
        return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y: auto; flex: 1; padding: 0;';

    const relevantIds = new Set(relevantTasks.map(t => t.id));
    const rootTasks: any[] = [];
    const childMap = new Map<string, any[]>();

    relevantTasks.forEach(task => {
        if (task.parentId && relevantIds.has(task.parentId)) {
            if (!childMap.has(task.parentId)) {
                childMap.set(task.parentId, []);
            }
            childMap.get(task.parentId)!.push(task);
        } else {
            rootTasks.push(task);
        }
    });

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        margin: 8px 16px;
        align-items: center;
    `;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'b3-button b3-button--text';
    copyBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg> ${i18n('copyAsMarkdown')}`;
    copyBtn.style.cssText = `
        padding: 4px 12px;
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        display: flex;
        align-items: center;
        gap: 4px;
    `;
    copyBtn.addEventListener('click', async () => {
        const generateMarkdown = (tasks: any[], level: number = 0): string => {
            const indent = '  '.repeat(level);
            return tasks.map(task => {
                const checkbox = task.completed ? '[x]' : '[ ]';
                const priorityMap: Record<string, string> = {
                    'high': ' 🔴',
                    'medium': '🟡',
                    'low': ' 🔵'
                };
                const priorityLabel = task.priority && task.priority !== 'none' ? priorityMap[task.priority] || '' : '';
                const dateStr = task.date ? ` (${task.date})` : '';
                let line = `${indent}- ${checkbox} ${task.title}${priorityLabel}${dateStr}`;

                const children = childMap.get(task.id);
                if (children && children.length > 0) {
                    const unfinishedChildren = children.filter((t: any) => !t.completed).sort((a: any, b: any) => view.compareByPriority(a, b));
                    const finishedChildren = children.filter((t: any) => t.completed).sort((a: any, b: any) => (b.completedTime || '').localeCompare(a.completedTime || ''));
                    const sortedChildren = [...unfinishedChildren, ...finishedChildren];
                    line += '\n' + generateMarkdown(sortedChildren, level + 1);
                }
                return line;
            }).join('\n');
        };

        const unfinishedRoot = rootTasks.filter(t => !t.completed).sort((a, b) => view.compareByPriority(a, b));
        const finishedRoot = rootTasks.filter(t => t.completed).sort((a, b) => (b.completedTime || '').localeCompare(a.completedTime || ''));
        const sortedRootTasks = [...unfinishedRoot, ...finishedRoot];

        const markdown = generateMarkdown(sortedRootTasks);

        try {
            await platformUtils.writeText(markdown);
            showMessage(i18n('copiedToClipboard'));
        } catch (err) {
            console.error(i18n('copyFailed'), err);
            showMessage(i18n('copyFailed'));
        }
    });

    buttonContainer.appendChild(copyBtn);
    list.appendChild(buttonContainer);

    const taskList = document.createElement('div');
    taskList.style.cssText = 'padding: 0 16px 16px;';
    list.appendChild(taskList);

    const collapsedTaskIds = new Set<string>();
    const today = getLogicalDateString();

    const renderTaskRendererTree = () => {
        taskList.innerHTML = '';

        const renderLevel = (tasks: any[], parentEl: HTMLElement, level: number) => {
            const unfinished = tasks.filter(t => !t.completed).sort((a, b) => view.compareByPriority(a, b));
            const finished = tasks.filter(t => t.completed).sort((a, b) => (b.completedTime || '').localeCompare(a.completedTime || ''));
            const sortedTasks = [...unfinished, ...finished];

            sortedTasks.forEach(task => {
                const taskEl = TaskRenderer.render(
                    task,
                    {
                        plugin: view.plugin,
                        today,
                        collapsedTasks: collapsedTaskIds,
                        selectedTaskIds: view.selectedTaskIds,
                        isMultiSelectMode: false,
                        showCompletedSubtasks: true,
                        clipTitleToOneLine: view.clipTitleToOneLine,
                        showProjectKanbanStatus: false,
                        showProjectBadge: false,
                        showCategoryBadge: view.showTaskCategories,
                        customContainerClass: 'kanban-task milestone-task-card',
                        allTasks: relevantTasks,
                        categoryManager: view.categoryManager,
                        milestoneMap: view.milestoneMap,
                        lute: view.lute,
                        isMobileClient: view.plugin?.isInMobileApp,
                        isReminderPinned: (t: any) => !!t.pinned,
                        formatReminderTime: (_dateStr: string, _timeStr: string, _todayStr: string, _endDateStr?: string, _endTimeStr?: string, taskParam?: any) => {
                            return view.formatTaskDate(taskParam || task);
                        }
                    },
                    {
                        onCheckboxClick: (task: any, checked: boolean) => {
                            task.completed = checked;
                            if (checked) {
                                task.completedTime = getLocalDateTimeString(new Date());
                                task.kanbanStatus = 'completed';
                            } else {
                                delete task.completedTime;
                                task.kanbanStatus = 'doing';
                            }
                            view.toggleTaskCompletion(task, checked);
                            renderTaskRendererTree();
                        },
                        onCollapseClick: (task: any, collapsed: boolean) => {
                            if (collapsed) {
                                collapsedTaskIds.add(task.id);
                            } else {
                                collapsedTaskIds.delete(task.id);
                            }
                            renderTaskRendererTree();
                        },
                        onMoreClick: async (task: any, element: HTMLElement, event: MouseEvent) => {
                            const rect = element.getBoundingClientRect();
                            const position = event.type === 'contextmenu' || event.clientX || event.clientY
                                ? { clientX: event.clientX, clientY: event.clientY }
                                : { clientX: rect.right, clientY: rect.bottom + 4 };
                            await view.showTaskContextMenu(position, task);
                        },
                        onCardDoubleClick: async (task: any) => {
                            await view.editTask(task);
                            dialog.destroy();
                        },
                        onTitleClick: (task: any) => {
                            const targetId = task.blockId || task.docId;
                            if (targetId) {
                                view.openBlockTab(targetId);
                            }
                        },
                        onNoteClick: async (task: any) => {
                            await view.showTaskNotePreview(task);
                            dialog.destroy();
                        },
                        onTimeClick: async (task: any) => {
                            await view.editTask(task);
                            dialog.destroy();
                        },
                        onMilestoneClick: (task: any) => {
                            const milestoneInfo = task.milestoneId ? view.milestoneMap.get(task.milestoneId) : null;
                            if (milestoneInfo?.blockId) {
                                openBlock(milestoneInfo.blockId);
                            }
                        }
                    },
                    level,
                    relevantTasks
                );

                taskEl.dataset.taskId = task.id;
                taskEl.dataset.level = level.toString();
                taskEl.dataset.priority = task.priority || 'none';
                taskEl.setAttribute('draggable', 'false');
                taskEl.style.cursor = 'pointer';
                taskEl.style.marginTop = '1px';
                taskEl.style.marginRight = '5px';
                taskEl.style.marginBottom = '8px';
                taskEl.style.padding = '8px';
                parentEl.appendChild(taskEl);

                const children = childMap.get(task.id) || [];
                if (children.length > 0 && !collapsedTaskIds.has(task.id)) {
                    renderLevel(children, parentEl, level + 1);
                }
            });
        };

        renderLevel(rootTasks, taskList, 0);
    };

    renderTaskRendererTree();
    container.appendChild(list);
}

export function showMilestoneEditDialog(view: any, milestone: any | null, groupId: string | null, onSave: () => void, currentMilestones?: any[]) {
    const isEdit = !!milestone;
    const dialog = new Dialog({
        title: isEdit ? i18n('editMilestone') : i18n('newMilestone'),
        content: `
            <div class="b3-dialog__content">
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('milestoneName')}</label>
                    <input type="text" id="msName" class="b3-text-field" value="${milestone?.name || ''}" style="width: 100%;">
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('milestoneIcon')}</label>
                    <input type="text" id="msIcon" class="b3-text-field" value="${milestone?.icon || '🚩'}" style="width: 100%;">
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('milestoneTimeRange')}</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="date" id="msStartTime" class="b3-text-field" value="${milestone?.startTime || ''}" style="flex: 1;">
                        <span style="opacity: 0.6;">~</span>
                        <input type="date" id="msEndTime" class="b3-text-field" value="${milestone?.endTime || ''}" style="flex: 1;">
                    </div>
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('milestoneBlockId')}</label>
                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                        <input type="text" id="msBlockId" class="b3-text-field" value="${milestone?.blockId || ''}" placeholder="." style="flex: 1;">
                        <button class="b3-button b3-button--outline ariaLabel" id="msBindBlockBtn" aria-label="${i18n('bindBlock')}">
                            <svg class="b3-button__icon" style="width: 16px; height: 16px;"><use xlink:href="#iconAdd"></use></svg>
                        </button>
                    </div>
                </div>
                <div class="b3-form__group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="msArchived" ${milestone?.archived ? 'checked' : ''} class="b3-switch">
                    <label class="b3-form__label" style="margin: 0;">${i18n('milestoneArchived')}</label>
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('milestoneNote')}</label>
                    <textarea id="msNote" class="b3-text-field" rows="4" placeholder="${i18n('milestoneNotePlaceholder') || ''}" style="width: 100%; resize: vertical;">${milestone?.note || ''}</textarea>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel" id="msCancel">${i18n('cancel')}</button>
                <button class="b3-button b3-button--primary" id="msSave">${i18n('save')}</button>
            </div>
        `,
        width: "400px"
    });

    const nameInput = dialog.element.querySelector('#msName') as HTMLInputElement;
    const iconInput = dialog.element.querySelector('#msIcon') as HTMLInputElement;
    const startTimeInput = dialog.element.querySelector('#msStartTime') as HTMLInputElement;
    const endTimeInput = dialog.element.querySelector('#msEndTime') as HTMLInputElement;
    const blockIdInput = dialog.element.querySelector('#msBlockId') as HTMLInputElement;
    const archivedInput = dialog.element.querySelector('#msArchived') as HTMLInputElement;
    const noteInput = dialog.element.querySelector('#msNote') as HTMLTextAreaElement;
    const saveBtn = dialog.element.querySelector('#msSave') as HTMLButtonElement;
    const cancelBtn = dialog.element.querySelector('#msCancel') as HTMLButtonElement;
    const bindBlockBtn = dialog.element.querySelector('#msBindBlockBtn') as HTMLButtonElement;

    iconInput.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = iconInput.getBoundingClientRect();
        openEmoji({
            hideDynamicIcon: true,
            hideCustomIcon: true,
            position: {
                x: rect.left,
                y: rect.bottom
            },
            selectedCB: (emojiCode: string) => {
                if (!emojiCode) {
                    iconInput.value = '';
                    return;
                }
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                iconInput.value = String.fromCodePoint(...codePoints);
            }
        });
    });

    bindBlockBtn?.addEventListener('click', async () => {
        let defaultParentId: string | undefined;
        if (groupId) {
            const groups = await view.projectManager.getProjectCustomGroups(view.projectId);
            const group = groups.find((g: any) => g.id === groupId);
            if (group?.blockId) {
                defaultParentId = group.blockId;
            }
        }

        const blockBindingDialog = new BlockBindingDialog(view.plugin, (blockId: string) => {
            blockIdInput.value = blockId;
        }, {
            title: i18n('bindMilestoneBlock'),
            defaultTab: 'heading',
            defaultParentId: defaultParentId || blockIdInput.value,
            defaultProjectId: view.projectId,
            defaultCustomGroupId: groupId,
            defaultTitle: nameInput.value,
            forMilestone: true,
        });
        blockBindingDialog.show();
    });

    cancelBtn.addEventListener('click', () => dialog.destroy());
    saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) {
            showMessage(i18n('pleaseEnterMilestoneName') || '请输入里程碑名称');
            return;
        }

        let sortValue = milestone?.sort;
        if (sortValue === undefined) {
            if (currentMilestones && currentMilestones.length > 0) {
                const minSort = Math.min(...currentMilestones.map(m => m.sort || 0));
                sortValue = minSort - 1000;
            } else {
                sortValue = Date.now();
            }
        }

        const data = {
            id: milestone?.id || `ms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            icon: iconInput.value.trim(),
            startTime: startTimeInput.value || undefined,
            endTime: endTimeInput.value || undefined,
            blockId: blockIdInput.value.trim(),
            archived: archivedInput.checked,
            note: noteInput.value.trim(),
            sort: sortValue
        };

        const oldBlockId = milestone?.blockId;
        dialog.destroy();

        void (async () => {
            try {
                await saveMilestone(view, data, groupId);

                if (oldBlockId && oldBlockId !== data.blockId) {
                    await updateMilestoneBlockAttrs(view, oldBlockId);
                }
                if (data.blockId) {
                    await updateMilestoneBlockAttrs(view, data.blockId);
                }

                await Promise.resolve(onSave());
                showMessage(i18n('milestoneSaved'));
            } catch (error) {
                console.error('保存里程碑失败:', error);
                showMessage(i18n("operationFailed") || "操作失败");
            }
        })();
    });
}

export async function saveMilestone(view: any, milestone: any, groupId: string | null) {
    const projectManager = view.projectManager;
    if (groupId === null) {
        const projectData = await view.plugin.loadProjectData() || {};
        const project = projectData[view.projectId];
        if (project) {
            if (!project.milestones) project.milestones = [];
            const index = project.milestones.findIndex((m: any) => m.id === milestone.id);
            if (index !== -1) project.milestones[index] = milestone;
            else project.milestones.push(milestone);
            await view.plugin.saveProjectData(projectData);
        }
    } else {
        const groups = await projectManager.getProjectCustomGroups(view.projectId);
        const group = groups.find((g: any) => g.id === groupId);
        if (group) {
            if (!group.milestones) group.milestones = [];
            const index = group.milestones.findIndex((m: any) => m.id === milestone.id);
            if (index !== -1) group.milestones[index] = milestone;
            else group.milestones.push(milestone);
            await projectManager.setProjectCustomGroups(view.projectId, groups);
        }
    }
    window.dispatchEvent(new CustomEvent('reminderUpdated'));
}

export async function deleteMilestone(view: any, milestoneId: string, groupId: string | null) {
    const projectManager = view.projectManager;
    let deletedBlockId: string | undefined;

    if (groupId === null) {
        const projectData = await view.plugin.loadProjectData() || {};
        const project = projectData[view.projectId];
        if (project && project.milestones) {
            const milestone = project.milestones.find((m: any) => m.id === milestoneId);
            deletedBlockId = milestone?.blockId;
            project.milestones = project.milestones.filter((m: any) => m.id !== milestoneId);
            await view.plugin.saveProjectData(projectData);
        }
    } else {
        const groups = await projectManager.getProjectCustomGroups(view.projectId);
        const group = groups.find((g: any) => g.id === groupId);
        if (group && group.milestones) {
            const milestone = group.milestones.find((m: any) => m.id === milestoneId);
            deletedBlockId = milestone?.blockId;
            group.milestones = group.milestones.filter((m: any) => m.id !== milestoneId);
            await projectManager.setProjectCustomGroups(view.projectId, groups);
        }
    }

    try {
        const reminderData = await view.getReminders();
        let updatedCount = 0;
        const keys = Object.keys(reminderData);

        for (const key of keys) {
            const task = reminderData[key];
            if (!task) continue;

            let taskChanged = false;

            if (task.milestoneId === milestoneId) {
                delete task.milestoneId;
                taskChanged = true;
            }

            if (task.repeat && task.repeat.instanceModifications) {
                const mods = task.repeat.instanceModifications;
                for (const date in mods) {
                    if (mods[date] && mods[date].milestoneId === milestoneId) {
                        delete mods[date].milestoneId;
                        taskChanged = true;
                    }
                }
            }

            if (taskChanged) {
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            await saveReminders(view.plugin, reminderData);
        }
    } catch (err) {
        console.error('Failed to cleanup tasks for deleted milestone:', err);
    }

    if (deletedBlockId) {
        await updateMilestoneBlockAttrs(view, deletedBlockId);
    }

    window.dispatchEvent(new CustomEvent('reminderUpdated'));
    showMessage(i18n('milestoneDeleted'));
}

export async function updateMilestoneBlockAttrs(view: any, blockId: string) {
    if (!blockId) return;

    const projectData = await view.plugin.loadProjectData() || {};
    const project = projectData[view.projectId];
    const groups = await view.projectManager.getProjectCustomGroups(view.projectId);

    const milestoneIds: string[] = [];

    (project?.milestones || []).forEach((m: any) => {
        if (m.blockId === blockId) milestoneIds.push(m.id);
    });

    groups.forEach((g: any) => {
        (g.milestones || []).forEach((m: any) => {
            if (m.blockId === blockId) milestoneIds.push(m.id);
        });
    });

    const { updateMilestoneBindBlockAttrs } = await import('../../api');
    await updateMilestoneBindBlockAttrs(blockId, view.projectId, milestoneIds);
}
