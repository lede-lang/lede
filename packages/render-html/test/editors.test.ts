// The editor words in the page and in the export (spec §4.19, D65): markup, the three export formats and their readers.
// Requirement numbers are those of the internal spec (lede-lang/meta). Every check here is red until the renderer draws the words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsOf, LedeStream, parse, type ExportFormat, type QuestionBlock } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { blankAnswers, cleanText, serializeExport } from '../src/export.ts';
import { rng, text } from './fuzz.ts';

/**
 * One value per field, parallel to `fieldsOf`: `ask` text, `choose` option or null, `confirm` word, `param` number, `toggle` `on`
 * or `off`, `bucket` the bucket name of each item in order, `template` ignored (null).
 */
type Value = string | number | string[] | null;
const serialize = serializeExport as (format: ExportFormat, page: string | undefined, fields: QuestionBlock[], values?: Value[]) => string;
const initial = blankAnswers as (fields: QuestionBlock[]) => Value[];
const fieldsFor = (src: string): QuestionBlock[] => fieldsOf(parse(src).blocks);

const SRC = [
  '@title Checkout button: play, then purple',
  'ask owner | Who signs off?',
  'param press unit=x | Press depth | 0.94 0.85 1 0.01',
  'toggle checkout_v2 on | New checkout',
  'toggle express needs=checkout_v2 | Express checkout',
  'choose easing | ease-out, spring, linear | Easing',
  'confirm ship | Ship it',
  'bucket triage | Now, Next, Cut | Where does each ticket go?',
  'triage: ENG-2041 Fix duplicate emails | Now',
  'triage: ENG-2047 Rotate the signing secret | Next',
  'triage: "ENG-2092 Replace moment.js, date-fns" | Next',
  'template css | Stylesheet',
  '```css',
  '.btn { transform: scale({press}); } /* {owner} {easing} */',
  '```',
  'preset snappy | Snappy | press=0.96; easing=ease-out',
  'export json',
  'export markdown',
  'export prompt',
].join('\n');
const TITLE = 'Checkout button: play, then purple';
const F = fieldsFor(SRC);

/** owner, press, checkout_v2, express, easing, ship, triage, css */
const CHANGED: Value[] = ['Dana', 0.96, 'off', 'on', 'spring', 'approved', ['Now', 'Cut', 'Next'], null];
const PRESS_ONLY: Value[] = ['', 0.96, 'on', 'off', null, 'open', ['Now', 'Next', 'Next'], null];

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const exportCode = (html: string, fmt: string) =>
  unescape(new RegExp(`<figure class="q-x" data-x="${fmt}">[\\s\\S]*?<code>([\\s\\S]*?)</code>`).exec(html)![1]);
const codePoints = (s: string) => Array.from(s).length;

// ---------------------------------------------------------------- Req 3.1: the markup

test('3.1 param draws a labelled range and a number box that share a name, bounds and value, then the unit', async () => {
  const { html, doc } = await compile(SRC);
  assert.deepEqual(doc.diagnostics, []);
  assert.ok(
    html.includes(
      '<label class="q q-param"><span class="q-t">Press depth</span><span class="q-pr">' +
        '<input type="range" name="press" min="0.85" max="1" step="0.01" value="0.94" autocomplete="off">' +
        '<input type="number" name="press" min="0.85" max="1" step="0.01" value="0.94" autocomplete="off" aria-label="Press depth, value">' +
        '<span class="q-u">x</span></span></label>',
    ),
  );
  // No unit, no unit span; a label with markup keeps its text in the accessible name.
  const bare = (await compile('param n | The **bold** one | 5 0 10 1')).html;
  assert.ok(bare.includes('<span class="q-pr"><input type="range" name="n"'));
  assert.equal(bare.includes('q-u'), false);
  assert.ok(bare.includes('aria-label="The bold one, value"'));
  assert.ok(bare.includes('<span class="q-t">The <strong>bold</strong> one</span>'));
});

test('3.1 toggle draws a checkbox, checked when on, with its needs and its status outside the label', async () => {
  const { html } = await compile(SRC);
  assert.ok(
    html.includes(
      '<div class="q q-toggle"><label><input type="checkbox" name="checkout_v2" value="on" autocomplete="off" checked>' +
        '<span class="q-t">New checkout</span></label><span class="q-st" role="status"></span></div>',
    ),
  );
  assert.ok(
    html.includes(
      '<div class="q q-toggle"><label><input type="checkbox" name="express" value="on" autocomplete="off">' +
        '<span class="q-t">Express checkout</span></label><span class="q-nd">Needs checkout_v2</span><span class="q-st" role="status"></span></div>',
    ),
  );
  assert.ok((await compile('toggle a | A\ntoggle b | B\ntoggle c needs=a,b | C')).html.includes('<span class="q-nd">Needs a, b</span>'));
  assert.equal(html.includes('aria-invalid'), false, 'only the runtime sets it');
});

