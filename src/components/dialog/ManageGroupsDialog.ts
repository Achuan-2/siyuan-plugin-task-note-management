import { Dialog, showMessage, openEmoji } from "siyuan";
import { i18n } from "../../pluginInstance";
import { generateRandomColor } from "../../utils/uiUtils";
import { BlockBindingDialog } from "../BlockBindingDialog";
import { saveReminders } from "../../utils/icsSubscription";

export async function showManageGroupsDialog(view: any) {
    const dialog = new Dialog({
        title: i18n('manageCustomGroups'),
        content: `
            <div class="manage-groups-dialog">
                <div class="b3-dialog__content">
                    <div class="groups-filter" style="display: flex; align-items: center; ">
                        <label class="b3-label" style="display: flex; align-items: center; gap: 4px; cursor: pointer; flex: 1;">
                            <input type="checkbox" id="hideNoDoingGroupCb" class="b3-switch b3-switch--small" ${view.hideNoDoingGroups ? 'checked' : ''}>
                            <span style="font-size: 13px;">${i18n('hideNoDoingGroups')}</span>
                        </label>
                        <label class="b3-label" style="display: flex; align-items: center; gap: 4px; cursor: pointer; flex: 1;">
                            <input type="checkbox" id="hideNoTodayGroupCb" class="b3-switch b3-switch--small" ${view.hideNoTodayGroups ? 'checked' : ''}>
                            <span style="font-size: 13px;">${i18n('hideNoTodayGroups')}</span>
                        </label>
                    </div>
                    <div class="groups-list" style="margin-bottom: 16px;">
                        <div class="groups-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <h4 style="margin: 0;">${i18n('existingGroups')}</h4>
                            <button id="addGroupBtn" class="b3-button b3-button--small b3-button--primary">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newGroup')}
                            </button>
                        </div>
                        <div id="groupsContainer" class="groups-container" style="overflow-y: auto;">
                            <!-- 分组列表将在这里动态生成 -->
                        </div>
                    </div>

                    <div id="groupForm" class="group-form" style="display: none; padding: 16px; background: var(--b3-theme-surface-lighter); border-radius: 8px; border: 1px solid var(--b3-theme-border);">
                        <h4 id="formTitle" style="margin-top: 0;">${i18n('newGroup')}</h4>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('groupName')}</label>
                            <input type="text" id="groupNameInput" class="b3-text-field" placeholder="${i18n('pleaseEnterGroupName')}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('groupColor')}</label>
                            <div class="color-picker" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                <!-- 预设颜色选项 -->
                            </div>
                            <input type="color" id="groupColorInput" class="b3-text-field" value="#3498db" style="width: 100%; margin-top: 8px;">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('iconOptional')}</label>
                            <input type="text" id="groupIconInput" class="b3-text-field" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                        </div>
                        <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                            <button id="cancelFormBtn" class="b3-button b3-button--outline">${i18n('cancel')}</button>
                            <button id="saveGroupBtn" class="b3-button b3-button--primary">${i18n('save')}</button>
                        </div>
                    </div>
                </div>
            </div>
        `,
        width: "500px",
        height: "80vh"
    });

    // 获取DOM元素
    const groupsContainer = dialog.element.querySelector('#groupsContainer') as HTMLElement;
    const hideNoDoingGroupCb = dialog.element.querySelector('#hideNoDoingGroupCb') as HTMLInputElement;
    const hideNoTodayGroupCb = dialog.element.querySelector('#hideNoTodayGroupCb') as HTMLInputElement;
    view.manageGroupsHideNoDoingCheckbox = hideNoDoingGroupCb;
    view.manageGroupsHideNoTodayCheckbox = hideNoTodayGroupCb;
    view.syncGroupVisibilityCheckboxes();

    const updateFilters = async () => {
        await view.saveGroupVisibilitySettings(hideNoDoingGroupCb.checked, hideNoTodayGroupCb.checked);
        view.queueLoadTasks(); // 刷新看板内容
    };

    hideNoDoingGroupCb.addEventListener('change', updateFilters);
    hideNoTodayGroupCb.addEventListener('change', updateFilters);
    dialog.element.addEventListener('destroy', () => {
        view.manageGroupsHideNoDoingCheckbox = null;
        view.manageGroupsHideNoTodayCheckbox = null;
    });
    const addGroupBtn = dialog.element.querySelector('#addGroupBtn') as HTMLButtonElement;
    const groupForm = dialog.element.querySelector('#groupForm') as HTMLElement;
    const groupNameInput = dialog.element.querySelector('#groupNameInput') as HTMLInputElement;
    const groupColorInput = dialog.element.querySelector('#groupColorInput') as HTMLInputElement;
    const groupIconInput = dialog.element.querySelector('#groupIconInput') as HTMLInputElement;
    const cancelFormBtn = dialog.element.querySelector('#cancelFormBtn') as HTMLButtonElement;
    const saveGroupBtn = dialog.element.querySelector('#saveGroupBtn') as HTMLButtonElement;
    const colorPicker = dialog.element.querySelector('.color-picker') as HTMLElement;

    let editingGroupId: string | null = null;

    // 预设颜色选项
    const presetColors = [
        '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
        '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
        '#16a085', '#27ae60', '#2980b9', '#8e44ad'
    ];

    presetColors.forEach(color => {
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.cssText = `
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background-color: ${color};
            cursor: pointer;
            border: 2px solid transparent;
            transition: border-color 0.2s ease;
        `;
        colorOption.addEventListener('click', () => {
            colorPicker.querySelectorAll('.color-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            colorOption.classList.add('selected');
            groupColorInput.value = color;
        });
        colorPicker.appendChild(colorOption);
    });

    // 加载并显示现有分组
    await loadAndDisplayGroups(view, groupsContainer);

    // 新建分组按钮：改为弹出独立的创建分组对话框（而不是页面内联表单）
    addGroupBtn.addEventListener('click', async () => {
        try {
            await createGroupDialog(view, groupsContainer);
        } catch (err) {
            console.error(i18n('openCreateGroupFailed'), err);
            showMessage(i18n('openCreateGroupFailed'));
        }
    });

    // 取消表单
    cancelFormBtn.addEventListener('click', () => {
        groupForm.style.display = 'none';
    });

    // 保存分组
    saveGroupBtn.addEventListener('click', async () => {
        const name = groupNameInput.value.trim();
        const color = groupColorInput.value;
        const icon = groupIconInput.value.trim();

        if (!name) {
            showMessage(i18n('pleaseEnterGroupName'));
            return;
        }

        try {
            // 获取当前项目的分组列表
            const { ProjectManager } = await import('../../utils/projectManager');
            const projectManager = ProjectManager.getInstance(view.plugin);
            const currentGroups = await projectManager.getProjectCustomGroups(view.projectId);

            let newGroup;
            if (editingGroupId) {
                // 编辑现有分组
                const groupIndex = currentGroups.findIndex((g: any) => g.id === editingGroupId);
                if (groupIndex !== -1) {
                    currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon };
                    newGroup = currentGroups[groupIndex];
                }
                showMessage(i18n('groupUpdated'));
            } else {
                // 创建新分组
                const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                newGroup = {
                    id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    name,
                    color,
                    icon,
                    sort: maxSort + 10
                };
                currentGroups.push(newGroup);
                showMessage(i18n('groupCreated'));
            }

            // 保存到项目数据
            await projectManager.setProjectCustomGroups(view.projectId, currentGroups);

            // 刷新分组列表
            await loadAndDisplayGroups(view, groupsContainer);
            groupForm.style.display = 'none';

            // 刷新看板（使用防抖队列）
            await view.loadProject();
            view.queueLoadTasks();
        } catch (error) {
            console.error(i18n('saveGroupFailed'), error);
            showMessage(i18n('saveGroupFailed'));
        }
    });
}

