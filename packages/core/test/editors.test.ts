// Editor words (spec §4.19, D65): param, toggle, bucket, template, preset and `export prompt`. Ordinary parsing, in both
// build modes. One rule per test, numbered as the requirements are (internal spec, lede-lang/meta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';
import type { Block, BucketBlock, ExportBlock, ParamBlock, PresetBlock, TemplateBlock, ToggleBlock } from '../src/index.ts';

const { parse, fieldsOf } = core;

const diags = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);
/** Diagnostics other than the whole-page export warnings, which depend on what else is on the page. */
const errs = (src: string) => diags(src).filter((d) => !/export-(orphan|missing)/.test(d));
const blocks = (src: string): Block[] => parse(src).blocks;
const kinds = (src: string) => blocks(src).map((b) => b.type);
const only = <T extends Block>(src: string, type: T['type']): T[] => blocks(src).filter((b): b is T => b.type === type);
const detail = (src: string, code: string) => parse(src).diagnostics.find((d) => d.code === code)?.detail;
const lines = (...l: string[]) => l.join('\n');

// ---------------------------------------------------------------- Req 2.1 param

test('2.1 param: every form parses to one block, with the proposed value in the line', () => {
  assert.deepEqual(blocks('param press unit=x | Press depth | 0.94 0.85 1 0.01')[0], {
    type: 'param',
    name: 'press',
    text: 'Press depth',
    value: 0.94,
    min: 0.85,
    max: 1,
    step: 0.01,
    unit: 'x',
    line: 1,
  });
  // No unit: the key is omitted, so existing documents keep their AST.
  const [bare] = only<ParamBlock>('param n | N | 5 0 10 1', 'param');
  assert.equal('unit' in bare, false);
  // A quoted unit may hold spaces; an empty unit is no unit; the label may hold a pipe; negative and decimal numbers read.
  assert.equal(only<ParamBlock>('param n unit="% of full" | N | 5 0 10 1', 'param')[0].unit, '% of full');
  assert.equal('unit' in only<ParamBlock>('param n unit= | N | 5 0 10 1', 'param')[0], false);
  assert.equal(only<ParamBlock>('param n | A | B | 5 0 10 1', 'param')[0].text, 'A | B');
  const [neg] = only<ParamBlock>('param n | N | -2 -10 10 0.5', 'param');
  assert.deepEqual([neg.value, neg.min, neg.max, neg.step], [-2, -10, 10, 0.5]);
  assert.deepEqual(diags('param n | N | 5 0 10 1\nexport json'), []);
});

test('2.1 param: MIN < MAX (rule order)', () => {
  assert.deepEqual(diags('param a | A | 1 2 1 1'), ['error:param-range@1']);
  assert.deepEqual(detail('param a | A | 1 1 1 1', 'param-range'), { value: 1, min: 1, max: 1, step: 1, rule: 'order' });
});

test('2.1 param: STEP > 0 (rule step)', () => {
  assert.equal((detail('param a | A | 1 0 2 0', 'param-range') as { rule: string }).rule, 'step');
  assert.equal((detail('param a | A | 1 0 2 -1', 'param-range') as { rule: string }).rule, 'step');
});

test('2.1 param: MIN <= DEFAULT <= MAX (rule range)', () => {
  assert.equal((detail('param a | A | -1 0 2 1', 'param-range') as { rule: string }).rule, 'range');
  assert.equal((detail('param a | A | 3 0 2 1', 'param-range') as { rule: string }).rule, 'range');
  assert.deepEqual(diags('param a | A | 0 0 2 1\nparam b | B | 2 0 2 1\nexport json'), []);
});

test('2.1 param: DEFAULT - MIN is a whole number of steps within 1e-9 (rule grid), so float noise passes', () => {
  assert.equal((detail('param a | A | 0.5 0 1 0.2', 'param-range') as { rule: string }).rule, 'grid');
  assert.equal((detail('param a | A | 1 0 3 2', 'param-range') as { rule: string }).rule, 'grid');
  // 0.09000000000000008 / 0.01 and 0.19999999999999998 / 0.1 are not whole in floating point.
  assert.deepEqual(diags('param a | A | 0.94 0.85 1 0.01\nparam b | B | 0.3 0.1 0.9 0.1\nexport json'), []);
});

