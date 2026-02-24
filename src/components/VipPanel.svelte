<script lang="ts">
    import { VipManager, type VIPStatus } from '../utils/vip';
    import { pushMsg } from '../api';

    export let plugin: any;
    export let isDialog: boolean = false;

    let userId = VipManager.getUserId();
    let vipStatus: VIPStatus = VipManager.checkAndUpdateVipStatus(plugin);
    let inputKey = '';
    let message = '';
    let isError = false;
    let showUserId = false;

    let selectedTerm = '1y'; // 默认选中年付

    const currentPrices = [
        { term: '7d', label: '试用 7 天', price: '试用' },
        { term: '1m', label: '月付', price: '5 元' },
        { term: '1y', label: '年付', price: '30 元' },
        { term: 'Lifetime', label: '终身', price: '99 元' },
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
                paymentStatusMessage = '支付成功！';
                isPaying = false;
                qrcodeImg = '';
                if (result.activation_code) {
                    inputKey = result.activation_code;
                    handleAddKey();
                }
            } else {
                paymentErrorMessage = '订单暂未支付或查询失败';
            }
        } catch (error) {
            console.error('Manual check failed', error);
            paymentErrorMessage = '查询异常，请稍后重试';
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
        paymentStatusMessage = '正在创建订单...';
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
                paymentStatusMessage = '二维码已生成，请使用支付宝扫描';
                paymentAmountStr = result.money || '';
            } else {
                paymentStatusMessage = '';
                paymentErrorMessage = result.message || '创建订单失败';
                isPaying = false;
            }
        } catch (error) {
            paymentStatusMessage = '';
            paymentErrorMessage = '发生异常，请稍后重试';
            isPaying = false;
        }
    }

    async function handleFreeTrial() {
        paymentStatusMessage = '正在请求试用激活码...';
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
                paymentStatusMessage = '试用激活码已获取并自动填入';
            } else {
                paymentStatusMessage = '';
                paymentErrorMessage = result.message || '获取试用激活码失败';
            }
        } catch (error) {
            paymentStatusMessage = '';
            paymentErrorMessage = '获取试用激活码失败';
        }
    }

    function handleAddKey() {
        if (!inputKey) return;

        const result = VipManager.parseVIPKey(userId, inputKey);
        if (!result.valid) {
            message = '激活码无效或不属于当前用户';
            isError = true;
            return;
        }

        if (plugin.vip.vipKeys.includes(inputKey)) {
            message = '该激活码已添加';
            isError = false;
            return;
        }

        if (result.term === '7d') {
            plugin.vip.freeTrialUsed = true;
        }

        plugin.vip.vipKeys = [...plugin.vip.vipKeys, inputKey];
        plugin = plugin; // 触发 Svelte 响应式更新

        // 更新内存中的 VIP 状态，以便保存时数据一致
        vipStatus = VipManager.checkAndUpdateVipStatus(plugin);
        plugin.vip.isVip = vipStatus.isVip;
        plugin.vip.expireDate = vipStatus.expireDate;

        // 保存并触发更新
        (async () => {
            await plugin.saveVipData(plugin.vip);
            window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
        })();

        inputKey = '';
        message = '激活成功！';
        isError = false;
    }

    function handleCopyUserId() {
        navigator.clipboard.writeText(userId);
        pushMsg('用户 ID 已复制');
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
            const termMs = VipManager.getTermMs(k.term, k.purchaseTime);
            let start = k.purchaseTime;
            if (currentExpire > start) {
                start = currentExpire;
            }
            const end =
                k.term === 'Lifetime'
                    ? new Date(k.purchaseTime).setFullYear(
                          new Date(k.purchaseTime).getFullYear() + 999
                      )
                    : start + termMs;

            currentExpire = end;

            if (end > now) {
                results.push({
                    key: k.key,
                    term: k.term,
                    start: VipManager.formatDate(new Date(start)),
                    end: VipManager.formatDate(new Date(end)),
                    isLifetime: k.term === 'Lifetime',
                });
            }
        }

        if (results.some(r => r.isLifetime)) {
            results = results.filter(r => r.isLifetime);
        }

        return results;
    })();

    function handleCopyKey(key: string) {
        navigator.clipboard.writeText(key);
        pushMsg('激活码已复制');
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
                订阅信息
            </div>
            <div class="vip-card__status">
                {#if vipStatus.isVip}
                    {#if vipStatus.isLifetime}
                        <div class="status-active">
                            <div class="status-label">终身会员</div>
                            <div class="status-date">
                                始于 {vipStatus.lifetimeStartDate || '购入之日'}
                            </div>
                        </div>
                    {:else}
                        <div class="status-active">
                            <div class="status-label">已激活</div>
                            <div class="status-date">
                                {vipStatus.expireDate} 到期
                            </div>
                            <div class="status-days">
                                剩余 {vipStatus.remainingDays} 天
                            </div>
                        </div>
                    {/if}
                {:else}
                    <div class="status-inactive">未订阅</div>
                {/if}
            </div>
        </div>
    </div>

    <div class="vip-section">
        <h3>用户信息</h3>
        <div class="user-info">
            <div class="user-id">
                <div class="user-id-text">
                    <span>思源账号ID:</span>
                    <span class="id-value" style="letter-spacing: {showUserId ? 'normal' : '2px'};">
                        {showUserId ? userId : '••••••••'}
                    </span>
                    <div
                        class="eye-icon"
                        on:click={() => (showUserId = !showUserId)}
                        role="button"
                        tabindex="0"
                        on:keydown={e =>
                            (e.key === 'Enter' || e.key === ' ') && (showUserId = !showUserId)}
                        title={showUserId ? '隐藏' : '显示'}
                    >
                        {#if showUserId}
                            <svg><use xlink:href="#iconEyeoff"></use></svg>
                        {:else}
                            <svg><use xlink:href="#iconEye"></use></svg>
                        {/if}
                    </div>
                </div>
                {#if userId !== 'unknown' && userId}
                    <button
                        class="b3-button b3-button--outline fn__flex-center"
                        on:click={handleCopyUserId}
                    >
                        复制
                    </button>
                {/if}
            </div>
            {#if userId === 'unknown' || !userId}
                <p class="error-text">⚠️ 请先登录思源账号以使用订阅功能</p>
            {/if}
        </div>
    </div>

    {#if !vipStatus.isLifetime}
        <div class="vip-section">
            <h3>订阅方案</h3>

            <div class="vip-section">
                <details class="benefits-details">
                    <summary>查看会员专属权益</summary>
                    <table class="benefits-table">
                        <thead>
                            <tr>
                                <th>功能</th>
                                <th>非会员</th>
                                <th>会员</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>任务管理侧栏</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>番茄钟</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>四象限</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>习惯打卡</td>
                                <td>✅</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>日历视图</td>
                                <td>❌</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>项目看板</td>
                                <td>❌</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>微信交流群和使用答疑</td>
                                <td>❌</td>
                                <td>✅</td>
                            </tr>
                            <tr>
                                <td>未来其他功能</td>
                                <td>❓</td>
                                <td>✅</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="benefits-info">
                        <h4>❓如何加入会员专属微信交流群</h4>
                        <p>将付款截图、微信号发邮件到 achuan-2@outlook.com，我会加你好友拉你进群</p>
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
                            <div class="plan-badge">已选中</div>
                        {/if}
                    </div>
                {/each}
            </div>
            <div class="pay-tips">
                <p>⚠️ 付费后不支持退款</p>
                <p>
                    ⚠️
                    2026年02月23日及之前赞赏的用户，可以凭赞赏截图，以过去赞赏总额×2的优惠减免付费会员金额，2026年02月23日及之前赞赏超过50元的用户和代码PR贡献者，可申请为终身会员。发送赞赏支付截图/代码贡献截图以及思源账号ID（通过上方的用户信息复制）到
                    achuan-2@outlook.com 进行申请减免和终身会员。
                </p>
                <p>⚠️ 思源笔记开发者（在思源集市上架作品或为思源贡献PR被采纳）或在校学生，凭相关证明可享6折会员优惠。</p>
                <button
                    class="b3-button b3-button--text pay-btn"
                    disabled={userId === 'unknown' || isPaying}
                    on:click={handlePay}
                >
                    {selectedTerm === '7d' ? '获取试用激活码' : '付费获取激活码'}
                </button>
            </div>

            {#if qrcodeImg}
                <div class="payment-qrcode">
                    <div class="payment-amount">
                        ￥{paymentAmountStr}
                    </div>
                    <img src={qrcodeImg} alt="支付二维码" />
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
                            {isCheckingStatus ? '查询中...' : '我已支付，获取激活码'}
                        </button>
                        <button
                            class="b3-button b3-button--outline cancel-btn"
                            on:click={handleCancel}
                        >
                            取消
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
            <h3>激活码兑换</h3>
            <div class="activation-notice">
                <p class="notice-title">📋 激活码使用须知：</p>
                <ol>
                    <li>激活码只限绑定的单个思源账户使用，无法用于其他用户</li>
                    <li>激活码不限激活次数，可离线激活VIP功能：其他设备只需要同步工作空间数据或登录激活码所绑定的思源账号即可使用VIP功能</li>
                </ol>
            </div>
            <div class="activation-box">
                <input
                    class="b3-text-field fn__block"
                    placeholder="输入激活码"
                    bind:value={inputKey}
                />
                <button class="b3-button b3-button--text activate-btn" on:click={handleAddKey}>
                    激活
                </button>
            </div>
            {#if message}
                <p class="msg {isError ? 'error' : 'success'}">{message}</p>
            {/if}
        </div>
    {/if}

    {#if activeKeys.length > 0}
        <div class="vip-section">
            <h3>使用中的激活码</h3>
            <div class="active-keys-list">
                {#each activeKeys as item}
                    <div class="active-key-item">
                        <div class="key-info">
                            <div class="key-text">{item.key}</div>
                            <div class="key-detail">
                                {item.isLifetime
                                    ? `终身版 (始于: ${item.start})`
                                    : `${item.term === '1y' ? '年付' : item.term === '1m' ? '月付' : '试用 7 天'} (${item.start} 至 ${item.end})`}
                            </div>
                        </div>
                        <button
                            class="b3-button b3-button--text copy-key-btn"
                            on:click={() => handleCopyKey(item.key)}
                        >
                            复制
                        </button>
                    </div>
                {/each}
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
        padding: 12px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .active-key-item:last-child {
        border-bottom: none;
    }

    .key-info {
        flex: 1;
    }

    .key-text {
        font-family: monospace;
        font-size: 1em;
        color: var(--b3-theme-on-surface);
        width: 30ch;
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
        font-family: monospace;
    }

    .user-id-text {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .eye-icon {
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

    .activation-box {
        display: flex;
        gap: 8px;
    }

    .activate-btn {
        white-space: nowrap;
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
    .benefits-info a {
        color: var(--b3-theme-primary);
        text-decoration: none;
    }
    .benefits-info a:hover {
        text-decoration: underline;
    }

    .in-dialog {
        max-height: 80vh;
        overflow-y: auto;
    }
</style>
