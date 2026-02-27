<script lang="ts">
    import { onMount } from 'svelte';
    import { i18n } from '../pluginInstance';
    import { CategoryManager } from '../utils/categoryManager';
    import { ProjectManager } from '../utils/projectManager';
    import { showMessage, confirm } from 'siyuan';

    export let plugin: any;
    export let onClose: () => void;
    export let onFilterApplied: (filter: FilterConfig) => void;

    type DateFilterType =
        | 'all'
        | 'none'
        | 'yesterday'
        | 'today'
        | 'tomorrow'
        | 'this_week'
        | 'next_7_days'
        | 'future'
        | 'past_7_days'
        | 'custom_range';

    interface DateFilter {
        type: DateFilterType;
        startDate?: string;
        endDate?: string;
    }

    interface FilterConfig {
        id: string;
        name: string;
        isBuiltIn: boolean;
        dateFilters: DateFilter[];
        statusFilter: 'all' | 'completed' | 'uncompleted';
        projectFilters: string[];
        categoryFilters: string[];
        priorityFilters: string[];
    }

    let filters: FilterConfig[] = [];
    let selectedFilter: FilterConfig | null = null;
    let isEditing = false;

    // Drag and drop state
    let draggedFilterId: string | null = null;
    let dragTargetId: string | null = null;
    let dragPosition: 'above' | 'below' | null = null;
    let categoryManager: CategoryManager;
    let projectManager: ProjectManager;
    let categories: any[] = [];
    let projects: any[] = [];

    let filterName = '';
    let selectedDateFilters: DateFilterType[] = [];
    let customRangeStart = '';
    let customRangeEnd = '';
    let statusFilter: 'all' | 'completed' | 'uncompleted' = 'all';
    let selectedProjects: string[] = [];
    let selectedCategories: string[] = [];
    let selectedPriorities: string[] = [];

    onMount(async () => {
        categoryManager = CategoryManager.getInstance(plugin);
        projectManager = ProjectManager.getInstance(plugin);
        await categoryManager.initialize();
        await projectManager.initialize();

        // 获取所有分类
        categories = categoryManager.getCategories();

        // 获取所有未归档的项目，按状态分组顺序展示（与 QuickReminderDialog 保持一致）
        const groupedProjects = projectManager.getProjectsGroupedByStatus();
        projects = [];
        // 按照 getProjectsGroupedByStatus 返回的顺序遍历，保持与 QuickReminderDialog 一致的展示顺序
        Object.keys(groupedProjects).forEach(statusKey => {
            const statusProjects = groupedProjects[statusKey] || [];
            const nonArchivedProjects = statusProjects.filter(project => {
                const projectStatus = projectManager.getProjectById(project.id)?.status || 'doing';
                return projectStatus !== 'archived';
            });

            // 在每个状态组内排序：先按优先级，再按sort字段，再按时间
            nonArchivedProjects.sort((a, b) => {
                // 1. 按优先级排序
                const priorityOrder = { high: 3, medium: 2, low: 1, none: 0 };
                const priorityA = priorityOrder[a.priority || 'none'] || 0;
                const priorityB = priorityOrder[b.priority || 'none'] || 0;
                if (priorityA !== priorityB) {
                    return priorityB - priorityA; // 高优先级在前
                }

                // 2. 同优先级内按手动排序字段
                const sortA = a.sort || 0;
                const sortB = b.sort || 0;
                if (sortA !== sortB) {
                    return sortA - sortB; // sort值小的在前
                }

                // 3. 如果sort也相同，按时间排序
                const dateA = a.startDate || a.createdTime || '';
                const dateB = b.startDate || b.createdTime || '';
                return dateA.localeCompare(dateB);
            });

            projects = [...projects, ...nonArchivedProjects];
        });

        await loadFilters();
    });

    async function loadFilters() {
        const settings = await plugin.loadData('settings.json');
        const customFilters = settings?.customFilters || [];
        const filterOrder = settings?.filterOrder || [];

        const builtInFilters: FilterConfig[] = [
            {
                id: 'builtin_today',
                name: i18n('todayReminders') || '今日任务',
                isBuiltIn: true,
                dateFilters: [{ type: 'today' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_tomorrow',
                name: i18n('tomorrowReminders') || '明日任务',
                isBuiltIn: true,
                dateFilters: [{ type: 'tomorrow' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_future7',
                name: i18n('future7Reminders') || '未来七天',
                isBuiltIn: true,
                dateFilters: [{ type: 'next_7_days' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_thisWeek',
                name: i18n('thisWeekReminders') || '本周任务',
                isBuiltIn: true,
                dateFilters: [{ type: 'this_week' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_futureAll',
                name: i18n('futureReminders') || '未来任务',
                isBuiltIn: true,
                dateFilters: [{ type: 'future' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_overdue',
                name: i18n('overdueReminders') || '过期任务',
                isBuiltIn: true,
                dateFilters: [{ type: 'past_7_days' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_all',
                name: i18n('past7Reminders') || '过去七天',
                isBuiltIn: true,
                dateFilters: [{ type: 'past_7_days' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_allUncompleted',
                name: i18n('allUncompletedReminders'),
                isBuiltIn: true,
                dateFilters: [],
                statusFilter: 'uncompleted',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_noDate',
                name: i18n('noDateReminders'),
                isBuiltIn: true,
                dateFilters: [{ type: 'none' }],
                statusFilter: 'all',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_todayCompleted',
                name: i18n('todayCompletedReminders'),
                isBuiltIn: true,
                dateFilters: [{ type: 'today' }],
                statusFilter: 'completed',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_yesterdayCompleted',
                name: i18n('yesterdayCompletedReminders'),
                isBuiltIn: true,
                dateFilters: [{ type: 'yesterday' }],
                statusFilter: 'completed',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
            {
                id: 'builtin_completed',
                name: i18n('completedReminders'),
                isBuiltIn: true,
                dateFilters: [],
                statusFilter: 'completed',
                projectFilters: ['all'],
                categoryFilters: ['all'],
                priorityFilters: ['all'],
            },
        ];

        let allFilters = [...builtInFilters, ...customFilters];

        if (filterOrder && filterOrder.length > 0) {
            const filterMap = new Map(allFilters.map(f => [f.id, f]));
            const orderedFilters = [];

            // Add filters in the saved order
            for (const id of filterOrder) {
                if (filterMap.has(id)) {
                    orderedFilters.push(filterMap.get(id));
                    filterMap.delete(id);
                }
            }

            // Add any remaining filters (new built-ins or custom ones not in order list)
            for (const filter of filterMap.values()) {
                orderedFilters.push(filter);
            }

            filters = orderedFilters;
        } else {
            filters = allFilters;
        }
    }

    async function saveFilters() {
        const settings = (await plugin.loadData('settings.json')) || {};
        const customFilters = filters.filter(f => !f.isBuiltIn);
        settings.customFilters = customFilters;
        settings.filterOrder = filters.map(f => f.id);
        await plugin.saveData('settings.json', settings);
        // 通知父组件更新filterSelect
        onFilterApplied(null);
    }

    function selectFilter(filter: FilterConfig) {
        selectedFilter = filter;
        isEditing = true;

        filterName = filter.name;
        selectedDateFilters = filter.dateFilters.map(df => df.type);
        statusFilter = filter.statusFilter;
        selectedProjects = [...filter.projectFilters];
        selectedCategories = [...filter.categoryFilters];
        selectedPriorities = [...filter.priorityFilters];

        const customRange = filter.dateFilters.find(df => df.type === 'custom_range');
        if (customRange) {
            customRangeStart = customRange.startDate || '';
            customRangeEnd = customRange.endDate || '';
        } else {
            customRangeStart = '';
            customRangeEnd = '';
        }
    }

    function startNewFilter() {
        selectedFilter = null;
        isEditing = true;

        filterName = '';
        selectedDateFilters = ['all']; // 默认为全部日期
        customRangeStart = '';
        customRangeEnd = '';
        statusFilter = 'all';
        selectedProjects = ['all']; // 默认为全部项目
        selectedCategories = ['all']; // 默认为全部分类
        selectedPriorities = ['all']; // 默认为全部优先级
    }

    async function saveFilter() {
        if (!filterName.trim()) {
            showMessage(i18n('pleaseEnterFilterName'));
            return;
        }

        const dateFilters: DateFilter[] = selectedDateFilters.map(type => {
            if (type === 'custom_range') {
                return { type, startDate: customRangeStart, endDate: customRangeEnd };
            }
            return { type };
        });

        const newFilter: FilterConfig = {
            id: selectedFilter?.id || `custom_${Date.now()}`,
            name: filterName,
            isBuiltIn: false,
            dateFilters,
            statusFilter,
            projectFilters: selectedProjects,
            categoryFilters: selectedCategories,
            priorityFilters: selectedPriorities,
        };

        if (selectedFilter) {
            const index = filters.findIndex(f => f.id === selectedFilter.id);
            if (index !== -1) {
                filters[index] = newFilter;
            }
        } else {
            filters = [...filters, newFilter];
        }

        await saveFilters();
        showMessage(i18n('filterSaved'));
        isEditing = false;
        selectedFilter = null;
    }

    async function deleteFilter(filter: FilterConfig) {
        await confirm(
            i18n('deleteFilter') || '删除过滤器',
            i18n('confirmDeleteFilter')?.replace('${name}', filter.name) ||
                `确定要删除过滤器"${filter.name}"吗？`,
            async () => {
                // 用户确认删除
                filters = filters.filter(f => f.id !== filter.id);
                await saveFilters();
                showMessage(i18n('filterDeleted'));
                if (selectedFilter?.id === filter.id) {
                    selectedFilter = null;
                    isEditing = false;
                }
            }
        );
    }

    function toggleDateFilter(type: DateFilterType) {
        if (type === 'all') {
            // 点击"全部日期"，清空其他选择，只选择"全部"
            selectedDateFilters = ['all'];
        } else {
            // 点击具体日期
            if (selectedDateFilters.includes(type)) {
                // 取消选择该日期
                selectedDateFilters = selectedDateFilters.filter(t => t !== type);
            } else {
                // 选择该日期，同时移除"全部"选项
                selectedDateFilters = selectedDateFilters.filter(t => t !== 'all');
                selectedDateFilters = [...selectedDateFilters, type];
            }
        }
    }

    function toggleProject(projectId: string) {
        if (projectId === 'all') {
            // 点击"全部项目"，清空其他选择，只选择"全部"
            selectedProjects = ['all'];
        } else {
            // 点击具体项目
            if (selectedProjects.includes(projectId)) {
                // 取消选择该项目
                selectedProjects = selectedProjects.filter(id => id !== projectId);
            } else {
                // 选择该项目，同时移除"全部"选项
                selectedProjects = selectedProjects.filter(id => id !== 'all');
                selectedProjects = [...selectedProjects, projectId];
            }
        }
    }

    function toggleCategory(categoryId: string) {
        if (categoryId === 'all') {
            // 点击"全部分类"，清空其他选择，只选择"全部"
            selectedCategories = ['all'];
        } else {
            // 点击具体分类
            if (selectedCategories.includes(categoryId)) {
                // 取消选择该分类
                selectedCategories = selectedCategories.filter(id => id !== categoryId);
            } else {
                // 选择该分类，同时移除"全部"选项
                selectedCategories = selectedCategories.filter(id => id !== 'all');
                selectedCategories = [...selectedCategories, categoryId];
            }
        }
    }

    function togglePriority(priority: string) {
        if (priority === 'all') {
            // 点击"全部优先级"，清空其他选择，只选择"全部"
            selectedPriorities = ['all'];
        } else {
            // 点击具体优先级
            if (selectedPriorities.includes(priority)) {
                // 取消选择该优先级
                selectedPriorities = selectedPriorities.filter(p => p !== priority);
            } else {
                // 选择该优先级，同时移除"全部"选项
                selectedPriorities = selectedPriorities.filter(p => p !== 'all');
                selectedPriorities = [...selectedPriorities, priority];
            }
        }
    }

    function handleDragStart(e: DragEvent, filter: FilterConfig) {
        if (!filter) {
            e.preventDefault();
            return;
        }
        draggedFilterId = filter.id;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', filter.id);
        }
    }

    function handleDragOver(e: DragEvent, targetFilter: FilterConfig) {
        e.preventDefault();
        if (!draggedFilterId || draggedFilterId === targetFilter.id) return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        dragTargetId = targetFilter.id;
        dragPosition = e.clientY < midY ? 'above' : 'below';
    }

    function handleDragLeave() {
        dragTargetId = null;
        dragPosition = null;
    }

    async function handleDrop(e: DragEvent, targetFilter: FilterConfig) {
        e.preventDefault();
        if (!draggedFilterId || draggedFilterId === targetFilter.id) {
            resetDragState();
            return;
        }

        const fromIndex = filters.findIndex(f => f.id === draggedFilterId);

        // Remove dragged item
        const newFilters = [...filters];
        const [movedItem] = newFilters.splice(fromIndex, 1);

        // Find index of target in the array (which might have shifted if fromIndex < targetIndex)
        // Using original index of target is risky if we splice first.
        // Let's find target in newFilters.
        let toIndex = newFilters.findIndex(f => f.id === targetFilter.id);

        if (dragPosition === 'below') {
            toIndex++;
        }

        newFilters.splice(toIndex, 0, movedItem);
        filters = newFilters;

        await saveFilters();
        resetDragState();
    }

    function resetDragState() {
        draggedFilterId = null;
        dragTargetId = null;
        dragPosition = null;
    }
</script>

<div class="filter-management">
    <div class="filter-list">
        <div class="filter-list-header">
            <h3>{i18n('filterManagement')}</h3>
            <button class="b3-button b3-button--primary" on:click={startNewFilter}>
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                {i18n('newFilter')}
            </button>
        </div>
        <div class="filter-list-content">
            {#each filters as filter (filter.id)}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                    class="filter-item"
                    class:selected={selectedFilter?.id === filter.id}
                    class:drag-over-above={dragTargetId === filter.id && dragPosition === 'above'}
                    class:drag-over-below={dragTargetId === filter.id && dragPosition === 'below'}
                    draggable={true}
                    on:dragstart={e => handleDragStart(e, filter)}
                    on:dragover={e => handleDragOver(e, filter)}
                    on:dragleave={handleDragLeave}
                    on:drop={e => handleDrop(e, filter)}
                    on:click={() => selectFilter(filter)}
                    on:keydown={() => {}}
                >
                    <div class="filter-item-main">
                        <div class="filter-item-name">
                            <span
                                class="drag-handle"
                                style="cursor: move; opacity: 0.3; margin-right: 4px;"
                            >
                                ⋮⋮
                            </span>
                            {filter.name}
                            {#if filter.isBuiltIn}
                                <span class="filter-badge">{i18n('builtInFilter')}</span>
                            {/if}
                        </div>
                    </div>
                    {#if !filter.isBuiltIn}
                        <div class="filter-item-actions">
                            <button
                                class="b3-button b3-button--outline"
                                on:click|stopPropagation={() => deleteFilter(filter)}
                                title={i18n('deleteFilter')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconTrashcan"></use>
                                </svg>
                            </button>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </div>

    <div class="filter-editor">
        {#if isEditing}
            <div class="filter-editor-header-input">
                <div class="b3-form__group" style="margin-bottom: 0;">
                    <label class="b3-form__label">{i18n('filterName')}</label>
                    <input
                        type="text"
                        class="b3-text-field"
                        bind:value={filterName}
                        placeholder={i18n('pleaseEnterFilterName')}
                    />
                </div>
            </div>

            <div class="filter-editor-content">
                <div class="b3-form__group">
                    <label class="b3-form__label">{i18n('dateFilters')}</label>
                    <div class="filter-options">
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('all')}
                            on:click={() => toggleDateFilter('all')}
                        >
                            {i18n('allDates')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('none')}
                            on:click={() => toggleDateFilter('none')}
                        >
                            {i18n('noDate')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('yesterday')}
                            on:click={() => toggleDateFilter('yesterday')}
                        >
                            {i18n('yesterday')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('today')}
                            on:click={() => toggleDateFilter('today')}
                        >
                            {i18n('today')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('tomorrow')}
                            on:click={() => toggleDateFilter('tomorrow')}
                        >
                            {i18n('tomorrow')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('this_week')}
                            on:click={() => toggleDateFilter('this_week')}
                        >
                            {i18n('thisWeek')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('next_7_days')}
                            on:click={() => toggleDateFilter('next_7_days')}
                        >
                            {i18n('next7Days')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('future')}
                            on:click={() => toggleDateFilter('future')}
                        >
                            {i18n('future')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('past_7_days')}
                            on:click={() => toggleDateFilter('past_7_days')}
                        >
                            {i18n('past7Days')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedDateFilters.includes('custom_range')}
                            on:click={() => toggleDateFilter('custom_range')}
                        >
                            {i18n('customRange')}
                        </div>
                    </div>
                </div>

                {#if selectedDateFilters.includes('custom_range')}
                    <div class="b3-form__group">
                        <label class="b3-form__label">{i18n('dateRange')}</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input
                                type="date"
                                class="b3-text-field"
                                bind:value={customRangeStart}
                                placeholder={i18n('dateRangeFrom')}
                                style="flex: 1;"
                            />
                            <span>-</span>
                            <input
                                type="date"
                                class="b3-text-field"
                                bind:value={customRangeEnd}
                                placeholder={i18n('dateRangeTo')}
                                style="flex: 1;"
                            />
                        </div>
                    </div>
                {/if}

                <div class="b3-form__group">
                    <label class="b3-form__label">{i18n('statusFilters')}</label>
                    <div class="filter-options">
                        <div
                            class="filter-option"
                            class:selected={statusFilter === 'all'}
                            on:click={() => (statusFilter = 'all')}
                        >
                            {i18n('all')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={statusFilter === 'completed'}
                            on:click={() => (statusFilter = 'completed')}
                        >
                            {i18n('completed')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={statusFilter === 'uncompleted'}
                            on:click={() => (statusFilter = 'uncompleted')}
                        >
                            {i18n('uncompleted')}
                        </div>
                    </div>
                </div>

                <div class="b3-form__group">
                    <label class="b3-form__label">{i18n('projectFilters')}</label>
                    <div class="filter-options">
                        <div
                            class="filter-option"
                            class:selected={selectedProjects.includes('all')}
                            on:click={() => toggleProject('all')}
                        >
                            {i18n('allProjects')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedProjects.includes('none')}
                            on:click={() => toggleProject('none')}
                        >
                            {i18n('noProject')}
                        </div>
                        {#each projects as project}
                            <div
                                class="filter-option"
                                class:selected={selectedProjects.includes(project.id)}
                                on:click={() => toggleProject(project.id)}
                            >
                                {project.icon || '📋'}
                                {project.name}
                            </div>
                        {/each}
                    </div>
                </div>

                <div class="b3-form__group">
                    <label class="b3-form__label">{i18n('categoryFilters')}</label>
                    <div class="filter-options">
                        <div
                            class="filter-option"
                            class:selected={selectedCategories.includes('all')}
                            on:click={() => toggleCategory('all')}
                        >
                            {i18n('allCategories')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedCategories.includes('none')}
                            on:click={() => toggleCategory('none')}
                        >
                            {i18n('noCategory')}
                        </div>
                        {#each categories as category}
                            <div
                                class="filter-option"
                                class:selected={selectedCategories.includes(category.id)}
                                on:click={() => toggleCategory(category.id)}
                            >
                                <span
                                    style="background: {category.color}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;"
                                >
                                    {category.icon || ''}
                                    {category.name}
                                </span>
                            </div>
                        {/each}
                    </div>
                </div>

                <div class="b3-form__group">
                    <label class="b3-form__label">{i18n('priorityFilters')}</label>
                    <div class="filter-options">
                        <div
                            class="filter-option"
                            class:selected={selectedPriorities.includes('all')}
                            on:click={() => togglePriority('all')}
                        >
                            {i18n('allPriorities')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedPriorities.includes('high')}
                            on:click={() => togglePriority('high')}
                        >
                            🔴 {i18n('highPriority')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedPriorities.includes('medium')}
                            on:click={() => togglePriority('medium')}
                        >
                            🟡 {i18n('mediumPriority')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedPriorities.includes('low')}
                            on:click={() => togglePriority('low')}
                        >
                            🔵 {i18n('lowPriority')}
                        </div>
                        <div
                            class="filter-option"
                            class:selected={selectedPriorities.includes('none')}
                            on:click={() => togglePriority('none')}
                        >
                            ⚪ {i18n('noPriority')}
                        </div>
                    </div>
                </div>
            </div>
            <div class="filter-editor-actions">
                <button class="b3-button b3-button--cancel" on:click={() => (isEditing = false)}>
                    {i18n('cancel')}
                </button>
                <button class="b3-button b3-button--primary" on:click={saveFilter}>
                    {i18n('save')}
                </button>
            </div>
        {:else}
            <div class="empty-state">
                <svg class="empty-icon"><use xlink:href="#iconFilter"></use></svg>
                <p>{i18n('selectFilterToEdit')}</p>
            </div>
        {/if}
    </div>
</div>

<style>
    /* Override dialog container to prevent outer scrolling; applied via class added in ReminderPanel */
    :global(.filter-management-dialog .b3-dialog__content) {
        overflow: hidden;
        padding: 0; /* remove extra padding so component can control its own spacing */
    }

    .filter-management {
        display: flex;
        width: 100%;
        height: 100%; /* fill dialog content's height */
        overflow: hidden;
        min-height: 0;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 4px;
        box-sizing: border-box;
        align-items: stretch;
    }

    .filter-list {
        width: 240px;
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--b3-theme-surface);
        border-right: 1px solid var(--b3-theme-surface-lighter);
        flex: 0 0 240px;
        min-width: 240px;
        min-height: 0;
    }

    .filter-list-header {
        padding: 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
        flex: 0 0 auto;
    }

    .filter-list-header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .filter-list-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px;
        min-height: 0;
    }

    .filter-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        margin-bottom: 4px;
        border-radius: 6px;
        cursor: pointer;
        color: var(--b3-theme-on-surface);
        border: 1px solid transparent;
    }

    .filter-item:hover {
        background: var(--b3-theme-background-light);
    }

    .filter-item.selected {
        background: var(--b3-theme-surface-lighter);
        background-color: rgba(var(--b3-theme-primary-rgb), 0.1);
        border-color: var(--b3-theme-primary);
        color: var(--b3-theme-primary);
    }

    .filter-item.drag-over-above {
        border-top: 2px solid var(--b3-theme-primary);
    }

    .filter-item.drag-over-below {
        border-bottom: 2px solid var(--b3-theme-primary);
    }

    .filter-item-main {
        flex: 1;
        min-width: 0;
    }

    .filter-item-name {
        flex: 1;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .filter-badge {
        font-size: 10px;
        padding: 1px 5px;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 4px;
        color: var(--b3-theme-on-surface-light);
    }

    .filter-item.selected .filter-badge {
        background: rgba(var(--b3-theme-primary-rgb), 0.15);
        color: var(--b3-theme-primary);
    }

    .filter-item-actions {
        display: flex;
        gap: 4px;
    }

    .filter-item-actions button {
        padding: 4px;
        border-radius: 4px;
        opacity: 0;
    }

    .filter-item:hover .filter-item-actions button {
        opacity: 1;
    }

    .filter-editor {
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: var(--b3-theme-background);
        position: relative;
        min-height: 0;
        min-width: 0; /* ensure flex shrinking works if needed, and allows growth */
    }

    .filter-editor-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 24px;
        min-height: 0;
        width: 100%;
        box-sizing: border-box;
    }

    .filter-editor-header-input {
        padding: 12px 24px 12px;
        background: var(--b3-theme-background);
        flex: 0 0 auto;
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
    }

    .filter-editor-actions {
        padding: 16px 24px;
        border-top: 1px solid var(--b3-theme-surface-lighter);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        background: var(--b3-theme-background);
        flex: 0 0 auto;
    }

    .filter-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }

    .filter-option {
        padding: 6px 14px;
        border-radius: 20px;
        border: 1px solid var(--b3-theme-surface-lighter);
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .filter-option:hover {
        border-color: var(--b3-theme-primary);
        color: var(--b3-theme-primary);
        background: var(--b3-theme-surface);
    }

    .filter-option.selected {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
        border-color: var(--b3-theme-primary);
        box-shadow: 0 2px 4px rgba(var(--b3-theme-primary-rgb), 0.2);
    }

    .b3-form__group {
        margin-bottom: 24px;
    }

    .b3-form__label {
        display: block;
        margin-bottom: 12px;
        font-weight: 600;
        font-size: 14px;
        color: var(--b3-theme-on-surface);
    }

    .empty-state {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--b3-theme-on-surface-light);
        padding: 32px;
        text-align: center;
        box-sizing: border-box; /* ensure padding doesn't overflow width */
    }

    .empty-icon {
        width: 64px;
        height: 64px;
        opacity: 0.1;
        margin-bottom: 16px;
    }

    /* Scrollbar styling */
    .filter-list-content::-webkit-scrollbar,
    .filter-editor-content::-webkit-scrollbar {
        width: 6px;
    }

    .filter-list-content::-webkit-scrollbar-thumb,
    .filter-editor-content::-webkit-scrollbar-thumb {
        background-color: var(--b3-theme-on-surface-light);
        border-radius: 3px;
        opacity: 0.2;
    }
</style>