export async function createGroupDialog(view: any, container: HTMLElement) {
    const dialog = new Dialog({
        title: i18n('newGroup'),
        content: `
            <div class="b3-dialog__content">
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('groupName')}</label>
                    <input type="text" id="newGroupName" class="b3-text-field" placeholder="${i18n('pleaseEnterGroupName')}" style="width: 100%;">
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('bindBlockId')} (${i18n('optional')})</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="newGroupBlockId" class="b3-text-field" placeholder="${i18n('pleaseEnterBlockId')}" style="flex: 1;">
                        <button class="b3-button b3-button--outline ariaLabel" id="editGroupBindBlockBtn" aria-label="${i18n('bindBlock')}">
                            <svg class="b3-button__icon" style="width: 16px; height: 16px;"><use xlink:href="#iconAdd"></use></svg>
                        </button>
                    </div>
                    <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('bindBlockIdHint')}</div>
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('groupColor')}</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="color" id="newGroupColor" class="b3-text-field" value="${generateRandomColor()}" style="width: 64px; height: 36px; padding: 2px 4px; cursor: pointer;">
                        <button type="button" id="newGroupColorRandom" class="b3-button b3-button--outline" style="flex-shrink: 0;">${i18n('randomColor') || '随机颜色'}</button>
                    </div>
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('iconOptional')}</label>
                    <input type="text" id="newGroupIcon" class="b3-text-field" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                </div>
                <div class="b3-form__group">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <label class="b3-form__label" style="margin: 0;">${i18n('taskStatus') || '任务状态'} (${i18n('optional')})</label>
                        <div style="display: flex; gap: 4px;">
                            <button type="button" class="b3-button b3-button--text" id="newGroupStatusSelectAll" style="padding: 2px 6px; font-size: 12px;">${i18n('selectAll') || '全选'}</button>
                            <button type="button" class="b3-button b3-button--text" id="newGroupStatusResetDefault" style="padding: 2px 6px; font-size: 12px;">${i18n('default') || '默认'}</button>
                        </div>
                    </div>
                    <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('visibleStatusesForGroupHint') || '未勾选的状态将在该分组里隐藏'}</div>
                    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px;">
                        ${buildGroupStatusVisibilityOptionsHtml(view)}
                    </div>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel" id="newGroupCancel">${i18n('cancel')}</button>
                <button class="b3-button b3-button--primary" id="newGroupSave">${i18n('createGroup')}</button>
            </div>
        `,
        width: '420px'
    });

    const nameInput = dialog.element.querySelector('#newGroupName') as HTMLInputElement;
    const colorInput = dialog.element.querySelector('#newGroupColor') as HTMLInputElement;
    const randomColorBtn = dialog.element.querySelector('#newGroupColorRandom') as HTMLButtonElement;
    randomColorBtn?.addEventListener('click', () => {
        if (colorInput) colorInput.value = generateRandomColor();
    });
    const iconInput = dialog.element.querySelector('#newGroupIcon') as HTMLInputElement;
    const blockIdInput = dialog.element.querySelector('#newGroupBlockId') as HTMLInputElement;
    const bindBlockBtn = dialog.element.querySelector('#editGroupBindBlockBtn') as HTMLButtonElement;
    const cancelBtn = dialog.element.querySelector('#newGroupCancel') as HTMLButtonElement;
    const saveBtn = dialog.element.querySelector('#newGroupSave') as HTMLButtonElement;
    const statusSelectAllBtn = dialog.element.querySelector('#newGroupStatusSelectAll') as HTMLButtonElement;
    const statusResetDefaultBtn = dialog.element.querySelector('#newGroupStatusResetDefault') as HTMLButtonElement;

    // 图标选择事件
    iconInput?.addEventListener('click', (event: MouseEvent) => {
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
                    iconInput.value = "";
                    return;
                }
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                iconInput.value = String.fromCodePoint(...codePoints);
            }
        });
    });

    const setAllStatusCheckbox = (checked: boolean) => {
        const checkboxes = Array.from(dialog.element.querySelectorAll('.group-visible-status-checkbox')) as HTMLInputElement[];
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });
    };

    statusSelectAllBtn?.addEventListener('click', () => {
        setAllStatusCheckbox(true);
    });
    statusResetDefaultBtn?.addEventListener('click', () => {
        setAllStatusCheckbox(true);
    });

    // 绑定块按钮
    bindBlockBtn?.addEventListener('click', () => {
        const blockBindingDialog = new BlockBindingDialog(view.plugin, (blockId: string) => {
            blockIdInput.value = blockId;
        }, {
            defaultTab: 'document',
            defaultProjectId: view.projectId,
            defaultTitle: nameInput.value.trim(),
            forGroup: true
        });
        blockBindingDialog.show();
    });

    cancelBtn.addEventListener('click', () => dialog.destroy());

    saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const color = colorInput.value;
        const icon = iconInput.value.trim();
        const blockId = blockIdInput.value.trim();
        const selectedStatusIds = getSelectedVisibleStatusIds(dialog.element);

        if (!name) {
            showMessage(i18n('pleaseEnterGroupName'));
            return;
        }
        if (view.kanbanStatuses.length > 0 && selectedStatusIds.length === 0) {
            showMessage(i18n('pleaseSelectAtLeastOneStatus') || '请至少选择一个状态');
            return;
        }

        try {
            const projectManager = view.projectManager;
            const currentGroups = await projectManager.getProjectCustomGroups(view.projectId);

            const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
            const newGroup = {
                id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                name,
                color,
                icon,
                blockId: blockId || undefined,
                visibleStatusIds: selectedStatusIds.length === view.kanbanStatuses.length ? undefined : selectedStatusIds,
                sort: maxSort + 10
            };
            currentGroups.push(newGroup);
            await projectManager.setProjectCustomGroups(view.projectId, currentGroups);

            await loadAndDisplayGroups(view, container);
            view.queueLoadTasks();

            showMessage(i18n('groupCreated'));
            dialog.destroy();
        } catch (error) {
            console.error(i18n('createGroupFailed'), error);
            showMessage(i18n('createGroupFailed'));
        }
    });
}

