## Problem Statement

The deterministic core of this codebase (game engine, tool dispatcher, AI context builder, LLM proxy) will accrete logic across two runtimes — the browser for the engine/dispatcher/context-builder, Cloudflare Workers for the proxy. Without an automated check pipeline, lint regressions, type errors, and broken tests can land on `main` silently, especially in a project where the LLM-eval suite is explicitly deferred and the deterministic core *is* the only safety net for v1.

This PRD scopes the first slice of CI/CD: **lint, type-check, and test.** Real-LLM evaluation, secrets management, and deploy automation are out of scope and queued as follow-up PRDs.

## Solution

A small CI pipeline runs three checks — `biome ci`, `tsgo --noEmit`, `vitest run` — on every pull request and every push to `main`. All three are required status checks; failing any blocks merge. A local pre-push hook (Husky) runs the same three checks before a push leaves the developer's machine, so CI is rarely the first place a regression is caught. The mock LLM provider that the parent PRD already specifies is enforced both architecturally (constructor injection, no module-level real-provider import in any tested module) and as belt-and-braces by setting an invalid `ANTHROPIC_API_KEY` in CI so any accidental real call fails loudly.

## User Stories

### Maintainer

1. As a maintainer, I want every PR to run lint, type-check, and test, so that I see all three results before merging.
2. As a maintainer, I want all three checks to be required status checks on `main`, so that broken code cannot reach the trunk.
3. As a maintainer, I want CI to also run on push to `main`, so that merge-time drift (e.g. a hand-resolved conflict) is caught immediately.
4. As a maintainer, I want `main` protected against force-push and non-linear history, so that the trunk's commit graph stays auditable.
5. As a maintainer, I want `fail-fast: false` on the CI job, so that one failing step doesn't hide the status of the other two.
6. As a maintainer, I want the test runner to refuse real LLM calls in CI, so that no test ever silently spends real provider budget.
7. As a maintainer, I want the same three checks to run locally on `git push`, so that CI is rarely the first feedback loop.
8. As a maintainer, I want a single CI provider, single OS, and a single runtime version, so that the pipeline stays simple and the build matrix doesn't grow without justification.

### Contributor (future)

9. As a contributor, I want lint and formatting handled by one tool, so that I don't fight a separate formatter in review.
10. As a contributor, I want strict TypeScript from day one, so that I don't have to retrofit null-safety later.
11. As a contributor, I want CI to be cheap and fast, so that the feedback loop on a PR is minutes, not tens of minutes.

## Implementation Decisions

### Language and tooling

- **Language: TypeScript.** All source. No JS files outside generated artefacts.
- **Linter and formatter: Biome.** Single binary, single config, lint + format in one. No ESLint, no Prettier, no plugin tree.
- **Type checker: `tsgo --noEmit`** with `strict: true` in `tsconfig.json`. The Go-based TypeScript compiler is drop-in compatible with `tsc` and meaningfully faster on cold runs; the migration path back to `tsc` is a one-line change if `tsgo` ever proves too immature.
- **Test runner: Vitest, single config, two projects.**
  - One project runs in a Node/JSDOM environment for browser-side modules (engine, dispatcher, context builder, LLM client, renderer, phase-content schema, endgame).
  - One project runs under `@cloudflare/vitest-pool-workers` for the LLM proxy, so proxy tests execute inside the actual workerd runtime via Miniflare.
  - One CI command (`vitest run`) covers both.

### Testing scope

- **Every module is tested.** This PRD revises the parent PRD's "Modules not tested in v1" list. The LLM Client, UI/Renderer, Phase Content, and Endgame are all in scope for unit/integration tests. The original PRD's reasons for skipping each are acknowledged as real costs (renderer snapshot brittleness, etc.) but accepted as the price of consistent test coverage.
- **No coverage measurement, no coverage gate.** CI reports test pass/fail only. Coverage as a metric is deliberately not collected; the testable surface is defined by what's written, not by a percentage.
- **Renderer testing approach: TBD.** Logged as a follow-up. The parent PRD's concern that "SSR snapshot tests are brittle" is real and needs an authored answer before renderer code lands (DOM-level assertions, render-and-assert-on-shape, or integration-style coverage). This PRD does not pre-commit to a pattern.

### Mock LLM enforcement

- **Architectural injection.** The LLM provider is passed in by the caller. No tested module imports a real provider at the module level. Tests inject a `MockLLMProvider` that implements the same interface; production wires the real provider at the composition root.
- **CI sabotages the env.** The CI job exports `ANTHROPIC_API_KEY=ci-invalid-key` (or equivalent for whatever provider lands). Any accidental real call fails with a 401, loudly.
- **No network sandbox.** Egress blocking at the runner level is not justified for v1; revisit if a real call ever slips past the architectural and env-var defences.

### CI shape

