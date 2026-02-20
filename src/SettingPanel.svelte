<script lang="ts">
    import { onMount } from 'svelte';
    import { Dialog } from 'siyuan';
    import Form from '@/libs/components/Form';
    import { i18n } from './pluginInstance';
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
    import type { AudioFileItem } from './index';
    import { lsNotebooks, pushErrMsg, pushMsg, removeFile, putFile } from './api';
    import { Constants } from 'siyuan';
    import { exportIcsFile, uploadIcsToCloud } from './utils/icsUtils';
    import { importIcsFile } from './utils/icsImport';
    import { syncHolidays } from './utils/icsSubscription';
    import { PomodoroManager } from './utils/pomodoroManager';
    import { resolveAudioPath } from './utils/audioUtils';

    export let plugin;

    // 使用从 index.ts 导入的默认设置
    let settings = { ...DEFAULT_SETTINGS };

    // 笔记本列表
    let notebooks: Array<{ id: string; name: string }> = [];

    // 音频文件管理（每个声音设置项各自独立维护文件列表）
    let isUploadingAudio = false;
    let isDownloadingAudio = false;
    let audioPreviewEl: HTMLAudioElement | null = null;
    let playingPath: string | null = null; // 当前播放中的音频路径
    let isAudioPlaying = false; // 当前是否处于播放状态

    const AUDIO_DIR = 'data/storage/petal/siyuan-plugin-task-note-management/audios';
    const AUDIO_URL_PREFIX = '/data/storage/petal/siyuan-plugin-task-note-management/audios/';

    /** 获取指定 key 的音频文件列表（合并内置声音并过滤已删除项） */
    function getAudioFilesForKey(key: string): { name: string; path: string }[] {
        const userList: AudioFileItem[] = (settings.audioFileLists ?? {})[key] ?? [];
        const defaultList: AudioFileItem[] = (DEFAULT_SETTINGS.audioFileLists ?? {})[key] ?? [];

        const result: AudioFileItem[] = [];
        const processedPath = new Set<string>();

        // 1. 遍历默认列表，保持顺序
        for (const defItem of defaultList) {
            const userEntry = userList.find(i => i.path === defItem.path);
            if (userEntry) {
                result.push(userEntry);
                processedPath.add(defItem.path);
                // 查找替换项（下载到本地的版本）
                const replacement = userList.find(i => i.replaces === defItem.path);
                if (replacement) {
                    result.push(replacement);
                    processedPath.add(replacement.path);
                }
            } else {
                result.push({ ...defItem });
            }
        }

        // 2. 追加完全自定义项
        for (const userItem of userList) {
            if (!processedPath.has(userItem.path)) {
                result.push(userItem);
            }
        }

        return result
            .filter(i => !i.removed)
            .map(item => ({
                name: item.path.split('/').pop()?.split('?')[0] ?? item.path,
                path: item.path,
            }));
    }

    async function uploadAudioFile(file: File) {
        const path = `${AUDIO_DIR}/${file.name}`;
        await putFile(path, false, file);
        await pushMsg(`音频 "${file.name}" 上传成功`);
        return AUDIO_URL_PREFIX + file.name;
    }

    async function deleteAudioFileForKey(url: string, key: string) {
        if (!settings.audioFileLists) settings.audioFileLists = {};
        const currentList: AudioFileItem[] = [...(settings.audioFileLists[key] ?? [])];

        // 查找是否已在列表中（含已删除的）
        const index = currentList.findIndex(i => i.path === url);
        if (index > -1) {
            currentList[index].removed = true;
        } else {
            // 如果不在用户列表（说明是默认项），加入并设为 removed
            currentList.push({ path: url, removed: true });
        }

        settings.audioFileLists[key] = currentList;
        await saveSettings();
        updateGroupItems();
    }

    async function downloadOnlineAudio(url: string, key: string) {
        if (isDownloadingAudio) return null;
        try {
            isDownloadingAudio = true;
            const fileName = url.split('/').pop()?.split('?')[0] || 'online_audio.mp3';
            const localPath = `${AUDIO_DIR}/${fileName}`;
            const localUrl = AUDIO_URL_PREFIX + fileName;

            await pushMsg('正在下载并保存音频到本地...');
            const response = await fetch(url);
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const file = new File([blob], fileName, { type: blob.type });

            await putFile(localPath, false, file);

            // 核心改进：引入 replaces 字段，并确保本地版紧跟在在线版之后以保持排序
            if (!settings.audioFileLists) settings.audioFileLists = {};
            const list: AudioFileItem[] = [...(settings.audioFileLists[key] || [])];

            const onlineIdx = list.findIndex(i => i.path === url);
            if (onlineIdx > -1) {
                list[onlineIdx].removed = true;
                // 在线版之后插入本地版，保持相对顺序
                const localItemIdx = list.findIndex(i => i.path === localUrl);
                if (localItemIdx > -1) {
                    list[localItemIdx].removed = false;
                    list[localItemIdx].replaces = url;
                } else {
                    list.splice(onlineIdx + 1, 0, {
                        path: localUrl,
                        removed: false,
                        replaces: url,
                    });
                }
            } else {
                // 如果是第一次操作此项，插入并标记替换
                list.push({ path: url, removed: true });
                list.push({ path: localUrl, removed: false, replaces: url });
            }
            settings.audioFileLists[key] = list;

            // 3. 更新单选状态（如果当前正选着这个在线版）
            if (settings.audioSelected && settings.audioSelected[key] === url) {
                settings.audioSelected[key] = localUrl;
            }

            await pushMsg('下载成功，音频已转存至本地存储');
            return localUrl;
        } catch (e) {
            console.error('下载音频失败:', e);
            await pushErrMsg('下载音频失败，请检查网络连接');
            return null;
        } finally {
            isDownloadingAudio = false;
        }
    }

    async function toggleSettingValue(key: string, value: any) {
        if (!settings.audioFileLists) settings.audioFileLists = {};
        if (!settings.audioFileLists[key]) settings.audioFileLists[key] = [];
        const list: AudioFileItem[] = settings.audioFileLists[key];

        // 检查是否是在线链接，如果是则点击时自动下载
        if (typeof value === 'string' && value.startsWith('http')) {
            const localUrl = await downloadOnlineAudio(value, key);
            if (!localUrl) return; // 下载失败则跳过后续操作

            if (!settings.audioSelected) settings.audioSelected = {};
            settings.audioSelected[key] = localUrl;

            saveSettings();
            updateGroupItems();
            return; // downloadOnlineAudio 已处理列表状态，此处直接返回
        }

        // 单选模式
        if (!settings.audioSelected) settings.audioSelected = {};
        if (settings.audioSelected[key] === value) {
            settings.audioSelected[key] = ''; // 取消选中
        } else {
            settings.audioSelected[key] = value; // 选中
        }
        saveSettings();
        updateGroupItems();
    }

    async function toggleAudio(path: string) {
        // 同一音频：切换暂停 / 继续
        if (audioPreviewEl && playingPath === path) {
            if (isAudioPlaying) {
                audioPreviewEl.pause();
                isAudioPlaying = false;
            } else {
                audioPreviewEl.play().catch(() => {});
                isAudioPlaying = true;
            }
            return;
        }
        // 不同音频：停止当前，播放新的
        if (audioPreviewEl) {
            audioPreviewEl.pause();
            audioPreviewEl = null;
        }

        const resolvedUrl = await resolveAudioPath(path);
        const audio = new Audio(resolvedUrl);
        audio.volume = 0.4;
        audio.play().catch(() => {});
        audio.addEventListener('ended', () => {
            isAudioPlaying = false;
            playingPath = null;
        });
        audioPreviewEl = audio;
        playingPath = path;
        isAudioPlaying = true;
    }

    function handleAudioUploadInput(event: Event, settingKey: string) {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        if (files.length === 0) return;
        isUploadingAudio = true;
        Promise.all(
            files.map(async f => {
                try {
                    return await uploadAudioFile(f);
                } catch (e) {
                    console.error('上传音频失败:', f.name, e);
                    await pushErrMsg(`上传音频失败: ${f.name}`);
                    return null;
                }
            })
        )
            .then(urls => {
                const validUrls = urls.filter(Boolean) as string[];
                if (!settings.audioFileLists) settings.audioFileLists = {};
                const list: AudioFileItem[] = settings.audioFileLists[settingKey] || [];
                for (const url of validUrls) {
                    if (!list.some(i => i.path === url)) {
                        list.push({ path: url, removed: false });
                    }
                }
                // 自动选中第一个上传的文件
                if (validUrls.length > 0) {
                    const firstUrl = validUrls[0];
                    if (!settings.audioSelected) settings.audioSelected = {};
                    settings.audioSelected[settingKey] = firstUrl;
                }
                settings.audioFileLists[settingKey] = list;
                saveSettings();
                updateGroupItems();
            })
            .catch(() => {})
            .finally(() => {
                isUploadingAudio = false;
            });
        input.value = '';
    }

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
            name: i18n('sidebarSettings'),
            items: [
                {
                    key: 'enableReminderDock',
                    value: settings.enableReminderDock,
                    type: 'checkbox',
                    title: i18n('enableReminderDock'),
                    description: i18n('enableReminderDockDesc'),
                },
                {
                    key: 'enableProjectDock',
                    value: settings.enableProjectDock,
                    type: 'checkbox',
                    title: i18n('enableProjectDock'),
                    description: i18n('enableProjectDockDesc'),
                },
                {
                    key: 'enableHabitDock',
                    value: settings.enableHabitDock,
                    type: 'checkbox',
                    title: i18n('enableHabitDock'),
                    description: i18n('enableHabitDockDesc'),
                },
                {
                    key: 'enableDockBadge',
                    value: settings.enableDockBadge,
                    type: 'checkbox',
                    title: i18n('enableDockBadge'),
                    description: i18n('enableDockBadgeDesc'),
                },
                {
                    key: 'enableReminderDockBadge',
                    value: settings.enableReminderDockBadge,
                    type: 'checkbox',
                    title: i18n('enableReminderDockBadge'),
                    description: i18n('enableReminderDockBadgeDesc'),
                },
                {
                    key: 'enableProjectDockBadge',
                    value: settings.enableProjectDockBadge,
                    type: 'checkbox',
                    title: i18n('enableProjectDockBadge'),
                    description: i18n('enableProjectDockBadgeDesc'),
                },
                {
                    key: 'enableHabitDockBadge',
                    value: settings.enableHabitDockBadge,
                    type: 'checkbox',
                    title: i18n('enableHabitDockBadge'),
                    description: i18n('enableHabitDockBadgeDesc'),
                },
            ],
        },
        {
            name: i18n('notificationReminder'),
            items: [
                {
                    key: 'notificationSound',
                    value: settings.audioSelected?.notificationSound || '',
                    type: 'custom-audio',
                    title: i18n('notificationSoundSetting'),
                    description: i18n('notificationSoundDesc'),
                },
                {
                    key: 'reminderSystemNotification',
                    value: settings.reminderSystemNotification,
                    type: 'checkbox',
                    title: i18n('reminderSystemNotification'),
                    description: i18n('reminderSystemNotificationDesc'),
                },
                {
                    key: 'dailyNotificationTime',
                    value: settings.dailyNotificationTime,
                    type: 'textinput',
                    placeholder: '09:00',
                    title: i18n('dailyNotificationTime'),
                    description: i18n('dailyNotificationTimeDesc'),
                },
                {
                    key: 'dailyNotificationEnabled',
                    value: settings.dailyNotificationEnabled,
                    type: 'checkbox',
                    title: i18n('dailyNotificationEnabled'),
                    description: i18n('dailyNotificationEnabledDesc'),
                },
            ],
        },
        {
            name: i18n('calendarSettings'),
            items: [
                {
                    key: 'weekStartDay',
                    // For select UI, use string values so they match option keys in the DOM
                    value: String(settings.weekStartDay),
                    type: 'select',
                    title: i18n('weekStartDay'),
                    description: i18n('weekStartDayDesc'),
                    options: {
                        0: i18n('sunday'),
                        1: i18n('monday'),
                        2: i18n('tuesday'),
                        3: i18n('wednesday'),
                        4: i18n('thursday'),
                        5: i18n('friday'),
                        6: i18n('saturday'),
                    },
                },
                {
                    key: 'calendarShowLunar',
                    value: settings.calendarShowLunar, // Default true
                    type: 'checkbox',
                    title: i18n('calendarShowLunar') || '显示农历',
                    description: i18n('calendarShowLunarDesc') || '在日历视图中显示农历日期和节日',
                },
                {
                    key: 'calendarShowHoliday',
                    value: settings.calendarShowHoliday,
                    type: 'checkbox',
                    title: i18n('calendarShowHoliday') || '显示节假日',
                    description:
                        i18n('calendarShowHolidayDesc') || '在日历视图中显示法定节假日（休）',
                },

                {
                    key: 'calendarHolidayIcsUrl',
                    value: settings.calendarHolidayIcsUrl,
                    type: 'textinput',
                    title: i18n('calendarHolidayIcsUrl') || '节假日 ICS URL',
                    description: i18n('calendarHolidayIcsUrlDesc') || '设置节假日订阅的 ICS 链接',
                },
                {
                    key: 'updateHoliday',
                    value: '',
                    type: 'button',
                    title: i18n('updateHoliday') || '更新节假日',
                    description: i18n('updateHolidayDesc') || '点击立即更新节假日数据',
                    button: {
                        label: i18n('updateHoliday') || '更新节假日',
                        callback: async () => {
                            await pushMsg(i18n('updatingHoliday') || '正在更新节假日...');
                            const success = await syncHolidays(
                                plugin,
                                settings.calendarHolidayIcsUrl
                            );
                            if (success) {
                                await pushMsg(i18n('holidayUpdateSuccess') || '节假日更新成功');
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            } else {
                                await pushErrMsg(i18n('holidayUpdateFailed') || '节假日更新失败');
                            }
                        },
                    },
                },
                {
                    key: 'calendarShowCategoryAndProject',
                    value: settings.calendarShowCategoryAndProject,
                    type: 'checkbox',
                    title: i18n('calendarShowCategoryAndProject'),
                    description: i18n('calendarShowCategoryAndProjectDesc'),
                },
                {
                    key: 'dayStartTime',
                    value: settings.dayStartTime,
                    type: 'textinput',
                    title: i18n('dayStartTime'),
                    description: i18n('dayStartTimeDesc'),
                    placeholder: '08:00',
                },
                {
                    key: 'todayStartTime',
                    value: settings.todayStartTime,
                    type: 'textinput',
                    title: i18n('todayStart'),
                    description: i18n('todayStartDesc'),
                    placeholder: '03:00',
                },
                {
                    key: 'showPomodoroInSummary',
                    value: settings.showPomodoroInSummary,
                    type: 'checkbox',
                    title: i18n('showPomodoroInSummary') || '在摘要中显示番茄钟统计',
                    description:
                        i18n('showPomodoroInSummaryDesc') ||
                        '开启后，任务摘要将包含番茄钟专注时长统计',
                },
                {
                    key: 'showHabitInSummary',
                    value: settings.showHabitInSummary,
                    type: 'checkbox',
                    title: i18n('showHabitInSummary') || '在摘要中显示习惯打卡统计',
                    description:
                        i18n('showHabitInSummaryDesc') || '开启后，任务摘要将包含习惯打卡情况统计',
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
                    title: i18n('autoDetectDateTime'),
                    description: i18n('autoDetectDateTimeDesc'),
                },
                {
                    key: 'removeDateAfterDetection',
                    value: settings.removeDateAfterDetection,
                    type: 'checkbox',
                    title: i18n('removeDateAfterDetection'),
                    description: i18n('removeDateAfterDetectionDesc'),
                },
                {
                    key: 'newDocNotebook',
                    value: settings.newDocNotebook,
                    type: 'select',
                    title: i18n('newDocNotebook'),
                    description: i18n('newDocNotebookDesc'),
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
                    title: i18n('newDocPath'),
                    description: i18n('newDocPathDesc'),
                },
                {
                    key: 'groupDefaultHeadingLevel',
                    value: settings.groupDefaultHeadingLevel,
                    type: 'select',
                    title: i18n('groupDefaultHeadingLevel') || '绑定块新建标题默认层级（项目分组）',
                    description:
                        i18n('groupDefaultHeadingLevelDesc') || '设置添加分组绑定块的默认层级',
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
                    key: 'milestoneDefaultHeadingLevel',
                    value: settings.milestoneDefaultHeadingLevel,
                    type: 'select',
                    title:
                        i18n('milestoneDefaultHeadingLevel') ||
                        '绑定块新建标题默认层级（项目里程碑）',
                    description:
                        i18n('milestoneDefaultHeadingLevelDesc') || '设置添加标题里程碑的默认层级',
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
                    key: 'defaultHeadingLevel',
                    value: settings.defaultHeadingLevel,
                    type: 'select',
                    title: i18n('defaultHeadingLevel'),
                    description: i18n('defaultHeadingLevelDesc'),
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
                    title: i18n('defaultHeadingPosition'),
                    description: i18n('defaultHeadingPositionDesc'),
                    options: {
                        prepend: i18n('prepend'),
                        append: i18n('append'),
                    },
                },
                {
                    key: 'enableOutlinePrefix',
                    value: settings.enableOutlinePrefix,
                    type: 'checkbox',
                    title: i18n('enableOutlinePrefix'),
                    description: i18n('enableOutlinePrefixDesc'),
                },
            ],
        },
        {
            name: i18n('pomodoroSettings'),
            items: [
                {
                    key: 'pomodoroHint',
                    value: '',
                    type: 'hint',
                    title: i18n('pomodoroHintTitle'),
                    description: i18n('pomodoroHintDesc'),
                },
                {
                    key: 'pomodoroWorkDuration',
                    value: settings.pomodoroWorkDuration,
                    type: 'number',
                    title: i18n('pomodoroWorkDuration'),
                    description: i18n('pomodoroWorkDurationDesc'),
                },
                {
                    key: 'pomodoroBreakDuration',
                    value: settings.pomodoroBreakDuration,
                    type: 'number',
                    title: i18n('pomodoroBreakDuration'),
                    description: i18n('pomodoroBreakDurationDesc'),
                },
                {
                    key: 'pomodoroLongBreakDuration',
                    value: settings.pomodoroLongBreakDuration,
                    type: 'number',
                    title: i18n('pomodoroLongBreakDuration'),
                    description: i18n('pomodoroLongBreakDurationDesc'),
                },
                {
                    key: 'pomodoroLongBreakInterval',
                    value: settings.pomodoroLongBreakInterval,
                    type: 'number',
                    title: i18n('pomodoroLongBreakInterval'),
                    description: i18n('pomodoroLongBreakIntervalDesc'),
                },
                {
                    key: 'pomodoroAutoMode',
                    value: settings.pomodoroAutoMode,
                    type: 'checkbox',
                    title: i18n('pomodoroAutoMode'),
                    description: i18n('pomodoroAutoModeDesc'),
                },
                {
                    key: 'pomodoroSystemNotification',
                    value: settings.pomodoroSystemNotification,
                    type: 'checkbox',
                    title: i18n('pomodoroSystemNotification'),
                    description: i18n('pomodoroSystemNotificationDesc'),
                },
                {
                    key: 'pomodoroEndPopupWindow',
                    value: settings.pomodoroEndPopupWindow,
                    type: 'checkbox',
                    title: i18n('pomodoroEndPopupWindow') || '番茄钟结束全局弹窗提醒',
                    description:
                        i18n('pomodoroEndPopupWindowDesc') ||
                        '番茄钟工作结束时会在屏幕中央显示弹窗提醒，10秒后自动关闭（仅电脑桌面端有效）',
                },
                {
                    key: 'pomodoroDockPosition',
                    value: settings.pomodoroDockPosition,
                    type: 'select',
                    title: i18n('pomodoroDockPosition') || '番茄钟吸附位置',
                    description:
                        i18n('pomodoroDockPositionDesc') || '设置番茄钟窗口吸附在屏幕的位置',
                    options: {
                        right: i18n('right') || '右侧',
                        left: i18n('left') || '左侧',
                        top: i18n('top') || '顶部',
                    },
                },
                {
                    key: 'dailyFocusGoal',
                    value: settings.dailyFocusGoal,
                    type: 'number',
                    title: i18n('dailyFocusGoal'),
                    description: i18n('dailyFocusGoalDesc'),
                },
                {
                    key: 'backgroundVolume',
                    value: settings.backgroundVolume,
                    type: 'slider',
                    title: i18n('backgroundVolume'),
                    description: i18n('backgroundVolumeDesc'),
                    slider: {
                        min: 0,
                        max: 1,
                        step: 0.1,
                    },
                },
                {
                    key: 'pomodoroWorkSound',
                    value: settings.audioSelected?.pomodoroWorkSound || '',
                    type: 'custom-audio',
                    title: i18n('pomodoroWorkSound'),
                    description: i18n('pomodoroWorkSoundDesc') || '',
                },
                {
                    key: 'pomodoroBreakSound',
                    value: settings.audioSelected?.pomodoroBreakSound || '',
                    type: 'custom-audio',
                    title: i18n('pomodoroBreakSound'),
                    description: i18n('pomodoroBreakSoundDesc') || '',
                },
                {
                    key: 'pomodoroLongBreakSound',
                    value: settings.audioSelected?.pomodoroLongBreakSound || '',
                    type: 'custom-audio',
                    title: i18n('pomodoroLongBreakSound'),
                    description: i18n('pomodoroLongBreakSoundDesc') || '',
                },
                {
                    key: 'pomodoroWorkEndSound',
                    value: settings.audioSelected?.pomodoroWorkEndSound || '',
                    type: 'custom-audio',
                    title: i18n('pomodoroWorkEndSound'),
                    description: i18n('pomodoroWorkEndSoundDesc') || '',
                },
                {
                    key: 'pomodoroBreakEndSound',
                    value: settings.audioSelected?.pomodoroBreakEndSound || '',
                    type: 'custom-audio',
                    title: i18n('pomodoroBreakEndSound'),
                    description: i18n('pomodoroBreakEndSoundDesc') || '',
                },
            ],
        },
        {
            name: i18n('randomNotificationSettings'),
            items: [
                {
                    key: 'randomNotificationEnabled',
                    value: settings.randomNotificationEnabled,
                    type: 'checkbox',
                    title: i18n('randomNotificationEnabled'),
                    description: i18n('randomNotificationEnabledDesc'),
                },
                {
                    key: 'randomNotificationSystemNotification',
                    value: settings.randomNotificationSystemNotification,
                    type: 'checkbox',
                    title: i18n('randomNotificationSystemNotification'),
                    description: i18n('randomNotificationSystemNotificationDesc'),
                },
                {
                    key: 'randomNotificationPopupWindow',
                    value: settings.randomNotificationPopupWindow,
                    type: 'checkbox',
                    title: '随机微休息全局弹窗提醒',
                    description:
                        '随机微休息开始时会在屏幕中央显示弹窗提醒，结束后自动关闭（仅电脑桌面端有效）',
                },
                {
                    key: 'randomNotificationMinInterval',
                    value: settings.randomNotificationMinInterval,
                    type: 'number',
                    title: i18n('randomNotificationMinInterval'),
                    description: i18n('randomNotificationMinIntervalDesc'),
                },
                {
                    key: 'randomNotificationMaxInterval',
                    value: settings.randomNotificationMaxInterval,
                    type: 'number',
                    title: i18n('randomNotificationMaxInterval'),
                    description: i18n('randomNotificationMaxIntervalDesc'),
                },
                {
                    key: 'randomNotificationBreakDuration',
                    value: settings.randomNotificationBreakDuration,
                    type: 'number',
                    title: i18n('randomNotificationBreakDuration'),
                    description: i18n('randomNotificationBreakDurationDesc'),
                },
                {
                    key: 'randomNotificationSounds',
                    value: settings.audioFileLists?.randomNotificationSounds || [],
                    type: 'custom-audio',
                    title: i18n('randomNotificationSounds'),
                    description: i18n('randomNotificationSoundsDesc') || '',
                },
                {
                    key: 'randomNotificationEndSound',
                    value: settings.audioSelected?.randomNotificationEndSound || '',
                    type: 'custom-audio',
                    title: i18n('randomNotificationEndSound'),
                    description: i18n('randomNotificationEndSoundDesc') || '',
                },
            ],
        },

        {
            name: '📁' + i18n('dataStorageLocation'),
            items: [
                {
                    key: 'dataStorageInfo',
                    value: 'data/storage/petal/siyuan-plugin-task-note-management',
                    type: 'hint',
                    title: i18n('dataStorageLocationTitle'),
                    description: i18n('dataStorageLocationDesc'),
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
                        '将提醒导出为标准 ICS 日历文件，可导入到 Outlook、Google Calendar、部分手机系统日历等日历应用',
                    button: {
                        label: '生成 ICS',
                        callback: async () => {
                            await exportIcsFile(plugin, true, false, settings.icsTaskFilter as any);
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
            name: '📅' + i18n('icsSubscription'),
            items: [
                {
                    key: 'icsSubscriptionHint',
                    value: '',
                    type: 'hint',
                    title: i18n('icsSubscription'),
                    description: i18n('icsSubscriptionDesc'),
                },
                {
                    key: 'manageSubscriptions',
                    value: '',
                    type: 'button',
                    title: i18n('manageSubscriptions'),
                    description: '管理ICS日历订阅，支持设置项目、分类、优先级和同步频率',
                    button: {
                        label: i18n('manageSubscriptions'),
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
                    key: 'icsTaskFilter',
                    value: settings.icsTaskFilter || 'all',
                    type: 'select',
                    title: '任务状态筛选',
                    description: '选择导出哪些任务到 ICS 文件',
                    options: {
                        all: '全部任务',
                        completed: '已完成任务',
                        uncompleted: '未完成任务',
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
                        manual: '手动',
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

                            <p style="margin-top:12px;">Non-Chinese users can use Wise to donate to me</p>
                            <img src="plugins/siyuan-plugin-task-note-management/assets/Alipay.jpg"alt="donate" style="max-width:260px; height:auto; border:1px solid var(--b3-border-color);"/>
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
        const { key, value } = detail;
        console.log(`Setting change: ${key} = ${value}`);

        // 统一处理特殊类型的转换
        let newValue = value;
        if (key === 'weekStartDay' && typeof value === 'string') {
            const parsed = parseInt(value, 10);
            newValue = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
        } else if (
            (key === 's3ForcePathStyle' || key === 's3TlsVerify') &&
            typeof value === 'string'
        ) {
            newValue = value === 'true';
        } else if (key === 'dailyNotificationTime' || key === 'todayStartTime') {
            // 格式化时间 HH:MM
            if (typeof value === 'number') {
                const h = Math.max(0, Math.min(23, Math.floor(value)));
                newValue = (h < 10 ? '0' : '') + h.toString() + ':00';
            } else if (typeof value === 'string') {
                const m = value.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
                if (m) {
                    const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                    const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                    newValue =
                        (h < 10 ? '0' : '') +
                        h.toString() +
                        ':' +
                        (min < 10 ? '0' : '') +
                        min.toString();
                } else {
                    newValue = DEFAULT_SETTINGS[key];
                }
            }
        }

        // 更新设置并保存
        const oldValue = settings[key];
        settings[key] = newValue;
        settings = settings; // 触发布尔响应式（如果需要）

        // 特殊逻辑：一天起始时间变更
        if (key === 'todayStartTime' && oldValue !== newValue) {
            (async () => {
                try {
                    const { setDayStartTime } = await import('./utils/dateUtils');
                    setDayStartTime(newValue as string);
                    const { PomodoroRecordManager } = await import('./utils/pomodoroRecord');
                    const recordManager = PomodoroRecordManager.getInstance(plugin);
                    await recordManager.regenerateRecordsByDate();
                } catch (error) {
                    console.error('重新生成番茄钟记录失败:', error);
                }
            })();
        }

        // 特殊逻辑：番茄钟设置变更
        if (
            key.startsWith('pomodoro') ||
            key === 'backgroundVolume' ||
            key === 'dailyFocusGoal' ||
            key.startsWith('randomNotification')
        ) {
            (async () => {
                try {
                    // Must transform raw settings into simplified structure first
                    const pomodoroSettings = await plugin.getPomodoroSettings(settings);
                    PomodoroManager.getInstance().updateSettings(pomodoroSettings);
                } catch (error) {
                    console.error('更新番茄钟设置失败:', error);
                }
            })();
        }

        saveSettings();
        updateGroupItems();
    };

    async function saveSettings(emitEvent = true) {
        await (plugin as any).saveSettings(settings);
        // 更新插件实例的设置缓存
        if (plugin) {
            plugin.settings = { ...settings };
        }
        if (!emitEvent) return;
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
            // 展开时如果 settings.audioFileLists 未存在（旧数据兼容），创建空对象
            if (!settings.audioFileLists) {
                settings.audioFileLists = {};
            }
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
            if (audioPreviewEl) {
                audioPreviewEl.pause();
                audioPreviewEl = null;
            }
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
        // 确保 audioFileLists 存在
        if (!settings.audioFileLists) settings.audioFileLists = {};
        updateGroupItems();
        // 确保设置已保存（可能包含新的默认值），但不发出更新事件
        await saveSettings(false);
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
            title: i18n('manageSubscriptions'),
            content: `
                <div class="b3-dialog__content" style="padding: 16px;">
                    <div class="fn__flex-column" style="gap: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0;">${i18n('icsSubscription')}</h3>
                            <button class="b3-button b3-button--outline" id="add-subscription">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                ${i18n('addSubscription')}
                            </button>
                        </div>
                        <div id="subscription-list" style="max-height: 400px; overflow-y: auto;">
                            ${subscriptions.length === 0 ? `<div style="text-align: center; padding: 32px; color: var(--b3-theme-on-surface-light);">${i18n('noSubscriptions')}</div>` : ''}
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
                listContainer.innerHTML = `<div style="text-align: center; padding: 32px; color: var(--b3-theme-on-surface-light);">${i18n('noSubscriptions')}</div>`;
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
                                ${i18n('subscriptionSyncInterval')}: ${i18n(sub.syncInterval === '15min' ? 'every15Minutes' : sub.syncInterval === '30min' ? 'every30Minutes' : sub.syncInterval === 'hourly' ? 'everyHour' : sub.syncInterval === '4hour' ? 'every4Hours' : sub.syncInterval === '12hour' ? 'every12Hours' : 'everyDay')}
                                ${sub.lastSync ? ` | ${i18n('subscriptionLastSync')}: ${new Date(sub.lastSync).toLocaleString()}` : ''}
                            </div>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button class="b3-button b3-button--outline" data-action="toggle" data-id="${sub.id}" title="${sub.enabled ? '停用' : '启用'}">
                                <svg class="b3-button__icon ${!sub.enabled ? 'fn__opacity' : ''}"><use xlink:href="${sub.enabled ? '#iconEye' : '#iconEyeoff'}"></use></svg>
                            </button>
                            <button class="b3-button b3-button--outline" data-action="sync" data-id="${sub.id}" title="${i18n('syncNow')}">
                                <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            </button>
                            <button class="b3-button b3-button--outline" data-action="edit" data-id="${sub.id}" title="${i18n('editSubscription')}">
                                <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                            </button>
                            <button class="b3-button b3-button--outline" data-action="delete" data-id="${sub.id}" title="${i18n('deleteSubscription')}">
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
                        if (
                            confirm(i18n('confirmDeleteSubscription').replace('${name}', sub.name))
                        ) {
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
                title: isEdit ? i18n('editSubscription') : i18n('addSubscription'),
                content: `
                    <div class="b3-dialog__content" style="padding: 16px;">
                        <div class="fn__flex-column" style="gap: 12px;">
                            <div class="b3-label">
                                <div class="b3-label__text">${i18n('subscriptionName')}</div>
                                <input class="b3-text-field fn__block" id="sub-name" value="${subscription?.name || ''}" placeholder="${i18n('pleaseEnterSubscriptionName')}">
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${i18n('subscriptionUrl')}</div>
                                <input class="b3-text-field fn__block" id="sub-url" value="${subscription?.url || ''}" placeholder="${i18n('subscriptionUrlPlaceholder')}">
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${i18n('subscriptionSyncInterval')}</div>
                                <select class="b3-select fn__block" id="sub-interval">
                                    <option value="manual" ${subscription?.syncInterval === 'manual' ? 'selected' : ''}>${i18n('manual')}</option>
                                    <option value="15min" ${subscription?.syncInterval === '15min' ? 'selected' : ''}>${i18n('every15Minutes')}</option>
                                    <option value="30min" ${subscription?.syncInterval === '30min' ? 'selected' : ''}>${i18n('every30Minutes')}</option>
                                    <option value="hourly" ${subscription?.syncInterval === 'hourly' ? 'selected' : ''}>${i18n('everyHour')}</option>
                                    <option value="4hour" ${subscription?.syncInterval === '4hour' ? 'selected' : ''}>${i18n('every4Hours')}</option>
                                    <option value="12hour" ${subscription?.syncInterval === '12hour' ? 'selected' : ''}>${i18n('every12Hours')}</option>
                                    <option value="daily" ${subscription?.syncInterval === 'daily' ? 'selected' : ''}>${i18n('everyDay')}</option>
                                </select>
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${i18n('subscriptionProject')} *</div>
                                <div class="fn__hr"></div>
                                <div style="display: flex; gap: 8px;">
                                    <select class="b3-select fn__flex-1" id="sub-project" required>
                                        <option value="">${i18n('pleaseSelectProject')}</option>
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
                                <div class="b3-label__text">${i18n('subscriptionPriority')}</div>
                                <select class="b3-select fn__block" id="sub-priority">
                                    <option value="none" ${!subscription?.priority || subscription?.priority === 'none' ? 'selected' : ''}>${i18n('noPriority')}</option>
                                    <option value="high" ${subscription?.priority === 'high' ? 'selected' : ''}>${i18n('highPriority')}</option>
                                    <option value="medium" ${subscription?.priority === 'medium' ? 'selected' : ''}>${i18n('mediumPriority')}</option>
                                    <option value="low" ${subscription?.priority === 'low' ? 'selected' : ''}>${i18n('lowPriority')}</option>
                                </select>
                            </div>
                            <div class="b3-label">
                                <div class="b3-label__text">${i18n('subscriptionCategory')}</div>
                                <select class="b3-select fn__block" id="sub-category">
                                    <option value="" ${!subscription?.categoryId ? 'selected' : ''}>${i18n('noCategory') || '无分类'}</option>
                                    ${categories.map(c => `<option value="${c.id}" ${subscription?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                                </select>
                            </div>

                        </div>
                        <div class="b3-dialog__action" style="margin-top: 16px;">
                            <button class="b3-button b3-button--cancel">${i18n('cancel')}</button>
                            <button class="b3-button b3-button--text" id="confirm-sub">${i18n('save')}</button>
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

                        projectSelect.innerHTML = `<option value="">${i18n('pleaseSelectProject')}</option>`;
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
                    await pushErrMsg(i18n('pleaseEnterSubscriptionName'));
                    return;
                }
                if (!url) {
                    await pushErrMsg(i18n('pleaseEnterSubscriptionUrl'));
                    return;
                }
                if (!projectId) {
                    await pushErrMsg(i18n('pleaseSelectProject'));
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
                    await updateSubscriptionTaskMetadata(plugin, subData);
                } else {
                    subscriptions.push(subData);
                }

                renderSubscriptions();
                editDialog.destroy();
                await pushMsg(isEdit ? i18n('subscriptionUpdated') : i18n('subscriptionCreated'));
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
        <!-- 手动按项目顺序渲染，保证 custom-audio 项在正确位置 -->
        <div class="config__tab-container" data-name={currentGroup?.name || ''}>
            {#each currentGroup?.items || [] as item (item.key)}
                {#if !item.hidden}
                    {#if item.type === 'custom-audio'}
                        <!-- 自定义音频选择器 -->
                        <div class="item-wrap b3-label config__item audio-picker-wrap">
                            <!-- 顶部：标题 + 上传按钮 -->
                            <div class="fn__flex-1">
                                <span class="title">{item.title}</span>
                                {#if item.description}
                                    <div class="b3-label__text">{item.description}</div>
                                {/if}
                            </div>
                            <!-- 当前选中的音频显示 + 文件列表 -->
                            <div class="audio-inline-list" style="width:100%;margin-top:4px">
                                {#each [getAudioFilesForKey(item.key)] as audioFilesForKey}
                                    <!-- 文件列表 -->
                                    {#if audioFilesForKey.length > 0}
                                        {#each audioFilesForKey.filter(a => a.path) as audio}
                                            {@const isSelected =
                                                settings.audioSelected?.[item.key] === audio.path}
                                            <div
                                                class="audio-row {isSelected
                                                    ? 'audio-row--selected'
                                                    : ''}"
                                                role="button"
                                                tabindex="0"
                                                on:click={() =>
                                                    toggleSettingValue(item.key, audio.path)}
                                                on:keydown={e => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        toggleSettingValue(item.key, audio.path);
                                                    }
                                                }}
                                            >
                                                <div class="audio-row__name" title={audio.name}>
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        width="12"
                                                        height="12"
                                                        style="flex-shrink:0;opacity:0.5"
                                                    >
                                                        <path d="M9 18V5l12-2v13" />
                                                        <circle cx="6" cy="18" r="3" />
                                                        <circle cx="18" cy="16" r="3" />
                                                    </svg>
                                                    <span>{audio.name}</span>
                                                    {#if isSelected}
                                                        <span class="audio-row__badge">当前</span>
                                                    {/if}
                                                </div>
                                                <div class="audio-row__btns">
                                                    <button
                                                        class="audio-btn audio-btn--play"
                                                        title={playingPath === audio.path &&
                                                        isAudioPlaying
                                                            ? '暂停'
                                                            : '试听'}
                                                        on:click|stopPropagation={() =>
                                                            toggleAudio(audio.path)}
                                                    >
                                                        {#if playingPath === audio.path && isAudioPlaying}
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                fill="currentColor"
                                                                stroke="none"
                                                                width="11"
                                                                height="11"
                                                            >
                                                                <rect
                                                                    x="5"
                                                                    y="3"
                                                                    width="4"
                                                                    height="18"
                                                                    rx="1"
                                                                />
                                                                <rect
                                                                    x="15"
                                                                    y="3"
                                                                    width="4"
                                                                    height="18"
                                                                    rx="1"
                                                                />
                                                            </svg>
                                                        {:else}
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                fill="currentColor"
                                                                stroke="none"
                                                                width="11"
                                                                height="11"
                                                            >
                                                                <polygon
                                                                    points="5 3 19 12 5 21 5 3"
                                                                />
                                                            </svg>
                                                        {/if}
                                                    </button>
                                                    <!-- 从列表移除 -->
                                                    <button
                                                        class="audio-btn audio-btn--delete"
                                                        title="从列表移除"
                                                        on:click|stopPropagation={() =>
                                                            deleteAudioFileForKey(
                                                                audio.path,
                                                                item.key
                                                            )}
                                                    >
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="2"
                                                            width="11"
                                                            height="11"
                                                        >
                                                            <polyline points="3 6 5 6 21 6" />
                                                            <path
                                                                d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                                                            />
                                                            <path d="M10 11v6M14 11v6" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        {/each}
                                    {/if}
                                    <!-- 上传按钮（始终在列表底部） -->
                                    <label
                                        class="audio-upload-btn audio-upload-btn--bottom {isUploadingAudio
                                            ? 'audio-upload-btn--loading'
                                            : ''}"
                                        title="上传音频文件"
                                    >
                                        {#if isUploadingAudio}
                                            <svg
                                                class="fn__rotate"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                width="12"
                                                height="12"
                                            >
                                                <path d="M21 12a9 9 0 11-6.219-8.56" />
                                            </svg>
                                        {:else}
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                width="12"
                                                height="12"
                                            >
                                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                                <polyline points="17 8 12 3 7 8" />
                                                <line x1="12" y1="3" x2="12" y2="15" />
                                            </svg>
                                        {/if}
                                        上传音频
                                        <input
                                            type="file"
                                            accept="audio/*,.mp3,.wav,.ogg,.aac,.flac,.m4a"
                                            multiple
                                            style="display:none"
                                            disabled={isUploadingAudio}
                                            on:change={e => handleAudioUploadInput(e, item.key)}
                                        />
                                    </label>
                                {/each}
                            </div>
                        </div>
                    {:else}
                        <!-- 普通设置项 -->
                        <Form.Wrap
                            title={item.title}
                            description={item.description}
                            direction={item?.direction}
                        >
                            <Form.Input
                                type={item.type}
                                key={item.key}
                                value={item.value}
                                placeholder={item?.placeholder}
                                options={item?.options}
                                slider={item?.slider}
                                button={item?.button}
                                disabled={item?.disabled}
                                on:changed={onChanged}
                            />
                        </Form.Wrap>
                    {/if}
                {/if}
            {/each}
        </div>
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

    /* audio picker 内联于普通设置项同一行 */
    .audio-picker-wrap {
        flex-direction: row;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 6px 0;

        /* 和普通 form-wrap 一致：左侧标题占主要空间，右侧是操作区 */
        .title {
            font-weight: bold;
            color: var(--b3-theme-primary);
        }

        /* 音频列表占满整行宽度 */
        .audio-inline-list {
            width: 100%;
            margin-top: 4px;
        }
    }

    /* 音频文件列表（内联，每个音频设置项内独立展示） */
    .audio-inline-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        padding: 3px;
        background: var(--b3-theme-background);
    }

    .audio-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 7px;
        border-radius: 4px;
        border: 1px solid transparent;
        background: transparent;
        transition: all 0.12s;
        gap: 6px;
        cursor: pointer;

        &:hover {
            background: var(--b3-theme-background-light);
        }

        &--selected {
            background: color-mix(in srgb, var(--b3-theme-primary) 8%, var(--b3-theme-background));
            border-color: color-mix(in srgb, var(--b3-theme-primary) 30%, transparent);
        }

        &__name {
            display: flex;
            align-items: center;
            gap: 5px;
            flex: 1;
            min-width: 0;
            font-size: 12px;
            color: var(--b3-theme-on-surface);

            span {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }

        &__badge {
            font-size: 10px;
            padding: 1px 4px;
            border-radius: 3px;
            background: var(--b3-theme-primary);
            color: #fff;
            flex-shrink: 0;
            line-height: 1.4;
        }

        &__btns {
            display: flex;
            gap: 3px;
            flex-shrink: 0;
        }
    }

    /* 上传按钮 */
    .audio-upload-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        font-size: 12px;
        border-radius: 4px;
        background: var(--b3-theme-primary);
        color: #fff;
        cursor: pointer;
        border: none;
        transition: opacity 0.15s;
        user-select: none;
        line-height: 1.6;

        &:hover {
            opacity: 0.85;
        }
        &--loading {
            opacity: 0.6;
            cursor: default;
        }

        /* 列表底部全宽上传区域 */
        &--bottom {
            display: flex;
            width: 100%;
            justify-content: center;
            background: transparent;
            color: var(--b3-theme-on-surface-light);
            border: 1px dashed var(--b3-border-color);
            border-radius: 4px;
            margin-top: 2px;
            padding: 5px 8px;
            font-size: 12px;
            opacity: 0.75;

            &:hover {
                opacity: 1;
                border-color: var(--b3-theme-primary);
                color: var(--b3-theme-primary);
                background: color-mix(in srgb, var(--b3-theme-primary) 6%, transparent);
            }
        }
    }

    /* 小按钮 (play/select/delete) */
    .audio-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 3px;
        border: 1px solid var(--b3-border-color);
        background: transparent;
        cursor: pointer;
        transition: all 0.12s;
        color: var(--b3-theme-on-surface);
        padding: 0;

        &:hover {
            background: var(--b3-theme-background-light);
        }

        &--play {
            color: var(--b3-theme-primary);
            &:hover {
                background: color-mix(in srgb, var(--b3-theme-primary) 12%, transparent);
                border-color: var(--b3-theme-primary);
            }
        }
        &--delete {
            color: var(--b3-theme-error, #ef4444);
            &:hover {
                background: color-mix(in srgb, var(--b3-theme-error, #ef4444) 12%, transparent);
                border-color: var(--b3-theme-error, #ef4444);
            }
        }
    }
</style>
