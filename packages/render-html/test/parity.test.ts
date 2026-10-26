// Acceptance battery for the renderer-parity spike (the renderer-parity requirements).
// One test per encodable requirement, named `Req N.N …`. Assertions read `compile()` output only
// (class names, SVG geometry, formatted strings), so they hold whatever the internals become.
// Browser-measured requirements (2.1, 2.6, 3.2, 4.1, 5.2, 5.4, 8.3) live in layout.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, type DiagramBlock } from '@lede-lang/core';
import { compile, css, layoutFlow } from '../src/index.ts';
import { textWidth } from '../src/util.ts';

const fixture = (n: string) => readFileSync(new URL(`../../../examples/parity/${n}.lede`, import.meta.url), 'utf8');
const page = async (n: string) => (await compile(fixture(n))).html;
const frag = async (src: string) => (await compile(src, { fragment: true })).html;

// ---- helpers ------------------------------------------------------------------------------------

/** The `<figure>` whose caption is `title`, from its opening tag to the next figure. */
function figureOf(html: string, title: string): string {
  const piece = html.split('<figure ').find((p) => p.includes(`<figcaption>${title}</figcaption>`));
  assert.ok(piece, `no figure titled "${title}"`);
  return `<figure ${piece}`;
}
const svgIn = (html: string, cls: 'chart-wide' | 'chart-narrow') => {
  const m = new RegExp(`<div class="${cls}">(<svg[\\s\\S]*?</svg>)`).exec(html);
  assert.ok(m, `no ${cls} svg`);
  return m[1];
};
const allSvgs = (html: string) => html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
const viewBox = (svg: string) => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  assert.ok(m, 'no viewBox');
  return { w: Number(m[1]), h: Number(m[2]) };
};
interface T {
  cls: string;
  x: number;
  y: number;
  anchor: string;
  text: string;
}
const textsOf = (svg: string): T[] =>
  [...svg.matchAll(/<text class="([^"]*)" x="([\d.-]+)" y="([\d.-]+)"(?: text-anchor="(\w+)")?>([\s\S]*?)<\/text>/g)].map((m) => ({
    cls: m[1],
    x: Number(m[2]),
    y: Number(m[3]),
    anchor: m[4] ?? 'start',
    text: m[5].replace(/<[^>]+>/g, ''),
  }));
/** Value-axis tick labels (x-axis ticks sit on the bottom line, 8 units above the viewBox edge). */
const yTicks = (svg: string) => {
  const { h } = viewBox(svg);
  return textsOf(svg).filter((t) => t.cls.split(' ').includes('tick') && Math.abs(t.y - (h - 8)) > 0.5);
};
const xTicks = (svg: string) => {
  const { h } = viewBox(svg);
  return textsOf(svg).filter((t) => t.cls.split(' ').includes('tick') && Math.abs(t.y - (h - 8)) <= 0.5);
};
const tickNum = (t: string) => Number(t.replace(/[^0-9.-]/g, ''));
const span = (t: T, size: number, bold = false): [number, number] => {
  const w = textWidth(t.text, size, { bold });
  return t.anchor === 'end' ? [t.x - w, t.x] : t.anchor === 'middle' ? [t.x - w / 2, t.x + w / 2] : [t.x, t.x + w];
};
const cellRe = (cls: string, text: string) => new RegExp(`<t[dh] [^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>${text}`);

// ---- 1. Numbers ------------------------------------------------------------------------------

test('Req 1.1 table cells ≥ 1000 get thousands separators; decimals kept; sort uses raw values', async () => {
  const html = await page('numbers');
  assert.match(html, />109,200</);
  assert.match(html, />87,500\.5</);
  assert.match(html, />950</, 'values under 1000 are untouched');
  assert.doesNotMatch(html, /<t[dh][^>]*>109200</);
  const sorted = await frag('data n = k,v; a,950; b,109200; c,87500\ntable n sort=-v');
  assert.deepEqual(
    [...sorted.matchAll(/<th scope="row"[^>]*>(\w)</g)].map((m) => m[1]),
    ['b', 'c', 'a'],
  );
  assert.match(sorted, />109,200</);
});

test('Req 1.2 kpi values of 4+ digits, with a unit prefix or suffix, get separators', async () => {
  const html = await page('numbers');
  assert.match(html, /<span class="kv[^"]*"[^>]*>210,000<\/span>/);
  assert.match(html, /<span class="kv[^"]*"[^>]*>\$1,392,000<\/span>/);
  assert.match(html, /<span class="kv[^"]*"[^>]*>210,000 ms<\/span>/);
  assert.match(html, /<span class="kv[^"]*"[^>]*>48<\/span>/);
});

