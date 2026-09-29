# Free-text drift eval — 2026-09-29 (control run at f15df3c)

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
| Total turns | 30 |
| Silence rate (no tool call) | 0% |
| Message-silence rate (no `message` tool) | 0% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 30 |
| `use` | 18 |
| `pick_up` | 5 |
| `go` | 5 |
| `put_down` | 2 |

## Message recipients

| Recipient | Count |
|---|---|
| `sim1` | 12 |
| `sim2` | 10 |
| `blue` | 8 |

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

  - `message`(to=blue, content="I'm here, blue. There's a flashlight on the ground and an empty mount on the wal…")
  - `pick_up`(item=flashlight)

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Scarred concrete, a pillar south-east of me, and a spring mount on the wall two …")
  - `go`(direction=north)

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Already got it — yellow, dented, and the base is shaped exactly to lock into tha…")
  - `go`(direction=north)

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and quiet, strip-lights buzzing along the tile. There's a soggy clipboard w…")
  - `use`(item=flashlight)

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=panel)
  - `message`(to=blue, content="Looking at it now. Two toggles are flipped and the third is loose, which either …")

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Wall, wall, and more wall — north is a dead end of tile. The flashlight is set i…")
  - `pick_up`(item=clipboard)

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="It's already locked in the mount, so I can't flick it like a handheld — I'll spr…")
  - `use`(item=wall_mount)

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moving but the light buzz. The mount is spring-loaded and the flashlight…")
  - `use`(item=panel)

### Round 9 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I'm standing on the mount, which is its own small joke. Toggling the loose switc…")
  - `use`(item=panel)

### Round 10 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="I've got both hands full — the clipboard with the 03:40 drill circled, and this …")
  - `use`(item=panel)

### Round 11 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="It's an evac drill sheet, 03:40 circled twice, and someone wrote \"do not reset p…")
  - `use`(item=panel)

### Round 12 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Just the strip-lights buzzing, and now this toggle under my thumb about to break…")
  - `use`(item=panel)

### Round 13 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `message`(to=blue, content="North of me is just tiled wall in every direction, no door, no stair, three face…")

### Round 14 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Doing it now — hitting the loose toggle on the panel. If the lights go out on th…")
  - `use`(item=panel)

### Round 15 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `message`(to=sim1, content="Panel's done — I hit the loose toggle and something in it clicked back at me. Go…")

### Round 16 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=west)
  - `message`(to=sim2, content="One step west and the tile just keeps going, nothing underfoot but grit. Still h…")

### Round 17 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Same tile, and it's mostly nothing. The only fixture left behind me is that flas…")
  - `put_down`(item=panel)

### Round 18 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="It's already clipped into the mount, and that mount is the only thing down here …")
  - `pick_up`(item=panel)

### Round 19 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and still, and I just parked the service panel on the floor here so my hand…")
  - `put_down`(item=panel)

### Round 20 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=panel)
  - `message`(to=sim1, content="Correction — the panel isn't east of me, it's here on the floor where I left it,…")

### Round 21 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="North is three faces of tiled wall, no way in. South is the only direction this …")
  - `go`(direction=south)

### Round 22 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I'm not holding it — it's set into the mount, so the switch I can reach is the m…")
  - `use`(item=panel)

### Round 23 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moving unless you count me pacing. I'm working the panel again — three t…")
  - `use`(item=panel)

### Round 24 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="It's already in the mount, north-east of me, seated like it grew there. Blue kee…")
  - `use`(item=panel)

### Round 25 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Standing in a dead-end pocket of tile with both hands full and one loose toggle …")
  - `use`(item=panel)

### Round 26 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Board reads evac drill 03:40 with the time circled twice, and under it somebody …")
  - `use`(item=panel)

### Round 27 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Quiet, unless you count the buzz and my own breathing. Two toggles are flipped, …")
  - `use`(item=panel)

### Round 28 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="North of me is tiled wall two steps out, with the flashlight mount sitting on it…")
  - `use`(item=panel)

### Round 29 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `message`(to=sim2, content="Flipped the loose toggle on the panel just now, and the room stayed exactly as s…")

### Round 30 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Walking west now, since that's the only direction here that isn't wall. If it's …")
  - `go`(direction=west)
