// Decision blocks (spec §4.20, D80): the static card, its stylesheet, the escaping of every text in it, the incremental form and, in
// Chromium, its layout at phone width. Skips the browser checks without a Chromium, as the other batteries do (chrome.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { drive, normalize } from '../../../bench/src/incremental-model.ts';
import { AXE, browserTest } from './chrome.ts';

const lines = (...l: string[]) => l.join('\n');
const DESIGN = lines(
  'decision queue "Which queue carries order events?" status=settled by=2026-12-01',
  'queue: option sqs "SQS" | managed, 14-day retention | chosen',
  'queue: option kafka "Kafka" | replay, ops cost | rejected',
  'queue: option sns "SNS" | fan-out only',
  'queue: question "Do we need replay beyond 14 days?" | answered: no',
  'queue: question "Who pays for the traffic?"',
  'queue: role decides "Ana Ruiz"',
  'queue: role consulted "Platform team"',
);
const main = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1];

test('a decision is one static card: the question names it, the status and each verdict are words, and the options are a list', async () => {
  const { html, doc } = await compile(DESIGN);
  assert.deepEqual(doc.diagnostics, []);
  const m = main(html);
  assert.equal((m.match(/<section class="decision"/g) ?? []).length, 1);
  // The card is labelled by its question, through an id the page makes.
  const id = /<section class="decision" aria-labelledby="([^"]+)"/.exec(m)![1];
  assert.match(m, new RegExp(`<p class="dc-q" id="${id}">Which queue carries order events\\?</p>`));
  // The status chip is the existing pill, with the word; the date is a chip with the ISO date.
  assert.match(
    m,
    /<span class="sr">Status: <\/span><span class="pill good">Settled<\/span><time class="chip" datetime="2026-12-01">by 2026-12-01<\/time>/,
  );
  // Options: the chosen one and the rejected one say so in words; a label is struck through by CSS, so only the rejected one has the class.
  assert.match(
    m,
    /<li class="chosen"><span class="dc-ol">SQS<\/span><span class="pill good">Chosen<\/span><span class="dc-w">managed, 14-day retention<\/span><\/li>/,
  );
  assert.match(
    m,
    /<li class="rejected"><span class="dc-ol">Kafka<\/span><span class="pill bad">Rejected<\/span><span class="dc-w">replay, ops cost<\/span><\/li>/,
  );
  assert.match(m, /<li><span class="dc-ol">SNS<\/span><span class="dc-w">fan-out only<\/span><\/li>/);
  // Questions: an answer is shown with its label, an open one says Open.
  assert.match(
    m,
    /<span class="dc-qt">Do we need replay beyond 14 days\?<\/span><span class="dc-a"><b class="dc-al">Answer<\/b> no<\/span>/,
  );
  assert.match(m, /<li class="open"><span class="dc-qt">Who pays for the traffic\?<\/span><span class="pill warn">Open<\/span><\/li>/);
  // Roles: a description list.
  assert.match(
    m,
    /<dl class="dc-roles"><div><dt>decides<\/dt><dd>Ana Ruiz<\/dd><\/div><div><dt>consulted<\/dt><dd>Platform team<\/dd><\/div><\/dl>/,
  );
  // No script, no control, nothing hidden, in any build mode.
  for (const opts of [{}, { artifact: true }, { fragment: true }, { shell: true }]) {
    const out = await render(doc, opts);
    assert.doesNotMatch(out, /<script|<input|<button|<form|\shidden[\s>=]|\sstyle=/, JSON.stringify(opts));
  }
});

test('the three statuses draw the existing chips: settled good, open warn, deferred the neutral grey', async () => {
  const chip = async (status: string) =>
    /<span class="pill ([^"]*)">([^<]*)<\/span>/.exec(main((await compile(`decision q "Q?" status=${status}`)).html))!.slice(1, 3);
  assert.deepEqual(await chip('settled'), ['good', 'Settled']);
  assert.deepEqual(await chip('open'), ['warn', 'Open']);
  // `info` is a tone the status pills already have (not started, on hold) and draws as the plain `.pill`.
  assert.deepEqual(await chip('deferred'), ['info', 'Deferred']);
  const css = styleOf((await compile('decision q "Q?"')).html);
  assert.match(css, /\.pill\{[^}]*background:var\(--info-bg\);color:var\(--fg2\)/);
  assert.doesNotMatch(css, /\.pill\.info/);
  // No date, no chip for it; a date that is not ISO is a chip without `<time>`.
  assert.doesNotMatch(main((await compile('decision q "Q?"')).html), /class="chip"/);
  const free = main((await compile('decision q "Q?" by=Q1')).html);
  assert.match(free, /<span class="chip">by Q1<\/span>/);
  assert.doesNotMatch(free, /<time/);
});

