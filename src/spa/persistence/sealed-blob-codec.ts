const OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

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

function xorBytes(bytes: Uint8Array): Uint8Array {
	const keyLen = KEY_BYTES.length;
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = (bytes[i] as number) ^ (KEY_BYTES[i % keyLen] as number);
	}
	return bytes;
}

function toIso88591(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		out += String.fromCharCode(bytes[i] as number);
	}
	return out;
}

function fromIso88591(s: string): Uint8Array {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) {
		out[i] = s.charCodeAt(i) & 0xff;
	}
	return out;
}

export function obfuscate(json: string): string {
	const bytes = encoder.encode(json);
	xorBytes(bytes);
	return btoa(toIso88591(bytes));
}

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
