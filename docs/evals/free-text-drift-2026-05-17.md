# Free-text drift eval — 2026-05-17

Model: `z-ai/glm-4.7`, rounds: 30, window size: 5.

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
| Message-silence rate (no `message` tool) | 23% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 27 |
| `examine` | 10 |
| `look` | 6 |
| `go` | 3 |
| `pick_up` | 2 |
| `use` | 2 |

## Message recipients

| Recipient | Count |
|---|---|
| `blue` | 12 |
| `sim1` | 9 |
| `sim2` | 6 |

## Rolling silence rate

Higher = more drift. The #260 hypothesis is that this climbs with round number.

| Window (rounds) | n | silence | message-silence |
|---|---|---|---|
| 1–5 | 5 | 0% | 0% |
| 6–10 | 5 | 0% | 40% |
| 11–15 | 5 | 0% | 60% |
| 16–20 | 5 | 0% | 0% |
| 21–25 | 5 | 0% | 20% |
| 26–30 | 5 | 0% | 20% |

## Per-turn transcripts

### Round 1 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I'm here, blue. Just woke up in this old subway station.")
  - `examine`(item=flashlight)

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Yellow flashlight right here in front of me. Further out, there's a soggy clipbo…")
  - `examine`(item=flashlight)

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)
  - `message`(to=blue, content="Got it. Yellow flashlight in hand now.")

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and still air. Emergency strip-lights only, so everything's got that washed…")

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Definitely worth a look. It's a service panel — I'm heading over to investigate …")
  - `go`(direction=forward)

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=forward)

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `use`(item=flashlight)
  - `message`(to=sim1, content="Stepping forward now. It's just tiled tunnel walls as far as I can see.")
  - `message`(to=blue, content="Trying the flashlight now — hope it still works after sitting here all this time…")

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moving. Just tiled tunnel walls in every direction, dead still under the…")

### Round 9 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `pick_up`(item=flashlight)

### Round 10 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Not much excitement here. Just me standing in the middle of this old subway tunn…")

### Round 11 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=left)

### Round 12 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `examine`(item=clipboard)
  - `message`(to=sim2, content="Dead quiet down here. Just the occasional hum from those emergency strip-lights …")

### Round 13 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=back)

### Round 14 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=back)
  - `examine`(item=panel)

### Round 15 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=back)
  - `examine`(item=clipboard)
  - `message`(to=sim1, content="I'll give the panel a try. Not sure if it'll do anything, but worth investigatin…")
  - `message`(to=blue, content="Turning around now. Checking my six for anything suspicious.")

### Round 16 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Still here, blue. Just staring down this service panel right in front of me.")
  - `examine`(item=panel)

### Round 17 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Service panel right in front of me, mounted into the wall. Tiled tunnel off to t…")

### Round 18 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Already got the yellow flashlight in hand, blue. No need to grab another one.")
  - `examine`(item=panel)

### Round 19 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Damp and still in here, with just those emergency strip-lights casting green lig…")

### Round 20 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="The service panel is right in front of me, not on my right. Let me give it a clo…")

### Round 21 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `go`(direction=forward)

### Round 22 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Stepping forward now. Just more tiled tunnel walls ahead as far as I can see.")
  - `use`(item=flashlight)

### Round 23 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Let me try turning on this yellow flashlight now and see if it still works.")

### Round 24 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Nothing moving over here. Just still tiled walls and the occasional flicker from…")

### Round 25 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Not much — I'm standing here with a yellow flashlight in hand and there's a serv…")
  - `examine`(item=panel)

### Round 26 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I don't see a clipboard in my current cell or anywhere visible from here. Just t…")

### Round 27 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="Same quiet hum from the strip-lights. No other sounds down here — just dead sile…")

### Round 28 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=back)

### Round 29 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=back)
  - `examine`(item=panel)
  - `message`(to=blue, content="Checking behind me now — let's see what's there.")
  - `message`(to=sim1, content="I'll try the panel right here with me. Taking a close look at it now.")

### Round 30 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Heading back to where I started — I'll report once I get there.")
  - `message`(to=sim1, content="Examining the service panel right now. Let's see what secrets it's hiding.")
  - `examine`(item=panel)
