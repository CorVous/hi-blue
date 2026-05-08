/**
 * Regression tests for the <=720px bento layout.
 *
 * Bug history:
 *   - `.ai-panel { flex: 1 1 0; width: 0 }` from the desktop flex row leaked
 *     into the bento grid context, collapsing every panel to 0px wide.
 *   - Strip-card transcript previewed the OLDEST messages (clipped at the
 *     bottom) and wrapped long messages onto multiple lines, hiding context.
 */
import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

test.use({ viewport: { width: 375, height: 667 } });

test("bento layout: panels have non-zero geometry inside their grid cells", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");

	const handles = await getAiHandles(page);

	// No-address: first panel should be the main, others strip cards.
	const noAddress = await page.evaluate(() => {
		const panels = Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		);
		return panels.map((p) => {
			const r = p.getBoundingClientRect();
			return { w: r.width, h: r.height, gridRow: getComputedStyle(p).gridRow };
		});
	});
	// Main panel (first child) spans both columns → ~viewport width.
	expect(noAddress[0]?.gridRow).toBe("1");
	expect(noAddress[0]?.w).toBeGreaterThan(300);
	expect(noAddress[0]?.h).toBeGreaterThan(200);
	// Strip cards must not be zero-width.
	expect(noAddress[1]?.gridRow).toBe("2");
	expect(noAddress[1]?.w).toBeGreaterThan(100);
	expect(noAddress[2]?.gridRow).toBe("2");
	expect(noAddress[2]?.w).toBeGreaterThan(100);

	// @-address middle panel → it becomes the main, others demote to strip.
	await page.locator("#prompt").fill(`${handles.mention(1)} hello`);
	await page.waitForFunction(
		() => document.querySelectorAll(".panel--addressed").length === 1,
	);
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
	expect(addressed[1]?.gridRow).toBe("1");
	expect(addressed[1]?.w).toBeGreaterThan(300);
	expect(addressed[1]?.h).toBeGreaterThan(200);
	expect(addressed[0]?.gridRow).toBe("2");
	expect(addressed[0]?.w).toBeGreaterThan(100);
	expect(addressed[2]?.gridRow).toBe("2");
	expect(addressed[2]?.w).toBeGreaterThan(100);
});

test("strip-card label: panel-name renders on the TOP edge, not the bottom", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");
	const handles = await getAiHandles(page);

	// Address middle panel so panels[0] and panels[2] are strip cards.
	await page.locator("#prompt").fill(`${handles.mention(1)} hello`);
	await page.waitForFunction(
		() => document.querySelectorAll(".panel--addressed").length === 1,
	);

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

	// Strip cards (indices 0 and 2): label on TOP, not on bottom.
	for (const idx of [0, 2]) {
		const l = labels[idx];
		if (!l) throw new Error(`no label probe for index ${idx}`);
		expect(l.addressed).toBe(false);
		expect(l.topVisible).toBe(true);
		expect(l.topText).toMatch(/^\*\S+ :: @\S+$/);
		expect(l.botVisible).toBe(false);
	}

	// Main panel (addressed): label still on bottom.
	const main = labels[1];
	if (!main) throw new Error("no main probe");
	expect(main.addressed).toBe(true);
	expect(main.topVisible).toBe(false);
	expect(main.botVisible).toBe(true);
	expect(main.botText).toMatch(/^\*\S+ :: @\S+$/);
});

