import { expect, type Page, test } from "@playwright/test";
import { getAiHandles, goToGame, stubChatCompletions } from "./helpers";

test.use({ viewport: { width: 375, height: 667 } });

const MAIN_PANEL_GRID_ROW = "1";

const STRIP_CARD_GRID_ROW = "2";

const ONE_LINE_HEIGHT_CEILING_PX = 22;

const BANNER_BLUE_RGB = "rgb(127, 182, 255)";

const OK_GREEN_RGB = "rgb(141, 242, 127)";

async function promoteToMainPanel(page: Page, mention: string): Promise<void> {
	await page.locator("#prompt").fill(`${mention} hello`);
	await page.waitForFunction(
		() => document.querySelectorAll(".panel--addressed").length === 1,
	);
}

async function waitForDaemonConversationSaved(
	page: Page,
	aiId: string,
): Promise<void> {
	await page.waitForFunction(
		(addressedAiId) => {
			const sessionId = localStorage.getItem("hi-blue:active-session");
			if (!sessionId) return false;
			const daemonRaw = localStorage.getItem(
				`hi-blue:sessions/${sessionId}/${addressedAiId}.txt`,
			);
			if (!daemonRaw) return false;
			try {
				const daemon = JSON.parse(daemonRaw) as {
					conversationLog?: unknown[];
				};
				return (daemon.conversationLog?.length ?? 0) > 0;
			} catch {
				return false;
			}
		},
		aiId,
		{ timeout: 15_000 },
	);
}

test("bento layout: panels have non-zero geometry inside their grid cells", async ({
	page,
}) => {
	const handles = await goToGame(page, { sse: ["hi"] });

	const noAddress = await page.evaluate(() => {
		const panels = Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		);
		return panels.map((p) => {
			const r = p.getBoundingClientRect();
			return { w: r.width, h: r.height, gridRow: getComputedStyle(p).gridRow };
		});
	});
	expect(noAddress[0]?.gridRow).toBe(MAIN_PANEL_GRID_ROW);
	expect(noAddress[0]?.w).toBeGreaterThan(300);
	expect(noAddress[0]?.h).toBeGreaterThan(200);
	expect(noAddress[1]?.gridRow).toBe(STRIP_CARD_GRID_ROW);
	expect(noAddress[1]?.w).toBeGreaterThan(100);
	expect(noAddress[2]?.gridRow).toBe(STRIP_CARD_GRID_ROW);
	expect(noAddress[2]?.w).toBeGreaterThan(100);

	await promoteToMainPanel(page, handles.mention(1));
	const addressed = await page.evaluate(() => {
		const panels = Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		);
		return panels.map((p) => {
			const r = p.getBoundingClientRect();
			return {
				w: r.width,
				h: r.height,
				gridRow: getComputedStyle(p).gridRow,
				addressed: p.classList.contains("panel--addressed"),
			};
		});
	});
	expect(addressed[1]?.addressed).toBe(true);
	expect(addressed[1]?.gridRow).toBe(MAIN_PANEL_GRID_ROW);
	expect(addressed[1]?.w).toBeGreaterThan(300);
	expect(addressed[1]?.h).toBeGreaterThan(200);
	expect(addressed[0]?.gridRow).toBe(STRIP_CARD_GRID_ROW);
	expect(addressed[0]?.w).toBeGreaterThan(100);
	expect(addressed[2]?.gridRow).toBe(STRIP_CARD_GRID_ROW);
	expect(addressed[2]?.w).toBeGreaterThan(100);
});

test("strip-card label: panel-name renders on the TOP edge, not the bottom", async ({
	page,
}) => {
	const handles = await goToGame(page, { sse: ["hi"] });

	await promoteToMainPanel(page, handles.mention(1));

	const labels = await page.evaluate(() => {
		const all = Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		);
		return all.map((p) => {
			const top = p.querySelector<HTMLElement>(".brow-top .panel-name");
			const bot = p.querySelector<HTMLElement>(".brow-bot .panel-name");
			return {
				addressed: p.classList.contains("panel--addressed"),
				topVisible: top ? getComputedStyle(top).display !== "none" : false,
				topText: top?.textContent ?? "",
				botVisible: bot ? getComputedStyle(bot).display !== "none" : false,
				botText: bot?.textContent ?? "",
			};
		});
	});

	for (const idx of [0, 2]) {
		const l = labels[idx];
		if (!l) throw new Error(`no label probe for index ${idx}`);
		expect(l.addressed).toBe(false);
		expect(l.topVisible).toBe(true);
		expect(l.topText).toMatch(/^\*\S+$/);
		expect(l.botVisible).toBe(false);
	}

	const main = labels[1];
	if (!main) throw new Error("no main probe");
	expect(main.addressed).toBe(true);
	expect(main.topVisible).toBe(false);
	expect(main.botVisible).toBe(true);
	expect(main.botText).toMatch(/^\*\S+$/);
});

