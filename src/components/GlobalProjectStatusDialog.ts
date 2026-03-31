import { Dialog, showMessage, confirm, openEmoji } from "siyuan";
import { i18n } from "../pluginInstance";

interface GlobalKanbanStatusConfig {
    id: string;
    name: string;
    color: string;
    icon?: string;
    isFixed: boolean;
    sort: number;
}

export class GlobalProjectStatusDialog {
    private plugin: any;
    private onSaved?: () => void | Promise<void>;
    private dialog: Dialog | null = null;
    private statuses: GlobalKanbanStatusConfig[] = [];
    private draggedElement: HTMLElement | null = null;
    private draggedStatus: GlobalKanbanStatusConfig | null = null;

    constructor(plugin: any, onSaved?: () => void | Promise<void>) {
        this.plugin = plugin;
        this.onSaved = onSaved;
    }

    private getBuiltInStatuses(): GlobalKanbanStatusConfig[] {
        return [
            {
                id: "doing",
                name: i18n("doing") || "进行中",
                color: "#e74c3c",
                icon: "⏳",
                isFixed: true,
                sort: 0,
            },
            {
                id: "short_term",
                name: i18n("shortTerm") || "短期",
                color: "#3498db",
                icon: "📋",
                isFixed: false,
                sort: 10,
            },
            {
                id: "long_term",
                name: i18n("longTerm") || "长期",
                color: "#9b59b6",
                icon: "🤔",
                isFixed: false,
                sort: 20,
            },
            {
                id: "completed",
                name: i18n("completed") || "已完成",
                color: "#27ae60",
                icon: "✅",
                isFixed: true,
                sort: 100,
            },
            {
                id: "abandoned",
                name: i18n("abandoned") || "放弃",
                color: "#7f8c8d",
                icon: "🚫",
                isFixed: true,
                sort: 110,
            },
        ];
    }

    private normalizeStatuses(raw: any): GlobalKanbanStatusConfig[] {
        if (!Array.isArray(raw) || raw.length === 0) return [];

        const builtIn = this.getBuiltInStatuses();
        const builtInMap = new Map<string, GlobalKanbanStatusConfig>(
            builtIn.map(item => [item.id, item])
        );

        const normalized: GlobalKanbanStatusConfig[] = [];
        const seenIds = new Set<string>();

        raw.forEach((item: any, index: number) => {
            if (!item || typeof item !== "object") return;

            const id = typeof item.id === "string" ? item.id.trim() : "";
            const name = typeof item.name === "string" ? item.name.trim() : "";
            if (!id || !name || seenIds.has(id)) return;

            const fallback = builtInMap.get(id);
            const color = typeof item.color === "string" && item.color.trim()
                ? item.color.trim()
                : fallback?.color || "#3498db";
            const icon = typeof item.icon === "string" && item.icon.trim()
                ? item.icon.trim()
                : fallback?.icon;
            const sort = typeof item.sort === "number" && Number.isFinite(item.sort)
                ? item.sort
                : index * 10;

            normalized.push({
                id,
                name,
                color,
                icon,
                isFixed: id === "doing" || id === "completed" || id === "abandoned" ? true : item.isFixed === true,
                sort,
            });
            seenIds.add(id);
        });

        for (const requiredId of ["doing", "completed", "abandoned"]) {
            if (seenIds.has(requiredId)) continue;
            const fallback = builtInMap.get(requiredId);
            if (fallback) {
                normalized.push({ ...fallback });
            }
        }

        normalized.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        normalized.forEach((item, index) => {
            item.sort = index * 10;
            if (item.id === "doing" || item.id === "completed" || item.id === "abandoned") {
                item.isFixed = true;
            }
        });

        return normalized;
    }

    private async saveStatusesToSettings(storeRaw?: GlobalKanbanStatusConfig[]): Promise<void> {
        const settings = (await this.plugin.loadSettings(true)) || {};
        settings.globalKanbanStatuses = storeRaw ?? this.normalizeStatuses(this.statuses);
        await this.plugin.saveSettings(settings);
        this.plugin.settings = { ...settings };

        window.dispatchEvent(
            new CustomEvent("reminderSettingsUpdated", {
                detail: { fromGlobalProjectStatusDialog: true },
            })
        );
        if (this.onSaved) {
            await this.onSaved();
        }
    }

