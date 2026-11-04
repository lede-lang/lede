// The editor words' controls in a real browser at phone width (internal spec, lede-lang/meta): size, overflow, contrast, labels.
// Static markup only: the runtime that makes them live has its own checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/index.ts';
import { AXE, browserTest } from './chrome.ts';

const SRC = readFileSync(new URL('../../../examples/parity/editors.lede', import.meta.url), 'utf8');

// Runs in the page. Returns problems as strings.
const MEASURE = `(() => {
  const bad = [];
  if (document.scrollingElement.scrollWidth > innerWidth) bad.push('page scrolls sideways');
  for (const q of document.querySelectorAll('.q')) {
    const r = q.getBoundingClientRect();
    if (r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(q.className + ' leaves the viewport: ' + Math.round(r.left) + ' to ' + Math.round(r.right));
    if (q.scrollWidth > q.clientWidth + 1) bad.push(q.className + ' overflows its own box');
  }
  const targets = '.q input[type=text], .q input[type=range], .q input[type=number], .q textarea, .q-o, .q-seg label, .q-toggle > label, .q button, .q-copy';
  for (const el of document.querySelectorAll(targets)) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.height < 43.5) bad.push(el.tagName.toLowerCase() + '.' + el.className + ' is ' + Math.round(r.height) + 'px tall');
    if (r.width < 43.5 && !el.matches('input[type=number]')) bad.push(el.tagName.toLowerCase() + '.' + el.className + ' is ' + Math.round(r.width) + 'px wide');
  }
  for (const f of document.querySelectorAll('fieldset.q')) {
    const l = f.querySelector(':scope > legend');
    if (!l || !l.textContent.trim()) bad.push('a fieldset has no legend');
  }
  for (const c of document.querySelectorAll('.q input, .q textarea')) {
    const l = c.labels && c.labels[0];
    const named = (l && l.textContent.trim()) || c.getAttribute('aria-label');
    if (!named) bad.push('a control has no name: ' + c.name);
  }
  return bad;
})()`;

const COUNTS = `(() => ({
  range: document.querySelectorAll('input[type=range]').length,
  number: document.querySelectorAll('input[type=number]').length,
  checkbox: document.querySelectorAll('input[type=checkbox]').length,
  seg: document.querySelectorAll('.q-seg').length,
  tiles: document.querySelectorAll('.q-bk .q-n').length,
  tpl: document.querySelectorAll('figure.q-tpl pre code').length,
  preset: document.querySelectorAll('.q-preset .q-pv').length,
}))()`;

for (const shell of [false, true])
  for (const scheme of ['light', 'dark'] as const) {
    browserTest(
      `editor controls${shell ? ' with the shell' : ''} at 360 px, ${scheme}: no overflow, 44 px targets, names, contrast`,
      async (browser) => {
        const { html } = await compile(SRC, { shell });
        const ctx = await browser.newContext({ viewport: { width: 360, height: 900 }, colorScheme: scheme, bypassCSP: true });
        const page = await ctx.newPage();
        await page.setContent(html);
        const counts = (await page.evaluate(COUNTS)) as Record<string, number>;
        assert.ok(counts.range >= 1 && counts.number === counts.range, `a range and a number box per param: ${JSON.stringify(counts)}`);
        assert.ok(
          counts.checkbox >= 2 && counts.seg === 3 && counts.tiles === 3 && counts.tpl === 1 && counts.preset === 1,
          JSON.stringify(counts),
        );
        assert.deepEqual(await page.evaluate(MEASURE), []);
        await page.addScriptTag({ path: AXE });
        const found = (await page.evaluate(
          `axe.run(document, { runOnly: ['label', 'color-contrast'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')))`,
        )) as string[];
        assert.deepEqual(found, []);
        await ctx.close();
      },
    );
  }
