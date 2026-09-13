# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

> This repository tracks **JSRay Terminal** versions only. [JSRay Core](https://github.com/jsrayorg/jsray)
> keeps its own version and changelog; the `bundledCore` field in `version.json`
> records which Core snapshot each release ships.

## [Unreleased]

## [0.0.2-beta] — 2026-09-13

Bundles JSRay Core 0.0.2-beta.5, the last beta of Core's 0.0.2 line. Still
installed from GitHub; npm follows at `0.1.0`.

### Changed
- **Bundled Core is 0.0.2-beta.5**, up from 0.0.2-beta.1. In a terminal:
  - A comment holding two quotes stays one comment, and a string holding `//`,
    `#` or `/* */` stays one string, in every grammar. 27 grammars used to cut
    a comment such as `// don't stop, won't stop` at its first apostrophe.
  - Heredocs in PHP, shell and Ruby, Ruby's `%w[]` family, Perl's `q{}` family
    and Elixir sigils render as literals instead of as code.
  - A JavaScript template nested inside a placeholder no longer ends the outer
    one early, and private class members such as `#count` are coloured.
- **Core drift is reported, not failed on.** CI warns while the bundled Core is
  behind the published one and stays green; the strict check lives in
  `npm run test:packaged`, because an integration syncs Core when it releases,
  not when Core does.
- The sync workflow retires what a newer Core makes obsolete — its own issues
  and `core/*` branches — instead of leaving one of each per Core release.
- The README says how to install the CLI rather than how to build it, and its
  Core badge is derived from `version.json` and checked beside the version
  badge.

### Fixed
- Both READMEs called this an internal test build with no public beta after the
  repository went public, because `publicBetaReleased` in `version.json` was
  never moved — and the check meant to catch that enforces whatever the flag
  says, so it stayed green.
- Commit subjects are checked on pull requests as well as by the local hook.

## [0.0.1-beta] — 2026-09-05

First public release, source on GitHub and installable from it:

```sh
npm i -g github:jsrayorg/jsray-terminal
```

Installed from GitHub while the terminal-background detection this release
depends on gets exercised beyond one terminal and a synthetic pty — a registry
version cannot be taken back, so npm follows at `0.1.0`.

The CLI vendors a JSRay Core snapshot rather than depending on it, so `jsray`
is one self-contained package whose engine can be verified against the digests
Core published.

### Added
- `--verify-core` checks the bundled engine and palettes against those digests. Verification also runs on every invocation, warning on stderr rather than stdout so a pipeline is never affected by it.
- `--palette <file.json>` layers a custom palette over any built-in theme, using the same JSON the Theme Studio exports. Keys are validated against the bundled vocabulary; unknown ones are reported and skipped, so a palette written for a newer Core still works.

### Changed
- The dark/light variant is now detected instead of assumed: `--mode` if given, then `COLORFGBG`, then an OSC 11 query to the terminal itself. A terminal that does not answer still gets dark, so nothing regresses where the query is unsupported. The fixed `dark` default was a guess about a screen the process had never seen, and on a light terminal 21 of the default palette's 25 colors landed under 3:1 contrast.
- Piped output is byte-exact: a file that ends without a newline is written back without one, and an empty selection writes nothing. The trailing newline is a courtesy to a terminal, added only when stdout is a TTY — the same rule `--color auto` already follows. `jsray f --color none > copy` now produces a copy.
- With `-n`, lines longer than the window wrap under the code rather than under the gutter. Escape sequences do not count toward the width, and CJK counts as two columns.
- The tk-class → palette-key map is derived from Core's `vocabulary.json` rather than transcribed here. A transcription is how a Core that grows a token ends up silently unstyled in the terminal.
- Bundled Core is **0.0.2-beta.1**. It carries the denial-of-service fix Core made in 0.0.1-beta.4: an unterminated interpolating string sent four grammars into exponential backtracking. A CLI reading a half-written file from a pipe is exactly the shape that triggers it. Measured here, 8001 characters of unterminated template string render in 4ms.
- CI fails when the bundled Core is behind the published Core, and a scheduled workflow opens a sync pull request when Core moves. The previous drift check compared against a sibling checkout and skipped silently when Core was absent — every CI run.
- Repository documentation matches the ecosystem baseline: CHANGELOG, CONTRIBUTING, SECURITY and Code of Conduct, with the shared brand header and a Simplified Chinese README.

### Fixed
- A binary file is refused with one line instead of being decoded as UTF-8. An 18KB PNG previously printed 33KB of replacement characters and exited 0.
- A missing shipped file (`palettes/`, `vocabulary.json`, `vendor/jsray.cjs`, `version.json`) reports what is missing instead of surfacing an fs stack trace, including for the reads that happen before `main` runs.

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
