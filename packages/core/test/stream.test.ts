import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  LedeParser,
  LedeStream,
  parse,
  resolve,
  type Block,
  type BucketBlock,
  type StreamEvent,
  type TemplateBlock,
} from '../src/index.ts';

// The first two tests run over the kitchen sink and over every editor word at once (spec §6, Req 7.2).
const fixtures = ['examples/kitchen-sink.lede', 'examples/parity/editors.lede'].map((path) => ({
  path,
  src: readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'),
}));

const kitchen = fixtures[0].src;

for (const { path, src } of fixtures) {
  test(`blocks emitted while streaming equal the final parse, in order (${path})`, () => {
    const s = new LedeStream();
    const emitted: unknown[] = [];
    // Feed in awkward chunks that split lines and multi-byte characters.
    for (let i = 0; i < src.length; i += 7) emitted.push(...s.write(src.slice(i, i + 7)));
    const doc = s.end();
    const finalBlocks = parse(src).blocks;
    assert.deepEqual(doc.blocks, finalBlocks);
    // Everything emitted before end() is a prefix of the final block list.
    assert.deepEqual(emitted, finalBlocks.slice(0, emitted.length));
    assert.ok(emitted.length >= finalBlocks.length - 1);
  });

  test(`every line-prefix snapshot keeps stable blocks stable (${path})`, () => {
    const lines = src.split('\n');
    const final = parse(src).blocks;
    for (let n = 1; n < lines.length; n++) {
      const s = new LedeStream();
      s.write(lines.slice(0, n).join('\n') + '\n');
      const snap = s.snapshot();
      // All but the last block of a snapshot (which may still be growing) match the final document,
      // except diagrams and bucket sets, which later lines extend, and grids, which fill up.
      const stable = snap.blocks.slice(0, -1);
      stable.forEach((b, i) => {
        if (b.type === 'diagram' || b.type === 'bucket' || b.type === 'grid' || b.type === 'kpis') return;
        assert.deepEqual(b, final[i], `line ${n}, block ${i}`);
      });
    }
  });
}

test('partial last line is not parsed until its newline arrives', () => {
  const s = new LedeStream();
  s.write('# Hel');
  assert.equal(s.snapshot().blocks.length, 0);
  s.write('lo\n');
  assert.deepEqual(s.snapshot().blocks, [{ type: 'heading', level: 1, text: 'Hello', line: 1 }]);
});

test('a half-written bucket set is its legend and the items so far; each item line adds one and nothing drawn moves (Req 7.1)', () => {
  const s = new LedeStream();
  const emitted = s.write('bucket triage | Now, Next, Later | Where does each go?\n');
  // The set is emitted on its declaration, with no items yet.
  assert.deepEqual(
    emitted.map((b) => b.type),
    ['bucket'],
  );
  const bucket = emitted[0] as BucketBlock;
  assert.deepEqual(bucket.items, []);
  const shot = (): BucketBlock => s.snapshot().blocks.find((b): b is BucketBlock => b.type === 'bucket')!;
  assert.deepEqual(shot().items, []);
  assert.deepEqual(shot().buckets, ['Now', 'Next', 'Later']);

  // An item line emits no block; the emitted set gains the item, as a diagram gains a statement.
  assert.deepEqual(s.write('triage: ENG-1 First | Now\n'), []);
  assert.deepEqual(
    shot().items.map((i) => [i.text, i.bucket]),
    [['ENG-1 First', 'Now']],
  );
  assert.deepEqual(s.write('triage: ENG-2 Second | Later\n'), []);
  const after = shot();
  assert.deepEqual(
    after.items.map((i) => [i.text, i.bucket]),
    [
      ['ENG-1 First', 'Now'],
      ['ENG-2 Second', 'Later'],
    ],
  );
  // The block write() returned is the one that grew, so a viewer holding it sees the new rows.
  assert.equal(bucket.items.length, 2);
  // Nothing already drawn moves: the rows so far are a prefix of the next snapshot's rows.
  s.write('triage: ENG-3 Third | Next\n');
  assert.deepEqual(shot().items.slice(0, 2), after.items);
  assert.deepEqual(shot().buckets, after.buckets);
  assert.equal(shot().text, 'Where does each go?');
});

