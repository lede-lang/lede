// A flow diagram's `dir` and whether the writer gave one (`dirExplicit`, D80): the renderer may choose a direction for a diagram
// that has none, and never for one that does. The key is in the AST only when it is true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, parse, type DiagramBlock } from '../src/index.ts';

const SRC = [
  'diagram plain',
  'plain: x -> y',
  'diagram tb dir=TB',
  'tb: x -> y',
  'diagram rl dir=rl',
  'rl: x -> y',
  'diagram bad dir=sideways',
  'bad: x -> y',
  'diagram seq sequence',
  'seq: x -> y : hi',
  'diagram seqlr sequence dir=LR',
  'seqlr: x -> y : hi',
  '',
].join('\n');

const diagrams = (blocks: ReturnType<typeof parse>['blocks']): DiagramBlock[] => blocks.filter((b) => b.type === 'diagram');
const summary = (ds: DiagramBlock[]) => ds.map((d) => [d.name, d.dir, 'dirExplicit' in d ? d.dirExplicit : 'omitted']);

test('dirExplicit is true only for a valid dir= the writer gave; otherwise the key is not there', () => {
  const doc = parse(SRC);
  assert.deepEqual(summary(diagrams(doc.blocks)), [
    ['plain', 'TB', 'omitted'],
    ['tb', 'TB', true],
    ['rl', 'RL', true],
    // A value that is not a direction is W diagram-option and the default applies, so the renderer may still choose.
    ['bad', 'TB', 'omitted'],
    ['seq', 'LR', 'omitted'],
    ['seqlr', 'LR', true],
  ]);
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.line]),
    [['diagram-option', 7]],
  );
});

test('a streamed document has the same dirExplicit as the parse, at any chunk size', () => {
  const want = summary(diagrams(parse(SRC).blocks));
  for (const k of [1, 5, 64]) {
    const s = new LedeStream();
    for (let i = 0; i < SRC.length; i += k) s.write(SRC.slice(i, i + k));
    assert.deepEqual(summary(diagrams(s.end().blocks)), want, `chunks of ${k}`);
  }
});
