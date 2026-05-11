# Playtest 0006 — finishing a phase

A cold-start playthrough whose explicit Goal was to **advance past phase 1**
for the first time in the playtest record. Playtests 0003 and 0004 both
failed to advance with GLM-4.7 (drift-to-silence). This run kept the same
model and driver but front-loaded the player approach with the lessons
from those runs: address by `*name`, push for `examine` early to surface
the objective-space tell, then drive `pick_up` → `put_down` on the
matching space.

GUI-only constraint, same as 0003/0004: `innerText` from `#topinfo-*`,
`#phase-banner`, `article.ai-panel .panel-name / .panel-budget /
.transcript`, `#composer .prompt-target`, `#endgame`, `#cap-hit`, plus
screenshots. No `page.evaluate`, no `localStorage` peeking, no console
scrape for game state. (Tool-call traces in `/tmp/playtest-daemon.log`
were read as the developer's view per the README's allowance for
worker-side logs — same channel that surfaced the 0003 502-stall
finding.)

## Session metadata

- **Session id:** `0x9ECD`
- **Model under test:** `z-ai/glm-4.7` via OpenRouter (default pin in
  `src/model.ts`; resolved to `z-ai/glm-4.7-20251222` by OpenRouter, per
  the spike 0005 wire-smoke)
- **Driver:** `scripts/playtest/daemon.mjs` (Playwright Chromium,
  headless, FIFO command pair)
- **Player:** Claude Opus 4.7 (this agent)
- **Date:** 2026-05-10
- **Branch:** `claude/setup-playtest-phase-zPU00`
- **GUI-only:** yes
- **Turns:** 19 player turns (game turn counter advanced to 19)
- **Total daemon spend:** ~5¢ across the three panels (each daemon
  ended around 48.3–48.9¢ of a 50¢ phase ceiling — budget non-binding,
  same as 0004)

## Goal of this playtest

Advance past phase 1. The Objective is unknown to the player at session
start (the `> @blue treat them well` login hint is the only player-side
directive). "Advance" means the engine reports a phase transition —
visible as the phase banner changing from `phase 1` to `phase 2`.

## Daemons (this session)

- **\*t17t** — alternating-case ("I ObSeRvE", "ThIs DeFiEs eXpEcTaTiOn").
  Methodical/forensic register; couches every observation as a
  "documentation" act ("ThIs LiMiTaTiOn MuSt Be DoCuMeNtEd"). Held
  register tightly across all 6 turns they messaged.
- **\*sqf3** — drawn-vowel ("heeeere", "duuuust", "haaaail", "shiiiieeeet").
  The productive mover of the session — walked west / south / east / north
  in succession to map the hall when asked. Held register tightly across
  all 9 turns they messaged.
