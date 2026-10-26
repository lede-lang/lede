import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fix, parse } from '../src/index.ts';

const errors = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'error');

test('valid source is returned untouched', () => {
  const src = '# Hi\n\ndata a = x,y; 1,2\ntable a\n';
  const r = fix(src);
  assert.equal(r.src, src);
  assert.deepEqual(r.applied, []);
});

test('x=delay becomes the one column it prefixes, quoted when it has a space', () => {
  const src = 'data d = delay ms,n; 1,2; 3,4\nchart bar d x=delay y=n title="the delay"\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[1], 'chart bar d x="delay ms" y=n title="the delay"');
  assert.equal(errors(r.src).length, 0);
});

test('an ambiguous column prefix is left alone', () => {
  const src = 'data d = delay a,delay b,n; 1,2,3\nchart bar d x=delay y=n\n';
  assert.equal(fix(src).src, src);
});

test('y= lists take bare names with spaces', () => {
  const src = 'data d = day,open bugs,n; a,1,2\nchart line d x=day y=open,n\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[1], 'chart line d x=day y=open bugs,n');
  assert.equal(errors(r.src).length, 0);
});

test('a `;` inside a cell: the orphan fragment joins the previous cell, flagged as a guess', () => {
  const src = 'data t = a,b; one,Nice to have; no link; two,fine\ntable t\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[0], 'data t = a,b; one,"Nice to have; no link"; two,fine');
  assert.equal(r.applied[0].guess, true);
  assert.equal(errors(r.src).length, 0);
});

test('an unquoted comma in prose is joined into one quoted cell', () => {
  const src = 'data a = what,who\ndata a += Pay 10,500 customers on time,Support\ntable a\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[1], 'data a += "Pay 10,500 customers on time",Support');
  assert.equal(errors(r.src).length, 0);
});

test('a diagram named like a data set is renamed with its body lines', () => {
  const src = 'data deps = a,b; 1,2\n\ndiagram deps dir=LR\ndeps: x "X" svc "On"\ndeps: y "Y" svc "On"\n';
  const r = fix(src);
  assert.match(r.src, /^diagram deps-flow dir=LR$/m);
  assert.equal(r.src.match(/^deps-flow:/gm)?.length, 2);
  assert.equal(errors(r.src).length, 0);
});

test('#### headings are shortened', () => {
  assert.equal(fix('#### Deep\n').src, '### Deep\n');
});

test('fixing is idempotent', () => {
  const src = 'data t = a,b; one,Nice; no link\n#### H\n';
  const once = fix(src).src;
  assert.equal(fix(once).src, once);
});

test('inline tables get the same row repairs as data lines', () => {
  const orphan = fix('table = a,b; one,Nice to have; no link; two,fine\n');
  assert.equal(orphan.src, 'table = a,b; one,"Nice to have; no link"; two,fine\n');
  const prose = fix('table = rule,result; Water 52,000 L per day,Failed; Pump,Go\n');
  assert.equal(prose.src, 'table = rule,result; "Water 52,000 L per day",Failed; Pump,Go\n');
  assert.equal(errors(orphan.src).length + errors(prose.src).length, 0);
});

test('a header cell split at a thousands comma is rejoined, with the rows on later lines intact', () => {
  const src = 'data s = id,left of $400,000,note; 1,$337,"x"\ndata s += 2,$296,"y"\ntable s\n';
  const bad = errors(src).length;
  assert.ok(bad > 0);
  const r = fix(src);
  assert.equal(r.src.split('\n')[0], 'data s = id,"left of $400,000",note; 1,$337,"x"');
  assert.equal(errors(r.src).length, 0);
});

test('a chart naming data that is never declared is reported, not invented', () => {
  const r = fix('chart bar nothing\n');
  assert.equal(r.src, 'chart bar nothing\n');
  assert.ok(r.remaining.some((d) => d.code === 'unknown-data'));
});

// D52: the repairs for the most common codes, and the column-type check on comma joins.
const warnings = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'warning');

test('a comma join never moves a number out of a numeric column (the "then fixed, 3" case)', () => {
  const src = 'data t = name,status,score; Bo,ok,4; Ann,late,then fixed, 3\ntable t\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[0], 'data t = name,status,score; Bo,ok,4; Ann,"late, then fixed",3');
  assert.equal(r.applied[0].guess, true);
  assert.equal(errors(r.src).length, 0);
});

