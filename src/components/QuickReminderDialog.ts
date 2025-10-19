import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, getLocalTimeString } from "../utils/dateUtils";
import { CategoryManager, Category } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { t } from "../utils/i18n";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";
import { CategoryManageDialog } from "./CategoryManageDialog";
import * as chrono from 'chrono-node';
import { parseLunarDateText, getCurrentYearLunarToSolar } from "../utils/lunarUtils";

export class QuickReminderDialog {
    private dialog: Dialog;
    private onSaved?: () => void;
    private repeatConfig: RepeatConfig;
    private categoryManager: CategoryManager;
    private initialDate: string;
    private initialTime?: string;
    private initialEndDate?: string;
    private initialEndTime?: string;
    private isTimeRange: boolean = false;
    private chronoParser: any;
    private projectManager: ProjectManager;
    private defaultProjectId?: string;
    private defaultQuadrant?: string;
    private defaultTitle?: string;
    private defaultNote?: string;
    private defaultCategoryId?: string;
    private defaultPriority?: string;
    private defaultBlockId?: string;
    private plugin: any; // 添加plugin引用以访问设置
    private hideProjectSelector?: boolean; // 是否隐藏项目选择器

    private showKanbanStatus?: 'todo' | 'term' | 'none' = 'term'; // 看板状态显示模式，默认为 'term'
    private defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo' = 'doing'; // 默认任务类型

    constructor(initialDate?: string, initialTime?: string, onSaved?: () => void, timeRangeOptions?: {
        endDate?: string;
        endTime?: string;
        isTimeRange?: boolean;
    }, options?: {
        defaultProjectId?: string;
        defaultQuadrant?: string;
        defaultTitle?: string;
        defaultNote?: string;
        defaultCategoryId?: string;
        defaultPriority?: string;
        defaultBlockId?: string;
        plugin?: any; // 添加plugin选项
        hideProjectSelector?: boolean; // 是否隐藏项目选择器
        showKanbanStatus?: 'todo' | 'term' | 'none'; // 看板状态显示模式，默认为 'term'
        defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo'; // 默认任务类型
    }) {
        // 确保日期格式正确 - 只保留 YYYY-MM-DD 部分
        this.initialDate = initialDate ? this.formatDateForInput(initialDate) : '';

        // 如果第二个参数是函数，说明没有传入时间参数，第二个参数是回调函数
        if (typeof initialTime === 'function') {
            this.onSaved = initialTime;
            this.initialTime = undefined;
        } else {
            // 正常情况：有时间参数和回调函数
            this.initialTime = initialTime;
            this.onSaved = onSaved;
        }

        // 处理时间段选项
        if (timeRangeOptions) {
            this.initialEndDate = timeRangeOptions.endDate ? this.formatDateForInput(timeRangeOptions.endDate) : undefined;
            this.initialEndTime = timeRangeOptions.endTime;
            this.isTimeRange = timeRangeOptions.isTimeRange || false;
        }

        // 处理额外选项
        if (options) {
            this.defaultProjectId = options.defaultProjectId;
            this.defaultQuadrant = options.defaultQuadrant;
            this.defaultTitle = options.defaultTitle;
            this.defaultNote = options.defaultNote;
            this.defaultCategoryId = options.defaultCategoryId;
            this.defaultPriority = options.defaultPriority;
            this.defaultBlockId = options.defaultBlockId;
            this.plugin = options.plugin; // 保存plugin引用
            this.hideProjectSelector = options.hideProjectSelector;
            this.showKanbanStatus = options.showKanbanStatus || 'term'; // 默认为 'term'
            this.defaultTermType = options.defaultTermType || 'doing'; // 默认为 'doing'
        }

        this.categoryManager = CategoryManager.getInstance();
        this.projectManager = ProjectManager.getInstance();
        this.repeatConfig = {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

        // 初始化chrono解析器，配置中文支持
        this.chronoParser = chrono.zh.casual.clone();
        this.setupChronoParser();
    }

    // 格式化日期为 input[type="date"] 所需的格式 (YYYY-MM-DD)
    private formatDateForInput(dateStr: string): string {
        if (!dateStr) return '';

        // 如果已经是正确格式 (YYYY-MM-DD)，直接返回
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }

        // 如果包含时间信息，提取日期部分
        if (dateStr.includes('T')) {
            return dateStr.split('T')[0];
        }

        // 尝试解析日期并格式化
        try {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
        } catch (error) {
            console.warn('无法解析日期:', dateStr, error);
        }

        return dateStr; // 如果无法解析，返回原始值
    }

