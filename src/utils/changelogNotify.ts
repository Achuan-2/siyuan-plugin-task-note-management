import { Dialog } from "siyuan";
import { getFile } from "../api";
import versionInfo from "../../plugin.json";
import { i18n } from "../pluginInstance";

export class ChangelogUtils {
    /**
     * 检查并显示版本更新日志说明
     * @param plugin 插件实例
     */
    static async checkAndNotify(plugin: any) {
        const currentVersion = versionInfo.version;
        const storageFile = "changelogNotify.json";
        
        let notifiedData: { lastNotifiedVersion?: string } = {};
        try {
            const data = await plugin.loadData(storageFile);
            if (data) {
                notifiedData = data;
            }
        } catch (e) {
            console.error("Failed to load changelog notify data", e);
        }

        if (notifiedData.lastNotifiedVersion === currentVersion) {
            return;
        }

        await this.showChangelog(plugin);

        // 更新已通知标记
        notifiedData.lastNotifiedVersion = currentVersion;
        await plugin.saveData(storageFile, notifiedData);
    }

    /**
     * 手动显示当前版本的更新日志
     * @param plugin 插件实例
     */
    static async showChangelog(plugin: any) {
        const currentVersion = versionInfo.version;
        const pluginId = plugin.name; 
        const changelogPath = `/data/plugins/${pluginId}/CHANGELOG.md`;
        let changelogContent: any = "";
        try {
            changelogContent = await getFile(changelogPath);
        } catch (e) {
            console.error("Failed to fetch CHANGELOG.md", e);
        }

        let versionNotes = i18n("noUpdateNotes") || "无更新内容";
        if (changelogContent && typeof changelogContent === 'string') {
            versionNotes = this.parseChangelog(changelogContent, currentVersion);
        }

        // 显示弹窗
        this.showDialog(currentVersion, versionNotes);
    }


    private static parseChangelog(content: string, version: string): string {
        if (typeof content !== 'string') {
            return i18n("noUpdateNotes") || "无更新内容";
        }
        // 匹配 ## vX.X.X 直到下一个 ## 或文件末尾, 包括标题行
        const escapedVersion = version.replace(/\./g, "\\.");
        const regex = new RegExp(`## v${escapedVersion}[^\\n]*[\\s\\S]*?(?=\\n## |$)`, "i");
        const match = content.match(regex);
        
        if (match && match[0]) {
            return match[0].trim();
        }
        return i18n("noUpdateNotes") || "无更新内容";
    }

    private static showDialog(version: string, notes: string) {
        // 使用 window.Lute 解析 Markdown 为 HTML
        let htmlNotes = notes;
        try {
            if ((window as any).Lute) {
                const lute = (window as any).Lute.New();
                htmlNotes = lute.Md2HTML(notes);
            } else {
                // 回退方案：简单转换换行
                htmlNotes = notes.replace(/\n/g, '<br>');
            }
        } catch (e) {
            console.error('Lute parse failed:', e);
            htmlNotes = notes.replace(/\n/g, '<br>');
        }

        const contentHtml = `
            <div class="b3-dialog__content" style="padding: 16px; line-height: 1.6; max-height: 70vh; overflow-y: auto;">
                <div class="changelog-notes b3-typography">
                    ${htmlNotes}
                    <div style="margin-top: 16px; border-top: 1px solid var(--b3-border-color); padding-top: 8px; font-size: 13px; color: var(--b3-theme-on-surface-light);">
                        ${i18n("moreChangelog") || "更多版本更新日志请查看："}
                        <a href="https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-task-note-management@main/CHANGELOG.md" target="_blank">CHANGELOG.md</a>
                    </div>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--text" id="changelogConfirmBtn">${i18n("iKnow") || "知道啦"}</button>
            </div>
        `;

        const dialog = new Dialog({
            title: `${i18n("changelogNotification") || "版本更新提醒"}`,
            content: contentHtml,
            width: "min(600px,95%)",
        });

        const confirmBtn = dialog.element.querySelector("#changelogConfirmBtn");
        confirmBtn?.addEventListener("click", () => {
            dialog.destroy();
        });
    }
}