    private createDialogContent(): string {
        return `
            <div class="status-manage-dialog">
                <div class="b3-dialog__content">
                    <div class="status-toolbar">
                        <button class="b3-button b3-button--primary" id="addGlobalStatusBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("addStatus") || "添加状态"}
                        </button>
                        <button class="b3-button b3-button--outline" id="resetGlobalStatusesBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            ${i18n("resetToDefault") || "重置为默认"}
                        </button>
                    </div>
                    <div class="status-drag-hint">
                        <span>💡 ${i18n("dragHint") || "拖拽可调整状态顺序，所有新建项目将使用该顺序。"}</span>
                    </div>
                    <div class="statuses-list" id="globalStatusesList"></div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--primary" id="closeGlobalStatusBtn">${i18n("close") || "关闭"}</button>
                </div>
            </div>
            <style>
                .status-manage-dialog {
                    max-height: 600px;
                }
                .status-toolbar {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                .status-drag-hint {
                    padding: 8px 16px;
                    background: rgba(52, 152, 219, 0.1);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    font-size: 12px;
                    color: #666;
                    text-align: center;
                }
                .statuses-list {
                    overflow-y: auto;
                }
                .status-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface);
                    border: 1px solid var(--b3-border-color);
                    border-radius: 6px;
                    cursor: grab;
                    transition: all 0.2s ease;
                    position: relative;
                }
                .status-item:hover {
                    background: var(--b3-theme-surface-lighter);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .status-item.dragging {
                    opacity: 0.6;
                    cursor: grabbing;
                    transform: rotate(2deg);
                    z-index: 1000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                .status-item.drag-over-top {
                    border-top: 3px solid #3498db;
                    box-shadow: 0 -2px 0 rgba(52, 152, 219, 0.3);
                }
                .status-item.drag-over-bottom {
                    border-bottom: 3px solid #3498db;
                    box-shadow: 0 2px 0 rgba(52, 152, 219, 0.3);
                }
                .status-drag-handle {
                    cursor: grab;
                    padding: 4px;
                    color: #999;
                    display: flex;
                    align-items: center;
                    margin-right: 10px;
                }
                .status-drag-handle::before {
                    content: "⋮⋮";
                    font-size: 16px;
                    line-height: 1;
                }
                .status-info {
                    display: flex;
                    align-items: center;
                    flex: 1;
                    gap: 8px;
                    min-width: 0;
                }
                .status-color-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    border: 1px solid rgba(0,0,0,0.08);
                    flex-shrink: 0;
                }
                .status-icon {
                    font-size: 16px;
                    width: 20px;
                    text-align: center;
                    flex-shrink: 0;
                }
                .status-name {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .status-fixed-tag {
                    font-size: 12px;
                    color: var(--b3-theme-on-surface-light);
                    margin-left: 4px;
                    flex-shrink: 0;
                }
                .status-actions {
                    display: flex;
                    gap: 4px;
                    margin-left: 10px;
                }
            </style>
        `;
    }

    public async show(): Promise<void> {
        const settings = (await this.plugin.loadSettings(true)) || {};
        const globalStatuses = this.normalizeStatuses(settings.globalKanbanStatuses);
        this.statuses = globalStatuses.length > 0 ? globalStatuses : this.getBuiltInStatuses();

        this.dialog = new Dialog({
            title: i18n("globalKanbanStatuses") || "全局项目默认状态",
            content: this.createDialogContent(),
            width: "560px",
            height: "620px",
        });

        this.bindEvents();
        this.renderStatuses();
    }

    private bindEvents() {
        const addBtn = this.dialog?.element.querySelector("#addGlobalStatusBtn") as HTMLButtonElement;
        const resetBtn = this.dialog?.element.querySelector("#resetGlobalStatusesBtn") as HTMLButtonElement;
        const closeBtn = this.dialog?.element.querySelector("#closeGlobalStatusBtn") as HTMLButtonElement;

        addBtn?.addEventListener("click", () => this.showEditStatusDialog());
        resetBtn?.addEventListener("click", () => this.resetStatuses());
        closeBtn?.addEventListener("click", () => this.dialog?.destroy());
    }

    private renderStatuses() {
        const listEl = this.dialog?.element.querySelector("#globalStatusesList") as HTMLElement;
        if (!listEl) return;

        listEl.innerHTML = "";
        this.statuses
            .slice()
            .sort((a, b) => (a.sort || 0) - (b.sort || 0))
            .forEach(status => {
                listEl.appendChild(this.createStatusElement(status));
            });
    }

