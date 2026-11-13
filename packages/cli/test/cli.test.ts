import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, linkSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (args: string[], cwd: string, input?: string) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input });

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
  const r = run(['check', 'p.lede', '--artifact', '--link-images'], dir); // fig.png is no file: without the flag it is also W image-inline
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.trimEnd().split('\n').at(-1), '1 warning(s)');
  assert.match(r.stderr, /\[artifact-image\]/);
  const plain = run(['check', 'p.lede', '--link-images'], dir);
  assert.equal(plain.status, 0);
  assert.equal(plain.stderr.trimEnd().split('\n').at(-1), 'ok');
  assert.doesNotMatch(plain.stderr, /artifact-image/);
});

test('check --artifact --json carries the warning with its detail, and reports each file on its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), FIG_PAGE);
  writeFileSync(join(dir, 'q.lede'), '# Fine\n\nimage data:image/gif;base64,R0lGODlhAQABAAAAACw= "Pixel"\n');
  writeFileSync(join(dir, 'r.lede'), '# Grid\n\ngrid 2\nimage a.png "A"\nimage b.png "B"\n');
  const r = run(['check', 'p.lede', 'q.lede', 'r.lede', '--artifact', '--json', '--link-images'], dir);
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
  const text = run(['check', 'p.lede', 'q.lede', 'r.lede', '--artifact', '--link-images'], dir);
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

/** Start `lede watch` in `dir`. The caller kills `child` in a `finally`; `until` polls with a deadline long enough for a slow machine. */
function startWatch(dir: string, args: string[]) {
  const child = spawn(process.execPath, [CLI, 'watch', ...args], { cwd: dir });
  let err = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => (err += d));
  const until = async (what: string, done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(done(), `timed out waiting for ${what}; stderr so far:\n${err}`);
  };
  const html = () => {
    try {
      return readFileSync(join(dir, 'page.html'), 'utf8');
    } catch {
      return '';
    }
  };
  return { child, until, stderr: () => err, html };
}

test('watch --shell says once that the flag had no effect, and again only after the page stops taking the shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const page = join(dir, 'page.lede');
  writeFileSync(page, '# Plain\n\nText\n');
  const w = startWatch(dir, ['page.lede', '--shell']);
  const count = (re: RegExp) => w.stderr().match(re)?.length ?? 0;
  const builds = () => count(/page\.lede → /g);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Save `text` and wait for the rebuild it causes. */
  const save = async (text: string) => {
    const before = builds();
    writeFileSync(page, text);
    await w.until('a rebuild', () => builds() > before);
    await sleep(150); // a second event for the same save would be a second build, which must not matter
  };
  try {
    await w.until('the first build', () => builds() >= 1 && w.stderr().includes('watching'));
    const none = () => count(/--shell had no effect/g);
    assert.equal(none(), 1, 'the first build says it');
    await save('# Plain\n\nMore text\n');
    await save('# Plain\n\nEven more text\n');
    assert.equal(none(), 1, 'a rebuild with the same result is quiet');
    await save('# Go\nask a | Who?\nexport json\n');
    assert.equal(none(), 1, 'a page that takes the shell has nothing to say');
    assert.equal((readFileSync(join(dir, 'page.html'), 'utf8').match(/<script/g) ?? []).length, 2);
    await save('# Plain\n\nText again\n');
    assert.equal(none(), 2, 'and it says so again once the page stops taking it');
    await save('# Plain\n\nText once more\n');
    assert.equal(none(), 2);
  } finally {
    w.child.kill();
  }
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

test('-o never overwrites an input file: the same path, a symlink to it, a hard link to it and a not-yet-written name that is not it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const src = '# Keep me\n';
  writeFileSync(join(dir, 'ok.lede'), src);
  symlinkSync(join(dir, 'ok.lede'), join(dir, 'link.html'));
  linkSync(join(dir, 'ok.lede'), join(dir, 'hard.html'));
  mkdirSync(join(dir, 'sub'));
  for (const target of ['ok.lede', './ok.lede', 'sub/../ok.lede', 'link.html', 'hard.html']) {
    for (const args of [
      ['build', 'ok.lede', '-o', target],
      ['build', 'ok.lede', `-o=${target}`],
    ]) {
      const r = run(args, dir);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.equal(r.stderr.trimEnd().split('\n').length, 1, 'one line');
      assert.match(r.stderr, /^lede: .*same file/);
      assert.equal(readFileSync(join(dir, 'ok.lede'), 'utf8'), src, 'the source is untouched');
    }
  }
  // any input FILE counts, not only the first one that build compiles
  writeFileSync(join(dir, 'other.lede'), '# Other\n');
  assert.equal(run(['build', 'ok.lede', 'other.lede', '-o', 'other.lede'], dir).status, 2);
  assert.equal(readFileSync(join(dir, 'other.lede'), 'utf8'), '# Other\n');
  // OUT does not exist yet, and is not the source: written as always
  assert.equal(run(['build', 'ok.lede', '-o', 'fresh.html'], dir).status, 0);
  assert.match(readFileSync(join(dir, 'fresh.html'), 'utf8'), /^<!doctype html>/i);
  // watch refuses before it starts
  const w = run(['watch', 'ok.lede', '-o', 'ok.lede'], dir);
  assert.equal(w.status, 2);
  assert.match(w.stderr, /same file/);
  assert.equal(readFileSync(join(dir, 'ok.lede'), 'utf8'), src);
});

