# Critical Patterns

Promoted learnings from completed features. Read this file at the start of every
planning Phase 0 and every exploring Phase 0. These are the lessons that cost the
most to learn and save the most by knowing.

---

## [20260508] Health Endpoint Proof For Managed Desktop Backends
**Category:** failure
**Feature:** windows-desktop-downloader-ui
**Tags:** [desktop, backend-lifecycle, testing]

Phase 1 initially had green fake-backed tests while the live desktop-managed backend health probe was still failing. For desktop wrappers and sidecars, process existence is not readiness; require the app-managed runtime to reach its health endpoint before closing the phase.

**Full entry:** history/learnings/20260508-desktop-queue-proof.md

## [20260508] User-Visible Adapters Need Real Boundary Tests
**Category:** failure
**Feature:** windows-desktop-downloader-ui
**Tags:** [testing, integration, review]

The batch import UI passed mocked tests while the production adapter still threw, creating a P1 review blocker. Any file picker, import/export, clipboard, shell, or browser adapter needs at least one direct production-boundary test or smoke path; UI mocks alone are not enough.

**Full entry:** history/learnings/20260508-desktop-queue-proof.md

## [20260508] Async Queue Runners Need Run Generation Tokens
**Category:** pattern
**Feature:** windows-desktop-downloader-ui
**Tags:** [batch-queue, async, reliability]

Review found stale async submit/poll continuations could mutate a rebuilt queue because row ids were reused and `active` could become true for a later run. Queue runners that support rebuild, stop, retry, or restart must carry a run generation token through every async continuation and ignore stale tokens.

**Full entry:** history/learnings/20260508-desktop-queue-proof.md

## [20260509] Generation-Gated Runtime Config
**Category:** pattern
**Feature:** windows-desktop-downloader-ui
**Tags:** [desktop, runtime-config, backend-lifecycle]

For a managed desktop backend, writing config is not enough. If settings, cookies, output paths, or options change, every submit path must wait until the backend is healthy for the current config generation; otherwise jobs can silently run against stale config.

**Full entry:** history/learnings/20260509-desktop-runtime-contracts.md

## [20260509] Failure Classifiers Need Negative Contract Tests
**Category:** failure
**Feature:** windows-desktop-downloader-ui
**Tags:** [testing, error-classification, adapter-boundary]

Review found broad diagnostic-text matching could mislabel ambiguous runtime failures as missing runtime and send users into the wrong recovery path. Any classifier that drives user-facing guidance needs positive, negative, ambiguous, and low-level spawn-error tests before it is trusted.

**Full entry:** history/learnings/20260509-desktop-runtime-contracts.md

## [20260509] Portable Packaging Is Its Own Gate
**Category:** decision
**Feature:** windows-desktop-downloader-ui
**Tags:** [packaging, tauri, sidecar, uat]

Dev runtime proof and production distribution proof are separate evidence surfaces. Do not mark a portable desktop release complete from `tauri dev`, source builds, or unit tests; the release phase must prove an unpacked folder with the desktop exe, backend sidecar, config, cookies, logs, history, restart behavior, and UAT together.

**Full entry:** history/learnings/20260509-desktop-runtime-contracts.md
