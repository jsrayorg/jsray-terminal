#!/usr/bin/env node
/**
 * jsray · JSRay code rendering for the terminal
 *
 *   jsray file.py                     highlight a file (language from name)
 *   cat x | jsray --lang js           highlight stdin
 *   jsray file --theme aurora --mode light
 *
 * Powered by the bundled JSRay Core tokenizer; colors come from the shared
 * palette JSON. Zero dependencies.
 */
import { readFileSync, existsSync, openSync, closeSync, writeSync, readSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import { basename, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  loadPalette, listPalettes, buildStyles, renderStream, withLineNumbers,
  verifyCore, loadCustomPalette, mergePalettes,
} from '../lib/ansi.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load a file this CLI ships with. An install missing one of these is not a
 * mistake the user made, and it should not read like one: unguarded, a short
 * package surfaced as a stack trace out of fs.readFileUtf8, which says nothing
 * about what is wrong or what to do.
 */
function shipped(relative, load) {
  const path = resolve(ROOT, relative);
  if (!existsSync(path)) {
    process.stderr.write(
      `jsray: ${relative} is missing from this installation.\n` +
      '       The package ships it; reinstall to restore it.\n'
    );
    process.exit(1);
  }
  return load(path);
}

const JSRay = shipped('vendor/jsray.cjs', (p) => require(p));
const VERSION = shipped('version.json', (p) => JSON.parse(readFileSync(p, 'utf8'))).version;

// Extension → language id (normalizeLanguage handles the aliases).
const EXT_LANG = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  dart: 'dart', lua: 'lua', sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'jsonc',
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html',
  xml: 'xml', svg: 'svg', vue: 'vue', css: 'css', scss: 'scss',
  sass: 'sass', less: 'less', r: 'r', pl: 'perl', pm: 'perl',
  ps1: 'powershell', psm1: 'powershell', ex: 'elixir', exs: 'elixir',
  hs: 'haskell', graphql: 'graphql', gql: 'graphql', toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  dockerfile: 'dockerfile', makefile: 'makefile', mk: 'makefile',
  diff: 'diff', patch: 'diff', scala: 'scala', sc: 'scala', m: 'objectivec',
};
const FILENAME_LANG = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
};

const HELP = `jsray ${VERSION} · JSRay code rendering for the terminal

Usage:
  jsray [file...] [options]     highlight files, or stdin when none / "-"

Options:
  -l, --lang <id>               language (default: from filename, else auto-detect)
  -r, --line-range <N:M>        only lines N through M (N: to end, :M from start)
  -t, --theme <name>            palette: ${listPalettes().join(', ')} (default: default)
  -m, --mode <dark|light>       theme variant
                                (default: matches the terminal background)
  -n, --line-numbers            show line numbers
      --color <auto|truecolor|256|none>
                                color output (default: auto)
      --palette <file.json>     custom palette layered over --theme
                                (the JSON the JSRay Theme Studio exports)
      --list-languages          print supported language ids
      --list-themes             print available themes
      --verify-core             check the bundled JSRay Core against its
                                official digests, then exit
  -h, --help                    show this help
  -v, --version                 print version
`;

function parseArgs(argv) {
  const opts = { files: [], lang: '', theme: 'default', mode: '', color: 'auto', lineNumbers: false, palette: '', range: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-l': case '--lang': opts.lang = argv[++i] || ''; break;
      case '-t': case '--theme': opts.theme = argv[++i] || 'default'; break;
      case '-m': case '--mode': opts.mode = argv[++i] || ''; break;
      case '--color': opts.color = argv[++i] || 'auto'; break;
      case '-n': case '--line-numbers': opts.lineNumbers = true; break;
      case '--list-languages': opts.listLanguages = true; break;
      case '--list-themes': opts.listThemes = true; break;
      case '--palette': opts.palette = argv[++i] || ''; break;
      case '-r': case '--line-range': opts.range = argv[++i] || ''; break;
      case '--verify-core': opts.verifyCore = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.showVersion = true; break;
      default:
        if (a.startsWith('-') && a !== '-') fail(`unknown option: ${a}\n\n${HELP}`);
        opts.files.push(a);
    }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(1);
}

