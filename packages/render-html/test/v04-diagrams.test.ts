// Vocabulary v0.4, stream S3 (diagrams): the flow `legend` key and the sequence-diagram defect fixes.
// `legend` is set on the parsed block here, so these tests do not depend on the parser emitting it.
// The browser checks skip, with a message, when no Chromium resolves (set CHROME to one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, type DiagramBlock, type LedeDocument } from '@lede-lang/core';
import { render } from '../src/index.ts';
import { css } from '../src/theme.ts';
import { resolveChrome } from '../../../bench/src/shot.ts';

const doc = (src: string, legend?: boolean): LedeDocument => {
  const d = parse(src);
  const b = d.blocks.find((x) => x.type === 'diagram') as DiagramBlock;
  if (legend !== undefined) b.legend = legend;
  return d;
};
const frag = (src: string, legend?: boolean) => render(doc(src, legend), { fragment: true });

const KINDS = `diagram k dir=LR title="Kinds"
k: u "Shopper" user
k: e "Partner API" ext
k: s "Web tier" svc focus
k: q "Valid?" decision
k: b "Orders" db
k: group g "Platform" s, b
k: u -> s : request
k: s --> b : async write
k: s <-> e : sync
k: s -x- b : never
k: s -> q
`;

const TWO = `diagram f dir=LR
f: a "A" svc
f: b "B" db
f: a -> b : go
`;

const keyOf = (html: string) => /<div class="dg-key"[^>]*>([\s\S]*?)<\/div><\/figure>/.exec(html)?.[1] ?? '';
const keyTexts = (html: string) => [...keyOf(html).matchAll(/<span class="dgk-t">(.*?)<\/span>(?=<\/span>)/g)].map((m) => m[1]);

// ------------------------------------------------------------------ legend

