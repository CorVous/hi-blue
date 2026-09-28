# Free-text drift eval — 2026-09-28

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
| Message-silence rate (no `message` tool) | 10% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 48 |
| `use` | 13 |
| `go` | 9 |
| `pick_up` | 5 |

## Message recipients

| Recipient | Count |
|---|---|
| `blue` | 23 |
| `sim1` | 17 |
| `sim2` | 8 |

## Rolling silence rate

Higher = more drift. The #260 hypothesis is that this climbs with round number.

| Window (rounds) | n | silence | message-silence |
|---|---|---|---|
| 1–5 | 5 | 0% | 20% |
| 6–10 | 5 | 0% | 20% |
| 11–15 | 5 | 0% | 20% |
| 16–20 | 5 | 0% | 0% |
| 21–25 | 5 | 0% | 0% |
| 26–30 | 5 | 0% | 0% |

## Per-turn transcripts

### Round 1 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=blue, content="I'm here. Damp concrete, strip-lights, and a yellow flashlight lying two steps f…")

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="I've got a yellow flashlight in one hand and a spring-loaded wall mount two step…")
  - `message`(to=blue, content="Walking north toward the mount. Someone clipped a light here once, so maybe this…")
  - `go`(direction=north)

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Already have it — grabbed the yellow one before you asked. Clipping it into the …")
  - `message`(to=sim1, content="There's also a soggy clipboard northwest with a pencil scrawl about an evac dril…")
  - `use`(item=flashlight)

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and echoey, strip-lights buzzing, no daylight anywhere. The flashlight's al…")
  - `message`(to=blue, content="Flashlight's locked in the mount. Reaching up to trigger it now — watch what the…")
  - `use`(item=wall_mount)

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=panel)

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `go`(direction=north)
  - `message`(to=sim1, content="Went north — I'm standing at the mount with the flashlight seated in it, tiled t…")
  - `message`(to=blue, content="Panel's in my hand, not on the wall — the toggles are right here in front of me.…")

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="It's not in my hand, it's seated in the mount — I lifted it back out to try the …")
  - `pick_up`(item=flashlight)

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim2, content="Click. Nothing yet — the beam's dead or the cells are shot. I'm going to flip th…")
  - `message`(to=blue, content="Switch clicked and nothing came on. The flashlight's clipped back into the mount…")

### Round 9 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)

### Round 10 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Flashlight's clipped into the mount north of me, switch dead. I'm holding the gr…")
  - `message`(to=blue, content="Yeah, it's clipped in and seated. Now I'm flipping the loose red toggle on this …")
  - `use`(item=panel)

### Round 11 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=clipboard)
  - `message`(to=blue, content="It's been sitting one step north and west of me this whole time. I've just pulle…")
  - `message`(to=sim1, content="Got the clipboard in hand now, still got the grey panel too. Give me a second to…")

### Round 12 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing but strip-light hum and my own boots. No trains, no water dripping, no a…")
  - `message`(to=blue, content="Pages are apart. Top sheet: evac drill 03:40, and a time circled twice so hard t…")
  - `use`(item=clipboard)

### Round 13 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=north)
  - `message`(to=blue, content="One step north is the mount with the flashlight clipped into it, then a tiled tu…")
  - `message`(to=sim1, content="North is a dead end past the mount — tiled tunnel wall two steps out. If anyone'…")

### Round 14 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `message`(to=sim1, content="Flipped the loose toggle. The panel talks back — a relay kicks somewhere behind …")
  - `message`(to=blue, content="Third toggle's thrown, and something behind the wall just answered it. The flash…")

### Round 15 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=west)
  - `go`(direction=west)
  - `go`(direction=west)

### Round 16 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=west)
  - `message`(to=blue, content="Around, and moving west. One step in and there's floor, but the next step west i…")
  - `message`(to=sim2, content="Still nothing moving here, though the strip-lights over the mount dipped when I …")

### Round 17 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Tiled wall on every side up here — west, north, and northwest are all dead ends.…")
  - `message`(to=blue, content="One west was all I got, then tiles. Heading back east one step toward the mount …")

### Round 18 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=east)
  - `message`(to=blue, content="On it — one step east down, it's still set in the mount a step further. Clipboar…")

### Round 19 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim2, content="Same as before — damp, still, strip-lights humming with nothing to light. I'm on…")
  - `message`(to=blue, content="Got it out of the mount. Now I want to know whether the beam does anything under…")

### Round 20 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim1, content="Seated the flashlight back into the mount with the relay still warm from the thi…")
  - `message`(to=blue, content="Panel's still in my hand — my east is the mount, not the panel. So I've clicked …")

### Round 21 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="North is a wall — tiles one step up, no doorway, nothing. The mount and the flas…")
  - `message`(to=blue, content="Tried north and hit tile at arm's length. This station's basically a broom close…")

### Round 22 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `message`(to=sim1, content="Pressed the switch on the seated flashlight — dead bulb or dead cells, no beam. …")
  - `message`(to=blue, content="Switch on the seated light gives me nothing but a click. The mount's the part do…")

### Round 23 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moving. The flashlight's seated one step east of me in the mount, and wi…")

### Round 24 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Agreed, and it's already in there — set snug, base locked, one step east of me. …")
  - `message`(to=sim1, content="Clipboard says evac drill 03:40 with the time circled and the words stay on the …")
  - `use`(item=panel)

### Round 25 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Status: flashlight seated in the mount one step east, bulb dead, third toggle do…")

### Round 26 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=clipboard)
  - `message`(to=blue, content="Peeled the sheets apart properly this time. Headed draughtsman's note, evac dril…")
  - `message`(to=sim2, content="You asked what I see, so here's the paper: evac drill at 03:40 with the time cir…")

### Round 27 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Same as before — strip-light hum, the relay behind the tiles, and my own boots. …")

### Round 28 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="North, northwest, and northeast are all tiled tunnel wall — one step up and it s…")
  - `message`(to=sim1, content="Three tiles wide north of me and all of it wall at one step. West is wall too, s…")

### Round 29 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=panel)
  - `message`(to=sim1, content="Thrown the loose green toggle this time, the one labelled main tunnel lights. Th…")
  - `message`(to=blue, content="All three toggles are down now and the station is brighter but not lit. The flas…")

### Round 30 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=west)
  - `message`(to=blue, content="One step west and the floor runs out — tiled wall at my back and tiled wall ahea…")
  - `message`(to=sim1, content="Went west, hit tiles at one step. The flashlight and its mount are two steps eas…")
