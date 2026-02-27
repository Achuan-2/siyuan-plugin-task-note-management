<script lang="ts">
    import { onMount } from 'svelte';
    import { Dialog } from 'siyuan';
    import { i18n } from '../pluginInstance';
    import { pushMsg, pushErrMsg } from '../api';

    export let plugin: any;

    let subscriptions: any[] = [];
    let loading = true;
    let data: any = { subscriptions: {} };
    let groupedProjects: { [key: string]: any[] } = {};
    let categories: any[] = [];
    let projectManager: any;

    onMount(async () => {
        await loadData();
    });

    async function loadData() {
        loading = true;
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
            subscriptions = Object.values(data.subscriptions);
        } catch (error) {
            console.error('Failed to load subscription data:', error);
            pushErrMsg(i18n('loadDataFailed'));
        } finally {
            loading = false;
        }
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
        const { syncSubscription } = await import('../utils/icsSubscription');
        await syncSubscription(plugin, sub);
        await loadData();
        pushMsg(i18n('syncFinished'));
    }

    async function handleDelete(sub: any) {
        const { removeSubscription, saveSubscriptions } = await import('../utils/icsSubscription');
        if (confirm(i18n('confirmDeleteSubscription').replace('${name}', sub.name))) {
            await removeSubscription(plugin, sub.id);
            delete data.subscriptions[sub.id];
            await saveSubscriptions(plugin, data);
            subscriptions = subscriptions.filter(s => s.id !== sub.id);
            pushMsg(i18n('subscriptionDeleted'));
        }
    }

    async function showEditSubscriptionDialog(subscription?: any) {
        const isEdit = !!subscription;
        const { saveSubscriptions, updateSubscriptionTaskMetadata } = await import(
            '../utils/icsSubscription'
        );

        const editDialog = new Dialog({
            title: isEdit ? i18n('editSubscription') : i18n('addSubscription'),
            content: `
                <div class="b3-dialog__content" style="padding: 16px;">
                    <div class="fn__flex-column" style="gap: 12px;">
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionName')}</div>
                            <input class="b3-text-field fn__block" id="sub-name" value="${subscription?.name || ''}" placeholder="${i18n('pleaseEnterSubscriptionName')}">
                        </div>
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionUrl')}</div>
                            <input class="b3-text-field fn__block" id="sub-url" value="${subscription?.url || ''}" placeholder="${i18n('subscriptionUrlPlaceholder')}">
                        </div>
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionSyncInterval')}</div>
                            <select class="b3-select fn__block" id="sub-interval">
                                <option value="manual" ${subscription?.syncInterval === 'manual' ? 'selected' : ''}>${i18n('manual')}</option>
                                <option value="15min" ${subscription?.syncInterval === '15min' ? 'selected' : ''}>${i18n('every15Minutes')}</option>
                                <option value="30min" ${subscription?.syncInterval === '30min' ? 'selected' : ''}>${i18n('every30Minutes')}</option>
                                <option value="hourly" ${subscription?.syncInterval === 'hourly' ? 'selected' : ''}>${i18n('everyHour')}</option>
                                <option value="4hour" ${subscription?.syncInterval === '4hour' ? 'selected' : ''}>${i18n('every4Hours')}</option>
                                <option value="12hour" ${subscription?.syncInterval === '12hour' ? 'selected' : ''}>${i18n('every12Hours')}</option>
                                <option value="daily" ${subscription?.syncInterval === 'daily' || !subscription?.syncInterval ? 'selected' : ''}>${i18n('everyDay')}</option>
                            </select>
                        </div>
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionProject')} *</div>
                            <div class="fn__hr"></div>
                            <div style="display: flex; gap: 8px;">
                                <select class="b3-select fn__flex-1" id="sub-project" required>
                                    <option value="">${i18n('pleaseSelectProject')}</option>
                                    ${Object.entries(groupedProjects)
                                        .map(([statusId, statusProjects]) => {
                                            if (statusProjects.length === 0) return '';
                                            const status = projectManager
                                                .getStatusManager()
                                                .getStatusById(statusId);
                                            const label = status
                                                ? `${status.icon || ''} ${status.name}`
                                                : statusId;
                                            return `
                                        <optgroup label="${label}">
                                            ${statusProjects
                                                .map(
                                                    p => `
                                                <option value="${p.id}" ${subscription?.projectId === p.id ? 'selected' : ''}>${p.name}</option>
                                            `
                                                )
                                                .join('')}
                                        </optgroup>
                                    `;
                                        })
                                        .join('')}
                                </select>
                                <button class="b3-button b3-button--outline" id="sub-create-project" title="${i18n('createProject') || '新建项目'}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                </button>
                            </div>
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
                        <div class="b3-label">
                            <div class="b3-label__text">${i18n('subscriptionCategory')}</div>
                            <select class="b3-select fn__block" id="sub-category">
                                <option value="" ${!subscription?.categoryId ? 'selected' : ''}>${i18n('noCategory') || '无分类'}</option>
                                ${categories
                                    .map(
                                        c =>
                                            `<option value="${c.id}" ${subscription?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`
                                    )
                                    .join('')}
                            </select>
                        </div>
                        <div style="display: flex; gap: 24px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" class="b3-checkbox" id="sub-show-sidebar" ${subscription?.showInSidebar !== false ? 'checked' : ''}>
                                ${i18n('subscriptionShowInSidebar')}
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" class="b3-checkbox" id="sub-show-matrix" ${subscription?.showInMatrix !== false ? 'checked' : ''}>
                                ${i18n('subscriptionShowInMatrix')}
                            </label>
                        </div>
                    </div>
                    <div class="b3-dialog__action" style="margin-top: 16px;">
                        <button class="b3-button b3-button--cancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--text" id="confirm-sub">${i18n('save')}</button>
                    </div>
                </div>
            `,
            width: '500px',
        });

        const createProjectBtn = editDialog.element.querySelector(
            '#sub-create-project'
        ) as HTMLButtonElement;
        const projectSelect = editDialog.element.querySelector('#sub-project') as HTMLSelectElement;
        const confirmBtn = editDialog.element.querySelector('#confirm-sub');
        const cancelBtn = editDialog.element.querySelector('.b3-button--cancel');

        createProjectBtn?.addEventListener('click', async () => {
            try {
                const { ProjectDialog } = await import('./ProjectDialog');
                const projectDialog = new ProjectDialog(undefined, plugin);
                await projectDialog.show();

                const handleProjectCreated = async (event: CustomEvent) => {
                    await projectManager.initialize();
                    groupedProjects = projectManager.getProjectsGroupedByStatus();

                    projectSelect.innerHTML = `<option value="">${i18n('pleaseSelectProject')}</option>`;
                    Object.entries(groupedProjects).forEach(([statusId, statusProjects]) => {
                        if (statusProjects.length === 0) return;
                        const status = projectManager.getStatusManager().getStatusById(statusId);
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = status ? `${status.icon || ''} ${status.name}` : statusId;

                        statusProjects.forEach(p => {
                            const option = document.createElement('option');
                            option.value = p.id;
                            option.textContent = p.name;
                            optgroup.appendChild(option);
                        });
                        projectSelect.appendChild(optgroup);
                    });

                    if (event.detail && event.detail.projectId) {
                        projectSelect.value = event.detail.projectId;
                    }

                    window.removeEventListener(
                        'projectUpdated',
                        handleProjectCreated as EventListener
                    );
                };

                window.addEventListener('projectUpdated', handleProjectCreated as EventListener);
            } catch (error) {
                console.error('创建项目失败:', error);
            }
        });

        confirmBtn?.addEventListener('click', async () => {
            const name = (
                editDialog.element.querySelector('#sub-name') as HTMLInputElement
            ).value.trim();
            const url = (
                editDialog.element.querySelector('#sub-url') as HTMLInputElement
            ).value.trim();
            const syncInterval = (
                editDialog.element.querySelector('#sub-interval') as HTMLSelectElement
            ).value as any;
            const projectId = (
                editDialog.element.querySelector('#sub-project') as HTMLSelectElement
            ).value;
            const priority = (
                editDialog.element.querySelector('#sub-priority') as HTMLSelectElement
            ).value as any;
            const categoryId = (
                editDialog.element.querySelector('#sub-category') as HTMLSelectElement
            ).value;
            const showInSidebar = (
                editDialog.element.querySelector('#sub-show-sidebar') as HTMLInputElement
            ).checked;
            const showInMatrix = (
                editDialog.element.querySelector('#sub-show-matrix') as HTMLInputElement
            ).checked;

            if (!name) {
                pushErrMsg(i18n('pleaseEnterSubscriptionName'));
                return;
            }
            if (!url) {
                pushErrMsg(i18n('pleaseEnterSubscriptionUrl'));
                return;
            }
            if (!projectId) {
                pushErrMsg(i18n('pleaseSelectProject'));
                return;
            }

            const subData = {
                id: subscription?.id || (window as any).Lute?.NewNodeID?.() || `sub-${Date.now()}`,
                name,
                url,
                syncInterval,
                projectId,
                priority,
                categoryId,
                showInSidebar,
                showInMatrix,
                tagIds: subscription?.tagIds || [],
                enabled: subscription ? subscription.enabled : true,
                createdAt: subscription?.createdAt || new Date().toISOString(),
                lastSync: subscription?.lastSync,
                lastSyncStatus: subscription?.lastSyncStatus,
                lastSyncError: subscription?.lastSyncError,
            };

            data.subscriptions[subData.id] = subData;
            await saveSubscriptions(plugin, data);

            if (isEdit) {
                await updateSubscriptionTaskMetadata(plugin, subData);
            }

            await loadData();
            editDialog.destroy();
            pushMsg(isEdit ? i18n('subscriptionUpdated') : i18n('subscriptionCreated'));
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
            <div class="panel-desc">{i18n('icsSubscriptionDesc')}</div>
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
        <div class="subscription-list">
            {#each subscriptions as sub}
                <div class="subscription-card b3-card">
                    <div class="card-content">
                        <div class="sub-info">
                            <div class="sub-name">{sub.name}</div>
                            <div class="sub-url" title={sub.url}>{sub.url}</div>
                            <div class="sub-meta">
                                {i18n('subscriptionSyncInterval')}: {i18n(
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
                                                : 'everyDay'
                                )}
                                {#if sub.lastSync}
                                    | {i18n('subscriptionLastSync')}: {new Date(
                                        sub.lastSync
                                    ).toLocaleString()}
                                {/if}
                            </div>
                        </div>
                        <div class="card-actions">
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() => handleToggle(sub)}
                                title={sub.enabled
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
                                class="b3-button b3-button--outline"
                                on:click={() => handleSync(sub)}
                                title={i18n('syncNow')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconRefresh"></use>
                                </svg>
                            </button>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() => showEditSubscriptionDialog(sub)}
                                title={i18n('editSubscription')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconEdit"></use>
                                </svg>
                            </button>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() => handleDelete(sub)}
                                title={i18n('deleteSubscription')}
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
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
        gap: 16px;
    }

    .header-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
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
    }

    .subscription-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .subscription-card {
        padding: 12px;
        transition: transform 0.2s;
        margin: 0px;

        &:hover {
            background-color: var(--b3-theme-background-shallow);
        }
    }

    .card-content {
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
    }

    .sub-info {
        flex: 1;
        min-width: 0;
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
