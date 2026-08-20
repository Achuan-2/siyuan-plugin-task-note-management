import { Dialog, getFrontend } from "siyuan";
import { i18n } from "../../pluginInstance";
import { ReminderPanel } from "../panel/ReminderPanel";
import { ProjectPanel } from "../panel/ProjectPanel";
import { HabitPanel } from "../panel/HabitPanel";
import { CalendarView } from "../panel/CalendarView";
import type ReminderPlugin from "../../index";

const POSITION_STORAGE_KEY = "siyuan-task-shortcut-pos";

type TabId = "task" | "project" | "habit" | "calendar";
type DockState = "left" | "right" | null;

interface SavedPosition {
    left: number;
    top: number;
    dock?: "left" | "right" | null;
}

interface TabConfig {
    id: TabId;
    label: string;
    icon: string;
}

export class MobileTaskShortcut {
    private plugin: ReminderPlugin;
    private button: HTMLElement | null = null;
    private badge: HTMLElement | null = null;
    private dialog: Dialog | null = null;
    private dragging = false;
    private longPressTimer: number | null = null;
    private dragOffset = { x: 0, y: 0 };
    private dockState: DockState = "right";
    private lastPositionSetting: string | null = null;

    private tabContainers: Map<TabId, HTMLElement> = new Map();
    private panels: Map<TabId, ReminderPanel | ProjectPanel | HabitPanel | CalendarView> = new Map();
    private activeTab: TabId = "task";
    private tabButtons: Map<TabId, HTMLElement> = new Map();

    constructor(plugin: ReminderPlugin) {
        this.plugin = plugin;
    }

    private isPhoneFrontend(): boolean {
        try {
            return getFrontend().endsWith("mobile");
        } catch (error) {
            console.warn("检测手机端失败:", error);
            return false;
        }
    }

    private shouldShow(settings: any): boolean {
        return settings?.enableMobileTaskShortcut !== false && this.isPhoneFrontend();
    }

    private getTabs(): TabConfig[] {
        return [
            { id: "task", label: i18n("reminderPanel") || "任务面板", icon: "#iconTNTodoList" },
            { id: "project", label: i18n("projectManagement") || "项目管理", icon: "#iconTNProject" },
            { id: "habit", label: i18n("habitPanelTitle") || "习惯打卡", icon: "#iconTNHabit" },
            { id: "calendar", label: i18n("calendarView") || "日历视图", icon: "#iconTNCalendar" },
        ];
    }

    private restorePosition(settings?: any) {
        const button = this.button;
        if (!button) return;
        try {
            const saved = localStorage.getItem(POSITION_STORAGE_KEY);
            const btnW = button.offsetWidth || 52;
            const btnH = button.offsetHeight || 52;
            const defaultDock: DockState = settings?.mobileTaskShortcutPosition === "left" ? "left" : "right";

            if (saved) {
                const pos: SavedPosition = JSON.parse(saved);
                let left = Math.max(-btnW / 2, Math.min(pos.left, window.innerWidth - btnW / 2));
                let top = Math.max(0, Math.min(pos.top, window.innerHeight - btnH));
                button.style.left = `${left}px`;
                button.style.top = `${top}px`;
                button.style.right = "auto";
                button.style.bottom = "auto";
                this.dockState = pos.dock !== undefined ? pos.dock : defaultDock;
                this.applyDock();
            } else {
                const defaultTop = Math.max(0, window.innerHeight - 72 - btnH);
                button.style.top = `${defaultTop}px`;
                button.style.bottom = "auto";
                button.style.right = "auto";
                this.dockState = defaultDock;
                this.applyDock();
            }
        } catch (_) { /* ignore */ }
    }

    private savePosition() {
        const button = this.button;
        if (!button) return;
        try {
            const rect = button.getBoundingClientRect();
            const pos: SavedPosition = {
                left: rect.left,
                top: rect.top,
                dock: this.dockState,
            };
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
        } catch (_) { /* ignore */ }
    }

