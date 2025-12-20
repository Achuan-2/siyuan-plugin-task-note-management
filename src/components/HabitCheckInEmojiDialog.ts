import { Picker } from "emoji-picker-element";
import zh_CN from 'emoji-picker-element/i18n/zh_CN';
import { Dialog, showMessage } from "siyuan";
import { Habit, HabitCheckInEmoji } from "./HabitPanel";
export class HabitCheckInEmojiDialog {
    private dialog: Dialog;
    private habit: Habit;
    private onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>;
    private emojis: HabitCheckInEmoji[];
    // single shared picker instance and active selection tracking
    private sharedPicker: Picker | null = null;
    private activePickerIndex: number | null = null;
    private activeEmojiCircle: HTMLElement | null = null;
    private sharedCloseHandler?: (e: MouseEvent) => void;
    private sharedResizeHandler?: () => void;
    private sharedScrollHandler?: () => void;
    private sharedEnterHandler?: (e: KeyboardEvent) => void;
    // dragging state for reorder
    private draggingIndex: number | null = null;
    private dropBefore: boolean = false;

    constructor(habit: Habit, onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>) {
        this.habit = habit;
        this.onSave = onSave;
        // 深拷贝现有的emoji配置
        this.emojis = JSON.parse(JSON.stringify(habit.checkInEmojis || []));

        // 如果没有配置,使用默认值
        if (this.emojis.length === 0) {
            this.emojis = [
                { emoji: '✅', meaning: '完成', promptNote: false, countsAsSuccess: true },
                { emoji: '❌', meaning: '未完成', promptNote: false, countsAsSuccess: false },
                { emoji: '⭕️', meaning: '部分完成', promptNote: false, countsAsSuccess: true }
            ];
        }
    }

    show() {
        this.dialog = new Dialog({
            title: `编辑打卡选项 - ${this.habit.title}`,
            content: '<div id="checkInEmojiContainer"></div>',
            width: "600px",
            height: "700px"
            , destroyCallback: () => {
                // clear any floating pickers
                this.clearAllPickers();
            }
        });

        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (!container) return;

        this.renderEmojiList(container);
    }

