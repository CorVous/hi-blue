import type { ContentPack, WorldEntity } from "../../types.js";

export function makeTestPack(
	entities: WorldEntity[],
	overrides?: Partial<ContentPack>,
): ContentPack {
	const derived: ContentPack = {
		setting: "",
		weather: "",
		timeOfDay: "",
		entities: [...entities],
		wallName: "",
		aiStarts: {},
	};

	return { ...derived, ...overrides };
}