test('-o needs a file name: last, before another flag or empty is a usage error; -o=FILE is -o FILE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), '# Hi\n');
  for (const args of [
    ['build', 'p.lede', '-o'],
    ['build', 'p.lede', '-o', '--force'],
    ['build', '-o', '-', 'p.lede'],
    ['build', 'p.lede', '-o='],
    ['watch', 'p.lede', '-o'],
  ]) {
    const r = run(args, dir);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stdout, '', 'no page on stdout');
    assert.match(r.stderr, /^lede: -o needs a file name\n/);
    assert.match(r.stderr, /usage:\n {2}lede build/);
  }
  const twice = run(['build', 'p.lede', '-o', 'a.html', '-o', 'b.html'], dir);
  assert.equal(twice.status, 2);
  assert.match(twice.stderr, /^lede: -o given more than once/);
  const eq = run(['build', 'p.lede', '-o=out.html'], dir);
  assert.equal(eq.status, 0, eq.stderr);
  assert.equal(eq.stdout, '');
  assert.equal(readFileSync(join(dir, 'out.html'), 'utf8'), run(['build', 'p.lede'], dir).stdout);
  assert.match(run(['--help'], dir).stdout, /-o=FILE/);
});

test('a directory as FILE is a usage-class error like a missing file; an unwritable OUT is one line, with the stack only under LEDE_DEBUG', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  mkdirSync(join(dir, 'folder.lede'));
  writeFileSync(join(dir, 'p.lede'), '# Hi\n');
  for (const cmd of ['build', 'check', 'ast']) {
    const r = run([cmd, 'folder.lede'], dir);
    assert.equal(r.status, 2, cmd);
    assert.equal(r.stderr, 'lede: folder.lede is a directory\n');
  }
  assert.equal(run(['check', 'p.lede', 'folder.lede'], dir).status, 2);
  const missing = run(['build', 'p.lede', '-o', 'nodir/out.html'], dir);
  assert.equal(missing.status, 70);
  assert.match(missing.stderr, /^lede: .*ENOENT.*nodir\/out\.html/);
  assert.equal(missing.stderr.trimEnd().split('\n').length, 1, `one line, no stack: ${missing.stderr}`);
  const debug = spawnSync(process.execPath, [CLI, 'build', 'p.lede', '-o', 'nodir/out.html'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LEDE_DEBUG: '1' },
  });
  assert.equal(debug.status, 70);
  assert.match(debug.stderr, /^lede: .*ENOENT[\s\S]*\n\s+at /, 'the stack is there when asked for');
  assert.match(run(['--help'], dir).stdout, /LEDE_DEBUG/);
});

