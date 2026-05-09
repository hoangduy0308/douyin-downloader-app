# Spike: Phase 3 logs separation and retention

**Bead:** douyin-downloader-app-kse
**Question:** Can Phase 3 capture backend/job/batch/cookie diagnostics in a separate Logs surface with bounded retention without streaming raw logs into Single/Batch?

## Decision

YES: Phase 3 can add a separate Logs surface with bounded retention, using the current diagnostics seams, if execution adds an explicit capped log store and keeps raw diagnostic details out of the Single and Batch panels.

This is viable because the app already separates friendly user-facing messages from raw diagnostics:

- Backend lifecycle diagnostics are exposed through `BackendLifecycle.getDiagnostics()` and the Tauri `backend_diagnostics` command.
- Job polling and failed-job errors already pass through `errorMapper`, which returns friendly messages plus raw diagnostic detail.
- Batch rows already retain raw failure detail in `row.lastError`, while the visible queue reason is mapped to friendly text.
- Current app-shell tests assert raw details are not rendered in the main workflow and remain available separately.

## Constraints For Execution

1. Add a dedicated app-owned Logs store/panel or tab; do not expand the current Single or Batch panels with raw log text.
2. Retention must be explicit. Current collections are append-only:
   - `src-tauri/src/backend.rs` stores backend diagnostics in a `Vec<BackendDiagnostic>` and appends stdout/stderr lines without a cap.
   - `src/services/backendLifecycle.ts` appends lifecycle/runtime diagnostics into an array.
   - `src/app/App.tsx` appends job diagnostics into React state.
   Phase 3 should enforce a fixed event cap at the app log store, and preferably also cap the Rust backend diagnostics buffer so noisy stdout/stderr cannot grow unbounded before the frontend pulls it.
3. Log entries should be structured enough for routing and filtering: `at`, `level`, `source`, `message`, and optional `context` such as job id, batch row id, cookie action id, or config version.
4. Backend stdout/stderr may be raw and sensitive. The Logs surface may show technical detail, but cookie values, authorization headers, config secrets, and full cookie blobs must be redacted before persistence or display.
5. Job diagnostics can be routed from `mapPollingRequestError` and `mapFailedJobError`; the main job panel should keep showing only the mapped friendly message.
6. Batch diagnostics can be routed from submit/poll failures and terminal row errors. The queue table should keep showing friendly reasons, not tracebacks or raw backend strings.
7. Cookie diagnostics depend on the Phase 3 cookie recovery boundary. If app-triggered cookie capture is unavailable or blocked, Logs should capture the blocked/fallback/failure event honestly rather than claiming fetch success.
8. Tests should prove both surfaces: raw diagnostics appear in Logs, and Single/Batch do not contain raw backend/job/batch/cookie detail.

## Evidence

- `src/components/DiagnosticsPanel.tsx` is already a separate collapsible diagnostics surface, but it only merges backend/job strings and is not yet a full Logs surface.
- `src/app/App.tsx` keeps `backendDiagnostics` and `jobDiagnostics` separate from the Single/Batch props, and batch raw details are only exposed through hidden test cache today.
- `src/components/SingleDownloadPanel.tsx`, `src/components/BatchDownloadPanel.tsx`, `src/components/JobStatusPanel.tsx`, and `src/components/QueueTable.tsx` render workflow status and friendly mapped messages, not backend stdout/stderr.
- `src/services/backendLifecycle.ts` and `src-tauri/src/backend.rs` provide the existing backend diagnostics pipeline, including stdout/stderr capture.
- `src/services/errorMapper.ts` provides the job error split between `message` and `diagnostics`.
- `src/tests/app-shell.test.tsx` has separation tests for missing jobs, batch failures, cookie-looking errors, and folder-open failures.
- `src/tests/backend-lifecycle.test.ts` covers lifecycle diagnostics for health, start failure, timeout, and attach cleanup.
- `src/tests/error-mapper.test.ts` covers friendly messages while preserving raw diagnostics.

## Verification

Ran:

```powershell
npm test -- --run src/tests/app-shell.test.tsx src/tests/backend-lifecycle.test.ts src/tests/error-mapper.test.ts
```

Result: PASS, 3 test files, 30 tests.

## Files Read

- `AGENTS.md`
- `history/learnings/critical-patterns.md`
- `history/windows-desktop-downloader-ui/CONTEXT.md`
- `history/windows-desktop-downloader-ui/phase-3-contract.md`
- `history/windows-desktop-downloader-ui/phase-3-story-map.md`
- `src/app/App.tsx`
- `src/components/DiagnosticsPanel.tsx`
- `src/components/SingleDownloadPanel.tsx`
- `src/components/BatchDownloadPanel.tsx`
- `src/components/BatchStatusPanel.tsx`
- `src/components/QueueTable.tsx`
- `src/components/JobStatusPanel.tsx`
- `src/services/backendClient.ts`
- `src/services/backendLifecycle.ts`
- `src/services/tauriBackendRuntime.ts`
- `src/services/batchQueueRunner.ts`
- `src/services/errorMapper.ts`
- `src-tauri/src/backend.rs`
- `src/tests/app-shell.test.tsx`
- `src/tests/backend-lifecycle.test.ts`
- `src/tests/backend-client.test.ts`
- `src/tests/batch-queue-runner.test.ts`
- `src/tests/error-mapper.test.ts`
- `.beads/issues.jsonl`
- `package.json`

