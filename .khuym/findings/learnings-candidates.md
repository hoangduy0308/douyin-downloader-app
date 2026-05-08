# Learnings Candidates: windows-desktop-downloader-ui

Source: Agent 5 learnings synthesis during `khuym:reviewing`.

## Candidate 1: Adapter boundaries need real-runtime proof, not mocked happy paths

- Pattern: UI tests mocked `readImportedBatchText()` as successful while the real adapter always throws.
- Why it matters: A public workflow can look complete in React tests while the runtime boundary is still a stub.
- Suggested compounding entry: When a feature exposes an adapter-backed user action, require one test or runtime proof that exercises the production adapter path, plus a clear fallback/error-state test if the adapter is intentionally deferred.
- Related findings collapsed: code-quality P2 import adapter always throws; architecture duplicate P2 import stub; test-coverage P1 import-file workflow mocked successful while real adapter always fails.

## Candidate 2: Async queue runners need generation tokens for stop/restart safety

- Pattern: Queue work can continue resolving after a stop/rebuild/start cycle and mutate the newer queue.
- Why it matters: Batch download state is long-lived and async; stale submissions or polls can corrupt a user's current queue after they rebuild or restart.
- Suggested compounding entry: For app-owned async runners, use a queue generation/run id and check it after every awaited submit, poll, timer callback, and retry transition before mutating row state.
- Related findings collapsed: code-quality P2 stale async queue submissions can mutate newer queue; test-coverage P2 no stale async stop/restart regression.

## Candidate 3: Batch semantics must remain row-level unless the contract explicitly says bulk

- Pattern: Retry is exposed as "Retry failed" but implemented as a bulk retry over all eligible rows; row failures also show generic guidance rather than the actual row error in the table.
- Why it matters: D8 calls for detailed queue management and per-job retry; bulk-only controls and hidden row errors make recovery imprecise for power users.
- Suggested compounding entry: For batch queues, acceptance criteria should separate queue-level actions from row-level actions, and tests should assert the visible per-row failure reason and per-row retry affordance.
- Related findings collapsed: architecture P2 retry is bulk-only not per-job; code-quality P2 failed batch rows hide actual errors.

## Candidate 4: UI-owned terminal state is not enough when a locked decision requires persistence

- Pattern: Batch completion is derived from in-memory row state, but D12 requires persisted basic history across launches.
- Why it matters: A batch can finish correctly in the current session and still lose URL/time/status/output history when the app restarts.
- Suggested compounding entry: When a locked decision says "persist", review gates must verify the durable store and restart path, not only the current React state or a hidden diagnostics cache.
- Related findings collapsed: architecture P2 batch terminal state only in memory/no D12 persistence.

## Candidate 5: URL allowlists must validate protocol and host together

- Pattern: Batch URL validation recognizes supported Douyin hosts but allows non-http schemes on those hosts.
- Why it matters: A downloader queue should only submit expected web URLs; accepting alternate schemes at validation time widens the attack and misrouting surface before the backend sees the job.
- Suggested compounding entry: For URL allowlists, validate parsed protocol, hostname, normalization output, and submission payload together, with negative tests for non-http schemes on otherwise supported hosts.
- Related findings collapsed: security P2 batch URL validation allows non-http schemes for supported hosts.

## Duplicate Collapse Recommendation

- Collapse the import-adapter findings into one surviving review issue: "Import URLs workflow is stubbed in production but mocked as successful in tests." Keep test-coverage P1 severity because the workflow is user-visible and the real adapter always fails.
- Collapse retry/error-display concerns only if the surviving issue explicitly covers both row-level retry semantics and row-level error visibility. Otherwise keep them separate because one is interaction contract and the other is diagnostic visibility.
- Keep async stale-run protection separate from retry and pause/resume findings; it is a state-corruption class with a distinct fix pattern.
- Keep D12 persistence separate from terminal-summary correctness; current-session completion is not the same as restart persistence.
- Keep URL protocol validation separate as a security follow-up, even if fixed in the same parser file as other queue parsing issues.

## Merge Recommendation

- Do not merge while the P1 import-file workflow mismatch remains open.
- After the P1 is fixed, the remaining P2 findings are reliability, architecture, persistence, and security follow-ups. They should be fixed before release of the Windows desktop batch feature, especially stale async mutation and URL scheme validation.
