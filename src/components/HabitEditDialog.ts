import { Dialog, showMessage, platformUtils, openEmoji } from "siyuan";
import { getBlockByID, getBlockDOM } from "../api";
import { Habit } from "./HabitPanel";
import { getLocalDateTimeString, getLogicalDateString } from "../utils/dateUtils";
import { HabitGroupManager } from "../utils/habitGroupManager";
import { i18n } from "../pluginInstance";
import { HabitCheckInEmojiDialog } from "./HabitCheckInEmojiDialog";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { PomodoroSessionsDialog } from "./PomodoroSessionsDialog";

export class HabitEditDialog {
    private dialog: Dialog;
    private habit: Habit | null;
    private onSave: (habit: Habit) => Promise<void>;
    private plugin?: any;
    private pomodoroRecordManager?: PomodoroRecordManager;

    constructor(habit: Habit | null, onSave: (habit: Habit) => Promise<void>, plugin?: any) {
        this.habit = habit;
        this.onSave = onSave;
        this.plugin = plugin;
        if (this.plugin) {
            this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin);
        }
    }

    show() {
        const isNew = !this.habit;
        const title = isNew ? i18n("newHabitTitle") : i18n("editHabitTitle");

        this.dialog = new Dialog({
            title,
            content: '<div id="habitEditContainer"></div>',
            width: "600px",
            height: "700px"
        });

        const container = this.dialog.element.querySelector('#habitEditContainer') as HTMLElement;
        if (!container) return;

        // Ensure the container has two children: content and action areas.
        // contentDiv will hold the scrollable form content, actionDiv will hold the action buttons.
        let contentDiv = container.querySelector('.b3-dialog__content') as HTMLElement;
        let actionDiv = container.querySelector('.b3-dialog__action') as HTMLElement;
        if (!contentDiv) {
            contentDiv = document.createElement('div');
            contentDiv.className = 'b3-dialog__content';
            container.appendChild(contentDiv);
        }
        if (!actionDiv) {
            actionDiv = document.createElement('div');
            actionDiv.className = 'b3-dialog__action';
            container.appendChild(actionDiv);
        }

        // delegate the rendering of the form inside the contentDiv and the action area
        this.renderForm(contentDiv, isNew, actionDiv);
    }

    private renderForm(container: HTMLElement, isNew: boolean, actionContainer?: HTMLElement) {
        // the container here is the content area
        container.style.cssText = 'padding: 20px; overflow-y: auto; height: calc(100% - 56px);';
        // 设置class
        container.className = 'b3-dialog__content';
        const form = document.createElement('form');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';
        let draftCheckInEmojis = JSON.parse(JSON.stringify(this.habit?.checkInEmojis || this.getDefaultCheckInEmojis()));
        let draftHideCheckedToday = !!this.habit?.hideCheckedToday;

        // 习惯标题 + 图标
        const titleGroup = this.createFormGroup(i18n("habitTitleLabel"), 'text', 'title', this.habit?.title || '');
        const titleInput = titleGroup.querySelector('input[name="title"]') as HTMLInputElement | null;
        if (titleInput) {
            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

            const iconBtn = document.createElement('button');
            iconBtn.type = 'button';
            iconBtn.className = 'b3-button b3-button--outline';
            iconBtn.style.cssText = `
                width: 40px;
                min-width: 40px;
                height: 40px;
                padding: 0;
                border-radius: 50%;
                font-size: 20px;
                line-height: 1;
                display:flex;
                align-items:center;
                justify-content:center;
            `;
            iconBtn.textContent = this.habit?.icon || '🌱';
            iconBtn.title = '点击选择图标';
            iconBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openBuiltInEmojiPicker(iconBtn);
            });

            const iconInput = document.createElement('input');
            iconInput.type = 'hidden';
            iconInput.name = 'icon';
            iconInput.value = iconBtn.textContent || '🌱';

            titleInput.style.flex = '1';
            titleInput.style.minWidth = '0';

            titleRow.appendChild(iconBtn);
            titleRow.appendChild(titleInput);
            titleGroup.appendChild(iconInput);
            titleGroup.appendChild(titleRow);
        }
        form.appendChild(titleGroup);

        // 习惯颜色
        const colorGroup = document.createElement('div');
        colorGroup.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
        const colorLabel = document.createElement('label');
        colorLabel.textContent = i18n("habitColorLabel") || '习惯颜色';
        colorLabel.style.cssText = 'font-weight: bold; font-size: 14px;';
        const colorRow = document.createElement('div');
        colorRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const initialColor = this.habit?.color || this.generateRandomHabitColor();
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.name = 'color';
        colorInput.value = initialColor;
        colorInput.className = 'b3-text-field';
        colorInput.style.cssText = 'width: 64px; height: 36px; padding: 2px 4px;';

        const randomColorBtn = document.createElement('button');
        randomColorBtn.type = 'button';
        randomColorBtn.className = 'b3-button b3-button--outline';
        randomColorBtn.textContent = i18n("randomColor") || '随机颜色';
        randomColorBtn.addEventListener('click', () => {
            colorInput.value = this.generateRandomHabitColor();
        });

        colorRow.appendChild(colorInput);
        colorRow.appendChild(randomColorBtn);
        colorGroup.appendChild(colorLabel);
        colorGroup.appendChild(colorRow);
        form.appendChild(colorGroup);

        // 打卡目标设置（按次数/按番茄）
        const goalGroup = document.createElement('div');
        goalGroup.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        const goalLabel = document.createElement('label');
        goalLabel.textContent = i18n("habitTargetLabel");
        goalLabel.style.cssText = 'font-weight: bold; font-size: 14px;';
        goalGroup.appendChild(goalLabel);

        const goalTypeSelect = document.createElement('select');
        goalTypeSelect.name = 'goalType';
        goalTypeSelect.className = 'b3-select';
        goalTypeSelect.innerHTML = `
            <option value="count">按打卡次数</option>
            <option value="pomodoro">按番茄时长</option>
        `;
        const initialGoalType: 'count' | 'pomodoro' = this.habit?.goalType === 'pomodoro' ? 'pomodoro' : 'count';
        goalTypeSelect.value = initialGoalType;
        goalGroup.appendChild(goalTypeSelect);

        const countTargetWrap = document.createElement('div');
        countTargetWrap.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        const countTargetInput = document.createElement('input');
        countTargetInput.type = 'number';
        countTargetInput.min = '1';
        countTargetInput.name = 'target';
        countTargetInput.className = 'b3-text-field';
        countTargetInput.style.cssText = 'width: 120px;';
        countTargetInput.value = String(Math.max(1, this.habit?.target || 1));
        const countTargetSuffix = document.createElement('span');
        countTargetSuffix.textContent = '次';
        countTargetWrap.appendChild(countTargetInput);
        countTargetWrap.appendChild(countTargetSuffix);
        goalGroup.appendChild(countTargetWrap);

        const pomodoroWrap = document.createElement('div');
        pomodoroWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        const pomodoroDurationRow = document.createElement('div');
        pomodoroDurationRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';
        const defaultPomodoroTargetMinutes = this.habit?.goalType === 'pomodoro'
            ? Math.max(1, this.habit?.target || 30)
            : 30;
        const defaultPomodoroHours = Math.floor(defaultPomodoroTargetMinutes / 60);
        const defaultPomodoroMinutes = defaultPomodoroTargetMinutes % 60;

        const pomodoroHoursInput = document.createElement('input');
        pomodoroHoursInput.type = 'number';
        pomodoroHoursInput.min = '0';
        pomodoroHoursInput.name = 'pomodoroTargetHours';
        pomodoroHoursInput.className = 'b3-text-field';
        pomodoroHoursInput.style.cssText = 'width: 96px;';
        pomodoroHoursInput.value = String(Math.max(0, this.habit?.pomodoroTargetHours ?? defaultPomodoroHours));

        const pomodoroHoursLabel = document.createElement('span');
        pomodoroHoursLabel.textContent = 'h';

        const pomodoroMinutesInput = document.createElement('input');
        pomodoroMinutesInput.type = 'number';
        pomodoroMinutesInput.min = '0';
        pomodoroMinutesInput.max = '59';
        pomodoroMinutesInput.name = 'pomodoroTargetMinutes';
        pomodoroMinutesInput.className = 'b3-text-field';
        pomodoroMinutesInput.style.cssText = 'width: 96px;';
        pomodoroMinutesInput.value = String(Math.max(0, this.habit?.pomodoroTargetMinutes ?? defaultPomodoroMinutes));

        const pomodoroMinutesLabel = document.createElement('span');
        pomodoroMinutesLabel.textContent = 'm';

        pomodoroDurationRow.appendChild(pomodoroHoursInput);
        pomodoroDurationRow.appendChild(pomodoroHoursLabel);
        pomodoroDurationRow.appendChild(pomodoroMinutesInput);
        pomodoroDurationRow.appendChild(pomodoroMinutesLabel);
        pomodoroWrap.appendChild(pomodoroDurationRow);

        const autoCheckInRow = document.createElement('div');
        autoCheckInRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

        const autoCheckInLabel = document.createElement('label');
        autoCheckInLabel.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer;';
        const autoCheckInCheckbox = document.createElement('input');
        autoCheckInCheckbox.type = 'checkbox';
        autoCheckInCheckbox.name = 'autoCheckInAfterPomodoro';
        autoCheckInCheckbox.checked = !!this.habit?.autoCheckInAfterPomodoro;
        const autoCheckInText = document.createElement('span');
        autoCheckInText.textContent = '番茄完成后自动打卡';
        autoCheckInLabel.appendChild(autoCheckInCheckbox);
        autoCheckInLabel.appendChild(autoCheckInText);

        const autoCheckInEmojiSelect = document.createElement('select');
        autoCheckInEmojiSelect.name = 'autoCheckInEmoji';
        autoCheckInEmojiSelect.className = 'b3-select';
        autoCheckInEmojiSelect.style.cssText = 'min-width: 180px;';

        const refreshAutoCheckInEmojiOptions = () => {
            const previousValue = autoCheckInEmojiSelect.value || this.habit?.autoCheckInEmoji || '';
            autoCheckInEmojiSelect.innerHTML = '';
            const emojiList = draftCheckInEmojis && draftCheckInEmojis.length > 0
                ? draftCheckInEmojis
                : this.getDefaultCheckInEmojis();

            emojiList.forEach((emojiItem: any, index: number) => {
                const option = document.createElement('option');
                option.value = emojiItem.emoji;
                option.textContent = `${emojiItem.emoji} ${emojiItem.meaning || ''}`.trim();
                if ((previousValue && previousValue === emojiItem.emoji) || (!previousValue && index === 0)) {
                    option.selected = true;
                }
                autoCheckInEmojiSelect.appendChild(option);
            });
        };
        refreshAutoCheckInEmojiOptions();

        autoCheckInRow.appendChild(autoCheckInLabel);
        autoCheckInRow.appendChild(autoCheckInEmojiSelect);
        pomodoroWrap.appendChild(autoCheckInRow);
        goalGroup.appendChild(pomodoroWrap);
        form.appendChild(goalGroup);

        const updateGoalTypeUI = () => {
            const isPomodoroGoal = goalTypeSelect.value === 'pomodoro';
            countTargetWrap.style.display = isPomodoroGoal ? 'none' : 'flex';
            pomodoroWrap.style.display = isPomodoroGoal ? 'flex' : 'none';
        };
        updateGoalTypeUI();
        goalTypeSelect.addEventListener('change', updateGoalTypeUI);

        // 频率选择
        const frequencyGroup = this.createFrequencyGroup();
        form.appendChild(frequencyGroup);

        // 开始日期
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        const startDateGroup = this.createFormGroup(i18n("habitStartDateLabel"), 'date', 'startDate', this.habit?.startDate || today);
        form.appendChild(startDateGroup);

        // 结束日期
        const endDateGroup = this.createFormGroup(i18n("habitEndDateLabel"), 'date', 'endDate', this.habit?.endDate || '');
        form.appendChild(endDateGroup);

        // 提醒时间（支持多个）
        const reminderGroup = document.createElement('div');
        reminderGroup.style.cssText = 'display:flex; flex-direction: column; gap:4px;';
        const reminderLabel = document.createElement('label');
        reminderLabel.textContent = i18n("habitReminderLabel");
        reminderLabel.style.cssText = 'font-weight: bold; font-size: 14px;';
        reminderGroup.appendChild(reminderLabel);

        // container for dynamic time inputs
        const reminderTimesContainer = document.createElement('div');
        reminderTimesContainer.id = 'habitReminderTimesContainer';
        reminderTimesContainer.style.cssText = 'display:flex; flex-direction: column; gap:8px;';

        const addTimeBtn = document.createElement('button');
        addTimeBtn.type = 'button';
        addTimeBtn.className = 'b3-button b3-button--outline';
        addTimeBtn.textContent = i18n("habitAddReminderTime");
        addTimeBtn.style.cssText = 'align-self:flex-start;';

        const addTimeInput = (timeVal: string | { time: string; note?: string } = '') => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; gap:8px; align-items:center;';

            const timeStr = typeof timeVal === 'string' ? timeVal : timeVal.time;
            const noteStr = typeof timeVal === 'object' ? timeVal.note || '' : '';

            const input = document.createElement('input');
            input.type = 'time';
            input.name = 'reminderTimeValue';
            input.className = 'b3-text-field';
            input.value = timeStr;
            input.style.cssText = 'width: 120px;';

            const noteInput = document.createElement('input');
            noteInput.type = 'text';
            noteInput.name = 'reminderTimeNote';
            noteInput.className = 'b3-text-field';
            noteInput.placeholder = i18n("reminderNoteHint");
            noteInput.value = noteStr;
            noteInput.style.cssText = 'flex: 1; min-width: 100px;';
            noteInput.spellcheck = false;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'b3-button b3-button--outline';
            removeBtn.textContent = i18n("removeReminderTime");
            removeBtn.addEventListener('click', () => {
                row.remove();
            });

            row.appendChild(input);
            row.appendChild(noteInput);
            row.appendChild(removeBtn);
            reminderTimesContainer.appendChild(row);
        };

        // initialize existing times
        if (this.habit?.reminderTimes && Array.isArray(this.habit.reminderTimes) && this.habit.reminderTimes.length > 0) {
            this.habit.reminderTimes.forEach((t) => addTimeInput(t));
        } else if (this.habit?.reminderTime) {
            addTimeInput(this.habit.reminderTime);
        }

        addTimeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addTimeInput('');
        });

        reminderGroup.appendChild(reminderTimesContainer);
        reminderGroup.appendChild(addTimeBtn);
        form.appendChild(reminderGroup);

        // 分组选择
        const groupSelect = this.createGroupSelect();
        form.appendChild(groupSelect);

        // 绑定块输入（可选）
        const blockGroup = document.createElement('div');
        blockGroup.style.cssText = 'display:flex; flex-direction: column; gap:4px;';

        const blockLabel = document.createElement('label');
        blockLabel.textContent = i18n("habitBlockLabel");
        blockLabel.style.cssText = 'font-weight: bold; font-size: 14px;';

        const blockInputRow = document.createElement('div');
        blockInputRow.style.cssText = 'display:flex; gap:8px; align-items:center;';

        const blockInput = document.createElement('input');
        blockInput.type = 'text';
        blockInput.name = 'blockId';
        blockInput.id = 'habitBlockInput';
        blockInput.className = 'b3-text-field';
        blockInput.placeholder = '块或文档 ID（例如：(()) 或 siyuan://blocks/ID）';
        blockInput.value = this.habit?.blockId || '';
        blockInput.style.cssText = 'flex: 1;';
        blockInput.spellcheck = false;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'b3-button b3-button--outline';
        copyBtn.title = i18n("copyBlockRef");
        copyBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'b3-button b3-button--outline';
        clearBtn.title = i18n("clearBlock");
        clearBtn.textContent = i18n("clearBlock");

        blockInputRow.appendChild(blockInput);
        blockInputRow.appendChild(copyBtn);
        blockInputRow.appendChild(clearBtn);

        const blockPreview = document.createElement('div');
        blockPreview.id = 'habitBlockPreview';
        blockPreview.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); padding-top:6px;';

        blockGroup.appendChild(blockLabel);
        blockGroup.appendChild(blockInputRow);
        blockGroup.appendChild(blockPreview);
        form.appendChild(blockGroup);

        // initial preview if editing and block exists
        if (blockInput.value) {
            this.updatePreviewForBlock(blockInput.value, blockPreview).catch(err => console.warn('初始化块预览失败', err));
        }

        // 按钮
        // 创建按钮组，不再作为表单内部直接的子元素；它将被放在 actionContainer（dialog action）中
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = 'display: flex; gap: 8px; row-gap: 8px; align-items: center; justify-content: space-between; width: 100%; margin-top: 16px; flex-wrap: wrap;';

        const editCheckInBtn = document.createElement('button');
        editCheckInBtn.type = 'button';
        editCheckInBtn.className = 'b3-button b3-button--outline';
        editCheckInBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>${i18n("editCheckInOptions")}`;
        editCheckInBtn.addEventListener('click', () => {
            const titleInput = form.querySelector('input[name="title"]') as HTMLInputElement | null;
            const goalType = ((form.querySelector('select[name="goalType"]') as HTMLSelectElement | null)?.value === 'pomodoro') ? 'pomodoro' : 'count';
            const targetValue = parseInt((form.querySelector('input[name="target"]') as HTMLInputElement | null)?.value || '1') || 1;
            const pomodoroHours = Math.max(0, parseInt((form.querySelector('input[name="pomodoroTargetHours"]') as HTMLInputElement | null)?.value || '0') || 0);
            const pomodoroMinutes = Math.max(0, parseInt((form.querySelector('input[name="pomodoroTargetMinutes"]') as HTMLInputElement | null)?.value || '0') || 0);
            const pomodoroTargetTotal = Math.max(1, pomodoroHours * 60 + pomodoroMinutes);
            const tempHabit: Habit = {
                id: this.habit?.id || `habit-temp-${Date.now()}`,
                icon: (form.querySelector('input[name="icon"]') as HTMLInputElement | null)?.value || this.habit?.icon || '🌱',
                color: (form.querySelector('input[name="color"]') as HTMLInputElement | null)?.value || this.habit?.color || this.generateRandomHabitColor(),
                title: titleInput?.value?.trim() || this.habit?.title || i18n("newHabitTitle"),
                target: goalType === 'pomodoro' ? pomodoroTargetTotal : targetValue,
                goalType,
                pomodoroTargetHours: pomodoroHours,
                pomodoroTargetMinutes: pomodoroMinutes,
                autoCheckInAfterPomodoro: !!(form.querySelector('input[name="autoCheckInAfterPomodoro"]') as HTMLInputElement | null)?.checked,
                autoCheckInEmoji: (form.querySelector('select[name="autoCheckInEmoji"]') as HTMLSelectElement | null)?.value || undefined,
                frequency: this.habit?.frequency || { type: 'daily', interval: 1 },
                startDate: (form.querySelector('input[name="startDate"]') as HTMLInputElement | null)?.value || getLogicalDateString(),
                endDate: (form.querySelector('input[name="endDate"]') as HTMLInputElement | null)?.value || undefined,
                reminderTime: this.habit?.reminderTime,
                reminderTimes: this.habit?.reminderTimes || [],
                groupId: this.habit?.groupId,
                priority: this.habit?.priority || 'none',
                checkInEmojis: JSON.parse(JSON.stringify(draftCheckInEmojis)),
                checkIns: this.habit?.checkIns || {},
                totalCheckIns: this.habit?.totalCheckIns || 0,
                createdAt: this.habit?.createdAt || getLocalDateTimeString(new Date()),
                updatedAt: getLocalDateTimeString(new Date()),
                blockId: this.habit?.blockId,
                hideCheckedToday: draftHideCheckedToday
            };
            const dialog = new HabitCheckInEmojiDialog(tempHabit, async (emojis) => {
                draftCheckInEmojis = JSON.parse(JSON.stringify(emojis));
                draftHideCheckedToday = !!tempHabit.hideCheckedToday;
                refreshAutoCheckInEmojiOptions();
            });
            dialog.show();
        });

        const viewPomodorosBtn = document.createElement('button');
        viewPomodorosBtn.type = 'button';
        viewPomodorosBtn.className = 'b3-button b3-button--outline';
        viewPomodorosBtn.style.cssText = 'min-width: 0; max-width: 100%;';
        viewPomodorosBtn.innerHTML = `<span id="habitPomodorosCountText" style="display:inline-block; min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${i18n("viewPomodoros")}</span>`;
        viewPomodorosBtn.addEventListener('click', async () => {
            if (!this.habit?.id || !this.plugin) {
                showMessage(i18n("saveBeforeViewPomodoros") || "请先保存习惯后再查看番茄钟", 3000, 'error');
                return;
            }

            const pomodorosDialog = new PomodoroSessionsDialog(this.habit.id, this.plugin, async () => {
                await this.updateHabitPomodorosDisplay();
            });
            await pomodorosDialog.show();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'b3-button';
        cancelBtn.textContent = i18n("cancel");
        cancelBtn.addEventListener('click', () => this.dialog.destroy());

        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'b3-button b3-button--primary';
        saveBtn.textContent = i18n("save");

        const rightButtons = document.createElement('div');
        rightButtons.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: auto;';
        rightButtons.appendChild(cancelBtn);
        rightButtons.appendChild(saveBtn);

        const leftButtons = document.createElement('div');
        leftButtons.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; flex: 1 1 260px;';
        leftButtons.appendChild(editCheckInBtn);
        leftButtons.appendChild(viewPomodorosBtn);

        buttonGroup.appendChild(leftButtons);
        buttonGroup.appendChild(rightButtons);

        // Don't append buttonGroup to the form. It'll be appended to the actionContainer (sibling)

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit(form, isNew, draftCheckInEmojis, draftHideCheckedToday);
        });

        // 绑定块按钮事件
        copyBtn.addEventListener('click', async () => {
            try {
                const raw = blockInput.value?.trim();
                const blockId = raw ? (this.extractBlockId(raw) || raw) : '';
                if (!blockId) {
                    showMessage(i18n("noBlockToCopy"), 3000, 'error');
                    return;
                }
                let copiedText = `((${blockId}))`;
                try {
                    const block = await getBlockByID(blockId);
                    const blockTitle = ((block?.content || block?.fcontent || '') as string).replace(/\s+/g, ' ').trim();
                    if (blockTitle) {
                        copiedText = `((${blockId} '${blockTitle.replace(/'/g, "\\'")}'))`;
                    }
                } catch (innerError) {
                    console.warn('构造块引用文案失败，使用纯块引用格式', innerError);
                }
                await platformUtils.writeText(copiedText);
                showMessage(i18n("copiedBlockRef") || i18n("copySuccess"));
            } catch (error) {
                console.error('复制块引用失败:', error);
                showMessage(i18n("copyFailed"), 3000, 'error');
            }
        });


        // 清除绑定
        clearBtn.addEventListener('click', () => {
            blockInput.value = '';
            blockPreview.textContent = '';
        });

        // 输入更改时更新预览（简单实现）并尝试自动将引用格式规范化为纯 id
        let isAutoSettingInput = false;
        blockInput.addEventListener('input', async () => {
            const raw = blockInput.value?.trim();
            if (!raw) {
                blockPreview.textContent = '';
                return;
            }
            const id = this.extractBlockId(raw);
            if (!id) {
                blockPreview.textContent = '';
                return;
            }
            // 如果文本是引用或链接格式，则规范化为纯 id，以便保存时不会保存冗余内容
            if (!isAutoSettingInput && raw !== id && (raw.includes("((") || raw.includes('siyuan://blocks/') || raw.includes(']('))) {
                try {
                    isAutoSettingInput = true;
                    blockInput.value = id;
                } finally {
                    // 使用 setTimeout 以避免阻塞和循环触发
                    setTimeout(() => { isAutoSettingInput = false; }, 0);
                }
            }
            await this.updatePreviewForBlock(id, blockPreview);
        });

        container.appendChild(form);

        // insert the action container area and fill with buttons
        if (actionContainer) {
            // ensure actionContainer has proper padding/separation
            actionContainer.style.cssText = 'display:flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; padding: 12px 20px; border-top: 1px solid rgba(0,0,0,0.04);';
            // append buttons to actionContainer and keep buttonGroup as wrapper
            actionContainer.appendChild(buttonGroup);
        }

        // If save is outside the form, trigger submit programmatically
        saveBtn.addEventListener('click', () => {
            // prefer modern API requestSubmit
            if ((form as any).requestSubmit) {
                (form as any).requestSubmit();
            } else {
                // fallback
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        });

        this.updateHabitPomodorosDisplay();
    }

    private async updateHabitPomodorosDisplay() {
        const textEl = this.dialog?.element?.querySelector('#habitPomodorosCountText') as HTMLElement | null;
        if (!textEl) return;

        if (!this.habit?.id || !this.plugin || !this.pomodoroRecordManager) {
            textEl.textContent = i18n("viewPomodoros");
            return;
        }

        try {
            await this.pomodoroRecordManager.initialize();

            const count = this.pomodoroRecordManager.getEventTotalPomodoroCount(this.habit.id) || 0;
            const totalMinutes = this.pomodoroRecordManager.getEventTotalFocusTime(this.habit.id) || 0;
            const timeStr = totalMinutes > 0 ? ` (${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m)` : '';

            if (count > 0 || totalMinutes > 0) {
                textEl.textContent = `${i18n("viewPomodoros")} ${count}🍅${timeStr}`;
            } else {
                textEl.textContent = i18n("viewPomodoros");
            }
        } catch (error) {
            console.warn('更新习惯番茄钟统计失败:', error);
            textEl.textContent = i18n("viewPomodoros");
        }
    }

    private createFormGroup(label: string, type: string, name: string, value: string): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.style.cssText = 'font-weight: bold; font-size: 14px;';

        const input = document.createElement('input');
        input.type = type;
        input.name = name;
        input.value = value;
        input.className = 'b3-text-field';
        if (type === 'text') {
            input.spellcheck = false;
        }
        if (type === 'number') {
            input.min = '1';
        }

        group.appendChild(labelEl);
        group.appendChild(input);

        return group;
    }

    private createFrequencyGroup(): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        const label = document.createElement('label');
        label.textContent = i18n("frequencyTypeLabel");
        label.style.cssText = 'font-weight: bold; font-size: 14px;';

        const select = document.createElement('select');
        select.name = 'frequencyType';
        select.className = 'b3-select';
        select.innerHTML = `
            <option value="daily">${i18n("freqDaily")}</option>
            <option value="weekly">${i18n("freqWeekly")}</option>
            <option value="monthly">${i18n("freqMonthly")}</option>
            <option value="yearly">${i18n("freqYearly")}</option>
            <option value="ebbinghaus">${i18n("ebbinghaus")}</option>
        `;

        if (this.habit?.frequency) {
            select.value = this.habit.frequency.type;
        }

        // 辅助容器：显示间隔输入、周/日选择
        const helperContainer = document.createElement('div');
        helperContainer.style.cssText = 'display:flex; flex-direction: column; gap: 8px;';

        // 间隔输入（例如每x天、每x周、每x月）
        const intervalContainer = document.createElement('div');
        intervalContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const intervalLabel = document.createElement('label');
        intervalLabel.textContent = i18n("intervalLabel");
        intervalLabel.style.cssText = 'min-width: 48px;';

        const intervalInput = document.createElement('input');
        intervalInput.type = 'number';
        intervalInput.min = '1';
        intervalInput.name = 'interval';
        intervalInput.value = this.habit?.frequency?.interval ? String(this.habit.frequency.interval) : '1';
        intervalInput.className = 'b3-text-field';
        intervalInput.style.cssText = 'width: 80px;';

        const intervalSuffix = document.createElement('span');
        intervalSuffix.textContent = i18n("intervalSuffixDay");

        intervalContainer.appendChild(intervalLabel);
        intervalContainer.appendChild(intervalInput);
        intervalContainer.appendChild(intervalSuffix);

        // 星期选择器
        const weekdaysContainer = document.createElement('div');
        weekdaysContainer.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';
        weekdaysContainer.style.display = 'none';
        const weekdayNamesArr = i18n("weekdayNames").split(',');
        for (let i = 0; i < 7; i++) {
            const cbLabel = document.createElement('label');
            cbLabel.style.cssText = 'display:flex; align-items:center; gap:4px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.name = 'weekday';
            cb.value = String(i);
            cb.checked = this.habit?.frequency?.weekdays ? this.habit.frequency.weekdays.includes(i) : false;
            cbLabel.appendChild(cb);
            const span = document.createElement('span');
            span.textContent = `${i18n("week")}${weekdayNamesArr[i]}`;
            cbLabel.appendChild(span);
            weekdaysContainer.appendChild(cbLabel);
        }

        // 月日期选择器 1..31
        const monthDaysContainer = document.createElement('div');
        monthDaysContainer.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
        monthDaysContainer.style.display = 'none';
        for (let d = 1; d <= 31; d++) {
            const cbLabel = document.createElement('label');
            cbLabel.style.cssText = 'display:flex; align-items:center; gap:4px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.name = 'monthDay';
            cb.value = String(d);
            cb.checked = this.habit?.frequency?.monthDays ? this.habit.frequency.monthDays.includes(d) : false;
            cbLabel.appendChild(cb);
            const span = document.createElement('span');
            span.textContent = `${d}${i18n("habitDays")}`;
            cbLabel.appendChild(span);
            monthDaysContainer.appendChild(cbLabel);
        }

        // 每年日期选择器（月-日格式）
        const yearlyDateContainer = document.createElement('div');
        yearlyDateContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';
        yearlyDateContainer.style.display = 'none';

        const yearlyDateLabel = document.createElement('label');
        yearlyDateLabel.textContent = i18n("yearlyDateLabel");
        yearlyDateLabel.style.cssText = 'min-width: 48px;';

        const yearlyDateInput = document.createElement('input');
        yearlyDateInput.type = 'text';
        yearlyDateInput.name = 'yearlyDate';
        yearlyDateInput.className = 'b3-text-field';
        yearlyDateInput.placeholder = '例如: 01-01 或 06-15';
        yearlyDateInput.style.cssText = 'width: 120px;';

        // 恢复已有的每年日期
        if (this.habit?.frequency?.type === 'yearly' && this.habit.frequency.months && this.habit.frequency.monthDays) {
            const month = this.habit.frequency.months[0];
            const day = this.habit.frequency.monthDays[0];
            yearlyDateInput.value = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }

        const yearlyDateHint = document.createElement('span');
        yearlyDateHint.textContent = i18n("yearlyDateHint");
        yearlyDateHint.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light);';

        yearlyDateContainer.appendChild(yearlyDateLabel);
        yearlyDateContainer.appendChild(yearlyDateInput);
        yearlyDateContainer.appendChild(yearlyDateHint);

        helperContainer.appendChild(intervalContainer);
        helperContainer.appendChild(weekdaysContainer);
        helperContainer.appendChild(monthDaysContainer);
        helperContainer.appendChild(yearlyDateContainer);

        group.appendChild(label);
        group.appendChild(select);
        group.appendChild(helperContainer);

        // 事件：根据频率类型显示不同的选择项
        const updateHelperUI = () => {
            const type = select.value;
            if (type === 'daily') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = i18n("intervalSuffixDay");
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'none';
                yearlyDateContainer.style.display = 'none';
            } else if (type === 'weekly') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = i18n("intervalSuffixWeek");
                weekdaysContainer.style.display = 'flex';
                monthDaysContainer.style.display = 'none';
                yearlyDateContainer.style.display = 'none';
            } else if (type === 'monthly') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = i18n("intervalSuffixMonth");
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'flex';
                yearlyDateContainer.style.display = 'none';
            } else if (type === 'yearly') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = i18n("intervalSuffixYear");
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'none';
                yearlyDateContainer.style.display = 'flex';
            } else if (type === 'ebbinghaus') {
                intervalContainer.style.display = 'none';
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'none';
                yearlyDateContainer.style.display = 'none';
            }
        };

        // 初始化显示
        updateHelperUI();

        // 恢复已有习惯的 interval
        if (this.habit?.frequency?.interval) {
            intervalInput.value = String(this.habit.frequency.interval);
        }

        select.addEventListener('change', () => updateHelperUI());

        return group;
    }

    private createGroupSelect(): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

        const label = document.createElement('label');
        label.textContent = i18n("habitGroupLabel");
        label.style.cssText = 'font-weight: bold; font-size: 14px;';

        const select = document.createElement('select');
        select.name = 'groupId';
        select.className = 'b3-select';

        // Add "No Group" option
        const noGroupOption = document.createElement('option');
        noGroupOption.value = 'none';
        noGroupOption.textContent = i18n("noGroupOption");
        select.appendChild(noGroupOption);

        // Add existing groups
        const groups = HabitGroupManager.getInstance().getAllGroups();
        groups.forEach(g => {
            const option = document.createElement('option');
            option.value = g.id;
            option.textContent = g.name;
            select.appendChild(option);
        });

        if (this.habit?.groupId) {
            select.value = this.habit.groupId;
        }

        group.appendChild(label);
        group.appendChild(select);

        return group;
    }

    private async handleSubmit(form: HTMLFormElement, isNew: boolean, draftCheckInEmojis: any[], draftHideCheckedToday: boolean) {
        const formData = new FormData(form);

        const title = formData.get('title') as string;
        if (!title || title.trim() === '') {
            showMessage(i18n("habitInputRequired"), 3000, 'error');
            return;
        }
        const icon = ((formData.get('icon') as string) || this.habit?.icon || '🌱').trim() || '🌱';
        const colorRaw = ((formData.get('color') as string) || this.habit?.color || '').trim();
        const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : this.generateRandomHabitColor();

        const startDate = formData.get('startDate') as string;
        if (!startDate) {
            showMessage(i18n("startDateRequired"), 3000, 'error');
            return;
        }

        const now = getLocalDateTimeString(new Date());

        const frequencyType = formData.get('frequencyType') as any || 'daily';
        const intervalStr = formData.get('interval') as string;
        const interval = intervalStr ? parseInt(intervalStr) : undefined;

        // collect weekdays/monthDays from form
        const weekdays: number[] = [];
        const monthDays: number[] = [];
        const weekdayChecks = form.querySelectorAll('input[name="weekday"]') as NodeListOf<HTMLInputElement>;
        weekdayChecks.forEach(cb => { if (cb.checked) weekdays.push(parseInt(cb.value)); });
        const monthDayChecks = form.querySelectorAll('input[name="monthDay"]') as NodeListOf<HTMLInputElement>;
        monthDayChecks.forEach(cb => { if (cb.checked) monthDays.push(parseInt(cb.value)); });

        const rawBlockVal = (formData.get('blockId') as string) || undefined;
        const parsedBlockId = rawBlockVal ? (this.extractBlockId(rawBlockVal) || rawBlockVal) : undefined;
        const goalType = (formData.get('goalType') as string) === 'pomodoro' ? 'pomodoro' : 'count';
        const targetCount = Math.max(1, parseInt(formData.get('target') as string) || 1);
        const pomodoroTargetHours = Math.max(0, parseInt((formData.get('pomodoroTargetHours') as string) || '0') || 0);
        const pomodoroTargetMinutesRaw = Math.max(0, parseInt((formData.get('pomodoroTargetMinutes') as string) || '0') || 0);
        const pomodoroCarryHours = Math.floor(pomodoroTargetMinutesRaw / 60);
        const pomodoroTargetMinutes = pomodoroTargetMinutesRaw % 60;
        const normalizedPomodoroHours = pomodoroTargetHours + pomodoroCarryHours;
        const pomodoroTotalMinutes = normalizedPomodoroHours * 60 + pomodoroTargetMinutes;

        if (goalType === 'pomodoro' && pomodoroTotalMinutes <= 0) {
            showMessage('番茄目标时长需要大于 0 分钟', 3000, 'error');
            return;
        }

        const habit: Habit = {
            id: this.habit?.id || `habit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            icon,
            color,
            title: title.trim(),
            // note: (formData.get('note') as string)?.trim() || undefined, // 移除全局备注
            target: goalType === 'pomodoro' ? Math.max(1, pomodoroTotalMinutes) : targetCount,
            goalType,
            pomodoroTargetHours: goalType === 'pomodoro' ? normalizedPomodoroHours : undefined,
            pomodoroTargetMinutes: goalType === 'pomodoro' ? pomodoroTargetMinutes : undefined,
            autoCheckInAfterPomodoro: goalType === 'pomodoro' ? formData.get('autoCheckInAfterPomodoro') === 'on' : false,
            autoCheckInEmoji: goalType === 'pomodoro' ? ((formData.get('autoCheckInEmoji') as string) || undefined) : undefined,
            frequency: {
                type: frequencyType
            },
            startDate,
            endDate: formData.get('endDate') as string || undefined,
            reminderTime: undefined, // deprecated: will keep first value for compatibility below
            reminderTimes: [],
            blockId: parsedBlockId || undefined,
            // 保留兼容字段，不再在编辑界面展示优先级
            priority: this.habit?.priority || 'none',
            groupId: formData.get('groupId') as string === 'none' ? undefined : formData.get('groupId') as string,
            checkInEmojis: JSON.parse(JSON.stringify(draftCheckInEmojis && draftCheckInEmojis.length > 0 ? draftCheckInEmojis : this.getDefaultCheckInEmojis())),
            checkIns: this.habit?.checkIns || {},
            totalCheckIns: this.habit?.totalCheckIns || 0,
            createdAt: this.habit?.createdAt || now,
            updatedAt: now,
            hideCheckedToday: draftHideCheckedToday || false
        };
        // 保留已有的 hasNotify 值（编辑时），避免覆盖已有记录
        if (this.habit && this.habit.hasNotify) {
            // 复制一份，避免引用同一对象
            habit.hasNotify = { ...this.habit.hasNotify };
        }

        // 从表单中收集 reminderTimes
        const timeInputs = form.querySelectorAll('input[name="reminderTimeValue"]') as NodeListOf<HTMLInputElement>;
        const noteInputs = form.querySelectorAll('input[name="reminderTimeNote"]') as NodeListOf<HTMLInputElement>;

        const reminderTimesArr: (string | { time: string; note?: string })[] = [];

        timeInputs.forEach((input, index) => {
            const time = input.value?.trim();
            if (time) {
                const note = noteInputs[index]?.value?.trim();
                if (note) {
                    reminderTimesArr.push({ time, note });
                } else {
                    reminderTimesArr.push(time);
                }
            }
        });

        if (reminderTimesArr.length > 0) {
            habit.reminderTimes = reminderTimesArr;
            // 兼容旧字段，取第一个时间
            const first = reminderTimesArr[0];
            habit.reminderTime = typeof first === 'string' ? first : first.time;
        } else {
            habit.reminderTimes = [];
            habit.reminderTime = undefined;
        }

        // 如果是修改已有习惯，并且提醒时间被修改为新的值（或多个提醒时间发生变化），且新的提醒时间晚于当前时间，则重置当天 hasNotify 以便再次提醒
        if (this.habit) {
            // 比较旧旧/new times
            const oldTimes = (this.habit.reminderTimes && Array.isArray(this.habit.reminderTimes) ? this.habit.reminderTimes : (this.habit.reminderTime ? [this.habit.reminderTime] : [])).map(t => typeof t === 'string' ? t : t.time);
            const newTimes = (habit.reminderTimes && Array.isArray(habit.reminderTimes) ? habit.reminderTimes : (habit.reminderTime ? [habit.reminderTime] : [])).map(t => typeof t === 'string' ? t : t.time);
            const timesChanged = JSON.stringify(oldTimes.sort()) !== JSON.stringify(newTimes.sort());
            if (timesChanged && newTimes.length > 0) {
                try {
                    const now = new Date();
                    const todayStr = getLogicalDateString();
                    // 如果新的某个提醒时间在今日，且晚于当前时间，则清理当天的 hasNotify 中该时间/条目，或者清空当天记录
                    const laterThanNow = newTimes.some(t => {
                        try {
                            const parts = (t || '').split(':');
                            if (parts.length >= 2) {
                                const hour = parseInt(parts[0], 10);
                                const minute = parseInt(parts[1], 10);
                                if (!isNaN(hour) && !isNaN(minute)) {
                                    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
                                    return dt.getTime() > now.getTime();
                                }
                            }
                        } catch (err) {
                            return false;
                        }
                        return false;
                    });
                    if (laterThanNow && habit.hasNotify && habit.hasNotify[todayStr]) {
                        try {
                            // 目标：只重置/移除与「将来提醒时间」对应的标记，保留今天已发生的过去提醒记录。
                            const entry = habit.hasNotify[todayStr];
                            // 计算今天的旧提醒时间数组（从旧习惯数据中推导）
                            const oldTimes = (this.habit?.reminderTimes && Array.isArray(this.habit.reminderTimes) ? this.habit.reminderTimes : (this.habit?.reminderTime ? [this.habit.reminderTime] : [])).map((t: any) => typeof t === 'string' ? t : t.time);

                            // 确定哪些 newTimes 是今天且晚于当前时间
                            const now = new Date();
                            const futureTimes = newTimes.filter((t: string) => {
                                try {
                                    const parts = (t || '').split(':');
                                    if (parts.length >= 2) {
                                        const hour = parseInt(parts[0], 10);
                                        const minute = parseInt(parts[1], 10);
                                        if (!isNaN(hour) && !isNaN(minute)) {
                                            const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
                                            return dt.getTime() > now.getTime();
                                        }
                                    }
                                } catch (err) {
                                    return false;
                                }
                                return false;
                            });

                            if (typeof entry === 'object') {
                                // 对象形式：逐个删除未来时间的标记（使其未被标记过，能够再次提醒）
                                futureTimes.forEach((ft: string) => {
                                    if ((entry as any)[ft]) {
                                        delete (entry as any)[ft];
                                    }
                                });
                                // 如果对象变为空，则删除当天的 entry
                                if (Object.keys(entry as any).length === 0) {
                                    delete habit.hasNotify[todayStr];
                                }
                            } else if (entry === true) {
                                // 旧的 boolean 表示当天已被全量标记。我们尽量保留已发生的过去提醒并允许将来的提醒重新触发。
                                // 将其转换为按时间的对象：把已知的旧提醒时间中发生在现在之前的标记为 true，未来时间保持未标记。
                                const obj: any = {};
                                const nowDate = new Date();
                                oldTimes.forEach((ot: string) => {
                                    try {
                                        const parts = (ot || '').split(':');
                                        if (parts.length >= 2) {
                                            const hour = parseInt(parts[0], 10);
                                            const minute = parseInt(parts[1], 10);
                                            if (!isNaN(hour) && !isNaN(minute)) {
                                                const dt = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hour, minute);
                                                if (dt.getTime() <= nowDate.getTime()) {
                                                    obj[ot] = true; // 保留过去已提醒标记
                                                }
                                            }
                                        }
                                    } catch (err) {
                                        // ignore parse error
                                    }
                                });
                                // 如果 obj 为空（没有过去时间可标记），则不设置当天 entry；否则写回对象形式
                                if (Object.keys(obj).length > 0) {
                                    habit.hasNotify[todayStr] = obj;
                                } else {
                                    // 没有可保留的过去标记，删除当天条目以允许未来提醒
                                    delete habit.hasNotify[todayStr];
                                }
                            }
                        } catch (err) {
                            console.warn('调整当天 hasNotify 失败:', err);
                        }
                    }
                } catch (err) {
                    console.warn('判断提醒时间是否晚于当前时间失败', err);
                }
            }
        }

        // set frequency details
        if (frequencyType === 'daily') {
            if (interval && interval > 1) habit.frequency.interval = interval;
        }

        if (frequencyType === 'weekly') {
            if (weekdays && weekdays.length > 0) {
                habit.frequency.weekdays = weekdays.sort((a, b) => a - b);
            } else if (interval && interval > 1) {
                habit.frequency.interval = interval;
            }
        }

        if (frequencyType === 'monthly') {
            if (monthDays && monthDays.length > 0) {
                habit.frequency.monthDays = monthDays.sort((a, b) => a - b);
            } else if (interval && interval > 1) {
                habit.frequency.interval = interval;
            }
        }

        if (frequencyType === 'yearly') {
            // 从日期输入框解析月份和日期
            const yearlyDateStr = formData.get('yearlyDate') as string;
            if (yearlyDateStr && yearlyDateStr.trim()) {
                const match = yearlyDateStr.trim().match(/^(\d{1,2})-(\d{1,2})$/);
                if (match) {
                    const month = parseInt(match[1]);
                    const day = parseInt(match[2]);
                    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                        habit.frequency.months = [month];
                        habit.frequency.monthDays = [day];
                    } else {
                        showMessage(i18n("invalidYearlyDateRange"), 3000, 'error');
                        return;
                    }
                } else {
                    showMessage(i18n("invalidYearlyDateFormat"), 3000, 'error');
                    return;
                }
            }
            if (interval && interval > 1) {
                habit.frequency.interval = interval;
            }
        }

        try {
            await this.onSave(habit);
            showMessage(isNew ? i18n("habitCreateSuccess") : i18n("habitSaveSuccess"));
            this.dialog.destroy();
        } catch (error) {
            console.error('保存习惯失败:', error);
            showMessage(i18n("habitSaveFailed"), 3000, 'error');
        }
    }

    private openBuiltInEmojiPicker(target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        openEmoji({
            hideDynamicIcon: true,
            hideCustomIcon: true,
            position: {
                x: rect.left,
                y: rect.bottom
            },
            selectedCB: (emojiCode: string) => {
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                const selectedEmoji = String.fromCodePoint(...codePoints);
                target.textContent = selectedEmoji;
                const form = target.closest('form');
                const iconInput = form?.querySelector('input[name="icon"]') as HTMLInputElement | null;
                if (iconInput) {
                    iconInput.value = selectedEmoji;
                }
            }
        });
    }

    private async updatePreviewForBlock(blockId: string, previewEl: HTMLElement) {
        try {
            const block = await getBlockByID(blockId);
            if (!block) {
                previewEl.textContent = i18n("blockNotFound");
                return;
            }

            let snippet = '';
            if (block.type === 'd') {
                snippet = block.content || '';
            } else {
                try {
                    const domString = await getBlockDOM(blockId);
                    const parser = new DOMParser();
                    const dom = parser.parseFromString(domString.dom, 'text/html');
                    const element = dom.querySelector('div[data-type="NodeParagraph"]');
                    if (element) {
                        const attrElement = element.querySelector('div.protyle-attr');
                        if (attrElement) attrElement.remove();
                    }
                    snippet = (element ? (element.textContent || '') : (block.fcontent || block.content || '')) || '';
                } catch (e) {
                    snippet = block.fcontent || block.content || '';
                }
            }

            previewEl.textContent = snippet ? snippet.trim().slice(0, 200) : '';
        } catch (err) {
            console.error('获取块预览失败:', err);
            previewEl.textContent = i18n("blockPreviewFailed");
        }
    }

    private extractBlockId(raw: string): string | null {
        if (!raw) return null;
        const blockRefRegex = /\(\(([\w\-]+)\s+'(.*)'\)\)/;
        const blockLinkRegex = /\[(.*)\]\(siyuan:\/\/blocks\/([\w\-]+)\)/;
        const match1 = raw.match(blockRefRegex);
        if (match1) return match1[1];
        const match2 = raw.match(blockLinkRegex);
        if (match2) return match2[2];
        const urlRegex = /siyuan:\/\/blocks\/([\w\-]+)/;
        const match3 = raw.match(urlRegex);
        if (match3) return match3[1];
        const idRegex = /^([a-zA-Z0-9\-]{5,})$/;
        if (idRegex.test(raw)) return raw;
        return null;
    }

    private getDefaultCheckInEmojis() {
        return [
            { emoji: '✅', meaning: i18n("checkInSuccess") || '完成', promptNote: false, countsAsSuccess:true },
            { emoji: '❌', meaning: i18n("checkInFailed") || '未完成', promptNote: false, countsAsSuccess:false },
            { emoji: '⭕️', meaning: i18n("partialCompleted") || '部分完成', promptNote: false, countsAsSuccess:false }
        ];
    }

    private generateRandomHabitColor(): string {
        const hue = Math.floor(Math.random() * 360);
        const saturation = 55 + Math.floor(Math.random() * 25); // 55-79
        const lightness = 48 + Math.floor(Math.random() * 12); // 48-59
        return this.hslToHex(hue, saturation, lightness);
    }

    private hslToHex(h: number, s: number, l: number): string {
        const sat = s / 100;
        const lig = l / 100;
        const c = (1 - Math.abs(2 * lig - 1)) * sat;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = lig - c / 2;
        let r = 0, g = 0, b = 0;

        if (h < 60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }

        const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
}
