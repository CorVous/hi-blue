/**
 * SETTING_POOL
 *
 * Hand-authored noun phrases used as per-phase setting descriptors.
 * Three are drawn without replacement at game start (one per phase).
 *
 * Size: 6 (within the [5, 10] AC constraint).
 */
export const SETTING_POOL: readonly string[] = [
	"abandoned subway station",
	"sun-baked salt flat",
	"forgotten laboratory",
	"moonlit greenhouse ruin",
	"stripped server vault",
	"tide-flooded boardwalk",
	"humid and dense bog",
	"library overflowing with books",
	"throne room of a pagoda",
] as const;
