import { Dialog, showMessage, confirm } from "siyuan";
import type { Habit, HabitCheckInEmoji } from "./HabitPanel";
import { getLocalDateTimeString, getLogicalDateString } from "../utils/dateUtils";

export class HabitDayDialog {
    private dialog: Dialog;
    private habit: Habit;
    private dateStr: string;
    private onSave: (habit: Habit) => Promise<void>;

    constructor(habit: Habit, dateStr: string, onSave: (habit: Habit) => Promise<void>) {
        this.habit = habit;
        this.dateStr = dateStr;
        this.onSave = onSave;
    }

    show() {
        this.dialog = new Dialog({
            title: `${this.habit.title} - ${this.dateStr} 打卡`,
            content: '<div id="habitDayEditContainer"></div>',
            width: '520px',
            height: '420px'
        });

        const container = this.dialog.element.querySelector('#habitDayEditContainer') as HTMLElement;
        if (!container) return;

        container.style.cssText = 'padding:12px; box-sizing:border-box; display:flex; flex-direction:column; gap:8px; height:100%; overflow:auto;';
        this.render(container);
    }

    private getEntriesForDate(checkIn: any): { emoji: string; meaning?: string; timestamp: string; note?: string }[] {
        if (!checkIn) return [];
        if (Array.isArray(checkIn.entries) && checkIn.entries.length > 0) {
            return checkIn.entries.map((e: any) => ({ emoji: e.emoji, meaning: e.meaning || this.getMeaningForEmoji(e.emoji), timestamp: e.timestamp, note: e.note }));
        }
        return (checkIn.status || []).map((s: string) => ({ emoji: s, meaning: this.getMeaningForEmoji(s), timestamp: checkIn.timestamp || '', note: '' }));
    }

    private getMeaningForEmoji(emoji: string | undefined): string | undefined {
        if (!emoji) return undefined;
        const configs = this.habit.checkInEmojis || [] as HabitCheckInEmoji[];
        const cfg = configs.find(c => c.emoji === emoji);
        return cfg ? cfg.meaning : undefined;
    }

    private async setEntriesForDate(dateStr: string, entries: { emoji: string; meaning?: string; timestamp: string; note?: string }[]) {
        this.habit.checkIns = this.habit.checkIns || {};
        if (!entries || entries.length === 0) {
            delete this.habit.checkIns![dateStr];
            return;
        }
        this.habit.checkIns[dateStr] = this.habit.checkIns[dateStr] || { count: 0, status: [], timestamp: '' } as any;
        this.habit.checkIns[dateStr].entries = entries;
        this.habit.checkIns[dateStr].status = entries.map(e => e.emoji);
        this.habit.checkIns[dateStr].count = entries.length;
        this.habit.checkIns[dateStr].timestamp = entries[entries.length - 1].timestamp || this.habit.checkIns[dateStr].timestamp;
    }

