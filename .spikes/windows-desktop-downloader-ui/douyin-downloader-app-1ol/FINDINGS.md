# Spike Findings: Phase 2 Batch UI Density

**Bead:** `douyin-downloader-app-1ol`
**Question:** Can batch UI stay scan-friendly as controls and totals are added?

## Answer

YES, with concrete layout constraints.

Phase 2 can keep Batch mode a restrained Windows utility if it treats the batch surface as one summary-first workflow: input/import controls, one compact queue toolbar, one totals strip, one queue table/list, and one terminal summary. The current shell already gives Batch enough full-width space and keeps diagnostics separate. The main risk is uncontrolled growth: adding every control and every diagnostic field directly into each row would turn the page into a dense developer dashboard.

## Evidence

- `history/windows-desktop-downloader-ui/CONTEXT.md` locks D14: the app must be a clean Windows utility, practical, restrained, status-forward, and easy to scan, not media-heavy or a dense developer dashboard.
- `history/windows-desktop-downloader-ui/phase-2-contract.md` requires Batch to show row state, active URL/job, running count, success/failed/skipped totals, pause/resume/retry, and a terminal summary. The same contract names "Batch UI becomes a dense developer dashboard" as a pivot/failure signal.
- `history/windows-desktop-downloader-ui/phase-2-story-map.md` splits Batch UI growth across beads .9, .11, .12, and .13, so layout constraints can be applied incrementally instead of being discovered only at the end.
- Current app structure gives the mode surface enough room: `src/app/App.tsx:237` renders the Single/Batch tab card, `src/app/App.tsx:259` switches Single vs Batch content, and `src/app/App.tsx:270` shows the current Batch placeholder inside that same full-width card.
- Current CSS keeps the app restrained and bounded: `.app-shell` is capped at `1100px`, `.layout-grid` uses two columns with `16px` gaps, `.mode-card` spans both columns, and the layout collapses to one column under `900px` (`src/styles/app.css:17`, `src/styles/app.css:35`, `src/styles/app.css:55`, `src/styles/app.css:215`).
- Current status UI already has a compact metric pattern: `JobStatusPanel` renders status, total, success, failed, and skipped in a five-item `.counts-grid` (`src/components/JobStatusPanel.tsx:37`, `src/styles/app.css:150`). Batch totals can reuse this pattern instead of adding large repeated cards.
- Current diagnostics are intentionally outside the main workflow and hidden by default (`src/components/DiagnosticsPanel.tsx:21`, `src/components/DiagnosticsPanel.tsx:35`, `src/components/DiagnosticsPanel.tsx:48`). Batch rows should preserve this separation and not stream raw backend details into the queue table.
- Existing form controls are simple `1fr auto` inline rows for URL/output plus one action button (`src/components/SingleDownloadPanel.tsx:23`, `src/components/OutputFolderControl.tsx:11`, `src/styles/app.css:85`). Batch can extend this style for paste/import/start controls without changing the app into a command dashboard.

## Constraints For Beads

1. Keep Batch inside the existing full-width mode card. Do not add a second dashboard region or nested cards inside the Batch card for parser, runner, controls, and summary.
2. Use a fixed visual order: paste/import input, queue toolbar, totals strip, queue rows, terminal summary. Do not interleave totals, controls, and row details repeatedly.
3. Keep the toolbar small: visible top-level commands should be Import, Start, Pause/Resume, and Retry failed/skipped. Avoid separate always-visible buttons for every row state.
4. Use one compact totals strip. It may contain status/running/total/success/failed/skipped, but it should stay one row on desktop and wrap predictably on narrow screens. Do not create separate metric cards for each count.
5. Queue rows need stable columns: status, URL/title text, backend job id or short secondary detail, and one action area. URL text should truncate or wrap to at most two lines; backend job id belongs in muted secondary text.
6. Per-row controls must be conditional. Retry appears only for eligible failed/skipped rows; active/running rows should not show pause/cancel controls because Phase 2 pause only blocks future starts.
7. Pause wording must be truthful. Use copy equivalent to "Pause new starts" or helper text that running downloads continue; never imply active backend jobs are stopped.
8. Keep raw errors and backend diagnostics out of the main row table. Rows can show a short friendly reason; technical detail stays in the diagnostics panel or an expandable detail path.
9. On screens under `900px`, stack the layout and keep the queue readable by switching rows to a compact stacked layout or a horizontally scrollable table with fixed row height. Buttons must not squeeze URL text to unreadable width.
10. Add UI tests around visible structure, not implementation details: Batch has one toolbar, one totals region, rows render stable statuses, controls enable/disable by queue state, and final totals match row states.

## Impacted Beads

- `douyin-downloader-app-irx.8`: Row model should expose display-ready state and aggregate helpers so UI beads do not invent ad hoc per-row fields. Include `running`/terminal/skipped counts needed for one totals strip.
- `douyin-downloader-app-irx.9`: Batch placeholder replacement must create the constrained surface: multiline paste/import input, small toolbar shell, compact queue rows, and skipped/invalid visibility without backend controls.
- `douyin-downloader-app-irx.10`: Runner should keep aggregate state/query helpers deterministic so `.11` can render one totals strip and avoid row-level polling clutter.
- `douyin-downloader-app-irx.11`: Execution UI must render active URL/job and totals in the compact summary pattern, not as extra cards or repeated row panels.
- `douyin-downloader-app-irx.12`: Pause/resume/retry controls need strict enablement and truthful labels. Avoid per-row controls except retry on eligible terminal rows.
- `douyin-downloader-app-irx.13`: Completion summary should reuse the same totals strip and one output-folder action. Friendly failure/skip context belongs in rows; raw detail stays in diagnostics.
- `douyin-downloader-app-irx.14`: UAT evidence should include a scan check at normal desktop width and narrow width: toolbar remains small, totals match rows, row text is readable, and pause wording does not imply active cancellation.

## Closing Judgment

YES. The planned Batch UI can stay scan-friendly and utility-like if Phase 2 treats summary, controls, and rows as one bounded workflow. The phase should proceed, but the implementation beads should carry the constraints above as acceptance guidance.
