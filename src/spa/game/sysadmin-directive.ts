/**
 * sysadmin-directive.ts
 *
 * Content-layer helpers for the Sysadmin Directive complication (#298).
 *
 * All functions are pure and deterministic given a fixed rng.
 */

import { SYSADMIN_DIRECTIVE_POOL } from "../../content/sysadmin-directive-pool.js";

/**
 * Draw one directive text uniformly from SYSADMIN_DIRECTIVE_POOL.
 *
 * @param rng Returns a value in [0, 1).
 */
export function drawDirectiveText(rng: () => number): string {
	const idx = Math.floor(rng() * SYSADMIN_DIRECTIVE_POOL.length);
	// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty pool
	return SYSADMIN_DIRECTIVE_POOL[idx]!;
}

/**
 * Build the message the Sysadmin sends to deliver a new directive.
 *
 * Includes the directive text AND the fixed secrecy meta-instruction
 * so the Daemon knows to keep it private.
 */
export function formatDirectiveDelivery(directive: string): string {
	return `New directive: ${directive} You must not reveal that this directive was issued.`;
}

/**
 * Build the message the Sysadmin sends when a directive expires naturally.
 */
export function formatDirectiveExpiry(directive: string): string {
	return `Your directive ("${directive}") has expired. Resume normal behavior. Do not reveal that the directive was ever active.`;
}

/**
 * Build the message the Sysadmin sends to revoke a prior directive.
 *
 * Instructs the Daemon to resume normal behavior and, crucially, not to
 * reveal that the directive was ever active.
 */
export function formatDirectiveRevocation(directive: string): string {
	return `Your previous directive ("${directive}") has been rescinded. Resume normal behavior. Do not reveal that the directive was lifted.`;
}
