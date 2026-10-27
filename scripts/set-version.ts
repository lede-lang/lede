// Writes one version into everything that carries it (D54): the three published packages, and the plugin manifests that
// hosts cache an installed plugin by (packages/cli/test/plugin-manifests.test.ts pins them to the CLI version). semantic-release
// runs it as its prepare step, so the tag, the changelog and these files agree; the packages move in lockstep because pnpm packs
// `workspace:*` as an exact pin (D48).
//   node scripts/set-version.ts 0.2.1
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGES, root as REPO_ROOT } from './pack.ts';

/** Repo-relative paths of every file that holds the release version, each with exactly one `"version"` key. */
export const VERSION_FILES = [
  ...PACKAGES.map((name) => `packages/${name}/package.json`),
  '.claude-plugin/marketplace.json',
  'skill/.claude-plugin/plugin.json',
  'skill/.codex-plugin/plugin.json',
];

const SEMVER = /^\d+\.\d+\.\d+$/;
const VERSION_KEY = /("version":\s*")[^"]+(")/g;

/** Rewrites the version in each file, keeping its formatting; returns the paths it wrote. */
export function setVersion(root: string, version: string): string[] {
  if (!SEMVER.test(version)) throw new Error(`not a plain x.y.z version: ${version}`);
  if (!version.startsWith('0.')) throw new Error(`refusing ${version}: every package stays on 0.x until the owner says otherwise (D54)`);
  return VERSION_FILES.map((path) => {
    const file = join(root, path);
    const text = readFileSync(file, 'utf8');
    if ((text.match(VERSION_KEY) ?? []).length !== 1) throw new Error(`${path} must hold exactly one "version" key`);
    writeFileSync(file, text.replace(VERSION_KEY, `$1${version}$2`));
    return path;
  });
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) throw new Error('usage: node scripts/set-version.ts <version>');
  for (const path of setVersion(REPO_ROOT, version)) console.log(`set ${version} in ${path}`);
}
