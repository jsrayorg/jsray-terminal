/**
 * JSRay Terminal · ANSI renderer
 *
 * Consumes the renderer-agnostic token stream from JSRay.tokenize() and
 * emits ANSI escape sequences. Color and style come from the shared JSRay
 * palette JSON (tokens.json shape) — the same single source of truth the
 * web themes and VS Code themes are generated from.
 *
 * Color modes:
 *   truecolor  24-bit  \x1b[38;2;R;G;Bm
 *   256        xterm palette, downsampled from the palette hex
 *   none       plain text
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PALETTES_DIR = resolve(ROOT, 'palettes');

// tk-* class → palette token key. Inverse of Core's THEME_ALIAS, plus the
// markdown-specific classes which reuse shared colors exactly as
// src/jsray.css binds them.
const TOKEN_KEY = {
  'tk-keyword': 'keyword',
  'tk-function': 'function',
  'tk-fn-decl': 'function.declaration',
  'tk-fn-builtin': 'function.builtin',
  'tk-var': 'variable',
  'tk-var-param': 'variable.parameter',
  'tk-var-builtin': 'variable.builtin',
  'tk-var-const': 'variable.constant',
  'tk-type': 'type',
  'tk-property': 'property',
  'tk-string': 'string',
  'tk-regex': 'string.regex',
  'tk-number': 'number',
  'tk-comment': 'comment',
  'tk-doc': 'comment.doc',
  'tk-decorator': 'decorator',
  'tk-operator': 'operator',
  'tk-punct': 'punctuation',
  'tk-tag': 'tag',
  'tk-attr': 'attribute',
  'tk-selector': 'selector',
  'tk-css-prop': 'css.property',
  'tk-css-unit': 'css.unit',
  'tk-md-heading': 'keyword',
  'tk-md-code': 'string.regex',
  'tk-md-link': 'number',
  'tk-md-list': 'decorator',
};

// Extra terminal styling for classes jsray.css styles via font rules.
const FORCED_STYLE = {
  'tk-keyword': 'bold',
  'tk-fn-decl': 'bold',
  'tk-var-builtin': 'bold',
  'tk-var-param': 'italic',
  'tk-comment': 'italic',
  'tk-doc': 'italic',
  'tk-md-heading': 'bold',
  'tk-md-bold': 'bold',
  'tk-md-italic': 'italic',
};

export function listPalettes() {
  return readdirSync(PALETTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'))
    .sort();
}

export function loadPalette(name) {
  const path = resolve(PALETTES_DIR, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`unknown theme "${name}" — available: ${listPalettes().join(', ')}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Nearest xterm-256 index for an RGB triple (6×6×6 cube + grayscale ramp). */
export function rgbTo256([r, g, b]) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const level = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

/**
 * Build a tk-class → SGR-open-sequence map for one theme block.
 * Every sequence starts with a full reset so nested tokens can simply
 * re-open their parent's style afterwards — styles never leak.
 */
export function buildStyles(themeBlock, colorMode) {
  if (colorMode === 'none') return null;
  const styles = {};
  const fgSeq = colorFor(themeBlock.foreground, colorMode);

  for (const [cls, key] of Object.entries(TOKEN_KEY)) {
    const tok = themeBlock.tokens[key];
    if (!tok) continue;
    styles[cls] = sgr(tok.color, tok.fontStyle || FORCED_STYLE[cls], colorMode);
  }
  // Markdown bold/italic carry the plain foreground with a style.
  styles['tk-md-bold'] = sgr(themeBlock.foreground, 'bold', colorMode);
  styles['tk-md-italic'] = sgr(themeBlock.foreground, 'italic', colorMode);
  styles.__fg = `\x1b[0m${fgSeq}`;
  return styles;
}

function colorFor(hex, colorMode) {
  const rgb = hexToRgb(hex);
  return colorMode === '256'
    ? `\x1b[38;5;${rgbTo256(rgb)}m`
    : `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function sgr(hex, fontStyle, colorMode) {
  let seq = `\x1b[0m${colorFor(hex, colorMode)}`;
  if (fontStyle === 'bold') seq += '\x1b[1m';
  if (fontStyle === 'italic') seq += '\x1b[3m';
  return seq;
}

/**
 * Render a JSRay token stream to an ANSI string.
 * `styles` comes from buildStyles(); pass null for plain text.
 */
export function renderStream(stream, styles) {
  if (!styles) return plainText(stream);
  const out = [];
  walk(stream, styles.__fg, styles, out);
  out.push('\x1b[0m');
  return out.join('');
}

function walk(node, activeStyle, styles, out) {
  if (typeof node === 'string') {
    out.push(activeStyle + node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, activeStyle, styles, out);
    return;
  }
  const style = styles[node.type] || activeStyle;
  walk(node.content, style, styles, out);
}

function plainText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(plainText).join('');
  return plainText(node.content);
}

/** Prefix 1-based line numbers in the gutter color. */
export function withLineNumbers(text, themeBlock, colorMode) {
  const lines = text.split('\n');
  const width = String(lines.length).length;
  const gutterOpen = colorMode === 'none'
    ? ''
    : `\x1b[0m${colorFor(themeBlock.gutter || '#888888', colorMode)}`;
  const gutterClose = colorMode === 'none' ? '' : '\x1b[0m';
  return lines
    .map((line, i) => `${gutterOpen}${String(i + 1).padStart(width)} │ ${gutterClose}${line}`)
    .join('\n');
}
