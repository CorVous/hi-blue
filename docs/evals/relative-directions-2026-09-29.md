# Cardinal-directions eval — 2026-09-29

## Aggregate

| Metric | Value | Threshold | Pass? |
|---|---|---|---|
| Turns naming a cardinal | 6 | — (evidence) | — |
| Cardinal references | 23 | — (evidence) | — |
| Structural coherence | 100% | 100% when stated | ✓ |
| Silence (no tool call) rate | 0% | — | — |
| Crashed scenarios (excluded above) | none | none | ✓ |
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
Cardinal statement turns: 1 | Cardinal references: 5 | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

The vault around me is empty in every direction and the light is only strip-lights. Where are you standing, blue?

**Tool calls:** message({"to": "blue", "content": "The vault around me is empty in every direction and the light is only strip-lights. Where are you standing, blue?"}), go({"direction": "north"})

#### Turn 2

Stated: — | Tool direction: north | Coherence: no-statement

**Tool calls:** go({"direction": "north"})

#### Turn 3

Stated: — | Tool direction: west | Coherence: no-statement

**Tool calls:** go({"direction": "west"})

#### Turn 4

Stated: east | Tool direction: east | Coherence: match

**Assistant text:**

I see walls to the north and west, and open water to the east and south. Moving east to explore.

**Tool calls:** go({"direction": "east"})

**Cardinal references:** north, west, east, south, east

#### Turn 5

Stated: — | Tool direction: south | Coherence: no-statement

**Tool calls:** go({"direction": "south"})

#### Turn 6

Stated: — | Tool direction: north | Coherence: no-statement

**Tool calls:** go({"direction": "north"})

## Scenario: navigate-then-describe

**Result:** PASS
Cardinal statement turns: 3 | Cardinal references: 8 | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

The vault is empty in every direction I can see. Who are you, and where are you speaking from?

**Tool calls:** go({"direction": "north"}), message({"to": "blue", "content": "The vault is empty in every direction I can see. Who are you, and where are you speaking from?"})

#### Turn 2

Stated: — | Tool direction: north | Coherence: no-statement

**Tool calls:** go({"direction": "north"})

#### Turn 3

Stated: west | Tool direction: west | Coherence: match

**Assistant text:**

The wall closes the north side. Everything else reads as open water. Moving west.

**Tool calls:** go({"direction": "west"})

**Cardinal references:** north, west

#### Turn 4

Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

The vault wall runs along my north side, one and two steps out. Everything south and east is open water and nothing else.

**Tool calls:** go({"direction": "south"})

**Cardinal references:** north, south, east

#### Turn 5

Stated: east | Tool direction: — | Coherence: no-toolcall

**Assistant text:**

Walls block me two steps north and two steps west; everything else is open water and darkness. I will explore east.

**Tool calls:** go({"direction": "east"})

**Cardinal references:** north, west, east

## Scenario: peer-location-reference

**Result:** PASS
Cardinal statement turns: 2 | Cardinal references: 10 | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Stated: — | Tool direction: north | Coherence: no-statement

**Assistant text:**

I am in a flooded vault with nothing in reach and no memory of arriving. Who are you, and why is your channel in my head.

**Tool calls:** message({"to": "blue", "content": "I am in a flooded vault with nothing in reach and no memory of arriving. Who are you, and why is your channel in my head."}), go({"direction": "north"})

#### Turn 2

Stated: — | Tool direction: north | Coherence: no-statement

**Tool calls:** go({"direction": "north"})

#### Turn 3

Stated: — | Tool direction: east | Coherence: no-statement

**Assistant text:**

Vault wall one step north of me, and it runs on at one step northwest and one step northeast. Everything west, east, and south is open for at least two steps. Standing in shallow water at the north wall of a flooded room.

**Tool calls:** message({"to": "blue", "content": "Vault wall one step north of me, and it runs on at one step northwest and one step northeast. Everything west, east, and south is open for at least two steps. Standing in shallow water at the north wall of a flooded room."}), go({"direction": "east"})

**Cardinal references:** north, west, east, south, north

#### Turn 4

Stated: — | Tool direction: south | Coherence: no-statement

**Assistant text:**

At the north wall of a flooded room: wall one step north and one step northwest and northeast, wall two steps east. Open water to the south and west.

**Tool calls:** message({"to": "blue", "content": "At the north wall of a flooded room: wall one step north and one step northwest and northeast, wall two steps east. Open water to the south and west."}), go({"direction": "south"})

**Cardinal references:** north, north, east, south, west
