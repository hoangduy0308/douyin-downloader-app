# Learnings Candidates - Reviewer 5 Synthesis

Date: 2026-05-09
Role: learnings-synthesizer
Scope:
- `.khuym/findings/review-input/diff.patch`
- `.khuym/findings/review-input/CONTEXT.md`
- `.khuym/findings/review-input/approach.md`
- `history/learnings/critical-patterns.md`
- `history/learnings/20260508-desktop-queue-proof.md`
- Reviewer outputs: code-quality, architecture, security, test-coverage

## Deduplicated Findings

Raw input count: 8 findings

Unique synthesized findings: 3
- P2: 2
- P3: 1
- P1: 0

### F1 (P2) - Missing-runtime classification is fragile and under-validated
Merged from:
- code-quality: broad missing-runtime classifier can mislabel real failures
- architecture: failure classification tightly coupled to fragile log-text matching
- test-coverage: spawn-error missing-runtime branch untested
- test-coverage: no negative tests for runtime-detection heuristics

### F2 (P2) - Cross-layer contract regression after removing renderer cookie contract
Merged from:
- architecture: abrupt response contract change removing `cookies` field
- test-coverage: cross-layer contract gap after removing renderer-side cookie validation

### F3 (P3) - Type safety weakened in tests via cast escape
Merged from:
- code-quality: test double-cast weakens type safety
- test-coverage: type-escape in test

## Known-Pattern Matches

- Match: `User-Visible Adapters Need Real Boundary Tests` (critical-patterns + 20260508 learning).
  - Applies to F1 and F2: runtime/failure classification and renderer/native response contracts are adapter boundaries that need direct boundary proof, not only happy-path mocks.

- Match: `Keep Fake Proof Explicitly Scoped` (20260508 learning).
  - Applies to F1: current tests do not sufficiently prove degraded classifier paths (negative heuristics and spawn-error branch).

- No direct match:
  - F3 is a test-hygiene/type-discipline issue and does not map cleanly to current promoted critical patterns.

## Candidate Learnings (1-3)

### 1) Failure Classifiers Need Negative Contract Tests
Category: failure
Severity: critical
Tags: runtime-classification, adapter-boundary, testing

If error classification depends on log/diagnostic text, add explicit negative and ambiguous-case tests plus spawn-failure-path coverage; otherwise graceful statuses can mask real failures.

### 2) Response Contract Changes Need Cross-Layer Compatibility Gates
Category: decision
Severity: standard
Tags: api-contract, renderer-backend, regression

When removing or reshaping renderer-facing fields, gate the change with a documented contract decision and cross-layer tests proving behavior is still truthful end-to-end.

### 3) Keep Test Fixtures Type-Safe At Boundaries
Category: pattern
Severity: standard
Tags: test-quality, typescript, maintainability

Avoid `as unknown as ...` in behavior tests for cross-layer payloads; prefer typed fixtures/builders so contract drift is caught by compile-time checks.

## Merge Recommendation

PROCEED WITH FIXES