test('3.1 bucket draws a count tile per bucket and an ordered list of items, each with a radio group, the written one checked', async () => {
  const { html } = await compile(SRC);
  assert.ok(html.includes('<fieldset class="q q-bucket"><legend class="q-t">Where does each ticket go?</legend>'));
  assert.ok(
    html.includes(
      '<ul class="q-bk"><li><span class="q-n">1</span> Now</li><li><span class="q-n">2</span> Next</li><li><span class="q-n">0</span> Cut</li></ul>',
    ),
  );
  const radios = (i: number, on: string) =>
    ['Now', 'Next', 'Cut']
      .map(
        (b) =>
          `<label><input type="radio" name="triage:${i}" value="${b}" autocomplete="off"${b === on ? ' checked' : ''}><span>${b}</span></label>`,
      )
      .join('');
  assert.ok(
    html.includes(
      '<ol class="q-items">' +
        `<li class="q-item"><span class="q-il">ENG-2041 Fix duplicate emails</span><span class="q-seg">${radios(0, 'Now')}</span></li>` +
        `<li class="q-item"><span class="q-il">ENG-2047 Rotate the signing secret</span><span class="q-seg">${radios(1, 'Next')}</span></li>` +
        `<li class="q-item"><span class="q-il">ENG-2092 Replace moment.js, date-fns</span><span class="q-seg">${radios(2, 'Next')}</span></li>` +
        '</ol></fieldset>',
    ),
  );
  // Without a QUESTION the legend is the set's name; a set with no item has tiles and no list.
  const bare = (await compile('bucket b | A, B')).html;
  assert.ok(bare.includes('<legend class="q-t">b</legend><ul class="q-bk"><li><span class="q-n">0</span> A</li>'));
  assert.equal(bare.includes('q-items'), false);
});

test('3.1 template draws the filled body in a named pre with a character count; preset draws its values as text', async () => {
  const { html } = await compile(SRC);
  const filled = '.btn { transform: scale(0.94 x); } /* {owner} {easing} */';
  assert.ok(
    html.includes(
      '<figure class="q q-tpl"><figcaption class="q-t">Stylesheet</figcaption>' +
        `<pre class="code" tabindex="0" role="region" aria-label="Stylesheet"><code>${filled}</code></pre>` +
        `<p class="q-cnt"><span class="q-n">${codePoints(filled)}</span> characters</p></figure>`,
    ),
  );
  assert.ok(html.includes('<div class="q q-preset"><span class="q-pv">Snappy: press 0.96 x, easing ease-out</span></div>'));
  // The count is of characters, not UTF-16 units.
  const emoji = (await compile('ask a | A\ntemplate t | T\n```\n😀{a}\n```')).html;
  assert.ok(emoji.includes('<span class="q-n">4</span> characters'), 'U+1F600, then the slot as written');
});

test('3.1 the new words draw inside cards and grid, and the page keeps one export of all of them', async () => {
  const { html, doc } = await compile(
    [
      'cards',
      '### One',
      'param a | A | 1 0 2 1',
      'toggle b | B',
      '### Two',
      'bucket c | X, Y',
      'c: i | X',
      '---',
      'grid 1',
      'toggle d | D',
      'export json',
    ].join('\n'),
  );
  assert.deepEqual(doc.diagnostics, []);
  for (const n of ['a', 'b', 'c:0', 'd']) assert.ok(html.includes(`name="${n}"`), n);
  const answers = (JSON.parse(exportCode(html, 'json')) as { answers: Record<string, unknown> }).answers;
  assert.deepEqual(Object.keys(answers), ['a', 'b', 'c', 'd']);
});

// ---------------------------------------------------------------- Req 3.1, 3.3: the attribute table, element by element

const ANY: Record<string, string[]> = {
  header: ['class'],
  h1: [],
  main: ['class'],
  label: ['class'],
  span: ['class', 'role'],
  div: ['class', 'hidden'],
  fieldset: ['class'],
  legend: ['class'],
  ul: ['class'],
  ol: ['class'],
  li: ['class'],
  figure: ['class', 'data-x'],
  figcaption: ['class'],
  p: ['class'],
  pre: ['class', 'tabindex', 'role', 'aria-label'],
  code: [],
  textarea: ['name', 'rows', 'autocomplete'],
  button: ['type', 'class', 'hidden'],
  strong: [],
  em: [],
};
const INPUT: Record<string, string[]> = {
  text: ['type', 'name', 'autocomplete'],
  radio: ['type', 'name', 'value', 'autocomplete', 'checked'],
  checkbox: ['type', 'name', 'value', 'autocomplete', 'checked'],
  range: ['type', 'name', 'min', 'max', 'step', 'value', 'autocomplete'],
  number: ['type', 'name', 'min', 'max', 'step', 'value', 'autocomplete', 'aria-label'],
};
const TAG = /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z][a-z-]*(?:="[^"]*")?)*)\s*>/g;
const mainOf = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![0];
/** Every start tag in `<main>` with its attributes, and whether anything that is not a well-formed tag still holds a `<` or `>`. */
function scan(html: string) {
  const body = mainOf(html);
  const tags = [...body.matchAll(TAG)]
    .filter((m) => !m[1])
    .map((m) => ({
      name: m[2],
      attrs: new Map([...m[3].matchAll(/\s+([a-z][a-z-]*)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2]] as const)),
    }));
  return { tags, stray: /[<>]/.test(body.replace(TAG, '')) };
}

