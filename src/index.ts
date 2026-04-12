import {
    Plugin,
    getActiveEditor,
    showMessage,
    confirm,
    Dialog,
    openTab,
    getFrontend,
    getBackend,
} from "siyuan";
import { VipManager } from "./utils/vip";
import "./index.scss";

import { QuickReminderDialog } from "./components/QuickReminderDialog";
import { ReminderPanel } from "./components/ReminderPanel";
import { HabitPanel } from "./components/HabitPanel";
import { BatchReminderDialog } from "./components/BatchReminderDialog";
import { CalendarView } from "./components/CalendarView";
import { EisenhowerMatrixView } from "./components/EisenhowerMatrixView";
import { CategoryManager } from "./utils/categoryManager";
import { readDir } from "./api";
import { getLocalTimeString, getLocalDateString, getLocalDateTimeString, compareDateStrings, getLogicalDateString, setDayStartTime } from "./utils/dateUtils";
import { i18n, setPluginInstance } from "./pluginInstance";
import { SettingUtils } from "./libs/setting-utils";
import { PomodoroRecordManager } from "./utils/pomodoroRecord";
import { NotificationDialog } from "./components/NotificationDialog";
import { DocumentReminderDialog } from "./components/DocumentReminderDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { ProjectPanel } from "./components/ProjectPanel";
import { ProjectKanbanView } from "./components/ProjectKanbanView";
import { PomodoroManager } from "./utils/pomodoroManager";
import SettingPanelComponent from "./SettingPanel.svelte";
import { exportIcsFile } from "./utils/icsUtils";
import { getFile, sendNotification, cancelNotification, pushErrMsg, pushMsg, isInMobileApp } from "./api";
import { resolveAudioPath } from "./utils/audioUtils";
import { showVipDialog } from "./components/VipDialog";
import { performDataMigration } from "./utils/dataMigration";
import { initIcsSync, initIcsSubscriptionSync, handleIcsSyncSettingsChange, cleanupIcsSync } from "./utils/icsSync";
import { TaskNoteDOMManager } from "./utils/taskNoteDOM";
import { addDaysToDate, generateRepeatInstances, getDaysDifference, getRelativeReminderWindow } from "./utils/repeatUtils";
import { getDockItemSelector, setDockBadgeByType as applyDockBadgeByType } from "./utils/addDockBadge";
import {
    Habit,
    HabitEmojiConfig,
    getHabitGoalType,
    getHabitPomodoroTargetMinutes,
    getHabitReminderTimes,
    getTodayHabitBuckets,
    isHabitCompletedOnDate as isHabitCompletedOnDateUtil,
    shouldCheckInOnDate
} from "./utils/habitUtils";
import {
    buildLinkedHabitPomodoroData,
    getLinkedTaskPomodoroStatsByDate as getLinkedTaskPomodoroStatsByDateUtil
} from "./utils/linkedHabitPomodoro";
import { ChangelogUtils } from "./utils/changelogNotify";
import { createPomodoroStartSubmenu as createSharedPomodoroStartSubmenu } from "./utils/pomodoroPresets";


export const SETTINGS_FILE = "reminder-settings.json";
export const PROJECT_DATA_FILE = "project.json";
export const CATEGORIES_DATA_FILE = "categories.json";
export const REMINDER_DATA_FILE = "reminder.json";
export const HABIT_DATA_FILE = "habit.json";
export const HABIT_CHECKIN_DIR = "habitCheckin";
export const NOTIFY_DATA_FILE = "notify.json";
export const POMODORO_RECORD_DATA_FILE = "pomodoro_record.json";
export const POMODORO_RECORD_DIR = "pomodoroRecords";
export const HABIT_GROUP_DATA_FILE = "habitGroup.json";
export const STATUSES_DATA_FILE = "statuses.json";
export const HOLIDAY_DATA_FILE = "holiday.json";
export const LICENSE_DATA_FILE = "license.json";

const HABIT_CHECKIN_DATA_KEYS = ["checkIns", "hasNotify", "totalCheckIns"] as const;
const POMODORO_TARGET_AUTO_CHECKIN_MEANING = "番茄达标自动补录";
const POMODORO_PER_SESSION_AUTO_CHECKIN_MEANING = "自动番茄打卡";

export interface AudioFileItem {
    path: string;
    removed?: boolean;
    replaces?: string; // 记录此项替换了哪个原始路径（用于保持排序）
}

export { exportIcsFile };



const TAB_TYPE = "reminder_calendar_tab";
const EISENHOWER_TAB_TYPE = "reminder_eisenhower_tab";
export const PROJECT_KANBAN_TAB_TYPE = "project_kanban_tab";
const POMODORO_TAB_TYPE = "pomodoro_timer_tab";
export const STORAGE_NAME = "siyuan-plugin-task-note-management";

export interface BoundReminderDateDisplayInfo {
    reminderId: string;
    displayText: string;
    displayType: "schedule" | "completed";
}


