import { Dialog } from "siyuan";
import { i18n } from "../pluginInstance";
import { SortCriterion, AVAILABLE_SORT_METHODS, getSortCriterionName } from "../utils/sortConfig";

export interface SortMenuDialogOptions {
    plugin: any;
    currentCriteria: SortCriterion[];
    onSave: (criteria: SortCriterion[]) => void;
    onChange?: (criteria: SortCriterion[]) => void; // 实时变更回调
}

export class SortMenuDialog {
    private dialog: Dialog | null = null;
    private options: SortMenuDialogOptions;
    private selectedCriteria: SortCriterion[] = [];
    private draggedIndex: number = -1;
    private isMultiSelect: boolean = false;

    constructor(options: SortMenuDialogOptions) {
        this.options = options;
        // 深拷贝当前排序条件
        this.selectedCriteria = JSON.parse(JSON.stringify(options.currentCriteria));
        // 根据当前条件数量判断是否为多选模式（多于1个条件则为多选）
        this.isMultiSelect = this.selectedCriteria.length > 1;
    }

    public show() {
        const dialog = new Dialog({
            title: i18n("sortBy") || "排序方式",
            content: `<div class="sort-menu-dialog" style="padding: 16px; min-width: 320px;">
                <div class="sort-menu-mode" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--b3-theme-border);">
                    <span style="font-size: 13px; color: var(--b3-theme-on-surface);">${i18n("multiSelectSortMode") || "多选排序模式"}</span>
                    <label  style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" class="b3-switch sort-mode-switch" ${this.isMultiSelect ? 'checked' : ''}>
                        <span class="b3-switch__slider"></span>
                    </label>
                </div>
                <div class="sort-menu-selected" style="${this.isMultiSelect ? '' : 'display: none;'}">
                    <div class="sort-menu-label" style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 8px;">
                        ${i18n("selectedSortCriteria") || "已选择的排序条件（可拖拽调整顺序）"}
                    </div>
                    <div class="sort-menu-selected-list" style="min-height: 40px; margin-bottom: 16px;">
                        <!-- 已选择的条件将显示在这里 -->
                    </div>
                </div>
                <div class="sort-menu-current-single" style="${!this.isMultiSelect && this.selectedCriteria.length > 0 ? '' : 'display: none;'}; margin-bottom: 16px;">
                    <div class="sort-menu-label" style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 8px;">
                        ${i18n("currentSort") || "当前排序"}
                    </div>
                    <div class="sort-menu-current-single-item" style="padding: 8px 12px; background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-border); border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                        <!-- 当前单选条件显示在这里 -->
                    </div>
                </div>
                <div class="sort-menu-available">
                    <div class="sort-menu-label" style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 8px;">
                        ${this.isMultiSelect ? (i18n("availableSortMethods") || "可用的排序方式") : (i18n("clickToSelectSort") || "点击选择排序方式")}
                    </div>
                    <div class="sort-menu-options" style="display: flex; flex-direction: column; gap: 8px;">
                        <!-- 可用的排序选项将显示在这里 -->
                    </div>
                </div>
                <div class="sort-menu-actions" style="margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="b3-button b3-button--cancel sort-menu-cancel">${i18n("close") || "关闭"}</button>
                </div>
            </div>`,
            width: "400px"
        });

        this.dialog = dialog;
        this.renderSelectedList();
        this.renderCurrentSingleItem();
        this.renderAvailableOptions();
        this.bindEvents();
    }

