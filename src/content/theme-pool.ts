/**
 * THEME_POOL
 *
 * Item-style theme drawn once per phase (with replacement) and used to flavor
 * objective pairs and interesting objects. Obstacles are unaffected by theme
 * — they remain setting-only.
 *
 * "mundane" is repeated to bias the draw toward ordinary items over the
 * technological / magical alternatives.
 */
export const THEME_POOL: readonly string[] = [
	"mundane",
	"mundane",
	"technological",
	"magical",
] as const;
