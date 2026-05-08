# Phase Plan: Windows Desktop Downloader UI

**Date**: 2026-05-08
**Feature**: windows-desktop-downloader-ui
**Based on**:
- `history/windows-desktop-downloader-ui/CONTEXT.md`
- `history/windows-desktop-downloader-ui/discovery.md`
- `history/windows-desktop-downloader-ui/approach.md`

---

## 1. Feature Summary

This feature turns the existing Python Douyin downloader into a Windows desktop utility that a user can unzip, run, paste or import Douyin URLs into, monitor, recover, and inspect later without touching a terminal. The downloader core already exists, but the app experience does not: planning splits the work so we first prove one real desktop app can manage the backend, then make batch queues first-class, then add recovery/history/logs, and finally prove the portable distribution.

---

## 2. Why This Breakdown

- Phase 1 must happen first because nothing else matters until the Windows app can open, start the backend by itself, submit one real download, and show the result without a terminal.
- Phase 2 is separate because full batch behavior is not just a bigger text box; it needs import, queue state, pause/resume semantics, retry per job, counts, and active-job visibility.
- Phase 3 is separate because cookie recovery, advanced controls, history, and logs are the operational layer that makes the app usable repeatedly, but they depend on the single and batch job surfaces being real.
- Phase 4 is separate because portable packaging must prove the exact built folder, sidecar backend, runtime resources, config paths, and app data paths together.

---

## 3. Phase Overview Table

| Phase | What Changes In Real Life | Why This Phase Exists Now | Demo Walkthrough | Unlocks Next |
|-------|----------------------------|---------------------------|------------------|--------------|
| Phase 1: Desktop app starts one download | The user opens a Windows desktop app, chooses/keeps an output folder, pastes one in-scope Douyin URL, starts a download, sees status/counts, and can open the output location. | This proves the core app shape: desktop shell, managed backend startup, health check, submit-then-poll job flow, and friendly status. | Launch the app from dev/build, see backend health become ready, paste one video/note URL, run it, watch status move through pending/running/done/failed, then open the output folder. | Batch queue work can build on the same backend lifecycle, settings, and job polling path. |
| Phase 2: Batch queue is first-class | The user can switch between Single and Batch with equal weight, import/paste many URLs, see a queue, pause future starts, resume, retry failed items, and track success/failed/skipped counts. | D8 requires full batch in the first version, and current backend only exposes one job at a time. This phase turns the job API into a believable queue experience. | Import a text file with several URLs, start the queue, pause before all URLs start, resume, retry a failed row, and see batch totals match row states. | Recovery, history, and logs can now attach to both single and batch jobs consistently. |
| Phase 3: Recovery, controls, history, and logs | The app becomes practical for repeat Windows use: default output folder persists, in-scope advanced options are available but collapsed, cookie errors offer fetch-again/manual actions, basic history survives restart, and diagnostics live in a Logs tab. | After single and batch flows exist, the app needs the power-user and recovery behavior locked in D3-D13 without cluttering the main screen. | Change output folder and options, run a job with expired/missing cookies, use the cookie recovery action, restart the app, see recent URL/status/output history, and open Logs only when needed. | The app is functionally complete enough to package and UAT as a portable Windows release. |
| Phase 4: Portable unzip-and-run release | The user receives a folder/zip, unzips it on Windows, runs the `.exe`, and the app works without manual server start or installer setup. | D16 is not proven by source builds; it requires the desktop app, backend sidecar, config, browser/cookie runtime, and paths to work in the built folder. | Unzip the release folder on Windows, run the exe, confirm backend starts, run one single download and one batch queue, fetch cookies if needed, restart, and verify history/output folder remain. | Ready for review/UAT and later expansion to deferred modes. |

---

## 4. Phase Details

### Phase 1: Desktop app starts one download

- **What Changes In Real Life**: A user can open a real Windows app, not a browser tab, and complete one single-link download without starting a backend manually.
- **Why This Phase Exists Now**: It proves the hardest product boundary early: desktop shell plus managed backend plus one working download loop.
- **Stories Inside This Phase**:
  - Story 1: App shell and backend readiness - the app opens, starts or connects to its managed backend, waits for health, and shows ready/error state.
  - Story 2: Single URL submission - the user pastes one in-scope URL and the app submits it through the backend job API.
  - Story 3: Single job status and result actions - the app polls job status/counts, shows success/failure guidance, and offers open output folder/result actions.
- **Demo Walkthrough**: Start the app, watch it move from starting backend to ready, paste one Douyin video or note URL, click start, see the active job and counts update, then open the chosen output folder when it finishes.
- **Unlocks Next**: Batch can reuse the same backend lifecycle, settings, submit/poll client, status components, and output actions.

