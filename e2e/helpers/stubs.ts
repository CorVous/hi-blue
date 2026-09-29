import {
	expect,
	type Locator,
	type Page,
	type Request,
} from "@playwright/test";
import {
	deobfuscateEngineBlob,
	ENGINE_OBFUSCATION_KEY,
	obfuscateEngineBlob,
} from "./engine-blob.js";
import type { AiHandles } from "./handles.js";
import { getAiHandles } from "./handles.js";
import {
	ACTIVE_SESSION_KEY,
	SESSIONS_PREFIX,
	sessionFileKey,
} from "./sessions.js";
import type { GridPosition } from "./vista-geometry.js";
import { isGridPosition } from "./vista-geometry.js";

export type WordsFactory = (request: Request) => string[] | Promise<string[]>;

function messageToolCallToBlueSseBody(words: string[]): string {
	const args = JSON.stringify({ to: "blue", content: words.join("") });
	const headerChunk = `data: ${JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_msg",
							function: { name: "message", arguments: "" },
						},
					],
				},
			},
		],
	})}\n\n`;
	const argsChunk = `data: ${JSON.stringify({
		choices: [
			{
				delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
				finish_reason: "tool_calls",
			},
		],
	})}\n\n`;
	const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01, total_tokens: 100 } })}\n\n`;
	return `${headerChunk}${argsChunk}${usageChunk}data: [DONE]\n\n`;
}

export type ParsedBody = {
	stream?: boolean;
	response_format?: unknown;
	messages?: Array<{ role?: string; content?: string }>;
} | null;

export const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	"X-Content-Type-Options": "nosniff",
};

const STUBBED_NEW_GAME_TIMEOUT_MS = 10_000;

function defaultStubBlurb(personaId: string): string {
	return `Stub blurb for ${personaId}.`;
}

export function isJsonModeRequest(body: ParsedBody): boolean {
	return (
		body !== null && (body.stream === false || body.response_format != null)
	);
}

function systemPromptContent(body: ParsedBody): string {
	return body?.messages?.[0]?.content ?? "";
}

function userMessageContent(body: ParsedBody): string {
	return body?.messages?.[1]?.content ?? "";
}

export function isRequestForDaemon(
	body: ParsedBody,
	daemonName: string,
): boolean {
	return systemPromptContent(body).includes(
		`writing *${daemonName}, a Daemon.`,
	);
}

export function classifyJsonRequest(
	body: ParsedBody,
): "synthesis" | "dual-content-pack" | "unknown" {
	const userMsg = userMessageContent(body);
	if (userMsg.startsWith("Synthesize blurbs for these personas:"))
		return "synthesis";
	if (userMsg.startsWith("Generate a dual A/B content pack for:"))
		return "dual-content-pack";
	return "unknown";
}

function extractSynthesisPersonaIds(synthesisUserMessage: string): string[] {
	return Array.from(
		synthesisUserMessage.matchAll(/id:\s*"([a-z0-9]{4})"/g),
		(m) => m[1] ?? "",
	).filter(Boolean);
}

function buildSynthesisResponseBody(
	body: ParsedBody,
	blurbFor: (id: string) => string,
): string {
	const ids = extractSynthesisPersonaIds(userMessageContent(body));
	const content = JSON.stringify({
		personas: ids.map((id) => ({
			id,
			blurb: blurbFor(id),
			voiceExamples: [
				`Stub voice 1 for ${id}.`,
				`Stub voice 2 for ${id}.`,
				`Stub voice 3 for ${id}.`,
			],
		})),
	});
	return JSON.stringify({ choices: [{ message: { content } }] });
}

type BindingSpec = {
	type: "carry" | "use_space" | "use_item" | "convergence";
	index: number;
};

type DualBindingContentPackSpec = {
	settingA: string;
	settingB: string;
	bindings: BindingSpec[];
	obstacleCount: number;
};

function parseDualBindingContentPackSpec(
	userMsg: string,
): DualBindingContentPackSpec {
	const settingAMatch = /settingA="([^"]*)"/.exec(userMsg);
	const settingBMatch = /settingB="([^"]*)"/.exec(userMsg);
	const settingA = settingAMatch?.[1] ?? "stub-setting-a";
	const settingB = settingBMatch?.[1] ?? "stub-setting-b";

	const bindingMatches = [
		...userMsg.matchAll(/Binding\s+(\d+)\s+\(([^)]+)\):/g),
	];
	const bindings: BindingSpec[] = bindingMatches.map((m) => ({
		index: Number(m[1]),
		type: m[2] as BindingSpec["type"],
	}));

	const obstacleIds = [...userMsg.matchAll(/obstacle id="([^"]+)"/g)];
	const obstacleCount = obstacleIds.length;

	return { settingA, settingB, bindings, obstacleCount };
}

function buildBoundPack(
	setting: string,
	bindings: BindingSpec[],
	obstacleCount: number,
): object {
	const builtBindings = bindings.map((sk) => {
		const i = sk.index;
		switch (sk.type) {
			case "carry":
				return {
					id: `carry-${i}`,
					type: "carry",
					object: {
						id: `carry-${i}-obj`,
						name: `Stub carry object ${i}`,
						examineDescription: `A stub carry object; place it at the carry-${i}-space.`,
						useOutcome: "Nothing happens.",
						placementFlavor: "{actor} sets it down carefully.",
						proximityFlavor: "Something draws your attention nearby.",
					},
					space: {
						id: `carry-${i}-space`,
						name: `Stub carry space ${i}`,
						examineDescription: `A stub destination space, awaiting delivery.`,
						proximityFlavor: "A quiet pull draws you toward this area.",
					},
				};
			case "use_space":
				return {
					id: `useSpace-${i}`,
					type: "use_space",
					space: {
						id: `useSpace-${i}-space`,
						name: `Stub use-space ${i}`,
						examineDescription: `A stub interactive surface — use the lever to activate it.`,
						proximityFlavor: "An activatable surface beckons.",
						activationFlavor: "The surface hums as you engage the lever.",
						satisfactionFlavor: "The surface settles into completion.",
						postExamineDescription:
							"The surface sits dormant after activation.",
						postLookFlavor: "The surface rests, purpose fulfilled.",
					},
				};
			case "use_item":
				return {
					id: `useItem-${i}`,
					type: "use_item",
					item: {
						id: `useItem-${i}-item`,
						name: `Stub use-item ${i}`,
						examineDescription: `A stub item — press the button to activate.`,
						proximityFlavor: "The item draws your eye.",
						useOutcome: "Nothing changes.",
						activationFlavor:
							"The item clicks into action as you press the button.",
						postExamineDescription: "The item sits used and inert.",
						postLookFlavor: "The item rests, spent.",
					},
				};
			case "convergence":
				return {
					id: `convergence-${i}`,
					type: "convergence",
					space: {
						id: `convergence-${i}-space`,
						name: `Stub convergence space ${i}`,
						examineDescription: `A stub gathering point — a meeting place where two are needed.`,
						proximityFlavor: "The space seems to anticipate company.",
						convergenceTier1Flavor: `A presence lingers at the convergence space.`,
						convergenceTier2Flavor: `Two presences converge at the space.`,
						convergenceTier1ActorFlavor: `You stand alone; the space awaits another presence.`,
						convergenceTier2ActorFlavor: `You share this space with another presence.`,
					},
				};
			default:
				throw new Error(`Unknown binding type: ${sk.type}`);
		}
	});

	const decoys = [
		{
			id: "decoy-0",
			name: "Stub decoy A",
			examineDescription: "A harmless stub item.",
			proximityFlavor: "Something inert nearby.",
			useOutcome: "Nothing happens.",
		},
		{
			id: "decoy-1",
			name: "Stub decoy B",
			examineDescription: "Another harmless stub item.",
			proximityFlavor: "Something inert nearby.",
			useOutcome: "Nothing happens.",
		},
	];

	const obstacles = Array.from({ length: obstacleCount }, (_, i) => ({
		id: `obstacle-${i}`,
		name: `Stub obstacle ${i}`,
		examineDescription: `A stub obstacle.`,
		shiftFlavor: `The obstacle grinds across the floor.`,
	}));

	return {
		setting,
		wallName: "stub boundary wall",
		bindings: builtBindings,
		decoys,
		obstacles,
	};
}

function buildBoundDualContentPackResponseBody(body: ParsedBody): string {
	const spec = parseDualBindingContentPackSpec(userMessageContent(body));
	const packA = buildBoundPack(
		spec.settingA,
		spec.bindings,
		spec.obstacleCount,
	);
	const packB = buildBoundPack(
		spec.settingB,
		spec.bindings,
		spec.obstacleCount,
	);
	const content = JSON.stringify({ phases: [{ packA, packB }] });
	return JSON.stringify({ choices: [{ message: { content } }] });
}

export function parseRequestBody(request: Request): ParsedBody {
	try {
		return JSON.parse(request.postData() ?? "null") as ParsedBody;
	} catch {
		return null;
	}
}

async function tryFulfillJsonMode(
	route: Parameters<Parameters<Page["route"]>[1]>[0],
	body: ParsedBody,
	blurbFor: (id: string) => string,
): Promise<boolean> {
	if (!isJsonModeRequest(body)) return false;
	const kind = classifyJsonRequest(body);
	const responseBody =
		kind === "synthesis"
			? buildSynthesisResponseBody(body, blurbFor)
			: kind === "dual-content-pack"
				? buildBoundDualContentPackResponseBody(body)
				: null;
	if (responseBody === null) {
		throw new Error(
			`stubs.ts: unrecognised JSON-mode /v1/chat/completions caller. ` +
				`User message preamble: ${userMessageContent(body).slice(0, 80)}`,
		);
	}
	await route.fulfill({
		status: 200,
		headers: { "Content-Type": "application/json" },
		body: responseBody,
	});
	return true;
}

export type SynthesisStubOptions = {
	blurb?: (id: string) => string;
};

export async function stubPersonaSynthesis(
	page: Page,
	options?: SynthesisStubOptions,
): Promise<void> {
	const blurbFor = options?.blurb ?? defaultStubBlurb;
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (await tryFulfillJsonMode(route, body, blurbFor)) return;
		await route.fallback();
	});
}

export type NewGameLLMOptions = {
	sse: string[] | WordsFactory;
	synthesis?: SynthesisStubOptions;
};

export async function stubNewGameLLM(
	page: Page,
	opts: NewGameLLMOptions,
): Promise<void> {
	const blurbFor = opts.synthesis?.blurb ?? defaultStubBlurb;
	const wordsOrFactory = opts.sse;

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (await tryFulfillJsonMode(route, body, blurbFor)) return;

		const words =
			typeof wordsOrFactory === "function"
				? await wordsOrFactory(request)
				: wordsOrFactory;
		await route.fulfill({
			status: 200,
			headers: SSE_HEADERS,
			body: messageToolCallToBlueSseBody(words),
		});
	});
}

export async function stubChatCompletions(
	page: Page,
	wordsOrFactory: string[] | WordsFactory,
): Promise<void> {
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (await tryFulfillJsonMode(route, body, defaultStubBlurb)) return;

		const words =
			typeof wordsOrFactory === "function"
				? await wordsOrFactory(request)
				: wordsOrFactory;

		await route.fulfill({
			status: 200,
			headers: SSE_HEADERS,
			body: messageToolCallToBlueSseBody(words),
		});
	});
}

export interface HeldChatCompletions {
	release(): void;
	requestCount(): number;
}

export async function holdChatCompletions(
	page: Page,
	matches: (body: ParsedBody) => boolean,
	{ holdFirst = Number.POSITIVE_INFINITY }: { holdFirst?: number } = {},
): Promise<HeldChatCompletions> {
	let requests = 0;
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (matches(parseRequestBody(request))) {
			requests++;
			if (requests <= holdFirst) await released;
		}
		await route.fallback();
	});
	return { release: () => release(), requestCount: () => requests };
}

const LONGEST_CONTENT_PACK_RETRY_BACKOFF_MS = 2_000;
const RETRY_BACKOFF_POLL_MS = 250;

export async function expectVisibleSkippingRetryBackoff(
	page: Page,
	locator: Locator,
	timeoutMs = 30_000,
): Promise<void> {
	await expect(async () => {
		await page.clock.fastForward(LONGEST_CONTENT_PACK_RETRY_BACKOFF_MS);
		await expect(locator).toBeVisible({ timeout: RETRY_BACKOFF_POLL_MS });
	}).toPass({ timeout: timeoutMs });
}

export function isDualContentPackRequest(body: ParsedBody): boolean {
	return classifyJsonRequest(body) === "dual-content-pack";
}

export function isGameplayRequest(body: ParsedBody): boolean {
	return !isJsonModeRequest(body);
}

export type GoToGameOptions = {
	sse?: string[] | WordsFactory;
	synthesis?: SynthesisStubOptions;
	url?: string;
};

export async function goToGame(
	page: Page,
	opts?: GoToGameOptions,
): Promise<AiHandles> {
	const sse = opts?.sse ?? ["stub reply"];
	await stubNewGameLLM(page, {
		sse,
		...(opts?.synthesis === undefined ? {} : { synthesis: opts.synthesis }),
	});
	await page.goto(withSkipDialup(opts?.url ?? "/"));
	await expect(page.locator("#begin")).toBeEnabled({
		timeout: STUBBED_NEW_GAME_TIMEOUT_MS,
	});
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: STUBBED_NEW_GAME_TIMEOUT_MS,
	});
	await expect(page.locator("#composer")).toBeVisible();
	return getAiHandles(page);
}

export async function reachEndgame(page: Page): Promise<AiHandles> {
	const handles = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});
	await page.fill("#prompt", `*${handles.names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	return handles;
}

