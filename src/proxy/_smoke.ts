import { getActivePhase } from "../engine";
import { encodeRoundResult, serialiseSseEvents } from "../round-result-encoder";
import {
	buildSessionCookie,
	createSession,
	getSession,
	parseSessionCookie,
} from "../session-store";
import type { AiId, PhaseConfig } from "../types";
import type { LLMProvider } from "./llm-provider";
import { MockLLMProvider } from "./llm-provider";
import { capHitStream, checkAndCharge, configFromEnv } from "./rate-guard";
import { renderChatPage, renderEndgamePage } from "./ui";

/** Shape of the bindings/env this Worker expects. */
interface Env {
	/** KV namespace backing the rate-limit and daily-cap guards. */
	RATE_GUARD_KV: KVNamespace;
	/** Optional: set to "anthropic" to use the real provider. */
	LLM_PROVIDER?: string;
	ANTHROPIC_API_KEY?: string;
	/** Rate-guard configuration knobs (all optional; defaults in configFromEnv). */
	RATE_LIMIT_MAX?: string;
	RATE_LIMIT_WINDOW_SEC?: string;
	ESTIMATED_COST_PER_REQUEST?: string;
	DAILY_CAP_MAX?: string;
	/**
	 * Set to "1" in test environments to enable the testMode parameter on
	 * POST /game/new. Must NOT be set in production wrangler.jsonc.
	 */
	ENABLE_TEST_MODES?: string;
}

function createProvider(env: Env): LLMProvider {
	if (env.LLM_PROVIDER === "anthropic") {
		// Not yet wired — needs dynamic import + ANTHROPIC_API_KEY before use.
		throw new Error(
			"Anthropic provider not yet wired; set LLM_PROVIDER=mock or wire AnthropicProvider dynamically",
		);
	}
	return new MockLLMProvider(
		"Hello! I am an AI assistant. How can I help you?",
	);
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
				controller.close();
			} catch (err) {
				controller.error(err);
			}
		},
	});
}

/**
 * Default phase config used when creating a new game session.
 * Three AIs, each with budget 5, no win condition (play continues indefinitely).
 */
const DEFAULT_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Navigate the room, gather clues, and uncover the truth.",
	aiGoals: {
		red: "Hold the flower at phase end.",
		green: "Ensure items are evenly distributed.",
		blue: "Hold the key at phase end.",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: "room" },
			{ id: "key", name: "key", holder: "room" },
		],
	},
	budgetPerAi: 5,
};

/**
 * Three-phase config used only in dev/test to exercise phase advancement and
 * game completion. Each phase has an always-true win condition so a single
 * /game/turn call advances to the next phase.
 *
 * Phase 3 has no nextPhaseConfig, so the game completes (gameEnded=true) when
 * its win condition fires.
 */
const PHASE3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	objective: "The final reckoning approaches.",
	aiGoals: { red: "Endure", green: "Endure", blue: "Endure" },
	initialWorld: { items: [] },
	budgetPerAi: 5,
	winCondition: () => true, // always fires on first turn
};

const PHASE2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "Deeper truths emerge.",
	aiGoals: { red: "Seek", green: "Seek", blue: "Seek" },
	initialWorld: { items: [] },
	budgetPerAi: 5,
	winCondition: () => true, // always fires on first turn
	nextPhaseConfig: PHASE3_CONFIG,
};