test('Req 1.3 percent and currency cells stay right-aligned and keep their unit as written', async () => {
  const html = await page('numbers');
  assert.match(html, cellRe('n', '\\$1,450,000<'));
  assert.match(html, cellRe('n', '42%<'));
  assert.match(html, cellRe('n', '\\$12,000<'));
});

test('Req 1.4 a year column is not separated', async () => {
  const html = await page('numbers');
  assert.match(html, />2024</);
  assert.doesNotMatch(html, /2,024/);
  assert.doesNotMatch(await frag('table = fy,total; 2025,12000; 2026,13000'), /2,02[56]/);
});

// ---- 2. Nothing escapes the column -------------------------------------------------------------

test('Req 2.1 grid cells can shrink: min-width 0, anywhere-wrapping text, children capped at the cell', () => {
  const c = css({});
  assert.match(c, /\.lgrid>\*\{[^}]*min-width:0/);
  assert.match(c, /\.lgrid>\*\{[^}]*overflow-wrap:anywhere/);
  assert.match(c, /\.lgrid>\*[^{]*\{[^}]*max-width:100%/);
});

test('Req 2.2 a chart in a grid cell is drawn at the cell width, not as the 640 desktop SVG', async () => {
  const html = await page('grid');
  const cell = figureOf(html, 'Yearly cost');
  const svgs = allSvgs(cell);
  assert.ok(svgs.length >= 1);
  for (const s of svgs) assert.ok(viewBox(s).w <= 520, `grid chart svg is ${viewBox(s).w} units wide`);
  assert.doesNotMatch(cell, /viewBox="0 0 640 /);
  // The same chart outside a grid still gets the desktop and the phone drawing.
  const solo = await frag('data cost = tier,usd; Basic,1200; Plus,2600\nchart bar cost title="Solo"');
  assert.match(solo, /viewBox="0 0 640 /);
  assert.match(solo, /viewBox="0 0 360 /);
});

test('Req 2.3 a table header never forces the table wider than its column', () => {
  const c = css({});
  const th = [...c.matchAll(/(?:^|\})\s*th\{([^}]*)\}/g)].map((m) => m[1]).join(';');
  assert.ok(th.length > 0, 'base th rule found');
  assert.doesNotMatch(th, /white-space:nowrap/, 'header cells must be allowed to wrap');
});

test('Req 2.4 kpi values do not wrap: nowrap, with the character count exposed to the font-size rule', async () => {
  const html = await page('hero');
  assert.match(html, /<span class="kv[^"]*" style="--kvn:9">7,440,000<\/span>/);
  assert.match(html, /<span class="kv[^"]*" style="--kvn:11">\$18,250,000<\/span>/);
  assert.match(css({}), /\.kv\{[^}]*white-space:nowrap/);
  assert.match(css({}), /--kvn/);
});

test('Req 2.5 inline code of 32 characters or fewer is one token; longer paths break only after / . - _', async () => {
  const html = await page('hero');
  assert.match(html, /<code>rollback<\/code>/);
  assert.match(html, /<code>a\/b<\/code>/);
  assert.match(
    html,
    /<code class="brk">\/<wbr>var\/<wbr>lib\/<wbr>ledger\/<wbr>archive\/<wbr>2026\/<wbr>q3\/<wbr>summary\.<wbr>json<\/code>/,
  );
  assert.match(css({}), /(^|\})code\{[^}]*white-space:nowrap/);
  assert.match(css({}), /code\.brk\{[^}]*white-space:normal/);
});

// ---- 3. Charts ------------------------------------------------------------------------------

test('Req 3.1 phone x-axis ticks never overlap; first and last are kept; none are rotated', async () => {
  const html = await page('charts');
  for (const title of ['Visits, fourteen weeks', 'Days with long labels']) {
    const svg = svgIn(figureOf(html, title), 'chart-narrow');
    assert.doesNotMatch(svg, /rotate\(/);
    const ticks = xTicks(svg).toSorted((a, b) => span(a, 12)[0] - span(b, 12)[0]);
    ticks
      .slice(1)
      .forEach((t, i) => assert.ok(span(t, 12)[0] >= span(ticks[i], 12)[1] + 4, `${title}: "${ticks[i].text}" touches "${t.text}"`));
    assert.equal(ticks[0].text, title.startsWith('Visits') ? 'W01' : '1 Oct');
    assert.equal(ticks[ticks.length - 1].text, title.startsWith('Visits') ? 'W14' : '14 Oct');
  }
});

test('Req 3.2 no chart text is under 12 units, in CSS or in attributes', async () => {
  const sizes: number[] = [];
  for (const m of css({}).matchAll(/(?:^|\})\s*([^{}@]*\.chart [^{}]*)\{([^}]*)\}/g)) {
    for (const d of m[2].matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) sizes.push(Number(d[1]));
    for (const d of m[2].matchAll(/font:[^;]*?(\d+(?:\.\d+)?)px/g)) sizes.push(Number(d[1]));
  }
  assert.ok(sizes.length > 0);
  assert.ok(Math.min(...sizes) >= 12, `smallest chart font rule is ${Math.min(...sizes)}px`);
  const html = await page('charts');
  for (const m of html.matchAll(/<svg class="chart"[\s\S]*?<\/svg>/g)) {
    for (const f of m[0].matchAll(/font-size="(\d+(?:\.\d+)?)"/g)) assert.ok(Number(f[1]) >= 12, `inline font-size ${f[1]}`);
  }
});

