import { Dialog, showMessage, confirm, openEmoji } from "siyuan";
import { CategoryManager, Category } from "../utils/categoryManager";
import { i18n } from "../pluginInstance";
import { Picker } from "emoji-picker-element";
import zh_CN from "emoji-picker-element/i18n/zh_CN";
export class CategoryManageDialog {
    private dialog: Dialog;
    private categoryManager: CategoryManager;
    private onUpdated?: () => void;
    private draggedElement: HTMLElement | null = null;
    private draggedCategory: Category | null = null;
    private plugin?: any;
    private sharedPicker: any = null;
    private activeIconDisplay: HTMLElement | null = null;
    private sharedCloseHandler?: (e: MouseEvent) => void;
    private sharedResizeHandler?: () => void;
    private sharedScrollHandler?: () => void;
    private sharedEnterHandler?: (e: KeyboardEvent) => void;

    constructor(plugin?: any, onUpdated?: () => void) {
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.onUpdated = onUpdated;
    }

    public show() {
        this.dialog = new Dialog({
            title: i18n("categoryManagement"),
            content: this.createDialogContent(),
            width: "500px",
            height: "600px"
        });

        this.bindEvents();
        this.renderCategories();
    }

    private createDialogContent(): string {
        return `
            <div class="category-manage-dialog">
                <div class="b3-dialog__content">
                    <div class="category-toolbar">
                        <button class="b3-button b3-button--primary" id="addCategoryBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("addCategory")}
                        </button>
                        <button class="b3-button b3-button--outline" id="resetCategoriesBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            ${i18n("resetToDefault")}
                        </button>
                    </div>
                    <div class="category-drag-hint">
                        <span>💡 ${i18n("dragHint")}</span>
                    </div>
                    <div class="categories-list" id="categoriesList">
                        <!-- 分类列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--primary" id="closeBtn">${i18n("save")}</button>
                </div>
            </div>
            <style>
                .category-manage-dialog {
                    max-height: 580px;
                }
                
                .category-drag-hint {
                    padding: 8px 16px;
                    background: rgba(52, 152, 219, 0.1);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    font-size: 12px;
                    color: #666;
                    text-align: center;
                }
                
                .categories-list {
                    max-height: 400px;
                    overflow-y: auto;
                }
                
                .category-item {
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
                
                .category-item:hover {
                    background: var(--b3-theme-surface-lighter);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                
                .category-item.dragging {
                    opacity: 0.6;
                    cursor: grabbing;
                    transform: rotate(2deg);
                    z-index: 1000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                
                .category-item.drag-over-top {
                    border-top: 3px solid #3498db;
                    box-shadow: 0 -2px 0 rgba(52, 152, 219, 0.3);
                }
                
                .category-item.drag-over-bottom {
                    border-bottom: 3px solid #3498db;
                    box-shadow: 0 2px 0 rgba(52, 152, 219, 0.3);
                }
                
                .category-drag-handle {
                    cursor: grab;
                    padding: 4px;
                    color: #999;
                    display: flex;
                    align-items: center;
                    margin-right: 12px;
                    transition: color 0.2s ease;
                }
                
                .category-drag-handle:hover {
                    color: #3498db;
                }
                
                .category-drag-handle::before {
                    content: "⋮⋮";
                    font-size: 16px;
                    line-height: 1;
                }
                
                .category-info {
                    display: flex;
                    align-items: center;
                    flex: 1;
                }
                
                .category-visual {
                    display: flex;
                    align-items: center;
                    margin-right: 12px;
                }
                
                .category-icon {
                    font-size: 16px;
                    margin-right: 6px;
                }
                
                .category-color-preview {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    margin-right: 8px;
                }
                
                .category-actions {
                    display: flex;
                    gap: 4px;
                }
                
                .category-move-actions {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    margin-left: 8px;
                }
                
                .category-move-actions .b3-button {
                    padding: 2px 6px;
                    min-height: 24px;
                    line-height: 1;
                }
                
                .category-move-actions .b3-button__icon {
                    width: 14px;
                    height: 14px;
                }
                
                /* 移动端适配 */
                @media (max-width: 768px) {
                    .category-item {
                        padding: 10px 12px;
                    }
                    
                    .category-drag-handle {
                        margin-right: 8px;
                    }
                    
                    .category-move-actions {
                        margin-left: 4px;
                    }
                    
                    .category-move-actions .b3-button {
                        padding: 4px 8px;
                        min-height: 28px;
                    }
                }
                
                /* 触摸设备优化 */
                @media (pointer: coarse) {
                    .category-move-actions .b3-button {
                        min-width: 32px;
                        min-height: 32px;
                    }
                    
                    .category-move-actions .b3-button__icon {
                        width: 16px;
                        height: 16px;
                    }
                }
            </style>
        `;
    }

