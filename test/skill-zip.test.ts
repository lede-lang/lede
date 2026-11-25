// scripts/skill-zip.ts and its place in .releaserc.json (D87): the release zip holds every file of skill/lede/ under `lede/`,
// byte for byte, the same checkout gives the same bytes, and semantic-release builds it and attaches it to the GitHub release.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { readTree, skillZip, storedZip } from '../scripts/skill-zip.ts';
import { root } from '../scripts/pack.ts';

/** The entries of a zip, read from its central directory, as a reader that trusts no local header would. */
function unzip(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'no end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    out.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('the zip holds every file of skill/lede/ under lede/, byte for byte and in order', () => {
  const tree = readTree(join(root, 'skill', 'lede'));
  const names = tree.map((f) => f.name);
  for (const must of ['SKILL.md', 'LICENSE']) assert.ok(names.includes(must), `${must} missing from skill/lede/`);
  assert.ok(
    names.some((n) => n.startsWith('reference/')),
    'the skill tells agents to read reference/, so the zip must carry it',
  );
  assert.deepEqual(
    unzip(skillZip()),
    tree.map(({ name, data }) => ({ name: `lede/${name}`, data })),
  );
});

test('the same files give the same bytes', () => {
  assert.ok(skillZip().equals(skillZip()));
  const files = [
    { name: 'a/é.txt', data: Buffer.from('x') },
    { name: 'b', data: Buffer.alloc(0) },
  ];
  assert.ok(storedZip(files).equals(storedZip(files)));
  assert.deepEqual(unzip(storedZip(files)), files);
});

test('unzip(1), when installed, reads the zip with no error', (t) => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    t.skip('unzip is not installed');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'lede-skill-zip-'));
  try {
    const out = join(dir, 'lede-skill.zip');
    execFileSync(process.execPath, [join(root, 'scripts', 'skill-zip.ts'), out]);
    execFileSync('unzip', ['-tq', out], { stdio: 'pipe' });
    execFileSync('unzip', ['-q', out, '-d', join(dir, 'x')]);
    assert.equal(readFileSync(join(dir, 'x', 'lede', 'SKILL.md'), 'utf8'), readFileSync(join(root, 'skill', 'lede', 'SKILL.md'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('semantic-release builds the zip in prepare and attaches it to the GitHub release', () => {
  const config = JSON.parse(readFileSync(join(root, '.releaserc.json'), 'utf8')) as {
    plugins: (string | [string, Record<string, unknown>])[];
  };
  const options = (name: string) => {
    const entry = config.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
    assert.ok(Array.isArray(entry), `${name} has no options in .releaserc.json`);
    return entry[1];
  };
  assert.match(String(options('@semantic-release/exec')['prepareCmd']), /node scripts\/skill-zip\.ts release\/lede-skill\.zip/);
  assert.deepEqual(
    (options('@semantic-release/github')['assets'] as { path: string; name: string }[]).map(({ path, name }) => ({ path, name })),
    [{ path: 'release/lede-skill.zip', name: 'lede-skill.zip' }],
  );
});
