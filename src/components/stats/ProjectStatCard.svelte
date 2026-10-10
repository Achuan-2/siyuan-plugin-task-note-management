<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { i18n } from '../../pluginInstance';

    export let item: any;

    const dispatch = createEventDispatcher();

    function onContextMenu(event: MouseEvent) {
        dispatch("contextmenu", { event, project: item.project });
    }
</script>

<div class="project-stat-card" on:contextmenu={onContextMenu}>
    <div class="card-header">
        <span class="color-dot" style="background-color: {item.color};"></span>
        {#if item.emoji}
            <span class="project-emoji">{item.emoji}</span>
        {/if}
        <span class="project-title" title={item.title}>{item.title}</span>
        <span class="status-badge status-{item.statusId}" title={item.statusName}>
            {#if item.statusIcon}{item.statusIcon}{/if}{item.statusName}
        </span>
        {#if item.priority !== "none"}
            <span class="priority-badge priority-{item.priority}">
                <span class="priority-dot"></span>{item.priorityLabel}
            </span>
        {/if}
    </div>
    <div class="card-stats">
        {#each item.statusCounts as sc (sc.id)}
            <span class="project-count">{#if sc.icon}{sc.icon} {/if}{sc.name}: {sc.count}</span>
        {/each}
    </div>
    {#if item.categories && item.categories.length > 0}
        <div class="card-tags">
            {#each item.categories as cat (cat.id)}
                <span class="category-tag" style="background-color: {cat.color}; border: 1px solid {cat.color}40;">
                    {#if cat.icon}<span class="category-tag-icon">{cat.icon}</span>{/if}
                    <span>{cat.name}</span>
                </span>
            {/each}
        </div>
    {/if}
    <div class="card-pomodoro">
        <span class="stat-item stat-pomodoro">{i18n('projectPomodoroTotalPrefix')} {item.pomodoro}{item.focusText}</span>
    </div>
    <div class="progress-row">
        <div class="progress-bar">
            <div class="progress-inner" style="width: {item.percentage}%;"></div>
        </div>
        <span class="progress-text">{item.percentage}%</span>
    </div>
</div>

<style>
    .project-stat-card {
        background: var(--b3-theme-surface-lighter);
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
    }

    .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .color-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .project-emoji {
        font-size: 15px;
        flex-shrink: 0;
    }

    .project-title {
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
    }

    .priority-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
        flex-shrink: 0;
    }

    .priority-badge .priority-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
        flex-shrink: 0;
        border: 1px solid transparent;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        /* 自定义状态默认使用 info 配色 */
        background: color-mix(in srgb, var(--b3-theme-info), transparent 90%);
        border-color: color-mix(in srgb, var(--b3-theme-info), transparent 70%);
        color: var(--b3-theme-info);
    }

    .status-badge.status-active {
        background: color-mix(in srgb, var(--b3-theme-primary), transparent 90%);
        border-color: color-mix(in srgb, var(--b3-theme-primary), transparent 70%);
        color: var(--b3-theme-primary);
    }

    .status-badge.status-someday {
        background: color-mix(in srgb, var(--b3-theme-warning), transparent 90%);
        border-color: color-mix(in srgb, var(--b3-theme-warning), transparent 70%);
        color: var(--b3-theme-warning);
    }

    .status-badge.status-archived {
        background: var(--b3-theme-surface);
        border-color: var(--b3-border-color);
        color: var(--b3-theme-on-surface);
    }

    .priority-badge.priority-high {
        background-color: rgba(231, 76, 60, 0.1);
        color: #e74c3c;
    }

    .priority-badge.priority-medium {
        background-color: rgba(243, 156, 18, 0.1);
        color: #f39c12;
    }

    .priority-badge.priority-low {
        background-color: rgba(52, 152, 219, 0.1);
        color: #3498db;
    }

    .card-stats {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
    }

    .project-count {
        opacity: 0.85;
        white-space: nowrap;
    }

    .card-tags {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .category-tag {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
    }

    .category-tag-icon {
        font-size: 10px;
        line-height: 1;
    }

    .card-pomodoro {
        display: flex;
        align-items: center;
        font-size: 12px;
    }

    .stat-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        background: rgba(231, 76, 60, 0.1);
        padding: 2px 6px;
        border-radius: 10px;
        border: 1px solid rgba(231, 76, 60, 0.2);
    }

    .stat-pomodoro {
        color: var(--b3-theme-on-surface);
        opacity: 0.8;
    }

    .progress-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .progress-bar {
        flex: 1;
        height: 6px;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 3px;
        overflow: hidden;
    }

    .progress-inner {
        height: 100%;
        background: var(--b3-theme-primary);
        border-radius: 3px;
        transition: width 0.3s ease;
    }

    .progress-text {
        font-size: 11px;
        opacity: 0.7;
        flex-shrink: 0;
        min-width: 34px;
        text-align: right;
    }
</style>
