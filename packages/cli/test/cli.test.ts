import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (args: string[], cwd: string) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

test('data files are confined to the document directory, symlinks included', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const outside = mkdtempSync(join(tmpdir(), 'lede-secret-'));
  writeFileSync(join(outside, 'secret.csv'), 'k,v\nTOKEN,hunter2\n');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'ok.csv'), 'a,b\n1,2\n');
  symlinkSync(join(outside, 'secret.csv'), join(dir, 'sub', 'link.csv'));
  writeFileSync(
    join(dir, 'page.lede'),
    `data ok < sub/ok.csv\ndata up < ../${outside.split('/').pop()}/secret.csv\ndata ln < sub/link.csv\ntable ok\n`,
  );
  const r = run(['check', 'page.lede', '--json'], dir);
  const diags = JSON.parse(r.stdout)['page.lede'] as { code: string; line: number }[];
  assert.deepEqual(
    diags.filter((d) => d.code === 'data-file').map((d) => d.line),
    [2, 3],
  );
  assert.doesNotMatch(r.stdout + r.stderr, /hunter2/);
});

test('build refuses to write when there are errors, and writes with --force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'bad.lede'), '# Hi\nchart line nope\n');
  assert.equal(run(['build', 'bad.lede', '-o', 'out.html'], dir).status, 1);
  assert.equal(run(['build', 'bad.lede', '-o', 'out.html', '--force'], dir).status, 0);
});

test('check --fix rewrites the file, reports each repair, and exits 0 when it is clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), 'data t = a,b; one,Nice; no link\ntable t\n#### Deep\n');
  const r = run(['check', 'p.lede', '--fix'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /p\.lede:1: fixed \[data-row-width\].*a guess/);
  assert.match(r.stderr, /p\.lede:3: fixed \[heading-depth\]/);
  assert.equal(readFileSync(join(dir, 'p.lede'), 'utf8'), 'data t = a,b; one,"Nice; no link"\ntable t\n### Deep\n');
});

test('--help lists the commands and flags and exits 0, with or without a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  for (const args of [['--help'], ['-h'], ['help'], ['check', '--help']]) {
    const r = run(args, dir);
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, /--dry-run/);
    assert.match(r.stdout, /lede check/);
  }
});

test('check --fix --dry-run prints the changed lines, writes nothing, and exits like check on the file as written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const src = 'data t = a,b; one,Nice; no link\ntable t\n';
  writeFileSync(join(dir, 'p.lede'), src);
  const r = run(['check', 'p.lede', '--fix', '--dry-run'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /would fix \[data-row-width\]/);
  assert.match(r.stderr, /\+ data t = a,b; one,"Nice; no link"/);
  assert.equal(readFileSync(join(dir, 'p.lede'), 'utf8'), src);
});

test('check ends with ok only when nothing was reported; a warning or an error gets its count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'clean.lede'), '# Hi\n');
  writeFileSync(join(dir, 'warn.lede'), 'kpi Share | ~75% | roughly three-quarters | bar\n');
  writeFileSync(join(dir, 'both.lede'), 'kpi Share | ~75% | x | bar\ndata t = a,b; one,Nice; no link\ntable t\n');
  const last = (r: { stderr: string }) => r.stderr.trimEnd().split('\n').at(-1);

  const clean = run(['check', 'clean.lede'], dir);
  assert.equal(clean.status, 0);
  assert.equal(last(clean), 'ok');

  const warn = run(['check', 'warn.lede'], dir);
  assert.equal(warn.status, 0, 'a warning is not an error: the exit code stays 0');
  assert.match(warn.stderr, /\[kpi-bar\]/);
  assert.equal(last(warn), '1 warning(s)');
  assert.doesNotMatch(warn.stderr, /\bok\b/);

  const both = run(['check', 'both.lede'], dir);
  assert.equal(both.status, 1);
  assert.equal(last(both), '1 error(s), 1 warning(s)');

  const all = run(['check', 'clean.lede', 'warn.lede', 'both.lede'], dir);
  assert.equal(last(all), '1 error(s), 2 warning(s)', 'the line sums over every file');
  assert.equal(run(['check', 'warn.lede', '--json'], dir).stderr, '', '--json prints no summary line');
});

test('check --fix drops a kpi bar that cannot be drawn and reports it as a guess', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'k.lede'), 'kpi Share | ~75% | roughly three-quarters | bar\n');
  const r = run(['check', 'k.lede', '--fix'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /fixed \[kpi-bar\] bar dropped.*\(a guess: check it\)/);
  assert.equal(r.stderr.trimEnd().split('\n').at(-1), 'ok');
  assert.equal(readFileSync(join(dir, 'k.lede'), 'utf8'), 'kpi Share | ~75% | roughly three-quarters\n');
});

// Regression (#15): process.exit() ended the process before a piped stdout drained, cutting output at the 64 KiB pipe buffer on macOS.
test('build to stdout writes the whole page through a pipe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const page = new URL('../../../examples/kitchen-sink.lede', import.meta.url).pathname;
  const file = join(dir, 'ks.html');
  assert.equal(run(['build', page, '-o', file], dir).status, 0);
  const piped = run(['build', page], dir);
  assert.equal(piped.status, 0);
  assert.ok(Buffer.byteLength(piped.stdout) > 65536, 'the example must be larger than a pipe buffer');
  assert.equal(Buffer.byteLength(piped.stdout), readFileSync(file).length);
});

test('check --fix repairs the three quoting slips of the v0.4 benchmark end to end, each marked a guess', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const gen = new URL('../../../bench/gen/', import.meta.url).pathname;
  const pages = ['haiku-r6/C/79.lede', 'opus-r6/C/109.lede', 'opus-r6/C/126.lede'];
  for (const [k, p] of pages.entries()) writeFileSync(join(dir, `${k}.lede`), readFileSync(join(gen, p), 'utf8'));
  const names = pages.map((_, k) => `${k}.lede`);
  assert.equal(run(['check', ...names], dir).status, 1);
  const r = run(['check', ...names, '--fix'], dir);
  assert.equal(r.status, 0, r.stderr);
  const repairs = r.stderr.split('\n').filter((l) => /fixed \[data-row-width\]/.test(l));
  assert.ok(repairs.length >= 3 && repairs.every((l) => l.endsWith('(a guess: check it)')), r.stderr);
  assert.equal(run(['check', ...names], dir).status, 0);
});

test('build --artifact writes the title, the style and the main, with no page shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), '@title Checkout & cart, week 42\n## Latency\nkpi p99 | 182 ms | -38% | good\n');
  const full = run(['build', 'p.lede'], dir).stdout;
  const r = run(['build', 'p.lede', '--artifact'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^<title>Checkout &amp; cart, week 42<\/title>\n<style>/);
  assert.doesNotMatch(r.stdout, /<!doctype|<(html|head|body|meta|script)[\s>]/i); // `<header>` is page content, not the shell
  const style = /<style>[\s\S]*?<\/style>/.exec(full)?.[0];
  const main = /<main[\s\S]*<\/main>/.exec(full)?.[0];
  assert.ok(style && main);
  assert.equal(r.stdout, `<title>Checkout &amp; cart, week 42</title>\n${style}\n${main}\n`);
  assert.match(run(['--help'], dir).stdout, /--artifact\s+build:/);
});
