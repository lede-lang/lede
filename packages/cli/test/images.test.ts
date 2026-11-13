// D80: local images become data: URIs in `build`, `watch` and `check`, read from the document's own tree only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/images/', import.meta.url).pathname;
const run = (args: string[], cwd: string, input?: string) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input });

/** A fresh folder holding copies of the named fixture images (real files, 44 to 662 bytes each). */
function folder(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lede-img-'));
  for (const n of names) copyFileSync(join(FIXTURES, n), join(dir, n));
  return dir;
}
const page = (dir: string, src: string) => writeFileSync(join(dir, 'p.lede'), src);
const imgs = (html: string) => [...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]);
const dataUri = (mime: string, file: string) => `data:${mime};base64,${readFileSync(join(FIXTURES, file)).toString('base64')}`;
interface Diag {
  message: string;
  code: string;
  severity: string;
  line: number;
  col: number;
  detail?: { src: string; reason: string };
}
const checked = (dir: string, ...args: string[]): Diag[] =>
  (JSON.parse(run(['check', 'p.lede', '--json', ...args], dir).stdout) as Record<string, Diag[]>)['p.lede'];
const inlineWarnings = (dir: string, ...args: string[]) => checked(dir, ...args).filter((d) => d.code === 'image-inline');

const FORMATS: [string, string][] = [
  ['tile.png', 'image/png'],
  ['tile.jpg', 'image/jpeg'],
  ['tile.gif', 'image/gif'],
  ['tile.webp', 'image/webp'],
  ['tile.avif', 'image/avif'],
  ['tile.svg', 'image/svg+xml'],
];

