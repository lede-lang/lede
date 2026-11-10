// Inputs that used to crash the parser, lose text or split the two ways of reading a document apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, dataSet, parse, parseInlineCsv } from '../src/index.ts';
import { parseCsvFile } from '../src/lex.ts';

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

test('a block whose column a later redefinition took away is an error, and only then', () => {
  const doc = parse('data d = x,y; a,1; b,2\nchart area d\ntable d sort=y\ntable d\nkpi Last | =d.y\ndata d = p,q; a,5\nchart bar d\n');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.severity, d.code, d.line, d.detail ?? null]),
    [
      ['warning', 'data-redefined', 6, null],
      ['error', 'data-redefined', 2, { name: 'd', columns: ['x', 'y'], redefined: 6 }],
      ['error', 'data-redefined', 3, { name: 'd', columns: ['y'], redefined: 6 }],
      ['error', 'data-redefined', 5, { name: 'd', columns: ['y'], redefined: 6 }],
    ],
  );
  // The same columns under the new definition: only the warning. A column that never was: only the error on its own line.
  assert.deepEqual(codes('data d = x,y; a,1\nchart line d\nkpi K | =d.y\ndata d = x,y; a,2\n'), ['data-redefined']);
  assert.deepEqual(codes('data d = x,y; a,1\nkpi K | =d.nope\n'), ['unknown-column']);
});

test('words that spill out of an unquoted option value are one warning that names the fix, and an open quote is one too', () => {
  const messages = (line: string) =>
    parse(`data z = a,b; x,5; y,7\n${line}\n`).diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`);
  assert.deepEqual(messages('chart bar z title=Deploys per week stack'), [
    'warning chart-option: ignored chart option "per week"; a value with a space needs quotes: title="Deploys per week"',
  ]);
  assert.deepEqual(messages('chart bar z nope title=Cost ($K)'), [
    'warning chart-option: ignored chart option "($K)"; a value with a space needs quotes: title="Cost ($K)"',
    'warning chart-option: ignored chart option "nope"',
  ]);
  assert.deepEqual(messages('table z title=Top five rows limit=1'), [
    'warning table-option: ignored table option "five rows"; a value with a space needs quotes: title="Top five rows"',
  ]);
  assert.deepEqual(messages('chart line z title="Deploys per week y=b'), [
    'warning chart-option: a " is never closed, so the rest of the line, "Deploys per week y=b", is read as one value; close it before the next option',
  ]);
  assert.deepEqual(
    parse('diagram flow title="Order path dir=LR\nflow: a -> b\n').diagnostics.map((d) => d.code),
    ['diagram-option'],
  );
  // A column name with a space runs on by design, and a closed quote is not a spill.
  assert.deepEqual(messages('chart bar z x=a y=b title="Deploys per week" labels'), []);
});

test('a data file is read as CSV: `;` is text, a quoted cell may hold a line break, CRLF and a byte-order mark are dropped', () => {
  const file = '\ufeffname,note,n\r\n"Smith, J",late; then fixed,1\r\n\r\nx,"line one\nline two",2\r\n"he said ""hi""",C:\\,3\r\n';
  const doc = parse('data d < f.csv\ntable d\n', { loadFile: () => file });
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(dataSet(doc, 'd'), {
    name: 'd',
    columns: ['name', 'note', 'n'],
    rows: [
      ['Smith, J', 'late; then fixed', '1'],
      ['x', 'line one\nline two', '2'],
      ['he said "hi"', 'C:\\', '3'],
    ],
    line: 1,
  });
  assert.deepEqual(parseCsvFile('a,b\n1,\n,2\n"" \n \nx,y,').rows, [['a', 'b'], ['1', ''], ['', '2'], [''], ['x', 'y', '']]);
  const open = parse('data d < f.csv\n', { loadFile: () => 'a,b\n1,2\n"open,3\n4,5\n' });
  assert.deepEqual(
    open.diagnostics.map((x) => [x.code, x.message]),
    [
      ['csv-quote', 'unclosed " on line 3 of f.csv'],
      ['data-row-width', open.diagnostics[1]?.message],
    ],
  );
});