export async function loadAndDisplayGroups(view: any, container: HTMLElement) {
    try {
        const projectManager = view.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(view.projectId);

        container.innerHTML = '';

        if (projectGroups.length === 0) {
            container.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${i18n('noCustomGroups')}</div>`;
            return;
        }

        const sortedGroups = projectGroups.sort((a: any, b: any) => {
            const archivedA = a.archived ? 1 : 0;
            const archivedB = b.archived ? 1 : 0;
            if (archivedA !== archivedB) {
                return archivedA - archivedB;
            }
            const sortA = typeof a.sort === 'number' ? a.sort : parseInt(a.sort, 10) || 0;
            const sortB = typeof b.sort === 'number' ? b.sort : parseInt(b.sort, 10) || 0;
            return sortA - sortB;
        });

        container.style.cssText += `
            position: relative;
        `;

        sortedGroups.forEach((group: any) => {
            const groupItem = document.createElement('div');
            groupItem.className = 'group-item';
            groupItem.dataset.groupId = group.id;
            groupItem.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                margin-bottom: 8px;
                background: var(--b3-theme-surface-lighter);
                border: 1px solid var(--b3-theme-border);
                border-radius: 8px;
                transition: background-color 0.2s ease;
                cursor: move;
                min-height: 48px;
            `;

            const groupInfo = document.createElement('div');
            groupInfo.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                flex: 1;
                min-width: 0;
            `;

            const dragHandle = document.createElement('span');
            dragHandle.className = 'group-drag-handle';
            dragHandle.innerHTML = '⋮⋮';
            dragHandle.style.cssText = `
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                cursor: move;
                padding: 4px 6px;
                margin-right: 8px;
                border-radius: 4px;
                transition: all 0.2s ease;
                user-select: none;
            `;
            dragHandle.classList.add('ariaLabel');
            dragHandle.setAttribute('aria-label', i18n('dragToSort'));

            dragHandle.draggable = true;
            dragHandle.addEventListener('mouseenter', () => {
                dragHandle.style.backgroundColor = 'var(--b3-theme-surface)';
                dragHandle.style.opacity = '0.8';
            });

            dragHandle.addEventListener('mouseleave', () => {
                dragHandle.style.backgroundColor = 'transparent';
                dragHandle.style.opacity = '0.6';
            });

            dragHandle.addEventListener('dragstart', (e) => {
                view.draggedGroupId = group.id;
                groupItem.style.opacity = '0.5';
                groupItem.style.cursor = 'grabbing';
                if (e.dataTransfer) {
                    try {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', group.id);
                    } catch (err) { }
                }
            });

            dragHandle.addEventListener('dragend', () => {
                view.draggedGroupId = null;
                groupItem.style.opacity = '';
                groupItem.style.cursor = 'move';
                container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());
            });

            const groupIcon = document.createElement('span');
            groupIcon.textContent = group.icon || '';
            groupIcon.style.cssText = `
                font-size: 18px;
                flex-shrink: 0;
            `;

            const groupName = document.createElement('span');
            groupName.textContent = group.name;
            const hasBlockId = !!group.blockId;
            groupName.style.cssText = `
                font-weight: 500;
                color: ${hasBlockId ? 'var(--b3-protyle-inline-blockref-color)' : 'var(--b3-theme-on-surface)'};
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1;
                ${hasBlockId ? 'cursor: pointer; text-decoration: underline dotted;' : ''}
                ${group.archived ? 'text-decoration: line-through; opacity: 0.6;' : ''}
            `;
            if (hasBlockId) {
                groupName.dataset.type = 'a';
                groupName.dataset.href = `siyuan://blocks/${group.blockId}`;
                groupName.classList.add('ariaLabel');
                groupName.setAttribute('aria-label', `${group.name} (点击打开绑定块)`);
            } else {
                groupName.classList.add('ariaLabel');
                groupName.setAttribute('aria-label', group.name);
            }

            if (group.archived) {
                const archivedTag = document.createElement('span');
                archivedTag.textContent = i18n('archived') || '已归档';
                archivedTag.style.cssText = `
                    font-size: 11px;
                    padding: 1px 6px;
                    background: var(--b3-theme-surface);
                    border-radius: 4px;
                    opacity: 0.7;
                    flex-shrink: 0;
                    margin-right: 8px;
                `;
                groupInfo.appendChild(archivedTag);
            }

            const groupColor = document.createElement('div');
            groupColor.style.cssText = `
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background-color: ${group.color};
                border: 2px solid var(--b3-theme-surface);
                box-shadow: 0 0 0 1px var(--b3-theme-border);
                flex-shrink: 0;
            `;

            groupInfo.appendChild(dragHandle);
            groupInfo.appendChild(groupIcon);
            groupInfo.appendChild(groupColor);
            groupInfo.appendChild(groupName);

            const groupActions = document.createElement('div');
            groupActions.style.cssText = `
                display: flex;
                gap: 8px;
                align-items: center;
            `;

            const archiveBtn = document.createElement('button');
            archiveBtn.className = 'b3-button b3-button--small b3-button--outline';
            archiveBtn.innerHTML = group.archived
                ? '<svg class="b3-button__icon"><use xlink:href="#iconUndo"></use></svg>'
                : '<svg class="b3-button__icon"><use xlink:href="#iconLock"></use></svg>';
            archiveBtn.classList.add('ariaLabel');
            archiveBtn.setAttribute('aria-label', group.archived
                ? (i18n('unarchiveGroup') || '取消归档')
                : (i18n('archiveGroup') || '归档分组'));
            archiveBtn.style.cssText = `
                display: inline-flex;
                align-items: center;
                padding: 4px 8px;
                font-size: 12px;
            `;
            archiveBtn.addEventListener('click', async () => {
                try {
                    const projectManager = view.projectManager;
                    const currentGroups = await projectManager.getProjectCustomGroups(view.projectId);
                    const groupIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                    if (groupIndex !== -1) {
                        currentGroups[groupIndex].archived = !group.archived;
                        await projectManager.setProjectCustomGroups(view.projectId, currentGroups);
                        await loadAndDisplayGroups(view, container);
                        view.queueLoadTasks();
                        showMessage(group.archived
                            ? (i18n('groupUnarchived') || '分组已取消归档')
                            : (i18n('groupArchived') || '分组已归档'));
                        view.dispatchReminderUpdate();
                    }
                } catch (error) {
                    console.error(i18n('archiveUnarchiveGroupFailed'), error);
                    showMessage(i18n('archiveUnarchiveGroupFailed'));
                }
            });

            const editBtn = document.createElement('button');
            editBtn.className = 'b3-button b3-button--small b3-button--outline';
            editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
            editBtn.classList.add('ariaLabel');
            editBtn.setAttribute('aria-label', i18n('editGroup'));
            editBtn.style.cssText = `
                display: inline-flex;
                align-items: center;
                padding: 4px 8px;
                font-size: 12px;
            `;
            editBtn.addEventListener('click', () => {
                editGroup(view, group, groupItem, container);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'b3-button b3-button--outline';
            deleteBtn.innerHTML = '<svg class="b3-button__icon" style="color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
            deleteBtn.classList.add('ariaLabel');
            deleteBtn.setAttribute('aria-label', i18n('deleteGroup'));
            deleteBtn.style.cssText = `
                display: inline-flex;
                align-items: center;
                padding: 4px 8px;
                font-size: 12px;
            `;
            deleteBtn.addEventListener('click', () => {
                deleteGroup(view, group.id, groupItem, container);
            });

            const convertBtn = document.createElement('button');
            convertBtn.className = 'b3-button b3-button--small b3-button--outline';
            convertBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconProject"></use></svg>';
            convertBtn.classList.add('ariaLabel');
            convertBtn.setAttribute('aria-label', i18n('convertGroupToProject'));
            convertBtn.style.cssText = `
                display: inline-flex;
                align-items: center;
                padding: 4px 8px;
                font-size: 12px;
            `;
            convertBtn.addEventListener('click', () => {
                convertGroupToProject(view, group, groupItem, container);
            });

            groupActions.appendChild(archiveBtn);
            groupActions.appendChild(editBtn);
            groupActions.appendChild(convertBtn);
            groupActions.appendChild(deleteBtn);

            groupItem.appendChild(groupInfo);
            groupItem.appendChild(groupActions);

            container.appendChild(groupItem);

            groupItem.addEventListener('mouseenter', () => {
                groupItem.style.backgroundColor = 'var(--b3-theme-surface)';
                groupItem.style.borderColor = 'var(--b3-theme-primary)';
            });

            groupItem.addEventListener('mouseleave', () => {
                groupItem.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
                groupItem.style.borderColor = 'var(--b3-theme-border)';
            });

            addGroupDragAndDrop(view, groupItem, group, container);
        });
    } catch (error) {
        console.error(i18n('loadGroupsFailed'), error);
        container.innerHTML = `<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">${i18n('loadGroupsFailed')}</div>`;
    }
}