test('2.1 param: at most 1,000 steps from MIN to MAX (rule count)', () => {
  assert.equal((detail('param a | A | 0 0 1001 1', 'param-range') as { rule: string }).rule, 'count');
  assert.equal((detail('param a | A | 0 0 1 0.0005', 'param-range') as { rule: string }).rule, 'count');
  // Exactly 1,000 steps is fine.
  assert.deepEqual(diags('param a | A | 0 0 1000 1\nparam b | B | 0 0 1 0.001\nexport json'), []);
});

test('2.1 param: a bad line makes no block and takes no name; a wrong number count is a syntax error', () => {
  assert.deepEqual(kinds('param a | A | 1 2 1 1'), []);
  assert.deepEqual(errs('param a | A | 1 2 1 1\nask a | A again'), ['error:param-range@1']);
  assert.deepEqual(diags('param a | A | 1 2'), ['error:question-syntax@1']);
  assert.deepEqual(diags('param a | A'), ['error:question-syntax@1']);
  assert.deepEqual(diags('param a | A | one two three four'), ['error:question-syntax@1']);
  assert.deepEqual(diags('param a |  | 1 0 2 1'), ['error:question-syntax@1']);
  assert.deepEqual(detail('param a | A | 1 2', 'question-syntax'), { word: 'param' });
});

test('2.1 param: an option other than unit= before the | is W question-option and ignored', () => {
  const doc = parse('param a unit=x size=2 stray | A | 1 0 2 1');
  assert.deepEqual(
    doc.diagnostics.filter((d) => d.code !== 'export-missing').map((d) => `${d.severity}:${d.code}`),
    ['warning:question-option', 'warning:question-option'],
  );
  assert.deepEqual(only<ParamBlock>('param a unit=x size=2 stray | A | 1 0 2 1', 'param')[0].unit, 'x');
  assert.equal(doc.blocks.length, 1);
});

// ---------------------------------------------------------------- Req 2.2 toggle

test('2.2 toggle: the state defaults to off; on and off are read; needs is a unique list', () => {
  const t = only<ToggleBlock>(
    lines('toggle a | A', 'toggle b on | B', 'toggle c off | C', 'toggle d needs="a, b ,a" | D', 'toggle e on needs=a | E', 'export json'),
    'toggle',
  );
  assert.deepEqual(
    t.map((x) => [x.name, x.on, x.needs]),
    [
      ['a', false, undefined],
      ['b', true, undefined],
      ['c', false, undefined],
      ['d', false, ['a', 'b']],
      ['e', true, ['a']],
    ],
  );
  // Optional keys are omitted, not undefined.
  assert.equal('needs' in t[0], false);
  assert.deepEqual(blocks('toggle a | A | with a pipe')[0], { type: 'toggle', name: 'a', text: 'A | with a pipe', on: false, line: 1 });
});

test('2.2 toggle: needs may name a toggle declared later, checked when the document ends', () => {
  assert.deepEqual(diags('toggle a needs=b | A\ntoggle b | B\nexport json'), []);
  // The snapshot of a prefix reports it, like export-missing: the toggle it needs may still be coming.
  assert.deepEqual(diags('toggle a needs=b | A\nexport json'), ['error:toggle-needs@1']);
});

test('2.2 toggle: a toggle that needs itself, or a name that is not a toggle, is E toggle-needs at the toggle', () => {
  const doc = parse(lines('toggle a | A', 'toggle b needs=b | B', 'ask c | C', 'toggle d needs=a,c,zzz | D', 'export json'));
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.line, d.detail]),
    [
      ['toggle-needs', 2, { name: 'b', needs: 'b', toggles: ['a', 'b', 'd'] }],
      ['toggle-needs', 4, { name: 'd', needs: 'c', toggles: ['a', 'b', 'd'] }],
      ['toggle-needs', 4, { name: 'd', needs: 'zzz', toggles: ['a', 'b', 'd'] }],
    ],
  );
});

test('2.2 toggle: any other word before the | is W question-option and ignored', () => {
  assert.deepEqual(diags('toggle a on loud | A\nexport json'), ['warning:question-option@1']);
  assert.deepEqual(diags('toggle a on off | A\nexport json'), ['warning:question-option@1']);
  assert.equal(only<ToggleBlock>('toggle a on off | A', 'toggle')[0].on, true);
  assert.deepEqual(diags('toggle a on unit=x | A\nexport json'), ['warning:question-option@1']);
});

// ---------------------------------------------------------------- Req 2.3 bucket

