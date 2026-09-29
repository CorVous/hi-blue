export type CapHitReason = "per-ip-daily" | "global-daily";

export class CapHitError extends Error {
	readonly status = 429 as const;
	readonly reason: CapHitReason;
	readonly retryAfterSec: number | null;

	constructor(opts: {
		message: string;
		reason: CapHitReason;
		retryAfterSec: number | null;
	}) {
		super(opts.message);
		this.name = "CapHitError";
		this.reason = opts.reason;
		this.retryAfterSec = opts.retryAfterSec;
	}
}

export class UpstreamErrorBodyError extends Error {
	readonly upstreamMessage: string;
	readonly upstreamCode: string | null;

	constructor(opts: {
		upstreamMessage: string;
		upstreamCode?: string | null;
	}) {
		super(`upstream returned 200 with error body: ${opts.upstreamMessage}`);
		this.name = "UpstreamErrorBodyError";
		this.upstreamMessage = opts.upstreamMessage;
		this.upstreamCode = opts.upstreamCode ?? null;
	}
}

export class HttpStatusError extends Error {
	readonly status: number;
	readonly upstreamMessage: string | null;
	readonly retryAfterSec: number | null;

	constructor(opts: {
		status: number;
		statusText: string;
		upstreamMessage: string | null;
		retryAfterSec: number | null;
	}) {
		const statusLine = `HTTP ${opts.status}: ${opts.statusText}`;
		super(
			opts.upstreamMessage === null
				? statusLine
				: `${statusLine} — ${opts.upstreamMessage}`,
		);
		this.name = "HttpStatusError";
		this.status = opts.status;
		this.upstreamMessage = opts.upstreamMessage;
		this.retryAfterSec = opts.retryAfterSec;
	}
}

const STATUSES_A_RETRY_CANNOT_FIX: ReadonlySet<number> = new Set([
	400, 401, 402, 403,
]);

export function isRetryPointless(err: unknown): boolean {
	if (err instanceof CapHitError) return true;
	return (
		err instanceof HttpStatusError &&
		STATUSES_A_RETRY_CANNOT_FIX.has(err.status)
	);
}

export function upstreamMessageOf(err: unknown): string | null {
	if (err instanceof HttpStatusError) {
		return err.upstreamMessage === null
			? `HTTP ${err.status}`
			: `HTTP ${err.status}: ${err.upstreamMessage}`;
	}
	if (err instanceof UpstreamErrorBodyError) return err.upstreamMessage;
	return null;
}