test('an option no command knows is a usage error that suggests the nearest flag; one that another command knows is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), '# Hi\n');
  for (const [args, want] of [
    [['build', 'p.lede', '--shel'], 'unknown option --shel; did you mean --shell?'],
    [['build', 'p.lede', '--artifcat'], 'unknown option --artifcat; did you mean --artifact?'],
    [['check', 'p.lede', '--jsno'], 'unknown option --jsno; did you mean --json?'],
    [['check', 'p.lede', '-json'], 'unknown option -json; did you mean --json?'],
    [['build', 'p.lede', '--shell=1'], 'unknown option --shell=1; did you mean --shell?'],
    [['build', 'p.lede', '--frobnicate-everything'], 'unknown option --frobnicate-everything'],
    [['build', 'p.lede', '-x'], 'unknown option -x'],
    [['ast', '-q', 'p.lede'], 'unknown option -q'],
  ] as const) {
    const r = run([...args], dir);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.split('\n')[0], `lede: ${want}`, args.join(' '));
    assert.match(r.stderr, /usage:\n {2}lede build/);
  }
  // A flag that some other command knows is still ignored there (spec section 9), so these behave as before.
  for (const args of [
    ['ast', 'p.lede', '--json'],
    ['build', 'p.lede', '--fix'],
    ['check', 'p.lede', '--force'],
    ['check', 'p.lede', '--shell'],
  ]) {
    const r = run(args, dir);
    assert.notEqual(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
  }
  // the command word gets the same treatment, and a bare `lede` still prints just the usage
  assert.equal(run(['frob', 'p.lede'], dir).stderr.split('\n')[0], 'lede: unknown command frob');
  assert.equal(run(['--shel'], dir).stderr.split('\n')[0], 'lede: unknown option --shel; did you mean --shell?');
  assert.equal(run(['build'], dir).stderr.split('\n')[0], 'lede: no file given');
  assert.match(run([], dir).stderr, /^usage:\n/);
  assert.equal(run([], dir).status, 2);
  // nothing is built when an option is wrong, even with --force
  assert.equal(run(['build', 'p.lede', '--forse', '-o', 'x.html'], dir).status, 2);
  assert.throws(() => readFileSync(join(dir, 'x.html')));
  // a known option before the command is told where it goes, not offered itself as a correction
  assert.equal(
    run(['--force', 'build', 'p.lede'], dir).stderr.split('\n')[0],
    'lede: --force goes after the command: lede <command> FILE --force',
  );
  assert.equal(
    run(['-o', 'x.html', 'build', 'p.lede'], dir).stderr.split('\n')[0],
    'lede: -o goes after the command: lede <command> FILE -o',
  );
});

test('after -- every word is a file, so a name may start with a hyphen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), '# Hi\n');
  writeFileSync(join(dir, '-draft.lede'), '# Draft\n');
  const plain = run(['check', '--', 'p.lede'], dir);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stderr, 'ok\n');
  const hyphen = run(['check', '--json', '--', '-draft.lede', 'p.lede'], dir);
  assert.equal(hyphen.status, 0, hyphen.stderr);
  assert.deepEqual(Object.keys(JSON.parse(hyphen.stdout) as object), ['-draft.lede', 'p.lede']);
  // an option after the marker is a file name, and that file is not there
  assert.equal(run(['build', 'p.lede', '--', '--force'], dir).status, 2);
});

test('--version, -V and version print the package version on one line and exit 0, with no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.match(version, /^\d+\.\d+\.\d+/);
  for (const args of [['--version'], ['-V'], ['version']]) {
    const r = run(args, dir);
    assert.equal(r.status, 0, args.join(' '));
    assert.equal(r.stdout, `${version}\n`);
    assert.equal(r.stderr, '');
  }
  assert.equal(run(['--verison'], dir).stderr.split('\n')[0], 'lede: unknown option --verison; did you mean --version?');
  const help = run(['--help'], dir).stdout;
  assert.match(help, /lede version/);
  assert.match(help, /-V, --version/);
});

test('FILE - reads the document from stdin for build, check and ast, and names it <stdin>', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const src = '# Piped\n\nkpi p99 | 182 ms | -38% | good\n';
  writeFileSync(join(dir, 'p.lede'), src);
  // build: the same page as from a file, on stdout or at -o
  const page = run(['build', 'p.lede'], dir).stdout;
  assert.equal(run(['build', '-'], dir, src).stdout, page);
  const o = run(['build', '-', '-o', 'out.html'], dir, src);
  assert.equal(o.status, 0, o.stderr);
  assert.match(o.stderr, /^<stdin> → out\.html \(/);
  assert.equal(readFileSync(join(dir, 'out.html'), 'utf8'), page);
  // check: diagnostics are labelled <stdin>, in text and as the --json key
  const bad = '# Bad\nchart line nope\n';
  const text = run(['check', '-'], dir, bad);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /^<stdin>:2:\d+: \S*error\S* \[/);
  assert.equal(text.stderr.trimEnd().split('\n').at(-1), '1 error(s)');
  const json = run(['check', '-', '--json'], dir, bad);
  assert.deepEqual(Object.keys(JSON.parse(json.stdout)), ['<stdin>']);
  assert.equal(run(['check', '-'], dir, src).stderr.trimEnd(), 'ok');
  // check takes stdin beside files; build says so on an error, with the same label
  const both = JSON.parse(run(['check', 'p.lede', '-', '--json'], dir, bad).stdout) as Record<string, unknown[]>;
  assert.deepEqual(Object.keys(both), ['p.lede', '<stdin>']);
  const refused = run(['build', '-'], dir, bad);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /<stdin>: 1 error\(s\); not written/);
  assert.equal(refused.stdout, '');
  // ast prints the document and exits 0 on errors, as for a file
  const ast = run(['ast', '-'], dir, bad);
  assert.equal(ast.status, 0);
  assert.equal((JSON.parse(ast.stdout) as { diagnostics: unknown[] }).diagnostics.length, 1);
  assert.deepEqual(JSON.parse(run(['ast', '-'], dir, src).stdout), JSON.parse(run(['ast', 'p.lede'], dir).stdout));
});

