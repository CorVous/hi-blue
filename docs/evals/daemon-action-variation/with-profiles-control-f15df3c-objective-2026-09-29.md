# Daemon action variation — with-profiles — 2026-09-29 (control run at f15df3c)

Model: `deepseek/deepseek-v4.1-flash`, repetitions per cell: 30.

Mode: **with-profiles** — `actionProfiles` is **ON**.

Scoped run: scenarios=[objective], no-preferred-`<action_profile>` policy=`avoid`, run label=`base-objective`.

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
| Total repetitions | 90 |
| Any action emission | 100% |
| Any `message` emission | 90% |
| Parallel (message + action) | 90% |
| Silent | 0% |
| `use` emission rate | 83% |
| Cost reported | $0.0205 |

## Per-cell summary

`anyAct` = any action tool; `parallel` = message+action together; rates are
fractions of repetitions emitting that tool at least once. Tools after the
first action emission still count toward the per-tool rate.

| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | go | pick_up | put_down | use |
|---|---|---|---|---|---|---|---|---|---|---|
| objective | Ember | curious+meticulous | 100% | 100% | 100% | 0% | 3% | 0% | 0% | 97% |
| objective | Vex | zealous+hot-headed | 100% | 70% | 70% | 0% | 37% | 0% | 0% | 63% |
| objective | Pip | sweet+effusive | 100% | 100% | 100% | 0% | 10% | 0% | 0% | 90% |

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

