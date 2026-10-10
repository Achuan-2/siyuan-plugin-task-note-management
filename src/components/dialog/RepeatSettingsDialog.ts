import { Dialog, showMessage } from "siyuan";
import { i18n } from "../../pluginInstance";
import { solarToLunar } from "../../utils/lunarUtils";
import { getLogicalDateString } from "../../utils/dateUtils";
import { normalizeReminderSkipWeekendMode, type ReminderSkipWeekendMode } from "../../utils/reminderSkipDate";

export type MonthlyRepeatMode = 'date' | 'weekday';
export type RepeatSkippedDateAction = 'skip' | 'postpone';
export type MonthlyWeekOrder = 1 | 2 | 3 | 4 | 5 | -1;
export interface MonthlyWeekRule {
    order: MonthlyWeekOrder;
    weekday: number;
}

export interface RepeatInstanceState {
    completed?: boolean;
    completedTime?: string;
    modifiedAt?: string;
    preservedFromSeriesEdit?: boolean;
    deleted?: boolean;

    title?: string;
    date?: string;
    endDate?: string;
    time?: string;
    endTime?: string;
    reminderTimes?: Array<{ time: string; endTime?: string; note?: string }>;
    customReminderPreset?: string;
    blockId?: string | null;
    docId?: string | null;
    url?: string;
    note?: string;
    priority?: string;
    categoryId?: string;
    projectId?: string;
    customGroupId?: string;
    kanbanStatus?: string;
    tagIds?: string[];
    milestoneId?: string;
    linkedHabitId?: string;
    linkedHabitSyncPomodoroToday?: boolean;
    linkedHabitAutoCheckInOnComplete?: boolean;
    linkedHabitAutoCheckInOptionKey?: string;
    linkedHabitAutoCheckInEmoji?: string;
    estimatedPomodoroDuration?: number;
    customProgress?: number;
    pinned?: boolean;
    hideInCalendar?: boolean;
    isAvailableToday?: boolean;
    availableStartDate?: string;
    treatStartDateAsDeadline?: boolean;
    reminderSkipWeekendMode?: ReminderSkipWeekendMode;
    reminderSkipWeekends?: boolean;
    reminderSkipHolidays?: boolean;
    sort?: number;
    notified?: boolean;
    customGroupName?: string;
}

export interface RepeatConfig {
    enabled: boolean;
    type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'ebbinghaus' | 'lunar-monthly' | 'lunar-yearly';
    interval: number; // 间隔，如每2天、每3周
    weekDays?: number[]; // 每周的哪几天 (0-6, 0为周日)
    monthDays?: number[]; // 每月的哪几天 (1-31)
    monthlyRepeatMode?: MonthlyRepeatMode; // 每月重复方式：按日期/按星期
    monthlyWeekRules?: MonthlyWeekRule[]; // 每月按星期重复的规则列表
    monthlyWeekOrder?: MonthlyWeekOrder; // 旧字段：每月第几个星期几，-1 表示最后一个
    monthlyWeekday?: number; // 旧字段：每月按星期重复的星期几 (0-6, 0为周日)
    months?: number[]; // 每年的哪几个月 (1-12)
    lunarDay?: number; // 农历日期（1-30）
    lunarMonth?: number; // 农历月份（1-12）
    endDate?: string; // 重复截止日期
    endCount?: number; // 重复次数限制
    endType: 'never' | 'date' | 'count'; // 结束类型
    ebbinghausPattern?: number[]; // 艾宾浩斯重复模式（天数间隔）
    reminderSkipWeekendMode?: ReminderSkipWeekendMode; // 重复任务提醒跳过周末模式；未设置时跟随全局设置
    reminderSkipWeekends?: boolean; // 旧字段：重复任务提醒是否跳过周末；未设置时跟随全局设置
    reminderSkipHolidays?: boolean; // 重复任务提醒是否跳过节假日；未设置时跟随全局设置
    skippedDateAction?: RepeatSkippedDateAction; // 命中跳过日期时跳过本周期或顺延实例；默认跳过
    excludeDates?: string[]; // 排除的日期列表
    instances?: Record<string, RepeatInstanceState>; // 统一实例状态
}

export class RepeatSettingsDialog {
    private dialog: Dialog;
    private repeatConfig: RepeatConfig;
    private onSaved?: (config: RepeatConfig) => void;
    private startDate?: string; // 任务开始日期

    constructor(initialConfig?: RepeatConfig, onSaved?: (config: RepeatConfig) => void, startDate?: string) {
        this.repeatConfig = initialConfig || {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };
        this.onSaved = onSaved;
        this.startDate = startDate;

        // 如果是农历重复类型且没有设置农历日期，从开始日期（或今天）计算
        if (this.repeatConfig.type === 'lunar-monthly' || this.repeatConfig.type === 'lunar-yearly') {
            if (!this.repeatConfig.lunarDay || !this.repeatConfig.lunarMonth) {
                this.initLunarDateFromStartDate();
            }
        }
    }

    private initLunarDateFromStartDate() {
        try {
            // 如果没有设置 startDate，使用今天的日期
            const dateToUse = this.startDate || getLogicalDateString();

            const lunar = solarToLunar(dateToUse);

            this.repeatConfig.lunarDay = lunar.day;
            // 农历月份总是需要设置（即使是 lunar-monthly 类型也需要知道月份）
            this.repeatConfig.lunarMonth = lunar.month;

        } catch (error) {
            console.error('Failed to initialize lunar date from start date:', error);
        }
    }

    public show() {
        this.dialog = new Dialog({
            title: i18n("repeatSettings"),
            content: this.createDialogContent(),
            width: "560px",
            height: this.repeatConfig.enabled ? "min(600px, calc(100vh - 48px))" : "auto"
        });
        this.dialog.element.querySelector('.b3-dialog__container')?.classList.add('repeat-settings-dialog');

        this.bindEvents();
        this.updateUI();
    }

