// Pipe rows (D80, spec §4.11 and §4.14): `NAME: a | b | c` rows of a declared data set, and the inline table block form
// `table [options] = header` followed by `: a | b` rows. Conformance cases 42 and 43 and error case e51 pin the AST and the diagnostics;
// these tests pin the rules behind them, the stream and `--fix`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeParser, LedeStream, fix, parse, type Block, type StreamEvent, type TableBlock } from '../src/index.ts';
import { splitPipes } from '../src/lex.ts';

const codes = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);
const rows = (src: string, name: string) => parse(src).data[name].rows;
const types = (bs: Block[]) => bs.map((b) => b.type);
const kinds = (events: StreamEvent[]) =>
  events.map((e) => (e.kind === 'block' ? `block:${e.block.type}` : 'data' in e ? `update:data ${e.data}` : `${e.kind}:${e.block.type}`));

// ---------------------------------------------------------------- the split

test('splitPipes splits at a pipe with whitespace or an end of the text on each side, and nowhere else', () => {
  assert.deepEqual(splitPipes('a | b | c'), ['a', 'b', 'c']);
  assert.deepEqual(splitPipes('a|b'), ['a|b']);
  assert.deepEqual(splitPipes('a |b'), ['a |b']);
  assert.deepEqual(splitPipes('a| b'), ['a| b']);
  assert.deepEqual(splitPipes('a || b'), ['a || b']);
  assert.deepEqual(splitPipes('a | | c'), ['a', '', 'c'], 'two pipes with a blank between them hold an empty field');
  assert.deepEqual(splitPipes('| b |'), ['', 'b', ''], 'a pipe at either end of the text is a separator too');
  assert.deepEqual(splitPipes('x, "y; z" | **b, c**'), ['x, "y; z"', '**b, c**'], 'commas, semicolons and quotes are ordinary');
  assert.deepEqual(splitPipes('plain'), ['plain']);
  assert.deepEqual(splitPipes(''), ['']);
  assert.deepEqual(splitPipes('a\t|\tb'), ['a', 'b'], 'a tab is whitespace');
});

// ---------------------------------------------------------------- NAME: a | b | c

test('NAME: a | b | c appends a row to a declared data set; fields are trimmed and nothing is quoted or merged', () => {
  const src = [
    'data costs = service,usd,note',
    'costs: Compute | 18,400 | "burst" pricing, Q3',
    'costs:   Storage, S3|x |   6,100 | archive tier; cold',
    'costs: Net | 1,450 | ',
  ].join('\n');
  assert.deepEqual(rows(src, 'costs'), [
    ['Compute', '18,400', '"burst" pricing, Q3'],
    ['Storage, S3|x', '6,100', 'archive tier; cold'],
    ['Net', '1,450', ''],
  ]);
});

test('the form is a keyword line only for a declared data name with a pipe separator; any other NAME: line is prose', () => {
  const prose = (src: string) => parse(src).blocks.filter((b) => b.type === 'paragraph').length;
  // Not a data name, or declared only below the line, or no separator: prose, no diagnostic.
  assert.equal(prose('note: see below | above\n'), 1);
  assert.equal(prose('costs: a | b\n\ndata costs = x,y\n'), 1);
  assert.equal(prose('data costs = x,y\ncosts: one field only\n'), 1);
  assert.equal(prose('data costs = x,y\ncosts: a|b\n'), 1);
  assert.deepEqual(codes('data costs = x,y\nnote: a | b\ncosts: a|b\n'), []);
  // A name that is also a keyword word stays a name: `table:` is not the word `table`.
  assert.deepEqual(rows('data table = x,y\ntable: 1 | 2\n', 'table'), [['1', '2']]);
  // A data name that starts with an underscore is not a `NAME:` line at all (names in these lines start with a letter).
  assert.equal(prose('data _x = a,b\n_x: 1 | 2\n'), 1);
});

