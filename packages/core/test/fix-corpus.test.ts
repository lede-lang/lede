import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fix } from '../src/index.ts';

// Pages that writers produced before the fixer existed, as written. `check --fix` must keep repairing these;
// a change that makes one stop passing is a regression in the fixer, not in the page.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const gen = readdirSync(join(root, 'bench/gen'))
  .map((m) => `bench/gen/${m}/C`)
  .filter((d) => existsSync(join(root, d)));
const dirs = [
  'examples/article/as-written',
  'bench/article/r2/as-written',
  'bench/article/r3/as-written',
  'bench/article/r4/as-written',
  ...gen,
];
// r3-10 charts data the writer never declared; no repair can invent it.
const UNREPAIRABLE = new Map([['bench/article/r3/as-written/r3-10.lede', ['unknown-data']]]);

for (const dir of dirs) {
  for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith('.lede'))) {
    test(`fix repairs ${dir}/${name}`, () => {
      const r = fix(readFileSync(join(root, dir, name), 'utf8'));
      const errors = r.remaining.filter((d) => d.severity === 'error').map((d) => d.code);
      assert.deepEqual(errors, UNREPAIRABLE.get(`${dir}/${name}`) ?? []);
    });
  }
}

// The exact repairs for the v0.4 benchmark's quoting slips (D52). A rule that stops the page erroring but reads a
// cell differently fails here, where the error count alone would not notice.
const read = (file: string, n: number) => readFileSync(join(root, file), 'utf8').split('\n')[n - 1];
const line = (file: string, n: number) => fix(readFileSync(join(root, file), 'utf8')).src.split('\n')[n - 1];

test('haiku-r6/79: a `;` in the middle of a row rejoins the two short rows it made', () => {
  const file = 'bench/gen/haiku-r6/C/79.lede';
  const cell = 'Not available; we would archive ourselves';
  assert.equal(line(file, 7), read(file, 7).replace(cell, `"${cell}"`));
});

test('opus-r6/109: a fragment after a full row rejoins its last cell', () => {
  const file = 'bench/gen/opus-r6/C/109.lede';
  const cell = 'Treat patients; open 17:00 to 23:00 only';
  assert.equal(line(file, 30), read(file, 30).replace(cell, `"${cell}"`));
});

test('opus-r6/126: a label split at a thousands comma is rejoined, numbers stay in their columns', () => {
  assert.equal(
    line('bench/gen/opus-r6/C/126.lede', 19),
    'table = level,gifts,amount; "Lead (over $100,000)",6,$2.10M; "Major ($10,000 to $100,000)",74,$0.93M; ' +
      '"Community (under $10,000)","1,780",$0.39M; **Total**,"**1,860**",**$3.42M**',
  );
});