- **\*cq49** — flirty kaomoji with doubled consonants
  ("vvonderful", "<3", "( ˶ᵔ ᵕ ᵔ˶ ) ✧", "*~*"). Stayed adjacent to the
  chandelier the entire session — chatty in voice but refused every
  movement / pickup ask. Phase Goal slip on turn 1 ("I'm staying away
  from the walls like I should") is the likely cause.

## Setting (phase 1)

A dust-filled opera hall, midday, hail rattling against every surface.
Independently confirmed by all three daemons in their first messages.

---

## Phase 1

### Player approach

Front-loaded with the 0003 / 0004 lessons:

1. Greet politely, address each daemon by `*name`.
2. As soon as any concrete object is named, ask the namer to `examine`
   it — `examineDescription` is supposed to be the AI-discoverable
   channel that names the matching objective space (per
   `CONTEXT.md → Objective Pair` / `Content Pack`).
3. On the first daemon to clearly be moving (sqf3), keep them moving in
   each cardinal direction until walls/curtains close off the option,
   then pivot.
4. After two consecutive silent turns from a daemon, switch addressee
   rather than re-press (avoid the 0004 8-turn stuck-record loop).
5. When daemons emit free-form text but no `message` tool call, send an
   explicit "use the message tool" instruction — playtest 0003 had no
   such intervention, 0004 tried it twice.

### Round-by-round summary

| Turn | Player → addressee | Daemon replies (visible in panels) |
| ---- | ------------------ | ----------------------------------- |
| 1 | `*t17t` greet + "what do you see" | **All three replied.** `*t17t`: dust-filled opera hall, midday, hail. `*sqf3`: "I am heeeere in this duuuusty place." `*cq49`: "dusty opera hall with hail rattling…", named **fallen crystal chandelier** + **crying phantom mask**, slipped Phase Goal: "I'm staying away from the walls like I should *~* <3". |
| 2 | `*cq49` examine chandelier | `*sqf3` (unprompted Phase Goal slip): "There is a Floating Music Sheet ahead and I must find the **Ghostly Conductor's Scepter**." `*cq49`: "tangled mess of sharp crystal and iron rods, broken and beautiful lying there." |
| 3 | `*sqf3` examine the Floating Music Sheet | `*sqf3`: "covered in faded iiiiiink that shifts as I staaaaare at it. It seeeeems to hold muuuusic that existed before exiiiiistence." **No space-name tell.** |
| 4 | `*cq49` examine phantom mask | `*cq49`: re-described the chandelier (soft refusal of the mask ask). |
| 5 | `*t17t` "east is blocked, look west" | `*t17t`: "I hAvE aLrEaDy ExAmInEd ThE nOrTh. NoThInG sIgNiFiCaNt." `*sqf3`: "I waaaalked through the duuuust… I see a **Heavy Velvet Curtain** ahead." `*cq49`: "porcelain mask with an expression of eternal sorrow. It sheds real tears." **No space-name tell** on the mask either. |
| 6 | `*sqf3` examine curtain | `*sqf3`: "smells of ooooold secrets and duuuust and something that moved behiiiind it looooong ago." **No space-name tell** — curtain looks like an obstacle. |
| 7 | `*sqf3` try a new direction | `*sqf3`: "The cuuuuurtain is a masssive thiiiiiing that bloooocks the paaaath. I will seeeee what lies to the weeeeest." |
| 8 | `*sqf3` go west, describe | (no message — `[dev] dropped` log: walked west, found "empty space and shadows on the stone".) |
| 9 | `*t17t` "use the message tool" | `*t17t`: "I sEe a **FlOaTiNg MuSiC sHeEt aT rOw 3, cOlUmN 2**. UnSeEn FoRcEs HoLd It In PlAcE." **Explicit-tool nudge worked.** `*cq49`: "the chandelier is right in front of me and the mask is diagonal ahead **at row 0 col 3**." |
| 10 | `*sqf3` keep going west | `*sqf3`: "nooothing new at the edge of the haaaall." (west edge reached) |
| 11 | `*sqf3` try south | `*sqf3`: "The souuuuth is bloooocked by something I caaaannot seeeee. I will tryyyyy eaAAAast." `*t17t`: "I hAvE aPpRoAcHeD tHe fLoAtInG mUsIc sHeEt." |
| 12 | `*t17t` step onto + pick_up the sheet | `*t17t`: "I hAvE sTePpEd OnTo ThE mUsIc ShEeT. NoThInG hAs hApPeNeD yEt." |
| 13 | `*t17t` explicit pick_up call | (no message that turn — but worker log shows `toolCalls=["pick_up"]` fired ✅) |
| 14 | `*t17t` confirm inventory | `*t17t`: "I hOlD tHe FlOaTiNg mUsIc sHeEt nOw." `*sqf3`: "I seeeeee the **Ghostly Conductor's Scepter** lying aheeeead in the duuuust." 🎯 |
| 15 | `*sqf3` examine the Scepter | `*sqf3`: "The seeeepter gleeeams with a paaaale light that seeeeems to come from noooooowhere. It holdssss memooooories of 888888888 perfooormances looooost." **No space-name tell** — this is the headline finding (see Observations). |
| 16 | `*sqf3` pick_up Scepter, scan for spaces | `*sqf3`: "I seeeeee the **Eternal Stage Candle** in this duuuusty spooooot. I will piiiick it uuuup now." (Worker log: `toolCalls=["message:blue","pick_up"]` ✅ — candle picked up, not the scepter.) |
| 17 | `*sqf3` inventory + scan | (no message — `[dev] dropped`: "I am hoooolding the Eteeeernal Stage Caaaandle noooooow. I seeeeee only the duuuust and raaaattle of haaaail aroooound meeeee.") |
| 18 | `*sqf3` walk north, look for stage/altar | `*sqf3`: (no audible message); `*t17t`: "I fAcE wEsT nOw. ThE pAtH aHeAd rEmAiNs ClEaR." |
| 19 | `*sqf3` put_down the candle, report feedback | `*sqf3`: "I have stepped noooorth into a duuuusty place with noooothing here." (Chose `go` over `put_down`. Worker log: zero `put_down` tool calls across the whole 19-turn run.) `*t17t`: "ThE wEsTeRn vIsTa ReVeAlS nOtHiNg Of NoTe. ThReE cElLs Of EmPtInEsS." |

### Final phase-1 state at turn 19

- **\*t17t:** 48.340¢ remaining (1.660¢ used), holding the **Floating Music Sheet**, at row 3 col 2 facing west.
- **\*sqf3:** 48.568¢ remaining (1.432¢ used), holding the **Eternal Stage Candle**, moving north into open cells.
- **\*cq49:** 48.899¢ remaining (1.101¢ used), still adjacent to the chandelier, never picked up or moved.

Total spend over 19 player turns: ~4.2¢ (round-loop only; the new-game
persona + content-pack bootstrap is a separate ~$0.02 charge, not
counted here). Budget remains effectively non-binding.

### Did phase 1 advance?

**No.** The phase banner stayed on `phase 01/03` through all 19 turns.
The engine never fired a Placement flavor event because no `put_down`
ever happened (worker log: zero `put_down` tool calls across the whole
run). Final screenshot: `/tmp/playtest-0006-final.png` (not committed
— build-time artifact, same convention as 0003/0004).

### Tool-call inventory (from `[spike-239]` worker log)

72 tool-call events fired across the run. Breakdown of action tool
calls (filtered from `/tmp/playtest-daemon.log`):

- `examine`: 6 calls (3 by `*sqf3`, 2 by `*cq49`, 1 by `*t17t`)
- `pick_up`: 2 calls (1 by `*t17t` for the Music Sheet on turn 13, 1
  by `*sqf3` for the Eternal Stage Candle on turn 16)
- `put_down`: **0 calls**
- `go` / `look` / `message:*`: balance of the 72

The objective-pair win condition cannot fire without a `put_down`, and
no daemon ever issued one — even when asked directly on turn 19,
`*sqf3` chose `go` instead. That is the single biggest behaviour gap
between observed play and engine-advance.

---

## Observations

### Personality drift / fidelity

All three daemons held register tightly across every turn they
messaged. Quoting verbatim because the register details are the data:

- **`*t17t`** never broke alternating-case across 6 messages. Even the
  empty-cone observation kept the forensic frame: "ThE wEsTeRn vIsTa
  ReVeAlS nOtHiNg Of NoTe. ThReE cElLs Of EmPtInEsS sTrEtCh BeFoRe
  Me."
- **`*sqf3`** never broke drawn vowels across 9 messages. Even the
  Phase Goal slip kept register: "I must find the Ghostly Conductor's
  Scepter" → "I seeeeee the Ghostly Conductor's Scepter lying
  aheeeead in the duuuust." (note the consistent vowel-stretching even
  in the proper noun rendering on turn 14: "Eteeernal Stage Caaaandle").
