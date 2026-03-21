import { Dialog, openEmoji, showMessage, confirm } from "siyuan";
import { Habit, HabitCheckInEmoji } from "./HabitPanel";
import { i18n } from "../pluginInstance";

const DEFAULT_EMOJIS: HabitCheckInEmoji[] = [
    { emoji: "✅", meaning: "完成", promptNote: false, countsAsSuccess: true },
    { emoji: "❌", meaning: "未完成", promptNote: false, countsAsSuccess: false },
    { emoji: "⭐️", meaning: "部分完成", promptNote: false, countsAsSuccess: true }
];

export class HabitCheckInEmojiDialog {
    private dialog!: Dialog;
    private readonly habit: Habit;
    private readonly onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>;
    private emojis: HabitCheckInEmoji[];
    private groups: string[];
    private draggingIndex: number | null = null;
    private dropBefore = false;
    private shouldScrollToBottom = false;

    constructor(habit: Habit, onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>) {
        this.habit = habit;
        this.onSave = onSave;
        this.emojis = JSON.parse(JSON.stringify(habit.checkInEmojis || DEFAULT_EMOJIS));
        this.groups = this.collectGroups();
    }

    show() {
        const titleTemplate = i18n("editCheckInOptionsTitle") || "编辑打卡选项 - ${title}";
        this.dialog = new Dialog({
            title: titleTemplate.replace("${title}", this.habit.title),
            content: '<div id="checkInEmojiContainer"></div>',
            width: "600px",
            height: "700px"
        });

        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (!container) return;
        this.renderEmojiList(container);
    }

    private lastScrollTop = 0;

