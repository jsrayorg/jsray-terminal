// ANSI renderer unit tests: color math, style building, stream walking.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  loadPalette, listPalettes, buildStyles, renderStream, rgbTo256, withLineNumbers,
  verifyCore, loadCustomPalette, mergePalettes,
} from '../lib/ansi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);
const JSRay = require('../vendor/jsray.cjs');

test('rgbTo256: cube corners and gray ramp', () => {
  assert.equal(rgbTo256([0, 0, 0]), 16);        // black → cube floor
  assert.equal(rgbTo256([255, 255, 255]), 231); // white → cube ceiling
  assert.equal(rgbTo256([128, 128, 128]), 232 + Math.round(((128 - 8) / 247) * 23));
  assert.equal(rgbTo256([255, 0, 0]), 16 + 36 * 5); // pure red
});

test('listPalettes exposes the four synced palettes', () => {
  assert.deepEqual(listPalettes(), ['aurora', 'default', 'ember', 'fjord']);
});

test('buildStyles: sequences are reset-prefixed and carry palette styles', () => {
  const dark = loadPalette('default').themes.dark;
  const styles = buildStyles(dark, 'truecolor');
  assert.match(styles['tk-keyword'], /^\x1b\[0m\x1b\[38;2;/);
  assert.match(styles['tk-keyword'], /\x1b\[1m$/, 'keyword is bold');
  assert.match(styles['tk-var-param'], /\x1b\[3m$/, 'parameter is italic');
  assert.match(styles['tk-md-italic'], /\x1b\[3m$/);
});

test('renderStream: nested tokens resume the parent style', () => {
  // JS template literal: the ${} placeholder is tokenized *inside* the
  // tk-string token, so after the punct child closes, the trailing
  // backtick must re-open the string color.
  const dark = loadPalette('default').themes.dark;
  const styles = buildStyles(dark, 'truecolor');
  const stream = JSRay.tokenize('const s = `hi ${name} bye`;', 'js');
  const out = renderStream(stream, styles);
  const stringOpen = styles['tk-string'];
  const first = out.indexOf(stringOpen);
  const second = out.indexOf(stringOpen, first + 1);
  assert.ok(first !== -1 && second !== -1, 'string style re-opened after interpolation');
  assert.ok(out.endsWith('\x1b[0m'), 'output ends with a reset');
});

test('renderStream: null styles produce byte-identical plain text', () => {
  const code = 'const x = fn(a);\nreturn `t ${x}`;';
  const stream = JSRay.tokenize(code, 'js');
  assert.equal(renderStream(stream, null), code);
});

test('every palette builds styles for both modes in both color depths', () => {
  for (const name of listPalettes()) {
    const palette = loadPalette(name);
    for (const mode of ['dark', 'light']) {
      for (const depth of ['truecolor', '256']) {
        const styles = buildStyles(palette.themes[mode], depth);
        assert.ok(Object.keys(styles).length > 20, `${name}/${mode}/${depth}`);
      }
    }
  }
});

test('withLineNumbers: pads to width and prefixes every line', () => {
  const out = withLineNumbers('a\nb\nc', loadPalette('default').themes.dark, 'none');
  assert.deepEqual(out.split('\n'), ['1 │ a', '2 │ b', '3 │ c']);
  const eleven = withLineNumbers(Array(11).fill('x').join('\n'), loadPalette('default').themes.dark, 'none');
  assert.match(eleven.split('\n')[0], /^ 1 │ x$/);
  assert.match(eleven.split('\n')[10], /^11 │ x$/);
});

test('buildStyles: refined keys fall back to their base family', () => {
  const themeBlock = {
    foreground: '#ffffff',
    tokens: {
      'function': { color: '#123456' },
      'variable': { color: '#abcdef' },
    },
  };
  const styles = buildStyles(themeBlock, 'truecolor');
  assert.equal(styles['tk-fn-decl'], styles['tk-function'].replace('\x1b[1m', '') + '\x1b[1m',
    'declaration inherits function color, keeps its forced bold');
  assert.ok(styles['tk-fn-builtin'].includes('18;52;86'.split(';').join(';')) || styles['tk-fn-builtin'].includes('38;2;18;52;86'),
    'builtin falls back to function color');
  assert.ok(styles['tk-var-param'].includes('38;2;171;205;239'), 'parameter falls back to variable color');
});

// --- core integrity & custom palettes ---------------------------------------

test('the bundled Core verifies against its official digests', () => {
  const report = verifyCore();
  assert.equal(report.status, 'official', `mismatched: ${report.mismatched.join(', ')}`);
  assert.ok(report.checked >= 6, 'the engine and every palette should be covered');
  assert.match(report.version, /^\d+\.\d+\.\d+/);
});

test('a modified engine is detected', () => {
  // Tampering with the tracked engine works until a run is interrupted, and
  // then the repository is left holding a corrupted renderer. Verify a copy.
  const dir = mkdtempSync(join(tmpdir(), 'jsray-cli-'));
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'core-integrity.json'), 'utf8'));
  writeFileSync(join(dir, 'core-integrity.json'), JSON.stringify(manifest));
  for (const file of Object.keys(manifest.files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(resolve(ROOT, file), join(dir, file));
  }

  assert.equal(verifyCore(dir).status, 'official', 'the copy starts intact');

  appendFileSync(join(dir, 'vendor/jsray.cjs'), '\n// tampered\n');
  const report = verifyCore(dir);

  assert.equal(report.status, 'modified');
  assert.deepEqual(report.mismatched, ['vendor/jsray.cjs']);
  assert.equal(verifyCore().status, 'official', 'the real install is untouched');
});

test('the token map is derived from the bundled vocabulary, not transcribed', () => {
  const vocabulary = JSON.parse(readFileSync(resolve(ROOT, 'vocabulary.json'), 'utf8'));
  const styles = buildStyles(loadPalette('default').themes.dark, 'truecolor');

  // Every token Core declares must produce a style, or a Core that grows a
  // token would render unstyled here.
  for (const suffix of Object.values(vocabulary.tokens)) {
    assert.ok(styles[`tk-${suffix}`], `tk-${suffix} has no terminal style`);
  }
});

test('a custom palette layers over the built-in one', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'jsray-palette-')), 'neon.json');
  writeFileSync(file, JSON.stringify({
    themes: { dark: { tokens: { keyword: { color: '#FF00AA', fontStyle: 'bold' } } } },
  }));

  const { palette, warnings } = loadCustomPalette(file);
  assert.deepEqual(warnings, []);

  const merged = mergePalettes(loadPalette('default'), palette);
  assert.equal(merged.themes.dark.tokens.keyword.color, '#FF00AA');
  // Untouched tokens keep the built-in value.
  assert.equal(
    merged.themes.dark.tokens.string.color,
    loadPalette('default').themes.dark.tokens.string.color
  );
});

test('a custom palette cannot smuggle in non-colors or unknown tokens', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'jsray-palette-')), 'bad.json');
  writeFileSync(file, JSON.stringify({
    themes: { dark: { tokens: {
      keyword: { color: '#FF00AA' },
      string: { color: '\x1b[31m' },              // an escape sequence, not a color
      number: { color: 'red; rm -rf /' },
      'lifetime.annotation': { color: '#123456' }, // from a newer Core
    } } },
  }));

  const { palette, warnings } = loadCustomPalette(file);
  const tokens = palette.themes.dark.tokens;

  assert.deepEqual(Object.keys(tokens), ['keyword'], 'only the valid token survives');
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => w.includes('lifetime.annotation')));
});

test('a palette file with no usable theme is rejected outright', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'jsray-palette-')), 'empty.json');
  writeFileSync(file, JSON.stringify({ themes: { solarized: {} } }));
  assert.throws(() => loadCustomPalette(file), /no usable dark or light theme/);
  assert.throws(() => loadCustomPalette('/nope/missing.json'), /not found/);
});
