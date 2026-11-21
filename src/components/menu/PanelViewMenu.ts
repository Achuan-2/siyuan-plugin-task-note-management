import { i18n } from "../../pluginInstance";

export type PanelViewMode = 'standard' | 'mini';

export function normalizePanelViewMode(value: unknown): PanelViewMode {
    return value === 'mini' ? 'mini' : 'standard';
}

export function createPanelViewMenu(mode: PanelViewMode, onChange: (mode: PanelViewMode) => void) {
    return {
        icon: 'iconEye',
        label: i18n('panelView'),
        submenu: (['standard', 'mini'] as const).map(value => ({
            icon: mode === value ? 'iconSelect' : '',
            label: value === 'mini' ? i18n('panelViewMini') : i18n('panelViewStandard'),
            click: () => onChange(value),
        })),
    };
}
