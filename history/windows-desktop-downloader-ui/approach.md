# Approach: Windows Desktop Downloader UI

**Date**: 2026-05-08
**Feature**: windows-desktop-downloader-ui
**Based on**:
- `history/windows-desktop-downloader-ui/discovery.md`
- `history/windows-desktop-downloader-ui/CONTEXT.md`

---

## 1. Gap Analysis

| Component | Have | Need | Gap Size |
|-----------|------|------|----------|
| Desktop app shell | App wrapper repo has only Khuym scaffolding. | Windows desktop app that opens as its own application. | New - HIGH |
| Backend lifecycle | Existing `python run.py --serve` starts REST API manually. | Desktop app starts, health-checks, monitors, and stops backend without terminal. | New - HIGH |
| Single download | Existing `/api/v1/download` submits one URL and `/jobs` polls state. | Single mode UI with paste, start, progress counts, success/failure, open folder/result actions. | MEDIUM |
| Batch queue | CLI can loop URLs; REST API accepts one URL per job. | Full queue with import file, per-job state, pause/resume, retry, active URL/job, counts. | New - HIGH |
| Output folder preference | Backend config has `path`; CLI can override with `-p`. | App setting that remembers one default output folder across launches and writes it into backend config. | MEDIUM |
| Cookie fetching | `tools\cookie_fetcher.py` opens Playwright and waits for terminal Enter. | App-visible "fetch cookie again" flow with friendly guidance, timeout/failure state, and config update. | HIGH |
| Advanced controls | Backend config supports mode, number, increase, proxy, thread, quality-like asset toggles, database, comments/live/transcript. | Collapsed panel exposing only D17 in-scope core controls and hiding deferred modes. | MEDIUM |
| App history | CLI database records URL/time/count/config; server jobs are TTL/in-memory. | Basic persisted app history: URL, time, status, output/result location. | MEDIUM |
| Logs | Backend logs/CLI rich progress exist. | Separate Logs tab/panel for diagnostics without polluting main screen. | MEDIUM |
| Portable distribution | None in app wrapper. | Unzip folder and run `.exe`, with backend sidecar/resources included. | HIGH |

---

## 2. Recommended Approach

Build a Tauri v2 + React + TypeScript desktop app in `douyin-downloader-app`, and package the existing Python downloader as a managed sidecar backend process. The user opens one Windows application; internally the app starts the backend on loopback, waits for `/api/v1/health`, writes a managed config file, submits jobs over the existing REST shape, and polls job state. Extend the Python server only where current behavior cannot satisfy the locked UX: app-facing config refresh/cookie refresh hooks, truthful batch queue control, improved user-facing error metadata, and result/history data needed by the desktop UI.

### Why This Approach

- It honors D1 and D15: the user launches a desktop app, not a browser-localhost UI, and the app owns backend startup.
- It reuses the existing FastAPI job contract in `server\app.py` instead of bypassing the downloader through a new direct integration too early.
- It avoids rewriting the downloader core: URL parsing, downloader factory, config, cookies, and storage stay in the Python backend.
- It keeps batch ownership visible in the UI, where D8 requires queue management rather than only backend command execution.

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Desktop stack | Tauri v2 + React + TypeScript + Vite | Small Windows desktop wrapper, native app window, and official sidecar support for managed backend process. |
| Backend connection | Internal loopback REST to app-managed sidecar | Reuses current `/api/v1/*` behavior while keeping the browser out of the user workflow. |
| Backend package | PyInstaller onedir sidecar, bundled into portable app folder | Better for mutable config and runtime resources than onefile extraction. |
| Config ownership | App writes a managed config file before backend start/job submission | Preserves backend `ConfigLoader` behavior and keeps D10 output folder persistent. |
| Batch queue | App-owned queue of URLs mapped to backend jobs, with backend enhancements only where needed | Current server is single-job; app queue can deliver import, per-job state, retry, and pause-future-starts without a large backend rewrite. |
| Pause/resume semantics | Phase 2 must define and show truthful queue-level semantics unless backend cancellation is added | Existing `JobManager` has no pause/cancel API. Active-download pause cannot be promised without backend work. |
| History | App-owned persisted history, optionally enriched from backend job/result data | Current server job storage is TTL/in-memory and not enough for D12. |
| Logs | Separate app Logs surface fed by backend stdout/stderr and structured app events | Honors D13 and keeps main screen friendly. |

---

## 3. Alternatives Considered

### Option A: Browser UI served from FastAPI

- Description: Add templates/static UI to the existing server and ask the user to open localhost.
- Why considered: Lowest backend integration cost.
- Why rejected: Violates D1. The user explicitly chose a Windows desktop app, not a browser-based localhost UI.

### Option B: Electron + React

- Description: Electron shell spawns Python backend and renders React UI.
- Why considered: Mature desktop ecosystem and easy process spawning.
- Why rejected: Heavier runtime and larger portable folder for a restrained Windows utility. Tauri fits the utility form factor better and has explicit sidecar/resource support.

### Option C: PySide/PyQt desktop app directly calling Python modules

- Description: Build a native Python GUI and call downloader modules directly.
- Why considered: One language, no REST boundary.
- Why rejected: It would bypass the existing server contract, couple UI to downloader internals, and make a modern queue/history/log UI slower to build cleanly. It also does not solve packaging risk; Playwright and downloader assets still need packaging.

### Option D: Extend backend first into a full batch API, then build UI

