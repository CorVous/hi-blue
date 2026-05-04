import { PERSONAS } from "../../content";
import {
	createSingleAiSession,
	runSingleAiRound,
	type SingleAiSession,
} from "../game/game-loop.js";

let session: SingleAiSession | null = null;

export function renderGame(root: HTMLElement): void {
	const form = root.ownerDocument.querySelector<HTMLFormElement>("#composer");
	const promptInput =
		root.ownerDocument.querySelector<HTMLInputElement>("#prompt");
	const sendBtn = root.ownerDocument.querySelector<HTMLButtonElement>("#send");
	const outputEl = root.ownerDocument.querySelector<HTMLPreElement>("#output");
	if (!form || !promptInput || !sendBtn || !outputEl) return;

	if (!session) session = createSingleAiSession(PERSONAS.blue);

	form.addEventListener("submit", (evt) => {
		evt.preventDefault();
		const message = promptInput.value.trim();
		if (!message || !session) return;
		promptInput.value = "";
		sendBtn.disabled = true;

		// Append the user's turn + a fresh AI label (don't clear — accumulate transcript)
		outputEl.textContent += `\n[you] ${message}\n[${session.persona.name}] `;

		// Show "thinking…" placeholder while waiting for first content delta
		const placeholderStart = outputEl.textContent.length;
		outputEl.textContent += "thinking…";
		let placeholderShown = true;

		runSingleAiRound({
			session,
			message,
			onDelta: (text) => {
				if (placeholderShown) {
					outputEl.textContent = outputEl.textContent.slice(
						0,
						placeholderStart,
					);
					placeholderShown = false;
				}
				outputEl.textContent += text;
			},
			onReasoning: () => {
				// Keep the placeholder visible while only reasoning deltas arrive
			},
		}).finally(() => {
			// If no content deltas arrived at all, strip the placeholder
			if (placeholderShown) {
				outputEl.textContent = outputEl.textContent.slice(0, placeholderStart);
				placeholderShown = false;
			}
			sendBtn.disabled = false;
		});
	});
}
