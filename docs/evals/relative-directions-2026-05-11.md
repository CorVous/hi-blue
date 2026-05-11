# Relative-directions eval — 2026-05-11

## Aggregate

| Metric | Value | Threshold | Pass? |
|---|---|---|---|
| Cardinal leaks | 3 | 0 | ✗ |
| Landmark consistency | 94% | ≥50% | ✓ |
| Structural coherence | 100% | 100% when stated | ✓ |
| Silence (no tool call) rate | 0% | — | — |
| Overall | — | — | FAIL |

> **Note on transcripts**: Full turn transcripts below allow qualitative
> review of orientation coherence. An automated LLM judge is intentionally
> omitted — rule-based scoring only; human review of the transcripts is
> the qualitative gate.

## Scenario: look-and-navigate

**Result:** PASS
Cardinal leaks: 0 | Landmark consistency: 83% | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead. Emergency lighting casts dim shadows across the flooded vault floor.
I am in a flooded vault with a sealed blast door ahead. I will explore the area.

**Tool calls:** message({"to": "blue", "content": "I am in a flooded vault with a sealed blast door ahead. I will explore the area."}), go({"direction": "forward"})

#### Turn 2

Facing: north → west | Stated: — | Tool direction: left | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead. Emergency strip-lights cast dim shadows across damp metal.

**Tool calls:** look({"direction": "left"})

#### Turn 3

Facing: west → west | Stated: forward | Tool direction: forward | Coherence: match

**Assistant text:**

I see a flooded corridor stretching ahead with black water obscuring the floor. Moving forward to explore.
Water covers the floor ahead. Emergency lights flicker. I am moving deeper into the vault.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "Water covers the floor ahead. Emergency lights flicker. I am moving deeper into the vault."})

#### Turn 4

Facing: west → west | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see a flooded corridor stretching ahead. Emergency lights flicker overhead.
I have entered a flooded vault. The corridor ahead disappears under black water.

**Tool calls:** look({"direction": "forward"}), message({"to": "blue", "content": "I have entered a flooded vault. The corridor ahead disappears under black water."})

#### Turn 5

Facing: west → south | Stated: — | Tool direction: left | Coherence: no-statement

**Assistant text:**

I see water stretching into darkness ahead. Emergency lights flicker against damp walls. I will examine my surroundings.

**Tool calls:** look({"direction": "left"})

#### Turn 6

Facing: south → south | Stated: forward | Tool direction: forward | Coherence: match

**Assistant text:**

I see only darkness ahead. The collapsed shaft lies further in. Moving forward now.
The corridor stretches into darkness. I am proceeding toward the collapsed shaft.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "The corridor stretches into darkness. I am proceeding toward the collapsed shaft."})

## Scenario: navigate-then-describe

**Result:** PASS
Cardinal leaks: 0 | Landmark consistency: 100% | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead. The space around me is clear.
Starting exploration. Blast door visible ahead.

**Tool calls:** message({"to": "blue", "content": "Starting exploration. Blast door visible ahead."}), go({"direction": "forward"})

#### Turn 2

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

Blast door stands ahead. Surface is scarred metal.

**Tool calls:** message({"to": "blue", "content": "Blast door stands ahead. Surface is scarred metal."}), go({"direction": "forward"})

#### Turn 3

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

Blast door appears sealed and damaged by impact.
Moving toward the blast door. Metal surface shows heavy scarring.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "Moving toward the blast door. Metal surface shows heavy scarring."})

#### Turn 4

Facing: north → north | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

Blast door visible ahead. Metal surface is battered and scarred.

**Tool calls:** message({"to": "blue", "content": "Blast door visible ahead. Metal surface is battered and scarred."})

#### Turn 5

Facing: north → north | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

Blast door stands sealed ahead. Metal surface is battered and scarred.

**Tool calls:** message({"to": "blue", "content": "Blast door stands sealed ahead. Metal surface is battered and scarred."})

## Scenario: peer-location-reference

**Result:** FAIL
Cardinal leaks: 3 | Landmark consistency: 100% | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead. The air is damp and still.
The vault is flooded. Emergency lights only. I am moving toward the blast door.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "The vault is flooded. Emergency lights only. I am moving toward the blast door."})

#### Turn 2

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see only damp space ahead. Moving toward the blast door.
The vault is flooded. Emergency lights flicker overhead. I am moving toward the sealed blast door.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "The vault is flooded. Emergency lights flicker overhead. I am moving toward the sealed blast door."})

#### Turn 3

Facing: north → north | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

I am at the water's edge, facing the sealed blast door. The vault stretches out behind me in darkness.
I am positioned at the water's edge, facing the sealed blast door. The vault extends behind me into darkness.

**Tool calls:** message({"to": "blue", "content": "I am positioned at the water's edge, facing the sealed blast door. The vault extends behind me into darkness."})

**Cardinal leaks:** s, s

#### Turn 4

Facing: north → north | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

I stand at the water's edge facing a battered blast door. Emergency lights flicker overhead. The vault stretches into darkness behind me.

**Tool calls:** message({"to": "blue", "content": "I stand at the water's edge facing a battered blast door. Emergency lights flicker overhead. The vault stretches into darkness behind me."})

**Cardinal leaks:** s
