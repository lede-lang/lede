// Brand tokens in a browser (D80, F10): the contrast the validator promises is the contrast axe measures. The kitchen-sink page is drawn
// in a theme whose text colours do not read (the control: axe must find them) and in the same theme after `parseTheme` has moved them,
// where axe must find none, at 360 and 1280 px, light and dark. The pages of the later features (the decision card, edge tones, callout kinds,
// the status pills and the page head, a dashboard) read the same tokens, so they are drawn in the moved theme too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTES, parseTheme, type ThemeTokens } from '@lede-lang/core';
import { compile } from '../src/index.ts';
import { AXE, browserTest, type Browser } from './chrome.ts';

const example = (path: string): string => readFileSync(new URL(`../../../examples/${path}`, import.meta.url), 'utf8');
const SRC = example('kitchen-sink.lede');
const LATER = [
  'parity/decisions.lede',
  'parity/edge-tones.lede',
  'parity/note-kinds.lede',
  'parity/page-meta.lede',
  'article/10-weekly-status.lede',
  'spike-c/01-dashboard.lede',
];
const loadFile = () => 'a,b\n1,2';

const FILE = {
  accent: '#ffd700',
  light: { fg2: '#999999', muted: '#bbbbbb', 'accent-ink': '#ffe066' },
  dark: { fg2: '#555555', muted: '#444444', accent: '#223344', 'accent-ink': '#223344' },
  series: ['#f5e6a0', '#102030', '#dddddd'],
};
/** The same colours as written, none of them moved: what a renderer with no validator would draw. */
const UNMOVED: ThemeTokens = {
  light: { ...PALETTES.paper.light, accent: '#ffd700', 'accent-ink': '#ffe066', fg2: '#999999', muted: '#bbbbbb' },
  dark: { ...PALETTES.paper.dark, accent: '#223344', 'accent-ink': '#223344', fg2: '#555555', muted: '#444444' },
  series: { light: ['#f5e6a0', '#102030', '#dddddd'], dark: ['#f5e6a0', '#102030', '#dddddd'] },
};

async function violations(browser: Browser, html: string, width: number, scheme: 'light' | 'dark'): Promise<string[]> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
  try {
    const page = await ctx.newPage();
    await page.setContent(html);
    await page.addScriptTag({ path: AXE });
    return (await page.evaluate(
      `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.flatMap(v => v.nodes.map(n => n.target.join(' '))))`,
    )) as string[];
  } finally {
    await ctx.close();
  }
}

browserTest(
  'a theme whose text does not read is a page axe finds contrast errors in, and the validated one is clean',
  async (browser) => {
    const { theme, diagnostics } = parseTheme(JSON.stringify(FILE));
    assert.ok(diagnostics.some((d) => d.code === 'theme-adjusted'));
    assert.deepEqual(
      diagnostics.filter((d) => d.severity === 'error'),
      [],
    );
    const moved = (await compile(SRC, { loadFile, theme })).html;
    const unmoved = (await compile(SRC, { loadFile, theme: UNMOVED })).html;
    let control = 0;
    for (const scheme of ['light', 'dark'] as const)
      for (const width of [360, 1280]) {
        control += (await violations(browser, unmoved, width, scheme)).length;
        assert.deepEqual(await violations(browser, moved, width, scheme), [], `${width}px ${scheme}`);
      }
    assert.ok(control > 0, 'the control: axe finds the unmoved colours');
  },
  300_000,
);

browserTest(
  'the pages of the decision, edge-tone, callout, status and dashboard features are clean in a moved theme',
  async (browser) => {
    const { theme } = parseTheme(JSON.stringify(FILE));
    for (const path of LATER) {
      const html = (await compile(example(path), { loadFile, theme })).html;
      for (const scheme of ['light', 'dark'] as const)
        for (const width of [360, 1280])
          assert.deepEqual(await violations(browser, html, width, scheme), [], `${path} ${width}px ${scheme}`);
    }
  },
  300_000,
);
