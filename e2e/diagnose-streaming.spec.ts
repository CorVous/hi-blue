/**
 * DIAGNOSTIC: word-by-word streaming feedback loop for issue #102.
 *
 * The existing `stubChatCompletions` helper uses `route.fulfill({ body })`
 * which delivers the entire SSE body in a single TCP-level chunk — so it
 * cannot exercise the wire-arrival timing path the issue is about. Mock
 * jsdom tests likewise short-circuit the SSE pipeline. Neither setup can
 * detect "panel waits for full stream before painting".
 *
 * This spec installs a real streaming fetch override (via addInitScript)
 * that emits SSE chunks at controlled 200ms intervals. It records:
 *   - when each SSE chunk is produced (wire timeline)
 *   - when each panel's transcript first/again grows (paint timeline)
 *   - when each fetch promise resolves
 *
 * On the current code (post-PR-#68 revert) this is expected to FAIL the
 * "live" assertion: panels grow only after all three streams complete and
 * the synthetic-pacing loop runs. That confirms the architecture, not just
 * a wire-side issue, gates live streaming.
 *
 * Run: `pnpm exec playwright test e2e/diagnose-streaming.spec.ts`
 */

import { expect, test } from "@playwright/test";
import { getAiHandles } from "./helpers";

// 5 chunks per AI × 200ms = 1.0s per stream × 3 AIs = ~3.0s total wire time.
const CHUNK_INTERVAL_MS = 200;
const CHUNKS_PER_AI: Record<string, string[]> = {
	"call-2": ["alpha ", "beta ", "gamma ", "delta ", "epsilon."],
	"call-3": ["uno ", "dos ", "tres ", "quatro ", "cinco."],
	"call-4": ["one ", "two ", "three ", "four ", "five."],
};

interface DiagSample {
	t: number;
	kind: "fetch" | "chunk" | "fetch_done" | "dom";
	tag: string;
	detail?: string;
}

