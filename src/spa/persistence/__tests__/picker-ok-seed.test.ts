import { describe, expect, it } from "vitest";
import {
	pickerOkSessionFiles,
	pickerOkSessionSeedScript,
} from "../../../../e2e/helpers/picker-seeds.js";
import { deobfuscate } from "../sealed-blob-codec.js";
import {
	deserializeSession,
	SESSION_SCHEMA_VERSION,
} from "../session-codec.js";
import { getSessionInfo } from "../session-storage.js";

const SESSION_ID = "0xAAAA";
const LAST_SAVED_AT = "2025-03-01T10:00:00.000Z";

function seededFilesFor(lastSavedAt: string): {
	meta: string;
	daemons: Record<string, string>;
	engine: string;
} {
	const files = pickerOkSessionFiles(lastSavedAt);
	const meta = files["meta.json"];
	const engine = files["engine.dat"];
	if (meta === undefined || engine === undefined) {
		throw new Error("picker ok seed must write meta.json and engine.dat");
	}
	const daemons: Record<string, string> = {};
	for (const [name, content] of Object.entries(files)) {
		if (name.endsWith(".txt")) daemons[name.slice(0, -".txt".length)] = content;
	}
	return { meta, daemons, engine };
}

describe("sessions-picker ok seed", () => {
	it("seals the seed at the live session schema", () => {
		const { engine } = seededFilesFor(LAST_SAVED_AT);
		const sealed = JSON.parse(deobfuscate(engine)) as { schemaVersion: number };
		expect(
			sealed.schemaVersion,
			"the picker's ok seed must be stamped at the live session schema",
		).toBe(SESSION_SCHEMA_VERSION);
	});

	it("deserializes the seeded bytes as current (kind: ok)", () => {
		const result = deserializeSession(seededFilesFor(LAST_SAVED_AT));
		expect(result.kind).toBe("ok");
	});

	it("seeds a row getSessionInfo reports as ok", () => {
		const seed = new Function(
			pickerOkSessionSeedScript(SESSION_ID, LAST_SAVED_AT),
		) as () => void;
		seed();

		const info = getSessionInfo(SESSION_ID);
		expect(info.kind).toBe("ok");
		expect(info.daemonFiles.map((file) => file.name)).toEqual(["red.txt"]);
	});
});
