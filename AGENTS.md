- When spawning new Agent: always set fork_context = false.

- When implementing new code or features (especially core domain/business logic):
  • Prefer strict TDD: follow Red → Green → Refactor with baby steps.
  • Write the smallest failing test first (one behavior).
  • Make it pass with minimal code, then refactor.
  • Test public behavior only (black-box), avoid testing implementation details.
  • Use clear test names and AAA pattern.

- Do NOT force TDD on:
  • Quick fixes, prototypes, config changes, migrations, or third-party integrations.

- For non-coding tasks or simple changes: work normally and be pragmatic.
- For code-intelligence work, actively use the `srcwalk` skill and `srcwalk` CLI when available.

- Use `srcwalk` before broad manual reading with `cat`, `rg`, or file-by-file inspection when the task involves:
  • understanding an unfamiliar codebase,
  • mapping project structure,
  • finding where a symbol/function/class is defined,
  • finding callers or callees,
  • checking imports/dependencies or blast radius,
  • reading large files structurally,
  • tracing call chains or implementation flow.

- Recommended `srcwalk` patterns:
  • Start unfamiliar repo exploration with: `srcwalk --map --scope .`
  • Read a large or unknown file with: `srcwalk <path>`
  • Find definitions/usages with: `srcwalk <symbol> --scope .`
  • Drill into a symbol or line range with: `srcwalk <path> --section <symbol-or-range>`
  • Find callers with: `srcwalk <symbol> --callers --scope .`
  • Check file dependencies with: `srcwalk <path> --deps`

- Prefer `srcwalk` for AST/code-structure questions. Use `rg` for plain text search, exact string/regex search, path listing, or small known files.

- When `srcwalk` prints a `> Tip:` footer, treat that as the preferred next navigation step unless there is a clear reason not to.

<!-- KHUYM:START -->
# Khuym Workflow

Use `khuym:using-khuym` first in this repo unless you are resuming an already approved Khuym handoff.

## Startup

1. Read this file at session start and again after any context compaction.
2. If `.khuym/onboarding.json` is missing or outdated, stop and run `khuym:using-khuym` before continuing.
3. If `.codex/khuym_status.mjs` exists, run `node .codex/khuym_status.mjs --json` as the first quick scout step.
4. If `.khuym/HANDOFF.json` exists, do not auto-resume. Surface the saved state and wait for user confirmation.
5. If `history/learnings/critical-patterns.md` exists, read it before planning or execution work.

## Chain

```
khuym:using-khuym
  → khuym:exploring
  → khuym:planning
  → khuym:validating
  → khuym:swarming
  → khuym:executing
  → khuym:reviewing
  → khuym:compounding
```

## Critical Rules

1. Never execute without validating.
2. `CONTEXT.md` is the source of truth for locked decisions.
3. If context usage passes roughly 65%, write `.khuym/HANDOFF.json` and pause cleanly.
4. Treat `.khuym/state.json` as the single runtime state file for routing, current focus, and operator notes.
5. After compaction, re-read `AGENTS.md`, run `node .codex/khuym_status.mjs --json` if present, then re-open `.khuym/HANDOFF.json`, `.khuym/state.json`, and the active feature context before more work.
6. P1 review findings block merge.

## Working Files

```
.khuym/
  onboarding.json     ← onboarding state for the Khuym plugin
  state.json          ← single runtime state file for agents, tools, and humans
  HANDOFF.json        ← pause/resume artifact
  reservations.json   ← local file reservations for same-session Codex swarms

history/<feature>/
  CONTEXT.md          ← locked decisions
  discovery.md        ← research findings
  approach.md         ← approach + risk map

history/learnings/
  critical-patterns.md

.beads/               ← bead/task files when beads are in use
.spikes/              ← spike outputs when validation requires them
```

.codex/
  khuym_status.mjs    ← read-only scout command for onboarding, state, and handoff
  khuym_state.mjs     ← shared state helpers used by the scout command
  khuym_reservations.mjs ← local reservation helper used by swarming, executing, and hooks

## Codex Guardrails

- Repo-local `.codex/` files installed by Khuym are workflow guardrails, not optional decoration.
- Use `node .codex/khuym_status.mjs --json` as the preferred quick scout step when it is available.
- Treat `compact_prompt` recovery instructions as mandatory.
- Use `bv` only with `--robot-*` flags. Bare `bv` launches the TUI and should be avoided in agent sessions.
- If the repo is only partially onboarded, stay in bootstrap/planning mode and surface what is missing before implementation.

## Session Finish

Before ending a substantial Khuym work chunk:

1. Update or close the active bead/task if one exists.
2. Leave `.khuym/state.json` and `.khuym/HANDOFF.json` consistent with the current pause/resume state.
3. Mention any remaining blockers, open questions, or next actions in the final response.
<!-- KHUYM:END -->