test('a bucket set or a diagram of the same name has the line first (the clash is an error already)', () => {
  const doc = parse('data flow = a,b\ndiagram flow\nflow: x -> y\nflow: 1 | 2\n');
  const d = doc.blocks.find((b) => b.type === 'diagram');
  assert.ok(d?.type === 'diagram');
  assert.ok(d.edges.length === 1);
  assert.deepEqual(doc.data.flow.rows, [], 'the data got no row');
  assert.ok(doc.diagnostics.some((x) => x.code === 'name-clash'));
});

test('a row with the wrong number of fields is E data-row-width, padded or cut, with the same detail as the old form', () => {
  const doc = parse('data costs = a,b,c\ncosts: 1 | 2\ncosts: 1 | 2 | 3 | 4\n');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.code, d.line, d.col, d.detail]),
    [
      ['data-row-width', 2, 8, { fields: 2, want: 3, name: 'costs' }],
      ['data-row-width', 3, 8, { fields: 4, want: 3, name: 'costs' }],
    ],
  );
  assert.deepEqual(doc.data.costs.rows, [
    ['1', '2', ''],
    ['1', '2', '3'],
  ]);
  assert.match(doc.diagnostics[0].message, /separated by " \| "/);
});

test('a thousands comma in a pipe row is text: nothing merges or warns', () => {
  // The old form reads `a,1,450` as three fields and merges the last two; a pipe row has the fields it was given.
  assert.deepEqual(codes('data d = k,v\nd: a | 1,450\n'), []);
  assert.deepEqual(codes('data d = k,v\nd: a | 1 | 450\n'), ['error:data-row-width@2']);
});

test('the pipe row goes to the data set as it stands: a redefinition starts over, a file set takes rows too', () => {
  assert.deepEqual(rows('data d = a,b\nd: 1 | 2\ndata d = c,d\nd: 3 | 4\n', 'd'), [['3', '4']]);
  const doc = parse('data f < x.csv\nf: 9 | 8\n', { loadFile: () => 'a,b\n1,2' });
  assert.deepEqual(doc.data.f.rows, [
    ['1', '2'],
    ['9', '8'],
  ]);
});

test('a pipe row is in step with +=: a chart over the data sees both', () => {
  const doc = parse('data d = k,v\nd: a | 1\ndata d += b,2\nd: c | 3\nchart bar d\n');
  assert.deepEqual(doc.diagnostics, []);
  assert.equal(doc.data.d.rows.length, 3);
});

// ---------------------------------------------------------------- table block form

test('a table with a header and no rows takes `: a | b` rows until the first other line', () => {
  const src = 'table = Option | Cost, USD | Verdict\n: Managed | 1,200 | **Fits**, mostly; cheap\n: Self | 3,400 | No\nAfter.\n';
  const doc = parse(src);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(types(doc.blocks), ['table', 'paragraph']);
  const t = doc.blocks[0] as TableBlock;
  assert.equal(t.line, 1);
  assert.deepEqual(doc.data[t.data].columns, ['Option', 'Cost, USD', 'Verdict']);
  assert.deepEqual(doc.data[t.data].rows, [
    ['Managed', '1,200', '**Fits**, mostly; cheap'],
    ['Self', '3,400', 'No'],
  ]);
});

test('a comma header opens the block form too, and options read the rows the table ends up with', () => {
  const doc = parse('table heat bar=n = k,n\n: a | 5\n: b | 9\n');
  assert.deepEqual(doc.diagnostics, [], 'heat and bar= see numbers that arrive after the table line');
  const t = doc.blocks[0] as TableBlock;
  assert.equal(t.heat, true);
  assert.deepEqual(t.bars, ['n']);
  // The same options over a table with no rows are the old warnings, reported on the table's own line.
  assert.deepEqual(codes('table bar=n = k,n\nafter\n'), ['warning:table-option@1']);
});

