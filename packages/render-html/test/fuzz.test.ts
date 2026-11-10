// Seeded fuzz over whole documents: lines drawn from every tracked example and conformance file, mixed with lines chosen to be
// awkward, in random order. For each document: the parser does not throw; `LedeStream` fed the text in random chunks ends with the
// document `parse` gives; `fix` is idempotent, never adds an error and never changes the line count; and the page renders without
// a throw, without `NaN`, `undefined` or `Infinity` the source did not hold, and without a repeated id. A failure names its seed:
// `SEED=1234 node --test packages/render-html/test/fuzz.test.ts` runs that document alone, and `SEEDS=20000` widens the sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LedeStream, fix, parse, type LedeDocument } from '@lede-lang/core';
import { render } from '../src/index.ts';
import { rng } from './fuzz.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Lines of every tracked `.lede` file under examples/ and conformance/, once each. */
function corpus(): string[] {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'examples/**/*.lede', 'examples/*.lede', 'conformance/**/*.lede'], {
    cwd: root,
    encoding: 'utf8',
  });
  const lines = files
    .split('\0')
    .filter(Boolean)
    .flatMap((f) => readFileSync(`${root}${f}`, 'utf8').split('\n'));
  return [...new Set(lines)].filter((l) => l.length < 400);
}

// Lines that have found defects, or sit where one is likely: names an object inherits, empty and one-row data, ranges that are not
// ranges, cycles, unclosed spans and fences, keywords with nothing after them.
const AWKWARD = [
  '',
  '```',
  '```=html',
  '```js',
  '````',
  'html: <b onclick=alert(1)>x</b>',
  'data constructor = a,b; 1,2',
  'chart bar constructor',
  'table toString',
  'kpi K | =__proto__.a',
  'data d = a,b; x,NaN; y,Infinity; z,-0; w,1e308; v,-1e308',
  'chart line d',
  'chart bar d stack labels',
  'chart hbar d',
  'chart area d stack',
  'data z = a,b; x,0; y,0',
  'chart bar z',
  'chart line z min=0 max=0',
  'chart area z min=5 max=1',
  'chart hbar z max=-5',
  'chart line z min=100',
  'data e = a,b',
  'chart bar e y=b',
  'table e',
  'chart range e from=a to=b',
  'data one = a,b; x,5',
  'chart line one',
  'chart area one',
  'chart range one from=b to=b',
  'kpi A | =one.b',
  'kpi B | 50% | x | bar',
  'diagram g',
  'g: a -> a',
  'g: a -> b',
  'g: b -> a',
  'g: n "a -> b" svc',
  'g: group x "X" a, b',
  'g: group y "Y" x',
  'g: group x2 "X2" y',
  'g: group y2 "Y2" x2, y2',
  'g: a <-> b : l',
  'g: a -x- b',
  'g: legend',
  'diagram s sequence',
  's: a -> a : self',
  's: a -> b : hi',
  's: alt "x"',
  's: else',
  's: end',
  's: note a, b : n',
  's: opt "y"',
  'grid 2',
  'grid 3 count=5',
  'cards',
  '### Card',
  '#',
  '####### x',
  '- [ ] t',
  '-- sub',
  '1. one',
  '> q',
  '> — c',
  '! n',
  '!! w',
  '!!! d',
  '---',
  '@title T',
  '@accent #fff',
  '@accent red',
  '@theme dark',
  '@width wide',
  '@date 2026-13-45',
  '@lang "><script>',
  'ask q | Why?',
  'choose c | a, b | Which?',
  'confirm ok | Sure?',
  'export json',
  'export',
  'param p unit=ms | L | 5 0 10 1',
  'toggle t on | L',
  'toggle u needs=t | L',
  'bucket bk | A, B | Q',
  'bk: item | A',
  'template tp | L',
  '{q} {p} {zz}',
  'preset pr | L | p=5; t=on',
  'image x.png "alt"',
  'image https://e.com/x.png "alt" caption="c"',
  'image javascript:alert(1) "a"',
  'step Do | now | me',
  'table = a,b; 1,2; 3,4',
  'table = a; "x"";y"',
  'table = a,b; "q" tail,2; Jan 3, 2024,5',
  '\\data x',
  '﻿@title bom',
  'x\ty',
  '😀 emoji **b *i* b** *i* `c` ``c`c`` [l](javascript:alert(1)) [m](https://e.com/a_(b))',
  '[x]("onmouseover="a)',
  '**unclosed *nest `code [a](',
  'data w = "a,b",c; "1,2",3; 4',
  'data w += 5,6,7',
  'chart bar w focus=c target="5 t" mark="1,2 m" hatch="1,2"',
  'table w heat bar=c target=c sort=-c limit=1',
  'data dt = t,s,e; A,2026-01-01,2026-02-01; B,2026-02-30,2026-01-01',
  'chart range dt from=s to=e target="2026-01-15 x" bands=2026-01-10',
  'kpi L | v',
  'kpi | |',
  'kpi A | 1 | +2 | good',
  'step',
  'chart',
  'table',
  'data',
  'diagram',
  'grid',
  'image',
  'ask',
  'preset',
  'bucket x',
  'param',
];

