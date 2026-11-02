// Measures the incremental renderer over the v0.4 benchmark pages (internal spec, lede-lang/meta), in Node, with no browser:
//   node bench/src/incremental-report.ts [--chunk 4] [--ms 20] [--json]
// Every page of bench/gen/{haiku,sonnet,opus}-r6/C is streamed through LedeStream into createIncremental with the settle off, and the
// operations are applied to a string model of <main>. A page is "equal" when the model equals the whole-page render before any
// settle; a miss prints its settle causes and the index of the first differing child. Arrival is simulated on a virtual clock
// (--chunk characters every --ms milliseconds; the default is 4 characters every 20 ms, a model at about 50 tokens a second), so
// `holdMs` is the time a block waited in the tail before it was committed.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../../packages/core/src/index.ts';
import { render } from '../../packages/render-html/src/index.ts';
import { drive, normalize } from './incremental-model.ts';

const ROOT = join(import.meta.dirname, '..', '..');
export const TIERS = ['haiku', 'sonnet', 'opus'];

export interface Row {
  page: string;
  equal: boolean;
  /** What the renderer's own report says; it must agree with `equal`. */
  reported: boolean;
  causes: string[];
  firstDiff: number | null;
  settled: number;
  countMismatch: boolean;
  regroups: number;
  repicks: number;
  reseals: number;
  holdMs: number[];
  heldGrouped: number;
  heldPlain: number;
  proseFlips: number;
  shiftAssumed: boolean;
  lateMeta: number;
  placeholderError: number[];
  renders: number;
  units: number;
}

export interface Summary {
  pages: number;
  equal: number;
  rate: number;
  causes: Record<string, number>;
  regroups: number;
  repicks: number;
  reseals: number;
  lateMetaPages: number;
  proseFlipPages: number;
  shiftAssumedPages: number;
  holdP50: number;
  holdP95: number;
  holdMax: number;
  heldBlocks: number;
  heldGrouped: number;
  heldPlain: number;
  placeholderMeanAbs: number;
  placeholderMean: number;
  placeholderN: number;
}

