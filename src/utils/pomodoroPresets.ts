import { Dialog, showMessage } from "siyuan";
import { i18n } from "../pluginInstance";

export const DEFAULT_POMODORO_PRESET_MINUTES = [5, 10, 15, 25];

export function getPomodoroPresetMinutes(settings?: any, useDefaultFallback: boolean = true): number[] {
    const source = settings?.pomodoroDurationPresets;
    const rawValues = Array.isArray(source)
        ? source
        : (useDefaultFallback ? DEFAULT_POMODORO_PRESET_MINUTES : []);
    const seen = new Set<number>();

    return rawValues
        .map((item: any) => Number(item))
        .filter((item: number) => Number.isInteger(item) && item > 0)
        .filter((item: number) => {
            if (seen.has(item)) return false;
            seen.add(item);
            return true;
        });
}

export function parseEstimatedPomodoroDurationToMinutes(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.round(value);
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
    if (!normalized) {
        return null;
    }

    if (/^\d+(?:\.\d+)?$/.test(normalized)) {
        const minutes = Number(normalized);
        return minutes > 0 ? Math.round(minutes) : null;
    }

    let totalMinutes = 0;
    let matched = false;
    const durationRegex = /(\d+(?:\.\d+)?)(h(?:ours?)?|hr|hrs|小时|时|m(?:in(?:ute)?s?)?|分钟|分)/g;
    let match: RegExpExecArray | null;

    while ((match = durationRegex.exec(normalized)) !== null) {
        const amount = Number(match[1]);
        if (!Number.isFinite(amount) || amount <= 0) {
            continue;
        }

        matched = true;
        const unit = match[2];
        if (/^(h|hr|hrs|hour|hours|小时|时)/.test(unit)) {
            totalMinutes += amount * 60;
        } else {
            totalMinutes += amount;
        }
    }

    if (!matched || totalMinutes <= 0) {
        return null;
    }

    return Math.round(totalMinutes);
}

export function resolveDefaultPomodoroDuration(source: any, settings: any): number {
    const defaultDuration = Math.max(1, Number(settings?.pomodoroWorkDuration ?? settings?.workDuration ?? 45));
    const estimatedValue = source?.estimatedPomodoroDuration ?? source?.extendedProps?.estimatedPomodoroDuration;
    const estimatedDuration = parseEstimatedPomodoroDurationToMinutes(estimatedValue);

    if (estimatedDuration && estimatedDuration < defaultDuration) {
        return estimatedDuration;
    }

    return defaultDuration;
}

export function createPomodoroStartSubmenu(options: {
    source: any;
    plugin: any;
    startPomodoro: (workDurationOverride?: number) => void | Promise<void>;
    managePresets?: () => void | Promise<void>;
}): any[] {
    const { source, plugin, startPomodoro, managePresets } = options;
    const currentSettings = plugin?.settings;
    const defaultDurationMinutes = resolveDefaultPomodoroDuration(source, currentSettings);
    const presetItems = getPomodoroPresetMinutes(plugin?.settings).map((minutes) => ({
        iconHTML: "🕒",
        label: `${minutes} ${i18n('minutes') || '分钟'}`,
        click: () => startPomodoro(minutes)
    }));

    return [
        {
            iconHTML: '🍅',
            label: `${i18n('sortDefault') || '默认'} (${defaultDurationMinutes} ${i18n('minutes') || '分钟'})`,
            click: async () => {
                if (!plugin || typeof plugin.loadSettings !== 'function') {
                    await startPomodoro();
                    return;
                }

                const settings = await plugin.loadSettings();
                const durationMinutes = resolveDefaultPomodoroDuration(source, settings);
                await startPomodoro(durationMinutes);
            }
        },
        ...presetItems,
        { type: 'separator' },
        {
            iconHTML: '✏️',
            label: i18n('managePresets') || '编辑预设',
            click: () => managePresets ? managePresets() : showPomodoroPresetDialog(plugin)
        }
    ];
}

