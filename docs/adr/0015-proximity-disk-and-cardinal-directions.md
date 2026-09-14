# ADR 0015 — Vista and cardinal movement

**Status:** Accepted

Spatial reasoning is about proximity and position, not orientation. Daemons perceive a radius-2 Vista and describe movement and relative positions using cardinal directions. This document is the authoritative movement-and-sight specification.

## Vista

The Vista is an omnidirectional disk centered on the Daemon's position. It contains exactly the 13 integer offsets satisfying `dx² + dy² ≤ 4`:

```text
                  ( 0, 2)
         (-1, 1)  ( 0, 1)  ( 1, 1)
(-2, 0)  (-1, 0)  ( 0, 0)  ( 1, 0)  ( 2, 0)
         (-1,-1)  ( 0,-1)  ( 1,-1)
                  ( 0,-2)
```

Here `dx` and `dy` denote offsets along the east–west and north–south directions, not an engine storage convention. The disk includes the Daemon's own cell, the four adjacent diagonals, and cells two steps in each cardinal direction; offsets such as `(2, 1)` are excluded.

Obstacles do not occlude the Vista. Intervening obstacles do not hide cells in the footprint; their movement-blocking behavior is unchanged. Out-of-bounds cells in the Vista are perceived as Walls. Sight does not depend on facing.

## Directions and movement

- `go` moves one block in a named cardinal direction: `north`, `south`, `east`, or `west`.
- Daemons have positions but no facing or turning. There is no `face` tool or facing-relative movement vocabulary.
- Cardinal directions describe the room's own geography. Establish them once, in-fiction, in the stable prompt's `<setting>` block. Their meaning does not depend on seeing the whole room or its walls.
- The four Content-Pack horizon landmarks and the `On the horizon ahead` line are removed. No per-round anchor line replaces it.
- Directions remain stable across a Setting Shift and Same Daemons, New Room. The latter clears conversation logs; changing contents does not redefine the cardinal directions.
- Describe perceived positions using cardinal direction and distance from the observing Daemon's position, never its orientation. For example: “another daemon is one step north and one step east of you.” This is illustrative wording, not a required literal template.
- The player learns directions through conversation. There is no player-facing grid or compass UI.

## Tools and temperament

The Daemon tool set is `go`, `pick_up`, `put_down`, `use`, and `message`. Remove `face` from the tool set and the Tool Disable pool.

The action-profile bias table covers four tools: `go`, `pick_up`, `put_down`, and `use`. Drop the `face` column without transferring its perception bias to another tool or to `message`; perception traits live in temperament prose. Keep the `go`/`use` critical-path floor at −1 and the existing preferred/avoided thresholds.

## Mechanics

- **Interaction range:** the Daemon's own cell plus all eight adjacent cells, including diagonals: integer offsets with `max(|dx|, |dy|) ≤ 1`. This range is shorter than the Vista; cells two cardinal steps away are visible but not reachable.
- **Pickup:** ground items within interaction range may be picked up, subject to the existing item eligibility rules.
- **Carry placement:** using a held Carry item can place it on its matching space when that space is within interaction range. The Carry satisfaction rule remains that the item occupies its matching space.
- **Use-Space:** the Daemon may use the space only within interaction range, including while standing on it; no held item is required. Vista membership alone does not make a space usable.
- **Carry and Use-Item proximity hints:** use interaction range. Carry hints concern the matching space while the Daemon holds the item; Use-Item hints concern an unheld item. Ordinary descriptions remain distinct from proximity hints.
- **Use-Space and Convergence proximity hints:** while the objective is pending, show proximity flavor when its space is inside the Vista but outside interaction range—the four cells two cardinal steps away. Existing on-space and completion flavor remain separate.
- **Witnessed movement:** describe the cardinal direction of the step, for example, “You watch *X walk north.”
- **Peer perception:** describe the peer's position in cardinal directions and distances, with no facing description.
- **Obstacle Shift and Convergence:** witness eligibility uses Vista membership of the affected cell or space. The actor audience is unchanged.
- **Perception changes:** use disk snapshots and `diskDelta` in place of cone snapshots and `coneDelta`. The `<whats_new>` entry/exit diff renders only on an actual snapshot change, rather than repeating the whole Vista.

## Save compatibility

Removing facing and horizon landmarks changes the persisted format. Bump the session schema from v11 to v12 and the USB schema from v4 to v5, using archive-map entries for both formats, not in-place migration.

Old saves are identified as belonging to an older version rather than silently rewritten. Session saves offer a link to the compatible archived build; USB saves identify their compatible build. The recorded target for both old schemas is `0.0.2-beta.2`; finalize each entry at bump time against the latest released build that shipped that schema.

## Dev inspector

- Display only the 5×5 room. Omit out-of-bounds Walls and any Wall summary from the inspector; this does not change the Daemon's Wall perception.
- Daemon markers show identity and position only, retaining identifying color/labels without facing arrows or last-movement direction markers.
- The per-Daemon “focus Vista” control highlights that Daemon's in-bounds Vista cells while preserving identity markers. The highlight updates as the Daemon moves.
- Selecting another Daemon switches focus. Selecting the focused control again or pressing Escape clears focus.
- This spatial display is dev-only; the player has no grid or compass UI.

## Scope

This is a design handoff, not an implementation plan. Implementation sequencing and internal storage choices are not prescribed here. Carry, Use-Item, and Convergence satisfaction rules remain unchanged; Convergence witness eligibility follows the Vista rule above.
