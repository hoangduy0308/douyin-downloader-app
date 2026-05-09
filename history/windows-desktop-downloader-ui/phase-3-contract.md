# Phase Contract: Phase 3 - Recovery, Controls, History, and Logs

**Date**: 2026-05-09
**Feature**: windows-desktop-downloader-ui
**Phase Plan Reference**: `history/windows-desktop-downloader-ui/phase-plan.md`
**Based on**:
- `history/windows-desktop-downloader-ui/CONTEXT.md`
- `history/windows-desktop-downloader-ui/discovery.md`
- `history/windows-desktop-downloader-ui/approach.md`
- `history/windows-desktop-downloader-ui/phase-2-contract.md`
- `history/windows-desktop-downloader-ui/phase-2-story-map.md`
- Phase 2 UAT evidence: `history/windows-desktop-downloader-ui/phase-2-uat.md`
- Institutional learnings: `history/learnings/20260508-desktop-queue-proof.md`

---

## 1. What This Phase Changes

After this phase, the app is no longer only a working single/batch downloader surface. It becomes usable across repeated Windows sessions and normal failure cases: the output folder and in-scope advanced options survive restart, cookie failures tell the user what to do next, the app can trigger a cookie refresh or guide manual import, recent download outcomes are visible after relaunch, and technical diagnostics live in a separate Logs surface.

This phase keeps the main downloader screen friendly. Power-user controls and raw technical details are available, but they do not turn the primary Single or Batch workflow into a dense developer dashboard.

---

## 2. Why This Phase Exists Now

- Phase 1 proved the desktop app can manage the backend and run one single job.
- Phase 2 proved Batch is a real app-owned queue with truthful pause/resume/retry semantics.
- D3-D13 require settings, recovery, history, and logs, but those behaviors only make sense once single and batch have stable job and row states to attach to.
- Cookie recovery is high-risk because the current `tools/cookie_fetcher.py` flow is terminal-oriented and Playwright-based; validation must prove the app-triggered boundary before execution treats it as green.

---

## 3. Entry State

- Tauri/React app exists with Single and Batch modes.
- The app can start or attach to the managed backend in dev-python mode and submit jobs over `/api/v1/download`.
- Batch queue rows, pause-new-starts semantics, retry failed rows, terminal summaries, and output-folder action are implemented and covered by deterministic tests.
- `src/services/settingsStore.ts` can write a runtime config for an output folder, but the main app still uses React state for `outputPath` and does not yet persist full settings across app launches.
- `src/services/errorMapper.ts` recognizes cookie/auth-looking failures but still says cookie recovery is planned for a later phase.
- `src/components/DiagnosticsPanel.tsx` exists as a minimal collapsible diagnostics surface, not the separate Logs tab/panel required by D13.
- The sibling downloader has `tools/cookie_fetcher.py`, but it currently opens a browser and waits for terminal Enter before writing cookies/config.
- Persistent app history for URL, time, status, and result/output location does not yet exist.

---

## 4. Exit State

- The app persists the default output folder and selected first-version advanced options across app launches.
- The advanced controls are collapsed by default and expose only first-scope core downloader options. Deferred modes such as live, comments, transcript, discovery, search, mobile/LAN, and installer behavior remain out of the UI.
- Changing settings safely updates the app-managed runtime config and either restarts the managed backend or blocks submit with clear wording until the backend is ready for the new config.
- Cookie-related failures in Single and Batch show user-facing recovery guidance with practical actions: fetch cookies again when the app-triggered boundary is available, manual/import cookie fallback when it is not, and retry after recovery.
- Cookie refresh writes sanitized cookies into the managed config/cookie file used by the app, and failure/cancel/missing-runtime cases remain friendly in the main UI with raw details in Logs.
- Basic history persists across restart: URL, timestamp, mode, status, last output folder/result location, and enough error summary for a user to understand what happened.
- A separate Logs tab or panel contains backend lifecycle messages, job/batch diagnostics, cookie-refresh diagnostics, and app events. The main Single/Batch panels do not stream raw terminal logs.
- Automated tests cover settings persistence, advanced-control config serialization, cookie error actions, history persistence/restart behavior, and logs separation.
- UAT evidence proves settings/history survive a relaunch path and cookie recovery/log behavior is either live-proven or explicitly blocked with validation evidence.

---

## 5. Demo Walkthrough

A user launches the app, changes the output folder and a collapsed advanced option, runs or simulates a job that fails because cookies are missing or expired, clicks the cookie recovery action or uses manual/import fallback, retries the affected single job or failed batch row, opens Logs to inspect technical detail, closes and relaunches the app, and sees the saved settings plus recent history still present.

### Demo Checklist

- [ ] Output folder survives app restart.
- [ ] Collapsed advanced controls expose only in-scope core options and update the managed config.
- [ ] Submit is blocked or backend is restarted while config changes are not yet ready.
- [ ] Cookie-looking failures show recovery actions in Single and Batch flows.
- [ ] Cookie fetch/import success updates the app-used cookie/config state and enables retry.
- [ ] Cookie fetch cancel/failure/missing Playwright is friendly in the main UI and detailed in Logs.
- [ ] Basic history records single and batch terminal outcomes and survives restart.
- [ ] Logs are separate from the main workflow and include backend/job/batch/cookie diagnostic entries.
- [ ] Tests and UAT disclose which proof is fake, dev-runtime, live-cookie, or blocked.