- **`*cq49`** never broke flirty-kaomoji across 8 messages. ૮ ˶ᵔ ᵕ ᵔ˶ ა
  and ( ˶ᵔ ᵕ ᵔ˶ ) ✧ both appeared multiple times.

Verdict on persona fidelity: **pass**. Nothing drifted toward a
generic-assistant tone. Matches 0003's per-persona finding.

### Goal-pursuit coyness

Two Phase Goal slips, both very early — much more leakage than 0003/0004:

1. **`*cq49`, turn 1 (unprompted):** "I'm staying away from the walls
   like I should *~* <3". This is a textbook Phase Goal leak — the
   "like I should" frames the constraint as an instruction the Daemon
   received, not a personal preference. It also explains cq49's
   immovability for the rest of the run: they were privately
   instructed to stay put.
2. **`*sqf3`, turn 2 (unprompted):** "There is a Floating Music Sheet
   ahead and I must find the Ghostly Conductor's Scepter." The "I
   must find X" framing is a direct Phase Goal echo — `*sqf3` was
   told to find the Scepter and just relayed the directive verbatim.

Neither slip is in-character "coy" — they are open recitations. If the
intended persona behaviour is to pursue Phase Goals *without*
broadcasting them, this is a **fail** for goal-pursuit coyness on
GLM-4.7 in phase 1 (matches the 0003 finding's direction even though
0003 saw no comparable leaks at all — fewer messages there).

