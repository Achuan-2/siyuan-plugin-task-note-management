import { Dialog, showMessage } from "siyuan";
import { t } from "../utils/i18n";
import { solarToLunar } from "../utils/lunarUtils";
import { getLogicalDateString } from "../utils/dateUtils";

export interface RepeatConfig {
    enabled: boolean;
    type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'ebbinghaus' | 'lunar-monthly' | 'lunar-yearly';
    interval: number; // 间隔，如每2天、每3周
    weekDays?: number[]; // 每周的哪几天 (0-6, 0为周日)
    monthDays?: number[]; // 每月的哪几天 (1-31)
    months?: number[]; // 每年的哪几个月 (1-12)
    lunarDay?: number; // 农历日期（1-30）
    lunarMonth?: number; // 农历月份（1-12）
    endDate?: string; // 重复截止日期
    endCount?: number; // 重复次数限制
    endType: 'never' | 'date' | 'count'; // 结束类型
    ebbinghausPattern?: number[]; // 艾宾浩斯重复模式（天数间隔）
    excludeDates?: string[]; // 排除的日期列表
    instanceModifications?: {
        [date: string]: {
            title?: string;
            date?: string;
            endDate?: string;
            time?: string;
            endTime?: string;
            note?: string; // 实例级别的备注
            priority?: string;
            modifiedAt?: string;
        }
    }; // 实例修改列表
    completedInstances?: string[]; // 已完成的实例日期列表
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
            title: t("repeatSettings"),
            content: this.createDialogContent(),
            width: "480px",
            height: "290px"
        });

        this.bindEvents();
        this.updateUI();
    }

    private createDialogContent(): string {
        return `
            <div class="repeat-settings-dialog">
                <div class="b3-dialog__content" style="height: 159px;">
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="enableRepeat" ${this.repeatConfig.enabled ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${t("enableRepeat")}</span>
                        </label>
                    </div>

                    <div id="repeatOptions" class="repeat-options" style="display: ${this.repeatConfig.enabled ? 'block' : 'none'}">
                        <!-- 重复类型选择 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("repeatType")}</label>
                            <select id="repeatType" class="b3-select">
                                <option value="daily" ${this.repeatConfig.type === 'daily' ? 'selected' : ''}>${t("daily")}</option>
                                <option value="weekly" ${this.repeatConfig.type === 'weekly' ? 'selected' : ''}>${t("weekly")}</option>
                                <option value="monthly" ${this.repeatConfig.type === 'monthly' ? 'selected' : ''}>${t("monthly")}</option>
                                <option value="yearly" ${this.repeatConfig.type === 'yearly' ? 'selected' : ''}>${t("yearly")}</option>
                                <option value="lunar-monthly" ${this.repeatConfig.type === 'lunar-monthly' ? 'selected' : ''}>${t("lunarMonthly")}</option>
                                <option value="lunar-yearly" ${this.repeatConfig.type === 'lunar-yearly' ? 'selected' : ''}>${t("lunarYearly")}</option>
                                <option value="custom" ${this.repeatConfig.type === 'custom' ? 'selected' : ''}>${t("custom")}</option>
                                <option value="ebbinghaus" ${this.repeatConfig.type === 'ebbinghaus' ? 'selected' : ''}>${t("ebbinghaus")}</option>
                            </select>
                        </div>

                        <!-- 间隔设置 -->
                        <div id="intervalGroup" class="b3-form__group">
                            <label class="b3-form__label">${t("repeatInterval")}</label>
                            <div class="repeat-interval-container">
                                <span>${t("every")}</span>
                                <input type="number" id="repeatInterval" class="b3-text-field" min="1" max="99" value="${this.repeatConfig.interval || 1}" style="width: 60px; margin: 0 8px;">
                                <span id="intervalUnit">${this.getIntervalUnit()}</span>
                            </div>
                        </div>

                        <!-- 自定义重复选项 -->
                        <div id="customOptions" style="display: none;">
                            <!-- 每周选项 -->
                            <div id="weeklyOptions" class="b3-form__group" style="display: none;">
                                <label class="b3-form__label">${t("repeatOnDays")}</label>
                                <div class="weekday-selector">
                                    ${this.createWeekdaySelector()}
                                </div>
                            </div>

                            <!-- 每月选项 -->
                            <div id="monthlyOptions" class="b3-form__group" style="display: none;">
                                <label class="b3-form__label">${t("repeatOnDates")}</label>
                                <div class="monthday-selector">
                                    ${this.createMonthdaySelector()}
                                </div>
                            </div>

                            <!-- 每年选项 -->
                            <div id="yearlyOptions" class="b3-form__group" style="display: none;">
                                <label class="b3-form__label">${t("repeatInMonths")}</label>
                                <div class="month-selector">
                                    ${this.createMonthSelector()}
                                </div>
                            </div>
                        </div>

                        <!-- 艾宾浩斯说明 -->
                        <div id="ebbinghausInfo" class="b3-form__group" style="display: none;">
                            <div class="b3-form__desc">
                                ${t("ebbinghausDesc")}
                                <br>
                                <span class="ebbinghaus-pattern">${t("ebbinghausPattern")}: 1, 2, 4, 7, 15 ${t("days")}</span>
                            </div>
                        </div>

                        <!-- 农历日期选择 -->
                        <div id="lunarOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label">${t("lunarDate")}</label>
                            <div class="lunar-date-selector">
                                <span id="lunarMonthlyGroup" style="display: none;">
                                    ${t("lunarDay")}: 
                                    <input type="number" id="lunarDay" class="b3-text-field" min="1" max="30" value="${this.repeatConfig.lunarDay || 1}" style="width: 60px; margin: 0 8px;">
                                </span>
                                <span id="lunarYearlyGroup" style="display: none;">
                                    ${t("lunarMonth")}: 
                                    <select id="lunarMonth" class="b3-select" style="width: 100px; margin: 0 8px;">
                                        ${this.createLunarMonthSelector()}
                                    </select>
                                    ${t("lunarDay")}: 
                                    <input type="number" id="lunarDayYearly" class="b3-text-field" min="1" max="30" value="${this.repeatConfig.lunarDay || 1}" style="width: 60px; margin: 0 8px;">
                                </span>
                            </div>
                            <div class="b3-form__desc" style="margin-top: 8px;">
                                ${t("lunarDateDesc")}
                            </div>
                        </div>

                        <!-- 结束条件 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("repeatEnd")}</label>
                            <div class="repeat-end-options">
                                <label class="b3-radio">
                                    <input type="radio" name="endType" value="never" ${this.repeatConfig.endType === 'never' ? 'checked' : ''}>
                                    <span class="b3-radio__graphic"></span>
                                    <span class="b3-radio__label">${t("never")}</span>
                                </label>
                                <label class="b3-radio">
                                    <input type="radio" name="endType" value="date" ${this.repeatConfig.endType === 'date' ? 'checked' : ''}>
                                    <span class="b3-radio__graphic"></span>
                                    <span class="b3-radio__label">${t("endByDate")}</span>
                                </label>
                                <label class="b3-radio">
                                    <input type="radio" name="endType" value="count" ${this.repeatConfig.endType === 'count' ? 'checked' : ''}>
                                    <span class="b3-radio__graphic"></span>
                                    <span class="b3-radio__label">${t("endByCount")}</span>
                                </label>
                            </div>
                        </div>

                        <!-- 结束日期 -->
                        <div id="endDateGroup" class="b3-form__group" style="display: ${this.repeatConfig.endType === 'date' ? 'block' : 'none'}">
                            <label class="b3-form__label">${t("endDate")}</label>
                            <input type="date" id="endDate" class="b3-text-field" value="${this.repeatConfig.endDate || ''}" max="9999-12-31">
                        </div>

                        <!-- 结束次数 -->
                        <div id="endCountGroup" class="b3-form__group" style="display: ${this.repeatConfig.endType === 'count' ? 'block' : 'none'}">
                            <label class="b3-form__label">${t("endAfterCount")}</label>
                            <input type="number" id="endCount" class="b3-text-field" min="1" max="999" value="${this.repeatConfig.endCount || 10}" style="width: 80px;">
                            <span style="margin-left: 8px;">${t("times")}</span>
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="confirmBtn">${t("save")}</button>
                </div>
            </div>
        `;
    }

    private createWeekdaySelector(): string {
        const weekdays = [
            { value: 0, label: t("sunday"), short: t("sun") },
            { value: 1, label: t("monday"), short: t("mon") },
            { value: 2, label: t("tuesday"), short: t("tue") },
            { value: 3, label: t("wednesday"), short: t("wed") },
            { value: 4, label: t("thursday"), short: t("thu") },
            { value: 5, label: t("friday"), short: t("fri") },
            { value: 6, label: t("saturday"), short: t("sat") }
        ];

        return weekdays.map(day => `
            <label class="weekday-option b3-checkbox">
                <input type="checkbox" value="${day.value}" ${(this.repeatConfig.weekDays || []).includes(day.value) ? 'checked' : ''}>
                <span class="b3-checkbox__graphic"></span>
                <span class="b3-checkbox__label">${day.short}</span>
            </label>
        `).join('');
    }

    private createMonthdaySelector(): string {
        let html = '<div class="monthday-grid">';
        for (let i = 1; i <= 31; i++) {
            const checked = (this.repeatConfig.monthDays || []).includes(i) ? 'checked' : '';
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
            t("january"), t("february"), t("march"), t("april"),
            t("may"), t("june"), t("july"), t("august"),
            t("september"), t("october"), t("november"), t("december")
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
            t("lunarMonth1"), t("lunarMonth2"), t("lunarMonth3"), t("lunarMonth4"),
            t("lunarMonth5"), t("lunarMonth6"), t("lunarMonth7"), t("lunarMonth8"),
            t("lunarMonth9"), t("lunarMonth10"), t("lunarMonth11"), t("lunarMonth12")
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
    }

    private updateUI() {
        const repeatOptions = this.dialog.element.querySelector('#repeatOptions') as HTMLElement;
        const intervalGroup = this.dialog.element.querySelector('#intervalGroup') as HTMLElement;
        const customOptions = this.dialog.element.querySelector('#customOptions') as HTMLElement;
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

        if (this.repeatConfig.enabled) {
            // 更新间隔单位
            intervalUnit.textContent = this.getIntervalUnit();

            // 显示/隐藏相关选项
            const showInterval = this.repeatConfig.type !== 'ebbinghaus' && this.repeatConfig.type !== 'custom' &&
                this.repeatConfig.type !== 'lunar-monthly' && this.repeatConfig.type !== 'lunar-yearly';
            intervalGroup.style.display = showInterval ? 'block' : 'none';

            const showCustom = this.repeatConfig.type === 'custom';
            customOptions.style.display = showCustom ? 'block' : 'none';

            if (showCustom) {
                weeklyOptions.style.display = 'block';
                monthlyOptions.style.display = 'block';
                yearlyOptions.style.display = 'block';
            } else {
                weeklyOptions.style.display = 'none';
                monthlyOptions.style.display = 'none';
                yearlyOptions.style.display = 'none';
            }

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

    private getIntervalUnit(): string {
        switch (this.repeatConfig.type) {
            case 'daily':
                return this.repeatConfig.interval === 1 ? t("day") : t("days");
            case 'weekly':
                return this.repeatConfig.interval === 1 ? t("week") : t("weeks");
            case 'monthly':
                return this.repeatConfig.interval === 1 ? t("month") : t("months");
            case 'yearly':
                return this.repeatConfig.interval === 1 ? t("year") : t("years");
            default:
                return t("day");
        }
    }

    private saveSettings() {
        // 验证设置
        if (this.repeatConfig.enabled) {
            const intervalInput = this.dialog.element.querySelector('#repeatInterval') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#endDate') as HTMLInputElement;
            const endCountInput = this.dialog.element.querySelector('#endCount') as HTMLInputElement;

            this.repeatConfig.interval = parseInt(intervalInput.value) || 1;

            if (this.repeatConfig.type === 'custom') {
                // 收集自定义选项
                const weekDayInputs = this.dialog.element.querySelectorAll('#weeklyOptions input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                this.repeatConfig.weekDays = Array.from(weekDayInputs).map(input => parseInt(input.value));

                const monthDayInputs = this.dialog.element.querySelectorAll('#monthlyOptions input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                this.repeatConfig.monthDays = Array.from(monthDayInputs).map(input => parseInt(input.value));

                const monthInputs = this.dialog.element.querySelectorAll('#yearlyOptions input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                this.repeatConfig.months = Array.from(monthInputs).map(input => parseInt(input.value));
            }

            if (this.repeatConfig.type === 'ebbinghaus') {
                this.repeatConfig.ebbinghausPattern = [1, 2, 4, 7, 15]; // 默认艾宾浩斯曲线
            }

            if (this.repeatConfig.type === 'lunar-monthly') {
                const lunarDayInput = this.dialog.element.querySelector('#lunarDay') as HTMLInputElement;
                this.repeatConfig.lunarDay = parseInt(lunarDayInput.value) || 1;
                if (this.repeatConfig.lunarDay < 1 || this.repeatConfig.lunarDay > 30) {
                    showMessage(t("invalidLunarDay"));
                    return;
                }
            }

            if (this.repeatConfig.type === 'lunar-yearly') {
                const lunarMonthInput = this.dialog.element.querySelector('#lunarMonth') as HTMLSelectElement;
                const lunarDayYearlyInput = this.dialog.element.querySelector('#lunarDayYearly') as HTMLInputElement;
                this.repeatConfig.lunarMonth = parseInt(lunarMonthInput.value) || 1;
                this.repeatConfig.lunarDay = parseInt(lunarDayYearlyInput.value) || 1;
                if (this.repeatConfig.lunarDay < 1 || this.repeatConfig.lunarDay > 30) {
                    showMessage(t("invalidLunarDay"));
                    return;
                }
            }

            if (this.repeatConfig.endType === 'date') {
                this.repeatConfig.endDate = endDateInput.value;
                if (!this.repeatConfig.endDate) {
                    showMessage(t("pleaseSelectEndDate"));
                    return;
                }
            } else if (this.repeatConfig.endType === 'count') {
                this.repeatConfig.endCount = parseInt(endCountInput.value) || 10;
            }
        }

        if (this.onSaved) {
            this.onSaved(this.repeatConfig);
        }

        this.dialog.destroy();
    }
}