test('a template shows nothing until its fence opens, then the text so far, and is emitted when the fence closes (Req 7.1)', () => {
  const s = new LedeStream();
  const templates = () => s.snapshot().blocks.filter((b): b is TemplateBlock => b.type === 'template');
  assert.deepEqual(s.write('ask who | Who?\n'), s.snapshot().blocks.slice(0, 1));
  // After the template line and before the fence: no block, and write() reported nothing.
  assert.deepEqual(s.write('template greeting | Greeting\n'), []);
  assert.deepEqual(templates(), []);
  // Blank lines keep it pending.
  assert.deepEqual(s.write('\n'), []);
  assert.deepEqual(templates(), []);
  // Inside the fence: write() still emits nothing, and a snapshot shows the text so far.
  assert.deepEqual(s.write('```text\n'), []);
  assert.deepEqual(s.write('Hello {who}.\n'), []);
  assert.deepEqual(
    templates().map((t) => [t.body, t.slots]),
    [['Hello {who}.', ['who']]],
  );
  assert.deepEqual(s.write('Second line.\n'), []);
  assert.equal(templates()[0].body, 'Hello {who}.\nSecond line.');
  // The closing fence emits the finished block.
  const done = s.write('```\n');
  assert.deepEqual(
    done.map((b) => b.type),
    ['template'],
  );
  assert.equal((done[0] as TemplateBlock).body, 'Hello {who}.\nSecond line.');
  // The error for a missing fence comes at the end of the document, not on the template line.
  const late = new LedeStream();
  late.write('template t | T\n');
  assert.deepEqual(
    late.end().diagnostics.map((d) => d.code),
    ['template-fence'],
  );
});

test('param, toggle and preset are final on their line; a toggle may need one that arrives later', () => {
  const s = new LedeStream();
  s.write('ask note | Note\n');
  for (const [line, type] of [
    ['param p | P | 1 0 2 1\n', 'param'],
    ['toggle a needs=b | A\n', 'toggle'],
    ['preset x | X | note=hi\n', 'preset'],
  ] as const)
    assert.deepEqual(
      s.write(line).map((b) => b.type),
      [type],
    );
  assert.deepEqual(
    s.write('toggle b | B\n').map((b) => b.type),
    ['toggle'],
  );
  assert.deepEqual(
    s.end().diagnostics.filter((d) => d.code === 'toggle-needs'),
    [],
  );
});

test('model-spec examples are valid Lede', () => {
  const spec = readFileSync(new URL('../../../spec/model-spec.md', import.meta.url), 'utf8');
  const blocks = [...spec.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  // Strip the explanatory "(…)" annotations the spec puts after two or more spaces.
  const body = blocks
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/\s{2,}\(.*\)\s*$/, ''))
    .join('\n');
  const doc = parse(body, { loadFile: () => 'a,b\n1,2' });
  const errors = doc.diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(errors, []);
});

test('CRLF input parses like LF', () => {
  assert.deepEqual(parse('# A\r\n- b\r\n').blocks, parse('# A\n- b\n').blocks);
});

// ------------------------------------------------------------------ events() and tail() (internal spec, lede-lang/meta)

const root = new URL('../../../', import.meta.url);
const loadFile = () => 'a,b\n1,2';
const walk = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : e.name.endsWith('.lede') ? [new URL(e.name, dir)] : [],
  );
const files = [...walk(new URL('examples/', root)), ...walk(new URL('conformance/cases/', root))];
const sources = files.map((f) => ({ name: f.pathname.slice(root.pathname.length), src: readFileSync(f, 'utf8') }));

function chunks(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}
const kind = (e: StreamEvent) =>
  e.kind === 'block' ? `block:${e.block.type}` : 'data' in e ? `update:data ${e.data}` : `${e.kind}:${e.block.type}`;
const names = (events: StreamEvent[]) => events.map(kind);

test('events() has the same block events as write(), at chunk sizes 1, 7 and 64, over every example and conformance case', () => {
  assert.ok(sources.length > 60, `found ${sources.length} sources`);
  for (const { name, src: text } of sources) {
    const final = parse(text, { loadFile });
    for (const n of [1, 7, 64]) {
      const w = new LedeStream({ loadFile });
      const e = new LedeStream({ loadFile });
      const written: Block[] = [];
      const blocks: Block[] = [];
      for (const c of chunks(text, n)) {
        written.push(...w.write(c));
        for (const ev of e.events(c)) if (ev.kind === 'block') blocks.push(ev.block);
      }
      assert.deepEqual(blocks, written, `${name} @${n}: events() blocks differ from write()`);
      // The blocks end() finishes are the document's blocks after the ones returned; with them it is the final parse.
      const finished: Block[] = [];
      const doc = e.end((ev) => ev.kind === 'block' && finished.push(ev.block));
      w.end();
      assert.deepEqual(doc, final, `${name} @${n}: end() differs from parse()`);
      assert.deepEqual([...blocks, ...finished], final.blocks, `${name} @${n}: events and end() are not the final blocks, in order`);
    }
  }
});

test('an update event follows a `name:` line, and one follows each `data +=` line', () => {
  const s = new LedeStream();
  const ev = s.events(
    ['diagram flow', 'flow: a -> b', 'flow: b -> c', '', 'data m = x,y; 1,2', 'data m += 2,3', 'chart line m', ''].join('\n'),
  );
  assert.deepEqual(names(ev), [
    'block:diagram',
    'update:diagram',
    'update:diagram',
    'block:data',
    'seal:diagram',
    'update:data m',
    'block:chart',
  ]);
  const flow = ev[0].kind === 'block' && ev[0].block.type === 'diagram' ? ev[0].block : null;
  assert.ok(flow);
  assert.equal(flow.edges.length, 2);
  for (const e of ev) if (e.kind === 'update' && 'block' in e) assert.equal(e.block, flow, 'the update names the same object');
  // A failed `+=` (unknown name) is a diagnostic, not an update.
  assert.deepEqual(names(new LedeStream().events('data nope += 1,2\n')), []);
});

