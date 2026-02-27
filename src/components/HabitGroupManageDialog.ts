import { Dialog, showMessage } from "siyuan";
import { HabitGroupManager, HabitGroup } from "../utils/habitGroupManager";
import { confirm } from "siyuan";
import { getLocaleTag } from "../utils/dateUtils";
import { i18n } from "../pluginInstance";
export class HabitGroupManageDialog {
    private dialog: Dialog;
    private groupManager: HabitGroupManager;
    private onUpdate: () => void;

    constructor(onUpdate: () => void) {
        this.onUpdate = onUpdate;
        this.groupManager = HabitGroupManager.getInstance();
    }

    show() {
        this.dialog = new Dialog({
            title: i18n("groupManageTitle"),
            content: '<div id="habitGroupManageContainer"></div>',
            width: "600px",
            height: "500px"
        });

        const container = this.dialog.element.querySelector('#habitGroupManageContainer') as HTMLElement;
        if (!container) return;

        this.renderGroupList(container);
    }

    private renderGroupList(container: HTMLElement) {
        container.innerHTML = '';
        container.style.cssText = 'padding: 20px; display: flex; flex-direction: column; height: 100%;';

        // 添加新分组按钮
        const addButton = document.createElement('button');
        addButton.className = 'b3-button b3-button--primary';
        addButton.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n("habitNewGroup")}`;
        addButton.style.marginBottom = '16px';
        addButton.addEventListener('click', () => this.showAddGroupDialog());
        container.appendChild(addButton);

        // 分组列表
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'flex: 1; overflow-y: auto;';

        const groups = this.groupManager.getAllGroups();

        if (groups.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--b3-theme-on-surface-light);">${i18n("noGroups")}</div>`;
        } else {
            groups.forEach(group => {
                const groupItem = this.createGroupItem(group);
                listContainer.appendChild(groupItem);
            });
        }

        container.appendChild(listContainer);
    }

    private createGroupItem(group: HabitGroup): HTMLElement {
        const item = document.createElement('div');
        item.setAttribute('data-id', group.id);
        item.draggable = true;
        item.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            margin-bottom: 8px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 1px solid var(--b3-theme-surface-lighter);
            cursor: move;
            transition: transform 0.2s, box-shadow 0.2s;
        `;

        // Drag events
        item.addEventListener('dragstart', (e) => {
            item.style.opacity = '0.5';
            e.dataTransfer!.effectAllowed = 'move';
            e.dataTransfer!.setData('text/plain', group.id);
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
            item.classList.remove('dragging');

            const container = item.parentElement;
            if (container) {
                const newOrder = Array.from(container.children).map(child => (child as HTMLElement).getAttribute('data-id')!);
                this.groupManager.updateGroupOrder(newOrder).then(() => {
                    this.onUpdate();
                });
            }
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'move';

            const draggingItem = document.querySelector('.dragging') as HTMLElement;
            if (draggingItem && draggingItem !== item) {
                const bounding = item.getBoundingClientRect();
                const offset = bounding.y + (bounding.height / 2);

                if (e.clientY - offset > 0) {
                    item.style.borderBottom = '2px solid var(--b3-theme-primary)';
                    item.style.borderTop = '';
                } else {
                    item.style.borderTop = '2px solid var(--b3-theme-primary)';
                    item.style.borderBottom = '';
                }
            }
        });

        item.addEventListener('dragleave', () => {
            item.style.borderTop = '';
            item.style.borderBottom = '';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.style.borderTop = '';
            item.style.borderBottom = '';

            const draggingItem = document.querySelector('.dragging') as HTMLElement;
            if (draggingItem && draggingItem !== item) {
                const container = item.parentElement;

                // Determine insertion position based on mouse position relative to item center
                const bounding = item.getBoundingClientRect();
                const offset = bounding.y + (bounding.height / 2);

                if (e.clientY - offset > 0) {
                    container!.insertBefore(draggingItem, item.nextSibling);
                } else {
                    container!.insertBefore(draggingItem, item);
                }
            }
        });

        const info = document.createElement('div');
        info.style.cssText = 'flex: 1; pointer-events: none;'; // Prevent events on children interfering with drag

        const name = document.createElement('div');
        name.textContent = group.name;
        name.style.cssText = 'font-weight: bold; margin-bottom: 4px;';

        const meta = document.createElement('div');
        meta.textContent = `${i18n("createdAt")}${new Date(group.createdAt).toLocaleDateString(getLocaleTag())}`;
        meta.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light);';

        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 8px;';

        const editBtn = document.createElement('button');
        editBtn.className = 'b3-button b3-button--outline';
        editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
        editBtn.title = i18n("edit");
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag start
            this.showEditGroupDialog(group);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--outline';
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.title = i18n("delete");
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag start
            this.deleteGroup(group);
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);

        return item;
    }

    private showAddGroupDialog() {
        const dialog = new Dialog({
            title: i18n("newGroupTitle"),
            content: `
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">${i18n("groupNameLabel")}</label>
                        <input type="text" id="groupNameInput" class="b3-text-field" placeholder="${i18n("groupNamePlaceholder")}" style="width: 100%;" spellcheck="false">
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button id="cancelBtn" class="b3-button">${i18n("cancel")}</button>
                        <button id="confirmBtn" class="b3-button b3-button--primary">${i18n("confirm")}</button>
                    </div>
                </div>
            `,
            width: "400px"
        });

        const nameInput = dialog.element.querySelector('#groupNameInput') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#confirmBtn') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showMessage(i18n("inputGroupName"), 3000, 'error');
                return;
            }

            if (this.groupManager.groupExists(name)) {
                showMessage(i18n("groupExists"), 3000, 'error');
                return;
            }

            try {
                await this.groupManager.addGroup({ name });
                showMessage(i18n("groupCreateSuccess"));
                dialog.destroy();
                this.renderGroupList(this.dialog.element.querySelector('#habitGroupManageContainer') as HTMLElement);
                this.onUpdate();
            } catch (error) {
                console.error('创建分组失败:', error);
                showMessage(i18n("groupCreateFailed"), 3000, 'error');
            }
        });

        nameInput.focus();
    }

    private showEditGroupDialog(group: HabitGroup) {
        const dialog = new Dialog({
            title: i18n("editGroupTitle"),
            content: `
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">${i18n("groupNameLabel")}</label>
                        <input type="text" id="groupNameInput" class="b3-text-field" value="${group.name}" style="width: 100%;" spellcheck="false">
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button id="cancelBtn" class="b3-button">${i18n("cancel")}</button>
                        <button id="confirmBtn" class="b3-button b3-button--primary">${i18n("save")}</button>
                    </div>
                </div>
            `,
            width: "400px"
        });

        const nameInput = dialog.element.querySelector('#groupNameInput') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#confirmBtn') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showMessage(i18n("inputGroupName"), 3000, 'error');
                return;
            }

            if (name !== group.name && this.groupManager.groupExists(name)) {
                showMessage(i18n("groupExists"), 3000, 'error');
                return;
            }

            try {
                await this.groupManager.updateGroup(group.id, { name });
                showMessage(i18n("groupSaveSuccess"));
                dialog.destroy();
                this.renderGroupList(this.dialog.element.querySelector('#habitGroupManageContainer') as HTMLElement);
                this.onUpdate();
            } catch (error) {
                console.error('保存分组失败:', error);
                showMessage(i18n("groupSaveFailed"), 3000, 'error');
            }
        });

        nameInput.focus();
    }

    private deleteGroup(group: HabitGroup) {
        confirm(
            i18n("habitConfirmDeleteGroup"),
            i18n("confirmDeleteGroupMsg", { name: group.name }),
            async () => {
                try {
                    await this.groupManager.deleteGroup(group.id);
                    showMessage(i18n("deleteSuccess"));
                    this.renderGroupList(this.dialog.element.querySelector('#habitGroupManageContainer') as HTMLElement);
                    this.onUpdate();
                } catch (error) {
                    console.error('删除分组失败:', error);
                    showMessage(i18n("deleteFailed"), 3000, 'error');
                }
            }
        );
    }
}
