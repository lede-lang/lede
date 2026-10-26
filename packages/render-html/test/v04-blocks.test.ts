// v0.4 blocks (stream S2, vocabulary-v04 design F.1, F.3, F.4, F.5 and the known
// defects). The parser for these lands in another stream, so each case builds a LedeDocument by hand
// and calls render(). The browser battery at the end renders every construct at 400px dark and
// 1280px light and measures overflow and contrast; it is skipped, with a message, without Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Block, DataSet, Kpi, LedeDocument, TableBlock, ChartBlock } from '@lede-lang/core';
import { compile, render, dateLike } from '../src/index.ts';
import { inline } from '../src/util.ts';
import { resolveChrome } from '../../../bench/src/shot.ts';

// ---- builders -----------------------------------------------------------------------------------

const ds = (name: string, columns: string[], rows: string[][]): DataSet => ({ name, columns, rows, line: 1 });
const doc = (blocks: Block[], data: DataSet[] = [], meta: Record<string, string> = {}): LedeDocument => ({
  meta: { title: 'Fixture', ...meta },
  blocks,
  data: Object.fromEntries(data.map((d) => [d.name, d])),
  diagnostics: [],
});
const p = (text: string): Block => ({ type: 'paragraph', text, line: 1 });
const ul = (...items: string[]): Block => ({
  type: 'list',
  ordered: false,
  start: 1,
  items: items.map((text) => ({ text, checked: null })),
  line: 1,
});
const kpi = (label: string, value: string, more: Partial<Kpi> = {}): Kpi => ({
  label,
  value,
  delta: '',
  tone: null,
  note: '',
  ref: null,
  ...more,
});
const kpis = (...items: Kpi[]): Block => ({ type: 'kpis', items, line: 1 });
const tbl = (data: string, more: Partial<TableBlock> = {}): TableBlock => ({
  type: 'table',
  data,
  cols: null,
  sort: null,
  limit: null,
  title: null,
  line: 1,
  ...more,
});
const chart = (data: string, x: string, y: string[], more: Partial<ChartBlock> = {}): ChartBlock => ({
  type: 'chart',
  kind: 'line',
  data,
  x,
  y,
  title: null,
  stack: false,
  labels: false,
  unit: null,
  min: null,
  max: null,
  focus: null,
  target: null,
  line: 1,
  ...more,
});
const cards = (...items: [string, Block[]][]): Block => ({
  type: 'cards',
  items: items.map(([title, blocks]) => ({ title, blocks, line: 1 })),
  line: 1,
});
const steps = (...items: [string, string?, string?][]): Block => ({
  type: 'steps',
  items: items.map(([title, due = '', note = '']) => ({ title, due, note, line: 1 })),
  line: 1,
});
const html = (d: LedeDocument) => render(d, { fragment: true });

const quarters = ds(
  'q',
  ['quarter', 'revenue', 'cost of goods', 'labor', 'rent and other', 'profit', 'margin'],
  [
    ['Q4 2025', '$1,842,000', '$589,000', '$612,000', '$398,000', '$243,000', '13.2%'],
    ['Q1 2026', '$1,756,000', '$561,000', '$598,000', '$405,000', '$192,000', '10.9%'],
    ['Q2 2026', '$1,968,000', '$618,000', '$631,000', '$412,000', '$307,000', '15.6%'],
  ],
);
const trend = ds(
  't',
  ['week', 'p95', 'errors'],
  [
    ['W1', '180', '12'],
    ['W2', '210', '9'],
    ['W3', '190', '14'],
    ['W4', '240', '7'],
  ],
);
const goals = ds(
  'g',
  ['team', 'done', 'goal', 'owner'],
  [
    ['Payments', '42', '50', 'Ana'],
    ['Search', '61', '55', 'Raj'],
    ['Mobile', '20', '40', 'Lee'],
  ],
);
const plans = ds(
  'plans',
  ['task', 'owner', 'due', 'status'],
  [
    ['Rotate certificates', 'Ana', '2026-05-18', 'done'],
    ['Drain canary', 'Raj', 'by Fri 17:00', 'at risk'],
    ['Write postmortem', 'Lee', 'next week, pending legal review', 'not started'],
  ],
);

