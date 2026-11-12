// D70 and D80: the head describes the page to whoever is handed its URL (`og:*`, `author`, `article:published_time`, `twitter:card`, a
// canonical link, and a `lede:key` tag for each `@meta` fact), and `@meta Key | value` is also a facts row under the masthead's byline.
// Head tags belong to the full page only: `--artifact` and `fragment` output have no head, and the style and main of the two pages agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { drive, normalize } from '../../../bench/src/incremental-model.ts';
import { browserTest, serve } from './chrome.ts';

const page = async (src: string) => (await compile(src)).html;
/** Everything between `<title>` and `<style>`: the description, the tags, nothing else. */
const headTags = (html: string) =>
  html
    .slice(html.indexOf('</title>') + '</title>'.length, html.indexOf('<style>'))
    .trim()
    .split('\n');

const FULL = [
  '@title Order events review',
  '@description A short review.',
  '@author Ana Ruiz, Platform',
  '@date 2026-11-10',
  '@image https://x.example/share/a/../queue.png',
  '@canonical https://x.example/reviews/order-events',
  '@meta Owner | Ana Ruiz',
  '@meta Last reviewed | 2026-11-10',
  '# Order events review',
  '',
  'Text.',
].join('\n');

test('a page with every key writes each tag, in order, after the description and before the style', async () => {
  assert.deepEqual(headTags(await page(FULL)), [
    '<meta name="description" content="A short review.">',
    '<meta property="og:title" content="Order events review">',
    '<meta property="og:type" content="article">',
    '<meta property="og:description" content="A short review.">',
    '<meta name="author" content="Ana Ruiz">',
    '<meta property="article:published_time" content="2026-11-10">',
    '<meta property="og:image" content="https://x.example/share/queue.png">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<link rel="canonical" href="https://x.example/reviews/order-events">',
    '<meta name="lede:owner" content="Ana Ruiz">',
    '<meta name="lede:last-reviewed" content="2026-11-10">',
  ]);
});

test('a bare page still says what it is: og:title, og:type, nothing else', async () => {
  assert.deepEqual(headTags(await page('# Just a title\n\nText.')), [
    '<meta property="og:title" content="Just a title">',
    '<meta property="og:type" content="article">',
  ]);
  assert.deepEqual(headTags(await page('Text only.')), [
    '<meta property="og:title" content="Untitled">',
    '<meta property="og:type" content="article">',
  ]);
});

test('og:description needs a description, published_time an ISO date, and the author is the text before the first comma', async () => {
  const tags = headTags(await page('@title T\n@author Ana Ruiz, Staff, Platform\n@date November 2026\n\nText.')).join('\n');
  assert.ok(!tags.includes('og:description') && !tags.includes('name="description"'));
  assert.ok(!tags.includes('article:published_time'));
  assert.ok(tags.includes('<meta name="author" content="Ana Ruiz">'));
});

test('an image that is not an absolute https URL writes no og:image and no twitter:card, a canonical that is not writes no link', async () => {
  for (const bad of [
    '/a.png',
    '//xss.example/a.png',
    'http://x.example/a.png',
    'data:image/png;base64,AA==',
    'javascript:alert(1)',
    'https://',
  ]) {
    const html = await page(`@title T\n@image ${bad}\n@canonical ${bad}\n\nText.`);
    assert.deepEqual(headTags(html), ['<meta property="og:title" content="T">', '<meta property="og:type" content="article">'], bad);
  }
});

test('values are escaped, and a URL is its normalised https form', async () => {
  const html = await page(
    '@title A "quoted" <b>title</b> & more\n@description "><script>alert(1)</script>\n@author <i>x</i>, "y"\n@image https://x.example/a.png?q="><script>alert(1)</script>&r=1\n@canonical https://x.example/p?a=1&b="2"\n\nText.',
  );
  const head = html.substring(0, html.indexOf('<style>'));
  assert.ok(!head.includes('<script') && !head.includes('<b>') && !head.includes('<i>'));
  assert.ok(head.includes('<meta property="og:title" content="A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more">'));
  assert.ok(
    head.includes('<meta property="og:image" content="https://x.example/a.png?q=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&amp;r=1">'),
  );
  assert.ok(head.includes('<link rel="canonical" href="https://x.example/p?a=1&amp;b=%222%22">'));
});

test('--artifact and fragment output have no head, and nothing in a build has a script', async () => {
  const doc = parse(FULL);
  for (const out of [await render(doc, { artifact: true }), await render(doc, { fragment: true })]) {
    for (const bad of ['<meta', '<link', '<head>', '<script', 'og:', 'canonical'])
      assert.ok(!out.includes(bad), `${bad} in ${out.slice(0, 40)}`);
  }
  assert.ok(!(await render(doc)).includes('<script'));
});

test("the artifact has the full page's style and main, byte for byte, and the CSP still precedes the style", async () => {
  const doc = parse(FULL);
  const full = await render(doc);
  const artifact = await render(doc, { artifact: true });
  const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b) + b.length);
  assert.equal(between(artifact, '<style>', '</style>'), between(full, '<style>', '</style>'));
  assert.equal(between(artifact, '<main', '</main>'), between(full, '<main', '</main>'));
  assert.ok(full.indexOf('Content-Security-Policy') < full.indexOf('<style>'));
  assert.ok(full.indexOf('Content-Security-Policy') < full.indexOf('og:title'));
});

// ---- the facts row ------------------------------------------------------------------------------------------------------------