for (const shell of [false, true])
  test(`3.1 every element of a page with all nine words is on the attribute table${shell ? ' in shell mode' : ''}`, async () => {
    const src = [SRC, 'ask notes lines=3 | Notes', 'confirm ok | Ok'].join('\n');
    const { tags, stray } = scan((await compile(src, { shell })).html);
    assert.equal(stray, false, 'nothing but well-formed tags carries a < or >');
    for (const t of tags) {
      const allowed = t.name === 'input' ? INPUT[t.attrs.get('type') ?? ''] : ANY[t.name];
      assert.ok(allowed, `<${t.name} type=${t.attrs.get('type')}> is not allowed`);
      for (const a of t.attrs.keys()) assert.ok(allowed.includes(a), `<${t.name}> may not carry ${a}`);
      assert.equal(/^(select|output|form|datalist|script)$/.test(t.name), false);
    }
    assert.ok(tags.some((t) => t.attrs.get('type') === 'range') && tags.some((t) => t.attrs.get('type') === 'number'));
    assert.ok(tags.some((t) => t.attrs.get('type') === 'checkbox'));
    for (const a of ['id', 'style', 'list', 'onclick', 'formaction'])
      assert.equal(
        tags.some((t) => t.attrs.has(a)),
        false,
        a,
      );
  });

test('3.1 in ordinary mode there is no button; with the shell the only new one is a hidden .q-pre per preset', async () => {
  const ordinary = (await compile(SRC)).html;
  assert.equal(/<(button|select|output|form)\b/.test(ordinary), false);
  assert.equal(ordinary.includes('q-pre'), false);
  assert.equal(ordinary.includes('<script'), false);
  const shell = (await compile(SRC, { shell: true })).html;
  assert.equal(shell.match(/<button type="button" class="q-pre" hidden>Snappy<\/button>/g)?.length, 1);
  assert.ok(shell.includes('<div class="q q-preset"><button type="button" class="q-pre" hidden>Snappy</button><span class="q-pv">'));
  const classes = [...shell.matchAll(/<button\b[^>]*\bclass="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(classes)].toSorted(), ['q-clear', 'q-copy', 'q-pre']);
  assert.ok(!shell.slice(0, shell.indexOf('<main')).includes('q-pre'));
});

test('3.1 the control CSS for the editor words is added only to a page that has one', async () => {
  const sheet = (h: string) => /<style>([\s\S]*?)<\/style>/.exec(h)![1];
  const wave1 = sheet((await compile('ask a | q\nchoose b | x, y\nconfirm c | z\nexport json')).html);
  assert.ok(wave1.includes('question words'));
  assert.equal(wave1.includes('editor words'), false);
  assert.equal(wave1.includes('.q-param'), false);
  for (const src of [
    'param a | A | 1 0 2 1',
    'toggle a | A',
    'bucket a | X, Y',
    'ask a | A\ntemplate t | T\n```\n{a}\n```',
    'ask a | A\npreset p | P | a=x',
  ]) {
    const css = sheet((await compile(src)).html);
    assert.ok(css.includes('question words') && css.includes('editor words'), src);
    assert.ok(css.includes('.q-toggle:has([aria-invalid=true]) .q-st'), src);
    assert.ok(css.includes('prefers-reduced-motion'), src);
  }
});

test('3.1 text from the source is escaped everywhere the new words draw it', async () => {
  const src = [
    '@title </title><script>alert(0)</script>',
    'param p unit="<img src=x onerror=alert(1)>" | <b onmouseover=x>L</b> **bold** | 5 0 10 1',
    'param q unit="a""b<i>" | Q | 5 0 10 1',
    'toggle t on | <script>alert(2)</script> label',
    'bucket k | "Now</legend>", "<svg onload=x>" | <iframe src=x> question',
    'k: <script>alert(3)</script> | Now</legend>',
    'k: "a"" onfocus=""x" | <svg onload=x>',
    'template tpl | <style>*{}</style>',
    '```html',
    '</code><script>alert(4)</script> {p} {q} {t}',
    '```',
    'preset z | <svg onload=x> | p=7; t=off',
    'export json',
    'export markdown',
    'export prompt',
  ].join('\n');
  for (const shell of [false, true]) {
    const { html, doc } = await compile(src, { shell });
    assert.deepEqual(
      doc.diagnostics.filter((d) => d.severity === 'error'),
      [],
    );
    const { tags, stray } = scan(html);
    assert.equal(stray, false);
    assert.equal(
      tags.some((t) => /^(script|img|svg|iframe|style|b|i)$/.test(t.name)),
      false,
    );
    assert.equal(
      tags.some((t) => [...t.attrs.keys()].some((a) => /^on|^style$|^src$|^href$/.test(a))),
      false,
    );
    assert.equal(html.match(/<script\b/g)?.length ?? 0, shell ? 2 : 0);
    assert.ok(
      html.includes('&lt;/code&gt;&lt;script&gt;alert(4)&lt;/script&gt; 5 &lt;img src=x onerror=alert(1)&gt; 5 a&quot;b&lt;i&gt; on'),
    );
  }
});

// ---------------------------------------------------------------- Req 3.2, 5.1 to 5.3: the three formats

test('3.2 the export block of an ordinary page is the export of the page as written, in every format', async () => {
  const { html } = await compile(SRC);
  for (const fmt of ['json', 'markdown', 'prompt'] as const) {
    assert.equal(exportCode(html, fmt), serialize(fmt, TITLE, F, initial(F)), fmt);
    assert.ok(html.includes(`<figure class="q-x" data-x="${fmt}">`), fmt);
  }
  assert.equal(exportCode(html, 'prompt'), `Apply these changes to ${TITLE}:\n\nNo changes.`);
  // The Markdown template of a page that has the new words is the page as written, including the filled template.
  assert.equal(exportCode(html, 'markdown'), serialize('markdown', TITLE, F, initial(F)));
});

test('5.1 JSON: param a number, toggle on or off, bucket an object from bucket to item texts, template the filled text, blocked', () => {
  const blank = JSON.parse(serialize('json', TITLE, F, initial(F))) as Record<string, unknown>;
  assert.deepEqual(Object.keys(blank), ['page', 'open', 'blocked', 'answers']);
  assert.deepEqual(blank, {
    page: TITLE,
    open: ['easing', 'ship'],
    blocked: [],
    answers: {
      owner: '',
      press: 0.94,
      checkout_v2: 'on',
      express: 'off',
      easing: null,
      ship: 'open',
      triage: {
        Now: ['ENG-2041 Fix duplicate emails'],
        Next: ['ENG-2047 Rotate the signing secret', 'ENG-2092 Replace moment.js, date-fns'],
        Cut: [],
      },
      css: '.btn { transform: scale(0.94 x); } /* {owner} {easing} */',
    },
  });
  assert.deepEqual(Object.keys(blank.answers as object), ['owner', 'press', 'checkout_v2', 'express', 'easing', 'ship', 'triage', 'css']);
  assert.deepEqual(Object.keys((blank.answers as { triage: object }).triage), ['Now', 'Next', 'Cut']);
  const changed = JSON.parse(serialize('json', TITLE, F, CHANGED)) as {
    open: string[];
    blocked: string[];
    answers: Record<string, unknown>;
  };
  assert.deepEqual(changed.open, []);
  assert.deepEqual(changed.blocked, ['express'], 'express is on and checkout_v2, which it needs, is off');
  assert.deepEqual(changed.answers, {
    owner: 'Dana',
    press: 0.96,
    checkout_v2: 'off',
    express: 'on',
    easing: 'spring',
    ship: 'approved',
    triage: {
      Now: ['ENG-2041 Fix duplicate emails'],
      Next: ['ENG-2092 Replace moment.js, date-fns'],
      Cut: ['ENG-2047 Rotate the signing secret'],
    },
    css: '.btn { transform: scale(0.96 x); } /* Dana spring */',
  });
});

test('5.1 JSON: blocked is present only on a page that has a toggle, and what wave 1 wrote does not change', () => {
  const none = fieldsFor('ask a | A\nchoose b | x, y\nconfirm c | C\nexport json');
  const out = JSON.parse(serialize('json', 'P', none, ['t', null, 'open'])) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out), ['page', 'open', 'answers']);
  assert.deepEqual(out, { page: 'P', open: ['b', 'c'], answers: { a: 't', b: null, c: 'open' } });
  const t = fieldsFor('toggle a | A');
  assert.deepEqual(JSON.parse(serialize('json', undefined, t, ['on'])), { open: [], blocked: [], answers: { a: 'on' } });
});

