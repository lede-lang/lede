// Build-time highlighting of code fences (spec §4.9, D84). A fence whose language is in `HIGHLIGHT_LANGS` is cut into tokens by one
// small scanner per language family and written as `<span class="tk-K">` runs, K one of `TOKEN_KINDS`; nothing else is ever emitted
// here except the `<span class="ln">` that wraps each line of a numbered fence. Every character of the source goes through `esc`
// exactly once and in order, so the text of the block is its source, and no source text reaches a tag or an attribute.
//
// This is a scanner, not a grammar: it knows comments, strings, numbers, keywords, calls and capitalised names, and is wrong in the
// ways that implies (a regex literal is operators, a string does not span lines unless the language has a form that does). Every
// rule matches in one pass and never fails after a long look ahead, so the work is linear in the size of the fence.
import { KEYWORDS } from '@lede-lang/core';
import { esc } from './util.ts';

export const TOKEN_KINDS = ['kw', 'str', 'num', 'cm', 'fn', 'ty', 'op', 'pn', 'add', 'del', 'hd'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

/** A run of source text and its kind (`''`: plain text, written without a span). */
export type Token = readonly [kind: TokenKind | '', text: string];

/** A rule: a sticky regex tried at the current position, and the kind of what it matches. `lead`: only at the start of a line. */
type Rule = readonly [kind: TokenKind | '', re: RegExp, lead?: boolean];

interface Grammar {
  /** Tried in order, before identifiers. */
  rules: readonly Rule[];
  ident: RegExp;
  kw: ReadonlySet<string>;
  ty: ReadonlySet<string>;
  /** Keywords are matched in lower case. */
  ci?: boolean;
  /** A capitalised identifier is a type. */
  caps?: boolean;
  /** Besides white space, the characters that may come before a `lead` rule on its line. */
  lead?: string;
  /** Prose: operator and punctuation characters outside the rules are plain text. */
  prose?: boolean;
}

const words = (s: string): ReadonlySet<string> => new Set(s.split(' '));
const NONE = words('');

const IDENT = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const DASHED = /[\p{L}_][\p{L}\p{N}_.-]*/uy;
const NUM = /(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)\w*/y;
const DQ = /"(?:[^"\\\n]|\\.)*"?/y;
const SQ = /'(?:[^'\\\n]|\\.)*'?/y;
/** A character literal, which a Rust lifetime (`'a`) is not. */
const CHAR = /'(?:\\[^'\n]{1,9}|[^'\\\n])'/y;
const BACKTICK = /`(?:[^`\\]|\\[\s\S])*`?/y;
const TRIPLE = /"""[\s\S]*?(?:"""|$)/y;
const SLASHES = /\/\/.*/y;
const BLOCK = /\/\*[\s\S]*?(?:\*\/|$)/y;
const HASH = /#.*/y;
/** `#` starts a comment only at the start of a line or after white space (shell, YAML). */
const HASH_WORD = /(?<=^|\s)#.*/my;
const OPS = /[+\-*/%=<>!&|^~?:@]+/y;
const PUNCT = /[()[\]{};,.]+/y;

const C_COMMENTS: Rule[] = [
  ['cm', SLASHES],
  ['cm', BLOCK],
];
/** A C-family language: `chars` reads `'x'` as a character and leaves a lone `'` alone; `extra` rules come first. */
const cLike = (kw: string, ty: string, o: { chars?: boolean; extra?: Rule[] } = {}): Grammar => ({
  rules: [...(o.extra ?? []), ...C_COMMENTS, ['str', DQ], ['str', o.chars ? CHAR : SQ], ['num', NUM]],
  ident: IDENT,
  kw: words(kw),
  ty: words(ty),
  caps: true,
});

const JS_KW =
  'as async await break case catch class const continue debugger default delete do else export extends false finally for from ' +
  'function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var ' +
  'void while with yield';
