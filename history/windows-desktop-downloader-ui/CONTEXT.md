# Windows Desktop Downloader UI - Context

**Feature slug:** windows-desktop-downloader-ui
**Date:** 2026-05-08
**Exploring session:** complete
**Scope:** Standard

---

## Feature Boundary

Build the first Windows desktop app experience for the existing Douyin downloader, focused on local Windows use, core download workflows, batch queue management, automatic backend startup, and a clean utility UI; do not expand the first scope into mobile/LAN web use, installer packaging, or every advanced downloader capability.

**Domain type(s):** SEE | CALL | RUN

---

## Locked Decisions

These are fixed. Planning must implement them exactly. No creative reinterpretation.

### App Form Factor

- **D1** Build a Windows desktop app that opens as its own application, not a browser-based localhost UI.
  *Rationale: The user will use this on Windows only and chose desktop app behavior over web-local behavior.*

- **D15** The desktop app must start and manage the downloader backend in the background.
  *Rationale: The user should not need to open a terminal or manually start a server before using the app.*

- **D16** The first Windows distribution should be a portable app: unzip a folder and run an `.exe`, with no installer or setup wizard required.

### Primary User Experience

- **D2** The single-link flow remains important: users should be able to paste one URL, start a download, and see progress/results quickly.

- **D8** The first version must include full batch-download capability, not only single URL download.
  *Rationale: The user explicitly chose batch as part of the first scope.*

- **D9** The main screen should give Single and Batch modes equal weight using a clear toggle/tab.
  *Rationale: This resolves the tension between D2 quick download and D8 full batch support.*

- **D17** The first UI scope focuses on core download capabilities: video/note, user/collection, and batch. Live, comments, transcript, discovery, and search are deferred to later phases.

### Power-User Controls

- **D3** The app is for power users first, with visible access to options such as download mode, cookie/config, quality, and full-crawl style controls for in-scope core download modes.

- **D4** Advanced options should live in a panel that is collapsed by default.
  *Rationale: Keep the primary screen usable while still giving power users access to controls.*

- **D5** The app should use the original repo's existing cookie-fetching capability to help users obtain Douyin cookies automatically.
  *Rationale: The user asked to help users get cookies according to the original repo's code. UI should fallback to manual/import cookie only when automatic retrieval cannot work.*

- **D10** The UI should let users choose one default output folder and remember it for future app launches.

### Progress, Results, Errors, and History

- **D6** After a download finishes, show a clear success/failure state with practical actions such as opening the output folder or result location; do not turn the first version into a full detailed result-history viewer.

- **D7** During download, show enough progress for normal operation: job status, success/failed/skipped counts, and the active URL/job. Do not stream terminal/debug logs into the main download surface.

- **D11** Download and cookie-expiration errors must be shown with clear user-facing guidance and action buttons, such as retry or fetch cookie again. Do not expose only raw backend errors and do not hide details so much that the user cannot act.

- **D12** Persist basic history across app launches: URL, time, status, and last known output folder/result location. Advanced search/filtering/history management is not required in the first scope.

- **D13** Provide a separate Logs tab or panel for power users who need technical diagnostics. The main screen should continue to show friendly errors and recovery actions instead of continuous logs.

### Visual Direction

- **D14** The visual style should be a clean Windows utility: practical, restrained, status-forward, and easy to scan. Do not design it as a media-heavy downloader or a dense developer dashboard.

### Agent's Discretion

- The user asked for recommendations several times, then explicitly confirmed or overrode each recommendation. Planning may choose implementation details, component/library choices, and packaging tools only if they preserve D1-D17.
- The exact grouping and labels inside the advanced panel can be decided during planning, provided the first scope remains core download plus batch and does not pull deferred modes into the first implementation.

---

## Specific Ideas & References

- The app should feel like a practical Windows utility: paste/select/import, start, monitor, recover from cookie/download errors, and open output folders.
- Single and Batch are both first-class modes on the main screen.
- Batch is not just a multiline URL form; the user chose full batch behavior including import file, pause/resume, retry per job, and detailed queue management.

---

## Existing Code Context

From the quick codebase scout during exploring. Downstream agents: read these files before planning to avoid reinventing existing patterns.

