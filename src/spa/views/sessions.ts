import { paintBanner, paintTopInfo } from "../bbs-chrome.js";
import { lookupArchiveVersion } from "../persistence/archive-map.js";
import {
	dupSession,
	getActiveSessionId,
	getArchivedSessionInfo,
	getSessionInfo,
	listArchivedSessions,
	listSessions,
	loadActiveSession,
	loadArchivedSession,
	mintSession,
	rmArchivedSession,
	rmSession,
	seedFromArchive,
	setActiveSessionId,
} from "../persistence/session-storage.js";
import { type RenderOpts, renderApp, setPickerOpen } from "../render-app.js";
import { buildArchivedBuildLink } from "./archived-build-link.js";

const SESSIONS_BANNER_MESSAGES: Record<string, string> = {
	broken: "The active Session was unreadable and could not be loaded.",
	"version-mismatch":
		"Saved game data is from an older version of hi-blue and cannot be loaded by this build. It has been kept — start a new game, or remove it from your Sessions list.",
};

function renderVersionMismatchBanner(
	doc: Document,
	bannerEl: HTMLElement,
	schemaVersion: number | undefined,
): void {
	bannerEl.textContent = "";
	const archivedVersion = lookupArchiveVersion(schemaVersion);
	if (archivedVersion === null) {
		bannerEl.textContent = SESSIONS_BANNER_MESSAGES["version-mismatch"] ?? "";
		return;
	}
	bannerEl.appendChild(
		doc.createTextNode(
			"Your saved Session is from an older version of hi-blue. Continue it in ",
		),
	);
	bannerEl.appendChild(buildArchivedBuildLink(doc, archivedVersion));
	bannerEl.appendChild(doc.createTextNode(", or start a new Session below."));
}

function showOnly(doc: Document, visibleId: string): void {
	const hide = [
		"#start-screen",
		"#panels",
		"#composer",
		"#endgame",
		"#cap-hit",
	];
	for (const sel of hide) {
		const el = doc.querySelector<HTMLElement>(sel);
		if (el) el.hidden = true;
	}
	const target = doc.querySelector<HTMLElement>(visibleId);
	if (target) target.hidden = false;
}

function buildTreeLines(
	doc: Document,
	files: Array<{ glyph: string; label: string }>,
): HTMLElement {
	const pre = doc.createElement("pre");
	pre.className = "session-tree";
	pre.textContent = files.map((f) => `${f.glyph} ${f.label}`).join("\n");
	return pre;
}

const FILE_NAME_COLUMN_WIDTH = 22;

function fileLabel(name: string, size: number): string {
	const sizeStr = `${size}B`;
	const padded = name.padEnd(FILE_NAME_COLUMN_WIDTH, " ");
	return `${padded}${sizeStr}`;
}

function showGlobalChrome(doc: Document): void {
	for (const selector of ["#stage > header", "#topinfo", "#banner"]) {
		doc.querySelector<HTMLElement>(selector)?.removeAttribute("hidden");
	}
}

type RowData =
	| { id: string; kind: "ok"; lastSavedAt: string }
	| { id: string; kind: "broken" | "version-mismatch" };

function okRowsNewestFirstThenOthersById(a: RowData, b: RowData): number {
	if (a.kind === "ok" && b.kind === "ok") {
		return b.lastSavedAt.localeCompare(a.lastSavedAt);
	}
	if (a.kind === "ok") return -1;
	if (b.kind === "ok") return 1;
	return a.id.localeCompare(b.id);
}

