/**
 * The session schema version this build reads and writes.
 *
 * It lives in this leaf module (which imports nothing) rather than in
 * `session-codec.ts` so that `version-boundary.ts` can read it without
 * importing the codec — the codec imports the boundary helpers, so reading it
 * from there would form an import cycle. `session-codec.ts` re-exports this
 * constant, so existing `from "./session-codec.js"` imports keep working.
 */
export const SESSION_SCHEMA_VERSION = 11 as const;
