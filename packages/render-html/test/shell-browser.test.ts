// The shell runtime in Chromium, with the page's own policy in place (spec Req 6 to 8). Fails, not skips, when CI is set.
import assert from 'node:assert/strict';
import { fieldsOf, parse } from '@lede-lang/core';
import { compile, RUNTIME } from '../src/index.ts';
import { serializeExport, type Answer } from '../src/export.ts';
import { browserTest, type Browser } from './chrome.ts';

const SRC = [
  '@title Release 4.2 go/no-go',
  'ask constructor | Who signs off?',
  'choose toString | a, b, "c, d"',
  'confirm hasOwnProperty | The migration ran',
  'ask notes lines=3 | Notes?',
  'export json',
  'export markdown',
].join('\n');

const URL_ = 'https://lede.test/page.html';

/** Serves `html` at a stub https origin so the page keeps its policy and the Clipboard API has a secure context. */
async function open(browser: Browser, html: string, init?: string, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, javaScriptEnabled });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://lede.test' });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  if (init) await page.addInitScript(init);
  await page.route(URL_, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(URL_);
  return { ctx, page, logs };
}
const code = (page: Awaited<ReturnType<typeof open>>['page'], fmt: 'json' | 'markdown') =>
  page.locator(`figure[data-x="${fmt}"] code`).textContent();

browserTest('the pinned hash lets the runtime run; one changed byte stops it and leaves the template', async (browser) => {
  const { html } = await compile(SRC, { shell: true });
  const ran = await open(browser, html);
  assert.equal(await ran.page.locator('.q-bar').first().isVisible(), true, 'the copy bar appears');
  await ran.page.locator('input[name="constructor"]').fill('Dana');
  assert.match((await code(ran.page, 'json'))!, /"constructor": "Dana"/, 'the JSON block was read under the policy');
  await ran.ctx.close();

  const tampered = html.replace(`<script>${RUNTIME}</script>`, `<script>${RUNTIME} </script>`);
  assert.notEqual(tampered, html);
  const blocked = await open(browser, tampered);
  assert.equal(await blocked.page.locator('.q-bar').first().isVisible(), false);
  await blocked.page.locator('input[name="constructor"]').fill('Dana');
  assert.doesNotMatch((await code(blocked.page, 'json'))!, /Dana/);
  assert.ok(
    blocked.logs.some((l) => /Content Security Policy|script-src/i.test(l)),
    blocked.logs.join('\n'),
  );
  await blocked.ctx.close();
});

browserTest('the runtime adds no element and changes no attribute but hidden', async (browser) => {
  const { html } = await compile(SRC, { shell: true });
  const { ctx, page } = await open(browser, html);
  await page.evaluate(`window.__m = []; new MutationObserver((rs) => { for (const r of rs) window.__m.push({
    type: r.type, attr: r.attributeName, added: [...r.addedNodes].map((n) => n.nodeType === 1 ? 'element:' + n.nodeName : 'text'),
    in: r.target.closest ? (r.target.closest('code') ? 'code' : r.target.closest('[role=status]') ? 'status' : 'other') : (r.target.parentNode && r.target.parentNode.closest && r.target.parentNode.closest('code') ? 'code' : 'other') });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });`);
  await page.locator('input[name="constructor"]').fill('x');
  await page.locator('textarea[name="notes"]').fill('a\nb');
  await page.locator('input[name="toString"][value="b"]').check();
  await page.locator('input[name="hasOwnProperty"][value="approved"]').check();
  await page.locator('fieldset.q-choose .q-clear').click();
  await page.locator('figure[data-x="json"] .q-copy').click();
  const seen = (await page.evaluate('window.__m')) as { type: string; attr: string | null; added: string[]; in: string }[];
  assert.ok(seen.length > 0);
  for (const m of seen) {
    assert.deepEqual(
      m.added.filter((a) => a.startsWith('element')),
      [],
      'no element is added',
    );
    if (m.type === 'attributes') assert.equal(m.attr, 'hidden');
    if (m.type === 'childList' || m.type === 'characterData') assert.notEqual(m.in, 'other', JSON.stringify(m));
  }
  await ctx.close();
});

// ---------------------------------------------------------------- parity

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const PIECES = [
  'a',
  ' ',
  '  ',
  '\n',
  '\r\n',
  '\r',
  '`',
  '```',
  '"',
  '\\',
  '</script>',
  '<!--',
  '\u2028',
  '\u2029',
  '\u0085',
  '😀',
  '- x: y',
  '# h',
  '(empty)',
  '(not chosen)',
  '\t',
];
const text = (r: () => number) => Array.from({ length: Math.floor(r() * 6) }, () => PIECES[Math.floor(r() * PIECES.length)]).join('');