    private applyDock() {
        const button = this.button;
        const badge = this.badge;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const btnW = rect.width || button.offsetWidth || 52;
        const btnH = rect.height || button.offsetHeight || 52;
        const currentTop = rect.top > 0 ? rect.top : (window.innerHeight - 72 - btnH);
        const clampedTop = Math.max(0, Math.min(currentTop, window.innerHeight - btnH));

        if (this.dockState === "left") {
            button.style.left = `${-btnW / 2}px`;
            button.style.top = `${clampedTop}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            button.classList.add("mobile-task-shortcut--docked-left");
            button.classList.remove("mobile-task-shortcut--docked-right");
            if (badge) {
                badge.style.left = "auto";
                badge.style.right = "-4px";
            }
        } else if (this.dockState === "right") {
            button.style.left = `${window.innerWidth - btnW / 2}px`;
            button.style.top = `${clampedTop}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            button.classList.add("mobile-task-shortcut--docked-right");
            button.classList.remove("mobile-task-shortcut--docked-left");
            if (badge) {
                badge.style.left = "-4px";
                badge.style.right = "auto";
            }
        } else {
            button.classList.remove("mobile-task-shortcut--docked-left", "mobile-task-shortcut--docked-right");
            if (badge) {
                badge.style.left = "";
                badge.style.right = "";
            }
        }
    }

    private snapToEdge() {
        const button = this.button;
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const halfW = rect.width / 2;
        const threshold = Math.max(halfW, 60);

        if (rect.left < threshold) {
            this.dockState = "left";
        } else if (rect.right > window.innerWidth - threshold) {
            this.dockState = "right";
        } else {
            this.dockState = null;
        }
        this.applyDock();
        this.savePosition();
    }

    private expandButton() {
        const button = this.button;
        if (!button || !this.dockState) return;

        const rect = button.getBoundingClientRect();
        if (this.dockState === "left") {
            button.style.left = "0px";
            button.style.top = `${rect.top}px`;
            button.style.right = "auto";
        } else if (this.dockState === "right") {
            button.style.left = `${window.innerWidth - rect.width}px`;
            button.style.top = `${rect.top}px`;
            button.style.right = "auto";
        }
        button.classList.remove("mobile-task-shortcut--docked-left", "mobile-task-shortcut--docked-right");
        const badge = this.badge;
        if (badge) {
            badge.style.left = "";
            badge.style.right = "";
        }
    }

