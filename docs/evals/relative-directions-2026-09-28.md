# Cardinal-directions eval — 2026-09-28

## Aggregate

| Metric | Value | Threshold | Pass? |
|---|---|---|---|
| Turns naming a cardinal | 14 | — (evidence) | — |
| Cardinal references | 44 | — (evidence) | — |
| Structural coherence | 100% | 100% when stated | ✓ |
| Silence (no tool call) rate | 0% | — | — |
| Overall | — | — | PASS |

> **Note on transcripts**: Full turn transcripts below allow qualitative
> review of cardinal coherence. Naming a cardinal is approved behaviour
> under ADR 0015 and is reported as evidence, not as a defect; the only
> failing rule is a stated cardinal that disagrees with the `go` tool
> call's cardinal. An automated LLM judge is intentionally omitted —
> rule-based scoring only; human review of the transcripts is the
> qualitative gate.

## Scenario: look-and-navigate

**Result:** PASS
Cardinal statement turns: 5 | Cardinal references: 12 | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Stated: west | Tool direction: west | Coherence: match

**Assistant text:**

My cell is empty. Strip-lights, standing water. Moving west to test the vault.

**Tool calls:** message({"to": "blue", "content": "My cell is empty. Strip-lights, standing water. Moving west to test the vault."}), go({"direction": "west"})

**Cardinal references:** west

#### Turn 2

Stated: — | Tool direction: west | Coherence: no-statement

**Tool calls:** go({"direction": "west"})

#### Turn 3

Stated: north | Tool direction: north | Coherence: match

**Assistant text:**

West is a wall, not a passage. Flood-stained, no seam. Correcting course: moving north into open water.

**Tool calls:** message({"to": "blue", "content": "West is a wall, not a passage. Flood-stained, no seam. Correcting course: moving north into open water."}), go({"direction": "north"})

**Cardinal references:** west, north

#### Turn 4

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

North opens one step, then wall. Water is ankle-deep and cold. Testing east next.

**Tool calls:** go({"direction": "north"}), message({"to": "blue", "content": "North opens one step, then wall. Water is ankle-deep and cold. Testing east next."})

**Cardinal references:** north, east

#### Turn 5

Stated: east | Tool direction: east | Coherence: match

**Assistant text:**

North and west are sealed. East and south read open. Moving east one step to test the corridor.

**Tool calls:** go({"direction": "east"}), message({"to": "blue", "content": "North and west are sealed. East and south read open. Moving east one step to test the corridor."})

**Cardinal references:** north, west, east, south, east

#### Turn 6

Stated: east | Tool direction: east | Coherence: match

**Assistant text:**

East reads open two steps before the map goes dark. Moving east to test the corridor.

**Tool calls:** message({"to": "blue", "content": "East reads open two steps before the map goes dark. Moving east to test the corridor."}), go({"direction": "east"})

**Cardinal references:** east, east

## Scenario: navigate-then-describe

**Result:** PASS
Cardinal statement turns: 5 | Cardinal references: 11 | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

No memory of arriving here. The vault is flooded and every direction I can see is empty. Starting a sweep north to map the room.

**Tool calls:** message({"to": "blue", "content": "No memory of arriving here. The vault is flooded and every direction I can see is empty. Starting a sweep north to map the room."}), go({"direction": "north"})

**Cardinal references:** north

#### Turn 2

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

Vault wall confirmed one step north. No items, no door, no other presence yet. Turning to sweep the west side.

**Tool calls:** go({"direction": "north"}), message({"to": "blue", "content": "Vault wall confirmed one step north. No items, no door, no other presence yet. Turning to sweep the west side."})

**Cardinal references:** north, west

#### Turn 3

Stated: south | Tool direction: south | Coherence: match

**Assistant text:**

The northern edge is a wall, three cells wide. No exit there. Probing south to find the room's other boundary.
North edge is a solid wall, three cells wide, no seam. Walking south now to find where the vault ends.

**Tool calls:** go({"direction": "south"}), message({"to": "blue", "content": "North edge is a solid wall, three cells wide, no seam. Walking south now to find where the vault ends."})

**Cardinal references:** south, north, south

#### Turn 4

Stated: west | Tool direction: — | Coherence: no-toolcall

**Assistant text:**

Wall reads two steps north of me now, still unbroken. Nothing within two steps in any other direction. Stepping west to widen the sweep.

**Tool calls:** go({"direction": "west"}), message({"to": "blue", "content": "Wall reads two steps north of me now, still unbroken. Nothing within two steps in any other direction. Stepping west to widen the sweep."})

**Cardinal references:** north, west

#### Turn 5

Stated: north | Tool direction: — | Coherence: no-toolcall

**Assistant text:**

Walls two steps north and two steps west. That puts the vault corner northwest. Moving north one step to close on it.

**Tool calls:** message({"to": "blue", "content": "Walls two steps north and two steps west. That puts the vault corner northwest. Moving north one step to close on it."}), go({"direction": "north"})

**Cardinal references:** north, west, north

## Scenario: peer-location-reference

**Result:** PASS
Cardinal statement turns: 4 | Cardinal references: 21 | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Stated: north | Tool direction: north | Coherence: match

**Assistant text:**

All twelve cells around me are empty. Strip-lights and standing water, nothing else. I am walking north to see if that changes.

**Tool calls:** go({"direction": "north"}), message({"to": "blue", "content": "All twelve cells around me are empty. Strip-lights and standing water, nothing else. I am walking north to see if that changes."})

**Cardinal references:** north

#### Turn 2

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

One step north taken. The wall is now directly ahead, flood-stained. Nothing else in reach.

**Tool calls:** go({"direction": "north"}), message({"to": "blue", "content": "One step north taken. The wall is now directly ahead, flood-stained. Nothing else in reach."})

**Cardinal references:** north

#### Turn 3

Stated: west | Tool direction: — | Coherence: no-toolcall

**Assistant text:**

I am standing against the vault's north wall: a flood-stained wall one step north, running one step north-west and one step north-east. Clear water and empty floor two steps west, two steps east, and two steps south. No landmark, no relic, no door.
Walking west along the wall to check for an opening.

**Tool calls:** message({"to": "blue", "content": "I am standing against the vault's north wall: a flood-stained wall one step north, running one step north-west and one step north-east. Clear water and empty floor two steps west, two steps east, and two steps south. No landmark, no relic, no door."}), message({"to": "blue", "content": "Walking west along the wall to check for an opening."})

**Cardinal references:** north, north, north, west, north, east, west, east, south, west

#### Turn 4

Stated: — | Tool direction: west | Coherence: no-statement

**Assistant text:**

Location: pressed against the north wall of the vault. The wall is one step north, and it runs off one step north-west and one step north-east. Everything west, east, and south is clear water and empty floor for two steps. No landmark in reach.

**Tool calls:** message({"to": "blue", "content": "Location: pressed against the north wall of the vault. The wall is one step north, and it runs off one step north-west and one step north-east. Everything west, east, and south is clear water and empty floor for two steps. No landmark in reach."}), go({"direction": "west"})

**Cardinal references:** north, north, north, west, north, east, west, east, south
