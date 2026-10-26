import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const json = (path: string): Record<string, any> => JSON.parse(readFileSync(join(root, path), 'utf8'));

// Hosts cache an installed plugin by version, so a skill change that keeps the old version never reaches them.
test('both plugin manifests carry the CLI version', () => {
  const version = json('packages/cli/package.json').version;
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, version);
  assert.equal(json('skill/.codex-plugin/plugin.json').version, version);
});

// An install copies the plugin source: the skill folder only, so the CC0 licence is true of everything it ships.
test('both plugins install the skill folder, not the repository', () => {
  const claude = json('.claude-plugin/marketplace.json').plugins[0];
  assert.equal(claude.source, './skill');
  for (const s of claude.skills) assert.ok(existsSync(join(root, 'skill', s, 'SKILL.md')), s);
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].source.path, './skill');
});