/**
 * Parse `-r 10:20`, `-r 5:` (to the end) or `-r :20` (from the start).
 *
 * Returns null when no range was asked for, so the caller can tell "print
 * everything" from "print nothing".
 */
function parseRange(spec) {
  if (!spec) return null;

  const match = /^(\d*):(\d*)$/.exec(spec.trim()) || /^(\d+)$/.exec(spec.trim());
  if (!match) fail(`invalid --line-range: ${spec} (use N:M, N:, :M or N)`);

  const start = match[1] ? Number(match[1]) : 1;
  const end = match[2] === undefined ? start : (match[2] ? Number(match[2]) : Infinity);

  if (start < 1) fail('--line-range starts at line 1');
  if (end < start) fail(`--line-range ${spec} ends before it starts`);

  return { start, end };
}

/**
 * Take a line range out of already-rendered output.
 *
 * Line numbers keep counting from the file, not from the slice — a range is a
 * window onto a file, and renumbering it from 1 would misreport where the code
 * actually lives.
 */
function sliceLines(text, range, showNumbers) {
  const trailing = text.endsWith('\n');
  const lines = (trailing ? text.slice(0, -1) : text).split('\n');

  // A range that starts past the end selects nothing. Clamping the start the
  // way the end is clamped would instead hand back the last line, which is a
  // confident answer to a question the file cannot answer.
  if (range.start > lines.length) return '';

  const from = range.start;
  const to = Math.min(range.end === Infinity ? lines.length : range.end, lines.length);
  const picked = lines.slice(from - 1, to);

  if (!showNumbers) return picked.join('\n') + (trailing ? '\n' : '');

  const width = String(to).length;
  return picked
    .map((line, i) => `${String(from + i).padStart(width)} │ ${line}`)
    .join('\n') + (trailing ? '\n' : '');
}

/**
 * How many columns one code point occupies.
 *
 * CJK and fullwidth forms take two cells; combining marks take none. Anything
 * cleverer than this — emoji sequences, regional indicators — is a job for a
 * grapheme segmenter, and getting those wrong costs a column, not a line.
 */
function charWidth(cp) {
  if (cp >= 0x0300 && cp <= 0x036f) return 0; // combining diacriticals
  if (cp === 0x200b || cp === 0x200d || cp === 0xfeff) return 0; // joiners
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||   // hangul jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) ||   // CJK radicals through yi
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK compatibility
    (cp >= 0xfe30 && cp <= 0xfe6f) ||   // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) ||   // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji blocks in common use
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd);   // CJK extension B and beyond
  return wide ? 2 : 1;
}

/**
 * Wrap long lines so continuations line up under the code, not under the
 * gutter.
 *
 * Left to the terminal, a line longer than the window wraps to column 0, and
 * the continuation sits where a line number should be — reading as a line of
 * code that was never numbered. `less -N` and `cat -n` have the same problem;
 * having a gutter at all is what creates the obligation to keep it.
 *
 * Escape sequences occupy no columns and must not be counted, or every
 * coloured line would wrap early — which is the bug that shows up as ragged
 * right edges rather than as anything obviously broken.
 */
