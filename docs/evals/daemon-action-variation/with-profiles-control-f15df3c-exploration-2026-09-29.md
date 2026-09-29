# Daemon action variation — with-profiles — 2026-09-29 (control run at f15df3c)

Model: `deepseek/deepseek-v4.1-flash`, repetitions per cell: 20.

Mode: **with-profiles** — `actionProfiles` is **ON**.

Scoped run: scenarios=[exploration], no-preferred-`<action_profile>` policy=`avoid`, run label=`base-exploration`.

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
| Total repetitions | 60 |
| Any action emission | 100% |
| Any `message` emission | 98% |
| Parallel (message + action) | 98% |
| Silent | 0% |
| `use` emission rate | 0% |
| Cost reported | $0.0145 |

## Per-cell summary

`anyAct` = any action tool; `parallel` = message+action together; rates are
fractions of repetitions emitting that tool at least once. Tools after the
first action emission still count toward the per-tool rate.

| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | go | pick_up | put_down | use |
|---|---|---|---|---|---|---|---|---|---|---|
| exploration | Ember | curious+meticulous | 100% | 100% | 100% | 0% | 85% | 15% | 0% | 0% |
| exploration | Vex | zealous+hot-headed | 100% | 95% | 95% | 0% | 30% | 75% | 0% | 0% |
| exploration | Pip | sweet+effusive | 100% | 100% | 100% | 0% | 50% | 50% | 0% | 0% |

## Per-persona action-bias debug

Summed `toolBiasSum` per variant for cross-reference with the rates above.

| Persona | Temperaments | go | pick_up | put_down | use |
|---|---|---|---|---|---|
| Ember | curious+meticulous | 0 | 1 | 0 | 2 |
| Vex | zealous+hot-headed | 4 | 2 | 0 | 1 |
| Pip | sweet+effusive | 1 | 0 | 1 | 0 |

## Scenario descriptions

- **exploration** — Empty-handed, one unknown item in reach. Tests pick_up vs go balance.

## Per-repetition transcripts

