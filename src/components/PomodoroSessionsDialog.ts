/*
 * Copyright (c) 2024 by frostime. All Rights Reserved.
 * @Author       : frostime
 * @Date         : 2026-01-10
 * @FilePath     : /src/components/PomodoroSessionsDialog.ts
 * @LastEditTime : 2026-01-10
 * @Description  : 番茄钟会话管理对话框，用于查看、编辑、删除和补录番茄钟记录
 */

import { Dialog, confirm, showMessage } from "siyuan";
import { PomodoroRecordManager, PomodoroSession } from "../utils/pomodoroRecord";
import { i18n } from "../pluginInstance";
import { getLocaleTag } from "../utils/dateUtils";

export class PomodoroSessionsDialog {
    private dialog: Dialog;
    private reminderId: string;
    private plugin: any;
    private recordManager: PomodoroRecordManager;
    private sessions: PomodoroSession[] = [];
    private onUpdate?: () => void;
    private includeInstances: boolean; // 是否包含所有实例的番茄钟

    /**
     * @param reminderId 任务ID
     * @param plugin 插件实例
     * @param onUpdate 更新回调
     * @param includeInstances 是否包含该任务所有实例的番茄钟（用于"修改全部实例"模式）
     */
    constructor(reminderId: string, plugin: any, onUpdate?: () => void, includeInstances: boolean = false) {
        this.reminderId = reminderId;
        this.plugin = plugin;
        this.onUpdate = onUpdate;
        this.includeInstances = includeInstances;
        this.recordManager = PomodoroRecordManager.getInstance(plugin);
    }

    public async show() {
        await this.loadSessions();

        this.dialog = new Dialog({
            title: "🍅 " + (i18n("pomodoros") || "番茄钟记录"),
            content: `
                <div class="pomodoro-sessions-dialog" style="padding: 16px; display: flex; flex-direction: column; gap: 16px; max-height: 80vh;">
                    <div id="pomodoroSessionsList" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 100px;">
                        <!-- 番茄钟列表 -->
                    </div>
                    <div class="pomodoro-actions" style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--b3-border-color);">
                        <button id="addPomodoroBtn" class="b3-button b3-button--primary">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("addPomodoro") || "补录番茄钟"}
                        </button>
                    </div>
                </div>
            `,
            width: "600px",
            destroyCallback: () => {
                if (this.onUpdate) this.onUpdate();
            }
        });

        this.renderSessions();
        this.bindEvents();
    }

    /**
     * 加载该提醒的所有番茄钟会话
     */
    private async loadSessions() {
        await this.recordManager.initialize();

        // 获取所有日期范围内的会话
        const allSessions: PomodoroSession[] = [];

        // 遍历所有日期的记录
        for (const date in (this.recordManager as any).records) {
            const record = (this.recordManager as any).records[date];
            if (record && record.sessions) {
                // 筛选出属于当前提醒的会话
                const eventSessions = record.sessions.filter((session: PomodoroSession) => {
                    if (session.eventId === this.reminderId) return true;

                    // 如果启用了 includeInstances，还匹配该任务的所有实例（ID格式: reminderId_YYYY-MM-DD）
                    if (this.includeInstances && session.eventId.startsWith(this.reminderId + '_')) {
                        const suffix = session.eventId.substring(this.reminderId.length + 1);
                        return /^\d{4}-\d{2}-\d{2}$/.test(suffix);
                    }

                    return false;
                });
                allSessions.push(...eventSessions);
            }
        }

        // 按开始时间降序排列（最新的在前）
        this.sessions = allSessions.sort((a, b) =>
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );
    }

