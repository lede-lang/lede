// The editor words live, in Chromium, with the page's own policy in place (spec §4.19, §7; internal spec, lede-lang/meta, Req 4.1 to 4.9,
// 5.4). Fails, not skips, when CI or LEDE_REQUIRE_CHROME is set. The static markup has its own checks in editors.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fieldsOf } from '@lede-lang/core';
import { compile } from '../src/index.ts';
import { serializeExport } from '../src/export.ts';
import { browserTest, serve, tamper } from './chrome.ts';
import { rng, text } from './fuzz.ts';
import { heldValues, SNAPSHOT, type Entry } from './held.ts';

const example = (name: string) => readFileSync(new URL(`../../../examples/parity/${name}.lede`, import.meta.url), 'utf8');
const EDITORS = example('editors');
const LARGE = example('editors-large');

type Tab = Awaited<ReturnType<typeof serve>>['page'];

const code = (page: Tab, fmt: string) => page.locator(`figure[data-x="${fmt}"] code`).textContent();
const val = (page: Tab, sel: string) => page.locator(sel).inputValue();

// ---------------------------------------------------------------- Req 4.1: param

browserTest('4.1 param: the range and the number box follow each other, and the export carries the number box', async (browser) => {
  const { html } = await compile(EDITORS, { shell: true });
  const { ctx, page } = await serve(browser, html);
  const range = 'input[type=range][name=press]';
  const num = 'input[type=number][name=press]';
  assert.deepEqual([await val(page, range), await val(page, num)], ['0.94', '0.94']);
  await page.locator(range).fill('0.9');
  assert.equal(await val(page, num), '0.9', 'moving the range sets the number');
  assert.match((await code(page, 'markdown'))!, /^- press: 0\.9 x$/m);
  assert.match((await code(page, 'prompt'))!, /^- press: 0\.9 x \(was 0\.94 x\)$/m);
  await page.locator(num).fill('0.97');
  assert.equal(await val(page, range), '0.97', 'typing in the number box moves the range');
  assert.match((await code(page, 'markdown'))!, /^- press: 0\.97 x$/m);
  // Out of range: the range stops at its end, and the export holds the number to MIN..MAX (the number box is still the source).
  await page.locator(num).fill('0.5');
  assert.equal(await val(page, range), '0.85');
  assert.match((await code(page, 'markdown'))!, /^- press: 0\.85 x$/m);
  assert.match((await code(page, 'prompt'))!, /^- press: 0\.85 x \(was 0\.94 x\)$/m);
  // Emptied or not a number: the export reads the value the page was written with, and the range stays where it was.
  await page.locator(num).fill('');
  assert.equal(await val(page, range), '0.85');
  assert.match((await code(page, 'markdown'))!, /^- press: 0\.94 x$/m);
  assert.match((await code(page, 'prompt'))!, /^No changes\.$/m);
  // Above the top, and off the grid: the export holds the number to MIN..MAX and snaps it to the nearest step from MIN, with the float
  // noise rounded away (0.85 + 11 * 0.01 is 0.9600000000000001).
  await page.locator(num).fill('7');
  assert.match((await code(page, 'markdown'))!, /^- press: 1 x$/m);
  await page.locator(num).fill('0.9549');
  assert.match((await code(page, 'markdown'))!, /^- press: 0\.95 x$/m);
  await page.locator(num).fill('0.9551');
  assert.match((await code(page, 'markdown'))!, /^- press: 0\.96 x$/m);
  assert.match((await code(page, 'prompt'))!, /^- press: 0\.96 x \(was 0\.94 x\)$/m);
  await ctx.close();
});

// ---------------------------------------------------------------- Req 4.2: toggle