export async function editGroup(view: any, group: any, _groupItem: HTMLElement, container: HTMLElement) {
    const dialog = new Dialog({
        title: i18n('editGroup'),
        content: `
            <div class="b3-dialog__content">
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('groupName')}</label>
                    <input type="text" id="editGroupName" class="b3-text-field" value="${group.name}" style="width: 100%;">
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('bindBlockId')} (${i18n('optional')})</label>
                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                        <input type="text" id="editGroupBlockId" class="b3-text-field" value="${group.blockId || ''}" placeholder="${i18n('pleaseEnterBlockId')}" style="flex: 1;">
                        <button class="b3-button b3-button--outline ariaLabel" id="editGroupBindBlockBtn" aria-label="${i18n('bindBlock')}">
                            <svg class="b3-button__icon" style="width: 16px; height: 16px;"><use xlink:href="#iconAdd"></use></svg>
                        </button>
                    </div>
                    <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('bindBlockIdHint')}</div>
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('groupColor')}</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="color" id="editGroupColor" class="b3-text-field" value="${group.color || generateRandomColor()}" style="width: 64px; height: 36px; padding: 2px 4px; cursor: pointer;">
                        <button type="button" id="editGroupColorRandom" class="b3-button b3-button--outline" style="flex-shrink: 0;">${i18n('randomColor') || '随机颜色'}</button>
                    </div>
                </div>
                <div class="b3-form__group">
                    <label class="b3-form__label">${i18n('iconOptional')}</label>
                    <input type="text" id="editGroupIcon" class="b3-text-field" value="${group.icon || ''}" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                </div>
                <div class="b3-form__group">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <label class="b3-form__label" style="margin: 0;">${i18n('taskStatus') || '任务状态'} (${i18n('optional')})</label>
                        <div style="display: flex; gap: 4px;">
                            <button type="button" class="b3-button b3-button--text" id="editGroupStatusSelectAll" style="padding: 2px 6px; font-size: 12px;">${i18n('selectAll') || '全选'}</button>
                            <button type="button" class="b3-button b3-button--text" id="editGroupStatusResetDefault" style="padding: 2px 6px; font-size: 12px;">${i18n('default') || '默认'}</button>
                        </div>
                    </div>
                    <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('visibleStatusesForGroupHint') || '未勾选的状态将在该分组里隐藏'}</div>
                    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px;">
                        ${buildGroupStatusVisibilityOptionsHtml(view, group)}
                    </div>
                </div>
                <div class="b3-form__group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="editGroupArchived" class="b3-switch" ${group.archived ? 'checked' : ''}>
                    <label class="b3-form__label" style="margin: 0;">${i18n('archived')}</label>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n('cancel')}</button>
                <button class="b3-button b3-button--primary" id="editSaveBtn">${i18n('save')}</button>
            </div>
        `,
        width: "400px"
    });

    const editGroupName = dialog.element.querySelector('#editGroupName') as HTMLInputElement;
    const editGroupBlockId = dialog.element.querySelector('#editGroupBlockId') as HTMLInputElement;
    const editGroupColor = dialog.element.querySelector('#editGroupColor') as HTMLInputElement;
    const editGroupColorRandom = dialog.element.querySelector('#editGroupColorRandom') as HTMLButtonElement;
    editGroupColorRandom?.addEventListener('click', () => {
        if (editGroupColor) editGroupColor.value = generateRandomColor();
    });
    const editGroupIcon = dialog.element.querySelector('#editGroupIcon') as HTMLInputElement;
    const editGroupArchived = dialog.element.querySelector('#editGroupArchived') as HTMLInputElement;
    const editCancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
    const editSaveBtn = dialog.element.querySelector('#editSaveBtn') as HTMLButtonElement;
    const editGroupBindBlockBtn = dialog.element.querySelector('#editGroupBindBlockBtn') as HTMLButtonElement;
    const editGroupStatusSelectAllBtn = dialog.element.querySelector('#editGroupStatusSelectAll') as HTMLButtonElement;
    const editGroupStatusResetDefaultBtn = dialog.element.querySelector('#editGroupStatusResetDefault') as HTMLButtonElement;

    // 图标选择事件
    editGroupIcon?.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = editGroupIcon.getBoundingClientRect();
        openEmoji({
            hideDynamicIcon: true,
            hideCustomIcon: true,
            position: {
                x: rect.left,
                y: rect.bottom
            },
            selectedCB: (emojiCode: string) => {
                if (!emojiCode) {
                    editGroupIcon.value = "";
                    return;
                }
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                editGroupIcon.value = String.fromCodePoint(...codePoints);
            }
        });
    });

    const setAllStatusCheckbox = (checked: boolean) => {
        const checkboxes = Array.from(dialog.element.querySelectorAll('.group-visible-status-checkbox')) as HTMLInputElement[];
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });
    };

    editGroupStatusSelectAllBtn?.addEventListener('click', () => {
        setAllStatusCheckbox(true);
    });
    editGroupStatusResetDefaultBtn?.addEventListener('click', () => {
        setAllStatusCheckbox(true);
    });

    // 绑定块按钮点击事件
    editGroupBindBlockBtn?.addEventListener('click', () => {
        const blockBindingDialog = new BlockBindingDialog(view.plugin, (blockId: string) => {
            editGroupBlockId.value = blockId;
        }, {
            title: i18n('bindGroupBlock'),
            defaultTab: 'heading',
            defaultParentId: editGroupBlockId.value,
            defaultProjectId: view.projectId,
            defaultCustomGroupId: group.id,
            defaultTitle: editGroupName.value,
            forGroup: true,
        });
        blockBindingDialog.show();
    });

    editCancelBtn.addEventListener('click', () => dialog.destroy());

    editSaveBtn.addEventListener('click', async () => {
        const name = editGroupName.value.trim();
        const blockId = editGroupBlockId.value.trim();
        const color = editGroupColor.value;
        const icon = editGroupIcon.value.trim();
        const archived = editGroupArchived.checked;
        const selectedStatusIds = getSelectedVisibleStatusIds(dialog.element);
        const normalizedCurrentVisibleStatusIds = normalizeGroupVisibleStatusIds(view, group.visibleStatusIds);
        const normalizedNextVisibleStatusIds = selectedStatusIds.length === view.kanbanStatuses.length ? [] : selectedStatusIds;
        const visibleStatusesChanged =
            normalizedCurrentVisibleStatusIds.length !== normalizedNextVisibleStatusIds.length ||
            normalizedCurrentVisibleStatusIds.some(statusId => !normalizedNextVisibleStatusIds.includes(statusId));

        if (!name) {
            showMessage(i18n('pleaseEnterGroupName'));
            return;
        }

        try {
            const projectManager = view.projectManager;
            const currentGroups = await projectManager.getProjectCustomGroups(view.projectId);

            const groupIndex = currentGroups.findIndex((g: any) => g.id === group.id);
            if (groupIndex !== -1) {
                // 如果块绑定变了，需要更新旧块和新块属性
                const oldBlockId = currentGroups[groupIndex].blockId;
                currentGroups[groupIndex] = {
                    ...currentGroups[groupIndex],
                    name,
                    color,
                    icon,
                    blockId: blockId || undefined,
                    archived,
                    visibleStatusIds: normalizedNextVisibleStatusIds
                };

                await projectManager.setProjectCustomGroups(view.projectId, currentGroups);

                // 更新块属性
                const { updateBindBlockAtrrs } = await import('../../api');
                if (oldBlockId && oldBlockId !== blockId) {
                    await updateBindBlockAtrrs(oldBlockId, view.projectId, null);
                }
                if (blockId) {
                    await updateBindBlockAtrrs(blockId, view.projectId, group.id);
                }

                showMessage(i18n('groupUpdated'));
                dialog.destroy();

                // 刷新分组列表
                await loadAndDisplayGroups(view, container);

                // 刷新看板（使用防抖队列）
                await view.loadProject();
                view.queueLoadTasks();
                view.dispatchReminderUpdate(true);
            }
        } catch (error) {
            console.error(i18n('saveGroupFailed'), error);
            showMessage(i18n('saveGroupFailed'));
        }
    });
}

