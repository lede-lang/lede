// Browser checks: the question words, the shell, the editor words, the layout, chart, diagram and block batteries. Not a `*.test.ts`, so the
// runner does not collect it. A check skips, with a message, when no Chromium resolves (`CHROME`, the cloud image path, or the macOS Playwright
// cache: `resolveChrome` in bench/src/shot.ts), and fails instead when CI or LEDE_REQUIRE_CHROME is set (internal spec, lede-lang/meta).
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, resolveChrome } from '../../../bench/src/shot.ts';
import { RUNTIME } from '../src/index.ts';

export type Browser = Awaited<ReturnType<typeof chromium.launch>>;

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
  const exe = resolveChrome();
  if (!exe && !required) {
    test(name, { skip: 'no Chromium found: set CHROME' }, () => {});
    return;
  }
  test(name, { timeout }, async () => {
    assert.ok(exe, 'no Chromium found, and CI or LEDE_REQUIRE_CHROME is set: set CHROME');
    await fn(await shared(exe));
  });
}

/** The stub origin a served page lives at. */
export const PAGE_URL = 'https://lede.test/page.html';

/**
 * Opens `html` in a new context at a stub https origin, so the page keeps its policy (the shell runs only if its hash is the page's) and
 * the Clipboard API has a secure context. `clipboard` grants read and write, `init` runs before the page's own scripts, and `logs`
 * collects the console. Close the returned context when the check is done.
 */
export async function serve(
  browser: Browser,
  html: string,
  o: { width?: number; init?: string | undefined; javaScriptEnabled?: boolean; clipboard?: boolean } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width: o.width ?? 1280, height: 900 },
    javaScriptEnabled: o.javaScriptEnabled ?? true,
  });
  if (o.clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(PAGE_URL).origin });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  if (o.init) await page.addInitScript(o.init);
  await page.route(PAGE_URL, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(PAGE_URL);
  return { ctx, page, logs };
}

/** The same page with its runtime changed by one byte: the policy stops the script, so the page is what a reader without script sees. */
export function tamper(html: string): string {
  const out = html.replace(`<script>${RUNTIME}</script>`, () => `<script>${RUNTIME} </script>`);
  assert.notEqual(out, html);
  return out;
}
