<script lang="ts">
    import PomodoroStatsTab from "./PomodoroStatsTab.svelte";
    import TaskStatsTab from "./TaskStatsTab.svelte";
    import HabitStatsTab from "./HabitStatsTab.svelte";
    import TaskSummaryTab from "./TaskSummaryTab.svelte";
    import ProjectStatsTab from "./ProjectStatsTab.svelte";
    import { setLastStatsMode } from "./statsMode";
    import { i18n } from '../../pluginInstance';

    type StatsTab = "pomodoro" | "task" | "habit" | "summary" | "project";

    export let plugin: any;
    export let initialTab: StatsTab = "pomodoro";
    export let calendar: any = null;

    let activeTab: StatsTab = initialTab;

    const tabs: Array<{ id: StatsTab; icon: string; labelKey: string }> = [
        { id: "pomodoro", icon: "iconTNPomodoro", labelKey: "pomodoroStats" },
        { id: "task", icon: "iconTNTodoList", labelKey: "taskStats" },
        { id: "summary", icon: "iconTNTaskSummary", labelKey: "taskSummary" },
        { id: "project", icon: "iconTNProject", labelKey: "projectStats" },
        { id: "habit", icon: "iconTNHabit", labelKey: "habitStats" },
    ];

    const switchTab = (tab: StatsTab) => {
        activeTab = tab;
        setLastStatsMode(tab);
    };

    export const setActiveTab = (tab: StatsTab) => {
        switchTab(tab);
    };
</script>

<div class="stats-root">
    <div class="stats-tabs">
        {#each tabs as tab (tab.id)}
            <button class:active={activeTab === tab.id} on:click={() => switchTab(tab.id)}>
                <svg class="stats-tab-icon" aria-hidden="true"><use href={`#${tab.icon}`} /></svg>
                <span>{i18n(tab.labelKey)}</span>
            </button>
        {/each}
    </div>

    <div class="stats-content">
        {#if activeTab === "pomodoro"}
            <PomodoroStatsTab {plugin} />
        {:else if activeTab === "task"}
            <TaskStatsTab {plugin} />
        {:else if activeTab === "habit"}
            <HabitStatsTab {plugin} />
        {:else if activeTab === "summary"}
            <TaskSummaryTab {plugin} {calendar} />
        {:else if activeTab === "project"}
            <ProjectStatsTab {plugin} />
        {/if}
    </div>
</div>

<style>
    .stats-root { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .stats-tabs { display: flex; gap: 8px; padding: 8px 0 12px; border-bottom: 1px solid var(--b3-border-color); }
    .stats-tabs button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 6px 10px;
        cursor: pointer;
    }
    .stats-tab-icon {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        color: inherit;
        fill: none;
    }
    .stats-tabs button.active {
        border-color: var(--b3-theme-primary);
        color: #fff;
        background: var(--b3-theme-primary);
    }
    .stats-content { padding: 14px 0 0; overflow: auto; flex: 1; }
</style>
