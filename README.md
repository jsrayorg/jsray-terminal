<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://jsray.org/assets/brand/jsray-logo-hero-dark.svg">
    <img src="https://jsray.org/assets/brand/jsray-logo-hero-light.svg" alt="JSRay" width="420">
  </picture>
</p>

**English** · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.1--beta-lightgrey)](CHANGELOG.md)
[![Channel](https://img.shields.io/badge/channel-beta-blue)](CHANGELOG.md)
[![Core](https://img.shields.io/badge/JSRay%20Core-0.0.1--beta.1-success)](https://github.com/jsrayorg/jsray)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2018-339933)](package.json)

> JSRay code rendering for the terminal · ANSI truecolor · 35 language families · zero dependencies

<sub>Internal test build · no public beta yet · bundles a JSRay Core snapshot</sub>

---

This repository is the standalone **terminal CLI** project around [JSRay Core](https://github.com/jsrayorg/jsray) — an official open-source integration in the JSRay ecosystem, with its own version and release notes.

It **bundles a snapshot** of Core (`vendor/jsray.cjs`) rather than depending on it at runtime, so the CLI keeps working exactly as shipped until a sync deliberately advances it.

## What it does

`jsray` renders code in the terminal with ANSI colors, powered by the **same tokenizer and the same palettes** as every other JSRay surface: `JSRay.tokenize()` produces a renderer-agnostic token stream, and this project maps it to ANSI escape sequences instead of HTML spans. Nine-family separation included — parameters italic amber, declarations bold mint, keywords bold.

- **35 language families** (everything Core supports), auto-detected from the file extension, filename (`Dockerfile`, `Makefile`), or content
- **4 palettes × dark/light**: default, aurora, ember, fjord
- **Truecolor** by default, with xterm-256 downsampling and plain-text fallback; piped output degrades to plain automatically
- **Zero dependencies** — plain Node ≥ 18

## Usage

```sh
jsray src/app.py                        # highlight a file
cat query.sql | jsray                   # stdin, auto-detected
jsray notes.md --theme aurora           # pick a palette
jsray config.toml --mode light          # light variant
jsray server.go -n                      # line numbers
jsray build.log --color none            # force plain
jsray --list-languages                  # everything Core supports
jsray --list-themes
```

Language resolution order: `--lang` → file extension → special filenames → `JSRay.detectLanguage()` on the content. Undetectable input degrades to plain text, never an error.

Color resolution: `--color auto` (default) uses truecolor when `COLORTERM` advertises it, xterm-256 otherwise, and plain text when stdout is not a TTY. Override with `--color truecolor|256|none`.

## Install

```sh
npm link          # from the repository root; exposes `jsray` on PATH
```

## Project layout

```
jsray-terminal/
├── bin/jsray.mjs       ← CLI: args, IO, language resolution
├── lib/ansi.mjs        ← token stream → ANSI (truecolor / 256 / none)
├── vendor/jsray.cjs    ← Core runtime snapshot — do not edit
├── palettes/           ← palette JSON synced from Core — do not edit
├── tools/              ← sync-core.sh · check-versions.mjs
└── tests/              ← node --test suites (renderer + end-to-end CLI)
```

## Sync Core

After changing the Core project, rebuild Core `dist/` (run `sh build.sh` there), then:

```sh
npm run sync:core      # expects Core at ../jsray, or set JSRAY_CORE_DIR
```

`npm run check:versions` fails if the bundle drifts from a sibling Core checkout.

## Core integrity

The CLI runs the bundled engine straight off disk, so the file rendering your
code is one careless `npm install` script away from being something else.
`core-integrity.json` pins the digests JSRay Core published for this snapshot,
and every run verifies them — hashing ~70KB costs far less than Node's own
startup.

```sh
jsray --verify-core
# official build verified — JSRay Core 0.0.1-beta.2, 6 files
```

A mismatch warns on **stderr** and still renders, so it can never contaminate a
pipeline; `--verify-core` exits non-zero for use in a script.

## Custom palettes

```sh
jsray app.js --palette ~/my-colors.json          # layered over --theme
jsray app.js --theme fjord --palette ~/tweak.json
```

Takes the same JSON every other JSRay surface uses — what the
[Theme Studio](https://jsray.org/studio.html) exports — so one palette file
works in the terminal, on the web, and in the editor. Tokens you omit keep the
built-in palette's value. Keys are checked against the bundled `vocabulary.json`;
unknown ones (from a newer Core) are reported on stderr and skipped rather than
being fatal.

## Renderer boundary

The ANSI layer consumes only the ecosystem token-stream contract (`tokenize(code, lang)` → strings and `{type, content}` nodes). Any renderer that produces this shape can be dropped into `vendor/`.

## Develop

```sh
npm test
npm run check:versions
```
