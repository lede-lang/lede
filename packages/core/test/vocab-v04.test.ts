// Vocabulary v0.4 (spec Appendix F): cards, chart range, progress bars, step, chart annotations, diagram legend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  KEYWORDS,
  LedeStream,
  parse,
  type Block,
  type CardsBlock,
  type ChartBlock,
  type DiagramBlock,
  type KpiBlock,
  type StepsBlock,
  type TableBlock,
} from '../src/index.ts';

const codes = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);
const only = <T extends Block>(src: string, type: T['type']) => parse(src).blocks.filter((b): b is T => b.type === type);

// ---------------------------------------------------------------- keywords

test('cards and step are keywords; diagrams cannot take those names', () => {
  assert.ok(KEYWORDS.includes('cards'));
  assert.ok(KEYWORDS.includes('step'));
  assert.deepEqual(codes('diagram step\n'), ['error:diagram-name@1']);
  assert.deepEqual(codes('diagram cards\n'), ['error:diagram-name@1']);
});

// ---------------------------------------------------------------- cards

test('cards: ### sections become cards; # / ## / --- / cards / end of file close the run', () => {
  const src = 'cards\n### A\ntext a\n### B\n- b\n## Next\ncards\n### C\n---\ncards\n### D\ncards\n### E\n';
  const doc = parse(src);
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['cards', 'heading', 'cards', 'rule', 'cards', 'cards'],
  );
  const first = doc.blocks[0] as CardsBlock;
  assert.deepEqual(
    first.items.map((c) => [c.title, c.line, c.blocks.map((b) => b.type)]),
    [
      ['A', 2, ['paragraph']],
      ['B', 4, ['list']],
    ],
  );
  assert.equal(first.line, 1);
});

test('cards: content before the first ### is ordinary; a run with no ### warns and is dropped', () => {
  const doc = parse('cards\nIntro.\n### A\nx\n');
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['paragraph', 'cards'],
  );
  assert.deepEqual(codes('cards\nJust prose.\n'), ['warning:cards-empty@1']);
  assert.deepEqual(
    parse('cards\nJust prose.\n').blocks.map((b) => b.type),
    ['paragraph'],
  );
  assert.deepEqual(codes('cards\n## H\n'), ['warning:cards-empty@1']);
});

test('cards: a diagram is shown after the cards and still takes its lines; a grid ends the run', () => {
  const doc = parse('cards\n### A\ndiagram d\nd: a -> b\nmore a\n### B\nb\n## End\n');
  assert.deepEqual(
    doc.diagnostics.map((d) => `${d.code}@${d.line}`),
    ['cards-content@3'],
  );
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['cards', 'diagram', 'heading'],
  );
  assert.equal((doc.blocks[1] as DiagramBlock).edges.length, 1);
  assert.deepEqual(
    (doc.blocks[0] as CardsBlock).items[0].blocks.map((b) => b.type),
    ['paragraph'],
  );
  const g = parse('cards\n### A\nx\ngrid 2\n- y\n- z\n\nw\n');
  assert.deepEqual(
    g.diagnostics.map((d) => `${d.code}@${d.line}`),
    ['cards-content@4'],
  );
  assert.deepEqual(
    g.blocks.map((b) => b.type),
    ['cards', 'grid'],
  );
});

test('cards: data lines stay at the top level; kpi references inside a card resolve', () => {
  const doc = parse('cards\n### A\ndata m = k,v; a,1; b,4\nkpi V | =m.v\n');
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['data', 'cards'],
  );
  const k = (doc.blocks[1] as CardsBlock).items[0].blocks[0] as KpiBlock;
  assert.equal(k.items[0].value, '4');
  assert.equal(k.items[0].delta, '+3');
});

