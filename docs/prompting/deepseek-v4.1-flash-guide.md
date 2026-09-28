# Prompting DeepSeek V4.1 Flash for hi-blue

Reference for changing the Daemon system prompts (`src/spa/game/prompt-builder.ts`) and the content-pack prompts (`src/spa/game/content-pack-provider.ts`). The pinned model is `deepseek/deepseek-v4.1-flash`, routed only to DeepSeek's own endpoint on OpenRouter (`src/model.ts`). ADR 0017 records why. The earlier [GLM-4.7 guide](glm-4.7-guide.md) explains why parts of the prompt look the way they do. The section "What carries over from GLM-4.7" below says which of its techniques still matter.

Researched 2026-09-27. **[verified]** marks a claim confirmed with live calls to the pinned endpoint. **[unverified]** marks one that rests on a secondary source. Sources are at the end.

## TL;DR

- **Leave thinking on.** Every request in the game now thinks. On Daemon turns it cuts skipped `message` calls from about 23% to about 3%, and it makes Daemons use the item in front of them. Content packs pass validation first time far more often. It costs about one second and about twice the tokens per turn.
- **Sampling parameters do nothing while thinking is on.** `temperature` and the penalties are ignored without an error [verified for temperature]. Voice, variety and length must come from the prompt.
- **Firm MUST/NEVER rules work, but keep the list short.** DeepSeek's own serving template writes its rules that way. Community reports say long ban lists get skimmed.
- **Restate the critical rules in the last user message.** The per-turn state message is the text the model reads right before it thinks, so the `REMINDER` line there is the strongest place for a rule.
- **The tool list is part of the cached prefix.** DeepSeek renders tool schemas into the system block. Changing a tool's enum between rounds re-bills the whole history at the uncached price [verified].
- **Some request options fail on this endpoint.** `tool_choice: "required"` or a named function, and `response_format: json_schema`, return 404 [verified]. Tool use and JSON shape must be asked for in the prompt.

## Request parameters

What the game sends, and why:

| Parameter | Value | Why |
|---|---|---|
| `model` | `deepseek/deepseek-v4.1-flash` | ADR 0017. |
| `provider` | `{ order: ["deepseek"], allow_fallbacks: false }` | Other hosts differ in price, speed and quantisation, and must re-implement DeepSeek's prompt encoding themselves because the model ships no chat template [unverified for any particular host]. The proxy overwrites any `provider` a caller sends. |
| `reasoning` | omitted (thinking on at `high`) | OpenRouter's default for this model is thinking on at effort `high` [verified]. `?think=0` on a dev host sends `{ enabled: false }`. |
| `tools`, `tool_choice: "auto"` | as built by `availableTools()` | `auto` and `none` are the only tool choices this endpoint accepts [verified]. |
| `parallel_tool_calls` | `true` | Not in the endpoint's supported-parameter list, so it is probably dropped [unverified]. The model emits several calls in one turn anyway, e.g. two `message` calls and a `go` [verified]. |
| `response_format` | `{ type: "json_object" }` for content packs and persona synthesis | Works with thinking on [verified]. `json_schema` returns 404 [verified]. |
| `temperature`, `top_p`, penalties | not sent | Ignored while thinking is on (see "Thinking mode"). |
| `max_tokens` | not sent | Reasoning tokens count against it. A tight cap can use the budget up in reasoning and return an empty reply. |