    private renderEmojiList(container: HTMLElement) {
        // Remove any floating pickers from previous render to avoid duplicates and event listeners leak
        this.clearAllPickers();
        container.innerHTML = '';
        container.style.cssText = 'padding: 20px; display: flex; flex-direction: column; height: 100%;';

        // 全局设置：隐藏今天已打卡的选项
        const globalSettings = document.createElement('div');
        globalSettings.style.cssText = `
            margin-bottom: 20px; 
            padding: 16px 20px; 
            background: linear-gradient(135deg, var(--b3-theme-primary-lightest) 0%, var(--b3-theme-surface) 100%);
            border-radius: 12px; 
            font-size: 13px; 
            color: var(--b3-theme-on-surface);
            border-left: 4px solid var(--b3-theme-primary);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        `;

        const hideCheckedLabel = document.createElement('label');
        hideCheckedLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;';
        const hideCheckedCheckbox = document.createElement('input');
        hideCheckedCheckbox.type = 'checkbox';
        hideCheckedCheckbox.checked = !!this.habit.hideCheckedToday;
        hideCheckedCheckbox.addEventListener('change', () => {
            this.habit.hideCheckedToday = hideCheckedCheckbox.checked;
        });
        const hideCheckedText = document.createElement('span');
        hideCheckedText.textContent = '今天已打卡的选项不显示在菜单中';
        hideCheckedLabel.appendChild(hideCheckedCheckbox);
        hideCheckedLabel.appendChild(hideCheckedText);
        globalSettings.appendChild(hideCheckedLabel);

        container.appendChild(globalSettings);

        // 说明文字
        const description = document.createElement('div');
        description.style.cssText = `
            margin-bottom: 20px; 
            padding: 16px 20px; 
            background: linear-gradient(135deg, var(--b3-theme-primary-lightest) 0%, var(--b3-theme-surface) 100%);
            border-radius: 12px; 
            font-size: 13px; 
            color: var(--b3-theme-on-surface);
            border-left: 4px solid var(--b3-theme-primary);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        `;

        description.textContent = '配置打卡时可选择的emoji选项，每个选项可以设置含义和是否在打卡时询问备注。';

        container.appendChild(description);
        const listContainer = document.createElement('div');
        // 设置class
        listContainer.className = 'b3-dialog__content';
        listContainer.style.cssText = `
            flex: 1; 
            overflow-y: auto; 
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 4px;
        `;

        this.emojis.forEach((emojiConfig, index) => {
            const item = this.createEmojiItem(emojiConfig, index);
            listContainer.appendChild(item);
        });

        container.appendChild(listContainer);

        // 底部按钮
        const buttonContainer = document.createElement('div');
        // 设置class
        buttonContainer.className = 'b3-dialog__action';
        buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: space-between;';

        // 添加新选项按钮
        const addBtn = document.createElement('button');
        addBtn.className = 'b3-button b3-button--outline';
        addBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> 添加选项';
        addBtn.addEventListener('click', () => {
            this.addEmoji();
        });

        // 右侧按钮组
        const rightButtons = document.createElement('div');
        rightButtons.style.cssText = 'display: flex; gap: 8px;';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'b3-button';
        resetBtn.textContent = '恢复默认';
        resetBtn.addEventListener('click', () => {
            this.resetToDefault();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'b3-button';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => {
            this.dialog.destroy();
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'b3-button b3-button--primary';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', async () => {
            await this.handleSave();
        });

        rightButtons.appendChild(resetBtn);
        rightButtons.appendChild(cancelBtn);
        rightButtons.appendChild(saveBtn);

        buttonContainer.appendChild(addBtn);
        buttonContainer.appendChild(rightButtons);

        container.appendChild(buttonContainer);
    }

    private initSharedPicker() {
        if (this.sharedPicker) return;
        try {
            // Prefer direct class constructor if available for typing and tree-shaking
            // Fallback to createElement when Picker is undefined (older build/runtime)
            try {
                // eslint-disable-next-line new-cap
                this.sharedPicker = new Picker({
                    i18n: zh_CN,
                    locale: 'zh_CN',
                    dataSource: '/plugins/siyuan-plugin-task-note-management/assets/emojis_search.json'
                }
                ) as Picker;
            } catch (e) {
                // @ts-ignore - fall back to DOM creation
                this.sharedPicker = document.createElement('emoji-picker') as any;
                if (this.sharedPicker) {
                    // Set attributes for DOM-created picker
                    this.sharedPicker.setAttribute('locale', 'zh_CN');
                    this.sharedPicker.setAttribute('data-source', '/plugins/siyuan-plugin-task-note-management/assets/emojis_search.json');
                }
            }
            this.sharedPicker.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 2147483647; display: none; margin-top: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); border-radius: 12px; background: var(--b3-theme-surface);';
            document.body.appendChild(this.sharedPicker);

            // emoji click handler uses activePickerIndex
            this.sharedPicker.addEventListener('emoji-click', (event: any) => {
                const selectedEmoji = event.detail.emoji.unicode;
                if (this.activePickerIndex !== null && this.activePickerIndex >= 0) {
                    this.emojis[this.activePickerIndex].emoji = selectedEmoji;
                }
                if (this.activeEmojiCircle) {
                    this.activeEmojiCircle.textContent = selectedEmoji;
                }
                this.sharedPicker.style.display = 'none';
                this.activePickerIndex = null;
                this.activeEmojiCircle = null;
            });

            // 当搜索框内容本身是 Emoji 时, 支持按 Enter 直接确定
            const attachEnterHandler = () => {
                try {
                    // 该组件使用 shadow DOM, 所以先尝试 shadowRoot 查询
                    const searchInput: HTMLInputElement | null = this.sharedPicker.shadowRoot?.querySelector('input') as HTMLInputElement || this.sharedPicker.querySelector('input') as HTMLInputElement;
                    if (searchInput && !this.sharedEnterHandler) {
                        this.sharedEnterHandler = (e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value || '';
                                if (this.isAllEmoji(val)) {
                                    // apply emoji and close picker
                                    this.applyEmojiFromSearch(val);
                                    e.preventDefault();
                                    e.stopPropagation();
                                }
                            }
                        };
                        searchInput.addEventListener('keydown', this.sharedEnterHandler);
                    }
                } catch (error) {
                    // ignore
                }
            };

            // try to attach immediately; if not present (render delay), attach after a short delay
            attachEnterHandler();
            setTimeout(attachEnterHandler, 50);

            this.sharedCloseHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (this.sharedPicker && this.sharedPicker.contains(target)) return;
                if (this.activeEmojiCircle && this.activeEmojiCircle.contains(target)) return;
                if (this.sharedPicker) this.sharedPicker.style.display = 'none';
                this.activePickerIndex = null;
                this.activeEmojiCircle = null;
            };
            document.addEventListener('click', this.sharedCloseHandler);