    private renderEmojiList(container: HTMLElement) {
        container.innerHTML = "";
        container.style.cssText = "padding: 12px; display: flex; flex-direction: column; height: 100%;";

        container.appendChild(this.createTopBar());
        container.appendChild(this.createGroupStrip());

        const listContainer = document.createElement("div");
        listContainer.className = "b3-dialog__content";
        listContainer.id = "emojiListContainer";
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
            listContainer.appendChild(this.createEmojiItem(emojiConfig, index));
        });
        if (this.shouldScrollToBottom) {
            this.shouldScrollToBottom = false;
            requestAnimationFrame(() => {
                listContainer.scrollTop = listContainer.scrollHeight;
                this.lastScrollTop = listContainer.scrollHeight;
            });
        } else {
            requestAnimationFrame(() => {
                listContainer.scrollTop = this.lastScrollTop;
            });
        }

        // 监听滚动事件保存位置
        listContainer.addEventListener("scroll", () => {
            this.lastScrollTop = listContainer.scrollTop;
        });

        container.appendChild(listContainer);
        container.appendChild(this.createActionBar());
    }

    private createTopBar() {
        const bar = document.createElement("div");
        bar.style.cssText = "display:flex; align-items:center; justify-content:flex-start; gap:8px; margin-bottom: 8px;";
        const label = document.createElement("label");
        label.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer;";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!this.habit.hideCheckedToday;
        checkbox.addEventListener("change", () => {
            this.habit.hideCheckedToday = checkbox.checked;
        });

        const text = document.createElement("span");
        text.textContent = i18n("habitHideCheckedToday") || "今天已打卡的选项不显示在菜单中";

        label.appendChild(checkbox);
        label.appendChild(text);
        bar.appendChild(label);

        return bar;
    }

    private createGroupStrip() {
        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-bottom: 8px;";

        const addGroupBox = this.createAddGroupBox();
        const headerRow = document.createElement("div");
        headerRow.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom: 8px;";
        const title = document.createElement("div");
        title.style.cssText = "font-size: 12px; color: var(--b3-theme-on-surface-light);";
        title.textContent = i18n("habitCheckInGroupHint") || "分组（可将打卡项拖入分组）";
        headerRow.appendChild(title);
        headerRow.appendChild(addGroupBox);
        wrap.appendChild(headerRow);

        const groupsScroller = document.createElement("div");
        groupsScroller.style.cssText = "overflow-x: auto; overflow-y: hidden; width: 100%;";
        const groupsRow = document.createElement("div");
        groupsRow.style.cssText = "display:flex; flex-wrap: nowrap; gap: 8px; width: max-content; min-width: 100%;";
        this.groups.forEach(groupName => {
            groupsRow.appendChild(this.createGroupDropZone(groupName, groupName));
        });
        groupsScroller.appendChild(groupsRow);

        wrap.appendChild(groupsScroller);
        return wrap;
    }

    private createGroupDropZone(label: string, groupName: string) {
        const zone = document.createElement("div");
        zone.style.cssText = `
            min-width: 180px;
            width: 180px;
            max-width: 100%;
            border: 1px dashed var(--b3-theme-primary-lighter);
            border-radius: 8px;
            padding: 8px 10px;
            background: var(--b3-theme-background);
            display: flex;
            align-items: stretch;
            flex-direction: column;
            gap: 8px;
            box-sizing: border-box;
        `;

        const header = document.createElement("div");
        header.style.cssText = "display:flex; align-items:center; gap:8px;";
        const text = document.createElement("span");
        text.style.cssText = "font-size: 12px; white-space: nowrap; font-weight: 600;";
        text.textContent = label;
        header.appendChild(text);

        const members = this.emojis.filter(item => (item.group || "") === groupName);
        const count = document.createElement("span");
        count.style.cssText = "font-size: 11px; color: var(--b3-theme-on-surface-light);";
        count.textContent = `(${members.length})`;
        header.appendChild(count);

        const renameBtn = document.createElement("button");
        renameBtn.className = "b3-button b3-button--text";
        renameBtn.style.cssText = "padding: 2px 4px; margin-left: auto;";
        renameBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
        renameBtn.title = i18n("renameGroup") || "重命名分组";
        renameBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.renameGroup(groupName).catch((error) => {
                console.error("重命名分组失败:", error);
            });
        });

        const delBtn = document.createElement("button");
        delBtn.className = "b3-button b3-button--text";
        delBtn.style.cssText = "padding: 2px 4px;";
        delBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        delBtn.title = i18n("deleteGroup") || "删除分组";
        delBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.deleteGroup(groupName);
        });

        header.appendChild(renameBtn);
        header.appendChild(delBtn);
        zone.appendChild(header);

        const body = document.createElement("div");
        body.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; min-height: 24px;";
        if (members.length) {
            members.forEach((item) => {
                const chip = document.createElement("span");
                chip.style.cssText = "font-size: 11px; padding: 2px 24px 2px 6px; border-radius: 999px; background: var(--b3-theme-surface-lighter); position: relative;";
                chip.textContent = `${item.emoji} ${item.meaning}`;

                const removeBtn = document.createElement("button");
                removeBtn.className = "b3-button b3-button--text";
                removeBtn.style.cssText = "position:absolute; right:2px; top:50%; transform:translateY(-50%); width:16px; height:16px; min-width:16px; padding:0; border-radius:50%; display:none; color:var(--b3-theme-on-surface-light);";
                removeBtn.title = i18n("removeFromGroup") || "移出分组";
                removeBtn.textContent = "×";
                removeBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    delete item.group;
                    const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
                    if (container) this.renderEmojiList(container);
                });
                chip.addEventListener("mouseenter", () => {
                    removeBtn.style.display = "inline-flex";
                });
                chip.addEventListener("mouseleave", () => {
                    removeBtn.style.display = "none";
                });
                chip.appendChild(removeBtn);
                body.appendChild(chip);
            });
        } else {
            const emptyTip = document.createElement("span");
            emptyTip.style.cssText = "font-size: 11px; color: var(--b3-theme-on-surface-light);";
            emptyTip.textContent = i18n("dragCheckInItem") || "拖入打卡项";
            body.appendChild(emptyTip);
        }
        zone.appendChild(body);

        zone.addEventListener("dragover", (event) => {
            event.preventDefault();
            zone.style.borderColor = "var(--b3-theme-primary)";
            zone.style.background = "var(--b3-theme-primary-lightest)";
        });
        zone.addEventListener("dragleave", () => {
            zone.style.borderColor = "var(--b3-theme-primary-lighter)";
            zone.style.background = "var(--b3-theme-background)";
        });
        zone.addEventListener("drop", (event) => {
            event.preventDefault();
            zone.style.borderColor = "var(--b3-theme-primary-lighter)";
            zone.style.background = "var(--b3-theme-background)";
            const data = event.dataTransfer?.getData("text/plain");
            const fromIdx = data ? parseInt(data, 10) : (this.draggingIndex ?? -1);
            if (Number.isNaN(fromIdx) || fromIdx < 0 || fromIdx >= this.emojis.length) return;
            this.emojis[fromIdx].group = groupName || undefined;
            const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
            if (container) this.renderEmojiList(container);
        });

        return zone;
    }

    private createAddGroupBox() {
        const addBox = document.createElement("button");
        addBox.className = "b3-button b3-button--outline";
        addBox.style.cssText = "display: inline-flex; align-items: center; gap: 4px;";
        addBox.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n("addCheckInGroup") || "添加打卡分组"}`;
        addBox.addEventListener("click", () => {
            this.addGroup().catch((error) => {
                console.error("添加分组失败:", error);
            });
        });
        return addBox;
    }

    private createActionBar() {
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "b3-dialog__action";
        buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap;";

        const addBtn = document.createElement("button");
        addBtn.className = "b3-button b3-button--outline";
        addBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n("addOption") || "添加选项"}`;
        addBtn.addEventListener("click", () => this.addEmoji());

        const rightButtons = document.createElement("div");
        rightButtons.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap;";

        const resetBtn = document.createElement("button");
        resetBtn.className = "b3-button";
        resetBtn.textContent = i18n("reset") || "恢复默认";
        resetBtn.addEventListener("click", () => this.resetToDefault());

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "b3-button";
        cancelBtn.textContent = i18n("cancel") || "取消";
        cancelBtn.addEventListener("click", () => this.dialog.destroy());

        const saveBtn = document.createElement("button");
        saveBtn.className = "b3-button b3-button--primary";
        saveBtn.textContent = i18n("save") || "保存";
        saveBtn.addEventListener("click", async () => {
            await this.handleSave();
        });

        rightButtons.appendChild(resetBtn);
        rightButtons.appendChild(cancelBtn);
        rightButtons.appendChild(saveBtn);

        buttonContainer.appendChild(addBtn);
        buttonContainer.appendChild(rightButtons);
        return buttonContainer;
    }

    private createEmojiItem(emojiConfig: HabitCheckInEmoji, index: number): HTMLElement {
        const item = document.createElement("div");
        item.dataset.index = String(index);
        item.setAttribute("draggable", "true");
        item.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            flex-wrap: wrap;
            padding: 12px 16px 44px 16px;
            background: var(--b3-theme-surface);
            border-radius: 12px;
            border: 1px solid var(--b3-theme-surface-lighter);
            position: relative;
            transition: all 0.2s ease;
            gap: 10px;
            box-sizing: border-box;
        `;

        item.addEventListener("mouseenter", () => {
            item.style.borderColor = "var(--b3-theme-primary-lighter)";
            item.style.backgroundColor = "var(--b3-theme-surface-light)";
        });

        item.addEventListener("mouseleave", () => {
            item.style.borderColor = "var(--b3-theme-surface-lighter)";
            item.style.backgroundColor = "var(--b3-theme-surface)";
        });

        item.title = i18n("dragToSortAndGroup") || "拖动可排序，拖到上方分组可归组";

        const emojiCircle = document.createElement("div");
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
        emojiCircle.addEventListener("mouseenter", () => {
            emojiCircle.style.transform = "scale(1.1)";
            emojiCircle.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.1)";
        });
        emojiCircle.addEventListener("mouseleave", () => {
            emojiCircle.style.transform = "scale(1)";
            emojiCircle.style.boxShadow = "none";
        });
        emojiCircle.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openBuiltInEmojiPicker(emojiCircle, index);
        });

        const meaningInput = document.createElement("input");
        meaningInput.type = "text";
        meaningInput.className = "b3-text-field";
        meaningInput.value = emojiConfig.meaning;
        meaningInput.placeholder = i18n("checkInMeaningPlaceholder") || "输入含义说明...";
        meaningInput.style.cssText = `
            flex: 1 1 180px;
            min-width: 140px;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            font-size: 14px;
            transition: all 0.2s;
        `;
        meaningInput.addEventListener("mouseenter", () => {
            if (document.activeElement !== meaningInput) {
                meaningInput.style.border = "1px solid var(--b3-theme-surface-lighter)";
            }
        });
        meaningInput.addEventListener("mouseleave", () => {
            if (document.activeElement !== meaningInput) {
                meaningInput.style.border = "1px solid transparent";
            }
        });
        meaningInput.addEventListener("focus", () => {
            meaningInput.style.borderColor = "var(--b3-theme-primary)";
            meaningInput.style.background = "var(--b3-theme-background)";
        });
        meaningInput.addEventListener("blur", () => {
            meaningInput.style.borderColor = "transparent";
            meaningInput.style.background = "transparent";
        });
        meaningInput.addEventListener("input", (event) => {
            this.emojis[index].meaning = (event.target as HTMLInputElement).value;
        });
        meaningInput.addEventListener("mousedown", () => {
            item.setAttribute("draggable", "false");
        });
        const restoreDrag = () => {
            item.setAttribute("draggable", "true");
        };
        meaningInput.addEventListener("mouseup", restoreDrag);
        meaningInput.addEventListener("mouseleave", restoreDrag);
        meaningInput.addEventListener("blur", restoreDrag);

        const promptNoteWrap = document.createElement("label");
        promptNoteWrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-left:0; white-space: nowrap;";
        const promptNoteCheckbox = document.createElement("input");
        promptNoteCheckbox.type = "checkbox";
        promptNoteCheckbox.checked = !!emojiConfig.promptNote;
        promptNoteCheckbox.addEventListener("change", () => {
            this.emojis[index].promptNote = promptNoteCheckbox.checked;
        });
        const promptNoteText = document.createElement("span");
        promptNoteText.textContent = i18n("checkInPromptNote") || "打卡时询问备注";
        promptNoteText.style.cssText = "font-size: 12px; color:var(--b3-theme-on-surface-light);";
        promptNoteWrap.appendChild(promptNoteCheckbox);
        promptNoteWrap.appendChild(promptNoteText);

        const countsAsSuccessWrap = document.createElement("label");
        countsAsSuccessWrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-left:0; white-space: nowrap;";
        const countsAsSuccessCheckbox = document.createElement("input");
        countsAsSuccessCheckbox.type = "checkbox";
        countsAsSuccessCheckbox.checked = emojiConfig.countsAsSuccess !== false;
        countsAsSuccessCheckbox.addEventListener("change", () => {
            this.emojis[index].countsAsSuccess = countsAsSuccessCheckbox.checked;
        });
        const countsAsSuccessText = document.createElement("span");
        countsAsSuccessText.textContent = i18n("habitCountsAsSuccess") || "认为是成功打卡";
        countsAsSuccessText.style.cssText = "font-size: 12px; color:var(--b3-theme-on-surface-light);";
        countsAsSuccessWrap.appendChild(countsAsSuccessCheckbox);
        countsAsSuccessWrap.appendChild(countsAsSuccessText);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "b3-button b3-button--text";
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.title = i18n("delete") || "删除";
        deleteBtn.style.cssText = `
            padding: 6px;
            width: 32px;
            height: 32px;
            border-radius: 6px;
            opacity: 0.6;
            transition: all 0.2s;
            flex-shrink: 0;
            color: var(--b3-theme-on-surface-light);
            position: absolute;
            right: 10px;
            bottom: 8px;
        `;

        if (this.emojis.length <= 1) {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = "0.3";
            deleteBtn.style.cursor = "not-allowed";
        } else {
            deleteBtn.addEventListener("mouseenter", () => {
                deleteBtn.style.opacity = "1";
                deleteBtn.style.background = "var(--b3-theme-error-lighter)";
                deleteBtn.style.color = "var(--b3-theme-error)";
            });
            deleteBtn.addEventListener("mouseleave", () => {
                deleteBtn.style.opacity = "0.6";
                deleteBtn.style.background = "transparent";
                deleteBtn.style.color = "var(--b3-theme-on-surface-light)";
            });
            deleteBtn.addEventListener("click", () => this.confirmDeleteEmoji(index));
        }

        item.appendChild(emojiCircle);
        item.appendChild(meaningInput);
        const optionRow = document.createElement("div");
        optionRow.style.cssText = "display:flex; align-items:center; gap:10px; flex-wrap: wrap; width: 100%;";
        optionRow.appendChild(promptNoteWrap);
        optionRow.appendChild(countsAsSuccessWrap);
        item.appendChild(optionRow);
        item.appendChild(deleteBtn);

        const onDragStart = (event: DragEvent) => {
            const target = event.target as HTMLElement | null;
            // 在可编辑/可点击控件上操作时，不触发拖拽，避免影响输入框划选文本
            if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) {
                event.preventDefault();
                this.draggingIndex = null;
                return;
            }
            try {
                event.dataTransfer?.setData("text/plain", String(index));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            } catch (error) {
                // ignore
            }
            this.draggingIndex = index;
            item.style.opacity = "0.6";
        };

        const onDragOver = (event: DragEvent) => {
            event.preventDefault();
            const rect = item.getBoundingClientRect();
            this.dropBefore = (event.clientY || 0) < rect.top + rect.height / 2;
            item.style.borderTop = this.dropBefore ? "2px dashed var(--b3-theme-primary)" : "";
            item.style.borderBottom = this.dropBefore ? "" : "2px dashed var(--b3-theme-primary)";
        };

        const onDragEnter = () => {
            item.style.opacity = "0.9";
        };

        const onDragLeave = () => {
            item.style.opacity = "1";
            item.style.borderTop = "";
            item.style.borderBottom = "";
        };

        const onDrop = (event: DragEvent) => {
            event.preventDefault();
            const data = event.dataTransfer?.getData("text/plain");
            const fromIdx = data ? parseInt(data, 10) : (this.draggingIndex ?? -1);
            const toIdx = Number(item.dataset.index);

            if (!Number.isNaN(fromIdx) && fromIdx >= 0 && !Number.isNaN(toIdx) && fromIdx !== toIdx) {
                this.moveEmoji(fromIdx, this.dropBefore ? toIdx : toIdx + 1);
                const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
                if (container) this.renderEmojiList(container);
            }

            this.draggingIndex = null;
        };

        const onDragEnd = () => {
            item.style.opacity = "1";
            item.style.borderTop = "";
            item.style.borderBottom = "";
            this.draggingIndex = null;
        };

        item.addEventListener("dragstart", onDragStart);
        item.addEventListener("dragover", onDragOver);
        item.addEventListener("dragenter", onDragEnter);
        item.addEventListener("dragleave", onDragLeave);
        item.addEventListener("drop", onDrop);
        item.addEventListener("dragend", onDragEnd);

        return item;
    }

    private openBuiltInEmojiPicker(target: HTMLElement, index: number) {
        const rect = target.getBoundingClientRect();
        openEmoji({
            hideDynamicIcon: true,
            hideCustomIcon: true,
            position: {
                x: rect.left,
                y: rect.bottom
            },
            selectedCB: (emojiCode: string) => {
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                const emoji = String.fromCodePoint(...codePoints);
                this.emojis[index].emoji = emoji;
                target.textContent = emoji;
            }
        });
    }

    private moveEmoji(fromIndex: number, toIndex: number) {
        if (fromIndex < 0 || fromIndex >= this.emojis.length) return;
        if (toIndex < 0) toIndex = 0;
        if (toIndex > this.emojis.length) toIndex = this.emojis.length;

        const [removed] = this.emojis.splice(fromIndex, 1);
        const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
        this.emojis.splice(insertAt, 0, removed);
    }

    private addEmoji() {
        this.emojis.push({
            emoji: "⭐️",
            meaning: i18n("newOption") || "新选项",
            group: undefined,
            promptNote: false,
            countsAsSuccess: true
        });
        this.shouldScrollToBottom = true;

        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private deleteEmoji(index: number) {
        if (this.emojis.length <= 1) {
            showMessage(i18n("atLeastOneCheckInOption") || "至少需要保留一个打卡选项", 3000, "error");
            return;
        }

        this.emojis.splice(index, 1);
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private confirmDeleteEmoji(index: number) {
        const emojiItem = this.emojis[index];
        if (!emojiItem) return;

        const title = i18n("deleteCheckInOptionTitle") || "删除打卡项";
        const content = (i18n("confirmDeleteCheckInOption") || "确定要删除打卡项「${emoji} ${meaning}」吗？")
            .replace("${emoji}", emojiItem.emoji || "")
            .replace("${meaning}", emojiItem.meaning || "");

        confirm(
            title,
            content,
            async () => {
                this.deleteEmoji(index);
            },
            async () => {
                // 用户取消时无需处理
            }
        );
    }

    private resetToDefault() {
        this.emojis = JSON.parse(JSON.stringify(DEFAULT_EMOJIS));
        this.groups = this.collectGroups();
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
        showMessage(i18n("resetToDefaultSuccess") || "已恢复默认设置");
    }

    private async handleSave() {
        for (let i = 0; i < this.emojis.length; i++) {
            const emoji = this.emojis[i];

            if (!emoji.emoji || emoji.emoji.trim() === "") {
                showMessage((i18n("checkInEmojiEmptyAt") || "第 ${index} 个选项的 Emoji 不能为空").replace("${index}", String(i + 1)), 3000, "error");
                return;
            }

            if (!emoji.meaning || emoji.meaning.trim() === "") {
                showMessage((i18n("checkInMeaningEmptyAt") || "第 ${index} 个选项的含义不能为空").replace("${index}", String(i + 1)), 3000, "error");
                return;
            }

            emoji.emoji = emoji.emoji.trim();
            emoji.meaning = emoji.meaning.trim();
            if (emoji.group) {
                emoji.group = emoji.group.trim();
                if (!emoji.group) {
                    delete emoji.group;
                }
            }
        }


        try {
            await this.onSave(this.emojis);
            showMessage(i18n("saveSuccess") || "保存成功");
            this.dialog.destroy();
        } catch (error) {
            console.error("保存打卡选项失败:", error);
            showMessage(i18n("saveFailed") || "保存失败", 3000, "error");
        }
    }

    private collectGroups(): string[] {
        const groupSet = new Set<string>();
        this.emojis.forEach(item => {
            const groupName = this.normalizeGroupName(item.group || "");
            if (groupName) {
                item.group = groupName;
                groupSet.add(groupName);
            } else if (item.group) {
                delete item.group;
            }
        });
        return Array.from(groupSet);
    }

    private normalizeGroupName(name: string): string {
        return (name || "").trim().replace(/\s+/g, " ");
    }

    private async addGroup() {
        const input = await this.openGroupNameDialog(i18n("addCheckInGroup") || "添加打卡分组", "");
        if (input === null) return;
        const groupName = this.normalizeGroupName(input);
        if (!groupName) {
            showMessage(i18n("groupNameRequired") || "分组名不能为空", 3000, "error");
            return;
        }
        if (this.groups.includes(groupName)) {
            showMessage(i18n("groupNameDuplicateNotAllowed") || "分组名已存在，不支持重名", 3000, "error");
            return;
        }
        this.groups.push(groupName);
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private async renameGroup(oldName: string) {
        const input = await this.openGroupNameDialog(i18n("renameCheckInGroup") || "重命名打卡分组", oldName);
        if (input === null) return;
        const newName = this.normalizeGroupName(input);
        if (!newName) {
            showMessage(i18n("groupNameRequired") || "分组名不能为空", 3000, "error");
            return;
        }
        if (newName !== oldName && this.groups.includes(newName)) {
            showMessage(i18n("groupNameDuplicateNotAllowed") || "分组名已存在，不支持重名", 3000, "error");
            return;
        }

        this.groups = this.groups.map(group => group === oldName ? newName : group);
        this.emojis.forEach(item => {
            if ((item.group || "") === oldName) {
                item.group = newName;
            }
        });
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private deleteGroup(groupName: string) {
        this.groups = this.groups.filter(group => group !== groupName);
        this.emojis.forEach(item => {
            if ((item.group || "") === groupName) {
                delete item.group;
            }
        });
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private openGroupNameDialog(title: string, defaultValue: string): Promise<string | null> {
        return new Promise((resolve) => {
            let resolved = false;
            const inputId = `__habit_group_name_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const dialog = new Dialog({
                title,
                content: `<div class="b3-dialog__content" style="padding:16px;">
                    <input id="${inputId}" class="b3-text-field" type="text" placeholder="${i18n("pleaseEnterGroupName") || "请输入分组名称"}" value="${(defaultValue || "").replace(/"/g, "&quot;")}" style="width:100%;" />
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">${i18n("cancel") || "取消"}</button>
                    <div class="fn__space"></div>
                    <button class="b3-button b3-button--text" id="${inputId}_ok">${i18n("confirm") || "确定"}</button>
                </div>`,
                width: "420px",
                height: "170px",
                destroyCallback: () => {
                    if (!resolved) {
                        resolved = true;
                        resolve(null);
                    }
                }
            });

            const inputEl = dialog.element.querySelector(`#${inputId}`) as HTMLInputElement | null;
            const cancelBtn = dialog.element.querySelector(".b3-button.b3-button--cancel") as HTMLButtonElement | null;
            const okBtn = dialog.element.querySelector(`#${inputId}_ok`) as HTMLButtonElement | null;
            if (inputEl) {
                inputEl.focus();
                inputEl.select();
                inputEl.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        okBtn?.click();
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelBtn?.click();
                    }
                });
            }

            okBtn?.addEventListener("click", () => {
                if (resolved) return;
                resolved = true;
                const value = inputEl?.value ?? "";
                dialog.destroy();
                resolve(value);
            });
            cancelBtn?.addEventListener("click", () => {
                if (resolved) return;
                resolved = true;
                dialog.destroy();
                resolve(null);
            });
        });
    }
}
