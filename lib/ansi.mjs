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
import { createHash } from 'node:crypto';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PALETTES_DIR = resolve(ROOT, 'palettes');

// tk-* class → palette token key, derived from the vocabulary Core ships with
// the snapshot. Keeping a transcription here is how a Core that grows a token
// ends up silently unstyled in the terminal.
const VOCABULARY = JSON.parse(readFileSync(resolve(ROOT, 'vocabulary.json'), 'utf8'));

const TOKEN_KEY = Object.fromEntries(
  Object.entries(VOCABULARY.tokens).map(([key, suffix]) => [`tk-${suffix}`, key])
);

// Markdown-specific classes reuse shared colors exactly as src/jsray.css binds
// them; they have no palette key of their own.
Object.assign(TOKEN_KEY, {
  'tk-md-heading': 'keyword',
  'tk-md-code': 'string.regex',
  'tk-md-link': 'number',
  'tk-md-list': 'decorator',
});
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

/** The actual RGB values of the xterm 6×6×6 cube levels. */
const CUBE = [0, 95, 135, 175, 215, 255];

/**
 * Nearest xterm-256 index for an RGB triple (6×6×6 cube + grayscale ramp).
 * Each channel snaps to the nearest *actual* cube level — naive proportional
 * rounding (v/255*5) lands up to ±40 RGB away and can collapse two distinct
 * palette colors into the same cell.
 */
export function rgbTo256([r, g, b]) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const level = (v) => {
    let best = 0;
    for (let i = 1; i < CUBE.length; i++) {
      if (Math.abs(CUBE[i] - v) < Math.abs(CUBE[best] - v)) best = i;
    }
    return best;
  };
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
    // Fallback chain: missing refined keys resolve through their base
    // (function.declaration → function) so older palettes keep working
    // when the token vocabulary grows.
    let k = key, tok = null;
    while (k && !(tok = themeBlock.tokens[k])) {
      const dot = k.lastIndexOf('.');
      k = dot === -1 ? '' : k.slice(0, dot);
    }
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

// --- core integrity ---------------------------------------------------------

/**
 * Verify the bundled Core snapshot against the digests Core published.
 *
 * This CLI runs the engine straight off disk, so the file that renders your
 * code is one `npm install` postinstall script or one careless edit away from
 * being something else. Hashing ~70KB costs well under a millisecond against
 * Node's own startup, so it runs on every invocation rather than on request.
 *
 * @returns {{status: 'official'|'modified'|'unknown', version: string, mismatched: string[], checked: number}}
 */
export function verifyCore() {
  const manifestPath = resolve(ROOT, 'core-integrity.json');

  if (!existsSync(manifestPath)) {
    return { status: 'unknown', version: '', mismatched: [], checked: 0 };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const mismatched = [];
  let checked = 0;

  for (const [file, expected] of Object.entries(manifest.files ?? {})) {
    const path = resolve(ROOT, file);

    if (!existsSync(path)) {
      mismatched.push(file);
      continue;
    }

    const actual = 'sha256-' + createHash('sha256').update(readFileSync(path)).digest('base64');
    checked++;

    if (actual !== expected) mismatched.push(file);
  }

  return {
    status: mismatched.length ? 'modified' : 'official',
    version: manifest.version ?? '',
    mismatched,
    checked,
  };
}

// --- custom palettes --------------------------------------------------------

const COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Load and validate a user-supplied palette file.
 *
 * Accepts the same JSON every other JSRay surface uses — the shape the Theme
 * Studio exports — so one palette file works in the terminal, on the web, and
 * in the editor. Keys are checked against the bundled vocabulary; unknown ones
 * are reported and skipped rather than fatal, so a palette written for a newer
 * Core still renders on this one.
 *
 * @param {string} path Path to a palette JSON file.
 * @returns {{palette: object, warnings: string[]}}
 */
export function loadCustomPalette(path) {
  if (!existsSync(path)) {
    throw new Error(`palette file not found: ${path}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`palette file is not valid JSON: ${error.message}`);
  }

  const themes = parsed.themes ?? parsed;
  const warnings = [];
  const out = { name: parsed.name ?? basename(path, '.json'), themes: {} };

  for (const mode of ['dark', 'light']) {
    const source = themes?.[mode];
    if (!source || typeof source !== 'object') continue;

    const theme = { tokens: {} };

    for (const surface of Object.keys(VOCABULARY.surfaces)) {
      if (typeof source[surface] === 'string' && COLOR_RE.test(source[surface])) {
        theme[surface] = source[surface];
      }
    }

    for (const [key, token] of Object.entries(source.tokens ?? {})) {
      if (!(key in VOCABULARY.tokens)) {
        warnings.push(`ignored "${key}" — not a JSRay token in Core ${VOCABULARY.version}`);
        continue;
      }

      const color = typeof token === 'string' ? token : token?.color;

      if (typeof color !== 'string' || !COLOR_RE.test(color)) {
        warnings.push(`ignored "${key}" in ${mode} — "${color}" is not a hex color`);
        continue;
      }

      theme.tokens[key] = typeof token === 'object' && token.fontStyle
        ? { color, fontStyle: token.fontStyle }
        : { color };
    }

    out.themes[mode] = theme;
  }

  if (!out.themes.dark && !out.themes.light) {
    throw new Error('palette file has no usable dark or light theme');
  }

  return { palette: out, warnings };
}

/**
 * Layer a custom palette over a built-in one, so a partial palette only has to
 * name the tokens it changes.
 *
 * @param {object} base Built-in palette.
 * @param {object} custom Validated custom palette.
 * @returns {object}
 */
export function mergePalettes(base, custom) {
  const merged = { ...base, themes: { ...base.themes } };

  for (const [mode, theme] of Object.entries(custom.themes)) {
    const baseTheme = base.themes?.[mode] ?? { tokens: {} };
    merged.themes[mode] = {
      ...baseTheme,
      ...theme,
      tokens: { ...baseTheme.tokens, ...theme.tokens },
    };
  }

  return merged;
}
