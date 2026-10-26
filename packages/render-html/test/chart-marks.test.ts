// Chart event markers (stream A): layout, escaping, accessibility text, contrast and the no-marks path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type ChartBlock } from '@lede-lang/core';
import { render, css } from '../src/index.ts';
import { layoutFlags, resolveMarks, type Mark } from '../src/chart.ts';
import { textWidth } from '../src/util.ts';

const DATA = 'data u = week,rate,errors; W1,99.9,3; W2,99.8,5; W3,99.95,1; W4,99.7,9; W5,99.6,4';
const page = (chartLines: string) => render(parse(`${DATA}\n${chartLines}`), { fragment: true });
const svgs = (html: string) => (html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) as [string, string];

test('marks draw a rule and a flag on line, area and bar charts, in both svgs', async () => {
  for (const kind of ['line', 'area', 'bar']) {
    const html = await page(`chart ${kind} u y=rate mark="W2 deploy v2" mark="W4 rollback"`);
    const [wide, narrow] = svgs(html);
    for (const s of [wide, narrow]) {
      assert.equal((s.match(/class="mk-rule"/g) ?? []).length, 2, kind);
      assert.equal((s.match(/class="mark"/g) ?? []).length, 2, kind);
      assert.match(s, /<text class="mk-t"[^>]*>deploy v2<\/text>/);
      assert.match(s, /<title>W4: rollback<\/title>/);
    }
    assert.match(html, /<th scope="col">Event<\/th>/);
    assert.match(html, /<td>rollback<\/td>/);
    assert.match(svgs(html)[0], /Events: W2, deploy v2; W4, rollback\./);
    assert.doesNotMatch(html, /<script/i);
  }
});

test('marks never change the plot size or the axis', async () => {
  const bare = svgs(await page('chart line u y=rate'))[0];
  const marked = svgs(await page('chart line u y=rate mark="W2 a"'))[0];
  const ticks = (s: string) =>
    (s.match(/class="tick"[^>]*>[^<]*</g) ?? [])
      .map((t) => t.replace(/ x="[^"]*"| y="[^"]*"/g, ''))
      .filter((t) => /\d/.test(t) && !/W\d/.test(t));
  assert.deepEqual(ticks(marked), ticks(bare));
  const h = (s: string) => Number(/viewBox="0 0 \d+ (\d+)"/.exec(s)![1]);
  assert.ok(h(marked) > h(bare));
  assert.match(bare, /viewBox="0 0 640 280"/);
});

test('charts without marks render exactly as before (no marker output at all)', async () => {
  const html = await page('chart line u y=rate target="99.9 SLO" labels');
  assert.doesNotMatch(html, /mk-|class="mark"|Event|Events:/);
  assert.match(html, /viewBox="0 0 640 280"/);
  assert.match(html, /viewBox="0 0 360 220"/);
});

test('hostile marker labels stay inert everywhere they appear', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = await page(`chart line u y=rate mark="W2 ${evil}" mark="W3 \\"><script>alert(2)</script>"`);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(svgs(html).every((s) => !/<(?!\/?(svg|title|desc|line|rect|text|g|circle|polyline|polygon|path)\b)/.test(s)));
});

test('a long label is truncated in the flag and kept whole in the title, table and desc', async () => {
  const label = 'incident review with the whole platform council and finance';
  const html = await page(`chart line u y=rate mark="W2 ${label}"`);
  const [wide] = svgs(html);
  assert.match(wide, /<text class="mk-t"[^>]*>[^<]*…<\/text>/);
  assert.ok(wide.includes(`<title>W2: ${label}</title>`));
  assert.ok(html.includes(`<td>${label}</td>`));
  assert.ok(wide.includes(label), 'desc carries it');
});

