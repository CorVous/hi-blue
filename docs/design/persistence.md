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
| `hi-blue:sessions/<id>/saving` | present only while `saveActiveSession` is writing, or after it failed partway |
| `hi-blue:active-session` | the active session id |
| `hi-blue:archive/<id>/…` | the same three files for an archived session |
| `hi-blue-game-state` | legacy single-key save (discarded at boot, see below) |

- **Writers commit in a fixed order.** Every writer (`saveActiveSession`,
  `dupSession`, `archiveSession`, `seedFromArchive`) writes meta, then
  daemons, then `engine.dat`. There is no rollback, so a failure partway must
  never load as `ok`:
  - **Re-saves use a saving marker.** `saveActiveSession` first writes
    `sessions/<id>/saving`, then the three files, and removes the marker last.
    A present marker means a save was interrupted, and the loader reports the
    session as `broken` (without it, new meta and daemons beside the previous
    `engine.dat` would load as `ok`). If a write fails before any data key
    has been written (the marker write itself, or `meta.json` right after
    it), nothing but the marker has been touched: the save removes the
    marker (best effort), reports the error, and the previous save still
    loads as `ok`. Once `meta.json` has been written, the marker stays and
    the session loads as `broken`. `archiveSession`
    refuses a source that carries the marker. Only `.txt` keys count as
    daemon files, so the marker is never listed as one or copied by
    `dupSession` or `archiveSession`.
  - **Fresh writes rely on `engine.dat`.** `dupSession` and `seedFromArchive`
    always write to a freshly minted, unused id, and `archiveSession` clears
    every key under `archive/<id>/` first so a reused id never merges two
    games. In all three, a failure partway leaves `engine.dat` missing, and
    the loader reports `broken`.
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
- **Session ids** are `0x` plus 4 upper-case hex digits (`mintSessionId`),
  drawn uniformly from `0x0000` to `0xFFFF`. Minting re-rolls while the id
  already has keys under `sessions/` or `archive/`, so a new game can never
  land on top of an existing or archived one.
  `mintSessionId` returns a new id without activating it.
  `mintAndActivateNewSession` also sets the pointer.
- **Epoch and `createdAt`.** Both survive re-saves (read back from the
  existing `meta.json`). An explicit `createdAt` passed to
  `saveActiveSession` still wins. `seedFromArchive` increments the epoch. The
  version-mismatch picker row accepts the pre-v6 `phase` meta field as the
  epoch.
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
- **A daemon file must carry an object `persona`.** A `.txt` that parses as
  JSON but has no `persona` object (a likely hand edit, ADR 0004) makes the
  load `broken` instead of restoring a Daemon with no persona.
- **`actionProfile` is spread in only when it is set.** Saves written with the
  feature off stay byte-identical to saves from before the field existed.
- **`StoredSealedEngine` vs `SealedEngine`.** The payload read from disk types
  its `schemaVersion` as a plain `number`. Only `checkVersionCompatibility` can
  mark it current, so a stored payload is never trusted as current just
  because of its own field. State is rebuilt only after that check passes.
- **Legacy defaults.** An old engine blob with no complication fields gets an
  empty schedule and an empty active list.
- **`lockedOut` on disk, `exhausted` in memory.** `GameState.exhausted` (the
  Daemons whose budget is spent) was renamed from `lockedOut` in #576 so it is
  not confused with the Chat Lockout Complication. The codec still writes and
  reads the `lockedOut` key, so the serialized shape did not change and the
  schema was not bumped. Do not rename the key without following the bump rules.
- **Finished games are saved, and `outcome` is derived.** The round that ends
  the game is saved like any other, with `isComplete: true` (#576). `outcome`
  is not a sealed field: adding it would change the serialized shape. On load,
  a complete session gets its `outcome` from `outcomeOfCompletedGame`, which
  says `lose` only when every budget is exhausted and an Objective is still
  unmet. That matches the coordinator, where a win takes priority. Incomplete
  sessions get no `outcome`. A finished save is not cleared: the active pointer
  stays until the player picks an endgame choice, and the game view reopens the
  endgame screen when it restores a complete session.
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
Do not add a v11→v12 migration. The clamp is only useful while its target
(`LAST_SCHEMA_BEFORE_ARCHIVE_ONLY_BUMPS`) has a `SCHEMA_ARCHIVE_MAP` entry
pointing at a build that still carries the v8→v11 chain, so a codec test
fails if that entry is removed.

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
