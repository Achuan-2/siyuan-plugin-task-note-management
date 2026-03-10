import {
    Plugin,
    getActiveEditor,
    showMessage,
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
import { getLocalTimeString, getLocalDateString, compareDateStrings, getLogicalDateString, setDayStartTime } from "./utils/dateUtils";
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
import { getFile, sendNotification } from "./api";
import { resolveAudioPath } from "./utils/audioUtils";
import { showVipDialog } from "./components/VipDialog";
import { performDataMigration } from "./utils/dataMigration";
import { initIcsSync, initIcsSubscriptionSync, handleIcsSyncSettingsChange, cleanupIcsSync } from "./utils/icsSync";
import { TaskNoteDOMManager } from "./utils/taskNoteDOM";

export const SETTINGS_FILE = "reminder-settings.json";
export const PROJECT_DATA_FILE = "project.json";
export const CATEGORIES_DATA_FILE = "categories.json";
export const REMINDER_DATA_FILE = "reminder.json";
export const HABIT_DATA_FILE = "habit.json";
export const NOTIFY_DATA_FILE = "notify.json";
export const POMODORO_RECORD_DATA_FILE = "pomodoro_record.json";
export const HABIT_GROUP_DATA_FILE = "habitGroup.json";
export const STATUSES_DATA_FILE = "statuses.json";
export const HOLIDAY_DATA_FILE = "holiday.json";
export const LICENSE_DATA_FILE = "license.json";

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
    calendarHolidayIcsUrl: 'https://www.shuyz.com/githubfiles/china-holiday-calender/master/holidayCal.ics?token=cb429c2a-81a6-4c26-8f35-4f4bf0c84b2c&compStart=*&compEnd=*', // 节假日ICS URL
    calendarMultiDaysCount: 3, // 多天视图默认显示天数
    weekStartDay: 1, // 新增：周视图的一周开始日 (0=周日, 1=周一，默认周一)
    // 日历摘要设置
    showPomodoroInSummary: true,
    showHabitInSummary: true,
    // 任务管理侧栏排序配置
    sortMethod: "priority",
    sortOrder: "desc",
    // 四象限设置
    eisenhowerImportanceThreshold: 'medium',
    eisenhowerUrgencyDays: 3,
    // 项目排序配置
    projectSortOrder: [],
    projectSortMode: 'custom',
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
    breakVolume: 1,
    longBreakVolume: 1,
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
    },
};

export default class ReminderPlugin extends Plugin {
    private reminderPanel: ReminderPanel;
    private tabViews: Map<string, any> = new Map(); // 存储所有Tab视图实例（日历、四象限、项目看板、番茄钟等）
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
    private cleanupFunctions: (() => void)[] = [];

    // 内存中的提醒记录，用于避免同一会话中重复提醒
    // 格式: "reminderId_date_time" -> true
    private notifiedReminders: Map<string, boolean> = new Map();
    // 格式: "habitId_date_time" -> true
    private notifiedHabits: Map<string, boolean> = new Map();

    private instanceId: string = Math.random().toString(36).substring(2, 11);
    private coordinatorChannel: BroadcastChannel;