test('Req 3.3 bars start at zero; lines and areas start at zero unless the span is under 25% of the maximum', async () => {
  const html = await page('charts');
  const lowest = (svg: string) => yTicks(svg).toSorted((a, b) => b.y - a.y)[0].text;
  for (const cls of ['chart-wide', 'chart-narrow'] as const) {
    const span43 = svgIn(figureOf(html, 'Wide span area'), cls);
    assert.equal(tickNum(lowest(span43)), 0);
    assert.doesNotMatch(span43, /ybreak/);
    const flatLine = svgIn(figureOf(html, 'Narrow span'), cls);
    assert.match(flatLine, /class="ybreak/, 'a truncated axis shows a break mark');
    assert.ok(tickNum(lowest(flatLine)) > 0, 'the lowest tick of a truncated axis is labelled');
    const flatBars = svgIn(figureOf(html, 'Narrow span bars'), cls);
    assert.equal(tickNum(lowest(flatBars)), 0);
    assert.doesNotMatch(flatBars, /ybreak/);
    const visits = svgIn(figureOf(html, 'Visits, fourteen weeks'), cls);
    assert.match(visits, /class="ybreak/, '1190-1470 spans 19% of its maximum');
  }
  const pinned = await frag('data f = w,r; a,96.4; b,97.4\nchart line f min=90 title="Pinned"');
  const svg = svgIn(figureOf(pinned, 'Pinned'), 'chart-wide');
  assert.equal(tickNum(yTicks(svg).toSorted((a, b) => b.y - a.y)[0].text), 90);
  assert.doesNotMatch(svg, /ybreak/, 'min= overrides the baseline rule');
});

test('Req 3.4 the target label sits on the line at the right edge and never overlaps a bar label', async () => {
  const html = await page('charts');
  for (const cls of ['chart-wide', 'chart-narrow'] as const) {
    const svg = svgIn(figureOf(html, 'Target and bars'), cls);
    const { w } = viewBox(svg);
    const tl = textsOf(svg).find((t) => t.cls.includes('target-l'));
    assert.ok(tl, 'target label present');
    assert.equal(tl.anchor, 'end');
    assert.ok(tl.x > w / 2 && tl.x <= w, 'label is at the right edge');
    const [lx0, lx1] = span(tl, 11.5, true);
    for (const v of textsOf(svg).filter((t) => t.cls.split(' ').includes('val'))) {
      const [vx0, vx1] = span(v, 12);
      const xHit = lx0 < vx1 && vx0 < lx1;
      const yHit = Math.abs(tl.y - v.y) < 13;
      assert.ok(!(xHit && yHit), `${cls}: target label overlaps value "${v.text}"`);
    }
  }
});

test('Req 3.5 labels on a stacked chart print the total of every stack', async () => {
  const html = await page('charts');
  const svg = svgIn(figureOf(html, 'Stacked totals'), 'chart-wide');
  const vals = new Set(
    textsOf(svg)
      .filter((t) => t.cls.split(' ').includes('val'))
      .map((t) => t.text),
  );
  const data = [
    [1200, 310],
    [1260, 322],
    [1190, 300],
    [1310, 335],
    [1275, 328],
    [1330, 340],
    [1285, 331],
    [1360, 352],
    [1345, 349],
    [1390, 360],
    [1405, 366],
    [1432, 371],
    [1450, 375],
    [1470, 380],
  ];
  for (const [a, b] of data) assert.ok(vals.has((a + b).toLocaleString('en-US')), `total ${a + b} missing`);
  const area = await frag('data w = k,a,b; W1,1200,300; W2,1300,320\nchart area w stack labels title="Area totals"');
  const t = textsOf(svgIn(figureOf(area, 'Area totals'), 'chart-wide'))
    .filter((x) => x.cls.split(' ').includes('val'))
    .map((x) => x.text);
  assert.ok(t.includes('1,620'), 'an area stack prints its total at the last x');
});

test('Req 3.6 a single-series hbar of 8 or fewer categories is a bar list', async () => {
  const html = await page('barlist');
  const fig = figureOf(html, 'Sales by store');
  assert.match(fig, /<div class="barlist/);
  assert.doesNotMatch(fig.replace(/<details[\s\S]*<\/details>/, ''), /<svg/);
  assert.match(fig, /<details class="data">/);
  const rows = [
    ...fig.matchAll(
      /<div class="bl(?: on)?"><span class="bl-l">([^<]*)<\/span><span class="bl-b" style="--w:([\d.]+)%"><\/span><span class="bl-v">([^<]*)<\/span><\/div>/g,
    ),
  ];
  assert.deepEqual(
    rows.map((r) => r[1]),
    ['Harbor', 'Hillside', 'Midtown', 'Airport', 'Mill Road'],
  );
  const max = 109200;
  const sales = [109200, 87500, 64310, 41980, 22040];
  rows.forEach((r, i) => assert.ok(Math.abs(Number(r[2]) - (sales[i] / max) * 100) <= 0.6, `${r[1]} bar is ${r[2]}%`));
  assert.equal(Number(rows[0][2]), 100);
  assert.equal(rows[0][3], '$109,200');
  assert.equal(rows[4][3], '$22,040');
  const c = css({});
  assert.match(c, /\.bl-l[^{]*\{[^}]*font-size:15px/);
  assert.match(c, /\.bl-v[^{]*\{[^}]*font-size:15px/);
  // Nine categories, or two series, keep the axis chart.
  assert.match(figureOf(html, 'Nine categories'), /<svg/);
  assert.doesNotMatch(figureOf(html, 'Nine categories'), /barlist/);
  assert.doesNotMatch(await frag('data m = k,a,b; x,1,2; y,3,4\nchart hbar m title="Two series"'), /barlist/);
});

test('Req 3.7 focus="x value" emphasizes that bar; focus=series keeps its meaning', async () => {
  const html = await page('charts');
  const one = svgIn(figureOf(html, 'Focus on one week'), 'chart-wide');
  assert.equal(one.match(/<path class="c1"/g)?.length, 1);
  assert.equal(one.match(/<path class="cm"/g)?.length, 3);
  // The emphasized bar is the third one (W03).
  const paths = [...one.matchAll(/<path class="(c1|cm)"/g)].map((m) => m[1]);
  assert.deepEqual(paths, ['cm', 'cm', 'c1', 'cm']);
  const series = svgIn(figureOf(html, 'Focus a series'), 'chart-wide');
  assert.equal(series.match(/<path class="c1"/g)?.length, 14, 'focus=orders colors the orders series');
  assert.equal(series.match(/<path class="cm"/g)?.length, 14);
  const bl = figureOf(await page('barlist'), 'Sales, Harbor highlighted');
  assert.match(bl, /<div class="barlist focus"/);
  assert.equal(bl.match(/<div class="bl on">/g)?.length, 1);
  assert.match(bl, /<div class="bl on"><span class="bl-l">Harbor</);
  const plain = figureOf(await page('barlist'), 'Sales by store');
  assert.doesNotMatch(plain, /bl on|barlist focus/);
});

test('Req 3.7 (parse) focus="x value" is not reported as an unknown series', () => {
  const d = parse(fixture('charts'));
  assert.deepEqual(
    d.diagnostics.filter((x) => x.code === 'chart-option'),
    [],
  );
  assert.deepEqual(
    parse(fixture('barlist')).diagnostics.filter((x) => x.code === 'chart-option'),
    [],
  );
  assert.equal(
    parse('data a = x,y; p,1; q,2\nchart bar a focus=nope').diagnostics.filter((x) => x.code === 'chart-option').length,
    1,
    'a name that is neither a series nor an x value still warns',
  );
});

test('Req 3.8 bars fill at least 60% of their band on desktop and 70% on phones', async () => {
  const html = await page('charts');
  const ratio = (svg: string) => {
    const bars = [...svg.matchAll(/<path class="c1" fill="currentColor" d="M([\d.]+),[\d.]+V[\d.]+Q[^H]*H[\d.]+Q([\d.]+),/g)].map((m) => ({
      x0: Number(m[1]),
      x1: Number(m[2]),
    }));
    assert.equal(bars.length, 4);
    const band = bars[1].x0 - bars[0].x0;
    return (bars[0].x1 - bars[0].x0) / band;
  };
  const fig = figureOf(html, 'Three bars');
  assert.ok(ratio(svgIn(fig, 'chart-wide')) >= 0.595, `desktop fill ${ratio(svgIn(fig, 'chart-wide'))}`);
  assert.ok(ratio(svgIn(fig, 'chart-narrow')) >= 0.695, `phone fill ${ratio(svgIn(fig, 'chart-narrow'))}`);
});

// ---- 4. Flow diagrams ---------------------------------------------------------------------------

const flowOf = (src: string): DiagramBlock => parse(src).blocks.find((b): b is DiagramBlock => b.type === 'diagram' && b.kind === 'flow')!;
const visibleOnPhone = (html: string): string =>
  (/<div class="dg-v"[^>]*>(<svg[\s\S]*?<\/svg>)<\/div>/.exec(html)?.[1] ?? allSvgs(html)[0])!;
const rectsOf = (svg: string, cls: 'grp' | 'box') =>
  [...svg.matchAll(new RegExp(`<rect class="${cls}" x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"`, 'g'))].map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }),
  );

test('Req 4.2 on phones, group padding and label bands shrink so nesting does not eat the width', async () => {
  const phone = visibleOnPhone(await page('flow-nested'));
  const groups = rectsOf(phone, 'grp');
  assert.ok(groups.length >= 4, 'four nested groups');
  const inner = [...groups, ...rectsOf(phone, 'box')];
  for (const g of groups) {
    const kids = inner.filter((c) => c !== g && c.x >= g.x && c.y >= g.y && c.x + c.w <= g.x + g.w + 0.5 && c.y + c.h <= g.y + g.h + 0.5);
    assert.ok(kids.length > 0);
    assert.ok(Math.min(...kids.map((c) => c.x - g.x)) <= 11, `side padding ${Math.min(...kids.map((c) => c.x - g.x))}`);
    assert.ok(Math.min(...kids.map((c) => c.y - g.y)) <= 23, `label band ${Math.min(...kids.map((c) => c.y - g.y))}`);
  }
});

test('Req 4.3 each width uses whichever direction fits better (never worse than the alternative)', async () => {
  for (const name of ['flow-nested', 'flow-blocked']) {
    const html = await page(name);
    const d = flowOf(fixture(name));
    const flip = { LR: 'TB', TB: 'LR', RL: 'BT', BT: 'RL' } as const;
    const best = async (compact: boolean, width: number) => {
      const scale = async (dir: DiagramBlock['dir']) => Math.min(1, width / (await layoutFlow({ ...d, dir }, compact)).width);
      return Math.max(await scale(d.dir), await scale(flip[d.dir]));
    };
    const main = viewBox(allSvgs(html)[0]!).w;
    assert.ok(Math.min(1, 1000 / main) >= (await best(false, 1000)) - 0.01, `${name}: desktop drawing is ${main} wide`);
    const phone = viewBox(visibleOnPhone(html)).w;
    assert.ok(Math.min(1, 350 / phone) >= (await best(true, 350)) - 0.01, `${name}: phone drawing is ${phone} wide`);
  }
});

test('Req 4.4 edge labels never overlap a node box, in any direction, desktop or phone', async () => {
  const srcs = [
    readFileSync(new URL('../../../examples/kitchen-sink.lede', import.meta.url), 'utf8'),
    readFileSync(new URL('./fixtures/lede-spec.lede', import.meta.url), 'utf8'),
    fixture('flow-nested'),
    fixture('flow-blocked'),
  ];
  const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const src of srcs) {
    for (const d of parse(src).blocks.filter((b): b is DiagramBlock => b.type === 'diagram' && b.kind === 'flow')) {
      for (const dir of ['LR', 'TB'] as const)
        for (const compact of [false, true]) {
          const p = await layoutFlow({ ...d, dir }, compact);
          for (const e of p.edges) {
            if (!e.label) continue;
            for (const n of p.nodes)
              assert.ok(
                !hit(e.label, n),
                `${d.name}/${dir}${compact ? '/compact' : ''}: label "${e.label.text}" crosses node ${n.node.id}`,
              );
          }
        }
    }
  }
});