    private render(container: HTMLElement) {
        container.innerHTML = '';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
        const title = document.createElement('div');
        title.textContent = `${this.dateStr}`;
        title.style.cssText = 'font-weight:bold;';
        header.appendChild(title);

        const addBtn = document.createElement('button');
        addBtn.className = 'b3-button b3-button--primary';
        addBtn.textContent = '添加打卡';
        addBtn.addEventListener('click', () => this.openAddEntryDialog());
        header.appendChild(addBtn);

        container.appendChild(header);

        const listWrap = document.createElement('div');
        listWrap.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin-top:8px;';
        container.appendChild(listWrap);

        const checkIn = this.habit.checkIns?.[this.dateStr];
        const entries = this.getEntriesForDate(checkIn);

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '当天暂无打卡记录';
            empty.style.cssText = 'color:var(--b3-theme-on-surface-light); padding:12px;';
            listWrap.appendChild(empty);
        } else {
            entries.forEach((entry, idx) => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px; background:var(--b3-theme-surface); border-radius:6px;';
                const emojiSpan = document.createElement('span');
                emojiSpan.textContent = entry.emoji;
                emojiSpan.style.cssText = 'font-size:18px;';
                const meaning = document.createElement('span');
                meaning.textContent = entry.meaning ? ` ${entry.meaning}` : '';
                meaning.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light);';
                const timeSpan = document.createElement('span');
                timeSpan.textContent = entry.timestamp ? entry.timestamp.split(' ')[1] : '';
                timeSpan.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:8px;';

                const noteSpan = document.createElement('span');
                if (entry.note) {
                    noteSpan.textContent = `📝 ${entry.note}`;
                    noteSpan.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:8px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                }

                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--outline';
                editBtn.textContent = '编辑';
                editBtn.style.cssText = 'margin-left:auto;';
                editBtn.addEventListener('click', () => this.openEditEntryDialog(idx));

                const delBtn = document.createElement('button');
                delBtn.className = 'b3-button b3-button--danger';
                delBtn.textContent = '删除';
                delBtn.addEventListener('click', () => {
                    confirm('确认删除', `确定要删除该次打卡吗？`, async () => {
                        await this.deleteEntry(idx);
                        this.render(container);
                    });
                });

                item.appendChild(emojiSpan);
                item.appendChild(meaning);
                item.appendChild(timeSpan);
                if (entry.note) item.appendChild(noteSpan);
                item.appendChild(editBtn);
                item.appendChild(delBtn);
                listWrap.appendChild(item);
            });
        }

        // action buttons (only Close — saving happens per-entry on add/edit/delete)
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:8px;';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'b3-button';
        closeBtn.textContent = '关闭';
        closeBtn.addEventListener('click', () => this.dialog.destroy());

        actionBar.appendChild(closeBtn);
        container.appendChild(actionBar);
    }

    private openAddEntryDialog() {
        const today = getLogicalDateString();
        const dialog = new Dialog({ title: `添加 ${this.habit.title} 打卡`, content: '<div id="habitDayAddEntry"></div>', width: '420px', height: '360px' });
        const container = dialog.element.querySelector('#habitDayAddEntry') as HTMLElement;
        if (!container) return;
        container.style.cssText = 'padding:12px; display:flex; flex-direction:column; gap:8px;';

        const timeRow = document.createElement('div');
        timeRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
        const timeLabel = document.createElement('label'); timeLabel.textContent = '时间';
        const timeInput = document.createElement('input'); timeInput.type = 'time';
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        timeInput.value = `${hh}:${mm}`;
        timeInput.style.cssText = 'flex:1;';
        timeRow.appendChild(timeLabel); timeRow.appendChild(timeInput);
        container.appendChild(timeRow);

        const emojiLabel = document.createElement('div'); emojiLabel.textContent = '打卡状态'; emojiLabel.style.cssText = 'font-weight:bold;'; container.appendChild(emojiLabel);
        const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px;';
        const emojiConfigs = this.habit.checkInEmojis || [] as any[];
        let selectedEmoji: string | undefined = emojiConfigs.length > 0 ? emojiConfigs[0].emoji : undefined;
        let selectedMeaning: string | undefined = emojiConfigs.length > 0 ? emojiConfigs[0].meaning : undefined;
        emojiConfigs.forEach(cfg => {
            const btn = document.createElement('button');
            btn.className = `b3-button ${cfg.emoji === selectedEmoji ? 'b3-button--primary' : 'b3-button--outline'}`;
            btn.innerHTML = `<span style="font-size:18px;">${cfg.emoji}</span><span style="font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:6px;">${cfg.meaning || ''}</span>`;
            btn.addEventListener('click', () => {
                selectedEmoji = cfg.emoji; selectedMeaning = cfg.meaning;
                wrap.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).className = 'b3-button b3-button--outline');
                btn.className = 'b3-button b3-button--primary';
            });
            wrap.appendChild(btn);
        });
        container.appendChild(wrap);

        const noteLabel = document.createElement('div'); noteLabel.textContent = '备注（可选）'; container.appendChild(noteLabel);
        const noteInput = document.createElement('textarea'); noteInput.style.cssText = 'width:100%; height:80px;'; container.appendChild(noteInput);

        const action = document.createElement('div'); action.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:8px;';
        const cancelBtn = document.createElement('button'); cancelBtn.className = 'b3-button'; cancelBtn.textContent = '取消'; cancelBtn.addEventListener('click', () => dialog.destroy());
        const saveBtn = document.createElement('button'); saveBtn.className = 'b3-button b3-button--primary'; saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', async () => {
            if (!selectedEmoji) { showMessage('请选择一个打卡状态', 2000, 'error'); return; }
            const timestamp = `${this.dateStr} ${timeInput.value || `${hh}:${mm}`}`;
            const checkIn = this.habit.checkIns?.[this.dateStr];
            const entries = this.getEntriesForDate(checkIn);
            entries.push({ emoji: selectedEmoji!, meaning: selectedMeaning || this.getMeaningForEmoji(selectedEmoji!), timestamp, note: noteInput.value.trim() || undefined });
            await this.setEntriesForDate(this.dateStr, entries);
            this.habit.totalCheckIns = (this.habit.totalCheckIns || 0) + 1;
            this.habit.updatedAt = getLocalDateTimeString(new Date());
            await this.onSave(this.habit);
            showMessage('已保存');
            dialog.destroy();
            // re-render main dialog
            const main = this.dialog.element.querySelector('#habitDayEditContainer') as HTMLElement;
            if (main) this.render(main);
        });
        action.appendChild(cancelBtn); action.appendChild(saveBtn); container.appendChild(action);
    }

    private async openEditEntryDialog(index: number) {
        const checkIn = this.habit.checkIns?.[this.dateStr];
        const entries = this.getEntriesForDate(checkIn);
        const entry = entries[index];
        if (!entry) return;

        const dialog = new Dialog({ title: `编辑打卡`, content: '<div id="habitDayEditEntry"></div>', width: '380px', height: '360px' });
        const container = dialog.element.querySelector('#habitDayEditEntry') as HTMLElement;
        if (!container) return;
        container.style.cssText = 'padding:12px; display:flex; flex-direction:column; gap:8px;';

        const timeRow = document.createElement('div'); timeRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
        const timeLabel = document.createElement('label'); timeLabel.textContent = '时间';
        const timeInput = document.createElement('input'); timeInput.type = 'time';
        timeInput.value = entry.timestamp ? entry.timestamp.split(' ')[1] : '';
        timeInput.style.cssText = 'flex:1;'; timeRow.appendChild(timeLabel); timeRow.appendChild(timeInput); container.appendChild(timeRow);

        const noteLabel = document.createElement('div'); noteLabel.textContent = '备注（可选）'; container.appendChild(noteLabel);
        const noteInput = document.createElement('textarea'); noteInput.style.cssText = 'width:100%; height:80px;'; noteInput.value = entry.note || ''; container.appendChild(noteInput);

        const action = document.createElement('div'); action.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:8px;';
        const cancelBtn = document.createElement('button'); cancelBtn.className = 'b3-button'; cancelBtn.textContent = '取消'; cancelBtn.addEventListener('click', () => dialog.destroy());
        const saveBtn = document.createElement('button'); saveBtn.className = 'b3-button b3-button--primary'; saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', async () => {
            const newTime = timeInput.value || (entry.timestamp ? entry.timestamp.split(' ')[1] : '');
            entries[index].timestamp = `${this.dateStr} ${newTime}`;
            entries[index].note = noteInput.value.trim() || undefined;
            await this.setEntriesForDate(this.dateStr, entries);
            this.habit.updatedAt = getLocalDateTimeString(new Date());
            await this.onSave(this.habit);
            showMessage('已保存');
            dialog.destroy();
            const main = this.dialog.element.querySelector('#habitDayEditContainer') as HTMLElement;
            if (main) this.render(main);
        });
        action.appendChild(cancelBtn); action.appendChild(saveBtn); container.appendChild(action);
    }

    private async deleteEntry(index: number) {
        const checkIn = this.habit.checkIns?.[this.dateStr];
        const entries = this.getEntriesForDate(checkIn);
        if (index < 0 || index >= entries.length) return;
        entries.splice(index, 1);
        await this.setEntriesForDate(this.dateStr, entries);
        this.habit.totalCheckIns = (this.habit.totalCheckIns || 0) - 1;
        this.habit.updatedAt = getLocalDateTimeString(new Date());
        await this.onSave(this.habit);
    }
}
