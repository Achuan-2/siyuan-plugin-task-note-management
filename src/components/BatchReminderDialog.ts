import { Dialog, showMessage } from "siyuan";
import { i18n } from "../pluginInstance";
import { updateBindBlockAtrrs, getBlockByID } from "../api";
import { getRepeatDescription } from "../utils/repeatUtils";
import { getLogicalDateString, parseNaturalDateTime, autoDetectDateTimeFromTitle, getLocaleTag } from "../utils/dateUtils";
import { RepeatConfig, RepeatSettingsDialog } from "./RepeatSettingsDialog";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import LoadingDialog from './LoadingDialog.svelte';

export interface BlockDetail {
    blockId: string;
    content: string;
    docId?: string;
    date?: string;
    time?: string;
    hasTime?: boolean;
    cleanTitle?: string;
    selectedDate?: string;
    selectedTime?: string;
    priority?: string;
    categoryId?: string;
    note?: string;
}

export interface AutoDetectResult {
    blockId: string;
    content: string;
    note?: string;
    date?: string;
    time?: string;
    hasTime?: boolean;
    endDate?: string;
    endTime?: string;
    hasEndTime?: boolean;
    cleanTitle?: string;
}

export class BatchReminderDialog {
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }




    async show(blockIds: string[], defaultSettings?: {
        defaultProjectId?: string;
        defaultCustomGroupId?: string;
        defaultMilestoneId?: string;
    }) {
        if (blockIds.length === 1) {
            const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                blockId: blockIds[0],
                mode: 'block',
                plugin: this.plugin,
                ...defaultSettings
            });
            dialog.show();
        } else {
            // 直接显示智能批量设置
            this.showSmartBatchDialog(blockIds, defaultSettings);
        }
    }

    private async showSmartBatchDialog(blockIds: string[], defaultSettings?: any) {
        const autoDetectedData = await this.autoDetectBatchDateTime(blockIds);
        const smartBatchDialog = new SmartBatchDialog(this.plugin, blockIds, autoDetectedData, defaultSettings);
        smartBatchDialog.show();
    }

    async autoDetectBatchDateTime(blockIds: string[]): Promise<AutoDetectResult[]> {
        const results = [];
        const { sql, getBlockByID } = await import("../api");

        // 合并查询：一次性获取所有选中块的记录
        try {
            const idsList = blockIds.map(id => `'${id}'`).join(',');
            const blocks = await sql(`select * from blocks where id in (${idsList})`);
            const blockMap: Record<string, any> = {};
            (blocks || []).forEach((b: any) => { blockMap[b.id] = b; });

            // 合并查询子块：一次性获取 parent_id 在选中范围内的子块，用于跳过被包含的子块
            const children = await sql(`select id, parent_id from blocks where parent_id in (${idsList})`);
            const blocksToSkip = new Set<string>();
            (children || []).forEach((c: any) => {
                if (blockIds.includes(c.id)) {
                    blocksToSkip.add(c.id);
                }
            });

            // 处理每个块（避免使用 exportMdContent）
            for (const blockId of blockIds) {
                if (blocksToSkip.has(blockId)) continue;

                try {
                    let block = blockMap[blockId];
                    if (!block) {
                        // 兜底：单独获取
                        block = await getBlockByID(blockId);
                    }

                    if (block) {
                        // 根据块类型选择标题来源：
                        // - 列表与任务项优先使用 fcontent（渲染后的单行内容）
                        // - 其他块使用 content（完整原始内容）
                        let exportedContent = '';
                        try {
                            const isListType = block.type === 'l' || block.type === 'i';
                            if (isListType) {
                                exportedContent = (block.fcontent || block.content || '').toString();
                            } else {
                                exportedContent = (block.content || '').toString();
                            }
                        } catch (e) {
                            exportedContent = (block.content || '').toString();
                        }

                        let content = '';
                        let note = '';

                        if (exportedContent) {
                            const originalLines = exportedContent.split('\n');
                            const lines = originalLines.map((line: string) => line.trim()).filter((line: string) => line.length > 0);
                            if (lines.length > 0) {
                                const firstLine = lines[0];
                                if (firstLine.startsWith('#')) {
                                    content = firstLine.replace(/^#+\s*/, '').trim();
                                } else {
                                    content = firstLine
                                        .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
                                        .replace(/^[-*+]\s+/, '')
                                        .replace(/^\d+\.\s+/, '')
                                        .trim();
                                }

                                const firstLineIndex = originalLines.findIndex((line: string) => line.trim() === firstLine);
                                if (firstLineIndex >= 0 && firstLineIndex < originalLines.length - 1) {
                                    note = originalLines.slice(firstLineIndex + 1).join('\n').trim();
                                }
                            }
                        }

                        const removeMode = await this.plugin.getRemoveDateAfterDetectionMode();
                        const titleAuto = autoDetectDateTimeFromTitle(content, removeMode);

                        let date = titleAuto.date;
                        let time = titleAuto.time;
                        let hasTime = titleAuto.hasTime;
                        if (!date) {
                            const contentAuto = autoDetectDateTimeFromTitle(note, removeMode);
                            date = contentAuto.date;
                            time = contentAuto.time;
                            hasTime = contentAuto.hasTime;
                        }

                        const cleanTitle = titleAuto.cleanTitle || content;

                        results.push({
                            blockId,
                            content: content,
                            note: note,
                            date,
                            time,
                            hasTime,
                            endDate: titleAuto.endDate,
                            endTime: titleAuto.endTime,
                            hasEndTime: titleAuto.hasEndTime,
                            cleanTitle: cleanTitle
                        } as AutoDetectResult);
                    }
                } catch (error) {
                    console.error(`获取块 ${blockId} 失败:`, error);
                    results.push({
                        blockId,
                        content: '无法获取块内容',
                        cleanTitle: '无法获取块内容'
                    } as AutoDetectResult);
                }
            }

            return results;
        } catch (err) {
            console.error('批量识别块内容失败:', err);
            // 回退到逐个处理（兼容性保守策略）
            const { getBlockByID } = await import("../api");
            for (const blockId of blockIds) {
                try {
                    const block = await getBlockByID(blockId);
                    results.push({ blockId, content: block?.content || '', cleanTitle: block?.content || '' } as AutoDetectResult);
                } catch (error) {
                    results.push({ blockId, content: '无法获取块内容', cleanTitle: '无法获取块内容' } as AutoDetectResult);
                }
            }
            return results;
        }
    }




}

class SmartBatchDialog {
    private plugin: any;
    private blockIds: string[];
    private autoDetectedData: AutoDetectResult[];
    private blockSettings: Map<string, BlockSetting> = new Map();
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private defaultSettings?: any;

