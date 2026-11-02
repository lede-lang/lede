// The hint line of the refinement test's hint arm (D67; internal spec, lede-lang/meta): which Lede words a page's own AST
// suggests it is missing. Pure: the same page gives the same line.
//   node bench/src/hints.ts page.lede      prints the line, or an empty line when no rule fires
// The hint arm shows a writer this line (instead of the generic feedback line) with its own page; a page with an empty line
// is not revised in that arm. At most three hints, from the five rules below in this order, each firing at most once:
//   1. no kpi block, and the first paragraph or the first list holds three or more numbers with a unit
//   2. two or more consecutive ### sections of short text under one ##, with no `cards` above them
//   3. a list of three or more items that each hold a date, a weekday, a W number or a Day/Week number, and no `step` block
//   4. a table with a start-like and an end-like column of numbers or dates, and no `chart range`
//   5. a table with a column whose cells all end in %, and no `bar=` on that table
// Readings the rules leave open: "the first paragraph or the first list" is each checked on its own; "consecutive" sections
// have no other heading between them and a section is short text when its body is only paragraphs, lists, quotes and
// notes of at most 240 characters in all; "no kpi / step / chart range" means none anywhere on the page; "start-like" and
// "end-like" are header words (start, begin, from; end, finish, to, until) and a table's columns are those it shows (`cols=`).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { num, parse, type Block, type LedeDocument, type TableBlock } from '@lede-lang/core';

/** The sentence every hint line ends with, as D67 words the line. */
export const KEEP = 'Keep every fact, number and name exactly as it is, and keep the same sections.';
const MAX_HINTS = 3;
const SHORT_BODY = 240;

interface Placed {
  block: Block;
  /** The nearest heading above the block (a card's title inside a card), or null. */
  heading: string | null;
}

/** Every block in document order, with its nearest heading; grids and cards are entered. */
function flatten(blocks: Block[], heading: string | null, out: Placed[]): string | null {
  for (const block of blocks) {
    if (block.type === 'heading') heading = block.text;
    out.push({ block, heading });
    if (block.type === 'grid') flatten(block.children, heading, out);
    if (block.type === 'cards') for (const card of block.items) flatten(card.blocks, card.title, out);
  }
  return heading;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A number with a unit: `$` before it, `%` or `ms` after it, a `k` or `M` suffix, or a plain integer of four or more digits.
 * The integer is not part of a date, a range, an id or a decimal.
 */
const UNIT_NUMBER = new RegExp(
  [
    String.raw`\$\s?\d[\d,]*(?:\.\d+)?(?:[kM]\b)?`,
    String.raw`(?<![\w.])\d[\d,]*(?:\.\d+)?\s?%`,
    String.raw`(?<![\w.])\d[\d,]*(?:\.\d+)?\s?ms\b`,
    String.raw`(?<![\w.])\d[\d,]*(?:\.\d+)?[kM]\b`,
    String.raw`(?<![\w.,/:$-])(?:\d{1,3}(?:,\d{3})+|\d{4,})(?![\w/:-]|[.,]\d)`,
  ].join('|'),
  'g',
);
const countUnitNumbers = (text: string) => text.match(UNIT_NUMBER)?.length ?? 0;

const listText = (items: { text: string }[]) => items.map((i) => i.text).join(' ');

function rule1(placed: Placed[]): string | null {
  if (placed.some((p) => p.block.type === 'kpis')) return null;
  const para = placed.find((p) => p.block.type === 'paragraph')?.block;
  const list = placed.find((p) => p.block.type === 'list')?.block;
  const holds =
    (para?.type === 'paragraph' && countUnitNumbers(para.text) >= 3) ||
    (list?.type === 'list' && countUnitNumbers(listText(list.items)) >= 3);
  return holds ? 'a kpi row for the headline numbers' : null;
}

/** The characters of text a card-like section body holds, or null when it holds none or holds anything but text. */
function bodyText(body: Block[]): number | null {
  let length = 0;
  let text = false;
  for (const b of body) {
    if (b.type === 'paragraph' || b.type === 'quote' || b.type === 'note') length += b.text.trim().length;
    else if (b.type === 'list') length += listText(b.items).trim().length;
    else if (b.type === 'data') continue; // a declaration, nothing on the page
    else return null;
    text = true;
  }
  return text ? length : null;
}

function rule2(blocks: Block[]): string | null {
  let h2: string | null = null;
  let cardsInH2 = false;
  let run = 0; // short ### sections in a row, just before this block
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && b.level === 3) {
      // a section: its body runs to the next heading of any level
      let end = i + 1;
      while (end < blocks.length && blocks[end].type !== 'heading') end++;
      const body = blocks.slice(i + 1, end);
      if (body.some((x) => x.type === 'cards')) cardsInH2 = true;
      const length = bodyText(body);
      run = length !== null && length <= SHORT_BODY ? run + 1 : 0;
      if (run >= 2 && h2 !== null && !cardsInH2) return `\`cards\` before the ### sections under "${h2}"`;
      i = end - 1;
    } else if (b.type === 'heading') {
      h2 = b.level === 2 ? b.text : null;
      cardsInH2 = false;
      run = 0;
    } else if (b.type === 'cards') cardsInH2 = true;
  }
  return null;
}