    private createStatusElement(status: GlobalKanbanStatusConfig): HTMLElement {
        const el = document.createElement("div");
        el.className = "status-item";
        el.draggable = true;
        el.dataset.statusId = status.id;
        el.innerHTML = `
            <div class="status-drag-handle ariaLabel" aria-label="${i18n("dragHint") || "拖拽排序"}"></div>
            <div class="status-info">
                <span class="status-color-dot" style="background: ${status.color};"></span>
                <span class="status-icon">${status.icon || "📋"}</span>
                <span class="status-name">${status.name}</span>
                ${status.isFixed ? `<span class="status-fixed-tag">(${i18n("fixed") || "固定"})</span>` : ""}
            </div>
            <div class="status-actions">
                <button class="b3-button b3-button--outline ariaLabel" data-action="edit" aria-label="${i18n("editStatus") || "编辑状态"}">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                </button>
                ${!status.isFixed ? `
                <button class="b3-button b3-button--outline ariaLabel" data-action="delete" aria-label="${i18n("deleteStatus") || "删除状态"}">
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>` : ""}
            </div>
        `;

        this.bindDragEvents(el, status);

        const editBtn = el.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = el.querySelector('[data-action="delete"]') as HTMLButtonElement;

        editBtn?.addEventListener("click", e => {
            e.stopPropagation();
            this.showEditStatusDialog(status);
        });

        deleteBtn?.addEventListener("click", e => {
            e.stopPropagation();
            this.deleteStatus(status);
        });

        return el;
    }

    private bindDragEvents(element: HTMLElement, status: GlobalKanbanStatusConfig) {
        element.addEventListener("dragstart", e => {
            this.draggedElement = element;
            this.draggedStatus = status;
            element.classList.add("dragging");
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
            }
        });

        element.addEventListener("dragend", () => {
            element.classList.remove("dragging");
            this.draggedElement = null;
            this.draggedStatus = null;
            this.dialog?.element.querySelectorAll(".status-item").forEach(item => {
                item.classList.remove("drag-over-top", "drag-over-bottom");
            });
        });

        element.addEventListener("dragover", e => {
            e.preventDefault();
            if (!this.draggedElement || this.draggedElement === element) return;
            const rect = element.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            element.classList.remove("drag-over-top", "drag-over-bottom");
            if (e.clientY < mid) {
                element.classList.add("drag-over-top");
            } else {
                element.classList.add("drag-over-bottom");
            }
        });

        element.addEventListener("dragleave", e => {
            const rect = element.getBoundingClientRect();
            if (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
            ) {
                element.classList.remove("drag-over-top", "drag-over-bottom");
            }
        });

