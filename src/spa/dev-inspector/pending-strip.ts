/**
 * pending-strip.ts
 *
 * Renders a dev inspector strip for pending-bootstrap state, showing call
 * metadata during async loading: pip (●/✕/○), status word, call name, retry count,
 * elapsed time, and last error.
 *
 * Uses a setInterval ticker (~100ms) to update the elapsed time display.
 */

import type {
	PendingBootstrap,
	PendingCallMeta,
} from "../game/pending-bootstrap.js";

let _tickerInterval: ReturnType<typeof setInterval> | undefined;
let _tickerContainer: HTMLElement | undefined;
let _currentMeta: PendingCallMeta | undefined;

/**
 * Helper: format the status word and data-state for the pip based on bootstrap status.
 */
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

/**
 * Helper: format elapsed time in seconds with one decimal place.
 */
function formatElapsed(startedAtMs: number | undefined): string | undefined {
	if (startedAtMs === undefined) return undefined;
	const elapsed = (Date.now() - startedAtMs) / 1000;
	return `${elapsed.toFixed(1)}s elapsed`;
}

/**
 * Update the text content of all data fields in the strip.
 */
function updatePendingStripContent(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	const statusInfo = getStatusInfo(pending.status);

	// Pip
	const pipEl = containerEl.querySelector<HTMLElement>('[data-field="pip"]');
	if (pipEl) {
		pipEl.textContent = statusInfo.pip;
		pipEl.setAttribute("data-state", statusInfo.state);
	}

	// Status word
	const statusWordEl = containerEl.querySelector<HTMLElement>(
		'[data-field="status-word"]',
	);
	if (statusWordEl) {
		statusWordEl.textContent = statusInfo.word;
	}

	// Call name
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

	// Retry separator and retry count
	const sepRetryEl = containerEl.querySelector<HTMLElement>(
		'[data-field="sep-retry"]',
	);
	const retryEl = containerEl.querySelector<HTMLElement>(
		'[data-field="retry"]',
	);
	const showRetry = callMeta && callMeta.retryCount && callMeta.retryCount > 0;
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

	// Elapsed separator and elapsed time
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

	// Last error separator and error message
	const sepErrorEl = containerEl.querySelector<HTMLElement>(
		'[data-field="sep-error"]',
	);
	const lastErrorEl = containerEl.querySelector<HTMLElement>(
		'[data-field="last-error"]',
	);
	const showError = callMeta && callMeta.lastError;
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

/**
 * Update the elapsed time span (called by ticker).
 */
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

/**
 * Render the pending-bootstrap strip in the given container.
 * Initializes DOM structure and starts a ~100ms ticker for elapsed time updates.
 */
export function renderPendingStrip(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	// Clean up any existing interval
	if (_tickerInterval) {
		clearInterval(_tickerInterval);
		_tickerInterval = undefined;
	}

	_currentMeta = callMeta;
	_tickerContainer = containerEl;

	containerEl.classList.add("dev-strip", "dev-pending-strip");
	containerEl.setAttribute("data-strip", "pending");
	containerEl.replaceChildren();

	// Build DOM structure
	const line = containerEl.ownerDocument.createElement("div");
	line.className = "dev-strip-line";
	line.setAttribute("data-line", "pending");

	// Pip
	const pipEl = containerEl.ownerDocument.createElement("span");
	pipEl.className = "dev-pending-pip dev-footer-pip";
	pipEl.setAttribute("data-field", "pip");
	line.appendChild(pipEl);

	// Status word
	const statusWord = containerEl.ownerDocument.createElement("span");
	statusWord.setAttribute("data-field", "status-word");
	line.appendChild(statusWord);

	// Call name
	const callName = containerEl.ownerDocument.createElement("span");
	callName.setAttribute("data-field", "call-name");
	line.appendChild(callName);

	// Separator for retry
	const sepRetry = containerEl.ownerDocument.createElement("span");
	sepRetry.setAttribute("data-field", "sep-retry");
	sepRetry.textContent = "·";
	line.appendChild(sepRetry);

	// Retry count
	const retry = containerEl.ownerDocument.createElement("span");
	retry.setAttribute("data-field", "retry");
	line.appendChild(retry);

	// Separator for elapsed
	const sepElapsed = containerEl.ownerDocument.createElement("span");
	sepElapsed.setAttribute("data-field", "sep-elapsed");
	sepElapsed.textContent = "·";
	line.appendChild(sepElapsed);

	// Elapsed time
	const elapsed = containerEl.ownerDocument.createElement("span");
	elapsed.setAttribute("data-field", "elapsed");
	line.appendChild(elapsed);

	// Separator for error
	const sepError = containerEl.ownerDocument.createElement("span");
	sepError.setAttribute("data-field", "sep-error");
	sepError.textContent = "·";
	line.appendChild(sepError);

	// Last error
	const lastError = containerEl.ownerDocument.createElement("span");
	lastError.setAttribute("data-field", "last-error");
	line.appendChild(lastError);

	containerEl.appendChild(line);

	// Populate content
	updatePendingStripContent(containerEl, pending, _currentMeta);

	// Start ticker for elapsed time updates (~100ms)
	_tickerInterval = setInterval(() => {
		if (!_tickerContainer || !_tickerContainer.isConnected) {
			if (_tickerInterval) {
				clearInterval(_tickerInterval);
				_tickerInterval = undefined;
			}
			_tickerContainer = undefined;
			return;
		}
		updateElapsedSpan(_tickerContainer, _currentMeta);
	}, 100);
}

/**
 * Update the pending strip with new state without restarting the ticker.
 * Used when bootstrap state changes (e.g., error occurs, retry happens).
 */
export function updatePendingStrip(
	containerEl: HTMLElement,
	pending: PendingBootstrap,
	callMeta?: PendingCallMeta,
): void {
	_currentMeta = callMeta;
	updatePendingStripContent(containerEl, pending, _currentMeta);
}

/**
 * Clear the pending strip and stop the ticker.
 */
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

/**
 * Test-only helper to reset pending strip state.
 */
export function __resetPendingStripForTests(): void {
	if (_tickerInterval) clearInterval(_tickerInterval);
	_tickerInterval = undefined;
	_tickerContainer = undefined;
	_currentMeta = undefined;
}
