import { PHASE_1_CONFIG } from "../content";
import { getActivePhase } from "../engine";
import type { GameSession } from "../game-session";
import { encodeRoundResult } from "../round-result-encoder";
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
	/** Per-token delay in ms for the /game/turn stream. Defaults to 60ms; set "0" in tests. */
	TOKEN_PACE_MS?: string;
}

/**
 * Per-AI multipliers on TOKEN_PACE_MS to give each AI a distinct typing rhythm.
 * Lower = faster. Red is impulsive, blue is deliberate, green sits between.
 */
const AI_TYPING_SPEED: Record<AiId, number> = {
	red: 0.7,
	green: 1.0,
	blue: 1.4,
};

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

/**
 * Three-phase config used only in dev/test to exercise phase advancement and
 * game completion. Each phase has an always-true win condition so a single
 * /game/turn call advances to the next phase.
 *
 * Phase 3 has no nextPhaseConfig, so the game completes (gameEnded=true) when
 * its win condition fires.
 */
const TEST_PHASE3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	objective: "The final reckoning approaches.",
	aiGoals: { red: "Endure", green: "Endure", blue: "Endure" },
	initialWorld: { items: [] },
	budgetPerAi: 5,
	winCondition: () => true, // always fires on first turn
};

const TEST_PHASE2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "Deeper truths emerge.",
	aiGoals: { red: "Seek", green: "Seek", blue: "Seek" },
	initialWorld: { items: [] },
	budgetPerAi: 5,
	winCondition: () => true, // always fires on first turn
	nextPhaseConfig: TEST_PHASE3_CONFIG,
};

const TEST_PHASE_CONFIG_WITH_WIN: PhaseConfig = {
	phaseNumber: 1,
	objective: "A test phase that completes immediately.",
	aiGoals: { red: "Pass", green: "Pass", blue: "Pass" },
	initialWorld: { items: [] },
	budgetPerAi: 5,
	winCondition: () => true, // always fires on first turn
	nextPhaseConfig: TEST_PHASE2_CONFIG,
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			const headers: Record<string, string> = {
				"Content-Type": "text/html; charset=utf-8",
			};

			// ── Dev affordances on the chat page (gated on ENABLE_TEST_MODES) ──
			// ?winImmediately=1 — replace any current session with one whose
			//   three phases each have an always-true win condition, so each
			//   /game/turn advances the phase and the third one ends the game.
			// ?lockout=1        — arm a chat-lockout (red, 2 rounds) for the
			//   next /game/turn on the active session. Drives issue #29 QA.
			// Both query params are silently ignored in production.
			const testModesEnabled = env.ENABLE_TEST_MODES === "1";
			const wantsWinImmediately =
				testModesEnabled && url.searchParams.get("winImmediately") === "1";
			const wantsLockout =
				testModesEnabled && url.searchParams.get("lockout") === "1";

			if (wantsWinImmediately || wantsLockout) {
				let session: GameSession;
				if (wantsWinImmediately) {
					// Always create a fresh session — the test phase config is
					// fundamentally different from any existing session's, and
					// matches the semantics of POST /game/new with testMode set.
					const created = createSession(TEST_PHASE_CONFIG_WITH_WIN);
					session = created.session;
					headers["Set-Cookie"] = buildSessionCookie(created.sessionId);
				} else {
					const sessionId = parseSessionCookie(request.headers.get("Cookie"));
					const existing = sessionId ? getSession(sessionId) : undefined;
					if (existing) {
						session = existing;
					} else {
						const created = createSession(PHASE_1_CONFIG);
						session = created.session;
						headers["Set-Cookie"] = buildSessionCookie(created.sessionId);
					}
				}

				if (wantsLockout) {
					const currentRound = getActivePhase(session.getState()).round;
					session.armChatLockout({
						rng: () => 0,
						lockoutTriggerRound: currentRound + 1,
						lockoutDuration: 2,
					});
				}
			}

			return new Response(renderChatPage(), { headers });
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

		// ── POST /game/new ────────────────────────────────────────────────────
		// Creates a new game session and sets the session cookie.
		// When ENABLE_TEST_MODES="1" (test environments only), accepts an optional
		// body { testMode: "win_immediately" } to create a session whose phase-1
		// win condition fires on the first turn.
		if (url.pathname === "/game/new" && request.method === "POST") {
			let phaseConfig: PhaseConfig = PHASE_1_CONFIG;
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
				const created = createSession(PHASE_1_CONFIG);
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

			const tokenPaceMs = Number(env.TOKEN_PACE_MS ?? "60");
			const stream = new ReadableStream({
				async start(controller) {
					const enc = new TextEncoder();
					try {
						const { result, completions } = await capturedSession.submitMessage(
							addressedAi as AiId,
							message,
							provider,
						);

						const phaseAfter = getActivePhase(capturedSession.getState());
						const events = encodeRoundResult(
							result,
							completions,
							phaseAfter,
							capturedSession.getState().personas,
						);

						let speakingAi: AiId | null = null;
						for (const event of events) {
							controller.enqueue(
								enc.encode(`data: ${JSON.stringify(event)}\n\n`),
							);
							if (event.type === "ai_start") {
								speakingAi = event.aiId;
							} else if (event.type === "ai_end") {
								speakingAi = null;
							} else if (
								event.type === "token" &&
								tokenPaceMs > 0 &&
								speakingAi
							) {
								const speed = AI_TYPING_SPEED[speakingAi];
								const jittered = tokenPaceMs * speed * (0.5 + Math.random());
								await new Promise((r) => setTimeout(r, jittered));
							}
						}
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
