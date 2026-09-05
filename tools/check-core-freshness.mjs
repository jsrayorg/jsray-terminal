#!/usr/bin/env node
/**
 * Report when the bundled Core snapshot is older than the published Core.
 *
 * Advisory by default; fails only with `--strict` or JSRAY_STRICT_DRIFT=1.
 *
 * This repository does not depend on Core at runtime — it vendors a copy,
 * because the CLI installs as one self-contained package with a
 * verifiable snapshot. That copy does not update itself, so a fix in Core reaches a user
 * only when someone re-syncs here and releases.
 *
 * Nothing used to notice when no one had. The existing drift check compares
 * against a sibling checkout and skips silently when Core is absent, which is
 * every CI run — so this repository could sit on an old engine indefinitely
 * with a green build, and did: Core 0.0.1-beta.3 fixed a denial of service
 * that stayed in the bundle here until someone thought to look.
 *
 * The registry being unreachable is not a failure; being behind is.
 *
 *   node tools/check-core-freshness.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const bundled = JSON.parse(readFileSync('version.json', 'utf8')).bundledCore?.version;

if (!bundled) {
  console.error('error: version.json has no bundledCore.version');
  process.exit(1);
}

let published;
try {
  published = execFileSync('npm', ['view', '@jsray/core', 'dist-tags.beta'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // Offline, rate-limited, registry down. Not knowing is not the same as
  // being stale, and failing here would turn someone else's outage into a
  // broken build.
  console.log(`skip: registry unreachable — bundled Core ${bundled} not verified`);
  process.exit(0);
}

if (!published) {
  console.log(`skip: no beta dist-tag published — bundled Core ${bundled} not verified`);
  process.exit(0);
}

// Being behind between releases is the normal state, not a defect: a bundled
// copy cannot follow Core in real time. Every artifact freezes the snapshot it
// was built from — a .vsix, a plugin zip, and the source archive GitHub
// attaches to a tag alike — so alignment is something a release does, not
// something a repository maintains continuously. Failing here on every push
// would demand the one thing that is not possible, and the noise would be paid
// for daily.
//
// The gate is where it can be met: nothing may be packaged from a stale
// engine. That is what `--strict` is for, and it is wired into each repository's
// packaging script.
if (published !== bundled) {
  const strict = process.argv.includes('--strict') || process.env.JSRAY_STRICT_DRIFT === '1';
  const level = strict ? 'error' : 'warning';
  console.error(`::${level}::bundled Core is ${bundled}, the published beta is ${published}`);
  console.error("       run 'sh tools/sync-core.sh' as part of the next release here.");
  console.error('       https://github.com/jsrayorg/jsray/blob/main/CHANGELOG.md');
  process.exit(strict ? 1 : 0);
}

console.log(`bundled Core ${bundled} matches the published beta`);
