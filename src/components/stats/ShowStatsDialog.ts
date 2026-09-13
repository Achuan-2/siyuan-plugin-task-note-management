import { Dialog, getFrontend, showMessage } from "siyuan";

type StatsTab = "pomodoro" | "task" | "habit" | "summary" | "project";

let activeDialog: Dialog | null = null;
let activeComponent: any = null;

export async function showStatsDialog(plugin: any, initialTab: StatsTab = "pomodoro", calendar?: any) {
    if (activeDialog) {
        if (activeComponent && typeof activeComponent.setActiveTab === "function") {
            activeComponent.setActiveTab(initialTab);
        }
        return;
    }

    const isMobile = plugin?.isInMobileApp || getFrontend().endsWith("mobile");
    const dialog = new Dialog({
        title: "📊 统计视图",
        content: '<div id="showStatsViewContainer" style="height:100%;padding: 8px 16px 16px;box-sizing:border-box;"></div>',
        width: "min(1000px,95%)",
        height: isMobile ? "100%" : "80vh"
    });

    activeDialog = dialog;

    const originalDestroy = dialog.destroy.bind(dialog);
    let component: any = null;

    dialog.destroy = () => {
        if (component) {
            try {
                component.$destroy();
            } catch (error) {
                console.warn("销毁统计视图组件失败:", error);
            }
        }
        activeDialog = null;
        activeComponent = null;
        originalDestroy();
    };

    try {
        const module = await import("./ShowStatsView.svelte");
        const ShowStatsView = module.default;
        const target = dialog.element.querySelector("#showStatsViewContainer") as HTMLElement;
        if (!target) {
            showMessage("统计视图容器初始化失败", 3000, "error");
            dialog.destroy();
            return;
        }

        component = new ShowStatsView({
            target,
            props: {
                plugin,
                initialTab,
                calendar
            }
        });
        activeComponent = component;
    } catch (error) {
        console.error("加载统计视图失败:", error);
        showMessage("加载统计视图失败", 3000, "error");
        dialog.destroy();
    }
}
