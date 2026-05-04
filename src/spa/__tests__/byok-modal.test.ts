import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearKey,
	formatRelativeTime,
	initByokModal,
	openByokModal,
	readMeta,
	validateOpenRouterKey,
	writeKeyAndMeta,
} from "../byok-modal.js";

// ─── Group A: validateOpenRouterKey ──────────────────────────────────────────

describe("validateOpenRouterKey", () => {
	it("hits GET https://openrouter.ai/api/v1/auth/key with Bearer auth", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ data: {} }),
		});
		await validateOpenRouterKey("sk-or-v1-testkey", mockFetch);
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://openrouter.ai/api/v1/auth/key");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer sk-or-v1-testkey",
		);
	});

	it("returns validated on 200 with usage < limit", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ data: { usage: 10, limit: 100 } }),
		});
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "validated" });
	});

	it("returns validated on 200 with no usage/limit fields", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ data: {} }),
		});
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "validated" });
	});

	it("returns rejected-402 on HTTP 402", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ status: 402 });
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "rejected-402" });
	});

	it("returns rejected-402 on HTTP 200 when usage >= limit", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ data: { usage: 100, limit: 100 } }),
		});
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "rejected-402" });
	});

	it("returns rejected-401 on HTTP 401", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ status: 401 });
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "rejected-401" });
	});

	it("returns rejected-other on HTTP 403", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ status: 403 });
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "rejected-other", status: 403 });
	});

	it("returns network-or-5xx on HTTP 502", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ status: 502 });
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "network-or-5xx", status: 502 });
	});

	it("returns network-or-5xx with status null when fetch throws", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
		const result = await validateOpenRouterKey("key", mockFetch);
		expect(result).toEqual({ kind: "network-or-5xx", status: null });
	});
});

// ─── Group B: storage helpers ─────────────────────────────────────────────────

describe("storage helpers", () => {
	let store: Record<string, string>;

	beforeEach(() => {
		store = {};
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writeKeyAndMeta persists to correct localStorage keys", () => {
		writeKeyAndMeta("sk-or-v1-mykey", {
			validatedAt: "2024-01-01T00:00:00.000Z",
			status: "validated",
			keySuffix: "ykey",
		});
		expect(store.openrouter_key).toBe("sk-or-v1-mykey");
		// biome-ignore lint/style/noNonNullAssertion: test assertion
		const meta = JSON.parse(store.openrouter_key_meta!);
		expect(meta.validatedAt).toBe("2024-01-01T00:00:00.000Z");
		expect(meta.status).toBe("validated");
		expect(meta.keySuffix).toBe("ykey");
	});

	it("readMeta returns null when missing or malformed JSON", () => {
		// Missing
		expect(readMeta()).toBeNull();
		// Malformed
		store.openrouter_key_meta = "not-json";
		expect(readMeta()).toBeNull();
		// Wrong shape
		store.openrouter_key_meta = JSON.stringify({ foo: "bar" });
		expect(readMeta()).toBeNull();
	});

	it("clearKey removes both entries", () => {
		store.openrouter_key = "some-key";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "wxyz",
		});
		clearKey();
		expect(store.openrouter_key).toBeUndefined();
		expect(store.openrouter_key_meta).toBeUndefined();
	});
});

// ─── Group C: formatRelativeTime ──────────────────────────────────────────────

describe("formatRelativeTime", () => {
	it('< 1 minute → "just now"', () => {
		const now = Date.now();
		const iso = new Date(now - 30_000).toISOString();
		expect(formatRelativeTime(iso, now)).toBe("just now");
	});

	it("minutes/hours/days correctly", () => {
		const now = Date.now();

		// 5 minutes ago
		expect(
			formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now),
		).toBe("5 minutes ago");

		// 1 minute ago
		expect(formatRelativeTime(new Date(now - 60_000).toISOString(), now)).toBe(
			"1 minute ago",
		);

		// 2 hours ago
		expect(
			formatRelativeTime(new Date(now - 2 * 3600_000).toISOString(), now),
		).toBe("2 hours ago");

		// 1 hour ago
		expect(
			formatRelativeTime(new Date(now - 3600_000).toISOString(), now),
		).toBe("1 hour ago");

		// 3 days ago
		expect(
			formatRelativeTime(new Date(now - 3 * 86400_000).toISOString(), now),
		).toBe("3 days ago");

		// 1 day ago
		expect(
			formatRelativeTime(new Date(now - 86400_000).toISOString(), now),
		).toBe("1 day ago");
	});
});

// ─── Group D: openByokModal UI ────────────────────────────────────────────────