        element.addEventListener("drop", async e => {
            e.preventDefault();
            element.classList.remove("drag-over-top", "drag-over-bottom");
            if (!this.draggedElement || !this.draggedStatus || this.draggedElement === element) return;

            const targetId = element.dataset.statusId || "";
            const targetStatus = this.statuses.find(s => s.id === targetId);
            if (!targetStatus) return;

            const rect = element.getBoundingClientRect();
            const insertBefore = e.clientY < rect.top + rect.height / 2;
            await this.handleStatusReorder(this.draggedStatus, targetStatus, insertBefore);
        });
    }

    private async handleStatusReorder(
        draggedStatus: GlobalKanbanStatusConfig,
        targetStatus: GlobalKanbanStatusConfig,
        insertBefore: boolean
    ) {
        const draggedIndex = this.statuses.findIndex(s => s.id === draggedStatus.id);
        const targetIndexRaw = this.statuses.findIndex(s => s.id === targetStatus.id);
        if (draggedIndex === -1 || targetIndexRaw === -1 || draggedIndex === targetIndexRaw) return;

        const reordered = [...this.statuses];
        const [removed] = reordered.splice(draggedIndex, 1);
        const targetIndex = reordered.findIndex(s => s.id === targetStatus.id);
        reordered.splice(insertBefore ? targetIndex : targetIndex + 1, 0, removed);
        reordered.forEach((s, idx) => {
            s.sort = idx * 10;
            if (s.id === "doing" || s.id === "completed" || s.id === "abandoned") s.isFixed = true;
        });

        this.statuses = reordered;
        try {
            await this.saveStatusesToSettings();
            this.renderStatuses();
            showMessage(i18n("statusOrderSaved") || "状态顺序已更新");
        } catch (error) {
            console.error("保存全局项目状态排序失败:", error);
            showMessage(i18n("saveReminderFailed") || "保存失败");
        }
    }

    private generateStatusId(): string {
        return `global_status_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    private showEditStatusDialog(status?: GlobalKanbanStatusConfig) {
        const isEdit = !!status;
        const editDialog = new Dialog({
            title: isEdit ? (i18n("editStatus") || "编辑状态") : (i18n("newStatus") || "新建状态"),
            width: "420px",
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("statusName") || "状态名称"}</label>
                        <input id="globalStatusName" class="b3-text-field" value="${status?.name || ""}" placeholder="${i18n("pleaseEnterStatusName") || "请输入状态名称"}" style="width:100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("statusIcon") || "状态图标"}</label>
                        <div id="globalStatusIcon" style="width:40px;height:40px;border-radius:50%;background:var(--b3-theme-surface-lighter);border:2px solid var(--b3-theme-primary-lighter);display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;">${status?.icon || "📋"}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("statusColor") || "状态颜色"}</label>
                        <input id="globalStatusColor" type="color" class="b3-text-field" value="${status?.color || "#3498db"}" style="width:100%;height:40px;">
                    </div>
                    ${isEdit ? `
                    <div class="b3-label__text" style="margin-top:6px;">
                        ID: ${status?.id}
                    </div>` : ""}
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="globalStatusEditCancel">${i18n("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--primary" id="globalStatusEditSave">${i18n("save") || "保存"}</button>
                </div>
            `,
        });

        const nameInput = editDialog.element.querySelector("#globalStatusName") as HTMLInputElement;
        const iconEl = editDialog.element.querySelector("#globalStatusIcon") as HTMLElement;
        const colorInput = editDialog.element.querySelector("#globalStatusColor") as HTMLInputElement;
        const cancelBtn = editDialog.element.querySelector("#globalStatusEditCancel") as HTMLButtonElement;
        const saveBtn = editDialog.element.querySelector("#globalStatusEditSave") as HTMLButtonElement;

        iconEl?.addEventListener("click", e => {
            e.stopPropagation();
            this.openBuiltInEmojiPicker(iconEl);
        });

        cancelBtn?.addEventListener("click", () => editDialog.destroy());

        saveBtn?.addEventListener("click", async () => {
            const name = nameInput.value.trim();
            const icon = (iconEl.textContent || "").trim();
            const color = colorInput.value || "#3498db";

            if (!name) {
                showMessage(i18n("pleaseEnterStatusName") || "请输入状态名称");
                return;
            }

            const duplicateName = this.statuses.some(s =>
                s.name === name && (!isEdit || s.id !== status?.id)
            );
            if (duplicateName) {
                showMessage(i18n("statusNameExists") || "状态名称已存在");
                return;
            }

            if (isEdit && status) {
                const idx = this.statuses.findIndex(s => s.id === status.id);
                if (idx !== -1) {
                    this.statuses[idx] = {
                        ...this.statuses[idx],
                        name,
                        icon: icon || undefined,
                        color,
                    };
                }
            } else {
                const maxSort = this.statuses.reduce((max, s) => Math.max(max, s.sort || 0), 0);
                this.statuses.push({
                    id: this.generateStatusId(),
                    name,
                    color,
                    icon: icon || undefined,
                    isFixed: false,
                    sort: maxSort + 10,
                });
            }

            try {
                this.statuses = this.normalizeStatuses(this.statuses);
                await this.saveStatusesToSettings();
                editDialog.destroy();
                this.renderStatuses();
                showMessage(i18n("statusUpdated") || "状态已保存");
            } catch (error) {
                console.error("保存全局项目状态失败:", error);
                showMessage(i18n("saveReminderFailed") || "保存失败");
            }
        });
    }

    private deleteStatus(status: GlobalKanbanStatusConfig) {
        if (status.isFixed) {
            showMessage(i18n("fixedStatusCannotDelete") || "固定状态不可删除");
            return;
        }

        confirm(
            i18n("deleteStatus") || "删除状态",
            i18n("confirmDeleteStatus", { name: status.name }) || `确定删除状态「${status.name}」吗？`,
            async () => {
                try {
                    this.statuses = this.statuses.filter(s => s.id !== status.id);
                    this.statuses = this.normalizeStatuses(this.statuses);
                    await this.saveStatusesToSettings();
                    this.renderStatuses();
                    showMessage(i18n("statusDeleted") || "状态已删除");
                } catch (error) {
                    console.error("删除全局项目状态失败:", error);
                    showMessage(i18n("deleteStatusFailed") || "删除失败");
                }
            }
        );
    }

    private resetStatuses() {
        confirm(
            i18n("resetStatuses") || "重置状态",
            i18n("confirmResetStatuses") || "确定恢复内置默认状态吗？",
            async () => {
                try {
                    this.statuses = this.getBuiltInStatuses();
                    // 用空数组表示“回退内置默认”，保持与现有设置语义一致
                    await this.saveStatusesToSettings([]);
                    this.renderStatuses();
                    showMessage(i18n("statusesReset") || "状态已重置");
                } catch (error) {
                    console.error("重置全局项目状态失败:", error);
                    showMessage(i18n("resetStatusesFailed") || "重置失败");
                }
            }
        );
    }

    private openBuiltInEmojiPicker(target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        openEmoji({
            hideDynamicIcon: true,
            hideCustomIcon: true,
            position: {
                x: rect.left,
                y: rect.bottom,
            },
            selectedCB: (emojiCode: string) => {
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                target.textContent = String.fromCodePoint(...codePoints);
            },
        });
    }
}