    constructor(plugin: any, blockIds: string[], autoDetectedData: AutoDetectResult[], defaultSettings?: any) {
        this.plugin = plugin;
        this.blockIds = blockIds;
        this.autoDetectedData = autoDetectedData;
        this.defaultSettings = defaultSettings;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);


    }

    private async initializeBlockSettings() {
        for (const data of this.autoDetectedData) {
            let projectId = this.defaultSettings?.defaultProjectId || '';
            let customGroupId = this.defaultSettings?.defaultCustomGroupId || '';
            let milestoneId = this.defaultSettings?.defaultMilestoneId || '';
            let categoryId = this.defaultSettings?.defaultCategoryId || '';
            try {
                const inherit = await (this.plugin as any).getInheritedProjectAndGroup(data.blockId);
                if (inherit) {
                    if (inherit.projectId) projectId = inherit.projectId;
                    if (inherit.groupId) customGroupId = inherit.groupId;
                    if (inherit.milestoneId) milestoneId = inherit.milestoneId;
                    if (inherit.categoryId) categoryId = inherit.categoryId;
                }
            } catch (err) {
                // ignore
            }

            this.blockSettings.set(data.blockId, {
                blockId: data.blockId,
                content: data.content,
                cleanTitle: data.cleanTitle || data.content,
                date: data.date || getLogicalDateString(),
                time: data.time || '',
                hasTime: data.hasTime || false,
                endDate: data.endDate || '',
                endTime: data.endTime || '',
                hasEndTime: data.hasEndTime || false,
                priority: 'none',
                categoryId: categoryId || '',
                projectId: projectId || '',
                customGroupId: customGroupId || '',
                milestoneId: milestoneId || '',
                note: data.note || '',
                repeatConfig: {
                    enabled: false,
                    type: 'daily',
                    interval: 1,
                    endType: 'never'
                }
            });
        }
    }

    async show() {
        // 初始化分类管理器和项目管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize();
        // 初始化每个块的设置并应用继承的项目/分组/里程碑/分类
        await this.initializeBlockSettings();

        const dialog = new Dialog({
            title: i18n("smartBatchTitle", { count: this.blockIds.length.toString() }),
            content: this.buildSmartBatchContent(),
            width: "700px",
            height: "81vh"
        });

        await this.renderBlockList(dialog);
        // 绑定块列表相关事件，确保编辑按钮在初次渲染后可用
        this.bindBlockListEvents(dialog);
        await this.renderBatchProjectSelector(dialog);
        this.bindSmartBatchEvents(dialog);
    }

    private buildSmartBatchContent(): string {
        return `
            <div class="smart-batch-dialog">
                <div class="b3-dialog__content">
                    <div class="fn__hr"></div>
                    
                    <!-- 批量操作面板 -->
                    <div class="batch-operations-panel">
                        <div class="batch-operations-header">
                            <h3>${i18n("batchOperations")}</h3>
                            <div class="batch-toggle">
                                <button type="button" id="batchToggleBtn" class="b3-button b3-button--outline">
                                    <span>${i18n("expand")}</span>
                                    <svg class="b3-button__icon toggle-icon"><use xlink:href="#iconDown"></use></svg>
                                </button>
                            </div>
                        </div>
                        <div class="batch-operations-content" id="batchOperationsContent" style="display: none;">
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${i18n("batchSetDate")}</label>
                                    <div class="batch-date-container">
                                        <input type="date" id="batchDateInput" class="b3-text-field" value="${getLogicalDateString()}" max="9999-12-31">
                                        <button type="button" id="batchApplyDateBtn" class="b3-button b3-button--primary">
                                            ${i18n("applyDateToAll")}
                                        </button>
                                        <button type="button" id="batchNlDateBtn" class="b3-button b3-button--outline" title="${i18n('smartDateRecognition')}">
                                            ✨
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${i18n("batchSetCategory")}</label>
                                    <div class="batch-category-container">
                                        <div class="category-selector-compact" id="batchCategorySelector">
                                            <!-- 分类选择器将在这里渲染 -->
                                        </div>
                                        <button type="button" id="batchApplyCategoryBtn" class="b3-button b3-button--primary" disabled>
                                            ${i18n("applyToAll")}
                                        </button>
                                    </div>
                                </div>
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${i18n("batchSetPriority")}</label>
                                    <div class="batch-priority-container">
                                        <div class="priority-selector-compact" id="batchPrioritySelector">
                                            <div class="priority-option-compact" data-priority="high">
                                                <div class="priority-dot high"></div>
                                                <span>${i18n("highPriority")}</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="medium">
                                                <div class="priority-dot medium"></div>
                                                <span>${i18n("mediumPriority")}</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="low">
                                                <div class="priority-dot low"></div>
                                                <span>${i18n("lowPriority")}</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="none">
                                                <div class="priority-dot none"></div>
                                                <span>${i18n("noPriority")}</span>
                                            </div>
                                        </div>
                                        <button type="button" id="batchApplyPriorityBtn" class="b3-button b3-button--primary" disabled>
                                            ${i18n("applyToAll")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${i18n("batchSetProject")}</label>
                                    <div class="batch-project-container" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0;">
                                        <div style="flex:1 1 100%; display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap;">
                                            <select id="batchProjectSelector" class="b3-select" style="flex: 1 1 200px; min-width:120px;">
                                                <option value="">${i18n("noProject")}</option>
                                                <!-- 项目选择器将在这里渲染 -->
                                            </select>
                                            <select id="batchGroupSelector" class="b3-select" style="flex: 0 1 160px; min-width:120px; display:none;">
                                                <option value="">${i18n("noGroup") || '无分组'}</option>
                                            </select>
                                            <select id="batchMilestoneSelector" class="b3-select" style="flex: 0 1 200px; min-width:120px; display:none;">
                                                <option value="">${i18n("noMilestone") || '无里程碑'}</option>
                                            </select>
                                        </div>
                                        <div style="margin-left:auto; flex:0 0 auto;">
                                            <button type="button" id="batchApplyProjectBtn" class="b3-button b3-button--primary" disabled>
                                                ${i18n("applyToAll")}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${i18n("batchSetStatus") || '批量设置状态'}</label>
                                    <div class="batch-status-container">
                                        <select id="batchStatusSelector" class="b3-select" style="flex: 1; display:none; min-width:200px;">
                                            <option value="">${i18n("selectStatus") || '选择状态'}</option>
                                        </select>
                                        <button type="button" id="batchApplyStatusBtn" class="b3-button b3-button--primary" disabled style="margin-left:6px; display:none;">
                                            ${i18n("applyToAll") || '应用状态'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="fn__hr"></div>
                    
                    <div class="block-list-header">
                        <div class="list-summary">
                            <span class="summary-text">${i18n("totalBlocks", { count: this.blockIds.length.toString(), detected: this.autoDetectedData.filter(d => d.date).length.toString() })}</span>
                        </div>
                        <div class="list-actions">
                            <button type="button" id="selectAllBtn" class="b3-button b3-button--outline">
                                ${i18n("selectAll")}
                            </button>
                            <button type="button" id="deselectAllBtn" class="b3-button b3-button--outline">
                                ${i18n("deselectAll")}
                            </button>
                        </div>
                    </div>
                    <div class="block-list-container" id="blockListContainer">
                        <!-- 块列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="smartBatchCancelBtn">${i18n("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="smartBatchConfirmBtn">${i18n("batchSetReminders")}</button>
                </div>
            </div>
        `;
    }

    private async renderBlockList(dialog: Dialog) {
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;
        if (!container) return;

        const listHtml = await Promise.all(this.autoDetectedData.map(async data => {
            const setting = this.blockSettings.get(data.blockId);
            const dateStatus = data.date ? '✅' : '❌';
            const dateDisplay = setting?.date ? new Date(setting.date + 'T00:00:00').toLocaleDateString(getLocaleTag()) : '未设置';
            const timeDisplay = setting?.hasTime && setting.time ? setting.time : '全天';

            // 获取分类、优先级和项目显示
            const categoryDisplay = this.getCategoryDisplay(setting?.categoryId);
            const priorityDisplay = this.getPriorityDisplay(setting?.priority);
            const projectDisplay = await this.getProjectDisplay(setting?.projectId, setting?.customGroupId);

            const milestoneDisplay = setting?.milestoneId ? await this.getMilestoneDisplay(setting.projectId, setting.milestoneId) : '';

            // 获取状态显示
            let statusDisplay = '';
            if (setting?.kanbanStatus && setting.projectId) {
                try {
                    const statuses = await this.projectManager.getProjectKanbanStatuses(setting.projectId);
                    const status = statuses.find(s => s.id === setting.kanbanStatus);
                    if (status) {
                        const color = status.color || '#666';
                        statusDisplay = `<span class="status-badge"><span class="status-dot" style="background-color: ${color};"></span><span>${status.name}</span></span>`;
                    }
                } catch (error) {
                    console.error('获取状态失败:', error);
                }
            }

            return `
                <div class="block-item" data-block-id="${data.blockId}">
                    <div class="block-checkbox">
                        <label class="b3-checkbox">
                            <input type="checkbox" class="block-select-checkbox" data-block-id="${data.blockId}" checked>
                            <span class="b3-checkbox__graphic"></span>
                        </label>
                    </div>
                    <div class="block-info">
                        <div class="block-status">${dateStatus}</div>
                        <div class="block-content">
                            <div class="block-title">${setting?.cleanTitle || data.content}</div>
                            <div class="block-meta">
                                <div class="block-datetime">
                                    <span class="block-date">${dateDisplay}${setting?.endDate ? ` ➡️ ${new Date(setting.endDate + 'T00:00:00').toLocaleDateString(getLocaleTag())}` : ''}</span>
                                    <span class="block-time">${timeDisplay}${setting?.hasEndTime && setting?.endTime ? ` - ${setting.endTime}` : ''}</span>
                                </div>
                                <div class="block-attributes">
                                    <span class="block-category">${categoryDisplay}</span>
                                    <span class="block-priority">${priorityDisplay}</span>
                                </div>
                                <div class="block-project-status">
                                    <span class="block-project">${projectDisplay}</span>
                                    <span class="block-status">${statusDisplay}</span>
                                    <span class="block-milestone">${milestoneDisplay}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="block-actions">
                        <button type="button" class="b3-button b3-button--outline block-edit-btn" data-block-id="${data.blockId}">
                            ⚙️  ${i18n("edit")}
                        </button>
                    </div>
                </div>
            `;
        }));

        container.innerHTML = `
            <div class="block-list">
                ${listHtml.join('')}
            </div>
        `;
    }

    private getCategoryDisplay(categoryId?: string): string {
        if (!categoryId) return `🏷️ ${i18n("noCategory")}`;

        try {
            const categoryIds = categoryId.split(',');
            const categories = this.plugin.categoryManager.getCategories();

            const badges = categoryIds.map(id => {
                const category = categories.find(c => c.id === id);
                if (category) {
                    return `<span style="background-color: ${category.color}20; border: 1px solid ${category.color}40; color: ${category.color}; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: 2px; display: inline-flex; align-items: center;">${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                }
                return '';
            }).filter(Boolean);

            if (badges.length > 0) {
                return badges.join('');
            }
        } catch (error) {
            console.error('获取分类显示失败:', error);
        }

        return `🏷️ ${i18n("noCategory")}`;
    }

    private getPriorityDisplay(priority?: string): string {
        const priorityMap = {
            'high': `<span class="priority-badge high">🔴 ${i18n("highPriority")}</span>`,
            'medium': `<span class="priority-badge medium">🟡 ${i18n("mediumPriority")}</span>`,
            'low': `<span class="priority-badge low">🔵 ${i18n("lowPriority")}</span>`,
            'none': `<span class="priority-badge none">⚪ ${i18n("noPriority")}</span>`
        };

        return priorityMap[priority as keyof typeof priorityMap] || priorityMap.none;
    }

    private async getProjectDisplay(projectId?: string, groupId?: string): Promise<string> {
        if (!projectId) return `📂 ${i18n("noProject")}`;

        try {
            const project = this.projectManager.getProjectById(projectId);
            if (project) {
                let text = `📂 ${project.name}`;
                if (groupId) {
                    try {
                        const groups = await this.projectManager.getProjectCustomGroups(projectId);
                        const g = groups.find(gr => gr.id === groupId);
                        if (g) text += ` / ${g.name}`;
                    } catch (err) {
                        // ignore group name failure
                    }
                }
                return `<span class="project-badge" style="background-color: ${project.color || '#E0E0E0'}; padding: 2px 6px; border-radius: 3px; font-size: 12px;">${text}</span>`;
            }
        } catch (error) {
            console.error('获取项目显示失败:', error);
        }

        return `📂 ${i18n("noProject")}`;
    }


    private async getMilestoneDisplay(projectId?: string, milestoneId?: string): Promise<string> {
        if (!projectId || !milestoneId) return '';
        try {
            const m = await this.projectManager.getMilestoneById(projectId, milestoneId);
            if (m) {
                return `<span class="milestone-badge" style="background-color: #f0f6ff; padding: 2px 6px; border-radius:3px; margin-left:6px; font-size:11px;">🏁 ${m.name}</span>`;
            }
        } catch (err) {
            console.warn('获取里程碑显示失败:', err);
        }
        return '';
    }

    private bindSmartBatchEvents(dialog: Dialog) {
        const cancelBtn = dialog.element.querySelector('#smartBatchCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#smartBatchConfirmBtn') as HTMLButtonElement;
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;

        // 批量操作相关元素
        const batchToggleBtn = dialog.element.querySelector('#batchToggleBtn') as HTMLButtonElement;
        const batchOperationsContent = dialog.element.querySelector('#batchOperationsContent') as HTMLElement;
        const batchApplyCategoryBtn = dialog.element.querySelector('#batchApplyCategoryBtn') as HTMLButtonElement;
        const batchApplyPriorityBtn = dialog.element.querySelector('#batchApplyPriorityBtn') as HTMLButtonElement;
        const batchApplyProjectBtn = dialog.element.querySelector('#batchApplyProjectBtn') as HTMLButtonElement;
        const batchApplyDateBtn = dialog.element.querySelector('#batchApplyDateBtn') as HTMLButtonElement;
        const batchNlDateBtn = dialog.element.querySelector('#batchNlDateBtn') as HTMLButtonElement;
        const selectAllBtn = dialog.element.querySelector('#selectAllBtn') as HTMLButtonElement;
        const deselectAllBtn = dialog.element.querySelector('#deselectAllBtn') as HTMLButtonElement;

        // 渲染批量分类选择器
        this.renderBatchCategorySelector(dialog);

        // 批量操作面板切换
        batchToggleBtn?.addEventListener('click', () => {
            const isVisible = batchOperationsContent.style.display !== 'none';
            batchOperationsContent.style.display = isVisible ? 'none' : 'block';
            const toggleIcon = batchToggleBtn.querySelector('.toggle-icon use');
            const toggleText = batchToggleBtn.querySelector('span');
            if (toggleIcon && toggleText) {
                toggleIcon.setAttribute('xlink:href', isVisible ? '#iconDown' : '#iconUp');
                toggleText.textContent = isVisible ? i18n("expand") : i18n("collapse");
            }
        });

        // 全选/取消全选
        selectAllBtn?.addEventListener('click', () => {
            const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(checkbox => checkbox.checked = true);
        });

        deselectAllBtn?.addEventListener('click', () => {
            const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(checkbox => checkbox.checked = false);
        });

        // 批量分类选择（支持多选）
        const batchCategorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        batchCategorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option-compact') as HTMLElement;
            if (option) {
                const categoryId = option.getAttribute('data-category');

                if (!categoryId) {
                    // 如果选择了“无分类”，清空其他选中项
                    batchCategorySelector.querySelectorAll('.category-option-compact').forEach(opt => opt.classList.remove('selected'));
                    option.classList.add('selected');
                } else {
                    // 如果选择了具体分类
                    // 先取消“无分类”的选中状态
                    const noCatOption = batchCategorySelector.querySelector('.category-option-compact[data-category=""]');
                    if (noCatOption) noCatOption.classList.remove('selected');

                    // 切换当前项选中状态
                    if (option.classList.contains('selected')) {
                        option.classList.remove('selected');
                    } else {
                        option.classList.add('selected');
                    }
                }
                batchApplyCategoryBtn.disabled = false;
            }
        });

        // 批量优先级选择
        const batchPrioritySelector = dialog.element.querySelector('#batchPrioritySelector') as HTMLElement;
        batchPrioritySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option-compact') as HTMLElement;
            if (option) {
                batchPrioritySelector.querySelectorAll('.priority-option-compact').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                batchApplyPriorityBtn.disabled = false;
            }
        });

        // 批量应用分类
        batchApplyCategoryBtn?.addEventListener('click', () => {
            this.batchApplyCategory(dialog);
        });

        // 批量应用优先级
        batchApplyPriorityBtn?.addEventListener('click', () => {
            this.batchApplyPriority(dialog);
        });

        // 批量项目选择
        const batchProjectSelector = dialog.element.querySelector('#batchProjectSelector') as HTMLSelectElement;
        const batchStatusSelector = dialog.element.querySelector('#batchStatusSelector') as HTMLSelectElement;
        const batchApplyStatusBtn = dialog.element.querySelector('#batchApplyStatusBtn') as HTMLButtonElement;
        batchProjectSelector?.addEventListener('change', async () => {
            batchApplyProjectBtn.disabled = false;
            const projectId = batchProjectSelector.value;
            // reset status selector
            if (batchStatusSelector) {
                batchStatusSelector.style.display = 'none';
                batchStatusSelector.innerHTML = `<option value="">${i18n("selectStatus") || '选择状态'}</option>`;
            }
            if (batchApplyStatusBtn) {
                batchApplyStatusBtn.style.display = 'none';
                batchApplyStatusBtn.disabled = true;
            }
            // reset group/milestone selectors
            const batchGroupSelector = dialog.element.querySelector('#batchGroupSelector') as HTMLSelectElement;
            const batchMilestoneSelector = dialog.element.querySelector('#batchMilestoneSelector') as HTMLSelectElement;
            if (batchGroupSelector) {
                batchGroupSelector.style.display = 'none';
                batchGroupSelector.innerHTML = `<option value="">${i18n("noGroup") || '无分组'}</option>`;
            }
            if (batchMilestoneSelector) {
                batchMilestoneSelector.style.display = 'none';
                batchMilestoneSelector.innerHTML = `<option value="">${i18n("noMilestone") || '无里程碑'}</option>`;
            }

            if (!projectId) return;
            try {
                // 加载状态
                const statuses = await this.projectManager.getProjectKanbanStatuses(projectId);
                if (statuses && statuses.length > 0 && batchStatusSelector) {
                    statuses
                        .filter(s => s.id !== 'completed')
                        .forEach(s => {
                            const opt = document.createElement('option');
                            opt.value = s.id;
                            opt.text = `${s.icon || ''} ${s.name || s.id}`;
                            batchStatusSelector.appendChild(opt);
                        });
                    if (batchStatusSelector.options.length > 1) {
                        // 状态选择器将显示在单独一行，由 render 中的 UI 布局控制
                        batchStatusSelector.style.display = '';
                        if (batchApplyStatusBtn) {
                            batchApplyStatusBtn.style.display = '';
                            batchApplyStatusBtn.disabled = false;
                        }
                    }
                }

                // 加载自定义分组
                try {
                    const groups = await this.projectManager.getProjectCustomGroups(projectId);
                    if (groups && groups.length > 0 && batchGroupSelector) {
                        groups.forEach(g => {
                            const opt = document.createElement('option');
                            opt.value = g.id;
                            opt.text = g.name || g.id;
                            batchGroupSelector.appendChild(opt);
                        });
                        batchGroupSelector.style.display = '';
                    }
                } catch (err) {
                    console.warn('加载项目自定义分组失败:', err);
                }

                // 加载项目级里程碑（过滤掉已归档的）
                try {
                    const milestones = await this.projectManager.getProjectMilestones(projectId) || [];
                    const activeMilestones = milestones.filter(m => !m.archived);
                    if (activeMilestones.length > 0 && batchMilestoneSelector) {
                        activeMilestones.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m.id;
                            opt.text = m.name || m.id;
                            batchMilestoneSelector.appendChild(opt);
                        });
                        batchMilestoneSelector.style.display = '';
                    }
                } catch (err) {
                    console.warn('加载项目里程碑失败:', err);
                }

                // 当选择某个分组时加载该分组下的里程碑（如果有）
                if (batchGroupSelector) {
                    batchGroupSelector.addEventListener('change', async () => {
                        const gid = batchGroupSelector.value;
                        if (!gid) return;
                        try {
                            const groupMilestones = await this.projectManager.getGroupMilestones(projectId, gid);
                            if (groupMilestones && groupMilestones.length > 0 && batchMilestoneSelector) {
                                // 清空并添加分组里程碑（过滤掉已归档）
                                batchMilestoneSelector.innerHTML = `<option value="">${i18n("noMilestone") || '无里程碑'}</option>`;
                                groupMilestones.filter(m => !m.archived).forEach(m => {
                                    const opt = document.createElement('option');
                                    opt.value = m.id;
                                    opt.text = m.name || m.id;
                                    batchMilestoneSelector.appendChild(opt);
                                });
                                batchMilestoneSelector.style.display = '';
                            }
                        } catch (err) {
                            console.warn('加载分组里程碑失败:', err);
                        }
                    });
                }

            } catch (error) {
                console.error('加载项目状态/分组/里程碑失败:', error);
            }
        });

        // 批量应用状态
        batchApplyStatusBtn?.addEventListener('click', () => {
            const statusId = batchStatusSelector?.value || '';
            const projectId = batchProjectSelector?.value || '';
            if (!statusId || !projectId) return;
            const selectedBlocks = this.getSelectedBlockIds(dialog);
            if (selectedBlocks.length === 0) {
                showMessage(i18n("pleaseSelectBlocks"));
                return;
            }
            selectedBlocks.forEach(blockId => {
                const setting = this.blockSettings.get(blockId);
                if (setting) {
                    setting.projectId = projectId;
                    setting.kanbanStatus = statusId;
                }
            });
            this.updateBlockListDisplay(dialog);
            showMessage(i18n("settingsApplied"));
            // disable until next selection
            if (batchApplyStatusBtn) batchApplyStatusBtn.disabled = true;
        });

        // 状态选择器改变时重新启用应用按钮
        batchStatusSelector?.addEventListener('change', () => {
            if (batchApplyStatusBtn && batchStatusSelector?.value) {
                batchApplyStatusBtn.disabled = false;
            }
        });

        // 批量应用项目
        batchApplyProjectBtn?.addEventListener('click', () => {
            this.batchApplyProject(dialog);
        });

        // 批量应用日期
        batchApplyDateBtn?.addEventListener('click', () => {
            this.batchApplyDate(dialog);
        });

        // 批量智能日期识别
        batchNlDateBtn?.addEventListener('click', () => {
            this.showBatchNaturalLanguageDialog(dialog);
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });

        // 确认按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveBatchReminders(dialog);
        });

        // 设置按钮事件（已移至 bindBlockListEvents，避免重复绑定）
    }
    private showBatchNaturalLanguageDialog(dialog: Dialog) {
        const nlDialog = new Dialog({
            title: i18n("smartDateRecognitionDialog"),
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("inputNaturalLanguage")}</label>
                            <input type="text" id="batchNlInput" class="b3-text-field" placeholder="${i18n('exampleInputs')}" style="width: 100%;" autofocus>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("recognitionPreview")}</label>
                            <div id="batchNlPreview" class="nl-preview">${i18n("pleaseInputDescription")}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("applyScope")}</label>
                            <div id="batchNlScope" class="nl-scope">${i18n("applyToSelected")}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchNlCancelBtn">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="batchNlConfirmBtn" disabled>${i18n("batchApply")}</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "350px"
        });

        this.bindBatchNaturalLanguageEvents(nlDialog, dialog);
    }
    private bindBatchNaturalLanguageEvents(nlDialog: Dialog, parentDialog: Dialog) {
        const nlInput = nlDialog.element.querySelector('#batchNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#batchNlPreview') as HTMLElement;
        const nlScope = nlDialog.element.querySelector('#batchNlScope') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#batchNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#batchNlConfirmBtn') as HTMLButtonElement;

        const selectedCount = this.getSelectedBlockIds(parentDialog).length;
        nlScope.textContent = i18n("applyToSelectedBlocks", { count: selectedCount.toString() });

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean; endDate?: string; endTime?: string; hasEndTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = i18n("pleaseInputDescription");
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            currentParseResult = parseNaturalDateTime(text);

            if (currentParseResult.date) {
                const dateStr = new Date(currentParseResult.date + 'T00:00:00').toLocaleDateString(getLocaleTag(), {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                });

                let previewText = `📅 ${dateStr}`;
                if (currentParseResult.time) {
                    previewText += ` ⏰ ${currentParseResult.time}`;
                }

                if (currentParseResult.endDate) {
                    const endDateStr = new Date(currentParseResult.endDate + 'T00:00:00').toLocaleDateString(getLocaleTag(), {
                        month: 'long',
                        day: 'numeric'
                    });
                    previewText += ` ➡️ 📅 ${endDateStr}`;
                    if (currentParseResult.endTime) {
                        previewText += ` ⏰ ${currentParseResult.endTime}`;
                    }
                }

                nlPreview.textContent = previewText;
                nlPreview.className = 'nl-preview nl-preview--success';
                nlConfirmBtn.disabled = selectedCount === 0;
            } else {
                nlPreview.textContent = i18n("cannotRecognize");
                nlPreview.className = 'nl-preview nl-preview--error';
                nlConfirmBtn.disabled = true;
            }
        };

        nlInput.addEventListener('input', updatePreview);
        nlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !nlConfirmBtn.disabled) {
                this.applyBatchNaturalLanguageResult(parentDialog, currentParseResult);
                nlDialog.destroy();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyBatchNaturalLanguageResult(parentDialog, currentParseResult);
            nlDialog.destroy();
        });

        setTimeout(() => {
            nlInput.focus();
        }, 100);
    }
    private applyBatchNaturalLanguageResult(dialog: Dialog, result: { date?: string; time?: string; hasTime?: boolean; endDate?: string; endTime?: string; hasEndTime?: boolean }) {
        if (!result.date) return;

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage(i18n("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.date = result.date!;
                if (result.hasTime && result.time) {
                    setting.time = result.time;
                    setting.hasTime = true;
                } else {
                    setting.time = '';
                    setting.hasTime = false;
                }

                if (result.endDate) {
                    setting.endDate = result.endDate;
                    setting.hasEndTime = result.hasEndTime || false;
                    if (result.endTime) {
                        setting.endTime = result.endTime;
                    }
                }
            }
        });

        this.updateBlockListDisplay(dialog);

        const dateStr = new Date(result.date + 'T00:00:00').toLocaleDateString(getLocaleTag());
        showMessage(i18n("dateTimeSet", {
            date: dateStr,
            time: result.time ? ` ${result.time}` : ''
        }));
    }
    private getSelectedBlockIds(dialog: Dialog): string[] {
        const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox:checked') as NodeListOf<HTMLInputElement>;
        return Array.from(checkboxes).map(checkbox => checkbox.getAttribute('data-block-id')).filter(Boolean) as string[];
    }

    private async updateBlockListDisplay(dialog: Dialog) {
        // 重新渲染块列表以反映更新
        await this.renderBlockList(dialog);
        // 重新绑定事件（只绑定块相关的事件）
        this.bindBlockListEvents(dialog);
    }

    private bindBlockListEvents(dialog: Dialog) {
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;

        if (!container) return;

        // 防止重复绑定：如果已绑定过则直接返回
        if (container.dataset.batchEventsBound === '1') return;
        container.dataset.batchEventsBound = '1';

        // 设置按钮事件（点击编辑按钮打开编辑对话框）
        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const editBtn = target.closest('.block-edit-btn') as HTMLElement;
            if (editBtn) {
                const blockId = editBtn.getAttribute('data-block-id');
                if (blockId) {
                    this.showBlockEditDialog(dialog, blockId);
                }
            }
        });
    }
    private showBlockEditDialog(parentDialog: Dialog, blockId: string) {
        const setting = this.blockSettings.get(blockId);
        if (!setting) return;

        // 创建临时的 reminder 对象用于 QuickReminderDialog
        const tempReminder = {
            id: `temp_${blockId}_${Date.now()}`,
            blockId: setting.blockId,
            content: setting.content,
            title: setting.cleanTitle,
            date: setting.date,
            time: setting.hasTime ? setting.time : undefined,
            priority: setting.priority,
            categoryId: setting.categoryId || undefined,
            projectId: setting.projectId || undefined,
            customGroupId: setting.customGroupId || undefined,
            milestoneId: setting.milestoneId || undefined,
            kanbanStatus: setting.kanbanStatus || undefined,
            note: setting.note,
            repeat: setting.repeatConfig?.enabled ? setting.repeatConfig : undefined,
            completed: false,
            pomodoroCount: 0,
            createdAt: new Date().toISOString(),
            endDate: setting.endDate,
            endTime: setting.hasEndTime ? setting.endTime : undefined,
        };

        const quickReminderDialog = new QuickReminderDialog(
            setting.date,
            setting.hasTime ? setting.time : undefined,
            (modifiedReminder) => {
                // 将修改后的 reminder 映射回 BlockSetting
                if (modifiedReminder) {
                    setting.cleanTitle = modifiedReminder.title || setting.cleanTitle;
                    setting.date = modifiedReminder.date || setting.date;
                    setting.time = modifiedReminder.time || '';
                    setting.hasTime = !!modifiedReminder.time;
                    setting.priority = modifiedReminder.priority || 'none';
                    setting.categoryId = modifiedReminder.categoryId || '';
                    setting.projectId = modifiedReminder.projectId || '';
                    setting.customGroupId = modifiedReminder.customGroupId || '';
                    setting.milestoneId = modifiedReminder.milestoneId || '';
                    setting.kanbanStatus = modifiedReminder.kanbanStatus || '';
                    setting.note = modifiedReminder.note || '';
                    setting.repeatConfig = modifiedReminder.repeat || {
                        enabled: false,
                        type: 'daily',
                        interval: 1,
                        endType: 'never'
                    };
                }
                this.updateBlockDisplay(parentDialog, blockId);
            },
            undefined, // timeRangeOptions
            {
                mode: 'batch_edit',
                reminder: tempReminder,
                defaultNote: setting.note,
                onSaved: (modifiedReminder) => {
                    // 将修改后的 reminder 映射回 BlockSetting
                    if (modifiedReminder) {
                        setting.cleanTitle = modifiedReminder.title || setting.cleanTitle;
                        setting.date = modifiedReminder.date || setting.date;
                        setting.time = modifiedReminder.time || '';
                        setting.hasTime = !!modifiedReminder.time;
                        setting.priority = modifiedReminder.priority || 'none';
                        setting.categoryId = modifiedReminder.categoryId || '';
                        setting.projectId = modifiedReminder.projectId || '';
                        setting.kanbanStatus = modifiedReminder.kanbanStatus || '';
                        setting.note = modifiedReminder.note || '';
                        setting.repeatConfig = modifiedReminder.repeat || {
                            enabled: false,
                            type: 'daily',
                            interval: 1,
                            endType: 'never'
                        };
                        setting.endDate = modifiedReminder.endDate || setting.endDate;
                        setting.endTime = modifiedReminder.endTime || setting.endTime;
                        setting.hasEndTime = !!modifiedReminder.endTime;
                    }
                    this.updateBlockDisplay(parentDialog, blockId);
                },
                plugin: this.plugin
            }
        );

        quickReminderDialog.show();
    }

    private async renderBatchCategorySelector(dialog: Dialog) {
        const categorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.plugin.categoryManager.getCategories();

            categorySelector.innerHTML = '';

            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = 'category-option-compact';
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${i18n("noCategory")}</span>`;
            categorySelector.appendChild(noCategoryEl);

            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'category-option-compact';
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染批量分类选择器失败:', error);
            categorySelector.innerHTML = `<div class="category-error">${i18n("loadCategoryFailed")}</div>`;
        }
    }

    private async renderBatchProjectSelector(dialog: Dialog) {
        const projectSelector = dialog.element.querySelector('#batchProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空选择器
            projectSelector.innerHTML = `<option value="">${i18n("noProject")}</option>`;

            // 添加项目选项
            Object.keys(groupedProjects).forEach(statusKey => {
                // 不显示已归档的项目
                if (statusKey === 'archived') return;

                const projects = groupedProjects[statusKey];
                if (projects.length > 0) {
                    const statusGroup = document.createElement('optgroup');
                    statusGroup.label = this.getStatusDisplayName(statusKey);

                    projects.forEach(project => {
                        const option = document.createElement('option');
                        option.value = project.id;
                        option.textContent = project.name;
                        statusGroup.appendChild(option);
                    });

                    projectSelector.appendChild(statusGroup);
                }
            });

        } catch (error) {
            console.error('渲染批量项目选择器失败:', error);
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    private batchApplyCategory(dialog: Dialog) {
        const selectedOptions = dialog.element.querySelectorAll('#batchCategorySelector .category-option-compact.selected');

        let categoryId = '';
        if (selectedOptions.length > 0) {
            const ids: string[] = [];
            selectedOptions.forEach(opt => {
                const id = opt.getAttribute('data-category');
                if (id) ids.push(id);
            });
            categoryId = ids.join(',');
        } else {
            // 如果没有选中任何项（包括“无分类”也没选中），这里可能需要提示，暂且认为是什么都不做
            // 但原逻辑如果选中了"无分类"，selectedOptions也会有长度1且ID为空字符串
            const noCatSelected = dialog.element.querySelector('#batchCategorySelector .category-option-compact[data-category=""]');
            if (noCatSelected && noCatSelected.classList.contains('selected')) {
                categoryId = ''; // 明确设置为无分类
            } else if (selectedOptions.length === 0) {
                return; // 没选
            }
        }

        const selectedBlocks = this.getSelectedBlockIds(dialog);

        if (selectedBlocks.length === 0) {
            showMessage(i18n("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.categoryId = categoryId;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(i18n("settingsApplied"));
    }

    private batchApplyPriority(dialog: Dialog) {
        const selectedPriority = dialog.element.querySelector('#batchPrioritySelector .priority-option-compact.selected') as HTMLElement;
        if (!selectedPriority) return;

        const priority = selectedPriority.getAttribute('data-priority') || 'none';
        const selectedBlocks = this.getSelectedBlockIds(dialog);

        if (selectedBlocks.length === 0) {
            showMessage(i18n("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.priority = priority;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(i18n("settingsApplied"));
    }

    private batchApplyProject(dialog: Dialog) {
        const projectSelector = dialog.element.querySelector('#batchProjectSelector') as HTMLSelectElement;
        const projectId = projectSelector.value;

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage(i18n("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.projectId = projectId;
                const groupSelector = dialog.element.querySelector('#batchGroupSelector') as HTMLSelectElement;
                const milestoneSelector = dialog.element.querySelector('#batchMilestoneSelector') as HTMLSelectElement;
                const gid = groupSelector?.value || '';
                const mid = milestoneSelector?.value || '';
                setting.customGroupId = gid || '';
                setting.milestoneId = mid || '';
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(i18n("settingsApplied"));

        // 重置按钮状态
        const batchApplyProjectBtn = dialog.element.querySelector('#batchApplyProjectBtn') as HTMLButtonElement;
        batchApplyProjectBtn.disabled = true;
    }

    private batchApplyDate(dialog: Dialog) {
        const dateInput = dialog.element.querySelector('#batchDateInput') as HTMLInputElement;
        if (!dateInput.value) {
            showMessage(i18n("pleaseSelectDate"));
            return;
        }

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage(i18n("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.date = dateInput.value;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(i18n("settingsApplied"));
    }

    private async updateBlockDisplay(dialog: Dialog, blockId: string) {
        const setting = this.blockSettings.get(blockId);
        if (!setting) return;

        const blockItem = dialog.element.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
        if (!blockItem) return;

        let dateDisplay = setting.date ? new Date(setting.date + 'T00:00:00').toLocaleDateString(getLocaleTag()) : '未设置';
        if (setting.endDate) {
            dateDisplay += ` ➡️ ${new Date(setting.endDate + 'T00:00:00').toLocaleDateString(getLocaleTag())}`;
        }

        let timeDisplay = setting.hasTime && setting.time ? setting.time : '全天';
        if (setting.hasEndTime && setting.endTime) {
            timeDisplay += ` - ${setting.endTime}`;
        }

        const blockDate = blockItem.querySelector('.block-date') as HTMLElement;
        const blockTime = blockItem.querySelector('.block-time') as HTMLElement;
        const blockCategory = blockItem.querySelector('.block-category') as HTMLElement;
        const blockPriority = blockItem.querySelector('.block-priority') as HTMLElement;
        const blockProject = blockItem.querySelector('.block-project') as HTMLElement;
        const blockStatus = blockItem.querySelector('.block-project-status .block-status') as HTMLElement;
        const blockMilestone = blockItem.querySelector('.block-milestone') as HTMLElement;

        if (blockDate) blockDate.textContent = dateDisplay;
        if (blockTime) blockTime.textContent = timeDisplay;
        if (blockCategory) blockCategory.innerHTML = this.getCategoryDisplay(setting.categoryId);
        if (blockPriority) blockPriority.innerHTML = this.getPriorityDisplay(setting.priority);
        if (blockProject) blockProject.innerHTML = await this.getProjectDisplay(setting.projectId, setting.customGroupId);

        // 更新状态显示
        let statusDisplay = '';
        if (setting.kanbanStatus && setting.projectId) {
            try {
                const statuses = await this.projectManager.getProjectKanbanStatuses(setting.projectId);
                const status = statuses.find(s => s.id === setting.kanbanStatus);
                if (status) {
                    const color = status.color || '#666';
                    statusDisplay = `<span class="status-badge"><span class="status-dot" style="background-color: ${color};"></span><span>${status.name}</span></span>`;
                }
            } catch (error) {
                console.error('获取状态失败:', error);
            }
        }
        if (blockStatus) blockStatus.innerHTML = statusDisplay;
        if (blockMilestone) blockMilestone.innerHTML = setting.milestoneId ? await this.getMilestoneDisplay(setting.projectId, setting.milestoneId) : '';
    }

    private showLoadingDialog(message: string) {
        if (this.loadingDialog) {
            this.loadingDialog.destroy();
        }
        this.loadingDialog = new Dialog({
            title: "Processing",
            content: `<div id="loadingDialogContent"></div>`,
            width: "350px",
            height: "auto",
            disableClose: true,
            destroyCallback: null
        });

        const loadingComponent = new LoadingDialog({
            target: this.loadingDialog.element.querySelector('#loadingDialogContent'),
            props: {
                message: message
            }
        });
    }

    private closeLoadingDialog() {
        if (this.loadingDialog) {
            this.loadingDialog.destroy();
            this.loadingDialog = null;
        }
    }

    private async saveBatchReminders(dialog: Dialog) {
        try {
            // 显示加载对话框
            this.showLoadingDialog("正在批量创建任务...");

            const reminderData = await this.plugin.loadReminderData();

            let successCount = 0;
            let failureCount = 0;
            const successfulBlockIds: string[] = [];

            // 批量获取所有相关块信息，减少多次单独查询
            const allBlockIds = Array.from(this.blockSettings.keys());
            const { sql } = await import("../api");
            const blockIdListSql = allBlockIds.map(id => `'${id}'`).join(',');
            let blockRows: any[] = [];
            try {
                blockRows = await sql(`select * from blocks where id in (${blockIdListSql})`);
            } catch (err) {
                console.warn('批量获取块信息失败，回退到逐个获取:', err);
            }
            const blockMap: Record<string, any> = {};
            (blockRows || []).forEach(b => blockMap[b.id] = b);

            for (const [blockId, setting] of this.blockSettings) {
                try {
                    if (!setting.date) {
                        failureCount++;
                        continue;
                    }

                    const reminderId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const block = blockMap[blockId];

                    const reminder: any = {
                        id: reminderId,
                        blockId: blockId,
                        docId: block ? block.root_id : undefined,
                        completed: false,
                        pomodoroCount: 0,
                        createdAt: new Date().toISOString()
                    };

                    // 更新字段
                    reminder.title = setting.cleanTitle;
                    reminder.date = setting.date;
                    reminder.priority = setting.priority;
                    reminder.categoryId = setting.categoryId || undefined;
                    reminder.projectId = setting.projectId || undefined;
                    if (setting.customGroupId) reminder.customGroupId = setting.customGroupId;
                    if (setting.milestoneId) reminder.milestoneId = setting.milestoneId;
                    if (setting.kanbanStatus) reminder.kanbanStatus = setting.kanbanStatus;
                    reminder.repeat = setting.repeatConfig?.enabled ? setting.repeatConfig : undefined;

                    // 如果新建时没有 docId 或者是新建的 reminder 对象，重新设置
                    if (!reminder.docId && block) {
                        reminder.docId = block.root_id;
                    }

                    if (setting.hasTime && setting.time) {
                        reminder.time = setting.time;
                    }

                    if (setting.endDate) {
                        reminder.endDate = setting.endDate;
                    }

                    if (setting.hasEndTime && setting.endTime) {
                        reminder.endTime = setting.endTime;
                    }

                    if (setting.note) {
                        reminder.note = setting.note;
                    }

                    // 如果是周期任务，自动完成所有过去的实例
                    if (setting.repeatConfig?.enabled && setting.date) {
                        const { generateRepeatInstances } = await import("../utils/repeatUtils");

                        const today = getLogicalDateString();

                        // 计算从开始日期到今天的天数，用于设置 maxInstances
                        const startDateObj = new Date(setting.date);
                        const todayObj = new Date(today);
                        const daysDiff = Math.ceil((todayObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));

                        // 根据重复类型估算可能的最大实例数
                        let maxInstances = 1000; // 默认值
                        if (setting.repeatConfig.type === 'daily') {
                            maxInstances = Math.max(daysDiff + 10, 1000); // 每日重复，最多是天数
                        } else if (setting.repeatConfig.type === 'weekly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 7) + 10, 500);
                        } else if (setting.repeatConfig.type === 'monthly' || setting.repeatConfig.type === 'lunar-monthly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 30) + 10, 200);
                        } else if (setting.repeatConfig.type === 'yearly' || setting.repeatConfig.type === 'lunar-yearly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 365) + 10, 50);
                        }

                        // 生成从任务开始日期到今天的所有实例
                        const instances = generateRepeatInstances(reminder, setting.date, today, maxInstances);

                        // 将所有早于今天的实例标记为已完成
                        const pastInstances: string[] = [];
                        instances.forEach(instance => {
                            if (instance.date < today) {
                                pastInstances.push(instance.date);
                            }
                        });

                        // 如果有过去的实例，添加到completedInstances
                        if (pastInstances.length > 0) {
                            if (!reminder.repeat.completedInstances) {
                                reminder.repeat.completedInstances = [];
                            }
                            reminder.repeat.completedInstances.push(...pastInstances);
                        }
                    }

                    reminderData[reminderId] = reminder;
                    successCount++;
                    successfulBlockIds.push(blockId);
                } catch (error) {
                    console.error(`设置块 ${blockId} 提醒失败:`, error);
                    failureCount++;
                }
            }

            await this.plugin.saveReminderData(reminderData);

            // 并行更新所有成功创建提醒的块的属性，减少等待时间
            await Promise.all(successfulBlockIds.map(async (blockId) => {
                try {
                    await updateBindBlockAtrrs(blockId, this.plugin);
                } catch (error) {
                    console.error(`更新块 ${blockId} 书签失败:`, error);
                }
            }));

            if (successCount > 0) {
                showMessage(i18n("batchCompleted", {
                    success: successCount.toString(),
                    failure: failureCount > 0 ? i18n("failureCount", { count: failureCount.toString() }) : ''
                }));
            } else {
                showMessage(i18n("batchSetFailed"));
            }

            dialog.destroy();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            // 触发项目更新事件（包含块属性变更）
            window.dispatchEvent(new CustomEvent('projectUpdated'));

        } catch (error) {
            console.error('保存批量提醒失败:', error);
            showMessage(i18n("batchSaveFailed"));
        } finally {
            // 关闭加载对话框
            this.closeLoadingDialog();
        }
    }
}

interface BlockSetting {
    blockId: string;
    content: string;
    cleanTitle: string;
    date: string;
    time: string;
    hasTime: boolean;
    endDate?: string;
    endTime?: string;
    hasEndTime?: boolean;
    priority: string;
    categoryId: string;
    projectId?: string;
    customGroupId?: string;
    milestoneId?: string;
    kanbanStatus?: string;
    note: string;
    repeatConfig: RepeatConfig;
}

class BlockEditDialog {
    private plugin: any;
    private setting: BlockSetting;
    private onSave: (setting: BlockSetting) => void;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    constructor(plugin: any, setting: BlockSetting, onSave: (setting: BlockSetting) => void) {
        this.plugin = plugin;
        this.setting = { ...setting }; // 创建副本
        this.onSave = onSave;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);
    }

    async show() {
        // 初始化分类管理器和项目管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize();

        const dialog = new Dialog({
            title: i18n("settingsDialog", { title: this.setting.cleanTitle }),
            content: this.buildEditContent(),
            width: "500px",
            height: "80vh"
        });

        await this.renderCategorySelector(dialog);
        await this.renderProjectSelector(dialog);
        this.updateRepeatDescription(dialog);
        this.bindEditEvents(dialog);
    }

    private buildEditContent(): string {
        return `
            <div class="block-edit-dialog">
                <div class="b3-dialog__content">
                    <div class="fn__hr"></div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("eventTitle")}</label>
                        <div class="title-input-container" style="display: flex; gap: 8px;">
                            <input type="text" id="editReminderTitle" class="b3-text-field" value="${this.setting.cleanTitle}" placeholder="${i18n("enterReminderTitle")}" style="flex: 1;">
                            <button type="button" id="editNlBtn" class="b3-button b3-button--outline" title="${i18n("smartDateRecognition")}">
                                ✨
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("blockContent")}</label>
                        <div class="block-content-display" style="padding: 8px; background: var(--b3-theme-surface-lighter); border-radius: 4px; font-size: 14px; color: var(--b3-theme-on-surface-light);">${this.setting.content}</div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("eventCategory")}
                            <button type="button" id="editManageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                            </button>
                        </label>
                        <div class="category-selector" id="editCategorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                            <!-- 分类选择器将在这里渲染 -->
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("projectManagement")}</label>
                        <select id="editProjectSelector" class="b3-select" style="width: 100%;">
                            <option value="">${i18n("noProject")}</option>
                            <!-- 项目选择器将在这里渲染 -->
                        </select>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("priority")}</label>
                        <div class="priority-selector" id="editPrioritySelector">
                            <div class="priority-option ${this.setting.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>${i18n("highPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>${i18n("mediumPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>${i18n("lowPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'none' ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>${i18n("noPriority")}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.setting.hasTime ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${i18n("noSpecificTime")}</span>
                        </label>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("reminderDate")}</label>
                        <div class="reminder-date-container">
                            <input type="date" id="editReminderDate" class="b3-text-field" value="${this.setting.date}" max="9999-12-31">
                            <span class="reminder-arrow">→</span>
                            <input type="date" id="editReminderEndDate" class="b3-text-field" placeholder="${i18n("endDateOptional")}" value="${this.setting.endDate || ''}" max="9999-12-31">
                        </div>
                        <div class="b3-form__desc" id="editDateTimeDesc">${this.setting.hasTime ? i18n("dateTimeDesc") : i18n("dateOnlyDesc")}</div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("repeatSettings")}</label>
                        <div class="repeat-setting-container">
                            <button type="button" id="editRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                <span id="editRepeatDescription">${this.setting.repeatConfig?.enabled ? getRepeatDescription(this.setting.repeatConfig) : i18n("noRepeat")}</span>
                                <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("reminderNoteOptional")}</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="${i18n("enterReminderNote")}" rows="2" style="width: 100%;resize: vertical; min-height: 60px;">${this.setting.note}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="editSaveBtn">${i18n("saveSettings")}</button>
                </div>
            </div>
        `;
    }

    private async renderCategorySelector(dialog: Dialog) {
        const categorySelector = dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.plugin.categoryManager.getCategories();
            const currentCategoryIds = this.setting.categoryId ? this.setting.categoryId.split(',') : [];

            categorySelector.innerHTML = '';

            const noCategoryEl = document.createElement('div');
            // 如果当前没有设置分类，或者分类ID为空字符串，则选中“无分类”
            const isNoCategorySelected = currentCategoryIds.length === 0 || (currentCategoryIds.length === 1 && currentCategoryIds[0] === '');
            noCategoryEl.className = `category-option ${isNoCategorySelected ? 'selected' : ''}`;
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${i18n("noCategory")}</span>`;
            categorySelector.appendChild(noCategoryEl);

            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                const isSelected = currentCategoryIds.includes(category.id);
                categoryEl.className = `category-option ${isSelected ? 'selected' : ''}`;
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = `<div class="category-error">${i18n("loadCategoryFailed")}</div>`;
        }
    }

    private async renderProjectSelector(dialog: Dialog) {
        const projectSelector = dialog.element.querySelector('#editProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空选择器
            projectSelector.innerHTML = `<option value="">${i18n("noProject")}</option>`;

            // 添加项目选项
            Object.keys(groupedProjects).forEach(statusKey => {
                // 不显示已归档的项目
                if (statusKey === 'archived') return;

                const projects = groupedProjects[statusKey];
                if (projects.length > 0) {
                    const statusGroup = document.createElement('optgroup');
                    statusGroup.label = this.getStatusDisplayName(statusKey);

                    projects.forEach(project => {
                        const option = document.createElement('option');
                        option.value = project.id;
                        option.textContent = project.name;
                        option.selected = this.setting.projectId === project.id;
                        statusGroup.appendChild(option);
                    });

                    projectSelector.appendChild(statusGroup);
                }
            });

        } catch (error) {
            console.error('渲染项目选择器失败:', error);
        }
    }

    // 显示自然语言输入对话框
    private showNaturalLanguageDialog(parentDialog: Dialog) {
        const nlDialog = new Dialog({
            title: i18n("smartDateRecognition"),
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("nlInputLabel")}</label>
                            <input type="text" id="editNlInput" class="b3-text-field" placeholder="${i18n("nlInputPlaceholder")}" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">${i18n("nlInputDesc")}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("recognitionResultPreview")}</label>
                            <div id="editNlPreview" class="nl-preview">${i18n("pleaseEnterDateTimeDesc")}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editNlCancelBtn">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="editNlConfirmBtn" disabled>${i18n("apply")}</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "25%"
        });

        this.bindNaturalLanguageEvents(nlDialog, parentDialog);
    }

    private bindNaturalLanguageEvents(nlDialog: Dialog, parentDialog: Dialog) {
        const nlInput = nlDialog.element.querySelector('#editNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#editNlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#editNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#editNlConfirmBtn') as HTMLButtonElement;

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean; endDate?: string; endTime?: string; hasEndTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const input = nlInput.value.trim();
            if (!input) {
                nlPreview.textContent = '请输入日期时间描述';
                nlConfirmBtn.disabled = true;
                return;
            }

            const result = parseNaturalDateTime(input);
            currentParseResult = result;

            if (result.date) {
                const dateStr = new Date(result.date + 'T00:00:00').toLocaleDateString(getLocaleTag());
                const timeStr = result.time ? ` ${result.time}` : '';
                let previewText = `${dateStr}${timeStr}`;

                if (currentParseResult.endDate) {
                    const endDateStr = new Date(currentParseResult.endDate + 'T00:00:00').toLocaleDateString(getLocaleTag(), {
                        month: 'long',
                        day: 'numeric'
                    });
                    previewText += ` ➡️ 📅 ${endDateStr}`;
                    if (currentParseResult.endTime) {
                        previewText += ` ⏰ ${currentParseResult.endTime}`;
                    }
                }

                nlPreview.innerHTML = `<span style="color: var(--b3-theme-primary);">✅ ${previewText}</span>`;
                nlConfirmBtn.disabled = false;
            } else {
                nlPreview.innerHTML = '<span style="color: var(--b3-theme-error);">❌ 无法识别，请尝试其他表达方式</span>';
                nlConfirmBtn.disabled = true;
            }
        };

        // 绑定事件
        nlInput.addEventListener('input', updatePreview);
        nlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !nlConfirmBtn.disabled) {
                nlConfirmBtn.click();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyNaturalLanguageResult(parentDialog, currentParseResult);
            nlDialog.destroy();
        });

        // 自动聚焦输入框
        setTimeout(() => {
            nlInput.focus();
        }, 100);
    }



    // 应用自然语言识别结果
    private applyNaturalLanguageResult(dialog: Dialog, result: { date?: string; time?: string; hasTime?: boolean; endDate?: string; endTime?: string; hasEndTime?: boolean }) {
        if (!result.date) return;

        const dateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;

        // 设置日期和时间
        dateInput.value = result.date;

        if (result.hasTime && result.time) {
            noTimeCheckbox.checked = false;
            this.setting.hasTime = true;
            this.setting.time = result.time;
        } else {
            noTimeCheckbox.checked = true;
            this.setting.hasTime = false;
            this.setting.time = '';
        }

        if (result.endDate) {
            const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
            if (endDateInput) {
                endDateInput.value = result.endDate;
                this.setting.endDate = result.endDate;
            }
        }

        // 更新显示
        this.toggleDateTimeInputs(dialog, !result.hasTime);

        showMessage(`✨ 已识别并设置：${new Date(result.date + 'T00:00:00').toLocaleDateString(getLocaleTag())}${result.time ? ` ${result.time}` : ''}`);
    }

    // 切换日期时间输入框类型
    private toggleDateTimeInputs(dialog: Dialog, noSpecificTime: boolean) {
        const dateTimeDesc = dialog.element.querySelector('#editDateTimeDesc') as HTMLElement;

        if (dateTimeDesc) {
            dateTimeDesc.textContent = noSpecificTime ? i18n("dateOnlyDesc") : i18n("dateTimeDesc");
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    private updateRepeatDescription(dialog: Dialog) {
        const repeatDescription = dialog.element.querySelector('#editRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.setting.repeatConfig?.enabled ? getRepeatDescription(this.setting.repeatConfig) : i18n("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private bindEditEvents(dialog: Dialog) {
        const cancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#editSaveBtn') as HTMLButtonElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const prioritySelector = dialog.element.querySelector('#editPrioritySelector') as HTMLElement;
        const categorySelector = dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        const repeatSettingsBtn = dialog.element.querySelector('#editRepeatSettingsBtn') as HTMLButtonElement;
        const nlBtn = dialog.element.querySelector('#editNlBtn') as HTMLButtonElement;

        // 优先级选择事件
        prioritySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 分类选择事件（支持多选）
        categorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                const categoryId = option.getAttribute('data-category');

                if (!categoryId) {
                    // 选中无分类 -> 清除其他
                    categorySelector.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                    option.classList.add('selected');
                } else {
                    // 选中具体分类
                    const noCatOption = categorySelector.querySelector('.category-option[data-category=""]');
                    if (noCatOption) noCatOption.classList.remove('selected');

                    if (option.classList.contains('selected')) {
                        option.classList.remove('selected');
                    } else {
                        option.classList.add('selected');
                    }

                    // 如果全部取消了，默认选中“无分类”？还是允许为空？暂时保持如果不选就是空
                    if (categorySelector.querySelectorAll('.category-option.selected').length === 0) {
                        if (noCatOption) noCatOption.classList.add('selected');
                    }
                }
            }
        });

        // 无时间复选框
        noTimeCheckbox?.addEventListener('change', () => {
            // 可以在这里处理时间输入框的状态，但这个对话框中没有时间输入框
        });

        // 重复设置按钮
        repeatSettingsBtn?.addEventListener('click', () => {
            // 获取当前设置的开始日期
            const startDateInput = dialog.element.querySelector('#batchReminderDate') as HTMLInputElement;
            const startDate = startDateInput?.value;

            const repeatDialog = new RepeatSettingsDialog(this.setting.repeatConfig, (config: RepeatConfig) => {
                this.setting.repeatConfig = config;
                this.updateRepeatDescription(dialog);
            }, startDate);
            repeatDialog.show();
        });

        // 智能日期识别按钮
        nlBtn?.addEventListener('click', () => {
            this.showNaturalLanguageDialog(dialog);
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });

        // 保存按钮
        saveBtn?.addEventListener('click', () => {
            this.saveBlockSetting(dialog);
        });
    }
    private saveBlockSetting(dialog: Dialog) {
        const titleInput = dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const dateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const selectedPriority = dialog.element.querySelector('#editPrioritySelector .priority-option.selected') as HTMLElement;

        const projectSelector = dialog.element.querySelector('#editProjectSelector') as HTMLSelectElement;

        if (!dateInput.value) {
            showMessage(i18n("pleaseSelectDate"));
            return;
        }

        // 更新设置
        this.setting.cleanTitle = titleInput.value.trim() || this.setting.content;
        this.setting.date = dateInput.value;
        this.setting.hasTime = !noTimeCheckbox.checked;

        // 保存结束日期
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        if (endDateInput && endDateInput.value) {
            this.setting.endDate = endDateInput.value;
        } else {
            this.setting.endDate = '';
        }

        const selectedCategories = dialog.element.querySelectorAll('#editCategorySelector .category-option.selected');
        const categoryIds: string[] = [];
        selectedCategories.forEach(el => {
            const id = el.getAttribute('data-category');
            if (id) categoryIds.push(id);
        });

        this.setting.note = noteInput.value.trim();
        this.setting.priority = selectedPriority?.getAttribute('data-priority') || 'none';
        this.setting.categoryId = categoryIds.join(',');
        this.setting.projectId = projectSelector.value || '';

        // 调用保存回调
        this.onSave(this.setting);

        showMessage(i18n("settingsApplied"));
        dialog.destroy();
    }



}
