import { Dialog, getFrontend } from "siyuan";
import { i18n } from "../../pluginInstance";
import { ReminderPanel } from "../ReminderPanel";
import type ReminderPlugin from "../../index";

const POSITION_STORAGE_KEY = "siyuan-task-shortcut-pos";

export class MobileTaskShortcut {
    private plugin: ReminderPlugin;
    private button: HTMLElement | null = null;
    private badge: HTMLElement | null = null;
    private dialog: Dialog | null = null;
    private panel: ReminderPanel | null = null;
    private dragging = false;
    private longPressTimer: number | null = null;
    private dragOffset = { x: 0, y: 0 };

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

    private restorePosition() {
        const button = this.button;
        if (!button) return;
        try {
            const saved = localStorage.getItem(POSITION_STORAGE_KEY);
            if (!saved) return;
            const { left, top } = JSON.parse(saved);
            const btnW = button.offsetWidth;
            const btnH = button.offsetHeight;
            const clampedX = Math.max(0, Math.min(left, window.innerWidth - btnW));
            const clampedY = Math.max(0, Math.min(top, window.innerHeight - btnH));
            button.style.left = `${clampedX}px`;
            button.style.top = `${clampedY}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
        } catch (_) { /* ignore */ }
    }

    private ensureButton() {
        if (this.button?.isConnected) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "mobile-task-shortcut ariaLabel";
        button.title = i18n("mobileTaskShortcut") || i18n("taskManagement") || "任务快捷按钮";
        button.setAttribute("aria-label", button.title);
        button.innerHTML = `
            <svg class="mobile-task-shortcut__icon" aria-hidden="true">
                <use xlink:href="#iconClock"></use>
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
        };

        const endDrag = () => {
            clearLongPressTimer();
            if (this.dragging) {
                this.dragging = false;
                button.classList.remove("mobile-task-shortcut--dragging");
                try {
                    const rect = button.getBoundingClientRect();
                    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({
                        left: rect.left,
                        top: rect.top,
                    }));
                } catch (_) { /* ignore */ }
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
            this.openDialog();
        });

        document.body.appendChild(button);
        this.button = button;
        this.badge = button.querySelector(".mobile-task-shortcut__badge") as HTMLElement;

        this.restorePosition();
    }

    private removeButton(destroyDialog: boolean = true) {
        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        this.dragging = false;

        if (destroyDialog && this.dialog) {
            const dialog = this.dialog;
            this.dialog = null;
            dialog.destroy();
        }

        if (this.panel) {
            this.panel.destroy();
            this.panel = null;
        }

        this.button?.remove();
        this.button = null;
        this.badge = null;
    }

    private openDialog() {
        if (!this.isPhoneFrontend()) return;
        if (this.dialog) return;

        const dialog = new Dialog({
            title: "⏰任务笔记管理",
            content: '<div id="mobileTaskShortcutPanelContainer" style="height: 100%; width: 100%;"></div>',
            width: "99%",
            height: "100%",
            destroyCallback: () => {
                if (this.panel) {
                    this.panel.destroy();
                    this.panel = null;
                }
                this.dialog = null;
            },
        });
        dialog.element.classList.add("mobile-task-shortcut-dialog");
        this.dialog = dialog;

        const panelContainer = dialog.element.querySelector("#mobileTaskShortcutPanelContainer") as HTMLElement;
        if (panelContainer) {
            this.panel = new ReminderPanel(panelContainer, this.plugin);
        }
    }

    /** 同步按钮显示/隐藏状态 */
    async sync(settings?: any) {
        const resolvedSettings = settings || await (this.plugin as any).loadSettings();
        if (!this.shouldShow(resolvedSettings)) {
            this.removeButton(true);
            return;
        }

        this.ensureButton();
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
