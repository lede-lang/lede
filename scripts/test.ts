// `pnpm test`: runs the test files under node --test. `--browser` keeps only the files with a browser check, `--no-browser` only the
// rest, so CI can run the second set without installing Chromium. Any other argument goes to node --test ahead of the
// files, so a file named there is added to the run (CI adds test/a11y.test.ts); to run one file alone, use node --test.
// A file is a browser file when it imports what finds or drives Chromium (chrome.ts, bench/src/shot.ts, playwright-core, or a harness
// built on them); a file with both kinds of check goes with the browser files whole. A browser file this misses still fails loudly in
// the no-browser CI job: with CI set and no Chromium, a browser check fails instead of skipping.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIRS = [...readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}/test`), 'bench/test'];
const SINGLE = [
  'conformance/run.test.ts',
  'conformance/runner.test.ts',
  'test/set-version.test.ts',
  'test/runtime-hash-note.test.ts',
  'test/skill-zip.test.ts',
];
const BROWSER = /(?:from |import\()['"][^'"]*(?:\/chrome\.ts|\/shot\.ts|playwright-core|\/layout-check\.ts|\/exfil\/run\.ts)['"]/;

function testFiles(only?: 'browser' | 'no-browser'): string[] {
  const all = [
    ...DIRS.flatMap((d) =>
      readdirSync(join(ROOT, d))
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => `${d}/${f}`),
    ),
    ...SINGLE,
  ].toSorted();
  if (!only) return all;
  return all.filter((f) => BROWSER.test(readFileSync(join(ROOT, f), 'utf8')) === (only === 'browser'));
}

const args = process.argv.slice(2);
const only = args.includes('--browser') ? 'browser' : args.includes('--no-browser') ? 'no-browser' : undefined;
const rest = args.filter((a) => a !== '--browser' && a !== '--no-browser');
const r = spawnSync(process.execPath, ['--test', ...rest, ...testFiles(only)], { cwd: ROOT, stdio: 'inherit' });
process.exitCode = r.status ?? 1;
