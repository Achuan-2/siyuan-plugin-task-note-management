import { Dialog, showMessage } from "siyuan";
import { readProjectData, writeProjectData, getBlockByID } from "../api";
import { getLogicalDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { StatusManager } from "../utils/statusManager";
import { t } from "../utils/i18n";

export class ProjectDialog {
    private dialog: Dialog;
    private blockId: string;
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
            const projectData = await readProjectData();
            const existingProject = this.blockId ? projectData[this.blockId] : undefined;

            if (this.blockId && !existingProject) {
                // Block being converted to project
                const block = await getBlockByID(this.blockId);
                if (!block) {
                    showMessage(t("cannotGetDocumentId"));
                    return;
                }
                blockContent = block.content;
            }

            this.dialog = new Dialog({
                title: existingProject ? (t("edit") + t("projectNote")) : (this.blockId ? (t("setAsProjectNote") || "设置为项目笔记") : (t("createProject") || "创建项目")),
                content: this.generateDialogHTML(existingProject?.title || blockContent, existingProject),
                width: "500px",
                height: "630px"
            });

            this.bindEvents();
            await this.statusManager.initialize();
        } catch (error) {
            console.error('显示项目对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }

    private generateDialogHTML(title: string, existingProject?: any): string {
        const today = getLogicalDateString();
        const categories = this.categoryManager.getCategories();
        const statuses = this.statusManager.getStatuses();

        const categoryOptions = categories.map(cat =>
            `<option value="${cat.id}" ${existingProject?.categoryId === cat.id ? 'selected' : ''}>${cat.icon ? cat.icon + ' ' : ''}${cat.name}</option>`
        ).join('');

        const statusOptions = statuses.map(status =>
            `<option value="${status.id}" ${existingProject?.status === status.id ? 'selected' : ''}>${status.icon ? status.icon + ' ' : ''}${status.name}</option>`
        ).join('');

        return `
            <div class="project-dialog">
                <div class="b3-dialog__content">
                    <div class="form-group">
                        <label>${t("eventName") || "项目名称"}:</label>
                        <input type="text" id="projectTitle" class="b3-text-field" style="width: 100%;" value="${existingProject?.title || title}" placeholder="${t("pleaseEnterTitle") || "输入项目名称"}">
                    </div>
                    
                    <div class="form-group">
                        <label>${t("note") || "项目描述"}:</label>
                        <textarea id="projectNote" class="b3-text-field" rows="3" style="width: 100%;" placeholder="${t("enterReminderNote") || "输入项目描述"}">${existingProject?.note || ''}</textarea>
                    </div>
                    
                    <!-- 绑定块/文档输入，允许手动输入块 ID 或文档 ID -->
                    <div class="form-group">
                        <label>${t("bindToBlock") || '块或文档 ID'}:</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="projectBlockInput" class="b3-text-field" value="${existingProject?.blockId || this.blockId || ''}" placeholder="${t("enterBlockId") || '请输入块或文档 ID'}" style="flex: 1;">
                            <button type="button" id="projectPasteBlockRefBtn" class="b3-button b3-button--outline" title="${t("pasteBlockRef")}">
                                <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("projectStatus") || "项目状态"}:</label>
                        <select id="projectStatus" class="b3-select">
                            ${statusOptions}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("priority") || "优先级"}:</label>
                        <select id="projectPriority" class="b3-select">
                            <option value="none" ${(!existingProject?.priority || existingProject?.priority === 'none') ? 'selected' : ''}>${t("noPriority") || "无"}</option>
                            <option value="low" ${existingProject?.priority === 'low' ? 'selected' : ''}>${t("lowPriority") || "低"}</option>
                            <option value="medium" ${existingProject?.priority === 'medium' ? 'selected' : ''}>${t("mediumPriority") || "中"}</option>
                            <option value="high" ${existingProject?.priority === 'high' ? 'selected' : ''}>${t("highPriority") || "高"}</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("category") || "分类"}:</label>
                        <select id="projectCategory" class="b3-select">
                            <option value="" ${!existingProject?.categoryId ? 'selected' : ''}>${t("noCategory") || "无分类"}</option>
                            ${categoryOptions}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("projectColor") || "项目颜色"}:</label>
                        <input type="color" id="projectColor" class="b3-text-field" value="${existingProject?.color || '#3498db'}" style="width: 100%; height: 40px; cursor: pointer;">
                    </div>
                    
                    <div class="form-group">
                        <label>${t("startDate") || "开始日期"}:</label>
                        <input type="date" id="projectStartDate" class="b3-text-field" value="${existingProject?.startDate || today}" max="9999-12-31">
                    </div>
                    
                    <div class="form-group">
                        <label>${t("endDate") || "截止日期"}:</label>
                        <input type="date" id="projectEndDate" class="b3-text-field" value="${existingProject?.endDate || ''}" max="9999-12-31">
                    </div>
                </div>
                
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${t("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--text" id="saveBtn">${t("save") || "保存"}</button>
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
        const saveBtn = this.dialog.element.querySelector('#saveBtn') as HTMLButtonElement;
        const cancelBtn = this.dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const pasteBlockRefBtn = this.dialog.element.querySelector('#projectPasteBlockRefBtn') as HTMLButtonElement;
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
                showMessage(t("pasteBlockRefFailed") || "粘贴失败");
            }
        });

        // 回车键保存
        this.dialog.element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.saveProject();
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
            const categoryEl = this.dialog.element.querySelector('#projectCategory') as HTMLSelectElement;
            const colorEl = this.dialog.element.querySelector('#projectColor') as HTMLInputElement;
            const startDateEl = this.dialog.element.querySelector('#projectStartDate') as HTMLInputElement;
            const endDateEl = this.dialog.element.querySelector('#projectEndDate') as HTMLInputElement;

            const title = titleEl.value.trim();
            if (!title) {
                showMessage(t("pleaseEnterTitle"));
                titleEl.focus();
                return;
            }

            const startDate = startDateEl.value;
            const endDate = endDateEl.value;

            // 验证日期
            if (endDate && startDate && endDate < startDate) {
                showMessage(t("endDateCannotBeEarlier"));
                endDateEl.focus();
                return;
            }

            const projectData = await readProjectData();
            const projectId = this.blockId || `quick_${Date.now()}`;
            const existingProject = this.blockId ? projectData[this.blockId] : null;

            // 获取块ID输入框的值
            const blockInputEl = this.dialog.element.querySelector('#projectBlockInput') as HTMLInputElement;
            const rawBlockVal = blockInputEl?.value?.trim() || '';
            const inputBlockId = rawBlockVal ? (this.extractBlockId(rawBlockVal) || rawBlockVal) : null;

            const project = {
                id: projectId,
                blockId: inputBlockId || null,
                title: title,
                note: noteEl.value.trim(),
                status: statusEl.value,
                priority: priorityEl.value,
                categoryId: categoryEl.value || null,
                color: colorEl.value,
                startDate: startDate,
                endDate: endDate || null,
                // 保持向后兼容
                archived: statusEl.value === 'archived',
                createdTime: existingProject?.createdTime || new Date().toISOString(),
                updatedTime: new Date().toISOString(),
                sort: existingProject?.sort || 0,
                // 保留现有的看板模式和自定义分组
                kanbanMode: existingProject?.kanbanMode,
                customGroups: existingProject?.customGroups
            };

            projectData[projectId] = project;
            await writeProjectData(projectData);

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('projectUpdated'));

            showMessage(t("reminderSaved") || "项目保存成功");
            this.dialog.destroy();

        } catch (error) {
            console.error('保存项目失败:', error);
            showMessage(t("saveReminderFailed") || "保存项目失败");
        }
    }
}
