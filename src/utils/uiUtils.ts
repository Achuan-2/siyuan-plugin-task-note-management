
/**
 * 将颜色转换为带透明度的 rgba() 格式，兼容不支持 CSS 相对颜色语法的平板端浏览器。
 * 支持 #rgb、#rrggbb、rgb()、hsl()、CSS 变量等所有格式。
 */
export function colorWithOpacity(color: string, opacity: number): string {
    if (!color) return `rgba(0, 0, 0, ${opacity})`;

    try {
        // 1. 优先处理 hex 颜色（最快，无需 DOM）
        const hex6 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(color);
        if (hex6) {
            const r = parseInt(hex6[1], 16);
            const g = parseInt(hex6[2], 16);
            const b = parseInt(hex6[3], 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }
        const hex3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(color);
        if (hex3) {
            const r = parseInt(hex3[1] + hex3[1], 16);
            const g = parseInt(hex3[2] + hex3[2], 16);
            const b = parseInt(hex3[3] + hex3[3], 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }

        // 2. 对 CSS 变量或其他格式，借助临时 DOM 让浏览器计算实际颜色值
        const probe = document.createElement('div');
        probe.style.display = 'none';
        probe.style.color = color;
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).color; // 浏览器始终返回 rgb(r, g, b) 或 rgba(r, g, b, a)
        document.body.removeChild(probe);

        // 如果已经是 rgba，处理它
        if (computed.startsWith('rgba')) {
            const match = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(computed);
            if (match) {
                // 如果原色已经有透明度，我们在这里叠加透明度或者替换它。
                // 通常这里我们希望替换为传入的 opacity
                return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
            }
        }

        const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(computed);
        if (match) {
            return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
        }
    } catch (e) {
        // ignore, fall through to fallback
    }

    // 3. 解析失败则回退：尝试使用原生 rgba(from ...) 
    // 虽然可能不兼容，但这是最后的手段。或者直接回退到原色。
    // 在这里我们返回一个相对安全的字符串
    return `rgba(0, 0, 0, ${opacity})`;
}
