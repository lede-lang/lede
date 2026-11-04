// Question words (spec §4.18, D64): ask, choose, confirm and export. Ordinary parsing, in both build modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LedeStream,
  fieldsOf,
  parse,
  type AskBlock,
  type Block,
  type ChooseBlock,
  type ConfirmBlock,
  type ExportBlock,
} from '../src/index.ts';

const diags = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);
/** Diagnostics other than the whole-page export warnings, which depend on what else is on the page. */
const errs = (src: string) => diags(src).filter((d) => !/export-(orphan|missing)/.test(d));
const blocks = (src: string): Block[] => parse(src).blocks;
const only = <T extends Block>(src: string, type: T['type']): T[] => blocks(src).filter((b): b is T => b.type === type);

test('the press-release page parses as written', () => {
  const doc = parse(
    [
      '# Release 4.2 go/no-go',
      'ask owner | Who signs off on this release?',
      'choose risk | low, medium, high',
      'confirm migration | The migration ran on staging and rolled back cleanly',
      'confirm oncall | On-call for the release window is staffed',
      'ask notes lines=4 | Anything the release notes should carry?',
      'export json',
    ].join('\n'),
  );
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['heading', 'ask', 'choose', 'confirm', 'confirm', 'ask', 'export'],
  );
  assert.deepEqual(doc.blocks[1], { type: 'ask', name: 'owner', text: 'Who signs off on this release?', lines: 1, line: 2 });
  assert.deepEqual(doc.blocks[2], { type: 'choose', name: 'risk', text: null, options: ['low', 'medium', 'high'], line: 3 });
  assert.deepEqual(doc.blocks[5], { type: 'ask', name: 'notes', text: 'Anything the release notes should carry?', lines: 4, line: 6 });
  assert.deepEqual(doc.blocks[6], { type: 'export', format: 'json', line: 7 });
});

test('choose takes an optional question as a third field; confirm text may hold a pipe', () => {
  const [c] = only<ChooseBlock>('choose size | S, M, L | How big?', 'choose');
  assert.equal(c.text, 'How big?');
  const [k] = only<ConfirmBlock>('confirm ok | Is a | b fine?', 'confirm');
  assert.equal(k.text, 'Is a | b fine?');
});

test('export: bare is markdown, json and markdown are named, longer lines are prose, a lone odd word is an error', () => {
  assert.equal(only<ExportBlock>('ask a | q\nexport', 'export')[0].format, 'markdown');
  assert.equal(only<ExportBlock>('ask a | q\nexport markdown', 'export')[0].format, 'markdown');
  const prose = parse('export the data to a file');
  assert.deepEqual(
    prose.blocks.map((b) => b.type),
    ['paragraph'],
  );
  assert.deepEqual(diags('ask a | q\nexport data'), ['error:export-format@2', 'warning:export-missing@1']);
  assert.deepEqual(diags('ask a | q\nexport JSON'), ['error:export-format@2', 'warning:export-missing@1']);
});

test('capitalised words are prose', () => {
  assert.deepEqual(
    blocks('Ask the team\n\nChoose a plan\n\nConfirm it\n\nExport it').map((b) => b.type),
    ['paragraph', 'paragraph', 'paragraph', 'paragraph'],
  );
  assert.deepEqual(diags('Ask the team'), []);
});

test('a lowercase prose line that starts with a question word is an error, and \\ makes it prose', () => {
  assert.deepEqual(diags('ask the team about it'), ['error:question-syntax@1']);
  assert.deepEqual(diags('choose wisely'), ['error:question-syntax@1']);
  assert.deepEqual(diags('ask'), ['error:question-syntax@1']);
  assert.deepEqual(diags('\\ask the team about it'), []);
  assert.deepEqual(
    blocks('\\ask the team').map((b) => b.type),
    ['paragraph'],
  );
});

test('names: identifiers only, unique, and an erroring line yields no block', () => {
  assert.deepEqual(errs('ask 9lives | q\nask a b | q'), ['error:question-name@1', 'warning:question-option@2']);
  assert.equal(only<AskBlock>('ask 9lives | q', 'ask').length, 0);
  const doc = parse('ask who | first\nask who | second\nchoose who | a, b');
  assert.deepEqual(
    doc.diagnostics.map((d) => `${d.code}@${d.line}`),
    ['question-dup@2', 'question-dup@3', 'export-missing@1'],
  );
  assert.deepEqual(doc.diagnostics[0].detail, { name: 'who', first: 1 });
  assert.equal(only<AskBlock>('ask who | first\nask who | second', 'ask')[0].text, 'first');
  assert.equal(doc.blocks.length, 1);
});

test('names that are Object.prototype members are ordinary names', () => {
  assert.deepEqual(
    only<AskBlock>('ask constructor | a\nask toString | b\nask hasOwnProperty | c\nask __proto__ | d\nexport', 'ask').map((b) => b.name),
    ['constructor', 'toString', 'hasOwnProperty'],
  );
  assert.deepEqual(errs('ask __proto__ | d'), ['error:question-name@1']);
});

