// `lede` on a page of tabs (spec §4.21, §9, D85): parts read like data files, reported under their own names, pinned by hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (args: string[], cwd: string) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const COSTS = '@title Costs\n@accent #b91c1c\n\n# Drivers\n\nSpend rose.\n';
const RISKS = '# Risks\n\nOne.\n';

function folder(manifest: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lede-tabs-'));
  mkdirSync(join(dir, 'parts'));
  writeFileSync(join(dir, 'parts', 'costs.lede'), COSTS);
  writeFileSync(join(dir, 'risks.lede'), RISKS);
  writeFileSync(join(dir, 'page.lede'), manifest);
  return dir;
}

test('build writes one page with a panel per part and prints each tab with its hash', () => {
  const dir = folder('@title Review\n\ntab Costs < parts/costs.lede\ntab < risks.lede\n');
  const r = run(['build', 'page.lede', '-o', 'page.html'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`page\\.lede: tab Costs < parts/costs\\.lede #${sha(COSTS).slice(0, 12)}\\n`));
  assert.match(r.stderr, new RegExp(`page\\.lede: tab Risks < risks\\.lede #${sha(RISKS).slice(0, 12)}\\n`));
  // The part's page-level key is reported under the part's own path.
  assert.match(r.stderr, /parts\/costs\.lede:2:1: warning \[tab-part-meta\]/);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /<section class="doc part p1" id="costs" aria-label="Costs" data-part="parts\/costs\.lede" data-sha="[0-9a-f]{12}">/);
  assert.match(html, /<section class="doc part p2" id="risks"/);
  assert.doesNotMatch(html, /<script/);
});

test('check --json keys every part by its path; an error in a part stops the build', () => {
  const dir = folder('tab < parts/costs.lede\ntab < risks.lede\n');
  writeFileSync(join(dir, 'risks.lede'), '# Risks\nchart line nope\n');
  const r = run(['check', 'page.lede', '--json'], dir);
  assert.equal(r.status, 1);
  const all = JSON.parse(r.stdout) as Record<string, { code: string }[]>;
  assert.deepEqual(Object.keys(all), ['page.lede', 'parts/costs.lede', 'risks.lede']);
  assert.deepEqual(
    all['risks.lede'].map((d) => d.code),
    ['unknown-data'],
  );
  assert.equal(run(['build', 'page.lede', '-o', 'page.html'], dir).status, 1);
});

test('a part outside the folder, through a symlink or not, is E tab-path and nothing of it is read', () => {
  const outside = mkdtempSync(join(tmpdir(), 'lede-secret-'));
  writeFileSync(join(outside, 'secret.lede'), '# hunter2\n');
  const dir = folder(`tab < ../${outside.split('/').pop()}/secret.lede\ntab < link.lede\ntab < gone.lede\n`);
  symlinkSync(join(outside, 'secret.lede'), join(dir, 'link.lede'));
  const r = run(['check', 'page.lede', '--json'], dir);
  const diags = JSON.parse(r.stdout)['page.lede'] as { code: string; line: number; detail: { kind: string } }[];
  assert.deepEqual(
    diags.map((d) => [d.line, d.code, d.detail.kind]),
    [
      [1, 'tab-path', 'outside'],
      [2, 'tab-path', 'outside'],
      [3, 'tab-path', 'missing'],
    ],
  );
  assert.doesNotMatch(r.stdout + r.stderr, /hunter2/);
});

test('a pin fails the build once the part changes, and passes again when moved', () => {
  const pin = sha(RISKS).slice(0, 12);
  const dir = folder(`tab < risks.lede #${pin}\n`);
  assert.equal(run(['build', 'page.lede', '-o', 'page.html'], dir).status, 0);
  writeFileSync(join(dir, 'risks.lede'), `${RISKS}Edited.\n`);
  const r = run(['build', 'page.lede', '-o', 'page.html'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`page\\.lede:1:1: error \\[tab-stale\\] risks\\.lede has changed since it was pinned \\(#${pin}`));
  writeFileSync(join(dir, 'page.lede'), `tab < risks.lede #${sha(`${RISKS}Edited.\n`).slice(0, 16)}\n`);
  assert.equal(run(['build', 'page.lede', '-o', 'page.html'], dir).status, 0);
});

test('check --fix rewrites the manifest only; ast prints the manifest alone; --shell says it had no effect', () => {
  const dir = folder('#### Deep\n\ntab < risks.lede\n');
  writeFileSync(join(dir, 'risks.lede'), '#### Also deep\n');
  run(['check', 'page.lede', '--fix'], dir);
  assert.equal(readFileSync(join(dir, 'page.lede'), 'utf8'), '### Deep\n\ntab < risks.lede\n');
  assert.equal(readFileSync(join(dir, 'risks.lede'), 'utf8'), '#### Also deep\n');
  const ast = JSON.parse(run(['ast', 'page.lede'], dir).stdout) as { blocks: { type: string }[]; diagnostics: unknown[] };
  assert.deepEqual(
    ast.blocks.map((b) => b.type),
    ['heading', 'tab'],
  );
  const b = run(['build', 'page.lede', '--shell', '-o', 'page.html'], dir);
  assert.equal(b.status, 0);
  assert.match(b.stderr, /--shell had no effect: a page of tabs does not take the shell yet/);
});

test('watch rebuilds the page when a part changes', async () => {
  const dir = folder('tab < parts/costs.lede\n');
  const child = spawn(process.execPath, [CLI, 'watch', 'page.lede'], { cwd: dir });
  let err = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => (err += d));
  const html = () => {
    try {
      return readFileSync(join(dir, 'page.html'), 'utf8');
    } catch {
      return '';
    }
  };
  const until = async (what: string, done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(done(), `timed out waiting for ${what}; stderr so far:\n${err}`);
  };
  try {
    await until('the first build', () => html().includes('Spend rose.') && err.includes('watching'));
    writeFileSync(join(dir, 'parts', 'costs.lede'), COSTS.replace('Spend rose.', 'Spend fell.'));
    await until('the rebuild', () => html().includes('Spend fell.'));
  } finally {
    child.kill();
  }
});
