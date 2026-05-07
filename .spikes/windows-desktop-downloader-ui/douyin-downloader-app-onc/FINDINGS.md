# Spike Findings: Backend Packaging Boundary

**Question:** Can the backend packaging boundary support the Phase 1 architecture?

**Answer:** YES, with one required packaging repair.

## Evidence

- `run.py` delegates to `cli.main:main()`, and CLI serve mode exists.
- Server mode has a stable `/api/v1/health` endpoint and existing tests for health/job behavior.
- `fastapi`, `uvicorn`, `pydantic`, `cargo`, `npm`, and `pyinstaller` are available on this machine.
- `python -m pytest tests/test_server.py -q` passed: 9 tests.
- Naive PyInstaller build without backend `--paths` failed with `ModuleNotFoundError: No module named 'cli'`.
- PyInstaller build with backend `--paths` reached `cli.main`, but packaged `run.py --serve` failed before server startup because Rich banner output hit a Windows `cp1252` encoding error when stdout/stderr were redirected.
- A spike-only server entrypoint that bypasses the CLI banner was packaged with PyInstaller onedir and successfully served `/api/v1/health` from the unpacked folder:
  - executable: `.spikes/windows-desktop-downloader-ui/douyin-downloader-app-onc/dist-sidecar-entry/douyin-backend-sidecar-entry/douyin-backend-sidecar-entry.exe`
  - health smoke: `health_ok=True`

## Constraints

- Phase 1 can proceed with dev Python backend lifecycle proof.
- Do not claim current `run.py` is a production-ready PyInstaller sidecar entrypoint.
- Packaging work must add or use a server-only sidecar entrypoint that avoids Rich CLI banner/output before `run_server`.
- Packaging must include backend source path/packages explicitly and must install server extras, not only `requirements.txt`.
- Final portable proof still belongs to Phase 4 unless execution scope is expanded.

## Bead Guidance

- `douyin-downloader-app-irx.2`: keep lifecycle abstraction independent from whether the executable is dev Python or packaged sidecar.
- `douyin-downloader-app-irx.3`: write app-managed config before starting either backend runtime.
- `douyin-downloader-app-irx.7`: document that packaged backend health is possible through a server-only entrypoint, but current Phase 1 UAT should not mark portable distribution complete.
