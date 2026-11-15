import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

// The same block the skill test pins to the frozen 0.5 reference: lines 4 to 103 of the prompt file.
const reference = read('bench/prompts/C-lede-0.5.md').split('\n').slice(3, 103).join('\n');
const single = [
  'integrations/agents-md/AGENTS.md',
  'integrations/cursor/lede.mdc',
  'integrations/copilot/copilot-instructions.md',
  'integrations/gemini/GEMINI.md',
  'integrations/system-prompt/lede.txt',
];

test('every generated integration file is fresh', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/gen-integrations.ts'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('every integration carries the model reference verbatim', () => {
  for (const path of single) assert.ok(read(path).includes(reference), path);
});

test('generated files say where they came from, where the format allows a comment', () => {
  for (const path of single) assert.match(read(path), /generated from skill\/lede\/SKILL\.md/, path);
});

test("the AGENTS.md snippet fits Codex's 32 KiB default with room for the project's own file", () => {
  assert.ok(Buffer.byteLength(read('integrations/agents-md/AGENTS.md')) < 16 * 1024);
});

test('the Cursor rule is a .mdc file with description, globs and alwaysApply: false', () => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(read('integrations/cursor/lede.mdc'));
  assert.ok(m, 'frontmatter');
  const lines = m[1].split('\n');
  assert.deepEqual(
    lines.map((l) => l.split(':')[0]),
    ['description', 'globs', 'alwaysApply'],
  );
  assert.match(lines[0], /^description: ".+"$/);
  assert.equal(lines[1], 'globs: "**/*.lede"');
  assert.equal(lines[2], 'alwaysApply: false');
});

test('the Gemini manifest parses, tracks the package version and names an existing context file', () => {
  const manifest = JSON.parse(read('integrations/gemini/gemini-extension.json')) as Record<string, string>;
  assert.equal(manifest.version, (JSON.parse(read('packages/cli/package.json')) as { version: string }).version);
  assert.equal(manifest.name, 'lede');
  assert.equal(manifest.contextFileName, 'GEMINI.md');
  assert.ok(read('integrations/gemini/GEMINI.md').length > 0);
});

// Skill scanners (`npx skills add`) list one skill per name and took a committed copy over the source when there was one.
test('the repository holds one SKILL.md', () => {
  const r = spawnSync('git', ['ls-files', '*SKILL.md'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['skill/lede/SKILL.md']);
});

test('the system prompt snippet says how to compile', () => {
  assert.ok(read('integrations/system-prompt/lede.txt').includes('npx @lede-lang/cli build page.lede -o page.html'));
});
