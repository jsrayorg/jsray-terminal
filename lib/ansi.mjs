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
const VOCABULARY_PATH = resolve(ROOT, 'vocabulary.json');
if (!existsSync(VOCABULARY_PATH)) incompleteInstall('vocabulary.json');
const VOCABULARY = JSON.parse(readFileSync(VOCABULARY_PATH, 'utf8'));

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

/**
 * A file this package ships with is not where it shipped it.
 *
 * This exits rather than throwing. Some of these reads happen while the module
 * is still being evaluated, before any caller has had a chance to install a
 * handler — an exception there arrives as an unhandled rejection with a stack
 * trace, which is exactly the output the guard exists to replace.
 */
export function incompleteInstall(what) {
  process.stderr.write(
    `jsray: ${what} is missing from this installation.\n` +
    '       The package ships it; reinstall to restore it.\n'
  );
  process.exit(1);
}

export function listPalettes() {
  // readdirSync throws ENOENT when the directory itself is gone, and this
  // function is called while building the "unknown theme" message — so the
  // error handler was the thing that crashed, and a missing palettes/ surfaced
  // as a Node stack trace out of fs.readFileUtf8 instead of a sentence.
  if (!existsSync(PALETTES_DIR)) incompleteInstall('palettes/');

  return readdirSync(PALETTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'))
    .sort();
}

export function loadPalette(name) {
  if (!existsSync(PALETTES_DIR)) incompleteInstall('palettes/');

  const path = resolve(PALETTES_DIR, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`unknown theme "${name}" — available: ${listPalettes().join(', ')}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * RGB triple for any colour a palette may carry.
 *
 * A terminal needs numbers, and hex is only one of the forms a palette uses —
 * Core's own `lineHighlight` is `rgba(...)`, because a translucent overlay
 * cannot be written as hex. Feeding that to a hex parser produced NaN, and a
 * `\x1b[38;2;NaN;NaN;NaNm` sequence is not an error anywhere: it prints as
 * garbage and keeps going.
 *
 * Alpha is dropped rather than approximated. A terminal cell has one colour;
 * blending against an unknown background would be a guess presented as a
 * value.
 */
function toRgb(color) {
  const value = String(color).trim();

  if (value.startsWith('#')) {
    const h = value.slice(1);
    const full = h.length <= 4
      ? h.slice(0, 3).split('').map((c) => c + c).join('')
      : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  const numbers = value.match(/-?[\d.]+%?/g);

  if (/^rgba?\(/i.test(value) && numbers && numbers.length >= 3) {
    return numbers.slice(0, 3).map((n) => {
      const v = parseFloat(n);
      return Math.max(0, Math.min(255, Math.round(n.endsWith('%') ? (v / 100) * 255 : v)));
    });
  }

  if (/^hsla?\(/i.test(value) && numbers && numbers.length >= 3) {
    return hslToRgb(parseFloat(numbers[0]), parseFloat(numbers[1]) / 100, parseFloat(numbers[2]) / 100);
  }

  // transparent / currentcolor / inherit have no RGB of their own, and neither
  // does anything unparseable. Mid grey is visible on both backgrounds, which
  // is the only useful property here.
  return [128, 128, 128];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r, g, b].map((v) => Math.round((v + m) * 255));
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
  const rgb = toRgb(hex);
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
    // Re-open the style after every newline, so each line stands on its own.
    // A token can span lines — a block comment, a template literal — and
    // opening its colour once meant the second line carried no sequence at
    // all. Anything that slices the output by line (a range, a pager, a diff)
    // got a coloured first line and plain continuations.
    out.push(activeStyle + (node.includes('\n') ? node.split('\n').join('\n' + activeStyle) : node));
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

  // A file that ends in a newline — nearly all of them — splits into a final
  // empty string that is the position after the last line, not a line. Left
  // in, a two-line file is numbered up to three, which is one more than `cat
  // -n` or `less -N` report and one more than the file has. The trailing
  // newline itself is restored when the numbered lines are joined back.
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();

  const width = String(lines.length).length;
  const gutterOpen = colorMode === 'none'
    ? ''
    : `\x1b[0m${colorFor(themeBlock.gutter || '#888888', colorMode)}`;
  const gutterClose = colorMode === 'none' ? '' : '\x1b[0m';
  const numbered = lines
    .map((line, i) => `${gutterOpen}${String(i + 1).padStart(width)} │ ${gutterClose}${line}`)
    .join('\n');

  return trailingNewline ? `${numbered}\n` : numbered;
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
 * @param {string} [root] Install root to verify; defaults to this one.
 * @returns {{status: 'official'|'modified'|'unknown', version: string, mismatched: string[], checked: number}}
 */
export function verifyCore(root = ROOT) {
  const manifestPath = resolve(root, 'core-integrity.json');

  if (!existsSync(manifestPath)) {
    return { status: 'unknown', version: '', mismatched: [], checked: 0 };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const mismatched = [];
  let checked = 0;

  for (const [file, expected] of Object.entries(manifest.files ?? {})) {
    const path = resolve(root, file);

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

/**
 * Colors a palette may carry.
 *
 * Hex is what the Theme Studio's pickers produce, but a palette is not only
 * hex: Core's own `lineHighlight` is `rgba(255,255,255,0.05)`, because a
 * translucent overlay cannot be written any other way. Accepting hex alone
 * meant the official palettes lost that surface here while keeping it in
 * WordPress — the same file, validated three ways.
 *
 * Deliberately narrow all the same. These values are written into a style
 * block, so `url()`, `var()`, `expression()` and anything carrying a semicolon
 * stay out. Matches the WordPress implementation rule for rule.
 */
const COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FN_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-zA-Z.,%/\s+-]+\s*\)$/;
const COLOR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit']);

/** @param {unknown} value @returns {boolean} */
function isColor(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return false;

  return COLOR_RE.test(trimmed)
    || COLOR_FN_RE.test(trimmed)
    || COLOR_KEYWORDS.has(trimmed.toLowerCase());
}

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
      if (typeof source[surface] === 'string' && isColor(source[surface])) {
        theme[surface] = source[surface];
      }
    }

    for (const [key, token] of Object.entries(source.tokens ?? {})) {
      if (!(key in VOCABULARY.tokens)) {
        warnings.push(`ignored "${key}" — not a JSRay token in Core ${VOCABULARY.version}`);
        continue;
      }

      const color = typeof token === 'string' ? token : token?.color;

      if (typeof color !== 'string' || !isColor(color)) {
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
