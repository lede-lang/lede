// A page of tabs in a real browser (spec §4.21, D85): which panel shows for which fragment, the back button, print, the phone width
// with the most tabs a page may have, and axe in both themes.
import assert from 'node:assert/strict';
import { parse, resolveTabs, TAB_MAX } from '@lede-lang/core';
import { render } from '../src/index.ts';
import { AXE, browserTest } from './chrome.ts';

async function page(count: number): Promise<string> {
  const files: Record<string, string> = {};
  const lines: string[] = [];
  for (let i = 1; i <= count; i++) {
    files[`p${i}.lede`] =
      `@title Section number ${i}\n\nThe text of section ${i}.\n\n## Detail ${i}\n\nMore about it, and [a link to the detail](#detail-${i}).\n`;
    lines.push(`tab Section ${i} < p${i}.lede`);
  }
  const doc = parse(`@title Review\n\nOne page, ${count} tabs.\n\n${lines.join('\n')}\n`);
  const parts = resolveTabs(doc, { read: (t) => ({ src: files[t.path], doc: parse(files[t.path]) }) });
  return render(doc, { parts });
}

// The id of each panel shown, and the label of each tab marked current.
type State = { shown: string[]; current: string[] };
const STATE = `(() => ({
  shown: [...document.querySelectorAll('.part')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.id),
  current: [...document.querySelectorAll('.tabbar a')].filter((a) => getComputedStyle(a).borderBottomColor !== 'rgba(0, 0, 0, 0)').map((a) => a.textContent),
}))()`;
const state = async (p: { evaluate: (s: string) => Promise<unknown> }): Promise<State> => (await p.evaluate(STATE)) as State;

browserTest(
  'tabs: the first shows by default, a link or a heading anchor shows its tab, back returns, print shows all',
  async (browser) => {
    const html = await page(3);
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const p = await ctx.newPage();
    // A real URL, so the fragment and the history behave as they do for a reader.
    await p.route('https://tabs.example/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await p.goto('https://tabs.example/page');
    assert.deepEqual(await state(p), { shown: ['section-1'], current: ['Section 1'] });
    await p.click('.tl3');
    assert.deepEqual(await state(p), { shown: ['section-3'], current: ['Section 3'] });
    await p.click('#section-3 a[href="#section-3--detail-3"]');
    assert.deepEqual(await state(p), { shown: ['section-3'], current: ['Section 3'] });
    await p.goto('https://tabs.example/page#section-2--detail-2');
    assert.deepEqual(await state(p), { shown: ['section-2'], current: ['Section 2'] });
    await p.goBack();
    assert.deepEqual((await state(p)).shown, ['section-3']);
    await p.emulateMedia({ media: 'print' });
    assert.deepEqual((await state(p)).shown, ['section-1', 'section-2', 'section-3']);
    await ctx.close();
  },
);

for (const scheme of ['light', 'dark'] as const)
  for (const width of [360, 1000])
    browserTest(
      `tabs: ${TAB_MAX} tabs at ${width} px, ${scheme}: no sideways page scroll, 44 px tab targets, axe clean`,
      async (browser) => {
        const html = await page(TAB_MAX);
        const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, bypassCSP: true });
        const p = await ctx.newPage();
        await p.setContent(html);
        const bad = await p.evaluate<string[]>(`(() => {
        const bad = [];
        if (document.scrollingElement.scrollWidth > innerWidth) bad.push('page scrolls sideways');
        for (const a of document.querySelectorAll('.tabbar a')) if (a.getBoundingClientRect().height < 43.5) bad.push(a.textContent + ' is short');
        return bad;
      })()`);
        assert.deepEqual(bad, []);
        await p.addScriptTag({ path: AXE });
        const found = await p.evaluate<string[]>(
          `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')))`,
        );
        assert.deepEqual(found, []);
        await ctx.close();
      },
    );
