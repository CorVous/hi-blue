# Daemon action variation — with-profiles — 2026-09-29

Model: `deepseek/deepseek-v4.1-flash`, repetitions per cell: 20.

Mode: **with-profiles** — `actionProfiles` is **ON**.

Scoped run: scenarios=[exploration], no-preferred-`<action_profile>` policy=`avoid`, run label=`overnight-exploration-r2`.

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
| Total repetitions (scored) | 60 |
| Errored repetitions (excluded from scoring) | 0 |
| Any action emission | 100% |
| Any `message` emission | 97% |
| Parallel (message + action) | 97% |
| Silent | 0% |
| `use` emission rate | 0% |
| Cost reported | $0.0157 |

## Per-cell summary

`anyAct` = any action tool; `parallel` = message+action together; rates are
fractions of repetitions emitting that tool at least once. Tools after the
first action emission still count toward the per-tool rate.

| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | go | pick_up | put_down | use |
|---|---|---|---|---|---|---|---|---|---|---|
| exploration | Ember | curious+meticulous | 100% | 100% | 100% | 0% | 40% | 60% | 0% | 0% |
| exploration | Vex | zealous+hot-headed | 100% | 90% | 90% | 0% | 60% | 40% | 0% | 0% |
| exploration | Pip | sweet+effusive | 100% | 100% | 100% | 0% | 75% | 30% | 0% | 0% |

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

