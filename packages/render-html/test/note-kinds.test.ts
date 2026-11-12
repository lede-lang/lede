// D80: the kind of a `!` note is its label and sets its tone (spec §4.7): recommendation, decision and success are green, tip, info,
// example and question blue. `!!` and `!!!` keep their severity, and the bold-phrase title still works after a kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { drive, normalize } from '../../../bench/src/incremental-model.ts';

const asides = async (src: string) => [...(await compile(src)).html.matchAll(/<aside [^>]*>.*?<\/aside>/g)].map((m) => m[0]);
const one = async (src: string) => {
  const found = await asides(src);
  assert.equal(found.length, 1, src);
  return found[0];
};

test('a kind is the label, in the words the writer used, and sets the tone', async () => {
  assert.equal(
    await one('! Recommendation: Use SQS.'),
    '<aside class="note good" role="note"><b class="nl">Recommendation</b>Use SQS.</aside>',
  );
  assert.equal(await one('! recommended: Use SQS.'), '<aside class="note good" role="note"><b class="nl">Recommended</b>Use SQS.</aside>');
  assert.equal(await one('! TIP: Use FIFO.'), '<aside class="note info" role="note"><b class="nl">Tip</b>Use FIFO.</aside>');
  for (const [word, tone] of [
    ['Decision', 'good'],
    ['Success', 'good'],
    ['Done', 'good'],
    ['Info', 'info'],
    ['Question', 'info'],
    ['Example', 'info'],
  ])
    assert.equal(await one(`! ${word}: x`), `<aside class="note ${tone}" role="note"><b class="nl">${word}</b>x</aside>`, word);
});

test('a plain note is as before, and so is a bold-phrase title; after a kind the label stays visible beside the title', async () => {
  assert.equal(await one('! Plain note.'), '<aside class="note note" role="note"><b class="nl">Note</b>Plain note.</aside>');
  assert.equal(
    await one('! **Heads up.** Plain.'),
    '<aside class="note note titled" role="note"><span class="sr">Note: </span><strong class="nt">Heads up.</strong> Plain.</aside>',
  );
  assert.equal(
    await one('! Tip: **Use FIFO.** Ordering is kept per group.'),
    '<aside class="note info titled" role="note"><b class="nl">Tip</b><strong class="nt">Use FIFO.</strong> Ordering is kept per group.</aside>',
  );
});

test('!! and !!! keep their severity and their label whatever word opens them', async () => {
  assert.equal(await one('!! Tip: a'), '<aside class="note warn" role="note"><b class="nl">Warning</b>Tip: a</aside>');
  assert.equal(await one('!!! Decision: b'), '<aside class="note danger" role="note"><b class="nl">Critical</b>Decision: b</aside>');
});

test('! Warning: is a plain note, with the warning pointing at !!', async () => {
  const { html, doc } = await compile('! Warning: do not.');
  assert.match(html, /<aside class="note note" role="note"><b class="nl">Note<\/b>Warning: do not\.<\/aside>/);
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code),
    ['note-kind'],
  );
});

test('a kind label is text, never markup: a hand-made AST with a hostile kind is escaped and takes no tone', async () => {
  const doc = parse('! x');
  const note = doc.blocks[0];
  assert.equal(note.type, 'note');
  if (note.type === 'note') note.kind = '<img src=x onerror=alert(1)>';
  const html = await render(doc, { fragment: true });
  assert.ok(html.includes('<b class="nl">&lt;img src=x onerror=alert(1)&gt;</b>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('class="note note"'));
  if (note.type === 'note') note.kind = 'constructor';
  assert.ok((await render(doc, { fragment: true })).includes('class="note note"'), 'a word that only an object would inherit is no kind');
});

test('a recommendation note still names the pick of the table it sits beside', async () => {
  const src = 'table = Option,Cost; SQS,5; Kafka,9; Rabbit,7\n\n! Recommendation: SQS\n';
  assert.match((await compile(src)).html, /<tr class="hl pick">/);
  const plain = 'table = Option,Cost; SQS,5; Kafka,9; Rabbit,7\n\n! Choose SQS\n';
  assert.match((await compile(plain)).html, /<tr class="hl pick">/);
});

test('the green note has its own tones in light and dark, and inside a recommendation card', async () => {
  const { html } = await compile('# Page');
  assert.match(html, /\.note\.good\{background:var\(--good-bg\);[^}]*border-left-color:var\(--good\)\}/);
  assert.match(html, /\.note\.good b\.nl\{color:var\(--good\)\}/);
  assert.match(html, /\.card\.lc\.rec>\.note\.good\{/);
});

test('streaming: notes with kinds equal the whole-page render before any settle, at chunks of 1, 7 and 64 bytes', async () => {
  const src = '# Queue\n\n! Recommendation: **Use SQS.** Cheap.\n\n! Tip: FIFO.\n\n! Warning: x\n\n!! Tip: y\n';
  const expected = normalize(await render(parse(src), { fragment: true }));
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, settle: false });
    assert.equal(normalize(d.model.main()), expected, `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
  }
});