test('5.2 Markdown: Blocked follows Open, then an item per kind; a bucket is a list per bucket and a template a fenced block', () => {
  assert.equal(
    serialize('markdown', TITLE, F, initial(F)),
    [
      `# ${TITLE}`,
      '',
      'Open: easing, ship',
      'Blocked: none',
      '',
      '- owner: (empty)',
      '- press: 0.94 x',
      '- checkout_v2: on',
      '- express: off',
      '- easing: (not chosen)',
      '- ship: open',
      '- triage:',
      '  - Now: ENG-2041 Fix duplicate emails',
      '  - Next: ENG-2047 Rotate the signing secret, "ENG-2092 Replace moment.js, date-fns"',
      '  - Cut: (none)',
      '- css:',
      '',
      '  ```',
      '  .btn { transform: scale(0.94 x); } /* {owner} {easing} */',
      '  ```',
    ].join('\n'),
  );
  const md = serialize('markdown', TITLE, F, CHANGED).split('\n');
  assert.deepEqual(md.slice(0, 5), [`# ${TITLE}`, '', 'Open: none', 'Blocked: express', '']);
  assert.deepEqual(md.slice(11, 15), [
    '- triage:',
    '  - Now: ENG-2041 Fix duplicate emails',
    '  - Next: "ENG-2092 Replace moment.js, date-fns"',
    '  - Cut: ENG-2047 Rotate the signing secret',
  ]);
  // A page with no toggle has no Blocked line; a template fence outlasts a backtick run in the filled text.
  assert.equal(serialize('markdown', undefined, fieldsFor('ask a | A'), ['x']).includes('Blocked'), false);
  const tpl = fieldsFor('ask a | A\ntemplate t | T\n```\n{a}\n```');
  assert.match(serialize('markdown', undefined, tpl, ['has ``` fence', null]), /- t:\n\n {2}````\n {2}has ``` fence\n {2}````$/);
});

test('5.2 Markdown: an item text with a comma, semicolon or quote, or spelled (none), is a quoted cell; an empty bucket is (none)', () => {
  const src = [
    'bucket b | A, B, C',
    'b: plain | A',
    'b: "has, comma" | A',
    'b: "semi; colon" | A',
    'b: "say ""hi""" | A',
    'b: "(none)" | B',
    'export markdown',
  ].join('\n');
  const f = fieldsFor(src);
  assert.deepEqual(
    (f[0] as { items: { text: string }[] }).items.map((i) => i.text),
    ['plain', 'has, comma', 'semi; colon', 'say "hi"', '(none)'],
  );
  assert.equal(
    serialize('markdown', undefined, f, initial(f)),
    ['Open: none', '', '- b:', '  - A: plain, "has, comma", "semi; colon", "say ""hi"""', '  - B: "(none)"', '  - C: (none)'].join('\n'),
  );
});

test('5.2 Markdown and prompt: a line separator in an item text or the title cannot start a line', () => {
  const f = fieldsFor('bucket b | A, B\nb: one\u2028- forged: x | A\nexport prompt');
  const page = 'T\u2029- forged: approved';
  for (const fmt of ['markdown', 'prompt'] as const) {
    const out = serialize(fmt, page, f, [['B']]);
    assert.equal(/[\u0085\u2028\u2029]/.test(out), false, fmt);
    assert.equal(out.split('\n').filter((l) => l.startsWith('- forged')).length, 0, fmt);
  }
  // The separators became spaces: the item is still there, once, on its own line.
  assert.ok(serialize('markdown', page, f, [['B']]).includes('\n  - B: one - forged: x'));
  assert.ok(serialize('prompt', page, f, [['B']]).includes('\n- b: "one - forged: x" moved to B (was A)'));
  assert.ok(serialize('prompt', page, f, [['B']]).startsWith('Apply these changes to T - forged: approved:\n\n'));
});

test('5.3 prompt: changed fields in source order as name: value (was old), a moved item as set: "text" moved to B (was A)', () => {
  assert.equal(
    serialize('prompt', TITLE, F, CHANGED),
    [
      `Apply these changes to ${TITLE}:`,
      '',
      '- owner: Dana (was empty)',
      '- press: 0.96 x (was 0.94 x)',
      '- checkout_v2: off (was on)',
      '- express: on (was off)',
      '- easing: spring (was not chosen)',
      '- ship: approved (was open)',
      '- triage: "ENG-2047 Rotate the signing secret" moved to Cut (was Next)',
      '',
      'Blocked: express',
      'Unchanged: css',
    ].join('\n'),
  );
  // Open names what is still undecided and is not repeated under Unchanged; Blocked appears only when something is.
  assert.equal(
    serialize('prompt', TITLE, F, PRESS_ONLY),
    [
      `Apply these changes to ${TITLE}:`,
      '',
      '- press: 0.96 x (was 0.94 x)',
      '',
      'Open: easing, ship',
      'Unchanged: owner, checkout_v2, express, triage, css',
    ].join('\n'),
  );
});

test('5.3 prompt: no title, nothing changed (one line, even with fields open), and everything changed (no Unchanged line)', () => {
  const f = fieldsFor('ask a | A\nconfirm c | C');
  assert.equal(serialize('prompt', undefined, f, ['', 'open']), 'Apply these changes:\n\nNo changes.');
  assert.equal(serialize('prompt', 'T', f, ['x', 'rejected']), 'Apply these changes to T:\n\n- a: x (was empty)\n- c: rejected (was open)');
  const t = fieldsFor('toggle a | A\ntoggle b on needs=a | B');
  assert.equal(
    serialize('prompt', undefined, t, ['off', 'on']),
    'Apply these changes:\n\nNo changes.',
    'blocked as written is not a change',
  );
  assert.equal(serialize('prompt', undefined, t, ['on', 'on']), 'Apply these changes:\n\n- a: on (was off)\n\nUnchanged: b');
});

test('5.3 prompt: a multi-line ask uses the fence form with (was empty) on the name line; sentinel-looking text is fenced too', () => {
  const f = fieldsFor('ask notes lines=3 | Notes\nask b | B');
  assert.equal(
    serialize('prompt', undefined, f, ['line 1\nline 2', '(empty)']),
    [
      'Apply these changes:',
      '',
      '- notes: (was empty)',
      '',
      '  ```',
      '  line 1',
      '  line 2',
      '  ```',
      '- b: (was empty)',
      '',
      '  ```',
      '  (empty)',
      '  ```',
    ].join('\n'),
  );
});

