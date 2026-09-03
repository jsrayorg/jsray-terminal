#!/usr/bin/env node
/**
 * Run the CLI as an installed package, not from this checkout.
 *
 * `npm test` runs the source tree, which proves the code works and says
 * nothing about the tarball. jsray-vscode shipped a package missing the
 * directory it reads at render time, and its source-tree suite passed all the
 * way through — the shape of failure only appears once something is installed.
 *
 * So: pack, install into a prefix of its own, and drive the binary npm linked.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = mkdtempSync(join(tmpdir(), 'jsray-cli-'));
const prefix = join(sandbox, 'install');

let failures = 0;
const check = (name, expected, actual) => {
  const ok = expected instanceof RegExp ? expected.test(actual) : expected === actual;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) {
    failures++;
    console.log(`       expected ${expected}\n       actual   ${JSON.stringify(actual)}`);
  }
};

try {
  const tarball = execFileSync('npm', ['pack', '--pack-destination', sandbox], {
    cwd: ROOT, encoding: 'utf8',
  }).trim().split('\n').pop();

  mkdirSync(prefix, { recursive: true });
  execFileSync('npm', ['init', '-y'], { cwd: prefix, stdio: 'ignore' });
  execFileSync('npm', ['install', '--silent', '--prefix', prefix, join(sandbox, tarball)], {
    stdio: 'ignore',
  });

  const bin = join(prefix, 'node_modules', '.bin', 'jsray');
  const sample = join(sandbox, 'sample.rs');
  writeFileSync(sample, "fn main() {\n    // don't do this\n    let s: &'static str = \"hi\";\n}\n");

  const run = (...args) => {
    try {
      return execFileSync(bin, args, { encoding: 'utf8' });
    } catch (error) {
      return (error.stdout || '') + (error.stderr || '');
    }
  };

  console.log('\n=== installed package ===');
  check('the binary is linked', true, existsSync(bin));
  check('it renders a file', /fn main\(\) \{/, run(sample, '--color', 'none'));
  // The bundled Core is the reason this project exists; a stale one renders
  // a Rust comment up to the first apostrophe and stops.
  check('the bundled Core is current', /don't do this/, run(sample, '--color', 'none'));
  check('the digests verify', /official build verified/, run('--verify-core'));
  check('every palette shipped', 'aurora\ndefault\nember\nfjord\n', run('--list-themes'));
  check('the languages shipped', 83, run('--list-languages').trim().split('\n').length);
  check('a theme other than the default works', /\x1b\[/, run(sample, '-t', 'ember', '--color', 'truecolor'));
  check('line numbers work', /1/, run(sample, '-n', '--color', 'none'));
  check('a missing file is a sentence', /no such file/, run(join(sandbox, 'nope.rs')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
