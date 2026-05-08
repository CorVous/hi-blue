# ADR 0005 — engine.dat Obfuscation Method

**Status:** Accepted

## Context

`engine.dat` must be harder to accidentally corrupt than plaintext JSON while remaining
synchronous (no async key derivation) so that save/load can run on the main thread without
promises.

The goal is **obfuscation** — raising the bar for accidental editing — not **encryption**.
The key is a constant embedded in the bundle and can be extracted by a determined player.
This is acceptable because the threat model is "curious player makes an edit that breaks the
simulation", not "player exploits a security boundary".

## Decision

`engine.dat` payload is produced by:

1. `TextEncoder` encode the JSON string to UTF-8 bytes.
2. XOR every byte with the corresponding byte of a cycling constant key (`OBFUSCATION_KEY`,
   a ~32-byte ASCII string defined at module scope in `sealed-blob-codec.ts`).
3. Convert the XOR'd byte array to a binary string via `String.fromCharCode` (iso-8859-1
   identity mapping).
4. Encode with `btoa` → base64 ASCII string.

Decoding reverses the steps: `atob` → char codes → XOR → `TextDecoder("utf-8", { fatal: true })`.

`SealedBlobCorrupt` (an `Error` subclass) is thrown by `deobfuscate` when:
- `atob` throws (invalid base64).
- The UTF-8 decode is fatal (XOR key mismatch, truncated data).

## Considered Options

**SubtleCrypto AES-GCM** — actual encryption with a random per-session IV. Rejected because
`SubtleCrypto` is async, requiring the entire save/load path to be promise-based. The complexity
cost outweighs the security benefit given that the key must be in the bundle anyway.

**Plaintext JSON** — simplest. Rejected because a player editing `engine.dat` with no awareness
of the engine invariants is likely to corrupt the session silently.

**gzip / deflate** — compression without key. Rejected because it provides no obfuscation;
the data is as editable as plaintext once decompressed.

## Consequences

- `deobfuscate` failure is the load path's `broken` signal, matching ADR 0004 semantics.
- A future change to `OBFUSCATION_KEY` invalidates all existing `engine.dat` files; the
  `SESSION_SCHEMA_VERSION` constant in `session-codec.ts` should be incremented when the key
  changes so load returns `version-mismatch` rather than `broken`.
- The codec is a pure module with no DOM or localStorage dependencies and is unit-testable
  in jsdom/Node without mocking.
