import { getPluginInstance } from "../pluginInstance";
export type DockBadgeType = "reminder" | "project" | "habit";

type DockBadgeConfig = {
    dockKey: string;
    badgeClass: string;
    badgeColor: string;
    settingKey: "enableReminderDockBadge" | "enableProjectDockBadge" | "enableHabitDockBadge";
    displayName: string;
};

const DOCK_BADGE_CONFIGS: Record<DockBadgeType, DockBadgeConfig> = {
    reminder: {
        dockKey: "reminder_dock",
        badgeClass: "reminder-dock-badge",
        badgeColor: "var(--b3-theme-error)",
        settingKey: "enableReminderDockBadge",
        displayName: "提醒"
    },
    project: {
        dockKey: "project_dock",
        badgeClass: "project-dock-badge",
        badgeColor: "#2c6a2e",
        settingKey: "enableProjectDockBadge",
        displayName: "项目"
    },
    habit: {
        dockKey: "habit_dock",
        badgeClass: "habit-dock-badge",
        badgeColor: "var(--b3-theme-primary)",
        settingKey: "enableHabitDockBadge",
        displayName: "习惯"
    }
};

export function getDockItemSelector(pluginName: string, dockKey: string): string {
    return `.dock__item[data-type="${pluginName}${dockKey}"]`;
}

function shouldShowDockBadge(settings: any, config: DockBadgeConfig): boolean {
    return settings?.enableDockBadge !== false && settings?.[config.settingKey] !== false;
}

function applyDockBadge(dockIcon: Element, config: DockBadgeConfig, count: number) {
    const existingBadge = dockIcon.querySelector(`.${config.badgeClass}`);
    if (existingBadge) {
        existingBadge.remove();
    }
    if (count <= 0) return;

    const badgeText = count > 99 ? "99+" : count.toString();
    const badge = document.createElement("span");
    badge.className = config.badgeClass;
    badge.textContent = badgeText;
    badge.style.cssText = `
        position: absolute;
        top: 1px;
        right: 1px;
        background: ${config.badgeColor};
        color: white;
        border-radius: 999px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        line-height: 16px;
        z-index: 1;
        pointer-events: none;
    `;
    (dockIcon as HTMLElement).style.position = "relative";
    dockIcon.appendChild(badge);
}

function shouldCountStatusByDefault(status: any): boolean {
    if (!status || typeof status !== "object") return false;
    if (typeof status.includeInBadge === "boolean") {
        return status.includeInBadge;
    }
    // 兼容历史数据：旧版本仅统计 active
    return status.id === "active";
}

function getProjectStatusId(project: any): string {
    return project.status || (project.archived ? "archived" : "active");
}

async function resolveProjectBadgeCount(fallbackCount: number): Promise<number> {
    const plugin = getPluginInstance();
    if (!plugin || typeof plugin.loadProjectData !== "function" || typeof plugin.loadProjectStatus !== "function") {
        return fallbackCount;
    }

    try {
        const [projectData, statusesData] = await Promise.all([
            plugin.loadProjectData(),
            plugin.loadProjectStatus()
        ]);

        if (!projectData || typeof projectData !== "object") {
            return 0;
        }

        const statusCountMap = new Map<string, boolean>();
        if (Array.isArray(statusesData)) {
            statusesData.forEach((status: any) => {
                if (!status || typeof status !== "object" || typeof status.id !== "string") return;
                statusCountMap.set(status.id, shouldCountStatusByDefault(status));
            });
        }

        let count = 0;
        Object.entries(projectData)
            .filter(([key]) => !key.startsWith("_"))
            .forEach(([, project]: [string, any]) => {
                if (!project || typeof project !== "object") return;
                const statusId = getProjectStatusId(project);
                const shouldCount = statusCountMap.has(statusId)
                    ? statusCountMap.get(statusId)
                    : statusId === "active";
                if (shouldCount) {
                    count++;
                }
            });

        return count;
    } catch (error) {
        console.warn("按状态配置计算项目停靠栏徽章失败，回退默认计数:", error);
        return fallbackCount;
    }
}

export async function setDockBadgeByType(options: {
    plugin: {
        name: string;
        loadSettings: () => Promise<any>;
        whenElementExist: (selector: string | (() => Element | null)) => Promise<Element>;
    };
    type: DockBadgeType;
    count: number;
}) {
    const { plugin, type, count } = options;
    const config = DOCK_BADGE_CONFIGS[type];
    const selector = getDockItemSelector(plugin.name, config.dockKey);
    const settings = await plugin.loadSettings();
    const finalCount = type === "project" ? await resolveProjectBadgeCount(count) : count;

    if (!shouldShowDockBadge(settings, config)) {
        document.querySelector(selector)?.querySelector(`.${config.badgeClass}`)?.remove();
        return;
    }

    try {
        const dockIcon = await plugin.whenElementExist(selector);
        applyDockBadge(dockIcon, config, finalCount);
    } catch (error) {
        console.warn(`设置${config.displayName}停靠栏徽章失败:`, error);
        const dockIcon = document.querySelector(selector);
        if (!dockIcon) return;
        applyDockBadge(dockIcon, config, finalCount);
    }
}
