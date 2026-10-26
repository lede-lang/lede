// Layout battery for the renderer-parity spike: renders each examples/parity fixture, opens it at
// 1280px (light) and 400px (dark) in Chromium, and measures what string tests cannot.
//   node bench/src/layout-check.ts [fixture ...]     prints findings, exits 1 if any
// Findings carry the requirement they belong to (the renderer-parity requirements).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { compile } from '../../packages/render-html/src/index.ts';
import { resolveChrome } from './shot.ts';

const require = createRequire(import.meta.url);
export const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'examples', 'parity');

export interface Finding {
  fixture: string;
  width: number;
  scheme: string;
  req: string;
  msg: string;
}

export const fixtures = (): string[] =>
  readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.lede'))
    .map((f) => f.replace(/\.lede$/, ''))
    .sort();

// Runs in the page. Returns [{req, msg}].
const MEASURE = `(() => {
  const out = [];
  const add = (req, msg) => out.push({ req, msg });
  const desc = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const phone = innerWidth <= 500;
  const sw = document.scrollingElement.scrollWidth;
  if (sw > innerWidth) add('2.6', 'page scrolls sideways: scrollWidth ' + sw + ' > ' + innerWidth);

  const main = document.querySelector('main');
  for (const top of main.children) {
    const tr = top.getBoundingClientRect();
    if (!tr.width) continue;
    for (const el of top.querySelectorAll('*')) {
      if (el.closest('svg') || el.closest('.sr') || el.closest('pre') || el.closest('details:not([open])')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right > tr.right + 1 || r.left < tr.left - 1) add('2.1', desc(el) + ' extends ' + Math.round(Math.max(r.right - tr.right, tr.left - r.left)) + 'px past its block (' + desc(top) + ')');
    }
  }
  for (const s of document.querySelectorAll('.scroll')) {
    if (s.closest('details')) continue;
    if (s.scrollWidth > s.clientWidth + 1) add('2.1', desc(s) + ' scrolls sideways (' + s.scrollWidth + ' > ' + s.clientWidth + ')');
  }

  for (const kv of document.querySelectorAll('.kv')) {
    const cs = getComputedStyle(kv), r = kv.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    if (r.height > lh * 1.5) add('2.4', 'kpi value "' + kv.textContent + '" wraps (' + Math.round(r.height) + 'px tall, line ' + Math.round(lh) + 'px)');
    const tile = kv.closest('.kpi');
    if (tile && kv.scrollWidth > tile.clientWidth) add('2.4', 'kpi value "' + kv.textContent + '" is wider than its tile');
  }
  for (const c of document.querySelectorAll('code')) {
    if (c.closest('pre') || c.textContent.length > 32) continue;
    if (c.getClientRects().length > 1) add('2.5', 'inline code "' + c.textContent + '" wraps inside the token');
  }

  for (const svg of document.querySelectorAll('svg')) {
    const sr = svg.getBoundingClientRect();
    if (!sr.width) continue;
    const vb = svg.viewBox.baseVal;
    const scale = sr.width / vb.width;
    const kind = svg.classList.contains('chart') ? 'chart' : (svg.classList.contains('seq') || svg.querySelector('.life')) ? 'seq' : 'flow';
    const fig = svg.closest('figure').getBoundingClientRect();
    const texts = [...svg.querySelectorAll('text')];
    for (const t of texts) {
      const cs = getComputedStyle(t);
      const size = parseFloat(cs.fontSize) * scale;
      const label = '"' + t.textContent.slice(0, 24) + '" in ' + kind + ' (' + size.toFixed(1) + 'px)';
      if (kind === 'chart') {
        if (size < (phone ? 11 : 12) - 0.05) add('3.2', 'chart text ' + label + ' is under ' + (phone ? 11 : 12) + 'px');
      } else if (phone) {
        if (size < 11 - 0.05) add(kind === 'seq' ? '5.2' : '4.1', 'diagram text ' + label + ' is under 11px');
      } else if (kind === 'seq') {
        if (t.classList.contains('elabel') && size < 12 - 0.05) add('5.4', 'sequence message ' + label + ' is under 12px');
        if (t.classList.contains('name') && size < 13 - 0.05) add('5.4', 'participant name ' + label + ' is under 13px');
      }
      const r = t.getBoundingClientRect();
      if (r.width && (r.left < fig.left - 1 || r.right > fig.right + 1)) add(kind === 'seq' ? '5.2' : kind === 'chart' ? '3.2' : '4.1', label + ' is clipped by the figure (' + Math.round(r.left - fig.left) + ' / ' + Math.round(r.right - fig.right) + ')');
    }
    if (kind === 'chart') {
      const ticks = texts.filter(t => t.classList.contains('tick')).map(t => t.getBoundingClientRect());
      for (let i = 0; i < ticks.length; i++) for (let j = i + 1; j < ticks.length; j++) {
        const a = ticks[i], b = ticks[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) add('3.1', 'chart tick labels overlap');
      }
    }
  }
  return out;
})()`;

async function axeViolations(page: import('playwright-core').Page): Promise<number> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(
    `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.reduce((a, v) => a + v.nodes.length, 0))`,
  ) as Promise<number>;
}

/** `source` reads a page's Lede text by name; the default reads examples/parity/<name>.lede. */
export async function checkFixtures(
  names: string[] = fixtures(),
  browser?: Browser,
  source: (name: string) => string = (name) => readFileSync(join(FIXTURE_DIR, `${name}.lede`), 'utf8'),
): Promise<Finding[]> {
  const exe = resolveChrome();
  if (!exe) throw new Error('no Chromium: set CHROME');
  const own = !browser;
  browser ??= await chromium.launch({ executablePath: exe });
  const dir = mkdtempSync(join(tmpdir(), 'lede-layout-'));
  const findings: Finding[] = [];
  try {
    for (const name of names) {
      const { html } = await compile(source(name));
      const file = join(dir, `${name}.html`);
      writeFileSync(file, html);
      for (const [width, scheme, measure] of [
        [1280, 'light', true],
        [400, 'dark', true],
        [1280, 'dark', false],
        [400, 'light', false],
      ] as const) {
        // bypassCSP: pages ship default-src 'none' (D20); the harness must still inject axe-core.
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
        const page = await ctx.newPage();
        await page.goto(`file://${file}`, { waitUntil: 'load' });
        await page.waitForTimeout(50);
        const add = (req: string, msg: string) => findings.push({ fixture: name, width, scheme, req, msg });
        if (measure) for (const f of (await page.evaluate(MEASURE)) as { req: string; msg: string }[]) add(f.req, f.msg);
        else {
          const sw = (await page.evaluate('document.scrollingElement.scrollWidth - innerWidth')) as number;
          if (sw > 0) add('2.6', `page scrolls sideways by ${sw}px`);
        }
        const bad = await axeViolations(page);
        if (bad) add('8.3', `${bad} contrast violation${bad === 1 ? '' : 's'}`);
        await ctx.close();
      }
    }
  } finally {
    if (own) await browser.close();
    mkdirSync(dir, { recursive: true });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2);
  const found = await checkFixtures(names.length ? names : undefined);
  for (const f of found) console.log(`Req ${f.req}  ${f.fixture} @${f.width} ${f.scheme}: ${f.msg}`);
  console.log(found.length ? `${found.length} findings` : 'layout ok');
  process.exit(found.length ? 1 : 0);
}