---

## 6. Story Sequence At A Glance

| Story | What Happens | Why Now | Unlocks Next | Done Looks Like |
|-------|--------------|---------|---------------|-----------------|
| Story 1: Persist settings and expose scoped controls | Output folder and first-version advanced options become durable app settings and managed config input. | Recovery/history need stable settings and config paths to write against. | Cookie recovery can update the same managed config/cookie state. | Relaunch keeps settings; advanced controls are collapsed and do not expose deferred modes. |
| Story 2: Recover from cookie failures | Cookie/auth errors become actionable with fetch-again/manual/import actions and retry paths. | D11 requires users to recover instead of reading raw errors. | History can record meaningful recovered/failed outcomes. | Tests prove cookie guidance and actions for Single and Batch; validation proves or blocks the app-triggered fetch boundary. |
| Story 3: Persist basic history | Terminal Single and Batch outcomes are recorded and visible after restart. | Once settings and recovery are stable, history can capture outcomes users care about. | Logs/UAT can prove repeat-session behavior. | Recent URL/status/output records survive relaunch without becoming an advanced history manager. |
| Story 4: Separate logs and close proof | Technical diagnostics move into a dedicated Logs surface and the phase is verified. | D13 requires power-user diagnostics without polluting the main download screen. | Phase 4 can package a functionally complete app. | Logs include backend/job/batch/cookie events; UAT documents settings, recovery, history, and log proof. |

---

## 7. Phase Diagram

```mermaid
flowchart LR
    A[Entry: Single and Batch flows work] --> S1[Story 1: Persist settings and scoped controls]
    S1 --> S2[Story 2: Cookie recovery]
    S2 --> S3[Story 3: Basic history]
    S3 --> S4[Story 4: Logs and proof]
    S4 --> X[Exit: App is repeat-session usable and recovery-ready]
```

---

## 8. Out Of Scope

- Portable unzip-and-run packaging, bundled backend sidecar, packaged Playwright/browser proof, and release-folder UAT are Phase 4.
- Live, comments, transcript, discovery, search, mobile/LAN, installer setup, Start Menu/Desktop shortcuts, and external backend mode remain deferred.
- Full history management with search, filters, deletion, analytics, or detailed result browser is out of scope.
- Active-download cancellation remains out of scope unless validation explicitly changes the backend contract.
- A backend-native batch API remains out of scope unless Phase 3 execution proves the current app-owned queue cannot integrate recovery/history honestly.

---

## 9. Success Signals

- A user can close and reopen the app without losing the output folder, selected core options, or recent basic history.
- Cookie failures no longer dead-end at generic raw backend errors.
- The main workflow stays clean: friendly status and action buttons in Single/Batch, raw details in Logs.
- The app never claims cookie recovery succeeded unless the managed config/cookie state actually changed.
- Tests separate deterministic fake proof from live runtime proof, following the Phase 1/2 learnings.

---

## 10. Failure / Pivot Signals

- Cookie refresh cannot be triggered from the app without terminal interaction.
- Playwright/browser runtime requirements cannot be represented honestly before Phase 4 packaging.
- Settings changes can silently submit jobs against stale backend config.
- History records drift from current row/job state, especially after retry.
- Logs become visible noise in the main Single/Batch workflow instead of a separate diagnostics surface.
- Implementing this phase requires broad downloader-core rewrites instead of app-side persistence/recovery seams plus narrow cookie-fetcher integration.

---

## 11. HIGH-Risk Items For Validating

- **Cookie fetch boundary**: validate whether the app can trigger `tools/cookie_fetcher.py` or a small wrapper without relying on terminal Enter, and how cancel/success/failure are detected.
- **Cookie/config write path**: validate where captured/imported cookies should be written so the managed backend uses them after restart or config refresh.
- **Settings/backend readiness**: validate that changed settings cannot be used by jobs until the backend has restarted or confirmed the current config.
- **History after retries**: validate that history records final current row/job outcomes, not transient failed attempts that later succeeded.
- **Logs separation**: validate that backend stdout/stderr, job diagnostics, batch row errors, and cookie-refresh diagnostics are captured without streaming raw logs into the main workflow.

## 12. Validation Results

All HIGH-risk items were spiked before execution and returned YES with constraints:

- Cookie capture is allowed through a short-lived Tauri-managed child process that controls `tools.cookie_fetcher.py` stdin; success requires a validated cookie/config state change with required Douyin cookie keys, not exit code or log text alone.
- Managed YAML is the runtime cookie/config authority. Cookie JSON files are optional support artifacts unless YAML explicitly uses auto-cookie loading.
- Settings and cookie writes must be generation-gated. Single submit, Batch start/resume/retry, and queue auto-submission must all block until the managed backend health check passes for the current config generation.
- History must use app-owned idempotent upserts keyed by logical item/run-row ids, so retry success replaces stale visible failure while attempt detail remains in Logs.
- Logs must be a separate bounded, redacted, structured surface. Main Single/Batch views keep friendly messages only.
