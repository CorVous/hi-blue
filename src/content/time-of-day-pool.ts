/**
 * TIME_OF_DAY_POOL
 *
 * Noun phrases drawn once per phase.
 * Rendered as "It is {timeOfDay}." in the <setting> block.
 */
export const TIME_OF_DAY_POOL: readonly string[] = [
	"dawn",
	"early morning",
	"midday",
	"late afternoon",
	"dusk",
	"early evening",
	"midnight",
	"the small hours before dawn",
	"an overcast, starless night",
] as const;
