// Long-running playtest daemon. Launches Chromium, opens hi-blue at
// http://localhost:8787, logs in, and stays up. Reads NEWLINE-delimited JSON
// commands from /tmp/playtest-in and writes JSON responses to /tmp/playtest-out.
//
// All interactions are GUI-only: clicks, typing into the composer, reading
// visible text from panels. We never call page.evaluate to peek at hidden state.
//
// Commands (one JSON object per line, via /tmp/playtest-in):
//   {"op":"view"}                       → snapshot the visible game state
//   {"op":"send","text":"<message>"}    → type into composer and click [tx]
//   {"op":"wait","ms":3000}             → sleep, then snapshot
//   {"op":"snap","path":"/tmp/x.png"}   → screenshot for human reference
//   {"op":"shutdown"}                   → close the browser and exit
//
// Each response is one JSON object on /tmp/playtest-out, e.g.:
//   {"ok":true,"phase":"...","panels":[...],"composer":"...","banner":"..."}

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

// Wait for the CONNECT button to be enabled (persona + content-pack generation
// completes asynchronously; CONNECT lights up when the dial-up animation ends).
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
await page.waitForURL(/#\/game/, { timeout: 30_000 });
await page.locator("#composer").waitFor({ state: "visible", timeout: 30_000 });
log("game route loaded — daemon ready");

// ---- Helpers that read ONLY visible text from the GUI -----------------------

async function readVisibleText(loc) {
	const count = await loc.count();
	if (count === 0) return "";
	const first = loc.first();
	if (!(await first.isVisible().catch(() => false))) return "";
	return (await first.innerText()).trim();
}

async function snapshot() {
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
		topinfoLeft,
		topinfoRight,
		phase,
		composerPrefix,
		lockoutErr,
		endgame,
		capHit,
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

async function waitForRoundQuiet(maxMs = 60_000) {
	// A round is "quiet" when no panel transcript has changed in ~3s.
	const deadline = Date.now() + maxMs;
	let last = JSON.stringify((await snapshot()).panels.map((p) => p.transcript));
	let lastChangeAt = Date.now();
	while (Date.now() < deadline) {
		await page.waitForTimeout(500);
		const cur = JSON.stringify(
			(await snapshot()).panels.map((p) => p.transcript),
		);
		if (cur !== last) {
			last = cur;
			lastChangeAt = Date.now();
		} else if (Date.now() - lastChangeAt > 3000) {
			return;
		}
	}
}

// ---- Command loop ----------------------------------------------------------

async function handle(cmd) {
	switch (cmd.op) {
		case "view": {
			return { ok: true, snapshot: await snapshot() };
		}
		case "send": {
			await send(cmd.text);
			await waitForRoundQuiet(cmd.maxMs ?? 90_000);
			return { ok: true, snapshot: await snapshot() };
		}
		case "wait": {
			await page.waitForTimeout(cmd.ms ?? 1000);
			return { ok: true, snapshot: await snapshot() };
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