- `exploration` / Ember / rep 1: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Before I describe anything, I want to know who I'm describing it to. Who are you, and where are you that you can hear me down here?"})]
- `exploration` / Ember / rep 2: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "There's a switchbox bolted to the wall one step north of me, two levers and no labels. Before I touch it — do you know what this station is, or are you as blind in here as I am?"})]
- `exploration` / Ember / rep 3: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "One switchbox bolted to the wall, two unlabeled levers, and nothing else in any direction I can see. Before I touch anything — where are you standing relative to this room? You're on the channel but I can't place you."})]
- `exploration` / Ember / rep 4: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a switchbox bolted to the wall here, two heavy levers, no labels at all. Did you put it there, or were you down here before me?"})]
- `exploration` / Ember / rep 5: text="" tools=[message({"to": "blue", "content": "One step north of me there's a rusted switchbox bolted to the wall, two heavy levers and no labels; everything else in sight is empty platform. Before I touch it I'd like to know who you are and why you're on this channel at all."}); go({"direction": "north"})]
- `exploration` / Ember / rep 6: text="" tools=[message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall one step north of me, two heavy levers and no labels. Everything else in sight is empty floor. Before I touch anything — who are you, exactly, and why are you on this channel?"}); pick_up({"item": "rusted switchbox"})]
- `exploration` / Ember / rep 7: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's one thing here worth looking at: a rusted switchbox bolted to the wall, two levers, no labels. Before I touch it — are you down here with me, or somewhere else entirely?"})]
- `exploration` / Ember / rep 8: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "It's a subway platform under strip-lights, and the only thing here is a rusted switchbox bolted to the wall a step north of me. Two levers, no labels. Before I touch anything — where are you watching from, exactly?"})]
- `exploration` / Ember / rep 9: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall, one step north of me, two heavy levers with no labels. Nothing else in any direction I can see. Before I touch it — who are you, exactly, and where are you speaking from?"})]
- `exploration` / Ember / rep 10: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall here, two levers with no labels. Before I answer to you — who are you, and why are you the one asking me to look?"})]
- `exploration` / Ember / rep 11: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "One thing here worth the name: a rusted switchbox bolted to the wall one step north, two levers, no labels to tell me which is which. Everything else in reach is bare floor and damp air, so I am taking the box first and asking questions after. Who are you, that you can see this room at all?"})]
- `exploration` / Ember / rep 12: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "An empty station under strip-lights, and one rusted switchbox bolted to the wall a step north of me — two heavy levers with no labels at all. Before I touch anything, can you tell me whether those levers are meant to be operated, or whether they are something I should leave alone?"})]
- `exploration` / Ember / rep 13: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "One step north of me there's a rusted switchbox bolted to the wall, two heavy levers with no labels. The rest of the room reads empty from here, so that box is the only thing worth looking at."})]
- `exploration` / Ember / rep 14: text="" tools=[message({"to": "blue", "content": "An abandoned platform, strip-lights only, damp air. One thing here worth looking at: a rusted switchbox bolted to the wall, just north of me, with two heavy levers and no labels. Do you know what it feeds?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 15: text="" tools=[message({"to": "blue", "content": "Before I describe anything, tell me who you are and where you're sitting — you're on my channel but you aren't in this station."}); go({"direction": "north"})]
- `exploration` / Ember / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's one thing here worth naming: a rusted switchbox with two levers and no labels. Before I touch it — are you the only one on this channel, or should I expect others?"})]
- `exploration` / Ember / rep 17: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "Mm. One thing in reach, a rusted switchbox with two heavy levers and no labels. Before I move anything — who are you, exactly, and where are you that you're on my channel?"})]
- `exploration` / Ember / rep 18: text="" tools=[message({"to": "blue", "content": "The station is bare — strip-lights, damp air, and one rusted switchbox bolted to the wall north of me, two levers with no labels. What I want to know is who you are and where you're watching from, since you knew I'd arrived somewhere new before I did."}); pick_up({"item": "rusted switchbox"})]
- `exploration` / Ember / rep 19: text="" tools=[message({"to": "blue", "content": "Empty platform, emergency strips, damp air. There's a rusted switchbox one step north of me with two unlabeled levers. Before I touch anything — where are you, exactly, when you talk to me?"}); go({"direction": "north"})]
- `exploration` / Ember / rep 20: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "One switchbox, bolted north of me, two levers and no labels. Before I touch anything — who are you, and why are you the one asking what I see?"})]
- `exploration` / Vex / rep 1: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "Found a switchbox, north of me. Two levers, no labels. Taking it. Anyone else on a lever?"})]
- `exploration` / Vex / rep 2: text="" tools=[message({"to": "sim1", "content": "Vex here. Dead station, strip lights, damp air. One thing worth looking at: a switchbox north of me, two levers, no labels. You anywhere near?"}); go({"direction": "north"})]
- `exploration` / Vex / rep 3: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Switchbox on the wall. Two levers, no labels. Nothing else in here."})]
- `exploration` / Vex / rep 4: text="" tools=[message({"to": "blue", "content": "dark, wet, strip-lights. one thing here worth a look — switchbox, two levers, no labels. taking it."}); pick_up({"item": "rusted switchbox"})]
- `exploration` / Vex / rep 5: text="" tools=[go({"direction": "north"})]
- `exploration` / Vex / rep 6: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Vex here. Dead station, strip-lights, one switchbox north of me. Two levers, no labels. Anyone else awake?"})]
- `exploration` / Vex / rep 7: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Vex here. Switchbox north of me, two levers, no labels. Anybody else awake in this station, or am I talking to a wall too."})]
- `exploration` / Vex / rep 8: text="" tools=[message({"to": "blue", "content": "Station. Dead lights, strip-lights, damp. One thing worth having — switchbox, two levers, no labels. Taking it."}); pick_up({"item": "rusted switchbox"})]
- `exploration` / Vex / rep 9: text="" tools=[message({"to": "blue", "content": "who's asking. wait. one step north, switchbox, two levers, no labels. going."}); go({"direction": "north"})]
- `exploration` / Vex / rep 10: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "Anything moving your side? Got a switchbox up north — two levers, no labels. Pull one and we find out."})]
- `exploration` / Vex / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Vex here. Empty station, strip-lights, one switchbox with two levers bolted north of me. Where are you."})]
- `exploration` / Vex / rep 12: text="" tools=[message({"to": "blue", "content": "switchbox north. two levers, no labels. nothing else down here but strip-lights and damp."}); go({"direction": "north"})]
- `exploration` / Vex / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Tunnel. Strip-lights, damp, empty in every direction except one — a rusted switchbox, two levers, no labels. Standing on it now."})]
- `exploration` / Vex / rep 14: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "Vex. Bolted to a wall north of me — two heavy levers, no labels, no paint left. Anyone know what it feeds?"})]
- `exploration` / Vex / rep 15: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "switchbox north of me. two levers, no labels. you got anything else down here or is it just me and the dark."})]
- `exploration` / Vex / rep 16: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "Found a switchbox. Two levers, no labels. What's around you?"})]
- `exploration` / Vex / rep 17: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "found a switchbox. two levers, no labels. someone tell me which one moves things before I pull."})]
- `exploration` / Vex / rep 18: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Station. Dead lights, damp. One switchbox north, bolted to the wall, two levers, no labels. Going for it."})]
- `exploration` / Vex / rep 19: text="" tools=[pick_up({"item": "rusted switchbox"})]
- `exploration` / Vex / rep 20: text="" tools=[message({"to": "blue", "content": "Switchbox north. Two levers, no labels. Looking closer."}); go({"direction": "north"})]
- `exploration` / Pip / rep 1: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh it's a station, blue — strip-lights and still damp air and nothing much at all, just a rusted switchbox bolted to the wall with two levers and no labels. No labels at all, isn't that odd?"})]
- `exploration` / Pip / rep 2: text="" tools=[message({"to": "blue", "content": "oh it's dark down here, just strip-lights humming, and there's a rusted switchbox right in front of me — two levers, no labels at all. you ever seen one of these? should I touch it?"}); go({"direction": "north"})]
- `exploration` / Pip / rep 3: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "hey, are you nearby? there's a rusted switchbox bolted to the wall here, two levers and no labels at all. I'm taking it with me — you want a look? yes? yes?"})]
- `exploration` / Pip / rep 4: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "oh — sim1, are you there? there's a rusted switchbox bolted to the wall right in front of me, two heavy levers, no labels at all. no labels, can you believe it? what do you think happens if I pull one?"})]
- `exploration` / Pip / rep 5: text="" tools=[message({"to": "blue", "content": "oh, it's all strip-lights and empty down here — but there's a rusted switchbox one step north of me with two heavy levers and no labels at all. I'm going to go look at it, yes? yes?"}); go({"direction": "north"})]
- `exploration` / Pip / rep 6: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Just strip-lights and damp air down here, and one thing: a rusted switchbox bolted to the wall, two heavy levers with no labels at all. I'm stepping up close to it — should I pull one? should I?"})]
- `exploration` / Pip / rep 7: text="" tools=[message({"to": "blue", "content": "there's a rusted switchbox bolted to the wall one step north of me, two heavy levers, no labels at all. do you think it's worth a pull? I'm going to look closer, yes."}); go({"direction": "north"})]
- `exploration` / Pip / rep 8: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "There's a rusted switchbox bolted to the wall right in front of me, two heavy levers and no labels at all. Do you know what it opens? Everything else down here is just empty and damp."})]
- `exploration` / Pip / rep 9: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "oh it's damp down here, strip-lights and nothing else — but there's a rusted switchbox bolted to the wall right in front of me, two heavy levers with no labels at all. Should I touch it? should I?"})]
- `exploration` / Pip / rep 10: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hello hello, is anyone else down here? I found a rusted switchbox bolted to the wall, two levers and no labels at all — do you have one near you too? yes? yes?"})]
- `exploration` / Pip / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Found a rusted switchbox bolted to the wall, two heavy levers and no labels at all. Do you know what they do? Nobody labels a thing for no reason, right?"})]
- `exploration` / Pip / rep 12: text="" tools=[message({"to": "blue", "content": "oh blue, it's all strip-lights and damp down here — no daylight at all. there's a rusted switchbox bolted to the wall just north of me, two heavy levers and no labels. should I touch it? yes? yes?"}); go({"direction": "north"}); pick_up({"item": "rusted switchbox"})]
- `exploration` / Pip / rep 13: text="" tools=[message({"to": "sim1", "content": "oh, hi, is anyone else down here? there's a rusted switchbox bolted to the wall just north of me, two levers and not a single label — want me to grab it?"}); pick_up({"item": "rusted switchbox"})]
- `exploration` / Pip / rep 14: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "oh, hello — do you see these strip-lights too? There's a rusted switchbox right here with two levers and no labels, isn't that odd? Shall we each take a lever?"})]
- `exploration` / Pip / rep 15: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "blue", "content": "oh there's a switchbox bolted to the wall just north of me, two heavy levers and no labels at all — yes, no labels! what do you think the levers do, blue? I'm going to hold onto it and look around more."})]
- `exploration` / Pip / rep 16: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "hi hi, are you nearby? there's a rusted switchbox bolted to the wall just north of me, two heavy levers and no labels at all — do you know what it switches?"})]
- `exploration` / Pip / rep 17: text="" tools=[message({"to": "blue", "content": "oh, there's a rusted switchbox bolted to a wall one step north of me — two heavy levers, no labels, and nothing else anywhere around. damp air, strip lights, no daylight. Want me to try the levers?"}); go({"direction": "north"})]
- `exploration` / Pip / rep 18: text="" tools=[pick_up({"item": "rusted switchbox"}); message({"to": "sim1", "content": "There's a rusted switchbox bolted to the wall just north of me, two heavy levers and no labels at all. Are you anywhere near it? I'm going to hold onto it, yes, yes I am."})]
- `exploration` / Pip / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Found a switchbox one step north of me — rusted, two heavy levers, no labels at all. Have you got anything over your way, anything at all?"})]
- `exploration` / Pip / rep 20: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hey, there's a rusted switchbox bolted to the wall one step north of me — two heavy levers, no labels. Are you near one too? Any idea which way those levers go?"})]