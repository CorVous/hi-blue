import { execSync } from "node:child_process";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const IN = process.env.PLAYTEST_IN || "/tmp/playtest-in";
const OUT = process.env.PLAYTEST_OUT || "/tmp/playtest-out";
const LOG = process.env.PLAYTEST_LOG || "/tmp/playtest.log";
const RESTORE = process.env.PLAYTEST_RESTORE || "";
const SAVE_DIR = process.env.PLAYTEST_SAVE_DIR || "/tmp/playtest-saves";
const ORIGIN = "http://localhost:8787";
const STORAGE_PREFIX = "hi-blue";

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

const extras = [];
if (process.env.SPIKE_SEED) extras.push(`seed=${process.env.SPIKE_SEED}`);
if (process.env.SPIKE_PARALLEL_FRAMING) {
	extras.push(`parallelFraming=${process.env.SPIKE_PARALLEL_FRAMING}`);
}
if (process.env.SPIKE_ENGAGEMENT_CLAUSES) {
	extras.push(`engagementClauses=${process.env.SPIKE_ENGAGEMENT_CLAUSES}`);
}
const startUrl = `http://localhost:8787/?skipDialup=1${extras.length ? `&${extras.join("&")}` : ""}`;
async function seedLocalStorage(savePath) {
	const save = JSON.parse(readFileSync(savePath, "utf8"));
	const entries = Object.entries(save.localStorage ?? {});
	if (entries.length === 0) {
		throw new Error(`save file ${savePath} holds no localStorage entries`);
	}
	const seedUrl = `${ORIGIN}/__playtest-seed`;
	await page.route(seedUrl, (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
	);
	await page.goto(seedUrl);
	await page.evaluate((pairs) => {
		localStorage.clear();
		for (const [k, v] of pairs) localStorage.setItem(k, v);
	}, entries);
	await page.unroute(seedUrl);
	log(`restored ${entries.length} localStorage keys from ${savePath}`);
}

async function connectFreshSession() {
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
}

if (RESTORE) await seedLocalStorage(RESTORE);

log(`navigating to ${startUrl}`);
await page.goto(startUrl, {
	waitUntil: "domcontentloaded",
});

if (RESTORE) {
	const restoredView = await page
		.locator('main[data-view="game"]')
		.waitFor({ state: "attached", timeout: 30_000 })
		.then(() => "game")
		.catch(async () => page.locator("main").getAttribute("data-view"));
	if (restoredView !== "game") {
		log(
			`FATAL: restored save did not boot into the game view (landed on "${restoredView}")`,
		);
		await browser.close();
		process.exit(1);
	}
} else {
	await connectFreshSession();
	await page
		.locator('main[data-view="game"]')
		.waitFor({ state: "attached", timeout: 30_000 });
}
await page.locator("#composer").waitFor({ state: "visible", timeout: 30_000 });

log("waiting for game route to reach stable state (content packs loading)...");
const stableDeadline = Date.now() + 300_000;
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

const lastSeenTranscript = {};

function computeDelta(name, current) {
	const prev = lastSeenTranscript[name] ?? "";
	lastSeenTranscript[name] = current;
	if (!prev) return current;
	if (current === prev) return "";
	if (current.startsWith(prev)) {
		return current.slice(prev.length);
	}
	return current;
}

async function readVisibleText(loc) {
	const count = await loc.count();
	if (count === 0) return "";
	const first = loc.first();
	if (!(await first.isVisible().catch(() => false))) return "";
	return (await first.innerText()).trim();
}

async function snapshot() {
	const view =
		(await page
			.locator("main")
			.getAttribute("data-view")
			.catch(() => null)) ?? "";
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
	const inFlight = page.locator("#stage[data-round-in-flight]");
	try {
		await inFlight.waitFor({ state: "attached", timeout: 5_000 });
	} catch {
		return;
	}
	await inFlight.waitFor({ state: "detached", timeout: maxMs });
}

function applyDelta(snap, full) {
	for (const p of snap.panels) {
		const delta = computeDelta(p.name, p.transcript);
		if (!full) {
			p.transcript = delta || "(no new messages)";
		}
	}
}

async function saveGameState(requestedPath) {
	const storage = await page.evaluate((prefix) => {
		const out = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) out[key] = localStorage.getItem(key);
		}
		return out;
	}, STORAGE_PREFIX);
	const sessionId =
		storage[`${STORAGE_PREFIX}:active-session`] ?? `no-active-${Date.now()}`;
	const path = requestedPath ?? `${SAVE_DIR}/${sessionId}.json`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				savedAt: new Date().toISOString(),
				sessionId,
				localStorage: storage,
			},
			null,
			2,
		)}\n`,
	);
	log(`saved ${Object.keys(storage).length} localStorage keys to ${path}`);
	return { savedTo: path, sessionId, keys: Object.keys(storage).length };
}

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
		case "save": {
			const saved = await saveGameState(cmd.path);
			return { ok: true, ...saved };
		}
		case "shutdown": {
			const saved = cmd.save === false ? null : await saveGameState(cmd.path);
			setTimeout(async () => {
				await browser.close();
				process.exit(0);
			}, 50);
			return { ok: true, bye: true, ...(saved ?? {}) };
		}
		default:
			return { ok: false, error: `unknown op: ${cmd.op}` };
	}
}

log("entering command loop");

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
