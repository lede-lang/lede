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
    assert.match(r.stdout, /--shell/);
    assert.match(r.stdout, /export json,\s+markdown or prompt/);
    assert.match(r.stdout, /a field \(ask, choose, confirm, param, toggle, bucket or template\)/);
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
  assert.doesNotMatch(r.stdout, /<!doctype|<(html|head|body|meta|script|link)[\s>]/i); // `<header>` is page content, not the shell
  assert.doesNotMatch(r.stdout, /@import|url\(http/); // SVG `url(#...)` marker references are on every diagram edge and are fine
  const style = /<style>[\s\S]*?<\/style>/.exec(full)?.[0];
  const main = /<main[\s\S]*<\/main>/.exec(full)?.[0];
  assert.ok(style && main);
  assert.equal(r.stdout, `<title>Checkout &amp; cart, week 42</title>\n${style}\n${main}\n`);
  assert.match(run(['--help'], dir).stdout, /--artifact\s+build:/);
});

const FIG_PAGE = '# Figure\n\nimage fig.png "A figure"\n';

test('build --artifact warns about a relative image, still writes the page and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), FIG_PAGE);
  const r = run(['build', 'p.lede', '--artifact'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /<img src="fig\.png"/); // the output does not guess: the relative src is written as it is
  assert.match(
    r.stderr,
    /p\.lede:3:1: \S*warning\S* \[artifact-image\] .*; inline it as a data: URI or upload it as an asset and use the asset URL/,
  );
  const plain = run(['build', 'p.lede'], dir);
  assert.equal(plain.status, 0);
  assert.doesNotMatch(plain.stderr, /artifact-image/);
  const html = run(['build', 'p.lede', '-o', 'out.html', '--artifact'], dir);
  assert.equal(html.status, 0);
  assert.match(readFileSync(join(dir, 'out.html'), 'utf8'), /<img src="fig\.png"/);
});

test('check --artifact counts the image warning and never ends ok; without the flag it ends ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), FIG_PAGE);
  const r = run(['check', 'p.lede', '--artifact'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.trimEnd().split('\n').at(-1), '1 warning(s)');
  assert.match(r.stderr, /\[artifact-image\]/);
  const plain = run(['check', 'p.lede'], dir);
  assert.equal(plain.status, 0);
  assert.equal(plain.stderr.trimEnd().split('\n').at(-1), 'ok');
  assert.doesNotMatch(plain.stderr, /artifact-image/);
});

test('check --artifact --json carries the warning with its detail, and reports each file on its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), FIG_PAGE);
  writeFileSync(join(dir, 'q.lede'), '# Fine\n\nimage data:image/gif;base64,R0lGODlhAQABAAAAACw= "Pixel"\n');
  writeFileSync(join(dir, 'r.lede'), '# Grid\n\ngrid 2\nimage a.png "A"\nimage b.png "B"\n');
  const r = run(['check', 'p.lede', 'q.lede', 'r.lede', '--artifact', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as Record<
    string,
    { code: string; severity: string; line: number; col: number; detail?: { src: string; kind: string } }[]
  >;
  assert.equal(out['p.lede'].length, 1);
  assert.equal(out['p.lede'][0].code, 'artifact-image');
  assert.equal(out['p.lede'][0].severity, 'warning');
  assert.equal(out['p.lede'][0].line, 3);
  assert.equal(out['p.lede'][0].col, 1);
  assert.deepEqual(out['p.lede'][0].detail, { src: 'fig.png', kind: 'local' });
  assert.deepEqual(out['q.lede'], []);
  assert.deepEqual(
    out['r.lede'].map((d) => d.detail?.src),
    ['a.png', 'b.png'],
  );
  const text = run(['check', 'p.lede', 'q.lede', 'r.lede', '--artifact'], dir);
  assert.equal(text.stderr.trimEnd().split('\n').at(-1), '3 warning(s)');
});

test('--help lists --artifact under both build and check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const help = run(['--help'], dir).stdout;
  assert.match(help, /lede build .*\[--artifact\]/);
  assert.match(help, /lede check .*\[--artifact\]/);
  assert.match(help, /--artifact\s+build:/);
  assert.match(help, /check\/build: also warn about an image path the host cannot serve \(W artifact-image\)/);
});

test('build --shell adds the pinned runtime to a page with questions, and says so when there is nothing to run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'q.lede'), '# Go\nask a | Who?\nexport json\n');
  writeFileSync(join(dir, 'plain.lede'), '# Plain\n\nText\n');
  const shell = run(['build', 'q.lede', '--shell'], dir);
  assert.equal(shell.status, 0, shell.stderr);
  assert.match(shell.stdout, /content="[^"]*; script-src 'sha256-[A-Za-z0-9+/]+='"/);
  assert.equal((shell.stdout.match(/<script/g) ?? []).length, 2);
  assert.doesNotMatch(shell.stderr, /had no effect/);
  // An editor word is a field too (spec §4.19): a page of only a param and an export is a shell page.
  writeFileSync(join(dir, 'e.lede'), '# Go\nparam n | N | 5 0 10 1\nexport prompt\n');
  const editor = run(['build', 'e.lede', '--shell'], dir);
  assert.equal(editor.status, 0, editor.stderr);
  assert.doesNotMatch(editor.stderr, /had no effect/);
  assert.match(editor.stdout, /<input type="range" name="n"/);
  assert.equal((editor.stdout.match(/<script/g) ?? []).length, 2);
  const plain = run(['build', 'q.lede'], dir);
  assert.doesNotMatch(plain.stdout, /<script/, 'D10: no flag, no script');
  const none = run(['build', 'plain.lede', '--shell'], dir);
  assert.equal(none.status, 0);
  assert.match(none.stderr, /--shell had no effect/);
  assert.equal(none.stdout, run(['build', 'plain.lede'], dir).stdout);
});

test('--shell with --artifact keeps the scripts and drops the meta; with --unsafe-html it is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'q.lede'), '# Go\nask a | Who?\nexport json\n');
  const art = run(['build', 'q.lede', '--shell', '--artifact'], dir);
  assert.equal(art.status, 0, art.stderr);
  assert.match(art.stdout, /^<title>/);
  assert.doesNotMatch(art.stdout, /<meta/);
  assert.equal((art.stdout.match(/<script/g) ?? []).length, 2);
  const bad = run(['build', 'q.lede', '--shell', '--unsafe-html'], dir);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--shell.*--unsafe-html/);
  assert.equal(bad.stdout, '');
});

test('build exits 1 on a question error and 0 with --force, which draws only the lines that parsed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'q.lede'), 'ask a | Who?\nask a | Again\nexport json\n');
  assert.equal(run(['build', 'q.lede', '-o', 'out.html'], dir).status, 1);
  const forced = run(['build', 'q.lede', '-o', 'out.html', '--force'], dir);
  assert.equal(forced.status, 0);
  assert.equal((readFileSync(join(dir, 'out.html'), 'utf8').match(/<input /g) ?? []).length, 1);
});
