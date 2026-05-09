# Spike Findings: Phase 3 Settings Backend Readiness Contract

**Bead:** `douyin-downloader-app-yps`
**Question:** How should settings changes coordinate with managed backend restart/readiness so jobs cannot use stale config?

## Answer

YES, with strict constraints.

Phase 3 should use a generation-gated settings/readiness contract: every accepted settings change writes the app-owned managed config, increments a config generation, immediately makes the backend stale for submissions, restarts the managed backend, and marks the app ready only after `/api/v1/health` passes for the same generation.

This is required because the Python server captures config-derived dependencies at process/app startup. A hot write to `managed-config.yml` is not enough for jobs submitted to the already-running backend.

## Current Evidence

- `src/services/settingsStore.ts` already models the right core invariant: `configVersion` starts ahead of `backendReadyConfigVersion`, `markBackendReadyForCurrentConfig()` aligns them, and `isReadyForSubmit()` is true only when both versions match.
- `src/services/settingsStore.ts` is not integrated into `src/app/App.tsx` yet. The app currently keeps `outputPath`, `configVersion`, and `backendReadyConfigVersion` as React state, so the store tests prove the concept but not the production app wiring.
- `src/app/App.tsx` restarts managed backend lifecycle whenever `outputPath` or `configVersion` changes, passes `configPath` and `outputPath` into `BackendLifecycle.start()`, disables Single submit when `configVersion !== backendReadyConfigVersion`, and sets `backendReadyConfigVersion` only after `ready.state === "ready"`.
- `src/services/backendLifecycle.ts` starts the runtime and then polls `/api/v1/health`; it returns `ready` only after a healthy probe and stops the managed process on timeout. This matches the critical pattern that process existence is not readiness.
- `src-tauri/src/backend.rs` handles `backend_start` by stopping any existing managed process before spawning `python run.py --serve ... --config <managed> --path <absolute-output>`.
- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py` loads YAML/env config during `ConfigLoader.__init__()`.
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py` builds `_ServerDeps` once from that `ConfigLoader`, including `FileManager(config.get("path"))`, `CookieManager`, rate limiter, retry handler, and queue manager.
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py` submits jobs into an in-memory manager whose executor closes over those shared server deps. Therefore a job submitted before restart readiness can run with old config.
- Tests currently cover the pieces separately: settings version tracking, health-gated lifecycle readiness, Tauri-mode submit disabling while restart is pending, and batch queue stale-run guards.
- Tests do not yet cover the full production risk: changing settings while a batch queue is active or retrying rows while the backend is stale. `BatchQueueRunner` owns its own scheduler and calls `createDownloadJob()` directly once started.

## Required Contract

- Settings changes must be accepted through one app-owned coordinator, not scattered React state updates.
- The coordinator must write the managed config atomically before starting or restarting the backend.
- Each write must increment a monotonically increasing config generation.
- The app must immediately set backend readiness for submit to stale/pending for the new generation.
- Managed backend restart must use the exact config path and output/settings values for that generation.
- Readiness must be generation-aware: an old lifecycle promise, old health success, or old restart completion must not mark a newer config generation ready.
- Single submit, batch start, batch resume, retry-all, retry-row, and any queue auto-scheduling path must all consult the same `readyConfigVersion === currentConfigVersion` gate.
- The batch scheduler must not keep submitting waiting rows while a settings restart is pending. Either the runner receives a readiness gate before each submission or the app pauses/stops scheduling before applying settings changes.
- Active jobs cannot be safely migrated to new settings because the backend has no cancel/migrate API and restart loses in-memory job state. Phase 3 should either block settings edits while any single job or batch row is pending/running, or explicitly queue the setting as "apply after active work finishes."
- If execution chooses immediate apply while jobs are active, it must make the destructive behavior explicit: stop scheduling, warn that in-flight jobs will be interrupted, restart backend, clear stale active job ids, and record diagnostics. This is riskier and should not be the default.

## Constraints For Implementation Beads

- Do not rely on hot-editing the managed config file while the current backend process keeps running.
- Do not treat `/api/v1/health` alone as proof of current settings unless it is tied to the lifecycle start request for the current generation. The current health payload is only `{"status": "ok"}`.
- Do not let preview/non-Tauri mode hide the production contract. Preview can mark ready for local UI tests, but Tauri-mode tests must prove stale config blocks submit.
- Do not update only Single submit. Batch start, resume, retry, and auto-submission are equal submission surfaces.
- Do not allow settings changes during active jobs unless the UI contract explicitly says whether they are delayed or interrupting.
- Keep restart/readiness proof health-based, not process-existence-based.
- Keep managed config in an app-owned writable path. Do not write backend repo config files or bundled resources.
- Add tests around the contract before feature work: at minimum, settings change blocks Single submit, blocks Batch start/retry/resume, prevents queued auto-submits during stale backend readiness, and ignores stale readiness from an older generation.

## Recommended Shape

1. Introduce or integrate a single runtime settings coordinator that owns `settingsSnapshot`, `configVersion`, `backendReadyConfigVersion`, and lifecycle restart state.
2. On settings edit: validate, persist settings, write managed config, increment generation, mark stale, then trigger managed backend restart for that generation.
3. On backend health ready: mark only that generation ready.
4. Expose one derived `canSubmitJobs` boolean and use it for Single, Batch start, Batch resume, Retry failed, Retry row, and internal batch scheduling.
5. While active jobs exist, prefer disabling settings edits or staging the change until work is terminal. This avoids killing in-memory backend jobs and avoids ambiguous output-folder ownership.

## Files Read

- `AGENTS.md`
- `.khuym/state.json`
- `history/windows-desktop-downloader-ui/CONTEXT.md`
- `history/learnings/critical-patterns.md`
- `history/windows-desktop-downloader-ui/phase-3-contract.md`
- `history/windows-desktop-downloader-ui/phase-3-story-map.md`
- `src/services/settingsStore.ts`
- `src/services/backendLifecycle.ts`
- `src/services/tauriBackendRuntime.ts`
- `src/services/batchQueueRunner.ts`
- `src/app/App.tsx`
- `src/tests/settings-store.test.ts`
- `src/tests/backend-lifecycle.test.ts`
- `src/tests/app-shell.test.tsx`
- `src/tests/batch-queue-runner.test.ts`
- `src-tauri/src/backend.rs`
- `F:\Work\DouyinDownload\douyin-downloader\cli\main.py`
- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py`
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py`
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py`
- `F:\Work\DouyinDownload\douyin-downloader\tests\test_server.py`

## Closing Judgment

YES. The right coordination model is a config-generation gate plus managed backend restart/readiness proof. The current code has most primitives, but Phase 3 must centralize them and extend the gate to every job-submission path, especially batch auto-scheduling and retries.
