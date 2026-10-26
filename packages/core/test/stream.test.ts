import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LedeStream, parse } from '../src/index.ts';

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