- Description: Add backend-native queue, pause/resume/cancel, persistence, and logs before any desktop shell.
- Why considered: Strong backend model.
- Why rejected: It delays the first observable desktop slice. Phase 1 should prove the app can open, start backend, submit one job, and show friendly status before the batch model expands.

---

## 4. Risk Map

| Component | Risk Level | Reason | Verification Needed |
|-----------|------------|--------|---------------------|
| Tauri desktop scaffold | HIGH | New stack and build toolchain in an empty wrapper repo. | Validating spike: prove Windows dev build and packaged build can open. |
| Backend sidecar lifecycle | HIGH | D15 depends on reliable start/health/stop and production capabilities. | Validating spike: spawn backend, health-check, capture logs, handle port conflict. |
| PyInstaller backend packaging | HIGH | Python dependencies, optional server/browser deps, mutable config, and Playwright assets can break portable release. | Validating spike: build onedir sidecar and run `/health` from unpacked folder. |
| Single download UI | MEDIUM | Existing API supports single jobs, but real progress is coarse counts/status only. | Public UI/API tests plus manual happy-path/dev fake backend proof. |
| Batch queue UI | HIGH | D8 requires full queue management; current server has no batch endpoint, pause, cancel, or persistent jobs. | Spike queue semantics and backend API changes before implementation. |
| Cookie fetch UI | HIGH | Existing flow is terminal-oriented and uses Playwright; portable browser runtime is uncertain. | Spike app-triggered cookie fetch and failure states. |
| Output folder persistence | MEDIUM | Needs app-local settings and backend config sync. | Unit tests for settings persistence and config generation. |
| App history | MEDIUM | Existing server job TTL cannot satisfy D12. | App persistence tests and restart proof. |
| User-facing errors | MEDIUM | Backend errors are currently raw strings like `RuntimeError: ...`. | Contract tests for error classification and UI recovery actions. |
| Logs panel | MEDIUM | Needs diagnostics without overwhelming main UI. | UI tests for separation and log capture. |
| Portable zip release | HIGH | Final D16 proof depends on sidecar/resources/config paths in unpacked folder. | Unzip-and-run UAT on Windows. |

### HIGH-Risk Summary (for khuym:validating skill)

- **Tauri plus sidecar lifecycle**: Can the app spawn the backend sidecar with production permissions, detect health, route requests, and stop cleanly?
- **PyInstaller onedir backend package**: Can the Python backend run server mode from a portable folder with required dependencies and mutable config outside bundled resources?
- **Batch queue semantics**: Can D8 pause/resume/retry be delivered truthfully with app-side orchestration, or does the backend need cancel/pause APIs before implementation?
- **Cookie fetch packaging and UX**: Can Playwright-based cookie capture be launched from the desktop app and recover cleanly when browser/runtime/cookie extraction fails?

---

## 5. Proposed File Structure

Expected app wrapper additions:

```text
douyin-downloader-app/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    app/
      App.tsx
      routes.ts
    components/
      DownloadWorkspace.tsx
      ModeTabs.tsx
      AdvancedOptionsPanel.tsx
      QueueTable.tsx
      HistoryPanel.tsx
      LogsPanel.tsx
    services/
      backendClient.ts
      queueStore.ts
      settingsStore.ts
      historyStore.ts
      errorMapper.ts
    styles/
      app.css
    tests/
      *.test.tsx
  src-tauri/
    tauri.conf.json
    capabilities/
      default.json
    src/
      main.rs
      backend.rs
      settings.rs
      logs.rs
    binaries/
      douyin-backend-<target-triple>.exe
    resources/
      config.template.yml
  scripts/
    build-backend-sidecar.ps1
    package-portable.ps1
```

Expected backend repo changes, only as needed by phases:

```text
douyin-downloader/
  server/
    app.py              # Extend app-facing endpoints and error metadata.
    jobs.py             # Add queue/cancel/persistence only if validating proves needed.
  cli/
    main.py             # Keep serve path compatible with packaged sidecar.
  tools/
    cookie_fetcher.py   # Add non-terminal/app-triggerable flow if needed.
  tests/
    test_server.py
    test_cookie_fetcher.py
```

---

## 6. Dependency Order

```text
Layer 1: Desktop scaffold + fake backend client tests
Layer 2: Backend lifecycle sidecar command + health check
Layer 3: Single download UI wired to backend job API
Layer 4: App settings/config generation for output folder and in-scope advanced options
Layer 5: Batch queue model and UI, then backend changes only where queue semantics require them
Layer 6: Cookie recovery, error mapping, logs, and persisted history
Layer 7: Portable packaging and unpacked-folder UAT
```

### Parallelizable Groups

- UI layout/tests and backend server contract tests can run in parallel once the app scaffold exists.
- Settings/history stores can be implemented separately from visual queue layout if their file scopes stay separate.
- Portable packaging must wait for sidecar lifecycle, cookie/runtime decisions, and app history paths to stabilize.

---

## 7. Institutional Learnings Applied

No prior institutional learnings relevant to this feature.

---

## 8. Open Questions for Validating

- [ ] Prove Tauri sidecar execution in a packaged build, not only dev mode.
- [ ] Prove PyInstaller onedir backend can serve `/api/v1/health` from an unpacked portable folder.
- [ ] Decide exact pause/resume semantics before implementing batch controls.
- [ ] Prove automatic cookie fetch can be triggered from the app without relying on terminal input.
- [ ] Decide app history storage file format/path after checking Tauri app data and portable-mode constraints.
