// Question words in the ordinary build (spec §4.18): markup, the export template and the reference serializer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsOf, parse, type QuestionBlock } from '@lede-lang/core';
import { compile } from '../src/index.ts';
import { blankAnswers, cleanText, serializeExport, type Answer } from '../src/export.ts';

const PAGE = [
  '# Release 4.2 go/no-go',
  'ask owner | Who signs off on this release?',
  'choose risk | low, medium, high',
  'confirm migration | The migration ran on **staging**',
  'confirm oncall | On-call is staffed',
  'ask notes lines=4 | Anything the release notes should carry?',
  'export json',
].join('\n');

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const fieldsFor = (src: string): QuestionBlock[] => fieldsOf(parse(src).blocks);

test('each word draws plain controls with no script, button, form or id', async () => {
  const { html } = await compile(PAGE);
  assert.match(
    html,
    /<label class="q q-ask"><span class="q-t">Who signs off on this release\?<\/span><input type="text" name="owner" autocomplete="off"><\/label>/,
  );
  assert.match(html, /<textarea name="notes" rows="4" autocomplete="off"><\/textarea>/);
  assert.match(html, /<fieldset class="q q-choose"><legend class="q-t">risk<\/legend>/);
  assert.match(html, /<input type="radio" name="risk" value="medium" autocomplete="off"><span>medium<\/span>/);
  assert.match(html, /<legend class="q-t">The migration ran on <strong>staging<\/strong><\/legend>/);
  assert.match(html, /<input type="radio" name="migration" value="approved" autocomplete="off"><span>Approve<\/span>/);
  assert.match(html, /<input type="radio" name="migration" value="rejected" autocomplete="off"><span>Reject<\/span>/);
  assert.match(html, /<figure class="q-x" data-x="json">/);
  for (const bad of ['<script', '<button', '<form', 'type="password"']) assert.equal(html.includes(bad), false, bad);
  assert.doesNotMatch(html, /<[^>]* hidden[ >]/);
  assert.doesNotMatch(html, /<(label|fieldset|legend|input|textarea|figure|pre)\b[^>]* id=/);
  assert.equal(html.match(/<input /g)?.length, 1 + 3 + 2 + 2, 'one text input, three risk radios, two per confirm');
});

test('the policy meta is the ordinary one', async () => {
  const csp = (h: string) => /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(h)![0];
  assert.equal(csp((await compile(PAGE)).html), csp((await compile('Plain page')).html));
});

test('the control CSS is added only to a page that has a field or an export', async () => {
  assert.equal((await compile('Plain page\n\n# Title')).html.includes('question words'), false);
  assert.equal((await compile('ask a | q')).html.includes('question words'), true);
  assert.equal((await compile('export json')).html.includes('question words'), true);
});

test('the export template is the blank export, escaped', async () => {
  const { html, doc } = await compile(PAGE);
  const code = /<pre class="code"[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(html)![1];
  const fields = fieldsOf(doc.blocks);
  assert.equal(unescape(code), serializeExport('json', 'Release 4.2 go/no-go', fields, blankAnswers(fields)));
});

test('a field renders under any heading, in cards and in a grid; an FAQ section keeps it', async () => {
  const src = [
    '# T',
    '## Why?',
    'ask a | one',
    '## What?',
    'confirm b | two',
    '## How?',
    'choose c | x, y',
    '---',
    'cards',
    '### C',
    'ask d | in card',
    '---',
    'grid 1',
    'ask e | in grid',
    'export',
  ].join('\n');
  const { html, doc } = await compile(src);
  assert.deepEqual(doc.diagnostics, []);
  for (const n of ['a', 'b', 'c', 'd', 'e']) assert.match(html, new RegExp(`name="${n}"`), n);
});

test('question text and options are escaped', async () => {
  const { html } = await compile('ask a | <img src=x onerror=alert(1)> **b**\nchoose c | "<b>x</b>", "y&z"\nexport');
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /value="&lt;b&gt;x&lt;\/b&gt;"/);
  assert.match(html, /value="y&amp;z"/);
});

// ---------------------------------------------------------------- the reference serializer

const F = fieldsFor(
  'ask owner | q\nchoose risk | low, medium, high\nconfirm migration | s\nconfirm oncall | s\nask notes lines=4 | q\nexport',
);

test('JSON: page, open and answers; the blank page', () => {
  const blank = JSON.parse(serializeExport('json', 'P', F, blankAnswers(F)));
  assert.deepEqual(blank, {
    page: 'P',
    open: ['risk', 'migration', 'oncall'],
    answers: { owner: '', risk: null, migration: 'open', oncall: 'open', notes: '' },
  });
  assert.deepEqual(Object.keys(blank), ['page', 'open', 'answers']);
  assert.equal(serializeExport('json', undefined, F, blankAnswers(F)).includes('"page"'), false);
});