    // 设置chrono解析器
    private setupChronoParser() {
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

            // 处理包含8位数字日期的情况
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

            // 处理农历日期格式（例如：八月廿一、正月初一、农历七月十三）
            const lunarDate = parseLunarDateText(processedText);
            if (lunarDate && lunarDate.month > 0) {
                // 有完整的农历月日
                const solarDate = getCurrentYearLunarToSolar(lunarDate.month, lunarDate.day);
                if (solarDate) {
                    console.log(`农历日期识别成功: 农历${lunarDate.month}月${lunarDate.day}日 -> 公历${solarDate}`);
                    return {
                        date: solarDate,
                        hasTime: false
                    };
                }
            }

            // 使用chrono解析其他格式
            const results = this.chronoParser.parse(processedText, new Date(), { forwardDate: false });

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
            /\d{8}/gi, // 8位数字日期
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
        // 获取标题输入框的内容作为默认值
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const defaultValue = titleInput?.value?.trim() || '';

        const nlDialog = new Dialog({
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="quickNlInput" class="b3-text-field" value="${defaultValue}" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点、农历八月廿一等</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="quickNlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickNlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="quickNlConfirmBtn" disabled>应用</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "30%"
        });

        const nlInput = nlDialog.element.querySelector('#quickNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#quickNlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#quickNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#quickNlConfirmBtn') as HTMLButtonElement;

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

        // 自动聚焦输入框并触发预览更新
        setTimeout(() => {
            nlInput.focus();
            // 如果有默认值，立即触发预览更新
            if (defaultValue) {
                updatePreview();
            }
        }, 100);
    }

    // 应用自然语言识别结果
    private applyNaturalLanguageResult(result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;

        // 设置日期和时间
        if (result.hasTime && result.time) {
            // 有时间信息：先设置复选框状态，再切换输入框类型，最后设置值
            noTimeCheckbox.checked = false;
            this.toggleDateTimeInputs(false);
            // 确保在切换类型后设置正确格式的值
            dateInput.value = `${result.date}T${result.time}`;
        } else {
            // 只有日期信息：先设置复选框状态，再切换输入框类型，最后设置值
            noTimeCheckbox.checked = true;
            this.toggleDateTimeInputs(true);
            // 确保在切换类型后设置正确格式的值
            dateInput.value = result.date;
        }

        // 触发日期变化事件以更新结束日期限制
        dateInput.dispatchEvent(new Event('change'));

        showMessage(`✨ 已识别并设置：${new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN')}${result.time ? ` ${result.time}` : ''}`);
    }

    public async show() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        const currentTime = this.initialTime || getLocalTimeString();

