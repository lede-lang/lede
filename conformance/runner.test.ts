// The runner, several cases at once, against the reference CLI (must score 100%) and against a stub that
// prints `{}` (must fail and exit non-zero).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { POOL } from '../bench/src/pool.ts';
import { here, listCases } from './shared.ts';

const runner = join(here, 'runner.ts');
const cli = `node ${join(here, '..', 'packages', 'cli', 'src', 'cli.ts')}`;
const total = listCases('cases').length + listCases('errors').length;

const jobs = String(POOL);
const go = (cmd: string, ...extra: string[]) =>
  spawnSync('node', [runner, '--cmd', cmd, '--json', '--jobs', jobs, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

test('the reference CLI passes every case', () => {
  const r = go(cli);
  assert.equal(r.status, 0, r.stdout.slice(-400));
  const report = JSON.parse(r.stdout);
  assert.equal(report.total, total);
  assert.equal(report.passed, total);
  assert.equal(report.percent, 100);
});

// A few cases show the failures are counted; the reference pass above covers every case.
test('a stub that prints {} fails and exits non-zero', () => {
  const r = go(`node -e "console.log('{}')" --`, '--filter', 'errors/e0');
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.total > 0);
  assert.equal(report.passed, 0);
});

test('--filter narrows the run', () => {
  const r = go(cli, '--filter', 'errors/e01');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).total, 1);
});

test('--jobs takes a whole number above zero', () => {
  for (const bad of ['0', '-1', '1.5', 'many']) {
    const r = spawnSync('node', [runner, '--cmd', cli, '--jobs', bad], { encoding: 'utf8' });
    assert.equal(r.status, 2, bad);
    assert.match(r.stderr, /--jobs/);
  }
});
