/** 使用任务编辑弹窗的状态颜色，在宿主菜单图标列中显示 10px 圆点。 */
export function createStatusMenuIcon(color?: string): string {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'b3-menu__icon');
    svg.setAttribute('viewBox', '0 0 16 16');

    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('cx', '8');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '5');
    circle.setAttribute('fill', color || 'transparent');
    circle.setAttribute('stroke', 'none');
    svg.appendChild(circle);
    return svg.outerHTML;
}
