import { openBlock } from '../../api';
import { getLuteInstance } from '../../utils/luteSingleton';
import { getSiyuanBlockIdFromUrl } from '../../utils/taskTitleLinks';

interface TitlePart {
    text: string;
    href?: string;
}

function readTitleParts(title: string): TitlePart[] {
    const plain = [{ text: title }];
    if (!/\]\(|:\/\/|\bwww\./i.test(title)) return plain;

    const lute = getLuteInstance();
    if (typeof lute?.InlineMd2BlockDOM !== 'function') return plain;

    const template = document.createElement('template');
    template.innerHTML = lute.InlineMd2BlockDOM(title);
    const content = template.content.querySelector('[data-type="NodeParagraph"] > [contenteditable="true"]');
    if (!content?.querySelector('[data-type~="a"][data-href]')) return plain;

    const parts: TitlePart[] = [];
    const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            parts.push({ text: node.textContent || '' });
        } else if (node instanceof Element) {
            const href = node.matches('[data-type~="a"]') ? node.getAttribute('data-href') : null;
            if (href) {
                const safe = /^https?:\/\//i.test(href) || getSiyuanBlockIdFromUrl(href);
                parts.push({ text: node.textContent || '', href: safe ? href : undefined });
            } else if (node.getAttribute('data-type') === 'NodeHTMLBlock') {
                parts.push({ text: node.querySelector('protyle-html')?.getAttribute('data-content') || '' });
            } else {
                node.childNodes.forEach(visit);
            }
        }
    };
    content.childNodes.forEach(visit);
    return parts;
}

export function renderTaskTitleContent(
    element: HTMLElement,
    title: string,
    boundBlockId?: string,
    insideLink = false,
): string {
    const parts = readTitleParts(title);
    const text = parts.map(part => part.text).join('');
    if (boundBlockId || !parts.some(part => part.href)) {
        element.textContent = text;
        return text;
    }

    element.replaceChildren();
    for (const { text, href } of parts) {
        if (!href) {
            element.append(text);
            continue;
        }

        const blockId = getSiyuanBlockIdFromUrl(href);
        const link = insideLink ? document.createElement('span') : document.createElement('a');
        link.className = 'task-title-link';
        link.draggable = false;
        link.textContent = text;
        link.style.color = 'var(--b3-theme-primary)';
        link.style.textDecoration = 'underline';
        link.style.cursor = 'pointer';
        link.style.overflowWrap = 'anywhere';
        if (insideLink) {
            // FullCalendar renders event cards as anchors. Keep the inner link independently operable.
            link.tabIndex = 0;
            link.setAttribute('role', 'link');
            link.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    link.click();
                }
            });
        } else {
            link.setAttribute('href', href);
            if (!blockId) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
        }
        link.addEventListener('click', event => {
            event.stopPropagation();
            if (blockId) {
                event.preventDefault();
                void openBlock(blockId).catch(error => console.warn('Failed to open task title link:', error));
            } else if (insideLink) {
                event.preventDefault();
                window.open(href, '_blank', 'noopener,noreferrer');
            }
        });
        link.addEventListener('dblclick', event => event.stopPropagation());
        element.appendChild(link);
    }
    return text;
}
