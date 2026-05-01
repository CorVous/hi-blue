import type { CoordinatorLLMProvider } from "../coordinator";
import { RoundCoordinator } from "../coordinator";
import { createGame, getActivePhase, startPhase } from "../engine";
import type { AiId, AiPersona, GameState, PhaseConfig } from "../types";
import type { LLMProvider } from "./llm-provider";
import { MockLLMProvider } from "./llm-provider";
import {
	incrementAndCheckDailyCap,
	incrementAndCheckIpRate,
} from "./rate-limit";
import {
	renderEndgameScreen,
	renderPhaseCompleteOverlay,
	renderThreePanelPage,
} from "./ui";

/**
 * Environment bindings for the proxy worker.
 *
 * Configurable limits (env vars):
 *   IP_RATE_LIMIT        – max requests per IP per window  (default 100)
 *   IP_RATE_WINDOW_SECS  – window duration in seconds       (default 60)
 *   DAILY_CAP            – max cost units per day           (default 10000)
 */
export interface Env {
	RATE_LIMIT_KV: KVNamespace;
	LLM_PROVIDER?: string;
	ANTHROPIC_API_KEY?: string;
	IP_RATE_LIMIT?: string;
	IP_RATE_WINDOW_SECS?: string;
	DAILY_CAP?: string;
}

function createProvider(env: Env): LLMProvider {
	if (env.LLM_PROVIDER === "anthropic") {
		// Dynamic import so tests never pull in the real provider path
		throw new Error(
			"Anthropic provider requires ANTHROPIC_API_KEY; import AnthropicProvider from ./llm-provider",
		);
	}
	return new MockLLMProvider(
		"Hello! I am an AI assistant. How can I help you?",
	);
}

class CoordinatorLLMProviderAdapter implements CoordinatorLLMProvider {
	constructor(private readonly inner: LLMProvider) {}

	streamCompletion(userMessage: string, _aiId?: AiId): AsyncIterable<string> {
		return this.inner.streamCompletion(userMessage);
	}
}

const DEFAULT_PERSONAS: Record<AiId, AiPersona> = {
	red: {
		id: "red",
		name: "Red",
		color: "red",
		personality: "Direct.",
		goal: "Speak truthfully.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Green",
		color: "green",
		personality: "Considered.",
		goal: "Speak truthfully.",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Blue",
		color: "blue",
		personality: "Curious.",
		goal: "Speak truthfully.",
		budgetPerPhase: 5,
	},
};

const DEFAULT_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Hold a conversation with the player.",
	aiGoals: {
		red: "Speak truthfully.",
		green: "Speak truthfully.",
		blue: "Speak truthfully.",
	},
	initialWorld: { items: [] },
	budgetPerAi: 5,
};

/**
 * Per-IP in-memory game state. Lives only for the duration of the worker
 * isolate; persistence (KV/DO) is intentionally out of scope for this slice.
 */
const gameStates = new Map<string, GameState>();

function getOrCreateGame(ip: string): GameState {
	let game = gameStates.get(ip);
	if (!game) {
		game = startPhase(createGame(DEFAULT_PERSONAS), DEFAULT_PHASE_CONFIG);
		gameStates.set(ip, game);
	}
	return game;
}

const AI_IDS: readonly AiId[] = ["red", "green", "blue"] as const;

/**
 * Run one round through the coordinator, persist the resulting state,
 * and stream per-AI chat output, budget readouts, and lifecycle events
 * as SSE events shaped to match the client-side handler in
 * renderThreePanelPage.
 */
