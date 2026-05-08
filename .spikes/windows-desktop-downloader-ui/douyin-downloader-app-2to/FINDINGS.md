# Spike Findings: Phase 2 Queue Orchestration Over Single-Job API

**Bead:** `douyin-downloader-app-2to`
**Question:** Can app-side queue orchestration satisfy D8 over the existing `createDownloadJob` / `getJob` API without adding a backend batch API?

## Answer

YES, with strict constraints.

Phase 2 can truthfully implement first-version D8 batch queue behavior in the desktop app by owning the queue model, submitting each valid row through the existing single-job API, polling each backend job until terminal state, and aggregating row states in the app. A backend batch endpoint is not required for the planned Phase 2 semantics.

This is only true if Phase 2 keeps pause/resume honest: pause prevents new queued rows from starting, but any backend job already submitted keeps running until success or failure. The app must not claim active backend-job pause, cancel, or persistence because the current backend does not provide those capabilities.

## Evidence

- `history/windows-desktop-downloader-ui/CONTEXT.md` locks D8 as full batch support and clarifies that batch is more than a multiline URL form: import file, pause/resume, retry per job, and detailed queue management are in scope.
- `history/windows-desktop-downloader-ui/phase-2-contract.md` already defines the truthful semantics: current backend accepts one URL per job, so the desktop app should own the visible queue unless validating proves a backend API change is necessary. It also states pause blocks future starts only and running backend jobs continue.
- `history/windows-desktop-downloader-ui/phase-2-story-map.md` decomposes the work in the right order: row model/import first, queue runner second, pause/resume/retry third, completion proof last.
- `src/services/backendClient.ts` exposes exactly the usable app contract for this approach: `createDownloadJob(request)` posts one `{ url }` payload to `/api/v1/download`, and `getJob(jobId)` fetches `/api/v1/jobs/{job_id}`.
- `src/services/jobPolling.ts` already proves the app can poll a backend job through a fakeable client/timer seam and stop when status reaches `success`, `failed`, or `cancelled`. A batch runner can reuse the same public behavior pattern per row instead of needing a live backend in tests.
- `src/app/App.tsx` Phase 1 single flow is already submit-then-poll: it validates a Douyin/iesdouyin URL, calls `backendClient.createDownloadJob({ url })`, stores the returned job id, and polls the active job. Batch can generalize this from one active job to many app-owned rows.
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py` has no batch endpoint. It exposes `POST /api/v1/download`, `GET /api/v1/jobs/{job_id}`, and `GET /api/v1/jobs`.
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py` creates one in-memory `DownloadJob` per submitted URL, schedules it asynchronously, returns immediately, and later exposes status, total, success, failed, skipped, and error. That is enough for per-row terminal state and aggregate totals.
- The same backend job manager has no pause, cancel, retry, persistent queue, or durable job history API. Therefore backend-native batch controls are not available today, but app-side scheduler controls can still satisfy the Phase 2 contract if worded and tested as queue-level controls.

## Constraints For Phase 2

- Queue state must be app-owned. The backend job store is in-memory and TTL/capacity pruned, so it cannot be the source of truth for the visible batch queue.
- Invalid, unsupported, blank, and duplicate rows must be resolved before submission. They should become skipped/invalid app rows and must not call `createDownloadJob`.
- The queue runner must keep a per-row guard against duplicate in-flight submissions. A row with a backend job id in pending/running state must not be retried or submitted again.
- App-side concurrency should be small and explicit. The backend also has its own semaphore, so the app should avoid flooding the single-job API with the whole batch at once.
- Pause means "do not start more rows." It must not stop, cancel, or imply control over backend jobs that have already been submitted.
- Resume means the app scheduler may submit remaining valid waiting rows again, respecting the same concurrency and duplicate-submit guards.
- Retry may reset only eligible terminal rows, such as failed rows and skipped rows that are intentionally retryable. It must create a new backend job id for the retried attempt and keep prior in-flight jobs untouched.
- Aggregate counts should be derived from app row state plus backend job counts after polling. During a running backend job, the current server usually does not update per-job counts until the executor returns, so the UI should show running state and active URL/job rather than pretending there is fine-grained live progress.
- The app should keep its own URL and row context. The backend returns `url` from `job.to_dict()`, but the current app `JobState` type does not expose it, and the queue already knows the row URL.
- Do not rely on backend persistence for D12 history in this phase. Phase 3 can persist history from the app-owned row model.
- Current `parseApiJob` expects `submitted_at`, while the backend `DownloadJob.to_dict()` returns `created_at`. This does not block Phase 2 queue orchestration because row submit time can be app-owned, but bead `.10` should not build important queue behavior on `submittedAt` unless the client is made tolerant or aligned.
- Automated tests should use fake backend clients and fake timers. No test should need live Douyin network, cookies, sleeps, or a real backend process to prove queue scheduling.

## Impacted Beads

- `douyin-downloader-app-irx.8`: keep as app-side parser/model work. It should define row statuses and retry eligibility vocabulary without backend calls.
- `douyin-downloader-app-irx.9`: keep as Batch UI/input work. It should render rows and skipped/invalid state before execution.
- `douyin-downloader-app-irx.10`: executable as planned over `createDownloadJob` and `getJob`. Add explicit acceptance emphasis on per-row in-flight guard, app-side concurrency, fake timers, and no backend batch API.
- `douyin-downloader-app-irx.11`: executable as planned. It should show active URL/job, row status, backend job id, and aggregate totals derived from row state.
- `douyin-downloader-app-irx.12`: executable as planned only with queue-level control wording. Pause/resume/retry must not imply active backend job cancellation.
- `douyin-downloader-app-irx.13`: executable as planned. Completion summary should be app-row based and should reuse the existing open selected output folder action.
- `douyin-downloader-app-irx.14`: verification must prove the app-owned queue behavior with fake or controlled backend responses and explicitly disclose that no backend batch API was added.

## Closing Judgment

YES. Phase 2 can satisfy D8 over the existing single-job API by implementing an app-owned queue scheduler and row model. No backend batch API is needed for the current contract. Backend work should remain out of Phase 2 unless execution uncovers a concrete inability to obtain terminal row status through `getJob`.