/** The pages the report covers: `bench/gen/<tier>-r6/C/*.lede`, in tier then numeric order. */
export function benchPages(): string[] {
  return TIERS.flatMap((t) => {
    const dir = join('bench', 'gen', `${t}-r6`, 'C');
    return readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith('.lede'))
      .toSorted((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((f) => join(dir, f));
  });
}

const loadFile = () => 'a,b\n1,2';

export async function measure(files: string[], o: { chunk?: number | undefined; ms?: number | undefined } = {}): Promise<Row[]> {
  const rows: Row[] = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    // One page at a time: each streams through its own parser and renderer.
    const d = await drive(src, { chunk: o.chunk ?? 4, msPerChunk: o.ms ?? 20, parse: { loadFile }, settle: false });
    const theirs = normalize(await render(parse(src, { loadFile }), { fragment: true }));
    const same = normalize(d.model.main()) === theirs;
    const e = d.end;
    rows.push({
      page: f.replace(/^bench\/gen\/|\/C\//g, (m) => (m === '/C/' ? '/' : '')).replace(/-r6/, ''),
      equal: same,
      reported: e.equal,
      causes: e.causes,
      firstDiff: e.firstDiff,
      settled: e.settled,
      countMismatch: e.countMismatch,
      regroups: e.regroups,
      repicks: e.repicks,
      reseals: e.reseals,
      holdMs: e.holdMs,
      heldGrouped: e.heldGrouped,
      heldPlain: e.heldPlain,
      proseFlips: e.proseFlips,
      shiftAssumed: e.shiftAssumed,
      lateMeta: e.lateMeta,
      placeholderError: e.placeholderError,
      renders: e.renders,
      units: d.model.units.length,
    });
  }
  return rows;
}

const pct = (xs: number[], q: number) => (xs.length ? xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(rows: Row[]): Summary {
  const causes: Record<string, number> = {};
  for (const r of rows) for (const c of r.causes) causes[c] = (causes[c] ?? 0) + 1;
  const hold = rows.flatMap((r) => r.holdMs);
  const err = rows.flatMap((r) => r.placeholderError);
  const equal = rows.filter((r) => r.equal).length;
  return {
    pages: rows.length,
    equal,
    rate: rows.length ? equal / rows.length : 0,
    causes,
    regroups: rows.reduce((n, r) => n + r.regroups, 0),
    repicks: rows.reduce((n, r) => n + r.repicks, 0),
    reseals: rows.reduce((n, r) => n + r.reseals, 0),
    lateMetaPages: rows.filter((r) => r.lateMeta > 0).length,
    proseFlipPages: rows.filter((r) => r.proseFlips > 0).length,
    shiftAssumedPages: rows.filter((r) => r.shiftAssumed).length,
    holdP50: pct(hold, 0.5),
    holdP95: pct(hold, 0.95),
    holdMax: hold.length ? Math.max(...hold) : 0,
    heldBlocks: hold.length,
    heldGrouped: rows.reduce((n, r) => n + r.heldGrouped, 0),
    heldPlain: rows.reduce((n, r) => n + r.heldPlain, 0),
    placeholderMeanAbs: mean(err.map(Math.abs)),
    placeholderMean: mean(err),
    placeholderN: err.length,
  };
}

/** One line per page, then the summary. */
export function format(rows: Row[]): string {
  return `${table(rows)}\n\n${summaryText(rows)}`;
}

/** One line per page. */
export function table(rows: Row[]): string {
  const head = [
    'page',
    'equal',
    'first',
    'settled',
    'causes',
    'regr',
    'repk',
    'resl',
    'holdMax',
    'prose',
    'shiftA',
    'late',
    'slotErr',
    'renders/units',
  ];
  const lines = rows.map((r) => [
    r.page,
    r.equal ? 'yes' : 'NO',
    r.firstDiff === null ? '-' : String(r.firstDiff),
    String(r.settled),
    r.causes.length ? r.causes.join('+') : '-',
    String(r.regroups),
    String(r.repicks),
    String(r.reseals),
    r.holdMs.length ? Math.max(...r.holdMs).toFixed(0) : '0',
    String(r.proseFlips),
    r.shiftAssumed ? 'yes' : '-',
    String(r.lateMeta),
    r.placeholderError.length ? mean(r.placeholderError.map(Math.abs)).toFixed(0) : '-',
    `${r.renders}/${r.units}`,
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const row = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(w[i]))
      .join('  ')
      .trimEnd();
  return [row(head), ...lines.map(row)].join('\n');
}

/** The numbers the PR states. */
export function summaryText(rows: Row[]): string {
  const s = summarize(rows);
  return [
    `pages ${s.pages}; equal before the settle ${s.equal} (${(s.rate * 100).toFixed(1)}%)`,
    `settle causes over the misses: ${JSON.stringify(s.causes)}`,
    `regroups ${s.regroups}; repicks ${s.repicks}; reseals ${s.reseals}; pages with late meta ${s.lateMetaPages}`,
    `prose latched on ${s.proseFlipPages} pages; shift assumed on ${s.shiftAssumedPages} pages`,
    `holdMs over ${s.heldBlocks} held blocks: p50 ${s.holdP50.toFixed(0)}, p95 ${s.holdP95.toFixed(0)}, max ${s.holdMax.toFixed(0)}`,
    `held blocks committed in a grouped unit ${s.heldGrouped}, as plain blocks ${s.heldPlain}`,
    `placeholder height error (slot minus drawing, px) over ${s.placeholderN} diagrams: mean ${s.placeholderMean.toFixed(0)}, mean absolute ${s.placeholderMeanAbs.toFixed(0)}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? Number(process.argv[i + 1]) : undefined;
  };
  const rows = await measure(benchPages(), { chunk: arg('--chunk'), ms: arg('--ms') });
  console.log(process.argv.includes('--json') ? JSON.stringify({ summary: summarize(rows), rows }, null, 2) : format(rows));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
