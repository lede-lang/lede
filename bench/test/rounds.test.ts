// How a generated-page directory maps to its writer and to the other arm's pages (pairs.ts, recount.ts), and that the
// published v0.4 key and recount paths are still what they were.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { otherArmDirs, recountFiles, withoutArmLetter, writerOf } from '../src/rounds.ts';

const BENCH = join(import.meta.dirname, '..');

test('an arm letter comes off first, then the round', () => {
  assert.equal(withoutArmLetter('sonnet-r7h'), 'sonnet-r7');
  assert.equal(withoutArmLetter('sonnet-r7'), 'sonnet-r7');
  assert.equal(withoutArmLetter('opus-r12b'), 'opus-r12');
  assert.equal(withoutArmLetter('sonnet'), 'sonnet');
  assert.equal(writerOf('sonnet-r7h'), 'sonnet');
  assert.equal(writerOf('opus-r6'), 'opus');
  assert.equal(writerOf('haiku'), 'haiku');
  assert.equal(writerOf('haiku-r8'), 'haiku');
});

test('the other arm is looked for under the model, the model without its letter, then the writer', () => {
  assert.deepEqual(otherArmDirs('sonnet-r7h'), ['sonnet-r7h', 'sonnet-r7', 'sonnet']);
  assert.deepEqual(otherArmDirs('sonnet-r7'), ['sonnet-r7', 'sonnet']);
  assert.deepEqual(otherArmDirs('opus-r6'), ['opus-r6', 'opus']);
  assert.deepEqual(otherArmDirs('haiku'), ['haiku']);
});

test('recount: no flag is the v0.4 round; --rows raw-<round> writes recount-<round>', () => {
  assert.deepEqual(recountFiles([]), { rows: 'raw-v04.json', out: 'recount-v04.json' });
  assert.deepEqual(recountFiles(['--rows', 'raw-refine1']), { rows: 'raw-refine1.json', out: 'recount-refine1.json' });
  assert.deepEqual(recountFiles(['--rows', 'raw-heldout3']), { rows: 'raw-heldout3.json', out: 'recount-heldout3.json' });
  assert.deepEqual(recountFiles(['--rows', 'v04']), { rows: 'v04.json', out: 'recount-v04.json' });
  assert.throws(() => recountFiles(['--rows']), /usage/);
  assert.throws(() => recountFiles(['--rows', '../raw-v04']), /usage/);
});

test('recount --dry resolves the v0.4 files and writers without calling the API', () => {
  const run = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [join(BENCH, 'src', 'recount.ts'), ...args], {
        encoding: 'utf8',
        env: { ...process.env, ANTHROPIC_API_KEY: '' },
      }),
    );
  const plain = run('--dry');
  assert.deepEqual(plain, {
    rows: 'results/raw-v04.json',
    out: 'results/recount-v04.json',
    count: 360,
    perWriter: { opus: 120, sonnet: 120, haiku: 120 },
  });
  assert.deepEqual(run('--rows', 'raw-v04', '--dry'), plain);
});

test('pairs.ts --dry reproduces the published v0.4 answer key byte for byte', () => {
  const out = execFileSync(
    process.execPath,
    [join(BENCH, 'src', 'pairs.ts'), 'v04', 'vs=B', 'models=haiku-r6,sonnet-r6,opus-r6', '--dry'],
    { encoding: 'utf8' },
  );
  assert.match(out, /^180 pairs \(dry run: nothing composed\)$/m);
  assert.equal(
    readFileSync(join(BENCH, 'out', 'pairs', 'v04', 'key.dry.json'), 'utf8'),
    readFileSync(join(BENCH, 'results', 'judge', 'v04', 'key.json'), 'utf8'),
  );
});