export function renderSessions(root: HTMLElement, opts?: RenderOpts): void {
	const doc = root.ownerDocument;

	showOnly(doc, "#sessions-screen");
	showGlobalChrome(doc);

	paintBanner(doc);
	const loadResult = loadActiveSession();
	if (loadResult.kind === "ok") {
		paintTopInfo(doc, {
			sessionId: loadResult.sessionId,
			epoch: loadResult.epoch,
			turn: loadResult.state.round,
		});
	}

	const bannerEl = doc.querySelector<HTMLElement>("#sessions-banner");
	const reason = opts?.reason ?? null;
	if (bannerEl) {
		if (reason === "version-mismatch") {
			renderVersionMismatchBanner(doc, bannerEl, opts?.schemaVersion);
			bannerEl.hidden = false;
		} else if (reason && SESSIONS_BANNER_MESSAGES[reason]) {
			bannerEl.textContent = SESSIONS_BANNER_MESSAGES[reason] ?? "";
			bannerEl.hidden = false;
		} else {
			bannerEl.textContent = "";
			bannerEl.hidden = true;
		}
	}

	const listEl = doc.querySelector<HTMLElement>("#sessions-list");
	if (!listEl) return;

	const reRender = (): void => renderSessions(root, opts);

	const ids = listSessions();
	const activeId = getActiveSessionId();

	const rowData: RowData[] = [];
	for (const id of ids) {
		const info = getSessionInfo(id);
		if (info.kind === "ok") {
			rowData.push({ id, kind: "ok", lastSavedAt: info.lastSavedAt });
		} else if (info.kind === "broken" || info.kind === "version-mismatch") {
			rowData.push({ id, kind: info.kind });
		}
	}

	rowData.sort(okRowsNewestFirstThenOthersById);

	listEl.textContent = "";

	const activeHeading = doc.createElement("h2");
	activeHeading.className = "sessions-section-heading";
	activeHeading.textContent = "active sessions";
	listEl.appendChild(activeHeading);

	for (const row of rowData) {
		const rowEl = buildSessionRow(root, row.id, activeId, reRender);
		listEl.appendChild(rowEl);
	}

	if (rowData.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "sessions-empty";
		empty.textContent = "no sessions found.";
		listEl.appendChild(empty);
	}

	const archivedHeading = doc.createElement("h2");
	archivedHeading.className = "sessions-section-heading";
	archivedHeading.textContent = "archived sessions";
	listEl.appendChild(archivedHeading);

	const archivedIds = listArchivedSessions();
	for (const id of archivedIds) {
		listEl.appendChild(buildArchivedSessionRow(root, id, reRender));
	}
	if (archivedIds.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "sessions-empty";
		empty.textContent = "no archived sessions.";
		listEl.appendChild(empty);
	}

	const newBtn = doc.querySelector<HTMLButtonElement>("#sessions-new");
	if (newBtn) {
		const newBtnWithoutListeners = newBtn.cloneNode(true) as HTMLButtonElement;
		newBtn.replaceWith(newBtnWithoutListeners);
		newBtnWithoutListeners.addEventListener("click", () => {
			const newId = mintSession();
			setActiveSessionId(newId);
			setPickerOpen(false);
			renderApp(root);
		});
	}
}

