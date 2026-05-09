/**
 * sessions.ts
 *
 * Route renderer for #/sessions.
 *
 * Responsibilities:
 *   - Show #sessions-screen, hide #start-screen, #panels, #composer,
 *     #endgame, #cap-hit.
 *   - Show #sessions-banner when ?reason=broken|version-mismatch is present.
 *   - Render a row per session returned by listSessions():
 *       ok    → [ load ] [ dup ] [ rm ] with tree-glyph file listing
 *       broken  → [ corrupt ] tag + [ rm ] only
 *       version-mismatch → [ version mismatch ] tag + [ rm ] only
 *   - Inline [ rm ] confirmation: swaps button cell to [ confirm rm ] + [ cancel ].
 *   - [ + new session ] at bottom: mint → setActive → #/start.
 *
 * Issue #174 (parent #155).
 */

import { PHASE_1_CONFIG } from "../../content";
import { paintBanner, paintTopInfo } from "../bbs-chrome.js";
import { getActivePhase } from "../game/engine.js";
import type { PhaseConfig } from "../game/types";
import {
	dupSession,
	getActiveSessionId,
	getSessionInfo,
	listSessions,
	loadActiveSession,
	mintSession,
	rmSession,
	setActiveSessionId,
} from "../persistence/session-storage.js";

// ── Banner copy ───────────────────────────────────────────────────────────────

export const SESSIONS_BANNER_MESSAGES: Record<string, string> = {
	broken: "The active Session was unreadable and could not be loaded.",
	"version-mismatch":
		"The active Session is from an older version of hi-blue and could not be loaded.",
};

// ── Visibility helpers ────────────────────────────────────────────────────────

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

// ── Row rendering helpers ─────────────────────────────────────────────────────

/**
 * Build a tree-glyph file listing line using `white-space: pre`.
 * Lines: ├─ *<name>   <size>B  (for all but last)
 *        └─ <name>    <size>B  (for last)
 */
function buildTreeLines(
	doc: Document,
	files: Array<{ glyph: string; label: string }>,
): HTMLElement {
	const pre = doc.createElement("pre");
	pre.className = "session-tree";
	pre.textContent = files.map((f) => `${f.glyph} ${f.label}`).join("\n");
	return pre;
}