const TEST_PHASE_CONFIG_WITH_WIN: PhaseConfig = {
	phaseNumber: 1,
	objective: "A test phase that completes immediately.",
	aiGoals: { red: "Pass", green: "Pass", blue: "Pass" },
	initialWorld: { items: [] },
	budgetPerAi: 5,
	winCondition: () => true, // always fires on first turn
	nextPhaseConfig: PHASE2_CONFIG,
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return new Response(renderChatPage(), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		// ── Dev affordance: standalone endgame screen (issue #30) ─────────────
		// Stub persona data is hard-coded here; no KV, no fixtures file.
		// This route is intentionally a developer-only convenience, not
		// player-facing — the PRD gates it off in production via env flag
		// (gating not yet implemented; will be added in a follow-up slice).
		if (url.pathname === "/endgame" && request.method === "GET") {
			return new Response(renderEndgamePage(), {
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

			// ── Rate-limit / daily-cap guard ──────────────────────────────
			// Short-circuit BEFORE constructing or calling the LLM provider.
			const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
			const guard = await checkAndCharge(
				env.RATE_GUARD_KV,
				clientIp,
				Date.now(),
				configFromEnv(env),
			);
			if (!guard.allowed) {
				return new Response(capHitStream(guard.reason), {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"X-Content-Type-Options": "nosniff",
						"X-Cap-Hit": guard.reason,
					},
				});
			}
			// ── End guard ─────────────────────────────────────────────────

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

		// ── POST /game/new ────────────────────────────────────────────────────
		// Creates a new game session and sets the session cookie.
		// When ENABLE_TEST_MODES="1" (test environments only), accepts an optional
		// body { testMode: "win_immediately" } to create a session whose phase-1
		// win condition fires on the first turn.
		if (url.pathname === "/game/new" && request.method === "POST") {
			let phaseConfig: PhaseConfig = DEFAULT_PHASE_CONFIG;
			if (env.ENABLE_TEST_MODES === "1") {
				try {
					const body = (await request.json()) as { testMode?: string };
					if (body.testMode === "win_immediately") {
						phaseConfig = TEST_PHASE_CONFIG_WITH_WIN;
					}
				} catch {
					// Empty body or non-JSON — use default config.
				}
			}
			const { sessionId } = createSession(phaseConfig);
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Set-Cookie": buildSessionCookie(sessionId),
				},
			});
		}

		// ── POST /game/turn ────────────────────────────────────────────────────
		// Runs one round for the active session and streams SSE events.
		if (url.pathname === "/game/turn" && request.method === "POST") {
			// Parse body: { addressedAi, message }
			let body: { addressedAi?: string; message?: string };
			try {
				body = (await request.json()) as {
					addressedAi?: string;
					message?: string;
				};
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			const { addressedAi, message } = body;
			if (!message || typeof message !== "string") {
				return new Response("Missing message", { status: 400 });
			}
			const validAiIds: AiId[] = ["red", "green", "blue"];
			if (!addressedAi || !validAiIds.includes(addressedAi as AiId)) {
				return new Response("Missing or invalid addressedAi", { status: 400 });
			}

			// ── Rate-limit / daily-cap guard ────────────────────────────────
			const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
			const guard = await checkAndCharge(
				env.RATE_GUARD_KV,
				clientIp,
				Date.now(),
				configFromEnv(env),
			);
			if (!guard.allowed) {
				return new Response(capHitStream(guard.reason), {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"X-Content-Type-Options": "nosniff",
						"X-Cap-Hit": guard.reason,
					},
				});
			}
			// ── End guard ───────────────────────────────────────────────────

			// Look up or create the session
			const sessionId = parseSessionCookie(request.headers.get("Cookie"));
			let session = sessionId ? getSession(sessionId) : undefined;

			// If no valid session, auto-create one (fallback for requests
			// that skipped /game/new — e.g. direct test callers).
			let newSessionId: string | undefined;
			if (!session) {
				const created = createSession(DEFAULT_PHASE_CONFIG);
				session = created.session;
				newSessionId = created.sessionId;
			}

			const capturedSession = session;
			const provider = createProvider(env);

			const responseHeaders: Record<string, string> = {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			};
			if (newSessionId) {
				responseHeaders["Set-Cookie"] = buildSessionCookie(newSessionId);
			}

			const stream = new ReadableStream({
				async start(controller) {
					const enc = new TextEncoder();
					try {
						const { result, completions } = await capturedSession.submitMessage(
							addressedAi as AiId,
							message,
							provider,
						);

						// Get the phase state after the round (session mutated in place)
						const phaseAfter = getActivePhase(capturedSession.getState());

						// Encode and stream all events
						const events = encodeRoundResult(result, completions, phaseAfter);
						const payload = serialiseSseEvents(events);
						controller.enqueue(enc.encode(payload));
						controller.enqueue(enc.encode("data: [DONE]\n\n"));
						controller.close();
					} catch (err) {
						controller.error(err);
					}
				},
			});

			return new Response(stream, { headers: responseHeaders });
		}

		if (url.pathname === "/diagnostics") {
			if (request.method !== "POST") {
				return new Response("Method Not Allowed", { status: 405 });
			}

			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			const payload = body as Record<string, unknown>;

			if (typeof payload.downloaded !== "boolean") {
				return new Response("Missing or invalid field: downloaded", {
					status: 400,
				});
			}
			if (typeof payload.summary !== "string" || payload.summary.length === 0) {
				return new Response("Missing or invalid field: summary", {
					status: 400,
				});
			}

			// v1 taxonomy is intentionally minimal (TBD per PRD).
			// Log the payload; a future iteration can persist to KV.
			console.log(
				`[diagnostics] downloaded=${payload.downloaded} summary=${payload.summary}`,
			);

			return new Response(null, { status: 200 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