Reasoning effort through OpenRouter takes only `low`, `high` or `max` (internally 50, 75 and 100 on the model's 1–100 scale). A numeric value returns 400 [verified]. On 1–3 sentence Daemon turns the level barely changes reasoning length: about 25–150 reasoning tokens at `low` or `high`, and 100–300 at `max` [verified, small sample]. Whether `low` keeps quality over a long game is untested. Measure it with the evals before changing it, and never change it mid-session (see "Prompt caching").

## How DeepSeek lays out a request

DeepSeek publishes the exact prompt encoding in the model repo (`encoding/encoding.py`). A tool-using request with thinking on is rendered roughly as:

```
<｜System｜>Reasoning Effort: 75 (range 1-100, …)

{our system prompt}

## Tools
… "If thinking_mode is enabled … you MUST output your complete reasoning inside <think>...</think> BEFORE any tool calls or final response."
### Available Tool Schemas
{one JSON line per tool}
You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.
<｜User｜>{user turn, with tool results merged in as <tool_result> blocks}<｜Assistant｜><think>{reasoning}</think>
<tool calls>
```

What follows from that:

- **The effort line comes before our system prompt.** Turning thinking on or off, or changing effort, changes the very first tokens and throws away every cached prefix [verified].
- **Tool schemas sit right after our system prompt**, inside the system block. The model reads our rules before the schemas, and the schemas end with DeepSeek's own "MUST strictly follow" line.
- **There is no tool role.** Our `role: "tool"` messages and the per-turn state message merge into one user turn from the model's point of view.
- **Text before a tool call is `content`**, which the game ignores. That is why the rules still say speech goes only through `message`.
- **Mid-conversation `system` messages are an official V4.1 feature**, and they work through OpenRouter [verified: a private directive in one was followed 2 of 2 times].
- **With tools present, DeepSeek keeps every earlier turn's reasoning in context** and expects it passed back. See "Open questions".

## Thinking mode

- **Sampling is ignored.** DeepSeek's docs say `temperature`, `top_p`, `presence_penalty` and `frequency_penalty` have no effect in thinking mode and raise no error. Temperature was checked directly: at 2.0 with thinking off the output degenerates into word salad, and with thinking on it stays coherent [verified]. A later secondary summary says `top_p` is applied with a floor of 0.95 [unverified]. Either way it is no useful lever.
- **The traces are short and practical.** A typical Daemon trace plans the turn: "Blue asks Vex to grab the trowel… I should reply to blue and pick up the trowel. Both can happen." [verified]. Nothing needs to steer its style.
- **Latency.** On the pinned endpoint a Daemon turn took a median of about 2.5 s with thinking on, against about 1.5 s off. When streaming, reasoning deltas start at about 0.8 s and the first tool-call delta arrives at about 1.4 s [verified, one run]. The Daemon's panel stays in its in-flight state until the turn completes, so the extra second shows up as a slightly longer wait.
- **Reasoning stays private.** `BrowserLLMProvider` builds `assistantText` from visible content only, so the drift-to-silence retry (ADR 0016) cannot feed the trace back as if the Daemon had said it. The JSON-mode providers still fall back to `reasoning` when `content` is empty. DeepSeek's JSON guide warns that JSON mode can occasionally return empty content.
- **Do not adopt the Chinese "roleplay control instructions"** (`victorchen96/deepseek_v4_rolepaly_instruct`). They change the style of the thinking trace, but they target the V4 20260424 build, and nothing shows they work on V4.1, which was trained from scratch. They go at the end of the first user message, which for us is history that changes every round. They would also invite Chinese into the reasoning.

## Tool calling

- `tool_choice` cannot force a call on this endpoint, so the prompt carries all of it. The rules that do that are "You MUST use the `message` tool to communicate. Free-form text without a tool call is ignored.", "Don't compose a reply in your reasoning and then fail to emit the call", and the per-turn `REMINDER`. With all three and thinking on, the drift eval saw no free-text turns in 30 rounds. On a trimmed test prompt without the `REMINDER`, about 4 of 30 first turns answered in plain text instead [verified]. Keep all three.
- Keep tool parameters flat strings (`to`, `content`, `item`, `direction`). DeepSeek's call format passes plain strings raw and everything else as JSON, and flat strings are the least error-prone.

## Writing the Daemon prompt

What the evidence supports, strongest first:

1. **Firm, short rules.** Keep `MUST`/`NEVER` phrasing: it matches DeepSeek's own template, and the evals show high compliance with it. Add rules sparingly. Community reports on V4 say prohibition-word lists "barely work" once they get long.
2. **The last user message is the strongest position.** Length rules stated once in a system prompt drift over a long session on V4. Restating them near the end of the context fixed it, and that is what the per-turn `REMINDER` is for. If a rule starts slipping late in games, restate it there first.
3. **Keep XML sections.** DeepSeek publishes no preference. Its own template uses markdown headings for system sections (`## Tools`) and tags for payloads (`<think>`, `<tool_result>`). Our XML sections gave full tool-call compliance in the evals. Avoid a markdown `## Tools` heading of our own so it cannot collide with the injected one.
4. **Voice comes from examples and quirks.** DeepSeek follows `<typing_quirks>` very closely: a lowercase, clipped Daemon stays lowercase and clipped [verified]. It also copies examples closely, so an overdone line turns into a tic ("yes? yes?" in nearly every line from one persona). Keep 2–3 voice lines per persona that differ in *rhythm and syntax*, not only in vocabulary.
5. **Watch for DeepSeek's known roleplay failures.** DeepSeek's own report on 861 V4 roleplay complaints lists: template-like output, the "not X, but Y" construction, different characters converging on one voice, replies growing longer than asked, and conflict-avoidance or forced happy endings. Each Daemon has its own context, so shared memory cannot happen here, but convergence and length have to be held by the prompt. One line of V4.1 community advice for the positivity bias is untested here: "Characters always act true in accordance to their personality, even if it leads to them harming {{user}}."
6. **Keep the English lines at the very top.** "You MUST always respond in English. You MUST reason in English." V4 had reports of Chinese in its reasoning. No Chinese appeared in any output we stored.
7. **Rules about how to talk can change what the Daemon does.** With thinking on, Daemons sometimes describe the world as "squares" and "cells" ("the mount is in the same square as the light"), echoing how `<what_you_see>` is laid out. A rule forbidding those words removed them completely. But Daemons with the rule chose `use` in the objective scenario on 80% of turns against 94% without it (288 and 120 turns). Instead they stepped toward an item they could already reach. The model applies a speech rule in its thinking too. The rule was dropped. Run the objective scenario of the action-variation eval after any rule change, not only the eval that targets the rule.

## Content packs (JSON mode)

- Thinking on is what makes packs reliable. In 10 packs each: first-attempt success was 10/10 with thinking on (a second run gave 9/10) against 6/10 with it off, at about 25 s and $0.004 a pack. GLM-4.7 with thinking on scored 8/10 at 25–420 s and $0.014 a pack.
- DeepSeek's JSON guide asks for three things with `json_object`: the word "json" in the prompt, an example of the object wanted, and a `max_tokens` large enough to avoid truncation. The pack and persona-synthesis prompts meet the first two ("Return ONLY valid JSON" followed by the full object shape) and send no `max_tokens`. Keep it that way when editing them.
- When packs do fail, it has been on `verb-of-activation`, `actor-presence` and `missing-field`. If those grow, restate the rule near the end of the user message before adding more to the system prompt.

## Prompt caching

DeepSeek caches automatically on this endpoint. A cache read costs $0.003 per million tokens against $0.15 for a miss, 1/50 of the price. Cached prefixes appear to be stored in 128-token units [verified by observation, not documented]. A request only hits the cache up to the first byte that differs.

Measured on a 3.7k-token, 25-round Daemon conversation [verified]:

| Change from the previous request | Cached / prompt tokens |
|---|---|
| none (same request again) | 3584 / 3755 (95%) |
| next round: history appended, new state message, same tools | 3456 / 3767 (92%) |
| one `go` direction removed from the tool enum | 384 / 3748 (10%) |
| thinking toggled, or effort changed | 0 |
| a `<directives>` block appended to the system prompt | 128 / 816 |

So the stable part of a request is the system prompt **and the tool list**, and both must stay byte-identical across rounds for the cache to hold. The system prompt already is (`docs/design/game-round.md`, "Stable and volatile halves"). The tool list is not: `availableTools()` rebuilds its enums each round (legal directions, reachable items, recipients), and Sysadmin directives are appended to the system prompt mid-game. See "Open questions".

## What carries over from GLM-4.7

| GLM-4.7 technique | On DeepSeek V4.1 Flash |
|---|---|
| English-only lines at the very top | Keep. Same leakage risk, and no cost. |
| Rules early for GLM's "beginning bias" | Harmless, but not the reason to keep them. DeepSeek publishes no beginning-bias guidance. The last user message matters more. |
| MUST/NEVER phrasing | Keep. It matches DeepSeek's own template. |
| XML sections and voice examples | Keep. |
| Thinking off for snappy turns | Reversed. Thinking on is better and fast enough. |
| Temperature 0.85 and repetition penalty for voice | Does not apply. Samplers are ignored with thinking on. |
| "Author voicing a character" framing | Keep. It works, and no evidence says otherwise. |

## Measured on the game's own evals

2026-09-27, pinned endpoint, 30-round drift eval, 72-turn action-variation eval, 10-pack content eval. Details in ADR 0017.

| | Thinking off | Thinking on |
|---|---|---|
| Turns with no `message` call (drift) | 10–23% | 3–10% |
| Ignored free-text turns (drift) | 0–2 of 30 | 0 of 30 |
| Objective scenario: chose `use` | 11 of 24 | 113 of 120 (94%) |
| Messages over 3 sentences (drift) | 0 | 0 |
| Cost per Daemon turn | $0.0001–0.0002 | $0.0003–0.0005 |

### Retune of 2026-09-28

All four harnesses were run on the pinned endpoint with thinking on: 30-round drift, 90-turn action-variation with profiles (3 scenarios × 3 personas × 10), 10 content packs, and the directions eval.

| | Before | After |
|---|---|---|
| Drift: pick_up calls in 30 rounds | 13 (a pick_up → use loop from round 8 to 30) | 5 (with the "set into" tag only; the pick_up lock came after this run) |
| Drift: turns with no `message` call | 13% | 10% |
| Action-variation: messages over 3 sentences | 35 of 149 | 18 of 149 |
| Objective scenario: chose `use` | 27 of 30 | 26 of 30 |
| Content packs passing on the first attempt | 7 of 10 (all 3 failures a decoy `verb-of-activation`) | 9 of 10, no validation errors |
| Directions eval | PASS, 100% coherence (first run of the updated runner, which now pins the provider) | not re-run (no prompt change targets directions) |

What changed:

- **A placed carry object no longer reads as dropped.** The state message tagged the flashlight "(on the ground — not held)" the round after the Daemon seated it in the mount. DeepSeek trusts the last user message over the history ("the flashlight rolled off"), so it picked the item back up, which undoes a Carry objective. It now renders as "(set into the wall mount)". See `docs/design/game-round.md`, "Listing rules".
- **The `REMINDER` ends with "Keep each `message` to 1–3 sentences."** The rule was already in `<rules>`, but effusive and clipped personas broke it on up to a third of their messages. Restating it in the last user message halved the overruns without moving the objective scenario. Clipped personas still write strings of fragments ("Dead station. Strip-lights, damp.") that count as sentences. That is in character, not verbosity.
- **The decoy prompt spells out its banned words** (`DECOY_FORBIDDEN_WORDS` in `content-pack-provider.ts`), including innocent uses such as a cup handle or the wind.

Not changed, and why:

- The "yes? yes?" tic in the action-variation eval comes from the eval's own Pip fixture, whose voice example is "here, take this one — yes? yes?". It is guideline 4 above at work, not a production problem.
- The Objective scenario still loses about 1 in 10 turns to a step toward an item already in reach. That is within the ADR 0017 range.

### Messaging blue (2026-09-28)

Players found that DeepSeek Daemons messaged blue on almost every turn, even a Daemon blue had never spoken to. The prompt asked for it: `<rules>` called two `message` calls "one to a peer, one to blue" "the normal shape of a multi-party chat", and the `REMINDER` repeated "including two `message` calls (peer + blue) when both fit". Those lines were written for GLM-4.7, which drifted into silence. DeepSeek follows them literally. In the social scenario, where only a peer has spoken, 24–29 of 30 Daemons messaged blue anyway.

ADR 0018 replaces that with two rules, and leaves the rest to the Daemon's personality and situation:

- **One `message` per turn.** The round coordinator delivers the first `message` call and rejects any later one ("only one message tool call per turn"), just as it rejects a second action. The rules say the Daemon's `<personality>` and the situation decide who gets it.
- **A reason to message blue.** `<rules>` says to message blue only with a reason of the Daemon's own (finding out who blue is, asking blue for help, answering blue because it wants to), that it does not owe blue an answer, and never to message blue just to report what it sees or does. The `REMINDER` repeats the reason clause.

Measured on the pinned endpoint. The objective scenario ran 30 reps per persona; social, exploration and the new coordination scenario 20; drift once for 30 rounds.

| | Before | Strict gate (reply only) | Forced answer | Final |
|---|---|---|---|---|
| Social (only a peer spoke): messaged blue | 24–29 of 30 | 0 of 30 | 0 of 60 | 0 of 60 |
| Exploration (blue asked "let me know what you see"): answered blue | 30 of 30 | 30 of 30 | 60 of 60 | 39 of 60 |
| Objective (blue asked "think you can fit it?"): answered blue | 30 of 30 | 30 of 30 | 90 of 90 | 79 of 90 |
| Coordination (a peer proposes a plan, blue asks "who are you talking to?"): messaged the peer | — | — | — | 59 of 60 |
| Drift: blue's 16 messages answered | 16 | 16 | 16 | 6 |
| Objective: chose `use` | 83 of 90 | 73 of 90 | 80 of 90 | 76 of 90 |
| Turns with more than one `message` call | 102 of 180 | — | 0 of 210 | 0 |

The "Final" behaviour follows the persona. Pip, whose goal is to stay close to peers, answered blue's exploration request in 12 of 20 runs and spent the rest on a peer. Vex answers blue in clipped lines ("on it. mount's mine."). In coordination each persona takes the peer's deal in its own voice ("Deal. Watching. Flip it."; "Deal, deal — I'm watching my side, eyes wide."). In the social scenario, where blue never spoke, no run messaged blue.

What did not work, so you do not retry it:

- **Hard `MUST NOT message blue` lines in the per-turn state** for the never-messaged and already-answered cases. They stopped unprompted messages completely, but `use` fell from 83 to 73 of 90, mostly from the go-leaning persona stepping instead of using. It is the same effect as the grid-words rule (guideline 7): a speech rule the model reads last pulls its thinking away from acting.
- **Forcing an answer.** A per-turn line "blue asked you something and is waiting on your answer: this turn's `message` goes to blue" made every Daemon answer every question, whatever its personality, and overrode peer coordination. That is the opposite of what the game wants.
- **A long list of reasons to ignore blue** ("a guarded, busy or distracted Daemon, or one in the middle of a plan with a peer…"). The go-leaning persona's `use` rate fell to 10 of 30. Keep the blue rule short.

## Open questions

These came out of the research. Each is larger than a prompt edit and should get its own issue and eval run.

1. **Replay reasoning across rounds.** DeepSeek's docs say that with `tools`, every earlier assistant turn's reasoning must be sent back. The native API returns 400 without it. Through OpenRouter it returns 200 either way [verified]. In a small A/B on a trimmed prompt, leaving it out gave free-text replies in 3 of 6 runs, against 0 of 6 with it passed back [verified, small sample]. The production-prompt drift eval saw no free-text turns without it. Doing this means storing each turn's trace and bumping `SESSION_SCHEMA_VERSION`.
2. **Keep the tool list stable per session.** Fixed enums covering every id in the pack, with the dispatcher rejecting illegal moves, would keep the cache near 92% on long games instead of dropping to about 10% whenever an enum changes. The enums are guard-rails today, so this needs an ADR and an action-variation run.
3. **Move Sysadmin directives out of the system prompt**, into a mid-conversation `system` message at the round they arrive or into the per-turn state, so the system prefix never changes mid-game.
4. **Effort `low` against `high`** over whole games.
5. **One untested prompt line:** a ban on the "not X, but Y" construction. (The `REMINDER` length line was tested on 2026-09-28 and shipped. See "Retune of 2026-09-28" above.)

## Unverified, or not reached

- The V4.1 technical report was not readable from the research sandbox (huggingface.co and arxiv.org downloads were blocked). Anything it says about instruction following or roleplay training is unread.
- DeepSeek's API docs were read through Exa's cached copies, which stop at 2026-07-31. The `top_p` floor and the claim that the penalties are deprecated in both modes come from secondary summaries.
- Whether OpenRouter drops `parallel_tool_calls` for this endpoint is inferred from its parameter list.
- The 128-token cache unit is inferred from observed counts.
- Reports that DeepSeek injected hidden roleplay instructions server-side on V4 come from one preset author and are unverified for V4.1.

## Sources

- Model card and prompt encoding: <https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash> (`README.md`, `encoding/README.md`, `encoding/encoding.py` and its test cases)
- DeepSeek API guides: thinking mode <https://api-docs.deepseek.com/guides/thinking_mode/>, tool calls <https://api-docs.deepseek.com/guides/tool_calls>, JSON output <https://api-docs.deepseek.com/guides/json_mode>, context caching <https://api-docs.deepseek.com/guides/kv_cache>, V4.1 release <https://api-docs.deepseek.com/news/news260910>
- deepseek-recipe: <https://github.com/deepseek-ai/deepseek-recipe>
- OpenRouter: reasoning tokens <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens>, prompt caching <https://openrouter.ai/docs/features/prompt-caching>, endpoint metadata `https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints`
- DeepSeek V4 roleplay control instructions and badcase report: <https://github.com/victorchen96/deepseek_v4_rolepaly_instruct>
- Community: <https://www.roborhythms.com/deepseek-v4-1-flash-roleplay/>, <https://www.roborhythms.com/deepseek-v4-flash-janitor-ai/>, <https://rpfiend.com/deepseek-v4-flash-presets-sillytavern/>, <https://www.youtube.com/watch?v=uYUlCLSPxaw>
- Secondary summaries: <https://go.tabbit.ai/model/deepseek-v4-1-flash/prompts/deepseek-thinking-mode-and-reasoning-parameters>, <https://rocm.docs.amd.com/projects/atom/en/latest/deepseek_v41_protocol.html>
