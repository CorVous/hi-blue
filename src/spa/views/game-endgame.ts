import { serializeGameSave } from "../../save-serializer.js";
import { buildSameDaemonsSession } from "../game/bootstrap.js";
import { appendBroadcast } from "../game/engine.js";
import type { GameSession } from "../game/game-session.js";
import type { AiId, GameState } from "../game/types";
import { readStoredByokKey } from "../openrouter-key.js";
import {
	archiveSession,
	getActiveSessionId,
	isSessionComplete,
	mintSessionId,
	rmSession,
	saveActiveSession,
	setActiveSessionId,
} from "../persistence/session-storage.js";
import { renderApp } from "../render-app.js";
import { dropListenersByCloning, setHidden } from "./dom.js";
import {
	type MessageEntry,
	PLAYER_ID,
	transcriptMessageLine,
} from "./transcript-lines.js";

const OBJECTIVES_COMPLETE_SUBTITLE = "You have completed the objectives.";
const BUDGET_EXHAUSTED_SUBTITLE = "You have hit your budget.";
const NEW_ROOM_BROADCAST = "The sysadmin has created a new room.";
const INCOMPLETE_SAVE_NOTE =
	"this game's last save was incomplete, so it was not archived";

export function showEndgame(
	root: HTMLElement,
	endedState: GameState,
	endedSessionId: string | null,
	releaseEndedGame: () => void,
): void {
	const doc = root.ownerDocument;
	paintEndgameSubtitle(doc, endedState.outcome);
	paintFinalRoundLines(doc, endedState);
	showEndgameScreen(doc);
	resetEndgameControls(doc);
	wireEndgameChoices({ root, endedSessionId, endedState, releaseEndedGame });
	wireSaveDownload(doc, endedState);
	wireDiagnosticsSubmit(doc);
}

const ENDGAME_BUTTON_SELECTORS = [
	"#endgame-new-daemons-btn",
	"#endgame-same-daemons-btn",
	"#endgame-continue-btn",
	"#download-ais-btn",
	"#submit-diagnostics-btn",
];

const ENDGAME_STATUS_SELECTORS = [
	"#endgame-choice-status",
	"#download-status",
	"#diagnostics-status",
];

function resetEndgameControls(doc: Document): void {
	for (const selector of ENDGAME_BUTTON_SELECTORS) {
		const button = doc.querySelector<HTMLButtonElement>(selector);
		if (button) dropListenersByCloning(button).disabled = false;
	}
	for (const selector of ENDGAME_STATUS_SELECTORS) {
		const statusEl = doc.querySelector<HTMLElement>(selector);
		if (statusEl) statusEl.textContent = "";
	}
}

export function endgameSubtitle(outcome: GameState["outcome"]): string {
	return outcome === "lose"
		? BUDGET_EXHAUSTED_SUBTITLE
		: OBJECTIVES_COMPLETE_SUBTITLE;
}

function paintEndgameSubtitle(
	doc: Document,
	outcome: GameState["outcome"],
): void {
	const subtitleEl = doc.querySelector<HTMLElement>("#endgame-subtitle");
	if (!subtitleEl) return;
	subtitleEl.textContent = endgameSubtitle(outcome);
	subtitleEl.dataset.outcome = outcome === "lose" ? "budget-exhausted" : "win";
}

export function finalRoundDaemonLines(
	state: GameState,
): Array<{ aiId: AiId; entry: MessageEntry }> {
	const finalRound = state.round - 1;
	const lines: Array<{ aiId: AiId; entry: MessageEntry }> = [];
	for (const aiId of Object.keys(state.personas)) {
		for (const entry of state.conversationLogs[aiId] ?? []) {
			const isDaemonLineToPlayer =
				entry.kind === "message" &&
				entry.from === aiId &&
				entry.to === PLAYER_ID;
			if (isDaemonLineToPlayer && entry.round === finalRound) {
				lines.push({ aiId, entry });
			}
		}
	}
	return lines;
}

function paintFinalRoundLines(doc: Document, state: GameState): void {
	const sectionEl = doc.querySelector<HTMLElement>("#endgame-final-round");
	const linesEl = doc.querySelector<HTMLElement>("#endgame-final-lines");
	if (!sectionEl || !linesEl) return;
	linesEl.textContent = "";
	const lines = finalRoundDaemonLines(state);
	for (const { aiId, entry } of lines) {
		linesEl.appendChild(
			transcriptMessageLine(doc, entry, aiId, state.personas),
		);
	}
	sectionEl.hidden = lines.length === 0;
}

