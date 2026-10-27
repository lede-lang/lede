import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const json = (path: string): Record<string, any> => JSON.parse(readFileSync(join(root, path), 'utf8'));

// Hosts cache an installed plugin by version, so a skill change that keeps the old version never reaches them.
test('every plugin manifest carries the CLI version', () => {
  const version = json('packages/cli/package.json').version;
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, version);
  assert.equal(json('skill/.claude-plugin/plugin.json').version, version);
  assert.equal(json('skill/.codex-plugin/plugin.json').version, version);
});

// An install copies the plugin source: the skill folder only, so the CC0 licence is true of everything it ships.
test('both plugins install the skill folder, not the repository', () => {
  const claude = json('.claude-plugin/marketplace.json').plugins[0];
  assert.equal(claude.source, './skill');
  for (const s of json('skill/.claude-plugin/plugin.json').skills) assert.ok(existsSync(join(root, 'skill', s, 'SKILL.md')), s);
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].source.path, './skill');
});

// Claude Code refuses to load a plugin whose manifest and marketplace entry both declare components ("conflicting manifests"),
// and `claude plugin validate` does not catch it: only an install does. The plugin folder's own manifest is the one that declares them.
test('the marketplace entry declares no components and does not switch the plugin manifest off', () => {
  const entry = json('.claude-plugin/marketplace.json').plugins[0];
  for (const key of ['skills', 'agents', 'commands', 'hooks', 'mcpServers', 'strict']) assert.equal(entry[key], undefined, key);
  assert.ok(existsSync(join(root, 'skill/.claude-plugin/icon.png')), 'the plugin directory wants a square icon beside the manifest');
});

// The plugin directory lists these four links and shows "Not set" for any that is missing.
test('the Claude plugin manifest links its documentation, support, privacy and terms pages', () => {
  const manifest = json('skill/.claude-plugin/plugin.json');
  for (const key of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl'])
    assert.match(manifest[key], /^https:\/\//, key);
});
