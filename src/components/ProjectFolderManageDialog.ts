import { Dialog, showMessage, confirm, openEmoji } from "siyuan";
import { ProjectFolderManager, ProjectFolder } from "../utils/projectFolderManager";
import { i18n } from "../pluginInstance";

export class ProjectFolderManageDialog {
    private dialog: Dialog;
    private folderManager: ProjectFolderManager;
    private onUpdated?: () => void;
    private draggedElement: HTMLElement | null = null;
    private draggedFolder: ProjectFolder | null = null;
    private plugin?: any;

    constructor(plugin?: any, onUpdated?: () => void) {
        this.plugin = plugin;
        this.folderManager = ProjectFolderManager.getInstance(this.plugin);
        this.onUpdated = onUpdated;
    }

    public show() {
        this.dialog = new Dialog({
            title: i18n("manageFolders") || "管理项目文件夹",
            content: this.createDialogContent(),
            width: "500px",
            height: "600px"
        });

        this.bindEvents();
        this.renderFolders();
    }

    private createDialogContent(): string {
        return `
            <div class="folder-manage-dialog">
                <div class="b3-dialog__content">
                    <div class="folder-toolbar" style="margin-bottom: 12px; display: flex; gap: 8px;">
                        <button class="b3-button b3-button--primary" id="addFolderBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("addFolder") || "新建文件夹"}
                        </button>
                    </div>
                    <div class="folder-drag-hint" style="padding: 8px 16px; background: rgba(52, 152, 219, 0.1); border-radius: 4px; margin-bottom: 12px; font-size: 12px; color: var(--b3-theme-on-surface); text-align: center; opacity: 0.8;">
                        <span>💡 ${i18n("dragHint") || "拖拽项目可重新排序"}</span>
                    </div>
                    <div class="folders-list" id="foldersList" style="max-height: 400px; overflow-y: auto;">
                        <!-- 文件夹列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--primary" id="closeBtn">${i18n("save") || "保存"}</button>
                </div>
            </div>
            <style>
                .folder-manage-dialog {
                    max-height: 580px;
                }
                
                .folder-item {
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
                
                .folder-item:hover {
                    background: var(--b3-theme-surface-lighter);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                
                .folder-item.dragging {
                    opacity: 0.6;
                    cursor: grabbing;
                    transform: rotate(2deg);
                    z-index: 1000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                
                .folder-item.drag-over-top {
                    border-top: 3px solid #3498db;
                    box-shadow: 0 -2px 0 rgba(52, 152, 219, 0.3);
                }
                
                .folder-item.drag-over-bottom {
                    border-bottom: 3px solid #3498db;
                    box-shadow: 0 2px 0 rgba(52, 152, 219, 0.3);
                }
                
                .folder-drag-handle {
                    cursor: grab;
                    padding: 4px;
                    color: #999;
                    display: flex;
                    align-items: center;
                    margin-right: 12px;
                    transition: color 0.2s ease;
                }
                
                .folder-drag-handle:hover {
                    color: #3498db;
                }
                
                .folder-drag-handle::before {
                    content: "⋮⋮";
                    font-size: 16px;
                    line-height: 1;
                }
                
                .folder-info {
                    display: flex;
                    align-items: center;
                    flex: 1;
                }
                
                .folder-icon {
                    font-size: 16px;
                    margin-right: 8px;
                }
                
                .folder-actions {
                    display: flex;
                    gap: 4px;
                }
                
                .folder-move-actions {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    margin-left: 8px;
                }
                
                .folder-move-actions .b3-button {
                    padding: 2px 6px;
                    min-height: 24px;
                    line-height: 1;
                }
                
                .folder-move-actions .b3-button__icon {
                    width: 14px;
                    height: 14px;
                }
            </style>
        `;
    }

    private bindEvents() {
        const addFolderBtn = this.dialog.element.querySelector('#addFolderBtn') as HTMLButtonElement;
        const closeBtn = this.dialog.element.querySelector('#closeBtn') as HTMLButtonElement;

        addFolderBtn?.addEventListener('click', () => {
            this.showEditFolderDialog();
        });

        closeBtn?.addEventListener('click', () => {
            if (this.onUpdated) {
                this.onUpdated();
            }
            this.dialog.destroy();
        });
    }

