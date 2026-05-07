# Discovery Report: Windows Desktop Downloader UI

**Date**: 2026-05-08
**Feature**: windows-desktop-downloader-ui
**CONTEXT.md reference**: `history/windows-desktop-downloader-ui/CONTEXT.md`

---

## Institutional Learnings

### Critical Patterns (Always Applied)

- None available in this repo. `history/learnings/critical-patterns.md` does not exist.

### Domain-Specific Learnings

No prior learnings for this domain. `history/learnings/` does not exist.

---

## Discovery Method

GKG readiness reported `supported_repo = false`; this repo is outside GKG's supported language set, so planning used `srcwalk` plus focused file inspection instead of GKG architecture tools.

The app wrapper repo currently contains Khuym workflow scaffolding only. The downloader implementation lives in the sibling backend repo:

- App wrapper: `F:\Work\DouyinDownload\douyin-downloader-app`
- Downloader backend: `F:\Work\DouyinDownload\douyin-downloader`

---

## Agent A: Architecture Snapshot

### Relevant Packages / Modules

| Package/Module | Purpose | Key Files |
|----------------|---------|-----------|
| App wrapper repo | New desktop app home. Currently no implemented UI app exists. | `AGENTS.md`, `.khuym/state.json`, `history/windows-desktop-downloader-ui/CONTEXT.md` |
| REST API server | Existing local HTTP job API. It can submit one URL, return a job id, and expose job status/list endpoints. | `F:\Work\DouyinDownload\douyin-downloader\server\app.py`, `server\jobs.py` |
| CLI entrypoint | Existing command-line orchestration for config loading, URL looping, database setup, progress display, and notifications. | `F:\Work\DouyinDownload\douyin-downloader\cli\main.py` |
| Downloader core | URL parsing and dispatch to video, gallery, user, collection, music, and live downloaders. | `core\url_parser.py`, `core\downloader_factory.py`, `core\user_downloader.py` |
| Config and cookies | Existing config file, cookie parsing, automatic cookie loading, and Playwright-based cookie capture. | `config\config_loader.py`, `config.example.yml`, `tools\cookie_fetcher.py` |
| Storage | SQLite dedup/history exists for CLI mode, but not for current server mode. | `storage\database.py` |
| Tests | Good public-behavior tests exist for server, CLI, config, cookie fetcher, and downloader behavior. | `tests\test_server.py`, `tests\test_cli_main.py`, `tests\test_cookie_fetcher.py` |

### Entry Points

- **Desktop app entry point to create**: Tauri app in this repo, opened as a Windows desktop application.
- **Backend process entry point to manage**: package the Python downloader backend as a sidecar process and launch it in REST server mode.
- **Existing server API**:
  - `GET /api/v1/health`
  - `POST /api/v1/download`
  - `GET /api/v1/jobs/{job_id}`
  - `GET /api/v1/jobs`
- **Existing CLI serve command**: `python run.py --serve --serve-port 8000`

### Key Files to Model After

- `F:\Work\DouyinDownload\douyin-downloader\tests\test_server.py` - public HTTP behavior tests for job lifecycle without touching real Douyin.
- `F:\Work\DouyinDownload\douyin-downloader\tests\test_cli_main.py` - shows how CLI behavior is tested by faking API/downloader boundaries.
- `F:\Work\DouyinDownload\douyin-downloader\tests\test_cookie_fetcher.py` - shows cookie-fetcher behavior can be tested without launching real browsers for every case.
- `F:\Work\DouyinDownload\douyin-downloader\cli\main.py` - complete CLI orchestration, including config update, cookie manager, database, URL loop, and notifications.

---

## Agent B: Pattern Search

### Similar Existing Implementations

