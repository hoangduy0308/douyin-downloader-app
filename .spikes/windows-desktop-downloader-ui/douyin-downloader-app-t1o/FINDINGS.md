# Spike Findings: Backend Config Handoff

**Bead:** `douyin-downloader-app-t1o`
**Question:** Can Phase 1 safely hand the selected output folder/config to the existing backend for one job without mutating bundled resources or corrupting user files?

## Answer

YES, with strict constraints.

Phase 1 can safely hand config to the existing backend for a single app-managed job when the app writes an app-owned runtime config with absolute paths before backend startup, starts the backend with that config, and submits the job only after health readiness matches the active config version.

This is not a request-level/per-job backend API today. An already-running backend captures config-dependent dependencies at startup, so changing the selected output folder after readiness requires a backend restart or submit must remain blocked.

## Evidence

- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py:21` loads defaults, then an explicit YAML config path when present, then `DOUYIN_*` env overrides. It only reads/merges config; it does not write back to backend config files.
- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py:153` has `ConfigLoader.update()`, which mutates the in-memory `config` dict only.
- `F:\Work\DouyinDownload\douyin-downloader\cli\main.py:149` applies `--path` with `config.update(path=args.path)`, and `cli\main.py:156` passes that same loader into serve mode.
- `F:\Work\DouyinDownload\douyin-downloader\cli\main.py:324` exposes `--config`, `--path`, `--serve`, `--serve-host`, and `--serve-port`, so a dev backend can be started with an app-owned config path and selected output path.
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py:49` constructs `_ServerDeps` once per app instance and creates `FileManager(config.get("path"))`. `server\app.py:143` accepts only `{ "url": "..." }` for `/api/v1/download`, so there is no per-request output folder/config field.
- `F:\Work\DouyinDownload\douyin-downloader\storage\file_manager.py:22` creates the configured base path and all generated subfolders under it. Downloads write to `*.tmp` first, then `os.replace()` the final generated file path.
- `F:\Work\DouyinDownload\douyin-downloader\run.py` changes the process working directory to the backend repo root, so relative paths like `./Downloaded/` would write under the backend/sidecar directory. Phase 1 must therefore use absolute output paths.
- Existing tests show the server can be built with an injected temp output path: `tests\test_server.py:56`, `tests\test_server.py:67`, and `tests\test_server.py:118` all use `ConfigLoader(None).update(path=str(tmp_path))` before `build_app(config)`.
- Validation command passed from the sibling backend repo: `python -m pytest tests/test_server.py tests/test_cli_main.py -q` -> `11 passed in 1.93s`.

## Constraints

- Generate the runtime config outside bundled resources, backend repo config files, Tauri resources, and PyInstaller extraction/resource directories.
- Use absolute output paths only. Do not rely on backend-relative defaults.
- Prefer an app-owned default folder such as `<app-data>/downloads`; if the user selects another folder, treat it as downloader-managed.
- Use atomic temp-write then rename for the app-owned runtime config file.
- Start the backend only after the runtime config exists and the selected output folder has been validated/created.
- Block submit until `/api/v1/health` is ready for the backend instance that was started with the current config version.
- If the output folder/config changes after backend readiness, stop/restart the backend before `POST /api/v1/download`, or keep submit disabled with an actionable state.
- Do not mutate `config.yml`, `config.example.yml`, backend source files, Tauri bundled resources, or packaged sidecar resources.
- Do not run multiple differently configured jobs through one backend instance unless the selected config is intentionally shared for that whole backend session.
- The selected output folder can receive generated downloader files and subfolders. Because `FileManager.download_file()` uses `os.replace()` for generated final paths, a colliding existing file at the same generated path inside the selected output tree may be overwritten. Avoid presenting arbitrary document folders as harmless storage; use an app-owned default and label user-selected folders as download destinations.
- Server mode does not enable the CLI SQLite `Database`, so Phase 1 must not rely on backend DB history for output-folder proof or app history.

## Bead Updates Needed

- `douyin-downloader-app-irx.2`: require backend lifecycle to accept a generated runtime config path plus absolute output folder before startup, and record config-version/readiness coupling in tests or smoke evidence.
- `douyin-downloader-app-irx.3`: keep the existing notes, but make the contract explicit: config handoff is startup/session scoped, not `/api/v1/download` scoped. Tests should prove generated config lives outside bundled/resource dirs and contains the selected absolute output folder.
- `douyin-downloader-app-irx.4`: keep submit blocked when backend readiness does not match the current settings/config version; restart backend or require the user to wait for restart after output-folder changes.
- `douyin-downloader-app-irx.6`: open the selected absolute output folder from app settings, not a backend-reported path, because current job responses do not include a result location.
- `douyin-downloader-app-irx.7`: add UAT proof that no runtime config/output writes occur in backend repo config/resources, and include a file-system evidence row for the generated runtime config path and selected output folder.