/** Pad a label + size into a fixed-width line (20 chars for label). */
function fileLabel(name: string, size: number): string {
	const sizeStr = `${size}B`;
	const padded = name.padEnd(22, " ");
	return `${padded}${sizeStr}`;
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export function renderSessions(
	root: HTMLElement,
	params?: URLSearchParams,
): void {
	const doc = root.ownerDocument;

	// Route-entry visibility
	showOnly(doc, "#sessions-screen");
	// Restore the global chrome that the start route hides during the login takeover.
	const headerEl = doc.querySelector<HTMLElement>("#stage > header");
	const topinfoEl = doc.querySelector<HTMLElement>("#topinfo");
	const bannerWrapEl = doc.querySelector<HTMLElement>("#banner");
	if (headerEl) headerEl.removeAttribute("hidden");
	if (topinfoEl) topinfoEl.removeAttribute("hidden");
	if (bannerWrapEl) bannerWrapEl.removeAttribute("hidden");

	// Persistent chrome (visible on every route): ASCII banner + topinfo.
	// Direct-load on #/sessions otherwise leaves them empty.
	paintBanner(doc);
	const loadResult = loadActiveSession();
	if (loadResult.kind === "ok") {
		const phase = getActivePhase(loadResult.state);
		let total = 1;
		let cursor: PhaseConfig | undefined = PHASE_1_CONFIG.nextPhaseConfig;
		while (cursor) {
			total += 1;
			cursor = cursor.nextPhaseConfig;
		}
		const daemonsOnline = Object.keys(loadResult.state.personas).filter(
			(id) => !phase.chatLockouts.has(id),
		).length;
		paintTopInfo(doc, {
			sessionId: loadResult.sessionId,
			phaseNumber: phase.phaseNumber,
			totalPhases: total,
			turn: phase.round,
			daemonsOnline,
		});
	}

	// Banner
	const bannerEl = doc.querySelector<HTMLElement>("#sessions-banner");
	const reason = params?.get("reason") ?? null;
	if (bannerEl) {
		if (reason && SESSIONS_BANNER_MESSAGES[reason]) {
			bannerEl.textContent = SESSIONS_BANNER_MESSAGES[reason] ?? "";
			bannerEl.hidden = false;
		} else {
			bannerEl.textContent = "";
			bannerEl.hidden = true;
		}
	}

	// List container
	const listEl = doc.querySelector<HTMLElement>("#sessions-list");
	if (!listEl) return;

	// Re-render helper (re-renders list + re-wires new button)
	const reRender = (): void => renderSessions(root, params);

	// Gather + sort sessions
	const ids = listSessions();
	const activeId = getActiveSessionId();

	type RowData =
		| { id: string; kind: "ok"; lastSavedAt: string }
		| { id: string; kind: "broken" | "version-mismatch" };

	const rowData: RowData[] = [];
	for (const id of ids) {
		const info = getSessionInfo(id);
		if (info.kind === "ok") {
			rowData.push({ id, kind: "ok", lastSavedAt: info.lastSavedAt });
		} else {
			rowData.push({ id, kind: info.kind });
		}
	}

	// Sort: ok rows by lastSavedAt desc, then broken/version-mismatch by id asc
	rowData.sort((a, b) => {
		if (a.kind === "ok" && b.kind === "ok") {
			return b.lastSavedAt.localeCompare(a.lastSavedAt);
		}
		if (a.kind === "ok") return -1;
		if (b.kind === "ok") return 1;
		return a.id.localeCompare(b.id);
	});

	// Clear and rebuild list
	listEl.textContent = "";

	for (const row of rowData) {
		const rowEl = buildSessionRow(doc, row.id, activeId, reRender);
		listEl.appendChild(rowEl);
	}

	if (rowData.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "sessions-empty";
		empty.textContent = "no sessions found.";
		listEl.appendChild(empty);
	}

	// [ + new session ] button
	const newBtn = doc.querySelector<HTMLButtonElement>("#sessions-new");
	if (newBtn) {
		// Remove old listener by cloning
		const fresh = newBtn.cloneNode(true) as HTMLButtonElement;
		newBtn.replaceWith(fresh);
		fresh.addEventListener("click", () => {
			const newId = mintSession();
			setActiveSessionId(newId);
			location.hash = "#/start";
		});
	}
}

// ── Row builder ───────────────────────────────────────────────────────────────

function buildSessionRow(
	doc: Document,
	id: string,
	activeId: string | null,
	reRender: () => void,
): HTMLElement {
	const info = getSessionInfo(id);
	const isActive = id === activeId;

	const rowEl = doc.createElement("div");
	rowEl.className = "session-row";
	rowEl.dataset.sessionId = id;

	// Dirname line
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
		// Meta line
		const metaLine = doc.createElement("div");
		metaLine.className = "session-meta";
		const round = info.round;
		const savedShort = info.lastSavedAt.replace("T", " ").slice(0, 19);
		metaLine.textContent = `phase ${info.phase} · turn ${round} · saved ${savedShort}`;
		rowEl.appendChild(metaLine);

		// Tree lines
		const allFiles: Array<{ glyph: string; label: string }> = [];
		for (let i = 0; i < info.daemonFiles.length; i++) {
			const f = info.daemonFiles[i];
			if (!f) continue;
			const isLast =
				i === info.daemonFiles.length - 1 &&
				info.whispersSize === 0 &&
				info.engineSize === 0;
			allFiles.push({
				glyph: isLast ? "└─" : "├─",
				label: fileLabel(`*${f.name}`, f.size),
			});
		}
		// whispers.txt
		allFiles.push({
			glyph: "├─",
			label: fileLabel("whispers.txt", info.whispersSize),
		});
		// engine.dat (last)
		allFiles.push({
			glyph: "└─",
			label: fileLabel("engine.dat", info.engineSize),
		});
		// Fix last flag — the last item is always engine.dat
		if (allFiles.length >= 1) {
			const last = allFiles[allFiles.length - 1];
			if (last) last.glyph = "└─";
			// Also fix the item before last (whispers should be ├─ if it's not last)
			if (allFiles.length >= 2) {
				const beforeLast = allFiles[allFiles.length - 2];
				if (beforeLast) beforeLast.glyph = "├─";
			}
		}
		rowEl.appendChild(buildTreeLines(doc, allFiles));

		// Ops buttons
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
			location.hash = "#/game";
		});
		opsEl.appendChild(loadBtn);

		const dupBtn = doc.createElement("button");
		dupBtn.type = "button";
		dupBtn.textContent = "[ dup ]";
		dupBtn.addEventListener("click", () => {
			try {
				dupSession(id);
				reRender();
			} catch {
				// programmer-error guard; should not reach in normal use
			}
		});
		opsEl.appendChild(dupBtn);

		buildRmControls(doc, id, opsEl, reRender);
	} else if (info.kind === "broken") {
		// Tag
		const tagEl = doc.createElement("span");
		tagEl.className = "tag-corrupt";
		tagEl.textContent = "[ corrupt ]";
		rowEl.appendChild(tagEl);

		// Placeholder tree
		const placeholderFiles = [
			{ glyph: "├─", label: "<corrupted>" },
			{ glyph: "├─", label: "<corrupted>" },
			{ glyph: "└─", label: "<corrupted>" },
		];
		rowEl.appendChild(buildTreeLines(doc, placeholderFiles));

		// Ops: rm only
		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);
		buildRmControls(doc, id, opsEl, reRender);
	} else {
		// version-mismatch
		const tagEl = doc.createElement("span");
		tagEl.className = "tag-version-mismatch";
		tagEl.textContent = "[ version mismatch ]";
		rowEl.appendChild(tagEl);

		// Tree lines from whatever files exist
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

		// Ops: rm only
		const opsEl = doc.createElement("div");
		opsEl.className = "ops";
		rowEl.appendChild(opsEl);
		buildRmControls(doc, id, opsEl, reRender);
	}

	return rowEl;
}

// ── Rm confirmation controls ──────────────────────────────────────────────────

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
		// Swap to confirmation mode
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
			// Swap back to rm mode
			confirmBtn.remove();
			cancelBtn.remove();
			opsEl.appendChild(rmBtn);
		});

		opsEl.appendChild(confirmBtn);
		opsEl.appendChild(cancelBtn);
	});
	opsEl.appendChild(rmBtn);
}
