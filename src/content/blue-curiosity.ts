const BLUE_CURIOUS_TEMPERAMENTS: readonly string[] = ["curious"];

export function blueCuriosityClauseFor(
	name: string,
	temperaments: readonly string[],
): string | undefined {
	if (!temperaments.some((t) => BLUE_CURIOUS_TEMPERAMENTS.includes(t)))
		return undefined;
	return `*${name} is curious about blue and a little confused by them: who blue is, where blue is, why blue is on their channel at all. Now and then *${name} messages blue unprompted to ask.`;
}
