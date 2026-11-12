// The layout class (spec §7, D80; internal spec, lede-lang/meta): `layoutClass` picks `prose`, `document` or `dashboard` from the blocks and
// `@width`; a dashboard has the 64rem column, grids whose cells are at least 420px wide, and flow diagrams left to right when they
// have more layers than breadth. fixtures/layout-classes.json pins the class of every tracked `.lede` outside bench/gen/
// (UPDATE=1 regenerates it, as for render-hashes.json), so a change to the thresholds is a reviewed diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, type DiagramBlock } from '@lede-lang/core';
import { Ctx, compile, css, hasProseSection, layoutClass, masthead, render, type Layout } from '../src/index.ts';
import { rankShape } from '../src/diagram.ts';
import { browserTest } from './chrome.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureUrl = new URL('./fixtures/layout-classes.json', import.meta.url);
const update = process.env.UPDATE === '1';
const loadFile = () => 'a,b\n1,2';

/** The class of a page's source, as `render()` reads it (the blocks after the masthead). */
function classOf(src: string): Layout {
  const doc = parse(src, { loadFile });
  return layoutClass(masthead(doc, new Ctx(doc, {})).rest, doc.meta);
}

/** Every tracked `.lede` file outside bench/gen/, sorted. */
function tracked(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.lede'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((f) => f && !f.startsWith('bench/gen/'))
    .toSorted();
}

const para = (n: number) => `${'A sentence that runs on long enough to count as prose in a paragraph. '.repeat(6)}${n}`;
const essay = (n = 5) => Array.from({ length: n }, (_, i) => para(i)).join('\n\n');
const TABLE = 'table = a,b; 1,2; 3,4';

// ---- the classifier ------------------------------------------------------------------------------------------------------------

test('a page with a table, chart, kpi, diagram, cards, steps or grid and no prose section is a dashboard', () => {
  const pages = [
    TABLE,
    'kpi Uptime | 99.9% | | ok',
    'data t = a,b; 1,2\nchart bar t',
    'step Ship it | Friday',
    'diagram d\nd: a -> b',
    'grid 2\nchart bar t\nchart line t',
    'cards\n### One\n- a\n### Two\n- b',
  ];
  for (const p of pages) assert.equal(classOf(`# T\n\n## S\n\nShort.\n\n${p}\n`), 'dashboard', p);
});

test('a page of headings, short paragraphs, lists, notes and quotes is a document', () => {
  assert.equal(classOf('# T\n\n## A\n\nShort.\n\n- x\n- y\n\n! Careful.\n\n> Said.\n\n## B\n\nMore.\n'), 'document');
});

test('an essay is prose, with or without a heading, and an essay with a table is a document, not a dashboard', () => {
  assert.equal(classOf(`# T\n\n${essay()}\n`), 'prose');
  const withTable = `# T\n\n## One\n\n${essay(4)}\n\n${TABLE}\n`;
  assert.equal(classOf(withTable), 'document');
  assert.ok(hasProseSection(parse(withTable).blocks));
});

test('the prose test reads each ## section: a long run in one section keeps the page out of the dashboard class', () => {
  const sections = (long: boolean) =>
    ['# T', '', '## Numbers', '', 'kpi A | 1 | | x', '', '## Story', '', ...(long ? [essay(4)] : [para(1), para(2)]), '', TABLE].join('\n');
  assert.equal(classOf(sections(true)), 'document');
  assert.equal(classOf(sections(false)), 'dashboard');
});

test("@width wide is a dashboard on any page and never prose; @width narrow keeps today's column on a dashboard", () => {
  assert.equal(classOf('@width wide\n# T\n\nShort.\n'), 'dashboard');
  assert.equal(classOf(`@width wide\n# T\n\n${essay()}\n`), 'dashboard');
  assert.equal(classOf(`@width narrow\n# T\n\n${TABLE}\n`), 'document');
  // Narrow is today's column, and today an essay is prose in it.
  assert.equal(classOf(`@width narrow\n# T\n\n${essay()}\n`), 'prose');
});

test('an unknown @width value is ignored, as an unknown @theme is: the class comes from the blocks', () => {
  for (const w of ['banana', 'Wide', 'wider', '']) {
    assert.equal(classOf(`@width ${w}\n# T\n\n${TABLE}\n`), 'dashboard', `@width ${w}`);
    assert.equal(classOf(`@width ${w}\n# T\n\nShort.\n`), 'document', `@width ${w}`);
  }
  assert.deepEqual(parse('@width banana\n# T\n').diagnostics, []);
});

// ---- the page: class, column, rules --------------------------------------------------------------------------------------------

