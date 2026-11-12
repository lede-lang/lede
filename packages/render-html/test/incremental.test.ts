// The incremental renderer (internal spec, lede-lang/meta): pre-settle DOM equality with `render()` (Req 2.2), ids (2.3), render
// counts (2.4), the prose latch (2.5), the `shift`, `lead` and picks rules, placeholders and drawings (2.6), `data +=` (2.7),
// the lazy layout engine (2.9), the hold rule (2.10), and an early layout-shift check in Chromium (skipped without one).
// Every test runs with `settle: false`, so it proves the incremental path itself, not the correction at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LedeStream, parse, type StreamEvent } from '@lede-lang/core';
import { Ctx, type IncrementalOp, createIncremental, render, setLayoutEngine } from '../src/index.ts';
import { drive, normalize, StringModel, type Driven } from '../../../bench/src/incremental-model.ts';
import { benchPages, measure, summarize, summaryText } from '../../../bench/src/incremental-report.ts';
import { browserTest } from './chrome.ts';
import type { Page } from '../../../bench/node_modules/playwright-core/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const loadFile = () => 'a,b\n1,2';
const parseOpts = { loadFile };

/** The `<main>` of the whole-page render of `src`, normalized. */
async function whole(src: string): Promise<string> {
  return normalize(await render(parse(src, parseOpts), { fragment: true }));
}
/** The `<main>` the model holds after streaming, normalized. */
const streamed = (d: Driven): string => normalize(d.model.main());

function lede(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.lede'))
    .map((f) => join(dir, f))
    .toSorted();
}
const read = (f: string) => readFileSync(join(root, f), 'utf8');
// ---- text for fixtures ---------------------------------------------------------------------------------------------------------

const SENTENCES = [
  'The team reviewed the figures again before the quarterly meeting and found the same pattern as in the spring.',
  'Nothing in the data suggests that the change came from one region or one customer segment alone.',
  'We kept the old process running in parallel for six weeks, which made the comparison fair but the work slow.',
  'Support tickets about billing fell by a third, while questions about the new dashboard roughly doubled.',
  'The remaining risk is mostly organizational: two teams still own parts of the same workflow.',
  'None of this was obvious at the start, and a few of our early assumptions turned out to be wrong.',
];
const sentences = (n: number, from = 0) => Array.from({ length: n }, (_, i) => SENTENCES[(from + i) % SENTENCES.length]).join(' ');

// ---- Req 2.2: pre-settle equality ----------------------------------------------------------------------------------------------

test('examples: the streamed page equals the whole-page render before any settle, at chunks of 1, 7 and 64 bytes', async () => {
  const files = lede('examples');
  assert.ok(files.length >= 60, `examples found: ${files.length}`);
  for (const f of files) {
    const src = read(f);
    const expected = await whole(src);
    for (const chunk of [1, 7, 64]) {
      const d = await drive(src, { chunk, parse: parseOpts });
      assert.equal(streamed(d), expected, `${f} at chunks of ${chunk}`);
      assert.equal(d.end.equal, true, `${f}: the report agrees with the model`);
      assert.equal(d.end.regroups, 0, `${f}: regroups`);
      assert.equal(d.end.lateMeta, 0, `${f}: late meta`);
    }
  }
});

test('the 180 v0.4 pages: pre-settle equality, settle causes, regroups, late meta and hold latency (the report of bench/src/incremental-report.ts)', async () => {
  const files = benchPages();
  assert.equal(files.length, 180);
  // The same measurement the report prints, at the report's default arrival rate (4 characters every 20 ms).
  const rows = await measure(files);
  const s = summarize(rows);
  console.log(
    `incremental renderer over the 180 v0.4 pages\n${summaryText(rows)}\n  misses: ${rows
      .filter((r) => !r.equal)
      .map((r) => `${r.page} ${r.causes.join('+')} first ${r.firstDiff}`)
      .join('; ')}`,
  );
  for (const r of rows) assert.equal(r.reported, r.equal, `${r.page}: the renderer's report agrees with the string model`);
  assert.ok(s.rate >= 0.95, `pre-settle equality ${s.equal}/${s.pages}`);
  // Every miss has a cause the rules name, and a page that is equal reports none.
  for (const r of rows) assert.equal(r.equal, r.causes.length === 0 && r.settled === 0, `${r.page}: causes ${r.causes.join(',')}`);
  assert.equal(s.regroups, 0, 'regroups (the hold rule)');
  assert.equal(s.lateMetaPages, 0, 'no page writes meta after its first block');
  assert.equal(s.reseals, 0);
});

// ---- Req 2.3, 2.4: ids and render counts ---------------------------------------------------------------------------------------

test('a unit drawn again keeps its ids, and later units keep theirs', async () => {
  const src = [
    '# Report',
    '',
    '## Totals',
    '',
    'data d = k,v; a,1; b,2',
    'chart bar d',
    '',
    '## Totals',
    '',
    'Closing words.',
    '',
    'data d += c,3',
    '',
    '## Totals',
    '',
    'End.',
    '',
  ].join('\n');
  const d = await drive(src, { chunk: 5, parse: parseOpts });
  const html = d.model.main();
  assert.equal(streamed(d), await whole(src));
  // The three equal headings are told apart by the id the whole-page render gives them, in order.
  assert.deepEqual(
    [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]),
    ['totals', 'totals-x', 'totals-x-x'],
  );
  // The chart was drawn again for the appended rows, in place.
  assert.ok(d.model.log.some((o) => o.op === 'replace' && o.html.includes('<svg')));
});

test('every unit is appended once; a unit is drawn again only because something changed', async () => {
  for (const f of lede('examples/v04').slice(0, 12)) {
    const src = read(f);
    const d = await drive(src, { chunk: 16, parse: parseOpts });
    const appended = d.model.log.filter((o) => o.op === 'append' || o.op === 'placeholder').map((o) => o.id);
    assert.equal(new Set(appended).size, appended.length, `${f}: a unit was appended twice`);
    assert.ok(d.end.renders >= appended.length, `${f}: renders ${d.end.renders} < units ${appended.length}`);
    // The last html written for each unit is the one the page ends with (a unit right only after the settle would fail here).
    assert.equal(streamed(d), await whole(src), f);
  }
});

// ---- Req 2.5: the prose latch --------------------------------------------------------------------------------------------------

const essay = (tailItems: number) =>
  [
    '@title On staying small',
    '',
    ...[0, 1, 2, 3].flatMap((i) => [sentences(3, i), '']),
    ...Array.from({ length: tailItems }, (_, i) => `- ${sentences(1, i)} ${sentences(1, i + 2)}`),
    '',
  ].join('\n');

test('prose: an essay is set as prose from the fourth paragraph on and is not flipped mid-stream', async () => {
  const src = essay(0);
  const d = await drive(src, { chunk: 9, parse: parseOpts, settle: false });
  assert.equal(d.end.proseFlips, 1);
  assert.equal(streamed(d), await whole(src));
  assert.ok(d.model.main().startsWith('<main class="doc prose">'));
  assert.equal(d.model.log.filter((o) => o.op === 'prose').length, 1);
});