function withSkipDialup(url: string): string {
	if (/[?&]skipDialup=/.test(url)) return url;
	const querySeparator = url.includes("?") ? "&" : "?";
	return `${url}${querySeparator}skipDialup=1`;
}

export function toolCallSseBody(
	name: string,
	args: Record<string, string>,
): string {
	const toolCallChunk = JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_e2e_tc",
							function: { name, arguments: JSON.stringify(args) },
						},
					],
				},
				finish_reason: null,
			},
		],
	});
	const finishChunk = JSON.stringify({
		choices: [{ delta: {}, finish_reason: "tool_calls" }],
	});
	return `data: ${toolCallChunk}\n\ndata: ${finishChunk}\n\ndata: [DONE]\n\n`;
}

export {
	deobfuscateEngineBlob,
	ENGINE_OBFUSCATION_KEY,
	obfuscateEngineBlob,
} from "./engine-blob.js";
export type {
	CardinalDirection,
	GridPosition,
	VistaCell,
} from "./vista-geometry.js";
export {
	CARDINAL_DIRECTIONS,
	inRoom,
	inVista,
	isGridPosition,
	listingLabels,
	positionsEqual,
	RELATIVE_DIRECTION_WORDS,
	sectionBetween,
	stepDelta,
	vistaCells,
} from "./vista-geometry.js";

