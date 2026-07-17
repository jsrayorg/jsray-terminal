/*!
 * JSRay
 * JavaScript-native code rendering kernel · 23-class token semantics.
 * Usage: <pre><code class="language-js">…</code></pre> + <script src="jsray.js">
 *
 * @author  Eric Liu
 * @license MIT
 * @see     https://jsray.org
 */
(function (global) {
  'use strict';

  // ============================================================
  // 1. Core · tokenize + render
  // ============================================================

  const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => escapeMap[c]);

  /**
   * Apply grammar rules to a string in order. Rule array order = priority (first-match wins).
   * Each rule:
   *   { cls: 'tk-xxx',
   *     pattern: /re/,         // must be globalizable; the 'g' flag is forced internally
   *     inside?: rules,        // nested grammar (recursively tokenize captured text)
   *     lookbehind?: true }    // capture group 1 is consumed as prefix but not colored
   */
  function tokenize(code, rules) {
    let stream = [code];
    for (const rule of rules) {
      const next = [];
      // Compile once per rule and cache on the rule object — the old code
      // built a fresh RegExp per stream piece, which dominated tokenize time
      // on fragmented streams. lastIndex is reset per piece instead.
      const re = rule._re || (rule._re = new RegExp(
        rule.pattern.source,
        (rule.pattern.flags || '').replace('g', '') + 'g'
      ));
      for (const piece of stream) {
        if (typeof piece !== 'string') { next.push(piece); continue; }
        re.lastIndex = 0;
        let last = 0, m;
        while ((m = re.exec(piece)) !== null) {
          const lbLen = rule.lookbehind && m[1] ? m[1].length : 0;
          const start = m.index + lbLen;
          const text = m[0].slice(lbLen);
          if (!text) { re.lastIndex++; continue; }
          if (start > last) next.push(piece.slice(last, start));
          next.push({
            type: rule.cls,
            content: rule.inside ? tokenize(text, rule.inside) : text,
          });
          last = start + text.length;
        }
        if (last < piece.length) next.push(piece.slice(last));
      }
      stream = next;
    }
    return stream;
  }

  function render(stream) {
    if (typeof stream === 'string') return escapeHtml(stream);
    if (Array.isArray(stream)) return stream.map(render).join('');
    const inner = typeof stream.content === 'string'
      ? escapeHtml(stream.content)
      : render(stream.content);
    return '<span class="' + stream.type + '">' + inner + '</span>';
  }

  // ============================================================
  // 2. Grammars · language families
  // ============================================================

  const G = {}; // grammars

  // ---------- shared fragments ----------
  const RX = {
    string1: /"(?:\\.|[^"\\\n])*"/,
    string2: /'(?:\\.|[^'\\\n])*'/,
    number:  /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)\b/,
    ident:   /[A-Za-z_$][\w$]*/,
  };

  // ============================================================
  // JavaScript / TypeScript
  // ============================================================
  const JS_KEYWORDS = (
    'as async await break case catch class const continue debugger default delete do ' +
    'else enum export extends finally for from function get if implements import in ' +
    'instanceof interface let namespace new of package private protected public readonly ' +
    'return satisfies set static super switch this throw try type typeof var void while ' +
    'with yield declare abstract is keyof infer'
  ).split(' ');

  const JS_BUILTINS = (
    'console window document globalThis process self performance localStorage ' +
    'sessionStorage navigator location history Math JSON Object Array String Number ' +
    'Boolean Date RegExp Map Set WeakMap WeakSet Promise Symbol Error Reflect Proxy'
  ).split(' ');

  const JS_BUILTIN_FNS = (
    'log error warn info debug trace assert dir time timeEnd group groupEnd ' +
    'parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent ' +
    'fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame'
  ).split(' ');

  const jsTemplateInner = [
    { cls: 'tk-punct',  pattern: /^\$\{|\}$/ },
    // Placeholder interior is treated as JS recursively (lazy ref to avoid init cycle)
    { cls: 'tk-var',    pattern: RX.ident, inside: null /* placeholder */ },
  ];

  // Parameter-list sub-grammar · colors n / name in (n: number, name = "x") as var-param
  const jsParamInside = [
    { cls: 'tk-punct',     pattern: /[(),]/ },
    { cls: 'tk-type',      pattern: /(:\s*)[A-Z][\w$]*/, lookbehind: true },
    { cls: 'tk-keyword',   pattern: /\b(?:number|string|boolean|void|null|undefined|any|unknown|never|true|false)\b/ },
    { cls: 'tk-string',    pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
    { cls: 'tk-number',    pattern: /\b\d[\d_]*(?:\.\d+)?\b/ },
    { cls: 'tk-var-param', pattern: /\b[A-Za-z_$][\w$]*\b/ },
    { cls: 'tk-operator',  pattern: /[=?:.]/ },
  ];

  G.javascript = [
    // Doc comments must come before plain block comments. Block comments stay
    // before strings; LINE comments come after strings (see below) so
    // "https://..." inside a string never becomes a comment.
    { cls: 'tk-doc',     pattern: /\/\*\*[\s\S]*?\*\// },
    { cls: 'tk-comment', pattern: /\/\*[\s\S]*?\*\// },

    // Parameter lists · function foo(...) / (...) => / async (...) =>
    { cls: 'tk-scope',
      pattern: /(\bfunction\s*[\w$]*\s*)\([^()]*\)/, lookbehind: true,
      inside: jsParamInside },
    { cls: 'tk-scope',
      pattern: /\([^()]*\)(?=\s*=>)/,
      inside: jsParamInside },

    // Template strings (with inline ${...})
    { cls: 'tk-string',  pattern: /`(?:\\.|\$\{[^}]*\}|[^`\\])*`/, inside: [
        { cls: 'tk-operator', pattern: /\$\{[^}]*\}/, inside: [
            { cls: 'tk-punct', pattern: /^\$\{|\}$/ },
            // No JS recursion here; minimal coloring avoids rule cross-talk
            { cls: 'tk-var',   pattern: /[A-Za-z_$][\w$]*/ },
        ]},
    ]},
    { cls: 'tk-string',  pattern: RX.string1 },
    { cls: 'tk-string',  pattern: RX.string2 },
    { cls: 'tk-comment', pattern: /\/\/.*/ },

    // Regex: only recognize after =/(/,/!/keyword to avoid eating division
    // Capture prefix whitespace as lookbehind so it stays outside the regex token.
    { cls: 'tk-regex',
      pattern: /(^|[=(,!&|?:;{}\[\]]\s*|\breturn\s*)\/(?![*\/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\/\\\n])+\/[gimsuy]*/,
      lookbehind: true },

    // Decorators
    { cls: 'tk-decorator', pattern: /@[A-Za-z_$][\w$]*/ },

    // ALL_CAPS constants · must precede type, else MAX_ITEMS gets eaten by the type rule
    { cls: 'tk-var-const', pattern: /\b[A-Z][A-Z0-9_]{2,}\b/ },

    // Type annotation `: TypeName` or PascalCase generic starts
    { cls: 'tk-type',    pattern: /\b[A-Z][\w$]*\b/ },

    // function/class declaration name · must precede keyword rule, else `function` is consumed first
    { cls: 'tk-fn-decl',
      pattern: /(\b(?:function\*?|class)\s+)[A-Za-z_$][\w$]*/,
      lookbehind: true },

    { cls: 'tk-keyword', pattern: new RegExp('\\b(?:' + JS_KEYWORDS.join('|') + ')\\b') },
    { cls: 'tk-keyword', pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/ },

    // Builtin variables
    { cls: 'tk-var-builtin',
      pattern: new RegExp('\\b(?:' + JS_BUILTINS.join('|') + ')\\b') },

    // Builtin functions (as `.fnName(` or bare call)
    { cls: 'tk-fn-builtin',
      pattern: new RegExp('\\b(?:' + JS_BUILTIN_FNS.join('|') + ')(?=\\s*\\()') },

    // Property access .name
    { cls: 'tk-property', pattern: /(\.)[A-Za-z_$][\w$]*/, lookbehind: true },

    // Function call ident(
    { cls: 'tk-function', pattern: /\b[A-Za-z_$][\w$]*(?=\s*\()/ },

    { cls: 'tk-number',   pattern: RX.number },
    { cls: 'tk-operator', pattern: /=>|\.\.\.|\?\?=?|\?\.|<<=?|>>>?=?|<=|>=|===?|!==?|\*\*=?|\+\+|--|&&=?|\|\|=?|[+\-*/%&|^!<>=?]=?/ },
    { cls: 'tk-punct',    pattern: /[{}[\]();,.:]/ },
  ];
  G.js = G.javascript;
  G.typescript = G.javascript;
  G.ts = G.javascript;
  G.jsx = G.javascript;
  G.tsx = G.javascript;

  // ============================================================
  // Python
  // ============================================================
  const PY_KEYWORDS = (
    'False None True and as assert async await break class continue def del elif ' +
    'else except finally for from global if import in is lambda nonlocal not or ' +
    'pass raise return try while with yield match case'
  ).split(' ');

  const PY_BUILTIN_FNS = (
    'abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod ' +
    'compile complex delattr dict dir divmod enumerate eval exec filter float format ' +
    'frozenset getattr globals hasattr hash help hex id input int isinstance issubclass ' +
    'iter len list locals map max memoryview min next object oct open ord pow print ' +
    'property range repr reversed round set setattr slice sorted staticmethod str sum ' +
    'super tuple type vars zip'
  ).split(' ');

  const pyParamInside = [
    { cls: 'tk-punct',       pattern: /[(),]/ },
    { cls: 'tk-type',        pattern: /(:\s*)[A-Z]\w*(?:\[[^\]]*\])?/, lookbehind: true },
    { cls: 'tk-keyword',     pattern: /\b(?:int|str|float|bool|bytes|list|dict|tuple|set|None|True|False)\b/ },
    { cls: 'tk-string',      pattern: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-number',      pattern: /\b\d[\d_]*(?:\.\d+)?\b/ },
    { cls: 'tk-var-builtin', pattern: /\b(?:self|cls)\b/ },
    { cls: 'tk-var-param',   pattern: /\b[A-Za-z_]\w*\b/ },
    { cls: 'tk-operator',    pattern: /[=*:.]/ },
  ];

  G.python = [
    // Triple-quoted strings (with f/r/b prefixes). All strings before
    // comments so # inside "..." never becomes a comment.
    { cls: 'tk-string',  pattern: /(?:[rRbBuUfF]{0,2})("""[\s\S]*?"""|'''[\s\S]*?''')/ },
    { cls: 'tk-string',  pattern: /(?:[rRbBuUfF]{0,2})("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/ },
    { cls: 'tk-comment', pattern: /#.*/ },

    // Parameter list · def foo(self, n: int = 0)
    { cls: 'tk-scope',
      pattern: /(\bdef\s+\w+\s*)\([^()]*\)/, lookbehind: true,
      inside: pyParamInside },

    { cls: 'tk-decorator', pattern: /@[A-Za-z_][\w.]*/ },

    { cls: 'tk-var-builtin',
      pattern: /\b(?:self|cls|__name__|__main__|__init__|__file__|__doc__|__class__)\b/ },

    // Declaration names · must precede keyword
    { cls: 'tk-fn-decl',
      pattern: /(\bdef\s+)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-type',
      pattern: /(\bclass\s+)[A-Za-z_]\w*/, lookbehind: true },

    { cls: 'tk-keyword',
      pattern: new RegExp('\\b(?:' + PY_KEYWORDS.join('|') + ')\\b') },

    { cls: 'tk-fn-builtin',
      pattern: new RegExp('\\b(?:' + PY_BUILTIN_FNS.join('|') + ')(?=\\s*\\()') },

    { cls: 'tk-type',
      pattern: /\b[A-Z]\w*\b/ },

    { cls: 'tk-var-const', pattern: /\b[A-Z][A-Z0-9_]{2,}\b/ },

    { cls: 'tk-property', pattern: /(\.)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },

    { cls: 'tk-number',
      pattern: /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?)\b/ },
    { cls: 'tk-operator', pattern: /->|:=|\*\*=?|\/\/=?|<<=?|>>=?|<=|>=|==|!=|[+\-*/%&|^~<>=]=?/ },
    { cls: 'tk-punct',    pattern: /[{}[\]();,.:]/ },
  ];
  G.py = G.python;

  // ============================================================
  // HTML
  // ============================================================
  G.html = [
    { cls: 'tk-comment', pattern: /<!--[\s\S]*?-->/ },
    { cls: 'tk-decorator', pattern: /<!DOCTYPE[^>]*>/i },

    // <tag …attrs…>
    { cls: 'tk-tag', pattern: /<\/?[A-Za-z][\w-]*\b[^>]*\/?>/, inside: [
        { cls: 'tk-comment', pattern: /<!--[\s\S]*?-->/ },
        { cls: 'tk-string',  pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
        { cls: 'tk-punct',   pattern: /^<\/?|\/?>$/ },
        { cls: 'tk-tag',     pattern: /^[A-Za-z][\w-]*/ },
        { cls: 'tk-attr',    pattern: /\b[a-zA-Z_:][\w:.-]*(?==)/ },
        { cls: 'tk-attr',    pattern: /\b[a-zA-Z_:][\w:.-]*/ },
        { cls: 'tk-operator', pattern: /=/ },
    ]},

    // HTML entities
    { cls: 'tk-number', pattern: /&#?\w+;/ },
  ];
  G.htm = G.html;
  G.xml = G.html;
  G.svg = G.html;
  G.vue = G.html;

  // ============================================================
  // CSS
  // ============================================================
  G.css = [
    { cls: 'tk-comment',  pattern: /\/\*[\s\S]*?\*\// },
    { cls: 'tk-string',   pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },

    // @at-rule
    { cls: 'tk-decorator', pattern: /@[\w-]+/ },

    // A full rule block: selector { ...declarations... }
    { cls: 'tk-selector',
      pattern: /(^|[}\s])[^{}\s][^{}]*(?=\s*\{)/,
      lookbehind: true,
      inside: [
        { cls: 'tk-attr', pattern: /:[\w-]+(?:\([^)]*\))?/ }, // pseudo-classes
        { cls: 'tk-attr', pattern: /\[[^\]]+\]/ },             // attribute selectors
      ]},

    // Declaration body: property: value;
    { cls: 'tk-css-prop',
      pattern: /\b[-\w]+(?=\s*:)/ },

    { cls: 'tk-function', pattern: /\b[-\w]+(?=\()/ },
    { cls: 'tk-number',   pattern: /#[0-9a-fA-F]{3,8}\b/ },           // hex color
    { cls: 'tk-css-unit', pattern: /\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex)\b/ },
    { cls: 'tk-number',   pattern: /\b\d+(?:\.\d+)?\b/ },
    { cls: 'tk-keyword',  pattern: /!important\b/ },
    { cls: 'tk-operator', pattern: /[>+~]/ },
    { cls: 'tk-punct',    pattern: /[{}();,:]/ },
  ];
  G.scss = G.css;
  G.sass = G.css;
  G.less = G.css;

  // ============================================================
  // JSON
  // ============================================================
  G.json = [
    // Keys use the type color (cool cyan) to contrast with value strings (warm coral)
    { cls: 'tk-type',     pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/ },
    { cls: 'tk-string',   pattern: /"(?:\\.|[^"\\])*"/ },
    { cls: 'tk-keyword',  pattern: /\b(?:true|false|null)\b/ },
    { cls: 'tk-number',
      pattern: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    { cls: 'tk-punct',    pattern: /[{}[\]:,]/ },
  ];
  G.jsonc = [
    { cls: 'tk-comment',  pattern: /\/\*[\s\S]*?\*\/|\/\/.*/ },
    ...G.json,
  ];

  // ============================================================
  // Shell / Bash
  // ============================================================
  const SH_KEYWORDS =
    'if then elif else fi for in do done while until case esac function ' +
    'return break continue export local readonly declare typeset select time';
  const SH_BUILTINS =
    'cd ls pwd echo printf read source eval exec exit kill wait jobs trap ' +
    'mkdir rmdir rm mv cp ln touch chmod chown cat less more head tail ' +
    'grep egrep fgrep sed awk sort uniq cut tr wc find xargs tee tar gzip ' +
    'gunzip zip unzip curl wget ssh scp rsync git npm pnpm yarn node deno ' +
    'docker kubectl python python3 pip pip3 ruby go cargo make brew apt yum';

  G.shell = [
    // Strings before comments, else # inside "..." is eaten as a comment
    { cls: 'tk-string',  pattern: /"(?:\\.|\$[\w{][^"\n]*|[^"\\$\n])*"/, inside: [
        { cls: 'tk-var-builtin', pattern: /\$\{[^}]+\}|\$\w+/ },
    ]},
    { cls: 'tk-string',  pattern: /'[^'\n]*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },

    { cls: 'tk-var-builtin', pattern: /\$\{[^}]+\}|\$\w+|\$[#?@*]/ },

    { cls: 'tk-keyword',
      pattern: new RegExp('\\b(?:' + SH_KEYWORDS.split(' ').join('|') + ')\\b') },
    { cls: 'tk-fn-builtin',
      pattern: new RegExp('(^|[\\s|&;`(])(?:' + SH_BUILTINS.split(' ').join('|') + ')\\b'),
      lookbehind: true },

    // Command options -x / --foo
    { cls: 'tk-decorator', pattern: /(^|\s)--?[\w-]+/, lookbehind: true },

    { cls: 'tk-number',   pattern: /\b\d+\b/ },
    { cls: 'tk-operator', pattern: /&&|\|\||>>|<<|[|&;<>]/ },
    { cls: 'tk-punct',    pattern: /[(){}\[\]=]/ },
  ];
  G.bash = G.shell;
  G.sh = G.shell;
  G.zsh = G.shell;

  // ============================================================
  // PHP
  // ============================================================
  const PHP_KEYWORDS = (
    'abstract and array as break callable case catch class clone const continue declare ' +
    'default die do echo else elseif empty enddeclare endfor endforeach endif endswitch ' +
    'endwhile eval exit extends final finally fn for foreach function global goto if ' +
    'implements include include_once instanceof insteadof interface isset list match ' +
    'namespace new or print private protected public readonly require require_once return ' +
    'static switch throw trait try unset use var while xor yield'
  ).split(' ');

  const PHP_BUILTIN_FNS = (
    'array count strlen strpos str_replace trim explode implode preg_match preg_replace ' +
    'json_encode json_decode var_dump print_r isset empty in_array is_array is_string ' +
    'is_int is_bool is_null file_get_contents file_put_contents header'
  ).split(' ');

  G.php = [
    // Block comments before strings; line comments (// and #) after strings
    // so "https://..." and "#anchor" inside strings never become comments.
    { cls: 'tk-comment', pattern: /\/\*[\s\S]*?\*\// },
    { cls: 'tk-decorator', pattern: /<\?(?:php|=)?|\?>/i },
    { cls: 'tk-string', pattern: /"(?:\\.|\$[A-Za-z_]\w*|[^"\\$\n])*"/, inside: [
        { cls: 'tk-var', pattern: /\$[A-Za-z_]\w*/ },
    ]},
    { cls: 'tk-string', pattern: /'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-comment', pattern: /\/\/.*|#.*/ },
    { cls: 'tk-var', pattern: /\$[A-Za-z_]\w*/ },
    { cls: 'tk-var-const', pattern: /\b[A-Z][A-Z0-9_]{2,}\b/ },
    { cls: 'tk-type', pattern: /(\b(?:class|interface|trait|enum|extends|implements|new)\s+)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-fn-decl', pattern: /(\bfunction\s+)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-keyword', pattern: new RegExp('\\b(?:' + PHP_KEYWORDS.join('|') + ')\\b') },
    { cls: 'tk-keyword', pattern: /\b(?:true|false|null)\b/i },
    { cls: 'tk-fn-builtin', pattern: new RegExp('\\b(?:' + PHP_BUILTIN_FNS.join('|') + ')(?=\\s*\\()') },
    { cls: 'tk-property', pattern: /(->|::)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
    { cls: 'tk-number', pattern: RX.number },
    { cls: 'tk-operator', pattern: /=>|->|::|\?\?=?|<=|>=|===?|!==?|[+\-*/%&|^!<>=?]=?/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,.:]/ },
  ];

  // ============================================================
  // C-like languages: C / C++ / Java / C# / Go / Rust / Swift / Kotlin / Dart
  // ============================================================
  function wordPattern(words) {
    return new RegExp('\\b(?:' + words.join('|') + ')\\b');
  }

  const CLIKE_DECL_SKIP = 'if|for|while|switch|catch|return|sizeof|typeof|new|else|do|try|using|namespace';

  function cLikeGrammar(keywords, builtins, options) {
    const opts = options || {};
    const rules = [
      // Block comments stay before strings (license headers quote freely);
      // LINE comments come after strings so "https://..." never becomes a
      // comment.
      { cls: 'tk-doc', pattern: /\/\*\*[\s\S]*?\*\// },
      { cls: 'tk-comment', pattern: /\/\*[\s\S]*?\*\// },
      { cls: 'tk-decorator', pattern: /^\s*#\s*[A-Za-z_]\w*.*/m },
      { cls: 'tk-decorator', pattern: /@[A-Za-z_]\w*/ },
      { cls: 'tk-string', pattern: /"(?:\\.|[^"\\\n])*"/ },
      { cls: 'tk-string', pattern: /'(?:\\.|[^'\\\n])*'/ },
      { cls: 'tk-comment', pattern: /\/\/.*/ },
      { cls: 'tk-var-const', pattern: /\b[A-Z][A-Z0-9_]{2,}\b/ },
      { cls: 'tk-type', pattern: /(\b(?:class|struct|interface|enum|trait|extends|implements|namespace|using|new|object|protocol|extension|mixin)\s+)[A-Za-z_]\w*/, lookbehind: true },
      { cls: 'tk-fn-decl', pattern: new RegExp('\\b(?!(?:' + CLIKE_DECL_SKIP + ')\\b)[A-Za-z_]\\w*(?=\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:->\\s*[A-Za-z_:][\\w:<>]*)?\\{)') },
      { cls: 'tk-keyword', pattern: wordPattern(keywords) },
      { cls: 'tk-keyword', pattern: /\b(?:true|false|null|nullptr|nil|None)\b/ },
      { cls: 'tk-fn-builtin', pattern: wordPattern(builtins.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) },
      { cls: 'tk-property', pattern: /(\.|::|->)[A-Za-z_]\w*/, lookbehind: true },
      { cls: 'tk-function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
      { cls: 'tk-number', pattern: /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[fFdDuUlL]*)\b/ },
      { cls: 'tk-operator', pattern: /::|->|=>|\.\.|<<=?|>>>?=?|<=|>=|==|!=|&&|\|\||\+\+|--|[+\-*/%&|^~!<>=?]=?/ },
      { cls: 'tk-punct', pattern: /[{}[\]();,.:]/ },
    ];

    if (opts.rustMacros) {
      // Insert before the literal-keyword rule (index-independent).
      const at = rules.findIndex((r) => r.pattern.source.includes('nullptr'));
      rules.splice(at, 0, { cls: 'tk-fn-builtin', pattern: /\b[A-Za-z_]\w*!/ });
    }

    // Languages whose declarations don't always end in `(...) {` (e.g. Scala's
    // `def f(x: Int): Int = ...`) name the declaring keywords explicitly.
    if (opts.fnDeclKeywords) {
      rules.splice(rules.findIndex((r) => r.cls === 'tk-fn-decl'), 0, {
        cls: 'tk-fn-decl',
        pattern: new RegExp('(\\b(?:' + opts.fnDeclKeywords.join('|') + ')\\s+)[A-Za-z_]\\w*'),
        lookbehind: true,
      });
    }

    return rules;
  }

  const C_KEYWORDS = (
    'auto break case char const continue default do double else enum extern float for ' +
    'goto if inline int long register restrict return short signed sizeof static struct ' +
    'switch typedef union unsigned void volatile while bool'
  ).split(' ');
  const C_BUILTINS = 'printf fprintf sprintf scanf malloc calloc realloc free strlen strcpy memcpy memset fopen fclose fread fwrite'.split(' ');
  G.c = cLikeGrammar(C_KEYWORDS, C_BUILTINS);

  const CPP_KEYWORDS = (
    'alignas alignof asm auto bool break case catch char char8_t char16_t char32_t class ' +
    'concept const constexpr consteval constinit continue decltype default delete do double ' +
    'else enum explicit export extern false float for friend if inline int long mutable ' +
    'namespace new noexcept nullptr operator private protected public register reinterpret_cast ' +
    'requires return short signed sizeof static static_cast struct switch template this throw ' +
    'true try typedef typeid typename union unsigned using virtual void volatile while'
  ).split(' ');
  const CPP_BUILTINS = 'std cout cin cerr endl printf scanf malloc free make_unique make_shared move forward'.split(' ');
  G.cpp = cLikeGrammar(CPP_KEYWORDS, CPP_BUILTINS);
  G.cc = G.cpp;
  G.cxx = G.cpp;
  G.hpp = G.cpp;

  const JAVA_KEYWORDS = (
    'abstract assert boolean break byte case catch char class const continue default do double ' +
    'else enum exports extends final finally float for if implements import instanceof int ' +
    'interface long module native new package private protected public requires return short ' +
    'static strictfp super switch synchronized this throw throws transient try var void volatile while'
  ).split(' ');
  const JAVA_BUILTINS = 'System String Integer Long Double Float Boolean Math Objects Arrays Collections List Map Set Optional println print'.split(' ');
  G.java = cLikeGrammar(JAVA_KEYWORDS, JAVA_BUILTINS);

  const CS_KEYWORDS = (
    'abstract as base bool break byte case catch char checked class const continue decimal default ' +
    'delegate do double else enum event explicit extern false finally fixed float for foreach ' +
    'goto if implicit in int interface internal is lock long namespace new null object operator ' +
    'out override params private protected public readonly ref return sbyte sealed short sizeof ' +
    'stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ' +
    'ushort using virtual void volatile while var async await record'
  ).split(' ');
  const CS_BUILTINS = 'Console WriteLine Write ReadLine Math List Dictionary IEnumerable Task string int bool var'.split(' ');
  G.csharp = cLikeGrammar(CS_KEYWORDS, CS_BUILTINS);
  G.cs = G.csharp;

  const GO_KEYWORDS = (
    'break default func interface select case defer go map struct chan else goto package switch ' +
    'const fallthrough if range type continue for import return var'
  ).split(' ');
  const GO_BUILTINS = 'append cap close complex copy delete imag len make new panic print println real recover fmt'.split(' ');
  G.go = cLikeGrammar(GO_KEYWORDS, GO_BUILTINS);
  G.golang = G.go;

  const RUST_KEYWORDS = (
    'as async await break const continue crate dyn else enum extern false fn for if impl in let ' +
    'loop match mod move mut pub ref return self Self static struct super trait true type unsafe ' +
    'use where while'
  ).split(' ');
  const RUST_BUILTINS = 'println format vec panic assert assert_eq Some None Ok Err Result Option String Vec Box'.split(' ');
  G.rust = cLikeGrammar(RUST_KEYWORDS, RUST_BUILTINS, { rustMacros: true });
  G.rs = G.rust;

  const SWIFT_KEYWORDS = (
    'associatedtype async await break case catch class continue default defer deinit do else enum ' +
    'extension fallthrough false fileprivate final for func guard if import in init inout internal ' +
    'is let nil open operator private protocol public repeat rethrows return self Self static struct ' +
    'subscript super switch throw throws true try typealias var where while'
  ).split(' ');
  const SWIFT_BUILTINS = 'print debugPrint assert precondition fatalError String Int Double Float Bool Array Dictionary Set Optional'.split(' ');
  G.swift = cLikeGrammar(SWIFT_KEYWORDS, SWIFT_BUILTINS);

  const KOTLIN_KEYWORDS = (
    'as break class continue do else false for fun if in interface is null object package return ' +
    'super this throw true try typealias val var when while by catch constructor delegate dynamic ' +
    'field file finally get import init param property receiver set setparam where actual abstract ' +
    'annotation companion const crossinline data enum expect external final infix inline inner internal ' +
    'lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg'
  ).split(' ');
  const KOTLIN_BUILTINS = 'println print arrayOf listOf mutableListOf mapOf setOf sequenceOf require check error String Int Long Double Float Boolean Unit Any Nothing'.split(' ');
  G.kotlin = cLikeGrammar(KOTLIN_KEYWORDS, KOTLIN_BUILTINS);
  G.kt = G.kotlin;
  G.kts = G.kotlin;

  const DART_KEYWORDS = (
    'abstract as assert async await break case catch class const continue covariant default deferred ' +
    'do dynamic else enum export extends extension external factory false final finally for function get ' +
    'hide if implements import in interface is late library mixin new null on operator part required ' +
    'rethrow return set show static super switch sync this throw true try typedef var void while with yield'
  ).split(' ');
  const DART_BUILTINS = 'print assert identical main String int double num bool List Map Set Future Stream Iterable Widget StatelessWidget StatefulWidget'.split(' ');
  G.dart = cLikeGrammar(DART_KEYWORDS, DART_BUILTINS);

  const SCALA_KEYWORDS = (
    'abstract case catch class def do else enum extends false final finally for forSome given ' +
    'if implicit import lazy match new null object override package private protected return ' +
    'sealed super then this throw trait true try type using val var while with yield'
  ).split(' ');
  const SCALA_BUILTINS = (
    'println print List Map Set Seq Vector Array Option Some None Either Left Right Future ' +
    'String Int Long Double Boolean Unit Any Nothing'
  ).split(' ');
  G.scala = cLikeGrammar(SCALA_KEYWORDS, SCALA_BUILTINS, { fnDeclKeywords: ['def'] });
  G.sc = G.scala;

  const OBJC_KEYWORDS = C_KEYWORDS.concat((
    'id instancetype self super in out inout bycopy byref oneway ' +
    'atomic nonatomic strong weak copy assign retain readonly readwrite ' +
    'YES NO Class SEL IMP BOOL'
  ).split(' '));
  const OBJC_BUILTINS = (
    'NSLog NSString NSMutableString NSArray NSMutableArray NSDictionary NSMutableDictionary ' +
    'NSNumber NSObject NSError NSData NSURL NSSet alloc init dealloc retain release ' +
    'autorelease dispatch_async dispatch_sync'
  ).split(' ');
  // @interface / @implementation / @property etc. are colored by the generic
  // c-like `@word` decorator rule.
  G.objectivec = cLikeGrammar(OBJC_KEYWORDS, OBJC_BUILTINS);
  G.objc = G.objectivec;

  // ============================================================
  // Ruby
  // ============================================================
  const RB_KEYWORDS = (
    'BEGIN END alias and begin break case class def defined do else elsif end ensure false ' +
    'for if in module next nil not or redo rescue retry return self super then true undef ' +
    'unless until when while yield require include extend attr_reader attr_writer attr_accessor'
  ).split(' ');
  const RB_BUILTINS = 'puts print p gets raise lambda proc loop each map select reject reduce new'.split(' ');

  G.ruby = [
    // Strings must come before comments, else # inside "..." (incl. #{} interpolation)
    // is eaten as a comment. String bodies stay single-line so an unpaired quote
    // in a comment can't swallow following lines.
    { cls: 'tk-string', pattern: /"(?:\\.|#\{[^}\n]*\}|[^"\\\n])*"/, inside: [
        { cls: 'tk-operator', pattern: /#\{[^}\n]*\}/ },
    ]},
    { cls: 'tk-string', pattern: /'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-var-builtin', pattern: /[@$]{1,2}[A-Za-z_]\w*|\bself\b/ },
    { cls: 'tk-var-const', pattern: /\b[A-Z][A-Z0-9_]{2,}\b/ },
    { cls: 'tk-type', pattern: /(\b(?:class|module)\s+)[A-Z]\w*/, lookbehind: true },
    { cls: 'tk-fn-decl', pattern: /(\bdef\s+)[A-Za-z_]\w*[!?=]?/, lookbehind: true },
    { cls: 'tk-keyword', pattern: wordPattern(RB_KEYWORDS) },
    { cls: 'tk-fn-builtin', pattern: wordPattern(RB_BUILTINS) },
    { cls: 'tk-property', pattern: /(\.)[A-Za-z_]\w*[!?=]?/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[A-Za-z_]\w*[!?=]?(?=\s*(?:\(|$))/m },
    { cls: 'tk-number', pattern: RX.number },
    { cls: 'tk-operator', pattern: /=>|::|\.\.|&&|\|\||[+\-*/%&|^!<>=?]=?/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,.:]/ },
  ];
  G.rb = G.ruby;

  // ============================================================
  // Lua
  // ============================================================
  const LUA_KEYWORDS = (
    'and break do else elseif end false for function goto if in local nil not or repeat ' +
    'return then true until while'
  ).split(' ');
  const LUA_BUILTIN_FNS = (
    'assert collectgarbage dofile error getmetatable ipairs load next pairs pcall print ' +
    'rawequal rawget rawlen rawset require select setmetatable tonumber tostring type xpcall'
  ).split(' ');

  G.lua = [
    // Block comments before strings; line comments after strings so
    // "not -- a comment" stays a string.
    { cls: 'tk-comment', pattern: /--\[\[[\s\S]*?\]\]/ },
    { cls: 'tk-string',  pattern: /\[\[[\s\S]*?\]\]/ },
    { cls: 'tk-string',  pattern: /"(?:\\.|[^"\\\n])*"/ },
    { cls: 'tk-string',  pattern: /'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-comment', pattern: /--.*/ },
    { cls: 'tk-var-builtin', pattern: /\b(?:self|_G|_VERSION)\b/ },
    { cls: 'tk-fn-decl',
      pattern: /(\bfunction\s+)[A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)?/,
      lookbehind: true },
    { cls: 'tk-keyword', pattern: wordPattern(LUA_KEYWORDS) },
    { cls: 'tk-fn-builtin',
      pattern: new RegExp('\\b(?:' + LUA_BUILTIN_FNS.join('|') + ')(?=\\s*\\()') },
    { cls: 'tk-property', pattern: /(\.|:)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
    { cls: 'tk-number',   pattern: RX.number },
    { cls: 'tk-operator', pattern: /\.\.|==|~=|<=|>=|[+\-*/%^#<>=]/ },
    { cls: 'tk-punct',    pattern: /[{}[\]();,.:]/ },
  ];

  // ============================================================
  // SQL
  // ============================================================
  const SQL_KEYWORDS = (
    'select from where join inner left right full outer on group by order having limit offset ' +
    'insert into values update set delete create alter drop table view index primary key foreign ' +
    'references constraint not null default unique check and or as distinct union all case when ' +
    'then else end exists in between like is asc desc returning with'
  ).split(' ');
  const SQL_BUILTINS = 'count sum avg min max coalesce nullif lower upper substr substring now date'.split(' ');

  G.sql = [
    // Block comments before strings; line comments after strings so
    // 'not -- a comment' stays a string.
    { cls: 'tk-comment', pattern: /\/\*[\s\S]*?\*\// },
    { cls: 'tk-string', pattern: /'(?:''|[^'])*'|"(?:\\"|[^"])*"/ },
    { cls: 'tk-comment', pattern: /--.*/ },
    { cls: 'tk-keyword', pattern: new RegExp('\\b(?:' + SQL_KEYWORDS.join('|') + ')\\b', 'i') },
    { cls: 'tk-fn-builtin', pattern: new RegExp('\\b(?:' + SQL_BUILTINS.join('|') + ')\\b', 'i') },
    { cls: 'tk-number', pattern: /-?\b\d+(?:\.\d+)?\b/ },
    { cls: 'tk-operator', pattern: /<>|!=|<=|>=|[+\-*/%<>=]/ },
    { cls: 'tk-punct', pattern: /[(),.;]/ },
  ];

  // ============================================================
  // YAML
  // ============================================================
  G.yaml = [
    // Strings before comments, else # inside "..." is eaten as a comment
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\\n])*"|'(?:''|[^'\n])*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-type', pattern: /^(\s*)[A-Za-z_][\w.-]*(?=\s*:)/m, lookbehind: true },
    { cls: 'tk-decorator', pattern: /[&*][A-Za-z_][\w-]*/ },
    { cls: 'tk-keyword', pattern: /\b(?:true|false|null|yes|no|on|off)\b/i },
    { cls: 'tk-number', pattern: /-?\b\d+(?:\.\d+)?\b/ },
    { cls: 'tk-punct', pattern: /^---|\.\.\.|[{}[\],:|-]/m },
  ];
  G.yml = G.yaml;

  // ============================================================
  // Markdown
  // ============================================================
  G.markdown = [
    // Fenced code block ```lang ... ```
    { cls: 'tk-md-code',
      pattern: /```[\w-]*\n[\s\S]*?\n```/ },
    // Inline code
    { cls: 'tk-md-code', pattern: /`[^`\n]+`/ },
    // Headings
    { cls: 'tk-md-heading', pattern: /^#{1,6}\s.*$/m },
    // List item marker
    { cls: 'tk-md-list', pattern: /^\s*(?:[-*+]|\d+\.)\s+/m },
    // Links [text](url)
    { cls: 'tk-md-link',
      pattern: /\[[^\]]+\]\([^)]+\)/,
      inside: [
        { cls: 'tk-punct', pattern: /^\[|\]\(|\)$/ },
        { cls: 'tk-string', pattern: /\([^)]+\)/, inside: [
            { cls: 'tk-punct', pattern: /^\(|\)$/ },
        ]},
      ]},
    // Bold / italic
    { cls: 'tk-md-bold',   pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
    { cls: 'tk-md-italic', pattern: /\*[^*\n]+\*|_[^_\n]+_/ },
    // Blockquote
    { cls: 'tk-comment',   pattern: /^>\s.*$/m },
    // Horizontal rule
    { cls: 'tk-punct',     pattern: /^[-*_]{3,}$/m },
  ];
  G.md = G.markdown;

  // ============================================================
  // R
  // ============================================================
  const R_KEYWORDS = (
    'function if else for while repeat break next return in library require ' +
    'TRUE FALSE NULL NA NA_integer_ NA_real_ NA_character_ Inf NaN'
  ).split(' ');
  const R_BUILTINS = (
    'c print paste paste0 sprintf length names mean median sum min max sapply lapply vapply ' +
    'apply data.frame read.csv write.csv head tail str summary plot ggplot aes factor levels ' +
    'is.null is.na as.numeric as.character seq rep sort unique which nrow ncol cbind rbind'
  ).split(' ');

  G.r = [
    // Strings before comments, else # inside "..." is eaten as a comment
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-fn-decl', pattern: /\b[A-Za-z._][\w.]*(?=\s*(?:<-|=)\s*function\b)/ },
    { cls: 'tk-keyword', pattern: wordPattern(R_KEYWORDS) },
    { cls: 'tk-fn-builtin',
      pattern: new RegExp('\\b(?:' + R_BUILTINS.map((n) => n.replace(/\./g, '\\.')).join('|') + ')(?=\\s*\\()') },
    { cls: 'tk-property', pattern: /(\$)[A-Za-z._][\w.]*/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[A-Za-z._][\w.]*(?=\s*\()/ },
    { cls: 'tk-number', pattern: /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?L?\b/ },
    { cls: 'tk-operator', pattern: /<-|->|%[\w>]+%|\.\.\.|&&|\|\||[+\-*/^!<>=]=?|[~?$]/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,]/ },
  ];

  // ============================================================
  // Perl
  // ============================================================
  const PERL_KEYWORDS = (
    'my our local sub use no package require if elsif else unless while until for foreach do ' +
    'last next redo return and or not eq ne lt gt le ge cmp defined undef wantarray'
  ).split(' ');
  const PERL_BUILTINS = (
    'print printf say chomp chop chr ord lc uc length substr index rindex join split sprintf ' +
    'push pop shift unshift splice reverse sort map grep keys values each exists delete ' +
    'die warn open close scalar ref bless'
  ).split(' ');

  G.perl = [
    { cls: 'tk-doc', pattern: /^=\w+[\s\S]*?^=cut\s*$/m },
    // Strings before comments, else # inside "..." is eaten as a comment
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\\n])*"/, inside: [
        { cls: 'tk-var', pattern: /[$@][A-Za-z_]\w*/ },
    ]},
    { cls: 'tk-string', pattern: /'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-regex', pattern: /((?:=~|!~)\s*)(?:m|s|tr|y)?\/(?:\\.|[^/\n])*\/[a-z]*/, lookbehind: true },
    { cls: 'tk-var-builtin', pattern: /\$[_0-9&`'+^!]|\$\^\w|\@ARGV\b|\%ENV\b|\$0\b/ },
    { cls: 'tk-var', pattern: /\$#?[A-Za-z_]\w*|[@%][A-Za-z_]\w*|\$\{[^}]+\}/ },
    { cls: 'tk-fn-decl', pattern: /(\bsub\s+)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-keyword', pattern: wordPattern(PERL_KEYWORDS) },
    { cls: 'tk-fn-builtin', pattern: wordPattern(PERL_BUILTINS) },
    { cls: 'tk-property', pattern: /(->)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
    { cls: 'tk-number', pattern: RX.number },
    { cls: 'tk-operator', pattern: /=~|!~|->|=>|<=>|&&|\|\||\.\.|[+\-*/%.!<>=]=?/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,:]/ },
  ];
  G.pl = G.perl;

  // ============================================================
  // PowerShell
  // ============================================================
  const PS_KEYWORDS = (
    'function param begin process end if elseif else switch foreach for while do until break ' +
    'continue return try catch finally throw trap class enum using module in filter hidden static'
  ).split(' ');

  G.powershell = [
    // Block comments before strings; line comments after strings so
    // "not # a comment" stays a string.
    { cls: 'tk-comment', pattern: /<#[\s\S]*?#>/ },
    { cls: 'tk-string', pattern: /"(?:`.|\$\w+|\$\{[^}]*\}|[^"`$\n])*"/, inside: [
        { cls: 'tk-var-builtin', pattern: /\$\{[^}]+\}|\$\w+/ },
    ]},
    { cls: 'tk-string', pattern: /'[^'\n]*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-decorator', pattern: /\[[A-Za-z][\w.]*(?:\(\)|\[\])?\]/ },
    { cls: 'tk-var-builtin', pattern: /\$(?:_|PSItem|PSScriptRoot|PSCommandPath|args|input|this|null|true|false|error|home|host|profile|pid|pwd)\b|\$env:\w+/i },
    { cls: 'tk-var', pattern: /\$\{[^}]+\}|\$\w+/ },
    { cls: 'tk-fn-decl', pattern: /(\bfunction\s+)[\w-]+/i, lookbehind: true },
    { cls: 'tk-keyword', pattern: new RegExp('\\b(?:' + PS_KEYWORDS.join('|') + ')\\b', 'i') },
    { cls: 'tk-operator', pattern: /-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|replace|split|join|and|or|not|xor|band|bor|bxor|is|isnot|as|f)\b/i },
    { cls: 'tk-fn-builtin', pattern: /\b(?:Write-(?:Host|Output|Error|Warning|Verbose)|Get-(?:ChildItem|Item|Content|Process|Service|Member)|Set-(?:Location|Content|Item)|New-(?:Item|Object)|Remove-Item|Invoke-(?:WebRequest|RestMethod|Expression)|Import-Module|ForEach-Object|Where-Object|Select-Object|Sort-Object|Measure-Object|Out-(?:File|Null|String)|Read-Host|Start-(?:Process|Sleep)|Test-Path|Join-Path|Split-Path)\b/ },
    { cls: 'tk-function', pattern: /\b[A-Z][a-z]+-[A-Z]\w+\b/ },
    { cls: 'tk-property', pattern: /(\.)[A-Za-z_]\w*/, lookbehind: true },
    { cls: 'tk-number', pattern: /\b\d[\d_]*(?:\.\d+)?(?:[kmgt]b)?\b/i },
    { cls: 'tk-operator', pattern: /\+\+|--|[+\-*/%!]=?|[<>]/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,|=@]/ },
  ];
  G.ps1 = G.powershell;
  G.psm1 = G.powershell;
  G.pwsh = G.powershell;

  // ============================================================
  // Elixir
  // ============================================================
  const EX_KEYWORDS = (
    'def defp defmodule defmacro defmacrop defstruct defimpl defprotocol defdelegate defguard ' +
    'do end fn when not and or in with for if else unless case cond receive after raise rescue ' +
    'try catch throw import require alias use quote unquote super true false nil'
  ).split(' ');

  G.elixir = [
    { cls: 'tk-doc', pattern: /@(?:moduledoc|doc)\s+"""[\s\S]*?"""/ },
    // Strings before comments, else # inside "..." (incl. #{} interpolation) is eaten
    { cls: 'tk-string', pattern: /"""[\s\S]*?"""|"(?:\\.|#\{[^}\n]*\}|[^"\\\n])*"/, inside: [
        { cls: 'tk-operator', pattern: /#\{[^}\n]*\}/ },
    ]},
    { cls: 'tk-string', pattern: /'(?:\\.|[^'\\\n])*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-decorator', pattern: /@[a-z_]\w*/ },
    { cls: 'tk-var-const', pattern: /:[a-z_]\w*[?!]?/ },
    { cls: 'tk-fn-decl', pattern: /(\b(?:defp?|defmacrop?|defguard|defdelegate)\s+)[a-z_]\w*[?!]?/, lookbehind: true },
    { cls: 'tk-type', pattern: /\b[A-Z]\w*(?:\.[A-Z]\w*)*/ },
    { cls: 'tk-keyword', pattern: wordPattern(EX_KEYWORDS) },
    { cls: 'tk-property', pattern: /(\.)[a-z_]\w*[?!]?/, lookbehind: true },
    { cls: 'tk-function', pattern: /\b[a-z_]\w*[?!]?(?=\s*\()/ },
    { cls: 'tk-number', pattern: RX.number },
    { cls: 'tk-operator', pattern: /\|>|<>|\+\+|--|=>|->|<-|::|&&|\|\||[+\-*/!<>=]=?|[&|^~]/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,.%]/ },
  ];
  G.ex = G.elixir;
  G.exs = G.elixir;

  // ============================================================
  // Haskell
  // ============================================================
  const HS_KEYWORDS = (
    'module where import qualified hiding as data type newtype class instance deriving do case ' +
    'of let in if then else infix infixl infixr foreign default'
  ).split(' ');
  const HS_BUILTINS = (
    'putStrLn putStr print show read return pure fmap map filter foldr foldl zip zipWith ' +
    'length reverse head tail take drop concat mapM mapM_ sequence getLine error id const flip'
  ).split(' ');

  G.haskell = [
    // Block comments before strings; line comments after strings so
    // "not -- a comment" stays a string.
    { cls: 'tk-comment', pattern: /\{-[\s\S]*?-\}/ },
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\\n])*"/ },
    { cls: 'tk-comment', pattern: /--.*/ },
    { cls: 'tk-fn-decl', pattern: /^[a-z_][\w']*(?=\s*::)/m },
    { cls: 'tk-keyword', pattern: wordPattern(HS_KEYWORDS) },
    { cls: 'tk-type', pattern: /\b[A-Z][\w']*/ },
    { cls: 'tk-fn-builtin', pattern: wordPattern(HS_BUILTINS) },
    { cls: 'tk-number', pattern: RX.number },
    { cls: 'tk-operator', pattern: /::|->|<-|=>|>>=|=<<|\+\+|&&|\|\||\$|[+\-*/^<>=!.]=?/ },
    { cls: 'tk-punct', pattern: /[{}[\]();,]/ },
  ];
  G.hs = G.haskell;

  // ============================================================
  // GraphQL
  // ============================================================
  G.graphql = [
    // Strings before comments so "not # a comment" stays a string.
    { cls: 'tk-string', pattern: /"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-decorator', pattern: /@[A-Za-z_]\w*/ },
    { cls: 'tk-var-param', pattern: /\$[A-Za-z_]\w*/ },
    { cls: 'tk-keyword', pattern: /\b(?:query|mutation|subscription|fragment|on|type|interface|union|enum|input|scalar|schema|directive|extend|implements|repeatable|true|false|null)\b/ },
    { cls: 'tk-type', pattern: /\b[A-Z]\w*/ },
    { cls: 'tk-property', pattern: /\b[a-z_]\w*(?=\s*[:(])/ },
    { cls: 'tk-number', pattern: RX.number },
    { cls: 'tk-punct', pattern: /[{}[\]():,=|!&]/ },
  ];
  G.gql = G.graphql;

  // ============================================================
  // TOML / INI
  // ============================================================
  G.toml = [
    // Table headers first (they may contain quoted keys), then strings before
    // comments, else # inside "..." is eaten as a comment
    { cls: 'tk-tag', pattern: /^[ \t]*\[\[?[^\]\n]+\]\]?/m },
    { cls: 'tk-string', pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'[^'\n]*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-type', pattern: /^(\s*)[A-Za-z0-9_.-]+(?=\s*=)/m, lookbehind: true },
    { cls: 'tk-keyword', pattern: /\b(?:true|false)\b/ },
    { cls: 'tk-number', pattern: /\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?|[+-]?\b(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|inf|nan)\b/ },
    { cls: 'tk-operator', pattern: /=/ },
    { cls: 'tk-punct', pattern: /[{}[\],.]/ },
  ];

  G.ini = [
    { cls: 'tk-comment', pattern: /^[ \t]*[;#].*/m },
    { cls: 'tk-tag', pattern: /^[ \t]*\[[^\]\n]+\]/m },
    { cls: 'tk-type', pattern: /^(\s*)[^=:;#\s][^=:\n]*?(?=\s*[=:])/m, lookbehind: true },
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\])*"|'[^'\n]*'/ },
    { cls: 'tk-keyword', pattern: /\b(?:true|false|yes|no|on|off)\b/i },
    { cls: 'tk-number', pattern: /\b\d+(?:\.\d+)?\b/ },
    { cls: 'tk-operator', pattern: /[=:]/ },
  ];
  G.properties = G.ini;
  G.cfg = G.ini;
  G.conf = G.ini;

  // ============================================================
  // Dockerfile
  // ============================================================
  G.dockerfile = [
    // Strings before comments so "not # a comment" stays a string.
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\\n])*"|'[^'\n]*'/ },
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-keyword', pattern: /^\s*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b|\bAS\b/m },
    { cls: 'tk-var-builtin', pattern: /\$\{[^}]+\}|\$\w+/ },
    { cls: 'tk-decorator', pattern: /(^|\s)--[\w-]+(?==|\s|$)/, lookbehind: true },
    { cls: 'tk-number', pattern: /\b\d+(?:\.\d+)?\b/ },
    { cls: 'tk-operator', pattern: /&&|\|\||[|>]/ },
    { cls: 'tk-punct', pattern: /[=[\],]/ },
  ];
  G.docker = G.dockerfile;

  // ============================================================
  // Makefile
  // ============================================================
  G.makefile = [
    { cls: 'tk-comment', pattern: /#.*/ },
    { cls: 'tk-string', pattern: /"(?:\\.|[^"\\])*"|'[^'\n]*'/ },
    { cls: 'tk-keyword', pattern: /^(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|define|endef|export|unexport|override|vpath)\b/m },
    { cls: 'tk-decorator', pattern: /^\.[A-Z_]+\b/m },
    { cls: 'tk-var-builtin', pattern: /\$[@<^+*?%|]|\$\((?:[^()]|\([^)]*\))*\)|\$\{[^}]*\}/ },
    { cls: 'tk-fn-decl', pattern: /^[\w./%-]+(?=\s*:(?!=))/m },
    { cls: 'tk-operator', pattern: /[:?+!]?=|&&|\|\||[|;]/ },
    { cls: 'tk-punct', pattern: /[():,]/ },
  ];
  G.make = G.makefile;
  G.mk = G.makefile;

  // ============================================================
  // Diff / patch · additions render mint (tk-function), deletions warm rose
  // (tk-property) — a pragmatic reuse of the palette's add/remove intuition.
  // ============================================================
  G.diff = [
    { cls: 'tk-comment', pattern: /^(?:diff|index|Only in|Binary files|old mode|new mode|similarity index|rename (?:from|to)) .*/m },
    { cls: 'tk-keyword', pattern: /^@@[^\n]*@@.*/m },
    { cls: 'tk-comment', pattern: /^(?:---|\+\+\+) .*/m },
    { cls: 'tk-function', pattern: /^\+.*/m },
    { cls: 'tk-property', pattern: /^-.*/m },
  ];
  G.patch = G.diff;

  // ============================================================
  // 3. Language aliases + detection
  // ============================================================
  const LANGUAGE_ALIASES = {
    'c++': 'cpp',
    'cxx': 'cpp',
    'cc': 'cpp',
    'hpp': 'cpp',
    'c#': 'csharp',
    'cs': 'csharp',
    'golang': 'go',
    'rb': 'ruby',
    'rs': 'rust',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'yml': 'yaml',
    'md': 'markdown',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'py': 'python',
    'ts': 'typescript',
    'tsx': 'typescript',
    'jsx': 'javascript',
    'sc': 'scala',
    'objc': 'objectivec',
    'objective-c': 'objectivec',
    'obj-c': 'objectivec',
    'pl': 'perl',
    'ps1': 'powershell',
    'psm1': 'powershell',
    'pwsh': 'powershell',
    'ex': 'elixir',
    'exs': 'elixir',
    'hs': 'haskell',
    'gql': 'graphql',
    'docker': 'dockerfile',
    'make': 'makefile',
    'mk': 'makefile',
    'patch': 'diff',
    'properties': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
  };

  function normalizeLanguage(lang) {
    const raw = String(lang || '')
      .toLowerCase()
      .replace(/^(?:language|lang)-/, '')
      .replace(/[^a-z0-9_+#.-]/g, '');
    const mapped = LANGUAGE_ALIASES[raw] || raw;
    return G[mapped] ? mapped : raw;
  }

  function regexScore(code, tests) {
    let score = 0;
    for (const test of tests) {
      if (test[0].test(code)) score += test[1];
    }
    return score;
  }

  function looksLikeJson(trimmed) {
    if (!/^[\[{]/.test(trimmed)) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Shebang interpreters are near-definitive; checked before scoring.
  const SHEBANGS = [
    [/^#!.*\bpython[\d.]*\b/, 'python'],
    [/^#!.*\bperl\b/, 'perl'],
    [/^#!.*\bruby\b/, 'ruby'],
    [/^#!.*\b(?:node|deno|bun)\b/, 'javascript'],
    [/^#!.*\b(?:pwsh|powershell)\b/, 'powershell'],
    [/^#!.*\bphp\b/, 'php'],
    [/^#!.*\b(?:bash|sh|zsh|dash|ksh|fish)\b/, 'shell'],
  ];

  const DETECTORS = [
    // Diff first: its payload embeds other languages' code, so on equal
    // scores the diff signals must win.
    { lang: 'diff', tests: [
      [/^diff --git /m, 8],
      [/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m, 8],
      [/^--- \S+[\s\S]*?^\+\+\+ \S+/m, 5],
      [/^index [0-9a-f]+\.\.[0-9a-f]+/m, 4],
    ]},
    { lang: 'dockerfile', tests: [
      [/^FROM\s+\S+(?:\s+AS\s+\w+)?\s*$/m, 6],
      [/^(?:RUN|CMD|COPY|ADD|ENTRYPOINT|WORKDIR|EXPOSE|ENV|ARG|VOLUME|HEALTHCHECK)\b/m, 4],
      [/^FROM\s+\w[\w./-]*:\S+/m, 3],
    ]},
    { lang: 'makefile', tests: [
      [/^\.PHONY\b/m, 7],
      [/^[\w./%-]+\s*:[^=\n]*\n\t/m, 6],
      [/\$\((?:CC|CXX|CFLAGS|LDFLAGS|MAKE|SRC|OBJ)\b/, 4],
      [/^(?:ifeq|ifneq|ifdef|ifndef)\b/m, 4],
    ]},
    { lang: 'php', tests: [
      [/<\?php\b|<\?=/i, 10],
      [/\$[A-Za-z_]\w*/, 3],
      [/->\w+|::\w+/, 2],
      [/\b(?:echo|function|namespace|use)\b/, 2],
    ]},
    { lang: 'html', tests: [
      [/<!DOCTYPE\s+html>/i, 7],
      [/<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i, 5],
      [/<!--[\s\S]*?-->/, 2],
    ]},
    { lang: 'css', tests: [
      [/[.#]?[A-Za-z][\w-]*[^{]*\{\s*[-\w]+\s*:/, 6],
      [/@(?:media|keyframes|import|supports)\b/, 4],
      [/\b(?:color|display|margin|padding|font-size)\s*:/, 3],
    ]},
    { lang: 'typescript', tests: [
      [/\binterface\s+\w+/, 5],
      [/\btype\s+\w+\s*=/, 5],
      [/\b(?:implements|enum|namespace)\b/, 3],
      [/:\s*(?:string|number|boolean|unknown|[A-Z]\w*)\b/, 3],
    ]},
    { lang: 'javascript', tests: [
      [/\b(?:const|let|var)\s+\w+\s*=/, 4],
      [/\bfunction\s+\w+\s*\(/, 3],
      [/=>/, 3],
      [/\bconsole\.\w+\s*\(/, 3],
      [/\bimport\s+[\s\S]*?\bfrom\b|\bexport\s+(?:default|const|function|class)\b/, 3],
    ]},
    { lang: 'python', tests: [
      [/\bdef\s+\w+\s*\([^)]*\)\s*:/, 6],
      [/^\s*from\s+\w+(?:\.\w+)*\s+import\b/m, 4],
      [/^\s*import\s+\w+/m, 3],
      [/\bself\./, 3],
      [/\bprint\s*\(/, 2],
    ]},
    { lang: 'go', tests: [
      [/^\s*package\s+\w+/m, 6],
      [/\bfunc\s+\w+\s*\(/, 4],
      [/\bimport\s+\(/, 3],
      [/\bfmt\.\w+\s*\(/, 3],
      [/:=/, 2],
    ]},
    { lang: 'rust', tests: [
      [/\bfn\s+\w+\s*\(/, 5],
      [/\blet\s+mut\b/, 3],
      [/\b(?:impl|trait|pub\s+(?:fn|struct|enum))\b/, 3],
      [/\bprintln!\s*\(/, 3],
      [/\buse\s+std::/, 4],
    ]},
    { lang: 'swift', tests: [
      [/^\s*import\s+(?:Foundation|SwiftUI|UIKit|Combine)\b/m, 5],
      [/\bfunc\s+\w+\s*\(/, 5],
      [/\b(?:let|var)\s+\w+\s*:/, 3],
      [/\b(?:struct|class|enum|protocol)\s+\w+/, 3],
      [/\bprint\s*\(/, 2],
    ]},
    { lang: 'kotlin', tests: [
      [/\bfun\s+\w+\s*\(/, 5],
      [/\bdata\s+class\s+\w+/, 5],
      [/\b(?:val|var)\s+\w+\s*[:=]/, 3],
      [/^\s*package\s+[A-Za-z_][\w.]*/m, 2],
      [/\bprintln\s*\(/, 2],
    ]},
    { lang: 'dart', tests: [
      [/^\s*import\s+['"]dart:/m, 6],
      [/\bvoid\s+main\s*\(/, 4],
      [/\b(?:StatelessWidget|StatefulWidget|Widget)\b/, 4],
      [/\bfinal\s+\w+\s*=/, 2],
      [/\bFuture<[^>]+>\s+\w+\s*\(/, 3],
    ]},
    { lang: 'lua', tests: [
      [/\bfunction\s+[A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)?\s*\(/, 5],
      [/^\s*local\s+\w+\s*=/m, 3],
      [/^\s*(?:if|for|while)\b[\s\S]*\bthen\b/m, 3],
      [/\bend\s*$/m, 2],
      [/\bprint\s*\(/, 2],
    ]},
    { lang: 'java', tests: [
      [/\bpublic\s+class\s+\w+/, 6],
      [/\bpublic\s+static\s+void\s+main\b/, 5],
      [/\bSystem\.out\.print/, 5],
      [/\bimport\s+java\./, 4],
    ]},
    { lang: 'csharp', tests: [
      [/\busing\s+System\b/, 5],
      [/\bConsole\.WriteLine\s*\(/, 5],
      [/\bnamespace\s+[A-Za-z_]\w*/, 3],
      [/\bstring\[\]\s+args\b/, 3],
    ]},
    { lang: 'cpp', tests: [
      [/#include\s*<iostream>/, 6],
      [/\bstd::/, 4],
      [/\b(?:cout\s*<<|cin\s*>>)\b/, 5],
      [/#include\s*<[\w.]+>/, 2],
      [/\bint\s+main\s*\(/, 2],
    ]},
    { lang: 'c', tests: [
      [/#include\s*<stdio\.h>/, 6],
      [/\bprintf\s*\(/, 4],
      [/\bmalloc\s*\(/, 3],
      [/\bint\s+main\s*\(/, 2],
    ]},
    { lang: 'ruby', tests: [
      [/^\s*(?:class|module|def)\s+\w+/m, 4],
      [/\bend\s*$/m, 2],
      [/\bputs\s+/, 3],
      [/@[A-Za-z_]\w*/, 2],
      [/\brequire\s+['"]/, 3],
    ]},
    { lang: 'sql', tests: [
      [/\bSELECT\b[\s\S]+\bFROM\b/i, 6],
      [/\bINSERT\s+INTO\b/i, 6],
      [/\bCREATE\s+TABLE\b/i, 6],
      [/\bWHERE\b/i, 2],
    ]},
    { lang: 'yaml', tests: [
      [/^\s*---\s*$/m, 3],
      [/^\s*[A-Za-z_][\w.-]*:\s+/m, 3],
      [/^\s*[A-Za-z_][\w.-]*:\s*(?:true|false|null|yes|no|on|off)\b/im, 2],
      [/^\s*-\s+[A-Za-z_][\w.-]*:\s+/m, 3],
      [/^\s*[A-Za-z_][\w.-]*:\s*$/m, 2],
    ]},
    { lang: 'shell', tests: [
      [/^#!.*\b(?:bash|sh|zsh)\b/m, 7],
      [/\bif\s+\[.*\];\s*then\b/, 5],
      [/\b(?:echo|grep|sed|awk|curl)\b.*\$\w+/, 3],
      [/^\s*(?:export|cd|chmod|mkdir)\s+/m, 2],
    ]},
    { lang: 'elixir', tests: [
      [/\bdefmodule\s+[A-Z]/, 7],
      [/\bdefp?\s+\w+.*\bdo\b/, 4],
      [/\|>/, 3],
      [/\bIO\.(?:puts|inspect|write)\b/, 4],
      [/@(?:moduledoc|doc)\b/, 4],
    ]},
    { lang: 'scala', tests: [
      [/^\s*import\s+scala\./m, 6],
      [/\bcase\s+class\s+\w+/, 5],
      [/\bdef\s+\w+\s*(?:\([^)]*\))?\s*:\s*[A-Z]\w*(?:\[[^\]]*\])?\s*=/, 5],
      [/\bobject\s+\w+\s+extends\s+App\b/, 6],
      [/\bval\s+\w+\s*[:=]/, 2],
    ]},
    { lang: 'objectivec', tests: [
      [/@(?:interface|implementation|protocol)\b/, 6],
      [/\bNSLog\s*\(\s*@"/, 6],
      [/@property\s*\(/, 5],
      [/^#import\s+[<"]/m, 5],
      [/\[\s*\w+\s+\w+(?::|\s*\])/, 2],
    ]},
    { lang: 'r', tests: [
      [/\b(?:library|require)\s*\(\s*[\w.]+\s*\)/, 5],
      [/<-\s*(?:function\b|\d|c\()/, 5],
      [/\b(?:data\.frame|read\.csv|ggplot|tibble)\s*\(/, 5],
      [/%>%|%in%/, 4],
      [/<-/, 2],
    ]},
    { lang: 'perl', tests: [
      [/^\s*use\s+(?:strict|warnings)\b/m, 7],
      [/\bmy\s+[$@%]\w+/, 5],
      [/[$@]\w+\s*=~\s*[ms]?\//, 4],
      [/\bsub\s+\w+\s*\{/, 3],
    ]},
    { lang: 'powershell', tests: [
      [/\[CmdletBinding\(\)\]/i, 7],
      [/\b(?:Write-Host|Get-ChildItem|Invoke-WebRequest|ForEach-Object|Where-Object|Select-Object|Out-Null)\b/, 5],
      [/\bparam\s*\(\s*\[?\$?\w/i, 3],
      [/\$(?:PSItem|PSScriptRoot)\b|\$env:\w+/i, 4],
      [/\s-(?:eq|ne|match|like|contains)\b/, 3],
    ]},
    { lang: 'haskell', tests: [
      [/^module\s+[A-Z][\w.]*\s+where\b/m, 7],
      [/^import\s+qualified\s+/m, 6],
      [/^[a-z_][\w']*\s*::\s*/m, 5],
      [/\bputStrLn\b|\bmapM_?\b/, 3],
      [/\bdata\s+[A-Z]\w*.*=.*\|/, 4],
    ]},
    { lang: 'graphql', tests: [
      [/\bfragment\s+\w+\s+on\s+[A-Z]/, 7],
      [/\b(?:query|mutation|subscription)\s+\w*\s*(?:\([^)]*\))?\s*\{/, 6],
      [/\btype\s+\w+\s*(?:implements\s+\w+\s*)?\{[^}]*\b\w+\s*:\s*\[?[A-Z]/, 5],
      [/\$\w+\s*:\s*\[?[A-Z]\w*!?\]?/, 3],
    ]},
    { lang: 'toml', tests: [
      [/^\[\[[\w.-]+\]\]\s*$/m, 6],
      [/^[\w.-]+\s*=\s*(?:"|'|\[|\d|true|false)/m, 3],
      [/^\[[\w.-]+\]\s*$/m, 2],
      [/^\w+\s*=\s*"""/m, 4],
    ]},
    { lang: 'ini', tests: [
      [/^\s*;.*$/m, 4],
      [/^\[[^\]\n]+\]\s*$/m, 3],
      [/^\w[\w.-]*\s*=\s*[^"\n]*$/m, 2],
    ]},
    { lang: 'markdown', tests: [
      [/^#{1,6}\s+\S+/m, 4],
      [/^\s*(?:[-*+]|\d+\.)\s+\S+/m, 2],
      [/\[[^\]]+\]\([^)]+\)/, 2],
      [/```[\w-]*\n[\s\S]*?\n```/, 4],
    ]},
  ];

  function detectLanguage(code) {
    const source = String(code || '');
    const trimmed = source.trim();
    if (!trimmed) return '';
    if (looksLikeJson(trimmed)) return 'json';

    if (trimmed.startsWith('#!')) {
      for (const [re, lang] of SHEBANGS) {
        if (re.test(trimmed)) return lang;
      }
    }

    let best = { lang: '', score: 0 };
    for (const detector of DETECTORS) {
      const score = regexScore(source, detector.tests);
      if (score > best.score) best = { lang: detector.lang, score };
    }

    return best.score >= 4 ? best.lang : '';
  }

  // ============================================================
  // 4. Public API
  // ============================================================
  // ============================================================
  // Theme palette schema mapping
  //   semantic key (tokens.json)  →  CSS variable suffix
  // Keep this in sync with tools/generate-theme.mjs ALIAS.
  // ============================================================
  const THEME_ALIAS = {
    'keyword':              'keyword',
    'function':             'function',
    'function.declaration': 'fn-decl',
    'function.builtin':     'fn-builtin',
    'variable':             'var',
    'variable.parameter':   'var-param',
    'variable.builtin':     'var-builtin',
    'variable.constant':    'var-const',
    'type':                 'type',
    'property':             'property',
    'string':               'string',
    'string.regex':         'regex',
    'number':               'number',
    'comment':              'comment',
    'comment.doc':          'doc',
    'decorator':            'decorator',
    'operator':             'operator',
    'punctuation':          'punct',
    'tag':                  'tag',
    'attribute':            'attr',
    'selector':             'selector',
    'css.property':         'css-prop',
    'css.unit':             'css-unit',
  };

  function applyThemeToRoot(themeBlock, root) {
    if (!themeBlock) return;
    // Default to the element carrying data-theme (usually <body>): theme
    // stylesheets set the same vars via a [data-theme] selector there, which
    // would shadow inline vars written on any ancestor (e.g. <html>).
    const target = root || (typeof document !== 'undefined'
      ? (document.querySelector('[data-theme]') || document.documentElement)
      : null);
    if (!target) return;
    const set = (name, value) => { if (value) target.style.setProperty(name, value); };
    set('--jr-bg', themeBlock.background);
    set('--jr-fg', themeBlock.foreground);
    set('--jr-border',    themeBlock.border);
    set('--jr-gutter-fg', themeBlock.gutter);
    set('--jr-line-hl',   themeBlock.lineHighlight);
    const tokens = themeBlock.tokens || {};
    // Fallback chain: a missing refined key resolves through its base
    // (function.declaration → function), so palettes that predate a newly
    // added key keep working — the vocabulary can grow in minor versions.
    const resolveColor = (key) => {
      let k = key;
      while (k) {
        const tok = tokens[k];
        if (tok && tok.color) return tok.color;
        const dot = k.lastIndexOf('.');
        k = dot === -1 ? '' : k.slice(0, dot);
      }
      return null;
    };
    for (const key in THEME_ALIAS) {
      const color = resolveColor(key);
      if (color) {
        set('--jr-' + THEME_ALIAS[key], color);
      }
    }
  }

  const JSRay = {
    /**
     * Runtime version, for shell/core compatibility negotiation.
     * Must match version.json — tools/check-versions.mjs asserts it.
     */
    version: '0.0.1-internal.2',
    languages: G,
    normalizeLanguage,
    detectLanguage,

    /**
     * Apply a theme palette (parsed tokens.json shape) at runtime.
     * Sets `--jr-*` CSS variables on the given root. Defaults to the
     * first element carrying `data-theme` (falling back to
     * `document.documentElement`), so runtime edits win over the
     * theme stylesheet's `[data-theme]` block. Pass either the dark
     * or light block, e.g. `JSRay.applyTheme(palette.themes.dark)`.
     */
    applyTheme(themeBlock, root) {
      applyThemeToRoot(themeBlock, root);
    },

    /**
     * Tokenize a code string into a renderer-agnostic stream.
     * Each element is either a plain string (no class) or
     * `{ type: 'tk-xxx', content: string | TokenStream }`.
     * Use this when you want to plug in a non-HTML renderer
     * (PDF, DOCX, ANSI, ...).
     */
    tokenize(code, lang) {
      const normalized = normalizeLanguage(lang);
      const grammar = G[normalized];
      if (!grammar) return [code];
      return tokenize(code, grammar);
    },

    /**
     * Render a token stream (from `tokenize`) into the default
     * HTML form: `<span class="tk-xxx">…</span>`. Custom renderers
     * can be written by walking the stream directly.
     */
    render(stream) {
      return render(stream);
    },

    /** Highlight a code string into an HTML string (tokenize + render) */
    highlight(code, lang) {
      const normalized = normalizeLanguage(lang);
      const grammar = G[normalized];
      if (!grammar) return escapeHtml(code);
      return render(tokenize(code, grammar));
    },

    /** Highlight a single <code> element (language parsed from class or detected) */
    highlightElement(el) {
      const cls = el.className || '';
      const m = cls.match(/(?:^|\s)(?:language|lang)-([A-Za-z0-9_+#.-]+)/);
      const lang = normalizeLanguage(m ? m[1] : detectLanguage(el.textContent));
      if (!lang || !G[lang]) return;
      const code = el.textContent;
      if (!m && el.classList) el.classList.add('language-' + lang);
      el.innerHTML = this.highlight(code, lang);
      el.dataset.cxLang = lang;
    },

    /** Scan the document and highlight language-marked or plain <pre><code> blocks */
    highlightAll(root) {
      const scope = root || document;
      scope.querySelectorAll('code[class*="language-"], code[class*="lang-"], pre > code').forEach((el) => {
        this.highlightElement(el);
      });
    },
  };

  // ============================================================
  // 5. Auto-init
  // ============================================================
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => JSRay.highlightAll());
    } else {
      JSRay.highlightAll();
    }
  }

  // UMD-ish export
  if (typeof module !== 'undefined' && module.exports) module.exports = JSRay;
  global.JSRay = JSRay;
})(typeof window !== 'undefined' ? window : globalThis);