test('prose: a late run of lists makes the finished page not prose; that is one settle case, never a mid-stream flip', async () => {
  const src = essay(14);
  const off = await drive(src, { chunk: 9, parse: parseOpts, settle: false });
  assert.equal(off.end.proseFlips, 1);
  assert.deepEqual(
    off.model.log.filter((o) => o.op === 'prose').map((o) => (o.op === 'prose' ? o.on : null)),
    [true],
    'no flip back to false while streaming',
  );
  assert.equal(off.end.equal, false);
  assert.ok(off.end.causes.includes('prose'), `causes ${off.end.causes.join(',')}`);
  const on = await drive(src, { chunk: 9, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(src), 'the settle brings the page to the whole-page render');
  assert.deepEqual(
    on.model.log.filter((o) => o.op === 'prose').map((o) => (o.op === 'prose' ? o.on : null)),
    [true, false],
  );
});

test('prose: a page that shows a data-like block before four paragraphs is never prose', async () => {
  const src = ['# T', '', 'kpi A | 1 | | x', '', ...[0, 1, 2, 3, 4].flatMap((i) => [sentences(4, i), ''])].join('\n');
  const d = await drive(src, { chunk: 11, parse: parseOpts });
  assert.equal(d.end.proseFlips, 0);
  // The kpi made the page a dashboard when it arrived and the run of paragraphs after it is a section of prose, so the finished
  // page is a document: one settle case, the class (cause layout), and no unit differs.
  assert.equal(d.end.dashFlips, 1);
  assert.equal(d.end.equal, false);
  assert.deepEqual(d.end.causes, ['layout']);
  const on = await drive(src, { chunk: 11, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(src));
});

// ---- the dashboard latch (D80) -------------------------------------------------------------------------------------------------

const dashOps = (d: Driven) => d.model.log.filter((o) => o.op === 'dash').map((o) => (o.op === 'dash' ? o.on : null));

test('dashboard: the class goes on with the first block a dashboard has, once, and no unit is drawn again for it', async () => {
  const src = [
    '# T',
    '',
    'Short intro.',
    '',
    '## Numbers',
    '',
    'kpi A | 1 | | x',
    '',
    '## Table',
    '',
    'table = a,b; 1,2',
    '',
    'More text.',
    '',
  ].join('\n');
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(d.end.dashFlips, 1, `chunks of ${chunk}`);
    assert.deepEqual(dashOps(d), [true]);
    assert.equal(d.end.equal, true);
    assert.equal(streamed(d), await whole(src));
    assert.ok(d.model.main().startsWith('<main class="doc dash">'));
    // The stylesheet is the page's own until the class goes on, and carries the dashboard rules after.
    const styles = d.model.log.flatMap((o) => (o.op === 'style' ? [o.css] : []));
    assert.equal(styles.length, 2);
    assert.ok(!styles[0].includes('.doc.dash'));
    assert.ok(styles[1].includes('.doc.dash .lgrid{'));
    // The intro and the headings before the kpi are drawn once and never again.
    assert.deepEqual(
      d.model.log.filter((o) => o.op === 'replace'),
      [],
    );
  }
});

test('dashboard: @width wide is a dashboard from the first block, and @width narrow or an essay is never latched', async () => {
  const wide = await drive('@width wide\n# T\n\nShort.\n', { chunk: 5, parse: parseOpts });
  assert.equal(wide.end.dashFlips, 0);
  assert.deepEqual(dashOps(wide), [true]);
  assert.ok(wide.model.css.includes('.doc.dash .lgrid{'));
  assert.equal(streamed(wide), await whole('@width wide\n# T\n\nShort.\n'));
  const narrow = '@width narrow\n# T\n\ntable = a,b; 1,2\n';
  const n = await drive(narrow, { chunk: 5, parse: parseOpts });
  assert.deepEqual([n.end.dashFlips, dashOps(n), n.end.equal], [0, [], true]);
  assert.equal(streamed(n), await whole(narrow));
  // An essay that is prose when a table arrives stays prose until the settle: no dashboard class on top of it.
  const d = await drive(essay(0) + '\ntable = a,b; 1,2\n', { chunk: 9, parse: parseOpts });
  assert.deepEqual([d.end.proseFlips, d.end.dashFlips], [1, 0]);
});

test('dashboard: a section of prose after the first data block takes the class off at the settle, and only the class', async () => {
  const src = ['# T', '', 'table = a,b; 1,2', '', '## Story', '', ...[0, 1, 2, 3, 4].flatMap((i) => [sentences(4, i), ''])].join('\n');
  const off = await drive(src, { chunk: 9, parse: parseOpts, settle: false });
  assert.deepEqual([off.end.dashFlips, off.end.equal, off.end.settled], [1, false, 0]);
  assert.deepEqual(off.end.causes, ['layout']);
  const on = await drive(src, { chunk: 9, parse: parseOpts, settle: true });
  assert.deepEqual(dashOps(on), [true, false]);
  assert.ok(!on.model.css.includes('.doc.dash'));
  assert.equal(streamed(on), await whole(src));
});

test('dashboard: a card, grid or flow diagram drawn after the class went on is the unit the whole-page render draws', async () => {
  const src = [
    '# T',
    '',
    'table = a,b; 1,2',
    '',
    'data t = m,v; Jan,3; Feb,5',
    '',
    'grid 3',
    'chart bar t',
    'chart line t',
    'chart bar t',
    '',
    'diagram p',
    'p: a "A"',
    'p: b "B"',
    'p: c "C"',
    'p: d "D"',
    'p: a -> b -> c -> d',
    '',
  ].join('\n');
  for (const chunk of [3, 40]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(d.end.equal, true, `chunks of ${chunk}`);
    assert.equal(streamed(d), await whole(src));
    assert.ok(d.model.main().includes('data-dir="LR"'));
  }
});

// ---- the shift, lead and picks rules ------------------------------------------------------------------------------------------

test('shift: an @title page whose headings start at ## is read as having no # of its own', async () => {
  const src = ['@title Plans', '', 'Intro.', '', '## One', '', 'Text.', '', '## Two', '', 'More.', ''].join('\n');
  const d = await drive(src, { chunk: 7, parse: parseOpts });
  assert.equal(d.end.shiftAssumed, true);
  assert.equal(d.end.equal, true);
  assert.equal(streamed(d), await whole(src));
});

test('shift: a # heading that differs from the @title shifts every heading, and nothing is settled', async () => {
  const src = ['@title Plans', '', '# Intro heading', '', 'Text.', '', '## One', '', 'More.', ''].join('\n');
  const d = await drive(src, { chunk: 7, parse: parseOpts });
  assert.equal(d.end.shiftAssumed, false);
  assert.equal(d.end.equal, true);
  assert.equal(streamed(d), await whole(src));
  assert.match(d.model.main(), /<h3 id="one">/);
});

test('shift: a # heading that arrives after a ## on an @title page is one settle case (cause shift)', async () => {
  const src = ['@title Plans', '', 'Intro.', '', '## One', '', 'Text.', '', '# Later heading', '', 'More.', ''].join('\n');
  const off = await drive(src, { chunk: 7, parse: parseOpts });
  assert.equal(off.end.shiftAssumed, true);
  assert.equal(off.end.equal, false);
  assert.ok(off.end.causes.includes('shift'), `causes ${off.end.causes.join(',')}`);
  assert.equal(off.end.countMismatch, false);
  const on = await drive(src, { chunk: 7, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(src));
});

test('lead: a short first paragraph after the title is the standfirst, a long one on an essay is a settle case', async () => {
  const short = ['@title Notes', '@subtitle for the record', '', 'A short opening line.', '', sentences(2), ''].join('\n');
  const d = await drive(short, { chunk: 7, parse: parseOpts });
  assert.equal(d.end.equal, true);
  assert.match(d.model.main(), /<p class="lead">A short opening line\.<\/p>/);

  // 400 characters up front, then enough paragraphs to latch prose: the lead is known only after the paragraph is on the page.
  const opening = sentences(4);
  assert.ok(opening.length > 360);
  const long = ['@title Notes', '@subtitle for the record', '', opening, '', ...[1, 2, 3, 4].flatMap((i) => [sentences(3, i), ''])].join(
    '\n',
  );
  const off = await drive(long, { chunk: 7, parse: parseOpts });
  assert.equal(off.end.equal, false);
  assert.deepEqual(off.end.causes, ['lead']);
  const on = await drive(long, { chunk: 7, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(long));
});

test('picks: a recommendation written after the table it points at draws the table again, once', async () => {
  const src = [
    '@title Storage',
    '',
    '## Options',
    '',
    'data opts = Option,Cost,Latency; Postgres,low,fast; DynamoDB,high,fast; S3,low,slow',
    'table opts',
    '',
    '## Recommendation',
    '',
    'Use Postgres because it is the cheapest of the fast options.',
    '',
  ].join('\n');
  const d = await drive(src, { chunk: 6, parse: parseOpts });
  assert.equal(d.end.repicks, 1);
  assert.equal(d.end.equal, true);
  assert.equal(streamed(d), await whole(src));
  assert.equal(d.model.log.filter((o) => o.op === 'replace').length, 1);
});

// ---- Req 2.6, 2.7: diagrams and data -------------------------------------------------------------------------------------------

const FLOW = ['diagram f dir=LR title="Flow"', 'f: a "Alpha"', 'f: b "Beta"', 'f: c "Gamma"', 'f: a -> b', 'f: b -> c', ''].join('\n');

test('a flow diagram is a placeholder first and the drawing after, in the same slot', async () => {
  const src = ['# D', '', 'Before.', '', FLOW, 'After the diagram.', ''].join('\n');
  const d = await drive(src, { chunk: 8, parse: parseOpts });
  const log = d.model.log;
  const ph = log.findIndex((o) => o.op === 'placeholder');
  assert.ok(ph >= 0, 'a placeholder op');
  const p = log[ph];
  assert.ok(
    p.op === 'placeholder' && /class="viz dg-fig(?: wide)? pending"/.test(p.html) && p.html.includes('min-height:') && p.minHeight > 0,
  );
  const drawn = log.findIndex((o, i) => i > ph && o.op === 'replace' && o.id === p.id && o.html.includes('<svg'));
  assert.ok(drawn > ph, 'the drawing replaces the placeholder');
  const r = log[drawn];
  assert.ok(r.op === 'replace' && r.html.includes('<svg') && !r.html.includes('pending'));
  assert.equal(streamed(d), await whole(src));
  assert.ok(d.end.placeholderError.length >= 1);
});

test('a flow diagram that grows keeps its slot at least as tall as before; a sequence diagram draws at its seal', async () => {
  const src = [
    'diagram f',
    'f: a "A"',
    'f: b "B"',
    'f: a -> b',
    '',
    'Between.',
    '',
    'f: b -> c',
    'f: c -> d',
    'f: d -> e',
    'f: e -> g',
    '',
    '# Next',
    '',
    'diagram s sequence',
    's: u "User" user',
    's: a "App" svc',
    's: u -> a : hello',
    's: a -> u : ok',
    '',
    'Done.',
    '',
  ].join('\n');
  const d = await drive(src, { chunk: 3, parse: parseOpts });
  const slots = new Map<number, number[]>();
  for (const o of d.model.log) {
    if ((o.op === 'placeholder' || o.op === 'replace') && o.html.includes('pending')) {
      slots.set(o.id, [...(slots.get(o.id) ?? []), Number(/min-height:(\d+)px/.exec(o.html)?.[1] ?? 0)]);
    }
  }
  assert.ok(slots.size >= 2, 'both diagrams were shown as slots');
  for (const [id, mins] of slots)
    assert.deepEqual(
      mins,
      mins.toSorted((a, b) => a - b),
      `unit ${id}: min-height never shrinks`,
    );
  assert.ok(d.end.reseals >= 1, `reseals ${d.end.reseals}`);
  assert.equal(streamed(d), await whole(src));
  // The sequence diagram needed no placeholder once it was sealed: its first op that is not a slot already holds the drawing.
  assert.ok(d.model.main().includes('<svg'));
});

test('data +=: every chart, table and kpi row that reads the name is drawn again; the page ends equal to the whole-page render', async () => {
  const src = [
    '# Spend',
    '',
    'data d = k,v; a,1; b,2',
    'chart bar d',
    '',
    'table d',
    '',
    'kpi Total | =d.v | | sum',
    '',
    'data d += c,3',
    '',
    'Closing.',
    '',
  ].join('\n');
  const d = await drive(src, { chunk: 4, parse: parseOpts });
  const replaces = d.model.log.filter((o) => o.op === 'replace');
  assert.ok(replaces.length >= 2, `replaces ${replaces.length}`);
  assert.equal(streamed(d), await whole(src));
});

test('tail: every block that has arrived is on the page, held sections included', async () => {
  const faq = ['## Why?', '', 'Because.', '', '## How?', '', 'Like this.', '', '## When?', '', 'Now.', '', '## Where?', '', 'Here.', ''];
  const src = ['# T', '', 'Intro.', '', ...faq, '## Contact', '', 'Mail us.', ''].join('\n');
  const d = await drive(src, { chunk: 1, parse: parseOpts });
  assert.equal(streamed(d), await whole(src));
  assert.equal(d.end.regroups, 0);
  // The FAQ is one unit, appended once, after its fourth question was complete: nothing replaced it.
  const faqOps = d.model.log.filter((o) => (o.op === 'append' || o.op === 'replace') && o.html.includes('class="faqs"'));
  assert.equal(faqOps.length, 1);
  assert.ok(d.end.holdMs.length > 0);
  // While it waited, its headings were on the page in the tail.
  const tails = d.model.log.filter((o) => o.op === 'tail' && o.html.includes('How?'));
  assert.ok(tails.length > 0, 'held headings were shown in the tail');
});

// ---- Req 2.9: the lazy layout engine ------------------------------------------------------------------------------------------

test('the layout engine is a module singleton a host can replace, and a page without a flow diagram never calls it', async () => {
  let calls = 0;
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new (ELK as unknown as new () => { layout: (g: unknown) => Promise<unknown> })();
  setLayoutEngine((g) => {
    calls++;
    return elk.layout(g);
  });
  await drive('# T\n\nJust words.\n\n```\ncode\n```\n', { chunk: 5, parse: parseOpts });
  assert.equal(calls, 0, 'no layout for a text-only page');
  await drive(['# T', '', FLOW].join('\n'), { chunk: 5, parse: parseOpts });
  assert.ok(calls >= 1, 'the installed engine did the layout');
});

test('elkjs is not loaded until a flow diagram is laid out', () => {
  const code = `
    import { createRequire } from 'node:module';
    import { compile } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
    const cache = createRequire(import.meta.url).cache;
    const loaded = () => Object.keys(cache).some((k) => k.includes('elk.bundled'));
    await compile('# T\\n\\nWords only.\\n');
    const before = loaded();
    await compile('# T\\n\\ndiagram f\\nf: a "A"\\nf: b "B"\\nf: a -> b\\n');
    console.log(JSON.stringify({ before, after: loaded() }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out.trim().split('\n').at(-1)!), { before: false, after: true });
});

// ---- code review of PR #31 ---------------------------------------------------------------------------------------------------

test('an empty flow diagram has no slot to leave behind: sealed while its unit was held, or at the end of the stream', async () => {
  const held = ['## Why?', '', 'diagram flow', '', 'Some text', ''].join('\n');
  for (const chunk of [1, 5, 64]) {
    const d = await drive(held, { chunk, parse: parseOpts });
    assert.doesNotMatch(d.model.main(), /pending/, `chunk ${chunk}`);
    assert.equal(streamed(d), await whole(held), `chunk ${chunk}`);
    assert.equal(d.end.equal, true, `chunk ${chunk}`);
  }
  const open = ['# T', '', 'diagram flow', ''].join('\n');
  const d = await drive(open, { chunk: 3, parse: parseOpts });
  assert.doesNotMatch(d.model.main(), /pending/);
  assert.equal(streamed(d), await whole(open));
});

test('masthead: an @title that a later # heading repeats leaves the page without a header; only the header and the standfirst are settled', async () => {
  const src = ['@title Plan', '', 'Intro text.', '', '# Plan', '', 'More.', ''].join('\n');
  const off = await drive(src, { chunk: 7, parse: parseOpts });
  assert.equal(off.end.equal, false);
  assert.equal(off.end.countMismatch, false);
  assert.deepEqual(off.end.causes, ['masthead', 'lead']);
  assert.equal(off.end.settled, 2);
  const on = await drive(src, { chunk: 7, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(src));
  assert.doesNotMatch(on.model.main(), /<header/);
});

test('masthead: with no @title, the subtitle and byline follow the first # heading wherever it comes; the settle replaces that heading, not the page', async () => {
  const src = ['@subtitle A sub', '@author Ann', '', 'Intro text.', '', '# Heading', '', 'More.', '', 'Last.', ''].join('\n');
  const off = await drive(src, { chunk: 7, parse: parseOpts });
  assert.equal(off.end.equal, false);
  assert.equal(off.end.countMismatch, false, 'the subtitle and byline are part of the heading unit, not children of their own');
  assert.deepEqual(off.end.causes, ['masthead', 'lead', 'masthead']);
  assert.equal(off.end.settled, 3);
  const on = await drive(src, { chunk: 7, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(src));
  assert.ok(!on.model.log.some((o) => o.op === 'remove'), 'no unit was removed');
  assert.ok(
    on.model.log.filter((o) => o.op === 'replace').length <= 3,
    'the first paragraph and the heading are drawn again; the units after them are left alone',
  );
  // The heading is last: the subtitle and byline are children after it, and the page still equals the whole-page render.
  const last = ['@subtitle A sub', '', 'Intro text.', '', '# Heading', ''].join('\n');
  const end = await drive(last, { chunk: 7, parse: parseOpts, settle: true });
  assert.equal(streamed(end), await whole(last));
  assert.equal(end.end.countMismatch, false);
});

test('grouped units: a kpi that reads a data name shows the rows so far, and is drawn again when they change', async () => {
  const faq = (between: string[]) =>
    [
      '# T',
      '',
      'data d = k,v; a,1; b,2',
      '',
      '## Why?',
      '',
      'kpi Total | =d.v | | sum',
      '',
      '## How?',
      '',
      'Like this.',
      '',
      '## When?',
      '',
      'Now.',
      '',
      ...between,
      '# Closing',
      '',
      'Done.',
      '',
    ].join('\n');
  // Rows appended while the FAQ is still held: it is drawn once, with them.
  const held = faq(['data d += c,3', '']);
  const a = await drive(held, { chunk: 5, parse: parseOpts });
  assert.equal(a.end.equal, true);
  assert.equal(streamed(a), await whole(held));
  const drawn = a.model.log.filter((o) => (o.op === 'append' || o.op === 'replace') && o.html.includes('class="faqs"'));
  assert.ok(
    drawn.length >= 1 && drawn.every((o) => 'html' in o && o.html.includes('<span class="kv">3</span>')),
    'the value is on the first drawing',
  );
  // Rows appended after the FAQ was committed: it is drawn again.
  const later = faq([]) + ['', 'data d += c,3', '', 'End.', ''].join('\n');
  const b = await drive(later, { chunk: 5, parse: parseOpts });
  assert.equal(b.end.equal, true);
  assert.equal(streamed(b), await whole(later));
  assert.ok(b.model.log.some((o) => o.op === 'replace' && o.html.includes('class="faqs"') && o.html.includes('<span class="kv">3</span>')));
  // The same inside cards, which `view` already reached, and a set.
  const set = [
    '# T',
    '',
    'data d = k,v; a,1; b,2',
    '',
    ...['One', 'Two', 'Three'].flatMap((n) => [`## ${n}`, '', `Short ${n}.`, '']),
    'data d += c,3',
    '',
  ].join('\n');
  assert.equal(streamed(await drive(set, { chunk: 5, parse: parseOpts })), await whole(set));
});

test('a data name defined after the kpi that reads it draws that kpi again', async () => {
  const src = ['# T', '', 'kpi Total | =d.v | | sum', '', 'data d = k,v; a,1; b,2', '', 'Closing.', ''].join('\n');
  const d = await drive(src, { chunk: 5, parse: parseOpts });
  assert.equal(d.end.equal, true);
  assert.equal(streamed(d), await whole(src));
});

test('a unit the incremental side lacks is named from the whole-page render: a heading that a late @title shifts is the shift', async () => {
  const src = ['# Intro', '', '@title Other', ''].join('\n');
  const d = await drive(src, { chunk: 4, parse: parseOpts });
  assert.equal(d.end.countMismatch, true);
  assert.deepEqual(d.end.causes, ['shift']);
  const on = await drive(src, { chunk: 4, parse: parseOpts, settle: true });
  assert.equal(streamed(on), await whole(src));
});

/** Feed `src` to a stream and a renderer by hand, keeping every drawing that is pending. */
function feed(src: string, opts: { settle?: boolean } = {}) {
  const stream = new LedeStream(parseOpts);
  const inc = createIncremental(
    () => stream.doc.meta,
    () => stream.doc.data,
    { settle: false, ...opts },
  );
  const pending: Promise<IncrementalOp[]>[] = [];
  const take = (r: { pending?: Promise<IncrementalOp[]> }) => r.pending && pending.push(r.pending);
  const handle = (e: StreamEvent) => {
    if (e.kind === 'block') take(inc.push(e.block));
    else if (e.kind === 'seal' || e.kind === 'bucket-seal' || e.kind === 'decision-seal') take(inc.seal(e.block));
    else if ('data' in e) take(inc.update({ data: e.data }));
    else take(inc.update(e.block));
  };
  for (const e of stream.events(src)) handle(e);
  stream.end(handle);
  return { inc, pending };
}

test('a drawing that has settled is not kept: only the ones in flight are, and end() waits for them', async () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    [`diagram g${i}`, `g${i}: a "A"`, `g${i}: b "B"`, `g${i}: a -> b`, '', `Paragraph ${i}.`, ''].join('\n'),
  ).join('\n');
  const { inc, pending } = feed(many);
  assert.ok(pending.length >= 6, `drawings started: ${pending.length}`);
  await Promise.all(pending);
  const kept = (inc as unknown as { drawings: { size: number } }).drawings;
  assert.equal(kept.size, 0, 'nothing is kept once every drawing has resolved');
  await inc.end();

  // A drawing still in flight at end(): the settle compares the finished drawing, so the page is equal.
  const again = feed(many, { settle: true });
  const end = await again.inc.end();
  assert.equal(end.equal, true);
  assert.equal(end.settled, 0);
});

