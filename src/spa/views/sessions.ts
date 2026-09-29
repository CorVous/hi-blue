import { paintBanner, paintTopInfo } from "../bbs-chrome.js";
import { readStoredByokKey } from "../openrouter-key.js";
import { lookupArchiveVersion } from "../persistence/archive-map.js";
import {
	captureActiveSession,
	dupSession,
	getActiveSessionId,
	getArchivedSessionInfo,
	getSessionInfo,
	listArchivedSessions,
	listSessions,
	loadActiveSession,
	loadArchivedSession,
	mintSessionId,
	rmArchivedSession,
	rmSession,
	seedFromArchive,
	setActiveSessionId,
} from "../persistence/session-storage.js";
import {
	isPickerOpen,
	type RenderOpts,
	renderApp,
	setPickerOpen,
} from "../render-app.js";
import {
	buildArchivedBuildLink,
	renderReasonBanner,
	VERSION_MISMATCH_MESSAGE,
} from "./archived-build-link.js";
import { dropListenersByCloning, setHidden } from "./dom.js";

const SESSIONS_BANNER_MESSAGES: Record<string, string> = {
	broken: "The active Session was unreadable and could not be loaded.",
	"version-mismatch": VERSION_MISMATCH_MESSAGE,
};

function showOnly(doc: Document, visibleId: string): void {
	setHidden(
		doc,
		["#start-screen", "#panels", "#composer", "#endgame", "#cap-hit"],
		true,
	);
	setHidden(doc, [visibleId], false);
}

function buildTreeLines(doc: Document, labels: string[]): HTMLElement {
	const pre = doc.createElement("pre");
	pre.className = "session-tree";
	pre.textContent = labels
		.map((label, i) => `${i < labels.length - 1 ? "├─" : "└─"} ${label}`)
		.join("\n");
	return pre;
}

const FILE_NAME_COLUMN_WIDTH = 22;

function fileLabel(name: string, size: number): string {
	const sizeStr = `${size}B`;
	const padded = name.padEnd(FILE_NAME_COLUMN_WIDTH, " ");
	return `${padded}${sizeStr}`;
}

function daemonFileLabels(
	daemonFiles: Array<{ name: string; size: number }>,
): string[] {
	return daemonFiles.map((f) => fileLabel(`*${f.name}`, f.size));
}

function buildButton(doc: Document, text: string): HTMLButtonElement {
	const btn = doc.createElement("button");
	btn.type = "button";
	btn.textContent = text;
	return btn;
}

function buildSpan(
	doc: Document,
	className: string,
	text: string,
): HTMLElement {
	const span = doc.createElement("span");
	span.className = className;
	span.textContent = text;
	return span;
}

function showGlobalChrome(doc: Document): void {
	setHidden(doc, ["#stage > header", "#topinfo", "#banner"], false);
}

type ActiveRow = { id: string; info: ReturnType<typeof getSessionInfo> };

function okRowsNewestFirstThenOthersById(a: ActiveRow, b: ActiveRow): number {
	if (a.info.kind === "ok" && b.info.kind === "ok") {
		return b.info.lastSavedAt.localeCompare(a.info.lastSavedAt);
	}
	if (a.info.kind === "ok") return -1;
	if (b.info.kind === "ok") return 1;
	return a.id.localeCompare(b.id);
}

