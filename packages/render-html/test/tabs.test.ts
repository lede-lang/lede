// A page of tabs (spec §4.21, D85): each panel is its part's own page, moved under the manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, resolveTabs, type LedeDocument, type TabPart } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const loadFile = () => 'a,b\n1,2';

/** The parts of `manifest`, read from `files` (path to text). */
function tabbed(manifest: string, files: Record<string, string>): { doc: LedeDocument; parts: TabPart[] } {
  const doc = parse(manifest);
  const parts = resolveTabs(doc, { read: (t) => ({ src: files[t.path], doc: parse(files[t.path], { loadFile }) }) });
  return { doc, parts };
}

/** The markup between a panel's opening tag and its closing one. */
function panel(html: string, id: string): string {
  const open = new RegExp(`<section class="doc part[^"]*" id="${id}"[^>]*>\\n`).exec(html);
  assert.ok(open, `no panel ${id}`);
  const from = open.index + open[0].length;
  return html.slice(from, html.indexOf('\n</section>', from));
}

/**
 * A part's standalone `<main>` contents as its panel should hold them: every id, and every reference to one, given `prefix`, and every
 * heading one level down (spec §4.21: the three changes a panel makes, of which the third, the page-level keys, draws nothing here).
 */
function asPanel(main: string, prefix: string): string {
  const inner = main.slice(main.indexOf('>\n') + 2, main.lastIndexOf('\n</main>'));
  const ids = new Set([...inner.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return inner
    .replace(/(\sid=")/g, `$1${prefix}`)
    .replace(/(\shref="#)([^"]+)"/g, (all, open: string, to: string) => (ids.has(to) ? `${open}${prefix}${to}"` : all))
    .replace(/url\(#/g, `url(#${prefix}`)
    .replace(
      /(\s(?:aria-labelledby|aria-describedby)=")([^"]*)"/g,
      (_, a: string, refs: string) =>
        `${a}${refs
          .split(' ')
          .map((i) => prefix + i)
          .join(' ')}"`,
    )
    .replace(/(\sname="_)/g, `$1${prefix}`)
    .replace(/<(\/?)h(\d)([\s>])/g, (_, slash: string, n: string, after: string) => `<${slash}h${Number(n) + 1}${after}`);
}

const EXAMPLES = [
  'examples/kitchen-sink.lede',
  'examples/parity/charts.lede',
  'examples/parity/code.lede',
  'examples/parity/decisions.lede',
  'examples/parity/flow-nested.lede',
  'examples/parity/sequence-4.lede',
  'examples/parity/grid.lede',
  'examples/parity/page-meta.lede',
  'examples/article/06-rate-limiter-explainer.lede',
  'examples/article/11-incident-report.lede',
];

test("each panel is its part's standalone page, with ids prefixed and headings one level down", async () => {
  const files = Object.fromEntries(EXAMPLES.map((p) => [p, read(p)]));
  const { doc, parts } = tabbed(`@title All\n\n${EXAMPLES.map((p, i) => `tab Part ${i} < ${p}`).join('\n')}\n`, files);
  const html = await render(doc, { parts });
  for (const [i, p] of EXAMPLES.entries()) {
    const alone = await render(parse(files[p], { loadFile }), { fragment: true });
    assert.equal(panel(html, `part-${i}`), asPanel(alone, `part-${i}--`), p);
  }
});

test('the page: masthead, lead, a bar of links, one panel per part with its path and hash, no script', async () => {
  const { doc, parts } = tabbed(
    '@title Review\n@subtitle Three writers\n\nWhat changed.\n\n## Costs\n\ntab Costs < a.lede\ntab < b.lede\n',
    {
      'a.lede': '# Spend\nUp.\n',
      'b.lede':
        '@title Risks\n\n# Outage\nDown. See [below](#detail) and [out](https://example.com/#x), or [the costs](#costs-2).\n\n## Detail\nMore.\n',
    },
  );
  parts[0].sha = 'aaaaaaaaaaaa';
  const html = await render(doc, { parts });
  assert.doesNotMatch(html, /<script/);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(main, /^<main class="doc tabs">\n<header class="mast"><h1>Review<\/h1><p class="subtitle">Three writers<\/p><\/header>/);
  assert.match(
    main,
    /<p class="lead">What changed\.<\/p>\n<h2 id="costs">Costs<\/h2>\n<nav class="tabbar" aria-label="Tabs" tabindex="0">/,
  );
  // The lead's heading took `costs`, so the first panel is `costs-2`.
  assert.match(main, /<a class="tl tl1" href="#costs-2">Costs<\/a><a class="tl tl2" href="#risks">Risks<\/a><\/nav>/);
  assert.match(
    main,
    /<section class="doc part p1" id="costs-2" aria-label="Costs" data-part="a\.lede" data-sha="aaaaaaaaaaaa">\n<header class="mast"><h2 id="costs-2--spend">Spend<\/h2><\/header>/,
  );
  assert.match(
    main,
    /<section class="doc part p2" id="risks" aria-label="Risks" data-part="b\.lede">\n<header class="mast"><h2>Risks<\/h2><\/header>/,
  );
  // The part's own link to its heading follows the heading's new id; a link to another page does not change.
  assert.match(main, /<a href="#risks--detail">below<\/a> and <a href="https:\/\/example\.com\/#x">out<\/a>/);
  // A link to an id the part does not hold is left as written, so it can open another tab.
  assert.match(main, /<a href="#costs-2">the costs<\/a>/);
  assert.match(main, /<h4 id="risks--detail">Detail<\/h4>/);
});

test("the manifest's keys style the page; a part's page-level keys do not", async () => {
  const { doc, parts } = tabbed('@title T\n@accent #0f766e\n@lang fr\n@description About.\n\ntab < a.lede\n', {
    'a.lede': '@title A\n@accent #b91c1c\n@lang de\n@description Other.\n@theme dark\n\nText.\n',
  });
  const html = await render(doc, { parts });
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /--accent:#0f766e/);
  assert.doesNotMatch(html, /#b91c1c|Other\.|lang="de"/);
});

test('the stylesheet names tabs by index only, and has one current-tab rule per tab', async () => {
  const label = 'x{}*/</style><script>alert(1)</script>';
  const { doc, parts } = tabbed(`tab ${label} < a.lede\ntab Two < b.lede\n`, { 'a.lede': 'A.', 'b.lede': 'B.' });
  const html = await render(doc, { parts });
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.doesNotMatch(style, /alert|x\{\}/);
  assert.match(style, /\.tabs:has\(\.p2:target,\.p2 :target\) \.tl2/);
  assert.doesNotMatch(style, /\.p3/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;\/style&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/a>/);
});

test('a panel of a dashboard part keeps its layout class, and the page takes the dashboard rules', async () => {
  const { doc, parts } = tabbed('tab < a.lede\ntab < b.lede\n', {
    'a.lede': '# Essay\nText.\n',
    'b.lede': '@width wide\n# Board\nkpi Up | 3\n',
  });
  const html = await render(doc, { parts });
  assert.match(html, /<section class="doc part p1" id="essay"/);
  assert.match(html, /<section class="doc part p2 dash" id="board"/);
  assert.match(html, /\.doc\.dash \.lgrid/);
});

test('an html fence in a part has its ids prefixed', async () => {
  const { doc, parts } = tabbed('tab < a.lede\n', { 'a.lede': '# A\n```=html\n<p id="note">Hi <a href="#note">me</a></p>\n```\n' });
  const html = await render(doc, { parts });
  assert.match(html, /<p id="a--note">Hi <a href="#a--note">me<\/a><\/p>/);
});

test('without its parts a tab line draws as a placeholder; --artifact keeps the same main', async () => {
  const { html } = await compile('# Page\n\ntab Costs < costs.lede\ntab < risks.lede #abcdefabcdef\n');
  assert.match(
    html,
    /<p class="tabref">Tab <strong>Costs<\/strong>: <code>costs\.lede<\/code><\/p>\n<p class="tabref">Tab: <code>risks\.lede<\/code><\/p>/,
  );
  const { doc, parts } = tabbed('# P\n\ntab < a.lede\n', { 'a.lede': 'A.' });
  const full = await render(doc, { parts });
  const art = await render(doc, { parts, artifact: true });
  const main = (h: string) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
  assert.equal(main(art), main(full));
  assert.doesNotMatch(art, /<!doctype/);
});

test('the shell is never added to a page of tabs', async () => {
  const { doc, parts } = tabbed('tab < a.lede\n', { 'a.lede': 'ask who | Who?\nexport json\n' });
  const html = await render(doc, { parts, shell: true });
  assert.doesNotMatch(html, /<script/);
});