test('cards: an open grid closes at the cards line; cards with text after it is prose', () => {
  assert.deepEqual(codes('grid 2\n- a\n\ncards\n### A\nx\n'), ['warning:grid-unfilled@1']);
  assert.deepEqual(parse('cards on the table\n').blocks, [{ type: 'paragraph', text: 'cards on the table', line: 1 }]);
  assert.deepEqual(parse('\\cards\n').blocks, [{ type: 'paragraph', text: 'cards', line: 1 }]);
});

// ---------------------------------------------------------------- chart range

const RANGE = 'data n = item,lo,hi,now; A,1,5,3; B,2,9,\ndata t = item,s,e; X,2026-03-01,2026-04-15; Y,2026-04-01,2026-06-30\n';

test('chart range: from/to/at/bands on a number axis; y is empty; labels/stack mean nothing', () => {
  const [c] = only<ChartBlock>(`${RANGE}chart range n from=lo to=hi at=now bands=4,8 target="6 cap" unit=ms labels stack`, 'chart');
  assert.deepEqual(
    { kind: c.kind, x: c.x, y: c.y, from: c.from, to: c.to, at: c.at, bands: c.bands, target: c.target, labels: c.labels, stack: c.stack },
    {
      kind: 'range',
      x: 'item',
      y: [],
      from: 'lo',
      to: 'hi',
      at: 'now',
      bands: ['4', '8'],
      target: { value: 6, label: 'cap' },
      labels: false,
      stack: false,
    },
  );
  assert.equal('labelMode' in c, false);
});

test('chart range: ISO dates; a date target is stored as UTC epoch milliseconds', () => {
  const doc = parse(`${RANGE}chart range t from=s to=e target="2026-05-01 freeze"`);
  assert.deepEqual(doc.diagnostics, []);
  const c = doc.blocks.find((b): b is ChartBlock => b.type === 'chart')!;
  assert.deepEqual(c.target, { value: Date.UTC(2026, 4, 1), label: 'freeze' });
  assert.equal('at' in c, false);
  assert.equal('bands' in c, false);
});

test('chart range: mixed kinds, unknown or missing columns are errors; too many bands warn', () => {
  assert.deepEqual(codes('data m = i,a,b; X,2026-01-01,4\nchart range m from=a to=b\n'), ['error:chart-range-kind@2']);
  assert.deepEqual(codes(`${RANGE}chart range n from=lo to=zz`), ['error:unknown-column@3']);
  assert.deepEqual(codes(`${RANGE}chart range n to=hi`), ['error:unknown-column@3']);
  assert.deepEqual(codes(`${RANGE}chart range n from=lo to=hi bands=1,2,3,4,5`), ['warning:bands-limit@3']);
  assert.deepEqual(only<ChartBlock>(`${RANGE}chart range n from=lo to=hi bands=1,2,3,4,5`, 'chart')[0].bands, ['1', '2', '3', '4']);
  assert.deepEqual(codes(`${RANGE}chart range n from=lo to=hi target="2026-01-01 x"`), ['error:chart-option@3']);
});

test('chart range does not change other kinds: date-like cells still make bar charts complain as before', () => {
  assert.deepEqual(codes('data t = i,s; X,2026-03-01\nchart bar t\n'), ['error:chart-no-series@2']);
});

// ---------------------------------------------------------------- progress bars

test('table target= needs bar= and a numeric column, else a warning and no key', () => {
  const src = 'data g = team,done,goal,who; P,64,80,a; Q,91,85,b\n';
  assert.equal(only<TableBlock>(`${src}table g bar=done target=goal`, 'table')[0].targetCol, 'goal');
  assert.equal(only<TableBlock>(`${src}table g bar=done target=GOAL`, 'table')[0].targetCol, 'goal');
  for (const bad of ['table g target=goal', 'table g bar=done target=who', 'table g bar=done target=zz']) {
    assert.deepEqual(codes(`${src}${bad}`), ['warning:table-option@2'], bad);
    assert.equal('targetCol' in only<TableBlock>(`${src}${bad}`, 'table')[0], false);
  }
});

