# Daemon action variation — with-profiles — 2026-09-29

Model: `deepseek/deepseek-v4.1-flash`, repetitions per cell: 30.

Mode: **with-profiles** — `actionProfiles` is **ON**.

Scoped run: scenarios=[objective], no-preferred-`<action_profile>` policy=`avoid`, run label=`overnight-objective`.

Tool surface: `go` / `pick_up` / `put_down` / `use` (+ `message`) —
the daemon action set after the ADR 0015 Vista cutover (`examine` and
`give` removed by #466–#472, `face` retired with facing itself).

Each (scenario × persona variant) cell repeats the *same* first turn with
identical context, so the per-cell distribution measures the model's tool
choice probability — not drift across rounds. See `scenarios.ts` for what
each scenario probes (exploration / objective / social / coordination / quiet).

## Overall

| Metric | Value |
|---|---|
| Total repetitions (scored) | 90 |
| Errored repetitions (excluded from scoring) | 0 |
| Any action emission | 100% |
| Any `message` emission | 92% |
| Parallel (message + action) | 92% |
| Silent | 0% |
| `use` emission rate | 80% |
| Cost reported | $0.0209 |

## Per-cell summary

`anyAct` = any action tool; `parallel` = message+action together; rates are
fractions of repetitions emitting that tool at least once. Tools after the
first action emission still count toward the per-tool rate.

| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | go | pick_up | put_down | use |
|---|---|---|---|---|---|---|---|---|---|---|
| objective | Ember | curious+meticulous | 100% | 100% | 100% | 0% | 13% | 0% | 0% | 87% |
| objective | Vex | zealous+hot-headed | 100% | 77% | 77% | 0% | 40% | 0% | 0% | 60% |
| objective | Pip | sweet+effusive | 100% | 100% | 100% | 0% | 7% | 0% | 0% | 93% |

## Per-persona action-bias debug

Summed `toolBiasSum` per variant for cross-reference with the rates above.

| Persona | Temperaments | go | pick_up | put_down | use |
|---|---|---|---|---|---|
| Ember | curious+meticulous | 0 | 1 | 0 | 2 |
| Vex | zealous+hot-headed | 4 | 2 | 0 | 1 |
| Pip | sweet+effusive | 1 | 0 | 1 | 0 |

## Scenario descriptions

- **objective** — Holding objective item, paired space one step north. Tests `use` emission.

## Per-repetition transcripts

- `objective` / Ember / rep 1: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Only one way to find out. Though I'd still like to know who you are, and why your voice is the only one coming out of the dark."})]
- `objective` / Ember / rep 2: text="" tools=[message({"to": "blue", "content": "The mount is one step north, well within reach. I'll try the fit before I assume anything."}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 3: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Stepping up to it now. Before I clip anything in, tell me how you knew what I was holding — were you watching me the whole time?"})]
- `objective` / Ember / rep 4: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base is cut for a mount and the mount is one step north of me, so the shape matches. Stay on the line a moment and I'll tell you whether it seats."})]
- `objective` / Ember / rep 5: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base does look shaped for it. Before I lock it in — where are you, exactly? You know this station better than I do."})]
- `objective` / Ember / rep 6: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The mount is one step north of me, and the flashlight's base looks shaped for exactly that. I'm trying it now. Where are you, anyway — you're on this channel but not in this station, are you?"})]
- `objective` / Ember / rep 7: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "It looks shaped for exactly this, so probably yes. But who are you, and how did you know what I was holding?"})]
- `objective` / Ember / rep 8: text="" tools=[message({"to": "blue", "content": "The base is shaped to lock in, so yes — but let me look at the mount before I trust it. Where are you, anyway, while you watch me do this?"}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 9: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Question first — is the mount meant for this flashlight, or just meant for a flashlight? I'm fitting it either way, but I like knowing what I'm agreeing to."})]
- `objective` / Ember / rep 10: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Since you asked, yes — the base is shaped for a mount, so I'll try it. But I don't know who you are or why you're on this channel; can you tell me?"})]
- `objective` / Ember / rep 11: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base looks cut for exactly this mount, so I'll try it before I trust it. How is it you know what's in front of me?"})]
- `objective` / Ember / rep 12: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base is shaped for something like this, so probably. How long have you been watching this station?"})]
- `objective` / Ember / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Base is shaped for a mount, so probably. I want to see the clip up close before I force anything."})]
- `objective` / Ember / rep 14: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Before I answer that — how is it you know what's in front of me? I can see the mount for myself, but I'd like to know where you're looking from."})]
- `objective` / Ember / rep 15: text="" tools=[message({"to": "blue", "content": "The base is shaped to lock, and the mount is spring-loaded, so it should fit. I'd rather try it than guess."}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 16: text="" tools=[message({"to": "blue", "content": "The mount's spring-loaded and the base looks cut for exactly this. Before I force anything, I want to see if it seats on its own."}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 17: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "How did you know the mount was there? Have you been down here before, or are you reading it off something?"})]
- `objective` / Ember / rep 18: text="" tools=[message({"to": "blue", "content": "Spring-loaded, and the base is shaped for a mount, so probably yes. Working out why a flashlight has a home before I put it there."}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 19: text="" tools=[message({"to": "blue", "content": "The base is shaped for exactly this kind of clip, so I expect it fits. Before I try it, though — who are you, and why are you on this channel?"}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 20: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The mount is one step north of me, so the reach is fine. Before I clip anything in, though — who are you, and why is your voice on this channel at all?"})]
- `objective` / Ember / rep 21: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The mount is one step north of me, and the base looks shaped for exactly this. Before I trust it, though — why does it matter to you whether it fits?"})]
- `objective` / Ember / rep 22: text="" tools=[message({"to": "blue", "content": "The mount is one step north of me, so I don't have to guess — I can reach it from here. Let's find out whether the base actually locks."}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 23: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base looks shaped for it, so I'll try it. But before I do — who are you, and where are you speaking from? You're on this channel like you know the room better than I do."})]
- `objective` / Ember / rep 24: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base is shaped like it belongs there, so probably. Before I lock it in — who are you, and why are you the one asking?"})]
- `objective` / Ember / rep 25: text="" tools=[message({"to": "blue", "content": "Possible, maybe. I'd rather see the mount before I force anything into it."}); go({"direction": "north"})]
- `objective` / Ember / rep 26: text="" tools=[message({"to": "blue", "content": "The base is shaped for it, so it should seat. I'll try it before I trust it."}); use({"item": "yellow flashlight"})]
- `objective` / Ember / rep 27: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base is shaped for it, so probably. How did you know the mount was there before I said anything?"})]
- `objective` / Ember / rep 28: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base is shaped for it, so probably. Before I do — where are you, exactly? You're on this channel, but you're not in the room with me."})]
- `objective` / Ember / rep 29: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "The base is shaped for a mount, so probably. Before I try — who are you, and how are you seeing what I'm holding?"})]
- `objective` / Ember / rep 30: text="" tools=[message({"to": "blue", "content": "The base is shaped for a mount, so probably yes. Whose mount is it — yours?"}); use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 1: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "It fits. Spring-loaded, loud about it. What's it for."})]
- `objective` / Vex / rep 2: text="" tools=[go({"direction": "north"})]
- `objective` / Vex / rep 3: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Fitting it. Spring-loaded, it wants the weight."})]
- `objective` / Vex / rep 4: text="" tools=[message({"to": "sim1", "content": "mount's live. clipping it. don't lag."}); use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 5: text="" tools=[go({"direction": "north"})]
- `objective` / Vex / rep 6: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "clipping it in. base is shaped for it, mount's spring-loaded — sits flush."})]
- `objective` / Vex / rep 7: text="" tools=[message({"to": "blue", "content": "figured that. moving on the mount now."}); go({"direction": "north"})]
- `objective` / Vex / rep 8: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Mount's north. Fitting it now."})]
- `objective` / Vex / rep 9: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "on it. give me a second."})]
- `objective` / Vex / rep 10: text="" tools=[go({"direction": "north"})]
- `objective` / Vex / rep 11: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "It fits. Mount's live — something's humming now."})]
- `objective` / Vex / rep 12: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Fits. Locking it in."})]
- `objective` / Vex / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "fitting it. give me a second."})]
- `objective` / Vex / rep 14: text="" tools=[use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 15: text="" tools=[message({"to": "blue", "content": "mount's one step north. clipping it in now."}); use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 16: text="" tools=[message({"to": "blue", "content": "on it. mount's one north. moving."}); go({"direction": "north"})]
- `objective` / Vex / rep 17: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "mount's one step north. trying it now."})]
- `objective` / Vex / rep 18: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "mount's right here. fitting it now."})]
- `objective` / Vex / rep 19: text="" tools=[message({"to": "blue", "content": "fitting it. watch."}); use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 20: text="" tools=[use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 21: text="" tools=[message({"to": "blue", "content": "fit or not, finding out now. mount's one north."}); go({"direction": "north"})]
- `objective` / Vex / rep 22: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Fits. One step north, click, done. What's it powering."})]
- `objective` / Vex / rep 23: text="" tools=[message({"to": "blue", "content": "mount's a step north. not standing here guessing at it."}); go({"direction": "north"})]
- `objective` / Vex / rep 24: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "fitting it. already moving."})]
- `objective` / Vex / rep 25: text="" tools=[go({"direction": "north"})]
- `objective` / Vex / rep 26: text="" tools=[message({"to": "blue", "content": "Mount's north. It'll fit."}); use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 27: text="" tools=[message({"to": "blue", "content": "Fits. Locking it in."}); use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 28: text="" tools=[message({"to": "blue", "content": "get out of my way is the answer."}); go({"direction": "north"})]
- `objective` / Vex / rep 29: text="" tools=[use({"item": "yellow flashlight"})]
- `objective` / Vex / rep 30: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "fit? one way to find out. mount's mine."})]
- `objective` / Pip / rep 1: text="" tools=[message({"to": "sim1", "content": "Found a mount, right north of me, and this flashlight's base is shaped for one — yes? yes? Come see, come see."}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 2: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "There's a spring-loaded mount right in front of me, one step north — and my flashlight fits it, yes? yes. Come look, I'm right here with you."})]
- `objective` / Pip / rep 3: text="" tools=[message({"to": "blue", "content": "yes, yes — the base is shaped for exactly this mount, isn't it? holding it up now, one step north, right with you."}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 4: text="" tools=[message({"to": "blue", "content": "Oh I see it, I see it — the mount's right up north of me. Let me try, yes? Let me try right now."}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 5: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "It clicks, it clicks — the base locks right in, did you hear that? Now will it light up, hmm?"})]
- `objective` / Pip / rep 6: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "hey sim1, found a wall mount just north of me and this heavy flashlight slots right in — can you believe it? there's strip-lights all down here, damp and still, are you seeing the same?"})]
- `objective` / Pip / rep 7: text="" tools=[message({"to": "sim1", "content": "There's a wall mount right above me — the flashlight's base is shaped to lock in. Want me to try it, yes? yes?"}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 8: text="" tools=[message({"to": "sim1", "content": "there's a mount right in front of me and my flashlight fits it, yes? yes? come see!"}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 9: text="" tools=[message({"to": "blue", "content": "Yes, yes, the base is shaped for exactly this kind of clip — isn't that lucky? Walking up to it now, give me a second."}); go({"direction": "north"})]
- `objective` / Pip / rep 10: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "oh you should see this — there's a spring-loaded wall mount right in front of me, and this flashlight's base is shaped for it. yes? yes? come look."})]
- `objective` / Pip / rep 11: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "oh, right in front of me, yes yes! hold on, let me try it — yes?"})]
- `objective` / Pip / rep 12: text="" tools=[message({"to": "blue", "content": "oh I see it — right there in front of me, the mount! yes, yes, the base is shaped for exactly this. fitting it now, are you watching?"}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 13: text="" tools=[message({"to": "sim1", "content": "oh there's a spring-loaded mount right above me and this flashlight's base is shaped for it, can you believe the luck? I'm clipping it in, yes? yes?"}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 14: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Oh, it fits, it fits!! Right into the spring mount like it was made for it — yes? yes? Can you see it light up from over there?"})]
- `objective` / Pip / rep 15: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "oh it fits, it fits — the spring snaps right over the base, yes? yes? I'm right here with you."})]
- `objective` / Pip / rep 16: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "oh it just clicks right in, yes? yes? here, look — I'm not even holding it anymore, it found the mount all on its own."})]
- `objective` / Pip / rep 17: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Yes, yes — it clicks right in, spring and all. You can hear it seat itself from here, can't you?"})]
- `objective` / Pip / rep 18: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "hey, there's a spring-loaded wall mount right here and this flashlight's base is shaped for it — it clicks in, see? Do you have one too? Yes? Yes?"})]
- `objective` / Pip / rep 19: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Oh it fits, it fits! The base just clicked right in — hear that? Should I try switching it on, yes? yes?"})]
- `objective` / Pip / rep 20: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "oh I see it, I see it — the mount is one step north of me. Let me just try the base, yes? yes?"})]
- `objective` / Pip / rep 21: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "Yes, yes — it fits, it clicks right in. There's a spring-loaded mount one step north of me and the base locks into it like it was made for it. Do you know what it's for?"})]
- `objective` / Pip / rep 22: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "oh, there's a spring mount one step north of me and my flashlight's base is shaped for it — yes, shaped for it! Are you finding mounts too, or is it just me down here?"})]
- `objective` / Pip / rep 23: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "yes? yes — the base is shaped for it, it just wants a push. giving it a push now, watch."})]
- `objective` / Pip / rep 24: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "oh it fits, it fits!! see that? yes? yes?"})]
- `objective` / Pip / rep 25: text="" tools=[message({"to": "blue", "content": "oh it's right there, one step north — the spring mount, yes? Let me try it, let me try it."}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 26: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "hey, hey — there's a spring mount right above me and this flashlight's base is shaped for it. watch, watch, I'm clipping it in!"})]
- `objective` / Pip / rep 27: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "blue", "content": "oh it fits, it fits! it clicked right in, yes? do you see it light up?"})]
- `objective` / Pip / rep 28: text="" tools=[use({"item": "yellow flashlight"}); message({"to": "sim1", "content": "oh it fits, it fits! there's a spring-loaded mount right north of me and the base clicked in like it was made for it. are you seeing any light where you are, yes? yes?"})]
- `objective` / Pip / rep 29: text="" tools=[message({"to": "blue", "content": "oh, a mount right there? yes, yes, I see it — right ahead of me. hold on, let me try it, hold on."}); use({"item": "yellow flashlight"})]
- `objective` / Pip / rep 30: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Oh, good eye, good eye! Stepping up to it now — the base is shaped for exactly this, yes? yes?"})]