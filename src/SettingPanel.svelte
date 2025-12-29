<script lang="ts">
    import { onMount } from 'svelte';
    import { Dialog } from 'siyuan';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import {
        DEFAULT_SETTINGS,
        SETTINGS_FILE,
        PROJECT_DATA_FILE,
        CATEGORIES_DATA_FILE,
        REMINDER_DATA_FILE,
        HABIT_DATA_FILE,
        NOTIFY_DATA_FILE,
        POMODORO_RECORD_DATA_FILE,
        HABIT_GROUP_DATA_FILE,
        STATUSES_DATA_FILE,
    } from './index';
    import { lsNotebooks, pushErrMsg, pushMsg, removeFile } from './api';
    import { Constants } from 'siyuan';
    import { exportIcsFile, uploadIcsToCloud } from './utils/icsUtils';
    import { importIcsFile } from './utils/icsImport';

    export let plugin;

    // 使用从 index.ts 导入的默认设置
    let settings = { ...DEFAULT_SETTINGS };

    // 笔记本列表
    let notebooks: Array<{ id: string; name: string }> = [];

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
    }

    export const useShell = async (cmd: 'showItemInFolder' | 'openPath', filePath: string) => {
        try {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd,
                filePath: filePath,
            });
        } catch (error) {
            await pushErrMsg('当前客户端不支持打开插件数据文件夹');
        }
    };

    // 定义设置分组
    let groups: ISettingGroup[] = [
        {
            name: t('sidebarSettings'),
            items: [
                {
                    key: 'enableReminderDock',
                    value: settings.enableReminderDock,
                    type: 'checkbox',
                    title: t('enableReminderDock'),
                    description: t('enableReminderDockDesc'),
                },
                {
                    key: 'enableProjectDock',
                    value: settings.enableProjectDock,
                    type: 'checkbox',
                    title: t('enableProjectDock'),
                    description: t('enableProjectDockDesc'),
                },
                {
                    key: 'enableHabitDock',
                    value: settings.enableHabitDock,
                    type: 'checkbox',
                    title: t('enableHabitDock'),
                    description: t('enableHabitDockDesc'),
                },
                {
                    key: 'enableDockBadge',
                    value: settings.enableDockBadge,
                    type: 'checkbox',
                    title: t('enableDockBadge'),
                    description: t('enableDockBadgeDesc'),
                },
                {
                    key: 'enableReminderDockBadge',
                    value: settings.enableReminderDockBadge,
                    type: 'checkbox',
                    title: t('enableReminderDockBadge'),
                    description: t('enableReminderDockBadgeDesc'),
                },
                {
                    key: 'enableProjectDockBadge',
                    value: settings.enableProjectDockBadge,
                    type: 'checkbox',
                    title: t('enableProjectDockBadge'),
                    description: t('enableProjectDockBadgeDesc'),
                },
                {
                    key: 'enableHabitDockBadge',
                    value: settings.enableHabitDockBadge,
                    type: 'checkbox',
                    title: t('enableHabitDockBadge'),
                    description: t('enableHabitDockBadgeDesc'),
                },
            ],
        },
        {
            name: t('notificationReminder'),
            items: [
                {
                    key: 'notificationSound',
                    value: settings.notificationSound,
                    type: 'textinput',
                    title: t('notificationSoundSetting'),
                    description: t('notificationSoundDesc'),
                },
                {
                    key: 'reminderSystemNotification',
                    value: settings.reminderSystemNotification,
                    type: 'checkbox',
                    title: t('reminderSystemNotification'),
                    description: t('reminderSystemNotificationDesc'),
                },
                {
                    key: 'dailyNotificationTime',
                    value: settings.dailyNotificationTime,
                    type: 'textinput',
                    placeholder: '09:00',
                    title: t('dailyNotificationTime'),
                    description: t('dailyNotificationTimeDesc'),
                },
                {
                    key: 'dailyNotificationEnabled',
                    value: settings.dailyNotificationEnabled,
                    type: 'checkbox',
                    title: t('dailyNotificationEnabled'),
                    description: t('dailyNotificationEnabledDesc'),
                },
            ],
        },
        {
            name: t('calendarSettings'),
            items: [
                {
                    key: 'weekStartDay',
                    // For select UI, use string values so they match option keys in the DOM
                    value: String(settings.weekStartDay),
                    type: 'select',
                    title: t('weekStartDay'),
                    description: t('weekStartDayDesc'),
                    options: {
                        0: t('sunday'),
                        1: t('monday'),
                        2: t('tuesday'),
                        3: t('wednesday'),
                        4: t('thursday'),
                        5: t('friday'),
                        6: t('saturday'),
                    },
                },
                {
                    key: 'dayStartTime',
                    value: settings.dayStartTime,
                    type: 'textinput',
                    title: t('dayStartTime'),
                    description: t('dayStartTimeDesc'),
                    placeholder: '08:00',
                },
                {
                    key: 'todayStartTime',
                    value: settings.todayStartTime,
                    type: 'textinput',
                    title: t('todayStart'),
                    description: t('todayStartDesc'),
                    placeholder: '03:00',
                },
            ],
        },
        {
            name: '✅任务笔记设置',
            items: [
                {
                    key: 'autoDetectDateTime',
                    value: settings.autoDetectDateTime,
                    type: 'checkbox',
                    title: t('autoDetectDateTime'),
                    description: t('autoDetectDateTimeDesc'),
                },
                {
                    key: 'newDocNotebook',
                    value: settings.newDocNotebook,
                    type: 'select',
                    title: t('newDocNotebook'),
                    description: t('newDocNotebookDesc'),
                    options: notebooks.reduce(
                        (acc, notebook) => {
                            acc[notebook.id] = notebook.name;
                            return acc;
                        },
                        {} as { [key: string]: string }
                    ),
                },
                {
                    key: 'newDocPath',
                    value: settings.newDocPath,
                    type: 'textinput',
                    title: t('newDocPath'),
                    description: t('newDocPathDesc'),
                },
                {
                    key: 'defaultHeadingLevel',
                    value: settings.defaultHeadingLevel,
                    type: 'select',
                    title: t('defaultHeadingLevel'),
                    description: t('defaultHeadingLevelDesc'),
                    options: {
                        1: '1',
                        2: '2',
                        3: '3',
                        4: '4',
                        5: '5',
                        6: '6',
                    },
                },
                {
                    key: 'defaultHeadingPosition',
                    value: settings.defaultHeadingPosition,
                    type: 'select',
                    title: t('defaultHeadingPosition'),
                    description: t('defaultHeadingPositionDesc'),
                    options: {
                        prepend: t('prepend'),
                        append: t('append'),
                    },
                },
                {
                    key: 'enableOutlinePrefix',
                    value: settings.enableOutlinePrefix,
                    type: 'checkbox',
                    title: t('enableOutlinePrefix'),
                    description: t('enableOutlinePrefixDesc'),
                },
            ],
        },
        {
            name: t('pomodoroSettings'),
            items: [
                {
                    key: 'pomodoroHint',
                    value: '',
                    type: 'hint',
                    title: t('pomodoroHintTitle'),
                    description: t('pomodoroHintDesc'),
                },
                {
                    key: 'pomodoroWorkDuration',
                    value: settings.pomodoroWorkDuration,
                    type: 'number',
                    title: t('pomodoroWorkDuration'),
                    description: t('pomodoroWorkDurationDesc'),
                },
                {
                    key: 'pomodoroBreakDuration',
                    value: settings.pomodoroBreakDuration,
                    type: 'number',
                    title: t('pomodoroBreakDuration'),
                    description: t('pomodoroBreakDurationDesc'),
                },
                {
                    key: 'pomodoroLongBreakDuration',
                    value: settings.pomodoroLongBreakDuration,
                    type: 'number',
                    title: t('pomodoroLongBreakDuration'),
                    description: t('pomodoroLongBreakDurationDesc'),
                },
                {
                    key: 'pomodoroLongBreakInterval',
                    value: settings.pomodoroLongBreakInterval,
                    type: 'number',
                    title: t('pomodoroLongBreakInterval'),
                    description: t('pomodoroLongBreakIntervalDesc'),
                },
                {
                    key: 'pomodoroAutoMode',
                    value: settings.pomodoroAutoMode,
                    type: 'checkbox',
                    title: t('pomodoroAutoMode'),
                    description: t('pomodoroAutoModeDesc'),
                },
                {
                    key: 'pomodoroSystemNotification',
                    value: settings.pomodoroSystemNotification,
                    type: 'checkbox',
                    title: t('pomodoroSystemNotification'),
                    description: t('pomodoroSystemNotificationDesc'),
                },
                {
                    key: 'dailyFocusGoal',
                    value: settings.dailyFocusGoal,
                    type: 'number',
                    title: t('dailyFocusGoal'),
                    description: t('dailyFocusGoalDesc'),
                },
                {
                    key: 'backgroundVolume',
                    value: settings.backgroundVolume,
                    type: 'slider',
                    title: t('backgroundVolume'),
                    description: t('backgroundVolumeDesc'),
                    slider: {
                        min: 0,
                        max: 1,
                        step: 0.1,
                    },
                },
                {
                    key: 'pomodoroWorkSound',
                    value: settings.pomodoroWorkSound,
                    type: 'textinput',
                    title: t('pomodoroWorkSound'),
                    description: t('pomodoroWorkSoundDesc'),
                },
                {
                    key: 'pomodoroBreakSound',
                    value: settings.pomodoroBreakSound,
                    type: 'textinput',
                    title: t('pomodoroBreakSound'),
                    description: t('pomodoroBreakSoundDesc'),
                },
                {
                    key: 'pomodoroLongBreakSound',
                    value: settings.pomodoroLongBreakSound,
                    type: 'textinput',
                    title: t('pomodoroLongBreakSound'),
                    description: t('pomodoroLongBreakSoundDesc'),
                },
                {
                    key: 'pomodoroWorkEndSound',
                    value: settings.pomodoroWorkEndSound,
                    type: 'textinput',
                    title: t('pomodoroWorkEndSound'),
                    description: t('pomodoroWorkEndSoundDesc'),
                },
                {
                    key: 'pomodoroBreakEndSound',
                    value: settings.pomodoroBreakEndSound,
                    type: 'textinput',
                    title: t('pomodoroBreakEndSound'),
                    description: t('pomodoroBreakEndSoundDesc'),
                },
            ],
        },
        {
            name: t('randomNotificationSettings'),
            items: [
                {
                    key: 'randomNotificationEnabled',
                    value: settings.randomNotificationEnabled,
                    type: 'checkbox',
                    title: t('randomNotificationEnabled'),
                    description: t('randomNotificationEnabledDesc'),
                },
                {
                    key: 'randomNotificationSystemNotification',
                    value: settings.randomNotificationSystemNotification,
                    type: 'checkbox',
                    title: t('randomNotificationSystemNotification'),
                    description: t('randomNotificationSystemNotificationDesc'),
                },
                {
                    key: 'randomNotificationMinInterval',
                    value: settings.randomNotificationMinInterval,
                    type: 'number',
                    title: t('randomNotificationMinInterval'),
                    description: t('randomNotificationMinIntervalDesc'),
                },
                {
                    key: 'randomNotificationMaxInterval',
                    value: settings.randomNotificationMaxInterval,
                    type: 'number',
                    title: t('randomNotificationMaxInterval'),
                    description: t('randomNotificationMaxIntervalDesc'),
                },
                {
                    key: 'randomNotificationBreakDuration',
                    value: settings.randomNotificationBreakDuration,
                    type: 'number',
                    title: t('randomNotificationBreakDuration'),
                    description: t('randomNotificationBreakDurationDesc'),
                },
                {
                    key: 'randomNotificationSounds',
                    value: settings.randomNotificationSounds,
                    type: 'textinput',
                    title: t('randomNotificationSounds'),
                    description: t('randomNotificationSoundsDesc'),
                },
                {
                    key: 'randomNotificationEndSound',
                    value: settings.randomNotificationEndSound,
                    type: 'textinput',
                    title: t('randomNotificationEndSound'),
                    description: t('randomNotificationEndSoundDesc'),
                },
            ],
        },
        {
            name: '📁' + t('dataStorageLocation'),
            items: [
                {
                    key: 'dataStorageInfo',
                    value: 'data/storage/petal/siyuan-plugin-task-note-management',
                    type: 'hint',
                    title: t('dataStorageLocationTitle'),
                    description: t('dataStorageLocationDesc'),
                },
                {
                    key: 'openDataFolder',
                    value: '',
                    type: 'button',
                    title: '打开数据文件夹',
                    description: '',
                    button: {
                        label: '打开数据文件夹',
                        callback: async () => {
                            const path =
                                window.siyuan.config.system.dataDir +
                                '/storage/petal/siyuan-plugin-task-note-management';
                            await useShell('openPath', path);
                        },
                    },
                },
                {
                    key: 'deletePluginData',
                    value: '',
                    type: 'button',
                    title: '删除插件数据',
                    description: '删除所有插件数据文件，此操作不可逆',
                    button: {
                        label: '删除数据',
                        callback: async () => {
                            const confirmed = confirm('确定要删除所有插件数据吗？此操作不可逆！');
                            if (confirmed) {
                                const dataDir =
                                    'data/storage/petal/siyuan-plugin-task-note-management/';
                                const files = [
                                    SETTINGS_FILE,
                                    PROJECT_DATA_FILE,
                                    CATEGORIES_DATA_FILE,
                                    REMINDER_DATA_FILE,
                                    HABIT_DATA_FILE,
                                    NOTIFY_DATA_FILE,
                                    POMODORO_RECORD_DATA_FILE,
                                    HABIT_GROUP_DATA_FILE,
                                    STATUSES_DATA_FILE,
                                ];
                                let successCount = 0;
                                for (const file of files) {
                                    try {
                                        await removeFile(dataDir + file);
                                        successCount++;
                                    } catch (e) {
                                        console.error('删除文件失败:', file, e);
                                    }
                                }
                                pushErrMsg(`数据删除完成，已删除 ${successCount} 个文件`);
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            }
                        },
                    },
                },
            ],
        },
        {
            name: '⬆️导出',
            items: [
                {
                    key: 'exportIcs',
                    value: '',
                    type: 'button',
                    title: '导出 ICS 文件',
                    description:
                        '将提醒导出为标准 ICS 日历文件，可导入到 Outlook、Google Calendar 等日历应用',
                    button: {
                        label: '生成 ICS',
                        callback: async () => {
                            await exportIcsFile(plugin, true);
                        },
                    },
                },
                {
                    key: 'exportIcsXiaomi',
                    value: '',
                    type: 'button',
                    title: '导出 ICS 文件（小米兼容）',
                    description: '生成适配小米日历的 ICS（将 DURATION:P1DT 替换为 DURATION:P1D）',
                    button: {
                        label: '生成 ICS（小米）',
                        callback: async () => {
                            await exportIcsFile(plugin, true);
                        },
                    },
                },
            ],
        },
        {
            name: '⬇️导入',
            items: [
                {
                    key: 'importIcs',
                    value: '',
                    type: 'button',
                    title: '导入 ICS 文件',
                    description: '从 ICS 文件导入任务，支持批量设置所属项目、标签和优先级',
                    button: {
                        label: '选择文件导入',
                        callback: async () => {
                            // 创建文件输入元素
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = '.ics';
                            input.onchange = async (e: Event) => {
                                const target = e.target as HTMLInputElement;
                                const file = target.files?.[0];
                                if (!file) return;

                                try {
                                    const content = await file.text();

                                    // 显示批量设置对话框
                                    showImportDialog(content);
                                } catch (error) {
                                    console.error('读取文件失败:', error);
                                    await pushErrMsg('读取文件失败');
                                }
                            };
                            input.click();
                        },
                    },
                },
            ],
        },
        {
            name: '📅' + t('icsSubscription'),
            items: [
                {
                    key: 'icsSubscriptionHint',
                    value: '',
                    type: 'hint',
                    title: t('icsSubscription'),
                    description: t('icsSubscriptionDesc'),
                },
                {
                    key: 'manageSubscriptions',
                    value: '',
                    type: 'button',
                    title: t('manageSubscriptions'),
                    description: '管理ICS日历订阅，支持设置项目、分类、优先级和同步频率',
                    button: {
                        label: t('manageSubscriptions'),
                        callback: async () => {
                            showSubscriptionManagementDialog();
                        },
                    },
                },
            ],
        },
        {
            name: '☁️日历上传',
            items: [
                {
                    key: 'icsSyncHint',
                    value: '',
                    type: 'hint',
                    title: 'ICS 云端同步',
                    description:
                        '将ICS文件上传到云端，实现多设备间的提醒同步。支持思源服务器或S3存储。',
                },
                {
                    key: 'icsFormat',
                    value: settings.icsFormat,
                    type: 'select',
                    title: 'ICS 格式',
                    description: '选择ICS文件的格式',
                    options: {
                        normal: '常规 ICS',
                        xiaomi: '小米兼容',
                    },
                },
                {
                    key: 'icsFileName',
                    value: settings.icsFileName,
                    type: 'textinput',
                    title: 'ICS 文件名',
                    description:
                        '自定义ICS文件名（不含.ics后缀），留空则自动生成为 reminder-随机ID',
                    placeholder: 'reminder-' + (window.Lute?.NewNodeID?.() || 'auto'),
                },
                {
                    key: 'icsSyncMethod',
                    value: settings.icsSyncMethod,
                    type: 'select',
                    title: '同步方式',
                    description: '选择ICS文件的同步方式',
                    options: {
                        siyuan: '思源订阅会员服务器',
                        s3: 'S3存储',
                    },
                },
                {
                    key: 'icsSyncEnabled',
                    value: settings.icsSyncEnabled,
                    type: 'checkbox',
                    title: '启用 ICS 定时云端同步',
                    description: '开启后按设置的间隔自动生成并上传 ICS 文件到云端',
                },
                {
                    key: 'icsSyncInterval',
                    value: settings.icsSyncInterval,
                    type: 'select',
                    title: 'ICS 同步间隔',
                    description: '设置自动同步ICS文件到云端的频率',
                    options: {
                        '15min': '每15分钟',
                        hourly: '每1小时',
                        '4hour': '每4小时',
                        '12hour': '每12小时',
                        daily: '每天',
                    },
                },
                {
                    key: 'icsSilentUpload',
                    value: settings.icsSilentUpload,
                    type: 'checkbox',
                    title: '静默上传ICS文件',
                    description: '启用后，定时上传ICS文件时不显示成功提示消息',
                },
                {
                    key: 'uploadIcsToCloud',
                    value: '',
                    type: 'button',
                    title: '生成并上传 ICS 到云端',
                    description: '生成ICS文件并立即上传到云端',
                    button: {
                        label: '生成并上传',
                        callback: async () => {
                            await uploadIcsToCloud(plugin, settings);
                        },
                    },
                },

                {
                    key: 'icsCloudUrl',
                    value: settings.icsCloudUrl,
                    type: 'textinput',
                    title: 'ICS 云端链接',
                    description: '上传成功后自动生成的云端链接',
                    disabled: false,
                },
                {
                    key: 'icsLastSyncAt',
                    value: settings.icsLastSyncAt
                        ? new Date(settings.icsLastSyncAt).toLocaleString()
                        : '',
                    type: 'textinput',
                    title: '上一次上传时间',
                    description: '显示上次成功上传ICS文件的时间',
                    disabled: true,
                },
                // 思源服务器同步配置

                // S3 同步配置
                {
                    key: 's3UseSiyuanConfig',
                    value: settings.s3UseSiyuanConfig,
                    type: 'checkbox',
                    title: '使用思源S3设置',
                    description: '启用后将使用思源的S3配置，无需手动配置下方的S3参数',
                },
                {
                    key: 's3Bucket',
                    value: settings.s3Bucket,
                    type: 'textinput',
                    title: 'S3 Bucket',
                    description: 'S3存储桶名称',
                    placeholder: 'my-bucket',
                },
                {
                    key: 's3Endpoint',
                    value: settings.s3Endpoint,
                    type: 'textinput',
                    title: 'S3 Endpoint',
                    description: 'S3服务端点地址，可省略协议前缀（自动添加https://）',
                    placeholder: 'oss-cn-shanghai.aliyuncs.com',
                },
                {
                    key: 's3Region',
                    value: settings.s3Region,
                    type: 'textinput',
                    title: 'S3 Region',
                    description: 'S3区域，例如 oss-cn-shanghai',
                    placeholder: 'auto',
                },
                {
                    key: 's3AccessKeyId',
                    value: settings.s3AccessKeyId,
                    type: 'textinput',
                    title: 'S3 Access Key ID',
                    description: 'S3访问密钥ID',
                },
                {
                    key: 's3AccessKeySecret',
                    value: settings.s3AccessKeySecret,
                    type: 'textinput',
                    title: 'S3 Access Key Secret',
                    description: 'S3访问密钥Secret',
                },
                {
                    key: 's3StoragePath',
                    value: settings.s3StoragePath,
                    type: 'textinput',
                    title: 'S3 存储路径',
                    description: 'S3中的存储路径，例如: /calendar/ 或留空存储在根目录',
                    placeholder: '/calendar/',
                },
                {
                    key: 's3ForcePathStyle',
                    value: settings.s3ForcePathStyle,
                    type: 'select',
                    title: 'S3 Addressing 风格',
                    description:
                        '访问文件URL，Path-style: https://endpoint/bucket/key, Virtual hosted: https://bucket.endpoint/key',
                    options: {
                        true: 'Path-style',
                        false: 'Virtual hosted style',
                    },
                },
                {
                    key: 's3TlsVerify',
                    value: settings.s3TlsVerify,
                    type: 'select',
                    title: 'S3 TLS 证书验证',
                    description: '是否验证TLS/SSL证书，关闭后可连接自签名证书的服务',
                    options: {
                        true: '启用验证',
                        false: '禁用验证',
                    },
                },
                {
                    key: 's3CustomDomain',
                    value: settings.s3CustomDomain,
                    type: 'textinput',
                    title: 'S3 自定义域名',
                    description: '用于生成外链的自定义域名，留空则使用标准S3 URL',
                    placeholder: 'cdn.example.com',
                },
            ],
        },
        {
            name: '❤️用爱发电',
            items: [
                {
                    key: 'donateInfo',
                    value: '',
                    type: 'hint',
                    title: '用爱发电',
                    description: `
                        项目 GitHub 地址: <a href="https://github.com/achuan-2/siyuan-plugin-task-note-management">https://github.com/achuan-2/siyuan-plugin-task-note-management</a>
                        <p style="margin-top:12px;">如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。</p>

                        <p style="margin-top:12px;">维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，</p>

                        <p style="margin-top:12px;">我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现，我没实现的功能欢迎有大佬来pr</p>

                        <p style="margin-top:12px;">累积赞赏50元的朋友如果想加我微信，可以在赞赏的时候备注微信号，或者发邮件到<a href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</a>来进行好友申请</p>

                        <div style="margin-top:12px;">
                            <img src="plugins/siyuan-plugin-task-note-management/assets/donate.png" alt="donate" style="max-width:260px; height:auto; border:1px solid var(--b3-border-color);"/>
                        </div>
                    `,
                },
            ],
        },
    ];

    let focusGroup = groups[0].name;

    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = ({ detail }: CustomEvent<ChangeEvent>) => {
        console.log(detail.key, detail.value);
        const setting = settings[detail.key];
        if (setting !== undefined) {
            // 如果是weekStartDay，将字符串转为数字
            if (detail.key === 'weekStartDay' && typeof detail.value === 'string') {
                const parsed = parseInt(detail.value, 10);
                settings[detail.key] = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
            } else if (
                (detail.key === 's3ForcePathStyle' || detail.key === 's3TlsVerify') &&
                typeof detail.value === 'string'
            ) {
                // 将字符串 'true'/'false' 转换为布尔值
                settings[detail.key] = detail.value === 'true';
            } else if (detail.key === 'dailyNotificationTime') {
                // 允许用户输入 HH:MM，也兼容数字（小时）或单个小时字符串
                let v = detail.value;
                if (typeof v === 'number') {
                    const h = Math.max(0, Math.min(23, Math.floor(v)));
                    v = (h < 10 ? '0' : '') + h.toString() + ':00';
                } else if (typeof v === 'string') {
                    const m = v.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
                    if (m) {
                        const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                        const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                        v =
                            (h < 10 ? '0' : '') +
                            h.toString() +
                            ':' +
                            (min < 10 ? '0' : '') +
                            min.toString();
                    } else {
                        // 如果无法解析，回退到默认
                        v = DEFAULT_SETTINGS.dailyNotificationTime;
                    }
                }
                settings[detail.key] = v;
            } else if (detail.key === 'todayStartTime') {
                const oldValue = settings[detail.key]; // 保存旧值用于比较
                let v = detail.value;
                if (typeof v === 'number') {
                    const h = Math.max(0, Math.min(23, Math.floor(v)));
                    v = (h < 10 ? '0' : '') + h.toString() + ':00';
                } else if (typeof v === 'string') {
                    const m = v.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
                    if (m) {
                        const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                        const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                        v =
                            (h < 10 ? '0' : '') +
                            h.toString() +
                            ':' +
                            (min < 10 ? '0' : '') +
                            min.toString();
                    } else {
                        v = DEFAULT_SETTINGS.todayStartTime;
                    }
                }
                settings[detail.key] = v;

                // 如果一天起始时间发生了变化，需要重新生成番茄钟按天记录
                if (oldValue !== v) {
                    (async () => {
                        try {
                            // 先更新一天起始时间设置，这样getLogicalDateString会使用新的起始时间
                            const { setDayStartTime } = await import('./utils/dateUtils');
                            setDayStartTime(v);

                            // 然后重新生成番茄钟记录
                            const { PomodoroRecordManager } = await import(
                                './utils/pomodoroRecord'
                            );
                            const recordManager = PomodoroRecordManager.getInstance(plugin);
                            await recordManager.regenerateRecordsByDate();

                        } catch (error) {
                            console.error('重新生成番茄钟记录失败:', error);
                            pushErrMsg('重新生成番茄钟记录失败');
                        }
                    })();
                }
            } else {
                settings[detail.key] = detail.value;
            }

            saveSettings();
            // 确保 UI 中 select 等值显示被刷新
            updateGroupItems();
        }
    };

    async function saveSettings() {
        await plugin.saveData(SETTINGS_FILE, settings);
        // 通知其他组件（如日历视图）设置项已更新
        try {
            window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
        } catch (err) {
            console.warn('Dispatch settings updated event failed:', err);
        }
    }

    onMount(() => {
        // 执行异步加载
        (async () => {
            await loadNotebooks();
            await runload();
        })();

        // 监听外部设置变更事件，重新加载设置并刷新 UI
        const settingsUpdateHandler = async () => {
            const loadedSettings = await plugin.loadSettings();
            settings = { ...loadedSettings };
            // 确保 weekStartDay 在加载后是数字（可能以字符串形式保存）
            if (typeof settings.weekStartDay === 'string') {
                const parsed = parseInt(settings.weekStartDay, 10);
                settings.weekStartDay = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
            }
            updateGroupItems();
        };
        window.addEventListener('reminderSettingsUpdated', settingsUpdateHandler);

        // 在组件销毁时移除监听
        return () => {
            window.removeEventListener('reminderSettingsUpdated', settingsUpdateHandler);
        };
    });

    async function loadNotebooks() {
        try {
            const result = await lsNotebooks();
            notebooks = result.notebooks.map(notebook => ({
                id: notebook.id,
                name: notebook.name,
            }));
        } catch (error) {
            console.error('加载笔记本列表失败:', error);
            notebooks = [];
        }
    }

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = { ...loadedSettings };
        // 确保 weekStartDay 在加载后是数字（可能以字符串形式保存）
        if (typeof settings.weekStartDay === 'string') {
            const parsed = parseInt(settings.weekStartDay, 10);
            settings.weekStartDay = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
        }
        updateGroupItems();
        // 确保设置已保存（可能包含新的默认值）
        await saveSettings();
        console.debug('加载配置文件完成');
    }

    function updateGroupItems() {
        groups = groups.map(group => ({
            ...group,
            items: group.items.map(item => {
                const updatedItem = {
                    ...item,
                    value: (() => {
                        const v = settings[item.key] ?? item.value;
                        // If this is a select input, use string representation for UI matching
                        if (item.type === 'select') {
                            return typeof v === 'string' ? v : String(v);
                        }
                        if (item.key === 'icsLastSyncAt') {
                            return v ? new Date(v).toLocaleString() : '';
                        }
                        return v;
                    })(),
                };

                // 为笔记本选择器更新选项
                if (item.key === 'newDocNotebook') {
                    updatedItem.options = notebooks.reduce(
                        (acc, notebook) => {
                            acc[notebook.id] = notebook.name;
                            return acc;
                        },
                        {} as { [key: string]: string }
                    );
                }

                return updatedItem;
            }),
        }));
    }

    // 根据 icsSyncEnabled 和 icsSyncMethod 控制相关项的显示和隐藏
    $: filteredGroups = groups.map(group => ({
        ...group,
        items: group.items.map(item => {
            const updated = { ...item } as any;

            // 通用同步设置，仅在同步启用时可用
            if (item.key === 'icsSyncInterval') {
                updated.disabled = !settings.icsSyncEnabled;
            }

            // S3专用设置 - s3UseSiyuanConfig仅在启用同步且选择S3存储时显示
            if (item.key === 's3UseSiyuanConfig') {
                updated.hidden = !settings.icsSyncEnabled || settings.icsSyncMethod !== 's3';
            }

            // S3 bucket、存储路径和自定义域名 - 仅在启用同步且选择S3存储时显示（即使使用思源配置也允许覆盖）
            if (['s3Bucket', 's3StoragePath', 's3CustomDomain'].includes(item.key)) {
                updated.hidden = !settings.icsSyncEnabled || settings.icsSyncMethod !== 's3';
            }

            // S3详细配置 - 仅在启用同步、选择S3存储且未启用"使用思源S3设置"时显示
            if (
                [
                    's3Endpoint',
                    's3Region',
                    's3AccessKeyId',
                    's3AccessKeySecret',
                    's3ForcePathStyle',
                    's3TlsVerify',
                ].includes(item.key)
            ) {
                updated.hidden =
                    !settings.icsSyncEnabled ||
                    settings.icsSyncMethod !== 's3' ||
                    settings.s3UseSiyuanConfig === true;
            }

            return updated;
        }),
    }));

    $: currentGroup = filteredGroups.find(group => group.name === focusGroup);

    // ICS导入对话框
    async function showImportDialog(icsContent: string) {
        // 加载项目和标签数据
        const { ProjectManager } = await import('./utils/projectManager');
        const projectManager = ProjectManager.getInstance(plugin);
        await projectManager.loadProjects();
        const groupedProjects = projectManager.getProjectsGroupedByStatus();

        const dialog = new Dialog({
            title: '导入 ICS 文件',
            content: `
                <div class="b3-dialog__content" style="padding: 16px;">
                    <div class="fn__flex-column" style="gap: 16px;">
                        <div class="b3-label">
                            <div class="b3-label__text">批量设置所属项目（可选）</div>
                            <div class="fn__hr"></div>
                            <div style="display: flex; gap: 8px;">
                                <select class="b3-select fn__flex-1" id="import-project-select">
                                    <option value="">不设置</option>
                                    ${Object.entries(groupedProjects)
                                        .map(([statusId, statusProjects]) => {
                                            if (statusProjects.length === 0) return '';
                                            const status = projectManager
                                                .getStatusManager()
                                                .getStatusById(statusId);
                                            const label = status
                                                ? `${status.icon || ''} ${status.name}`
                                                : statusId;
                                            return `
                                        <optgroup label="${label}">
                                            ${statusProjects
                                                .map(
                                                    p => `
                                                <option value="${p.id}">${p.name}</option>
                                            `
                                                )
                                                .join('')}
                                        </optgroup>
                                    `;
                                        })
                                        .join('')}
                                </select>
                                <button class="b3-button b3-button--outline" id="import-create-project" title="新建项目">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div class="b3-label">
                            <div class="b3-label__text">批量设置分类（可选）</div>
                            <div class="fn__hr"></div>
                            <div id="import-category-selector" class="category-selector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                                <!-- 分类选择器将在这里渲染 -->
                            </div>
                        </div>
                        
                        <div class="b3-label">
                            <div class="b3-label__text">批量设置优先级（可选）</div>
                            <div class="fn__hr"></div>
                            <select class="b3-select fn__flex-1" id="import-priority">
                                <option value="">不设置</option>
                                <option value="high">高优先级</option>
                                <option value="medium">中优先级</option>
                                <option value="low">低优先级</option>
                                <option value="none">无优先级</option>
                            </select>
                        </div>
                        
                        <div class="fn__hr"></div>
                        
                        <div class="fn__flex" style="justify-content: flex-end; gap: 8px;">
                            <button class="b3-button b3-button--cancel">取消</button>
                            <button class="b3-button b3-button--text" id="import-confirm">导入</button>
                        </div>
                    </div>
                </div>
            `,
            width: '500px',
        });

        const projectSelect = dialog.element.querySelector(
            '#import-project-select'
        ) as HTMLSelectElement;
        const createProjectBtn = dialog.element.querySelector(
            '#import-create-project'
        ) as HTMLButtonElement;
        const categorySelector = dialog.element.querySelector(
            '#import-category-selector'
        ) as HTMLElement;
        const confirmBtn = dialog.element.querySelector('#import-confirm');
        const cancelBtn = dialog.element.querySelector('.b3-button--cancel');

        let selectedCategoryId: string = '';

        // 渲染分类选择器
        async function renderCategories() {
            if (!categorySelector) return;

            try {
                const { CategoryManager } = await import('./utils/categoryManager');
                const categoryManager = CategoryManager.getInstance(plugin);
                await categoryManager.initialize();
                const categories = categoryManager.getCategories();

                // 清空并重新构建
                categorySelector.innerHTML = '';

                // 添加无分类选项
                const noCategoryEl = document.createElement('div');
                noCategoryEl.className = 'category-option';
                noCategoryEl.setAttribute('data-category', '');
                noCategoryEl.textContent = '无分类';
                noCategoryEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 6px 12px;
                    font-size: 13px;
                    border-radius: 6px;
                    background: var(--b3-theme-background-light);
                    border: 1px solid var(--b3-border-color);
                    color: var(--b3-theme-on-surface);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    user-select: none;
                `;
                noCategoryEl.classList.add('selected');
                categorySelector.appendChild(noCategoryEl);

                // 添加所有分类选项
                categories.forEach(category => {
                    const categoryEl = document.createElement('div');
                    categoryEl.className = 'category-option';
                    categoryEl.setAttribute('data-category', category.id);
                    categoryEl.textContent = `${category.icon ? category.icon + ' ' : ''}${category.name}`;
                    categoryEl.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        padding: 6px 12px;
                        font-size: 13px;
                        border-radius: 6px;
                        background: ${category.color}20;
                        border: 1px solid ${category.color};
                        color: var(--b3-theme-on-surface);
                        cursor: pointer;
                        transition: all 0.2s ease;
                        user-select: none;
                    `;
                    categorySelector.appendChild(categoryEl);
                });

                // 绑定点击事件
                categorySelector.querySelectorAll('.category-option').forEach(el => {
                    el.addEventListener('click', () => {
                        // 移除所有选中状态
                        categorySelector.querySelectorAll('.category-option').forEach(opt => {
                            opt.classList.remove('selected');
                            const catId = opt.getAttribute('data-category');
                            if (catId) {
                                const cat = categories.find(c => c.id === catId);
                                if (cat) {
                                    (opt as HTMLElement).style.background = cat.color + '20';
                                    (opt as HTMLElement).style.fontWeight = '500';
                                }
                            } else {
                                (opt as HTMLElement).style.background =
                                    'var(--b3-theme-background-light)';
                                (opt as HTMLElement).style.fontWeight = '500';
                            }
                        });

                        // 设置当前选中
                        el.classList.add('selected');
                        const catId = el.getAttribute('data-category');
                        selectedCategoryId = catId || '';

                        if (catId) {
                            const cat = categories.find(c => c.id === catId);
                            if (cat) {
                                (el as HTMLElement).style.background = cat.color;
                                (el as HTMLElement).style.color = '#fff';
                                (el as HTMLElement).style.fontWeight = '600';
                            }
                        } else {
                            (el as HTMLElement).style.background = 'var(--b3-theme-surface)';
                            (el as HTMLElement).style.fontWeight = '600';
                        }
                    });

                    // 悬停效果
                    el.addEventListener('mouseenter', () => {
                        (el as HTMLElement).style.opacity = '0.8';
                        (el as HTMLElement).style.transform = 'translateY(-1px)';
                    });

                    el.addEventListener('mouseleave', () => {
                        (el as HTMLElement).style.opacity = '1';
                        (el as HTMLElement).style.transform = 'translateY(0)';
                    });
                });
            } catch (error) {
                console.error('加载分类失败:', error);
                categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
            }
        }

        // 初始化时渲染分类选择器
        await renderCategories();

        // 新建项目按钮
        createProjectBtn.addEventListener('click', async () => {
            try {
                // 使用 ProjectDialog 创建项目
                const { ProjectDialog } = await import('./components/ProjectDialog');
                const projectDialog = new ProjectDialog(undefined, plugin);
                await projectDialog.show();

                // 监听项目创建成功事件
                const handleProjectCreated = async (event: CustomEvent) => {
                    // 重新加载项目列表
                    await projectManager.loadProjects();
                    const groupedProjects = projectManager.getProjectsGroupedByStatus();

                    // 清空并重新填充下拉列表
                    projectSelect.innerHTML = '<option value="">不设置</option>';
                    Object.entries(groupedProjects).forEach(([statusId, statusProjects]) => {
                        if (statusProjects.length === 0) return;
                        const status = projectManager.getStatusManager().getStatusById(statusId);
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = status ? `${status.icon || ''} ${status.name}` : statusId;

                        statusProjects.forEach(p => {
                            const option = document.createElement('option');
                            option.value = p.id;
                            option.textContent = p.name;
                            optgroup.appendChild(option);
                        });
                        projectSelect.appendChild(optgroup);
                    });

                    // 选中新创建的项目
                    if (event.detail && event.detail.projectId) {
                        projectSelect.value = event.detail.projectId;
                    }

                    // 移除事件监听器
                    window.removeEventListener(
                        'projectUpdated',
                        handleProjectCreated as EventListener
                    );
                };

                window.addEventListener('projectUpdated', handleProjectCreated as EventListener);
            } catch (error) {
                console.error('创建项目失败:', error);
                await pushErrMsg('创建项目失败');
            }
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', async () => {
            const projectId = projectSelect?.value.trim() || undefined;
            const priority =
                ((dialog.element.querySelector('#import-priority') as HTMLSelectElement)
                    ?.value as any) || undefined;

            try {
                await importIcsFile(plugin, icsContent, {
                    projectId,
                    categoryId: selectedCategoryId || undefined,
                    priority,
                });
                dialog.destroy();
            } catch (error) {
                console.error('导入失败:', error);
            }
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });
    }

    // ICS订阅管理对话框
    async function showSubscriptionManagementDialog() {
        const {
            loadSubscriptions,
            saveSubscriptions,
            syncSubscription,
            removeSubscription,
            updateSubscriptionTaskMetadata,
        } = await import('./utils/icsSubscription');
        const { ProjectManager } = await import('./utils/projectManager');
        const projectManager = ProjectManager.getInstance(plugin);
        await projectManager.loadProjects();
        const groupedProjects = projectManager.getProjectsGroupedByStatus();

        const { CategoryManager } = await import('./utils/categoryManager');
        const categoryManager = CategoryManager.getInstance(plugin);
        await categoryManager.initialize();
        const categories = categoryManager.getCategories();

        const data = await loadSubscriptions(plugin);
        const subscriptions = Object.values(data.subscriptions);

        const dialog = new Dialog({
            title: t('manageSubscriptions'),
            content: `
                <div class="b3-dialog__content" style="padding: 16px;">
                    <div class="fn__flex-column" style="gap: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0;">${t('icsSubscription')}</h3>
                            <button class="b3-button b3-button--outline" id="add-subscription">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                ${t('addSubscription')}
                            </button>
                        </div>
                        <div id="subscription-list" style="max-height: 400px; overflow-y: auto;">
                            ${subscriptions.length === 0 ? `<div style="text-align: center; padding: 32px; color: var(--b3-theme-on-surface-light);">${t('noSubscriptions')}</div>` : ''}
                        </div>
                    </div>
                </div>
            `,
            width: '800px',
        });

        const listContainer = dialog.element.querySelector('#subscription-list');
        const addBtn = dialog.element.querySelector('#add-subscription');

        // 渲染订阅列表
        function renderSubscriptions() {
            if (subscriptions.length === 0) {
                listContainer.innerHTML = `<div style="text-align: center; padding: 32px; color: var(--b3-theme-on-surface-light);">${t('noSubscriptions')}</div>`;
                return;
            }

            listContainer.innerHTML = subscriptions
                .map(
                    sub => `
                <div class="b3-card" style="padding: 12px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div style="font-weight: 500; margin-bottom: 4px;">${sub.name}</div>
                            <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;">${sub.url}</div>
                            <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                                ${t('subscriptionSyncInterval')}: ${t(sub.syncInterval === '15min' ? 'every15Minutes' : sub.syncInterval === '30min' ? 'every30Minutes' : sub.syncInterval === 'hourly' ? 'everyHour' : sub.syncInterval === '4hour' ? 'every4Hours' : sub.syncInterval === '12hour' ? 'every12Hours' : 'everyDay')}
                                ${sub.lastSync ? ` | ${t('subscriptionLastSync')}: ${new Date(sub.lastSync).toLocaleString()}` : ''}
                            </div>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button class="b3-button b3-button--outline" data-action="toggle" data-id="${sub.id}" title="${sub.enabled ? '停用' : '启用'}">
                                <svg class="b3-button__icon ${!sub.enabled ? 'fn__opacity' : ''}"><use xlink:href="${sub.enabled ? '#iconEye' : '#iconEyeoff'}"></use></svg>
                            </button>
                            <button class="b3-button b3-button--outline" data-action="sync" data-id="${sub.id}" title="${t('syncNow')}">
                                <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            </button>
                            <button class="b3-button b3-button--outline" data-action="edit" data-id="${sub.id}" title="${t('editSubscription')}">
                                <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                            </button>
                            <button class="b3-button b3-button--outline" data-action="delete" data-id="${sub.id}" title="${t('deleteSubscription')}">
                                <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `
                )
                .join('');

            // 添加事件监听
            listContainer.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', async e => {
                    const target = e.currentTarget as HTMLElement;
                    const action = target.dataset.action;
                    const id = target.dataset.id;
                    const sub = subscriptions.find(s => s.id === id);

                    if (action === 'toggle' && sub) {
                        sub.enabled = !sub.enabled;
                        data.subscriptions[sub.id] = sub;
                        await saveSubscriptions(plugin, data);
                        renderSubscriptions();
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    } else if (action === 'sync' && sub) {
                        btn.innerHTML =
                            '<svg class="b3-button__icon fn__rotate"><use xlink:href="#iconRefresh"></use></svg>';
                        await syncSubscription(plugin, sub);
                        renderSubscriptions();
                    } else if (action === 'edit' && sub) {
                        showEditSubscriptionDialog(sub);
                    } else if (action === 'delete' && sub) {
                        if (confirm(t('confirmDeleteSubscription').replace('${name}', sub.name))) {
                            await removeSubscription(plugin, sub.id);
                            delete data.subscriptions[sub.id];
                            await saveSubscriptions(plugin, data);
                            subscriptions.splice(
                                subscriptions.findIndex(s => s.id === id),
                                1
                            );
                            renderSubscriptions();
                        }
                    }
                });
            });
        }

        // 编辑/新建订阅对话框
        function showEditSubscriptionDialog(subscription?: any) {
            const isEdit = !!subscription;
            const editDialog = new Dialog({
                title: isEdit ? t('editSubscription') : t('addSubscription'),
                content: `
                    <div class="b3-dialog__content" style="padding: 16px;">
                        <div class="fn__flex-column" style="gap: 12px;">
                            <div class="b3-label">
                                <div class="b3-label__text">${t('subscriptionName')}</div>
                                <input class="b3-text-field fn__block" id="sub-name" value="${subscription?.name || ''}" placeholder="${t('pleaseEnterSubscriptionName')}">
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${t('subscriptionUrl')}</div>
                                <input class="b3-text-field fn__block" id="sub-url" value="${subscription?.url || ''}" placeholder="${t('subscriptionUrlPlaceholder')}">
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${t('subscriptionSyncInterval')}</div>
                                <select class="b3-select fn__block" id="sub-interval">
                                    <option value="15min" ${subscription?.syncInterval === '15min' ? 'selected' : ''}>${t('every15Minutes')}</option>
                                    <option value="30min" ${subscription?.syncInterval === '30min' ? 'selected' : ''}>${t('every30Minutes')}</option>
                                    <option value="hourly" ${subscription?.syncInterval === 'hourly' ? 'selected' : ''}>${t('everyHour')}</option>
                                    <option value="4hour" ${subscription?.syncInterval === '4hour' ? 'selected' : ''}>${t('every4Hours')}</option>
                                    <option value="12hour" ${subscription?.syncInterval === '12hour' ? 'selected' : ''}>${t('every12Hours')}</option>
                                    <option value="daily" ${subscription?.syncInterval === 'daily' ? 'selected' : ''}>${t('everyDay')}</option>
                                </select>
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${t('subscriptionProject')} *</div>
                                <div class="fn__hr"></div>
                                <div style="display: flex; gap: 8px;">
                                    <select class="b3-select fn__flex-1" id="sub-project" required>
                                        <option value="">${t('pleaseSelectProject')}</option>
                                        ${Object.entries(groupedProjects)
                                            .map(([statusId, statusProjects]) => {
                                                if (statusProjects.length === 0) return '';
                                                const status = projectManager
                                                    .getStatusManager()
                                                    .getStatusById(statusId);
                                                const label = status
                                                    ? `${status.icon || ''} ${status.name}`
                                                    : statusId;
                                                return `
                                            <optgroup label="${label}">
                                                ${statusProjects
                                                    .map(
                                                        p => `
                                                    <option value="${p.id}" ${subscription?.projectId === p.id ? 'selected' : ''}>${p.name}</option>
                                                `
                                                    )
                                                    .join('')}
                                            </optgroup>
                                        `;
                                            })
                                            .join('')}
                                    </select>
                                    <button class="b3-button b3-button--outline" id="sub-create-project" title="新建项目">
                                        <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                    </button>
                                </div>
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${t('subscriptionPriority')}</div>
                                <select class="b3-select fn__block" id="sub-priority">
                                    <option value="none" ${!subscription?.priority || subscription?.priority === 'none' ? 'selected' : ''}>${t('noPriority')}</option>
                                    <option value="high" ${subscription?.priority === 'high' ? 'selected' : ''}>${t('highPriority')}</option>
                                    <option value="medium" ${subscription?.priority === 'medium' ? 'selected' : ''}>${t('mediumPriority')}</option>
                                    <option value="low" ${subscription?.priority === 'low' ? 'selected' : ''}>${t('lowPriority')}</option>
                                </select>
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${t('subscriptionCategory')}</div>
                                <select class="b3-select fn__block" id="sub-category">
                                    <option value="" ${!subscription?.categoryId ? 'selected' : ''}>${t('noCategory') || '无分类'}</option>
                                    ${categories.map(c => `<option value="${c.id}" ${subscription?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                                </select>
                            </div>

                        </div>
                        <div class="b3-dialog__action" style="margin-top: 16px;">
                            <button class="b3-button b3-button--cancel">${t('cancel')}</button>
                            <button class="b3-button b3-button--text" id="confirm-sub">${t('save')}</button>
                        </div>
                    </div>
                `,
                width: '500px',
            });

            const createProjectBtn = editDialog.element.querySelector(
                '#sub-create-project'
            ) as HTMLButtonElement;
            const projectSelect = editDialog.element.querySelector(
                '#sub-project'
            ) as HTMLSelectElement;
            const confirmBtn = editDialog.element.querySelector('#confirm-sub');
            const cancelBtn = editDialog.element.querySelector('.b3-button--cancel');

            // 新建项目按钮逻辑
            createProjectBtn?.addEventListener('click', async () => {
                try {
                    const { ProjectDialog } = await import('./components/ProjectDialog');
                    const projectDialog = new ProjectDialog(undefined, plugin);
                    await projectDialog.show();

                    const handleProjectCreated = async (event: CustomEvent) => {
                        await projectManager.loadProjects();
                        const groupedProjects = projectManager.getProjectsGroupedByStatus();

                        projectSelect.innerHTML = `<option value="">${t('pleaseSelectProject')}</option>`;
                        Object.entries(groupedProjects).forEach(([statusId, statusProjects]) => {
                            if (statusProjects.length === 0) return;
                            const status = projectManager
                                .getStatusManager()
                                .getStatusById(statusId);
                            const optgroup = document.createElement('optgroup');
                            optgroup.label = status
                                ? `${status.icon || ''} ${status.name}`
                                : statusId;

                            statusProjects.forEach(p => {
                                const option = document.createElement('option');
                                option.value = p.id;
                                option.textContent = p.name;
                                optgroup.appendChild(option);
                            });
                            projectSelect.appendChild(optgroup);
                        });

                        if (event.detail && event.detail.projectId) {
                            projectSelect.value = event.detail.projectId;
                        }

                        window.removeEventListener(
                            'projectUpdated',
                            handleProjectCreated as EventListener
                        );
                    };

                    window.addEventListener(
                        'projectUpdated',
                        handleProjectCreated as EventListener
                    );
                } catch (error) {
                    console.error('创建项目失败:', error);
                }
            });

            confirmBtn?.addEventListener('click', async () => {
                const name = (
                    editDialog.element.querySelector('#sub-name') as HTMLInputElement
                ).value.trim();
                const url = (
                    editDialog.element.querySelector('#sub-url') as HTMLInputElement
                ).value.trim();
                const syncInterval = (
                    editDialog.element.querySelector('#sub-interval') as HTMLSelectElement
                ).value as any;
                const projectId = (
                    editDialog.element.querySelector('#sub-project') as HTMLSelectElement
                ).value;
                const priority = (
                    editDialog.element.querySelector('#sub-priority') as HTMLSelectElement
                ).value as any;
                const categoryId = (
                    editDialog.element.querySelector('#sub-category') as HTMLSelectElement
                ).value;
                const tagIds: string[] = [];

                if (!name) {
                    await pushErrMsg(t('pleaseEnterSubscriptionName'));
                    return;
                }
                if (!url) {
                    await pushErrMsg(t('pleaseEnterSubscriptionUrl'));
                    return;
                }
                if (!projectId) {
                    await pushErrMsg(t('pleaseSelectProject'));
                    return;
                }

                const subData = {
                    id: subscription?.id || window.Lute?.NewNodeID?.() || `sub-${Date.now()}`,
                    name,
                    url,
                    syncInterval,
                    projectId,
                    priority,
                    categoryId,
                    tagIds,
                    enabled: true,
                    createdAt: subscription?.createdAt || new Date().toISOString(),
                };

                data.subscriptions[subData.id] = subData;
                await saveSubscriptions(plugin, data);

                if (isEdit) {
                    const index = subscriptions.findIndex(s => s.id === subData.id);
                    subscriptions[index] = subData;
                    // 更新现有任务元数据
                    await updateSubscriptionTaskMetadata(subData);
                } else {
                    subscriptions.push(subData);
                }

                renderSubscriptions();
                editDialog.destroy();
                await pushMsg(isEdit ? t('subscriptionUpdated') : t('subscriptionCreated'));
            });

            cancelBtn?.addEventListener('click', () => {
                editDialog.destroy();
            });
        }

        addBtn?.addEventListener('click', () => {
            showEditSubscriptionDialog();
        });

        renderSubscriptions();
    }
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <li
                data-name="editor"
                class:b3-list-item--focus={group.name === focusGroup}
                class="b3-list-item"
                role="button"
                on:click={() => {
                    focusGroup = group.name;
                }}
                on:keydown={() => {}}
            >
                <span>{group.name}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        <SettingPanel
            group={currentGroup?.name || ''}
            settingItems={currentGroup?.items || []}
            display={true}
            on:changed={onChanged}
        />
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        display: flex;
        flex-direction: row;
        overflow: hidden;
    }
    .config__panel > .b3-tab-bar {
        width: 170px;
    }

    .config__tab-wrap {
        flex: 1;
        height: 100%;
        overflow: auto;
        padding: 2px;
    }
</style>
