# Spike: Can retry avoid duplicate in-flight submissions and bad totals?

**Decision: YES.**

Retry can be constrained to failed/skipped terminal rows and guarded against in-flight duplicate submissions with app-side row state. No backend batch API or backend idempotency change is required for Phase 2, provided the queue runner treats the app row model as authoritative.

## Evidence

- The Phase 2 contract already defines the intended retry shape: retry resets failed/skipped rows into waiting state and resubmits them without rebuilding the queue. It also names retry idempotence as a HIGH-risk validation item: failed/skipped row retry must not duplicate in-flight jobs or corrupt aggregate totals.
- The story map puts the safety boundary in app-owned queue state: Story 1 creates explicit row state before execution, Story 2 maps rows to `BackendClient.createDownloadJob` and `getJob`, and Story 3 adds retry eligibility, UI disabled states, and duplicate-submit prevention.
- Current app code has no Batch implementation yet. `App.tsx` renders Batch as a placeholder, so there is no existing incompatible batch state to preserve.
- Current backend client is enough for app-side orchestration: `createDownloadJob` posts one URL and returns a `jobId`; `getJob` returns `status`, timestamps, `counts`, and `error`; `JobPoller` stops on terminal `success`, `failed`, or `cancelled`.
- The sibling backend server is single-job oriented. `POST /api/v1/download` calls `JobManager.submit`, which always creates a new random job id and schedules work. Backend `JobManager` preserves in-flight jobs but does not dedupe same-row or same-URL submissions.
- Backend terminal states are only `success` and `failed`; skipped is a count/result field, not a backend job status. Therefore app rows need their own `skipped` terminal row status for parser/backend-derived skipped rows.

## Required Constraints

- Add retry eligibility to the app row model, not to backend jobs. A row is retryable only when its current app row status is terminal `failed` or retryable `skipped`, and it has no active in-flight submission.
- Do not equate every skipped/invalid input with retryable work. Blank, unsupported, or duplicate parser rows may be terminal skipped/invalid for totals, but should remain non-submittable unless the row is edited/revalidated into a valid waiting row.
- Introduce an app-side in-flight guard such as `status: "submitting" | "waiting" | "running" | "success" | "failed" | "skipped"`, `currentJobId`, and/or `attemptId`. The retry command must synchronously move eligible rows out of terminal state before awaiting `createDownloadJob`, so double-clicks or scheduler ticks cannot submit the same row twice.
- The scheduler must submit only valid `waiting` rows. It must exclude rows with `status` of `submitting`, `running`, `success`, `failed`, `skipped`, or any row with a non-terminal active `currentJobId`.
- On retry, clear stale terminal fields for that row before resubmission: previous `currentJobId`, row error, and prior latest job counts should not remain part of the visible current attempt.
- Aggregate totals must be derived from current row states, not accumulated submit/poll events or `/api/v1/jobs` history. After a failed row is retried and succeeds, it should count as one success row, not one failed plus one success. If item-level backend counts are displayed later, they must also use each row's latest attempt only.
- Tests should use fake backend clients/timers and include at least: retry ignores running/submitting rows, retry resets only failed/skipped eligible rows, double retry does not call `createDownloadJob` twice for one row, and final totals match current row states after retry success.

## Impacted Beads

- `douyin-downloader-app-irx.8`: row model must include stable row id, valid/waiting vs skipped/invalid distinction, retry eligibility, attempt/current-job fields, and aggregate helpers that derive from current row state.
- `douyin-downloader-app-irx.10`: queue runner must own the in-flight guard and duplicate-submit protection before/around `createDownloadJob`.
- `douyin-downloader-app-irx.11`: Batch UI totals must render from row-state selectors, not event counters or backend job list totals.
- `douyin-downloader-app-irx.12`: retry controls belong here; disabled/enabled logic must mirror the service-level eligibility guard and prove failed/skipped-only retry.
- `douyin-downloader-app-irx.13`: terminal batch summary must use row-state-derived final totals after retries.
- `douyin-downloader-app-irx.14`: UAT proof must include a retry-after-failure path and show final totals matching row states.

## Validation Close

YES: app-side row state is sufficient, but only if retry is terminal-row-gated, in-flight rows are locked before async submission, and totals are recomputed from current row state after every retry transition.
