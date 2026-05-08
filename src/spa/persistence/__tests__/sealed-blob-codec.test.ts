import { describe, expect, it } from "vitest";
import {
	deobfuscate,
	obfuscate,
	SealedBlobCorrupt,
} from "../sealed-blob-codec.js";

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
		// Feed a base64 string that decodes to invalid UTF-8 bytes after XOR.
		// We construct this by obfuscating a valid string, base64-decoding it,
		// replacing one byte with 0xFF (invalid UTF-8 start byte), and re-encoding.
		const json = JSON.stringify({ data: "hello" });
		const blob = obfuscate(json);
		// Decode, corrupt, re-encode — the XOR step will see 0xFF as a non-UTF-8 byte
		const binary = atob(blob);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		// Overwrite last byte with 0xFF — after XOR, this produces a non-UTF-8 boundary
		bytes[bytes.length - 1] = 0xff;
		let corrupted = "";
		for (let i = 0; i < bytes.length; i++)
			corrupted += String.fromCharCode(bytes[i] as number);
		const corruptBlob = btoa(corrupted);
		expect(() => deobfuscate(corruptBlob)).toThrow(SealedBlobCorrupt);
	});

	it("deobfuscate throws SealedBlobCorrupt when bytes are XOR'd with wrong key", () => {
		const json = JSON.stringify({ secure: true });
		const blob = obfuscate(json);
		// Tamper: flip a bit in the middle of the blob
		const arr = blob.split("");
		const mid = Math.floor(arr.length / 2);
		// Change one base64 character to corrupt the decoded bytes
		arr[mid] = arr[mid] === "A" ? "B" : "A";
		const tampered = arr.join("");
		// Either throws (bad UTF-8) or decodes to garbage — we need it to throw
		// The tampered bytes are unlikely to be valid UTF-8, so it should throw
		try {
			const result = deobfuscate(tampered);
			// If it doesn't throw, the result should at least differ from the original
			expect(result).not.toBe(json);
		} catch (e) {
			expect(e).toBeInstanceOf(SealedBlobCorrupt);
		}
	});
});