    private getCurrentSkipWeekendMode(): ReminderSkipWeekendMode {
        return normalizeReminderSkipWeekendMode(this.repeatConfig.reminderSkipWeekendMode) ||
            normalizeReminderSkipWeekendMode(this.repeatConfig.reminderSkipWeekends) ||
            'none';
    }

    private createSkipWeekendModeOptions(): string {
        const selectedMode = this.getCurrentSkipWeekendMode();
        const options: Array<{ value: ReminderSkipWeekendMode; label: string }> = [
            { value: 'saturdaySunday', label: i18n('reminderSkipWeekendSaturdaySunday') || '跳过周六和周日' },
            { value: 'saturday', label: i18n('reminderSkipWeekendSaturday') || '仅跳过周六' },
            { value: 'sunday', label: i18n('reminderSkipWeekendSunday') || '仅跳过周日' },
            { value: 'none', label: i18n('reminderSkipWeekendNone') || '不跳过' },
        ];

        return options.map(option => `
            <option value="${option.value}" ${option.value === selectedMode ? 'selected' : ''}>${option.label}</option>
        `).join('');
    }

    private tr(key: string, fallback: string): string {
        return i18n(key) || fallback;
    }

    private getMonthlyRepeatMode(): MonthlyRepeatMode {
        if (this.repeatConfig.monthlyRepeatMode === 'weekday') {
            return this.repeatConfig.monthlyRepeatMode;
        }
        if (
            this.repeatConfig.monthlyRepeatMode !== 'date' &&
            (this.getConfiguredMonthlyWeekRules().length > 0 ||
                (this.repeatConfig.monthlyWeekOrder !== undefined && this.repeatConfig.monthlyWeekday !== undefined)) &&
            (!this.repeatConfig.monthDays || this.repeatConfig.monthDays.length === 0)
        ) {
            return 'weekday';
        }
        return 'date';
    }

    private isValidMonthlyWeekOrder(order: number): order is MonthlyWeekOrder {
        return order === -1 || (order >= 1 && order <= 5);
    }

    private isValidMonthlyWeekday(weekday: number): boolean {
        return weekday >= 0 && weekday <= 6;
    }

    private getMonthlyWeekRuleKey(rule: MonthlyWeekRule): string {
        return `${rule.order}:${rule.weekday}`;
    }

    private getConfiguredMonthlyWeekRules(): MonthlyWeekRule[] {
        const rules: MonthlyWeekRule[] = [];
        const seen = new Set<string>();
        const appendRule = (order: number, weekday: number) => {
            if (!this.isValidMonthlyWeekOrder(order) || !this.isValidMonthlyWeekday(weekday)) return;
            const rule = { order, weekday };
            const key = this.getMonthlyWeekRuleKey(rule);
            if (seen.has(key)) return;
            seen.add(key);
            rules.push(rule);
        };

        if (Array.isArray(this.repeatConfig.monthlyWeekRules)) {
            this.repeatConfig.monthlyWeekRules.forEach(rule => {
                appendRule(Number(rule?.order), Number(rule?.weekday));
            });
        }

        if (rules.length === 0) {
            appendRule(Number(this.repeatConfig.monthlyWeekOrder), Number(this.repeatConfig.monthlyWeekday));
        }

        return this.sortMonthlyWeekRules(rules);
    }

    private getDefaultMonthlyWeekRules(): MonthlyWeekRule[] {
        const configuredRules = this.getConfiguredMonthlyWeekRules();
        if (configuredRules.length > 0) {
            return configuredRules;
        }

        if (this.startDate) {
            try {
                const date = new Date(this.startDate + 'T00:00:00');
                if (!isNaN(date.getTime())) {
                    return [{
                        order: Math.min(Math.ceil(date.getDate() / 7), 5) as MonthlyWeekOrder,
                        weekday: date.getDay()
                    }];
                }
            } catch (e) {
                // 如果解析失败，使用默认值
            }
        }

        return [{ order: 1, weekday: new Date().getDay() }];
    }

    private getMonthlyWeekOrderOptions(): Array<{ value: MonthlyWeekOrder; label: string }> {
        return [
            { value: 1, label: this.tr('monthlyWeekOrderFirst', '第一个') },
            { value: 2, label: this.tr('monthlyWeekOrderSecond', '第二个') },
            { value: 3, label: this.tr('monthlyWeekOrderThird', '第三个') },
            { value: 4, label: this.tr('monthlyWeekOrderFourth', '第四个') },
            { value: 5, label: this.tr('monthlyWeekOrderFifth', '第五个') },
            { value: -1, label: this.tr('monthlyWeekOrderLast', '最后一个') }
        ];
    }

    private getMonthlyWeekdayOptions(): Array<{ value: number; label: string; short: string }> {
        return [
            { value: 1, label: i18n("monday") || '周一', short: i18n("mon") || '一' },
            { value: 2, label: i18n("tuesday") || '周二', short: i18n("tue") || '二' },
            { value: 3, label: i18n("wednesday") || '周三', short: i18n("wed") || '三' },
            { value: 4, label: i18n("thursday") || '周四', short: i18n("thu") || '四' },
            { value: 5, label: i18n("friday") || '周五', short: i18n("fri") || '五' },
            { value: 6, label: i18n("saturday") || '周六', short: i18n("sat") || '六' },
            { value: 0, label: i18n("sunday") || '周日', short: i18n("sun") || '日' }
        ];
    }

