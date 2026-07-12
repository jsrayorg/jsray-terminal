#!/usr/bin/env node
/**
 * Update bundledCore.version in version.json from the Core repo's version.json.
 * Invoked by tools/sync-core.sh; can also be run directly:
 *   node tools/sync-core-version.mjs [coreDir]   (coreDir defaults to ../jsray)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const coreDir = process.argv[2] || '../jsray';
const coreRelease = JSON.parse(readFileSync(resolve(coreDir, 'version.json'), 'utf8'));

if (coreRelease.project !== 'jsray') {
  console.error(`error: ${coreDir}/version.json is not the JSRay Core project`);
  process.exit(1);
}

const path = 'version.json';
const release = JSON.parse(readFileSync(path, 'utf8'));
const prev = release.bundledCore?.version;
release.bundledCore = { project: 'jsray', version: coreRelease.version };

if (prev === coreRelease.version) {
  console.log(`bundledCore.version already ${coreRelease.version}`);
} else {
  writeFileSync(path, JSON.stringify(release, null, 2) + '\n');
  console.log(`bundledCore.version ${prev ?? '(unset)'} → ${coreRelease.version}`);
}
