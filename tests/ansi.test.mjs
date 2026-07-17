// ANSI renderer unit tests: color math, style building, stream walking.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { loadPalette, listPalettes, buildStyles, renderStream, rgbTo256, withLineNumbers } from '../lib/ansi.mjs';

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
