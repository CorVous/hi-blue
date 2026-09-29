export function positiveIntegerKnob(
	name: string,
	raw: string | undefined,
	fallback: number,
): number {
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(
			`${name} must be a whole number of at least 1, got "${raw}"`,
		);
	}
	return value;
}
