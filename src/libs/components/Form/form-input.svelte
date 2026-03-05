<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    export let type: string; // Setting Type
    export let key: string;
    export let value: any;

    // Optional parameters
    export let placeholder: string = '';
    export let options: { [key: string | number]: string } = {};
    export let slider: {
        min: number;
        max: number;
        step: number;
    } = { min: 0, max: 100, step: 1 };
    export let button: {
        label: string;
        callback?: () => void;
    } = { label: value, callback: () => {} };
    export let fnSize: boolean = true; // If the form input is used within setting panel context, it is usually given a fixed width by a class named "fn__size200".
    export let style: string = ''; // Custom style
    export let disabled: boolean = false;

    let showPassword = false;
    const dispatch = createEventDispatcher();

    function click() {
        button?.callback();
        dispatch('click', { key: key });
    }

    function changed() {
        dispatch('changed', { key: key, value: value });
    }
</script>

{#if type === 'checkbox'}
    <!-- Checkbox -->
    <input
        class="b3-switch fn__flex-center"
        id={key}
        type="checkbox"
        bind:checked={value}
        on:change={changed}
        {style}
    />
{:else if type === 'textinput'}
    <!-- Text Input -->
    <input
        class:b3-text-field={true}
        class:fn__flex-center={true}
        class:fn__size200={fnSize}
        id={key}
        {placeholder}
        {disabled}
        bind:value
        on:change={changed}
        {style}
    />
{:else if type === 'password'}
    <!-- Password Input -->
    <div style="position: relative; display: flex; align-items: center;" class:fn__size200={fnSize}>
        {#if showPassword}
            <input
                class:b3-text-field={true}
                style="width: 100%; padding-right: 28px; {style}"
                id={key}
                type="text"
                {placeholder}
                {disabled}
                bind:value
                on:change={changed}
            />
        {:else}
            <input
                class:b3-text-field={true}
                style="width: 100%; padding-right: 28px; {style}"
                id={key}
                type="password"
                {placeholder}
                {disabled}
                bind:value
                on:change={changed}
            />
        {/if}
        <svg
            class="b3-tooltips b3-tooltips__nw"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            on:click={() => (showPassword = !showPassword)}
            on:keydown={e => e.key === 'Enter' && (showPassword = !showPassword)}
            tabindex="0"
            role="button"
            style="position: absolute; right: 8px; cursor: pointer; opacity: 0.5; width: 14px; height: 14px; outline: none;"
        >
            {#if showPassword}
                <use xlink:href="#iconEyeoff"></use>
            {:else}
                <use xlink:href="#iconEye"></use>
            {/if}
        </svg>
    </div>
{:else if type === 'textarea'}
    <textarea
        class="b3-text-field fn__block"
        style={`resize: vertical; height: 10em; white-space: nowrap; ${style}`}
        bind:value
        on:change={changed}
    />
{:else if type === 'number'}
    <input
        class:b3-text-field={true}
        class:fn__flex-center={true}
        class:fn__size200={fnSize}
        id={key}
        type="number"
        bind:value
        on:change={changed}
        {style}
    />
{:else if type === 'button'}
    <!-- Button Input -->
    <button
        class:b3-button={true}
        class:b3-button--outline={true}
        class:fn__flex-center={true}
        class:fn__size200={fnSize}
        id={key}
        on:click={click}
        {style}
    >
        {button.label}
    </button>
{:else if type === 'select'}
    <!-- Dropdown select -->
    <select
        class:b3-select={true}
        class:fn__flex-center={true}
        class:fn__size200={fnSize}
        id={key}
        {disabled}
        bind:value
        on:change={changed}
        {style}
    >
        {#each Object.entries(options) as [value, text]}
            <option {value}>{text}</option>
        {/each}
    </select>
{:else if type == 'slider'}
    <!-- Slider -->
    <div class="b3-tooltips b3-tooltips__n" aria-label={value}>
        <input
            class:b3-slider={true}
            class:fn__size200={fnSize}
            id={key}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            type="range"
            bind:value
            on:change={changed}
            {style}
        />
    </div>
{/if}
