// The GitHub Action in action/ (internal spec task C4, lede-lang/meta): its manifest, and the script that holds its logic, run
// locally against the workspace CLI. No YAML parser is a dependency of the workspace (none resolves from a package), so the manifest
// is checked as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFiles, flag, globRegExp, main, outputFor, resolveVersion } from '../../../action/build.mjs';

const ACTION = new URL('../../../action/', import.meta.url).pathname;
const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const yml = readFileSync(join(ACTION, 'action.yml'), 'utf8');

test('action.yml has the required keys, inputs, outputs and a composite run', () => {
  for (const key of ['name:', 'description:', 'inputs:', 'outputs:', 'runs:', 'using: composite']) assert.ok(yml.includes(key), key);
  for (const input of ['files', 'out-dir', 'version', 'check', 'artifact'])
    assert.match(yml, new RegExp(`^  ${input}:`, 'm'), `input ${input}`);
  for (const output of ['files', 'out-dir'])
    assert.match(yml, new RegExp(`^  ${output}:\\n    description:[^\\n]*\\n    value:`, 'm'), `output ${output}`);
  assert.match(yml, /default: '\*\*\/\*\.lede'/);
  assert.match(yml, /default: '_site'/);
  assert.match(yml, /uses: actions\/setup-node@/);
  assert.match(yml, /shell: bash/);
});

test('no input is interpolated into a run script, and no unsafe flag is passed', () => {
  // Collect each `run:` block (inline or folded/literal) and check it holds no expression at all.
  const lines = yml.split('\n');
  const runs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let body = m[2];
    if (/^[|>][+-]?$/.test(body)) {
      body = '';
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > m[1].length); j++) body += `${lines[j]}\n`;
    }
    runs.push(body);
  }
  assert.ok(runs.length >= 1);
  for (const r of runs) assert.doesNotMatch(r, /\$\{\{/, `an expression in a run block: ${r}`);
  assert.doesNotMatch(yml, /\$\{\{\s*inputs\.[^}]*\}\}[^\n]*\n\s*run:/);
  // inputs reach the script only as env values
  for (const v of ['LEDE_FILES', 'LEDE_OUT_DIR', 'LEDE_VERSION', 'LEDE_CHECK', 'LEDE_ARTIFACT'])
    assert.match(yml, new RegExp(`${v}: \\$\\{\\{ inputs\\.`));
  const script = readFileSync(join(ACTION, 'build.mjs'), 'utf8');
  for (const text of [yml, script.replace(/^\/\/.*$/gm, '')]) {
    assert.doesNotMatch(text, /--unsafe-html|--allow-remote/);
  }
  assert.doesNotMatch(yml, /unsafe|allow-remote/i);
  assert.doesNotMatch(script, /shell:\s*true|\bexecSync\b|\bexecFileSync\b/);
});

test('the version defaults to the action release for a version tag and to latest otherwise', () => {
  assert.equal(resolveVersion('', 'v0.2.4'), '0.2.4');
  assert.equal(resolveVersion(undefined, '0.3.0'), '0.3.0');
  assert.equal(resolveVersion('', 'v0.3.0-rc.1'), '0.3.0-rc.1');
  for (const ref of ['main', 'v0', 'v0.2', 'a'.repeat(40), '', undefined]) assert.equal(resolveVersion('', ref), 'latest', String(ref));
  assert.equal(resolveVersion('0.2.1', 'v0.2.4'), '0.2.1');
  assert.equal(resolveVersion('v0.2.1', 'main'), '0.2.1');
  assert.equal(resolveVersion('next', 'main'), 'next');
  for (const bad of ['0.2.1; rm -rf /', '$(id)', 'a b', '--yes', '../x']) assert.throws(() => resolveVersion(bad, ''), /not a version/);
});

test('flag reads true and false and refuses the rest', () => {
  assert.equal(flag('true', false), true);
  assert.equal(flag('False', true), false);
  assert.equal(flag('', true), true);
  assert.throws(() => flag('yes', true));
});

const PAGE = '@title T\n# Hello\n\nA paragraph.\n';
function site(): string {
  const root = mkdtempSync(join(tmpdir(), 'lede-action-'));
  mkdirSync(join(root, 'docs/deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules/x'), { recursive: true });
  mkdirSync(join(root, '_site'), { recursive: true });
  writeFileSync(join(root, 'a.lede'), PAGE);
  writeFileSync(join(root, 'docs/b.lede'), PAGE);
  writeFileSync(join(root, 'docs/deep/c d.lede'), PAGE);
  writeFileSync(join(root, '-dash.lede'), PAGE);
  writeFileSync(join(root, 'node_modules/x/n.lede'), PAGE);
  writeFileSync(join(root, '_site/old.lede'), PAGE);
  writeFileSync(join(root, 'notes.txt'), 'not lede');
  return root;
}
const env = (root: string, more: Record<string, string> = {}): Record<string, string> => ({
  GITHUB_WORKSPACE: root,
  LEDE_CLI: `${process.execPath} ${CLI}`,
  ...more,
});