test('2.3 bucket: two to eight distinct non-empty names, read as data cells', () => {
  const [b] = only<BucketBlock>('bucket triage | Now, Next, "Later, maybe" | Where does each go?', 'bucket');
  assert.deepEqual(b, {
    type: 'bucket',
    name: 'triage',
    text: 'Where does each go?',
    buckets: ['Now', 'Next', 'Later, maybe'],
    items: [],
    line: 1,
  });
  assert.equal(only<BucketBlock>('bucket t | A; B', 'bucket')[0].text, null);
  assert.deepEqual(only<BucketBlock>('bucket t | A; B', 'bucket')[0].buckets, ['A', 'B']);
});

test('2.3 bucket: eight buckets are fine and nine are not', () => {
  assert.equal(only<BucketBlock>('bucket t | a, b, c, d, e, f, g, h', 'bucket').length, 1);
  assert.deepEqual(errs('bucket t | a, b, c, d, e, f, g, h, i'), ['error:bucket-names@1']);
  assert.deepEqual(detail('bucket t | a, b, c, d, e, f, g, h, i', 'bucket-names'), { count: 9, empty: false, dup: false, reserved: false });
  assert.deepEqual(errs('bucket t | only'), ['error:bucket-names@1']);
});

test('2.3 bucket: empty, repeated and reserved names are E bucket-names', () => {
  assert.deepEqual(detail('bucket t | a, , b', 'bucket-names'), { count: 2, empty: true, dup: false, reserved: false });
  assert.deepEqual(detail('bucket t | a, b, a', 'bucket-names'), { count: 2, empty: false, dup: true, reserved: false });
  assert.deepEqual(detail('bucket t | a, (not chosen)', 'bucket-names'), { count: 2, empty: false, dup: false, reserved: true });
  assert.deepEqual(detail('bucket t | a, (empty)', 'bucket-names'), { count: 2, empty: false, dup: false, reserved: true });
  assert.deepEqual(kinds('bucket t | a, a'), []);
  assert.deepEqual(errs('bucket t | "a, b'), ['error:csv-quote@1', 'error:bucket-names@1']);
});

test('2.3 bucket: NAME: lines after the set are its items, in source order, bound as diagram statements bind', () => {
  const [b] = only<BucketBlock>(
    lines(
      'bucket triage | Now, Next, Cut',
      'triage: ENG-1 Fix emails | Now',
      '',
      'Some prose between.',
      'triage: ENG-2 Rotate | Cut',
      'triage: "ENG-3 Retry, then give up" | Next',
      'triage: ENG-4 Drop a | b path | Cut',
      'triage:   padded text   |   Now',
    ),
    'bucket',
  );
  assert.deepEqual(
    b.items.map((i) => [i.text, i.bucket, i.line]),
    [
      ['ENG-1 Fix emails', 'Now', 2],
      ['ENG-2 Rotate', 'Cut', 5],
      ['ENG-3 Retry, then give up', 'Next', 6],
      ['ENG-4 Drop a | b path', 'Cut', 7],
      ['padded text', 'Now', 8],
    ],
  );
});

test('2.3 bucket: an item line before its set is a diagram statement or prose, as today', () => {
  const before = 'triage: ENG-1 Fix emails | Now\nbucket triage | Now, Next';
  assert.deepEqual(kinds(before), ['paragraph', 'bucket']);
  assert.equal(only<BucketBlock>(before, 'bucket')[0].items.length, 0);
  // With an arrow it is the existing undeclared-diagram error, not a bucket error.
  assert.deepEqual(errs('triage: a -> b\nbucket triage | Now, Next'), ['error:undeclared-diagram@1', 'warning:bucket-empty@2']);
  // A name that is neither a bucket nor a diagram stays what it is today.
  assert.deepEqual(kinds('Note: ENG-1 | Now'), ['paragraph']);
});

test('2.3 bucket: an item names a declared bucket exactly, with the case it was written in (E bucket-unknown)', () => {
  const src = 'bucket t | Now, Next\nt: a | Soon\nt: b | now\nt: c | Now';
  assert.deepEqual(errs(src), ['error:bucket-unknown@2', 'error:bucket-unknown@3']);
  assert.deepEqual(detail(src, 'bucket-unknown'), { bucket: 'Soon', buckets: ['Now', 'Next'] });
  assert.deepEqual(
    only<BucketBlock>(src, 'bucket')[0].items.map((i) => i.text),
    ['c'],
  );
});

