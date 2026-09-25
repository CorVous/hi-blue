# Persistence design notes

Covers `src/spa/persistence/`. The save surfaces are specified in ADR 0004
(editable vs sealed save surface) and ADR 0005 (engine.dat obfuscation). The
rule for bumping a save-format version is in `AGENTS.md` under "Bumping
save-format versions". This file does not repeat it.

## Session layout on disk (`session-storage.ts`, `session-codec.ts`)

Each session is a set of localStorage keys under one prefix:

| Key | Contents |
| --- | --- |
| `hi-blue:sessions/<id>/meta.json` | `createdAt`, `lastSavedAt`, `epoch`, `round`, `personaOrder` |
| `hi-blue:sessions/<id>/<aiId>.txt` (one per Daemon) | persona plus that Daemon's conversation log (messages, witnessed events and broadcasts inline) |
| `hi-blue:sessions/<id>/engine.dat` | sealed engine state, XOR-obfuscated |
| `hi-blue:active-session` | the active session id |
| `hi-blue:archive/<id>/…` | the same three files for an archived session |
| `hi-blue-game-state` | legacy single-key save (discarded at boot, see below) |

- **`engine.dat` is the commit signal.** Every writer (`saveActiveSession`,
  `dupSession`, `archiveSession`, `seedFromArchive`) writes it in this order:
  meta, then daemons, then `engine.dat`. There is no rollback. If a write fails
  partway, `engine.dat` is missing, and the load path reports the session as
  `broken`.
- **Minted but never saved.** If neither `meta.json` nor `engine.dat` exists,
  the id was minted but never written. The loader reports `none`, so the
  dispatcher sends the player to start. The picker shows it as `broken`
  because it has nothing to display.
- **Storage failures are swallowed.** Writes that only clean up or move the
  pointer (`setActiveSessionId`, `clearActiveSession`,
  `deactivateActiveSession`, `rm*`, and reading metadata for the picker) go
  through `ignoringStorageErrors`. Private mode or a blocked localStorage must
  not crash the SPA. `saveActiveSession` is the exception: it reports
  `quota` / `unavailable` / `unknown` so the game can show the persistence
  warning.
- **`clearActiveSession` vs `deactivateActiveSession`.** A broken session is
  deleted. A version-mismatch session only loses the active pointer. Its bytes
  stay, so the picker can link it to the archived build that still reads it.
- **Session ids** are `0x` plus 4 upper-case hex digits (`mintSessionId`).
  `mintSession` returns a new id without activating it.
  `mintAndActivateNewSession` also sets the pointer.
- **Epoch.** It survives re-saves (read back from the existing `meta.json`).
  `seedFromArchive` increments it. The version-mismatch picker row accepts the
  pre-v6 `phase` meta field as the epoch.
- **Archived meta** carries `readonly: true` and `lastPlayedAt`. Active
  sessions have neither field.
- **`seedFromArchive`** deep-copies the archived conversation logs into a fresh
  `GameState`, adds the broadcast "The sysadmin has created a new room.", and
  writes a new session without activating it.

## Codec (`session-codec.ts`)

- **`personaOrder`** in `meta.json` stores the order in which Daemons were
  given panel slots at game start. localStorage key enumeration order is
  implementation-defined, so without it a restore could shuffle the panels.
  Saves written before this field existed fall back to daemon-file key order.
  A daemon file that `personaOrder` does not list is still restored.
- **`actionProfile` is spread in only when it is set.** Saves written with the
  feature off stay byte-identical to saves from before the field existed.
- **`StoredSealedEngine` vs `SealedEngine`.** The payload read from disk types
  its `schemaVersion` as a plain `number`. Only `checkVersionCompatibility` can
  mark it current, so a stored payload is never trusted as current just
  because of its own field. State is rebuilt only after that check passes.
- **Legacy defaults.** An old engine blob with no complication fields gets an
  empty schedule and an empty active list.
- `deserializeSession` takes the boundary as a parameter, defaulting to the
  live boundary. Tests can then check the gate against another cutoff.

## Session schema history (`SESSION_SCHEMA_VERSION`)

The constant is defined in `version-constants.ts`. That module imports
nothing: `version-boundary.ts` has to read the constant, and the codec imports
the boundary, so defining it in the codec would create an import cycle.
`session-codec.ts` re-exports it.