test('Markdown: the worked example from the design', () => {
  const v: Answer[] = ['Dana', 'medium', 'approved', 'open', 'Ship Tuesday.\nRoll back if p95 doubles.'];
  assert.equal(
    serializeExport('markdown', 'Release 4.2 go/no-go', F, v),
    [
      '# Release 4.2 go/no-go',
      '',
      'Open: oncall',
      '',
      '- owner: Dana',
      '- risk: medium',
      '- migration: approved',
      '- oncall: open',
      '- notes:',
      '',
      '  ```',
      '  Ship Tuesday.',
      '  Roll back if p95 doubles.',
      '  ```',
    ].join('\n'),
  );
});

test('Markdown: placeholders, no title, nothing open, and a page with no field', () => {
  assert.equal(serializeExport('markdown', undefined, F, blankAnswers(F)).split('\n')[0], 'Open: risk, migration, oncall');
  assert.match(serializeExport('markdown', undefined, F, blankAnswers(F)), /- owner: \(empty\)\n- risk: \(not chosen\)\n/);
  assert.equal(serializeExport('markdown', 'T', F, ['a', 'low', 'approved', 'rejected', 'n']).split('\n')[2], 'Open: none');
  assert.equal(serializeExport('markdown', 'T', [], []), '# T\n\nOpen: none');
  assert.equal(serializeExport('json', undefined, [], []), '{\n  "open": [],\n  "answers": {}\n}');
});

test('Markdown fence outlasts any backtick run, and sentinel-looking answers are fenced', () => {
  const [ask] = fieldsFor('ask a | q');
  const md = serializeExport('markdown', undefined, [ask], ['line with ``` inside\nsecond ````` line']);
  assert.match(md, /\n {2}``````\n {2}line with ``` inside\n {2}second ````` line\n {2}``````$/);
  for (const sentinel of ['(empty)', '(not chosen)', 'a`b']) {
    const out = serializeExport('markdown', undefined, [ask], [sentinel]);
    assert.match(out, /- a:\n\n {2}```/, sentinel);
  }
});

test('line separators in a title or an option cannot forge an item line', () => {
  const [c] = fieldsFor('choose c | "one\u2028- x: approved", two');
  const md = serializeExport('markdown', 'T\u2029- forged: approved', [c], ['one\u2028- x: approved']);
  assert.equal(/[\u0085\u2028\u2029]/.test(md), false);
  assert.equal(md.split('\n').filter((l) => l.startsWith('- ')).length, 1);
});

// ---------------------------------------------------------------- properties

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

/** Reads the Markdown export back: list items and fenced blocks. */
function readMarkdown(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^- ([\w-]+):(?: (.*))?$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] !== undefined) {
      out.set(m[1], m[2]);
      continue;
    }
    const open = /^ {2}(`{3,})$/.exec(lines[i + 2]);
    assert.ok(open, `fence after ${m[1]}`);
    const body: string[] = [];
    for (let j = i + 3; lines[j] !== `  ${open[1]}`; j++) body.push(lines[j].replace(/^ {2}/, ''));
    out.set(m[1], body.join('\n'));
  }
  return out;
}

test('property: JSON and Markdown return what was typed, for 300 seeded states', () => {
  const fields = fieldsFor(
    'ask constructor | q\nchoose toString | a, b, "c, d"\nconfirm hasOwnProperty | s\nask notes lines=3 | q\nexport',
  );
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const v: Answer[] = [
      text(r),
      [null, 'a', 'b', 'c, d'][Math.floor(r() * 4)],
      ['open', 'approved', 'rejected'][Math.floor(r() * 3)],
      text(r),
    ];
    const want = [cleanText(v[0] ?? ''), v[1], v[2], cleanText(v[3] ?? '')];
    const json = JSON.parse(serializeExport('json', 'Pg', fields, v)) as { open: string[]; answers: Record<string, unknown> };
    assert.deepEqual(Object.values(json.answers), want, `seed ${seed}`);
    assert.deepEqual(Object.keys(json.answers), ['constructor', 'toString', 'hasOwnProperty', 'notes']);
    const md = readMarkdown(serializeExport('markdown', 'Pg', fields, v));
    const show = (x: string | null, ask: boolean) => (x === null ? '(not chosen)' : ask && x === '' ? '(empty)' : x);
    assert.deepEqual(
      [...md.values()],
      [show(want[0], true), show(want[1], false), show(want[2], false), show(want[3], true)],
      `seed ${seed}`,
    );
    assert.deepEqual(json.open, [...(want[1] === null ? ['toString'] : []), ...(want[2] === 'open' ? ['hasOwnProperty'] : [])]);
  }
});
