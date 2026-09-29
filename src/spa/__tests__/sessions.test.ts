import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGame } from "../game/engine.js";
import type { AiPersona, ContentPack, GameState } from "../game/types.js";
import { deobfuscate, obfuscate } from "../persistence/sealed-blob-codec.js";
import {
	ACTIVE_KEY,
	ARCHIVE_PREFIX,
	SESSIONS_PREFIX,
} from "../persistence/session-storage.js";
import {
	installLocalStorageStub,
	type LocalStorageStub,
	makeLocalStorageStub,
} from "./fixtures/local-storage";
import {
	STATIC_CONTENT_PACKS,
	STATIC_OBJECTIVE_TYPES,
} from "./fixtures/static-content-packs";

const generateDualContentPacks = vi.hoisted(() => vi.fn());

vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks,
}));

const TEST_CONTENT_PACK: ContentPack = {
	setting: "",
	weather: "",
	timeOfDay: "",
	entities: [],
	wallName: "wall",
	aiStarts: {},
};

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

function getMain(): HTMLElement {
	const main = document.querySelector<HTMLElement>("main");
	if (!main) throw new Error("main element not found");
	return main;
}

async function seedOkSession(
	stub: LocalStorageStub,
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

async function seedBrokenSession(
	stub: LocalStorageStub,
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
}

async function seedVersionMismatchSession(
	stub: LocalStorageStub,
	id: string,
	schemaVersion = 999,
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
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns engine
	const rawJson = deobfuscate(files.engine!);
	const sealed = JSON.parse(rawJson);
	sealed.schemaVersion = schemaVersion;
	stub._store[`${prefix}engine.dat`] = obfuscate(JSON.stringify(sealed));
}

describe("renderSessions — screen visibility", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows #sessions-screen and hides #start-screen, #panels, #composer, #endgame, #cap-hit", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("?reason=broken shows the broken banner", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain(), { reason: "broken" });
		const banner = document.querySelector<HTMLElement>("#sessions-banner");
		expect(banner?.hidden).toBe(false);
		expect(banner?.textContent).toContain("unreadable");
	});

	it("?reason=version-mismatch shows the version-mismatch banner", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain(), { reason: "version-mismatch" });
		const banner = document.querySelector<HTMLElement>("#sessions-banner");
		expect(banner?.hidden).toBe(false);
		expect(banner?.textContent).toContain("It has been kept");
	});

	it("?reason=version-mismatch with map-hit schemaVersion renders archive link", async () => {
		vi.resetModules();
		const archiveMapModule = await import("../persistence/archive-map.js");
		archiveMapModule.SCHEMA_ARCHIVE_MAP[9] = "0.1.1";
		try {
			const { renderSessions } = await import("../views/sessions.js");
			renderSessions(getMain(), {
				reason: "version-mismatch",
				schemaVersion: 9,
			});
			const banner = document.querySelector<HTMLElement>("#sessions-banner");
			expect(banner?.hidden).toBe(false);
			expect(banner?.textContent).toContain(
				"Your saved Session is from an older version",
			);
			expect(banner?.textContent).toContain("v0.1.1");
			const link = banner?.querySelector("a");
			expect(link).not.toBeNull();
			expect(link?.getAttribute("href")).toBe("./v/0.1.1/");
		} finally {
			delete archiveMapModule.SCHEMA_ARCHIVE_MAP[9];
		}
	});

	it("no reason param => banner hidden", async () => {
		vi.resetModules();
		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());
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
		const stub = installLocalStorageStub();

		await seedOkSession(stub, "0xAAAA", "2025-03-01T10:00:00.000Z");
		await seedOkSession(stub, "0xBBBB", "2025-02-01T10:00:00.000Z");
		await seedBrokenSession(stub, "0xCCCC");
		await seedVersionMismatchSession(stub, "0xDDDD");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const rows = document.querySelectorAll(".session-row");
		expect(rows).toHaveLength(4);
	});

	it("ok rows show [ load ] [ dup ] [ rm ] buttons", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedOkSession(stub, "0xAAAA", "2025-03-01T10:00:00.000Z");
		stub._store[ACTIVE_KEY] = "0xAAAA";

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedBrokenSession(stub, "0xCCCC");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedVersionMismatchSession(stub, "0xDDDD");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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

	it("version-mismatch row with a mapped schema renders the archived-build note", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedVersionMismatchSession(stub, "0xDDDD", 11);

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xDDDD"]',
		);
		expect(row).toBeTruthy();
		const note = row?.querySelector<HTMLElement>(".session-version-note");
		expect(note).toBeTruthy();
		expect(note?.textContent).toContain("v0.0.2-beta.2");
		const link = note?.querySelector("a");
		expect(link).not.toBeNull();
		expect(link?.getAttribute("href")).toBe("./v/0.0.2-beta.2/");
	});

	it("version-mismatch row with an unmapped schema renders no archived-build note", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedVersionMismatchSession(stub, "0xEEEE", 999);

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xEEEE"]',
		);
		expect(row?.querySelector(".tag-version-mismatch")).toBeTruthy();
		expect(row?.querySelector(".session-version-note")).toBeNull();
	});

	it("broken row shows <corrupted> placeholder text", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedBrokenSession(stub, "0xCCCC");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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

		expect(document.querySelectorAll(".session-row")).toHaveLength(0);

		const remaining = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}0xAAAA/`),
		);
		expect(remaining).toHaveLength(0);
	});
});

describe("renderSessions — [ + new session ] button", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("mints a new session and transitions the view to start", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const newBtn = document.querySelector<HTMLButtonElement>("#sessions-new");
		expect(newBtn).toBeTruthy();
		newBtn?.click();

		const activeId = stub._store[ACTIVE_KEY];
		expect(activeId).toMatch(/^0x[0-9A-F]{4}$/);

		expect(getMain().dataset.view).toBe("start");
	});
});

describe("renderSessions — [ load ] button", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("sets active pointer and transitions the view to game when loading a non-active session", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();

		await seedOkSession(stub, "0xAAAA");
		await seedOkSession(stub, "0xBBBB", "2025-02-01T10:00:00.000Z");
		stub._store[ACTIVE_KEY] = "0xAAAA";

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const rowB = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xBBBB"]',
		);
		const loadBtn = Array.from(
			rowB?.querySelectorAll<HTMLButtonElement>(".ops button") ?? [],
		).find((b) => b.textContent === "[ load ]");
		expect(loadBtn).toBeTruthy();
		loadBtn?.click();

		expect(stub._store[ACTIVE_KEY]).toBe("0xBBBB");
		expect(getMain().dataset.view).toBe("game");
	});
});

async function seedArchivedSessionInStore(
	stub: LocalStorageStub,
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
		const stub = installLocalStorageStub();
		await seedOkSession(stub, "0xAAAA");
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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

	it("archived version-mismatch row with a mapped schema renders the archived-build note", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedArchivedSessionInStore(stub, "0xVMAR");

		const { deobfuscate, obfuscate } = await import(
			"../persistence/sealed-blob-codec.js"
		);
		const engineKey = `${ARCHIVE_PREFIX}0xVMAR/engine.dat`;
		const sealed = JSON.parse(deobfuscate(stub._store[engineKey] ?? ""));
		sealed.schemaVersion = 11;
		stub._store[engineKey] = obfuscate(JSON.stringify(sealed));

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const row = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xVMAR"]',
		);
		expect(row).toBeTruthy();
		const note = row?.querySelector<HTMLElement>(".session-version-note");
		expect(note).toBeTruthy();
		expect(note?.textContent).toContain("v0.0.2-beta.2");
		const link = note?.querySelector("a");
		expect(link).not.toBeNull();
		expect(link?.getAttribute("href")).toBe("./v/0.0.2-beta.2/");
	});

	it("archived row textContent contains 'epoch 1' and 'last played'", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow?.textContent).toContain("epoch 1");
		expect(archivedRow?.textContent).toContain("last played");
	});

	it("archived row has NO [ load ] or [ dup ] button; has [ rm ] button", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const archivedRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xARCH"]',
		);
		expect(archivedRow?.textContent).toContain("[ readonly ]");
	});

	it("active ok row meta-line says 'last played' (not 'saved')", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedOkSession(stub, "0xAAAA");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

		const activeRow = document.querySelector<HTMLElement>(
			'.session-row[data-session-id="0xAAAA"]',
		);
		const metaLine = activeRow?.querySelector(".session-meta");
		expect(metaLine?.textContent).toContain("last played");
		expect(metaLine?.textContent).not.toContain(" saved ");
	});

	it("with zero active sessions and one archived: both headings render; archived row present", async () => {
		vi.resetModules();
		const stub = installLocalStorageStub();
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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
		const stub = installLocalStorageStub();
		await seedArchivedSessionInStore(stub, "0xARCH");

		const { renderSessions } = await import("../views/sessions.js");
		renderSessions(getMain());

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

interface DeferredPacks {
	resolve(): void;
}

function holdContentPacks(): DeferredPacks {
	let release: () => void = () => undefined;
	generateDualContentPacks.mockReturnValue(
		new Promise((resolve) => {
			release = () =>
				resolve({
					packA: STATIC_CONTENT_PACKS[0],
					packB: STATIC_CONTENT_PACKS[0],
					objectiveTypes: STATIC_OBJECTIVE_TYPES,
				});
		}),
	);
	return { resolve: () => release() };
}

function archivedContinueButton(archiveId: string): HTMLButtonElement {
	const btn = document.querySelector<HTMLButtonElement>(
		`.session-row[data-session-id="${archiveId}"] .session-continue-btn`,
	);
	if (!btn) throw new Error(`test: no continue button on ${archiveId}`);
	return btn;
}

function archivedContinueStatus(archiveId: string): string {
	return (
		document.querySelector<HTMLElement>(
			`.session-row[data-session-id="${archiveId}"] .session-continue-status`,
		)?.textContent ?? ""
	);
}

async function landOnSessionsWithBrokenActive(): Promise<LocalStorageStub> {
	const stub = makeLocalStorageStub();
	stub._store.openrouter_key = "sk-or-test";
	vi.stubGlobal("localStorage", stub);
	await seedBrokenSession(stub, "0xBROK");
	await seedArchivedSessionInStore(stub, "0xARCH");
	stub._store[ACTIVE_KEY] = "0xBROK";
	return stub;
}

describe("renderSessions — continue with new room from a forced sessions view", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		generateDualContentPacks.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("takes the player into the new room when a broken active session forced the picker open", async () => {
		vi.resetModules();
		const stub = await landOnSessionsWithBrokenActive();
		const packs = holdContentPacks();
		const { registerView, renderApp } = await import("../render-app.js");
		const { renderSessions } = await import("../views/sessions.js");
		registerView("sessions", renderSessions);
		renderApp(getMain());
		expect(getMain().dataset.view).toBe("sessions");

		archivedContinueButton("0xARCH").click();
		await vi.waitFor(() => expect(generateDualContentPacks).toHaveBeenCalled());
		packs.resolve();

		await vi.waitFor(() => expect(stub._store[ACTIVE_KEY]).not.toBe("0xBROK"));
		expect(stub._store[ACTIVE_KEY]).toMatch(/^0x/);
		expect(getMain().dataset.view).toBe("game");
	});

	it("keeps the reason banner when the pointer moved while the sessions screen stays up", async () => {
		vi.resetModules();
		const stub = await landOnSessionsWithBrokenActive();
		await seedOkSession(stub, "0xOKAY");
		const packs = holdContentPacks();
		const { renderSessions } = await import("../views/sessions.js");
		const root = getMain();
		root.dataset.view = "sessions";
		renderSessions(root, { reason: "broken" });

		archivedContinueButton("0xARCH").click();
		await vi.waitFor(() => expect(generateDualContentPacks).toHaveBeenCalled());
		stub._store[ACTIVE_KEY] = "0xOKAY";
		packs.resolve();

		await vi.waitFor(() =>
			expect(archivedContinueStatus("0xARCH")).toContain("new room ready"),
		);
		expect(stub._store[ACTIVE_KEY]).toBe("0xOKAY");
		const banner = document.querySelector<HTMLElement>("#sessions-banner");
		expect(banner?.hidden).toBe(false);
		expect(banner?.textContent).toContain("unreadable");
	});

	it("gives up on a build that never finishes, says so on the row and re-enables the button", async () => {
		vi.resetModules();
		vi.useFakeTimers();
		const stub = await landOnSessionsWithBrokenActive();
		generateDualContentPacks.mockReturnValue(new Promise(() => undefined));
		const { BOOTSTRAP_LOADING_TIMEOUT_MS } = await import(
			"../game/bootstrap.js"
		);
		const { renderSessions } = await import("../views/sessions.js");
		const root = getMain();
		root.dataset.view = "sessions";
		renderSessions(root, { reason: "broken" });

		archivedContinueButton("0xARCH").click();
		await vi.waitFor(() => expect(generateDualContentPacks).toHaveBeenCalled());
		expect(archivedContinueButton("0xARCH").disabled).toBe(true);
		const provider = generateDualContentPacks.mock.calls[0]?.[3] as {
			signal?: AbortSignal;
		};

		await vi.advanceTimersByTimeAsync(BOOTSTRAP_LOADING_TIMEOUT_MS + 1);

		expect(archivedContinueStatus("0xARCH")).toContain(
			"could not spin up a new room: content-pack generation timed out",
		);
		expect(archivedContinueButton("0xARCH").disabled).toBe(false);
		expect(provider.signal?.aborted).toBe(true);
		expect(stub._store[ACTIVE_KEY]).toBe("0xBROK");

		renderSessions(root, { reason: "broken" });
		expect(archivedContinueButton("0xARCH").disabled).toBe(false);
	});
});
