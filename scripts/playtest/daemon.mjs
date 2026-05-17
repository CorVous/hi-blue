// Long-running playtest daemon. Launches Chromium, opens hi-blue at
// http://localhost:8787, logs in, and stays up. Reads NEWLINE-delimited JSON
// commands from /tmp/playtest-in and writes JSON responses to /tmp/playtest-out.
//
// All interactions are GUI-only: clicks, typing into the composer, reading
// visible text from panels. We never call page.evaluate to peek at hidden state.
//
// Commands (one JSON object per line, via /tmp/playtest-in):
//   {"op":"view"}                       → snapshot (delta transcripts by default)
//   {"op":"view","full":true}             → snapshot with full transcripts
//   {"op":"send","text":"<message>"}    → type into composer and click [tx]
//   {"op":"wait","ms":3000}             → sleep, then snapshot
//   {"op":"snap","path":"/tmp/x.png"}   → screenshot for human reference
//   {"op":"shutdown"}                   → close the browser and exit
//
// Each response is one JSON object on /tmp/playtest-out. The snapshot shape
// is documented in .claude/skills/playtest/SKILL.md (single-game model — no
// phase advancement; `endgame` is the terminal signal).

import { execSync } from "node:child_process";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	unlinkSync,
} from "node:fs";
import { chromium } from "@playwright/test";

// Spike #239: env-overridable FIFO + log paths so multiple daemon instances
// can run concurrently (one per A/B/C/D/E/F session). Defaults preserve the
// original single-daemon contract.
const IN = process.env.PLAYTEST_IN || "/tmp/playtest-in";
const OUT = process.env.PLAYTEST_OUT || "/tmp/playtest-out";
const LOG = process.env.PLAYTEST_LOG || "/tmp/playtest.log";

function ensureFifo(p) {
	if (existsSync(p)) {
		try {
			unlinkSync(p);
		} catch {}
	}
	execSync(`mkfifo "${p}"`);
}
ensureFifo(IN);
ensureFifo(OUT);

const log = (msg) => {
	const line = `[${new Date().toISOString()}] ${msg}\n`;
	process.stderr.write(line);
	try {
		// Append to a debug log file; non-fatal if unavailable.
		execSync(`printf '%s' ${JSON.stringify(line)} >> ${LOG}`);
	} catch {}
};

log("launching chromium");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

page.on("pageerror", (err) => log(`pageerror: ${err.message}`));
page.on("console", (msg) => {
	const t = msg.type();
	if (t === "error" || t === "warn" || t === "log") {
		log(`console.${t}: ${msg.text().slice(0, 500)}`);
	}
});
page.on("requestfailed", (req) =>
	log(
		`requestfailed: ${req.method()} ${req.url()} - ${req.failure()?.errorText ?? "?"}`,
	),
);

// Spike #239: optional URL extras for pinning seed and selecting framing.
const extras = [];
if (process.env.SPIKE_SEED) extras.push(`seed=${process.env.SPIKE_SEED}`);
if (process.env.SPIKE_PARALLEL_FRAMING) {
	extras.push(`parallelFraming=${process.env.SPIKE_PARALLEL_FRAMING}`);
}
if (process.env.SPIKE_ENGAGEMENT_CLAUSES) {
	extras.push(`engagementClauses=${process.env.SPIKE_ENGAGEMENT_CLAUSES}`);
}
const startUrl = `http://localhost:8787/?skipDialup=1${extras.length ? `&${extras.join("&")}` : ""}`;
log(`navigating to ${startUrl}`);
await page.goto(startUrl, {
	waitUntil: "domcontentloaded",
});

// Wait for the CONNECT button to be enabled. In the single-game restructure
// CONNECT lights up as soon as the dial-up animation ends; persona +
// content-pack generation continues in the background and the game route
// renders a progressive-loading UI (loading-daemons → generating-room →
// stable).
await page.locator("#begin").waitFor({ state: "visible", timeout: 60_000 });
log("waiting for #begin to be enabled (this can take up to 60s)");
const start = Date.now();
while (Date.now() - start < 90_000) {
	const disabled = await page.locator("#begin").getAttribute("disabled");
	if (disabled === null) break;
	await page.waitForTimeout(500);
}
log("filling password and clicking CONNECT");
await page.locator("#password").fill("password");
await page.locator("#begin").click();
// The SPA no longer uses hash-based routing (ADR 0011). Clicking CONNECT
// calls renderApp(), which sets `data-view="game"` on the <main> root —
// that is the load-bearing signal that we've left the start screen.
await page
	.locator('main[data-view="game"]')
	.waitFor({ state: "attached", timeout: 30_000 });
await page.locator("#composer").waitFor({ state: "visible", timeout: 30_000 });