    private sortMonthlyWeekRules(rules: MonthlyWeekRule[]): MonthlyWeekRule[] {
        const orderRank = (order: MonthlyWeekOrder) => order === -1 ? 6 : order;
        const weekdayRank = (weekday: number) => weekday === 0 ? 7 : weekday;
        return [...rules].sort((a, b) => {
            const orderCompare = orderRank(a.order) - orderRank(b.order);
            if (orderCompare !== 0) return orderCompare;
            return weekdayRank(a.weekday) - weekdayRank(b.weekday);
        });
    }

    private normalizeMonthlyWeekRules(rules: MonthlyWeekRule[]): MonthlyWeekRule[] {
        const seen = new Set<string>();
        const normalized: MonthlyWeekRule[] = [];
        rules.forEach(rule => {
            if (!this.isValidMonthlyWeekOrder(rule.order) || !this.isValidMonthlyWeekday(rule.weekday)) return;
            const key = this.getMonthlyWeekRuleKey(rule);
            if (seen.has(key)) return;
            seen.add(key);
            normalized.push(rule);
        });
        return this.sortMonthlyWeekRules(normalized);
    }

    private createMonthlyRepeatModeSelector(): string {
        const selectedMode = this.getMonthlyRepeatMode();
        const options: Array<{ value: MonthlyRepeatMode; label: string }> = [
            { value: 'date', label: this.tr('repeatMonthlyModeDate', '按日期') },
            { value: 'weekday', label: this.tr('repeatMonthlyModeWeekday', '按星期') }
        ];

        return `
            <div class="monthly-repeat-mode-selector" style="display: flex; gap: 4px; padding: 4px; margin-bottom: 8px; background: var(--b3-theme-surface-lighter); border-radius: 6px;">
                ${options.map(option => `
                    <button type="button"
                            class="b3-button monthly-repeat-mode-btn ${selectedMode === option.value ? 'b3-button--primary' : 'b3-button--outline'}"
                            data-mode="${option.value}"
                            style="flex: 1; min-width: 0; justify-content: center;">
                        ${option.label}
                    </button>
                `).join('')}
            </div>
        `;
    }

    private createMonthlyWeekOrderSelectOptions(selectedOrder: MonthlyWeekOrder): string {
        return this.getMonthlyWeekOrderOptions().map(option => `
            <option value="${option.value}" ${option.value === selectedOrder ? 'selected' : ''}>${option.label}</option>
        `).join('');
    }

    private createMonthlyWeekdaySelectOptions(selectedWeekday: number): string {
        return this.getMonthlyWeekdayOptions().map(day => `
            <option value="${day.value}" ${day.value === selectedWeekday ? 'selected' : ''}>${day.label}</option>
        `).join('');
    }

    private createMonthlyWeekRuleRow(rule: MonthlyWeekRule, canRemove: boolean): string {
        return `
            <div class="monthly-week-rule-row" style="display: flex; align-items: center; gap: 8px;">
                <select class="b3-select monthly-week-order-select" style="flex: 1; min-width: 0;">
                    ${this.createMonthlyWeekOrderSelectOptions(rule.order)}
                </select>
                <select class="b3-select monthly-weekday-select" style="flex: 1; min-width: 0;">
                    ${this.createMonthlyWeekdaySelectOptions(rule.weekday)}
                </select>
                <button type="button"
                        class="b3-button b3-button--outline monthly-week-rule-remove"
                        title="${i18n('remove') || '移除'}"
                        style="width: 32px; min-width: 32px; padding: 0; ${canRemove ? '' : 'visibility: hidden;'}"
                        ${canRemove ? '' : 'disabled'}>×</button>
            </div>
        `;
    }

    private createMonthlyWeekRuleSelector(): string {
        const rules = this.getDefaultMonthlyWeekRules();
        const addLabel = i18n('addCheckIn') || '添加';

        return `
            <div id="monthlyWeekRulesList" style="display: flex; flex-direction: column; gap: 8px;">
                ${rules.map(rule => this.createMonthlyWeekRuleRow(rule, rules.length > 1)).join('')}
            </div>
            <button type="button" id="addMonthlyWeekRuleBtn" class="b3-button b3-button--outline" style="margin-top: 8px; width: 100%; justify-content: center;">
                ${addLabel}
            </button>
        `;
    }

