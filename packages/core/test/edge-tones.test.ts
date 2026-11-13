// Edge tones (spec §4.17, D80): the last ` | ` field of an edge or message line is one of good, bad, warn, info, neutral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, parse, type DiagramBlock } from '../src/index.ts';

const flow = (...lines: string[]) => `diagram f\n${lines.map((l) => `f: ${l}`).join('\n')}\n`;
const edges = (src: string) => {
  const d = parse(src).blocks.find((b): b is DiagramBlock => b.type === 'diagram')!;
  return d.edges.map((e) => [e.from, e.to, e.label, e.tone ?? null]);
};
const codes = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);

test('the last field names the tone, with or without a label', () => {
  const src = flow('a -> b : allow | good', 'a -x- b : deny | bad', 'a -> c | warn', 'c --> b : later | info', 'c <-> a | neutral');
  assert.deepEqual(edges(src), [
    ['a', 'b', 'allow', 'good'],
    ['a', 'b', 'deny', 'bad'],
    ['a', 'c', '', 'warn'],
    ['c', 'b', 'later', 'info'],
    ['c', 'a', '', 'neutral'],
  ]);
  assert.deepEqual(parse(src).diagnostics, []);
  const d = parse(src).blocks[0] as DiagramBlock;
  assert.equal(d.edges[1].style, 'blocked');
  assert.equal(d.edges[3].style, 'dashed');
  assert.equal(d.edges[4].both, true);
});

test('a chain and a fan-out give every edge the line makes the tone, and the label stays on the last hop', () => {
  assert.deepEqual(edges(flow('a -> b -> c : go | good')), [
    ['a', 'b', '', 'good'],
    ['b', 'c', 'go', 'good'],
  ]);
  assert.deepEqual(edges(flow('a -> b, c | bad')), [
    ['a', 'b', '', 'bad'],
    ['a', 'c', '', 'bad'],
  ]);
  assert.deepEqual(edges(flow('a, b -> c -> d : x | warn')), [
    ['a', 'c', '', 'warn'],
    ['b', 'c', '', 'warn'],
    ['c', 'd', 'x', 'warn'],
  ]);
});

test('an edge with no tone has no tone key, so a document without tones parses as it did', () => {
  const d = parse(flow('a -> b : plain', 'b -> c')).blocks[0] as DiagramBlock;
  for (const e of d.edges) assert.equal('tone' in e, false);
});

test('sequence messages take the field too, and a fan-out is still an error', () => {
  const src = 'diagram s sequence\ns: a -> b : GET /orders | good\ns: b --> a : 401 | bad\ns: a -> a : retry | warn\n';
  assert.deepEqual(edges(src), [
    ['a', 'b', 'GET /orders', 'good'],
    ['b', 'a', '401', 'bad'],
    ['a', 'a', 'retry', 'warn'],
  ]);
  assert.deepEqual(parse(src).diagnostics, []);
  assert.deepEqual(codes('diagram s sequence\ns: a -> b, c : x | good\n'), ['error:diagram-syntax@2', 'warning:diagram-empty@1']);
});

test('the separator is a pipe with a space on each side, and only the last one counts', () => {
  assert.deepEqual(edges(flow('a -> b : read | write it | good')), [['a', 'b', 'read | write it', 'good']]);
  assert.deepEqual(edges(flow('a -> b : x|good', 'a -> b : x |good', 'a -> b : x| good')), [
    ['a', 'b', 'x|good', null],
    ['a', 'b', 'x |good', null],
    ['a', 'b', 'x| good', null],
  ]);
  assert.deepEqual(edges(flow('a -> b : x |')), [['a', 'b', 'x |', null]]);
  assert.deepEqual(edges(flow('a -> b : x   |   good')), [['a', 'b', 'x', 'good']]);
});

test('a pipe inside a quoted label is never the separator', () => {
  assert.deepEqual(edges(flow('a -> b : "read | good"')), [['a', 'b', '"read | good"', null]]);
  assert.deepEqual(edges(flow('a -> b : "read | write" | good')), [['a', 'b', '"read | write"', 'good']]);
  assert.deepEqual(edges(flow('a -> b : say "x | y" | bad')), [['a', 'b', 'say "x | y"', 'bad']]);
  assert.deepEqual(codes(flow('a -> b : "read | good"', 'a -> b : "x | y" | good')), []);
  // An unclosed quote opens nothing.
  assert.deepEqual(edges(flow('a -> b : 12" pipe | good')), [['a', 'b', '12" pipe', 'good']]);
});