export async function showPomodoroPresetDialog(plugin: any): Promise<void> {
    if (!plugin || typeof plugin.loadSettings !== 'function' || typeof plugin.saveSettings !== 'function') {
        showMessage(i18n('operationFailed') || '操作失败');
        return;
    }

    const settings = await plugin.loadSettings();
    let presetValues = getPomodoroPresetMinutes(settings, false).map((item) => item.toString());
    if (!Array.isArray(settings?.pomodoroDurationPresets)) {
        presetValues = getPomodoroPresetMinutes(settings, true).map((item) => item.toString());
    }

    const dialog = new Dialog({
        title: i18n('managePresets') || '编辑预设',
        content: `
            <div class="b3-dialog__content" style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
                <div class="b3-form__group" style="margin-bottom: 0;">
                    <div class="b3-label__text">${i18n('pomodoroPresetDialogHint') || '可新增、修改或删除右键菜单中的番茄钟分钟预设。'}</div>
                </div>
                <div class="b3-form__group" style="margin-bottom: 0;">
                    <div id="pomodoroPresetList" style="display: flex; flex-direction: column; gap: 12px;"></div>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--outline" id="pomodoroPresetAdd" style="margin-right: auto;">${i18n('addPreset') || '添加预设'}</button>
                <button class="b3-button b3-button--cancel" id="pomodoroPresetCancel">${i18n('cancel') || '取消'}</button>
                <button class="b3-button b3-button--primary" id="pomodoroPresetSave">${i18n('save') || '保存'}</button>
            </div>
        `,
        width: '420px',
        height: '460px'
    });

    const listEl = dialog.element.querySelector('#pomodoroPresetList') as HTMLElement;
    const addBtn = dialog.element.querySelector('#pomodoroPresetAdd') as HTMLButtonElement;
    const cancelBtn = dialog.element.querySelector('#pomodoroPresetCancel') as HTMLButtonElement;
    const saveBtn = dialog.element.querySelector('#pomodoroPresetSave') as HTMLButtonElement;

    const renderList = () => {
        const emptyText = i18n('pomodoroPresetEmpty') || '暂无预设，可点击下方按钮新增。';
        listEl.innerHTML = presetValues.length === 0
            ? `<div class="b3-form__group" style="margin-bottom: 0;"><div style="padding:16px 12px;border:1px dashed var(--b3-border-color);border-radius:8px;color:var(--b3-theme-on-surface-light);text-align:center;">${emptyText}</div></div>`
            : presetValues.map((value, index) => `
                <div class="b3-form__group pomodoro-preset-row" data-index="${index}" style="margin-bottom: 0;">
                    <label class="b3-form__label">${i18n('presetTimeMinutes') || '预设时间 (分钟)'}</label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input
                            class="b3-text-field pomodoro-preset-input"
                            data-index="${index}"
                            type="number"
                            min="1"
                            step="1"
                            value="${value}"
                            placeholder="${i18n('presetTimeMinutes') || '预设时间 (分钟)'}"
                            style="flex:1;"
                        >
                        <span style="font-size:12px;color:var(--b3-theme-on-surface-light);white-space:nowrap;">${i18n('minutes') || '分钟'}</span>
                        <button class="b3-button b3-button--outline pomodoro-preset-delete" data-index="${index}">${i18n('deletePreset') || '删除预设'}</button>
                    </div>
                </div>
            `).join('');

        listEl.querySelectorAll('.pomodoro-preset-input').forEach((input) => {
            input.addEventListener('input', (event) => {
                const target = event.target as HTMLInputElement;
                const index = Number(target.dataset.index);
                presetValues[index] = target.value;
            });
        });

        listEl.querySelectorAll('.pomodoro-preset-delete').forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number((button as HTMLButtonElement).dataset.index);
                presetValues.splice(index, 1);
                renderList();
            });
        });
    };

    addBtn.addEventListener('click', () => {
        presetValues.push('');
        renderList();
        const inputs = listEl.querySelectorAll('.pomodoro-preset-input');
        const lastInput = inputs[inputs.length - 1] as HTMLInputElement | undefined;
        lastInput?.focus();
    });

    cancelBtn.addEventListener('click', () => dialog.destroy());

    saveBtn.addEventListener('click', async () => {
        const nextPresets: number[] = [];
        const seen = new Set<number>();

        for (let index = 0; index < presetValues.length; index++) {
            const rawValue = String(presetValues[index] ?? '').trim();
            if (!rawValue) {
                continue;
            }

            const minutes = Number(rawValue);
            if (!Number.isInteger(minutes) || minutes <= 0) {
                showMessage(i18n('pomodoroPresetInvalid') || '请输入大于 0 的整数分钟');
                const invalidInput = listEl.querySelector(`.pomodoro-preset-input[data-index="${index}"]`) as HTMLInputElement | null;
                invalidInput?.focus();
                return;
            }

            if (seen.has(minutes)) {
                showMessage(i18n('pomodoroPresetDuplicate') || '预设分钟不能重复');
                const duplicateInput = listEl.querySelector(`.pomodoro-preset-input[data-index="${index}"]`) as HTMLInputElement | null;
                duplicateInput?.focus();
                return;
            }

            seen.add(minutes);
            nextPresets.push(minutes);
        }

        settings.pomodoroDurationPresets = nextPresets;
        await plugin.saveSettings(settings);
        if (plugin && typeof plugin === 'object') {
            plugin.settings = { ...plugin.settings, pomodoroDurationPresets: nextPresets };
        }
        dialog.destroy();
        showMessage(i18n('pomodoroPresetSaved') || '番茄钟预设已保存');
    });

    renderList();
}