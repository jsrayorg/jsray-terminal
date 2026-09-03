# Contributing to JSRay Terminal

Issues and PRs are welcome. This repository is the terminal integration; changes to
the renderer itself belong in [JSRay Core](https://github.com/jsrayorg/jsray).

## Development workflow

1. Fork and clone
2. `npm link` exposes `jsray` on your PATH
3. Exercise it against real files, stdin, and a pipe: `jsray x.py`, `cat x.sql | jsray`, `jsray x.js | head -1`
4. Run the tests: `npm test` (requires Node ≥ 20)
5. Run `npm run check:versions` and `npm run check:core` before opening a PR.
   The second asks npm whether the bundled Core snapshot is still the published
   one — the older drift check compares against a sibling checkout and skips
   when Core is absent, which is every CI run, so a stale engine used to pass a
   green build. It did: a denial of service fixed in Core sat in this bundle
   until somebody measured it.

## Do not edit synced files

```text
vendor/jsray.cjs      ← Core runtime snapshot
palettes/*.json       ← Core palettes
```

Fix tokenizer or grammar bugs in Core, then run `npm run sync:core` here.
Terminal-owned code is `bin/jsray.mjs` (args, IO, language resolution) and
`lib/ansi.mjs` (token stream → escape sequences).

## Terminal conventions

- **Never write escapes to a non-TTY.** `--color auto` must degrade to plain text when stdout is piped.
- **`--color none` must round-trip the input byte-for-byte.** There is a test for this; keep it true.
- Downsampling to xterm-256 snaps to the real cube levels (0/95/135/175/215/255). Proportional rounding drifts far enough to merge distinct token colors — do not reintroduce it.
- Emit a reset before each color run, so a truncated pipe cannot leave the terminal in a colored state.
- A closed downstream pipe is a normal exit, not an error.

## Versioning

`version.json` and `package.json` must agree; `bundledCore.version` is maintained by the
sync script — do not hand-edit it.

## Commit conventions

Short, imperative subjects, optionally scoped:

```
fix(cli): exit quietly when the downstream pipe closes early
feat: add a copy button to the block toolbar
chore: sync Core snapshot (token fallback chain)
docs: correct the language-family count
```

## Pull requests

- One PR per concern, to keep reviews easy.
- Behavior changes must come with added or updated tests — CI runs the suite on Node 18, 20, and 22, and a PR cannot merge red.
- Passing CI is necessary but not sufficient: every PR also needs maintainer review before it merges.

## Code of Conduct

Participating in this project means you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
