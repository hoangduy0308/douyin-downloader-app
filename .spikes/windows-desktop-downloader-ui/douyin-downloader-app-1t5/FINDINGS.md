# Spike Findings: Phase 1 Architecture vs Portable Packaging

**Question:** Is the Phase 1 architecture compatible with later portable packaging, and what exactly must Phase 1 prove now versus defer to Phase 4?

**Answer:** YES, with constraints.

Phase 1 can proceed with the planned Tauri + React app and app-managed Python backend boundary. That architecture is compatible with a later portable unzip-and-run release if Phase 1 treats the backend runtime as an abstraction with two concrete modes: development Python process now, packaged sidecar binary later. Phase 1 must not bake in assumptions that only work from the sibling backend repo, mutable bundled resources, or a manually started terminal.

## Evidence

- `history/windows-desktop-downloader-ui/approach.md` chooses Tauri v2 + React + TypeScript and an app-managed Python backend sidecar over localhost browser UI or direct Python GUI integration. This preserves D1 and D15 while keeping a clear path to D16.
- `history/windows-desktop-downloader-ui/phase-plan.md` intentionally separates Phase 1 from Phase 4: Phase 1 proves desktop shell, managed backend startup, health, submit, poll, and one result action; Phase 4 proves the exact portable folder/zip, sidecar resources, config paths, browser/cookie runtime, restart behavior, and unpacked-folder UAT.
- `history/windows-desktop-downloader-ui/phase-1-contract.md` already calls out the packaging risk: Phase 1 must validate enough of the sidecar/config boundary to avoid an architecture that cannot become Phase 4 portable, but portable unzip-and-run proof is explicitly out of scope.
- Backend server shape is compatible with an app-managed process: `F:\Work\DouyinDownload\douyin-downloader\server\app.py` exposes `GET /api/v1/health`, `POST /api/v1/download`, `GET /api/v1/jobs/{job_id}`, and `GET /api/v1/jobs`.
- Backend serve mode exists: `run.py` delegates to `cli.main:main()`, and `cli/main.py` supports `--serve`, `--serve-host`, `--serve-port`, `--config`, and `--path`.
- Backend config handoff is startup-bound: `ConfigLoader` can load an explicit config path, `cli.main` applies `--path`, and `server.app._ServerDeps` captures `FileManager(config.get("path"))` when the server app is built. Therefore Phase 1 can use an app-owned runtime config before backend startup.
- Existing `JobManager` is in-memory, single-job-submit oriented, and TTL-capped. That is enough for Phase 1 single submit/poll proof but not enough for Phase 3 history or Phase 2 truthful batch semantics.
- Previous spike evidence in `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-onc/FINDINGS.md` proved PyInstaller onedir can serve `/api/v1/health` from an unpacked folder when using a server-only sidecar entrypoint. The same spike also found naive `run.py --serve` packaging is not production-ready because of backend path/import handling and Rich banner encoding under redirected stdout/stderr.
- Previous spike evidence in `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-kn9/FINDINGS.md` found Tauri sidecar lifecycle is viable if readiness is based on `/api/v1/health`, diagnostics are captured separately, and packaged mode uses scoped sidecar permissions rather than generic shell execution.
- Previous spike evidence in `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-piq/FINDINGS.md` found output folder/config handoff is safe for one app-managed backend session if the app writes an absolute-path runtime config outside bundled resources before backend startup.

## What Phase 1 Must Prove Now

- The desktop app opens as a real app window, not as a browser-localhost workflow.
- The app can start or attach to its managed backend without the user manually starting `python run.py --serve`.
- Backend readiness is determined by an actual `GET /api/v1/health` response, not just process existence.
- Backend lifecycle code is runtime-mode neutral: it can start dev Python now and later swap to a packaged sidecar binary without changing UI/business code.
- Backend stdout/stderr diagnostics are captured separately from the main download screen.
- The app writes an app-owned runtime config before backend start, with an absolute selected output folder, and does not mutate backend repo config files or bundled/package resources.
- Submit is blocked or the backend is restarted when the selected output folder/config changes after readiness, because `_ServerDeps` captures the file manager at server startup.
- A single in-scope URL can be submitted through `POST /api/v1/download`, polled through `GET /api/v1/jobs/{job_id}`, and rendered through terminal success/failure state with counts.
- The open-folder action targets the selected absolute output folder from app settings/config handoff, not inferred backend job metadata.
- Phase 1 UAT records exactly which backend mode was used, port, health response, cleanup behavior, config/output paths, and any packaging proof that was not exercised.

## What Phase 1 Must Defer To Phase 4

- Full portable zip/folder generation and final release layout.
- Running the production Tauri packaged app from an unpacked folder as the release artifact.
- Shipping the final PyInstaller sidecar binary in `src-tauri/binaries` with the final target triple naming and bundle config.
- Final proof that all Python server extras, dynamic imports, runtime DLLs/data, and backend resources are included in the sidecar folder.
- Final proof that Playwright/browser assets for cookie recovery work from the portable release. Cookie recovery itself is Phase 3, and its packaged runtime proof belongs with Phase 4.
- Final proof that app data, runtime config, logs, history, and downloads survive restart from the portable folder without writing into bundled resources or PyInstaller extraction paths.
- Final single + batch + cookie + restart/history UAT from the portable release artifact.

## Constraints

- Do not claim Phase 1 completes D16 portable distribution. It only preserves and partially validates the path to D16.
- Do not use `run.py` as the assumed production sidecar entrypoint without repairing the packaging issues found by the backend-packaging spike.
- Packaging should use a server-only sidecar entrypoint or an equivalent CLI path that avoids Rich banner/terminal output before server startup.
- Packaged backend builds must include server dependencies (`fastapi`, `uvicorn`, `pydantic`), not only `requirements.txt`.
- Tauri shell permissions must be scoped to the backend sidecar and validated args. No generic shell command surface.
- Runtime config must live in an app-owned writable location with absolute paths. Never write config into Tauri resources, PyInstaller extraction resources, `config.example.yml`, or the sibling backend repo's normal config by default.
- Output-folder/config changes require backend restart or submit blocking until the ready backend matches the current config version.
- Phase 1 tests and UAT must avoid requiring live Douyin network/cookies. Runtime integration can use fake/test backend paths for download completion, but backend lifecycle and health must be real.

## Bead Updates Needed

- `douyin-downloader-app-irx.2`: keep the current notes. They already require health-based readiness, diagnostics capture, cleanup, dev Python proof, and a packaged-sidecar abstraction point. Add no implementation requirement to build the final sidecar in Phase 1.
- `douyin-downloader-app-irx.3`: keep the current notes. They already require app-owned runtime config, absolute output path, atomic write, server extras awareness, and config-version readiness before submit.
- `douyin-downloader-app-irx.7`: keep the current notes, but reviewers should treat "packaged backend health possible through server-only entrypoint" as supporting evidence only. Phase 1 UAT must explicitly say portable distribution is not complete and list Phase 4 proof still missing.
- `douyin-downloader-app-1t5`: can be closed as YES after this findings file is reviewed. No implementation-file change is needed from this spike.