test('an empty label draws a bare tick, and same-category marks stack', async () => {
  const bare = svgs(await page('chart line u y=rate mark=W3'))[0];
  assert.match(bare, /class="mk-dot" cx=/);
  assert.doesNotMatch(bare, /class="mk-flag"/);
  const stack = svgs(await page('chart line u y=rate mark="W3 first" mark="W3 second"'))[0];
  const ys = [...stack.matchAll(/class="mk-flag" x="[\d.]+" y="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ys).size, 2, 'two lanes');
});

test('marks that do not resolve are skipped; hbar ignores marks', async () => {
  const doc = parse(`${DATA}\nchart line u y=rate mark="W2 ok"`);
  const c = doc.blocks.find((b): b is ChartBlock => b.type === 'chart')!;
  c.marks = [
    { x: 'W99', label: 'gone' },
    { x: 'W2', label: 'ok' },
  ];
  const html = await render(doc, { fragment: true });
  assert.equal((svgs(html)[0].match(/class="mark"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /gone/);
  c.kind = 'hbar';
  const h = await render(doc, { fragment: true });
  assert.doesNotMatch(h, /mk-|class="mark"/);
  assert.deepEqual(resolveMarks(c, ['W1', 'W2']), []);
});

test('flags never overlap and stay inside the chart (fuzz, 640 and 360)', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (const [W, narrow] of [
    [640, false],
    [360, true],
  ] as const) {
    for (let t = 0; t < 300; t++) {
      const n = 3 + Math.floor(rnd() * 12);
      const cx = (i: number) => 50 + ((W - 70) / (n - 1)) * i;
      const k = 1 + Math.floor(rnd() * 6);
      const marks: Mark[] = Array.from({ length: k }, () => {
        const len = Math.floor(rnd() * 40);
        return { i: Math.floor(rnd() * n), x: 'c', label: 'abcdefghij klmnopqrstuvwxyz0123456789'.slice(0, len).trim() };
      });
      const { items } = layoutFlags(marks, cx, W, narrow);
      for (const f of items) {
        assert.ok(f.x0 >= 0 && f.x0 + f.w <= W + 0.01, `inside: ${f.x0}..${f.x0 + f.w} of ${W}`);
      }
      for (const f of items)
        for (const g of items) {
          if (f === g) continue;
          const overlap = f.x0 < g.x0 + g.w && g.x0 < f.x0 + f.w;
          if (overlap) assert.notEqual(f.lane, g.lane, 'flags in one lane must not overlap');
        }
    }
  }
});

test('four close markers at 360px stay compact and readable', () => {
  const cx = (i: number) => 40 + i * 24;
  const { items, lanes } = layoutFlags(
    [0, 1, 2, 3].map((i) => ({ i, x: `W${i}`, label: `event number ${i}` })),
    cx,
    360,
    true,
  );
  assert.ok(lanes <= 4);
  assert.ok(items.every((f) => f.w <= 124));
  // Staircase: each later flag sits lower than every earlier flag it overlaps, so no rule runs through a flag.
  for (const f of items)
    for (const g of items) {
      if (f !== g && f.x > g.x0 + 1 && f.x < g.x0 + g.w - 1) assert.ok(f.lane > g.lane);
    }
});

test('target label steps aside when a marker rule would cut through it', async () => {
  const data = `data r = w,v; ${Array.from({ length: 12 }, (_, i) => `W${i + 1},${100 + i * 3}`).join('; ')}`;
  const src = (marks: string) => `${data}\nchart line r y=v target="130 Objective for the quarter"${marks}`;
  const labelOf = async (marks: string) => {
    const s = svgs(await render(parse(src(marks)), { fragment: true }))[0];
    const tl = /<text class="target-l" x="([\d.]+)" y="[\d.]+" text-anchor="end">(?:<title>[^<]*<\/title>)?([^<]*)</.exec(s)!;
    const rules = [...s.matchAll(/class="mk-rule" x1="([\d.]+)"/g)].map((m) => Number(m[1]));
    return { end: Number(tl[1]), text: tl[2], rules };
  };
  const base = await labelOf('');
  const hit = await labelOf(' mark="W11 a" mark="W9 b"');
  assert.ok(hit.end !== base.end, 'label moved off the default spot');
  const w = textWidth(hit.text, 11.5, { bold: true });
  for (const r of hit.rules) assert.ok(!(r > hit.end - w - 2 && r < hit.end + 2), `rule at ${r} cuts label ${hit.end - w}..${hit.end}`);
  // With no gap wide enough the label is cut to the widest gap and the full text stays in a title.
  const crowded = await render(
    parse(
      src(' mark="W2 a" mark="W3 b" mark="W4 c" mark="W5 d" mark="W6 e" mark="W7 f" mark="W8 g" mark="W9 h" mark="W10 i" mark="W11 j"'),
    ),
    { fragment: true },
  );
  assert.match(svgs(crowded)[0], /<text class="target-l"[^>]*><title>Objective for the quarter<\/title>[^<]*…/);
});

// Contrast: marker colors come only from theme tokens; check each pair we use, light and dark.
function tokens(block: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):(#[0-9a-f]{6})/gi)) o[m[1]] ??= m[2];
  return o;
}
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].toSorted((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('marker colors pass contrast in light and dark', () => {
  const sheet = css({});
  const light = tokens(sheet.slice(0, sheet.indexOf('@media (prefers-color-scheme:dark)')));
  const darkStart = sheet.indexOf('@media (prefers-color-scheme:dark)');
  const dark = tokens(sheet.slice(darkStart, sheet.indexOf('*,*::before', darkStart)));
  for (const [name, t] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    assert.ok(ratio(t.fg, t['info-bg']) >= 4.5, `${name} flag text on flag fill`);
    assert.ok(ratio(t.fg, t.surface) >= 4.5, `${name} bold x label on surface`);
    assert.ok(ratio(t.muted, t.surface) >= 3, `${name} rule on surface`);
    assert.ok(ratio(t['line2'], t.surface) >= 1.2, `${name} flag border visible`);
  }
  const rules = sheet.slice(sheet.indexOf('/* stream-a'), sheet.indexOf('/* end stream-a */'));
  assert.ok(rules.length > 100 && sheet.includes('/* end stream-a */'));
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i, 'tokens only');
});
