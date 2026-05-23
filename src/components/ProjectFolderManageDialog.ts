import { Dialog, showMessage, confirm, openEmoji } from "siyuan";
import { ProjectFolderManager, ProjectFolder } from "../utils/projectFolderManager";
import { i18n } from "../pluginInstance";

interface FolderTreeNode {
    folder: ProjectFolder;
    children: FolderTreeNode[];
}

type FolderDropMode = 'before' | 'inside' | 'after';

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
            width: "560px",
            height: "640px"
        });

        this.bindEvents();
        this.renderFolders();
    }

    private createDialogContent(): string {
        return `
            <div class="b3-dialog__content">
                <div class="folder-toolbar">
                    <button class="b3-button b3-button--primary" id="addFolderBtn">
                        <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                        ${i18n("addFolder") || "新建文件夹"}
                    </button>
                </div>
                <div class="folder-drag-hint">
                    <span>💡 拖拽文件夹可排序，拖到行中间可设为子文件夹</span>
                </div>
                <div class="folders-list" id="foldersList">
                    <!-- 文件夹树将在这里渲染 -->
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--primary" id="closeBtn">${i18n("close") || "关闭"}</button>
            </div>
            <style>
                .folder-manage-dialog {
                    max-height: 620px;
                }

                .folder-toolbar {
                    margin-bottom: 12px;
                    display: flex;
                    gap: 8px;
                }

                .folder-drag-hint {
                    padding: 8px 12px;
                    background: color-mix(in srgb, var(--b3-theme-primary), transparent 90%);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    font-size: 12px;
                    color: var(--b3-theme-on-surface);
                    text-align: center;
                    opacity: 0.8;
                }

                .folders-list {
                    max-height: 460px;
                    overflow-y: auto;
                    padding-right: 4px;
                }

                .folder-tree-node {
                    position: relative;
                }

                .folder-tree-children {
                    margin-left: 18px;
                    border-left: 1px solid var(--b3-theme-surface-lighter);
                }

                .folder-item {
                    display: flex;
                    align-items: center;
                    min-height: 36px;
                    padding: 4px 8px;
                    margin-bottom: 2px;
                    background: var(--b3-theme-background);
                    border: 1px solid transparent;
                    border-radius: 4px;
                    cursor: grab;
                    transition: background-color 0.2s ease, border-color 0.2s ease;
                    position: relative;
                }

                .folder-item:hover {
                    background: var(--b3-theme-surface-lighter);
                }

                .folder-item.dragging {
                    opacity: 0.55;
                    cursor: grabbing;
                }

                .folder-item.drag-over-top {
                    border-top: 2px solid var(--b3-theme-primary);
                }

                .folder-item.drag-over-bottom {
                    border-bottom: 2px solid var(--b3-theme-primary);
                }

                .folder-item.drag-over-inside {
                    background: color-mix(in srgb, var(--b3-theme-primary), transparent 88%);
                    border-color: var(--b3-theme-primary);
                }

                .folder-drag-handle {
                    cursor: grab;
                    padding: 4px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.45;
                    display: flex;
                    align-items: center;
                    margin-right: 4px;
                }

                .folder-drag-handle::before {
                    content: "⋮⋮";
                    font-size: 14px;
                    line-height: 1;
                }

                .folder-chevron {
                    width: 20px;
                    height: 24px;
                    padding: 0 !important;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 2px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.7;
                }

                .folder-chevron svg {
                    width: 12px;
                    height: 12px;
                    fill: currentColor;
                    transition: transform 0.2s ease;
                }

                .folder-chevron.is-collapsed svg {
                    transform: rotate(-90deg);
                }

                .folder-chevron--empty {
                    visibility: hidden;
                }

                .folder-info {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                    flex: 1;
                    gap: 6px;
                }

                .folder-icon {
                    font-size: 15px;
                    flex-shrink: 0;
                }

                .folder-name {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .folder-actions {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    opacity: 0.45;
                    transition: opacity 0.2s ease;
                }

                .folder-item:hover .folder-actions,
                .folder-actions:focus-within {
                    opacity: 1;
                }

                .folder-actions .b3-button {
                    padding: 2px 4px;
                    min-height: 24px;
                }

                .folder-actions .b3-button__icon {
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
            this.notifyUpdated();
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

            this.buildFolderTree(folders).forEach(node => {
                foldersList.appendChild(this.createFolderTreeNode(node, 0));
            });
        } catch (error) {
            console.error('加载文件夹失败', error);
            foldersList.innerHTML = `<div class="folder-error">加载文件夹失败</div>`;
        }
    }

    private buildFolderTree(folders: ProjectFolder[], parentId: string = ''): FolderTreeNode[] {
        return folders
            .filter(folder => (folder.parentId || '') === parentId)
            .sort((a, b) => {
                const sortDiff = (a.sort || 0) - (b.sort || 0);
                if (sortDiff !== 0) return sortDiff;
                return (a.name || '').localeCompare(b.name || '', 'zh-CN');
            })
            .map(folder => ({
                folder,
                children: this.buildFolderTree(folders, folder.id)
            }));
    }

    private createFolderTreeNode(node: FolderTreeNode, depth: number): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'folder-tree-node';
        wrapper.dataset.folderId = node.folder.id;

        const folderEl = this.createFolderElement(node.folder, depth, node.children.length > 0);
        wrapper.appendChild(folderEl);

        if (node.children.length > 0) {
            const childrenEl = document.createElement('div');
            childrenEl.className = 'folder-tree-children';
            childrenEl.style.display = node.folder.collapsed ? 'none' : 'block';
            node.children.forEach(child => {
                childrenEl.appendChild(this.createFolderTreeNode(child, depth + 1));
            });
            wrapper.appendChild(childrenEl);
        }

        return wrapper;
    }

    private createFolderElement(folder: ProjectFolder, depth: number, hasChildren: boolean): HTMLElement {
        const folderEl = document.createElement('div');
        folderEl.className = 'folder-item';
        folderEl.draggable = true;
        folderEl.dataset.folderId = folder.id;
        folderEl.style.paddingLeft = `${8 + depth * 6}px`;
        folderEl.innerHTML = `
            <div class="folder-drag-handle ariaLabel" aria-label="拖拽排序"></div>
            <button class="b3-button b3-button--text folder-chevron ${folder.collapsed ? 'is-collapsed' : ''} ${hasChildren ? '' : 'folder-chevron--empty'} ariaLabel" data-action="toggle" aria-label="${folder.collapsed ? '展开' : '折叠'}">
                <svg><use xlink:href="#iconDown"></use></svg>
            </button>
            <div class="folder-info">
                <span class="folder-icon">${folder.icon || '📂'}</span>
                <div class="folder-name">${this.escapeHTML(folder.name)}</div>
            </div>
            <div class="folder-actions">
                <button class="b3-button b3-button--text folder-add-child-btn ariaLabel" data-action="addChild" aria-label="新建子文件夹">
                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                </button>
                <button class="b3-button b3-button--text folder-edit-btn ariaLabel" data-action="edit" aria-label="${i18n("editFolder") || "修改文件夹"}">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                </button>
                <button class="b3-button b3-button--text folder-move-up-btn ariaLabel" data-action="moveUp" aria-label="上移">
                    <svg class="b3-button__icon"><use xlink:href="#iconUp"></use></svg>
                </button>
                <button class="b3-button b3-button--text folder-move-down-btn ariaLabel" data-action="moveDown" aria-label="下移">
                    <svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>
                </button>
                <button class="b3-button b3-button--text folder-delete-btn ariaLabel" data-action="delete" aria-label="删除">
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>
            </div>
        `;

        this.bindDragEvents(folderEl, folder);

        const toggleBtn = folderEl.querySelector('[data-action="toggle"]') as HTMLButtonElement;
        const addChildBtn = folderEl.querySelector('[data-action="addChild"]') as HTMLButtonElement;
        const editBtn = folderEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = folderEl.querySelector('[data-action="delete"]') as HTMLButtonElement;
        const moveUpBtn = folderEl.querySelector('[data-action="moveUp"]') as HTMLButtonElement;
        const moveDownBtn = folderEl.querySelector('[data-action="moveDown"]') as HTMLButtonElement;

        toggleBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!hasChildren) return;
            await this.folderManager.updateFolder(folder.id, { collapsed: !folder.collapsed });
            this.notifyUpdated();
            this.renderFolders();
        });

        addChildBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditFolderDialog(undefined, folder.id);
        });

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
                e.dataTransfer.setData('text/plain', folder.id);
            }
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedElement = null;
            this.draggedFolder = null;
            this.clearDragClasses();
        });

        element.addEventListener('dragover', (e) => {
            if (!this.draggedElement || !this.draggedFolder || this.draggedElement === element) {
                return;
            }

            const mode = this.getFolderDropMode(element, e);
            const targetParentId = mode === 'inside' ? folder.id : (folder.parentId || '');
            if (targetParentId === this.draggedFolder.id || (targetParentId && this.folderManager.isFolderDescendant(targetParentId, this.draggedFolder.id))) {
                return;
            }

            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            this.clearDragClasses();
            element.classList.add(mode === 'before' ? 'drag-over-top' : mode === 'after' ? 'drag-over-bottom' : 'drag-over-inside');
        });

        element.addEventListener('dragleave', (e) => {
            const rect = element.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;

            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                element.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
            }
        });

        element.addEventListener('drop', async (e) => {
            if (!this.draggedElement || !this.draggedFolder || this.draggedElement === element) {
                return;
            }

            e.preventDefault();
            const mode = this.getFolderDropMode(element, e);
            this.clearDragClasses();
            await this.handleFolderDrop(this.draggedFolder, folder, mode);
        });
    }

    private getFolderDropMode(element: HTMLElement, event: DragEvent): FolderDropMode {
        const rect = element.getBoundingClientRect();
        const y = event.clientY - rect.top;
        if (y < rect.height * 0.25) return 'before';
        if (y > rect.height * 0.75) return 'after';
        return 'inside';
    }

    private clearDragClasses() {
        const allItems = this.dialog.element.querySelectorAll('.folder-item');
        allItems.forEach(item => {
            item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
        });
    }

    private async moveFolderUp(folder: ProjectFolder) {
        try {
            const siblings = this.folderManager.getSiblingFolders(folder.parentId || '');
            const index = siblings.findIndex(item => item.id === folder.id);
            if (index <= 0) return;

            await this.folderManager.moveFolder(folder.id, folder.parentId || '', siblings[index - 1].id, true);
            this.notifyUpdated();
            this.renderFolders();
        } catch (error) {
            console.error('上移文件夹失败:', error);
            showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
        }
    }

    private async moveFolderDown(folder: ProjectFolder) {
        try {
            const siblings = this.folderManager.getSiblingFolders(folder.parentId || '');
            const index = siblings.findIndex(item => item.id === folder.id);
            if (index === -1 || index >= siblings.length - 1) return;

            await this.folderManager.moveFolder(folder.id, folder.parentId || '', siblings[index + 1].id, false);
            this.notifyUpdated();
            this.renderFolders();
        } catch (error) {
            console.error('下移文件夹失败:', error);
            showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
        }
    }

    private async handleFolderDrop(dragged: ProjectFolder, target: ProjectFolder, mode: FolderDropMode) {
        try {
            if (dragged.id === target.id) {
                return;
            }

            if (mode === 'inside') {
                await this.folderManager.moveFolder(dragged.id, target.id);
            } else {
                await this.folderManager.moveFolder(dragged.id, target.parentId || '', target.id, mode === 'before');
            }

            this.notifyUpdated();
            this.renderFolders();
        } catch (error) {
            console.error('排序文件夹失败:', error);
            showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
        }
    }

    private showEditFolderDialog(folder?: ProjectFolder, defaultParentId: string = '') {
        const isEdit = !!folder;
        const selectedParentId = isEdit ? (folder.parentId || '') : defaultParentId;
        const editDialog = new Dialog({
            title: isEdit ? (i18n("editFolder") || "修改文件夹") : (defaultParentId ? "新建子文件夹" : (i18n("addFolder") || "新建文件夹")),
            content: `
                <div class="folder-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderName") || "文件夹名称"}</label>
                            <input type="text" id="folderNameInput" class="b3-text-field" value="${this.escapeHTML(folder?.name || '')}" placeholder="${i18n("pleaseEnterFolderName") || "请输入文件夹名称"}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">上级文件夹</label>
                            <select id="folderParentSelect" class="b3-select" style="width: 100%;">
                                ${this.createParentFolderOptions(folder, selectedParentId)}
                            </select>
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
            width: "420px"
        });

        const nameInput = editDialog.element.querySelector('#folderNameInput') as HTMLInputElement;
        nameInput.focus();

        const parentSelect = editDialog.element.querySelector('#folderParentSelect') as HTMLSelectElement;
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
            const parentId = parentSelect?.value || '';
            if (!name) {
                showMessage(i18n("folderNameEmpty") || "文件夹名称不能为空");
                return;
            }

            try {
                if (isEdit && folder) {
                    await this.folderManager.updateFolder(folder.id, { name, icon, parentId });
                    showMessage(i18n("folderUpdated") || "文件夹已更新");
                } else {
                    await this.folderManager.addFolder(name, icon, parentId);
                    showMessage(i18n("folderAdded") || "文件夹已创建");
                }
                editDialog.destroy();
                this.notifyUpdated();
                this.renderFolders();
            } catch (error) {
                console.error('保存文件夹失败:', error);
                showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
            }
        });
    }

    private createParentFolderOptions(currentFolder?: ProjectFolder, selectedParentId: string = ''): string {
        const folders = this.folderManager.getFolders();
        const disabledIds = new Set<string>();
        if (currentFolder) {
            disabledIds.add(currentFolder.id);
            folders.forEach(folder => {
                if (this.folderManager.isFolderDescendant(folder.id, currentFolder.id)) {
                    disabledIds.add(folder.id);
                }
            });
        }

        const options = [
            `<option value="" ${selectedParentId === '' ? 'selected' : ''}>无上级文件夹</option>`
        ];

        folders
            .filter(folder => !disabledIds.has(folder.id))
            .forEach(folder => {
                const depth = this.getFolderDepth(folder);
                const prefix = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '└ ' : '');
                options.push(`<option value="${folder.id}" ${selectedParentId === folder.id ? 'selected' : ''}>${prefix}${folder.icon || '📂'} ${this.escapeHTML(folder.name)}</option>`);
            });

        return options.join('');
    }

    private getFolderDepth(folder: ProjectFolder): number {
        let depth = 0;
        let parentId = folder.parentId || '';
        const visited = new Set<string>();

        while (parentId && !visited.has(parentId)) {
            visited.add(parentId);
            const parent = this.folderManager.getFolderById(parentId);
            if (!parent) break;
            depth += 1;
            parentId = parent.parentId || '';
        }

        return depth;
    }

    private async deleteFolder(folder: ProjectFolder) {
        await confirm(
            i18n("deleteFolder") || "删除文件夹",
            (i18n("confirmDeleteFolder") || `确认删除文件夹 "${folder.name}" 吗？直接归属该文件夹的项目将被移出文件夹，子文件夹会提升到上一级。`).replace('${name}', folder.name),
            async () => {
                try {
                    await this.folderManager.deleteFolder(folder.id);
                    showMessage(i18n("folderDeleted") || "文件夹已删除");
                    this.notifyUpdated();
                    this.renderFolders();
                } catch (error) {
                    console.error('删除文件夹失败', error);
                    showMessage(i18n("deleteFolderFailed") || "删除文件夹失败");
                }
            }
        );
    }

    private notifyUpdated() {
        if (this.onUpdated) {
            this.onUpdated();
        }
    }

    private escapeHTML(value: string): string {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