test('2.3 bucket: an item with no | BUCKET or no text is E bucket-item, and its message names the bucket', () => {
  const src = lines('bucket t | Now, Next', 't: no bucket', 't:', 't: | Now', 't:    | Next', 't: ok | Now');
  assert.deepEqual(errs(src), ['error:bucket-item@2', 'error:bucket-item@3', 'error:bucket-item@4', 'error:bucket-item@5']);
  assert.deepEqual(detail(src, 'bucket-item'), { name: 't' });
  const message = parse(src).diagnostics[0].message;
  assert.match(message, /\bt\b/);
  assert.doesNotMatch(message, /diagram/);
});

test('2.3 bucket: a repeated item text is W bucket-dup-item and the first is kept; a set with no item is W bucket-empty', () => {
  const src = 'bucket t | Now, Next\nt: a | Now\nt: a | Next\nbucket u | A, B\nexport json';
  assert.deepEqual(diags(src), ['warning:bucket-dup-item@3', 'warning:bucket-empty@4']);
  assert.deepEqual(parse(src).diagnostics[0].detail, { text: 'a', first: 2 });
  assert.deepEqual(parse(src).diagnostics[1].detail, { name: 'u' });
  const [t] = only<BucketBlock>(src, 'bucket');
  assert.deepEqual(
    t.items.map((i) => [i.text, i.bucket]),
    [['a', 'Now']],
  );
});

test('2.3 bucket: a bucket set shares no name with a data set or a diagram, either way round', () => {
  assert.deepEqual(errs('data t = a,b; 1,2\nbucket t | A, B'), ['error:name-clash@2']);
  assert.deepEqual(kinds('data t = a,b; 1,2\nbucket t | A, B'), ['data']);
  assert.deepEqual(errs('diagram t\nt: a -> b\nbucket t | A, B'), ['error:name-clash@3']);
  assert.deepEqual(errs('bucket t | A, B\nt: x | A\ndata t = a,b; 1,2\nexport json'), ['error:name-clash@3']);
  assert.deepEqual(errs('bucket t | A, B\nt: x | A\ndiagram t'), ['error:name-clash@3', 'warning:diagram-empty@3']);
  // The fixer renames a diagram named like a data set from detail.diagram; a bucket clash must not offer it.
  const clash = parse('bucket t | A, B\ndiagram t').diagnostics.find((d) => d.code === 'name-clash');
  assert.deepEqual(clash?.detail, { bucket: 't' });
});

test('2.3 bucket: the five words cannot name a diagram', () => {
  for (const w of ['param', 'toggle', 'bucket', 'template', 'preset']) assert.deepEqual(errs(`diagram ${w}`), ['error:diagram-name@1'], w);
  assert.ok((core.KEYWORDS as readonly string[]).includes('bucket'));
});

test('2.3 bucket: a bucket inside a grid or a card keeps taking its item lines', () => {
  const src = lines('grid 1', 'bucket t | A, B', 't: x | A', 't: y | B', 'export json');
  const grid = blocks(src)[0];
  assert.equal(grid.type, 'grid');
  const child = grid.children[0];
  assert.equal(child.type, 'bucket');
  assert.equal(child.items.length, 2);
});

// ---------------------------------------------------------------- Req 2.4 template

const FENCE = '```';

test('2.4 template: the next non-blank line must open a fence, and its text is the body', () => {
  const src = lines('ask who | Who?', 'template t | Greeting', '', `${FENCE}text`, 'Hello {who}.', 'Bye.', FENCE, 'export json');
  const [t] = only<TemplateBlock>(src, 'template');
  assert.deepEqual(t, {
    type: 'template',
    name: 't',
    text: 'Greeting',
    body: 'Hello {who}.\nBye.',
    lang: 'text',
    slots: ['who'],
    line: 2,
  });
  assert.deepEqual(diags(src), []);
  // A fence with no info string has no lang key.
  assert.equal('lang' in only<TemplateBlock>(lines('ask who | Who?', 'template t | T', FENCE, '{who}', FENCE), 'template')[0], false);
});

test('2.4 template: prose, or the end of the document, where the fence should be is E template-fence at the template line', () => {
  assert.deepEqual(errs('template t | T\nSome prose.'), ['error:template-fence@1']);
  assert.deepEqual(errs('template t | T\n\nSome prose.'), ['error:template-fence@1']);
  assert.deepEqual(errs('template t | T'), ['error:template-fence@1']);
  assert.deepEqual(detail('template t | T', 'template-fence'), { name: 't' });
  // The line that is not a fence is processed as it always was.
  assert.deepEqual(kinds('template t | T\nSome prose.'), ['paragraph']);
  assert.deepEqual(kinds('template t | T\n# Heading'), ['heading']);
  // A raw html fence is not a template body.
  assert.deepEqual(errs(lines('template t | T', `${FENCE}=html`, '<b>x</b>', FENCE)), ['error:template-fence@1']);
  // A failed template takes no name.
  assert.deepEqual(errs('template t | T\nprose\nask t | Now free'), ['error:template-fence@1']);
});