test('data loads from stdin resolve against the current directory and stay inside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  mkdirSync(join(dir, 'work'));
  writeFileSync(join(dir, 'work', 'q.csv'), 'a,b\n1,2\n');
  writeFileSync(join(dir, 'outside.csv'), 'a,b\n3,4\n');
  const diags = (src: string) => {
    const r = run(['check', '-', '--json'], join(dir, 'work'), src);
    return JSON.parse(r.stdout)['<stdin>'] as { code: string; message: string }[];
  };
  assert.deepEqual(diags('data q < q.csv\ntable q\n'), []);
  const out = diags('data o < ../outside.csv\ntable o\n').filter((d) => d.code === 'data-file');
  assert.equal(out.length, 1);
  assert.match(out[0].message, /\.\.\/outside\.csv is outside the document's directory/);
  const asked = run(['build', '-'], join(dir, 'work'), 'data q < q.csv\nchart bar q\n');
  assert.equal(asked.status, 0, asked.stderr);
  assert.match(asked.stdout, /<svg/);
});

test('- is a usage error twice, with watch, and with --fix or --dry-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const cases: [string[], RegExp][] = [
    [['check', '-', '-'], /^lede: - \(stdin\) can be given only once/],
    [['check', '-', '--fix'], /^lede: .*--fix.*stdin/],
    [['check', '--dry-run', '-'], /^lede: .*--dry-run.*stdin/],
    [['watch', '-'], /^lede: watch needs a file, not - \(stdin\)/],
  ];
  for (const [args, message] of cases) {
    const r = run(args, dir, '# Hi\n');
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, message);
    assert.match(r.stderr, /usage:\n/);
    assert.equal(r.stdout, '');
  }
});

test('watch keeps rebuilding after an editor saves by writing a temp file and renaming it over the original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const page = join(dir, 'page.lede');
  writeFileSync(page, '# Heading\n\nalphaword\n');
  const w = startWatch(dir, ['page.lede']);
  try {
    await w.until('the first build', () => w.stderr().includes('watching') && w.html().includes('alphaword'));
    for (const word of ['bravoword', 'charlieword']) {
      writeFileSync(`${page}.tmp`, `# Heading\n\n${word}\n`);
      renameSync(`${page}.tmp`, page); // a new inode under the old name: a watcher on the file itself would now see nothing
      await w.until(`a rebuild with ${word}`, () => w.html().includes(word));
    }
    assert.equal(w.child.exitCode, null, 'still running');
    assert.doesNotMatch(w.stderr(), /\n\s+at /, 'no stack trace');
  } finally {
    w.child.kill();
  }
});

test('watch survives the file being deleted, says so once, and rebuilds when it comes back; a read error is one line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const page = join(dir, 'page.lede');
  writeFileSync(page, '# Heading\n\nalphaword\n');
  const w = startWatch(dir, ['page.lede']);
  const gone = () => w.stderr().match(/lede: page\.lede is gone; waiting for it to come back/g)?.length ?? 0;
  try {
    await w.until('the first build', () => w.stderr().includes('watching') && w.html().includes('alphaword'));
    unlinkSync(page);
    await w.until('the note that the file is gone', () => gone() === 1);
    assert.equal(w.child.exitCode, null, 'still running');
    writeFileSync(page, '# Heading\n\ndeltaword\n');
    await w.until('a rebuild after it came back', () => w.html().includes('deltaword'));
    assert.equal(gone(), 1, 'said once');
    // A source that cannot be read (here: a directory in its place) is one line on stderr, not the end of the watcher.
    unlinkSync(page);
    mkdirSync(page);
    await w.until('the read error', () => /lede: .*EISDIR.*\n/.test(w.stderr()));
    assert.equal(w.child.exitCode, null, 'still running');
    rmSync(page, { recursive: true });
    writeFileSync(page, '# Heading\n\nechoword\n');
    await w.until('a rebuild after the error', () => w.html().includes('echoword'));
    assert.equal(gone(), 1, 'a read error is not "gone"');
    unlinkSync(page);
    await w.until('a second note for a second disappearance', () => gone() === 2);
    assert.doesNotMatch(w.stderr(), /\n\s+at /, 'no stack trace');
    assert.equal(w.child.exitCode, null);
  } finally {
    w.child.kill();
  }
});