    private bindEvents() {
        const addCategoryBtn = this.dialog.element.querySelector('#addCategoryBtn') as HTMLButtonElement;
        const resetCategoriesBtn = this.dialog.element.querySelector('#resetCategoriesBtn') as HTMLButtonElement;
        const closeBtn = this.dialog.element.querySelector('#closeBtn') as HTMLButtonElement;

        addCategoryBtn?.addEventListener('click', () => {
            this.showAddCategoryDialog();
        });

        resetCategoriesBtn?.addEventListener('click', () => {
            this.resetCategories();
        });

        closeBtn?.addEventListener('click', () => {
            if (this.onUpdated) {
                this.onUpdated();
            }
            this.dialog.destroy();
        });
    }

    private async renderCategories() {
        const categoriesList = this.dialog.element.querySelector('#categoriesList') as HTMLElement;
        if (!categoriesList) return;

        try {
            const categories = await this.categoryManager.loadCategories();
            categoriesList.innerHTML = '';

            categories.forEach(category => {
                const categoryEl = this.createCategoryElement(category);
                categoriesList.appendChild(categoryEl);
            });
        } catch (error) {
            console.error(i18n("loadCategoriesFailed"), error);
            categoriesList.innerHTML = `<div class="category-error">${i18n("loadCategoriesFailed")}</div>`;
        }
    }

