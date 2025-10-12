import { Dialog, showMessage } from "siyuan";
import { t } from "../utils/i18n";
import { ensureReminderDataFile, updateBlockReminderBookmark, getBlockByID, getBlockDOM } from "../api";
import { getRepeatDescription } from "../utils/repeatUtils";
import { getLocalDateString, getLocalTimeString } from "../utils/dateUtils";
import { RepeatConfig, RepeatSettingsDialog } from "./RepeatSettingsDialog";
import { NotificationDialog } from "./NotificationDialog";
import * as chrono from 'chrono-node';
import { ReminderDialog } from "./ReminderDialog";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { parseLunarDateText, getCurrentYearLunarToSolar } from "../utils/lunarUtils";

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
    date?: string;
    time?: string;
    hasTime?: boolean;
    cleanTitle?: string;
}

export class BatchReminderDialog {
    private plugin: any;
    private chronoParser: any;

    constructor(plugin: any) {
        this.plugin = plugin;
        // 初始化chrono解析器，配置中文支持
        this.chronoParser = chrono.zh.casual.clone();
        this.setupChronoParser();
    }

    // 设置chrono解析器
    private setupChronoParser() {
        // 添加更多中文时间表达式支持
        const customPatterns = [
            // 今天、明天、后天等
            /今天|今日/i,
            /明天|明日/i,
            /后天/i,
            /大后天/i,
            // 周几
            /下?周[一二三四五六日天]/i,
            /下?星期[一二三四五六日天]/i,
            // 月份日期
            /(\d{1,2})月(\d{1,2})[日号]/i,
            // 时间
            /(\d{1,2})[点时](\d{1,2})?[分]?/i,
            // 相对时间
            /(\d+)天[后以]后/i,
            /(\d+)小时[后以]后/i,
            // 紧凑日期格式 YYYYMMDD
            /^(\d{8})$/,
            // 其他数字日期格式
            /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/,
            /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/,
        ];

        // 配置chrono选项
        this.chronoParser.option = {
            ...this.chronoParser.option,
            forwardDate: false // 优先解析未来日期
        };

        // 添加自定义解析器来处理紧凑日期格式和其他特殊格式
        this.chronoParser.refiners.push({
            refine: (context, results) => {
                results.forEach(result => {
                    const text = result.text;

                    // 处理YYYYMMDD格式
                    const compactMatch = text.match(/^(\d{8})$/);
                    if (compactMatch) {
                        const dateStr = compactMatch[1];
                        const year = parseInt(dateStr.substring(0, 4));
                        const month = parseInt(dateStr.substring(4, 6));
                        const day = parseInt(dateStr.substring(6, 8));

                        // 验证日期有效性
                        if (this.isValidDate(year, month, day)) {
                            result.start.assign('year', year);
                            result.start.assign('month', month);
                            result.start.assign('day', day);
                        }
                    }

                    // 处理其他数字格式
                    const dashMatch = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
                    if (dashMatch) {
                        const year = parseInt(dashMatch[1]);
                        const month = parseInt(dashMatch[2]);
                        const day = parseInt(dashMatch[3]);

                        if (this.isValidDate(year, month, day)) {
                            result.start.assign('year', year);
                            result.start.assign('month', month);
                            result.start.assign('day', day);
                        }
                    }

                    // 处理MM/DD/YYYY或DD/MM/YYYY格式（根据数值大小判断）
                    const slashMatch = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
                    if (slashMatch) {
                        const first = parseInt(slashMatch[1]);
                        const second = parseInt(slashMatch[2]);
                        const year = parseInt(slashMatch[3]);

                        // 如果第一个数字大于12，则认为是DD/MM/YYYY格式
                        let month, day;
                        if (first > 12 && second <= 12) {
                            day = first;
                            month = second;
                        } else if (second > 12 && first <= 12) {
                            month = first;
                            day = second;
                        } else {
                            // 默认使用MM/DD/YYYY格式
                            month = first;
                            day = second;
                        }

                        if (this.isValidDate(year, month, day)) {
                            result.start.assign('year', year);
                            result.start.assign('month', month);
                            result.start.assign('day', day);
                        }
                    }
                });

                return results;
            }
        });
    }


    // 添加日期有效性验证方法
    private isValidDate(year: number, month: number, day: number): boolean {
        if (year < 1900 || year > 2100) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;

        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day;
    }

    async show(blockIds: string[]) {
        if (blockIds.length === 1) {
            const dialog = new ReminderDialog(blockIds[0]);
            dialog.show();
        } else {
            // 直接显示智能批量设置
            this.showSmartBatchDialog(blockIds);
        }
    }

