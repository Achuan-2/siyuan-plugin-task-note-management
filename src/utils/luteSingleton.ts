/**
 * 全局共享的 Lute 单例
 * 插件内所有面板/组件统一使用同一个 Lute 实例，避免每次调用 Lute.New() 的开销。
 */
let sharedLute: any = null;

/**
 * 获取共享的 Lute 实例（懒加载）。
 * 如果 window.Lute 尚未挂载，则返回 null 并在控制台输出警告。
 */
export function getLuteInstance(): any {
    if (sharedLute) {
        return sharedLute;
    }

    const Lute = (window as any).Lute;
    if (!Lute) {
        console.warn('Lute is not available on window');
        return null;
    }

    try {
        sharedLute = Lute.New();
        return sharedLute;
    } catch (e) {
        console.error('初始化 Lute 失败:', e);
        return null;
    }
}

/**
 * 将 Markdown 字符串渲染为 HTML。
 * 如果 Lute 未初始化，则回退到简单的 HTML 转义/换行处理。
 */
export function renderMarkdown(markdown: string): string {
    const lute = getLuteInstance();
    if (lute && typeof lute.Md2HTML === 'function') {
        return lute.Md2HTML(markdown);
    }
    // 简单回退：转义 HTML 并保留换行
    return markdown
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

/**
 * 重置共享实例。一般不需要手动调用，仅用于测试或重新初始化场景。
 */
export function resetLuteInstance(): void {
    sharedLute = null;
}
