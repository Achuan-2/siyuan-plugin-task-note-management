import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, getLocalTimeString } from "../utils/dateUtils";
import { CategoryManager, Category } from "../utils/categoryManager";
import { t } from "../utils/i18n";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";
import { CategoryManageDialog } from "./CategoryManageDialog";
import * as chrono from 'chrono-node';

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

    constructor(initialDate: string, initialTime?: string, onSaved?: () => void, timeRangeOptions?: {
        endDate?: string;
        endTime?: string;
        isTimeRange?: boolean;
    }) {
        // 确保日期格式正确 - 只保留 YYYY-MM-DD 部分
        this.initialDate = this.formatDateForInput(initialDate);
        
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
        this.categoryManager = CategoryManager.getInstance();
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
        const nlDialog = new Dialog({
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="quickNlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点等</div>
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
            height: "25%"
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

        // 自动聚焦输入框
        setTimeout(() => {
            nlInput.focus();
        }, 100);
    }

    // 应用自然语言识别结果
    private applyNaturalLanguageResult(result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;

        // 设置日期
        dateInput.value = result.date;

        // 设置时间
        if (result.hasTime && result.time) {
            timeInput.value = result.time;
            noTimeCheckbox.checked = false;
            timeInput.disabled = false;
        } else {
            noTimeCheckbox.checked = true;
            timeInput.disabled = true;
            timeInput.value = '';
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
                                <div class="priority-option selected" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>${t("noPriority")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderDate")}</label>
                            <div class="reminder-date-container">
                                <input type="date" id="quickReminderDate" class="b3-text-field" value="${this.initialDate}" required>
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="quickReminderEndDate" class="b3-text-field reminder-end-date" placeholder="${t("endDateOptional")}" title="${t("spanningEventDesc")}">
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
                            <label class="b3-form__label">${t("reminderTimeOptional")}</label>
                            <div class="reminder-time-container">
                                <input type="time" id="quickReminderTime" class="b3-text-field" value="${currentTime}" ${this.initialTime ? '' : 'disabled'}>
                                <span class="reminder-time-arrow" style="margin: 0 8px;">→</span>
                                <input type="time" id="quickReminderEndTime" class="b3-text-field reminder-end-time" placeholder="${t("endTimeOptional")}" title="${t("endTimeDesc")}" ${this.initialEndTime ? '' : 'disabled'}>
                            </div>
                            <div class="b3-form__desc">${t("noTimeDesc")}</div>
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
            height: "80vh"
        });

        this.bindEvents();
        await this.renderCategorySelector();

        // 确保日期和时间输入框正确设置初始值
        setTimeout(() => {
            const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
            const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
            const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
            const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
            const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
            
            // 确保日期输入框有正确的值
            if (dateInput && this.initialDate) {
                dateInput.value = this.initialDate;
            }
            
            // 如果是时间段选择，设置结束日期
            if (this.isTimeRange && this.initialEndDate && endDateInput) {
                endDateInput.value = this.initialEndDate;
            }
            
            // 确保时间输入框状态正确
            if (this.initialTime) {
                if (timeInput) {
                    timeInput.value = this.initialTime;
                    timeInput.disabled = false;
                }
                if (noTimeCheckbox) {
                    noTimeCheckbox.checked = false;
                }
            } else {
                if (noTimeCheckbox) {
                    noTimeCheckbox.checked = true;
                }
                if (timeInput) {
                    timeInput.disabled = true;
                }
            }
            
            // 如果是时间段选择且有结束时间，设置结束时间输入框
            if (this.isTimeRange && this.initialEndTime && endTimeInput) {
                endTimeInput.value = this.initialEndTime;
                endTimeInput.disabled = false;
            } else if (endTimeInput) {
                endTimeInput.disabled = !this.initialTime; // 只有开始时间存在时才启用结束时间
            }
            
            // 自动聚焦标题输入框
            titleInput?.focus();
        }, 100);
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
            noCategoryEl.className = 'category-option selected';
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

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#quickCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#quickConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#quickPrioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#quickCategorySelector') as HTMLElement;
        const repeatSettingsBtn = this.dialog.element.querySelector('#quickRepeatSettingsBtn') as HTMLButtonElement;
        const manageCategoriesBtn = this.dialog.element.querySelector('#quickManageCategoriesBtn') as HTMLButtonElement;
        const nlBtn = this.dialog.element.querySelector('#quickNlBtn') as HTMLButtonElement;
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;

        // 标题输入自动识别
        titleInput?.addEventListener('blur', () => {
            const title = titleInput.value.trim();
            if (title) {
                const autoDetected = this.autoDetectDateTimeFromTitle(title);
                if (autoDetected.date && autoDetected.date !== this.initialDate) {
                    // 如果识别到不同的日期，询问是否应用
                    const dateStr = new Date(autoDetected.date + 'T00:00:00').toLocaleDateString('zh-CN');
                    if (confirm(`检测到日期：${dateStr}${autoDetected.time ? ` ${autoDetected.time}` : ''}，是否应用？`)) {
                        startDateInput.value = autoDetected.date;
                        if (autoDetected.hasTime && autoDetected.time) {
                            timeInput.value = autoDetected.time;
                            noTimeCheckbox.checked = false;
                            timeInput.disabled = false;
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

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            this.dialog.destroy();
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveReminder();
        });

        // 时间复选框
        noTimeCheckbox?.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            endTimeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
                endTimeInput.value = '';
            }
        });

        // 如果有初始时间，确保时间输入框处于正确状态
        if (this.initialTime) {
            noTimeCheckbox.checked = false;
            timeInput.disabled = false;
            timeInput.value = this.initialTime;
            endTimeInput.disabled = false;
        }

        // 日期验证
        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            // 如果结束日期已设置且早于开始日期，自动调整
            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateAdjusted"));
            }

            // 设置结束日期的最小值
            endDateInput.min = startDate;
        });

        // 结束日期验证
        endDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateCannotBeEarlier"));
            }
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
    }

    private showRepeatSettingsDialog() {
        const repeatDialog = new RepeatSettingsDialog(this.repeatConfig, (config: RepeatConfig) => {
            this.repeatConfig = config;
            this.updateRepeatDescription();
        });
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

    private async saveReminder() {
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#quickReminderNote') as HTMLTextAreaElement;
        const selectedPriority = this.dialog.element.querySelector('#quickPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = this.dialog.element.querySelector('#quickCategorySelector .category-option.selected') as HTMLElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const endTime = noTimeCheckbox.checked ? undefined : endTimeInput.value;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';
        const categoryId = selectedCategory?.getAttribute('data-category') || undefined;

        if (!title) {
            showMessage(t("pleaseEnterTitle"));
            return;
        }

        if (!date) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        if (endDate && endDate < date) {
            showMessage(t("endDateCannotBeEarlier"));
            return;
        }

        try {
            const reminderData = await readReminderData();

            // 生成唯一的提醒ID（不依赖blockId）
            const reminderId = `quick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const reminder: any = {
                id: reminderId,
                blockId: null, // 没有绑定块
                docId: null, // 没有绑定文档
                title: title,
                date: date,
                completed: false,
                priority: priority,
                categoryId: categoryId,
                createdAt: new Date().toISOString(),
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                isQuickReminder: true // 标记为快速创建的提醒
            };

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

            reminderData[reminderId] = reminder;
            await writeReminderData(reminderData);

            // 显示保存成功消息
            let successMessage = t("reminderSaved");
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