    private async showSmartBatchDialog(blockIds: string[]) {
        const autoDetectedData = await this.autoDetectBatchDateTime(blockIds);
        const smartBatchDialog = new SmartBatchDialog(this.plugin, blockIds, autoDetectedData);
        smartBatchDialog.show();
    }

    async autoDetectBatchDateTime(blockIds: string[]): Promise<AutoDetectResult[]> {
        const results = [];

        for (const blockId of blockIds) {
            try {
                const { getBlockByID } = await import("../api");
                const block = await getBlockByID(blockId);

                if (block) {
                    let content;
                    try {
                        const domString = await getBlockDOM(blockId);
                        const parser = new DOMParser();
                        const dom = parser.parseFromString(domString.dom, 'text/html');
                        const element = dom.querySelector('div[data-type="NodeParagraph"]');
                        if (element) {
                            const attrElement = element.querySelector('div.protyle-attr');
                            if (attrElement) {
                                attrElement.remove();
                            }
                        }
                        content = element ? element.textContent.trim() : (block?.fcontent || block?.content);
                    } catch (e) {
                        content = block?.fcontent || block?.content;
                    }
                    const autoDetected = this.autoDetectDateTimeFromTitle(content);
                    results.push({
                        blockId,
                        content: content,
                        ...autoDetected
                    });
                }
            } catch (error) {
                console.error(`获取块 ${blockId} 失败:`, error);
                results.push({
                    blockId,
                    content: '无法获取块内容',
                    cleanTitle: '无法获取块内容'
                });
            }
        }

        return results;
    }

    private async getBlockDetails(blockIds: string[]): Promise<BlockDetail[]> {
        const details = [];

        for (const blockId of blockIds) {
            try {
                const { getBlockByID } = await import("../api");
                const block = await getBlockByID(blockId);

                if (block) {
                    let content;
                    try {
                        const domString = await getBlockDOM(blockId);
                        const parser = new DOMParser();
                        const dom = parser.parseFromString(domString.dom, 'text/html');
                        const element = dom.querySelector('div[data-type="NodeParagraph"]');
                        if (element) {
                            const attrElement = element.querySelector('div.protyle-attr');
                            if (attrElement) {
                                attrElement.remove();
                            }
                        }
                        content = element ? element.textContent.trim() : (block?.fcontent || block?.content);
                    } catch (e) {
                        content = block?.fcontent || block?.content;
                    }
                    const autoDetected = this.autoDetectDateTimeFromTitle(content);
                    details.push({
                        blockId,
                        content: content,
                        docId: block.root_id || blockId,
                        ...autoDetected,
                        selectedDate: autoDetected.date || getLocalDateString(),
                        selectedTime: autoDetected.time || '',
                        hasTime: autoDetected.hasTime || false,
                        priority: 'none',
                        categoryId: '',
                        note: ''
                    });
                }
            } catch (error) {
                console.error(`获取块 ${blockId} 详情失败:`, error);
            }
        }

        return details;
    }

