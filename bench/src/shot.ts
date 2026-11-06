// Screenshot helper: node bench/src/shot.ts page.html out-prefix [widths...]
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * The newest Playwright Chromium under `cache` for the given per-build paths, or null. Builds are numbered, so the highest number is the
 * newest; a `chromium_headless_shell-*` or `ffmpeg-*` directory next to them is not a Chromium and does not match.
 */
function newestChromium(cache: string, paths: string[]): string | null {
  if (!existsSync(cache)) return null;
  for (const d of readdirSync(cache)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))) {
    for (const rel of paths) {
      const p = `${cache}/${d}/${rel}`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * CHROME, else the Claude Code cloud image path, else the newest Playwright Chromium in the Linux cache (PLAYWRIGHT_BROWSERS_PATH or
 * ~/.cache/ms-playwright, which is where `playwright-core install chromium` puts it on a CI runner), else the one in the macOS cache.
 */
export function resolveChrome(): string | null {
  const cloud = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (process.env.CHROME) return existsSync(process.env.CHROME) ? process.env.CHROME : null;
  if (existsSync(cloud)) return cloud;
  // Older Playwright builds unpack to chrome-linux/, newer ones to chrome-linux64/. A PLAYWRIGHT_BROWSERS_PATH that holds no Chromium
  // (it can also be "0", meaning inside node_modules) does not stop the lookup in the default cache.
  for (const cache of [process.env.PLAYWRIGHT_BROWSERS_PATH, `${homedir()}/.cache/ms-playwright`]) {
    const linux = cache ? newestChromium(cache, ['chrome-linux/chrome', 'chrome-linux64/chrome']) : null;
    if (linux) return linux;
  }
  const app = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  return newestChromium(
    `${homedir()}/Library/Caches/ms-playwright`,
    ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-mac'].map((arch) => `${arch}/${app}`),
  );
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
