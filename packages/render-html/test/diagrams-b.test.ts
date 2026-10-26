// Stream B: decision diamonds in flow diagrams, alt/opt/else frames in sequence diagrams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse, type DiagramBlock } from '@lede-lang/core';
import { render, layoutFlow } from '../src/index.ts';

const html = (src: string) => render(parse(src), { fragment: true });
const flow = (body: string, head = 'diagram f dir=LR') => parse(`${head}\n${body}`).blocks[0] as DiagramBlock;
const exDir = new URL('../../../examples/spike-b/', import.meta.url);
const examples = readdirSync(exDir)
  .filter((f) => f.endsWith('.lede'))
  .map((f) => ({ f, src: readFileSync(new URL(f, exDir), 'utf8') }));
// Phone layout and name wrapping touch every flow diagram, so the older pages ride along in the geometry loop.
const allFlows = [
  ...examples,
  { f: 'kitchen-sink', src: readFileSync(new URL('../../../examples/kitchen-sink.lede', import.meta.url), 'utf8') },
  { f: 'lede-spec', src: readFileSync(new URL('./fixtures/lede-spec.lede', import.meta.url), 'utf8') },
];

const DEC = `
f: a "Start" user
f: q "Is the ticket a production outage right now?" decision
f: p "Page on-call" svc
f: r "Route to queue" svc
f: a -> q
f: q -> p : yes
f: q -> r : no
`;

// ------------------------------------------------------------- decision diamonds

