// End-to-end CLI tests: spawn the real bin with controlled stdin/argv.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = resolve(ROOT, 'bin/jsray.mjs');

function run(args, input) {
  return execFileSync('node', [BIN, ...args], { input, encoding: 'utf8' });
}

test('--color none round-trips the input text exactly', () => {
  const code = 'const x = 1;\nconsole.log(x);\n';
  assert.equal(run(['--lang', 'js', '--color', 'none'], code), code);
});

test('truecolor output carries 24-bit sequences and bold keywords', () => {
  const out = run(['--lang', 'js', '--color', 'truecolor'], 'const x = 1;');
  assert.match(out, /\x1b\[38;2;208;139;252m\x1b\[1mconst/); // default dark keyword
  assert.ok(out.endsWith('\x1b[0m\n'));
});

test('--color 256 uses xterm palette sequences', () => {
  const out = run(['--lang', 'js', '--color', '256'], 'const x = 1;');
  assert.match(out, /\x1b\[38;5;\d+m/);
  assert.ok(!out.includes('[38;2;'), 'no truecolor sequences in 256 mode');
});

test('language comes from the file extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jsray-cli-'));
  const file = join(dir, 'sample.py');
  writeFileSync(file, 'def greet(n):\n    print(n)\n');
  const out = run([file, '--color', 'truecolor']);
  assert.match(out, /\x1b\[38;2;/);
  assert.match(out, /def/);
});

test('Dockerfile is recognized by filename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jsray-cli-'));
  const file = join(dir, 'Dockerfile');
  writeFileSync(file, 'FROM node:18\nRUN npm ci\n');
  const out = run([file, '--color', 'truecolor']);
  assert.match(out, /\x1b\[38;2;208;139;252m\x1b\[1mFROM/);
});

test('stdin with no --lang auto-detects', () => {
  const out = run(['--color', 'truecolor'], 'def greet(n):\n    print(n)\n');
  assert.match(out, /\x1b\[38;2;/, 'python detected and colored');
});

test('undetectable input degrades to plain text without error', () => {
  const prose = 'plain prose that is not code at all\n';
  assert.equal(run(['--color', 'none'], prose), prose);
});

test('--theme aurora changes the keyword color', () => {
  const out = run(['--lang', 'js', '--theme', 'aurora', '--color', 'truecolor'], 'const x = 1;');
  assert.match(out, /\x1b\[38;2;176;140;255m\x1b\[1mconst/); // aurora dark keyword #B08CFF
});

test('--mode light uses the light block', () => {
  const out = run(['--lang', 'js', '--mode', 'light', '--color', 'truecolor'], 'const x = 1;');
  assert.match(out, /\x1b\[38;2;173;61;164m\x1b\[1mconst/); // default light keyword #AD3DA4
});

test('-n adds line numbers', () => {
  const out = run(['--lang', 'js', '--color', 'none', '-n'], 'const a = 1;\nconst b = 2;');
  assert.deepEqual(out.trimEnd().split('\n'), ['1 │ const a = 1;', '2 │ const b = 2;']);
});

test('--list-themes and --list-languages enumerate', () => {
  assert.deepEqual(run(['--list-themes']).trim().split('\n'), ['aurora', 'default', 'ember', 'fjord']);
  const langs = run(['--list-languages']).trim().split('\n');
  assert.ok(langs.includes('python') && langs.includes('elixir') && langs.length > 70);
});

test('invalid flags exit non-zero', () => {
  for (const args of [['--mode', 'sepia'], ['--color', 'cmyk'], ['--theme', 'nope'], ['--bogus']]) {
    assert.throws(() => run(args, 'x'), /Command failed|exit/i.test('') ? undefined : Error, args.join(' '));
  }
});
