/**
 * XOR obfuscation of `engine.dat`, mirrored from
 * `src/spa/persistence/sealed-blob-codec.ts`.
 *
 * The blob is obfuscated, not encrypted, and specs need to read (and
 * occasionally seed) persisted engine state, so the codec is mirrored here
 * rather than importing the SPA module. It lives in this leaf module — with no
 * Playwright dependency — so session fixtures under `e2e/helpers/` can seal a
 * payload that a unit test can run back through the real codec.
 */

/** XOR obfuscation key for `engine.dat`. */
export const ENGINE_OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

/** Reverse the engine.dat obfuscation. Mirrors `deobfuscate` in the codec. */
export function deobfuscateEngineBlob(blob: string): string {
	const keyBytes = new TextEncoder().encode(ENGINE_OBFUSCATION_KEY);
	const binary = atob(blob);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] =
			(binary.charCodeAt(i) & 0xff) ^ (keyBytes[i % keyBytes.length] as number);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Apply the engine.dat obfuscation. Mirrors `obfuscate` in the codec. */
export function obfuscateEngineBlob(json: string): string {
	const keyBytes = new TextEncoder().encode(ENGINE_OBFUSCATION_KEY);
	const bytes = new TextEncoder().encode(json);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = (bytes[i] as number) ^ (keyBytes[i % keyBytes.length] as number);
	}
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary);
}
