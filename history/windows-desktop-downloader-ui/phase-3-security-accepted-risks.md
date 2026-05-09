# Phase 3 Security Accepted Risks

- **Feature**: `windows-desktop-downloader-ui`
- **Bead**: `douyin-downloader-app-w18`
- **Date**: 2026-05-09
- **Owner**: `Ohm` (`019e0ba5-e52b-73e2-9e43-40ea5ff81a08`)

## Accepted Risk: Deprecated YAML parser in native runtime

`src-tauri/src/backend.rs` currently uses `serde_yaml` to merge cookie values into
the managed config file. `serde_yaml` resolves to a deprecated release and brings
`unsafe-libyaml` into the Rust dependency tree.

For Phase 3, we are accepting this risk temporarily instead of replacing the YAML
pipeline in the same patch because replacing it safely requires a deeper native
config parser migration and wider regression coverage than this bounded bead.

## Current Mitigations

- Tauri CSP is now explicitly restricted in `src-tauri/tauri.conf.json` to reduce
  renderer injection blast radius while this dependency remains.
- Cookie/config writes remain constrained to managed runtime config flow in native
  commands.

## Required Follow-up

- Replace `serde_yaml` with a non-deprecated parser or remove YAML mutation in the
  native path in the next security hardening phase.
- Re-run native config write tests and packaged desktop smoke proof after that
  dependency migration.
