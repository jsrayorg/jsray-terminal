# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

> This repository tracks **JSRay Terminal** versions only. [JSRay Core](https://github.com/jsrayorg/jsray)
> keeps its own version and changelog; the `bundledCore` field in `version.json`
> records which Core snapshot each release ships.

## [Unreleased]

## [0.0.1-beta.1] — 2026-08-01

First public beta. The CLI vendors a JSRay Core snapshot rather than depending
on it, so `jsray` is one self-contained package whose engine can be verified
against the digests Core published.

### Added
- `--verify-core` checks the bundled engine and palettes against those digests. Verification also runs on every invocation, warning on stderr rather than stdout so a pipeline is never affected by it.
- `--palette <file.json>` layers a custom palette over any built-in theme, using the same JSON the Theme Studio exports. Keys are validated against the bundled vocabulary; unknown ones are reported and skipped, so a palette written for a newer Core still works.

### Changed
- The tk-class → palette-key map is derived from Core's `vocabulary.json` rather than transcribed here. A transcription is how a Core that grows a token ends up silently unstyled in the terminal.
- Bundled Core is **0.0.1-beta.4**, which fixes a denial of service present in every earlier snapshot: an unterminated interpolating string sent four grammars into exponential backtracking. A CLI reading a half-written file from a pipe is exactly the shape that triggers it. Measured here, 8001 characters of unterminated template string render in 4ms.
- CI fails when the bundled Core is behind the published Core, and a scheduled workflow opens a sync pull request when Core moves. The previous drift check compared against a sibling checkout and skipped silently when Core was absent — every CI run.
- Repository documentation matches the ecosystem baseline: CHANGELOG, CONTRIBUTING, SECURITY and Code of Conduct, with the shared brand header and a Simplified Chinese README.

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
