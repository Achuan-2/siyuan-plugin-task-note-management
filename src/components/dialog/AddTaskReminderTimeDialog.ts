import { Dialog, showMessage } from "siyuan";
import { i18n } from "../../pluginInstance";
import { getAllReminders, saveReminders } from "../../utils/icsSubscription";

export async function showAddTaskReminderTimeDialog(
    plugin: any,
    reminderId: string,
    defaultDate: string | undefined,
    onSaved: () => void
) {
    try {
        const reminderData = await getAllReminders(plugin);
        // Normalize reminder ID (remove block ID suffix if present)
        let actualReminderId = reminderId;
        if (reminderId.includes('_block_')) {
            actualReminderId = reminderId.split('_block_')[0];
        }
        const reminder = reminderData[actualReminderId];

        if (!reminder) {
            showMessage(i18n("reminderNotExist"));
            return;
        }

        const now = new Date();
        const defaultTimeVal = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const inputDialog = new Dialog({
            title: i18n("addReminderTime") || "添加提醒时间",
            content: `<div class="b3-dialog__content"><div class="ft__breakword" style="padding:12px">
                <div style="margin-bottom:12px;">
                    <label style="display:block;margin-bottom:4px;font-weight:bold;">${i18n("date") || "日期"} (${i18n("optional") || "可选"})</label>
                    <input type="date" id="__calendar_reminder_date" class="b3-text-field" value="${defaultDate || ''}" max="9999-12-31" style="width:100%;padding:8px;box-sizing:border-box;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);" />
                </div>
                <div style="margin-bottom:12px; display: flex; gap: 8px;">
                    <div style="flex: 1;">
                        <label style="display:block;margin-bottom:4px;font-weight:bold;">${i18n("startTime") || "开始时间"}</label>
                        <input type="time" id="__calendar_reminder_start_time" class="b3-text-field" value="${defaultTimeVal}" style="width:100%;padding:8px;box-sizing:border-box;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);" />
                    </div>
                    <div style="flex: 1;">
                        <label style="display:block;margin-bottom:4px;font-weight:bold;">${i18n("endTimeOptional") || "结束时间 (可选)"}</label>
                        <input type="time" id="__calendar_reminder_end_time" class="b3-text-field" value="" style="width:100%;padding:8px;box-sizing:border-box;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);" />
                    </div>
                </div>
                <div>
                    <label style="display:block;margin-bottom:4px;font-weight:bold;">${i18n("noteOptionalLabel") || "备注（可选）"}</label>
                    <textarea id="__calendar_reminder_note" placeholder="${i18n("enterReminderNote") || "请输入备注..."}" style="width:100%;height:80px;box-sizing:border-box;resize:vertical;padding:8px;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);"></textarea>
                </div>
            </div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${i18n("cancel")}</button><div class="fn__space"></div><button class="b3-button b3-button--text" id="__calendar_reminder_confirm">${i18n("save")}</button></div>`,
            width: '420px',
            height: 'auto'
        });

        const dateEl = inputDialog.element.querySelector('#__calendar_reminder_date') as HTMLInputElement;
        const startTimeEl = inputDialog.element.querySelector('#__calendar_reminder_start_time') as HTMLInputElement;
        const endTimeEl = inputDialog.element.querySelector('#__calendar_reminder_end_time') as HTMLInputElement;
        const noteEl = inputDialog.element.querySelector('#__calendar_reminder_note') as HTMLTextAreaElement;
        const cancelBtn = inputDialog.element.querySelector('.b3-button.b3-button--cancel') as HTMLButtonElement;
        const okBtn = inputDialog.element.querySelector('#__calendar_reminder_confirm') as HTMLButtonElement;

        okBtn.addEventListener('click', async () => {
            const date = dateEl.value.trim();
            const startTime = startTimeEl.value.trim();
            const endTime = endTimeEl.value.trim();
            const note = noteEl.value.trim();

            if (!startTime) {
                showMessage(i18n("timeRequiresDate") || "请输入开始时间");
                return;
            }

            if (endTime && endTime < startTime) {
                showMessage(i18n("endTimeCannotBeEarlier") || "结束时间不能早于开始时间");
                return;
            }

            if (!reminder.reminderTimes) {
                reminder.reminderTimes = [];
            }

            const checkTime = date ? `${date}T${startTime}` : startTime;

            // Check for duplicates
            const hasDuplicate = reminder.reminderTimes.some((rt: any) => {
                const rtTime = typeof rt === 'string' ? rt.trim() : rt?.time?.trim();
                return rtTime === checkTime;
            });

            if (hasDuplicate) {
                showMessage(i18n("reminderTimeExists") || "已存在该提醒时间");
                return;
            }

            const newReminderTime: any = {};
            if (date) {
                newReminderTime.time = `${date}T${startTime}`;
                if (endTime) {
                    newReminderTime.endTime = `${date}T${endTime}`;
                }
            } else {
                newReminderTime.time = startTime;
                if (endTime) {
                    newReminderTime.endTime = endTime;
                }
            }
            if (note) {
                newReminderTime.note = note;
            }

            reminder.reminderTimes.push(newReminderTime);

            try {
                await saveReminders(plugin, reminderData);
                if (plugin?.updateMobileNotification) {
                    try {
                        await plugin.updateMobileNotification(reminder);
                    } catch (e) {
                        console.warn("Failed to update mobile notifications after adding time reminder:", e);
                    }
                }

                if (onSaved) {
                    onSaved();
                }
                showMessage(i18n("operationSuccessful") || "添加成功");
            } catch (error) {
                console.error("Failed to save reminder time:", error);
                showMessage(i18n("saveFailed") || "保存失败");
            }

            inputDialog.destroy();
        });

        cancelBtn.addEventListener('click', () => {
            inputDialog.destroy();
        });
        inputDialog.element.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                inputDialog.destroy();
            }
        });
    } catch (error) {
        console.error("Failed to open add reminder time dialog:", error);
        showMessage(i18n("operationFailed"));
    }
}