test('ask lines=: 1 to 12', () => {
  for (const n of ['1', '2', '12']) assert.equal(only<AskBlock>(`ask a lines=${n} | q`, 'ask')[0].lines, Number(n));
  for (const n of ['0', '13', 'abc', '2.5']) assert.deepEqual(errs(`ask a lines=${n} | q\nexport`), ['error:ask-lines@1']);
});

test('ask and confirm need text; unknown options and stray words warn and are ignored', () => {
  assert.deepEqual(errs('ask a |\nexport'), ['error:question-syntax@1']);
  assert.deepEqual(diags('ask a | q\nexport'), []);
  assert.deepEqual(errs('ask a color=red | q\nexport'), ['warning:question-option@1']);
  assert.deepEqual(errs('confirm a extra | q\nexport'), ['warning:question-option@1']);
  assert.equal(only<AskBlock>('ask a color=red | q', 'ask').length, 1);
});

test('choose options split on , and ;, honour data-cell quotes, and keep a pipe inside quotes', () => {
  assert.deepEqual(only<ChooseBlock>('choose a | x, y; z', 'choose')[0].options, ['x', 'y', 'z']);
  const q = only<ChooseBlock>('choose a | "p,q", "r;s", "t|u" | Which?', 'choose')[0];
  assert.deepEqual(q.options, ['p,q', 'r;s', 't|u']);
  assert.equal(q.text, 'Which?');
  const inch = only<ChooseBlock>('choose a | 12" pipe, 3" tube | Which?', 'choose')[0];
  assert.deepEqual(inch.options, ['12" pipe', '3" tube']);
  assert.equal(inch.text, 'Which?');
});

test('choose errors: too few, empty, reserved, unclosed quote, repeats', () => {
  assert.deepEqual(errs('choose a | only\nexport'), ['error:choose-options@1']);
  assert.deepEqual(errs('choose a |\nexport'), ['error:choose-options@1']);
  assert.deepEqual(errs('choose a | x,,y\nexport'), ['error:choose-options@1']);
  assert.deepEqual(errs('choose a | x, y,\nexport'), ['error:choose-options@1']);
  assert.deepEqual(errs('choose a | x, (not chosen)\nexport'), ['error:choose-options@1']);
  assert.deepEqual(errs('choose a | "x, y\nexport'), ['error:csv-quote@1', 'error:choose-options@1']);
  assert.deepEqual(errs('choose a | x, x, y\nexport'), ['warning:choose-dup-option@1']);
  assert.deepEqual(only<ChooseBlock>('choose a | x, x, y', 'choose')[0].options, ['x', 'y']);
  assert.deepEqual(errs('choose a | x, x\nexport'), ['warning:choose-dup-option@1', 'error:choose-options@1']);
  const d = parse('choose a | x, x\nexport').diagnostics.find((e) => e.code === 'choose-options')!;
  assert.deepEqual(d.detail, { count: 1, empty: false, reserved: false });
});

test('export warnings: orphan, missing, repeated', () => {
  assert.deepEqual(diags('export json'), ['warning:export-orphan@1']);
  assert.deepEqual(diags('ask a | q\nask b | r'), ['warning:export-missing@1']);
  assert.deepEqual(parse('ask a | q\nask b | r').diagnostics[0].detail, { fields: 2 });
  assert.deepEqual(diags('ask a | q\nexport json\nexport json'), ['warning:export-dup@3']);
  assert.deepEqual(diags('ask a | q\nexport json\nexport markdown'), []);
});

test('fields inside cards and grid are found, in source order', () => {
  const doc = parse(
    [
      'ask first | one',
      'cards',
      '### Card',
      'confirm second | two',
      '---',
      'grid 2',
      'ask third | three',
      'choose fourth | a, b',
      'export',
    ].join('\n'),
  );
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(
    fieldsOf(doc.blocks).map((f) => f.name),
    ['first', 'second', 'third', 'fourth'],
  );
});

test('a diagram cannot be named like a question word', () => {
  for (const w of ['ask', 'choose', 'confirm', 'export']) assert.deepEqual(diags(`diagram ${w}`), ['error:diagram-name@1']);
});

test('a streamed document gives the same blocks as the whole text, and any prefix snapshot is valid', () => {
  const src = 'ask a | q\nchoose b | x, y\nconfirm c | s\nexport json\n';
  const stream = new LedeStream();
  for (const ch of src) stream.write(ch);
  assert.deepEqual(stream.end().blocks, parse(src).blocks);
  const partial = new LedeStream();
  partial.write('ask a | q\nchoose b | x, y\n');
  assert.deepEqual(
    partial.snapshot().blocks.map((b) => b.type),
    ['ask', 'choose'],
  );
  assert.deepEqual(
    partial.snapshot().diagnostics.map((d) => d.code),
    ['export-missing'],
  );
});
