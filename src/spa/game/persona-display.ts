/**
 * Tiny display-name helpers for persona objects.
 * Isolates access patterns so PRD #120 can extend display logic later.
 */

/**
 * Returns the display name of a persona.
 */
export function displayName(persona: { name: string }): string {
	return persona.name;
}

/**
 * Returns the inline error text shown when a player tries to message
 * a persona that is currently chat-locked.
 */
export function lockoutErrorText(persona: { name: string }): string {
	return `${displayName(persona)} isn't reading right now`;
}
