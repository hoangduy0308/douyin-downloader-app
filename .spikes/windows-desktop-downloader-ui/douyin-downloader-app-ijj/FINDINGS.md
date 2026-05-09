# Spike Findings: Phase 3 History Retry Outcomes

**Bead**: `douyin-downloader-app-ijj`  
**Question**: Can Phase 3 history record final current single/batch retry outcomes instead of stale transient failures, and what store/integration contract should workers follow?  
**Answer**: YES, with constraints.

## Definitive Answer

YES. Phase 3 can record final current outcomes for Single and Batch retries without preserving stale transient failures as the visible history result.

The current app state is compatible with this because:

- Single polling emits every backend `JobState` and stops only after a terminal status, so history can write only from terminal `success`/`failed` job states.
- Batch retry already mutates the same row back to `waiting`, clears `lastError`, increments `attempt` on resubmit, overwrites `lastJobId`, and produces a final row snapshot after retry success/failure.
- The batch runner already protects against stale async submit/poll completions with `runGeneration`, so stale completions from an old queue cannot mutate the current rows.
- Existing tests prove the important retry path: a failed batch row can be retried and the final queue summary changes from `1 succeeded, 1 failed, 1 skipped` to `2 succeeded, 0 failed, 1 skipped`.

The history feature must not treat the backend job list as durable history. The sibling backend `JobManager` is explicitly in-memory, TTL/capacity pruned, and lost on restart. It is an integration source for current job state only.

## Required Store Contract

Implement an app-owned durable `HistoryStore`; do not use `/api/v1/jobs` as the history store.

The store should expose idempotent upsert-style writes, not append-only terminal writes:

- `upsertDownloadOutcome(entry)` records the current outcome for a stable logical item.
- `listRecentHistory()` returns recent persisted entries for the UI.
- Writes must be atomic through the same app-data persistence boundary used for Phase 3 settings/logs.
- Corrupt or unknown schema should fail friendly and keep raw details in Logs.

Minimum entry fields:

- `id`: stable app-generated history item id.
- `mode`: `single` or `batch`.
- `url`: submitted/normalized URL where available.
- `sourceText`: original batch text when URL is invalid/skipped.
- `status`: final current user-visible status: `success`, `failed`, or `skipped`.
- `attempt`: current attempt count.
- `jobId`: latest backend job id (`activeJobId` for Single, `lastJobId` for Batch).
- `submittedAt`, `finishedAt`, or `recordedAt`: use backend times when available; otherwise app write time.
- `outputPath`: the app output path/config version used for the attempt.
- `counts`: backend counts where available.
- `errorSummary`: short user-facing error summary.
- `diagnosticRef`: optional pointer/key for raw Logs detail.
- `batchRunId` and `rowId` for batch rows.

## Required Integration Contract

Workers should follow these rules:

1. Write history only from terminal current state.
   - Single: write from `createJobPoller` `onJob` only when `job.status` is terminal.
   - Batch: write from the row/job terminal transition or from a snapshot-diff layer that only observes current-generation rows.

2. Use stable history ids so retry updates replace the previous visible outcome.
   - Single retry after cookie recovery must reuse the same logical history item for the affected URL/action until the retry reaches terminal state.
   - Batch retry must upsert by `batchRunId + rowId` or an explicit per-row `historyItemId`, not by backend `jobId`, because retry creates a new backend job id.

3. Do not append a permanent visible failure when a retry later succeeds.
   - If an attempt fails and becomes retry-eligible, the store may temporarily show failed.
   - When that same logical item is retried, the same history entry must move through the current status and end as the retry's terminal outcome.
   - Detailed per-attempt errors belong in Logs, not the basic History list.

4. Do not derive durability from backend `/api/v1/jobs`.
   - Backend jobs can be listed and polled during the current backend process only.
   - Backend jobs are pruned by TTL/capacity and disappear on restart.
   - History persistence is owned by the Tauri/app-data side.

5. Extend the Batch integration before claiming precise history timestamps/counts.
   - `BatchQueueRow` currently retains status, attempt, `lastJobId`, and `lastError`.
   - `applyTerminalState` receives the full backend `JobState` but discards `finishedAt` and counts.
   - Phase 3 workers must either write history inside that terminal transition or extend the row/snapshot model with terminal job metadata.

6. Keep skipped rows honest.
   - Parser-skipped rows should not become retryable download records.
   - If shown in History, mark them as batch validation outcomes with `sourceText`, `skipReason`, and no backend `jobId`.

## Evidence

Files inspected:

- `AGENTS.md`
- `.khuym/state.json`
- `history/learnings/critical-patterns.md`
- `history/windows-desktop-downloader-ui/phase-3-contract.md`
- `history/windows-desktop-downloader-ui/phase-3-story-map.md`
- `src/services/batchQueue.ts`
- `src/services/batchQueueRunner.ts`
- `src/services/backendClient.ts`
- `src/services/jobPolling.ts`
- `src/services/settingsStore.ts`
- `src/app/App.tsx`
- `src/tests/batch-queue-runner.test.ts`
- `src/tests/app-shell.test.tsx`
- `src/tests/backend-client.test.ts`
- `src/tests/job-polling.test.ts`
- `src/tests/settings-store.test.ts`
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py`
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py`
- `package.json`

Focused verification run:

```text
npm test -- src/tests/batch-queue-runner.test.ts src/tests/job-polling.test.ts src/tests/app-shell.test.tsx src/tests/backend-client.test.ts
```

Result: 4 test files passed, 42 tests passed.

Key source findings:

- `src/services/jobPolling.ts` stops after terminal `success`, `failed`, or `cancelled` and calls `onJob(job)` before stopping.
- `src/services/batchQueueRunner.ts` uses `runGeneration` guards for submit/poll continuations and retry mutates the current row rather than creating a separate row.
- `src/services/batchQueueRunner.ts` sets terminal row status from backend `JobState`, but does not preserve `finishedAt` or counts on the row.
- `src/services/backendClient.ts` exposes `listJobs()`, but the app does not use it for current UI history.
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py` stores jobs in memory with TTL/capacity pruning and no persistence.
- Phase 3 contract already flags this exact risk: "History records drift from current row/job state, especially after retry."

## Constraints For Execution Beads

- Add tests before implementation for the stale-history case:
  - Single cookie/auth failure then retry success updates one history entry to success.
  - Batch failed row then retry success updates the same row history entry to success.
  - Stale queue A completion after queue B restart does not write queue A history.
  - Backend `listJobs()` absence/restart does not delete persisted app history.
- Keep history basic: no search/filter/delete/analytics.
- Keep raw attempt-level diagnostics in Logs.
- Treat backend job ids as attempt ids, not durable history ids.
