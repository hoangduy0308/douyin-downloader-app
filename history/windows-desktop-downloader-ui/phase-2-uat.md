# Phase 2 UAT Evidence - Windows Desktop Downloader UI

- **Feature**: `windows-desktop-downloader-ui`
- **Bead**: `douyin-downloader-app-irx.14`
- **Worker**: `Hegel` (`019e0757-9880-7f93-95ec-759f5cb07774`)
- **Date**: 2026-05-08
- **Overall status**: `SELF-REVIEWED - GREEN WITH P2 FOLLOW-UP`
- **Latest self-review**: 2026-05-08 19:20 +07:00

## Automated Verification

| Command | Expected | Actual | Evidence |
|---|---|---|---|
| `npm test` | Whole app test suite passes for Phase 2 verification gate. | Passed (`9 files`, `66 tests`). | `history/windows-desktop-downloader-ui/evidence/phase2-tests.log` |
| `npm run build` | Production frontend build succeeds. | Passed (`tsc && vite build`). | `history/windows-desktop-downloader-ui/evidence/phase2-build.log` |
| `npm test -- src/tests/app-shell.test.tsx --reporter verbose` | UI-level batch flow proofs are explicit in test names and pass. | Passed (`20 tests`) with explicit paste/import/start/pause/resume/retry/totals/output-action cases. | `history/windows-desktop-downloader-ui/evidence/phase2-app-shell-verbose.log` |
| `npm test -- src/tests/batch-queue-runner.test.ts --reporter verbose` | Queue-runner semantics (pause/resume/retry/totals/stale-run guards) pass deterministically. | Passed (`11 tests`). | `history/windows-desktop-downloader-ui/evidence/phase2-batch-runner-verbose.log` |
| `git diff --check` | No whitespace errors before closeout. | No whitespace errors found; command output contains CRLF conversion warnings only. | `history/windows-desktop-downloader-ui/evidence/phase2-diff-check.log` |

## UAT Checklist Evidence (Phase 2 Contract)

| Proof row | Command / action | Expected | Actual | Evidence path / output | Blocker |
|---|---|---|---|---|---|
| Paste batch URLs | App-shell test for multiline input. | Pasted multiline URLs build queue rows in Batch mode. | Covered by passing test: `builds queue rows from pasted multiline urls while preserving equal-weight mode controls`. | `history/windows-desktop-downloader-ui/evidence/phase2-app-shell-verbose.log` | No |
| Import batch URLs | App-shell test through import adapter boundary. | Imported text creates rows; invalids are marked skipped. | Covered by passing test: `imports text through adapter boundary and renders invalid rows as skipped`. | `history/windows-desktop-downloader-ui/evidence/phase2-app-shell-verbose.log` | No |
| Start queue | App-shell + runner tests. | Valid waiting rows are submitted and active row/job appears with totals. | Covered by passing tests: `starts batch queue through runner and shows active row/job with aggregate totals`; runner submission/totals tests also pass. | `phase2-app-shell-verbose.log`, `phase2-batch-runner-verbose.log` | No |
| Pause (new starts only) | App-shell + runner tests. | Pause blocks new starts while active jobs continue to terminal state. | Covered by passing tests with explicit wording and behavior: `pauses new batch starts while active jobs continue to finish, then resumes waiting rows`; runner pause test also passes. | `phase2-app-shell-verbose.log`, `phase2-batch-runner-verbose.log` | No |
| Resume | App-shell + runner tests. | Resume starts remaining waiting rows after pause. | Covered by passing tests: app-shell pause/resume case + runner `resumes scheduling and starts remaining waiting rows`. | `phase2-app-shell-verbose.log`, `phase2-batch-runner-verbose.log` | No |
| Retry after failure | App-shell + runner tests. | Retry acts only on eligible terminal rows and avoids duplicate/in-flight retries. | Covered by passing tests: `enables retry only for eligible terminal rows...` and runner `retries only row-model eligible terminal rows...`. | `phase2-app-shell-verbose.log`, `phase2-batch-runner-verbose.log` | No |
| Final totals match row states | App-shell + runner tests. | Terminal summary and totals are derived from final row states (including retry outcomes). | Covered by passing tests: `shows terminal batch summary from row states after retry...` and runner aggregate-total assertions. | `phase2-app-shell-verbose.log`, `phase2-batch-runner-verbose.log` | No |
| Output action | App-shell test and terminal summary case. | Open output folder action remains available from terminal batch surface. | Covered by passing test: `shows terminal batch summary from row states after retry and reuses open-folder action`. | `phase2-app-shell-verbose.log` | No |
| Normal + narrow scan check | Source scan evidence for toolbar/totals/rows/pause wording. | Compact toolbar, one totals strip, readable table rows, truthful pause wording. | Source-level scan confirms: `.batch-toolbar` with wrap, single `.batch-totals` surface (`aria-label="Batch queue totals"`), queue row/table styling, and explicit pause wording in tests. | `history/windows-desktop-downloader-ui/evidence/phase2-layout-scan.log` | No |

## Self-UAT Review Update

- Artifact verification passed L1/L2/L3 for the Phase 2 batch UI, queue model, queue runner, import adapter, and app integration.
- There are no open P1 review beads.
- A new non-blocking P2 review bead was created: `douyin-downloader-app-d35` - skipped-row retry contract is broader than implementation.
- Current implementation proves retry for failed rows, including selected-row retry. Parser-skipped rows such as blank, invalid, unsupported, and duplicate rows are not retryable.
- Review remediation decision: Phase 2 retry contract is now explicitly failed-row only; parser-skipped rows remain non-retryable by design.
- Closeout status: `douyin-downloader-app-d35` remediated via failed-row-only contract wording plus retry-eligibility regression coverage.

## Fake Backend / Deterministic Path Disclosure

- This bead's flow proof is deterministic and mock-driven (no live Douyin/cookie dependency).
- Queue and UI behaviors are proven through fake backend responses in app-shell and queue-runner tests.
- This document does not claim live-network downloader success for real Douyin URLs in this phase.
