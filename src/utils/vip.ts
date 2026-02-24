import { ec as EC } from "elliptic";
import { fetchSyncPost } from "siyuan";

const ec = new EC("secp256k1");

/**
 * VIP 功能管理器
 * 实现本地 VIP 验证，不依赖网络
 */

// 开发者公钥，用于验证权限。这个公钥必须硬编码在插件中。
const PUBLIC_KEY = "04d460cc7f5e41bf5aab87b18b38cb6b317e6beffd46942d6b4a6357530ea94e84c552ace2ade7f30df60060d99a8873f373a52d6d8ea129760aee0991bf3bfd30";

export interface VIPStatus {
    /** 激活码列表 */
    vipKeys: string[];
    /** 是否是 VIP */
    isVip: boolean;
    /** 到期日期 "YYYY-MM-DD HH:mm" */
    expireDate: string;
    /** 剩余天数 */
    remainingDays: number;
    /** 是否已使用过试用 */
    freeTrialUsed: boolean;
    /** 错误信息 */
    error?: string;
    /** 是否终身会员 */
    isLifetime?: boolean;
    /** 终身会员开始时间 */
    lifetimeStartDate?: string;
}

export type PurchaseTerm = '7d' | '1m' | '1y' | 'Lifetime';

export class VipManager {

    /**
     * 单个激活码验证并解析
     */
    static parseVIPKey(userId: string, vipKey: string): { purchaseTime: number, term: PurchaseTerm, valid: boolean } {
        if (!vipKey || !vipKey.includes('_')) {
            return { purchaseTime: 0, term: '7d', valid: false };
        }

        try {
            const parts = vipKey.split('_');
            if (parts.length !== 3) return { purchaseTime: 0, term: '7d', valid: false };

            const [encodedPurchase, term, signature] = parts;
            const purchaseSeconds = parseInt(encodedPurchase, 36);
            if (isNaN(purchaseSeconds)) return { purchaseTime: 0, term: '7d', valid: false };

            const purchaseTime = purchaseSeconds * 1000;
            const message = `${userId}|${purchaseSeconds}|${term}`;
            const key = ec.keyFromPublic(PUBLIC_KEY, 'hex');

            const valid = key.verify(message, signature);
            // console.log({ purchaseTime, term: term as PurchaseTerm, valid });
            return { purchaseTime, term: term as PurchaseTerm, valid };
        } catch (e) {
            return { purchaseTime: 0, term: '7d', valid: false };
        }
    }

    /**
     * 计算累计到期时间
     */
    static calculateStatus(userId: string, vipKeys: string[], freeTrialUsed: boolean = false): VIPStatus {
        const validKeys = vipKeys
            .map(k => this.parseVIPKey(userId, k))
            .filter(k => k.valid)
            .sort((a, b) => a.purchaseTime - b.purchaseTime);

        if (validKeys.length === 0) {
            return { vipKeys, isVip: false, expireDate: '', remainingDays: 0, freeTrialUsed };
        }

        let currentExpire: number = 0;
        let isLifetime: boolean = false;
        let lifetimeStartDate: string | undefined;

        for (const key of validKeys) {
            const termMs = this.getTermMs(key.term, key.purchaseTime);

            if (key.term === 'Lifetime') {
                // 终身版直接设置一个极远的时间
                currentExpire = new Date(key.purchaseTime).setFullYear(new Date(key.purchaseTime).getFullYear() + 99);
                isLifetime = true;
                lifetimeStartDate = this.formatDate(new Date(key.purchaseTime));
                break; // 终身之后不再累加
            }

            if (currentExpire < key.purchaseTime) {
                // 已过期或首次购买
                currentExpire = key.purchaseTime + termMs;
            } else {
                // 续费累加
                currentExpire += termMs;
            }
        }

        const now = Date.now();

        // 防止用户修改系统时间到过去：如果当前时间早于激活码的购买时间，视为时间被篡改，暂不激活 VIP 功能
        const isTimeTampered = validKeys.some(k => k.purchaseTime > now);
        const isVip = !isTimeTampered && currentExpire > now;

        const remainingMs = Math.max(0, currentExpire - now);
        const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

        return {
            vipKeys,
            isVip,
            expireDate: this.formatDate(new Date(currentExpire)),
            remainingDays: isVip ? remainingDays : 0,
            freeTrialUsed,
            isLifetime,
            lifetimeStartDate
        };
    }

    static getTermMs(term: PurchaseTerm, purchaseTime: number): number {
        const date = new Date(purchaseTime);
        const start = date.getTime();
        switch (term) {
            case '7d': return 7 * 24 * 60 * 60 * 1000;
            case '1m': return 30 * 24 * 60 * 60 * 1000;
            case '1y':
                date.setFullYear(date.getFullYear() + 1);
                return date.getTime() - start;
            case 'Lifetime': return 999 * 365 * 24 * 60 * 60 * 1000;
            default: return 0;
        }
    }

    static formatDate(date: Date): string {
        const Y = date.getFullYear();
        const M = String(date.getMonth() + 1).padStart(2, '0');
        const D = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${Y}-${M}-${D} ${h}:${m}`;
    }

    private static cachedUserId: string | null = null;
    private static cachedCheckPromise: Promise<string> | null = null;

    static async getUserId(): Promise<string> {
        const userId = (window as any).siyuan?.user?.userId;
        const userToken = (window as any).siyuan?.user?.userToken;

        if (userId && userToken) {
            if (this.cachedUserId === userId) return userId;
            if (this.cachedCheckPromise) return this.cachedCheckPromise;

            this.cachedCheckPromise = (async () => {
                try {
                    let res = await fetchSyncPost("/api/setting/getCloudUser", {
                    });
                    if (res && res.data && res.data.userId === userId) {
                        this.cachedUserId = userId;
                        return userId;
                    }
                } catch (e) {
                    console.warn("Verify cloud user error", e);
                } finally {
                    this.cachedCheckPromise = null;
                }
                return 'unknown';
            })();
            return this.cachedCheckPromise;
        }
        return 'unknown';
    }

    /**
     * 检查设置中的 VIP 状态
     */
    static async checkAndUpdateVipStatus(target: any): Promise<VIPStatus> {
        const userId = await this.getUserId();
        // target 可以是插件实例 (target.vip) 或者是直接的 VIP 数据对象 (target.vipKeys)
        const vipKeys = (target.vip?.vipKeys) || (target.vipKeys) || [];
        const freeTrialUsed = (target.vip?.freeTrialUsed) || (target.freeTrialUsed) || false;

        return this.calculateStatus(userId, vipKeys, freeTrialUsed);
    }

    /**
     * 快速检查是否为 VIP
     */
    static async isVip(target: any): Promise<boolean> {
        const status = await this.checkAndUpdateVipStatus(target);
        return status.isVip;
    }
}