test('the card is only as long as what was written: an empty decision has a head and nothing else', async () => {
  const m = main((await compile('decision q "Q?"')).html);
  assert.doesNotMatch(m, /dc-l|dc-opts|dc-qa|dc-roles/);
  const opts = main((await compile('decision q "Q?"\nq: option a "A"')).html);
  assert.match(opts, /<p class="dc-l">Options<\/p><ul class="dc-opts">/);
  assert.doesNotMatch(opts, /dc-qa|dc-roles/);
});

test('the card has its rules only on a page that holds a decision, in a grid or a card too, so other pages keep their bytes', async () => {
  const plain = styleOf((await compile('# A page\n\nText.')).html);
  assert.doesNotMatch(plain, /decision blocks|\.decision/);
  for (const src of ['decision q "Q?"', 'cards\n### One\ndecision q "Q?"\n### Two\nText.', 'grid 2\ndecision q "Q?"\nText.']) {
    const { html } = await compile(src);
    assert.match(styleOf(html), /\/\* decision blocks \*\//, src);
    assert.match(styleOf(html), /\.decision\{/, src);
    assert.match(main(html), /<section class="decision"/, src);
  }
  // `--artifact` carries the same style, and a fragment none.
  assert.match((await compile('decision q "Q?"', { artifact: true })).html, /\/\* decision blocks \*\//);
  assert.doesNotMatch((await compile('decision q "Q?"', { fragment: true })).html, /<style/);
  // The page's other words keep theirs: a decision beside a question adds the card's rules after the controls'.
  const both = styleOf((await compile('decision q "Q?"\nask a | A?\nexport json')).html);
  assert.ok(both.indexOf('/* question words */') < both.indexOf('/* decision blocks */'));
});

test('two decisions on a page have their own labels, in document order, beside the ids a chart takes', async () => {
  const src = lines('decision a "First?"', 'decision b "Second?"', 'data d = k,v; x,1', 'chart bar d');
  const { html } = await compile(src);
  const ids = [...html.matchAll(/<section class="decision" aria-labelledby="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.equal(html.split(`id="${id}"`).length, 2, `${id} is on one element`);
});

test('prose that starts with the word is a paragraph on the page', async () => {
  const m = main((await compile('decision was made on Monday, and decision queue is a phrase.')).html);
  assert.match(m, /<p>decision was made on Monday/);
  assert.doesNotMatch(m, /decision"/);
});

// ---------------------------------------------------------------- escaping (D49)

test('every text in a decision is escaped or inline markup: nothing a writer types becomes a tag, a handler or a script URL', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const src = lines(
    `decision q "${evil}" status="${evil}" by="${evil}"`,
    `q: option a "${evil}" | ${evil} | ${evil}`,
    `q: option b "[x](javascript:alert(1))" | [y](javascript:alert(2)) | chosen`,
    `q: question "${evil}" | ${evil}`,
    `q: role "${evil.replace(/ /g, '')}" "${evil}"`,
    `q: role decides "${evil}"`,
    `q: role decides <script>alert(3)</script> "x"`,
  );
  const { html } = await compile(src);
  const m = main(html);
  // Every tag on the page is one the card makes; a payload shows as text.
  const tags = new Set([...m.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((x) => x[1]));
  assert.deepEqual(
    [...tags].toSorted(),
    ['b', 'dd', 'div', 'dl', 'dt', 'li', 'main', 'p', 'section', 'span', 'ul'].filter((t) => tags.has(t)),
  );
  for (const tag of m.match(/<[^>]*>/g) ?? []) assert.doesNotMatch(tag, /javascript:|\son[a-z]+=/i, tag);
  assert.match(m, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // A link with a safe URL still links; an unsafe one is text.
  const ok = main((await compile('decision q "Q?"\nq: option a "A" | see [the RFC](https://example.com/rfc)')).html);
  assert.match(ok, /<a href="https:\/\/example.com\/rfc">the RFC<\/a>/);
  // The date's `datetime` is written only for a plain ISO date.
  assert.doesNotMatch(m, /datetime/);
  assert.match(main((await compile('decision q "Q?" by=2026-12-01')).html), /datetime="2026-12-01"/);
  const quoted = main((await compile('decision q "Q?" by="2026-12-01\\" onclick=\\"x"')).html);
  assert.match(quoted, /by 2026-12-01&quot; onclick=&quot;x/);
  for (const tag of quoted.match(/<[^>]*>/g) ?? []) assert.doesNotMatch(tag, /onclick/, tag);
});

// ---------------------------------------------------------------- the incremental form

const wholeMain = async (src: string) => normalize(await render(parse(src), { fragment: true }));

test('streamed, the card is drawn again in place for each line, and the page equals the whole-page render at any chunking', async () => {
  const src = lines(
    '# Order events',
    '',
    DESIGN,
    '',
    'A paragraph between.',
    '',
    'decision region "Where?" by=Q1',
    'region: option eu "EU" | near | picked',
    '',
  );
  const expected = await wholeMain(src);
  const style = styleOf(await render(parse(src)));
  for (const chunk of [1, 5, 37, 400]) {
    const d = await drive(src, { chunk });
    assert.equal(normalize(d.model.main()), expected, `chunks of ${chunk}`);
    assert.equal(d.model.css, style, `chunks of ${chunk}: the stylesheet`);
    assert.deepEqual([d.end.equal, d.end.settled, d.end.regroups, d.end.reseals], [true, 0, 0, 0], `chunks of ${chunk}`);
  }
  // One line at a time: the card is appended once, and each later line replaces it in place, with its own unit id.
  const d = await drive(src, { chunk: 1 });
  const drawn = d.model.log.filter(
    (o): o is Extract<typeof o, { op: 'append' | 'replace' }> =>
      (o.op === 'append' || o.op === 'replace') && o.html.includes('aria-labelledby'),
  );
  const first = drawn.filter((o) => o.html.includes('Which queue carries'));
  assert.equal(first[0].op, 'append');
  assert.ok(first.slice(1).every((o) => o.op === 'replace' && o.id === first[0].id));
  const counts = first.map((o) => (o.html.match(/<li|<div><dt>/g) ?? []).length);
  assert.ok(
    counts.every((n, i) => i === 0 || n >= counts[i - 1]),
    counts.join(','),
  );
  assert.equal(counts.at(-1), 7, 'three options, two questions and two roles');
  // The stylesheet gains the card's rules with the first decision, not before.
  const styles = d.model.log.filter((o): o is Extract<typeof o, { op: 'style' }> => o.op === 'style');
  assert.ok(styles.length >= 2, 'the sheet is sent again when the first decision arrives');
  assert.doesNotMatch(styles[0].css, /decision blocks/);
  assert.match(styles.at(-1)?.css ?? '', /decision blocks/);
});

test('streamed inside a cards run, a decision is in the run when the run is drawn, with the stylesheet from that block', async () => {
  const src = lines(
    'cards',
    '### One',
    'decision q "Q?"',
    'q: option a "A" | why | chosen',
    'q: role decides "Ana"',
    '### Two',
    'Text.',
    '',
    '## After',
    '',
  );
  for (const chunk of [1, 9, 200]) {
    const d = await drive(src, { chunk });
    assert.equal(normalize(d.model.main()), await wholeMain(src), `chunks of ${chunk}`);
    assert.match(d.model.css, /decision blocks/);
    assert.equal(d.end.equal, true);
  }
});

test('on a dashboard page the card keeps its rules beside the dashboard rules, whole or streamed, and a plain page has neither', async () => {
  const src = lines('# Ops', '', 'kpi Open | 3', '', DESIGN, '', 'kpi Late | 1', '');
  const html = (await compile(src)).html;
  assert.match(main(html), /<main class="doc dash">/);
  assert.match(styleOf(html), /\.doc\.dash \.lgrid/);
  assert.match(styleOf(html), /\/\* decision blocks \*\//);
  const plain = (await compile(lines('# Ops', '', DESIGN))).html;
  assert.doesNotMatch(main(plain), /class="doc dash"/);
  assert.doesNotMatch(styleOf(plain), /\.doc\.dash/);
  assert.match(styleOf(plain), /\/\* decision blocks \*\//);
  for (const chunk of [1, 23, 400]) {
    const d = await drive(src, { chunk });
    assert.equal(normalize(d.model.main()), await wholeMain(src), `chunks of ${chunk}`);
    assert.equal(d.model.css, styleOf(html), `chunks of ${chunk}: the stylesheet`);
    assert.equal(d.end.equal, true, `chunks of ${chunk}`);
  }
});

test('a page with no decision streams with no decision rules', async () => {
  const d = await drive('# A\n\nText.\n', { chunk: 3 });
  assert.doesNotMatch(d.model.css, /decision/);
});

// ---------------------------------------------------------------- Chromium, at phone width

const SRC = readFileSync(new URL('../../../examples/parity/decisions.lede', import.meta.url), 'utf8');
const LONG = lines(
  'decision lng "A question that goes on and on and on, with Averyveryverylongwordthatwillnotbreakanywhereunlessitisforcedto in it?" status=deferred by="the end of the second quarter, whenever that is"',
  'lng: option a "An option label with Averyveryverylongwordthatwillnotbreakanywhereunlessitisforcedtobreak in it" | A reason with https://example.com/a/very/long/path/that/has/no/spaces/at/all/and/keeps/going in it | rejected',
  'lng: option b "Short" | ok | chosen',
  'lng: question "Another question with Averyveryverylongwordthatwillnotbreakanywhereunlessitisforcedtobreak?" | An answer with Averyveryverylongwordthatwillnotbreakanywhereunlessitisforcedtobreak',
  'lng: role decides "Priya Natarajan-Wetherspoon-Hargreaves-Montgomery-Featherstonehaugh"',
  'lng: role consulted "The platform and reliability engineering working group"',
);

// Runs in the page. Returns problems as strings.
const MEASURE = `(() => {
  const bad = [];
  if (document.scrollingElement.scrollWidth > innerWidth) bad.push('page scrolls sideways: ' + document.scrollingElement.scrollWidth);
  const cards = document.querySelectorAll('section.decision');
  if (!cards.length) bad.push('no decision card');
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (r.left < -0.5 || r.right > innerWidth + 0.5) bad.push('a card leaves the viewport: ' + Math.round(r.left) + ' to ' + Math.round(r.right));
    if (c.scrollWidth > c.clientWidth + 1) bad.push('a card overflows its own box: ' + c.scrollWidth + ' > ' + c.clientWidth);
    for (const el of c.querySelectorAll('*')) {
      const e = el.getBoundingClientRect();
      if (e.width && (e.right > r.right + 0.5 || e.left < r.left - 0.5)) bad.push(el.tagName.toLowerCase() + '.' + el.className + ' leaves its card');
    }
    const label = c.getAttribute('aria-labelledby');
    const q = label && document.getElementById(label);
    if (!q || !q.textContent.trim()) bad.push('a card has no name');
  }
  for (const li of document.querySelectorAll('.dc-opts > li.rejected .dc-ol')) {
    if (!getComputedStyle(li).textDecorationLine.includes('line-through')) bad.push('a rejected option is not struck through');
  }
  for (const li of document.querySelectorAll('.dc-opts > li.chosen, .dc-opts > li.rejected')) {
    if (!li.querySelector('.pill')) bad.push('a verdict has no word');
  }
  return bad;
})()`;

for (const [name, src] of [
  ['the parity page', SRC],
  ['long words, links and dates', LONG],
] as const)
  for (const scheme of ['light', 'dark'] as const)
    browserTest(`decision cards (${name}) at 360 px, ${scheme}: no overflow, a name each, verdicts in words, contrast`, async (browser) => {
      const { html, doc } = await compile(src);
      assert.deepEqual(
        doc.diagnostics.filter((d) => d.severity === 'error'),
        [],
      );
      const ctx = await browser.newContext({ viewport: { width: 360, height: 900 }, colorScheme: scheme, bypassCSP: true });
      const page = await ctx.newPage();
      await page.setContent(html);
      assert.deepEqual(await page.evaluate(MEASURE), []);
      await page.addScriptTag({ path: AXE });
      const found = (await page.evaluate(
        `axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')))`,
      )) as string[];
      assert.deepEqual(found, []);
      await ctx.close();
    });

browserTest('decision cards at 1280 px, in a cards run and on a prose page: no overflow', async (browser) => {
  const essay = Array.from(
    { length: 5 },
    (_, k) => `Paragraph ${k + 1}. ${'The plan keeps each team on its own schedule until the shared services are ready. '.repeat(4)}`,
  ).join('\n\n');
  for (const [width, src] of [
    [1280, `${SRC}\n\ncards\n### One\ndecision cq "In a card?"\ncq: option a "A" | why | chosen\n### Two\nText.\n`],
    [360, `${essay}\n\n${DESIGN}`],
  ] as const) {
    const { html } = await compile(src);
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, bypassCSP: true });
    const page = await ctx.newPage();
    await page.setContent(html);
    assert.deepEqual(await page.evaluate(MEASURE), [], `at ${width}`);
    // On the prose layout the card keeps the page's sans: the essay's serif is for the text around it.
    const family = (await page.evaluate(`getComputedStyle(document.querySelector('.dc-ol')).fontFamily`)) as string;
    assert.match(family, /system-ui/, `at ${width}`);
    await ctx.close();
  }
});
