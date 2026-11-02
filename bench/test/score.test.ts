// score.ts reads judge samples from s<N>/ as well as the root of a round, skips header records, and shows the mean of the
// samples and the ties; on the published v0.4 round it gives the means in summary.txt, and score-v04.py is unchanged.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASKS, python, writeRound } from './fixtures.ts';

const BENCH = join(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'lede-score-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let rounds = 0;

const scoreTs = (dir: string, ...extra: string[]) =>
  execFileSync(process.execPath, [join(BENCH, 'src', 'score.ts'), dir, ...extra], { encoding: 'utf8' });
const round = () => join(tmp, `round${rounds++}`);

test('v0.4 round: the per-range means are the ones in summary.txt', () => {
  const v04 = join(BENCH, 'results', 'judge', 'v04');
  const copy = round(); // score.ts writes scored.json beside the samples; keep the published round untouched
  cpSync(v04, copy, { recursive: true });
  const out = scoreTs(copy, '--ranges', '71-100,101-130');
  const summary = readFileSync(join(v04, 'summary.txt'), 'utf8');
  const lines = [...summary.matchAll(/^(\S+) (regress|gate) .* mean win-or-tie ([\d.]+%)$/gm)];
  assert.equal(lines.length, 6);
  for (const [, model, range, mean] of lines) {
    const ids = range === 'regress' ? '71-100' : '101-130';
    assert.ok(out.includes(`${model} ${ids}: mean win-or-tie ${mean} `), `${model} ${ids} ${mean}`);
  }
  assert.match(out, /judge self-agreement \(s1 and s2\): 168 \/ 180/);
  assert.match(out, /haiku-r6: mean win-or-tie 69\.2% /); // the tier over both ranges: (78.3 + 60.0) / 2
});

test('score-v04.py still prints the summary.txt of the published round', { skip: !python() }, () => {
  const out = execFileSync('python3', ['-I', join(BENCH, 'src', 'score-v04.py'), join(BENCH, 'results', 'judge', 'v04')], {
    encoding: 'utf8',
  });
  assert.equal(out, readFileSync(join(BENCH, 'results', 'judge', 'v04', 'summary.txt'), 'utf8'));
});

test('several samples: one block each, then the mean of the samples with ties shown; header records are skipped', () => {
  const dir = round();
  // sample one: 2 wins and a tie; sample two: 1 win and 2 ties. Both are 3 of 10 win-or-tie.
  writeRound(dir, [{ model: 'sonnet-r7', ids: TASKS, samples: { s1: 'LLTHHHHHHH', s2: 'LTTHHHHHHH' } }]);
  const out = scoreTs(dir);
  assert.match(out, /^sample s1:\npairs judged 10 of 10\nsonnet-r7: win-or-tie 3\/10 = 30\.0% \(wins 2, ties 1\)/);
  assert.match(out, /sample s2:\npairs judged 10 of 10\nsonnet-r7: win-or-tie 3\/10 = 30\.0% \(wins 1, ties 2\)/);
  assert.match(out, /mean of samples \(s1, s2\):\nsonnet-r7: mean win-or-tie 30\.0% \(mean wins 1\.5, mean ties 1\.5 of 10\/10\)/);
  assert.match(out, /judge self-agreement \(s1 and s2\): 9 \/ 10/); // the samples differ on the second pair only (a win, then a tie)
});

test('rounds 1 and 2 keep their one sample at the root; heldout2 has the first at the root and the second in s2/', () => {
  const single = round();
  writeRound(single, [{ model: 'sonnet-r7', ids: TASKS, samples: { s1: 'LLTHHHHHHH' } }], { root: true });
  const one = scoreTs(single);
  assert.match(one, /^pairs judged 10 of 10\nsonnet-r7: win-or-tie 3\/10 = 30\.0% \(wins 2, ties 1\)/);
  assert.doesNotMatch(one, /mean of samples/);

  const split = round();
  writeRound(split, [{ model: 'sonnet-r7', ids: TASKS, samples: { s1: 'LLTHHHHHHH', s2: 'LHHHHHHHHH' } }], { root: true });
  const two = scoreTs(split);
  assert.match(two, /sample s1:\npairs judged 10 of 10/);
  assert.match(two, /mean of samples \(s1, s2\):\nsonnet-r7: mean win-or-tie 20\.0% /);
});