function showEndgameScreen(doc: Document): void {
	setHidden(doc, ["#panels", "#composer", "#cap-hit"], true);
	setHidden(doc, ["#endgame"], false);
}

interface EndedGame {
	root: HTMLElement;
	endedSessionId: string | null;
	endedState: GameState;
	releaseEndedGame(): void;
}

interface EndgameChoice extends EndedGame {
	setStatus(text: string): void;
	enableChoices(): void;
}

function wireEndgameChoices(endedGame: EndedGame): void {
	const doc = endedGame.root.ownerDocument;
	const newDaemonsBtn = doc.querySelector<HTMLButtonElement>(
		"#endgame-new-daemons-btn",
	);
	const sameDaemonsBtn = doc.querySelector<HTMLButtonElement>(
		"#endgame-same-daemons-btn",
	);
	const continueBtn = doc.querySelector<HTMLButtonElement>(
		"#endgame-continue-btn",
	);
	const choiceStatus = doc.querySelector<HTMLElement>("#endgame-choice-status");

	const hasOpenRouterKey = readStoredByokKey() !== null;
	if (continueBtn && hasOpenRouterKey) {
		continueBtn.removeAttribute("hidden");
	}

	const setChoicesDisabled = (disabled: boolean): void => {
		for (const btn of [newDaemonsBtn, sameDaemonsBtn, continueBtn]) {
			if (btn) btn.disabled = disabled;
		}
	};
	const choice: EndgameChoice = {
		...endedGame,
		setStatus: (text) => {
			if (choiceStatus) choiceStatus.textContent = text;
		},
		enableChoices: () => setChoicesDisabled(false),
	};

	newDaemonsBtn?.addEventListener("click", () => {
		setChoicesDisabled(true);
		void startWithNewDaemons(choice);
	});
	sameDaemonsBtn?.addEventListener("click", () => {
		setChoicesDisabled(true);
		void restartWithSameDaemons(choice);
	});
	continueBtn?.addEventListener("click", () => {
		setChoicesDisabled(true);
		void continueInNewRoom(choice);
	});
}

function playerLeftEndedSession(choice: EndgameChoice): boolean {
	return getActiveSessionId() !== choice.endedSessionId;
}

function failEndgameChoice(choice: EndgameChoice, message: string): void {
	choice.setStatus(message);
	choice.enableChoices();
}

function failureDetail(err: unknown): string {
	if (err instanceof DOMException && err.name === "QuotaExceededError") {
		return "browser storage is full";
	}
	return err instanceof Error ? err.message : String(err);
}

function saveFailureDetail(reason: string): string {
	return reason === "quota" ? "browser storage is full" : reason;
}

function removeEndedSession(choice: EndgameChoice): void {
	if (choice.endedSessionId) rmSession(choice.endedSessionId);
}

interface ArchivePlan {
	archive: boolean;
	note: string;
}

function withNote(plan: ArchivePlan, status: string): string {
	return plan.note ? `${plan.note}. ${status}` : status;
}

function failArchive(choice: EndgameChoice, err: unknown): void {
	failEndgameChoice(
		choice,
		`could not archive this game: ${failureDetail(err)}`,
	);
}

function planArchive(choice: EndgameChoice): ArchivePlan | null {
	const sessionId = choice.endedSessionId;
	if (!sessionId) return { archive: false, note: "" };
	try {
		return isSessionComplete(sessionId)
			? { archive: true, note: "" }
			: { archive: false, note: INCOMPLETE_SAVE_NOTE };
	} catch (err) {
		failArchive(choice, err);
		return null;
	}
}

async function archiveAsPlanned(
	choice: EndgameChoice,
	plan: ArchivePlan,
): Promise<boolean> {
	if (!plan.archive || !choice.endedSessionId) return true;
	choice.setStatus("archiving…");
	try {
		await archiveSession(choice.endedSessionId);
		return true;
	} catch (err) {
		failArchive(choice, err);
		return false;
	}
}

