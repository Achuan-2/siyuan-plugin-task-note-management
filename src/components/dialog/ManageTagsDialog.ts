import { Dialog, showMessage } from "siyuan";
import { i18n } from "../../pluginInstance";
import { generateRandomColor } from "../../utils/uiUtils";
import { saveReminders } from "../../utils/icsSubscription";

export async function showManageTagsDialog(view: any) {
    const dialog = new Dialog({
        title: i18n('manageProjectTags'),
        content: `
            <div class="manage-tags-dialog">
                <div class="b3-dialog__content">
                    <div class="tags-list" style="margin-bottom: 16px;">
                        <div class="tags-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <h4 style="margin: 0;">${i18n('existingTags')}</h4>
                            <div style="display: flex; gap: 8px;">
                                <button id="syncTagsBtn" class="b3-button b3-button--small">
                                    <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg> ${i18n('syncTagsToProject')}
                                </button>
                                <button id="pasteTagsBtn" class="b3-button b3-button--small">
                                    <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg> ${i18n('pasteNewTags')}
                                </button>
                                <button id="addTagBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newTag')}
                                </button>
                            </div>
                        </div>
                        <div id="tagsContainer" class="tags-container" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;">
                            <!-- 标签列表将在这里动态生成 -->
                        </div>
                    </div>
                </div>
            </div>
        `,
        width: "600px",
        height: "auto"
    });

    const tagsContainer = dialog.element.querySelector('#tagsContainer') as HTMLElement;
    const addTagBtn = dialog.element.querySelector('#addTagBtn') as HTMLButtonElement;
    const syncTagsBtn = dialog.element.querySelector('#syncTagsBtn') as HTMLButtonElement;
    const pasteTagsBtn = dialog.element.querySelector('#pasteTagsBtn') as HTMLButtonElement;

    // 加载并显示现有标签
    const loadAndDisplayTags = async () => {
        try {
            const projectManager = view.projectManager;
            const projectTags = await projectManager.getProjectTags(view.projectId);

            tagsContainer.innerHTML = '';

            if (projectTags.length === 0) {
                tagsContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px; width: 100%;">${i18n('noTags')}</div>`;
                return;
            }

            projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                const tagItem = document.createElement('div');
                tagItem.className = 'tag-item';
                tagItem.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    background: ${tag.color}20;
                    border: 1px solid ${tag.color};
                    border-radius: 16px;
                    font-size: 14px;
                    color: ${tag.color};
                    cursor: pointer;
                `;

                const tagText = document.createElement('span');
                tagText.textContent = `#${tag.name}`;
                tagItem.appendChild(tagText);

                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--text';
                editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.classList.add('ariaLabel');
                editBtn.setAttribute('aria-label', i18n('edit'));
                editBtn.style.cssText = `
                    padding: 2px;
                    min-width: unset;
                    opacity: 0.6;
                `;
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showEditTagDialog(tag);
                });
                tagItem.appendChild(editBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'b3-button b3-button--text';
                deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconClose"></use></svg>';
                deleteBtn.classList.add('ariaLabel');
                deleteBtn.setAttribute('aria-label', i18n('delete'));
                deleteBtn.style.cssText = `
                    padding: 2px;
                    min-width: unset;
                    opacity: 0.6;
                `;
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await deleteTag(tag.name);
                });
                tagItem.appendChild(deleteBtn);

                tagsContainer.appendChild(tagItem);
            });
        } catch (error) {
            console.error(i18n('loadTagsFailed'), error);
            tagsContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">${i18n('loadTagsFailed')}</div>`;
        }
    };

    // 删除标签
    const deleteTag = async (tagNameToDelete: string) => {
        try {
            const projectManager = view.projectManager;
            const projectTags = await projectManager.getProjectTags(view.projectId);

            const updatedTags = projectTags.filter(tag => tag.name !== tagNameToDelete);
            await projectManager.setProjectTags(view.projectId, updatedTags);

            await loadAndDisplayTags();
            await view.loadProject();
            showMessage(i18n('tagDeleted'));
        } catch (error) {
            console.error(i18n('deleteTagFailed'), error);
            showMessage(i18n('deleteTagFailed'));
        }
    };

    // 编辑标签对话框
    const showEditTagDialog = (existingTag: { id: string, name: string, color: string }) => {
        showTagEditDialog(existingTag, async (updatedTag) => {
            try {
                const projectManager = view.projectManager;
                const projectTags = await projectManager.getProjectTags(view.projectId);

                const index = projectTags.findIndex(t => t.id === existingTag.id);
                if (index !== -1) {
                    projectTags[index] = updatedTag;
                    await projectManager.setProjectTags(view.projectId, projectTags);
                    await loadAndDisplayTags();
                    await view.loadProject();
                    showMessage(i18n('tagUpdated'));
                }
            } catch (error) {
                console.error(i18n('updateTagFailed'), error);
                showMessage(i18n('updateTagFailed'));
            }
        });
    };

    // 新建/编辑标签对话框
    const showTagEditDialog = (existingTag: { id: string, name: string, color: string } | null, onSave: (tag: { id: string, name: string, color: string }) => void) => {
        const isEdit = existingTag !== null;
        const defaultColor = existingTag?.color || generateRandomColor();
        const defaultName = existingTag?.name || '';

        const tagDialog = new Dialog({
            title: isEdit ? i18n('editTag') : i18n('newTag'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('tagName')}</label>
                        <input type="text" id="tagNameInput" class="b3-text-field" placeholder="${i18n('pleaseEnterTagName')}" value="${defaultName}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group" style="margin-top: 12px;">
                        <label class="b3-form__label">${i18n('tagColor')}</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="color" id="tagColorInput" value="${defaultColor}" style="width: 60px; height: 32px; border: 1px solid var(--b3-border-color); border-radius: 4px; cursor: pointer;">
                            <input type="text" id="tagColorText" class="b3-text-field" value="${defaultColor}" style="flex: 1;" readonly>
                            <div id="tagColorPreview" style="width: 80px; height: 32px; border-radius: 16px; border: 1px solid ${defaultColor}; background: ${defaultColor}20; display: flex; align-items: center; justify-content: center; font-size: 12px;">${i18n('preview')}</div>
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="tagDialogCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="tagDialogSave">${i18n('save')}</button>
                </div>
            `,
            width: '400px'
        });

        const nameInput = tagDialog.element.querySelector('#tagNameInput') as HTMLInputElement;
        const colorInput = tagDialog.element.querySelector('#tagColorInput') as HTMLInputElement;
        const colorText = tagDialog.element.querySelector('#tagColorText') as HTMLInputElement;
        const colorPreview = tagDialog.element.querySelector('#tagColorPreview') as HTMLElement;
        const cancelBtn = tagDialog.element.querySelector('#tagDialogCancel') as HTMLButtonElement;
        const saveBtn = tagDialog.element.querySelector('#tagDialogSave') as HTMLButtonElement;

        colorInput.addEventListener('input', () => {
            const color = colorInput.value;
            colorText.value = color;
            colorPreview.style.borderColor = color;
            colorPreview.style.background = `${color}20`;
        });

        cancelBtn.addEventListener('click', () => tagDialog.destroy());

        saveBtn.addEventListener('click', async () => {
            const tagName = nameInput.value.trim();
            const tagColor = colorInput.value;

            if (!tagName) {
                showMessage(i18n('pleaseEnterTagName'));
                return;
            }

            if (!isEdit || tagName !== existingTag.name) {
                const { ProjectManager } = await import('../../utils/projectManager');
                const projectManager = ProjectManager.getInstance(view.plugin);
                const projectTags = await projectManager.getProjectTags(view.projectId);

                if (projectTags.some(t => t.name === tagName)) {
                    showMessage(i18n('tagAlreadyExists'));
                    return;
                }
            }

            const tagId = isEdit ? existingTag.id : `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            onSave({ id: tagId, name: tagName, color: tagColor });
            tagDialog.destroy();
        });
    };

    // 同步标签到其他项目
    syncTagsBtn.addEventListener('click', async () => {
        try {
            const projectManager = view.projectManager;
            const currentTags = await projectManager.getProjectTags(view.projectId);

            if (currentTags.length === 0) {
                showMessage(i18n('noTags'));
                return;
            }

            const projectData = await view.plugin.loadProjectData() || {};
            const otherProjects = Object.entries(projectData)
                .filter(([key]) => !key.startsWith('_') && key !== view.projectId)
                .map(([id, project]: [string, any]) => ({
                    id,
                    name: project.title || i18n('unnamedProject')
                }));

            if (otherProjects.length === 0) {
                showMessage(i18n('noOtherProjects'));
                return;
            }

            const syncDialog = new Dialog({
                title: i18n('syncTagsToProject'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('selectTargetProject')}</label>
                            <select id="targetProjectSelect" class="b3-select" style="width: 100%;">
                                <option value="">${i18n('pleaseSelect')}</option>
                                ${otherProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="b3-form__group" style="margin-top: 12px;">
                            <label class="b3-form__label">${i18n('selectTagsToSync')}</label>
                            <div id="syncTagsList" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; max-height: 300px; overflow-y: auto;">
                                ${currentTags.map(tag => `
                                    <label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: ${tag.color}20; border: 1px solid ${tag.color}; border-radius: 16px; font-size: 14px; color: ${tag.color}; cursor: pointer;">
                                        <input type="checkbox" value="${tag.name}" data-color="${tag.color}" checked style="cursor: pointer;">
                                        <span>#${tag.name}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="syncDialogCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="syncDialogConfirm">${i18n('sync')}</button>
                    </div>
                `,
                width: '500px'
            });

            const targetSelect = syncDialog.element.querySelector('#targetProjectSelect') as HTMLSelectElement;
            const cancelSyncBtn = syncDialog.element.querySelector('#syncDialogCancel') as HTMLButtonElement;
            const confirmSyncBtn = syncDialog.element.querySelector('#syncDialogConfirm') as HTMLButtonElement;

            cancelSyncBtn.addEventListener('click', () => syncDialog.destroy());

            confirmSyncBtn.addEventListener('click', async () => {
                const targetProjectId = targetSelect.value;
                if (!targetProjectId) {
                    showMessage(i18n('noTargetProject'));
                    return;
                }

                const checkboxes = syncDialog.element.querySelectorAll('#syncTagsList input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                if (checkboxes.length === 0) {
                    showMessage(i18n('noTagsSelected'));
                    return;
                }

                const targetTags = await projectManager.getProjectTags(targetProjectId);
                const targetTagNames = new Set(targetTags.map(t => t.name));

                let addedCount = 0;
                for (const checkbox of checkboxes) {
                    const tagName = checkbox.value;
                    const tagColor = checkbox.getAttribute('data-color') || '#3498db';

                    if (!targetTagNames.has(tagName)) {
                        targetTags.push({
                            id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${addedCount}`,
                            name: tagName,
                            color: tagColor
                        });
                        addedCount++;
                    }
                }

                if (addedCount > 0) {
                    await projectManager.setProjectTags(targetProjectId, targetTags);
                    showMessage(i18n('tagsSynced'));
                } else {
                    showMessage(i18n('tagsAlreadyExist'));
                }

                syncDialog.destroy();
            });
        } catch (error) {
            console.error(i18n('syncTagsFailed'), error);
            showMessage(i18n('syncTagsFailed'));
        }
    });

    // 粘贴新建标签
    pasteTagsBtn.addEventListener('click', async () => {
        try {
            const projectManager = view.projectManager;
            const projectTags = await projectManager.getProjectTags(view.projectId);
            const existingTagNames = new Set(projectTags.map(t => t.name));

            const pasteDialog = new Dialog({
                title: i18n('pasteNewTags'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('pasteNewTags')}</label>
                            <textarea id="pasteTagsInput" class="b3-text-field" rows="10" placeholder="${i18n('pasteTagsPlaceholder')}" style="width: 100%; resize: vertical;"></textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="pasteDialogCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="pasteDialogSave">${i18n('save')}</button>
                    </div>
                `,
                width: '400px'
            });

            const pasteInput = pasteDialog.element.querySelector('#pasteTagsInput') as HTMLTextAreaElement;
            const cancelPasteBtn = pasteDialog.element.querySelector('#pasteDialogCancel') as HTMLButtonElement;
            const savePasteBtn = pasteDialog.element.querySelector('#pasteDialogSave') as HTMLButtonElement;

            cancelPasteBtn.addEventListener('click', () => pasteDialog.destroy());

            savePasteBtn.addEventListener('click', async () => {
                const rawText = pasteInput.value.trim();
                if (!rawText) {
                    showMessage(i18n('pleaseEnterTagName'));
                    return;
                }

                const lines = rawText.split('\n');
                const newTagNames: string[] = [];
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    const cleaned = trimmed.replace(/^[-*]\s*/, '').trim();
                    if (cleaned && !existingTagNames.has(cleaned) && !newTagNames.includes(cleaned)) {
                        newTagNames.push(cleaned);
                    }
                }

                if (newTagNames.length === 0) {
                    showMessage(i18n('tagAlreadyExists'));
                    return;
                }

                for (const tagName of newTagNames) {
                    projectTags.push({
                        id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name: tagName,
                        color: generateRandomColor()
                    });
                }

                await projectManager.setProjectTags(view.projectId, projectTags);
                await loadAndDisplayTags();
                await view.loadProject();
                showMessage(i18n('batchTagsCreated'));
                pasteDialog.destroy();
            });
        } catch (error) {
            console.error(i18n('createTagFailed'), error);
            showMessage(i18n('createTagFailed'));
        }
    });

    // 新建标签按钮
    addTagBtn.addEventListener('click', () => {
        showTagEditDialog(null, async (newTag) => {
            try {
                const projectManager = view.projectManager;
                const projectTags = await projectManager.getProjectTags(view.projectId);

                projectTags.push(newTag);
                await projectManager.setProjectTags(view.projectId, projectTags);

                await loadAndDisplayTags();
                await view.loadProject();
                showMessage(i18n('tagCreated'));
            } catch (error) {
                console.error(i18n('createTagFailed'), error);
                showMessage(i18n('createTagFailed'));
            }
        });
    });

    await loadAndDisplayTags();
}
