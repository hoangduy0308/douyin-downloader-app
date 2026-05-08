# Spike Findings: Pause Resume Truthfulness

**Question:** Can pause/resume be truthful without active-job cancel support in backend?

**Answer:** YES.

## Evidence

- `phase-2-contract.md` explicitly states pause means "prevent future starts" while active jobs continue to terminal state.
- Story 3 + bead `.12` already binds acceptance to this exact behavior and test coverage.
- No cycle/ordering conflict blocks this: dependency graph keeps controls after execution wiring.

## Constraints

- UI copy must explicitly avoid implying active cancellation.
- Pause button state must only gate scheduler dispatch of waiting rows.
- Resume must only restart waiting rows; running rows remain polled until terminal state.