const COLUMN = /\.doc\{--col:(\d+rem);/;

test('a dashboard has class "doc dash", the 64rem column and the dashboard rules; every other page has none of them', async () => {
  const dash = (await compile(`# T\n\n${TABLE}\n`)).html;
  assert.match(dash, /<main class="doc dash">/);
  assert.equal(COLUMN.exec(dash)?.[1], '64rem');
  assert.ok(dash.includes('.doc.dash .lgrid{'));
  for (const src of ['# T\n\nShort.\n', `@width narrow\n# T\n\n${TABLE}\n`, `# T\n\n${essay()}\n`]) {
    const page = (await compile(src)).html;
    assert.ok(!/class="doc dash"|\.doc\.dash/.test(page), src.slice(0, 20));
    assert.equal(COLUMN.exec(page)?.[1], '46rem');
  }
  assert.match((await compile(`# T\n\n${essay()}\n`)).html, /<main class="doc prose">/);
});

test('--artifact output carries the same <main> and <style> as the full page', async () => {
  const doc = parse(`# T\n\n${TABLE}\n`);
  const full = await render(doc);
  const art = await render(doc, { artifact: true });
  for (const part of [/<style>[\s\S]*<\/style>/, /<main[\s\S]*<\/main>/]) assert.equal(part.exec(art)?.[0], part.exec(full)?.[0]);
});

test('css({dash}) is css({wide}) plus the dashboard rules, and nothing else changes', () => {
  const [plain, wide, dash] = [css({}), css({ wide: true }), css({ dash: true })];
  assert.equal(wide, plain.replace('--col:46rem', '--col:64rem'));
  assert.ok(dash.startsWith(wide));
  assert.ok(dash.slice(wide.length).startsWith('.doc.dash .lgrid{'));
});

test('the tracked pages keep the class the fixture records', () => {
  const files = tracked();
  const got: Record<string, Layout> = {};
  for (const f of files) got[f] = classOf(readFileSync(`${root}${f}`, 'utf8'));
  if (update) {
    writeFileSync(fixtureUrl, `${JSON.stringify(got, null, 2)}\n`);
    return;
  }
  assert.deepEqual(got, JSON.parse(readFileSync(fixtureUrl, 'utf8')) as Record<string, Layout>);
});

test('a page that is not a dashboard has no dashboard class, rule or direction in any mode', async () => {
  for (const f of tracked()) {
    const src = readFileSync(`${root}${f}`, 'utf8');
    if (classOf(src) === 'dashboard') continue;
    const page = (await compile(src, { loadFile })).html;
    assert.ok(!/class="doc dash"|\.doc\.dash|data-dir=/.test(page), f);
  }
});

// ---- the diagram direction -----------------------------------------------------------------------------------------------------

function flow(text: string): DiagramBlock {
  const d = parse(`diagram d\n${text}`).blocks.find((b) => b.type === 'diagram');
  assert.ok(d && d.type === 'diagram');
  return d;
}

test('rankShape: ranks are longest paths, breadth is the widest rank', () => {
  assert.deepEqual(rankShape(flow('d: a -> b -> c -> d -> e -> f\nd: a -> g -> e')), { layers: 6, breadth: 2 });
  assert.deepEqual(rankShape(flow('d: a -> b, c, d\nd: b, c, d -> e')), { layers: 3, breadth: 3 });
  assert.deepEqual(rankShape(flow('d: a -> b')), { layers: 2, breadth: 1 });
});

test('rankShape: a cycle is broken, a <-> edge counts once, a node with no edge is in the first rank', () => {
  assert.deepEqual(rankShape(flow('d: a -> b -> c -> a')), { layers: 3, breadth: 1 });
  assert.deepEqual(rankShape(flow('d: a <-> b')), { layers: 2, breadth: 1 });
  assert.deepEqual(rankShape(flow('d: a -> b\nd: x "Alone"\nd: y "Also alone"')), { layers: 2, breadth: 3 });
  assert.deepEqual(rankShape(flow('d: a -> a')), { layers: 1, breadth: 1 });
});

test('rankShape: an edge to a group goes to the first node it holds, and the group itself is not a node', () => {
  assert.deepEqual(rankShape(flow('d: group g "G" c, d\nd: c -> d\nd: a -> g\nd: g -> b')), { layers: 3, breadth: 2 });
});

const PIPELINE = [
  'diagram pipe{DIR}',
  'pipe: a "Source"',
  'pipe: b "Lint"',
  'pipe: c "Build"',
  'pipe: d "Test"',
  'pipe: e "Package"',
  'pipe: f "Deploy"',
  'pipe: g "Docs"',
  'pipe: a -> b -> c -> d -> e -> f',
  'pipe: a -> g -> e',
].join('\n');
const pipeline = (head: string, dir = '') => `${head}\n\n${PIPELINE.replace('{DIR}', dir)}\n`;

/** The `data-dir` of the figure, and whether the desktop drawing is wider than it is tall. */
function drawn(html: string): { dir: string | null; wide: boolean } {
  const fig = /<figure class="viz dg-fig[^>]*>/.exec(html)?.[0] ?? '';
  const box = /<svg class="dg"[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html);
  assert.ok(box, 'a desktop drawing');
  return { dir: /data-dir="([A-Z]+)"/.exec(fig)?.[1] ?? null, wide: Number(box[1]) > Number(box[2]) };
}

test('a flow with six layers and a breadth of two, no dir=, is left to right on a dashboard and top to bottom on a document page', async () => {
  const dash = drawn((await compile(pipeline('# T\n\nkpi Builds | 412 | | ok'))).html);
  assert.deepEqual(dash, { dir: 'LR', wide: true });
  // `@width narrow` is today's column, which keeps today's direction, and the figure says nothing about it.
  const doc = drawn((await compile(pipeline('@width narrow\n# T\n\nkpi Builds | 412 | | ok'))).html);
  assert.deepEqual(doc, { dir: null, wide: false });
});

test('a written dir= is never changed by the page class, and a flow wider than deep keeps top to bottom', async () => {
  const head = '# T\n\nkpi Builds | 412 | | ok';
  assert.equal(drawn((await compile(pipeline(head, ' dir=TB'))).html).dir, null);
  assert.equal(drawn((await compile(pipeline(head, ' dir=TB'))).html).wide, false);
  // Written left to right: kept, and not the renderer's choice, so no data-dir.
  assert.equal(drawn((await compile(pipeline(head, ' dir=LR'))).html).dir, null);
  const wideFlow = `${head}\n\ndiagram w\nw: a -> b, c, d, e\n`;
  assert.equal(drawn((await compile(wideFlow)).html).dir, null);
});

test("the phone drawing keeps the diagram's own direction when the desktop one is chosen left to right", async () => {
  const html = (await compile(pipeline('# T\n\nkpi Builds | 412 | | ok'))).html;
  const phone = /<div class="dg-v"[^>]*><svg class="dg[^"]*"[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html);
  assert.ok(phone, 'a phone drawing');
  assert.ok(Number(phone[1]) < Number(phone[2]), 'taller than wide, as a top-to-bottom drawing of this flow is');
  const doc = (await compile(pipeline('@width narrow\n# T\n\nkpi Builds | 412 | | ok'))).html;
  assert.equal(/<div class="dg-v"[\s\S]*$/.exec(html)?.[0], /<div class="dg-v"[\s\S]*$/.exec(doc)?.[0]);
});