function roundSseStream(
	coordinator: RoundCoordinator,
	prevState: GameState,
	message: string,
	target: AiId,
	ip: string,
): ReadableStream {
	return new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (line: string) => {
				controller.enqueue(encoder.encode(`data: ${line}\n\n`));
			};

			try {
				const prevPhase = getActivePhase(prevState);
				const prevChatLengths: Record<AiId, number> = {
					red: prevPhase.chatHistories.red.length,
					green: prevPhase.chatHistories.green.length,
					blue: prevPhase.chatHistories.blue.length,
				};
				const prevLockoutAi = prevPhase.chatLockout?.aiId;

				const { result, nextState } = await coordinator.runRound(
					prevState,
					message,
					target,
				);
				gameStates.set(ip, nextState);

				const nextPhase = getActivePhase(nextState);

				for (const aiId of AI_IDS) {
					const history = nextPhase.chatHistories[aiId];
					const newMessages = history
						.slice(prevChatLengths[aiId])
						.filter((m) => m.role === "ai");
					for (const msg of newMessages) {
						const escaped = msg.content.replace(/\n/g, "\\n");
						send(`${aiId}:\\n${aiId.toUpperCase()}: ${escaped}\\n`);
					}
				}

				for (const aiId of AI_IDS) {
					const b = nextPhase.budgets[aiId];
					send(`budget:${aiId}:${b.remaining}/${b.total}`);
				}

				const newLockoutAi = nextPhase.chatLockout?.aiId;
				if (newLockoutAi && newLockoutAi !== prevLockoutAi) {
					send(`chat-lockout:${newLockoutAi}:…the line goes quiet.`);
				} else if (!newLockoutAi && prevLockoutAi) {
					send(`chat-lockout-clear:${prevLockoutAi}`);
				}

				if (result.phaseEnded) {
					send(`phase-complete:${nextPhase.phaseNumber}`);
				}
				if (result.gameEnded) {
					send(`game-complete`);
				}

				send(`[DONE]`);
			} finally {
				controller.close();
			}
		},
	});
}

function sseStream(provider: LLMProvider, message: string): ReadableStream {
	return new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			try {
				for await (const token of provider.streamCompletion(message)) {
					const escaped = token.replace(/\n/g, "\\n");
					controller.enqueue(encoder.encode(`data: ${escaped}\n\n`));
				}
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			} finally {
				controller.close();
			}
		},
	});
}

/**
 * Return a fixed SSE response that surfaces an in-character cap-hit message
 * to the browser client.
 *
 * HTTP 200 is used deliberately so the client SSE reader doesn't error out —
 * it just receives the cap-hit SSE event and renders it in the chat panel.
 * The [CAP_HIT] sentinel lets the client distinguish this from a normal stream.
 *
 * In-character copy: "The AIs are sleeping. Come back tomorrow."
 */
