import { Dialog, getFrontend, showMessage } from "siyuan";
import { i18n } from "../../pluginInstance";
import { ReminderPanel } from "../panel/ReminderPanel";
import { ProjectPanel } from "../panel/ProjectPanel";
import { HabitPanel } from "../panel/HabitPanel";
import { CalendarView } from "../panel/CalendarView";
import type ReminderPlugin from "../../index";
import { VipManager } from "../vip/vip";
import { ViewLifecycle } from "../../utils/viewLifecycle";

const POSITION_STORAGE_KEY = "siyuan-task-shortcut-pos";
const TAB_ORDER_STORAGE_KEY = "siyuan-task-shortcut-tab-order";

type TabId = "task" | "project" | "habit" | "calendar";
type DockState = "left" | "right" | null;
type BadgeMode = "merged" | "separate";

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
    private habitBadge: HTMLElement | null = null;
    private dialog: Dialog | null = null;
    private dragging = false;
    private longPressTimer: number | null = null;
    private dragOffset = { x: 0, y: 0 };
    private dockState: DockState = "right";
    private lastPositionSetting: string | null = null;
    private badgeMode: BadgeMode = "separate";
    private taskCount = 0;
    private habitCount = 0;
    // 键盘避让只改变显示位置，不覆盖用户保存的拖动位置。
    private preferredTop: number | null = null;
    private positionCleanup: (() => void) | null = null;

    private tabContainers: Map<TabId, HTMLElement> = new Map();
    private panels: Map<TabId, ReminderPanel | ProjectPanel | HabitPanel | CalendarView> = new Map();
    private activeTab: TabId = "task";
    private tabButtons: Map<TabId, HTMLElement> = new Map();
    private tabDragCleanup: (() => void) | null = null;
    private openingDialog = false;
    private disposed = false;

    constructor(plugin: ReminderPlugin) {
        this.plugin = plugin;
    }

    private isPhoneFrontend(): boolean {
        try {
            return getFrontend().endsWith("mobile");
        } catch (error) {
            console.warn("Failed to detect mobile device:", error);
            return false;
        }
    }

    private shouldShow(settings: any): boolean {
        return settings?.enableMobileTaskShortcut !== false && this.isPhoneFrontend();
    }

    private getTabs(): TabConfig[] {
        const tabs: TabConfig[] = [
            { id: "task", label: i18n("reminderPanel") || "任务面板", icon: "#iconTNTodoList" },
            { id: "project", label: i18n("projectManagement") || "项目管理", icon: "#iconTNProject" },
            { id: "habit", label: i18n("habitPanelTitle") || "习惯打卡", icon: "#iconTNHabit" },
            { id: "calendar", label: i18n("calendarView") || "日历视图", icon: "#iconTNCalendar" },
        ];
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(TAB_ORDER_STORAGE_KEY) || "[]");
            if (Array.isArray(saved)) {
                const order = [...new Set(saved)].filter((id): id is TabId => tabs.some(tab => tab.id === id));
                return [...order.map(id => tabs.find(tab => tab.id === id)!), ...tabs.filter(tab => !order.includes(tab.id))];
            }
        } catch (error) {
            console.warn("Failed to restore mobile shortcut tab order:", error);
        }
        return tabs;
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
                this.preferredTop = pos.top;
                button.style.left = `${left}px`;
                button.style.right = "auto";
                button.style.bottom = "auto";
                this.dockState = pos.dock !== undefined ? pos.dock : defaultDock;
                this.applyDock();
            } else {
                const defaultTop = Math.max(0, window.innerHeight - 72 - btnH);
                this.preferredTop = defaultTop;
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
                top: this.preferredTop ?? rect.top,
                dock: this.dockState,
            };
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
        } catch (_) { /* ignore */ }
    }

    private getVerticalBounds(buttonHeight: number) {
        const viewport = window.visualViewport;
        const top = Math.max(0, viewport?.offsetTop ?? 0);
        let bottom = Math.min(window.innerHeight, viewport ? top + viewport.height : window.innerHeight);
        const toolbar = document.getElementById("keyboardToolbar");
        if (toolbar && !toolbar.classList.contains("fn__none")) {
            const rect = toolbar.getBoundingClientRect();
            // 使用宿主工具栏的实际边界，同时兼容软键盘与展开的工具面板。
            if (rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.top < bottom) {
                bottom = Math.min(bottom, rect.top - 8);
            }
        }
        return { top, maxTop: Math.max(top, bottom - buttonHeight) };
    }

    private watchPosition() {
        this.positionCleanup?.();
        const viewport = window.visualViewport;
        let frame: number | null = null;
        let toolbar: HTMLElement | null = null;
        const schedule = () => {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(() => {
                frame = null;
                observeToolbar();
                this.applyDock();
            });
        };
        const toolbarObserver = new MutationObserver(schedule);
        const resizeObserver = new ResizeObserver(schedule);
        const observeToolbar = () => {
            const current = document.getElementById("keyboardToolbar");
            if (current === toolbar) return;
            toolbarObserver.disconnect();
            resizeObserver.disconnect();
            toolbar = current;
            if (toolbar) {
                toolbarObserver.observe(toolbar, { attributes: true, attributeFilter: ["class", "style"] });
                resizeObserver.observe(toolbar);
            }
        };
        // 工具栏可能在插件之后挂载；body 的键盘状态类也可能改变其可见性。
        const bodyObserver = new MutationObserver(schedule);
        bodyObserver.observe(document.body, { childList: true, attributes: true, attributeFilter: ["class", "style"] });
        observeToolbar();
        window.addEventListener("resize", schedule);
        viewport?.addEventListener("resize", schedule);
        viewport?.addEventListener("scroll", schedule);
        this.positionCleanup = () => {
            if (frame !== null) window.cancelAnimationFrame(frame);
            window.removeEventListener("resize", schedule);
            viewport?.removeEventListener("resize", schedule);
            viewport?.removeEventListener("scroll", schedule);
            toolbarObserver.disconnect();
            resizeObserver.disconnect();
            bodyObserver.disconnect();
        };
    }

    private applyDock() {
        const button = this.button;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const btnW = rect.width || button.offsetWidth || 52;
        const btnH = rect.height || button.offsetHeight || 52;
        const currentTop = this.preferredTop ?? rect.top;
        const bounds = this.getVerticalBounds(btnH);
        const clampedTop = Math.max(bounds.top, Math.min(currentTop, bounds.maxTop));
        button.style.top = `${clampedTop}px`;
        button.style.right = "auto";
        button.style.bottom = "auto";

        if (this.dockState === "left") {
            button.style.left = `${-btnW / 2}px`;
            button.style.top = `${clampedTop}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            button.classList.add("mobile-task-shortcut--docked-left");
            button.classList.remove("mobile-task-shortcut--docked-right");
            this.setBadgeHorizontalPosition("right");
        } else if (this.dockState === "right") {
            button.style.left = `${window.innerWidth - btnW / 2}px`;
            button.style.top = `${clampedTop}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            button.classList.add("mobile-task-shortcut--docked-right");
            button.classList.remove("mobile-task-shortcut--docked-left");
            this.setBadgeHorizontalPosition("left");
        } else {
            button.classList.remove("mobile-task-shortcut--docked-left", "mobile-task-shortcut--docked-right");
            this.setBadgeHorizontalPosition(null);
        }
    }

    private setBadgeHorizontalPosition(side: "left" | "right" | null) {
        [this.badge, this.habitBadge].forEach((badge) => {
            if (!badge) return;
            if (side === "left") {
                badge.style.left = "-4px";
                badge.style.right = "auto";
            } else if (side === "right") {
                badge.style.left = "auto";
                badge.style.right = "-4px";
            } else {
                badge.style.left = "";
                badge.style.right = "";
            }
        });
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
        this.setBadgeHorizontalPosition(null);
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
            <span class="mobile-task-shortcut__badge mobile-task-shortcut__badge--task"></span>
            <span class="mobile-task-shortcut__badge mobile-task-shortcut__badge--habit"></span>
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
            const bounds = this.getVerticalBounds(btnH);
            const clampedY = Math.max(bounds.top, Math.min(y, bounds.maxTop));
            this.preferredTop = clampedY;
            button.style.left = `${clampedX}px`;
            button.style.top = `${clampedY}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            // 拖动时临时完整显示，便于用户定位
            button.classList.remove("mobile-task-shortcut--docked-left", "mobile-task-shortcut--docked-right");
            this.setBadgeHorizontalPosition(null);
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
        this.badge = button.querySelector(".mobile-task-shortcut__badge--task") as HTMLElement;
        this.habitBadge = button.querySelector(".mobile-task-shortcut__badge--habit") as HTMLElement;

        this.restorePosition(settings);
        this.watchPosition();
        this.renderBadges();
    }

    private removeButton(destroyDialog: boolean = true) {
        this.positionCleanup?.();
        this.positionCleanup = null;
        this.preferredTop = null;
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
        this.habitBadge = null;
    }

    private destroyPanels() {
        this.tabDragCleanup?.();
        this.tabDragCleanup = null;
        this.panels.forEach((panel) => {
            try {
                panel.destroy();
            } catch (e) {
                console.warn("Failed to destroy mobile quick panel:", e);
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
            void this.openDialog();
        }
    }

    private closeDialog() {
        if (!this.dialog) return;
        const dialog = this.dialog;
        this.dialog = null;
        try {
            dialog.destroy();
        } catch (e) {
            console.warn("Failed to close quick popup:", e);
        }
        this.destroyPanels();
        this.applyDock();
    }

    private async openDialog() {
        if (!this.isPhoneFrontend() || this.dialog || this.openingDialog || this.disposed) return;
        const sourceButton = this.button;
        if (!sourceButton?.isConnected) return;
        this.openingDialog = true;
        try {
            const isVip = await VipManager.isVip(this.plugin);
            if (this.disposed || this.button !== sourceButton || !sourceButton.isConnected || !this.isPhoneFrontend()) return;
            if (!isVip) {
                this.plugin.openVipDialog();
                return;
            }
            this.expandButton();
            this.createDialog();
        } catch (error) {
            console.error("Failed to open mobile task shortcut:", error);
            showMessage(i18n("loadFailed"), 3000, "error");
        } finally {
            this.openingDialog = false;
        }
    }

    private createDialog() {
        const dialog = new Dialog({
            title: i18n("mobileTaskShortcut") || "任务笔记管理",
            content: `
                <div class="mobile-task-shortcut-tabs" id="mobileTaskShortcutTabs"></div>
                <div class="mobile-task-shortcut-panels" id="mobileTaskShortcutPanels"></div>
            `,
            width: "100vw",
            height: "100dvh",
            destroyCallback: () => {
                this.destroyPanels();
                this.dialog = null;
                this.applyDock();
            },
        });
        dialog.element.classList.add("mobile-task-shortcut-dialog");
        this.dialog = dialog;

        this.initTabs();
        this.activeTab = this.getTabs()[0].id;
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
        this.setupTabReorder(tabsContainer, panelsContainer);
    }

    /** 长按后只调整已有节点的位置，保留当前面板和未保存的输入。 */
    private setupTabReorder(tabsContainer: HTMLElement, panelsContainer: HTMLElement) {
        this.tabDragCleanup?.();
        const lifecycle = new ViewLifecycle();
        let pointerId: number | null = null;
        let touchId: number | null = null;
        let timer: number | null = null;
        let dragged: HTMLElement | null = null;
        let preview: HTMLElement | null = null;
        let dragging = false;
        let suppressClickUntil = 0;
        let startX = 0;
        let startY = 0;
        let startOrder: TabId[] = [];

        const readOrder = () => Array.from(tabsContainer.children).map(node => (node as HTMLElement).dataset.tab as TabId);
        const syncPanels = () => readOrder().forEach(id => {
            const panel = this.tabContainers.get(id);
            if (panel) panelsContainer.appendChild(panel);
        });
        const clearTimer = () => {
            if (timer !== null) lifecycle.clearTimeout(timer);
            timer = null;
        };
        const finish = (cancelled: boolean) => {
            clearTimer();
            const capturedPointer = pointerId;
            pointerId = null;
            touchId = null;
            if (dragging) {
                suppressClickUntil = Date.now() + 400;
                if (cancelled) {
                    startOrder.forEach(id => {
                        const button = this.tabButtons.get(id);
                        if (button) tabsContainer.appendChild(button);
                    });
                    syncPanels();
                } else {
                    try {
                        localStorage.setItem(TAB_ORDER_STORAGE_KEY, JSON.stringify(readOrder()));
                    } catch (error) {
                        console.warn("Failed to save mobile shortcut tab order:", error);
                    }
                }
            }
            preview?.remove();
            preview = null;
            dragged?.classList.remove("mobile-task-shortcut-tab--dragging");
            dragged = null;
            dragging = false;
            if (capturedPointer !== null && tabsContainer.hasPointerCapture(capturedPointer)) {
                tabsContainer.releasePointerCapture(capturedPointer);
            }
        };

        const begin = (target: EventTarget | null, clientX: number, clientY: number) => {
            const button = target instanceof Element ? target.closest<HTMLElement>(".mobile-task-shortcut-tab") : null;
            if (!button || !tabsContainer.contains(button)) return false;
            suppressClickUntil = 0;
            dragged = button;
            startX = clientX;
            startY = clientY;
            startOrder = readOrder();
            timer = lifecycle.timeout(() => {
                timer = null;
                if (!button.isConnected || !tabsContainer.contains(button)) {
                    finish(true);
                    return;
                }
                dragging = true;
                button.classList.add("mobile-task-shortcut-tab--dragging");
                // 与任务卡片保持一致：淡化原位置，并显示跟随手指的浮动标题。
                preview = document.createElement("div");
                preview.className = "reminder-touch-drag-preview";
                preview.textContent = button.textContent?.trim() || "";
                preview.style.width = `${button.getBoundingClientRect().width}px`;
                preview.style.left = `${startX}px`;
                preview.style.top = `${startY}px`;
                document.body.appendChild(preview);
                if (pointerId !== null) tabsContainer.setPointerCapture(pointerId);
            }, 460);
            return true;
        };
        const move = (clientX: number, clientY: number) => {
            if (!dragging) {
                if (Math.abs(clientX - startX) > 5 || Math.abs(clientY - startY) > 5) {
                    finish(true);
                }
                return;
            }
            if (!dragged?.isConnected || !tabsContainer.contains(dragged)) {
                finish(true);
                return;
            }
            preview!.style.left = `${clientX}px`;
            preview!.style.top = `${clientY}px`;
            const rect = tabsContainer.getBoundingClientRect();
            if (clientY < rect.top - 24 || clientY > rect.bottom + 24) return;
            const next = Array.from(tabsContainer.children).find(node => {
                if (node === dragged) return false;
                const bounds = node.getBoundingClientRect();
                return clientX < bounds.left + bounds.width / 2;
            });
            if (dragged.nextElementSibling !== (next || null)) {
                tabsContainer.insertBefore(dragged, next || null);
                syncPanels();
            }
        };
        const consume = (event: Event) => {
            if (event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();
        };

        // 移动端沿用任务长按的 TouchEvent 路径，在捕获阶段阻止宿主把拖动识别为滑动。
        lifecycle.listen(tabsContainer, "touchstart", (event: TouchEvent) => {
            finish(true);
            if (event.touches.length !== 1) return;
            const touch = event.touches[0];
            if (begin(event.target, touch.clientX, touch.clientY)) touchId = touch.identifier;
        }, { passive: true });
        lifecycle.listen(document, "touchstart", (event: TouchEvent) => {
            if (touchId !== null && event.touches.length !== 1) finish(true);
        }, { capture: true, passive: true });
        lifecycle.listen(document, "touchmove", (event: TouchEvent) => {
            if (touchId === null) return;
            const touch = Array.from(event.touches).find(point => point.identifier === touchId);
            if (event.touches.length !== 1 || !touch) {
                finish(true);
                return;
            }
            if (dragging) consume(event);
            move(touch.clientX, touch.clientY);
        }, { capture: true, passive: false });
        lifecycle.listen(document, "touchend", (event: TouchEvent) => {
            if (touchId === null) return;
            const touch = Array.from(event.changedTouches).find(point => point.identifier === touchId);
            if (!touch || event.touches.length !== 0) {
                finish(true);
                return;
            }
            if (dragging) {
                consume(event);
                move(touch.clientX, touch.clientY);
            }
            finish(false);
        }, { capture: true, passive: false });
        lifecycle.listen(document, "touchcancel", () => finish(true), true);

        // 保留鼠标/手写笔调试入口；触摸仅由上面的监听处理，避免重复启动。
        lifecycle.listen(tabsContainer, "pointerdown", (event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            if (pointerId !== null || !event.isPrimary) {
                finish(true);
                return;
            }
            if (touchId !== null || event.button !== 0) return;
            if (begin(event.target, event.clientX, event.clientY)) pointerId = event.pointerId;
        });
        lifecycle.listen(document, "pointermove", (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;
            if (dragging) consume(event);
            move(event.clientX, event.clientY);
        }, { capture: true, passive: false });
        lifecycle.listen(document, "pointerdown", (event: PointerEvent) => {
            if (pointerId !== null && event.pointerId !== pointerId) finish(true);
        });
        lifecycle.listen(document, "pointerup", (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;
            if (dragging) {
                consume(event);
                move(event.clientX, event.clientY);
            }
            finish(false);
        });
        lifecycle.listen(document, "pointercancel", (event: PointerEvent) => {
            if (event.pointerId === pointerId) finish(true);
        });
        lifecycle.listen(tabsContainer, "lostpointercapture", (event: PointerEvent) => {
            if (event.pointerId === pointerId) finish(true);
        });
        lifecycle.listen(tabsContainer, "click", (event: MouseEvent) => {
            if (Date.now() < suppressClickUntil) consume(event);
        }, true);
        lifecycle.listen(tabsContainer, "contextmenu", (event: Event) => event.preventDefault());
        lifecycle.listen(window, "blur", () => finish(true));
        lifecycle.listen(document, "visibilitychange", () => {
            if (document.hidden) finish(true);
        });
        this.tabDragCleanup = () => {
            finish(true);
            lifecycle.dispose();
        };
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
            console.error(`Failed to create mobile quick panel ${tabId}:`, error);
            container.textContent = i18n("loadFailed") || "加载失败";
        }
    }

    /** 同步按钮显示/隐藏状态 */
    async sync(settings?: any) {
        const resolvedSettings = settings || await (this.plugin as any).loadSettings();
        if (this.disposed) return;
        if (!this.shouldShow(resolvedSettings)) {
            this.removeButton(true);
            return;
        }

        const prevPosSetting = this.lastPositionSetting;
        const newPosSetting = (resolvedSettings?.mobileTaskShortcutPosition === "left") ? "left" : "right";
        this.badgeMode = resolvedSettings?.mobileTaskShortcutBadgeMode === "merged" ? "merged" : "separate";
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

    private normalizeCount(count: number): number {
        return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    }

    private renderBadge(badge: HTMLElement | null, count: number, title: string) {
        if (!badge) return;
        badge.title = title;
        badge.setAttribute("aria-label", title);

        if (count <= 0) {
            badge.textContent = "";
            badge.style.display = "none";
            return;
        }

        badge.textContent = count > 99 ? "99+" : count.toString();
        badge.style.display = "flex";
    }

    private renderBadges() {
        const taskTitle = i18n("mobileTaskShortcutTaskCount", { count: this.taskCount.toString() }) || `待办任务：${this.taskCount}`;
        const habitTitle = i18n("mobileTaskShortcutHabitCount", { count: this.habitCount.toString() }) || `待打卡习惯：${this.habitCount}`;
        const summary = i18n("mobileTaskShortcutCountSummary", {
            taskCount: this.taskCount.toString(),
            habitCount: this.habitCount.toString(),
        }) || `待办任务 ${this.taskCount}，待打卡习惯 ${this.habitCount}`;

        if (this.badgeMode === "separate") {
            this.renderBadge(this.badge, this.taskCount, taskTitle);
            this.renderBadge(this.habitBadge, this.habitCount, habitTitle);
        } else {
            this.renderBadge(this.badge, this.taskCount + this.habitCount, summary);
            this.renderBadge(this.habitBadge, 0, habitTitle);
        }

        if (this.button) {
            const shortcutTitle = i18n("mobileTaskShortcut") || i18n("taskManagement") || "任务快捷按钮";
            const accessibleTitle = `${shortcutTitle} · ${summary}`;
            this.button.classList.toggle("mobile-task-shortcut--badges-separate", this.badgeMode === "separate");
            this.button.title = accessibleTitle;
            this.button.setAttribute("aria-label", accessibleTitle);
        }
    }

    /** 设置任务徽标数字 */
    setTaskCount(count: number) {
        this.taskCount = this.normalizeCount(count);
        this.renderBadges();
    }

    /** 设置习惯徽标数字 */
    setHabitCount(count: number) {
        this.habitCount = this.normalizeCount(count);
        this.renderBadges();
    }

    /** 兼容原有调用：设置任务徽标数字 */
    setBadge(count: number) {
        this.setTaskCount(count);
    }

    /** 从任务与习惯数据刷新徽标 */
    async refreshBadge() {
        if (!this.button) return;

        const taskCountPromise = (async () => {
            try {
                const { ReminderTaskLogic } = await import("../../utils/reminderTaskLogic");
                return await ReminderTaskLogic.getTaskCountByTabs(this.plugin, ["today", "overdue"], true);
            } catch (error) {
                console.error("Failed to update mobile quick button task badge:", error);
                return 0;
            }
        })();

        const habitCountPromise = (async () => {
            try {
                const [habitData, { getLogicalDateString }, { getTodayHabitBuckets }, { PomodoroRecordManager }] = await Promise.all([
                    (this.plugin as any).loadHabitData(),
                    import("../../utils/dateUtils"),
                    import("../../utils/habitUtils"),
                    import("../dataManager/pomodoroRecord"),
                ]);
                if (!habitData || typeof habitData !== "object") return 0;

                const today = getLogicalDateString();
                const buckets = getTodayHabitBuckets(Object.values(habitData), today, {
                    getPomodoroFocusMinutes: (habitId, date) =>
                        PomodoroRecordManager.getInstance(this.plugin).getEventFocusTime(habitId, date) || 0,
                });
                return buckets.pendingHabits.length;
            } catch (error) {
                console.error("Failed to update mobile quick button habit badge:", error);
                return 0;
            }
        })();

        const [taskCount, habitCount] = await Promise.all([taskCountPromise, habitCountPromise]);
        this.taskCount = this.normalizeCount(taskCount);
        this.habitCount = this.normalizeCount(habitCount);
        this.renderBadges();
    }

    /** 销毁组件 */
    destroy() {
        this.disposed = true;
        this.removeButton(true);
    }
}