    private createCategoryElement(category: Category): HTMLElement {
        const categoryEl = document.createElement('div');
        categoryEl.className = 'category-item';
        categoryEl.draggable = true;
        categoryEl.dataset.categoryId = category.id;
        categoryEl.innerHTML = `
            <div class="category-drag-handle" title="拖拽排序"></div>
            <div class="category-info">
                <div class="category-visual">
                    <div class="category-icon" style="background-color: ${category.color};">
                        ${category.icon || '🏷'}
                    </div>
                    <div class="category-color-preview" style="background-color: ${category.color};"></div>
                </div>
                <div class="category-name">${category.name}</div>
            </div>
            <div class="category-actions">
                <button class="b3-button b3-button--outline category-edit-btn" data-action="edit" data-id="${category.id}" title="编辑分类">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                </button>
                <button class="b3-button b3-button--outline category-delete-btn" data-action="delete" data-id="${category.id}" title="删除分类">
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>
            </div>
            <div class="category-move-actions">
                <button class="b3-button b3-button--text category-move-up-btn" data-action="moveUp" data-id="${category.id}" title="上移">
                    <svg class="b3-button__icon"><use xlink:href="#iconUp"></use></svg>
                </button>
                <button class="b3-button b3-button--text category-move-down-btn" data-action="moveDown" data-id="${category.id}" title="下移">
                    <svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>
                </button>
            </div>
        `;

        // 绑定拖拽事件
        this.bindDragEvents(categoryEl, category);

        // 绑定操作事件
        const editBtn = categoryEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = categoryEl.querySelector('[data-action="delete"]') as HTMLButtonElement;
        const moveUpBtn = categoryEl.querySelector('[data-action="moveUp"]') as HTMLButtonElement;
        const moveDownBtn = categoryEl.querySelector('[data-action="moveDown"]') as HTMLButtonElement;

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditCategoryDialog(category);
        });

        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteCategory(category);
        });

        moveUpBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.moveCategoryUp(category);
        });

        moveDownBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.moveCategoryDown(category);
        });

        return categoryEl;
    }

    private bindDragEvents(element: HTMLElement, category: Category) {
        element.addEventListener('dragstart', (e) => {
            this.draggedElement = element;
            this.draggedCategory = category;
            element.classList.add('dragging');

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedElement = null;
            this.draggedCategory = null;

            // 清除所有拖拽状态
            const allItems = this.dialog.element.querySelectorAll('.category-item');
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
                // 清除之前的拖拽状态
                element.classList.remove('drag-over-top', 'drag-over-bottom');

                // 获取鼠标相对于元素的位置
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;

                // 根据鼠标位置决定是在上方还是下方插入
                if (mouseY < midPoint) {
                    element.classList.add('drag-over-top');
                } else {
                    element.classList.add('drag-over-bottom');
                }
            }
        });

        element.addEventListener('dragleave', (e) => {
            // 只有当鼠标真正离开元素时才清除样式
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

            if (this.draggedElement && this.draggedCategory && this.draggedElement !== element) {
                // 判断是在上方还是下方插入
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;
                const insertBefore = mouseY < midPoint;

                await this.handleCategoryReorder(this.draggedCategory, category, insertBefore);
            }
        });
    }

    private async moveCategoryUp(category: Category) {
        try {
            const categories = await this.categoryManager.loadCategories();
            const index = categories.findIndex(c => c.id === category.id);
            
            if (index <= 0) return; // 已经是第一个，无法再上移
            
            // 与前一个分类交换位置
            const reorderedCategories = [...categories];
            [reorderedCategories[index - 1], reorderedCategories[index]] = [reorderedCategories[index], reorderedCategories[index - 1]];
            
            await this.categoryManager.reorderCategories(reorderedCategories);
            this.renderCategories();
            showMessage(i18n("categoryMovedUp") || "分类已上移");
        } catch (error) {
            console.error('上移分类失败:', error);
            showMessage(i18n("moveCategoryFailed") || "移动分类失败");
        }
    }

    private async moveCategoryDown(category: Category) {
        try {
            const categories = await this.categoryManager.loadCategories();
            const index = categories.findIndex(c => c.id === category.id);
            
            if (index === -1 || index >= categories.length - 1) return; // 已经是最后一个，无法再下移
            
            // 与后一个分类交换位置
            const reorderedCategories = [...categories];
            [reorderedCategories[index], reorderedCategories[index + 1]] = [reorderedCategories[index + 1], reorderedCategories[index]];
            
            await this.categoryManager.reorderCategories(reorderedCategories);
            this.renderCategories();
            showMessage(i18n("categoryMovedDown") || "分类已下移");
        } catch (error) {
            console.error('下移分类失败:', error);
            showMessage(i18n("moveCategoryFailed") || "移动分类失败");
        }
    }

    private async handleCategoryReorder(draggedCategory: Category, targetCategory: Category, insertBefore: boolean = false) {
        try {
            const categories = await this.categoryManager.loadCategories();

            // 找到拖拽项和目标项的索引
            const draggedIndex = categories.findIndex(c => c.id === draggedCategory.id);
            const targetIndex = categories.findIndex(c => c.id === targetCategory.id);

            if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
                return;
            }

            // 重新排序数组
            const reorderedCategories = [...categories];
            const [removed] = reorderedCategories.splice(draggedIndex, 1);

            // 计算插入位置
            let insertIndex = targetIndex;
            if (draggedIndex < targetIndex) {
                insertIndex = targetIndex; // 由于已经移除了拖拽项，索引不需要调整
            }

            if (insertBefore) {
                reorderedCategories.splice(insertIndex, 0, removed);
            } else {
                reorderedCategories.splice(insertIndex + 1, 0, removed);
            }

            // 保存新的排序
            await this.categoryManager.reorderCategories(reorderedCategories);

            // 重新渲染
            this.renderCategories();

            showMessage("分类排序已更新");
        } catch (error) {
            console.error('重新排序分类失败:', error);
            showMessage("排序更新失败，请重试");
        }
    }

    private showAddCategoryDialog() {
        this.showCategoryEditDialog();
    }

    private showEditCategoryDialog(category: Category) {
        this.showCategoryEditDialog(category);
    }

    private showCategoryEditDialog(category?: Category) {
        const isEdit = !!category;
        const editDialog = new Dialog({
            title: isEdit ? "编辑分类" : "添加分类",
            content: `
                <div class="category-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类名称</label>
                            <input type="text" id="categoryName" class="b3-text-field" value="${category?.name || ''}" placeholder="请输入分类名称">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类颜色</label>
                            <input type="color" id="categoryColor" class="b3-text-field" value="${category?.color || '#3498db'}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类图标</label>
                            <div id="categoryIcon" class="category-icon-display">${category?.icon || '🏷'}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">预览</label>
                            <div class="category-preview">
                                <div class="category-dot" id="previewDot" style="background-color: ${category?.color || '#3498db'};"></div>
                                <span id="previewIcon">${category?.icon || '🏷'}</span>
                                <span id="previewName">${category?.name || '新分类'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">${i18n("save")}</button>
                    </div>
                    <style>
                        .category-icon-display {
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
                        .category-icon-display:hover {
                            transform: scale(1.1);
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                        }
                    </style>
                </div>
            `,
            width: "400px",
            height: "350px"
        });

        // 绑定预览更新事件
        const nameInput = editDialog.element.querySelector('#categoryName') as HTMLInputElement;
        const colorInput = editDialog.element.querySelector('#categoryColor') as HTMLInputElement;
        const iconDisplay = editDialog.element.querySelector('#categoryIcon') as HTMLElement;
        const previewDot = editDialog.element.querySelector('#previewDot') as HTMLElement;
        const previewIcon = editDialog.element.querySelector('#previewIcon') as HTMLElement;
        const previewName = editDialog.element.querySelector('#previewName') as HTMLElement;

        // 设置初始图标
        if (category?.icon) {
            iconDisplay.textContent = category.icon;
        } else {
            iconDisplay.textContent = '🏷';
        }

        // 绑定图标点击事件
        iconDisplay?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openBuiltInEmojiPicker(iconDisplay, previewIcon);
        });

        const updatePreview = () => {
            const name = nameInput.value || '新分类';
            const color = colorInput.value;
            const icon = iconDisplay.textContent || '🏷';

            previewDot.style.backgroundColor = color;
            previewIcon.textContent = icon;
            previewName.textContent = name;
        };

        nameInput.addEventListener('input', updatePreview);
        colorInput.addEventListener('input', updatePreview);
        iconDisplay.addEventListener('input', updatePreview); // 虽然是div，但为了兼容

        // 绑定保存和取消事件
        const cancelBtn = editDialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = editDialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;

        cancelBtn?.addEventListener('click', () => {
            editDialog.destroy();
        });

        confirmBtn?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const icon = iconDisplay.textContent || '';

            if (!name) {
                showMessage("请输入分类名称");
                return;
            }

            try {
                if (isEdit && category) {
                    await this.categoryManager.updateCategory(category.id, { name, color, icon });
                    showMessage("分类已更新");
                } else {
                    await this.categoryManager.addCategory({ name, color, icon });
                    showMessage("分类已添加");
                }

                editDialog.destroy();
                this.renderCategories();
            } catch (error) {
                console.error('保存分类失败:', error);
                showMessage("保存分类失败，请重试");
            }
        });
    }

    private async deleteCategory(category: Category) {
        await confirm(
            i18n("deleteCategory"),
            i18n("confirmDeleteCategory", { name: category.name }),
            async () => {
                try {
                    await this.categoryManager.deleteCategory(category.id);
                    showMessage(i18n("categoryDeleted"));
                    this.renderCategories();
                } catch (error) {
                    console.error(i18n("deleteCategoryFailed"), error);
                    showMessage(i18n("deleteCategoryFailed"));
                }
            }
        );
    }

    private async resetCategories() {
        await confirm(
            i18n("resetCategories"),
            i18n("confirmResetCategories"),
            async () => {
                try {
                    await this.categoryManager.resetToDefault();
                    showMessage(i18n("categoriesReset"));
                    this.renderCategories();
                } catch (error) {
                    console.error(i18n("resetCategoriesFailed"), error);
                    showMessage(i18n("resetCategoriesFailed"));
                }
            }
        );
    }

    private openBuiltInEmojiPicker(target: HTMLElement, previewIcon: HTMLElement) {
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
                const selectedEmoji = String.fromCodePoint(...codePoints);
                target.textContent = selectedEmoji;
                previewIcon.textContent = selectedEmoji;
            }
        });
    }

    private initSharedPicker() {
        if (this.sharedPicker) return;
        try {
            // Prefer direct class constructor if available for typing and tree-shaking
            // Fallback to createElement when Picker is undefined (older build/runtime)
            try {
                // eslint-disable-next-line new-cap
                this.sharedPicker = new Picker({
                    i18n: zh_CN,
                    locale: 'zh_CN',
                    dataSource: '/plugins/siyuan-plugin-task-note-management/assets/emojis_search.json'
                });
            } catch (e) {
                // @ts-ignore - fall back to DOM creation
                this.sharedPicker = document.createElement('emoji-picker') as any;
                if (this.sharedPicker) {
                    // Set attributes for DOM-created picker
                    this.sharedPicker.setAttribute('locale', 'zh_CN');
                    this.sharedPicker.setAttribute('data-source', '/plugins/siyuan-plugin-task-note-management/assets/emojis_search.json');
                }
            }
            this.sharedPicker.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 2147483647; display: none; margin-top: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); border-radius: 12px; background: var(--b3-theme-surface);';
            document.body.appendChild(this.sharedPicker);

            this.sharedPicker.addEventListener('emoji-click', (event: any) => {
                const selectedEmoji = event.detail.emoji.unicode;
                if (this.activeIconDisplay) {
                    this.activeIconDisplay.textContent = selectedEmoji;
                    // 触发预览更新
                    const previewIcon = this.activeIconDisplay.closest('.category-edit-dialog')?.querySelector('#previewIcon') as HTMLElement;
                    if (previewIcon) {
                        previewIcon.textContent = selectedEmoji;
                    }
                }
                this.sharedPicker.style.display = 'none';
                this.activeIconDisplay = null;
            });

            // 当搜索框内容本身是 Emoji 时, 支持按 Enter 直接确定
            const attachEnterHandler = () => {
                try {
                    const searchInput = this.sharedPicker.shadowRoot?.querySelector('input[type="search"]') as HTMLInputElement;
                    if (searchInput) {
                        this.sharedEnterHandler = (e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                                const val = searchInput.value.trim();
                                if (this.isAllEmoji(val)) {
                                    this.applyEmojiFromSearch(val);
                                }
                            }
                        };
                        searchInput.addEventListener('keydown', this.sharedEnterHandler);
                    }
                } catch (error) {
                    // ignore
                }
            };

            // try to attach immediately; if not present (render delay), attach after a short delay
            attachEnterHandler();
            setTimeout(attachEnterHandler, 50);

            this.sharedCloseHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (this.sharedPicker && !this.sharedPicker.contains(target) && this.activeIconDisplay && !this.activeIconDisplay.contains(target)) {
                    this.sharedPicker.style.display = 'none';
                    this.activeIconDisplay = null;
                }
            };
            document.addEventListener('click', this.sharedCloseHandler);

            this.sharedResizeHandler = () => {
                if (this.sharedPicker && this.sharedPicker.style.display === 'block') this.positionSharedPicker(this.activeIconDisplay);
            };
            window.addEventListener('resize', this.sharedResizeHandler);

            this.sharedScrollHandler = () => {
                if (this.sharedPicker && this.sharedPicker.style.display === 'block') this.positionSharedPicker(this.activeIconDisplay);
            };
            window.addEventListener('scroll', this.sharedScrollHandler, true);
        } catch (error) {
            console.error('init shared picker failed', error);
        }
    }

    private positionSharedPicker(target: HTMLElement | null) {
        if (!this.sharedPicker || !target) return;
        const rect = target.getBoundingClientRect();
        const prevDisplay = this.sharedPicker.style.display;
        this.sharedPicker.style.display = 'block';
        this.sharedPicker.style.visibility = 'hidden';
        const pr = this.sharedPicker.getBoundingClientRect();
        let top = rect.bottom + 8;
        if (top + pr.height > window.innerHeight) {
            top = rect.top - pr.height - 8;
        }
        let left = rect.left;
        if (left + pr.width > window.innerWidth) {
            left = window.innerWidth - pr.width - 8;
        }
        if (left < 8) left = 8;
        this.sharedPicker.style.left = `${Math.round(left)}px`;
        this.sharedPicker.style.top = `${Math.round(top)}px`;
        this.sharedPicker.style.visibility = 'visible';
        this.sharedPicker.style.display = prevDisplay;
    }

    private isAllEmoji(str: string) {
        const s = (str || '').trim();
        if (!s) return false;
        try {
            // Use Unicode property escapes to match emoji sequences, including ZWJ sequences
            return /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(s);
        } catch (e) {
            // Fallback: check if there's a surrogate pair (basic heuristic)
            return /[\uD800-\uDFFF]/.test(s);
        }
    }

    private applyEmojiFromSearch(val: string) {
        const emoji = (val || '').trim();
        if (!emoji) return;
        if (this.activeIconDisplay) {
            this.activeIconDisplay.textContent = emoji;
            // 触发预览更新
            const previewIcon = this.activeIconDisplay.closest('.category-edit-dialog')?.querySelector('#previewIcon') as HTMLElement;
            if (previewIcon) {
                previewIcon.textContent = emoji;
            }
        }
        if (this.sharedPicker) this.sharedPicker.style.display = 'none';
        this.activeIconDisplay = null;
    }

    private clearAllPickers() {
        if (this.sharedPicker) {
            try {
                if (this.sharedCloseHandler) document.removeEventListener('click', this.sharedCloseHandler);
                if (this.sharedResizeHandler) window.removeEventListener('resize', this.sharedResizeHandler);
                if (this.sharedScrollHandler) window.removeEventListener('scroll', this.sharedScrollHandler, true);
                if (this.sharedEnterHandler) {
                    // Try to remove from search input
                    try {
                        const searchInput = this.sharedPicker.shadowRoot?.querySelector('input[type="search"]') as HTMLInputElement;
                        if (searchInput) {
                            searchInput.removeEventListener('keydown', this.sharedEnterHandler);
                        }
                    } catch (e) {
                        // ignore
                    }
                }
                document.body.removeChild(this.sharedPicker);
            } catch (error) {
                console.error('clear picker failed', error);
            }
            this.sharedPicker = null;
            this.sharedCloseHandler = undefined;
            this.sharedResizeHandler = undefined;
            this.sharedScrollHandler = undefined;
            this.sharedEnterHandler = undefined;
            this.activeIconDisplay = null;
        }
    }
}
