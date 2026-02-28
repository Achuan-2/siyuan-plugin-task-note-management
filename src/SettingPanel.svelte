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
    import VipPanel from './components/VipPanel.svelte';
    import SubscriptionPanel from './components/icsSubscriptionPanel.svelte';

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
        await pushMsg(i18n('audioUploadSuccess').replace('${name}', file.name));
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

            await pushMsg(i18n('audioDownloading'));
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

            await pushMsg(i18n('audioDownloadSuccess'));
            return localUrl;
        } catch (e) {
            console.error('下载音频失败:', e);
            await pushErrMsg(i18n('audioDownloadFailed'));
            return null;
        } finally {
            isDownloadingAudio = false;
        }
    }

    async function toggleSettingValue(key: string, value: any) {
        if (!settings.audioFileLists) settings.audioFileLists = {};
        if (!settings.audioFileLists[key]) settings.audioFileLists[key] = [];

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
            await pushErrMsg(i18n('openFolderNotSupported'));
        }
    };

    // 定义设置分组
    let groups: ISettingGroup[] = [
        {
            name: '👑VIP',
            items: [], // 使用 VipPanel 组件渲染
        },
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
                    key: 'calendarMultiDaysCount',
                    value: settings.calendarMultiDaysCount ?? 3,
                    type: 'number',
                    title: i18n('calendarMultiDaysCount') || '多天视图天数',
                    description:
                        i18n('calendarMultiDaysCountDesc') || '设置多天视图显示的天数，默认为3天',
                },
                {
                    key: 'calendarShowLunar',
                    value: settings.calendarShowLunar, // Default true
                    type: 'checkbox',
                    title: i18n('calendarShowLunar'),
                    description: i18n('calendarShowLunarDesc'),
                },
                {
                    key: 'calendarShowHoliday',
                    value: settings.calendarShowHoliday,
                    type: 'checkbox',
                    title: i18n('calendarShowHoliday'),
                    description: i18n('calendarShowHolidayDesc'),
                },

                {
                    key: 'calendarHolidayIcsUrl',
                    value: settings.calendarHolidayIcsUrl,
                    type: 'textinput',
                    title: i18n('calendarHolidayIcsUrl'),
                    description: i18n('calendarHolidayIcsUrlDesc'),
                },
                {
                    key: 'updateHoliday',
                    value: '',
                    type: 'button',
                    title: i18n('updateHoliday'),
                    description: i18n('updateHolidayDesc'),
                    button: {
                        label: i18n('updateHoliday'),
                        callback: async () => {
                            await pushMsg(i18n('updatingHoliday'));
                            const success = await syncHolidays(
                                plugin,
                                settings.calendarHolidayIcsUrl
                            );
                            if (success) {
                                await pushMsg(i18n('holidayUpdateSuccess'));
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            } else {
                                await pushErrMsg(i18n('holidayUpdateFailed'));
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
                    title: i18n('showPomodoroInSummary'),
                    description: i18n('showPomodoroInSummaryDesc'),
                },
                {
                    key: 'showHabitInSummary',
                    value: settings.showHabitInSummary,
                    type: 'checkbox',
                    title: i18n('showHabitInSummary'),
                    description: i18n('showHabitInSummaryDesc'),
                },
            ],
        },
        {
            name: '✅' + i18n('taskNoteSettings'),
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
                    title: i18n('groupDefaultHeadingLevel'),
                    description: i18n('groupDefaultHeadingLevelDesc'),
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
                    title: i18n('milestoneDefaultHeadingLevel'),
                    description: i18n('milestoneDefaultHeadingLevelDesc'),
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
                    title: i18n('pomodoroEndPopupWindow'),
                    description: i18n('pomodoroEndPopupWindowDesc'),
                },
                {
                    key: 'pomodoroDockPosition',
                    value: settings.pomodoroDockPosition,
                    type: 'select',
                    title: i18n('pomodoroDockPosition'),
                    description: i18n('pomodoroDockPositionDesc'),
                    options: {
                        right: i18n('right'),
                        left: i18n('left'),
                        top: i18n('top'),
                        bottom: i18n('bottom'),
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
            name: i18n('randomRestSettings'),
            items: [
                {
                    key: 'randomRestEnabled',
                    value: settings.randomRestEnabled,
                    type: 'checkbox',
                    title: i18n('randomRestEnabled'),
                    description: i18n('randomRestEnabledDesc'),
                },
                {
                    key: 'randomRestSystemNotification',
                    value: settings.randomRestSystemNotification,
                    type: 'checkbox',
                    title: i18n('randomRestSystemNotification'),
                    description: i18n('randomRestSystemNotificationDesc'),
                },
                {
                    key: 'randomRestPopupWindow',
                    value: settings.randomRestPopupWindow,
                    type: 'checkbox',
                    title: i18n('randomRestPopupWindow'),
                    description: i18n('randomRestPopupWindowDesc'),
                },
                {
                    key: 'randomRestMinInterval',
                    value: settings.randomRestMinInterval,
                    type: 'number',
                    title: i18n('randomRestMinInterval'),
                    description: i18n('randomRestMinIntervalDesc'),
                },
                {
                    key: 'randomRestMaxInterval',
                    value: settings.randomRestMaxInterval,
                    type: 'number',
                    title: i18n('randomRestMaxInterval'),
                    description: i18n('randomRestMaxIntervalDesc'),
                },
                {
                    key: 'randomRestBreakDuration',
                    value: settings.randomRestBreakDuration,
                    type: 'number',
                    title: i18n('randomRestBreakDuration'),
                    description: i18n('randomRestBreakDurationDesc'),
                },
                {
                    key: 'randomRestSounds',
                    value: settings.audioFileLists?.randomRestSounds || [],
                    type: 'custom-audio',
                    title: i18n('randomRestSounds'),
                    description: i18n('randomRestSoundsDesc') || '',
                },
                {
                    key: 'randomRestEndSound',
                    value: settings.audioSelected?.randomRestEndSound || '',
                    type: 'custom-audio',
                    title: i18n('randomRestEndSound'),
                    description: i18n('randomRestEndSoundDesc') || '',
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
                    title: i18n('openDataFolder'),
                    description: i18n('openDataFolderDesc'),
                    button: {
                        label: i18n('openFolder'),
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
                    title: i18n('deletePluginData'),
                    description: i18n('deletePluginDataDesc'),
                    button: {
                        label: i18n('deleteData'),
                        callback: async () => {
                            const confirmed = confirm(i18n('confirmDeletePluginData'));
                            if (confirmed) {
                                const dataDir =
                                    '/data/storage/petal/siyuan-plugin-task-note-management/';
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
                                pushErrMsg(
                                    i18n('dataDeletedCount').replace(
                                        '${count}',
                                        String(successCount)
                                    )
                                );
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            }
                        },
                    },
                },
            ],
        },
        {
            name: '⬆️' + i18n('exportSettings'),
            items: [
                {
                    key: 'exportIcs',
                    value: '',
                    type: 'button',
                    title: i18n('exportIcs'),
                    description: i18n('exportIcsDesc'),
                    button: {
                        label: i18n('generateIcs'),
                        callback: async () => {
                            await exportIcsFile(plugin, true, false, settings.icsTaskFilter as any);
                        },
                    },
                },
            ],
        },
        {
            name: '⬇️' + i18n('importSettings'),
            items: [
                {
                    key: 'importIcs',
                    value: '',
                    type: 'button',
                    title: i18n('importIcs'),
                    description: i18n('importIcsDesc'),
                    button: {
                        label: i18n('selectFileToImport'),
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
                                    await pushErrMsg(i18n('readFileFailed'));
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
            items: [], // 使用 SubscriptionPanel 组件渲染
        },
        {
            name: '☁️' + i18n('calendarUpload'),
            items: [
                {
                    key: 'icsSyncHint',
                    value: '',
                    type: 'hint',
                    title: i18n('icsSyncTitle'),
                    description: i18n('icsSyncDesc'),
                },
                {
                    key: 'icsTaskFilter',
                    value: settings.icsTaskFilter || 'all',
                    type: 'select',
                    title: i18n('icsTaskFilter'),
                    description: i18n('icsTaskFilterDesc'),
                    options: {
                        all: i18n('allTasks'),
                        completed: i18n('completedTasks'),
                        uncompleted: i18n('uncompletedTasks'),
                    },
                },
                {
                    key: 'icsFileName',
                    value: settings.icsFileName,
                    type: 'textinput',
                    title: i18n('icsFileName'),
                    description: i18n('icsFileNameDesc'),
                    placeholder: 'reminder-' + (window.Lute?.NewNodeID?.() || 'auto'),
                },
                {
                    key: 'icsSyncMethod',
                    value: settings.icsSyncMethod,
                    type: 'select',
                    title: i18n('icsSyncMethod'),
                    description: i18n('icsSyncMethodDesc'),
                    options: {
                        siyuan: i18n('siyuanServer'),
                        s3: i18n('s3Storage'),
                    },
                },
                {
                    key: 'icsSyncEnabled',
                    value: settings.icsSyncEnabled,
                    type: 'checkbox',
                    title: i18n('icsSyncEnabled'),
                    description: i18n('icsSyncEnabledDesc'),
                },
                {
                    key: 'icsSyncInterval',
                    value: settings.icsSyncInterval,
                    type: 'select',
                    title: i18n('icsSyncInterval'),
                    description: i18n('icsSyncIntervalDesc'),
                    options: {
                        manual: i18n('manual'),
                        '15min': i18n('every15Minutes'),
                        hourly: i18n('everyHour'),
                        '4hour': i18n('every4Hours'),
                        '12hour': i18n('every12Hours'),
                        daily: i18n('everyDay'),
                    },
                },
                {
                    key: 'icsSilentUpload',
                    value: settings.icsSilentUpload,
                    type: 'checkbox',
                    title: i18n('icsSilentUpload'),
                    description: i18n('icsSilentUploadDesc'),
                },
                {
                    key: 'uploadIcsToCloud',
                    value: '',
                    type: 'button',
                    title: i18n('uploadIcsToCloud'),
                    description: i18n('uploadIcsToCloudDesc'),
                    button: {
                        label: i18n('generateAndUpload'),
                        callback: async () => {
                            await pushMsg(i18n('icsUploading'));
                            await uploadIcsToCloud(plugin, settings);
                        },
                    },
                },

                {
                    key: 'icsCloudUrl',
                    value: settings.icsCloudUrl,
                    type: 'textinput',
                    title: i18n('icsCloudUrl'),
                    description: i18n('icsCloudUrlDesc'),
                    disabled: false,
                },
                {
                    key: 'icsLastSyncAt',
                    value: settings.icsLastSyncAt
                        ? new Date(settings.icsLastSyncAt).toLocaleString()
                        : '',
                    type: 'textinput',
                    title: i18n('icsLastSyncAt'),
                    description: i18n('icsLastSyncAtDesc'),
                    disabled: true,
                },
                // 思源服务器同步配置

                // S3 同步配置
                {
                    key: 's3UseSiyuanConfig',
                    value: settings.s3UseSiyuanConfig,
                    type: 'checkbox',
                    title: i18n('s3UseSiyuanConfig'),
                    description: i18n('s3UseSiyuanConfigDesc'),
                },
                {
                    key: 's3Bucket',
                    value: settings.s3Bucket,
                    type: 'textinput',
                    title: 'S3 Bucket',
                    description: i18n('s3BucketDesc'),
                    placeholder: 'my-bucket',
                },
                {
                    key: 's3Endpoint',
                    value: settings.s3Endpoint,
                    type: 'textinput',
                    title: 'S3 Endpoint',
                    description: i18n('s3EndpointDesc'),
                    placeholder: 'oss-cn-shanghai.aliyuncs.com',
                },
                {
                    key: 's3Region',
                    value: settings.s3Region,
                    type: 'textinput',
                    title: 'S3 Region',
                    description: i18n('s3RegionDesc'),
                    placeholder: 'auto',
                },
                {
                    key: 's3AccessKeyId',
                    value: settings.s3AccessKeyId,
                    type: 'textinput',
                    title: 'S3 Access Key ID',
                    description: i18n('s3AccessKeyIdDesc'),
                },
                {
                    key: 's3AccessKeySecret',
                    value: settings.s3AccessKeySecret,
                    type: 'textinput',
                    title: 'S3 Access Key Secret',
                    description: i18n('s3AccessKeySecretDesc'),
                },
                {
                    key: 's3StoragePath',
                    value: settings.s3StoragePath,
                    type: 'textinput',
                    title: i18n('s3StoragePath'),
                    description: i18n('s3StoragePathDesc'),
                    placeholder: '/calendar/',
                },
                {
                    key: 's3ForcePathStyle',
                    value: settings.s3ForcePathStyle,
                    type: 'select',
                    title: i18n('s3ForcePathStyle'),
                    description: i18n('s3ForcePathStyleDesc'),
                    options: {
                        true: 'Path-style',
                        false: 'Virtual hosted style',
                    },
                },
                {
                    key: 's3TlsVerify',
                    value: settings.s3TlsVerify,
                    type: 'select',
                    title: i18n('s3TlsVerify'),
                    description: i18n('s3TlsVerifyDesc'),
                    options: {
                        true: i18n('enableVerification'),
                        false: i18n('disableVerification'),
                    },
                },
                {
                    key: 's3CustomDomain',
                    value: settings.s3CustomDomain,
                    type: 'textinput',
                    title: i18n('s3CustomDomain'),
                    description: i18n('s3CustomDomainDesc'),
                    placeholder: 'cdn.example.com',
                },
            ],
        },
        {
            name: '❤️' + i18n('donate'),
            items: [
                {
                    key: 'donateInfo',
                    value: '',
                    type: 'hint',
                    title: i18n('donateTitle'),
                    description: `
                        <div style="margin-top:12px;">
                            <img src="plugins/siyuan-plugin-task-note-management/assets/donate.png" alt="donate" style="max-width:260px; height:auto; border:1px solid var(--b3-border-color);"/>

                            <p style="margin-top:12px;">Non-Chinese users can transfer money via Wise, Western Union, etc.</p>
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
        } else if (key === 'calendarMultiDaysCount') {
            // 确保多天视图天数是数字，且范围在 1-14 之间
            const parsed = parseInt(value, 10);
            newValue = isNaN(parsed) ? 3 : Math.max(1, Math.min(14, parsed));
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
        if (key === 'vipKey') {
            // VIP 逻辑现在由 VipPanel 处理
            return;
        }

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
            key.startsWith('randomRest')
        ) {
            (async () => {
                try {
                    // Must transform raw settings into simplified structure first
                    const pomodoroSettings = await plugin.getPomodoroSettings(settings);
                    await PomodoroManager.getInstance().updateSettings(pomodoroSettings);
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
        const loadedSettings = await plugin.loadSettings(true);
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
                updated.hidden = settings.icsSyncMethod !== 's3';
            }

            // S3 bucket、存储路径和自定义域名 - 仅在启用同步且选择S3存储时显示（即使使用思源配置也允许覆盖）
            if (['s3Bucket', 's3StoragePath', 's3CustomDomain'].includes(item.key)) {
                updated.hidden = settings.icsSyncMethod !== 's3';
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
                    settings.icsSyncMethod !== 's3' || settings.s3UseSiyuanConfig === true;
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
        await projectManager.initialize();
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
                    await projectManager.initialize();
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
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <li
                data-name="editor"
                class:b3-list-item--focus={group.name === focusGroup}
                class="b3-list-item"
                title={group.name}
                role="button"
                on:click={() => {
                    focusGroup = group.name;
                }}
                on:keydown={() => {}}
            >
                <span class="tab-item__text">{group.name}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        <!-- 手动按项目顺序渲染，保证 custom-audio 项在正确位置 -->
        <div class="config__tab-container" data-name={currentGroup?.name || ''}>
            {#if currentGroup?.name === '👑VIP'}
                <VipPanel {plugin} />
            {/if}
            {#if currentGroup?.name === '📅' + i18n('icsSubscription')}
                <SubscriptionPanel {plugin} />
            {/if}
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
                                                        <span class="audio-row__badge">
                                                            {i18n('currentAudio')}
                                                        </span>
                                                    {/if}
                                                </div>
                                                <div class="audio-row__btns">
                                                    <button
                                                        class="audio-btn audio-btn--play"
                                                        title={playingPath === audio.path &&
                                                        isAudioPlaying
                                                            ? i18n('audioPause')
                                                            : i18n('audioPreview')}
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
                                                        title={i18n('removeFromList')}
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
                                        title={i18n('uploadAudioFile')}
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
                                        {i18n('uploadAudio')}
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
        width: min(30%, 200px);

        .b3-list-item {
            display: flex;
            align-items: center;
            overflow: hidden;
        }

        .tab-item__text {
            display: block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }
    }

    .config__tab-wrap {
        flex: 1;
        height: 100%;
        overflow: auto;
        padding: 2px;
        background-color: var(--b3-theme-background);
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