function wrapToGutter(text, gutter, columns) {
  // Under a certain width there is more gutter than code and wrapping stops
  // helping. Leave those lines to the terminal.
  if (columns - gutter < 16) return text;

  const indent = ' '.repeat(gutter);

  return text.split('\n').map((line) => {
    let out = '';
    let col = 0;

    for (let i = 0; i < line.length; ) {
      if (line[i] === '\x1b') {
        // SGR and friends: ESC [ ... final-byte. Zero width, copied verbatim.
        const end = line.indexOf('m', i);
        const stop = end === -1 ? line.length : end + 1;
        out += line.slice(i, stop);
        i = stop;
        continue;
      }

      const cp = line.codePointAt(i);
      const char = String.fromCodePoint(cp);
      const width = charWidth(cp);

      if (col + width > columns) {
        out += '\n' + indent;
        col = gutter;
      }
      out += char;
      col += width;
      i += char.length;
    }

    return out;
  }).join('\n');
}

/** The gutter color sequence, reused for the multi-file header rule. */
function gutterOpen(themeBlock, colorMode) {
  const probe = withLineNumbers('x', themeBlock, colorMode);
  const match = /^(\x1b\[[0-9;]*m)+/.exec(probe);
  return match ? match[0] : '';
}

function resolveColorMode(requested) {
  if (requested !== 'auto') {
    if (!['truecolor', '256', 'none'].includes(requested)) {
      fail(`invalid --color: ${requested} (auto|truecolor|256|none)`);
    }
    return requested;
  }
  if (!process.stdout.isTTY) return 'none';
  const ct = (process.env.COLORTERM || '').toLowerCase();
  return ct.includes('truecolor') || ct.includes('24bit') ? 'truecolor' : '256';
}

/** Relative luminance, the WCAG definition. 0 is black, 1 is white. */
function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Ask the terminal what its background is, with OSC 11.
 *
 * The reply is `ESC ] 11 ; rgb:rrrr/gggg/bbbb ST`, components of 1–4 hex
 * digits. Terminals that do not implement the query answer nothing at all —
 * there is no "unsupported" reply — so the read runs on a deadline and every
 * failure returns null.
 *
 * The query goes to /dev/tty rather than stdout so it still works when output
 * is being piped somewhere, and the tty is put back the way it was found
 * whatever happens on the way out.
 */
function queryBackground(timeoutMs = 100) {
  let fd = null;
  let raw = null;
  try {
    fd = openSync('/dev/tty', 'r+');
    raw = new ReadStream(fd);
    raw.setRawMode(true);
    writeSync(fd, '\x1b]11;?\x1b\\');

    const buffer = Buffer.alloc(64);
    const idle = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + timeoutMs;
    let reply = '';

    while (Date.now() < deadline) {
      let read = 0;
      try {
        read = readSync(fd, buffer, 0, buffer.length, null);
      } catch (error) {
        // Nothing typed yet. Anything else means the tty is not answering.
        if (error.code !== 'EAGAIN') break;
      }
      if (read > 0) {
        reply += buffer.toString('latin1', 0, read);
        if (/\x1b\\|\x07/.test(reply)) break; // terminator arrived
      } else {
        Atomics.wait(idle, 0, 0, 2); // sleep 2ms rather than spin
      }
    }

    const match = /rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(reply);
    if (!match) return null;

    // Components are scaled to their own width: "ff" and "ffff" are both full.
    return match.slice(1, 4).map((hex) => {
      const max = 16 ** hex.length - 1;
      return Math.round((parseInt(hex, 16) / max) * 255);
    });
  } catch {
    return null;
  } finally {
    try { raw?.setRawMode(false); } catch { /* the tty is already gone */ }
    try { raw?.destroy(); } catch { /* ditto */ }
    if (fd !== null && !raw) { try { closeSync(fd); } catch { /* ditto */ } }
  }
}

/**
 * Which theme variant to draw with.
 *
 * `dark` used to be a fixed default, which made it a guess about a screen this
 * process had never looked at. On a white terminal it guessed wrong and 21 of
 * the default palette's 25 colors landed under 3:1 contrast — a shebang line
 * in pale grey on white.
 *
 * So: the flag if it was given, then COLORFGBG (free, some terminals export
 * it), then the terminal itself. Nothing found still means dark, because an
 * unknown terminal should get exactly the behaviour this replaced.
 */
function resolveMode(requested, colorMode) {
  if (requested) {
    if (!['dark', 'light'].includes(requested)) fail(`invalid --mode: ${requested} (dark|light)`);
    return requested;
  }

  // With no color there is no theme to get wrong, and no reason to pay for a
  // round trip to the terminal.
  if (colorMode === 'none') return 'dark';

  // "15;0" or "15;default;0" — the last field is the background, as an ANSI
  // color index. 7 and 9-15 are the light half of the standard palette.
  const fgbg = (process.env.COLORFGBG || '').split(';').pop();
  if (/^\d+$/.test(fgbg)) {
    const index = Number(fgbg);
    return index === 7 || (index >= 9 && index <= 15) ? 'light' : 'dark';
  }

  const rgb = queryBackground();
  if (rgb) return luminance(rgb) > 0.4 ? 'light' : 'dark';

  return 'dark';
}

function languageFor(file, code, explicit) {
  if (explicit) return JSRay.normalizeLanguage(explicit);
  if (file && file !== '-') {
    const name = basename(file).toLowerCase();
    if (FILENAME_LANG[name]) return FILENAME_LANG[name];
    const ext = extname(name).slice(1);
    if (EXT_LANG[ext]) return JSRay.normalizeLanguage(EXT_LANG[ext]);
  }
  return JSRay.detectLanguage(code);
}

/**
 * A NUL byte in the first few kilobytes means this is not text.
 *
 * The heuristic git and grep use, and for the same reason: reading a PNG as
 * UTF-8 replaces every byte that is not valid UTF-8, so an 18KB image came out
 * as 33KB of replacement characters with an exit code of 0 — terminal state
 * mangled, nothing said. Checking the whole file would be exact and would also
 * mean reading a gigabyte in order to refuse it.
 */
function looksBinary(buffer) {
  const window = buffer.subarray(0, Math.min(buffer.length, 8192));
  return window.includes(0);
}

function readInput(file) {
  if (file && file !== '-') {
    // The stdin branch below has always caught its own failures; this one did
    // not, so a mistyped path answered with a Node stack trace naming
    // internal fs paths. Every other error this CLI can produce is one line.
    try {
      const buffer = readFileSync(file);
      if (looksBinary(buffer)) {
        fail(`${file} looks like a binary file — use cat if you meant to print it`);
      }
      return buffer.toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') fail(`no such file: ${file}`);
      if (error.code === 'EISDIR') fail(`${file} is a directory, not a file`);
      if (error.code === 'EACCES') fail(`cannot read ${file}: permission denied`);
      fail(`cannot read ${file}: ${error.message}`);
    }
  }
  // Bare `jsray` in an interactive terminal would block forever waiting for
  // stdin EOF and look like "nothing happens" — show help instead.
  if (process.stdin.isTTY && file !== '-') {
    process.stdout.write(HELP);
    process.exit(0);
  }
  try {
    const buffer = readFileSync(0); // stdin
    if (looksBinary(buffer)) fail('the input looks like binary data, not code');
    return buffer.toString('utf8');
  } catch {
    fail('no input: pass a file or pipe code on stdin (see --help)');
  }
}

// ---------------------------------------------------------------------------
// A downstream pipe closing early (`jsray file | head`) must end the program
// quietly, not crash with an unhandled EPIPE.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const opts = parseArgs(process.argv.slice(2));

if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.showVersion) { process.stdout.write(VERSION + '\n'); process.exit(0); }
if (opts.listThemes) { process.stdout.write(listPalettes().join('\n') + '\n'); process.exit(0); }

