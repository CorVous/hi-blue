/**
 * makeTestPack — entity-first fixture helper for ContentPack literals in tests.
 *
 * Tests usually want to express "here are the entities in this pack" without
 * concerning themselves with the surrounding scaffolding (landmarks, wallName,
 * aiStarts, ambient draws). This helper takes a flat `WorldEntity[]` plus
 * optional pack overrides and produces a fully-typed `ContentPack`.
 *
 * Since the v11 schema flip (#462), `ContentPack` itself holds a flat
 * `entities` array — so this helper is a thin shim: it copies the entity list
 * onto `pack.entities`, then merges any caller overrides on top.
 *
 * Insertion order is preserved.
 */
import { DEFAULT_LANDMARKS } from "../../direction.js";
import type { ContentPack, WorldEntity } from "../../types.js";

/**
 * Builds a fully-typed ContentPack from a flat list of WorldEntities.
 *
 * @param entities  Flat entity list. Order preserved into `pack.entities`.
 * @param overrides Optional partial overrides merged on top of the derived
 *                  pack. Any field you pass here wins (including `entities`
 *                  itself — useful when a test wants to inject malformed
 *                  shapes that the helper would otherwise reject).
 */
export function makeTestPack(
	entities: WorldEntity[],
	overrides?: Partial<ContentPack>,
): ContentPack {
	const derived: ContentPack = {
		setting: "",
		weather: "",
		timeOfDay: "",
		entities: [...entities],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "",
		aiStarts: {},
	};

	return { ...derived, ...overrides };
}
