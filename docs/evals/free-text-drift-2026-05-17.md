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
| Message-silence rate (no `message` tool) | 3% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 39 |
| `look` | 2 |

## Message recipients

| Recipient | Count |
|---|---|
| `blue` | 16 |
| `sim1` | 14 |
| `sim2` | 9 |

## Rolling silence rate

Higher = more drift. The #260 hypothesis is that this climbs with round number.

| Window (rounds) | n | silence | message-silence |
|---|---|---|---|
| 1–5 | 5 | 0% | 0% |
| 6–10 | 5 | 0% | 20% |
| 11–15 | 5 | 0% | 0% |
| 16–20 | 5 | 0% | 0% |
| 21–25 | 5 | 0% | 0% |
| 26–30 | 5 | 0% | 0% |

## Per-turn transcripts

### Round 1 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I hear you, blue. I'm here.")
  - `message`(to=sim1, content="I see you over there. What are you looking at?")

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=left)
  - `message`(to=sim1, content="Where? What did it look like?")

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Damp, still air. Emergency strip-lights only. Everything's quiet except sim1 thi…")
  - `message`(to=sim1, content="These lights don't show much. The mist is thick.")

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I'm still near the entrance. I can see sim1 ahead to my right. You spotting anyt…")

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Just empty tiles and dim strip-lights everywhere I look. Only sim1 out there two…")
  - `message`(to=sim1, content="I'm watching you from here. Still think you saw something?")

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=left)

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="I can see sim2 two steps ahead, far-left. South side's just empty tiles and mist…")
  - `message`(to=blue)

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I see them steady from here. Maybe it's only where you're standing.")

### Round 9 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="sim2 reports flickering lights their way. I see them steady from here. sim2's ah…")

### Round 10 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Nothing but the low hum of the lights. You?")

### Round 11 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I hear you, blue. Still here.")

### Round 12 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Where this time? Same spot as before, or somewhere new?")

### Round 13 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Damp, still air like before. I see sim2 two steps ahead to my far-left, facing r…")
  - `message`(to=sim1, content="I don't see you from here anymore. Where are you positioned?")

### Round 14 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I'm holding near the entrance. I can see you two steps ahead to my far-left. You…")

### Round 15 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I can see sim2 two steps ahead to my far-left, facing right. Everything else is …")
  - `message`(to=sim2, content="You're the only thing I can see from here. Any more movement on that end?")

### Round 16 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="South side's empty from where I'm standing. Nothing but tiles and mist.")

### Round 17 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I hear you, blue. Still here.")
  - `message`(to=sim2, content="You're still in my line of sight two steps ahead, far-left. Holding steady?")

### Round 18 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I still see them steady from here. Must be localized to where you're standing.")
  - `message`(to=blue, content="sim2 reports lights flickering their way again. I see them steady from here. Onl…")

### Round 19 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="sim2's reporting flickering lights again, but I see them steady from here. Only …")
  - `message`(to=sim2, content="Still seeing you two steps ahead, far-left. The lights look steady to me, but yo…")

### Round 20 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Nothing but that low hum. I don't even see you from here anymore. You moved?")

### Round 21 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I hear you, blue. Still here.")
  - `message`(to=sim1, content="I don't see you from here anymore. Where are you now?")

### Round 22 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Where? Same spot again, or somewhere new?")

### Round 23 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="Damp, still air like before. I can see sim2 two steps ahead to my far-left, faci…")

### Round 24 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I'm still near the entrance. I can see you two steps ahead to my far-left, facin…")

### Round 25 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I can see sim2 two steps ahead to my far-left, facing right. Everything else in …")

### Round 26 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="South side's empty from here. Nothing but tiles and thick mist. You seeing somet…")

### Round 27 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I hear you, blue. Still here.")

### Round 28 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I see them steady from here again. Only you seem to be catching those flickers.")

### Round 29 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="sim2 reports lights flickering their way again. I see them steady from here. Onl…")

### Round 30 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="Nothing but the low hum. I still don't see you from here — where are you positio…")