test('a decision node draws a diamond polygon with its label and no kind tag', async () => {
  for (const kind of ['decision', 'choice']) {
    const out = await html(`diagram f dir=LR\nf: q "Is it OK?" ${kind}\nf: a "A" svc\nf: a -> q\nf: q -> a : yes`);
    assert.match(out, /<g class="node dec k-/);
    assert.match(out, /<polygon class="box" points="/);
    assert.match(out, />Is it OK\?<\/text>/);
    assert.doesNotMatch(out, new RegExp(`class="tagt"[^>]*>${kind.toUpperCase()}<`), 'no tag text on a diamond');
  }
});

test('labels up to 28 characters fit inside the diamond (wrapped to 2-3 lines)', async () => {
  const label = 'Is the account in good standing?'; // 32 chars
  const d = flow(`f: q "${label}" decision\nf: a "A" svc\nf: a -> q\nf: q -> a : yes`);
  const p = await layoutFlow(d);
  const q = p.nodes.find((n) => n.node.id === 'q')!;
  assert.ok(q.lines && q.lines.length >= 2 && q.lines.length <= 3, `lines: ${q.lines?.join('|')}`);
  assert.equal(q.lines.join(' '), label);
  // Each line's text box must sit inside the diamond: |dx|/(w/2) + |dy|/(h/2) <= 1 at its far corners.
  const widest = (s: string) => s.length * 0.55 * 13 * 1.07; // generous: the renderer measures the same way or tighter
  q.lines.forEach((l, i) => {
    const dy = Math.abs((i - (q.lines!.length - 1) / 2) * 16) + 8;
    const dx = widest(l) / 2;
    assert.ok(dx / (q.w / 2) + dy / (q.h / 2) <= 1.02, `line "${l}" leaves the diamond`);
  });
});

for (const dir of ['LR', 'TB', 'RL', 'BT'] as const) {
  for (const compact of [false, true]) {
    test(`edges meet the diamond's points, orthogonally and clear of other nodes (${dir}${compact ? ', phone' : ''})`, async () => {
      for (const { f, src } of allFlows) {
        for (const b of parse(src).blocks) {
          if (b.type !== 'diagram' || b.kind !== 'flow') continue;
          const d = { ...b, dir };
          const p = await layoutFlow(d, compact);
          const decisions = new Map(
            p.nodes.filter((n) => n.lines && (n.node.kind === 'decision' || n.node.kind === 'choice')).map((n) => [n.node.id, n]),
          );
          for (const e of p.edges) {
            for (const [end, pt] of [
              [e.edge.from, e.points[0]],
              [e.edge.to, e.points[e.points.length - 1]],
            ] as const) {
              const n = decisions.get(end);
              if (!n) continue;
              const pts = [
                [n.x + n.w / 2, n.y],
                [n.x + n.w, n.y + n.h / 2],
                [n.x + n.w / 2, n.y + n.h],
                [n.x, n.y + n.h / 2],
              ];
              assert.ok(
                pts.some(([x, y]) => Math.abs(x - pt.x) <= 2 && Math.abs(y - pt.y) <= 2),
                `${f} ${dir}: ${e.edge.from}->${e.edge.to} does not end on a point of ${end}`,
              );
            }
            for (let i = 1; i < e.points.length; i++) {
              const [a, c] = [e.points[i - 1], e.points[i]];
              assert.ok(a.x === c.x || a.y === c.y, `${f} ${dir}: diagonal segment`);
              for (const n of p.nodes) {
                if (n.node.id === e.edge.from || n.node.id === e.edge.to) continue;
                const [x0, x1] = [Math.min(a.x, c.x), Math.max(a.x, c.x)];
                const [y0, y1] = [Math.min(a.y, c.y), Math.max(a.y, c.y)];
                const hit = x1 > n.x + 1 && x0 < n.x + n.w - 1 && y1 > n.y + 1 && y0 < n.y + n.h - 1;
                assert.ok(!hit, `${f} ${dir}: ${e.edge.from}->${e.edge.to} crosses ${n.node.id}`);
              }
            }
            if (!e.label) continue;
            const L = e.label;
            const over = (x: number, y: number, w: number, h: number) =>
              L.x + 1 < x + w && L.x + L.w - 1 > x && L.y + 1 < y + h && L.y + L.h - 1 > y;
            for (const o of p.edges) {
              if (o === e) continue;
              for (let i = 1; i < o.points.length; i++) {
                const [a, c] = [o.points[i - 1], o.points[i]];
                assert.ok(
                  !over(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(a.x - c.x), Math.abs(a.y - c.y)),
                  `${f} ${dir}: label "${L.text}" sits on edge ${o.edge.from}->${o.edge.to}`,
                );
              }
            }
            for (const n of p.nodes) assert.ok(!over(n.x, n.y, n.w, n.h), `${f} ${dir}: label "${L.text}" overlaps node ${n.node.id}`);
          }
        }
      }
    });
  }
}

test('answers leave a diamond by different points', async () => {
  const p = await layoutFlow(flow(DEC));
  const [yes, no] = ['p', 'r'].map((t) => p.edges.find((e) => e.edge.to === t)!);
  assert.notDeepEqual(yes.points[0], no.points[0]);
});

test('yes/no answers keep their words and get a color class; other labels do not', async () => {
  const out = await html(`diagram f dir=LR${DEC}f: p -> r : done`.replace('\n', '\n'));
  assert.match(out, /class="elabel yes"[^>]*>YES</);
  assert.match(out, /class="elabel no"[^>]*>NO</);
  assert.match(out, /class="elabel"[^>]*>DONE</);
});

test('a decision flow gets a computed phone layout, narrower than the desktop one', async () => {
  const out = await html(`diagram f dir=LR\n${DEC}f: p -> z : ok\nf: z "Notify the customer by email" svc\nf: r -> z\nf: z -> w "x"`);
  assert.match(out, /class="dg-v"/);
  const ws = [...out.matchAll(/<svg class="dg" viewBox="0 0 (\d+) /g)].map((m) => Number(m[1]));
  assert.equal(ws.length, 2);
  assert.ok(ws[1] < ws[0]);
});

test('hostile text in node labels, sublabels and edge labels stays escaped', async () => {
  const out = await html(`diagram f dir=TB
f: q "Is <script>alert(1)</script> \\"ok\\"?" decision "<img src=x onerror=1>"
f: a "<b>A</b>" svc
f: a -> q : <script>x</script>
f: q -> a : yes"quoted"
`);
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<img/i);
  assert.doesNotMatch(out, /<b>/);
  assert.match(out, /&lt;script&gt;/);
});

// ------------------------------------------------------------- sequence frames

const attr = (tag: string, name: string) => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(tag)![1]);
const frameRects = (out: string) =>
  [...out.matchAll(/<rect class="fr[^"]*"[^>]*>/g)].map((m) => ({
    y: attr(m[0], 'y'),
    h: attr(m[0], 'height'),
    x: attr(m[0], 'x'),
    w: attr(m[0], 'width'),
  }));

const LOGIN = `diagram s sequence
s: b "Browser" user
s: a "App" svc
s: i "IdP" ext
s: b -> a : GET /me
s: alt "session valid"
s: a --> b : 200
s: else "no session"
s: a --> b : 401
s: end
s: b -> i : POST /login
s: alt "password ok"
s: i --> b : 302
s: else "locked"
s: i --> b : 423
s: else
s: i --> b : 401
s: end
s: opt "remember me"
s: b -> a : set cookie
s: note a : stored 30 days
s: end
s: b -> a : GET /home
`;

test('alt/opt frames draw a tag, the condition, dashed else dividers and one rect per frame', async () => {
  const out = await html(LOGIN);
  assert.equal(frameRects(out).length, 3);
  assert.equal((out.match(/class="fr-tag"/g) ?? []).length, 3);
  assert.equal((out.match(/class="fr-div"/g) ?? []).length, 3, '1 + 2 else dividers');
  assert.match(out, />ALT</);
  assert.match(out, />OPT</);
  assert.match(out, />session valid</);
  assert.match(out, />no session</);
  assert.match(out, />remember me</);
  assert.equal((out.match(/>ELSE</g) ?? []).length, 3);
});

