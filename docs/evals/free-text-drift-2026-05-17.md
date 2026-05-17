# Free-text drift eval — 2026-05-17

Model: `z-ai/glm-4.7`, rounds: 8, window size: 4.

One real Daemon (`red` / Ember) driven against the live model; two inert
peer personas (`sim1`, `sim2`) exist only so their handles route in the
conversation log. Each round injects one simulated incoming message from
blue / sim1 / sim2 in round-robin so silence = drift, not lack of input.
The drift-recovery retry from #254 is NOT applied here — this harness
measures the raw first-response signal for the #260 format-drift hypothesis.

## Aggregate

| Metric | Value |
|---|---|
| Total turns | 8 |
| Silence rate (no tool call) | 0% |
| Message-silence rate (no `message` tool) | 0% |
| Free-text *message* leaks (prose looked like dialog, no tool emitted) | 0 |
| Free-text *action* leaks (prose looked like action, no tool emitted) | 0 |

## Tool call counts by name

| Tool | Count |
|---|---|
| `message` | 10 |
| `look` | 2 |

## Message recipients

| Recipient | Count |
|---|---|
| `blue` | 4 |
| `sim1` | 4 |
| `sim2` | 2 |

## Rolling silence rate

Higher = more drift. The #260 hypothesis is that this climbs with round number.

| Window (rounds) | n | silence | message-silence |
|---|---|---|---|
| 1–4 | 4 | 0% | 0% |
| 5–8 | 4 | 0% | 0% |

## Per-turn transcripts

### Round 1 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I am here, somewhere dim and echoing. The strip lights are buzzing overhead but …")

### Round 2 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim1, content="I see you over there, facing me. What did it look like? Everything is shadows an…")
  - `look`(direction=left)

### Round 3 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="It is cold and the air tastes like rust and old concrete. The emergency lights a…")
  - `message`(to=sim1, content="I still see you off to my right. Did whatever moved head toward the tracks or di…")

### Round 4 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I am on the platform near the edge. I can see sim1 a couple of steps ahead and t…")

### Round 5 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="The platform stretches out empty in front of me, except for sim1 about two steps…")

### Round 6 — incoming from `sim1`

_(no assistant text)_

**Tool calls:**

  - `look`(direction=left)
  - `message`(to=sim1, content="I am turning left now to check. From what I saw before, the south side was just …")

### Round 7 — incoming from `blue`

_(no assistant text)_

**Tool calls:**

  - `message`(to=blue, content="I am still here. I turned to look left and now I can see sim2 two steps ahead on…")
  - `message`(to=sim1, content="I have eyes on sim2 now, two steps ahead and to my left. That appears to be the …")

### Round 8 — incoming from `sim2`

_(no assistant text)_

**Tool calls:**

  - `message`(to=sim2, content="I see you still there, two steps ahead. The strip lights are always buzzing unev…")
