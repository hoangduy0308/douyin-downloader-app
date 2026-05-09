# Phase 3 UAT Evidence - Windows Desktop Downloader UI

- **Feature**: `windows-desktop-downloader-ui`
- **Bead**: `douyin-downloader-app-irx.32`
- **Date**: 2026-05-09
- **Overall status**: `PASS`
- **Latest self-review**: 2026-05-09 17:30 +07:00

## Automated Verification (Rerun)

| Command | Expected | Actual | Evidence |
|---|---|---|---|
| `npm run test` | Whole app suite passes for Phase 3 gate. | Passed (`14 files`, `104 tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-bead32-tests.log` |
| `npm run test:tauri` | Native Tauri boundary tests pass for config write, cookie parse/validation, and merge/error paths. | Passed (`25 tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-bead32-tauri-tests.log` |
| `npm run build` | Production build succeeds. | Passed (`tsc && vite build`). | `history/windows-desktop-downloader-ui/evidence/phase3-bead32-build.log` |
| `git diff --check` | Working tree has no whitespace/conflict marker diff-check errors. | Passed (line-ending warnings only, no diff-check failures). | `history/windows-desktop-downloader-ui/evidence/phase3-bead32-diff-check.log` |
| `npm run tauri dev` smoke + `GET /api/v1/health` | Desktop dev runtime starts and managed backend health is reachable when ready, without manual backend startup. | Passed: health reached `status: ok` on probe 3; managed backend python serve process observed on `127.0.0.1:8787`; no manual backend start used. | `history/windows-desktop-downloader-ui/evidence/phase3-bead32-tauri-smoke.json` |

## Focused UAT Results (Self-Run)

| UAT Item | Decision Link | Result | Evidence | Blocker |
|---|---|---|---|---|
| Settings persist across relaunch path | `D10`, `D4` | **Pass** (covered by integration + store tests). | `phase3-bead32-tests.log` | No |
| History persists with bounded records | `D12` | **Pass** (covered by app-shell/history-store tests). | `phase3-bead32-tests.log` | No |
| Cookie recovery messages remain actionable | `D5`, `D11` | **Pass** (service + app-shell + native tests pass). | `phase3-bead32-tests.log`, `phase3-bead32-tauri-tests.log` | No |
| Logs are separate/redacted and not the primary UX surface | `D13`, `D7` | **Pass** (log-store and app-shell assertions green). | `phase3-bead32-tests.log` | No |
| Real desktop-managed health readiness via `tauri dev` smoke | `D15` | **Pass**: `/api/v1/health` returned `status: ok` from app-managed runtime without manual backend startup. | `phase3-bead32-tauri-smoke.json` | No |

## Review Follow-up Tracking

- `douyin-downloader-app-fq4` (`P2`) - Harden missing-runtime classifier and degraded-path tests.
- `douyin-downloader-app-ajp` (`P2`) - Add cross-layer cookie recovery contract verification.
- `douyin-downloader-app-g4s` (`P3`) - Remove type-escape cast in cookie recovery test fixtures.

These remain non-blocking follow-ups; no open review `P1` remains for Phase 3 runtime readiness.

## Proof Surface Disclosure

- Deterministic test surface: available and rerun green.
- Native command surface: available and rerun green.
- Live runtime app-managed health surface: executed and proven with direct smoke evidence.
- `tauri dev` smoke was executed directly and logged, not inferred.
- Managed backend readiness is now proven for `D15`.

## Notes

- `npm run test` still emits React `act(...)` warnings in `app-shell.test.tsx`; suite remains passing.
- Runtime smoke was run after clearing stale locked app binaries before launch so `cargo` could rebuild and start the latest desktop binary.
