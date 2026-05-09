# Spike: managed cookie config write path

**Bead:** `douyin-downloader-app-8a3`  
**Question:** Should captured/imported cookies be written into managed config YAML, a cookie file beside managed config, or both, so the app-managed backend actually uses them?

## Decision

**YES: write captured/imported cookies into the app-managed config YAML.**

**NO: do not rely on a cookie file beside the managed config by itself.** The backend only loads a cookie file when the YAML explicitly opts into auto-cookie loading with `cookies: auto` or `auto_cookie: true`.

**BOTH is optional, not required.** If execution chooses a file-backed cookie store, the managed YAML must still contain the pointer/flag (`cookies: auto` or `auto_cookie: true`) and the file must be written to one of `ConfigLoader`'s candidate paths. Otherwise the managed backend will not use it.

Recommended Phase 3 path: make the managed YAML the authoritative app-runtime config and serialize `cookies:` there alongside `path` and scoped advanced settings. A JSON cookie file can be kept only as an import/export/cache artifact, not as the runtime source of truth unless YAML is set to auto mode.

## Evidence

- App Tauri backend startup passes `--config <managed>` and `--path <absolute-output>` to the sibling backend:
  - `src-tauri/src/backend.rs:153-168`
- The sibling CLI loads `ConfigLoader(config_path)` only when the config file exists; in serve mode with a missing config file it falls back to defaults, then applies only `--path`:
  - `cli/main.py:134-150`
  - `cli/main.py:156-158`
- The server snapshots cookies once at startup when `_ServerDeps` is constructed:
  - `server/app.py:49-53`
  - `server/app.py:107-108`
- Download requests use that startup cookie snapshot via `deps.cookie_manager.get_cookies()`:
  - `server/app.py:72`
- `ConfigLoader.get_cookies()` uses:
  - `cookies:` or `cookie:` from YAML when present.
  - `cookies: auto` to load a cookie file.
  - `auto_cookie: true` to load a cookie file when no direct `cookies`/`cookie` is present.
  - Otherwise it returns `{}`.
  - Evidence: `config/config_loader.py:166-177`
- Auto-cookie file search paths are derived from the managed config directory, its parent, and backend cwd. For a managed config at `douyin-downloader-app/.runtime/managed-config.yml`, valid app-side candidates include:
  - `douyin-downloader-app/.runtime/config/cookies.json`
  - `douyin-downloader-app/.runtime/.cookies.json`
  - `douyin-downloader-app/config/cookies.json`
  - `douyin-downloader-app/.cookies.json`
  - plus backend-root candidates because `run.py` changes cwd to the backend root.
  - Evidence: `config/config_loader.py:196-224`, `run.py:5-9`
- The existing backend cookie fetcher already knows how to update YAML directly by setting `existing["cookies"] = cookies`:
  - `tools/cookie_fetcher.py:155-156`
  - `tools/cookie_fetcher.py:355-367`
- Backend docs recommend `python -m tools.cookie_fetcher --config config.yml` and say cookies are written to config automatically:
  - `README.md:90-96`

## Constraints For Execution

1. **Backend restart/readiness is required after cookie changes.** The running server does not re-read YAML or cookie files per request; `_ServerDeps` captures cookies during `build_app(config)`.

2. **A bare adjacent `cookies.json` is not enough.** If using file-backed cookies, write to `.runtime/.cookies.json` or `.runtime/config/cookies.json` and ensure managed YAML contains `cookies: auto` or `auto_cookie: true`.

3. **Do not let output-folder serialization erase cookies.** Current app settings serialization writes only:

   ```yaml
   path: <outputPath>
   ```

   and `RuntimeSettingsStore.initialize()` / `updateOutputPath()` overwrite the managed config contents. Phase 3 settings serialization must preserve or regenerate `cookies` plus all scoped advanced options whenever it rewrites YAML.

4. **The managed config file must exist before backend start.** If it is missing, serve mode uses defaults and only the command-line `--path` override is applied, so cookies in the intended managed config path are not available.

5. **Use one runtime authority.** Prefer managed YAML as the app runtime authority. If also writing a JSON cookie file, treat it as a cache/import artifact or make YAML explicitly point to it with auto mode; do not maintain two independent runtime sources that can drift.

## Files Read

- `AGENTS.md`
- `history/learnings/critical-patterns.md`
- `history/windows-desktop-downloader-ui/CONTEXT.md`
- `history/windows-desktop-downloader-ui/phase-3-contract.md`
- `history/windows-desktop-downloader-ui/phase-3-story-map.md`
- `src/services/settingsStore.ts`
- `src/services/backendLifecycle.ts`
- `src/services/tauriBackendRuntime.ts`
- `src/app/App.tsx`
- `src/tests/settings-store.test.ts`
- `src-tauri/src/backend.rs`
- `F:\Work\DouyinDownload\douyin-downloader\run.py`
- `F:\Work\DouyinDownload\douyin-downloader\cli\main.py`
- `F:\Work\DouyinDownload\douyin-downloader\server\app.py`
- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py`
- `F:\Work\DouyinDownload\douyin-downloader\config\default_config.py`
- `F:\Work\DouyinDownload\douyin-downloader\config.example.yml`
- `F:\Work\DouyinDownload\douyin-downloader\tools\cookie_fetcher.py`
- `F:\Work\DouyinDownload\douyin-downloader\tests\test_config_loader.py`
- `F:\Work\DouyinDownload\douyin-downloader\README.md`
