/**
 * sessions.test.ts
 *
 * Unit tests for renderSessions() (routes/sessions.ts).
 *
 * Uses jsdom (vitest default) with a minimal HTML fixture. Prepopulates
 * localStorage with ok/broken/version-mismatch sessions and verifies DOM output.
 *
 * Issue #174 (parent #155).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LANDMARKS } from "../game/direction.js";
import { startGame } from "../game/engine.js";
import type { AiPersona, ContentPack, GameState } from "../game/types.js";
import { deobfuscate, obfuscate } from "../persistence/sealed-blob-codec.js";
import {
	ACTIVE_KEY,
	ARCHIVE_PREFIX,
	SESSIONS_PREFIX,
} from "../persistence/session-storage.js";

// ── Test fixture ──────────────────────────────────────────────────────────────

const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: {},
};

// ── HTML fixture ───────────────────────────────────────────────────────────────

const INDEX_BODY_HTML = `
<main>
  <section id="start-screen" hidden>
    <button id="begin" type="button" disabled>[ BEGIN ]</button>
  </section>
  <section id="sessions-screen" hidden>
    <aside id="sessions-banner" hidden role="status" aria-live="polite"></aside>
    <div id="sessions-list"></div>
    <button id="sessions-new" type="button">[ + new session ]</button>
  </section>
  <div id="panels" class="row"></div>
  <form id="composer" hidden></form>
  <section id="cap-hit" hidden></section>
  <section id="endgame" hidden></section>
</main>
`;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower.",
		blurb: "Ember is hot-headed.",
		typingQuirks: ["fragments", "ALL CAPS"],
		voiceExamples: ["Now.", "BURN IT."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Distribute items.",
		blurb: "Sage is meticulous.",
		typingQuirks: ["ellipses", "no contractions"],
		voiceExamples: ["I will count again...", "That is not balanced."],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key.",
		blurb: "Frost is laconic.",
		typingQuirks: ["lowercase only", "fragments"],
		voiceExamples: ["sure.", "if you say so."],
	},
};

function makeFreshGame(): GameState {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
		budgetPerAi: 5,
		rng: () => 0,
	});
}

// ── localStorage stub ─────────────────────────────────────────────────────────────

function makeLocalStorageStub(initialData: Record<string, string> = {}) {
	const store: Record<string, string> = { ...initialData };
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
		_store: store,
	};
}

function getMain(): HTMLElement {
	const main = document.querySelector<HTMLElement>("main");
	if (!main) throw new Error("main element not found");
	return main;
}

// ── Helpers to seed sessions ──────────────────────────────────────────────────

/**
 * Write a valid (ok) session into the store.
 * Returns the session id used.
 */
async function seedOkSession(
	stub: ReturnType<typeof makeLocalStorageStub>,
	id: string,
	lastSavedAt = "2025-01-01T10:00:00.000Z",
): Promise<void> {
	const { serializeSession } = await import("../persistence/session-codec.js");
	const game = makeFreshGame();
	const files = serializeSession(game, lastSavedAt, "2025-01-01T00:00:00.000Z");
	const prefix = `${SESSIONS_PREFIX}${id}/`;
	stub._store[`${prefix}meta.json`] = files.meta;
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		stub._store[`${prefix}${aiId}.txt`] = daemonJson;
	}
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns engine
	stub._store[`${prefix}engine.dat`] = files.engine!;
}

/**
 * Write a broken session (no engine.dat) into the store.
 */
async function seedBrokenSession(
	stub: ReturnType<typeof makeLocalStorageStub>,
	id: string,
): Promise<void> {
	const { serializeSession } = await import("../persistence/session-codec.js");
	const game = makeFreshGame();
	const now = "2025-01-01T08:00:00.000Z";
	const files = serializeSession(game, now, now);
	const prefix = `${SESSIONS_PREFIX}${id}/`;
	stub._store[`${prefix}meta.json`] = files.meta;
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		stub._store[`${prefix}${aiId}.txt`] = daemonJson;
	}
	// Intentionally omit engine.dat to trigger broken state
}

