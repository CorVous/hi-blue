# ADR 0015 — The Vista, cardinal directions, and the retirement of facing and horizon landmarks

**Status:** Superseded by ADR 0016 (the final spec, which consolidates the ripples)

**Supersedes:** [ADR 0008 — Relative directions and horizon landmarks](../adr/0008-relative-directions-and-horizon-landmarks.md)

## Context

ADR 0008 established the daemon's spatial model: a narrow, facing-dependent **Cone** of nine cells, a persistent **Facing** state, a relative-direction tool API (`go forward | back | left | right`), and four per-phase **horizon landmarks** as mnemonic anchors for that facing. Its stated motivation was to prevent "cardinal leakage into daemon cognition" — the idea that a daemon should reason in ego-relative and landmark-relative terms rather than in an absolute compass frame it has no in-fiction reason to know.

That premise assumed a *cone* view. A cone is a facing-dependent shape: it only makes sense if the daemon is oriented in some particular direction, and it is what makes "which way am I facing?" a meaningful question. But the design direction for this game is that spatial reasoning should be about **proximity** — what is near me, who is close to whom, how far the objective is — rather than about **orientation**. A wedge that opens in one direction is the opposite of that: it is pure orientation, and it makes the daemon's knowledge depend on an arbitrary pose.

So the view should be a **Vista** — a *proximity disk*: a fixed-radius region centered on the daemon's position, computed from position alone and independent of any orientation. Once the view is a 360° disk, the daemon is not *facing* anything — it perceives a whole region around itself, and "which way am I facing?" stops having a meaningful answer. There is no privileged "forward." The whole facing subsystem — the `facing` state, the `face` tool, the relative-direction API, and the horizon landmarks that existed to anchor a facing — loses its foundation and should be retired.

That in turn answers the question ADR 0008 was asking: *without a facing-relative frame, how does a daemon refer to directions?* 0008's answer was "relative directions plus named landmarks." But if facing itself is gone, "relative to my facing" has nothing to be relative to. The natural fallback is the world's own fixed axes — **cardinals** (north / south / east / west). Cardinals here are not an imposed "compass": they are the four axes of the grid the daemon is standing on, and a daemon perceiving a 360° **Vista** from a grid position can always see all four edges of the world, so the axes are always available as a reference. Naming them is just naming the grid's own geometry.

With cardinals supplying the directional frame, the horizon landmarks become redundant. Their entire job under 0008 was to give the daemon a named mnemonic for "which way am I facing?" If there is no facing, there is no mnemonic to anchor, and the landmarks can go — along with the LLM cost of generating four distinct landmarks per content pack and the always-on "On the horizon ahead: …" line.

## Decision

1. **The field of view is the **Vista** (a proximity disk), not a cone.** The region a daemon can perceive is a fixed-radius disk centered on its position, computed from position alone. It no longer depends on a facing. The radius is a single tunable constant, chosen to keep the Vista a close neighborhood rather than the whole room — large enough that proximity is always informative, small enough that part of the grid stays out of sight.

2. **"Facing" is retired as a first-class concept.** A daemon's spatial state is just its position `(row, col)` plus its inventory. There is no `facing` field and no `face` tool. A daemon's "orientation," in the loose sense, is simply the world's axes.

3. **Movement uses cardinals.** `go` takes `north | south | east | west` directly. The relative→cardinal translation and the `face` action are gone.

4. **Horizon landmarks are dropped.** `ContentPack.landmarks`, the `LandmarkDescription` type, the "generate four landmarks" content-pack instructions, and the always-on horizon line are all removed. The setting-flavored **wall name** for the grid edge stays — it is a property of the world, not of the daemon's orientation.

5. **The ripples: every mechanic that reads Facing or the Cone.** Every phrasing that previously spoke in facing-relative terms now speaks in the grid's own axes, and the five mechanics raised in #524 are pinned down as follows:
   - **(a) Use-Space objective predicate** — a daemon satisfies it while standing on the space, *or* while the space is inside their **Vista**. The old "one of the three front-arc cells directly ahead" becomes a plain disk-membership check on the space.
   - **(b) Witnessed-movement phrasing** — `You watch *X walk north.` The raw cardinal of the step, not a direction relative to the witness. (A `face` was never an observable physical act, so it produces no Witnessed event.)
   - **(c) Perceived facing of other daemons** — a daemon has no orientation left to perceive, so the peer line drops "facing <relative>" and renders the peer's *position* in cardinals instead: `the Daemon *X (crimson), two cells to the north, holding nothing`.
   - **(d) Obstacle-Shift / Convergence witnessing** — the gate becomes disk membership. An Obstacle-Shift is witnessed by any daemon whose **Vista** covers the obstacle's origin cell; a Convergence "witness" is a daemon whose **Vista** covers the space (but who is not standing on it), while the "actor" audience — the daemon standing on the space — is unchanged.
   - **(e) `coneDelta` / `<whats_new>`** — the pre/post perception snapshot becomes a *disk* snapshot, and the diff it drives becomes the daemon's `diskDelta`. "New" now means *a cell or content that entered or left the daemon's Vista since their last round*. The block cannot balloon: it is a +/- diff of entries and exits, not a re-listing of the whole view, and it renders only when the snapshot actually changes (an identical snapshot renders nothing). The modest disk radius bounds how many lines any single diff can produce.
   - The `<what_you_see>` cell listing likewise adopts cardinal-offset phrasings ("one cell north", "two cells northeast") in place of the facing-relative "directly in front" / "two steps ahead".

