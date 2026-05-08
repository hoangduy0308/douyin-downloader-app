# Spike Findings: Queue Semantics Over Single-Job API

**Question:** Is app-side orchestration over the existing single-job backend API sufficient for Phase 2 D8 batch semantics?

**Answer:** YES.

## Evidence

- `phase-2-contract.md` defines truthful scope: queue is app-owned and maps each row to existing `/api/v1/download` + `/api/v1/jobs/{job_id}`.
- `phase-2-story-map.md` decomposes this into parser/model (`.8`), runner (`.10`), UI wiring (`.11`), then controls (`.12`).
- Current bead contracts already enforce deterministic fake-client testing and forbid live-network dependency for Phase 2 execution.

## Constraints

- No claim of backend-native batch endpoint in Phase 2.
- Queue row states must stay explicit (`waiting/running/success/failed/skipped`) and drive totals directly.
- Any future backend batch API can be additive; Phase 2 should not block on it.
