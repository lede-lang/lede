// Byte identity of `render()` (internal spec, lede-lang/meta): fixtures/render-hashes.json holds the SHA-256 of the ordinary,
// `fragment` and `artifact` output of every tracked `.lede` file outside bench/gen/ (the examples, conformance cases,
// parity fixtures, article pages), keyed by path and mode. A change to the renderer that moves one byte of one page fails here
// and shows as a reviewed JSON diff after `UPDATE=1 node --test packages/render-html/test/render-hashes.test.ts`, the way
// conformance/run.test.ts regenerates its expectations. bench/gen/ (the frozen model outputs, 600 files) is covered by a
// one-off sweep against `main` when the renderer is refactored, not by CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, type RenderOptions } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureUrl = new URL('./fixtures/render-hashes.json', import.meta.url);
const update = process.env.UPDATE === '1';

const MODES: Record<string, RenderOptions> = { ordinary: {}, fragment: { fragment: true }, artifact: { artifact: true } };

/** Every tracked `.lede` file outside bench/gen/, sorted. */
function tracked(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.lede'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((f) => f && !f.startsWith('bench/gen/'))
    .toSorted();
}

type Hashes = Record<string, Record<string, string>>;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function hashesOf(file: string): Promise<Record<string, string>> {
  const src = readFileSync(`${root}${file}`, 'utf8');
  const out: Record<string, string> = {};
  for (const [mode, opts] of Object.entries(MODES)) {
    // A stand-in for `data x < file.csv`, as conformance/run.test.ts uses, so those pages draw their charts.
    out[mode] = sha((await compile(src, { ...opts, loadFile: () => 'a,b\n1,2' })).html);
  }
  return out;
}

const files = tracked();
const expected: Hashes = update ? {} : (JSON.parse(readFileSync(fixtureUrl, 'utf8')) as Hashes);

for (const f of files) {
  test(`render bytes: ${f}`, async () => {
    const got = await hashesOf(f);
    if (update) {
      expected[f] = got;
      return;
    }
    assert.deepEqual(got, expected[f], `${f}: render() output changed (UPDATE=1 regenerates the fixture after an intentional change)`);
  });
}

test('render-hashes.json covers exactly the tracked files', () => {
  if (update) {
    const sorted = Object.fromEntries(Object.entries(expected).toSorted(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(fixtureUrl, `${JSON.stringify(sorted, null, 2)}\n`);
    return;
  }
  assert.deepEqual(Object.keys(expected).toSorted(), files);
});
