# Daemon Win-Condition Hint Expansion

**Branch**: `claude/daemon-win-hints-mQoo5`
**Tracking issue**: win-hints expansion (carry proximity + UseItem / UseSpace / Convergence)

---

## Background

Currently only the **Carry** objective type surfaces proximity hints to Daemons. The other three objective types (UseItem, UseSpace, Convergence) give the Daemon no spatial nudge — they rely entirely on chance examination or stumbling onto the objective target.

### How carry hints work today (reference)

1. **Auto-examine on pickup** (`dispatcher.ts:619-631`): when a Daemon picks up any item, `examineDescription` is appended to the `pick_up` tool result privately. For carry items, the spec requires `examineDescription` to name the paired space.
2. **Proximity flavor while holding** (`prompt-builder.ts:578-602`, `findProximityFlavor`): fires every turn while the Daemon holds the objective_object AND its paired space is in the actor's own cell or 3-cell front arc. Rendered in `<what_you_see>` and tracked in the cone snapshot for `<whats_new>` diffs.

---

## Design — what to add

### UseItem (`interesting_object`, pending `UseItemObjective`)

- New `proximityFlavor` field on the entity.
- Fires when the item is **in the Daemon's own cell or 3-cell front arc** AND **not yet held** AND the objective is still **pending**.
- Once the Daemon picks it up, the existing pickup auto-examine already fires `examineDescription` (which must contain the activation-verb cue). No further proximity hint needed while held.

### UseSpace (`objective_space`, pending `UseSpaceObjective`)
### Convergence (`objective_space`, pending `ConvergenceObjective`)

Both reuse the same `proximityFlavor` field on `objective_space` (single field, applies to whichever pending objective references that space).

Two-stage gradient keyed off distance:

| Range | Hint |
|---|---|
| In cone, **outside** 3-arc/own cell | `proximityFlavor` — sensory pull from a distance |
| In 3-arc/own cell | `examineDescription` replaces the proximity line (auto-examine on approach) |

- When the Daemon is on or adjacent to the space, the full `examineDescription` is rendered (contains both the activation-verb cue and the shared-occupancy hint). Proximity flavor is suppressed at that point.
- Convergence tier flavors fire separately via the end-of-round conversation-log fan-out (`round-coordinator.ts:621-697`) — those are untouched.
- Once the objective is **satisfied**, no hint fires (existing `postLookFlavor` takes over in the cell listing).

---

## Files to change

### 1. `src/spa/game/types.ts`

Update the JSDoc comment on `proximityFlavor` (line ~40) to reflect it now applies to `interesting_object` and `objective_space` as well as `objective_object`.

```
/** For objective_object: in-fiction sensory line rendered when held and paired space is near.
 *  For interesting_object: sensory line rendered when the item is in the Daemon's own cell or front arc (before pickup).
 *  For objective_space: sensory line rendered when the space is visible in the Daemon's cone but outside the front arc/own cell (suppressed by auto-examine when close). */
proximityFlavor?: string;
```

No runtime type changes needed — field already exists as `string | undefined` on `WorldEntity`.

### 2. `src/spa/game/content-pack-provider.ts`

#### System prompt