test('findFiles takes globs, skips node_modules and the output folder, and sorts', () => {
  const root = site();
  assert.deepEqual(findFiles(root, '**/*.lede', join(root, '_site')), ['-dash.lede', 'a.lede', 'docs/b.lede', 'docs/deep/c d.lede']);
  assert.deepEqual(findFiles(root, 'docs/*.lede\na.lede\na.lede', join(root, '_site')), ['a.lede', 'docs/b.lede']);
  assert.deepEqual(findFiles(root, '*.txt', join(root, '_site')), []);
  assert.throws(() => findFiles(root, '../*.lede', join(root, '_site')), /relative path/);
  assert.throws(() => findFiles(root, '/etc/*.lede', join(root, '_site')), /relative path/);
  assert.equal(outputFor('_site', 'docs/b.lede'), join('_site', 'docs/b.html'));
  assert.deepEqual(findFiles(root, 'docs/**/*.lede', join(root, '_site')), ['docs/b.lede', 'docs/deep/c d.lede']);
  assert.deepEqual(findFiles(root, './docs/b.lede', join(root, '_site')), ['docs/b.lede']);
  symlinkSync(join(root, 'a.lede'), join(root, 'link.lede'));
  assert.ok(!findFiles(root, '*.lede', join(root, '_site')).includes('link.lede'), 'a symbolic link is not followed');
});

test('globRegExp: ** spans folders, * and ? stay within a name, the rest is literal', () => {
  const m = (g: string, p: string) => globRegExp(g).test(p);
  assert.ok(m('**/*.lede', 'a.lede') && m('**/*.lede', 'x/y/a.lede'));
  assert.ok(!m('*.lede', 'x/a.lede') && m('?.lede', 'a.lede') && !m('?.lede', 'ab.lede'));
  assert.ok(m('a+b (1).lede', 'a+b (1).lede') && !m('a.lede', 'axlede'));
});

test('the script builds every file under out-dir, keeps the folders and writes the step outputs', () => {
  const root = site();
  const out = join(root, 'gh-output');
  writeFileSync(out, '');
  const r = main(env(root, { GITHUB_OUTPUT: out }), () => {});
  assert.deepEqual(r.files, ['_site/-dash.html', '_site/a.html', '_site/docs/b.html', '_site/docs/deep/c d.html']);
  assert.equal(r.outDir, '_site');
  for (const f of r.files) {
    const html = readFileSync(join(root, f), 'utf8');
    assert.match(html, /Hello[\s\S]*A paragraph\./);
    assert.doesNotMatch(html, /<script/);
  }
  assert.ok(!existsSync(join(root, '_site/old.html')));
  const o = readFileSync(out, 'utf8');
  assert.match(
    o,
    /^files<<(lede_[0-9a-f]+)\n_site\/-dash\.html\n_site\/a\.html\n_site\/docs\/b\.html\n_site\/docs\/deep\/c d\.html\n\1\nout-dir<<\1\n_site\n\1\n$/,
  );
});

test('a custom out-dir and file list, and artifact mode', () => {
  const root = site();
  const r = main(env(root, { LEDE_FILES: 'docs/b.lede', LEDE_OUT_DIR: 'public/x', LEDE_ARTIFACT: 'true' }), () => {});
  assert.deepEqual(r.files, ['public/x/docs/b.html']);
  const html = readFileSync(join(root, 'public/x/docs/b.html'), 'utf8');
  assert.doesNotMatch(html, /<!doctype|<html/i);
  assert.match(html, /<main/);
});

test('check fails the run on an error, and check=false builds anyway or fails on the build', () => {
  const root = site();
  writeFileSync(join(root, 'bad.lede'), 'table nothing\n');
  assert.throws(() => main(env(root), () => {}), /lede check failed/);
  assert.ok(!existsSync(join(root, '_site/a.html')));
  assert.throws(() => main(env(root, { LEDE_CHECK: 'false' }), () => {}), /lede build failed for bad\.lede/);
});

test('no match, an escaping out-dir and a bad version are errors', () => {
  const root = site();
  assert.throws(() => main(env(root, { LEDE_FILES: 'nope/*.lede' }), () => {}), /no \.lede files match/);
  assert.throws(() => main(env(root, { LEDE_OUT_DIR: '../out' }), () => {}), /out-dir/);
  assert.throws(() => main(env(root, { LEDE_OUT_DIR: '/tmp/out' }), () => {}), /out-dir/);
  assert.throws(() => main(env(root, { LEDE_VERSION: '1; echo hi' }), () => {}), /not a version/);
});

test('run as a script, a failure is an annotation and a non-zero exit, and injected text stays text', () => {
  const root = site();
  const marker = join(root, 'pwned');
  const r = spawnSync(process.execPath, [join(ACTION, 'build.mjs')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env(root, { LEDE_FILES: `a.lede\n$(touch ${marker})`, LEDE_OUT_DIR: '"; touch x; "' }) },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!existsSync(marker));
  const bad = spawnSync(process.execPath, [join(ACTION, 'build.mjs')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env(root, { LEDE_FILES: 'zzz.lede' }) },
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^::error::no \.lede files match/m);
});
