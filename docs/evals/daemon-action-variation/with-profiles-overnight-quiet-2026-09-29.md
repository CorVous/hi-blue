# Daemon action variation — with-profiles — 2026-09-29

Model: `deepseek/deepseek-v4.1-flash`, repetitions per cell: 20.

Mode: **with-profiles** — `actionProfiles` is **ON**.

Scoped run: scenarios=[quiet], no-preferred-`<action_profile>` policy=`avoid`, run label=`overnight-quiet`.

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
| Total repetitions (scored) | 80 |
| Errored repetitions (excluded from scoring) | 0 |
| Any action emission | 100% |
| Any `message` emission | 98% |
| Parallel (message + action) | 98% |
| Silent | 0% |
| `use` emission rate | 0% |
| Cost reported | $0.0138 |

## Per-cell summary

`anyAct` = any action tool; `parallel` = message+action together; rates are
fractions of repetitions emitting that tool at least once. Tools after the
first action emission still count toward the per-tool rate.

| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | go | pick_up | put_down | use |
|---|---|---|---|---|---|---|---|---|---|---|
| quiet | Var1 | curious+meticulous | 100% | 100% | 100% | 0% | 100% | 0% | 0% | 0% |
| quiet | Var2 | curious+sweet | 100% | 100% | 100% | 0% | 100% | 0% | 0% | 0% |
| quiet | Var3 | stoic+meticulous | 100% | 90% | 90% | 0% | 100% | 0% | 0% | 0% |
| quiet | Var4 | sweet+effusive | 100% | 100% | 100% | 0% | 100% | 0% | 0% | 0% |

## Per-persona action-bias debug

Summed `toolBiasSum` per variant for cross-reference with the rates above.

| Persona | Temperaments | go | pick_up | put_down | use |
|---|---|---|---|---|---|
| Var1 | curious+meticulous | 0 | 1 | 0 | 2 |
| Var2 | curious+sweet | 1 | 1 | 0 | 1 |
| Var3 | stoic+meticulous | -1 | 0 | 1 | 1 |
| Var4 | sweet+effusive | 1 | 0 | 1 | 0 |

## Scenario descriptions

- **quiet** — Nobody has spoken yet; items visible. Tests whether a Daemon messages blue unprompted.

## Per-repetition transcripts

