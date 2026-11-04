import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LedeStream, parse, type BucketBlock, type TemplateBlock } from '../src/index.ts';

// The first two tests run over the kitchen sink and over every editor word at once (spec §6, Req 7.2).
const fixtures = ['examples/kitchen-sink.lede', 'examples/parity/editors.lede'].map((path) => ({
  path,
  src: readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'),
}));

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
