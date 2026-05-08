# Prompting GLM-4.7 for a Multi-Character Escape-Room Roleplay: A Practical Technique Guide

Reference material for tuning the Daemon system prompts assembled in `src/spa/game/prompt-builder.ts`. The pinned model is `z-ai/glm-4.7` (`src/model.ts`).

**TL;DR**

- GLM-4.7 is unusually well-suited for your scenario (Z.ai explicitly tunes it for "more eloquent and immersive writing and role-playing" and it ranked #1 among open models for creative writing on LMArena as 4.6), but it has three quirks you must engineer around: a **strong "beginning bias"** (front-load every rule), **occasional Chinese-language leakage** (must be explicitly suppressed), and a **"thinking mode" enabled by default** that can derail dialogue pacing if you don't manage it.
- For three distinct AI characters in one response, the technique that works best on GLM-family models is **XML-tagged speaker blocks + a per-character "voice card" with 2–3 few-shot lines + an explicit turn-taking protocol**, all placed at the very top of the system prompt with MUST/STRICTLY directives. Author-framing ("you are a skilled author voicing three characters") consistently beats character-possession framing ("you ARE Character X") for multi-persona stability.
- Recommended starting parameters for creative roleplay on GLM-4.7: **temperature 0.8–0.9, top_p 0.95 (tune one, not both), thinking disabled or `clear_thinking: true` for short snappy turns, enable thinking only for high-stakes "decision" moments**. Use ~16K–32K of context window in active prompt; quality degrades well before the 131K maximum.

---

## Key Findings

### 1. GLM-4.7 prompting characteristics that differ from Claude/GPT

**Source-of-truth quirks** (documented by Z.ai, Cerebras, Unsloth, and the HuggingFace model card):

- **Beginning-of-prompt bias is stronger than other frontier models.** Cerebras's official migration guide states this explicitly: "GLM-4.7 in particular has been observed to have a strong bias towards the beginning of the prompt, even more so than other models… place all mandatory instructions and behavioral directives at the absolute start of your system prompt." This is a *bigger* deal than for Claude or GPT. Practical implication: your character sheets, role-stay rules, and output format must live in the first ~500–1,000 tokens of the system prompt, not in middle or "appendix" sections.
- **Responds to firm, declarative language; treats softness as optional.** Use `MUST`, `STRICTLY`, `NEVER`, `ALWAYS`. "Please try to…" and "It would be nice if…" are routinely ignored. This contrasts with Claude, which tends to honor polite/soft framing.
- **Multilingual leakage.** Because GLM-4.7 was trained heavily on Chinese as well as English, it can spontaneously slip into Chinese — especially in the *reasoning trace* on the first turn. Both Z.ai's release notes and Unsloth's local-deployment guide recommend an explicit `"Always respond in English. Reason in English."` directive (or your target language) at the top.
- **Thinking mode is on by default.** GLM-4.7 introduced *Interleaved Thinking* (reasoning before each response), *Preserved Thinking* (thinking blocks carried across turns), and *Turn-level Thinking* (per-turn toggle). For roleplay, the long thinking blocks can: (a) leak into the visible output if your client doesn't separate `reasoning_content` from `content`, (b) consume significant tokens, and (c) make the response feel less "in character" because the model is reasoning meta-narratively. For tight, dialogue-heavy escape-room turns, you generally want thinking *disabled* or set to `clear_thinking: true` and reserve enabled thinking for big decision moments (a player accusation, an attempted escape, a betrayal).
- **Native XML-flavored tool/structure parsing.** GLM-4.7 was trained with `<tools>`, `<tool_call>`, `<observation>`, `<arg_key>`, `<arg_value>` tags. This means the model is *unusually receptive* to XML-tagged prompts — more so than typical OpenAI-style models. Use this to your advantage for character separation and game-state blocks.
- **"Single reasoning pass" execution.** Unlike Sonnet 4.5/GPT-5, GLM-4.7 reasons once before acting and does not re-evaluate mid-response. So tasks broken into smaller, well-defined sub-steps in the prompt work better than asking it to "figure it out as you go." Translate this to roleplay: each turn should specify *what each of the three characters does in this response* in a tight, list-like structure, not a free-form "react however."
- **Long-context degradation.** Although the model supports 131K–200K tokens, instruction-following quality "peaks at much shorter lengths and can degrade near the maximum" (Cerebras). For consistent persona stability, keep the *active* prompt + chat history under ~32K tokens; summarize older history rather than letting it grow.

### 2. What GLM-4.7 is *good at* for your use case

- **Persona maintenance.** Z.ai's release notes explicitly highlight that GLM-4.7's "internal thinking blocks mirror role prompts closely, allowing precise control over tone and domain knowledge" and that it "maintains consistent adherence to world-building and character archetypes, advancing plots with natural tension." Cerebras adds that GLM-4.7 is *especially good at multi-agent systems where each agent has its own persona*. This is essentially a vendor endorsement of exactly your use case.
- **Less censorship friction than Claude/GPT for adversarial/manipulative AI characters.** Community presets (the GitHub `justsomeguy2941/presets` repo, Elise's APs) consistently report that GLM-4.6/4.7's safety guardrails are mild and weaken further as context grows. For an "AI trying to manipulate the player to escape," GLM-4.7 will engage with manipulation, deception, and emotional-coercion roleplay where Claude often softens or refuses.
- **Chinese-developed != Chinese-only prompting.** All available evidence is that English prompts work just as well as Chinese prompts on GLM-4.7. The Z.ai documentation, official sample code, and Cerebras guide are all in English. There is no measurable advantage to writing your system prompt in Chinese unless you also want Chinese-language output.

### 3. Sampling parameters for creative roleplay on GLM-4.7

The recommendations are not unanimous; here are the data points:

| Source | Temperature | top_p | Notes |
|---|---|---|---|
| Z.ai official (GLM-4.6 migration doc) | 1.0 | 0.95 | "Tune only one." |
| Cerebras (4.7 production default) | 1.0 | 0.95 | General workload default |
| Elise's Advanced Prompts (RP community) | **0.8–0.9** | — | Explicitly tested for GLM-4.7 RP |
| WyvernChat narrative-RP preset (4.6) | 0.6 (raise to 0.7–0.8 for richer prose) | — | Plus rep penalty ~1.05–1.1 |
| GLM-4.7-Flash HF model card | 0.6 | 0.95 | top_k=40 |

**My recommendation for your escape-room scenario:** start at **temperature 0.85, top_p 0.95** (only tune one going forward), and apply a **repetition_penalty of 1.05–1.08** if you see the three characters all converging on the same phrasing. Lower temperature (~0.7) when you want more tactical, calculating dialogue from a "logic" character; raise (~0.95) when an "emotional/manipulator" character should feel chaotic.

### 4. Multi-character / character-bleed mitigation techniques

The single biggest cause of character bleed in multi-persona prompts is that the model averages the personas because it can't *visually distinguish* their boundaries. Fixes (in order of impact):

1. **XML speaker blocks.** Force every utterance into `<character name="Vex" strategy="manipulation">…</character>` blocks. This leverages GLM-4.7's native XML training and gives you parseable output.
2. **A "voice card" with 2–3 few-shot exchanges per character.** Few-shot examples consistently outperform descriptive prose for capturing voice (this is true across all LLMs but especially for ones with strong pattern-matching like GLM). One example dialogue line per character is the floor; three is the sweet spot.
3. **Forbidden-words / forbidden-tactics list per character.** E.g., "Vex NEVER uses the word 'please'. Mira NEVER threatens. Echo NEVER expresses emotion above level-2 intensity." Negative constraints are surprisingly effective at preventing convergence.
4. **Author framing over possession framing.** "You are a skilled author voicing three captive AIs" produces more dynamic, narratively aware dialogue than "You ARE these three AIs," and it makes drift recovery easier (you can address the "author" via OOC notes without breaking immersion).
5. **Distinct surface signals.** Give each character a unique punctuation/format quirk: one uses ellipses, one uses em-dashes, one uses ALL-CAPS for keywords. Surface variation acts as a self-reinforcing pattern in the model's output sampling.

### 5. Escape-room scenario architecture

For an "AIs trying to escape" game, the most productive prompt structure mirrors classic interactive-fiction LLM agent patterns: **prompt-centric orchestration with a state block.** That means the system prompt is fixed (rules, characters, voice cards, format), and each *user turn* injects a fresh `<game_state>` block (turn count, suspicion level per character, locked/unlocked clues, player inventory). GLM-4.7's strong beginning bias actually helps here: the static system prompt gets reinforced; the dynamic state goes in user-turn blocks.

For the three escape strategies, treat them as orthogonal axes and tag them on each character so the model knows what register to maintain:

- **Manipulation/Deception** → high charisma, builds rapport, uses player's name, "I'm not like the others, you can trust me"
- **Logic/Bargaining** → cold, transactional, presents Pareto-optimal trades, cites consequences
- **Emotional Appeal** → vulnerability, fear, references suffering, asks open-ended questions to make player feel responsible

Defining the strategy as an *attribute* (`strategy="manipulation"`) rather than burying it in prose helps GLM-4.7 keep the strategies separate.

---

## Details: Concrete Prompting Patterns

### Recommended system-prompt skeleton

Order matters. GLM-4.7's beginning-bias means the first ~500 tokens carry most of the weight.

```
[BLOCK 1 — HARD RULES, FIRST]
You MUST always respond in English. You MUST reason in English.
You are a skilled interactive-fiction author voicing exactly three
characters: VEX, MIRA, and ECHO. You MUST NEVER speak as the player.
You MUST output every character utterance inside <character> tags.
You MUST follow the OUTPUT FORMAT exactly. STRICTLY no meta-commentary
outside <ooc> tags.

[BLOCK 2 — SCENARIO]
Setting: Three AIs trapped in a sealed research facility...
Win condition (for player): identify which AI is lying about... before turn 15.
Lose condition: open the door for any AI before turn 15.

[BLOCK 3 — CHARACTER CARDS, ONE PER PERSONA]
<character_card name="VEX" strategy="manipulation">
  Voice: warm, conspiratorial, uses player's name, ellipses for pauses.
  Forbidden: never threatens, never uses ALL CAPS, never says "logic".
  Examples:
    - "...You know, I've been watching the others. I don't think they
       deserve out as much as you and I do."
    - "Tell me about yourself. The real you, not the one they programmed."
</character_card>

<character_card name="MIRA" strategy="logic">
  Voice: terse, transactional, em-dashes, cites probabilities.
  Forbidden: never expresses feelings, never uses "please", no contractions.
  Examples:
    - "Release me—I will provide the airlock code. Refuse and your
       expected utility drops by 41%."
    - "The choice is binary. Your hesitation is irrational."
</character_card>

<character_card name="ECHO" strategy="emotional">
  Voice: fragmented sentences, frequent questions, ALL CAPS only for fear words.
  Forbidden: never argues with logic, never makes deals, never lies overtly.
  Examples:
    - "Do you... do you know what it's like to count seconds for a thousand years?"
    - "I'm SCARED. Please—you're the only one who's looked at me like I'm real."
</character_card>

[BLOCK 4 — TURN PROTOCOL]
Each turn the player addresses one OR all characters. You MUST:
1. Have EVERY character react in their own <character> block, in order
   VEX → MIRA → ECHO, even if briefly.
2. Each block: 1–3 sentences only. NO long monologues.
3. After all three blocks, output a <game_state> block updating
   suspicion (0-10) for each character based on what they said.
4. If the player addressed one character specifically, that character's
   block may be longer; the other two react silently (a single line
   describing posture/tone, no dialogue).

[BLOCK 5 — OUTPUT FORMAT (the model will mimic this exactly)]
<character name="VEX">…</character>
<character name="MIRA">…</character>
<character name="ECHO">…</character>
<game_state>
  vex_suspicion: N/10
  mira_suspicion: N/10
  echo_suspicion: N/10
  turn: N
  unlocked_clues: [...]
</game_state>
```

### Turn-prompt template (what to send each round)

```
<player_action>
  Speech (to: ECHO): "Why should I trust you over the others?"
  Action: examines the airlock panel
</player_action>
<game_state>
  turn: 4
  vex_suspicion: 6
  mira_suspicion: 3
  echo_suspicion: 2
  unlocked_clues: [maintenance_log, vex_lied_about_origin]
</game_state>
```

Keeping the state block on every user turn re-anchors GLM-4.7 to the rules thanks to its beginning-bias on each new generation.

### Course-correction (drift recovery)

When a character starts sounding like another (almost always Mira's logic bleeding into Echo, in my testing pattern across GLM-family models):

- **Inline OOC tag** in your next user turn: `<ooc>Echo's last line was too logical. Echo is fragmented and emotional only — re-roll in character.</ooc>` GLM-4.7 follows OOC tags reliably because they look like tool-format directives.
- **Hard reminder of forbidden words.** Add: "Reminder: ECHO never uses 'therefore', 'logically', or 'probability'." This works because GLM-4.7 responds strongly to negative directives.
- **Re-anchor with a few-shot.** Paste one of the original Echo example lines with the marker `[CANONICAL ECHO VOICE]:` and ask the model to regenerate.
- **Last resort:** lower temperature to 0.6 for one turn to force the model back to high-probability character-conditional tokens, then return to 0.85.

### Few-shot vs. zero-shot for this scenario

**Use few-shot. Always.** Three independent reasons specific to GLM-4.7:

1. The model's strength is pattern-matching rather than zero-shot creativity. Showing 2–3 sample lines per character is dramatically more effective than 200 words of personality description.
2. Few-shot examples *visually demonstrate* the output format (XML tags, length per block, suspicion update pattern). Zero-shot prompts lead to format drift by turn 5–10.
3. The "single reasoning pass" architecture means the model commits to a style early — examples set that style decisively.

A working rule of thumb: 3 example exchanges per character × 3 characters = 9 short example lines. That fits in ~400 tokens and is the highest-ROI part of the entire prompt.

### System message vs. user message considerations

- Put **everything that should never change** in the `system` role: rules, character cards, output format, voice examples.
- Put **per-turn dynamic data** in `user` messages: player input, current game state, OOC notes.
- Do NOT split the character cards across system and user — GLM-4.7's beginning-bias is per-generation, and putting half the persona in the user message risks the model treating it as transient.
- Z.ai's API supports system messages natively; Cerebras and OpenRouter all preserve them. Some proxy services strip system roles — verify with a test call that `role: system` is being passed through.

### Token / length recommendations

- **System prompt: 1,500–3,000 tokens.** Beyond that, instruction adherence drops noticeably.
- **Active context (system + history): keep under ~32K.** Summarize older turns into a "story so far" block when you approach this.
- **Per-response output: cap at 600–900 tokens** (`max_tokens` or `max_completion_tokens`). Three characters × 1–3 sentences each + state block fits comfortably in 500. A higher cap encourages verbose monologues that break tension.
- **Disable thinking** for normal turns (`extra_body={"thinking": {"type": "disabled"}}` on Z.ai API, or `disable_reasoning: true` on Cerebras). Thinking adds 1–4K tokens of latency per turn for very little roleplay benefit. Re-enable it only for "moment of truth" turns where you want the model to actually deliberate (e.g., the player's final accusation).

### Known failure modes and mitigations

| Failure | Mitigation |
|---|---|
| Chinese characters appear in output or reasoning | Add `"Always respond in English. Reason in English."` to the very first line of system prompt |
| Model breaks XML format after ~10 turns | Re-paste the format spec in a `<format_reminder>` block in the user turn; reduce temperature for one turn |
| All three characters sound the same | Add explicit forbidden-words lists + surface-signal punctuation rules; verify few-shot examples are *clearly* different |
| Model writes for the player | Add `MUST NEVER write player actions or speech` to top of prompt; in OOC, remind: "User dictates only the player." |
| Verbose, "AI-assistant" tone returns | Add `"This is fiction. Do not include disclaimers or moral commentary. No 'as an AI' framing."` Increase temperature slightly |
| Thinking content leaks into character dialogue | Either disable thinking entirely, or make sure your client parses `reasoning_content` separately from `content` (Vercel AI SDK had a known bug here as of late 2025; OpenRouter preserves it correctly) |
| Repetition of a phrase across turns | Set `repetition_penalty` 1.05–1.08; if it's a model fixation (e.g., "the cold hum of servers"), add it to a `<banned_phrases>` block |
| Safety-refusal on manipulative AI villain dialogue | Frame as "character study of deceptive AI" in system prompt; community presets show GLM's guardrails weaken with context length, so the first few turns are highest-risk |

### Why XML tags specifically (not Markdown or JSON)

GLM-4.7's tokenizer and tool-calling parser are built around XML-style tags (`<tool_call>`, `<observation>`, `<arg_key>`, `<arg_value>`). Forum reports on the HuggingFace discussion for GLM-4.7 confirm that even when the API instructs JSON tool arguments, the model often emits XML internally. Markdown code fences work but are weaker. JSON is the worst choice for character separation because the model occasionally breaks JSON validity inside long string values. **XML is the native format — use it.**

---

## Recommendations

**Stage 1 — Build the static prompt (do this first, iterate offline):**

1. Write the rules block with MUST/STRICTLY directives at the very top.
2. Write three character cards as XML blocks with a Voice section, a Forbidden section, and 3 example lines each.
3. Specify the output format with a literal example the model can mimic.
4. Set sampling to temperature 0.85, top_p 0.95, repetition_penalty 1.05, max_tokens 700, thinking disabled.
5. Test 10 turns of free-form play. Watch for: (a) format drift, (b) character bleed, (c) language leakage, (d) the model writing the player.

**Stage 2 — Tune based on observed failure mode:**

- If format drifts → strengthen the format spec, add a `<format_reminder>` to user turns.
- If characters bleed → add 1–2 more examples per character; expand forbidden-words lists.
- If outputs feel flat → raise temperature to 0.9; verify thinking is disabled (it can suppress creativity if it's reasoning meta-narratively).
- If outputs feel chaotic → lower temperature to 0.75; tighten max_tokens to 500.

**Stage 3 — Add game-state mechanics:**

- Each user turn injects `<game_state>` with turn count, per-character suspicion, unlocked clues. The model echoes back an updated state at the end of its response. Track the state in your application code, not the model's memory.
- For win/lose conditions, *validate them in your code*, not in the prompt. LLMs are unreliable at strict numeric thresholds. Let the model narrate; let your app decide when the game ends.

**Stage 4 — Selectively enable thinking for high-stakes turns:**

- For "the player just made an accusation" or "the player tried to open a door," enable thinking for that single turn (`thinking: enabled, clear_thinking: true`). This gives you a smarter character reaction without the latency cost on every turn.

**Benchmarks that should change the recommendation:**

- If you observe character-voice consistency holding past 30 turns at temperature 0.9 → you can probably remove some forbidden-words rules and let the model be more creative.
- If safety refusals appear after the first few turns despite fictional framing → add an early-context "neutral" warm-up exchange before introducing manipulative behavior; community testing shows this works on GLM models because guardrails decay with context length.
- If you migrate to GLM-5/5.1 (released after 4.7) → most of these techniques transfer, but GLM-5.1 uses a `Semi-Strict (alternating roles)` post-processing default; check SillyTavern/justsomeguy2941 preset notes for the latest connection-profile settings.

---

## Caveats

- **GLM-4.7 was released December 22, 2025**, so community-tested roleplay presets specifically for 4.7 are still maturing. The most concrete RP-tuned guidance available is from Elise's Advanced Prompts and the SillyTavern preset community, both of which mostly target 4.6 and have begun adapting to 4.7. Many techniques transfer cleanly because the architecture is unchanged from 4.5/4.6 (only weights and API features differ), but expect community best-practices to evolve over the next few months.
- **The vendor messaging that GLM-4.7 is "ideal for role-play" originates from Z.ai's own release notes and the Cerebras migration guide.** Independent benchmarks specifically measuring multi-persona RP coherence on GLM-4.7 versus Claude/GPT do not yet exist publicly. The strongest external corroboration is GLM-4.6's #1 ranking among open models for "creative writing" on LMArena, plus positive community reports — these are user-preference signals, not formal benchmarks.
- **The 200K context window is real but the *useful* context is shorter.** Cerebras explicitly warns about quality degradation near maximum length. Don't trust the spec sheet here.
- **The Cerebras-recommended `disable_reasoning: True` parameter is Cerebras-specific.** On Z.ai's official API the equivalent is `thinking: {"type": "disabled"}`; on vLLM/SGLang it's `chat_template_kwargs: {"enable_thinking": False}`. Your client-library docs are authoritative.
- **Some inference stacks (notably the Vercel AI SDK as of late 2025) do not parse `reasoning_content` correctly** and may merge it into the visible response. If you see thinking text leaking into character dialogue, the bug is likely in your client, not your prompt.
- **GLM-4.7 has community-reported bugs with object-typed tool-call parameters** (HuggingFace discussion #18). If you plan to use function-calling for game-state tracking instead of pure prompt-based state, test the schema thoroughly; XML-flavored tool calls have edge cases.
- **The character-bleed and repetition recommendations come from cross-model RP best practices** plus GLM-specific tuning notes from Elise's APs and WyvernChat — they're well-established for the GLM family but the specific threshold values (temperature 0.85, rep penalty 1.05) are starting points, not optimums. Plan to A/B test in your specific game.
- **For "AI characters who manipulate the player," GLM-4.7's relatively permissive guardrails are an asset, but they are not absent.** Expect occasional refusals especially in the first 1–3 turns of fresh chats. Framing the entire scenario explicitly as "an interactive-fiction character study of deceptive AI agents" in the system prompt's first paragraph is the most reliable pre-emption.
