# Phase 3 UAT Evidence - Windows Desktop Downloader UI

- **Feature**: `windows-desktop-downloader-ui`
- **Bead**: `douyin-downloader-app-irx.27`
- **Worker**: `Meitner` (`019e0951-aa52-7192-a897-9390597d38fa`)
- **Date**: 2026-05-09
- **Overall status**: `SELF-REVIEWED - GREEN WITH SCOPED LIVE-RUNTIME BLOCKER DISCLOSED`
- **Latest self-review**: 2026-05-09 03:43 +07:00

## Automated Verification

| Command | Expected | Actual | Evidence |
|---|---|---|---|
| `npm test` | Whole app suite passes for Phase 3 gate. | Passed (`12 files`, `95 tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-tests.log` |
| `npm run test:tauri` | Native Tauri command/unit boundary tests pass for config writes, cookie parsing/validation, and merge/error paths. | Passed (`src-tauri backend tests`). | Local command output during bead `douyin-downloader-app-br1` |
| `npm run build` | Production build succeeds. | Passed (`tsc && vite build`). | `history/windows-desktop-downloader-ui/evidence/phase3-build.log` |
| `npm test -- src/tests/app-shell.test.tsx --reporter verbose` | UI integration proofs for settings/history/cookie/log separation pass. | Passed (`32 tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-app-shell-verbose.log` |
| `npm test -- src/tests/settings-store.test.ts src/tests/history-store.test.ts src/tests/backend-lifecycle.test.ts --reporter verbose` | Persistence and managed-backend readiness unit/integration proofs pass. | Passed (`17 tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-settings-history-verbose.log` |
| `npm test -- src/tests/log-store.test.ts src/tests/cookie-recovery.test.ts src/tests/error-mapper.test.ts --reporter verbose` | Cookie fallback, log redaction, and bounded retention proofs pass. | Passed (`13 tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-logstore-verbose.log` |
| `npm test -- src/tests/app-shell.test.tsx -t "disables submit while config version is waiting for backend restart|blocks submit while backend restarts after advanced settings change" --reporter verbose` + `npm test -- src/tests/backend-lifecycle.test.ts -t "transitions to ready only after /api/v1/health reports healthy" --reporter verbose` | Config-generation gating and backend health-readiness transitions are explicit and passing. | Passed (`3 focused tests`). | `history/windows-desktop-downloader-ui/evidence/phase3-runtime-readiness.log` |

## Focused UAT Evidence (Phase 3 Bead Scope)

| Proof row | Action | Expected | Actual | Evidence | Blocker |
|---|---|---|---|---|---|
| Settings persistence across relaunch | Verbose app-shell + settings-store tests. | Output folder and scoped advanced options persist and serialize through managed config. | Covered by passing tests: `loads persisted output folder before starting managed backend lifecycle`, `writes scoped advanced controls into managed config without deferred keys`, and settings-store serialization/version tests. | `phase3-app-shell-verbose.log`, `phase3-settings-history-verbose.log` | No |
| History persistence across relaunch | Verbose app-shell + history-store tests. | Basic history survives restart and retains bounded recent entries. | Covered by passing tests: `records single terminal success...`, `updates the same batch history row to final status after retry`, `loads persisted history after app restart`, plus history-store persistence/cap tests. | `phase3-app-shell-verbose.log`, `phase3-settings-history-verbose.log` | No |
| Cookie recovery + fallback behavior | Verbose app-shell + cookie-recovery + error-mapper tests. | Single and batch cookie failures expose recovery actions; cancellation and missing-runtime paths remain friendly and keep diagnostics in Logs. | Covered by passing tests: `shows cookie recovery actions...`, `shows batch cookie recovery action...`, `keeps cancel diagnostics in logs...`; cookie service also proves missing-runtime fallback and required-key validation. | `phase3-app-shell-verbose.log`, `phase3-logstore-verbose.log` | No |
| Logs separation, redaction, and bounds | Verbose app-shell + log-store tests. | Main workflow shows friendly errors while raw details are in Logs; sensitive values are redacted; retention is bounded. | Covered by passing tests: `shows friendly missing-job message... keeps diagnostics separate`, `redacts sensitive cookie and authorization text in logs panel`, log-store tests for `newest 1000 events` and redaction before storage. | `phase3-app-shell-verbose.log`, `phase3-logstore-verbose.log` | No |
| Backend readiness after config-generation change | Focused readiness tests + backend lifecycle test. | Submit paths remain blocked until backend is ready for current config generation and health endpoint returns ready. | Covered by passing focused tests for config-version wait, restart gating, and `/api/v1/health` readiness transition. | `phase3-runtime-readiness.log` | No |
| Live runtime cookie capture / desktop-managed runtime proof | Real Tauri runtime exercise with live cookie fetch boundary. | Live runtime proof should be captured if available; otherwise explicitly scoped as unavailable. | Not executed in this bounded bead run. This evidence pack is deterministic test/build proof only and does not claim live cookie capture or packaged runtime behavior. | N/A | **Scoped blocker (explicit): live runtime proof unavailable in this bead run** |

## Proof Surface Disclosure

- **Deterministic test surface (available):** All evidence above comes from Vitest-based integration/unit flows and production build output.
- **Native command surface (available):** `npm run test:tauri` covers Rust-side command behavior for atomic config write paths, relative-path rejection, malformed cookie JSON rejection, required-key checks, invalid existing YAML handling, and config merge preservation.
- **Dev-runtime managed-backend behavior (available):** Readiness gating and health transition are proven through app-shell/backend-lifecycle tests with explicit focused commands.
- **Live cookie/runtime surface (unavailable in this bead):** No real browser-driven cookie capture session or packaged desktop runtime session was executed here; this is intentionally disclosed as scoped-blocked, not greened.

## Notes

- No broad feature implementation changes were required in this bead; scope was verification and evidence closeout.
- `npm test` logs include React `act(...)` warnings in `app-shell.test.tsx`; suite still passes and warnings are unchanged from prior runs.