if (opts.verifyCore) {
  const report = verifyCore();
  const summary = {
    official: `official build verified — JSRay Core ${report.version}, ${report.checked} files`,
    modified: `MODIFIED — these files do not match JSRay Core ${report.version}: ${report.mismatched.join(', ')}`,
    unknown: 'unverified — no integrity manifest is bundled with this install',
  }[report.status];
  process.stdout.write(summary + '\n');
  process.exit(report.status === 'official' ? 0 : 1);
}

// A tampered engine is worth saying out loud, but not worth refusing to render
// over — the warning goes to stderr so it never contaminates a pipeline.
{
  const report = verifyCore();
  if (report.status === 'modified') {
    process.stderr.write(
      `jsray: warning — the bundled JSRay Core does not match its official build ` +
      `(${report.mismatched.join(', ')}). Reinstall to restore it; run 'jsray --verify-core' for detail.\n`
    );
  }
}
if (opts.listLanguages) {
  process.stdout.write(Object.keys(JSRay.languages).sort().join('\n') + '\n');
  process.exit(0);
}


const colorMode = resolveColorMode(opts.color);
const mode = resolveMode(opts.mode, colorMode);

let palette;
try {
  palette = loadPalette(opts.theme);

  if (opts.palette) {
    const { palette: custom, warnings } = loadCustomPalette(opts.palette);
    for (const warning of warnings) process.stderr.write(`jsray: ${warning}\n`);
    palette = mergePalettes(palette, custom);
  }
} catch (err) {
  fail(err.message);
}
const themeBlock = palette.themes[mode];
const styles = colorMode === 'none' ? null : buildStyles(themeBlock, colorMode);
const range = parseRange(opts.range);

