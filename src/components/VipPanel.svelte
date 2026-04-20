<script lang="ts">
    import { VipManager, type VIPStatus } from '../utils/vip';
    import { platformUtils } from 'siyuan';
    import { pushMsg } from '../api';
    import { i18n } from '../pluginInstance';

    import { onMount } from 'svelte';

    export let plugin: any;
    export let isDialog: boolean = false;

    let userId = 'unknown';
    let vipStatus: VIPStatus = {
        vipKeys: plugin?.vip?.vipKeys || [],
        isVip: plugin?.vip?.isVip || false,
        expireDate: plugin?.vip?.expireDate || '',
        remainingDays: 0,
        freeTrialUsed: plugin?.vip?.freeTrialUsed || false,
    };

    onMount(async () => {
        userId = await VipManager.getUserId();
        vipStatus = await VipManager.checkAndUpdateVipStatus(plugin);
    });
    let inputKey = '';
    let message = '';
    let isError = false;
    let showUserId = false;

    let selectedTerm = '1y'; // 默认选中年付

    $: isZhCN = window.siyuan.config.lang === 'zh_CN';

    $: currentPrices = [
        { term: '7d', label: i18n('vipTrial7Days'), price: i18n('vipTrial') },
        { term: '1m', label: i18n('vipMonthlyPay'), price: isZhCN ? '5 元' : '$2' },
        { term: '1y', label: i18n('vipAnnualPay'), price: isZhCN ? '30 元' : '$12' },
        { term: 'Lifetime', label: i18n('vipLifetime'), price: isZhCN ? '99 元' : '$40' },
    ];

    function selectPlan(term: string) {
        selectedTerm = term;
    }

    $: displayPrices = currentPrices.filter(plan => {
        if (plan.term === '7d' && plugin.vip.freeTrialUsed) return false;
        return true;
    });

    $: if (selectedTerm === '7d' && plugin.vip.freeTrialUsed) {
        selectedTerm = '1y';
    }

    const API_PREFIX = 'https://siyuan-tasknote.achuan-2.top';
    let qrcodeImg = '';
    let outTradeNo = '';
    let isPaying = false;
    let paymentStatusMessage = '';
    let paymentErrorMessage = '';
    let isCheckingStatus = false;
    let paymentAmountStr = '';

    async function manualCheckStatus() {
        if (!outTradeNo || isCheckingStatus) return;
        isCheckingStatus = true;
        paymentErrorMessage = '';
        try {
            const response = await fetch(
                `${API_PREFIX}/api/check-status?out_trade_no=${outTradeNo}`
            );
            const result = await response.json();
            if (result.success && result.status === 1) {
                paymentStatusMessage = i18n('vipPaymentSuccess');
                isPaying = false;
                qrcodeImg = '';
                if (result.activation_code) {
                    inputKey = result.activation_code;
                    handleAddKey();
                }
            } else {
                paymentErrorMessage = i18n('vipOrderUnpaidOrFailed');
            }
        } catch (error) {
            console.error('Manual check failed', error);
            paymentErrorMessage = i18n('vipQueryException');
        } finally {
            isCheckingStatus = false;
        }
    }

    function handleCancel() {
        qrcodeImg = '';
        isPaying = false;
        paymentStatusMessage = '';
        paymentErrorMessage = '';
        outTradeNo = '';
        paymentAmountStr = '';
    }

    async function handlePay() {
        if (selectedTerm === '7d') {
            await handleFreeTrial();
            return;
        }

        isPaying = true;
        paymentStatusMessage = i18n('vipCreatingOrder');
        paymentErrorMessage = '';
        qrcodeImg = '';

        try {
            const response = await fetch(`${API_PREFIX}/api/create-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userId,
                    term: selectedTerm,
                }),
            });

            const result = await response.json();
            if (result.success) {
                qrcodeImg = result.img;
                outTradeNo = result.out_trade_no;
                paymentStatusMessage = i18n('vipQrcodeGenerated');
                paymentAmountStr = result.money || '';
            } else {
                paymentStatusMessage = '';
                paymentErrorMessage = result.message || i18n('vipCreateOrderFailed');
                isPaying = false;
            }
        } catch (error) {
            paymentStatusMessage = '';
            paymentErrorMessage = i18n('vipExceptionOccurred');
            isPaying = false;
        }
    }

    async function handleFreeTrial() {
        paymentStatusMessage = i18n('vipRequestingTrialKey');
        paymentErrorMessage = '';
        try {
            const response = await fetch(`${API_PREFIX}/api/create-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userId,
                    term: '7d',
                }),
            });
            const result = await response.json();
            if (result.success && result.activation_code) {
                inputKey = result.activation_code;
                handleAddKey();
                paymentStatusMessage = i18n('vipTrialKeyObtained');
            } else {
                paymentStatusMessage = '';
                paymentErrorMessage = result.message || i18n('vipGetTrialKeyFailed');
            }
        } catch (error) {
            paymentStatusMessage = '';
            paymentErrorMessage = i18n('vipGetTrialKeyFailed');
        }
    }

    async function handleAddKey() {
        if (!inputKey) return;

        const result = VipManager.parseVIPKey(userId, inputKey);
        if (!result.valid) {
            message = i18n('vipInvalidKeyOrNotBelong');
            isError = true;
            return;
        }

        if (plugin.vip.vipKeys.includes(inputKey)) {
            message = i18n('vipKeyAlreadyAdded');
            isError = false;
            return;
        }

        if (result.term === '7d') {
            plugin.vip.freeTrialUsed = true;
        }

        plugin.vip.vipKeys = [...plugin.vip.vipKeys, inputKey];
        plugin = plugin; // 触发 Svelte 响应式更新

        // 更新内存中的 VIP 状态，以便保存时数据一致
        vipStatus = await VipManager.checkAndUpdateVipStatus(plugin);
        plugin.vip.isVip = vipStatus.isVip;
        plugin.vip.expireDate = vipStatus.expireDate;

        // 保存并触发更新
        (async () => {
            await plugin.saveVipData(plugin.vip);
            window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
        })();

        inputKey = '';
        message = i18n('vipActivationSuccess');
        isError = false;
    }

    async function handleCopyUserId() {
        await platformUtils.writeText(userId);
        pushMsg(i18n('vipUserIdCopied'));
    }

    // 计算当前正在生效或待生效的激活码
    $: activeKeys = (() => {
        const keys = plugin.vip.vipKeys || [];
        const validKeys = keys
            .map(k => {
                const p = VipManager.parseVIPKey(userId, k);
                return { key: k, ...p };
            })
            .filter(k => k.valid)
            .sort((a, b) => a.purchaseTime - b.purchaseTime);

        let currentExpire = 0;
        const now = Date.now();
        let results = [];

        for (const k of validKeys) {
            const isLifetime = k.term === 'Lifetime';
            const termMs = VipManager.getTermMs(k.term, k.purchaseTime);
            let start = k.purchaseTime;

            if (!isLifetime && currentExpire > start) {
                start = currentExpire;
            }

            const end = isLifetime
                ? new Date(k.purchaseTime).setFullYear(new Date(k.purchaseTime).getFullYear() + 999)
                : start + termMs;

            currentExpire = end;

            if (end > now) {
                results.push({
                    key: k.key,
                    term: k.term,
                    start: VipManager.formatDate(new Date(isLifetime ? k.purchaseTime : start)),
                    end: VipManager.formatDate(new Date(end)),
                    isLifetime: isLifetime,
                });
            }
        }

        if (results.some(r => r.isLifetime)) {
            results = results.filter(r => r.isLifetime);
        }

        return results;
    })();

    async function handleCopyKey(key: string) {
        await platformUtils.writeText(key);
        pushMsg(i18n('vipKeyCopied'));
    }

    let isAutoFilling = false;
    let autoFillMessage = '';
    let autoFillError = false;

    async function handleAutoFillKeys() {
        if (isAutoFilling || userId === 'unknown' || !userId) return;
        isAutoFilling = true;
        autoFillMessage = i18n('vipAutoFillFetching');
        autoFillError = false;

        try {
            const response = await fetch(
                `${API_PREFIX}/api/subscription?userId=${encodeURIComponent(userId)}`
            );
            const result = await response.json();

            if (result.subscribed && result.keys && result.keys.length > 0) {
                let addedCount = 0;
                for (const key of result.keys) {
                    if (plugin.vip.vipKeys.includes(key)) continue;
                    const parseResult = VipManager.parseVIPKey(userId, key);
                    if (!parseResult.valid) continue;
                    if (parseResult.term === '7d') {
                        plugin.vip.freeTrialUsed = true;
                    }
                    plugin.vip.vipKeys = [...plugin.vip.vipKeys, key];
                    addedCount++;
                }

                if (addedCount > 0) {
                    plugin = plugin;
                    vipStatus = await VipManager.checkAndUpdateVipStatus(plugin);
                    plugin.vip.isVip = vipStatus.isVip;
                    plugin.vip.expireDate = vipStatus.expireDate;
                    await plugin.saveVipData(plugin.vip);
                    window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
                    autoFillMessage = i18n('vipAutoFillSuccess').replace(
                        '${count}',
                        String(addedCount)
                    );
                    autoFillError = false;
                } else {
                    autoFillMessage = i18n('vipKeyAlreadyAdded');
                    autoFillError = false;
                }
            } else {
                autoFillMessage = i18n('vipAutoFillNoSubscription');
                autoFillError = true;
            }
        } catch (error) {
            console.error('Auto fill keys failed', error);
            autoFillMessage = i18n('vipAutoFillFailed');
            autoFillError = true;
        } finally {
            isAutoFilling = false;
        }
    }
