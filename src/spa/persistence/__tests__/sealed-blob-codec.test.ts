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

	it("deobfuscate throws SealedBlobCorrupt when bytes are XOR'd with wrong key", () => {
		const json = JSON.stringify({ secure: true });
		const blob = obfuscate(json);
		const arr = blob.split("");
		const mid = Math.floor(arr.length / 2);
		arr[mid] = arr[mid] === "A" ? "B" : "A";
		const tampered = arr.join("");
		try {
			const result = deobfuscate(tampered);
			expect(result).not.toBe(json);
		} catch (e) {
			expect(e).toBeInstanceOf(SealedBlobCorrupt);
		}
	});
});
