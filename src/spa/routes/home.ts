import { CapHitError, streamChat } from "../llm-client.js";

export function renderHome(root: HTMLElement): void {
	const form = root.ownerDocument.querySelector<HTMLFormElement>("#composer");
	const promptInput =
		root.ownerDocument.querySelector<HTMLInputElement>("#prompt");
	const sendBtn = root.ownerDocument.querySelector<HTMLButtonElement>("#send");
	const outputEl = root.ownerDocument.querySelector<HTMLPreElement>("#output");
	const capHitEl =
		root.ownerDocument.querySelector<HTMLElement>("#cap-hit") ?? null;

	if (!form || !promptInput || !sendBtn || !outputEl) return;

	form.addEventListener("submit", (evt) => {
		evt.preventDefault();
		const message = promptInput.value.trim();
		if (!message) return;

		// Hide cap-hit overlay before each attempt (recovery path)
		if (capHitEl) capHitEl.hidden = true;

		promptInput.value = "";
		outputEl.textContent = "thinking…";
		sendBtn.disabled = true;
		let placeholderShown = true;

		streamChat({
			message,
			onDelta: (text) => {
				if (placeholderShown) {
					outputEl.textContent = "";
					placeholderShown = false;
				}
				outputEl.textContent += text;
			},
			onReasoning: () => {
				// Keep the placeholder visible while only reasoning deltas arrive
			},
		})
			.catch((err: unknown) => {
				// Clear the placeholder on error so it doesn't linger
				if (placeholderShown) {
					outputEl.textContent = "";
					placeholderShown = false;
				}
				if (
					err instanceof CapHitError ||
					(err as { status?: number }).status === 429
				) {
					if (capHitEl) capHitEl.hidden = false;
				}
			})
			.finally(() => {
				// If no content deltas arrived at all, strip the placeholder
				if (placeholderShown) {
					outputEl.textContent = "";
					placeholderShown = false;
				}
				sendBtn.disabled = false;
			});
	});
}