test('frames sit between their messages: ordered, disjoint, and each holds its own rows', async () => {
  const out = await html(LOGIN);
  const fr = frameRects(out).toSorted((p, q) => p.y - q.y);
  for (let i = 1; i < fr.length; i++) assert.ok(fr[i].y >= fr[i - 1].y + fr[i - 1].h, 'frames overlap');
  // The note belongs to the opt frame (source line), though its edge index equals the frame's end boundary.
  const note = /<rect class="note-box" x="([\d.]+)" y="(\d+)" width="([\d.]+)"/.exec(out)!;
  const [nx, ny, nw] = [Number(note[1]), Number(note[2]), Number(note[3])];
  const holder = fr.find((f) => ny >= f.y && ny + 24 <= f.y + f.h);
  assert.ok(holder, 'note is inside a frame');
  assert.ok(holder === fr[2], 'note is inside the opt frame');
  assert.ok(nx >= holder.x && nx + nw <= holder.x + holder.w, 'note is inside the frame horizontally');
  // The three-message message that follows the opt frame starts below it.
  const lastLine = [...out.matchAll(/<path class="edge[^"]*" d="M[\d.]+,([\d.]+) /g)].map((m) => Number(m[1])).pop()!;
  assert.ok(lastLine > fr[2].y + fr[2].h);
});

test('frames stay clear of the participant boxes', async () => {
  const out = await html(LOGIN);
  const boxBottom = Math.max(
    ...[...out.matchAll(/<rect class="box" x="[^"]+" y="([\d.]+)" width="[^"]+" height="([\d.]+)"/g)].map(
      (m) => Number(m[1]) + Number(m[2]),
    ),
  );
  for (const f of frameRects(out)) assert.ok(f.y > boxBottom, 'frame starts below the participant boxes');
});

test('frames fit inside the svg at one, two and three frames', async () => {
  for (const n of [1, 2, 3]) {
    const frames = Array.from(
      { length: n },
      (_, i) => `s: alt "case ${i}"\ns: a -> b : m${i}\ns: else "other"\ns: b -> a : r${i}\ns: end`,
    ).join('\n');
    const out = await html(`diagram s sequence\ns: a "A" svc\ns: b "B" svc\n${frames}\n`);
    assert.equal(frameRects(out).length, n);
    const [W, H] = /viewBox="0 0 (\d+) (\d+)"/.exec(out)!.slice(1).map(Number);
    for (const f of frameRects(out)) assert.ok(f.x >= 0 && f.x + f.w <= W && f.y + f.h <= H, `frame within ${W}x${H}`);
  }
});

test('very long conditions wrap instead of widening the diagram without bound', async () => {
  const long = 'the token is valid and has not been revoked by an administrator within the last hour or so';
  const out = await html(`diagram s sequence\ns: a "A" svc\ns: b "B" svc\ns: a -> b : go\ns: alt "${long}"\ns: b --> a : ok\ns: end\n`);
  const lines = [...out.matchAll(/<text class="fr-t"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)</g)].map((m) => m[1]);
  assert.ok(lines.length >= 2, 'wrapped to several lines');
  assert.equal(lines.join(' '), long);
  const W = Number(/viewBox="0 0 (\d+) /.exec(out)![1]);
  assert.ok(W <= 520, `width ${W}`);
});

test('open and empty frames render without throwing', async () => {
  const open = await html('diagram s sequence\ns: a "A" svc\ns: b "B" svc\ns: alt "pending"\ns: a -> b : m\n');
  assert.equal(frameRects(open).length, 1);
  assert.match(open, /class="fr open"/);
  const empty = await html('diagram s sequence\ns: a "A" svc\ns: b "B" svc\ns: a -> b : m\ns: opt "nothing"\ns: end\ns: b -> a : r\n');
  assert.equal(frameRects(empty).length, 1);
  assert.match(empty, />OPT</);
});

test('a sequence without frames draws no frame elements', async () => {
  const out = await html('diagram s sequence\ns: a "A" svc\ns: b "B" svc\ns: a -> b : m\ns: note b : n\n');
  assert.doesNotMatch(out, /class="fr/);
});

test('hostile text in frame conditions and participants stays escaped', async () => {
  const out = await html(`diagram s sequence
s: a "<script>alert(1)</script>" svc
s: b "B" svc
s: a -> b : m
s: alt "x<script>alert(2)</script>\\"y\\" & <b>z</b>"
s: b --> a : ok
s: else "<img src=x onerror=1>"
s: a -> b : n
s: end
`);
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<img/i);
  assert.doesNotMatch(out, /<b>/);
  assert.match(out, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(out, /&quot;y&quot; &amp; &lt;b&gt;z&lt;\/b&gt;/);
});

test('the whole spike-b example set compiles with no script and no remote fetch', async () => {
  for (const { f, src } of examples) {
    const out = await html(src);
    assert.doesNotMatch(out, /<script/i, f);
    assert.doesNotMatch(out, /https?:\/\//, f);
    assert.equal(parse(src).diagnostics.filter((d) => d.severity === 'error').length, 0, f);
  }
});
