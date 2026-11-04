// The question controls in a real browser (internal spec, lede-lang/meta): size, overflow, contrast, labels and names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/index.ts';
import { AXE, browserTest } from './chrome.ts';

const SRC = readFileSync(new URL('../../../examples/parity/questions.lede', import.meta.url), 'utf8');

// Runs in the page. Returns problems as strings.
const MEASURE = `(() => {
  const bad = [];
  if (document.scrollingElement.scrollWidth > innerWidth) bad.push('page scrolls sideways');
  for (const el of document.querySelectorAll('.q input[type=text], .q textarea, .q-o')) {
    const h = el.getBoundingClientRect().height;
    if (h < 43.5) bad.push(el.tagName.toLowerCase() + '.' + el.className + ' is ' + Math.round(h) + 'px tall');
  }
  for (const f of document.querySelectorAll('fieldset.q')) {
    const l = f.querySelector(':scope > legend');
    if (!l || !l.textContent.trim()) bad.push('a fieldset has no legend');
  }
  for (const c of document.querySelectorAll('.q input, .q textarea')) {
    const l = c.labels && c.labels[0];
    if (!l || !l.textContent.trim()) bad.push('a control has no label: ' + c.name);
  }
  return bad;
})()`;

for (const scheme of ['light', 'dark'] as const) {
  browserTest(`question controls at 360 px, ${scheme}: no overflow, 44 px targets, labels, contrast`, async (browser) => {
    const { html } = await compile(SRC);
    const ctx = await browser.newContext({ viewport: { width: 360, height: 900 }, colorScheme: scheme, bypassCSP: true });
    const page = await ctx.newPage();
    await page.setContent(html);
    assert.deepEqual(await page.evaluate(MEASURE), []);
    await page.addScriptTag({ path: AXE });
    const found = (await page.evaluate(
      `axe.run(document, { runOnly: ['label', 'color-contrast'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')))`,
    )) as string[];
    assert.deepEqual(found, []);
    await ctx.close();
  });
}
