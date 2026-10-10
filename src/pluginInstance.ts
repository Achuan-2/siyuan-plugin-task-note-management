import zhCN from "../i18n/zh_CN.json";
import en from "../i18n/en.json";

let pluginInstance: any = null;

// 设置插件实例的引用
export function setPluginInstance(plugin: any) {
    pluginInstance = plugin;
}

export function getPluginInstance(): any {
    return pluginInstance;
}


export function i18n(key: string, params?: { [key: string]: string }): string {
    // 模块初始化和插件热重载期间实例可能尚未设置，使用当前思源语言的内置词典兜底。
    const language = typeof window === 'undefined' ? 'zh_CN' : (window as any).siyuan?.config?.lang || 'zh_CN';
    const bundled: Record<string, string> = /^zh(?:[-_]|$)/i.test(language) ? zhCN : en;
    const hostText = pluginInstance?.i18n?.[key];
    const text = typeof hostText === 'string' && hostText ? hostText : bundled[key];
    if (typeof text !== 'string') {
        console.warn("Translation not found:", key);
        return '';
    }
    // 回调替换保留用户文本中的 $&、$' 等字符，也避免参数之间发生二次替换。
    return params ? text.replace(/\$\{([^}]+)\}/g, (placeholder, param) =>
        Object.prototype.hasOwnProperty.call(params, param) ? params[param] : placeholder
    ) : text;
}
