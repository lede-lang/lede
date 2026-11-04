// The export of a page's answers (spec §4.18, §4.19): the shape an agent reads back. This is the reference serializer. It draws the
// fill-in template of an ordinary page (the export of the page as written) and is the oracle the shell runtime is tested against.
import {
  NOT_CHOSEN,
  SLOT_RE,
  type BucketBlock,
  type ExportFormat,
  type ParamBlock,
  type QuestionBlock,
  type TemplateBlock,
} from '@lede-lang/core';

/** `ask`: the text; `choose`: the option or null; `confirm`: approved, rejected or open. */
export type Answer = string | null;

/**
 * One value per field, parallel to `fieldsOf`: an `Answer` for the question words, and for the editor words `param` the number, `toggle`
 * `on` or `off`, `bucket` the bucket each item is in (in the set's item order) and `template` none (it is derived from the other values,
 * so whatever is given there is ignored).
 */
export type Value = Answer | number | string[];

/** The Markdown placeholders (NOT_CHOSEN is core's, since the parser refuses an option spelled like it); an `ask` value spelled like one is fenced. */
const EMPTY = '(empty)';
/** An empty bucket's line, and the spelling of a lone item text that would otherwise read as empty. */
const NONE = '(none)';

/** The page as written (spec §3.2): a blank `ask`, `choose` and `confirm`, and every other field at the value its line proposes. */
export const blankAnswers = (fields: QuestionBlock[]): Value[] => settle(fields, []);

/** Line breaks become `\n` and the ends are trimmed, as the export promises. */
export const cleanText = (v: string): string => v.replace(/\r\n?/g, '\n').trim();

/** A `param` as text: its number (or the text of one, as a `preset` holds it), then a space and its unit when it has one. */
export const paramText = (f: ParamBlock, v: number | string): string => (f.unit ? `${v} ${f.unit}` : `${v}`);

/**
 * `{name}` in the body becomes the slot field's value as text, once, in a single pass over the body (a value holding `{other}` is not
 * expanded); an `ask` left empty and a `choose` left unpicked leave `{name}` as written, as does any brace sequence that is not a slot.
 */
function fillTemplate(b: TemplateBlock, fields: QuestionBlock[], settled: Value[]): string {
  const text = new Map<string, string>();
  fields.forEach((f, i) => {
    const v = settled[i];
    if (!b.slots.includes(f.name)) return;
    if ((f.type === 'ask' || f.type === 'choose') && typeof v === 'string' && v !== '') text.set(f.name, v);
    else if (f.type === 'param' && typeof v === 'number') text.set(f.name, paramText(f, v));
    else if (f.type === 'toggle' && typeof v === 'string') text.set(f.name, v);
  });
  return b.body.replace(SLOT_RE, (m, name: string) => text.get(name) ?? m);
}

/**
 * Each value as the export means it. A value of the wrong shape (a `NaN` or empty number box, a bucket outside the set) is the value the
 * page was written with, and a `template` is filled from the others.
 */
export function settle(fields: QuestionBlock[], values: Value[]): Value[] {
  const out: Value[] = fields.map((f, i) => {
    const v = values[i];
    switch (f.type) {
      case 'ask':
        return cleanText(typeof v === 'string' ? v : '');
      case 'choose':
        return typeof v === 'string' ? v : null;
      case 'confirm':
        return typeof v === 'string' ? v : 'open';
      case 'param':
        return typeof v === 'number' && Number.isFinite(v) ? v : f.value;
      case 'toggle':
        return v === 'on' || v === 'off' ? v : f.on ? 'on' : 'off';
      case 'bucket':
        return f.items.map((it, k) => {
          const b = Array.isArray(v) ? v[k] : undefined;
          return typeof b === 'string' && f.buckets.includes(b) ? b : it.bucket;
        });
      default:
        return null;
    }
  });
  fields.forEach((f, i) => {
    if (f.type === 'template') out[i] = fillTemplate(f, fields, out);
  });
  return out;
}

/** Names of the fields still open: an undecided `confirm` and an unpicked `choose`. An empty `ask` is not open. */
function openNames(fields: QuestionBlock[], values: Value[]): string[] {
  return fields
    .filter((f, i) => (f.type === 'confirm' && values[i] === 'open') || (f.type === 'choose' && values[i] === null))
    .map((f) => f.name);
}

/** Toggles that are on while a toggle they need is not: a name that is no toggle on the page is never satisfied. */
function blockedNames(fields: QuestionBlock[], values: Value[]): string[] {
  const on = new Set(fields.filter((f, i) => f.type === 'toggle' && values[i] === 'on').map((f) => f.name));
  return fields.filter((f) => f.type === 'toggle' && on.has(f.name) && (f.needs ?? []).some((n) => !on.has(n))).map((f) => f.name);
}

/** U+0085, U+2028 and U+2029 count as line ends to some Markdown viewers; they become a space in text that is not fenced. */
const flat = (v: string): string => v.replace(/[\n\r\u0085\u2028\u2029]/g, ' ');