    private renderSelectedList() {
        const container = this.dialog?.element.querySelector('.sort-menu-selected-list');
        if (!container) return;

        container.innerHTML = '';

        if (this.selectedCriteria.length === 0) {
            container.innerHTML = `<div style="color: var(--b3-theme-on-surface-light); font-size: 13px; text-align: center; padding: 12px;">
                ${i18n("noSortCriteriaSelected") || "未选择排序条件"}
            </div>`;
            return;
        }

        this.selectedCriteria.forEach((criterion, index) => {
            const item = document.createElement('div');
            item.className = 'sort-menu-selected-item';
            item.dataset.index = index.toString();
            item.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: var(--b3-theme-surface);
                border: 1px solid var(--b3-theme-border);
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: move;
                transition: all 0.2s;
            `;

            // 拖拽手柄
            const dragHandle = document.createElement('span');
            dragHandle.innerHTML = '☰';
            dragHandle.style.cssText = 'cursor: move; opacity: 0.5; font-size: 12px;';

            // 排序序号
            const orderNum = document.createElement('span');
            orderNum.textContent = `${index + 1}`;
            orderNum.style.cssText = `
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: var(--b3-theme-primary);
                color: white;
                font-size: 11px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            `;

            // 排序名称
            const name = document.createElement('span');
            name.textContent = getSortCriterionName(criterion);
            name.style.cssText = 'flex: 1; font-size: 13px;';

            // 升序/降序切换按钮
            const orderBtn = document.createElement('button');
            orderBtn.className = 'b3-button b3-button--text';
            orderBtn.innerHTML = criterion.order === 'asc' ? '↑' : '↓';
            orderBtn.classList.add('ariaLabel'); orderBtn.setAttribute('aria-label', criterion.order === 'asc' ? (i18n("ascending") || "升序") : (i18n("descending") || "降序"));
            orderBtn.style.cssText = 'padding: 4px 8px; font-size: 14px;';
            orderBtn.addEventListener('click', () => {
                this.toggleOrder(index);
            });

            // 删除按钮
            const removeBtn = document.createElement('button');
            removeBtn.className = 'b3-button b3-button--text';
            removeBtn.innerHTML = '✕';
            removeBtn.classList.add('ariaLabel'); removeBtn.setAttribute('aria-label', i18n("remove") || "移除");
            removeBtn.style.cssText = 'padding: 4px 8px; color: var(--b3-theme-error);';
            removeBtn.addEventListener('click', () => {
                this.removeCriterion(index);
            });

            item.appendChild(dragHandle);
            item.appendChild(orderNum);
            item.appendChild(name);
            item.appendChild(orderBtn);
            item.appendChild(removeBtn);

            // 拖拽事件
            this.bindDragEvents(item, index);

            container.appendChild(item);
        });
    }

    private renderCurrentSingleItem() {
        const container = this.dialog?.element.querySelector('.sort-menu-current-single-item');
        const wrapper = this.dialog?.element.querySelector('.sort-menu-current-single');
        if (!container || !wrapper) return;

        container.innerHTML = '';

        if (this.selectedCriteria.length === 0) {
            (wrapper as HTMLElement).style.display = 'none';
            return;
        }

        if (!this.isMultiSelect) {
            (wrapper as HTMLElement).style.display = '';
            const criterion = this.selectedCriteria[0];

            // 排序名称
            const name = document.createElement('span');
            name.textContent = getSortCriterionName(criterion);
            name.style.cssText = 'flex: 1; font-size: 13px;';

            // 升序/降序切换按钮
            const orderBtn = document.createElement('button');
            orderBtn.className = 'b3-button b3-button--text';
            orderBtn.innerHTML = criterion.order === 'asc' ? '↑' : '↓';
            orderBtn.classList.add('ariaLabel'); orderBtn.setAttribute('aria-label', criterion.order === 'asc' ? (i18n("ascending") || "升序") : (i18n("descending") || "降序"));
            orderBtn.style.cssText = 'padding: 4px 8px; font-size: 14px;';
            orderBtn.addEventListener('click', () => {
                this.toggleOrder(0);
            });

            container.appendChild(name);
            container.appendChild(orderBtn);
        } else {
            (wrapper as HTMLElement).style.display = 'none';
        }
    }

    private renderAvailableOptions() {
        const container = this.dialog?.element.querySelector('.sort-menu-options');
        const label = this.dialog?.element.querySelector('.sort-menu-available .sort-menu-label');
        if (!container) return;

        if (label) {
            label.textContent = this.isMultiSelect 
                ? (i18n("availableSortMethods") || "可用的排序方式")
                : (i18n("clickToSelectSort") || "点击选择排序方式");
        }

        container.innerHTML = '';

        // 获取已选择的方法
        const selectedMethods = new Set(this.selectedCriteria.map(c => c.method));

        AVAILABLE_SORT_METHODS.forEach(method => {
            const isSelected = selectedMethods.has(method.key);
            
            const btn = document.createElement('button');
            btn.className = 'b3-button b3-button--outline';
            btn.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                justify-content: flex-start;
                opacity: ${isSelected ? '0.5' : '1'};
                cursor: ${isSelected ? 'not-allowed' : 'pointer'};
            `;
            btn.innerHTML = `<span>${method.icon}</span><span>${method.label()}</span>`;
            
            if (!isSelected) {
                btn.addEventListener('click', () => {
                    if (this.isMultiSelect) {
                        this.addCriterion(method.key);
                    } else {
                        this.selectSingleCriterion(method.key);
                    }
                });
            }

            container.appendChild(btn);
        });
    }

