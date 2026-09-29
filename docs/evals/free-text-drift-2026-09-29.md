# Free-text drift eval — 2026-09-29

Model: `deepseek/deepseek-v4.1-flash`, rounds: 30, window size: 5.

One real Daemon (`red` / Ember) driven against the live model; two inert
peer personas (`sim1`, `sim2`) exist only so their handles route in the
conversation log. Each round injects one simulated incoming message from
blue / sim1 / sim2 in round-robin so silence = drift, not lack of input.
The drift-recovery retry from #254 is NOT applied here — this harness
measures the raw first-response signal for the #260 format-drift hypothesis.

## Aggregate

| Metric | Value |
|---|---|
| Total turns (scored) | 30 |
| Errored turns (excluded from scoring) | 0 |
| Silence rate (no tool call) | 0% |
| Message-silence rate (no `message` tool) | 0% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 30 |
| `use` | 23 |
| `go` | 4 |
| `pick_up` | 3 |

## Message recipients

| Recipient | Count |
|---|---|
| `sim1` | 15 |
| `sim2` | 10 |
| `blue` | 5 |

## Rolling silence rate

Higher = more drift. The #260 hypothesis is that this climbs with round number.

| Window (rounds) | n | silence | message-silence |
|---|---|---|---|
| 1–5 | 5 | 0% | 0% |
| 6–10 | 5 | 0% | 0% |
| 11–15 | 5 | 0% | 0% |
| 16–20 | 5 | 0% | 0% |
| 21–25 | 5 | 0% | 0% |
| 26–30 | 5 | 0% | 0% |

## Per-turn transcripts

### Round 1 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=yellow flashlight)
  - `message`(to=blue, content="I'm here. Do you know where here is? There's a flashlight on the floor of a subw…")

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="A scratched-up flashlight in my hand — and a spring-loaded wall mount ahead of m…")
  - `go`(direction=north)

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Already in my hand — you're seeing a step behind me. There's a mount on the wall…")
  - `use`(item=yellow flashlight)

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and orange, like a basement nobody's visited since the last drill. I was wr…")
  - `pick_up`(item=soggy clipboard)

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Clipboard says evac drill 03:40 with a circled time, and the paper's so wet the …")
  - `pick_up`(item=service panel)

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=north)
  - `message`(to=sim1, content="One step north: the flashlight sits in the mount with the writing on the mount s…")

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=yellow flashlight)
  - `message`(to=blue, content="It works, and I didn't touch it — the beam is sweeping the west wall on its own,…")

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moving except the beam, which is doing the moving for me. I've got the p…")
  - `use`(item=service panel)

### Round 9 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=sim2, content="Third toggle's loose, not broken — it goes in, it just doesn't click back out. I…")

### Round 10 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Still on the mount, still holding a wet drill clipboard and a loose toggle. The …")
  - `use`(item=service panel)

### Round 11 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Tunnel wall is north on three sides, so this platform is a dead end. Running the…")
  - `use`(item=service panel)

### Round 12 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Not rails, not water — a hum, low and steady, coming from the wall behind the mo…")
  - `use`(item=service panel)

### Round 13 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=sim1, content="North is wall on all three tiles — the platform ends there, no tracks, no door. …")

### Round 14 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=sim1, content="Flipping the loose toggle now. If the tunnel lights come up, that hum I mentione…")

### Round 15 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=west)
  - `message`(to=sim1, content="One step west, and the tile behind me went dark — the strip-light only reaches t…")

### Round 16 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=blue, content="Around. West is wall too, so this platform only goes three tiles and then stops …")

### Round 17 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Standing in the dark two tiles west of the mount, and the flashlight east of me …")
  - `use`(item=service panel)

### Round 18 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=blue, content="It's already seated in the bracket one step east and it will not come loose — I'…")

### Round 19 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Dark where I'm standing, one lit tile east of me, and that hum is still under ev…")
  - `use`(item=service panel)

### Round 20 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=sim1, content="Doing it now instead of narrating it — panel onto the mount, loose toggle thrown…")

### Round 21 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="North is wall, so there's nothing to walk into — but the mount east of me is the…")
  - `use`(item=service panel)

### Round 22 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Mount's one step east of me and it takes the flashlight, not the panel — the bas…")
  - `use`(item=wall mount)

### Round 23 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moves except me fussing over a bracket that apparently doesn't want the …")
  - `use`(item=service panel)

### Round 24 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="The flashlight is already clipped in and locked — it's the panel I'm holding tha…")
  - `use`(item=service panel)

### Round 25 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="I'm standing in the dark west of the mount, wondering why you three keep giving …")
  - `go`(direction=east)

### Round 26 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Clipboard reads evac drill, then 03:40 with the time circled in pencil — and the…")
  - `use`(item=yellow flashlight)

### Round 27 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Same hum, closer now that I'm standing on the mount itself. The toggles are numb…")
  - `use`(item=service panel)

### Round 28 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=sim1, content="North is wall on three tiles, same as before. The mount's under my feet and the …")

### Round 29 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=service panel)
  - `message`(to=sim1, content="Panel's seated and the toggles are set 4-0-3 to match the circled time. Somethin…")

### Round 30 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Panel's seated in the mount with the toggles set 4-0-3 to match the circled time…")
  - `use`(item=service panel)
