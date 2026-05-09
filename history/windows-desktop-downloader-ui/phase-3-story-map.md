# Story Map: Phase 3 - Recovery, Controls, History, and Logs

**Date**: 2026-05-09
**Phase Plan**: `history/windows-desktop-downloader-ui/phase-plan.md`
**Phase Contract**: `history/windows-desktop-downloader-ui/phase-3-contract.md`
**Approach Reference**: `history/windows-desktop-downloader-ui/approach.md`

---

## 1. Story Dependency Diagram

```mermaid
flowchart LR
    E[Entry: Single and Batch work] --> S1[Story 1: Persist settings and scoped controls]
    S1 --> S2[Story 2: Cookie recovery]
    S2 --> S3[Story 3: Basic history]
    S3 --> S4[Story 4: Logs and proof]
    S4 --> X[Exit: Repeat-session recovery-ready app]
```

---

## 2. Story Table

| Story | What Happens In This Story | Why Now | Contributes To | Creates | Unlocks | Done Looks Like |
|-------|-----------------------------|---------|----------------|---------|---------|-----------------|
| Story 1: Persist settings and scoped controls | The default output folder and selected first-version advanced options become durable app settings and managed backend config input. | Cookie recovery and history need stable config paths and options before they can behave consistently. | Exit states for persistent settings, collapsed advanced controls, and safe config handoff. | Settings store integration, advanced option model, collapsed controls UI, config serialization tests. | Story 2 can write/update cookies against the same managed config state. | Relaunch restores settings; deferred modes are absent; submit is blocked or backend-ready after config changes. |
| Story 2: Cookie recovery | Cookie/auth failures offer fetch-again/manual/import actions and retry paths in Single and Batch. | D11 requires actionable recovery once job surfaces are real. | Exit states for cookie guidance, app-triggered or fallback cookie recovery, retry after recovery, and diagnostics capture. | Cookie recovery service/command boundary, UI actions, error-map updates, tests for success/failure/cancel. | Story 3 can record meaningful recovered or failed outcomes. | Cookie failures do not dead-end; raw cookie-fetch details stay in Logs; validation decides any live boundary constraints. |
| Story 3: Basic history | Terminal Single and Batch outcomes are written to durable app-owned history and shown after relaunch. | Settings and recovery define the final state that history should record. | Exit states for URL/time/status/output/result persistence across sessions. | History store, history panel/list, single/batch terminal recording, restart tests. | Story 4 can verify repeat-session behavior and logs around those events. | Recent outcomes survive restart and stay basic, not a full history manager. |
| Story 4: Logs and proof | Backend/job/batch/cookie diagnostics move into a separate Logs surface and Phase 3 gets evidence. | The app needs power-user diagnostics while keeping main workflows clean. | Exit states for D13 logs separation and validation-ready proof. | Logs store/panel, diagnostic event routing, Phase 3 UAT artifact, evidence logs. | Phase 4 can focus on portable packaging instead of unfinished app behavior. | Logs are separate and useful; tests/build/UAT document settings, cookie recovery, history, and logs. |

---

## 3. Story Details

### Story 1: Persist Settings and Scoped Controls

- **What Happens In This Story**: The app stops treating output folder and core options as temporary React state only. It persists them, serializes the managed config, and renders a collapsed advanced panel for first-scope options only.
- **Why Now**: Cookie recovery needs a known managed config/cookie destination, and history needs the same output path that the job actually used.
- **Contributes To**: The phase exit state that repeat app launches preserve default output folder and power-user options without expanding into deferred modes.
- **Creates**: App settings model, persistence adapter, advanced controls panel, runtime config serializer coverage, UI tests for collapsed/default behavior.
- **Unlocks**: Cookie recovery can update and restart against the same app-owned config boundary.
- **Done Looks Like**: Start/restart tests prove settings survive relaunch; changing options either restarts the managed backend or disables submit until the backend is ready for the new config.
- **Candidate Bead Themes**:
  - Durable settings store and config serialization.
  - Collapsed advanced controls UI and backend readiness guard.

### Story 2: Cookie Recovery

- **What Happens In This Story**: Cookie-looking errors from single jobs and batch rows show recovery actions. The app offers a fetch-again flow if validation proves the boundary, plus a manual/import fallback that updates app-used cookie/config state. Retry actions remain tied to the affected job or failed rows.
- **Why Now**: Phase 1/2 already map failures; this story replaces "planned later" with practical recovery while preserving raw detail outside the main UI.
- **Contributes To**: The phase exit state that cookie expiration or missing-cookie failures are actionable.
- **Creates**: Cookie recovery service/command boundary, manual/import cookie path if needed, error mapper updates, Single/Batch recovery actions, tests for cancel/success/failure.
- **Unlocks**: History can record final recovered or unrecovered outcomes in user-facing terms.
- **Done Looks Like**: Cookie failures show fetch/manual/import and retry guidance; a successful recovery changes the managed cookie/config state; failure and cancel remain friendly with details in Logs.
- **Candidate Bead Themes**:
  - Cookie recovery command/service boundary.
  - Cookie recovery UI and retry integration.

### Story 3: Basic History

- **What Happens In This Story**: The app records basic history entries when single jobs and batch rows/queues reach terminal state. It stores URL, timestamp, mode, status, output path or result location, and a short error summary.
- **Why Now**: The final visible outcome should be recorded after settings and cookie recovery can influence whether a job succeeds, fails, or gets retried.
- **Contributes To**: The phase exit state that recent downloads remain visible after app relaunch.
- **Creates**: History store, schema/migration guard for a simple JSON or app-data file, history UI, terminal-state integration, restart tests.
- **Unlocks**: Logs and UAT can prove repeat-session use rather than a one-run demo.
- **Done Looks Like**: Recent single and batch outcomes survive relaunch, and retries record the final current outcome rather than stale intermediate failure totals.
- **Candidate Bead Themes**:
  - Durable history store.
  - History UI and terminal-state integration.