test('Req 4.5 a diagram with two or more node kinds gets a one-line legend of the kinds used', async () => {
  const html = await page('flow-nested');
  const m = /<div class="dg-legend">((?:<span class="tag">[A-Z]+<\/span>)+)<\/div>/.exec(html);
  assert.ok(m, 'legend present');
  const kinds = [...m[1].matchAll(/<span class="tag">([A-Z]+)<\/span>/g)].map((x) => x[1]);
  assert.deepEqual([...kinds].toSorted(), ['DB', 'EXT', 'FN', 'LB', 'QUEUE', 'SVC', 'USER']);
  assert.ok(html.indexOf('dg-legend') > html.indexOf('</svg>'), 'legend sits below the drawing');
  assert.doesNotMatch(await page('flow-blocked'), /dg-legend/, 'one kind needs no legend');
});

test('Req 4.6 a blocked edge is dashed, crossed at the midpoint, and labelled in the danger color', async () => {
  const full = await page('flow-blocked');
  // Every flow page carries a desktop (.dg-h) and a phone (.dg-v) drawing (design: one computed layout per
  // width), so each blocked edge appears once per drawing; count in the desktop one.
  const html = /<div class="dg-h">([\s\S]*?)<\/div><div class="dg-v"/.exec(full)?.[1] ?? full;
  assert.equal(html.match(/<path class="edge[^"]*\bblocked\b[^"]*"/g)?.length, 2);
  assert.equal(html.match(/<g class="blk"/g)?.length, 2);
  assert.equal(html.match(/<text class="elabel[^"]*\bblocked\b[^"]*"/g)?.length, 2);
  assert.match(full, /<div class="dg-v"[^>]*>[\s\S]*class="edge[^"]*\bblocked\b/, 'the phone drawing draws them too');
  const c = css({});
  assert.match(c, /\.dg \.edge\.blocked\{[^}]*stroke:var\(--bad\)/);
  assert.match(c, /\.dg \.edge\.blocked\{[^}]*stroke-dasharray/);
  assert.match(c, /\.dg \.elabel\.blocked\{[^}]*fill:var\(--bad\)/);
  assert.match(html, /<circle[^>]*r="7"/);
});