test('2.4 template: {NAME} is a slot only for an ask, choose, param or toggle declared above', () => {
  const src = lines(
    'ask a | A',
    'choose c | x, y',
    'param p | P | 1 0 2 1',
    'toggle t | T',
    'template tpl | T',
    FENCE,
    '{t} {p} {c} {a} {a} again',
    FENCE,
    'export json',
  );
  assert.deepEqual(only<TemplateBlock>(src, 'template')[0].slots, ['t', 'p', 'c', 'a']);
  assert.deepEqual(diags(src), []);
});

test('2.4 template: an undeclared {word} is a warning and stays literal, once per word', () => {
  const src = lines('ask a | A', 'template t | T', FENCE, '{a} {zzz} {zzz} {a}', FENCE, 'export json');
  const doc = parse(src);
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.severity, d.code, d.line, d.col, d.detail]),
    [['warning', 'template-slot', 4, 5, { slot: 'zzz', fields: ['a'] }]],
  );
  const t = only<TemplateBlock>(src, 'template')[0];
  assert.equal(t.body, '{a} {zzz} {zzz} {a}');
  assert.deepEqual(t.slots, ['a']);
});

test('2.4 template: a slot naming a confirm, a bucket set or a template is a warning too', () => {
  const src = lines(
    'ask a | A',
    'confirm c | C',
    'bucket b | X, Y',
    'b: i | X',
    'template t | T',
    FENCE,
    '{a} {c} {b}',
    FENCE,
    'export json',
  );
  assert.deepEqual(diags(src), ['warning:template-slot@7', 'warning:template-slot@7']);
  assert.deepEqual(
    parse(src).diagnostics.map((d) => (d.detail as { slot: string }).slot),
    ['c', 'b'],
  );
  assert.deepEqual(only<TemplateBlock>(src, 'template')[0].slots, ['a']);
});

test('2.4 template: braces that are not {name} are literal text, and a JSON body keeps its inner slot', () => {
  const src = lines(
    'param press | P | 1 0 2 1',
    'template j | JSON',
    `${FENCE}json`,
    '{"press": {press}, "list": [{}], "n": {"a": 1}}',
    FENCE,
    'export json',
  );
  const [t] = only<TemplateBlock>(src, 'template');
  assert.deepEqual(t.slots, ['press']);
  assert.equal(t.body, '{"press": {press}, "list": [{}], "n": {"a": 1}}');
  assert.deepEqual(diags(src), []);
  // {{x}} has no escape: the inner {x} is a slot when x is a field, and a warned literal when it is not.
  const lit = lines('ask x | X', 'template t | T', FENCE, '{{x}} and {{y}}', FENCE, 'export json');
  assert.deepEqual(only<TemplateBlock>(lit, 'template')[0].slots, ['x']);
  assert.deepEqual(diags(lit), ['warning:template-slot@4']);
});

test('2.4 template: a body with no slot is W template-empty', () => {
  const src = lines('ask a | A', 'template t | T', FENCE, 'nothing to fill', FENCE, 'export json');
  assert.deepEqual(diags(src), ['warning:template-empty@2']);
  assert.deepEqual(parse(src).diagnostics[0].detail, { name: 't' });
  assert.deepEqual(only<TemplateBlock>(src, 'template')[0].slots, []);
});

test('2.4 template: the block is emitted when the fence closes; an unclosed fence closes as fences do', () => {
  const src = lines('ask a | A', 'template t | T', FENCE, '{a}', 'last line, never closed');
  assert.deepEqual(diags(src), ['warning:unclosed-fence@3', 'warning:export-missing@1']);
  assert.equal(only<TemplateBlock>(src, 'template')[0].body, '{a}\nlast line, never closed');
  // The fence is indented the way code fences are: the common indentation goes.
  const ind = lines('ask a | A', 'template t | T', `  ${FENCE}`, '    {a}', '      x', `  ${FENCE}`);
  assert.equal(only<TemplateBlock>(ind, 'template')[0].body, '{a}\n  x');
});

