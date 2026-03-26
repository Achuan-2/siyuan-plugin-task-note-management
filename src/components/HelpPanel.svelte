<script lang="ts">
    import { i18n, getPluginInstance } from '../pluginInstance';
    import { ChangelogUtils } from '../utils/changelogNotify';

    const showChangelog = () => {
        const plugin = getPluginInstance();
        if (plugin) {
            ChangelogUtils.showChangelog(plugin);
        }
    }

</script>

<div
    class="b3-label help-panel"
    style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 400px; gap: 24px; padding: 48px; background: var(--b3-theme-background); border-radius: 12px; margin: 16px; border: 1px solid var(--b3-border-color);"
>
    <div
        style="width: 64px; height: 64px; border-radius: 16px; background: var(--b3-theme-primary-lightest); display: flex; align-items: center; justify-content: center; color: var(--b3-theme-primary); margin-bottom: 8px;"
    >
        <svg
            viewBox="0 0 24 24"
            width="32"
            height="32"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
    </div>
    <div
        style="font-size: 1.6em; font-weight: 700; color: var(--b3-theme-on-surface); letter-spacing: -0.02em;"
    >
        {i18n('helpDocument')}
    </div>
    <div
        style="text-align: center; color: var(--b3-theme-on-surface-light); max-width: 400px; line-height: 1.6; font-size: 14px;"
    >
        {i18n('helpDocumentDesc')}
    </div>
    <a
        href="https://www.zhihu.com/column/c_1998349446233202806"
        target="_blank"
        style="display: flex; align-items: center; gap: 8px; color: #fff; background: var(--b3-theme-primary); padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(var(--b3-theme-primary-rgb), 0.2);"
        on:mouseenter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(var(--b3-theme-primary-rgb), 0.3)';
        }}
        on:mouseleave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(var(--b3-theme-primary-rgb), 0.2)';
        }}
    >
        <span>{i18n('viewDocumentNow')}</span>
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    </a>

    <button
        style="display: flex; align-items: center; gap: 8px; color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest); padding: 12px 24px; border: 1px solid var(--b3-theme-primary-lighter); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s ease; font-size: 14px;"
        on:mouseenter={e => {
            e.currentTarget.style.background = 'var(--b3-theme-primary-lighter)';
            e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        on:mouseleave={e => {
            e.currentTarget.style.background = 'var(--b3-theme-primary-lightest)';
            e.currentTarget.style.transform = 'translateY(0)';
        }}
        on:click={showChangelog}
    >
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
        </svg>
        <span>{i18n('viewChangelog') || '查看更新日志'}</span>
    </button>

</div>