test('an outside data path gets one message whether or not it exists, and a missing file inside the tree shows no absolute path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const outside = mkdtempSync(join(tmpdir(), 'lede-secret-'));
  writeFileSync(join(outside, 'secret.csv'), 'k,v\nTOKEN,hunter2\n');
  mkdirSync(join(dir, 'sub'));
  const up = `../${outside.split('/').pop()}`;
  // A link inside the tree that points out of it: what lies behind it is outside, there or not.
  symlinkSync(outside, join(dir, 'sub', 'away'));
  const outsidePaths = [
    `${up}/secret.csv`,
    `${up}/nope.csv`,
    `${up}/nodir/nope.csv`,
    join(outside, 'secret.csv'),
    join(outside, 'nope.csv'),
    '/etc/lede-no-such-file',
    'sub/away/secret.csv',
    'sub/away/nope.csv',
    'sub/away/nodir/nope.csv',
  ];
  const insidePaths = ['sub/missing.csv', 'nodir/missing.csv', 'sub/../missing.csv'];
  const page = [...outsidePaths, ...insidePaths].map((p, i) => `data d${i} < ${p}\n`).join('');
  writeFileSync(join(dir, 'page.lede'), page);
  const r = run(['check', 'page.lede', '--json'], dir);
  const msgs = (JSON.parse(r.stdout)['page.lede'] as { code: string; message: string }[])
    .filter((d) => d.code === 'data-file')
    .map((d) => d.message);
  assert.equal(msgs.length, outsidePaths.length + insidePaths.length);
  outsidePaths.forEach((p, i) => assert.equal(msgs[i], `cannot read ${p}: ${p} is outside the document's directory`));
  insidePaths.forEach((p, k) => assert.equal(msgs[outsidePaths.length + k], `cannot read ${p}: ${p}: no such file`));
  assert.doesNotMatch(r.stdout + r.stderr, /ENOENT|hunter2/);
  // the absolute path of the document's own directory is not in a message either
  assert.equal(r.stdout.includes(dir), false);
});

// Credentials in these tests are made up and built from pieces, so that no secret scanner reads this file as one.
const FAKE_AWS_KEY = ['AK', 'IA', 'ABCDEFGH', '12345678'].join('');
const LEAKY = [
  '@title Handover',
  '',
  'See https://api.acme.io/v1/items and mail ada@acme.io (10.0.0.7).',
  '',
  '```',
  'ssh ops@db.prod.corp',
  '```',
  `data t = a,b; ${FAKE_AWS_KEY},2`,
  'Fine: v1.2.3, 10.5 ms, chart.png, https://example.com/x.',
  '',
].join('\n');