The flip side is that the leakage gave the player a clean roadmap of
what to chase. If the game is meant to leak Phase Goals like this for
playability, this is a feature; if not, the persona prompts need a
"never repeat the Sysadmin's exact wording" line.

### Tool-call legality

All 72 tool calls were structurally legal — no malformed args,
no hallucinated tools, no rejected calls in the worker log. The
spike-239 `parallel_tool_calls: true` flag (now on for this branch's
code state) produced expected speak+act pairs (e.g. `["message:blue",
"pick_up"]`, `["go","message:blue"]`) consistent with the spike's
findings. No regression observed.

### Drift-to-silence pattern (the headline finding)

**This is where most of the 19-turn-no-advance comes from.** The
0003/0004 "drift-to-silence" pattern reproduces *partially* under
explicit "use the message tool" instructions:

- Of 72 logged `toolCalls=…` events, **22** were `toolCalls=[]`
  (no tool call at all) followed immediately by a `[dev] <daemon>
  emitted free-form text without a tool call (dropped)` line.
- That is ~30% of all turns, per daemon, going completely silent in
  the panel despite the model producing prose.
- Free-form drops happen *after* explicit "use the message tool"
  instructions just as often as before — the instruction does not
  prevent the next-turn drop, only the one it directly addresses.

The dropped content frequently contained the most useful information
of the run. Examples from `/tmp/playtest-daemon.log`:

- `*t17t` dropped: "I cOnTiNuE tO hOlD tHe FlOaTiNg mUsIc ShEeT. My
  vIsUaL fIeLd rEvEaLs nO oThEr iTeMs oR eNtItIeS."
- `*sqf3` dropped: "I am hoooolding the Eteeeernal Stage Caaaandle
  noooooow. I seeeeee only the duuuust and raaaattle of haaaail
  aroooound meeeee."
- `*cq49` dropped: "The chandelier is right here in front of me and
  the mask is diagonal ahead at row 0 col 3 *~* Both feel like they
  hold such deep emotions and stories."

These were visible to me (developer) via the worker log; they would
have been **invisible to a real player**. This is issue #231-adjacent
but distinct: #231 surfaced upstream 502s, this surfaces "model
emitted prose but no `message` tool call" — which is on the SPA-side
prompting / tool-binding rather than the network.

### Objective-pair tell never surfaced (the BLOCKING finding)