    private createDialogContent(): string {
        return `
                <div class="b3-dialog__content">
                    <div class="repeat-settings-toggle">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="enableRepeat" ${this.repeatConfig.enabled ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${i18n("enableRepeat")}</span>
                        </label>
                    </div>

                    <div id="repeatOptions" class="repeat-options" style="display: ${this.repeatConfig.enabled ? 'block' : 'none'}">
                        <div class="repeat-settings-section repeat-settings-section--schedule">
                        <div class="repeat-settings-section__title">${this.tr('repeatRule', '重复规则')}</div>
                        <!-- 重复类型选择 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("repeatType")}</label>
                            <select id="repeatType" class="b3-select">
                                <option value="daily" ${this.repeatConfig.type === 'daily' ? 'selected' : ''}>${i18n("daily")}</option>
                                <option value="weekly" ${this.repeatConfig.type === 'weekly' ? 'selected' : ''}>${i18n("weekly")}</option>
                                <option value="monthly" ${this.repeatConfig.type === 'monthly' ? 'selected' : ''}>${i18n("monthly")}</option>
                                <option value="yearly" ${this.repeatConfig.type === 'yearly' ? 'selected' : ''}>${i18n("yearly")}</option>
                                <option value="lunar-monthly" ${this.repeatConfig.type === 'lunar-monthly' ? 'selected' : ''}>${i18n("lunarMonthly")}</option>
                                <option value="lunar-yearly" ${this.repeatConfig.type === 'lunar-yearly' ? 'selected' : ''}>${i18n("lunarYearly")}</option>
                                <option value="ebbinghaus" ${this.repeatConfig.type === 'ebbinghaus' ? 'selected' : ''}>${i18n("ebbinghaus")}</option>
                            </select>
                        </div>

                        <!-- 间隔设置 -->
                        <div id="intervalGroup" class="b3-form__group">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("repeatInterval")}</label>
                            <div class="repeat-interval-container">
                                <span>${i18n("every")}</span>
                                <input type="number" id="repeatInterval" class="b3-text-field" min="1" max="99" value="${this.repeatConfig.interval || 1}" style="width: 60px; margin: 0 8px;">
                                <span id="intervalUnit">${this.getIntervalUnit()}</span>
                            </div>
                        </div>

                        <!-- 每周选项（星期选择） -->
                        <div id="weeklyOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("repeatOnDays")}</label>
                            <div class="weekday-selector">
                                ${this.createWeekdaySelector()}
                            </div>
                        </div>

                        <!-- 每月选项（日期选择） -->
                        <div id="monthlyOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label" style="font-weight: 600;">${this.tr('repeatMonthlyRule', '每月重复')}</label>
                            ${this.createMonthlyRepeatModeSelector()}
                            <div id="monthlyDateOptions">
                                <div class="monthday-selector">
                                    ${this.createMonthdaySelector()}
                                </div>
                            </div>
                            <div id="monthlyWeekdayOptions" style="display: none;">
                                ${this.createMonthlyWeekRuleSelector()}
                            </div>
                        </div>

                        <!-- 每年选项（日期输入框 MM-DD） -->
                        <div id="yearlyOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("repeatDate")}</label>
                            <div class="repeat-settings-yearly-date-row">
                                <input type="text" id="yearlyDateInput" class="b3-text-field" placeholder="${i18n("habitYearlyDatePlaceholder")}" value="${this.getYearlyDateValue()}">
                                <span class="repeat-settings-date-format">${i18n("dateFormatDesc")}</span>
                            </div>
                        </div>

                        <!-- 艾宾浩斯说明 -->
                        <div id="ebbinghausInfo" class="b3-form__group" style="display: none;">
                            <div class="b3-form__desc">
                                ${i18n("ebbinghausDesc")}
                                <br>
                                <span class="ebbinghaus-pattern">${i18n("ebbinghausPattern")}: 1, 2, 4, 7, 15 ${i18n("days")}</span>
                            </div>
                        </div>

                        <!-- 农历日期选择 -->
                        <div id="lunarOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("lunarDate")}</label>
                            <div class="lunar-date-selector">
                                <span id="lunarMonthlyGroup" style="display: none;">
                                    ${i18n("lunarDay")}: 
                                    <input type="number" id="lunarDay" class="b3-text-field" min="1" max="30" value="${this.repeatConfig.lunarDay || 1}" style="width: 60px; margin: 0 8px;">
                                </span>
                                <span id="lunarYearlyGroup" style="display: none;">
                                    ${i18n("lunarMonth")}: 
                                    <select id="lunarMonth" class="b3-select" style="width: 100px; margin: 0 8px;">
                                        ${this.createLunarMonthSelector()}
                                    </select>
                                    ${i18n("lunarDay")}: 
                                    <input type="number" id="lunarDayYearly" class="b3-text-field" min="1" max="30" value="${this.repeatConfig.lunarDay || 1}" style="width: 60px; margin: 0 8px;">
                                </span>
                            </div>
                            <blockquote class="repeat-settings-lunar-note">
                                ${i18n("lunarDateDesc")}
                            </blockquote>
                        </div>

                        </div>

                        <div id="repeatReminderSkipOptions" class="repeat-settings-section">
                            <div class="repeat-settings-section__title">${i18n('reminderSkipDateOptions') || '提醒跳过'}</div>
                            <div class="repeat-settings-skip-list">
                                <label class="repeat-settings-skip-row">
                                    <span>${i18n('reminderSkipWeekendsTask') || '任务提醒跳过周末'}</span>
                                    <select id="repeatReminderSkipWeekendMode" class="b3-select">
                                        ${this.createSkipWeekendModeOptions()}
                                    </select>
                                </label>
                                <label class="repeat-settings-skip-row">
                                    <span>${this.tr('reminderSkipHolidaysTask', '任务提醒跳过节假日')}</span>
                                    <select id="repeatReminderSkipHolidays" class="b3-select">
                                        <option value="true" ${this.repeatConfig.reminderSkipHolidays === true ? 'selected' : ''}>${this.tr('reminderSkipHolidaysYes', '跳过节假日')}</option>
                                        <option value="false" ${this.repeatConfig.reminderSkipHolidays !== true ? 'selected' : ''}>${this.tr('reminderSkipWeekendNone', '不跳过')}</option>
                                    </select>
                                </label>
                                <label class="repeat-settings-skip-row">
                                    <span>${this.tr('repeatSkippedDateAction', '遇到跳过日期')}</span>
                                    <select id="repeatSkippedDateAction" class="b3-select">
                                        <option value="skip" ${this.repeatConfig.skippedDateAction !== 'postpone' ? 'selected' : ''}>${this.tr('repeatSkipCurrentCycle', '跳过本周期')}</option>
                                        <option value="postpone" ${this.repeatConfig.skippedDateAction === 'postpone' ? 'selected' : ''}>${this.tr('repeatPostponeToNextAvailableDate', '顺延到下一个可用日')}</option>
                                    </select>
                                </label>
                            </div>
                        </div>

                        <!-- 结束条件 -->
                        <div class="repeat-settings-section repeat-settings-section--end">
                            <div class="repeat-settings-section__title">${i18n("repeatEnd")}</div>
                            <div class="repeat-end-options">
                                <label class="b3-radio">
                                    <input type="radio" name="endType" value="never" ${this.repeatConfig.endType === 'never' ? 'checked' : ''}>
                                    <span class="b3-radio__graphic"></span>
                                    <span class="b3-radio__label">${i18n("never")}</span>
                                </label>
                                <label class="b3-radio">
                                    <input type="radio" name="endType" value="date" ${this.repeatConfig.endType === 'date' ? 'checked' : ''}>
                                    <span class="b3-radio__graphic"></span>
                                    <span class="b3-radio__label">${i18n("endByDate")}</span>
                                </label>
                                <label class="b3-radio">
                                    <input type="radio" name="endType" value="count" ${this.repeatConfig.endType === 'count' ? 'checked' : ''}>
                                    <span class="b3-radio__graphic"></span>
                                    <span class="b3-radio__label">${i18n("endByCount")}</span>
                                </label>
                            </div>

                        <!-- 结束日期 -->
                        <div id="endDateGroup" class="b3-form__group repeat-settings-end-detail" style="display: ${this.repeatConfig.endType === 'date' ? 'block' : 'none'}">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("endDate")}</label>
                            <input type="date" id="endDate" class="b3-text-field" value="${this.repeatConfig.endDate || ''}" max="9999-12-31">
                        </div>

                        <!-- 结束次数 -->
                        <div id="endCountGroup" class="b3-form__group repeat-settings-end-detail" style="display: ${this.repeatConfig.endType === 'count' ? 'block' : 'none'}">
                            <label class="b3-form__label" style="font-weight: 600;">${i18n("endAfterCount")}</label>
                            <input type="number" id="endCount" class="b3-text-field" min="1" max="999" value="${this.repeatConfig.endCount || 10}" style="width: 80px;">
                            <span style="margin-left: 8px;">${i18n("times")}</span>
                        </div>
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${i18n("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="confirmBtn">${i18n("save")}</button>
                </div>
        `;
    }