test('kpi bar: a field exactly bar after the value; never a tone or note; 0-100 only', () => {
  const k = only<KpiBlock>('kpi A | 58% | | bar\nkpi B | 40 | +2 | good | bar\nkpi C | 7 | note\nkpi bar | 5\n', 'kpis')[0].items;
  assert.deepEqual(
    k.map((x) => [x.label, x.delta, x.tone, x.note, x.bar ?? null]),
    [
      ['A', '', null, '', true],
      ['B', '+2', 'good', '', true],
      ['C', 'note', null, '', null],
      ['bar', '', null, '', null],
    ],
  );
  assert.equal('bar' in k[2], false);
  assert.deepEqual(codes('kpi A | 120% | | bar\n'), ['warning:kpi-bar@1']);
  assert.deepEqual(codes('kpi A | $5 | | bar\n'), ['warning:kpi-bar@1']);
  const bad = only<KpiBlock>('kpi A | done | | bar\n', 'kpis')[0].items[0];
  assert.equal('bar' in bad, false);
  assert.equal(bad.note, '');
});

// ---------------------------------------------------------------- step

test('step: consecutive lines merge; missing fields are empty; extra pipes stay in the note', () => {
  const [s] = only<StepsBlock>('step A | by 9 | n\nstep B | done\nstep C\nstep D | x | y | z\n', 'steps');
  assert.deepEqual(s.items, [
    { title: 'A', due: 'by 9', note: 'n', line: 1 },
    { title: 'B', due: 'done', note: '', line: 2 },
    { title: 'C', due: '', note: '', line: 3 },
    { title: 'D', due: 'x', note: 'y | z', line: 4 },
  ]);
  assert.equal(s.line, 1);
  assert.equal(only<StepsBlock>('step A\n\nstep B\n', 'steps').length, 2);
  assert.equal(only<StepsBlock>('step A\nprose\nstep B\n', 'steps').length, 2);
});

test('step: only the word step followed by a space starts one; \\step escapes; no title warns', () => {
  assert.deepEqual(
    parse('steps matter\nstepwise\n').blocks.map((b) => b.type),
    ['paragraph'],
  );
  assert.deepEqual(parse('\\step one\n').blocks, [{ type: 'paragraph', text: 'step one', line: 1 }]);
  assert.deepEqual(codes('step\nstep | x\n'), ['warning:step-syntax@1', 'warning:step-syntax@2']);
  assert.deepEqual(
    parse('1. a\n2. b\n').blocks.map((b) => b.type),
    ['list'],
  );
});

// ---------------------------------------------------------------- chart annotations

const Q = 'data q = quarter,v; Q1,1; Q2,2; Q3 est,3\n';

test('labels=end|all keep labels true and add labelMode; bare labels has no labelMode', () => {
  const [e, a, bare] = only<ChartBlock>(`${Q}chart line q labels=end\nchart bar q labels=all\nchart bar q labels`, 'chart');
  assert.deepEqual([e.labels, e.labelMode, a.labels, a.labelMode], [true, 'end', true, 'all']);
  assert.equal(bare.labels, true);
  assert.equal('labelMode' in bare, false);
  assert.deepEqual(codes(`${Q}chart bar q labels=some`), ['warning:chart-option@2']);
});

test('hatch= repeats, must be an x value, and is omitted when unused', () => {
  const [c] = only<ChartBlock>(`${Q}chart bar q hatch="Q3 est" hatch=Q1 hatch=Q1`, 'chart');
  assert.deepEqual(c.hatch, ['Q3 est', 'Q1']);
  assert.deepEqual(codes(`${Q}chart bar q hatch=Q9`), ['warning:chart-option@2']);
  assert.equal('hatch' in only<ChartBlock>(`${Q}chart bar q hatch=Q9`, 'chart')[0], false);
  assert.equal('hatch' in only<ChartBlock>(`${Q}chart bar q`, 'chart')[0], false);
});

