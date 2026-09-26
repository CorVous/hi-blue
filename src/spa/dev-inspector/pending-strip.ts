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

function updatePendingStripContent(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	const statusInfo = getStatusInfo(pending.status);

	const pipEl = containerEl.querySelector<HTMLElement>('[data-field="pip"]');
	if (pipEl) {
		pipEl.textContent = statusInfo.pip;
		pipEl.setAttribute("data-state", statusInfo.state);
	}

	const statusWordEl = containerEl.querySelector<HTMLElement>(
		'[data-field="status-word"]',
	);
	if (statusWordEl) {
		statusWordEl.textContent = statusInfo.word;
	}

	const callNameEl = containerEl.querySelector<HTMLElement>(
		'[data-field="call-name"]',
	);
	if (callNameEl) {
		if (callMeta?.callName) {
			callNameEl.textContent = callMeta.callName;
			callNameEl.removeAttribute("hidden");
		} else {
			callNameEl.setAttribute("hidden", "");
		}
	}

	const sepRetryEl = containerEl.querySelector<HTMLElement>(
		'[data-field="sep-retry"]',
	);
	const retryEl = containerEl.querySelector<HTMLElement>(
		'[data-field="retry"]',
	);
	const showRetry = callMeta?.retryCount && callMeta.retryCount > 0;
	if (sepRetryEl) {
		sepRetryEl.setAttribute("hidden", "");
		if (showRetry) sepRetryEl.removeAttribute("hidden");
	}
	if (retryEl) {
		if (showRetry) {
			retryEl.textContent = `retry ${callMeta.retryCount}/${callMeta.retryMax ?? 3}`;
			retryEl.removeAttribute("hidden");
		} else {
			retryEl.setAttribute("hidden", "");
		}
	}

	const sepElapsedEl = containerEl.querySelector<HTMLElement>(
		'[data-field="sep-elapsed"]',
	);
	const elapsedEl = containerEl.querySelector<HTMLElement>(
		'[data-field="elapsed"]',
	);
	const elapsedText = formatElapsed(callMeta?.startedAtMs);
	if (sepElapsedEl) {
		sepElapsedEl.setAttribute("hidden", "");
		if (elapsedText) sepElapsedEl.removeAttribute("hidden");
	}
	if (elapsedEl) {
		if (elapsedText) {
			elapsedEl.textContent = elapsedText;
			elapsedEl.removeAttribute("hidden");
		} else {
			elapsedEl.setAttribute("hidden", "");
		}
	}

	const sepErrorEl = containerEl.querySelector<HTMLElement>(
		'[data-field="sep-error"]',
	);
	const lastErrorEl = containerEl.querySelector<HTMLElement>(
		'[data-field="last-error"]',
	);
	const showError = callMeta?.lastError;
	if (sepErrorEl) {
		sepErrorEl.setAttribute("hidden", "");
		if (showError) sepErrorEl.removeAttribute("hidden");
	}
	if (lastErrorEl) {
		if (showError) {
			lastErrorEl.textContent = `last error: ${callMeta.lastError}`;
			lastErrorEl.removeAttribute("hidden");
		} else {
			lastErrorEl.setAttribute("hidden", "");
		}
	}
}

function updateElapsedSpan(
	containerEl: HTMLElement,
	callMeta?: PendingCallMeta,
): void {
	const elapsedEl = containerEl.querySelector<HTMLElement>(
		'[data-field="elapsed"]',
	);
	if (!elapsedEl) return;
	const elapsedText = formatElapsed(callMeta?.startedAtMs);
	if (elapsedText) {
		elapsedEl.textContent = elapsedText;
	}
}

export function renderPendingStrip(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	if (_tickerInterval) {
		clearInterval(_tickerInterval);
		_tickerInterval = undefined;
	}

	_currentMeta = callMeta;
	_tickerContainer = containerEl;

	containerEl.classList.add("dev-strip", "dev-pending-strip");
	containerEl.setAttribute("data-strip", "pending");
	containerEl.replaceChildren();

	const line = containerEl.ownerDocument.createElement("div");
	line.className = "dev-strip-line";
	line.setAttribute("data-line", "pending");

	const pipEl = containerEl.ownerDocument.createElement("span");
	pipEl.className = "dev-pending-pip dev-footer-pip";
	pipEl.setAttribute("data-field", "pip");
	line.appendChild(pipEl);

	const statusWord = containerEl.ownerDocument.createElement("span");
	statusWord.setAttribute("data-field", "status-word");
	line.appendChild(statusWord);

	const callName = containerEl.ownerDocument.createElement("span");
	callName.setAttribute("data-field", "call-name");
	line.appendChild(callName);

	const sepRetry = containerEl.ownerDocument.createElement("span");
	sepRetry.setAttribute("data-field", "sep-retry");
	sepRetry.textContent = "·";
	line.appendChild(sepRetry);

	const retry = containerEl.ownerDocument.createElement("span");
	retry.setAttribute("data-field", "retry");
	line.appendChild(retry);

	const sepElapsed = containerEl.ownerDocument.createElement("span");
	sepElapsed.setAttribute("data-field", "sep-elapsed");
	sepElapsed.textContent = "·";
	line.appendChild(sepElapsed);

	const elapsed = containerEl.ownerDocument.createElement("span");
	elapsed.setAttribute("data-field", "elapsed");
	line.appendChild(elapsed);

	const sepError = containerEl.ownerDocument.createElement("span");
	sepError.setAttribute("data-field", "sep-error");
	sepError.textContent = "·";
	line.appendChild(sepError);

	const lastError = containerEl.ownerDocument.createElement("span");
	lastError.setAttribute("data-field", "last-error");
	line.appendChild(lastError);

	containerEl.appendChild(line);

	updatePendingStripContent(containerEl, pending, _currentMeta);

	_tickerInterval = setInterval(() => {
		if (!_tickerContainer?.isConnected) {
			if (_tickerInterval) {
				clearInterval(_tickerInterval);
				_tickerInterval = undefined;
			}
			_tickerContainer = undefined;
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
	if (_tickerInterval) {
		clearInterval(_tickerInterval);
		_tickerInterval = undefined;
	}
	_tickerContainer = undefined;
	_currentMeta = undefined;
	if (!containerEl) return;
	containerEl.classList.remove("dev-strip", "dev-pending-strip");
	containerEl.removeAttribute("data-strip");
	containerEl.replaceChildren();
}

export function __resetPendingStripForTests(): void {
	if (_tickerInterval) clearInterval(_tickerInterval);
	_tickerInterval = undefined;
	_tickerContainer = undefined;
	_currentMeta = undefined;
}
