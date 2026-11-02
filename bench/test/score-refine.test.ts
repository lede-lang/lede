// score-refine.py on synthetic judge directories: ten tasks per tier, two samples, so one pair is 10 points and a pair the two
// samples split on is 5. Each scenario states the outcomes (L Lede wins, T tie, H HTML wins) and the verdict they must give.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASKS, python, writeRecount, writeRound } from './fixtures.ts';

const SCRIPT = join(import.meta.dirname, '..', 'src', 'score-refine.py');
const tmp = mkdtempSync(join(tmpdir(), 'lede-score-refine-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let runs = 0;

interface Tier {
  /** Baseline outcomes of the ten tasks, sample one and two. */
  base: [string, string];
  primary: [string, string];
  /** The hint arm covers these tasks only; one outcome per task. */
  hintIds: number[];
  hint: [string, string];
  /** Extra output tokens of each revised Lede page (ten), and of each hinted one. */
  extra?: number[];
  extraHint?: number[];
}
const STEP = Array.from({ length: 10 }, (_, i) => 50 + 10 * i); // 50 .. 140: median 95, p90 131

function run(sonnet: Tier, opus: Tier) {
  const dir = join(tmp, String(runs++));
  const tiers = { sonnet, opus };
  const rows: Record<'base' | 'primary' | 'hint', Parameters<typeof writeRound>[1]> = { base: [], primary: [], hint: [] };
  const old: Record<string, number> = {};
  const next: Record<string, number> = {};
  const hints: Record<string, { line: string; hinted: boolean }> = {};
  for (const [tier, t] of Object.entries(tiers)) {
    const pick = (pair: [string, string], ids = TASKS) => ({ s1: pair[0].slice(0, ids.length), s2: pair[1].slice(0, ids.length) });
    rows.base.push({ model: `${tier}-r6`, ids: TASKS, samples: pick(t.base) });
    rows.primary.push({ model: `${tier}-r7`, ids: TASKS, samples: pick(t.primary) });
    rows.hint.push({ model: `${tier}-r7h`, ids: t.hintIds, samples: pick(t.hint, t.hintIds) });
    TASKS.forEach((id, i) => {
      old[`${tier}-r6/C/${id}`] = 700;
      old[`${tier}/B/${id}`] = 4500;
      next[`${tier}-r6/C/${id}`] = 700;
      next[`${tier}-r7/C/${id}`] = 700 + (t.extra ?? STEP)[i];
      next[`${tier}-r7/B/${id}`] = 4500 + 100;
      hints[`${tier}/${id}`] = { line: '', hinted: t.hintIds.includes(id) };
    });
    t.hintIds.forEach((id, i) => (next[`${tier}-r7h/C/${id}`] = 700 + (t.extraHint ?? [30, 40, 50, 60, 70, 80, 90, 100, 110, 120])[i]));
  }
  writeRound(join(dir, 'refine1-base'), rows.base);
  writeRound(join(dir, 'refine1'), rows.primary);
  writeRound(join(dir, 'refine1h'), rows.hint);
  writeRecount(join(dir, 'recount-refine1.json'), next);
  writeRecount(join(dir, 'recount-v04.json'), old);
  writeFileSync(join(dir, 'hints-refine1.json'), JSON.stringify(hints));
  const args = ['refine1-base', 'refine1', 'refine1h'].map((d) => join(dir, d));
  const stdout = execFileSync(
    'python3',
    ['-I', SCRIPT, ...args, join(dir, 'recount-refine1.json'), join(dir, 'recount-v04.json'), join(dir, 'hints-refine1.json')],
    { encoding: 'utf8' },
  );
  const verdict = JSON.parse(readFileSync(join(dir, 'refine1', 'verdict.json'), 'utf8'));
  return { stdout, verdict };
}

const flat = 'HHHHHHHHHH';
const idle = (extra: Partial<Tier> = {}): Tier => ({
  base: [flat, flat],
  primary: [flat, flat],
  hintIds: [71, 72, 73, 74],
  hint: ['HHHH', 'HHHH'],
  ...extra,
});

test('writer reading: both tiers rise by at least 10 points; exactly 10 counts', { skip: !python() }, () => {
  const sonnet = idle({ primary: ['LLHHHHHHHH', 'LLHHHHHHHH'] }); // 0% -> 20%
  const opus = idle({ base: ['LHHHHHHHHH', 'LHHHHHHHHH'], primary: ['LLHHHHHHHH', 'LLHHHHHHHH'] }); // 10% -> 20%: exactly +10
  const { stdout, verdict } = run(sonnet, opus);
  assert.equal(verdict.verdict, 'writer reading');
  assert.equal(verdict.costly, false);
  assert.equal(verdict.label, 'writer reading');
  assert.equal(verdict.tiers.sonnet.delta.primary.points, 20);
  assert.equal(verdict.tiers.sonnet.delta.primary.pairs, 2);
  assert.equal(verdict.tiers.opus.delta.primary.points, 10);
  assert.match(stdout, /verdict: writer reading\n/);
  assert.match(stdout, /claude-sonnet-5-5 judge-v2\.md/);
});

test('extra tokens: median and p90 of the revised pages minus the originals; the qualifiers make it costly', { skip: !python() }, () => {
  const cheap = idle({ primary: ['LLHHHHHHHH', 'LLHHHHHHHH'] });
  const { verdict, stdout } = run(cheap, cheap);
  assert.deepEqual(
    { ...verdict.tiers.sonnet.extraTokens.primary },
    { pages: 10, median: 95, p90: 131, mean: 95 }, // 50..140
  );
  assert.equal(verdict.tiers.sonnet.extraTokens.hint.pages, 4);
  assert.equal(verdict.tiers.sonnet.extraTokens.hint.median, 45); // 30, 40, 50, 60
  assert.equal(verdict.tiers.sonnet.extraTokens.revisedHtml.median, 100); // 4600 against 4500
  // 4600 over a mean revised Lede page of 700 + 95 tokens
  assert.ok(Math.abs(verdict.tiers.sonnet.revisedHtmlToLedeRatio - 4600 / 795) < 1e-9);
  assert.match(stdout, /extra tokens, primary:\s+n=10\s+median 95\s+p90 131/);

  const dear = idle({ primary: ['LLHHHHHHHH', 'LLHHHHHHHH'], extra: STEP.map((x) => x + 100) }); // median 195
  const costly = run(dear, cheap);
  assert.equal(costly.verdict.verdict, 'writer reading');
  assert.equal(costly.verdict.costly, true);
  assert.equal(costly.verdict.label, 'writer reading, costly');
  assert.equal(costly.verdict.tiers.sonnet.qualifiers.medianExtraAtMost150, false);
  assert.equal(costly.verdict.tiers.opus.qualifiers.medianExtraAtMost150, true);
});

test('hint mechanism: the hint arm rises by 10 or more while the primary arm stays under 5', { skip: !python() }, () => {
  // Hinted tasks 71-74. The baseline wins them 0 of 4 (the two it wins are elsewhere), so the like-for-like delta is +50 and the
  // delta against the baseline over all ten tasks, which is 20%, is +30.
  const tier = idle({ base: ['HHHHLLHHHH', 'HHHHLLHHHH'], primary: ['HHHHLLHHHH', 'HHHHLLHHHH'], hint: ['LLHH', 'LLHH'] });
  const { verdict, stdout } = run(tier, tier);
  assert.equal(verdict.verdict, 'hint mechanism');
  assert.equal(verdict.tiers.sonnet.delta.primary.points, 0);
  assert.equal(verdict.tiers.sonnet.delta.hint.points, 50);
  assert.equal(verdict.tiers.sonnet.delta.hint.pairs, 2);
  assert.equal(verdict.tiers.sonnet.delta.hintVsAllBaseline.points, 30);
  assert.equal(verdict.tiers.sonnet.hint.hintedPages, 4);
  assert.equal(verdict.tiers.sonnet.hint.pairs, 4);
  assert.match(stdout, /delta hint\s+\+50\.0 points \(\+2\.0 pairs\)/);
});

test('renderer reading: neither tier rises by more than 5 points in either Lede arm; a fall is no rise', { skip: !python() }, () => {
  // sonnet's primary arm rises by exactly 5 (the samples split on one pair): not "more than 5". opus falls.
  const sonnet = idle({ primary: ['LHHHHHHHHH', flat] });
  const opus = idle({ base: ['LLHHHHHHHH', 'LLHHHHHHHH'], primary: [flat, flat], hint: ['HHHH', 'HHHH'] });
  const { verdict } = run(sonnet, opus);
  assert.equal(verdict.tiers.sonnet.delta.primary.points, 5);
  assert.equal(verdict.tiers.opus.delta.primary.points, -20);
  assert.equal(verdict.verdict, 'renderer reading');
});

test('both: one tier rises and the other does not; and a primary rise of exactly 5 is not "under 5"', { skip: !python() }, () => {
  const rises = idle({ primary: ['LLHHHHHHHH', 'LLHHHHHHHH'] });
  assert.equal(run(rises, idle()).verdict.verdict, 'both');

  // The hint arm rises by 50 in both tiers, but the primary arm rises by exactly 5: hint mechanism needs it under 5.
  const hinted = idle({ primary: ['LHHHHHHHHH', flat], hint: ['LLHH', 'LLHH'] });
  assert.equal(run(hinted, hinted).verdict.verdict, 'both');
});

test('ties count as wins-or-ties and are shown; the sides of a tie do not matter', { skip: !python() }, () => {
  const tied = idle({ primary: ['TTLHHHHHHH', 'TTHHHHHHHH'] }); // sample one: 2 ties and 1 win; sample two: 2 ties
  const { verdict, stdout } = run(tied, tied);
  const primary = verdict.tiers.sonnet.primary;
  assert.deepEqual(primary.samples, { s1: { wins: 1, ties: 2, pairs: 10 }, s2: { wins: 0, ties: 2, pairs: 10 } });
  assert.equal(primary.winOrTie, 25); // (3 + 2) of 20 judgments
  assert.equal(primary.tieRate, 20);
  assert.match(stdout, /primary\s+s1 1\+2\/10\s+s2 0\+2\/10/);
});

test('self-agreement under 80% marks the round to be re-judged and the verdict provisional', { skip: !python() }, () => {
  // 20 primary pairs; the samples split on 5 of them: 15 / 20 = 75%.
  const split = idle({ primary: ['LLLLLHHHHH', 'HHHHHHHHHH'] });
  const { verdict, stdout } = run(split, idle());
  assert.deepEqual(verdict.reJudge, ['primary']);
  assert.deepEqual(verdict.selfAgreement.primary, {
    agree: 15,
    pairs: 20,
    rate: 0.75,
    perTier: { sonnet: { agree: 5, pairs: 10 }, opus: { agree: 10, pairs: 10 } },
  });
  assert.equal(verdict.selfAgreement.base.rate, 1);
  assert.match(stdout, /UNDER 80%: re-judge before recording/);
  assert.match(stdout, /provisional: re-judge primary first/);
});