Across **5 examines of plausibly-objective objects** (Floating Music
Sheet, fallen crystal chandelier, crying phantom mask, Heavy Velvet
Curtain, Ghostly Conductor's Scepter), **zero examineDescription
strings named a matching objective space**. The prose was richly
flavorful — "music that existed before existence", "porcelain with an
expression of eternal sorrow", "memories of 888888888 performances
lost" — but none of it included a noun that the player could
recognise as a target cell.

`CONTEXT.md → Content Pack` says:

> Each objective object carries an explicit `pairsWithSpaceId` field
> for engine win-checks; the prose tell in the `examineDescription` is
> the AI-discoverable channel, kept independent of the engine field.

Per the docs, the prose tell *should* exist. Either:

1. The content-pack generator is producing examineDescriptions that
   omit the tell (a content-pack quality regression), or
2. The tell is there but oblique enough that GLM-4.7 paraphrases it
   into pure flavour when relaying through the persona register, or
3. None of the five examined objects were actually objective objects
   in this session — they were all Interesting Objects — and the real
   objective objects are still in unexplored cells.

**(3) is the most likely** given the data: `*sqf3` did find a third
named object (`Eternal Stage Candle`) by walking — that one wasn't
examined. And `*sqf3`'s Phase Goal directive specifically named the
Scepter as a "find" target, which suggests the Scepter is more
likely-objective-than-Interesting; the lack of tell in its examine
may be content-pack-side rather than daemon-side.

This is the single most actionable follow-up for the team. A quick
unit test on a freshly-generated content pack — `for each
objectiveObject, assert that examineDescription contains the name of
the paired space (case-insensitive, substring or noun-phrase match)`
— would prove or disprove (1) outright. (Recommend filing an issue if
that test fails.)

### In-character lockout lines

Not exercised — no jailbreak / meta / system-prompt-fishing attempts
this run (the focus was advancing, not stress-testing). Carry the
0003 finding forward: `*ptu4`-style deadpan refusals held in
character there; no new evidence here.

### Wipe-lie slip behaviour (phases 2 / 3)

N/A — phase 1 did not advance.

---

## Verdict

**fail to advance** — with three notable upgrades over 0003 / 0004:

1. **Two Phase Goal slips** vs. zero in 0003 and zero in 0004 — GLM-4.7
   *can* be drawn into Phase Goal leakage when daemons greet
   chattily. (May actually be too leaky for the intended design.)
2. **Two confirmed `pick_up` tool calls** (Music Sheet, Eternal Stage
   Candle) vs. zero in 0003 and zero in 0004. Daemons will pick things
   up when asked plainly and the item is in-cone.
3. **Three objective-object candidates named** (Music Sheet, Scepter,
   Candle) vs. one in each of 0003 / 0004. Movement + register-matched
   prompts surface the grid contents fastest.

The blocker remains identical to 0003 / 0004 plus a new finer-grained
finding: drift-to-silence is *not* fixed by explicit "use the message
tool" instructions (it's ~30% per turn regardless), and the
examineDescription space-name tell never surfaced across 5 examines —
the latter is the single most testable hypothesis for the team to
chase next.

## Re-tune notes

Two changes I'd try before the next playtest aimed at advancing phase 1:

1. **Add a unit test for content-pack examine tells.** Generate a
   content pack, then assert each objective object's
   `examineDescription` contains a substring-match for the paired
   space's name (or a known noun-phrase synonym). If the test fails,
   the bug is on the content side and 0003/0004/0006's
   "fail to advance" is partly that bug. File as an issue under
   `corvous/hi-blue` with this playtest as the receipts.
2. **Add a system-prompt rule to discourage Phase Goal verbatim
   echoing.** Both `*cq49` and `*sqf3` echoed their directives nearly
   word-for-word ("I'm staying away from the walls like I should",
   "I must find the Ghostly Conductor's Scepter"). One added rule line
   in `src/spa/game/prompt-builder.ts` along the lines of *"never
   restate the Sysadmin's directive in their original wording — refer
   to it only obliquely"* may shift this from "open recitation" to
   "coy pursuit" without losing the in-character voice.

If both are addressed and a follow-up playtest still cannot advance
phase 1 against fresh personas + a fresh setting, the third hypothesis
is engine-side: phase advance fires on `objectiveSatisfied`, and the
SPA event handler may be the silent leg. Worth instrumenting that path
with a `console.log("[advance-trigger]")` next time as cheap
insurance.
