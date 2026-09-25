import type { Page } from "@playwright/test";

export type AiHandles = {
	ids: [string, string, string];
	names: [string, string, string];
	mention: (panelIndex: number) => string;
};

export function renderedPlayerLine(messageAfterMention: string): string {
	return `> ${messageAfterMention}`;
}

export async function getAiHandles(page: Page): Promise<AiHandles> {
	await page.waitForFunction(
		() => {
			const panels = Array.from(
				document.querySelectorAll<HTMLElement>("article.ai-panel"),
			);
			const personasSynthesized = panels.every(
				(p) => (p.dataset.ai ?? "").length > 0,
			);
			return panels.length === 3 && personasSynthesized;
		},
		{ timeout: 30_000 },
	);

	const result = await page.evaluate(() => {
		return Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		).map((p) => {
			const id = p.dataset.ai ?? "";
			const panelNameText =
				p.querySelector<HTMLElement>(".panel-name")?.textContent ?? "";
			const nameAfterMentionStar = /\*([A-Za-z0-9]+)/.exec(panelNameText)?.[1];
			return { id, name: nameAfterMentionStar ?? id };
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
		mention: (panelIndex: number) => `*${names[panelIndex] ?? ids[panelIndex]}`,
	};
}