test('layouts are cached only for the incremental renderer: plain render() never serializes a diagram, the settle reuses the layout', async () => {
  const page = ['# T', '', FLOW].join('\n');
  const stringify = JSON.stringify;
  let diagrams = 0;
  JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
    if (typeof value === 'object' && value !== null && (value as { type?: string }).type === 'diagram') diagrams++;
    return (stringify as (...a: unknown[]) => string)(value, ...rest);
  }) as typeof JSON.stringify;
  try {
    await render(parse(page, parseOpts));
  } finally {
    JSON.stringify = stringify;
  }
  assert.equal(diagrams, 0, 'render() serialized a diagram for a cache it cannot hit');

  let calls = 0;
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new (ELK as unknown as new () => { layout: (g: unknown) => Promise<unknown> })();
  setLayoutEngine((g) => {
    calls++;
    return elk.layout(g);
  });
  await render(parse(page, parseOpts));
  const plain = calls;
  assert.ok(plain >= 1);
  calls = 0;
  const d = await drive(page, { chunk: 5, parse: parseOpts, settle: true });
  const streamedCalls = calls;
  assert.equal(streamed(d), await whole(page));
  assert.equal(d.end.renders >= 2, true, 'the diagram was drawn more than once');
  assert.equal(streamedCalls, plain, 'the page was laid out once; the settle drew it again from that layout');
});

