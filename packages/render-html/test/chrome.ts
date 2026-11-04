// Browser checks for the question words and the shell. Not a `*.test.ts`, so the runner does not collect it.
// A check skips, with a message, when no Chromium resolves, and fails instead when CI or LEDE_REQUIRE_CHROME is set (internal spec, lede-lang/meta).
// LEDE_SHELL_CHROME is read before CHROME so CI can enable these checks without switching on the older Chromium batteries.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, resolveChrome } from '../../../bench/src/shot.ts';

export type Browser = Awaited<ReturnType<typeof chromium.launch>>;

const own = process.env.LEDE_SHELL_CHROME;
const chromePath = (): string | null => (own ? (existsSync(own) ? own : null) : resolveChrome());
const required = Boolean(process.env.CI || process.env.LEDE_REQUIRE_CHROME);

/** axe-core is a bench dependency; it is resolved from there. */
export const AXE = createRequire(new URL('../../../bench/src/shot.ts', import.meta.url)).resolve('axe-core/axe.min.js');

/** One browser per test file, launched by the first check that needs it and closed when the file's checks are done; each check opens its own context. */
let launched: Promise<Browser> | undefined;
let closer = false;
function shared(exe: string): Promise<Browser> {
  launched ??= chromium.launch({ executablePath: exe });
  return launched;
}

export function browserTest(name: string, fn: (browser: Browser) => Promise<void>, timeout = 120_000): void {
  // The hook is registered here, at the top level of the test file, so it runs once after all of the file's checks.
  if (!closer) {
    closer = true;
    after(async () => (await launched)?.close());
  }
  const exe = chromePath();
  if (!exe && !required) {
    test(name, { skip: 'no Chromium found: set LEDE_SHELL_CHROME or CHROME' }, () => {});
    return;
  }
  test(name, { timeout }, async () => {
    assert.ok(exe, 'no Chromium found, and CI or LEDE_REQUIRE_CHROME is set: set LEDE_SHELL_CHROME or CHROME');
    await fn(await shared(exe));
  });
}