test('a diagram seals on the first non-blank line that is not its statement, not on a blank line, and at end()', () => {
  const s = new LedeStream();
  assert.deepEqual(names(s.events('diagram a\na: x -> y\n\n\n')), ['block:diagram', 'update:diagram']);
  // Another diagram's declaration seals this one, and opens itself.
  assert.deepEqual(names(s.events('diagram b\nb: p -> q\n')), ['block:diagram', 'seal:diagram', 'update:diagram']);
  // A statement of the first one reopens it (the second seals); the next paragraph line seals it again.
  assert.deepEqual(names(s.events('a: y -> z\n')), ['update:diagram', 'seal:diagram']);
  assert.deepEqual(names(s.events('text\n')), ['seal:diagram']);
  // Nothing is open now; a blank line then more text adds no seal.
  assert.deepEqual(names(s.events('\nmore\n\n')), ['block:paragraph', 'block:paragraph']);
  // end() reads the unterminated last line, then seals what is left open.
  const u = new LedeStream();
  u.events('diagram c\nc: m -> n');
  const atEnd: string[] = [];
  u.end((e) => atEnd.push(kind(e)));
  assert.deepEqual(atEnd, ['update:diagram', 'seal:diagram']);
  // A paragraph that is still open finishes at end().
  const t = new LedeStream();
  t.events('diagram c\nc: m -> n\n\nlast words\n');
  const finished: string[] = [];
  const doc = t.end((e) => finished.push(kind(e)));
  assert.deepEqual(finished, ['block:paragraph']);
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['diagram', 'paragraph'],
  );
});

test('the same events come out whatever the chunking', () => {
  const run = (n: number) => {
    const s = new LedeStream();
    const out: string[] = [];
    for (const c of chunks(kitchen, n)) out.push(...names(s.events(c)));
    s.end((e) => out.push(kind(e)));
    return out;
  };
  const whole = run(kitchen.length);
  assert.ok(whole.includes('update:diagram') && whole.includes('seal:diagram'), 'kitchen-sink streams a diagram');
  for (const n of [1, 7, 64]) assert.deepEqual(run(n), whole, `chunks of ${n}`);
});

test('a statement after a seal is an update and then a second seal (a reseal)', () => {
  const s = new LedeStream();
  const out = [
    ...names(s.events('diagram a\na: x -> y\n')),
    ...names(s.events('A paragraph.\n')), // seals
    ...names(s.events('a: y -> z\n')), // flushes the paragraph, reopens
    ...names(s.events('# Heading\n')), // seals again
  ];
  assert.deepEqual(out, [
    'block:diagram',
    'update:diagram',
    'seal:diagram',
    'block:paragraph',
    'update:diagram',
    'block:heading',
    'seal:diagram',
  ]);
});

test('a diagram written inside a grid is not updated or sealed until the grid is returned', () => {
  const s = new LedeStream();
  const ev = s.events(['grid 2', 'diagram a', 'a: x -> y', 'data d = k,v; 1,2', 'chart bar d', 'a: y -> z', 'para', ''].join('\n'));
  // `a: x -> y` came before the grid was returned, so there is nothing on screen to update; the later one is an update.
  assert.deepEqual(names(ev), ['block:data', 'block:grid', 'update:diagram', 'seal:diagram']);
});

test('a `name:` line that changes nothing gives no update, no reopening and no seal; it is still a statement of the diagram', () => {
  const s = new LedeStream();
  assert.deepEqual(names(s.events('diagram a\na: x -> y\n')), ['block:diagram', 'update:diagram']);
  // An empty statement and one that reads as nothing are diagnostics. They extend nothing, but they are lines of the diagram: it stays open.
  assert.deepEqual(names(s.events('a:\na: "oops"\n')), []);
  assert.deepEqual(
    s.doc.diagnostics.map((d) => d.code),
    ['diagram-empty-line', 'diagram-syntax'],
  );
  assert.deepEqual(names(s.events('a: y -> z\n')), ['update:diagram']);
  assert.deepEqual(names(s.events('Text.\n')), ['seal:diagram']);
  // Once sealed, a rejected statement neither updates nor reopens it, so the paragraph after it seals nothing again.
  assert.deepEqual(names(s.events('a: "oops"\nMore.\n\n')), ['block:paragraph', 'block:paragraph']);
  // A statement that repeats what the diagram has, and a second `legend`, change nothing either.
  assert.deepEqual(names(s.events('a: x "X"\n')), ['update:diagram']);
  assert.deepEqual(names(s.events('a: x "X"\n')), []);
  assert.deepEqual(names(s.events('a: legend\na: legend\n')), ['update:diagram']);
  assert.deepEqual(names(s.events('a: y -> z\n')), ['update:diagram']);
  const atEnd: string[] = [];
  s.end((e) => atEnd.push(kind(e)));
  assert.deepEqual(atEnd, ['seal:diagram']);
  // A sequence diagram: an `end` with no `alt` open is rejected, and the frame lines that do apply are updates.
  const q = new LedeStream();
  assert.deepEqual(names(q.events('diagram s sequence\ns: a -> b : hi\n')), ['block:diagram', 'update:diagram']);
  assert.deepEqual(names(q.events('s: end\n')), []);
  assert.deepEqual(names(q.events('s: alt "ok"\ns: b -> a : yes\ns: end\n')), ['update:diagram', 'update:diagram', 'update:diagram']);
});