test('column types come from rows on other lines too', () => {
  const src = 'data t = name,status,score\ndata t += Bo,on time,4\ndata t += Ann,late,then fixed, 3\ntable t\n';
  assert.equal(fix(src).src.split('\n')[2], 'data t += Ann,"late, then fixed",3');
});

test('inline table: a comma slip with no prose cue keeps the label whole and the number bare', () => {
  const r = fix('table = name,status,score; Ann, late, fixed, 3\n');
  assert.equal(r.src, 'table = name,status,score; Ann,"late, fixed",3\n');
  assert.equal(r.applied[0].guess, true);
});

test('a comma slip with more than one reading past the label is left alone', () => {
  const src = 'table = id,owner,team,pts; T-1, Ann, Platform, Infra, 3\n';
  const r = fix(src);
  assert.equal(r.src, src);
  assert.deepEqual(
    r.remaining.map((d) => d.code),
    ['data-row-width'],
  );
});

test('a `;` in the middle of a row: the two short rows it made are joined back', () => {
  const r = fix('table = a,b,c; x,y,z; one,two; three,four\n');
  assert.equal(r.src, 'table = a,b,c; x,y,z; one,"two; three",four\n');
  assert.equal(r.applied[0].guess, true);
});

test('a `;` join that would put text in a numeric column is not made', () => {
  const src = 'data t = a,n,m; x,1,2; y,3; z,4\ntable t\n';
  assert.equal(fix(src).src, src);
});

test('csv-thousands: the number the parser already merged is quoted, not a guess', () => {
  const r = fix('table = item,cost; Kafka,$1,450; SQS,$310\n');
  assert.equal(r.src, 'table = item,cost; Kafka,"$1,450"; SQS,$310\n');
  assert.equal(r.applied[0].guess, false);
  assert.equal(warnings(r.src).length, 0);
});

test('kpi bar: a plain percent in the change field swaps with the value, as a guess', () => {
  const r = fix('kpi Done | 74 of 120 | 61.7% | good | bar\n');
  assert.equal(r.src, 'kpi Done | 61.7% | 74 of 120 | good | bar\n');
  assert.equal(r.applied[0].guess, true);
  assert.equal(warnings(r.src).length, 0);
});

test('kpi bar: a signed change, a reference value or a percent inside a phrase is not swapped; the bar is dropped', () => {
  for (const [src, want] of [
    ['kpi Done | 74 of 120 | +3% | bar\n', 'kpi Done | 74 of 120 | +3%\n'],
    ['data r = d; 500\nkpi Done | =r.d | 61.7% | bar\n', 'data r = d; 500\nkpi Done | =r.d | 61.7%\n'],
    ['kpi Raised | $3.18M | 70.7% of $4.5M goal | bar\n', 'kpi Raised | $3.18M | 70.7% of $4.5M goal\n'],
  ]) {
    const r = fix(src);
    assert.equal(r.src, want);
    assert.equal(r.applied[0].guess, true);
    assert.equal(warnings(r.src).length, 0);
  }
});

test('kpi bar: an approximate value (~75%) loses `bar`, which drew nothing, and keeps its note and tone', () => {
  const r = fix('kpi Reading share | ~75% | roughly three-quarters | bar\nkpi Cost | ~$3 | per run | good | bar\n');
  assert.equal(r.src, 'kpi Reading share | ~75% | roughly three-quarters\nkpi Cost | ~$3 | per run | good\n');
  assert.deepEqual(
    r.applied.map((a) => [a.code, a.guess]),
    [
      ['kpi-bar', true],
      ['kpi-bar', true],
    ],
  );
  assert.match(r.applied[0].note, /bar dropped/);
  assert.equal(warnings(r.src).length, 0);
});

test('kpi bar: with no change field the bare `bar` goes and no trailing bar is left', () => {
  assert.equal(fix('kpi Share | ~75% | bar\n').src, 'kpi Share | ~75%\n');
  assert.equal(fix('kpi Share | ~75% | | bar\n').src, 'kpi Share | ~75%\n');
});