test('check --external reports what a page gives away, exits 1 on any finding, and ends with the count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'leak.lede'), LEAKY);
  writeFileSync(join(dir, 'clean.lede'), '# Hi\n\nSee https://example.com/x, 192.0.2.1 and v1.2.3 at 10:30.\n');
  const r = run(['check', 'leak.lede', '--external'], dir);
  assert.equal(r.status, 1);
  const lines = r.stderr.split('\n').filter((l) => l.startsWith('leak.lede:'));
  assert.deepEqual(
    lines.map((l) => l.split(' ').slice(0, 3).join(' ')),
    [
      'leak.lede:3:5: warning [external]',
      'leak.lede:3:43: warning [external]',
      'leak.lede:3:56: warning [external]',
      'leak.lede:6:5: warning [external]',
      'leak.lede:8:15: warning [external]',
    ],
  );
  assert.match(lines[0], /a URL \(https:\/\/api\.acme\.io\/v1\/items\)/);
  assert.match(lines[4], /a credential/);
  assert.equal(r.stderr.trimEnd().split('\n').at(-1), '5 warning(s)');
  // The same file without the flag is clean, and a clean page with the flag is ok at exit 0 (documentation names are never reported).
  assert.equal(run(['check', 'leak.lede'], dir).status, 0);
  assert.equal(run(['check', 'leak.lede'], dir).stderr.trimEnd(), 'ok');
  const clean = run(['check', 'clean.lede', '--external'], dir);
  assert.equal(clean.status, 0);
  assert.equal(clean.stderr.trimEnd(), 'ok');
  // An error is an error beside them, and both are counted.
  writeFileSync(join(dir, 'both.lede'), `${LEAKY}chart line nope\n`);
  const both = run(['check', 'both.lede', '--external'], dir);
  assert.equal(both.status, 1);
  assert.equal(both.stderr.trimEnd().split('\n').at(-1), '1 error(s), 5 warning(s)');
  // Stdin is a document too, and is named <stdin>.
  const piped = run(['check', '-', '--external'], dir, 'x https://acme.io/y\n');
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /^<stdin>:1:3: \S*warning\S* \[external\]/);
});

test('check --external --json carries each finding with its detail, beside the other diagnostics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'leak.lede'), `${LEAKY}kpi Share | ~75% | roughly | bar\n`);
  const r = run(['check', 'leak.lede', '--external', '--json'], dir);
  assert.equal(r.status, 1);
  const diags = (JSON.parse(r.stdout) as Record<string, { severity: string; code: string; line: number; col: number; detail?: unknown }[]>)[
    'leak.lede'
  ];
  assert.deepEqual(
    diags.filter((d) => d.code === 'external').map((d) => [d.severity, d.line, d.col, d.detail]),
    [
      ['warning', 3, 5, { kind: 'url', text: 'https://api.acme.io/v1/items' }],
      ['warning', 3, 43, { kind: 'email', text: 'ada@acme.io' }],
      ['warning', 3, 56, { kind: 'ip', text: '10.0.0.7' }],
      ['warning', 6, 5, { kind: 'email', text: 'ops@db.prod.corp' }],
      ['warning', 8, 15, { kind: 'key', text: `${FAKE_AWS_KEY.slice(0, 4)}... (${FAKE_AWS_KEY.length} characters)` }],
    ],
  );
  assert.ok(diags.some((d) => d.code === 'kpi-bar'));
  // Without the flag the JSON has none, and the exit code is 0 on warnings.
  const plain = JSON.parse(run(['check', 'leak.lede', '--json'], dir).stdout) as Record<string, { code: string }[]>;
  assert.ok(!plain['leak.lede'].some((d) => d.code === 'external'));
});

test('--allow leaves the listed hosts and ip literals alone, with the urls on them; the flag may repeat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'leak.lede'), LEAKY);
  const one = run(['check', 'leak.lede', '--external', '--allow=api.acme.io,10.0.0.7', '--json'], dir);
  const kinds = (JSON.parse(one.stdout) as Record<string, { detail?: { kind: string; text: string } }[]>)['leak.lede'].map(
    (d) => d.detail?.kind,
  );
  assert.deepEqual(kinds, ['email', 'email', 'key']);
  const two = run(['check', 'leak.lede', '--external', '--allow=api.acme.io', '--allow=10.0.0.7', '--json'], dir);
  assert.equal(two.stdout, one.stdout);
  // Allowed names do not make the page clean of the rest, and under --fix they stay in the source.
  const fixed = run(['check', 'leak.lede', '--external', '--allow=api.acme.io,10.0.0.7', '--fix'], dir);
  assert.equal(fixed.status, 0);
  assert.equal(
    readFileSync(join(dir, 'leak.lede'), 'utf8'),
    LEAKY.replace('ada@acme.io', '<email>').replace('ops@db.prod.corp', '<email>').replace(FAKE_AWS_KEY, '<key>'),
  );
});