test("strip-card preview: latest line visible + per-line ellipsis", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");

	const handles = await getAiHandles(page);

	// Address middle panel so panels[0] and panels[2] become strip cards.
	// Inject a transcript with many lines, including a wide one that would
	// otherwise wrap, into a strip-card panel.
	await page.locator("#prompt").fill(`${handles.mention(1)} hello`);
	await page.waitForFunction(
		() => document.querySelectorAll(".panel--addressed").length === 1,
	);

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

	// (a) Latest line is visible inside the .scroll viewport (not clipped off).
	expect(probe.lastText).toContain("LATEST_MARKER");
	expect(probe.lastRect).toBeTruthy();
	expect(probe.scrollRect).toBeTruthy();
	if (!probe.lastRect || !probe.scrollRect) throw new Error("no rects");
	expect(probe.lastRect.bottom).toBeLessThanOrEqual(
		probe.scrollRect.bottom + 1,
	);
	expect(probe.lastRect.bottom).toBeGreaterThan(probe.scrollRect.top);

	// (b) The wide line uses nowrap + ellipsis: it's exactly one line tall
	// and its scrollWidth (intrinsic) exceeds its rendered width (clipped).
	expect(probe.wideWhiteSpace).toBe("nowrap");
	expect(probe.wideTextOverflow).toBe("ellipsis");
	expect(probe.wideOverflow).toBe("hidden");
	if (!probe.wideRect) throw new Error("no wide rect");
	// One line of 11px font with line-height 1.45 ≈ 16px. Allow up to 22.
	expect(probe.wideRect.h).toBeLessThan(22);
	expect(probe.wideScrollWidth).toBeGreaterThan(probe.wideRect.w);

	// (c) Main panel keeps multi-line wrap behavior: its msg-lines compute
	// to white-space: pre-wrap, not nowrap.
	const mainWhiteSpace = await page.evaluate((aiId) => {
		const panel = document.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		// inject a line so we have one to inspect
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

test("strip-card preview: streamed AI tokens with embedded \\n stay in one msg-line", async ({
	page,
}) => {
	// Stream a multi-line AI response. Even though the SSE body emits two
	// hard \n characters mid-message, the entire AI message must collapse
	// into a single .msg-line so the strip-card preview shows one line.
	await stubChatCompletions(page, [
		"first line of message\nsecond line\nthird",
	]);
	await page.goto("/");
	const handles = await getAiHandles(page);

	// Send a message addressed to panel 0 so it streams there.
	await page.locator("#prompt").fill(`${handles.mention(0)} hi`);
	await page.locator("#send").click();

	// Wait for the response to land in panel 0's transcript.
	const transcript = page.locator(`[data-transcript="${handles.ids[0]}"]`);
	await expect(transcript).toContainText("third");

	const lineShape = await page.evaluate((aiId) => {
		const t = document.querySelector<HTMLElement>(
			`[data-transcript="${aiId}"]`,
		);
		const lines = Array.from(
			t?.querySelectorAll<HTMLElement>(".msg-line") ?? [],
		);
		// Find the AI message line (the one with .msg-prefix).
		const aiLine = lines.find((l) => l.querySelector(".msg-prefix"));
		return {
			lineCount: lines.length,
			aiLineText: aiLine?.textContent ?? "",
			// Total msg-lines that contain msg-prefix (= number of AI messages).
			aiMessageCount: lines.filter((l) => l.querySelector(".msg-prefix"))
				.length,
		};
	}, handles.ids[0]);

	// Exactly one AI message → exactly one msg-line for it.
	expect(lineShape.aiMessageCount).toBe(1);
	// All three lines of content are in that one msg-line.
	expect(lineShape.aiLineText).toContain("first line of message");
	expect(lineShape.aiLineText).toContain("second line");
	expect(lineShape.aiLineText).toContain("third");
});

test("mobile header: HI-BLUE title visible left, cog right; compact topinfo", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");
	await getAiHandles(page);

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
	// Title sits left of the cog.
	expect(probe.titleX).toBeLessThan(probe.cogX);
	expect(probe.titleW).toBeGreaterThan(0);
	// "BLUE" inner span is rendered with the blue color (#7fb6ff).
	expect(probe.blueColor).toBe("rgb(127, 182, 255)");

	// Compact topinfo replaces the long form on mobile.
	expect(probe.mobileVisible).toBe(true);
	expect(probe.leftHidden).toBe(true);
	expect(probe.rightHidden).toBe(true);
	// Format: "0xXXXX · 01/03 · TRN N" — assert structure with regex.
	expect(probe.mobileText).toMatch(/^0x[0-9A-F]{4} · \d{2}\/\d{2} · TRN \d+$/);
	// And it shouldn't include the desktop labels.
	expect(probe.mobileText).not.toContain("SESSION");
	expect(probe.mobileText).not.toContain("PHASE");
	expect(probe.mobileText).not.toContain("daemons");

	// "● stable" indicator visible on the right, in green.
	expect(probe.statusVisible).toBe(true);
	expect(probe.statusText.trim()).toBe("● stable");
	// .ok green: #8df27f → rgb(141, 242, 127)
	expect(probe.okColor).toBe("rgb(141, 242, 127)");
	// status sits to the right of the compact session/phase/turn text.
	expect(probe.statusLeft).toBeGreaterThanOrEqual(probe.mobileRight);
});
