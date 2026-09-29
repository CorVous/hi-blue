import { isDevHost } from "./dev-host.js";
import {
	OPENROUTER_KEY_STORAGE_KEY,
	readStoredByokKey,
} from "./openrouter-key.js";

const LOCALSTORAGE_META_KEY = "openrouter_key_meta";

export type ValidationResult =
	| { kind: "validated" }
	| { kind: "rejected-401" }
	| { kind: "rejected-402" }
	| { kind: "rejected-other"; status: number }
	| { kind: "network-or-5xx"; status: number | null };

export type KeyMeta = {
	validatedAt: string;
	status: "validated" | "unverified";
	keySuffix: string;
};

export const KEY_VALIDATION_TIMEOUT_MS = 15_000;

export async function validateOpenRouterKey(
	key: string,
	fetchImpl: typeof fetch = fetch,
	timeoutMs: number = KEY_VALIDATION_TIMEOUT_MS,
): Promise<ValidationResult> {
	const abortController = new AbortController();
	const abortTimer = setTimeout(() => abortController.abort(), timeoutMs);
	try {
		return await requestKeyValidation(key, fetchImpl, abortController.signal);
	} finally {
		clearTimeout(abortTimer);
	}
}

async function requestKeyValidation(
	key: string,
	fetchImpl: typeof fetch,
	signal: AbortSignal,
): Promise<ValidationResult> {
	let response: Response;
	try {
		response = await fetchImpl("https://openrouter.ai/api/v1/auth/key", {
			headers: { Authorization: `Bearer ${key}` },
			signal,
		});
	} catch {
		return { kind: "network-or-5xx", status: null };
	}

	if (response.status === 401) return { kind: "rejected-401" };
	if (response.status === 402) return { kind: "rejected-402" };
	if (response.status >= 500) {
		return { kind: "network-or-5xx", status: response.status };
	}
	if (response.status >= 400) {
		return { kind: "rejected-other", status: response.status };
	}

	const keyInfo = await readAuthKeyInfoOrNull(response);
	if (signal.aborted) return { kind: "network-or-5xx", status: null };
	if (keyInfo !== null && hasReachedSpendLimit(keyInfo)) {
		return { kind: "rejected-402" };
	}
	return { kind: "validated" };
}

type AuthKeyInfo = { data?: { usage?: number; limit?: number } };

async function readAuthKeyInfoOrNull(
	authKeyResponse: Response,
): Promise<AuthKeyInfo | null> {
	try {
		return (await authKeyResponse.json()) as AuthKeyInfo | null;
	} catch {
		return null;
	}
}

function hasReachedSpendLimit(keyInfo: AuthKeyInfo): boolean {
	const usage = keyInfo.data?.usage;
	const limit = keyInfo.data?.limit;
	return (
		typeof usage === "number" && typeof limit === "number" && usage >= limit
	);
}

function readKey(): string | null {
	return readStoredByokKey() || null;
}

export function readMeta(): KeyMeta | null {
	try {
		const raw = localStorage.getItem(LOCALSTORAGE_META_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"validatedAt" in parsed &&
			"status" in parsed &&
			"keySuffix" in parsed
		) {
			return parsed as KeyMeta;
		}
		return null;
	} catch {
		return null;
	}
}

export function writeKeyAndMeta(key: string, meta: KeyMeta): void {
	localStorage.setItem(OPENROUTER_KEY_STORAGE_KEY, key);
	localStorage.setItem(LOCALSTORAGE_META_KEY, JSON.stringify(meta));
}

export function clearKey(): void {
	localStorage.removeItem(OPENROUTER_KEY_STORAGE_KEY);
	localStorage.removeItem(LOCALSTORAGE_META_KEY);
}