test('a bucket set streams as a diagram does: an update per item line, a seal at the first other non-blank line (Req 1.1)', () => {
  const s = new LedeStream();
  assert.deepEqual(names(s.events('bucket triage | Now, Next, Later | Where does each go?\n')), ['block:bucket']);
  // Its declaration does not seal it; an item line is an update, and a blank line between items does not seal.
  assert.deepEqual(names(s.events('triage: ENG-1 First | Now\n\ntriage: ENG-2 Second | Later\n')), [
    'bucket-update:bucket',
    'bucket-update:bucket',
  ]);
  // A line the parser rejects (no bucket, an unknown bucket, nothing) and one that repeats an item are no update, and still its lines.
  assert.deepEqual(names(s.events('triage: ENG-3 has no bucket\ntriage: ENG-3 | Cut\ntriage:\ntriage: ENG-1 First | Next\n')), []);
  assert.deepEqual(
    s.doc.diagnostics.map((d) => d.code),
    ['bucket-item', 'bucket-unknown', 'bucket-item', 'bucket-dup-item'],
  );
  assert.deepEqual(names(s.events('triage: ENG-3 Third | Next\n')), ['bucket-update:bucket']);
  // The first line that is not an item seals it; then nothing is open.
  assert.deepEqual(names(s.events('Done sorting.\n')), ['bucket-seal:bucket']);
  assert.deepEqual(names(s.events('More.\n')), []);
  // An item after the seal is an update again and the next sealing line a second seal; a rejected one reopens nothing.
  assert.deepEqual(names(s.events('triage: ENG-4 Fourth | Later\n')), ['block:paragraph', 'bucket-update:bucket']);
  assert.deepEqual(names(s.events('triage: ENG-4 Fourth | Later\n')), []);
  assert.deepEqual(names(s.events('# Heading\n')), ['block:heading', 'bucket-seal:bucket']);
  assert.deepEqual(names(s.events('triage: ENG-5 | Nowhere\nText.\n')), []);
  const bucket = s.doc.blocks.find((b): b is BucketBlock => b.type === 'bucket')!;
  assert.equal(bucket.items.length, 4);
  // The update names the object the declaration returned, which is the one that grew.
  const t = new LedeStream();
  const [declared] = t.events('bucket b | A, B\n');
  const [update] = t.events('b: x | A\n');
  assert.ok(declared.kind === 'block' && update.kind === 'bucket-update' && 'block' in update);
  assert.equal(update.block, declared.block);
  // end() reads the unterminated last line and seals what is still open, a bucket set and a diagram alike.
  const u = new LedeStream();
  u.events('bucket b | A, B\ndiagram d\nd: p -> q\nb: x | A');
  const atEnd: string[] = [];
  u.end((e) => atEnd.push(kind(e)));
  assert.deepEqual(atEnd, ['bucket-update:bucket', 'seal:diagram', 'bucket-seal:bucket']);
  // A diagram's declaration seals the open set, a set's declaration seals the open diagram, and each reopens by its own line.
  const v = new LedeStream();
  assert.deepEqual(names(v.events('bucket b | A, B\nb: x | A\ndiagram d\n')), [
    'block:bucket',
    'bucket-update:bucket',
    'block:diagram',
    'bucket-seal:bucket',
  ]);
  assert.deepEqual(names(v.events('d: p -> q\nb: y | B\n')), ['update:diagram', 'bucket-update:bucket', 'seal:diagram']);
  assert.deepEqual(names(v.events('d: q -> r\n')), ['update:diagram', 'bucket-seal:bucket']);
});

test('`update` and `seal` carry a diagram only: a bucket set has the kinds `bucket-update` and `bucket-seal`', () => {
  const src = ['bucket b | A, B', 'b: x | A', 'diagram d', 'd: p -> q', 'b: y | B', 'd: q -> r', '', 'Closing.', ''].join('\n');
  const s = new LedeStream();
  const all = [...s.events(src)];
  s.end((e) => all.push(e));
  for (const e of all) {
    if (e.kind === 'update' && 'block' in e) assert.equal(e.block.type, 'diagram');
    if (e.kind === 'seal') assert.equal(e.block.type, 'diagram');
    if (e.kind === 'bucket-update' || e.kind === 'bucket-seal') assert.equal(e.block.type, 'bucket');
  }
  assert.deepEqual(all.map(kind), [
    'block:bucket',
    'bucket-update:bucket',
    'block:diagram',
    'bucket-seal:bucket',
    'update:diagram',
    'bucket-update:bucket',
    'seal:diagram',
    'update:diagram',
    'bucket-seal:bucket',
    'seal:diagram',
    'block:paragraph',
  ]);
});