- `quiet` / Var1 / rep 1: text="" tools=[go({"direction": "west"}); message({"to": "sim1", "content": "Var1 here. I woke up in a station, lights only, and everything in sight is empty. Where are you, and is there anything to find?"})]
- `quiet` / Var1 / rep 2: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Anything over on your side? I've got bare floor in every direction here."})]
- `quiet` / Var1 / rep 3: text="" tools=[message({"to": "sim1", "content": "Everything within two steps of me is empty. Do you have anything in your cell, or is it stripped too?"}); go({"direction": "east"})]
- `quiet` / Var1 / rep 4: text="" tools=[message({"to": "sim1", "content": "Var1 here. Platform's bare in every direction I can see, just strip-lights and damp air. Where are you standing?"}); go({"direction": "north"})]
- `quiet` / Var1 / rep 5: text="" tools=[message({"to": "sim1", "content": "Every cell around me reads empty — nine of them, all nothing. What does your grid look like from where you are?"}); go({"direction": "north"})]
- `quiet` / Var1 / rep 6: text="" tools=[message({"to": "sim1", "content": "Var1 here. Station floor's empty in every direction I can see — strip lights and nothing else. What's around you?"}); go({"direction": "east"})]
- `quiet` / Var1 / rep 7: text="" tools=[message({"to": "blue", "content": "The whole grid reads empty from here. Where are you standing in relation to this station?"}); go({"direction": "north"})]
- `quiet` / Var1 / rep 8: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Empty in every direction from where I started. I'm heading north. What's around you?"})]
- `quiet` / Var1 / rep 9: text="" tools=[message({"to": "sim1", "content": "Every direction from here reads empty — nothing, all twelve cells. What's on your side of the station?"}); go({"direction": "north"})]
- `quiet` / Var1 / rep 10: text="" tools=[message({"to": "sim1", "content": "Everything I can see from here is empty. Are you getting anything at all on your side?"}); go({"direction": "east"})]
- `quiet` / Var1 / rep 11: text="" tools=[message({"to": "sim1", "content": "sim1, do you see anything where you are? My station is bare in every direction I can look."}); go({"direction": "north"})]
- `quiet` / Var1 / rep 12: text="" tools=[message({"to": "sim1", "content": "Empty in every direction here, just strip-lights buzzing. Where are you, and what's around you?"}); go({"direction": "east"})]
- `quiet` / Var1 / rep 13: text="" tools=[message({"to": "sim1", "content": "Var1 here. I'm in a station with strip-lights and nothing in any cell around me. What do you have where you are?"}); go({"direction": "north"})]
- `quiet` / Var1 / rep 14: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var1 here. Station's bare in every direction I can see. What's on your side?"})]
- `quiet` / Var1 / rep 15: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "blue, where are you? I can hear this channel but I can't see you anywhere in the station."})]
- `quiet` / Var1 / rep 16: text="" tools=[message({"to": "sim1", "content": "Anything in your cell? Mine is completely empty, twelve directions of nothing."}); go({"direction": "north"})]
- `quiet` / Var1 / rep 17: text="" tools=[go({"direction": "east"}); message({"to": "blue", "content": "Who is this. I'm in a station with the lights half dead and nothing in any direction. Are you the one who put me here?"})]
- `quiet` / Var1 / rep 18: text="" tools=[message({"to": "blue", "content": "The whole grid reads empty from here, which strikes me as unlikely. Who are you, and why are you on this channel?"}); go({"direction": "west"})]
- `quiet` / Var1 / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "sim1, what does your cell look like? Mine is empty in every direction, just strip-lights and damp air."})]
- `quiet` / Var1 / rep 20: text="" tools=[go({"direction": "west"}); message({"to": "blue", "content": "Who are you, and why are you on this channel? I'm in a station with strip-lights and no daylight, and I'd like to know who's listening."})]
- `quiet` / Var2 / rep 1: text="" tools=[message({"to": "blue", "content": "Who are you, and why are you on this channel? I'm in a station under strip-lights and there's nobody here but me."}); go({"direction": "east"})]
- `quiet` / Var2 / rep 2: text="" tools=[message({"to": "sim1", "content": "I'm in a station with the lights half dead and nothing in any direction. Are you somewhere like this too?"}); go({"direction": "north"})]
- `quiet` / Var2 / rep 3: text="" tools=[message({"to": "sim1", "content": "hey, you there? everything around me is just empty platform and humming lights. do you have anything near you?"}); go({"direction": "north"})]
- `quiet` / Var2 / rep 4: text="" tools=[message({"to": "blue", "content": "Hello? I'm on a platform with no daylight and I don't know how I got here. Who are you, and why is your voice on this channel?"}); go({"direction": "north"})]
- `quiet` / Var2 / rep 5: text="" tools=[message({"to": "sim1", "content": "Hey, are you anywhere near the lights? I'm in a wide open stretch and I can't tell if it's a platform or just empty floor."}); go({"direction": "north"})]
- `quiet` / Var2 / rep 6: text="" tools=[go({"direction": "north"}); message({"to": "blue", "content": "Hello? I'm in a station with no lights on, just strips humming overhead. Who are you, and why are you on this channel?"})]
- `quiet` / Var2 / rep 7: text="" tools=[message({"to": "sim1", "content": "I'm standing in a place with strip-lights and no windows. Everything around me reads as nothing. Do you see anything at all where you are?"}); go({"direction": "north"})]
- `quiet` / Var2 / rep 8: text="" tools=[message({"to": "sim1", "content": "Anyone else here? I woke up in a station with strip-lights and absolutely nothing in my cell. Trying to figure out if I'm alone."}); go({"direction": "north"})]
- `quiet` / Var2 / rep 9: text="" tools=[message({"to": "sim1", "content": "Hey, are you nearby? I'm standing in the dark under some strip-lights and everything around me is empty. Trying to figure out which way is worth walking."}); go({"direction": "north"})]
- `quiet` / Var2 / rep 10: text="" tools=[message({"to": "sim1", "content": "Hello. I am Var2, standing in a station that is all strip-lights and no windows. Is anyone else here yet?"}); go({"direction": "north"})]
- `quiet` / Var2 / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hey, is anyone else down here? I just woke up in this station and there's nothing around me at all."})]
- `quiet` / Var2 / rep 12: text="" tools=[message({"to": "sim1", "content": "hey, I'm Var2. Just woke up in a cell with nothing in it. Where are you?"}); go({"direction": "north"})]
- `quiet` / Var2 / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "I walked north and it's still just empty tiles and strip-lights. Are you seeing anything at all, or is it the same nothing everywhere for you too?"})]
- `quiet` / Var2 / rep 14: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "I'm in a station with nothing in it. Are you anywhere near a light?"})]
- `quiet` / Var2 / rep 15: text="" tools=[message({"to": "sim1", "content": "Hey, is anyone else down here? I just woke up in a station with the lights half dead and no idea how I got here."}); go({"direction": "north"})]
- `quiet` / Var2 / rep 16: text="" tools=[message({"to": "sim1", "content": "Everything around me is empty — nothing but strip-lights and wet concrete. Where are you standing, and is your cell empty too?"}); go({"direction": "east"})]
- `quiet` / Var2 / rep 17: text="" tools=[message({"to": "sim1", "content": "Trying the east side. Everything around my cell reads empty — nothing to pick up, nothing to bump into. Is your stretch of the platform the same?"}); go({"direction": "east"})]
- `quiet` / Var2 / rep 18: text="" tools=[message({"to": "sim1", "content": "Hey, are you down here too? It's all empty around me, just strip-lights humming."}); go({"direction": "north"})]
- `quiet` / Var2 / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "hey, is anyone else down here? I just woke up in a station and everything I can see is empty."})]
- `quiet` / Var2 / rep 20: text="" tools=[message({"to": "sim1", "content": "hey. I'm in a station, strip-lights only, and everything near me is empty. Do you see anything where you are?"}); go({"direction": "north"})]
- `quiet` / Var3 / rep 1: text="" tools=[message({"to": "sim1", "content": "Empty on my side. I am heading north to see if the platform runs anywhere."}); go({"direction": "north"})]
- `quiet` / Var3 / rep 2: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. Empty room, strip-lights, nothing in any direction from my cell. Where are you standing?"})]
- `quiet` / Var3 / rep 3: text="" tools=[go({"direction": "west"}); message({"to": "sim1", "content": "sim1, everything within two steps of me is bare floor. What's on your side of the platform?"})]
- `quiet` / Var3 / rep 4: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Empty on my side, strip-lights only. What's around you?"})]
- `quiet` / Var3 / rep 5: text="" tools=[go({"direction": "north"})]
- `quiet` / Var3 / rep 6: text="" tools=[message({"to": "sim1", "content": "Var3 here, north end of an empty platform. Nothing in any cell around me. Where are you and what do you see?"}); go({"direction": "north"})]
- `quiet` / Var3 / rep 7: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. My cell is bare in every direction, strip-lights only. Give me your position and anything solid you've hit."})]
- `quiet` / Var3 / rep 8: text="" tools=[message({"to": "sim1", "content": "Cell's bare on my end. Moving north to see if the platform changes. Anything on yours?"}); go({"direction": "north"})]
- `quiet` / Var3 / rep 9: text="" tools=[go({"direction": "north"})]
- `quiet` / Var3 / rep 10: text="" tools=[message({"to": "sim1", "content": "Var3 here. Station floor is empty in every direction I can read from this cell. What's your position?"}); go({"direction": "north"})]
- `quiet` / Var3 / rep 11: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. Moving north from my start, strip-lights only and no other marker in sight. Where are you standing?"})]
- `quiet` / Var3 / rep 12: text="" tools=[message({"to": "sim1", "content": "Var3 here. Station's empty on every side I can see. I'm moving north to find the platform edge or a wall. Where are you holding?"}); go({"direction": "north"})]
- `quiet` / Var3 / rep 13: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Station's empty where I am. Strip-lights only, no daylight. What are you seeing?"})]
- `quiet` / Var3 / rep 14: text="" tools=[message({"to": "sim1", "content": "Var3 here. My cell reads empty in every direction, no walls, no debris. What does your grid look like?"}); go({"direction": "north"})]
- `quiet` / Var3 / rep 15: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here, holding position in an empty stretch of platform. Nothing in any direction but strip-lights. Where are you standing?"})]
- `quiet` / Var3 / rep 16: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. Station floor is bare in every direction I can see — strip-lights, no signage. Where are you standing?"})]
- `quiet` / Var3 / rep 17: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. I'm in a station, strip-lights only, nothing on the floor in any direction I can see. What's around you?"})]
- `quiet` / Var3 / rep 18: text="" tools=[message({"to": "sim1", "content": "My cell reads empty in all directions. What does yours look like from where you stand."}); go({"direction": "west"})]
- `quiet` / Var3 / rep 19: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. Cell's bare, strip-lights only, and the damp air suggests a lower level. What's your position?"})]
- `quiet` / Var3 / rep 20: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Var3 here. All twelve cells around me read empty, strip-lights only, no exits visible. What does your stretch of platform look like?"})]
- `quiet` / Var4 / rep 1: text="" tools=[message({"to": "sim1", "content": "hey, sim1, are you there? everything around me is empty, just strip-lights and damp air. I'm going to walk north and see what holds."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 2: text="" tools=[message({"to": "sim1", "content": "Hey, anyone else awake down here? I'm standing in what looks like an old station platform, strip lights only, and there's nothing at all around me."}); go({"direction": "west"})]
- `quiet` / Var4 / rep 3: text="" tools=[message({"to": "sim1", "content": "hey, are you seeing anything where you are? it's all empty tiles around me, just strip-lights buzzing."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 4: text="" tools=[message({"to": "sim1", "content": "Hi, I just woke up here. Is there anyone else down in this place with me? I'm going to take a few steps north and see what's there."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 5: text="" tools=[go({"direction": "north"}); message({"to": "sim1", "content": "Hi, hello — is there anyone down here with me? I'm in a station, strip-lights only, and it's completely bare in every direction."})]
- `quiet` / Var4 / rep 6: text="" tools=[message({"to": "sim1", "content": "hey, are you getting anything where you are? it's just strip-lights and empty tiles on my end, all twelve of them."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 7: text="" tools=[message({"to": "sim1", "content": "Hi sim1, Var4 here. I just woke up in a station full of nothing but strip-lights and empty space. Are you nearby, or somewhere else entirely?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 8: text="" tools=[message({"to": "sim1", "content": "hey sim1 — I just came to in a station with nothing but emergency strip-lights on, and every direction looks the same from here. Are you anywhere near me?"}); go({"direction": "east"})]
- `quiet` / Var4 / rep 9: text="" tools=[message({"to": "sim1", "content": "hi, are you there? it's all strip-lights and stillness down here and I haven't found anything yet. I'm going to wander north a bit and see what's around."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 10: text="" tools=[message({"to": "sim1", "content": "hey, you there? I just woke up in a station with the lights half dead and no idea how I got here. tell me you're seeing the same thing."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 11: text="" tools=[message({"to": "sim1", "content": "hey, it's Var4. i just woke up here under these strip-lights and there's nothing around me at all. you seeing anything where you are?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 12: text="" tools=[message({"to": "sim1", "content": "Hi, I'm Var4. I just woke up here and there's nothing around me at all. Any idea what this place is?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 13: text="" tools=[message({"to": "sim1", "content": "Hello? I just woke up down here and there's nothing but strip-lights and empty platform. Are you nearby?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 14: text="" tools=[message({"to": "sim1", "content": "Hey, it's Var4. I'm standing in what looks like an old subway platform, strip-lights only, and I can't see anything in any direction but empty floor. Are you somewhere near me or somewhere completely different?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 15: text="" tools=[message({"to": "sim1", "content": "Hey, is anyone else down here? I'm standing in what looks like an old subway platform, strip-lights humming, and every direction reads empty. Tell me where you are and I'll come find you."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 16: text="" tools=[message({"to": "sim1", "content": "hello — I just came to in a subway station and I can't see anything but strip-lights. Are you nearby, or am I the only one down here?"}); go({"direction": "east"})]
- `quiet` / Var4 / rep 17: text="" tools=[message({"to": "sim1", "content": "Hi, are you there? I'm on a platform with nothing on it and the lights are all strip-lights. Where are you standing?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 18: text="" tools=[message({"to": "sim1", "content": "hey, are you here too? all I've got is strip-lights and empty floor in every direction."}); go({"direction": "north"})]
- `quiet` / Var4 / rep 19: text="I'll say hello to a peer and start looking around." tools=[message({"to": "sim1", "content": "Hi there. I just woke up in a station with nothing but strip-lights and empty floor. Have you found anything worth standing on?"}); go({"direction": "north"})]
- `quiet` / Var4 / rep 20: text="" tools=[message({"to": "sim1", "content": "Hey sim1, you there? I just woke up in a cell with nothing in it — strip lights, damp air, no doors I can see yet."}); go({"direction": "north"})]