# Spike Findings: Phase 1 Tauri Backend Lifecycle

**Question:** Can Phase 1 credibly implement app-managed backend lifecycle with a Tauri sidecar/dev process abstraction: start/attach backend, health-check `/api/v1/health`, capture stdout/stderr diagnostics, handle timeout/error, and clean up, without requiring user terminal startup?

**Answer:** YES, with a strict Phase 1 boundary.

Phase 1 can credibly implement the app-managed lifecycle in development by spawning the sibling Python backend from the desktop app and using the same controller abstraction that later points at a packaged sidecar. It should not claim final portable sidecar packaging is complete in Phase 1.

## Evidence

- The locked product decision requires this direction: D15 says the desktop app must start and manage the downloader backend in the background, so the phase contract correctly makes backend lifecycle the first structural proof.
- The Phase 1 contract explicitly scopes Story 1 to backend start or attach, `/api/v1/health` readiness, ready/error state, and diagnostics capture outside the main download surface.
- The sibling backend already exposes the exact readiness contract: `server/app.py` defines `GET /api/v1/health` returning `{ "status": "ok" }`.
- The sibling backend already has a process entrypoint for server mode: `run.py` delegates to `cli.main:main()`, and `cli/main.py` accepts `--serve`, `--serve-host`, `--serve-port`, `--config`, and `--path`.
- The serve command passes an existing `ConfigLoader` into `server.app.run_server(config, host, port)`, which starts Uvicorn with `build_app(config)`. This means the app can generate runtime config before spawning the backend.
- Backend server dependencies are already declared as optional extras in `pyproject.toml`: `fastapi`, `uvicorn`, and `pydantic` under `[project.optional-dependencies].server`.
- Existing server tests validate public HTTP behavior without real Douyin network calls: `tests/test_server.py` covers health, creating jobs, empty URL rejection, unknown job 404, shared deps, and JobManager pruning/TTL behavior.
- Prior spike evidence in `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-kn9/FINDINGS.md` found Tauri sidecar lifecycle direction credible and listed the right lifecycle states: `starting`, `ready`, `error`, and `stopped`.
- Prior spike evidence in `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-onc/FINDINGS.md` found backend packaging boundary feasible, but only with a server-only packaged sidecar entrypoint because the current CLI banner can fail under redirected Windows output.
- Tauri v2 documentation supports the required shape: sidecars are configured through `bundle.externalBin`, and the shell APIs can spawn commands and emit process output events. This is sufficient for a controller to capture stdout/stderr into diagnostics while polling HTTP health separately.

## Constraints

- Readiness must be based on successful `GET /api/v1/health`, not on process existence or a successful spawn event.
- The lifecycle controller must support two runtime adapters behind one interface:
  - dev Python runtime: spawn `python run.py --serve --serve-host 127.0.0.1 --serve-port <port> --config <managed-config> --path <absolute-output-folder>` from `F:\Work\DouyinDownload\douyin-downloader`;
  - packaged runtime: spawn a future scoped sidecar binary from Tauri `externalBin`.
- The happy path must not require a user-opened terminal. Attaching to an already-running backend may exist as a dev fallback, but it must not be the normal user flow.
- Tauri shell permissions must be narrowly scoped to the backend command/sidecar and known arguments. Do not expose generic shell execution.
- Stdout/stderr should be captured into a bounded diagnostics buffer or log store for the future Logs panel, not streamed into the main download UI.
- Timeout and error handling must distinguish at least:
  - spawn failure;
  - process exits before health is ready;
  - health timeout while process remains alive;
  - port conflict or wrong process on selected port;
  - backend stderr/output diagnostics available for support.
- Cleanup must terminate only the process the app started. If the app merely attached to an existing process, cleanup should detach and leave that process alone.
- If output folder/config changes after readiness, the app must either restart the managed backend with a new generated config or block submit until readiness matches the current config version. Current server deps capture `FileManager(config.get("path"))` at startup.
- Final PyInstaller/Tauri portable sidecar proof remains Phase 4 unless execution scope is expanded. Phase 1 should produce dev lifecycle proof and a packaged-compatible abstraction point, not a full unzip-and-run release claim.

## Bead Updates Needed

- `douyin-downloader-app-irx.2`: keep the bead as executable for Phase 1, but make the acceptance evidence explicit:
  - selected runtime mode (`dev-python` or `sidecar`);
  - selected host/port;
  - actual `/api/v1/health` response;
  - stdout/stderr diagnostics capture proof;
  - timeout/error proof using a fake or intentionally unavailable backend;
  - cleanup proof that the app-started process exits.
- `douyin-downloader-app-irx.2`: add a required test seam for `BackendRuntimeAdapter` or equivalent with fakes for spawn, output events, early exit, timeout, and kill/cleanup.
- `douyin-downloader-app-irx.2`: state that packaged sidecar execution is represented as an adapter/configuration point in Phase 1, while full packaged backend smoke remains Phase 4.
- `douyin-downloader-app-irx.3`: keep the existing config handoff constraint: generated config must be written before backend start, with absolute output paths and no mutation of backend repo config or bundled resources.
- `douyin-downloader-app-irx.7`: require UAT notes to include backend lifecycle evidence, not only UI/job evidence: launch desktop app, backend reaches health ready without terminal, diagnostics are available, and app exit cleans up the managed process.

## Closing Judgment

YES. Phase 1 can credibly implement app-managed backend lifecycle without requiring user terminal startup, provided it proves the dev Python process path now, keeps packaged sidecar work behind the same abstraction, and does not overclaim final portable packaging before Phase 4.