test("strip-card preview: latest line visible + per-line ellipsis", async ({
	page,
}) => {
	const handles = await goToGame(page, { sse: ["hi"] });

	await promoteToMainPanel(page, handles.mention(1));

	const stripId = handles.ids[0];
	await page.evaluate((aiId) => {
		const t = document.querySelector<HTMLElement>(
			`[data-transcript="${aiId}"]`,
		);
		if (!t) throw new Error("transcript not found");
		t.textContent = "";
		const lines = [
			"> *one alpha\n",
			"> *one bravo\n",
			"> *one charlie this message is much longer than the strip card width and would wrap onto a second visual line if nowrap+ellipsis weren't applied\n",
			"> *one delta\n",
			"> *one echo\n",
			"> *one foxtrot\n",
			"> *one golf\n",
			"> *one LATEST_MARKER\n",
		];
		for (const text of lines) {
			const div = document.createElement("div");
			div.className = "msg-line";
			div.textContent = text;
			t.appendChild(div);
		}
	}, stripId);

	const probe = await page.evaluate((aiId) => {
		const panel = document.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		const scroll = panel?.querySelector<HTMLElement>(".scroll");
		const lines = Array.from(
			panel?.querySelectorAll<HTMLElement>(".msg-line") ?? [],
		);
		const last = lines[lines.length - 1];
		const wide = lines.find((l) => l.textContent?.includes("charlie"));
		const scrollRect = scroll?.getBoundingClientRect();
		const lastRect = last?.getBoundingClientRect();
		const wideRect = wide?.getBoundingClientRect();
		const wideCs = wide ? getComputedStyle(wide) : null;
		return {
			scrollRect: scrollRect && {
				top: scrollRect.top,
				bottom: scrollRect.bottom,
				w: scrollRect.width,
			},
			lastText: last?.textContent ?? "",
			lastRect: lastRect && {
				top: lastRect.top,
				bottom: lastRect.bottom,
				w: lastRect.width,
			},
			wideText: wide?.textContent ?? "",
			wideRect: wideRect && {
				w: wideRect.width,
				h: wideRect.height,
			},
			wideWhiteSpace: wideCs?.whiteSpace ?? null,
			wideTextOverflow: wideCs?.textOverflow ?? null,
			wideOverflow: wideCs?.overflow ?? null,
			wideScrollWidth: wide?.scrollWidth ?? 0,
		};
	}, stripId);

	expect(probe.lastText).toContain("LATEST_MARKER");
	expect(probe.lastRect).toBeTruthy();
	expect(probe.scrollRect).toBeTruthy();
	if (!probe.lastRect || !probe.scrollRect) throw new Error("no rects");
	expect(probe.lastRect.bottom).toBeLessThanOrEqual(
		probe.scrollRect.bottom + 1,
	);
	expect(probe.lastRect.bottom).toBeGreaterThan(probe.scrollRect.top);

	expect(probe.wideWhiteSpace).toBe("nowrap");
	expect(probe.wideTextOverflow).toBe("ellipsis");
	expect(probe.wideOverflow).toBe("hidden");
	if (!probe.wideRect) throw new Error("no wide rect");
	expect(probe.wideRect.h).toBeLessThan(ONE_LINE_HEIGHT_CEILING_PX);
	expect(probe.wideScrollWidth).toBeGreaterThan(probe.wideRect.w);

	const mainWhiteSpace = await page.evaluate((aiId) => {
		const panel = document.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		const t = panel?.querySelector<HTMLElement>(".transcript");
		if (t) {
			const div = document.createElement("div");
			div.className = "msg-line";
			div.textContent = "main mode line\n";
			t.appendChild(div);
		}
		const line = panel?.querySelector<HTMLElement>(".msg-line:last-child");
		return line ? getComputedStyle(line).whiteSpace : null;
	}, handles.ids[1]);
	expect(mainWhiteSpace).toBe("pre-wrap");
});

test("strip-card preview: restored multi-line AI message stays in one msg-line", async ({
	page,
}) => {
	const handles = await goToGame(page, {
		sse: ["first line of saved msg\nsecond line\nthird"],
	});

	await page.locator("#prompt").fill(`${handles.mention(0)} hi`);
	await page.locator("#send").click();
	const transcript0 = page.locator(`[data-transcript="${handles.ids[0]}"]`);
	await expect(transcript0).toContainText("third");
	await waitForDaemonConversationSaved(page, handles.ids[0]);

	await page.reload();
	await stubChatCompletions(page, ["restubbed"]);
	await expect(page.locator("#composer")).toBeVisible();
	const handles2 = await getAiHandles(page);

	await promoteToMainPanel(page, handles2.mention(1));

	const restored = await page.evaluate((aiId) => {
		const t = document.querySelector<HTMLElement>(
			`[data-transcript="${aiId}"]`,
		);
		const lines = Array.from(
			t?.querySelectorAll<HTMLElement>(".msg-line") ?? [],
		);
		const aiLines = lines.filter((l) => l.querySelector(".msg-prefix"));
		const aiLine = aiLines[0];
		return {
			aiLineCount: aiLines.length,
			aiLineText: aiLine?.textContent ?? "",
			aiLineHeight: aiLine?.getBoundingClientRect().height ?? 0,
		};
	}, handles.ids[0]);

	expect(restored.aiLineCount).toBe(1);
	expect(restored.aiLineText).toContain("first line of saved msg");
	expect(restored.aiLineText).toContain("second line");
	expect(restored.aiLineText).toContain("third");
	expect(restored.aiLineHeight).toBeLessThan(ONE_LINE_HEIGHT_CEILING_PX);
});