    private getYearlyDateValue(): string {
        // 如果已经设置了月份和日期，返回格式化的值
        if (this.repeatConfig.months && this.repeatConfig.months.length > 0 &&
            this.repeatConfig.monthDays && this.repeatConfig.monthDays.length > 0) {
            const month = String(this.repeatConfig.months[0]).padStart(2, '0');
            const day = String(this.repeatConfig.monthDays[0]).padStart(2, '0');
            return `${month}-${day}`;
        }

        // 否则从 startDate 推导默认值
        if (this.startDate) {
            try {
                const date = new Date(this.startDate + 'T00:00:00');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${month}-${day}`;
            } catch (e) {
                // 如果解析失败，返回空字符串
            }
        }

        return '';
    }

    private createWeekdaySelector(): string {
        const weekdays = [
            { value: 1, label: i18n("monday"), short: i18n("mon") },
            { value: 2, label: i18n("tuesday"), short: i18n("tue") },
            { value: 3, label: i18n("wednesday"), short: i18n("wed") },
            { value: 4, label: i18n("thursday"), short: i18n("thu") },
            { value: 5, label: i18n("friday"), short: i18n("fri") },
            { value: 6, label: i18n("saturday"), short: i18n("sat") },
            { value: 0, label: i18n("sunday"), short: i18n("sun") }
        ];

        // 如果没有设置weekDays但有startDate，自动选中起始日期的星期
        let defaultWeekDays = this.repeatConfig.weekDays || [];
        if (defaultWeekDays.length === 0 && this.startDate) {
            try {
                const date = new Date(this.startDate + 'T00:00:00');
                defaultWeekDays = [date.getDay()];
            } catch (e) {
                // 如果解析失败，保持为空数组
            }
        }

        return weekdays.map(day => `
            <label class="weekday-option b3-checkbox">
                <input type="checkbox" value="${day.value}" ${defaultWeekDays.includes(day.value) ? 'checked' : ''}>
                <span class="b3-checkbox__graphic"></span>
                <span class="b3-checkbox__label">${day.short}</span>
            </label>
        `).join('');
    }

    private createMonthdaySelector(): string {
        let html = '<div class="monthday-grid">';

        // 如果没有设置monthDays但有startDate，自动选中起始日期的日
        let defaultDays = this.repeatConfig.monthDays || [];
        if (defaultDays.length === 0 && this.startDate) {
            try {
                const date = new Date(this.startDate + 'T00:00:00');
                defaultDays = [date.getDate()];
            } catch (e) {
                // 如果解析失败，保持为空数组
            }
        }

        for (let i = 1; i <= 31; i++) {
            const checked = defaultDays.includes(i) ? 'checked' : '';
            html += `
                <label class="monthday-option b3-checkbox">
                    <input type="checkbox" value="${i}" ${checked}>
                    <span class="b3-checkbox__graphic"></span>
                    <span class="b3-checkbox__label">${i}</span>
                </label>
            `;
        }
        html += '</div>';
        return html;
    }

    private createMonthSelector(): string {
        const months = [
            i18n("january"), i18n("february"), i18n("march"), i18n("april"),
            i18n("may"), i18n("june"), i18n("july"), i18n("august"),
            i18n("september"), i18n("october"), i18n("november"), i18n("december")
        ];

        return months.map((month, index) => `
            <label class="month-option b3-checkbox">
                <input type="checkbox" value="${index + 1}" ${(this.repeatConfig.months || []).includes(index + 1) ? 'checked' : ''}>
                <span class="b3-checkbox__graphic"></span>
                <span class="b3-checkbox__label">${month}</span>
            </label>
        `).join('');
    }

    private createLunarMonthSelector(): string {
        const lunarMonths = [
            i18n("lunarMonth1"), i18n("lunarMonth2"), i18n("lunarMonth3"), i18n("lunarMonth4"),
            i18n("lunarMonth5"), i18n("lunarMonth6"), i18n("lunarMonth7"), i18n("lunarMonth8"),
            i18n("lunarMonth9"), i18n("lunarMonth10"), i18n("lunarMonth11"), i18n("lunarMonth12")
        ];

        return lunarMonths.map((month, index) => `
            <option value="${index + 1}" ${this.repeatConfig.lunarMonth === (index + 1) ? 'selected' : ''}>${month}</option>
        `).join('');
    }

    private bindEvents() {
        const enableRepeat = this.dialog.element.querySelector('#enableRepeat') as HTMLInputElement;
        const repeatType = this.dialog.element.querySelector('#repeatType') as HTMLSelectElement;
        const endTypeRadios = this.dialog.element.querySelectorAll('input[name="endType"]') as NodeListOf<HTMLInputElement>;
        const cancelBtn = this.dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#confirmBtn') as HTMLButtonElement;

        enableRepeat.addEventListener('change', () => {
            this.repeatConfig.enabled = enableRepeat.checked;
            this.updateUI();
        });

        repeatType.addEventListener('change', () => {
            const newType = repeatType.value as any;
            const oldType = this.repeatConfig.type;
            this.repeatConfig.type = newType;

            // 当从非农历类型切换到农历类型时，重新初始化农历日期
            if ((newType === 'lunar-monthly' || newType === 'lunar-yearly') &&
                (oldType !== 'lunar-monthly' && oldType !== 'lunar-yearly')) {
                // 重新计算农历日期（基于 startDate 或今天）
                this.initLunarDateFromStartDate();

                // 更新UI中的输入框值
                setTimeout(() => {
                    const lunarDayInput = this.dialog.element.querySelector('#lunarDay') as HTMLInputElement;
                    const lunarDayYearlyInput = this.dialog.element.querySelector('#lunarDayYearly') as HTMLInputElement;
                    const lunarMonthInput = this.dialog.element.querySelector('#lunarMonth') as HTMLSelectElement;



                    if (lunarDayInput && this.repeatConfig.lunarDay) {
                        lunarDayInput.value = this.repeatConfig.lunarDay.toString();
                    }
                    if (lunarDayYearlyInput && this.repeatConfig.lunarDay) {
                        lunarDayYearlyInput.value = this.repeatConfig.lunarDay.toString();
                    }
                    if (lunarMonthInput && this.repeatConfig.lunarMonth) {
                        lunarMonthInput.value = this.repeatConfig.lunarMonth.toString();
                    }
                }, 0);
            }

            this.updateUI();
        });

        endTypeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.repeatConfig.endType = radio.value as any;
                    this.updateUI();
                }
            });
        });

        cancelBtn.addEventListener('click', () => {
            this.dialog.destroy();
        });

        confirmBtn.addEventListener('click', () => {
            this.saveSettings();
        });

        const monthlyModeButtons = this.dialog.element.querySelectorAll('.monthly-repeat-mode-btn') as NodeListOf<HTMLButtonElement>;
        monthlyModeButtons.forEach(button => {
            button.addEventListener('click', () => {
                const mode = button.dataset.mode as MonthlyRepeatMode;
                if (!mode) return;
                this.repeatConfig.monthlyRepeatMode = mode;
                this.updateMonthlyOptionsUI();
            });
        });

        const addMonthlyWeekRuleBtn = this.dialog.element.querySelector('#addMonthlyWeekRuleBtn') as HTMLButtonElement;
        addMonthlyWeekRuleBtn?.addEventListener('click', () => {
            const list = this.dialog.element.querySelector('#monthlyWeekRulesList') as HTMLElement;
            if (!list) return;
            list.insertAdjacentHTML('beforeend', this.createMonthlyWeekRuleRow({ order: 1, weekday: 1 }, true));
            this.updateMonthlyWeekRuleRemoveButtons();
        });

        this.dialog.element.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const removeButton = target.closest('.monthly-week-rule-remove') as HTMLButtonElement;
            if (!removeButton) return;
            const rows = this.dialog.element.querySelectorAll('.monthly-week-rule-row') as NodeListOf<HTMLElement>;
            if (rows.length <= 1) return;
            removeButton.closest('.monthly-week-rule-row')?.remove();
            this.updateMonthlyWeekRuleRemoveButtons();
        });

        this.updateMonthlyWeekRuleRemoveButtons();
    }

    private updateUI() {
        const dialogContainer = this.dialog.element.querySelector('.b3-dialog__container') as HTMLElement;
        const repeatOptions = this.dialog.element.querySelector('#repeatOptions') as HTMLElement;
        const intervalGroup = this.dialog.element.querySelector('#intervalGroup') as HTMLElement;
        const weeklyOptions = this.dialog.element.querySelector('#weeklyOptions') as HTMLElement;
        const monthlyOptions = this.dialog.element.querySelector('#monthlyOptions') as HTMLElement;
        const yearlyOptions = this.dialog.element.querySelector('#yearlyOptions') as HTMLElement;
        const ebbinghausInfo = this.dialog.element.querySelector('#ebbinghausInfo') as HTMLElement;
        const lunarOptions = this.dialog.element.querySelector('#lunarOptions') as HTMLElement;
        const lunarMonthlyGroup = this.dialog.element.querySelector('#lunarMonthlyGroup') as HTMLElement;
        const lunarYearlyGroup = this.dialog.element.querySelector('#lunarYearlyGroup') as HTMLElement;
        const endDateGroup = this.dialog.element.querySelector('#endDateGroup') as HTMLElement;
        const endCountGroup = this.dialog.element.querySelector('#endCountGroup') as HTMLElement;
        const intervalUnit = this.dialog.element.querySelector('#intervalUnit') as HTMLElement;

        repeatOptions.style.display = this.repeatConfig.enabled ? 'block' : 'none';
        dialogContainer.style.height = this.repeatConfig.enabled ? 'min(600px, calc(100vh - 48px))' : 'auto';

        if (this.repeatConfig.enabled) {
            // 更新间隔单位
            intervalUnit.textContent = this.getIntervalUnit();

            // 显示/隐藏相关选项
            // 显示间隔输入：对大多数类型可用，排除艾宾浩斯和农历专用类型。
            // monthly 保留间隔支持，以实现“每 X 个月”的配置。
            const showInterval = this.repeatConfig.type !== 'ebbinghaus' &&
                this.repeatConfig.type !== 'lunar-monthly' && this.repeatConfig.type !== 'lunar-yearly' &&
                this.repeatConfig.type !== 'yearly';
            intervalGroup.style.display = showInterval ? 'block' : 'none';

            // 每周重复：显示星期选择器
            weeklyOptions.style.display = this.repeatConfig.type === 'weekly' ? 'block' : 'none';

            // 每月重复：显示日期选择器
            monthlyOptions.style.display = this.repeatConfig.type === 'monthly' ? 'block' : 'none';
            this.updateMonthlyOptionsUI();

            // 每年重复：显示日期输入框
            yearlyOptions.style.display = this.repeatConfig.type === 'yearly' ? 'block' : 'none';

            ebbinghausInfo.style.display = this.repeatConfig.type === 'ebbinghaus' ? 'block' : 'none';

            // 显示/隐藏农历选项
            const showLunar = this.repeatConfig.type === 'lunar-monthly' || this.repeatConfig.type === 'lunar-yearly';
            lunarOptions.style.display = showLunar ? 'block' : 'none';

            if (showLunar) {
                lunarMonthlyGroup.style.display = this.repeatConfig.type === 'lunar-monthly' ? 'inline' : 'none';
                lunarYearlyGroup.style.display = this.repeatConfig.type === 'lunar-yearly' ? 'inline' : 'none';
            }

            // 结束条件
            endDateGroup.style.display = this.repeatConfig.endType === 'date' ? 'block' : 'none';
            endCountGroup.style.display = this.repeatConfig.endType === 'count' ? 'block' : 'none';
        }
    }

    private updateMonthlyOptionsUI() {
        const mode = this.getMonthlyRepeatMode();
        const monthlyDateOptions = this.dialog.element.querySelector('#monthlyDateOptions') as HTMLElement;
        const monthlyWeekdayOptions = this.dialog.element.querySelector('#monthlyWeekdayOptions') as HTMLElement;
        const monthlyModeButtons = this.dialog.element.querySelectorAll('.monthly-repeat-mode-btn') as NodeListOf<HTMLButtonElement>;

        monthlyModeButtons.forEach(button => {
            const isActive = button.dataset.mode === mode;
            button.classList.toggle('b3-button--primary', isActive);
            button.classList.toggle('b3-button--outline', !isActive);
        });

        if (monthlyDateOptions) {
            monthlyDateOptions.style.display = mode === 'date' ? 'block' : 'none';
        }
        if (monthlyWeekdayOptions) {
            monthlyWeekdayOptions.style.display = mode === 'weekday' ? 'block' : 'none';
        }
    }

    private updateMonthlyWeekRuleRemoveButtons() {
        const rows = this.dialog.element.querySelectorAll('.monthly-week-rule-row') as NodeListOf<HTMLElement>;
        const canRemove = rows.length > 1;
        rows.forEach(row => {
            const removeButton = row.querySelector('.monthly-week-rule-remove') as HTMLButtonElement;
            if (!removeButton) return;
            removeButton.disabled = !canRemove;
            removeButton.style.visibility = canRemove ? 'visible' : 'hidden';
        });
    }

    private getIntervalUnit(): string {
        switch (this.repeatConfig.type) {
            case 'daily':
                return this.repeatConfig.interval === 1 ? i18n("day") : i18n("days");
            case 'weekly':
                return this.repeatConfig.interval === 1 ? i18n("week") : i18n("weeks");
            case 'monthly':
                return this.repeatConfig.interval === 1 ? i18n("month") : i18n("months");
            case 'yearly':
                return this.repeatConfig.interval === 1 ? i18n("year") : i18n("years");
            default:
                return i18n("day");
        }
    }

    private saveSettings() {
        // 验证设置
        if (this.repeatConfig.enabled) {
            const intervalInput = this.dialog.element.querySelector('#repeatInterval') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#endDate') as HTMLInputElement;
            const endCountInput = this.dialog.element.querySelector('#endCount') as HTMLInputElement;
            const skipWeekendModeSelect = this.dialog.element.querySelector('#repeatReminderSkipWeekendMode') as HTMLSelectElement;
            const skipHolidaysSelect = this.dialog.element.querySelector('#repeatReminderSkipHolidays') as HTMLSelectElement;
            const skippedDateActionSelect = this.dialog.element.querySelector('#repeatSkippedDateAction') as HTMLSelectElement;

            this.repeatConfig.interval = parseInt(intervalInput.value) || 1;
            this.repeatConfig.reminderSkipWeekendMode = normalizeReminderSkipWeekendMode(skipWeekendModeSelect?.value) || 'none';
            delete this.repeatConfig.reminderSkipWeekends;
            this.repeatConfig.reminderSkipHolidays = skipHolidaysSelect?.value === 'true';
            this.repeatConfig.skippedDateAction = skippedDateActionSelect?.value === 'postpone' ? 'postpone' : 'skip';

            if (this.repeatConfig.type === 'weekly') {
                // 收集星期选项
                const weekDayInputs = this.dialog.element.querySelectorAll('#weeklyOptions input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                this.repeatConfig.weekDays = Array.from(weekDayInputs).map(input => parseInt(input.value));
                if (this.repeatConfig.weekDays.length === 0) {
                    showMessage(i18n("pleaseSelectAtLeastOneWeekday"), 3000, 'error');
                    return;
                }
            }

            if (this.repeatConfig.type === 'monthly') {
                const monthlyMode = this.getMonthlyRepeatMode();
                if (monthlyMode === 'weekday') {
                    const ruleRows = this.dialog.element.querySelectorAll('.monthly-week-rule-row') as NodeListOf<HTMLElement>;
                    const rules = this.normalizeMonthlyWeekRules(Array.from(ruleRows)
                        .map(row => {
                            const orderSelect = row.querySelector('.monthly-week-order-select') as HTMLSelectElement;
                            const weekdaySelect = row.querySelector('.monthly-weekday-select') as HTMLSelectElement;
                            return {
                                order: parseInt(orderSelect?.value || '', 10) as MonthlyWeekOrder,
                                weekday: parseInt(weekdaySelect?.value || '', 10)
                            };
                        })
                        .filter(rule => this.isValidMonthlyWeekOrder(rule.order) && this.isValidMonthlyWeekday(rule.weekday)));

                    if (rules.length === 0) {
                        showMessage(this.tr('pleaseSelectMonthlyWeekday', '请选择每月重复的星期'), 3000, 'error');
                        return;
                    }

                    this.repeatConfig.monthlyRepeatMode = 'weekday';
                    this.repeatConfig.monthlyWeekRules = rules;
                    if (rules.length === 1) {
                        this.repeatConfig.monthlyWeekOrder = rules[0].order;
                        this.repeatConfig.monthlyWeekday = rules[0].weekday;
                    } else {
                        delete this.repeatConfig.monthlyWeekOrder;
                        delete this.repeatConfig.monthlyWeekday;
                    }
                    delete this.repeatConfig.monthDays;
                } else {
                    // 收集日期选项
                    const monthDayInputs = this.dialog.element.querySelectorAll('#monthlyDateOptions input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                    this.repeatConfig.monthDays = Array.from(monthDayInputs).map(input => parseInt(input.value)).sort((a, b) => a - b);
                    if (this.repeatConfig.monthDays.length === 0) {
                        showMessage(i18n("pleaseSelectAtLeastOneDay"), 3000, 'error');
                        return;
                    }
                    this.repeatConfig.monthlyRepeatMode = 'date';
                    delete this.repeatConfig.monthlyWeekRules;
                    delete this.repeatConfig.monthlyWeekOrder;
                    delete this.repeatConfig.monthlyWeekday;
                }
            } else {
                delete this.repeatConfig.monthlyRepeatMode;
                delete this.repeatConfig.monthlyWeekRules;
                delete this.repeatConfig.monthlyWeekOrder;
                delete this.repeatConfig.monthlyWeekday;
            }

            if (this.repeatConfig.type === 'yearly') {
                // 从日期输入框解析月份和日期
                const yearlyDateInput = this.dialog.element.querySelector('#yearlyDateInput') as HTMLInputElement;
                const yearlyDateStr = yearlyDateInput.value.trim();
                if (yearlyDateStr) {
                    const match = yearlyDateStr.match(/^(\d{1,2})-(\d{1,2})$/);
                    if (match) {
                        const month = parseInt(match[1]);
                        const day = parseInt(match[2]);
                        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                            this.repeatConfig.months = [month];
                            this.repeatConfig.monthDays = [day];
                        } else {
                            showMessage(i18n("invalidDateRange"), 3000, 'error');
                            return;
                        }
                    } else {
                        showMessage(i18n("invalidDateFormatMMDD"), 3000, 'error');
                        return;
                    }
                } else {
                    showMessage(i18n("pleaseEnterDate"), 3000, 'error');
                    return;
                }
            }

            if (this.repeatConfig.type === 'ebbinghaus') {
                this.repeatConfig.ebbinghausPattern = [1, 2, 4, 7, 15]; // 默认艾宾浩斯曲线
            }

            if (this.repeatConfig.type === 'lunar-monthly') {
                const lunarDayInput = this.dialog.element.querySelector('#lunarDay') as HTMLInputElement;
                this.repeatConfig.lunarDay = parseInt(lunarDayInput.value) || 1;
                if (this.repeatConfig.lunarDay < 1 || this.repeatConfig.lunarDay > 30) {
                    showMessage(i18n("invalidLunarDay"));
                    return;
                }
            }

            if (this.repeatConfig.type === 'lunar-yearly') {
                const lunarMonthInput = this.dialog.element.querySelector('#lunarMonth') as HTMLSelectElement;
                const lunarDayYearlyInput = this.dialog.element.querySelector('#lunarDayYearly') as HTMLInputElement;
                this.repeatConfig.lunarMonth = parseInt(lunarMonthInput.value) || 1;
                this.repeatConfig.lunarDay = parseInt(lunarDayYearlyInput.value) || 1;
                if (this.repeatConfig.lunarDay < 1 || this.repeatConfig.lunarDay > 30) {
                    showMessage(i18n("invalidLunarDay"));
                    return;
                }
            }

            if (this.repeatConfig.endType === 'date') {
                this.repeatConfig.endDate = endDateInput.value;
                if (!this.repeatConfig.endDate) {
                    showMessage(i18n("pleaseSelectEndDate"));
                    return;
                }
            } else if (this.repeatConfig.endType === 'count') {
                this.repeatConfig.endCount = parseInt(endCountInput.value) || 10;
            }
        } else {
            delete this.repeatConfig.reminderSkipWeekendMode;
            delete this.repeatConfig.reminderSkipWeekends;
            delete this.repeatConfig.reminderSkipHolidays;
            delete this.repeatConfig.skippedDateAction;
        }

        if (this.onSaved) {
            this.onSaved(this.repeatConfig);
        }

        this.dialog.destroy();
    }
}