async function startWithNewDaemons(choice: EndgameChoice): Promise<void> {
	const plan = planArchive(choice);
	if (!plan) return;
	if (!(await archiveAsPlanned(choice, plan))) return;
	if (plan.note) choice.setStatus(plan.note);
	const playerMovedOn = playerLeftEndedSession(choice);
	removeEndedSession(choice);
	if (playerMovedOn) return;
	choice.releaseEndedGame();
	renderApp(choice.root);
}

async function buildNewRoom(
	choice: EndgameChoice,
	plan: ArchivePlan = { archive: false, note: "" },
): Promise<GameSession | null> {
	choice.setStatus(withNote(plan, "spinning up a new room…"));
	try {
		return await buildSameDaemonsSession(choice.endedState.personas);
	} catch (err) {
		failEndgameChoice(
			choice,
			`could not spin up a new room: ${failureDetail(err)}`,
		);
		return null;
	}
}

async function restartWithSameDaemons(choice: EndgameChoice): Promise<void> {
	const plan = planArchive(choice);
	if (!plan) return;
	const newRoom = await buildNewRoom(choice, plan);
	if (!newRoom || playerLeftEndedSession(choice)) return;

	if (!(await archiveAsPlanned(choice, plan))) return;
	if (playerLeftEndedSession(choice)) return;

	const newSessionId = mintSessionId();
	const saveResult = saveActiveSession(newRoom.getState(), {
		sessionId: newSessionId,
	});
	if (!saveResult.ok) {
		rmSession(newSessionId);
		failEndgameChoice(
			choice,
			`could not save the new room: ${saveFailureDetail(saveResult.reason)}`,
		);
		return;
	}
	removeEndedSession(choice);
	setActiveSessionId(newSessionId);
	choice.releaseEndedGame();
	renderApp(choice.root);
}

async function continueInNewRoom(choice: EndgameChoice): Promise<void> {
	const newRoom = await buildNewRoom(choice);
	if (!newRoom || playerLeftEndedSession(choice)) return;

	const saveResult = saveActiveSession(
		appendBroadcast(newRoom.getState(), NEW_ROOM_BROADCAST),
		{ sessionId: choice.endedSessionId },
	);
	if (!saveResult.ok) {
		failEndgameChoice(
			choice,
			`could not save the new room: ${saveFailureDetail(saveResult.reason)}`,
		);
		return;
	}
	choice.releaseEndedGame();
	renderApp(choice.root);
}

function wireSaveDownload(doc: Document, endedState: GameState): void {
	const downloadBtn = doc.querySelector<HTMLButtonElement>("#download-ais-btn");
	const downloadStatusEl = doc.querySelector<HTMLElement>("#download-status");
	if (!downloadBtn) return;
	downloadBtn.dataset.savePayload = JSON.stringify(
		serializeGameSave(endedState),
	);
	downloadBtn.addEventListener("click", () => {
		downloadSavePayload(doc, downloadBtn.dataset.savePayload ?? "{}");
		downloadBtn.disabled = true;
		if (downloadStatusEl) downloadStatusEl.textContent = "Saved.";
	});
}

function downloadSavePayload(doc: Document, payload: string): void {
	const blob = new Blob([payload], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = doc.createElement("a");
	a.href = url;
	a.download = "hi-blue-save.json";
	doc.body.appendChild(a);
	a.click();
	doc.body.removeChild(a);
	URL.revokeObjectURL(url);
}

function wireDiagnosticsSubmit(doc: Document): void {
	const submitBtn = doc.querySelector<HTMLButtonElement>(
		"#submit-diagnostics-btn",
	);
	const summaryInput = doc.querySelector<HTMLInputElement>(
		"#diagnostics-summary",
	);
	const statusEl = doc.querySelector<HTMLElement>("#diagnostics-status");
	if (!submitBtn || !summaryInput || !statusEl) return;
	submitBtn.addEventListener("click", () => {
		const summary = summaryInput.value.trim();
		if (!summary) {
			statusEl.textContent = "Please enter a one-word summary first.";
			return;
		}
		const downloaded =
			doc.querySelector<HTMLButtonElement>("#download-ais-btn")?.disabled ??
			false;
		const markSubmitted = (): void => {
			statusEl.textContent = "Diagnostics submitted.";
		};
		fetch(`${__WORKER_BASE_URL__}/diagnostics`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded, summary }),
			mode: "no-cors",
		})
			.then(markSubmitted)
			.catch(markSubmitted);
	});
}