        this.dialog = new Dialog({
            title: t("createQuickReminder"),
            content: `
                <div class="quick-reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("eventTitle")}</label>
                            <div class="title-input-container" style="display: flex; gap: 8px;">
                                <input type="text" id="quickReminderTitle" class="b3-text-field" placeholder="${t("enterReminderTitle")}" style="flex: 1;" required autofocus>
                                <button type="button" id="quickNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                    ✨
                                </button>
                            </div>
                        </div>
                        <!-- 绑定块/文档输入，允许手动输入块 ID 或文档 ID -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("bindToBlock") || '块或文档 ID'}</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="quickBlockInput" class="b3-text-field" value="${this.defaultBlockId || ''}" placeholder="${t("enterBlockId") || '请输入块或文档 ID'}" style="flex: 1;">
                                <button type="button" id="quickCreateDocBtn" class="b3-button b3-button--outline" title="${t("createNewDocument") || '新建文档'}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("eventCategory")}
                                <button type="button" id="quickManageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                                </button>
                            </label>
                            <div class="category-selector" id="quickCategorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                                <!-- 分类选择器将在这里渲染 -->
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickProjectGroup" style="${this.hideProjectSelector ? 'display: none;' : ''}">
                            <label class="b3-form__label">${t("projectManagement")}</label>
                            <select id="quickProjectSelector" class="b3-select" style="width: 100%;">
                                <option value="">${t("noProject")}</option>
                                <!-- 项目选择器将在这里渲染 -->
                            </select>
                        </div>
                        ${this.renderTermTypeSelector()}
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("priority")}</label>
                            <div class="priority-selector" id="quickPrioritySelector">
                                <div class="priority-option" data-priority="high">
                                    <div class="priority-dot high"></div>
                                    <span>${t("highPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="medium">
                                    <div class="priority-dot medium"></div>
                                    <span>${t("mediumPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="low">
                                    <div class="priority-dot low"></div>
                                    <span>${t("lowPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>${t("noPriority")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="quickNoSpecificTime" ${this.initialTime ? '' : 'checked'}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                            </label>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderDate")}${this.defaultProjectId ? ' (可选)' : ''}</label>
                            <div class="reminder-date-container">
                                <input type="date" id="quickReminderDate" class="b3-text-field" value="${this.initialDate}" max="9999-12-31">
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="quickReminderEndDate" class="b3-text-field reminder-end-date" placeholder="${t("endDateOptional")}" title="${t("spanningEventDesc")}" max="9999-12-31">
                            </div>
                            <div class="b3-form__desc" id="quickDateTimeDesc">${this.initialTime ? t("dateTimeDesc") : (this.defaultProjectId ? '项目任务可以不设置日期' : t("dateOnlyDesc"))}</div>
                        </div>
                        
                        <!-- 添加重复设置 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("repeatSettings")}</label>
                            <div class="repeat-setting-container">
                                <button type="button" id="quickRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                    <span id="quickRepeatDescription">${t("noRepeat")}</span>
                                    <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                            <textarea id="quickReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="2" style="width: 100%;resize: vertical; min-height: 60px;"></textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="quickConfirmBtn">${t("save")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "81vh"
        });

        this.bindEvents();
        await this.renderCategorySelector();
        await this.renderProjectSelector();
        await this.renderPrioritySelector();

        // 确保日期和时间输入框正确设置初始值
        setTimeout(() => {
            const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
            const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
            const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;

            // 根据是否有初始时间设置输入框类型和值
            if (this.initialTime) {
                // 有时间：先设置复选框状态，再切换输入框类型，最后设置值
                noTimeCheckbox.checked = false;
                this.toggleDateTimeInputs(false);
                // 确保在切换类型后设置正确格式的值
                dateInput.value = `${this.initialDate}T${this.initialTime}`;

                // 如果是时间段选择且有结束时间，设置结束日期时间
                if (this.isTimeRange && this.initialEndDate) {
                    const endDateTime = this.initialEndTime ?
                        `${this.initialEndDate}T${this.initialEndTime}` :
                        `${this.initialEndDate}T${this.initialTime}`;
                    endDateInput.value = endDateTime;
                }
            } else {
                // 无时间：先设置复选框状态，再切换输入框类型，最后设置值
                noTimeCheckbox.checked = true;
                this.toggleDateTimeInputs(true);
                // 确保在切换类型后设置正确格式的值
                // 如果没有初始日期（空字符串），则保持输入框为空
                if (this.initialDate) {
                    dateInput.value = this.initialDate;
                }

                // 如果是时间段选择，设置结束日期
                if (this.isTimeRange && this.initialEndDate) {
                    // 确保结束日期输入框也是正确的类型
                    endDateInput.value = this.initialEndDate;
                }
            }

            // 设置默认值
            if (this.defaultTitle && titleInput) {
                titleInput.value = this.defaultTitle;
            }

            if (this.defaultNote) {
                const noteInput = this.dialog.element.querySelector('#quickReminderNote') as HTMLTextAreaElement;
                if (noteInput) {
                    noteInput.value = this.defaultNote;
                }
            }

            // 自动聚焦标题输入框
            titleInput?.focus();
        }, 50);
    }

    private async renderPrioritySelector() {
        const prioritySelector = this.dialog.element.querySelector('#quickPrioritySelector') as HTMLElement;
        if (!prioritySelector) return;

        const priorityOptions = prioritySelector.querySelectorAll('.priority-option');

        // 移除所有选中状态
        priorityOptions.forEach(option => {
            option.classList.remove('selected');
        });

        // 设置默认优先级选择
        if (this.defaultPriority) {
            priorityOptions.forEach(option => {
                const priority = option.getAttribute('data-priority');
                if (priority === this.defaultPriority) {
                    option.classList.add('selected');
                }
            });
        } else {
            // 如果没有默认优先级，选中无优先级选项
            const noPriorityOption = prioritySelector.querySelector('[data-priority="none"]') as HTMLElement;
            if (noPriorityOption) {
                noPriorityOption.classList.add('selected');
            }
        }
    }

    // 渲染任务类型选择器
    private renderTermTypeSelector(): string {
        // 如果 showKanbanStatus 为 'none'，不显示任务类型选择器
        if (this.showKanbanStatus === 'none') {
            return '';
        }

        let options = '';

        if (this.showKanbanStatus === 'todo') {
            // 显示 todo 和 doing
            options = `
                <div class="term-type-option ${this.defaultTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'todo' ? 'selected' : ''}" data-term-type="todo">
                    <span>📝 待办</span>
                </div>
            `;
        } else if (this.showKanbanStatus === 'term') {
            // 显示 doing、short_term、long_term
            options = `
                <div class="term-type-option ${this.defaultTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'short_term' || (!this.defaultTermType && this.showKanbanStatus === 'term') ? 'selected' : ''}" data-term-type="short_term">
                    <span>📋 短期待办</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'long_term' ? 'selected' : ''}" data-term-type="long_term">
                    <span>📅 长期待办</span>
                </div>
            `;
        } else {
            // 默认情况（showKanbanStatus === 'todo'），显示 todo 和 doing
            options = `
                <div class="term-type-option ${this.defaultTermType === 'todo' ? 'selected' : ''}" data-term-type="todo">
                    <span>📝 待办</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
            `;
        }

        return `
            <div class="b3-form__group">
                <label class="b3-form__label">任务类型</label>
                <div class="term-type-selector" id="quickTermTypeSelector" style="display: flex; gap: 12px;">
                    ${options}
                </div>
            </div>
        `;
    }

    private async renderCategorySelector() {
        const categorySelector = this.dialog.element.querySelector('#quickCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();

            // 清空并重新构建，使用横向布局
            categorySelector.innerHTML = '';

            // 添加无分类选项
            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = 'category-option';
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${t("noCategory")}</span>`;
            categorySelector.appendChild(noCategoryEl);

            // 添加所有分类选项
            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'category-option';
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

            // 设置默认分类选择
            if (this.defaultCategoryId) {
                const categoryButtons = this.dialog.element.querySelectorAll('.category-option');
                categoryButtons.forEach(button => {
                    const categoryId = button.getAttribute('data-category');
                    if (categoryId === this.defaultCategoryId) {
                        button.classList.add('selected');
                    }
                });
            } else {
                // 如果没有默认分类，选中无分类选项
                noCategoryEl.classList.add('selected');
            }

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    // 切换日期时间输入框类型
    private toggleDateTimeInputs(noSpecificTime: boolean) {
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const dateTimeDesc = this.dialog.element.querySelector('#quickDateTimeDesc') as HTMLElement;

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
            } else if (this.initialDate) {
                // 如果没有当前值但有初始日期，设置初始日期
                startDateInput.value = this.initialDate;
            }

            if (endValue && endValue.includes('T')) {
                endDateInput.value = endValue.split('T')[0];
            } else if (endValue) {
                endDateInput.value = endValue;
            } else if (this.isTimeRange && this.initialEndDate) {
                // 如果没有当前值但是时间段选择且有初始结束日期，设置初始结束日期
                endDateInput.value = this.initialEndDate;
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
                const currentTime = this.initialTime || getLocalTimeString();
                startDateInput.value = `${startValue}T${currentTime}`;
            } else if (!startValue) {
                // 如果没有日期值，设置默认日期和时间
                const currentTime = this.initialTime || getLocalTimeString();
                startDateInput.value = `${this.initialDate}T${currentTime}`;
            } else {
                // 如果已经有完整的datetime-local格式，直接设置
                startDateInput.value = startValue;
            }

            // 处理结束日期输入框
            if (endValue && !endValue.includes('T')) {
                // 如果结束日期有值但没有时间，添加默认时间
                const endTime = this.initialEndTime || this.initialTime || getLocalTimeString();
                endDateInput.value = `${endValue}T${endTime}`;
            } else if (endValue) {
                // 如果已经有完整的datetime-local格式，直接设置
                endDateInput.value = endValue;
            } else if (this.isTimeRange && this.initialEndDate) {
                // 如果没有当前值但是时间段选择且有初始结束日期和时间，设置初始值
                const endTime = this.initialEndTime || this.initialTime || getLocalTimeString();
                endDateInput.value = `${this.initialEndDate}T${endTime}`;
            }

            if (dateTimeDesc) {
                dateTimeDesc.textContent = t("dateTimeDesc");
            }
        }
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#quickCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#quickConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#quickPrioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#quickCategorySelector') as HTMLElement;
        const repeatSettingsBtn = this.dialog.element.querySelector('#quickRepeatSettingsBtn') as HTMLButtonElement;
        const manageCategoriesBtn = this.dialog.element.querySelector('#quickManageCategoriesBtn') as HTMLButtonElement;
        const nlBtn = this.dialog.element.querySelector('#quickNlBtn') as HTMLButtonElement;
        const createDocBtn = this.dialog.element.querySelector('#quickCreateDocBtn') as HTMLButtonElement;
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const dateTimeDesc = this.dialog.element.querySelector('#quickDateTimeDesc') as HTMLElement;