test('a blank line, a heading, a data line, a paragraph or another table ends the run; a `:` line after that is prose', () => {
  for (const end of ['', '# H', 'data x = a,b', 'table = c | d', 'text']) {
    const doc = parse(`table = a | b\n: 1 | 2\n${end}\n: 3 | 4\n`);
    const first = doc.blocks[0] as TableBlock;
    assert.equal(doc.data[first.data].rows.length, 1, `after ${JSON.stringify(end)}`);
    // The second `:` line is the first of the next table's rows when another table opened, and text otherwise.
    if (end.startsWith('table')) assert.deepEqual(doc.data._table2.rows, [['3', '4']]);
    else assert.ok(JSON.stringify(doc.blocks).includes(': 3 | 4'), `after ${JSON.stringify(end)}`);
  }
});

test('a `:` line that is not under an open table is prose, and a table with a row on its own line takes none', () => {
  assert.deepEqual(types(parse(': a | b\n').blocks), ['paragraph']);
  assert.deepEqual(types(parse('table = a,b; 1,2\n: 3 | 4\n').blocks), ['table', 'paragraph']);
  assert.deepEqual(types(parse('table = a | b\n\n: 1 | 2\n').blocks), ['table', 'paragraph']);
  assert.deepEqual(codes('table = a | b\n\n: 1 | 2\n'), []);
});

test('a `:` row can be a single field, an empty field, or a markdown-style row with a pipe at each end', () => {
  assert.deepEqual(parse('table = n\n: a\n: b\n').data._table1.rows, [['a'], ['b']]);
  assert.deepEqual(parse('table = a | b | c\n: 1 | | 3\n: | 2 |\n').data._table1.rows, [
    ['1', '', '3'],
    ['', '2', ''],
  ]);
});

test('a pipe header is read only when a separator sits outside double quotes: a quoted ` | ` stays an old-form cell', () => {
  const old = parse('table = "a | b",c; 1,2\n');
  assert.deepEqual(old.data._table1.columns, ['a | b', 'c']);
  assert.deepEqual(old.data._table1.rows, [['1', '2']]);
  assert.deepEqual(parse('table = a,"b | c"; 1,2\n').data._table1.columns, ['a', 'b | c']);
  // An unquoted separator in the header is the pipe form, which has no rows of its own: `;` and `,` are text.
  assert.deepEqual(parse('table = a, b | c; d\n').data._table1.columns, ['a, b', 'c; d']);
});

test('a wrong count in a table row is E data-row-width on that row, and a bad option is reported on the table line', () => {
  const src = 'table cols=Nope = A | B\n: x | y\n: 1\n';
  const doc = parse(src);
  assert.deepEqual(
    doc.diagnostics.map((d) => `${d.code}@${d.line}`),
    ['data-row-width@3', 'unknown-column@1'],
  );
  assert.deepEqual(doc.diagnostics[0].detail, { fields: 1, want: 2, name: '_table1' });
  assert.deepEqual(types(doc.blocks), [], 'a table with an unknown column draws nothing, as before');
});

test('an unclosed table ends with the document, and the block is the document last', () => {
  const doc = parse('# T\ntable = a | b\n: 1 | 2');
  assert.deepEqual(types(doc.blocks), ['heading', 'table']);
  assert.deepEqual(doc.data._table1.rows, [['1', '2']]);
});

test('a block-form table inside a cards run belongs to its card, and inside a grid it counts once', () => {
  const cards = parse('cards\n### A\ntable = k | v\n: a | 1\n### B\n- x\n');
  const run = cards.blocks[0];
  assert.ok(run.type === 'cards');
  assert.deepEqual(
    run.items.map((c) => c.blocks.map((b) => b.type)),
    [['table'], ['list']],
  );
  const grid = parse('grid 2\ntable = k | v\n: a | 1\ntable = k | v\n: b | 2\n');
  assert.deepEqual(codes('grid 2\ntable = k | v\n: a | 1\ntable = k | v\n: b | 2\n'), []);
  assert.deepEqual(types(grid.blocks), ['grid']);
  assert.equal((grid.blocks[0] as { children: unknown[] }).children.length, 2);
});

test('the old inline form is read as it was: the same block, the same data, and a header-only table still ends at its line', () => {
  for (const src of ['table = a,b; 1,2; 3,4\n', 'table title="T" = a,b; 1,2\n', 'table = a,b\n']) {
    const doc = parse(src);
    assert.deepEqual(types(doc.blocks), ['table'], src);
    assert.deepEqual(doc.diagnostics, [], src);
  }
});