const WEEKDAY_NAME = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const WEEKDAY_ABBR = /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/;
const WHEN = [/\b\d{4}-\d{2}-\d{2}\b/, WEEKDAY_NAME, WEEKDAY_ABBR, /\bW\d{1,2}\b/, /\b(?:Day|Week)\s*\d+\b/i];

function rule3(placed: Placed[]): string | null {
  if (placed.some((p) => p.block.type === 'steps')) return null;
  for (const { block, heading } of placed) {
    if (block.type !== 'list') continue;
    const items = block.items.filter((i) => i.level === undefined);
    if (items.length >= 3 && items.every((i) => WHEN.some((re) => re.test(i.text)))) {
      return `\`step\` lines for the dated actions${heading === null ? '' : ` under "${heading}"`}`;
    }
  }
  return null;
}

/** The columns a table shows, with their cells. */
function shown(doc: LedeDocument, t: TableBlock): { name: string; cells: string[] }[] {
  const data = doc.data[t.data];
  if (!data) return [];
  return (t.cols ?? data.columns).map((name) => {
    const at = data.columns.indexOf(name);
    return { name, cells: data.rows.map((r) => (r[at] ?? '').trim()).filter((c) => c !== '') };
  });
}

const words = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const START = /^(?:(?:start|begin|from)(?:s|ed|ing)?|beginning)$/;
const END = /^(?:(?:end|finish)(?:s|ed|es|ing)?|to|until)$/;
const isNumberOrDate = (cell: string) => num(cell) !== null || ISO_DATE.test(cell);

function rule4(doc: LedeDocument, placed: Placed[]): string | null {
  if (placed.some((p) => p.block.type === 'chart' && p.block.kind === 'range')) return null;
  for (const { block, heading } of placed) {
    if (block.type !== 'table') continue;
    const spans = shown(doc, block).filter((c) => c.cells.length > 0 && c.cells.every(isNumberOrDate));
    const starts = spans.filter((c) => words(c.name).some((w) => START.test(w)));
    const ends = spans.filter((c) => words(c.name).some((w) => END.test(w)));
    if (starts.some((s) => ends.some((e) => e !== s))) {
      const where = block.title ?? heading;
      return `\`chart range\` for the spans${where === null ? '' : ` in "${where}"`}`;
    }
  }
  return null;
}

const endsInPercent = (cell: string) => /%[\s*_]*$/.test(cell);

function rule5(doc: LedeDocument, placed: Placed[]): string | null {
  for (const { block, heading } of placed) {
    if (block.type !== 'table' || (block.bars?.length ?? 0) > 0) continue;
    if (shown(doc, block).some((c) => c.cells.length > 0 && c.cells.every(endsInPercent))) {
      const where = heading ?? block.title;
      return `\`bar=\` on the percent column${where === null ? '' : ` of "${where}"`}`;
    }
  }
  return null;
}

/** Up to three hints for a page, in rule order. Empty when no rule fires. */
export function hintsFor(src: string): string[] {
  const doc = parse(src);
  const placed: Placed[] = [];
  flatten(doc.blocks, null, placed);
  return [rule1(placed), rule2(doc.blocks), rule3(placed), rule4(doc, placed), rule5(doc, placed)]
    .filter((h): h is string => h !== null)
    .slice(0, MAX_HINTS);
}

/** The whole line the writer reads, or an empty string when there is nothing to say. */
export function hintLine(src: string): string {
  const hints = hintsFor(src);
  return hints.length === 0 ? '' : `Consider: ${hints.join('; ')}. ${KEEP}`;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const file = process.argv[2];
  if (file === undefined) throw new Error('usage: node bench/src/hints.ts page.lede');
  console.log(hintLine(readFileSync(file, 'utf8')));
}