const TS_KW = `${JS_KW} abstract declare enum implements infer interface is keyof namespace override private protected public readonly satisfies type`;
const TS_TY = 'any bigint boolean never number object string symbol unknown';
const js = (kw: string, ty: string): Grammar => cLike(kw, ty, { extra: [['str', BACKTICK]] });
const C_KW =
  'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct ' +
  'switch typedef union volatile while NULL true false';
const C_TY =
  'bool char double float int long short signed unsigned void size_t ssize_t int8_t int16_t int32_t int64_t uint8_t uint16_t ' +
  'uint32_t uint64_t';
const CPP_KW = `${C_KW} alignas alignof catch class concept consteval constexpr const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept nullptr operator override private protected public reinterpret_cast requires static_assert static_cast template this throw try typeid typename using virtual`;
/** `#include`, `#define` and the rest, at the start of a line. */
const PREPROCESSOR: Rule = ['kw', /#[ \t]*[a-z]+/y, true];

const PY_STRING = /[rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/y;
const TOML_STRING = /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?/y;
const SHELL: Grammar = {
  rules: [
    ['cm', HASH_WORD],
    ['str', DQ],
    ['str', /'[^'\n]*'?/y],
    ['ty', /\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[\d@#?*!$-])/y],
    ['num', NUM],
  ],
  ident: DASHED,
  kw: words(
    'alias break case cd continue declare do done echo elif else esac eval exec exit export false fi for function if in local ' +
      'readonly return select set shift source then trap true unset until while',
  ),
  ty: NONE,
};

const GRAMMARS: Record<string, Grammar> = {
  js: js(JS_KW, ''),
  jsx: js(JS_KW, ''),
  ts: js(TS_KW, TS_TY),
  tsx: js(TS_KW, TS_TY),
  go: cLike(
    'break case chan const continue default defer else fallthrough false for func go goto if import interface iota map nil package ' +
      'range return select struct switch true type var',
    'any bool byte complex128 complex64 error float32 float64 int int16 int32 int64 int8 rune string uint uint16 uint32 uint64 uint8 uintptr',
    { chars: true, extra: [['str', BACKTICK]] },
  ),
  rs: cLike(
    'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref ' +
      'return self static struct super trait true type unsafe use where while',
    'bool char f32 f64 i128 i16 i32 i64 i8 isize str u128 u16 u32 u64 u8 usize',
    { chars: true },
  ),
  java: cLike(
    'abstract assert break case catch class continue default do else enum extends false final finally for if implements import ' +
      'instanceof interface native new null package permits private protected public record return sealed static super switch ' +
      'synchronized this throw throws transient true try var volatile while yield',
    'boolean byte char double float int long short void',
    { chars: true, extra: [['str', TRIPLE]] },
  ),
  kt: cLike(
    'as break by catch class companion const constructor continue data do else enum false finally for fun if import in init ' +
      'interface internal is lateinit null object open operator override package private protected public return sealed super ' +
      'suspend this throw true try typealias val var when while',
    '',
    { chars: true, extra: [['str', TRIPLE]] },
  ),
  swift: cLike(
    'actor as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough ' +
      'false fileprivate final for func guard if import in init inout internal is let mutating nil open operator private protocol ' +
      'public repeat rethrows return self static struct subscript super switch throw throws true try typealias var weak where while',
    '',
    { chars: true, extra: [['str', TRIPLE]] },
  ),
  c: cLike(C_KW, C_TY, { chars: true, extra: [PREPROCESSOR] }),
  cpp: cLike(CPP_KW, C_TY, { chars: true, extra: [PREPROCESSOR] }),
  cs: cLike(
    'abstract as async await base break case catch checked class const continue default delegate do else enum event explicit ' +
      'extern false finally fixed for foreach get goto if implicit in init interface internal is lock namespace new null operator ' +
      'out override params private protected public readonly record ref return sealed set sizeof stackalloc static struct switch ' +
      'this throw true try typeof unchecked unsafe using var virtual volatile when where while yield',
    'bool byte char decimal double float int long object sbyte short string uint ulong ushort void',
    { chars: true },
  ),
  py: {
    rules: [
      ['cm', HASH],
      ['str', PY_STRING],
      ['fn', /@[\p{L}_][\p{L}\p{N}_.]*/uy, true],
      ['num', NUM],
    ],
    ident: IDENT,
    kw: words(
      'False None True and as assert async await break case class continue def del elif else except finally for from global if ' +
        'import in is lambda match nonlocal not or pass raise return self try while with yield',
    ),
    ty: words('bool bytes dict float int list object set str tuple'),
    caps: true,
  },
  rb: {
    rules: [
      ['cm', HASH],
      ['str', DQ],
      ['str', SQ],
      ['str', /(?<![:\w]):[A-Za-z_]\w*[?!]?/y],
      ['num', NUM],
    ],
    ident: /[\p{L}_][\p{L}\p{N}_]*[?!]?/uy,
    kw: words(
      'alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo require rescue ' +
        'retry return self super then true undef unless until when while yield',
    ),
    ty: NONE,
    caps: true,
  },
  sh: SHELL,
  bash: SHELL,
  json: {
    rules: [
      ['ty', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y],
      ['str', DQ],
      ['num', /-?\d[\d.eE+-]*/y],
    ],
    ident: IDENT,
    kw: words('true false null'),
    ty: NONE,
  },
  yaml: {
    rules: [
      ['cm', HASH_WORD],
      ['str', DQ],
      ['str', /'[^'\n]*'?/y],
      ['ty', /[^\s#:'"[\]{},&*!|>-][^:#\n]*?(?=:(?:[ \t]|$))/my, true],
      ['fn', /[&*][\w-]+/y],
      ['num', NUM],
    ],
    ident: DASHED,
    kw: words('true false null yes no on off'),
    ty: NONE,
    lead: '-',
  },
  toml: {
    rules: [
      ['cm', HASH],
      ['hd', /\[\[?[^\]\n]*\]?\]?/y, true],
      ['str', TOML_STRING],
      ['ty', /[\w.-]+(?=[ \t]*=)/y, true],
      ['num', /[+-]?\d[\w.:+-]*/y],
    ],
    ident: DASHED,
    kw: words('true false inf nan'),
    ty: NONE,
  },
  sql: {
    rules: [
      ['cm', /--.*/y],
      ['cm', BLOCK],
      ['str', /'(?:[^'\n]|'')*'?/y],
      ['str', DQ],
      ['num', NUM],
    ],
    ident: IDENT,
    kw: words(
      'add all alter and as asc begin between by case check column commit constraint create cross default delete desc distinct ' +
        'drop else end exists false foreign from full grant group having if in index inner insert into is join key left like ' +
        'limit not null offset on or order outer primary recursive references returning right rollback select set table then ' +
        'transaction true union unique update values view when where with',
    ),
    ty: words(
      'bigint bool boolean char date decimal double float int integer json jsonb numeric real serial smallint text timestamp ' +
        'timestamptz uuid varchar',
    ),
    ci: true,
  },
  css: {
    rules: [
      ['cm', BLOCK],
      ['str', DQ],
      ['str', SQ],
      ['kw', /@[\w-]+|!important/y],
      ['ty', /-{0,2}[A-Za-z_][\w-]*(?=[ \t]*:[^{}\n]*(?:[;}]|$))/my, true],
      ['num', /#[\da-fA-F]{3,8}\b|-?(?:\d+\.?\d*|\.\d+)[a-zA-Z%]*/y],
    ],
    ident: /-{0,2}[\p{L}_][\p{L}\p{N}_-]*/uy,
    kw: NONE,
    ty: NONE,
    lead: '{;',
  },
};

/** The languages a fence is highlighted in (spec §4.9). The names are matched as written, in lower case. */
export const HIGHLIGHT_LANGS: readonly string[] = [...Object.keys(GRAMMARS), 'html', 'diff', 'lede'].toSorted();
const LISTED = new Set(HIGHLIGHT_LANGS);
/** Whether a fence with this info string is highlighted. */
export const highlights = (lang: string): boolean => LISTED.has(lang);

/** Collects tokens, with neighbouring plain text joined into one. */
class Out {
  readonly tokens: Token[] = [];
  private plain = '';
  push(kind: TokenKind | '', text: string): void {
    if (kind === '') {
      this.plain += text;
      return;
    }
    this.flush();
    if (text !== '') this.tokens.push([kind, text]);
  }
  flush(): Token[] {
    if (this.plain !== '') this.tokens.push(['', this.plain]);
    this.plain = '';
    return this.tokens;
  }
}

/** The first match of sticky `re` at `i`, or null; an empty match is no match. */
function at(re: RegExp, text: string, i: number): string | null {
  re.lastIndex = i;
  const m = re.exec(text);
  return m && m[0] !== '' ? m[0] : null;
}

/** Cuts `text` into tokens with a grammar's rule table. The tokens' texts, joined, are `text`. */
function scan(text: string, g: Grammar, out = new Out()): Out {
  const blank = new Set(` \t${g.lead ?? ''}`.split(''));
  /** Nothing but white space (and the grammar's `lead` characters) has come on this line so far. */
  let lead = true;
  const take = (kind: TokenKind | '', t: string): number => {
    out.push(kind, t);
    const nl = t.lastIndexOf('\n');
    let fresh = nl >= 0 || lead;
    for (let k = nl + 1; fresh && k < t.length; k++) fresh = blank.has(t[k]);
    lead = fresh;
    return t.length;
  };
  let i = 0;
  next: while (i < text.length) {
    for (const [kind, re, atLead] of g.rules) {
      const m = atLead && !lead ? null : at(re, text, i);
      if (m !== null) {
        i += take(kind, m);
        continue next;
      }
    }
    const word = at(g.ident, text, i);
    if (word !== null) {
      const key = g.ci ? word.toLowerCase() : word;
      const called = text[i + word.length] === '(';
      const kind = g.kw.has(key) ? 'kw' : g.ty.has(key) ? 'ty' : called ? 'fn' : g.caps && /^\p{Lu}/u.test(word) ? 'ty' : '';
      i += take(kind, word);
      continue;
    }
    const op = g.prose ? null : at(OPS, text, i);
    const pn = g.prose || op !== null ? null : at(PUNCT, text, i);
    // Any other character is plain text, taken whole when it is a surrogate pair.
    i += take(op !== null ? 'op' : pn !== null ? 'pn' : '', op ?? pn ?? String.fromCodePoint(text.codePointAt(i)!));
  }
  return out;
}

// ------------------------------------------------------------------ html

const MARKUP_COMMENT = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?/y;
const TAG_OPEN = /<\/?(?=[A-Za-z])/y;
const TAG_NAME = /[A-Za-z][\w:.-]*/y;
const CHAR_REF = /&#?\w{1,32};/y;
const TAG_END = /\/?>/y;
const QUOTED = /"[^"]*"?|'[^']*'?/y;
const ATTR_NAME = /[^\s"'<>/=]+/y;
const ATTR_VALUE = /[^\s"'<>=`]+/y;

/** Markup: comments, tags (name, attribute names and values) and character references. Script and style contents are plain. */
function scanHtml(text: string): Out {
  const out = new Out();
  let i = 0;
  /** Inside a tag, after its name; `value`: the last thing in it was `=`, so a bare word is a value. */
  let tag = false;
  let value = false;
  const take = (kind: TokenKind | '', t: string): void => {
    out.push(kind, t);
    i += t.length;
  };
  while (i < text.length) {
    let m: string | null;
    if (!tag) {
      if ((m = at(MARKUP_COMMENT, text, i)) !== null) take('cm', m);
      else if ((m = at(TAG_OPEN, text, i)) !== null) {
        take('pn', m);
        take('kw', at(TAG_NAME, text, i) ?? '');
        tag = true;
      } else if ((m = at(CHAR_REF, text, i)) !== null) take('num', m);
      else take('', String.fromCodePoint(text.codePointAt(i)!));
      continue;
    }
    const wasValue: boolean = value;
    value = false;
    if ((m = at(TAG_END, text, i)) !== null) {
      take('pn', m);
      tag = false;
    } else if ((m = at(QUOTED, text, i)) !== null) take('str', m);
    else if (text[i] === '=') {
      take('op', '=');
      value = true;
    } else if ((m = at(wasValue ? ATTR_VALUE : ATTR_NAME, text, i)) !== null) take(wasValue ? 'str' : 'ty', m);
    else {
      // White space keeps a pending `=`; anything else in a tag is plain text.
      value = wasValue && /\s/.test(text[i]);
      take('', String.fromCodePoint(text.codePointAt(i)!));
    }
  }
  return out;
}

// ------------------------------------------------------------------ lede

const EDITOR_LINE = /^(?:param|toggle|bucket|template|preset)\s+\S[^|]*\|/;
const DECISION_LINE = /^decision\s+[A-Za-z][\w-]*\s+["sb]/;
const EDITOR_WORDS = new Set(['param', 'toggle', 'bucket', 'template', 'preset', 'decision']);
const LEDE_KEYWORDS = new Set<string>(KEYWORDS);
/** The words whose line declares a name that later `NAME:` lines bind to. */
const NAMING = new Set(['data', 'diagram', 'bucket', 'decision']);
/** A code span: a whole run of N backticks to the next run of exactly N on the line (§5). An unclosed run costs one look along the line. */
const CODE_SPAN = /(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/y;
/** Prose: code spans, the marks of bold and italic, and a link's brackets and target. */
const INLINE: Grammar = {
  rules: [
    ['', /\\[`*_[\]\\]/y],
    ['str', CODE_SPAN],
    ['pn', /\*\*|\*|\[|\]\(/y],
    ['str', /(?<=\]\()[^\s)]+/y],
    ['pn', /(?<=\]\([^\s)]*)\)/y],
  ],
  ident: /[\p{L}\p{N}_]+/uy,
  kw: NONE,
  ty: NONE,
  prose: true,
};
/** The rest of a keyword or `NAME:` line: options, quoted text, numbers, arrows and separators. */
const STATEMENT: Grammar = {
  rules: [
    ['str', /"(?:[^"\n]|"")*"?/y],
    ['str', CODE_SPAN],
    ['ty', /[A-Za-z][\w-]*(?==)/y],
    ['op', /<?-x?-{0,2}>|-x-|=/y],
    ['pn', /[|,;:]/y],
    ['num', /-?\d[\d.,]*%?(?![\w-])/y],
  ],
  ident: /[\p{L}\p{N}_][\p{L}\p{N}_.-]*/uy,
  kw: NONE,
  ty: NONE,
  prose: true,
};

/** A Lede page, a line at a time, as the parser classifies lines (§3): the reading is approximate, the text is exact. */
function scanLede(text: string): Out {
  const out = new Out();
  const names = new Set<string>();
  let fence = 0;
  for (const [n, line] of text.split('\n').entries()) {
    if (n > 0) out.push('', '\n');
    const s = line.trimStart();
    out.push('', line.slice(0, line.length - s.length));
    const ticks = /^`{3,}/.exec(s)?.[0].length ?? 0;
    let m: RegExpExecArray | null;
    if (fence > 0) {
      const closes = ticks >= fence && s.trim().length === ticks;
      out.push(closes ? 'pn' : '', s);
      if (closes) fence = 0;
    } else if (ticks > 0 && /^`+\s*=?[\w+-]*(?:\s+lines)?\s*$/.test(s)) {
      out.push('pn', s);
      fence = ticks;
    } else if (/^#{1,6}(?:\s|$)/.test(s)) out.push('hd', s);
    else if ((m = /^@[A-Za-z][\w-]*/.exec(s))) {
      out.push('ty', m[0]);
      scan(s.slice(m[0].length), INLINE, out);
    } else if (
      (m = /^[a-z]+(?=\s|$)/.exec(s)) &&
      LEDE_KEYWORDS.has(m[0]) &&
      (!EDITOR_WORDS.has(m[0]) || EDITOR_LINE.test(s) || DECISION_LINE.test(s))
    ) {
      out.push('kw', m[0]);
      const name = /^\s+([A-Za-z][\w-]*)/.exec(s.slice(m[0].length))?.[1];
      if (name !== undefined && NAMING.has(m[0])) names.add(name);
      scan(s.slice(m[0].length), STATEMENT, out);
    } else if ((m = /^([A-Za-z][\w-]*):(?=\s|$)/.exec(s)) && names.has(m[1])) {
      out.push('fn', m[0]);
      scan(s.slice(m[0].length), STATEMENT, out);
    } else if ((m = /^html:(?=\s|$)/.exec(s))) {
      out.push('kw', m[0]);
      out.push('', s.slice(m[0].length));
    } else if ((m = /^(?:-{3,}\s*$|--? (?:\[[ xX]\] )?|\d+[.)] |> ?|!{1,3} |: |\\)/.exec(s))) {
      out.push(m[0].startsWith('!') ? 'op' : 'pn', m[0]);
      scan(s.slice(m[0].length), INLINE, out);
    } else scan(s, INLINE, out);
  }
  return out;
}

// ------------------------------------------------------------------ output

const span = (kind: TokenKind, html: string): string => `<span class="tk-${kind}">${html}</span>`;

/** Tokens as HTML, one string per source line: a token that spans lines is cut at each break, so no span holds one. */
function lineHtml(tokens: readonly Token[]): string[] {
  const lines = [''];
  for (const [kind, text] of tokens)
    for (const [i, part] of text.split('\n').entries()) {
      if (i > 0) lines.push('');
      if (part !== '') lines[lines.length - 1] += kind ? span(kind, esc(part)) : esc(part);
    }
  return lines;
}

/**
 * A unified diff, one line at a time. An added or removed line is one span that holds its sign as an operator, so the sheet can give
 * the line a background and the sign a gutter; a context line's leading space is that gutter. Before the first hunk `---` and `+++`
 * are file headers, and inside one they are a removed and an added line.
 */
function diffHtml(text: string): string[] {
  let hunk = false;
  return text.split('\n').map((line) => {
    const sign = line[0];
    if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) {
      hunk = line.startsWith('@@');
      return span('hd', esc(line));
    }
    if (!hunk && /^(?:---|\+\+\+)(?: |$)/.test(line)) return span('hd', esc(line));
    if (sign === '+' || sign === '-') return span(sign === '+' ? 'add' : 'del', span('op', sign) + esc(line.slice(1)));
    if (sign === ' ') return span('pn', ' ') + esc(line.slice(1));
    return line.startsWith('\\') ? span('cm', esc(line)) : esc(line);
  });
}

/** The tokens of a fence in a listed language other than `diff` (which is drawn by line). Joined, their texts are `text`. */
export function tokenize(lang: string, text: string): Token[] {
  if (lang === 'html') return scanHtml(text).flush();
  if (lang === 'lede') return scanLede(text).flush();
  return Object.hasOwn(GRAMMARS, lang) ? scan(text, GRAMMARS[lang]).flush() : [['', text]];
}

/**
 * The contents of a fence's `<code>`: highlighted when `lang` is listed, and with each line in a `<span class="ln">` when `numbered`
 * (the sheet counts them). The line breaks stay text between the lines, so the element's text is `text` in every case.
 */
export function codeHtml(text: string, lang: string, numbered: boolean): string {
  const lines = lang === 'diff' ? diffHtml(text) : highlights(lang) ? lineHtml(tokenize(lang, text)) : esc(text).split('\n');
  return (numbered ? lines.map((l) => `<span class="ln">${l}</span>`) : lines).join('\n');
}