/**
 * Write a version-mismatch session into the store.
 */
async function seedVersionMismatchSession(
	stub: ReturnType<typeof makeLocalStorageStub>,
	id: string,
): Promise<void> {
	const { serializeSession } = await import("../persistence/session-codec.js");
	const game = makeFreshGame();
	const now = "2025-01-01T06:00:00.000Z";
	const files = serializeSession(game, now, now);
	const prefix = `${SESSIONS_PREFIX}${id}/`;
	stub._store[`${prefix}meta.json`] = files.meta;
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		stub._store[`${prefix}${aiId}.txt`] = daemonJson;
	}
	// Write engine.dat with bumped schemaVersion
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns engine
	const rawJson = deobfuscate(files.engine!);
	const sealed = JSON.parse(rawJson);
	sealed.schemaVersion = 999;
	stub._store[`${prefix}engine.dat`] = obfuscate(JSON.stringify(sealed));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderSessions — screen visibility", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows #sessions-screen and hides #start-screen, #panels, #composer, #endgame, #cap-hit", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		expect(
			document.querySelector<HTMLElement>("#sessions-screen")?.hidden,
		).toBe(false);
		expect(document.querySelector<HTMLElement>("#start-screen")?.hidden).toBe(
			true,
		);
		expect(document.querySelector<HTMLElement>("#panels")?.hidden).toBe(true);
		expect(document.querySelector<HTMLElement>("#composer")?.hidden).toBe(true);
		expect(document.querySelector<HTMLElement>("#endgame")?.hidden).toBe(true);
		expect(document.querySelector<HTMLElement>("#cap-hit")?.hidden).toBe(true);
	});
});

describe("renderSessions — banner", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("?reason=broken shows the broken banner", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams({ reason: "broken" }));
		const banner = document.querySelector<HTMLElement>("#sessions-banner");
		expect(banner?.hidden).toBe(false);
		expect(banner?.textContent).toContain("unreadable");
	});

	it("?reason=version-mismatch shows the version-mismatch banner", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(
			getMain(),
			new URLSearchParams({ reason: "version-mismatch" }),
		);
		const banner = document.querySelector<HTMLElement>("#sessions-banner");
		expect(banner?.hidden).toBe(false);
		expect(banner?.textContent).toContain("older version");
	});

	it("no reason param => banner hidden", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());
		const banner = document.querySelector<HTMLElement>("#sessions-banner");
		expect(banner?.hidden).toBe(true);
	});
});

describe("renderSessions — row rendering", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("renders 4 rows: 2 ok + 1 broken + 1 version-mismatch", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);

		await seedOkSession(stub, "0xAAAA", "2025-03-01T10:00:00.000Z");
		await seedOkSession(stub, "0xBBBB", "2025-02-01T10:00:00.000Z");
		await seedBrokenSession(stub, "0xCCCC");
		await seedVersionMismatchSession(stub, "0xDDDD");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const rows = document.querySelectorAll(".session-row");
		expect(rows).toHaveLength(4);
	});

	it("ok rows show [ load ] [ dup ] [ rm ] buttons", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedOkSession(stub, "0xAAAA", "2025-03-01T10:00:00.000Z");
		stub._store[ACTIVE_KEY] = "0xAAAA";

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xAAAA"]',
		);
		expect(row).toBeTruthy();
		const buttons = row?.querySelectorAll(".ops button");
		const btnTexts = Array.from(buttons ?? []).map((b) => b.textContent);
		expect(btnTexts).toContain("[ load ]");
		expect(btnTexts).toContain("[ dup ]");
		expect(btnTexts).toContain("[ rm ]");
	});

	it("broken row shows [ corrupt ] tag and [ rm ] only", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedBrokenSession(stub, "0xCCCC");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xCCCC"]',
		);
		expect(row).toBeTruthy();
		expect(row?.querySelector(".tag-corrupt")).toBeTruthy();
		const buttons = row?.querySelectorAll(".ops button");
		const btnTexts = Array.from(buttons ?? []).map((b) => b.textContent);
		expect(btnTexts).not.toContain("[ load ]");
		expect(btnTexts).not.toContain("[ dup ]");
		expect(btnTexts).toContain("[ rm ]");
	});

	it("version-mismatch row shows [ version mismatch ] tag and [ rm ] only", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedVersionMismatchSession(stub, "0xDDDD");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xDDDD"]',
		);
		expect(row).toBeTruthy();
		expect(row?.querySelector(".tag-version-mismatch")).toBeTruthy();
		const buttons = row?.querySelectorAll(".ops button");
		const btnTexts = Array.from(buttons ?? []).map((b) => b.textContent);
		expect(btnTexts).not.toContain("[ load ]");
		expect(btnTexts).not.toContain("[ dup ]");
		expect(btnTexts).toContain("[ rm ]");
	});

	it("broken row shows <corrupted> placeholder text", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedBrokenSession(stub, "0xCCCC");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xCCCC"]',
		);
		expect(row?.textContent).toContain("<corrupted>");
	});
});

