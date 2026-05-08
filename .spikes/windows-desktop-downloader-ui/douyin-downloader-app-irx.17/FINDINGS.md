# Spike Findings: Retry Idempotence

**Question:** Can retry for failed/skipped rows be implemented without duplicate in-flight submissions?

**Answer:** YES.

## Evidence

- Bead `.10` already requires guardrails against duplicate in-flight submissions.
- Bead `.12` narrows retry eligibility to failed/skipped rows that are not currently running.
- Story order ensures retry control is built only after runner state + row terminal state are available.

## Constraints

- Retry action must check row eligibility before submit.
- Retry should reset only selected eligible rows to `waiting`; never mutate running rows.
- Aggregate counts must be recomputed from row state after retry transitions.
