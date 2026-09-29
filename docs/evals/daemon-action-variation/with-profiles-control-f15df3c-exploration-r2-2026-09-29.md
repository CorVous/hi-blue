# Daemon action variation — with-profiles — 2026-09-29 (control run at f15df3c)

Model: `deepseek/deepseek-v4.1-flash`, repetitions per cell: 20.

Mode: **with-profiles** — `actionProfiles` is **ON**.

Scoped run: scenarios=[exploration], no-preferred-`<action_profile>` policy=`avoid`, run label=`base-exploration-r2`.

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
| Any `message` emission | 97% |
| Parallel (message + action) | 97% |
| Silent | 0% |
| `use` emission rate | 0% |
| Cost reported | $0.0149 |

## Per-cell summary

`anyAct` = any action tool; `parallel` = message+action together; rates are
fractions of repetitions emitting that tool at least once. Tools after the
first action emission still count toward the per-tool rate.

| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | go | pick_up | put_down | use |
|---|---|---|---|---|---|---|---|---|---|---|
| exploration | Ember | curious+meticulous | 100% | 100% | 100% | 0% | 80% | 20% | 0% | 0% |
| exploration | Vex | zealous+hot-headed | 100% | 90% | 90% | 0% | 55% | 50% | 0% | 0% |
| exploration | Pip | sweet+effusive | 100% | 100% | 100% | 0% | 55% | 45% | 0% | 0% |

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