test('@meta is a definition list under the byline, in order, with status chips and ISO dates as in the byline', async () => {
  const src =
    '@title T\n@author Ana\n@date 2026-11-10\n@status Parked=neutral\n@meta Owner | Ana **Ruiz**\n@meta Status | Draft\n@meta Stage | parked\n@meta Reviewed | 2026-11-10\n@meta Due | next week\n\nText.';
  const html = await page(src);
  assert.ok(
    html.includes(
      '</p><dl class="facts"><div><dt>Owner</dt><dd>Ana <strong>Ruiz</strong></dd></div><div><dt>Status</dt><dd><span class="pill warn">Draft</span></dd></div>' +
        '<div><dt>Stage</dt><dd><span class="pill neutral">parked</span></dd></div><div><dt>Reviewed</dt><dd><time datetime="2026-11-10">2026-11-10</time></dd></div>' +
        '<div><dt>Due</dt><dd>next week</dd></div></dl></header>',
    ),
  );
});

test('a page with no @meta has no facts row, and the facts row can stand without a byline or a title', async () => {
  assert.ok(!(await page('@title T\n@author A\n\nText.')).includes('<dl'));
  const only = await page('@meta Owner | Ana\n\nText.');
  assert.match(only, /<header class="mast"><dl class="facts"><div><dt>Owner<\/dt><dd>Ana<\/dd><\/div><\/dl><\/header>/);
});

test('a fact key and value are text: escaped, never markup, and the key never reaches a tag name unsafely', async () => {
  const html = await page(
    '@meta <img src=x onerror=alert(1)> | <script>alert(1)</script> "x"\n@meta "><b onclick=x>k | [a link](javascript:alert(1))\n@meta 所有者 | kept\n\nText.',
  );
  assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<b onclick'));
  assert.ok(!html.includes('href="javascript:'));
  const names = [...html.matchAll(/<meta name="lede:([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['img-src-x-onerror-alert-1', 'b-onclick-x-k']);
  assert.ok(html.includes('<dt>所有者</dt><dd>kept</dd>'), 'a key with no ASCII letter keeps its row and has no head tag');
  assert.ok(html.includes('<meta name="lede:b-onclick-x-k" content="a link">'), 'the tag holds the plain text of the value');
});

test('a repeated key writes a tag each, and a fact with an invalid field is left out', async () => {
  const doc = parse('@meta Owner | A\n@meta Owner | B\n@meta no bar\n\nText.');
  const html = await render(doc);
  assert.deepEqual(
    [...html.matchAll(/<meta name="lede:owner" content="([^"]*)"/g)].map((m) => m[1]),
    ['A', 'B'],
  );
  assert.ok(!html.includes('no bar'));
});

test('the facts row follows a heading the masthead did not take', async () => {
  const html = await page('Intro paragraph.\n\n# Later title\n\n@meta Owner | Ana\n@author Ana\n\nText.');
  assert.match(html, /<h1 id="later-title">Later title<\/h1>\n<p class="byline">.*<\/p><dl class="facts">/);
});

// ---- streaming ----------------------------------------------------------------------------------------------------------------

const wholeMain = async (src: string) => normalize(await render(parse(src), { fragment: true }));

test('streaming: @meta at the top reaches the masthead before the settle, at chunks of 1, 7 and 64 bytes', async () => {
  const src = '@title T\n@author Ana\n@status Parked=neutral\n@meta Owner | Ana\n@meta Stage | Parked\n\n# Heading\n\nText.\n';
  const expected = await wholeMain(src);
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, settle: false });
    assert.equal(normalize(d.model.main()), expected, `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
    assert.equal(d.end.lateMeta, 0);
  }
});

test('streaming: @meta written after the first block is late meta, applied to the masthead without a settle', async () => {
  const src = '@title T\n\nFirst paragraph of the page, long enough to be the standfirst of the page for this test.\n\n@meta Owner | Ana\n';
  const expected = await wholeMain(src);
  const d = await drive(src, { chunk: 5, settle: false });
  assert.equal(d.end.lateMeta, 1);
  assert.equal(normalize(d.model.main()), expected);
  assert.ok(expected.includes('<dl class="facts">'));
});

// ---- the browser --------------------------------------------------------------------------------------------------------------

browserTest(
  'the facts row holds at 360px and 1280px: no sideways scroll, every fact inside the column, in both themes',
  async (browser) => {
    const src = [
      '@title A rather long title for a page with many facts in its row',
      '@author Ana Ruiz, Platform engineering',
      '@date 2026-11-10',
      '@status Needs sign-off=warn, Beta=info, Parked=neutral',
      '@meta Owner | Ana Ruiz',
      '@meta Status | Needs sign-off',
      '@meta Stage | Beta',
      '@meta Held | Parked',
      '@meta Reviewed | 2026-11-10',
      '@meta Reviewers | Platform team, Support, Security, and a very long unbroken-name-that-has-no-spaces-in-it-at-all-and-keeps-going-' +
        'x'.repeat(60),
      '',
      'Standfirst paragraph.',
    ].join('\n');
    const html = await page(src);
    for (const width of [360, 1280]) {
      for (const scheme of ['light', 'dark'] as const) {
        const { ctx, page: p } = await serve(browser, html, { width });
        await p.emulateMedia({ colorScheme: scheme });
        const found = (await p.evaluate(`(() => {
        const doc = document.scrollingElement;
        const row = document.querySelector('dl.facts').getBoundingClientRect();
        const out = [];
        if (doc.scrollWidth > innerWidth) out.push('page scrolls sideways by ' + (doc.scrollWidth - innerWidth));
        for (const e of document.querySelectorAll('.facts dt, .facts dd')) {
          const r = e.getBoundingClientRect();
          if (r.right > row.right + 1 || r.left < row.left - 1) out.push(e.textContent.slice(0, 20) + ' leaves the row');
        }
        return out;
      })()`)) as string[];
        assert.deepEqual(found, [], `${width}px ${scheme}`);
        await ctx.close();
      }
    }
  },
);
