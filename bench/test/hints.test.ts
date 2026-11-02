// hints.ts: the hint line of the refinement test's hint arm. Six inline pages (one per rule, one that fires nothing) with the
// exact text, then the cases that keep a rule quiet and the cap of three.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEP, hintLine, hintsFor } from '../src/hints.ts';

const lines = (...ls: string[]) => `${ls.join('\n')}\n`;

const KPI = lines('# Q3 review', 'Revenue reached $4.2M, up 12% on the quarter, with p95 latency at 182 ms.', '## Detail', 'Nothing else.');
const CARDS = lines(
  '# Choosing a vendor',
  '## Options',
  '### Option A',
  'Cheap and slow to deliver.',
  '### Option B',
  'Costly but fast.',
  '### Option C',
  'Middle of the road.',
);
const STEPS = lines(
  '# Migration',
  '## Next steps',
  '- 2026-11-02 Freeze the schema',
  '- 2026-11-09 Cut over the reads',
  '- 2026-11-16 Retire the old tables',
);
const RANGE = lines(
  '# Plan',
  '## Schedule',
  'data plan = task,start,end; Design,2026-03-02,2026-03-20; Build,2026-03-16,2026-05-08; Launch,2026-05-04,2026-05-29',
  'table plan title="Plan"',
);
const BAR = lines('# Results', '## Coverage', 'data cov = team,coverage; Core,92%; Edge,78%; Infra,64%', 'table cov');
const NOTHING = lines('# Notes', 'Short notes for the team.', '## Details', '- one', '- two');

test('rule 1: no kpi block and three numbers with a unit in the first paragraph', () => {
  assert.deepEqual(hintsFor(KPI), ['a kpi row for the headline numbers']);
  assert.equal(hintLine(KPI), `Consider: a kpi row for the headline numbers. ${KEEP}`);
});

test('rule 2: short ### sections side by side under one ## want cards', () => {
  assert.deepEqual(hintsFor(CARDS), ['`cards` before the ### sections under "Options"']);
  assert.equal(hintLine(CARDS), `Consider: \`cards\` before the ### sections under "Options". ${KEEP}`);
});

test('rule 3: three dated list items want step lines (the dates are not numbers with a unit)', () => {
  assert.deepEqual(hintsFor(STEPS), ['`step` lines for the dated actions under "Next steps"']);
  assert.equal(hintLine(STEPS), `Consider: \`step\` lines for the dated actions under "Next steps". ${KEEP}`);
});

test('rule 4: a table with a start and an end column of dates wants chart range', () => {
  assert.deepEqual(hintsFor(RANGE), ['`chart range` for the spans in "Plan"']);
  assert.equal(hintLine(RANGE), `Consider: \`chart range\` for the spans in "Plan". ${KEEP}`);
});

test('rule 5: a table with a percent column and no bar= wants bar=', () => {
  assert.deepEqual(hintsFor(BAR), ['`bar=` on the percent column of "Coverage"']);
  assert.equal(hintLine(BAR), `Consider: \`bar=\` on the percent column of "Coverage". ${KEEP}`);
});

test('a page no rule fires on gets no hint: an empty array and an empty line', () => {
  assert.deepEqual(hintsFor(NOTHING), []);
  assert.equal(hintLine(NOTHING), '');
});