export function formatRelativeTime(iso: string, nowMs: number): string {
	const diffMs = nowMs - new Date(iso).getTime();
	const diffSec = Math.floor(diffMs / 1000);

	if (diffSec < 60) return "just now";

	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;

	const diffDay = Math.floor(diffHour / 24);
	return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

let keyAwaitingUnverifiedSave: string | null = null;
let validationInFlight = false;

function getEl<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

function renderModalState(): void {
	const dialog = getEl<HTMLDialogElement>("byok-dialog");
	if (!dialog) return;

	const modeLine = getEl("byok-mode-line");
	const keyInput = getEl<HTMLInputElement>("byok-key-input");
	const statusEl = getEl("byok-status");
	const validateSaveBtn = getEl("byok-validate-save");
	const saveUnverifiedBtn = getEl("byok-save-unverified");
	const revalidateBtn = getEl("byok-revalidate");
	const replaceBtn = getEl("byok-replace");
	const clearBtn = getEl("byok-clear");

	if (!modeLine || !keyInput || !statusEl) return;

	const buildInfo = getEl("byok-build-info");
	if (buildInfo) {
		if (isDevHost()) {
			buildInfo.textContent = `Commit ${__COMMIT_SHA__}`;
			buildInfo.hidden = false;
		}
	}

	const key = readKey();
	const meta = readMeta();

	statusEl.textContent = "";
	keyAwaitingUnverifiedSave = null;

	if (key) {
		if (meta?.validatedAt) {
			const rel = formatRelativeTime(meta.validatedAt, Date.now());
			modeLine.textContent = `Currently using your key (validated ${rel})`;
		} else {
			modeLine.textContent = "Currently using your key (not validated)";
		}

		const suffix = meta?.keySuffix ?? key.slice(-4);
		keyInput.value = `sk-or-v1-••••${suffix}`;
		keyInput.setAttribute("readonly", "");

		if (validateSaveBtn) validateSaveBtn.hidden = true;
		if (saveUnverifiedBtn) saveUnverifiedBtn.hidden = true;
		if (revalidateBtn) revalidateBtn.hidden = false;
		if (replaceBtn) replaceBtn.hidden = false;
		if (clearBtn) clearBtn.hidden = false;
	} else {
		modeLine.textContent =
			"Currently using the free tier (limited daily messages)";
		showKeyEntryControls(keyInput);
	}
}

function showKeyEntryControls(keyInput: HTMLInputElement): void {
	keyInput.value = "";
	keyInput.removeAttribute("readonly");

	const validateSaveBtn = getEl("byok-validate-save");
	const saveUnverifiedBtn = getEl("byok-save-unverified");
	const revalidateBtn = getEl("byok-revalidate");
	const replaceBtn = getEl("byok-replace");
	const clearBtn = getEl("byok-clear");
	if (validateSaveBtn) validateSaveBtn.hidden = false;
	if (saveUnverifiedBtn) saveUnverifiedBtn.hidden = true;
	if (revalidateBtn) revalidateBtn.hidden = true;
	if (replaceBtn) replaceBtn.hidden = true;
	if (clearBtn) clearBtn.hidden = true;
}

async function runExclusiveValidation(
	validation: () => Promise<void>,
): Promise<void> {
	if (validationInFlight) {
		const statusEl = getEl("byok-status");
		if (statusEl) statusEl.textContent = "Validation in progress…";
		return;
	}
	validationInFlight = true;
	try {
		await validation();
	} finally {
		validationInFlight = false;
	}
}

export function openByokModal(): void {
	const dialog = getEl<HTMLDialogElement>("byok-dialog");
	if (!dialog) return;

	renderModalState();
	dialog.showModal();
}

export function initByokModal(): void {
	const cogBtn = getEl("byok-cog");
	if (!cogBtn) return;

	cogBtn.addEventListener("click", () => {
		openByokModal();
	});

	const closeBtn = getEl("byok-close");
	if (closeBtn) {
		closeBtn.addEventListener("click", () => {
			const dialog = getEl<HTMLDialogElement>("byok-dialog");
			dialog?.close();
		});
	}

	const validateSaveBtn = getEl("byok-validate-save");
	if (validateSaveBtn) {
		validateSaveBtn.addEventListener("click", () =>
			runExclusiveValidation(async () => {
				const keyInput = getEl<HTMLInputElement>("byok-key-input");
				const statusEl = getEl("byok-status");
				const saveUnverifiedBtn = getEl("byok-save-unverified");
				if (!keyInput || !statusEl) return;

				const key = keyInput.value.trim();
				if (!key) {
					statusEl.textContent = "Please enter an API key.";
					return;
				}

				statusEl.textContent = "Validating…";
				keyAwaitingUnverifiedSave = null;
				if (saveUnverifiedBtn) saveUnverifiedBtn.hidden = true;

				const result = await validateOpenRouterKey(key);
				handleValidationResult({ result, key, statusEl, saveUnverifiedBtn });
			}),
		);
	}

	const saveUnverifiedBtn = getEl("byok-save-unverified");
	if (saveUnverifiedBtn) {
		saveUnverifiedBtn.addEventListener("click", () => {
			const key = keyAwaitingUnverifiedSave;
			if (!key) return;
			keyAwaitingUnverifiedSave = null;
			const keySuffix = key.slice(-4);
			writeKeyAndMeta(key, {
				validatedAt: "",
				status: "unverified",
				keySuffix,
			});
			const dialog = getEl<HTMLDialogElement>("byok-dialog");
			dialog?.close();
		});
	}

	const revalidateBtn = getEl("byok-revalidate");
	if (revalidateBtn) {
		revalidateBtn.addEventListener("click", () =>
			runExclusiveValidation(async () => {
				const statusEl = getEl("byok-status");
				const saveUnverifiedBtn = getEl("byok-save-unverified");
				const storedKey = readKey();
				if (!statusEl || !storedKey) return;

				statusEl.textContent = "Validating…";
				keyAwaitingUnverifiedSave = null;
				const result = await validateOpenRouterKey(storedKey);
				handleValidationResult({
					result,
					key: storedKey,
					statusEl,
					saveUnverifiedBtn,
				});
			}),
		);
	}

	const replaceBtn = getEl("byok-replace");
	if (replaceBtn) {
		replaceBtn.addEventListener("click", () => {
			const keyInput = getEl<HTMLInputElement>("byok-key-input");
			if (!keyInput) return;
			keyAwaitingUnverifiedSave = null;
			showKeyEntryControls(keyInput);
			keyInput.focus();
		});
	}

	const clearBtn = getEl("byok-clear");
	if (clearBtn) {
		clearBtn.addEventListener("click", () => {
			clearKey();
			const dialog = getEl<HTMLDialogElement>("byok-dialog");
			dialog?.close();
		});
	}
}

function handleValidationResult({
	result,
	key,
	statusEl,
	saveUnverifiedBtn,
}: {
	result: ValidationResult;
	key: string;
	statusEl: HTMLElement;
	saveUnverifiedBtn: HTMLElement | null;
}): void {
	if (result.kind === "validated") {
		const keySuffix = key.slice(-4);
		writeKeyAndMeta(key, {
			validatedAt: new Date().toISOString(),
			status: "validated",
			keySuffix,
		});
		renderModalState();
		statusEl.textContent = "Key validated.";
	} else if (result.kind === "rejected-401") {
		statusEl.textContent =
			"That key didn't authenticate. Double-check you copied the whole thing — OpenRouter keys start with sk-or-v1-...";
	} else if (result.kind === "rejected-402") {
		statusEl.textContent =
			"Key works, but the OpenRouter account is out of credit. Top it up at openrouter.ai and try again.";
	} else if (result.kind === "network-or-5xx") {
		const statusStr =
			result.status !== null ? String(result.status) : "unknown";
		statusEl.textContent = `Couldn't reach OpenRouter to verify (got ${statusStr}). Save anyway?`;
		keyAwaitingUnverifiedSave = key;
		if (saveUnverifiedBtn) saveUnverifiedBtn.hidden = false;
	} else if (result.kind === "rejected-other") {
		statusEl.textContent = `OpenRouter rejected the validation (status ${result.status}). Check the key and try again.`;
	}
}
