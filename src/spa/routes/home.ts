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
		outputEl.textContent = "";
		sendBtn.disabled = true;

		streamChat({
			message,
			onDelta: (text) => {
				outputEl.textContent += text;
			},
		})
			.catch((err: unknown) => {
				if (
					err instanceof CapHitError ||
					(err as { status?: number }).status === 429
				) {
					if (capHitEl) capHitEl.hidden = false;
				}
			})
			.finally(() => {
				sendBtn.disabled = false;
			});
	});
}
