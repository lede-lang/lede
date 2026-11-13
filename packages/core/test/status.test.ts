// D80: `@status Word=tone, ...` gives a page its own status words (spec §4.3). The parser keeps the valid entries in `meta.status`, and
// `readStatus` reads them back, so what the parser warns about is what the renderer drops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, META_KEYS, STATUS_TONES, parse, readStatus, statusKey } from '../src/index.ts';

const diags = (src: string) => parse(src).diagnostics;

test('@status is a known meta key, and its entries are stored in order as normalized text', () => {
  assert.ok(META_KEYS.includes('status'));
  const doc = parse('@status Shipped=good, Parked = neutral,  Needs   review=WARN ,\n@status Escalated=bad\n# T');
  assert.deepEqual(doc.diagnostics, []);
  assert.equal(doc.meta.status, 'Shipped=good, Parked=neutral, Needs review=warn, Escalated=bad');
  assert.deepEqual(readStatus(doc.meta.status).entries, [
    ['Shipped', 'good'],
    ['Parked', 'neutral'],
    ['Needs review', 'warn'],
    ['Escalated', 'bad'],
  ]);
});

test("the five tones are the renderer's", () => {
  assert.deepEqual([...STATUS_TONES], ['good', 'warn', 'bad', 'info', 'neutral']);
  for (const tone of STATUS_TONES) assert.deepEqual(readStatus(`Word=${tone}`).entries, [['Word', tone]]);
});

test('a word may hold an equals sign: the tone follows the last one', () => {
  assert.deepEqual(readStatus('a=b=good').entries, [['a=b', 'good']]);
});

test('status words match like the built-in lexicon: case-insensitive, spaces collapsed', () => {
  assert.equal(statusKey('  Needs   REVIEW '), 'needs review');
});

test('an entry with no word or a tone that is no tone is W status-value and left out; the rest still count', () => {
  const doc = parse('@status Shipped=good, bad=oops, =good, nope, Late=\n# T');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.severity, d.code, d.line, d.col, d.detail]),
    [
      ['warning', 'status-value', 1, 1, { word: 'bad', tone: 'oops', allowed: [...STATUS_TONES] }],
      ['warning', 'status-value', 1, 1, { word: '', tone: 'good', allowed: [...STATUS_TONES] }],
      ['warning', 'status-value', 1, 1, { word: 'nope', tone: '', allowed: [...STATUS_TONES] }],
      ['warning', 'status-value', 1, 1, { word: 'Late', tone: '', allowed: [...STATUS_TONES] }],
    ],
  );
  assert.equal(doc.meta.status, 'Shipped=good');
});

test('an empty @status is one W status-value and stores nothing', () => {
  const doc = parse('@status\n# T');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.detail]),
    [['status-value', { word: '', tone: '', allowed: [...STATUS_TONES] }]],
  );
  assert.equal(doc.meta.status, undefined);
});

test('a trailing comma is not an entry', () => {
  assert.deepEqual(diags('@status A=good,\n# T'), []);
});

test('a status word that no line defines leaves meta.status unset, and a later line adds to an earlier one', () => {
  assert.equal(parse('# T').meta.status, undefined);
  assert.equal(parse('@status A=good\n# T\n@status B=bad').meta.status, 'A=good, B=bad');
});

test('streaming: @status read line by line, in chunks of one character, equals the whole parse', () => {
  const src = '@status Shipped=good, nope\n@status Parked=neutral\n\n# T\n\ntable = a,b; Shipped,Parked\n';
  const s = new LedeStream();
  for (const ch of src) s.write(ch);
  const doc = s.end();
  const whole = parse(src);
  assert.deepEqual(doc.meta, whole.meta);
  assert.deepEqual(doc.diagnostics, whole.diagnostics);
  assert.equal(doc.meta.status, 'Shipped=good, Parked=neutral');
});
