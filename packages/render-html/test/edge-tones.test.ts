// Edge tones (spec §4.17, D80): a toned edge or message draws its line, arrowhead and label chip in a status color, in both themes and both
// drawings; the line style still carries meaning; the key lists the tones used. The browser battery runs at 1280 and 360 px, light and dark.
// It skips, with a message, when no Chromium resolves (set CHROME to one); it fails instead when CI or LEDE_REQUIRE_CHROME is set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '@lede-lang/core';
import { render } from '../src/index.ts';
import { css } from '../src/theme.ts';
import { AXE, browserTest, type Browser } from './chrome.ts';

const frag = (src: string) => render(parse(src), { fragment: true });

const FLOW = `diagram arch dir=LR title="Request path"
arch: web "Web tier" svc
arch: api "API" svc focus
arch: db "Orders" db
arch: pay "Payments" ext
arch: web -> api : allow | good
arch: api --> pay : retry | warn
arch: api -x- db : direct writes | bad
arch: api -> db | info
arch: pay -> db : settle | neutral
arch: web -> pay : audit
arch: legend`;

const SEQ = `diagram calls sequence title="Calls"
calls: a "Client"
calls: b "Gateway"
calls: c "Auth"
calls: a -> b : GET /orders | good
calls: b -> c : verify token | info
calls: c --> b : expired | warn
calls: b --> a : 401 | bad
calls: b -> b : retry | neutral
calls: a -> b : plain`;

const keyOf = (html: string) => /<div class="dg-key"[^>]*>([\s\S]*?)<\/div><\/figure>/.exec(html)?.[1] ?? '';
const keyTexts = (html: string) => [...keyOf(html).matchAll(/<span class="dgk-t">(.*?)<\/span>(?=<\/span>)/g)].map((m) => m[1]);
const paths = (html: string, cls: string) =>
  [...html.matchAll(/<path class="([^"]*)"[^>]*>/g)].filter((m) => m[1].split(' ').includes(cls));

test('a toned edge carries its tone on the line, the arrowhead marker, the label chip and the label text', async () => {
  const html = await frag(FLOW);
  const first = html.slice(html.indexOf('<svg class="dg"'), html.indexOf('</svg>'));
  assert.match(first, /<path class="edge tn t-good" [^>]*marker-end="url\(#d1-a-good\)"/);
  assert.match(first, /<path class="edge dash tn t-warn" [^>]*marker-end="url\(#d1-a-warn\)"/);
  assert.match(first, /<path class="edge blocked tn t-bad" [^>]*marker-end="url\(#d1-a-bad\)"/);
  assert.match(first, /<path class="edge tn t-info" [^>]*marker-end="url\(#d1-a-info\)"/);
  assert.match(first, /<path class="edge tn t-neutral" [^>]*marker-end="url\(#d1-a-neutral\)"/);
  // The one untoned edge keeps the grey head.
  assert.match(first, /<path class="edge" [^>]*marker-end="url\(#d1-a\)"/);
  for (const t of ['good', 'warn', 'bad', 'neutral']) {
    assert.match(first, new RegExp(`<rect class="lmask tn t-${t}"`), `${t} chip`);
    assert.match(first, new RegExp(`<text class="elabel[^"]*tn t-${t}"`), `${t} label`);
  }
  assert.match(first, /<marker id="d1-a-good"[^>]*><path d="[^"]*" class="ah tn t-good"\/><\/marker>/);
  // The label with no tone is drawn as before.
  assert.match(first, /<rect class="lmask" [^>]*\/><text class="elabel" [^>]*>audit<\/text>/);
});

test('the line style still carries meaning: dashed and blocked stay, and a blocked edge keeps its cross, in the tone', async () => {
  const html = await frag(FLOW);
  assert.match(html, /<path class="edge dash tn t-warn"/);
  assert.match(html, /<path class="edge blocked tn t-bad"/);
  assert.match(html, /<g class="blk tn t-bad"><circle/);
  assert.match(html, /<text class="elabel blocked tn t-bad"/);
  // A blocked edge with another tone is still blocked and crossed, in that tone.
  const warn = await frag('diagram f\nf: a -x- b : x | warn');
  assert.match(warn, /<path class="edge blocked tn t-warn"/);
  assert.match(warn, /<g class="blk tn t-warn">/);
});

