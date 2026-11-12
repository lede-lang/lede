// D80: a `!` note whose first word, followed by `:`, is a kind word takes that kind (spec §4.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, NOTE_KINDS, parse, type NoteBlock } from '../src/index.ts';

const notes = (src: string) => parse(src).blocks.filter((b): b is NoteBlock => b.type === 'note');

test('the kind words, and the tone each sets', () => {
  assert.deepEqual(
    [...NOTE_KINDS],
    [
      ['tip', 'info'],
      ['recommendation', 'good'],
      ['recommended', 'good'],
      ['decision', 'good'],
      ['success', 'good'],
      ['done', 'good'],
      ['info', 'info'],
      ['question', 'info'],
      ['example', 'info'],
    ],
  );
});

test('a ! note with a kind word keeps the word as its kind, capitalized, and the text after it', () => {
  const [n] = notes('! Recommendation: Use SQS.');
  assert.deepEqual(n, { type: 'note', tone: 'note', kind: 'Recommendation', text: 'Use SQS.', line: 1 });
});

test('kind words match case-insensitively, and the kind is the word as written with a capital', () => {
  assert.deepEqual(
    notes('! TIP: a\n! recommended: b\n! Done:c\n! eXaMpLe:   d').map((n) => [n.kind, n.text]),
    [
      ['Tip', 'a'],
      ['Recommended', 'b'],
      ['Done', 'c'],
      ['Example', 'd'],
    ],
  );
});

test('a bold phrase after the kind word is still the note title', () => {
  assert.deepEqual(
    notes('! Tip: **Use SQS.** It is cheaper.').map((n) => [n.kind, n.text]),
    [['Tip', '**Use SQS.** It is cheaper.']],
  );
});

test('!! and !!! are not changed by a kind word: no kind, the text stays whole', () => {
  assert.deepEqual(
    notes('!! Tip: a\n!!! Decision: b').map((n) => [n.tone, n.kind, n.text]),
    [
      ['warn', undefined, 'Tip: a'],
      ['danger', undefined, 'Decision: b'],
    ],
  );
});

test('a word that is not a kind, a kind with no colon, or a colon with nothing after it is a plain note', () => {
  for (const text of ['Note: a', 'Tip a', 'Tip:', 'Tips: a', 'The tip: a', 'constructor: a', 'Tip : a'])
    assert.deepEqual(
      notes(`! ${text}`).map((n) => [n.kind, n.text]),
      [[undefined, text]],
      text,
    );
});

test('! Warning: is W note-kind, pointing at !!, and stays a plain note', () => {
  const doc = parse('# T\n\n! warning: Do not.');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.severity, d.code, d.line, d.col, d.detail]),
    [['warning', 'note-kind', 3, 3, { word: 'warning', use: '!!' }]],
  );
  const [n] = notes('! Warning: Do not.');
  assert.deepEqual([n.tone, n.kind, n.text], ['note', undefined, 'Warning: Do not.']);
  assert.deepEqual(parse('!! Warning: Do not.').diagnostics, [], 'the severity form is not a mistake');
});

test('streaming: notes with kinds read in chunks of one character equal the whole parse', () => {
  const src = '! Recommendation: **Use SQS.** Cheap.\n! Warning: x\n!! Tip: y\n! Example: z\n';
  const s = new LedeStream();
  const emitted: unknown[] = [];
  for (const ch of src) emitted.push(...s.write(ch));
  const doc = s.end();
  const whole = parse(src);
  assert.deepEqual(doc.blocks, whole.blocks);
  assert.deepEqual(doc.diagnostics, whole.diagnostics);
  assert.deepEqual(emitted, whole.blocks.slice(0, emitted.length));
});
