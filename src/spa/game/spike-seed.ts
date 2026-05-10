/**
 * Spike #239: deterministic seed plumbing.
 *
 * When `?seed=N` is set on the start screen, sub-streams of a single
 * Mulberry32 PRNG replace `Math.random` in:
 *   - persona generation (archetype selection from the pool)
 *   - content-pack generation (setting noun, item count/holders)
 *   - GameSession construction (initial spatial placement)
 *
 * Each consumer gets an independent Mulberry32 instance keyed by a
 * deterministic mix of the master seed and the consumer label, so
 * concurrent rng consumption (personas + content packs run as sibling
 * promises) doesn't introduce races.
 *
 * LLM-synthesised text (persona descriptions, content-pack item names) is
 * still non-deterministic — the spike accepts that as cosmetic variance
 * since the rng-driven structural choices are what dominate per-game
 * variance for the parallel-emission metric.
 *
 * Spike-only side channel: production sessions never set the seed, and the
 * `getSpikeRng()` accessor returns `null` so callers fall back to
 * `Math.random` exactly as before.
 */

let _spikeSeed: number | null = null;

export function setSpikeSeed(seed: number | null): void {
	_spikeSeed = seed;
}

export function getSpikeSeed(): number | null {
	return _spikeSeed;
}

export type SpikeRngLabel = "personas" | "contentPack" | "gameSession";

function hashLabel(label: string): number {
	// FNV-1a 32-bit. Deterministic, branchless, no deps.
	let h = 0x811c9dc5;
	for (let i = 0; i < label.length; i++) {
		h ^= label.charCodeAt(i);
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Return a deterministic Mulberry32 stream keyed by the master spike seed
 * XORed with a hash of the label. Returns null when no seed is set, so
 * callers can `?? Math.random` to preserve production behaviour.
 */
export function getSpikeRng(label: SpikeRngLabel): (() => number) | null {
	if (_spikeSeed === null) return null;
	const subSeed = (_spikeSeed ^ hashLabel(label)) >>> 0;
	return mulberry32(subSeed);
}