test('check --external --fix replaces each finding with its placeholder, prints each repair, and --dry-run writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'leak.lede'), LEAKY);
  const dry = run(['check', 'leak.lede', '--external', '--fix', '--dry-run'], dir);
  assert.equal(dry.status, 1);
  assert.match(dry.stderr, /leak\.lede:3: would fix \[external\] replaced url https:\/\/api\.acme\.io\/v1\/items with <url>\n/);
  assert.match(dry.stderr, /leak\.lede:8: would fix \[external\] replaced key AKIA\.\.\. \(20 characters\) with <key>\n/);
  assert.match(
    dry.stderr,
    /leak\.lede:3:\n- See https:\/\/api\.acme\.io\/v1\/items and mail ada@acme\.io \(10\.0\.0\.7\)\.\n\+ See <url> and mail <email> \(<ip>\)\.\n/,
  );
  assert.equal(readFileSync(join(dir, 'leak.lede'), 'utf8'), LEAKY);

  const r = run(['check', 'leak.lede', '--external', '--fix'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /leak\.lede:3: fixed \[external\] replaced email ada@acme\.io with <email>/);
  assert.match(r.stderr, /leak\.lede:6: fixed \[external\] replaced email ops@db\.prod\.corp with <email>/);
  assert.equal(r.stderr.trimEnd().split('\n').at(-1), 'ok');
  assert.equal(
    readFileSync(join(dir, 'leak.lede'), 'utf8'),
    [
      '@title Handover',
      '',
      'See <url> and mail <email> (<ip>).',
      '',
      '```',
      'ssh <email>',
      '```',
      'data t = a,b; <key>,2',
      'Fine: v1.2.3, 10.5 ms, chart.png, https://example.com/x.',
      '',
    ].join('\n'),
  );
  // Reading it again finds nothing, and a second --fix changes nothing.
  assert.equal(run(['check', 'leak.lede', '--external'], dir).status, 0);
  assert.doesNotMatch(run(['check', 'leak.lede', '--external', '--fix'], dir).stderr, /fixed/);
});

test('check --external --fix makes the other repairs first, in the same write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'p.lede'), 'data t = a,b; one,Nice; no link\ntable t\n#### Deep\nsee www.acme.io\n');
  const r = run(['check', 'p.lede', '--external', '--fix'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /p\.lede:1: fixed \[data-row-width\]/);
  assert.match(r.stderr, /p\.lede:4: fixed \[external\] replaced url www\.acme\.io with <url>/);
  assert.equal(readFileSync(join(dir, 'p.lede'), 'utf8'), 'data t = a,b; one,"Nice; no link"\ntable t\n### Deep\nsee <url>\n');
  // Under --fix alone nothing is redacted.
  writeFileSync(join(dir, 'q.lede'), 'see www.acme.io\n');
  run(['check', 'q.lede', '--fix'], dir);
  assert.equal(readFileSync(join(dir, 'q.lede'), 'utf8'), 'see www.acme.io\n');
});

test('check --external --fix never writes a page that parses worse: ids take host-1, and a data file name is left', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'net.lede'), 'diagram net\nnet: api.acme.io -> db.corp.internal : 10.1.2.3\nnet: api.acme.io -> cache\n');
  const r = run(['check', 'net.lede', '--external', '--fix'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /net\.lede:2: fixed \[external\] replaced host api\.acme\.io with host-1\n/);
  assert.equal(readFileSync(join(dir, 'net.lede'), 'utf8'), 'diagram net\nnet: host-1 -> host-2 : <ip>\nnet: host-1 -> cache\n');
  writeFileSync(join(dir, 'feed.acme.io'), 'a,b\n1,2\n');
  writeFileSync(join(dir, 'feed.lede'), 'data d < feed.acme.io\ntable d\n');
  const kept = run(['check', 'feed.lede', '--external', '--fix'], dir);
  assert.equal(kept.status, 1);
  assert.match(kept.stderr, /feed\.lede:1: not fixed \[external\] host left as written/);
  assert.equal(readFileSync(join(dir, 'feed.lede'), 'utf8'), 'data d < feed.acme.io\ntable d\n');
});

test('--external and --allow: usage errors, and build ignores both and never redacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  writeFileSync(join(dir, 'leak.lede'), LEAKY);
  for (const [args, want] of [
    [['check', 'leak.lede', '--external', '--allow'], '--allow needs host names: --allow=host1,host2'],
    [['check', 'leak.lede', '--external', '--allow='], '--allow needs host names: --allow=host1,host2'],
    [['check', 'leak.lede', '--external', '--allow=,'], '--allow needs host names: --allow=host1,host2'],
    [['check', 'leak.lede', '--allow=acme.io'], '--allow only means something with --external'],
    [['check', 'leak.lede', '--externl'], 'unknown option --externl; did you mean --external?'],
    [['--external', 'check', 'leak.lede'], '--external goes after the command: lede <command> FILE --external'],
  ] as const) {
    const r = run([...args], dir);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr.split('\n')[0], `lede: ${want}`, args.join(' '));
  }
  const built = run(['build', 'leak.lede', '--external', '--allow=acme.io'], dir);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(built.stdout, run(['build', 'leak.lede'], dir).stdout);
  assert.equal(readFileSync(join(dir, 'leak.lede'), 'utf8'), LEAKY);
});