        // 标题输入自动识别
        titleInput?.addEventListener('blur', () => {
            const title = titleInput.value.trim();
            if (title) {
                const autoDetected = this.autoDetectDateTimeFromTitle(title);
                if (autoDetected.date && autoDetected.date !== this.initialDate) {
                    // 如果识别到不同的日期，询问是否应用
                    const dateStr = new Date(autoDetected.date + 'T00:00:00').toLocaleDateString('zh-CN');
                    if (confirm(`检测到日期：${dateStr}${autoDetected.time ? ` ${autoDetected.time}` : ''}，是否应用？`)) {
                        if (autoDetected.hasTime && autoDetected.time) {
                            // 有时间信息：先设置复选框状态，再切换输入框类型，最后设置值
                            noTimeCheckbox.checked = false;
                            this.toggleDateTimeInputs(false);
                            startDateInput.value = `${autoDetected.date}T${autoDetected.time}`;
                        } else {
                            // 只有日期信息：先设置复选框状态，再切换输入框类型，最后设置值
                            noTimeCheckbox.checked = true;
                            this.toggleDateTimeInputs(true);
                            startDateInput.value = autoDetected.date;
                        }
                        if (autoDetected.cleanTitle && autoDetected.cleanTitle !== title) {
                            titleInput.value = autoDetected.cleanTitle;
                        }
                    }
                }
            }
        });

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

