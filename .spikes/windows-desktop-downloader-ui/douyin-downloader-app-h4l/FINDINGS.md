# Spike Findings: douyin-downloader-app-h4l

## Question

Are Phase 2 pause/resume semantics truthful without backend cancellation?

## Answer

YES.

Phase 2 can truthfully define pause as "block future queue starts only" while already-running backend jobs continue to terminal state. This matches the current backend and app contracts better than adding or implying active-download cancellation.

## Evidence

- `history/windows-desktop-downloader-ui/phase-2-contract.md` already states the intended semantics: pause prevents new queued rows from starting, running backend jobs continue, resume starts waiting rows, and active-download pause/cancel is out of scope unless validation proves otherwise.
- `history/windows-desktop-downloader-ui/phase-2-story-map.md` maps pause/resume/retry to Story 3 and explicitly says pause changes the queue state so no new waiting row starts while active backend jobs keep polling to terminal state.
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py:143` exposes `POST /api/v1/download`, `GET /api/v1/jobs/{job_id}`, and `GET /api/v1/jobs`. There is no pause, cancel, delete, or job-control endpoint.
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py:93` creates one async task per submitted job immediately. `JobManager._run` only transitions through pending/running to success or failed, and `JobStatus` has no cancelled status.
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py:161` waits for outstanding tasks during backend shutdown; it is not a user-facing per-job cancellation mechanism.
- `src/services/backendClient.ts:122` exposes health, create job, get job, and list jobs only. The desktop app currently has no API client surface that could cancel or pause a backend job.
- `src/services/jobPolling.ts:25` can stop client polling, but stopping polling is not stopping backend work. Phase 2 must keep polling active running rows after pause so terminal row state remains truthful.
- `src-tauri/src/backend.rs:56` can kill the managed backend process for lifecycle cleanup/restart. That is process lifecycle control, not queue pause, and must not be wired to a Pause Queue control.

## Constraints

- Pause copy and button labels must not imply "pause active downloads", "stop current download", or "cancel running jobs".
- Running rows must remain visibly running after pause and continue polling until success/failed.
- The queue scheduler may pause only by refusing to submit additional waiting rows while paused.
- Resume may only restart scheduling for waiting rows; it cannot resume a backend job because no backend job was suspended.
- Retry must be limited to failed/skipped terminal rows and must not reset or resubmit running rows.
- The frontend `cancelled` terminal type should not be used as a pause outcome unless a real backend cancellation API is added later.
- Tauri/backend lifecycle stop or restart must stay separate from queue pause/resume controls.

## Impacted Beads

- `douyin-downloader-app-irx.10`: Queue runner must implement pause as a scheduler gate before `BackendClient.createDownloadJob`, not as a backend command.
- `douyin-downloader-app-irx.11`: Execution UI must show paused queue state separately from running row state and keep active URL/job/counts truthful.
- `douyin-downloader-app-irx.12`: Pause/resume/retry bead can proceed with the existing contract, but tests must prove active jobs continue after pause and retry cannot touch in-flight rows.
- `douyin-downloader-app-irx.13`: Completion summary should count jobs that finished after pause normally.
- `douyin-downloader-app-irx.14`: UAT evidence must demonstrate pause blocks future starts while at least one active row continues to terminal state.

## Closing Judgment

Proceed with Phase 2 wording/control model as written. Do not add backend cancellation for Phase 2. Treat any UI wording that suggests active backend pause/cancel as a validation failure.
