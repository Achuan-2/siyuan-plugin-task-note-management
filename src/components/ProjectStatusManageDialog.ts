import { Dialog, showMessage, confirm, openEmoji } from "siyuan";
import { StatusManager, Status } from "../utils/statusManager";
import { i18n } from "../pluginInstance";

type StatusWithBadge = Status & {
    includeInBadge?: boolean;
};

export class StatusManageDialog {
    private dialog: Dialog;
    private statusManager: StatusManager;
    private onUpdated?: () => void;
    private draggedElement: HTMLElement | null = null;
    private draggedStatus: StatusWithBadge | null = null;
    private plugin?: any;

    constructor(plugin?: any, onUpdated?: () => void) {
        this.plugin = plugin;
        this.statusManager = StatusManager.getInstance(this.plugin);
        this.onUpdated = onUpdated;
    }

    public show() {
        this.dialog = new Dialog({
            title: i18n("statusManagement") || "状态管理",
            content: this.createDialogContent(),
            width: "500px",
            height: "500px"
        });

        this.bindEvents();
        this.renderStatuses();
    }

    private createDialogContent(): string {
        return `
            <div class="status-manage-dialog">
                <div class="b3-dialog__content">
                    <div class="status-toolbar">
                        <button class="b3-button b3-button--primary" id="addStatusBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("addStatus") || "添加状态"}
                        </button>
                        <button class="b3-button b3-button--outline" id="resetStatusesBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            ${i18n("resetToDefault") || "重置为默认"}
                        </button>
                    </div>
                    <div class="status-drag-hint">
                        <span>💡 ${i18n("dragHint")}</span>
                    </div>
                    <div class="statuses-list" id="statusesList">
                        <!-- 状态列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--primary" id="closeBtn">${i18n("close") || "关闭"}</button>
                </div>
            </div>
            <style>
                .status-manage-dialog {
                    max-height: 580px;
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
                    padding: 12px 16px;
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
                    margin-right: 12px;
                    transition: color 0.2s ease;
                }
                .status-drag-handle:hover {
                    color: #3498db;
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
                }
                .status-icon {
                    font-size: 16px;
                    margin-right: 8px;
                }
                .status-actions {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .status-count-switch {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    margin-right: 6px;
                    font-size: 12px;
                    color: var(--b3-theme-on-surface);
                    cursor: pointer;
                    user-select: none;
                }
                .status-count-switch input {
                    margin: 0;
                }
            </style>
        `;
    }

    private bindEvents() {
        const addStatusBtn = this.dialog.element.querySelector('#addStatusBtn') as HTMLButtonElement;
        const resetStatusesBtn = this.dialog.element.querySelector('#resetStatusesBtn') as HTMLButtonElement;
        const closeBtn = this.dialog.element.querySelector('#closeBtn') as HTMLButtonElement;

        addStatusBtn?.addEventListener('click', () => {
            this.showEditStatusDialog();
        });

        resetStatusesBtn?.addEventListener('click', () => {
            this.resetStatuses();
        });

        closeBtn?.addEventListener('click', () => {
            if (this.onUpdated) {
                this.onUpdated();
            }
            this.dialog.destroy();
        });
    }

    private shouldIncludeInBadge(status?: Partial<StatusWithBadge>): boolean {
        if (!status || typeof status !== "object") return false;
        if (typeof status.includeInBadge === "boolean") {
            return status.includeInBadge;
        }
        // 兼容历史数据：旧版本仅统计 active
        return status.id === "active";
    }

    private async updateStatusBadgeSetting(status: StatusWithBadge, includeInBadge: boolean) {
        try {
            await this.statusManager.updateStatus(status.id, { includeInBadge } as any);
            status.includeInBadge = includeInBadge;
            showMessage(includeInBadge ? "已计入项目徽章" : "已从项目徽章排除");
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        } catch (error) {
            console.error("更新状态徽章计数配置失败", error);
            showMessage("更新徽章计数配置失败，请重试");
            this.renderStatuses();
        }
    }

    private async renderStatuses() {
        const statusesList = this.dialog.element.querySelector('#statusesList') as HTMLElement;
        if (!statusesList) return;

        try {
            const statuses = await this.statusManager.loadStatuses();
            statusesList.innerHTML = '';

            statuses.forEach(status => {
                const statusEl = this.createStatusElement(status);
                statusesList.appendChild(statusEl);
            });
        } catch (error) {
            console.error(i18n("loadStatusesFailed") || "加载状态失败", error);
            statusesList.innerHTML = `<div class="status-error">${i18n("loadStatusesFailed") || "加载状态失败"}</div>`;
        }
    }