test("DIAGNOSTIC: observe wire vs DOM timeline during streaming", async ({
	page,
}) => {
	// Capture diagnostic samples written to window.__diag.
	const samples: DiagSample[] = [];
	page.on("console", (msg) => {
		const text = msg.text();
		if (!text.startsWith("[DIAG-7c41]")) return;
		try {
			const payload = JSON.parse(text.slice("[DIAG-7c41]".length).trim());
			samples.push(payload);
		} catch {
			// ignore
		}
	});

	// addInitScript runs before any page script. We monkey-patch fetch to:
	// (a) Handle the synthesis JSON-mode call (stream===false or response_format
	//     present) by echoing back a canned personas response.
	// (b) For SSE streaming calls, return a real ReadableStream-backed Response
	//     whose chunks emit at known intervals.
	await page.addInitScript(
		({
			chunkSets,
			intervalMs,
		}: {
			chunkSets: Record<string, string[]>;
			intervalMs: number;
		}) => {
			const t0 = performance.now();
			function diag(payload: Record<string, unknown>): void {
				const t = Math.round(performance.now() - t0);
				console.log(`[DIAG-7c41] ${JSON.stringify({ t, ...payload })}`);
			}

			// MutationObserver on each transcript — fires whenever textContent grows.
			// We install it once DOM is ready. Panels get data-transcript set
			// dynamically after synthesis, so we observe all [data-transcript] elements
			// by watching the document for new elements.
			window.addEventListener("DOMContentLoaded", () => {
				const observedTranscripts = new Set<Element>();
				function observeTranscript(el: Element): void {
					if (observedTranscripts.has(el)) return;
					observedTranscripts.add(el);
					const tag =
						(el as HTMLElement).dataset.transcript ??
						el.getAttribute("data-transcript") ??
						"?";
					let lastLen = el.textContent?.length ?? 0;
					new MutationObserver(() => {
						const len = el.textContent?.length ?? 0;
						if (len !== lastLen) {
							diag({ kind: "dom", tag, detail: `len=${len}` });
							lastLen = len;
						}
					}).observe(el, {
						childList: true,
						characterData: true,
						subtree: true,
					});
				}

				// Observe transcript elements that exist or appear later
				for (const el of document.querySelectorAll("[data-transcript]")) {
					observeTranscript(el);
				}
				new MutationObserver((mutations) => {
					for (const m of mutations) {
						for (const node of m.addedNodes) {
							if (node instanceof Element) {
								if (node.hasAttribute("data-transcript"))
									observeTranscript(node);
								for (const el of node.querySelectorAll("[data-transcript]")) {
									observeTranscript(el);
								}
							}
						}
						// Also handle attribute changes on existing elements
						if (
							m.type === "attributes" &&
							m.attributeName === "data-transcript" &&
							m.target instanceof Element
						) {
							observeTranscript(m.target);
						}
					}
				}).observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["data-transcript"],
				});
			});

			let callIdx = 0;
			const origFetch = window.fetch.bind(window);
			window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.href
							: input.url;
				if (!url.includes("/v1/chat/completions")) {
					return origFetch(input, init);
				}

				callIdx += 1;
				const tag = `call-${callIdx}`;

				// Detect synthesis call (stream===false or response_format present)
				let isSynthesis = false;
				try {
					const body = JSON.parse(
						typeof init?.body === "string" ? init.body : "",
					) as {
						stream?: boolean;
						response_format?: unknown;
						messages?: Array<{ content?: string }>;
					};
					isSynthesis = body.stream === false || body.response_format != null;
					if (isSynthesis) {
						// Echo back persona ids with canned blurbs
						const content2 = body.messages?.[1]?.content ?? "";
						const ids: string[] = Array.from(
							content2.matchAll(/id:\s*"([a-z0-9]{4})"/g),
							(m) => m[1] ?? "",
						).filter(Boolean);
						const personas = ids.map((id) => ({
							id,
							blurb: `Stub blurb for ${id}.`,
						}));
						const responseBody = JSON.stringify({
							choices: [{ message: { content: JSON.stringify({ personas }) } }],
						});
						return Promise.resolve(
							new Response(responseBody, {
								status: 200,
								headers: { "Content-Type": "application/json" },
							}),
						);
					}
				} catch {
					// ignore parse errors
				}

				const chunks =
					(chunkSets as Record<string, string[]>)[tag] ?? chunkSets["call-2"];
				diag({ kind: "fetch", tag });

				const encoder = new TextEncoder();
				const stream = new ReadableStream<Uint8Array>({
					async start(controller) {
						for (const word of chunks ?? []) {
							await new Promise((r) => setTimeout(r, intervalMs));
							const sse = `data: ${JSON.stringify({
								choices: [{ delta: { content: word }, finish_reason: null }],
							})}\n\n`;
							controller.enqueue(encoder.encode(sse));
						}
						await new Promise((r) => setTimeout(r, intervalMs));
						controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
						controller.close();
						diag({ kind: "fetch_done", tag });
					},
				});

				return Promise.resolve(
					new Response(stream, {
						status: 200,
						headers: {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
						},
					}),
				);
			};
		},
		{ chunkSets: CHUNKS_PER_AI, intervalMs: CHUNK_INTERVAL_MS },
	);

	await page.goto("/");

	// Wait for synthesis to complete and panels to get dynamic data-ai attributes.
	const { ids, names } = await getAiHandles(page);

	await page.fill("#prompt", `@${names[0]} Hello`);
	await page.click("#send");

	// Wait until all three SSE streams complete. (Post-#107 the send button no
	// longer re-enables after submit because the prompt is cleared and an empty
	// prompt has no @mention.)
	// The synthesis call is call-1, so streaming starts at call-2. We need 3
	// fetch_done events (calls 2, 3, 4).
	await expect
		.poll(() => samples.filter((s) => s.kind === "fetch_done").length, {
			timeout: 30_000,
		})
		.toBeGreaterThanOrEqual(3);
	// Small grace for the encoder pacing loop to finish painting after the wire.
	await page.waitForTimeout(300);

	// ── Print the full timeline so the diagnosis is visible in CI logs ────
	const rows = samples.map(
		(s) =>
			`  t=${String(s.t).padStart(5)}ms  ${s.kind.padEnd(11)} ${s.tag.padEnd(10)} ${s.detail ?? ""}`,
	);
	console.log(
		"\n=== DIAGNOSTIC TIMELINE (issue #102) ===\n" +
			rows.join("\n") +
			"\n=========================================",
	);

	// ── Compute key metrics for the assertion ────────────────────────────
	const firstFetchT = samples.find((s) => s.kind === "fetch")?.t ?? 0;
	const firstFetchDoneT = samples.find((s) => s.kind === "fetch_done")?.t ?? 0;
	const lastFetchDoneT =
		[...samples].reverse().find((s) => s.kind === "fetch_done")?.t ?? 0;

	// Count DOM growth events that happen DURING the stream window of any AI.
	// Filter out the initial "thinking…" placeholder by requiring growth past
	// length 30 (player msg "> Hello" + "thinking…" ≈ 18 chars).
	const liveGrowthEvents = samples.filter(
		(s) =>
			s.kind === "dom" &&
			s.t >= firstFetchT &&
			s.t < lastFetchDoneT &&
			Number.parseInt((s.detail ?? "len=0").replace("len=", ""), 10) > 30,
	);

	console.log(
		`firstFetch=${firstFetchT}ms  firstFetchDone=${firstFetchDoneT}ms  lastFetchDone=${lastFetchDoneT}ms  liveGrowthEvents=${liveGrowthEvents.length}`,
	);

	// Verify that ids are 4-char procedural handles (validates synthesis stub wiring)
	for (const id of ids) {
		expect(id).toMatch(/^[a-z0-9]{4}$/);
	}

	// LIVE-STREAMING ASSERTION (expected to FAIL on current code):
	// At least one panel should grow with real content WHILE another AI's
	// stream is still running. On the current buffered architecture, no panel
	// grows until lastFetchDone, so this should produce 0 events.
	expect(
		liveGrowthEvents.length,
		`expected ≥ 1 panel growth event between firstFetch (${firstFetchT}ms) and lastFetchDone (${lastFetchDoneT}ms); got ${liveGrowthEvents.length}. Streams are being buffered and replayed after the round resolves.`,
	).toBeGreaterThanOrEqual(1);
});
