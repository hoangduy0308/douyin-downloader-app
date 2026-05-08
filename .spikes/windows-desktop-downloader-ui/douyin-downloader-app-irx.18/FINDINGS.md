# Spike Findings: Batch UI Density Risk

**Question:** Can the Phase 2 batch UI remain scan-friendly while adding queue controls and totals?

**Answer:** YES.

## Evidence

- `CONTEXT.md` D14 locks a restrained utility style; `phase-2-contract.md` repeats this as an explicit failure/pivot signal.
- Story decomposition isolates concerns so controls and summary are added in steps (`.9` -> `.11` -> `.12` -> `.13`) instead of one dense surface jump.
- Acceptance criteria in `.9` and `.13` explicitly require friendly status surface and non-dashboard density.

## Constraints

- Keep diagnostics/log detail out of the main batch surface (Phase 3 owns logs panel).
- Preserve Single/Batch equal-weight navigation without adding deep nested control stacks in one viewport.
- Verify UI tests assert presence/behavior of controls and summary, not verbose debug detail rendering.
