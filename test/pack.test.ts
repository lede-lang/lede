// The packed packages work on their own. The three tarballs from scripts/pack.ts are installed by npm into an empty
// directory outside the workspace, so nothing resolves to a TypeScript source, and are then used the way a user would:
// the `lede` bin, a plain .mjs import, and a TypeScript consumer type-checked against the shipped .d.ts files.
// Needs the npm registry (for elkjs and sanitize-html) and takes about 20 seconds, so it runs as `pnpm test:pack`,
// not in `pnpm test`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { packAll, root, type Packed } from '../scripts/pack.ts';

let tmp = '';
let app = '';
let packed: Packed[] = [];

const tarText = (file: string, member: string) => execFileSync('tar', ['-xzOf', file, `package/${member}`], { encoding: 'utf8' });
const tarList = (file: string) =>
  execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((f) => f.replace(/^package\//, ''));

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: app, encoding: 'utf8' });
  if (r.error) throw r.error;
  return r;
}

before(() => {
  // Under the OS temp dir, never inside the repo: module resolution walks up parent directories and would find the
  // workspace's node_modules, where @lede-lang/* still point at src/.
  tmp = mkdtempSync(join(tmpdir(), 'lede-pack-'));
  packed = packAll(join(tmp, 'tarballs'));
  app = join(tmp, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'lede-pack-test', private: true, type: 'module' }));
  // One install for all three: separately, the html tarball's dependency on @lede-lang/core would go to the registry.
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', ...packed.map((p) => p.filename)], {
    cwd: app,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
});

after(() => {
  if (tmp && !process.env.KEEP_PACK) rmSync(tmp, { recursive: true, force: true });
});

test('every package is packed at one version, with the workspace protocol resolved', () => {
  assert.deepEqual(
    packed.map((p) => p.name),
    ['@lede-lang/core', '@lede-lang/html', '@lede-lang/cli'],
  );
  const versions = new Set(packed.map((p) => p.version));
  assert.equal(versions.size, 1, 'the three packages are versioned in lockstep (workspace:* becomes an exact pin)');
  for (const p of packed) {
    const text = tarText(p.filename, 'package.json');
    assert.doesNotMatch(text, /workspace:/, p.name);
    const m = JSON.parse(text) as { dependencies?: Record<string, string> };
    for (const [dep, range] of Object.entries(m.dependencies ?? {}))
      if (dep.startsWith('@lede-lang/')) assert.equal(range, p.version, `${p.name} pins ${dep}`);
  }
});

test('packed manifests point at dist/, and the tarballs hold the build, the sources and the licence only', () => {
  for (const p of packed) {
    const m = JSON.parse(tarText(p.filename, 'package.json')) as Record<string, unknown>;
    const files = tarList(p.filename);
    assert.ok(files.includes('LICENSE'), `${p.name} ships LICENSE`);
    assert.ok(files.includes('README.md'), `${p.name} ships a README, which is the npm package page`);
    assert.equal(m.license, 'Apache-2.0');
    for (const f of files)
      assert.match(f, /^(LICENSE|README\.md|package\.json|src\/[\w-]+\.ts|dist\/[\w-]+\.(js|d\.ts)(\.map)?)$/, `${p.name}: ${f}`);
    if (p.name === '@lede-lang/cli') {
      assert.deepEqual(m.bin, { lede: './dist/cli.js' });
      assert.match(tarText(p.filename, 'dist/cli.js'), /^#!\/usr\/bin\/env node\n/);
    } else {
      assert.deepEqual(m.exports, { '.': { types: './dist/index.d.ts', default: './dist/index.js' } });
      assert.equal(m.types, './dist/index.d.ts');
    }
    assert.deepEqual(m.publishConfig, { access: 'public', provenance: true }, 'pnpm moved the overrides into the manifest');
  }
});

test('the installed lede bin builds and checks a page', () => {
  copyFileSync(join(root, 'examples/kitchen-sink.lede'), join(app, 'page.lede'));
  // A data file next to the page, so the CLI's confined file loader runs from the installed copy too.
  writeFileSync(join(app, 'q.csv'), 'quarter,revenue\nQ1,10\nQ2,14\n');
  writeFileSync(join(app, 'small.lede'), '# Small\n\ndata q < q.csv\nchart bar q title="Revenue"\n');
  writeFileSync(join(app, 'bad.lede'), '# Bad\n\nchart lien q\n');
  const bin = join(app, 'node_modules/.bin/lede');

  for (const page of ['page', 'small']) {
    const b = run(bin, ['build', `${page}.lede`, '-o', `${page}.html`]);
    assert.equal(b.status, 0, b.stderr);
    const html = readFileSync(join(app, `${page}.html`), 'utf8');
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, /<script/i, 'zero-JS output (D10)');
  }

  const ok = run(bin, ['check', 'page.lede', 'small.lede']);
  assert.equal(ok.status, 0, ok.stderr);

  const bad = run(bin, ['check', '--json', 'bad.lede']);
  assert.equal(bad.status, 1, bad.stderr);
  const report = JSON.parse(bad.stdout) as Record<string, { severity: string; code: string; line: number; col: number }[]>;
  assert.deepEqual(Object.keys(report), ['bad.lede']);
  const [d] = report['bad.lede'];
  assert.equal(d.severity, 'error');
  assert.equal(d.line, 3);
  assert.equal(typeof d.code, 'string');
});

test('plain Node imports the libraries from dist/', () => {
  writeFileSync(
    join(app, 'use.mjs'),
    `import { compile } from '@lede-lang/html';
import { parse } from '@lede-lang/core';
const { html, doc } = await compile('# Hello\\n\\ndiagram f\\nf: a -> b\\n');
console.log(JSON.stringify({
  html: html.slice(0, 15), svg: html.includes('<svg'), errors: doc.diagnostics.length,
  blocks: parse('# Hi').blocks.length,
  coreUrl: import.meta.resolve('@lede-lang/core'), htmlUrl: import.meta.resolve('@lede-lang/html'),
}));
`,
  );
  const r = run(process.execPath, ['use.mjs']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.match(String(out.html), /^<!doctype html>/i);
  assert.equal(out.svg, true);
  assert.equal(out.errors, 0);
  assert.equal(out.blocks, 1);
  assert.match(String(out.coreUrl), /\/node_modules\/@lede-lang\/core\/dist\/index\.js$/);
  assert.match(String(out.htmlUrl), /\/node_modules\/@lede-lang\/html\/dist\/index\.js$/);
});

test('a TypeScript consumer type-checks against the shipped declarations', () => {
  writeFileSync(
    join(app, 'use.ts'),
    `import { compile, type RenderOptions } from '@lede-lang/html';
import { parse, LedeStream, type LedeDocument, type Diagnostic } from '@lede-lang/core';
const opts: RenderOptions = { allowRemote: false };
const doc: LedeDocument = parse('# Hi');
const first: Diagnostic | undefined = doc.diagnostics[0];
const stream = new LedeStream();
export const out: Promise<{ html: string; doc: LedeDocument }> = compile('# Hi', opts);
export { first, stream };
`,
  );
  // Strict settings and skipLibCheck off, so a broken specifier or a type leaking from a devDependency fails here.
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', target: 'es2023', strict: true, noEmit: true, skipLibCheck: false, types: [] },
      files: ['use.ts'],
    }),
  );
  const r = run(join(root, 'node_modules/.bin/tsc'), ['-p', '.']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
