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
			leftHidden: tLeft ? getComputedStyle(tLeft).display === "none" : false,
			rightHidden: tRight ? getComputedStyle(tRight).display === "none" : false,
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
});
