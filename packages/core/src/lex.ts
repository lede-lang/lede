// Small tokenizers shared by the block parsers: option lists and inline CSV.

export interface Opts {
  kv: Record<string, string>;
  flags: string[];
  words: string[]; // bare words that are not flags the caller knows about
  quoted: string[]; // standalone "quoted strings", in order
  /** The text of a `"` that is never closed, which runs to the end of the line, options and all; null when every quote closes. */
  unclosed: string | null;
  /**
   * Bare words that follow an unquoted `key=value` (`title=Deploys per week`): the words (`per week`, which are in `words` too,
   * from index `at`) and the option as it was probably meant (`title="Deploys per week"`).
   */
  spills: { at: number; words: string[]; meant: string }[];
}

/**
 * Tokenize `key=value key="quoted value" flag "standalone quote" word`.
 * Every token's start offset (within `s`) is kept for diagnostics.
 */
export function tokens(s: string): { text: string; offset: number; quoted: boolean; key?: string | undefined; unclosed?: boolean }[] {
  const out: ReturnType<typeof tokens> = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    let key: string | undefined;
    const km = /^([A-Za-z_][\w-]*)=/.exec(s.slice(i));
    if (km) {
      key = km[1];
      i += km[0].length;
    }
    if (s[i] === '"') {
      const { value, end, closed } = readQuoted(s, i);
      out.push({ text: value, offset: start, quoted: true, key, unclosed: !closed });
      i = end;
    } else {
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      out.push({ text: s.slice(i, j), offset: start, quoted: false, key });
      i = j;
    }
  }
  return out;
}

/** Read a "quoted" string starting at s[i] === '"'. `""` and `\"` are literal quotes. */
export function readQuoted(s: string, i: number): { value: string; end: number; closed: boolean } {
  let value = '';
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && s[j + 1] === '"') {
      value += '"';
      j += 2;
      continue;
    }
    if (c === '"') {
      if (s[j + 1] === '"') {
        value += '"';
        j += 2;
        continue;
      }
      return { value, end: j + 1, closed: true };
    }
    value += c;
    j++;
  }
  return { value, end: j, closed: false };
}

/**
 * Like `parseOpts`, but values of the keys in `spanKeys` run on across spaces until the next
 * `key=`, flag or quoted string, so `y=open bugs,closed title="x"` reads y as "open bugs,closed".
 * Column names with spaces are common in real data and models rarely quote them.
 */
export function parseOpts(s: string, flagNames: string[] = [], spanKeys: string[] = []): Opts {
  const o: Opts = { kv: {}, flags: [], words: [], quoted: [], unclosed: null, spills: [] };
  const ts = tokens(s);
  const bare = (k: number) => k < ts.length && ts[k].key === undefined && !ts[k].quoted && !flagNames.includes(ts[k].text);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.unclosed) o.unclosed = t.text;
    if (t.key !== undefined && spanKeys.includes(t.key) && !t.quoted) {
      let v = t.text;
      while (bare(i + 1)) v += ` ${ts[++i].text}`;
      o.kv[t.key] = v;
      continue;
    }
    if (t.key !== undefined && !t.quoted && bare(i + 1)) {
      // `title=Deploys per week`: the value ended at the first space and the rest are stray words. Say what was probably meant.
      let end = i + 1;
      while (bare(end + 1)) end++;
      const words = ts.slice(i + 1, end + 1).map((w) => w.text);
      o.spills.push({ at: o.words.length, words, meant: `${t.key}="${[t.text, ...words].join(' ')}"` });
    }
    if (t.key !== undefined) o.kv[t.key] = t.text;
    else if (t.quoted) o.quoted.push(t.text);
    else if (flagNames.includes(t.text)) o.flags.push(t.text);
    else o.words.push(t.text);
  }
  return o;
}

/**
 * Inline CSV: rows separated by `;`, fields by `,`. A field wrapped in double
 * quotes may contain `,` and `;`; `""` inside it is a literal quote.
 * Returns each row's fields, the offset where each row starts, and where a quote is left open or has text after it.
 */
