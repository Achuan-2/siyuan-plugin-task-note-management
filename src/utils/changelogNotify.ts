import { Dialog } from "siyuan";
import { getFile } from "../api";
import versionInfo from "../../plugin.json";
import { i18n } from "../pluginInstance";

// 更新日志功能的起始版本
const CHANGELOG_START_VERSION = "6.5.5";

export class ChangelogUtils {
    private static getCurrentLang(): string {
        return (window as any)?.siyuan?.config?.lang || "";
    }

    private static getLocalizedVersionNotes(versionContent: string): string {
        const normalizedContent = versionContent.trim();
        if (!normalizedContent) {
            return i18n("noUpdateNotes") || "无更新内容";
        }

        // 每个版本日志约定：分割线前是中文，分割线后是英文
        const dividerMatch = normalizedContent.match(/\r?\n\s*---\s*\r?\n/);
        if (!dividerMatch || dividerMatch.index === undefined) {
            return normalizedContent;
        }

        const dividerStart = dividerMatch.index;
        const dividerEnd = dividerStart + dividerMatch[0].length;
        const chineseNotes = normalizedContent.slice(0, dividerStart).trim();
        const englishNotes = normalizedContent.slice(dividerEnd).trim();

        if (this.getCurrentLang() === "zh_CN") {
            return chineseNotes || (i18n("noUpdateNotes") || "无更新内容");
        }

        // 非中文优先英文，英文为空则回退中文
        return englishNotes || chineseNotes || (i18n("noUpdateNotes") || "无更新内容");
    }

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

        const lastNotifiedVersion = notifiedData.lastNotifiedVersion;

        // 如果已经通知过当前版本，则不显示
        if (lastNotifiedVersion === currentVersion) {
            return;
        }

        // 如果没有通知过任何版本（首次安装），或者版本低于起始版本，则从起始版本开始显示（包含起始版本）
        // 否则从上次通知的版本之后开始显示（不包含上次通知版本）
        const shouldIncludeFromVersion = !lastNotifiedVersion || this.compareVersions(lastNotifiedVersion, CHANGELOG_START_VERSION) < 0;
        const fromVersion = shouldIncludeFromVersion ? CHANGELOG_START_VERSION : lastNotifiedVersion;

        await this.showChangelog(plugin, fromVersion, currentVersion, shouldIncludeFromVersion);

        // 更新已通知标记
        notifiedData.lastNotifiedVersion = currentVersion;
        await plugin.saveData(storageFile, notifiedData);
    }

    /**
     * 手动显示当前版本的更新日志
     * @param plugin 插件实例
     */
    static async showChangelog(plugin: any, fromVersion?: string, toVersion?: string, includeFromVersion = true) {
        const currentVersion = toVersion || versionInfo.version;
        const startVersion = fromVersion || currentVersion;
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
            // 如果是跨版本更新，显示多个版本的更新内容
            if (startVersion !== currentVersion) {
                versionNotes = this.parseChangelogRange(changelogContent, startVersion, currentVersion, includeFromVersion);
            } else {
                versionNotes = this.parseChangelog(changelogContent, currentVersion);
            }
        }

        // 显示弹窗
        const titleVersion = startVersion !== currentVersion 
            ? `${startVersion} → ${currentVersion}` 
            : currentVersion;
        this.showDialog(titleVersion, versionNotes);
    }

    /**
     * 比较两个版本号
     * @returns 负数表示 v1 < v2，0 表示相等，正数表示 v1 > v2
     */
    private static compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        const maxLength = Math.max(parts1.length, parts2.length);
        
        for (let i = 0; i < maxLength; i++) {
            const part1 = parts1[i] || 0;
            const part2 = parts2[i] || 0;
            
            if (part1 < part2) return -1;
            if (part1 > part2) return 1;
        }
        
        return 0;
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
            return this.getLocalizedVersionNotes(match[0]);
        }
        return i18n("noUpdateNotes") || "无更新内容";
    }

    /**
     * 解析版本范围内的所有更新日志
     * @param content CHANGELOG.md 内容
     * @param fromVersion 起始版本（是否包含由 includeFromVersion 控制）
     * @param toVersion 目标版本（包含）
     * @param includeFromVersion 是否包含起始版本
     * @returns 所有符合条件的版本更新内容
     */
    private static parseChangelogRange(content: string, fromVersion: string, toVersion: string, includeFromVersion = true): string {
        if (typeof content !== 'string') {
            return i18n("noUpdateNotes") || "无更新内容";
        }

        // 匹配所有版本段落
        const versionRegex = /## (v[\d.]+)[^\n]*[\s\S]*?(?=\n## |$)/gi;
        const matches = content.matchAll(versionRegex);
        
        const results: string[] = [];
        
        for (const match of matches) {
            const versionHeader = match[0];
            const versionMatch = versionHeader.match(/## (v[\d.]+)/i);
            
            if (!versionMatch) continue;
            
            const version = versionMatch[1].substring(1); // 去掉 'v' 前缀
            
            const isAfterFromVersion = includeFromVersion
                ? this.compareVersions(version, fromVersion) >= 0
                : this.compareVersions(version, fromVersion) > 0;

            // 仅包含起始版本之后（或包含起始版本）且小于等于 toVersion 的版本
            if (isAfterFromVersion &&
                this.compareVersions(version, toVersion) <= 0) {
                results.push(this.getLocalizedVersionNotes(match[0]));
            }
        }
        
        if (results.length > 0) {
            return results.join('\n\n---\n\n');
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
