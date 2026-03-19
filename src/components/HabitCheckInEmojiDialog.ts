import { Dialog, openEmoji, showMessage } from "siyuan";
import { Habit, HabitCheckInEmoji } from "./HabitPanel";

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
    private draggingIndex: number | null = null;
    private dropBefore = false;

    constructor(habit: Habit, onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>) {
        this.habit = habit;
        this.onSave = onSave;
        this.emojis = JSON.parse(JSON.stringify(habit.checkInEmojis || DEFAULT_EMOJIS));
    }

    show() {
        this.dialog = new Dialog({
            title: `编辑打卡选项 - ${this.habit.title}`,
            content: '<div id="checkInEmojiContainer"></div>',
            width: "600px",
            height: "700px"
        });

        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (!container) return;
        this.renderEmojiList(container);
    }

    private renderEmojiList(container: HTMLElement) {
        container.innerHTML = "";
        container.style.cssText = "padding: 20px; display: flex; flex-direction: column; height: 100%;";

        container.appendChild(this.createInfoCard());
        container.appendChild(this.createDescriptionCard());

        const listContainer = document.createElement("div");
        listContainer.className = "b3-dialog__content";
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

        container.appendChild(listContainer);
        container.appendChild(this.createActionBar());
    }

    private createInfoCard() {
        const card = document.createElement("div");
        card.style.cssText = this.getCardStyle();

        const label = document.createElement("label");
        label.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer;";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!this.habit.hideCheckedToday;
        checkbox.addEventListener("change", () => {
            this.habit.hideCheckedToday = checkbox.checked;
        });

        const text = document.createElement("span");
        text.textContent = "今天已打卡的选项不显示在菜单中";

        label.appendChild(checkbox);
        label.appendChild(text);
        card.appendChild(label);

        return card;
    }

    private createDescriptionCard() {
        const card = document.createElement("div");
        card.style.cssText = this.getCardStyle();
        card.textContent = "配置打卡时可选择的 Emoji 选项，每个选项都可以设置含义，以及是否在打卡时提示填写备注。";
        return card;
    }

    private createActionBar() {
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "b3-dialog__action";
        buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: space-between;";

        const addBtn = document.createElement("button");
        addBtn.className = "b3-button b3-button--outline";
        addBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> 添加选项';
        addBtn.addEventListener("click", () => this.addEmoji());

        const rightButtons = document.createElement("div");
        rightButtons.style.cssText = "display: flex; gap: 8px;";

        const resetBtn = document.createElement("button");
        resetBtn.className = "b3-button";
        resetBtn.textContent = "恢复默认";
        resetBtn.addEventListener("click", () => this.resetToDefault());

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "b3-button";
        cancelBtn.textContent = "取消";
        cancelBtn.addEventListener("click", () => this.dialog.destroy());

        const saveBtn = document.createElement("button");
        saveBtn.className = "b3-button b3-button--primary";
        saveBtn.textContent = "保存";
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
            padding: 12px 16px;
            background: var(--b3-theme-surface);
            border-radius: 12px;
            border: 1px solid var(--b3-theme-surface-lighter);
            position: relative;
            transition: all 0.2s ease;
            gap: 16px;
        `;

        item.addEventListener("mouseenter", () => {
            item.style.borderColor = "var(--b3-theme-primary-lighter)";
            item.style.backgroundColor = "var(--b3-theme-surface-light)";
        });

        item.addEventListener("mouseleave", () => {
            item.style.borderColor = "var(--b3-theme-surface-lighter)";
            item.style.backgroundColor = "var(--b3-theme-surface)";
        });

        const dragHandle = document.createElement("div");
        dragHandle.title = "拖动排序";
        dragHandle.style.cssText = "width: 28px; height: 28px; display:flex; align-items:center; justify-content:center; margin-right:8px; flex-shrink:0; cursor: grab; border-radius:6px; color:var(--b3-theme-on-surface-light);";
        dragHandle.innerHTML = '<svg style="width:14px;height:14px;opacity:0.9;" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 6H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 18H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        item.appendChild(dragHandle);

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
        meaningInput.placeholder = "输入含义说明...";
        meaningInput.style.cssText = `
            flex: 1;
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

        const promptNoteWrap = document.createElement("label");
        promptNoteWrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-left:8px;";
        const promptNoteCheckbox = document.createElement("input");
        promptNoteCheckbox.type = "checkbox";
        promptNoteCheckbox.checked = !!emojiConfig.promptNote;
        promptNoteCheckbox.addEventListener("change", () => {
            this.emojis[index].promptNote = promptNoteCheckbox.checked;
        });
        const promptNoteText = document.createElement("span");
        promptNoteText.textContent = "打卡时询问备注";
        promptNoteText.style.cssText = "font-size: 12px; color:var(--b3-theme-on-surface-light);";
        promptNoteWrap.appendChild(promptNoteCheckbox);
        promptNoteWrap.appendChild(promptNoteText);

        const countsAsSuccessWrap = document.createElement("label");
        countsAsSuccessWrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-left:8px;";
        const countsAsSuccessCheckbox = document.createElement("input");
        countsAsSuccessCheckbox.type = "checkbox";
        countsAsSuccessCheckbox.checked = emojiConfig.countsAsSuccess !== false;
        countsAsSuccessCheckbox.addEventListener("change", () => {
            this.emojis[index].countsAsSuccess = countsAsSuccessCheckbox.checked;
        });
        const countsAsSuccessText = document.createElement("span");
        countsAsSuccessText.textContent = "认为是成功打卡";
        countsAsSuccessText.style.cssText = "font-size: 12px; color:var(--b3-theme-on-surface-light);";
        countsAsSuccessWrap.appendChild(countsAsSuccessCheckbox);
        countsAsSuccessWrap.appendChild(countsAsSuccessText);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "b3-button b3-button--text";
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.title = "删除";
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
            deleteBtn.addEventListener("click", () => this.deleteEmoji(index));
        }

        item.appendChild(emojiCircle);
        item.appendChild(meaningInput);
        item.appendChild(promptNoteWrap);
        item.appendChild(countsAsSuccessWrap);
        item.appendChild(deleteBtn);

        const onDragStart = (event: DragEvent) => {
            try {
                event.dataTransfer?.setData("text/plain", String(index));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            } catch (error) {
                // ignore
            }
            this.draggingIndex = index;
            item.style.opacity = "0.6";
            dragHandle.style.cursor = "grabbing";
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
            dragHandle.style.cursor = "grab";
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
            meaning: "新选项",
            promptNote: false,
            countsAsSuccess: true
        });

        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private deleteEmoji(index: number) {
        if (this.emojis.length <= 1) {
            showMessage("至少需要保留一个打卡选项", 3000, "error");
            return;
        }

        this.emojis.splice(index, 1);
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
    }

    private resetToDefault() {
        this.emojis = JSON.parse(JSON.stringify(DEFAULT_EMOJIS));
        const container = this.dialog.element.querySelector("#checkInEmojiContainer") as HTMLElement | null;
        if (container) this.renderEmojiList(container);
        showMessage("已恢复默认设置");
    }

    private async handleSave() {
        for (let i = 0; i < this.emojis.length; i++) {
            const emoji = this.emojis[i];

            if (!emoji.emoji || emoji.emoji.trim() === "") {
                showMessage(`第 ${i + 1} 个选项的 Emoji 不能为空`, 3000, "error");
                return;
            }

            if (!emoji.meaning || emoji.meaning.trim() === "") {
                showMessage(`第 ${i + 1} 个选项的含义不能为空`, 3000, "error");
                return;
            }

            emoji.emoji = emoji.emoji.trim();
            emoji.meaning = emoji.meaning.trim();
        }

        const emojiSet = new Set(this.emojis.map(item => item.emoji));
        if (emojiSet.size !== this.emojis.length) {
            showMessage("存在重复的 Emoji，请修改", 3000, "error");
            return;
        }

        try {
            await this.onSave(this.emojis);
            showMessage("保存成功");
            this.dialog.destroy();
        } catch (error) {
            console.error("保存打卡选项失败:", error);
            showMessage("保存失败", 3000, "error");
        }
    }

    private getCardStyle() {
        return `
            margin-bottom: 20px;
            padding: 16px 20px;
            background: linear-gradient(135deg, var(--b3-theme-primary-lightest) 0%, var(--b3-theme-surface) 100%);
            border-radius: 12px;
            font-size: 13px;
            color: var(--b3-theme-on-surface);
            border-left: 4px solid var(--b3-theme-primary);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        `;
    }
}