/** An item text in a move line: always quoted, so a `:` or `(was` inside it cannot be misread. */
const quoted = (t: string): string => `"${flat(t).replaceAll('"', '""')}"`;
/** An item text as a cell of a bucket line: quoted when it holds `,`, `;` or `"` or reads as the empty marker. */
const cell = (t: string): string => {
  const x = flat(t);
  return /[,;"]/.test(x) || x === NONE ? quoted(x) : x;
};

/** A blank line, then the value in a fenced block indented two spaces, the fence one backtick longer than the longest run in it. */
function fenceBody(v: string): string[] {
  const run = Math.max(0, ...(v.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, run + 1));
  return ['', `  ${fence}`, ...v.split('\n').map((l) => (l === '' ? '' : `  ${l}`)), `  ${fence}`];
}

/** Whether a text can sit after `- name: ` on one line. */
const inlineSafe = (v: string): boolean => v !== EMPTY && v !== NOT_CHOSEN && !/[\n\u0085\u2028\u2029`]/.test(v);

function markdownItem(name: string, v: string): string[] {
  if (v === '') return [`- ${name}: ${EMPTY}`];
  if (inlineSafe(v)) return [`- ${name}: ${v}`];
  return [`- ${name}:`, ...fenceBody(v)];
}

/** One bucket per line under the set's name; an empty bucket is `(none)`. */
function bucketItem(f: BucketBlock, v: string[]): string[] {
  return [
    `- ${f.name}:`,
    ...f.buckets.map((b) => {
      const texts = f.items.filter((_, k) => v[k] === b).map((i) => cell(i.text));
      return `  - ${flat(b)}: ${texts.length ? texts.join(', ') : NONE}`;
    }),
  ];
}

/** The changes the reader made, one line each, in source order (spec §4.19): the lines, and which fields they cover. */
function changes(fields: QuestionBlock[], vals: Value[], was: Value[]): { lines: string[]; changed: Set<string> } {
  const lines: string[] = [];
  const changed = new Set<string>();
  const line = (name: string, ls: string[]) => {
    lines.push(...ls);
    changed.add(name);
  };
  fields.forEach((f, i) => {
    const v = vals[i];
    const w = was[i];
    switch (f.type) {
      case 'ask':
        if (typeof v === 'string' && v !== w)
          line(f.name, inlineSafe(v) ? [`- ${f.name}: ${v} (was empty)`] : [`- ${f.name}: (was empty)`, ...fenceBody(v)]);
        break;
      case 'choose':
        if (typeof v === 'string' && v !== w) line(f.name, [`- ${f.name}: ${flat(v)} (was not chosen)`]);
        break;
      case 'confirm':
      case 'toggle':
        if (v !== w) line(f.name, [`- ${f.name}: ${String(v)} (was ${String(w)})`]);
        break;
      case 'param':
        if (typeof v === 'number' && typeof w === 'number' && v !== w)
          line(f.name, [`- ${f.name}: ${flat(paramText(f, v))} (was ${flat(paramText(f, w))})`]);
        break;
      case 'bucket':
        if (Array.isArray(v) && Array.isArray(w))
          f.items.forEach((it, k) => {
            if (v[k] !== w[k]) line(f.name, [`- ${f.name}: ${quoted(it.text)} moved to ${flat(v[k])} (was ${flat(w[k])})`]);
          });
        break;
      case 'template':
        break;
    }
  });
  return { lines, changed };
}

/**
 * `page` is the document title or undefined. `values` run parallel to `fields` and default to the page as written; `ask` values are
 * cleaned here. `prompt` lists only what differs from the page as written.
 */
export function serializeExport(format: ExportFormat, page: string | undefined, fields: QuestionBlock[], values: Value[] = []): string {
  const vals = settle(fields, values);
  const open = openNames(fields, vals);
  const blocked = blockedNames(fields, vals);
  const hasToggle = fields.some((f) => f.type === 'toggle');
  if (format === 'json') {
    const answers = Object.fromEntries(
      fields.map((f, i) => {
        const v = vals[i];
        if (f.type === 'bucket' && Array.isArray(v))
          return [f.name, Object.fromEntries(f.buckets.map((b) => [b, f.items.filter((_, k) => v[k] === b).map((it) => it.text)]))];
        return [f.name, v];
      }),
    );
    return JSON.stringify({ ...(page ? { page } : {}), open, ...(hasToggle ? { blocked } : {}), answers }, null, 2);
  }
  if (format === 'prompt') {
    const head = `Apply these changes${page ? ` to ${flat(page)}` : ''}:`;
    const { lines, changed } = changes(fields, vals, blankAnswers(fields));
    if (lines.length === 0) return [head, '', 'No changes.'].join('\n');
    const unchanged = fields.map((f) => f.name).filter((n) => !changed.has(n) && !open.includes(n) && !blocked.includes(n));
    const tail = [
      ...(open.length ? [`Open: ${open.join(', ')}`] : []),
      ...(blocked.length ? [`Blocked: ${blocked.join(', ')}`] : []),
      ...(unchanged.length ? [`Unchanged: ${unchanged.join(', ')}`] : []),
    ];
    return [head, '', ...lines, ...(tail.length ? ['', ...tail] : [])].join('\n');
  }
  const items = fields.flatMap((f, i) => {
    const v = vals[i];
    switch (f.type) {
      case 'ask':
        return markdownItem(f.name, String(v));
      case 'choose':
        return [`- ${f.name}: ${v === null ? NOT_CHOSEN : flat(String(v))}`];
      case 'confirm':
      case 'toggle':
        return [`- ${f.name}: ${String(v)}`];
      case 'param':
        return [`- ${f.name}: ${flat(paramText(f, v as number))}`];
      case 'bucket':
        return bucketItem(f, v as string[]);
      default:
        return v === '' ? [`- ${f.name}: ${EMPTY}`] : [`- ${f.name}:`, ...fenceBody(String(v))];
    }
  });
  return [
    ...(page ? [`# ${flat(page)}`, ''] : []),
    `Open: ${open.length ? open.join(', ') : 'none'}`,
    ...(hasToggle ? [`Blocked: ${blocked.length ? blocked.join(', ') : 'none'}`] : []),
    ...(items.length ? ['', ...items] : []),
  ].join('\n');
}