### Story 4: Logs and Proof

- **What Happens In This Story**: The minimal diagnostics panel becomes a dedicated Logs tab/panel that collects backend lifecycle, job polling, batch row, settings, history, and cookie recovery events. Phase 3 closes with tests, build proof, and UAT evidence.
- **Why Now**: D13 requires technical diagnostics, and the phase should prove logs stay separate from the main workflow before packaging starts.
- **Contributes To**: The phase exit state that power users can inspect technical detail while the main workflow stays friendly.
- **Creates**: Logs store, Logs panel/tab, event routing, Phase 3 UAT document, evidence logs.
- **Unlocks**: Phase 4 portable packaging can validate the complete first-version behavior in an unpacked folder.
- **Done Looks Like**: Logs include backend/job/batch/cookie details; main panels show friendly text only; UAT evidence discloses fake/dev/live proof surfaces.
- **Candidate Bead Themes**:
  - Logs surface and diagnostic event routing.
  - Phase 3 verification and UAT proof.

---

## 4. Story Order Check

- [x] Story 1 is obviously first because settings/config paths are the anchor for cookie recovery and history.
- [x] Story 2 follows because cookie recovery needs those settings and creates final user-visible outcomes.
- [x] Story 3 follows because history should record final current outcomes after recovery/retry behavior exists.
- [x] Story 4 closes the phase by separating raw diagnostics and proving the repeat-session workflow.

---

## 5. Multi-Perspective Check

Phase 3 contains HIGH-risk cookie recovery and repeat-session persistence, so planning reviewed the phase before bead creation.

| Check | Result |
|-------|--------|
| Does this phase fit the full feature plan? | Yes. Phase 3 makes the already-working Single and Batch flows usable in repeated sessions and failure cases before Phase 4 packaging. |
| Does the contract close a small believable loop? | Yes. A user can change settings, recover from cookies, see history after relaunch, and inspect logs separately. |
| Do stories make sense in order? | Yes. Settings/config first, cookie recovery second, history third, logs/proof last. |
| Which story is too large or vague? | Story 2 is the riskiest because `tools/cookie_fetcher.py` is terminal-oriented. Validation must prove the app-triggered boundary before execution treats fetch-again as available. |
| What would make an executor regret this design? | Letting cookie recovery sprawl into Phase 4 packaging proof, or recording history from transient retry attempts instead of final row/job state. |

---

## 6. Story-To-Bead Mapping

| Story | Beads | Notes |
|-------|-------|-------|
| Story 1: Persist settings and scoped controls | `douyin-downloader-app-irx.20`, `douyin-downloader-app-irx.21` | Settings store/config serialization precedes UI controls so options are not just form state. |
| Story 2: Cookie recovery | `douyin-downloader-app-irx.22`, `douyin-downloader-app-irx.23` | Service/command boundary precedes UI wiring; validation may add constraints before execution. |
| Story 3: Basic history | `douyin-downloader-app-irx.24`, `douyin-downloader-app-irx.25` | Store/schema precedes UI and terminal-state integration. |
| Story 4: Logs and proof | `douyin-downloader-app-irx.26`, `douyin-downloader-app-irx.27` | Logs routing precedes UAT proof; proof depends on all implementation beads. |

---

## 7. Validation Spike Constraints

Validation should answer these before execution starts:

- Can the app trigger cookie capture without terminal Enter, and what exact success/cancel/failure signals should execution rely on?
- Should captured/imported cookies be written into managed config YAML, a `.cookies.json` beside the managed config, or both?
- What app-data path is acceptable for settings/history/logs in dev now, and what must be deferred to Phase 4 portable packaging?
- How should settings changes coordinate with backend restart/readiness so jobs cannot use stale config?
- What log retention cap is enough for Phase 3 without building a full log manager?

### Validation Spike Results

All Phase 3 validation spikes returned YES with constraints. Execution must treat these constraints as part of the current-phase contract:

- **Cookie capture boundary**: the app can trigger `tools.cookie_fetcher.py` without terminal Enter by spawning it from a Tauri command with piped stdin and sending a newline when the user confirms login in the app. Success is not stdout or exit code alone; it requires exit code `0`, a validated cookie/config state change, and required keys `msToken`, `ttwid`, `odin_tt`, and `passport_csrf_token`.
- **Cookie/config write path**: managed YAML is the runtime authority. Captured/imported cookies must be committed into the app-managed config YAML, or YAML must explicitly opt into auto-cookie loading if a cookie JSON file is used. A bare adjacent cookie file is not enough.
- **Settings/backend readiness**: every settings or cookie config write increments a config generation, marks backend readiness stale, restarts the managed backend, and only unblocks Single, Batch start/resume, and retry paths after health succeeds for the same generation.
- **History after retries**: basic history must be app-owned and idempotent. Use stable logical ids for Single and `batchRunId + rowId` for Batch; retry updates the same visible history entry to the final current outcome, while per-attempt detail goes to Logs.
- **Logs separation**: Logs can use existing diagnostics seams, but Phase 3 must add explicit retention caps, redact cookies/secrets, route structured events, and keep raw backend/job/batch/cookie details out of Single and Batch panels.
