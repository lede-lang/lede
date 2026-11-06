// Accessibility gate (internal spec, lede-lang/meta): every shipped page, four settings, the WCAG 2.0 to 2.2 A and AA axe rules, zero
// violations. Needs Chromium: CHROME, the Playwright cache, or the cloud image path (bench/src/shot.ts). Skips without one unless
// LEDE_REQUIRE_CHROME=1, which fails instead. LEDE_A11Y_BEST_PRACTICE=1 also counts the best-practice rules (reported, never failing).
// Not in `pnpm test` (it needs a browser and minutes): `node --test test/a11y.test.ts`, run by the `a11y` job in ci.yml.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '@lede-lang/html';
import { chromium, resolveChrome } from '../bench/src/shot.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SETTINGS = [
  [360, 'light'],
  [360, 'dark'],
  [1280, 'light'],
  [1280, 'dark'],
] as const;
const NO_CHROME = 'no Chromium found: set CHROME to run the accessibility gate';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** axe-core is a bench dependency; it is resolved from there. */
const AXE = createRequire(new URL('../bench/package.json', import.meta.url)).resolve('axe-core/axe.min.js');

/** `.lede` files under `dir` (repo-relative, forward slashes), directly or at any depth. */
function ledeFiles(dir: string, recursive: boolean): string[] {
  return readdirSync(join(ROOT, dir), { recursive })
    .map((f) => String(f).split(sep).join('/'))
    .filter((f) => f.endsWith('.lede'))
    .map((f) => `${dir}/${f}`);
}

const examples = ledeFiles('examples', true).filter((f) => !f.includes('/as-written/'));
const cases = ledeFiles('conformance/cases', false);
const errors = ledeFiles('conformance/errors', false);
const corpus = [...examples, ...cases, ...errors].toSorted();

interface Run {
  violations: { id: string; target: string }[];
  incomplete: { id: string; n: number }[];
  best: { id: string; n: number }[];
}
// `axe` is the global the injected script defines. A target is a selector path; nested ones (iframes, shadow roots) are arrays.
const RUN = `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} }, resultTypes: ['violations', 'incomplete'] })
  .then(r => ({ violations: r.violations.flatMap(v => v.nodes.map(n => ({ id: v.id, target: n.target.join(' ') }))),
                incomplete: r.incomplete.map(v => ({ id: v.id, n: v.nodes.length })) }))`;
const RUN_BEST = `axe.run(document, { runOnly: { type: 'tag', values: ['best-practice'] }, resultTypes: ['violations'] })
  .then(r => r.violations.map(v => ({ id: v.id, n: v.nodes.length })))`;

const sum = (rows: { id: string; n: number }[]): string => {
  const by = new Map<string, number>();
  for (const { id, n } of rows) by.set(id, (by.get(id) ?? 0) + n);
  return (
    [...by]
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, n]) => `${id} ${n}`)
      .join(', ') || 'none'
  );
};

test(
  'every shipped page has zero axe violations at 360 and 1280 px, light and dark',
  { skip: resolveChrome() || process.env.LEDE_REQUIRE_CHROME ? false : NO_CHROME, timeout: 600_000 },
  async () => {
    const chrome = resolveChrome();
    assert.ok(chrome, NO_CHROME);
    // A glob that stops matching would make the gate pass over nothing.
    assert.ok(
      examples.length > 0 && cases.length > 0 && errors.length > 0,
      'the corpus is empty: examples/, conformance/cases/ or conformance/errors/',
    );
    const started = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'lede-a11y-'));
    const browser = await chromium.launch({ executablePath: chrome });
    try {
      // Full pages with errors rendered, as `--force` would write them. A file is also audited as a `--shell` page when that page differs
      // (the shell adds its script and data block only for a document with a field and an export), so the one mode that carries script
      // meets the same rules; where the two are byte-identical the plain page already covers it.
      const pages: { name: string; file: string }[] = [];
      let shellPages = 0;
      for (const [i, rel] of corpus.entries()) {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const plain = (await compile(src, {})).html;
        const shell = (await compile(src, { shell: true })).html;
        const add = (name: string, html: string, kind: string) => {
          const file = join(dir, `${i}-${kind}.html`);
          writeFileSync(file, html);
          pages.push({ name, file });
        };
        add(rel, plain, 'page');
        if (shell !== plain) {
          add(`${rel} [shell]`, shell, 'shell');
          shellPages++;
        }
      }

      // One context per setting, one page reused across the corpus: the context is the expensive object. Settings run one after the
      // other; if the whole run passes 8 minutes, `Promise.all(SETTINGS.map(audit))` is safe, as nothing is shared but the browser.
      const best = process.env.LEDE_A11Y_BEST_PRACTICE === '1';
      async function audit([width, scheme]: (typeof SETTINGS)[number]): Promise<Run[]> {
        // bypassCSP: pages ship default-src 'none', and the harness must still inject axe-core (bench/src/layout-check.ts does the same).
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
        const page = await ctx.newPage();
        const out: Run[] = [];
        for (const p of pages) {
          await page.goto(pathToFileURL(p.file).href, { waitUntil: 'load' });
          await page.addScriptTag({ path: AXE });
          const run = (await page.evaluate(RUN)) as Omit<Run, 'best'>;
          out.push({ ...run, best: best ? ((await page.evaluate(RUN_BEST)) as Run['best']) : [] });
        }
        await ctx.close();
        return out;
      }
      const results: Run[][] = [];
      for (const setting of SETTINGS) results.push(await audit(setting));

      const found: string[] = [];
      const ids: { id: string; n: number }[] = [];
      for (const [p, page] of pages.entries())
        for (const [s, [width, scheme]] of SETTINGS.entries())
          for (const { id, target } of results[s]?.[p]?.violations ?? []) {
            found.push(`${page.name} @${width} ${scheme}: ${id} ${target}`);
            ids.push({ id, n: 1 });
          }
      const all = results.flat();
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(
        `a11y: ${pages.length} pages (${corpus.length} files, ${shellPages} also as --shell) x ${SETTINGS.length} settings, ` +
          `${found.length} violations (${sum(ids)}), ${secs} s`,
      );
      console.log(`incomplete: ${sum(all.flatMap((r) => r.incomplete))}`);
      if (best) console.log(`best-practice violations: ${sum(all.flatMap((r) => r.best))}`);
      assert.equal(found.length, 0, `${found.length} accessibility violations:\n${found.join('\n')}`);
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
