<!--
 Copyright (c) 2023 by frostime All Rights Reserved.
 Author       : frostime
 Date         : 2023-07-01 19:23:50
 FilePath     : /src/libs/components/setting-panel.svelte
 LastEditTime : 2024-08-09 21:41:07
 Description  : 
-->
<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import Form from './Form';

    export let group: string;
    export let settingItems: ISettingItem[];
    export let display: boolean = true;

    const dispatch = createEventDispatcher();

    function onClick({ detail }) {
        dispatch('click', { key: detail.key });
    }
    function onChanged({ detail }) {
        dispatch('changed', { group: group, ...detail });
    }

    $: fn__none = display ? '' : 'fn__none';
</script>

<div class="config__tab-container {fn__none}" data-name={group}>
    <slot />
    {#each settingItems as item (item.key)}
        {#if !item.hidden}
            <Form.Wrap
                title={item.title}
                description={item.description}
                direction={item?.direction}
            >
                <Form.Input
                    type={item.type}
                    key={item.key}
                    bind:value={item.value}
                    placeholder={item?.placeholder}
                    options={item?.options}
                    slider={item?.slider}
                    button={item?.button}
                    on:click={onClick}
                    on:changed={onChanged}
                />
            </Form.Wrap>
        {/if}
    {/each}
</div>