test('markers are made for the tones a diagram uses and no others, in each drawing, and an untoned diagram is unchanged', async () => {
  const html = await frag(FLOW);
  assert.deepEqual(
    [...html.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]),
    [
      'd1-a',
      'd1-a-good',
      'd1-a-warn',
      'd1-a-bad',
      'd1-a-info',
      'd1-a-neutral',
      'd1v-a',
      'd1v-a-good',
      'd1v-a-warn',
      'd1v-a-bad',
      'd1v-a-info',
      'd1v-a-neutral',
    ],
  );
  // The phone drawing points at its own markers.
  const phone = html.slice(html.indexOf('<div class="dg-v"'));
  assert.doesNotMatch(phone.slice(0, phone.indexOf('</svg>')), /url\(#d1-a/);
  assert.match(phone, /marker-end="url\(#d1v-a-good\)"/);
  const plain = await frag('diagram f\nf: a -> b : x\nf: b --> a');
  assert.deepEqual(
    [...plain.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]),
    ['d1-a', 'd1v-a'],
  );
  assert.doesNotMatch(plain, /\btn\b|\bt-(good|bad|warn|info|neutral)\b|class="et/);
  // One diagram, one tone: one extra marker per drawing.
  const one = await frag('diagram f\nf: a -> b | good\nf: b -> a | good');
  assert.deepEqual(
    [...one.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]),
    ['d1-a', 'd1-a-good', 'd1v-a', 'd1v-a-good'],
  );
});

test('a chain and a fan-out draw every edge in the tone', async () => {
  const html = await frag('diagram f\nf: a -> b -> c, d : go | bad');
  assert.equal(paths(html, 't-bad').length, 6, 'three edges, two drawings');
});

test('the tone is in the title and the description, so the page does not rely on color', async () => {
  const html = await frag(FLOW);
  assert.match(html, /<title>web → api: allow, good<\/title>/);
  assert.match(html, /<title>api → db: info<\/title>/);
  assert.match(html, /<desc id="d1-d">[^<]*Web tier → API \(allow, good\); API → Payments \(retry, warn\)/);
});