describe("renderSessions — [ rm ] confirm/cancel", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("[ rm ] click swaps to [ confirm rm ] + [ cancel ]", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xAAAA"]',
		);
		const rmBtn = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ rm ]");
		expect(rmBtn).toBeTruthy();
		rmBtn?.click();

		const btnsAfter = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).map((b) => b.textContent);
		expect(btnsAfter).toContain("[ confirm rm ]");
		expect(btnsAfter).toContain("[ cancel ]");
		expect(btnsAfter).not.toContain("[ rm ]");
	});

	it("[ cancel ] restores the original [ rm ] button", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xAAAA"]',
		);
		const rmBtn = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ rm ]");
		rmBtn?.click();

		const cancelBtn = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ cancel ]");
		cancelBtn?.click();

		const btnsRestored = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).map((b) => b.textContent);
		expect(btnsRestored).toContain("[ rm ]");
		expect(btnsRestored).not.toContain("[ confirm rm ]");
		expect(btnsRestored).not.toContain("[ cancel ]");
	});

	it("[ confirm rm ] removes the row and storage keys", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		expect(document.querySelectorAll(".session-row")).toHaveLength(1);

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xAAAA"]',
		);
		const rmBtn = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ rm ]");
		rmBtn?.click();

		const confirmBtn = Array.from(
			row?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ confirm rm ]");
		confirmBtn?.click();

		// Row should be gone (re-render removes it)
		expect(document.querySelectorAll(".session-row")).toHaveLength(0);

		// Storage keys should be removed
		const remaining = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}0xAAAA/`),
		);
		expect(remaining).toHaveLength(0);
	});
});

describe("renderSessions — [ + new session ] button", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("location", {
			hash: "#/sessions",
			assign: vi.fn(),
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("mints a new session, sets active pointer, and navigates to #/start", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const newBtn = document.querySelector<HTMLButtonElement>("#sessions-new");
		expect(newBtn).toBeTruthy();
		newBtn?.click();

		// Active pointer should now be set to a valid id
		const activeId = stub._store[ACTIVE_KEY];
		expect(activeId).toMatch(/^0x[0-9A-F]{4}$/);

		// location.hash should be set to #/start
		expect(location.hash).toBe("#/start");
	});
});

describe("renderSessions — [ load ] button", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("location", {
			hash: "#/sessions",
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("sets active pointer and navigates to #/game when loading a non-active session", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);

		// Seed session A as active, session B as another
		await seedOkSession(stub, "0xAAAA");
		await seedOkSession(stub, "0xBBBB", "2025-02-01T10:00:00.000Z");
		stub._store[ACTIVE_KEY] = "0xAAAA";

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		// Find the [ load ] button for session B
		const rowB = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xBBBB"]',
		);
		const loadBtn = Array.from(
			rowB?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ load ]");
		expect(loadBtn).toBeTruthy();
		loadBtn?.click();

		// Active pointer should now be 0xBBBB
		expect(stub._store[ACTIVE_KEY]).toBe("0xBBBB");
		// location.hash should be #/game
		expect(location.hash).toBe("#/game");
	});
});

// ── Archive helpers ─────────────────────────────────────────────────────────────

/**
 * Seed an archived session directly into the stub store for DOM tests.
 * Uses an archived meta with readonly: true, lastPlayedAt, epoch: 1.
 */
async function seedArchivedSessionInStore(
	stub: ReturnType<typeof makeLocalStorageStub>,
	id: string,
): Promise<void> {
	const { serializeSession } = await import("../persistence/session-codec.js");
	const game = makeFreshGame();
	const lastSavedAt = "2024-01-01T00:00:00.000Z";
	const files = serializeSession(
		game,
		lastSavedAt,
		"2024-01-01T00:00:00.000Z",
		1,
	);
	const dstPrefix = `${ARCHIVE_PREFIX}${id}/`;

	// Parse meta and stamp archived fields
	const meta = JSON.parse(files.meta) as Record<string, unknown>;
	meta.readonly = true;
	meta.lastPlayedAt = lastSavedAt;
	stub._store[`${dstPrefix}meta.json`] = JSON.stringify(meta, null, 2);

	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		stub._store[`${dstPrefix}${aiId}.txt`] = daemonJson;
	}
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns engine
	stub._store[`${dstPrefix}engine.dat`] = files.engine!;
}

// ── renderSessions — archived sessions section ──────────────────────────────────

describe("renderSessions — archived sessions section", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("renders both 'active sessions' and 'archived sessions' headings with one of each", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedOkSession(stub, "0xAAAA");
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const headings = Array.from(
			document.querySelectorAll(".sessions-section-heading"),
		).map((h) => h.textContent);
		expect(headings).toContain("active sessions");
		expect(headings).toContain("archived sessions");

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow).toBeTruthy();
	});

	it("archived row textContent contains 'epoch 1' and 'last played'", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow?.textContent).toContain("epoch 1");
		expect(archivedRow?.textContent).toContain("last played");
	});

	it("archived row has NO [ load ] or [ dup ] button; has [ rm ] button", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		const buttons = Array.from(
			archivedRow?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).map((b) => b.textContent);
		expect(buttons).not.toContain("[ load ]");
		expect(buttons).not.toContain("[ dup ]");
		expect(buttons).toContain("[ rm ]");
	});

	it("archived row contains '[ readonly ]' text", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow?.textContent).toContain("[ readonly ]");
	});

	it("active ok row meta-line says 'last played' (not 'saved')", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const activeRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xAAAA"]',
		);
		const metaLine = activeRow?.querySelector(".session-meta");
		expect(metaLine?.textContent).toContain("last played");
		expect(metaLine?.textContent).not.toContain(" saved ");
	});

	it("with zero active sessions and one archived: both headings render; archived row present", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const headings = Array.from(
			document.querySelectorAll(".sessions-section-heading"),
		).map((h) => h.textContent);
		expect(headings).toContain("active sessions");
		expect(headings).toContain("archived sessions");

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow).toBeTruthy();
	});
});

describe("renderSessions — archived Continue button", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("button visible when openrouter_key present", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		stub._store.openrouter_key = "sk-or-test";
		vi.stubGlobal("localStorage", stub);
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow).toBeTruthy();
		const buttons = Array.from(
			archivedRow?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).map((b) => b.textContent);
		expect(buttons).toContain("[ continue with new room ]");
	});

	it("button absent when openrouter_key absent", async () => {
		vi.resetModules();
		const stub = makeLocalStorageStub();
		// No openrouter_key in stub
		vi.stubGlobal("localStorage", stub);
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../routes/sessions.js");
		renderSessions(getMain(), new URLSearchParams());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow).toBeTruthy();
		const buttons = Array.from(
			archivedRow?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).map((b) => b.textContent);
		expect(buttons).not.toContain("[ continue with new room ]");
	});
});