export type EntityHolder = string | GridPosition;

export interface SealedEntity {
	id: string;
	kind: string;
	name: string;
	holder: EntityHolder;
	satisfactionState?: string;
}

export interface SealedContentPack {
	setting: string;
	wallName: string;
	entities?: SealedEntity[];
}

export interface SealedEngine {
	schemaVersion: number;
	personaSpatial: Record<string, { position: GridPosition }>;
	world: { entities: SealedEntity[] };
	contentPacksA: SealedContentPack[];
	contentPacksB: SealedContentPack[];
	activePackId: "A" | "B";
	weather?: string;
	complicationSchedule?: { countdown: number; settingShiftFired: boolean };
	activeComplications?: SealedComplication[];
	budgets?: Record<string, { total: number; remaining: number }>;
	isComplete?: boolean;
}

export interface SealedComplication {
	kind: string;
	target?: string;
	resolveAtRound?: number;
}

export interface SealedConversationEntry {
	kind: string;
	round: number;
	actor?: string;
	actionKind?: string;
	direction?: string;
	toolName?: string;
	success?: boolean;
	diskDelta?: string;
	content?: string;
	from?: string;
	to?: string;
}

export interface SealedDaemonFile {
	aiId: string;
	persona: { name: string };
	conversationLog: SealedConversationEntry[];
}

