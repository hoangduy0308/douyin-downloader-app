# Phase 1 UAT Evidence - Windows Desktop Downloader UI

- **Feature**: `windows-desktop-downloader-ui`
- **Bead**: `douyin-downloader-app-irx.7`
- **Worker**: `Dirac` (`019e0447-d46f-7fb0-a964-1894e8cbc8c8`)
- **Date**: 2026-05-08
- **Overall status**: `BLOCKED` (live desktop-managed backend readiness could not be proven in this run)

## Automated Verification

| Command | Expected | Actual | Evidence |
|---|---|---|---|
| `npm test -- src/tests/backend-lifecycle.test.ts src/tests/settings-store.test.ts src/tests/app-shell.test.tsx` | Targeted Phase 1 tests pass. | Passed (`3 files`, `22 tests`). | `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` |
| `npm run build` | Frontend production build passes. | Passed (`vite build` completed). | `history/windows-desktop-downloader-ui/evidence/phase1-build.log` |
| `npm run tauri dev` smoke probe | Desktop app launches and managed backend reaches health-ready. | Desktop exe process observed, but wrapper reports `exit code: 0xffffffff`; health probe could not connect. | `history/windows-desktop-downloader-ui/evidence/phase1-tauri-smoke.json`, `tauri-dev.out.log`, `tauri-dev.err.log` |

## UAT Checklist Evidence

| Proof row | Command / action | Expected | Actual | Evidence path / output | Blocker |
|---|---|---|---|---|---|
| Desktop app launch | Start `npm run tauri dev`; observe process/logs. | Desktop app runs under Tauri without crash. | `douyin-downloader-app.exe` process appears, but tauri wrapper reports `process didn't exit successfully ... (exit code: 0xffffffff)`. | `history/windows-desktop-downloader-ui/evidence/phase1-tauri-smoke.json`, `tauri-dev.err.log` | **Yes** |
| Backend reaches `/api/v1/health` without manual terminal startup | Probe `http://127.0.0.1:8787/api/v1/health` while `tauri dev` is running. | Health returns `status: ok`. | Probe failed: `Unable to connect to the remote server`. No managed backend python process found for `run.py --serve ... 8787`. | `history/windows-desktop-downloader-ui/evidence/phase1-tauri-smoke.json` | **Yes** |
| Runtime mode used | Inspect lifecycle contract + tests. | Mode is `dev-python` for Phase 1 runtime. | Confirmed in app lifecycle call and lifecycle tests (`mode: "dev-python"`). | `src/app/App.tsx`, `src/tests/backend-lifecycle.test.ts`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| Host / port | Inspect lifecycle config + tests. | Host/port `127.0.0.1:8787`. | Confirmed in app lifecycle call and test readiness detail containing `127.0.0.1:8787`. | `src/app/App.tsx`, `src/tests/backend-lifecycle.test.ts`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| Health response body | Probe `/api/v1/health` during desktop runtime. | JSON includes `status: "ok"`. | Not available due connection failure. | `history/windows-desktop-downloader-ui/evidence/phase1-tauri-smoke.json` | **Yes** |
| Diagnostics capture | Validate diagnostics are captured separately from main messaging. | Raw details go to diagnostics surface, friendly text stays in main panel. | Covered by tests (polling 404 + missing folder keeps raw detail in diagnostics cache, not main surface). | `src/tests/app-shell.test.tsx`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| Cleanup behavior | Validate managed/attach cleanup semantics and runtime stop behavior. | Managed process is stopped by lifecycle; attached external process is not force-stopped. | Covered in lifecycle tests (`stopCalls` behavior). Live smoke had no managed backend process to observe cleanup for this run. | `src/tests/backend-lifecycle.test.ts`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log`, `history/windows-desktop-downloader-ui/evidence/phase1-tauri-smoke.json` | Partial (live proof blocked) |
| Generated runtime config path | Verify runtime config file creation in app-owned path. | Managed config path is generated/written atomically outside backend resources. | Unit tests cover writer behavior for app-owned path. Live smoke did not produce `.runtime/managed-config.yml` in this repo run. | `src/tests/settings-store.test.ts`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | Partial |
| Selected absolute output folder | Verify absolute path handling for output folder. | Absolute paths accepted; relative paths rejected; selected folder used by open-folder action. | Covered by settings/app-shell tests. | `src/tests/settings-store.test.ts`, `src/tests/app-shell.test.tsx`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| No runtime config/output writes in backend repo `config/resources` | Check backend repo status for `config` + `resources`. | No mutation in backend repo resource/config surfaces. | Clean (`(clean: no config/resources changes)`). | `history/windows-desktop-downloader-ui/evidence/phase1-backend-config-status.log` | No |
| One URL submit | UI submit path test with accepted Douyin URL. | Submit sends one URL and stores job id. | Covered by app-shell test (`createDownloadJob` called, `Download queued as job-123`). | `src/tests/app-shell.test.tsx`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| Status/count rendering | Polling test with running/success transitions and counts. | Counts and status render correctly, polling stops on terminal. | Covered by app-shell test (`Running` -> `Success`, counts shown, `getJob` called twice). | `src/tests/app-shell.test.tsx`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| Terminal state | Verify terminal success/failed behaviors. | Terminal states shown with actionable result message(s). | Covered by app-shell tests (`Download finished successfully.`, failed/missing-job mappings). | `src/tests/app-shell.test.tsx`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |
| Open-folder action | Verify native open-folder action and missing-folder handling. | Action opens selected folder; missing folder shows friendly error, raw detail in diagnostics. | Covered by app-shell tests (open called with absolute path; missing folder message + diagnostics detail). | `src/tests/app-shell.test.tsx`, `history/windows-desktop-downloader-ui/evidence/phase1-tests.log` | No |

## Fake Backend / Test Path Disclosure

- Download completion proof for submit/status/result actions in this bead is from **test fakes/mocks** (`backendClient`, lifecycle/runtime mocks) inside `src/tests/app-shell.test.tsx`.
- This run does **not** claim portable release proof or Phase 4 packaged sidecar proof.
- Live desktop-managed backend readiness remains blocked until `tauri dev` runtime can keep the process healthy and expose `/api/v1/health`.

## Blocking Summary

1. `tauri dev` wrapper reports `exit code: 0xffffffff` for `target\\debug\\douyin-downloader-app.exe`.
2. During smoke window, `http://127.0.0.1:8787/api/v1/health` is unreachable and no managed backend `python run.py --serve ... --serve-port 8787` process is observed.

