<script lang="ts">
    import { onMount } from 'svelte';
    import { Dialog, confirm } from 'siyuan';
    import { i18n } from '../pluginInstance';
    import { pushMsg, pushErrMsg } from '../api';

    export let plugin: any;

    let subscriptions: any[] = [];
    let loading = true;
    let data: any = { subscriptions: {} };
    let groupedProjects: { [key: string]: any[] } = {};
    let categories: any[] = [];
    let projectManager: any;

    let syncingSubIds: { [key: string]: boolean } = {};
    let draggedIndex: number | null = null;
    let dropIndex: number | null = null;
    let dropPosition: 'above' | 'below' | null = null;

    onMount(async () => {
        await loadData();
    });

    async function loadData(silent = false) {
        if (!silent) loading = true;
        try {
            const { loadSubscriptions } = await import('../utils/icsSubscription');
            const { ProjectManager } = await import('../utils/projectManager');
            const { CategoryManager } = await import('../utils/categoryManager');

            projectManager = ProjectManager.getInstance(plugin);
            await projectManager.initialize();
            groupedProjects = projectManager.getProjectsGroupedByStatus();

            const categoryManager = CategoryManager.getInstance(plugin);
            await categoryManager.initialize();
            categories = categoryManager.getCategories();

            data = await loadSubscriptions(plugin);
            // Ensure data.subscriptions exists
            if (!data.subscriptions) data.subscriptions = {};
            subscriptions = Object.values(data.subscriptions);
        } catch (error) {
            console.error('Failed to load subscription data:', error);
            pushErrMsg(i18n('loadDataFailed'));
        } finally {
            if (!silent) loading = false;
        }
    }

    async function updateOrder() {
        const { saveSubscriptions } = await import('../utils/icsSubscription');
        const newSubDict: { [id: string]: any } = {};
        subscriptions.forEach(sub => {
            newSubDict[sub.id] = sub;
        });
        data.subscriptions = newSubDict;
        await saveSubscriptions(plugin, data);
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    function handleDragStart(index: number) {
        draggedIndex = index;
    }

    function handleDragOver(e: DragEvent, index: number) {
        e.preventDefault();
        if (draggedIndex === null) return;

        if (draggedIndex === index) {
            dropIndex = null;
            return;
        }

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }

        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        const newPos = e.clientY < midY ? 'above' : 'below';
        if (dropIndex !== index || dropPosition !== newPos) {
            dropIndex = index;
            dropPosition = newPos;
        }
    }

    function handleDragEnter(index: number) {
        if (draggedIndex === null || draggedIndex === index) return;
        dropIndex = index;
    }

    async function handleDrop(e: DragEvent, index: number) {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === index) return;

        const movedSub = subscriptions[draggedIndex];
        let newSubscriptions = [...subscriptions];
        newSubscriptions.splice(draggedIndex, 1);

        let targetIndex = newSubscriptions.indexOf(subscriptions[index]);
        if (dropPosition === 'below') {
            targetIndex += 1;
        }

        newSubscriptions.splice(targetIndex, 0, movedSub);
        subscriptions = newSubscriptions;

        await updateOrder();

        draggedIndex = null;
        dropIndex = null;
        dropPosition = null;
    }

    function handleDragEnd() {
        draggedIndex = null;
        dropIndex = null;
        dropPosition = null;
    }

    async function handleToggle(sub: any) {
        const { saveSubscriptions } = await import('../utils/icsSubscription');
        sub.enabled = !sub.enabled;
        data.subscriptions[sub.id] = sub;
        await saveSubscriptions(plugin, data);
        subscriptions = [...subscriptions];
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    async function handleSync(sub: any) {
        if (syncingSubIds[sub.id]) return;
        syncingSubIds[sub.id] = true;
        syncingSubIds = { ...syncingSubIds };
        try {
            const { saveSubscriptions, syncSubscription } = await import('../utils/icsSubscription');
            const result = await syncSubscription(plugin, sub);

            sub.lastSync = new Date().toISOString();
            sub.lastSyncStatus = result.success ? 'success' : 'error';

            if (!result.success) {
                sub.lastSyncError = result.error;
                data.subscriptions[sub.id] = sub;
                await saveSubscriptions(plugin, data);
                subscriptions = [...subscriptions];
                pushErrMsg(
                    `${i18n('subscriptionSyncError') || '订阅同步失败'}: ${
                        result.error || '解析订阅日历失败'
                    }`
                );
                return;
            }

            sub.lastSyncError = undefined;
            data.subscriptions[sub.id] = sub;
            await saveSubscriptions(plugin, data);
            await loadData(true);
            pushMsg(i18n('syncFinished'));
        } catch (error) {
            console.error('Failed to sync subscription:', error);
            pushErrMsg(
                `${i18n('subscriptionSyncError') || '订阅同步失败'}: ${
                    error.message || String(error)
                }`
            );
        } finally {
            delete syncingSubIds[sub.id];
            syncingSubIds = { ...syncingSubIds };
        }
    }

    async function handleDelete(sub: any) {
        const { removeSubscription, saveSubscriptions } = await import('../utils/icsSubscription');
        await confirm(
            i18n('confirmDeleteTitle') || '确认删除',
            i18n('confirmDeleteSubscription').replace('${name}', sub.name),
            async () => {
                await removeSubscription(plugin, sub.id);
                delete data.subscriptions[sub.id];
                await saveSubscriptions(plugin, data);

                let targetProjectId = sub.projectId;
                const projectData = await plugin.loadProjectData();
                if (projectData) {
                    if (targetProjectId && projectData[targetProjectId]) {
                        delete projectData[targetProjectId];
                    } else {
                        // fallback search
                        for (const pid in projectData) {
                            if (projectData[pid] && projectData[pid].subscriptionId === sub.id) {
                                targetProjectId = pid;
                                delete projectData[pid];
                                break;
                            }
                        }
                    }
                    if (targetProjectId) {
                        await plugin.saveProjectData(projectData);
                        window.dispatchEvent(new CustomEvent('projectUpdated', {
                            detail: { projectId: targetProjectId }
                        }));
                    }
                }

                subscriptions = subscriptions.filter(s => s.id !== sub.id);
                pushMsg(i18n('subscriptionDeleted'));
            }
        );
    }

    async function showEditSubscriptionDialog(subscription?: any) {
        const isEdit = !!subscription;
        const { saveSubscriptions, updateSubscriptionTaskMetadata } = await import(
            '../utils/icsSubscription'
        );

        const editDialog = new Dialog({
            title: isEdit ? i18n('editSubscription') : i18n('addSubscription'),
            content: `
                <div class="b3-dialog__content" style="padding: 16px;flex: 1;overflow-y: auto;">
                    <div class="fn__flex-column" style="gap: 12px;">
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionName')}</div>
                            <input class="b3-text-field fn__block" id="sub-name" value="${subscription?.name || ''}" placeholder="${i18n('pleaseEnterSubscriptionName')}">
                        </div>
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionType') || '订阅类型'}</div>
                            <select class="b3-select fn__block" id="sub-type">
                                <option value="ics" ${(!subscription?.type || subscription?.type === 'ics') ? 'selected' : ''}>ICS / iCalendar</option>
                                <option value="caldav" ${subscription?.type === 'caldav' ? 'selected' : ''}>CalDAV</option>
                            </select>
                        </div>
                        <div class="b3-label" id="sub-url-container" style="display: ${(!subscription?.type || subscription?.type === 'ics') ? 'block' : 'none'};">
                            <div class="b3-label__text">${i18n('subscriptionUrl')}</div>
                            <input class="b3-text-field fn__block" id="sub-url" value="${(!subscription?.type || subscription?.type === 'ics') ? (subscription?.url || '') : ''}" placeholder="${i18n('subscriptionUrlPlaceholder') || '输入ICS日历订阅链接'}">
                        </div>
                        <div class="b3-label" id="sub-provider-container" style="display: ${subscription?.type === 'caldav' ? 'block' : 'none'};">
                            <div class="b3-label__text">${i18n('calendarProvider') || '日历平台'}</div>
                            <select class="b3-select fn__block" id="sub-provider">
                                <option value="generic" ${(!subscription?.provider || subscription?.provider === 'generic') ? 'selected' : ''}>${i18n('genericCalendar') || '通用日历'}</option>
                                <option value="feishu" ${subscription?.provider === 'feishu' ? 'selected' : ''}>${i18n('feishuCalendar') || '飞书日历'}</option>
                                <option value="dingtalk" ${subscription?.provider === 'dingtalk' ? 'selected' : ''}>${i18n('dingtalkCalendar') || '钉钉日历'}</option>
                                <option value="wecom" ${subscription?.provider === 'wecom' ? 'selected' : ''}>${i18n('wecomCalendar') || '企业微信日历'}</option>
                                <option value="qq" ${subscription?.provider === 'qq' ? 'selected' : ''}>${i18n('qqCalendar') || 'QQ邮箱日历'}</option>
                            </select>
                        </div>
                        <div class="b3-label" id="sub-caldav-server-container" style="display: ${subscription?.type === 'caldav' ? 'block' : 'none'};">
                            <div class="b3-label__text">${i18n('caldavServer') || '服务器地址'}</div>
                            <input class="b3-text-field fn__block" id="sub-caldav-server" value="${subscription?.type === 'caldav' ? (subscription?.url || '') : ''}" placeholder="${i18n('caldavServerPlaceholder') || '请输入 CalDAV 服务器地址'}">
                        </div>
                        <div id="sub-caldav-auth-container" style="display: ${subscription?.type === 'caldav' ? 'block' : 'none'};">
                            <div class="b3-label">
                                <div class="b3-label__text">${i18n('username') || '用户名'}</div>
                                <input class="b3-text-field fn__block" id="sub-username" value="${subscription?.username || ''}" placeholder="${i18n('username') || '用户名'}">
                            </div>
                            <div class="b3-label" style="margin-top: 12px;">
                                <div class="b3-label__text">${i18n('password') || '密码/应用密码'}</div>
                                <div style="position: relative; display: flex; align-items: center;">
                                    <input class="b3-text-field fn__block" id="sub-password" type="password" value="${subscription?.password || ''}" placeholder="${i18n('password') || '密码/应用密码'}" style="padding-right: 30px;">
                                    <svg
                                        class="b3-tooltips b3-tooltips__nw"
                                        aria-label="${i18n('showPassword') || '显示密码'}"
                                        id="toggle-password-visibility"
                                        tabindex="0"
                                        role="button"
                                        style="position: absolute; right: 8px; cursor: pointer; opacity: 0.5; width: 14px; height: 14px; outline: none;"
                                    >
                                        <use xlink:href="#iconEye"></use>
                                    </svg>
                                </div>
                            </div>
                        </div>
                        <div class="b3-label" id="sub-caldav-permissions-container" style="display: ${subscription?.type === 'caldav' ? 'block' : 'none'};">
                            <div class="b3-label__text">${i18n('caldavPermissions') || '任务操作权限'}</div>
                            <div style="display: flex; gap: 24px; margin-top: 8px;">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" class="b3-checkbox" id="sub-caldav-editable" ${(subscription ? subscription.caldavEditable !== false : false) ? 'checked' : ''}>
                                    ${i18n('allowEditTasks') || '允许编辑任务'}
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" class="b3-checkbox" id="sub-caldav-deletable" ${(subscription ? subscription.caldavDeletable !== false : false) ? 'checked' : ''}>
                                    ${i18n('allowDeleteTasks') || '允许删除任务'}
                                </label>
                            </div>
                        </div>
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionSyncInterval')}</div>
                            <select class="b3-select fn__block" id="sub-interval" onchange="this.value === 'dailyAt' ? document.getElementById('sub-daily-time-container').style.display = 'block' : document.getElementById('sub-daily-time-container').style.display = 'none'">
                                <option value="manual" ${subscription?.syncInterval === 'manual' ? 'selected' : ''}>${i18n('manual')}</option>
                                <option value="15min" ${(!subscription || subscription?.syncInterval === '15min') ? 'selected' : ''}>${i18n('every15Minutes')}</option>
                                <option value="30min" ${subscription?.syncInterval === '30min' ? 'selected' : ''}>${i18n('every30Minutes')}</option>
                                <option value="hourly" ${subscription?.syncInterval === 'hourly' ? 'selected' : ''}>${i18n('everyHour')}</option>
                                <option value="4hour" ${subscription?.syncInterval === '4hour' ? 'selected' : ''}>${i18n('every4Hours')}</option>
                                <option value="12hour" ${subscription?.syncInterval === '12hour' ? 'selected' : ''}>${i18n('every12Hours')}</option>
                                <option value="daily" ${subscription?.syncInterval === 'daily' ? 'selected' : ''}>${i18n('everyDay')}</option>
                                <option value="dailyAt" ${subscription?.syncInterval === 'dailyAt' ? 'selected' : ''}>${i18n('dailyAt') || '每天指定时间'}</option>
                            </select>
                        </div>
                        <div class="b3-label" id="sub-daily-time-container" style="display: ${subscription?.syncInterval === 'dailyAt' ? 'block' : 'none'};">
                            <div class="b3-label__text">${i18n('dailySyncTime') || '同步时间'}</div>
                            <input class="b3-text-field fn__block" id="sub-daily-time" type="time" value="${subscription?.dailySyncTime || '08:00'}">
                        </div>
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionPriority')}</div>
                            <select class="b3-select fn__block" id="sub-priority">
                                <option value="none" ${!subscription?.priority || subscription?.priority === 'none' ? 'selected' : ''}>${i18n('noPriority')}</option>
                                <option value="high" ${subscription?.priority === 'high' ? 'selected' : ''}>${i18n('highPriority')}</option>
                                <option value="medium" ${subscription?.priority === 'medium' ? 'selected' : ''}>${i18n('mediumPriority')}</option>
                                <option value="low" ${subscription?.priority === 'low' ? 'selected' : ''}>${i18n('lowPriority')}</option>
                            </select>
                        </div>
                        <div style="display: flex; gap: 24px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" class="b3-checkbox" id="sub-show-sidebar" ${subscription?.showInSidebar === true ? 'checked' : ''}>
                                ${i18n('subscriptionShowInSidebar')}
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" class="b3-checkbox" id="sub-show-matrix" ${subscription?.showInMatrix === true ? 'checked' : ''}>
                                ${i18n('subscriptionShowInMatrix')}
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" class="b3-checkbox" id="sub-show-note-calendar" ${subscription?.showNoteInCalendar === true ? 'checked' : ''}>
                                ${i18n('subscriptionShowNoteInCalendar') || '在日历显示备注'}
                            </label>
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action" style="margin-top: 16px; flex-shrink: 0; display: flex; justify-content: flex-end;">
                        <button class="b3-button b3-button--cancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--text" id="confirm-sub">${i18n('save')}</button>
                </div>
            `,
            width: '500px',
            height: "67vh"
        });

        const confirmBtn = editDialog.element.querySelector('#confirm-sub');
        const cancelBtn = editDialog.element.querySelector('.b3-button--cancel');

        const subTypeSelect = editDialog.element.querySelector('#sub-type') as HTMLSelectElement;
        const subProviderSelect = editDialog.element.querySelector('#sub-provider') as HTMLSelectElement;
        const icsUrlContainer = editDialog.element.querySelector('#sub-url-container') as HTMLElement;
        const providerContainer = editDialog.element.querySelector('#sub-provider-container') as HTMLElement;
        const caldavServerContainer = editDialog.element.querySelector('#sub-caldav-server-container') as HTMLElement;
        const caldavAuthContainer = editDialog.element.querySelector('#sub-caldav-auth-container') as HTMLElement;
        const caldavServerInput = editDialog.element.querySelector('#sub-caldav-server') as HTMLInputElement;
        const caldavEditableInput = editDialog.element.querySelector('#sub-caldav-editable') as HTMLInputElement;
        const caldavDeletableInput = editDialog.element.querySelector('#sub-caldav-deletable') as HTMLInputElement;
        const caldavPermissionsContainer = editDialog.element.querySelector('#sub-caldav-permissions-container') as HTMLElement;

        const updateVisibility = () => {
            const isCalDav = subTypeSelect.value === 'caldav';
            icsUrlContainer.style.display = isCalDav ? 'none' : 'block';
            providerContainer.style.display = isCalDav ? 'block' : 'none';
            caldavServerContainer.style.display = isCalDav ? 'block' : 'none';
            caldavAuthContainer.style.display = isCalDav ? 'block' : 'none';
            caldavPermissionsContainer.style.display = isCalDav ? 'block' : 'none';
        };

        const updateCaldavPermissions = () => {
            if (subTypeSelect.value === 'caldav') {
                const provider = subProviderSelect.value;
                if (provider === 'wecom') {
                    caldavEditableInput.checked = true;
                    caldavEditableInput.disabled = true;
                    caldavDeletableInput.checked = true;
                    caldavDeletableInput.disabled = true;
                } else if (provider === 'qq') {
                    caldavEditableInput.checked = false;
                    caldavEditableInput.disabled = true;
                    caldavDeletableInput.checked = true;
                    caldavDeletableInput.disabled = true;
                } else if (provider === 'dingtalk' || provider === 'feishu') {
                    caldavEditableInput.checked = false;
                    caldavEditableInput.disabled = true;
                    caldavDeletableInput.disabled = false;
                    if (!subscription) {
                        caldavDeletableInput.checked = false;
                    } else {
                        caldavDeletableInput.checked = subscription.caldavDeletable === true;
                    }
                } else {
                    caldavEditableInput.disabled = false;
                    caldavDeletableInput.disabled = false;
                    if (!subscription) {
                        caldavEditableInput.checked = false;
                        caldavDeletableInput.checked = false;
                    } else {
                        caldavEditableInput.checked = subscription.caldavEditable !== false;
                        caldavDeletableInput.checked = subscription.caldavDeletable !== false;
                    }
                }
            }
        };

        const updateServerAddress = () => {
            if (subTypeSelect.value === 'caldav') {
                const provider = subProviderSelect.value;
                if (provider === 'feishu') {
                    caldavServerInput.value = 'https://caldav.feishu.cn';
                } else if (provider === 'dingtalk') {
                    caldavServerInput.value = 'https://calendar.dingtalk.com';
                } else if (provider === 'wecom') {
                    caldavServerInput.value = 'https://caldav.wecom.work';
                } else if (provider === 'qq') {
                    caldavServerInput.value = 'https://dav.qq.com';
                }
            }
        };

        subTypeSelect.addEventListener('change', () => {
            updateVisibility();
            updateServerAddress();
            updateCaldavPermissions();
        });

        subProviderSelect.addEventListener('change', () => {
            updateServerAddress();
            updateCaldavPermissions();
        });

        const togglePasswordVisibility = editDialog.element.querySelector('#toggle-password-visibility') as HTMLElement;
        const passwordInput = editDialog.element.querySelector('#sub-password') as HTMLInputElement;

        if (togglePasswordVisibility && passwordInput) {
            const toggleHandler = () => {
                const isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                
                const useElement = togglePasswordVisibility.querySelector('use');
                if (useElement) {
                    useElement.setAttribute('xlink:href', isPassword ? '#iconEyeoff' : '#iconEye');
                }
                
                togglePasswordVisibility.setAttribute('aria-label', isPassword ? (i18n('hidePassword') || '隐藏密码') : (i18n('showPassword') || '显示密码'));
            };
            togglePasswordVisibility.addEventListener('click', toggleHandler);
            togglePasswordVisibility.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    toggleHandler();
                }
            });
        }

        // Initialize checkboxes
        updateCaldavPermissions();

        confirmBtn?.addEventListener('click', async () => {
            const name = (
                editDialog.element.querySelector('#sub-name') as HTMLInputElement
            ).value.trim();
            const type = (
                editDialog.element.querySelector('#sub-type') as HTMLSelectElement
            ).value as 'ics' | 'caldav';
            const url = (
                type === 'caldav'
                    ? (editDialog.element.querySelector('#sub-caldav-server') as HTMLInputElement).value.trim()
                    : (editDialog.element.querySelector('#sub-url') as HTMLInputElement).value.trim()
            );
            const provider = (
                editDialog.element.querySelector('#sub-provider') as HTMLSelectElement
            ).value as 'generic' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';
            const username = (
                editDialog.element.querySelector('#sub-username') as HTMLInputElement
            )?.value.trim();
            const password = (
                editDialog.element.querySelector('#sub-password') as HTMLInputElement
            )?.value;
            const syncInterval = (
                editDialog.element.querySelector('#sub-interval') as HTMLSelectElement
            ).value as any;
            const priority = (
                editDialog.element.querySelector('#sub-priority') as HTMLSelectElement
            ).value as any;
            const showInSidebar = (
                editDialog.element.querySelector('#sub-show-sidebar') as HTMLInputElement
            ).checked;
            const showInMatrix = (
                editDialog.element.querySelector('#sub-show-matrix') as HTMLInputElement
            ).checked;
            const showNoteInCalendar = (
                editDialog.element.querySelector('#sub-show-note-calendar') as HTMLInputElement
            ).checked;
            const caldavEditable = caldavEditableInput ? caldavEditableInput.checked : false;
            const caldavDeletable = caldavDeletableInput ? caldavDeletableInput.checked : false;

            if (!name) {
                pushErrMsg(i18n('pleaseEnterSubscriptionName'));
                return;
            }
            if (!url) {
                pushErrMsg(
                    type === 'caldav'
                        ? (i18n('pleaseEnterCaldavServer') || '请输入服务器地址')
                        : i18n('pleaseEnterSubscriptionUrl')
                );
                return;
            }

            const dailySyncTime = syncInterval === 'dailyAt' 
                ? (editDialog.element.querySelector('#sub-daily-time') as HTMLInputElement)?.value || '08:00'
                : undefined;

            const subId = subscription?.id || (window as any).Lute?.NewNodeID?.() || `sub-${Date.now()}`;
            const isNew = !subscription;
            let projectId = subscription?.projectId || `quick_${Date.now()}`;

            // Load and ensure Folder "订阅日历" exists
            const { ProjectFolderManager } = await import('../utils/projectFolderManager');
            const folderManager = ProjectFolderManager.getInstance(plugin);
            await folderManager.initialize();
            let folder = folderManager.getFolders().find(f => f.name === '订阅日历');
            if (!folder) {
                folder = await folderManager.addFolder('订阅日历', '📂');
            }

            const projectData = await plugin.loadProjectData();
            const settings = plugin?.settings || {};
            const displayDefaults = {
                showCompletedSubtasks: settings.projectKanbanShowCompletedSubtasks !== false,
                showTaskCategories: settings.projectKanbanShowTaskCategories !== false,
                clipTitleToOneLine: settings.projectKanbanClipTitleToOneLine === true,
            };

            let maxSort = 0;
            Object.values(projectData).forEach((p: any) => {
                if (p && (p.folderId || '') === folder.id && typeof p.sort === 'number') {
                    if (p.sort > maxSort) {
                        maxSort = p.sort;
                    }
                }
            });
            const sort = isNew ? (maxSort + 10) : (projectData[projectId]?.sort || 0);

            const existingProj = projectData[projectId] || {};
            const project = {
                ...displayDefaults,
                ...existingProj,
                id: projectId,
                folderId: folder.id,
                title: `🗓 ${name}`,
                icon: '🗓',
                isSubscription: true,
                subscriptionId: subId,
                status: existingProj.status || 'doing',
                priority: existingProj.priority || 'none',
                categoryId: existingProj.categoryId || '',
                color: existingProj.color || '#4f46e5',
                updatedTime: new Date().toISOString(),
                sort: sort,
            };
            if (isNew) {
                project.createdTime = project.updatedTime;
            }
            projectData[projectId] = project;
            await plugin.saveProjectData(projectData);

            window.dispatchEvent(new CustomEvent('projectUpdated', {
                detail: { projectId, project }
            }));

            const subData = {
                id: subId,
                name,
                type,
                provider,
                url,
                username: type === 'caldav' ? username : undefined,
                password: type === 'caldav' ? password : undefined,
                syncInterval,
                dailySyncTime,
                projectId,
                priority,
                categoryId: '',
                showInSidebar,
                showInMatrix,
                showNoteInCalendar,
                caldavEditable: type === 'caldav' ? caldavEditable : undefined,
                caldavDeletable: type === 'caldav' ? caldavDeletable : undefined,
                tagIds: subscription?.tagIds || [],
                enabled: subscription ? subscription.enabled : true,
                createdAt: subscription?.createdAt || new Date().toISOString(),
                lastSync: subscription?.lastSync,
                lastSyncStatus: subscription?.lastSyncStatus,
                lastSyncError: subscription?.lastSyncError,
            };

            data.subscriptions[subData.id] = subData;
            await saveSubscriptions(plugin, data);

            if (!isNew) {
                await updateSubscriptionTaskMetadata(plugin, subData);
            }

            await loadData();
            editDialog.destroy();
            pushMsg(isNew ? i18n('subscriptionCreated') : i18n('subscriptionUpdated'));
        });

        cancelBtn?.addEventListener('click', () => {
            editDialog.destroy();
        });
    }
