import { Dialog, showMessage, confirm } from "siyuan";
import type { Habit, HabitCheckInEmoji } from "./HabitPanel";
import { getLocalDateTimeString, getLogicalDateString } from "../utils/dateUtils";
import { PomodoroRecordManager, type PomodoroSession } from "../utils/pomodoroRecord";
import { i18n, getPluginInstance } from "../pluginInstance";

type HabitDayEntry = {
    emoji: string;
    meaning?: string;
    timestamp: string;
    note?: string;
    group?: string;
};

export class HabitDayDialog {
    private dialog: Dialog;
    private habit: Habit;
    private dateStr: string;
    private onSave: (habit: Habit) => Promise<void>;
    private pomodoroManager: PomodoroRecordManager;
    private plugin?: any;

    constructor(habit: Habit, dateStr: string, onSave: (habit: Habit) => Promise<void>, plugin?: any) {
        this.habit = habit;
        this.dateStr = dateStr;
        this.onSave = onSave;
        this.plugin = plugin || getPluginInstance();
        this.pomodoroManager = PomodoroRecordManager.getInstance(this.plugin);
    }

    show() {
        this.dialog = new Dialog({
            title: this.habit.icon +i18n("dayDialogTitle", { title: this.habit.title, date: this.dateStr }),
            content: "<div id=\"habitDayEditContainer\"></div>",
            width: "560px",
            height: "560px"
        });

        const container = this.dialog.element.querySelector("#habitDayEditContainer") as HTMLElement;
        if (!container) return;
        container.style.cssText = "display: flex; flex-direction: column; height: 100%;";

        const contentDiv = document.createElement("div");
        contentDiv.className = "b3-dialog__content";
        contentDiv.style.cssText = "flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;";
        container.appendChild(contentDiv);

        const actionDiv = document.createElement("div");
        actionDiv.className = "b3-dialog__action";
        actionDiv.style.cssText = "padding: 12px 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--b3-border-color);";
        container.appendChild(actionDiv);

        void this.render(contentDiv, actionDiv);
    }

    private getEntriesForDate(checkIn: any): HabitDayEntry[] {
        if (!checkIn) return [];
        if (Array.isArray(checkIn.entries) && checkIn.entries.length > 0) {
            return checkIn.entries.map((e: any) => ({
                emoji: e.emoji,
                meaning: e.meaning || this.getMeaningForEmoji(e.emoji),
                timestamp: e.timestamp,
                note: e.note,
                group: e.group
            }));
        }
        return (checkIn.status || []).map((s: string) => ({
            emoji: s,
            meaning: this.getMeaningForEmoji(s),
            timestamp: checkIn.timestamp || "",
            note: ""
        }));
    }

    private getMeaningForEmoji(emoji: string | undefined): string | undefined {
        if (!emoji) return undefined;
        const configs = this.habit.checkInEmojis || [] as HabitCheckInEmoji[];
        const cfg = configs.find(c => c.emoji === emoji);
        return cfg ? cfg.meaning : undefined;
    }

    private async setEntriesForDate(dateStr: string, entries: HabitDayEntry[]) {
        this.habit.checkIns = this.habit.checkIns || {};
        if (!entries || entries.length === 0) {
            delete this.habit.checkIns![dateStr];
            return;
        }
        this.habit.checkIns[dateStr] = this.habit.checkIns[dateStr] || { count: 0, status: [], timestamp: "" } as any;
        this.habit.checkIns[dateStr].entries = entries;
        this.habit.checkIns[dateStr].status = entries.map(e => e.emoji);
        this.habit.checkIns[dateStr].count = entries.length;
        this.habit.checkIns[dateStr].timestamp = entries[entries.length - 1].timestamp || this.habit.checkIns[dateStr].timestamp;
    }