const pool = [...corpus(), ...AWKWARD, ...AWKWARD];
const errorsOf = (d: LedeDocument) => d.diagnostics.filter((x) => x.severity === 'error').length;

async function check(seed: number): Promise<void> {
  const r = rng(seed);
  const pick = () => pool[Math.floor(r() * pool.length)];
  const nl = r() < 0.2 ? '\r\n' : '\n';
  const src = Array.from({ length: 3 + Math.floor(r() * 40) }, pick).join(nl) + (r() < 0.5 ? nl : '');
  const at = `seed ${seed}:\n${src}\n`;
  const doc = parse(src);

  const stream = new LedeStream();
  for (let i = 0; i < src.length;) {
    const k = 1 + Math.floor(r() * 30);
    stream.write(src.slice(i, i + k));
    i += k;
    if (r() < 0.05) stream.snapshot();
    if (r() < 0.05) stream.tail();
  }
  assert.deepEqual(stream.end(), doc, `stream and parse differ, ${at}`);

  const once = fix(src);
  assert.equal(fix(once.src).src, once.src, `fix is not idempotent, ${at}`);
  assert.ok(errorsOf(parse(once.src)) <= errorsOf(doc), `fix added an error, ${at}`);
  assert.equal(once.src.split('\n').length, src.split('\n').length, `fix changed the line count, ${at}`);
  assert.equal(once.src.split('\r\n').length, src.split('\r\n').length, `fix changed a line ending, ${at}`);

  const html = await render(doc, { shell: r() < 0.3 });
  const body = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const bad = /NaN|undefined|Infinity|\[object Object\]/.exec(body);
  if (bad && !src.includes(bad[0]))
    assert.fail(`${bad[0]} in the page: ${body.slice(Math.max(0, bad.index - 120), bad.index + 60)}\n${at}`);
  const ids = [...body.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  assert.equal(dup, undefined, `id "${dup}" appears twice, ${at}`);
}

const only = process.env.SEED ? [Number(process.env.SEED)] : null;
const seeds = only ?? Array.from({ length: Number(process.env.SEEDS ?? 400) }, (_, i) => i + 1);

test(`fuzz: ${seeds.length} seeded document${seeds.length === 1 ? '' : 's'} parse, stream, fix and render`, async () => {
  for (const seed of seeds) {
    try {
      await check(seed);
    } catch (e) {
      // A throw from the parser or the renderer carries no seed of its own.
      if (e instanceof assert.AssertionError) throw e;
      throw new Error(`seed ${seed} threw: ${e instanceof Error ? e.stack : String(e)}`, { cause: e });
    }
  }
});
