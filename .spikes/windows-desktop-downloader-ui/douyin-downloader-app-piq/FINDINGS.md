# Spike Findings: Output Folder And Config Handoff

**Question:** Can output folder and config handoff be done safely for one app-managed backend session?

**Answer:** YES, with constraints.

## Evidence

- `ConfigLoader` can load an explicit YAML config path and merge it with defaults and env overrides.
- `ConfigLoader.update()` changes config in memory only; it does not persist to disk.
- CLI serve path accepts `--config`, applies `--path`, then passes one `ConfigLoader` into the server.
- `run.py` changes the process working directory to the backend root, so relative `path: ./Downloaded/` would write under the backend/sidecar folder.
- `server.app._ServerDeps` is constructed once and captures `FileManager(config.get("path"))` at backend startup.
- `/api/v1/download` accepts only `{ "url": "..." }`; there is no request-level output folder/config contract.
- Local probe confirmed `build_app(ConfigLoader(None).update(path=<temp>))` uses the temp path as `app.state.deps.file_manager.base_path`.

## Constraints

- Use an app-owned runtime config path, not backend `config.yml`, `config.example.yml`, Tauri resources, or PyInstaller extraction resources.
- Write absolute `path:` values.
- Treat the selected output folder as downloader-managed: backend creates subfolders and may append manifests under it.
- Do not mutate backend config while jobs are running.
- If folder/config changes after backend readiness, stop/restart backend before submitting a job or block submit until backend readiness matches the current config version.

## Bead Guidance

- `douyin-downloader-app-irx.2`: generate config before backend start.
- `douyin-downloader-app-irx.3`: implement `settingsStore` plus `writeBackendSessionConfig()` using atomic temp-write then rename; tests must assert generated config is outside bundled/resource dirs and contains the selected absolute folder.
- `douyin-downloader-app-irx.4`: block submit unless backend readiness corresponds to the current config version.
- `douyin-downloader-app-irx.6`: open the selected output folder recorded in settings/config handoff; do not infer it from backend job data.
- `douyin-downloader-app-irx.7`: verify no Phase 1 path writes into backend repo config/resources.
