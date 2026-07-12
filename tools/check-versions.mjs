#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));
const fail = [];

function expect(condition, message) {
  if (!condition) fail.push(message);
}

const release = json('version.json');
const pkg = json('package.json');
const version = release.version;
const channel = release.channel;

expect(release.project === 'jsray-terminal', 'version.json project must be jsray-terminal');
expect(typeof version === 'string' && /^\d+\.\d+\.\d+-(internal|beta)\.\d+$|^\d+\.\d+\.\d+$/.test(version), `version.json has an unsupported version: ${version}`);
expect(['internal', 'beta', 'stable'].includes(channel), `version.json has an unsupported channel: ${channel}`);

if (channel === 'internal') {
  expect(/-internal\.\d+$/.test(version), 'internal channel versions must end with -internal.N');
  expect(release.publicBetaReleased === false, 'internal channel must keep publicBetaReleased false');
  expect(pkg.private === true, 'internal channel must keep package.json private true');
}

if (channel === 'stable') {
  expect(!version.includes('-'), 'stable channel versions must not include a prerelease suffix');
}

expect(pkg.version === version, `package.json version ${pkg.version} does not match ${version}`);
expect(release.bundledCore?.project === 'jsray', 'bundledCore.project must be jsray');
expect(typeof release.bundledCore?.version === 'string', 'bundledCore.version must be set');
expect(pkg.bin?.jsray === './bin/jsray.mjs', 'package.json must expose the jsray bin');
expect(existsSync('bin/jsray.mjs'), 'bin/jsray.mjs missing');
expect(existsSync('vendor/jsray.cjs'), 'vendor/jsray.cjs missing — run tools/sync-core.sh');
expect(existsSync('palettes/default.json'), 'palettes/default.json missing — run tools/sync-core.sh');

// Opportunistic drift check against a sibling Core checkout.
const coreDir = process.env.JSRAY_CORE_DIR || '../jsray';
if (existsSync(resolve(coreDir, 'dist'))) {
  const bundlePairs = [
    ['vendor/jsray.cjs', resolve(coreDir, 'dist/jsray.js')],
    ['palettes/default.json', resolve(coreDir, 'tokens.json')],
  ];
  if (existsSync(resolve(coreDir, 'themes'))) {
    for (const f of readdirSync(resolve(coreDir, 'themes')).filter((f) => f.endsWith('.json'))) {
      bundlePairs.push([`palettes/${f}`, resolve(coreDir, 'themes', f)]);
    }
  }
  for (const [bundled, core] of bundlePairs) {
    if (!existsSync(bundled)) { fail.push(`missing ${bundled} — run 'sh tools/sync-core.sh'`); continue; }
    expect(read(bundled) === read(core),
      `bundled ${bundled} differs from Core ${core} — run 'sh tools/sync-core.sh'`);
  }
  const coreVersionPath = resolve(coreDir, 'version.json');
  if (existsSync(coreVersionPath)) {
    const coreRelease = json(coreVersionPath);
    expect(release.bundledCore.version === coreRelease.version,
      `bundledCore.version ${release.bundledCore.version} != Core ${coreRelease.version} — run 'sh tools/sync-core.sh'`);
  }
}

if (fail.length) {
  console.error('Version metadata check failed:');
  for (const message of fail) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(`version metadata ok: ${version} (${channel}), bundled core ${release.bundledCore.version}`);
