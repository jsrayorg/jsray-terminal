#!/usr/bin/env node
/**
 * Fail when the bundled Core snapshot is older than the published Core.
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

if (published !== bundled) {
  console.error(`::error::bundled Core is ${bundled}, the published beta is ${published}`);
  console.error("       run 'sh tools/sync-core.sh' and commit the result.");
  console.error('       https://github.com/jsrayorg/jsray/blob/main/CHANGELOG.md');
  process.exit(1);
}

console.log(`bundled Core ${bundled} matches the published beta`);
