// Degenerate input the renderer must draw without a throw and without writing NaN, Infinity or undefined into the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type ChartBlock } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { inline, plain } from '../src/util.ts';
import { browserTest } from './chrome.ts';
import { UNFORMATTED } from './fuzz.ts';

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
  for (const svg of html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) assert.doesNotMatch(svg, UNFORMATTED, svg.slice(0, 300));
  assert.ok((html.match(/<svg/g) ?? []).length >= 200);
});

test('a chart block built by hand with an empty range is drawn on the range of its data', async () => {
  const doc = parse('data z = a,b; x,5; y,7\nchart line z\nchart hbar z\n');
  for (const b of doc.blocks) if (b.type === 'chart') Object.assign(b, { min: 10, max: 2 } satisfies Partial<ChartBlock>);
  const bent = await render(doc);
  assert.doesNotMatch(bent, UNFORMATTED);
  for (const b of doc.blocks) if (b.type === 'chart') Object.assign(b, { min: Number.NaN, max: Number.POSITIVE_INFINITY });
  assert.doesNotMatch(await render(doc), UNFORMATTED);
});

test('a chart or table whose column a later redefinition took away draws nothing and does not throw', async () => {
  const doc = parse('data d = x,y; a,1; b,2\nchart area d stack\ntable d sort=y bar=y\n\nStill here.\n\ndata d = p,q; a,5\ntable d\n');
  assert.equal(doc.diagnostics.filter((d) => d.severity === 'error').length, 2);
  const html = await render(doc, { fragment: true });
  assert.doesNotMatch(html, UNFORMATTED);
  assert.doesNotMatch(html, /<svg/);
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /Still here\./);
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

test('a link URL may hold one level of parentheses', () => {
  assert.equal(inline('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))'), '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a>');
  assert.equal(inline('(see [b](y))'), '(see <a href="y">b</a>)');
  assert.equal(inline('[t](javascript:alert(1))'), 't');
  assert.equal(inline('[see [1](u)'), '[see <a href="u">1</a>');
  assert.equal(plain('[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and [b](y)'), 'wiki and b');
});

test('a code span written with N backticks closes at the next run of N', () => {
  assert.equal(inline('``a`b``'), '<code>a`b</code>');
  assert.equal(inline('`` `a` ``'), '<code>`a`</code>');
  assert.equal(inline('`a` and ``b`` and ```c```'), '<code>a</code> and <code>b</code> and <code>c</code>');
  assert.equal(inline('` a `'), '<code> a </code>');
  assert.equal(inline('`unclosed'), '`unclosed');
  // A run that nothing closes is text, all of it: no shorter span opens inside it.
  assert.equal(inline('``x` y'), '``x` y');
  assert.equal(inline('a ``` b ` c'), 'a ``` b ` c');
  assert.equal(plain('``x` y'), '``x` y');
  assert.equal(inline('`one and ``two` y'), '<code>one and ``two</code> y');
  assert.equal(plain('``a`b`` and `c`'), 'a`b and c');
});

test('a bold span may hold emphasis, and tags never cross', () => {
  assert.equal(inline('**a *b* c**'), '<strong>a <em>b</em> c</strong>');
  assert.equal(inline('**a _b_ c**'), '<strong>a <em>b</em> c</strong>');
  assert.equal(inline('***both***'), '<em><strong>both</strong></em>');
  assert.equal(inline('**Stage on `canary-01` only.**'), '<strong>Stage on <code>canary-01</code> only.</strong>');
  assert.equal(inline('*x **a b* c** y*'), '<em>x <strong>a b* c</strong> y</em>');
  assert.equal(inline('_a **b_ c**'), '_a <strong>b_ c</strong>');
  assert.equal(plain('**a *b* c**'), 'a b c');
});

test('inline markup costs the length of the line, not its square', () => {
  const lines = [
    '[a]('.repeat(32_000),
    '['.repeat(32_000),
    `${'[a](x'.repeat(32_000)} )`,
    `${'['.repeat(32_000)}]`,
    '` `` '.repeat(20_000),
    '`'.repeat(40_000),
    `${'`'.repeat(40_000)}x${'`'.repeat(40_001)}`,
    '**a *'.repeat(20_000),
  ];
  const t = performance.now();
  for (const l of lines) inline(l);
  // These took 5 s and more between them; the bound is loose so a slow runner does not fail it.
  assert.ok(performance.now() - t < 2000, `${Math.round(performance.now() - t)} ms`);
});

browserTest('print uses the light tokens on a dark device, under @theme dark and under data-theme="dark"', async (browser) => {
  const ink = async (html: string, attr = false) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.setContent(html);
    if (attr) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const read = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.body);
        const link = document.querySelector('a');
        return { fg: s.color, bg: s.backgroundColor, link: link ? getComputedStyle(link).color : '' };
      });
    const screen = await read();
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    const print = await read();
    await ctx.close();
    return { screen, print };
  };
  const src = '# Title\n\nSome text with [a link](https://example.com).\n';
  const paper = { fg: 'rgb(22, 24, 29)', bg: 'rgb(255, 255, 255)' };
  for (const [name, html, attr] of [
    ['a dark device', (await compile(src)).html, false],
    ['@theme dark', (await compile(`@theme dark\n${src}`)).html, false],
    ['data-theme', (await compile(src)).html, true],
  ] as const) {
    const { screen, print } = await ink(html, attr);
    assert.equal(screen.fg, 'rgb(236, 238, 241)', `${name}: the screen is dark`);
    assert.deepEqual({ fg: print.fg, bg: print.bg }, paper, name);
    assert.equal(print.link, 'rgb(35, 87, 198)', `${name}: the link takes the light accent`);
  }
  // An accent checked against the dark theme only is not printed; one checked against the light theme is.
  const pale = await ink((await compile(`@theme dark\n@accent #ffd700\n${src}`)).html);
  assert.equal(pale.screen.link, 'rgb(255, 215, 0)');
  assert.equal(pale.print.link, 'rgb(35, 87, 198)');
  const both = await ink((await compile(`@accent #b4372f\n${src}`)).html);
  assert.equal(both.print.link, 'rgb(180, 55, 47)');
});
