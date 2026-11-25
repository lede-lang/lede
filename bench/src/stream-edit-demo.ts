// Streaming and edit-cost demonstration, Lede against HTML, from files already in the repo. No API key, no browser.
//   node bench/src/stream-edit-demo.ts            prints two tables, writes their summary to bench/results/stream-edit-demo.json
// Method note: bench/STREAM-EDIT.md.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LedeStream } from '@lede-lang/core';

const require = createRequire(import.meta.url);
// The same counts as the package's countTokens, from one encoder; countTokens builds a new one per call (about 35 ms each).
const { getTokenizer } = require('@anthropic-ai/tokenizer') as {
  getTokenizer: () => { encode: (s: string, allowed: 'all') => { length: number } };
};
const encoder = getTokenizer();
const countTokens = (s: string) => encoder.encode(s.normalize('NFKC'), 'all').length;
const BENCH = join(import.meta.dirname, '..');

// ------------------------------------------------------------------ first visible block

/** Block types that draw nothing a reader sees: a `data` set only feeds a chart or table, a `preset` only names editor values. */
const INVISIBLE = new Set(['data', 'preset']);

/**
 * Characters of `src` that must have arrived before LedeStream hands back its first visible block. The text is fed one character at a
 * time, so the answer is the exact offset of the newline that finishes the block (the stream decides per line). Null when no block comes.
 */
export function ledeFirstBlock(src: string): number | null {
  const s = new LedeStream();
  for (let i = 0; i < src.length; i++) {
    if (s.write(src[i]).some((b) => !INVISIBLE.has(b.type))) return i + 1;
  }
  return null;
}

/** Elements whose content is never painted as page text. */
const SKIP = new Set(['head', 'style', 'script', 'template', 'noscript', 'title']);
const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'wbr', 'source', 'col', 'area', 'base']);

/**
 * Characters of an HTML page that must have arrived before its first visible content is complete. Rule, chosen to favour HTML: walk the
 * tags after `</head>` (or, with no head, after the last `</style>`); ignore head, style, script, template, noscript and title content,
 * comments, and anything inside a `hidden` element; the first `<img>`, or the first closing tag of any element (a `<span>` or `<b>`
 * counts, not only a block) whose content holds a non-space character, an `<img` or an `<svg`, ends the first block. Null when none.
 */
/** Where the body starts: after `</head>`, or with no head after the last `</style>`, else 0. */
export function htmlBodyStart(src: string): number {
  const lc = src.toLowerCase();
  const head = lc.indexOf('</head>');
  if (head >= 0) return head + 7;
  const style = lc.lastIndexOf('</style>');
  return style >= 0 ? style + 8 : 0;
}

export function htmlFirstBlock(src: string): number | null {
  const at = htmlBodyStart(src);
  const re = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  re.lastIndex = at;
  const stack: { name: string; start: number; hidden: boolean }[] = [];
  let skipDepth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) continue;
    const close = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    if (!close) {
      if (name === 'img' && skipDepth === 0 && !stack.some((x) => x.hidden)) return re.lastIndex;
      if (VOID.has(name) || attrs.endsWith('/')) continue;
      stack.push({ name, start: re.lastIndex, hidden: /(^|\s)hidden(\s|=|$)/i.test(attrs) });
      if (SKIP.has(name)) skipDepth++;
      continue;
    }
    let i = stack.length - 1;
    while (i >= 0 && stack[i].name !== name) i--;
    if (i < 0) continue;
    const el = stack[i];
    stack.length = i;
    if (SKIP.has(name)) {
      skipDepth--;
      continue;
    }
    if (skipDepth > 0 || el.hidden || stack.some((x) => x.hidden)) continue;
    const inner = src.slice(el.start, m.index);
    if (/\S/.test(inner.replace(/<[^>]*>/g, '')) || /<(img|svg)\b/i.test(inner) || name === 'svg') return re.lastIndex;
  }
  return null;
}

// ------------------------------------------------------------------ edit size

export interface Hunk {
  removed: string[];
  added: string[];
}

/** Line diff by longest common subsequence. Returns the runs of removed and added lines between common lines. */
export function lineHunks(before: string, after: string): Hunk[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const x = a.slice(lo, ea);
  const y = b.slice(lo, eb);
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) {
      (cur ??= { removed: [], added: [] }).added.push(y[j++]);
    } else {
      (cur ??= { removed: [], added: [] }).removed.push(x[i++]);
    }
  }
  flush();
  return hunks;
}

