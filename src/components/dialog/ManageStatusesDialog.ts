import { Dialog, showMessage, confirm } from "siyuan";
import { i18n } from "../../pluginInstance";
import { getLocalDateTimeString } from "../../utils/dateUtils";
import { saveReminders } from "../../utils/icsSubscription";

export async function showManageKanbanStatusesDialog(view: any) {
    const projectManager = view.projectManager;

    // 加载当前项目的状态配置
    let statuses = await projectManager.getProjectKanbanStatuses(view.projectId);

    const dialog = new Dialog({
        title: i18n('manageKanbanStatuses'),
        content: `
            <div class="manage-statuses-dialog">
                <div class="b3-dialog__content">
                    <div class="statuses-list" style="margin-bottom: 16px;">
                        <div class="statuses-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h4 style="margin: 0;">${i18n('existingStatuses')}</h4>
                            <button id="addStatusBtn" class="b3-button b3-button--small b3-button--primary">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newStatus')}
                            </button>
                        </div>
                        <div id="statusesContainer" class="statuses-container" style="max-height: 350px; overflow-y: auto;">
                            <!-- 状态列表将在这里动态生成 -->
                        </div>
                    </div>
                    <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px;">
                        ${i18n('kanbanStatusHint')}
                    </div>
                </div>
            </div>
        `,
        width: "480px",
        height: "auto"
    });

    const statusesContainer = dialog.element.querySelector('#statusesContainer') as HTMLElement;
    const addStatusBtn = dialog.element.querySelector('#addStatusBtn') as HTMLButtonElement;

    // 插入指示占位元素（用于显示拖拽时的插入位置）
    const placeholder = document.createElement('div');
    placeholder.className = 'status-insert-placeholder';
    placeholder.style.cssText = `
        height: 3px;
        background: var(--b3-theme-primary);
        border-radius: 2px;
        margin: 6px 0;
        display: none;
        transition: opacity 120ms ease;
    `;
    statusesContainer.appendChild(placeholder);

    let dragCounter = 0;

    statusesContainer.addEventListener('dragenter', (ev: DragEvent) => {
        ev.preventDefault();
        dragCounter++;
    });

    statusesContainer.addEventListener('dragleave', (ev: DragEvent) => {
        const related = (ev as any).relatedTarget as HTMLElement | null;
        if (!related || !statusesContainer.contains(related)) {
            dragCounter = 0;
            placeholder.style.display = 'none';
        } else {
            dragCounter = Math.max(0, dragCounter - 1);
        }
    });

    statusesContainer.addEventListener('dragover', (ev: DragEvent) => {
        ev.preventDefault();
        const items = Array.from(statusesContainer.querySelectorAll('.status-item')) as HTMLElement[];
        if (items.length === 0) {
            statusesContainer.appendChild(placeholder);
            placeholder.style.display = 'block';
            return;
        }

        let inserted = false;
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (ev.clientY < midY) {
                item.parentElement!.insertBefore(placeholder, item);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            statusesContainer.appendChild(placeholder);
        }
        placeholder.style.display = 'block';
    });

    statusesContainer.addEventListener('drop', async (ev: DragEvent) => {
        ev.preventDefault();
        placeholder.style.display = 'none';
        dragCounter = 0;
        const data = ev.dataTransfer?.getData('text/status-id') || ev.dataTransfer?.getData('text');
        if (!data) return;
        const draggedId = data as string;

        let beforeCount = 0;
        for (const child of Array.from(statusesContainer.children)) {
            if (child === placeholder) break;
            const el = child as HTMLElement;
            if (el.classList && el.classList.contains('status-item')) beforeCount++;
        }
        const insertIndex = beforeCount;

        const fromIndex = statuses.findIndex(s => s.id === draggedId);
        if (fromIndex === -1) return;
        const [moved] = statuses.splice(fromIndex, 1);
        statuses.splice(insertIndex, 0, moved);
        statuses.forEach((s, i) => { s.sort = i * 10; });
        
        await projectManager.setProjectKanbanStatuses(view.projectId, statuses);
        renderStatuses();
        await view.loadProject();
        view.kanbanStatuses = statuses;
        view._lastRenderedProjectId = null;
        view.queueLoadTasks();
        showMessage(i18n('statusOrderSaved'));
    });

    const renderStatuses = async () => {
        statusesContainer.innerHTML = '';

        if (statuses.length === 0) {
            statusesContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${i18n('noStatuses')}</div>`;
            return;
        }

        statuses.forEach((status, index) => {
            const statusItem = document.createElement('div');
            statusItem.className = 'status-item';
            statusItem.dataset.statusId = status.id;
            statusItem.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                margin-bottom: 8px;
                background: var(--b3-theme-surface-lighter);
                border: 1px solid var(--b3-theme-border);
                border-radius: 8px;
                transition: all 0.2s ease;
            `;

            statusItem.draggable = true;
            statusItem.addEventListener('dragstart', (e: DragEvent) => {
                try {
                    e.dataTransfer?.setData('text/status-id', status.id);
                } catch (err) { }
                e.dataTransfer!.effectAllowed = 'move';
                statusItem.classList.add('dragging');
                try {
                    const dragImage = statusItem.cloneNode(true) as HTMLElement;
                    dragImage.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    dragImage.style.transform = 'scale(0.98)';
                    dragImage.style.position = 'absolute';
                    dragImage.style.top = '-9999px';
                    document.body.appendChild(dragImage);
                    e.dataTransfer?.setDragImage(dragImage, 10, 10);
                    setTimeout(() => document.body.removeChild(dragImage), 0);
                } catch (err) { }
            });
            statusItem.addEventListener('dragend', () => {
                statusItem.classList.remove('dragging');
                placeholder.style.display = 'none';
            });

            const dragHandle = document.createElement('span');
            dragHandle.innerHTML = '⋮⋮';
            dragHandle.style.cssText = `
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                cursor: move;
                padding: 2px 4px;
                user-select: none;
            `;
            dragHandle.classList.add('ariaLabel');
            dragHandle.setAttribute('aria-label', i18n('dragToSort'));
            statusItem.appendChild(dragHandle);

            const colorDot = document.createElement('span');
            colorDot.style.cssText = `
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: ${status.color};
                border: 2px solid var(--b3-theme-surface);
                box-shadow: 0 0 0 1px var(--b3-theme-border);
                flex-shrink: 0;
            `;
            statusItem.appendChild(colorDot);

            const iconSpan = document.createElement('span');
            iconSpan.textContent = status.icon || '';
            iconSpan.style.cssText = `
                font-size: 16px;
                flex-shrink: 0;
                margin-left: 4px;
            `;
            statusItem.appendChild(iconSpan);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = status.name + (status.isFixed ? ` (${i18n('fixed')})` : '');
            nameSpan.style.cssText = `
                flex: 1;
                font-weight: 500;
                color: var(--b3-theme-on-surface);
                margin-left: 4px;
            `;
            statusItem.appendChild(nameSpan);

            const actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = 'display: flex; gap: 4px; align-items: center;';

            if (index > 0) {
                const moveUpBtn = document.createElement('button');
                moveUpBtn.className = 'b3-button b3-button--text';
                moveUpBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconUp"></use></svg>';
                moveUpBtn.classList.add('ariaLabel');
                moveUpBtn.setAttribute('aria-label', i18n('moveUp'));
                moveUpBtn.style.cssText = 'padding: 2px; min-width: unset;';
                moveUpBtn.addEventListener('click', async () => {
                    const currentIndex = statuses.findIndex(s => s.id === status.id);
                    if (currentIndex > 0) {
                        [statuses[currentIndex], statuses[currentIndex - 1]] = [statuses[currentIndex - 1], statuses[currentIndex]];
                        statuses.forEach((s, i) => { s.sort = i * 10; });
                        await projectManager.setProjectKanbanStatuses(view.projectId, statuses);
                        renderStatuses();
                        view.kanbanStatuses = statuses;
                        view._lastRenderedProjectId = null;
                        view.queueLoadTasks();
                    }
                });
                actionsDiv.appendChild(moveUpBtn);
            }

            if (index < statuses.length - 1) {
                const moveDownBtn = document.createElement('button');
                moveDownBtn.className = 'b3-button b3-button--text';
                moveDownBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconDown"></use></svg>';
                moveDownBtn.classList.add('ariaLabel');
                moveDownBtn.setAttribute('aria-label', i18n('moveDown'));
                moveDownBtn.style.cssText = 'padding: 2px; min-width: unset;';
                moveDownBtn.addEventListener('click', async () => {
                    const currentIndex = statuses.findIndex(s => s.id === status.id);
                    if (currentIndex < statuses.length - 1) {
                        [statuses[currentIndex], statuses[currentIndex + 1]] = [statuses[currentIndex + 1], statuses[currentIndex]];
                        statuses.forEach((s, i) => { s.sort = i * 10; });
                        await projectManager.setProjectKanbanStatuses(view.projectId, statuses);
                        renderStatuses();
                        view.kanbanStatuses = statuses;
                        view._lastRenderedProjectId = null;
                        view.queueLoadTasks();
                    }
                });
                actionsDiv.appendChild(moveDownBtn);
            }

            const editBtn = document.createElement('button');
            editBtn.className = 'b3-button b3-button--text';
            editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
            editBtn.classList.add('ariaLabel');
            editBtn.setAttribute('aria-label', status.isFixed ? i18n('editColor') : (i18n('edit') || '编辑'));
            editBtn.style.cssText = 'padding: 2px; min-width: unset;';
            editBtn.addEventListener('click', () => showEditStatusDialog(status));
            actionsDiv.appendChild(editBtn);

            if (!status.isFixed) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'b3-button b3-button--text';
                deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px; color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
                deleteBtn.classList.add('ariaLabel');
                deleteBtn.setAttribute('aria-label', i18n('delete'));
                deleteBtn.style.cssText = 'padding: 2px; min-width: unset;';
                deleteBtn.addEventListener('click', () => {
                    const confirmMsg = i18n('confirmDeleteStatus', { name: status.name });
                    confirm(i18n('confirm'), confirmMsg, async () => {
                        const tasksInStatus = view.tasks.filter((t: any) => view.getTaskStatus(t) === status.id);

                        if (tasksInStatus.length > 0) {
                            const otherStatuses = statuses.filter(s => s.id !== status.id && s.id !== 'completed');
                            if (otherStatuses.length === 0) {
                                showMessage(i18n('noOtherStatusToMove'));
                                return;
                            }

                            let defaultTargetStatus = otherStatuses.find(s => s.id !== 'doing');
                            if (!defaultTargetStatus) {
                                defaultTargetStatus = otherStatuses[0];
                            }

                            const moveDialog = new Dialog({
                                title: i18n('moveTasksTitle', { count: String(tasksInStatus.length) }),
                                content: `
                                    <div class="b3-dialog__content">
                                        <div class="b3-form__group">
                                            <label class="b3-form__label">${i18n('selectTargetStatus')}</label>
                                            <select id="targetStatusSelect" class="b3-select" style="width: 100%;">
                                                ${otherStatuses.map(s => `<option value="${s.id}" ${s.id === defaultTargetStatus?.id ? 'selected' : ''}>${s.icon || ''} ${s.name}</option>`).join('')}
                                            </select>
                                            <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">
                                                ${i18n('moveTasksHint', { count: String(tasksInStatus.length) })}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="b3-dialog__action">
                                        <button class="b3-button b3-button--cancel" id="cancelMoveBtn">${i18n('cancel')}</button>
                                        <button class="b3-button b3-button--primary" id="confirmMoveBtn">${i18n('confirm')}</button>
                                    </div>
                                `,
                                width: "360px",
                                height: "auto"
                            });

                            moveDialog.element.querySelector('#cancelMoveBtn')?.addEventListener('click', () => {
                                moveDialog.destroy();
                            });

                            moveDialog.element.querySelector('#confirmMoveBtn')?.addEventListener('click', async () => {
                                const targetStatusSelect = moveDialog.element.querySelector('#targetStatusSelect') as HTMLSelectElement;
                                const targetStatusId = targetStatusSelect.value;

                                const tasksToUpdate = [];
                                for (const task of tasksInStatus) {
                                    if (targetStatusId === 'completed') {
                                        task.kanbanStatus = 'completed';
                                        task.completed = true;
                                        view.syncCustomProgressOnCompletion(task, true);
                                        task.completedTime = getLocalDateTimeString(new Date());
                                    } else if (targetStatusId === 'doing') {
                                        task.completed = false;
                                        task.completedTime = undefined;
                                        task.kanbanStatus = 'doing';
                                    } else {
                                        task.completed = false;
                                        task.completedTime = undefined;
                                        task.kanbanStatus = targetStatusId;
                                    }
                                    tasksToUpdate.push(task);
                                }

                                await view.saveTasks(tasksToUpdate);
                                moveDialog.destroy();

                                statuses = await deleteStatusAndRefresh(view, statuses, status.id, projectManager);
                                renderStatuses();
                            });
                        } else {
                            statuses = await deleteStatusAndRefresh(view, statuses, status.id, projectManager);
                            renderStatuses();
                        }
                    });
                });
                actionsDiv.appendChild(deleteBtn);
            }

            statusItem.appendChild(actionsDiv);
            statusesContainer.appendChild(statusItem);
        });
    };

    const showEditStatusDialog = (status: any) => {
        const isFixed = status.isFixed;
        const editDialog = new Dialog({
            title: isFixed ? i18n('editStatusColor') : i18n('editStatus'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('statusName') || '状态名称'}</label>
                        <input type="text" id="editStatusName" class="b3-text-field" value="${status.name}" style="width: 100%;" ${isFixed ? 'disabled readonly' : ''}>
                        ${isFixed ? `<div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('fixedStatusCannotRename') || '固定状态不支持修改名称'}</div>` : ''}
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('statusIcon') || '状态图标'} <span style="font-weight: normal; color: var(--b3-theme-on-surface-light);">(${i18n('optional') || '可选'})</span></label>
                        <input type="text" id="editStatusIcon" class="b3-text-field" value="${status.icon || ''}" placeholder="${i18n('emojiIconExample') || '例如: 📋'}" style="width: 100%;">
                        <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('statusIconHint') || '使用 emoji 作为状态图标，留空则不显示图标'}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('statusColor') || '状态颜色'}</label>
                        <input type="color" id="editStatusColor" class="b3-text-field" value="${status.color}" style="width: 100%; height: 40px;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelEditBtn">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="saveEditBtn">${i18n('save')}</button>
                </div>
            `,
            width: "360px",
            height: "auto"
        });

        const nameInput = editDialog.element.querySelector('#editStatusName') as HTMLInputElement;
        const iconInput = editDialog.element.querySelector('#editStatusIcon') as HTMLInputElement;
        const colorInput = editDialog.element.querySelector('#editStatusColor') as HTMLInputElement;

        editDialog.element.querySelector('#cancelEditBtn')?.addEventListener('click', () => {
            editDialog.destroy();
        });

        editDialog.element.querySelector('#saveEditBtn')?.addEventListener('click', async () => {
            const newName = nameInput.value.trim();
            const newIcon = iconInput.value.trim();
            const newColor = colorInput.value;

            if (!isFixed && !newName) {
                showMessage(i18n('pleaseEnterStatusName') || '请输入状态名称');
                return;
            }

            const index = statuses.findIndex(s => s.id === status.id);
            if (index !== -1) {
                if (!isFixed) {
                    statuses[index].name = newName;
                }
                statuses[index].icon = newIcon || undefined;
                statuses[index].color = newColor;
                await projectManager.setProjectKanbanStatuses(view.projectId, statuses);
                renderStatuses();
                view.kanbanStatuses = statuses;
                view._lastRenderedProjectId = null;
                view.queueLoadTasks();
                showMessage(i18n('statusUpdated'));
            }

            editDialog.destroy();
        });
    };

    addStatusBtn.addEventListener('click', () => {
        const addDialog = new Dialog({
            title: i18n('newStatus'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('statusName') || '状态名称'}</label>
                        <input type="text" id="newStatusName" class="b3-text-field" placeholder="${i18n('pleaseEnterStatusName') || '请输入状态名称'}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('statusIcon') || '状态图标'} <span style="font-weight: normal; color: var(--b3-theme-on-surface-light);">(${i18n('optional') || '可选'})</span></label>
                        <input type="text" id="newStatusIcon" class="b3-text-field" placeholder="${i18n('emojiIconExample') || '例如: 📋'}" style="width: 100%;">
                        <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('statusIconHint') || '使用 emoji 作为状态图标，留空则不显示图标'}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('statusColor') || '状态颜色'}</label>
                        <input type="color" id="newStatusColor" class="b3-text-field" value="#3498db" style="width: 100%; height: 40px;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelAddBtn">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="confirmAddBtn">${i18n('save')}</button>
                </div>
            `,
            width: "360px",
            height: "auto"
        });

        const nameInput = addDialog.element.querySelector('#newStatusName') as HTMLInputElement;
        const iconInput = addDialog.element.querySelector('#newStatusIcon') as HTMLInputElement;
        const colorInput = addDialog.element.querySelector('#newStatusColor') as HTMLInputElement;

        addDialog.element.querySelector('#cancelAddBtn')?.addEventListener('click', () => {
            addDialog.destroy();
        });

        addDialog.element.querySelector('#confirmAddBtn')?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const icon = iconInput.value.trim();
            const color = colorInput.value;

            if (!name) {
                showMessage(i18n('pleaseEnterStatusName') || '请输入状态名称');
                return;
            }

            if (statuses.some(s => s.name === name)) {
                showMessage(i18n('statusNameExists') || '状态名称已存在');
                return;
            }

            const newStatus = {
                id: projectManager.generateKanbanStatusId(),
                name,
                color,
                icon: icon || undefined,
                isFixed: false,
                sort: statuses.length * 10
            };

            statuses.push(newStatus);
            await projectManager.setProjectKanbanStatuses(view.projectId, statuses);
            renderStatuses();
            view.kanbanStatuses = statuses;
            view._lastRenderedProjectId = null;
            view.queueLoadTasks();
            showMessage(i18n('statusCreated'));

            addDialog.destroy();
        });
    });

    renderStatuses();
}

async function deleteStatusAndRefresh(
    view: any,
    currentStatuses: any[],
    statusIdToDelete: string,
    projectManager: any
): Promise<any[]> {
    const updatedStatuses = currentStatuses.filter(s => s.id !== statusIdToDelete);
    updatedStatuses.forEach((s, i) => { s.sort = i * 10; });
    await projectManager.setProjectKanbanStatuses(view.projectId, updatedStatuses);
    view.kanbanStatuses = updatedStatuses;
    view._lastRenderedProjectId = null;
    await view.queueLoadTasks();
    showMessage(i18n('statusDeleted'));
    return updatedStatuses;
}