test('Ctx.mark and rewind copy nothing, and a rewind can go forward again to a later mark', () => {
  const heads = Array.from({ length: 400 }, (_, i) => ({
    type: 'heading' as const,
    level: 2 as const,
    text: `Section ${i % 40}`,
    line: i + 1,
  }));
  const doc = { meta: {}, blocks: heads, data: {}, diagnostics: [] };
  const draw = (ctx: Ctx, hs: typeof heads) => hs.map((h) => ctx.blockSync(h, true));

  const fresh = draw(new Ctx(doc, {}), [...heads, heads[0]]);
  const ctx = new Ctx(doc, {});
  const first = draw(ctx, heads.slice(0, 200));
  const a = ctx.mark();
  const second = draw(ctx, heads.slice(200));
  const b = ctx.mark();
  assert.deepEqual([...first, ...second], fresh.slice(0, 400));

  // Back to the middle and draw the second half again: the same ids. Then forward to the end: nothing is taken twice.
  ctx.rewind(a);
  assert.deepEqual(draw(ctx, heads.slice(200)), second);
  ctx.rewind(b);
  assert.equal(draw(ctx, [heads[0]])[0], fresh[400]);
  assert.match(fresh[400], /id="section-0(-x){10}"/);

  const RealSet = globalThis.Set;
  let copies = 0;
  globalThis.Set = class<T> extends RealSet<T> {
    constructor(items?: Iterable<T> | null) {
      super(items);
      if (this.size > 100) copies++;
    }
  };
  try {
    for (let i = 0; i < 50; i++) ctx.rewind(ctx.mark());
  } finally {
    globalThis.Set = RealSet;
  }
  assert.equal(copies, 0, 'mark/rewind copied the set of heading ids');
});