const optionCard = (title: string): [string, Block[]] => [
  title,
  [p('Moves the queue to a managed service. Costs more at peak, much less to run.'), ul('Two weeks to migrate', 'No on-call for brokers')],
];

// ---- F.1 cards ----------------------------------------------------------------------------------

test('F.1 cards: columns by count (2, 3, 2x2, 3 for five), title above content', async () => {
  for (const [n, cols] of [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 2],
    [5, 3],
    [6, 3],
  ] as const) {
    const items = Array.from({ length: n }, (_, i) => optionCard(`Option ${i + 1}`));
    const out = await html(doc([cards(...items)]));
    assert.match(out, new RegExp(`<div class="cards lcards[^"]*" style="--cols:${cols}">`), `${n} cards -> ${cols} columns`);
    assert.equal((out.match(/<section class="card lc/g) ?? []).length, n);
  }
  const out = await html(doc([cards(optionCard('Managed queue'), optionCard('Self-hosted'))]));
  assert.match(out, /<section class="card lc"><h3 id="managed-queue">Managed queue<\/h3><p>Moves/, 'title is an h3 before the card body');
  assert.doesNotMatch(out, /lcards wide/, 'two to a row stays in the text column');
  assert.doesNotMatch(
    await html(doc([cards(optionCard('A'), optionCard('B'), optionCard('C'))])),
    /lcards wide/,
    'three cards of prose and bullets stay in the text column (D38)',
  );
  const withTable = (t: string): [string, Block[]] => [t, [tbl('g')]];
  assert.match(
    await html(doc([cards(withTable('A'), withTable('B'), withTable('C'))], [goals])),
    /class="cards lcards wide"/,
    'three cards holding a table span the wide column',
  );
});

test('F.1 cards: a title containing "recommended" gets the recommendation highlight', async () => {
  const out = await html(doc([cards(optionCard('Option A'), optionCard('Option B (Recommended)'))]));
  assert.match(out, /<section class="card lc rec"><h3[^>]*>Option B \(Recommended\)/);
  assert.equal((out.match(/card lc rec/g) ?? []).length, 1);
});

test('F.1 cards: kpis, tables and charts inside a card are sized to the card', async () => {
  const out = await html(
    doc(
      [
        cards(
          ['Revenue', [kpis(kpi('Q3 revenue', '$2,134,000', { delta: '+8.4%' }), kpi('Margin', '17.6%'))]],
          ['By quarter', [{ ...tbl('q') }]],
          ['Latency', [chart('t', 'week', ['p95'], { unit: 'ms' })]],
        ),
      ],
      [quarters, trend],
    ),
  );
  assert.doesNotMatch(out, /kpi hero/, 'a lone kpi row in a card is never a hero');
  assert.match(out, /<table class="lt stack/, 'a seven-column table in a 3-up card stacks against the card width');
  assert.match(out, /class="chart-wide chart-cell"/, 'charts get the card width hint');
  const wide = await html(doc([cards(['Only', [tbl('q')]])], [quarters]));
  assert.match(wide, /<table class="lt stack/, 'a one-card run still fits the phone card width');
});

// ---- F.4 step -----------------------------------------------------------------------------------

test('F.4 step: numbered step cards with a deadline chip and a note', async () => {
  const out = await html(
    doc([
      steps(
        ['Freeze deploys', 'by 03:00', 'Post in #deploys and pin it.'],
        ['Drain the canary', 'Blocked', 'Waiting on the network team.'],
        ['Rotate the certificate', '2026-03-01'],
        ['Write the postmortem'],
        ['Tell customers', 'after legal signs off'],
      ),
    ]),
  );
  assert.match(out, /<ol class="steps cards sx">/);
  assert.deepEqual(
    [...out.matchAll(/<span class="n">(\d+)<\/span>/g)].map((m) => m[1]),
    ['1', '2', '3', '4', '5'],
  );
  assert.match(out, /<b>Freeze deploys<\/b><span class="chip">by 03:00<\/span><\/div><div class="sn">Post in #deploys/);
  assert.match(out, /<span class="pill bad">Blocked<\/span>/, 'a status word is a status chip');
  assert.match(out, /<span class="chip">2026-03-01<\/span>/);
  assert.match(out, /<b>Write the postmortem<\/b><\/div><\/li>/, 'no deadline, no note: no empty chip');
  assert.match(out, /<span class="chip">after legal signs off<\/span>/, 'any deadline text is a chip');
});

// ---- F.5 chips ----------------------------------------------------------------------------------

test('F.5 dateLike: date and time phrases yes, mixed text and bare numbers no', () => {
  for (const s of [
    '2026-05-18',
    'by 03:00',
    'Fri 17:00',
    'by Friday 5pm',
    '09:00 UTC',
    'Mar 3',
    'March 3, 2026',
    '3 March 2026',
    'tomorrow',
    'EOD',
    'end of day',
    'next week',
    'Q3 2026',
    'week 4',
    'T+30m',
    'due 2026-03-01 09:00',
    '14:00-16:00',
    'Mon, Mar 3',
  ])
    assert.ok(dateLike(s), `${s} is a date/time`);
  for (const s of [
    '2026',
    '42',
    '17.6%',
    '+8.4%',
    'Ana',
    'ships Friday if green',
    'next week, pending legal review',
    'four quarters',
    'T-Mobile',
    't-test',
    '$1,117,000',
    'on track',
    '',
  ])
    assert.ok(!dateLike(s), `${s} is not a date/time`);
});

test('F.5 chips: kpi note or delta that is only a status word or a date becomes a chip', async () => {
  const out = await html(
    doc([
      kpis(
        kpi('Migration', '82%', { delta: 'On track', tone: 'good' }),
        kpi('Next review', 'Board', { note: '2026-05-18' }),
        kpi('Cutover', '3 sites', { delta: 'by Fri 17:00' }),
        kpi('Revenue', '$2.1M', { delta: '+8.4%', note: 'ships Friday if green' }),
      ),
    ]),
  );
  assert.match(out, /<span class="kn"><span class="pill good">On track<\/span>/);
  assert.match(out, /<span class="kn"><span class="chip">2026-05-18<\/span><\/span>/);
  assert.match(out, /<span class="kn"><span class="chip">by Fri 17:00<\/span><\/span>/);
  assert.doesNotMatch(out, /class="kd[^"]*">[^<]*(by Fri|2026)/, 'a date is never read as a delta');
  assert.match(out, /<span class="kd">▲ \+8\.4%<\/span><span class="kn">ships Friday if green<\/span>/, 'mixed text is unchanged');
});

test('F.5 chips: a table cell that is only a date/time is a neutral chip; mixed text and row headers are not', async () => {
  const out = await html(doc([tbl('plans')], [plans]));
  assert.match(out, /<td class="nw"><span class="chip">2026-05-18<\/span><\/td>|<td[^>]*><span class="chip">2026-05-18<\/span><\/td>/);
  assert.match(out, /<span class="chip">by Fri 17:00<\/span>/);
  assert.doesNotMatch(out, /<span class="chip">next week, pending/);
  assert.match(out, /<span class="pill warn">at risk<\/span>/, 'status words still pill');
  const dated = ds(
    'd',
    ['date', 'release', 'notes'],
    [
      ['2026-05-18', 'v2.1', 'API freeze'],
      ['2026-06-01', 'v2.2', 'GA'],
      ['2026-07-01', 'v2.3', 'Mobile'],
    ],
  );
  const rh = await html(doc([tbl('d')], [dated]));
  assert.doesNotMatch(rh, /<th scope="row"><span class="chip">/, 'a row-header date stays a header');
});

// ---- F.3 progress bars --------------------------------------------------------------------------

test('F.3 table bar= target=: a tick at each row target on the bar scale, with text "target N"', async () => {
  const out = await html(doc([tbl('g', { bars: ['done'], targetCol: 'goal' })], [goals]));
  // scale = max(42, 61, 20, 50, 55, 40) = 61
  assert.match(
    out,
    /<span class="cb tgt" style="--p:68\.9%"><i><\/i><b class="tg" style="--t:82%"><span class="sr">target 50<\/span><\/b>42<\/span>/,
  );
  assert.match(out, /style="--p:100%"><i><\/i><b class="tg" style="--t:90\.2%"><span class="sr">target 55<\/span>/);
  assert.doesNotMatch(out, /title=/, 'no tooltip');
  const over = ds(
    'o',
    ['team', 'done', 'goal'],
    [
      ['A', '50', '120'],
      ['B', '100', '80'],
    ],
  );
  assert.match(
    await html(doc([tbl('o', { bars: ['done'], targetCol: 'goal' })], [over])),
    /--p:41\.7%"><i><\/i><b class="tg" style="--t:100%">/,
    'a target above every bar sets the scale',
  );
  const pct = ds(
    'pc',
    ['team', 'done', 'goal'],
    [
      ['A', '58%', '80%'],
      ['B', '90%', '75%'],
    ],
  );
  assert.match(
    await html(doc([tbl('pc', { bars: ['done'], targetCol: 'goal' })], [pct])),
    /--p:58%"><i><\/i><b class="tg" style="--t:80%">/,
    'percent bars keep their 0-100 scale',
  );
});

test('F.3 table target= without bar= or on a text column is ignored', async () => {
  assert.doesNotMatch(await html(doc([tbl('g', { targetCol: 'goal' })], [goals])), /class="tg"/);
  assert.doesNotMatch(await html(doc([tbl('g', { bars: ['done'], targetCol: 'owner' })], [goals])), /class="tg"/);
  assert.doesNotMatch(await html(doc([tbl('g', { bars: ['done'], targetCol: 'nope' })], [goals])), /class="tg"/);
  assert.match(
    await html(doc([tbl('g', { bars: ['done'], targetCol: 'owner' })], [goals])),
    /class="cb" style="--p:68\.9%"/,
    'bars unchanged',
  );
});

test('F.3 kpi | bar: a progress bar under the value, tone-coloured, only for 0-100', async () => {
  const out = await html(
    doc([
      kpis(
        kpi('Rollout', '58%', { bar: true }),
        kpi('Coverage', '91', { bar: true, tone: 'good' }),
        kpi('Budget', '$2.1M', { bar: true }),
        kpi('Load', '140%', { bar: true }),
      ),
    ]),
  );
  assert.match(
    out,
    /<span class="kl">Rollout<\/span><span class="kv">58%<\/span><span class="kbar" aria-hidden="true"><i style="width:58%"><\/i><\/span>/,
  );
  assert.match(out, /<span class="kbar good" aria-hidden="true"><i style="width:91%">/);
  assert.equal((out.match(/class="kbar/g) ?? []).length, 2, 'no bar for a money value or a value over 100');
  assert.match(
    await render(doc([kpis(kpi('Done', '73%', { bar: true, tone: 'bad' }))]), { fragment: true }),
    /kpi hero[\s\S]*<span class="kbar bad"/,
  );
});

// ---- known defects ------------------------------------------------------------------------------

test('defect page 91: bold that contains inline code or a link is rendered, never left as literal **', async () => {
  assert.equal(
    inline('**Stage it on the canary proxy `edge-canary-01` only.**'),
    '<strong>Stage it on the canary proxy <code>edge-canary-01</code> only.</strong>',
  );
  assert.equal(inline('**see [the runbook](runbook.html) first**'), '<strong>see <a href="runbook.html">the runbook</a> first</strong>');
  assert.equal(inline('`**not bold**` and *em `x` y*'), '<code>**not bold**</code> and <em>em <code>x</code> y</em>');
  assert.equal(inline('a \\*literal\\* star'), 'a *literal* star');
  const { html: page } = await compile(
    '# Runbook\n\n3. **Stage it on the canary proxy `edge-canary-01` only.**\n-- 1. Copy it.\n4. **Verify.**\n-- 1. Check it.\n',
  );
  assert.doesNotMatch(page.replace(/<code>[^<]*<\/code>/g, ''), /\*\*/);
  const cellDoc = doc(
    [tbl('s')],
    [
      ds(
        's',
        ['step', 'action'],
        [
          ['3', '**Stage on `edge-canary-01` only**'],
          ['4', 'Verify'],
        ],
      ),
    ],
  );
  const cellOut = await html(cellDoc);
  assert.match(cellOut, /<strong>Stage on <code>edge-canary-01<\/code> only<\/strong>/);
  assert.doesNotMatch(cellOut, /\*\*/);
});

const page85 = () => readFileSync(new URL('../../../bench/gen/opus-r5/C/85.lede', import.meta.url), 'utf8');

test('defect page 85: the seven-column results table stacks into cards on the phone', async () => {
  // The judges' "clipped Q3 column" was the comparison page (P045 left = arm B, key.json); Lede's
  // page stacks. This pins that, and the browser battery below measures it at 400px.
  const { html: out } = await compile(page85());
  assert.match(out, /<table class="lt stack/);
});

// ---- browser battery ----------------------------------------------------------------------------

const fixtures: Record<string, () => Promise<string>> = {
  cards3: () =>
    render(
      doc(
        [
          { type: 'heading', level: 2, text: 'Options', line: 1 },
          cards(
            [
              'Revenue',
              [
                kpis(
                  kpi('Q3 revenue', '$2,134,000', { delta: '+8.4%', tone: 'good' }),
                  kpi('Trailing profit', '$1,117,000', { note: '2026-05-18' }),
                  kpi('Margin', '17.6%', { bar: true }),
                ),
              ],
            ],
            ['By quarter', [tbl('q', { title: 'Quarterly results' })]],
            [
              'Option B (recommended)',
              [
                p('Adopt the managed queue. It removes broker on-call and halves the p95.'),
                ul('Two weeks to migrate', 'Costs **$4,000** more a month'),
                { type: 'note', tone: 'warn', text: 'Needs a security review first.', line: 1 },
              ],
            ],
          ),
        ],
        [quarters],
      ),
    ),
  cards5: () =>
    render(
      doc(
        [
          cards(
            ['Latency', [chart('t', 'week', ['p95'], { unit: 'ms', title: 'p95 by week' })]],
            ['Errors', [chart('t', 'week', ['errors'], { kind: 'bar' })]],
            ['Goals', [tbl('g', { bars: ['done'], targetCol: 'goal' })]],
            ['Plan', [tbl('plans')]],
            ['Note', [{ type: 'note', tone: 'warn', text: 'The Q3 figures are **unaudited** and may move.', line: 1 }]],
          ),
        ],
        [trend, goals, plans],
      ),
    ),
  cards4: () =>
    render(
      doc([
        cards(optionCard('Kafka (self-hosted)'), optionCard('Managed queue (recommended)'), optionCard('SQS'), optionCard('Do nothing')),
      ]),
    ),
  steps: () =>
    render(
      doc([
        steps(
          [
            'Freeze deploys across every production region',
            'by 03:00 UTC',
            'Post in #deploys and pin it. Tell the on-call in every timezone before you start.',
          ],
          ['Drain the canary', 'Blocked', 'Waiting on the network team.'],
          ['Rotate the certificate', '2026-03-01'],
          ['Write the postmortem'],
        ),
      ]),
    ),
  chips: () =>
    render(
      doc(
        [
          kpis(
            kpi('Migration', '82%', { delta: 'On track', tone: 'good', bar: true }),
            kpi('Next review', 'Board', { note: '2026-05-18' }),
            kpi('Cutover', '3 sites', { delta: 'by Fri 17:00' }),
          ),
          tbl('plans'),
        ],
        [plans],
      ),
    ),
  bars: () =>
    render(
      doc(
        [
          kpis(kpi('Rollout', '58%', { bar: true, tone: 'neutral' })),
          tbl('g', { bars: ['done'], targetCol: 'goal', title: 'Tickets closed against goal' }),
        ],
        [goals],
      ),
    ),
  page85: async () => (await compile(page85())).html,
};

const require = createRequire(new URL('../../../bench/package.json', import.meta.url));
const skip = resolveChrome() ? false : 'no Chromium found: set CHROME to run the v0.4 block battery';
if (skip) console.warn(`v0.4 block battery skipped: ${skip}`);

const MEASURE = `(() => {
  const out = [];
  const desc = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  if (document.scrollingElement.scrollWidth > innerWidth) out.push('page scrolls sideways: ' + document.scrollingElement.scrollWidth);
  for (const top of document.querySelector('main').children) {
    const tr = top.getBoundingClientRect();
    if (!tr.width) continue;
    for (const el of top.querySelectorAll('*')) {
      if (el.closest('svg') || el.closest('.sr') || el.closest('details:not([open])')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right > tr.right + 1 || r.left < tr.left - 1) out.push(desc(el) + ' extends past ' + desc(top));
    }
  }
  for (const s of document.querySelectorAll('.scroll')) if (!s.closest('details') && s.scrollWidth > s.clientWidth + 1) out.push(desc(s) + ' scrolls sideways');
  for (const c of document.querySelectorAll('.card.lc')) for (const el of c.querySelectorAll('*')) {
    if (el.closest('svg') || el.closest('.sr')) continue;
    const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
    if (r.width > 1 && (r.right > cr.right + 1 || r.left < cr.left - 1)) out.push(desc(el) + ' spills out of its card');
  }
  for (const kv of document.querySelectorAll('.kv')) {
    const tile = kv.closest('.kpi');
    if (tile && kv.scrollWidth > tile.clientWidth) out.push('kpi value ' + kv.textContent + ' is wider than its tile');
  }
  for (const l of document.querySelectorAll('.card.lc .note b.nl')) if (getComputedStyle(l).display === 'none') out.push('a note label is hidden in a card');
  const rows = new Map();
  for (const c of document.querySelectorAll('.lcards>.card')) { const r = c.getBoundingClientRect(); const k = Math.round(r.top); if (rows.has(k) && Math.abs(rows.get(k) - r.height) > 1) out.push('cards in one row differ in height'); rows.set(k, r.height); }
  return out;
})()`;

test('v0.4 blocks (browser): no overflow and no contrast failures at 400px dark and 1280px light', { skip, timeout: 300_000 }, async () => {
  const { chromium } = require('playwright-core') as typeof import('../../../bench/node_modules/playwright-core/index.js');
  const browser = await chromium.launch({ executablePath: resolveChrome()! });
  // LEDE_V04_KEEP=dir keeps the rendered fixtures there for a look.
  const dir = process.env.LEDE_V04_KEEP || mkdtempSync(join(tmpdir(), 'lede-v04-'));
  const found: string[] = [];
  try {
    for (const [name, make] of Object.entries(fixtures)) {
      const file = join(dir, `${name}.html`);
      writeFileSync(file, await make());
      for (const [width, scheme] of [
        [400, 'dark'],
        [1280, 'light'],
      ] as const) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
        const page = await ctx.newPage();
        await page.goto(`file://${file}`, { waitUntil: 'load' });
        for (const m of (await page.evaluate(MEASURE)) as string[]) found.push(`${name} @${width} ${scheme}: ${m}`);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const bad = (await page.evaluate(
          `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.flatMap(v => v.nodes.map(n => n.target.join(' '))))`,
        )) as string[];
        for (const t of bad) found.push(`${name} @${width} ${scheme}: contrast ${t}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    if (!process.env.LEDE_V04_KEEP) rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(found, []);
});