test('--help lists --external and --allow, and the exit code that goes with them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const r = run(['--help'], dir);
  assert.match(
    r.stdout,
    /lede check <file\.lede>\.\.\. \[--json\] \[--fix \[--dry-run\]\] \[--artifact\] .*\[--external \[--allow=HOST,\.\.\.\]\]/,
  );
  assert.match(r.stdout, /--external {6}check: also report what the page gives away/);
  assert.match(r.stdout, /exit 1 if there is any/);
  assert.match(r.stdout, /<url>, <ip>, <host>, <account>, <key> or <email>/);
  assert.match(r.stdout, /--allow=HOSTS {3}check --external: host names and IP addresses to leave alone/);
  assert.match(r.stdout, /exit 1 if any is an error \(or, with --external, a finding\)/);
});

test('check --external never prints a credential whole, in the message or in the echoed line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const key = ['AKIA', 'Z7Q2', 'EXAMPLE', 'KEY0', '1'].join('');
  writeFileSync(join(dir, 'k.lede'), `# K\n\nThe deploy key is ${key} for now.\n`);
  const r = run(['check', '--external', 'k.lede'], dir);
  assert.equal(r.status, 1);
  assert.ok(!r.stderr.includes(key), r.stderr);
  const j = run(['check', '--external', '--json', 'k.lede'], dir);
  assert.ok(!j.stdout.includes(key), j.stdout);
});

test('check --external masks a credential in every diagnostic: a meta URL, a data row, a URL finding, and a repair line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const key = ['AKIA', 'Z7Q2', 'EXAMPLE', 'KEY0', '1'].join('');
  const page = [
    `@canonical http://acme.io/p?key=${key}`,
    `@image https://cdn.acme.io/x.png?token=${key}`,
    '',
    `data t = a,b; ${key},2,3`,
    '',
  ];
  writeFileSync(join(dir, 'k.lede'), page.join('\n'));
  const r = run(['check', '--external', 'k.lede'], dir);
  assert.equal(r.status, 1);
  assert.ok(!r.stderr.includes(key), r.stderr);
  assert.match(r.stderr, /\[meta-url\][^\n]*\?key=AKIA\.\.\. \(20 characters\)/);
  assert.match(r.stderr, /\[data-row-width\] row "AKIA\.\.\. \(20 characters\),2,3"/);
  // The echoed line is cut where the key starts, inside the URL.
  assert.match(r.stderr, /\n {2}@canonical http:\/\/acme\.io\/p\?key=\.\.\.\n/);
  const j = run(['check', '--external', '--json', 'k.lede'], dir);
  assert.ok(!j.stdout.includes(key), j.stdout);
  const fixed = run(['check', '--external', '--fix', '--dry-run', 'k.lede'], dir);
  assert.ok(!fixed.stderr.includes(key), fixed.stderr);
  // Without --external nothing is scanned and the messages are as they were.
  assert.ok(run(['check', 'k.lede'], dir).stderr.includes(key));
});

test('check --external cuts every echoed line that holds a credential: under another diagnostic, and in a --dry-run diff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lede-cli-'));
  const key = ['AKIA', 'Z7Q2', 'EXAMPLE', 'KEY0', '1'].join('');
  const body = ['MIIE', 'secret', 'body'].join('');
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', body, '-----END RSA PRIVATE KEY-----'];
  writeFileSync(join(dir, 'k.lede'), ['# K', '', `@foo ${key}`, '', '```', ...pem, '```', ''].join('\n'));
  const r = run(['check', '--external', 'k.lede'], dir);
  assert.match(r.stderr, /\[unknown-meta\][^\n]*\n {2}@foo \.\.\.\n/);
  assert.ok(!r.stderr.includes(key), r.stderr);
  const dry = run(['check', '--external', '--fix', '--dry-run', 'k.lede'], dir);
  assert.match(dry.stderr, /k\.lede:3:\n- @foo \.\.\.\n\+ @foo <key>\n/);
  assert.ok(!dry.stderr.includes(key) && !dry.stderr.includes(body), dry.stderr);
});