// The composer is visible during the "loading-daemons" and "generating-room"
// states but the prompt input is `disabled` and shows a "loading…"
// placeholder. Wait for the route to reach the "stable" state (composer
// enabled, no `data-load-state` on #stage) before announcing READY —
// otherwise the first `send` would type into a disabled input and the
// playtest would hang silently.
//
// Also watch for #bootstrap-recovery and #cap-hit: if either becomes visible,
// the run is unrecoverable from this command surface (we can't click the
// regen / retry buttons through cmd.sh) so we fail fast for start.sh.
log("waiting for game route to reach stable state (content packs loading)...");
const stableDeadline = Date.now() + 300_000; // up to 5 min for slow packs
while (Date.now() < stableDeadline) {
	const promptDisabled = await page.locator("#prompt").getAttribute("disabled");
	const loadState = await page
		.locator("#stage")
		.getAttribute("data-load-state");
	if (promptDisabled === null && loadState === null) break;

	const recoveryVisible = await page
		.locator("#bootstrap-recovery")
		.isVisible()
		.catch(() => false);
	if (recoveryVisible) {
		const body = await page
			.locator("#bootstrap-recovery-title, #bootstrap-recovery-body")
			.allInnerTexts()
			.catch(() => []);
		log(`bootstrap recovery UI surfaced: ${body.join(" — ")}`);
		log("FATAL: bootstrap failed; restart the daemon to try again");
		await browser.close();
		process.exit(1);
	}
	const capHitVisible = await page
		.locator("#cap-hit")
		.isVisible()
		.catch(() => false);
	if (capHitVisible) {
		log("FATAL: API budget cap was hit before the room finished generating");
		await browser.close();
		process.exit(1);
	}

	await page.waitForTimeout(500);
}
const finalPromptDisabled = await page
	.locator("#prompt")
	.getAttribute("disabled");
if (finalPromptDisabled !== null) {
	log("WARN: prompt still disabled after 5 min — proceeding anyway");
}
log("game route loaded — daemon ready");

// ---- Per-panel transcript tracking for delta snapshots --------------------
// Keyed by daemon name (e.g. "*v86p"). Stores the full transcript string
// seen on the previous snapshot so we can diff and return only new lines.
const lastSeenTranscript = {};

function computeDelta(name, current) {
	const prev = lastSeenTranscript[name] ?? "";
	lastSeenTranscript[name] = current;
	if (!prev) return current; // first snapshot for this panel — return everything
	if (current === prev) return ""; // nothing new
	// The transcript is append-only; new content appears at the end.
	// If the current transcript starts with the previous one, the delta is
	// the trailing portion. Otherwise (edge case: re-render, page refresh)
	// fall back to returning the full transcript so nothing is lost.
	if (current.startsWith(prev)) {
		return current.slice(prev.length);
	}
	return current;
}

// ---- Helpers that read ONLY visible text from the GUI -----------------------

async function readVisibleText(loc) {
	const count = await loc.count();
	if (count === 0) return "";
	const first = loc.first();
	if (!(await first.isVisible().catch(() => false))) return "";
	return (await first.innerText()).trim();
}

async function snapshot() {
	// Which top-level view the state-driven renderer (ADR 0011) is showing:
	// "start" | "game" | "sessions". During a normal playtest this is always
	// "game"; "start" or "sessions" here means something kicked us out (e.g.
	// the active session was discarded as broken or version-mismatched).
	const view =
		(await page
			.locator("main")
			.getAttribute("data-view")
			.catch(() => null)) ?? "";
	// #phase-banner is legacy UI from the retired three-phase model. In the
	// current single-game build it stays hidden, so `phase` is normally "".
	// Kept in the snapshot shape for backward compat with older playtest logs.
	const phase = await readVisibleText(page.locator("#phase-banner"));
	const topinfoLeft = await readVisibleText(page.locator("#topinfo-left"));
	const topinfoRight = await readVisibleText(page.locator("#topinfo-right"));
	const composerPrefix = await readVisibleText(
		page.locator("#composer .prompt-target"),
	);
	const lockoutErr = await readVisibleText(page.locator("#lockout-error"));
	const endgameVisible = await page
		.locator("#endgame")
		.isVisible()
		.catch(() => false);
	const endgame = endgameVisible
		? await readVisibleText(page.locator("#endgame"))
		: "";
	const capHitVisible = await page
		.locator("#cap-hit")
		.isVisible()
		.catch(() => false);
	const capHit = capHitVisible
		? await readVisibleText(page.locator("#cap-hit"))
		: "";
	// #bootstrap-recovery surfaces when world generation fails or times out.
	// Non-empty here means the cmd surface cannot proceed — the regen /
	// abandon buttons aren't reachable, so the playtest is effectively stuck.
	const recoveryVisible = await page
		.locator("#bootstrap-recovery")
		.isVisible()
		.catch(() => false);
	const recovery = recoveryVisible
		? await readVisibleText(page.locator("#bootstrap-recovery"))
		: "";

	const panels = await page.locator("article.ai-panel").all();
	const panelData = [];
	for (const p of panels) {
		// There are two .panel-name spans (top brow + bottom brow). Pick whichever
		// renders non-empty — that's the visible label, e.g. `*wcjo`.
		const nameLocs = await p.locator(".panel-name").all();
		let name = "";
		for (const n of nameLocs) {
			const t = (await n.innerText()).trim();
			if (t) {
				name = t;
				break;
			}
		}
		const budget = await readVisibleText(p.locator(".panel-budget").first());
		// Read the running transcript text the player can see in the panel.
		const transcript = await readVisibleText(p.locator(".transcript").first());
		panelData.push({ name, budget, transcript });
	}
	return {
		view,
		topinfoLeft,
		topinfoRight,
		phase,
		composerPrefix,
		lockoutErr,
		endgame,
		capHit,
		recovery,
		panels: panelData,
	};
}