export function activePackOf(
	sealed: SealedEngine,
): SealedContentPack | undefined {
	const packs =
		sealed.activePackId === "B" ? sealed.contentPacksB : sealed.contentPacksA;
	return packs?.[0];
}

export function obstacleCellsOf(pack: SealedContentPack): GridPosition[] {
	return (pack.entities ?? [])
		.filter((entity) => entity.kind === "obstacle")
		.map((entity) => entity.holder)
		.filter(isGridPosition);
}

export async function readActiveSessionEngine(
	page: Page,
): Promise<{ sessionId: string; sealed: SealedEngine }> {
	const raw = await page.evaluate(
		({ activeKey, prefix }) => {
			const sessionId = localStorage.getItem(activeKey);
			if (sessionId === null) return null;
			const blob = localStorage.getItem(`${prefix}${sessionId}/engine.dat`);
			if (blob === null) return null;
			return { sessionId, blob };
		},
		{ activeKey: ACTIVE_SESSION_KEY, prefix: SESSIONS_PREFIX },
	);
	if (raw === null) {
		throw new Error("e2e: no active session engine.dat in localStorage");
	}
	return {
		sessionId: raw.sessionId,
		sealed: JSON.parse(deobfuscateEngineBlob(raw.blob)) as SealedEngine,
	};
}

