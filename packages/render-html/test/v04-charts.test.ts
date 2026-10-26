// Vocabulary v0.4 charts (stream v04-1): chart range, labels=end / labels=all, hatch, semantic series colours.
// The parser does not emit the v0.4 chart fields yet, so these tests build ChartBlock literals over data sets that
// the parser reads, and call render(). The last tests open the same pages in Chromium (skipped without one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, type ChartBlock, type LedeDocument, type Block } from '@lede-lang/core';
import { render } from '../src/index.ts';
import { isoDay, fmtDay, semanticClass } from '../src/chart.ts';
import { resolveChrome } from '../../../bench/src/shot.ts';

const DATA = [
  'data plan = phase,start,end,now; Discovery,2026-01-05,2026-02-13,2026-02-01; Build,2026-02-09,2026-04-24,2026-03-10; Beta,2026-04-20,2026-05-29,; Launch,2026-06-01,2026-06-05,; Broken,soon,2026-07-01,',
  'data lat = service,p50,p99,now; Checkout,120,480,300; Search,40,210,95; Auth,15,90,; Payments,200,950,610; Bad,x,10,',
  'data wk = week,actual,plan; W1,10,12; W2,14,13; W3,9,15; W4,18,16; W5,21,17',
  'data st = month,good,neutral,bad; Jan,40,20,5; Feb,44,18,7; Mar,51,15,4',
  'data mix = month,good,revenue; Jan,4,20; Feb,5,22; Mar,6,25',
  'data one = team,score; Alpha,10; Beta,14; Gamma,9',
  'data junk = name,a,b; One,x,y; Two,,',
  'data sprint = task,start,end; Design,2026-03-02,2026-03-06; Build,2026-03-05,2026-03-16; Test,2026-03-13,2026-03-20',
  'data eras = programme,start,end; Legacy,2024-06-01,2026-01-31; Migration,2025-03-01,2027-06-30; New platform,2026-09-01,2028-02-01',
].join('\n');

const base = parse(DATA);

