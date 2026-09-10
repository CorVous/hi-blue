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

- **Use-Space:** the Daemon may use the space while standing on it or while it is inside the Daemon's Vista. Eligibility is disk membership, not a front arc.
- **Witnessed movement:** describe the cardinal direction of the step, for example, “You watch *X walk north.”
- **Peer perception:** describe the peer's position in cardinal directions and distances, with no facing description.
- **Obstacle Shift and Convergence:** witness eligibility uses Vista membership of the affected cell or space. The actor audience is unchanged.
- **Perception changes:** use disk snapshots and `diskDelta` in place of cone snapshots and `coneDelta`. The `<whats_new>` entry/exit diff renders only on an actual snapshot change, rather than repeating the whole Vista.

## Save compatibility

Removing facing and horizon landmarks changes the persisted format. Bump the session schema from v11 to v12 and the USB schema from v4 to v5, using archive-map entries for both formats, not in-place migration.

Old saves are identified as belonging to an older version rather than silently rewritten. Session saves offer a link to the compatible archived build; USB saves identify their compatible build. The recorded target for both old schemas is `0.0.2-beta.2`; finalize each entry at bump time against the latest released build that shipped that schema.

## Scope

This is a design handoff, not an implementation plan. Implementation sequencing, internal storage choices, and dev-inspector visual design are not prescribed here. Carry, Use-Item, and Convergence satisfaction rules remain unchanged; Convergence witness eligibility follows the Vista rule above.
