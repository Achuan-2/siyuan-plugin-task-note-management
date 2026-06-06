import { Dialog } from "siyuan";
import { i18n } from "../../pluginInstance";
import { ProjectKanbanView } from "../ProjectKanbanView";
import { getAllReminders } from "../../utils/icsSubscription";

function parseTitle(title: string): { emoji: string; text: string } {
    if (!title) return { emoji: '', text: '' };
    const emojiRegex = /^([\u{1F1E6}-\u{1F1FF}]{2}|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic})*)/u;
    const match = title.match(emojiRegex);
    if (match) {
        const emoji = match[0];
        let text = title.slice(emoji.length);
        if (text.startsWith(' ')) {
            text = text.slice(1);
        }
        return { emoji, text };
    }
    return { emoji: '', text: title };
}

function collectFolderNodeProjects(node: any): any[] {
    const projects = [...node.projects];
    node.children.forEach((child: any) => {
        projects.push(...collectFolderNodeProjects(child));
    });
    return projects;
}

async function countProjectTotalPomodoro(plugin: any, projectId: string, reminderData: any): Promise<number> {
    const allReminders = reminderData && typeof reminderData === 'object' ? Object.values(reminderData) : [];
    let totalPomodoro = 0;
    try {
        const { PomodoroRecordManager } = await import("../../utils/pomodoroRecord");
        const pomodoroManager = PomodoroRecordManager.getInstance(plugin);
        const reminderMap = new Map(allReminders.map((r: any) => [r.id, r]));
        const topLevelReminders = allReminders.filter((r: any) => {
            if (!r || typeof r !== 'object') return false;
            if (r.projectId !== projectId) return false;
            if (!r.parentId) return true;
            return !reminderMap.has(r.parentId);
        });

        for (const r of topLevelReminders) {
            if (!r || typeof r !== 'object') continue;
            if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                totalPomodoro += await pomodoroManager.getAggregatedReminderPomodoroCount((r as any).id);
            } else if (typeof pomodoroManager.getReminderPomodoroCount === 'function') {
                totalPomodoro += await pomodoroManager.getReminderPomodoroCount((r as any).id);
            }
        }
    } catch (e) {
        console.warn('计算项目总番茄数失败，回退到直接累加:', e);
        allReminders.forEach((r: any) => {
            if (!r || typeof r !== 'object') return;
            if (r.projectId === projectId && r.pomodoroCount && typeof r.pomodoroCount === 'number') {
                totalPomodoro += r.pomodoroCount;
            }
        });
    }
    return totalPomodoro;
}

async function countProjectTotalFocusTime(plugin: any, projectId: string, reminderData: any): Promise<number> {
    let totalMinutes = 0;
    try {
        const { PomodoroRecordManager } = await import("../../utils/pomodoroRecord");
        const pomodoroManager = PomodoroRecordManager.getInstance(plugin);
        if (!pomodoroManager) return 0;
        if ((pomodoroManager as any).initialize && typeof (pomodoroManager as any).initialize === 'function') {
            await (pomodoroManager as any).initialize();
        }
        const ids = new Set<string>();
        Object.values(reminderData).forEach((r: any) => {
            if (r && r.projectId === projectId) {
                ids.add(r.id);
                if (r.repeat && r.repeat.instancePomodoroCount) {
                    Object.keys(r.repeat.instancePomodoroCount).forEach(k => ids.add(k));
                }
            }
        });

        for (const date in pomodoroManager['records']) {
            const record = pomodoroManager['records'][date];
            if (!record || !record.sessions) continue;
            for (const session of record.sessions) {
                if (session && session.type === 'work' && session.completed && ids.has(session.eventId)) {
                    totalMinutes += session.duration || 0;
                }
            }
        }
    } catch (e) {
        console.warn('计算项目总专注时长失败:', e);
    }
    return totalMinutes;
}