### Existing App Shell

- `F:\Work\DouyinDownload\douyin-downloader-app\AGENTS.md` - Khuym and repo guardrails for the app wrapper project.
- `F:\Work\DouyinDownload\douyin-downloader-app\.khuym\state.json` - current Khuym state file that downstream skills must keep consistent.
- `F:\Work\DouyinDownload\douyin-downloader-app` currently contains Khuym workflow scaffolding, not an implemented UI app.

### Downloader Backend

- `F:\Work\DouyinDownload\douyin-downloader\server\app.py` - existing FastAPI server. It defines `/api/v1/health`, `/api/v1/download`, `/api/v1/jobs/{job_id}`, and `/api/v1/jobs`.
- `F:\Work\DouyinDownload\douyin-downloader\server\jobs.py` - in-memory `JobManager` with async submit/run/list/get behavior, job statuses, counts, TTL pruning, and concurrency.
- `F:\Work\DouyinDownload\douyin-downloader\cli\main.py` - existing CLI entrypoint and serve subcommand path; planning should inspect how CLI args/config map to downloader capabilities before deciding app integration.
- `F:\Work\DouyinDownload\douyin-downloader\README.md` - documents supported use cases, CLI arguments, REST API server usage, output structure, cookie handling, and current limitations.

### Likely Integration Points To Investigate

- `F:\Work\DouyinDownload\douyin-downloader\tools\cookie_fetcher.py` - likely source for D5 automatic cookie retrieval.
- `F:\Work\DouyinDownload\douyin-downloader\config\config_loader.py` and `F:\Work\DouyinDownload\douyin-downloader\config.example.yml` - likely source for default output folder, quality, cookie, and mode settings.
- `F:\Work\DouyinDownload\douyin-downloader\core\downloader_factory.py`, `core\url_parser.py`, and `core\user_downloader.py` - likely source for mapping URL/mode choices to backend behavior.
- `F:\Work\DouyinDownload\douyin-downloader\storage\database.py` and `storage\file_manager.py` - likely source for existing persistence/output-path patterns before adding basic app history.

### Established Patterns

- Existing REST server returns immediately with a job ID and tracks job state asynchronously, so UI planning should account for submit-then-poll or an equivalent status mechanism.
- Existing job storage is in memory and TTL-capped; this does not satisfy D12 persistent app history by itself.
- Existing API shape is single-URL-oriented. D8 batch queue management may require new app-side queue orchestration, backend changes, or both. Planning must investigate the least invasive path.

---

## Outstanding Questions

### Deferred to Planning

- [ ] Determine the desktop app stack and packaging approach for a portable Windows `.exe` that can manage the Python backend in the background.
- [ ] Determine whether the existing FastAPI server should be extended, embedded, or bypassed by a direct app-to-Python integration while preserving public behavior.
- [ ] Determine how to implement D8 batch queue features against the current single-job API and in-memory `JobManager`.
- [ ] Determine how automatic cookie fetching works today and how a Windows desktop UI can invoke it safely and recover when it fails.
- [ ] Determine the persistence mechanism for D10 output folder preference and D12 basic history.
- [ ] Determine which existing config fields belong in the first collapsed advanced panel without accidentally expanding into deferred capabilities from D17.

---

## Deferred Ideas

- Mobile, responsive LAN, or server-hosted web UI - deferred because D1 narrows the first scope to Windows desktop app usage.
- Installer/setup wizard with Start Menu/Desktop shortcuts - deferred because D16 chooses portable app first.
- Live, comments, transcript, discovery, and search UI - deferred by D17 even if the backend supports some of these capabilities.
- Advanced history search/filtering and full result-history viewer - deferred by D12 and D6.
- External backend connection mode for power users - deferred by D15; the first app should manage its backend internally.

---

## Handoff Note

CONTEXT.md is the single source of truth for this feature.

- **planning** reads: locked decisions, code context, canonical refs, deferred-to-planning questions
- **validating** reads: locked decisions (to verify plan-checker coverage)
- **reviewing** reads: locked decisions (for UAT verification)

Decision IDs (D1, D2...) are stable. Reference them by ID in all downstream artifacts.
