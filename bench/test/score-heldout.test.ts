// score-heldout.py on a synthetic held-out round: eleven categories of five tasks (ids 131-185), three tiers, two samples.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES } from '../src/task-vocab.ts';
import { python, writeRound } from './fixtures.ts';

const SCRIPT = join(import.meta.dirname, '..', 'src', 'score-heldout.py');
const IDS = Array.from({ length: 55 }, (_, i) => 131 + i);

const tmp = mkdtempSync(join(tmpdir(), 'lede-score-heldout-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const tasks = join(tmp, 'tasks');
mkdirSync(tasks);
IDS.forEach((id, i) =>
  writeFileSync(join(tasks, `${id}-task.json`), JSON.stringify({ id: `${id}-task`, category: CATEGORIES[Math.floor(i / 5)] })),
);

/** One five-letter pattern per category, in the order above, joined into the 55 outcomes of a tier. */
const tier = (model: string, s1: string[], s2: string[]) => ({ model, ids: IDS, samples: { s1: s1.join(''), s2: s2.join('') } });
const all = (five: string) => CATEGORIES.map(() => five);

let rounds = 0;
function score(models: ReturnType<typeof tier>[], min = 131, max = 185, root = false) {
  const dir = join(tmp, `round${rounds++}`);
  writeRound(dir, models, { root });
  return execFileSync('python3', ['-I', SCRIPT, dir, String(min), String(max), '--tasks', tasks], { encoding: 'utf8' });
}
const section = (out: string, model: string) =>
  out.split('\n\n').find((s) => s.startsWith(`${model}  tasks`)) ?? assert.fail(`no section for ${model}`);

test('a tier at exactly 60% passes; the range of three of five is the exact binomial one', { skip: !python() }, () => {
  const out = score([tier('haiku-r8', all('LLLHH'), all('LHLHL'))]);
  const haiku = section(out, 'haiku-r8');
  assert.match(haiku, /s1\s+33 wins \+ 0 ties of 55 = 60\.0% win-or-tie/);
  assert.match(haiku, /mean win-or-tie 60\.0%/);
  assert.match(haiku, /D22 reading: PASS overall \(60% bar\)\n/);
  assert.match(haiku, /architecture\s+s1 3\+0\/5\s+s2 3\+0\/5\s+mean\s+60%\s+range \[14\.7%, 94\.7%\]/);
  assert.doesNotMatch(haiku, /FLOOR/);
});

test('below 60% fails; a category under 40% is named even when the tier passes', { skip: !python() }, () => {
  const failing = score([tier('opus-r8', all('LHHHH'), all('HHHHH'))]);
  assert.match(section(failing, 'opus-r8'), /D22 reading: FAIL overall \(60% bar\)/);

  // Ten categories win everything, "runbook" (the fifth) wins one pair in one sample: a mean of half a pair, 10%.
  const s1 = CATEGORIES.map((c) => (c === 'runbook' ? 'LHHHH' : 'LLLLL'));
  const s2 = CATEGORIES.map((c) => (c === 'runbook' ? 'HHHHH' : 'LLLLL'));
  const passing = section(score([tier('sonnet-r8', s1, s2)]), 'sonnet-r8');
  assert.match(passing, /D22 reading: PASS overall \(60% bar\); below the 40% floor in runbook\n/);
  assert.match(passing, /runbook\s+s1 1\+0\/5\s+s2 0\+0\/5\s+mean\s+10%\s+range \[0\.0%, 62\.9%\].*BELOW 40% FLOOR/);
  assert.equal((passing.match(/BELOW 40% FLOOR/g) ?? []).length, 1);
});

test('exactly 40% is not below the floor; ties are win-or-tie and are shown', { skip: !python() }, () => {
  const out = section(score([tier('haiku-r8', all('TLHHH'), all('TTHHH'))]), 'haiku-r8');
  assert.doesNotMatch(out, /FLOOR/);
  assert.match(out, /s1\s+11 wins \+ 11 ties of 55 = 40\.0% win-or-tie/);
  assert.match(out, /mean ties 16\.5 \(30\.0%\)/);
  assert.match(out, /D22 reading: FAIL/);
});

test('self-agreement counts the same side or both tie, and the range of ids selects the pairs', { skip: !python() }, () => {
  const s1 = all('LLLLL');
  const s2 = CATEGORIES.map((_, i) => (i < 2 ? 'HHHHH' : 'LLLLL')); // the samples split on the ten pairs of two categories
  const out = score([tier('haiku-r8', s1, s2)]);
  assert.match(out, /judge self-agreement 45 \/ 55 \(81\.8%\)/);
  assert.match(section(out, 'haiku-r8'), /self-agreement 45 \/ 55/);

  // Only the first category's ids (131-135): five pairs, and no other category in the output.
  const narrow = score([tier('haiku-r8', s1, s2)], 131, 135);
  assert.match(section(narrow, 'haiku-r8'), /5 pairs\n/);
  assert.match(narrow, /architecture/);
  assert.doesNotMatch(narrow, /comparison/);
});

test('sample one may sit at the root of the round, and header records are skipped', { skip: !python() }, () => {
  const out = score([tier('haiku-r8', all('LLLHH'), all('LLLHH'))], 131, 185, true);
  assert.match(out, /samples: s1, s2/);
  assert.match(section(out, 'haiku-r8'), /mean win-or-tie 60\.0%/);
});
