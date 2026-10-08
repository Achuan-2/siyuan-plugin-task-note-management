import { NotificationDialog } from '../components/dialog/NotificationDialog';
import { i18n } from '../pluginInstance';
import type { ReminderDueEvent } from './reminderEvents';
import type { ReminderNotificationInfo } from './ReminderNotificationService';

interface ReminderPresenterHost {
    isInMobileApp: boolean;
    playNotificationSound(): Promise<void>;
    getReminderSystemNotificationEnabled(): Promise<boolean>;
    getShowInternalNotificationEnabled(): Promise<boolean>;
    getCategory(id: string): any;
    canPresent?(): boolean;
    showSystem(title: string, message: string, reminderInfo?: ReminderNotificationInfo): Promise<unknown>;
}

/** 只负责前端呈现；分类样式、音效和操作按钮不进入内核。 */
export class ReminderEventPresenter {
    constructor(private readonly host: ReminderPresenterHost) {}

    private decorate(reminder: any): any {
        const category = reminder.categoryId ? this.host.getCategory(reminder.categoryId) : null;
        return { ...reminder, ...(category ? {
            categoryName: category.name, categoryColor: category.color, categoryIcon: category.icon
        } : {}) };
    }

    public async show(event: ReminderDueEvent): Promise<void> {
        const systemEnabled = await this.host.getReminderSystemNotificationEnabled();
        const internalEnabled = await this.host.getShowInternalNotificationEnabled();
        if (this.host.canPresent?.() === false) return;
        await this.host.playNotificationSound();
        if (this.host.canPresent?.() === false) return;
        if (event.event === 'daily-reminders') {
            const reminders = (event.reminders || []).map(reminder => this.decorate(reminder));
            if (!reminders.length) return;
            if (internalEnabled) NotificationDialog.showAllDayReminders(reminders);
            const title = `📅 ${i18n('dailyRemindersNotification')} (${reminders.length})`;
            const lines = reminders.slice(0, 2).map(reminder =>
                `${reminder.isOverdue ? '⚠️ ' : ''}• ${reminder.title}${reminder.time ? ` ⏰${reminder.time}` : ''}`
                + (reminder.categoryName ? ` [${reminder.categoryName}]` : ''));
            if (reminders.length > 2) lines.push(`... ${i18n('moreItems', { count: String(reminders.length - 2) })}`);
            if (systemEnabled && !this.host.isInMobileApp) await this.host.showSystem(title, lines.join('\n'));
            return;
        }
        const reminder = this.decorate(event.reminderInfo);
        if (internalEnabled) NotificationDialog.show(reminder);
        const title = event.event === 'habit-reminder' ? `🌱${i18n('habitReminder')}` : `⏰ ${i18n('timeReminderNotification')}`;
        if (systemEnabled && !this.host.isInMobileApp) await this.host.showSystem(title, event.message, reminder);
    }
}
