# JSRay Terminal

This repository is the standalone terminal integration project around JSRay Core.

Official site: [JSRay.org](https://jsray.org)

This is an official open-source integration in the JSRay ecosystem.

Current channel: internal test. No public beta has been released yet.

It has its own version and release notes. It bundles a snapshot of JSRay Core (`vendor/jsray.cjs`), but it is not the Core renderer project itself.

## What it does

`jsray` renders code in the terminal with ANSI colors, powered by the **same tokenizer and the same palettes** as every other JSRay surface: `JSRay.tokenize()` produces a renderer-agnostic token stream, and this project maps it to ANSI escape sequences instead of HTML spans. Six-family separation included — parameters italic amber, declarations bold mint, keywords bold.

- **34 language families** (everything Core supports), auto-detected from the file extension, filename (`Dockerfile`, `Makefile`), or content
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

## Install (internal test)

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

## Renderer boundary

The ANSI layer consumes only the ecosystem token-stream contract (`tokenize(code, lang)` → strings and `{type, content}` nodes). Any renderer that produces this shape can be dropped into `vendor/`.

## Develop

```sh
npm test
npm run check:versions
```