// 默认设置
export const DEFAULT_SETTINGS = {
    // 任务笔记设置
    autoDetectDateTime: false, // 新增：是否自动识别日期时间
    removeDateAfterDetection: 'all', // 从bool改为option：'none' | 'date' | 'all'
    newDocNotebook: '', // 新增：新建文档的笔记本ID
    newDocPath: '/{{now | date "2006/200601"}}/', // 新增：新建文档的路径模板，支持sprig语法
    groupDefaultHeadingLevel: 1, // 新增：新建标题分组的默认层级（1-6），默认为1级标题
    milestoneDefaultHeadingLevel: 2, // 新增：新建标题里程碑的默认层级（1-6），默认为2级标题
    defaultHeadingLevel: 3, // 新增：新建标题的默认层级（1-6），默认为3级标题
    defaultHeadingPosition: 'prepend', // 新增：新建标题的默认位置（'prepend' | 'append'），默认为最前
    enableOutlinePrefix: true, // 是否在大纲中为绑定标题添加任务状态前缀

    // 控制侧边栏显示
    enableReminderDock: true, // 侧边栏：提醒（任务管理）
    enableProjectDock: true, // 侧边栏：项目管理
    enableHabitDock: true, // 侧边栏：习惯管理
    enableCalendarDock: true, // 侧边栏：日历视图
    // 停靠栏徽章显示控制
    enableDockBadge: true, // 是否在停靠栏显示数字徽章
    // 单独控制每个侧栏是否显示徽章（优先级高于 enableDockBadge）
    enableReminderDockBadge: true,
    enableProjectDockBadge: true,
    enableHabitDockBadge: true,

    // 日历配置
    calendarShowCategoryAndProject: false, // 是否显示分类图标和项目信息
    calendarColorBy: 'priority',
    calendarViewMode: 'timeGridWeek',
    dayStartTime: '08:00', // 日历视图一天的起始时间
    todayStartTime: '03:00', // 日常任务/习惯的一天起始时间
    calendarShowLunar: (window as any).siyuan?.config?.lang === 'zh_CN' ? true : false, // 日历显示农历
    calendarShowHoliday: true, // 是否显示节假日
    calendarShowPomodoro: true, // 是否显示番茄专注时间
    showCalendarEventCheckbox: true, // 是否显示日历事件前的复选框
    calendarHolidayIcsUrl: 'https://www.shuyz.com/githubfiles/china-holiday-calender/master/holidayCal.ics?token=cb429c2a-81a6-4c26-8f35-4f4bf0c84b2c&compStart=*&compEnd=*', // 节假日ICS URL
    calendarMultiDaysCount: 3, // 多天视图默认显示天数
    weekStartDay: 1, // 新增：周视图的一周开始日 (0=周日, 1=周一，默认周一)
    // 日历摘要设置
    showPomodoroInSummary: true,
    showHabitInSummary: true,
    showTaskNotesInSummary: false,
    // 任务管理侧栏排序配置
    sortMethod: "priority",
    sortOrder: "desc",
    // 四象限设置
    eisenhowerImportanceThreshold: 'medium',
    eisenhowerUrgencyDays: 3,
    eisenhowerStatusFilters: [] as string[],
    eisenhowerProjectFilters: [] as string[],
    eisenhowerKanbanStatusFilter: 'doing',
    // 项目排序配置
    projectSortOrder: [],
    projectSortMode: 'custom',
    // 全局项目默认看板状态配置（为空时使用内置默认状态）
    globalKanbanStatuses: [] as Array<{
        id: string;
        name: string;
        color: string;
        icon?: string;
        isFixed: boolean;
        sort: number;
    }>,
    // 项目面板筛选与排序
    projectPanelSort: 'priority',
    projectPanelSortOrder: 'desc',
    projectPanelShowOnlyDoing: false,
    projectPanelSelectedCategories: [] as string[],
    reminderPanelSelectedCategories: [] as string[],
    // 习惯面板筛选与排序
    habitPanelSortKey: 'priority',
    habitPanelSortOrder: 'desc',
    habitPanelSelectedGroups: [] as string[],
    // 日历上传：ICS云端同步配置
    icsSyncInterval: 'daily', // 'manual' | '15min' | 'hourly' | '4hour' | '12hour' | 'daily' | 'dailyAt'
    icsDailySyncTime: '08:00', // 每天同步时间点（当 syncInterval 为 'dailyAt' 时使用），格式 HH:MM
    icsCloudUrl: '',
    icsLastSyncAt: '', // 上一次上传时间
    icsSyncEnabled: false, // 是否启用ICS云端同步
    icsFileName: '', // ICS文件名，默认为空时自动生成
    icsSilentUpload: false, // 是否静默上传ICS文件，不显示成功提示
    icsTaskFilter: 'all', // 'all' | 'completed' | 'uncompleted' - 任务筛选
    // ICS 同步方式配置
    icsSyncMethod: 'siyuan', // 'siyuan' | 's3' | 'webdav' - 同步方式
    // WebDAV 配置
    webdavUrl: '',
    webdavUsername: '',
    webdavPassword: '',
    // S3 配置
    s3UseSiyuanConfig: false, // 是否使用思源的S3配置
    s3Bucket: '',
    s3Endpoint: '',
    s3Region: 'auto', // S3 区域，默认为 auto
    s3AccessKeyId: '',
    s3AccessKeySecret: '',
    s3StoragePath: '/calendar/', // S3存储路径，例如: /calendar/
    s3ForcePathStyle: false, // S3 Addressing风格，true为Path-style，false为Virtual hosted style（默认）
    s3TlsVerify: true, // S3 TLS证书验证，true为启用验证（默认），false为禁用验证
    s3CustomDomain: '', // S3 自定义域名，用于生成外链


    // 番茄钟
    dailyFocusGoal: 6,
    workVolume: 0.5,
    breakVolume: 0.5,
    longBreakVolume: 0.5,
    workEndVolume: 0.5,
    breakEndVolume: 0.5,
    randomRestVolume: 0.5,
    randomRestEndVolume: 0.5,
    pomodoroWorkDuration: 45,
    pomodoroDurationPresets: [5, 10, 15, 25],
    pomodoroBreakDuration: 10,
    pomodoroLongBreakDuration: 30,
    pomodoroLongBreakInterval: 4,
    pomodoroAutoMode: false,
    pomodoroSystemNotification: true, // 新增：番茄结束后系统弹窗
    pomodoroEndPopupWindow: true, // 新增：番茄钟结束弹窗提醒，默认关闭
    pomodoroDockPosition: 'top', // 新增：番茄钟吸附位置 'right' | 'left' | 'top'
    reminderSystemNotification: true, // 新增：事件到期提醒系统弹窗
    showInternalNotification: false, // 新增：是否显示内部通知框
    dailyNotificationTime: '08:00', // 新增：每日通知时间，默认08:00
    dailyNotificationEnabled: false, // 新增：是否启用每日统一通知
    randomRestEnabled: false,
    randomRestMinInterval: 3,
    randomRestMaxInterval: 5,
    randomRestBreakDuration: 10,
    randomRestSystemNotification: true, // 新增：随机微休息系统通知
    randomRestPopupWindow: true, // 新增：随机微休息弹窗提醒，默认关闭
    // 每个声音设置项各自的音频文件列表 { settingKey: [{path: url, removed: false}, ...] }
    audioFileLists: {
        notificationSound: [{ path: '/plugins/siyuan-plugin-task-note-management/audios/notify.mp3' }],
        pomodoroWorkSound: [
            { path: '/plugins/siyuan-plugin-task-note-management/audios/background_music.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/nature/campfire.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/nature/river.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/animals/crickets.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/animals/birds.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/places/library.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/places/office.mp3' }

        ],
        pomodoroBreakSound: [
            { path: '/plugins/siyuan-plugin-task-note-management/audios/relax_background.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/nature/droplets.mp3' }
        ],
        pomodoroLongBreakSound: [
            { path: '/plugins/siyuan-plugin-task-note-management/audios/relax_background.mp3' },
            { path: 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/nature/droplets.mp3' }
        ],
        pomodoroWorkEndSound: [{ path: '/plugins/siyuan-plugin-task-note-management/audios/work_end.mp3' }],
        pomodoroBreakEndSound: [{ path: '/plugins/siyuan-plugin-task-note-management/audios/end_music.mp3' }],
        randomRestSounds: [{ path: '/plugins/siyuan-plugin-task-note-management/audios/random_start.mp3' }],
        randomRestEndSound: [{ path: '/plugins/siyuan-plugin-task-note-management/audios/random_end.mp3' }],
    } as Record<string, AudioFileItem[]>,
    // 每个声音设置项当前的选中项 { settingKey: url }
    audioSelected: {
        notificationSound: '/plugins/siyuan-plugin-task-note-management/audios/notify.mp3',
        pomodoroWorkSound: '/plugins/siyuan-plugin-task-note-management/audios/background_music.mp3',
        pomodoroBreakSound: '/plugins/siyuan-plugin-task-note-management/audios/relax_background.mp3',
        pomodoroLongBreakSound: '/plugins/siyuan-plugin-task-note-management/audios/relax_background.mp3',
        pomodoroWorkEndSound: '/plugins/siyuan-plugin-task-note-management/audios/work_end.mp3',
        pomodoroBreakEndSound: '/plugins/siyuan-plugin-task-note-management/audios/end_music.mp3',
        randomRestSounds: '/plugins/siyuan-plugin-task-note-management/audios/random_start.mp3',
        randomRestEndSound: '/plugins/siyuan-plugin-task-note-management/audios/random_end.mp3',
    } as Record<string, string>,
    // 数据迁移标记
    datatransfer: {
        bindblockAddAttr: false, // 是否已迁移绑定块的 custom-bind-reminders 属性
        termTypeTransfer: false, // 是否已迁移 termType -> kanbanStatus 的转换
        audioFileTransfer: false, // 是否已迁移音频文件列表
        habitCheckinTransfer: false,
        pomodoroRecordTransfer: false,
    },
};

export default class ReminderPlugin extends Plugin {
    private reminderPanel: ReminderPanel;
    private tabViews: Map<string, any> = new Map(); // 存储所有Tab视图实例（日历、四象限、项目看板、番茄钟等）
    private registeredDockKeys: Set<string> = new Set(); // 记录已注册的 Dock，避免对未注册项执行可见性切换
    private categoryManager: CategoryManager;
    private settingUtils: SettingUtils;
    private chronoParser: any;
    private batchReminderDialog: BatchReminderDialog;
    private audioEnabled: boolean = false;
    private preloadedAudio: HTMLAudioElement | null = null;
    // Guard to prevent overlapping notification sounds
    private isPlayingNotificationSound: boolean = false;
    private projectPanel: ProjectPanel;
    private projectDockElement: HTMLElement;
    private taskNoteDOM: TaskNoteDOMManager;

    // ICS 云端同步相关
    // ICS 订阅同步相关
    private reminderCheckTimer: number | null = null;
    private currentLogicalDate: string = '';

    // 缓存上一次的番茄钟设置，用于比较变更
    private lastPomodoroSettings: any = null;

    private reminderDataCache: any = null;
    private projectDataCache: any = null;
    private statusDataCache: any = null;
    private categoriesDataCache: any = null;
    private habitDataCache: any = null;
    private habitGroupDataCache: any = null;
    private subscriptionCache: any = null;
    private subscriptionTasksCache: { [id: string]: any } = {};
    private holidayDataCache: any = null;
    private pomodoroRecordsCache: any = null;
    private notifyDataCache: {
        lastNotified?: string,
        notifiedKeys?: Record<string, boolean>,
        // 废弃，保留用于兼容迁移
        mobileNotifications?: Record<string, Record<string, number[]>>,
        // 习惯系统通知ID（按设备隔离）
        habit?: Record<string, Record<string, number[]>>
    } | null = null;
    private mobileNotifyDataCacheForCurrentDevice: Record<string, number[]> | null = null;
    // 仅内存缓存（当前设备实例）：任务id -> 未来提醒时间(ISO)数组
    private mobileNotificationPlansCache: Record<string, string[]> | null = null;
    private mobileHabitNotificationPlansCache: Record<string, string[]> | null = null;
    private cleanupFunctions: (() => void)[] = [];

    // 内存中的提醒记录，用于避免同一会话中重复提醒
    // 格式: "reminderId_date_time" -> true
    private notifiedReminders: Map<string, boolean> = new Map();
    // 格式: "habitId_date_time" -> true
    private notifiedHabits: Map<string, boolean> = new Map();
    private habitPomodoroAutoSyncTimer: number | null = null;

    private instanceId: string = Math.random().toString(36).substring(2, 11);
    private coordinatorChannel: BroadcastChannel;

    public settings: any;
    public vip: any = { vipKeys: [], isVip: false, expireDate: '', freeTrialUsed: false };
    public isInMobileApp: boolean = false; // 是否在移动端（手机或平板）运行

    public getWorkspaceDir(): string {
        return (window as any).siyuan?.config?.system?.workspaceDir || "";
    }

    private getWorkspaceScopedChannelName(baseName: string): string {
        const workspaceDir = this.getWorkspaceDir();
        if (!workspaceDir) {
            return baseName;
        }

        let hash = 0;
        for (let i = 0; i < workspaceDir.length; i++) {
            hash = ((hash << 5) - hash) + workspaceDir.charCodeAt(i);
            hash |= 0;
        }

        return `${baseName}-${Math.abs(hash).toString(36)}`;
    }

    /**
     * 加载提醒数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadReminderData(update: boolean = false): Promise<any> {
        if (update || !this.reminderDataCache) {
            try {
                const data = await this.loadData(REMINDER_DATA_FILE);
                this.reminderDataCache = data || {};
            } catch (error) {
                console.error('Failed to load reminder data:', error);
                this.reminderDataCache = {};
            }
        }
        return this.reminderDataCache;
    }
    /**
     * 保存提醒数据，并更新缓存
     * @param data 提醒数据
     */
    public async saveReminderData(data: any): Promise<void> {
        this.reminderDataCache = data;
        await this.saveData(REMINDER_DATA_FILE, data);
    }

    /**
     * 加载项目数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadProjectData(update: boolean = false): Promise<any> {
        if (update || !this.projectDataCache) {
            try {
                const data = await this.loadData(PROJECT_DATA_FILE);
                this.projectDataCache = data || {};
            } catch (error) {
                console.error('Failed to load project data:', error);
                this.projectDataCache = {};
            }
        }
        return this.projectDataCache;
    }

    /**
     * 保存项目数据，并更新缓存
     * @param data 项目数据
     */
    public async saveProjectData(data: any): Promise<void> {
        this.projectDataCache = data;
        await this.saveData(PROJECT_DATA_FILE, data);
    }

    /**
     * 加载项目状态数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadProjectStatus(update: boolean = false): Promise<any> {
        if (update || !this.statusDataCache) {
            try {
                const data = await this.loadData(STATUSES_DATA_FILE);
                this.statusDataCache = data && Array.isArray(data) ? data : null;
            } catch (error) {
                console.error('Failed to load status data:', error);
                this.statusDataCache = null;
            }
        }
        return this.statusDataCache;
    }

    /**
     * 保存项目状态数据，并更新缓存
     * @param data 项目状态数据
     */
    public async saveProjectStatus(data: any): Promise<void> {
        this.statusDataCache = data;
        await this.saveData(STATUSES_DATA_FILE, data);
    }

    /**
     * 加载分类数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadCategories(update: boolean = false): Promise<any> {
        if (update || !this.categoriesDataCache) {
            try {
                const data = await this.loadData(CATEGORIES_DATA_FILE);
                this.categoriesDataCache = data && Array.isArray(data) ? data : null;
            } catch (error) {
                console.error('Failed to load categories data:', error);
                this.categoriesDataCache = null;
            }
        }
        return this.categoriesDataCache;
    }

    /**
     * 保存分类数据，并更新缓存
     * @param data 分类数据
     */
    public async saveCategories(data: any): Promise<void> {
        this.categoriesDataCache = data;
        await this.saveData(CATEGORIES_DATA_FILE, data);
    }

    /**
     * 加载习惯数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadHabitData(update: boolean = false): Promise<any> {
        if (update || !this.habitDataCache) {
            try {
                const data = await this.loadData(HABIT_DATA_FILE);
                const baseData = (data && typeof data === 'object') ? data : {};
                const mergedData: Record<string, any> = {};

                await Promise.all(Object.entries(baseData).map(async ([habitId, habit]) => {
                    if (!habit || typeof habit !== 'object') {
                        mergedData[habitId] = habit;
                        return;
                    }

                    try {
                        let checkinData = await this.loadData(this.getHabitCheckinFileName(habitId));
                        // 兼容之前错误迁移到 habit 目录的数据
                        if (!checkinData || Object.keys(checkinData).length === 0) {
                            const oldPathData = await this.loadData(`habit/${habitId}.json`);
                            if (oldPathData && Object.keys(oldPathData).length > 0) {
                                checkinData = oldPathData;
                                // 恢复到正确的目录
                                await this.saveData(this.getHabitCheckinFileName(habitId), checkinData);
                                await this.removeData(`habit/${habitId}.json`);
                            }
                        }
                        mergedData[habitId] = this.mergeHabitWithCheckinData(habit as Record<string, any>, checkinData);
                    } catch (error) {
                        console.warn(`Failed to load habit checkin data for ${habitId}:`, error);
                        mergedData[habitId] = this.mergeHabitWithCheckinData(habit as Record<string, any>, null);
                    }
                }));

                this.habitDataCache = mergedData;
            } catch (error) {
                console.error('Failed to load habit data:', error);
                this.habitDataCache = {};
            }
        }
        return this.habitDataCache;
    }

    /**
     * 保存习惯数据，并更新缓存
     * @param data 习惯数据
     */
    public async saveHabitData(data: any): Promise<void> {
        const fullData = (data && typeof data === 'object') ? data : {};
        const baseData: Record<string, any> = {};
        const saveTasks: Promise<unknown>[] = [];

        Object.entries(fullData).forEach(([habitId, habit]) => {
            if (!habit || typeof habit !== 'object') {
                baseData[habitId] = habit;
                return;
            }

            baseData[habitId] = this.stripHabitCheckinData(habit as Record<string, any>);
            saveTasks.push(this.saveData(
                this.getHabitCheckinFileName(habitId),
                this.extractHabitCheckinData(habit as Record<string, any>)
            ));
        });

        const staleHabitIds = Object.keys(this.habitDataCache || {}).filter((habitId) => !(habitId in fullData));

        this.habitDataCache = fullData;
        await this.saveData(HABIT_DATA_FILE, baseData);
        await Promise.all([
            ...saveTasks,
            ...staleHabitIds.map((habitId) => this.removeData(this.getHabitCheckinFileName(habitId))),
        ]);
    }

    /**
     * 仅保存单个习惯的数据（包括其打卡文件），并更新基础索引。
     * 用于避免打卡时重刷所有习惯的打卡文件。
     */
    public async saveHabitPartial(habitId: string, habit: any): Promise<void> {
        if (!this.habitDataCache) {
            await this.loadHabitData();
        }

        // 1. 更新内存缓存
        this.habitDataCache[habitId] = habit;

        // 2. 保存该习惯专属的打卡文件
        await this.saveData(
            this.getHabitCheckinFileName(habitId),
            this.extractHabitCheckinData(habit)
        );

        // 3. 更新并保存主索引文件 habit.json (不含打卡明细)
        const fullData = this.habitDataCache || {};
        const baseData: Record<string, any> = {};
        Object.entries(fullData).forEach(([hid, h]) => {
            if (h) {
                baseData[hid] = this.stripHabitCheckinData(h as Record<string, any>);
            }
        });
        await this.saveData(HABIT_DATA_FILE, baseData);
    }

    private getHabitCheckinFileName(habitId: string): string {
        return `${HABIT_CHECKIN_DIR}/${habitId}.json`;
    }

    private stripHabitCheckinData(habit: Record<string, any>): Record<string, any> {
        const baseHabit = { ...habit };
        for (const key of HABIT_CHECKIN_DATA_KEYS) {
            delete baseHabit[key];
        }
        return baseHabit;
    }

    private extractHabitCheckinData(habit: Record<string, any>): Record<string, any> {
        return {
            checkIns: habit.checkIns || {},
            hasNotify: habit.hasNotify || {},
            totalCheckIns: habit.totalCheckIns ?? 0,
        };
    }

    private mergeHabitWithCheckinData(habit: Record<string, any>, checkinData: any): Record<string, any> {
        const normalizedCheckinData = (checkinData && typeof checkinData === 'object') ? checkinData : {};
        return {
            ...habit,
            checkIns: normalizedCheckinData.checkIns || habit.checkIns || {},
            hasNotify: normalizedCheckinData.hasNotify || habit.hasNotify || {},
            totalCheckIns: normalizedCheckinData.totalCheckIns ?? habit.totalCheckIns ?? 0,
        };
    }

    /**
     * 加载习惯分组数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadHabitGroupData(update: boolean = false): Promise<any[]> {
        if (update || !this.habitGroupDataCache) {
            try {
                const data = await this.loadData(HABIT_GROUP_DATA_FILE);
                this.habitGroupDataCache = Array.isArray(data) ? data : [];
            } catch (error) {
                console.error('Failed to load habit group data:', error);
                this.habitGroupDataCache = [];
            }
        }
        return this.habitGroupDataCache;
    }

    /**
     * 保存习惯分组数据，并更新缓存
     * @param data 习惯分组数据
     */
    public async saveHabitGroupData(data: any[]): Promise<void> {
        this.habitGroupDataCache = data;
        await this.saveData(HABIT_GROUP_DATA_FILE, data);
    }

    /**
     * 加载节假日数据，支持缓存
     * @param update 是否强制更新
     */
    public async loadHolidayData(update: boolean = false): Promise<any> {
        if (update || !this.holidayDataCache) {
            try {
                const data = await this.loadData(HOLIDAY_DATA_FILE);
                this.holidayDataCache = data || {};
            } catch (error) {
                console.error('Failed to load holiday data:', error);
                this.holidayDataCache = {};
            }
        }
        return this.holidayDataCache;
    }

    /**
     * 保存节假日数据，并更新缓存
     * @param data 节假日数据
     */
    public async saveHolidayData(data: any): Promise<void> {
        this.holidayDataCache = data;
        await this.saveData(HOLIDAY_DATA_FILE, data);
    }

    /**
     * 加载番茄钟历史记录数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadPomodoroRecords(update: boolean = false): Promise<any> {
        if (update || !this.pomodoroRecordsCache) {
            try {
                const dirPath = `/data/storage/petal/${this.name}/${POMODORO_RECORD_DIR}`;
                const dirData = (await readDir(dirPath).catch(() => null)) as any[];
                let records: any = {};
                const fileNames = (dirData && Array.isArray(dirData)) ? dirData.filter(e => !e.isDir && e.name.endsWith('.json')).map(e => e.name) : [];
                if (fileNames.length > 0) {
                    const contents = await Promise.all(fileNames.map(name => this.loadData(`${POMODORO_RECORD_DIR}/${name}`)));
                    
                    fileNames.forEach((fileName, index) => {
                        const record = contents[index];
                        if (record && typeof record === 'object') {
                            const dateMatch = fileName.match(/^(.+)\.json$/i);
                            if (dateMatch) {
                                records[dateMatch[1]] = record;
                            } else {
                                records[fileName] = record;
                            }
                        }
                    });
                } else {
                    const data = await this.loadData(POMODORO_RECORD_DATA_FILE);
                    records = data || {};
                }
                this.pomodoroRecordsCache = records;
            } catch (error) {
                console.error('Failed to load pomodoro records:', error);
                this.pomodoroRecordsCache = {};
            }
        }
        return this.pomodoroRecordsCache;
    }

    /**
     * 保存番茄钟历史记录数据，并更新缓存（已弃用，建议各个日期分别保存）
     * @param data 记录数据
     */
    public async savePomodoroRecords(data: any): Promise<void> {
        this.pomodoroRecordsCache = data;
    }

    /**
     * 加载订阅数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadSubscriptionData(update: boolean = false): Promise<any> {
        if (update || !this.subscriptionCache) {
            try {
                // 硬编码文件名以避免循环依赖 "ics-subscriptions.json"
                const data = await this.loadData("ics-subscriptions.json");
                this.subscriptionCache = data || { subscriptions: {} };
            } catch (error) {
                console.error('Failed to load subscription data:', error);
                this.subscriptionCache = { subscriptions: {} };
            }
        }
        return this.subscriptionCache;
    }

    /**
     * 加载订阅任务数据，支持缓存
     * @param id 订阅ID
     * @param update 是否强制更新
     */
    public async loadSubscriptionTasks(id: string, update: boolean = false): Promise<any> {
        if (update || !this.subscriptionTasksCache[id]) {
            try {
                // Subscribe/ is a relative directory in the plugin's data folder
                const filePath = `/data/storage/petal/siyuan-plugin-task-note-management/Subscribe/${id}.json`;
                // loadData 不支持子目录，使用 getFile 读取
                const response = await getFile(filePath);

                let data = {};
                if (response) {
                    if (typeof response === 'object' && response !== null) {
                        // getFile can return the parsed JSON object directly if it's JSON
                        // Or it handles parsing internally? Siyuan API behavior needs care.
                        // Usually getFile returns the file content (string) or an error/status object?
                        // If we assume it returns similar to fetch response or the content directly.
                        // But usually getFile in Siyuan kernel returns JSON object if it's a JSON file?
                        // Let's assume standard behavior as seen in other plugins or previous code.
                        // Previous existing code in icsSubscription.ts handled string parsing.
                        // Let's be safe.
                        if ('code' in response && response.code !== 0) {
                            // error
                            console.warn(`Failed to load subscription file: ${filePath}`, response);
                        } else {
                            // success, response might be the object itself
                            data = response;
                        }
                    } else if (typeof response === 'string') {
                        try {
                            data = JSON.parse(response);
                        } catch (e) {
                            console.warn(`Failed to parse subscription file: ${filePath}`, e);
                        }
                    }
                }

                this.subscriptionTasksCache[id] = data || {};
            } catch (error) {
                console.error(`Failed to load subscription tasks for ${id}:`, error);
                this.subscriptionTasksCache[id] = {};
            }
        }
        return this.subscriptionTasksCache[id];
    }

    /**
     * 加载 VIP 授权数据，支持缓存
     * @param update 是否强制更新
     */
    public async loadVipData(update: boolean = false): Promise<any> {
        if (update || !this.vip || !this.vip.vipKeys || this.vip.vipKeys.length === 0) {
            try {
                const data = await this.loadData(LICENSE_DATA_FILE);
                if (data && data.vipKeys && data.vipKeys.length > 0) {
                    this.vip = data;
                } else {
                    this.vip = { vipKeys: [], isVip: false, expireDate: '', freeTrialUsed: data?.freeTrialUsed || false };
                }

                // 验证状态
                const status = await VipManager.checkAndUpdateVipStatus(this);
                this.vip.isVip = status.isVip;
                this.vip.expireDate = status.expireDate;
            } catch (error) {
                console.error('Failed to load VIP data:', error);
                this.vip = { vipKeys: [], isVip: false, expireDate: '', freeTrialUsed: false };
            }
        }
        return this.vip;
    }

    /**
     * 保存 VIP 授权数据
     * @param data VIP 数据
     */
    public async saveVipData(data: any): Promise<void> {
        this.vip = data;
        await this.saveData(LICENSE_DATA_FILE, data);
    }



    /**
     * 获取当前设备名称（格式: os/name/id）
     */
    private getDeviceName(): string {
        try {
            const system = (window as any).siyuan?.config?.system;
            if (system) {
                const os = system.os || 'unknown';
                const name = system.name || 'device';
                const id = system.id || '0';
                return `${os}/${name}/${id}`;
            }
            return 'unknown/device/0';
        } catch (e) {
            return 'unknown/device/0';
        }
    }

    private getNotifyDeviceKey(): string {
        const id = (window as any).siyuan?.config?.system?.id;
        return id ? String(id) : this.getDeviceName();
    }

    /**
     * 加载通知数据，支持缓存
     * @param update 是否强制更新（从文件读取）
     */
    public async loadNotifyData(update: boolean = false): Promise<{
        lastNotified?: string,
        notifiedKeys?: Record<string, boolean>,
        mobileNotifications?: Record<string, Record<string, number[]>>,
        habit?: Record<string, Record<string, number[]>>
    }> {
        if (update || !this.notifyDataCache) {
            try {
                const data = await this.loadData(NOTIFY_DATA_FILE);
                if (!data || typeof data !== 'object') {
                    this.notifyDataCache = {};
                } else if (data.mobileNotifications || data.habit || typeof data.lastNotified === 'string' || data.notifiedKeys) {
                    // 新格式（多端版本）
                    this.notifyDataCache = {
                        lastNotified: data.lastNotified,
                        notifiedKeys: data.notifiedKeys || {},
                        // 确保 mobileNotifications 是多端格式（设备 -> 任务 -> ID数组）
                        mobileNotifications: data.mobileNotifications || {},
                        habit: data.habit || {}
                    };
                } else {
                    // 旧数据格式迁移 (date -> boolean)
                    const dateKeys = Object.keys(data).filter(k => /\d{4}-\d{2}-\d{2}/.test(k));
                    if (dateKeys.length > 0) {
                        const validDates = dateKeys.filter(k => !!data[k]);
                        if (validDates.length > 0) {
                            const latest = validDates.sort().pop();
                            this.notifyDataCache = { lastNotified: latest, notifiedKeys: {}, mobileNotifications: {}, habit: {} };
                            try {
                                await this.saveNotifyData(this.notifyDataCache);
                            } catch (err) {
                                console.warn('迁移通知记录文件到新结构失败:', err);
                            }
                        } else {
                            this.notifyDataCache = {};
                        }
                    } else {
                        this.notifyDataCache = {};
                    }
                }
            } catch (error) {
                console.warn('读取通知记录文件失败:', error);
                this.notifyDataCache = {};
            }
        }
        return this.notifyDataCache;
    }

    /**
     * 保存通知数据，并更新缓存
     * @param data 通知数据
     */
    public async saveNotifyData(data: {
        lastNotified?: string,
        notifiedKeys?: Record<string, boolean>,
        mobileNotifications?: Record<string, Record<string, number[]>>,
        habit?: Record<string, Record<string, number[]>>
    }): Promise<void> {
        this.notifyDataCache = data;
        try {
            await this.saveData(NOTIFY_DATA_FILE, data);
        } catch (error) {
            console.error('写入通知记录文件失败:', error);
            throw error;
        }
    }

    private getMobileNotifyFileName(): string {
        const id = (window as any).siyuan?.config?.system?.id || 'default';
        return `mobileNotify/${id}.json`;
    }

    /**
     * 加载当前设备的移动通知数据
     */
    public async loadMobileNotifyData(update: boolean = false): Promise<Record<string, number[]>> {
        if (update || !this.mobileNotifyDataCacheForCurrentDevice) {
            try {
                const fileName = this.getMobileNotifyFileName();
                const data = await this.loadData(fileName);
                this.mobileNotifyDataCacheForCurrentDevice = (data && typeof data === 'object') ? data : {};
            } catch (error) {
                console.warn('读取移动端通知记录文件失败:', error);
                this.mobileNotifyDataCacheForCurrentDevice = {};
            }
        }
        return this.mobileNotifyDataCacheForCurrentDevice;
    }

    /**
     * 保存当前设备的移动通知数据
     */
    public async saveMobileNotifyData(data: Record<string, number[]>): Promise<void> {
        this.mobileNotifyDataCacheForCurrentDevice = data;
        try {
            const fileName = this.getMobileNotifyFileName();
            await this.saveData(fileName, data);
        } catch (error) {
            console.error('写入移动端通知记录文件失败:', error);
            throw error;
        }
    }

    public async loadMobileHabitNotifyData(update: boolean = false): Promise<Record<string, number[]>> {
        try {
            const notifyData = await this.loadNotifyData(update);
            if (!notifyData.habit || typeof notifyData.habit !== 'object') {
                notifyData.habit = {};
            }
            const deviceKey = this.getNotifyDeviceKey();
            if (!notifyData.habit[deviceKey] || typeof notifyData.habit[deviceKey] !== 'object') {
                notifyData.habit[deviceKey] = {};
            }
            return notifyData.habit[deviceKey];
        } catch (error) {
            console.warn('读取习惯移动端通知记录失败:', error);
            return {};
        }
    }

    public async saveMobileHabitNotifyData(data: Record<string, number[]>): Promise<void> {
        try {
            const notifyData = await this.loadNotifyData();
            if (!notifyData.habit || typeof notifyData.habit !== 'object') {
                notifyData.habit = {};
            }
            const deviceKey = this.getNotifyDeviceKey();
            notifyData.habit[deviceKey] = data || {};
            await this.saveNotifyData(notifyData);
        } catch (error) {
            console.error('写入习惯移动端通知记录失败:', error);
            throw error;
        }
    }

    public async getMobileHabitNotificationIds(habitId: string): Promise<number[]> {
        try {
            const data = await this.loadMobileHabitNotifyData();
            return data[habitId] || [];
        } catch (error) {
            console.warn('获取习惯移动端通知ID失败:', error);
            return [];
        }
    }

    public async saveMobileHabitNotificationId(habitId: string, notificationId: number): Promise<void> {
        try {
            const data = await this.loadMobileHabitNotifyData();
            if (!data[habitId]) {
                data[habitId] = [];
            }
            if (!data[habitId].includes(notificationId)) {
                data[habitId].push(notificationId);
            }
            await this.saveMobileHabitNotifyData(data);
            console.log(`[MobileHabitNotification] 已保存通知ID: habitId=${habitId}, notificationId=${notificationId}`);
        } catch (error) {
            console.warn('保存习惯移动端通知ID失败:', error);
        }
    }

    public async removeMobileHabitNotificationId(habitId: string, notificationId?: number): Promise<boolean> {
        try {
            const data = await this.loadMobileHabitNotifyData();
            if (!(habitId in data)) {
                return false;
            }

            if (notificationId !== undefined) {
                const ids = data[habitId];
                const index = ids.indexOf(notificationId);
                if (index > -1) {
                    ids.splice(index, 1);
                    if (ids.length === 0) {
                        delete data[habitId];
                    }
                    await this.saveMobileHabitNotifyData(data);
                    console.log(`[MobileHabitNotification] 已移除通知ID记录: habitId=${habitId}, notificationId=${notificationId}`);
                    return true;
                }
            } else {
                delete data[habitId];
                await this.saveMobileHabitNotifyData(data);
                console.log(`[MobileHabitNotification] 已移除所有通知ID记录: habitId=${habitId}`);
                return true;
            }
            return false;
        } catch (error) {
            console.warn('移除习惯移动端通知ID失败:', error);
            return false;
        }
    }

    public async clearAllMobileHabitNotificationIds(): Promise<void> {
        try {
            const data = await this.loadMobileHabitNotifyData();
            const hasNotificationIds = Object.keys(data || {}).length > 0;
            const hasPlanSnapshot = !!this.mobileHabitNotificationPlansCache && Object.keys(this.mobileHabitNotificationPlansCache).length > 0;
            if (hasNotificationIds || hasPlanSnapshot) {
                this.mobileHabitNotificationPlansCache = {};
                await this.saveMobileHabitNotifyData({});
                console.log(`[MobileHabitNotification] 已清理当前设备的所有通知ID记录`);
            }
        } catch (error) {
            console.warn('清理习惯移动端通知ID记录失败:', error);
        }
    }

    public async getAllMobileHabitNotificationIds(): Promise<Record<string, number[]>> {
        try {
            return await this.loadMobileHabitNotifyData();
        } catch (error) {
            console.warn('获取习惯移动端通知ID失败:', error);
            return {};
        }
    }

    /**
     * 获取当前设备的移动端通知ID列表
     * @param reminderId 提醒ID
     * @returns 通知ID数组，如果不存在则返回空数组
     */
    public async getMobileNotificationIds(reminderId: string): Promise<number[]> {
        try {
            const data = await this.loadMobileNotifyData();
            return data[reminderId] || [];
        } catch (error) {
            console.warn('获取移动端通知ID失败:', error);
            return [];
        }
    }

    /**
     * 获取移动端通知ID（兼容旧接口，返回第一个通知ID）
     * @param reminderId 提醒ID
     * @returns 通知ID，如果不存在则返回 undefined
     * @deprecated 建议使用 getMobileNotificationIds
     */
    public async getMobileNotificationId(reminderId: string): Promise<number | undefined> {
        const ids = await this.getMobileNotificationIds(reminderId);
        return ids.length > 0 ? ids[0] : undefined;
    }

    /**
     * 保存移动端通知ID（添加到列表）
     * @param reminderId 提醒ID
     * @param notificationId 通知ID
     */
    public async saveMobileNotificationId(reminderId: string, notificationId: number): Promise<void> {
        try {
            const data = await this.loadMobileNotifyData();
            if (!data[reminderId]) {
                data[reminderId] = [];
            }
            // 避免重复添加
            if (!data[reminderId].includes(notificationId)) {
                data[reminderId].push(notificationId);
            }
            await this.saveMobileNotifyData(data);
            console.log(`[MobileNotification] 已保存通知ID: reminderId=${reminderId}, notificationId=${notificationId}`);
        } catch (error) {
            console.warn('保存移动端通知ID失败:', error);
        }
    }

    /**
     * 移除移动端通知ID记录（指定ID或全部）
     * @param reminderId 提醒ID
     * @param notificationId 可选，指定要移除的通知ID。如果不提供，则移除该提醒的所有通知ID
     * @returns 是否成功移除
     */
    public async removeMobileNotificationId(reminderId: string, notificationId?: number): Promise<boolean> {
        try {
            const data = await this.loadMobileNotifyData();
            if (!(reminderId in data)) {
                return false;
            }

            if (notificationId !== undefined) {
                // 移除指定的通知ID
                const ids = data[reminderId];
                const index = ids.indexOf(notificationId);
                if (index > -1) {
                    ids.splice(index, 1);
                    // 如果数组为空，删除该提醒的键
                    if (ids.length === 0) {
                        delete data[reminderId];
                    }
                    await this.saveMobileNotifyData(data);
                    console.log(`[MobileNotification] 已移除通知ID记录: reminderId=${reminderId}, notificationId=${notificationId}`);
                    return true;
                }
            } else {
                // 移除该提醒的所有通知ID
                delete data[reminderId];
                await this.saveMobileNotifyData(data);
                console.log(`[MobileNotification] 已移除所有通知ID记录: reminderId=${reminderId}`);
                return true;
            }
            return false;
        } catch (error) {
            console.warn('移除移动端通知ID失败:', error);
            return false;
        }
    }

    /**
     * 清理当前设备的所有移动端通知ID记录
     */
    public async clearAllMobileNotificationIds(): Promise<void> {
        try {
            const data = await this.loadMobileNotifyData();
            const hasNotificationIds = Object.keys(data).length > 0;
            const hasPlanSnapshot = !!this.mobileNotificationPlansCache && Object.keys(this.mobileNotificationPlansCache).length > 0;
            if (hasNotificationIds || hasPlanSnapshot) {
                this.mobileNotificationPlansCache = {};
                await this.saveMobileNotifyData({});
                console.log(`[MobileNotification] 已清理当前设备的所有通知ID记录`);
            }
        } catch (error) {
            console.warn('清理移动端通知ID记录失败:', error);
        }
    }

    /**
     * 清理指定设备的所有移动端通知ID记录（用于重置其他设备的数据）
     * @param deviceName 设备名称，如果不提供则使用当前设备
     */
    public async clearDeviceMobileNotificationIds(deviceName?: string): Promise<void> {
        // 由于改为单文件存储，仅支持清理当前设备
        if (!deviceName || deviceName === this.getDeviceName()) {
            await this.clearAllMobileNotificationIds();
            await this.clearAllMobileHabitNotificationIds();
        } else {
            console.warn('已不再支持直接清理其他设备的通知记录');
        }
    }

    /**
     * 获取当前设备的所有移动端通知记录
     * @returns 所有通知记录 { reminderId: number[] }
     */
    public async getAllMobileNotificationIds(): Promise<Record<string, number[]>> {
        try {
            return await this.loadMobileNotifyData();
        } catch (error) {
            console.warn('获取所有移动端通知ID失败:', error);
            return {};
        }
    }

    /**
     * 获取所有设备的移动端通知记录（用于管理多设备）
     * @returns 所有设备的通知记录 { deviceName: { reminderId: number[] } }
     */
    public async getAllDevicesMobileNotificationIds(): Promise<Record<string, Record<string, number[]>>> {
        try {
            const currentData = await this.loadMobileNotifyData();
            return { [this.getDeviceName()]: currentData };
        } catch (error) {
            console.warn('获取所有设备的移动端通知ID失败:', error);
            return {};
        }
    }

    /**
     * 检查某日期是否已提醒过全天事件
     */
    public async hasNotifiedToday(date: string): Promise<boolean> {
        try {
            const notifyData = await this.loadNotifyData();
            return notifyData.lastNotified === date;
        } catch (error) {
            console.warn('检查通知记录失败:', error);
            return false;
        }
    }

    /**
     * 标记某日期已提醒全天事件
     */
    public async markNotifiedToday(date: string): Promise<void> {
        try {
            const data = await this.loadNotifyData();
            data.lastNotified = date;
            await this.saveNotifyData(data);
        } catch (error) {
            console.error('标记通知记录失败:', error);
        }
    }

    /**
     * 检查特定的提醒Key是否已通知 (用于多窗口同步)
     */
    public async hasReminderNotified(key: string): Promise<boolean> {
        try {
            const data = await this.loadNotifyData();
            // 桌面端仅将当前分钟视为有效去重范围。
            if (!this.isInMobileApp) {
                const currentMinute = this.getCurrentLogicalMinute();
                const keyMinute = this.extractMinuteBucketFromNotifyKey(key);
                if (!keyMinute || keyMinute !== currentMinute) {
                    return false;
                }
            }
            return !!data.notifiedKeys?.[key];
        } catch (error) {
            return false;
        }
    }

    /**
     * 标记特定的提醒Key已通知
     */
    public async markReminderNotified(key: string): Promise<void> {
        try {
            const data = await this.loadNotifyData();
            if (!data.notifiedKeys) data.notifiedKeys = {};

            if (!this.isInMobileApp) {
                // 桌面端：notifiedKeys 只保存当前分钟的通知；进入下一分钟即过滤旧记录。
                const currentMinute = this.getCurrentLogicalMinute();
                const filtered: Record<string, boolean> = {};
                for (const k of Object.keys(data.notifiedKeys)) {
                    if (this.extractMinuteBucketFromNotifyKey(k) === currentMinute) {
                        filtered[k] = true;
                    }
                }
                data.notifiedKeys = filtered;
                data.notifiedKeys[key] = true;
                await this.saveNotifyData(data);
                return;
            }

            data.notifiedKeys[key] = true;

            // 清理旧日期 (只保留当天的通知记录，减少文件大小)
            const dateMatch = key.match(/\d{4}-\d{2}-\d{2}/);
            if (dateMatch) {
                const today = dateMatch[0];
                const keys = Object.keys(data.notifiedKeys);
                if (keys.length > 100) {
                    for (const k of keys) {
                        if (!k.includes(today)) {
                            delete data.notifiedKeys[k];
                        }
                    }
                }
            }

            await this.saveNotifyData(data);
        } catch (error) {
            console.error('标记提醒记录失败:', error);
        }
    }

    /**
     * 获取当前逻辑分钟（YYYY-MM-DD_HH:MM）
     */
    private getCurrentLogicalMinute(): string {
        const today = getLogicalDateString();
        const localTime = getLocalTimeString() || '';
        const minuteMatch = localTime.match(/^(\d{2}:\d{2})/);
        const minute = minuteMatch ? minuteMatch[1] : '00:00';
        return `${today}_${minute}`;
    }

    /**
     * 从通知 key 中提取分钟桶（YYYY-MM-DD_HH:MM）
     */
    private extractMinuteBucketFromNotifyKey(key: string): string | null {
        if (!key || typeof key !== 'string') return null;
        const dateMatch = key.match(/\d{4}-\d{2}-\d{2}/);
        const timeMatch = key.match(/\d{2}:\d{2}/);
        if (!dateMatch || !timeMatch) return null;
        return `${dateMatch[0]}_${timeMatch[0]}`;
    }

    /**
     * 清理过期的移动端通知ID记录（删除不存在的提醒对应的通知ID）
     * @param validReminderIds 有效的提醒ID列表
     * @param deviceName 可选，指定设备名称，默认当前设备
     */
    public async cleanupMobileNotifications(validReminderIds: string[], deviceName?: string): Promise<void> {
        // 由于改为单文件存储，仅支持清理当前设备
        if (deviceName && deviceName !== this.getDeviceName()) {
            return;
        }

        try {
            const data = await this.loadMobileNotifyData();
            const validIdSet = new Set(validReminderIds);
            const keysToDelete: string[] = [];

            for (const reminderId of Object.keys(data)) {
                if (!validIdSet.has(reminderId)) {
                    keysToDelete.push(reminderId);
                }
            }

            if (keysToDelete.length > 0) {
                for (const key of keysToDelete) {
                    delete data[key];
                }
                await this.saveMobileNotifyData(data);
                console.log(`[MobileNotification] 已清理当前设备的 ${keysToDelete.length} 个过期通知ID记录`);
            }
        } catch (error) {
            console.warn('清理过期移动端通知ID失败:', error);
        }
    }

    async onload() {
        // 初始化移动端（手机+平板）检测
        this.isInMobileApp = isInMobileApp();


        // 添加自定义图标
        this.addIcons(`
            <symbol id="iconProject" viewBox="0 0 1024 1024">
<path d="M775 536.2 456.8 536.2c-26 0-47-21-47-47 0-26 21-47 47-47l318.2 0c26 0 47 21 47 47C822 515.2 800.8 536.2 775 536.2L775 536.2z" p-id="4506"></path><path d="M775 722.2 456.8 722.2c-26 0-47-21-47-47s21-47 47-47l318.2 0c26 0 47 21 47 47S800.8 722.2 775 722.2L775 722.2z" p-id="4507"></path><path d="M991 875.8 991 281.4c0-72.2-65.8-65.4-65.8-65.4s-392.8 0.4-371.8 0c-22.4 0.4-33.8-11.8-33.8-11.8s-15.6-27-43.8-69.4c-29.4-44.6-63.6-37.4-63.6-37.4L123 97.4C42.8 97.4 42 174.6 42 174.6L42 872c0 86 65 75.4 65 75.4l824.2 0C1000.8 947.4 991 875.8 991 875.8L991 875.8zM932 840.6c0 26.6-21.4 48-48 48L149 888.6c-26.6 0-48-21.4-48-48L101 343c0-26.6 21.4-48 48-48L884 295c26.6 0 48 21.4 48 48L932 840.6 932 840.6z" p-id="4508"></path><path d="M282.2 489.2m-50.2 0a25.1 25.1 0 1 0 100.4 0 25.1 25.1 0 1 0-100.4 0Z" p-id="4509"></path><path d="M282.2 675.2m-50.2 0a25.1 25.1 0 1 0 100.4 0 25.1 25.1 0 1 0-100.4 0Z" p-id="4510"></path>
            </symbol>
        `);

        this.addIcons(`
            <symbol id="iconGrid" viewBox="0 0 1024 1024">
            <path d="M513.088 64c10.56 0 19.456 7.04 21.76 16.448l0.64 4.864-0.064 405.312h403.2c11.84 0 21.376 10.048 21.376 22.4 0 10.624-7.04 19.52-16.448 21.824l-4.864 0.64-403.264-0.064v403.2a21.888 21.888 0 0 1-22.4 21.376 22.208 22.208 0 0 1-21.76-16.448l-0.64-4.864V535.424H85.312A21.888 21.888 0 0 1 64 513.088c0-10.56 7.04-19.456 16.448-21.76l4.864-0.64h405.312V85.312c0-11.776 10.048-21.312 22.4-21.312z m317.952 522.688c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712v-179.2c0-32.96 24.32-59.712 54.272-59.712h190.08z m-448 0c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712v-179.2c0-32.96 24.32-59.712 54.272-59.712h190.08z m448 59.712h-190.08v179.2h190.08v-179.2z m-448 0h-190.08v179.2h190.08v-179.2z m448-507.712c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712V198.4c0-32.96 24.32-59.712 54.272-59.712h190.08z m-448 0c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712V198.4c0-32.96 24.32-59.712 54.272-59.712h190.08z m448 59.712h-190.08v179.2h190.08V198.4z m-448 0h-190.08v179.2h190.08V198.4z" p-id="6019"></path>
            </symbol>
        `);
        // 先初始化 UI，避免加载数据记录异常/耗时影响 Dock 注册
        setPluginInstance(this);
        await this.initializeUI();
        // 数据加载
        await this.loadSettings();
        this.taskNoteDOM = new TaskNoteDOMManager(this);
        // 检查版本更新提醒
        ChangelogUtils.checkAndNotify(this);


        // 后台初始化番茄钟记录管理器，失败也不阻断插件主流程
        const pomodoroRecordManager = PomodoroRecordManager.getInstance(this);
        pomodoroRecordManager.initialize().catch((error: any) => {
            console.warn("番茄钟记录初始化失败（已降级，不影响 Dock 注册）:", error);
        });

        // 初始化数据并缓存
        await this.loadHabitData();
        await this.loadHabitGroupData();
        await this.loadHolidayData();



        // 初始化上次番茄钟设置缓存，避免第一次设置更新时误判
        this.lastPomodoroSettings = await this.getPomodoroSettings();

        this.categoryManager = CategoryManager.getInstance(this);
        await this.categoryManager.initialize();


        // 添加用户交互监听器来启用音频
        this.enableAudioOnUserInteraction();


        // 监听设置变更，动态显示/隐藏侧边停靠栏
        const onSettingsUpdated = async () => {
            try {
                const settings = await this.loadSettings();
                const isMobile = getFrontend().endsWith('mobile');
                if (!isMobile || settings.enableProjectDock !== false) this.ensureProjectDockRegistered();
                if (!isMobile || settings.enableReminderDock !== false) this.ensureReminderDockRegistered();
                if (!isMobile || settings.enableHabitDock !== false) this.ensureHabitDockRegistered();
                if (!isMobile || settings.enableCalendarDock !== false) this.ensureCalendarDockRegistered();
                this.toggleDockVisibility('project_dock', settings.enableProjectDock !== false);
                this.toggleDockVisibility('reminder_dock', settings.enableReminderDock !== false);
                this.toggleDockVisibility('habit_dock', settings.enableHabitDock !== false);
                this.toggleDockVisibility('calendar_dock', settings.enableCalendarDock !== false);
                // 同步刷新徽章（显示/隐藏数字）
                this.updateBadges();
                this.updateProjectBadges();
                this.updateHabitBadges();
                this.taskNoteDOM.updateOutlinePrefixes();
                try {
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    window.dispatchEvent(new CustomEvent('habitUpdated'));
                } catch (err) {
                    console.warn('Dispatch reminder/habit update event failed:', err);
                }
                // 更新所有打开的番茄钟实例，使其应用新的番茄钟设置
                try {
                    const pomodoroSettings = await this.getPomodoroSettings();
                    const prev = this.lastPomodoroSettings || {};
                    const next = pomodoroSettings || {};
                    const relevantFields = [
                        'workDuration', 'breakDuration', 'longBreakDuration', 'longBreakInterval', 'autoMode',
                        'workVolume', 'breakVolume', 'longBreakVolume',
                        'randomRestEnabled', 'randomRestMinInterval', 'randomRestMaxInterval', 'randomRestBreakDuration',
                        'randomRestSounds', 'randomRestEndSound', 'dailyFocusGoal'
                    ]; let relevantChanged = false;
                    for (const f of relevantFields) {
                        const pv = prev[f];
                        const nv = next[f];
                        if (String(pv) !== String(nv)) { relevantChanged = true; break; }
                    }

                    const currentPomodoro = PomodoroManager.getInstance().getCurrentPomodoroTimer();



                    if (!relevantChanged) {
                        // 仅更新时间缓存，不做实例更新或广播
                        this.lastPomodoroSettings = pomodoroSettings;
                        return;
                    }

                    // 有实例且相关设置发生改变，进行更新
                    let updatedCount = 0;
                    if (currentPomodoro && typeof currentPomodoro.getCurrentState === 'function' && typeof currentPomodoro.updateState === 'function') {
                        // 先检查窗口是否仍然存在，避免操作已销毁的 BrowserWindow
                        if (typeof currentPomodoro.isWindowActive === 'function' && !currentPomodoro.isWindowActive()) {
                            // 窗口已失效，清理引用，不再尝试更新
                            PomodoroManager.getInstance().cleanupInactiveTimer();
                        } else {
                            try {
                                const state = currentPomodoro.getCurrentState();
                                // 强制更新，即使正在运行
                                const reminder = { id: state.reminderId, title: state.reminderTitle };
                                await currentPomodoro.updateState(reminder, pomodoroSettings, state.isCountUp, state, true, true);
                                updatedCount++;
                            } catch (e) {
                                console.warn('更新独立番茄钟窗口设置失败:', e);
                                // 如果是 BrowserWindow 已销毁导致的错误，清理引用
                                if (e?.message?.includes('destroyed') || e?.message?.includes('Object has been destroyed')) {
                                    PomodoroManager.getInstance().cleanupInactiveTimer();
                                }
                            }
                        }
                    }

                    for (const [, view] of this.tabViews) {
                        if (view && typeof view.updateState === 'function' && typeof view.getCurrentState === 'function') {
                            try {
                                // 同样检查 Tab 中的番茄钟窗口是否有效
                                if (typeof view.isWindowActive === 'function' && !view.isWindowActive()) {
                                    continue;
                                }
                                const state = view.getCurrentState();
                                // 强制更新，即使正在运行
                                const reminder = { id: state.reminderId, title: state.reminderTitle };
                                await view.updateState(reminder, pomodoroSettings, state.isCountUp, state, true, true);
                                updatedCount++;
                            } catch (e) {
                                console.warn('更新 tab 中番茄钟设置失败:', e);
                            }
                        }
                    }

                    // 仅在至少有一个实例实际被更新时提示用户（跳过运行中计时器时不提示）
                    if (updatedCount > 0) {
                        try { showMessage(i18n('pomodoroSettingsApplied') || '番茄钟设置已应用到打开的计时器', 1500); } catch (e) { }
                    }
                } catch (err2) {
                    console.warn('更新番茄钟设置时发生错误:', err2);
                }

                // 处理ICS同步设置变更
                await handleIcsSyncSettingsChange(this as any, settings);
            } catch (err) {
                console.warn('处理设置变更失败:', err);
            }
        };
        window.addEventListener('reminderSettingsUpdated', onSettingsUpdated);
        this.addCleanup(() => {
            window.removeEventListener('reminderSettingsUpdated', onSettingsUpdated);
            this.coordinatorChannel?.close();
        });

        // 监听文档树右键菜单事件
        const handleDocTreeMenu = this.handleDocumentTreeMenu.bind(this);
        this.eventBus.on('open-menu-doctree', handleDocTreeMenu);
        this.addCleanup(() => this.eventBus.off('open-menu-doctree', handleDocTreeMenu));

        // 初始化ICS云端同步
        await initIcsSync(this as any);

        // 初始化ICS订阅同步
        await initIcsSubscriptionSync(this as any);

        // 初始化当前逻辑日期
        this.currentLogicalDate = getLogicalDateString();

        // 执行数据迁移
        await performDataMigration(this);

        // 初始化多窗口协调器
        this.initCoordinator();

        const frontend = getFrontend();
        const isBrowserDesktop = frontend === 'browser-desktop';

        // // 为了测试NotificationDialog和showReminderSystemNotification能否在手机上显示，onload就显示测试数据
        // setTimeout(() => {
        //     const testReminder = {
        //         id: 'test-reminder-id',
        //         blockId: 'test-block-id',
        //         title: '测试提醒(用于手机端测试)',
        //         note: '这是一条测试通知内容，验证在手机端是否能正常显示NotificationDialog。',
        //         priority: 'high',
        //         date: this.currentLogicalDate || new Date().toISOString().split('T')[0],
        //         categoryName: '测试分类',
        //         categoryColor: '#ff0000',
        //         time: '12:00',
        //         isAllDay: false
        //     };
        //     NotificationDialog.show(testReminder);
        //     this.showReminderSystemNotification('测试系统通知标题', '测试系统通知内容，用于手机端测试', testReminder);
        // }, 3000);

        if (!this.isInMobileApp && !isBrowserDesktop) {
            // 尝试恢复已存在的番茄钟独立窗口
            // 先询问其他窗口是否已有活跃番茄钟，避免多窗口同时恢复导致重复计时
            import("./components/PomodoroTimer").then(async ({ PomodoroTimer }) => {
                try {
                    const hasActiveInOtherWindow = await new Promise<boolean>(resolve => {
                        const timeout = setTimeout(() => resolve(false), 500);
                        const handler = (event: MessageEvent) => {
                            if (event.data?.type === 'pomodoroActiveConfirm') {
                                clearTimeout(timeout);
                                this.coordinatorChannel.removeEventListener('message', handler);
                                resolve(true);
                            }
                        };
                        this.coordinatorChannel.addEventListener('message', handler);
                        this.coordinatorChannel.postMessage({ type: 'pomodoroQueryActive' });
                    });
                    if (hasActiveInOtherWindow) {
                        console.log('[PomodoroRecovery] 其他窗口已有活跃番茄钟，跳过本窗口恢复');
                        return;
                    }
                    const settings = await this.getPomodoroSettings();
                    const timer = await PomodoroTimer.recoverOrphanedWindow(this, settings);
                    if (timer) {
                        PomodoroManager.getInstance().setCurrentPomodoroTimer(timer);
                    }
                } catch (e) {
                    console.warn('恢复独立番茄钟窗口失败:', e);
                }
            });
        }


    }

    private enableAudioOnUserInteraction() {
        const enableAudio = async () => {
            if (this.audioEnabled) return;

            try {
                // 预加载音频文件
                const soundPath = await this.getNotificationSound();
                if (soundPath) {
                    const resolved = await resolveAudioPath(soundPath);
                    this.preloadedAudio = new Audio(resolved);
                    this.preloadedAudio.volume = 0; // 很小的音量进行预加载
                    await this.preloadedAudio.play();
                    this.preloadedAudio.pause();
                    this.preloadedAudio.currentTime = 0;
                    // 在预加载音频上设置 ended 处理，确保状态能被正确重置
                    this.preloadedAudio.onended = () => {
                        this.isPlayingNotificationSound = false;
                    };
                    this.preloadedAudio.volume = 1; // 恢复正常音量
                    this.audioEnabled = true;
                }
            } catch (error) {
                // console.warn('音频预加载失败，将使用静音模式:', error);
                this.audioEnabled = false;
            }
        };

        // 监听多种用户交互事件
        const events = ['click', 'touchstart', 'keydown'];
        const handleUserInteraction = () => {
            enableAudio();
            // 移除事件监听器，只需要启用一次
            events.forEach(event => {
                document.removeEventListener(event, handleUserInteraction);
            });
        };

        events.forEach(event => {
            document.addEventListener(event, handleUserInteraction, { once: true });
        });
        this.addCleanup(() => {
            events.forEach(event => {
                document.removeEventListener(event, handleUserInteraction);
            });
        });
    }


    // 重写 openSetting 方法
    async openSetting() {
        let dialog = new Dialog({
            title: i18n("settingsPanel"),
            content: `<div id="SettingPanel" style="height: 100%;"></div>`,
            width: "min(900px, 95%)",
            height: "80vh",
            destroyCallback: () => {
                pannel.$destroy();
            }
        });

        let pannel = new SettingPanelComponent({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

    public openVipDialog() {
        showVipDialog(this);
    }

    // 加载设置的封装函数
    async loadSettings(update: boolean = false) {
        if (!update && this.settings) {
            return this.settings;
        }

        const data = await this.loadData(SETTINGS_FILE) || {};
        const isFreshInstall = !data || Object.keys(data).length === 0;

        // 新安装用户默认视为已完成迁移，避免首次启动因迁移写入 settings 文件。
        const defaultDatatransfer = isFreshInstall
            ? {
                ...DEFAULT_SETTINGS.datatransfer,
                bindblockAddAttr: true,
                termTypeTransfer: true,
                randomRestTransfer: true,
                audioFileTransfer: true,
                habitCheckinTransfer: true,
                pomodoroRecordTransfer: true,
            }
            : { ...DEFAULT_SETTINGS.datatransfer };

        // 合并默认设置和用户设置，确保所有设置项都有值
        const settings = {
            ...DEFAULT_SETTINGS,
            ...data,
            datatransfer: {
                ...defaultDatatransfer,
                ...(data.datatransfer || {}),
            },
        };


        // 验证 VIP 状态 (从独立文件加载)
        await this.loadVipData();

        // 确保 weekStartDay 在加载后是数字（可能以字符串形式保存）
        if (typeof settings.weekStartDay === 'string') {
            const parsed = parseInt(settings.weekStartDay, 10);
            settings.weekStartDay = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
        }
        // 兼容旧设置中使用数字 hour 的情况，将其转换为 HH:MM 格式字符串
        if (typeof settings.dailyNotificationTime === 'number') {
            const hours = Math.max(0, Math.min(23, Math.floor(settings.dailyNotificationTime)));
            settings.dailyNotificationTime = (hours < 10 ? '0' : '') + hours.toString() + ':00';
        }
        if (typeof settings.dailyNotificationTime === 'string') {
            // Normalize formats like '8' -> '08:00', '8:5' -> '08:05'
            const raw = settings.dailyNotificationTime;
            const m = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
            if (m) {
                const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                settings.dailyNotificationTime = (h < 10 ? '0' : '') + h.toString() + ':' + (min < 10 ? '0' : '') + min.toString();
            } else {
                // 如果无法解析，则回退到默认字符串
                settings.dailyNotificationTime = DEFAULT_SETTINGS.dailyNotificationTime as any;
            }
        }
        if (typeof settings.todayStartTime === 'number') {
            const hours = Math.max(0, Math.min(23, Math.floor(settings.todayStartTime)));
            settings.todayStartTime = (hours < 10 ? '0' : '') + hours.toString() + ':00';
        }
        if (typeof settings.todayStartTime === 'string') {
            const raw = settings.todayStartTime;
            const m = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
            if (m) {
                const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                settings.todayStartTime = (h < 10 ? '0' : '') + h.toString() + ':' + (min < 10 ? '0' : '') + min.toString();
            } else {
                settings.todayStartTime = DEFAULT_SETTINGS.todayStartTime as any;
            }
        }
        if (Array.isArray(settings.pomodoroDurationPresets)) {
            const seen = new Set<number>();
            settings.pomodoroDurationPresets = settings.pomodoroDurationPresets
                .map((item: any) => Number(item))
                .filter((item: number) => Number.isInteger(item) && item > 0)
                .filter((item: number) => {
                    if (seen.has(item)) return false;
                    seen.add(item);
                    return true;
                });
        } else {
            settings.pomodoroDurationPresets = [...DEFAULT_SETTINGS.pomodoroDurationPresets];
        }
        setDayStartTime(settings.todayStartTime);
        this.settings = settings;
        return settings;
    }

    /**
     * 保存设置数据，并更新缓存
     * @param settings 设置数据
     */
    public async saveSettings(settings: any): Promise<void> {
        this.settings = settings;
        await this.saveData(SETTINGS_FILE, settings);
    }

    /**
     * 合并用户音频列表与默认内置声音，并过滤掉已删除项，同时保持内置声音的排序
     */
    private getMergedAudioFileList(settings: any, key: string): string[] {
        const userList: AudioFileItem[] = settings.audioFileLists?.[key] ?? [];
        const defaultList: AudioFileItem[] = (DEFAULT_SETTINGS.audioFileLists as any)[key] ?? [];

        const result: AudioFileItem[] = [];
        const processedPath = new Set<string>();

        // 1. 遍历默认列表，保持其原有顺序
        for (const defItem of defaultList) {
            const userEntry = userList.find(i => i.path === defItem.path);
            if (userEntry) {
                result.push(userEntry);
                processedPath.add(defItem.path);
                // 查找是否有针对此项的替换项（下载到本地后的版本）
                const replacement = userList.find(i => i.replaces === defItem.path);
                if (replacement) {
                    result.push(replacement);
                    processedPath.add(replacement.path);
                }
            } else {
                result.push({ ...defItem });
            }
        }

        // 2. 追加用户完全自定义的项（上传的
        for (const userItem of userList) {
            if (!processedPath.has(userItem.path)) {
                result.push(userItem);
            }
        }

        return result.filter(i => !i.removed).map(i => i.path);
    }

    // 获取番茄钟设置
    async getPomodoroSettings(currentSettings?: any) {
        const settings = currentSettings || await this.loadSettings();
        return {
            workDuration: settings.pomodoroWorkDuration,
            breakDuration: settings.pomodoroBreakDuration,
            longBreakDuration: settings.pomodoroLongBreakDuration,
            longBreakInterval: Math.max(1, settings.pomodoroLongBreakInterval),
            autoMode: settings.pomodoroAutoMode,
            workSound: settings.audioSelected?.pomodoroWorkSound || '',
            breakSound: settings.audioSelected?.pomodoroBreakSound || '',
            longBreakSound: settings.audioSelected?.pomodoroLongBreakSound || '',
            workEndSound: settings.audioSelected?.pomodoroWorkEndSound || '',
            breakEndSound: settings.audioSelected?.pomodoroBreakEndSound || '',
            workVolume: Math.max(0, Math.min(1, settings.workVolume ?? 0.5)),
            breakVolume: Math.max(0, Math.min(1, settings.breakVolume ?? 0.5)),
            longBreakVolume: Math.max(0, Math.min(1, settings.longBreakVolume ?? 0.5)),
            workEndVolume: Math.max(0, Math.min(1, settings.workEndVolume ?? 1)),
            breakEndVolume: Math.max(0, Math.min(1, settings.breakEndVolume ?? 1)),
            randomRestVolume: Math.max(0, Math.min(1, settings.randomRestVolume ?? 1)),
            randomRestEndVolume: Math.max(0, Math.min(1, settings.randomRestEndVolume ?? 1)),
            systemNotification: settings.pomodoroSystemNotification, // 新增
            randomRestEnabled: settings.randomRestEnabled,
            randomRestMinInterval: Math.max(1, settings.randomRestMinInterval),
            randomRestMaxInterval: Math.max(1, settings.randomRestMaxInterval),
            randomRestBreakDuration: Math.max(1, settings.randomRestBreakDuration),
            randomRestSounds: settings.audioSelected?.randomRestSounds || '',
            randomRestEndSound: settings.audioSelected?.randomRestEndSound || '',
            randomRestSystemNotification: settings.randomRestSystemNotification, // 新增
            dailyFocusGoal: settings.dailyFocusGoal,
            randomRestPopupWindow: settings.randomRestPopupWindow,
            pomodoroEndPopupWindow: settings.pomodoroEndPopupWindow,
            pomodoroDockPosition: settings.pomodoroDockPosition || 'top'
        };
    }

    // 获取提醒系统弹窗设置
    async getReminderSystemNotificationEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.reminderSystemNotification !== false;
    }

    // 获取是否显示内部通知框设置
    async getShowInternalNotificationEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.showInternalNotification !== false;
    }

    // 获取通知声音设置
    async getNotificationSound(): Promise<string> {
        const settings = await this.loadSettings();
        return settings.audioSelected?.notificationSound || '';
    }

    // 播放通知声音
    async playNotificationSound() {
        try {
            const soundPath = await this.getNotificationSound();
            if (!soundPath) {
                return;
            }

            if (!this.audioEnabled) {
                return;
            }
            // 如果已经在播放提示音，则避免重复播放
            if (this.isPlayingNotificationSound) {
                console.debug('playNotificationSound - already playing, skip');
                return;
            }
            // 优先使用预加载的音频
            if (this.preloadedAudio && this.preloadedAudio.src.includes(soundPath)) {
                try {
                    this.isPlayingNotificationSound = true;
                    this.preloadedAudio.currentTime = 0;
                    await this.preloadedAudio.play();
                    // 尝试监听 ended 事件以便清理状态
                    this.preloadedAudio.onended = () => {
                        this.isPlayingNotificationSound = false;
                    };
                    // 作为保险，10s后强制清除播放状态，防止意外情况导致状态未被清除
                    setTimeout(() => { this.isPlayingNotificationSound = false; }, 10000);
                    return;
                } catch (error) {
                    console.warn('预加载音频播放失败，尝试创建新音频:', error);
                }
            }

            // 如果预加载音频不可用，创建新的音频实例
            // 创建新的音频实例并播放
            const audio = new Audio(soundPath);
            audio.volume = 1;
            this.isPlayingNotificationSound = true;
            audio.addEventListener('ended', () => {
                this.isPlayingNotificationSound = false;
            });
            // 10s超时清理防止某些浏览器/环境不触发 ended
            const clearTimer = setTimeout(() => {
                this.isPlayingNotificationSound = false;
            }, 10000);
            try {
                await audio.play();
            } finally {
                clearTimeout(clearTimer);
            }

        } catch (error) {
            // 不再显示错误消息，只记录到控制台
            console.warn('播放通知声音失败 (这是正常的，如果用户未交互):', error.name);

            // 如果是权限错误，提示用户
            if (error.name === 'NotAllowedError') {
            }
        }
    }
    private registerDockPanel(options: {
        type: string;
        icon: string;
        title: string;
        text: string;
        init: (element: HTMLElement) => void;
    }) {
        this.registeredDockKeys.add(options.type);
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: options.icon,
                title: options.title,
                hotkey: ""
            },
            data: {
                text: options.text
            },
            resize() {
            },
            update() {
            },
            type: options.type,
            init: (dock) => {
                options.init(dock.element as HTMLElement);
            }
        });
    }

    private ensureProjectDockRegistered() {
        if (this.registeredDockKeys.has("project_dock")) return;
        this.registerDockPanel({
            type: "project_dock",
            icon: "iconProject",
            title: i18n("projectDockTitle"),
            text: "This is my custom dock",
            init: (element) => {
                this.projectDockElement = element;
                this.projectPanel = new ProjectPanel(element, this);
            }
        });
    }

    private ensureReminderDockRegistered() {
        if (this.registeredDockKeys.has("reminder_dock")) return;
        this.registerDockPanel({
            type: "reminder_dock",
            icon: "iconClock",
            title: i18n("dockPanelTitle"),
            text: "This is my custom dock",
            init: (element) => {
                this.reminderPanel = new ReminderPanel(element, this);
            }
        });
    }

    private ensureHabitDockRegistered() {
        if (this.registeredDockKeys.has("habit_dock")) return;
        this.registerDockPanel({
            type: "habit_dock",
            icon: "iconCheck",
            title: "习惯打卡",
            text: "Habit tracking dock",
            init: (element) => {
                new HabitPanel(element, this);
            }
        });
    }

    private ensureCalendarDockRegistered() {
        if (this.registeredDockKeys.has("calendar_dock")) return;
        this.registerDockPanel({
            type: "calendar_dock",
            icon: "iconCalendar",
            title: i18n("calendarDockTitle"),
            text: "Calendar view dock",
            init: (element) => {
                new CalendarView(element, this, { isDockMode: true });
            }
        });
    }

    private async initializeUI() {
        // 加载设置（用于初始显示/隐藏某些停靠栏）
        const settings = await this.loadSettings();
        const isMobile = getFrontend().endsWith('mobile');

        // 手机端在对应侧栏开关关闭时不注册 Dock（移动端无法可靠 hide）
        if (!isMobile || settings.enableProjectDock !== false) {
            this.ensureProjectDockRegistered();
        }

        if (!isMobile || settings.enableReminderDock !== false) {
            this.ensureReminderDockRegistered();
        }

        if (!isMobile || settings.enableHabitDock !== false) {
            this.ensureHabitDockRegistered();
        }

        if (!isMobile || settings.enableCalendarDock !== false) {
            this.ensureCalendarDockRegistered();
        }



        // 注册日历视图标签页
        this.addTab({
            type: TAB_TYPE,
            init: ((tab) => {
                const calendarView = new CalendarView(tab.element, this, tab.data);
                // 保存实例引用用于清理
                this.tabViews.set(tab.id, calendarView);
            }) as any
        });

        // 注册四象限视图标签页
        this.addTab({
            type: EISENHOWER_TAB_TYPE,
            init: ((tab) => {
                const eisenhowerView = new EisenhowerMatrixView(tab.element, this);
                // 保存实例引用用于清理
                this.tabViews.set(tab.id, eisenhowerView);
                // 初始化视图
                eisenhowerView.initialize();
            }) as any
        });

        // 注册项目看板标签页
        this.addTab({
            type: PROJECT_KANBAN_TAB_TYPE,
            init: ((tab) => {
                // 从tab数据中获取projectId
                const projectId = tab.data?.projectId;
                if (!projectId) {
                    console.error('项目看板Tab缺少projectId');
                    tab.element.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">错误：缺少项目ID</div>';
                    return;
                }

                const projectKanbanView = new ProjectKanbanView(tab.element, this, projectId);
                // 保存实例引用用于清理
                this.tabViews.set(tab.id, projectKanbanView);
            }) as any
        });

        // 注册番茄钟标签页
        this.addTab({
            type: POMODORO_TAB_TYPE,
            init: ((tab) => {
                const reminder = tab.data?.reminder;
                const settings = tab.data?.settings;
                const isCountUp = tab.data?.isCountUp || false;
                const inheritState = tab.data?.inheritState;

                if (!reminder || !settings) {
                    console.error('番茄钟Tab缺少必要数据');
                    tab.element.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">错误：缺少番茄钟数据</div>';
                    return;
                }


                // 动态导入PomodoroTimer避免循环依赖
                import("./components/PomodoroTimer").then(({ PomodoroTimer }) => {
                    const pomodoroTimer = new PomodoroTimer(reminder, settings, isCountUp, inheritState, this, tab.element);

                    // 使用统一的tabId格式保存番茄钟实例引用
                    const standardTabId = this.name + POMODORO_TAB_TYPE;
                    this.tabViews.set(standardTabId, pomodoroTimer);
                });
            }) as any,
            destroy: (() => {
                // 当番茄钟Tab关闭时，清除标记

                // 清理tabViews中的引用
                const standardTabId = this.name + POMODORO_TAB_TYPE;
                if (this.tabViews.has(standardTabId)) {
                    this.tabViews.delete(standardTabId);
                }
            }) as any
        });

        // 根据设置隐藏或显示停靠栏图标
        try {
            this.toggleDockVisibility('project_dock', settings.enableProjectDock !== false);
            this.toggleDockVisibility('reminder_dock', settings.enableReminderDock !== false);
            this.toggleDockVisibility('habit_dock', settings.enableHabitDock !== false);
            this.toggleDockVisibility('calendar_dock', settings.enableCalendarDock !== false);
        } catch (err) {
            console.warn('初始化停靠栏可见性失败:', err);
        }

        // 文档块标添加菜单
        const handleDocMenu = this.handleDocumentMenu.bind(this);
        this.eventBus.on('click-editortitleicon', handleDocMenu);
        this.addCleanup(() => this.eventBus.off('click-editortitleicon', handleDocMenu));

        // 块菜单添加菜单
        const handleBlkMenu = this.handleBlockMenu.bind(this);
        this.eventBus.on('click-blockicon', handleBlkMenu);
        this.addCleanup(() => this.eventBus.off('click-blockicon', handleBlkMenu));

        // 定期检查提醒
        this.startReminderCheck();

        // 初始化顶栏徽章和停靠栏徽章
        this.updateBadges();
        this.updateProjectBadges();
        this.updateHabitBadges();

        // 延迟一些时间后再次更新徽章，确保停靠栏已渲染
        const badgeTimer = setTimeout(() => {
            this.updateBadges();
            this.updateProjectBadges();
            this.updateHabitBadges();
        }, 2000);
        this.addCleanup(() => clearTimeout(badgeTimer));

        // 监听提醒更新事件，更新徽章
        const onReminderUpdated = () => {
            this.updateBadges();
            this.scheduleHabitPomodoroAutoSync();
            this.taskNoteDOM.addBreadcrumbButtonsToExistingProtyles();
            const currentProtyle = getActiveEditor(false)?.protyle;
            // 500ms之后调用
            setTimeout(() => {
                this.taskNoteDOM.addBlockProjectButtonsToProtyle(currentProtyle);
            }, 500);
        };
        window.addEventListener('reminderUpdated', onReminderUpdated);
        this.addCleanup(() => window.removeEventListener('reminderUpdated', onReminderUpdated));
        this.addCleanup(() => {
            if (this.habitPomodoroAutoSyncTimer) {
                clearTimeout(this.habitPomodoroAutoSyncTimer);
                this.habitPomodoroAutoSyncTimer = null;
            }
        });

        // 监听项目更新事件，更新项目徽章并重新扫描protyle块按钮
        const onProjectUpdated = () => {
            this.updateProjectBadges();
            this.taskNoteDOM.addBreadcrumbButtonsToExistingProtyles();
        };
        window.addEventListener('projectUpdated', onProjectUpdated);
        this.addCleanup(() => window.removeEventListener('projectUpdated', onProjectUpdated));

        // 监听习惯更新事件，更新习惯徽章
        const onHabitUpdated = () => {
            this.updateHabitBadges();
            this.scheduleHabitPomodoroAutoSync();
        };
        window.addEventListener('habitUpdated', onHabitUpdated);
        this.addCleanup(() => window.removeEventListener('habitUpdated', onHabitUpdated));

        // 监听习惯关联番茄完成事件，确保番茄目标类型也能实时刷新徽章，并执行自动打卡逻辑
        const onHabitPomodoroCompleted = async (event: CustomEvent) => {
            this.updateHabitBadges();
            // 在主要入口处处理自动打卡，确保即使习惯面板未打开也能正常工作
            if (event.detail?.habitId) {
                await this.handleHabitPomodoroSync(event.detail.habitId);
            }
        };
        window.addEventListener('habitPomodoroCompleted', onHabitPomodoroCompleted as EventListener);
        this.addCleanup(() => window.removeEventListener('habitPomodoroCompleted', onHabitPomodoroCompleted as EventListener));
    }

    async onLayoutReady() {
        // 初始化批量设置对话框（确保在UI初始化时创建）
        this.batchReminderDialog = new BatchReminderDialog(this);



        // 注册快捷键
        this.registerCommands();

        // 启动时同步一次番茄习惯自动打卡（处理补录）
        setTimeout(() => {
            this.syncHabitPomodoroAutoCheckIns().catch(e => console.error('Startup habit sync failed:', e));
        }, 3000);

        // 在布局准备就绪后监听 protyle 相关事件，统一初始化按钮
        const initProtyleButtons = (protyle: any) => {
            if (!protyle) return;
            // 延迟添加按钮，确保 protyle 切换/加载已完成
            setTimeout(() => {
                this.taskNoteDOM.addBreadcrumbReminderButton(protyle);
                this.taskNoteDOM.addBlockProjectButtonsToProtyle(protyle);
            }, 500);
        };

        const onProtyleReady = (e: any) => {
            initProtyleButtons(e?.detail?.protyle);
        };

        const protyleEvents = ['switch-protyle', 'loaded-protyle-dynamic', 'loaded-protyle-static'] as const;
        protyleEvents.forEach((eventName) => {
            this.eventBus.on(eventName, onProtyleReady);
            this.addCleanup(() => this.eventBus.off(eventName, onProtyleReady));
        });
        // 为当前已存在的protyle添加按钮
        this.taskNoteDOM.addBreadcrumbButtonsToExistingProtyles();

        // 初始化大纲前缀监听
        this.taskNoteDOM.initOutlinePrefixObserver();
    }


    private async updateBadges() {
        try {
            // 使用 ReminderTaskLogic 的统一逻辑计算今日任务数（包括今日和逾期）
            const { ReminderTaskLogic } = await import("./utils/reminderTaskLogic");
            const uncompletedCount = await ReminderTaskLogic.getTaskCountByTabs(this, ['today', 'overdue'], true);
            this.setDockBadge(uncompletedCount);
        } catch (error) {
            console.error('更新徽章失败:', error);
            this.setDockBadge(0);
        }
    }


    private async updateProjectBadges() {
        try {
            const projectData = await this.loadProjectData();

            if (!projectData || typeof projectData !== 'object') {
                this.setProjectDockBadge(0);
                return;
            }

            // 统计正在进行的项目数量
            // 过滤内部属性（以 '_' 开头，如 _colors），只统计真实项目条目
            let activeCount = 0;
            Object.entries(projectData)
                .filter(([key]) => !key.startsWith('_'))
                .forEach(([, project]: [string, any]) => {
                    if (project && typeof project === 'object') {
                        // 数据迁移：处理旧的 archived 字段
                        const status = project.status || (project.archived ? 'archived' : 'active');
                        if (status === 'active') {
                            activeCount++;
                        }
                    }
                });

            this.setProjectDockBadge(activeCount);
        } catch (error) {
            console.error('更新项目徽章失败:', error);
            this.setProjectDockBadge(0);
        }
    }

    // 等待元素渲染完成后执行的函数
    private whenElementExist(selector: string | (() => Element | null)): Promise<Element> {
        return new Promise(resolve => {
            const checkForElement = () => {
                let element = null;
                if (typeof selector === 'function') {
                    element = selector();
                } else {
                    element = document.querySelector(selector);
                }
                if (element) {
                    resolve(element);
                } else {
                    // 如果元素不存在，等浏览器再次重绘，递归调用checkForElement，直到元素出现
                    requestAnimationFrame(checkForElement);
                }
            };
            checkForElement();
        });
    }

    private async setDockBadgeByType(type: "reminder" | "project" | "habit", count: number) {
        await applyDockBadgeByType({
            plugin: {
                name: this.name,
                loadSettings: () => this.loadSettings(),
                whenElementExist: (selector) => this.whenElementExist(selector)
            },
            type,
            count
        });
    }

    private async setDockBadge(count: number) {
        await this.setDockBadgeByType("reminder", count);
    }

    private async setProjectDockBadge(count: number) {
        await this.setDockBadgeByType("project", count);
    }

    private async updateHabitBadges() {
        try {
            const habitData = await this.loadHabitData();

            if (!habitData || typeof habitData !== 'object') {
                this.setHabitDockBadge(0);
                return;
            }

            const today = getLogicalDateString();
            const buckets = getTodayHabitBuckets(Object.values(habitData) as any[], today, {
                getPomodoroFocusMinutes: (habitId, date) => {
                    const manager = PomodoroRecordManager.getInstance(this);
                    return manager.getEventFocusTime(habitId, date) || 0;
                }
            });

            this.setHabitDockBadge(buckets.pendingHabits.length);
        } catch (error) {
            console.error('更新习惯徽章失败:', error);
            this.setHabitDockBadge(0);
        }
    }

    private async setHabitDockBadge(count: number) {
        await this.setDockBadgeByType("habit", count);
    }

    // 控制停靠栏可见性：通过隐藏停靠栏图标实现启用/禁用（不注销注册）
    private async toggleDockVisibility(dockKey: string, visible: boolean) {
        try {
            if (!this.registeredDockKeys.has(dockKey)) return;
            const selector = getDockItemSelector(this.name, dockKey);
            const dockIcon = await this.whenElementExist(selector) as HTMLElement;
            if (!dockIcon) return;
            dockIcon.style.display = visible ? '' : 'none';
            // 如果隐藏时面板处于打开状态，尝试关闭相关面板节点
            if (!visible) {
                // 关闭面板的最简单方法：尝试触发一次点击事件（如果存在）以收起
                try {
                    const btn = dockIcon.querySelector('button');
                    if (btn) (btn as HTMLElement).click();
                } catch (err) {
                    // ignore
                }
            }
        } catch (err) {
            // ignore if not exist yet
        }
    }

    // 获取已继承的项目、分组、里程碑和分类
    private async getInheritedProjectAndGroup(blockId: string) {
        const { getBlockByID, sql } = await import("./api");
        const block = await getBlockByID(blockId);
        if (!block) return { projectId: undefined, groupId: undefined, milestoneId: undefined, categoryId: undefined };

        const reminderData = await this.loadReminderData();
        const rootId = block.root_id;
        const parentId = block.parent_id;

        // 1. 优先检查父块 — 使用递归 SQL 一次性获取祖先链，避免多次 getBlockByID 调用
        let ancestors: any[] = [];
        try {
            if (parentId) {
                const ancRows = await sql(`WITH RECURSIVE anc(id,parent_id,root_id,type,subtype) AS (
                        SELECT id,parent_id,root_id,type,subtype FROM blocks WHERE id='${parentId}'
                        UNION ALL
                        SELECT b.id,b.parent_id,b.root_id,b.type,b.subtype FROM blocks b JOIN anc a ON b.id = a.parent_id
                    )
                    SELECT id,parent_id,root_id,type,subtype FROM anc;
                `);
                const ancMap: Record<string, any> = {};
                (ancRows || []).forEach((r: any) => ancMap[r.id] = r);
                // 从最近父块开始，按向上顺序构造 ancestors 数组
                let cur = parentId;
                while (cur && cur !== rootId && ancMap[cur]) {
                    ancestors.push(ancMap[cur]);
                    cur = ancMap[cur].parent_id;
                }
            }
        } catch (err) {
            // 回退到逐层获取（兼容性保障）
            let currentParentId = parentId;
            while (currentParentId && currentParentId !== rootId) {
                const parentBlock = await getBlockByID(currentParentId);
                if (!parentBlock) break;
                ancestors.push(parentBlock);
                currentParentId = parentBlock.parent_id;
            }
        }

        // 在祖先链中查找第一个含有 projectId 的 reminder
        for (const anc of ancestors) {
            const parentReminder = Object.values(reminderData).find((r: any) => r.blockId === anc.id && r.projectId);
            if (parentReminder) {
                return {
                    projectId: (parentReminder as any).projectId,
                    groupId: (parentReminder as any).customGroupId,
                    milestoneId: (parentReminder as any).milestoneId,
                    categoryId: (parentReminder as any).categoryId
                };
            }
        }

        // 1.5 补充：当项目/分组绑定的是“块”时，同文档下的块新建任务也应继承（非该分组绑定块的子块）
        if (block.type !== 'd' && rootId) {
            const projectData = await this.loadProjectData();
            if (projectData) {
                const projectList = Object.entries(projectData)
                    .filter(([key, value]) => !key.startsWith('_') && value && typeof value === 'object')
                    .map(([key, value]) => {
                        const project = value as any;
                        return {
                            ...project,
                            __projectId: project.id || key
                        };
                    }) as any[];

                const blockInfoCache = new Map<string, any | null>();
                const getBlockInfoWithCache = async (id?: string) => {
                    if (!id) return null;
                    if (blockInfoCache.has(id)) return blockInfoCache.get(id);
                    const blockInfo = await getBlockByID(id);
                    blockInfoCache.set(id, blockInfo || null);
                    return blockInfo || null;
                };

                const ancestorIdSet = new Set((ancestors || []).map((item: any) => item.id));

                // 1.5.1 优先匹配分组绑定块：同文档且不是该绑定块子块时，也默认继承该分组
                for (const p of projectList) {
                    if (!p.customGroups || !Array.isArray(p.customGroups)) continue;
                    for (const group of p.customGroups) {
                        if (group?.archived) continue;
                        const groupBlockId = group?.blockId;
                        if (!groupBlockId || groupBlockId === rootId) continue;
                        if (ancestorIdSet.has(groupBlockId)) continue;

                        const groupBlock = await getBlockInfoWithCache(groupBlockId);
                        if (groupBlock?.root_id === rootId) {
                            return {
                                projectId: p.__projectId,
                                groupId: group.id,
                                milestoneId: undefined,
                                categoryId: undefined
                            };
                        }
                    }
                }

                // 1.5.2 其次匹配项目绑定块：同文档块默认继承项目（无分组）
                for (const p of projectList) {
                    const projectBlockId = p?.blockId;
                    if (!projectBlockId || projectBlockId === rootId) continue;
                    if (ancestorIdSet.has(projectBlockId)) continue;

                    const projectBlock = await getBlockInfoWithCache(projectBlockId);
                    if (projectBlock?.root_id === rootId) {
                        return {
                            projectId: p.__projectId,
                            groupId: undefined,
                            milestoneId: undefined,
                            categoryId: undefined
                        };
                    }
                }
            }
        }

        // 2. 检查最近的同级标题
        if (block.type === 'h' && (block as any).subtype) {
            const siblingHeadings = await sql(`
                SELECT b.id
                FROM blocks AS b
                WHERE b.root_id = '${rootId}' 
                AND b.parent_id = '${block.parent_id}'
                AND b.subtype = '${(block as any).subtype}'
                AND (EXISTS (
                    SELECT 1 FROM attributes 
                    WHERE block_id = b.id 
                        AND name = 'custom-bind-reminders' 
                        AND value != ''
                )
                OR EXISTS (
                    SELECT 1 FROM attributes 
                    WHERE block_id = b.id 
                        AND name = 'custom-task-projectid' 
                        AND value != ''
                ))
                ORDER BY updated DESC 
                LIMIT 1

        `);
            if (siblingHeadings && siblingHeadings.length > 0) {
                const headingId = siblingHeadings[0].id;
                const headingReminder = Object.values(reminderData).find((r: any) => r.blockId === headingId && r.projectId);
                if (headingReminder) {
                    return {
                        projectId: (headingReminder as any).projectId,
                        groupId: (headingReminder as any).customGroupId,
                        milestoneId: (headingReminder as any).milestoneId,
                        categoryId: (headingReminder as any).categoryId
                    };
                }
            }
        }



        // 3. 检查文档根块
        if (rootId) {
            const rootReminder = Object.values(reminderData).find((r: any) => r.blockId === rootId && r.projectId);
            if (rootReminder) {
                return {
                    projectId: (rootReminder as any).projectId,
                    groupId: (rootReminder as any).customGroupId,
                    milestoneId: (rootReminder as any).milestoneId,
                    categoryId: (rootReminder as any).categoryId
                };
            }
        }

        // 4. Fallback: 检查文档是否本身是项目，或者是否绑定了某个项目分组
        const projectData = await this.loadProjectData();
        if (projectData) {
            const projectList = Object.entries(projectData)
                .filter(([key, value]) => !key.startsWith('_') && value && typeof value === 'object')
                .map(([key, value]) => {
                    const project = value as any;
                    return {
                        ...project,
                        __projectId: project.id || key
                    };
                }) as any[];

            // 4.0 先检查父块路径是否是项目或者项目分组的绑定块（使用已获取的 ancestors，避免额外查询）
            const parentChain = ancestors && ancestors.length > 0 ? ancestors : [];
            if (parentChain.length === 0 && parentId) {
                // 如果 ancestors 为空，但仍有 parentId，尝试逐层获取作为兜底（极少数情况）
                let checkParentId = parentId;
                while (checkParentId && checkParentId !== rootId) {
                    const parentBlock = await getBlockByID(checkParentId);
                    if (!parentBlock) break;
                    parentChain.push(parentBlock);
                    checkParentId = parentBlock.parent_id;
                }
            }

            for (const parentBlock of parentChain) {
                const checkId = parentBlock.id;
                // Check if this parent block is a project main block
                const parentProject = projectList.find((p: any) => p.blockId === checkId);
                if (parentProject) {
                    return {
                        projectId: (parentProject as any).__projectId,
                        groupId: undefined,
                        milestoneId: undefined,
                        categoryId: undefined
                    };
                }

                // Check if this parent block is a project group block
                for (const p of projectList) {
                    if (p.customGroups && Array.isArray(p.customGroups)) {
                        const group = p.customGroups.find((g: any) => g.blockId === checkId);
                        if (group) {
                            return {
                                projectId: p.__projectId,
                                groupId: group.id,
                                milestoneId: undefined,
                                categoryId: undefined
                            };
                        }
                    }
                }
            }

            // 4.1 检查是否是项目主文档
            const project = projectList.find((p: any) => p.blockId === rootId);
            if (project) {
                return {
                    projectId: (project as any).__projectId,
                    groupId: undefined,
                    milestoneId: undefined,
                    categoryId: undefined
                };
            }

            // 4.2 检查是否是项目分组的绑定文档
            for (const p of projectList) {
                if (p.customGroups && Array.isArray(p.customGroups)) {
                    const group = p.customGroups.find((g: any) => g.blockId === rootId);
                    if (group) {
                        return {
                            projectId: p.__projectId,
                            groupId: group.id,
                            milestoneId: undefined,
                            categoryId: undefined
                        };
                    }
                }
            }
        }

        return { projectId: undefined, groupId: undefined, milestoneId: undefined, categoryId: undefined };
    }

    private handleDocumentTreeMenu({ detail }) {
        const elements = detail.elements;
        if (!elements || !elements.length) {
            return;
        }
        // 获取所有选中的文档ID
        const documentIds = Array.from(elements)
            .map((element: Element) => element.getAttribute("data-node-id"))
            .filter((id: string | null): id is string => id !== null);

        if (!documentIds.length) return;

        // 第一个选中的文档（用于项目笔记设置和查看文档提醒）
        const firstDocumentId = documentIds[0];

        // 添加分隔符
        detail.menu.addSeparator();

        // 添加设置时间提醒菜单项
        detail.menu.addItem({
            iconHTML: "⏰",
            label: documentIds.length > 1 ?
                i18n("batchSetReminderBlocks", { count: documentIds.length.toString() }) :
                i18n("setTimeReminder"),
            click: async () => {
                if (documentIds.length > 1) {
                    // 确保 batchReminderDialog 已初始化
                    if (!this.batchReminderDialog) {
                        this.batchReminderDialog = new BatchReminderDialog(this);
                    }
                    // 多选文档使用批量设置对话框
                    this.batchReminderDialog.show(documentIds);
                } else {
                    // 单选文档使用普通设置对话框，使用设置中的自动检测配置
                    const autoDetect = await this.getAutoDetectDateTimeEnabled();
                    // 如果文档本身是一个项目，传入该项目ID作为默认项目
                    try {
                        const { projectId, groupId, milestoneId, categoryId } = await this.getInheritedProjectAndGroup(firstDocumentId);
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: firstDocumentId,
                            autoDetectDateTime: autoDetect,
                            defaultProjectId: projectId,
                            defaultCustomGroupId: groupId,
                            defaultMilestoneId: milestoneId,
                            defaultCategoryId: categoryId,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    } catch (err) {
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: firstDocumentId,
                            autoDetectDateTime: autoDetect,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    }
                }
            }
        });

        // 添加查看文档所有提醒菜单项（只处理第一个选中的文档）
        if (documentIds.length === 1) {
            detail.menu.addItem({
                iconHTML: "📋",
                label: i18n("viewDocumentAllReminders"),
                click: () => {
                    const documentReminderDialog = new DocumentReminderDialog(documentIds[0], this);
                    documentReminderDialog.show();
                }
            });
        }


        // 添加设置为项目笔记菜单项（只处理第一个选中的文档）
        detail.menu.addItem({
            iconHTML: "📂",
            label: i18n("projectManagement"),
            click: async () => {
                const projectData = await this.loadProjectData();
                const isProject = projectData && projectData.hasOwnProperty(firstDocumentId);
                if (isProject) {
                    // 打开项目看板
                    this.openProjectKanbanTab(
                        projectData[firstDocumentId].blockId,
                        projectData[firstDocumentId].title
                    );
                } else {
                    // 循环传递所有id
                    for (const docId of documentIds) {
                        const dialog = new ProjectDialog(docId, this);
                        dialog.show();
                    }
                }
            }
        });
    }
    private handleDocumentMenu({ detail }) {
        const documentId = detail.protyle.block.rootID;

        detail.menu.addItem({
            iconHTML: "⏰",
            label: i18n("setTimeReminder"),
            click: async () => {
                if (documentId) {
                    const autoDetect = await this.getAutoDetectDateTimeEnabled();
                    try {
                        const { projectId, groupId, milestoneId, categoryId } = await this.getInheritedProjectAndGroup(documentId);
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            defaultProjectId: projectId,
                            defaultCustomGroupId: groupId,
                            defaultMilestoneId: milestoneId,
                            defaultCategoryId: categoryId,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    } catch (err) {
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    }
                }
            }
        });

        // 添加文档提醒查看功能
        detail.menu.addItem({
            iconHTML: "📋",
            label: i18n("documentReminderManagement"),
            click: () => {
                if (documentId) {
                    const documentReminderDialog = new DocumentReminderDialog(documentId, this);
                    documentReminderDialog.show();
                }
            }
        });

        // 添加项目笔记设置功能
        detail.menu.addItem({
            iconHTML: "📂",
            label: i18n("projectManagement"),
            click: async () => {
                if (documentId) {
                    const projectData = await this.loadProjectData();
                    const isProject = projectData && projectData.hasOwnProperty(documentId);

                    if (isProject) {
                        // 打开项目看板
                        this.openProjectKanbanTab(
                            projectData[documentId].blockId,
                            projectData[documentId].title
                        );
                    } else {
                        const dialog = new ProjectDialog(documentId, this);
                        dialog.show();
                    }
                }
            }
        });


    }

    private handleBlockMenu({ detail }) {
        // 检查选中的块是否为列表块
        const isListBlock = detail.blockElements && detail.blockElements.length === 1 &&
            detail.blockElements[0].getAttribute("data-type") === "NodeList";

        // 列表块同时显示"设置任务"和"批量设置任务"
        if (isListBlock) {
            const listBlockElement = detail.blockElements[0];
            const listBlockId = listBlockElement.getAttribute("data-node-id");
            // 从DOM中获取列表项数量（列表项的data-type为"NodeListItem"）
            // 思源列表结构：列表块 > 子元素（直接是列表项div[data-type="NodeListItem"]）
            const listItems = listBlockElement.querySelectorAll(':scope > [data-type="NodeListItem"]');
            const listItemCount = listItems.length;

            // 1. 设置任务（给列表块本身设置任务）
            detail.menu.addItem({
                iconHTML: "⏰",
                label: i18n("setTimeReminder"),
                click: () => {
                    const blockId = listBlockElement.getAttribute("data-node-id");
                    if (blockId) {
                        this.handleMultipleBlocks([blockId]);
                    }
                }
            });

            // 2. 批量设置任务（给所有列表项子块设置任务）
            detail.menu.addItem({
                iconHTML: "⏰",
                label: i18n("batchSetReminderBlocks", { count: listItemCount.toString() }),
                click: async () => {
                    if (listBlockId) {
                        const blockIds = await this.getListItemBlockIds(listBlockId);
                        if (blockIds.length > 0) {
                            this.handleMultipleBlocks(blockIds);
                        }
                    }
                }
            });
        } else {
            // 非列表块，按原有逻辑显示
            detail.menu.addItem({
                iconHTML: "⏰",
                label: detail.blockElements.length > 1 ? i18n("batchSetReminderBlocks", { count: detail.blockElements.length.toString() }) : i18n("setTimeReminder"),
                click: () => {
                    if (detail.blockElements && detail.blockElements.length > 0) {
                        const blockIds = detail.blockElements
                            .map(el => el.getAttribute("data-node-id"))
                            .filter(id => id);

                        if (blockIds.length > 0) {
                            this.handleMultipleBlocks(blockIds);
                        }
                    }
                }
            });
        }

        // 添加查看绑定任务菜单项（仅当选中单个块且有custom-bind-reminders属性时显示）
        if (detail.blockElements && detail.blockElements.length === 1) {
            const blockElement = detail.blockElements[0];
            const blockId = blockElement.getAttribute("data-node-id");

            if (blockId) {
                detail.menu.addItem({
                    iconHTML: "🍅",
                    label: i18n("startPomodoro") || "开始番茄钟",
                    submenu: this.createBlockPomodoroStartSubmenu(blockId)
                });
            }

            if (blockId && blockElement.hasAttribute("custom-bind-reminders")) {
                detail.menu.addItem({
                    iconHTML: "📋",
                    label: "查看绑定任务",
                    click: async () => {
                        const { BlockRemindersDialog } = await import("./components/BlockRemindersDialog");
                        const dialog = new BlockRemindersDialog(blockId, this);
                        await dialog.show();
                    }
                });
            }
        }

    }

    private async buildPomodoroReminderFromBlock(blockId: string): Promise<any | null> {
        try {
            const { getBlockByID } = await import("./api");
            const block = await getBlockByID(blockId);
            if (!block) {
                showMessage(i18n("blockNotExist") || "块不存在", 2500);
                return null;
            }

            const rawTitle = String(block.content || "").trim();
            const title = rawTitle || (i18n("untitledTask") || "未命名任务");
            return {
                id: blockId,
                title: title.length > 80 ? `${title.slice(0, 80)}...` : title,
                blockId,
                isBlockPomodoro: true,
            };
        } catch (error) {
            console.error("读取块信息失败，无法启动番茄钟:", error);
            showMessage(i18n("blockPreviewFailed") || "获取块信息失败", 3000);
            return null;
        }
    }

    private createBlockPomodoroStartSubmenu(blockId: string): any[] {
        return createSharedPomodoroStartSubmenu({
            source: {
                id: blockId,
                title: i18n("untitledTask") || "未命名任务",
            },
            plugin: this,
            startPomodoro: (workDurationOverride?: number) => this.startPomodoroForBlock(blockId, workDurationOverride),
        });
    }

    private async startPomodoroForBlock(blockId: string, workDurationOverride?: number) {
        const reminder = await this.buildPomodoroReminderFromBlock(blockId);
        if (!reminder) return;

        const pomodoroManager = PomodoroManager.getInstance();
        if (pomodoroManager.hasActivePomodoroTimer()) {
            const currentState = pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || (i18n("untitledTask") || "未命名任务");
            const newTitle = reminder.title || (i18n("untitledTask") || "未命名任务");

            let confirmMessage = `${i18n("currentPomodoroTask") || "当前番茄钟任务"}："${currentTitle}"\n${i18n("switchPomodoroTask") || "切换番茄钟任务"}："${newTitle}"`;
            if (currentState.isRunning && !currentState.isPaused) {
                if (!pomodoroManager.pauseCurrentTimer()) {
                    console.warn("暂停当前番茄钟失败");
                }
                confirmMessage += `\n\n${i18n("confirm") || "确定"}后将继承当前计时进度继续。`;
            }

            confirm(
                i18n("switchPomodoroTask") || "切换番茄钟任务",
                confirmMessage,
                () => {
                    this.performStartPomodoroForBlock(reminder, currentState, workDurationOverride).catch((error) => {
                        console.error("切换番茄钟任务失败:", error);
                        showMessage(i18n("operationFailed"), 3000);
                    });
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        pomodoroManager.resumeCurrentTimer();
                    }
                }
            );
            return;
        }

        pomodoroManager.cleanupInactiveTimer();
        await this.performStartPomodoroForBlock(reminder, undefined, workDurationOverride);
    }

    private async performStartPomodoroForBlock(reminder: any, inheritState?: any, workDurationOverride?: number) {
        const settings = await this.getPomodoroSettings();
        const runtimeSettings = workDurationOverride && workDurationOverride > 0
            ? { ...settings, workDuration: workDurationOverride }
            : settings;

        const hasStandaloneWindow = (this as any).pomodoroWindowId;
        if (hasStandaloneWindow && typeof (this as any).openPomodoroWindow === "function") {
            await (this as any).openPomodoroWindow(reminder, runtimeSettings, false, inheritState);
            return;
        }

        const pomodoroManager = PomodoroManager.getInstance();
        pomodoroManager.closeCurrentTimer();

        const { PomodoroTimer } = await import("./components/PomodoroTimer");
        const pomodoroTimer = new PomodoroTimer(reminder, runtimeSettings, false, inheritState, this);
        pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);
        pomodoroTimer.show();
    }

    /**
     * 获取列表块的所有列表项子块ID
     * @param listBlockId 列表块ID
     * @returns 列表项子块ID数组
     */
    private async getListItemBlockIds(listBlockId: string): Promise<string[]> {
        try {
            const { getChildBlocks } = await import("./api");
            const childBlocks = await getChildBlocks(listBlockId);
            if (childBlocks && Array.isArray(childBlocks)) {
                // 过滤出列表项块（type为'i'表示列表项）
                return childBlocks
                    .filter(block => block.type === 'i')
                    .map(block => block.id)
                    .filter(id => id);
            }
        } catch (error) {
            console.warn('获取列表项子块失败:', error);
        }
        return [];
    }

    private async handleMultipleBlocks(blockIds: string[]) {
        if (blockIds.length === 1) {
            // 单个块时使用普通对话框，应用自动检测设置
            const autoDetect = await this.getAutoDetectDateTimeEnabled();
            try {
                const { projectId, groupId, milestoneId, categoryId } = await this.getInheritedProjectAndGroup(blockIds[0]);
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId: blockIds[0],
                    autoDetectDateTime: autoDetect,
                    defaultProjectId: projectId,
                    defaultCustomGroupId: groupId,
                    defaultMilestoneId: milestoneId,
                    defaultCategoryId: categoryId,
                    mode: 'block',
                    plugin: this
                });
                dialog.show();
            } catch (err) {
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId: blockIds[0],
                    autoDetectDateTime: autoDetect,
                    mode: 'block',
                    plugin: this
                });
                dialog.show();
            }
        } else {
            // 确保 batchReminderDialog 已初始化
            if (!this.batchReminderDialog) {
                this.batchReminderDialog = new BatchReminderDialog(this);
            }

            // 尝试获取第一个块的继承信息作为默认值
            let defaultSettings = {};
            try {
                const { projectId, groupId, milestoneId, categoryId } = await this.getInheritedProjectAndGroup(blockIds[0]);
                defaultSettings = {
                    defaultProjectId: projectId,
                    defaultCustomGroupId: groupId,
                    defaultMilestoneId: milestoneId,
                    defaultCategoryId: categoryId
                };
            } catch (err) {
                console.warn('获取继承设置失败:', err);
            }

            // 使用新的批量设置组件
            await this.batchReminderDialog.show(blockIds, defaultSettings);
        }
    }

    private initCoordinator() {
        const channelName = this.getWorkspaceScopedChannelName('siyuan-plugin-task-note-management-coordinator');
        this.coordinatorChannel = new BroadcastChannel(channelName);

        // 监听来自其他窗口的消息
        this.coordinatorChannel.onmessage = (event) => {
            const type = event.data?.type;
            if (type === 'reminderUpdated' || type === 'habitUpdated') {
                // 转发给当前窗口的其他组件，附带标记避免循环发送
                window.dispatchEvent(new CustomEvent(type, { detail: { _fromSync: true } }));
                // 刷新徽章
                this.updateBadges();
                this.updateProjectBadges();
                this.updateHabitBadges();
            } else if (type === 'pomodoroQueryActive') {
                // 若本窗口有活跃的番茄钟，通知询问方无需再次恢复
                if (PomodoroManager.getInstance().hasActivePomodoroTimer()) {
                    this.coordinatorChannel.postMessage({ type: 'pomodoroActiveConfirm', instanceId: this.instanceId });
                }
            }
        };

        // 监听当前窗口的事件并广播
        const broadcastEvent = (e: CustomEvent) => {
            if (e.detail?._fromSync) return;
            this.coordinatorChannel?.postMessage({ type: e.type });
        };

        window.addEventListener('reminderUpdated', broadcastEvent as any);
        window.addEventListener('habitUpdated', broadcastEvent as any);

        this.addCleanup(() => {
            window.removeEventListener('reminderUpdated', broadcastEvent as any);
            window.removeEventListener('habitUpdated', broadcastEvent as any);
        });
    }

    /**
     * 检查当前窗口是否为负责后台任务（如提醒、同步）的主窗口
     */
    private isPrimaryInstance(): boolean {
        const now = Date.now();
        const lockKey = `siyuan_task_note_coordinator_lock`;
        const lockStr = localStorage.getItem(lockKey);

        if (lockStr) {
            try {
                const lock = JSON.parse(lockStr);
                // 如果锁被其他实例持有，且它是活跃的（45s内有更新，计时器每30s更新一次）
                if (lock.instanceId !== this.instanceId && now - lock.timestamp < 45000) {
                    return false;
                }
            } catch (e) {
                // ignore
            }
        }

        // 抢占或刷新锁
        localStorage.setItem(lockKey, JSON.stringify({
            instanceId: this.instanceId,
            timestamp: now
        }));
        return true;
    }

    private startReminderCheck() {
        // 每30秒检查一次提醒
        if (this.reminderCheckTimer) clearInterval(this.reminderCheckTimer);
        this.reminderCheckTimer = window.setInterval(() => {
            if (this.isPrimaryInstance()) {
                this.checkReminders();
            }
        }, 30000);

        // 启动时延迟检查一次
        const initCheckTimer = setTimeout(() => {
            if (this.isPrimaryInstance()) {
                this.checkReminders();
            }
        }, 5000);
        this.addCleanup(() => clearTimeout(initCheckTimer));
    }

    private async checkReminders() {
        try {
            const { generateRepeatInstances } = await import("./utils/repeatUtils");
            let reminderData = await this.loadReminderData();

            // 检查数据是否有效，如果数据被损坏（包含错误信息），重新初始化
            if (!reminderData || typeof reminderData !== 'object' ||
                reminderData.hasOwnProperty('code') || reminderData.hasOwnProperty('msg')) {
                console.warn('检测到损坏的提醒数据，重新初始化:', reminderData);
                reminderData = {};
                await this.saveReminderData(reminderData);
                return;
            }

            const today = getLogicalDateString();

            // 检查日期变更
            if (this.currentLogicalDate && today !== this.currentLogicalDate) {
                this.currentLogicalDate = today;
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                // 跨天后同步刷新习惯侧栏（HabitPanel 监听 habitUpdated）
                window.dispatchEvent(new CustomEvent('habitUpdated'));
            } else if (!this.currentLogicalDate) {
                this.currentLogicalDate = today;
            }

            const currentTime = getLocalTimeString();
            const currentTimeNumber = this.timeStringToNumber(currentTime);

            // 获取用户设置的每日通知时间（HH:MM）并解析为数字（HHMM）以便比较
            const dailyNotificationTime = await this.getDailyNotificationTime();
            const dailyNotificationTimeNumber = this.timeStringToNumber(dailyNotificationTime);

            // 检查单个时间提醒（不受每日通知时间限制）
            // 同时合并已启用的订阅日历任务，使订阅事件也能触发到期提醒
            let reminderDataForTimeCheck = reminderData;
            try {
                const subscriptionData = await this.loadSubscriptionData();
                if (subscriptionData && subscriptionData.subscriptions) {
                    const enabledSubs = (Object.values(subscriptionData.subscriptions) as any[]).filter(s => s.enabled);
                    if (enabledSubs.length > 0) {
                        const merged: any = { ...reminderData };
                        for (const sub of enabledSubs) {
                            const subTasks = await this.loadSubscriptionTasks(sub.id);
                            if (subTasks && typeof subTasks === 'object') {
                                Object.assign(merged, subTasks);
                            }
                        }
                        reminderDataForTimeCheck = merged;
                    }
                }
            } catch (err) {
                console.warn('加载订阅任务失败，跳过订阅提醒检查:', err);
            }
            await this.checkTimeReminders(reminderDataForTimeCheck, getLocalDateString(), currentTime);

            // 检查习惯提醒（当有习惯在今日设置了 reminderTime 时，也应触发提醒）
            try {
                await this.checkHabitReminders(today, currentTime);
            } catch (err) {
                console.warn('检查习惯提醒失败:', err);
            }

            // 只在设置的时间后进行全天事项的每日汇总提醒检查
            if (currentTimeNumber < dailyNotificationTimeNumber) {
                return;
            }

            // 检查是否启用了每日统一通知
            const dailyNotificationEnabled = await this.getDailyNotificationEnabled();
            if (!dailyNotificationEnabled) {
                return;
            }

            // 检查今天是否已经提醒过全天事件（先检查持久化记录，防止重启后重复通知）
            const dailyNotifyKey = `daily_${today}`;
            try {
                const alreadyNotified = await this.hasNotifiedToday(today);
                if (alreadyNotified) {
                    return;
                }
            } catch (err) {
                console.warn('检查持久化通知记录失败:', err);
            }

            // 再检查内存标记以避免重复触发
            if (this.notifiedReminders.has(dailyNotifyKey)) {
                return;
            }

            // 处理重复事件 - 生成重复实例
            const allReminders = [];
            const repeatInstancesMap = new Map();

            Object.values(reminderData).forEach((reminder: any) => {
                // 验证 reminder 对象是否有效
                if (!reminder || typeof reminder !== 'object') {
                    console.warn('无效的提醒项:', reminder);
                    return;
                }

                // 检查必要的属性
                if (typeof reminder.completed !== 'boolean' || !reminder.id) {
                    console.warn('提醒项缺少必要属性:', reminder);
                    return;
                }

                // 对于重复事件，不再添加原始事件（避免与生成的实例产生重复并错误识别为过期）
                if (!reminder.repeat?.enabled) {
                    allReminders.push(reminder);
                }

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, today, today);
                    repeatInstances.forEach(instance => {
                        // 为生成的实例创建独立的呈现对象（包含 instance 级别的修改）
                        // 从 instanceId (格式: originalId_YYYY-MM-DD) 中提取原始生成日期
                        const originalInstanceDate = instance.instanceId.split('_').pop() || instance.date;

                        // 检查实例级别的完成状态
                        const completedInstances = reminder.repeat?.completedInstances || [];
                        let isInstanceCompleted = completedInstances.includes(originalInstanceDate);

                        // 检查实例级别的修改（包括备注、优先级、分类等）
                        const instanceModifications = reminder.repeat?.instanceModifications || {};
                        const instanceMod = instanceModifications[originalInstanceDate];

                        // 如果原始任务在每日完成记录中标记了今天已完成（跨天标记），则该实例应视为已完成
                        if (!isInstanceCompleted && reminder.dailyCompletions && reminder.dailyCompletions[originalInstanceDate]) {
                            isInstanceCompleted = true;
                        }

                        const instanceReminder = {
                            ...reminder,
                            id: instance.instanceId,
                            date: instance.date,
                            endDate: instance.endDate,
                            reminderTimes: instanceMod?.reminderTimes !== undefined ? instanceMod.reminderTimes : instance.reminderTimes,
                            customReminderPreset: instanceMod?.customReminderPreset !== undefined ? instanceMod.customReminderPreset : instance.customReminderPreset,
                            time: instance.time,
                            endTime: instance.endTime,
                            isRepeatInstance: true,
                            originalId: instance.originalId,
                            completed: isInstanceCompleted,
                            note: instanceMod?.note || reminder.note,
                            priority: instanceMod?.priority !== undefined ? instanceMod.priority : reminder.priority,
                            categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : reminder.categoryId,
                            projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : reminder.projectId
                        };

                        const key = `${reminder.id}_${instance.date}`;
                        if (!repeatInstancesMap.has(key) ||
                            compareDateStrings(instance.date, repeatInstancesMap.get(key).date) < 0) {
                            repeatInstancesMap.set(key, instanceReminder);
                        }
                    });
                }
            });

            // 添加去重后的重复事件实例
            repeatInstancesMap.forEach(instance => {
                allReminders.push(instance);
            });

            // 筛选今日提醒 - 进行分类和排序
            const todayReminders = allReminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 如果是跨天事件并且已经标记了今日已完成，则不加入今日提醒
                // 对非重复事件直接检查 dailyCompletions；重复实例在生成时已处理并设置 completed
                if (reminder.endDate && reminder.dailyCompletions && reminder.dailyCompletions[today]) {
                    return false;
                }

                if (reminder.endDate) {
                    // 跨天事件：只要今天在事件的时间范围内就显示，或者事件已过期但结束日期在今天之前
                    return (compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0) ||
                        compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 单日事件：今天或过期的都显示在今日
                    return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                }
            });

            // 收集需要提醒的今日事项
            const remindersToShow: any[] = [];

            todayReminders.forEach((reminder: any) => {
                // 获取分类信息
                let categoryInfo = {};
                if (reminder.categoryId) {
                    const category = this.categoryManager.getCategoryById(reminder.categoryId);
                    if (category) {
                        categoryInfo = {
                            categoryName: category.name,
                            categoryColor: category.color,
                            categoryIcon: category.icon
                        };
                    }
                }

                // 判断是否全天事件
                const isAllDay = !reminder.time || reminder.time === '';

                // 构建完整的提醒信息
                const dt = this.extractDateAndTime(reminder.time);
                const displayTime = dt?.time || reminder.time;
                const reminderInfo = {
                    id: reminder.id,
                    blockId: reminder.blockId,
                    title: reminder.title || i18n("unnamedNote"),
                    note: reminder.note,
                    priority: reminder.priority || 'none',
                    categoryId: reminder.categoryId,
                    time: displayTime,
                    date: reminder.date,
                    endDate: reminder.endDate,
                    isAllDay: isAllDay,
                    isOverdue: reminder.endDate ?
                        compareDateStrings(reminder.endDate, today) < 0 :
                        compareDateStrings(reminder.date, today) < 0,
                    ...categoryInfo
                };

                remindersToShow.push(reminderInfo);
            });

            // 显示今日提醒 - 进行分类和排序
            if (remindersToShow.length > 0) {
                // 对提醒事件进行分类
                const overdueReminders = remindersToShow.filter(r => r.isOverdue);
                const todayTimedReminders = remindersToShow.filter(r => !r.isOverdue && !r.isAllDay && r.time);
                const todayNoTimeReminders = remindersToShow.filter(r => !r.isOverdue && !r.isAllDay && !r.time);
                const todayAllDayReminders = remindersToShow.filter(r => !r.isOverdue && r.isAllDay);

                // 对每个分类内部排序
                // 过期事件：按日期排序（最早的在前）
                overdueReminders.sort((a, b) => {
                    const dateCompare = a.date.localeCompare(b.date);
                    if (dateCompare !== 0) return dateCompare;
                    // 同一天的按时间排序
                    return (a.time || '').localeCompare(b.time || '');
                });

                // 今日有时间事件：按时间排序
                todayTimedReminders.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

                // 今日无时间事件：按标题排序
                todayNoTimeReminders.sort((a, b) => a.title.localeCompare(b.title));

                // 全天事件：按标题排序
                todayAllDayReminders.sort((a, b) => a.title.localeCompare(b.title));

                // 合并排序后的数组：过期 -> 有时间 -> 无时间 -> 全天
                const sortedReminders = [
                    ...overdueReminders,
                    ...todayTimedReminders,
                    ...todayNoTimeReminders,
                    ...todayAllDayReminders
                ];

                // 播放通知声音
                await this.playNotificationSound();

                // 检查是否启用系统弹窗通知
                const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
                const showInternalNotification = await this.getShowInternalNotificationEnabled();

                // 根据设置决定是否显示内部通知框
                if (showInternalNotification) {
                    NotificationDialog.showAllDayReminders(sortedReminders);
                }

                // 如果启用了系统弹窗，显示系统通知
                if (systemNotificationEnabled) {
                    const totalCount = sortedReminders.length;
                    const title = '📅 ' + i18n("dailyRemindersNotification") + ` (${totalCount})`;

                    // 创建任务列表 - 直接显示所有任务
                    let taskList = ``;

                    // 显示前2个任务
                    sortedReminders.slice(0, 2).forEach(reminder => {
                        let timeText = '';
                        // 使用仅时间部分进行提示文本显示
                        const parsed = this.extractDateAndTime(reminder.time);
                        if (parsed && parsed.time) {
                            timeText = ` ⏰${parsed.time}`;
                        } else if (reminder.time) {
                            timeText = ` ${reminder.time}`;
                        }
                        const categoryText = (reminder as any).categoryName ? ` [${(reminder as any).categoryName}]` : '';
                        const overdueIcon = reminder.isOverdue ? '⚠️ ' : '';
                        taskList += `${overdueIcon}• ${reminder.title}${timeText}${categoryText}\n`;
                    });

                    // 如果任务超过2个，显示省略信息
                    if (sortedReminders.length > 2) {
                        taskList += `... ${i18n("moreItems", { count: (sortedReminders.length - 2).toString() })}\n`;
                    }

                    const message = taskList.trim();

                    await this.showReminderSystemNotification(title, message);
                }

                // 标记今天已提醒（使用内存标记，并写入持久化记录以防止重启后重复通知）
                if (remindersToShow.length > 0) {
                    this.notifiedReminders.set(dailyNotifyKey, true);
                    try {
                        await this.markNotifiedToday(today);
                    } catch (err) {
                        console.warn('写入持久化通知记录失败:', err);
                    }
                }
            }

            // 更新徽章
            this.updateBadges();

        } catch (error) {
            console.error("检查提醒失败:", error);
        }
    }

    // 检查单个时间提醒
    private async checkTimeReminders(reminderData: any, today: string, currentTime: string) {
        try {

            const { generateRepeatInstances } = await import("./utils/repeatUtils");

            for (const [reminderId, reminder] of Object.entries(reminderData)) {
                if (!reminder || typeof reminder !== 'object') continue;

                const reminderObj = reminder as any;

                // 跳过已完成或没有时间的提醒
                if (reminderObj.completed) continue;

                // 处理普通提醒
                if (!reminderObj.repeat?.enabled) {
                    // 普通（非重复）提醒：按字段分别处理 time 和 reminderTimes

                    // 计算任务的起止范围（用于跨天提醒）
                    const startDate = reminderObj.date || today;
                    const endDate = reminderObj.endDate || reminderObj.date || startDate;
                    const inDateRange = startDate <= today && today <= endDate;

                    // 检查 time 提醒（支持跨天：如果 today 在 startDate..endDate 范围内，则每天在该时间提醒）
                    if (reminderObj.time && inDateRange) {
                        const notifyKey = `${reminderObj.id}_${today}_${reminderObj.time}_time`;
                        if (!this.notifiedReminders.has(notifyKey) && this.shouldNotifyNow(reminderObj, today, currentTime, 'time')) {
                            // 二次检查持久化记录，防止多窗口并发
                            if (await this.hasReminderNotified(notifyKey)) {
                                this.notifiedReminders.set(notifyKey, true);
                            } else {
                                console.debug('checkTimeReminders - triggering time reminder', { id: reminderObj.id, date: reminderObj.date, time: reminderObj.time });
                                await this.showTimeReminder(reminderObj, 'time');
                                this.notifiedReminders.set(notifyKey, true);
                                await this.markReminderNotified(notifyKey);
                            }
                        }
                    }

                    // 检查 reminderTimes 提醒
                    if (reminderObj.reminderTimes && Array.isArray(reminderObj.reminderTimes)) {
                        for (const rtItem of reminderObj.reminderTimes) {
                            const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                            const note = typeof rtItem === 'string' ? '' : rtItem.note;

                            const parsed = this.extractDateAndTime(rt);
                            const hasDate = !!parsed.date;
                            const shouldCheck = hasDate ? (parsed.date === today) : inDateRange;

                            if (shouldCheck) {
                                const notifyKey = `${reminderObj.id}_${today}_${rt}_reminderTimes`;
                                const currentNum = this.timeStringToNumber(currentTime);
                                const reminderNum = this.timeStringToNumber(rt);
                                // 只检测当前分钟，不检测过期提醒
                                if (!this.notifiedReminders.has(notifyKey) && currentNum === reminderNum) {
                                    // 二次检查持久化记录
                                    if (await this.hasReminderNotified(notifyKey)) {
                                        this.notifiedReminders.set(notifyKey, true);
                                    } else {
                                        console.debug('checkTimeReminders - triggering reminderTimes reminder', { id: reminderObj.id, rt });
                                        const tempReminder = { ...reminderObj, note: note ? (reminderObj.note ? reminderObj.note + '\n' + note : note) : reminderObj.note };
                                        await this.showTimeReminder(tempReminder, 'reminderTimes', rt);
                                        this.notifiedReminders.set(notifyKey, true);
                                        await this.markReminderNotified(notifyKey);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // 处理重复提醒
                    let instances = generateRepeatInstances(reminderObj, today, today);

                    // 额外处理：如果存在 instanceModifications，将那些被修改后日期为今天的实例也加入检查。
                    // 情形：原始实例键（例如 2025-12-01）被修改为另一个日期（例如 2025-12-05），当今天为 2025-12-05 时
                    // generateRepeatInstances 可能不会基于原始键生成该实例，因此需要显式加入由 instanceModifications 指定并移动到今天的实例。
                    try {
                        const mods = reminderObj.repeat?.instanceModifications || {};
                        for (const [origKey, mod] of Object.entries(mods)) {
                            try {
                                if (!mod || typeof mod !== 'object') continue;
                                const modObj = mod as any;
                                if (modObj.date !== today) continue; // 只关心被改到今天的实例
                                const instanceId = `${reminderObj.id}_${origKey}`;
                                const exists = instances.some((it: any) => it.instanceId === instanceId);
                                if (exists) continue;

                                const constructed = {
                                    title: modObj.title || reminderObj.title || i18n('unnamedNote'),
                                    date: modObj.date || today,
                                    time: modObj.time || reminderObj.time,
                                    endDate: modObj.endDate || reminderObj.endDate,
                                    endTime: modObj.endTime || reminderObj.endTime,
                                    reminderTimes: modObj.reminderTimes !== undefined ? modObj.reminderTimes : reminderObj.reminderTimes,
                                    customReminderPreset: modObj.customReminderPreset !== undefined ? modObj.customReminderPreset : reminderObj.customReminderPreset,
                                    instanceId: instanceId,
                                    originalId: reminderObj.id,
                                    isRepeatedInstance: true,
                                    completed: (reminderObj.repeat?.completedInstances || []).includes(origKey),
                                    note: modObj.note || reminderObj.note,
                                    priority: modObj.priority !== undefined ? modObj.priority : reminderObj.priority,
                                    categoryId: modObj.categoryId !== undefined ? modObj.categoryId : reminderObj.categoryId,
                                    projectId: modObj.projectId !== undefined ? modObj.projectId : reminderObj.projectId
                                };

                                instances.push(constructed as any);
                            } catch (e) {
                                console.warn('处理 instanceModifications 时出错', e);
                            }
                        }
                    } catch (e) {
                        console.warn('处理重复实例的 instanceModifications 时发生错误:', e);
                    }

                    // 将生成的实例与原始 reminderObj 合并，确保实例包含 title、note、priority 等字段
                    instances = instances.map((inst: any) => ({
                        ...reminderObj,
                        ...inst,
                        id: inst.instanceId,
                        isRepeatInstance: true,
                        originalId: inst.originalId || reminderObj.id
                    }));

                    for (const instance of instances) {
                        const originalInstanceDate = (instance.instanceId && instance.instanceId.includes('_'))
                            ? instance.instanceId.split('_').pop()
                            : instance.date;
                        // 重复实例已完成（含每日完成标记）时，不应再触发时间提醒
                        if (instance.completed || (originalInstanceDate && reminderObj.dailyCompletions?.[originalInstanceDate])) {
                            continue;
                        }

                        // 检查实例是否需要提醒
                        // 时间提醒
                        if (instance.time) {
                            const notifyKey = `${instance.instanceId}_${today}_${instance.time}_time`;
                            if (!this.notifiedReminders.has(notifyKey) && this.shouldNotifyNow(instance, today, currentTime, 'time')) {
                                // 二次检查持久化记录
                                if (await this.hasReminderNotified(notifyKey)) {
                                    this.notifiedReminders.set(notifyKey, true);
                                } else {
                                    console.debug('checkTimeReminders - triggering repeat instance time reminder', { id: instance.instanceId, date: instance.date, time: instance.time });
                                    await this.showTimeReminder(instance, 'time');
                                    this.notifiedReminders.set(notifyKey, true);
                                    await this.markReminderNotified(notifyKey);
                                }
                            }
                        }

                        // reminderTimes 实例提醒
                        if (instance.reminderTimes && Array.isArray(instance.reminderTimes)) {
                            for (const rtItem of instance.reminderTimes) {
                                const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                                const note = typeof rtItem === 'string' ? '' : rtItem.note;

                                const parsed = this.extractDateAndTime(rt);
                                if (parsed.date && parsed.date !== instance.date) continue;

                                const currentNum = this.timeStringToNumber(currentTime);
                                const reminderNum = this.timeStringToNumber(rt);

                                // 只检测当前分钟，不检测过期提醒
                                const notifyKey = `${instance.instanceId}_${today}_${rt}_reminderTimes`;
                                if (!this.notifiedReminders.has(notifyKey) && currentNum === reminderNum) {
                                    // 二次检查持久化记录
                                    if (await this.hasReminderNotified(notifyKey)) {
                                        this.notifiedReminders.set(notifyKey, true);
                                    } else {
                                        console.debug('checkTimeReminders - triggering repeat instance reminderTimes reminder', { id: instance.instanceId, rt });
                                        await this.showTimeReminder(instance, 'reminderTimes', rt);
                                        this.notifiedReminders.set(notifyKey, true);
                                        await this.markReminderNotified(notifyKey);
                                    }
                                }
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.error('检查时间提醒失败:', error);
        }
    }

    // 判断是否应该现在提醒（只检测当前分钟，不检测过期提醒）
    private shouldNotifyNow(reminder: any, today: string, currentTime: string, timeField: 'time' = 'time'): boolean {
        // 不在此处强制检查日期，调用方负责判断提醒是否在当天或范围内。

        // 必须有时间字段
        if (!reminder[timeField]) return false;

        // 比较当前时间和提醒时间（支持带日期的自定义提醒）
        const rawReminderTime = reminder[timeField];
        const parsed = this.extractDateAndTime(rawReminderTime);

        // 如果提醒时间包含日期并且不是今天，则不触发
        if (parsed.date && parsed.date !== today) {
            console.debug('shouldNotifyNow - date does not match today, skip', parsed.date, 'today:', today, 'id:', reminder.id, 'field:', timeField);
            return false;
        }

        // 如果没有有效的 time 部分（比如只有日期，或解析失败），则视为非时间提醒，不触发此函数
        if (!parsed.time) {
            console.debug('shouldNotifyNow - no valid time component, skip', rawReminderTime, 'id:', reminder.id);
            return false;
        }

        const currentTimeNumber = this.timeStringToNumber(currentTime);
        const reminderTimeNumber = this.timeStringToNumber(rawReminderTime);
        // 只检测当前分钟的提醒，不检测过期提醒（精确匹配）
        const shouldNotify = currentTimeNumber === reminderTimeNumber;
        if (shouldNotify) {
            console.debug('shouldNotifyNow - trigger:', timeField, 'reminderId:', reminder.id, 'currentTime:', currentTime, 'reminderTime:', reminder[timeField]);
        }
        return shouldNotify;
    }

    /**
     * 更新非重复任务的总体 notified 标志。
     * 规则：
     * - 如果有 time 和 reminderTimes，只有两者都已被对应标记为已提醒且两者时间都已过时，才将 notified 设为 true。
     * - 如果只有其中一个时间存在，则以该字段的已提醒状态为准（并确保该时间已过去）。
     * - 对于跨多天任务（有 endDate），只有当 endDate 是过去时间时，才允许设置 notified 为 true。
     * 返回是否发生了变更（用于持久化判断）。
     */
    private updateOverallNotifiedFlag(reminder: any, today: string, currentTime: string): boolean {
        const prev = !!reminder.notified;

        // 对于跨多天任务，只有当 endDate 是过去时间时，才允许设置 notified
        if (reminder.endDate && compareDateStrings(reminder.endDate, today) >= 0) {
            reminder.notified = false;
            return prev !== false;
        }

        const hasTime = !!reminder.time;
        const hasReminderTimes = reminder.reminderTimes && Array.isArray(reminder.reminderTimes) && reminder.reminderTimes.length > 0;

        const currentNum = this.timeStringToNumber(currentTime);

        let now = false;

        const checkPassed = (field: string | null): boolean => {
            if (!field) return false;
            const raw = reminder[field];
            const parsed = this.extractDateAndTime(raw);
            const fieldTimeNum = this.timeStringToNumber(raw || '00:00');
            // 如果带日期
            if (parsed.date) {
                const dateCompare = compareDateStrings(parsed.date, today);
                if (dateCompare < 0) return true; // 已过
                if (dateCompare > 0) return false; // 未来
                // 等于今天，按时间比较
                return currentNum >= fieldTimeNum;
            }
            // 不带日期，按时间比较
            return currentNum >= fieldTimeNum;
        };

        // Check reminderTimes
        let reminderTimesAllNotified = true;
        if (hasReminderTimes) {
            for (const rtItem of reminder.reminderTimes) {
                const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                const parsed = this.extractDateAndTime(rt);
                const fieldTimeNum = this.timeStringToNumber(rt || '00:00');
                let passed = false;
                if (parsed.date) {
                    const dateCompare = compareDateStrings(parsed.date, today);
                    if (dateCompare < 0) passed = true;
                    else if (dateCompare > 0) passed = false;
                    else passed = currentNum >= fieldTimeNum;
                } else {
                    passed = currentNum >= fieldTimeNum;
                }

                const notified = reminder.notifiedTimes && reminder.notifiedTimes[rt];
                if (!notified || !passed) {
                    reminderTimesAllNotified = false;
                    break;
                }
            }
        }

        if (hasTime || hasReminderTimes) {
            const timeOk = !hasTime || (!!reminder.notifiedTime && checkPassed('time'));
            const reminderTimesOk = !hasReminderTimes || reminderTimesAllNotified;

            now = timeOk && reminderTimesOk;
        } else {
            now = false;
        }

        reminder.notified = now;
        return prev !== now;
    }

    // 时间字符串转换为数字便于比较 (HH:MM -> HHMM)
    private extractDateAndTime(value?: string): { date?: string | null, time?: string | null } {
        if (!value || typeof value !== 'string') return { date: null, time: null };
        if (value.includes('T')) {
            const [datePart, timePart] = value.split('T');
            if (!timePart) return { date: datePart, time: null };
            const time = timePart.split(':').slice(0, 2).join(':');
            return { date: datePart, time };
        }
        if (value.includes(' ')) {
            const [datePart, timePart] = value.split(' ');
            const time = (timePart || '').split(':').slice(0, 2).join(':') || null;
            return { date: datePart, time };
        }
        if (value.split(':').length >= 2) {
            return { date: null, time: value.split(':').slice(0, 2).join(':') };
        }
        return { date: null, time: null };
    }

    // 时间字符串转换为数字便于比较 (HH:MM -> HHMM)，支持带日期的字符串
    private timeStringToNumber(timeString: string): number {
        if (!timeString) return 0;
        const { time } = this.extractDateAndTime(timeString) || { time: null };
        if (!time) return 0;
        const parts = time.split(':');
        if (parts.length < 2) return 0;
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(minutes)) return 0;
        return hours * 100 + minutes;
    }

    private normalizeReminderDateText(value?: string | null): string {
        return typeof value === "string" ? value.trim() : "";
    }

    private normalizeReminderTimeText(value?: string | null): string {
        if (!value || typeof value !== "string") return "";
        const parsed = this.extractDateAndTime(value);
        if (parsed?.time) return parsed.time;
        const trimmed = value.trim();
        if (!trimmed) return "";
        const match = trimmed.match(/^(\d{1,2}):(\d{1,2})/);
        if (!match) return "";
        const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
        const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    private getReminderLogicalDateForDisplay(dateText: string, timeText?: string): string {
        if (!dateText) return "";
        if (!timeText) return dateText;
        try {
            return getLogicalDateString(new Date(`${dateText}T${timeText}:00`));
        } catch {
            return dateText;
        }
    }

    private parseReminderScheduleTimestamp(dateText: string, timeText?: string): number {
        if (!dateText) return Number.MAX_SAFE_INTEGER;
        const normalizedTime = timeText || "00:00";
        try {
            const dt = new Date(`${dateText}T${normalizedTime}:00`);
            const ts = dt.getTime();
            return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    }

    private parseReminderCompletedTimestamp(completedAt?: string): number {
        if (!completedAt || typeof completedAt !== "string") return Number.NEGATIVE_INFINITY;
        const ts = new Date(completedAt).getTime();
        return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
    }

    private formatReminderScheduleDisplayText(reminder: any): string {
        const dateText = this.normalizeReminderDateText(reminder?.date);
        if (!dateText) return "";
        const timeText = this.normalizeReminderTimeText(reminder?.time);
        return timeText ? `${dateText} ${timeText}` : dateText;
    }

    private formatReminderCompletedDisplayText(completedAt?: string): string {
        if (!completedAt || typeof completedAt !== "string") return "";
        try {
            const dt = new Date(completedAt);
            if (!Number.isFinite(dt.getTime())) return "";
            const datePart = dt.toLocaleDateString(getLocaleTag());
            const timePart = dt.toLocaleTimeString(getLocaleTag(), {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            });
            return `${datePart} ${timePart}`.trim();
        } catch {
            return "";
        }
    }

    private isReminderOverdueForBoundDateDisplay(reminder: any, logicalToday: string): boolean {
        const startDate = this.normalizeReminderDateText(reminder?.date);
        if (!startDate) return false;
        const startTime = this.normalizeReminderTimeText(reminder?.time);
        const startLogicalDate = this.getReminderLogicalDateForDisplay(startDate, startTime);

        const endDate = this.normalizeReminderDateText(reminder?.endDate) || startDate;
        const endTime = this.normalizeReminderTimeText(reminder?.endTime) || startTime;
        const endLogicalDate = this.getReminderLogicalDateForDisplay(endDate, endTime) || startLogicalDate;

        return !!endLogicalDate && compareDateStrings(endLogicalDate, logicalToday) < 0;
    }

    public async getBoundReminderDateDisplayInfo(reminderIds: string[]): Promise<BoundReminderDateDisplayInfo | null> {
        const normalizedIds = Array.from(new Set((reminderIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
        if (normalizedIds.length === 0) return null;

        try {
            const reminderData = await this.loadReminderData();
            if (!reminderData || typeof reminderData !== "object") return null;

            const idOrderMap = new Map<string, number>();
            normalizedIds.forEach((id, index) => idOrderMap.set(id, index));

            const reminders = normalizedIds
                .map((id) => reminderData[id])
                .filter((reminder: any) => reminder && reminder.id);
            if (reminders.length === 0) return null;

            const allCompleted = reminders.every((reminder: any) => !!reminder.completed);
            if (allCompleted) {
                let selectedReminder: any = reminders[0];
                let latestCompletedTs = this.parseReminderCompletedTimestamp(selectedReminder?.completedAt);
                for (const reminder of reminders.slice(1)) {
                    const ts = this.parseReminderCompletedTimestamp(reminder?.completedAt);
                    if (ts > latestCompletedTs) {
                        selectedReminder = reminder;
                        latestCompletedTs = ts;
                    }
                }

                if (!Number.isFinite(latestCompletedTs) || latestCompletedTs === Number.NEGATIVE_INFINITY) {
                    selectedReminder = reminders[reminders.length - 1];
                }

                let displayText = this.formatReminderCompletedDisplayText(selectedReminder?.completedAt);
                if (!displayText) {
                    displayText = this.formatReminderScheduleDisplayText(selectedReminder);
                }
                if (!displayText) {
                    displayText = i18n("completed") || "已完成";
                }

                return {
                    reminderId: String(selectedReminder.id),
                    displayText,
                    displayType: "completed",
                };
            }

            const logicalToday = getLogicalDateString();
            const incompleteWithDate = reminders.filter((reminder: any) => !reminder.completed && this.normalizeReminderDateText(reminder?.date));
            if (incompleteWithDate.length === 0) return null;

            const nonOverdueIncomplete = incompleteWithDate.filter((reminder: any) =>
                !this.isReminderOverdueForBoundDateDisplay(reminder, logicalToday)
            );
            const candidates = nonOverdueIncomplete.length > 0 ? nonOverdueIncomplete : incompleteWithDate;

            candidates.sort((a: any, b: any) => {
                const aDate = this.normalizeReminderDateText(a?.date);
                const bDate = this.normalizeReminderDateText(b?.date);
                const aTime = this.normalizeReminderTimeText(a?.time);
                const bTime = this.normalizeReminderTimeText(b?.time);
                const aTs = this.parseReminderScheduleTimestamp(aDate, aTime);
                const bTs = this.parseReminderScheduleTimestamp(bDate, bTime);
                if (aTs !== bTs) return aTs - bTs;
                const aIndex = idOrderMap.get(String(a?.id || "")) ?? Number.MAX_SAFE_INTEGER;
                const bIndex = idOrderMap.get(String(b?.id || "")) ?? Number.MAX_SAFE_INTEGER;
                return aIndex - bIndex;
            });

            const selectedReminder = candidates[0];
            const displayText = this.formatReminderScheduleDisplayText(selectedReminder);
            if (!displayText) return null;

            return {
                reminderId: String(selectedReminder.id),
                displayText,
                displayType: "schedule",
            };
        } catch (error) {
            console.warn("获取块绑定任务日期展示信息失败:", error);
            return null;
        }
    }

    public async openReminderEditDialog(blockId: string, reminderId: string): Promise<boolean> {
        const targetReminderId = String(reminderId || "").trim();
        if (!targetReminderId) return false;
        try {
            const reminderData = await this.loadReminderData();
            const reminder = reminderData?.[targetReminderId];
            if (!reminder) {
                showMessage(i18n("taskNotFound") || "任务不存在", 3000, "error");
                return false;
            }
            const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                blockId,
                reminder,
                plugin: this,
                mode: "edit"
            });
            dialog.show();
            return true;
        } catch (error) {
            console.error("打开任务编辑对话框失败:", error);
            showMessage(i18n("openModifyDialogFailed") || "打开修改对话框失败，请重试", 3000, "error");
            return false;
        }
    }

    /**
     * 检查习惯是否在给定日期应该打卡（统一走 habitUtils）
     */
    private shouldCheckHabitOnDate(habit: any, date: string): boolean {
        return shouldCheckInOnDate(habit, date);
    }

    private isHabitCompletedOnDate(habit: any, date: string): boolean {
        return isHabitCompletedOnDateUtil(habit, date, {
            getPomodoroFocusMinutes: (habitId, logicalDate) => {
                const manager = PomodoroRecordManager.getInstance(this);
                return manager.getEventFocusTime(habitId, logicalDate) || 0;
            }
        });
    }

    // 检查习惯的时间提醒并触发通知
    private async checkHabitReminders(today: string, currentTime: string) {
        try {
            const habitData = await this.loadHabitData();
            if (!habitData || typeof habitData !== 'object') return;

            const currentNum = this.timeStringToNumber(currentTime);
            let playSoundOnce = false;

            for (const habit of Object.values(habitData) as any[]) {
                try {
                    if (!habit || typeof habit !== 'object') continue;

                    // 需要设置 reminder times 才会被触发（兼容旧属性 reminderTime）
                    const times = getHabitReminderTimes(habit);
                    if (times.length === 0) continue;

                    // 已放弃的习惯不提醒
                    if (habit.abandoned === true) continue;

                    // 如果不在起止日期内，跳过
                    if (habit.startDate && habit.startDate > today) continue;
                    if (habit.endDate && habit.endDate < today) continue;

                    // 频率检查
                    if (!this.shouldCheckHabitOnDate(habit, today)) continue;

                    // 如果今日已经打卡完成，则不再提醒
                    if (this.isHabitCompletedOnDate(habit, today)) continue;


                    // 对每个提醒时间进行判断（可能为时间或带日期的时间）
                    for (const rtObj of times) {
                        const rt = rtObj.time;
                        const parsed = this.extractDateAndTime(rt);
                        if (parsed.date && parsed.date !== today) continue;
                        const habitTimeNum = this.timeStringToNumber(rt);
                        if (habitTimeNum === 0) continue; // 无法解析的时间
                        // 只检测当前分钟，不检测过期提醒
                        if (currentNum !== habitTimeNum) continue;

                        // 使用内存中的标记避免重复提醒
                        const notifyKey = `${habit.id}_${today}_${parsed.time || rt}`;
                        if (this.notifiedHabits.has(notifyKey)) continue;

                        // 二次检查持久化记录
                        if (await this.hasReminderNotified(notifyKey)) {
                            this.notifiedHabits.set(notifyKey, true);
                            continue;
                        }

                        // 触发通知（仅第一次触发时播放音效）
                        if (!playSoundOnce) {
                            await this.playNotificationSound();
                            playSoundOnce = true;
                        }

                        // 构建提醒信息并显示内部通知对话框
                        const reminderInfo = {
                            id: habit.id,
                            blockId: habit.blockId || '',
                            title: habit.title || i18n('unnamedNote'),
                            note: rtObj.note || habit.note || '',
                            priority: habit.priority || 'none',
                            categoryId: habit.groupId || undefined,
                            time: parsed.time || rt,
                            date: today,
                            isAllDay: false
                        };

                        // 显示系统弹窗（如果启用）
                        const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
                        const showInternalNotification = await this.getShowInternalNotificationEnabled();

                        // 根据设置决定是否显示内部通知框
                        if (showInternalNotification) {
                            NotificationDialog.show(reminderInfo as any);
                        }

                        // 桌面端：如果启用了系统通知，显示浏览器通知
                        // 移动端：系统定时通知由 scheduleMobileNotification 设置，不在此处处理
                        if (systemNotificationEnabled && !this.isInMobileApp) {
                            // 统一标题格式：习惯提醒（不含 emoji）
                            const title = "🌱" + i18n('habitReminder');
                            // message 格式为：时间 + 习惯名称（备注）
                            let message = reminderInfo.time ? `${reminderInfo.time} ${reminderInfo.title}` : `${reminderInfo.title}`;
                            // 如果有备注，添加（备注）格式
                            if (reminderInfo.note) {
                                message += `（${reminderInfo.note}）`;
                            }
                            await this.showReminderSystemNotification(title, message, reminderInfo);
                        }

                        // 标记已通知，避免重复通知
                        this.notifiedHabits.set(notifyKey, true);
                        await this.markReminderNotified(notifyKey);
                    }
                } catch (err) {
                    console.warn('处理单个习惯时出错', err);
                }
            }
        } catch (error) {
            console.error('检查习惯提醒失败:', error);
        }
    }
    // 显示时间提醒
    private async showTimeReminder(reminder: any, triggerField: 'time' | 'reminderTimes' = 'time', triggeredTime?: string) {
        try {
            // 播放通知声音
            await this.playNotificationSound();

            // 获取分类信息
            let categoryInfo = {};
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category) {
                    categoryInfo = {
                        categoryName: category.name,
                        categoryColor: category.color,
                        categoryIcon: category.icon
                    };
                }
            }

            const rawChosenTime = triggerField === 'reminderTimes' ? triggeredTime : reminder.time;
            const displayChosen = this.extractDateAndTime(rawChosenTime)?.time || rawChosenTime || reminder.time;
            const reminderInfo = {
                id: reminder.id,
                blockId: reminder.blockId,
                title: reminder.title || i18n("unnamedNote"),
                note: reminder.note,
                priority: reminder.priority || 'none',
                categoryId: reminder.categoryId,
                // 使用仅时间部分用于显示，若无则回退到原始字段
                time: displayChosen || reminder.time,
                date: reminder.date,
                endDate: reminder.endDate,
                isAllDay: false,
                isOverdue: false,
                ...categoryInfo
            };

            // 检查是否启用系统弹窗通知
            const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();

            // 记录触发字段，方便调试与后续显示一致性处理
            try { (reminderInfo as any)._triggerField = triggerField; } catch (e) { }
            console.debug('showTimeReminder - triggering internal dialog', {
                id: reminderInfo.id,
                triggerField,
                chosenTime: reminderInfo.time,
                date: reminderInfo.date
            });

            // 根据设置决定是否显示内部通知框
            const showInternalNotification = await this.getShowInternalNotificationEnabled();
            if (showInternalNotification) {
                NotificationDialog.show(reminderInfo);
            }

            // 桌面端：如果启用了系统通知，显示浏览器通知
            // 移动端：系统定时通知由 scheduleMobileNotification 设置，不在此处处理
            if (systemNotificationEnabled && !this.isInMobileApp) {
                // 统一标题格式：任务提醒
                const title = `⏰ ${i18n("timeReminderNotification")}`;

                let timeText = '';
                let rawTime = '';
                if (displayChosen) {
                    timeText = `${displayChosen}`;
                    rawTime = rawChosenTime;
                } else if (triggerField === 'time' && reminder.time) {
                    const dt = this.extractDateAndTime(reminder.time);
                    timeText = `${dt.time || reminder.time}`;
                    rawTime = reminder.time;
                } else if (triggerField === 'reminderTimes' && triggeredTime) {
                    const dt = this.extractDateAndTime(triggeredTime);
                    timeText = `${dt.time || triggeredTime}`;
                    rawTime = triggeredTime;
                }

                // 从 reminderTimes 中获取备注
                let timeNote = '';
                if (reminder.reminderTimes && Array.isArray(reminder.reminderTimes)) {
                    for (const rt of reminder.reminderTimes) {
                        if (typeof rt === 'object' && rt.time && rt.note && rt.time === rawTime) {
                            timeNote = rt.note;
                            break;
                        }
                    }
                }

                // 构建消息：时间 + 任务名（备注）
                let message = timeText ? `${timeText} ` : '';
                message += `${reminder.title || i18n("unnamedNote")}`;
                if (timeNote) {
                    message += `（${timeNote}）`;
                }

                await this.showReminderSystemNotification(title, message, reminderInfo);
            }

        } catch (error) {
            console.error('显示时间提醒失败:', error);
        }
    }

    /**
     * 显示系统弹窗通知（参考番茄钟的实现）
     * @param title 通知标题
     * @param message 通知消息
     * @param reminderInfo 提醒信息（可选，用于点击跳转）
     * @param scheduledTime 定时发送时间（可选，用于移动端定时通知）
     */
    private async showReminderSystemNotification(title: string, message: string, reminderInfo?: any, scheduledTime?: Date | string): Promise<number | undefined> {
        // 判断是否是移动端
        if (this.isInMobileApp) {
            // 手机端：使用内核接口进行系统通知
            try {
                // 如果有预定时间，则传递时间戳进行定时通知
                if (scheduledTime) {
                    return await sendNotification(title, message, scheduledTime);
                } else {
                    return await sendNotification(title, message);
                }
            } catch (error) {
                console.warn('手机端发送系统通知失败:', error);
            }
            return;
        }

        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                // 使用浏览器通知
                const notification = new Notification(title, {
                    body: message,
                    requireInteraction: true,
                    silent: false, // 使用我们自己的音频
                });

                // 点击通知时的处理
                notification.onclick = () => {
                    window.focus();
                    notification.close();

                    // 如果有提醒信息，跳转到相关块
                    if (reminderInfo && reminderInfo.blockId) {
                        try {
                            import("./api").then(({ openBlock }) => {
                                openBlock(reminderInfo.blockId);
                            });
                        } catch (error) {
                            console.warn('跳转到块失败:', error);
                        }
                    }
                };


            } else if ('Notification' in window && Notification.permission === 'default') {
                // 请求通知权限
                Notification.requestPermission().then(async permission => {
                    if (permission === 'granted') {
                        // 权限获取成功，递归调用显示通知
                        await this.showReminderSystemNotification(title, message, reminderInfo, scheduledTime);
                    }
                });
            }
        } catch (error) {
            console.warn('显示系统弹窗失败:', error);
        }
    }

    // 打开日历视图标签页
    openCalendarTab(data?: { projectFilter?: string, showHabitsOnly?: boolean }) {
        const isMobile = getFrontend().endsWith('mobile');
        const calendarTitle = data?.showHabitsOnly
            ? (i18n("habitCalendar") || "习惯日历")
            : i18n("calendarView");

        if (isMobile) {
            // 手机端：使用Dialog打开日历视图
            const dialog = new Dialog({
                title: calendarTitle,
                content: '<div id="mobileCalendarContainer" style="height: 100%; width: 100%;"></div>',
                width: "99%",
                height: "100%",
                destroyCallback: () => {
                    // 清理日历视图实例
                    const calendarContainer = dialog.element.querySelector('#mobileCalendarContainer') as HTMLElement;
                    if (calendarContainer && (calendarContainer as any)._calendarView) {
                        const calendarView = (calendarContainer as any)._calendarView;
                        if (typeof calendarView.destroy === 'function') {
                            calendarView.destroy();
                        }
                    }
                }
            });

            // 在Dialog中创建日历视图
            const calendarContainer = dialog.element.querySelector('#mobileCalendarContainer') as HTMLElement;
            if (calendarContainer) {
                const calendarView = new CalendarView(calendarContainer, this, data);
                // 保存实例引用用于清理
                (calendarContainer as any)._calendarView = calendarView;
            }
        } else {
            // 桌面端：使用Tab打开日历视图
            openTab({
                app: this.app,
                custom:
                {
                    title: calendarTitle,
                    icon: 'iconCalendar',
                    id: this.name + TAB_TYPE,
                    data: data || {}
                }
            });
        }
    }

    // 打开项目看板标签页
    openProjectKanbanTab(projectId: string, projectTitle: string) {
        const isMobile = getFrontend().endsWith('mobile');

        if (isMobile) {
            // 手机端：使用Dialog打开项目看板
            const dialog = new Dialog({
                title: projectTitle,
                content: '<div id="mobileProjectKanbanContainer" style="height: 100%; width: 100%;"></div>',
                width: "99%",
                height: "100%",
                destroyCallback: () => {
                    // 清理项目看板实例
                    const kanbanContainer = dialog.element.querySelector('#mobileProjectKanbanContainer') as HTMLElement;
                    if (kanbanContainer && (kanbanContainer as any)._projectKanbanView) {
                        const projectKanbanView = (kanbanContainer as any)._projectKanbanView;
                        if (typeof projectKanbanView.destroy === 'function') {
                            projectKanbanView.destroy();
                        }
                    }
                }
            });

            // 在Dialog中创建项目看板
            const kanbanContainer = dialog.element.querySelector('#mobileProjectKanbanContainer') as HTMLElement;
            if (kanbanContainer) {
                const projectKanbanView = new ProjectKanbanView(kanbanContainer, this, projectId);
                // 保存实例引用用于清理
                (kanbanContainer as any)._projectKanbanView = projectKanbanView;
            }
        } else {
            // 桌面端：使用Tab打开项目看板
            openTab({
                app: this.app,
                custom: {
                    title: projectTitle,
                    icon: "iconProject",
                    id: this.name + PROJECT_KANBAN_TAB_TYPE,
                    data: {
                        projectId: projectId,
                        projectTitle: projectTitle
                    }
                }
            });
        }
    }

    // 打开四象限矩阵标签页
    openEisenhowerMatrixTab() {
        const isMobile = getFrontend().endsWith('mobile');

        if (isMobile) {
            // 手机端：使用Dialog打开四象限矩阵
            const dialog = new Dialog({
                title: i18n("eisenhowerMatrix"),
                content: '<div id="mobileEisenhowerContainer" style="height: 100%; width: 100%;"></div>',
                width: "99%",
                height: "100%",
                destroyCallback: () => {
                    // 清理四象限矩阵实例
                    const eisenhowerContainer = dialog.element.querySelector('#mobileEisenhowerContainer') as HTMLElement;
                    if (eisenhowerContainer && (eisenhowerContainer as any)._eisenhowerView) {
                        const eisenhowerView = (eisenhowerContainer as any)._eisenhowerView;
                        if (typeof eisenhowerView.destroy === 'function') {
                            eisenhowerView.destroy();
                        }
                    }
                }
            });

            // 在Dialog中创建四象限矩阵视图
            const eisenhowerContainer = dialog.element.querySelector('#mobileEisenhowerContainer') as HTMLElement;
            if (eisenhowerContainer) {
                const eisenhowerView = new EisenhowerMatrixView(eisenhowerContainer, this);
                // 保存实例引用用于清理
                (eisenhowerContainer as any)._eisenhowerView = eisenhowerView;
                // 初始化视图
                eisenhowerView.initialize();
            }
        } else {
            // 桌面端：使用Tab打开四象限矩阵
            openTab({
                app: this.app,
                custom: {
                    title: i18n("eisenhowerMatrix"),
                    icon: "iconGrid",
                    id: this.name + EISENHOWER_TAB_TYPE,
                    data: {}
                }
            });
        }
    }

    /**
     * 注册快捷键命令
     */
    private registerCommands() {
        // 快捷键：打开日历视图
        this.addCommand({
            langKey: "shortcutOpenCalendarView",
            hotkey: "",
            editorCallback: () => {
                this.openCalendarTab();
            },
            callback: () => {
                this.openCalendarTab();
            },
            fileTreeCallback: () => {
                this.openCalendarTab();
            },
            dockCallback: () => {
                this.openCalendarTab();
            }
        });

        // 快捷键：设置当前文档为任务
        this.addCommand({
            langKey: "shortcutSetDocumentAsTask",
            hotkey: "",
            editorCallback: async (protyle: any) => {
                // 获取当前文档ID
                const documentId = protyle?.block?.rootID;
                if (documentId) {
                    const autoDetect = await this.getAutoDetectDateTimeEnabled();
                    try {
                        const projectData = await this.loadProjectData();
                        const projectId = projectData && projectData[documentId] ? projectData[documentId].blockId || projectData[documentId].id : undefined;
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            defaultProjectId: projectId,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    } catch (err) {
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    }
                }
            },
            callback: () => {
                showMessage(i18n("selectBlockFirst"), 3000, "info");
            }
        });

        // 快捷键：设置当前块为任务
        this.addCommand({
            langKey: "shortcutSetBlockAsTask",
            hotkey: "",
            editorCallback: async (protyle: any) => {
                // 通过 protyle.element 获取编辑器元素，然后查找选中的块
                if (!protyle || !protyle.element) {
                    showMessage(i18n("selectBlockFirst"), 3000, "info");
                    return;
                }

                const selectedBlocks = protyle.element.querySelectorAll('.protyle-wysiwyg--select');

                if (selectedBlocks && selectedBlocks.length > 0) {
                    // 获取所有选中块的 ID
                    const blockIds = Array.from(selectedBlocks)
                        .map((el: Element) => el.getAttribute('data-node-id'))
                        .filter((id: string | null): id is string => id !== null);

                    if (blockIds.length > 0) {
                        await this.handleMultipleBlocks(blockIds);
                    } else {
                        showMessage(i18n("selectBlockFirst"), 3000, "info");
                    }
                } else {
                    // 如果没有选中块，获取当前光标所在的块
                    const currentBlock = protyle.element.querySelector('.protyle-wysiwyg [data-node-id].protyle-wysiwyg--hl');
                    if (currentBlock) {
                        const blockId = currentBlock.getAttribute('data-node-id');
                        if (blockId) {
                            await this.handleMultipleBlocks([blockId]);
                            return;
                        }
                    }
                    showMessage(i18n("selectBlockFirst"), 3000, "info");
                }
            },
            callback: () => {
                showMessage(i18n("selectBlockFirst"), 3000, "info");
            }
        });

        // 快捷键：设置项目管理
        this.addCommand({
            langKey: "shortcutProjectManagement",
            hotkey: "",
            editorCallback: async (protyle: any) => {
                const documentId = protyle?.block?.rootID;
                if (documentId) {
                    const projectData = await this.loadProjectData();
                    const isProject = projectData && projectData.hasOwnProperty(documentId);

                    if (isProject) {
                        // 打开项目看板
                        this.openProjectKanbanTab(
                            projectData[documentId].blockId,
                            projectData[documentId].title
                        );
                    } else {
                        const dialog = new ProjectDialog(documentId, this);
                        dialog.show();
                    }
                }
            },
            callback: () => {
                showMessage(i18n("selectBlockFirst"), 3000, "info");
            }
        });


    }

    onunload() {
        console.log('任务笔记管理插件禁用，开始清理资源...');
        // 清理音频资源
        if (this.preloadedAudio) {
            this.preloadedAudio.pause();
            this.preloadedAudio = null;
        }

        // 清理全局番茄钟管理器
        const pomodoroManager = PomodoroManager.getInstance();
        pomodoroManager.cleanup();

        // 清理所有Tab视图实例
        this.tabViews.forEach((view) => {
            if (view && typeof view.destroy === 'function') {
                view.destroy();
            }
        });
        this.tabViews.clear();

        // 清理所有面包屑和块按钮
        document.querySelectorAll('.view-reminder-breadcrumb-btn, .project-breadcrumb-btn, .block-project-btn').forEach(btn => {
            btn.remove();
        });
        // 清理 ICS 同步定时器
        try {
            cleanupIcsSync(this as any);
        } catch (e) {
            console.warn('清理 ICS 同步定时器失败:', e);
        }

        if (this.reminderCheckTimer) {
            clearInterval(this.reminderCheckTimer);
            this.reminderCheckTimer = null;
        }

        // 执行所有注册的清理函数
        this.cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.warn('执行清理函数失败:', e);
            }
        });
        this.cleanupFunctions = [];
    }
    uninstall() {
        // 卸载插件时删除插件数据

    }
    async onDataChanged() {
        console.log("onDataChanged");
        try {
            await Promise.all([
                this.loadSettings(true),
                this.loadReminderData(true),
                this.loadProjectData(true),
                this.loadProjectStatus(true),
                this.loadCategories(true),
                this.loadHabitData(true),
                this.loadHabitGroupData(true),
                this.loadPomodoroRecords(true),
                this.isInMobileApp ? this.loadMobileNotifyData(true) : Promise.resolve(),
                this.isInMobileApp ? this.loadMobileHabitNotifyData(true) : Promise.resolve(),
            ]);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            window.dispatchEvent(new CustomEvent('habitUpdated'));

            // 移动端：数据变化时（包括从其他设备同步），清空当前设备的通知记录并重新生成。
            if (this.isInMobileApp) {
                try {
                    // 加载所有未完成的任务（使用已更新的缓存）
                    const reminderData = this.reminderDataCache || await this.loadReminderData(true);
                    const uncompletedReminders = Object.values(reminderData).filter((r: any) => !r.completed);

                    // 为任务和习惯分别构建移动通知计划快照并比较，分开存储以便区分
                    const currentTaskPlan = this.mobileNotificationPlansCache;
                    const expectedTaskPlan = this.buildMobileNotificationPlan(uncompletedReminders as any[], 7);

                    let expectedHabitPlan: Record<string, string[]> = {};
                    try {
                        const habitData = this.habitDataCache || await this.loadHabitData(true);
                        if (habitData && typeof habitData === 'object') {
                            for (const [hid, habit] of Object.entries(habitData)) {
                                try {
                                    const h = habit as any;
                                    if (h.completed) continue;
                                    const times = this.calculateHabitNotificationTimes(h, 7).map((t) => t.toISOString()).sort();
                                    if (times.length > 0) {
                                        expectedHabitPlan[hid] = times;
                                    }
                                } catch (e) {
                                    // 忽略单个习惯计算错误
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('[MobileNotification] 构建习惯通知计划失败:', e);
                    }

                    // 如果任务和习惯的计划都未变化，则跳过重建
                    const taskSame = this.isSameMobileNotificationPlan(currentTaskPlan, expectedTaskPlan);
                    const habitSame = this.isSameMobileNotificationPlan(this.mobileHabitNotificationPlansCache, expectedHabitPlan);
                    if (taskSame && habitSame) {
                        pushMsg('[MobileNotification] 数据变化但任务/习惯通知计划未变化，跳过重建');
                        return;
                    }

                    // pushMsg('[MobileNotification] 数据变化，通知计划有变化，开始重建通知');

                    // 先取消当前设备已记录的全部系统通知，避免已删除任务的旧通知残留
                    const canceledCount = await this.cancelAllCurrentDeviceMobileNotifications();
                    // pushMsg(`[MobileNotification] 已取消当前设备 ${canceledCount} 条旧通知，开始重新生成`);

                    // 基于 expectedTaskPlan 和 expectedHabitPlan 分别生成通知
                    let scheduledCount = 0;

                    // 任务通知
                    for (const [reminderId, times] of Object.entries(expectedTaskPlan)) {
                        try {
                            const reminder = (reminderData as any) && (reminderData as any)[reminderId];
                            if (!reminder) continue;
                            const ids = await this.scheduleMobileNotificationsAtTimes(reminder, times as string[]);
                            scheduledCount += (ids?.length || 0);
                        } catch (e) {
                            console.warn(`[MobileNotification] 重新初始化任务通知失败: reminderId=${reminderId}`, e);
                        }
                    }

                    // 习惯通知
                    try {
                        const habitData = this.habitDataCache || await this.loadHabitData(true);
                        for (const [hid, times] of Object.entries(expectedHabitPlan)) {
                            try {
                                const habit = habitData && habitData[hid];
                                if (!habit) continue;
                                const ids = await this.scheduleMobileNotificationsAtTimes(habit, times as string[]);
                                scheduledCount += (ids?.length || 0);
                            } catch (e) {
                                console.warn(`[MobileNotification] 重新初始化习惯通知失败: habitId=${hid}`, e);
                            }
                        }
                    } catch (e) {
                        console.warn('[MobileNotification] 习惯通知重建过程中读取习惯数据失败:', e);
                    }

                    // 重建后仅更新内存计划快照（不写入 notify.json）
                    this.mobileNotificationPlansCache = expectedTaskPlan;
                    this.mobileHabitNotificationPlansCache = expectedHabitPlan;

                } catch (error) {
                    console.warn('[MobileNotification] 移动端通知重新初始化失败:', error);
                }
            }

        } catch (err) {
            console.warn('处理onDataChanged事件失败:', err);
        }
    }
    private addCleanup(fn: () => void) {
        this.cleanupFunctions.push(fn);
    }

    // ==================== 移动端定时通知管理 ====================

    /**
     * 为提醒设置移动端系统定时通知
     * @param reminder 提醒对象
     * @param daysLimit 限制天数，只计算未来指定天数内的通知（默认7天），设为0表示不限制
     * @returns 通知ID（如果设置成功）
     */
    public async scheduleMobileNotification(reminder: any, daysLimit: number = 7): Promise<number | undefined> {
        if (!this.isInMobileApp) return;
        if (!reminder || !reminder.id || reminder.completed) return;
        if (typeof reminder.id === 'string' && reminder.id.startsWith('habit')) return;

        // 获取系统通知启用状态
        const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
        if (!systemNotificationEnabled) return;

        try {
            // 计算最近的提醒时间
            const nextNotifyTime = this.calculateNextNotificationTime(reminder, daysLimit);
            if (!nextNotifyTime) return;

            // 如果时间在过去，不发送
            if (nextNotifyTime.getTime() <= Date.now()) return;

            // 统一走按时间点调度逻辑，确保任务名后可附加“(提醒备注)”
            await this.cancelMobileNotification(reminder.id);
            const ids = await this.scheduleMobileNotificationsAtTimes(reminder, [nextNotifyTime.toISOString()]);
            return ids[0];
        } catch (error) {
            console.warn('[MobileNotification] 设置定时通知失败:', error);
        }
    }

    /**
     * 为提醒设置所有未来的移动端系统定时通知
     * @param reminder 提醒对象
     * @param daysLimit 限制天数，只计算未来指定天数内的通知（默认7天），设为0表示不限制
     * @returns 所有设置成功的通知ID数组
     */
    public async scheduleAllMobileNotifications(reminder: any, daysLimit: number = 7): Promise<number[]> {
        if (!this.isInMobileApp) return [];
        if (!reminder || !reminder.id || reminder.completed) return [];
        if (typeof reminder.id === 'string' && reminder.id.startsWith('habit')) return [];

        // 获取系统通知启用状态
        const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
        if (!systemNotificationEnabled) return [];

        try {
            // 计算所有未来的提醒时间
            const allNotifyTimes = this.calculateAllNotificationTimes(reminder, daysLimit);
            if (allNotifyTimes.length === 0) {
                await this.cancelMobileNotification(reminder.id);
                return [];
            }

            // 先取消已存在的通知
            await this.cancelMobileNotification(reminder.id);
            // 统一走按时间点调度逻辑，确保任务名后可附加“(提醒备注)”
            return await this.scheduleMobileNotificationsAtTimes(
                reminder,
                allNotifyTimes.map((time) => time.toISOString())
            );
        } catch (error) {
            console.warn('[MobileNotification] 设置所有定时通知失败:', error);
            return [];
        }
    }

    public async scheduleAllMobileHabitNotifications(habit: any, daysLimit: number = 7): Promise<number[]> {
        if (!this.isInMobileApp) return [];
        if (!habit || !habit.id || habit.completed) return [];
        if (!(typeof habit.id === 'string' && habit.id.startsWith('habit'))) return [];

        // 已放弃或已结束的习惯不设置通知
        if (habit.abandoned === true) return [];
        const today = getLogicalDateString();
        if (habit.endDate && habit.endDate < today) return [];

        const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
        if (!systemNotificationEnabled) return [];

        try {
            const allNotifyTimes = this.calculateHabitNotificationTimes(habit, daysLimit);
            if (allNotifyTimes.length === 0) {
                await this.cancelMobileNotification(habit.id);
                return [];
            }

            await this.cancelMobileNotification(habit.id);
            const isoTimes = allNotifyTimes.map((t) => t.toISOString());
            return await this.scheduleMobileNotificationsAtTimes(habit, isoTimes);
        } catch (error) {
            console.warn('[MobileHabitNotification] 设置所有定时通知失败:', error);
            return [];
        }
    }

    /**
     * 取消提醒的移动端系统通知
     * @param reminderIdOrReminder 提醒ID或提醒对象
     */
    public async cancelMobileNotification(reminderIdOrReminder: string | any): Promise<void> {
        if (!this.isInMobileApp) return;

        try {
            let reminderId: string | undefined;
            let notificationIds: number[] = [];
            let isHabit = false;

            if (typeof reminderIdOrReminder === 'string') {
                reminderId = reminderIdOrReminder;
                isHabit = reminderId.startsWith('habit');
            } else if (reminderIdOrReminder?.id) {
                reminderId = reminderIdOrReminder.id;
                isHabit = reminderId.startsWith('habit');
            }

            if (reminderId) {
                if (isHabit) {
                    const habitIds = await this.getMobileHabitNotificationIds(reminderId);
                    const legacyTaskIds = await this.getMobileNotificationIds(reminderId);
                    notificationIds = [...new Set([...(habitIds || []), ...(legacyTaskIds || [])])];
                } else {
                    notificationIds = await this.getMobileNotificationIds(reminderId);
                }
            }

            // 取消所有与该提醒相关的通知
            for (const notificationId of notificationIds) {
                try {
                    cancelNotification(notificationId);
                } catch (e) {
                    console.warn(`[MobileNotification] 取消通知失败: reminderId=${reminderId}, notificationId=${notificationId}`, e);
                }
            }

            // 从 notify.json 中移除记录
            if (reminderId) {
                if (isHabit) {
                    await this.removeMobileHabitNotificationId(reminderId);
                    // 兼容清理：历史版本里习惯通知可能误存到任务记录
                    await this.removeMobileNotificationId(reminderId);
                } else {
                    await this.removeMobileNotificationId(reminderId);
                }

                // 【修复：同步更新内存计划快照，避免删除任务或习惯后触发无谓的通知全量重建】
                if (this.mobileNotificationPlansCache && this.mobileNotificationPlansCache[reminderId]) {
                    delete this.mobileNotificationPlansCache[reminderId];
                }
                if (this.mobileHabitNotificationPlansCache && this.mobileHabitNotificationPlansCache[reminderId]) {
                    delete this.mobileHabitNotificationPlansCache[reminderId];
                }
            }
        } catch (error) {
            console.warn('[MobileNotification] 取消通知失败:', error);
        }
    }

    /**
     * 取消当前设备记录的所有移动端系统通知，并清空通知ID记录。
     * 用于同步后重建通知前的全量清理，避免已删除任务的残留通知。
     */
    public async cancelAllCurrentDeviceMobileNotifications(): Promise<number> {
        if (!this.isInMobileApp) return 0;

        try {
            const allNotificationMap = await this.getAllMobileNotificationIds();
            const allHabitNotificationMap = await this.getAllMobileHabitNotificationIds();
            const idSet = new Set<any>();

            Object.values(allNotificationMap).forEach((ids) => {
                (ids || []).forEach((id) => {
                    if (id !== undefined && id !== null) idSet.add(id);
                });
            });
            Object.values(allHabitNotificationMap).forEach((ids) => {
                (ids || []).forEach((id) => {
                    if (id !== undefined && id !== null) idSet.add(id);
                });
            });

            let canceledCount = 0;
            for (const notificationId of idSet) {
                try {
                    cancelNotification(notificationId);
                    canceledCount++;
                } catch (e) {
                    console.warn(`[MobileNotification] 取消全量通知失败: notificationId=${notificationId}`, e);
                }
            }

            // 无论系统取消是否部分失败，都清空本地记录，防止脏数据阻塞后续重建
            await this.clearAllMobileNotificationIds();
            await this.clearAllMobileHabitNotificationIds();
            return canceledCount;
        } catch (error) {
            console.warn('[MobileNotification] 取消当前设备全部通知失败:', error);
            return 0;
        }
    }

    /**
     * 根据给定的 ISO 时间点列表为指定提醒设置移动端系统通知（不重新计算时间）
     * @param reminder 提醒对象
     * @param isoTimes ISO 字符串数组
     */
    public async scheduleMobileNotificationsAtTimes(reminder: any, isoTimes: string[]): Promise<number[]> {
        if (!this.isInMobileApp) return [];
        if (!reminder || !reminder.id) return [];

        const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
        if (!systemNotificationEnabled) return [];

        const isHabit = typeof reminder.id === 'string' && reminder.id.startsWith('habit');
        const noteByDateTime: Record<string, string> = {};
        const noteByTimeOnly: Record<string, string> = {};
        if (reminder.reminderTimes && Array.isArray(reminder.reminderTimes)) {
            for (const rt of reminder.reminderTimes) {
                if (typeof rt === 'object' && rt.time) {
                    const parsedRt = this.extractDateAndTime(rt.time);
                    const note = rt.note || '';
                    if (parsedRt.time) {
                        noteByTimeOnly[parsedRt.time] = note;
                    }
                    if (parsedRt.date && parsedRt.time) {
                        noteByDateTime[`${parsedRt.date}T${parsedRt.time}`] = note;
                    }
                }
            }
        }

        const notificationIds: number[] = [];
        for (const iso of (isoTimes || [])) {
            try {
                const scheduledTime = new Date(iso);
                if (isNaN(scheduledTime.getTime())) continue;
                // 跳过已经过去的时间
                if (scheduledTime.getTime() <= Date.now()) continue;

                const title = isHabit ? "🌱" + i18n('habitReminder') : `⏰ ${i18n("timeReminderNotification")}`;

                const hours = scheduledTime.getHours().toString().padStart(2, '0');
                const minutes = scheduledTime.getMinutes().toString().padStart(2, '0');
                const datePart = getLocalDateString(scheduledTime);
                const timePart = `${hours}:${minutes}`;
                const note = noteByDateTime[`${datePart}T${timePart}`] || noteByTimeOnly[timePart] || '';
                let message = `${hours}:${minutes} ${reminder.title || i18n("unnamedNote")}`;
                if (note) {
                    message += ` (${note})`;
                }

                const notificationId = await this.showReminderSystemNotification(
                    title,
                    message,
                    { blockId: reminder.blockId },
                    scheduledTime
                );

                if (notificationId !== undefined) {
                    if (isHabit) {
                        await this.saveMobileHabitNotificationId(reminder.id, notificationId);
                    } else {
                        await this.saveMobileNotificationId(reminder.id, notificationId);
                    }
                    notificationIds.push(notificationId);
                }
            } catch (e) {
                console.warn('[MobileNotification] 按时间点设置通知失败:', e);
            }
        }

        return notificationIds;
    }

    /**
     * 计算下次通知时间
     * @param reminder 提醒对象
     * @param daysLimit 限制天数，只计算未来指定天数内的通知（默认0表示不限制）
     * @returns 下次通知时间，如果没有则返回 null
     */
    private calculateNextNotificationTime(reminder: any, daysLimit: number = 0): Date | null {
        const allTimes = this.calculateAllNotificationTimes(reminder, daysLimit);
        return allTimes.length > 0 ? allTimes[0] : null;
    }

    /**
     * 计算所有未来的通知时间
     * @param reminder 提醒对象
     * @param daysLimit 限制天数，只计算未来指定天数内的通知（默认0表示不限制）
     * @returns 所有未来通知时间的数组，按时间升序排列
     */
    private calculateAllNotificationTimes(reminder: any, daysLimit: number = 0): Date[] {
        const now = new Date();
        const today = getLogicalDateString();

        // 计算限制日期
        const limitDate = daysLimit > 0 ? new Date(now.getTime() + daysLimit * 24 * 60 * 60 * 1000) : null;

        if (reminder?.repeat?.enabled && reminder?.date) {
            const repeatWindow = getRelativeReminderWindow(reminder.reminderTimes, reminder.date, reminder.endDate);
            const scanDays = daysLimit > 0 ? daysLimit : 400;
            const scanEndDate = addDaysToDate(today, scanDays);
            const instanceStartDate = addDaysToDate(today, -repeatWindow.lookBackDays);
            const instanceEndDate = addDaysToDate(scanEndDate, repeatWindow.lookAheadDays);
            const rangeDays = Math.max(getDaysDifference(instanceStartDate, instanceEndDate) + 1, 1);
            const instances = generateRepeatInstances(reminder, instanceStartDate, instanceEndDate, Math.max(rangeDays * 2, 500));
            const futureTimes: Date[] = [];

            for (const instance of instances) {
                if (instance.completed) continue;
                const instanceTimes: string[] = [];
                if (instance.time) {
                    instanceTimes.push(instance.time);
                }
                if (instance.reminderTimes && Array.isArray(instance.reminderTimes)) {
                    for (const rt of instance.reminderTimes) {
                        if (typeof rt === 'string') {
                            instanceTimes.push(rt);
                        } else if (rt?.time) {
                            instanceTimes.push(rt.time);
                        }
                    }
                }

                for (const timeStr of instanceTimes) {
                    const parsed = this.extractDateAndTime(timeStr);
                    if (!parsed.time) continue;
                    const datePart = parsed.date || instance.date;
                    const dateTime = new Date(`${datePart}T${parsed.time}`);
                    if (isNaN(dateTime.getTime())) continue;
                    if (limitDate && dateTime.getTime() > limitDate.getTime()) continue;

                    const diff = dateTime.getTime() - now.getTime();
                    if (diff > -60000) {
                        futureTimes.push(dateTime);
                    }
                }
            }

            futureTimes.sort((a, b) => a.getTime() - b.getTime());
            const dedupSet = new Set<number>();
            const deduped: Date[] = [];
            for (const dt of futureTimes) {
                const ts = dt.getTime();
                if (dedupSet.has(ts)) continue;
                dedupSet.add(ts);
                deduped.push(dt);
            }
            return deduped;
        }

        // 获取提醒日期和时间
        const reminderDate = reminder.date || today;
        const times: string[] = [];

        // 收集所有可能的提醒时间
        if (reminder.time) {
            times.push(reminder.time);
        }
        if (reminder.reminderTimes && Array.isArray(reminder.reminderTimes)) {
            for (const rt of reminder.reminderTimes) {
                if (typeof rt === 'string') {
                    times.push(rt);
                } else if (rt?.time) {
                    times.push(rt.time);
                }
            }
        }

        if (times.length === 0) return [];

        // 收集所有未来的有效时间
        const futureTimes: Date[] = [];

        for (const timeStr of times) {
            const parsed = this.extractDateAndTime(timeStr);
            if (!parsed.time) continue;
            const hasExplicitDate = !!parsed.date;

            // 构建完整的日期时间
            const datePart = parsed.date || reminderDate;
            const dateTime = new Date(`${datePart}T${parsed.time}`);

            // 检查日期是否在任务范围内
            const startDate = reminder.date || today;
            const endDate = reminder.endDate || startDate;

            // 显式日期的提醒应以字段日期为准，不受任务 date/endDate 过滤
            if (!hasExplicitDate && (datePart < startDate || datePart > endDate)) continue;

            // 检查是否超过限制天数
            if (limitDate && dateTime.getTime() > limitDate.getTime()) continue;

            // 只考虑未来的时间（给 1 分钟缓冲）
            const diff = dateTime.getTime() - now.getTime();
            if (diff > -60000) {
                futureTimes.push(dateTime);
            }
        }

        // 按时间升序排序
        futureTimes.sort((a, b) => a.getTime() - b.getTime());

        return futureTimes;
    }

    private calculateHabitNotificationTimes(habit: any, daysLimit: number = 0): Date[] {
        const now = new Date();
        const today = getLogicalDateString();
        const limitDate = daysLimit > 0 ? new Date(now.getTime() + daysLimit * 24 * 60 * 60 * 1000) : null;
        const scanDays = daysLimit > 0 ? daysLimit : 30;

        // 已放弃的习惯不设置通知
        if (habit?.abandoned === true) return [];

        const timeEntries = getHabitReminderTimes(habit);
        if (timeEntries.length === 0) return [];

        const startDateCursor = new Date(`${today}T00:00:00`);
        const futureTimes: Date[] = [];

        for (let dayOffset = 0; dayOffset <= scanDays; dayOffset++) {
            const currentDate = new Date(startDateCursor);
            currentDate.setDate(startDateCursor.getDate() + dayOffset);
            const logicalDate = getLocalDateString(currentDate);

            if (habit?.startDate && compareDateStrings(logicalDate, habit.startDate) < 0) continue;
            if (habit?.endDate && compareDateStrings(logicalDate, habit.endDate) > 0) continue;
            if (!this.shouldCheckHabitOnDate(habit, logicalDate)) continue;
            if (this.isHabitCompletedOnDate(habit, logicalDate)) continue;

            for (const item of timeEntries) {
                const parsed = this.extractDateAndTime(item.time);
                if (!parsed.time) continue;
                if (parsed.date && parsed.date !== logicalDate) continue;

                const datePart = parsed.date || logicalDate;
                const dateTime = new Date(`${datePart}T${parsed.time}`);
                if (isNaN(dateTime.getTime())) continue;
                if (limitDate && dateTime.getTime() > limitDate.getTime()) continue;

                const diff = dateTime.getTime() - now.getTime();
                if (diff > -60000) {
                    futureTimes.push(dateTime);
                }
            }
        }

        futureTimes.sort((a, b) => a.getTime() - b.getTime());
        const dedupSet = new Set<number>();
        const deduped: Date[] = [];
        for (const dt of futureTimes) {
            const ts = dt.getTime();
            if (dedupSet.has(ts)) continue;
            dedupSet.add(ts);
            deduped.push(dt);
        }
        return deduped;
    }

    /**
     * 构建移动端通知计划快照：任务ID -> 未来提醒时间(ISO)数组。
     * 说明：仅用于比较是否需要重建通知，不包含系统通知ID。
     */
    private buildMobileNotificationPlan(reminders: any[], daysLimit: number = 7): Record<string, string[]> {
        const plan: Record<string, string[]> = {};
        for (const reminder of reminders) {
            if (!reminder || !reminder.id || reminder.completed) continue;
            const times = this.calculateAllNotificationTimes(reminder, daysLimit)
                .map((time) => time.toISOString())
                .sort();
            if (times.length > 0) {
                plan[reminder.id] = times;
            }
        }
        return plan;
    }

    /**
     * 比较两个移动端通知计划是否一致（与任务顺序无关）。
     */
    private isSameMobileNotificationPlan(a: Record<string, string[]> | null, b: Record<string, string[]>): boolean {
        if (!a) return false;

        const aKeys = Object.keys(a).sort();
        const bKeys = Object.keys(b).sort();
        if (aKeys.length !== bKeys.length) return false;

        for (let i = 0; i < aKeys.length; i++) {
            if (aKeys[i] !== bKeys[i]) return false;
            const aTimes = [...(a[aKeys[i]] || [])].sort();
            const bTimes = [...(b[bKeys[i]] || [])].sort();
            if (aTimes.length !== bTimes.length) return false;
            for (let j = 0; j < aTimes.length; j++) {
                if (aTimes[j] !== bTimes[j]) return false;
            }
        }

        return true;
    }

    /**
     * 格式化通知时间显示（只显示时刻，不显示日期）
     */
    private buildNotificationMessage(reminder: any, specificTimeStr?: string): string {
        let message = '';
        let timeText = specificTimeStr || '';

        if (!timeText) {
            const parts: string[] = [];
            // 只显示时间，不显示日期
            if (reminder.time) {
                parts.push(`${reminder.time}`);
            }
            if (reminder.endTime) {
                parts.push(`- ${reminder.endTime}`);
            }
            timeText = parts.join(' ');
        }

        if (timeText) {
            message += `${timeText} `;
        }

        message += `${reminder.title || i18n("unnamedNote")}`;

        if (reminder.categoryId) {
            const category = this.categoryManager?.getCategoryById(reminder.categoryId);
            if (category) {
                message += `[${category.name}]`;
            }
        }

        if (reminder.note) {
            message += `\n📝 ${reminder.note}`;
        }

        return message;
    }

    /**
     * 更新提醒的移动端通知（在保存提醒后调用）
     * @param reminder 提醒对象
     * @param oldReminder 旧的提醒对象（如果有，用于取消旧通知）
     * @param daysLimit 限制天数，只计算未来指定天数内的通知（默认7天），设为0表示不限制
     */
    public async updateMobileNotification(reminder: any, oldReminder?: any, daysLimit: number = 7): Promise<void> {
        if (!this.isInMobileApp) return;
        if (!reminder?.id) return;

        try {
            const isHabit = typeof reminder.id === 'string' && reminder.id.startsWith('habit');

            // 检查是否需要取消旧通知
            if (oldReminder?.id) {
                const timeChanged =
                    oldReminder.date !== reminder.date ||
                    oldReminder.time !== reminder.time ||
                    JSON.stringify(oldReminder.reminderTimes) !== JSON.stringify(reminder.reminderTimes);

                const completedChanged = !oldReminder.completed && reminder.completed;

                if (timeChanged || completedChanged) {
                    await this.cancelMobileNotification(oldReminder.id);
                }
            } else if (reminder.completed) {
                // 如果没有旧提醒数据，但当前任务已完成，也取消通知
                await this.cancelMobileNotification(reminder.id);
            }

            // 如果已完成，不需要设置新通知
            if (reminder.completed) {
                console.log(`[MobileNotification] 已完成，跳过设置通知: id=${reminder.id}`);
                // 同步从计划快照中移除（通过 ID 前缀区分习惯与任务）
                if (isHabit) {
                    if (this.mobileHabitNotificationPlansCache && this.mobileHabitNotificationPlansCache[reminder.id]) {
                        delete this.mobileHabitNotificationPlansCache[reminder.id];
                    }
                } else {
                    if (this.mobileNotificationPlansCache && this.mobileNotificationPlansCache[reminder.id]) {
                        delete this.mobileNotificationPlansCache[reminder.id];
                    }
                }
                return;
            }

            // 为所有未来的提醒时间设置通知（默认限制7天内）
            if (isHabit) {
                await this.scheduleAllMobileHabitNotifications(reminder, daysLimit);
            } else {
                await this.scheduleAllMobileNotifications(reminder, daysLimit);
            }

            // 【修复：本地保存时同步更新计划快照，防止与 onDataChanged 冲突导致误判及通知残留】
            const times = (isHabit ? this.calculateHabitNotificationTimes(reminder, daysLimit) : this.calculateAllNotificationTimes(reminder, daysLimit))
                .map((time) => time.toISOString())
                .sort();
            if (times.length > 0) {
                if (isHabit) {
                    if (!this.mobileHabitNotificationPlansCache) this.mobileHabitNotificationPlansCache = {};
                    this.mobileHabitNotificationPlansCache[reminder.id] = times;
                } else {
                    if (!this.mobileNotificationPlansCache) this.mobileNotificationPlansCache = {};
                    this.mobileNotificationPlansCache[reminder.id] = times;
                }
            } else {
                if (isHabit) {
                    if (this.mobileHabitNotificationPlansCache && this.mobileHabitNotificationPlansCache[reminder.id]) delete this.mobileHabitNotificationPlansCache[reminder.id];
                } else {
                    if (this.mobileNotificationPlansCache && this.mobileNotificationPlansCache[reminder.id]) delete this.mobileNotificationPlansCache[reminder.id];
                }
            }
        } catch (error) {
            console.warn('[MobileNotification] 更新通知失败:', error);
        }
    }

    /**
     * 删除提醒并取消移动端通知
     * @param reminderId 提醒ID
     * @param reminderData 提醒数据对象（可选，如果不提供则自动加载）
     * @returns 是否成功删除
     */
    public async deleteReminder(reminderId: string, reminderData?: any): Promise<boolean> {
        try {
            const data = reminderData || await this.loadReminderData();
            const reminder = data[reminderId];

            if (!reminder) return false;
            // 删除提醒数据
            delete data[reminderId];
            // 取消移动端通知（从 notify.json 获取并取消）
            await this.cancelMobileNotification(reminderId);

            // 如果没有传入 reminderData，则保存更改
            if (!reminderData) {
                await this.saveReminderData(data);
            }

            return true;
        } catch (error) {
            console.warn('[MobileNotification] 删除提醒失败:', error);
            return false;
        }
    }

    /**
     * 设置任务完成状态
     * @param reminderId 提醒ID
     * @param completed 是否完成（默认true）
     * @param reminderData 可选的提醒数据对象（如果不提供则自动加载）
     * @returns 是否成功
     */
    public async setReminderCompleted(reminderId: string, completed: boolean = true, reminderData?: any): Promise<boolean> {
        try {
            const data = reminderData || await this.loadReminderData();
            const reminder = data[reminderId];

            if (!reminder) return false;

            const wasCompleted = reminder.completed;
            reminder.completed = completed;

            // 如果标记为完成且之前未完成，取消移动端通知
            if (completed && !wasCompleted) {
                await this.cancelMobileNotification(reminderId);
            }

            // 如果没有传入 reminderData，则保存更改
            if (!reminderData) {
                await this.saveReminderData(data);
            }

            return true;
        } catch (error) {
            console.warn('[MobileNotification] 设置任务完成状态失败:', error);
            return false;
        }
    }

    // 获取每日通知时间设置
    async getDailyNotificationTime(): Promise<string> {
        const settings = await this.loadSettings();
        let time = settings.dailyNotificationTime;
        // 如果是数字形式的旧配置，转换为 HH:MM 字符串
        if (typeof time === 'number') {
            const h = Math.max(0, Math.min(23, Math.floor(time)));
            time = (h < 10 ? '0' : '') + h + ':00';
        }
        // 如果不是字符串或格式不正确，使用默认
        if (typeof time !== 'string') {
            time = DEFAULT_SETTINGS.dailyNotificationTime as any;
        }
        // 规范化为 HH:MM
        const m = (time as string).match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (m) {
            const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
            const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
            return (h < 10 ? '0' : '') + h.toString() + ':' + (min < 10 ? '0' : '') + min.toString();
        }
        return DEFAULT_SETTINGS.dailyNotificationTime as any;
    }

    // 获取每日通知启用状态
    async getDailyNotificationEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.dailyNotificationEnabled !== false;
    }

    // 获取自动识别日期时间设置
    async getAutoDetectDateTimeEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.autoDetectDateTime !== false;
    }

    // 获取识别后移除日期设置
    async getRemoveDateAfterDetectionMode(): Promise<'none' | 'date' | 'all'> {
        const settings = await this.loadSettings();
        // 兼容旧版 bool 值，迁移逻辑主要在 performDataMigration，这里做兜底
        if (settings.removeDateAfterDetection === true) return 'all';
        if (settings.removeDateAfterDetection === false) return 'none';
        return settings.removeDateAfterDetection || 'all';
    }

    private scheduleHabitPomodoroAutoSync() {
        if (this.habitPomodoroAutoSyncTimer) {
            clearTimeout(this.habitPomodoroAutoSyncTimer);
        }
        this.habitPomodoroAutoSyncTimer = window.setTimeout(() => {
            this.habitPomodoroAutoSyncTimer = null;
            this.syncHabitPomodoroAutoCheckIns().catch(error => {
                console.warn('[HabitSync] reminderUpdated 同步番茄自动打卡失败:', error);
            });
        }, 1200);
    }

    private isPomodoroTargetAutoCheckInEntry(entry: any, configuredEmoji?: string): boolean {
        if (!entry || typeof entry !== "object") return false;
        const meaning = String(entry.meaning || "");
        const matchedMeaning = meaning === POMODORO_TARGET_AUTO_CHECKIN_MEANING || meaning === POMODORO_PER_SESSION_AUTO_CHECKIN_MEANING;
        if (!matchedMeaning) return false;
        if (configuredEmoji && entry.emoji !== configuredEmoji) return false;
        return true;
    }

    private removePomodoroTargetAutoCheckInFromDate(
        habit: Habit,
        date: string,
        configuredEmoji: string,
        now: string
    ): boolean {
        const dayData = habit.checkIns?.[date];
        if (!dayData) return false;

        const entries = Array.isArray(dayData.entries) ? dayData.entries : [];
        let removedCount = 0;

        if (entries.length > 0) {
            const remained = entries.filter((entry: any) => {
                const shouldRemove = this.isPomodoroTargetAutoCheckInEntry(entry, configuredEmoji);
                if (shouldRemove) removedCount += 1;
                return !shouldRemove;
            });
            if (removedCount === 0) return false;

            dayData.entries = remained;
            dayData.status = remained.map((entry: any) => entry?.emoji).filter(Boolean);
            dayData.count = remained.length;
        } else {
            const status = Array.isArray(dayData.status) ? dayData.status : [];
            const index = status.indexOf(configuredEmoji);
            if (index === -1) return false;
            status.splice(index, 1);
            dayData.status = status;
            dayData.count = Math.max(0, Number(dayData.count || 0) - 1);
            removedCount = 1;
        }

        dayData.timestamp = now;
        habit.totalCheckIns = Math.max(0, Number(habit.totalCheckIns || 0) - removedCount);
        habit.updatedAt = now;

        const leftEntries = Array.isArray(dayData.entries) ? dayData.entries.length : 0;
        const leftStatus = Array.isArray(dayData.status) ? dayData.status.length : 0;
        const leftCount = Math.max(0, Number(dayData.count || 0));
        if (leftEntries === 0 && leftStatus === 0 && leftCount === 0) {
            delete habit.checkIns[date];
        }

        return true;
    }

    /**
     * 处理习惯关联的番茄钟完成后的同步逻辑
     * @param habitId 习惯ID
     */
    private async handleHabitPomodoroSync(habitId: string) {
        try {
            const habitData = await this.loadHabitData();
            const habit = habitData[habitId] as Habit;
            if (!habit) return;

            // 1. 如果开启了每番茄自动打卡，则立即执行一次打卡
            if (habit.autoCheckInAfterPomodoro) {
                const configuredEmoji = habit.autoCheckInEmoji || habit.checkInEmojis?.[0]?.emoji || '✅';
                let emojiConfig = habit.checkInEmojis?.find(item => item.emoji === configuredEmoji);
                if (!emojiConfig) {
                    emojiConfig = {
                        emoji: configuredEmoji,
                        meaning: '自动番茄打卡',
                        countsAsSuccess: true,
                        promptNote: false
                    };
                }

                const autoCheckInConfig: HabitEmojiConfig = {
                    ...emojiConfig,
                    meaning: POMODORO_PER_SESSION_AUTO_CHECKIN_MEANING
                };
                await this.performHabitCheckIn(habit, autoCheckInConfig, { silent: true });
                showMessage(`番茄完成，已自动打卡 ${emojiConfig.emoji}`, 2500);
            }

            // 2. 番茄目标型习惯触发一次同步检查（会在 sync 内判断是否开启自动打卡）
            if (getHabitGoalType(habit) === 'pomodoro') {
                await this.syncHabitPomodoroAutoCheckIns(habitData, habitId);
            }
        } catch (error) {
            console.error('[HabitSync] 处理番茄完成同步失败:', error);
        }
    }

    /**
     * 同步番茄钟习惯的自动打卡（达标补录）
     * @param habitData 习惯数据
     * @param targetHabitId 可选，只处理特定习惯
     */
    private async syncHabitPomodoroAutoCheckIns(habitData?: Record<string, Habit>, targetHabitId?: string): Promise<void> {
        if (!habitData) habitData = await this.loadHabitData();
        let changed = false;
        const now = getLocalDateTimeString(new Date());
        const recordManager = PomodoroRecordManager.getInstance(this);
        await recordManager.initialize();
        const records = recordManager.getSaveData() || {};
        const allDates = Object.keys(records);

        const reminderData = (await this.loadReminderData()) || {};
        const linkedPomodoroData = buildLinkedHabitPomodoroData(
            reminderData,
            records,
            (session) => recordManager.calculateSessionCount(session)
        );
        const linkedTaskPomodoroStats = linkedPomodoroData.statsByHabit;

        const habitsToProcess = targetHabitId ? [habitData[targetHabitId]].filter(Boolean) : Object.values(habitData);

        for (const habit of habitsToProcess) {
            if (!habit || !habit.id) continue;
            // 仅对番茄目标型习惯自动补录
            if (getHabitGoalType(habit) !== 'pomodoro') continue;
            // 仅在开启「番茄达标自动打卡」时执行
            if (!habit.autoCheckInAfterPomodoro) continue;

            const targetMinutes = getHabitPomodoroTargetMinutes(habit);
            if (targetMinutes <= 0) continue;

            // 确定补录使用的 Emoji
            const configuredEmoji = habit.autoCheckInEmoji || habit.checkInEmojis?.[0]?.emoji || '✅';
            let autoEmojiConfig = habit.checkInEmojis?.find(item => item.emoji === configuredEmoji);

            const habitCheckInDates = Object.keys(habit.checkIns || {});
            const datesToCheck = new Set<string>([...allDates, ...habitCheckInDates]);

            datesToCheck.forEach((date) => {
                const shouldCheckOnDate = shouldCheckInOnDate(habit, date);
                const linkedFocusMinutes = getLinkedTaskPomodoroStatsByDateUtil(linkedTaskPomodoroStats, habit.id, date).focusMinutes;
                const focusMinutes = (recordManager.getEventFocusTime(habit.id, date) || 0) + linkedFocusMinutes;
                const isPomodoroTargetMet = shouldCheckOnDate && focusMinutes >= targetMinutes;

                const dayData = habit.checkIns?.[date];
                const entries = Array.isArray(dayData?.entries) ? dayData.entries : [];
                const autoSyncedCount = entries.filter((entry: any) =>
                    this.isPomodoroTargetAutoCheckInEntry(entry, configuredEmoji)
                ).length;

                // 番茄不达标（或该日不需要打卡）时，回收此前自动补录的打卡
                if (!isPomodoroTargetMet) {
                    if (autoSyncedCount > 0 && this.removePomodoroTargetAutoCheckInFromDate(habit, date, configuredEmoji, now)) {
                        changed = true;
                    }
                    return;
                }

                // 检查当天是否已有成功打卡（忽略当前机制自动补录的项）
                let successCount = 0;
                if (entries.length > 0) {
                    successCount = entries.filter((entry: any) => {
                        if (this.isPomodoroTargetAutoCheckInEntry(entry, configuredEmoji)) return false;
                        const config = habit.checkInEmojis.find(c => c.emoji === entry?.emoji);
                        return config ? config.countsAsSuccess !== false : true;
                    }).length;
                } else if (Array.isArray(dayData?.status) && dayData.status.length > 0) {
                    successCount = dayData.status.filter((emoji: string) => {
                        const config = habit.checkInEmojis.find(c => c.emoji === emoji);
                        return config ? config.countsAsSuccess !== false : true;
                    }).length;
                } else if (typeof dayData?.count === 'number' && dayData.count > 0) {
                    successCount = dayData.count;
                }

                if (successCount + autoSyncedCount >= 1) return;

                // 补录一条自动打卡
                if (!autoEmojiConfig) {
                    autoEmojiConfig = {
                        emoji: configuredEmoji,
                        meaning: POMODORO_TARGET_AUTO_CHECKIN_MEANING,
                        countsAsSuccess: true,
                        promptNote: false
                    };
                    habit.checkInEmojis = [...(habit.checkInEmojis || []), autoEmojiConfig];
                }

                habit.checkIns = habit.checkIns || {};
                if (!habit.checkIns[date]) {
                    habit.checkIns[date] = { count: 0, status: [], timestamp: now, entries: [] };
                }
                const dayCheckIn = habit.checkIns[date];
                dayCheckIn.entries = dayCheckIn.entries || [];
                dayCheckIn.entries.push({
                    emoji: autoEmojiConfig.emoji,
                    timestamp: now,
                    meaning: autoEmojiConfig.meaning,
                    group: (autoEmojiConfig.group || '').trim() || undefined
                });
                dayCheckIn.status = (dayCheckIn.status || []).concat([autoEmojiConfig.emoji]);
                dayCheckIn.count = (dayCheckIn.count || 0) + 1;
                dayCheckIn.timestamp = now;
                habit.totalCheckIns = (habit.totalCheckIns || 0) + 1;
                habit.updatedAt = now;
                changed = true;
            });
        }

        if (changed) {
            await this.saveHabitData(habitData);
            window.dispatchEvent(new CustomEvent('habitUpdated'));
        }
    }

    /**
     * 执行打卡核心逻辑
     */
    private async performHabitCheckIn(habit: Habit, emojiConfig: HabitEmojiConfig, options?: { silent?: boolean }) {
        const date = getLogicalDateString();
        const now = getLocalDateTimeString(new Date());

        habit.checkIns = habit.checkIns || {};
        if (!habit.checkIns[date]) {
            habit.checkIns[date] = { count: 0, status: [], timestamp: now, entries: [] };
        }
        const checkIn = habit.checkIns[date];
        checkIn.entries = checkIn.entries || [];
        checkIn.entries.push({ 
            emoji: emojiConfig.emoji, 
            timestamp: now,
            meaning: emojiConfig.meaning,
            group: (emojiConfig.group || '').trim() || undefined
        });
        checkIn.count = (checkIn.count || 0) + 1;
        checkIn.status = (checkIn.status || []).concat([emojiConfig.emoji]);
        checkIn.timestamp = now;
        habit.totalCheckIns = (habit.totalCheckIns || 0) + 1;
        habit.updatedAt = now;

        await this.saveHabitPartial(habit.id, habit);
        
        if (!options?.silent) {
            showMessage(`${i18n("checkInSuccess")}${emojiConfig.emoji}`);
        }

        // 尝试同步更新系统通知
        try {
            await this.updateMobileNotification(habit, habit, 7);
        } catch (e) {}

        window.dispatchEvent(new CustomEvent('habitUpdated'));
    }
}
