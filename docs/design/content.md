# Content design notes

`src/content/` holds the hand-authored pools and the generators that turn them
into personas and Content Packs at game start. These notes cover the rules
and reasons that the code alone doesn't show. Vocabulary follows `CONTEXT.md`.

## Content Pack generation (`content-pack-generator.ts`)

`generateDualContentPacks` builds the Pack A / Pack B pair for one continuous
game (#295). The steps run in this order:

1. Draw two distinct settings (one per pack), then weather and time of day for
   A and for B, then one theme for the game, then the obstacle count `m`.
2. Roll the objective types **before** the LLM call (type-first authoring,
   ADR 0014). The LLM gets pre-minted entity-ID skeletons and writes only
   flavor fields.
3. Make one batched LLM call covering both packs. It runs in parallel with
   resolving the Daemon ids.
4. Place Pack A on the grid, then copy its placements onto Pack B by entity
   id. The two packs share entity ids, placements and AI starts. Only names,
   descriptions and flavor differ (#302).

Every draw comes from the injected `rng`, in a fixed order. Seeded tests and
spike replays depend on that order, so a refactor must not reorder or add
draws.

`SingleGameConfig` holds only what the generator reads: `mRange`, the range the
obstacle count `m` is drawn from. `SINGLE_GAME_CONFIG` (`phases.ts`) sets it to
1–3. The number of Objectives is fixed at three and the two decoys are fixed, so
neither has a config range. The per-AI budget default lives in the engine
(`DEFAULT_BUDGET_PER_AI_USD`), not here.

### Placement rules (`tryPlacePhase`)

On the 5×5 grid, in draw order:

- **Obstacles** take `m` distinct cells.
- **AI starts** take distinct non-obstacle cells. A start is a position only:
  after ADR 0015 a Daemon has no orientation, so no facing is drawn.
- **Objective spaces** (carry-pair spaces first, then standalone bound spaces)
  are distinct, non-obstacle, and off every AI start.
- **Objective objects** are distinct, non-obstacle, and on no space cell. This
  guarantees that an object never starts on its matched space.
- **Interesting objects** are distinct from each other, from obstacles and from
  AI starts. They may share a cell with objective objects or spaces.
- **Reachability:** every non-obstacle cell must be reachable (4-neighbour BFS)
  from every AI start. A wall of obstacles can otherwise strand a Daemon or an
  objective.

A draw that breaks a rule is thrown away and redrawn. After
`MAX_PLACEMENT_ATTEMPTS` (200) the generator throws, which almost always means
`m` leaves too little open room for the starts and entities.

### Entity order (`rawBoundPackToContentPack`)

Entities go into one array in canonical order. For each binding index, a
carry pair emits its object then its space, `use_space` and `convergence` emit
a space, and `use_item` emits an item. Decoys come next, then obstacles.
Placement writes holders back in place, so this stays the pack order.

## Personas (`persona-generator.ts`)

- Names are 4 random characters from `[a-z0-9]`. After
  `RANDOM_NAME_ATTEMPTS_BEFORE_ENUMERATING` collisions the generator switches
  to enumerating names in order. A degenerate test RNG (a constant stub) would
  otherwise collide forever.
- Each persona gets two typing quirks, and one more on every roll of 6 on a d6.
- Without an LLM provider, blurbs and voice examples come from templates. The
  fallback voice examples are deliberately low quality: they exist to satisfy
  the type. The real value comes from LLM synthesis.
- With `engagementClauses`, an `[engagement] ...` line is logged per persona.
  It uses the same `console.log` channel as `[spike-239]` and `[cache]`, so the
  playtest analyzer can correlate each Daemon's transcript with its bias sum
  and bucket. It is a devtools-only signal.

## Engagement clauses (`engagement-clauses.ts`, spike #239 step 8)

**Why the module exists.** Steps 5–7 of the parallel-tools spike showed that
the shared rules block cannot produce per-Daemon engagement variance on
GLM-4.7. Every "let your personality drive engagement" framing, including C12
(which pointed at the existing `<personality>` / `<persona_goal>` blocks),
flattened to a 3–13 pp spread in the share of messages sent to blue,
whichever personas were drawn. The model reads any prompt-level "engagement
varies by personality" as one permission applied to all Daemons. So each
persona instead gets its own concrete engagement clause, baked into its blurb
at synthesis. Temperaments differ per persona, so the instruction differs per
prompt.

- Temperament biases sit on [-2, +2], with negative meaning quieter.
  Talkativeness markers (taciturn, verbose, glib, effusive, diffident, aloof,
  theatrical) get ±2. Withdrawal-leaning ones (melancholic, stoic) get -1.
  Engagement-leaning ones get +1. Ambiguous ones get 0.
- A pair sums to [-4, +4] and falls into five buckets: ≤-3 very quiet,
  -2..-1 reserved, 0 balanced, +1..+2 outgoing, ≥+3 chatty. Pure
  single-direction pairs reach the extremes, and mixed pairs land in the
  middle.
- Clauses describe concrete behaviour ("answers when blue addresses them by
  name"), not permissions. Step 6 showed that abstract "you may be quiet"
  wording reads as a uniform opt-out.
- Off by default. `?engagementClauses=1` turns it on through
  `BootstrapOpts.engagementClauses`. With it off, output is byte-identical.

## Action-tool bias (`action-preference-bias.ts`)

Daemons call `message` often but rarely use the action tools, even when the
same turn could carry both. This module is the counterpart to engagement
clauses: it shapes *which* actions a Daemon takes, not whether it speaks. It is
on by default through bootstrap; `?actionProfiles=0` switches it off for A/B
comparison.

- **Tool surface:** `go`, `pick_up`, `put_down`, `use`. ADR 0015 retired
  `face`, since a Daemon has a position but no orientation. Its perception
  bias was dropped rather than moved to another tool or to `message`:
  perception traits live in the temperament prose, and `message` is not an
  action tool here. `verbose` is a pure messaging trait and has an all-zero
  row.
- **Scale:** per-temperament biases on [-2, +2], summed per tool across the
  pair. Temperaments with direct action implications get ±1 or ±2.
  Ambiguous ones stay at 0.
- **Critical-path floor:** `go` and `use` are needed to complete objectives
  (movement for spatial and convergence objectives, `use` for interactive
  objects). Their summed bias is floored at -1 and they never appear in the
  avoided list. Before the floor, a doubled `melancholic` or a
  `melancholic` + `diffident` pair could bottom out `go` and produce the
  all-silent, no-progress draw seen in playtest 0x8CBA. Evals also showed the
  model reads an avoided clause as a near-hard constraint. `pick_up` and
  `put_down` are flavor only and can still be avoided.
- **Asymmetric thresholds:** a tool is preferred at a sum of +2 or more and
  avoided at -1 or less. Most pairs have several mild positives, and calling
  them all out ("leans toward 5 tools") says nothing. Avoidances are rarer
  and carry more information.
- **Soft wording (v2.5):** preferred tools are pitched at about 70/30, and
  avoided tools still fire "when the moment clearly calls for it". The v2
  wording ("STRICTLY") gave 95–100% of emissions to the leaned-on tool and
  killed variety within a persona.
- A persona with nothing preferred and nothing avoided gets a balanced
  clause, so `<action_profile>` is never empty. The balanced and avoided
  clauses never appear together.

## Pools

- `SETTING_POOL`: noun phrases; one per pack at game start.
- `WEATHER_POOL`: complete sentences, rendered verbatim into `<setting>`.
- `TIME_OF_DAY_POOL`: noun phrases, rendered as "It is {timeOfDay}.".
- `THEME_POOL`: drawn once per game, with replacement. It flavors objective
  pairs and interesting objects. Obstacles stay setting-only. "mundane"
  appears more than once to bias toward ordinary items over technological or
  magical ones.
- `SYSADMIN_DIRECTIVE_POOL`: mid-phase complication directives. Each is a
  small, privately observable behaviour change that a player may notice
  socially but cannot easily prove was imposed from outside.

## Root-level modules

- **`save-serializer.ts`** writes the "Save the AIs to USB" payload (#19): each
  AI's persona and per-Daemon `conversationLog`, plus the A and B Content
  Packs. The log sits inside a single-element `phases` array. The three-phase
  model is retired, but the save shape keeps the wrapper.
  `GAME_SAVE_VERSION` history: v3 moved whispers inline, v4 collapsed
  chat/whisper into the directional message, and v5 (#539) dropped facing and
  horizon landmarks. This axis has no in-place migration. Bumping it needs a
  `GAME_SAVE_ARCHIVE_MAP` entry; see `AGENTS.md` "Bumping save-format
  versions".
- **`vite-env.d.ts`** hand-stubs `import.meta.env`. `tsconfig.json` sets
  `"types": []`, which blocks automatic `@types` resolution, so Vite's
  client types are not loaded.
