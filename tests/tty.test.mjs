// The theme variant is chosen by asking the terminal, and a terminal is the
// one thing a test suite does not have. So: make a real pty, put the CLI on
// the far end of it, and answer its OSC 11 query the way a terminal would.
//
// Everything here — raw mode, the deadline, the reply parse — is code that
// never runs when stdout is a pipe, which is to say it never runs anywhere
// else in this suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = resolve(ROOT, 'bin/jsray.mjs');

// A pty needs openpty(), which Node does not expose. Python's stdlib does.
const hasPython = spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status === 0;

/**
 * Run the CLI on a pty, optionally answering its background query.
 *
 * `background` is a hex color the fake terminal reports, or null for a
 * terminal that ignores the query — the case that has to keep working, since
 * it is every terminal that has never heard of OSC 11.
 */
function onPty(args, background, { timeoutMs = 5000 } = {}) {
  const script = `
import os, pty, select, sys, time

reply = ${background ? `b"\\x1b]11;rgb:${background}\\x1b\\\\"` : 'None'}
pid, fd = pty.fork()
if pid == 0:
    os.execvp("node", ["node", ${JSON.stringify(BIN)}] + ${JSON.stringify(args)})

# Read until the child closes the pty (EIO on macOS, empty read on Linux),
# answering the query on the way through the way a terminal would.
out = b""
answered = False
deadline = time.time() + ${timeoutMs / 1000}
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.1)
    if not r:
        continue
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
    if reply is not None and not answered and b"]11;?" in out:
        os.write(fd, reply)
        answered = True

os.waitpid(pid, os.WNOHANG)
sys.stdout.buffer.write(out)
`;
  return execFileSync('python3', ['-c', script], { encoding: 'latin1', timeout: timeoutMs + 5000 });
}

// The CLI reads a file rather than stdin here: on a pty, stdin *is* the
// terminal, and a CLI waiting for a Ctrl-D that never comes proves nothing.
const SAMPLE = join(mkdtempSync(join(tmpdir(), 'jsray-tty-')), 'sample.js');
writeFileSync(SAMPLE, 'const x = 1;\n');

test('a light terminal gets the light theme', { skip: !hasPython && 'python3 with pty is unavailable' }, () => {
  const out = onPty(['--color', 'truecolor', SAMPLE], 'ffff/ffff/ffff');

  // #AD3DA4 — the light theme's keyword. On a white terminal the dark theme's
  // #D08BFC lands at 1.9:1 contrast, which is why this is worth a pty.
  assert.match(out, /\x1b\[38;2;173;61;164m/, `light keyword missing from: ${JSON.stringify(out.slice(0, 400))}`);
  assert.doesNotMatch(out, /\x1b\[38;2;208;139;252m/, 'dark keyword on a white background');
});

test('a dark terminal gets the dark theme', { skip: !hasPython && 'python3 with pty is unavailable' }, () => {
  const out = onPty(['--color', 'truecolor', SAMPLE], '1c1c/1c1c/1e1e');
  assert.match(out, /\x1b\[38;2;208;139;252m/, 'dark keyword missing');
});

test('a terminal that ignores the query still renders, and stays dark', { skip: !hasPython && 'python3 with pty is unavailable' }, () => {
  // No reply is not an error: OSC 11 has no "unsupported" answer, only
  // silence. Silence means the default this replaced — never a hang, and
  // never a half-rendered file.
  const started = Date.now();
  const out = onPty(['--color', 'truecolor', SAMPLE], null);
  const elapsed = Date.now() - started;

  assert.match(out, /\x1b\[38;2;208;139;252m/, 'nothing rendered without a reply');
  assert.ok(elapsed < 4000, `waited ${elapsed}ms on a silent terminal`);
});

test('--mode wins over the terminal, and skips the query', { skip: !hasPython && 'python3 with pty is unavailable' }, () => {
  // A white terminal, told to be dark. The flag is the user's own answer to
  // the question the query asks, so the query should not be asked at all.
  const out = onPty(['--color', 'truecolor', '--mode', 'dark', SAMPLE], 'ffff/ffff/ffff');
  assert.match(out, /\x1b\[38;2;208;139;252m/, 'the flag did not win');
  assert.ok(!out.includes(']11;?'), 'asked the terminal a question it had already been answered');
});

test('COLORFGBG answers without a round trip', () => {
  // Terminals that export it have already said what the background is.
  const run = (bg) => execFileSync('node', [BIN, '--lang', 'js', '--color', 'truecolor'], {
    input: 'const x = 1;',
    encoding: 'utf8',
    env: { ...process.env, COLORFGBG: bg },
  });

  assert.match(run('0;15'), /\x1b\[38;2;173;61;164m/, 'bg 15 is a light background');
  assert.match(run('15;0'), /\x1b\[38;2;208;139;252m/, 'bg 0 is a dark background');

  // "default" is not a color index and must not be read as one.
  assert.match(run('15;default'), /\x1b\[38;2;208;139;252m/, 'unparseable COLORFGBG should fall back');
});
