// Browser checks for the question words and the shell. Not a `*.test.ts`, so the runner does not collect it.
// A check skips, with a message, when no Chromium resolves, and fails instead when CI or LEDE_REQUIRE_CHROME is set (spec A7).
// LEDE_SHELL_CHROME is read before CHROME so CI can enable these checks without switching on the older Chromium batteries.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, resolveChrome } from '../../../bench/src/shot.ts';

export type Browser = Awaited<ReturnType<typeof chromium.launch>>;

const own = process.env.LEDE_SHELL_CHROME;
export const chromePath = (): string | null => (own ? (existsSync(own) ? own : null) : resolveChrome());
const required = Boolean(process.env.CI || process.env.LEDE_REQUIRE_CHROME);

/** axe-core is a bench dependency; it is resolved from there. */
export const AXE = createRequire(new URL('../../../bench/src/shot.ts', import.meta.url)).resolve('axe-core/axe.min.js');

export function browserTest(name: string, fn: (browser: Browser) => Promise<void>, timeout = 120_000): void {
  const exe = chromePath();
  if (!exe && !required) {
    test(name, { skip: 'no Chromium found: set LEDE_SHELL_CHROME or CHROME' }, () => {});
    return;
  }
  test(name, { timeout }, async () => {
    assert.ok(exe, 'no Chromium found, and CI or LEDE_REQUIRE_CHROME is set: set LEDE_SHELL_CHROME or CHROME');
    const browser = await chromium.launch({ executablePath: exe });
    try {
      await fn(browser);
    } finally {
      await browser.close();
    }
  });
}
