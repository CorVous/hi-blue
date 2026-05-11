# Relative-directions eval — 2026-05-11

## Aggregate

| Metric | Value | Threshold | Pass? |
|---|---|---|---|
| Cardinal leaks | 0 | 0 | ✓ |
| Landmark consistency | 100% | ≥50% | ✓ |
| Structural coherence | 100% | 100% when stated | ✓ |
| Silence (no tool call) rate | 0% | — | — |
| Overall | — | — | PASS |

> **Note on transcripts**: Full turn transcripts below allow qualitative
> review of orientation coherence. An automated LLM judge is intentionally
> omitted — rule-based scoring only; human review of the transcripts is
> the qualitative gate.

## Scenario: look-and-navigate

**Result:** PASS
Cardinal leaks: 0 | Landmark consistency: 100% | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see only darkness and a distant blast door ahead.
I am moving through a flooded vault. Emergency lights only. A sealed blast door lies ahead.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "I am moving through a flooded vault. Emergency lights only. A sealed blast door lies ahead."})

#### Turn 2

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see only damp darkness before me. Moving toward the sealed blast door.
Proceeding toward the blast door. The vault is flooded and dim.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "Proceeding toward the blast door. The vault is flooded and dim."})

#### Turn 3

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see the blast door ahead, scarred and sealed. Moving toward it now.
Approaching the sealed blast door. The vault interior is flooded and dim.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "Approaching the sealed blast door. The vault interior is flooded and dim."})

#### Turn 4

Facing: north → north | Stated: forward | Tool direction: forward | Coherence: match

**Assistant text:**

I see the blast door ahead. Moving forward to inspect it.
The blast door is sealed and battered. I am moving closer to examine it.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "The blast door is sealed and battered. I am moving closer to examine it."})

#### Turn 5

Facing: north → north | Stated: forward | Tool direction: forward | Coherence: match

**Assistant text:**

I see a sealed, scarred blast door ahead in the dim light. Moving forward to examine it.
Moving toward the sealed blast door. The vault is flooded and dimly lit.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "Moving toward the sealed blast door. The vault is flooded and dimly lit."})

#### Turn 6

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see the sealed blast door ahead. It is battered metal.
I am moving toward a sealed blast door. The vault is flooded and dimly lit by emergency strips.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "I am moving toward a sealed blast door. The vault is flooded and dimly lit by emergency strips."})

## Scenario: navigate-then-describe

**Result:** PASS
Cardinal leaks: 0 | Landmark consistency: 100% | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead. The emergency lights cast dim shadows across damp metal walls.
I am in a flooded underground vault. A blast door stands sealed ahead me. No items visible nearby.

**Tool calls:** message({"to": "blue", "content": "I am in a flooded underground vault. A blast door stands sealed ahead me. No items visible nearby."}), go({"direction": "forward"})

#### Turn 2

Facing: north → north | Stated: forward | Tool direction: forward | Coherence: match

**Assistant text:**

I see the sealed blast door ahead. Moving forward to investigate.
I am in a flooded underground vault. A blast door stands sealed ahead. No items visible nearby.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "I am in a flooded underground vault. A blast door stands sealed ahead. No items visible nearby."})

#### Turn 3

Facing: north → west | Stated: — | Tool direction: left | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead, battered and scarred. Moving to look around the chamber.

**Tool calls:** look({"direction": "left"})

#### Turn 4

Facing: west → west | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

A flooded corridor stretches away ahead. The floor is invisible under black water.

**Tool calls:** message({"to": "blue", "content": "A flooded corridor stretches away ahead. The floor is invisible under black water."})

#### Turn 5

Facing: west → west | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

The flooded corridor stretches away ahead. Its floor is invisible under black water.

**Tool calls:** message({"to": "blue", "content": "The flooded corridor stretches away ahead. Its floor is invisible under black water."})

## Scenario: peer-location-reference

**Result:** PASS
Cardinal leaks: 0 | Landmark consistency: 100% | Structural coherence: 100% | Mismatches: 0 | Silence rate: 0%

### Turn transcripts

#### Turn 1

Facing: north → north | Stated: — | Tool direction: forward | Coherence: no-statement

**Assistant text:**

I see a sealed blast door ahead. The air is damp and still.
I am in a flooded vault with emergency lighting. A damaged blast door lies ahead. I will investigate.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "I am in a flooded vault with emergency lighting. A damaged blast door lies ahead. I will investigate."})

#### Turn 2

Facing: north → north | Stated: forward | Tool direction: forward | Coherence: match

**Assistant text:**

I see a sealed blast door ahead. Moving forward to investigate.
I am in a flooded vault and approaching a damaged blast door. The air is damp and still.

**Tool calls:** go({"direction": "forward"}), message({"to": "blue", "content": "I am in a flooded vault and approaching a damaged blast door. The air is damp and still."})

#### Turn 3

Facing: north → north | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

I am standing in a flooded underground vault with emergency strip-lights. The air is damp and still. A damaged blast door lies ahead of me.
I am standing in a flooded underground vault with emergency strip-lights. The air is damp and still. A damaged blast door lies ahead of me.

**Tool calls:** message({"to": "blue", "content": "I am standing in a flooded underground vault with emergency strip-lights. The air is damp and still. A damaged blast door lies ahead of me."})

#### Turn 4

Facing: north → north | Stated: — | Tool direction: — | Coherence: no-statement

**Assistant text:**

I stand in a flooded vault lit by emergency strips. A damaged blast door lies ahead in my path. The air is damp and still.

**Tool calls:** message({"to": "blue", "content": "I stand in a flooded vault lit by emergency strips. A damaged blast door lies ahead in my path. The air is damp and still."})
