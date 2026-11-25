// D86: a written `dir=LR` stays a row on the desktop drawing, every edge label lies inside its drawing, a decision ladder is drawn
// beside its chain, answers take colour only from a written tone, and the key lists only kinds drawn differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, type DiagramBlock } from '@lede-lang/core';
import { render, layoutFlow } from '../src/index.ts';
import { ladderOf } from '../src/diagram.ts';

const conf = (f: string) => readFileSync(new URL(`../../../conformance/cases/${f}`, import.meta.url), 'utf8');
const diagram = (src: string) => parse(src).blocks.find((b) => b.type === 'diagram') as DiagramBlock;
/** The desktop (`dg-h`) and phone (`dg-v`) drawings' sizes, from their viewBox. */
const drawings = (html: string) =>
  [...html.matchAll(/<div class="dg-(h|v)"[^>]*><svg [^>]*viewBox="0 0 (\d+) (\d+)"/g)].map((m) => ({ at: m[1], w: +m[2], h: +m[3] }));

test('a dir=LR chain with long edge labels stays a row on the desktop drawing of a wide page, and a column on the phone', async () => {
  const html = await render(parse(conf('52-diagram-row-wide.lede')));
  const [desk, phone] = drawings(html);
  assert.equal(desk.at, 'h');
  assert.ok(desk.w > desk.h * 6 && desk.w <= 1250, `desktop ${desk.w}x${desk.h}`);
  assert.ok(phone && phone.at === 'v' && phone.h > phone.w, `phone ${phone?.w}x${phone?.h}`);
});

test('a diagram without dir= keeps the existing fit: a tall chain may still turn', async () => {
  const d = diagram(conf('52-diagram-row-wide.lede').replace(' dir=LR', ''));
  assert.equal(d.dirExplicit, undefined);
  const p = await layoutFlow(d);
  assert.ok(p.height > p.width, 'top to bottom as written by default');
});

for (const f of ['51-edge-tone-labels.lede', '52-diagram-row-wide.lede', '53-edge-label-bounds.lede', '54-decision-ladder.lede']) {
  test(`every edge label lies inside the drawing: ${f}`, async () => {
    const d = diagram(conf(f));
    for (const dir of ['LR', 'TB'] as const)
      for (const [compact, tiers] of [
        [false, [0, 1]],
        [true, [0, 1, 2]],
      ] as const)
        for (const tier of tiers) {
          const p = await layoutFlow({ ...d, dir }, compact, tier);
          for (const e of p.edges) {
            const l = e.label;
            if (!l) continue;
            const where = `${dir} compact=${compact} tier=${tier} "${l.text}" at ${l.x},${l.y} ${l.w}x${l.h} in ${p.width}x${p.height}`;
            assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= p.width && l.y + l.h <= p.height, where);
          }
        }
  });
}

test('a decision ladder: rungs in one column, each answer to the shared node one straight line out the same side', async () => {
  const d = diagram(conf('54-decision-ladder.lede'));
  const rungs = ['d1', 'd2', 'd3', 'd4', 'd5'];
  assert.deepEqual(ladderOf(d), { target: 'kept', rungs, on: 'no' });
  for (const compact of [false, true]) {
    const p = await layoutFlow(d, compact);
    const box = (id: string) => p.nodes.find((n) => n.node.id === id)!;
    const cx = (id: string) => box(id).x + box(id).w / 2;
    const kept = box('kept');
    for (const r of rungs) {
      assert.ok(Math.abs(cx(r) - cx('d1')) <= 1, `${r} is off the column`);
      const yes = p.edges.find((e) => e.edge.from === r && e.edge.to === 'kept')!;
      assert.equal(yes.points.length, 2, `${r} -> kept bends`);
      assert.equal(yes.points[0].y, yes.points[1].y, `${r} -> kept is not horizontal`);
      assert.equal(yes.points[0].x, box(r).x + box(r).w, `${r} -> kept leaves by the east point`);
      assert.equal(yes.points[1].x, kept.x);
    }
    // "no" leaves every diamond by the bottom point, the last decision (not a rung) included.
    for (const id of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) {
      const no = p.edges.find((e) => e.edge.from === id && e.edge.label === 'no')!;
      const b = box(id);
      assert.deepEqual(no.points[0], { x: Math.round(b.x + b.w / 2), y: b.y + b.h }, `${id} "no" exit`);
    }
    if (!compact) assert.ok(p.height <= 800, `ladder height ${p.height}`);
  }
});

test('no ladder without three rungs, or when the shared node has answers of its own', () => {
  const src = conf('54-decision-ladder.lede');
  assert.equal(ladderOf(diagram(src.replace(/decide: d[345] -> kept : yes\n/g, ''))), null);
  assert.equal(ladderOf(diagram(`${src}decide: kept -> del\n`)), null);
});

test('answers are bold but take colour only from a written tone; the key lists only kinds drawn differently', async () => {
  const html = await render(parse(conf('54-decision-ladder.lede')), { fragment: true });
  assert.match(html, /class="elabel ans"[^>]*>yes</);
  assert.doesNotMatch(html, /class="elabel (yes|no)\b/);
  const key = /<div class="dg-key"[\s\S]*?<\/div>/.exec(html)![0];
  assert.match(key, />DECISION</);
  assert.match(key, />EXT</);
  for (const plainKind of ['SVC', 'STORE', 'FN']) assert.doesNotMatch(key, new RegExp(`>${plainKind}<`));
  const toned = await render(parse(conf('51-edge-tone-labels.lede')), { fragment: true });
  assert.match(toned, /class="elabel[^"]* tn t-good"[^>]*>allow</);
  assert.doesNotMatch(toned, /allow \| good|APPROVED \| WARN/i);
});

test('without `legend`, no row of kind tags repeats the tags on the nodes', async () => {
  const html = await render(parse(conf('53-edge-label-bounds.lede')), { fragment: true });
  assert.doesNotMatch(html, /dg-legend|dg-key/);
});

test('a hero value in words gets the smaller hero size; a number keeps the large one', async () => {
  assert.match(await render(parse('kpi Records reviewed | 482 of 483'), { fragment: true }), /class="kv words"/);
  assert.doesNotMatch(await render(parse('kpi Revenue | $41,200'), { fragment: true }), /kv words/);
});
