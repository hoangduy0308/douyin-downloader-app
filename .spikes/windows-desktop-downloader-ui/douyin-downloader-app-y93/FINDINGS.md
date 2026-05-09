# Spike Findings: Phase 3 App-Triggered Cookie Capture Boundary

**Bead:** `douyin-downloader-app-y93`
**Question:** Can Phase 3 app-trigger cookie capture without terminal Enter, and what exact success/cancel/failure signals should implementation rely on?

## Answer

YES, with constraints.

Phase 3 can provide an app-triggered cookie capture flow without asking the user to press Enter in a terminal. The current backend utility is terminal-oriented only because `tools/cookie_fetcher.py` waits on `input()` after opening the Playwright browser. A Tauri command can spawn that Python process with piped stdin, show app-owned guidance while the browser is open, and write a newline to the child stdin when the user clicks an app button such as "I am logged in".

Execution must not treat the current utility's zero exit code or `[INFO] Saved ...` stdout line as sufficient success. The script returns `0` even when required cookie keys are missing, after writing a partial cookie file and printing `[WARN] Missing required cookie keys: ...`. The app should rely on validated cookie/config state changes, not log text alone.

## Evidence

- `F:\Work\DouyinDownload\douyin-downloader\tools\cookie_fetcher.py` accepts `--output`, `--config`, `--browser`, `--headless`, and `--include-all`, opens a visible Playwright browser by default, then prints terminal instructions.
- `capture_cookies()` writes the browser storage cookies to `args.output`, optionally writes `existing["cookies"] = cookies` into `args.config`, and returns `0`.
- `wait_for_login_confirmation(page, url, input_func=input)` starts page navigation in the background and then awaits `asyncio.to_thread(input_func)`. The terminal dependency is therefore injectable stdin/input behavior, not a hard dependency on an interactive console.
- `tests/test_cookie_fetcher.py::test_wait_for_login_confirmation_returns_without_waiting_navigation` proves `wait_for_login_confirmation()` can complete when `input_func` returns immediately, without waiting for terminal navigation to finish.
- `cookie_fetcher.py` only returns `1` for missing Playwright import. Other Playwright/browser exceptions can propagate out of `asyncio.run(capture_cookies(args))` and become non-zero process failures with stderr/traceback.
- `cookie_fetcher.py` defines required keys as `msToken`, `ttwid`, `odin_tt`, and `passport_csrf_token`, but missing required keys only produce a warning, not a failing exit code.
- The current Tauri backend process pattern in `src-tauri/src/backend.rs` already uses `std::process::Command`, captures stdout/stderr into diagnostics, keeps child process state, and kills/waits the child on stop.
- The current Tauri command surface in `src-tauri/src/main.rs` exposes app-owned commands through `tauri::generate_handler!`, and `src/services/tauriBackendRuntime.ts` invokes them through `@tauri-apps/api/core`.
- `history/windows-desktop-downloader-ui/phase-3-contract.md` requires cookie fetch/import success to update app-used cookie/config state, cancel/failure/missing Playwright to stay friendly in the main UI, and raw details to live in Logs.
- `F:\Work\DouyinDownload\douyin-downloader\pyproject.toml` declares Playwright only under the optional `browser` extra, and `requirements.txt` does not install it. Phase 3 may validate the dev-runtime path, but final portable Playwright/browser packaging proof remains a Phase 4 constraint.

## Required Implementation Shape

- Add an app-owned cookie capture boundary, preferably a Tauri command/service separate from backend lifecycle. Reuse the existing `Command`/diagnostics/process-state pattern, but do not mix cookie-capture child state with the long-running managed backend child.
- Spawn the cookie fetcher from the sibling backend in dev mode with a command equivalent to `python -m tools.cookie_fetcher --output <temp-or-app-cookie-json> --browser chromium`. Use app-owned writable paths, not backend repo defaults.
- Pipe stdin for the cookie child. When the user confirms in the app that login is complete, write a newline to the child stdin and close/flush it. The user should never need to find a terminal or press Enter there.
- Pipe stdout/stderr into the Phase 3 Logs surface. Do not stream raw cookie fetcher output into the Single/Batch main workflow.
- Prefer a two-step commit: write the fetcher output to a temp/app cookie JSON, validate it, then update the managed config/cookie state used by the backend. Avoid using `--config` as the only success path because it can write partial cookies before validation.
- If implementation does use `--config`, it must snapshot or version the config before capture and verify that the final sanitized cookie state changed and contains the required keys before reporting success.
- After a successful cookie commit, mark backend config/readiness stale and restart or block submit until the managed backend has confirmed readiness against the updated config.

## Exact Signals To Use

### Success

Treat cookie capture as successful only when all of these are true:

- The cookie child process exits normally with code `0`.
- The app observes a concrete cookie-state change: the expected output JSON exists and has a newer write/version than the pre-capture state, or the managed config cookie section changed from a captured pre-state.
- The final parsed cookie object is a dictionary after the same sanitization rules used by the backend.
- The final cookie object contains all required keys from `cookie_fetcher.py`: `msToken`, `ttwid`, `odin_tt`, and `passport_csrf_token`.
- The validated cookies are committed to the app-used managed config/cookie path, not only to `config/cookies.json` under the sibling backend repo.
- A follow-up backend readiness step either restarts the managed backend or blocks job submission until the backend is ready with the updated config.

Do not use these as standalone success signals: stdout containing `[INFO] Saved`, stdout containing `[INFO] Updated config file`, process exit code `0`, or the presence of any cookie file.

### Cancel

Treat cookie capture as canceled only when all of these are true:

- The user explicitly cancels the app cookie-capture flow, or the app closes the capture UI before login confirmation.
- The cookie child was still running at cancel time and the app killed/waited it using the same style as the existing managed-backend cleanup.
- No validated cookie commit was made after the capture started.

If the child already exited before the cancel action is processed, classify by the final process result and validated cookie state instead of forcing `canceled`.

### Failure

Treat cookie capture as failed when any of these happen:

- The child process exits non-zero or fails to spawn.
- Playwright is not importable, shown today by the utility's `[ERROR] Playwright is not installed...` path and exit code `1`.
- The browser engine or browser executable is missing, fails to launch, or exits with a propagated Playwright error.
- The output JSON is absent, invalid JSON, not an object, unchanged from pre-capture state, or contains no sanitized cookies.
- The captured cookies are partial and missing any of `msToken`, `ttwid`, `odin_tt`, or `passport_csrf_token`, even if the child exit code is `0`.
- Writing the validated cookies to the app-owned managed cookie/config path fails.
- The backend cannot be restarted or cannot reach readiness after a cookie commit, if the app is about to allow retry against the updated cookies.

Main UI failure text should be friendly and actionable. Raw stdout/stderr, traceback, missing dependency detail, and missing-key lists should be retained in Logs.

## Constraints

- This spike validates the Phase 3 app-triggered development/runtime boundary. It does not prove Phase 4 portable packaging of Playwright browsers.
- Phase 3 should keep manual/import cookie fallback because Playwright is optional and may be unavailable on a user's machine.
- The app should not write to the sibling backend repo's default `config/cookies.json` or `config.yml` by default. Use an app-owned runtime path.
- A narrow wrapper around `tools.cookie_fetcher.py` is acceptable if it preserves the same extraction/filtering behavior and exposes better app-control semantics. A broad downloader-core rewrite is not needed.
- Cookie capture should be treated as a separate short-lived process with cancel support, not as a request to the already-running FastAPI backend.
- Tests should cover success, cancel, missing Playwright, non-zero child exit, zero-exit-with-missing-required-keys, invalid output JSON, and config commit failure without live Douyin network dependency.

## Files Read

- `AGENTS.md`
- `.khuym/state.json`
- `history/windows-desktop-downloader-ui/CONTEXT.md`
- `history/learnings/critical-patterns.md`
- `history/windows-desktop-downloader-ui/phase-3-contract.md`
- `history/windows-desktop-downloader-ui/phase-3-story-map.md`
- `history/windows-desktop-downloader-ui/phase-plan.md`
- `src-tauri/src/backend.rs`
- `src-tauri/src/main.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src/services/tauriBackendRuntime.ts`
- `src/services/backendLifecycle.ts`
- `src/tests/backend-lifecycle.test.ts`
- `src/tests/app-shell.test.tsx`
- `package.json`
- `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-1t5/FINDINGS.md`
- `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-2to/FINDINGS.md`
- `F:\Work\DouyinDownload\douyin-downloader\AGENTS.md`
- `F:\Work\DouyinDownload\douyin-downloader\tools\AGENTS.md`
- `F:\Work\DouyinDownload\douyin-downloader\tools\cookie_fetcher.py`
- `F:\Work\DouyinDownload\douyin-downloader\tests\test_cookie_fetcher.py`
- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py`
- `F:\Work\DouyinDownload\douyin-downloader\config.example.yml`
- `F:\Work\DouyinDownload\douyin-downloader\tests\test_config_loader.py`
- `F:\Work\DouyinDownload\douyin-downloader\README.md`
- `F:\Work\DouyinDownload\douyin-downloader\requirements.txt`
- `F:\Work\DouyinDownload\douyin-downloader\pyproject.toml`

## Closing Judgment

YES. Phase 3 can offer app-triggered cookie capture without terminal Enter by controlling the cookie fetcher process stdin from a Tauri command. The implementation must classify outcomes from process state plus validated cookie/config state, not from stdout or exit code alone.
