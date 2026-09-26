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

export function bucketFor(t1: string, t2: string): EngagementBucket {
	const sum = biasSum(t1, t2);
	if (sum <= -3) return "very_quiet";
	if (sum <= -1) return "reserved";
	if (sum === 0) return "balanced";
	if (sum <= 2) return "outgoing";
	return "chatty";
}

export function biasSum(t1: string, t2: string): number {
	return (
		(TEMPERAMENT_ENGAGEMENT_BIAS[t1] ?? 0) +
		(TEMPERAMENT_ENGAGEMENT_BIAS[t2] ?? 0)
	);
}

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