test('build writes each of the six formats into the page as a data: URI of the file, and the page is then one file', () => {
  const dir = folder(...FORMATS.map(([f]) => f));
  page(dir, `# Tiles\n\n${FORMATS.map(([f]) => `image ${f} "A ${f}" caption="Cap"`).join('\n')}\n`);
  const r = run(['build', 'p.lede'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'nothing to warn about');
  assert.deepEqual(
    imgs(r.stdout),
    FORMATS.map(([f, mime]) => dataUri(mime, f)),
  );
  assert.doesNotMatch(r.stdout, /<img [^>]*loading=/, 'a data: image is not lazy');
  assert.doesNotMatch(r.stdout, /src="tile\./);
  assert.doesNotMatch(r.stdout, /<script/i);
});

test('the type comes from the first bytes, not from the name', () => {
  const dir = folder('tile.png', 'tile.svg');
  copyFileSync(join(dir, 'tile.png'), join(dir, 'photo.jpg')); // a PNG called .jpg
  copyFileSync(join(dir, 'tile.svg'), join(dir, 'drawing.png')); // an SVG called .png
  writeFileSync(join(dir, 'fake.png'), 'this is not an image\n');
  writeFileSync(join(dir, 'empty.png'), '');
  writeFileSync(join(dir, 'page.png'), '<!doctype html><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  writeFileSync(join(dir, 'near.svg'), '<svgx></svgx>');
  writeFileSync(join(dir, 'open.svg'), '<?xml version="1.0"?><!-- never closed <svg/>');
  writeFileSync(
    join(dir, 'prolog.svg'),
    '﻿\n<?xml version="1.0"?>\n<!-- made by a tool -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg/>',
  );
  page(
    dir,
    ['photo.jpg', 'drawing.png', 'fake.png', 'empty.png', 'page.png', 'near.svg', 'open.svg', 'prolog.svg']
      .map((f) => `image ${f} "${f}"`)
      .join('\n') + '\n',
  );
  const html = run(['build', 'p.lede'], dir).stdout;
  const got = imgs(html);
  assert.equal(got[0], dataUri('image/png', 'tile.png'));
  assert.equal(got[1], dataUri('image/svg+xml', 'tile.svg'));
  assert.deepEqual(got.slice(2, 7), ['fake.png', 'empty.png', 'page.png', 'near.svg', 'open.svg']);
  assert.match(got[7], /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(
    inlineWarnings(dir).map((d) => [d.line, d.detail]),
    [3, 4, 5, 6, 7].map((line, i) => [line, { src: ['fake.png', 'empty.png', 'page.png', 'near.svg', 'open.svg'][i], reason: 'type' }]),
  );
});

test('a file of thousands of comments is judged in one pass, not by a regular expression that backtracks', () => {
  const dir = folder();
  writeFileSync(join(dir, 'slow.svg'), `${'<!---->'.repeat(70_000)}<!-- no root`);
  page(dir, 'image slow.svg "Slow"\n');
  const started = Date.now();
  const w = inlineWarnings(dir);
  assert.ok(Date.now() - started < 5000, 'quick');
  assert.deepEqual(
    w.map((d) => d.detail?.reason),
    ['type'],
  );
});

test('the warning carries the line, the column and {src, reason}, and prints like any other diagnostic', () => {
  const dir = folder('tile.png');
  page(dir, '# T\n\nimage tile.png "ok"\nimage nope.png "Missing figure"\n');
  const r = run(['build', 'p.lede', '-o', 'out.html'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stderr,
    /^p\.lede:4:1: \S*warning\S* \[image-inline\] image nope\.png .*; check the path\n {2}image nope\.png "Missing figure"\n {2}\^\n/,
  );
  const [w, ...more] = checked(dir);
  assert.equal(more.length, 0);
  assert.deepEqual(
    [w.severity, w.code, w.line, w.col, w.detail],
    ['warning', 'image-inline', 4, 1, { src: 'nope.png', reason: 'missing' }],
  );
  assert.equal(imgs(readFileSync(join(dir, 'out.html'), 'utf8')).length, 2);
});

test('the per-image cap: --image-max=SIZE (and --image-max SIZE) sets it, k and m are 1024 and 1024 squared, and an image over it keeps its path', () => {
  const dir = folder('tile.jpg'); // 662 bytes
  page(dir, 'image tile.jpg "J"\n');
  const kept = (...args: string[]) => run(['build', 'p.lede', ...args], dir).stdout.includes('<img src="tile.jpg"');
  assert.equal(kept(), false);
  assert.equal(kept('--image-max=661'), true);
  assert.equal(kept('--image-max=662'), false);
  assert.equal(kept('--image-max=1k'), false);
  assert.equal(kept('--image-max', '1KB'), false);
  assert.equal(kept('--image-max=2m'), false);
  const [w] = inlineWarnings(dir, '--image-max=500');
  assert.deepEqual(w.detail, { src: 'tile.jpg', reason: 'size' });
  assert.match(w.message, /^image tile\.jpg is over 500 bytes, the largest image inlined; it stays a path\. .*--image-max=SIZE$/);
  assert.match(inlineWarnings(dir, '--image-max=300k').length ? 'x' : 'inlined', /inlined/);
});

test('the page cap is eight times the per-image cap, counted for every use of an image', () => {
  const dir = folder('tile.jpg');
  page(dir, 'image tile.jpg "J"\n'.repeat(9)); // 9 x 662 bytes against 8 x 700
  const w = inlineWarnings(dir, '--image-max=700');
  assert.deepEqual(
    w.map((d) => [d.line, d.detail]),
    [[9, { src: 'tile.jpg', reason: 'page-size' }]],
  );
  assert.match(w[0].message, /^inlining tile\.jpg would take the page's images past 5\.5 KB; it stays a path\. /);
  assert.equal(imgs(run(['build', 'p.lede', '--image-max=700'], dir).stdout).filter((s) => s.startsWith('data:')).length, 8);
  assert.deepEqual(inlineWarnings(dir, '--image-max=1k'), [], '8 x 1 KiB holds all nine');
});

test('--image-max wants a size: a missing, zero or malformed one is a usage error', () => {
  const dir = folder();
  page(dir, '# T\n');
  for (const args of [
    ['--image-max'],
    ['--image-max='],
    ['--image-max=0'],
    ['--image-max=big'],
    ['--image-max=1g'],
    ['--image-max=-1'],
    ['--image-max', '--force'],
  ]) {
    const r = run(['build', 'p.lede', ...args], dir);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^lede: --image-max needs a size such as 300k or 2m\nusage:/);
  }
  assert.equal(run(['--image-max=2m', 'build', 'p.lede'], dir).status, 2);
  assert.match(run(['--image-max=2m', 'build', 'p.lede'], dir).stderr, /goes after the command/);
  assert.match(run(['build', 'p.lede', '--image-mx'], dir).stderr, /unknown option --image-mx; did you mean --image-max\?/);
  assert.match(run(['build', 'p.lede', '--link-image'], dir).stderr, /did you mean --link-images\?/);
});

test('--link-images leaves every path as written, with no warning for any of them', () => {
  const dir = folder('tile.png');
  page(dir, 'image tile.png "A"\nimage nope.png "B"\nimage ../x.png "C"\n');
  const r = run(['build', 'p.lede', '--link-images'], dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(imgs(r.stdout), ['tile.png', 'nope.png', '../x.png']);
  assert.equal(r.stdout.match(/loading="lazy"/g)?.length, 3);
  assert.deepEqual(inlineWarnings(dir, '--link-images'), []);
  assert.equal(run(['check', 'p.lede', '--link-images'], dir).stderr.trimEnd(), 'ok');
});

test('a document cannot reach a file outside its directory: ../, a root path, a symlink out, and whether it exists makes no difference', () => {
  const outer = mkdtempSync(join(tmpdir(), 'lede-img-outer-'));
  copyFileSync(join(FIXTURES, 'tile.gif'), join(outer, 'secret.png')); // a different image from the one inside, so the page can show which it holds
  const dir = join(outer, 'doc');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  copyFileSync(join(FIXTURES, 'tile.png'), join(dir, 'sub', 'ok.png'));
  symlinkSync(join(outer, 'secret.png'), join(dir, 'link.png'));
  symlinkSync(outer, join(dir, 'outdir'));
  symlinkSync(join(dir, 'sub', 'ok.png'), join(dir, 'inside.png')); // a link that stays inside is fine
  const srcs = [
    '../secret.png',
    '../nothing.png',
    join(outer, 'secret.png'),
    '/etc/passwd',
    'link.png',
    'outdir/secret.png',
    'outdir/nothing.png',
    'sub/../../secret.png',
  ];
  page(dir, `${[...srcs, 'sub/ok.png', 'inside.png'].map((s) => `image ${s} "x"`).join('\n')}\n`);
  const r = run(['build', 'p.lede'], dir);
  assert.equal(r.status, 0, r.stderr);
  const secret = readFileSync(join(outer, 'secret.png')).toString('base64');
  assert.ok(!r.stdout.includes(secret), 'the file outside is not in the page');
  const got = imgs(r.stdout);
  assert.deepEqual(got.slice(0, srcs.length), srcs);
  assert.deepEqual(got.slice(srcs.length), [dataUri('image/png', 'tile.png'), dataUri('image/png', 'tile.png')]);
  const reasons = inlineWarnings(dir).map((d) => d.detail?.reason);
  assert.deepEqual(
    reasons,
    srcs.map(() => 'outside'),
    'every one of them, found or not, is "outside"',
  );
});

test('a path that is not there, is a folder, or cannot be read is "missing"; a folder with an image name is not read', () => {
  const dir = folder();
  mkdirSync(join(dir, 'folder.png'));
  page(dir, 'image nope.png "a"\nimage folder.png "b"\nimage sub/nope.png "c"\n');
  assert.deepEqual(
    inlineWarnings(dir).map((d) => d.detail),
    [
      { src: 'nope.png', reason: 'missing' },
      { src: 'folder.png', reason: 'missing' },
      { src: 'sub/nope.png', reason: 'missing' },
    ],
  );
});

test('http(s) sources are never fetched or inlined, a data: source passes through unchanged, and neither raises a warning', () => {
  const dir = folder();
  const uri = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  page(dir, `image https://example.test/a.png "Remote"\nimage ${uri} "Data"\n`);
  const plain = run(['build', 'p.lede'], dir);
  assert.equal(plain.stderr, '');
  assert.match(plain.stdout, /Image not loaded \(remote images are off\)/);
  assert.deepEqual(imgs(plain.stdout), [uri]);
  assert.doesNotMatch(plain.stdout, /<img [^>]*loading=/, 'the data: image is not lazy');
  const remote = run(['build', 'p.lede', '--allow-remote'], dir);
  assert.deepEqual(imgs(remote.stdout), ['https://example.test/a.png', uri]);
  assert.match(remote.stdout, /<img src="https:\/\/example.test\/a.png" alt="Remote" loading="lazy"/);
  assert.deepEqual(checked(dir), []);
});

test('images inside a grid and cards are inlined too', () => {
  const dir = folder('tile.png', 'tile.gif');
  page(dir, 'grid 2\nimage tile.png "A"\nimage tile.gif "B"\n\ncards\n### One\nimage tile.png "C"\n### Two\nimage tile.gif "D"\n');
  const got = imgs(run(['build', 'p.lede'], dir).stdout);
  assert.deepEqual(got, [
    dataUri('image/png', 'tile.png'),
    dataUri('image/gif', 'tile.gif'),
    dataUri('image/png', 'tile.png'),
    dataUri('image/gif', 'tile.gif'),
  ]);
});

test('check reports the same warnings as build, never ends ok on one, and writes nothing', () => {
  const dir = folder('tile.png');
  page(dir, '# T\n\nimage tile.png "ok"\nimage nope.png "a"\nimage ../x.png "b"\n');
  const c = run(['check', 'p.lede'], dir);
  assert.equal(c.status, 0);
  assert.equal(c.stderr.trimEnd().split('\n').at(-1), '2 warning(s)');
  const b = run(['build', 'p.lede', '-o', 'out.html'], dir);
  const diagnostics = (s: string) => s.split('\n').filter((l) => l.startsWith('p.lede:'));
  assert.deepEqual(diagnostics(b.stderr), diagnostics(c.stderr));
  assert.equal(diagnostics(c.stderr).length, 2);
  assert.equal(readFileSync(join(dir, 'p.lede'), 'utf8'), '# T\n\nimage tile.png "ok"\nimage nope.png "a"\nimage ../x.png "b"\n');
  const clean = folder('tile.png');
  page(clean, 'image tile.png "ok"\n');
  assert.equal(run(['check', 'p.lede'], clean).stderr.trimEnd(), 'ok');
});

test('check types every format and an SVG whose prolog runs past the first 4 KB as build does, without encoding them', () => {
  const dir = folder(...FORMATS.map(([f]) => f));
  // A comment longer than the bytes check reads first: the root is found only in the whole file.
  writeFileSync(join(dir, 'long.svg'), `<!--${'x'.repeat(6000)}--><svg xmlns="http://www.w3.org/2000/svg"/>`);
  writeFileSync(join(dir, 'long.txt'), `<!--${'x'.repeat(6000)}--> not an svg`);
  const uses = [...FORMATS.map(([f]) => f), 'long.svg', 'long.txt', 'long.svg'];
  page(dir, uses.map((f, i) => `image ${f} "${i}"`).join('\n'));
  const diagnostics = (s: string) => s.split('\n').filter((l) => l.startsWith('p.lede:'));
  for (const max of ['6k', '700b']) {
    const c = run(['check', 'p.lede', `--image-max=${max}`, '--artifact'], dir);
    const b = run(['build', 'p.lede', '-o', 'out.html', `--image-max=${max}`, '--artifact'], dir);
    assert.deepEqual(diagnostics(c.stderr), diagnostics(b.stderr), max);
  }
  assert.deepEqual(
    inlineWarnings(dir, '--image-max=6k').map((d) => [d.detail?.src, d.detail?.reason]),
    [['long.txt', 'type']],
  );
});

test('--artifact: an inlined image raises no artifact-image, one that stays a path still does, and --link-images brings them all back', () => {
  const dir = folder('tile.png');
  page(dir, 'image tile.png "ok"\nimage nope.png "gone"\n');
  const codes = (...args: string[]) => checked(dir, '--artifact', ...args).map((d) => [d.code, d.detail?.src]);
  assert.deepEqual(codes(), [
    ['image-inline', 'nope.png'],
    ['artifact-image', 'nope.png'],
  ]);
  assert.deepEqual(codes('--link-images'), [
    ['artifact-image', 'tile.png'],
    ['artifact-image', 'nope.png'],
  ]);
  const out = run(['build', 'p.lede', '--artifact'], dir);
  assert.deepEqual(imgs(out.stdout), [dataUri('image/png', 'tile.png'), 'nope.png']);
  assert.match(out.stderr, /p\.lede:2:1: \S*warning\S* \[image-inline\]/);
  assert.match(out.stderr, /p\.lede:2:1: \S*warning\S* \[artifact-image\]/);
  assert.doesNotMatch(out.stderr, /p\.lede:1:/);
});

test('ast prints the document as written, with the path', () => {
  const dir = folder('tile.png');
  page(dir, 'image tile.png "ok"\n');
  const ast = JSON.parse(run(['ast', 'p.lede'], dir).stdout) as { blocks: { src: string }[]; diagnostics: unknown[] };
  assert.equal(ast.blocks[0].src, 'tile.png');
  assert.deepEqual(ast.diagnostics, []);
});

test('a document on stdin looks for its images in the current directory, confined to it', () => {
  const dir = folder('tile.png');
  const r = run(['build', '-'], dir, 'image tile.png "A"\nimage ../tile.png "B"\n');
  assert.deepEqual(imgs(r.stdout), [dataUri('image/png', 'tile.png'), '../tile.png']);
  assert.match(r.stderr, /^<stdin>:2:1: \S*warning\S* \[image-inline\]/);
});

test('the page policy does not change, and an SVG with a script and a handler stays inside its <img>', () => {
  const dir = folder('script.svg');
  page(dir, 'image script.svg "Hostile"\n');
  const inlined = run(['build', 'p.lede'], dir);
  assert.equal(inlined.status, 0, inlined.stderr);
  const linked = run(['build', 'p.lede', '--link-images'], dir);
  const csp = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
  assert.equal(
    csp(inlined.stdout),
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
  );
  assert.equal(csp(inlined.stdout), csp(linked.stdout));
  const [src] = imgs(inlined.stdout);
  assert.match(src, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(src.split(',')[1], 'base64').toString(), readFileSync(join(FIXTURES, 'script.svg'), 'utf8'));
  // The hostile text is in the page only as base64 in an img src: no script element, no handler attribute, no mention of the host.
  assert.doesNotMatch(inlined.stdout, /<script|\son\w+=|xss\.example|javascript:/i);
  assert.equal(inlined.stdout.replace(src, ''), linked.stdout.replace('script.svg', '').replace(' loading="lazy"', ''));
});

test('watch inlines images too, and honours --image-max and --link-images', async () => {
  const dir = folder('tile.png');
  page(dir, 'image tile.png "A"\n');
  const watch = async (...args: string[]) => {
    const child = spawn(process.execPath, [CLI, 'watch', 'p.lede', '-o', 'out.html', ...args], { cwd: dir });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => (err += d));
    try {
      for (let i = 0; i < 200 && !err.includes('watching'); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(err.includes('watching'), err);
      return [imgs(readFileSync(join(dir, 'out.html'), 'utf8')), err] as const;
    } finally {
      child.kill();
    }
  };
  assert.deepEqual((await watch())[0], [dataUri('image/png', 'tile.png')]);
  assert.deepEqual((await watch('--link-images'))[0], ['tile.png']);
  const [small, err] = await watch('--image-max=10');
  assert.deepEqual(small, ['tile.png']);
  assert.match(err, /p\.lede:1:1: \S*warning\S* \[image-inline\] image tile\.png is over 10 bytes/);
});

test('--help documents the flags and the code', () => {
  const help = run(['--help'], folder()).stdout;
  assert.match(help, /lede build .*\[--image-max=SIZE\] \[--link-images\]/);
  assert.match(help, /lede watch .*\[--image-max=SIZE\] \[--link-images\]/);
  assert.match(help, /lede check .*\[--image-max=SIZE\] \[--link-images\]/);
  assert.match(help, /--image-max=SIZE\s+build\/watch\/check: the largest local image to inline as a data: URI/);
  assert.match(help, /W image-inline/);
  assert.match(help, /--link-images\s+build\/watch\/check: leave local image paths as written/);
});

test('a path is read as a browser reads it: the query and fragment dropped, percent escapes decoded', () => {
  const dir = folder('tile.png');
  copyFileSync(join(FIXTURES, 'tile.png'), join(dir, 'my tile.png'));
  page(dir, `# T\n\nimage tile.png?v=2 "A"\nimage my%20tile.png#top "B"\n`);
  const r = run(['build', 'p.lede'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(imgs(r.stdout), [dataUri('image/png', 'tile.png'), dataUri('image/png', 'tile.png')]);
});
