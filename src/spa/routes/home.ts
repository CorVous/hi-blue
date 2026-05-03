import { streamCompletion } from "../streaming.js";

export function renderHome(root: HTMLElement): void {
	const form = root.ownerDocument.querySelector<HTMLFormElement>("#composer");
	const promptInput =
		root.ownerDocument.querySelector<HTMLInputElement>("#prompt");
	const sendBtn = root.ownerDocument.querySelector<HTMLButtonElement>("#send");
	const outputEl = root.ownerDocument.querySelector<HTMLPreElement>("#output");

	if (!form || !promptInput || !sendBtn || !outputEl) return;

	form.addEventListener("submit", (evt) => {
		evt.preventDefault();
		const message = promptInput.value.trim();
		if (!message) return;

		promptInput.value = "";
		outputEl.textContent = "";
		sendBtn.disabled = true;

		streamCompletion({
			baseUrl: __WORKER_BASE_URL__,
			message,
			onDelta: (text) => {
				outputEl.textContent += text;
			},
		}).finally(() => {
			sendBtn.disabled = false;
		});
	});
}