### Phase 2: Batch queue is first-class

- **What Changes In Real Life**: The user can run a batch as a managed queue instead of manually submitting one URL at a time.
- **Why This Phase Exists Now**: D8 locks full batch into the first version, and batch needs semantics that single-job API polling does not provide by itself.
- **Stories Inside This Phase**:
  - Story 1: Batch input and import - the user can paste many URLs or import a text file and see validated queue rows.
  - Story 2: Queue execution - the app maps queued rows to backend jobs, respects concurrency, and shows active URL/job plus success/failed/skipped totals.
  - Story 3: Pause, resume, and retry - the user can pause future starts, resume the queue, and retry failed rows without restarting the app.
  - Story 4: Batch completion actions - the app summarizes the batch and exposes per-row or output-folder actions.
- **Demo Walkthrough**: Switch to Batch, import a URL file, start the queue, pause it while one job is active, resume it, retry a failed row, and confirm the visible totals match the queue rows.
- **Unlocks Next**: Cookie recovery, history, and logs can be applied consistently to both single and batch flows.

### Phase 3: Recovery, controls, history, and logs

- **What Changes In Real Life**: The app becomes useful across repeated sessions and normal failure cases, not just a happy-path downloader.
- **Why This Phase Exists Now**: Recovery and persistence should attach to proven single/batch flows; doing them before the flow exists would create settings without clear behavior.
- **Stories Inside This Phase**:
  - Story 1: Persistent settings and in-scope advanced controls - output folder and core options survive restart, while deferred modes stay out of the first UI.
  - Story 2: Cookie recovery - cookie-expiration/missing-cookie failures show clear guidance with fetch-again and manual/import actions.
  - Story 3: Basic history - URL, time, status, and last output/result location persist across app launches.
  - Story 4: Logs panel - technical diagnostics are available separately without streaming terminal logs into the main download surface.
- **Demo Walkthrough**: Set an output folder and crawl option, trigger or simulate a cookie failure, recover through the app, restart, verify history and settings remain, then open the Logs panel for technical details.
- **Unlocks Next**: All first-version behavior is ready to be proved in the packaged portable release.

### Phase 4: Portable unzip-and-run release

- **What Changes In Real Life**: The app can be handed to the user as a portable Windows folder/zip with a runnable exe and no manual backend setup.
- **Why This Phase Exists Now**: Packaging is the final proof that the integrated app works outside the dev environment.
- **Stories Inside This Phase**:
  - Story 1: Backend sidecar packaging - the Python backend, required dependencies, config template, and runtime resources are included in the release layout.
  - Story 2: Portable app packaging - the desktop executable, sidecar, resources, and app data paths work from an unpacked folder.
  - Story 3: Unpacked-folder UAT - single, batch, cookie recovery, logs, restart/history, and open-folder actions are verified from the release artifact.
- **Demo Walkthrough**: Delete old dev assumptions, unzip the portable folder, run the exe, complete one single download, complete one batch queue, fetch cookies if needed, restart, and confirm persisted history/settings.
- **Unlocks Next**: Review/UAT and future phases for deferred live, comments, transcript, discovery, search, installer, or LAN/mobile use.

---

## 5. Phase Order Check

- [x] Phase 1 is obviously first.
- [x] Each later phase depends on or benefits from the one before it.
- [x] No phase is just a technical bucket with no user/system meaning.

---

## 6. Approval Summary

- **Phase plan approval state**: Approved before Phase 1 execution.
- **Completed/prepared phase**: `Phase 1 - Desktop app starts one download`
- **Current phase prepared next**: `Phase 2 - Batch queue is first-class`
- **What the user should picture after Phase 2**: switching to Batch, importing or pasting multiple URLs, starting a visible queue, pausing future starts, resuming, retrying failed rows, and seeing final totals match row states.
- **What will not happen until later phases**: cookie recovery, persisted history/logs, and portable zip proof remain planned but are not prepared for execution in Phase 2.

---

## 7. Planning Continuation Notes

- Phase 1 execution closed via bead `douyin-downloader-app-irx.7`; rescue evidence in `history/windows-desktop-downloader-ui/evidence/phase1-tauri-smoke-rescue.json` shows managed backend health reached `/api/v1/health`.
- Phase 2 is prepared in:
  - `history/windows-desktop-downloader-ui/phase-2-contract.md`
  - `history/windows-desktop-downloader-ui/phase-2-story-map.md`
- The Phase 2 queue contract is app-owned orchestration over the existing single-job backend API unless validating proves a backend batch API or cancel API is required.
