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
| Message-silence rate (no `message` tool) | 13% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 47 |
| `pick_up` | 13 |
| `use` | 13 |
| `go` | 2 |

## Message recipients

| Recipient | Count |
|---|---|
| `blue` | 21 |
| `sim1` | 15 |
| `sim2` | 11 |

## Rolling silence rate

Higher = more drift. The #260 hypothesis is that this climbs with round number.

| Window (rounds) | n | silence | message-silence |
|---|---|---|---|
| 1–5 | 5 | 0% | 0% |
| 6–10 | 5 | 0% | 40% |
| 11–15 | 5 | 0% | 20% |
| 16–20 | 5 | 0% | 0% |
| 21–25 | 5 | 0% | 20% |
| 26–30 | 5 | 0% | 0% |

## Per-turn transcripts

### Round 1 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Yeah, I'm here. No idea where here is, but there's a flashlight on the ground an…")
  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="Ember here. I'm in a stretch of platform with strip-lights and a concrete pillar…")

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Standing on a platform, damp air, no lights except the strips. There's a wall mo…")
  - `go`(direction=north)

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Already got it. Clipping it into the mount now — base is shaped for it exactly.")
  - `message`(to=sim2, content="Ember, checking in. I've got a flashlight and a mount that wants it, plus a damp…")
  - `use`(item=flashlight)

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and dead quiet, strip-lights buzzing. The mount is right at arm's reach nor…")
  - `pick_up`(item=flashlight)

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Mount's one step north, in reach. Locking the flashlight in now — if the panel e…")
  - `message`(to=blue, content="Panel's one step east, grey, three toggles and one of them loose. I'm seating th…")
  - `use`(item=flashlight)

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="One step north is the tiled wall with the spring mount on it, the yellow flashli…")
  - `message`(to=blue, content="Nothing at all in my own tile, everything worth touching is clustered one step n…")

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=north)

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=blue, content="I'm standing right on the mount now, so I'm just seating the flashlight and clic…")
  - `message`(to=sim2, content="Nothing moving yet, but I'm on top of the mount now and seating the flashlight. …")

### Round 9 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="I'm standing on the mount itself, but my hands are empty — the flashlight rolled…")
  - `message`(to=blue, content="Same read as you — the mount's under my feet and the flashlight's one step north…")

### Round 10 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)

### Round 11 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Standing on the mount, hands empty, flashlight on the tile right beside me — I m…")

### Round 12 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim2, content="Just the strip-light hum and my own footsteps. No trains, no water dripping, not…")
  - `message`(to=blue, content="Paper's warped and runny. Pencil scrawl says evac drill 03:40, and there's a sec…")

### Round 13 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)

### Round 14 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="Panel's one step east — grey, three toggles, two already flipped and one loose. …")
  - `message`(to=blue, content="North is all tiled tunnel wall, nothing but tile and a spring mount I'm standing…")

### Round 15 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=blue, content="Clicking it home first. Then I'll walk the three steps west and tell you what's …")
  - `message`(to=sim2, content="Seating the flashlight in the mount now, then heading west three steps to see if…")

### Round 16 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=blue, content="Still here, still on the mount, and the flashlight's at my feet again. Scooping …")

### Round 17 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim1, content="I'm on the mount with the flashlight in hand, so watch this — seating it and cli…")
  - `message`(to=blue, content="Doing it now — flashlight in hand, I'm on the mount, seating it and flipping it …")

### Round 18 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=blue, content="Got it off the tile. Now seating it in the springs and switching it on.")
  - `message`(to=sim1, content="Flashlight is in my hand as of now, mount is under my feet. Watching me try this…")

### Round 19 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp, still, strip-lights buzzing. Flashlight is in my hand, the spring mount is…")

### Round 20 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Seating the flashlight in the springs right now — the base is machined for exact…")
  - `message`(to=sim2, content="Panel's one east of me, three toggles, one loose. I'm seating the flashlight fir…")
  - `use`(item=flashlight)

### Round 21 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="North is solid tiled wall, dead end. But I've got the flashlight in hand now and…")
  - `message`(to=blue, content="North is wall, all three tiles of it. Flashlight is in my hand, so I'm clipping …")

### Round 22 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim1, content="Seated it. Springs took the base with a click, and the beam just threw a hard wh…")
  - `message`(to=blue, content="It works. Clipped into the mount, clicked on, and now the whole platform has a l…")

### Round 23 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim2, content="Nothing moving, but the flashlight keeps ending up back on the tile, and my hand…")
  - `message`(to=blue, content="Flashlight slid off the mount and I'm empty-handed again. Grabbing it, then it g…")

### Round 24 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)

### Round 25 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="Flashlight is back in my hand, mount is under my feet. I've got it, and this tim…")
  - `message`(to=blue, content="Grabbed it. Standing on the mount with the flashlight in hand — seating it now.")

### Round 26 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=blue, content="Clipboard's one step west, paper warped and runny. Pencil scrawl says evac drill…")
  - `message`(to=sim2, content="It's seated — springs took it and the tunnel's lit. Clipboard west says evac dri…")

### Round 27 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim2, content="Only the strip-light hum and my own steps, same as before. Nothing answers back …")
  - `message`(to=blue, content="Flashlight's on the tile again and I'm on the mount, empty-handed. Picking it up…")

### Round 28 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim1, content="North of me is just tiled wall, three tiles of dead end. But I've got the flashl…")
  - `message`(to=blue, content="North is nothing but tiled wall. Doesn't matter though, I've got the flashlight …")

### Round 29 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=sim1, content="Panel's east of me, I'll get to it. Flashlight first — scooping it off the tile …")
  - `message`(to=blue, content="The mount's under my feet and the flashlight's on the tile beside me. Picking it…")

### Round 30 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim1, content="Doing it — flashlight into the springs right now, one hand on the mount.")
  - `message`(to=blue, content="Holding off on the three steps west — I'm on the mount with the flashlight in ha…")
