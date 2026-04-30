import { handleChat, handleDiagnostics } from "./handler";
import { MockLLMProvider } from "./mock-provider";
import { createRateLimiter } from "./rate-limiter";

interface Env {
	RATE_LIMIT_KV: KVNamespace;
}

const provider = new MockLLMProvider();

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/chat") {
			const rateLimiter = createRateLimiter({
				kv: env.RATE_LIMIT_KV,
				// In production, set this to the daily spend cap.
				// Use a large number for the smoke/dev worker so all calls succeed.
				dailyCapLimit: 10_000,
			});
			return handleChat(request, { provider, rateLimiter });
		}
		if (url.pathname === "/diagnostics") {
			return handleDiagnostics(request);
		}
		return new Response("ok");
	},
} satisfies ExportedHandler<Env>;