test('the key lists the tones used, each named by the first label of its edges, or by the tone word', async () => {
  const html = await frag(FLOW);
  const texts = keyTexts(html).filter((t) => !t.startsWith('<span'));
  assert.deepEqual(texts, [
    'focus',
    'request / flow',
    'async / reply / optional',
    'must not exist',
    'allow',
    'retry',
    'direct writes',
    'info',
    'settle',
  ]);
  const sws = [...keyOf(html).matchAll(/<svg class="dgk-sw"[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  const toned = sws.filter((s) => /\btn\b/.test(s));
  assert.deepEqual(
    toned.map((s) => /t-(\w+)/.exec(s)![1]),
    ['good', 'warn', 'bad', 'info', 'neutral'],
  );
  for (const s of toned) assert.doesNotMatch(s, /<text|marker|url\(|<script/, 'plain paths, no markers');
  // The first edge of a tone has no label: the first one that has a label names it.
  const later = await frag('diagram f\nf: a -> b | good\nf: b -> c : ok | good\nf: c -> a | bad\nf: legend');
  assert.deepEqual(
    keyTexts(later).filter((t) => !t.startsWith('<span')),
    ['request / flow', 'ok', 'bad'],
  );
  // No key without `legend`, and no tone entry without a tone.
  assert.doesNotMatch(await frag(FLOW.replace('\narch: legend', '')), /dg-key/);
  assert.doesNotMatch(keyOf(await frag('diagram f\nf: a -> b : x\nf: legend')), /\btn\b/);
});

test('hostile text in a toned label, in the key and in the lists stays escaped', async () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = await frag(`diagram f\nf: a -> b : ${bad} | good\nf: b -> a | warn\nf: legend`);
  assert.doesNotMatch(html, /<img/);
  assert.match(keyOf(html), /&lt;img src=x onerror=alert\(1\)&gt;/);
  const seq = await frag(`diagram s sequence\ns: a "A"\ns: b "B"\ns: c "C"\ns: d "D"\ns: e "E"\ns: a -> e : ${bad} | bad`);
  assert.doesNotMatch(seq, /<img/);
  assert.match(seq, /<span class="et tn t-bad">&lt;img/);
});

test('sequence messages: tone on the line, head, chip and text, in the desktop and the phone drawing, loops included', async () => {
  const html = await frag(SEQ);
  for (const drawing of [
    html.slice(html.indexOf('<div class="dg-h">'), html.indexOf('<div class="dg-v"')),
    html.slice(html.indexOf('<div class="dg-v"')),
  ]) {
    for (const [t, label] of [
      ['good', 'GET /orders'],
      ['info', 'verify token'],
      ['warn', 'expired'],
      ['bad', '401'],
      ['neutral', 'retry'],
    ]) {
      assert.match(drawing, new RegExp(`<path class="edge[^"]* tn t-${t}"[^>]*marker-end="url\\(#d\\d+v?-a-${t}\\)"`), `${t} line`);
      assert.match(drawing, new RegExp(`<rect class="lmask tn t-${t}"`), `${t} chip`);
      assert.match(drawing, new RegExp(`<text class="elabel tn t-${t}"[^>]*>${label}</text>`), `${t} text`);
    }
    // The reply stays dashed, and the plain message stays plain.
    assert.match(drawing, /<path class="edge dash tn t-warn"/);
    assert.match(drawing, /<path class="edge" [^>]*marker-end="url\(#d\d+v?-a\)"/);
  }
  assert.match(html, /1\. Client to Gateway: GET \/orders, good;/);
});

test('five or more participants: the phone list shows the tone as a chip with the label, or the tone word', async () => {
  const src = `diagram s sequence\ns: a "A"\ns: b "B"\ns: c "C"\ns: d "D"\ns: e "E"\ns: a -> e : go | good\ns: e --> a | bad\ns: a -> b : plain`;
  const html = await frag(src);
  assert.match(html, /<b>A<\/b> → <b>E<\/b>: <span class="et tn t-good">go<\/span><\/li>/);
  assert.match(html, /<li class="reply"><b>E<\/b> → <b>A<\/b>: <span class="et tn t-bad">bad<\/span><\/li>/);
  assert.match(html, /<b>A<\/b> → <b>B<\/b>: plain<\/li>/);
});

test('a flow too wide for a phone falls back to the list, which shows the tones too', async () => {
  const kids = Array.from({ length: 8 }, (_, i) => `k${i}`);
  const nodes = kids.map((k, i) => `w: ${k} "A long service name ${i}" svc "sub label ${i}"`).join('\n');
  const html = await frag(
    `diagram w dir=LR\nw: hub "Hub"\n${nodes}\nw: hub -> ${kids.join(', ')} : fan | good\nw: ${kids.join(', ')} -> sink : join\nw: sink -> hub | warn`,
  );
  assert.match(html, /<ol class="seqlist flowlist">/);
  assert.equal(html.match(/<li><b>Hub<\/b> → <b>A long service name \d<\/b>: <span class="et tn t-good">fan<\/span><\/li>/g)?.length, 8);
  assert.match(html, /<li><b>sink<\/b> → <b>Hub<\/b>: <span class="et tn t-warn">warn<\/span><\/li>/);
  assert.match(html, /<\/b> → <b>sink<\/b>: join<\/li>/);
});

test('the stylesheet: tokens only, both themes through them, a rule for each tone, and chips and lists covered', () => {
  const c = css({});
  const block = /\/\* edge tones \(D80\)[\s\S]*?\*\/([\s\S]*?)\.dgk-t\{/.exec(c)?.[1] ?? '';
  assert.ok(block, 'tone block present');
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i, 'tokens only');
  for (const [t, ink, bg] of [
    ['good', '--good', '--good-bg'],
    ['bad', '--bad', '--bad-bg'],
    ['warn', '--warn', '--warn-bg'],
    ['info', '--accent-ink', '--accent-tint'],
    ['neutral', '--fg2', '--info-bg'],
  ]) {
    assert.ok(block.includes(`.t-${t}{--tn:var(${ink});--tf:var(${bg})}`), `${t} tokens`);
  }
  assert.match(block, /:is\(\.dg,\.dgk-sw\) \.edge\.tn\{stroke:var\(--tn\)\}/);
  assert.match(block, /:is\(\.dg,\.dgk-sw\) \.ah\.tn\{fill:var\(--tn\)\}/);
  assert.match(block, /\.dg \.lmask\.tn\{fill:var\(--tf\)/);
  assert.match(block, /\.dg \.elabel\.tn\{fill:var\(--tn\)/);
  assert.match(block, /\.dg \.blk\.tn :is\(circle,path\)\{stroke:var\(--tn\)\}/);
  assert.match(block, /\.et\.tn\{/);
  // The tone rules come after the rules they override, so they win at equal specificity.
  for (const earlier of ['.dg .edge.blocked{', '.dg .elabel.yes{', '.dg .edge.hot{', '.dg .lmask{'])
    assert.ok(c.indexOf(earlier) < c.indexOf('.t-good{'), earlier);
});

// ------------------------------------------------------------------ browser

// Runs in the page. Colors are the computed ones, so this measures what is painted in the theme the page is in.
const MEASURE = `(() => {
  const out = [];
  const phone = innerWidth <= 500;
  const sw = document.scrollingElement.scrollWidth;
  if (sw > innerWidth) out.push('page scrolls sideways: ' + sw + ' > ' + innerWidth);
  for (const s of document.querySelectorAll('.scroll')) if (s.scrollWidth > s.clientWidth + 1) out.push('figure scrolls sideways ' + s.scrollWidth + ' > ' + s.clientWidth);
  const rgb = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); return m ? m[1].split(',').slice(0, 3).map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const surface = rgb(getComputedStyle(document.querySelector('figure')).backgroundColor);
  const seen = new Set();
  for (const svg of document.querySelectorAll('svg:not(.dgk-sw)')) {
    const sr = svg.getBoundingClientRect();
    if (!sr.width) continue;
    const scale = sr.width / svg.viewBox.baseVal.width;
    for (const t of svg.querySelectorAll('text')) {
      const cs = getComputedStyle(t);
      const size = parseFloat(cs.fontSize) * scale;
      const r = t.getBoundingClientRect();
      const label = '"' + t.textContent.slice(0, 24) + '" (' + size.toFixed(1) + 'px)';
      if (r.width && (r.left < sr.left - 0.5 || r.right > sr.right + 0.5)) out.push('text clipped by the svg: ' + label);
      if (!t.classList.contains('tn')) continue;
      // The chip is the mask rect drawn just before the text: the text must sit inside it and read against it.
      const chip = t.previousElementSibling && t.previousElementSibling.classList.contains('lmask') ? t.previousElementSibling : null;
      if (!chip || !chip.classList.contains('tn')) { out.push('toned label without its chip: ' + label); continue; }
      const c = chip.getBoundingClientRect();
      if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push('label wider than its chip: ' + label);
      const k = ratio(rgb(cs.fill), rgb(getComputedStyle(chip).fill));
      if (k < 4.5) out.push('label text on its chip is ' + k.toFixed(2) + ':1 (' + [...t.classList].join('.') + ')');
      seen.add([...t.classList].find((x) => x.startsWith('t-')));
    }
    for (const p of svg.querySelectorAll('path.edge.tn')) {
      const k = ratio(rgb(getComputedStyle(p).stroke), surface);
      if (k < 3) out.push('toned line is ' + k.toFixed(2) + ':1 against the card (' + [...p.classList].join('.') + ')');
      const id = /url\\(["']?#([^"')]+)/.exec(p.getAttribute('marker-end') || '');
      const head = id && document.getElementById(id[1]);
      const hp = head && head.querySelector('path');
      if (!hp) { out.push('toned line without its arrowhead'); continue; }
      if (getComputedStyle(hp).fill !== getComputedStyle(p).stroke) out.push('arrowhead and line differ: ' + [...p.classList].join('.'));
    }
  }
  for (const k of document.querySelectorAll('.dg-key')) {
    const r = k.getBoundingClientRect(), p = k.closest('figure').getBoundingClientRect();
    if (r.right > p.right + 0.5 || r.left < p.left - 0.5) out.push('key spills out of its figure');
    for (const i of k.querySelectorAll('.dgk')) if (i.getBoundingClientRect().right > r.right + 0.5) out.push('key item spills out of the key: ' + i.textContent);
  }
  for (const e of document.querySelectorAll('.et')) {
    const r = e.getBoundingClientRect(), p = e.closest('li').getBoundingClientRect();
    if (r.right > p.right + 0.5) out.push('list chip spills out of its row: ' + e.textContent);
    const k = ratio(rgb(getComputedStyle(e).color), rgb(getComputedStyle(e).backgroundColor));
    if (k < 4.5) out.push('list chip text is ' + k.toFixed(2) + ':1');
  }
  out.push('tones:' + [...seen].sort().join(','));
  return out;
})()`;

const BROWSER_SRC = `@title Edge tones
# Edge tones

${FLOW}

${SEQ}

diagram wide sequence title="Five"
wide: a "A"
wide: b "B"
wide: c "C"
wide: d "D"
wide: e "E"
wide: a -> e : A rather long label that has to wrap inside its row | good
wide: e --> a | bad
wide: b -> c : ok | warn

diagram long dir=TB title="Long labels and a long key"
long: a "Gateway" svc
long: b "Backend" svc
long: c "Store" db
long: a -> b : Mcp-Session-Id-Header-Forwarded-To-The-Backend-Unchanged | good
long: b -x- c : a very long explanation of why this path must never be taken in production | bad
long: a -> c : slow | warn
long: legend
`;

async function check(browser: Browser): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'lede-edge-tones-'));
  const bad: string[] = [];
  try {
    const file = join(dir, 'tones.html');
    writeFileSync(file, await render(parse(BROWSER_SRC)));
    for (const [width, scheme] of [
      [360, 'light'],
      [360, 'dark'],
      [1280, 'light'],
      [1280, 'dark'],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
      const page = await ctx.newPage();
      await page.goto(`file://${file}`, { waitUntil: 'load' });
      await page.waitForTimeout(50);
      const at = `@${width} ${scheme}`;
      const res = (await page.evaluate(MEASURE)) as string[];
      const tones = res.pop()!;
      for (const m of res) bad.push(`${at}: ${m}`);
      // Every tone shows up on a visible drawing: the phone shows the phone drawing, the desktop the desktop one.
      if (tones !== 'tones:t-bad,t-good,t-info,t-neutral,t-warn') bad.push(`${at}: ${tones}`);
      await page.addScriptTag({ path: AXE });
      const n = (await page.evaluate(
        `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.reduce((a, v) => a + v.nodes.length, 0))`,
      )) as number;
      if (n) bad.push(`${at}: ${n} contrast violation${n === 1 ? '' : 's'}`);
      await ctx.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad;
}

let measured: Promise<string[]> | undefined;
const findings = (browser: Browser) => (measured ??= check(browser));

browserTest(
  'browser: toned edges at 360 and 1280 px, light and dark: no overflow, no clipped text, labels read on their chips, lines read on the card',
  async (browser) => {
    assert.deepEqual(
      (await findings(browser)).filter((f) => !/contrast violation/.test(f)),
      [],
    );
  },
  300_000,
);

browserTest(
  'browser: zero contrast violations with tones, both themes at both widths',
  async (browser) => {
    assert.deepEqual(
      (await findings(browser)).filter((f) => /contrast violation/.test(f)),
      [],
    );
  },
  300_000,
);
