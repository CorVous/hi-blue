import type {
	PendingBootstrap,
	PendingCallMeta,
} from "../game/pending-bootstrap.js";

const ELAPSED_TICK_INTERVAL_MS = 100;

let _tickerInterval: ReturnType<typeof setInterval> | undefined;
let _tickerContainer: HTMLElement | undefined;
let _currentMeta: PendingCallMeta | undefined;

function getStatusInfo(status: PendingBootstrap["status"]): {
	pip: string;
	word: string;
	state: string;
} {
	switch (status) {
		case "pending":
		case "personas-ready":
			return { pip: "●", word: "fetching", state: "in-flight" };
		case "failed":
			return { pip: "✕", word: "errored", state: "errored" };
		case "ready":
			return { pip: "○", word: "ready", state: "idle" };
	}
}

function formatElapsed(startedAtMs: number | undefined): string | undefined {
	if (startedAtMs === undefined) return undefined;
	const elapsed = (Date.now() - startedAtMs) / 1000;
	return `${elapsed.toFixed(1)}s elapsed`;
}

function field(containerEl: HTMLElement, name: string): HTMLElement | null {
	return containerEl.querySelector<HTMLElement>(`[data-field="${name}"]`);
}

function showOptional(
	sep: HTMLElement | null,
	el: HTMLElement | null,
	text: string | undefined,
): void {
	if (sep) {
		sep.setAttribute("hidden", "");
		if (text) sep.removeAttribute("hidden");
	}
	if (!el) return;
	if (text) {
		el.textContent = text;
		el.removeAttribute("hidden");
	} else {
		el.setAttribute("hidden", "");
	}
}

function updatePendingStripContent(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	const statusInfo = getStatusInfo(pending.status);

	const pipEl = field(containerEl, "pip");
	if (pipEl) {
		pipEl.textContent = statusInfo.pip;
		pipEl.setAttribute("data-state", statusInfo.state);
	}

	const statusWordEl = field(containerEl, "status-word");
	if (statusWordEl) {
		statusWordEl.textContent = statusInfo.word;
	}

	showOptional(null, field(containerEl, "call-name"), callMeta?.callName);

	showOptional(
		field(containerEl, "sep-retry"),
		field(containerEl, "retry"),
		callMeta?.retryCount && callMeta.retryCount > 0
			? `retry ${callMeta.retryCount}/${callMeta.retryMax ?? 3}`
			: undefined,
	);

	showOptional(
		field(containerEl, "sep-elapsed"),
		field(containerEl, "elapsed"),
		formatElapsed(callMeta?.startedAtMs),
	);

	showOptional(
		field(containerEl, "sep-error"),
		field(containerEl, "last-error"),
		callMeta?.lastError ? `last error: ${callMeta.lastError}` : undefined,
	);
}

function updateElapsedSpan(
	containerEl: HTMLElement,
	callMeta?: PendingCallMeta,
): void {
	const elapsedEl = field(containerEl, "elapsed");
	if (!elapsedEl) return;
	const elapsedText = formatElapsed(callMeta?.startedAtMs);
	if (elapsedText) {
		elapsedEl.textContent = elapsedText;
	}
}

const PENDING_STRIP_SPANS: readonly {
	field: string;
	text?: string;
	className?: string;
}[] = [
	{ field: "pip", className: "dev-pending-pip dev-footer-pip" },
	{ field: "status-word" },
	{ field: "call-name" },
	{ field: "sep-retry", text: "·" },
	{ field: "retry" },
	{ field: "sep-elapsed", text: "·" },
	{ field: "elapsed" },
	{ field: "sep-error", text: "·" },
	{ field: "last-error" },
];

function stopTicker(): void {
	if (_tickerInterval) clearInterval(_tickerInterval);
	_tickerInterval = undefined;
	_tickerContainer = undefined;
}

export function renderPendingStrip(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	stopTicker();

	_currentMeta = callMeta;
	_tickerContainer = containerEl;

	containerEl.classList.add("dev-strip", "dev-pending-strip");
	containerEl.setAttribute("data-strip", "pending");
	containerEl.replaceChildren();

	const line = containerEl.ownerDocument.createElement("div");
	line.className = "dev-strip-line";
	line.setAttribute("data-line", "pending");

	for (const { field: name, text, className } of PENDING_STRIP_SPANS) {
		const span = containerEl.ownerDocument.createElement("span");
		if (className) span.className = className;
		span.setAttribute("data-field", name);
		if (text) span.textContent = text;
		line.appendChild(span);
	}

	containerEl.appendChild(line);

	updatePendingStripContent(containerEl, pending, _currentMeta);

	_tickerInterval = setInterval(() => {
		if (!_tickerContainer?.isConnected) {
			stopTicker();
			return;
		}
		updateElapsedSpan(_tickerContainer, _currentMeta);
	}, ELAPSED_TICK_INTERVAL_MS);
}

export function updatePendingStrip(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	_currentMeta = callMeta;
	updatePendingStripContent(containerEl, pending, _currentMeta);
}

export function clearPendingStrip(containerEl: HTMLElement | null): void {
	stopTicker();
	_currentMeta = undefined;
	if (!containerEl) return;
	containerEl.classList.remove("dev-strip", "dev-pending-strip");
	containerEl.removeAttribute("data-strip");
	containerEl.replaceChildren();
}

export function __resetPendingStripForTests(): void {
	stopTicker();
	_currentMeta = undefined;
}
