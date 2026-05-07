import type { Page } from "@playwright/test";

export type AiHandles = {
	ids: [string, string, string];
	names: [string, string, string];
	mention: (index: number) => string;
};

/**
 * Wait until 3 `article.ai-panel` elements have non-empty `data-ai` attributes
 * (set after persona synthesis completes) and return the DOM-order ids tuple.
 *
 * Also reads the persona display names from `.panel-name` (format: `*<name> :: @<name>`)
 * so callers can construct `@<name>` mention strings for the composer.
 *
 * @param page The Playwright Page to query.
 */
export async function getAiHandles(page: Page): Promise<AiHandles> {
	await page.waitForFunction(
		() => {
			const panels = Array.from(
				document.querySelectorAll<HTMLElement>("article.ai-panel"),
			);
			return (
				panels.length === 3 &&
				panels.every((p) => (p.dataset.ai ?? "").length > 0)
			);
		},
		{ timeout: 30_000 },
	);

	const result = await page.evaluate(() => {
		return Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		).map((p) => {
			const id = p.dataset.ai ?? "";
			// .panel-name text is: `*<name> :: @<name>`, extract the name after `@`
			const panelNameEl = p.querySelector<HTMLElement>(".panel-name");
			const raw = panelNameEl?.textContent ?? "";
			// Format: `*Ember :: @Ember` → extract after `@`
			const atMatch = /@([A-Za-z0-9]+)/.exec(raw);
			const name = atMatch?.[1] ?? id;
			return { id, name };
		});
	});

	if (result.length !== 3) {
		throw new Error(`Expected 3 ai-panel elements, got ${result.length}`);
	}

	const ids = result.map((r) => r.id) as [string, string, string];
	const names = result.map((r) => r.name) as [string, string, string];

	return {
		ids,
		names,
		mention: (index: number) => `@${names[index] ?? ids[index]}`,
	};
}