export async function deleteGroup(view: any, groupId: string, _groupItem: HTMLElement, container: HTMLElement) {
    const projectGroups = await view.getProjectCustomGroupsForView();
    const groupToDelete = projectGroups.find((g: any) => g.id === groupId);

    if (!groupToDelete) {
        showMessage(i18n('groupNotExist'));
        return;
    }

    const otherGroups = projectGroups.filter((g: any) => g.id !== groupId);

    const reminderData = await view.getReminders();
    const tasksInGroup = Object.values(reminderData).filter((task: any) =>
        task && task.projectId === view.projectId && task.customGroupId === groupId
    );

    const hasTasks = tasksInGroup.length > 0;

    let confirmMessage = i18n('confirmDeleteGroup', { name: groupToDelete.name });

    if (hasTasks) {
        confirmMessage += `\n\n${i18n('groupHasTasks', { count: String(tasksInGroup.length) })}`;
    }

    const dialog = new Dialog({
        title: i18n('deleteGroup'),
        content: `
            <div class="delete-group-dialog" style="padding: 16px;">
                <div class="b3-dialog__content">
                    <p style="margin-bottom: 16px; white-space: pre-wrap;">${confirmMessage}</p>
                    ${hasTasks ? `
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('taskAction')}</label>
                            <div class="b3-form__group" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                                <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="radio" name="taskAction" value="ungroup" checked class="b3-radio">
                                    <span>${i18n('setTasksUngrouped')}</span>
                                </label>
                                <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="radio" name="taskAction" value="delete" class="b3-radio">
                                    <span>${i18n('deleteAllTasks')}</span>
                                </label>
                                ${otherGroups.length > 0 ? `
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                            <input type="radio" name="taskAction" value="move" class="b3-radio" id="moveActionRadio">
                                            <span>${i18n('moveTasksToOtherGroup')}</span>
                                        </label>
                                        <select id="targetGroupSelect" class="b3-select fn__flex-1" style="margin-left: 24px; visibility: hidden;">
                                            ${otherGroups.map((g: any) => `<option value="${g.id}">${g.name}</option>`).join('')}
                                        </select>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    ` : ''}
                </div>
                <div class="b3-dialog__action" style="margin-top: 24px;">
                    <button class="b3-button b3-button--cancel" id="deleteCancelBtn">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--error" id="deleteConfirmBtn">${i18n('deleteGroup')}</button>
                </div>
            </div>
        `,
        width: "450px"
    });

    if (hasTasks && otherGroups.length > 0) {
        const moveRadio = dialog.element.querySelector('#moveActionRadio') as HTMLInputElement;
        const targetSelect = dialog.element.querySelector('#targetGroupSelect') as HTMLSelectElement;
        const radios = dialog.element.querySelectorAll('input[name="taskAction"]');

        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                targetSelect.style.visibility = moveRadio.checked ? 'visible' : 'hidden';
            });
        });
    }

    const deleteCancelBtn = dialog.element.querySelector('#deleteCancelBtn') as HTMLButtonElement;
    const deleteConfirmBtn = dialog.element.querySelector('#deleteConfirmBtn') as HTMLButtonElement;

    deleteCancelBtn.addEventListener('click', () => dialog.destroy());

    deleteConfirmBtn.addEventListener('click', async () => {
        try {
            let taskAction: 'ungroup' | 'delete' | 'move' = 'ungroup';
            let targetGroupId: string | null = null;

            if (hasTasks) {
                const selectedAction = dialog.element.querySelector('input[name="taskAction"]:checked') as HTMLInputElement;
                taskAction = selectedAction.value as 'ungroup' | 'delete' | 'move';
                if (taskAction === 'move') {
                    const targetSelect = dialog.element.querySelector('#targetGroupSelect') as HTMLSelectElement;
                    targetGroupId = targetSelect.value;
                }
            }

            const updatedGroups = projectGroups.filter((g: any) => g.id !== groupId);
            await view.projectManager.setProjectCustomGroups(view.projectId, updatedGroups);

            if (hasTasks) {
                if (taskAction === 'delete') {
                    for (const task of tasksInGroup) {
                        const taskData = task as any;
                        await view.plugin.cancelMobileNotification(taskData.id);
                        delete reminderData[taskData.id];
                    }
                    showMessage(i18n('groupDeletedWithTasks', { count: String(tasksInGroup.length) }));
                } else if (taskAction === 'move' && targetGroupId) {
                    for (const task of tasksInGroup) {
                        const taskData = task as any;
                        taskData.customGroupId = targetGroupId;
                    }
                    showMessage(i18n('groupDeletedTasksMoved', { count: String(tasksInGroup.length) }));
                } else {
                    for (const task of tasksInGroup) {
                        const taskData = task as any;
                        delete taskData.customGroupId;
                    }
                    showMessage(i18n('groupDeletedTasksUngrouped', { count: String(tasksInGroup.length) }));
                }

                view.dispatchReminderUpdate(true);
                await saveReminders(view.plugin, reminderData);
            } else {
                showMessage(i18n('groupDeleted'));
            }

            await loadAndDisplayGroups(view, container);

            view._lastRenderedProjectId = null;
            await view.loadProject();
            view.queueLoadTasks();

            dialog.destroy();
        } catch (error) {
            console.error(i18n('deleteGroupFailed'), error);
            showMessage(i18n('deleteGroupFailed'));
            dialog.destroy();
        }
    });
}

export async function convertGroupToProject(view: any, group: any, _groupItem: HTMLElement, container: HTMLElement) {
    const reminderData = await view.getReminders();
    const tasksInGroup = Object.values(reminderData).filter((task: any) =>
        task && task.projectId === view.projectId && task.customGroupId === group.id
    );

    const taskCount = tasksInGroup.length;
    const confirmMsg = i18n('convertGroupToProjectConfirm', { name: group.name })
        + (taskCount > 0 ? `\n\n${i18n('groupHasTasks', { count: String(taskCount) })}` : '');

    const dialog = new Dialog({
        title: i18n('convertGroupToProject'),
        content: `
            <div style="padding: 16px;">
                <p style="white-space: pre-wrap; margin-bottom: 16px;">${confirmMsg}</p>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel" id="convertCancelBtn">${i18n('cancel')}</button>
                <button class="b3-button b3-button--primary" id="convertConfirmBtn">${i18n('convertGroupToProject')}</button>
            </div>
        `,
        width: "420px"
    });

    const cancelBtn = dialog.element.querySelector('#convertCancelBtn') as HTMLButtonElement;
    const confirmBtn = dialog.element.querySelector('#convertConfirmBtn') as HTMLButtonElement;

    cancelBtn.addEventListener('click', () => dialog.destroy());

    confirmBtn.addEventListener('click', async () => {
        try {
            const projectData = await view.plugin.loadProjectData();
            const newProjectId = `quick_${Date.now()}`;
            const emoji = group.icon || '';
            const title = emoji ? `${emoji} ${group.name}` : group.name;

            const parentProject = projectData[view.projectId];
            const parentFolderId = parentProject ? (parentProject.folderId || '') : '';
            const parentTags = parentProject ? (parentProject.tags || []) : [];

            let maxSort = 0;
            Object.values(projectData).forEach((p: any) => {
                if (p && (p.folderId || '') === parentFolderId && typeof p.sort === 'number') {
                    if (p.sort > maxSort) {
                        maxSort = p.sort;
                    }
                }
            });

            projectData[newProjectId] = {
                id: newProjectId,
                title: title,
                note: '',
                status: 'active',
                priority: 'none',
                color: group.color || '#3498db',
                createdTime: new Date().toISOString(),
                updatedTime: new Date().toISOString(),
                folderId: parentFolderId,
                sort: maxSort + 10,
                tags: parentTags,
            };
            await view.plugin.saveProjectData(projectData);

            if (taskCount > 0) {
                for (const task of tasksInGroup) {
                    const taskData = task as any;
                    taskData.projectId = newProjectId;
                    delete taskData.customGroupId;
                    delete taskData.customGroupName;
                }
                await saveReminders(view.plugin, reminderData);
            }

            const projectManager = view.projectManager;
            const currentGroups = await projectManager.getProjectCustomGroups(view.projectId);
            const updatedGroups = currentGroups.filter((g: any) => g.id !== group.id);
            await projectManager.setProjectCustomGroups(view.projectId, updatedGroups);

            await loadAndDisplayGroups(view, container);
            view._lastRenderedProjectId = null;
            await view.loadProject();
            view.queueLoadTasks();
            view.dispatchReminderUpdate(true);

            showMessage(i18n('convertGroupToProjectSuccess', { name: group.name, count: String(taskCount) }));
            dialog.destroy();

            window.dispatchEvent(new CustomEvent('projectUpdated', {
                detail: { projectId: newProjectId }
            }));
        } catch (error) {
            console.error('convert group failed:', error);
            showMessage(i18n('operationFailed'));
            dialog.destroy();
        }
    });
}

export function addGroupDragAndDrop(view: any, groupItem: HTMLElement, group: any, container: HTMLElement) {
    groupItem.draggable = true;

    groupItem.addEventListener('dragstart', (e) => {
        view.draggedGroupId = group.id;
        groupItem.classList.add('dragging');

        try {
            const clone = groupItem.cloneNode(true) as HTMLElement;
            clone.style.position = 'absolute';
            clone.style.top = '-9999px';
            clone.style.left = '-9999px';
            clone.style.width = `${groupItem.getBoundingClientRect().width}px`;
            clone.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
            document.body.appendChild(clone);
            view._groupDragImageEl = clone;

            if (e.dataTransfer) {
                try {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', group.id);
                    e.dataTransfer.setDragImage(clone, 10, 10);
                } catch (err) { }
            }
        } catch (err) { }
    });

    groupItem.addEventListener('dragend', () => {
        groupItem.classList.remove('dragging');
        view.draggedGroupId = null;

        container.querySelectorAll('.group-item').forEach((el) => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        if (view._groupDragImageEl && view._groupDragImageEl.parentNode) {
            view._groupDragImageEl.parentNode.removeChild(view._groupDragImageEl);
        }
        view._groupDragImageEl = null;

        if (view._groupDropIndicator && view._groupDropIndicator.parentNode) {
            view._groupDropIndicator.parentNode.removeChild(view._groupDropIndicator);
        }
        view._groupDropIndicator = null;
    });

    groupItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (err) { }

        if (view.draggedGroupId && view.draggedGroupId !== group.id) {
            const rect = groupItem.getBoundingClientRect();
            const mouseY = (e as DragEvent).clientY;
            const insertTop = mouseY < rect.top + rect.height / 2;

            if (!view._groupDropIndicator) {
                const ind = document.createElement('div');
                ind.className = 'group-drop-indicator';
                ind.style.position = 'absolute';
                ind.style.height = '3px';
                ind.style.backgroundColor = 'var(--b3-theme-primary)';
                ind.style.boxShadow = '0 0 8px var(--b3-theme-primary)';
                ind.style.zIndex = '2000';
                ind.style.pointerEvents = 'none';
                container.appendChild(ind);
                view._groupDropIndicator = ind;
            }

            const indicator = view._groupDropIndicator!;
            const containerRect = container.getBoundingClientRect();
            if (insertTop) {
                indicator.style.width = `${rect.width}px`;
                indicator.style.left = `${rect.left - containerRect.left}px`;
                indicator.style.top = `${rect.top - containerRect.top - 2}px`;
            } else {
                indicator.style.width = `${rect.width}px`;
                indicator.style.left = `${rect.left - containerRect.left}px`;
                indicator.style.top = `${rect.bottom - containerRect.top}px`;
            }
        }
    });

    groupItem.addEventListener('dragleave', (e) => {
        const rect = groupItem.getBoundingClientRect();
        const x = (e as DragEvent).clientX;
        const y = (e as DragEvent).clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            groupItem.classList.remove('drag-over-top', 'drag-over-bottom');
        }
    });

    groupItem.addEventListener('drop', async (e) => {
        e.preventDefault();
        groupItem.classList.remove('drag-over-top', 'drag-over-bottom');

        let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || view.draggedGroupId;
        if (!draggedId || draggedId === group.id) return;

        try {
            const { ProjectManager } = await import('../../utils/projectManager');
            const projectManager = ProjectManager.getInstance(view.plugin);
            const currentGroups = await projectManager.getProjectCustomGroups(view.projectId);

            const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
            const targetIndex = currentGroups.findIndex((g: any) => g.id === group.id);
            if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

            const rect = groupItem.getBoundingClientRect();
            const midPoint = rect.top + rect.height / 2;
            const insertBefore = (e as DragEvent).clientY < midPoint;

            let targetInsertIndex: number;
            if (insertBefore) {
                targetInsertIndex = targetIndex;
            } else {
                targetInsertIndex = targetIndex + 1;
            }

            if (draggedIndex < targetInsertIndex) {
                targetInsertIndex -= 1;
            }

            const [draggedGroup] = currentGroups.splice(draggedIndex, 1);
            currentGroups.splice(targetInsertIndex, 0, draggedGroup);

            currentGroups.forEach((g: any, index: number) => {
                g.sort = (index + 1) * 10;
            });

            await projectManager.setProjectCustomGroups(view.projectId, currentGroups);

            if (view._groupDropIndicator && view._groupDropIndicator.parentNode) {
                view._groupDropIndicator.parentNode.removeChild(view._groupDropIndicator);
            }
            view._groupDropIndicator = null;

            await loadAndDisplayGroups(view, container);
            view.queueLoadTasks();
            showMessage('分组顺序已更新');
        } catch (error) {
            console.error('更新分组顺序失败:', error);
            showMessage('更新分组顺序失败');
        }
    });
}

export function buildGroupStatusVisibilityOptionsHtml(view: any, group?: any): string {
    if (!view.kanbanStatuses || view.kanbanStatuses.length === 0) {
        return `<div style="padding: 8px 0; color: var(--b3-theme-on-surface-light);">${i18n('noStatus') || '暂无状态'}</div>`;
    }

    const visibleStatusIds = normalizeGroupVisibleStatusIds(view, group?.visibleStatusIds);
    const useAllVisible = visibleStatusIds.length === 0;
    const visibleStatusSet = new Set(visibleStatusIds);

    return view.kanbanStatuses.map((status: any) => {
        const isChecked = useAllVisible || visibleStatusSet.has(status.id);
        return `
            <label style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--b3-theme-border); border-radius: 6px; cursor: pointer;">
                <input type="checkbox" class="group-visible-status-checkbox b3-switch b3-switch--small" data-status-id="${status.id}" ${isChecked ? 'checked' : ''}>
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 18px;">${status.icon || ''}</span>
                <span style="font-size: 13px; color: ${status.color || 'var(--b3-theme-on-surface)'};">${status.name}</span>
            </label>
        `;
    }).join('');
}

export function getSelectedVisibleStatusIds(dialogElement: HTMLElement): string[] {
    const selected: string[] = [];
    const checkboxes = Array.from(dialogElement.querySelectorAll('.group-visible-status-checkbox')) as HTMLInputElement[];
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const statusId = checkbox.dataset.statusId;
            if (statusId) selected.push(statusId);
        }
    });
    return selected;
}

export function normalizeGroupVisibleStatusIds(view: any, rawStatusIds: any): string[] {
    if (!Array.isArray(rawStatusIds)) return [];
    const validStatusIdSet = new Set(view.kanbanStatuses.map((status: any) => status.id));
    const normalized: string[] = [];
    rawStatusIds.forEach((statusId: any) => {
        if (typeof statusId === 'string' && validStatusIdSet.has(statusId) && !normalized.includes(statusId)) {
            normalized.push(statusId);
        }
    });
    return normalized;
}