function buildSessionRow(
	root: HTMLElement,
	id: string,
	activeId: string | null,
	reRender: () => void,
): HTMLElement {
	const doc = root.ownerDocument;
	const info = getSessionInfo(id);
	const isActive = id === activeId;

	const rowEl = doc.createElement("div");
	rowEl.className = "session-row";
	rowEl.dataset.sessionId = id;

	const dirLine = doc.createElement("div");
	dirLine.className = "session-dir";
	dirLine.textContent = `${id}/`;
	if (isActive) {
		const activeTag = doc.createElement("span");
		activeTag.className = "tag-active";
		activeTag.textContent = " [ active ]";
		dirLine.appendChild(activeTag);
	}
	rowEl.appendChild(dirLine);

	if (info.kind === "ok") {
		const metaLine = doc.createElement("div");
		metaLine.className = "session-meta";
		const round = info.round;
		const savedShort = info.lastSavedAt.replace("T", " ").slice(0, 19);
		metaLine.textContent = `epoch ${info.epoch} · turn ${round} · last played ${savedShort}`;
		rowEl.appendChild(metaLine);

		const allFiles: Array<{ glyph: string; label: string }> = [];
		for (let i = 0; i < info.daemonFiles.length; i++) {
			const f = info.daemonFiles[i];
			if (!f) continue;
			allFiles.push({
				glyph: "├─",
				label: fileLabel(`*${f.name}`, f.size),
			});
		}
		allFiles.push({
			glyph: "└─",
			label: fileLabel("engine.dat", info.engineSize),
		});
		rowEl.appendChild(buildTreeLines(doc, allFiles));

		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);

		const loadBtn = doc.createElement("button");
		loadBtn.type = "button";
		loadBtn.textContent = "[ load ]";
		loadBtn.addEventListener("click", () => {
			if (!isActive) {
				setActiveSessionId(id);
			}
			setPickerOpen(false);
			renderApp(root);
		});
		opsEl.appendChild(loadBtn);

		const dupBtn = doc.createElement("button");
		dupBtn.type = "button";
		dupBtn.textContent = "[ dup ]";
		dupBtn.addEventListener("click", () => {
			try {
				dupSession(id);
				reRender();
			} catch {}
		});
		opsEl.appendChild(dupBtn);

		buildRmControls(doc, id, opsEl, reRender);
	} else if (info.kind === "broken") {
		const tagEl = doc.createElement("span");
		tagEl.className = "tag-corrupt";
		tagEl.textContent = "[ corrupt ]";
		rowEl.appendChild(tagEl);

		const placeholderFiles = [
			{ glyph: "├─", label: "<corrupted>" },
			{ glyph: "├─", label: "<corrupted>" },
			{ glyph: "└─", label: "<corrupted>" },
		];
		rowEl.appendChild(buildTreeLines(doc, placeholderFiles));

		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);
		buildRmControls(doc, id, opsEl, reRender);
	} else {
		const tagEl = doc.createElement("span");
		tagEl.className = "tag-version-mismatch";
		tagEl.textContent = "[ version mismatch ]";
		rowEl.appendChild(tagEl);
		appendVersionMismatchNote(doc, rowEl, info.schemaVersion);

		const treeFiles: Array<{ glyph: string; label: string }> = [];
		for (let i = 0; i < info.daemonFiles.length; i++) {
			const f = info.daemonFiles[i];
			if (!f) continue;
			treeFiles.push({
				glyph: i < info.daemonFiles.length - 1 ? "├─" : "└─",
				label: fileLabel(`*${f.name}`, f.size),
			});
		}
		if (treeFiles.length > 0) {
			rowEl.appendChild(buildTreeLines(doc, treeFiles));
		}

		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);
		buildRmControls(doc, id, opsEl, reRender);
	}

	return rowEl;
}

function appendVersionMismatchNote(
	doc: Document,
	rowEl: HTMLElement,
	schemaVersion: number,
): void {
	const archivedVersion = lookupArchiveVersion(schemaVersion);
	if (archivedVersion === null) return;
	const noteEl = doc.createElement("div");
	noteEl.className = "session-version-note";
	noteEl.textContent = "older version · continue in ";
	noteEl.appendChild(buildArchivedBuildLink(doc, archivedVersion));
	rowEl.appendChild(noteEl);
}

function buildRmControls(
	doc: Document,
	id: string,
	opsEl: HTMLElement,
	reRender: () => void,
): void {
	const rmBtn = doc.createElement("button");
	rmBtn.type = "button";
	rmBtn.textContent = "[ rm ]";
	rmBtn.addEventListener("click", () => {
		rmBtn.remove();
		const confirmBtn = doc.createElement("button");
		confirmBtn.type = "button";
		confirmBtn.textContent = "[ confirm rm ]";
		confirmBtn.addEventListener("click", () => {
			rmSession(id);
			reRender();
		});

		const cancelBtn = doc.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = "[ cancel ]";
		cancelBtn.addEventListener("click", () => {
			confirmBtn.remove();
			cancelBtn.remove();
			opsEl.appendChild(rmBtn);
		});

		opsEl.appendChild(confirmBtn);
		opsEl.appendChild(cancelBtn);
	});
	opsEl.appendChild(rmBtn);
}

function hasOpenRouterKey(): boolean {
	try {
		return localStorage.getItem("openrouter_key") !== null;
	} catch {
		return false;
	}
}