browserTest(
  '4.2 toggle: an unmet prerequisite shows its text outside the label and aria-invalid on the checkbox, and the export lists it',
  async (browser) => {
    const src = [
      'toggle a on | Flag A',
      'toggle b | Flag B',
      'toggle c on needs=a,b | Flag C',
      'toggle d needs=a | Flag D',
      'export json',
      'export markdown',
      'export prompt',
    ].join('\n');
    const { html } = await compile(src, { shell: true });
    const { ctx, page } = await serve(browser, html);
    const st = (n: string) => page.locator(`.q-toggle:has(input[name=${n}]) .q-st`).textContent();
    const invalid = (n: string) => page.locator(`input[name=${n}]`).getAttribute('aria-invalid');
    // c is on and needs b, which is off; d is off, so its unmet need says nothing.
    assert.equal(await st('c'), 'needs b, which is off');
    assert.equal(await invalid('c'), 'true');
    assert.deepEqual([await st('a'), await st('b'), await st('d')], ['', '', '']);
    assert.deepEqual([await invalid('a'), await invalid('b'), await invalid('d')], [null, null, null]);
    assert.equal(await page.locator('label[aria-invalid]').count(), 0, 'never on the label');
    assert.equal(await page.locator('.q-toggle:has(input[name=c]) label').textContent(), 'Flag C', 'the warning is outside the label');
    assert.equal((JSON.parse((await code(page, 'json'))!) as { blocked: string[] }).blocked.join(), 'c');
    assert.match((await code(page, 'markdown'))!, /^Open: none\nBlocked: c$/m);
    assert.equal((await code(page, 'prompt'))!, 'Apply these changes:\n\nNo changes.', 'nothing differs from the page as written');
    // d turns on with a met need; then a goes off: c and d are both blocked, each naming a.
    await page.locator('input[name=d]').check();
    assert.equal(await invalid('d'), null);
    await page.locator('input[name=a]').uncheck();
    assert.equal(await st('d'), 'needs a, which is off');
    assert.equal(await st('c'), 'needs a, which is off', 'the first unmet need is named');
    assert.equal((JSON.parse((await code(page, 'json'))!) as { blocked: string[] }).blocked.join(), 'c,d');
    assert.match((await code(page, 'prompt'))!, /^Blocked: c, d$/m);
    // The need is met again: both clear.
    await page.locator('input[name=a]').check();
    await page.locator('input[name=b]').check();
    assert.deepEqual([await st('c'), await st('d')], ['', '']);
    assert.deepEqual([await invalid('c'), await invalid('d')], [null, null]);
    assert.equal((JSON.parse((await code(page, 'json'))!) as { blocked: string[] }).blocked.length, 0);
    assert.match((await code(page, 'markdown'))!, /^Blocked: none$/m);
    await ctx.close();
  },
);

// ---------------------------------------------------------------- Req 4.3: bucket

browserTest(
  '4.3 bucket: the count tiles follow the radios at once, nothing moves in the DOM, and the export groups in source order',
  async (browser) => {
    const { html } = await compile(EDITORS, { shell: true });
    const { ctx, page } = await serve(browser, html);
    const tiles = async () => page.locator('fieldset.q-bucket .q-bk .q-n').allTextContents();
    assert.deepEqual(await tiles(), ['1', '1', '1']);
    await page.evaluate(`window.__rows = [...document.querySelectorAll('.q-items > li')]; window.__rows.forEach((r, i) => (r.__i = i));
    window.__moves = []; new MutationObserver((rs) => rs.forEach((r) => { if (r.type === 'childList' && r.target.closest('.q-items')) window.__moves.push(r.target.nodeName); }))
      .observe(document.querySelector('.q-items'), { subtree: true, childList: true });`);
    await page.locator('input[name="triage:0"][value=Later]').check();
    assert.deepEqual(await tiles(), ['0', '1', '2']);
    await page.locator('input[name="triage:1"][value=Later]').check();
    assert.deepEqual(await tiles(), ['0', '0', '3']);
    await page.locator('input[name="triage:0"][value=Next]').check();
    assert.deepEqual(await tiles(), ['0', '1', '2']);
    const same = await page.evaluate(
      `[...document.querySelectorAll('.q-items > li')].every((r, i) => r === window.__rows[i] && r.__i === i) && window.__moves.length === 0`,
    );
    assert.equal(same, true, 'the same rows in the same order, and no node was added to or removed from the list');
    assert.match(
      (await code(page, 'markdown'))!,
      /^- triage:\n {2}- Now: \(none\)\n {2}- Next: ENG-2041 Fix duplicate emails\n {2}- Later: ENG-2047 Rotate the signing secret, "ENG-2052 Retry, then give up"$/m,
    );
    const prompt = (await code(page, 'prompt'))!;
    assert.match(prompt, /^- triage: "ENG-2041 Fix duplicate emails" moved to Next \(was Now\)$/m);
    assert.match(prompt, /^- triage: "ENG-2047 Rotate the signing secret" moved to Later \(was Next\)$/m);
    assert.doesNotMatch(prompt, /ENG-2052/, 'an item that stayed is not listed');
    await ctx.close();
  },
);