// ---------------------------------------------------------------- Req 2.5 preset

const PRESET_BASE = lines(
  'ask note | Note',
  'choose easing | ease-out, spring',
  'param press | P | 0.94 0.85 1 0.01',
  'toggle express | E',
);

test('2.5 preset: key=value pairs split on ;, the first = splits key from value, and the value runs to the next ;', () => {
  const src = `${PRESET_BASE}\npreset snappy | Snappy | press=0.96; easing=spring; express=on; note=Ship it\nexport json`;
  assert.deepEqual(only<PresetBlock>(src, 'preset')[0], {
    type: 'preset',
    name: 'snappy',
    text: 'Snappy',
    values: [
      { name: 'press', value: '0.96' },
      { name: 'easing', value: 'spring' },
      { name: 'express', value: 'on' },
      { name: 'note', value: 'Ship it' },
    ],
    line: 5,
  });
  assert.deepEqual(diags(src), []);
  // A param value is stored as the number it reads as.
  assert.deepEqual(only<PresetBlock>(`${PRESET_BASE}\npreset p | P | press=0.90x\nexport json`, 'preset')[0].values, [
    { name: 'press', value: '0.9' },
  ]);
});

test('2.5 preset: an ask value may hold = and (quoted) ; and |', () => {
  const src = `${PRESET_BASE}\npreset p | P | note=a=b\npreset q | Q | note="x; y | z = w"\npreset r | R | note=a | b\nexport json`;
  assert.deepEqual(diags(src), []);
  const [p, q, r] = only<PresetBlock>(src, 'preset');
  assert.deepEqual(p.values, [{ name: 'note', value: 'a=b' }]);
  assert.deepEqual(q.values, [{ name: 'note', value: 'x; y | z = w' }]);
  assert.deepEqual(r.values, [{ name: 'note', value: 'a | b' }]);
});

test('2.5 preset: a key is a fillable field declared above (E preset-key); a bucket, template, preset or confirm is not', () => {
  const base = lines(
    'ask who | Who?',
    'confirm sure | Sure?',
    'bucket b | X, Y',
    'b: i | X',
    'template t | T',
    FENCE,
    '{who}',
    FENCE,
    'preset q | Q | who=x',
  );
  for (const key of ['nope', 'sure', 'b', 't', 'q'])
    assert.deepEqual(errs(`${base}\npreset p | P | ${key}=x\nexport json`), ['error:preset-key@10'], key);
  assert.deepEqual(detail(`${base}\npreset p | P | nope=x\nexport json`, 'preset-key'), { key: 'nope', fields: ['who'] });
  // A key declared below the preset is not declared above it.
  assert.deepEqual(errs('preset p | P | later=x\nask later | L\nexport json'), ['error:preset-key@1']);
});

test('2.5 preset: values are valid for their field (E preset-value): an option, on or off, a number on the grid, any text', () => {
  const bad = (v: string) => errs(`${PRESET_BASE}\npreset p | P | ${v}\nexport json`);
  assert.deepEqual(bad('easing=linear'), ['error:preset-value@5']);
  assert.deepEqual(bad('express=yes'), ['error:preset-value@5']);
  assert.deepEqual(bad('express=ON'), ['error:preset-value@5']);
  assert.deepEqual(bad('press=1.5'), ['error:preset-value@5']);
  assert.deepEqual(bad('press=0.8'), ['error:preset-value@5']);
  assert.deepEqual(bad('press=0.945'), ['error:preset-value@5']);
  assert.deepEqual(bad('press=fast'), ['error:preset-value@5']);
  assert.deepEqual(bad('press='), ['error:preset-value@5']);
  assert.deepEqual(bad('note=anything at all'), []);
  assert.deepEqual(bad('note='), []);
  assert.deepEqual(bad('press=0.85; press=1'), ['warning:question-option@5']);
  assert.deepEqual(detail(`${PRESET_BASE}\npreset p | P | press=0.945\nexport json`, 'preset-value'), {
    key: 'press',
    value: '0.945',
    kind: 'param',
  });
  assert.deepEqual(detail(`${PRESET_BASE}\npreset p | P | easing=zzz\nexport json`, 'preset-value'), {
    key: 'easing',
    value: 'zzz',
    kind: 'choose',
  });
});

