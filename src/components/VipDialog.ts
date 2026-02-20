import { svelteDialog } from "../libs/dialog";
import VipPanel from "./VipPanel.svelte";

export const showVipDialog = (plugin: any) => {
    const { component, dialog } = svelteDialog({
        title: "任务笔记管理插件订阅",
        width: "500px",
        constructor: (item) => {
            return new VipPanel({
                target: item,
                props: {
                    plugin: plugin,
                    isDialog: true
                }
            });
        }
    });
    return { component, dialog };
};