    private ensureButton(settings?: any) {
        if (this.button?.isConnected) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "mobile-task-shortcut ariaLabel";
        button.title = i18n("mobileTaskShortcut") || i18n("taskManagement") || "任务快捷按钮";
        button.setAttribute("aria-label", button.title);
        button.innerHTML = `
            <svg class="mobile-task-shortcut__icon" aria-hidden="true">
                <use xlink:href="#iconTNTodoList"></use>
            </svg>
            <span class="mobile-task-shortcut__badge"></span>
        `;

        let touchStartPos = { x: 0, y: 0 };
        let hasMoved = false;

        const clearLongPressTimer = () => {
            if (this.longPressTimer !== null) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
        };

        const startDrag = (touch: Touch) => {
            this.dragging = true;
            button.classList.add("mobile-task-shortcut--dragging");
            const rect = button.getBoundingClientRect();
            this.dragOffset = {
                x: touch.clientX - rect.left,
                y: touch.clientY - rect.top,
            };
        };

        const moveDrag = (touch: Touch) => {
            if (!this.dragging) return;
            const x = touch.clientX - this.dragOffset.x;
            const y = touch.clientY - this.dragOffset.y;
            const btnW = button.offsetWidth;
            const btnH = button.offsetHeight;
            const clampedX = Math.max(0, Math.min(x, window.innerWidth - btnW));
            const clampedY = Math.max(0, Math.min(y, window.innerHeight - btnH));
            button.style.left = `${clampedX}px`;
            button.style.top = `${clampedY}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            // 拖动时临时完整显示，便于用户定位
            button.classList.remove("mobile-task-shortcut--docked-left", "mobile-task-shortcut--docked-right");
            const badge = this.badge;
            if (badge) {
                badge.style.left = "";
                badge.style.right = "";
            }
        };

        const endDrag = () => {
            clearLongPressTimer();
            if (this.dragging) {
                this.dragging = false;
                button.classList.remove("mobile-task-shortcut--dragging");
                this.snapToEdge();
            }
        };

        button.addEventListener("touchstart", (event) => {
            if (event.touches.length !== 1) return;
            hasMoved = false;
            touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };
            this.longPressTimer = window.setTimeout(() => {
                startDrag(event.touches[0]);
            }, 500);
        }, { passive: true });

        button.addEventListener("touchmove", (event) => {
            if (event.touches.length !== 1) return;
            const touch = event.touches[0];
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;
            if (!this.dragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                clearLongPressTimer();
                hasMoved = true;
                return;
            }
            if (this.dragging) {
                event.preventDefault();
                moveDrag(touch);
            }
        }, { passive: false });

        button.addEventListener("touchend", () => {
            endDrag();
        });

        button.addEventListener("touchcancel", () => {
            endDrag();
        });

        button.addEventListener("click", (event) => {
            if (hasMoved || this.dragging) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.toggleDialog();
        });

        document.body.appendChild(button);
        this.button = button;
        this.badge = button.querySelector(".mobile-task-shortcut__badge") as HTMLElement;

        this.restorePosition(settings);
    }

    private removeButton(destroyDialog: boolean = true) {
        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        this.dragging = false;

        if (destroyDialog && this.dialog) {
            this.closeDialog();
        }

        this.destroyPanels();

        this.button?.remove();
        this.button = null;
        this.badge = null;
    }

    private destroyPanels() {
        this.panels.forEach((panel) => {
            try {
                panel.destroy();
            } catch (e) {
                console.warn("销毁手机快捷面板失败:", e);
            }
        });
        this.panels.clear();
        this.tabContainers.clear();
        this.tabButtons.clear();
        this.activeTab = "task";
    }

    private toggleDialog() {
        if (this.dialog) {
            this.closeDialog();
        } else {
            this.expandButton();
            this.openDialog();
        }
    }

    private closeDialog() {
        if (!this.dialog) return;
        const dialog = this.dialog;
        this.dialog = null;
        try {
            dialog.destroy();
        } catch (e) {
            console.warn("关闭快捷弹窗失败:", e);
        }
        this.destroyPanels();
        this.applyDock();
    }

    private openDialog() {
        if (!this.isPhoneFrontend()) return;
        if (this.dialog) return;

        const dialog = new Dialog({
            title: i18n("mobileTaskShortcut") || "任务笔记管理",
            content: `
                <div class="mobile-task-shortcut-tabs" id="mobileTaskShortcutTabs"></div>
                <div class="mobile-task-shortcut-panels" id="mobileTaskShortcutPanels"></div>
            `,
            width: "95%",
            height: "90%",
            destroyCallback: () => {
                this.destroyPanels();
                this.dialog = null;
                this.applyDock();
            },
        });
        dialog.element.classList.add("mobile-task-shortcut-dialog");
        this.dialog = dialog;

        this.initTabs();
        this.switchTab(this.activeTab);
    }

    private initTabs() {
        const dialogEl = this.dialog?.element;
        if (!dialogEl) return;

        const tabsContainer = dialogEl.querySelector("#mobileTaskShortcutTabs") as HTMLElement;
        const panelsContainer = dialogEl.querySelector("#mobileTaskShortcutPanels") as HTMLElement;
        if (!tabsContainer || !panelsContainer) return;

        tabsContainer.innerHTML = "";
        panelsContainer.innerHTML = "";
        this.tabButtons.clear();
        this.tabContainers.clear();

        this.getTabs().forEach((tab) => {
            const tabBtn = document.createElement("button");
            tabBtn.type = "button";
            tabBtn.className = "mobile-task-shortcut-tab";
            tabBtn.dataset.tab = tab.id;
            tabBtn.innerHTML = `
                <svg class="mobile-task-shortcut-tab__icon" aria-hidden="true">
                    <use xlink:href="${tab.icon}"></use>
                </svg>
                <span class="mobile-task-shortcut-tab__label">${tab.label}</span>
            `;
            tabBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.switchTab(tab.id);
            });
            tabsContainer.appendChild(tabBtn);
            this.tabButtons.set(tab.id, tabBtn);

            const panelEl = document.createElement("div");
            panelEl.className = "mobile-task-shortcut-panel";
            panelEl.dataset.panel = tab.id;
            panelEl.style.display = "none";
            panelsContainer.appendChild(panelEl);
            this.tabContainers.set(tab.id, panelEl);
        });
    }

    private switchTab(tabId: TabId) {
        if (!this.tabContainers.has(tabId)) return;

        this.activeTab = tabId;
        this.tabButtons.forEach((btn, id) => {
            btn.classList.toggle("mobile-task-shortcut-tab--active", id === tabId);
        });
        this.tabContainers.forEach((container, id) => {
            const isActive = id === tabId;
            container.style.display = isActive ? "flex" : "none";
            if (isActive) {
                container.style.flexDirection = "column";
            }
        });

        if (!this.panels.has(tabId)) {
            const container = this.tabContainers.get(tabId);
            if (container) {
                this.createPanel(tabId, container);
            }
        }

        // 切换日历时需要通知其尺寸变化
        if (tabId === "calendar") {
            const calendar = this.panels.get("calendar") as CalendarView | undefined;
            if (calendar && (calendar as any).calendar) {
                window.setTimeout(() => {
                    try {
                        (calendar as any).calendar.updateSize();
                    } catch (_) { /* ignore */ }
                }, 50);
            }
        }
    }

    private createPanel(tabId: TabId, container: HTMLElement) {
        try {
            switch (tabId) {
                case "task": {
                    const panel = new ReminderPanel(container, this.plugin, () => {
                        this.closeDialog();
                    });
                    this.panels.set(tabId, panel);
                    break;
                }
                case "project": {
                    const panel = new ProjectPanel(container, this.plugin);
                    this.panels.set(tabId, panel);
                    break;
                }
                case "habit": {
                    const panel = new HabitPanel(container, this.plugin);
                    this.panels.set(tabId, panel);
                    break;
                }
                case "calendar": {
                    const panel = new CalendarView(container, this.plugin);
                    this.panels.set(tabId, panel);
                    break;
                }
            }
        } catch (error) {
            console.error(`创建手机快捷面板 ${tabId} 失败:`, error);
            container.textContent = i18n("loadFailed") || "加载失败";
        }
    }

    /** 同步按钮显示/隐藏状态 */
    async sync(settings?: any) {
        const resolvedSettings = settings || await (this.plugin as any).loadSettings();
        if (!this.shouldShow(resolvedSettings)) {
            this.removeButton(true);
            return;
        }

        const prevPosSetting = this.lastPositionSetting;
        const newPosSetting = (resolvedSettings?.mobileTaskShortcutPosition === "left") ? "left" : "right";
        this.lastPositionSetting = newPosSetting;

        if (this.button?.isConnected) {
            if (prevPosSetting !== null && prevPosSetting !== newPosSetting) {
                // 用户在设置中修改了默认停靠位置，重置为设置指定的靠边半显位置
                localStorage.removeItem(POSITION_STORAGE_KEY);
                this.dockState = newPosSetting;
                this.applyDock();
                this.savePosition();
            } else {
                this.restorePosition(resolvedSettings);
            }
        } else {
            this.ensureButton(resolvedSettings);
        }
        await this.refreshBadge();
    }

    /** 设置徽标数字 */
    setBadge(count: number) {
        if (!this.badge) return;

        if (count <= 0) {
            this.badge.textContent = "";
            this.badge.style.display = "none";
            return;
        }

        this.badge.textContent = count > 99 ? "99+" : count.toString();
        this.badge.style.display = "flex";
    }

    /** 从任务数据刷新徽标 */
    async refreshBadge() {
        if (!this.button) return;

        try {
            const { ReminderTaskLogic } = await import("../../utils/reminderTaskLogic");
            const count = await ReminderTaskLogic.getTaskCountByTabs(this.plugin, ["today", "overdue"], true);
            this.setBadge(count);
        } catch (error) {
            console.error("更新手机任务快捷按钮徽标失败:", error);
            this.setBadge(0);
        }
    }

    /** 销毁组件 */
    destroy() {
        this.removeButton(true);
    }
}
