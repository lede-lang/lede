// Render check for a page a host wraps in its own document (the Claude Artifact tool): measures a rendered page from inside
// the browser and diffs the published page against the local `lede build` page by numbers, not by eye (internal spec,
// lede-lang/meta).
//   node bench/src/artifact-check.ts <page.lede> <published.json> [--out local.json] [--shell]
//   node bench/src/artifact-check.ts --print-probe
// <published.json> is an array of probe results (or one result), each taken in the published page at one setting: the
// published page's `width` and `scheme` choose the width and colour scheme the local page is opened at. --print-probe prints
// PROBE, an expression to evaluate in the published page (paste it in DevTools, or hand it to a browser tool): wrap it in
// `copy(JSON.stringify(...))` to get JSON. Switch the theme with the host's appearance setting, which sets `data-theme` on
// :root, and confirm the result's `theme` field; DevTools colour-scheme emulation does nothing once the host has set it.
// The local page is the full `lede build` page, the page the host should reproduce, not the `--artifact` output. --shell is
// passed through to compile() as `shell: true`, so a `--shell --artifact` page can be checked against a shell build; the
// renderer ignores it until it has that option. --out writes the local probe results, in the order of the published ones.
// Exit 0 when every comparison is inside its tolerance, 1 when any is not, 2 on a usage error or when no Chromium resolves.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { compile, type RenderOptions } from '../../packages/render-html/src/index.ts';
import { resolveChrome } from './shot.ts';

/**
 * Runs in the page and returns a JSON-serialisable object. `scheme` comes from `data-theme` first because the Artifact host
 * switches theme by setting that attribute on :root (the dark block applies under the media query only when `data-theme` is not
 * `light`, and always under `data-theme="dark"`); the media query alone would record a dark published page as light when the OS
 * is light. `col` is the centre column (`header.mast`, the first child of `main.doc`), which a host reset could narrow; `main`
 * spans the viewport and is kept for its height. `.tbl` is the table block's scroll wrapper, so the chart data tables inside
 * closed `<details>` are not counted. It must stay ASCII and under 3 KB.
 */
export const PROBE = `(() => {
  const main = document.querySelector('main.doc');
  if (!main) return { error: 'no main.doc in this frame' };
  const cs = (el, p) => el ? getComputedStyle(el).getPropertyValue(p) : null;
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
  const pick = sel => [...main.querySelectorAll(sel)].map(box);
  const root = document.documentElement;
  return {
    width: innerWidth, theme: root.getAttribute('data-theme'),
    scheme: root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    scroll: [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth],
    bodyBg: cs(document.body, 'background-color'), mainBg: cs(main, 'background-color'),
    font: { body: cs(main, 'font-family').split(',')[0], code: cs(main.querySelector('code, pre'), 'font-family')?.split(',')[0] },
    size: { h1: cs(main.querySelector('h1'), 'font-size'), h2: cs(main.querySelector('h2'), 'font-size'),
            p: cs(main.querySelector('p'), 'font-size'), kv: cs(main.querySelector('.kv'), 'font-size') },
    main: box(main), col: box(main.firstElementChild), pad: parseFloat(cs(main, 'padding-top')),
    kpis: pick('.kpis'), charts: pick('figure.chart-fig'), diagrams: pick('figure.viz.dg-fig'), tables: pick('.tbl'),
  };
})()`;

/** The tolerances of D66: sizes in px, the rest as a fraction of the local value. */
const TOL = { fontPx: 1, colWidth: 0.02, padPx: 1, mainHeight: 0.04, boxWidth: 0.02, boxHeight: 0.04 };
/** At or under this width the page is a phone page, and sideways scroll is a failure. */
const PHONE = 500;

type Box = [number, number];
export interface Probe {
  error?: string;
  width: number;
  theme: string | null;
  scheme: string;
  scroll: [number, number];
  bodyBg: string;
  mainBg: string;
  font: { body: string; code: string | null | undefined };
  size: { h1: string | null; h2: string | null; p: string | null; kv: string | null };
  main: Box;
  col: Box;
  pad: number;
  kpis: Box[];
  charts: Box[];
  diagrams: Box[];
  tables: Box[];
}
export interface Row {
  check: string;
  published: string;
  local: string;
  pass: boolean;
  /** Per-box detail lines for a row that failed. */
  why?: string[];
}