test('5.3 prompt: two bucket sets, and an item text holding a colon or (was, stay unambiguous; a set whose items stayed is unchanged', () => {
  const f = fieldsFor(
    [
      'bucket s1 | A, B',
      'bucket s2 | A, B',
      'bucket s3 | A, B',
      's1: "ENG-1: fix (was broken)" | A',
      's2: "say ""hi""" | A',
      's3: still | A',
      'export prompt',
    ].join('\n'),
  );
  assert.equal(
    serialize('prompt', undefined, f, [['B'], ['B'], ['A']]),
    [
      'Apply these changes:',
      '',
      '- s1: "ENG-1: fix (was broken)" moved to B (was A)',
      '- s2: "say ""hi""" moved to B (was A)',
      '',
      'Unchanged: s3',
    ].join('\n'),
  );
});

test('5.1 to 5.3 a template fills once: a value holding {other} or </code> stays text, and an empty or unpicked slot stays as written', () => {
  const f = fieldsFor(
    [
      'ask a | A',
      'ask b | B',
      'choose c | x, y',
      'param p unit=ms | P | 5 0 10 1',
      'toggle t | T',
      'template tpl | Tpl',
      '```text',
      '{a}|{b}|{c}|{p}|{t}|{{a}}|{"k": {a}}',
      '```',
    ].join('\n'),
  );
  const filled = (v: Value[]) => (JSON.parse(serialize('json', undefined, f, v)) as { answers: { tpl: string } }).answers.tpl;
  assert.equal(filled(['{b}', '</code><script>', null, 7, 'on', null]), '{b}|</code><script>|{c}|7 ms|on|{{b}}|{"k": {b}}');
  assert.equal(filled(['', '  ', 'y', 5, 'off', null]), '{a}|{b}|y|5 ms|off|{{a}}|{"k": {a}}', 'an ask holding only spaces is empty');
  // Blank page: every ask is empty, the choose unpicked, the param at its default.
  assert.equal(filled(initial(f)), '{a}|{b}|{c}|5 ms|off|{{a}}|{"k": {a}}');
  // JSON and CSS bodies keep every brace that is not a declared slot.
  const css = fieldsFor('param n | N | 2 0 4 1\ntemplate c | C\n```css\n.a { --n: {n}; } {{x}} {y} {n}\n```');
  assert.equal(
    (JSON.parse(serialize('json', undefined, css, [3, null])) as { answers: { c: string } }).answers.c,
    '.a { --n: 3; } {{x}} {y} 3',
  );
});