test('a parser given only the hooks written before bucket sets (no onBucketItem) reads a bucket set with items', () => {
  const seen: string[] = [];
  const p = new LedeParser(
    {},
    { onDiagramLine: (b, changed) => seen.push(`diagram ${b.name} ${changed}`), onDataAppend: (n) => seen.push(`data ${n}`) },
  );
  for (const l of ['bucket b | A, B', 'b: x | A', 'b: y | B', 'b: z | Nowhere', 'diagram d', 'd: p -> q', 'export json']) p.pushLine(l);
  const doc = p.end();
  const set = doc.blocks.find((b): b is BucketBlock => b.type === 'bucket')!;
  assert.deepEqual(
    set.items.map((i) => [i.text, i.bucket]),
    [
      ['x', 'A'],
      ['y', 'B'],
    ],
  );
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code),
    ['bucket-unknown'],
  );
  assert.deepEqual(seen, ['diagram d true'], 'the hooks it has still run');
});

test('a bucket set in a grid or a card is not updated until the block that holds it is returned (Req 1.1)', () => {
  const grid = new LedeStream();
  // The grid is open, so the set is not on screen: its items change nothing a viewer shows yet, and nothing is sealed.
  assert.deepEqual(names(grid.events('grid 2\nbucket b | A, B\nb: x | A\n')), []);
  const [open] = grid.tail();
  assert.ok(open.type === 'grid' && open.children[0].type === 'bucket');
  assert.equal(open.children[0].items.length, 1, 'the open grid shows the set with the items so far');
  assert.deepEqual(names(grid.events('para\n\n')), ['block:grid']);
  // Returned, the set is open like any other: its next item is an update, and a line of another kind seals it.
  assert.deepEqual(names(grid.events('b: y | B\n')), ['bucket-update:bucket']);
  assert.deepEqual(names(grid.events('Text.\n')), ['bucket-seal:bucket']);
  const cards = new LedeStream();
  assert.deepEqual(names(cards.events('# Plans\n\ncards\n\n### One\nbucket c | A, B\nc: x | A\n')), ['block:heading']);
  assert.deepEqual(names(cards.events('## Next\n')), ['block:cards', 'block:heading']);
  assert.deepEqual(names(cards.events('c: y | B\n')), ['bucket-update:bucket']);
});

test('param, toggle, bucket and preset are block events on their own line, whole or half; a template is one when its fence closes', () => {
  const lines = [
    ['ask note | Note', 'ask'],
    ['param press unit=x | Press depth | 0.94 0.85 1 0.01', 'param'],
    ['toggle live on | Live', 'toggle'],
    ['bucket triage | Now, Next | Where?', 'bucket'],
    ['preset snappy | Snappy | press=0.96; live=on', 'preset'],
  ] as const;
  const s = new LedeStream();
  for (const [line, type] of lines) {
    const cut = Math.ceil(line.length / 2);
    assert.deepEqual(s.events(line.slice(0, cut)), [], `${type}: half a line`);
    assert.deepEqual(s.tail(), [], `${type}: half a line`);
    // The set the `bucket` line returned is open, so the first line after it that is not an item seals it.
    const sealed = type === 'preset' ? ['bucket-seal:bucket'] : [];
    assert.deepEqual(names(s.events(`${line.slice(cut)}\n`)), [`block:${type}`, ...sealed], `${type}: the whole line`);
    assert.deepEqual(s.tail(), [], `${type}: final on its own line, so never a tail`);
  }
  // An item line of the set is no block and no tail either: it grows the set, which opens again.
  assert.deepEqual(names(s.events('triage: ENG-1 | Now\n')), ['bucket-update:bucket']);
  assert.deepEqual(s.tail(), []);
});

