# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

> This repository tracks **JSRay Terminal** versions only. [JSRay Core](https://github.com/JSRayCore/JSRay)
> keeps its own version and changelog; the `bundledCore` field in `version.json`
> records which Core snapshot each release ships.

## [Unreleased]

### Changed
- Bundled Core snapshot advanced to **0.0.1-beta.1** (Core's first public beta).
- Repository documentation aligned with Core: CHANGELOG, CONTRIBUTING, SECURITY, and Code of Conduct now match the ecosystem baseline, and the README carries the shared brand header and a Simplified Chinese translation.

## [0.0.1-internal.1] — 2026-07-12

### Status
- Internal test build; not a public beta. Validated by hand in macOS Terminal and iTerm2.

### Added
- `jsray` CLI: renders files or stdin as ANSI, driven by the same `JSRay.tokenize()` token stream every other JSRay surface consumes.
- 35 language families, resolved in order: `--lang` → file extension → special filenames (`Dockerfile`, `Makefile`) → content detection; undetectable input degrades to plain text rather than failing.
- Four palettes × dark/light, truecolor with xterm-256 downsampling and a plain-text fallback; piped output degrades automatically.
- Flags: `--theme`, `--mode`, `--color`, `-n`, `--list-themes`, `--list-languages`.

### Fixed
- A bare `jsray` on an interactive TTY prints help instead of blocking on stdin.
- 256-color quantization snaps to the real xterm cube levels (0/95/135/175/215/255) instead of rounding proportionally. Naive rounding drifted by up to ±48 per channel and collapsed keywords and builtins into the same cell — the reason terminal output looked visibly unlike the website.
- The CLI exits quietly when a downstream pipe closes early (`… | head -1` no longer raises EPIPE).

### Changed
- Core drift check is advisory day-to-day and strict at the packaging gate.
- Official project emails adopted; CI `GITHUB_TOKEN` pinned to read-only.
