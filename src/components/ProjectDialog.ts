import { Dialog, showMessage } from "siyuan";
import { getBlockByID } from "../api";
import { getLogicalDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { StatusManager } from "../utils/statusManager";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { i18n } from "../pluginInstance";
import { generateRandomColor } from "../utils/uiUtils";

export class ProjectDialog {
    private dialog: Dialog;
    private blockId: string;
    private selectedCategoryIds: string[] = [];
    private categoryManager: CategoryManager;
    private statusManager: StatusManager;
    private plugin?: any;

    constructor(blockId?: string, plugin?: any) {
        this.blockId = blockId;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.statusManager = StatusManager.getInstance(this.plugin);
    }

    async show() {
        try {
            let blockContent = '';
            const projectData = await this.plugin.loadProjectData();
            const existingProject = this.blockId ? projectData[this.blockId] : undefined;

            // 初始化选中的分类
            this.selectedCategoryIds = existingProject?.categoryId ? existingProject.categoryId.split(',') : [];

            if (this.blockId && !existingProject) {
                // Block being converted to project
                const block = await getBlockByID(this.blockId);
                if (!block) {
                    showMessage(i18n("cannotGetDocumentId"));
                    return;
                }
                blockContent = block.content;
            }

            this.dialog = new Dialog({
                title: existingProject ? (i18n("edit") + i18n("project")) : (this.blockId ? (i18n("setAsProjectNote") || "设置为项目笔记") : (i18n("createProject") || "创建项目")),
                content: this.generateDialogHTML(existingProject?.title || blockContent, existingProject),
                width: "500px",
                height: "630px"
            });

            this.bindEvents();
            await this.statusManager.initialize();
        } catch (error) {
            console.error('显示项目对话框失败:', error);
            showMessage(i18n("openModifyDialogFailed"));
        }
    }

    private generateDialogHTML(title: string, existingProject?: any): string {
        const today = getLogicalDateString();
        const statuses = this.statusManager.getStatuses();
        const statusOptions = statuses.map(status =>
            `<option value="${status.id}" ${existingProject?.status === status.id ? 'selected' : ''}>${status.icon ? status.icon + ' ' : ''}${status.name}</option>`
        ).join('');

        return `
            <div class="project-dialog">
                <div class="b3-dialog__content">
                    <div class="form-group">
                        <label>${i18n("projectTitle") || "项目标题"}:</label>
                        <input type="text" id="projectTitle" class="b3-text-field" style="width: 100%;" value="${existingProject?.title || title}" placeholder="${i18n("pleaseEnterProjectTitle") || "输入项目标题"}">
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("note") || "项目描述"}:</label>
                        <textarea id="projectNote" class="b3-text-field" rows="3" style="width: 100%;" placeholder="${i18n("enterReminderNote") || "输入项目描述"}">${existingProject?.note || ''}</textarea>
                    </div>
                    
                    <!-- 绑定块/文档输入，允许手动输入块 ID 或文档 ID -->
                    <div class="form-group">
                        <label>${i18n("bindToBlock") || '块或文档 ID'}:</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="projectBlockInput" class="b3-text-field" value="${existingProject ? (existingProject.blockId || '') : (this.blockId || '')}" placeholder="${i18n("enterBlockId") || '请输入块或文档 ID'}" style="flex: 1;">
                            <button type="button" id="projectPasteBlockRefBtn" class="b3-button b3-button--outline ariaLabel" aria-label="${i18n("pasteBlockRef")}">
                                <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                            </button>
                            <button type="button" id="projectBindBlockBtn" class="b3-button b3-button--outline ariaLabel" aria-label="${i18n("newDocument") || '新建文档'}">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("projectStatus") || "项目状态"}:</label>
                        <select id="projectStatus" class="b3-select">
                            ${statusOptions}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("priority") || "优先级"}:</label>
                        <select id="projectPriority" class="b3-select">
                            <option value="none" ${(!existingProject?.priority || existingProject?.priority === 'none') ? 'selected' : ''}>${i18n("noPriority") || "无"}</option>
                            <option value="low" ${existingProject?.priority === 'low' ? 'selected' : ''}>${i18n("lowPriority") || "低"}</option>
                            <option value="medium" ${existingProject?.priority === 'medium' ? 'selected' : ''}>${i18n("mediumPriority") || "中"}</option>
                            <option value="high" ${existingProject?.priority === 'high' ? 'selected' : ''}>${i18n("highPriority") || "高"}</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("category") || "分类"}:</label>
                        <div id="category-selector" class="category-selector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
                            <!-- 分类选择器将在这里渲染 -->
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("projectColor") || "项目颜色"}:</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="color" id="projectColor" class="b3-text-field" value="${existingProject?.color || generateRandomColor()}" style="width: 64px; height: 36px; padding: 2px 4px; cursor: pointer;">
                            <button type="button" id="projectRandomColorBtn" class="b3-button b3-button--outline">${i18n("randomColor") || '随机颜色'}</button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("startDate") || "开始日期"}:</label>
                        <input type="date" id="projectStartDate" class="b3-text-field" value="${existingProject?.startDate || today}" max="9999-12-31">
                    </div>
                    
                    <div class="form-group">
                        <label>${i18n("endDate") || "截止日期"}:</label>
                        <input type="date" id="projectEndDate" class="b3-text-field" value="${existingProject?.endDate || ''}" max="9999-12-31">
                    </div>
                </div>
                
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${i18n("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--text" id="saveBtn">${i18n("save") || "保存"}</button>
                </div>
            </div>
            
            <style>
                .project-dialog {
                    padding: 16px;
                }
                
                .project-form {
                    margin-bottom: 16px;
                }
                
                .form-group {
                    margin-bottom: 12px;
                }
                
                .form-group label {
                    display: block;
                    margin-bottom: 4px;
                    font-weight: 500;
                }
                
                .dialog-buttons {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding-top: 16px;
                    border-top: 1px solid var(--b3-theme-surface-lighter);
                }
            </style>
        `;
    }

    private bindEvents() {
        this.renderCategorySelector();
        const saveBtn = this.dialog.element.querySelector('#saveBtn') as HTMLButtonElement;
        const cancelBtn = this.dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const pasteBlockRefBtn = this.dialog.element.querySelector('#projectPasteBlockRefBtn') as HTMLButtonElement;
        const bindBlockBtn = this.dialog.element.querySelector('#projectBindBlockBtn') as HTMLButtonElement;
        const blockInput = this.dialog.element.querySelector('#projectBlockInput') as HTMLInputElement;

        saveBtn?.addEventListener('click', () => {
            this.saveProject();
        });

        cancelBtn?.addEventListener('click', () => {
            this.dialog.destroy();
        });

        // 粘贴块引用按钮
        pasteBlockRefBtn?.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    // 提取块ID（支持多种格式：siyuan://blocks/xxx 或 ((xxx)) 或直接的ID）
                    const blockId = this.extractBlockId(text) || text.trim();
                    if (blockInput) {
                        blockInput.value = blockId;
                    }
                }
            } catch (error) {
                console.error('读取剪贴板失败:', error);
                showMessage(i18n("pasteBlockRefFailed") || "粘贴失败");
            }
        });

        // 新建文档/绑定块按钮
        bindBlockBtn?.addEventListener('click', () => {
            const titleEl = this.dialog.element.querySelector('#projectTitle') as HTMLInputElement;
            const blockBindingDialog = new BlockBindingDialog(this.plugin, (blockId: string) => {
                if (blockInput) {
                    blockInput.value = blockId;
                }
            }, {
                defaultTab: 'document',
                defaultTitle: titleEl?.value?.trim() || ''
            });
            blockBindingDialog.show();
        });

        // 回车键保存
        this.dialog.element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.saveProject();
            }
        });

        // 随机颜色按钮
        const randomColorBtn = this.dialog.element.querySelector('#projectRandomColorBtn') as HTMLButtonElement;
        const colorInput = this.dialog.element.querySelector('#projectColor') as HTMLInputElement;
        randomColorBtn?.addEventListener('click', () => {
            if (colorInput) colorInput.value = generateRandomColor();
        });
    }

    private renderCategorySelector() {
        const categorySelector = this.dialog.element.querySelector('#category-selector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();
            categorySelector.innerHTML = '';

            // 添加无分类选项
            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = 'category-option';
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${i18n("noCategory") || "无分类"}</span>`;

            if (this.selectedCategoryIds.length === 0) {
                noCategoryEl.classList.add('selected');
            }

            // 点击事件
            noCategoryEl.addEventListener('click', () => {
                this.selectedCategoryIds = [];
                this.updateCategorySelectionUI();
            });

            categorySelector.appendChild(noCategoryEl);

            // 添加所有分类选项
            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'category-option';
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;

                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;

                if (this.selectedCategoryIds.includes(category.id)) {
                    categoryEl.classList.add('selected');
                }

                // 点击事件
                categoryEl.addEventListener('click', () => {
                    const isSelected = this.selectedCategoryIds.includes(category.id);
                    if (isSelected) {
                        this.selectedCategoryIds = this.selectedCategoryIds.filter(id => id !== category.id);
                    } else {
                        this.selectedCategoryIds.push(category.id);
                    }
                    this.updateCategorySelectionUI();
                });

                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private updateCategorySelectionUI() {
        const categorySelector = this.dialog.element.querySelector('#category-selector') as HTMLElement;
        if (!categorySelector) return;

        const buttons = categorySelector.querySelectorAll('.category-option');
        buttons.forEach(btn => {
            const id = btn.getAttribute('data-category');
            if (this.selectedCategoryIds.length === 0) {
                // 如果没有选中的，高亮“无分类”
                if (!id) btn.classList.add('selected');
                else btn.classList.remove('selected');
            } else {
                // 如果有选中的，根据ID高亮
                if (id && this.selectedCategoryIds.includes(id)) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            }
        });
    }

    // 提取块ID的辅助方法
    private extractBlockId(text: string): string | null {
        // 匹配 siyuan://blocks/xxx 格式
        const siyuanMatch = text.match(/siyuan:\/\/blocks\/([a-zA-Z0-9-]+)/);
        if (siyuanMatch) return siyuanMatch[1];

        // 匹配 ((xxx)) 格式
        const refMatch = text.match(/\(\(([a-zA-Z0-9-]+)\)\)/);
        if (refMatch) return refMatch[1];

        // 匹配纯ID格式（20位字母数字组合）
        const idMatch = text.match(/^([a-zA-Z0-9-]{20})$/);
        if (idMatch) return idMatch[1];

        return null;
    }

    private async saveProject() {
        try {
            const titleEl = this.dialog.element.querySelector('#projectTitle') as HTMLInputElement;
            const noteEl = this.dialog.element.querySelector('#projectNote') as HTMLTextAreaElement;
            const statusEl = this.dialog.element.querySelector('#projectStatus') as HTMLSelectElement;
            const priorityEl = this.dialog.element.querySelector('#projectPriority') as HTMLSelectElement;
            const colorEl = this.dialog.element.querySelector('#projectColor') as HTMLInputElement;
            const startDateEl = this.dialog.element.querySelector('#projectStartDate') as HTMLInputElement;
            const endDateEl = this.dialog.element.querySelector('#projectEndDate') as HTMLInputElement;

            const title = titleEl.value.trim();
            if (!title) {
                showMessage(i18n("pleaseEnterProjectTitle"));
                titleEl.focus();
                return;
            }

            const startDate = startDateEl.value;
            const endDate = endDateEl.value;

            // 验证日期
            if (endDate && startDate && endDate < startDate) {
                showMessage(i18n("endDateCannotBeEarlier"));
                endDateEl.focus();
                return;
            }

            const projectData = await this.plugin.loadProjectData();
            const projectId = this.blockId || `quick_${Date.now()}`;
            const existingProject = this.blockId ? projectData[this.blockId] : null;

            // 获取块ID输入框的值
            const blockInputEl = this.dialog.element.querySelector('#projectBlockInput') as HTMLInputElement;
            const rawBlockVal = blockInputEl?.value?.trim() || '';
            const inputBlockId = rawBlockVal ? (this.extractBlockId(rawBlockVal) || rawBlockVal) : null;

            const project = {
                ...(existingProject || {}),
                id: projectId,
                blockId: inputBlockId || null,
                title: title,
                note: noteEl.value.trim(),
                status: statusEl.value,
                priority: priorityEl.value,
                categoryId: this.selectedCategoryIds.join(','),
                color: colorEl.value,
                startDate: startDate,
                endDate: endDate || null,
                // 保持向后兼容
                archived: statusEl.value === 'archived',
                updatedTime: new Date().toISOString(),
            };

            if (!existingProject) {
                project.createdTime = project.updatedTime;
                project.sort = 0;
            }

            projectData[projectId] = project;
            await this.plugin.saveProjectData(projectData);

            // 触发更新事件，包含项目ID
            window.dispatchEvent(new CustomEvent('projectUpdated', {
                detail: { projectId, project }
            }));

            showMessage(i18n("reminderSaved") || "项目保存成功");
            this.dialog.destroy();

        } catch (error) {
            console.error('保存项目失败:', error);
            showMessage(i18n("saveReminderFailed") || "保存项目失败");
        }
    }
}
