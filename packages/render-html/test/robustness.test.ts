// Degenerate input the renderer must draw without a throw and without writing NaN, Infinity or undefined into the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type ChartBlock } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';

const BAD = /NaN|Infinity|undefined/;

test('no min= or max= writes NaN into a chart', async () => {
  const data = ['data z = a,b; x,5; y,7', 'data zero = a,b; x,0; y,0', 'data neg = a,b; x,-5; y,-7', 'data tiny = a,b; x,1e-300; y,2e-300'];
  const opts = ['min=10 max=10', 'min=10 max=2', 'min=3 max=3', 'min=0 max=0', 'max=-5', 'min=100', 'min=-100', 'max=0', 'min=7', ''];
  const lines: string[] = [...data];
  for (const d of ['z', 'zero', 'neg', 'tiny'])
    for (const kind of ['line', 'area', 'bar', 'hbar', 'bar stack', 'range']) {
      const [k, ...flags] = kind.split(' ');
      for (const o of opts) lines.push(`chart ${k} ${d} ${k === 'range' ? 'from=b to=b ' : ''}${o} ${flags.join(' ')}`.trimEnd());
    }
  const { html } = await compile(`${lines.join('\n')}\n`);
  for (const svg of html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) assert.doesNotMatch(svg, BAD, svg.slice(0, 300));
  assert.ok((html.match(/<svg/g) ?? []).length >= 200);
});

test('a chart block built by hand with an empty range is drawn on the range of its data', async () => {
  const doc = parse('data z = a,b; x,5; y,7\nchart line z\nchart hbar z\n');
  for (const b of doc.blocks) if (b.type === 'chart') Object.assign(b, { min: 10, max: 2 } satisfies Partial<ChartBlock>);
  const bent = await render(doc);
  assert.doesNotMatch(bent, BAD);
  for (const b of doc.blocks) if (b.type === 'chart') Object.assign(b, { min: Number.NaN, max: Number.POSITIVE_INFINITY });
  assert.doesNotMatch(await render(doc), BAD);
});

test('a series longer than a call takes arguments is drawn', async () => {
  // `Math.max(...values)` throws a RangeError past about 120,000 values; every kind of chart reads its rows another way.
  const rows = Array.from({ length: 130_000 }, (_, i) => `${i},${i % 97}`).join('; ');
  for (const chart of ['chart line big', 'chart hbar big', 'chart range big from=v to=v']) {
    const doc = parse(`data big = i,v; ${rows}\n${chart}\n`);
    assert.deepEqual(doc.diagnostics, []);
    assert.match(await render(doc, { fragment: true }), /<svg/, chart);
  }
});
