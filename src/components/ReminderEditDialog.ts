import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalTimeString, getLocalDateString } from "../utils/dateUtils";
import { CategoryManager, Category } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { t } from "../utils/i18n";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";
import * as chrono from 'chrono-node'; // 导入chrono-node

export class ReminderEditDialog {
    private dialog: Dialog;
    private reminder: any;
    private onSaved?: (modifiedReminder?: any) => void;
    private repeatConfig: RepeatConfig;
    private categoryManager: CategoryManager; // 添加分类管理器
    private projectManager: ProjectManager;
    private chronoParser: any; // chrono解析器实例
    private showKanbanStatus?: 'todo' | 'term' | 'none' = 'term'; // 看板状态显示模式，默认为 'term'
    private defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo' = 'doing'; // 默认任务类型

    constructor(reminder: any, onSaved?: (modifiedReminder?: any) => void, options?: {
        showKanbanStatus?: 'todo' | 'term' | 'none';
        defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo';
    }) {
        this.reminder = reminder;
        this.onSaved = onSaved;
        this.categoryManager = CategoryManager.getInstance(); // 初始化分类管理器
        this.projectManager = ProjectManager.getInstance(); // 初始化项目管理器

        // 处理额外选项
        if (options) {
            this.showKanbanStatus = options.showKanbanStatus || 'term';
            this.defaultTermType = options.defaultTermType;
        }

        // 初始化重复配置
        this.repeatConfig = reminder.repeat || {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

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
        // 基本范围检查
        if (year < 1900 || year > 2100) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;

        // 创建Date对象进行更精确的验证
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day;
    }

    // 解析自然语言日期时间
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

            const results = this.chronoParser.parse(text, new Date(), { forwardDate: false });

            if (results.length === 0) {
                return {};
            }

            const result = results[0];
            const parsedDate = result.start.date();

            // 格式化日期
            const date = parsedDate.toISOString().split('T')[0];

            // 检查是否包含时间信息
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

    // 从标题自动识别日期时间
    private autoDetectDateTimeFromTitle(title: string): { date?: string; time?: string; hasTime?: boolean; cleanTitle?: string } {
        const parseResult = this.parseNaturalDateTime(title);

        if (!parseResult.date) {
            return { cleanTitle: title };
        }

        // 尝试从标题中移除已识别的时间表达式
        let cleanTitle = title;
        const timeExpressions = [
            /今天|今日/gi,
            /明天|明日/gi,
            /后天/gi,
            /大后天/gi,
            /下?周[一二三四五六日天]/gi,
            /下?星期[一二三四五六日天]/gi,
            /\d{1,2}月\d{1,2}[日号]/gi,
            /\d{1,2}[点时]\d{0,2}[分]?/gi,
            /\d+天[后以]后/gi,
            /\d+小时[后以]后/gi,
        ];

        timeExpressions.forEach(pattern => {
            cleanTitle = cleanTitle.replace(pattern, '').trim();
        });

        // 清理多余的空格和标点
        cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、\s]+|[，。、\s]+$/g, '');