// ---------------------------------------------------------------- streaming

test('a run of data row lines is one update event, given when the run ends; the rows are in the data as each line is read', () => {
  const s = new LedeStream();
  assert.deepEqual(kinds(s.events('data d = a,b\nd: 1 | 2\nd: 3 | 4\n')), ['block:data']);
  assert.equal(s.doc.data.d.rows.length, 2);
  assert.equal(s.snapshot().data.d.rows.length, 2, 'snapshot() shows the rows so far');
  // A row that is rejected still reaches the data (padded), as `+=` does, so it is part of the run; a blank line does not end it.
  assert.deepEqual(kinds(s.events('d: 5 | 6 | 7\n\n')), []);
  assert.equal(s.doc.data.d.rows.length, 3);
  // Prose ends the run: its update comes before the line's own events.
  assert.deepEqual(kinds(s.events('note: x | y\n')), ['update:data d']);
  assert.deepEqual(kinds(s.events('more prose\n')), []);
  // A row of another set ends the run too, and `+=` is an update of its own at once.
  const t = new LedeStream();
  const ev = kinds(t.events('data a = x,y\ndata b = x,y\na: 1 | 2\na: 3 | 4\nb: 5 | 6\ndata b += 7,8\n'));
  assert.deepEqual(ev, ['block:data', 'block:data', 'update:data a', 'update:data b', 'update:data b']);
  // The document's end gives the update of a run still open.
  const u = new LedeStream();
  u.events('data a = x,y\n');
  u.events('a: 1 | 2\na: 3 | 4\n');
  const seen: string[] = [];
  u.end((e) => seen.push(...kinds([e])));
  assert.deepEqual(seen, ['update:data a']);
});

test('a streamed table of N rows is one data update, not N', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `d: r${i} | ${i}`).join('\n');
  const s = new LedeStream();
  const ev = kinds([...s.events(`data d = k,v\nchart line d x=k y=v\n${lines}\n`), ...s.events('\nAfter.\n')]);
  assert.equal(ev.filter((k) => k === 'update:data d').length, 1);
  assert.equal(s.doc.data.d.rows.length, 40);
});

test('an open block-form table is returned when it closes; tail() shows it with the rows so far; snapshot() draws it too', () => {
  const s = new LedeStream();
  assert.deepEqual(kinds(s.events('table = Option | Cost\n')), []);
  assert.deepEqual(types(s.tail()), ['table'], 'a header alone is a table with no rows, open');
  assert.deepEqual(kinds(s.events(': A | 1\n: B | 2\n')), []);
  const open = s.tail()[0] as TableBlock;
  assert.deepEqual(s.doc.data[open.data].rows, [
    ['A', '1'],
    ['B', '2'],
  ]);
  assert.deepEqual(types(s.snapshot().blocks), ['table'], 'snapshot() ends the open table');
  assert.deepEqual(kinds(s.events('\n')), ['block:table'], 'the blank line closes it, and the block is returned then');
  assert.deepEqual(s.tail(), []);
  assert.deepEqual(types(s.snapshot().blocks), ['table']);
  // The document's own end() returns a table that was still open.
  const t = new LedeStream();
  t.events('table = a | b\n: 1 | 2\n');
  const seen: string[] = [];
  t.end((e) => seen.push(...kinds([e])));
  assert.deepEqual(seen, ['block:table']);
});

test('what tail() reads of an open table is not reported: a bad option is one diagnostic, at the close', () => {
  const s = new LedeStream();
  const seen = () => s.doc.diagnostics.map((d) => `${d.code}@${d.line}`);
  s.events('table bar=n = k | n\n: a | x\n');
  s.tail();
  s.tail();
  assert.deepEqual(seen(), []);
  s.events('after\n');
  assert.deepEqual(seen(), ['table-option@1']);
});

