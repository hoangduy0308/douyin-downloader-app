---
date: 2026-05-08
feature: windows-desktop-downloader-ui
categories: [pattern, decision, failure]
severity: critical
tags: [desktop, backend-lifecycle, batch-queue, testing, review]
---

# Learning: Health Endpoint Proof For Managed Desktop Backends

**Category:** failure
**Severity:** critical
**Tags:** [desktop, backend-lifecycle, testing]
**Applicable-when:** Building a desktop app that starts or attaches to a local backend process.

## What Happened

Phase 1 tests proved lifecycle and UI behavior with fakes, but the first live UAT still recorded the Tauri process exiting with `0xffffffff` and `/api/v1/health` unreachable on `127.0.0.1:8787`. Later rescue evidence showed the managed backend path could become health-ready, but the initial artifact stayed blocked.

## Root Cause / Key Insight

Process existence and green unit tests are not service readiness. For a desktop wrapper, the product boundary is only real when the app-managed runtime reaches the same health endpoint that the UI depends on.

## Recommendation for Future Work

Always gate lifecycle or sidecar phases on a live app-managed health probe. Keep tests/build proof separate from runtime proof, and update the original UAT artifact in place when a blocked runtime proof is rescued.

---

# Learning: User-Visible Adapters Need Real Boundary Tests

**Category:** failure
**Severity:** critical
**Tags:** [testing, integration, review]
**Applicable-when:** Adding file import, export, picker, clipboard, shell, browser, or other user-visible adapter behavior.

## What Happened

Review opened P1 bead `douyin-downloader-app-irx.19` because the batch import UI looked covered through mocks while `src/services/batchImportAdapter.ts` still threw in production. D8 required real batch import behavior, so mocked happy-path UI proof was not enough.

## Root Cause / Key Insight

The adapter boundary itself was not under contract test. A mock can prove the UI reacts to an import result, but it cannot prove the real picker/read path exists.

## Recommendation for Future Work

For every user-visible adapter, add at least one direct test or smoke path against the production adapter boundary. Mocked integration tests can supplement this, but they must not be the only proof for import/export/file-picker behavior.

---

# Learning: Async Queue Runners Need Run Generation Tokens

**Category:** pattern
**Severity:** critical
**Tags:** [batch-queue, async, reliability]
**Applicable-when:** Implementing a queue that can be stopped, rebuilt, retried, or restarted while async submit/poll work is unresolved.

## What Happened

Review bead `douyin-downloader-app-3ma` found that delayed submit or poll continuations from an old queue could mutate a rebuilt queue. Row ids such as `row-1` were reused, and an `active` flag could become true again for a newer run.

## Root Cause / Key Insight

An `active` flag answers whether some run is active, not whether the current async continuation belongs to that run. Reused row ids make stale continuations especially dangerous because old backend responses can attach to new visible rows.

## Recommendation for Future Work

Thread a generation or run token through every async submit and poll continuation. Before mutating queue state, verify the captured token still matches the current run; add stale-submit and stale-poll regression tests.

---

# Learning: App-Owned Queue Can Defer Backend Batch APIs

**Category:** decision
**Severity:** standard
**Tags:** [batch-queue, architecture]
**Applicable-when:** A backend can process one async job reliably, but the product needs richer queue UX before backend-native batch support is justified.

## What Happened

Phase 2 implemented batch as an app-owned queue over the existing single-job API. Queue rows mapped to `createDownloadJob` and `getJob`, while the app owned row state, totals, pause, resume, retry, and terminal summary.

## Root Cause / Key Insight

The backend already provided enough terminal job state for the first queue experience. Rewriting the backend into a native batch API would have increased blast radius before the app proved the user workflow.

## Recommendation for Future Work

Prefer app-owned orchestration first when it can truthfully model the UX. Add backend batch, cancel, or persistence APIs only when the app cannot honestly provide the behavior from current single-job contracts.

---

# Learning: Pause Means Future Starts Unless Backend Supports Cancel

**Category:** decision
**Severity:** standard
**Tags:** [batch-queue, ux, backend-contract]
**Applicable-when:** Adding pause/resume controls over workers that do not support active job cancellation.

## What Happened

Phase 2 defined pause as "pause new starts only"; active backend jobs keep polling to terminal state. Tests and UAT used that exact wording and proved resume starts waiting rows later.

## Root Cause / Key Insight

The UI can offer useful queue control without pretending it can stop work the backend cannot stop. The truthful behavior is a scheduling gate, not active-download pause.

## Recommendation for Future Work

Keep control labels tied to real backend capability. If active cancellation is later added, introduce it as a separate capability with its own backend contract and UAT proof.

---

# Learning: Retry Scope Must Match Row Recoverability

**Category:** failure
**Severity:** standard
**Tags:** [batch-queue, testing, product-contract]
**Applicable-when:** Defining retry behavior for queues with failed, skipped, invalid, duplicate, or unsupported rows.

## What Happened

Phase 2 originally described retry for failed and skipped rows, but parser-skipped rows were intentionally non-retryable. Review bead `douyin-downloader-app-d35` narrowed the contract to failed-row retry only and added coverage for the chosen behavior.

## Root Cause / Key Insight

"Skipped" is not one recoverable state. Blank, invalid, unsupported, and duplicate rows usually need user edit/reparse rather than a backend retry.

## Recommendation for Future Work

Split skipped states by recoverability before promising retry. If a row cannot become valid without user input changes, document it as non-retryable and test that retry is disabled.

---

# Learning: Row Totals Should Come From Current State

**Category:** pattern
**Severity:** standard
**Tags:** [batch-queue, testing]
**Applicable-when:** Reporting totals for retryable queues where one logical row can fail and later succeed.

## What Happened

Phase 2 made aggregate success, failed, and skipped totals derive from current row state. A row that failed, was retried, and later succeeded counted as one success in the final summary.

## Root Cause / Key Insight

Accumulated event counters drift when retry resets a logical item. Current row state is the authoritative product surface for what happened to the queue.

## Recommendation for Future Work

Compute queue summaries from the current row model, not from historical events or backend job lists. Add tests where a row changes terminal outcome after retry.

---

# Learning: Keep Fake Proof Explicitly Scoped

**Category:** pattern
**Severity:** standard
**Tags:** [testing, uat, evidence]
**Applicable-when:** Proving UI or state-machine behavior with fake clients, fake timers, or controlled backend responses.

## What Happened

Phase 2 used deterministic fake backend clients and timers to prove paste/import/start/pause/resume/retry/totals/output-action behavior. The UAT artifact explicitly disclosed that it did not claim live Douyin, cookie, or packaged release proof.

## Root Cause / Key Insight

Deterministic proof is the right tool for queue semantics, but it becomes misleading if it is allowed to stand in for runtime, network, credential, or packaging proof.

## Recommendation for Future Work

Use fakes for deterministic behavior contracts, then label the proof surface precisely. Add separate runtime or packaged smoke rows for claims involving actual backend readiness, cookies, external services, or portable releases.
