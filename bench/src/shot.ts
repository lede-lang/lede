// Screenshot helper: node bench/src/shot.ts page.html out-prefix [widths...]
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

/** CHROME, else the Claude Code cloud image path, else the newest Playwright Chromium in the macOS cache. */
export function resolveChrome(): string | null {
  const cloud = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (process.env.CHROME) return existsSync(process.env.CHROME) ? process.env.CHROME : null;
  if (existsSync(cloud)) return cloud;
  const cache = `${homedir()}/Library/Caches/ms-playwright`;
  if (!existsSync(cache)) return null;
  for (const d of readdirSync(cache)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort()
    .reverse()) {
    for (const arch of ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-mac']) {
      const p = `${cache}/${d}/${arch}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}
/** Re-exported so tests outside bench/ can drive Chromium without their own playwright-core dependency. */
export { chromium };
export const CHROME = resolveChrome() ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export async function shots(file: string, prefix: string, widths = [1280, 400], schemes: ('light' | 'dark')[] = ['light', 'dark']) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const out: string[] = [];
  for (const w of widths)
    for (const s of schemes) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: s });
      await page.goto('file://' + resolve(file));
      await page.waitForTimeout(150);
      const p = `${prefix}-${w}-${s}.png`;
      await page.screenshot({ path: p, fullPage: true });
      out.push(p);
      await page.close();
    }
  await browser.close();
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [f, pre, ...ws] = process.argv.slice(2);
  console.log(await shots(f, pre, ws.length ? ws.map(Number) : undefined));
}