browserTest(
  'the runtime exports exactly what the reference serializer does, for 200 seeded states',
  async (browser) => {
    const { html, doc } = await compile(SRC, { shell: true });
    const fields = fieldsOf(doc.blocks);
    const { ctx, page } = await open(browser, html);
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const typed = {
        ask1: text(r),
        ask2: text(r),
        pick: ['', 'a', 'b', 'c, d'][Math.floor(r() * 4)],
        decide: ['', 'approved', 'rejected'][Math.floor(r() * 3)],
      };
      // Set the controls, then read back what they hold: a one-line input never keeps a line break.
      const held = (await page.evaluate(
        `((t) => {
        const q = (n) => document.querySelector('[name="' + n + '"]');
        q('constructor').value = t.ask1; q('notes').value = t.ask2;
        for (const r of document.querySelectorAll('input[type=radio]')) r.checked = false;
        if (t.pick) document.querySelector('input[name="toString"][value="' + t.pick + '"]').checked = true;
        if (t.decide) document.querySelector('input[name="hasOwnProperty"][value="' + t.decide + '"]').checked = true;
        document.querySelector('main').dispatchEvent(new Event('input', { bubbles: true }));
        return [q('constructor').value, t.pick || null, t.decide || 'open', q('notes').value];
      })(${JSON.stringify(typed)})`,
      )) as Answer[];
      for (const fmt of ['json', 'markdown'] as const)
        assert.equal(await code(page, fmt), serializeExport(fmt, 'Release 4.2 go/no-go', fields, held), `seed ${seed} ${fmt}`);
    }
    await ctx.close();
    void parse;
  },
  300_000,
);

// ---------------------------------------------------------------- copy, clear, notice, fallback

browserTest('Copy puts the current export on the clipboard and says so', async (browser) => {
  const { html } = await compile(SRC, { shell: true });
  const { ctx, page } = await open(browser, html);
  await page.locator('input[name="constructor"]').fill('Dana');
  await page.locator('figure[data-x="markdown"] .q-copy').click();
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), await code(page, 'markdown'));
  assert.equal(await page.locator('figure[data-x="markdown"] .q-st').textContent(), 'Copied');
  await page.locator('input[name="constructor"]').fill('Dana B');
  assert.equal(await page.locator('figure[data-x="markdown"] .q-st').textContent(), '', 'the message clears on the next change');
  await ctx.close();
});

for (const [name, init] of [
  ['there is no Clipboard API', "Object.defineProperty(navigator, 'clipboard', { value: undefined })"],
  [
    'writing is refused',
    "Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('no', 'NotAllowedError')) } })",
  ],
  ['writing throws', "Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => { throw new Error('no'); } } })"],
] as const)
  browserTest(`when ${name}, the export text is selected and the page says to copy by hand`, async (browser) => {
    const { html } = await compile(SRC, { shell: true });
    const { ctx, page } = await open(browser, html, init);
    await page.locator('input[name="constructor"]').fill('Dana');
    await page.locator('figure[data-x="json"] .q-copy').click();
    await page.waitForFunction(() => /blocked/.test(document.querySelector('figure[data-x="json"] .q-st')!.textContent ?? ''));
    assert.equal(await page.evaluate('getSelection().toString()'), await code(page, 'json'));
    await ctx.close();
  });

browserTest('Clear returns a choice and a decision to open; the notice is shown and the template hint is hidden', async (browser) => {
  const { html } = await compile(SRC, { shell: true });
  const { ctx, page } = await open(browser, html);
  await page.locator('input[name="toString"][value="a"]').check();
  await page.locator('input[name="hasOwnProperty"][value="rejected"]').check();
  let json = JSON.parse((await code(page, 'json'))!) as { open: string[]; answers: Record<string, unknown> };
  assert.deepEqual(json.open, []);
  assert.deepEqual([json.answers['toString'], json.answers['hasOwnProperty']], ['a', 'rejected']);
  await page.locator('fieldset.q-choose .q-clear').click();
  await page.locator('fieldset.q-confirm .q-clear').click();
  json = JSON.parse((await code(page, 'json'))!);
  assert.deepEqual(json.open, ['toString', 'hasOwnProperty']);
  assert.match((await page.locator('.q-bar').first().textContent())!, /Answers stay in this tab until you copy them\./);
  assert.equal(await page.locator('figure[data-x="json"] .q-xn').isVisible(), false);
  await ctx.close();
});

browserTest('with scripts off the page shows the fields and the blank template, and no dead button', async (browser) => {
  const { html } = await compile(SRC, { shell: true });
  const off = await open(browser, html, undefined, false);
  assert.equal(await off.page.locator('.q-bar').first().isVisible(), false);
  assert.equal(await off.page.locator('.q-clear').first().isVisible(), false);
  assert.equal(await off.page.locator('figure[data-x="json"] .q-xn').isVisible(), true);
  assert.equal(await off.page.locator('input[name="constructor"]').isVisible(), true);
  const plain = await open(browser, (await compile(SRC)).html, undefined, false);
  assert.equal(await code(off.page, 'json'), await code(plain.page, 'json'));
  await off.ctx.close();
  await plain.ctx.close();
});

browserTest('a shell page at 360 px: no sideways scroll, 44 px buttons and controls', async (browser) => {
  const { html } = await compile(SRC, { shell: true });
  const { ctx, page } = await open(browser, html);
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'), true);
  const heights = (await page.evaluate(
    `[...document.querySelectorAll('.q button, .q-copy, .q input[type=text], .q-o')].filter(e => e.getBoundingClientRect().width).map(e => Math.round(e.getBoundingClientRect().height))`,
  )) as number[];
  assert.ok(heights.length >= 8);
  assert.ok(
    heights.every((h) => h >= 44),
    heights.join(','),
  );
  await ctx.close();
});