function buildArchivedSessionRow(
	root: HTMLElement,
	id: string,
	reRender: () => void,
): HTMLElement {
	const doc = root.ownerDocument;
	const info = getArchivedSessionInfo(id);

	const rowEl = doc.createElement("div");
	rowEl.className = "session-row";
	rowEl.dataset.sessionId = id;

	const dirLine = doc.createElement("div");
	dirLine.className = "session-dir";
	dirLine.textContent = `${id}/`;
	const readonlyTag = doc.createElement("span");
	readonlyTag.className = "tag-readonly";
	readonlyTag.textContent = " [ readonly ]";
	dirLine.appendChild(readonlyTag);
	rowEl.appendChild(dirLine);

	if (info.kind === "archived") {
		const metaLine = doc.createElement("div");
		metaLine.className = "session-meta";
		const round = info.round;
		const playedShort = info.lastPlayedAt.replace("T", " ").slice(0, 19);
		metaLine.textContent = `epoch ${info.epoch} · turn ${round} · last played ${playedShort}`;
		rowEl.appendChild(metaLine);

		const allFiles: Array<{ glyph: string; label: string }> = [];
		for (let i = 0; i < info.daemonFiles.length; i++) {
			const f = info.daemonFiles[i];
			if (!f) continue;
			allFiles.push({
				glyph: "├─",
				label: fileLabel(`*${f.name}`, f.size),
			});
		}
		allFiles.push({
			glyph: "└─",
			label: fileLabel("engine.dat", info.engineSize),
		});
		rowEl.appendChild(buildTreeLines(doc, allFiles));

		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);

		if (hasOpenRouterKey()) {
			const continueBtn = doc.createElement("button");
			continueBtn.type = "button";
			continueBtn.textContent = "[ continue with new room ]";
			continueBtn.addEventListener("click", async () => {
				continueBtn.disabled = true;
				try {
					const archiveResult = loadArchivedSession(id);
					if (archiveResult.kind !== "ok") {
						continueBtn.disabled = false;
						return;
					}
					const { buildSameDaemonsSession } = await import(
						"../game/bootstrap.js"
					);
					const newSession = await buildSameDaemonsSession(
						archiveResult.state.personas,
					);
					const freshState = newSession.getState();
					const newId = seedFromArchive(id, freshState);
					setActiveSessionId(newId);
					setPickerOpen(false);
					renderApp(root);
				} catch {
					continueBtn.disabled = false;
				}
			});
			opsEl.appendChild(continueBtn);
		}

		buildArchivedRmControls(doc, id, opsEl, reRender);
	} else if (info.kind === "broken") {
		const tagEl = doc.createElement("span");
		tagEl.className = "tag-corrupt";
		tagEl.textContent = "[ corrupt ]";
		rowEl.appendChild(tagEl);

		const placeholderFiles = [
			{ glyph: "├─", label: "<corrupted>" },
			{ glyph: "├─", label: "<corrupted>" },
			{ glyph: "└─", label: "<corrupted>" },
		];
		rowEl.appendChild(buildTreeLines(doc, placeholderFiles));

		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);
		buildArchivedRmControls(doc, id, opsEl, reRender);
	} else {
		const tagEl = doc.createElement("span");
		tagEl.className = "tag-version-mismatch";
		tagEl.textContent = "[ version mismatch ]";
		rowEl.appendChild(tagEl);
		appendVersionMismatchNote(doc, rowEl, info.schemaVersion);

		const treeFiles: Array<{ glyph: string; label: string }> = [];
		for (let i = 0; i < info.daemonFiles.length; i++) {
			const f = info.daemonFiles[i];
			if (!f) continue;
			treeFiles.push({
				glyph: i < info.daemonFiles.length - 1 ? "├─" : "└─",
				label: fileLabel(`*${f.name}`, f.size),
			});
		}
		if (treeFiles.length > 0) {
			rowEl.appendChild(buildTreeLines(doc, treeFiles));
		}

		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);
		buildArchivedRmControls(doc, id, opsEl, reRender);
	}

	return rowEl;
}

function buildArchivedRmControls(
	doc: Document,
	id: string,
	opsEl: HTMLElement,
	reRender: () => void,
): void {
	const rmBtn = doc.createElement("button");
	rmBtn.type = "button";
	rmBtn.textContent = "[ rm ]";
	rmBtn.addEventListener("click", () => {
		rmBtn.remove();
		const confirmBtn = doc.createElement("button");
		confirmBtn.type = "button";
		confirmBtn.textContent = "[ confirm rm ]";
		confirmBtn.addEventListener("click", () => {
			rmArchivedSession(id);
			reRender();
		});

		const cancelBtn = doc.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = "[ cancel ]";
		cancelBtn.addEventListener("click", () => {
			confirmBtn.remove();
			cancelBtn.remove();
			opsEl.appendChild(rmBtn);
		});

		opsEl.appendChild(confirmBtn);
		opsEl.appendChild(cancelBtn);
	});
	opsEl.appendChild(rmBtn);
}