function renderStatsPanelHtml(totalTasks: number, totalPomodoro: number, focusTimeStr: string, statusRowsHtml: string) {
    return `
        <!-- Main Statistics Grid -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-bottom: 16px; flex-shrink: 0;">
            <!-- Card 1: Total Tasks -->
            <div style="background:var(--b3-theme-surface-lighter); padding:14px; border-radius:10px; border:1px solid var(--b3-border-color); display:flex; flex-direction:column; gap:4px; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
                <div style="font-size:11px; opacity:0.7; display:flex; align-items:center; gap:4px;">📋 任务总数</div>
                <div style="font-size:24px; font-weight:bold; color:var(--b3-theme-primary);">${totalTasks}</div>
            </div>
            <!-- Card 2: Total Pomodoros -->
            <div style="background:var(--b3-theme-surface-lighter); padding:14px; border-radius:10px; border:1px solid var(--b3-border-color); display:flex; flex-direction:column; gap:4px; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
                <div style="font-size:11px; opacity:0.7; display:flex; align-items:center; gap:4px;">🍅 番茄总数</div>
                <div style="font-size:24px; font-weight:bold; color:#e74c3c;">${totalPomodoro}</div>
            </div>
            <!-- Card 3: Total Focus Time -->
            <div style="background:var(--b3-theme-surface-lighter); padding:14px; border-radius:10px; border:1px solid var(--b3-border-color); display:flex; flex-direction:column; gap:4px; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
                <div style="font-size:11px; opacity:0.7; display:flex; align-items:center; gap:4px;">⏱ 专注时长</div>
                <div style="font-size:18px; font-weight:bold; color:#28a745; line-height:28px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${focusTimeStr}">${focusTimeStr}</div>
            </div>
        </div>

        <!-- Status Distribution Section -->
        <div style="background:var(--b3-theme-surface-lighter); padding:16px; border-radius:12px; border:1px solid var(--b3-border-color); display:flex; flex-direction:column; gap:12px; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
            <div style="font-size:14px; font-weight:600; border-bottom:1px solid var(--b3-border-color); padding-bottom:8px; display:flex; align-items:center; gap:6px;">📊 状态分布</div>
            <div style="display:flex; flex-direction:column; gap:4px;">
                ${statusRowsHtml}
            </div>
        </div>
    `;
}

export function showProjectStatsDialog(plugin: any, project: any, reminderDataCache?: any) {
    const parsed = parseTitle(project.title || '');
    showStatsDialogForProjects(
        plugin,
        parsed.emoji || "🎯",
        parsed.text || i18n("unnamedNote") || '未命名项目',
        "项目统计数据",
        [project],
        'project',
        reminderDataCache
    );
}

export function showFolderStatsDialog(plugin: any, folder: any, node: any, reminderDataCache?: any) {
    const projects = collectFolderNodeProjects(node).filter(p => p?.id);
    showStatsDialogForProjects(
        plugin,
        folder.icon || "📂",
        folder.name || "未命名文件夹",
        `文件夹统计数据 • 包含 ${projects.length} 个项目`,
        projects,
        'folder',
        reminderDataCache
    );
}