test('blocks and events are the same whatever the chunking, over a page of both forms', () => {
  const src = [
    '# Costs',
    'data costs = service,usd,note',
    'costs: Compute | 18,400 | "burst" pricing, Q3',
    'costs: Storage, S3 | 6,100 | archive tier; cold',
    '',
    'table title="Options" heat = Option | Cost | Verdict',
    ': Managed queue | 1,200 | **Fits**, mostly',
    ': Self-hosted | 3,400 | Needs an on-call rota',
    '## Next',
    'table = a,b',
    ': 1 | 2',
    '',
  ].join('\n');
  const final = parse(src);
  assert.deepEqual(final.diagnostics, []);
  for (const n of [1, 3, 7, 64]) {
    const s = new LedeStream();
    const seen: Block[] = [];
    for (let i = 0; i < src.length; i += n) for (const b of s.write(src.slice(i, i + n))) seen.push(b);
    assert.deepEqual(s.end(), final, `chunks of ${n}`);
    assert.deepEqual([...seen, ...final.blocks.slice(seen.length)], final.blocks, `chunks of ${n}`);
  }
  // Every line prefix: the snapshot is a whole document, and its blocks but the last are the final ones.
  const lines = src.split('\n');
  for (let n = 1; n < lines.length; n++) {
    const s = new LedeStream();
    s.write(`${lines.slice(0, n).join('\n')}\n`);
    const snap = s.snapshot();
    assert.deepEqual(
      snap.blocks.slice(0, -1).map((b) => b.type),
      final.blocks.slice(0, snap.blocks.length - 1).map((b) => b.type),
      `after line ${n}`,
    );
  }
});

test('the parser hook fires for a pipe row of a data set and never for the rows of an inline table', () => {
  const seen: string[] = [];
  const p = new LedeParser({}, { onDiagramLine: () => {}, onDataAppend: (n) => seen.push(n) });
  for (const l of ['data d = a,b', 'd: 1 | 2', 'table = x | y', ': 1 | 2', '']) p.pushLine(l);
  assert.deepEqual(seen, ['d']);
});

// ---------------------------------------------------------------- check --fix

test('--fix leaves pipe rows and block-form tables alone, and still repairs the rest of the page', () => {
  const page = [
    '#### Deep heading',
    'data costs = service,usd,note',
    'costs: Compute | 18,400 | "burst" pricing, Q3',
    'costs: Storage, S3 | 6,100 | archive tier; cold',
    '',
    'table = Option | Cost, USD | Verdict',
    ': Managed queue | 1,200 | **Fits**, mostly; cheap',
    ': Self-hosted | 3,400 | Needs an on-call rota',
    '',
    'data runs = week,deploys; W1,14; W2,19, 7',
  ].join('\n');
  const r = fix(page);
  assert.deepEqual(r.src.split('\n').slice(1, 9), page.split('\n').slice(1, 9), 'no pipe row or header was rewritten');
  assert.match(r.src.split('\n')[0], /^###\s/);
  assert.ok(
    r.applied.every((a) => a.line === 1 || a.line === 10),
    JSON.stringify(r.applied),
  );
  assert.equal(r.remaining.filter((d) => d.severity === 'error').length, 0);
  // A page that is already right is returned as it is.
  const ok = page.split('\n').slice(1, 9).join('\n');
  assert.deepEqual(fix(ok), { src: ok, applied: [], remaining: [] });
});

test('--fix does not touch a pipe row with the wrong count, and does not guess at one', () => {
  const page = 'data d = a,b,c\nd: 1 | 2\n\ntable = x | y\n: 1 | 2 | 3\n';
  const r = fix(page);
  assert.equal(r.src, page);
  assert.deepEqual(r.applied, []);
  assert.deepEqual(
    r.remaining.map((d) => d.code),
    ['data-row-width', 'data-row-width'],
  );
});

test('--fix on `table vendors = A | B` drops the name as before and keeps the rows', () => {
  const r = fix('table vendors = A | B\n: 1 | 2\n');
  assert.equal(r.src, 'table = A | B\n: 1 | 2\n');
  assert.deepEqual(r.remaining, []);
});