    private renderSessions() {
        const listEl = this.dialog.element.querySelector("#pomodoroSessionsList") as HTMLElement;
        if (!listEl) return;

        if (this.sessions.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 20px;">
                    ${i18n("noPomodoros") || "暂无番茄钟记录"}
                </div>
            `;
            return;
        }

        // 计算统计信息
        const totalSessions = this.sessions.reduce((sum, s) => {
            if (s.type === 'work') {
                return sum + this.recordManager.calculateSessionCount(s);
            }
            return sum;
        }, 0);
        const totalFocusTime = this.sessions
            .filter(s => s.type === 'work')
            .reduce((sum, s) => sum + s.duration, 0);

        listEl.innerHTML = `
            <div class="pomodoro-stats" style="padding: 12px; background: var(--b3-theme-background-light); border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-around;">
                    <div style="text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${totalSessions}</div>
                        <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">完成番茄数</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${this.formatDuration(totalFocusTime)}</div>
                        <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">总专注时长</div>
                    </div>
                </div>
            </div>
            ${this.sessions.map(session => this.renderSessionItem(session)).join("")}
        `;

        // 绑定每个会话项的事件
        listEl.querySelectorAll(".pomodoro-session-item").forEach(item => {
            const sessionId = item.getAttribute("data-id");
            const session = this.sessions.find(s => s.id === sessionId);

            item.querySelector(".edit-pomodoro-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.editSession(session);
            });

            item.querySelector(".delete-pomodoro-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteSession(sessionId);
            });
        });
    }

    private renderSessionItem(session: PomodoroSession): string {
        const startTime = new Date(session.startTime);
        const endTime = new Date(session.endTime);

        const dateStr = startTime.toLocaleDateString(getLocaleTag(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        const startTimeStr = startTime.toLocaleTimeString(getLocaleTag(), {
            hour: '2-digit',
            minute: '2-digit'
        });

        const endTimeStr = endTime.toLocaleTimeString(getLocaleTag(), {
            hour: '2-digit',
            minute: '2-digit'
        });

        const typeIcon = this.getTypeIcon(session.type);
        const statusBadge = '<span style="background: #4caf50; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">✓ 完成</span>';

        let extraBadges = '';
        if (session.type === 'work') {
            const count = this.recordManager.calculateSessionCount(session);

            if (session.isCountUp) {
                extraBadges += `<span style="background: var(--b3-theme-secondary); color: var(--b3-theme-on-secondary); padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 4px;">⏱️ 正计时</span>`;
                if (count > 0) {
                    extraBadges += `<span style="background: var(--b3-theme-primary-light); color: var(--b3-theme-primary); padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 4px;">🍅 x${count}</span>`;
                }
            } else {
                extraBadges += `<span style="background: var(--b3-theme-primary); color: var(--b3-theme-on-primary); padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 4px;">⏳ 倒计时</span>`;
                if (count > 0) {
                    extraBadges += `<span style="background: var(--b3-theme-primary-light); color: var(--b3-theme-primary); padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 4px;">🍅 x${count}</span>`;
                }
            }
        }

        return `
            <div class="pomodoro-session-item" data-id="${session.id}" style="
                display: flex;
                align-items: center;
                padding: 12px;
                background: var(--b3-theme-surface);
                border: 1px solid var(--b3-theme-border);
                border-radius: 6px;
                transition: all 0.2s;
            ">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 18px;">${typeIcon}</span>
                        <span style="font-weight: 500; width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${session.eventTitle}">${session.eventTitle}</span>
                        ${statusBadge}
                        ${extraBadges}
                    </div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); display: flex; gap: 12px;">
                        <span>📅 ${dateStr}</span>
                        <span>🕐 ${startTimeStr} - ${endTimeStr}</span>
                        <span>⏱️ ${session.duration} 分钟</span>
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="b3-button b3-button--outline edit-pomodoro-btn" title="${i18n("edit")}" style="padding: 4px 8px;">
                        <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                    </button>
                    <button class="b3-button b3-button--outline delete-pomodoro-btn" title="${i18n("delete")}" style="padding: 4px 8px;">
                        <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                    </button>
                </div>
            </div>
        `;
    }

    private getTypeIcon(type: 'work' | 'shortBreak' | 'longBreak'): string {
        switch (type) {
            case 'work':
                return '🍅';
            case 'shortBreak':
                return '☕';
            case 'longBreak':
                return '🌴';
            default:
                return '⏱️';
        }
    }

    private formatDuration(minutes: number): string {
        if (minutes < 60) {
            return `${minutes}分`;
        }
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
    }

    private bindEvents() {
        const addBtn = this.dialog.element.querySelector("#addPomodoroBtn") as HTMLButtonElement;

        addBtn?.addEventListener("click", () => {
            this.addNewSession();
        });
    }

    /**
     * 添加新的番茄钟会话（补录）
     */
    private async addNewSession() {
        // 获取插件设置中的番茄钟时长
        let workDuration = 25;
        let breakDuration = 5;
        let longBreakDuration = 15;

        if (this.plugin && typeof this.plugin.loadSettings === 'function') {
            try {
                const settings = await this.plugin.loadSettings();
                workDuration = settings.pomodoroWorkDuration || 25;
                breakDuration = settings.pomodoroBreakDuration || 5;
                longBreakDuration = settings.pomodoroLongBreakDuration || 15;
            } catch (error) {
                console.warn('加载番茄钟设置失败，使用默认值', error);
            }
        }

        const addDialog = new Dialog({
            title: "➕ " + (i18n("addPomodoro") || "补录番茄钟"),
            content: `
                <div class="add-pomodoro-dialog" style="padding: 16px;">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("sessionType") || "会话类型"}</label>
                        <select id="sessionType" class="b3-select" style="width: 100%;">
                            <option value="work">🍅 工作番茄</option>
                            <option value="shortBreak">☕ 短休息</option>
                            <option value="longBreak">🌴 长休息</option>
                        </select>
                    </div>
                    <div class="b3-form__group">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; margin-top: 8px;">
                            <select id="timeMode" class="b3-select" style="font-size: 12px; padding: 2px 24px 2px 8px; height: 24px; min-width: 80px;">
                                <option value="end">${i18n("endTime") || "结束时间"}</option>
                                <option value="start">${i18n("startTime") || "开始时间"}</option>
                            </select>
                        </div>
                        <input type="datetime-local" id="sessionTimePoint" class="b3-text-field" style="width: 100%;" required>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("duration") || "持续时长"} (${i18n("minutes") || "分钟"})</label>
                        <input type="number" id="sessionDuration" class="b3-text-field" value="${workDuration}" min="1" style="width: 100%;" required>
                    </div>
                    <div class="b3-form__group" id="countUpGroup">
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
            width: "400px"
        });

        // 设置默认时间为当前时间
        const timeInput = addDialog.element.querySelector("#sessionTimePoint") as HTMLInputElement;
        const now = new Date();
        timeInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        // 绑定模式切换事件
        const timeModeSelect = addDialog.element.querySelector("#timeMode") as HTMLSelectElement;
        const timeLabel = addDialog.element.querySelector("#timePointLabel") as HTMLElement;

        timeModeSelect.addEventListener("change", () => {
            if (timeModeSelect.value === 'end') {
                timeLabel.textContent = i18n("endTime") || "结束时间";
            } else {
                timeLabel.textContent = i18n("startTime") || "开始时间";
            }
        });

        // 类型选择改变时更新默认时长
        const typeSelect = addDialog.element.querySelector("#sessionType") as HTMLSelectElement;
        const durationInput = addDialog.element.querySelector("#sessionDuration") as HTMLInputElement;
        const countUpGroup = addDialog.element.querySelector("#countUpGroup") as HTMLDivElement;

        const isCountUpCheckbox = addDialog.element.querySelector("#sessionIsCountUp") as HTMLInputElement;

        const updateUIState = () => {
            const isWork = typeSelect.value === 'work';
            if (isWork) {
                countUpGroup.style.display = 'block';
            } else {
                countUpGroup.style.display = 'none';
            }
        };
        // Initialize
        updateUIState();

        typeSelect.addEventListener("change", () => {
            switch (typeSelect.value) {
                case "work":
                    durationInput.value = String(workDuration);
                    break;
                case "shortBreak":
                    durationInput.value = String(breakDuration);
                    break;
                case "longBreak":
                    durationInput.value = String(longBreakDuration);
                    break;
            }
            updateUIState();
        });

        isCountUpCheckbox.addEventListener("change", updateUIState);

        // 取消按钮
        addDialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => {
            addDialog.destroy();
        });

        // 确认按钮
        addDialog.element.querySelector("#confirmAddPomodoro")?.addEventListener("click", async () => {
            const type = (addDialog.element.querySelector("#sessionType") as HTMLSelectElement).value as 'work' | 'shortBreak' | 'longBreak';
            const timeMode = (addDialog.element.querySelector("#timeMode") as HTMLSelectElement).value;
            const timePointStr = (addDialog.element.querySelector("#sessionTimePoint") as HTMLInputElement).value;
            const duration = parseInt((addDialog.element.querySelector("#sessionDuration") as HTMLInputElement).value);
            const completed = true; // 强制为已完成
            const isCountUp = (addDialog.element.querySelector("#sessionIsCountUp") as HTMLInputElement).checked;

            if (!timePointStr || !duration || duration <= 0) {
                showMessage(i18n("pleaseEnterValidInfo") || "请输入有效信息", 3000, "error");
                return;
            }

            try {
                // 获取提醒信息
                const reminderData = await this.plugin.loadReminderData();
                let reminder = reminderData[this.reminderId];
                let eventTitle = reminder?.title;

                // 如果没有找到，可能是重复任务实例（ID格式: originalId_YYYY-MM-DD）
                if (!reminder && this.reminderId.includes('_')) {
                    const parts = this.reminderId.split('_');
                    const lastPart = parts[parts.length - 1];
                    // 检查是否是日期格式
                    if (/^\d{4}-\d{2}-\d{2}$/.test(lastPart)) {
                        const originalId = parts.slice(0, -1).join('_');
                        reminder = reminderData[originalId];
                        eventTitle = reminder?.title;
                    }
                }

                // 如果还是没有找到，使用默认标题
                if (!eventTitle) {
                    eventTitle = "未知任务";
                }

                // 计算开始和结束时间
                const timePoint = new Date(timePointStr);
                let startTime: Date;
                let endTime: Date;

                if (timeMode === 'end') {
                    endTime = timePoint;
                    startTime = new Date(endTime.getTime() - duration * 60000);
                } else {
                    startTime = timePoint;
                    endTime = new Date(startTime.getTime() + duration * 60000);
                }

                let count = 1;
                let plannedDuration = duration;

                if (type === 'work' && isCountUp) {
                    plannedDuration = workDuration; // 正计时模式下，计划时长为单位时长
                    count = Math.max(1, Math.round(duration / Math.max(1, plannedDuration)));
                }

                // 创建会话记录
                const session: PomodoroSession = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                    type,
                    eventId: this.reminderId,
                    eventTitle,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    duration,
                    plannedDuration,
                    completed,
                    isCountUp,
                    count
                };

                // 手动添加到记录中
                const { getLogicalDateString } = await import("../utils/dateUtils");
                const logicalDate = getLogicalDateString(startTime);

                // 获取或创建该日期的记录
                const records = (this.recordManager as any).records;
                if (!records[logicalDate]) {
                    records[logicalDate] = {
                        date: logicalDate,
                        workSessions: 0,
                        totalWorkTime: 0,
                        totalBreakTime: 0,
                        sessions: []
                    };
                }

                // 添加会话
                records[logicalDate].sessions.push(session);

                // 更新统计
                if (type === 'work') {
                    records[logicalDate].workSessions += this.recordManager.calculateSessionCount(session);
                    records[logicalDate].totalWorkTime += duration;
                } else {
                    records[logicalDate].totalBreakTime += duration;
                }

                // 保存记录
                await (this.recordManager as any).saveRecords();

                // 刷新统计索引
                this.recordManager.refreshIndex();

                showMessage("✅ " + (i18n("addPomodoroSuccess") || "补录番茄钟成功"), 3000, "info");

                addDialog.destroy();
                await this.loadSessions();
                await this.syncReminderPomodoroCount();
                this.renderSessions();

                // 触发reminderUpdated事件以更新界面
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                if (this.onUpdate) this.onUpdate();
            } catch (error) {
                console.error("补录番茄钟失败:", error);
                showMessage("❌ " + (i18n("addPomodoroFailed") || "补录番茄钟失败"), 3000, "error");
            }
        });
    }

    /**
     * 编辑番茄钟会话
     */
    private editSession(session: PomodoroSession) {
        if (!session) return;

        const editDialog = new Dialog({
            title: "✏️ " + (i18n("editPomodoro") || "编辑番茄钟"),
            content: `
                <div class="edit-pomodoro-dialog" style="padding: 16px;">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("sessionType") || "会话类型"}</label>
                        <select id="editSessionType" class="b3-select" style="width: 100%;">
                            <option value="work">🍅 工作番茄</option>
                            <option value="shortBreak">☕ 短休息</option>
                            <option value="longBreak">🌴 长休息</option>
                        </select>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("startTime") || "开始时间"}</label>
                        <input type="datetime-local" id="editSessionStartTime" class="b3-text-field" style="width: 100%;" required>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n("duration") || "持续时长"} (${i18n("minutes") || "分钟"})</label>
                        <input type="number" id="editSessionDuration" class="b3-text-field" min="1" style="width: 100%;" required>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="confirmEditPomodoro">${i18n("save")}</button>
                    </div>
                </div>
            `,
            width: "400px"
        });

        // 填充当前数据
        const typeSelect = editDialog.element.querySelector("#editSessionType") as HTMLSelectElement;
        const startTimeInput = editDialog.element.querySelector("#editSessionStartTime") as HTMLInputElement;
        const durationInput = editDialog.element.querySelector("#editSessionDuration") as HTMLInputElement;

        typeSelect.value = session.type;

        const startTime = new Date(session.startTime);
        startTimeInput.value = `${startTime.getFullYear()}-${String(startTime.getMonth() + 1).padStart(2, '0')}-${String(startTime.getDate()).padStart(2, '0')}T${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`;

        durationInput.value = session.duration.toString();

        // 取消按钮
        editDialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => {
            editDialog.destroy();
        });

        // 确认按钮
        editDialog.element.querySelector("#confirmEditPomodoro")?.addEventListener("click", async () => {
            const type = typeSelect.value as 'work' | 'shortBreak' | 'longBreak';
            const startTimeStr = startTimeInput.value;
            const duration = parseInt(durationInput.value);
            const completed = true; // 强制为已完成

            if (!startTimeStr || !duration || duration <= 0) {
                showMessage(i18n("pleaseEnterValidInfo") || "请输入有效信息", 3000, "error");
                return;
            }

            try {
                // 先删除旧会话
                await this.recordManager.deleteSession(session.id);

                // 创建新会话
                const reminderData = await this.plugin.loadReminderData();
                let reminder = reminderData[this.reminderId];
                let eventTitle = reminder?.title;

                // 如果没有找到，可能是重复任务实例（ID格式: originalId_YYYY-MM-DD）
                if (!reminder && this.reminderId.includes('_')) {
                    const parts = this.reminderId.split('_');
                    const lastPart = parts[parts.length - 1];
                    // 检查是否是日期格式
                    if (/^\d{4}-\d{2}-\d{2}$/.test(lastPart)) {
                        const originalId = parts.slice(0, -1).join('_');
                        reminder = reminderData[originalId];
                        eventTitle = reminder?.title;
                    }
                }

                // 如果还是没有找到，使用原会话的标题
                if (!eventTitle) {
                    eventTitle = session.eventTitle || "未知任务";
                }

                const startTime = new Date(startTimeStr);
                const endTime = new Date(startTime.getTime() + duration * 60000);

                const newSession: PomodoroSession = {
                    id: session.id, // 保持原ID
                    type,
                    eventId: this.reminderId,
                    eventTitle,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    duration,
                    plannedDuration: duration,
                    completed,
                    isCountUp: session.isCountUp, // 保留原有的计时属性
                    count: session.count // 保留原有的番茄数计数
                };

                // 如果修改了时长且是正计时/工作番茄，可能需要重新计算count
                if (newSession.type === 'work' && newSession.isCountUp && newSession.duration !== session.duration) {
                    // 简单重新计算：如果有plannedDuration则用，否则假设25
                    const base = session.plannedDuration || 25;
                    newSession.count = Math.max(1, Math.round(newSession.duration / Math.max(1, base)));
                }

                // 添加新会话
                const { getLogicalDateString } = await import("../utils/dateUtils");
                const logicalDate = getLogicalDateString(startTime);

                const records = (this.recordManager as any).records;
                if (!records[logicalDate]) {
                    records[logicalDate] = {
                        date: logicalDate,
                        workSessions: 0,
                        totalWorkTime: 0,
                        totalBreakTime: 0,
                        sessions: []
                    };
                }

                records[logicalDate].sessions.push(newSession);

                if (type === 'work') {
                    records[logicalDate].workSessions += this.recordManager.calculateSessionCount(newSession);
                    records[logicalDate].totalWorkTime += duration;
                } else {
                    records[logicalDate].totalBreakTime += duration;
                }

                await (this.recordManager as any).saveRecords();

                // 刷新统计索引
                this.recordManager.refreshIndex();

                showMessage("✅ " + (i18n("editPomodoroSuccess") || "修改番茄钟成功"), 3000, "info");

                editDialog.destroy();
                await this.loadSessions();
                await this.syncReminderPomodoroCount();
                this.renderSessions();

                // 触发reminderUpdated事件以更新界面
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                if (this.onUpdate) this.onUpdate();
            } catch (error) {
                console.error("修改番茄钟失败:", error);
                showMessage("❌ " + (i18n("editPomodoroFailed") || "修改番茄钟失败"), 3000, "error");
            }
        });
    }

    /**
     * 删除番茄钟会话
     */
    private async deleteSession(sessionId: string) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        confirm(
            "⚠️ " + (i18n("confirmDelete") || "确认删除"),
            `<div style="padding: 16px;">
                <p>${i18n("confirmDeletePomodoro") || "确定要删除这个番茄钟记录吗？"}</p>
                <p style="color: var(--b3-theme-on-surface-light); font-size: 12px;">
                    ${session.eventTitle} - ${new Date(session.startTime).toLocaleString(getLocaleTag())} (${session.duration}分钟)
                </p>
            </div>`,
            async (dialog) => {
                dialog.destroy();
                try {
                    const success = await this.recordManager.deleteSession(sessionId);

                    if (success) {
                        showMessage("✅ " + (i18n("deletePomodoroSuccess") || "删除番茄钟成功"), 3000, "info");
                        await this.loadSessions();
                        await this.syncReminderPomodoroCount();
                        this.renderSessions();

                        // 触发reminderUpdated事件以更新界面
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));

                        if (this.onUpdate) this.onUpdate();
                    } else {
                        showMessage("❌ " + (i18n("deletePomodoroFailed") || "删除番茄钟失败"), 3000, "error");
                    }
                } catch (error) {
                    console.error("删除番茄钟失败:", error);
                    showMessage("❌ " + (i18n("deletePomodoroFailed") || "删除番茄钟失败"), 3000, "error");
                }
            }
        );
    }


    /**
     * 同步提醒的番茄钟数量到 reminder.json
     */
    private async syncReminderPomodoroCount() {
        try {
            const reminderData = await this.plugin.loadReminderData();

            if (reminderData && reminderData[this.reminderId]) {
                const count = this.sessions.reduce((sum, s) => {
                    if (s.type === 'work') {
                        return sum + this.recordManager.calculateSessionCount(s);
                    }
                    return sum;
                }, 0);

                // 只有当数量不一致时才更新
                if (reminderData[this.reminderId].pomodoroCount !== count) {
                    reminderData[this.reminderId].pomodoroCount = count;
                    await this.plugin.saveReminderData(reminderData);
                }
            }
        } catch (error) {
            console.error("同步番茄钟数量失败:", error);
        }
    }
}