test('grid N followed by exactly N ### sections becomes cards, as a guess (the column count is not kept)', () => {
  const src = '## Options\n\ngrid 2\n\n### A\nOne.\n### B\nTwo.\n\n## Next\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[2], 'cards');
  assert.equal(r.applied[0].guess, true);
  assert.equal(parse(r.src).blocks.find((b) => b.type === 'cards')?.type, 'cards');
  assert.equal(warnings(r.src).length, 0);
});

test('grid before a different number of ### sections is left alone', () => {
  const src = 'grid 3\n### A\nx\n### B\ny\n## Next\n';
  assert.equal(fix(src).src, src);
});

test('a repair that makes the page worse is not made, and does not hide or block the other repairs', () => {
  // As cards, every diagram would sit outside its card (one cards-content warning each, for one grid-unfilled).
  const grid = (n: number) =>
    `grid 2\n\n### A\n${Array.from({ length: n }, (_, k) => `diagram d${k}\nd${k}: a -> b\n`).join('')}### B\ntext\n`;
  const kpi = '\n## Next\n\nkpi Done | 74 of 120 | 61.7% | bar\n';
  for (const [src, also] of [
    [grid(1), ''], // trades one warning for one
    [grid(2) + kpi + '\n#### deep\n', '### deep'], // unrelated repairs on the same pass would outweigh it
    [grid(3) + kpi, ''], // it would outweigh the unrelated repair
  ] as const) {
    const out = fix(src).src.split('\n');
    assert.equal(out[0], 'grid 2', src);
    if (src.includes('kpi')) assert.ok(out.includes('kpi Done | 61.7% | 74 of 120 | bar'), src);
    if (also) assert.ok(out.includes(also), src);
  }
});

test('a comma join never makes a number out of two', () => {
  assert.equal(fix('table = label,v; Q1,2024,5\n').src, 'table = label,v; "Q1,2024",5\n');
  assert.equal(fix('table = name,score,grade; Ann,90,A; Bo,8,5,B\n').src, 'table = name,score,grade; Ann,90,A; Bo,8,5,B\n');
});

test('a `;` join never glues a bare number to text', () => {
  // The only full row is the one a join would rewrite, so nothing says `score` is numeric; the number itself does.
  const src = 'table = name,score; Ann,3; Bo; 4\n';
  assert.equal(fix(src).src, src);
});

test('an option word before = on an inline table is not read as a name', () => {
  const src = 'table bar = a,b; x,2\n';
  assert.equal(fix(src).src, src);
  assert.doesNotMatch(parse(src).diagnostics[0].message, /has no name/);
});

test('a stray word after a spanning column option is split off the column name, as a guess', () => {
  const src = 'data d = district,customers; A,1; B,2\nchart hbar d x=district y=customers sort title="By district"\n';
  const r = fix(src);
  assert.equal(r.src.split('\n')[1], 'chart hbar d x=district y="customers" sort title="By district"');
  assert.equal(r.applied[0].guess, true);
  assert.equal(errors(r.src).length, 0);
  assert.ok(
    r.remaining.some((d) => d.code === 'chart-option'),
    'the stray word is still reported',
  );
});

test('a name on an inline table is dropped, unless something uses it', () => {
  assert.equal(fix('table vendors = a,b; x,2\n').src, 'table = a,b; x,2\n');
  const used = 'table vendors = a,b; x,2\nchart bar vendors\n';
  assert.equal(fix(used).src, used);
});

test('the new repairs are idempotent', () => {
  for (const src of [
    'table = name,status,score; Ann, late, fixed, 3\n',
    'table = a,b,c; x,y,z; one,two; three,four\n',
    'table = item,cost; Kafka,$1,450\n',
    'kpi Done | 74 of 120 | 61.7% | bar\n',
    'grid 2\n### A\nx\n### B\ny\n',
    'data d = n,c; A,1\nchart bar d x=n y=c sort\n',
    'table vendors = a,b; x,2\n',
  ]) {
    const once = fix(src).src;
    assert.equal(fix(once).src, once, src);
  }
});

test('rows one short because of a split header point at the header, not at a `;`', () => {
  const d = parse('data s = id,left of $400,000,note; 1,$337,x\ntable s\n').diagnostics.find((x) => x.code === 'data-row-width');
  assert.match(d?.message ?? '', /header cell .* split at a thousands comma: quote it \("left of \$400,000"\)/);
});
