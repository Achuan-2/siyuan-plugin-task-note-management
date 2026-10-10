import { i18n } from "../../pluginInstance";
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
        title: i18n("statsViewTitle"),
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
                console.warn("Failed to destroy statistics view component:", error);
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
            showMessage(i18n("statsContainerInitFailed"), 3000, "error");
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
        console.error("Failed to load statistics view:", error);
        showMessage(i18n("loadStatsViewFailed"), 3000, "error");
        dialog.destroy();
    }
}