export function parseInlineCsv(s: string): { rows: string[][]; offsets: number[]; unclosedAt: number | null; afterQuoteAt: number | null } {
  const rows: string[][] = [];
  const offsets: number[] = [];
  let row: string[] = [];
  let field = '';
  let rowStart = 0;
  let i = 0;
  let unclosedAt: number | null = null;
  let afterQuoteAt: number | null = null;
  const pushRow = () => {
    row.push(field.trim());
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
      offsets.push(rowStart);
    }
    row = [];
    field = '';
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '"' && field.trim() === '') {
      const q = readQuoted(s, i);
      if (!q.closed) unclosedAt = i;
      i = q.end;
      // skip to the next separator
      while (i < s.length && s[i] !== ',' && s[i] !== ';') i++;
      // keep the quoted value verbatim (no trim of inner spaces); text between the closing quote and the separator
      // (`"Smith, J" (PM)`) is part of the cell, as CSV readers take it, not dropped. `afterQuoteAt` is where the first such text
      // starts, so the caller can say so: it may be an option the writer meant for the line (`"Planned" bar=done`).
      const tail = s.slice(q.end, i).trimEnd();
      if (tail.trim() !== '') afterQuoteAt ??= q.end + (tail.length - tail.trimStart().length);
      row.push(q.value + tail);
      field = '';
      if (s[i] === ',') {
        i++;
        continue;
      } // a trailing empty field is added when the row ends
      if (s[i] === ';' || i >= s.length) {
        if (row.length > 0) {
          rows.push(row);
          offsets.push(rowStart);
        }
        row = [];
        i++;
        rowStart = i;
        continue;
      }
      continue;
    }
    // A **bold** span with its closing marker before the row ends is atomic: a comma inside it does not split.
    if (c === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      const stop = s.indexOf(';', i + 2);
      if (end > 0 && (stop < 0 || end < stop) && end > i + 2) {
        field += s.slice(i, end + 2);
        i = end + 2;
        continue;
      }
    }
    if (c === ',') {
      row.push(field.trim());
      field = '';
      i++;
      continue;
    }
    if (c === ';') {
      pushRow();
      i++;
      rowStart = i;
      continue;
    }
    field += c;
    i++;
  }
  if (field.trim() !== '' || row.length > 0) pushRow();
  return { rows, offsets, unclosedAt, afterQuoteAt };
}

/**
 * A CSV file, read as RFC 4180 has it: a record ends at a line break and a field at `,`. A field wrapped in double quotes may
 * hold `,`, `;` and line breaks, and `""` inside it is a literal quote; `;` and `\` are ordinary characters. Fields are trimmed
 * outside their quotes (which takes the `\r` of a CRLF file with it); blank lines and a leading byte-order mark are dropped. `unclosedLine` is the line of a quote that never closes.
 */
export function parseCsvFile(text: string): { rows: string[][]; unclosedLine: number | null } {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let unclosedLine: number | null = null;
  let line = 1;
  let i = 0;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    let value = '';
    const quoted = s[i] === '"';
    if (quoted) {
      const opened = line;
      let closed = false;
      for (i++; i < s.length && !closed; i++) {
        if (s[i] !== '"') {
          if (s[i] === '\n') line++;
          value += s[i];
        } else if (s[i + 1] === '"') value += s[i++];
        else closed = true;
      }
      if (!closed) unclosedLine ??= opened;
    }
    // The rest of the field: all of an unquoted one, or what follows a closing quote, which stays in the cell.
    let end = i;
    while (end < s.length && s[end] !== ',' && s[end] !== '\n') end++;
    const tail = s.slice(i, end);
    row.push(quoted ? value + tail.trimEnd() : tail.trim());
    i = end + 1;
    if (s[end] === ',') {
      if (i >= s.length) row.push('');
      continue;
    }
    // A blank line is one empty unquoted field.
    if (quoted || row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    line++;
  }
  if (row.length > 0) rows.push(row);
  return { rows, unclosedLine };
}

/**
 * Index of the first `|` that is not inside a double-quoted field, or -1. A quote opens only at the start of a field, as in
 * `parseInlineCsv`, so `12" pipe | Which?` still finds its `|`.
 */
export function pipeOutsideQuotes(s: string): number {
  let i = 0;
  let start = true;
  while (i < s.length) {
    if (start) {
      while (i < s.length && /\s/.test(s[i])) i++;
      start = false;
      if (s[i] === '"') {
        i = readQuoted(s, i).end;
        continue;
      }
    }
    if (s[i] === '|') return i;
    if (s[i] === ',' || s[i] === ';') start = true;
    i++;
  }
  return -1;
}

/**
 * The fields of a pipe row (spec §4.11, D80): the text split at every `|` that has whitespace, or an end of the text, on each side,
 * each field trimmed. A `|` that touches other text (`a|b`) is part of its field, and nothing else is special: `,` `;` and `"` are
 * ordinary characters. Two pipes with only blanks between them hold an empty field. One field back means the text has no separator.
 */
export function splitPipes(s: string): string[] {
  const fields: string[] = [];
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '|' || !(i === 0 || /\s/.test(s[i - 1])) || !(i === s.length - 1 || /\s/.test(s[i + 1]))) continue;
    fields.push(s.slice(from, i).trim());
    from = i + 1;
  }
  fields.push(s.slice(from).trim());
  return fields;
}

/** A date written `YYYY-MM-DD`: a `date` option's value, and what a `<time>` may carry as its `datetime`. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a number the way charts read data cells: tolerates `,` `$` `%` and units. */
export function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v
    .trim()
    .replace(/[,$€£%]/g, '')
    .replace(/\s*(ms|s|gb|mb|tb|x|×|pts?)$/i, '');
  if (t === '' || !/^[-+−]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t.replace('−', '-'));
  return Number.isFinite(n) ? n : null;
}

/** A table cell without the markup of a cell set whole in bold or italic (`**5,870**`, a total); other cells as they are, trimmed. */
export function bareCell(v: string | undefined): string {
  return (v ?? '').trim().replace(/^(\*{1,2})([^*]+)\1$/, '$2');
}

/** `num` as tables read a cell: a number set whole in bold or italic is still a number (D79). */
export function cellNum(v: string | undefined): number | null {
  return num(bareCell(v));
}