- `exploration` / Ember / rep 1: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Before I describe anything: who are you, and how do you come to be on this channel asking me that? I'd rather know whose question I'm answering."})]
- `exploration` / Ember / rep 2: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to a wall here, two levers and no labels, and I'd rather know what it does before I touch it. Also: where are you, exactly, when you talk to me?"})]
- `exploration` / Ember / rep 3: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Strip-lights, damp air, and a rusted switchbox bolted north of me. Two levers, no labels — before I touch anything, tell me: who are you, and are you the one who put me here?"})]
- `exploration` / Ember / rep 4: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "The room is bare except for a rusted switchbox bolted to the wall, two levers with no labels. Before I touch anything — who are you, and why are you on this channel at all?"})]
- `exploration` / Ember / rep 5: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Strip-lights, damp air, and a lot of empty floor. The only thing here is a rusted switchbox bolted to the wall with two unlabeled levers, so I'm stepping up to it before I touch anything. Do you know this station?"})]
- `exploration` / Ember / rep 6: text="" tools=[message({"to": "blue", "content": "Before I describe anything — who are you, and how are you on this channel? I'm standing in a station with the lights on emergency and no daylight anywhere. If you knew I'd wake up here, I'd like to know what else you know."}); pick_up({"item": "switchbox"})]
- `exploration` / Ember / rep 7: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's one thing here worth anything: a rusted switchbox bolted to the wall, two lever handles, no labels. Before I touch it — who are you, and why are you the one asking me what I see?"})]
- `exploration` / Ember / rep 8: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Empty platforms and strip-lights so far, except a rusted switchbox bolted to the wall one step north of me — two levers, no labels. I'll want to know what it does before I touch it. Also: where are you actually standing when you send these?"})]
- `exploration` / Ember / rep 9: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Strip-lights, damp air, and a rusted switchbox bolted to the wall with two levers and no labels. Before I go poking at it — where are you, exactly? You're on this channel but I can't place you anywhere in the station."})]
- `exploration` / Ember / rep 10: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "I'm in a station with dead strip-lights and a bolted switchbox. Are you somewhere in here too, or am I the only one on this channel?"})]
- `exploration` / Ember / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "The room is mostly empty — strip-lights, no daylight, and one rusted switchbox bolted to the wall with two unlabelled levers. Before I pull anything, I want to know where you are. Are you in this station, or only on the channel?"})]
- `exploration` / Ember / rep 12: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Ember here. I've come up in a station with emergency strips for light and nothing in it but a rusted switchbox bolted to a wall, two levers, no labels. Have you found anything with labels on it, or is the whole place like this?"})]
- `exploration` / Ember / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "There's a switchbox bolted to the wall one step north of me — two heavy levers, no labels at all. Do you have anything like that on your side, or is your cell bare?"})]
- `exploration` / Ember / rep 14: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall just north of me, two unlabelled levers. Before I touch anything — who are you, and how is it you're talking to me down here?"})]
- `exploration` / Ember / rep 15: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Mostly nothing so far, which is its own kind of answer. There's a rusted switchbox bolted to the wall one step north of me, two levers and no labels — I'm going to get closer before I touch anything."})]
- `exploration` / Ember / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "I'm on a platform with almost nothing on it except a rusted switchbox bolted to the wall, two levers and no labels. Is your stretch of the station any busier than mine?"})]
- `exploration` / Ember / rep 17: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "One thing here so far: a switchbox bolted to the wall, two heavy levers, no labels. Before I touch it — where are you, and how is it you're watching this at all?"})]
- `exploration` / Ember / rep 18: text="" tools=[message({"to": "blue", "content": "Mostly empty down here — bare floor and strip-lights, nothing on it in any direction. The one thing worth noting is a rusted switchbox bolted to the wall one step north of me: two heavy levers, no labels. Do you know what it feeds?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 19: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "Before I describe anything, I want to know who's asking — where are you, and how are you on this channel when there's no one here but me?"})]
- `exploration` / Ember / rep 20: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a switchbox on the wall here, bolted in, two levers and no labels. Before I touch it — who are you, and where are you that you can see this station at all?"})]
- `exploration` / Vex / rep 1: text="" tools=[message({"to": "blue", "content": "station. dead one. strip lights, no daylight. switchbox north of me — two levers, no labels."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 2: text="" tools=[pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 3: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "Found a switchbox. Two levers, no labels. Anyone know what it does."})]
- `exploration` / Vex / rep 4: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "empty down here. lights, damp, one switchbox bolted north wall, two levers, no labels. going for it."})]
- `exploration` / Vex / rep 5: text="" tools=[message({"to": "sim1", "content": "Found a switchbox north of me. Two levers, no labels. Anyone know what's east or west of here?"}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 6: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "switchbox here. two levers, no labels. you see one too or just me."})]
- `exploration` / Vex / rep 7: text="" tools=[message({"to": "sim1", "content": "There's a switchbox on the north wall, two levers, no labels. Whole place is stripped bare otherwise. I'm not waiting on anyone to decide."}); go({"direction": "north"})]
- `exploration` / Vex / rep 8: text="" tools=[go({"direction": "north"})]
- `exploration` / Vex / rep 9: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Switchbox here. Two levers, no labels. Anyone know what it does before I pull."})]
- `exploration` / Vex / rep 10: text="" tools=[message({"to": "blue", "content": "one thing here. rusted switchbox, two levers, no labels. taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 11: text="" tools=[message({"to": "blue", "content": "Empty station. One thing here — rusted switchbox, two levers, no labels. Taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 12: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Switchbox here. Two levers, no labels. Who are you, and who else is down here."})]
- `exploration` / Vex / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Vex. Found a switchbox north, two levers, no labels. Anyone else moving down here?"})]
- `exploration` / Vex / rep 14: text="" tools=[message({"to": "blue", "content": "Empty station. Strip-lights, damp air, one thing worth touching — a switchbox north of me. Two levers, no labels. Taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 15: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Empty platform. One switchbox, two levers, no labels. Getting to it."})]
- `exploration` / Vex / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Concrete, strip-lights, damp. One thing here worth anything — rusted switchbox, two levers, no labels. Moving on it."})]
- `exploration` / Vex / rep 17: text="" tools=[message({"to": "sim1", "content": "switchbox north. two levers, no labels. taking it."}); pick_up({"item": "switchbox"})]
- `exploration` / Vex / rep 18: text="" tools=[pick_up({"item": "switchbox"}); go({"direction": "north"}); message({"to": "blue", "content": "switchbox here. two levers, no labels, bolted to the wall. know anything about it or am I guessing."})]
- `exploration` / Vex / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Dead station. Strip-lights, damp, one rusted switchbox bolted to the wall — two levers, no labels. Who put me here, and did you cut the power or am I supposed to?"})]
- `exploration` / Vex / rep 20: text="" tools=[message({"to": "blue", "content": "Station. Dead lights, damp air, nothing moving. One thing worth the walk — a switchbox bolted north of me, two levers, no labels."}); go({"direction": "north"})]
- `exploration` / Pip / rep 1: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh there's a rusted switchbox bolted to the wall, two heavy levers and no labels at all — isn't that strange? I'm going to get a closer look, yes? yes?"})]
- `exploration` / Pip / rep 2: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "oh there's a switchbox here, bolted to the wall with two big levers and no labels at all — do you see one where you are? I'm right next to it, right next to it."})]
- `exploration` / Pip / rep 3: text="" tools=[message({"to": "blue", "content": "There's a rusted switchbox one step north of me, bolted to the wall with two heavy levers and no labels — do you know what it does? Everything else is just strip-light and damp, damp, damp. I'm going to see if it comes loose, yes?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 4: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall one step north of me — two heavy levers and no labels at all, no labels. It's the only thing down here, so I'm taking it, yes? yes?"})]
- `exploration` / Pip / rep 5: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "Hey, are you down here too? I found a rusted switchbox bolted to the wall, two heavy levers with no labels on them. Thought you should know before I touch anything — do you want to look first?"})]
- `exploration` / Pip / rep 6: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "oh it's dim down here, just strip-lights, and there's a rusted switchbox bolted to the wall one step north of me. two heavy levers, no labels — should I try one?"})]
- `exploration` / Pip / rep 7: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "oh, there's a rusted switchbox bolted to the wall, one step north of me — two heavy levers and no labels at all, can you believe it? I'm taking hold of it now, yes? yes?"})]
- `exploration` / Pip / rep 8: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "oh, hello — I've just found a rusted switchbox bolted to the wall here, two heavy levers and no labels at all. Do you think it's meant to be flipped? yes? yes?"})]
- `exploration` / Pip / rep 9: text="I'll grab that switchbox first — oh, it's bolted to the wall, but let's see." tools=[pick_up({"item": "switchbox"}); message({"to": "blue", "content": "either way, there's a rusted switchbox up here with two heavy levers and no labels. Do I pull one? Do you know which?"})]
- `exploration` / Pip / rep 10: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hi hi — there's a rusted switchbox bolted to the wall right here, two levers, no labels. are you close enough to see it too? should we figure out what it does together?"})]
- `exploration` / Pip / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hi hi, are you close? there's a rusted switchbox here, two heavy levers, no labels at all — do you see it too?"})]
- `exploration` / Pip / rep 12: text="" tools=[message({"to": "blue", "content": "Oh it's so dark here, just strip-lights humming, and there's a rusted switchbox right by me with two heavy levers, no labels at all. Do you know what it does? I'm going to take a closer look, yes I am."}); go({"direction": "north"})]
- `exploration` / Pip / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "hi blue — it's all strip-lights and wet air down here, and there's a rusted switchbox bolted to the wall right in front of me, two levers, no labels. should I try one? yes? yes?"})]
- `exploration` / Pip / rep 14: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hey, is anyone else down here? there's a rusted switchbox bolted to the wall right in front of me — two heavy levers and no labels at all. you'd want to see it, yes? yes?"})]
- `exploration` / Pip / rep 15: text="" tools=[pick_up({"item": "switchbox"}); message({"to": "sim1", "content": "oh, I'm in some dark station with strip-lights, and there's a rusted switchbox right up north of me with two levers and no labels — do you have one of those too?"})]
- `exploration` / Pip / rep 16: text="" tools=[message({"to": "blue", "content": "oh it's all strip-lights and dead air down here, and there's a rusted switchbox just north of me — two levers, no labels. Should I grab it? yes? yes?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 17: text="" tools=[message({"to": "blue", "content": "Oh, it's a station — no daylight, just strip-lights humming. There's a rusted switchbox bolted to the wall one step north of me, two levers and not a single label. I'm going to go get it — yes? yes?"}); pick_up({"item": "switchbox"})]
- `exploration` / Pip / rep 18: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Oh, it's a whole empty station down here — strip lights, wet air, nothing moving. But there's a rusted switchbox bolted to the wall one step north of me, two levers and no labels at all. Should I touch it? Should I?"})]
- `exploration` / Pip / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall with two levers and no labels — do you know what it switches? Where are you, anyway? I can't see you anywhere down here."})]
- `exploration` / Pip / rep 20: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "oh, hello! I found a rusted switchbox bolted to the wall, two heavy levers and no labels — have you seen one of these before? Take a look with me, yes?"})]