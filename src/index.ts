import {
    Plugin,
    getActiveEditor,
    showMessage,
    Dialog,
    openTab,
    getFrontend,
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
import { getLocalTimeString, compareDateStrings, getLogicalDateString, setDayStartTime } from "./utils/dateUtils";
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
import { exportIcsFile, uploadIcsToCloud } from "./utils/icsUtils";
import { getFileStat, getFile, hasNotifiedToday, markNotifiedToday } from "./api";
import { resolveAudioPath } from "./utils/audioUtils";
import { showVipDialog } from "./components/VipDialog";

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

export { exportIcsFile, uploadIcsToCloud };



const TAB_TYPE = "reminder_calendar_tab";
const EISENHOWER_TAB_TYPE = "reminder_eisenhower_tab";
export const PROJECT_KANBAN_TAB_TYPE = "project_kanban_tab";
const POMODORO_TAB_TYPE = "pomodoro_timer_tab";
export const STORAGE_NAME = "siyuan-plugin-task-note-management";


// 默认设置
export const DEFAULT_SETTINGS = {
    backgroundVolume: 0.5,
    pomodoroWorkDuration: 45,
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
    dailyFocusGoal: 6,
    autoDetectDateTime: false, // 新增：是否自动识别日期时间
    removeDateAfterDetection: true, // 新增：识别日期后是否移除标题中的日期
    newDocNotebook: '', // 新增：新建文档的笔记本ID
    newDocPath: '/{{now | date "2006/200601"}}/', // 新增：新建文档的路径模板，支持sprig语法
    groupDefaultHeadingLevel: 1, // 新增：新建标题分组的默认层级（1-6），默认为1级标题
    milestoneDefaultHeadingLevel: 2, // 新增：新建标题里程碑的默认层级（1-6），默认为2级标题
    defaultHeadingLevel: 3, // 新增：新建标题的默认层级（1-6），默认为3级标题
    defaultHeadingPosition: 'prepend', // 新增：新建标题的默认位置（'prepend' | 'append'），默认为最前
    weekStartDay: 1, // 新增：周视图的一周开始日 (0=周日, 1=周一，默认周一)
    // 控制侧边栏显示
    enableReminderDock: true, // 侧边栏：提醒（任务管理）
    enableProjectDock: true, // 侧边栏：项目管理
    enableHabitDock: true, // 侧边栏：习惯管理
    // 停靠栏徽章显示控制
    enableDockBadge: true, // 是否在停靠栏显示数字徽章
    // 单独控制每个侧栏是否显示徽章（优先级高于 enableDockBadge）
    enableReminderDockBadge: true,
    enableProjectDockBadge: true,
    enableHabitDockBadge: true,
    // 摘要设置
    showPomodoroInSummary: true,
    showHabitInSummary: true,
    // 排序配置
    sortMethod: 'time',
    sortOrder: 'asc',
    // 日历配置
    calendarShowCategoryAndProject: true, // 新增：是否显示分类图标和项目信息
    calendarColorBy: 'priority',
    calendarViewMode: 'timeGridWeek',
    dayStartTime: '08:00', // 日历视图一天的起始时间
    todayStartTime: '03:00', // 日常任务/习惯的一天起始时间
    calendarShowLunar: (window as any).siyuan?.config?.lang === 'zh_CN' ? true : false, // 日历显示农历
    // 四象限设置
    eisenhowerImportanceThreshold: 'medium',
    eisenhowerUrgencyDays: 3,
    // 项目排序配置
    projectSortOrder: [],
    projectSortMode: 'custom',
    // 日历上传：ICS云端同步配置
    icsSyncInterval: 'daily', // 'manual' | '15min' | 'hourly' | '4hour' | '12hour' | 'daily'
    icsCloudUrl: '',
    icsLastSyncAt: '', // 上一次上传时间
    icsSyncEnabled: false, // 是否启用ICS云端同步
    icsFileName: '', // ICS文件名，默认为空时自动生成
    icsSilentUpload: false, // 是否静默上传ICS文件，不显示成功提示
    icsTaskFilter: 'all', // 'all' | 'completed' | 'uncompleted' - 任务筛选
    // ICS 同步方式配置
    icsSyncMethod: 'siyuan', // 'siyuan' | 's3' - 同步方式
    // S3 配置
    s3UseSiyuanConfig: false, // 是否使用思源的S3配置
    s3Bucket: '',
    s3Endpoint: '',
    s3Region: 'auto', // S3 区域，默认为 auto
    s3AccessKeyId: '',
    s3AccessKeySecret: '',
    s3StoragePath: '', // S3存储路径，例如: /calendar/
    s3ForcePathStyle: false, // S3 Addressing风格，true为Path-style，false为Virtual hosted style（默认）
    s3TlsVerify: true, // S3 TLS证书验证，true为启用验证（默认），false为禁用验证
    s3CustomDomain: '', // S3 自定义域名，用于生成外链
    enableOutlinePrefix: true, // 是否在大纲中为绑定标题添加任务状态前缀
    calendarShowHoliday: true, // 是否显示节假日
    calendarShowPomodoro: true, // 是否显示番茄专注时间
    calendarHolidayIcsUrl: 'https://www.shuyz.com/githubfiles/china-holiday-calender/master/holidayCal.ics?token=cb429c2a-81a6-4c26-8f35-4f4bf0c84b2c&compStart=*&compEnd=*', // 节假日ICS URL
    calendarMultiDaysCount: 3, // 多天视图默认显示天数
    // 数据迁移标记
    datatransfer: {
        bindblockAddAttr: false, // 是否已迁移绑定块的 custom-bind-reminders 属性
        termTypeTransfer: false, // 是否已迁移 termType -> kanbanStatus 的转换
        audioFileTransfer: false, // 是否已迁移音频文件列表
    },
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
    // Set used to track blocks currently being processed to avoid duplicate work and race conditions
    private processingBlockButtons: Set<string> = new Set();

    // ICS 云端同步相关
    private icsSyncTimer: number | null = null;
    private isPerformingIcsSync: boolean = false;

    // ICS 订阅同步相关
    private icsSubscriptionSyncTimer: number | null = null;
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
    private outlinePrefixCache: Map<string, string> = new Map(); // 记录由本插件管理的大纲前缀
    private protyleObservers: WeakMap<Element, MutationObserver> = new WeakMap();
    private protyleDebounceTimers: WeakMap<Element, number> = new WeakMap();
    private cleanupFunctions: (() => void)[] = [];

    private currentHeadingIds: Set<string> = new Set();

    // 内存中的提醒记录，用于避免同一会话中重复提醒
    // 格式: "reminderId_date_time" -> true
    private notifiedReminders: Map<string, boolean> = new Map();
    // 格式: "habitId_date_time" -> true
    private notifiedHabits: Map<string, boolean> = new Map();

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
        // 初始化番茄钟记录管理器，确保番茄数据已加载
        const pomodoroRecordManager = PomodoroRecordManager.getInstance(this);
        await pomodoroRecordManager.initialize();
        // 添加dock栏和顶栏按钮
        await this.initializeUI();

        // 初始化数据并缓存
        await this.loadHabitData();
        await this.loadHabitGroupData();
        await this.loadHolidayData();

        try {
            const { ensureNotifyDataFile } = await import("./api");
            await ensureNotifyDataFile();
        } catch (error) {
            console.warn('初始化通知记录文件失败:', error);
        }


        // 初始化上次番茄钟设置缓存，避免第一次设置更新时误判
        this.lastPomodoroSettings = await this.getPomodoroSettings();

        this.categoryManager = CategoryManager.getInstance(this);
        await this.categoryManager.initialize();


        // 添加用户交互监听器来启用音频
        this.enableAudioOnUserInteraction();

        // 初始化系统通知权限
        this.initSystemNotificationPermission();

        // 监听设置变更，动态显示/隐藏侧边停靠栏
        window.addEventListener('reminderSettingsUpdated', async () => {
            try {
                const settings = await this.loadSettings();
                this.toggleDockVisibility('project_dock', settings.enableProjectDock !== false);
                this.toggleDockVisibility('reminder_dock', settings.enableReminderDock !== false);
                this.toggleDockVisibility('habit_dock', settings.enableHabitDock !== false);
                // 同步刷新徽章（显示/隐藏数字）
                this.updateBadges();
                this.updateProjectBadges();
                this.updateHabitBadges();
                this.updateOutlinePrefixes();
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
                        'workDuration', 'breakDuration', 'longBreakDuration', 'longBreakInterval', 'autoMode', 'backgroundVolume',
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
                if (settings.icsSyncEnabled && settings.icsSyncInterval && settings.icsSyncInterval !== 'manual') {
                    // 启用时立即安排并尽快执行一次同步
                    await this.scheduleIcsSync(settings.icsSyncInterval, true);
                } else if (this.icsSyncTimer) {
                    clearInterval(this.icsSyncTimer);
                    this.icsSyncTimer = null;
                }
            } catch (err) {
                console.warn('处理设置变更失败:', err);
            }
        });

        // 监听文档树右键菜单事件
        this.eventBus.on('open-menu-doctree', this.handleDocumentTreeMenu.bind(this));

        // 初始化ICS云端同步
        this.initIcsSync();

        // 初始化ICS订阅同步
        this.initIcsSubscriptionSync();

        // 初始化当前逻辑日期
        this.currentLogicalDate = getLogicalDateString();

        // 执行数据迁移
        await this.performDataMigration();
        // 
        const frontend = getFrontend();
        const isMobile = frontend.endsWith('mobile');
        const isBrowserDesktop = frontend === 'browser-desktop';
        if (!isMobile && !isBrowserDesktop) {
            // 尝试恢复已存在的番茄钟已独立窗口
            import("./components/PomodoroTimer").then(async ({ PomodoroTimer }) => {
                try {
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
        // 合并默认设置和用户设置，确保所有设置项都有值
        const settings = { ...DEFAULT_SETTINGS, ...data };


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
            backgroundVolume: Math.max(0, Math.min(1, settings.backgroundVolume)),
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
        // 添加顶栏按钮
        // this.topBarElement = this.addTopBar({
        //     icon: "iconClock",
        //     title: t("timeReminder"),
        //     position: "left",
        //     callback: () => this.openReminderFloatPanel()
        // });
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
        } catch (err) {
            console.warn('初始化停靠栏可见性失败:', err);
        }

        // 文档块标添加菜单
        this.eventBus.on('click-editortitleicon', this.handleDocumentMenu.bind(this));

        // 块菜单添加菜单
        this.eventBus.on('click-blockicon', this.handleBlockMenu.bind(this));

        // 定期检查提醒
        this.startReminderCheck();

        // 初始化顶栏徽章和停靠栏徽章
        this.updateBadges();
        this.updateProjectBadges();
        this.updateHabitBadges();

        // 延迟一些时间后再次更新徽章，确保停靠栏已渲染
        setTimeout(() => {
            this.updateBadges();
            this.updateProjectBadges();
            this.updateHabitBadges();
        }, 2000);

        // 监听提醒更新事件，更新徽章
        window.addEventListener('reminderUpdated', () => {
            this.updateBadges();
            this.addBreadcrumbButtonsToExistingProtyles();
            const currentProtyle = getActiveEditor(false)?.protyle;
            // 500ms之后调用
            setTimeout(() => {
                this.addBlockProjectButtonsToProtyle(currentProtyle);
            }, 500);
        });

        // 监听项目更新事件，更新项目徽章并重新扫描protyle块按钮
        window.addEventListener('projectUpdated', () => {
            this.updateProjectBadges();
            this.addBreadcrumbButtonsToExistingProtyles();
        });

        // 监听习惯更新事件，更新习惯徽章
        window.addEventListener('habitUpdated', () => {
            this.updateHabitBadges();
        });
    }

    async onLayoutReady() {
        // 初始化批量设置对话框（确保在UI初始化时创建）
        this.batchReminderDialog = new BatchReminderDialog(this);



        // 注册快捷键
        this.registerCommands();

        // 在布局准备就绪后监听protyle切换事件
        // 注册 switch-protyle 事件处理：仅在此事件中调用 addBlockProjectButtonsToProtyle
        this.eventBus.on('switch-protyle', (e) => {
            // 延迟添加按钮，确保protyle完全切换完成
            setTimeout(() => {
                // 保持原有面包屑按钮初始化
                this.addBreadcrumbReminderButton(e.detail.protyle);
                // 将块按钮逻辑限定为 switch-protyle 事件中调用
                this.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        });
        this.eventBus.on('loaded-protyle-dynamic', (e) => {
            // 延迟添加按钮，确保protyle完全加载完成
            setTimeout(() => {
                this.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        });
        this.eventBus.on('loaded-protyle-static', (e) => {
            // 延迟添加按钮，确保protyle完全加载完成
            setTimeout(() => {

                this.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        });
        // 为当前已存在的protyle添加按钮
        this.addBreadcrumbButtonsToExistingProtyles();

        // 初始化大纲前缀监听
        this.initOutlinePrefixObserver();
    }

    private initOutlinePrefixObserver() {
        let updateTimeout: number | null = null;
        let lastObservedElement: Element | null = null;
        let currentObserver: MutationObserver | null = null;

        // 防抖更新函数，只要检测到变化就更新所有前缀
        const debouncedUpdate = () => {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = window.setTimeout(() => {
                const outline = document.querySelector('.file-tree.sy__outline');
                if (!outline) return;
                this.updateOutlinePrefixes();
            }, 0);
        };

        // 创建观察器函数
        const createObserver = (element: Element) => {
            const observer = new MutationObserver((mutations) => {
                const hasSignificantChange = mutations.some(mutation => {
                    if (mutation.type === 'childList') {
                        return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
                    }
                    if (mutation.type === 'attributes') {
                        return mutation.attributeName === 'data-node-id' || mutation.attributeName === 'aria-label';
                    }
                    if (mutation.type === 'characterData') {
                        return true;
                    }
                    return false;
                });
                if (hasSignificantChange) debouncedUpdate();
            });

            observer.observe(element, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
                attributeFilter: ['data-node-id', 'aria-label']
            });
            return observer;
        };

        // 监听 ws-main 事件，处理属性变化 (bookmark)
        const wsMainHandler = (event: CustomEvent) => {
            const data = event.detail;
            if (data.cmd === "transactions" && data.data) {
                let shouldUpdate = false;
                for (const transaction of data.data) {
                    if (transaction.doOperations) {
                        for (const op of transaction.doOperations) {
                            if (op.action === "updateAttrs") {
                                let hasBookmarkUpdate = false;
                                if (op.data?.new && 'bookmark' in op.data.new) {
                                    hasBookmarkUpdate = true;
                                }
                                if (op.data && 'bookmark' in op.data && !op.data.new) {
                                    hasBookmarkUpdate = true;
                                }
                                if (hasBookmarkUpdate && this.currentHeadingIds.has(op.id)) {
                                    shouldUpdate = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (shouldUpdate) break;
                }
                if (shouldUpdate) debouncedUpdate();
            }
        };

        this.eventBus.on('ws-main', wsMainHandler);

        // 定期检查 DOM 并重新绑定 Observer（应对 Siyuan UI 销毁/重建大纲元素的情况）
        const checkInterval = setInterval(() => {
            const outlineContainer = document.querySelector('.file-tree.sy__outline');
            if (outlineContainer !== lastObservedElement) {
                if (currentObserver) {
                    currentObserver.disconnect();
                }
                lastObservedElement = outlineContainer;
                if (outlineContainer) {
                    currentObserver = createObserver(outlineContainer);
                    debouncedUpdate();
                }
            }
        }, 2000);

        // 初始绑定尝试
        setTimeout(() => {
            const outlineContainer = document.querySelector('.file-tree.sy__outline');
            if (outlineContainer && !currentObserver) {
                lastObservedElement = outlineContainer;
                currentObserver = createObserver(outlineContainer);
                debouncedUpdate();
            } else if (outlineContainer) {
                debouncedUpdate();
            }
        }, 500);

        // 注册资源清理
        this.addCleanup(() => {
            if (currentObserver) currentObserver.disconnect();
            this.eventBus.off('ws-main', wsMainHandler);
            clearInterval(checkInterval);
            if (updateTimeout) clearTimeout(updateTimeout);
        });
    }

    private addBreadcrumbButtonsToExistingProtyles() {
        // 查找所有现有的protyle并添加按钮
        document.querySelectorAll('.protyle').forEach(protyleElement => {
            // 尝试从元素中获取protyle实例
            const protyle = (protyleElement as any).protyle;
            if (protyle) {
                this.addBreadcrumbReminderButton(protyle);
                this.addBlockProjectButtonsToProtyle(protyle);
            }
        });
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

    private async updateOutlinePrefixes() {
        try {
            const settings = await this.loadSettings();
            if (!settings.enableOutlinePrefix) return;

            const outline = document.querySelector('.file-tree.sy__outline');
            if (!outline) return;

            const headingLis = outline.querySelectorAll('li[data-type="NodeHeading"]');
            if (headingLis.length === 0) return;

            // 收集块 ID 和 li 映射
            const blockIds: string[] = [];
            const liMap = new Map<string, HTMLElement>();
            headingLis.forEach(li => {
                const blockId = (li as HTMLElement).getAttribute('data-node-id');
                if (blockId) {
                    blockIds.push(blockId);
                    liMap.set(blockId, li as HTMLElement);
                }
            });

            if (blockIds.length === 0) return;

            // 更新当前标题块ID集合
            this.currentHeadingIds = new Set(blockIds);

            // 使用 SQL 批量查询块属性（只查询 bookmark）
            const { sql } = await import('./api');
            const idsStr = blockIds.map(id => `'${id}'`).join(',');
            const sqlQuery = `SELECT block_id, value FROM attributes WHERE block_id IN (${idsStr}) AND name = 'bookmark' LIMIT -1`;
            const attrsResults = await sql(sqlQuery);

            // 构建 block_id -> bookmark 映射
            const bookmarkMap = new Map<string, string>();
            if (attrsResults && Array.isArray(attrsResults)) {
                attrsResults.forEach((row: any) => {
                    bookmarkMap.set(row.block_id, row.value || '');
                });
            }

            // 更新 DOM
            blockIds.forEach(blockId => {
                const li = liMap.get(blockId);
                if (!li) return;

                const textElement = li.querySelector('.b3-list-item__text') as HTMLElement;
                if (!textElement) return;

                // 获取该块的 bookmark 属性
                const hasAttribute = bookmarkMap.has(blockId);
                const isManaged = this.outlinePrefixCache.has(blockId);

                // 如果该块目前没有相关属性，且之前也不在管理列表中，则视为“非管理块”，跳过处理
                // 这样可以保留用户自己在标题文本中手动添加的 ✅ 或 ⏰
                if (!hasAttribute && !isManaged) {
                    return;
                }

                const bookmark = hasAttribute ? (bookmarkMap.get(blockId) || '') : '';

                // 确定应有的前缀
                let prefix = '';
                if (bookmark === '✅') {
                    prefix = '✅ ';
                } else if (bookmark === '⏰') {
                    prefix = '⏰ ';
                }

                // 更新管理标记：
                // 如果属性被彻底移除（!hasAttribute），则下次不再管理。
                // 如果属性还存在（即使是空值），则继续根据当前 prefix 更新。
                if (!hasAttribute) {
                    this.outlinePrefixCache.delete(blockId);
                } else {
                    this.outlinePrefixCache.set(blockId, prefix);
                }

                // 计算更新后的文本：移除现有前缀并添加正确前缀
                const currentText = textElement.textContent || '';
                const textWithoutPrefix = currentText.replace(/^[✅⏰]\s*/, '');
                const targetText = prefix + textWithoutPrefix;

                // 只有当文本确实需要改变时才更新，避免产生不必要的 DOM 操作和 Observer 回调
                if (currentText !== targetText) {
                    textElement.textContent = targetText;
                }
            });

            // 清理缓存中不再在大纲中出现的块，避免内存泄漏
            const currentBlockIdSet = new Set(blockIds);
            for (const cachedId of this.outlinePrefixCache.keys()) {
                if (!currentBlockIdSet.has(cachedId)) {
                    this.outlinePrefixCache.delete(cachedId);
                }
            }

        } catch (error) {
            console.error('[大纲前缀] 更新失败:', error);
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

        // 1. 优先检查父块
        // 1. 优先检查父块（递归向上直到rootId）
        let currentParentId = parentId;
        while (currentParentId && currentParentId !== rootId) {
            const parentReminder = Object.values(reminderData).find((r: any) => r.blockId === currentParentId && r.projectId);
            if (parentReminder) {
                return {
                    projectId: (parentReminder as any).projectId,
                    groupId: (parentReminder as any).customGroupId,
                    milestoneId: (parentReminder as any).milestoneId,
                    categoryId: (parentReminder as any).categoryId
                };
            }
            // 获取上一级父块
            const parentBlock = await getBlockByID(currentParentId);
            if (!parentBlock) break;
            currentParentId = parentBlock.parent_id;
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
            // 4.0 先检查父块路径是否是项目或者项目分组的绑定块
            let checkParentId = parentId;
            while (checkParentId && checkParentId !== rootId) {
                // Check if this parent block is a project main block
                const parentProject = Object.values(projectData).find((p: any) => p.blockId === checkParentId);
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
                        const group = p.customGroups.find((g: any) => g.blockId === checkParentId);
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

                // Move up
                const parentBlock = await getBlockByID(checkParentId);
                if (!parentBlock) break;
                checkParentId = parentBlock.parent_id;
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
        detail.menu.addItem({
            iconHTML: "⏰",
            label: detail.blockElements.length > 1 ? i18n("batchSetReminderBlocks", { count: detail.blockElements.length.toString() }) : i18n("setTimeReminder"),
            click: async () => {
                if (detail.blockElements && detail.blockElements.length > 0) {
                    const blockIds = detail.blockElements
                        .map(el => el.getAttribute("data-node-id"))
                        .filter(id => id);

                    if (blockIds.length > 0) {
                        await this.handleMultipleBlocks(blockIds);
                    }
                }
            }
        });

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

    private startReminderCheck() {
        // 每30秒检查一次提醒
        if (this.reminderCheckTimer) clearInterval(this.reminderCheckTimer);
        this.reminderCheckTimer = window.setInterval(() => {
            this.checkReminders();
        }, 30000);

        // 启动时立即检查一次
        setTimeout(() => {
            this.checkReminders();
        }, 5000);
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
            await this.checkTimeReminders(reminderData, today, currentTime);

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
                const alreadyNotified = await hasNotifiedToday(today);
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
                const isMobile = frontend.endsWith('mobile');
                const isBrowserDesktop = frontend === 'browser-desktop';

                // 电脑端且开启了系统通知时，不显示思源内部通知；手机端始终显示内部通知
                if (isMobile || isBrowserDesktop || !systemNotificationEnabled) {
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
                        await markNotifiedToday(today);
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
                            console.debug('checkTimeReminders - triggering time reminder', { id: reminderObj.id, date: reminderObj.date, time: reminderObj.time });
                            await this.showTimeReminder(reminderObj, 'time');
                            this.notifiedReminders.set(notifyKey, true);
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
                                console.debug('checkTimeReminders - triggering customReminderTime reminder', { id: reminderObj.id, date: reminderObj.date, customReminderTime: reminderObj.customReminderTime });
                                await this.showTimeReminder(reminderObj, 'customReminderTime');
                                this.notifiedReminders.set(notifyKey, true);
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
                                    console.debug('checkTimeReminders - triggering reminderTimes reminder', { id: reminderObj.id, rt });
                                    const tempReminder = { ...reminderObj, customReminderTime: rt, note: note ? (reminderObj.note ? reminderObj.note + '\n' + note : note) : reminderObj.note };
                                    await this.showTimeReminder(tempReminder, 'customReminderTime');
                                    this.notifiedReminders.set(notifyKey, true);
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
                                console.debug('checkTimeReminders - triggering repeat instance time reminder', { id: instance.instanceId, date: instance.date, time: instance.time });
                                await this.showTimeReminder(instance, 'time');
                                this.notifiedReminders.set(notifyKey, true);
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
                                    console.debug('checkTimeReminders - triggering repeat instance customReminderTime reminder', { id: instance.instanceId, date: instance.date, customReminderTime: instance.customReminderTime });
                                    await this.showTimeReminder(instance, 'customReminderTime');
                                    this.notifiedReminders.set(notifyKey, true);
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
                                    console.debug('checkTimeReminders - triggering repeat instance reminderTimes reminder', { id: instance.instanceId, rt });
                                    const tempInstance = { ...instance, customReminderTime: rt };
                                    await this.showTimeReminder(tempInstance, 'customReminderTime');
                                    this.notifiedReminders.set(notifyKey, true);
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
                        const isMobile = getFrontend().endsWith('mobile');

                        // 电脑端且开启了系统通知时，不显示思源内部通知；手机端始终显示内部通知
                        if (isMobile || !systemNotificationEnabled) {
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

                        // 标记已通知（仅在内存中），避免重复通知
                        this.notifiedHabits.set(notifyKey, true);
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
            const isMobile = getFrontend().endsWith('mobile');

            // 记录触发字段，方便调试与后续显示一致性处理
            try { (reminderInfo as any)._triggerField = triggerField; } catch (e) { }
            console.debug('showTimeReminder - triggering internal dialog', {
                id: reminderInfo.id,
                triggerField,
                chosenTime: reminderInfo.time,
                date: reminderInfo.date
            });

            // 电脑端且开启了系统通知时，不显示思源内部通知；手机端始终显示内部通知
            if (isMobile || !systemNotificationEnabled) {
                NotificationDialog.show(reminderInfo);
            }

            // 如果启用了系统弹窗，同时也显示系统通知
            if (systemNotificationEnabled) {
                const title = '⏰ ' + i18n("timeReminderNotification");
                const categoryText = (categoryInfo as any).categoryName ? ` [${(categoryInfo as any).categoryName}]` : '';
                let timeText = '';
                if (displayChosen) {
                    timeText = ` ⏰${displayChosen}`;
                } else if (triggerField === 'time' && reminder.time) {
                    const dt = this.extractDateAndTime(reminder.time);
                    timeText = ` ${dt.time || reminder.time}`;
                } else if (reminder.customReminderTime) {
                    const dt = this.extractDateAndTime(reminder.customReminderTime);
                    timeText = ` ⏰${dt.time || reminder.customReminderTime}`;
                }
                const message = `${reminderInfo.title}${categoryText}${timeText}`;

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
        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                // 使用浏览器通知
                const notification = new Notification(title, {
                    icon: '/favicon.ico',
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

    private async addBreadcrumbReminderButton(protyle: any) {
        if (!protyle || !protyle.element) return;

        const breadcrumb = protyle.element.querySelector('.protyle-breadcrumb');
        if (!breadcrumb) return;

        // 查找文档按钮
        const docButton = breadcrumb.querySelector('button[data-type="doc"]');
        if (!docButton) return;


        // --- Project Button ---
        const documentId = protyle.block?.rootID;
        if (!documentId) return;

        const projectData = await this.loadProjectData();
        const isProject = projectData && projectData.hasOwnProperty(documentId);

        const existingProjectButton = breadcrumb.querySelector('.project-breadcrumb-btn');
        if (isProject) {
            if (!existingProjectButton) {
                const projectBtn = document.createElement('button');
                projectBtn.className = 'project-breadcrumb-btn block__icon fn__flex-center ariaLabel';
                projectBtn.setAttribute('aria-label', i18n("projectManagement"));
                projectBtn.innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#iconProject"></use></svg>`;
                projectBtn.style.cssText = `
                    margin-right: 4px;
                    padding: 4px;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    border-radius: 4px;
                    color: var(--b3-theme-on-background);
                    opacity: 0.7;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                `;

                projectBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openProjectKanbanTab(
                        projectData[documentId].blockId,
                        projectData[documentId].title
                    );
                });
                breadcrumb.insertBefore(projectBtn, docButton);
            }
        } else {
            if (existingProjectButton) {
                existingProjectButton.remove();
            }
        }

    }

    /**
     * 处理单个 Node 的按钮（用于 MutationObserver 的快速响应）
     */
    private _processSingleBlock(protyle: any, node: Element) {
        if (!node || !node.getAttribute) return;

        // 总是找到最近的块元素
        const blockEl = (node.hasAttribute('data-node-id') ? node : node.closest('[data-node-id]')) as HTMLElement;
        if (!blockEl) return;

        const blockId = blockEl.getAttribute('data-node-id');
        if (!blockId) return;

        // 在块元素上检查属性
        const rawAttr = blockEl.getAttribute('custom-task-projectid');
        const hasBind = blockEl.hasAttribute('custom-bind-reminders');
        const rawMilestones = blockEl.getAttribute('custom-bind-milestones');
        const milestoneProjectId = blockEl.getAttribute('custom-task-projectid');

        const projectIds = rawAttr ? rawAttr.split(',').map(s => s.trim()).filter(s => s) : [];
        const milestoneIds = rawMilestones ? rawMilestones.split(',').map(s => s.trim()).filter(s => s) : [];

        const info = {
            projectIds,
            hasBind,
            milestoneIds,
            milestoneProjectId: milestoneProjectId || undefined,
            element: blockEl // 传递块元素本身作为 sourceElement
        };

        // 如果既没有项目引用也没有绑定也没有里程碑，且存在旧按钮，则需要移除
        if (!rawAttr && !hasBind && !rawMilestones) {
            const btns = protyle.element.querySelectorAll(`[data-block-id="${blockId}"][data-plugin-added="reminder-plugin"]`);
            if (btns.length > 0) {
                btns.forEach((b: Element) => b.remove());
            }
            return;
        }

        // Prevent redundant processing if logic is already running for this block
        if (this.processingBlockButtons.has(blockId)) return;

        this.processingBlockButtons.add(blockId);
        try {
            this._processBlockButtons(protyle, blockId, info);
        } finally {
            this.processingBlockButtons.delete(blockId);
        }
    }

    /**
     * 在当前 protyle 的每个块旁边（protyle-attr）添加项目打开按钮
     * 优化版本：使用延迟执行和更高效的DOM操作，有属性即显示按钮
     */
    /**
     * 扫描 Protyle 内容并更新项目/绑定/里程碑按钮
     */
    private _scanProtyleForButtons(protyle: any) {
        try {
            if (!protyle || !protyle.element) return;

            // 仅扫描具有自定义项目属性或绑定属性或里程碑属性的节点
            const selector = 'div[data-node-id][custom-task-projectid], .protyle-wysiwyg[custom-task-projectid], div[data-node-id][custom-bind-reminders], .protyle-wysiwyg[custom-bind-reminders], div[data-node-id][custom-bind-milestones], .protyle-wysiwyg[custom-bind-milestones]';
            const allBlocks = Array.from(protyle.element.querySelectorAll(selector)) as Element[];

            if (allBlocks.length === 0) {
                this._cleanupOrphanedButtons(protyle);
                return;
            }

            // 预处理：收集所有需要处理的块信息
            const blocksToProcess = new Map<string, { projectIds: string[], hasBind: boolean, milestoneIds: string[], milestoneProjectId?: string, element: Element }>();

            for (const node of allBlocks) {
                const blockId = node.getAttribute('data-node-id') || this._getBlockIdFromElement(node);
                if (!blockId) continue;

                const rawAttr = node.getAttribute('custom-task-projectid');
                const projectIds = rawAttr ? rawAttr.split(',').map(s => s.trim()).filter(s => s) : [];
                const hasBind = node.hasAttribute('custom-bind-reminders');
                const rawMilestones = node.getAttribute('custom-bind-milestones');
                const milestoneIds = rawMilestones ? rawMilestones.split(',').map(s => s.trim()).filter(s => s) : [];
                const milestoneProjectId = node.getAttribute('custom-task-projectid') || undefined;

                blocksToProcess.set(blockId, {
                    projectIds,
                    hasBind,
                    milestoneIds,
                    milestoneProjectId,
                    element: node
                });
            }

            // 批量清理旧按钮
            this._cleanupOrphanedButtons(protyle, blocksToProcess);

            // 批量处理块
            for (const [blockId, info] of blocksToProcess) {
                if (this.processingBlockButtons.has(blockId)) continue;
                this.processingBlockButtons.add(blockId);
                try {
                    this._processBlockButtons(protyle, blockId, info);
                } finally {
                    this.processingBlockButtons.delete(blockId);
                }
            }
        } catch (error) {
            console.error('扫描块按钮失败:', error);
        }
    }

    /**
     * 在当前 protyle 的每个块旁边（protyle-attr）添加项目打开按钮
     * 优化版本：使用 MutationObserver 监听 DOM 变化，确保按钮及时更新
     */
    private async addBlockProjectButtonsToProtyle(protyle: any) {
        if (!protyle || !protyle.element) return;

        // 1. 立即执行一次扫描
        this._scanProtyleForButtons(protyle);

        // 2. 设置 MutationObserver 监听后续变化
        if (!this.protyleObservers.has(protyle.element)) {
            const observer = new MutationObserver((mutations) => {
                let shouldUpdate = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes') {
                        // 监听关键属性变化，立即处理目标节点，减少 flicker
                        shouldUpdate = true;
                        const target = mutation.target as Element;
                        this._processSingleBlock(protyle, target);
                    } else if (mutation.type === 'childList') {
                        if (mutation.addedNodes.length > 0) {
                            shouldUpdate = true;
                            // 对添加的节点进行快速检查
                            mutation.addedNodes.forEach((node) => {
                                if (node.nodeType === 1) { // Element
                                    const el = node as Element;
                                    // 检查节点本身
                                    this._processSingleBlock(protyle, el);
                                    // 检查子节点（限制层级或仅查找特定选择器以保证性能）
                                    const relevantChildren = el.querySelectorAll?.('div[data-node-id][custom-task-projectid], div[data-node-id][custom-bind-reminders], .protyle-wysiwyg[custom-task-projectid], .protyle-wysiwyg[custom-bind-reminders]');
                                    if (relevantChildren && relevantChildren.length > 0) {
                                        relevantChildren.forEach(child => this._processSingleBlock(protyle, child));
                                    }
                                }
                            });
                        }
                        if (mutation.removedNodes.length > 0) {
                            shouldUpdate = true;
                        }
                    }
                }

                if (shouldUpdate) {
                    const element = protyle.element;
                    const existingTimer = this.protyleDebounceTimers.get(element);
                    if (existingTimer) {
                        window.clearTimeout(existingTimer);
                    }

                    const timer = window.setTimeout(() => {
                        this._scanProtyleForButtons(protyle);
                    }, 50); // 降低防抖时间到 50ms 以加快一致性检查

                    this.protyleDebounceTimers.set(element, timer);
                }
            });

            observer.observe(protyle.element, {
                childList: true,
                subtree: true,
                attributes: true,
                // 监听更多属性以应对思源对 DOM 的重构
                attributeFilter: ['custom-task-projectid', 'custom-bind-reminders', 'custom-bind-milestones', 'updated', 'bookmark']
            });

            // 额外监听属性栏本身的变化，有些时候思源会重写 protyle-attr
            const attrObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.target instanceof Element && m.target.classList.contains('protyle-attr')) {
                        const block = m.target.closest('[data-node-id]');
                        if (block) this._processSingleBlock(protyle, block);
                    }
                }
            });
            attrObserver.observe(protyle.element, {
                childList: true,
                subtree: true
            });

            this.protyleObservers.set(protyle.element, observer);

            // 注册清理逻辑 (当插件卸载时)
            this.addCleanup(() => {
                observer.disconnect();
                attrObserver.disconnect();
                this.protyleObservers.delete(protyle.element);
            });
        }
    }

    // 从元素获取块ID的辅助方法
    private _getBlockIdFromElement(element: Element): string | null {
        // 优先使用 data-node-id
        let id = element.getAttribute('data-node-id');
        if (id) return id;

        // 处理 protyle-wysiwyg 情况
        if (element.classList.contains('protyle-wysiwyg')) {
            const prev = element.previousElementSibling;
            if (prev?.classList.contains('protyle-top')) {
                const titleEl = prev.querySelector('.protyle-title');
                id = titleEl?.getAttribute('data-node-id') || titleEl?.closest('[data-node-id]')?.getAttribute('data-node-id') || null;
            }
        }

        // 回退到最近的祖先
        if (!id) {
            id = element.closest('[data-node-id]')?.getAttribute('data-node-id') || null;
        }

        return id;
    }

    // 清理孤立的按钮
    private _cleanupOrphanedButtons(protyle: any, activeBlocks?: Map<string, any>) {
        if (!activeBlocks) return; // 如果没有提供活跃块列表（例如初始全量扫描），则不执行移除逻辑，由 _processBlockButtons 处理

        const activeBlockIds = new Set(activeBlocks.keys());

        // 清理并去重项目按钮：对于同一 (blockId, projectId) 只保留第一个
        const projectButtons = Array.from(protyle.element.querySelectorAll('.block-project-btn')) as HTMLElement[];
        const seen = new Set<string>();
        for (const btn of projectButtons) {
            const blockId = btn.dataset.blockId || btn.closest('[data-node-id]')?.getAttribute('data-node-id');
            const projectId = btn.dataset.projectId || btn.getAttribute('data-project-id') || '';
            const key = `${blockId || ''}|${projectId}`;

            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }

            if (seen.has(key)) {
                btn.remove();
                continue;
            }
            seen.add(key);
        }

        // 清理并去重绑定按钮：对于同一 blockId 只保留一个
        const bindButtons = Array.from(protyle.element.querySelectorAll('.block-bind-reminders-btn')) as HTMLElement[];
        const seenBind = new Set<string>();
        for (const btn of bindButtons) {
            const blockId = btn.dataset.blockId || btn.closest('[data-node-id]')?.getAttribute('data-node-id');
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenBind.has(blockId)) {
                btn.remove();
                continue;
            }
            seenBind.add(blockId);
        }

        // 清理并去重里程碑按钮：对于同一 blockId 只保留一个
        const milestoneButtons = Array.from(protyle.element.querySelectorAll('.block-milestone-btn')) as HTMLElement[];
        const seenMilestone = new Set<string>();
        for (const btn of milestoneButtons) {
            const blockId = btn.dataset.blockId || btn.closest('[data-node-id]')?.getAttribute('data-node-id');
            if (!blockId || !activeBlockIds.has(blockId)) {
                btn.remove();
                continue;
            }
            if (seenMilestone.has(blockId)) {
                btn.remove();
                continue;
            }
            seenMilestone.add(blockId);
        }
    }

    // 处理单个块的按钮
    private _processBlockButtons(protyle: any, blockId: string, info: { projectIds: string[], hasBind: boolean, milestoneIds?: string[], milestoneProjectId?: string, element: Element }) {
        // 使用已知的 blockEl 或者在容器内查找
        const blockEl = (info.element && info.element.getAttribute('data-node-id') === blockId) ?
            info.element as HTMLElement :
            protyle.element.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement;

        if (!blockEl) return;

        const container = this._findButtonContainer(blockEl, info.element);
        if (!container) return;

        // 处理项目按钮
        const existingProjectButtons = new Map<string, HTMLElement>();
        container.querySelectorAll(`.block-project-btn[data-block-id="${blockId}"]`).forEach((btn: HTMLElement) => {
            const pid = btn.dataset.projectId;
            if (pid) existingProjectButtons.set(pid, btn);
        });

        // 添加或更新项目按钮
        for (const pid of info.projectIds) {
            const existingBtn = existingProjectButtons.get(pid);
            if (!existingBtn) {
                const btn = this._createProjectButton(pid, blockId);
                container.appendChild(btn);
            } else {
                // 如果已存在但位置发生了微调或不在当前容器（虽然 container.querySelectorAll 已限制范围，但为了严谨性），确保其仍在
                if (existingBtn.parentElement !== container) {
                    container.appendChild(existingBtn);
                }
            }
        }

        // 移除不需要的项目按钮
        for (const [pid, btn] of existingProjectButtons) {
            if (!info.projectIds.includes(pid)) {
                btn.remove();
            }
        }

        // 处理绑定按钮
        const existingBindBtn = container.querySelector(`.block-bind-reminders-btn[data-block-id="${blockId}"]`) as HTMLElement;
        if (info.hasBind) {
            if (!existingBindBtn) {
                const bindBtn = this._createBindButton(blockId);
                container.appendChild(bindBtn);
            } else if (existingBindBtn.parentElement !== container) {
                container.appendChild(existingBindBtn);
            }
        } else if (existingBindBtn) {
            existingBindBtn.remove();
        }

        // 处理里程碑按钮
        const existingMilestoneBtn = container.querySelector(`.block-milestone-btn[data-block-id="${blockId}"]`) as HTMLElement;
        if (info.milestoneIds && info.milestoneIds.length > 0 && info.milestoneProjectId) {
            if (!existingMilestoneBtn) {
                const milestoneBtn = this._createMilestoneButton(blockId, info.milestoneProjectId, info.milestoneIds);
                container.appendChild(milestoneBtn);
            } else {
                // 更新现有按钮的数据
                existingMilestoneBtn.dataset.milestoneIds = info.milestoneIds.join(',');
                existingMilestoneBtn.dataset.projectId = info.milestoneProjectId;
                if (existingMilestoneBtn.parentElement !== container) {
                    container.appendChild(existingMilestoneBtn);
                }
            }
        } else if (existingMilestoneBtn) {
            existingMilestoneBtn.remove();
        }
    }

    // 查找按钮容器
    private _findButtonContainer(blockEl: HTMLElement, sourceElement: Element): HTMLElement | null {
        // 检查是否为文档级
        const isDocumentLevel = sourceElement.classList.contains('protyle-wysiwyg');

        if (isDocumentLevel) {
            // 文档级：查找标题区域
            const protyleRoot = sourceElement.closest('.protyle');
            if (protyleRoot) {
                const titleElement = protyleRoot.querySelector('.protyle-top .protyle-title.protyle-wysiwyg--attr') ||
                    protyleRoot.querySelector('.protyle-top .protyle-title');
                if (!titleElement) return null;
                // 查找直接子级属性栏
                const attr = Array.from(titleElement.children).find(c => c.classList.contains('protyle-attr'));
                return (attr || titleElement) as HTMLElement;
            }
        } else {
            // 普通块：优先使用直属属性栏 (protyle-attr)，避免查找到嵌套块（如列表项中的第一段）的属性栏
            const directAttr = Array.from(blockEl.children).find(child => child.classList.contains('protyle-attr'));
            if (directAttr) return directAttr as HTMLElement;

            // 回退逻辑
            return (blockEl.querySelector('.protyle-title') ||
                blockEl.firstElementChild) as HTMLElement;
        }

        return null;
    }

    // 创建项目按钮
    private _createProjectButton(projectId: string, blockId: string): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'block-project-btn block__icon fn__flex-center ariaLabel';
        btn.setAttribute('aria-label', `打开项目看板: ${this.projectDataCache[projectId]?.title}`);
        btn.style.cssText = `
            margin-left: 6px;
            padding: 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 3px;
            color: var(--b3-theme-on-background);
            opacity: 0.85;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
        `;
        btn.innerHTML = `<svg class="b3-list-item__graphic" style="width:14px;height:14px"><use xlink:href="#iconProject"></use></svg>`;
        btn.dataset.projectId = projectId;
        btn.dataset.blockId = blockId;
        btn.setAttribute('data-plugin-added', 'reminder-plugin');
        btn.title = i18n('openProjectKanban');

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const projectData = await this.loadProjectData();
                const project = projectData[projectId];
                const title = project ? project.title : projectId;
                this.openProjectKanbanTab(projectId, title);
            } catch (error) {
                console.error('打开项目看板失败:', error);
                this.openProjectKanbanTab(projectId, projectId);
            }
        });

        return btn;
    }

    // 创建绑定按钮
    private _createBindButton(blockId: string): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'block-bind-reminders-btn block__icon fn__flex-center ariaLabel';
        btn.setAttribute('aria-label', '查看绑定任务');
        btn.style.cssText = `
            margin-left: 6px;
            padding: 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 3px;
            color: var(--b3-theme-on-background);
            opacity: 0.85;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
        `;
        btn.innerHTML = `<span style="font-size:14px;line-height:1">📋</span>`;
        btn.dataset.blockId = blockId;
        btn.setAttribute('data-plugin-added', 'reminder-plugin');
        btn.title = '查看绑定任务';

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const { BlockRemindersDialog } = await import('./components/BlockRemindersDialog');
                const dialog = new BlockRemindersDialog(blockId, this);
                await dialog.show();
            } catch (err) {
                console.error('打开块绑定任务对话框失败:', err);
            }
        });

        return btn;
    }

    // 创建里程碑按钮
    private _createMilestoneButton(blockId: string, projectId: string, milestoneIds: string[]): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'block-milestone-btn block__icon fn__flex-center ariaLabel';
        btn.setAttribute('aria-label', '查看里程碑任务');
        btn.style.cssText = `
            margin-left: 6px;
            padding: 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 3px;
            color: var(--b3-theme-on-background);
            opacity: 0.85;
            transition: all 0.12s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
        `;
        btn.innerHTML = `<span style="font-size:14px;line-height:1">🚩</span>`;
        btn.dataset.blockId = blockId;
        btn.dataset.projectId = projectId;
        btn.dataset.milestoneIds = milestoneIds.join(',');
        btn.setAttribute('data-plugin-added', 'reminder-plugin');
        btn.title = '查看里程碑任务';

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                // 获取第一个里程碑ID来显示对话框
                const firstMilestoneId = milestoneIds[0];
                if (!firstMilestoneId) return;

                // 加载项目数据获取里程碑信息
                const projectData = await this.loadProjectData();
                const project = projectData[projectId];

                // 查找里程碑
                let milestone: any = null;
                let groupId: string | null = null;

                // 先从项目里程碑中查找
                if (project?.milestones) {
                    milestone = project.milestones.find((m: any) => m.id === firstMilestoneId);
                }

                // 如果没找到，从分组里程碑中查找
                if (!milestone) {
                    const { ProjectManager } = await import('./utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this);
                    const groups = await projectManager.getProjectCustomGroups(projectId);

                    for (const group of groups) {
                        if (group.milestones) {
                            milestone = group.milestones.find((m: any) => m.id === firstMilestoneId);
                            if (milestone) {
                                groupId = group.id;
                                break;
                            }
                        }
                    }
                }

                if (!milestone) {
                    console.warn('Milestone not found:', firstMilestoneId);
                    return;
                }

                // 获取或创建项目看板视图实例
                const tabId = this.name + PROJECT_KANBAN_TAB_TYPE + projectId;
                let kanbanView = this.tabViews.get(tabId);

                if (kanbanView && typeof kanbanView.showMilestoneTasksDialog === 'function') {
                    // 如果看板视图已存在，直接调用
                    await kanbanView.showMilestoneTasksDialog(milestone, groupId);
                } else {
                    // 否则动态导入并创建临时实例
                    const { ProjectKanbanView } = await import('./components/ProjectKanbanView');
                    const tempContainer = document.createElement('div');
                    const tempView = new ProjectKanbanView(tempContainer, this, projectId);
                    await tempView.showMilestoneTasksDialog(milestone, groupId);
                }
            } catch (err) {
                console.error('打开里程碑任务对话框失败:', err);
            }
        });

        return btn;
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
            if (this.icsSyncTimer) {
                clearInterval(this.icsSyncTimer);
                this.icsSyncTimer = null;
            }
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
    /**
     * 初始化系统通知权限
     */
    private async initSystemNotificationPermission() {
        try {
            if ('Notification' in window) {
                if (Notification.permission === 'default') {
                    // 在用户交互时请求权限
                    const enableNotification = async () => {
                        const permission = await Notification.requestPermission();
                        if (permission === 'granted') {
                        } else {
                            console.error('系统通知权限被拒绝');
                        }

                        // 移除事件监听器
                        document.removeEventListener('click', enableNotification);
                        document.removeEventListener('touchstart', enableNotification);
                        document.removeEventListener('keydown', enableNotification);
                    };

                    // 监听用户交互事件来请求权限（只触发一次）
                    document.addEventListener('click', enableNotification, { once: true });
                    document.addEventListener('touchstart', enableNotification, { once: true });
                    document.addEventListener('keydown', enableNotification, { once: true });
                }
            }
        } catch (error) {
            console.warn('初始化系统通知权限失败:', error);
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
    async getRemoveDateAfterDetectionEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.removeDateAfterDetection !== false;
    }

    /**
     * 打开番茄钟独立窗口
     * @param reminder 提醒对象
     * @param settings 番茄钟设置
     * @param isCountUp 是否正计时模式
     * @param inheritState 继承的状态
     */
    // 初始化ICS云端同步
    private async initIcsSync() {
        const settings = await this.loadSettings();
        if (settings.icsSyncEnabled && settings.icsSyncInterval && settings.icsSyncInterval !== 'manual') {
            // 启用时立即执行一次初始同步
            await this.scheduleIcsSync(settings.icsSyncInterval, true);
        }
    }

    // 调度ICS同步
    private async scheduleIcsSync(interval: 'manual' | '15min' | 'hourly' | '4hour' | '12hour' | 'daily', executeImmediately: boolean = true) {
        // 如果是手动模式，不启动定时同步
        if (interval === 'manual') {
            if (this.icsSyncTimer) {
                clearInterval(this.icsSyncTimer);
                this.icsSyncTimer = null;
            }
            return;
        }
        // 使用短轮询（例如每30s）比较时间是否达到预定的下次同步时间，避免长期 setInterval 被后台杀死的问题
        if (this.icsSyncTimer) {
            clearInterval(this.icsSyncTimer);
        }

        const intervalMsMap: Record<string, number> = {
            '15min': 15 * 60 * 1000,
            'hourly': 60 * 60 * 1000,
            '4hour': 4 * 60 * 60 * 1000,
            '12hour': 12 * 60 * 60 * 1000,
            'daily': 24 * 60 * 60 * 1000,
        };
        const intervalMs = intervalMsMap[interval] || 24 * 60 * 60 * 1000;
        const shortPollMs = 30 * 1000; // 30s 检查一次

        // 计算首次的 nextDue 时间
        let nextDueMs: number;
        try {
            const settings = await this.loadSettings();
            if (settings && settings.icsLastSyncAt) {
                const last = Date.parse(settings.icsLastSyncAt);
                if (!isNaN(last)) {
                    nextDueMs = last + intervalMs;
                } else {
                    // 无效时间，按间隔后触发
                    nextDueMs = Date.now() + intervalMs;
                }
            } else {
                // 若没有上次同步时间，按是否立即执行决定：
                if (executeImmediately) {
                    nextDueMs = Date.now();
                } else if (interval === 'hourly' || interval === '4hour' || interval === '12hour') {
                    // 对齐到下一个整点或多个小时边界（例如每4小时、每12小时）
                    const d = new Date();
                    const h = d.getHours();
                    let step = 1;
                    if (interval === '4hour') step = 4;
                    else if (interval === '12hour') step = 12;
                    // 计算下一个 step 的边界小时（例如当前小时为 5，step=4 则下一个为 8）
                    const nextHour = Math.ceil((h + 1) / step) * step;
                    d.setHours(nextHour, 0, 0, 0);
                    nextDueMs = d.getTime();
                } else {
                    nextDueMs = Date.now() + intervalMs;
                }
            }
        } catch (e) {
            console.warn('计算 ICS 下次同步时间失败，使用默认策略:', e);
            nextDueMs = Date.now() + intervalMs;
        }

        // 立即触发（当需要时）
        if (executeImmediately && Date.now() >= nextDueMs) {
            await this.performIcsSync();
            try {
                const s2 = await this.loadSettings();
                const last2 = s2 && s2.icsLastSyncAt ? Date.parse(s2.icsLastSyncAt) : Date.now();
                nextDueMs = (isNaN(last2) ? Date.now() : last2) + intervalMs;
            } catch (e) {
                nextDueMs = Date.now() + intervalMs;
            }
        }

        // 启动短轮询，比较当前时间与 nextDue
        this.icsSyncTimer = window.setInterval(async () => {
            try {
                const now = Date.now();
                if (now < nextDueMs) return;

                if (this.isPerformingIcsSync) return;
                await this.performIcsSync();

                // 同步成功后，重新读取设置中的 last sync 时间以计算下一次触发时间
                try {
                    const s = await this.loadSettings();
                    const last = s && s.icsLastSyncAt ? Date.parse(s.icsLastSyncAt) : NaN;
                    if (!isNaN(last)) {
                        nextDueMs = last + intervalMs;
                    } else {
                        nextDueMs = Date.now() + intervalMs;
                    }
                } catch (e) {
                    nextDueMs = Date.now() + intervalMs;
                }
            } catch (e) {
                console.warn('短轮询触发 ICS 同步失败:', e);
            }
        }, shortPollMs);
    }

    // 执行ICS同步
    private async performIcsSync() {
        if (this.isPerformingIcsSync) return;
        this.isPerformingIcsSync = true;
        try {
            const settings = await this.loadSettings();
            if (!settings.icsSyncEnabled) return;

            // 检查reminder.json是否有新事件
            const reminderPath = '/data/storage/petal/siyuan-plugin-task-note-management/reminder.json';
            const stat = await getFileStat(reminderPath);
            const lastSync = settings.icsLastSyncAt ? new Date(settings.icsLastSyncAt).getTime() : 0;
            if (stat && stat.mtime <= lastSync) {
                // 没有新事件，只更新同步时间
                settings.icsLastSyncAt = new Date().toISOString();
                await this.saveSettings(settings);
                return;
            }

            await uploadIcsToCloud(this, settings, settings.icsSilentUpload);
        } catch (error) {
            console.error('ICS自动同步失败:', error);
        } finally {
            this.isPerformingIcsSync = false;
        }
    }

    // 初始化ICS订阅同步
    private async initIcsSubscriptionSync() {
        try {

            // 启动定时检查 (参考 ICS 云端同步的短轮询机制)
            this.scheduleIcsSubscriptionSync();
        } catch (error) {
            console.error('初始化ICS订阅同步失败:', error);
        }
    }

    // 安排ICS订阅定时同步
    private async scheduleIcsSubscriptionSync() {
        if (this.icsSubscriptionSyncTimer) {
            window.clearInterval(this.icsSubscriptionSyncTimer);
            this.icsSubscriptionSyncTimer = null;
        }

        const shortPollMs = 60 * 1000; // 每分钟检查一次是否需要同步
        this.icsSubscriptionSyncTimer = window.setInterval(async () => {
            try {
                await this.performIcsSubscriptionSync();
            } catch (error) {
                console.error('ICS订阅轮询同步检查失败:', error);
            }
        }, shortPollMs);
    }

    // 执行到期的订阅同步
    private async performIcsSubscriptionSync() {
        const { loadSubscriptions, syncSubscription, getSyncIntervalMs, saveSubscriptions } = await import('./utils/icsSubscription');

        let data;
        try {
            data = await loadSubscriptions(this);
        } catch (e) {
            return;
        }

        const subscriptions = Object.values(data.subscriptions).filter((sub: any) => sub.enabled);
        if (subscriptions.length === 0) return;

        let changed = false;
        const now = Date.now();

        for (const sub of subscriptions as any[]) {
            // 跳过手动模式的订阅
            if (sub.syncInterval === 'manual') {
                continue;
            }

            const intervalMs = getSyncIntervalMs(sub.syncInterval);
            const lastSyncMs = sub.lastSync ? Date.parse(sub.lastSync) : 0;

            // 如果到了同步时间
            if (now >= lastSyncMs + intervalMs) {
                console.log(`[Timer] Syncing ICS subscription: ${sub.name}`);
                const result = await syncSubscription(this, sub);

                // 更新订阅状态信息
                sub.lastSync = new Date().toISOString();
                sub.lastSyncStatus = result.success ? 'success' : 'error';
                if (!result.success) {
                    sub.lastSyncError = result.error;
                } else {
                    sub.lastSyncError = undefined;
                }

                data.subscriptions[sub.id] = sub;
                changed = true;
            }
        }

        if (changed) {
            await saveSubscriptions(this, data);
        }
    }

    /**
     * 执行数据迁移
     */
    private async performDataMigration() {
        try {
            const settings = await this.loadSettings();

            // 检查是否需要迁移绑定块属性
            if (!settings.datatransfer?.bindblockAddAttr) {
                console.log('开始迁移绑定块属性...');
                await this.migrateBindBlockAttributes();
                console.log('绑定块属性迁移完成');

                // 标记迁移完成
                settings.datatransfer = settings.datatransfer || {};
                settings.datatransfer.bindblockAddAttr = true;
                await this.saveSettings(settings);
            }

            // 检查是否需要迁移 termType -> kanbanStatus 并删除 termType 键
            if (!settings.datatransfer?.termTypeTransfer) {
                try {
                    console.log('开始迁移 termType 到 kanbanStatus 并删除 termType 键...');
                    const reminderData = await this.loadReminderData(true);
                    if (reminderData && typeof reminderData === 'object') {
                        let mappedCount = 0;
                        let removedCount = 0;
                        for (const [id, item] of Object.entries(reminderData) as [string, any][]) {
                            try {
                                if (!item || typeof item !== 'object') continue;

                                // 如果当前状态是 todo 且 termType 为 short_term/long_term，则将 kanbanStatus 设置为 termType
                                if (item.kanbanStatus === 'todo' && (item.termType === 'short_term' || item.termType === 'long_term')) {
                                    item.kanbanStatus = item.termType;
                                    mappedCount++;
                                }

                                // 无论是否做了映射，都删除 termType 键（按要求移除该键）
                                if ('termType' in item) {
                                    try {
                                        delete item.termType;
                                        removedCount++;
                                    } catch (e) {
                                        // 某些情况下 item 可能是不可写对象，尝试设置为 undefined 再删除
                                        try {
                                            (item as any).termType = undefined;
                                            delete (item as any).termType;
                                            removedCount++;
                                        } catch (ee) {
                                            console.warn(`无法删除提醒 ${id} 的 termType 键:`, ee);
                                        }
                                    }
                                }
                            } catch (err) {
                                console.warn(`迁移提醒 ${id} 时出错:`, err);
                            }
                        }

                        if (mappedCount > 0 || removedCount > 0) {
                            await this.saveReminderData(reminderData);
                            console.log(`termType 迁移完成，映射 ${mappedCount} 条，删除 ${removedCount} 条 termType 键`);
                        } else {
                            console.log('termType 迁移完成，未发现需要映射或删除的项');
                        }
                    } else {
                        console.log('没有找到提醒数据，跳过 termType 迁移');
                    }

                    settings.datatransfer = settings.datatransfer || {};
                    settings.datatransfer.termTypeTransfer = true;
                    await this.saveSettings(settings);
                } catch (err) {
                    console.error('termType 到 kanbanStatus 的迁移失败:', err);
                }
            }

            // 检查是否需要迁移随机休息相关的设置项名称 (randomNotification -> randomRest)
            if (!settings.datatransfer?.randomRestTransfer) {
                console.log('开始迁移随机休息设置项...');
                let migratedCount = 0;
                const mapping = {
                    'randomNotificationEnabled': 'randomRestEnabled',
                    'randomNotificationMinInterval': 'randomRestMinInterval',
                    'randomNotificationMaxInterval': 'randomRestMaxInterval',
                    'randomNotificationBreakDuration': 'randomRestBreakDuration',
                    'randomNotificationSystemNotification': 'randomRestSystemNotification',
                    'randomNotificationPopupWindow': 'randomRestPopupWindow',
                    'randomNotificationSounds': 'randomRestSounds',
                    'randomNotificationEndSound': 'randomRestEndSound'
                };

                for (const [oldKey, newKey] of Object.entries(mapping)) {
                    if (oldKey in settings) {
                        (settings as any)[newKey] = (settings as any)[oldKey];
                        delete (settings as any)[oldKey];
                        migratedCount++;
                    }
                }

                // 迁移 audioFileLists 和 audioSelected 中的键名
                const audioMapping = {
                    'randomNotificationSounds': 'randomRestSounds',
                    'randomNotificationEndSound': 'randomRestEndSound'
                };

                if (settings.audioFileLists) {
                    for (const [oldKey, newKey] of Object.entries(audioMapping)) {
                        if (settings.audioFileLists[oldKey]) {
                            settings.audioFileLists[newKey] = settings.audioFileLists[oldKey];
                            delete settings.audioFileLists[oldKey];
                            migratedCount++;
                        }
                    }
                }

                if (settings.audioSelected) {
                    for (const [oldKey, newKey] of Object.entries(audioMapping)) {
                        if (settings.audioSelected[oldKey]) {
                            settings.audioSelected[newKey] = settings.audioSelected[oldKey];
                            delete settings.audioSelected[oldKey];
                            migratedCount++;
                        }
                    }
                }

                settings.datatransfer = settings.datatransfer || {};
                settings.datatransfer.randomRestTransfer = true;
                await this.saveSettings(settings);
                console.log(`随机休息设置项迁移完成，更新了 ${migratedCount} 个项`);
            }

            // 检查是否需要迁移音频文件列表
            if (!settings.datatransfer?.audioFileTransfer) {
                console.log('开始迁移音频文件列表...');
                const audioKeys = [
                    'notificationSound',
                    'pomodoroWorkSound',
                    'pomodoroBreakSound',
                    'pomodoroLongBreakSound',
                    'pomodoroWorkEndSound',
                    'pomodoroBreakEndSound',
                    'randomRestSounds',
                    'randomRestEndSound',
                ];
                if (!settings.audioFileLists) settings.audioFileLists = {};
                if (!settings.audioSelected) settings.audioSelected = {};

                let migratedCount = 0;
                for (const key of audioKeys) {
                    const existing = (settings as any)[key] as string | undefined;
                    if (existing) {
                        const list: any[] = settings.audioFileLists[key] ?? [];
                        // 确保 list 是 AudioFileItem[]
                        const itemList: AudioFileItem[] = list.map(item =>
                            typeof item === 'string' ? { path: item } : item
                        );

                        // 特殊处理随机微休息的多选字符串
                        if (!itemList.some(i => i.path === existing)) {
                            itemList.push({ path: existing }); // 保持原有顺序，加到后面
                            migratedCount++;
                        }
                        settings.audioFileLists[key] = itemList;
                        // 记录当前选中
                        settings.audioSelected[key] = existing;
                        // 迁移后从根部删除旧键
                        delete (settings as any)[key];
                    } else if (settings.audioFileLists[key]) {
                        // 如果没有旧键，但存在旧的 string[] 列表，也需要转换
                        const list = settings.audioFileLists[key];
                        if (list.length > 0 && typeof list[0] === 'string') {
                            settings.audioFileLists[key] = (list as any).map((p: string) => ({ path: p }));
                        }
                    }
                }

                settings.datatransfer = settings.datatransfer || {};
                settings.datatransfer.audioFileTransfer = true;
                await this.saveSettings(settings);
                console.log(`音频文件列表迁移完成，更新了 ${migratedCount} 个项`);
            }
        } catch (error) {
            console.error('数据迁移失败:', error);
        }
    }

    /**
     * 迁移绑定块属性：为绑定了提醒的块添加 custom-bind-reminders 属性
     */
    private async migrateBindBlockAttributes() {
        try {
            const { setBlockAttrs } = await import('./api');
            const reminderData = await this.loadReminderData();

            if (!reminderData || typeof reminderData !== 'object') {
                console.log('没有找到提醒数据，跳过迁移');
                return;
            }

            let migratedCount = 0;

            // 遍历所有提醒，找到绑定到块的提醒
            for (const [reminderId, reminder] of Object.entries(reminderData) as [string, any][]) {
                if (!reminder || !reminder.blockId) continue;

                try {
                    // 检查块是否已经有 custom-bind-reminders 属性
                    const blockElement = document.querySelector(`[data-node-id="${reminder.blockId}"]`);
                    if (!blockElement) continue;

                    const existingAttr = blockElement.getAttribute('custom-bind-reminders');
                    if (existingAttr) {
                        // 如果已经存在，检查是否包含当前提醒ID
                        const existingIds = existingAttr.split(',').map(s => s.trim());
                        if (existingIds.includes(reminderId)) {
                            continue; // 已经包含，跳过
                        }
                        // 添加新的提醒ID
                        existingIds.push(reminderId);
                        await setBlockAttrs(reminder.blockId, {
                            'custom-bind-reminders': existingIds.join(',')
                        });
                    } else {
                        // 不存在，设置新的属性
                        await setBlockAttrs(reminder.blockId, {
                            'custom-bind-reminders': reminderId
                        });
                    }

                    migratedCount++;
                } catch (error) {
                    console.warn(`迁移块 ${reminder.blockId} 的属性失败:`, error);
                }
            }

            console.log(`成功迁移了 ${migratedCount} 个绑定块的属性`);

        } catch (error) {
            console.error('迁移绑定块属性时出错:', error);
            throw error;
        }
    }
}