| Feature/Component | Location | Pattern Used | Reusable? |
|-------------------|----------|--------------|-----------|
| Single URL job API | `server\app.py` | POST returns job id immediately, UI/client polls job state. | Yes, for Phase 1 and as the backend contract shape. |
| In-memory job manager | `server\jobs.py` | Async background task, terminal status, counts, TTL pruning. | Partly. It is not enough for persisted history or pause/resume. |
| CLI multi-URL loop | `cli\main.py` | Reads URL list from config/CLI, processes each URL, aggregates totals. | Yes, as behavior reference for app-side batch orchestration. |
| SQLite history | `storage\database.py` | `download_history` table records URL, time, counts, config. | Partly. The desktop app needs a UI-facing history with status/result path. |
| Cookie capture | `tools\cookie_fetcher.py` | Playwright opens Douyin, user logs in, cookies are written to config. | Yes, but UI must replace terminal "press Enter" with app-owned flow/state. |

### Reusable Utilities

- **URL support**: `core\url_parser.py` already supports `video`, `gallery`, `user`, `collection`, `music`, and `live`; Phase 1 should expose only D17 in-scope modes in UI.
- **Downloader dispatch**: `core\downloader_factory.py` maps URL type to downloader class and should remain the backend dispatch point.
- **Config**: `config\config_loader.py` already supports path, mode, number, increase, proxy, database, progress, transcript, comments, live, server, and cookies.
- **Cookie sanitization**: `utils\cookie_utils.py` is used by `ConfigLoader` and `cookie_fetcher`; do not duplicate cookie filtering in the UI layer.
- **Server tests**: current server tests isolate job behavior from Douyin network calls, which is the right pattern for app-facing API changes.

### Naming Conventions

- Python tests live under `F:\Work\DouyinDownload\douyin-downloader\tests\test_*.py`.
- Backend modules use lower_snake_case Python files and public class/function names already in place.
- New frontend code should use TypeScript/React conventions in the app wrapper repo, while backend changes stay in the Python repo.

---

## Agent C: Constraints Analysis

### Runtime & Framework

- **Backend language**: Python `>=3.8` from `pyproject.toml`.
- **Backend optional server dependencies**: `fastapi`, `uvicorn`, `pydantic` under the `server` extra.
- **Backend optional browser dependencies**: `playwright` under the `browser` extra.
- **Backend tests**: `python -m pytest -q` or `pytest -q`.
- **App wrapper status**: no frontend/package files exist yet; the desktop stack can be selected now.

### Existing Dependencies Relevant to This Feature

| Package | Version Constraint | Purpose |
|---------|--------------------|---------|
| `fastapi` | `>=0.100` | Existing REST app. |
| `uvicorn` | `>=0.23` | Server runtime for REST app. |
| `pydantic` | `>=2.0` | Existing request/response models. |
| `aiosqlite` | `>=0.19.0` | Existing SQLite storage. |
| `playwright` | `>=1.40.0` | Existing automatic cookie capture/browser fallback path. |
| `rich` | `>=13.7.0` | CLI progress display; not suitable as main desktop progress surface. |

### New Dependencies Needed

| Package / Tool | Reason | Risk Level |
|----------------|--------|------------|
| Tauri v2 + React + TypeScript + Vite | Windows desktop app shell that is not a browser tab and can run a managed backend sidecar. | HIGH - new app stack and Rust/Node build toolchain. |
| `@tauri-apps/plugin-shell` | Launch and monitor sidecar backend process. | HIGH - process lifecycle is critical to D15. |
| PyInstaller | Package Python backend into a portable Windows sidecar executable/folder. | HIGH - packaging, data files, Playwright browsers, and runtime paths are failure-prone. |
| Frontend persistence store | Save output folder preference, queue metadata, and basic history. Could start as app-local JSON/SQLite through Tauri commands. | MEDIUM - local-only data but must survive launches. |

### Build / Quality Requirements

Backend side must keep passing:

```powershell
cd F:\Work\DouyinDownload\douyin-downloader
python -m pytest -q
```

App side should add and keep passing, once scaffolded:

```powershell
cd F:\Work\DouyinDownload\douyin-downloader-app
npm run test
npm run build
npm run tauri build
```

Final portable proof should include running the built Windows app from an unpacked folder, not only dev server proof.

### Database / Storage