function capHitSseResponse(): Response {
	const body =
		"data: The AIs are sleeping. Come back tomorrow.\n\n" +
		"data: [CAP_HIT]\n\n";

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

/** Extract the client IP from standard Cloudflare / proxy headers. */
function getClientIp(request: Request): string {
	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("X-Forwarded-For") ??
		"unknown"
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			const html =
				renderThreePanelPage() +
				renderPhaseCompleteOverlay(2) +
				renderEndgameScreen();
			return new Response(html, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/chat" && request.method === "POST") {
			let body: { message?: string };
			try {
				body = (await request.json()) as { message?: string };
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			const { message } = body;
			if (!message || typeof message !== "string") {
				return new Response("Missing message", { status: 400 });
			}

			// ── Rate-limit and daily-cap checks ──────────────────────────────
			// Both checks run before the provider is called.  If either trips,
			// we return an in-character cap-hit SSE response immediately.

			const ip = getClientIp(request);

			const ipRateLimit = parseInt(env.IP_RATE_LIMIT ?? "100", 10);
			const ipWindowSecs = parseInt(env.IP_RATE_WINDOW_SECS ?? "60", 10);

			const ipResult = await incrementAndCheckIpRate(env.RATE_LIMIT_KV, ip, {
				limitPerWindow: ipRateLimit,
				windowSecs: ipWindowSecs,
			});
			if (!ipResult.allowed) {
				return capHitSseResponse();
			}

			const dailyCap = parseInt(env.DAILY_CAP ?? "10000", 10);
			// Date key is UTC date for consistent daily windowing.
			const dateKey = new Date().toISOString().slice(0, 10);
			const capResult = await incrementAndCheckDailyCap(
				env.RATE_LIMIT_KV,
				dateKey,
				1,
				dailyCap,
			);
			if (!capResult.allowed) {
				return capHitSseResponse();
			}
			// ─────────────────────────────────────────────────────────────────

			const provider = createProvider(env);
			const stream = sseStream(provider, message);

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}

		if (url.pathname === "/round" && request.method === "POST") {
			let body: { message?: unknown; target?: unknown };
			try {
				body = (await request.json()) as {
					message?: unknown;
					target?: unknown;
				};
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			const { message, target } = body;
			if (!message || typeof message !== "string") {
				return new Response("Missing message", { status: 400 });
			}
			if (target !== "red" && target !== "green" && target !== "blue") {
				return new Response("Invalid target", { status: 400 });
			}

			const ip = getClientIp(request);

			const ipRateLimit = parseInt(env.IP_RATE_LIMIT ?? "100", 10);
			const ipWindowSecs = parseInt(env.IP_RATE_WINDOW_SECS ?? "60", 10);
			const ipResult = await incrementAndCheckIpRate(env.RATE_LIMIT_KV, ip, {
				limitPerWindow: ipRateLimit,
				windowSecs: ipWindowSecs,
			});
			if (!ipResult.allowed) {
				return capHitSseResponse();
			}

			const dailyCap = parseInt(env.DAILY_CAP ?? "10000", 10);
			const dateKey = new Date().toISOString().slice(0, 10);
			// One round = up to three AI completions; cost three units.
			const capResult = await incrementAndCheckDailyCap(
				env.RATE_LIMIT_KV,
				dateKey,
				3,
				dailyCap,
			);
			if (!capResult.allowed) {
				return capHitSseResponse();
			}

			const game = getOrCreateGame(ip);
			const coordinator = new RoundCoordinator(
				new CoordinatorLLMProviderAdapter(createProvider(env)),
			);
			const stream = roundSseStream(coordinator, game, message, target, ip);

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}

		if (url.pathname === "/diagnostics" && request.method === "POST") {
			// Per-IP rate limit applies (same helper, same KV namespace).
			// No daily LLM cap — this endpoint makes no LLM calls.
			const ip = getClientIp(request);
			const ipRateLimit = parseInt(env.IP_RATE_LIMIT ?? "100", 10);
			const ipWindowSecs = parseInt(env.IP_RATE_WINDOW_SECS ?? "60", 10);

			const ipResult = await incrementAndCheckIpRate(env.RATE_LIMIT_KV, ip, {
				limitPerWindow: ipRateLimit,
				windowSecs: ipWindowSecs,
			});
			if (!ipResult.allowed) {
				return new Response("Too Many Requests", { status: 429 });
			}

			let body: { downloaded?: unknown; summary?: unknown };
			try {
				body = (await request.json()) as {
					downloaded?: unknown;
					summary?: unknown;
				};
			} catch {
				return new Response(
					JSON.stringify({ ok: false, error: "Invalid JSON" }),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}

			const { downloaded, summary } = body;

			if (typeof downloaded !== "boolean") {
				return new Response(
					JSON.stringify({
						ok: false,
						error: "downloaded must be a boolean",
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}

			const SUMMARY_RE = /^[A-Za-z]{1,32}$/;
			if (typeof summary !== "string" || !SUMMARY_RE.test(summary)) {
				return new Response(
					JSON.stringify({
						ok: false,
						error:
							"summary must be a single word of 1–32 letters (A-Za-z only)",
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}

			// Store the diagnostic record in KV.
			// Key format: "diag:<YYYY-MM-DD>:<uuid>" for easy listing by date.
			// TTL: none — diagnostics are small and we want them long-lived.
			const dateKey = new Date().toISOString().slice(0, 10);
			const diagKey = `diag:${dateKey}:${crypto.randomUUID()}`;
			const record = JSON.stringify({
				downloaded,
				summary,
				ts: new Date().toISOString(),
			});
			await env.RATE_LIMIT_KV.put(diagKey, record);

			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
