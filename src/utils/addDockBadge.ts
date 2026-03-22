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

    const badge = document.createElement("span");
    badge.className = config.badgeClass;
    badge.textContent = count.toString();
    badge.style.cssText = `
        position: absolute;
        top: 2px;
        right: 2px;
        background: ${config.badgeColor};
        color: white;
        border-radius: 50%;
        min-width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        line-height: 1;
        z-index: 1;
        pointer-events: none;
    `;
    (dockIcon as HTMLElement).style.position = "relative";
    dockIcon.appendChild(badge);
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

    if (!shouldShowDockBadge(settings, config)) {
        document.querySelector(selector)?.querySelector(`.${config.badgeClass}`)?.remove();
        return;
    }

    try {
        const dockIcon = await plugin.whenElementExist(selector);
        applyDockBadge(dockIcon, config, count);
    } catch (error) {
        console.warn(`设置${config.displayName}停靠栏徽章失败:`, error);
        const dockIcon = document.querySelector(selector);
        if (!dockIcon) return;
        applyDockBadge(dockIcon, config, count);
    }
}
