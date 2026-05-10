/**
 * WEATHER_POOL
 *
 * Complete atmospheric sentences drawn once per phase.
 * Rendered directly into the <setting> block of the system prompt.
 */
export const WEATHER_POOL: readonly string[] = [
	"Heavy rain is falling.",
	"A light drizzle coats every surface.",
	"Dense fog has settled in.",
	"A biting wind cuts through the air.",
	"The skies are overcast and grey.",
	"Sweltering heat clings to everything.",
	"An electrical storm crackles in the distance.",
	"Dead calm — not a breath of air stirs.",
	"Light snow drifts down.",
	"Heavy snow is falling.",
	"Hail rattles against every surface.",
	"A fine, gritty dust hangs suspended in the air.",
] as const;
