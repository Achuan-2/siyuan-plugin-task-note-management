let pluginInstance: any = null;

// 设置插件实例的引用
export function setPluginInstance(plugin: any) {
    pluginInstance = plugin;
}

export function t(key: string, params?: { [key: string]: string }): string {
    // 首先尝试从插件实例获取i18n数据
    let i18nData = null;

    if (pluginInstance && pluginInstance.i18n) {
        i18nData = pluginInstance.i18n;
    }

    // 如果插件实例不可用，尝试从全局获取
    if (!i18nData) {
        try {
            const { i18n } = require("siyuan");
            i18nData = i18n;
        } catch (error) {
            console.warn('无法获取i18n对象:', error);
        }
    }

    // 如果仍然没有i18n数据，返回空
    if (!i18nData || typeof i18nData !== 'object') {
        console.warn('i18n数据不可用，使用key作为后备:', key);
        return '';
    }

    let text = i18nData[key];

    // 如果没有找到对应的翻译文本,返回为空
    if (typeof text !== 'string') {
        // console.warn('未找到i18n键:', key);
        text = '';
    }

    // 处理参数替换
    if (params && typeof text === 'string') {
        Object.keys(params).forEach(param => {
            text = text.replace(new RegExp(`\\$\\{${param}\\}`, 'g'), params[param]);
        });
    }

    return text;
}
