import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, type DiagramBlock } from '@lede-lang/core';
import { compile, render, layoutFlow, niceTicks } from '../src/index.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ks = read('../../../examples/kitchen-sink.lede');
const proto = read('./fixtures/lede-spec.lede');

test('kitchen sink renders a complete page with no executable script', async () => {
  const { html, doc } = await compile(ks);
  assert.equal(doc.diagnostics.filter((d) => d.severity === 'error').length, 0);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta name="viewport"/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, 'no remote fetches by default');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
});

test('every region that can scroll sideways takes focus and has a name (WCAG 2.1.1)', async () => {
  const { html } = await compile(ks + '\n```ts\nconst x = 1;\n```\n\n```\nplain\n```\n');
  const scrollers = html.match(/<(?:pre class="code"|div class="scroll[^"]*")[^>]*>/g) ?? [];
  assert.ok(scrollers.length >= 4);
  for (const tag of scrollers) {
    assert.match(tag, /tabindex="0"/, tag);
    assert.match(tag, /aria-label="[^"]+"/, tag);
  }
  assert.match(html, /<pre class="code"[^>]*aria-label="ts code"/);
  assert.match(html, /<pre class="code"[^>]*aria-label="Code"/);
});

test('every svg has a title and desc', async () => {
  const { html } = await compile(ks);
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
  assert.ok(svgs.length >= 6);
  for (const s of svgs) {
    assert.match(s, /role="img"/);
    assert.match(s, /<title id=/);
    assert.match(s, /<desc id=/);
  }
});

test('html: is sanitized unless unsafe', async () => {
  const src = 'html: <p onclick="x()">hi<script>alert(1)</script><a href="javascript:x">l</a></p>';
  const safe = await render(parse(src), { fragment: true });
  assert.doesNotMatch(safe, /script|onclick|javascript:/);
  assert.match(safe, /<p>hi<a>l<\/a><\/p>/);
  const raw = await render(parse(src), { fragment: true, unsafeHtml: true });
  assert.match(raw, /<script>/);
});

test('html: blocks cannot load remote images unless allowed', async () => {
  const doc = parse('html: <p>x<img src="https://evil.example/?q=secret" alt="a"><img src="data:image/png;base64,AA==" alt="b"></p>');
  const safe = await render(doc, { fragment: true });
  assert.doesNotMatch(safe, /evil\.example/);
  assert.match(safe, /data:image\/png/);
  assert.match(await render(doc, { fragment: true, allowRemote: true }), /evil\.example/);
});

test('image blocks reject non-web schemes', () => {
  for (const src of ['file:///etc/passwd', 'javascript:x', 'ftp://h/a.png', '//evil.test/a.png']) {
    assert.ok(
      parse(`image ${src} "alt"`).diagnostics.some((d) => d.code === 'image-src'),
      src,
    );
  }
  assert.equal(parse('image ./a.png "alt"').diagnostics.length, 0);
});

test('remote images are not loaded unless allowed', async () => {
  const doc = parse('image https://example.com/a.png "A chart"');
  assert.doesNotMatch(await render(doc, { fragment: true }), /<img/);
  assert.match(await render(doc, { fragment: true, allowRemote: true }), /<img src="https:\/\/example.com\/a.png"/);
});

test('inline markup escapes html and drops unsafe links', async () => {
  const out = await render(parse('a <b> **bold** `x<y>` [ok](https://a.b) [bad](javascript:alert(1))'), { fragment: true });
  assert.match(out, /a &lt;b&gt; <strong>bold<\/strong> <code>x&lt;y&gt;<\/code> <a href="https:\/\/a.b">ok<\/a> bad/);
});

// ---- page-level inference (stream C): each pattern fires on its shape and nowhere else

const frag = (src: string) => render(parse(src), { fragment: true });

test('sub-items nest under their parent; top-level numbering skips them', async () => {
  const out = await frag(
    '1. Roll back\n-- check canary\n-- [x] page on-call\n2. Verify\n-- 1. one\n-- 2. two\n3. Close\n\n- top\n-- a. alpha <b>\n- [ ] task\n-- [x] sub task',
  );
  const ol = /^<main[^>]*>\n(<ol>.*?<\/ol>)\n/s.exec(out)![1];
  assert.equal(ol.match(/<li/g)!.length, 7);
  assert.match(
    ol,
    /^<ol><li>Roll back<ul class="sub tasks"><li>check canary<\/li><li class="t"><span class="box-c on"[^>]*><\/span><span>page on-call<\/span><\/li><\/ul><\/li>/,
  );
  assert.match(ol, /Verify<ol class="sub nested"><li>one<\/li><li>two<\/li><\/ol><\/li><li>Close<\/li><\/ol>$/);
  assert.match(
    out,
    /<ul class="tasks"><li>top<ul class="sub"><li>a\. alpha &lt;b&gt;<\/li><\/ul><\/li><li class="t"><span class="box-c".*?task<\/span><ul class="sub tasks"><li class="t"><span class="box-c on"/,
  );
  assert.match(out, /a\. alpha &lt;b&gt;/);
});

test('a lone top-level kpi is a hero; a row keeps tiles; a sentence change is a note', async () => {
  assert.match(
    await frag('kpi Days | 143 | last: outage | good'),
    /<div class="kpis solo"><div class="kpi hero">.*<span class="kv good">143<\/span><span class="kn">last: outage/,
  );
  const row = await frag('kpi A | 1 | +2% | good\nkpi B | 2');
  assert.doesNotMatch(row, /hero|solo/);
  assert.match(row, /<span class="kd good">▲ \+2%/);
  assert.doesNotMatch(await frag('grid 2\nkpi A | 1\nkpi B | 2'), /hero/);
});

test('table rows: emphasis only on a minority, chosen row from bold or a Choose line, phone labels', async () => {
  const t =
    'table = Item,Owner,Status,Due,Next step; Postgres upgrade,Ana Lopez,Done,2026-10-01,none; Mesh,Bo Chen,Blocked,2026-10-02,quota ticket; Tags,Cy Ray,At risk,2026-10-03,review; Cache,Di Fox,Done,2026-10-04,none; Queue,Ed Kim,Done,2026-10-05,none';
  const out = await frag(t);
  assert.equal(out.match(/class="hl bad"/g)!.length, 1);
  assert.equal(out.match(/class="hl warn"/g)!.length, 1);
  assert.match(out, /aria-label="Table"><table class="lt stack rh" role="table">/);
  assert.match(out, /<th scope="row" role="rowheader">Postgres upgrade<\/th><td data-label="Owner" role="cell">Ana Lopez<\/td>/);
  assert.match(out, /class="nw" data-label="Due"/);
  const allBad = await frag('table = Job,Status; A,Failed; B,Failed; C,Done');
  assert.doesNotMatch(allBad, /class="hl/);
  assert.match(
    await frag('table = Option,Cost; SQS,low; **Kafka**,high; Rabbit,mid'),
    /<tr class="hl pick"[^>]*><th scope="row"[^>]*><strong>Kafka/,
  );
  const chosen = await frag(
    'table = Option,Cost; LaunchDarkly,high; Unleash (self-hosted),low; In-house,none\n! **Choose Unleash.** Cheapest.',
  );
  assert.match(chosen, /<tr class="hl pick"><th scope="row">Unleash \(self-hosted\)/);
  assert.match(chosen, /<strong class="nt">Choose Unleash\.<\/strong>/);
  assert.doesNotMatch(await frag('table = Check,Expected; Lag,1 s; Errors,0.5%'), /data-label|stack/);
});

test('FAQ, pros/cons, option and section cards are inferred; a plain page is not', async () => {
  const faq = await frag('Intro.\n!! Warn.\n## Why?\nBecause.\n## What changes?\n- one\n## Who helps?\nThe desk.');
  assert.match(faq, /<p class="lead">Intro\.<\/p>|<p>Intro\.<\/p>/);
  assert.match(faq, /<aside class="note warn"/);
  assert.equal(faq.match(/<section class="card faq"><h2 id=/g)!.length, 3);
  assert.doesNotMatch(await frag('## Why?\nA.\n## How?\nB.'), /faq/);
  const pc = await frag('## Pros\n- fast\n## Cons\n- costly');
  assert.match(pc, /<section class="card pc yes"><h2 id="pros">Pros<\/h2><ul class="marks yes"><li class="yes">fast/);
  assert.match(pc, /<section class="card pc no">/);
  const opts = await frag('## Options\n### SQS\n- Pro: managed\n- Con: no replay\n### Kafka\n- Pro: replay');
  assert.match(
    opts,
    /<div class="cards n2"><section class="card opt"><h3 id="sqs">SQS<\/h3><p class="cl yes">Pros<\/p><ul class="marks yes"><li class="yes">Managed/,
  );
  const set = await frag('## One\nA.\n- **Do:** x\n## Two\nB.\n- **Do:** y\n## Three\nC.\n- **Do:** z\n---\n> Quote');
  assert.equal(set.match(/class="card set"/g)!.length, 3);
  assert.match(set, /<\/div>\n<hr>\n<blockquote>/);
  const plain = '# T\n## Steps\n1. a\n2. b\n## Notes\nSome text.\n### Sub\n1. x\n## End\n- a\n- b';
  assert.doesNotMatch(await frag(plain), /card|faqs|hero|prose|class="hl/);
});

test('essays get prose mode; data pages and @width wide do not', async () => {
  const p =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.';
  const essay = `@title An essay\n\n${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => p).join('\n\n')}`;
  assert.match(await frag(essay), /<main class="doc prose">/);
  assert.doesNotMatch(await frag(`@width wide\n${essay}`), /prose/);
  assert.doesNotMatch(await frag(`${essay}\n\ntable = a,b; 1,2`), /prose/);
});

test('nice ticks cover the data with round steps', () => {
  assert.deepEqual(niceTicks(0, 44), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(niceTicks(0, 17.4, 4), [0, 5, 10, 15, 20]);
  const t = niceTicks(99.91, 99.98, 4);
  assert.ok(t[0] <= 99.91 && t[t.length - 1] >= 99.98);
});

type Seg = [number, number, number, number];
function segs(pts: { x: number; y: number }[]): Seg[] {
  return pts.slice(1).map((p, i) => [pts[i].x, pts[i].y, p.x, p.y]);
}
function segHitsBox([x1, y1, x2, y2]: Seg, b: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  // Orthogonal routing: every segment is horizontal or vertical.
  const [lx, hx, ly, hy] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
  return hx > b.x - pad && lx < b.x + b.w + pad && hy > b.y - pad && ly < b.y + b.h + pad;
}

test('diagram labels never collide with edges or nodes, and edges never cross node boxes', async () => {
  for (const src of [ks, proto]) {
    const doc = parse(src);
    for (const d of doc.blocks.filter((b): b is DiagramBlock => b.type === 'diagram' && b.kind === 'flow')) {
      for (const dir of ['LR', 'TB'] as const) {
        const p = await layoutFlow({ ...d, dir });
        for (const e of p.edges) {
          for (const s of segs(e.points)) {
            assert.ok(s[0] === s[2] || s[1] === s[3], `${d.name}/${dir}: diagonal segment`);
            for (const n of p.nodes) {
              if (n.node.id === e.edge.from || n.node.id === e.edge.to) continue;
              assert.ok(!segHitsBox(s, n, -1), `${d.name}/${dir}: edge ${e.edge.from}->${e.edge.to} crosses node ${n.node.id}`);
            }
          }
          if (!e.label) continue;
          for (const other of p.edges) {
            if (other === e) continue;
            for (const s of segs(other.points)) {
              assert.ok(
                !segHitsBox(s, e.label, -1),
                `${d.name}/${dir}: label "${e.label.text}" sits on edge ${other.edge.from}->${other.edge.to}`,
              );
            }
          }
          for (const n of p.nodes)
            assert.ok(
              !segHitsBox([e.label.x, e.label.y, e.label.x + e.label.w, e.label.y], n) ||
                !segHitsBox([e.label.x, e.label.y + e.label.h, e.label.x + e.label.w, e.label.y + e.label.h], n),
              `${d.name}/${dir}: label "${e.label.text}" overlaps node ${n.node.id}`,
            );
        }
      }
    }
  }
});

test('geometry sits on whole pixels and node sizes on the 4px grid', async () => {
  const d = parse(ks).blocks.find((b): b is DiagramBlock => b.type === 'diagram' && b.kind === 'flow')!;
  const p = await layoutFlow(d);
  for (const n of p.nodes) {
    assert.equal(n.w % 4, 0);
    assert.equal(n.h % 4, 0);
  }
});