test('2.5 preset: one bad assignment makes no block and takes no name', () => {
  const src = `${PRESET_BASE}\npreset p | P | note=ok; press=2\npreset p | P again | note=ok\nexport json`;
  assert.deepEqual(errs(src), ['error:preset-value@5']);
  assert.equal(only<PresetBlock>(src, 'preset').length, 1);
});

test('2.5 preset: the name shares the registry with every field', () => {
  assert.deepEqual(errs('ask a | A\npreset a | P | a=x\nexport json'), ['error:question-dup@2']);
  assert.deepEqual(errs('ask a | A\npreset p | P | a=x\nask p | Reuse\nexport json'), ['error:question-dup@3']);
  assert.deepEqual(errs('ask a | A\npreset p | P | a=x\npreset p | P2 | a=y\nexport json'), ['error:question-dup@3']);
});

// ---------------------------------------------------------------- Req 2.6 export prompt

test('2.6 export prompt is a third format; any other word is E export-format naming all three', () => {
  assert.deepEqual(only<ExportBlock>('ask a | A\nexport prompt', 'export')[0], { type: 'export', format: 'prompt', line: 2 });
  assert.deepEqual(diags('ask a | A\nexport prompt\nexport prompt'), ['warning:export-dup@3']);
  const doc = parse('ask a | A\nexport promt');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.detail]),
    [
      ['export-format', { format: 'promt' }],
      ['export-missing', { fields: 1 }],
    ],
  );
  assert.match(doc.diagnostics[0].message, /json.*markdown.*prompt/);
});

// ---------------------------------------------------------------- Req 2.7 the shape rule and the registry

const PROSE = [
  'toggle the flag on Monday',
  'bucket the tickets by owner',
  'preset values are listed below',
  'param names are lowercase',
  'template files live here',
];

test('2.7 shape rule: a line that starts with one of the five words without the shape is prose', () => {
  for (const line of PROSE) {
    const doc = parse(line);
    assert.deepEqual(
      doc.blocks.map((b) => b.type),
      ['paragraph'],
      line,
    );
    assert.deepEqual(doc.diagnostics, [], line);
  }
  // More prose that must stay prose: no second token, a second token that is not followed by |, a name that is not a name.
  for (const line of [
    'toggle',
    'bucket',
    'param',
    'template',
    'preset',
    'toggle on the switch',
    'toggle needs=x | L',
    'param 9x | L | 1 0 2 1',
    'bucket a.b | X, Y',
  ])
    assert.deepEqual(kinds(line), ['paragraph'], line);
  // Capitalised words and an escaped line are prose, as for the question words.
  assert.deepEqual(kinds('Toggle x | L\n\nParam x | L'), ['paragraph', 'paragraph']);
  assert.deepEqual(kinds('\\toggle x | L'), ['paragraph']);
});

test('2.7 shape rule: the shape is a name followed by |, or by unit= for param, or by on, off or needs= for toggle', () => {
  const ok: [string, string][] = [
    ['param a | L | 1 0 2 1', 'param'],
    ['param a| L | 1 0 2 1', 'param'],
    ['param a unit=x | L | 1 0 2 1', 'param'],
    ['toggle a | L', 'toggle'],
    ['toggle a on | L', 'toggle'],
    ['toggle a off | L', 'toggle'],
    ['toggle a needs=b | L', 'toggle'],
    ['toggle on | L', 'toggle'],
    ['bucket a | X, Y', 'bucket'],
    ['ask x | X\npreset a | L | x=1', 'preset'],
    [`template a | L\n${FENCE}\nbody\n${FENCE}`, 'template'],
  ];
  for (const [src, type] of ok) {
    assert.ok(
      blocks(src).some((b) => b.type === type),
      src,
    );
    assert.ok(!kinds(src).includes('paragraph'), src);
  }
});

test('2.7 shape rule: a line with the shape that is malformed after it fails loudly', () => {
  for (const line of [
    'toggle dark on',
    'toggle dark off',
    'toggle dark needs=x',
    'param x | Label | 1 2',
    'param x | Label',
    'preset p | Label',
    'template t |',
    'toggle t |',
    'preset p | | a=1',
  ])
    assert.ok(
      errs(line).some((d) => d.startsWith('error:')),
      line,
    );
  assert.deepEqual(diags('toggle dark on'), ['error:question-syntax@1']);
  assert.deepEqual(detail('toggle dark on', 'question-syntax'), { word: 'toggle' });
});

