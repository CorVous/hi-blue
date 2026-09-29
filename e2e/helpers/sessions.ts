import type { Page } from "@playwright/test";
import { pickerOkSessionFiles } from "./picker-seeds.js";

export const ACTIVE_SESSION_KEY = "hi-blue:active-session";
export const SESSIONS_PREFIX = "hi-blue:sessions/";
export const ARCHIVE_PREFIX = "hi-blue:archive/";

const SEEDED_SESSION_SAVED_AT = "2025-02-01T10:00:00.000Z";

export function sessionDir(sessionId: string): string {
	return `${SESSIONS_PREFIX}${sessionId}/`;
}

export function sessionFileKey(sessionId: string, fileName: string): string {
	return `${sessionDir(sessionId)}${fileName}`;
}

export function activeSessionId(page: Page): Promise<string | null> {
	return page.evaluate((key) => localStorage.getItem(key), ACTIVE_SESSION_KEY);
}

export async function requireActiveSessionId(page: Page): Promise<string> {
	const id = await activeSessionId(page);
	if (id === null) throw new Error("e2e: no active session");
	return id;
}

export function listSessionIds(
	page: Page,
	prefix: string = SESSIONS_PREFIX,
): Promise<string[]> {
	return page.evaluate((storagePrefix) => {
		const ids = new Set<string>();
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith(storagePrefix)) continue;
			const id = key.slice(storagePrefix.length).split("/")[0];
			if (id) ids.add(id);
		}
		return [...ids].sort();
	}, prefix);
}

export async function seedOkSession(
	page: Page,
	sessionId: string,
	lastSavedAt: string = SEEDED_SESSION_SAVED_AT,
): Promise<void> {
	const keyedFiles: [string, string][] = Object.entries(
		pickerOkSessionFiles(lastSavedAt),
	).map(([fileName, content]) => [
		sessionFileKey(sessionId, fileName),
		content,
	]);
	await page.evaluate((files) => {
		for (const [key, content] of files) localStorage.setItem(key, content);
	}, keyedFiles);
}