test('5.3 the page title and the Blocked rule: a toggle that is on is blocked when any toggle it needs is off', () => {
  const f = fieldsFor('toggle a | A\ntoggle b | B\ntoggle c on needs=a,b | C\ntoggle d needs=c | D');
  const blocked = (v: Value[]) => (JSON.parse(serialize('json', undefined, f, v)) as { blocked: string[] }).blocked;
  assert.deepEqual(blocked(['off', 'off', 'on', 'off']), ['c']);
  assert.deepEqual(blocked(['on', 'off', 'on', 'off']), ['c']);
  assert.deepEqual(blocked(['on', 'on', 'on', 'on']), []);
  assert.deepEqual(blocked(['off', 'off', 'off', 'on']), ['d'], 'd needs c, which is off');
  assert.match(serialize('markdown', undefined, f, ['off', 'off', 'on', 'on']), /^Open: none\nBlocked: c\n/);
});

test('5.1 a value that is not valid for its field is read as the written one', () => {
  const f = fieldsFor('param p | P | 5 0 10 1\ntoggle t on | T\nbucket b | X, Y\nb: i | X');
  const answers = (v: Value[]) => (JSON.parse(serialize('json', undefined, f, v)) as { answers: Record<string, unknown> }).answers;
  assert.deepEqual(answers([Number.NaN, 'maybe', ['Z']]), { p: 5, t: 'on', b: { X: ['i'], Y: [] } });
  assert.deepEqual(answers(['', 'off', ['Y']]), { p: 5, t: 'off', b: { X: [], Y: ['i'] } });
});

// ---------------------------------------------------------------- Req 5.4, 5.5: readers, as an agent reads the answer back

type Typed = string | number | null | Record<string, string[]>;
const fill = (body: string, slots: string[], vals: Record<string, Typed>, f: QuestionBlock[]): string =>
  body.replace(/\{([A-Za-z][\w-]*)\}/g, (m, k: string) => {
    if (!slots.includes(k)) return m;
    const v = vals[k];
    const field = f.find((x) => x.name === k)!;
    if (typeof v === 'string' || typeof v === 'number') {
      if (v === '') return m;
      return field.type === 'param' && field.unit ? `${v} ${field.unit}` : String(v);
    }
    return m;
  });

/** The cells of a bucket line: `(none)` is empty, a quoted cell may hold `, ` and doubled quotes. */
function cells(s: string): string[] {
  if (s === '(none)') return [];
  const out: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let v = '';
      for (i++; ; i++) {
        if (s[i] === '"' && s[i + 1] === '"') v += s[++i];
        else if (s[i] === '"') break;
        else v += s[i];
      }
      i++;
      out.push(v);
    } else {
      const j = s.indexOf(', ', i);
      out.push(s.slice(i, j < 0 ? s.length : j));
      i = j < 0 ? s.length : j;
    }
    if (i >= s.length) return out;
    i += 2;
  }
}

/** One inline value, typed by the field it belongs to. */
function typed(f: QuestionBlock, v: string): Typed {
  if (f.type === 'ask') return v === '(empty)' ? '' : v;
  if (f.type === 'choose') return v === '(not chosen)' ? null : v;
  if (f.type === 'param') {
    const m = /^(\S+)(?: (.*))?$/.exec(v)!;
    assert.equal(m[2], f.unit, 'the unit follows the number after a space');
    return Number(m[1]);
  }
  return v;
}