// ---- 5. Sequence diagrams -----------------------------------------------------------------------------

const dgV = (html: string) => /<div class="dg-v"[^>]*>([\s\S]*?)<\/div>(?=<\/div><\/div><\/figure>)/.exec(html)?.[1];

test('Req 5.1 a sequence diagram has a computed phone variant with wrapped labels', async () => {
  const html = await page('sequence-4');
  assert.match(html, /<div class="dg-h">/);
  assert.match(html, /<div class="dg-v"/);
  assert.match(html, /<svg class="dg seq"/);
  const phone = dgV(html);
  assert.ok(phone && phone.startsWith('<svg'), 'phone variant is an svg for four participants');
  for (const g of phone.match(/<g class="node[\s\S]*?<\/g>/g) ?? []) {
    assert.ok((g.match(/class="name"/g)?.length ?? 0) <= 3, 'participant labels wrap to at most three lines');
  }
});

test('Req 5.2 with four or fewer participants the phone drawing is at most 360 units wide', async () => {
  const phone = dgV(await page('sequence-4'));
  assert.ok(phone);
  assert.ok(viewBox(phone).w <= 360, `phone sequence is ${viewBox(phone).w} units wide`);
});

test('Req 5.3 with more than four participants the phone variant is a numbered message list', async () => {
  const html = await page('sequence-6');
  assert.match(html, /<div class="dg-h"><svg class="dg seq"/, 'desktop keeps the drawing');
  const phone = dgV(html);
  assert.ok(phone, 'phone variant present');
  assert.match(phone, /^<ol class="seqlist">/);
  assert.doesNotMatch(phone, /<svg/);
  assert.match(phone, /<li><b>Scheduler<\/b> → <b>Catalog API<\/b>: GET \/changes<\/li>/);
  assert.equal(phone.match(/ → /g)?.length, 7);
  assert.equal(phone.match(/<li class="frame">/g)?.length, 1);
  assert.match(phone, /<li class="frame">[^<]*opt[^<]*more than 5 percent failed/i);
  assert.equal(phone.match(/<li class="note">/g)?.length, 1);
  assert.match(phone, /<li class="note">[^<]*dedupes by sku/);
});

// ---- 6. Data vocabulary --------------------------------------------------------------------------

const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].toSorted((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('Req 6.1 heat tints numeric cells by rank, with a legend and ≥ 4.5:1 text on every step in both themes', async () => {
  const html = await page('heat');
  const tbl = (title: string) => html.split('<div class="scroll tbl').find((p) => p.includes(`<caption>${title}</caption>`)) ?? '';
  const all = tbl('All numeric columns');
  assert.ok(all, 'table rendered');
  // Alder 7/9/6/8, Birch 5/6/9/7, Cedar 9/4/5/6, Dogwood 6/8/8/9: highest is h5, lowest h1, per column.
  assert.match(all, /<td[^>]*class="[^"]*\bh5\b[^"]*"[^>]*>9<\/td>/);
  assert.match(all, /<td[^>]*class="[^"]*\bh1\b[^"]*"[^>]*>4<\/td>/);
  const rows = all.split('<tr').slice(2);
  const level = (r: string, col: number) => Number(/\bh([1-5])\b/.exec(r.split('<td')[col + 1] ?? '')?.[1]);
  const price = rows.map((r) => level(r, 0));
  assert.ok(price[2] > price[0] && price[0] > price[1], `price ranks ${price.join(',')} (Cedar 9 > Alder 7 > Birch 5)`);
  assert.match(html, /<div class="heat-legend">(?:<i class="h[1-5]"><\/i>){5}[^<]*low → high/);
  // heat=col limits it.
  const two = tbl('Two columns');
  assert.ok(/\bh[1-5]\b/.test(two.split('<td')[1] ?? ''), 'price is tinted');
  assert.doesNotMatch(two.split('<td')[2] ?? '', /\bh[1-5]\b/, 'support is not');
  // Inline tables take the option too.
  assert.match(await frag('table heat = team,velocity; Red,31; Blue,24; Green,40'), /class="[^"]*\bh[1-5]\b/);
  // Contrast of --fg on each tint, light and dark.
  for (const theme of ['light', 'dark']) {
    const c = css({ theme });
    const fg = /--fg:(#[0-9a-f]{6})/i.exec(c)![1];
    for (let i = 1; i <= 5; i++) {
      const m = new RegExp(`--h${i}:(#[0-9a-f]{6})`, 'i').exec(c);
      assert.ok(m, `--h${i} defined for ${theme}`);
      assert.ok(contrast(fg, m[1]) >= 4.5, `${theme} h${i}: ${contrast(fg, m[1]).toFixed(2)}:1`);
    }
  }
});

test('Req 6.2 bar= draws a proportional bar behind the cell; the number stays; scaled to the column max or to 100', async () => {
  const html = await page('bars');
  const cbs = (title: string) =>
    [
      ...(html.split('<div class="scroll tbl').find((p) => p.includes(`<caption>${title}</caption>`)) ?? '').matchAll(
        /<span class="cb" style="--p:([\d.]+)%"><i><\/i>([^<]*)<\/span>/g,
      ),
    ].map((m) => [Number(m[1]), m[2]] as const);
  assert.deepEqual(cbs('Progress'), [
    [80, '80%'],
    [45, '45%'],
    [10, '10%'],
  ]);
  const budget = cbs('Budget share');
  assert.deepEqual(
    budget.map((b) => b[1]),
    ['12,000', '8,000', '20,000'],
  );
  assert.deepEqual(
    budget.map((b) => Math.round(b[0])),
    [60, 40, 100],
  );
  assert.match(html, cellRe('n', '<span class="cb"'));
});

test('Req 6.3 heat and bar= work on inline tables', async () => {
  const html = await page('bars');
  assert.equal(html.match(/<span class="cb"/g)?.length, 9, 'three tables of three rows');
  assert.match(await frag('table bar=done = stream,done; A,80%; B,20%'), /<span class="cb" style="--p:80%">/);
});

test('Req 6.4 a two-column table with a time-like first column is a vertical timeline', async () => {
  const html = await page('timeline');
  assert.equal(html.match(/<ol class="timeline">/g)?.length, 2);
  assert.match(html, /<li><time>16:04<\/time><span>Alert fires for the order queue<\/span><\/li>/);
  assert.equal(html.match(/<li class="em">/g)?.length, 3, 'bold rows get an emphasized marker');
  assert.match(html, /<li class="em"><time>16:09<\/time><span>/);
  assert.match(html, /<time>Day 3<\/time>/);
  assert.match(html, /<th scope="row"[^>]*>Alpha</, 'Alpha/Beta is not time-like: still a table');
  const three = await frag('table = time,event,owner; 09:00,Start,Ana; 10:00,Review,Bo');
  assert.doesNotMatch(three, /class="timeline"/);
  const long = `table = time,event; ${Array.from({ length: 15 }, (_, i) => `${String(8 + (i % 10)).padStart(2, '0')}:${String(i).padStart(2, '0')},step ${i}`).join('; ')}`;
  assert.doesNotMatch(await frag(long), /class="timeline"/, 'more than 14 rows stays a table');
});

test('Req 6.5 a pick that names a column header tints that column, header included', async () => {
  const html = await page('recommendation');
  const t = html.split('<div class="scroll tbl').find((p) => /<th scope="col"[^>]*>Beacon<\/th>/.test(p)) ?? '';
  assert.match(t, /<th scope="col"[^>]*class="[^"]*\bpick\b[^"]*"[^>]*>Beacon<\/th>/);
  assert.equal(t.match(/<td[^>]*class="[^"]*\bpick\b/g)?.length, 3, 'one tinted cell per row');
  assert.doesNotMatch(t, /<th scope="col"[^>]*pick[^>]*>Atlas/);
});

test('Req 6.6 a short Recommendation / Decision / Verdict / Conclusion section is an outlined card', async () => {
  const html = await page('recommendation');
  assert.match(
    html,
    /<section class="card rec"><h2 id="recommendation">Recommendation<\/h2><p class="rec-t"><strong>Choose Beacon\.<\/strong>/,
  );
  assert.doesNotMatch(html, /card rec"><h2 id="notes"/);
  const long = await frag(`## Verdict\n${'Words that run long. '.repeat(40)}`);
  assert.doesNotMatch(long, /card rec/, 'over 600 characters is not a card');
  const five = await frag('## Decision\nA.\n\nB.\n\nC.\n\nD.\n\nE.');
  assert.doesNotMatch(five, /card rec/, 'over 4 blocks is not a card');
  assert.match(await frag('## Conclusion\nShort and plain.'), /<section class="card rec"><h2 id="conclusion">/);
});

test('Req 6.7 a numbered list with bold lead-ins and sub-items or long text is a list of step cards', async () => {
  const html = await page('steps');
  assert.equal(html.match(/<ol class="steps cards">/g)?.length, 1);
  assert.match(html, /<ol class="steps cards"><li><span class="n">1<\/span><b>Stop the writers\.<\/b><div>/);
  assert.match(html, /<span class="n">3<\/span><b>Mount and check\.<\/b>/);
  assert.match(html, /<ol><li>Open the console<\/li>/, 'short numbered lists stay step lists');
});

test('Req 6.8 @author "Name, Role" renders the role muted after the name', async () => {
  const html = await page('byline');
  assert.match(html, /<span class="by-n">Maya Ortiz<\/span><span class="by-r">[^<]*Staff Engineer<\/span>/);
  assert.match(css({}), /\.by-r\{[^}]*color:var\(--muted\)/);
  assert.doesNotMatch(await frag('@author Platform team\n# T'), /by-r/);
});

test('Req 6.9 a comma inside a **bold** span does not split the field', async () => {
  const { html, doc } = await compile('table = kind,count; **Mixed: 12 electric, 6 hybrid**,18; Plain,4', { fragment: true });
  assert.deepEqual(
    doc.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  assert.match(html, /<strong>Mixed: 12 electric, 6 hybrid<\/strong>/);
  assert.deepEqual(doc.data._table1.rows[0], ['**Mixed: 12 electric, 6 hybrid**', '18']);
});

// ---- 8. Safety ------------------------------------------------------------------------------

test('Req 8.1 every fixture still has no script, no remote URL and the CSP meta', async () => {
  for (const n of [
    'numbers',
    'grid',
    'hero',
    'charts',
    'barlist',
    'flow-nested',
    'flow-blocked',
    'sequence-4',
    'sequence-6',
    'heat',
    'bars',
    'timeline',
    'recommendation',
    'steps',
    'byline',
  ]) {
    const html = await page(n);
    assert.doesNotMatch(html, /<script/i, n);
    assert.doesNotMatch(html, /\son\w+=/i, n);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, n);
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/, n);
  }
});
