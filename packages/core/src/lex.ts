// Small tokenizers shared by the block parsers: option lists and inline CSV.

export interface Opts {
  kv: Record<string, string>;
  flags: string[];
  words: string[]; // bare words that are not flags the caller knows about
  quoted: string[]; // standalone "quoted strings", in order
  errors: { message: string; offset: number }[];
}

/**
 * Tokenize `key=value key="quoted value" flag "standalone quote" word`.
 * Every token's start offset (within `s`) is kept for diagnostics.
 */
export function tokens(s: string): { text: string; offset: number; quoted: boolean; key?: string | undefined }[] {
  const out: { text: string; offset: number; quoted: boolean; key?: string | undefined }[] = [];
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
      const { value, end } = readQuoted(s, i);
      out.push({ text: value, offset: start, quoted: true, key });
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
  const o: Opts = { kv: {}, flags: [], words: [], quoted: [], errors: [] };
  const ts = tokens(s);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.key !== undefined && spanKeys.includes(t.key) && !t.quoted) {
      let v = t.text;
      while (i + 1 < ts.length && ts[i + 1].key === undefined && !ts[i + 1].quoted && !flagNames.includes(ts[i + 1].text)) {
        v += ` ${ts[++i].text}`;
      }
      o.kv[t.key] = v;
      continue;
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
 * Returns each row's fields and the offset where each row starts.
 */
export function parseInlineCsv(s: string): { rows: string[][]; offsets: number[]; unclosedAt: number | null } {
  const rows: string[][] = [];
  const offsets: number[] = [];
  let row: string[] = [];
  let field = '';
  let rowStart = 0;
  let i = 0;
  let unclosedAt: number | null = null;
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
      field = q.value;
      i = q.end;
      // skip to the next separator
      while (i < s.length && s[i] !== ',' && s[i] !== ';') i++;
      // keep the quoted value verbatim (no trim of inner spaces)
      row.push(field);
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
  return { rows, offsets, unclosedAt };
}

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
