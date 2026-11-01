// The export of a page's answers (spec §4.18): the shape an agent reads back. This is the reference serializer. It draws the
// fill-in template of an ordinary page (the export of the blank page) and is the oracle the shell runtime is tested against.
import type { ExportFormat, QuestionBlock } from '@lede-lang/core';

/** `ask`: the text; `choose`: the option or null; `confirm`: approved, rejected or open. */
export type Answer = string | null;

/** The Markdown placeholders; a value spelled like one is fenced so it cannot be mistaken for it. */
const EMPTY = '(empty)';
const NOT_CHOSEN = '(not chosen)';

export function blankAnswers(fields: QuestionBlock[]): Answer[] {
  return fields.map((f) => (f.type === 'ask' ? '' : f.type === 'choose' ? null : 'open'));
}

/** Line breaks become `\n` and the ends are trimmed, as the export promises. */
export const cleanText = (v: string): string => v.replace(/\r\n?/g, '\n').trim();

/** Names of the fields still open: an undecided `confirm` and an unpicked `choose`. An empty `ask` is not open. */
function openNames(fields: QuestionBlock[], values: Answer[]): string[] {
  return fields
    .filter((f, i) => (f.type === 'confirm' && values[i] === 'open') || (f.type === 'choose' && values[i] === null))
    .map((f) => f.name);
}

/** U+0085, U+2028 and U+2029 count as line ends to some Markdown viewers; they become a space in text that is not fenced. */
const flat = (v: string): string => v.replace(/[\n\r\u0085\u2028\u2029]/g, ' ');

function markdownItem(name: string, v: string): string[] {
  if (v !== '' && v !== EMPTY && v !== NOT_CHOSEN && !/[\n\u0085\u2028\u2029`]/.test(v)) return [`- ${name}: ${v}`];
  if (v === '') return [`- ${name}: ${EMPTY}`];
  const run = Math.max(0, ...(v.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, run + 1));
  return [`- ${name}:`, '', `  ${fence}`, ...v.split('\n').map((l) => (l === '' ? '' : `  ${l}`)), `  ${fence}`];
}

/** `page` is the document title or undefined. `values` run parallel to `fields`; `ask` values are cleaned here. */
export function serializeExport(format: ExportFormat, page: string | undefined, fields: QuestionBlock[], values: Answer[]): string {
  const vals = fields.map((f, i) => (f.type === 'ask' ? cleanText(values[i] ?? '') : (values[i] ?? null)));
  const open = openNames(fields, vals);
  if (format === 'json') {
    const answers = Object.fromEntries(fields.map((f, i) => [f.name, vals[i]]));
    return JSON.stringify({ ...(page ? { page } : {}), open, answers }, null, 2);
  }
  const items = fields.flatMap((f, i) => {
    const v = vals[i];
    if (f.type === 'choose') return [`- ${f.name}: ${v === null ? NOT_CHOSEN : flat(v)}`];
    if (f.type === 'confirm') return [`- ${f.name}: ${v}`];
    return markdownItem(f.name, v ?? '');
  });
  return [
    ...(page ? [`# ${flat(page)}`, ''] : []),
    `Open: ${open.length ? open.join(', ') : 'none'}`,
    ...(items.length ? ['', ...items] : []),
  ].join('\n');
}