test('labels with a pipe that is not followed by one word are kept as before, with no warning', () => {
  const src = flow('a -> b : yes | no, retry', 'a -> b : GET | POST /x', 'a -> b : 1 | 2', 'a -> b : a | b-c d', 'a -> b : x | (good)');
  assert.deepEqual(edges(src), [
    ['a', 'b', 'yes | no, retry', null],
    ['a', 'b', 'GET | POST /x', null],
    ['a', 'b', '1 | 2', null],
    ['a', 'b', 'a | b-c d', null],
    ['a', 'b', 'x | (good)', null],
  ]);
  assert.deepEqual(parse(src).diagnostics, []);
});

test('inside a label any last field that is no tone word stays label text, as on the base, with no warning', () => {
  const lines = ['a -> b : x | goood', 'b -> c : read | write', 'client -> server : GET | POST'];
  assert.deepEqual(edges(flow(...lines)), [
    ['a', 'b', 'x | goood', null],
    ['b', 'c', 'read | write', null],
    ['client', 'server', 'GET | POST', null],
  ]);
  assert.deepEqual(codes(flow(...lines)), []);
});

test('a case variant of a tone word stays in the label with W edge-tone naming the lower-case word', () => {
  const doc = parse(flow('a -> b : x | Good', 'b -> c : y | BAD'));
  assert.deepEqual(edges(flow('a -> b : x | Good', 'b -> c : y | BAD')), [
    ['a', 'b', 'x | Good', null],
    ['b', 'c', 'y | BAD', null],
  ]);
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.line, d.col, d.detail]),
    [
      ['edge-tone', 2, 17, { value: 'Good', allowed: ['good', 'warn', 'bad', 'info', 'neutral'] }],
      ['edge-tone', 3, 17, { value: 'BAD', allowed: ['good', 'warn', 'bad', 'info', 'neutral'] }],
    ],
  );
  assert.match(doc.diagnostics[0].message, /write "good"/);
});

test('with no label, a lone last word that is no tone (a line the base could not read) is W edge-tone and dropped', () => {
  const doc = parse(flow('a -> b | red', 'b -> c | Warn'));
  assert.deepEqual(edges(flow('a -> b | red', 'b -> c | Warn')), [
    ['a', 'b', '', null],
    ['b', 'c', '', null],
  ]);
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.line, d.col]),
    [
      ['edge-tone', 2, 13],
      ['edge-tone', 3, 13],
    ],
  );
  assert.match(doc.diagnostics[1].message, /write "warn"/);
});

test('a line that fails keeps its own error and adds no tone warning', () => {
  assert.deepEqual(codes(flow('"a -> b | red')), ['error:diagram-syntax@2', 'warning:diagram-empty@1']);
  assert.deepEqual(codes('diagram s sequence\ns: a -> b, c | red\n'), ['error:diagram-syntax@2', 'warning:diagram-empty@1']);
});

test('node, group and note lines are not edge lines: their pipes are as they were', () => {
  const doc = parse(flow('a "Reads | writes" svc', 'group g "G | H" a', 'note a : x -> y | good'));
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code).filter((c) => c === 'edge-tone'),
    [],
  );
  const d = doc.blocks[0] as DiagramBlock;
  assert.equal(d.nodes[0].label, 'Reads | writes');
  assert.equal(d.edges.length, 0);
});

test('streaming: each line carries its tone, a partial line is not read, and the settled document equals the parse', () => {
  const src = '# T\n\ndiagram f\nf: a -> b : allow | good\nf: b -x- c | bad\nf: c -> d -> e : go | warn\n\nBody.\n';
  const s = new LedeStream();
  const seen: unknown[] = [];
  for (let i = 0; i < src.length; i += 5) {
    for (const e of s.events(src.slice(i, i + 5)))
      if (e.kind === 'update') seen.push('block' in e ? e.block.edges.map((x) => x.tone ?? null) : e.data);
  }
  // A line ending mid-field (`... | go`) is not parsed until its newline arrives: no update ever shows a half-typed tone.
  assert.deepEqual(seen.at(-1), ['good', 'bad', 'warn', 'warn']);
  const doc = s.end();
  assert.deepEqual(doc.blocks, parse(src).blocks);
  assert.deepEqual(doc.diagnostics, parse(src).diagnostics);
  const snap = new LedeStream();
  snap.write('diagram f\nf: a -> b | go');
  assert.deepEqual((snap.snapshot().blocks[0] as DiagramBlock).edges, []);
  snap.write('od\nf: a -> c | good\n');
  assert.deepEqual(
    (snap.snapshot().blocks[0] as DiagramBlock).edges.map((e) => e.tone),
    ['good', 'good'],
  );
});

test('an edge line with a long run of spaces is read in one pass', () => {
  const t = performance.now();
  const got = edges(flow(`a -> b${' '.repeat(100_000)}| good`));
  assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms`);
  assert.deepEqual(got, [['a', 'b', '', 'good']]);
});