| Version | Issue | Change |
| --- | --- | --- |
| 4 | — | `chat` and `whisper` entries merged into one directional `message` kind. |
| 5 | #287 | `action-failure` conversation entry: a lasting record, per actor, of a rejected action-tool call. |
| 6 | #293, #294 | Phase-keyed `Record<1\|2\|3, …>` fields flattened to one game. `broadcast` entry added (sender-less, appended to every Daemon log). |
| 7 | #302 | A/B content packs: `contentPackA/B` scalars became `contentPacksA/B` arrays, and `activePackId` is persisted (it was hard-coded to `"A"` before). |
| 8 | #358 | `ContentPack.phaseNumber` removed. Packs are identified by array index. |
| 9 | #361 | `contentPacksA/B` hold exactly one pack each. |
| 10 | #374 | `ContentPack.wallName` added. |
| 11 | #462 | Pack buckets (`objectivePairs`, `interestingObjects`, `boundSpaces`, `obstacles`) replaced by one flat `entities` array. Buckets are derived with `pack-selectors.ts`. |
| 12 | #539 | `facing` and the horizon landmarks removed from persisted spatial state (ADR 0015). First archive-only bump. |

Saves at v7 or earlier never had a migration. They have always been reported
as `version-mismatch`.

**Why 8, 9 and 10 read as 11.** The v8→v9→v10→v11 migration functions have
been deleted. The move from v11 to v12 is archive-only and deliberately has no
migration, so the chain could only ever produce a v11 save. The live boundary
then rejects that save as a mismatch anyway. The migrated packs were built and
thrown away, and only the number 11 reached the UI. `deserializeSession`
therefore maps a stored 8, 9 or 10 straight to 11
(`schemaAsArchivedBuildReadsIt`). A save from any of those versions then links
to the `0.0.2-beta.2` archive, the last build that reads schemas 8 to 11.
Do not add a v11→v12 migration.

## Version boundary (`version-boundary.ts`)

A **version boundary** is the pair of save-format versions that a build reads
natively, one per axis:

- `session`: `SESSION_SCHEMA_VERSION`, the multi-file localStorage format.
- `gs`: `GAME_SAVE_VERSION` in `src/save-serializer.ts`, the "Save the AIs to
  USB" export.

A save stamped with any other version on either axis is *older*. Older saves
are never deleted or rewritten. They are reported as a version mismatch that
names the archived build able to read them, or `archivedBuild: null` when no
such build is known. In that case the UI shows a generic "older version"
message and does not name a build.

The boundary is a plain value so that it can be tested. Production uses
`liveVersionBoundary()`, and tests build a different cutoff such as
`{ session: 11, gs: 4 }`. It is a function, not a module-level const, so the
constants are read when it is called rather than fixed at module-evaluation
time.

## Archive map (`archive-map.ts`)

`SCHEMA_ARCHIVE_MAP` and `GAME_SAVE_ARCHIVE_MAP` map an *old* format version
to the latest released build that shipped it. The version-mismatch surfaces
link to `/v/<version>/` (ADR 0012). How to find the right build is described
in `AGENTS.md`, and `scripts/check-schema-map.mjs` enforces it on PRs.

Current entries: session `11` and game-save `4` both map to `0.0.2-beta.2`.
When you check an entry, remember that the tag names the release, not the
tagged commit's `package.json`. The version bump lands in a child commit, so
the `v0.0.2-beta.2` tree still says `0.0.2-beta.1`.

## Sealed blob (`sealed-blob-codec.ts`)

The XOR obfuscation (ADR 0005) is there to prevent accidental edits. It is not
security. The key ships in the bundle. The threat is a curious player who
edits `engine.dat` and breaks the simulation. The pipeline is
UTF-8 encode → XOR with the cycling key → ISO-8859-1 binary string → base64.
Decoding uses a fatal UTF-8 decoder, so tampered bytes usually throw
`SealedBlobCorrupt` and the session loads as `broken`.

The daemon `.txt` files are the intentionally editable surface (ADR 0004).
`devtools-edit.test.ts` checks that an edit made there shows up on the next
load.

## Boot routing (`active-session-dispatcher.ts`)

`dispatchActiveSession` is a pure truth table (#174, parent #155):

| Active pointer / load result | Route | Reason | Mint |
| --- | --- | --- | --- |
| no pointer | start | `no-active-pointer` | yes |
| `ok` | game | `populated` | no |
| `none` | start | `empty` | no |
| `broken` | sessions | `broken` | no |
| `version-mismatch` | sessions | `version-mismatch` (plus `schemaVersion`) | no |

## Tests

- `picker-ok-seed.test.ts` runs the exact seed script from
  `e2e/sessions-picker.spec.ts` against the live boundary. The Playwright spec
  only runs in CI, so this is the local check that the seeded bytes are still
  current. A seed sealed below the boundary would show up as
  `version-mismatch`, not `ok`, and the spec's `[ load ]` / `[ dup ]` /
  `[ rm ]` buttons would disappear.