    private createStatusElement(status: Status): HTMLElement {
        const statusWithBadge = status as StatusWithBadge;
        const includeInBadge = this.shouldIncludeInBadge(statusWithBadge);
        const statusEl = document.createElement('div');
        statusEl.className = 'status-item';
        statusEl.draggable = true;
        statusEl.dataset.statusId = status.id;
        statusEl.innerHTML = `
            <div class="status-drag-handle ariaLabel" aria-label="拖拽排序"></div>
            <div class="status-info">
                <div class="status-icon">${status.icon || '📝'}</div>
                <div class="status-name">${status.name}</div>
            </div>
            <div class="status-actions">
                <label class="status-count-switch ariaLabel" aria-label="是否计入项目徽章">
                    <input type="checkbox" class="b3-switch" data-action="toggle-badge" ${includeInBadge ? 'checked' : ''}>
                    <span>计数</span>
                </label>
                <button class="b3-button b3-button--outline status-edit-btn ariaLabel" data-action="edit" data-id="${status.id}" aria-label="${i18n("editStatus") || "编辑状态"}">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                </button>
                ${!status.isArchived ? `
                <button class="b3-button b3-button--outline status-delete-btn ariaLabel" data-action="delete" data-id="${status.id}" aria-label="${i18n("deleteStatus") || "删除状态"}">
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>
                ` : ''}
            </div>
        `;

        this.bindDragEvents(statusEl, status);

        const editBtn = statusEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = statusEl.querySelector('[data-action="delete"]') as HTMLButtonElement;
        const badgeToggle = statusEl.querySelector('[data-action="toggle-badge"]') as HTMLInputElement;

        badgeToggle?.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        badgeToggle?.addEventListener('change', (e) => {
            e.stopPropagation();
            this.updateStatusBadgeSetting(statusWithBadge, badgeToggle.checked);
        });

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditStatusDialog(status);
        });

        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteStatus(status);
            });
        }

        return statusEl;
    }

    private bindDragEvents(element: HTMLElement, status: Status) {
        element.addEventListener('dragstart', (e) => {
            this.draggedElement = element;
            this.draggedStatus = status;
            element.classList.add('dragging');

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedElement = null;
            this.draggedStatus = null;

            const allItems = this.dialog.element.querySelectorAll('.status-item');
            allItems.forEach(item => {
                item.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        });

        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }

            if (this.draggedElement && this.draggedElement !== element) {
                element.classList.remove('drag-over-top', 'drag-over-bottom');
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;
                if (mouseY < midPoint) {
                    element.classList.add('drag-over-top');
                } else {
                    element.classList.add('drag-over-bottom');
                }
            }
        });

        element.addEventListener('dragleave', (e) => {
            const rect = element.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;

            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                element.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        element.addEventListener('drop', async (e) => {
            e.preventDefault();
            element.classList.remove('drag-over-top', 'drag-over-bottom');

            if (this.draggedElement && this.draggedStatus && this.draggedElement !== element) {
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;
                const insertBefore = mouseY < midPoint;

                const targetStatusId = element.dataset.statusId;
                const targetStatus = this.statusManager.getStatusById(targetStatusId);
                if (targetStatus) {
                    await this.handleStatusReorder(this.draggedStatus, targetStatus, insertBefore);
                }
            }
        });
    }

    private async handleStatusReorder(draggedStatus: Status, targetStatus: Status, insertBefore: boolean = false) {
        try {
            const statuses = await this.statusManager.loadStatuses();
            const draggedIndex = statuses.findIndex(s => s.id === draggedStatus.id);
            let targetIndex = statuses.findIndex(s => s.id === targetStatus.id);

            if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
                return;
            }

            const reorderedStatuses = [...statuses];
            const [removed] = reorderedStatuses.splice(draggedIndex, 1);

            targetIndex = reorderedStatuses.findIndex(s => s.id === targetStatus.id);

            if (insertBefore) {
                reorderedStatuses.splice(targetIndex, 0, removed);
            } else {
                reorderedStatuses.splice(targetIndex + 1, 0, removed);
            }

            await this.statusManager.reorderStatuses(reorderedStatuses);
            this.renderStatuses();
            showMessage("状态排序已更新");
        } catch (error) {
            console.error("重新排序状态失败", error);
            showMessage("排序更新失败，请重试");
        }
    }

    private showEditStatusDialog(status?: Status) {
        const isEdit = !!status;
        const initialIncludeInBadge = isEdit ? this.shouldIncludeInBadge(status as StatusWithBadge) : false;
        const editDialog = new Dialog({
            title: isEdit ? (i18n("editStatus") || "编辑状态") : (i18n("addStatus") || "添加状态"),
            content: `
                <div class="status-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("statusName") || "状态名称"}</label>
                            <input type="text" id="statusName" class="b3-text-field" value="${status?.name || ''}" placeholder="${i18n("pleaseEnterStatusName") || "请输入状态名称"}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("statusIcon") || "状态图标"}</label>
                            <div id="statusIcon" class="status-icon-display">${status?.icon || '📝'}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">项目徽章计数</label>
                            <label class="status-badge-checkbox">
                                <input type="checkbox" class="b3-switch" id="statusIncludeInBadge" ${initialIncludeInBadge ? 'checked' : ''}>
                                <span>该状态项目计入侧栏项目徽章</span>
                            </label>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n("cancel") || "取消"}</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">${i18n("save") || "保存"}</button>
                    </div>
                    <style>
                        .status-icon-display {
                            width: 40px;
                            height: 40px;
                            border-radius: 50%;
                            background: var(--b3-theme-surface-lighter);
                            border: 2px solid var(--b3-theme-primary-lighter);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 20px;
                            cursor: pointer;
                            transition: all 0.2s;
                            user-select: none;
                        }
                        .status-icon-display:hover {
                            transform: scale(1.1);
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                        }
                        .status-badge-checkbox {
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            font-size: 13px;
                            cursor: pointer;
                            user-select: none;
                        }
                        .status-badge-checkbox input {
                            margin: 0;
                        }
                    </style>
                </div>
            `,
            width: "400px"
        });

        const nameInput = editDialog.element.querySelector('#statusName') as HTMLInputElement;
        const iconDisplay = editDialog.element.querySelector('#statusIcon') as HTMLElement;
        const cancelBtn = editDialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = editDialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const includeInBadgeInput = editDialog.element.querySelector('#statusIncludeInBadge') as HTMLInputElement;

        // 设置初始图标
        if (status?.icon) {
            iconDisplay.textContent = status.icon;
        } else {
            iconDisplay.textContent = '📝';
        }

        // 绑定图标点击事件
        iconDisplay?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openBuiltInEmojiPicker(iconDisplay);
        });

        cancelBtn?.addEventListener('click', () => {
            editDialog.destroy();
        });

        confirmBtn?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const icon = iconDisplay.textContent || '';
            const includeInBadge = includeInBadgeInput?.checked ?? false;

            if (!name) {
                showMessage(i18n("pleaseEnterStatusName") || "请输入状态名称");
                return;
            }

            try {
                if (isEdit && status) {
                    await this.statusManager.updateStatus(status.id, { name, icon, includeInBadge } as any);
                    showMessage(i18n("statusUpdated") || "状态已更新");
                } else {
                    await this.statusManager.addStatus({ name, icon, includeInBadge } as any);
                    showMessage(i18n("statusAdded") || "状态已添加");
                }

                editDialog.destroy();
                this.renderStatuses();
                window.dispatchEvent(new CustomEvent('projectUpdated'));
            } catch (error) {
                console.error("保存状态失败", error);
                showMessage(i18n("saveStatusFailed") || "保存状态失败，请重试");
            }
        });
    }

    private async deleteStatus(status: Status) {
        if (status.isArchived) {
            showMessage(i18n("cannotDeleteArchivedStatus") || "归档状态不可删除");
            return;
        }

        await confirm(
            i18n("deleteStatus") || "删除状态",
            i18n("confirmDeleteStatus", { name: status.name }) || `确定要删除状态 "${status.name}" 吗？`,
            async () => {
                try {
                    await this.statusManager.deleteStatus(status.id);
                    showMessage(i18n("statusDeleted") || "状态已删除");
                    this.renderStatuses();
                } catch (error) {
                    console.error(i18n("deleteStatusFailed") || "删除状态失败", error);
                    showMessage(i18n("deleteStatusFailed") || "删除状态失败");
                }
            }
        );
    }

    private async resetStatuses() {
        await confirm(
            i18n("resetStatuses") || "重置状态",
            i18n("confirmResetStatuses") || "确定要将状态列表重置为默认设置吗？此操作不可撤销。",
            async () => {
                try {
                    await this.statusManager.resetToDefault();
                    showMessage(i18n("statusesReset") || "状态已重置");
                    this.renderStatuses();
                } catch (error) {
                    console.error(i18n("resetStatusesFailed") || "重置状态失败", error);
                    showMessage(i18n("resetStatusesFailed") || "重置状态失败");
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
                y: rect.bottom
            },
            selectedCB: (emojiCode: string) => {
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                target.textContent = String.fromCodePoint(...codePoints);
            }
        });
    }
}