function appendSection(
	listEl: HTMLElement,
	heading: string,
	rowEls: HTMLElement[],
	emptyText: string,
): void {
	const doc = listEl.ownerDocument;
	const headingEl = doc.createElement("h2");
	headingEl.className = "sessions-section-heading";
	headingEl.textContent = heading;
	listEl.appendChild(headingEl);

	for (const rowEl of rowEls) listEl.appendChild(rowEl);

	if (rowEls.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "sessions-empty";
		empty.textContent = emptyText;
		listEl.appendChild(empty);
	}
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

	renderReasonBanner(
		doc,
		doc.querySelector<HTMLElement>("#sessions-banner"),
		opts?.reason ?? null,
		opts?.schemaVersion,
		SESSIONS_BANNER_MESSAGES,
	);

	const listEl = doc.querySelector<HTMLElement>("#sessions-list");
	if (!listEl) return;

	const reRender = (): void => renderSessions(root, opts);
	const activeId = getActiveSessionId();

	const activeRows: ActiveRow[] = listSessions().map((id) => ({
		id,
		info: getSessionInfo(id),
	}));
	activeRows.sort(okRowsNewestFirstThenOthersById);

	listEl.textContent = "";

	appendSection(
		listEl,
		"active sessions",
		activeRows.map(({ id, info }) => {
			const isActive = id === activeId;
			return buildSessionRow(doc, id, info, {
				dirTag: isActive ? ACTIVE_TAG : null,
				appendPlayableOps: (opsEl) =>
					appendActiveOps(root, id, isActive, opsEl, reRender),
				remove: rmSession,
				reRender,
			});
		}),
		"no sessions found.",
	);

	appendSection(
		listEl,
		"archived sessions",
		listArchivedSessions().map((id) =>
			buildSessionRow(doc, id, getArchivedSessionInfo(id), {
				dirTag: READONLY_TAG,
				appendPlayableOps: (opsEl) => appendArchivedOps(root, id, opsEl),
				remove: rmArchivedSession,
				reRender,
			}),
		),
		"no archived sessions.",
	);
	for (const archiveId of archiveContinues.keys()) {
		paintArchiveContinue(doc, archiveId);
	}

	const newBtn = doc.querySelector<HTMLButtonElement>("#sessions-new");
	if (newBtn) {
		const newBtnWithoutListeners = dropListenersByCloning(newBtn);
		newBtnWithoutListeners.addEventListener("click", () => {
			const newId = mintSessionId();
			setActiveSessionId(newId);
			setPickerOpen(false);
			renderApp(root);
		});
	}
}

type DirTag = { className: string; text: string };

const ACTIVE_TAG: DirTag = { className: "tag-active", text: " [ active ]" };
const READONLY_TAG: DirTag = {
	className: "tag-readonly",
	text: " [ readonly ]",
};

interface SessionRowVariant {
	dirTag: DirTag | null;
	appendPlayableOps: (opsEl: HTMLElement) => void;
	remove: (id: string) => void;
	reRender: () => void;
}

type RowInfo =
	| ReturnType<typeof getSessionInfo>
	| ReturnType<typeof getArchivedSessionInfo>;