test('tail() returns the open fence of a template as the template block with the text so far, and nothing before or after it', () => {
  const s = new LedeStream();
  s.events('ask who | Who?\nparam n | N | 1 0 9 1\n');
  assert.deepEqual(names(s.events('template greeting | Greeting\n')), []);
  assert.deepEqual(s.tail(), [], 'the template line alone is no block');
  assert.deepEqual(names(s.events('\n')), []);
  assert.deepEqual(s.tail(), [], 'a blank line keeps it pending');
  // The fence is open: its text so far, with the slots found so far. Half a line is nothing yet.
  assert.deepEqual(names(s.events('```text\n')), []);
  const at = (): TemplateBlock => {
    const t = s.tail();
    assert.equal(t.length, 1);
    assert.ok(t[0].type === 'template');
    return t[0];
  };
  assert.deepEqual([at().body, at().slots, at().lang, at().name, at().text, at().line], ['', [], 'text', 'greeting', 'Greeting', 3]);
  s.events('Hello {wh');
  assert.equal(at().body, '');
  s.events('o}, you asked for {n}.\n');
  assert.deepEqual([at().body, at().slots], ['Hello {who}, you asked for {n}.', ['who', 'n']]);
  // An indented fence reads like an unindented one; a brace that names nothing is kept as written and is no slot.
  s.events('  {nobody} stays\n');
  assert.deepEqual([at().body, at().slots], ['Hello {who}, you asked for {n}.\n  {nobody} stays', ['who', 'n']]);
  // What the snapshot shows beyond the returned blocks is the same block, and no diagnostic comes before the fence closes.
  const returned = s.doc.blocks.length;
  assert.deepEqual(s.tail(), s.snapshot().blocks.slice(returned));
  assert.deepEqual(
    s.doc.diagnostics.map((d) => d.code),
    [],
  );
  // The closing fence returns it, once, and the tail is empty again; the block returned is the one tail() showed.
  const shown = at();
  const closed = s.events('```\n');
  assert.deepEqual(names(closed), ['block:template']);
  assert.deepEqual(closed[0].kind === 'block' ? closed[0].block : null, shown);
  assert.deepEqual(s.tail(), []);
  assert.deepEqual(
    s.doc.diagnostics.map((d) => d.code),
    ['template-slot'],
  );
  // Calling tail() registered nothing: the name is still free for the closing fence to take.
  const t = new LedeStream();
  t.events('template once | Once\n```\nbody\n');
  t.tail();
  t.tail();
  t.events('```\n');
  assert.deepEqual(
    t.end().diagnostics.map((d) => d.code),
    ['template-empty', 'export-missing'],
  );
  // A raw fence after a template line is no template: its tail is the html block, and the template has no fence.
  const raw = new LedeStream();
  raw.events('template raw | Raw\n```=html\n<b>x</b>\n');
  assert.deepEqual(raw.tail(), [{ type: 'html', html: '<b>x</b>', line: 2 }]);
  // An unclosed fence at the end of the document ends there, as a snapshot reads it.
  const open = new LedeStream();
  open.events('ask a | A?\ntemplate t | T\n```\n{a}\n');
  assert.ok(open.tail()[0].type === 'template');
  assert.deepEqual(
    open.end().blocks.map((b) => b.type),
    ['ask', 'template'],
  );
});

test('the same events come out whatever the chunking, over the editor examples too, and each bucket item line is one update', () => {
  for (const f of ['examples/parity/editors.lede', 'examples/parity/editors-large.lede']) {
    const text = readFileSync(new URL(f, root), 'utf8');
    const run = (n: number) => {
      const s = new LedeStream();
      const out: string[] = [];
      for (const c of chunks(text, n)) out.push(...names(s.events(c)));
      s.end((e) => out.push(kind(e)));
      return out;
    };
    const whole = run(text.length);
    const itemLines = text.split('\n').filter((l) => l.startsWith('triage:')).length;
    assert.ok(itemLines >= 3);
    assert.equal(whole.filter((e) => e === 'bucket-update:bucket').length, itemLines, `${f}: one update per item line`);
    assert.equal(whole.filter((e) => e === 'block:bucket').length, 1);
    // The set seals once: at the blank line's successor, which is not an item.
    assert.equal(whole.filter((e) => e === 'bucket-seal:bucket').length, 1, `${f}: sealed once`);
    for (const n of [1, 7, 64]) assert.deepEqual(run(n), whole, `${f}: chunks of ${n}`);
  }
});

// `cards` takes nothing after it, so a line that starts "cards on the table" is prose. So is "export the data": `export` is a keyword
// line only alone or with one word after it.
// The editor words are keyword lines only with a name and a `|` after it (spec §4.19): "toggle the flag on Monday" is prose.
const KEYWORD_LINE =
  /^((data|chart|table|kpi|diagram|image|grid|step|ask|choose|confirm)(\s|$)|export(\s+\S+)?\s*$|cards$|(param|toggle|bucket|template|preset)\s+[A-Za-z][\w-]*[^|]*\|)/;
const nested = (bs: Block[]): Block[] =>
  bs.flatMap((b) => (b.type === 'grid' ? b.children : b.type === 'cards' ? b.items.flatMap((c) => c.blocks) : [b]));

