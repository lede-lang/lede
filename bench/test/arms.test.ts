// The frozen inputs have not moved, and the two new arms (D, E) are what their prompts say they are.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateJsonUi } from '../src/kit/json-ui.ts';
import { measure, preloadedPage, stripFence } from '../src/kit/measure.ts';
import { ARMS } from '../src/kit/arms.ts';

const BENCH = join(import.meta.dirname, '..');
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const frozen = JSON.parse(readFileSync(join(import.meta.dirname, 'frozen-hashes.json'), 'utf8')) as {
  prompts: Record<string, string>;
  tasks: Record<string, string>;
};
const prompt = (n: string) => readFileSync(join(BENCH, 'prompts', n), 'utf8');

test('frozen prompts C-lede-0.1 to 0.4 hash as recorded (hashes only; nothing is printed)', () => {
  assert.equal(Object.keys(frozen.prompts).length, 4);
  for (const [f, h] of Object.entries(frozen.prompts))
    assert.equal(sha(join(BENCH, 'prompts', f)), h, `${f} changed: write a new prompt file instead`);
});

test('every task file hashes as recorded, and no task file was added or removed', () => {
  const files = readdirSync(join(BENCH, 'tasks')).filter((f) => f.endsWith('.json'));
  assert.deepEqual(files.toSorted(), Object.keys(frozen.tasks).toSorted());
  for (const [f, h] of Object.entries(frozen.tasks)) assert.equal(sha(join(BENCH, 'tasks', f)), h, `${f} changed: tasks are frozen`);
});

test('the gate set hashes as D34 records it, and the held-out set as D69 records it', () => {
  const set = (lo: number, hi: number) => {
    const h = createHash('sha256');
    for (const f of readdirSync(join(BENCH, 'tasks')).toSorted((a, b) => parseInt(a) - parseInt(b)))
      if (parseInt(f) >= lo && parseInt(f) <= hi) h.update(readFileSync(join(BENCH, 'tasks', f)));
    return h.digest('hex');
  };
  assert.equal(set(101, 130), '77bc6c1bd64c48b49a2f90cd06972dae0f27f71f974cbdb53e6a6f4bee3a5a0d');
  assert.equal(set(131, 185), '47e032ceebbff3671833be3126a9420b196a3cfc4c358b03e72602cce2f15e17');
});

test('arm D: the stylesheet is small and the prompt documents exactly the classes it defines', () => {
  const css = readFileSync(join(BENCH, 'arms', 'preloaded.css'), 'utf8');
  assert.ok(statSync(join(BENCH, 'arms', 'preloaded.css')).size < 6 * 1024);
  const defined = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  const doc = prompt('D-html-preloaded-css.md');
  const listed = doc.slice(doc.indexOf('<preloaded-classes>'), doc.indexOf('</preloaded-classes>'));
  const used = new Set([...listed.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  for (const c of used) assert.ok(defined.has(c), `prompt documents .${c}, which the stylesheet does not define`);
  for (const c of [
    'page',
    'kpis',
    'kpi',
    'tablewrap',
    'data',
    'callout',
    'grid',
    'card',
    'bars',
    'bar',
    'steps',
    'diagram',
    'dg-node',
    'dg-edge',
  ])
    assert.ok(defined.has(c), c);
  assert.ok(!/<script|@import|url\(/.test(css));
  // the example in the prompt passes its own measure
  const example = /(<main class="page wide">[\s\S]*?<\/main>)/.exec(doc)?.[1] ?? assert.fail('no example');
  assert.ok(preloadedPage(example).includes('--bg:'));
  return measure(ARMS.D, example).then((m) => assert.equal(m.valid, true, m.problems.join()));
});

test('arm E: the examples in the prompt validate; broken structure is named', () => {
  const doc = prompt('E-json-ui.md');
  const examples = doc.split('\n').filter((l) => l.startsWith('{"page"'));
  assert.equal(examples.length, 2);
  for (const e of examples) assert.deepEqual(validateJsonUi(e).errors, []);
  const bad = (o: unknown) => validateJsonUi(JSON.stringify(o)).errors.join('|');
  const page = (blocks: unknown[]) => ({ page: { title: 't', sections: [{ heading: 'h', blocks }] } });
  assert.match(validateJsonUi('{nope').errors[0], /not JSON/);
  assert.match(bad({}), /top-level "page"/);
  assert.match(bad(page([{ type: 'blob' }])), /unknown block type/);
  assert.match(bad(page([{ type: 'table', columns: ['a', 'b'], rows: [[1]] }])), /1 cells for 2 columns/);
  assert.match(
    bad(page([{ type: 'diagram', kind: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'z' }] }])),
    /does not exist/,
  );
  assert.match(
    bad(
      page([
        {
          type: 'chart',
          kind: 'pie',
          series: [
            { name: 'a', points: [{ x: 'p', y: 1 }] },
            { name: 'b', points: [{ x: 'p', y: 1 }] },
          ],
        },
      ]),
    ),
    /exactly one series/,
  );
  assert.match(bad(page([{ type: 'kpi', tiles: [{ label: 'x', value: 5 }] }])), /string "label" and "value"/);
});

test("the new prompts sit in the Lede prompt's range and are new files (the Lede prompt is untouched)", () => {
  const c = prompt('C-lede-0.5.md').length;
  for (const f of ['D-html-preloaded-css.md', 'E-json-ui.md']) {
    const n = prompt(f).length;
    assert.ok(n > c * 0.5 && n < c * 1.2, `${f} is ${n} chars against ${c}`);
  }
});

test('measure: a Lede page is judged by the real parser, a fence around a reply is unwrapped and recorded', async () => {
  const good = await measure(ARMS.C, '@title T\n\n# H\n\nText.\n');
  assert.equal(good.valid, true);
  assert.equal(good.buildOk, true);
  const bad = await measure(ARMS.C, '@title T\n\nchart line nodata\n');
  assert.equal(bad.valid, false);
  assert.ok(bad.problems.length > 0);
  assert.deepEqual(stripFence('```lede\n# H\n```'), { text: '# H', stripped: true });
  assert.deepEqual(stripFence('# H\n'), { text: '# H\n', stripped: false });
  assert.equal((await measure(ARMS.B, '<!doctype html><html></html>')).valid, true);
  assert.equal((await measure(ARMS.B, '<p>x</p>')).valid, false);
  // arm D: the wrapper may be written with other quotes or class order; a document wrapper is still refused
  assert.equal((await measure(ARMS.D, "<main class='wide page'><h1>T</h1></main>")).valid, true);
  assert.equal((await measure(ARMS.D, '<main><h1>T</h1></main>')).valid, false);
  assert.equal((await measure(ARMS.D, '<html><body><main class="page"></main></body></html>')).valid, false);
});
