import { Dialog, showMessage } from "siyuan";

type StatsTab = "pomodoro" | "task" | "habit";

export async function showStatsDialog(plugin: any, initialTab: StatsTab = "pomodoro") {
    const dialog = new Dialog({
        title: "📊 统计视图",
        content: '<div id="showStatsViewContainer" style="height:100%;padding: 8px 16px 16px;box-sizing:border-box;"></div>',
        width: "min(900px,95%)",
        height: "80vh"
    });

    try {
        const module = await import("../ShowStatsView.svelte");
        const ShowStatsView = module.default;
        const target = dialog.element.querySelector("#showStatsViewContainer") as HTMLElement;
        if (!target) {
            showMessage("统计视图容器初始化失败", 3000, "error");
            dialog.destroy();
            return;
        }

        const component = new ShowStatsView({
            target,
            props: {
                plugin,
                initialTab
            }
        });

        const originalDestroy = dialog.destroy.bind(dialog);
        dialog.destroy = () => {
            try {
                component.$destroy();
            } catch (error) {
                console.warn("销毁统计视图组件失败:", error);
            }
            originalDestroy();
        };
    } catch (error) {
        console.error("加载统计视图失败:", error);
        showMessage("加载统计视图失败", 3000, "error");
        dialog.destroy();
    }
}
