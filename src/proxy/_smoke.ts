import { handleChat } from "./handler";
import { MockLLMProvider } from "./mock-provider";

const provider = new MockLLMProvider();

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/chat") {
			return handleChat(request, provider);
		}
		return new Response("ok");
	},
} satisfies ExportedHandler;