- **Provider: GitHub Actions.**
- **OS: `ubuntu-latest`.** Single OS. No matrix.
- **Runtime: Node LTS pinned via `.nvmrc`.** Same version locally and in CI.
- **Package manager: pnpm.** Fast, lockfile-stable, plays well with Wrangler/Vitest/Biome/Husky/`tsgo`. The choice is independent of the deferred Bun-vs-Node runtime question.
- **Caching: `actions/setup-node` with `cache: 'pnpm'`.** No additional Vitest/Biome work-cache plumbing in v1.
- **Job: one job, three sequential steps** — `biome ci`, `tsgo --noEmit`, `vitest run`. `fail-fast: false` so all three statuses are visible on a failing PR.
- **Triggers: pull requests to `main`, push to `main`.** No scheduled runs, no manual dispatch in v1.
- **Branch protection on `main`:** lint/typecheck/test all required, no force-push, linear history (squash or rebase merges).

### Local enforcement

> **Revision: hook runner switched from Lefthook to Husky; web-container bootstrap added.**
>
> The PRD originally picked Lefthook with stated reasoning: single Go binary, no `node_modules` bootstrap, no `prepare` script. That reasoning still holds in the abstract, but it lost on the concrete trade-off:
>
> - This is a solo greenfield repo for the foreseeable future. Onboarding friction *for the author, today* is what matters.
> - Lefthook requires a separate system-binary install (brew/scoop/winget/release download) plus an explicit `lefthook install` per clone. Husky requires only `pnpm install` once, because the `prepare` script auto-wires hooks into `.git/hooks/`.
> - The lefthook-vs-husky win (decoupled hook lifecycle from `node_modules`, faster execution, single YAML config) is real but small. Switching from Husky to Lefthook later — if/when contributors arrive and the properties matter more — is a one-PR job.
>
> **Net effect on the file inventory:** drop `lefthook.yml`; add `.husky/pre-push`, a `prepare` script in `package.json`, and a `SessionStart` hook in `.claude/settings.json`. The three required CI checks and their commands are unchanged.

- **Hook runner: Husky 9.** `prepare: "husky"` in `package.json`, hook file at `.husky/pre-push`. One `pnpm install` after clone wires the hooks; no separate system-binary install.
- **Pre-push hook: all three checks.** Lint, type-check, full test suite run on `git push`, prefixed with `ANTHROPIC_API_KEY=ci-invalid-key` so a misconfigured local shell doesn't burn provider budget on accidental real calls. The local tax (10–60s per push) is accepted in exchange for "if I push, it's green." Solo-developer-friendly; scales unchanged when contributors arrive.
- **No pre-commit hook.** Pre-push covers everything; layering pre-commit on top creates redundancy without improving outcomes.
- **Web-container bootstrap: `SessionStart` hook in `.claude/settings.json`.** Husky's `prepare`-script auto-wiring depends on `pnpm install` running. In a Claude Code web container, that doesn't happen by default — the container clones the repo but doesn't run arbitrary setup. A `SessionStart` hook on the `startup` matcher runs `corepack enable && pnpm install --frozen-lockfile` so hooks live automatically in web sessions. This is the missing piece between "Husky auto-wires" and "auto-wires *everywhere I'd actually develop*."

## Testing Decisions

This PRD is itself testable: the pipeline either runs all three checks correctly on the right triggers, or it doesn't. The validation is the pipeline running on this very PRD's implementing PR. No unit tests of the pipeline itself.

## Out of Scope

- **Real-LLM eval suite.** Personality consistency, goal pursuit, prompt-injection resistance, and similar non-deterministic checks. Deferred to a separate PRD; the parent PRD already flagged this.
- **Secrets management.** Wrangler API token, production provider keys, environment scoping, KV/secret rotation. Separate PRD.
- **Deploy automation.** Wrangler deploy on push to `main`, preview environments per PR, branch-deploy strategy. Separate PRD.
- **Renderer testing approach.** Acknowledged TBD; not specified here.
- **Coverage thresholds or coverage reporting.** Deliberately excluded.
- **Multi-runtime / multi-OS / multi-Node-version matrix.** Not justified by current scope.
- **Scheduled CI runs (nightly, etc.).** Not needed without an LLM eval suite to run on a schedule.
- **Tech stack picks** (Bun vs Node, Cloudflare Workers vs alternatives, Hono vs alternatives). Still owned by a separate PRD or ADRs; this PRD only assumes TypeScript and tolerates either runtime.

## Further Notes

- **No ADRs proposed.** Every decision in this PRD is easy to reverse (swap Biome for ESLint, swap pnpm for npm, swap Vitest for Bun test, swap Husky for Lefthook). ADRs are best reserved for hard-to-reverse architectural commitments; tool choices captured in a PRD don't clear that bar.
- **The PRD revision in "Testing scope" is the most consequential decision here.** It expands the testing budget the parent PRD ([0001-game-concept.md](./0001-game-concept.md)) originally drew. The retraction is filed inline in the parent PRD's "Modules not tested in v1" section.
- **The mock LLM enforcement layering — architectural plus env-var — is deliberate redundancy.** Either alone is defensible; the cost of the env-var line is one variable in a YAML file, so the marginal cost of belt-and-braces is effectively zero.
- **Pre-push of all three checks is a stronger position than the median solo project takes.** The bet is that "green push" culture is cheaper to establish on a greenfield repo than to retrofit. If the local tax becomes painful, the fallback is a two-tier hook (pre-commit lint, pre-push full) — not removing the hook entirely.
