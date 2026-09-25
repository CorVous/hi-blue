const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;
const UINT32_RANGE = 2 ** 32;

let masterSpikeSeed: number | null = null;

export function setSpikeSeed(seed: number | null): void {
	masterSpikeSeed = seed;
}

export type SpikeRngLabel = "personas" | "contentPack" | "gameSession";

function fnv1aHash32(label: string): number {
	let h = FNV1A_32_OFFSET_BASIS;
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
		return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
	};
}

export function getSpikeRng(label: SpikeRngLabel): (() => number) | null {
	if (masterSpikeSeed === null) return null;
	const subSeed = (masterSpikeSeed ^ fnv1aHash32(label)) >>> 0;
	return mulberry32(subSeed);
}
