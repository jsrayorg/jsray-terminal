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

### The ladder

Each beta bumps the **patch**. There is no counter after `-beta`: a patch is never
released twice, so a counter would carry no information — Core keeps one because its
betas iterate within a patch, this does not.

```
0.0.1-beta → 0.0.2-beta → 0.0.3-beta → … → 0.1.0
```

`0.1.0` is the first stable release, and it is where this package goes to npm. The
betas are not early drafts — they are a mature surface being walked through the
problems that only show up in other people's terminals. Until then the channel stays
`beta`, because `stable` claims the surface has stopped changing, and `0.0.1` is
therefore never released as a stable version: the ladder walks past it.

The major stays `0` regardless: the ecosystem rule ties an integration's major to the
Core it bundles, and Core is still `0.x`.

## Commit conventions

One imperative sentence that says **what changed and why it is better**, then a
blank line, then a body that answers why. `tools/hooks/commit-msg` enforces
this — install it with `git config core.hooksPath tools/hooks`, and CI runs the
same file against every commit a pull request adds.

```
✗  fix(cli): exit quietly when the downstream pipe closes early
✗  chore: sync Core snapshot
✗  0.0.1-beta.3
✗  Release 0.0.2-beta.2

✓  Exit quietly when the downstream pipe closes early
✓  Bundle Core 0.0.2-beta.3 so the CLI renders what the site does
```

**No type prefixes.** `feat:`, `fix:`, `chore:` classify a commit instead of
describing it. **No bare version numbers**, with or without a word in front: a
version names the release without saying anything about it, and it lands on
every file the release touched.

**One concern per commit, and a version bump is a concern of its own.** The
subject is printed beside every file the commit touched, so a commit carrying
four unrelated changes prints a sentence that is a quarter true of each of
them. A merged subject cannot be reworded afterwards.

**Keep the subject under about 60 characters** — GitHub's file listing
truncates there.

## Pull requests

- One PR per concern, to keep reviews easy.
- Behavior changes must come with added or updated tests — CI runs the suite on Node 20, 22, and 24, and a PR cannot merge red.
- Passing CI is necessary but not sufficient: every PR also needs maintainer review before it merges.

## Code of Conduct

Participating in this project means you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
