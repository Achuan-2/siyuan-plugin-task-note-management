<script lang="ts">
    import PomodoroStatsTab from "./PomodoroStatsTab.svelte";
    import TaskStatsTab from "./TaskStatsTab.svelte";
    import HabitStatsTab from "./HabitStatsTab.svelte";
    import TaskSummaryTab from "./TaskSummaryTab.svelte";
    import ProjectStatsTab from "./ProjectStatsTab.svelte";
    import { setLastStatsMode } from "./statsMode";
    import { i18n } from '../../pluginInstance';

    export let plugin: any;
    export let initialTab: "pomodoro" | "task" | "habit" | "summary" | "project" = "pomodoro";
    export let calendar: any = null;

    let activeTab: "pomodoro" | "task" | "habit" | "summary" | "project" = initialTab;

    const switchTab = (tab: "pomodoro" | "task" | "habit" | "summary" | "project") => {
        activeTab = tab;
        setLastStatsMode(tab);
    };

    export const setActiveTab = (tab: "pomodoro" | "task" | "habit" | "summary" | "project") => {
        switchTab(tab);
    };
</script>

<div class="stats-root">
    <div class="stats-tabs">
        <button class:active={activeTab === "pomodoro"} on:click={() => switchTab("pomodoro")}>🍅 {i18n('pomodoroStats')}</button>
        <button class:active={activeTab === "task"} on:click={() => switchTab("task")}>✅ {i18n('taskStats')}</button>
        <button class:active={activeTab === "summary"} on:click={() => switchTab("summary")}>📝 {i18n('taskSummary')}</button>
        <button class:active={activeTab === "project"} on:click={() => switchTab("project")}>🎯 {i18n('projectStats')}</button>
        <button class:active={activeTab === "habit"} on:click={() => switchTab("habit")}>📅 {i18n('habitStats')}</button>
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
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        border-radius: 6px;
        padding: 6px 10px;
        cursor: pointer;
    }
    .stats-tabs button.active {
        border-color: var(--b3-theme-primary);
        color: #fff;
        background: var(--b3-theme-primary);
    }
    .stats-content { padding: 14px 0 0; overflow: auto; flex: 1; }
</style>