function buildSessionRow(
	doc: Document,
	id: string,
	info: RowInfo,
	variant: SessionRowVariant,
): HTMLElement {
	const rowEl = doc.createElement("div");
	rowEl.className = "session-row";
	rowEl.dataset.sessionId = id;

	const dirLine = doc.createElement("div");
	dirLine.className = "session-dir";
	dirLine.textContent = `${id}/`;
	if (variant.dirTag) {
		dirLine.appendChild(
			buildSpan(doc, variant.dirTag.className, variant.dirTag.text),
		);
	}
	rowEl.appendChild(dirLine);

	const opsEl = doc.createElement("div");
	opsEl.className = "ops";

	if (info.kind === "ok" || info.kind === "archived") {
		const lastPlayedAt =
			info.kind === "ok" ? info.lastSavedAt : info.lastPlayedAt;
		const metaLine = doc.createElement("div");
		metaLine.className = "session-meta";
		const playedShort = lastPlayedAt.replace("T", " ").slice(0, 19);
		metaLine.textContent = `epoch ${info.epoch} · turn ${info.round} · last played ${playedShort}`;
		rowEl.appendChild(metaLine);

		rowEl.appendChild(
			buildTreeLines(doc, [
				...daemonFileLabels(info.daemonFiles),
				fileLabel("engine.dat", info.engineSize),
			]),
		);
		variant.appendPlayableOps(opsEl);
	} else if (info.kind === "broken") {
		rowEl.appendChild(buildSpan(doc, "tag-corrupt", "[ corrupt ]"));
		rowEl.appendChild(
			buildTreeLines(doc, ["<corrupted>", "<corrupted>", "<corrupted>"]),
		);
	} else {
		rowEl.appendChild(
			buildSpan(doc, "tag-version-mismatch", "[ version mismatch ]"),
		);
		appendVersionMismatchNote(doc, rowEl, info.schemaVersion);
		const labels = daemonFileLabels(info.daemonFiles);
		if (labels.length > 0) {
			rowEl.appendChild(buildTreeLines(doc, labels));
		}
	}

	rowEl.appendChild(opsEl);
	appendRmControls(doc, opsEl, () => {
		variant.remove(id);
		variant.reRender();
	});

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

function appendActiveOps(
	root: HTMLElement,
	id: string,
	isActive: boolean,
	opsEl: HTMLElement,
	reRender: () => void,
): void {
	const doc = root.ownerDocument;

	const loadBtn = buildButton(doc, "[ load ]");
	loadBtn.addEventListener("click", () => {
		if (!isActive) {
			setActiveSessionId(id);
		}
		setPickerOpen(false);
		renderApp(root);
	});
	opsEl.appendChild(loadBtn);

	const dupBtn = buildButton(doc, "[ dup ]");
	dupBtn.addEventListener("click", () => {
		try {
			dupSession(id);
			reRender();
		} catch {}
	});
	opsEl.appendChild(dupBtn);
}

interface ArchiveContinue {
	inFlight: boolean;
	status: string;
}

const archiveContinues = new Map<string, ArchiveContinue>();

const SPINNING_UP_STATUS = "spinning up a new room…";

function failureMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function findArchivedContinueControls(
	doc: Document,
	archiveId: string,
): { button: HTMLButtonElement; statusEl: HTMLElement } | null {
	for (const row of doc.querySelectorAll<HTMLElement>(
		"#sessions-list .session-row",
	)) {
		if (row.dataset.sessionId !== archiveId) continue;
		const button = row.querySelector<HTMLButtonElement>(
			".session-continue-btn",
		);
		const statusEl = row.querySelector<HTMLElement>(".session-continue-status");
		if (button && statusEl) return { button, statusEl };
	}
	return null;
}

function paintArchiveContinue(doc: Document, archiveId: string): void {
	const controls = findArchivedContinueControls(doc, archiveId);
	if (!controls) return;
	const record = archiveContinues.get(archiveId);
	controls.button.disabled = record?.inFlight ?? false;
	controls.statusEl.textContent = record?.status ?? "";
	controls.statusEl.hidden = !record?.status;
}

function settleArchiveContinue(
	doc: Document,
	archiveId: string,
	status: string,
): void {
	archiveContinues.set(archiveId, { inFlight: false, status });
	paintArchiveContinue(doc, archiveId);
}

async function continueArchiveInNewRoom(
	root: HTMLElement,
	archiveId: string,
): Promise<void> {
	const doc = root.ownerDocument;
	if (archiveContinues.get(archiveId)?.inFlight) return;
	const startedFrom = captureActiveSession();
	archiveContinues.set(archiveId, {
		inFlight: true,
		status: SPINNING_UP_STATUS,
	});
	paintArchiveContinue(doc, archiveId);

	const archiveResult = loadArchivedSession(archiveId);
	if (archiveResult.kind !== "ok") {
		settleArchiveContinue(
			doc,
			archiveId,
			"could not continue: this archive could not be loaded",
		);
		return;
	}

	let newId: string;
	try {
		const { buildSameDaemonsSession } = await import("../game/bootstrap.js");
		const newSession = await buildSameDaemonsSession(
			archiveResult.state.personas,
		);
		newId = seedFromArchive(archiveId, newSession.getState());
	} catch (err) {
		settleArchiveContinue(
			doc,
			archiveId,
			`could not spin up a new room: ${failureMessage(err)}`,
		);
		return;
	}

	const playerMovedOn = !startedFrom.stillActive() || !isPickerOpen();
	if (playerMovedOn) {
		settleArchiveContinue(doc, archiveId, `new room ready as ${newId}`);
		if (root.dataset.view === "sessions") renderSessions(root);
		return;
	}
	archiveContinues.delete(archiveId);
	setActiveSessionId(newId);
	setPickerOpen(false);
	renderApp(root);
}

function appendArchivedOps(
	root: HTMLElement,
	id: string,
	opsEl: HTMLElement,
): void {
	if (readStoredByokKey() === null) return;
	const doc = root.ownerDocument;

	const continueBtn = buildButton(doc, "[ continue with new room ]");
	continueBtn.classList.add("session-continue-btn");
	continueBtn.addEventListener("click", () => {
		void continueArchiveInNewRoom(root, id);
	});
	opsEl.appendChild(continueBtn);

	const statusEl = doc.createElement("output");
	statusEl.className = "session-continue-status";
	statusEl.setAttribute("aria-live", "polite");
	statusEl.hidden = true;
	opsEl.appendChild(statusEl);
}

function appendRmControls(
	doc: Document,
	opsEl: HTMLElement,
	confirmRemove: () => void,
): void {
	const rmBtn = buildButton(doc, "[ rm ]");
	rmBtn.addEventListener("click", () => {
		rmBtn.remove();
		const confirmBtn = buildButton(doc, "[ confirm rm ]");
		confirmBtn.addEventListener("click", confirmRemove);

		const cancelBtn = buildButton(doc, "[ cancel ]");
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