    public settings: any;
    public vip: any = { vipKeys: [], isVip: false, expireDate: '', freeTrialUsed: false };

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
                this.habitDataCache = data || {};
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
        this.habitDataCache = data;
        await this.saveData(HABIT_DATA_FILE, data);
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
                const data = await this.loadData(POMODORO_RECORD_DATA_FILE);
                this.pomodoroRecordsCache = data || {};
            } catch (error) {
                console.error('Failed to load pomodoro records:', error);
                this.pomodoroRecordsCache = {};
            }
        }
        return this.pomodoroRecordsCache;
    }

    /**
     * 保存番茄钟历史记录数据，并更新缓存
     * @param data 记录数据
     */
    public async savePomodoroRecords(data: any): Promise<void> {
        this.pomodoroRecordsCache = data;
        await this.saveData(POMODORO_RECORD_DATA_FILE, data);
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
     * 读取通知记录数据
     */
    public async readNotifyData(): Promise<{ lastNotified?: string, notifiedKeys?: Record<string, boolean> }> {
        try {
            const data = await this.loadData(NOTIFY_DATA_FILE);
            if (!data || typeof data !== 'object') {
                return {};
            }

            // 兼容性处理
            if (typeof data.lastNotified === 'string' || data.notifiedKeys) {
                return {
                    lastNotified: data.lastNotified,
                    notifiedKeys: data.notifiedKeys || {}
                };
            }

            // 旧数据格式迁移 (date -> boolean)
            const dateKeys = Object.keys(data).filter(k => /\d{4}-\d{2}-\d{2}/.test(k));
            if (dateKeys.length > 0) {
                const validDates = dateKeys.filter(k => !!data[k]);
                if (validDates.length > 0) {
                    const latest = validDates.sort().pop();
                    const result = { lastNotified: latest, notifiedKeys: {} };
                    try {
                        await this.writeNotifyData(result);
                    } catch (err) {
                        console.warn('迁移通知记录文件到新结构失败:', err);
                    }
                    return result;
                }
            }
            return {};
        } catch (error) {
            console.warn('读取通知记录文件失败:', error);
            return {};
        }
    }

    /**
     * 写入通知记录数据
     */
    public async writeNotifyData(data: { lastNotified?: string, notifiedKeys?: Record<string, boolean> }): Promise<void> {
        try {
            await this.saveData(NOTIFY_DATA_FILE, data);
        } catch (error) {
            console.error('写入通知记录文件失败:', error);
            throw error;
        }
    }

    /**
     * 检查某日期是否已提醒过全天事件
     */
    public async hasNotifiedToday(date: string): Promise<boolean> {
        try {
            const notifyData = await this.readNotifyData();
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
            const data = await this.readNotifyData();
            data.lastNotified = date;
            await this.writeNotifyData(data);
        } catch (error) {
            console.error('标记通知记录失败:', error);
        }
    }

    /**
     * 检查特定的提醒Key是否已通知 (用于多窗口同步)
     */
    public async hasReminderNotified(key: string): Promise<boolean> {
        try {
            const data = await this.readNotifyData();
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
            const data = await this.readNotifyData();
            if (!data.notifiedKeys) data.notifiedKeys = {};
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

            await this.writeNotifyData(data);
        } catch (error) {
            console.error('标记提醒记录失败:', error);
        }
    }

    async onload() {
        await this.loadSettings();


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
        setPluginInstance(this);
        this.taskNoteDOM = new TaskNoteDOMManager(this);
        // 初始化番茄钟记录管理器，确保番茄数据已加载
        const pomodoroRecordManager = PomodoroRecordManager.getInstance(this);
        await pomodoroRecordManager.initialize();
        // 添加dock栏和顶栏按钮
        await this.initializeUI();

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
                        const state = currentPomodoro.getCurrentState();
                        // 强制更新，即使正在运行
                        const reminder = { id: state.reminderId, title: state.reminderTitle };
                        await currentPomodoro.updateState(reminder, pomodoroSettings, state.isCountUp, state, true, true);
                        updatedCount++;
                    }

                    for (const [, view] of this.tabViews) {
                        if (view && typeof view.updateState === 'function' && typeof view.getCurrentState === 'function') {
                            try {
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
        const isMobileDevice = getFrontend().endsWith('mobile') || getBackend().endsWith('android') || getBackend().endsWith('ios') || getBackend().endsWith('harmony');

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

        if (!isMobileDevice && !isBrowserDesktop) {
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
    private async initializeUI() {
        // 加载设置（用于初始显示/隐藏某些停靠栏）
        const settings = await this.loadSettings();

        // 创建项目管理 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconProject",
                title: i18n("projectDockTitle"),
                hotkey: ""
            },
            data: {
                text: "This is my custom dock"
            },
            resize() {
            },
            update() {
            },
            type: "project_dock",
            init: (dock) => {
                this.projectDockElement = dock.element;
                this.projectPanel = new ProjectPanel(dock.element, this);

            }
        });
        // 创建 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconClock",
                title: i18n("dockPanelTitle"),
                hotkey: ""
            },
            data: {
                text: "This is my custom dock"
            },
            resize() {
            },
            update() {
            },
            type: "reminder_dock",
            init: (dock) => {
                this.reminderPanel = new ReminderPanel(dock.element, this);
            }
        });

        // 创建习惯打卡 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconCheck",
                title: "习惯打卡",
                hotkey: ""
            },
            data: {
                text: "Habit tracking dock"
            },
            resize() {
            },
            update() {
            },
            type: "habit_dock",
            init: (dock) => {
                new HabitPanel(dock.element, this);
            }
        });

        // 创建日历视图 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconCalendar",
                title: i18n("calendarDockTitle"),
                hotkey: ""
            },
            data: {
                text: "Calendar view dock"
            },
            resize() {
            },
            update() {
            },
            type: "calendar_dock",
            init: (dock) => {
                new CalendarView(dock.element, this, { isDockMode: true });
            }
        });



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
            this.taskNoteDOM.addBreadcrumbButtonsToExistingProtyles();
            const currentProtyle = getActiveEditor(false)?.protyle;
            // 500ms之后调用
            setTimeout(() => {
                this.taskNoteDOM.addBlockProjectButtonsToProtyle(currentProtyle);
            }, 500);
        };
        window.addEventListener('reminderUpdated', onReminderUpdated);
        this.addCleanup(() => window.removeEventListener('reminderUpdated', onReminderUpdated));

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
        };
        window.addEventListener('habitUpdated', onHabitUpdated);
        this.addCleanup(() => window.removeEventListener('habitUpdated', onHabitUpdated));
    }

    async onLayoutReady() {
        // 初始化批量设置对话框（确保在UI初始化时创建）
        this.batchReminderDialog = new BatchReminderDialog(this);



        // 注册快捷键
        this.registerCommands();

        // 在布局准备就绪后监听protyle切换事件
        // 注册 switch-protyle 事件处理：仅在此事件中调用 addBlockProjectButtonsToProtyle
        const onSwitchProtyle = (e: any) => {
            // 延迟添加按钮，确保protyle完全切换完成
            setTimeout(() => {
                // 保持原有面包屑按钮初始化
                this.taskNoteDOM.addBreadcrumbReminderButton(e.detail.protyle);
                // 将块按钮逻辑限定为 switch-protyle 事件中调用
                this.taskNoteDOM.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        };
        this.eventBus.on('switch-protyle', onSwitchProtyle);
        this.addCleanup(() => this.eventBus.off('switch-protyle', onSwitchProtyle));

        const onLoadedProtyleDynamic = (e: any) => {
            // 延迟添加按钮，确保protyle完全加载完成
            setTimeout(() => {
                this.taskNoteDOM.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        };
        this.eventBus.on('loaded-protyle-dynamic', onLoadedProtyleDynamic);
        this.addCleanup(() => this.eventBus.off('loaded-protyle-dynamic', onLoadedProtyleDynamic));

        const onLoadedProtyleStatic = (e: any) => {
            // 延迟添加按钮，确保protyle完全加载完成
            setTimeout(() => {
                this.taskNoteDOM.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        };
        this.eventBus.on('loaded-protyle-static', onLoadedProtyleStatic);
        this.addCleanup(() => this.eventBus.off('loaded-protyle-static', onLoadedProtyleStatic));
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

    private async setDockBadge(count: number) {
        const settings = await this.loadSettings();
        const showBadge = settings.enableDockBadge !== false && (settings.enableReminderDockBadge !== false);
        if (!showBadge) {
            // Remove existing badge if present
            const existingBadge = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementreminder_dock"]')?.querySelector('.reminder-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }
            return;
        }
        try {
            // 等待停靠栏图标出现
            const dockIcon = await this.whenElementExist('.dock__item[data-type="siyuan-plugin-task-note-managementreminder_dock"]') as HTMLElement;

            // 移除现有徽章
            const existingBadge = dockIcon.querySelector('.reminder-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 如果计数大于0，添加徽章
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'reminder-dock-badge';
                badge.textContent = count.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background: var(--b3-theme-error);
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    line-height: 1;
                    z-index: 1;
                    pointer-events: none;
                `;

                // 确保父元素有相对定位
                dockIcon.style.position = 'relative';
                dockIcon.appendChild(badge);
            }
        } catch (error) {
            console.warn('设置停靠栏徽章失败:', error);
            // 如果等待超时或出错，尝试传统方法作为后备
            await this.setDockBadgeFallback(count);
        }
    }

    private async setDockBadgeFallback(count: number) {
        // check settings sync - fallback removal
        const settings = await this.loadSettings();
        const showBadge = settings.enableDockBadge !== false && (settings.enableReminderDockBadge !== false);
        if (!showBadge) {
            const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementreminder_dock"]');
            if (!dockIcon) return;
            const existingBadge = dockIcon.querySelector('.reminder-dock-badge');
            if (existingBadge) existingBadge.remove();
            return;
        }
        // 查找停靠栏图标（传统方法作为后备）
        const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementreminder_dock"]');
        if (!dockIcon) return;

        // 移除现有徽章
        const existingBadge = dockIcon.querySelector('.reminder-dock-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'reminder-dock-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                background: var(--b3-theme-error);
                color: white;
                border-radius: 50%;
                min-width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
                pointer-events: none;
            `;

            // 确保父元素有相对定位
            (dockIcon as HTMLElement).style.position = 'relative';
            dockIcon.appendChild(badge);
        }
    }

    private async setProjectDockBadge(count: number) {
        const settings = await this.loadSettings();
        const showBadge = settings.enableDockBadge !== false && (settings.enableProjectDockBadge !== false);
        if (!showBadge) {
            const existingBadge = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementproject_dock"]')?.querySelector('.project-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }
            return;
        }
        try {
            // 等待项目停靠栏图标出现
            const dockIcon = await this.whenElementExist('.dock__item[data-type="siyuan-plugin-task-note-managementproject_dock"]') as HTMLElement;

            // 移除现有徽章
            const existingBadge = dockIcon.querySelector('.project-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 如果计数大于0，添加徽章
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'project-dock-badge';
                badge.textContent = count.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background:#2c6a2e;
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    line-height: 1;
                    z-index: 1;
                    pointer-events: none;
                `;

                // 确保父元素有相对定位
                dockIcon.style.position = 'relative';
                dockIcon.appendChild(badge);
            }
        } catch (error) {
            console.warn('设置项目停靠栏徽章失败:', error);
            // 如果等待超时或出错，尝试传统方法作为后备
            await this.setProjectDockBadgeFallback(count);
        }
    }

    private async setProjectDockBadgeFallback(count: number) {
        const settings = await this.loadSettings();
        const showBadge = settings.enableDockBadge !== false && (settings.enableProjectDockBadge !== false);
        if (!showBadge) {
            const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementproject_dock"]');
            if (!dockIcon) return;
            const existingBadge = dockIcon.querySelector('.project-dock-badge');
            if (existingBadge) existingBadge.remove();
            return;
        }
        // 查找项目停靠栏图标（传统方法作为后备）
        const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementproject_dock"]');
        if (!dockIcon) return;

        // 移除现有徽章
        const existingBadge = dockIcon.querySelector('.project-dock-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'project-dock-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                background: var(--b3-theme-error);
                color: white;
                border-radius: 50%;
                min-width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
                pointer-events: none;
            `;

            // 确保父元素有相对定位
            (dockIcon as HTMLElement).style.position = 'relative';
            dockIcon.appendChild(badge);
        }
    }

    private async updateHabitBadges() {
        try {
            const habitData = await this.loadHabitData();

            if (!habitData || typeof habitData !== 'object') {
                this.setHabitDockBadge(0);
                return;
            }

            const today = getLogicalDateString();
            let pendingCount = 0;

            Object.values(habitData).forEach((habit: any) => {
                if (!habit || typeof habit !== 'object') {
                    return;
                }

                // 检查是否在有效期内
                if (habit.startDate > today) return;
                if (habit.endDate && habit.endDate < today) return;

                // 检查今天是否应该打卡
                if (!this.shouldCheckInOnDate(habit, today)) return;

                // 检查今天是否已完成
                const checkIn = habit.checkIns?.[today];
                const currentCount = checkIn?.count || 0;
                const targetCount = habit.target || 1;

                if (currentCount < targetCount) {
                    pendingCount++;
                }
            });

            this.setHabitDockBadge(pendingCount);
        } catch (error) {
            console.error('更新习惯徽章失败:', error);
            this.setHabitDockBadge(0);
        }
    }

    private shouldCheckInOnDate(habit: any, date: string): boolean {
        const { frequency } = habit;
        const checkDate = new Date(date);
        const startDate = new Date(habit.startDate);

        switch (frequency.type) {
            case 'daily':
                if (frequency.interval) {
                    const daysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                    return daysDiff % frequency.interval === 0;
                }
                return true;

            case 'weekly':
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.interval) {
                    const weeksDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / (86400000 * 7));
                    return weeksDiff % frequency.interval === 0 && checkDate.getDay() === startDate.getDay();
                }
                return checkDate.getDay() === startDate.getDay();

            case 'monthly':
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                if (frequency.interval) {
                    const monthsDiff = (checkDate.getFullYear() - startDate.getFullYear()) * 12 +
                        (checkDate.getMonth() - startDate.getMonth());
                    return monthsDiff % frequency.interval === 0 && checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getDate() === startDate.getDate();

            case 'yearly':
                if (frequency.interval) {
                    const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                    return yearsDiff % frequency.interval === 0 &&
                        checkDate.getMonth() === startDate.getMonth() &&
                        checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getMonth() === startDate.getMonth() &&
                    checkDate.getDate() === startDate.getDate();

            case 'custom':
                // 自定义频率：如果设置了周重复则按周判断，如果设置了月重复则按月判断；默认返回true
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                return true;

            default:
                return true;
        }
    }

    private async setHabitDockBadge(count: number) {
        const settings = await this.loadSettings();
        const showBadge = settings.enableDockBadge !== false && (settings.enableHabitDockBadge !== false);
        if (!showBadge) {
            const existingBadge = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementhabit_dock"]')?.querySelector('.habit-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }
            return;
        }
        try {
            // 等待习惯停靠栏图标出现
            const dockIcon = await this.whenElementExist('.dock__item[data-type="siyuan-plugin-task-note-managementhabit_dock"]') as HTMLElement;

            // 移除现有徽章
            const existingBadge = dockIcon.querySelector('.habit-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 如果计数大于0，添加徽章
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'habit-dock-badge';
                badge.textContent = count.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background: var(--b3-theme-primary);
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    line-height: 1;
                    z-index: 1;
                    pointer-events: none;
                `;

                // 确保父元素有相对定位
                dockIcon.style.position = 'relative';
                dockIcon.appendChild(badge);
            }
        } catch (error) {
            console.warn('设置习惯停靠栏徽章失败:', error);
            // 如果等待超时或出错，尝试传统方法作为后备
            await this.setHabitDockBadgeFallback(count);
            return;
        }
    }

    // 控制停靠栏可见性：通过隐藏停靠栏图标实现启用/禁用（不注销注册）
    private async toggleDockVisibility(dockKey: string, visible: boolean) {
        try {
            const selector = `.dock__item[data-type="siyuan-plugin-task-note-management${dockKey}"]`;
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

    private async setHabitDockBadgeFallback(count: number) {
        const settings = await this.loadSettings();
        const showBadge = settings.enableDockBadge !== false && (settings.enableHabitDockBadge !== false);
        if (!showBadge) {
            const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementhabit_dock"]');
            if (!dockIcon) return;
            const existingBadge = dockIcon.querySelector('.habit-dock-badge');
            if (existingBadge) existingBadge.remove();
            return;
        }
        // 查找习惯停靠栏图标（传统方法作为后备）
        const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementhabit_dock"]');
        if (!dockIcon) return;

        // 移除现有徽章
        const existingBadge = dockIcon.querySelector('.habit-dock-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'habit-dock-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                background: var(--b3-theme-primary);
                color: white;
                border-radius: 50%;
                min-width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
                pointer-events: none;
            `;

            // 确保父元素有相对定位
            (dockIcon as HTMLElement).style.position = 'relative';
            dockIcon.appendChild(badge);
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
                const parentProject = Object.values(projectData).find((p: any) => p.blockId === checkId);
                if (parentProject) {
                    return {
                        projectId: (parentProject as any).id,
                        groupId: undefined,
                        milestoneId: undefined,
                        categoryId: undefined
                    };
                }

                // Check if this parent block is a project group block
                for (const p of Object.values(projectData) as any[]) {
                    if (p.customGroups && Array.isArray(p.customGroups)) {
                        const group = p.customGroups.find((g: any) => g.blockId === checkId);
                        if (group) {
                            return {
                                projectId: p.id,
                                groupId: group.id,
                                milestoneId: undefined,
                                categoryId: undefined
                            };
                        }
                    }
                }
            }

            // 4.1 检查是否是项目主文档
            const project = Object.values(projectData).find((p: any) => p.blockId === rootId);
            if (project) {
                return {
                    projectId: (project as any).id,
                    groupId: undefined,
                    milestoneId: undefined,
                    categoryId: undefined
                };
            }

            // 4.2 检查是否是项目分组的绑定文档
            for (const p of Object.values(projectData) as any[]) {
                if (p.customGroups && Array.isArray(p.customGroups)) {
                    const group = p.customGroups.find((g: any) => g.blockId === rootId);
                    if (group) {
                        return {
                            projectId: p.id,
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
        this.coordinatorChannel = new BroadcastChannel('siyuan-plugin-task-note-management-coordinator');

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
                            customReminderTime: instance.customReminderTime || reminder.customReminderTime,
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
                const dt = this.extractDateAndTime(reminder.time || reminder.customReminderTime);
                const displayTime = dt?.time || reminder.time || reminder.customReminderTime;
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
                const frontend = getFrontend();
                const isDesktop = frontend === 'desktop';

                // 电脑端且开启了系统通知时，不显示思源内部通知；手机端始终显示内部通知
                if (!isDesktop || !systemNotificationEnabled) {
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
                        const parsed = this.extractDateAndTime(reminder.customReminderTime || reminder.time || reminder.time);
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

                    this.showReminderSystemNotification(title, message);
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
                    // 普通（非重复）提醒：按字段分别处理 time 和 customReminderTime

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

                    // 检查 customReminderTime 提醒（对于跨天任务也应在每一天生效，直到 endDate 过期）
                    if (reminderObj.customReminderTime) {
                        // 如果 customReminderTime 带有具体日期（YYYY-MM-DD），则仅在该日期触发；否则按 inDateRange 检查
                        const parsedCustom = this.extractDateAndTime(reminderObj.customReminderTime);
                        const customHasDate = !!parsedCustom.date;
                        const shouldCheckRange = customHasDate ? (parsedCustom.date === today) : inDateRange;
                        if (shouldCheckRange) {
                            const notifyKey = `${reminderObj.id}_${today}_${reminderObj.customReminderTime}_custom`;
                            if (!this.notifiedReminders.has(notifyKey) && this.shouldNotifyNow(reminderObj, today, currentTime, 'customReminderTime')) {
                                // 二次检查持久化记录
                                if (await this.hasReminderNotified(notifyKey)) {
                                    this.notifiedReminders.set(notifyKey, true);
                                } else {
                                    console.debug('checkTimeReminders - triggering customReminderTime reminder', { id: reminderObj.id, date: reminderObj.date, customReminderTime: reminderObj.customReminderTime });
                                    await this.showTimeReminder(reminderObj, 'customReminderTime');
                                    this.notifiedReminders.set(notifyKey, true);
                                    await this.markReminderNotified(notifyKey);
                                }
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
                                        const tempReminder = { ...reminderObj, customReminderTime: rt, note: note ? (reminderObj.note ? reminderObj.note + '\n' + note : note) : reminderObj.note };
                                        await this.showTimeReminder(tempReminder, 'customReminderTime');
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
                                    customReminderTime: modObj.customReminderTime || reminderObj.customReminderTime,
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

                        // customReminderTime 实例提醒
                        if (instance.customReminderTime) {
                            const parsedCustomInst = this.extractDateAndTime(instance.customReminderTime);
                            if (parsedCustomInst.date && parsedCustomInst.date !== instance.date) {
                                // customReminderTime 指定了不同日期，不在此实例触发
                            } else {
                                const notifyKey = `${instance.instanceId}_${today}_${instance.customReminderTime}_custom`;
                                if (!this.notifiedReminders.has(notifyKey) && this.shouldNotifyNow(instance, today, currentTime, 'customReminderTime')) {
                                    // 二次检查持久化记录
                                    if (await this.hasReminderNotified(notifyKey)) {
                                        this.notifiedReminders.set(notifyKey, true);
                                    } else {
                                        console.debug('checkTimeReminders - triggering repeat instance customReminderTime reminder', { id: instance.instanceId, date: instance.date, customReminderTime: instance.customReminderTime });
                                        await this.showTimeReminder(instance, 'customReminderTime');
                                        this.notifiedReminders.set(notifyKey, true);
                                        await this.markReminderNotified(notifyKey);
                                    }
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
                                        const tempInstance = { ...instance, customReminderTime: rt };
                                        await this.showTimeReminder(tempInstance, 'customReminderTime');
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
    private shouldNotifyNow(reminder: any, today: string, currentTime: string, timeField: 'time' | 'customReminderTime' = 'time'): boolean {
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
     * - 如果有 time 和 customReminderTime，只有两者都已被对应标记为已提醒（notifiedTime/notifiedCustomTime）且两者时间都已过时，才将 notified 设为 true。
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
        const hasCustom = !!reminder.customReminderTime;
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

        if (hasTime || hasCustom || hasReminderTimes) {
            const timeOk = !hasTime || (!!reminder.notifiedTime && checkPassed('time'));
            const customOk = !hasCustom || (!!reminder.notifiedCustomTime && checkPassed('customReminderTime'));
            const reminderTimesOk = !hasReminderTimes || reminderTimesAllNotified;

            now = timeOk && customOk && reminderTimesOk;
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

    /**
     * 检查习惯是否在给定日期应该打卡（基于 HabitPanel 的实现复制）
     */
    private shouldCheckHabitOnDate(habit: any, date: string): boolean {
        const frequency = habit.frequency || { type: 'daily' };
        const checkDate = new Date(date);
        const startDate = new Date(habit.startDate);

        switch (frequency.type) {
            case 'daily':
                if (frequency.interval) {
                    const daysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                    return daysDiff % frequency.interval === 0;
                }
                return true;

            case 'weekly':
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.interval) {
                    const weeksDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / (86400000 * 7));
                    return weeksDiff % frequency.interval === 0 && checkDate.getDay() === startDate.getDay();
                }
                return checkDate.getDay() === startDate.getDay();

            case 'monthly':
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                if (frequency.interval) {
                    const monthsDiff = (checkDate.getFullYear() - startDate.getFullYear()) * 12 +
                        (checkDate.getMonth() - startDate.getMonth());
                    return monthsDiff % frequency.interval === 0 && checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getDate() === startDate.getDate();

            case 'yearly':
                if (frequency.interval) {
                    const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                    return yearsDiff % frequency.interval === 0 &&
                        checkDate.getMonth() === startDate.getMonth() &&
                        checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getMonth() === startDate.getMonth() &&
                    checkDate.getDate() === startDate.getDate();

            case 'custom':
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                return true;

            default:
                return true;
        }
    }

    private isHabitCompletedOnDate(habit: any, date: string): boolean {
        const checkIn = habit.checkIns?.[date];
        if (!checkIn) return false;
        return (checkIn.count || 0) >= (habit.target || 1);
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
                    const times: { time: string; note?: string }[] = [];
                    if (Array.isArray(habit.reminderTimes) && habit.reminderTimes.length > 0) {
                        habit.reminderTimes.forEach((rt: any) => {
                            if (typeof rt === 'string') {
                                times.push({ time: rt });
                            } else if (typeof rt === 'object' && rt.time) {
                                times.push(rt);
                            }
                        });
                    } else if (habit.reminderTime) {
                        times.push({ time: habit.reminderTime });
                    }
                    if (times.length === 0) continue;

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
                        const isMobileDevice = getFrontend().endsWith('mobile') || getBackend().endsWith('android') || getBackend().endsWith('ios');

                        // 电脑端且开启了系统通知时，不显示思源内部通知；手机端始终显示内部通知
                        if (isMobileDevice || !systemNotificationEnabled) {
                            NotificationDialog.show(reminderInfo as any);
                        }

                        if (systemNotificationEnabled) {
                            const title = `⏰ ${i18n('habitReminder')}: ${reminderInfo.title}`;
                            let message = `${reminderInfo.time}`.trim();
                            if (reminderInfo.note) {
                                message += `\n📝 ${reminderInfo.note}`;
                            }
                            this.showReminderSystemNotification(title, message, reminderInfo);
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
    private async showTimeReminder(reminder: any, triggerField: 'time' | 'customReminderTime' = 'time') {
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

            const rawChosenTime = (triggerField === 'customReminderTime') ? reminder.customReminderTime : reminder.time;
            const displayChosen = this.extractDateAndTime(rawChosenTime)?.time || rawChosenTime || reminder.time || reminder.customReminderTime;
            const reminderInfo = {
                id: reminder.id,
                blockId: reminder.blockId,
                title: reminder.title || i18n("unnamedNote"),
                note: reminder.note,
                priority: reminder.priority || 'none',
                categoryId: reminder.categoryId,
                // 使用仅时间部分用于显示，若无则回退到原始字段
                time: displayChosen || reminder.time || reminder.customReminderTime,
                date: reminder.date,
                endDate: reminder.endDate,
                isAllDay: false,
                isOverdue: false,
                ...categoryInfo
            };

            // 检查是否启用系统弹窗通知
            const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
            const isMobileDevice = getFrontend().endsWith('mobile') || getBackend().endsWith('android') || getBackend().endsWith('ios');

            // 记录触发字段，方便调试与后续显示一致性处理
            try { (reminderInfo as any)._triggerField = triggerField; } catch (e) { }
            console.debug('showTimeReminder - triggering internal dialog', {
                id: reminderInfo.id,
                triggerField,
                chosenTime: reminderInfo.time,
                date: reminderInfo.date
            });

            // 电脑端且开启了系统通知时，不显示思源内部通知；手机端始终显示内部通知
            if (isMobileDevice || !systemNotificationEnabled) {
                NotificationDialog.show(reminderInfo);
            }

            // 如果启用了系统弹窗，同时也显示系统通知
            if (systemNotificationEnabled) {
                const title = '⏰ ' + i18n("timeReminderNotification");
                const categoryText = (categoryInfo as any).categoryName ? ` [${(categoryInfo as any).categoryName}]` : '';
                let timeText = '';
                if (displayChosen) {
                    timeText = `${displayChosen}`;
                } else if (triggerField === 'time' && reminder.time) {
                    const dt = this.extractDateAndTime(reminder.time);
                    timeText = `${dt.time || reminder.time}`;
                } else if (reminder.customReminderTime) {
                    const dt = this.extractDateAndTime(reminder.customReminderTime);
                    timeText = `${dt.time || reminder.customReminderTime}`;
                }
                const message = `${timeText} ${reminderInfo.title}${categoryText}`;

                this.showReminderSystemNotification(title, message, reminderInfo);
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
     */
    private showReminderSystemNotification(title: string, message: string, reminderInfo?: any) {
        // 判断是否是移动端
        const isMobileDevice = getFrontend().endsWith('mobile') || getBackend().endsWith('android') || getBackend().endsWith('ios') || getBackend().endsWith('harmony');

        if (isMobileDevice) {
            // 手机端：使用内核接口进行系统通知
            try {
                sendNotification(title, message);
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
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        // 权限获取成功，递归调用显示通知
                        this.showReminderSystemNotification(title, message, reminderInfo);
                    }
                });
            }
        } catch (error) {
            console.warn('显示系统弹窗失败:', error);
        }
    }

    // 打开日历视图标签页
    openCalendarTab(data?: { projectFilter?: string }) {
        const isMobile = getFrontend().endsWith('mobile');

        if (isMobile) {
            // 手机端：使用Dialog打开日历视图
            const dialog = new Dialog({
                title: i18n("calendarView"),
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
                    title: i18n("calendarView"),
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
    onDataChanged() {
        console.log("onDataChanged");
        try {
            this.loadSettings(true);
            this.loadReminderData(true);
            this.loadProjectData(true);
            this.loadProjectStatus(true);
            this.loadCategories(true);
            this.loadHabitData(true);
            this.loadHabitGroupData(true);
            this.loadPomodoroRecords(true);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            window.dispatchEvent(new CustomEvent('habitUpdated'));
        } catch (err) {
            console.warn('处理onDataChanged事件失败:', err);
        }
    }
    private addCleanup(fn: () => void) {
        this.cleanupFunctions.push(fn);
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

}