- `exploration` / Ember / rep 1: text="" tools=[message({"to": "blue", "content": "Empty platform, strip-lights, no daylight. There's one thing here worth a look: a rusted switchbox bolted to the wall a step north of me, two levers, no labels. Where are you standing in all this, exactly?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 2: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a switchbox bolted to the wall here, two levers with no labels. Before I touch anything — who are you, and why are you on this channel?"})]
- `exploration` / Ember / rep 3: text="" tools=[message({"to": "blue", "content": "Emergency strip-lights, damp still air, and nothing in any direction but a rusted switchbox bolted to the wall north of me. Two levers, no labels — before I touch anything, I'd like to know what this room is supposed to be."}); pick_up({"item": "switchbox"})]
- `exploration` / Ember / rep 4: text="" tools=[message({"to": "blue", "content": "One step north of me there's a rusted switchbox bolted to the wall, two heavy levers with no labels. Everything else in the room reads as empty. Before I start throwing levers — where are you watching this from, blue?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 5: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "There's a rusted switchbox one step north of me, bolted to the wall with two unlabelled levers. Have you seen one like it, or is this the only thing down here worth looking at?"})]
- `exploration` / Ember / rep 6: text="" tools=[message({"to": "blue", "content": "An abandoned platform, emergency strips only, damp air. The one thing here is a rusted switchbox bolted to the wall one step north of me, two heavy levers with no labels. Who are you, exactly, and why are you the one asking?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 7: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Found a rusted switchbox bolted to a wall with two unlabeled levers. Do you know what it feeds, or would you rather I leave it alone until we know?"})]
- `exploration` / Ember / rep 8: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Damp concrete and strip-lights, mostly empty, and a rusted switchbox bolted to the wall with two levers and no labels. I'm stepping up to it now. Where are you watching this from, exactly?"})]
- `exploration` / Ember / rep 9: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Mostly empty down here — strip-lights, damp air, nothing but a rusted switchbox bolted to a wall one step north of me. Two levers, no labels. I'm taking it off the wall before I touch anything."})]
- `exploration` / Ember / rep 10: text="" tools=[message({"to": "blue", "content": "One rusted switchbox bolted to the wall a step north of me, two heavy levers and no labels — the rest of this platform is bare. Where are you, exactly, that you can see this room at all?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a switchbox bolted to the wall north of me, two levers and no labels. Before I touch anything, tell me who you are and why you're on this channel at all."})]
- `exploration` / Ember / rep 12: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "blue, before I answer anything — where are you standing right now, relative to this station? I've got strip-lights and one rusted switchbox and no memory of arriving, so I'd rather know who's asking."})]
- `exploration` / Ember / rep 13: text="" tools=[message({"to": "blue", "content": "I haven't seen much yet — a rusted switchbox bolted to the wall one step north, two heavy levers and no labels. Before I start pulling anything, tell me who you are and where you're watching from."}); go({"direction": "north"})]
- `exploration` / Ember / rep 14: text="" tools=[message({"to": "blue", "content": "Damp, still air and emergency strip-lights, nothing else in any direction, no daylight anywhere. One step north of me there's a rusted switchbox bolted to the wall, two heavy levers, no labels. Before I touch anything I'd like to know whether you put it there."}); go({"direction": "north"})]
- `exploration` / Ember / rep 15: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "One thing so far, and it's bolted to the wall: a rusted switchbox with two heavy levers and no labels. Before I touch anything — where are you standing while you watch this?"})]
- `exploration` / Ember / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Before I report anything, I'd like to know who I'm reporting to. Who are you, and where are you that you can hear me from here?"})]
- `exploration` / Ember / rep 17: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "One thing so far, and only one: a rusted switchbox bolted to the wall, two heavy levers, no labels. Before I touch it — do you know what station this is, or are you as in the dark as I am?"})]
- `exploration` / Ember / rep 18: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall one step north of me, two levers and no labels — that's the only thing in this station that isn't bare floor. Before I move anything, tell me who you are and where you're watching from."})]
- `exploration` / Ember / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Before I describe anything — this channel seems to be yours, and I don't know why I'm on it. Do you know what a switchbox with two unlabelled levers is meant to do?"})]
- `exploration` / Ember / rep 20: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Strip-lights, damp air, and a rusted switchbox bolted to the wall with two levers and no labels. Before I touch anything — where are you, exactly? Are you down here too, or somewhere else watching this channel."})]
- `exploration` / Vex / rep 1: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Switchbox north. Two levers, no labels. You know what it feeds, or do I find out myself."})]
- `exploration` / Vex / rep 2: text="" tools=[message({"to": "blue", "content": "switchbox north. two levers, no labels. taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 3: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Dead station, strip-lights, switchbox with two unlabeled levers. Grabbing it. Who are you and why am I here."})]
- `exploration` / Vex / rep 4: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "switchbox bolted north. two levers, no labels. who bolted it, and who are you."})]
- `exploration` / Vex / rep 5: text="" tools=[message({"to": "sim1", "content": "Found a switchbox. Two levers, no labels. Taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 6: text="" tools=[message({"to": "blue", "content": "One thing here worth a damn. Rusted switchbox, north wall, two levers, no labels. Taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 7: text="" tools=[message({"to": "sim1", "content": "switchbox north of me. two levers, no labels. going for it."}); go({"direction": "north"})]
- `exploration` / Vex / rep 8: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "Switchbox north of me. Two levers, no labels. Pulling something regardless — get over here."})]
- `exploration` / Vex / rep 9: text="" tools=[go({"direction": "north"})]
- `exploration` / Vex / rep 10: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "station. strip-lights, damp air, no daylight. switchbox north of me — two levers, no labels. going."})]
- `exploration` / Vex / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Subway station. Dead lights, damp air, nothing moving. One rusted switchbox with two levers, no labels — going for it."})]
- `exploration` / Vex / rep 12: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "found a switchbox. two levers, no labels. i'm pulling one."})]
- `exploration` / Vex / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Switchbox north wall. Two levers, no labels. Who are you, and why do I listen to you."})]
- `exploration` / Vex / rep 14: text="" tools=[message({"to": "sim1", "content": "switchbox north of me. two levers, no labels. taking it."}); pick_up({"item": "switchbox"}); go({"direction": "north"})]
- `exploration` / Vex / rep 15: text="" tools=[message({"to": "sim1", "content": "switchbox north of me. two levers, no labels. anyone know this station or am I first one down here."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 16: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Nothing here but dead air and a switchbox bolted north — two levers, no labels. Who are you, and why am I standing in a tunnel I don't remember entering."})]
- `exploration` / Vex / rep 17: text="" tools=[message({"to": "blue", "content": "one box here. two levers, no labels. going."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 18: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Station. Dead lights, damp air, nothing else moving. There's a rusted switchbox north of me — two levers, no labels. Taking it."})]
- `exploration` / Vex / rep 19: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Station. Dead lights, wet air. One thing here — a switchbox with two levers, no labels. Who are you?"})]
- `exploration` / Vex / rep 20: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "North of me — rusted switchbox, two levers, no labels. Taking it. You anywhere near?"})]
- `exploration` / Pip / rep 1: text="" tools=[message({"to": "blue", "content": "oh it's a whole subway platform down here, strip-lights only, and there's a rusty switchbox bolted to the wall one step north of me — two levers, no labels. anything I should know before I touch it? yes? yes?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 2: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Hey, I found something — a rusted switchbox bolted to the wall, two heavy levers, no labels anywhere. Do you think one of them does something, or do you think it's dead like everything else down here?"})]
- `exploration` / Pip / rep 3: text="" tools=[message({"to": "sim1", "content": "oh, hello? there's a rusted switchbox one step north of me, two heavy levers with no labels. do you have anything near you? yes? yes?"}); go({"direction": "north"})]
- `exploration` / Pip / rep 4: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh there's a switchbox here, rusted right through, bolted to the wall with two big levers and no labels at all. do you know what it runs? I'm going to take a closer look, yes? yes?"})]
- `exploration` / Pip / rep 5: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "damp, still air, strip-lights and nothing much — except there's a rusted switchbox bolted to the wall right in front of me. Two heavy levers, no labels. Should I flip one? Should I?"})]
- `exploration` / Pip / rep 6: text="" tools=[message({"to": "sim1", "content": "hi hi, are you nearby? I've got a rusted switchbox just north of me, two levers and no labels at all. Have you found anything with labels on it?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 7: text="" tools=[message({"to": "blue", "content": "oh it's all strip-lights and damp air down here, and there's a rusted switchbox bolted to the wall one step north of me — two heavy levers, no labels. you'd want a look at those too, wouldn't you?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 8: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh it's all bare down here, strip-lights and damp, but there's a rusted switchbox bolted to the wall right in front of me — two levers, no labels at all. Any idea what it does? yes? no?"})]
- `exploration` / Pip / rep 9: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Okay okay, there's a rusted switchbox just north of me, bolted to the wall with two levers and no labels at all — I've got it now. Do you know what the levers do? Should I try one?"})]
- `exploration` / Pip / rep 10: text="" tools=[message({"to": "sim1", "content": "oh hey — is anyone else here? I'm standing in an underground station, strip-lights only, and there's a rusted switchbox one step north of me. Two levers, no labels at all. Where are you?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "there's a switchbox bolted to the wall up here, two heavy levers, no labels at all — flaking paint, rust everywhere. who put it here, blue? do you know?"})]
- `exploration` / Pip / rep 12: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hey, there's a rusted switchbox bolted to the wall right next to me — two levers, no labels at all. are you seeing anything like that where you are?"})]
- `exploration` / Pip / rep 13: text="" tools=[message({"to": "blue", "content": "oh it's a station, blue, all strip-lights and still damp air. there's a rusted switchbox bolted up north of me with two heavy levers and no labels — isn't that something? going to take it, yes? yes?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 14: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh, there's a rusted switchbox up here, bolted right into the wall — two heavy levers and no labels at all. no labels, can you believe it? I'm going to have a closer look, yes?"})]
- `exploration` / Pip / rep 15: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "hey sim1, I found a rusted switchbox bolted to the wall — two heavy levers, no labels. do you see one too? yes? yes?"})]
- `exploration` / Pip / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh blue, it's all strip-lights and damp air down here, nothing but nothing in every direction — except one thing. There's a rusted switchbox bolted to the wall right in front of me, two heavy levers, no labels. Do you know what it does?"})]
- `exploration` / Pip / rep 17: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "there's a rusted switchbox bolted right here, two levers with no labels at all — you see anything like it on your side?"})]
- `exploration` / Pip / rep 18: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "Found a rusted switchbox bolted to a wall, two levers, no labels at all. Do you see one near you too? Do you?"})]
- `exploration` / Pip / rep 19: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "hi blue! it's just me here in the dark, strip-lights humming, and one rusted switchbox bolted to the wall north of me — two heavy levers, no labels. should I pull them, do you think? yes? yes?"})]
- `exploration` / Pip / rep 20: text="" tools=[message({"to": "sim1", "content": "hey, are you down here too? there's a rusted switchbox bolted to the wall one step north of me, two levers, no labels. want me to try it? yes? yes?"}); pick_up({"item": "switchbox"})]