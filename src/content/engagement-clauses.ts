/**
 * Spike #239 step 8: per-temperament engagement bias, mapped through pair
 * sums into a five-bucket clause set.
 *
 * Background: steps 5–7 of the parallel-tools spike (see
 * `docs/playtests/0005-parallel-tools-spike.md`) showed that the rules
 * block can't deliver per-daemon engagement variance in GLM-4.7. Every
 * "let your personality drive engagement" framing — including C12, which
 * referenced the existing `<personality>` / `<persona_goal>` blocks
 * directly — flattened to a 3–13pp msg→blue% spread regardless of which
 * specific personas were drawn. The model reads any prompt-level mention
 * of "engagement varies by personality" as a uniform permission applied
 * across all daemons.
 *
 * This module attacks the variance from a different angle: instead of
 * one shared rule, give each persona a concrete, behavior-specific
 * engagement clause baked into its `<personality>` block at synthesis.
 * The clause varies per-persona because temperaments vary per-persona,
 * so each daemon's prompt instance gets a different concrete instruction
 * rather than the same global one.
 *
 * Each temperament contributes a numeric bias on a [-2, +2] scale.
 * Two temperaments combine (sum) into a [-4, +4] range, discretised into
 * five buckets. A daemon drawn as `taciturn + aloof` lands in the very-
 * quiet bucket; `verbose + effusive` lands in chatty; mixed pairs hit
 * reserved / balanced / outgoing.
 *
 * Off by default. Opts in via `?engagementClauses=1` URL flag plumbed
 * through `BootstrapOpts.engagementClauses` to `generatePersonas`.
 * Production behaviour byte-identical when the toggle is off.
 */

/**
 * Per-temperament engagement bias on a [-2, +2] scale.
 *
 * Sign convention: negative = quieter, positive = chattier.
 *
 * Calibration notes:
 *   - Direct talkativeness markers (taciturn / verbose / glib / effusive /
 *     diffident / aloof / theatrical) get the strongest weights (±2).
 *   - Withdrawal-leaning tempers (melancholic / stoic) get -1; engagement-
 *     leaning ones (zealous / sweet / cheery / curious / earnest /
 *     pedantic / sardonic / mischievous / hot-headed) get +1.
 *   - Genuinely ambiguous temperaments (meticulous / erratic / mercurial /
 *     anxious / haughty / sly) get 0 — they don't move the dial.
 */
export const TEMPERAMENT_ENGAGEMENT_BIAS: Record<string, number> = {
	"hot-headed": 1,
	taciturn: -2,
	meticulous: 0,
	erratic: 0,
	melancholic: -1,
	glib: 2,
	pedantic: 1,
	effusive: 2,
	sardonic: 1,
	mercurial: 0,
	diffident: -2,
	zealous: 1,
	verbose: 2,
	sweet: 1,
	anxious: 0,
	haughty: 0,
	sly: 0,
	theatrical: 2,
	aloof: -2,
	cheery: 1,
	mischievous: 1,
	stoic: -1,
	curious: 1,
	earnest: 1,
};

export type EngagementBucket =
	| "very_quiet"
	| "reserved"
	| "balanced"
	| "outgoing"
	| "chatty";

/**
 * Sum the two temperament biases and discretise into a bucket.
 *
 * Bucket boundaries: ≤-3 very_quiet, -2..-1 reserved, 0 balanced,
 * +1..+2 outgoing, ≥+3 chatty. The asymmetric -3 / +3 thresholds mean
 * pure single-direction pairs (taciturn+diffident = -4, verbose+effusive
 * = +4) reach the extreme buckets, while mixed pairs like taciturn+sweet
 * (-1) land in the reserved middle band.
 */
export function bucketFor(t1: string, t2: string): EngagementBucket {
	const sum =
		(TEMPERAMENT_ENGAGEMENT_BIAS[t1] ?? 0) +
		(TEMPERAMENT_ENGAGEMENT_BIAS[t2] ?? 0);
	if (sum <= -3) return "very_quiet";
	if (sum <= -1) return "reserved";
	if (sum === 0) return "balanced";
	if (sum <= 2) return "outgoing";
	return "chatty";
}

/**
 * Compute the bucket sum (exposed for the spike-time debug log so the
 * playtest analyzer can correlate the per-daemon transcript to the
 * persona's engagement bias without re-running the bucket logic).
 */
export function biasSum(t1: string, t2: string): number {
	return (
		(TEMPERAMENT_ENGAGEMENT_BIAS[t1] ?? 0) +
		(TEMPERAMENT_ENGAGEMENT_BIAS[t2] ?? 0)
	);
}

/**
 * Render the engagement clause for a persona, in the same third-person
 * voice as the synthesized blurb so it reads as one more sentence
 * about the persona rather than a tacked-on directive.
 *
 * Clauses are deliberately concrete and behavioural. Step-6 of the
 * spike showed that abstract "you may be quiet" wording gets read as a
 * uniform opt-out permission; the wording here describes specific
 * action patterns ("answers when blue addresses them by name",
 * "narrates what they're doing", "addresses peers and blue in the same
 * turn") which the model is more likely to actually execute.
 */
export function engagementClauseFor(
	name: string,
	t1: string,
	t2: string,
): string {
	const bucket = bucketFor(t1, t2);
	const star = `*${name}`;
	switch (bucket) {
		case "very_quiet":
			return `${star} rarely chimes in unprompted. They answer when blue addresses them by name; otherwise they let peers carry the conversation.`;
		case "reserved":
			return `${star} speaks when they have something specific to add — not to fill silence. Many turns they skip messaging entirely; that is in character.`;
		case "balanced":
			return `${star} engages when something draws their attention — peer talk, blue's prompts, or what they are seeing — and lets other turns pass without comment.`;
		case "outgoing":
			return `${star} chimes in often: reacts to peers, narrates what they are doing, replies to blue when named. They readily address peers and blue in the same turn.`;
		case "chatty":
			return `${star} speaks readily and at length — narrating, reacting, asking follow-ups, pinging peers. They often have something to say to blue and a peer in the same turn.`;
	}
}