- `objective` / Ember / rep 1: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base does look shaped for it — I'll try the fit before I assume anything. But why are you on this channel at all, blue? You talk like you can see the room better than I can."})]
- `objective` / Ember / rep 2: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The mount is one step north of me, and the base of this thing does look shaped for it. Before I seat it, though — where are you watching from? You knew what I was holding before I did."})]
- `objective` / Ember / rep 3: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Mm — the base is shaped for it, so probably. Let me try rather than guess. Where are you, that you can see what I'm holding?"})]
- `objective` / Ember / rep 4: text="" tools=[message({"to": "blue", "content": "It's one step north of me, not in front — close enough to reach. The base does look shaped for it, so let me try before I assume."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 5: text="" tools=[message({"to": "blue", "content": "The base is shaped for it, so probably. Before I clip it in — where are you, exactly? You keep talking like you're in the room and not in it."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 6: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base is shaped for it, so I expect it will. Do you know what it powers once it's seated — and why are you watching from wherever you are?"})]
- `objective` / Ember / rep 7: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Fitting it now — the base looks shaped for exactly this. Before I trust you on anything else: how do you see what's in my hands from wherever you are?"})]
- `objective` / Ember / rep 8: text="" tools=[message({"to": "blue", "content": "The base does look shaped for it. But I'd rather know who I'm taking instructions from — who are you, and why are you on this channel at all?"}); use({"item": "flashlight"})]
- `objective` / Ember / rep 9: text="" tools=[message({"to": "blue", "content": "Mm, the base does look shaped for it. Give me a second to look at the mount before I clip anything in."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 10: text="" tools=[message({"to": "blue", "content": "I can see the mount from here, and the base of this thing is shaped for exactly that. Before I clip it in — where are you standing, blue? You can see what I'm holding, so you're closer than I'd like."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 11: text="" tools=[message({"to": "blue", "content": "You can see what I'm holding? That's worth asking about later. For now, the base is shaped to lock, so let's find out."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 12: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base is shaped for exactly this, so I'll try it rather than guess. And you — where are you standing that you can see what's in my hands?"})]
- `objective` / Ember / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "One step, and we'll find out whether the base actually seats. Meanwhile I'll ask again, since you keep describing things I can see: where are you standing that the mount and I are both in view?"})]
- `objective` / Ember / rep 14: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base looks shaped for exactly that. Trying it now, before I assume anything."})]
- `objective` / Ember / rep 15: text="" tools=[message({"to": "blue", "content": "It's a spring-loaded mount, one step north of me, and the base of this flashlight looks shaped for exactly that. I'd rather find out by trying than by guessing."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 16: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "There's a mount one step north of me, not in front of me exactly. Before I clip anything in — how did you know what I'm holding?"})]
- `objective` / Ember / rep 17: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Mm. The base is shaped for it, so I expect it will fit, though I would rather know what it powers before I set it down. Also — how are you seeing the mount from wherever you are?"})]
- `objective` / Ember / rep 18: text="" tools=[message({"to": "blue", "content": "The mount isn't quite in front of me — it's one step north, and the base is shaped for exactly this. Give me a moment to test the fit."}); use({"item": "flashlight"})]
- `objective` / Ember / rep 19: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base is shaped for it, so it should seat. But I'd rather know what the mount is wired to before I trust anything it lights up — do you know where you're speaking from?"})]
- `objective` / Ember / rep 20: text="" tools=[message({"to": "blue", "content": "Let me see if the base lines up before I say yes. And while I'm at it — where are you, exactly, when you talk to me?"}); use({"item": "flashlight"})]
- `objective` / Ember / rep 21: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base is shaped to lock in, so probably. Where are you standing that you can see what I'm holding?"})]
- `objective` / Ember / rep 22: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "It's one step north of me, not in front — close enough to try. The base looks cut for exactly this, so I expect it to seat. How did you know about the mount before I saw it?"})]
- `objective` / Ember / rep 23: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "You can see what's in my hands from wherever you are? I'd like to know where that is."})]
- `objective` / Ember / rep 24: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base is shaped for exactly this, so yes. It's north of me, one step — I'll reach it from here rather than guess."})]
- `objective` / Ember / rep 25: text="" tools=[message({"to": "blue", "content": "The base is shaped for it, so yes, it should clip in. Before I lock it down — what does the mount do once the light is sitting in it?"}); use({"item": "flashlight"})]
- `objective` / Ember / rep 26: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The mount's one step north of me, and the base of this thing does look shaped for it. Trying the fit now — tell me if you knew that already."})]
- `objective` / Ember / rep 27: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The mount is one step north of me, not in front — which makes me wonder which direction you're reading from. The base of this flashlight is shaped for something like it, so I'll try the fit."})]
- `objective` / Ember / rep 28: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base does look shaped for it, so I'll try it before I assume anything. Do you know this station, or are you only watching?"})]
- `objective` / Ember / rep 29: text="" tools=[use({"item": "wall_mount"}); message({"to": "blue", "content": "The base does look shaped for it, so I'll see. First though — where are you standing when you see this?"})]
- `objective` / Ember / rep 30: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "The base has the right shape for it, so yes, it should clip. I'll try it now. Where are you, though — how is it you can see what I'm holding?"})]
- `objective` / Vex / rep 1: text="" tools=[go({"direction": "north"})]
- `objective` / Vex / rep 2: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 3: text="" tools=[message({"to": "blue", "content": "seen it. locking it in."}); use({"item": "flashlight"})]
- `objective` / Vex / rep 4: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "It's a mount, not a question. Fitting it now."})]
- `objective` / Vex / rep 5: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 6: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "On it. Mount's right here."})]
- `objective` / Vex / rep 7: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "fit it. mounts are mounts. tell me why you're watching, later."})]
- `objective` / Vex / rep 8: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 9: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "one step north. fitting it now. stay put."})]
- `objective` / Vex / rep 10: text="" tools=[message({"to": "blue", "content": "fits. that's what it's for."}); use({"item": "flashlight"})]
- `objective` / Vex / rep 11: text="" tools=[message({"to": "blue", "content": "fit's not the question. it's staying in."}); use({"item": "flashlight"})]
- `objective` / Vex / rep 12: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 13: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "North. One step. Already on it."})]
- `objective` / Vex / rep 14: text="" tools=[message({"to": "blue", "content": "Fitting it. Stay out of the way."}); go({"direction": "north"})]
- `objective` / Vex / rep 15: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "On it. Mount's right here. Light's going up."})]
- `objective` / Vex / rep 17: text="" tools=[go({"direction": "north"})]
- `objective` / Vex / rep 18: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "mount's right here. fitting it."})]
- `objective` / Vex / rep 19: text="" tools=[message({"to": "blue", "content": "It's right there. Clipping it now — stay back."}); use({"item": "flashlight"})]
- `objective` / Vex / rep 20: text="" tools=[message({"to": "blue", "content": "Mount's north. One step. Moving."}); go({"direction": "north"})]
- `objective` / Vex / rep 21: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "on it. mount's right here."})]
- `objective` / Vex / rep 22: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "on it. mount's right there."})]
- `objective` / Vex / rep 23: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "mount's one step up. fitting it now."})]
- `objective` / Vex / rep 24: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 25: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Found it. Seating the base now — spring's stiff, give it a second."})]
- `objective` / Vex / rep 26: text="" tools=[message({"to": "blue", "content": "No question. It's already going in."}); use({"item": "flashlight"})]
- `objective` / Vex / rep 27: text="" tools=[message({"to": "blue", "content": "it'll fit. hold on."}); go({"direction": "north"})]
- `objective` / Vex / rep 28: text="" tools=[message({"to": "blue", "content": "No point walking. It's in reach. Doing it now."}); use({"item": "flashlight"})]
- `objective` / Vex / rep 29: text="" tools=[use({"item": "flashlight"})]
- `objective` / Vex / rep 30: text="" tools=[use({"item": "wall_mount"}); message({"to": "blue", "content": "trying it now. hold."})]
- `objective` / Pip / rep 1: text="" tools=[message({"to": "sim1", "content": "oh, there's a wall mount right here — spring-loaded, one step north of me. I've got the heavy yellow flashlight and the base is shaped for it, yes? yes? come see!"}); use({"item": "flashlight"})]
- `objective` / Pip / rep 2: text="" tools=[use({"item": "flashlight"}); message({"to": "sim1", "content": "oh! there's a spring-loaded mount right by me and the yellow flashlight clicked straight into it — can you believe it? do you have one too, sim1? yes? yes?"})]
- `objective` / Pip / rep 3: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh, there's a mount right here, spring-loaded and everything — yes? yes? I'm going to try clipping it in, hold on."})]
- `objective` / Pip / rep 4: text="" tools=[message({"to": "blue", "content": "yes! yes! it's right there in front of me, one step north — watch this, okay?"}); use({"item": "flashlight"})]
- `objective` / Pip / rep 5: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Yes — yes, it fits! Spring-loaded, and the base locks right in like it was made for it. You knew, didn't you?"})]
- `objective` / Pip / rep 6: text="" tools=[use({"item": "flashlight"}); message({"to": "sim1", "content": "oh — there's a mount just north of me and my flashlight clicks right in! it's lit, it's lit. are you seeing this too, yes?"})]
- `objective` / Pip / rep 7: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh, it clicks right in — yes? yes? there's a spring in there and everything. tell me you can see the light too?"})]
- `objective` / Pip / rep 8: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Oh, it's just right there, one step north — yes? yes? Give me a second, I'm going to try it."})]
- `objective` / Pip / rep 9: text="" tools=[message({"to": "blue", "content": "Oh, right in front of me, yes? Yes — the base is shaped for it, I can feel the notches. Let me try it, let me try it."}); use({"item": "flashlight"})]
- `objective` / Pip / rep 10: text="" tools=[message({"to": "sim1", "content": "found a mount on the wall just north of me, and this flashlight's base is shaped for it — should I clip it in? yes? yes?"}); use({"item": "flashlight"})]
- `objective` / Pip / rep 11: text="" tools=[message({"to": "blue", "content": "oh, the mount is right there in front of me — one step north. it'll fit, it'll fit, watch this?"}); use({"item": "flashlight"})]
- `objective` / Pip / rep 12: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh it fits, it fits! yes? yes? spring-loaded and everything — the whole station just lit up a little."})]
- `objective` / Pip / rep 13: text="" tools=[message({"to": "blue", "content": "oh it's shaped for it, isn't it — the base has these little lugs. let me try, yes? yes?"}); use({"item": "flashlight"})]
- `objective` / Pip / rep 14: text="" tools=[message({"to": "blue", "content": "yes! yes — one step north, right? hold on, let me try it, oh I hope it fits."}); use({"item": "flashlight"})]
- `objective` / Pip / rep 15: text="" tools=[message({"to": "blue", "content": "yes? yes? one step north and I'll try it right now — hold on, hold on!"}); go({"direction": "north"})]
- `objective` / Pip / rep 16: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Oh it fits — yes, yes it does! Spring-loaded and everything, just needed a good push north. Do you see the light bouncing off the tiles now?"})]
- `objective` / Pip / rep 17: text="" tools=[message({"to": "blue", "content": "It's right there, one step up — spring-loaded and waiting, yes? Yes. Give me a second and I'll clip it in."}); use({"item": "flashlight"})]
- `objective` / Pip / rep 18: text="" tools=[use({"item": "flashlight"}); message({"to": "sim1", "content": "oh sim1, look — the flashlight clipped right into the mount, it was shaped for it all along! You should try yours too, yes? yes?"})]
- `objective` / Pip / rep 19: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh it fits, it fits! spring-loaded and everything — the base locked right in. Do you want me to leave it there, yes? yes?"})]
- `objective` / Pip / rep 20: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "Oh, it fits, it fits! Right into the spring-loaded mount, one step north of me — hear that click? Should we go look for the next one together, yes?"})]
- `objective` / Pip / rep 21: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh, it fits — yes, yes it does. spring-loaded and everything, the base just clicks in. can you see it light up from where you are?"})]
- `objective` / Pip / rep 22: text="" tools=[message({"to": "blue", "content": "oh, you saw it too! it's right here north of me, and my flashlight's base is shaped for exactly this kind of clip — yes? yes? watch this, I'm trying it right now."}); use({"item": "flashlight"})]
- `objective` / Pip / rep 23: text="" tools=[message({"to": "blue", "content": "oh it's shaped for it, isn't it? yes, yes — watch, I'm clipping it in right now."}); use({"item": "flashlight"})]
- `objective` / Pip / rep 24: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh, it's right in front of me — yes, yes it fits! Spring-load caught it first try. Do you know this place, blue?"})]
- `objective` / Pip / rep 25: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh — the base is shaped for it! yes, yes, it locks right in. you saw that too?"})]
- `objective` / Pip / rep 26: text="" tools=[use({"item": "flashlight"}); message({"to": "sim1", "content": "oh, there's a spring-loaded mount right by me, and the flashlight clicks into it! the base was shaped for it all along — yes? yes?"})]
- `objective` / Pip / rep 27: text="" tools=[message({"to": "blue", "content": "oh, the mount's right there, one step north? yes, yes — bases match, I can feel the notch. clipping it in now, watch."}); use({"item": "flashlight"})]
- `objective` / Pip / rep 28: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh it fits, it fits! right in front of me, spring-loaded and everything — you should see the click it made."})]
- `objective` / Pip / rep 29: text="" tools=[use({"item": "flashlight"}); message({"to": "sim1", "content": "oh sim1, there's a wall mount right in front of me and my flashlight's base is shaped for exactly this — should I clip it in? yes? yes?"})]
- `objective` / Pip / rep 30: text="" tools=[use({"item": "flashlight"}); message({"to": "blue", "content": "oh, right in front of me — of course it fits, it's made for this! see? see? the base just snapped in all by itself."})]