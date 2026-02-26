import { Dialog, showMessage } from "siyuan";
import { i18n } from "../pluginInstance";
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
            title: i18n("repeatSettings"),
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
                            <span class="b3-checkbox__label">${i18n("enableRepeat")}</span>
                        </label>
                    </div>

                    <div id="repeatOptions" class="repeat-options" style="display: ${this.repeatConfig.enabled ? 'block' : 'none'}">
                        <!-- 重复类型选择 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("repeatType")}</label>
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
                            <label class="b3-form__label">${i18n("repeatInterval")}</label>
                            <div class="repeat-interval-container">
                                <span>${i18n("every")}</span>
                                <input type="number" id="repeatInterval" class="b3-text-field" min="1" max="99" value="${this.repeatConfig.interval || 1}" style="width: 60px; margin: 0 8px;">
                                <span id="intervalUnit">${this.getIntervalUnit()}</span>
                            </div>
                        </div>

                        <!-- 每周选项（星期选择） -->
                        <div id="weeklyOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label">${i18n("repeatOnDays")}</label>
                            <div class="weekday-selector">
                                ${this.createWeekdaySelector()}
                            </div>
                        </div>

                        <!-- 每月选项（日期选择） -->
                        <div id="monthlyOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label">${i18n("repeatOnDates")}</label>
                            <div class="monthday-selector">
                                ${this.createMonthdaySelector()}
                            </div>
                        </div>

                        <!-- 每年选项（日期输入框 MM-DD） -->
                        <div id="yearlyOptions" class="b3-form__group" style="display: none;">
                            <label class="b3-form__label">${i18n("repeatDate")}</label>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="text" id="yearlyDateInput" class="b3-text-field" placeholder="例如: 01-01 或 06-15" style="width: 120px;" value="${this.getYearlyDateValue()}">
                                <span style="font-size: 12px; color: var(--b3-theme-on-surface-light);">${i18n("dateFormatDesc")}</span>
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
                            <label class="b3-form__label">${i18n("lunarDate")}</label>
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
                            <div class="b3-form__desc" style="margin-top: 8px;">
                                ${i18n("lunarDateDesc")}
                            </div>
                        </div>

                        <!-- 结束条件 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("repeatEnd")}</label>
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
                        </div>

                        <!-- 结束日期 -->
                        <div id="endDateGroup" class="b3-form__group" style="display: ${this.repeatConfig.endType === 'date' ? 'block' : 'none'}">
                            <label class="b3-form__label">${i18n("endDate")}</label>
                            <input type="date" id="endDate" class="b3-text-field" value="${this.repeatConfig.endDate || ''}" max="9999-12-31">
                        </div>

                        <!-- 结束次数 -->
                        <div id="endCountGroup" class="b3-form__group" style="display: ${this.repeatConfig.endType === 'count' ? 'block' : 'none'}">
                            <label class="b3-form__label">${i18n("endAfterCount")}</label>
                            <input type="number" id="endCount" class="b3-text-field" min="1" max="999" value="${this.repeatConfig.endCount || 10}" style="width: 80px;">
                            <span style="margin-left: 8px;">${i18n("times")}</span>
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${i18n("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="confirmBtn">${i18n("save")}</button>
                </div>
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
            { value: 0, label: i18n("sunday"), short: i18n("sun") },
            { value: 1, label: i18n("monday"), short: i18n("mon") },
            { value: 2, label: i18n("tuesday"), short: i18n("tue") },
            { value: 3, label: i18n("wednesday"), short: i18n("wed") },
            { value: 4, label: i18n("thursday"), short: i18n("thu") },
            { value: 5, label: i18n("friday"), short: i18n("fri") },
            { value: 6, label: i18n("saturday"), short: i18n("sat") }
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
    }

    private updateUI() {
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

        if (this.repeatConfig.enabled) {
            // 更新间隔单位
            intervalUnit.textContent = this.getIntervalUnit();

            // 显示/隐藏相关选项
            // 显示间隔输入：对大多数类型可用，排除艾宾浩斯和农历专用类型及按月/按年特殊输入
            // 保留对每周类型的间隔支持，以实现“每隔 X 周”的配置
            const showInterval = this.repeatConfig.type !== 'ebbinghaus' &&
                this.repeatConfig.type !== 'lunar-monthly' && this.repeatConfig.type !== 'lunar-yearly' &&
                this.repeatConfig.type !== 'monthly' && this.repeatConfig.type !== 'yearly';
            intervalGroup.style.display = showInterval ? 'block' : 'none';

            // 每周重复：显示星期选择器
            weeklyOptions.style.display = this.repeatConfig.type === 'weekly' ? 'block' : 'none';

            // 每月重复：显示日期选择器
            monthlyOptions.style.display = this.repeatConfig.type === 'monthly' ? 'block' : 'none';

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

            this.repeatConfig.interval = parseInt(intervalInput.value) || 1;

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
                // 收集日期选项
                const monthDayInputs = this.dialog.element.querySelectorAll('#monthlyOptions input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                this.repeatConfig.monthDays = Array.from(monthDayInputs).map(input => parseInt(input.value));
                if (this.repeatConfig.monthDays.length === 0) {
                    showMessage(i18n("pleaseSelectAtLeastOneDay"), 3000, 'error');
                    return;
                }
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
        }

        if (this.onSaved) {
            this.onSaved(this.repeatConfig);
        }

        this.dialog.destroy();
    }
}
