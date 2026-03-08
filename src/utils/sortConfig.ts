import { Plugin } from "siyuan";
import { i18n } from "../pluginInstance";

// 单个排序条件
export interface SortCriterion {
    method: string;
    order: 'asc' | 'desc';
}

// 完整的排序配置（支持多条件）
export interface SortConfig {
    criteria: SortCriterion[];
}

// 所有可用的排序方法
export const AVAILABLE_SORT_METHODS = [
    { key: 'priority', label: () => i18n("sortByPriority"), icon: '🎯' },
    { key: 'category', label: () => i18n("sortByCategory") || "按分类排序", icon: '🏷️' }
    { key: 'time', label: () => i18n("sortByTime"), icon: '🗓' },
    { key: 'created', label: () => i18n("sortByCreated"), icon: '🗓' },
    { key: 'title', label: () => i18n("sortByTitle"), icon: '📜' },
];

// 默认排序配置
export const DEFAULT_SORT_CONFIG: SortConfig = {
    criteria: [
        { method: 'time', order: 'asc' }
    ]
};

/**
 * 加载排序配置（新版，支持多条件）
 */
export async function loadSortConfig(plugin: Plugin): Promise<SortConfig> {
    try {
        const settings = await (plugin as any).loadSettings();
        
        // 兼容旧版配置：如果存在 sortMethod，转换为新版
        if (settings.sortMethod && !settings.sortCriteria) {
            return {
                criteria: [
                    { method: settings.sortMethod, order: settings.sortOrder || 'asc' }
                ]
            };
        }
        
        // 使用新版配置
        if (settings.sortCriteria && Array.isArray(settings.sortCriteria) && settings.sortCriteria.length > 0) {
            return { criteria: settings.sortCriteria };
        }
        
        return DEFAULT_SORT_CONFIG;
    } catch (error) {
        console.log('加载排序配置失败，使用默认配置:', error);
        return DEFAULT_SORT_CONFIG;
    }
}

/**
 * 保存排序配置（新版，支持多条件）
 */
export async function saveSortConfig(plugin: Plugin, criteria: SortCriterion[]): Promise<void> {
    try {
        const settings = await (plugin as any).loadSettings();
        settings.sortCriteria = criteria;
        
        // 兼容旧版：同时保存第一个条件到旧字段
        if (criteria.length > 0) {
            settings.sortMethod = criteria[0].method;
            settings.sortOrder = criteria[0].order;
        }
        
        await (plugin as any).saveSettings(settings);
        console.log('排序配置保存成功:', criteria);

        // 触发排序配置更新事件
        window.dispatchEvent(new CustomEvent('sortConfigUpdated', {
            detail: { criteria }
        }));
    } catch (error) {
        console.error('保存排序配置失败:', error);
        // 即使保存失败，仍然触发事件以保持界面同步
        window.dispatchEvent(new CustomEvent('sortConfigUpdated', {
            detail: { criteria }
        }));
    }
}

/**
 * 获取排序方法的显示名称
 */
export function getSortMethodName(method: string): string {
    const methodDef = AVAILABLE_SORT_METHODS.find(m => m.key === method);
    return methodDef ? methodDef.label() : method;
}

/**
 * 获取排序条件的显示名称
 */
export function getSortCriterionName(criterion: SortCriterion): string {
    const methodName = getSortMethodName(criterion.method);
    const orderName = criterion.order === 'desc' ? i18n("descending") : i18n("ascending");
    return `${methodName}(${orderName})`;
}

/**
 * 获取排序配置的摘要显示（用于按钮标题）
 */
export function getSortConfigSummary(config: SortConfig): string {
    if (!config.criteria || config.criteria.length === 0) {
        return i18n("sortBy") || "排序";
    }
    
    if (config.criteria.length === 1) {
        return getSortCriterionName(config.criteria[0]);
    }
    
    // 多个条件时显示第一个 + 数量
    const firstName = getSortMethodName(config.criteria[0].method);
    return `${firstName} +${config.criteria.length - 1}`;
}
