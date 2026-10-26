// Spike additions (spec Appendix D): chart event markers, sequence alt/opt/else/end, sub-list items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LedeStream, parse, type ChartBlock, type DiagramBlock, type ListBlock } from '../src/index.ts';
import { compile } from '../../render-html/src/index.ts';

const codes = (src: string) => parse(src).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);
const DATA = 'data r = week,v; W1,1; Week 2,3; W10,2; W1 b,4\n';
const chart = (src: string) => parse(DATA + src).blocks.find((b): b is ChartBlock => b.type === 'chart')!;
const seq = (body: string) => parse(`diagram s sequence\n${body}`);
const diagram = (body: string) => seq(body).blocks[0] as DiagramBlock;

// ---------------------------------------------------------------- chart marks

test('mark= matches the longest x category that is a whole-word prefix, and repeats', () => {
  const c = chart('chart line r mark="W1 b deploy" mark="Week 2 incident" mark=W10 mark="W1 launch"');
  assert.deepEqual(c.marks, [
    { x: 'W1 b', label: 'deploy' },
    { x: 'Week 2', label: 'incident' },
    { x: 'W10', label: '' },
    { x: 'W1', label: 'launch' },
  ]);
});

test('charts without mark= have no marks key at all', () => {
  assert.equal('marks' in chart('chart line r'), false);
});

