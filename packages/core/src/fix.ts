// Mechanical repairs for the slips writers actually make, driven by the compiler's own diagnostics.
// A fix is applied only when it is unambiguous or a labelled guess, and only when it leaves the page better than it found it.
import type { Diagnostic } from './ast.ts';
import { mergeThousands, parse, PERCENT, suggestColumn, TABLE_OPTIONS, type ParseOptions } from './parser.ts';
import { num, parseInlineCsv } from './lex.ts';

export interface AppliedFix {
  line: number;
  code: string;
  note: string;
  /** True when the repair picks one of several plausible readings; the owner should look. */
  guess: boolean;
}

export interface FixResult {
  src: string;
  applied: AppliedFix[];
  remaining: Diagnostic[];
}

interface Edit {
  lines: Map<number, string>;
  note: string;
  guess: boolean;
}

const MAX_PASSES = 5;
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoteField = (f: string) => (/[,;"]/.test(f) || f !== f.trim() ? `"${f.replace(/"/g, '""')}"` : f);
// Mask quoted strings so a title that happens to contain a name is never rewritten.
const maskQuotes = (s: string) => s.replace(/"(?:[^"]|"")*"/g, (m) => ' '.repeat(m.length));

const count = (x: { diagnostics: Diagnostic[] }, severity: Diagnostic['severity']) =>
  x.diagnostics.filter((e) => e.severity === severity).length;
/**
 * Fewer errors, or as many errors and fewer warnings. Each repair is judged on its own, so one that makes the page worse
 * (`cards` that pushes a diagram out of a card) is not hidden by an unrelated repair on the same pass.
 */
const better = (after: { diagnostics: Diagnostic[] }, before: { diagnostics: Diagnostic[] }) =>
  count(after, 'error') < count(before, 'error') ||
  (count(after, 'error') === count(before, 'error') && count(after, 'warning') < count(before, 'warning'));

export function fix(src: string, opts: ParseOptions = {}): FixResult {
  const applied: AppliedFix[] = [];
  let doc = parse(src, opts);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let lines = src.split('\n');
    const touched = new Set<number>();
    const made = applied.length;
    const found = doc.diagnostics;
    for (const d of found) {
      if (touched.has(d.line)) continue; // a later pass picks the rest up from fresh columns
      const edit = repair(d, lines);
      if (!edit || [...edit.lines.keys()].some((l) => touched.has(l))) continue;
      const trial = [...lines];
      for (const [l, text] of edit.lines) trial[l - 1] = text;
      const next = trial.join('\n');
      const after = parse(next, opts);
      if (!better(after, doc)) continue;
      for (const l of edit.lines.keys()) touched.add(l);
      lines = trial;
      src = next;
      doc = after;
      applied.push({ line: d.line, code: d.code, note: edit.note, guess: edit.guess });
    }
    if (applied.length === made) break;
  }
  return { src, applied, remaining: doc.diagnostics };
}

function repair(d: Diagnostic, lines: string[]): Edit | null {
  const text = lines[d.line - 1];
  if (text === undefined) return null;
  switch (d.code) {
    case 'heading-depth': {
      const m = /^(\s*)#{4,}(?=\s|$)/.exec(text);
      return m ? one(d.line, text.replace(/^(\s*)#{4,}/, '$1###'), 'heading shortened to ###', false) : null;
    }
    case 'unknown-column':
      return unknownColumn(d, text);
    case 'data-row-width':
      return rowWidth(d, lines);
    case 'csv-thousands':
      return quoteThousands(d, lines);
    case 'name-clash':
      return diagramClash(d, lines);
    case 'kpi-bar':
      return kpiPercent(d, text);
    case 'grid-unfilled':
      return gridToCards(d, lines);
    case 'table-option':
      return inlineTableName(d, lines);
    default:
      return null;
  }
}

const one = (line: number, text: string, note: string, guess: boolean): Edit => ({ lines: new Map([[line, text]]), note, guess });

/** A name that is not a column: repair it to the column the message suggests, if there is one. */
function unknownColumn(d: Diagnostic, text: string): Edit | null {
  const want = d.detail?.column;
  const columns = d.detail?.columns;
  if (typeof want !== 'string' || !Array.isArray(columns)) return null;
  const col = suggestColumn(
    columns.filter((c): c is string => typeof c === 'string'),
    want,
  );
  if (col === null) return null;
  return key(col).startsWith(key(want)) ? columnPrefix(d.line, text, want, col) : strayWord(d.line, text, want, col);
}

/** `x=delay` against a column named `delay ms`: take the one column the name is a prefix of. */
function columnPrefix(line: number, text: string, want: string, col: string): Edit | null {
  const m = new RegExp(`(\\b(\\w+)=|,)${esc(want)}(?=[,\\s]|$)`).exec(maskQuotes(text));
  if (!m) return null;
  const optionKey = m[2];
  // `y=` lists take bare names with spaces; every other option needs them quoted.
  const value = col.includes(' ') && optionKey && optionKey !== 'y' ? `"${col}"` : col;
  const at = m.index + m[1].length;
  return one(line, text.slice(0, at) + value + text.slice(at + want.length), `column ${want} read as ${col}`, false);
}

/**
 * `y=customers sort`: `x=`, `y=` and `focus=` run on across spaces, so a stray word after the column joins its name.
 * Quote the column so the word stands alone; the parser then reports it as an ignored option. A guess: the writer may
 * have meant a column that does not exist.
 */
function strayWord(line: number, text: string, want: string, col: string): Edit | null {
  const words = want.trim().split(/\s+/);
  const n = col.trim().split(/\s+/).length;
  const run = (ws: string[]) => ws.map(esc).join('\\s+');
  const m = new RegExp(`\\b(x|y|focus)=(${run(words.slice(0, n))})(?=\\s+${run(words.slice(n))}(\\s|$))`).exec(maskQuotes(text));
  if (!m) return null;
  const at = m.index + m[1].length + 1;
  const note = `column ${col} quoted; "${words.slice(n).join(' ')}" is not part of it`;
  return one(line, `${text.slice(0, at)}"${col}"${text.slice(at + m[2].length)}`, note, true);
}

interface RowLine {
  prefix: string;
  op: string;
  body: string;
}

const dataDef = (name: string) => new RegExp(`^\\s*data\\s+${esc(name)}\\s*=(?!=)`);

/** Split a `data name = ...`, `data name += ...` or inline `table [opts] = ...` line at the start of its rows. */
function rowLine(text: string): RowLine | null {
  const data = /^(\s*data\s+[A-Za-z_][\w-]*\s*(\+=|=)\s*)(.*)$/.exec(text);
  if (data) return { prefix: data[1], op: data[2], body: data[3] };
  const kw = /^\s*table(?=\s)/.exec(text);
  if (!kw) return null;
  const eq = /(^|\s)=(\s|$)/.exec(text.slice(kw[0].length));
  if (!eq) return null;
  const cut = kw[0].length + eq.index + eq[0].length;
  return { prefix: text.slice(0, cut), op: '=', body: text.slice(cut) };
}

const serialize = (r: string[]) => r.map(quoteField).join(',');

/** Row spans inside `body`: each row's start offset and where its `;` (or the end) is. */
function spansOf(body: string, offsets: number[]): (readonly [number, number])[] {
  return offsets.map((start, k) => [start, k + 1 < offsets.length ? offsets[k + 1] - 1 : body.length] as const);
}

/** The diagnosed row of a data or inline-table line, with a splice that rewrites rows `from`..`to` of it in place. */
function rowAt(d: Diagnostic, text: string) {
  const head = rowLine(text);
  if (!head) return null;
  const { prefix, op, body } = head;
  const csv = parseInlineCsv(body);
  const i = csv.offsets.indexOf(d.col - 1 - prefix.length);
  if (i < 0 || (op === '=' && i === 0)) return null; // never touch the header here
  const spans = spansOf(body, csv.offsets);
  const lead = (k: number) => /^\s*/.exec(body.slice(spans[k][0]))![0];
  const splice = (from: number, to: number, r: string[], note: string, guess: boolean): Edit =>
    one(d.line, prefix + body.slice(0, spans[from][0]) + lead(from) + serialize(r) + body.slice(spans[to][1]), note, guess);
  return { op, csv, i, splice };
}

/**
 * Which columns are numeric, judged from the rows of the same data set that already have the right width, outside the rows
 * being repaired. A column is numeric when it has a value and every value is a number; with no such rows nothing is known.
 */
function numericColumns(d: Diagnostic, lines: string[], want: number, skip: (line: number, row: number) => boolean): boolean[] {
  const name = d.detail?.name;
  const rows: string[][] = [];
  const take = (l: number, from: number) => {
    const head = rowLine(lines[l - 1]);
    if (!head) return;
    parseInlineCsv(head.body).rows.forEach((r, k) => {
      if (k >= from && r.length === want && !skip(l, k)) rows.push(r);
    });
  };
  if (typeof name === 'string' && !name.startsWith('_table')) {
    const add = new RegExp(`^\\s*data\\s+${esc(name)}\\s*\\+=`);
    lines.forEach((l, k) => {
      if (dataDef(name).test(l)) take(k + 1, 1);
      else if (add.test(l)) take(k + 1, 0);
    });
  } else take(d.line, 1); // an inline table lives on its own line
  return Array.from({ length: want }, (_, c) => {
    const vals = rows.map((r) => r[c]).filter((v) => v !== '');
    return vals.length > 0 && vals.every((v) => num(v) !== null);
  });
}

const fits = (cells: string[], numeric: boolean[]) => cells.every((v, c) => !numeric[c] || v === '' || num(v) !== null);

/** A row with the wrong field count: an unquoted comma in prose, a `;` that split one cell in two, or a header with a split number. */
function rowWidth(d: Diagnostic, lines: string[]): Edit | null {
  const fields = d.detail?.fields;
  const want = d.detail?.want;
  if (typeof fields !== 'number' || typeof want !== 'number') return null;
  const at = rowAt(d, lines[d.line - 1]);
  if (!at) return null;
  const { op, csv, i, splice } = at;
  const row = csv.rows[i];
  if (row.length > want) {
    const numeric = numericColumns(d, lines, want, (l, k) => l === d.line && k === i);
    const pick = joinCommas(row, want, numeric);
    return pick ? splice(i, i, pick.cells, `joined ${pick.joined} fields into one quoted cell`, true) : null;
  }
  // A `;` inside a cell ends the row early: the cell's text sits at the end of one row and the start of the next.
  // Try the row before first (a fragment after a full row), then the row after (this row is the first part).
  for (const a of [i - 1, i]) {
    const first = csv.rows[a];
    const second = csv.rows[a + 1];
    if (!first || !second || (a === 0 && op === '=') || first.length + second.length - 1 !== want) continue;
    if (num(first.at(-1)) !== null || num(second[0]) !== null) continue; // `3; Bo` is two cells, not one
    const merged = [...first.slice(0, -1), `${first.at(-1)}; ${second[0]}`, ...second.slice(1)];
    const numeric = numericColumns(d, lines, want, (l, k) => l === d.line && (k === a || k === a + 1));
    if (!fits(merged, numeric)) continue;
    return splice(a, a + 1, merged, 'joined the text either side of `;` into one quoted cell', true);
  }
  return headerThousands(d, lines, row.length);
}

/**
 * Too many fields: some run of neighbouring fields is one cell whose commas were not quoted. Every run is a candidate; one
 * that puts text into a numeric column, glues a bare number to text with ", " (`then fixed, 3`), or glues two bare numbers
 * that are not a thousands group (`8,5`) is dropped. Of the rest: the first that reads as prose (a field with spaces, then
 * one starting in lower case or with a digit), else the only one, else the only one that leaves the first cell (the row's
 * label) alone. Anything still ambiguous is left for the writer.
 */
function joinCommas(row: string[], want: number, numeric: boolean[]): { cells: string[]; joined: number } | null {
  const extra = row.length - want;
  const safe: { p: number; cells: string[] }[] = [];
  for (let p = 0; p + extra < row.length; p++) {
    let joined = row[p];
    let glued = false;
    for (let k = 1; k <= extra; k++) {
      const piece = row[p + k];
      const digits = /\d$/.test(joined) && /^\d/.test(piece);
      const group = digits && /^\d{3}(?!\d)/.test(piece); // `$1` + `450`: a thousands comma
      // `Jan 3` + `2024` continues text; `8` + `5` would make the number 85; `fixed` + `3` takes 3 from its column.
      if (!group && (digits ? num(joined) !== null : num(piece) !== null || (k === 1 && num(row[p]) !== null))) glued = true;
      joined += (digits ? ',' : ', ') + piece;
    }
    const cells = [...row.slice(0, p), joined, ...row.slice(p + extra + 1)];
    if (!glued && fits(cells, numeric)) safe.push({ p, cells });
  }
  const prose = safe.find(({ p }) => row[p].includes(' ') && /^[a-z0-9]/.test(row[p + 1]));
  const later = safe.filter(({ p }) => p > 0);
  const pick = prose ?? (safe.length === 1 ? safe[0] : later.length === 1 ? later[0] : undefined);
  return pick ? { cells: pick.cells, joined: extra + 1 } : null;
}

/** Rows come up short because a header cell like `left of $400,000` was split at its comma: rejoin and quote it. */
function headerThousands(d: Diagnostic, lines: string[], rowFields: number): Edit | null {
  const name = d.detail?.name;
  if (typeof name !== 'string') return null;
  const isDef = (l: string) => dataDef(name).test(l) || (name.startsWith('_table') && /^\s*table\b.*(^|\s)=(\s|$)/.test(l));
  let defAt = d.line;
  if (!isDef(lines[defAt - 1])) {
    defAt = -1;
    for (let l = d.line - 1; l >= 1; l--)
      if (dataDef(name).test(lines[l - 1])) {
        defAt = l;
        break;
      }
    if (defAt < 0) return null;
  }
  const text = lines[defAt - 1];
  const head = rowLine(text);
  if (!head) return null;
  const csv = parseInlineCsv(head.body);
  const header = csv.rows[0];
  if (!header) return null;
  const merged: string[] = [];
  for (let p = 0; p < header.length; p++) {
    if (p + 1 < header.length && /\d$/.test(header[p]) && /^\d{3}$/.test(header[p + 1])) merged.push(`${header[p]},${header[++p]}`);
    else merged.push(header[p]);
  }
  if (merged.length === header.length || merged.length !== rowFields) return null;
  const spans = spansOf(head.body, csv.offsets);
  const lead = /^\s*/.exec(head.body.slice(spans[0][0]))![0];
  const fixed = head.prefix + head.body.slice(0, spans[0][0]) + lead + serialize(merged) + head.body.slice(spans[0][1]);
  return one(defAt, fixed, `header cell "${merged.find((c) => c.includes(','))}" rejoined and quoted`, true);
}

/** `$1,450` in a row: the parser already read it as one number; quoting it makes the source say so. */
function quoteThousands(d: Diagnostic, lines: string[]): Edit | null {
  const want = d.detail?.want;
  if (typeof want !== 'number') return null;
  const at = rowAt(d, lines[d.line - 1]);
  const fixed = at ? mergeThousands(at.csv.rows[at.i], want) : null;
  if (!at || !fixed) return null;
  return at.splice(at.i, at.i, fixed.row, `quoted ${fixed.merged.map((m) => `"${m}"`).join(', ')}`, false);
}

/** `diagram deps` where `deps` is already a data name: rename the diagram and its `deps:` lines. */
function diagramClash(d: Diagnostic, lines: string[]): Edit | null {
  const name = d.detail?.diagram;
  if (typeof name !== 'string') return null;
  const decl = new RegExp(`^(\\s*diagram\\s+)${esc(name)}(?=\\s|$)`);
  if (!decl.test(lines[d.line - 1])) return null;
  const taken = (n: string) => lines.some((l) => new RegExp(`^\\s*(data|diagram)\\s+${esc(n)}(?=\\s|=|\\+|<|$)`).test(l));
  let fresh = `${name}-flow`;
  for (let n = 2; taken(fresh); n++) fresh = `${name}-flow${n}`;
  const out = new Map<number, string>([[d.line, lines[d.line - 1].replace(decl, `$1${fresh}`)]]);
  const body = new RegExp(`^(\\s*)${esc(name)}:`);
  for (let l = d.line + 1; l <= lines.length && body.test(lines[l - 1]); l++) out.set(l, lines[l - 1].replace(body, `$1${fresh}:`));
  return { lines: out, note: `diagram ${name} renamed ${fresh} (${name} is a data name)`, guess: false };
}

/**
 * `kpi Done | 74 of 120 | 61.7% | bar`: the bar takes the value, and the writer put the percent in the change field.
 * Swap the two. A guess: the headline number changes, and only a plain unsigned percent is moved.
 *
 * Any other `bar` the compiler could not draw (`kpi Share | ~75% | roughly three-quarters | bar`) loses the word `bar`. A
 * guess: no bar was drawn, so the page does not change, but the writer may have wanted one and should give the value as a
 * percent from 0 to 100.
 */
function kpiPercent(d: Diagnostic, text: string): Edit | null {
  const m = /^(\s*kpi\s+)(.*)$/.exec(text);
  if (!m) return null;
  const parts = m[2].split('|').map((p) => p.trim());
  const [label, value, delta] = parts;
  if (!label || !value) return null;
  if (!value.startsWith('=') && delta !== undefined && PERCENT.test(delta) && parts.slice(3).includes('bar'))
    return one(
      d.line,
      `${m[1]}${[label, delta, value, ...parts.slice(3)].join(' | ')}`,
      `${delta} moved to the value, ${value} to the change`,
      true,
    );
  // The parser reads a field that is exactly `bar`, from the third on, as the flag.
  const kept = parts.filter((p, i) => i < 2 || p !== 'bar');
  if (kept.length === parts.length) return null;
  while (kept.length > 2 && kept[kept.length - 1] === '') kept.pop();
  return one(
    d.line,
    `${m[1]}${kept.join(' | ')}`,
    `bar dropped, since no bar can be drawn for "${value}"; use a value from 0 to 100 to draw one`,
    true,
  );
}

/**
 * `grid 3` followed by three `### ` sections: a grid holds the next blocks and a heading ends it, so nothing sat side by
 * side. `cards` is the word for ### sections side by side. Only when the cards it makes hold exactly the grid's count. A
 * guess: cards choose their own columns, so the grid's column count is not kept.
 */
function gridToCards(d: Diagnostic, lines: string[]): Edit | null {
  const m = /^(\s*)grid\s+(\d+)(?:\s+count=(\d+))?\s*$/.exec(lines[d.line - 1]);
  if (!m) return null;
  const want = Number(m[3] ?? m[2]);
  const trial = lines.with(d.line - 1, `${m[1]}cards`);
  const cards = parse(trial.join('\n')).blocks.find((b) => b.type === 'cards' && b.line === d.line);
  if (cards?.type !== 'cards' || cards.items.length !== want) return null;
  return one(d.line, `${m[1]}cards`, `grid ${m[2]} before ${want} ### sections written as cards`, true);
}

/**
 * `table vendors = ...`: an inline table has no name, so the word was ignored. Drop it, which changes nothing on the page,
 * unless another keyword line uses the name: then the writer needs `data vendors = ...` and `table vendors`, two lines.
 */
function inlineTableName(d: Diagnostic, lines: string[]): Edit | null {
  const m = /^(\s*table)\s+([A-Za-z_][\w-]*)(?=\s)(.*)$/.exec(lines[d.line - 1]);
  if (!m || TABLE_OPTIONS.includes(m[2]) || !/(^|\s)=(\s|$)/.test(m[3])) return null;
  const used = new RegExp(`^\\s*(data|chart|table|kpi|diagram)\\b.*\\b${esc(m[2])}\\b`);
  if (lines.some((l, k) => k !== d.line - 1 && used.test(l))) return null;
  return one(d.line, `${m[1]}${m[3]}`, `dropped "${m[2]}": an inline table has no name`, false);
}