// No file argument means stdin, which is one input rather than none.
const inputs = opts.files.length ? opts.files : [null];

inputs.forEach((file, index) => {
  const code = readInput(file);
  const lang = languageFor(file, code, opts.lang);

  // Unknown/undetected language degrades to plain text — never an error.
  const stream = lang && JSRay.languages[lang] ? JSRay.tokenize(code, lang) : [code];
  let output = renderStream(stream, styles);

  // Slicing happens after rendering, not before: a range starting inside a
  // block comment or a template literal still gets that token's colour,
  // because the whole file was tokenized. renderStream re-opens the active
  // style on every line, which is what makes a slice safe to take.
  if (range) output = sliceLines(output, range, opts.lineNumbers);
  else if (opts.lineNumbers) output = withLineNumbers(output, themeBlock, colorMode);

  // Only a terminal has a width to wrap to, and only a gutter can be wrapped
  // out from under. A pipe keeps getting the file's own lines.
  if (opts.lineNumbers && process.stdout.isTTY && process.stdout.columns) {
    // Measured off the rendered line rather than recomputed: the numbers are
    // padded to a width that depends on whether a range was taken, and a
    // second guess at it would be a second thing to keep in step.
    const first = output.split('\n', 1)[0].replace(/\x1b\[[0-9;]*m/g, '');
    const gutter = /^\s*\d+ │ /.exec(first);
    if (gutter) output = wrapToGutter(output, gutter[0].length, process.stdout.columns);
  }

  // A header only earns its line when there is more than one file to tell
  // apart; a single file is the common case and should look untouched.
  if (inputs.length > 1) {
    const label = file === null || file === '-' ? '(stdin)' : file;
    const rule = colorMode === 'none' ? '' : gutterOpen(themeBlock, colorMode);
    const reset = colorMode === 'none' ? '' : '\x1b[0m';
    process.stdout.write(`${index ? '\n' : ''}${rule}── ${label}${reset}\n`);
  }

  // A file that ends without a newline is written back without one. `cat`
  // does not add it, and `jsray f --color none > copy` should produce a copy —
  // an extra byte makes the two files differ, and an empty file come out one
  // byte long.
  //
  // On a terminal the newline is worth adding anyway, or the shell prompt
  // lands on the end of the last line. Same principle the colour default
  // already follows: what suits a screen is not what suits a pipe.
  const needsNewline = !output.endsWith('\n') && output !== '';
  process.stdout.write(needsNewline && process.stdout.isTTY ? output + '\n' : output);
});