</script>

<div class="subscription-panel">
    <div class="panel-header">
        <div class="header-info">
            <h3 class="panel-title">{i18n('icsSubscription')}</h3>
            <div class="panel-desc">{@html i18n('icsSubscriptionDesc')}</div>
        </div>
        <button
            class="b3-button b3-button--outline fn__flex-center"
            on:click={() => showEditSubscriptionDialog()}
        >
            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
            {i18n('addSubscription')}
        </button>
    </div>

    {#if loading}
        <div class="loading-state">
            <svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg>
        </div>
    {:else if subscriptions.length === 0}
        <div class="empty-state">
            {i18n('noSubscriptions')}
        </div>
    {:else}
        <div class="subscription-list" class:is-dragging={draggedIndex !== null}>
            {#each subscriptions as sub, i (sub.id)}
                <div
                    class="subscription-card b3-card"
                    draggable="true"
                    on:dragstart={() => handleDragStart(i)}
                    on:dragover={e => handleDragOver(e, i)}
                    on:dragenter={() => handleDragEnter(i)}
                    on:drop={e => handleDrop(e, i)}
                    on:dragend={handleDragEnd}
                    class:dragging={draggedIndex === i}
                    class:drag-over-above={dropIndex === i && dropPosition === 'above'}
                    class:drag-over-below={dropIndex === i && dropPosition === 'below'}
                >
                    <div class="card-content">
                        <div class="sub-info">
                            <div class="sub-name">{sub.name}</div>
                            <div class="sub-url ariaLabel" aria-label={sub.url}>
                                {(sub.type || 'ics').toUpperCase()} · {sub.provider === 'feishu'
                                    ? i18n('feishuCalendar') || '飞书日历'
                                    : sub.provider === 'dingtalk'
                                      ? i18n('dingtalkCalendar') || '钉钉日历'
                                      : sub.provider === 'wecom'
                                        ? i18n('wecomCalendar') || '企业微信日历'
                                        : sub.provider === 'qq'
                                          ? i18n('qqCalendar') || 'QQ邮箱日历'
                                          : i18n('genericCalendar') || '通用日历'}
                                {#if sub.type === 'caldav'}
                                    ({sub.caldavEditable !== false ? '可编辑' : '不可编辑'} · {sub.caldavDeletable !== false ? '可删除' : '不可删除'})
                                {:else}
                                    ({i18n('readOnly') || '只读'})
                                {/if}
                                · {sub.url}
                            </div>
                            <div class="sub-meta">
                                {i18n('subscriptionSyncInterval')}: 
                                {#if sub.syncInterval === 'dailyAt' && sub.dailySyncTime}
                                    {i18n('dailyAt') || '每天指定时间'} ({sub.dailySyncTime})
                                {:else}
                                    {i18n(
                                        sub.syncInterval === '15min'
                                            ? 'every15Minutes'
                                            : sub.syncInterval === '30min'
                                              ? 'every30Minutes'
                                              : sub.syncInterval === 'hourly'
                                                ? 'everyHour'
                                                : sub.syncInterval === '4hour'
                                                  ? 'every4Hours'
                                                  : sub.syncInterval === '12hour'
                                                    ? 'every12Hours'
                                                    : sub.syncInterval === 'daily'
                                                      ? 'everyDay'
                                                      : 'manual'
                                    )}
                                {/if}
                                {#if sub.lastSync}
                                    | {i18n('subscriptionLastSync')}: {new Date(
                                        sub.lastSync
                                    ).toLocaleString()}
                                {/if}
                            </div>
                        </div>
                        <div class="card-actions">
                            <button
                                class="b3-button b3-button--outline ariaLabel"
                                on:click={() => handleToggle(sub)}
                                aria-label={sub.enabled
                                    ? i18n('disableSubscription')
                                    : i18n('enableSubscription')}
                            >
                                <svg class="b3-button__icon {!sub.enabled ? 'fn__opacity' : ''}">
                                    <use
                                        xlink:href={sub.enabled ? '#iconEye' : '#iconEyeoff'}
                                    ></use>
                                </svg>
                            </button>
                            <button
                                class="b3-button b3-button--outline ariaLabel"
                                on:click={() => handleSync(sub)}
                                disabled={syncingSubIds[sub.id]}
                                aria-label={i18n('syncNow')}
                            >
                                <svg
                                    class="b3-button__icon {syncingSubIds[sub.id]
                                        ? 'fn__rotate'
                                        : ''}"
                                >
                                    <use xlink:href="#iconRefresh"></use>
                                </svg>
                            </button>
                            <button
                                class="b3-button b3-button--outline ariaLabel"
                                on:click={() => showEditSubscriptionDialog(sub)}
                                aria-label={i18n('editSubscription')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconEdit"></use>
                                </svg>
                            </button>
                            <button
                                class="b3-button b3-button--outline ariaLabel"
                                on:click={() => handleDelete(sub)}
                                aria-label={i18n('deleteSubscription')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconTrashcan"></use>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .subscription-panel {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .panel-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
        gap: 16px;
    }

    .header-info {
        flex: 1 1 280px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .panel-header > .b3-button {
        flex: 0 0 auto;
        max-width: 100%;
    }

    .panel-title {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .panel-desc {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.5;
        opacity: 0.8;

        :global(a) {
            color: var(--b3-theme-primary);
            text-decoration: underline;
        }
    }

    .subscription-list {
        display: flex;
        flex-direction: column;
        gap: 8px;

        &.is-dragging {
            .subscription-card * {
                pointer-events: none;
            }
        }
    }

    .subscription-card {
        padding: 12px;
        transition:
            transform 0.2s,
            border 0.1s;
        margin: 0px;
        position: relative;
        cursor: grab;
        overflow: visible !important;

        &:active {
            cursor: grabbing;
        }

        &:hover {
            background-color: var(--b3-theme-background-shallow);
        }

        &.dragging {
            opacity: 0.4;
            background-color: var(--b3-theme-background-shallow);
        }

        &.drag-over-above {
            &::before {
                content: '';
                position: absolute;
                top: -6px;
                left: 0;
                right: 0;
                height: 4px;
                background-color: var(--b3-theme-primary);
                border-radius: 2px;
                z-index: 100;
                animation: pulse 1s infinite;
                box-shadow: 0 0 4px var(--b3-theme-primary);
            }
        }

        &.drag-over-below {
            &::after {
                content: '';
                position: absolute;
                bottom: -6px;
                left: 0;
                right: 0;
                height: 4px;
                background-color: var(--b3-theme-primary);
                border-radius: 2px;
                z-index: 100;
                animation: pulse 1s infinite;
                box-shadow: 0 0 4px var(--b3-theme-primary);
            }
        }
    }

    @keyframes pulse {
        0% {
            opacity: 0.6;
        }
        50% {
            opacity: 1;
        }
        100% {
            opacity: 0.6;
        }
    }

    .card-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: flex-start;
        width: 100%;
    }

    .sub-info {
        min-width: 0;
        overflow: hidden;
    }

    .sub-name {
        font-weight: 500;
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sub-url {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin-bottom: 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sub-meta {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .card-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }

    .loading-state,
    .empty-state {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 48px;
        color: var(--b3-theme-on-surface-light);
        font-style: italic;
    }
</style>