        return {
            ...parseResult,
            cleanTitle: cleanTitle || title // 如果清理后为空，则保持原标题
        };
    }

    // 显示自然语言输入对话框
    private showNaturalLanguageDialog() {
        // 获取当前任务标题作为默认值
        const titleInput = this.dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const currentTitle = titleInput?.value?.trim() || '';

        const nlDialog = new Dialog({
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="editNlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" value="${currentTitle.replace(/"/g, '&quot;')}" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点、农历八月廿一等</div>
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
            height: "30%"
        });

        const nlInput = nlDialog.element.querySelector('#editNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#editNlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#editNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#editNlConfirmBtn') as HTMLButtonElement;

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = '请输入日期时间描述';
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            currentParseResult = this.parseNaturalDateTime(text);

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
                nlConfirmBtn.disabled = false;
            } else {
                nlPreview.textContent = '❌ 无法识别日期时间，请尝试其他表达方式';
                nlPreview.className = 'nl-preview nl-preview--error';
                nlConfirmBtn.disabled = true;
            }
        };

        // 绑定事件
        nlInput.addEventListener('input', updatePreview);
        nlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !nlConfirmBtn.disabled) {
                this.applyNaturalLanguageResult(currentParseResult);
                nlDialog.destroy();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyNaturalLanguageResult(currentParseResult);
            nlDialog.destroy();
        });

        // 自动聚焦输入框并选中文本，同时立即触发预览更新
        setTimeout(() => {
            nlInput.focus();
            nlInput.select();
            // 如果有默认值，立即触发预览更新
            if (nlInput.value) {
                updatePreview();
            }
        }, 100);
    }

    // 应用自然语言识别结果
    private applyNaturalLanguageResult(result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const dateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;

        // 设置日期和时间
        if (result.hasTime && result.time) {
            // 有时间信息：先取消"不设置具体时间"，然后切换输入框类型，最后设置值
            noTimeCheckbox.checked = false;
            this.toggleDateTimeInputs(false);
            // 确保输入框已经切换为datetime-local类型后再设置值
            setTimeout(() => {
                dateInput.value = `${result.date}T${result.time}`;
                // 触发日期变化事件以更新结束日期限制
                dateInput.dispatchEvent(new Event('change'));
            }, 50);
        } else {
            // 只有日期信息：先勾选"不设置具体时间"，然后切换输入框类型，最后设置值
            noTimeCheckbox.checked = true;
            this.toggleDateTimeInputs(true);
            // 确保输入框已经切换为date类型后再设置值
            setTimeout(() => {
                dateInput.value = result.date;
                // 触发日期变化事件以更新结束日期限制
                dateInput.dispatchEvent(new Event('change'));
            }, 50);
        }

        showMessage(`✨ 已识别并设置：${new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN')}${result.time ? ` ${result.time}` : ''}`);
    }

    public async show() {
        // 初始化分类管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize(); // 初始化项目管理器

        this.dialog = new Dialog({
            title: this.reminder.isInstance ? t("modifyInstance") :
                this.reminder.isSplitOperation ? t("modifyAndSplit") : t("modifyEvent"),
            content: this.createDialogContent(),
            width: "500px",
            height: "80vh" // 增加高度以容纳分类选择器
        });

        this.bindEvents();
        await this.renderCategorySelector(); // 渲染分类选择器
        await this.renderProjectSelector(); // 渲染项目选择器
        await this.renderTermTypeSelector(); // 渲染任务类型选择器

        // 初始化日期时间输入框
        setTimeout(() => {
            const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
            const dateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;

            if (this.reminder.time) {
                // 有时间：设置为datetime-local格式
                noTimeCheckbox.checked = false;
                this.toggleDateTimeInputs(false);
                dateInput.value = `${this.reminder.date}T${this.reminder.time}`;

                // 处理结束时间：如果有结束日期或结束时间，设置结束日期输入框
                if (this.reminder.endDate) {
                    // 跨天事件：有明确的结束日期
                    const endTime = this.reminder.endTime || this.reminder.time;
                    endDateInput.value = `${this.reminder.endDate}T${endTime}`;
                } else if (this.reminder.endTime) {
                    // 同一天的时间段事件：只有结束时间，没有结束日期
                    endDateInput.value = `${this.reminder.date}T${this.reminder.endTime}`;
                }
            } else {
                // 无时间：设置为date格式
                noTimeCheckbox.checked = true;
                this.toggleDateTimeInputs(true);
                dateInput.value = this.reminder.date;

                if (this.reminder.endDate) {
                    endDateInput.value = this.reminder.endDate;
                }
            }
        }, 100);
    }

    private createDialogContent(): string {
        return `
            <div class="time-edit-dialog">
                <div class="b3-dialog__content">
                    ${this.reminder.isInstance ? `
                        <div class="b3-form__group">
                            <div class="b3-form__desc" style="color: var(--b3-theme-primary);">
                                ${t("editingInstanceDesc")}
                            </div>
                        </div>
                    ` : ''}
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("eventTitle")}</label>
                        <div class="title-input-container" style="display: flex; gap: 8px;">
                            <input type="text" id="editReminderTitle" class="b3-text-field" value="${this.reminder.title || ''}" placeholder="${t("enterReminderTitle")}" style="flex: 1;" >
                            <button type="button" id="editNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                ✨
                            </button>
                        </div>
                    </div>
                    <!-- 绑定块/文档输入，允许手动修改 reminder 关联的块 ID 或文档 ID -->
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("bindToBlock") || '块或文档 ID'}</label>
                        <input type="text" id="editBlockInput" class="b3-text-field" value="${this.reminder.blockId || this.reminder.docId || this.reminder.boundBlockId || ''}" placeholder="${t("enterBlockId") || '请输入块或文档 ID'}" style="width: 100%;">
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
                            <div class="priority-option ${this.reminder.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>${t("highPriority")}</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>${t("mediumPriority")}</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>${t("lowPriority")}</span>
                            </div>
                            <div class="priority-option ${(!this.reminder.priority || this.reminder.priority === 'none') ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>${t("noPriority")}</span>
                            </div>
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.reminder.time ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                        </label>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderDate")}</label>
                        <div class="reminder-date-container">
                            <input type="date" id="editReminderDate" class="b3-text-field" value="${this.reminder.date}" max="9999-12-31">
                            <span class="reminder-arrow">→</span>
                            <input type="date" id="editReminderEndDate" class="b3-text-field" value="${this.reminder.endDate || ''}" placeholder="${t("endDateOptional")}" max="9999-12-31">
                        </div>
                        <div class="b3-form__desc" id="editDateTimeDesc">${this.reminder.time ? t("dateTimeDesc") : t("dateOnlyDesc")}</div>
                    </div>
                    
                    ${!this.reminder.isInstance ? `
                    <!-- 重复设置只在非实例修改时显示 -->
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("repeatSettings")}</label>
                        <div class="repeat-setting-container">
                            <button type="button" id="editRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                <span id="editRepeatDescription">${this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat")}</span>
                                <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                            </button>
                        </div>
                    </div>
                    ` : ''}
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderNote")}</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="width: 100%;resize: vertical; min-height: 60px;">${this.reminder.note || ''}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="editConfirmBtn">
                        ${this.reminder.isSplitOperation ? t("splitAndSave") : t("save")}
                    </button>
                </div>
            </div>
        `;
    }

    private async renderCategorySelector() {
        const categorySelector = this.dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();

            // 清空并重新构建，使用横向布局
            categorySelector.innerHTML = '';

            // 添加无分类选项
            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = `category-option ${!this.reminder.categoryId ? 'selected' : ''}`;
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${t("noCategory")}</span>`;
            categorySelector.appendChild(noCategoryEl);

            // 添加所有分类选项
            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = `category-option ${this.reminder.categoryId === category.id ? 'selected' : ''}`;
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon || ''} ${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    // 切换日期时间输入框类型
    private toggleDateTimeInputs(noSpecificTime: boolean) {
        const startDateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const dateTimeDesc = this.dialog.element.querySelector('#editDateTimeDesc') as HTMLElement;

        if (noSpecificTime) {
            // 不设置具体时间：使用date类型
            // 先保存当前值
            const startValue = startDateInput.value;
            const endValue = endDateInput.value;

            // 切换类型和max属性
            startDateInput.type = 'date';
            endDateInput.type = 'date';
            startDateInput.max = '9999-12-31';
            endDateInput.max = '9999-12-31';

            // 如果当前值包含时间，只保留日期部分，不清空日期
            if (startValue && startValue.includes('T')) {
                startDateInput.value = startValue.split('T')[0];
            } else if (startValue) {
                startDateInput.value = startValue;
            }

            if (endValue && endValue.includes('T')) {
                endDateInput.value = endValue.split('T')[0];
            } else if (endValue) {
                endDateInput.value = endValue;
            }

            if (dateTimeDesc) {
                dateTimeDesc.textContent = t("dateOnlyDesc");
            }
        } else {
            // 设置具体时间：使用datetime-local类型
            // 先保存当前值
            const startValue = startDateInput.value;
            const endValue = endDateInput.value;

            // 切换类型和max属性
            startDateInput.type = 'datetime-local';
            endDateInput.type = 'datetime-local';
            startDateInput.max = '9999-12-31T23:59';
            endDateInput.max = '9999-12-31T23:59';

            // 如果当前值只有日期，添加默认时间，保留原有日期
            if (startValue && !startValue.includes('T')) {
                const currentTime = this.reminder.time || getLocalTimeString();
                startDateInput.value = `${startValue}T${currentTime}`;
            } else if (!startValue) {
                // 如果没有日期值，设置默认日期和时间
                const currentTime = this.reminder.time || getLocalTimeString();
                startDateInput.value = `${this.reminder.date}T${currentTime}`;
            } else {
                // 如果已经有完整的datetime-local格式，直接设置
                startDateInput.value = startValue;
            }

            // 处理结束日期输入框
            if (endValue && !endValue.includes('T')) {
                // 如果结束日期有值但没有时间，添加默认时间
                const endTime = this.reminder.endTime || this.reminder.time || getLocalTimeString();
                endDateInput.value = `${endValue}T${endTime}`;
            } else if (endValue) {
                // 如果已经有完整的datetime-local格式，直接设置
                endDateInput.value = endValue;
            }

            if (dateTimeDesc) {
                dateTimeDesc.textContent = t("dateTimeDesc");
            }
        }
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#editPrioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        const editManageCategoriesBtn = this.dialog.element.querySelector('#editManageCategoriesBtn') as HTMLButtonElement;
        const editNlBtn = this.dialog.element.querySelector('#editNlBtn') as HTMLButtonElement;

        // 优先级选择事件
        prioritySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 分类选择事件 - 增强选中效果
        categorySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                // 移除所有选中状态
                categorySelector.querySelectorAll('.category-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                // 添加选中状态
                option.classList.add('selected');

                // 添加点击反馈动画
                option.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    option.style.transform = '';
                }, 150);
            }
        });

        cancelBtn.addEventListener('click', () => {
            this.dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveTimeEdit();
        });

        // 时间复选框 - 切换日期输入框类型
        noTimeCheckbox.addEventListener('change', () => {
            this.toggleDateTimeInputs(noTimeCheckbox.checked);
        });

        startDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            endDateInput.min = startDate;
        });

        endDateInput.addEventListener('change', () => {
            // 移除立即验证逻辑，只在保存时验证
        });

        // 管理分类按钮事件
        editManageCategoriesBtn?.addEventListener('click', () => {
            this.showCategoryManageDialog();
        });

        // 重复设置按钮
        const editRepeatSettingsBtn = this.dialog.element.querySelector('#editRepeatSettingsBtn') as HTMLButtonElement;
        editRepeatSettingsBtn?.addEventListener('click', () => {
            this.showRepeatSettingsDialog();
        });

        // 自然语言识别按钮
        editNlBtn?.addEventListener('click', () => {
            this.showNaturalLanguageDialog();
        });
    }

    private showRepeatSettingsDialog() {
        // 获取当前设置的开始日期
        const startDateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        let startDate = startDateInput?.value;

        // 如果没有设置开始日期，使用初始日期或今天的日期
        if (!startDate) {
            startDate = this.reminder.date || getLocalDateString();
        }

        // 如果是农历重复类型，需要重新计算农历日期
        if (this.repeatConfig.enabled &&
            (this.repeatConfig.type === 'lunar-monthly' || this.repeatConfig.type === 'lunar-yearly')) {
            // 清除现有的农历日期，让 RepeatSettingsDialog 重新计算
            this.repeatConfig.lunarDay = undefined;
            this.repeatConfig.lunarMonth = undefined;
        }

        const repeatDialog = new RepeatSettingsDialog(this.repeatConfig, (config: RepeatConfig) => {
            this.repeatConfig = config;
            this.updateRepeatDescription();
        }, startDate);
        repeatDialog.show();
    }

    private updateRepeatDescription() {
        const repeatDescription = this.dialog.element.querySelector('#editRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private async saveTimeEdit() {
        const titleInput = this.dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const blockInput = this.dialog.element.querySelector('#editBlockInput') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const selectedPriority = this.dialog.element.querySelector('#editPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = this.dialog.element.querySelector('#editCategorySelector .category-option.selected') as HTMLElement;
        const projectSelector = this.dialog.element.querySelector('#editProjectSelector') as HTMLSelectElement;
        const selectedTermType = this.dialog.element.querySelector('#editTermTypeSelector .term-type-option.selected') as HTMLElement;

        const title = titleInput.value.trim();
        const inputId = blockInput?.value?.trim() || undefined;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';
        const categoryId = selectedCategory?.getAttribute('data-category') || undefined;
        const projectId = projectSelector.value || undefined;
        const termType = selectedTermType?.getAttribute('data-term-type') as 'short_term' | 'long_term' | 'doing' | 'todo' | undefined;

        // 解析日期和时间
        let date: string;
        let endDate: string;
        let time: string | undefined;
        let endTime: string | undefined;

        if (noTimeCheckbox.checked) {
            // 不设置具体时间：直接使用date值
            date = dateInput.value || undefined;
            endDate = endDateInput.value || undefined;
            time = undefined;
            endTime = undefined;
        } else {
            // 设置具体时间：从datetime-local值中解析
            if (dateInput.value.includes('T')) {
                const [dateStr, timeStr] = dateInput.value.split('T');
                date = dateStr;
                time = timeStr;
            } else {
                date = dateInput.value || undefined;
                time = undefined;
            }

            if (endDateInput.value) {
                if (endDateInput.value.includes('T')) {
                    const [endDateStr, endTimeStr] = endDateInput.value.split('T');
                    endDate = endDateStr;
                    endTime = endTimeStr;
                } else {
                    endDate = endDateInput.value || undefined;
                    endTime = undefined;
                }
            } else {
                endDate = undefined;
                endTime = undefined;
            }
        }

        if (!title) {
            showMessage(t("pleaseEnterTitle"));
            return;
        }

        // 验证结束日期时间不能早于开始日期时间
        if (endDate && date) {
            const startDateTime = time ? `${date}T${time}` : `${date}T00:00:00`;
            const endDateTime = endTime ? `${endDate}T${endTime}` : `${endDate}T00:00:00`;

            if (new Date(endDateTime) < new Date(startDateTime)) {
                showMessage(t("endDateCannotBeEarlier"));
                return;
            }
        }

        // 检查新的日期时间是否在未来，如果是则重置通知状态
        const shouldResetNotified = this.shouldResetNotification(date, time);

        try {
            if (this.reminder.isSplitOperation) {
                // 分割操作 - 构建修改后的数据并通过回调传递
                const modifiedReminder = {
                    ...this.reminder,
                    title: title,
                    date: date,
                    endDate: endDate,
                    time: time,
                    endTime: endTime,
                    note: note,
                    priority: priority,
                    categoryId: categoryId, // 添加分类ID
                    blockId: inputId || undefined,
                    projectId: projectId,
                    repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                    notified: shouldResetNotified ? false : this.reminder.notified,
                    // 设置任务类型
                    termType: termType,
                    kanbanStatus: termType === 'doing' ? 'doing' : 'todo'
                };

                // 调用分割回调
                if (this.onSaved) {
                    await this.onSaved(modifiedReminder);
                }

                this.dialog.destroy();
                return;
            }

            if (this.reminder.isInstance) {
                // 保存重复事件实例的修改
                await this.saveInstanceModification({
                    originalId: this.reminder.originalId,
                    instanceDate: this.reminder.instanceDate,
                    title: title,
                    date: date,
                    endDate: endDate,
                    time: time,
                    endTime: endTime,
                    note: note,
                    priority: priority,
                    categoryId: categoryId, // 添加分类ID
                    blockId: inputId || undefined,
                    projectId: projectId,
                    notified: shouldResetNotified ? false : this.reminder.notified,
                    termType: termType,
                    kanbanStatus: termType === 'doing' ? 'doing' : 'todo'
                });
            } else {
                // 保存普通事件或重复事件系列的修改
                const reminderData = await readReminderData();
                if (reminderData[this.reminder.id]) {
                    reminderData[this.reminder.id].title = title;
                    reminderData[this.reminder.id].date = date;
                    reminderData[this.reminder.id].time = time;
                    reminderData[this.reminder.id].note = note;
                    reminderData[this.reminder.id].priority = priority;
                    reminderData[this.reminder.id].categoryId = categoryId; // 添加分类ID

                    // 设置任务类型
                    if (termType) {
                        reminderData[this.reminder.id].termType = termType;
                        // 根据termType设置kanbanStatus
                        if (termType === 'doing') {
                            reminderData[this.reminder.id].kanbanStatus = 'doing';
                        } else if (termType === 'todo' || termType === 'short_term' || termType === 'long_term') {
                            reminderData[this.reminder.id].kanbanStatus = 'todo';
                        }
                    }

                    // 检查项目ID是否发生变化
                    const oldProjectId = reminderData[this.reminder.id].projectId;
                    const projectIdChanged = oldProjectId !== projectId;

                    reminderData[this.reminder.id].projectId = projectId;
                    reminderData[this.reminder.id].repeat = this.repeatConfig.enabled ? this.repeatConfig : undefined;

                    // 如果项目ID发生变化，更新所有子任务的项目ID
                    if (projectIdChanged) {
                        this.updateChildrenProjectId(reminderData, this.reminder.id, projectId);
                    }

                    // 重置通知状态
                    if (shouldResetNotified) {
                        reminderData[this.reminder.id].notified = false;
                    }

                    // 处理输入 ID（可能是块 ID 或文档 ID）
                    if (inputId) {
                        try {
                            const blockInfo = await getBlockByID(inputId);
                            // 如果 blockInfo 存在且 type !== 'd'，视为块，保存 blockId 并设置 docId 为 root_id 或 inputId
                            if (blockInfo && blockInfo.type && blockInfo.type !== 'd') {
                                reminderData[this.reminder.id].blockId = inputId;
                                reminderData[this.reminder.id].docId = blockInfo.root_id || inputId;
                            } else {
                                // 否则视为文档 ID，保存 docId 和 blockId
                                reminderData[this.reminder.id].docId = inputId;
                                reminderData[this.reminder.id].blockId = inputId;

                            }
                        } catch (err) {
                            // 如果 getBlockByID 抛错或不存在，保守地当作 blockId 保存
                            reminderData[this.reminder.id].blockId = inputId;
                        }
                    } else {
                        // 未填写：删除 blockId 和 docId
                        delete reminderData[this.reminder.id].blockId;
                        delete reminderData[this.reminder.id].docId;
                    }

                    // 处理结束日期和结束时间
                    if (endDate && endDate !== date) {
                        // 跨天事件
                        reminderData[this.reminder.id].endDate = endDate;
                    } else {
                        // 同一天事件，删除结束日期
                        delete reminderData[this.reminder.id].endDate;
                    }

                    // 处理结束时间
                    if (endTime) {
                        reminderData[this.reminder.id].endTime = endTime;
                    } else {
                        delete reminderData[this.reminder.id].endTime;
                    }

                    // 如果是周期任务，且配置已启用，自动完成所有过去的实例
                    if (this.repeatConfig.enabled && date) {
                        const { generateRepeatInstances } = await import("../utils/repeatUtils");
                        const { getLocalDateString } = await import("../utils/dateUtils");
                        const today = getLocalDateString();

                        // 计算从开始日期到今天的天数，用于设置 maxInstances
                        const startDateObj = new Date(date);
                        const todayObj = new Date(today);
                        const daysDiff = Math.ceil((todayObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));

                        // 根据重复类型估算可能的最大实例数
                        let maxInstances = 1000; // 默认值
                        if (this.repeatConfig.type === 'daily') {
                            maxInstances = Math.max(daysDiff + 10, 1000); // 每日重复，最多是天数
                        } else if (this.repeatConfig.type === 'weekly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 7) + 10, 500);
                        } else if (this.repeatConfig.type === 'monthly' || this.repeatConfig.type === 'lunar-monthly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 30) + 10, 200);
                        } else if (this.repeatConfig.type === 'yearly' || this.repeatConfig.type === 'lunar-yearly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 365) + 10, 50);
                        }

                        // 重新生成从任务开始日期到今天的所有实例
                        const instances = generateRepeatInstances(reminderData[this.reminder.id], date, today, maxInstances);

                        // 获取已有的已完成实例列表
                        const existingCompletedInstances = reminderData[this.reminder.id].repeat?.completedInstances || [];

                        // 将所有早于今天且尚未标记为完成的实例标记为已完成
                        const pastInstances: string[] = [];
                        instances.forEach(instance => {
                            if (instance.date < today && !existingCompletedInstances.includes(instance.date)) {
                                pastInstances.push(instance.date);
                            }
                        });

                        // 如果有新的过去实例，添加到completedInstances
                        if (pastInstances.length > 0) {
                            if (!reminderData[this.reminder.id].repeat.completedInstances) {
                                reminderData[this.reminder.id].repeat.completedInstances = [];
                            }
                            reminderData[this.reminder.id].repeat.completedInstances.push(...pastInstances);
                            console.log(`自动完成了 ${pastInstances.length} 个过去的周期实例（共生成 ${instances.length} 个实例）`);
                        }
                    }

                    await writeReminderData(reminderData);
                }
            }

            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 显示保存成功消息
            const isSpanning = endDate && endDate !== date;
            let dateStr: string;

            if (isSpanning) {
                // 跨天事件
                const startTimeStr = time ? ` ${time}` : '';
                const endTimeStr = endTime ? ` ${endTime}` : '';
                dateStr = `${date}${startTimeStr} → ${endDate}${endTimeStr}`;
            } else if (endTime && time) {
                // 同一天的时间段事件
                dateStr = `${date} ${time} - ${endTime}`;
            } else {
                // 普通事件
                const timeStr = time ? ` ${time}` : '';
                dateStr = `${date}${timeStr}`;
            }

            let successMessage = this.reminder.isInstance ? t("instanceModified") : t("reminderUpdated");
            successMessage += `: ${dateStr}`;

            if (!this.reminder.isInstance && this.repeatConfig.enabled) {
                successMessage += `，${getRepeatDescription(this.repeatConfig)}`;
            }

            // 添加分类信息到成功消息
            if (categoryId) {
                const category = this.categoryManager.getCategoryById(categoryId);
                if (category) {
                    successMessage += `，${t("category")}: ${category.name}`;
                }
            }

            // 添加项目信息到成功消息
            if (projectId) {
                const project = this.projectManager.getProjectById(projectId);
                if (project) {
                    successMessage += `，${t("project")}: ${project.name}`;
                }
            }

            // showMessage(successMessage);

            // 调用保存回调（不传递参数，表示正常保存）
            if (this.onSaved) {
                this.onSaved();
            }

            this.dialog.destroy();
        } catch (error) {
            console.error('保存修改失败:', error);
            showMessage(t("saveReminderFailed"));
        }
    }

    private shouldResetNotification(date: string, time?: string): boolean {
        try {
            const now = new Date();
            const newDateTime = new Date(`${date}T${time || '00:00:00'}`);

            // 如果新的日期时间在当前时间之后，应该重置通知状态
            return newDateTime > now;
        } catch (error) {
            console.error('检查通知重置条件失败:', error);
            return false;
        }
    }

    private async saveInstanceModification(instanceData: any & { termType?: string; kanbanStatus?: string }) {
        // 保存重复事件实例的修改
        try {
            const originalId = instanceData.originalId;
            const instanceDate = instanceData.instanceDate;

            const reminderData = await readReminderData();

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat) {
                reminderData[originalId].repeat = {};
            }
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            // 保存此实例的修改数据（包括分类和项目）
            reminderData[originalId].repeat.instanceModifications[instanceDate] = {
                title: instanceData.title,
                date: instanceData.date,
                endDate: instanceData.endDate,
                time: instanceData.time,
                endTime: instanceData.endTime,
                note: instanceData.note,
                priority: instanceData.priority,
                categoryId: instanceData.categoryId, // 添加分类ID
                projectId: instanceData.projectId, // 添加项目ID
                notified: instanceData.notified, // 添加通知状态
                modifiedAt: new Date().toISOString(),
                // 设置任务类型
                termType: instanceData.termType,
                kanbanStatus: instanceData.kanbanStatus
            };

            await writeReminderData(reminderData);

        } catch (error) {
            console.error('保存实例修改失败:', error);
            throw error;
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染分类选择器
            this.renderCategorySelector();
            // 触发全局提醒更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        categoryDialog.show();
    }

    private async renderProjectSelector() {
        const projectSelector = this.dialog.element.querySelector('#editProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空并重新构建项目选择器
            projectSelector.innerHTML = '';

            // 添加无项目选项
            const noProjectOption = document.createElement('option');
            noProjectOption.value = '';
            noProjectOption.textContent = t('noProject');
            if (!this.reminder.projectId) {
                noProjectOption.selected = true;
            }
            projectSelector.appendChild(noProjectOption);

            // 按状态分组添加项目
            Object.keys(groupedProjects).forEach(statusKey => {
                const projects = groupedProjects[statusKey] || [];
                const nonArchivedProjects = projects.filter(project => {
                    const projectStatus = this.projectManager.getProjectById(project.id)?.status || 'doing';
                    return projectStatus !== 'archived';
                });

                if (nonArchivedProjects.length > 0) {
                    // 添加状态分组
                    const statusName = this.getStatusDisplayName(statusKey);
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = statusName;

                    nonArchivedProjects.forEach(project => {
                        const option = document.createElement('option');
                        option.value = project.id;
                        option.textContent = project.name;

                        // 如果提醒有项目ID，选中它
                        if (this.reminder.projectId === project.id) {
                            option.selected = true;
                        }

                        optgroup.appendChild(option);
                    });

                    projectSelector.appendChild(optgroup);
                }
            });
        } catch (error) {
            console.error('渲染项目选择器失败:', error);
            projectSelector.innerHTML = '<option value="">加载项目失败</option>';
        }
    }

    // 渲染任务类型选择器
    private renderTermTypeSelector(): void {
        // 如果 showKanbanStatus 为 'none'，不显示任务类型选择器
        if (this.showKanbanStatus === 'none') {
            return;
        }

        // 根据reminder的当前状态确定默认选中项，优先使用现有状态
        let currentTermType: 'short_term' | 'long_term' | 'doing' | 'todo' | undefined;

        // 优先使用现有提醒的状态
        if (this.reminder.kanbanStatus === 'doing') {
            currentTermType = 'doing';
        } else if (this.reminder.termType) {
            currentTermType = this.reminder.termType as 'short_term' | 'long_term' | 'doing' | 'todo';
        } else if (this.reminder.kanbanStatus === 'todo') {
            currentTermType = 'short_term'; // 默认todo为短期待办
        }

        // 如果没有现有状态，使用默认值
        if (!currentTermType) {
            currentTermType = this.defaultTermType;
        }

        // 根据showKanbanStatus调整currentTermType，确保显示的选项中至少有一个被选中
        if (this.showKanbanStatus === 'todo') {
            // 当只显示todo和doing时，将short_term和long_term映射为todo
            if (currentTermType === 'short_term' || currentTermType === 'long_term') {
                currentTermType = 'todo';
            }
        }

        let options = '';

        if (this.showKanbanStatus === 'todo') {
            // 显示 todo 和 doing
            options = `
                <div class="term-type-option ${currentTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
                <div class="term-type-option ${currentTermType === 'todo' ? 'selected' : ''}" data-term-type="todo">
                    <span>📝 待办</span>
                </div>
            `;
        } else if (this.showKanbanStatus === 'term') {
            // 显示 doing、short_term、long_term
            options = `
                <div class="term-type-option ${currentTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
                <div class="term-type-option ${currentTermType === 'short_term' || (!currentTermType && this.showKanbanStatus === 'term') ? 'selected' : ''}" data-term-type="short_term">
                    <span>📋 短期待办</span>
                </div>
                <div class="term-type-option ${currentTermType === 'long_term' ? 'selected' : ''}" data-term-type="long_term">
                    <span>📅 长期待办</span>
                </div>
            `;
        } else {
            // 默认情况（showKanbanStatus === 'todo'），显示 todo 和 doing
            options = `
                <div class="term-type-option ${currentTermType === 'todo' ? 'selected' : ''}" data-term-type="todo">
                    <span>📝 待办</span>
                </div>
                <div class="term-type-option ${currentTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
            `;
        }

        // 找到优先级选择器，在它之后插入任务类型选择器
        const prioritySelector = this.dialog.element.querySelector('#editPrioritySelector') as HTMLElement;
        if (prioritySelector && prioritySelector.parentElement) {
            const termTypeGroup = document.createElement('div');
            termTypeGroup.className = 'b3-form__group';
            termTypeGroup.innerHTML = `
                <label class="b3-form__label">任务类型</label>
                <div class="term-type-selector" id="editTermTypeSelector" style="display: flex; gap: 12px;">
                    ${options}
                </div>
            `;
            prioritySelector.parentElement.insertBefore(termTypeGroup, prioritySelector.nextSibling);

            // 绑定任务类型选择事件
            const termTypeSelector = termTypeGroup.querySelector('#editTermTypeSelector') as HTMLElement;
            termTypeSelector?.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const option = target.closest('.term-type-option') as HTMLElement;
                if (option) {
                    termTypeSelector.querySelectorAll('.term-type-option').forEach(opt => opt.classList.remove('selected'));
                    option.classList.add('selected');
                }
            });
        }
    }

    /**
     * 递归更新所有子任务的项目ID
     * @param reminderData 所有提醒数据
     * @param parentId 父任务ID
     * @param projectId 新的项目ID
     */
    private updateChildrenProjectId(reminderData: any, parentId: string, projectId: string | undefined): void {
        // 查找所有直接子任务
        const children = Object.values(reminderData).filter((reminder: any) =>
            reminder && reminder.parentId === parentId
        );

        // 递归更新每个子任务及其子任务
        children.forEach((child: any) => {
            if (child && child.id) {
                child.projectId = projectId;
                // 递归更新子任务的子任务
                this.updateChildrenProjectId(reminderData, child.id, projectId);
            }
        });
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }
}