// ---------------------------------------------------------------- diagram legend

test('NAME: legend sets legend on flow diagrams; warns and is ignored on sequence diagrams', () => {
  const [f] = only<DiagramBlock>('diagram f\nf: a -> b\nf: legend\n', 'diagram');
  assert.equal(f.legend, true);
  assert.deepEqual(
    f.nodes.map((n) => n.id),
    ['a', 'b'],
  );
  const doc = parse('diagram s sequence\ns: a -> b\ns: legend\n');
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code),
    ['legend-kind'],
  );
  assert.equal('legend' in doc.blocks[0], false);
  assert.equal('legend' in only<DiagramBlock>('diagram f\nf: legend "Key"\n', 'diagram')[0], false);
});

// ---------------------------------------------------------------- fixtures and streaming

const exDir = new URL('../../../examples/v04/', import.meta.url);
const fixtures = readdirSync(exDir)
  .filter((f) => f.endsWith('.lede'))
  .map((f) => ({ f, src: readFileSync(new URL(f, exDir), 'utf8') }));

test('examples/v04 fixtures parse without diagnostics and use their word', () => {
  assert.ok(fixtures.length >= 6);
  for (const { f, src } of fixtures) {
    const doc = parse(src);
    assert.deepEqual(doc.diagnostics, [], f);
  }
  const all = fixtures.map((x) => JSON.stringify(parse(x.src).blocks)).join('\n');
  for (const needle of [
    '"type":"cards"',
    '"kind":"range"',
    '"targetCol"',
    '"bar":true',
    '"type":"steps"',
    '"labelMode"',
    '"hatch"',
    '"legend":true',
  ]) {
    assert.ok(all.includes(needle), needle);
  }
});

test('streaming each v0.4 fixture in small chunks equals a whole parse, emitted blocks are a prefix', () => {
  for (const { f, src } of fixtures) {
    const s = new LedeStream();
    const emitted: Block[] = [];
    for (let i = 0; i < src.length; i += 5) emitted.push(...s.write(src.slice(i, i + 5)));
    const doc = s.end();
    const whole = parse(src);
    assert.deepEqual(doc, whole, f);
    assert.deepEqual(emitted, whole.blocks.slice(0, emitted.length), f);
  }
});

test('blocks before a cards run stream out before the run closes; the run arrives whole when it ends', () => {
  const src = readFileSync(new URL('cards.lede', exDir), 'utf8');
  const lines = src.split('\n');
  const s = new LedeStream();
  let sawPara = -1;
  let sawCards = -1;
  lines.forEach((l, i) => {
    for (const b of s.write(`${l}\n`)) {
      if (b.type === 'paragraph' && sawPara < 0) sawPara = i;
      if (b.type === 'cards') sawCards = i;
    }
  });
  const cardsLine = lines.indexOf('cards');
  const endLine = lines.findIndex((l) => l.startsWith('## '));
  assert.ok(sawPara >= 0 && sawPara < cardsLine, 'intro paragraph emitted before the cards line');
  assert.equal(sawCards, endLine, 'cards emitted on the line that ends the run');
  // A snapshot taken mid-run shows the cards so far.
  const mid = new LedeStream();
  mid.write(`${lines.slice(0, lines.indexOf('### Self-hosted cluster') + 2).join('\n')}\n`);
  const snap = mid.snapshot().blocks.find((b): b is CardsBlock => b.type === 'cards')!;
  assert.deepEqual(
    snap.items.map((c) => c.title),
    ['Managed queue (recommended)', 'Self-hosted cluster'],
  );
});

test('steps flush on the next non-step line while streaming', () => {
  const s = new LedeStream();
  assert.deepEqual(s.write('step A\nstep B\n'), []);
  assert.deepEqual(
    s.write('\n').map((b) => b.type),
    ['steps'],
  );
});
