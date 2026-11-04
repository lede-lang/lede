import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { LedeStream, parse, resolve, type Block, type StreamEvent } from '../src/index.ts';

const src = readFileSync(new URL('../../../examples/kitchen-sink.lede', import.meta.url), 'utf8');

test('blocks emitted while streaming equal the final parse, in order', () => {
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

test('every line-prefix snapshot keeps stable blocks stable', () => {
  const lines = src.split('\n');
  const final = parse(src).blocks;
  for (let n = 1; n < lines.length; n++) {
    const s = new LedeStream();
    s.write(lines.slice(0, n).join('\n') + '\n');
    const snap = s.snapshot();
    // All but the last block of a snapshot (which may still be growing) match the final document,
    // except diagrams, which later lines extend, and grids, which fill up.
    const stable = snap.blocks.slice(0, -1);
    stable.forEach((b, i) => {
      if (b.type === 'diagram' || b.type === 'grid' || b.type === 'kpis') return;
      assert.deepEqual(b, final[i], `line ${n}, block ${i}`);
    });
  }
});

test('partial last line is not parsed until its newline arrives', () => {
  const s = new LedeStream();
  s.write('# Hel');
  assert.equal(s.snapshot().blocks.length, 0);
  s.write('lo\n');
  assert.deepEqual(s.snapshot().blocks, [{ type: 'heading', level: 1, text: 'Hello', line: 1 }]);
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
  e.kind === 'block' ? `block:${e.block.type}` : 'data' in e ? `update:data ${e.data}` : `${e.kind}:diagram`;
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
    for (const c of chunks(src, n)) out.push(...names(s.events(c)));
    s.end((e) => out.push(kind(e)));
    return out;
  };
  const whole = run(src.length);
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

// `cards` takes nothing after it, so a line that starts "cards on the table" is prose. So is "export the data": `export` is a keyword
// line only alone or with one word after it.
const KEYWORD_LINE = /^((data|chart|table|kpi|diagram|image|grid|step|ask|choose|confirm)(\s|$)|export(\s+\S+)?\s*$|cards$)/;
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