const MODAL_HTML = `
<header>
  <button id="byok-cog" type="button" aria-label="Settings" title="Settings">⚙</button>
</header>
<main>
  <form id="composer">
    <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <pre id="output"></pre>
</main>
<dialog id="byok-dialog" aria-labelledby="byok-title">
  <form method="dialog" id="byok-form">
    <h2 id="byok-title">OpenRouter API Key</h2>
    <p id="byok-mode-line"></p>
    <label for="byok-key-input">API key</label>
    <input id="byok-key-input" type="password" autocomplete="off" spellcheck="false" />
    <p id="byok-status" role="status" aria-live="polite"></p>
    <div id="byok-buttons">
      <button id="byok-validate-save" type="button">Validate &amp; save</button>
      <button id="byok-save-unverified" type="button" hidden>Save unverified</button>
      <button id="byok-revalidate" type="button" hidden>Re-validate</button>
      <button id="byok-replace" type="button" hidden>Replace key</button>
      <button id="byok-clear" type="button" hidden>Clear key &amp; use free tier</button>
    </div>
    <button id="byok-close" type="button" aria-label="Close">Close</button>
  </form>
</dialog>
`;

function getEl<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id) as T | null;
	if (!el) throw new Error(`Element #${id} not found`);
	return el;
}

describe("openByokModal UI", () => {
	let store: Record<string, string>;
	let showModalSpy: ReturnType<typeof vi.fn>;
	let closeSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		document.body.innerHTML = MODAL_HTML;

		store = {};
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
		});

		showModalSpy = vi.fn();
		closeSpy = vi.fn();
		// biome-ignore lint/suspicious/noExplicitAny: mocking prototype
		HTMLDialogElement.prototype.showModal = showModalSpy as any;
		// biome-ignore lint/suspicious/noExplicitAny: mocking prototype
		HTMLDialogElement.prototype.close = closeSpy as any;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("opens the dialog (showModal called)", () => {
		openByokModal();
		expect(showModalSpy).toHaveBeenCalledOnce();
	});

	it("renders 'Currently using the free tier' when no key", () => {
		openByokModal();
		expect(getEl("byok-mode-line").textContent).toContain(
			"Currently using the free tier",
		);
	});

	it("renders 'Currently using your key (not validated)' when key but no validatedAt", () => {
		store.openrouter_key = "sk-or-v1-somekey";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "ekey",
		});
		openByokModal();
		expect(getEl("byok-mode-line").textContent).toContain(
			"Currently using your key (not validated)",
		);
	});

	it("renders 'Currently using your key (validated <relative>)' when meta.validatedAt set", () => {
		store.openrouter_key = "sk-or-v1-somekey";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: new Date(Date.now() - 30_000).toISOString(),
			status: "validated",
			keySuffix: "ekey",
		});
		openByokModal();
		const text = getEl("byok-mode-line").textContent ?? "";
		expect(text).toContain("Currently using your key (validated just now)");
	});

	it("shows masked input value 'sk-or-v1-••••wxyz' when key saved", () => {
		store.openrouter_key = "sk-or-v1-somewxyz";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "wxyz",
		});
		openByokModal();
		const input = getEl<HTMLInputElement>("byok-key-input");
		expect(input.value).toBe("sk-or-v1-••••wxyz");
	});

	it("shows Validate & save only when no key", () => {
		openByokModal();
		expect(getEl("byok-validate-save").hidden).toBe(false);
		expect(getEl("byok-revalidate").hidden).toBe(true);
		expect(getEl("byok-replace").hidden).toBe(true);
		expect(getEl("byok-clear").hidden).toBe(true);
	});

	it("shows Re-validate / Replace key / Clear when key saved", () => {
		store.openrouter_key = "sk-or-v1-somekey";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "ekey",
		});
		openByokModal();
		expect(getEl("byok-validate-save").hidden).toBe(true);
		expect(getEl("byok-revalidate").hidden).toBe(false);
		expect(getEl("byok-replace").hidden).toBe(false);
		expect(getEl("byok-clear").hidden).toBe(false);
	});

	it("empty input + Validate & save → non-empty error status, fetch NOT called", async () => {
		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		keyInput.value = "";

		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		getEl("byok-validate-save").click();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(getEl("byok-status").textContent).toBeTruthy();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("valid key on Validate & save writes localStorage and renders 'Key validated.'", async () => {
		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		keyInput.value = "sk-or-v1-goodkey";

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				json: async () => ({ data: {} }),
			}),
		);

		getEl("byok-validate-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(store.openrouter_key).toBe("sk-or-v1-goodkey");
		expect(getEl("byok-status").textContent).toBe("Key validated.");
	});

	it("401 → renders verbatim 401 copy, no storage write", async () => {
		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		keyInput.value = "sk-or-v1-badkey";

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));

		getEl("byok-validate-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(getEl("byok-status").textContent).toContain(
			"That key didn't authenticate",
		);
		expect(store.openrouter_key).toBeUndefined();
	});

	it("402 → renders verbatim 402 copy, no storage write", async () => {
		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		keyInput.value = "sk-or-v1-outofcredit";

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 402 }));

		getEl("byok-validate-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(getEl("byok-status").textContent).toContain("out of credit");
		expect(store.openrouter_key).toBeUndefined();
	});

	it("5xx → reveals Save unverified button, renders 'Couldn't reach OpenRouter…'", async () => {
		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		keyInput.value = "sk-or-v1-somekey";

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 502 }));

		getEl("byok-validate-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(getEl("byok-status").textContent).toContain(
			"Couldn't reach OpenRouter",
		);
		expect(getEl("byok-save-unverified").hidden).toBe(false);
	});

	it("clicking Save unverified writes meta with status 'unverified' and validatedAt: ''", async () => {
		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		keyInput.value = "sk-or-v1-somekey1234";

		// Simulate 5xx first to reveal the button
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 502 }));
		getEl("byok-validate-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Now click Save unverified
		getEl("byok-save-unverified").click();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(store.openrouter_key).toBe("sk-or-v1-somekey1234");
		// biome-ignore lint/style/noNonNullAssertion: test assertion
		const meta = JSON.parse(store.openrouter_key_meta!);
		expect(meta.status).toBe("unverified");
		expect(meta.validatedAt).toBe("");
		expect(closeSpy).toHaveBeenCalled();
	});

	it("Re-validate uses stored key, updates meta.validatedAt on success", async () => {
		store.openrouter_key = "sk-or-v1-storedkey";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "dkey",
		});

		openByokModal();
		initByokModal();

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				json: async () => ({ data: {} }),
			}),
		);

		getEl("byok-revalidate").click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		const meta = JSON.parse(store.openrouter_key_meta);
		expect(meta.status).toBe("validated");
		expect(meta.validatedAt).not.toBe("");
		expect(getEl("byok-status").textContent).toBe("Key validated.");
	});

	it("Clear key removes both localStorage entries with no confirm prompt", async () => {
		store.openrouter_key = "sk-or-v1-somekey";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "ekey",
		});

		openByokModal();
		initByokModal();

		const confirmSpy = vi.fn();
		vi.stubGlobal("confirm", confirmSpy);

		getEl("byok-clear").click();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(store.openrouter_key).toBeUndefined();
		expect(store.openrouter_key_meta).toBeUndefined();
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(closeSpy).toHaveBeenCalled();
	});

	it("Replace key clears masked input, removes readonly, switches to Validate & save mode", async () => {
		store.openrouter_key = "sk-or-v1-somekey";
		store.openrouter_key_meta = JSON.stringify({
			validatedAt: "",
			status: "unverified",
			keySuffix: "ekey",
		});

		openByokModal();
		initByokModal();

		const keyInput = getEl<HTMLInputElement>("byok-key-input");
		expect(keyInput.hasAttribute("readonly")).toBe(true);

		getEl("byok-replace").click();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(keyInput.value).toBe("");
		expect(keyInput.hasAttribute("readonly")).toBe(false);
		expect(getEl("byok-validate-save").hidden).toBe(false);
		expect(getEl("byok-revalidate").hidden).toBe(true);
		expect(getEl("byok-replace").hidden).toBe(true);
		expect(getEl("byok-clear").hidden).toBe(true);
	});
});

// ─── Group E: initByokModal ───────────────────────────────────────────────────

describe("initByokModal", () => {
	let showModalSpy: ReturnType<typeof vi.fn>;
	let store: Record<string, string>;

	beforeEach(() => {
		document.body.innerHTML = MODAL_HTML;

		store = {};
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
		});

		showModalSpy = vi.fn();
		// biome-ignore lint/suspicious/noExplicitAny: mocking prototype
		HTMLDialogElement.prototype.showModal = showModalSpy as any;
		// biome-ignore lint/suspicious/noExplicitAny: mocking prototype
		HTMLDialogElement.prototype.close = vi.fn() as any;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("clicking #byok-cog calls openByokModal (showModal invoked)", () => {
		initByokModal();
		getEl("byok-cog").click();
		expect(showModalSpy).toHaveBeenCalledOnce();
	});

	it("initByokModal safe when #byok-cog missing (no throw)", () => {
		document.body.innerHTML = ""; // no DOM
		expect(() => initByokModal()).not.toThrow();
	});
});
