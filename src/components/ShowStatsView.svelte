<script lang="ts">
    import PomodoroStatsTab from "./stats/PomodoroStatsTab.svelte";
    import TaskStatsTab from "./stats/TaskStatsTab.svelte";
    import HabitStatsTab from "./stats/HabitStatsTab.svelte";
    import TaskSummaryTab from "./stats/TaskSummaryTab.svelte";
    import { setLastStatsMode } from "./stats/statsMode";

    export let plugin: any;
    export let initialTab: "pomodoro" | "task" | "habit" | "summary" = "pomodoro";
    export let calendar: any = null;

    let activeTab: "pomodoro" | "task" | "habit" | "summary" = initialTab;

    const switchTab = (tab: "pomodoro" | "task" | "habit" | "summary") => {
        activeTab = tab;
        setLastStatsMode(tab);
    };
</script>

<div class="stats-root">
    <div class="stats-tabs">
        <button class:active={activeTab === "pomodoro"} on:click={() => switchTab("pomodoro")}>🍅 番茄统计</button>
        <button class:active={activeTab === "task"} on:click={() => switchTab("task")}>✅ 任务统计</button>
        <button class:active={activeTab === "habit"} on:click={() => switchTab("habit")}>📅 习惯统计</button>
        <button class:active={activeTab === "summary"} on:click={() => switchTab("summary")}>📝 任务摘要</button>
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
