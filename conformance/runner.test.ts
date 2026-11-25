// The runner against the reference CLI (must score 100%) and against a stub that prints `{}` (must fail and exit non-zero).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { here, listCases } from './shared.ts';

const runner = join(here, 'runner.ts');
const cli = `node ${join(here, '..', 'packages', 'cli', 'src', 'cli.ts')}`;
const total = listCases('cases').length + listCases('errors').length;

const go = (cmd: string, ...extra: string[]) =>
  spawnSync('node', [runner, '--cmd', cmd, '--json', ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

test('the reference CLI passes every case', () => {
  const r = go(cli);
  assert.equal(r.status, 0, r.stdout.slice(-400));
  const report = JSON.parse(r.stdout);
  assert.equal(report.total, total);
  assert.equal(report.passed, total);
  assert.equal(report.percent, 100);
});

test('a stub that prints {} fails and exits non-zero', () => {
  const r = go(`node -e "console.log('{}')" --`);
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.passed, 0);
  assert.equal(report.total, total);
});

test('--filter narrows the run', () => {
  const r = go(cli, '--filter', 'errors/e01');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).total, 1);
});
