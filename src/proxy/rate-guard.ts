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
	return `cost:ip:${utcDateKey(nowMs)}:${ipRateLimitSubject(ip)}`;
}

const IPV6_GROUP_COUNT = 8;
const IPV6_PREFIX_GROUP_COUNT = 4;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

export function ipRateLimitSubject(ip: string): string {
	if (!ip.includes(":")) return ip;
	const lastGroup = ip.slice(ip.lastIndexOf(":") + 1);
	if (lastGroup.includes(".")) return lastGroup;
	const groups = expandIpv6Groups(ip);
	if (groups === null) return ip;
	return `${groups.slice(0, IPV6_PREFIX_GROUP_COUNT).join(":")}::/64`;
}

function expandIpv6Groups(ip: string): string[] | null {
	const address = (ip.split("%")[0] ?? "").toLowerCase();
	const halves = address.split("::");
	if (halves.length > 2) return null;
	const splitGroups = (half: string | undefined): string[] =>
		half ? half.split(":") : [];
	const head = splitGroups(halves[0]);
	const tail = splitGroups(halves[1]);
	const missing = IPV6_GROUP_COUNT - head.length - tail.length;
	const isCompressed = halves.length === 2;
	if (isCompressed ? missing < 1 : missing !== 0) return null;
	const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
	if (!groups.every((group) => IPV6_GROUP_PATTERN.test(group))) return null;
	return groups.map((group) => Number.parseInt(group, 16).toString(16));
}

export function globalKey(nowMs: number): string {
	return `cost:global:${utcDateKey(nowMs)}`;
}

const DAILY_COUNTER_TTL_SEC = 25 * 60 * 60;

const CORRUPT_COUNTER = Number.POSITIVE_INFINITY;

interface CounterKeys {
	ipKey: string;
	gKey: string;
}

interface Counters {
	perIp: number;
	global: number;
}

function counterKeys(ip: string, nowMs: number): CounterKeys {
	return { ipKey: perIpKey(ip, nowMs), gKey: globalKey(nowMs) };
}

function parseCounter(raw: string | null): number {
	if (raw === null) return 0;
	const value = Number(raw);
	return Number.isFinite(value) ? value : CORRUPT_COUNTER;
}

async function readCounters(
	kv: KVNamespace,
	{ ipKey, gKey }: CounterKeys,
): Promise<Counters> {
	const [rawIp, rawGlobal] = await Promise.all([kv.get(ipKey), kv.get(gKey)]);
	return { perIp: parseCounter(rawIp), global: parseCounter(rawGlobal) };
}

async function writeCounters(
	kv: KVNamespace,
	{ ipKey, gKey }: CounterKeys,
	{ perIp, global }: Counters,
): Promise<void> {
	const writes: Promise<void>[] = [];
	if (Number.isFinite(perIp)) {
		writes.push(
			kv.put(ipKey, String(perIp), { expirationTtl: DAILY_COUNTER_TTL_SEC }),
		);
	}
	if (Number.isFinite(global)) {
		writes.push(
			kv.put(gKey, String(global), { expirationTtl: DAILY_COUNTER_TTL_SEC }),
		);
	}
	await Promise.all(writes);
}

export async function preCharge(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	cfg: CostGuardConfig,
): Promise<CostChargeResult> {
	const keys = counterKeys(ip, nowMs);
	const { perIp, global } = await readCounters(kv, keys);

	if (perIp + cfg.preChargeMicroUsd > cfg.perIpDailyMicroUsdMax) {
		return { allowed: false, reason: "per-ip-daily" };
	}

	if (global + cfg.preChargeMicroUsd > cfg.globalDailyMicroUsdMax) {
		return { allowed: false, reason: "global-daily" };
	}

	await writeCounters(kv, keys, {
		perIp: perIp + cfg.preChargeMicroUsd,
		global: global + cfg.preChargeMicroUsd,
	});

	return { allowed: true, preCharged: cfg.preChargeMicroUsd };
}

async function adjustCharge(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	deltaMicroUsd: number,
): Promise<void> {
	if (deltaMicroUsd === 0 || !Number.isFinite(deltaMicroUsd)) return;

	const keys = counterKeys(ip, nowMs);
	const { perIp, global } = await readCounters(kv, keys);

	await writeCounters(kv, keys, {
		perIp: Math.max(0, perIp + deltaMicroUsd),
		global: Math.max(0, global + deltaMicroUsd),
	});
}

export function reconcile(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
	actualMicroUsd: number,
): Promise<void> {
	return adjustCharge(kv, ip, nowMs, actualMicroUsd - preCharged);
}

export function refundFull(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
): Promise<void> {
	return adjustCharge(kv, ip, nowMs, -preCharged);
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

const DEFAULT_PER_IP_DAILY_MICRO_USD = 1_000_000;
const DEFAULT_GLOBAL_DAILY_MICRO_USD = 10_000_000;
const DEFAULT_PRE_CHARGE_MICRO_USD = 5_000;

function numOr(raw: string | undefined, fallback: number): number {
	if (raw == null || raw.trim() === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function configFromEnv(env: {
	PER_IP_DAILY_MICRO_USD_MAX?: string;
	GLOBAL_DAILY_MICRO_USD_MAX?: string;
	PRE_CHARGE_MICRO_USD?: string;
}): CostGuardConfig {
	return {
		perIpDailyMicroUsdMax: numOr(
			env.PER_IP_DAILY_MICRO_USD_MAX,
			DEFAULT_PER_IP_DAILY_MICRO_USD,
		),
		globalDailyMicroUsdMax: numOr(
			env.GLOBAL_DAILY_MICRO_USD_MAX,
			DEFAULT_GLOBAL_DAILY_MICRO_USD,
		),
		preChargeMicroUsd: numOr(
			env.PRE_CHARGE_MICRO_USD,
			DEFAULT_PRE_CHARGE_MICRO_USD,
		),
	};
}