    private async getHabitPomodoroSessionsByDate(dateStr: string): Promise<PomodoroSession[]> {
        try {
            await this.pomodoroManager.initialize();
            await this.pomodoroManager.refreshData();
            const sessions = this.pomodoroManager.getDateSessions(dateStr) || [];
            return sessions
                .filter(session =>
                    session.type === "work" &&
                    (session.eventId === this.habit.id || session.eventId.startsWith(`${this.habit.id}_`))
                )
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        } catch (error) {
            console.warn("加载习惯番茄记录失败:", error);
            return [];
        }
    }

    private formatMinutes(minutes: number): string {
        const safe = Math.max(0, Math.round(minutes || 0));
        const h = Math.floor(safe / 60);
        const m = safe % 60;
        if (h > 0) {
            return m > 0 ? `${h}h${m}m` : `${h}h`;
        }
        return `${m}m`;
    }

    private formatHm(iso: string): string {
        const d = new Date(iso);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
    }

    private async render(contentContainer: HTMLElement, actionContainer?: HTMLElement) {
        contentContainer.innerHTML = "";
        if (!actionContainer) {
            actionContainer = this.dialog.element.querySelector(".b3-dialog__action") as HTMLElement;
        }
        if (actionContainer) actionContainer.innerHTML = "";

        const header = document.createElement("div");
        header.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px;";
        const title = document.createElement("div");
        title.innerHTML = `<span style="font-weight:600;">✅ 当天习惯打卡记录</span>`;
        header.appendChild(title);

        const addBtn = document.createElement("button");
        addBtn.className = "b3-button b3-button--primary";
        addBtn.textContent = i18n("addDayCheckIn");
        addBtn.addEventListener("click", () => this.openAddEntryDialog());
        header.appendChild(addBtn);
        contentContainer.appendChild(header);

        const listWrap = document.createElement("div");
        listWrap.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-top:8px;";
        contentContainer.appendChild(listWrap);

        const checkIn = this.habit.checkIns?.[this.dateStr];
        const entries = this.getEntriesForDate(checkIn);

        if (entries.length === 0) {
            const empty = document.createElement("div");
            empty.textContent = i18n("noDayCheckIn");
            empty.style.cssText = "color:var(--b3-theme-on-surface-light); padding:12px;";
            listWrap.appendChild(empty);
        } else {
            entries.forEach((entry, idx) => {
                const item = document.createElement("div");
                item.style.cssText = "display:flex; align-items:center; gap:8px; padding:8px; background:var(--b3-theme-surface); border-radius:6px;";

                const emojiSpan = document.createElement("span");
                emojiSpan.textContent = entry.emoji;
                emojiSpan.style.cssText = "font-size:18px;";

                const meaning = document.createElement("span");
                meaning.textContent = entry.meaning ? ` ${entry.meaning}` : "";
                meaning.style.cssText = "font-size:12px; color:var(--b3-theme-on-surface-light);";

                const timeSpan = document.createElement("span");
                timeSpan.textContent = entry.timestamp ? entry.timestamp.split(" ")[1] : "";
                timeSpan.style.cssText = "font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:8px;";

                const noteSpan = document.createElement("span");
                if (entry.note) {
                    noteSpan.textContent = `📝 ${entry.note}`;
                    noteSpan.style.cssText = "font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:8px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                }

                const editBtn = document.createElement("button");
                editBtn.className = "b3-button b3-button--outline";
                editBtn.textContent = i18n("editDayCheckIn");
                editBtn.style.cssText = "margin-left:auto;";
                editBtn.addEventListener("click", () => this.openEditEntryDialog(idx));

                const delBtn = document.createElement("button");
                delBtn.className = "b3-button b3-button--danger";
                delBtn.textContent = i18n("delete");
                delBtn.addEventListener("click", () => {
                    confirm(
                        i18n("confirmDeleteEntry"),
                        i18n("confirmDeleteEntryMsg", {
                            title: this.habit.title,
                            date: this.dateStr,
                            index: String(idx + 1)
                        }),
                        async () => {
                            await this.deleteEntry(idx);
                            await this.render(contentContainer, actionContainer);
                        }
                    );
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

        await this.renderPomodoroSection(contentContainer);

        if (actionContainer) {
            const closeBtn = document.createElement("button");
            closeBtn.className = "b3-button";
            closeBtn.textContent = i18n("close");
            closeBtn.addEventListener("click", () => this.dialog.destroy());
            actionContainer.appendChild(closeBtn);
        }
    }

    private async renderPomodoroSection(container: HTMLElement) {
        const sessions = await this.getHabitPomodoroSessionsByDate(this.dateStr);
        const totalCount = sessions.reduce((sum, s) => sum + this.pomodoroManager.calculateSessionCount(s), 0);
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);

        const section = document.createElement("div");
        section.style.cssText = "margin-top:12px; padding-top:12px; border-top:1px solid var(--b3-theme-surface-light);";

        const header = document.createElement("div");
        header.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;";
        const title = document.createElement("div");
        title.style.cssText = "font-weight:600;";
        title.textContent = "🍅 当天番茄记录";
        const addBtn = document.createElement("button");
        addBtn.className = "b3-button b3-button--outline";
        addBtn.textContent = i18n("addPomodoro") || "补录番茄钟";
        addBtn.addEventListener("click", () => this.openAddPomodoroDialog());
        header.appendChild(title);
        header.appendChild(addBtn);
        section.appendChild(header);

        const summary = document.createElement("div");
        summary.style.cssText = "font-size:12px; color:var(--b3-theme-on-surface-light); margin-bottom:8px;";
        summary.textContent = sessions.length > 0
            ? `共 ${totalCount} 个番茄（${this.formatMinutes(totalMinutes)}）`
            : "当天暂无番茄记录";
        section.appendChild(summary);

        if (sessions.length > 0) {
            const list = document.createElement("div");
            list.style.cssText = "display:flex; flex-direction:column; gap:6px;";
            sessions.forEach(session => {
                const row = document.createElement("div");
                const count = this.pomodoroManager.calculateSessionCount(session);
                row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; padding:6px 8px; border-radius:6px; background:var(--b3-theme-background);";

                const left = document.createElement("span");
                left.textContent = `${this.formatHm(session.startTime)} - ${this.formatHm(session.endTime)}`;

                const right = document.createElement("div");
                right.style.cssText = "display:flex; align-items:center; gap:6px;";

                const value = document.createElement("span");
                value.textContent = `🍅 ${count}（${this.formatMinutes(session.duration || 0)}）`;
                value.style.cssText = "font-weight:600;";

                const editBtn = document.createElement("button");
                editBtn.className = "b3-button b3-button--outline";
                editBtn.textContent = i18n("edit") || "编辑";
                editBtn.style.cssText = "padding:2px 6px; line-height:1.2; height:24px;";
                editBtn.addEventListener("click", () => this.openEditPomodoroDurationDialog(session));

                const deleteBtn = document.createElement("button");
                deleteBtn.className = "b3-button b3-button--outline b3-button--danger";
                deleteBtn.textContent = i18n("delete") || "删除";
                deleteBtn.style.cssText = "padding:2px 6px; line-height:1.2; height:24px;";
                deleteBtn.addEventListener("click", () => this.deletePomodoroSession(session));

                right.appendChild(value);
                right.appendChild(editBtn);
                right.appendChild(deleteBtn);
                row.appendChild(left);
                row.appendChild(right);
                list.appendChild(row);
            });
            section.appendChild(list);
        }

        container.appendChild(section);
    }

    private async openAddPomodoroDialog() {
        let workDuration = 25;
        if (this.plugin && typeof this.plugin.loadSettings === "function") {
            try {
                const settings = await this.plugin.loadSettings();
                workDuration = settings.pomodoroWorkDuration || 25;
            } catch (error) {
                console.warn("加载番茄设置失败，使用默认值", error);
            }
        }

        const dialog = new Dialog({
            title: "➕ " + (i18n("addPomodoro") || "补录番茄钟"),
            content: `
                <div style="padding: 16px;">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("timeMode") || "时间模式"}</label>
                        <select id="timeMode" class="b3-select" style="width: 100%;">
                            <option value="end">${i18n("endTime") || "结束时间"}</option>
                            <option value="start">${i18n("startTime") || "开始时间"}</option>
                        </select>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("timeInputLabel") || "时间"}</label>
                        <input type="datetime-local" id="sessionTimePoint" class="b3-text-field" style="width: 100%;" required>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("duration") || "持续时长"} (${i18n("minutes") || "分钟"})</label>
                        <input type="number" id="sessionDuration" class="b3-text-field" value="${workDuration}" min="1" style="width: 100%;" required>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="sessionIsCountUp">
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${i18n("isCountUp") || "正计时 (自动计算番茄数)"}</span>
                        </label>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="confirmAddPomodoro">${i18n("save")}</button>
                    </div>
                </div>
            `,
            width: "420px"
        });

        const timeInput = dialog.element.querySelector("#sessionTimePoint") as HTMLInputElement;
        const baseDate = new Date(`${this.dateStr}T12:00:00`);
        timeInput.value = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}-${String(baseDate.getDate()).padStart(2, "0")}T12:00`;

        dialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => dialog.destroy());

        dialog.element.querySelector("#confirmAddPomodoro")?.addEventListener("click", async () => {
            const timeMode = (dialog.element.querySelector("#timeMode") as HTMLSelectElement).value;
            const timePointStr = (dialog.element.querySelector("#sessionTimePoint") as HTMLInputElement).value;
            const duration = parseInt((dialog.element.querySelector("#sessionDuration") as HTMLInputElement).value, 10);
            const isCountUp = (dialog.element.querySelector("#sessionIsCountUp") as HTMLInputElement).checked;

            if (!timePointStr || !duration || duration <= 0) {
                showMessage(i18n("pleaseEnterValidInfo") || "请输入有效信息", 3000, "error");
                return;
            }

            try {
                await this.pomodoroManager.initialize();
                const timePoint = new Date(timePointStr);
                let startTime: Date;
                let endTime: Date;
                if (timeMode === "end") {
                    endTime = timePoint;
                    startTime = new Date(endTime.getTime() - duration * 60000);
                } else {
                    startTime = timePoint;
                    endTime = new Date(startTime.getTime() + duration * 60000);
                }

                const plannedDuration = isCountUp ? workDuration : duration;
                const count = Math.max(1, Math.round(duration / Math.max(1, plannedDuration)));
                const session: PomodoroSession = {
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
                    type: "work",
                    eventId: this.habit.id,
                    eventTitle: this.habit.title,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    duration,
                    plannedDuration,
                    completed: true,
                    isCountUp,
                    count
                };

                const logicalDate = getLogicalDateString(startTime);
                const records = (this.pomodoroManager as any).records;
                if (!records[logicalDate]) {
                    records[logicalDate] = {
                        date: logicalDate,
                        workSessions: 0,
                        totalWorkTime: 0,
                        totalBreakTime: 0,
                        sessions: []
                    };
                }
                records[logicalDate].sessions.push(session);
                records[logicalDate].workSessions += this.pomodoroManager.calculateSessionCount(session);
                records[logicalDate].totalWorkTime += duration;
                await (this.pomodoroManager as any).saveRecords([logicalDate]);
                this.pomodoroManager.refreshIndex();

                let autoCheckInApplied = false;
                if (session.type === "work") {
                    // 每次补录后只做“达标即补1次自动打卡”，避免一次补录写入多个✅
                    autoCheckInApplied = await this.applyAutoCheckInFromPomodoro(logicalDate, 1);
                }

                showMessage("✅ " + (i18n("addPomodoroSuccess") || "补录番茄钟成功"), 3000, "info");
                dialog.destroy();

                if (!autoCheckInApplied) {
                    try {
                        await this.onSave(this.habit);
                    } catch (error) {
                        console.warn("刷新习惯视图失败:", error);
                    }
                }
                const content = this.dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
                const action = this.dialog.element.querySelector(".b3-dialog__action") as HTMLElement;
                if (content) await this.render(content, action);
                window.dispatchEvent(new CustomEvent("habitUpdated"));
            } catch (error) {
                console.error("补录番茄钟失败:", error);
                showMessage("❌ " + (i18n("addPomodoroFailed") || "补录番茄钟失败"), 3000, "error");
            }
        });
    }

    private async applyAutoCheckInFromPomodoro(dateStr: string, _count: number): Promise<boolean> {
        if (!this.habit.autoCheckInAfterPomodoro) return false;

        const now = getLocalDateTimeString(new Date());
        const selectedEmoji = this.habit.autoCheckInEmoji || this.habit.checkInEmojis?.[0]?.emoji || "✅";

        let emojiConfig = this.habit.checkInEmojis?.find(item => item.emoji === selectedEmoji);
        if (!emojiConfig) {
            emojiConfig = {
                emoji: selectedEmoji,
                meaning: "自动番茄打卡",
                countsAsSuccess: true,
                promptNote: false
            };
            this.habit.checkInEmojis = [...(this.habit.checkInEmojis || []), emojiConfig];
        }

        this.habit.checkIns = this.habit.checkIns || {};
        if (!this.habit.checkIns[dateStr]) {
            this.habit.checkIns[dateStr] = {
                count: 0,
                status: [],
                timestamp: now,
                entries: []
            } as any;
        }

        const dayCheckIn = this.habit.checkIns[dateStr];
        dayCheckIn.entries = dayCheckIn.entries || [];
        dayCheckIn.status = dayCheckIn.status || [];

        const existingSuccess = this.getEntriesForDate(dayCheckIn).filter(entry => {
            const cfg = this.habit.checkInEmojis?.find(item => item.emoji === entry.emoji);
            return cfg ? cfg.countsAsSuccess !== false : true;
        }).length;
        if (existingSuccess > 0) {
            return false;
        }

        dayCheckIn.entries.push({ 
            emoji: emojiConfig.emoji, 
            timestamp: now,
            meaning: emojiConfig.meaning,
            group: (emojiConfig.group || '').trim() || undefined
        });
        dayCheckIn.status.push(emojiConfig.emoji);
        dayCheckIn.count = (dayCheckIn.count || 0) + 1;
        dayCheckIn.timestamp = now;

        this.habit.totalCheckIns = (this.habit.totalCheckIns || 0) + 1;
        this.habit.updatedAt = now;

        try {
            await this.onSave(this.habit);
            return true;
        } catch (error) {
            console.warn("自动番茄打卡保存失败:", error);
            return false;
        }
    }

    private openEditPomodoroDurationDialog(session: PomodoroSession) {
        const dialog = new Dialog({
            title: "✏️ " + (i18n("editPomodoro") || "编辑番茄钟"),
            content: `
                <div style="padding:16px;">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("duration") || "持续时长"} (${i18n("minutes") || "分钟"})</label>
                        <input type="number" id="editPomodoroDuration" class="b3-text-field" min="1" value="${Math.max(1, Math.round(session.duration || 1))}" style="width:100%;" />
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel">${i18n("cancel") || "取消"}</button>
                        <button class="b3-button b3-button--primary" id="confirmEditPomodoro">${i18n("save") || "保存"}</button>
                    </div>
                </div>
            `,
            width: "360px"
        });

        dialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => dialog.destroy());
        dialog.element.querySelector("#confirmEditPomodoro")?.addEventListener("click", async () => {
            const durationInput = dialog.element.querySelector("#editPomodoroDuration") as HTMLInputElement;
            const newDuration = parseInt(durationInput.value, 10);
            if (!newDuration || newDuration <= 0) {
                showMessage(i18n("pleaseEnterValidInfo") || "请输入有效信息", 3000, "error");
                return;
            }

            try {
                await this.pomodoroManager.initialize();
                const records = (this.pomodoroManager as any).records || {};
                let affectedDate = "";
                Object.keys(records).forEach(date => {
                    const record = records[date];
                    if (!record?.sessions) return;
                    const sessionIndex = record.sessions.findIndex((s: PomodoroSession) => s.id === session.id);
                    if (sessionIndex === -1 || affectedDate) return;

                    affectedDate = date;
                    const target = record.sessions[sessionIndex];

                    // 1. 还原旧统计
                    const oldCount = this.pomodoroManager.calculateSessionCount(target);
                    if (target.type === 'work') {
                        record.workSessions = Math.max(0, record.workSessions - oldCount);
                        record.totalWorkTime = Math.max(0, record.totalWorkTime - (target.duration || 0));
                    } else {
                        record.totalBreakTime = Math.max(0, record.totalBreakTime - (target.duration || 0));
                    }

                    // 2. 更新数据
                    target.duration = newDuration;
                    const start = new Date(target.startTime);
                    target.endTime = new Date(start.getTime() + newDuration * 60000).toISOString();
                    if (target.isCountUp) {
                        target.count = Math.max(1, Math.round(newDuration / Math.max(1, target.plannedDuration || 25)));
                    } else if (typeof target.count === "number") {
                        target.count = Math.max(1, target.count);
                    }

                    // 3. 应用新统计
                    const newCount = this.pomodoroManager.calculateSessionCount(target);
                    if (target.type === 'work') {
                        record.workSessions += newCount;
                        record.totalWorkTime += newDuration;
                    } else {
                        record.totalBreakTime += newDuration;
                    }
                });

                if (!affectedDate) {
                    showMessage("❌ 未找到番茄记录", 3000, "error");
                    return;
                }

                await (this.pomodoroManager as any).saveRecords([affectedDate]);
                this.pomodoroManager.refreshIndex();
                showMessage("✅ " + (i18n("habitSaveSuccess") || "保存成功"), 2000);
                dialog.destroy();

                try {
                    await this.onSave(this.habit);
                } catch (error) {
                    console.warn("刷新习惯视图失败:", error);
                }
                const content = this.dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
                const action = this.dialog.element.querySelector(".b3-dialog__action") as HTMLElement;
                if (content) await this.render(content, action);
                window.dispatchEvent(new CustomEvent("habitUpdated"));
            } catch (error) {
                console.error("修改番茄时长失败:", error);
                showMessage("❌ 修改番茄时长失败", 3000, "error");
            }
        });
    }

    private async deletePomodoroSession(session: PomodoroSession) {
        confirm(
            i18n("delete") || "删除",
            "确认删除该番茄记录吗？",
            async () => {
                try {
                    await this.pomodoroManager.initialize();
                    const success = await this.pomodoroManager.deleteSession(session.id);
                    if (!success) {
                        showMessage("❌ 未找到番茄记录", 3000, "error");
                        return;
                    }
                    this.pomodoroManager.refreshIndex();
                    showMessage("✅ 删除成功", 2000);

                    try {
                        await this.onSave(this.habit);
                    } catch (error) {
                        console.warn("刷新习惯视图失败:", error);
                    }
                    const content = this.dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
                    const action = this.dialog.element.querySelector(".b3-dialog__action") as HTMLElement;
                    if (content) await this.render(content, action);
                    window.dispatchEvent(new CustomEvent("habitUpdated"));
                } catch (error) {
                    console.error("删除番茄记录失败:", error);
                    showMessage("❌ 删除番茄记录失败", 3000, "error");
                }
            }
        );
    }

    private openAddEntryDialog() {
        const today = getLogicalDateString();
        const dialog = new Dialog({
            title: i18n("addDayCheckIn"),
            content: "<div id=\"habitDayAddEntry\"></div>",
            width: "420px",
            height: "400px"
        });
        const container = dialog.element.querySelector("#habitDayAddEntry") as HTMLElement;
        if (!container) return;
        container.style.cssText = "display: flex; flex-direction: column; height: 100%;";

        const contentDiv = document.createElement("div");
        contentDiv.className = "b3-dialog__content";
        contentDiv.style.cssText = "flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;";
        container.appendChild(contentDiv);

        const actionDiv = document.createElement("div");
        actionDiv.className = "b3-dialog__action";
        actionDiv.style.cssText = "padding: 12px 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--b3-border-color);";
        container.appendChild(actionDiv);

        const timeRow = document.createElement("div");
        timeRow.style.cssText = "display:flex; gap:8px; align-items:center;";
        const timeLabel = document.createElement("label");
        timeLabel.textContent = i18n("timeInputLabel");
        const timeInput = document.createElement("input");
        timeInput.type = "time";
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        timeInput.value = `${hh}:${mm}`;
        timeInput.style.cssText = "flex:1;";
        timeRow.appendChild(timeLabel);
        timeRow.appendChild(timeInput);
        contentDiv.appendChild(timeRow);

        const emojiLabel = document.createElement("div");
        emojiLabel.textContent = i18n("checkInStatusLabel");
        emojiLabel.style.cssText = "font-weight:bold;";
        contentDiv.appendChild(emojiLabel);

        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";
        const emojiConfigs = this.habit.checkInEmojis || [] as any[];
        let selectedEmoji: string | undefined = emojiConfigs.length > 0 ? emojiConfigs[0].emoji : undefined;
        let selectedMeaning: string | undefined = emojiConfigs.length > 0 ? emojiConfigs[0].meaning : undefined;
        emojiConfigs.forEach(cfg => {
            const btn = document.createElement("button");
            btn.className = `b3-button ${(cfg.emoji === selectedEmoji && cfg.meaning === selectedMeaning) ? "b3-button--primary" : "b3-button--outline"}`;
            btn.innerHTML = `<span style="font-size:18px;">${cfg.emoji}</span><span style="font-size:12px; color:var(--b3-theme-on-surface-light); margin-left:6px;">${cfg.meaning || ""}</span>`;
            btn.addEventListener("click", () => {
                selectedEmoji = cfg.emoji;
                selectedMeaning = cfg.meaning;
                wrap.querySelectorAll("button").forEach(b => (b as HTMLButtonElement).className = "b3-button b3-button--outline");
                btn.className = "b3-button b3-button--primary";
            });
            wrap.appendChild(btn);
        });
        contentDiv.appendChild(wrap);

        const noteLabel = document.createElement("div");
        noteLabel.textContent = i18n("noteOptionalLabel");
        contentDiv.appendChild(noteLabel);
        const noteInput = document.createElement("textarea");
        noteInput.style.cssText = "width:100%; height:80px; box-sizing: border-box; padding: 8px; resize: vertical;";
        contentDiv.appendChild(noteInput);

        if (today !== this.dateStr) {
            const tip = document.createElement("div");
            tip.textContent = i18n("retroactiveCheckInTip");
            tip.style.cssText = "color: var(--b3-theme-on-surface-light); font-size: 12px;";
            contentDiv.appendChild(tip);
        }


        const cancelBtn = document.createElement("button");
        cancelBtn.className = "b3-button";
        cancelBtn.textContent = i18n("cancel");
        cancelBtn.addEventListener("click", () => dialog.destroy());
        const saveBtn = document.createElement("button");
        saveBtn.className = "b3-button b3-button--primary";
        saveBtn.textContent = i18n("save");
        saveBtn.addEventListener("click", async () => {
            if (!selectedEmoji) {
                showMessage(i18n("selectCheckInStatus"), 2000, "error");
                return;
            }
            const timestamp = `${this.dateStr} ${timeInput.value || `${hh}:${mm}`}`;
            const checkIn = this.habit.checkIns?.[this.dateStr];
            const entries = this.getEntriesForDate(checkIn);
            entries.push({
                emoji: selectedEmoji,
                meaning: selectedMeaning || this.getMeaningForEmoji(selectedEmoji),
                timestamp,
                note: noteInput.value.trim() || undefined,
                group: (emojiConfigs.find(c => c.emoji === selectedEmoji && c.meaning === selectedMeaning)?.group || '').trim() || undefined
            });
            await this.setEntriesForDate(this.dateStr, entries);
            this.habit.totalCheckIns = (this.habit.totalCheckIns || 0) + 1;
            this.habit.updatedAt = getLocalDateTimeString(new Date());
            await this.onSave(this.habit);
            showMessage(i18n("retroactiveSuccess"));
            dialog.destroy();
            const content = this.dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
            const action = this.dialog.element.querySelector(".b3-dialog__action") as HTMLElement;
            if (content) await this.render(content, action);
        });
        actionDiv.appendChild(cancelBtn);
        actionDiv.appendChild(saveBtn);


    }

    private async openEditEntryDialog(index: number) {
        const checkIn = this.habit.checkIns?.[this.dateStr];
        const entries = this.getEntriesForDate(checkIn);
        const entry = entries[index];
        if (!entry) return;

        const dialog = new Dialog({
            title: i18n("editDayCheckIn"),
            content: "<div id=\"habitDayEditEntry\"></div>",
            width: "380px",
            height: "360px"
        });
        const container = dialog.element.querySelector("#habitDayEditEntry") as HTMLElement;
        if (!container) return;
        container.style.cssText = "display: flex; flex-direction: column; height: 100%;";

        const contentDiv = document.createElement("div");
        contentDiv.className = "b3-dialog__content";
        contentDiv.style.cssText = "flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;";
        container.appendChild(contentDiv);

        const actionDiv = document.createElement("div");
        actionDiv.className = "b3-dialog__action";
        actionDiv.style.cssText = "padding: 12px 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--b3-border-color);";
        container.appendChild(actionDiv);

        const timeRow = document.createElement("div");
        timeRow.style.cssText = "display:flex; gap:8px; align-items:center;";
        const timeLabel = document.createElement("label");
        timeLabel.textContent = i18n("timeInputLabel");
        const timeInput = document.createElement("input");
        timeInput.type = "time";
        timeInput.value = entry.timestamp ? entry.timestamp.split(" ")[1] : "";
        timeInput.style.cssText = "flex:1;";
        timeRow.appendChild(timeLabel);
        timeRow.appendChild(timeInput);
        contentDiv.appendChild(timeRow);

        const noteLabel = document.createElement("div");
        noteLabel.textContent = i18n("noteOptionalLabel");
        contentDiv.appendChild(noteLabel);
        const noteInput = document.createElement("textarea");
        noteInput.style.cssText = "width:100%; height:80px; box-sizing: border-box; padding: 8px; resize: vertical;";
        noteInput.value = entry.note || "";
        contentDiv.appendChild(noteInput);


        const cancelBtn = document.createElement("button");
        cancelBtn.className = "b3-button";
        cancelBtn.textContent = i18n("cancel");
        cancelBtn.addEventListener("click", () => dialog.destroy());
        const saveBtn = document.createElement("button");
        saveBtn.className = "b3-button b3-button--primary";
        saveBtn.textContent = i18n("save");
        saveBtn.addEventListener("click", async () => {
            const newTime = timeInput.value || (entry.timestamp ? entry.timestamp.split(" ")[1] : "");
            entries[index].timestamp = `${this.dateStr} ${newTime}`;
            entries[index].note = noteInput.value.trim() || undefined;
            await this.setEntriesForDate(this.dateStr, entries);
            this.habit.updatedAt = getLocalDateTimeString(new Date());
            await this.onSave(this.habit);
            showMessage(i18n("habitSaveSuccess"));
            dialog.destroy();
            const content = this.dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
            const action = this.dialog.element.querySelector(".b3-dialog__action") as HTMLElement;
            if (content) await this.render(content, action);
        });
        actionDiv.appendChild(cancelBtn);
        actionDiv.appendChild(saveBtn);
    }

    private async deleteEntry(index: number) {
        const checkIn = this.habit.checkIns?.[this.dateStr];
        const entries = this.getEntriesForDate(checkIn);
        if (index < 0 || index >= entries.length) return;
        entries.splice(index, 1);
        await this.setEntriesForDate(this.dateStr, entries);
        this.habit.totalCheckIns = Math.max(0, (this.habit.totalCheckIns || 0) - 1);
        this.habit.updatedAt = getLocalDateTimeString(new Date());
        await this.onSave(this.habit);
    }
}