const BOXES = ['kpis', 'charts', 'diagrams', 'tables'] as const;
const unquote = (s: string | null | undefined) => (s ?? '').trim().replace(/^["']|["']$/g, '');
const px = (s: string | null) => (s === null ? Number.NaN : Number.parseFloat(s));
/** Distance of `a` from the local value `b` as a fraction of it (an absolute distance when `b` is 0). */
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtBox = (b: Box) => `${b[0]}x${b[1]}`;
const fmtBoxes = (bs: Box[]) => (bs.length ? bs.map(fmtBox).join(' ') : '-');

/** Compares one published probe result with the local one at the same setting. */
export function compare(pub: Probe, loc: Probe): Row[] {
  const rows: Row[] = [];
  const add = (check: string, published: string, local: string, pass: boolean, why?: string[]) =>
    rows.push({ check, published, local, pass, ...(why ? { why } : {}) });

  add('font.body (first family)', unquote(pub.font.body), unquote(loc.font.body), unquote(pub.font.body) === unquote(loc.font.body));
  add('font.code (first family)', unquote(pub.font.code), unquote(loc.font.code), unquote(pub.font.code) === unquote(loc.font.code));
  for (const k of ['h1', 'h2', 'p', 'kv'] as const) {
    const [a, b] = [px(pub.size[k]), px(loc.size[k])];
    // A missing element on both sides is a page without that element, not a difference.
    const same = pub.size[k] === null && loc.size[k] === null;
    add(`size.${k} (within ${TOL.fontPx} px)`, pub.size[k] ?? '-', loc.size[k] ?? '-', same || Math.abs(a - b) <= TOL.fontPx);
  }

  const colW = rel(pub.col[0], loc.col[0]);
  add(`col width (within ${pct(TOL.colWidth)})`, `${pub.col[0]} px`, `${loc.col[0]} px`, colW <= TOL.colWidth);
  add(`pad (within ${TOL.padPx} px)`, `${pub.pad} px`, `${loc.pad} px`, Math.abs(pub.pad - loc.pad) <= TOL.padPx);
  const mainH = rel(pub.main[1], loc.main[1]);
  add(`main height (within ${pct(TOL.mainHeight)})`, `${pub.main[1]} px`, `${loc.main[1]} px`, mainH <= TOL.mainHeight);

  for (const kind of BOXES) {
    const [ps, ls] = [pub[kind], loc[kind]];
    const why: string[] = [];
    if (ps.length !== ls.length) why.push(`${ps.length} published, ${ls.length} local`);
    ls.forEach((l, i) => {
      const p = ps[i];
      if (!p) return;
      const [dw, dh] = [rel(p[0], l[0]), rel(p[1], l[1])];
      if (dw > TOL.boxWidth || dh > TOL.boxHeight)
        why.push(`${kind}[${i}]: ${fmtBox(p)} vs ${fmtBox(l)} (width ${pct(dw)}, height ${pct(dh)})`);
    });
    add(
      `${kind} (width ${pct(TOL.boxWidth)}, height ${pct(TOL.boxHeight)})`,
      fmtBoxes(ps),
      fmtBoxes(ls),
      why.length === 0,
      why.length ? why : undefined,
    );
  }

  if (loc.scheme === 'dark') add('bodyBg (dark: equal)', pub.bodyBg, loc.bodyBg, pub.bodyBg === loc.bodyBg);
  else {
    // The host may paint its own light background outside main, so either of the two local values is enough.
    const ok = pub.bodyBg === loc.bodyBg || pub.mainBg === loc.mainBg;
    add('bodyBg or mainBg (light: one equal)', `${pub.bodyBg} / ${pub.mainBg}`, `${loc.bodyBg} / ${loc.mainBg}`, ok);
  }
  if (pub.width <= PHONE)
    add('scroll (phone: no sideways scroll)', pub.scroll.join(' / '), loc.scroll.join(' / '), pub.scroll[0] <= pub.scroll[1]);
  return rows;
}

const USAGE =
  'usage: node bench/src/artifact-check.ts <page.lede> <published.json> [--out local.json] [--shell]\n       node bench/src/artifact-check.ts --print-probe';

/** Prints a usage-level failure and returns exit code 2. */
function fail(msg: string): number {
  process.stderr.write(`${msg}\n`);
  return 2;
}

/** Reads the published results: an array of probe results, or one. */
function readPublished(path: string): Probe[] | string {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return `${path}: ${e instanceof Error ? e.message : String(e)}`;
  }
  const list = Array.isArray(data) ? data : [data];
  if (!list.length) return `${path}: no probe results`;
  for (const [i, p] of list.entries()) {
    const e = p as Partial<Probe> | null;
    if (!e || typeof e !== 'object') return `${path}: entry ${i + 1} is not an object`;
    if (typeof e.error === 'string') return `${path}: entry ${i + 1} is a probe error: ${e.error}`;
    if (typeof e.width !== 'number' || typeof e.scheme !== 'string' || !e.col || !e.main || !e.font || !e.size || !e.scroll)
      return `${path}: entry ${i + 1} is not a probe result (it needs width, scheme, scroll, font, size, main and col)`;
    for (const k of BOXES) e[k] ??= [];
  }
  return list as Probe[];
}

export async function main(argv: string[]): Promise<number> {
  if (argv.includes('--print-probe')) {
    process.stdout.write(`${PROBE}\n`);
    return 0;
  }
  const args: string[] = [];
  let out: string | null = null;
  let shell = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i] ?? null;
    else if (argv[i] === '--shell') shell = true;
    else args.push(argv[i]);
  }
  const [pagePath, publishedPath] = args;
  if (args.length !== 2 || (argv.includes('--out') && !out)) return fail(USAGE);
  const chrome = resolveChrome();
  if (!chrome) return fail('no Chromium found (set CHROME)');

  const published = readPublished(publishedPath);
  if (typeof published === 'string') return fail(published);
  let src: string;
  try {
    src = readFileSync(pagePath, 'utf8');
  } catch (e) {
    return fail(`${pagePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // The comparison is against the full page. `shell` is typed apart from RenderOptions so this compiles before and after
  // the renderer has the option; until then it is ignored.
  const options: RenderOptions & { shell?: boolean } = {};
  if (shell) options.shell = true;
  const { html, doc } = await compile(src, options);
  const errors = doc.diagnostics.filter((d) => d.severity === 'error');
  for (const d of errors) process.stderr.write(`${pagePath}:${d.line}:${d.col}: error [${d.code}] ${d.message}\n`);
  if (errors.length) return fail(`${pagePath} has ${errors.length} error(s); fix them first`);

  const dir = mkdtempSync(join(tmpdir(), 'lede-artifact-check-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, html);
  const browser = await chromium.launch({ executablePath: chrome });
  let local: Probe[];
  try {
    local = await Promise.all(
      published.map(async (p) => {
        const ctx = await browser.newContext({
          viewport: { width: p.width, height: 900 },
          colorScheme: p.scheme === 'dark' ? 'dark' : 'light',
        });
        try {
          const page = await ctx.newPage();
          await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
          await page.waitForTimeout(50);
          return await page.evaluate<Probe>(PROBE);
        } finally {
          await ctx.close();
        }
      }),
    );
  } finally {
    await browser.close();
  }
  if (out) writeFileSync(out, `${JSON.stringify(local, null, 2)}\n`);

  let failed = 0;
  let total = 0;
  for (const [i, pub] of published.entries()) {
    const loc = local[i];
    const rows = loc.error ? [{ check: 'local probe', published: '-', local: loc.error, pass: false } satisfies Row] : compare(pub, loc);
    process.stdout.write(`\n[${i + 1}] ${pub.width} px ${pub.scheme} (published data-theme: ${pub.theme ?? 'none'})\n`);
    const w = Math.max(...rows.map((r) => r.check.length));
    const wp = Math.min(40, Math.max(...rows.map((r) => r.published.length)));
    for (const r of rows) {
      process.stdout.write(`  ${r.pass ? 'ok  ' : 'FAIL'} ${r.check.padEnd(w)}  ${r.published.padEnd(wp)}  ${r.local}\n`);
      for (const line of r.why ?? []) process.stdout.write(`       ${line}\n`);
    }
    total += rows.length;
    failed += rows.filter((r) => !r.pass).length;
  }
  process.stdout.write(
    `\n${failed ? `${failed} of ${total} comparisons failed` : `all ${total} comparisons pass`}${out ? ` (local probe results in ${out})` : ''}\n`,
  );
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
