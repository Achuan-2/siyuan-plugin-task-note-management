import { showMessage, Dialog, Menu, confirm } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, getLocalTimeString, compareDateStrings } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { t } from "../utils/i18n";
import { getRepeatDescription } from "../utils/repeatUtils";
import { CategoryManageDialog } from "./CategoryManageDialog";
import * as chrono from 'chrono-node'; // 导入chrono-node

export class ReminderDialog {
    private blockId: string;
    private dialog: Dialog;
    private blockContent: string = '';
    private reminderUpdatedHandler: () => void;
    private currentSort: string = 'time';
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private repeatConfig: RepeatConfig;
    private categoryManager: CategoryManager;
    private isAllDayDefault: boolean = true;
    private documentId: string = '';
    private chronoParser: any; // chrono解析器实例

    constructor(blockId: string) {
        this.blockId = blockId;
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

        // 创建事件处理器
        this.reminderUpdatedHandler = () => {
            // 重新加载现有提醒列表
            this.loadExistingReminder();
        };

        this.sortConfigUpdatedHandler = (event: CustomEvent) => {
            const { sortMethod } = event.detail;
            if (sortMethod !== this.currentSort) {
                this.currentSort = sortMethod;
                this.loadExistingReminder(); // 重新排序现有提醒
            }
        };

        // 加载排序配置
        this.loadSortConfig();
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
                            <input type="text" id="nlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点等</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="nlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="nlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="nlConfirmBtn" disabled>应用</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "300px"
        });

        const nlInput = nlDialog.element.querySelector('#nlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#nlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#nlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#nlConfirmBtn') as HTMLButtonElement;

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

        const dateInput = this.dialog.element.querySelector('#reminderDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#reminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#noSpecificTime') as HTMLInputElement;

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

    // 加载排序配置
    private async loadSortConfig() {
        try {
            this.currentSort = await loadSortConfig();
        } catch (error) {
            console.error('加载排序配置失败:', error);
            this.currentSort = 'time';
        }
    }

    async show() {
        // 检测块是否存在
        try {
            const block = await getBlockByID(this.blockId);
            if (!block) {
                showMessage(t("blockNotExist"));
                return;
            }
            this.blockContent = block?.content || t("unnamedNote");
            // 获取文档ID - 如果blockId就是文档ID，则直接使用，否则获取根块ID
            this.documentId = block.root_id || this.blockId;
        } catch (error) {
            console.error('获取块内容失败:', error);
            showMessage(t("cannotGetNoteContent"));
            return;
        }

        // 初始化分类管理器
        await this.categoryManager.initialize();

        const today = getLocalDateString();
        const currentTime = getLocalTimeString();

        // 从标题自动识别日期时间
        const autoDetected = this.autoDetectDateTimeFromTitle(this.blockContent);
        const initialDate = autoDetected.date || today;
        const initialTime = autoDetected.time || currentTime;
        const initialTitle = autoDetected.cleanTitle || this.blockContent;
        const initialNoTime = !autoDetected.hasTime;

        this.dialog = new Dialog({
            title: t("setTimeReminder"),
            content: `
                <div class="reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="fn__hr"></div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("eventTitle")}</label>
                            <div class="title-input-container" style="display: flex; gap: 8px;">
                                <input type="text" id="reminderTitle" class="b3-text-field" value="${initialTitle}" placeholder="${t("enterReminderTitle")}" style="flex: 1;" required>
                                <button type="button" id="nlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                    ✨
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">事件分类
                                <button type="button" id="manageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                                </button>
                            </label>
                            <div class="category-selector" id="categorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                                <!-- 分类选择器将在这里渲染 -->
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("priority")}</label>
                            <div class="priority-selector" id="prioritySelector">
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
                                <input type="date" id="reminderDate" class="b3-text-field" value="${initialDate}" required>
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="reminderEndDate" class="b3-text-field reminder-end-date" placeholder="${t("endDateOptional")}" title="${t("spanningEventDesc")}">
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="noSpecificTime" ${initialNoTime ? 'checked' : ''}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                            </label>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderTimeOptional")}</label>
                            <input type="time" id="reminderTime" class="b3-text-field" value="${initialTime}" ${initialNoTime ? 'disabled' : ''}>
                            <div class="b3-form__desc">${t("noTimeDesc")}</div>
                        </div>
                        
                        <!-- 添加重复设置 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("repeatSettings")}</label>
                            <div class="repeat-setting-container">
                                <button type="button" id="repeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                    <span id="repeatDescription">${t("noRepeat")}</span>
                                    <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                            <textarea id="reminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="2" style="width: 100%;resize: vertical; min-height: 60px;"></textarea>
                        </div>
                        
                        <!-- 添加现有提醒显示区域 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("existingReminders")}</label>
                            <div id="existingReminders" class="existing-reminders-container"></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="confirmBtn">${t("save")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "870px"
        });

        this.bindEvents();
        await this.renderCategorySelector();
        await this.renderPrioritySelector();
        await this.loadExistingReminder();

        // 如果自动检测到日期，显示提示
        if (autoDetected.date) {
            const detectedDateStr = new Date(autoDetected.date + 'T00:00:00').toLocaleDateString('zh-CN');
            const message = `✨ 已从标题自动识别日期：${detectedDateStr}${autoDetected.time ? ` ${autoDetected.time}` : ''}`;
            setTimeout(() => showMessage(message), 300);
        }

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
        window.addEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
    }

    private async renderCategorySelector() {
        const categorySelector = this.dialog.element.querySelector('#categorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();

            // 获取默认分类：优先块历史，其次文档历史
            const defaultCategoryId = await this.getDefaultCategory();

            // 清空并重新构建，使用横向布局
            categorySelector.innerHTML = '';

            // 添加无分类选项
            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = `category-option ${!defaultCategoryId ? 'selected' : ''}`;
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>无分类</span>`;
            categorySelector.appendChild(noCategoryEl);

            // 添加所有分类选项
            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = `category-option ${category.id === defaultCategoryId ? 'selected' : ''}`;
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

    // 添加优先级渲染方法
    private async renderPrioritySelector() {
        const prioritySelector = this.dialog.element.querySelector('#prioritySelector') as HTMLElement;
        if (!prioritySelector) return;

        try {
            // 获取默认优先级：优先块历史，其次文档历史
            const defaultPriority = await this.getDefaultPriority();

            // 更新选中状态
            prioritySelector.querySelectorAll('.priority-option').forEach(option => {
                const priority = option.getAttribute('data-priority');
                if (priority === defaultPriority) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
            });

        } catch (error) {
            console.error('渲染优先级选择器失败:', error);
        }
    }

    // 修改获取默认分类的方法
    private async getDefaultCategory(): Promise<string | null> {
        try {
            // 1. 优先获取块的历史分类
            const blockCategoryId = await this.getBlockDefaultCategory();
            if (blockCategoryId) {
                return blockCategoryId;
            }

            // 2. 如果块没有历史分类，且块不是文档本身，则获取文档的历史分类
            if (this.blockId !== this.documentId) {
                const documentCategoryId = await this.getDocumentDefaultCategory();
                if (documentCategoryId) {
                    return documentCategoryId;
                }
            }

            return null;

        } catch (error) {
            console.error('获取默认分类失败:', error);
            return null;
        }
    }

    // 修改获取文档默认分类的方法
    private async getDocumentDefaultCategory(): Promise<string | null> {
        try {
            const reminderData = await readReminderData();
            const documentReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder && (reminder.blockId === this.documentId || reminder.docId === this.documentId) && reminder.categoryId
            );

            if (documentReminders.length === 0) {
                return null;
            }

            // 统计分类使用频率和最近使用时间
            const categoryStats = new Map<string, { count: number; lastUsed: string }>();

            documentReminders.forEach((reminder: any) => {
                if (reminder.categoryId) {
                    const current = categoryStats.get(reminder.categoryId);
                    const createdAt = reminder.createdAt || '1970-01-01T00:00:00Z';

                    if (current) {
                        current.count++;
                        if (createdAt > current.lastUsed) {
                            current.lastUsed = createdAt;
                        }
                    } else {
                        categoryStats.set(reminder.categoryId, {
                            count: 1,
                            lastUsed: createdAt
                        });
                    }
                }
            });

            // 按使用频率排序，频率相同时按最近使用时间排序
            const sortedCategories = Array.from(categoryStats.entries()).sort((a, b) => {
                const [categoryIdA, statsA] = a;
                const [categoryIdB, statsB] = b;

                if (statsA.count !== statsB.count) {
                    return statsB.count - statsA.count;
                }

                return new Date(statsB.lastUsed).getTime() - new Date(statsA.lastUsed).getTime();
            });

            return sortedCategories.length > 0 ? sortedCategories[0][0] : null;

        } catch (error) {
            console.error('获取文档默认分类失败:', error);
            return null;
        }
    }

    // 添加获取默认优先级的方法
    private async getDefaultPriority(): Promise<string> {
        try {
            // 1. 优先获取块的历史优先级
            const blockPriority = await this.getBlockDefaultPriority();
            if (blockPriority && blockPriority !== 'none') {
                return blockPriority;
            }

            // 2. 如果块没有历史优先级，且块不是文档本身，则获取文档的历史优先级
            if (this.blockId !== this.documentId) {
                const documentPriority = await this.getDocumentDefaultPriority();
                if (documentPriority && documentPriority !== 'none') {
                    return documentPriority;
                }
            }

            return 'none'; // 默认无优先级

        } catch (error) {
            console.error('获取默认优先级失败:', error);
            return 'none';
        }
    }

    // 获取块默认优先级的方法
    private async getBlockDefaultPriority(): Promise<string> {
        try {
            const reminderData = await readReminderData();
            const blockReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder && reminder.blockId === this.blockId && reminder.priority
            );

            if (blockReminders.length === 0) {
                return 'none';
            }

            // 统计优先级使用频率和最近使用时间
            const priorityStats = new Map<string, { count: number; lastUsed: string }>();

            blockReminders.forEach((reminder: any) => {
                const priority = reminder.priority || 'none';
                if (priority !== 'none') {
                    const current = priorityStats.get(priority);
                    const createdAt = reminder.createdAt || '1970-01-01T00:00:00Z';

                    if (current) {
                        current.count++;
                        if (createdAt > current.lastUsed) {
                            current.lastUsed = createdAt;
                        }
                    } else {
                        priorityStats.set(priority, {
                            count: 1,
                            lastUsed: createdAt
                        });
                    }
                }
            });

            if (priorityStats.size === 0) {
                return 'none';
            }

            // 按使用频率排序，频率相同时按最近使用时间排序
            const sortedPriorities = Array.from(priorityStats.entries()).sort((a, b) => {
                const [priorityA, statsA] = a;
                const [priorityB, statsB] = b;

                if (statsA.count !== statsB.count) {
                    return statsB.count - statsA.count;
                }

                return new Date(statsB.lastUsed).getTime() - new Date(statsA.lastUsed).getTime();
            });

            return sortedPriorities[0][0];

        } catch (error) {
            console.error('获取块默认优先级失败:', error);
            return 'none';
        }
    }

    // 获取文档默认优先级的方法
    private async getDocumentDefaultPriority(): Promise<string> {
        try {
            const reminderData = await readReminderData();
            const documentReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder && (reminder.blockId === this.documentId || reminder.docId === this.documentId) && reminder.priority
            );

            if (documentReminders.length === 0) {
                return 'none';
            }

            // 统计优先级使用频率和最近使用时间
            const priorityStats = new Map<string, { count: number; lastUsed: string }>();

            documentReminders.forEach((reminder: any) => {
                const priority = reminder.priority || 'none';
                if (priority !== 'none') {
                    const current = priorityStats.get(priority);
                    const createdAt = reminder.createdAt || '1970-01-01T00:00:00Z';

                    if (current) {
                        current.count++;
                        if (createdAt > current.lastUsed) {
                            current.lastUsed = createdAt;
                        }
                    } else {
                        priorityStats.set(priority, {
                            count: 1,
                            lastUsed: createdAt
                        });
                    }
                }
            });

            if (priorityStats.size === 0) {
                return 'none';
            }

            // 按使用频率排序，频率相同时按最近使用时间排序
            const sortedPriorities = Array.from(priorityStats.entries()).sort((a, b) => {
                const [priorityA, statsA] = a;
                const [priorityB, statsB] = b;

                if (statsA.count !== statsB.count) {
                    return statsB.count - statsA.count;
                }

                return new Date(statsB.lastUsed).getTime() - new Date(statsA.lastUsed).getTime();
            });

            // 如果文档之前设置过优先级，且当前是给文档添加提醒，则默认为高优先级
            if (this.blockId === this.documentId && sortedPriorities.length > 0) {
                return 'high';
            }

            return sortedPriorities[0][0];

        } catch (error) {
            console.error('获取文档默认优先级失败:', error);
            return 'none';
        }
    }

    // 修改现有的 getBlockDefaultCategory 方法名以保持一致性
    private async getBlockDefaultCategory(): Promise<string | null> {
        try {
            const reminderData = await readReminderData();
            const blockReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder && reminder.blockId === this.blockId && reminder.categoryId
            );

            if (blockReminders.length === 0) {
                return null;
            }

            // 统计分类使用频率和最近使用时间
            const categoryStats = new Map<string, { count: number; lastUsed: string }>();

            blockReminders.forEach((reminder: any) => {
                if (reminder.categoryId) {
                    const current = categoryStats.get(reminder.categoryId);
                    const createdAt = reminder.createdAt || '1970-01-01T00:00:00Z';

                    if (current) {
                        current.count++;
                        if (createdAt > current.lastUsed) {
                            current.lastUsed = createdAt;
                        }
                    } else {
                        categoryStats.set(reminder.categoryId, {
                            count: 1,
                            lastUsed: createdAt
                        });
                    }
                }
            });

            // 按使用频率排序，频率相同时按最近使用时间排序
            const sortedCategories = Array.from(categoryStats.entries()).sort((a, b) => {
                const [categoryIdA, statsA] = a;
                const [categoryIdB, statsB] = b;

                // 首先按使用频率排序
                if (statsA.count !== statsB.count) {
                    return statsB.count - statsA.count;
                }

                // 频率相同时按最近使用时间排序
                return new Date(statsB.lastUsed).getTime() - new Date(statsA.lastUsed).getTime();
            });

            // 返回最常用且最近使用的分类ID
            return sortedCategories.length > 0 ? sortedCategories[0][0] : null;

        } catch (error) {
            console.error('获取块默认分类失败:', error);
            return null;
        }
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#confirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#noSpecificTime') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#reminderTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#reminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#prioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#categorySelector') as HTMLElement;
        const repeatSettingsBtn = this.dialog.element.querySelector('#repeatSettingsBtn') as HTMLButtonElement;
        const manageCategoriesBtn = this.dialog.element.querySelector('#manageCategoriesBtn') as HTMLButtonElement;
        const nlBtn = this.dialog.element.querySelector('#nlBtn') as HTMLButtonElement;

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
            e.preventDefault();
            e.stopPropagation();
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
            this.cleanup();
            this.dialog.destroy();
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveReminder();
        });

        // 时间复选框
        noTimeCheckbox?.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

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
        const repeatDescription = this.dialog.element.querySelector('#repeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染分类选择器
            this.renderCategorySelector();
            // 重新加载现有提醒列表以反映分类变化
            this.loadExistingReminder();
            // 触发全局提醒更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        categoryDialog.show();
    }

    private async saveReminder() {
        const titleInput = this.dialog.element.querySelector('#reminderTitle') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#reminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#reminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#noSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#reminderNote') as HTMLTextAreaElement;
        const selectedPriority = this.dialog.element.querySelector('#prioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = this.dialog.element.querySelector('#categorySelector .category-option.selected') as HTMLElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
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

            const reminderId = `${this.blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const reminder = {
                id: reminderId,
                blockId: this.blockId,
                docId: this.documentId, // 添加文档ID字段
                title: title,
                date: date,
                completed: false,
                priority: priority,
                categoryId: categoryId, // 添加分类ID
                createdAt: new Date().toISOString(),
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined
            };

            if (endDate && endDate !== date) {
                reminder.endDate = endDate;
            }

            if (time) {
                reminder.time = time;
            }

            if (note) {
                reminder.note = note;
            }

            reminderData[reminderId] = reminder;
            await writeReminderData(reminderData);

            // 添加⏰书签到对应的块
            await updateBlockReminderBookmark(this.blockId);

            // 显示保存成功消息，包含重复信息
            let successMessage = t("reminderSaved");
            if (endDate && endDate !== date) {
                successMessage += `：${date} → ${endDate}${time ? ` ${time}` : ''}`;
            } else {
                successMessage += `：${date}${time ? ` ${time}` : ''}`;
            }

            if (this.repeatConfig.enabled) {
                successMessage += `，${getRepeatDescription(this.repeatConfig)}`;
            }

            // 添加分类信息到成功消息
            if (categoryId) {
                const category = this.categoryManager.getCategoryById(categoryId);
                if (category) {
                    successMessage += `，分类：${category.name}`;
                }
            }

            showMessage(successMessage);

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            this.cleanup();
            this.dialog.destroy();
        } catch (error) {
            console.error('保存提醒失败:', error);
            showMessage(t("saveReminderFailed"));
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string): string {
        if (!today) {
            today = getLocalDateString();
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = getLocalDateString(tomorrow);

        let dateStr = '';
        if (date === today) {
            dateStr = t("today");
        } else if (date === tomorrowStr) {
            dateStr = t("tomorrow");
        } else if (compareDateStrings(date, today) < 0) {
            // 过期日期也显示为相对时间
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        } else {
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        }

        // 处理跨天事件
        if (endDate && endDate !== date) {
            let endDateStr = '';
            if (endDate === today) {
                endDateStr = t("today");
            } else if (endDate === tomorrowStr) {
                endDateStr = t("tomorrow");
            } else if (compareDateStrings(endDate, today) < 0) {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            } else {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            }

            const timeStr = time ? ` ${time}` : '';
            return `${dateStr} → ${endDateStr}${timeStr}`;
        }

        return time ? `${dateStr} ${time}` : dateStr;
    }

    private async loadReminders() {
        // 由于 ReminderDialog 主要用于设置提醒，这里可以是空实现
        // 或者触发全局的提醒更新事件
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }


    // 添加排序方法
    private sortReminders(reminders: any[]) {
        const sortType = this.currentSort;

        reminders.sort((a: any, b: any) => {
            switch (sortType) {
                case 'time':
                    // 按时间排序：先按日期，再按时间
                    const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
                    const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
                    return dateA.getTime() - dateB.getTime();

                case 'priority':
                    // 按优先级排序：高 > 中 > 低 > 无，相同优先级按时间排序
                    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                    const priorityA = priorityOrder[a.priority || 'none'] || 0;
                    const priorityB = priorityOrder[b.priority || 'none'] || 0;

                    if (priorityA !== priorityB) {
                        return priorityB - priorityA; // 降序：高优先级在前
                    }

                    // 相同优先级按时间排序
                    const timeDateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
                    const timeDateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
                    return timeDateA.getTime() - timeDateB.getTime();

                case 'title':
                    // 按标题排序
                    const titleA = (a.title || '').toLowerCase();
                    const titleB = (b.title || '').toLowerCase();
                    return titleA.localeCompare(titleB, 'zh-CN');

                case 'created':
                    // 按创建时间排序
                    const createdA = new Date(a.createdAt || '1970-01-01');
                    const createdB = new Date(b.createdAt || '1970-01-01');
                    return createdB.getTime() - createdA.getTime(); // 降序：最新创建的在前

                default:
                    return 0;
            }
        });
    }

    private async deleteReminder(reminder: any) {
        const result = await confirm(
            t("deleteReminder"),
            t("confirmDelete", { title: reminder.title }),
            () => {
                this.performDeleteReminder(reminder.id);
            }
        );
    }

    private async performDeleteReminder(reminderId: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const blockId = reminderData[reminderId].blockId;
                delete reminderData[reminderId];
                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                }

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                await this.loadExistingReminder();

                showMessage(t("reminderDeleted"));
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
        }
    }

    private showTimeEditDialog(reminder: any) {
        const editDialog = new ReminderEditDialog(reminder, () => {
            this.loadExistingReminder();
        });
        editDialog.show();
    }

    private async loadExistingReminder() {
        try {
            const reminderData = await readReminderData();
            const blockReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder && reminder.blockId === this.blockId
            );

            const container = this.dialog.element.querySelector('#existingReminders') as HTMLElement;

            if (blockReminders.length > 0 && container) {
                const today = getLocalDateString();
                container.innerHTML = '';

                // 应用当前排序方式
                this.sortReminders(blockReminders);

                blockReminders.forEach((reminder: any) => {
                    const reminderEl = this.createReminderElement(reminder, today);
                    container.appendChild(reminderEl);
                });
            } else if (container) {
                container.innerHTML = `<div class="reminder-empty">${t("noExistingReminders")}</div>`;
            }
        } catch (error) {
            console.error('加载现有提醒失败:', error);
        }
    }

    private createReminderElement(reminder: any, today: string): HTMLElement {
        const element = document.createElement('div');
        element.className = 'reminder-item reminder-item--compact';
        element.setAttribute('data-id', reminder.id);

        // 根据完成状态设置透明度
        if (reminder.completed) {
            element.style.opacity = '0.5';
        }

        // 添加右键菜单支持
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showReminderContextMenu(e, reminder);
        });

        // 标题容器，包含分类和标题
        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-item__title-container';


        // 标题
        const titleEl = document.createElement('div');
        titleEl.className = 'reminder-item__title';
        titleEl.textContent = reminder.title;
        titleContainer.appendChild(titleEl);

        element.appendChild(titleContainer);

        // 时间信息 - 添加点击编辑功能
        const timeEl = document.createElement('div');
        timeEl.className = 'reminder-item__time';
        const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate);
        timeEl.textContent = timeText;
        timeEl.style.cursor = 'pointer';
        timeEl.style.color = 'var(--b3-theme-primary)';
        timeEl.title = t("clickToModifyTime");

        // 添加时间点击编辑事件
        timeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTimeEditDialog(reminder);
        });

        element.appendChild(timeEl);

        // 如果有备注，显示备注
        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';
            noteEl.textContent = reminder.note;
            element.appendChild(noteEl);
        }

        return element;
    }

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderDialogContextMenu");

        menu.addItem({
            iconHTML: "📝",
            label: t("modify"),
            click: () => {
                this.showTimeEditDialog(reminder);
            }
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: "🗑️",
            label: t("deleteReminder"),
            click: () => {
                this.deleteReminder(reminder);
            }
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    // 添加清理方法
    private cleanup() {
        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
        if (this.sortConfigUpdatedHandler) {
            window.removeEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
        }
    }
}