export async function waitForActiveSessionEngine(
	page: Page,
): Promise<{ sessionId: string; sealed: SealedEngine }> {
	await expect
		.poll(async () => {
			try {
				await readActiveSessionEngine(page);
				return true;
			} catch {
				return false;
			}
		})
		.toBe(true);
	return readActiveSessionEngine(page);
}

export async function writeActiveSessionEngine(
	page: Page,
	sessionId: string,
	sealed: SealedEngine,
): Promise<void> {
	const value = obfuscateEngineBlob(JSON.stringify(sealed));
	await page.evaluate(
		({ key, blob }: { key: string; blob: string }) => {
			localStorage.setItem(key, blob);
		},
		{ key: sessionFileKey(sessionId, "engine.dat"), blob: value },
	);
}

export const COMPLICATION_COUNTDOWN_BEYOND_ANY_SPEC = 100;

export async function setComplicationCountdown(
	page: Page,
	countdown: number,
): Promise<void> {
	const { sessionId, sealed } = await readActiveSessionEngine(page);
	await writeActiveSessionEngine(page, sessionId, {
		...sealed,
		complicationSchedule: {
			countdown,
			settingShiftFired:
				sealed.complicationSchedule?.settingShiftFired ?? false,
		},
	});
	await page.reload();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#composer")).toBeVisible();
}

export async function readDaemonFile(
	page: Page,
	sessionId: string,
	aiId: string,
): Promise<SealedDaemonFile> {
	const raw = await page.evaluate(
		(key: string) => localStorage.getItem(key),
		sessionFileKey(sessionId, `${aiId}.txt`),
	);
	if (raw === null)
		throw new Error(`e2e: ${aiId}.txt not found in localStorage`);
	return JSON.parse(raw) as SealedDaemonFile;
}

