---
date: 2026-05-09
feature: windows-desktop-downloader-ui
categories: [pattern, decision, failure]
severity: critical
tags: [desktop, runtime-config, cookie-recovery, testing, packaging]
---

# Learning: Generation-Gated Runtime Config

**Category:** pattern
**Severity:** critical
**Tags:** [desktop, runtime-config, backend-lifecycle]
**Applicable-when:** A UI writes config, cookies, output paths, or options that a managed backend must consume before user actions are valid.

## What Happened

Phase 3 made the app persist output folder, scoped advanced options, and cookie state into a managed runtime config. That only stayed truthful after the app tracked config generation and blocked Single submit, Batch start/resume/retry, and queue auto-submission until backend health matched the current config.

## Root Cause / Key Insight

For a managed desktop backend, writing config is not enough. The product is only ready when the backend has started or restarted against that exact config generation and `/api/v1/health` confirms readiness.

## Recommendation for Future Work

When a desktop UI mutates runtime config, track a config generation and require backend readiness for that generation before enabling work. Add tests that prove every submit path blocks on stale config, not only the primary button.

---

# Learning: Cookie Recovery Must Prove State Change

**Category:** pattern
**Severity:** standard
**Tags:** [cookie-recovery, credentials, tauri]
**Applicable-when:** External credential, cookie, token, or browser capture must update the runtime authority used by the app.

## What Happened

The app-triggered cookie recovery flow wrapped the sibling downloader's `tools.cookie_fetcher.py` in a Tauri-managed child process. The final contract treated recovery as successful only after captured JSON was parsed, required Douyin keys were present, and sanitized cookies were atomically committed into the managed YAML config.

## Root Cause / Key Insight

Exit codes and log text are not the product outcome. Users need the next retry to use the refreshed cookies, so the proof must be a validated mutation of the same runtime config the backend reads.

## Recommendation for Future Work

For credential recovery flows, define success as a validated state change in the runtime authority. Keep raw secrets out of renderer payloads, and test success, cancel, missing runtime, failure, and unexpected statuses across the native/renderer boundary.

---

# Learning: Failure Classifiers Need Negative Contract Tests

**Category:** failure
**Severity:** critical
**Tags:** [testing, error-classification, adapter-boundary]
**Applicable-when:** User-facing recovery state depends on diagnostic text, process stderr, exception messages, or adapter-specific failure strings.

## What Happened

Review found the missing-runtime classifier could mislabel ambiguous Playwright or module diagnostics as `missing-runtime`. Follow-up work added positive, negative, ambiguous, and spawn-failure coverage so friendly degraded states do not hide unrelated failures.

## Root Cause / Key Insight

Text classifiers are easy to make too broad. A classifier that drives user guidance is part of the product contract, so false positives can send users into the wrong remediation loop even when tests cover the happy degraded case.

## Recommendation for Future Work

Whenever diagnostic text drives a user-facing status, add a fixture matrix with explicit positive, negative, ambiguous, and low-level spawn-error cases. Do not ship broad substring matching with only one positive test.

---

# Learning: App-Owned Queue Can Extend A Single-Job API

**Category:** decision
**Severity:** standard
**Tags:** [batch-queue, architecture, api-contract]
**Applicable-when:** A backend has reliable single-item job APIs but the product needs first-class batch UX before a native batch API exists.

## What Happened

The app delivered batch import, per-row state, pause-future-starts, retry failed rows, active URL/job, counts, and output actions by mapping queue rows onto the existing single-job REST API. This avoided a broad backend rewrite while keeping batch behavior visible and testable.

## Root Cause / Key Insight

The product requirement was queue UX, not necessarily a backend batch endpoint. App-side orchestration was enough as long as pause was defined honestly and async continuations were guarded with run generation tokens.

## Recommendation for Future Work

Start with app-owned orchestration when backend single-job APIs are stable. Add backend batch/cancel APIs only when a concrete user behavior cannot be represented truthfully by the app queue.

---

# Learning: Portable Packaging Is Its Own Gate

**Category:** decision
**Severity:** critical
**Tags:** [packaging, tauri, sidecar, uat]
**Applicable-when:** A desktop feature includes both dev/runtime behavior and a final portable or packaged distribution promise.

## What Happened

Phase 3 became functionally complete for settings, recovery, history, logs, and app-managed dev runtime proof. Review correctly treated missing sidecar binaries, resources, package scripts, and unzip-and-run UAT as out of Phase 3 scope because the phase contract explicitly deferred D16 portable packaging to Phase 4.

## Root Cause / Key Insight

Dev runtime proof and production distribution proof are different evidence surfaces. Marking packaging complete from `tauri dev`, unit tests, or source builds would create false green release confidence.

## Recommendation for Future Work

Keep packaging as a separate hard gate when a feature promises a portable app. Do not close the release phase until an unpacked folder proves the desktop exe, backend sidecar, config paths, cookies, logs, history, restart behavior, and UAT together.

---

# Learning: Boundary Tests Should Stay Type-Safe

**Category:** pattern
**Severity:** standard
**Tags:** [typescript, testing, contract]
**Applicable-when:** Tests protect renderer/native, API/client, or adapter payload contracts.

## What Happened

Review found cookie recovery test fixtures using cast escapes that weakened TypeScript's ability to catch payload drift. The follow-up replaced those casts with typed fixtures so the test compiler protects the same boundary the behavior tests cover.

## Root Cause / Key Insight

Boundary tests lose value when their fixtures bypass the contract. `as unknown as ...` can keep tests green while the real payload shape drifts.

## Recommendation for Future Work

Use typed fixture builders for cross-layer payloads. Avoid cast escapes in behavior tests unless the test explicitly targets malformed legacy data and documents why the bypass is required.