export interface EditSize {
  /** Lines removed plus lines added. A replaced line counts twice. */
  changedLines: number;
  linesAdded: number;
  linesRemoved: number;
  /** Characters a minimal patch inserts: per hunk, the new text less the prefix and suffix it shares with the old text. */
  charsInserted: number;
  charsDeleted: number;
  /** Legacy-tokenizer tokens of the inserted text, counted per hunk. */
  tokensInserted: number;
}

export function editSize(before: string, after: string): EditSize {
  const out: EditSize = { changedLines: 0, linesAdded: 0, linesRemoved: 0, charsInserted: 0, charsDeleted: 0, tokensInserted: 0 };
  for (const h of lineHunks(before, after)) {
    out.linesAdded += h.added.length;
    out.linesRemoved += h.removed.length;
    const o = h.removed.join('\n');
    const n = h.added.join('\n');
    let p = 0;
    while (p < o.length && p < n.length && o[p] === n[p]) p++;
    let s = 0;
    while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s++;
    const ins = n.slice(p, n.length - s);
    out.charsInserted += ins.length;
    out.charsDeleted += o.length - p - s;
    if (ins) out.tokensInserted += countTokens(ins);
  }
  out.changedLines = out.linesAdded + out.linesRemoved;
  return out;
}

// ------------------------------------------------------------------ statistics

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}
const spread = (xs: number[]) => ({
  n: xs.length,
  median: quantile(xs, 0.5),
  p25: quantile(xs, 0.25),
  p75: quantile(xs, 0.75),
  min: Math.min(...xs),
  max: Math.max(...xs),
});
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

// ------------------------------------------------------------------ the run

const read = (p: string) => readFileSync(p, 'utf8');
const ids = (dir: string, ext: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => f.slice(0, -ext.length));

interface PairRow {
  writer: string;
  lede: string;
  id: string;
  ledeTokens: number;
  htmlTokens: number;
  /** Of htmlTokens, those before the body starts (the head, mostly its `<style>`). */
  htmlHeadTokens: number;
  ledeChars: number;
  htmlChars: number;
}

function firstBlockPairs(): PairRow[] {
  const gen = join(BENCH, 'gen');
  const rows: PairRow[] = [];
  for (const dir of readdirSync(gen).sort()) {
    const cdir = join(gen, dir, 'C');
    if (!existsSync(cdir)) continue;
    const writer = dir.replace(/-r\d+h?$/, '');
    const bdir = join(gen, writer, 'B');
    if (!existsSync(bdir)) continue;
    for (const id of ids(cdir, '.lede').sort()) {
      const hp = join(bdir, `${id}.html`);
      if (!existsSync(hp)) continue;
      const lede = read(join(cdir, `${id}.lede`));
      const html = read(hp);
      const lc = ledeFirstBlock(lede);
      const hc = htmlFirstBlock(html);
      if (lc === null || hc === null) continue;
      rows.push({
        writer,
        lede: dir,
        id,
        ledeChars: lc,
        htmlChars: hc,
        ledeTokens: countTokens(lede.slice(0, lc)),
        htmlTokens: countTokens(html.slice(0, hc)),
        htmlHeadTokens: countTokens(html.slice(0, htmlBodyStart(html))),
      });
    }
  }
  return rows;
}

interface EditRow extends EditSize {
  writer: string;
  arm: 'B' | 'C';
  id: string;
  beforeChars: number;
  ok: boolean | null;
}

function editRows(): EditRow[] {
  const results = existsSync(join(BENCH, 'results', 'edits.json'))
    ? (JSON.parse(read(join(BENCH, 'results', 'edits.json'))) as { key: string; edit?: { ok: boolean } }[])
    : [];
  const ok = new Map(results.map((r) => [r.key, r.edit?.ok ?? null]));
  const rows: EditRow[] = [];
  for (const writer of ['haiku', 'opus']) {
    for (const arm of ['B', 'C'] as const) {
      const ext = arm === 'B' ? '.html' : '.lede';
      const edited = join(BENCH, 'edits', writer, arm);
      if (!existsSync(edited)) continue;
      for (const id of ids(edited, ext).sort()) {
        const orig = join(BENCH, 'gen', writer, arm, id + ext);
        if (!existsSync(orig)) continue;
        const before = read(orig);
        rows.push({
          writer,
          arm,
          id,
          beforeChars: before.length,
          ok: ok.get(`${writer}/${arm}/${id}`) ?? null,
          ...editSize(before, read(join(edited, id + ext))),
        });
      }
    }
  }
  return rows;
}