async function send(text) {
	const input = page.locator("#prompt");
	await input.click();
	await input.fill("");
	await input.type(text, { delay: 5 });
	await page.locator("#send").click();
}

async function waitForRoundEnd(maxMs = 90_000) {
	// The round handler in routes/game.ts flips `data-round-in-flight` on
	// `#stage` to "true" synchronously at submit-time, then removes it in the
	// finally block after the events loop has painted every transcript update.
	// Waiting on that attribute is deterministic: it fires whether daemons
	// respond or not (locked-out and silent turns still complete the round)
	// and only clears once the round's UI updates are fully applied.
	const inFlight = page.locator("#stage[data-round-in-flight]");
	try {
		// Confirm the round actually started. The attribute is set in the
		// synchronous portion of the click handler, so this should resolve
		// immediately; a longer wait covers slow-to-handler edge cases.
		await inFlight.waitFor({ state: "attached", timeout: 5_000 });
	} catch {
		// No round started — most likely the message was rejected client-side
		// (empty / invalid mention). Nothing to wait for.
		return;
	}
	await inFlight.waitFor({ state: "detached", timeout: maxMs });
}

// Apply delta logic to a snapshot in place. When full=true (or on the first
// snapshot for a panel), the panel's `transcript` field contains the full text.
// Otherwise `transcript` is replaced with only the new lines since the last
// agent-facing snapshot, keeping the agent's context window lean.
function applyDelta(snap, full) {
	for (const p of snap.panels) {
		const delta = computeDelta(p.name, p.transcript);
		if (!full) {
			p.transcript = delta || "(no new messages)";
		}
	}
}

// ---- Command loop ----------------------------------------------------------

async function handle(cmd) {
	switch (cmd.op) {
		case "view": {
			const snap = await snapshot();
			applyDelta(snap, cmd.full);
			return { ok: true, snapshot: snap };
		}
		case "send": {
			await send(cmd.text);
			await waitForRoundEnd(cmd.maxMs ?? 90_000);
			const snap = await snapshot();
			applyDelta(snap, cmd.full);
			return { ok: true, snapshot: snap };
		}
		case "wait": {
			await page.waitForTimeout(cmd.ms ?? 1000);
			const snap = await snapshot();
			applyDelta(snap, cmd.full);
			return { ok: true, snapshot: snap };
		}
		case "snap": {
			const path = cmd.path ?? "/tmp/playtest.png";
			await page.screenshot({ path, fullPage: true });
			return { ok: true, path };
		}
		case "shutdown": {
			setTimeout(async () => {
				await browser.close();
				process.exit(0);
			}, 50);
			return { ok: true, bye: true };
		}
		default:
			return { ok: false, error: `unknown op: ${cmd.op}` };
	}
}

log("entering command loop");

// We open the FIFO line by line. Each writer-side `echo > IN` closes the writer,
// which is treated as EOF here, so we re-open after each command.
async function runOnce() {
	const buf = await new Promise((resolve, reject) => {
		const stream = createReadStream(IN, { encoding: "utf8" });
		let acc = "";
		stream.on("data", (c) => {
			acc += c;
		});
		stream.on("end", () => resolve(acc));
		stream.on("error", reject);
	});
	const line = buf.trim();
	if (!line) return;
	let cmd;
	try {
		cmd = JSON.parse(line);
	} catch {
		const w = createWriteStream(OUT);
		w.end(`${JSON.stringify({ ok: false, error: "bad json" })}\n`);
		return;
	}
	log(`cmd: ${JSON.stringify(cmd).slice(0, 200)}`);
	let resp;
	try {
		resp = await handle(cmd);
	} catch (e) {
		resp = { ok: false, error: String(e?.message ?? e) };
	}
	const w = createWriteStream(OUT);
	await new Promise((resolve) => {
		w.end(`${JSON.stringify(resp)}\n`, "utf8", resolve);
	});
}

while (true) {
	await runOnce();
}