test('what each rule already sees on the page keeps it quiet', () => {
  assert.deepEqual(hintsFor(lines('kpi Revenue | $4.2M', KPI)), []); // a kpi block
  assert.deepEqual(hintsFor(lines('# Q3', 'Revenue was $4.2M and 12% up on 2025 with 182 ms')), ['a kpi row for the headline numbers']);
  assert.deepEqual(hintsFor(lines('# Q3', 'Revenue was $4.2M and 12% up.')), []); // two numbers with a unit
  assert.deepEqual(hintsFor(lines('# Q3', 'Shipped on 2026-10-16, week 42, in room W12.')), []); // dates and ids are not numbers
  // `cards` above the sections: they are cards already, whether the run is open or the rule closed it
  assert.deepEqual(hintsFor(lines('# V', '## Options', 'cards', '### A', 'Cheap.', '### B', 'Fast.', '### C', 'Middle.')), []);
  assert.deepEqual(hintsFor(lines('# V', '## Options', 'cards', '### A', 'Cheap.', '---', '### B', 'Fast.', '### C', 'Middle.')), []);
  // sections that are long, or hold a table, are not card text; a single short section is not a row of options
  const long = 'x'.repeat(241);
  assert.deepEqual(hintsFor(lines('# V', '## Options', '### A', long, '### B', long)), []);
  assert.deepEqual(hintsFor(lines('# V', '## Options', '### A', 'Short.', '### B', long, '### C', 'Short.')), []);
  assert.deepEqual(hintsFor(lines('# V', '## Options', '### A', 'Short.', '## Other', '### B', 'Short.')), []);
  assert.deepEqual(hintsFor(lines('# V', '## Options', '### A', 'Short.', 'table = a,b; 1,2', '### B', 'Short.')), []);
  assert.deepEqual(hintsFor(lines('# V', '### A', 'Short.', '### B', 'Short.')), []); // not under a ##
  // a step block, or one item without a date
  assert.deepEqual(hintsFor(lines(STEPS, 'step Freeze | 2026-11-02')), []);
  assert.deepEqual(hintsFor(lines('# M', '## Next', '- 2026-11-02 Freeze', '- Cut over the reads', '- 2026-11-16 Retire')), []);
  assert.deepEqual(hintsFor(lines('# M', '## Next', '- Mon Freeze', '- Tuesday Cut over', '- Week 3 Retire')), [
    '`step` lines for the dated actions under "Next"',
  ]);
  assert.deepEqual(hintsFor(lines('# M', '## Next', '- 2026-11-02 Freeze', '- 2026-11-16 Retire')), []); // only two items
  // a range chart on the page, a bar= on the table, a start column with nothing to end it
  assert.deepEqual(hintsFor(lines(RANGE, 'chart range plan from=start to=end')), []);
  assert.deepEqual(hintsFor(RANGE.replace('start,end', 'begin,finish')), ['`chart range` for the spans in "Plan"']); // other words for the same
  assert.deepEqual(hintsFor(lines('# P', 'data p = task,start; A,1; B,2', 'table p')), []);
  assert.deepEqual(hintsFor(lines(BAR, 'table cov bar=coverage')), ['`bar=` on the percent column of "Coverage"']); // one bare table is enough
  assert.deepEqual(hintsFor(lines('# R', '## Coverage', 'data cov = team,coverage; Core,92%; Edge,78%', 'table cov bar=coverage')), []);
  assert.deepEqual(hintsFor(lines('# R', '## Coverage', 'data cov = team,coverage; Core,92%; Edge,78', 'table cov')), []); // not every cell ends in %
});

test('at most three hints, in rule order', () => {
  const page = lines(
    '# Everything',
    'Revenue $4.2M, up 12%, p95 182 ms.',
    '## Options',
    '### A',
    'Cheap.',
    '### B',
    'Fast.',
    '## Next steps',
    '- 2026-11-02 Freeze',
    '- 2026-11-09 Cut over',
    '- 2026-11-16 Retire',
    '## Coverage',
    'data cov = team,coverage; Core,92%; Edge,78%',
    'table cov',
  );
  assert.deepEqual(hintsFor(page), [
    'a kpi row for the headline numbers',
    '`cards` before the ### sections under "Options"',
    '`step` lines for the dated actions under "Next steps"',
  ]);
  assert.equal(
    hintLine(page),
    `Consider: a kpi row for the headline numbers; \`cards\` before the ### sections under "Options"; \`step\` lines for the dated actions under "Next steps". ${KEEP}`,
  );
});

test('the same page gives the same line, and the command prints it (an empty line when there is none)', () => {
  assert.equal(hintLine(KPI), hintLine(KPI));
  const dir = mkdtempSync(join(tmpdir(), 'lede-hints-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'kpi.lede'), KPI);
  writeFileSync(join(dir, 'none.lede'), NOTHING);
  const cli = (file: string) =>
    execFileSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'hints.ts'), join(dir, file)], { encoding: 'utf8' });
  assert.equal(cli('kpi.lede'), `${hintLine(KPI)}\n`);
  assert.equal(cli('none.lede'), '\n');
});
