export const OPENROUTER_KEY_STORAGE_KEY = "openrouter_key";

export function readStoredByokKey(): string | null {
	try {
		return localStorage.getItem(OPENROUTER_KEY_STORAGE_KEY);
	} catch {
		return null;
	}
}