// ---- the question words (spec §4.18) -------------------------------------------------------------------------------------------

/** The `<style>` of the whole-page render of `src`. */
async function wholeStyle(src: string): Promise<string> {
  return /<style>([\s\S]*?)<\/style>/.exec(await render(parse(src, parseOpts)))![1];
}
const exportsIn = (html: string): string[] => html.match(/<figure class="q-x"[\s\S]*?<\/figure>/g) ?? [];
const stylesOf = (d: Driven) => d.model.log.filter((o) => o.op === 'style');

const QUESTIONS = [
  '@title Release go/no-go',
  '',
  '# Release go/no-go',
  '',
  'Four answers are needed before the window opens.',
  '',
  'ask owner | Who signs off on this release?',
  'choose risk | low, medium, high',
  'confirm migration | The migration ran on staging and rolled back cleanly',
  'ask notes lines=3 | Anything the release notes should carry?',
  '',
  'export json',
  'export markdown',
  '',
].join('\n');

test('questions: each field and each export is a block of its own, drawn as render() draws it, at chunks of 1, 7 and 64 bytes', async () => {
  const expected = await whole(QUESTIONS);
  for (const chunk of [1, 7, 64]) {
    const d = await drive(QUESTIONS, { chunk, parse: parseOpts });
    assert.equal(streamed(d), expected, `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
    assert.equal(d.end.renders, d.model.units.length, 'nothing was drawn twice');
  }
  // The style is the plain one from the first block, and the one with the controls' rules from the first field on: twice, not more.
  const d = await drive(QUESTIONS, { chunk: 7, parse: parseOpts });
  assert.equal(stylesOf(d).length, 2);
  assert.equal(d.model.css, await wholeStyle(QUESTIONS));
  // A page that opens with a field has the controls' rules in its first style.
  const first = 'ask a | Who?\n';
  assert.equal(stylesOf(await drive(first, { parse: parseOpts })).length, 1);
});

test('questions: an export written before its fields lists them once they arrive, in place, and the ids do not move', async () => {
  const src = [
    '# Answers',
    '',
    'export json',
    '',
    '## Section',
    '',
    'ask a | First?',
    '',
    'choose b | x, y',
    '',
    '## Section',
    '',
    'confirm c | Sure?',
    '',
  ].join('\n');
  const d = await drive(src, { chunk: 5, parse: parseOpts });
  assert.equal(streamed(d), await whole(src), 'the finished page, before any settle');
  assert.equal(d.end.equal, true);
  // The export was drawn when it arrived, with no field to list, and again for each field that came after it.
  const drawn = d.model.log.filter((o) => (o.op === 'append' || o.op === 'replace') && o.html.includes('class="q-x"'));
  assert.equal(drawn.length, 4, 'once on arrival, then once for each of the three fields');
  assert.match(drawn[0].op === 'append' ? drawn[0].html : '', /&quot;answers&quot;: \{\}/);
  assert.match(exportsIn(d.model.main())[0], /&quot;a&quot;: &quot;&quot;[\s\S]*&quot;b&quot;: null[\s\S]*&quot;c&quot;: &quot;open&quot;/);
  // The headings after it keep the ids the whole page gives them.
  assert.deepEqual(
    [...d.model.main().matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]),
    ['section', 'section-x'],
  );
});

test('questions: a field after the last export, and a title that comes from a later # heading, draw the export again', async () => {
  // No @title, and the first # heading is not the first block: the export's page is that heading, which has not arrived yet.
  const src = ['Intro words.', '', 'ask a | First?', '', 'export markdown', '', '# Late title', '', 'confirm b | Sure?', ''].join('\n');
  const d = await drive(src, { chunk: 4, parse: parseOpts });
  assert.equal(streamed(d), await whole(src));
  assert.deepEqual(exportsIn(d.model.main()), exportsIn(await whole(src)));
  assert.match(exportsIn(d.model.main())[0], /# Late title/);
  assert.match(exportsIn(d.model.main())[0], /- b: open/);
});

test('questions: an @title written after the export is in the export at the end, without the settle', async () => {
  const src = ['ask a | First?', '', 'export json', '', '@title Late meta', ''].join('\n');
  const d = await drive(src, { chunk: 6, parse: parseOpts, settle: false });
  assert.equal(d.end.lateMeta, 1);
  assert.deepEqual(exportsIn(d.model.main()), exportsIn(await whole(src)));
  assert.match(exportsIn(d.model.main())[0], /&quot;page&quot;: &quot;Late meta&quot;/);
});

test('questions: the controls reach the stylesheet when the first field or export arrives, and a page without them keeps the plain one', async () => {
  const late = ['# Plain page', '', 'Some words first.', '', 'ask a | Who?', ''].join('\n');
  const a = await drive(late, { chunk: 7, parse: parseOpts });
  assert.equal(stylesOf(a).length, 2, 'the plain style, then the style with the controls');
  assert.equal(a.model.css, await wholeStyle(late));
  assert.ok(a.model.css.length > (stylesOf(a)[0] as { css: string }).css.length);
  const none = ['# Plain page', '', 'Some words first.', ''].join('\n');
  const b = await drive(none, { chunk: 7, parse: parseOpts });
  assert.equal(stylesOf(b).length, 1);
  assert.equal(b.model.css, await wholeStyle(none));
  // An export alone is enough, and so is a field that sits in a grid that is still open when it is the first to arrive.
  const onlyExport = ['# Page', '', 'export json', ''].join('\n');
  assert.equal((await drive(onlyExport, { parse: parseOpts })).model.css, await wholeStyle(onlyExport));
  const grid = ['# Page', '', 'grid 2', 'ask a | Who?', 'confirm b | Sure?', ''].join('\n');
  const g = await drive(grid, { chunk: 9, parse: parseOpts });
  assert.equal(g.model.css, await wholeStyle(grid));
  assert.equal(streamed(g), await whole(grid));
});

test('questions: the tail shows an open grid of fields with the export beside it listing them, then drops them', async () => {
  const stream = new LedeStream(parseOpts);
  const inc = createIncremental(
    () => stream.doc.meta,
    () => stream.doc.data,
    { settle: false },
  );
  const put = (text: string) => {
    for (const e of stream.events(text)) if (e.kind === 'block') inc.push(e.block);
    return inc.tail(stream.tail());
  };
  put('# Page\n\n');
  const ops = put('grid 3\nask a | Who?\nexport json\n');
  const tail = ops.find((o) => o.op === 'tail');
  assert.ok(tail?.op === 'tail');
  assert.match(tail.html, /class="q q-ask"/);
  assert.match(tail.html, /&quot;a&quot;: &quot;&quot;/, "the open grid's field is in its export");
  assert.ok(ops.some((o) => o.op === 'style'));
  // Closed, the grid is a block: the field is added for good, once.
  put('confirm c | Sure?\n');
  const d = await inc.end();
  assert.equal(d.equal, true);
});

test('questions: `shell` has no effect on the incremental renderer, which draws what render() draws for a fragment', async () => {
  const withShell = await drive(QUESTIONS, { chunk: 9, parse: parseOpts, shell: true });
  assert.equal(streamed(withShell), await whole(QUESTIONS));
  assert.doesNotMatch(withShell.model.main(), /q-clear|q-bar|<script/);
  assert.equal(withShell.model.css, await wholeStyle(QUESTIONS));
});

test('questions: the settle changes nothing on a page the rules already got right', async () => {
  for (const src of [QUESTIONS, read('examples/parity/questions.lede')]) {
    const d = await drive(src, { chunk: 11, parse: parseOpts, settle: true });
    assert.equal(d.end.settled, 0);
    assert.equal(streamed(d), await whole(src));
  }
});

// ---- the editor words (spec §4.19) ---------------------------------------------------------------------------------------------

const EDITOR_PAGES = ['examples/parity/editors.lede', 'examples/parity/editors-large.lede'];
const EDITOR_RULES = '/* editor words */';
type Drawn = Extract<IncrementalOp, { op: 'append' | 'replace' | 'placeholder' }>;
/** Every drawing of a unit (appended or drawn again) whose markup holds `part`. */
const drawings = (d: Driven, part: string): Drawn[] =>
  d.model.log.filter((o): o is Drawn => (o.op === 'append' || o.op === 'replace') && o.html.includes(part));

test('editors: the two parity pages stream into the whole-page render before any settle, at chunks of 1, 7 and 64 bytes', async () => {
  for (const f of EDITOR_PAGES) {
    const src = read(f);
    const expected = await whole(src);
    const style = await wholeStyle(src);
    assert.match(style, /\/\* editor words \*\//, `${f} draws the editor words`);
    for (const chunk of [1, 7, 64]) {
      const d = await drive(src, { chunk, parse: parseOpts });
      assert.equal(streamed(d), expected, `${f} at chunks of ${chunk}`);
      assert.equal(d.model.css, style, `${f} @${chunk}: the stylesheet`);
      // Nothing for the settle to name: no cause, no child replaced, no unit grouped differently, no late meta.
      assert.equal(d.end.equal, true, `${f} @${chunk}`);
      assert.deepEqual([d.end.settled, d.end.causes, d.end.regroups, d.end.lateMeta, d.end.reseals], [0, [], 0, 0, 0], `${f} @${chunk}`);
      // The pre-settle page is what a viewer shows: with the settle on, nothing is added to it.
      const settled = await drive(src, { chunk, parse: parseOpts, settle: true });
      assert.equal(streamed(settled), expected);
      assert.equal(settled.end.settled, 0);
    }
  }
});

test('editors: param, toggle, preset and template are final blocks drawn once each; a bucket set is drawn again for each item line', async () => {
  const src = read('examples/parity/editors.lede');
  const items = src.split('\n').filter((l) => l.startsWith('triage:')).length;
  assert.equal(items, 3);
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    const drawn = drawings(d, 'q-bucket');
    assert.equal(drawn[0].op, 'append');
    assert.ok(
      drawn.slice(1).every((o) => o.op === 'replace' && o.id === drawn[0].id),
      'in place, with its own id',
    );
    const rows = drawn.map((o) => (o.html.match(/class="q-item"/g) ?? []).length);
    // Each drawing has more rows than the one before, and the last has them all. A chunk that holds several item lines is one
    // drawing, since the set already has them all when the first of its updates is applied; one line at a time, each item is one.
    assert.ok(
      rows.every((n, i) => i === 0 || n > rows[i - 1]),
      `chunks of ${chunk}: ${rows.join(',')}`,
    );
    assert.equal(rows.at(-1), items);
    if (chunk === 1) assert.deepEqual(rows, [0, 1, 2, 3]);
    // The other words took one drawing each; the exports were drawn again only for the fields and items that came before them.
    const once = (cls: string) => drawings(d, cls).length;
    for (const cls of ['q-param', 'q-toggle', 'q-tpl', 'q-preset']) assert.equal(once(`class="q ${cls}`) >= 1, true, cls);
    assert.equal(once('class="q q-param'), 1);
    assert.equal(once('class="q q-tpl'), 1);
    assert.equal(once('class="q q-preset'), 1);
    assert.equal(once('class="q q-toggle'), 2, 'two toggles');
    // Every unit is drawn once but the set (one more drawing per item line, even when the page already shows it): the renders are
    // the units, the items and nothing else.
    assert.equal(d.end.renders, d.model.units.length + items, `chunks of ${chunk}`);
  }
});

test('editors: an export written first lists each field and each bucket item as it arrives, in place, in every format', async () => {
  const src = [
    '@title Release board',
    '# Release board',
    '',
    'export json',
    'export markdown',
    'export prompt',
    '',
    'param press unit=x | Press depth | 0.94 0.85 1 0.01',
    'toggle live on | Live',
    'bucket triage | Now, Next | Where?',
    'triage: ENG-1 First | Now',
    'triage: "ENG-2 Second, then third" | Next',
    '',
    'template note | Note',
    '```text',
    'Press {press}, live {live}.',
    '```',
    '',
  ].join('\n');
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(streamed(d), await whole(src), `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
    const [json, markdown, prompt] = exportsIn(d.model.main());
    // The initial values are in the export: the number with its unit, the switch, every item under its bucket, the filled template.
    assert.match(json, /&quot;press&quot;: 0\.94/);
    assert.match(json, /&quot;live&quot;: &quot;on&quot;/);
    assert.match(json, /&quot;Now&quot;: \[\s*&quot;ENG-1 First&quot;/);
    assert.match(markdown, /- press: 0\.94 x/);
    assert.match(markdown, /  - Next: &quot;ENG-2 Second, then third&quot;/);
    assert.match(markdown, /Press 0\.94 x, live on\./);
    // The prompt lists changes from the page as written, and the page as written has none: the title, and nothing about the fields.
    assert.match(prompt, /Apply these changes to Release board:\s*No changes\./);
    assert.doesNotMatch(prompt, /press|triage|ENG-/);
    // Each export was drawn when it arrived and again for every field and every bucket item after it, and no more.
    const drawn = (fmt: string) => drawings(d, `data-x="${fmt}"`);
    for (const fmt of ['json', 'markdown'])
      assert.equal(
        drawn(fmt).length,
        1 + 6,
        `${fmt}: on arrival, then for the param, the toggle, the bucket, its two items and the template`,
      );
    // The prompt's text does not move with the fields, so it is drawn once and never replaced.
    assert.equal(drawn('prompt').length, 1);
  }
});

test('editors: the editors rules reach the stylesheet with the first editor word, and a page of question words keeps the plain controls', async () => {
  const src = [
    '# Page',
    '',
    'Some words first.',
    '',
    'ask a | Who?',
    '',
    'Between.',
    '',
    'param p | P | 1 0 2 1',
    '',
    'preset one | One | p=2',
    '',
  ].join('\n');
  const d = await drive(src, { chunk: 5, parse: parseOpts });
  assert.equal(d.model.css, await wholeStyle(src));
  const styles = stylesOf(d) as { css: string }[];
  assert.equal(styles.length, 3, 'the plain style, then the controls, then the editors');
  assert.deepEqual(
    styles.map((x) => x.css.includes(EDITOR_RULES)),
    [false, false, true],
  );
  assert.ok(styles[1].css.length > styles[0].css.length);
  // A page of question words alone never carries them.
  const q = await drive(QUESTIONS, { chunk: 7, parse: parseOpts });
  assert.equal(q.model.css.includes(EDITOR_RULES), false);
  // An editor word that is the first block of the page has them in its first style; so does one inside an open grid.
  const first = 'param p | P | 1 0 2 1\n';
  assert.equal(stylesOf(await drive(first, { parse: parseOpts })).length, 1);
  assert.equal((await drive(first, { parse: parseOpts })).model.css, await wholeStyle(first));
  const grid = ['# Page', '', 'grid 2', 'toggle a | A', 'bucket b | X, Y', ''].join('\n');
  const g = await drive(grid, { chunk: 6, parse: parseOpts });
  assert.equal(g.model.css, await wholeStyle(grid));
  assert.equal(streamed(g), await whole(grid));
});

test('editors: the tail shows an open template fence as the template with the text so far, and drops it when the fence closes', async () => {
  const stream = new LedeStream(parseOpts);
  const inc = createIncremental(
    () => stream.doc.meta,
    () => stream.doc.data,
    { settle: false },
  );
  const model = new StringModel();
  const put = (text: string) => {
    for (const e of stream.events(text)) if (e.kind === 'block') model.apply(inc.push(e.block).ops);
    model.apply(inc.tail(stream.tail()));
  };
  put('# Page\n\nask who | Who?\nparam n | N | 3 0 9 1\n\ntemplate hi | Greeting\n');
  assert.doesNotMatch(model.tail, /q-tpl/, 'the template line alone shows nothing');
  put('```text\nHello {who}');
  // The fence is open: the template is there, with no text yet. The half line is not part of it.
  assert.match(model.tail, /<figure class="q q-tpl">/);
  assert.match(model.tail, /<code><\/code>/);
  assert.match(model.tail, /<span class="q-n">0<\/span> characters/);
  put(', you asked for {n}.\n');
  assert.match(model.tail, /<figure class="q q-tpl"><figcaption class="q-t">Greeting<\/figcaption>/);
  // The slots are filled from the fields above it, as the whole page fills them: `who` is empty, so it stays as written.
  assert.match(model.tail, /<code>Hello \{who\}, you asked for 3\.\n<\/code>|<code>Hello \{who\}, you asked for 3\.<\/code>/);
  assert.match(model.tail, /<span class="q-n">\d+<\/span> characters/);
  put('More text.\n');
  assert.match(model.tail, /More text\./);
  // The closing fence returns the block: it is a unit of the page, the tail is empty, and the page is the whole-page render's.
  put('```\n\nexport json\n');
  assert.equal(model.tail, '');
  const done = await inc.end();
  assert.equal(done.equal, true);
  assert.equal(
    normalize(model.main()),
    await whole(
      '# Page\n\nask who | Who?\nparam n | N | 3 0 9 1\n\ntemplate hi | Greeting\n```text\nHello {who}, you asked for {n}.\nMore text.\n```\n\nexport json\n',
    ),
  );
});

test('editors: a bucket set in an open grid is in the tail with its items so far, and the page ends equal to the whole-page render', async () => {
  const src = ['# Page', '', 'grid 2', 'bucket b | A, B', 'b: x | A', 'b: y | B', '', 'export json', ''].join('\n');
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(streamed(d), await whole(src), `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
  }
  const stream = new LedeStream(parseOpts);
  const inc = createIncremental(
    () => stream.doc.meta,
    () => stream.doc.data,
    { settle: false },
  );
  const put = (text: string) => {
    for (const e of stream.events(text)) if (e.kind === 'block') inc.push(e.block);
    return inc.tail(stream.tail());
  };
  put('# Page\n\n');
  const ops = put('grid 2\nbucket b | A, B\nb: x | A\n');
  const tail = ops.find((o) => o.op === 'tail');
  assert.ok(tail?.op === 'tail');
  assert.equal((tail.html.match(/class="q-item"/g) ?? []).length, 1);
  const more = put('b: y | B\n').find((o) => o.op === 'tail');
  assert.ok(more?.op === 'tail');
  assert.equal((more.html.match(/class="q-item"/g) ?? []).length, 2);
});

test('editors: a bucket set and an `export` in one unit are drawn once per item line, not again for the export', async () => {
  // The grid holds both and is returned when it is full, so each later item line draws the one unit, which lists the item already.
  const src = ['# Page', '', 'grid 2', 'bucket b | A, B', 'export json', 'b: x | A', 'b: y | B', '', 'Closing.', ''].join('\n');
  for (const chunk of [1, 5, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(streamed(d), await whole(src), `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
    // Two units (the grid, the paragraph) and an item line each: nothing drawn a second time for the export it holds.
    assert.equal(d.end.renders, d.model.units.length + 2, `chunks of ${chunk}`);
  }
});

test('editors: the export lists every bucket item whether or not the consumer passes on the updates of the set', async () => {
  const src = ['# Page', '', 'bucket b | A, B', 'b: x | A', '', 'export json', '', 'b: y | B', 'b: z | A', ''].join('\n');
  const stream = new LedeStream(parseOpts);
  const inc = createIncremental(
    () => stream.doc.meta,
    () => stream.doc.data,
    { settle: false },
  );
  const model = new StringModel();
  // Only the blocks are given to the renderer, a line at a time: the item lines after the `bucket` line reach it through no `update`.
  for (const line of src.split('\n'))
    for (const e of stream.events(`${line}\n`)) if (e.kind === 'block') model.apply(inc.push(e.block).ops);
  stream.end((e) => e.kind === 'block' && model.apply(inc.push(e.block).ops));
  model.apply((await inc.end()).ops);
  const [json] = exportsIn(model.main());
  // The set's own drawing is the settle's to correct; the export is made right by `end()` itself.
  for (const item of ['x', 'y', 'z']) assert.match(json, new RegExp(`&quot;${item}&quot;`), item);
});

test('editors: `shell` has no effect on the incremental renderer; the editor words draw as render() draws them for a fragment', async () => {
  for (const f of EDITOR_PAGES) {
    const src = read(f);
    const d = await drive(src, { chunk: 9, parse: parseOpts, shell: true });
    assert.equal(streamed(d), await whole(src), f);
    assert.doesNotMatch(d.model.main(), /q-clear|class="q-pre"|q-bar|<script/);
    assert.equal(d.model.css, await wholeStyle(src));
  }
});

test('editors: a bucket set and an export drawn before the items are in the page the rules got right, whatever the order of the lines', async () => {
  // A bucket set written between a heading that may group and its next sibling, and items written after other blocks.
  const src = [
    '# Plan',
    '',
    '## Decision?',
    '',
    'bucket b | A, B | Where?',
    'b: x | A',
    '',
    '## Another?',
    '',
    'An answer.',
    '',
    'b: y | B',
    'Closing words.',
    '',
    'b: z | A',
    'export markdown',
    '',
  ].join('\n');
  for (const chunk of [1, 3, 7, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(streamed(d), await whole(src), `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
    assert.equal(d.end.reseals, 0, 'a bucket set has no reseal');
  }
});

// ---- early layout-shift check (Chromium) ----------------------------------------------------------------------------------------

// `browserTest` skips without a Chromium, and fails instead when CI or LEDE_REQUIRE_CHROME is set.

const CLS_PAGES: Record<string, string> = {
  faq: [
    '@title Billing questions',
    '@subtitle What changes when you move to the annual plan',
    '',
    sentences(2),
    '',
    ...[
      'How do I change my plan?',
      'Can I get a refund?',
      'What happens when I go over the limit?',
      'Where do invoices go?',
      'Who can see the bill?',
    ].flatMap((q, i) => [`## ${q}`, '', sentences(2, i), '']),
    '## Contact',
    '',
    'Write to billing and we will answer within a day.',
    '',
  ].join('\n'),
  set: [
    '@title Principles',
    '',
    sentences(1),
    '',
    ...['Speed', 'Cost', 'Safety', 'Clarity'].flatMap((n, i) => [`## ${n}`, '', sentences(1, i).slice(0, 120), '']),
    '## Closing',
    '',
    sentences(3, 2),
    '',
  ].join('\n'),
  cards: [
    '@title Storage options',
    '',
    sentences(2),
    '',
    '## Options',
    '',
    ...['Postgres', 'DynamoDB', 'S3 and Athena'].flatMap((n) => [
      `### ${n}`,
      '',
      '- Familiar to the whole team',
      '- Costs grow with the data',
      '- Needs a backup plan',
      '',
    ]),
    '## Recommendation',
    '',
    'Use Postgres because the team already runs it.',
    '',
  ].join('\n'),
  essay: essay(0) + ['', ...[4, 5, 6].flatMap((i) => [sentences(4, i), ''])].join('\n'),
  'late h1': [
    '@title Release notes',
    '',
    sentences(2),
    '',
    '## Added',
    '',
    sentences(2, 1),
    '',
    '## Fixed',
    '',
    sentences(2, 2),
    '',
    '# Appendix',
    '',
    sentences(2, 3),
    '',
  ].join('\n'),
  'flow (extra)': ['# Pipeline', '', sentences(2), '', FLOW, sentences(2, 2), '', '## After', '', sentences(2, 4), ''].join('\n'),
};

/** Plays recorded op batches into a sandboxed `allow-same-origin` frame, one batch per animation frame, and returns the layout shift. */
async function shiftOf(page: Page, frameWidth: number, styles: string, recorded: { ops: unknown[] }[]) {
  return page.evaluate(
    async ({ width, css, batches }) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.style.cssText = `width:${width}px;height:2600px;border:0;display:block`;
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="s">${css}</style></head><body><main class="doc"></main></body></html>`;
      document.body.append(frame);
      await new Promise((r) => frame.addEventListener('load', r, { once: true }));
      const win = frame.contentWindow!;
      const doc = frame.contentDocument!;
      const main = doc.querySelector('main')!;
      let total = 0;
      let seen = 0;
      const po = new (win as unknown as { PerformanceObserver: typeof PerformanceObserver }).PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          seen++;
          if (!e.hadRecentInput) total += e.value;
        }
      });
      po.observe({ type: 'layout-shift', buffered: true });
      const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const nodes = (html: string) => {
        const t = doc.createElement('template');
        t.innerHTML = html;
        return [...t.content.childNodes];
      };
      const units = new Map<number, Node[]>();
      let header: Node[] = [];
      let tail: Node[] = [];
      const put = (html: string, before: Node | null) => {
        const ns = nodes(html);
        const f = doc.createDocumentFragment();
        f.append(...ns);
        main.insertBefore(f, before);
        return ns;
      };
      const drop = (ns: Node[]) => ns.forEach((n) => n.parentNode?.removeChild(n));
      for (const { ops } of batches) {
        for (const op of ops as Record<string, unknown>[]) {
          switch (op.op) {
            case 'masthead': {
              const old = header;
              header = put(op.html as string, main.firstChild);
              drop(old);
              break;
            }
            case 'prose':
              main.classList.toggle('prose', op.on as boolean);
              break;
            case 'dash':
              main.classList.toggle('dash', op.on as boolean);
              break;
            case 'append':
            case 'placeholder':
              units.set(op.id as number, put(op.html as string, tail[0] ?? null));
              break;
            case 'replace': {
              const old = units.get(op.id as number) ?? [];
              units.set(op.id as number, put(op.html as string, old[0] ?? tail[0] ?? null));
              drop(old);
              break;
            }
            case 'remove':
              for (const id of op.ids as number[]) {
                drop(units.get(id) ?? []);
                units.delete(id);
              }
              break;
            case 'tail': {
              const old = tail;
              tail = put(op.html as string, null);
              drop(old);
              break;
            }
            case 'style':
              doc.getElementById('s')!.textContent = op.css as string;
              break;
          }
        }
        await frames();
      }
      await frames();
      await new Promise((r) => setTimeout(r, 120));
      po.takeRecords();
      return { total, seen };
    },
    { width: frameWidth, css: styles, batches: recorded },
  );
}

browserTest(
  'layout shift while streaming: five pages measured at 1280 and 400 wide; over 0.05 is reported as a finding',
  async (browser) => {
    const { css } = await import('../src/index.ts');
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    try {
      await page.setContent('<!doctype html><body></body>');
      // The observer must see a shift at all, or the numbers below mean nothing: move a block under a visible one.
      const probe = await page.evaluate(async () => {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-same-origin');
        f.style.cssText = 'width:400px;height:400px;border:0';
        f.srcdoc =
          '<!doctype html><body style="margin:0"><div id="a" style="height:50px">a</div><div id="b" style="height:50px">b</div></body>';
        document.body.append(f);
        await new Promise((r) => f.addEventListener('load', r, { once: true }));
        let seen = 0;
        const po = new (f.contentWindow as unknown as { PerformanceObserver: typeof PerformanceObserver }).PerformanceObserver((l) => {
          seen += l.getEntries().length;
        });
        po.observe({ type: 'layout-shift', buffered: true });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const d = f.contentDocument!.createElement('div');
        d.style.height = '80px';
        d.textContent = 'inserted';
        f.contentDocument!.body.insertBefore(d, f.contentDocument!.getElementById('a'));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 100));
        f.remove();
        return seen;
      });
      assert.ok(probe > 0, 'a layout-shift observer created in the host realm on the frame window must fire for a forced shift');

      const rows: string[] = [];
      const over: string[] = [];
      for (const [name, src] of Object.entries(CLS_PAGES)) {
        const d = await drive(src, { chunk: 40, parse: parseOpts, settle: true, flush: 'chunk' });
        const batches = d.batches.map((b) => ({ ops: b.ops }));
        for (const width of [1280, 400]) {
          const r = await shiftOf(page, width, css({}), batches);
          rows.push(
            `${name} @${width}: shift ${r.total.toFixed(4)} (${r.seen} entries), settled ${d.end.settled}, repicks ${d.end.repicks}`,
          );
          if (r.total > 0.05) over.push(`${name} @${width} ${r.total.toFixed(4)}`);
        }
      }
      console.log(`layout shift while streaming (chunk 40, one batch per frame, settle on)\n  ${rows.join('\n  ')}`);
      // A page over 0.05 is a finding for the design (the hold rule shows held sections flat, then restyles them), not a failure of
      // this test: it reports the numbers and fails only if nothing was measured.
      if (over.length) console.warn(`FINDING: layout shift over 0.05: ${over.join('; ')}`);
      assert.equal(rows.length, 2 * Object.keys(CLS_PAGES).length);
    } finally {
      await page.close();
    }
  },
  240_000,
);

test('a card title inside an FAQ answer with a flow diagram takes its heading id in page order on the async path', async () => {
  const src = [
    '# Questions',
    '## Why?',
    'cards',
    '### Alpha',
    'One.',
    '### Beta',
    'Two.',
    '## How?',
    'diagram f',
    'f: a -> b',
    '',
    '## When?',
    'Soon.',
    '## Alpha',
    'Later one.',
    '## Beta',
    'Later two.',
    '',
  ].join('\n');
  const expected = await whole(src);
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: parseOpts });
    assert.equal(streamed(d), expected, `chunks of ${chunk}`);
    assert.equal(d.end.equal, true, `chunks of ${chunk}: no settle`);
  }
});