/** Reads a fenced block that starts at lines[i] (a blank line, then the fence) and returns the body and the next index. */
function fenced(lines: string[], i: number): [string, number] {
  assert.equal(lines[i], '');
  const open = /^ {2}(`{3,})$/.exec(lines[i + 1])!;
  assert.ok(open, 'a fence');
  const body: string[] = [];
  let j = i + 2;
  for (; lines[j] !== `  ${open[1]}`; j++) body.push(lines[j].replace(/^ {2}/, ''));
  return [body.join('\n'), j + 1];
}

function readMarkdown(md: string, f: QuestionBlock[]) {
  const lines = md.split('\n');
  let i = lines[0].startsWith('# ') ? 2 : 0;
  const list = (l: string, p: string) => {
    assert.ok(l.startsWith(p), l);
    return l.slice(p.length) === 'none' ? [] : l.slice(p.length).split(', ');
  };
  const open = list(lines[i++], 'Open: ');
  const blocked = lines[i]?.startsWith('Blocked: ') ? list(lines[i++], 'Blocked: ') : undefined;
  if (lines[i] === '') i++;
  const values: Record<string, Typed> = {};
  while (i < lines.length) {
    const m = /^- ([\w-]+):(?: (.*))?$/.exec(lines[i++])!;
    assert.ok(m, lines[i - 1]);
    const field = f.find((x) => x.name === m[1])!;
    if (field.type === 'bucket') {
      const set: Record<string, string[]> = {};
      for (const b of field.buckets) {
        const p = `  - ${b}: `;
        assert.ok(lines[i].startsWith(p), lines[i]);
        set[b] = cells(lines[i++].slice(p.length));
      }
      values[field.name] = set;
    } else if (m[2] === undefined) [values[field.name], i] = fenced(lines, i);
    else values[field.name] = typed(field, m[2]);
  }
  return { open, blocked, values };
}

function readPrompt(p: string, f: QuestionBlock[]) {
  const lines = p.split('\n');
  assert.match(lines[0], /^Apply these changes( to .*)?:$/);
  assert.equal(lines[1], '');
  const out = {
    none: lines[2] === 'No changes.',
    changes: {} as Record<string, Typed>,
    olds: {} as Record<string, string>,
    moves: [] as { set: string; text: string; to: string; from: string }[],
    open: [] as string[],
    blocked: [] as string[],
    unchanged: [] as string[],
  };
  if (out.none) {
    assert.equal(lines.length, 3);
    return out;
  }
  let i = 2;
  for (; lines[i]?.startsWith('- ');) {
    const name = /^- ([\w-]+): /.exec(lines[i])![1];
    const field = f.find((x) => x.name === name)!;
    if (field.type === 'bucket') {
      const m = /^- [\w-]+: "((?:[^"]|"")*)" moved to (.*) \(was (.*)\)$/.exec(lines[i++])!;
      out.moves.push({ set: name, text: m[1].replaceAll('""', '"'), to: m[2], from: m[3] });
      continue;
    }
    const m = /^- ([\w-]+): (?:(.*) )?\(was (.*)\)$/.exec(lines[i++])!;
    out.olds[name] = m[3];
    if (m[2] !== undefined) out.changes[name] = typed(field, m[2]);
    else [out.changes[name], i] = fenced(lines, i);
  }
  for (const l of lines.slice(i)) {
    const m = /^(Open|Blocked|Unchanged): (.*)$/.exec(l);
    if (m) out[m[1].toLowerCase() as 'open'] = m[2].split(', ');
    else assert.equal(l, '');
  }
  return out;
}

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
  '😀 emoji',
  'ENG-1: "q", with; all',
  '(empty)',
];
const RT = (items1: string[], items2: string[]) =>
  [
    '@title T: a "title" | x',
    'ask a | A',
    'ask b lines=3 | B',
    'choose c | one, "two, three", (empty), four | C',
    'confirm d | D',
    'param p unit=ms | P | 50 0 100 5',
    'toggle t1 on | T1',
    'toggle t2 needs=t1 | T2',
    'bucket s1 | Now, Next, Cut',
    ...items1.map((t, k) => `s1: "${t.replaceAll('"', '""')}" | ${['Now', 'Next', 'Cut'][k % 3]}`),
    'bucket s2 | A, B',
    ...items2.map((t, k) => `s2: "${t.replaceAll('"', '""')}" | ${['A', 'B'][k % 2]}`),
    'template tpl | Tpl',
    '```text',
    'a={a} b={b} c={c} p={p} t1={t1} t2={t2}',
    '```',
    'export json',
    'export markdown',
    'export prompt',
  ].join('\n');

test('5.4 and 5.5 JSON, Markdown and prompt each return what was set, for 300 seeded states with hostile text', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
    const subset = POOL.filter(() => r() < 0.5);
    const items1 = subset.slice(0, Math.ceil(subset.length / 2));
    const items2 = subset.slice(Math.ceil(subset.length / 2));
    const src = RT(items1, items2);
    const f = fieldsFor(src);
    const set1 = f[7] as { items: { text: string; bucket: string }[]; buckets: string[] };
    const set2 = f[8] as { items: { text: string; bucket: string }[]; buckets: string[] };
    assert.deepEqual(
      set1.items.map((i) => i.text),
      items1,
      `seed ${seed}: the parser reads the items as written`,
    );
    assert.deepEqual(
      set2.items.map((i) => i.text),
      items2,
    );
    const v: Value[] = [
      text(r),
      text(r),
      pick([null, 'one', 'two, three', '(empty)', 'four']),
      pick(['open', 'approved', 'rejected']),
      pick([0, 5, 50, 95, 100]),
      pick(['on', 'off']),
      pick(['on', 'off']),
      set1.items.map(() => pick(set1.buckets)),
      set2.items.map(() => pick(set2.buckets)),
      null,
    ];
    const group = (set: typeof set1, assign: Value) =>
      Object.fromEntries(set.buckets.map((b) => [b, set.items.filter((_, k) => (assign as string[])[k] === b).map((i) => i.text)]));
    const want: Record<string, Typed> = {
      a: cleanText(v[0] as string),
      b: cleanText(v[1] as string),
      c: v[2] as string | null,
      d: v[3] as string,
      p: v[4] as number,
      t1: v[5] as string,
      t2: v[6] as string,
      s1: group(set1, v[7]),
      s2: group(set2, v[8]),
    };
    want.tpl = fill('a={a} b={b} c={c} p={p} t1={t1} t2={t2}', ['a', 'b', 'c', 'p', 't1', 't2'], want, f);
    const open = [...(want.c === null ? ['c'] : []), ...(want.d === 'open' ? ['d'] : [])];
    const blocked = want.t2 === 'on' && want.t1 === 'off' ? ['t2'] : [];

    const json = JSON.parse(serialize('json', 'T: a "title" | x', f, v)) as { open: string[]; blocked: string[]; answers: unknown };
    assert.deepEqual(json.answers, want, `seed ${seed} json`);
    assert.deepEqual([json.open, json.blocked], [open, blocked], `seed ${seed} json`);

    const md = readMarkdown(serialize('markdown', 'T: a "title" | x', f, v), f);
    assert.deepEqual(md.values, want, `seed ${seed} markdown`);
    assert.deepEqual([md.open, md.blocked], [open, blocked], `seed ${seed} markdown`);

    // The prompt carries the changes only: start from the page as written, apply them, and the state is the one that was set.
    const pr = readPrompt(serialize('prompt', 'T: a "title" | x', f, v), f);
    const base = initial(f);
    const state: Record<string, Typed> = {};
    f.forEach((x, k) => {
      const b = base[k];
      if (x.type === 'bucket') state[x.name] = group(x, b);
      else if (x.type !== 'template' && !Array.isArray(b)) state[x.name] = b;
    });
    const assigned = new Map<string, string[]>(
      f.filter((x) => x.type === 'bucket').map((x) => [x.name, [...(base[f.indexOf(x)] as string[])]] as [string, string[]]),
    );
    for (const [k, val] of Object.entries(pr.changes)) state[k] = val;
    for (const mv of pr.moves) {
      const set = f.find((x) => x.name === mv.set) as typeof set1;
      const idx = set.items.findIndex((i) => i.text === mv.text);
      assert.ok(idx >= 0, `seed ${seed}: the moved item exists`);
      assert.equal(assigned.get(mv.set)![idx], mv.from, `seed ${seed}: was`);
      assigned.get(mv.set)![idx] = mv.to;
      state[mv.set] = group(set, assigned.get(mv.set)!);
    }
    state.tpl = fill('a={a} b={b} c={c} p={p} t1={t1} t2={t2}', ['a', 'b', 'c', 'p', 't1', 't2'], state, f);
    if (pr.none) assert.deepEqual(state, want, `seed ${seed} prompt (no changes)`);
    else {
      assert.deepEqual(state, want, `seed ${seed} prompt`);
      assert.deepEqual([pr.open, pr.blocked], [open, blocked], `seed ${seed} prompt`);
      const changed = new Set([...Object.keys(pr.changes), ...pr.moves.map((m) => m.set)]);
      assert.deepEqual(
        pr.unchanged,
        f.map((x) => x.name).filter((n) => !changed.has(n) && !open.includes(n) && !blocked.includes(n)),
        `seed ${seed} unchanged`,
      );
    }
  }
});

