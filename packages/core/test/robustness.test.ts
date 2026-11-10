// Inputs that used to crash the parser, lose text or split the two ways of reading a document apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, dataSet, parse, parseInlineCsv } from '../src/index.ts';

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);

test('a data name an object inherits is unknown until it is declared, and a set like any other after', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.deepEqual(codes(`chart bar ${name}\n`), ['unknown-data'], `chart bar ${name}`);
    assert.deepEqual(codes(`table ${name}\n`), ['unknown-data'], `table ${name}`);
    assert.deepEqual(codes(`kpi X | =${name}.a\n`), ['unknown-data'], `kpi =${name}.a`);
    assert.deepEqual(codes(`data ${name} += 1,2\n`), ['unknown-data'], `data ${name} +=`);
    const doc = parse(`data ${name} = a,b; x,2\ndata ${name} += y,3\nchart bar ${name}\ntable ${name}\nkpi Last | =${name}.b\n`);
    assert.deepEqual(doc.diagnostics, [], name);
    assert.deepEqual(dataSet(doc, name)?.rows, [
      ['x', '2'],
      ['y', '3'],
    ]);
    assert.deepEqual(Object.keys(doc.data), [name]);
    // The document survives JSON, which is how `lede ast` hands it on.
    const back = JSON.parse(JSON.stringify(doc)) as typeof doc;
    assert.deepEqual(dataSet(back, name)?.columns, ['a', 'b']);
  }
  assert.equal(dataSet(parse('# Hi\n'), 'constructor'), undefined);
});

test('min= not below max= is reported and neither is kept', () => {
  for (const opts of ['min=10 max=10', 'min=10 max=2', 'min=0 max=0']) {
    const doc = parse(`data z = a,b; x,5; y,7\nchart line z ${opts}\n`);
    assert.deepEqual(
      doc.diagnostics.map((d) => [d.severity, d.code, d.line]),
      [['warning', 'chart-option', 2]],
      opts,
    );
    const chart = doc.blocks.find((b) => b.type === 'chart');
    assert.ok(chart?.type === 'chart' && chart.min === null && chart.max === null, opts);
  }
  const ok = parse('data z = a,b; x,5; y,7\nchart line z min=2 max=9\nchart range z from=b to=b min=1 max=3\n');
  assert.deepEqual(ok.diagnostics, []);
});

test('parse and LedeStream agree when the text ends inside an open fence', () => {
  for (const src of ['```js\nlet a = 1;\n', '```js\nlet a = 1;', '```\n', '```\n\n', 'template t |\n```\nDear {name}\n']) {
    const whole = parse(src);
    for (const size of [1, 2, 3, 1000]) {
      const s = new LedeStream();
      for (let i = 0; i < src.length; i += size) s.write(src.slice(i, i + size));
      assert.deepEqual(s.end(), whole, `${JSON.stringify(src)} in chunks of ${size}`);
    }
  }
  const code = parse('```\na\n').blocks[0];
  assert.ok(code.type === 'code' && code.text === 'a');
});

test('a fence with more lines than a call takes arguments still parses', () => {
  const doc = parse(`\`\`\`\n${'  x\n'.repeat(150_000)}\`\`\`\n`);
  const code = doc.blocks[0];
  assert.ok(code.type === 'code' && code.text.startsWith('x\nx\n'));
});

test('an arrow inside a quoted label is text, not an edge', () => {
  const doc = parse('diagram arch\narch: api "Payments -> API" service\narch: db "a <-> b" "x --> y"\narch: api -> db : says "x -> y"\n');
  assert.deepEqual(doc.diagnostics, []);
  const d = doc.blocks[0];
  assert.ok(d.type === 'diagram');
  assert.deepEqual(
    d.nodes.map((n) => [n.id, n.label, n.sub ?? null]),
    [
      ['api', 'Payments -> API', null],
      ['db', 'a <-> b', 'x --> y'],
    ],
  );
  assert.deepEqual(
    d.edges.map((e) => [e.from, e.to, e.label]),
    [['api', 'db', 'says "x -> y"']],
  );
  // A quoted id in an edge is still refused, with the hint.
  assert.deepEqual(codes('diagram arch\narch: db\narch: "bad" -> db\n'), ['diagram-syntax']);
});

test('text after the closing quote of a cell stays in the cell', () => {
  assert.deepEqual(parseInlineCsv('name,n; "Hello" world,2; "Smith, J" (PM),3').rows, [
    ['name', 'n'],
    ['Hello world', '2'],
    ['Smith, J (PM)', '3'],
  ]);
  assert.deepEqual(parseInlineCsv('"a" , "b" ; "c"  ').rows, [['a', 'b'], ['c']]);
});

test('a group cycle of any length is one error', () => {
  const cyc = (lines: string) =>
    parse(`diagram d\n${lines}`)
      .diagnostics.filter((x) => x.code === 'diagram-group-cycle')
      .map((x) => x.message);
  assert.deepEqual(cyc('d: group a "A" a, x\n'), ['group a contains itself']);
  assert.deepEqual(cyc('d: group a "A" b, x\nd: group b "B" a\n'), ['groups a and b contain each other']);
  assert.deepEqual(cyc('d: group a "A" b, x\nd: group b "B" c\nd: group c "C" a\n'), ['groups a, b and c contain each other']);
  // A group two others hold is nesting twice over, not a cycle.
  assert.deepEqual(cyc('d: group a "A" b, c\nd: group b "B" e\nd: group c "C" e\nd: group e "E" x\n'), []);
});