test("strip-card preview: streamed AI tokens with embedded \\n stay in one msg-line", async ({
	page,
}) => {
	const handles = await goToGame(page, {
		sse: ["first line of message\nsecond line\nthird"],
	});

	await page.locator("#prompt").fill(`${handles.mention(0)} hi`);
	await page.locator("#send").click();

	const transcript = page.locator(`[data-transcript="${handles.ids[0]}"]`);
	await expect(transcript).toContainText("third");

	const lineShape = await page.evaluate((aiId) => {
		const t = document.querySelector<HTMLElement>(
			`[data-transcript="${aiId}"]`,
		);
		const lines = Array.from(
			t?.querySelectorAll<HTMLElement>(".msg-line") ?? [],
		);
		const aiLine = lines.find((l) => l.querySelector(".msg-prefix"));
		return {
			lineCount: lines.length,
			aiLineText: aiLine?.textContent ?? "",
			aiMessageCount: lines.filter((l) => l.querySelector(".msg-prefix"))
				.length,
		};
	}, handles.ids[0]);

	expect(lineShape.aiMessageCount).toBe(1);
	expect(lineShape.aiLineText).toContain("first line of message");
	expect(lineShape.aiLineText).toContain("second line");
	expect(lineShape.aiLineText).toContain("third");
});

test("mobile header: HI-BLUE title visible left, cog right; compact topinfo", async ({
	page,
}) => {
	await goToGame(page, { sse: ["hi"] });

	const probe = await page.evaluate(() => {
		const title = document.querySelector<HTMLElement>(".mobile-title");
		const blueSpan = title?.querySelector<HTMLElement>(".banner-blue");
		const cog = document.querySelector<HTMLElement>("#byok-cog");
		const titleRect = title?.getBoundingClientRect();
		const cogRect = cog?.getBoundingClientRect();
		const titleCs = title ? getComputedStyle(title) : null;
		const blueCs = blueSpan ? getComputedStyle(blueSpan) : null;
		const tMobile = document.querySelector<HTMLElement>("#topinfo-mobile");
		const tLeft = document.querySelector<HTMLElement>("#topinfo-left");
		const tRight = document.querySelector<HTMLElement>("#topinfo-right");
		const tStatus = document.querySelector<HTMLElement>(
			"#topinfo-mobile-status",
		);
		const okSpan = tStatus?.querySelector<HTMLElement>(".ok");
		const okCs = okSpan ? getComputedStyle(okSpan) : null;
		const mobileRect = tMobile?.getBoundingClientRect();
		const statusRect = tStatus?.getBoundingClientRect();
		return {
			titleVisible: titleCs?.display !== "none",
			titleText: title?.textContent ?? "",
			titleX: titleRect?.x ?? -1,
			titleW: titleRect?.width ?? 0,
			cogX: cogRect?.x ?? -1,
			blueColor: blueCs?.color ?? null,
			mobileVisible: tMobile
				? getComputedStyle(tMobile).display !== "none"
				: false,
			mobileText: tMobile?.textContent ?? "",
			mobileRight: mobileRect?.right ?? 0,
			leftHidden: tLeft ? getComputedStyle(tLeft).display === "none" : false,
			rightHidden: tRight ? getComputedStyle(tRight).display === "none" : false,
			statusVisible: tStatus
				? getComputedStyle(tStatus).display !== "none"
				: false,
			statusText: tStatus?.textContent ?? "",
			statusLeft: statusRect?.x ?? 0,
			okColor: okCs?.color ?? null,
		};
	});

	expect(probe.titleVisible).toBe(true);
	expect(probe.titleText).toBe("HI-BLUE");
	expect(probe.titleX).toBeLessThan(probe.cogX);
	expect(probe.titleW).toBeGreaterThan(0);
	expect(probe.blueColor).toBe(BANNER_BLUE_RGB);

	expect(probe.mobileVisible).toBe(true);
	expect(probe.leftHidden).toBe(true);
	expect(probe.rightHidden).toBe(true);
	expect(probe.mobileText).toMatch(/^0x[0-9A-F]{4} · EPC \d{2} · TRN \d+$/);
	expect(probe.mobileText).not.toContain("SESSION");
	expect(probe.mobileText).not.toContain("PHASE");
	expect(probe.mobileText).not.toContain("daemons");

	expect(probe.statusVisible).toBe(true);
	expect(probe.statusText.trim()).toBe("● stable");
	expect(probe.okColor).toBe(OK_GREEN_RGB);
	expect(probe.statusLeft).toBeGreaterThanOrEqual(probe.mobileRight);
});