// ---------------------------------------------------------------- Req 4.4: template

browserTest('4.4 template: refilled in one pass on every change, braces literal, the count follows in characters', async (browser) => {
  const src = [
    'ask a | A',
    'ask b | B',
    'param p unit=ms | P | 5 0 10 1',
    'toggle t | T',
    'template tpl | Tpl',
    '```json',
    '{"name": "{a}", "other": "{b}", "p": {p}, "t": "{t}", "x": {{y}}, "z": {z}, "q": {"k": {p}}}',
    '```',
    'export markdown',
  ].join('\n');
  const { html, doc } = await compile(src, { shell: true });
  assert.ok(
    doc.diagnostics.some((d) => d.code === 'template-slot'),
    'the undeclared {z} is a warning',
  );
  const { ctx, page } = await serve(browser, html);
  const tpl = () => page.locator('figure.q-tpl code').textContent();
  const count = () => page.locator('figure.q-tpl .q-n').textContent();
  const initial = '{"name": "{a}", "other": "{b}", "p": 5 ms, "t": "off", "x": {{y}}, "z": {z}, "q": {"k": 5 ms}}';
  assert.equal(await tpl(), initial);
  assert.equal(await count(), String(Array.from(initial).length));
  // A value that holds another slot or markup is text: it is not expanded, and not read as markup.
  await page.locator('input[name=a]').fill('{b}');
  await page.locator('input[name=b]').fill('{a} </code><b>x</b> \u{1F600}');
  await page.locator('input[name=p]').first().fill('7');
  await page.locator('input[name=t]').check();
  const filled = '{"name": "{b}", "other": "{a} </code><b>x</b> \u{1F600}", "p": 7 ms, "t": "on", "x": {{y}}, "z": {z}, "q": {"k": 7 ms}}';
  assert.equal(await tpl(), filled);
  assert.equal(await count(), String(Array.from(filled).length), 'code points, so the emoji counts once');
  assert.equal(await page.locator('figure.q-tpl code b').count(), 0);
  assert.match((await code(page, 'markdown'))!, /- tpl:\n\n {2}```\n {2}\{"name": "\{b\}"/);
  // Emptied: the slot goes back to the text as written.
  await page.locator('input[name=a]').fill('');
  assert.match((await tpl())!, /^\{"name": "\{a\}", /);
  await ctx.close();
});

// ---------------------------------------------------------------- Req 4.5: preset

const PRESET_SRC = [
  'ask who | Who?',
  'choose tier | free, "pro, plus", max',
  'param speed unit=x | Speed | 1 0 2 0.5',
  'toggle fast | Fast',
  'preset boost | Boost | who="Dana; B"; tier="pro, plus"; speed=2; fast=on',
  'export markdown',
  'export prompt',
].join('\n');

browserTest(
  '4.5 preset: its button sets the text, the radio, both param controls and the checkbox, and says which preset it applied',
  async (browser) => {
    const { html } = await compile(PRESET_SRC, { shell: true });
    const { ctx, page } = await serve(browser, html);
    const button = page.locator('.q-preset > button.q-pre');
    assert.equal(await button.isVisible(), true);
    assert.equal(await button.textContent(), 'Boost');
    assert.equal(await page.locator('.q-preset > .q-pv').isVisible(), false, 'the values text is hidden once the button works');
    await button.click();
    assert.equal(await val(page, 'input[name=who]'), 'Dana; B');
    assert.equal(await page.locator('input[name=tier]:checked').getAttribute('value'), 'pro, plus');
    assert.deepEqual([await val(page, 'input[type=range][name=speed]'), await val(page, 'input[type=number][name=speed]')], ['2', '2']);
    assert.equal(await page.locator('input[name=fast]').isChecked(), true);
    assert.equal(await page.locator('figure[data-x] .q-st').first().textContent(), 'Applied Boost');
    const md = (await code(page, 'markdown'))!;
    assert.match(md, /^- who: Dana; B$/m);
    assert.match(md, /^- tier: pro, plus$/m);
    assert.match(md, /^- speed: 2 x$/m);
    assert.match(md, /^- fast: on$/m);
    assert.match(
      (await code(page, 'prompt'))!,
      /^- who: Dana; B \(was empty\)\n- tier: pro, plus \(was not chosen\)\n- speed: 2 x \(was 1 x\)\n- fast: on \(was off\)$/m,
    );
    // The next change clears the line, as it clears "Copied".
    await page.locator('input[name=who]').fill('Dana');
    assert.equal(await page.locator('figure[data-x] .q-st').first().textContent(), '');
    await ctx.close();
  },
);

browserTest('4.5 with scripts blocked a preset is its values as text and no button', async (browser) => {
  const { html } = await compile(PRESET_SRC, { shell: true });
  const { ctx, page } = await serve(browser, tamper(html));
  assert.equal(await page.locator('.q-preset > button.q-pre').isVisible(), false);
  assert.equal(await page.locator('.q-preset > .q-pv').isVisible(), true);
  assert.match((await page.locator('.q-preset > .q-pv').textContent())!, /^Boost: who Dana; B, tier pro, plus, speed 2 x, fast on$/);
  await ctx.close();
});

// ---------------------------------------------------------------- Req 4.6: what the runtime writes

browserTest(
  '4.6 a driven session adds no element, writes no attribute but hidden and aria-invalid, and writes text only in its places',
  async (browser) => {
    const { html } = await compile(EDITORS, { shell: true });
    const { ctx, page } = await serve(browser, html);
    await page.evaluate(`window.__m = []; new MutationObserver((rs) => { for (const r of rs) window.__m.push({
    type: r.type, attr: r.attributeName, added: [...r.addedNodes, ...r.removedNodes].map((n) => n.nodeType === 1 ? 'element:' + n.nodeName : 'text'),
    in: (r.target.nodeType === 1 ? r.target : r.target.parentNode).closest('code') ? 'code' : (r.target.nodeType === 1 ? r.target : r.target.parentNode).closest('[role=status]') ? 'status'
      : (r.target.nodeType === 1 ? r.target : r.target.parentNode).closest('.q-n') ? 'count' : 'other' });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });`);
    await page.locator('input[name=owner]').fill('Dana');
    await page.locator('input[type=range][name=press]').fill('0.9');
    await page.locator('input[type=number][name=press]').fill('0.97');
    await page.locator('input[name=checkout_v2]').uncheck();
    await page.locator('input[name=express]').check();
    await page.locator('input[name=checkout_v2]').check();
    await page.locator('input[name="triage:0"][value=Later]').check();
    await page.locator('.q-preset > button.q-pre').click();
    const seen = (await page.evaluate('window.__m')) as { type: string; attr: string | null; added: string[]; in: string }[];
    assert.ok(seen.length > 20);
    for (const m of seen) {
      assert.deepEqual(
        m.added.filter((a) => a.startsWith('element')),
        [],
        'no element is added or removed',
      );
      if (m.type === 'attributes') assert.ok(m.attr === 'hidden' || m.attr === 'aria-invalid', `attribute ${m.attr}`);
      else assert.notEqual(m.in, 'other', JSON.stringify(m));
    }
    assert.ok(
      seen.some((m) => m.attr === 'aria-invalid'),
      'aria-invalid was written',
    );
    assert.ok(
      seen.some((m) => m.in === 'count'),
      'a count was written',
    );
    await ctx.close();
  },
);

// ---------------------------------------------------------------- Req 5.4: parity

const POOL = [
  'plain',
  'a, b',
  'x; y',
  'say "hi"',
  '(none)',
  '- x: y',
  'k: v (was z)',
  '`tick`',
  'pipe | bar',
  '\u{1F600} emoji',
  'ENG-1: "q", with; all',
  '(empty)',
];
const FORMATS = ['json', 'markdown', 'prompt'] as const;
const quote = (t: string) => `"${t.replaceAll('"', '""')}"`;
const PARITY_SRC = [
  '@title Checkout: "play" | then <b>purple</b>',
  'ask a | A',
  'ask b lines=3 | B',
  'choose c | one, "two, three", (empty), four | C',
  'confirm d | D',
  'param p unit=ms | P | 50 0 100 5',
  'param q | Q | 0.5 0 1 0.25',
  'toggle t1 on | T1',
  'toggle t2 needs=t1 | T2',
  'toggle t3 on needs=t1,t2 | T3',
  'bucket s1 | Now, Next, Cut',
  ...POOL.slice(0, 7).map((t, k) => `s1: ${quote(t)} | ${['Now', 'Next', 'Cut'][k % 3]}`),
  'bucket s2 | A, "B, b"',
  ...POOL.slice(7).map((t, k) => `s2: ${quote(t)} | ${['A', 'B, b'][k % 2]}`),
  'template tpl | Tpl',
  '```text',
  'a={a} b={b} c={c} p={p} q={q} t1={t1} t2={t2} t3={t3} {{a}} {"k": {a}} {d}',
  '```',
  'preset one | One | a=x; c=four; p=75; t2=on',
  'export json',
  'export markdown',
  'export prompt',
].join('\n');

browserTest(
  '5.4 the runtime writes what the reference serializer writes, in all three formats, for 300 seeded states',
  async (browser) => {
    const { html, doc } = await compile(PARITY_SRC, { shell: true });
    assert.deepEqual(
      doc.diagnostics.filter((d) => d.severity === 'error'),
      [],
    );
    const blocks = fieldsOf(doc.blocks);
    const { ctx, page } = await serve(browser, html);
    const block = JSON.parse((await page.locator('script#lede-shell').textContent())!) as { page: string };
    assert.equal(block.page, 'Checkout: "play" | then <b>purple</b>');
    // The controls and the three code blocks in one round trip, so they are read from the same state.
    const READ = `({ entries: ${SNAPSHOT}, codes: ${JSON.stringify(FORMATS)}.map((f) => document.querySelector('figure[data-x=' + f + '] code').textContent) })`;
    const compare = async (label: string) => {
      const read = (await page.evaluate(READ)) as { entries: Entry[]; codes: string[] };
      const held = heldValues(blocks, read.entries);
      FORMATS.forEach((fmt, k) => assert.equal(read.codes[k], serializeExport(fmt, block.page, blocks, held), `${label} ${fmt}`));
    };
    await compare('initial state');
    // In range, off the grid, below, above, on a tie and on float noise, for p (0 to 100 by 5) and q (0 to 1 by 0.25).
    const numbers = [
      '',
      '0',
      '12.5',
      '-3',
      'abc',
      '1e2',
      '100',
      '35',
      '0.25',
      '7',
      '-0',
      '1e21',
      '0.3',
      '0.9',
      '-0.1',
      '2.5',
      '99.99',
      '47.5',
      '52.5',
      '0.125',
      '0.875',
      '1.0000001',
      '-1e-9',
      '0.6249999',
      '120',
    ];
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const plan = {
        ask: [text(r), text(r)],
        pick: Math.floor(r() * 5),
        decide: Math.floor(r() * 3),
        nums: [numbers[Math.floor(r() * numbers.length)], numbers[Math.floor(r() * numbers.length)]],
        on: [r() < 0.5, r() < 0.5, r() < 0.5],
        items: Array.from({ length: 12 }, () => Math.floor(r() * 3)),
      };
      await page.evaluate(
        `((p) => {
        const main = document.querySelector('main');
        const q = (s) => [...main.querySelectorAll(s)];
        q('[name=a]')[0].value = p.ask[0]; q('[name=b]')[0].value = p.ask[1];
        const radios = (n) => q('input[type=radio][name="' + n + '"]');
        radios('c').forEach((x, i) => (x.checked = i === p.pick - 1));
        radios('d').forEach((x, i) => (x.checked = i === p.decide - 1));
        q('input[type=number][name=p]')[0].value = p.nums[0]; q('input[type=number][name=q]')[0].value = p.nums[1];
        ['t1', 't2', 't3'].forEach((n, i) => (q('input[name=' + n + ']')[0].checked = p.on[i]));
        for (const [i, k] of p.items.entries()) {
          const name = (i < 7 ? 's1:' + i : 's2:' + (i - 7));
          radios(name).forEach((x, j) => (x.checked = j === k % radios(name).length));
        }
        main.dispatchEvent(new Event('input', { bubbles: true }));
      })(${JSON.stringify(plan)})`,
      );
      await compare(`seed ${seed}`);
    }
    // The preset button, then the three formats once more.
    await page.locator('.q-preset > button.q-pre').click();
    await compare('after the preset');
    await ctx.close();
  },
  300_000,
);

// ---------------------------------------------------------------- Req 4.8: activation moves nothing

/** The box of every `.q` block and control, in document order. Runs in the page. */
const BOXES = `[...document.querySelectorAll('.q, .q input, .q textarea, .q button, .q-seg label, .q-bk li, .q-il, .q-toggle > label, .q-nd, .q-st, .q-pv, .q-tpl pre, .q-cnt, .q-pr, .q-u')]
  .map((e) => { const r = e.getBoundingClientRect(); return [e.tagName.toLowerCase() + '.' + e.className, e.name || '', r.x, r.y, r.width, r.height]; })`;
type Box = [string, string, number, number, number, number];

/** A page whose proposal already breaks a rule, so the runtime writes a warning at activation. */
const BLOCKED_SRC = [
  'toggle new_checkout_flow | Serve the new checkout',
  'toggle saved_cards_on_the_express_path on needs=new_checkout_flow | Saved cards on the express path',
  'toggle plain on | A flag with no prerequisite',
  'export markdown',
].join('\n');

for (const [name, src] of [
  ['examples/parity/editors.lede', EDITORS],
  ['a page that starts with a blocked toggle', BLOCKED_SRC],
] as const)
  for (const width of [1280, 360])
    browserTest(`4.8 activation changes no geometry, ${name} at ${width} px`, async (browser) => {
      const { html } = await compile(src, { shell: true });
      const off = await serve(browser, tamper(html), { width });
      const on = await serve(browser, html, { width });
      // Without these the comparison could pass because nothing was activated.
      assert.equal(await off.page.locator('.q-bar').first().isVisible(), false, 'the blocked page shows no copy bar');
      assert.equal(await on.page.locator('.q-bar').first().isVisible(), true, 'the live page ran its runtime');
      const before = (await off.page.evaluate(BOXES)) as Box[];
      const after = (await on.page.evaluate(BOXES)) as Box[];
      assert.deepEqual(
        after.map((b) => b[0]),
        before.map((b) => b[0]),
        'the same elements in the same order',
      );
      const moved = before.flatMap((b, i) => {
        if (b[4] === 0 && b[5] === 0) return []; // hidden by the page until the runtime reveals it
        const a = after[i];
        return [2, 3, 4, 5].some((k) => Math.abs((a[k] as number) - (b[k] as number)) > 1)
          ? [
              `${b[0]} ${b[1]}: ${b
                .slice(2)
                .map((x) => Math.round(Number(x)))
                .join(',')} became ${a
                .slice(2)
                .map((x) => Math.round(Number(x)))
                .join(',')}`,
            ]
          : [];
      });
      assert.deepEqual(moved, []);
      const tags = (p: Tab) => p.evaluate(`[...document.querySelectorAll('main *')].map((e) => e.tagName + '.' + e.className)`);
      assert.deepEqual(await tags(on.page), await tags(off.page), 'activation adds, removes and moves no element');
      assert.equal(await code(on.page, 'markdown'), await code(off.page, 'markdown'), 'the live export at load is the static export');
      await off.ctx.close();
      await on.ctx.close();
    });

// ---------------------------------------------------------------- Req 4.9: the first interaction

browserTest('4.9 on the large page a change is handled in under 50 ms (16 ms is the aim)', async (browser) => {
  const { html, doc } = await compile(LARGE, { shell: true });
  assert.deepEqual(doc.diagnostics, []);
  const kinds = fieldsOf(doc.blocks).map((f) => f.type);
  assert.deepEqual(
    [kinds.filter((k) => k === 'param').length, kinds.filter((k) => k === 'toggle').length, kinds.filter((k) => k === 'template').length],
    [8, 3, 1],
  );
  assert.equal(fieldsOf(doc.blocks).flatMap((f) => (f.type === 'bucket' ? f.items : [])).length, 30);
  const { ctx, page } = await serve(browser, html);
  assert.equal(await page.locator('figure[data-x]').count(), 3);
  assert.equal(await page.locator('.q-bar').first().isVisible(), true, 'the runtime ran');
  // The capture listener on the window runs before the runtime's on <main>, the bubble listener on the document after it.
  await page.evaluate(`window.__t = []; window.__l = []; let t0 = 0;
    addEventListener('input', () => { t0 = performance.now(); }, true);
    document.addEventListener('input', () => { const t1 = performance.now(); document.body.getBoundingClientRect(); window.__t.push(t1 - t0); window.__l.push(performance.now() - t0); });`);
  for (let round = 0; round < 3; round++) {
    for (const n of ['canary', 'ramp', 'timeout', 'retries', 'burst', 'cache', 'soak', 'budget'])
      await page.locator(`input[type=number][name=${n}]`).fill(String(round + 1));
    await page.locator('input[name=owner]').fill(`Dana ${round}`);
    await page.locator('input[name=checkout_v2]').click();
    for (const k of [round, 7 + round, 15 + round, 29 - round])
      await page.locator(`input[name="triage:${k}"][value=${['Cut', 'Later', 'Next'][round]}]`).check();
  }
  const handler = (await page.evaluate('window.__t')) as number[];
  const laidOut = (await page.evaluate('window.__l')) as number[];
  assert.ok(handler.length >= 40, `${handler.length} input events were timed`);
  const med = (a: number[]) => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(
    `4.9 ${handler.length} changes: handler median ${med(handler).toFixed(2)} ms, max ${Math.max(...handler).toFixed(2)} ms; with layout median ${med(laidOut).toFixed(2)} ms, max ${Math.max(...laidOut).toFixed(2)} ms`,
  );
  assert.ok(Math.max(...handler) < 50, `slowest handler ${Math.max(...handler)} ms`);
  assert.ok((await page.locator('figure[data-x] code').first().textContent())?.includes('Dana 2'), 'the handlers wrote the exports');
  assert.ok(Math.max(...laidOut) < 50, `slowest handler plus layout ${Math.max(...laidOut)} ms`);
  await ctx.close();
});

// ---------------------------------------------------------------- the data block is checked

browserTest('a data block the runtime cannot trust leaves the page as the ordinary build draws it', async (browser) => {
  const { html } = await compile(EDITORS, { shell: true });
  const bar = (p: Tab) => p.locator('.q-bar').first().isVisible();
  const data = /<script type="application\/json" id="lede-shell">([\s\S]*?)<\/script>/.exec(html)![1];
  const good = JSON.parse(data) as { v: number; fields: { k: string; t?: unknown; i?: unknown; s?: unknown }[] };
  const ok = await serve(browser, html);
  assert.equal(await bar(ok.page), true);
  await ok.ctx.close();
  const bad: [string, (b: typeof good) => void][] = [
    ['version 1', (b) => (b.v = 1)],
    ['an unknown kind', (b) => (b.fields[0].k = 'select')],
    ['a bucket whose items and values differ in length', (b) => (b.fields.find((f) => f.k === 'bucket')!.i = ['Now'])],
    ['a bucket whose items are not an array', (b) => (b.fields.find((f) => f.k === 'bucket')!.t = 'x')],
    ['a template whose slots are not an array', (b) => (b.fields.find((f) => f.k === 'template')!.s = 3)],
  ];
  for (const [what, mutate] of bad) {
    const copy = JSON.parse(data) as typeof good;
    mutate(copy);
    const { ctx, page } = await serve(
      browser,
      html.replace(data, () => JSON.stringify(copy)),
    );
    assert.equal(await bar(page), false, what);
    const before = await code(page, 'markdown');
    await page.locator('input[name=owner]').fill('Dana');
    assert.equal(await code(page, 'markdown'), before, `${what}: typing changes nothing`);
    await ctx.close();
  }
});
