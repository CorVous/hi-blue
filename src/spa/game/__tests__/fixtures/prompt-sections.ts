export function cardinalClause(prompt: string): string {
	const settingBlock = /<setting>([\s\S]*?)<\/setting>/.exec(prompt)?.[1] ?? "";
	return (
		settingBlock
			.split("\n")
			.find((line) => /\bnorth\b/.test(line) && /\bsouth\b/.test(line)) ?? ""
	);
}
