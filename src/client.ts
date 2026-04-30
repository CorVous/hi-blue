/**
 * Vanilla-JS streaming chat client.
 * mountChatPanel attaches a message form and streamed output area to the given container.
 * Submitting the form POSTs to /chat and streams SSE tokens token-by-token into the output area.
 */
export function mountChatPanel(container: HTMLElement): void {
	container.innerHTML = `
		<form id="chat-form">
			<input type="text" name="message" autocomplete="off" placeholder="Type a message…" />
			<button type="submit">Send</button>
		</form>
		<div data-output></div>
	`;

	const form = container.querySelector("form") as HTMLFormElement;
	const input = container.querySelector("input[type=text]") as HTMLInputElement;
	const output = container.querySelector("[data-output]") as HTMLElement;

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const message = input.value.trim();
		if (!message) return;
		input.value = "";
		output.textContent = "";
		streamResponse(message, output);
	});
}

async function streamResponse(
	message: string,
	output: HTMLElement,
): Promise<void> {
	const response = await fetch("/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message }),
	});

	if (!response.body) return;

	// HTTP 429 means a rate or daily-cap limit was hit.
	// The body is still a valid SSE stream with a `cap-hit` event containing
	// the in-character "AIs are sleeping" message — render it as-is.
	const isCapHit = response.status === 429;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let currentEvent = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		// Process complete SSE events (lines ending with \n\n)
		const parts = buffer.split("\n\n");
		// The last element may be incomplete; keep it in the buffer
		buffer = parts.pop() ?? "";

		for (const part of parts) {
			currentEvent = "";
			for (const line of part.split("\n")) {
				if (line.startsWith("event: ")) {
					currentEvent = line.slice("event: ".length).trim();
				} else if (line.startsWith("data: ")) {
					const token = line.slice("data: ".length);
					if (token === "[DONE]") return;

					if (currentEvent === "cap-hit" || isCapHit) {
						// Render the in-character sleeping message with a distinct style
						output.textContent = token;
						output.setAttribute("data-cap-hit", "true");
						return;
					}

					output.textContent = (output.textContent ?? "") + token;
				}
			}
		}
	}
}