const col = (xs: (string | number)[], w: number) => xs.map((x, i) => String(x)[i === 0 ? 'padEnd' : 'padStart'](w)).join('  ');

function main() {
  const pairs = firstBlockPairs();
  const groups = new Map<string, PairRow[]>();
  for (const p of pairs) for (const k of [p.lede, `${p.writer} (all rounds)`]) groups.set(k, [...(groups.get(k) ?? []), p]);
  const t1 = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, rs]) => ({
      group: k,
      pairs: rs.length,
      ledeTokens: spread(rs.map((r) => r.ledeTokens)),
      htmlTokens: spread(rs.map((r) => r.htmlTokens)),
      ledeChars: spread(rs.map((r) => r.ledeChars)),
      htmlChars: spread(rs.map((r) => r.htmlChars)),
      ratioMedian: quantile(
        rs.map((r) => r.htmlTokens / r.ledeTokens),
        0.5,
      ),
      ledeFirstShare: rs.filter((r) => r.ledeTokens < r.htmlTokens).length / rs.length,
      htmlHeadShareMedian: quantile(
        rs.map((r) => r.htmlHeadTokens / r.htmlTokens),
        0.5,
      ),
    }));
  console.log(
    'Table 1. Output tokens (legacy tokenizer) before the first visible block. Median [p25-p75]; ratio = median of HTML/Lede per pair.',
  );
  console.log(col(['writer / Lede round', 'pairs', 'Lede tok', 'HTML tok', 'HTML/Lede', 'Lede first', 'HTML in head'], 22));
  for (const g of t1) {
    const f = (s: ReturnType<typeof spread>) => `${r1(s.median)} [${r1(s.p25)}-${r1(s.p75)}]`;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    console.log(
      col([g.group, g.pairs, f(g.ledeTokens), f(g.htmlTokens), r1(g.ratioMedian), pct(g.ledeFirstShare), pct(g.htmlHeadShareMedian)], 22),
    );
  }

  const edits = editRows();
  const t2: unknown[] = [];
  console.log('\nTable 2. Size of the stored edit, original to patched file, 40 requests per writer and arm. Median [p25-p75].');
  console.log(col(['writer / arm', 'tasks', 'changed lines', 'chars inserted', 'tokens inserted', 'file chars', 'edit ok'], 17));
  for (const writer of ['haiku', 'opus'])
    for (const arm of ['B', 'C'] as const) {
      const rs = edits.filter((r) => r.writer === writer && r.arm === arm);
      if (!rs.length) continue;
      const row = {
        writer,
        arm,
        tasks: rs.length,
        changedLines: spread(rs.map((r) => r.changedLines)),
        charsInserted: spread(rs.map((r) => r.charsInserted)),
        tokensInserted: spread(rs.map((r) => r.tokensInserted)),
        fileChars: spread(rs.map((r) => r.beforeChars)),
        editOk: rs.filter((r) => r.ok).length,
      };
      t2.push(row);
      const f = (s: ReturnType<typeof spread>) => `${r1(s.median)} [${r1(s.p25)}-${r1(s.p75)}]`;
      console.log(
        col(
          [
            `${writer} ${arm === 'B' ? 'HTML' : 'Lede'}`,
            rs.length,
            f(row.changedLines),
            f(row.charsInserted),
            f(row.tokensInserted),
            r1(row.fileChars.median),
            `${row.editOk}/${rs.length}`,
          ],
          17,
        ),
      );
    }

  writeFileSync(
    join(BENCH, 'results', 'stream-edit-demo.json'),
    JSON.stringify(
      { unit: 'tokens of @anthropic-ai/tokenizer (legacy, offline); characters also given', firstBlock: t1, edit: t2 },
      null,
      1,
    ) + '\n',
  );
  console.log('\nwrote bench/results/stream-edit-demo.json');
}

if (import.meta.main) main();