test('tail() is the open block, and never a keyword line', () => {
  // A kpi row is open until a line of another kind arrives; the kpi line is part of the row, not a paragraph of text.
  const s = new LedeStream();
  assert.deepEqual(s.events('kpi Users | 12 | +3\n'), []);
  assert.deepEqual(s.tail(), [
    { type: 'kpis', items: [{ label: 'Users', value: '12', delta: '+3', tone: null, note: '', ref: null }], line: 1 },
  ]);
  assert.deepEqual(s.events('kpi Churn | 2%\n'), []);
  assert.equal((s.tail()[0] as { items: unknown[] }).items.length, 2);
  assert.deepEqual(names(s.events('After.\n')), ['block:kpis']);
  assert.deepEqual(s.tail(), [{ type: 'paragraph', text: 'After.', line: 3 }]);
  // A keyword line that is wrong is a diagnostic on its own line: no block, no tail.
  const t = new LedeStream();
  t.events('chart nonsense\nkpi no pipes here\ntable\n');
  assert.deepEqual(t.tail(), []);
  assert.equal(t.doc.diagnostics.filter((d) => d.severity === 'error').length, 3);
  // The open paragraph, list, quote, step run, fence and html fence.
  const open = (text: string) => {
    const x = new LedeStream();
    x.events(text);
    return x.tail();
  };
  assert.deepEqual(open('one\ntwo\n'), [{ type: 'paragraph', text: 'one two', line: 1 }]);
  assert.equal(open('- a\n- b\n')[0].type, 'list');
  assert.deepEqual(open('> q\n> -- someone\n'), [{ type: 'quote', text: 'q', cite: 'someone', line: 1 }]);
  assert.equal(open('step One | Mon\nstep Two | Tue\n')[0].type, 'steps');
  assert.deepEqual(open('```js\nlet a = 1;\n'), [{ type: 'code', lang: 'js', text: 'let a = 1;', line: 1 }]);
  assert.deepEqual(open('```=html\n<p>hi</p>\n'), [{ type: 'html', html: '<p>hi</p>', line: 1 }]);
  assert.deepEqual(open('# Done\n'), [], 'a heading is final on its own line');
  assert.deepEqual(open('para\n\n'), [], 'a blank line finishes the paragraph');
});

test('a question word is a block event on its own line and never a tail, whole or half (ask, choose, confirm, export)', () => {
  const lines = [
    ['ask owner | Who signs off on this release?', 'ask'],
    ['choose risk | low, medium, high', 'choose'],
    ['confirm migration | The migration ran on staging and rolled back', 'confirm'],
    ['export json', 'export'],
  ] as const;
  const s = new LedeStream();
  for (const [line, type] of lines) {
    // Half a line is nothing yet, the way a half kpi line is nothing: no event, no tail, no half field.
    const cut = Math.ceil(line.length / 2);
    assert.deepEqual(s.events(line.slice(0, cut)), [], `${type}: half a line`);
    assert.deepEqual(s.tail(), [], `${type}: half a line`);
    assert.deepEqual(names(s.events(`${line.slice(cut)}\n`)), [`block:${type}`], `${type}: the whole line`);
    assert.deepEqual(s.tail(), [], `${type}: a question word is final on its own line`);
  }
  assert.deepEqual(
    s.end().blocks.map((b) => b.type),
    ['ask', 'choose', 'confirm', 'export'],
  );
  // It ends the open block before it, and is a block of its own beside it: the open paragraph and the open kpi row come out first.
  const p = new LedeStream();
  assert.deepEqual(names(p.events('Some words\nask a | Who?\n')), ['block:paragraph', 'block:ask']);
  assert.deepEqual(p.tail(), []);
  const k = new LedeStream();
  assert.deepEqual(names(k.events('kpi A | 1 | | x\nchoose b | x, y\n')), ['block:kpis', 'block:choose']);
  assert.deepEqual(k.tail(), []);
  // A question line that is wrong is a diagnostic on its own line: no block, no tail, and it does not read as text.
  const bad = new LedeStream();
  assert.deepEqual(bad.events('ask the team about it\nconfirm\n'), []);
  assert.deepEqual(bad.tail(), []);
  assert.deepEqual(
    bad.doc.diagnostics.map((d) => d.code),
    ['question-syntax', 'question-syntax'],
  );
  // Inside an open grid the fields are the grid's children, each whole, and the grid is the only thing in the tail.
  const g = new LedeStream();
  assert.deepEqual(g.events('grid 3\nask a | Who?\nconfirm b | Sure?\n'), []);
  const [open] = g.tail();
  assert.ok(open.type === 'grid');
  assert.deepEqual(
    open.children.map((c) => c.type),
    ['ask', 'confirm'],
  );
  assert.deepEqual(names(g.events('choose c | x, y\n')), ['block:grid']);
  assert.deepEqual(g.tail(), []);
});

