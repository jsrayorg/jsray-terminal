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
import { readFileSync } from 'node:fs';
import { basename, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  loadPalette, listPalettes, buildStyles, renderStream, withLineNumbers,
  verifyCore, loadCustomPalette, mergePalettes,
} from '../lib/ansi.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSRay = require(resolve(ROOT, 'vendor/jsray.cjs'));
const VERSION = JSON.parse(readFileSync(resolve(ROOT, 'version.json'), 'utf8')).version;

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
  jsray [file] [options]        highlight a file, or stdin when no file / "-"

Options:
  -l, --lang <id>               language (default: from filename, else auto-detect)
  -t, --theme <name>            palette: ${listPalettes().join(', ')} (default: default)
  -m, --mode <dark|light>       theme variant (default: dark)
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
  const opts = { file: null, lang: '', theme: 'default', mode: 'dark', color: 'auto', lineNumbers: false, palette: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-l': case '--lang': opts.lang = argv[++i] || ''; break;
      case '-t': case '--theme': opts.theme = argv[++i] || 'default'; break;
      case '-m': case '--mode': opts.mode = argv[++i] || 'dark'; break;
      case '--color': opts.color = argv[++i] || 'auto'; break;
      case '-n': case '--line-numbers': opts.lineNumbers = true; break;
      case '--list-languages': opts.listLanguages = true; break;
      case '--list-themes': opts.listThemes = true; break;
      case '--palette': opts.palette = argv[++i] || ''; break;
      case '--verify-core': opts.verifyCore = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.showVersion = true; break;
      default:
        if (a.startsWith('-') && a !== '-') fail(`unknown option: ${a}\n\n${HELP}`);
        if (opts.file !== null) fail('only one input file is supported');
        opts.file = a;
    }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(1);
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

function readInput(file) {
  if (file && file !== '-') return readFileSync(file, 'utf8');
  // Bare `jsray` in an interactive terminal would block forever waiting for
  // stdin EOF and look like "nothing happens" — show help instead.
  if (process.stdin.isTTY && file !== '-') {
    process.stdout.write(HELP);
    process.exit(0);
  }
  try {
    return readFileSync(0, 'utf8'); // stdin
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

if (!['dark', 'light'].includes(opts.mode)) fail(`invalid --mode: ${opts.mode} (dark|light)`);

const code = readInput(opts.file);
const colorMode = resolveColorMode(opts.color);
const lang = languageFor(opts.file, code, opts.lang);

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
const themeBlock = palette.themes[opts.mode];

// Unknown/undetected language degrades to plain text — never an error.
const stream = lang && JSRay.languages[lang] ? JSRay.tokenize(code, lang) : [code];
const styles = colorMode === 'none' ? null : buildStyles(themeBlock, colorMode);
let output = renderStream(stream, styles);
if (opts.lineNumbers) output = withLineNumbers(output, themeBlock, colorMode);

process.stdout.write(output.endsWith('\n') ? output : output + '\n');