export async function showStatsDialogForProjects(plugin: any, titleIcon: string, titleText: string, subtitleText: string, projects: any[], targetType: 'project' | 'folder', reminderDataCache?: any) {
    const dialog = new Dialog({
        title: i18n("statsView") || "统计视图",
        content: `
            <div id="statsDialogBody" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:300px; padding:16px; gap:12px; color:var(--b3-theme-on-surface); box-sizing:border-box;">
                <div style="width:36px; height:36px; border:3px solid var(--b3-theme-primary-lighter); border-top-color:var(--b3-theme-primary); border-radius:50%; animation: stats-spin 1s linear infinite;"></div>
                <div style="font-size:13px; opacity:0.8;">正在计算统计数据...</div>
                <style>
                    @keyframes stats-spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </div>
        `,
        width: targetType === 'folder' ? "640px" : "480px",
        height: targetType === 'folder' ? "600px" : "520px"
    });

    const bodyEl = dialog.element.querySelector("#statsDialogBody") as HTMLElement;

    try {
        let reminderData = reminderDataCache;
        if (!reminderData) {
            reminderData = await getAllReminders(plugin);
        }

        const { ProjectManager } = await import("../../utils/projectManager");
        const projectManager = ProjectManager.getInstance(plugin);
        const settings = await plugin?.loadSettings?.() || plugin?.settings || {};
        const holidayData = await plugin?.loadHolidayData?.() || {};

        // 收集项目的自定义分组
        let projectGroups: any[] = [];
        let existingGroupIds = new Set<string>();
        if (targetType === 'project' && projects.length === 1) {
            projectGroups = await projectManager.getProjectCustomGroups(projects[0].id);
            existingGroupIds = new Set(projectGroups.map(g => g.id));
        }

        // 辅助函数：根据提醒数据计算并渲染单块统计面板 HTML
        const calculateStatsAndRender = async (rData: any) => {
            const aggregatedStatusCounts: Record<string, number> = {};
            const statusInfoMap = new Map<string, { name: string, icon: string }>();

            statusInfoMap.set('doing', { name: i18n("doing") || '进行中', icon: '🏃' });
            statusInfoMap.set('short_term', { name: i18n("shortTerm") || '短期', icon: '📅' });
            statusInfoMap.set('long_term', { name: i18n("longTerm") || '长期', icon: '⏳' });
            statusInfoMap.set('completed', { name: i18n("done") || '已完成', icon: '✅' });
            statusInfoMap.set('abandoned', { name: i18n("abandoned") || '放弃', icon: '❌' });

            let totalPomodoro = 0;
            let totalFocus = 0;

            for (const project of projects) {
                const statuses = await projectManager.getProjectKanbanStatuses(project.id);
                const result = ProjectKanbanView.countTopLevelTasksByStatus(project.id, rData, statuses, settings, holidayData);
                const countsMap = result.counts || {};
                const completedCount = result.completed || (countsMap['completed'] || 0);
                countsMap['completed'] = completedCount;

                if (statuses && Array.isArray(statuses)) {
                    statuses.forEach(s => {
                        if (!statusInfoMap.has(s.id)) {
                            statusInfoMap.set(s.id, { name: s.name || s.id, icon: s.icon || '' });
                        }
                    });
                }

                Object.entries(countsMap).forEach(([statusId, count]) => {
                    aggregatedStatusCounts[statusId] = (aggregatedStatusCounts[statusId] || 0) + (count as number);
                });

                const pPomodoros = await countProjectTotalPomodoro(plugin, project.id, rData);
                const pFocus = await countProjectTotalFocusTime(plugin, project.id, rData);
                totalPomodoro += pPomodoros;
                totalFocus += pFocus;
            }

            const totalTasks = Object.entries(aggregatedStatusCounts).reduce((sum, [statusId, count]) => {
                return sum + count;
            }, 0);

            const formatMinutes = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                return hours > 0 ? `${hours}小时${mins}分钟` : `${mins}分钟`;
            };

            const focusTimeStr = totalFocus > 0 ? formatMinutes(totalFocus) : '0分钟';

            let statusRowsHtml = '';
            const allStatusKeys = Array.from(statusInfoMap.keys());
            allStatusKeys.forEach(statusId => {
                const count = aggregatedStatusCounts[statusId] || 0;
                if (count === 0 && statusId !== 'completed' && statusId !== 'doing') return;

                const info = statusInfoMap.get(statusId) || { name: statusId, icon: '' };
                const percentage = totalTasks === 0 ? 0 : Math.round((count / totalTasks) * 100);

                let barColor = 'var(--b3-theme-primary)';
                if (statusId === 'completed') barColor = '#28a745';
                else if (statusId === 'doing') barColor = 'var(--b3-theme-primary)';
                else if (statusId === 'short_term') barColor = 'var(--b3-theme-warning)';
                else if (statusId === 'long_term') barColor = 'var(--b3-theme-info)';
                else if (statusId === 'abandoned') barColor = '#808080';

                statusRowsHtml += `
                    <div style="display:flex; flex-direction:column; gap:4px; margin-bottom: 8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
                            <span style="display:flex; align-items:center; gap:6px;">
                                <span style="font-size:14px;">${info.icon || '📝'}</span>
                                <span style="font-weight: 500;">${info.name}</span>
                            </span>
                            <span style="font-weight:500; opacity: 0.9;">${count}个 (${percentage}%)</span>
                        </div>
                        <div style="width:100%; height:8px; background:rgba(0,0,0,0.05); border-radius:4px; overflow:hidden;">
                            <div style="width:${percentage}%; height:100%; background:${barColor}; border-radius:4px; transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                `;
            });

            return renderStatsPanelHtml(totalTasks, totalPomodoro, focusTimeStr, statusRowsHtml);
        };

        // 构建各项目明细 HTML (仅限文件夹)
        let projectBreakdownHtml = '';
        if (targetType === 'folder') {
            const projectDetails: any[] = [];
            for (const project of projects) {
                const statuses = await projectManager.getProjectKanbanStatuses(project.id);
                const result = ProjectKanbanView.countTopLevelTasksByStatus(project.id, reminderData, statuses, settings, holidayData);
                const countsMap = result.counts || {};
                countsMap['completed'] = result.completed || (countsMap['completed'] || 0);

                const pPomodoros = await countProjectTotalPomodoro(plugin, project.id, reminderData);
                const pFocus = await countProjectTotalFocusTime(plugin, project.id, reminderData);

                projectDetails.push({ project, counts: countsMap, totalPomodoro: pPomodoros, totalFocus: pFocus });
            }

            if (projectDetails.length > 0) {
                let projectRows = '';
                projectDetails.forEach((projInfo: any) => {
                    const { project, counts, totalPomodoro: pPomo, totalFocus: pFoc } = projInfo;
                    const parsedTitle = parseTitle(project.title || '');
                    const pTitle = parsedTitle.text || i18n("unnamedNote") || '未命名项目';
                    const pEmoji = parsedTitle.emoji || '';
                    const pColor = project.color || '#cccccc';
                    const pDone = counts['completed'] || 0;
                    const pTotal = Object.values(counts).reduce((a, b) => (a as number) + (b as number), 0) as number;

                    projectRows += `
                        <tr style="border-bottom:1px solid rgba(0,0,0,0.04); font-size:13px;">
                            <td style="padding:10px 6px; display:flex; align-items:center; gap:8px; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                <span style="width:8px; height:8px; border-radius:50%; background-color:${pColor}; flex-shrink:0; display:inline-block;"></span>
                                ${pEmoji ? `<span style="font-size:14px; flex-shrink:0;">${pEmoji}</span>` : ''}
                                <span style="font-weight:500;" title="${pTitle}">${pTitle}</span>
                            </td>
                            <td style="padding:10px 6px; text-align:center; font-weight:500; color:var(--b3-theme-on-surface);">
                                ${pDone} / ${pTotal}
                            </td>
                            <td style="padding:10px 6px; text-align:center; color:#e74c3c; font-weight:500;">
                                🍅 ${pPomo}
                            </td>
                            <td style="padding:10px 6px; text-align:right; color:#28a745; font-size:12px; font-weight:500;">
                                ${pFoc > 0 ? pFoc + '分钟' : '-'}
                            </td>
                        </tr>
                    `;
                });

                projectBreakdownHtml = `
                    <div style="background:var(--b3-theme-surface-lighter); padding:16px; border-radius:12px; border:1px solid var(--b3-border-color); display:flex; flex-direction:column; gap:12px; margin-top: 4px;">
                        <div style="font-size:14px; font-weight:600; border-bottom:1px solid var(--b3-border-color); padding-bottom:8px; display:flex; align-items:center; gap:6px;">📂 项目明细 (${projectDetails.length} 个项目)</div>
                        <div style="overflow-y:auto; max-height:220px; width:100%; border-radius: 4px;">
                            <table style="width:100%; border-collapse:collapse; text-align:left;">
                                <thead>
                                    <tr style="border-bottom:1px solid var(--b3-border-color); font-size:12px; opacity:0.7;">
                                        <th style="padding:6px; font-weight:500;">项目名称</th>
                                        <th style="padding:6px; font-weight:500; text-align:center;">任务 (已完成/总数)</th>
                                        <th style="padding:6px; font-weight:500; text-align:center;">番茄数</th>
                                        <th style="padding:6px; font-weight:500; text-align:right;">专注时长</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${projectRows}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
        }

        // 构建分栏标签页 HTML
        let tabHeadersHtml = '';
        let tabContentsHtml = '';

        if (targetType === 'project' && projectGroups.length > 0) {
            tabHeadersHtml = `
                <div class="stats-tabs-header" style="display: flex; gap: 8px; border-bottom: 1px solid var(--b3-border-color); padding-bottom: 8px; margin-bottom: 12px; overflow-x: auto; flex-shrink: 0;">
                    <button class="stats-tab-btn active" data-tab="summary" style="padding: 6px 12px; border: none; background: transparent; border-bottom: 2px solid var(--b3-theme-primary); color: var(--b3-theme-primary); font-weight: 600; cursor: pointer; white-space: nowrap; font-size: 13px; outline: none; transition: all 0.2s;">汇总</button>
            `;

            const summaryStatsHtml = await calculateStatsAndRender(reminderData);
            tabContentsHtml = `
                <div class="stats-tab-content" id="tab-content-summary" style="display: block;">
                    ${summaryStatsHtml}
                </div>
            `;

            for (const g of projectGroups) {
                const groupReminderData: Record<string, any> = {};
                Object.entries(reminderData).forEach(([key, r]: [string, any]) => {
                    if (r && r.customGroupId === g.id && r.projectId === projects[0].id) {
                        groupReminderData[key] = r;
                    }
                });

                tabHeadersHtml += `
                    <button class="stats-tab-btn" data-tab="group-${g.id}" style="padding: 6px 12px; border: none; background: transparent; border-bottom: 2px solid transparent; color: var(--b3-theme-on-surface); opacity: 0.7; cursor: pointer; white-space: nowrap; font-size: 13px; outline: none; transition: all 0.2s;">${g.name}</button>
                `;

                const groupStatsHtml = await calculateStatsAndRender(groupReminderData);
                tabContentsHtml += `
                    <div class="stats-tab-content" id="tab-content-group-${g.id}" style="display: none;">
                        ${groupStatsHtml}
                    </div>
                `;
            }

            const ungroupedReminderData: Record<string, any> = {};
            Object.entries(reminderData).forEach(([key, r]: [string, any]) => {
                const isUngrouped = !r.customGroupId || !existingGroupIds.has(r.customGroupId);
                if (isUngrouped && r.projectId === projects[0].id) {
                    ungroupedReminderData[key] = r;
                }
            });

            const ungroupedTaskCount = Object.keys(ungroupedReminderData).length;
            if (ungroupedTaskCount > 0) {
                tabHeadersHtml += `
                    <button class="stats-tab-btn" data-tab="group-ungrouped" style="padding: 6px 12px; border: none; background: transparent; border-bottom: 2px solid transparent; color: var(--b3-theme-on-surface); opacity: 0.7; cursor: pointer; white-space: nowrap; font-size: 13px; outline: none; transition: all 0.2s;">未分组</button>
                `;

                const ungroupedStatsHtml = await calculateStatsAndRender(ungroupedReminderData);
                tabContentsHtml += `
                    <div class="stats-tab-content" id="tab-content-group-ungrouped" style="display: none;">
                        ${ungroupedStatsHtml}
                    </div>
                `;
            }

            tabHeadersHtml += `</div>`;
        } else {
            const summaryStatsHtml = await calculateStatsAndRender(reminderData);
            tabContentsHtml = summaryStatsHtml;
        }

        bodyEl.style.display = 'flex';
        bodyEl.style.flexDirection = 'column';
        bodyEl.style.gap = '16px';
        bodyEl.style.padding = '16px';
        bodyEl.style.height = '100%';
        bodyEl.style.justifyContent = 'flex-start';
        bodyEl.style.alignItems = 'stretch';
        bodyEl.style.overflowY = 'auto';

        bodyEl.innerHTML = `
            <!-- Header Card with Gradient -->
            <div class="stats-header-card" style="
                background: linear-gradient(135deg, var(--b3-theme-primary) 0%, color-mix(in srgb, var(--b3-theme-primary), #a855f7 30%) 100%);
                color: #fff;
                padding: 20px;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                display: flex;
                flex-direction: column;
                gap: 6px;
                flex-shrink: 0;
                margin-bottom: 4px;
            ">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span style="font-size: 20px;">${titleIcon}</span>
                    <span>${titleText}</span>
                </div>
                <div style="font-size:13px; opacity:0.85;">
                    ${subtitleText}
                </div>
            </div>

            <!-- Tabs Header (if project has groups) -->
            ${tabHeadersHtml}

            <!-- Tab Contents or normal layout -->
            ${tabContentsHtml}

            <!-- Project Breakdown Section -->
            ${projectBreakdownHtml}
        `;

        // 绑定 Tab 切换点击事件
        if (targetType === 'project' && projectGroups.length > 0) {
            const tabButtons = dialog.element.querySelectorAll(".stats-tab-btn") as NodeListOf<HTMLButtonElement>;
            tabButtons.forEach(btn => {
                btn.addEventListener("click", () => {
                    tabButtons.forEach(b => {
                        b.classList.remove("active");
                        b.style.borderBottomColor = "transparent";
                        b.style.color = "var(--b3-theme-on-surface)";
                        b.style.opacity = "0.7";
                        b.style.fontWeight = "normal";
                    });

                    btn.classList.add("active");
                    btn.style.borderBottomColor = "var(--b3-theme-primary)";
                    btn.style.color = "var(--b3-theme-primary)";
                    btn.style.opacity = "1";
                    btn.style.fontWeight = "600";

                    const contents = dialog.element.querySelectorAll(".stats-tab-content") as NodeListOf<HTMLElement>;
                    contents.forEach(content => content.style.display = "none");

                    const tabId = btn.getAttribute("data-tab");
                    const activeContent = dialog.element.querySelector(`#tab-content-${tabId}`) as HTMLElement;
                    if (activeContent) activeContent.style.display = "block";
                });
            });
        }
    } catch (error) {
        console.error("计算统计数据出错:", error);
        bodyEl.innerHTML = `
            <div style="color:var(--b3-theme-error); display:flex; flex-direction:column; align-items:center; gap:8px;">
                <span style="font-size: 24px;">⚠️</span>
                <span>加载统计数据失败</span>
            </div>
        `;
    }
}