    private async renderFolders() {
        const foldersList = this.dialog.element.querySelector('#foldersList') as HTMLElement;
        if (!foldersList) return;

        try {
            const folders = await this.folderManager.loadFolders();
            foldersList.innerHTML = '';

            if (folders.length === 0) {
                foldersList.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${i18n("noFolders") || "暂无文件夹"}</div>`;
                return;
            }

            folders.forEach(folder => {
                const folderEl = this.createFolderElement(folder);
                foldersList.appendChild(folderEl);
            });
        } catch (error) {
            console.error('加载文件夹失败', error);
            foldersList.innerHTML = `<div class="folder-error">加载文件夹失败</div>`;
        }
    }

    private createFolderElement(folder: ProjectFolder): HTMLElement {
        const folderEl = document.createElement('div');
        folderEl.className = 'folder-item';
        folderEl.draggable = true;
        folderEl.dataset.folderId = folder.id;
        folderEl.innerHTML = `
            <div class="folder-drag-handle ariaLabel" aria-label="拖拽排序"></div>
            <div class="folder-info">
                <span class="folder-icon">${folder.icon || '📂'}</span>
                <div class="folder-name">${folder.name}</div>
            </div>
            <div class="folder-actions">
                <button class="b3-button b3-button--outline folder-edit-btn ariaLabel" data-action="edit" data-id="${folder.id}" aria-label="${i18n("editFolder") || "修改文件夹"}">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                </button>
                <button class="b3-button b3-button--outline folder-delete-btn ariaLabel" data-action="delete" data-id="${folder.id}" aria-label="删除">
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>
            </div>
            <div class="folder-move-actions">
                <button class="b3-button b3-button--text folder-move-up-btn ariaLabel" data-action="moveUp" data-id="${folder.id}" aria-label="上移">
                    <svg class="b3-button__icon"><use xlink:href="#iconUp"></use></svg>
                </button>
                <button class="b3-button b3-button--text folder-move-down-btn ariaLabel" data-action="moveDown" data-id="${folder.id}" aria-label="下移">
                    <svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>
                </button>
            </div>
        `;

        // 绑定拖拽事件
        this.bindDragEvents(folderEl, folder);

        // 绑定操作事件
        const editBtn = folderEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = folderEl.querySelector('[data-action="delete"]') as HTMLButtonElement;
        const moveUpBtn = folderEl.querySelector('[data-action="moveUp"]') as HTMLButtonElement;
        const moveDownBtn = folderEl.querySelector('[data-action="moveDown"]') as HTMLButtonElement;

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditFolderDialog(folder);
        });

        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteFolder(folder);
        });

        moveUpBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.moveFolderUp(folder);
        });

        moveDownBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.moveFolderDown(folder);
        });

        return folderEl;
    }

    private bindDragEvents(element: HTMLElement, folder: ProjectFolder) {
        element.addEventListener('dragstart', (e) => {
            this.draggedElement = element;
            this.draggedFolder = folder;
            element.classList.add('dragging');

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedElement = null;
            this.draggedFolder = null;

            // 清除所有拖拽状态
            const allItems = this.dialog.element.querySelectorAll('.folder-item');
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

            if (this.draggedElement && this.draggedFolder && this.draggedElement !== element) {
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;
                const insertBefore = mouseY < midPoint;

                await this.handleFolderReorder(this.draggedFolder, folder, insertBefore);
            }
        });
    }

    private async moveFolderUp(folder: ProjectFolder) {
        try {
            const folders = await this.folderManager.loadFolders();
            const index = folders.findIndex(f => f.id === folder.id);
            if (index <= 0) return;
            
            const reordered = [...folders];
            [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
            
            await this.folderManager.reorderFolders(reordered);
            this.renderFolders();
        } catch (error) {
            console.error('上移文件夹失败:', error);
        }
    }

    private async moveFolderDown(folder: ProjectFolder) {
        try {
            const folders = await this.folderManager.loadFolders();
            const index = folders.findIndex(f => f.id === folder.id);
            if (index === -1 || index >= folders.length - 1) return;
            
            const reordered = [...folders];
            [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
            
            await this.folderManager.reorderFolders(reordered);
            this.renderFolders();
        } catch (error) {
            console.error('下移文件夹失败:', error);
        }
    }

    private async handleFolderReorder(dragged: ProjectFolder, target: ProjectFolder, insertBefore: boolean = false) {
        try {
            const folders = await this.folderManager.loadFolders();
            const draggedIndex = folders.findIndex(f => f.id === dragged.id);
            const targetIndex = folders.findIndex(f => f.id === target.id);

            if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
                return;
            }

            const reordered = [...folders];
            const [removed] = reordered.splice(draggedIndex, 1);

            let insertIndex = targetIndex;
            if (draggedIndex < targetIndex) {
                insertIndex = targetIndex;
            }

            if (insertBefore) {
                reordered.splice(insertIndex, 0, removed);
            } else {
                reordered.splice(insertIndex + 1, 0, removed);
            }

            await this.folderManager.reorderFolders(reordered);
            this.renderFolders();
        } catch (error) {
            console.error('排序文件夹失败:', error);
        }
    }

    private showEditFolderDialog(folder?: ProjectFolder) {
        const isEdit = !!folder;
        const editDialog = new Dialog({
            title: isEdit ? (i18n("editFolder") || "修改文件夹") : (i18n("addFolder") || "新建文件夹"),
            content: `
                <div class="folder-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderName") || "文件夹名称"}</label>
                            <input type="text" id="folderNameInput" class="b3-text-field" value="${folder?.name || ''}" placeholder="${i18n("pleaseEnterFolderName") || "请输入文件夹名称"}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderIcon") || "文件夹图标"}</label>
                            <div id="folderIconDisplay" class="folder-icon-display">${folder?.icon || '📂'}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n("cancel") || "取消"}</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">${i18n("save") || "保存"}</button>
                    </div>
                    <style>
                        .folder-edit-dialog {
                            display: flex;
                            flex-direction: column;
                        }
                        .folder-icon-display {
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
                        .folder-icon-display:hover {
                            transform: scale(1.1);
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                        }
                    </style>
                </div>
            `,
            width: "400px"
        });

        const nameInput = editDialog.element.querySelector('#folderNameInput') as HTMLInputElement;
        nameInput.focus();

        const iconDisplay = editDialog.element.querySelector('#folderIconDisplay') as HTMLElement;
        const cancelBtn = editDialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = editDialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;

        iconDisplay?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openBuiltInEmojiPicker(iconDisplay);
        });

        cancelBtn?.addEventListener('click', () => editDialog.destroy());

        confirmBtn?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const icon = iconDisplay.textContent || '📂';
            if (!name) {
                showMessage(i18n("folderNameEmpty") || "文件夹名称不能为空");
                return;
            }

            try {
                if (isEdit && folder) {
                    await this.folderManager.updateFolder(folder.id, { name, icon });
                    showMessage(i18n("folderUpdated") || "文件夹已更新");
                } else {
                    await this.folderManager.addFolder(name, icon);
                    showMessage(i18n("folderAdded") || "文件夹已创建");
                }
                editDialog.destroy();
                this.renderFolders();
            } catch (error) {
                console.error('保存文件夹失败:', error);
                showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
            }
        });
    }

    private async deleteFolder(folder: ProjectFolder) {
        await confirm(
            i18n("deleteFolder") || "删除文件夹",
            (i18n("confirmDeleteFolder") || `确认删除文件夹 "${folder.name}" 吗？注意：此操作不会删除项目，项目将被移出文件夹。`).replace('${name}', folder.name),
            async () => {
                try {
                    await this.folderManager.deleteFolder(folder.id);
                    showMessage(i18n("folderDeleted") || "文件夹已删除");
                    this.renderFolders();
                } catch (error) {
                    console.error('删除文件夹失败', error);
                    showMessage(i18n("deleteFolderFailed") || "删除文件夹失败");
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
                if (!emojiCode) {
                    target.textContent = "";
                    return;
                }
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                target.textContent = String.fromCodePoint(...codePoints);
            }
        });
    }
}