- Existing backend SQLite dedup/history lives in `storage\database.py`.
- Existing REST server deliberately passes `database=None` in `server\app.py`, so current server mode does not record CLI-style history and does not use DB dedup through the downloader objects.
- D12 requires app-visible persisted history: URL, time, status, last output folder/result location. That should be owned by the desktop app or by a new app-specific backend endpoint, not assumed from `JobManager`.
- D10 output folder preference should live in app settings and be written into the managed backend config before job submission.

---

## Agent D: External Research

### Library Documentation

| Library / Tool | Key Docs | Planning Impact |
|----------------|----------|-----------------|
| Tauri v2 sidecars | https://v2.tauri.app/develop/sidecar/ | Tauri supports bundling external binaries through `externalBin` and running them through shell sidecar APIs. |
| Tauri shell plugin | https://v2.tauri.app/reference/javascript/shell/ | JS can create/spawn sidecar commands and receive child process handles/events, which is the right shape for D15 backend lifecycle. |
| Tauri resources | https://v2.tauri.app/develop/resources/ | Extra resources can be included in `bundle.resources`, useful for default config/templates and bundled backend assets. |
| PyInstaller spec files | https://pyinstaller.org/en/v6.12.0/spec-files.html | Onedir packaging and explicit `datas`/`binaries` handling matter because config/templates/browser assets cannot be treated as mutable files inside onefile temp extraction. |

### Known Gotchas / Anti-Patterns

- **Gotcha: Tauri sidecar execution requires explicit capabilities.**
  - Why it matters: a dev build can appear to work while production shell permissions block sidecar execution.
  - How to avoid: include sidecar commands in Tauri capabilities and prove them in a packaged build.

- **Gotcha: PyInstaller onefile is a bad default for mutable config and large runtime assets.**
  - Why it matters: PyInstaller onefile extracts bundled files into a temporary folder and changes to those bundled files are lost when the process exits.
  - How to avoid: use a one-folder backend sidecar layout and put mutable app config/history under app data or the chosen portable data folder.

- **Anti-pattern: treating the app as a browser UI over localhost.**
  - Common mistake: build a web app and ask the user to open `localhost`.
  - Correct approach: use a desktop shell that internally talks to a managed local backend process while the user only launches the Windows app.

- **Anti-pattern: claiming batch is done by sending one multiline request.**
  - Common mistake: loop through URLs but expose no per-job state, pause/resume, retry, import, or queue management.
  - Correct approach: make the desktop app own a visible queue model and map queue items to backend jobs, then add backend support only where app-side orchestration is insufficient.

---

## Open Questions

- [ ] Whether Phase 1 should package the backend sidecar immediately or first prove sidecar lifecycle against `python run.py --serve` in dev, then package in a later phase. The phase plan recommends proving lifecycle early and portable packaging at the end.
- [ ] Whether persisted app history should be app-local JSON/SQLite through Tauri commands or a new backend API backed by SQLite. The approach recommends app-owned history first because current server jobs are intentionally in-memory.
- [ ] Whether pause/resume can be truthful at the queue level only. Existing backend jobs have no cancellation/pause API, so active-job pause/resume needs either a backend enhancement or clear semantics: pause prevents future queued starts, retry resubmits failed/completed items.
- [ ] How much of Playwright browser installation can be bundled reliably in the portable zip. Validating should spike this before implementation commits to final packaging details.

---

## Summary for Synthesis (Phase 2 Input)

**What we have**: A mature Python downloader with CLI orchestration, config/cookie handling, SQLite history in CLI mode, and a small FastAPI server that supports single-URL async jobs with polling.

**What we need**: A Windows desktop app wrapper that launches/manages the backend, exposes single and batch workflows equally, stores app preferences/history, provides user-facing cookie/error recovery, and ships as a portable unzip-and-run folder.

**Key constraints from research**:

- Current server mode is single-job, in-memory, and does not use backend SQLite history.
- Batch UI must be more than multiline input: import file, queue state, pause/resume semantics, retry per job, counts, and result actions are locked by D8.
- Automatic cookie fetch exists but is terminal-oriented and must become an app-owned recovery flow.
- Tauri sidecar and PyInstaller packaging are both HIGH-risk until validated in a packaged Windows build.

**Institutional warnings to honor**:

- No repo-specific institutional learnings were available.
