export const ENGINE_OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

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