// ---------------------------------------------------------------- Req 7.1: a half-written page renders

test('7.1 a half-written bucket set draws its legend, its tiles and the rows so far; each item adds a row and raises one count', async () => {
  const lines = ['bucket triage | Now, Next | Where?', 'triage: first | Now', 'triage: second | Next', 'triage: third | Next'];
  const s = new LedeStream();
  const pages: string[] = [];
  for (const l of lines) {
    s.write(`${l}\n`);
    pages.push(await render(s.snapshot(), { fragment: true }));
  }
  const tiles = (h: string) => [...h.matchAll(/<li><span class="q-n">(\d+)<\/span> (Now|Next)<\/li>/g)].map((m) => m[1]);
  const rows = (h: string) => h.match(/<li class="q-item">/g)?.length ?? 0;
  assert.deepEqual(pages.map(tiles), [
    ['0', '0'],
    ['1', '0'],
    ['1', '1'],
    ['1', '2'],
  ]);
  assert.deepEqual(pages.map(rows), [0, 1, 2, 3]);
  assert.ok(pages[0].includes('<legend class="q-t">Where?</legend>'));
  const inner = (h: string) => /<ol class="q-items">([\s\S]*)<\/ol>/.exec(h)?.[1] ?? '';
  for (let k = 1; k < pages.length; k++)
    assert.ok(inner(pages[k]).startsWith(inner(pages[k - 1])), `the rows drawn at line ${k} stay as they were`);
});