test('2.7 names: a param, toggle, bucket, template or preset named like an ask is question-dup, either way round', () => {
  for (const line of [
    'param a | A | 1 0 2 1',
    'toggle a | A',
    'bucket a | X, Y',
    `template a | A\n${FENCE}\n{a}\n${FENCE}`,
    'preset a | A | a=x',
  ]) {
    assert.deepEqual(errs(`ask a | First\n${line}\nexport json`), ['error:question-dup@2'], line);
    assert.deepEqual(detail(`ask a | First\n${line}\nexport json`, 'question-dup'), { name: 'a', first: 1 }, line);
  }
  assert.deepEqual(errs('param a | A | 1 0 2 1\nask a | Second\nexport json'), ['error:question-dup@2']);
  assert.deepEqual(errs('toggle a | A\nchoose a | x, y\nexport json'), ['error:question-dup@2']);
  assert.deepEqual(errs('bucket a | X, Y\na: i | X\nconfirm a | C\nexport json'), ['error:question-dup@3']);
});

test('2.7 names: a line with an error makes no block and takes no name', () => {
  assert.deepEqual(errs('toggle a on\nask a | A\nexport json'), ['error:question-syntax@1']);
  assert.deepEqual(errs('bucket a | only\nask a | A\nexport json'), ['error:bucket-names@1']);
});

// ---------------------------------------------------------------- fields, presets, export warnings

test('fieldsOf returns the seven field kinds in source order, inside cards and grids too; presetsOf returns the presets', () => {
  const src = lines(
    'ask a | A',
    'param p | P | 1 0 2 1',
    'cards',
    '### One',
    'toggle t | T',
    '### Two',
    'bucket b | X, Y',
    'b: i | X',
    'grid 1',
    'confirm c | C',
    'choose d | x, y',
    'template tpl | T',
    FENCE,
    '{a}',
    FENCE,
    'preset s | S | a=x',
    'export json',
  );
  const doc = parse(src);
  assert.deepEqual(
    fieldsOf(doc.blocks).map((f) => `${f.type}:${f.name}`),
    ['ask:a', 'param:p', 'toggle:t', 'bucket:b', 'confirm:c', 'choose:d', 'template:tpl'],
  );
  assert.deepEqual(
    core.presetsOf(doc.blocks).map((p) => p.name),
    ['s'],
  );
});

test('a preset is not a field: it does not stop export-orphan, and a page of fields still needs an export', () => {
  assert.deepEqual(diags('toggle a | A'), ['warning:export-missing@1']);
  assert.deepEqual(detail('toggle a | A\nbucket b | X, Y\nb: i | X', 'export-missing'), { fields: 2 });
  assert.deepEqual(diags('export prompt'), ['warning:export-orphan@1']);
  assert.deepEqual(detail('ask a | A\npreset p | P | a=x', 'export-missing'), { fields: 1 });
});

test('every code carries the detail keys the spec lists', () => {
  const want: [string, string, string[]][] = [
    ['param a | A | 1 2 1 1', 'param-range', ['value', 'min', 'max', 'step', 'rule']],
    ['toggle a needs=b | A', 'toggle-needs', ['name', 'needs', 'toggles']],
    ['bucket a | x', 'bucket-names', ['count', 'empty', 'dup', 'reserved']],
    ['bucket a | x, y\na: i | z', 'bucket-unknown', ['bucket', 'buckets']],
    ['bucket a | x, y\na: i', 'bucket-item', ['name']],
    ['bucket a | x, y\na: i | x\na: i | y', 'bucket-dup-item', ['text', 'first']],
    ['bucket a | x, y', 'bucket-empty', ['name']],
    ['template a | A', 'template-fence', ['name']],
    [`ask b | B\ntemplate a | A\n${FENCE}\n{zz}\n${FENCE}`, 'template-slot', ['slot', 'fields']],
    [`ask b | B\ntemplate a | A\n${FENCE}\nx\n${FENCE}`, 'template-empty', ['name']],
    ['preset a | A | zz=1', 'preset-key', ['key', 'fields']],
    ['ask b | B\npreset a | A | b=1\nchoose c | x, y\npreset d | D | c=z', 'preset-value', ['key', 'value', 'kind']],
    ['ask b | B\nexport zz', 'export-format', ['format']],
  ];
  for (const [src, code, keys] of want) {
    const d = parse(src).diagnostics.find((x) => x.code === code);
    assert.ok(d, `${code} is reported`);
    assert.deepEqual(Object.keys(d.detail ?? {}).toSorted(), keys.toSorted(), code);
  }
});
