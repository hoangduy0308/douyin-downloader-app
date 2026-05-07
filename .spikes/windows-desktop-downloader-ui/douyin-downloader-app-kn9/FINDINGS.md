# Spike Findings: Tauri Backend Lifecycle

**Question:** Can Phase 1 use Tauri to manage backend sidecar lifecycle for dev and packaged-compatible runtime?

**Answer:** YES.

## Evidence

- Backend server contract exists: `GET /api/v1/health`, `POST /api/v1/download`, `GET /api/v1/jobs/{job_id}`, and `GET /api/v1/jobs` in `F:\Work\DouyinDownload\douyin-downloader\server\app.py`.
- Backend CLI serve entrypoint exists through `run.py` -> `cli.main:main()` with `--serve`, `--serve-host`, and `--serve-port`.
- `python -m pytest tests/test_server.py -q` passed: 9 tests.
- Tauri v2 docs support sidecars via `bundle.externalBin`, `@tauri-apps/plugin-shell`, and shell capabilities scoped to allowed sidecar execution.

## Constraints

- Readiness must be based on `GET /api/v1/health`, not process existence.
- Dev mode may spawn the sibling backend with `python run.py --serve --serve-host 127.0.0.1 --serve-port <port> --config <managed-config> --path <absolute-output-folder>`.
- Packaged mode should be designed around a sidecar binary such as `src-tauri/binaries/douyin-backend-x86_64-pc-windows-msvc.exe`.
- Tauri shell permissions must scope execution to the backend sidecar and validated args; do not expose generic shell execution.
- If output folder/config changes after backend startup, Phase 1 must restart the backend before submit or keep submit blocked until the current config version is ready.

## Bead Guidance

- `douyin-downloader-app-irx.2`: implement a backend controller with `starting`, `ready`, `error`, and `stopped`; capture stdout/stderr diagnostics; clean up on app exit.
- `douyin-downloader-app-irx.7`: UAT must prove desktop launch, backend start, health readiness, submit, poll, terminal state, and cleanup. A dev Python backend is enough for Phase 1; final PyInstaller sidecar proof remains Phase 4.
