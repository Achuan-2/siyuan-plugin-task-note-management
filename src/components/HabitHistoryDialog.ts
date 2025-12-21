import { Dialog, confirm, showMessage } from "siyuan";
import type { Habit, HabitCheckInEmoji } from "./HabitPanel";
import { getLocalDateTimeString, getLogicalDateString } from "../utils/dateUtils";

export class HabitHistoryDialog {
    private dialog: Dialog;
    private habit: Habit;
    private onSave: (habit: Habit) => Promise<void>;
    private initialDate?: string;
    private collapsedDates: Set<string> = new Set();

    constructor(habit: Habit, onSave: (habit: Habit) => Promise<void>, initialDate?: string) {
        this.habit = habit;
        this.onSave = onSave;
        this.initialDate = initialDate;
    }

    show() {
        this.dialog = new Dialog({
            title: `${this.habit.title} - 历史打卡管理`,
            content: '<div id="habitHistoryContainer"></div>',
            width: "600px",
            height: "600px"
        });

        const container = this.dialog.element.querySelector('#habitHistoryContainer') as HTMLElement;
        if (!container) return;

        container.style.cssText = 'padding: 16px; overflow-y: auto; height: 100%; box-sizing: border-box;';
        this.loadCollapsedDates();
        this.renderList(container);
        // 如果传入了 initialDate，则直接打开补录对话框以便快速编辑/添加
        if (this.initialDate) {
            // 等待短暂时间，确保 DOM 已渲染完毕
            setTimeout(() => {
                this.openAddEntryDialog(this.initialDate);
            }, 50);
        }
    }

    private loadCollapsedDates() {
        try {
            const key = `habit-history-collapse-${this.habit.id}`;
            const raw = localStorage.getItem(key);
            if (raw) {
                const arr = JSON.parse(raw) as string[];
                this.collapsedDates = new Set(arr);
            } else {
                this.collapsedDates = new Set();
            }
        } catch (err) {
            this.collapsedDates = new Set();
        }
    }

    private saveCollapsedDates() {
        try {
            const key = `habit-history-collapse-${this.habit.id}`;
            localStorage.setItem(key, JSON.stringify(Array.from(this.collapsedDates)));
        } catch (err) {
            // ignore
        }
    }

