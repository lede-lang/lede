import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION_FILES, setVersion } from '../scripts/set-version.ts';
import { root } from '../scripts/pack.ts';

const tmp = mkdtempSync(join(tmpdir(), 'lede-set-version-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

let copies = 0;
function copyManifests() {
  const dest = join(tmp, String(copies++));
  for (const path of VERSION_FILES) cpSync(join(root, path), join(dest, path), { recursive: true });
  return dest;
}

const read = (base: string, path: string) => readFileSync(join(base, path), 'utf8');

test('one version lands in every file that holds it and nothing else in them moves', () => {
  const dest = copyManifests();
  assert.deepEqual(setVersion(dest, '0.4.7'), VERSION_FILES);
  for (const path of VERSION_FILES) {
    assert.equal(read(dest, path), read(root, path).replace(/("version":\s*")[^"]+(")/, '$10.4.7$2'), path);
  }
});

test('the plugin manifests end up at the CLI version, as plugin-manifests.test.ts requires', () => {
  const dest = copyManifests();
  setVersion(dest, '0.4.7');
  const json = (path: string) => JSON.parse(read(dest, path));
  assert.equal(json('packages/cli/package.json').version, '0.4.7');
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, '0.4.7');
  assert.equal(json('skill/.codex-plugin/plugin.json').version, '0.4.7');
});

test('a 1.0 or malformed version is refused, so the release cannot leave 0.x by accident', () => {
  const dest = copyManifests();
  assert.throws(() => setVersion(dest, '1.0.0'), /stays on 0\.x/);
  assert.throws(() => setVersion(dest, 'v0.2.0'), /not a plain x\.y\.z/);
  assert.throws(() => setVersion(dest, '0.2'), /not a plain x\.y\.z/);
});