    private bindEvents() {
        const cancelBtn = this.dialog?.element.querySelector('.sort-menu-cancel');
        const modeSwitch = this.dialog?.element.querySelector('.sort-mode-switch') as HTMLInputElement;

        cancelBtn?.addEventListener('click', () => {
            this.dialog?.destroy();
        });

        modeSwitch?.addEventListener('change', () => {
            this.isMultiSelect = modeSwitch.checked;
            this.updateModeUI();
            // 切换模式时实时保存
            this.notifyChange();
        });
    }

    // 通知外部变更（实时更新）
    private notifyChange() {
        if (this.selectedCriteria.length > 0) {
            this.options.onChange?.(this.selectedCriteria);
        }
    }

    private updateModeUI() {
        // 更新已选择列表显示
        const selectedSection = this.dialog?.element.querySelector('.sort-menu-selected') as HTMLElement;
        const singleSection = this.dialog?.element.querySelector('.sort-menu-current-single') as HTMLElement;
        
        if (selectedSection) {
            (selectedSection as HTMLElement).style.display = this.isMultiSelect ? '' : 'none';
        }
        if (singleSection) {
            (singleSection as HTMLElement).style.display = (!this.isMultiSelect && this.selectedCriteria.length > 0) ? '' : 'none';
        }

        // 更新标签文本
        const label = this.dialog?.element.querySelector('.sort-menu-available .sort-menu-label');
        if (label) {
            label.textContent = this.isMultiSelect 
                ? (i18n("availableSortMethods") || "可用的排序方式")
                : (i18n("clickToSelectSort") || "点击选择排序方式");
        }

        // 如果在切换到多选模式时只有一个条件，保持现状
        // 如果在切换到单选模式时有多个条件，只保留第一个
        if (!this.isMultiSelect && this.selectedCriteria.length > 1) {
            this.selectedCriteria = [this.selectedCriteria[0]];
        }

        this.renderSelectedList();
        this.renderCurrentSingleItem();
        this.renderAvailableOptions();
    }

    private bindDragEvents(item: HTMLElement, index: number) {
        item.draggable = true;

        item.addEventListener('dragstart', (e) => {
            this.draggedIndex = index;
            item.style.opacity = '0.5';
            e.dataTransfer?.setData('text/plain', index.toString());
        });

        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
            this.draggedIndex = -1;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.draggedIndex === -1 || this.draggedIndex === index) return;

            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            
            if (e.clientY < midY) {
                item.style.borderTop = '2px solid var(--b3-theme-primary)';
                item.style.borderBottom = '';
            } else {
                item.style.borderTop = '';
                item.style.borderBottom = '2px solid var(--b3-theme-primary)';
            }
        });

        item.addEventListener('dragleave', () => {
            item.style.borderTop = '';
            item.style.borderBottom = '';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.style.borderTop = '';
            item.style.borderBottom = '';

            if (this.draggedIndex === -1 || this.draggedIndex === index) return;

            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            let targetIndex = index;

            if (e.clientY > midY) {
                targetIndex = index + 1;
            }

            // 调整目标索引（如果从上面拖拽下来）
            if (this.draggedIndex < targetIndex) {
                targetIndex--;
            }

            this.moveCriterion(this.draggedIndex, targetIndex);
        });
    }

    private addCriterion(method: string) {
        this.selectedCriteria.push({ method, order: 'asc' });
        this.renderSelectedList();
        this.renderAvailableOptions();
        this.notifyChange();
    }

    private selectSingleCriterion(method: string) {
        // 单选模式：直接替换当前选择
        this.selectedCriteria = [{ method, order: 'asc' }];
        this.renderCurrentSingleItem();
        this.renderAvailableOptions();
        this.notifyChange();
    }

    private removeCriterion(index: number) {
        this.selectedCriteria.splice(index, 1);
        this.renderSelectedList();
        this.renderAvailableOptions();
        this.notifyChange();
    }

    private toggleOrder(index: number) {
        const criterion = this.selectedCriteria[index];
        criterion.order = criterion.order === 'asc' ? 'desc' : 'asc';
        this.renderSelectedList();
        this.renderCurrentSingleItem();
        this.notifyChange();
    }

    private moveCriterion(fromIndex: number, toIndex: number) {
        if (fromIndex === toIndex) return;
        
        const [moved] = this.selectedCriteria.splice(fromIndex, 1);
        this.selectedCriteria.splice(toIndex, 0, moved);
        
        this.renderSelectedList();
        this.notifyChange();
    }
}