        // 任务类型选择事件
        const termTypeSelector = this.dialog.element.querySelector('#quickTermTypeSelector') as HTMLElement;
        termTypeSelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.term-type-option') as HTMLElement;
            if (option) {
                termTypeSelector.querySelectorAll('.term-type-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            this.dialog.destroy();
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveReminder();
        });

        // 时间复选框 - 切换日期输入框类型
        noTimeCheckbox?.addEventListener('change', () => {
            this.toggleDateTimeInputs(noTimeCheckbox.checked);
        });

        // 日期验证
        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            // 设置结束日期的最小值
            endDateInput.min = startDate;
        });

        // 结束日期验证
        endDateInput?.addEventListener('change', () => {
            // 移除立即验证逻辑，只在保存时验证
        });

        // 重复设置按钮
        repeatSettingsBtn?.addEventListener('click', () => {
            this.showRepeatSettingsDialog();
        });

        // 管理分类按钮事件
        manageCategoriesBtn?.addEventListener('click', () => {
            this.showCategoryManageDialog();
        });

        // 自然语言识别按钮
        nlBtn?.addEventListener('click', () => {
            this.showNaturalLanguageDialog();
        });

        // 新建文档按钮
        createDocBtn?.addEventListener('click', () => {
            this.showCreateDocumentDialog();
        });
    }

    private showRepeatSettingsDialog() {
        // 获取当前设置的开始日期
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        let startDate = startDateInput?.value;

        // 如果没有设置开始日期，使用初始日期或今天的日期
        if (!startDate) {
            startDate = this.initialDate || getLocalDateString();
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
        const repeatDescription = this.dialog.element.querySelector('#quickRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染分类选择器
            this.renderCategorySelector();
        });
        categoryDialog.show();
    }

    private async renderProjectSelector() {
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            await this.projectManager.initialize();
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空并重新构建项目选择器
            projectSelector.innerHTML = '';

            // 添加无项目选项
            const noProjectOption = document.createElement('option');
            noProjectOption.value = '';
            noProjectOption.textContent = t('noProject');
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

                        // 如果设置了默认项目，选中它
                        if (this.defaultProjectId === project.id) {
                            option.selected = true;
                        }

                        optgroup.appendChild(option);
                    });

                    projectSelector.appendChild(optgroup);
                }
            });
        } catch (error) {
            console.error('渲染项目选择器失败:', error);
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    /**
     * 显示创建文档对话框
     */
    private showCreateDocumentDialog() {
        // 检查plugin是否已初始化
        if (!this.plugin) {
            showMessage('⚠️ 无法创建文档：插件实例未初始化。请确保在创建QuickReminderDialog时传入plugin参数。');
            console.error('QuickReminderDialog: plugin未初始化。请在构造函数的options参数中传入plugin实例。');
            return;
        }

        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const defaultTitle = titleInput?.value?.trim() || '';

        const createDocDialog = new Dialog({
            title: t("createNewDocument") || '新建文档',
            content: `
                <div class="create-doc-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">文档标题</label>
                            <input type="text" id="quickDocTitleInput" class="b3-text-field" value="${defaultTitle}" placeholder="请输入文档标题" style="width: 100%; margin-top: 8px;">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">文档内容（可选）</label>
                            <textarea id="quickDocContentInput" class="b3-text-field" placeholder="请输入文档内容" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickCreateDocCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="quickCreateDocConfirmBtn">${t("confirm") || '确定'}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "300px"
        });

        const docTitleInput = createDocDialog.element.querySelector('#quickDocTitleInput') as HTMLInputElement;
        const docContentInput = createDocDialog.element.querySelector('#quickDocContentInput') as HTMLTextAreaElement;
        const cancelBtn = createDocDialog.element.querySelector('#quickCreateDocCancelBtn') as HTMLButtonElement;
        const confirmBtn = createDocDialog.element.querySelector('#quickCreateDocConfirmBtn') as HTMLButtonElement;

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            createDocDialog.destroy();
        });

        // 确认按钮
        confirmBtn?.addEventListener('click', async () => {
            const title = docTitleInput.value.trim();
            const content = docContentInput.value.trim();

            if (!title) {
                showMessage(t("pleaseEnterTitle"));
                return;
            }

            try {
                const docId = await this.createDocument(title, content);
                if (docId) {
                    // 自动填入文档ID到绑定块输入框
                    const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
                    if (blockInput) {
                        blockInput.value = docId;
                    }
                    showMessage('✓ 文档创建成功，已自动填入ID');
                    createDocDialog.destroy();
                }
            } catch (error) {
                console.error('创建文档失败:', error);
                showMessage(t("createDocumentFailed") || '创建文档失败');
            }
        });

        // 自动聚焦标题输入框
        setTimeout(() => {
            docTitleInput?.focus();
        }, 100);
    }

    /**
     * 创建文档
     */
    private async createDocument(title: string, content: string): Promise<string> {
        try {
            if (!this.plugin) {
                const errorMsg = 'QuickReminderDialog: plugin未初始化。请在构造函数的options中传入plugin实例，例如：new QuickReminderDialog(date, time, callback, timeRangeOptions, { plugin: this.plugin })';
                console.error(errorMsg);
                throw new Error('插件实例未初始化');
            }

            // 获取插件设置
            const settings = await this.plugin.loadSettings();
            const notebook = settings.newDocNotebook;
            const pathTemplate = settings.newDocPath || '/{{now | date "2006/200601"}}/';

            if (!notebook) {
                throw new Error(t("pleaseConfigureNotebook") || '请在设置中配置新建文档的笔记本');
            }

            // 导入API函数
            const { renderSprig, createDocWithMd } = await import("../api");

            // 渲染路径模板
            let renderedPath: string;
            try {
                // 检测pathTemplate是否以/结尾，如果不是，则添加/
                if (!pathTemplate.endsWith('/')) {
                    renderedPath = pathTemplate + '/';
                } else {
                    renderedPath = pathTemplate;
                }
                renderedPath = await renderSprig(renderedPath + title);
            } catch (error) {
                console.error('渲染路径模板失败:', error);
                throw new Error(t("renderPathFailed") || '渲染路径模板失败');
            }

            // 准备文档内容
            const docContent = content;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);

            return docId;
        } catch (error) {
            console.error('创建文档失败:', error);
            throw error;
        }
    }

    private async saveReminder() {
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#quickReminderNote') as HTMLTextAreaElement;
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
        const selectedPriority = this.dialog.element.querySelector('#quickPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = this.dialog.element.querySelector('#quickCategorySelector .category-option.selected') as HTMLElement;
        const selectedTermType = this.dialog.element.querySelector('#quickTermTypeSelector .term-type-option.selected') as HTMLElement;

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
            date = dateInput.value;
            endDate = endDateInput.value;
            time = undefined;
            endTime = undefined;
        } else {
            // 设置具体时间：从datetime-local值中解析
            if (dateInput.value.includes('T')) {
                const [dateStr, timeStr] = dateInput.value.split('T');
                date = dateStr;
                time = timeStr;
            } else {
                date = dateInput.value;
                time = undefined;
            }

            if (endDateInput.value) {
                if (endDateInput.value.includes('T')) {
                    const [endDateStr, endTimeStr] = endDateInput.value.split('T');
                    endDate = endDateStr;
                    endTime = endTimeStr;
                } else {
                    endDate = endDateInput.value;
                    endTime = undefined;
                }
            }
        }

        if (!title) {
            showMessage(t("pleaseEnterTitle"));
            return;
        }

        // 对于项目任务，允许不设置日期；对于非项目任务，日期是必需的
        if (!date && !projectId) {
            showMessage(t("pleaseSelectDate"));
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

        try {
            const reminderData = await readReminderData();

            // 生成唯一的提醒ID（不依赖blockId）
            const reminderId = `quick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const reminder: any = {
                id: reminderId,
                blockId: inputId || this.defaultBlockId || null,
                docId: null, // 没有绑定文档
                title: title,
                date: date || undefined, // 允许日期为空
                completed: false,
                priority: priority,
                categoryId: categoryId,
                projectId: projectId,
                createdAt: new Date().toISOString(),
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                isQuickReminder: true, // 标记为快速创建的提醒
                quadrant: this.defaultQuadrant, // 添加象限信息
                termType: termType // 添加任务类型（短期/长期）
            };

            // 根据任务类型设置看板状态
            if (termType === 'doing') {
                reminder.kanbanStatus = 'doing';
            } else if (termType === 'long_term') {
                reminder.kanbanStatus = 'todo';
                reminder.termType = 'long_term';
            } else if (termType === 'short_term') {
                reminder.kanbanStatus = 'todo';
                reminder.termType = 'short_term';
            } else if (termType === 'todo') {
                reminder.kanbanStatus = 'todo';
                reminder.termType = 'short_term'; // 默认todo为短期待办
            }

            // 如果任务时间早于当前时间，则标记为已通知（仅当有日期时）
            if (date) {
                const reminderDateTime = new Date(time ? `${date}T${time}` : date);
                if (!time) {
                    // 对于全天任务，我们比较当天的结束时间
                    reminderDateTime.setHours(23, 59, 59, 999);
                }
                if (reminderDateTime < new Date()) {
                    reminder.notified = true;
                }
            }

            if (endDate && endDate !== date) {
                reminder.endDate = endDate;
            }

            if (time) {
                reminder.time = time;
            }

            if (endTime) {
                reminder.endTime = endTime;
            }

            if (note) {
                reminder.note = note;
            }

            // 如果是周期任务，自动完成所有过去的实例
            if (this.repeatConfig.enabled && date) {
                const { generateRepeatInstances } = await import("../utils/repeatUtils");
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

                // 生成从任务开始日期到今天的所有实例
                const instances = generateRepeatInstances(reminder, date, today, maxInstances);

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
                    console.log(`自动完成了 ${pastInstances.length} 个过去的周期实例（共生成 ${instances.length} 个实例）`);
                }
            }

            reminderData[reminderId] = reminder;
            await writeReminderData(reminderData);

            // 显示保存成功消息
            let successMessage = t("reminderSaved");
            if (date) {
                // 只有在有日期时才显示日期信息
                if (endDate && endDate !== date) {
                    // 跨天事件
                    const startTimeStr = time ? ` ${time}` : '';
                    const endTimeStr = endTime ? ` ${endTime}` : '';
                    successMessage += `：${date}${startTimeStr} → ${endDate}${endTimeStr}`;
                } else if (endTime && time) {
                    // 同一天的时间段事件
                    successMessage += `：${date} ${time} - ${endTime}`;
                } else {
                    // 普通事件
                    successMessage += `：${date}${time ? ` ${time}` : ''}`;
                }
            }

            if (this.repeatConfig.enabled) {
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

            showMessage(successMessage);

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 调用保存回调
            if (this.onSaved) {
                this.onSaved();
            }

            this.dialog.destroy();
        } catch (error) {
            console.error('保存快速提醒失败:', error);
            showMessage(t("saveReminderFailed"));
        }
    }
}