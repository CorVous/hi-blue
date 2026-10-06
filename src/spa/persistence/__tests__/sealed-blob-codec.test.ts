import { describe, expect, it } from "vitest";
import {
	deobfuscate,
	obfuscate,
	SealedBlobCorrupt,
} from "../sealed-blob-codec.js";

function blobBytes(blob: string): Uint8Array {
	return Uint8Array.from(atob(blob), (char) => char.charCodeAt(0));
}

function bytesToBlob(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

describe("sealed-blob-codec", () => {
	it("round-trips ASCII JSON", () => {
		const json = JSON.stringify({ hello: "world", num: 42 });
		expect(deobfuscate(obfuscate(json))).toBe(json);
	});

	it("round-trips multi-byte UTF-8 (emoji + accented chars)", () => {
		const json = JSON.stringify({ msg: "héllo 🌊 wörld 日本語" });
		expect(deobfuscate(obfuscate(json))).toBe(json);
	});

	it("output !== input (sanity: obfuscation changes the string)", () => {
		const json = JSON.stringify({ a: 1 });
		expect(obfuscate(json)).not.toBe(json);
	});

	it("output is base64-printable", () => {
		const json = JSON.stringify({ value: "test data here" });
		const blob = obfuscate(json);
		expect(blob).toMatch(/^[A-Za-z0-9+/=]*$/);
	});

	it("deobfuscate throws SealedBlobCorrupt on invalid base64", () => {
		expect(() => deobfuscate("not base64$$$")).toThrow(SealedBlobCorrupt);
	});

	it("deobfuscate throws SealedBlobCorrupt on corrupt base64 payload", () => {
		const json = JSON.stringify({ data: "hello" });
		const blob = obfuscate(json);
		const binary = atob(blob);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		bytes[bytes.length - 1] = 0xff;
		let corrupted = "";
		for (let i = 0; i < bytes.length; i++)
			corrupted += String.fromCharCode(bytes[i] as number);
		const corruptBlob = btoa(corrupted);
		expect(() => deobfuscate(corruptBlob)).toThrow(SealedBlobCorrupt);
	});

	it("deobfuscate throws SealedBlobCorrupt on a blob sealed with a different key", () => {
		const json = JSON.stringify({ secure: true });
		const bytes = blobBytes(obfuscate(json));
		const resealedWithOtherKey = bytesToBlob(bytes.map((byte) => byte ^ 0x80));
		expect(() => deobfuscate(resealedWithOtherKey)).toThrow(SealedBlobCorrupt);
	});

	it("a tamper that still decodes as UTF-8 comes back as altered text, not an error", () => {
		const json = JSON.stringify({ secure: true });
		const flippedIndex = json.indexOf("t");
		const bytes = blobBytes(obfuscate(json));
		bytes[flippedIndex] = (bytes[flippedIndex] as number) ^ 0x01;
		expect(deobfuscate(bytesToBlob(bytes))).toBe(
			`${json.slice(0, flippedIndex)}u${json.slice(flippedIndex + 1)}`,
		);
	});
});
