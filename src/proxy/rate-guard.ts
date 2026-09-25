import { USD_TO_MICRO_USD } from "./pricing";

export interface CostGuardConfig {
	perIpDailyMicroUsdMax: number;
	globalDailyMicroUsdMax: number;
	preChargeMicroUsd: number;
}

export type CostChargeResult =
	| { allowed: true; preCharged: number }
	| { allowed: false; reason: "per-ip-daily" | "global-daily" };

export function utcDateKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function perIpKey(ip: string, nowMs: number): string {
	return `cost:ip:${utcDateKey(nowMs)}:${ip}`;
}

export function globalKey(nowMs: number): string {
	return `cost:global:${utcDateKey(nowMs)}`;
}

const DAILY_COUNTER_TTL_SEC = 25 * 60 * 60;

export async function preCharge(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	cfg: CostGuardConfig,
): Promise<CostChargeResult> {
	const ipKey = perIpKey(ip, nowMs);
	const gKey = globalKey(nowMs);

	const [rawIp, rawGlobal] = await Promise.all([kv.get(ipKey), kv.get(gKey)]);

	const perIp = rawIp === null ? 0 : Number.parseInt(rawIp, 10);
	const global = rawGlobal === null ? 0 : Number.parseInt(rawGlobal, 10);

	if (perIp + cfg.preChargeMicroUsd > cfg.perIpDailyMicroUsdMax) {
		return { allowed: false, reason: "per-ip-daily" };
	}

	if (global + cfg.preChargeMicroUsd > cfg.globalDailyMicroUsdMax) {
		return { allowed: false, reason: "global-daily" };
	}

	await Promise.all([
		kv.put(ipKey, String(perIp + cfg.preChargeMicroUsd), {
			expirationTtl: DAILY_COUNTER_TTL_SEC,
		}),
		kv.put(gKey, String(global + cfg.preChargeMicroUsd), {
			expirationTtl: DAILY_COUNTER_TTL_SEC,
		}),
	]);

	return { allowed: true, preCharged: cfg.preChargeMicroUsd };
}

export async function reconcile(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
	actualMicroUsd: number,
): Promise<void> {
	const unusedPreChargeMicroUsd = preCharged - actualMicroUsd;
	if (unusedPreChargeMicroUsd <= 0) return;

	const ipKey = perIpKey(ip, nowMs);
	const gKey = globalKey(nowMs);

	const [rawIp, rawGlobal] = await Promise.all([kv.get(ipKey), kv.get(gKey)]);

	const perIp = rawIp === null ? 0 : Number.parseInt(rawIp, 10);
	const global = rawGlobal === null ? 0 : Number.parseInt(rawGlobal, 10);

	await Promise.all([
		kv.put(ipKey, String(Math.max(0, perIp - unusedPreChargeMicroUsd)), {
			expirationTtl: DAILY_COUNTER_TTL_SEC,
		}),
		kv.put(gKey, String(Math.max(0, global - unusedPreChargeMicroUsd)), {
			expirationTtl: DAILY_COUNTER_TTL_SEC,
		}),
	]);
}

export async function refundFull(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
): Promise<void> {
	return reconcile(kv, ip, nowMs, preCharged, 0);
}

export function rateLimitResponse(
	reason: "per-ip-daily" | "global-daily",
	nowMs: number,
): Response {
	const message =
		reason === "per-ip-daily"
			? "You have exceeded your daily spend limit. Please try again tomorrow."
			: "The global daily budget has been exhausted. Please try again tomorrow.";

	const nowDate = new Date(nowMs);
	const nextMidnight = new Date(
		Date.UTC(
			nowDate.getUTCFullYear(),
			nowDate.getUTCMonth(),
			nowDate.getUTCDate() + 1,
		),
	);
	const retryAfterSec = Math.ceil((nextMidnight.getTime() - nowMs) / 1000);

	return new Response(
		JSON.stringify({
			error: {
				message,
				type: "rate_limit_exceeded",
				code: reason,
			},
		}),
		{
			status: 429,
			headers: {
				"Content-Type": "application/json",
				"Retry-After": String(retryAfterSec),
			},
		},
	);
}

const DEFAULT_PER_IP_DAILY_MICRO_USD = 1 * USD_TO_MICRO_USD;
const DEFAULT_GLOBAL_DAILY_MICRO_USD = 10 * USD_TO_MICRO_USD;
const DEFAULT_PRE_CHARGE_MICRO_USD = 0.005 * USD_TO_MICRO_USD;

export function configFromEnv(env: {
	PER_IP_DAILY_MICRO_USD_MAX?: string;
	GLOBAL_DAILY_MICRO_USD_MAX?: string;
	PRE_CHARGE_MICRO_USD?: string;
}): CostGuardConfig {
	return {
		perIpDailyMicroUsdMax:
			env.PER_IP_DAILY_MICRO_USD_MAX != null
				? Number(env.PER_IP_DAILY_MICRO_USD_MAX)
				: DEFAULT_PER_IP_DAILY_MICRO_USD,
		globalDailyMicroUsdMax:
			env.GLOBAL_DAILY_MICRO_USD_MAX != null
				? Number(env.GLOBAL_DAILY_MICRO_USD_MAX)
				: DEFAULT_GLOBAL_DAILY_MICRO_USD,
		preChargeMicroUsd:
			env.PRE_CHARGE_MICRO_USD != null
				? Number(env.PRE_CHARGE_MICRO_USD)
				: DEFAULT_PRE_CHARGE_MICRO_USD,
	};
}
