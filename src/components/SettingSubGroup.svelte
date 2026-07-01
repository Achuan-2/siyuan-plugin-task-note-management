<script lang="ts">
    export let title: string;
</script>

<div class="setting-sub-group">
    <div class="setting-sub-group__header">
        <span class="setting-sub-group__title">{title}</span>
    </div>
    <div class="setting-sub-group__content">
        <slot />
    </div>
</div>

<style lang="scss">
    .setting-sub-group {
        margin-top: 16px;
        margin-bottom: 24px;
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        background-color: var(--b3-theme-background);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        overflow: hidden;
        transition: border-color 0.2s, box-shadow 0.2s;

        &:hover {
            border-color: color-mix(in srgb, var(--b3-theme-primary) 30%, var(--b3-border-color));
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
        }

        &__header {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            background: linear-gradient(
                to right,
                color-mix(in srgb, var(--b3-theme-primary) 10%, var(--b3-theme-background)),
                var(--b3-theme-background)
            );
            border-bottom: 1px solid var(--b3-border-color);
        }

        &__title {
            font-size: 13px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
            letter-spacing: 0.02em;
        }

        &__content {
            padding: 8px 16px;
            
            :global(.item-wrap:last-child) {
                border-bottom: none !important;
                margin-bottom: 0 !important;
                padding-bottom: 8px !important;
            }
        }
    }
</style>