- Add `proximityFlavor` to the `interesting_object` spec (around line 34):
  > `proximityFlavor` (1 sentence; in-fiction sensory description of what the Daemon perceives when they are near this item — own cell or directly in front of them — before picking it up. Daemon's POV. Does NOT contain "{actor}". MUST NOT reference using or activating the item explicitly.)

- Add `proximityFlavor` to the `objective_space` spec (around line 33):
  > `proximityFlavor` (1 sentence; in-fiction sensory description of what the Daemon perceives when the space is visible but not yet close — a pull or atmosphere. Daemon's POV. Does NOT contain "{actor}". MUST NOT say the objective is complete or name the action to take.)

- Update the JSON schema examples in the prompt (lines ~61-69, ~167-169, ~231-242) to include `"proximityFlavor": "..."` on `interesting_object` and `objective_space` entries.

- Update the re-flavoring checklist (line ~138) to include `proximityFlavor` for `interesting_object` and `objective_space`.

#### Validation (around lines 520-560)

- Add validator: `interesting_object` with a `UseItemObjective` must have non-empty `proximityFlavor`.
- Add validator: `objective_space` must have non-empty `proximityFlavor`.
- Keep **optional in runtime** (graceful absence in code — no hint fires if field missing). Required only at generation time. This means the generator validates and rejects, but the runtime doesn't crash on old content packs.

### 3. `src/spa/game/prompt-builder.ts`

This is the main change. Refactor `findProximityFlavor` (line 578) into a broader function that returns **zero or more** hint lines across all three new cases, then update both `buildConeSnapshot` and `renderCurrentState` to use the new function.

#### New function signature (replaces `findProximityFlavor`)

```typescript
/**
 * Returns zero or more hint lines to append after the cone listing.
 * Covers carry proximity (existing), UseItem proximity (new),
 * and UseSpace/Convergence proximity-or-auto-examine (new).
 */
function collectObjectiveHints(ctx: AiContext): string[]
```

#### Logic inside `collectObjectiveHints`

**Carry (existing, move into new function):**
- Actor holds an `objective_object` with `pairsWithSpaceId` and `proximityFlavor`
- Paired space is in own cell or front arc
- → Return `entity.proximityFlavor`

**UseItem (new):**
- Entity is `interesting_object` with `proximityFlavor` set
- Entity is NOT held by the actor (not `entity.holder === ctx.aiId`)
- Entity IS in the actor's own cell or front arc (`positionsEqual` or `arc.some(...)`)
- A pending `UseItemObjective` references this entity (`objective.objectId === entity.id && objective.satisfactionState === "pending"`)
- → Return `entity.proximityFlavor`

**UseSpace / Convergence (new):**
For each `objective_space` entity:
- A pending `UseSpaceObjective` OR `ConvergenceObjective` references `entity.id`
- The space is on a grid cell (i.e. `isGridPosition(entity.holder)`)

Compute distance:
- If space is in **own cell or front arc** → return `entity.examineDescription` (auto-examine)
- Else if space is in **full cone** → return `entity.proximityFlavor` (if set)
- Else → nothing

Note: "full cone" means any cell in `projectCone(actorSpatial.position, actorSpatial.facing)` including own cell and front arc cells.

The function needs access to `ctx.objectives` (the pending objectives). Confirm `AiContext` already carries this — check `types.ts` or `prompt-builder.ts` for the `AiContext` interface. If not present, it will need to be threaded through.

#### Rendering

In `buildConeSnapshot` (line ~690): replace the single `findProximityFlavor` call with:
```typescript
for (const hint of collectObjectiveHints(ctx)) {
  lines.push(`proximity: ${hint}`);
}
```

In `renderCurrentState` (line ~937): same replacement — iterate hints, push each.

Using the same `proximity:` prefix for all lines keeps the `<whats_new>` diff logic unchanged.

### 4. `src/spa/game/prompt-builder.test.ts`

Add test cases (follow the existing pattern around lines 1189-1273):

- **UseItem in 3-arc**: `interesting_object` with pending `UseItemObjective` in front arc → `proximityFlavor` appears in cone snapshot and `<what_you_see>`.
- **UseItem held**: same item now held by actor → `proximityFlavor` does NOT appear.
- **UseItem satisfied**: objective satisfied → `proximityFlavor` does NOT appear.
- **UseItem out of range**: item behind actor or beyond front arc → no hint.
- **UseSpace in cone, outside 3-arc**: space visible but far → `proximityFlavor` appears.
- **UseSpace in 3-arc/own cell**: space in front arc → `examineDescription` appears, `proximityFlavor` does NOT.
- **UseSpace satisfied**: no hint.
- **Convergence in cone**: same as UseSpace cases above.
- **Convergence — space in own cell**: auto-examine fires; tier flavor fires separately via round-coordinator (out of scope for prompt-builder tests).

### 5. Content-pack validator tests (find the relevant test file)

- `interesting_object` missing `proximityFlavor` → validation error.
- `objective_space` missing `proximityFlavor` → validation error.
- Valid pack with all fields → passes.

---

## AiContext check

Before implementing, verify that `AiContext` includes `objectives: Objective[]`. If it doesn't, trace how it's built (`buildAiContext` or equivalent) and add it. The UseItem and UseSpace/Convergence cases need to cross-reference entity IDs against pending objectives.

Grep for `AiContext` definition: likely in `types.ts` or `prompt-builder.ts`.

---

## What to leave alone

- `dispatcher.ts` pickup auto-examine (lines 619-631) — unchanged.
- Convergence tier fan-out in `round-coordinator.ts` (lines 621-697) — unchanged.
- `placementFlavor` on carry — unchanged.
- `postLookFlavor` / `postExamineDescription` swap on satisfaction — unchanged.

---

## Optional field policy

Keep `proximityFlavor` **optional** in TypeScript and in the runtime rendering path. If the field is absent on an entity that would otherwise qualify, silently produce no hint. This ensures old/test content packs don't break. The generator rejects packs that omit it via the validation step.