            this.sharedResizeHandler = () => {
                if (this.sharedPicker && this.sharedPicker.style.display === 'block') this.positionSharedPicker();
            };
            this.sharedScrollHandler = () => {
                if (this.sharedPicker && this.sharedPicker.style.display === 'block') this.positionSharedPicker();
            };
            window.addEventListener('resize', this.sharedResizeHandler);
            window.addEventListener('scroll', this.sharedScrollHandler, true);
        } catch (error) {
            console.error('init shared picker failed', error);
        }
    }

    private isAllEmoji(str: string) {
        const s = (str || '').trim();
        if (!s) return false;
        try {
            // Use Unicode property escapes to match emoji sequences, including ZWJ sequences
            return /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(s);
        } catch (e) {
            // Fallback: check if there's a surrogate pair (basic heuristic)
            return /[\uD800-\uDFFF]/.test(s);
        }
    }

    private applyEmojiFromSearch(val: string) {
        const emoji = (val || '').trim();
        if (!emoji) return;
        if (this.activePickerIndex !== null && this.activePickerIndex >= 0) {
            this.emojis[this.activePickerIndex].emoji = emoji;
        }
        if (this.activeEmojiCircle) {
            this.activeEmojiCircle.textContent = emoji;
        }
        if (this.sharedPicker) this.sharedPicker.style.display = 'none';
        this.activePickerIndex = null;
        this.activeEmojiCircle = null;
    }

    private positionSharedPicker() {
        try {
            if (!this.sharedPicker || !this.activeEmojiCircle) return;
            const rect = this.activeEmojiCircle.getBoundingClientRect();
            const prevDisplay = this.sharedPicker.style.display;
            this.sharedPicker.style.display = 'block';
            this.sharedPicker.style.visibility = 'hidden';
            const pr = this.sharedPicker.getBoundingClientRect();
            let top = rect.bottom + 8;
            if (top + pr.height > window.innerHeight) {
                top = rect.top - pr.height - 8;
            }
            let left = rect.left;
            if (left + pr.width > window.innerWidth) {
                left = window.innerWidth - pr.width - 8;
            }
            if (left < 8) left = 8;
            this.sharedPicker.style.left = `${Math.round(left)}px`;
            this.sharedPicker.style.top = `${Math.round(top)}px`;
            this.sharedPicker.style.visibility = 'visible';
            this.sharedPicker.style.display = prevDisplay;
        } catch (error) {
            // ignore
        }
    }

    private createEmojiItem(emojiConfig: HabitCheckInEmoji, index: number): HTMLElement {
        const item = document.createElement('div');
        // store index on DOM and enable HTML5 drag
        item.dataset.index = String(index);
        item.setAttribute('draggable', 'true');
        item.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            padding: 12px 16px;
            background: var(--b3-theme-surface);
            border-radius: 12px;
            border: 1px solid var(--b3-theme-surface-lighter);
            position: relative;
            transition: all 0.2s ease;
            gap: 16px;
        `;

        // 添加悬停效果
        item.addEventListener('mouseenter', () => {
            item.style.borderColor = 'var(--b3-theme-primary-lighter)';
            item.style.backgroundColor = 'var(--b3-theme-surface-light)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.borderColor = 'var(--b3-theme-surface-lighter)';
            item.style.backgroundColor = 'var(--b3-theme-surface)';
        });

        // 拖拽句柄 (用于排序)
        const dragHandle = document.createElement('div');
        dragHandle.title = '拖动排序';
        dragHandle.style.cssText = `
            width: 28px; height: 28px; display:flex; align-items:center; justify-content:center; margin-right:8px; flex-shrink:0; cursor: grab; border-radius:6px; color:var(--b3-theme-on-surface-light);
        `;
        dragHandle.innerHTML = '<svg style="width:14px;height:14px;opacity:0.9;" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 6H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 18H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        // 插入到 item 前面
        item.appendChild(dragHandle);

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--text';
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.title = '删除';
        deleteBtn.style.cssText = `
            padding: 6px;
            width: 32px;
            height: 32px;
            border-radius: 6px;
            opacity: 0.6;
            transition: all 0.2s;
            flex-shrink: 0;
            color: var(--b3-theme-on-surface-light);
            margin-left: auto;
        `;

        // 至少保留一个选项
        if (this.emojis.length <= 1) {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.3';
            deleteBtn.style.cursor = 'not-allowed';
        } else {
            deleteBtn.addEventListener('mouseenter', () => {
                deleteBtn.style.opacity = '1';
                deleteBtn.style.background = 'var(--b3-theme-error-lighter)';
                deleteBtn.style.color = 'var(--b3-theme-error)';
            });

            deleteBtn.addEventListener('mouseleave', () => {
                deleteBtn.style.opacity = '0.6';
                deleteBtn.style.background = 'transparent';
                deleteBtn.style.color = 'var(--b3-theme-on-surface-light)';
            });
        }

        deleteBtn.addEventListener('click', () => {
            if (this.emojis.length > 1) {
                this.deleteEmoji(index);
            }
        });

        // Emoji选择器容器
        const emojiContainer = document.createElement('div');
        emojiContainer.style.cssText = 'position: relative;';

        // 当前emoji显示
        const emojiCircle = document.createElement('div');
        emojiCircle.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--b3-theme-surface-lighter);
            border: 2px solid var(--b3-theme-primary-lighter);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            cursor: pointer;
            transition: all 0.2s;
            flex-shrink: 0;
            user-select: none;
        `;

        emojiCircle.textContent = emojiConfig.emoji;

        emojiCircle.addEventListener('mouseenter', () => {
            emojiCircle.style.transform = 'scale(1.1)';
            emojiCircle.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        });

        emojiCircle.addEventListener('mouseleave', () => {
            emojiCircle.style.transform = 'scale(1)';
            emojiCircle.style.boxShadow = 'none';
        });

        // emojiCircle click toggles the shared picker visibility and positions it
        emojiCircle.addEventListener('click', (e) => {
            e.stopPropagation();
            // ensure shared picker initialized
            this.initSharedPicker();
            this.activePickerIndex = index;
            this.activeEmojiCircle = emojiCircle;
            if (!this.sharedPicker) return;
            const show = this.sharedPicker.style.display === 'none' || this.sharedPicker.style.display === '';
            if (show) {
                this.sharedPicker.style.display = 'block';
                this.positionSharedPicker();
            } else {
                this.sharedPicker.style.display = 'none';
                this.activePickerIndex = null;
                this.activeEmojiCircle = null;
            }
        });

        // No per-item picker is created; shared picker will be used instead

        emojiContainer.appendChild(emojiCircle);

        // 含义输入
        const meaningInput = document.createElement('input');
        meaningInput.type = 'text';
        meaningInput.className = 'b3-text-field';
        meaningInput.value = emojiConfig.meaning;
        meaningInput.placeholder = '输入含义说明...';
        meaningInput.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            font-size: 14px;
            transition: all 0.2s;
        `;

        meaningInput.addEventListener('mouseenter', () => {
            if (document.activeElement !== meaningInput) {
                meaningInput.style.border = '1px solid var(--b3-theme-surface-lighter)';
            }
        });

        meaningInput.addEventListener('mouseleave', () => {
            if (document.activeElement !== meaningInput) {
                meaningInput.style.border = '1px solid transparent';
            }
        });

        meaningInput.addEventListener('focus', () => {
            meaningInput.style.borderColor = 'var(--b3-theme-primary)';
            meaningInput.style.background = 'var(--b3-theme-background)';
        });

        meaningInput.addEventListener('blur', () => {
            meaningInput.style.borderColor = 'transparent';
            meaningInput.style.background = 'transparent';
        });

        meaningInput.addEventListener('input', (e) => {
            this.emojis[index].meaning = (e.target as HTMLInputElement).value;
        });

        // 如果该选项需要在打卡时弹窗备注
        const promptNoteWrap = document.createElement('label');
        promptNoteWrap.style.cssText = 'display:flex; align-items:center; gap:8px; margin-left:8px;';
        const promptNoteCheckbox = document.createElement('input');
        promptNoteCheckbox.type = 'checkbox';
        promptNoteCheckbox.checked = !!emojiConfig.promptNote;
        promptNoteCheckbox.addEventListener('change', () => {
            this.emojis[index].promptNote = (promptNoteCheckbox as HTMLInputElement).checked;
        });
        const promptNoteText = document.createElement('span');
        promptNoteText.textContent = '打卡时询问备注';
        promptNoteText.style.cssText = 'font-size: 12px; color:var(--b3-theme-on-surface-light);';
        promptNoteWrap.appendChild(promptNoteCheckbox);
        promptNoteWrap.appendChild(promptNoteText);

        // 是否认为是成功打卡
        const countsAsSuccessWrap = document.createElement('label');
        countsAsSuccessWrap.style.cssText = 'display:flex; align-items:center; gap:8px; margin-left:8px;';
        const countsAsSuccessCheckbox = document.createElement('input');
        countsAsSuccessCheckbox.type = 'checkbox';
        countsAsSuccessCheckbox.checked = emojiConfig.countsAsSuccess !== false; // 默认为true
        countsAsSuccessCheckbox.addEventListener('change', () => {
            this.emojis[index].countsAsSuccess = (countsAsSuccessCheckbox as HTMLInputElement).checked;
        });
        const countsAsSuccessText = document.createElement('span');
        countsAsSuccessText.textContent = '认为是成功打卡';
        countsAsSuccessText.style.cssText = 'font-size: 12px; color:var(--b3-theme-on-surface-light);';
        countsAsSuccessWrap.appendChild(countsAsSuccessCheckbox);
        countsAsSuccessWrap.appendChild(countsAsSuccessText);

        // 把 promptNote 插入到 item，放在含义输入后面
        item.appendChild(emojiContainer);

        // - 放置到 DOM 的同一位置，之后会加入拖拽事件
        item.appendChild(meaningInput);
        item.appendChild(promptNoteWrap);
        item.appendChild(countsAsSuccessWrap);
        item.appendChild(deleteBtn);

        // Drag events: support reordering by dragging an item
        const onDragStart = (ev: DragEvent) => {
            try {
                ev.dataTransfer?.setData('text/plain', String(index));
                if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
            } catch (e) {
                // ignore for older browsers
            }
            this.draggingIndex = index;
            // hide picker during drag to avoid z-index and focus issues
            if (this.sharedPicker) this.sharedPicker.style.display = 'none';
            item.style.opacity = '0.6';
            dragHandle.style.cursor = 'grabbing';
        };

        const onDragOver = (ev: DragEvent) => {
            ev.preventDefault(); // allow drop
            const rect = item.getBoundingClientRect();
            const y = ev.clientY || 0;
            this.dropBefore = y < (rect.top + rect.height / 2);
            item.style.borderTop = this.dropBefore ? '2px dashed var(--b3-theme-primary)' : '';
            item.style.borderBottom = !this.dropBefore ? '2px dashed var(--b3-theme-primary)' : '';
        };

        const onDragEnter = () => {
            item.style.opacity = '0.9';
        };

        const onDragLeave = () => {
            item.style.opacity = '1';
            item.style.borderTop = '';
            item.style.borderBottom = '';
        };

        const onDrop = (ev: DragEvent) => {
            ev.preventDefault();
            const data = ev.dataTransfer?.getData('text/plain');
            const fromIdx = data ? parseInt(data, 10) : (this.draggingIndex ?? -1);
            const toIdx = Number(item.dataset.index);
            if (!isNaN(fromIdx) && fromIdx >= 0 && !isNaN(toIdx) && fromIdx !== toIdx) {
                const insertAt = this.dropBefore ? toIdx : toIdx + 1;
                this.moveEmoji(fromIdx, insertAt);
                // re-render list after moving
                const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
                if (container) this.renderEmojiList(container);
            }
            this.draggingIndex = null;
        };

        const onDragEnd = () => {
            item.style.opacity = '1';
            dragHandle.style.cursor = 'grab';
            item.style.borderTop = '';
            item.style.borderBottom = '';
            this.draggingIndex = null;
        };

        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragover', onDragOver);
        item.addEventListener('dragenter', onDragEnter);
        item.addEventListener('dragleave', onDragLeave);
        item.addEventListener('drop', onDrop);
        item.addEventListener('dragend', onDragEnd);

        return item;
    }

    private moveEmoji(fromIndex: number, toIndex: number) {
        if (fromIndex < 0 || fromIndex >= this.emojis.length) return;
        if (toIndex < 0) toIndex = 0;
        if (toIndex > this.emojis.length) toIndex = this.emojis.length;

        const removed = this.emojis.splice(fromIndex, 1)[0];
        let insertAt = toIndex;
        if (fromIndex < toIndex) insertAt = toIndex - 1;
        this.emojis.splice(insertAt, 0, removed);

        // update activePickerIndex mapping so picker (if active) stays with the emoji
        if (this.activePickerIndex !== null) {
            if (this.activePickerIndex === fromIndex) {
                this.activePickerIndex = insertAt;
            } else if (fromIndex < this.activePickerIndex && this.activePickerIndex <= insertAt) {
                this.activePickerIndex = this.activePickerIndex - 1;
            } else if (insertAt <= this.activePickerIndex && this.activePickerIndex < fromIndex) {
                this.activePickerIndex = this.activePickerIndex + 1;
            }
        }
    }

    private addEmoji() {
        // 添加新的emoji选项
        this.emojis.push({
            emoji: '⭐',
            meaning: '新选项',
            promptNote: false,
            countsAsSuccess: true
        });

        // 重新渲染列表
        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (container) {
            this.renderEmojiList(container);
        }
    }

    private deleteEmoji(index: number) {
        if (this.emojis.length <= 1) {
            showMessage('至少需要保留一个打卡选项', 3000, 'error');
            return;
        }

        this.emojis.splice(index, 1);

        // 重新渲染列表
        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (container) {
            this.renderEmojiList(container);
        }
    }

    private resetToDefault() {
        this.emojis = [
            { emoji: '✅', meaning: '完成', promptNote: false, countsAsSuccess: true },
            { emoji: '❌', meaning: '未完成', promptNote: false, countsAsSuccess: false },
            { emoji: '⭕️', meaning: '部分完成', promptNote: false, countsAsSuccess: true }
        ];

        // 重新渲染列表
        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (container) {
            this.renderEmojiList(container);
        }

        showMessage('已恢复默认设置');
    }

    private async handleSave() {
        // 验证数据
        for (let i = 0; i < this.emojis.length; i++) {
            const emoji = this.emojis[i];

            if (!emoji.emoji || emoji.emoji.trim() === '') {
                showMessage(`第${i + 1}个选项的Emoji不能为空`, 3000, 'error');
                return;
            }

            if (!emoji.meaning || emoji.meaning.trim() === '') {
                showMessage(`第${i + 1}个选项的含义不能为空`, 3000, 'error');
                return;
            }

            // no statistical value validation required anymore

            // 去除首尾空格
            emoji.emoji = emoji.emoji.trim();
            emoji.meaning = emoji.meaning.trim();
        }

        // 检查是否有重复的emoji
        const emojiSet = new Set(this.emojis.map(e => e.emoji));
        if (emojiSet.size !== this.emojis.length) {
            showMessage('存在重复的Emoji,请修改', 3000, 'error');
            return;
        }

        try {
            await this.onSave(this.emojis);
            showMessage('保存成功');
            this.dialog.destroy();
        } catch (error) {
            console.error('保存打卡选项失败:', error);
            showMessage('保存失败', 3000, 'error');
        }
    }

    private clearAllPickers() {
        if (this.sharedPicker) {
            try {
                try {
                    const searchInput: HTMLInputElement | null = this.sharedPicker.shadowRoot?.querySelector('input') as HTMLInputElement || this.sharedPicker.querySelector('input') as HTMLInputElement;
                    if (searchInput && this.sharedEnterHandler) {
                        searchInput.removeEventListener('keydown', this.sharedEnterHandler);
                    }
                } catch (e) {
                    // ignore
                }
                if (this.sharedCloseHandler) {
                    document.removeEventListener('click', this.sharedCloseHandler);
                }
                if (this.sharedResizeHandler) {
                    window.removeEventListener('resize', this.sharedResizeHandler);
                }
                if (this.sharedScrollHandler) {
                    window.removeEventListener('scroll', this.sharedScrollHandler, true);
                }
                if (this.sharedPicker && (this.sharedPicker as any).remove) (this.sharedPicker as any).remove();
            } catch (error) {
                console.error('清理 emoji picker 失败', error);
            }
            this.sharedPicker = null;
            this.sharedEnterHandler = undefined;
            this.activeEmojiCircle = null;
            this.activePickerIndex = null;
        }
    }
}
