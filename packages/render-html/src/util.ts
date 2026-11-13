// Escaping, inline markup and text measurement shared by every renderer.

/** `Math.min(...a, init)` and `Math.max(...a, init)` without the spread, which overflows the stack past about 120,000 values. */
export function minOf(a: readonly number[], init = Infinity): number {
  let m = init;
  for (const v of a) if (v < m) m = v;
  return m;
}
export function maxOf(a: readonly number[], init = -Infinity): number {
  let m = init;
  for (const v of a) if (v > m) m = v;
  return m;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SAFE_URL = /^(https?:|mailto:|#|\/|\.{0,2}\/|[\w.-]+(\/|$|\.|#|\?))/i;

export function safeUrl(u: string): string | null {
  const t = u.trim();
  if (/^(javascript|vbscript|data):/i.test(t)) return null;
  return SAFE_URL.test(t) ? t : null;
}

/**
 * `[text](url)` at `lastIndex`. The text holds no bracket, so a run of `[` is read once and not once per bracket; the URL may hold
 * one level of parentheses (`.../Foo_(bar)`) and is bounded, so a line of unclosed links costs its length and not its square.
 */
const LINK = /\[([^\][]+)\]\(((?:[^()\s]|\([^()\s]*\)){1,4096})\)/y;

/**
 * The run of backticks at `i`, read as CommonMark reads it: a run of N opens a code span that closes at the next run of exactly N,
 * so a span written with two may hold one (``` `` a`b `` ```). With two or more, one space inside each end is dropped, which is how
 * a span starts or ends with a backtick. `code` is the span's text, or null when no run closes it: the whole run is then text (no
 * shorter span opens inside it, so a line of backticks is read once and not once per backtick). `end` is where reading goes on.
 */
function codeSpan(src: string, i: number): { code: string | null; end: number } {
  let n = 1;
  while (src[i + n] === '`') n++;
  for (let j = src.indexOf('`', i + n); j >= 0; j = src.indexOf('`', j)) {
    let m = 1;
    while (src[j + m] === '`') m++;
    if (m === n) {
      const body = src.slice(i + n, j);
      const padded = n > 1 && body.length > 2 && body.startsWith(' ') && body.endsWith(' ');
      return { code: padded ? body.slice(1, -1) : body, end: j + n };
    }
    j += m;
  }
  return { code: null, end: i + n };
}

/** Inline markup: `code`, **bold**, *em* or _em_, [text](url). Everything else is escaped text. */
export function inline(src: string): string {
  // Code spans and links are held out as placeholders and emphasis runs over the whole string,
  // so a bold phrase may contain code or a link (`**Stage on `canary-01` only.**`).
  src = src.replace(/[]/g, '');
  const held: string[] = [];
  let s = '';
  const out = {
    push(html: string) {
      s += `${held.length}`;
      held.push(html);
    },
  };
  let i = 0;
  let text = '';
  const pushText = () => {
    if (text) {
      s += esc(text);
      text = '';
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && /[`*_[\]\\]/.test(src[i + 1])) {
      text += src[i + 1] === '*' ? '\u0001' : src[i + 1] === '_' ? '\u0002' : src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const span = codeSpan(src, i);
      if (span.code === null) text += src.slice(i, span.end);
      else {
        pushText();
        out.push(codeTok(span.code));
      }
      i = span.end;
      continue;
    }
    if (c === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(src);
      if (m) {
        const url = safeUrl(m[2]);
        pushText();
        out.push(url ? `<a href="${esc(url)}">${emphasis(esc(m[1]))}</a>` : emphasis(esc(m[1])));
        i += m[0].length;
        continue;
      }
    }
    text += c;
    i++;
  }
  pushText();
  // \u0001 and \u0002 are private placeholders for literal `*` and `_` while emphasis is parsed.
  return emphasis(s)
    .replace(/(\d+)/g, (_, k) => held[+k] ?? '')
    .replaceAll('\u0001', '*')
    .replaceAll('\u0002', '_');
}

/**
 * Inline code is one unbreakable token; a long one may break after / . - _ only. A hyphen that opens a flag (`--depth`,
 * `-n`: at the start, after a space or after another hyphen) is not a break point: a line ending in `--` reads as a
 * different command.
 */
const CODE_MAX = 32;
function codeTok(raw: string): string {
  if (Array.from(raw).length <= CODE_MAX) return `<code>${esc(raw)}</code>`;
  const chars = Array.from(raw);
  const breaks = (ch: string, i: number) => /[/._]/.test(ch) || (ch === '-' && i > 0 && !/[\s-]/.test(chars[i - 1]));
  const body = chars.map((ch, i) => esc(ch) + (breaks(ch, i) ? '<wbr>' : '')).join('');
  return `<code class="brk">${body.replace(/(<wbr>)+$/, '')}</code>`;
}

/**
 * `**bold**`. Its text may hold single asterisks (`**a *b* c**`) and may end in an italic span (`**a *b***`: the first of the
 * three asterisks closes the italic), but does not start with an asterisk. The markers hug the text, as in CommonMark:
 * `x ** 2 * y ** 2` is arithmetic, not bold. The text is read as other characters, whole `*italic*` spans, then lone asterisks.
 */
const BOLD = /\*\*(?![*\s])((?:[^*]|\*[^*\s][^*]*?\*(?=\*\*|[^*]|$)|\*(?!\*))+?)(?<!\s)\*\*/g;

/** `*italic*`: the opening asterisk hugs the text and neither asterisk touches a word character or another asterisk outside. */
const EM_STAR = /(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;

function emphasis(s: string): string {
  const em = (t: string) => t.replace(EM_STAR, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  // The text of a bold span is finished here. A `*` or `_` left over in it becomes the literal one (the placeholders `inline`
  // restores), so the pass over the whole string cannot pair it with one outside the span and cross the tags.
  return em(s.replace(BOLD, (_, t: string) => `<strong>${em(t).replaceAll('*', '\u0001').replaceAll('_', '\u0002')}</strong>`));
}

/** Strip inline markup for plain-text contexts (SVG text, aria labels): the spans and links `inline` reads, as their text. */
export function plain(src: string): string {
  let s = '';
  for (let i = 0; i < src.length;) {
    const span = src[i] === '`' ? codeSpan(src, i) : null;
    LINK.lastIndex = i;
    const link = src[i] === '[' ? LINK.exec(src) : null;
    const end = span?.end ?? (link ? i + link[0].length : i + 1);
    s += span?.code ?? link?.[1] ?? src.slice(i, end);
    i = end;
  }
  return s.replace(BOLD, '$1').replace(EM_STAR, '$1$2');
}

// Approximate advance widths (em) for a system sans at regular weight.
function charW(ch: string): number {
  if (/[ilI.,:;'|!]/.test(ch)) return 0.28;
  if (/[fjrt()[\]\- ]/.test(ch)) return 0.36;
  if (/[mwMW@]/.test(ch)) return 0.86;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.58;
  return 0.55;
}

export function textWidth(s: string, size: number, opts: { mono?: boolean; bold?: boolean } = {}): number {
  if (opts.mono) return s.length * 0.62 * size;
  let w = 0;
  for (const ch of s) w += charW(ch);
  return w * size * (opts.bold ? 1.07 : 1);
}

/**
 * Room for one line of an edge or message label (D79). The label is drawn in the interface sans exactly as written;
 * in a flow diagram it keeps at least the width its mono capitals took at `size`, so the layout keeps its size,
 * and gets more when the text as drawn (at `drawn`) is wider than that (a run of wide capitals).
 */
export const edgeLabelW = (s: string, size: number, drawn = size): number =>
  Math.max(textWidth(s, size, { mono: true }), sansLabelW(s, drawn));

/** Estimated width of a label drawn in the interface sans at weight 500, with the usual margin for a wider real font. */
export const sansLabelW = (s: string, size: number): number => textWidth(s, size) * 1.06;

/** Greedy word wrap of `label` to lines of at most `max` units at `size` (a single word is never split). */
export function wrapTo(label: string, max: number, size = 13, opts: { mono?: boolean; bold?: boolean } = { bold: true }): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, opts) > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export const snap4 = (v: number): number => Math.ceil(v / 4) * 4;

export function slug(s: string): string {
  return (
    plain(s)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'section'
  );
}

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${+v.toFixed(2)}`;
}

// Optional sign, optional currency symbol, integer part, optional decimals, optional unit.
const PLAIN_NUM = /^(\s*(?:[+\-\u2212]?[$\u20ac\u00a3]?|[$\u20ac\u00a3][+\-\u2212])?)(\d+)(\.\d+)?(%|\s+[^\s\d][^\s]{0,7})?\s*$/;
// Columns whose integers are labels, not quantities: years, dates, ids, ports, postal codes, versions.
const YEARISH_HEADER = /\b(years?|fy|dates?|period|ids?|zip|postal|ports?|codes?|tickets?|versions?|builds?)\b/i;

/**
 * Group the integer part of a plain number of 1000 or more with en-US separators. Decimals and
 * the unit stay as written; anything that is not a plain number, and any column whose header
 * says year, fy or date, is returned untouched. Sort keys keep the raw value.
 */
export function fmtCell(raw: string, header = ''): string {
  if (YEARISH_HEADER.test(plain(header))) return raw;
  const m = PLAIN_NUM.exec(raw);
  if (!m) return raw;
  const int = m[2];
  if (Number(int + (m[3] ?? '')) < 1000 || (int.length > 1 && int.startsWith('0'))) return raw;
  return `${m[1]}${BigInt(int).toLocaleString('en-US')}${m[3] ?? ''}${m[4] ?? ''}`;
}
