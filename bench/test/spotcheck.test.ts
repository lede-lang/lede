// spotcheck.py --dry on the published v0.4 key (no screenshots are needed to choose pairs): which pairs it picks, how many per
// category, that the choice is a function of the seed, and that the page would show neither the round nor the pair.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { python } from './fixtures.ts';

const BENCH = join(import.meta.dirname, '..');
const SCRIPT = join(BENCH, 'src', 'spotcheck.py');
const tmp = mkdtempSync(join(tmpdir(), 'lede-spotcheck-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let maps = 0;

const category = new Map(
  readdirSync(join(BENCH, 'tasks')).map((f) => [
    String(Number(/^\d+/.exec(f)![0])),
    (JSON.parse(readFileSync(join(BENCH, 'tasks', f), 'utf8')) as { category: string }).category,
  ]),
);

function pick(...args: string[]) {
  const map = join(tmp, `map${maps++}.json`);
  const run = spawnSync('python3', ['-I', SCRIPT, ...args, '--dry', '--map', map], { encoding: 'utf8' });
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    map:
      run.status === 0
        ? (JSON.parse(readFileSync(map, 'utf8')) as {
            item: string;
            round: string;
            pair: string;
            model: string;
            task: string;
            category: string;
          }[])
        : [],
  };
}

test('six tasks per tier over the six categories is one task from each; the pair ids are printed first', { skip: !python() }, () => {
  const r = pick('refine1', '--seed', '20261102', '--tasks', '6', '--tier', 'sonnet,opus', '--arms', 'v04');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'the page goes to stdout; a dry run builds none');
  assert.match(r.stderr, /^spot check refine1: seed 20261102, 6 tasks per tier, tiers sonnet,opus, rounds v04\n/);
  assert.equal(r.map.length, 12);
  for (const tier of ['sonnet', 'opus']) {
    const mine = r.map.filter((m) => m.model === `${tier}-r6`);
    assert.equal(mine.length, 6);
    assert.deepEqual(
      mine.map((m) => category.get(m.task)).toSorted((a, b) => String(a).localeCompare(String(b))),
      ['architecture', 'comparison', 'data', 'prose', 'runbook', 'status'],
    );
    assert.equal(
      mine.every((m) => category.get(m.task) === m.category),
      true,
    );
  }
  // every chosen pair id appears in the plan on stderr before the pairs line
  for (const m of r.map) assert.ok(r.stderr.indexOf(m.pair) < r.stderr.indexOf('12 pairs:'), m.pair);
  // the page names neither the round nor the pair
  assert.deepEqual(
    r.map.map((m) => m.item),
    Array.from({ length: 12 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`),
  );
});

test(
  'the same seed picks the same pairs, another seed other ones, and a tier alone picks what it picks in company',
  { skip: !python() },
  () => {
    const args = ['refine1', '--tasks', '6', '--tier', 'sonnet,opus', '--arms', 'v04'];
    const a = pick(...args, '--seed', '20261102');
    assert.deepEqual(pick(...args, '--seed', '20261102').map, a.map);
    assert.notDeepEqual(
      pick(...args, '--seed', '20261103').map.map((m) => m.pair),
      a.map.map((m) => m.pair),
    );
    const solo = pick('refine1', '--tasks', '6', '--tier', 'opus', '--arms', 'v04', '--seed', '20261102');
    assert.deepEqual(
      solo.map.map((m) => m.pair).toSorted((x, y) => x.localeCompare(y)),
      a.map
        .filter((m) => m.model === 'opus-r6')
        .map((m) => m.pair)
        .toSorted((x, y) => x.localeCompare(y)),
    );
  },
);

test('twelve tasks over six categories is two from each', { skip: !python() }, () => {
  const r = pick('heldout3', '--seed', '20261103', '--tasks', '12', '--tier', 'haiku', '--arms', 'v04');
  const counts = new Map<string, number>();
  for (const m of r.map) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  assert.deepEqual([...counts.values()], [2, 2, 2, 2, 2, 2]);
  assert.equal(new Set(r.map.map((m) => m.task)).size, 12);
});

test('pairs named by hand still work, and the two ways of choosing do not mix', { skip: !python() }, () => {
  const named = pick('v04', 'P001', 'P061');
  assert.equal(named.status, 0, named.stderr);
  assert.deepEqual(
    named.map.map((m) => [m.item, m.pair]),
    [
      ['P001', 'P001'],
      ['P061', 'P061'],
    ],
  );
  const both = pick('v04', 'P001', '--arms', 'v04', '--seed', '1', '--tasks', '1', '--tier', 'sonnet');
  assert.notEqual(both.status, 0);
  assert.match(both.stderr, /use one/);
  assert.notEqual(pick('v04', '--arms', 'v04', '--tier', 'sonnet').status, 0); // no seed or task count
});