// ---- the grid in a browser -----------------------------------------------------------------------------------------------------

const GRIDS = `# Grids

data t = month,v; Jan,3; Feb,5; Mar,4

grid 2
chart bar t title="A"
chart line t title="B"

grid 3
chart bar t title="A"
chart line t title="B"
chart bar t title="C"

grid 4
chart bar t title="A"
chart line t title="B"
chart bar t title="C"
chart bar t title="D"
`;

browserTest('a dashboard grid keeps its cells at 420px or more: two across from 888px, one below', async (browser) => {
  const html = (await compile(GRIDS)).html;
  for (const [width, want] of [
    [360, 1],
    [720, 1],
    [887, 1],
    [888, 2],
    [1280, 2],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.setContent(html);
    const got = await page.evaluate(() =>
      [...document.querySelectorAll('.lgrid')].map((g) => ({
        cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
        cell: Math.round(g.firstElementChild!.getBoundingClientRect().width),
        scroll: document.documentElement.scrollWidth,
      })),
    );
    await ctx.close();
    assert.equal(got.length, 3);
    for (const g of got) {
      assert.equal(g.cols, want, `${width}px: columns`);
      assert.equal(g.scroll, width, `${width}px: no sideways scroll`);
      if (g.cols > 1) assert.ok(g.cell >= 420, `${width}px: cell ${g.cell}px`);
    }
  }
});

browserTest('a grid on a page that is not a dashboard stacks at 720px as before', async (browser) => {
  const html = (await compile(`@width narrow\n${GRIDS}`)).html;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.setContent(html);
  const cols = () =>
    page.evaluate(() => [...document.querySelectorAll('.lgrid')].map((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length));
  assert.deepEqual(await cols(), [2, 3, 4]);
  await page.setViewportSize({ width: 720, height: 900 });
  assert.deepEqual(await cols(), [1, 1, 1]);
  await ctx.close();
});

browserTest(
  'no dashboard page scrolls sideways at 360px, 400px or 1280px',
  async (browser) => {
    const bad: string[] = [];
    const pages = tracked().filter((f) => f.startsWith('examples/') && classOf(readFileSync(`${root}${f}`, 'utf8')) === 'dashboard');
    assert.ok(pages.length >= 40, `dashboard examples: ${pages.length}`);
    for (const width of [360, 400, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      for (const f of pages) {
        await page.setContent((await compile(readFileSync(`${root}${f}`, 'utf8'), { loadFile })).html);
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scroll > width) bad.push(`${f} @${width}: scrollWidth ${scroll}`);
      }
      await ctx.close();
    }
    assert.deepEqual(bad, []);
  },
  300_000,
);
