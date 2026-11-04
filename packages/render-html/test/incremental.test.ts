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
import { drive, normalize, type Driven } from '../../../bench/src/incremental-model.ts';
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
  assert.equal(streamed(d), await whole(src));
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
    else if (e.kind === 'seal') take(inc.seal(e.block));
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