function chart(p: Partial<ChartBlock> & Pick<ChartBlock, 'kind' | 'data'>): ChartBlock {
  return {
    type: 'chart',
    x: '',
    y: [],
    title: null,
    stack: false,
    labels: false,
    unit: null,
    min: null,
    max: null,
    focus: null,
    target: null,
    line: 1,
    ...p,
  };
}
function doc(blocks: Block[], title = 'v0.4 charts'): LedeDocument {
  return { meta: { title }, blocks, data: base.data, diagnostics: [] };
}
const frag = (...cs: ChartBlock[]) => render(doc(cs), { fragment: true });
const svgs = (html: string) => (html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) as string[];
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const vals = (s: string) => [...s.matchAll(/<text class="val[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);

const range = (p: Partial<ChartBlock> = {}) => chart({ kind: 'range', data: 'plan', from: 'start', to: 'end', ...p });

test('ISO dates read as UTC epoch days and format without a time zone', () => {
  assert.equal(isoDay('1970-01-02'), 1);
  assert.equal(isoDay('2026-02-30'), null);
  assert.equal(isoDay('03/01/2026'), null);
  assert.equal(fmtDay(isoDay('2026-03-01')!), 'Mar 1');
  assert.equal(fmtDay(isoDay('2026-12-31')!, true), 'Dec 31, 2026');
});

test('range: one bar per drawable row in both drawings; a row with a bad value is skipped but kept in the data table', async () => {
  const html = await frag(range({ title: 'Release plan' }));
  const [wide, narrow] = svgs(html);
  assert.equal(svgs(html).length, 2);
  for (const s of [wide, narrow]) {
    assert.equal(count(s, /class="rg-bar c1"/g), 4);
    assert.match(s, /role="img"/);
    assert.match(s, /<title id="[^"]+">Release plan<\/title>/);
    assert.match(s, /<desc id="[^"]+">Range chart, 4 rows on a date axis\. Discovery: Jan 5, 2026 to Feb 13, 2026; /);
    assert.doesNotMatch(s, /Broken/);
  }
  assert.match(wide, /viewBox="0 0 640 /);
  assert.match(narrow, /viewBox="0 0 360 /);
  assert.match(html, /<th scope="row">Broken<\/th>/);
  assert.match(html, /<figcaption>Release plan<\/figcaption>/);
  assert.doesNotMatch(html, /<script|https?:\/\/(?!www\.w3\.org)/i);
});

test('range on dates: calendar ticks read like "Mar 1" or "Mar 2026", never raw day numbers', async () => {
  const [wide, narrow] = svgs(await frag(range()));
  for (const s of [wide, narrow]) {
    const ticks = [...s.matchAll(/class="tick"[^>]*>([^<]*)</g)].map((m) => m[1]);
    assert.ok(ticks.length >= 2, String(ticks));
    assert.ok(narrow !== s || ticks.length <= 4);
    for (const t of ticks) assert.match(t, /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( \d{1,2}| \d{4})?$/);
  }
});

test('range on dates: short spans tick by day or week (weeks on Mondays), long spans by year', async () => {
  const tickText = (s: string) => [...s.matchAll(/class="tick"[^>]*>([^<]*)</g)].map((m) => m[1]);
  for (const s of svgs(await frag(chart({ kind: 'range', data: 'sprint', from: 'start', to: 'end' })))) {
    const ticks = tickText(s);
    assert.ok(ticks.length >= 2, String(ticks));
    for (const t of ticks) assert.match(t, /^Mar \d{1,2}$/);
    const days = ticks.map((t) => +t.slice(4));
    const steps = days.slice(1).map((d, k) => d - days[k]);
    // A weekly step lands on Mondays: March 2, 9, 16 2026 were Mondays.
    if (steps.every((st) => st === 7)) for (const d of days) assert.equal(new Date(Date.UTC(2026, 2, d)).getUTCDay(), 1);
  }
  for (const s of svgs(await frag(chart({ kind: 'range', data: 'eras', from: 'start', to: 'end' })))) {
    const ticks = tickText(s);
    assert.ok(ticks.length >= 2, String(ticks));
    for (const t of ticks) assert.match(t, /^20\d\d$/);
  }
});

test('range on numbers: nice ticks with the unit, a marker dot per row with an at value, and a legend for it', async () => {
  const html = await frag(chart({ kind: 'range', data: 'lat', from: 'p50', to: 'p99', at: 'now', unit: 'ms' }));
  const [wide] = svgs(html);
  const ticks = [...wide.matchAll(/class="tick"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(ticks, ['0 ms', '200 ms', '400 ms', '600 ms', '800 ms', '1,000 ms']);
  assert.equal(count(wide, /class="rg-bar /g), 4);
  assert.equal(count(wide, /<circle class="rg-at"/g), 3);
  assert.match(
    html,
    /<div class="legend" aria-hidden="true"><span><i class="c1"><\/i>p50 – p99<\/span><span><i class="rg-at-k"><\/i>now<\/span><\/div>/,
  );
  assert.match(wide, /Checkout: 120 ms to 480 ms, now 300 ms/);
});

test('range: target is a dashed reference line with its label; a date target arrives as epoch days', async () => {
  const day = isoDay('2026-05-15')!;
  const [wide, narrow] = svgs(await frag(range({ target: { value: day, label: 'Board review' } })));
  for (const s of [wide, narrow]) {
    assert.equal(count(s, /<line class="target"/g), 1);
    assert.match(s, /<text class="target-l"[^>]*>Board review<\/text>/);
    assert.match(s, /Target Board review at May 15, 2026\./);
  }
  // The v0.3 parser splits target="2026-05-15 Board review" into 2026 and "-05-15 Board review": it is put back together.
  const [split] = svgs(await frag(range({ target: { value: 2026, label: '-05-15 Board review' } })));
  assert.match(split, /Target Board review at May 15, 2026\./);
  const x = (s: string) => Number(/<line class="target" x1="([\d.]+)"/.exec(s)![1]);
  assert.equal(x(split), x(wide));
});

test('range: bands draw at most four labelled threshold lines across every row', async () => {
  const [wide] = svgs(
    await frag(chart({ kind: 'range', data: 'lat', from: 'p50', to: 'p99', bands: ['100', '250', '500', '800', '900'], unit: 'ms' })),
  );
  assert.equal(count(wide, /<line class="rg-band"/g), 4);
  assert.deepEqual(
    [...wide.matchAll(/class="rg-band-l"[^>]*>([^<]*)</g)].map((m) => m[1]),
    ['100 ms', '250 ms', '500 ms', '800 ms'],
  );
  assert.match(wide, /Thresholds at 100 ms, 250 ms, 500 ms, 800 ms\./);
  const [dates] = svgs(await frag(range({ bands: ['2026-03-01', 'nope'] })));
  assert.equal(count(dates, /<line class="rg-band"/g), 1);
  assert.match(dates, /class="rg-band-l"[^>]*>Mar 1</);
});

test('range on a phone: labels sit above their bars and nothing leaves the 360 drawing', async () => {
  const [, narrow] = svgs(
    await frag(range({ target: { value: isoDay('2026-06-03')!, label: 'Ship date for the whole programme' }, bands: ['2026-02-01'] })),
  );
  const cats = [...narrow.matchAll(/<text class="cat" x="([\d.]+)" y="([\d.]+)">/g)].map((m) => [+m[1], +m[2]]);
  const bars = [...narrow.matchAll(/class="rg-bar c1" fill="currentColor" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map((m) => [
    +m[1],
    +m[2],
    +m[3],
  ]);
  assert.equal(cats.length, 4);
  cats.forEach(([, y], k) => assert.ok(y < bars[k][1], 'label above bar'));
  for (const [x, , w] of bars) assert.ok(x >= 0 && x + w <= 360);
  assert.doesNotMatch(narrow, /font-size/);
});

test('range falls back to the data table when nothing can be drawn', async () => {
  for (const c of [
    chart({ kind: 'range', data: 'junk', from: 'a', to: 'b' }),
    chart({ kind: 'range', data: 'lat', from: 'p50', to: 'nope' }),
  ]) {
    const html = await frag(c);
    assert.equal(svgs(html).length, 0);
    assert.match(
      html,
      /class="viz chart-fig rg-fallback"><div class="scroll" tabindex="0" role="region" aria-label="Chart data"><table><tr><th scope="col">/,
    );
  }
});

test('range in a grid cell is drawn at the cell width', async () => {
  const html = await render(doc([{ type: 'grid', columns: 2, count: 2, line: 1, children: [range(), range()] }]), { fragment: true });
  assert.equal(count(html, /class="chart-wide chart-cell"/g), 2);
  assert.match(html, /viewBox="0 0 470 /);
});

// Byte-for-byte equality with the v0.3 renderer was checked over every examples/ and conformance/ page while this
// stream was built; these pin the v0.3 behaviour of bare `labels` that labels=end / labels=all must not disturb.
test('bare labels keep the v0.3 behaviour', async () => {
  const blocks = parse(
    `${DATA}\nchart bar wk y=actual,plan labels\nchart line wk y=actual,plan labels\nchart area wk stack labels`,
  ).blocks.filter((b) => b.type === 'chart');
  assert.equal(blocks.length, 3);
  assert.ok(blocks.every((b) => b.labelMode === undefined));
  const [bar, line, area] = await Promise.all(blocks.map((b) => frag(b)));
  assert.equal(vals(svgs(bar)[0]).length, 10);
  assert.match(svgs(line)[0], /<text class="end"[^>]*>actual 21<\/text>/);
  assert.deepEqual(vals(svgs(line)[1]).toSorted(), ['17', '21']);
  assert.deepEqual(vals(svgs(area)[0]), ['38']);
  assert.doesNotMatch(bar + line + area, /seg-v/);
});

test('labels=end: bars label only the last bar; lines only the last point of each series', async () => {
  const [bw, bn] = svgs(await frag(chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual'], labels: true, labelMode: 'end' })));
  for (const s of [bw, bn]) assert.deepEqual(vals(s), ['21']);
  const [sw] = svgs(
    await frag(chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual', 'plan'], stack: true, labels: true, labelMode: 'end' })),
  );
  assert.deepEqual(vals(sw), ['38']);
  const [, ln] = svgs(await frag(chart({ kind: 'line', data: 'wk', x: 'week', y: ['actual', 'plan'], labels: true, labelMode: 'end' })));
  assert.deepEqual(vals(ln).toSorted(), ['17', '21']);
  const [hb] = svgs(await frag(chart({ kind: 'hbar', data: 'one', x: 'team', y: ['score'], labels: true, labelMode: 'end' })));
  assert.deepEqual(vals(hb), ['9']);
});

test('labels=all: every value is labelled, including each stack segment and every line point', async () => {
  const [lw, ln] = svgs(await frag(chart({ kind: 'line', data: 'wk', x: 'week', y: ['actual', 'plan'], labels: true, labelMode: 'all' })));
  for (const s of [lw, ln]) assert.equal(vals(s).length, 10);
  const [sw] = svgs(
    await frag(chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual', 'plan'], stack: true, labels: true, labelMode: 'all' })),
  );
  assert.equal(count(sw, /class="val seg-v"/g), 10);
  assert.equal(count(sw, /class="val"/g), 5);
  // Many bars on a phone are still all labelled (never auto-hidden).
  const [, bn] = svgs(await frag(chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual', 'plan'], labels: true, labelMode: 'all' })));
  assert.equal(vals(bn).length, 10);
});

test('hatch: the named bars get a striped overlay from one pattern per drawing, with unique ids', async () => {
  const html = await frag(
    chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual', 'plan'], hatch: ['W5'] }),
    chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual'], stack: true, hatch: ['W4', 'W5', 'W9'] }),
  );
  const all = svgs(html);
  assert.equal(all.length, 4);
  const ids = all.map((s) => /<pattern id="([^"]+)"/.exec(s)![1]);
  assert.equal(new Set(ids).size, 4);
  for (const [k, s] of all.entries()) {
    assert.equal(count(s, /<pattern /g), 1);
    assert.equal(count(s, /<path class="hatch"/g), 2); // W5 in two series; W4 and W5 (W9 is not an x value)
    assert.ok(s.includes(`fill="url(#${ids[k]})"`));
    assert.match(s, /: 21 \(estimate\)<\/title>/);
    assert.match(s, /Striped \(estimate\): W/);
  }
  // A legend already exists for two series, so it gains an estimate key; the single-series chart gets no legend.
  assert.equal(count(html, /<i class="hatch-k"><\/i>estimate/g), 1);
});

test('hatch on an hbar draws the axis chart (not the plain list) and ignores lines', async () => {
  const [hb] = svgs(await frag(chart({ kind: 'hbar', data: 'one', x: 'team', y: ['score'], hatch: ['Beta'] })));
  assert.ok(hb);
  assert.equal(count(hb, /<path class="hatch"/g), 1);
  const line = await frag(chart({ kind: 'line', data: 'wk', x: 'week', y: ['actual'], hatch: ['W5'] }));
  assert.doesNotMatch(line, /hatch|<pattern/);
});

test('semantic series colours: status-word series use the status tokens; mixed names keep the palette', async () => {
  assert.equal(semanticClass(' On-Track '), 's-good');
  assert.equal(semanticClass('At risk'), 's-warn');
  assert.equal(semanticClass('Unfavorable'), 's-bad');
  assert.equal(semanticClass('Not started'), 's-none');
  assert.equal(semanticClass('revenue'), null);
  const html = await frag(chart({ kind: 'bar', data: 'st', x: 'month', y: ['good', 'neutral', 'bad'], stack: true }));
  assert.equal(semanticClass('neutral'), 's-warn');
  assert.match(html, /<i class="s-good"><\/i>good<\/span><span><i class="s-warn"><\/i>neutral<\/span><span><i class="s-bad"><\/i>bad/);
  assert.equal(count(svgs(html)[0], /<path class="s-bad"/g), 3);
  assert.doesNotMatch(html, /class="c\d"/);
  const mixed = await frag(chart({ kind: 'line', data: 'mix', x: 'month', y: ['good', 'revenue'] }));
  assert.match(mixed, /<i class="c1"><\/i>good<\/span><span><i class="c2"><\/i>revenue/);
  // focus on a category keeps the semantic colour on the focused bars.
  const focus = svgs(await frag(chart({ kind: 'bar', data: 'st', x: 'month', y: ['good', 'bad'], focus: 'Feb' })))[0];
  assert.match(focus, /<path class="s-good"[^>]*><title>Feb · good/);
  assert.match(focus, /<path class="cm"[^>]*><title>Jan · good/);
});

test('charts with no v0.4 fields carry none of the v0.4 classes', async () => {
  const html = await frag(
    chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual', 'plan'], labels: true }),
    chart({ kind: 'line', data: 'wk', x: 'week', y: ['actual'] }),
  );
  assert.doesNotMatch(html, /hatch|<pattern|seg-v|rg-|s-good|s-bad/);
});

// ---- Browser battery for the v0.4 charts (a copy of the subset of bench/src/layout-check.ts MEASURE that applies). ----

const chrome = resolveChrome();
const skip = chrome ? false : 'no Chromium found: set CHROME to run the v0.4 chart layout battery';

const FIXTURES: [string, Block[]][] = [
  [
    'range-short-long',
    [
      chart({ kind: 'range', data: 'sprint', from: 'start', to: 'end', target: { value: isoDay('2026-03-18')!, label: 'Code freeze' } }),
      chart({ kind: 'range', data: 'eras', from: 'start', to: 'end', bands: ['2025-01-01', '2026-01-01', '2027-01-01'] }),
    ],
  ],
  [
    'range-grid-fallback',
    [
      {
        type: 'grid',
        columns: 2,
        count: 2,
        line: 1,
        children: [range({ at: 'now' }), chart({ kind: 'range', data: 'lat', from: 'p50', to: 'p99', unit: 'ms' })],
      },
      chart({ kind: 'range', data: 'junk', from: 'a', to: 'b', title: 'Nothing drawable' }),
    ],
  ],
  [
    'range-dates',
    [
      range({
        title: 'Release plan',
        at: 'now',
        target: { value: isoDay('2026-05-15')!, label: 'Board review' },
        bands: ['2026-03-01', '2026-04-01'],
      }),
    ],
  ],
  [
    'range-numbers',
    [
      chart({
        kind: 'range',
        data: 'lat',
        from: 'p50',
        to: 'p99',
        at: 'now',
        unit: 'ms',
        target: { value: 500, label: 'SLO budget' },
        bands: ['100', '250', '800'],
        focus: 'Payments',
      }),
    ],
  ],
  [
    'labels-modes',
    [
      chart({ kind: 'line', data: 'wk', x: 'week', y: ['actual', 'plan'], labels: true, labelMode: 'all', title: 'All points' }),
      chart({ kind: 'area', data: 'wk', x: 'week', y: ['actual', 'plan'], stack: true, labels: true, labelMode: 'end' }),
      chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual', 'plan'], stack: true, labels: true, labelMode: 'all' }),
      chart({ kind: 'bar', data: 'wk', x: 'week', y: ['actual'], labels: true, labelMode: 'end', target: { value: 15, label: 'plan' } }),
      chart({ kind: 'hbar', data: 'one', x: 'team', y: ['score'], labels: true, labelMode: 'all', hatch: ['Gamma'] }),
    ],
  ],
  [
    'hatch-semantic',
    [
      chart({ kind: 'bar', data: 'st', x: 'month', y: ['good', 'neutral', 'bad'], stack: true, hatch: ['Mar'], labels: true }),
      chart({ kind: 'hbar', data: 'wk', x: 'week', y: ['actual', 'plan'], hatch: ['W5'] }),
      chart({ kind: 'line', data: 'st', x: 'month', y: ['good', 'bad'], labels: true, labelMode: 'end' }),
    ],
  ],
];

const MEASURE = `(() => {
  const out = [];
  const phone = innerWidth <= 500;
  const sw = document.scrollingElement.scrollWidth;
  if (sw > innerWidth) out.push('page scrolls sideways: ' + sw);
  for (const s of document.querySelectorAll('.scroll')) {
    if (s.closest('details')) continue;
    if (s.scrollWidth > s.clientWidth + 1) out.push('.scroll scrolls sideways (' + s.scrollWidth + ' > ' + s.clientWidth + ')');
  }
  for (const top of document.querySelector('main').children) {
    const tr = top.getBoundingClientRect();
    if (!tr.width) continue;
    for (const el of top.querySelectorAll('figure, svg, table')) {
      if (el.closest('details:not([open])')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && (r.right > tr.right + 1 || r.left < tr.left - 1)) out.push(el.tagName + ' extends past its block');
    }
  }
  for (const svg of document.querySelectorAll('svg.chart')) {
    const sr = svg.getBoundingClientRect();
    if (!sr.width) continue;
    const scale = sr.width / svg.viewBox.baseVal.width;
    const fig = svg.closest('figure').getBoundingClientRect();
    const texts = [...svg.querySelectorAll('text')];
    for (const t of texts) {
      const size = parseFloat(getComputedStyle(t).fontSize) * scale;
      if (size < (phone ? 11 : 12) - 0.05) out.push('text "' + t.textContent + '" is ' + size.toFixed(1) + 'px');
      const r = t.getBoundingClientRect();
      if (r.width && (r.left < fig.left - 1 || r.right > fig.right + 1)) out.push('text "' + t.textContent + '" is clipped by its figure');
    }
    const ticks = texts.filter(t => t.classList.contains('tick')).map(t => t.getBoundingClientRect());
    for (let i = 0; i < ticks.length; i++) for (let j = i + 1; j < ticks.length; j++) {
      const a = ticks[i], b = ticks[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push('tick labels overlap');
    }
    const anns = texts.filter(t => t.classList.contains('rg-band-l') || (svg.classList.contains('rg') && t.classList.contains('target-l'))).map(t => t.getBoundingClientRect());
    for (let i = 0; i < anns.length; i++) for (let j = i + 1; j < anns.length; j++) {
      const a = anns[i], b = anns[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push('range annotation labels overlap');
    }
  }
  return out;
})()`;

let pages: Promise<string[]> | undefined;
async function battery(): Promise<string[]> {
  const req = createRequire(new URL('../../../bench/package.json', import.meta.url));
  // playwright-core lives in bench/; it is loaded by path, so it is typed loosely here.
  type Page = {
    goto(u: string, o: object): Promise<unknown>;
    evaluate(s: string): Promise<unknown>;
    addScriptTag(o: { path: string }): Promise<unknown>;
  };
  type Browser = { newContext(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>; close(): Promise<void> };
  type Chromium = { launch(o: { executablePath: string }): Promise<Browser> };
  const pw = (await import(req.resolve('playwright-core'))) as { chromium?: Chromium; default?: { chromium: Chromium } };
  const chromium = pw.chromium ?? pw.default!.chromium;
  const axe = req.resolve('axe-core/axe.min.js');
  const dir = mkdtempSync(join(tmpdir(), 'lede-v04-'));
  const browser = await chromium.launch({ executablePath: chrome! });
  const found: string[] = [];
  try {
    for (const [name, cs] of FIXTURES) {
      const file = join(dir, `${name}.html`);
      writeFileSync(file, await render(doc(cs, name)));
      for (const [width, scheme] of [
        [1280, 'light'],
        [400, 'dark'],
        [1280, 'dark'],
        [400, 'light'],
      ] as const) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
        const page = await ctx.newPage();
        await page.goto(`file://${file}`, { waitUntil: 'load' });
        for (const msg of (await page.evaluate(MEASURE)) as string[]) found.push(`${name} @${width} ${scheme}: ${msg}`);
        await page.addScriptTag({ path: axe });
        const bad = (await page.evaluate(
          `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.reduce((a, v) => a + v.nodes.length, 0))`,
        )) as number;
        if (bad) found.push(`${name} @${width} ${scheme}: ${bad} contrast violations`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  return found;
}

test(
  'v0.4 charts in the browser: no sideways scroll, text >= 12px desktop / 11px phone, nothing clipped, no tick or annotation overlap, zero contrast failures',
  { skip, timeout: 300_000 },
  async () => {
    assert.deepEqual(await (pages ??= battery()), []);
  },
);