    private renderList(container: HTMLElement) {
        container.innerHTML = '';

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';

        const title = document.createElement('h3');
        title.textContent = '历史打卡记录';
        title.style.marginBottom = '12px';
        titleRow.appendChild(title);

        // 添加补录按钮
        const addBtn = document.createElement('button');
        addBtn.className = 'b3-button b3-button--primary';
        addBtn.textContent = '添加';
        addBtn.title = '补录打卡';
        addBtn.addEventListener('click', () => this.openAddEntryDialog());
        titleRow.appendChild(addBtn);

        container.appendChild(titleRow);

        const checkIns = this.habit.checkIns || {};
        const dates = Object.keys(checkIns).sort().reverse();

        if (dates.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '暂无历史打卡记录';
            empty.style.cssText = 'padding: 20px; text-align: center; color: var(--b3-theme-on-surface-light);';
            container.appendChild(empty);
            return;
        }

        dates.forEach(dateStr => {
            const checkIn = checkIns[dateStr];
            const entries = this.getEntriesForDate(checkIn);
            const isCollapsed = this.collapsedDates.has(dateStr);

            const group = document.createElement('div');
            group.style.cssText = 'margin-bottom: 8px;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex; align-items:center; gap:12px; padding:8px; background: var(--b3-theme-surface); border-radius:6px; cursor:pointer;';

            const toggleIcon = document.createElement('span');
            toggleIcon.textContent = isCollapsed ? '▶' : '▼';
            toggleIcon.style.cssText = 'margin-right:8px; font-size:12px;';
            header.appendChild(toggleIcon);

            const dateDiv = document.createElement('div');
            dateDiv.textContent = dateStr;
            dateDiv.style.cssText = 'font-weight:bold; width:120px;';
            header.appendChild(dateDiv);

            const previewDiv = document.createElement('div');
            // Only show emojis as a compact summary; keep meaning in tooltip
            previewDiv.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;';
            entries.slice(0, 5).forEach(e => {
                const span = document.createElement('span');
                span.textContent = e.emoji;
                span.title = e.meaning || '';
                // add a slight right margin for spacing; keep font size prominent
                span.style.cssText = 'font-size:18px; margin-right:6px;';
                previewDiv.appendChild(span);
            });
            header.appendChild(previewDiv);

            const countDiv = document.createElement('div');
            countDiv.textContent = `${checkIn.count || 0} 次`;
            countDiv.style.cssText = 'color: var(--b3-theme-on-surface-light); margin-left:auto; width:70px; text-align:right;';
            header.appendChild(countDiv);

            // 添加单日补录按钮（可选快速补录）
            const addSingleBtn = document.createElement('button');
            addSingleBtn.className = 'b3-button b3-button--outline';
            addSingleBtn.style.cssText = 'margin-left:8px;';
            addSingleBtn.textContent = '添加';
            addSingleBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openAddEntryDialog(dateStr); });
            header.appendChild(addSingleBtn);

            header.addEventListener('click', () => {
                if (this.collapsedDates.has(dateStr)) this.collapsedDates.delete(dateStr);
                else this.collapsedDates.add(dateStr);
                this.saveCollapsedDates();
                this.renderList(container);
            });

            group.appendChild(header);

            const entriesContainer = document.createElement('div');
            entriesContainer.style.cssText = 'padding: 8px 12px; margin-top:6px; margin-left: 28px; display:' + (isCollapsed ? 'none' : 'block') + ';';
            const entriesWrap = document.createElement('div');
            entriesWrap.style.cssText = 'display:flex; flex-direction:column; gap:6px; align-items:stretch;';

            // 按时间排序 entries (从早到晚)
            const sortedEntries = [...entries].sort((a, b) => {
                const timeA = a.timestamp || '';
                const timeB = b.timestamp || '';
                return timeA.localeCompare(timeB);
            });

            sortedEntries.forEach((entry, idx) => {
                // 找到该 entry 在原始数组中的索引，用于编辑和删除
                const originalIndex = entries.findIndex(e =>
                    e.emoji === entry.emoji &&
                    e.timestamp === entry.timestamp &&
                    e.note === entry.note
                );
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; gap:6px; align-items:center; padding:4px 6px; background:var(--b3-theme-surface); border-radius:6px;';
                const span = document.createElement('span');
                span.textContent = entry.emoji;
                span.style.cssText = 'font-size:18px;';
                const meaningSpan = document.createElement('span');
                meaningSpan.textContent = entry.meaning ? ` ${entry.meaning}` : '';
                meaningSpan.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:4px;';
                const time = document.createElement('span');
                time.textContent = entry.timestamp ? entry.timestamp.split(' ')[1] : '';
                time.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:4px;';

                // 显示备注（如果有）
                let noteSpan: HTMLElement | null = null;
                if (entry.note) {
                    noteSpan = document.createElement('span');
                    noteSpan.textContent = `📝 ${entry.note}`;
                    noteSpan.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:8px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                }

                const editEntryBtn = document.createElement('button');
                editEntryBtn.className = 'b3-button b3-button--outline';
                editEntryBtn.style.cssText = 'padding:2px 6px; margin-left:8px;';
                editEntryBtn.textContent = '编辑';
                editEntryBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openEditEntryDialog(dateStr, originalIndex); });

                const deleteEntryBtn = document.createElement('button');
                deleteEntryBtn.className = 'b3-button b3-button--danger';
                deleteEntryBtn.style.cssText = 'padding:2px 6px;';
                deleteEntryBtn.textContent = '删除';
                deleteEntryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    confirm('确认删除', `确定要删除 ${this.habit.title} 在 ${dateStr} 的第 ${originalIndex + 1} 次打卡吗？`, async () => {
                        await this.deleteEntry(dateStr, originalIndex);
                    });
                });

                item.appendChild(span);
                item.appendChild(meaningSpan);
                item.appendChild(time);
                if (noteSpan) item.appendChild(noteSpan);
                item.appendChild(editEntryBtn);
                item.appendChild(deleteEntryBtn);
                entriesWrap.appendChild(item);
            });
            entriesContainer.appendChild(entriesWrap);

            group.appendChild(entriesContainer);

            container.appendChild(group);
        });
    }

    private async openAddEntryDialog(dateStr?: string) {
        const today = getLogicalDateString();
        const defaultDate = dateStr || today;
        const dialog = new Dialog({
            title: `补录 ${this.habit.title} 打卡`,
            content: '<div id="habitAddSingleEntryContainer"></div>',
            width: '420px',
            height: '360px'
        });

        const container = dialog.element.querySelector('#habitAddSingleEntryContainer') as HTMLElement;
        if (!container) return;

        // Ensure two child containers: content and action
        let contentDiv = document.createElement('div');
        contentDiv.className = 'b3-dialog__content';
        contentDiv.style.cssText = 'padding:12px; display:flex; flex-direction:column; gap:8px;';
        container.appendChild(contentDiv);
        let actionDiv = document.createElement('div');
        actionDiv.className = 'b3-dialog__action';
        actionDiv.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:8px;';
        container.appendChild(actionDiv);

        const dateRow = document.createElement('div');
        dateRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
        const dateLabel = document.createElement('label');
        dateLabel.textContent = '日期';
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = defaultDate;
        dateInput.style.cssText = 'flex:1;';
        dateRow.appendChild(dateLabel);
        dateRow.appendChild(dateInput);
        contentDiv.appendChild(dateRow);

        const timeRow = document.createElement('div');
        timeRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
        const timeLabel = document.createElement('label');
        timeLabel.textContent = '时间';
        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        // default to current time
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        timeInput.value = `${hh}:${mm}`;
        timeInput.style.cssText = 'flex:1;';
        timeRow.appendChild(timeLabel);
        timeRow.appendChild(timeInput);
        contentDiv.appendChild(timeRow);

        const emojiLabel = document.createElement('div');
        emojiLabel.textContent = '打卡状态';
        emojiLabel.style.cssText = 'font-weight:bold;';
        contentDiv.appendChild(emojiLabel);

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px;';
        const emojiConfigs = this.habit.checkInEmojis || [] as any[];
        let selectedEmoji: string | undefined = emojiConfigs.length > 0 ? emojiConfigs[0].emoji : undefined;
        let selectedMeaning: string | undefined = emojiConfigs.length > 0 ? emojiConfigs[0].meaning : undefined;
        emojiConfigs.forEach(cfg => {
            const btn = document.createElement('button');
            btn.className = `b3-button ${cfg.emoji === selectedEmoji ? 'b3-button--primary' : 'b3-button--outline'}`;
            btn.innerHTML = `<span style="font-size:18px;">${cfg.emoji}</span><span style="font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:6px;">${cfg.meaning || ''}</span>`;
            btn.addEventListener('click', () => {
                selectedEmoji = cfg.emoji;
                selectedMeaning = cfg.meaning;
                // update styles
                wrap.querySelectorAll('button').forEach(b => b.className = 'b3-button b3-button--outline');
                btn.className = 'b3-button b3-button--primary';
                saveBtn.disabled = false;
            });
            wrap.appendChild(btn);
        });
        contentDiv.appendChild(wrap);

        const noteLabel = document.createElement('div');
        noteLabel.textContent = '备注（可选）';
        contentDiv.appendChild(noteLabel);
        const noteInput = document.createElement('textarea');
        noteInput.style.cssText = 'width:100%; height:80px; box-sizing:border-box; padding:8px; resize:vertical;';
        contentDiv.appendChild(noteInput);

        const btnRow = document.createElement('div');
        // we'll append to actionDiv instead
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'b3-button';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => dialog.destroy());
        const saveBtn = document.createElement('button');
        saveBtn.className = 'b3-button b3-button--primary';
        saveBtn.textContent = '保存';
        if (!selectedEmoji) saveBtn.disabled = true;
        saveBtn.addEventListener('click', async () => {
            if (!selectedEmoji) {
                showMessage('请选择一个打卡状态', 2000, 'error');
                return;
            }
            const chosenDate = dateInput.value || getLogicalDateString();
            const chosenTime = timeInput.value || `${hh}:${mm}`;
            const timestamp = `${chosenDate} ${chosenTime}`;

            const checkIn = this.habit.checkIns?.[chosenDate];
            const entries = this.getEntriesForDate(checkIn);
            entries.push({ emoji: selectedEmoji!, meaning: selectedMeaning || this.getMeaningForEmoji(selectedEmoji!), timestamp, note: noteInput.value.trim() || undefined });
            await this.setEntriesForDate(chosenDate, entries);
            this.habit.totalCheckIns = (this.habit.totalCheckIns || 0) + 1;
            this.habit.updatedAt = getLocalDateTimeString(new Date());
            await this.onSave(this.habit);
            showMessage('补录成功');
            dialog.destroy();
            const containerMain = this.dialog.element.querySelector('#habitHistoryContainer') as HTMLElement;
            if (containerMain) this.renderList(containerMain);
        });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        actionDiv.appendChild(btnRow);
    }

    // 删除整天编辑功能（只支持单条 entry 的编辑和删除）

    private getEntriesForDate(checkIn: any): { emoji: string; meaning?: string; timestamp: string; note?: string }[] {
        if (!checkIn) return [];
        if (Array.isArray(checkIn.entries) && checkIn.entries.length > 0) {
            return checkIn.entries.map((e: any) => ({ emoji: e.emoji, meaning: e.meaning || this.getMeaningForEmoji(e.emoji), timestamp: e.timestamp, note: e.note }));
        }
        // fallback to legacy status array
        return (checkIn.status || []).map((s: string) => ({ emoji: s, meaning: this.getMeaningForEmoji(s), timestamp: checkIn.timestamp || '', note: '' }));
    }

    private getMeaningForEmoji(emoji: string | undefined): string | undefined {
        if (!emoji) return undefined;
        const configs = this.habit.checkInEmojis || [] as HabitCheckInEmoji[];
        const cfg = configs.find(c => c.emoji === emoji);
        return cfg ? cfg.meaning : undefined;
    }

    private async openEditEntryDialog(dateStr: string, index: number) {
        const checkIn = this.habit.checkIns?.[dateStr];
        if (!checkIn) return;
        const entries = this.getEntriesForDate(checkIn);
        const entry = entries[index];
        if (!entry) return;

        const dialog = new Dialog({
            title: `编辑 ${dateStr} 第 ${index + 1} 次打卡`,
            content: '<div id="habitEditSingleEntryContainer"></div>',
            width: '360px',
            height: '380px'
        });

        const container = dialog.element.querySelector('#habitEditSingleEntryContainer') as HTMLElement;
        if (!container) return;

        // Ensure two child containers: content and action
        let contentDiv = document.createElement('div');
        contentDiv.className = 'b3-dialog__content';
        contentDiv.style.cssText = 'padding:12px;';
        container.appendChild(contentDiv);
        let actionDiv = document.createElement('div');
        actionDiv.className = 'b3-dialog__action';
        actionDiv.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:12px;';
        container.appendChild(actionDiv);

        const label = document.createElement('div');
        label.textContent = '选择新的打卡状态';
        label.style.cssText = 'margin-bottom:8px; color:var(--b3-theme-on-surface-light);';
        contentDiv.appendChild(label);

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px;';
        const emojiConfigs = this.habit.checkInEmojis || [] as HabitCheckInEmoji[];
        let selectedEmoji: string | undefined = emojiConfigs.find(cfg => cfg.emoji === entry.emoji)?.emoji || (emojiConfigs.length > 0 ? emojiConfigs[0].emoji : undefined);
        let selectedMeaning: string | undefined = emojiConfigs.find(cfg => cfg.emoji === entry.emoji)?.meaning || (emojiConfigs.length > 0 ? emojiConfigs[0].meaning : undefined);
        emojiConfigs.forEach(cfg => {
            const btn = document.createElement('button');
            btn.className = `b3-button ${cfg.emoji === selectedEmoji ? 'b3-button--primary' : 'b3-button--outline'}`;
            // show emoji and meaning
            btn.innerHTML = `<span style="font-size:18px;">${cfg.emoji}</span><span style="font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:6px;">${cfg.meaning || ''}</span>`;
            btn.addEventListener('click', () => {
                selectedEmoji = cfg.emoji;
                selectedMeaning = cfg.meaning;
                // update active classes
                wrap.querySelectorAll('button').forEach(b => b.className = 'b3-button b3-button--outline');
                btn.className = 'b3-button b3-button--primary';
                // enable save when an emoji is selected
                if (saveBtn) {
                    (saveBtn as HTMLButtonElement).disabled = false;
                }
            });
            wrap.appendChild(btn);
        });
        contentDiv.appendChild(wrap);

        // 添加时间编辑
        const timeRow = document.createElement('div');
        timeRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:8px;';
        const timeLabel = document.createElement('label');
        timeLabel.textContent = '时间';
        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        // 预填当前条目的时间
        const currentTime = entry.timestamp ? entry.timestamp.split(' ')[1] : '';
        timeInput.value = currentTime;
        timeInput.style.cssText = 'flex:1;';
        timeRow.appendChild(timeLabel);
        timeRow.appendChild(timeInput);
        contentDiv.appendChild(timeRow);

        // 备注输入区
        const noteLabel = document.createElement('div');
        noteLabel.textContent = '备注（可选）';
        noteLabel.style.cssText = 'margin-top:8px; margin-bottom:4px; color:var(--b3-theme-on-surface-light);';
        contentDiv.appendChild(noteLabel);

        const noteInput = document.createElement('textarea');
        noteInput.style.cssText = 'width:100%; height:80px; box-sizing:border-box; padding:8px; resize:vertical;';
        noteInput.value = entry.note || '';
        contentDiv.appendChild(noteInput);

        const noteDiv = document.createElement('div');
        noteDiv.style.cssText = 'color:var(--b3-theme-on-surface-light); margin-bottom:8px;';
        if (!emojiConfigs || emojiConfigs.length === 0) {
            noteDiv.textContent = '当前习惯没有可用的打卡状态，请先在习惯设置中添加。';
        }
        contentDiv.appendChild(noteDiv);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:12px;';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'b3-button';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => dialog.destroy());
        const saveBtn = document.createElement('button');
        saveBtn.className = 'b3-button b3-button--primary';
        saveBtn.textContent = '保存';
        if (!selectedEmoji) {
            (saveBtn as HTMLButtonElement).disabled = true;
        }
        saveBtn.addEventListener('click', async () => {
            if (!selectedEmoji) {
                showMessage('请选择一个打卡状态', 2000, 'error');
                return;
            }
            // apply edit
            entries[index].emoji = selectedEmoji!;
            entries[index].meaning = selectedMeaning || this.getMeaningForEmoji(selectedEmoji!);
            // 更新时间
            const newTime = timeInput.value || currentTime;
            entries[index].timestamp = `${dateStr} ${newTime}`;
            entries[index].note = noteInput.value.trim() || undefined;
            // persist
            await this.setEntriesForDate(dateStr, entries);
            await this.onSave(this.habit);
            showMessage('保存成功');
            dialog.destroy();
            const containerMain = this.dialog.element.querySelector('#habitHistoryContainer') as HTMLElement;
            if (containerMain) this.renderList(containerMain);
        });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        actionDiv.appendChild(btnRow);
    }

    private async deleteEntry(dateStr: string, index: number) {
        const checkIn = this.habit.checkIns?.[dateStr];
        if (!checkIn) return;
        const entries = this.getEntriesForDate(checkIn);
        if (index < 0 || index >= entries.length) return;
        entries.splice(index, 1);
        // update fields
        await this.setEntriesForDate(dateStr, entries);
        // update total checkins
        this.habit.totalCheckIns = (this.habit.totalCheckIns || 0) - 1;
        this.habit.updatedAt = getLocalDateTimeString(new Date());
        await this.onSave(this.habit);
        showMessage('删除成功');
        // collapse state cleanup
        if (!this.habit.checkIns || !this.habit.checkIns[dateStr]) {
            this.collapsedDates.delete(dateStr);
            this.saveCollapsedDates();
        }

        const containerMain = this.dialog.element.querySelector('#habitHistoryContainer') as HTMLElement;
        if (containerMain) this.renderList(containerMain);
    }

    private async setEntriesForDate(dateStr: string, entries: { emoji: string; meaning?: string; timestamp: string; note?: string }[]) {
        this.habit.checkIns = this.habit.checkIns || {};
        if (!entries || entries.length === 0) {
            delete this.habit.checkIns![dateStr];
            // also reset collapse state for date
            this.collapsedDates.delete(dateStr);
            this.saveCollapsedDates();
            return;
        }
        this.habit.checkIns[dateStr] = this.habit.checkIns[dateStr] || { count: 0, status: [], timestamp: '' } as any;
        this.habit.checkIns[dateStr].entries = entries;
        this.habit.checkIns[dateStr].status = entries.map(e => e.emoji);
        this.habit.checkIns[dateStr].count = entries.length;
        this.habit.checkIns[dateStr].timestamp = entries[entries.length - 1].timestamp || this.habit.checkIns[dateStr].timestamp;
    }

    // 删除整天功能已移除 — 只支持单次 entry 的删除
}