test('mark= errors name the categories; hbar ignores marks with a warning', () => {
  const doc = parse(`${DATA}chart line r mark="W9 deploy"\nchart bar r mark="W1x oops"\nchart hbar r mark="W1 x"\n`);
  assert.deepEqual(
    doc.diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`),
    ['error:chart-mark@2', 'error:chart-mark@3', 'warning:chart-option@4'],
  );
  assert.match(doc.diagnostics[0].message, /W1, Week 2, W10, W1 b/);
  const hbar = doc.blocks.filter((b): b is ChartBlock => b.type === 'chart')[2];
  assert.equal('marks' in hbar, false);
});

test('mark= combines with target= and keeps the other options', () => {
  const c = chart('chart line r target="2 SLO" mark="W10 cut" unit=ms');
  assert.deepEqual(c.target, { value: 2, label: 'SLO' });
  assert.equal(c.unit, 'ms');
  assert.deepEqual(c.marks, [{ x: 'W10', label: 'cut' }]);
});

// ---------------------------------------------------------------- sequence blocks

test('alt/else/end and opt record flat frames over edge indexes', () => {
  const d = diagram(
    [
      's: a "A"',
      's: b "B"',
      's: a -> b : 0',
      's: alt "ok"',
      's: a -> b : 1',
      's: else "bad"',
      's: b -> a : 2',
      's: b -> a : 3',
      's: end',
      's: opt maybe',
      's: a -> b : 4',
      's: end',
    ].join('\n'),
  );
  assert.deepEqual(d.frames, [
    {
      kind: 'alt',
      from: 1,
      to: 4,
      line: 5,
      endLine: 10,
      branches: [
        { label: 'ok', from: 1, to: 2, line: 5 },
        { label: 'bad', from: 2, to: 4, line: 7 },
      ],
    },
    { kind: 'opt', from: 4, to: 5, line: 11, endLine: 13, branches: [{ label: 'maybe', from: 4, to: 5, line: 11 }] },
  ]);
  assert.equal(d.edges.length, 5);
});

test('a diagram without alt/opt has no frames key', () => {
  assert.equal('frames' in diagram('s: a -> b'), false);
});

test('unbalanced blocks are loud, one error per mistake', () => {
  assert.deepEqual(codes('diagram s sequence\ns: a -> b\ns: end\n'), ['error:diagram-block-stray@3']);
  assert.deepEqual(codes('diagram s sequence\ns: a -> b\ns: else "x"\n'), ['error:diagram-block-stray@3']);
  assert.deepEqual(codes('diagram s sequence\ns: opt x\ns: a -> b\ns: else\ns: end\n'), ['error:diagram-block-stray@4']);
  assert.deepEqual(codes('diagram s sequence\ns: alt "x"\ns: a -> b\n'), ['error:diagram-block-unclosed@2']);
  assert.deepEqual(codes('diagram s sequence\ns: alt "x"\ns: alt "y"\ns: a -> b\ns: end\ns: end\n'), ['error:diagram-block-nested@3']);
  assert.deepEqual(codes('diagram s sequence\ns: alt\ns: a -> b\ns: end\n'), ['error:diagram-block-syntax@2']);
  const bad = diagram('s: alt "x"\ns: alt "y"\ns: a -> b\ns: end\ns: end');
  assert.equal(bad.frames!.length, 1, 'the rejected nested opener makes no frame');
  assert.equal(bad.frames![0].to, 1);
});

test('unclosed frames keep to/endLine null so partial documents render', () => {
  const d = diagram('s: alt "x"\ns: a -> b : m');
  assert.equal(d.frames![0].to, null);
  assert.equal(d.frames![0].endLine, null);
  assert.equal(d.frames![0].branches[0].to, null);
});

test('error messages carry a fix hint', () => {
  const m = (src: string) =>
    parse(src)
      .diagnostics.map((d) => d.message)
      .join('\n');
  assert.match(m('diagram s sequence\ns: end\n'), /alt "condition"/);
  assert.match(m('diagram s sequence\ns: alt "x"\n'), /s: end/);
});

test('names alt/opt/else/end still work as participants in edges; flow diagrams are unchanged', () => {
  const doc = parse(
    [
      'diagram f',
      'f: end "Done" store',
      'f: alt "Fallback"',
      'f: start -> end',
      'diagram s sequence',
      's: alt -> end : x',
      's: end -> alt',
    ].join('\n'),
  );
  assert.deepEqual(doc.diagnostics, []);
  const [f, s] = doc.blocks as DiagramBlock[];
  assert.deepEqual(
    f.nodes.map((n) => [n.id, n.label]),
    [
      ['end', 'Done'],
      ['alt', 'Fallback'],
      ['start', 'start'],
    ],
  );
  assert.equal('frames' in f, false);
  assert.equal('frames' in s, false);
  assert.equal(s.edges.length, 2);
});

test('the one meaning change: alt/opt/else/end are reserved node ids in sequence diagrams', () => {
  const doc = seq('s: end "Closer"\n');
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code),
    ['diagram-block-stray', 'diagram-empty'],
  );
  const open = seq('s: alt "x"\ns: a -> b\ns: end now\n');
  assert.deepEqual(
    open.diagnostics.map((d) => `${d.severity}:${d.code}`),
    ['warning:diagram-block-syntax'],
  );
});

test('conditions may contain arrows, colons and quotes', () => {
  const d = diagram('s: alt "a -> b: \\"x\\""\ns: end');
  assert.equal(d.frames![0].branches[0].label, 'a -> b: "x"');
  assert.equal(d.edges.length, 0);
});

// ---------------------------------------------------------------- sub-lists

test('sub-items sit flat after their parent, whatever the parent kind', () => {
  const doc = parse('1. a\n-- b\n-- 1. c\n-- [x] d\n2. e\n');
  assert.equal(doc.blocks.length, 1);
  const l = doc.blocks[0] as ListBlock;
  assert.deepEqual(
    l.items.map((i) => [i.text, i.level ?? 1, i.ordered ?? null, i.checked]),
    [
      ['a', 1, null, null],
      ['b', 2, false, null],
      ['c', 2, true, null],
      ['d', 2, false, true],
      ['e', 1, null, null],
    ],
  );
});

test('plain lists gain no new keys', () => {
  const l = parse('- a\n- b\n').blocks[0] as ListBlock;
  assert.deepEqual(l.items, [
    { text: 'a', checked: null },
    { text: 'b', checked: null },
  ]);
});

test('lines that look close to sub-items stay as they were', () => {
  assert.deepEqual(
    parse('---\n').blocks.map((b) => b.type),
    ['rule'],
  );
  assert.deepEqual(
    parse('--- x\n').blocks.map((b) => b.type),
    ['paragraph'],
  );
  assert.deepEqual(
    parse('--x\n').blocks.map((b) => b.type),
    ['paragraph'],
  );
  assert.deepEqual(parse('\\-- x\n').blocks, [{ type: 'paragraph', text: '-- x', line: 1 }]);
  assert.deepEqual(parse('> a\n> -- Who\n').blocks, [{ type: 'quote', text: 'a', cite: 'Who', line: 1 }]);
  assert.deepEqual(parse('- a\n-- 1.5 million\n').diagnostics, []);
  const l = parse('- a\n-- 1.5 million\n').blocks[0] as ListBlock;
  assert.equal(l.items[1].text, '1.5 million');
  assert.equal(l.items[1].ordered, false);
});

test('an orphan sub-item is an error and degrades to a top-level item', () => {
  const doc = parse('Prose.\n-- lost\n');
  assert.deepEqual(
    doc.diagnostics.map((d) => d.code),
    ['list-sub-orphan'],
  );
  assert.match(doc.diagnostics[0].message, /start the line with \\/);
  assert.deepEqual((doc.blocks[1] as ListBlock).items, [{ text: 'lost', checked: null }]);
  assert.deepEqual(codes('- a\n\n-- b\n'), ['error:list-sub-orphan@3']);
});

// ---------------------------------------------------------------- streaming and rendering

const SAMPLE = [
  '# Runbook',
  '1. Roll back',
  '-- check canary',
  '-- 1. drain',
  '2. Verify',
  DATA.trim(),
  'chart line r mark="Week 2 incident" mark=W10',
  'diagram s sequence',
  's: a "A"',
  's: b "B"',
  's: alt "ok"',
  's: a -> b : m',
  's: else',
  's: b -> a : n',
  's: end',
  '',
].join('\n');

test('streaming equals a whole parse, and mid-block snapshots stay well formed', () => {
  const s = new LedeStream();
  for (let i = 0; i < SAMPLE.length; i += 5) s.write(SAMPLE.slice(i, i + 5));
  assert.deepEqual(s.end(), parse(SAMPLE));
  const lines = SAMPLE.split('\n');
  const at = lines.indexOf('s: a -> b : m') + 1;
  const mid = new LedeStream();
  mid.write(`${lines.slice(0, at).join('\n')}\n`);
  const snap = mid.snapshot();
  const d = snap.blocks.find((b): b is DiagramBlock => b.type === 'diagram')!;
  assert.equal(d.frames![0].to, null);
  assert.ok(snap.diagnostics.some((x) => x.code === 'diagram-block-unclosed'));
});

test('the proposed model-spec delta is valid Lede', () => {
  const text = readFileSync(new URL('./fixtures/model-spec-grammar-delta.md', import.meta.url), 'utf8');
  const lines = text
    .split('\n')
    .filter((l) => !l.startsWith('>>>'))
    .slice(1); // drop the preamble sentence
  const strip = (l: string) => l.replace(/\s{2,}\(.*\)\s*$/, '');
  const sub = lines.filter((l) => l.startsWith('-- ')).flatMap((l) => strip(l).split(/\s{2,}/));
  const seqLines = lines.filter((l) => l.startsWith('login:'));
  const mark = /`(mark="[^"]+")`/.exec(text)![1];
  assert.equal(sub.length, 2);
  assert.ok(seqLines.length >= 5);
  const doc = parse(
    [
      '- bullet',
      ...sub,
      'data runs = week,v; W1,1; W3,2',
      `chart line runs ${mark}`,
      'diagram login sequence',
      'login: browser "Browser" user',
      'login: app "Web app" svc',
      ...seqLines,
    ].join('\n'),
  );
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual((doc.blocks.find((b) => b.type === 'chart') as ChartBlock).marks, [{ x: 'W3', label: 'deploy' }]);
  assert.equal((doc.blocks.find((b) => b.type === 'diagram') as DiagramBlock).frames!.length, 1);
});

test('the HTML renderer accepts the new nodes without throwing and escapes their text', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const src = [
    `- top ${evil}`,
    `-- sub ${evil}`,
    `-- 1. num ${evil}`,
    `data r = week,v; "${evil}",1; B,2`,
    `chart line r mark="${evil} <b>boom</b>" mark="B ${evil}"`,
    'diagram s sequence',
    's: a "A"',
    's: b "B"',
    `s: alt "${evil}"`,
    's: a -> b : m',
    `s: else ${evil}`,
    's: b -> a : n',
    's: end',
    's: opt x',
    's: end',
  ].join('\n');
  const { html, doc } = await compile(src);
  assert.deepEqual(
    doc.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  // The text may appear, escaped; it must never become an element.
  assert.doesNotMatch(html, /<img\b/);
  assert.doesNotMatch(html, /<b>boom/);
  assert.doesNotMatch(html, /<[a-z][^>]*\son\w+=/i);
});
