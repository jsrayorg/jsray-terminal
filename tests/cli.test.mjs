// End-to-end CLI tests: spawn the real bin with controlled stdin/argv.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, execSync } from 'node:child_process';
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

  // Every run ends with a reset, or the colour of the last token leaks into
  // whatever the terminal prints next. The newline after it is not added here:
  // the input had none, this is a pipe, and `jsray f > copy` has to produce a
  // copy. On a terminal one is appended so the prompt starts on its own line.
  assert.ok(out.endsWith('\x1b[0m'), 'output must end with a reset');
});

test('a pipe gets the bytes that came in, a terminal gets a newline', () => {
  // `cat` does not add a trailing newline and neither does this: an extra byte
  // makes `jsray f --color none > copy` differ from f, and turns an empty file
  // into a one-byte one. Only a TTY gets the courtesy newline, which is the
  // same rule the colour default already follows.
  assert.equal(run(['-l', 'js', '--color', 'none'], 'const x = 1;'), 'const x = 1;');
  assert.equal(run(['-l', 'js', '--color', 'none'], 'const x = 1;\n'), 'const x = 1;\n');
  assert.equal(run(['-l', 'js', '--color', 'none'], ''), '');
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

test('early-closing downstream pipe does not crash (EPIPE)', () => {

  // head closes the pipe after 1 line; jsray must exit cleanly (status 0)
  const out = execSync(
    `printf 'a\\nb\\nc\\n' | node ${JSON.stringify(BIN)} --lang js --color truecolor | head -1; echo "rc=$?"`,
    { encoding: 'utf8', shell: '/bin/sh' }
  );
  assert.match(out, /rc=0/);
});

test('an unreadable file is one line of explanation, not a stack trace', () => {
  // Every other error this CLI produces is a single line — a bad theme name, a
  // missing palette file, an unknown flag. The input path was the one that
  // answered with Node's own trace, naming internal fs paths at the reader.
  const fails = (args) => {
    try {
      execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: 'pipe' });
      return null;
    } catch (error) {
      return { status: error.status, stderr: error.stderr || '' };
    }
  };

  const missing = fails(['/nonexistent-jsray-test.js']);
  assert.ok(missing, 'a missing file should exit non-zero');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no such file: \/nonexistent-jsray-test\.js/);
  assert.doesNotMatch(missing.stderr, /node:fs|at readFileSync/,
    'the error still leaks a stack trace');

  const dir = fails(['/etc']);
  assert.ok(dir, 'a directory should exit non-zero');
  assert.match(dir.stderr, /is a directory, not a file/);
});

test('a binary file is refused, not decoded into garbage', () => {
  // An 18KB PNG read as UTF-8 came out as 33KB of replacement characters with
  // an exit code of 0: the terminal left in a mangled state and nothing said
  // about why. A NUL byte early in the file is the same signal git and grep
  // use, so a source file with one is refused too — consistently, not silently.
  const dir = mkdtempSync(join(tmpdir(), 'jsray-bin-'));
  const png = join(dir, 'image.png');
  writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));

  const fails = (args, input) => {
    try {
      execFileSync('node', [BIN, ...args], { input, encoding: 'utf8', stdio: 'pipe' });
      return null;
    } catch (error) {
      return { status: error.status, stderr: error.stderr || '' };
    }
  };

  const file = fails([png]);
  assert.ok(file, 'a binary file should exit non-zero');
  assert.equal(file.status, 1);
  assert.match(file.stderr, /looks like a binary file/);

  const piped = fails(['-l', 'js'], Buffer.from([0x00, 0x01, 0x02, 0x03]));
  assert.ok(piped, 'binary on stdin should exit non-zero');
  assert.match(piped.stderr, /binary data, not code/);

  // Text that merely contains high bytes is still text.
  assert.equal(run(['-l', 'js', '--color', 'none'], 'const s = "日本語";'), 'const s = "日本語";');
});

test('line numbers count lines, not newlines', () => {
  // A file ending in a newline splits into a final empty string that marks the
  // position after the last line rather than a line of its own. Numbering it
  // reported one more line than the file has, and one more than `cat -n`.
  const two = run(['-l', 'js', '-n', '--color', 'none'], 'a\nb\n');
  assert.equal(two.replace(/\n$/, '').split('\n').length, 2,
    `two lines of input produced: ${JSON.stringify(two)}`);
  assert.match(two, /1 │ a\n2 │ b/);
  assert.doesNotMatch(two, /3 │/);

  const noEol = run(['-l', 'js', '-n', '--color', 'none'], 'a\nb');
  assert.match(noEol, /1 │ a\n2 │ b/);
  assert.doesNotMatch(noEol, /3 │/);

  // Ten lines cross the padding-width boundary.
  const ten = run(['-l', 'js', '-n', '--color', 'none'], 'x\n'.repeat(10));
  assert.match(ten, /10 │ x/);
  assert.doesNotMatch(ten, /11 │/);
});

test('--line-range takes a window onto the file', () => {
  const five = 'one\ntwo\nthree\nfour\nfive\n';

  assert.equal(run(['-l', 'js', '-r', '2:4', '--color', 'none'], five), 'two\nthree\nfour\n');
  assert.equal(run(['-l', 'js', '-r', '4:', '--color', 'none'], five), 'four\nfive\n');
  assert.equal(run(['-l', 'js', '-r', ':2', '--color', 'none'], five), 'one\ntwo\n');
  assert.equal(run(['-l', 'js', '-r', '3', '--color', 'none'], five), 'three\n');

  // A range past the end selects nothing. Clamping the start instead would
  // hand back the last line — a confident answer to a question the file
  // cannot answer.
  // Nothing selected is nothing written — a bare newline would be a line that
  // the file does not have.
  assert.equal(run(['-l', 'js', '-r', '9:99', '--color', 'none'], five), '');

  // Numbers count from the file, not from the slice: a range is a window, and
  // renumbering from 1 would misreport where the code lives.
  assert.match(run(['-l', 'js', '-r', '2:3', '-n', '--color', 'none'], five), /2 │ two\n3 │ three/);
});

test('a slice of a multi-line token keeps its color', () => {
  // Tokens span lines — block comments, template literals — and the renderer
  // used to open a colour once, leaving continuation lines bare. Any slice
  // then produced a plain line where the file had a coloured one.
  const middle = run(['-l', 'js', '-r', '2:2', '--color', '256'], '/* a\n   b\n   c */\n');
  assert.match(middle, /^\x1b\[/, `the sliced line carries no style: ${JSON.stringify(middle)}`);
  assert.match(middle, /b/);
});

test('several files are labelled; one file is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jsray-multi-'));
  const a = join(dir, 'a.js');
  const b = join(dir, 'b.py');
  writeFileSync(a, 'const a = 1;\n');
  writeFileSync(b, 'def f():\n    pass\n');

  const both = run([a, b, '--color', 'none']);
  assert.ok(both.includes(`── ${a}`), `no header for ${a}: ${JSON.stringify(both)}`);
  assert.ok(both.includes(`── ${b}`), `no header for ${b}`);
  assert.match(both, /const a = 1;/);
  assert.match(both, /def f\(\):/);

  // A lone file is the common case and should look untouched.
  assert.equal(run([a, '--color', 'none']), 'const a = 1;\n');
});