</script>

<div class="vip-container {isDialog ? 'in-dialog' : ''}">
    <div class="vip-header">
        <div
            class="vip-card"
            class:is-lifetime={vipStatus.isLifetime}
            class:is-vip={vipStatus.isVip && !vipStatus.isLifetime}
            class:not-vip={!vipStatus.isVip}
        >
            <div class="vip-card__title">
                <span class="vip-icon">👑</span>
                {i18n('vipSubscriptionInfo')}
            </div>
            <div class="vip-card__status">
                {#if vipStatus.isVip}
                    {#if vipStatus.isLifetime}
                        <div class="status-active">
                            <div class="status-label">{i18n('vipLifetimeMember')}</div>
                            <div class="status-date">
                                {i18n('vipStartedFrom')}{vipStatus.lifetimeStartDate ||
                                    i18n('vipPurchaseDate')}
                            </div>
                        </div>
                    {:else}
                        <div class="status-active">
                            <div class="status-label">{i18n('vipActivated')}</div>
                            <div class="status-date">
                                {vipStatus.expireDate}{i18n('vipExpireAt')}
                            </div>
                            <div class="status-days">
                                {i18n('vipRemaining')}{vipStatus.remainingDays}{i18n('vipDays')}
                            </div>
                        </div>
                    {/if}
                {:else}
                    <div class="status-inactive">{i18n('vipNotSubscribed')}</div>
                {/if}
            </div>
        </div>
    </div>

    <div class="vip-section">
        <div class="activation-notice">
            {@html i18n('vipTutorial')}
        </div>
    </div>

    <div class="vip-section">
        <h3>{i18n('vipUserInfo')}</h3>
        <div class="user-info">
                <div class="user-id">
                    <div class="user-id-text">
                        <span class="user-id-label">{i18n('vipAccountId')}</span>
                        {#if userId === 'unknown' || !userId}
                        <span class="id-value" style="letter-spacing: normal;">
                            {userId || i18n('vipUnknown')}
                        </span>
                    {:else}
                        <span
                            class="id-value"
                            style="letter-spacing: {showUserId ? 'normal' : '2px'};"
                        >
                            {showUserId ? userId : '••••••••'}
                        </span>
                        <div
                            class="eye-icon ariaLabel"
                            on:click={() => (showUserId = !showUserId)}
                            role="button"
                            tabindex="0"
                            on:keydown={e =>
                                (e.key === 'Enter' || e.key === ' ') && (showUserId = !showUserId)}
                            aria-label={showUserId ? i18n('vipHide') : i18n('vipShow')}
                        >
                            {#if showUserId}
                                <svg><use xlink:href="#iconEyeoff"></use></svg>
                            {:else}
                                <svg><use xlink:href="#iconEye"></use></svg>
                            {/if}
                        </div>
                    {/if}
                </div>
                {#if userId !== 'unknown' && userId}
                    <button
                        class="b3-button b3-button--outline fn__flex-center"
                        on:click={handleCopyUserId}
                    >
                        {i18n('copy') || 'Copy'}
                    </button>
                {/if}
            </div>
            {#if userId === 'unknown' || !userId}
                <p class="error-text">{i18n('vipLoginToUse')}</p>
            {/if}
        </div>
    </div>

    {#if !vipStatus.isLifetime}
        <div class="vip-section">
            <h3>{i18n('vipSubscriptionPlan')}</h3>

            <div class="vip-section">
                <details class="benefits-details">
                    <summary>{i18n('vipViewMemberBenefits')}</summary>
                    <table class="benefits-table">
                        <thead>
                            <tr>
                                <th>{i18n('vipFunction')}</th>
                                <th>{i18n('vipNonMember')}</th>
                                <th>{i18n('vipMember')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>{i18n('vipTaskPanel')}</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipPomodoro')}</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipFourQuadrants')}</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipHabitTracking')}</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipCalendarView')}</td>
                                <td>❌</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipProjectKanban')}</td>
                                <td>❌</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipWechatGroup')}</td>
                                <td>❌</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>{i18n('vipFutureFeatures')}</td>
                                <td>❓</td>
                                <td>✅</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="benefits-info">
                        <h4>{i18n('vipHowToJoinWechat')}</h4>
                        <p>{i18n('vipJoinWechatDesc')}</p>
                    </div>
                </details>
            </div>
            <div class="plans-grid">
                {#each displayPrices as plan}
                    <div
                        class="plan-item {selectedTerm === plan.term ? 'is-selected' : ''}"
                        on:click={() => selectPlan(plan.term)}
                        on:keydown={e =>
                            (e.key === 'Enter' || e.key === ' ') && selectPlan(plan.term)}
                        role="button"
                        tabindex="0"
                    >
                        <div class="plan-label">{plan.label}</div>
                        <div class="plan-price">{plan.price}</div>
                        {#if selectedTerm === plan.term}
                            <div class="plan-badge">{i18n('vipSelected')}</div>
                        {/if}
                    </div>
                {/each}
            </div>
            <div class="pay-tips">
                <p>{i18n('vipRefundNotice')}</p>
                <p>
                    {i18n('vipDiscountNotice1')}
                </p>
                <p style="margin-top: 8px;">
                    {i18n('vipDiscountNotice2')}
                </p>
                <p class="contribution-reward">{i18n('vipContributionRewardDesc')}</p>
                {#if isZhCN || selectedTerm === '7d'}
                    <button
                        class="b3-button b3-button--text pay-btn"
                        disabled={userId === 'unknown' || isPaying}
                        on:click={handlePay}
                    >
                        {selectedTerm === '7d'
                            ? i18n('vipGetTrialKeyBtn')
                            : i18n('vipPayToGetKeyBtn')}
                    </button>
                {/if}
                {#if !isZhCN && selectedTerm !== '7d'}
                    <div class="overseas-notice">
                        <p>{i18n('vipOverseasTransferNotice')}</p>
                        <img
                            src="plugins/siyuan-plugin-task-note-management/assets/Alipay.jpg"
                            alt="Payment QR"
                            class="overseas-qr"
                        />
                    </div>
                {/if}
            </div>

            {#if qrcodeImg}
                <div class="payment-qrcode">
                    <div class="payment-amount">
                        ￥{paymentAmountStr}
                    </div>
                    <img src={qrcodeImg} alt={i18n('vipQRAlt')} />
                    {#if paymentStatusMessage}
                        <p class="payment-status">{paymentStatusMessage}</p>
                    {/if}
                    {#if paymentErrorMessage}
                        <p class="payment-status error-text">{paymentErrorMessage}</p>
                    {/if}
                    <div class="payment-actions">
                        <button
                            class="b3-button b3-button--outline manual-check-btn"
                            on:click={manualCheckStatus}
                            disabled={isCheckingStatus}
                        >
                            {isCheckingStatus ? i18n('vipChecking') : i18n('vipManualCheckBtn')}
                        </button>
                        <button
                            class="b3-button b3-button--outline cancel-btn"
                            on:click={handleCancel}
                        >
                            {i18n('vipCancel')}
                        </button>
                    </div>
                </div>
            {:else}
                {#if paymentStatusMessage}
                    <p class="payment-status">{paymentStatusMessage}</p>
                {/if}
                {#if paymentErrorMessage}
                    <p class="payment-status error-text">{paymentErrorMessage}</p>
                {/if}
            {/if}
        </div>
    {/if}

    {#if !vipStatus.isLifetime}
        <div class="vip-section">
            <h3>{i18n('vipActivationExchange')}</h3>
            <div class="activation-notice">
                <p class="notice-title">{i18n('vipActivationNoticeTitle')}</p>
                <ol>
                    <li>{i18n('vipActivationNotice1')}</li>
                    <li>
                        {i18n('vipActivationNotice2')}
                    </li>
                </ol>
            </div>
            {#if !vipStatus.isVip}
                <button
                    class="b3-button b3-button--outline auto-fill-btn"
                    disabled={isAutoFilling || userId === 'unknown' || !userId}
                    on:click={handleAutoFillKeys}
                >
                    {isAutoFilling ? i18n('vipAutoFillFetching') : i18n('vipAutoFillBtn')}
                </button>
                {#if autoFillMessage}
                    <p class="msg {autoFillError ? 'error' : 'success'}">{autoFillMessage}</p>
                {/if}
            {/if}
            <div class="activation-box">
                <input
                    class="b3-text-field fn__block"
                    placeholder={i18n('vipInputKeyPlaceholder')}
                    bind:value={inputKey}
                />
                <button class="b3-button b3-button--text activate-btn" on:click={handleAddKey}>
                    {i18n('vipActivateBtn')}
                </button>
            </div>
            {#if message}
                <p class="msg {isError ? 'error' : 'success'}">{message}</p>
            {/if}
        </div>
    {/if}

    {#if activeKeys.length > 0}
        <div class="vip-section">
            <h3>{i18n('vipActiveKeys')}</h3>
            <div class="active-keys-list">
                {#each activeKeys as item}
                    <div class="active-key-item">
                        <div class="key-info">
                            <div class="key-text">{item.key}</div>
                            <div class="key-detail">
                                {#if item.isLifetime}
                                    {i18n('vipLifetimeVersion')} ({i18n('vipActivatedAt')}: {item.start})
                                {:else}
                                    {item.term === '1y'
                                        ? i18n('vipAnnualPay')
                                        : item.term === '1m'
                                          ? i18n('vipMonthlyPay')
                                          : i18n('vipTrial7Days')} ({item.start}{i18n(
                                        'vipTo'
                                    )}{item.end})
                                {/if}
                            </div>
                        </div>
                        <button
                            class="b3-button b3-button--text copy-key-btn"
                            on:click={() => handleCopyKey(item.key)}
                        >
                            {i18n('copy') || 'Copy'}
                        </button>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    {#if activeKeys.some(k => k.term !== '7d')}
        <div class="vip-section">
            <h3>{i18n('vipExchangeAndQA')}</h3>
            <div class="activation-notice">
                {i18n('vipExchangeAndQADesc')}
            </div>
        </div>
    {/if}
</div>

<style>
    .payment-qrcode {
        text-align: center;
        background: white;
        padding: 16px;
        border-radius: 8px;
    }
    .overseas-notice {
        margin-top: 12px;
        padding: 10px 12px;
        background: var(--b3-theme-surface);
        border-radius: 8px;
        border: 1px solid var(--b3-border-color);
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.6;
    }
    .overseas-notice p {
        margin-bottom: 8px;
    }
    .overseas-qr {
        display: block;
        margin: 0 auto;
        border-radius: 4px;
    }
    .payment-amount {
        font-size: 28px;
        font-weight: bold;
        color: var(--b3-card-warning-color);
        margin-bottom: 12px;
    }
    .payment-qrcode img {
        width: 160px;
        height: 160px;
    }
    .payment-status {
        font-size: 13px;
        margin-top: 8px;
        color: var(--b3-theme-primary);
        text-align: center;
    }
    .payment-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        justify-content: center;
        padding: 0 16px;
    }
    .manual-check-btn {
        flex: 2;
        margin: 0;
    }
    .cancel-btn {
        flex: 1;
        margin: 0;
    }
    .active-keys-list {
        background: var(--b3-theme-surface);
        border-radius: 8px;
        overflow: hidden;
    }

    .active-key-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 12px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .active-key-item:last-child {
        border-bottom: none;
    }

    .key-info {
        flex: 1;
        min-width: 0;
    }

    .key-text {
        display: block;
        font-family: monospace;
        font-size: 1em;
        color: var(--b3-theme-on-surface);
        width: min(30ch, 100%);
        max-width: 100%;
        white-space: nowrap; /* 强制不换行 */
        overflow: hidden; /* 超出部分隐藏 */
        text-overflow: ellipsis; /* 超出部分显示省略号 */
    }

    .key-detail {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        margin-top: 2px;
    }

    .copy-key-btn {
        color: var(--b3-theme-primary) !important;
        font-size: 12px;
        flex-shrink: 0;
    }
    .vip-container {
        padding: 16px;
        color: var(--b3-theme-on-background);
        max-width: 600px;
        margin: 0 auto;
    }

    .vip-card {
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 24px;
        position: relative;
        overflow: hidden;
    }

    .vip-card.is-lifetime {
        background: linear-gradient(135deg, #eab308, #de8d04);
        color: white;
        box-shadow: 0 10px 25px -5px rgba(234, 179, 8, 0.4);
    }

    .vip-card.is-vip {
        background: linear-gradient(135deg, #a855f7, #7e22ce);
        color: white;
        box-shadow: 0 10px 25px -5px rgba(168, 85, 247, 0.4);
    }

    .vip-card.not-vip {
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-background);
    }

    .vip-card::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
        pointer-events: none;
    }

    .vip-card__title {
        font-size: 24px;
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
    }

    .vip-card__status {
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(4px);
        border-radius: 12px;
        padding: 16px;
    }

    .status-label {
        font-size: 1.5em;
        opacity: 0.9;
        margin-bottom: 4px;
    }

    .status-date {
        font-size: 1em;
        font-weight: 500;
    }

    .status-days {
        font-size: 1em;
        opacity: 0.8;
        margin-top: 4px;
    }

    .status-inactive {
        text-align: center;
        font-size: 1.5em;
        font-weight: 500;
        padding: 10px;
    }

    .vip-section {
        margin-bottom: 24px;
    }

    .vip-section h3 {
        font-size: 16px;
        margin-bottom: 12px;
        border-left: 4px solid var(--b3-theme-primary);
        padding-left: 8px;
    }

    .user-info {
        background: var(--b3-theme-surface);
        border-radius: 8px;
        padding: 12px;
    }

    .user-id {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-family: monospace;
    }

    .user-id-text {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        overflow: hidden;
    }

    .user-id-label {
        flex-shrink: 0;
    }

    .id-value {
        display: block;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: clip;
        white-space: nowrap;
    }

    .eye-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        opacity: 0.6;
        transition: all 0.2s;
    }

    .eye-icon:hover {
        opacity: 1;
        background: var(--b3-theme-background-shallow);
    }

    .eye-icon svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
        color: var(--b3-theme-on-surface);
    }

    .plans-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 16px;
    }

    .plan-item {
        background: linear-gradient(135deg, rgba(249, 115, 22, 0.05), rgba(249, 115, 22, 0.12));
        border: 1px solid rgba(249, 115, 22, 0.2);
        border-radius: 12px;
        padding: 16px 12px;
        text-align: center;
        transition: all 0.2s;
        cursor: pointer;
        position: relative;
        overflow: hidden;
    }

    .plan-item:hover {
        border-color: rgba(249, 115, 22, 0.5);
        background: linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(249, 115, 22, 0.16));
    }

    .plan-item.is-selected {
        border-color: #f97316;
        background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(249, 115, 22, 0.25));
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(249, 115, 22, 0.2);
    }

    .plan-badge {
        position: absolute;
        top: 0;
        right: 0;
        background: linear-gradient(135deg, #f97316, #ea580c);
        color: white;
        font-size: 10px;
        padding: 4px 8px;
        border-bottom-left-radius: 8px;
        font-weight: bold;
        box-shadow: -2px 2px 4px rgba(249, 115, 22, 0.2);
    }

    .plan-label {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .plan-price {
        font-size: 18px;
        font-weight: bold;
        color: var(--b3-card-warning-color);
    }

    .pay-tips {
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.6;
    }

    .pay-btn {
        width: 100%;
        margin-top: 12px;
        height: 40px;
        font-weight: bold;
    }

    .activation-notice {
        background: var(--b3-theme-surface);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        border: 1px solid var(--b3-border-color);
    }

    .activation-notice .notice-title {
        font-weight: bold;
        margin-bottom: 8px;
        color: var(--b3-theme-on-background);
    }

    .activation-notice ol {
        margin: 0;
        padding-left: 20px;
        line-height: 1.8;
    }

    .activation-notice li {
        color: var(--b3-theme-on-surface-light);
    }
    .activation-notice :global(a) {
        color: var(--b3-theme-primary);
        text-decoration: underline;
    }

    .activation-box {
        display: flex;
        gap: 8px;
    }

    .activate-btn {
        white-space: nowrap;
    }

    .auto-fill-btn {
        width: 100%;
        margin-bottom: 8px;
        font-size: 13px;
    }

    .msg {
        font-size: 13px;
        margin-top: 8px;
    }

    .error {
        color: var(--b3-theme-error);
    }
    .success {
        color: var(--b3-theme-info);
    }
    .error-text {
        color: var(--b3-theme-error);
        font-size: 13px;
        margin-top: 8px;
    }

    .benefits-details {
        background: var(--b3-theme-surface);
        border-radius: 8px;
        padding: 12px;
        border: 1px solid var(--b3-border-color);
    }
    .benefits-details summary {
        cursor: pointer;
        font-weight: bold;
        color: var(--b3-theme-primary);
        outline: none;
    }
    .benefits-table {
        width: 100%;
        margin-top: 12px;
        border-collapse: collapse;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        border: 1px solid var(--b3-theme-primary);
    }
    .benefits-table th,
    .benefits-table td {
        border: 1px solid var(--b3-theme-primary);
        padding: 8px;
        text-align: center;
    }
    .benefits-table th {
        background: var(--b3-theme-background-shallow);
        font-weight: bold;
    }
    .benefits-info {
        margin-top: 16px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.6;
    }
    .benefits-info h4 {
        margin-bottom: 4px;
        color: var(--b3-theme-on-surface);
        font-size: 13px;
    }

    .in-dialog {
        max-height: 80vh;
        overflow-y: auto;
    }

    @media (max-width: 520px) {
        .user-id {
            flex-direction: column;
            align-items: stretch;
        }

        .user-id-text {
            width: 100%;
        }

        .user-id .b3-button {
            width: 100%;
            justify-content: center;
        }

        .active-key-item {
            flex-direction: column;
            align-items: stretch;
        }

        .copy-key-btn {
            width: 100%;
            justify-content: center;
        }
    }
</style>