test('tail() copies the open block without structuredClone, and what it returns shares nothing with the parser', () => {
  const real = globalThis.structuredClone;
  let clones = 0;
  globalThis.structuredClone = ((...args: Parameters<typeof real>) => {
    clones++;
    return real(...args);
  }) as typeof real;
  try {
    for (const text of [
      '- one\n- two\n',
      'kpi A | 1 | | x\nkpi B | 2 | | y\n',
      'step Do it | Mon | a note\n',
      'First\nsecond\n',
      '> q\n> -- who\n',
    ]) {
      const x = new LedeStream();
      x.events(text);
      assert.equal(x.tail().length, 1, text);
    }
  } finally {
    globalThis.structuredClone = real;
  }
  assert.equal(clones, 0);

  // Changing what tail() returned changes nothing in the parser, and a line that arrives later changes nothing in what it returned.
  const s = new LedeStream();
  s.events('- one\n- two\n');
  const first = s.tail()[0];
  assert.ok(first.type === 'list');
  first.items[0].text = 'changed';
  first.items.pop();
  assert.deepEqual(
    s.tail().flatMap((b) => (b.type === 'list' ? b.items.map((i) => i.text) : [])),
    ['one', 'two'],
  );
  s.events('- three\n');
  assert.deepEqual(
    first.items.map((i) => i.text),
    ['changed'],
  );
  const k = new LedeStream();
  k.events('kpi A | 1 | | x\n');
  const row = k.tail()[0];
  assert.ok(row.type === 'kpis');
  k.events('kpi B | 2 | | y\n');
  row.items[0].value = '99';
  assert.equal(row.items.length, 1);
  const ended = k.end().blocks[0];
  assert.ok(ended.type === 'kpis');
  assert.deepEqual(
    ended.items.map((i) => i.value),
    ['1', '2'],
  );
});

test('tail() shows an open grid and an open cards run as blocks, with the open block inside', () => {
  const grid = new LedeStream();
  assert.deepEqual(names(grid.events('grid 3\nfirst\n\nsecond\n')), []);
  assert.deepEqual(grid.tail(), [
    {
      type: 'grid',
      columns: 3,
      count: 3,
      children: [
        { type: 'paragraph', text: 'first', line: 2 },
        { type: 'paragraph', text: 'second', line: 4 },
      ],
      line: 1,
    },
  ]);
  assert.deepEqual(names(grid.events('\nthird\n\n')), ['block:grid'], 'it is returned when it fills');
  assert.deepEqual(grid.tail(), []);

  const cards = new LedeStream();
  assert.deepEqual(names(cards.events('# Plans\n\ncards\n\n### One\n- a\n- b\n\n### Two\n- c\n')), ['block:heading']);
  const tail = cards.tail();
  assert.equal(tail.length, 1);
  assert.ok(tail[0].type === 'cards');
  assert.deepEqual(
    tail[0].items.map((c) => [c.title, c.blocks.map((b) => b.type)]),
    [
      ['One', ['list']],
      ['Two', ['list']],
    ],
  );
  assert.deepEqual(names(cards.events('## Next\n')), ['block:cards', 'block:heading']);
  // What snapshot() adds: a diagram written in a card is shown after the cards.
  const dg = new LedeStream();
  dg.events('cards\n### A\n- x\n- y\n\ndiagram f\nf: p -> q\n');
  assert.deepEqual(
    dg.tail().map((b) => b.type),
    ['cards', 'diagram'],
  );
});

test('tail() equals what snapshot() shows beyond the returned blocks, after every line of the smaller examples', () => {
  let pages = 0;
  for (const { name, src: text } of sources) {
    if (text.length > 5000) continue; // snapshot() re-parses, so the comparison is quadratic: keep it to small pages
    pages++;
    const lines = text.split('\n');
    const s = new LedeStream({ loadFile });
    let returned = 0;
    // kpi references resolve at end(): resolve both sides the same way before comparing.
    const view = (bs: Block[]) => {
      const doc = { meta: {}, blocks: structuredClone(bs), data: s.doc.data, diagnostics: [] };
      resolve(doc);
      return doc.blocks;
    };
    for (let i = 0; i < lines.length - 1; i++) {
      for (const e of s.events(`${lines[i]}\n`)) if (e.kind === 'block') returned++;
      assert.deepEqual(view(s.tail()), view(s.snapshot().blocks.slice(returned)), `${name}: after line ${i + 1}`);
    }
  }
  assert.ok(pages > 30, `compared ${pages} pages`);
});

test('tail() never returns a keyword line as text, and calling it after every chunk changes no later event', () => {
  for (const { name, src: text } of sources) {
    const srcLines = text.split('\n');
    for (const n of [1, 7, 64]) {
      const quiet = new LedeStream({ loadFile });
      const loud = new LedeStream({ loadFile });
      const a: string[] = [];
      const b: string[] = [];
      for (const c of chunks(text, n)) {
        a.push(...names(quiet.events(c)));
        b.push(...names(loud.events(c)));
        for (const t of nested(loud.tail())) {
          if (t.type !== 'paragraph') continue;
          // A line the writer escaped with \ is text by design.
          if (!srcLines[t.line - 1].trimStart().startsWith('\\'))
            assert.doesNotMatch(t.text, KEYWORD_LINE, `${name}: a keyword line came back as text`);
        }
      }
      assert.deepEqual(b, a, `${name} @${n}: tail() calls changed the events`);
      assert.deepEqual(loud.end(), quiet.end(), `${name} @${n}: tail() calls changed the document`);
    }
  }
});

test('a group line that replaces a node and then fails on a bad member still sends an update', () => {
  const ev = new LedeStream().events(['diagram d', 'd: g -> x', 'para', 'd: group g "G" y, b@d', ''].join('\n'));
  assert.equal(names(ev).filter((n) => n === 'update:diagram').length, 2, names(ev).join(' '));
});