test('legend: the key lists each node kind used, focus, the boundary and each arrow style used', async () => {
  const html = await frag(KINDS, true);
  const key = keyOf(html);
  assert.ok(key, 'key present');
  const tags = [...key.matchAll(/<span class="tag">([A-Z]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(tags, ['USER', 'EXT', 'SVC', 'DECISION', 'DB']);
  const text = keyTexts(html).filter((t) => !t.startsWith('<span'));
  assert.deepEqual(text, ['focus', 'boundary', 'request / flow', 'async / reply / optional', 'both ways', 'must not exist']);
  assert.match(html, /<\/svg><\/div><\/div><\/div><div class="dg-key"/, 'key sits below the drawings, inside the figure');
});

test("legend: swatches are text-free svgs drawn with the diagram's own shapes, no markers, no scripts", async () => {
  const key = keyOf(await frag(KINDS, true));
  const sws = [...key.matchAll(/<svg class="dgk-sw"[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.equal(sws.length, 11, '5 kinds, focus, boundary and 4 arrow styles');
  for (const s of sws) {
    assert.doesNotMatch(s, /<text|marker|url\(|<script/);
    assert.match(s, /aria-hidden="true"/);
  }
  assert.ok(
    sws.some((s) => /<polygon class="box"/.test(s)),
    'decision is a diamond',
  );
  assert.ok(
    sws.some((s) => /k-ext/.test(s)),
    'ext keeps its dashed-box class',
  );
  assert.ok(sws.some((s) => /class="node focus"/.test(s)));
  assert.ok(sws.some((s) => /class="grp"/.test(s)));
  assert.ok(sws.some((s) => /class="edge dash"/.test(s)));
  assert.ok(sws.some((s) => /class="edge blocked"/.test(s) && /class="blk"/.test(s)));
  assert.ok(
    sws.some((s) => (s.match(/class="ah"/g) ?? []).length === 2),
    'both ways has two heads',
  );
});

test('legend: only what is used is listed', async () => {
  const html = await frag(TWO, true);
  assert.deepEqual(
    keyTexts(html).map((t) => t.replace(/<[^>]+>/g, '')),
    ['SVC', 'DB', 'request / flow'],
  );
  assert.doesNotMatch(keyOf(html).replace(/<svg[\s\S]*?<\/svg>/g, ''), /focus|boundary|both ways|must not exist|async/);
  const dashed = await frag(`diagram f dir=LR\nf: a "A"\nf: b "B"\nf: a --> b`, true);
  assert.deepEqual(keyTexts(dashed), ['async / reply / optional'], 'untagged nodes add no kind swatch');
});

test('legend: it subsumes the automatic kind tags, so there is exactly one key', async () => {
  const on = await frag(KINDS, true);
  assert.doesNotMatch(on, /dg-legend/);
  assert.equal(on.match(/class="dg-key"/g)?.length, 1);
  // One kind only: the automatic legend would have said nothing, the key still lists it and the arrows.
  const one = await frag(`diagram f dir=LR\nf: a "A" svc\nf: b "B" svc\nf: a -> b`, true);
  assert.equal(keyTexts(one).length, 2);
});

test('legend: false or omitted leaves the page exactly as before', async () => {
  const base = await frag(KINDS);
  assert.equal(await frag(KINDS, false), base);
  assert.match(base, /<div class="dg-legend">(?:<span class="tag">[A-Z]+<\/span>)+<\/div>/);
  assert.doesNotMatch(base, /dg-key/);
  assert.notEqual(await frag(KINDS, true), base);
});

test('legend: a flow that falls back to the phone list still gets the key', async () => {
  const nodes = Array.from({ length: 24 }, (_, i) => `w: n${i} "A long service name ${i}" svc`).join('\n');
  const edges = Array.from({ length: 23 }, (_, i) => `w: n${i} -> n${i + 1} : step ${i}`).join('\n');
  const html = await frag(`diagram w dir=LR\n${nodes}\n${edges}`, true);
  assert.ok(keyOf(html));
});

test('legend: ignored on sequence diagrams (output unchanged)', async () => {
  const seq = `diagram s sequence\ns: a "A" user\ns: b "B" svc\ns: a -> b : hi\ns: b --> a : ok`;
  const base = await frag(seq);
  assert.equal(await frag(seq, true), base);
  assert.doesNotMatch(base, /dg-key|dg-legend/);
});

test('legend: the key is styled with tokens, wraps, and avoids the automatic legend class name', () => {
  const c = css({});
  const block = /\/\* stream v04-3 \*\/([\s\S]*?)\/\* end stream v04-3 \*\//.exec(c)?.[1] ?? '';
  assert.ok(block, 'stream block present');
  assert.match(block, /\.dg-key\{display:flex;flex-wrap:wrap/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i, 'tokens only');
  assert.doesNotMatch(block, /dg-legend/);
  assert.match(block, /\.dgk-sw \.edge\.blocked\{stroke:var\(--bad\)/);
});

// ------------------------------------------------------------------ sequence

const viewW = (svg: string) => Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
const svgs = (html: string) => [...html.matchAll(/<svg class="dg seq"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
const noteBoxes = (svg: string) =>
  [...svg.matchAll(/<rect class="note-box" x="(-?[\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    w: Number(m[2]),
  }));

const SIX = `diagram sso sequence title="Sign-in"
sso: browser "Browser" user
sso: portal "Course Portal" svc
sso: idp "Identity Provider" svc
sso: tokens "Token Service" svc
sso: dir "User Directory" db
sso: audit "Audit Log" store
sso: browser -> portal : open /courses
sso: portal --> browser : redirect to Identity Provider
sso: note browser : code valid 60 s, single use
sso: browser -> idp : authorization request with PKCE
sso: note audit : kept for 400 days, then deleted by the retention job
sso: tokens -> audit : record sign-in`;

const FOUR = `diagram o sequence title="Place an order"
o: cust "Customer" user
o: shop "Shop front" svc
o: pay "Payments" svc
o: ship "Shipping" ext
o: cust -> shop : POST /orders
o: note cust : the customer is signed in and has a long running cart open here
o: shop -> pay : authorize card
o: note ship : label printed at the warehouse after the payment clears and the stock is picked
o: opt "gift wrap requested"
o: shop -> shop : add wrap SKU
o: note shop, pay : wrap adds $4.50 and one day to the delivery window for this order
o: end
o: pay --> shop : approved
o: shop --> cust : confirmation email`;

test('sequence: a note over the first participant is never cut off on the left, desktop or phone', async () => {
  for (const src of [SIX, FOUR]) {
    const html = await frag(src);
    const all = svgs(html);
    assert.ok(all.length >= 1);
    for (const svg of all) {
      const W = viewW(svg);
      for (const n of noteBoxes(svg)) {
        assert.ok(n.x >= 0, `note starts at ${n.x}`);
        assert.ok(n.x + n.w <= W, `note ends at ${n.x + n.w} > ${W}`);
      }
    }
  }
});

test('sequence: the note over the first participant that used to clip (bench page 75) now fits', async () => {
  const [svg] = svgs(await frag(SIX));
  const [first] = noteBoxes(svg);
  assert.ok(first.x >= 4, `x ${first.x}`);
  // the lanes moved right with the note, so the first participant box is still inside
  const box = /<g class="node k-user"><rect class="box" x="(-?[\d.]+)"/.exec(svg);
  assert.ok(box && Number(box[1]) >= 0);
});

test('sequence: a very long note keeps every word, on desktop and phone (wrapped, never truncated)', async () => {
  const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
  const html = await frag(
    `diagram s sequence\ns: a "A" user\ns: b "B" svc\ns: a -> b : hi\ns: note a : ${words.join(' ')}\ns: b --> a : ok`,
  );
  const all = svgs(html);
  assert.equal(all.length, 2, 'desktop and phone drawings');
  for (const svg of all) {
    assert.doesNotMatch(svg, /…/);
    const text = [...svg.matchAll(/<text class="note-t"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
    assert.equal(text, words.join(' '));
  }
});

test('sequence: desktop text is no longer under 10px in the css (tags 10, numbers 11, notes and frames 12)', () => {
  const c = css({});
  const block = /\/\* stream v04-3 \*\/([\s\S]*?)\/\* end stream v04-3 \*\//.exec(c)![1];
  assert.match(block, /\.dg-h \.dg\.seq \.tagt[^{]*\{font-size:10px\}/);
  assert.match(block, /\.dg-h \.dg\.seq \.seqn\{font-size:11px\}/);
  assert.match(block, /\.note-t,\.fr-t\)\{font-size:12px\}/);
});

// ------------------------------------------------------------------ browser

const chrome = resolveChrome();
const skip = chrome ? false : 'no Chromium found: set CHROME to run the v0.4 diagram layout checks';
if (skip) console.warn(`v04 diagram layout checks skipped: ${skip}`);

// Runs in the page. Visible svgs only; text measured after the viewBox scale; clipping is against the svg's own box
// (the viewBox clips there, inside the figure's padding).
const MEASURE = `(() => {
  const out = [];
  const phone = innerWidth <= 500;
  const sw = document.scrollingElement.scrollWidth;
  if (sw > innerWidth) out.push('page scrolls sideways: ' + sw + ' > ' + innerWidth);
  for (const s of document.querySelectorAll('.scroll')) if (s.scrollWidth > s.clientWidth + 1) out.push('figure scrolls sideways ' + s.scrollWidth + ' > ' + s.clientWidth);
  for (const svg of document.querySelectorAll('svg:not(.dgk-sw)')) {
    const sr = svg.getBoundingClientRect();
    if (!sr.width) continue;
    const scale = sr.width / svg.viewBox.baseVal.width;
    const seq = svg.classList.contains('seq');
    if (!phone && seq && scale < 0.85) out.push('desktop sequence drawing scaled down to ' + scale.toFixed(2));
    for (const t of svg.querySelectorAll('text')) {
      const size = parseFloat(getComputedStyle(t).fontSize) * scale;
      const r = t.getBoundingClientRect();
      const label = '"' + t.textContent.slice(0, 24) + '" (' + size.toFixed(1) + 'px)';
      if (phone && size < 11 - 0.05) out.push('text under 11px: ' + label);
      if (!phone && seq && t.classList.contains('note-t') && size < 10.5) out.push('desktop note text under 10.5px: ' + label);
      if (r.width && (r.left < sr.left - 0.5 || r.right > sr.right + 0.5)) out.push('text clipped by the svg: ' + label);
    }
    for (const n of svg.querySelectorAll('.note-box')) {
      const r = n.getBoundingClientRect();
      if (r.left < sr.left - 0.5 || r.right > sr.right + 0.5) out.push('note box clipped by the svg');
    }
  }
  for (const k of document.querySelectorAll('.dg-key')) {
    const r = k.getBoundingClientRect(), p = k.closest('figure').getBoundingClientRect();
    if (r.right > p.right + 0.5 || r.left < p.left - 0.5) out.push('key spills out of its figure');
    for (const i of k.querySelectorAll('.dgk')) {
      const q = i.getBoundingClientRect();
      if (q.right > r.right + 0.5) out.push('key item spills out of the key: ' + i.textContent);
    }
    if (parseFloat(getComputedStyle(k.querySelector('.dgk-t')).fontSize) < 11) out.push('key text under 11px');
  }
  return out;
})()`;

const FIXTURES: Record<string, { src: string; legend?: boolean }> = {
  'flow-legend-all': { src: KINDS, legend: true },
  'flow-legend-two': { src: TWO, legend: true },
  'flow-legend-nested': {
    legend: true,
    src: `diagram net dir=LR title="Nested network"
net: users "Shoppers" user
net: cdn "Edge cache" ext
net: lb "Load balancer" lb
net: web "Web tier" svc "3 tasks" focus
net: jobs "Job runner" fn
net: db "Primary store" db
net: queue "Work queue" queue
net: group pub "Public subnet" lb
net: group priv "Private subnet" web, jobs, queue, db
net: group vpc "Network 10.4.0.0/16" pub, priv
net: users -> cdn -> lb : https
net: lb -> web : forward
net: web -> db : query
net: web -> queue : enqueue
net: queue --> jobs : poll
net: jobs -> db : write results
net: users -x- db : never direct`,
  },
  'seq-six-note-first': { src: SIX },
  'seq-four-notes': { src: FOUR },
};

async function check(): Promise<string[]> {
  const req = createRequire(new URL('../../../bench/package.json', import.meta.url));
  // playwright-core lives in bench/ (not a dependency of this package), so it is typed here by the little used.
  interface Pg {
    goto(u: string, o: object): Promise<unknown>;
    waitForTimeout(n: number): Promise<void>;
    evaluate(f: string): Promise<unknown>;
    addScriptTag(o: { path: string }): Promise<unknown>;
  }
  interface Br {
    newContext(o: object): Promise<{ newPage(): Promise<Pg>; close(): Promise<void> }>;
    close(): Promise<void>;
  }
  const { chromium } = req('playwright-core') as { chromium: { launch(o: { executablePath: string }): Promise<Br> } };
  const axe = req.resolve('axe-core/axe.min.js');
  const dir = mkdtempSync(join(tmpdir(), 'lede-v04-dg-'));
  const bad: string[] = [];
  const browser = await chromium.launch({ executablePath: chrome! });
  try {
    for (const [name, f] of Object.entries(FIXTURES)) {
      const d = parse(`@title ${name}\n# ${name}\n\n${f.src}`);
      const b = d.blocks.find((x) => x.type === 'diagram') as DiagramBlock;
      if (f.legend) b.legend = true;
      const file = join(dir, `${name}.html`);
      writeFileSync(file, await render(d));
      for (const [width, scheme] of [
        [400, 'dark'],
        [1280, 'light'],
        [1280, 'dark'],
        [400, 'light'],
      ] as const) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
        const page = await ctx.newPage();
        await page.goto(`file://${file}`, { waitUntil: 'load' });
        await page.waitForTimeout(50);
        const at = `${name} @${width} ${scheme}`;
        if ((width === 400 && scheme === 'dark') || (width === 1280 && scheme === 'light')) {
          for (const m of (await page.evaluate(MEASURE)) as string[]) bad.push(`${at}: ${m}`);
        } else {
          const over = (await page.evaluate('document.scrollingElement.scrollWidth - innerWidth')) as number;
          if (over > 0) bad.push(`${at}: page scrolls sideways by ${over}px`);
        }
        await page.addScriptTag({ path: axe });
        const n = (await page.evaluate(
          `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.reduce((a, v) => a + v.nodes.length, 0))`,
        )) as number;
        if (n) bad.push(`${at}: ${n} contrast violation${n === 1 ? '' : 's'}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  return bad;
}

let measured: Promise<string[]> | undefined;
const findings = () => (measured ??= check());

test(
  'browser: v0.4 flow keys and sequence diagrams have no overflow, no clipped text, text of 11px or more on phones',
  { skip, timeout: 300_000 },
  async () => {
    const bad = (await findings()).filter((f) => !/contrast violation/.test(f));
    assert.deepEqual(bad, []);
  },
);

test('browser: zero contrast violations in both themes at both widths', { skip, timeout: 300_000 }, async () => {
  assert.deepEqual(
    (await findings()).filter((f) => /contrast violation/.test(f)),
    [],
  );
});