    private autoDetectDateTimeFromTitle(title: string): { date?: string; time?: string; hasTime?: boolean; cleanTitle?: string } {
        const parseResult = this.parseNaturalDateTime(title);

        if (!parseResult.date) {
            return { cleanTitle: title };
        }

        let cleanTitle = title;
        const timeExpressions = [
            /今天|今日/gi,
            /明天|明日/gi,
            /后天/gi,
            /大后天/gi,
            /下?周[一二三四五六日天]/gi,
            /下?星期[一二三四五六日天]/gi,
            /\d+天[后以]后/gi,
            /\d+小时[后以]后/gi,
        ];

        timeExpressions.forEach(pattern => {
            cleanTitle = cleanTitle.replace(pattern, '').trim();
        });

        cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、\s]+|[，。、\s]+$/g, '');

        return {
            ...parseResult,
            cleanTitle: cleanTitle || title
        };
    }

    private parseNaturalDateTime(text: string): { date?: string; time?: string; hasTime?: boolean } {
        try {
            // 预处理文本，处理一些特殊格式
            let processedText = text.trim();
            // 处理包含8位数字日期的情况（支持前后有文字，有无空格）
            // 匹配模式：20250527、20250527 干活、干活 20250527、20250527干活、干活20250527
            const compactDateInTextMatch = processedText.match(/(?:^|.*?)(\d{8})(?:\s|$|.*)/);
            if (compactDateInTextMatch) {
                const dateStr = compactDateInTextMatch[1];
                const year = dateStr.substring(0, 4);
                const month = dateStr.substring(4, 6);
                const day = dateStr.substring(6, 8);

                // 验证日期有效性
                if (this.isValidDate(parseInt(year), parseInt(month), parseInt(day))) {
                    // 检查是否还有时间信息
                    const textWithoutDate = processedText.replace(dateStr, '').trim();
                    let timeResult = null;

                    if (textWithoutDate) {
                        // 尝试从剩余文本中解析时间
                        const timeMatch = textWithoutDate.match(/(\d{1,2})[点时:](\d{1,2})?[分]?/);
                        if (timeMatch) {
                            const hour = parseInt(timeMatch[1]);
                            const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

                            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                                const hourStr = hour.toString().padStart(2, '0');
                                const minuteStr = minute.toString().padStart(2, '0');
                                timeResult = `${hourStr}:${minuteStr}`;
                            }
                        }
                    }

                    return {
                        date: `${year}-${month}-${day}`,
                        time: timeResult || undefined,
                        hasTime: !!timeResult
                    };
                }
            }

            // 处理YYYY-MM-DD或YYYY/MM/DD格式
            const standardDateMatch = processedText.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
            if (standardDateMatch) {
                const year = parseInt(standardDateMatch[1]);
                const month = parseInt(standardDateMatch[2]);
                const day = parseInt(standardDateMatch[3]);

                if (this.isValidDate(year, month, day)) {
                    const monthStr = month.toString().padStart(2, '0');
                    const dayStr = day.toString().padStart(2, '0');
                    return {
                        date: `${year}-${monthStr}-${dayStr}`,
                        hasTime: false
                    };
                }
            }

            // 处理农历日期格式（例如：八月廿一、正月初一）
            const lunarDate = parseLunarDateText(processedText);
            if (lunarDate && lunarDate.month > 0) {
                // 有完整的农历月日
                const solarDate = getCurrentYearLunarToSolar(lunarDate.month, lunarDate.day);
                if (solarDate) {
                    return {
                        date: solarDate,
                        hasTime: false
                    };
                }
            }

            const results = this.chronoParser.parse(processedText, new Date(), { forwardDate: false });

            if (results.length === 0) {
                return {};
            }

            const result = results[0];
            const parsedDate = result.start.date();

            const date = parsedDate.toISOString().split('T')[0];
            const hasTime = result.start.isCertain('hour') && result.start.isCertain('minute');
            let time = undefined;

            if (hasTime) {
                const hours = parsedDate.getHours().toString().padStart(2, '0');
                const minutes = parsedDate.getMinutes().toString().padStart(2, '0');
                time = `${hours}:${minutes}`;
            }

            return { date, time, hasTime };
        } catch (error) {
            console.error('解析自然语言日期时间失败:', error);
            return {};
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

    constructor(plugin: any, blockIds: string[], autoDetectedData: AutoDetectResult[]) {
        this.plugin = plugin;
        this.blockIds = blockIds;
        this.autoDetectedData = autoDetectedData;
        this.categoryManager = CategoryManager.getInstance();
        this.projectManager = ProjectManager.getInstance();

        // 初始化每个块的设置
        this.initializeBlockSettings();
    }

    private initializeBlockSettings() {
        this.autoDetectedData.forEach(data => {
            this.blockSettings.set(data.blockId, {
                blockId: data.blockId,
                content: data.content,
                cleanTitle: data.cleanTitle || data.content,
                date: data.date || getLocalDateString(),
                time: data.time || '',
                hasTime: data.hasTime || false,
                priority: 'none',
                categoryId: '',
                projectId: '',
                note: '',
                repeatConfig: {
                    enabled: false,
                    type: 'daily',
                    interval: 1,
                    endType: 'never'
                }
            });
        });
    }

    async show() {
        // 初始化分类管理器和项目管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize();

        const dialog = new Dialog({
            title: t("smartBatchTitle", { count: this.blockIds.length.toString() }),
            content: this.buildSmartBatchContent(),
            width: "700px",
            height: "700px"
        });

        this.renderBlockList(dialog);
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
                            <h3>${t("batchOperations")}</h3>
                            <div class="batch-toggle">
                                <button type="button" id="batchToggleBtn" class="b3-button b3-button--outline">
                                    <span>${t("expand")}</span>
                                    <svg class="b3-button__icon toggle-icon"><use xlink:href="#iconDown"></use></svg>
                                </button>
                            </div>
                        </div>
                        <div class="batch-operations-content" id="batchOperationsContent" style="display: none;">
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${t("batchSetCategory")}</label>
                                    <div class="batch-category-container">
                                        <div class="category-selector-compact" id="batchCategorySelector">
                                            <!-- 分类选择器将在这里渲染 -->
                                        </div>
                                        <button type="button" id="batchApplyCategoryBtn" class="b3-button b3-button--primary" disabled>
                                            ${t("applyToAll")}
                                        </button>
                                    </div>
                                </div>
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${t("batchSetPriority")}</label>
                                    <div class="batch-priority-container">
                                        <div class="priority-selector-compact" id="batchPrioritySelector">
                                            <div class="priority-option-compact" data-priority="high">
                                                <div class="priority-dot high"></div>
                                                <span>${t("highPriority")}</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="medium">
                                                <div class="priority-dot medium"></div>
                                                <span>${t("mediumPriority")}</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="low">
                                                <div class="priority-dot low"></div>
                                                <span>${t("lowPriority")}</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="none">
                                                <div class="priority-dot none"></div>
                                                <span>${t("noPriority")}</span>
                                            </div>
                                        </div>
                                        <button type="button" id="batchApplyPriorityBtn" class="b3-button b3-button--primary" disabled>
                                            ${t("applyToAll")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${t("batchSetProject")}</label>
                                    <div class="batch-project-container">
                                        <select id="batchProjectSelector" class="b3-select" style="flex: 1;">
                                            <option value="">${t("noProject")}</option>
                                            <!-- 项目选择器将在这里渲染 -->
                                        </select>
                                        <button type="button" id="batchApplyProjectBtn" class="b3-button b3-button--primary" disabled>
                                            ${t("applyToAll")}
                                        </button>
                                    </div>
                                </div>
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">${t("batchSetDate")}</label>
                                    <div class="batch-date-container">
                                        <input type="date" id="batchDateInput" class="b3-text-field" value="${getLocalDateString()}">
                                        <button type="button" id="batchApplyDateBtn" class="b3-button b3-button--primary">
                                            ${t("applyDateToAll")}
                                        </button>
                                        <button type="button" id="batchNlDateBtn" class="b3-button b3-button--outline" title="${t('smartDateRecognition')}">
                                            ✨
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="fn__hr"></div>
                    
                    <div class="block-list-header">
                        <div class="list-summary">
                            <span class="summary-text">${t("totalBlocks", { count: this.blockIds.length.toString(), detected: this.autoDetectedData.filter(d => d.date).length.toString() })}</span>
                        </div>
                        <div class="list-actions">
                            <button type="button" id="selectAllBtn" class="b3-button b3-button--outline">
                                ${t("selectAll")}
                            </button>
                            <button type="button" id="deselectAllBtn" class="b3-button b3-button--outline">
                                ${t("deselectAll")}
                            </button>
                        </div>
                    </div>
                    <div class="block-list-container" id="blockListContainer">
                        <!-- 块列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="smartBatchCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="smartBatchConfirmBtn">${t("batchSetReminders")}</button>
                </div>
            </div>
        `;
    }

    private renderBlockList(dialog: Dialog) {
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;
        if (!container) return;

        const listHtml = this.autoDetectedData.map(data => {
            const setting = this.blockSettings.get(data.blockId);
            const dateStatus = data.date ? '✅' : '❌';
            const dateDisplay = setting?.date ? new Date(setting.date + 'T00:00:00').toLocaleDateString('zh-CN') : '未设置';
            const timeDisplay = setting?.hasTime && setting.time ? setting.time : '全天';

            // 获取分类、优先级和项目显示
            const categoryDisplay = this.getCategoryDisplay(setting?.categoryId);
            const priorityDisplay = this.getPriorityDisplay(setting?.priority);
            const projectDisplay = this.getProjectDisplay(setting?.projectId);

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
                                    <span class="block-date">${dateDisplay}</span>
                                    <span class="block-time">${timeDisplay}</span>
                                </div>
                                <div class="block-attributes">
                                    <span class="block-category">${categoryDisplay}</span>
                                    <span class="block-priority">${priorityDisplay}</span>
                                    <span class="block-project">${projectDisplay}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="block-actions">
                        <button type="button" class="b3-button b3-button--outline block-edit-btn" data-block-id="${data.blockId}">
                            ⚙️  ${t("edit")}
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="block-list">
                ${listHtml}
            </div>
        `;
    }

    private getCategoryDisplay(categoryId?: string): string {
        if (!categoryId) return `📂 ${t("noCategory")}`;

        try {
            const categories = this.plugin.categoryManager.getCategories();
            const category = categories.find(c => c.id === categoryId);
            if (category) {
                return `<span style="background-color: ${category.color}; padding: 2px 6px; border-radius: 3px; font-size: 12px;color:#fff;">${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
            }
        } catch (error) {
            console.error('获取分类显示失败:', error);
        }

        return `📂 ${t("noCategory")}`;
    }

    private getPriorityDisplay(priority?: string): string {
        const priorityMap = {
            'high': `<span class="priority-badge high">🔴 ${t("highPriority")}</span>`,
            'medium': `<span class="priority-badge medium">🟡 ${t("mediumPriority")}</span>`,
            'low': `<span class="priority-badge low">🟢 ${t("lowPriority")}</span>`,
            'none': `<span class="priority-badge none">⚪ ${t("noPriority")}</span>`
        };

        return priorityMap[priority as keyof typeof priorityMap] || priorityMap.none;
    }

    private getProjectDisplay(projectId?: string): string {
        if (!projectId) return `📁 ${t("noProject")}`;

        try {
            const project = this.projectManager.getProjectById(projectId);
            if (project) {
                return `<span class="project-badge" style="background-color: ${project.color || '#E0E0E0'}; padding: 2px 6px; border-radius: 3px; font-size: 12px;">📁 ${project.name}</span>`;
            }
        } catch (error) {
            console.error('获取项目显示失败:', error);
        }

        return `📁 ${t("noProject")}`;
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
                toggleText.textContent = isVisible ? t("expand") : t("collapse");
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

        // 批量分类选择
        const batchCategorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        batchCategorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option-compact') as HTMLElement;
            if (option) {
                batchCategorySelector.querySelectorAll('.category-option-compact').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
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
        batchProjectSelector?.addEventListener('change', () => {
            batchApplyProjectBtn.disabled = false;
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

        // 设置按钮事件
        container?.addEventListener('click', (e) => {
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
    private showBatchNaturalLanguageDialog(dialog: Dialog) {
        const nlDialog = new Dialog({
            title: t("smartDateRecognitionDialog"),
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("inputNaturalLanguage")}</label>
                            <input type="text" id="batchNlInput" class="b3-text-field" placeholder="${t('exampleInputs')}" style="width: 100%;" autofocus>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("recognitionPreview")}</label>
                            <div id="batchNlPreview" class="nl-preview">${t("pleaseInputDescription")}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("applyScope")}</label>
                            <div id="batchNlScope" class="nl-scope">${t("applyToSelected")}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchNlCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="batchNlConfirmBtn" disabled>${t("batchApply")}</button>
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
        nlScope.textContent = t("applyToSelectedBlocks", { count: selectedCount.toString() });

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = t("pleaseInputDescription");
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            const batchDialog = new BatchReminderDialog(this.plugin);
            currentParseResult = (batchDialog as any).parseNaturalDateTime(text);

            if (currentParseResult.date) {
                const dateStr = new Date(currentParseResult.date + 'T00:00:00').toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                });

                let previewText = `📅 ${dateStr}`;
                if (currentParseResult.time) {
                    previewText += ` ⏰ ${currentParseResult.time}`;
                }

                nlPreview.textContent = previewText;
                nlPreview.className = 'nl-preview nl-preview--success';
                nlConfirmBtn.disabled = selectedCount === 0;
            } else {
                nlPreview.textContent = t("cannotRecognize");
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
    private applyBatchNaturalLanguageResult(dialog: Dialog, result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage(t("pleaseSelectBlocks"));
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
            }
        });

        this.updateBlockListDisplay(dialog);

        const dateStr = new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN');
        showMessage(t("dateTimeSet", {
            date: dateStr,
            time: result.time ? ` ${result.time}` : ''
        }));
    }
    private getSelectedBlockIds(dialog: Dialog): string[] {
        const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox:checked') as NodeListOf<HTMLInputElement>;
        return Array.from(checkboxes).map(checkbox => checkbox.getAttribute('data-block-id')).filter(Boolean) as string[];
    }

    private updateBlockListDisplay(dialog: Dialog) {
        // 重新渲染块列表以反映更新
        this.renderBlockList(dialog);
        // 重新绑定事件（只绑定块相关的事件）
        this.bindBlockListEvents(dialog);
    }

    private bindBlockListEvents(dialog: Dialog) {
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;

        // 设置按钮事件
        container?.addEventListener('click', (e) => {
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

        const blockEditDialog = new BlockEditDialog(this.plugin, setting, (updatedSetting: BlockSetting) => {
            this.blockSettings.set(blockId, updatedSetting);
            this.updateBlockDisplay(parentDialog, blockId);
        });

        blockEditDialog.show();
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
            noCategoryEl.innerHTML = `<span>${t("noCategory")}</span>`;
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
            categorySelector.innerHTML = `<div class="category-error">${t("loadCategoryFailed")}</div>`;
        }
    }

    private async renderBatchProjectSelector(dialog: Dialog) {
        const projectSelector = dialog.element.querySelector('#batchProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空选择器
            projectSelector.innerHTML = `<option value="">${t("noProject")}</option>`;

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
        const selectedCategory = dialog.element.querySelector('#batchCategorySelector .category-option-compact.selected') as HTMLElement;
        if (!selectedCategory) return;

        const categoryId = selectedCategory.getAttribute('data-category') || '';
        const selectedBlocks = this.getSelectedBlockIds(dialog);

        if (selectedBlocks.length === 0) {
            showMessage(t("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.categoryId = categoryId;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(t("settingsApplied"));
    }

    private batchApplyPriority(dialog: Dialog) {
        const selectedPriority = dialog.element.querySelector('#batchPrioritySelector .priority-option-compact.selected') as HTMLElement;
        if (!selectedPriority) return;

        const priority = selectedPriority.getAttribute('data-priority') || 'none';
        const selectedBlocks = this.getSelectedBlockIds(dialog);

        if (selectedBlocks.length === 0) {
            showMessage(t("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.priority = priority;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(t("settingsApplied"));
    }

    private batchApplyProject(dialog: Dialog) {
        const projectSelector = dialog.element.querySelector('#batchProjectSelector') as HTMLSelectElement;
        const projectId = projectSelector.value;

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage(t("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.projectId = projectId;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(t("settingsApplied"));

        // 重置按钮状态
        const batchApplyProjectBtn = dialog.element.querySelector('#batchApplyProjectBtn') as HTMLButtonElement;
        batchApplyProjectBtn.disabled = true;
    }

    private batchApplyDate(dialog: Dialog) {
        const dateInput = dialog.element.querySelector('#batchDateInput') as HTMLInputElement;
        if (!dateInput.value) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage(t("pleaseSelectBlocks"));
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.date = dateInput.value;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(t("settingsApplied"));
    }

    private updateBlockDisplay(dialog: Dialog, blockId: string) {
        const setting = this.blockSettings.get(blockId);
        if (!setting) return;

        const blockItem = dialog.element.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
        if (!blockItem) return;

        const dateDisplay = setting.date ? new Date(setting.date + 'T00:00:00').toLocaleDateString('zh-CN') : '未设置';
        const timeDisplay = setting.hasTime && setting.time ? setting.time : '全天';

        const blockDate = blockItem.querySelector('.block-date') as HTMLElement;
        const blockTime = blockItem.querySelector('.block-time') as HTMLElement;
        const blockCategory = blockItem.querySelector('.block-category') as HTMLElement;
        const blockPriority = blockItem.querySelector('.block-priority') as HTMLElement;
        const blockProject = blockItem.querySelector('.block-project') as HTMLElement;

        if (blockDate) blockDate.textContent = dateDisplay;
        if (blockTime) blockTime.textContent = timeDisplay;
        if (blockCategory) blockCategory.innerHTML = this.getCategoryDisplay(setting.categoryId);
        if (blockPriority) blockPriority.innerHTML = this.getPriorityDisplay(setting.priority);
        if (blockProject) blockProject.innerHTML = this.getProjectDisplay(setting.projectId);
    }

    private async saveBatchReminders(dialog: Dialog) {
        try {
            const { readReminderData, writeReminderData } = await import("../api");
            const reminderData = await readReminderData();

            let successCount = 0;
            let failureCount = 0;
            const successfulBlockIds: string[] = [];

            for (const [blockId, setting] of this.blockSettings) {
                try {
                    if (!setting.date) {
                        failureCount++;
                        continue;
                    }

                    const reminderId = `${blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const block = await getBlockByID(blockId);
                    const reminder: any = {
                        id: reminderId,
                        blockId: blockId,
                        docId: block.root_id,
                        title: setting.cleanTitle,
                        date: setting.date,
                        completed: false,
                        priority: setting.priority,
                        categoryId: setting.categoryId || undefined,
                        projectId: setting.projectId || undefined,
                        pomodoroCount: 0,
                        createdAt: new Date().toISOString(),
                        repeat: setting.repeatConfig?.enabled ? setting.repeatConfig : undefined
                    };

                    if (setting.hasTime && setting.time) {
                        reminder.time = setting.time;
                    }

                    if (setting.note) {
                        reminder.note = setting.note;
                    }

                    reminderData[reminderId] = reminder;
                    successCount++;
                    successfulBlockIds.push(blockId);
                } catch (error) {
                    console.error(`设置块 ${blockId} 提醒失败:`, error);
                    failureCount++;
                }
            }

            await writeReminderData(reminderData);

            // 为所有成功创建提醒的块添加书签
            for (const blockId of successfulBlockIds) {
                try {
                    await updateBlockReminderBookmark(blockId);
                } catch (error) {
                    console.error(`更新块 ${blockId} 书签失败:`, error);
                }
            }

            if (successCount > 0) {
                showMessage(t("batchCompleted", {
                    success: successCount.toString(),
                    failure: failureCount > 0 ? t("failureCount", { count: failureCount.toString() }) : ''
                }));
            } else {
                showMessage(t("batchSetFailed"));
            }

            dialog.destroy();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('保存批量提醒失败:', error);
            showMessage(t("batchSaveFailed"));
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
    priority: string;
    categoryId: string;
    projectId?: string;
    note: string;
    repeatConfig: RepeatConfig;
}

class BlockEditDialog {
    private plugin: any;
    private setting: BlockSetting;
    private onSave: (setting: BlockSetting) => void;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private chronoParser: any;

    constructor(plugin: any, setting: BlockSetting, onSave: (setting: BlockSetting) => void) {
        this.plugin = plugin;
        this.setting = { ...setting }; // 创建副本
        this.onSave = onSave;
        this.categoryManager = CategoryManager.getInstance();
        this.projectManager = ProjectManager.getInstance();

        // 初始化chrono解析器，配置中文支持
        this.chronoParser = chrono.zh.casual.clone();
        this.setupChronoParser();
    }

    // 设置chrono解析器 - 复用父类的逻辑
    private setupChronoParser() {
        // 配置chrono选项
        this.chronoParser.option = {
            ...this.chronoParser.option,
            forwardDate: false
        };
    }

    async show() {
        // 初始化分类管理器和项目管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize();

        const dialog = new Dialog({
            title: t("settingsDialog", { title: this.setting.cleanTitle }),
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
                        <label class="b3-form__label">${t("eventTitle")}</label>
                        <div class="title-input-container" style="display: flex; gap: 8px;">
                            <input type="text" id="editReminderTitle" class="b3-text-field" value="${this.setting.cleanTitle}" placeholder="${t("enterReminderTitle")}" style="flex: 1;">
                            <button type="button" id="editNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                ✨
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("blockContent")}</label>
                        <div class="block-content-display" style="padding: 8px; background: var(--b3-theme-surface-lighter); border-radius: 4px; font-size: 14px; color: var(--b3-theme-on-surface-light);">${this.setting.content}</div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("eventCategory")}
                            <button type="button" id="editManageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                            </button>
                        </label>
                        <div class="category-selector" id="editCategorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                            <!-- 分类选择器将在这里渲染 -->
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("projectManagement")}</label>
                        <select id="editProjectSelector" class="b3-select" style="width: 100%;">
                            <option value="">${t("noProject")}</option>
                            <!-- 项目选择器将在这里渲染 -->
                        </select>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("priority")}</label>
                        <div class="priority-selector" id="editPrioritySelector">
                            <div class="priority-option ${this.setting.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>${t("highPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>${t("mediumPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>${t("lowPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'none' ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>${t("noPriority")}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.setting.hasTime ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                        </label>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderDate")}</label>
                        <div class="reminder-date-container">
                            <input type="date" id="editReminderDate" class="b3-text-field" value="${this.setting.date}">
                            <span class="reminder-arrow">→</span>
                            <input type="date" id="editReminderEndDate" class="b3-text-field" placeholder="${t("endDateOptional")}">
                        </div>
                        <div class="b3-form__desc" id="editDateTimeDesc">${this.setting.hasTime ? t("dateTimeDesc") : t("dateOnlyDesc")}</div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("repeatSettings")}</label>
                        <div class="repeat-setting-container">
                            <button type="button" id="editRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                <span id="editRepeatDescription">${this.setting.repeatConfig?.enabled ? getRepeatDescription(this.setting.repeatConfig) : t("noRepeat")}</span>
                                <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="2" style="width: 100%;resize: vertical; min-height: 60px;">${this.setting.note}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="editSaveBtn">${t("saveSettings")}</button>
                </div>
            </div>
        `;
    }

    private async renderCategorySelector(dialog: Dialog) {
        const categorySelector = dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.plugin.categoryManager.getCategories();

            categorySelector.innerHTML = '';

            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = `category-option ${!this.setting.categoryId ? 'selected' : ''}`;
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${t("noCategory")}</span>`;
            categorySelector.appendChild(noCategoryEl);

            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = `category-option ${this.setting.categoryId === category.id ? 'selected' : ''}`;
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = `<div class="category-error">${t("loadCategoryFailed")}</div>`;
        }
    }

    private async renderProjectSelector(dialog: Dialog) {
        const projectSelector = dialog.element.querySelector('#editProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空选择器
            projectSelector.innerHTML = `<option value="">${t("noProject")}</option>`;

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
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="editNlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点等</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="editNlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editNlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="editNlConfirmBtn" disabled>应用</button>
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

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const input = nlInput.value.trim();
            if (!input) {
                nlPreview.textContent = '请输入日期时间描述';
                nlConfirmBtn.disabled = true;
                return;
            }

            const result = this.parseNaturalDateTime(input);
            currentParseResult = result;

            if (result.date) {
                const dateStr = new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN');
                const timeStr = result.time ? ` ${result.time}` : '';
                nlPreview.innerHTML = `<span style="color: var(--b3-theme-primary);">✅ ${dateStr}${timeStr}</span>`;
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

    // 解析自然语言日期时间 - 复用父类的逻辑
    private parseNaturalDateTime(text: string): { date?: string; time?: string; hasTime?: boolean } {
        try {
            // 先尝试解析农历日期
            const lunarDate = parseLunarDateText(text);
            if (lunarDate && lunarDate.month > 0) {
                const solarDate = getCurrentYearLunarToSolar(lunarDate.month, lunarDate.day);
                if (solarDate) {
                    return {
                        date: solarDate,
                        hasTime: false
                    };
                }
            }

            const results = this.chronoParser.parse(text, new Date());

            if (results && results.length > 0) {
                const result = results[0];
                const parsedDate = result.start.date();

                const year = parsedDate.getFullYear();
                const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
                const day = parsedDate.getDate().toString().padStart(2, '0');
                const date = `${year}-${month}-${day}`;

                let time: string | undefined;
                let hasTime = false;

                if (result.start.get('hour') !== undefined) {
                    const hour = result.start.get('hour').toString().padStart(2, '0');
                    const minute = (result.start.get('minute') || 0).toString().padStart(2, '0');
                    time = `${hour}:${minute}`;
                    hasTime = true;
                }

                return { date, time, hasTime };
            }
        } catch (error) {
            console.error('解析自然语言日期时间失败:', error);
        }

        return {};
    }

    // 应用自然语言识别结果
    private applyNaturalLanguageResult(dialog: Dialog, result: { date?: string; time?: string; hasTime?: boolean }) {
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

        // 更新显示
        this.toggleDateTimeInputs(dialog, !result.hasTime);

        showMessage(`✨ 已识别并设置：${new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN')}${result.time ? ` ${result.time}` : ''}`);
    }

    // 切换日期时间输入框类型
    private toggleDateTimeInputs(dialog: Dialog, noSpecificTime: boolean) {
        const dateTimeDesc = dialog.element.querySelector('#editDateTimeDesc') as HTMLElement;

        if (dateTimeDesc) {
            dateTimeDesc.textContent = noSpecificTime ? t("dateOnlyDesc") : t("dateTimeDesc");
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    private updateRepeatDescription(dialog: Dialog) {
        const repeatDescription = dialog.element.querySelector('#editRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.setting.repeatConfig?.enabled ? getRepeatDescription(this.setting.repeatConfig) : t("noRepeat");
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

        // 分类选择事件
        categorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                categorySelector.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 无时间复选框
        noTimeCheckbox?.addEventListener('change', () => {
            // 可以在这里处理时间输入框的状态，但这个对话框中没有时间输入框
        });

        // 重复设置按钮
        repeatSettingsBtn?.addEventListener('click', () => {
            const repeatDialog = new RepeatSettingsDialog(this.setting.repeatConfig, (config: RepeatConfig) => {
                this.setting.repeatConfig = config;
                this.updateRepeatDescription(dialog);
            });
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
        const selectedCategory = dialog.element.querySelector('#editCategorySelector .category-option.selected') as HTMLElement;
        const projectSelector = dialog.element.querySelector('#editProjectSelector') as HTMLSelectElement;

        if (!dateInput.value) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        // 更新设置
        this.setting.cleanTitle = titleInput.value.trim() || this.setting.content;
        this.setting.date = dateInput.value;
        this.setting.hasTime = !noTimeCheckbox.checked;
        this.setting.note = noteInput.value.trim();
        this.setting.priority = selectedPriority?.getAttribute('data-priority') || 'none';
        this.setting.categoryId = selectedCategory?.getAttribute('data-category') || '';
        this.setting.projectId = projectSelector.value || '';

        // 调用保存回调
        this.onSave(this.setting);

        showMessage(t("settingsApplied"));
        dialog.destroy();
    }



}