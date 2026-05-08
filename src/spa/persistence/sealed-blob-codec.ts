/**
 * sealed-blob-codec.ts
 *
 * XOR-based obfuscation for engine.dat blobs.
 *
 * Goal: raise the bar for accidental editing (not real encryption).
 * The OBFUSCATION_KEY is a constant in the bundle — a determined player
 * can extract it. That is acceptable; the threat model is "curious player
 * edits engine.dat and bricks the simulation", not a security boundary.
 *
 * Algorithm:
 *   obfuscate(json)  → btoa(toIso88591(xor(TextEncoder(json), KEY)))
 *   deobfuscate(b64) → TextDecoder(utf-8, fatal)(xor(fromIso88591(atob(b64)), KEY))
 *
 * See docs/adr/0005-engine-dat-obfuscation-method.md.
 */

const OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

/**
 * Thrown by `deobfuscate` when the blob is not valid base64 or the
 * XOR'd bytes are not valid UTF-8.
 */
export class SealedBlobCorrupt extends Error {
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "SealedBlobCorrupt";
		if (cause !== undefined) {
			this.cause = cause;
		}
	}
}

const encoder = new TextEncoder();
const KEY_BYTES = encoder.encode(OBFUSCATION_KEY);

/**
 * XOR `bytes` with the cycling OBFUSCATION_KEY bytes in-place and return
 * the same Uint8Array (mutation is fine; callers own the buffer).
 */
function xorBytes(bytes: Uint8Array): Uint8Array {
	const keyLen = KEY_BYTES.length;
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = (bytes[i] as number) ^ (KEY_BYTES[i % keyLen] as number);
	}
	return bytes;
}

/**
 * Convert a Uint8Array to a binary string (iso-8859-1 identity mapping)
 * suitable for passing to `btoa`.
 */
function toIso88591(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		out += String.fromCharCode(bytes[i] as number);
	}
	return out;
}

/**
 * Convert an iso-8859-1 binary string (output of `atob`) back to Uint8Array.
 */
function fromIso88591(s: string): Uint8Array {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) {
		out[i] = s.charCodeAt(i) & 0xff;
	}
	return out;
}

/**
 * Obfuscate a JSON string into a base64 blob suitable for storing in engine.dat.
 */
export function obfuscate(json: string): string {
	const bytes = encoder.encode(json);
	xorBytes(bytes);
	return btoa(toIso88591(bytes));
}

/**
 * Reverse `obfuscate`. Throws `SealedBlobCorrupt` if the blob is invalid
 * base64 or the resulting bytes are not valid UTF-8.
 */
export function deobfuscate(blob: string): string {
	let binary: string;
	try {
		binary = atob(blob);
	} catch (err) {
		throw new SealedBlobCorrupt("engine.dat: invalid base64", err);
	}
	const bytes = fromIso88591(binary);
	xorBytes(bytes);
	try {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		return decoder.decode(bytes);
	} catch (err) {
		throw new SealedBlobCorrupt("engine.dat: UTF-8 decode failed", err);
	}
}