export async function readActiveSessionFiles(page: Page): Promise<{
	meta: string;
	daemons: Record<string, string>;
	engineJson: string;
}> {
	const raw = await page.evaluate(
		({ activeKey, sessionsPrefix }) => {
			const sessionId = localStorage.getItem(activeKey) ?? "";
			const prefix = `${sessionsPrefix}${sessionId}/`;
			const daemons: Record<string, string> = {};
			let meta = "";
			let engine = "";
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key === null || !key.startsWith(prefix)) continue;
				const name = key.slice(prefix.length);
				const value = localStorage.getItem(key) ?? "";
				if (name === "meta.json") meta = value;
				else if (name === "engine.dat") engine = value;
				else if (name.endsWith(".txt")) daemons[name] = value;
			}
			return { meta, daemons, engine };
		},
		{ activeKey: ACTIVE_SESSION_KEY, sessionsPrefix: SESSIONS_PREFIX },
	);
	return {
		meta: raw.meta,
		daemons: raw.daemons,
		engineJson: raw.engine === "" ? "" : deobfuscateEngineBlob(raw.engine),
	};
}

export async function waitForRound(
	page: Page,
	sessionId: string,
	minimumRound: number,
	timeoutMs = 30_000,
): Promise<void> {
	await page.waitForFunction(
		({ metaKey, minimumRound: round }) => {
			const raw = localStorage.getItem(metaKey);
			if (raw === null) return false;
			try {
				const meta = JSON.parse(raw) as { round?: number };
				return (meta.round ?? 0) >= round;
			} catch {
				return false;
			}
		},
		{ metaKey: sessionFileKey(sessionId, "meta.json"), minimumRound },
		{ timeout: timeoutMs },
	);
}

export async function waitForFirstRoundSaved(
	page: Page,
	timeoutMs = 15_000,
): Promise<void> {
	await page.waitForFunction(
		({ activeKey, prefix }) => {
			const sessionId = localStorage.getItem(activeKey);
			if (!sessionId) return false;
			const metaRaw = localStorage.getItem(`${prefix}${sessionId}/meta.json`);
			if (!metaRaw) return false;
			try {
				const meta = JSON.parse(metaRaw) as { round?: number };
				return typeof meta.round === "number" && meta.round >= 1;
			} catch {
				return false;
			}
		},
		{ activeKey: ACTIVE_SESSION_KEY, prefix: SESSIONS_PREFIX },
		{ timeout: timeoutMs },
	);
}

export async function waitForSavedPosition(
	page: Page,
	sessionId: string,
	aiId: string,
	expectedPosition: GridPosition,
	timeoutMs = 30_000,
): Promise<void> {
	await page.waitForFunction(
		({
			engineKey,
			id,
			row,
			col,
			obfuscationKey,
		}: {
			engineKey: string;
			id: string;
			row: number;
			col: number;
			obfuscationKey: string;
		}) => {
			const blob = localStorage.getItem(engineKey);
			if (blob === null) return false;
			try {
				const keyBytes = new TextEncoder().encode(obfuscationKey);
				const binary = atob(blob);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) {
					bytes[i] =
						(binary.charCodeAt(i) & 0xff) ^
						(keyBytes[i % keyBytes.length] as number);
				}
				const sealed = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(bytes),
				) as { personaSpatial?: Record<string, { position?: GridPosition }> };
				const position = sealed.personaSpatial?.[id]?.position;
				return position?.row === row && position?.col === col;
			} catch {
				return false;
			}
		},
		{
			engineKey: sessionFileKey(sessionId, "engine.dat"),
			id: aiId,
			row: expectedPosition.row,
			col: expectedPosition.col,
			obfuscationKey: ENGINE_OBFUSCATION_KEY,
		},
		{ timeout: timeoutMs },
	);
}