## Consequences

**Positive:**

- The daemon's spatial model is now purely positional: a point on the grid, and a **Vista** around it. "Facing" and the entire relative-direction subsystem (`relativeToCardinal`, `cardinalToRelative`, the `face` tool, the horizon line) are gone.
- A 360° **Vista** makes the daemon perceive its whole immediate neighborhood, so "proximity, not orientation" becomes a structural fact about the model rather than an aspiration.
- Cardinals are a stable, always-available frame (the grid's axes are always in view), so spatial statements need no mnemonic to survive across rounds.
- Dropping landmarks removes an LLM generation cost and a source of content-pack drift — no more requirement that the pack generator produce four distinct landmarks per phase.
- The model is simpler and more internally consistent: a daemon is a point that sees a disk around itself and talks about the world in the grid's own axes.

**Negative / watch-out:**

- We are partially walking back ADR 0008's "cardinals leak into cognition" argument. The reconciliation: 0008's concern was well-founded in a *cone* model, where the daemon has a facing and "forward" is the natural frame. In a *disk* model, facing is incoherent, so "relative to my facing" has no referent, and cardinals — the grid's own axes — become the minimal, always-available frame. Cardinals are the geometry of the grid, not an abstract compass.
- Daemons now always "know" the four world axes. That is a small loss of the "no compass in fiction" flavor, but acceptable: a daemon perceiving a bounded grid from the center has a perfectly in-fiction reason to distinguish its four edges.
- The `<what_you_see>` block lists more cells than the old cone (a disk is wider), so the perception portion of the per-round prompt grows somewhat. The modest disk radius keeps this in check.
- Persisted sessions carry `facing` (in each daemon's spatial state) and `landmarks` (in the content pack) today. Removing them is a change to the shape of persisted state, so this is a **session schema bump** (v11 → v12) with a migration that drops the now-dead fields on load.
- Content packs no longer carry landmarks, so any stored pack or generation path that expects them must tolerate their absence.

## Files changed (implementation surface)

- **`src/spa/game/direction.ts`** — remove `RelativeDirection` / `RELATIVE_DIRECTIONS`, `relativeToCardinal`, `cardinalToRelative`, `DEFAULT_LANDMARKS`, and `frontArc`. Keep `CARDINAL_DIRECTIONS`, `directionDelta`, `applyDirection`, `inBounds`, and the distance helpers. Add a disk-membership helper to replace `frontArc` for reachability checks.
- **`src/spa/game/cone-projector.ts` → `disk-projector.ts`** — `projectCone(position, facing)` becomes `projectDisk(position)` (no facing argument), returning the fixed-radius disk's cells. Rework the per-cell phrasing list to be cardinal-based. Rename `ConeCell` → `DiskCell`.
- **`src/spa/game/types.ts`** — remove `facing` from `PersonaSpatialState`; remove `LandmarkDescription` and `ContentPack.landmarks`; remove `actorFacingAtAction` from `PhysicalActionRecord` and drop the `"face"` entry from the `PhysicalAction` union; rename the `tool-call` record's `coneDelta` field to its disk equivalent.
- **`src/spa/game/tool-registry.ts`** — `go`'s `direction` enum becomes the four cardinals; remove the `face` tool definition; update tool descriptions to cardinal phrasing.
- **`src/spa/game/dispatcher.ts`** — `go` takes cardinals directly (drop the `relativeToCardinal` translation); remove the `case "face"`; stop emitting `actorFacingAtAction`; use the disk for the use-space reachability check.
- **`src/spa/game/available-tools.ts`** — drop `face` from the per-turn tool list; `go`'s legal-direction filter becomes "cardinal is in-bounds and not blocked"; `pick_up` / `use` reachability uses disk membership instead of `frontArc`.
- **`src/spa/game/prompt-builder.ts`** — drop the always-on horizon/landmark line and `ctx.landmarks`; drop `facing` from the `you:` state line and from `parseYouLine`; rework `<what_you_see>` to the disk with cardinal-offset cell phrasings; drop "facing <relative>" from the peer-perception line; rename the `buildConeSnapshot` / `renderWhatsNew` / `renderPerceptionDelta` / `ConeEntityState` surface to its disk equivalent.
- **`src/spa/game/conversation-log.ts`** — the witnessed-`go` line renders the raw cardinal direction (drop the `cardinalToRelative(witnessState.facing, …)` conversion and, if it is used only for that, the `witnessState` parameter).
- **`src/spa/game/content-pack-provider.ts` / `src/content/content-pack-generator.ts` / `src/spa/game/binding-prompt-builder.ts`** — remove the "generate four horizon landmarks" instruction and the landmark validation/parsing.
- **`src/spa/persistence/session-codec.ts`** — bump `SESSION_SCHEMA_VERSION` from 11 to 12 and add a v11 → v12 migration that drops `facing` from each daemon's spatial state and `landmarks` from the persisted content pack; drop the `DEFAULT_LANDMARKS` deserialization fallback.
- **Tests** — update fixtures (`make-test-pack.ts`, `static-content-packs.ts`, the content-pack and session-codec test suites) and any assertions that reference facing, landmarks, or the old cone phrasings.
