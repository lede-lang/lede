// D49: an adversarial corpus over every place untrusted text reaches the HTML. Data lives in
// fixtures/security-corpus.json: `strings` go into every `contexts` template (one document per string), and each
// of `cases` is its own document. Every output must pass `audit`: no script or other
// active element, no event-handler attribute, no javascript:/vbscript:/data: URL (data:image only on <img src>),
// no remote fetch unless allowRemote, CSS that cannot be broken out of, and the CSP meta in place.
// The static audit is the gate. When a Chromium resolves, a second pass loads every page with the CSP removed and
// JavaScript on, and fails on any dialog or any request that leaves the page (the CSP is a backstop, not the fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Parser } from 'htmlparser2';
import { HEX_COLOR, parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { chromium, resolveChrome } from '../../../bench/src/shot.ts';

interface Case {
  id: string;
  src: string;
  allowRemote?: boolean;
  errors?: string[];
  warnings?: string[];
  has?: string[];
  hasNot?: string[];
}
interface Corpus {
  strings: string[];
  /** `skip`: a regex; strings it matches are left out of that context (see the fixture's `about`). */
  contexts: { name: string; lede: string; skip?: string }[];
  cases: Case[];
}
const corpus = JSON.parse(readFileSync(new URL('./fixtures/security-corpus.json', import.meta.url), 'utf8')) as Corpus;

// ------------------------------------------------------------------ the audit

/** Elements that run script, fetch, navigate, submit or restyle the page; none may come out of the renderer. */
const DENY = new Set(
  (
    'script iframe frame frameset object embed applet form input button textarea select option base link portal noscript ' +
    'template xmp plaintext listing noembed noframes math foreignobject animate set animatemotion animatetransform use image ' +
    'feimage video audio source track isindex keygen dialog marquee bgsound param'
  ).split(' '),
);
const URL_ATTRS = new Set(
  'href src srcset xlink:href action formaction poster background cite data ping longdesc lowsrc dynsrc codebase manifest icon usemap archive classid'.split(
    ' ',
  ),
);
/** SVG presentation attributes that take url(); only a local `url(#id)` is allowed. */
const PAINT_ATTRS = new Set('fill stroke marker-start marker-mid marker-end clip-path mask filter cursor'.split(' '));
const SCRIPT_SCHEMES = new Set(['javascript:', 'vbscript:', 'livescript:', 'mocha:']);
/**
 * URLs are judged by Node's WHATWG parser, not by core's url.ts, so a bug there cannot blind the audit as well.
 * Each is resolved against a page served over https and one opened from disk: `https:host/x` is remote only on the
 * second, `//host/x` is a UNC fetch (`file://host/x`) there. A value neither base parses cannot load.
 */
const BASES = ['https://lede.test/dir/page.html', 'file:///dir/page.html'];
const resolved = (v: string): URL[] =>
  BASES.flatMap((base) => {
    try {
      return [new URL(v, base)];
    } catch {
      return [];
    }
  });
const offPage = (u: URL) => (u.protocol === 'file:' ? u.host !== '' : u.protocol !== 'data:' && u.origin !== 'https://lede.test');
const STYLE_DECL = /^\s*-{0,2}[a-z][a-z-]*\s*:\s*[-#\w.%, ]+\s*$/i;
const HEAD_TAGS = new Set(['html', 'head', 'meta', 'title', 'style', 'body']);
/** After the head, these may not appear at all (the page's own <body>, </html> and SVG <title>s may). */
const BODY_DENY = new Set([...DENY, 'meta', 'style', 'head']);

function csp(allowRemote: boolean): string {
  const img = allowRemote ? "'self' data: https:" : "'self' data:";
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; base-uri 'none'; form-action 'none'">`;
}

/** Every way `html` breaks the safety contract (§4.10, §7, D10); empty when it holds. */
function audit(html: string, opts: { allowRemote?: boolean } = {}): string[] {
  const bad: string[] = [];
  const allowRemote = !!opts.allowRemote;
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) return ['no </head>'];
  const body = html.slice(headEnd + '</head>'.length);
  const head = html.slice(0, headEnd);
  const policy = csp(allowRemote);
  if (head.split(policy).length !== 2) bad.push('CSP meta missing, changed or repeated');
  if (!(head.indexOf(policy) < head.indexOf('<style>'))) bad.push('CSP meta must come before the stylesheet');
  if ((head.match(/<style\b/g) ?? []).length !== 1) bad.push('head must hold exactly one <style>');
  if ((head.match(/<title\b/g) ?? []).length !== 1) bad.push('head must hold exactly one <title>');
  for (const m of head.matchAll(/<meta\b[^>]*>/g)) {
    if (
      !/^<meta (charset="utf-8"|name="(viewport|generator|description)" content="[^"]*"|http-equiv="Content-Security-Policy" content="[^"]*")>$/.test(
        m[0],
      )
    )
      bad.push(`unexpected head meta: ${m[0]}`);
  }
  const css = /<style>([\s\S]*?)<\/style>/.exec(head)?.[1] ?? '';
  if (/<\/|url\(|@import|expression\(|javascript:|behavio(u)?r\s*:|-moz-binding/i.test(css))
    bad.push('stylesheet carries markup, url() or script');
  if ((css.match(/\{/g) ?? []).length !== (css.match(/\}/g) ?? []).length) bad.push('stylesheet braces do not balance');
  for (const m of css.matchAll(/--accent(?:-ink)?:([^;}]*)/g))
    if (!HEX_COLOR.test(m[1].trim())) bad.push(`accent value is not a hex color: ${m[1]}`);

  // Raw, parser-independent: escaped text never yields `<` followed by a letter, so every such `<` is a real tag.
  if (/<(?![a-zA-Z/!])/.test(body.replace(/<!doctype html>/i, ''))) bad.push('a bare < in the body: text was not escaped');
  // Attribute values are always double-quoted with `"` escaped, so blanking them leaves only names to inspect.
  for (const m of body.matchAll(/<\/?([a-zA-Z][^\s/>]*)([^>]*)>/g)) {
    const name = m[1].toLowerCase();
    if (BODY_DENY.has(name)) bad.push(`raw <${name}> in the body`);
    if (/\son[a-z]+\s*=/i.test(m[2].replace(/"[^"]*"/g, '""'))) bad.push(`raw event handler: ${m[0].slice(0, 120)}`);
    if (/\s(href|src|xlink:href|action|formaction)\s*=\s*"\s*(javascript|vbscript):/i.test(m[2]))
      bad.push(`raw script URL: ${m[0].slice(0, 120)}`);
  }

  // Parsed, as a browser would read the attributes (entities decoded).
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const inHead = parser.startIndex < headEnd;
        if (inHead ? !HEAD_TAGS.has(name) : BODY_DENY.has(name)) bad.push(`<${name}>${inHead ? ' in the head' : ''}`);
        if (!/^[a-z][a-z0-9-]*$/.test(name)) bad.push(`odd tag name <${name}>`);
        for (const [k, v] of Object.entries(attribs)) {
          if (/^on/i.test(k)) bad.push(`<${name} ${k}=…>`);
          if (!/^[a-z_][a-z0-9_:.-]*$/.test(k)) bad.push(`odd attribute name on <${name}>: ${JSON.stringify(k)}`);
          if (k === 'style') {
            for (const decl of v.split(';').filter((d) => d.trim())) if (!STYLE_DECL.test(decl)) bad.push(`style="${v}" on <${name}>`);
          }
          if (PAINT_ATTRS.has(k) && /url\(/i.test(v) && !/^url\(#[\w-]+\)$/.test(v.trim()))
            bad.push(`${k}="${v}" on <${name}>: url() that is not a local #id`);
          if (!URL_ATTRS.has(k)) continue;
          const us = resolved(v);
          if (us.some((u) => SCRIPT_SCHEMES.has(u.protocol))) bad.push(`${k}="${v}" on <${name}>: script URL`);
          const data = us.find((u) => u.protocol === 'data:');
          if (data && !(name === 'img' && k === 'src' && data.pathname.toLowerCase().startsWith('image/')))
            bad.push(`${k}="${v}" on <${name}>: data URL that is not an image on <img src>`);
          const fetches = !(name === 'a' && k === 'href') && k !== 'cite';
          const urls = k === 'srcset' ? v.split(',').map((s) => s.trim().split(/\s+/)[0] ?? '') : [v];
          if (fetches && !allowRemote && urls.some((x) => resolved(x).some(offPage))) bad.push(`${k}="${v}" on <${name}>: remote fetch`);
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();
  return bad;
}

// ------------------------------------------------------------------ building the documents

const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]/g, ' ');
const fill = (tpl: string, p: string) =>
  tpl.replace(/\{([TQC])\}/g, (_, k: string) =>
    k === 'T' ? oneLine(p) : k === 'Q' ? oneLine(p).replaceAll('"', '""') : `"${oneLine(p).replaceAll('"', '""')}"`,
  );
const contextsFor = (p: string) => corpus.contexts.filter((c) => !(c.skip && new RegExp(c.skip).test(p)));
const contextDoc = (p: string) =>
  contextsFor(p)
    .map((c) => fill(c.lede, p))
    .join('\n\n');
const markersFor = (p: string) => contextsFor(p).flatMap((c) => c.lede.match(/Mk\d+/g) ?? []);

const outputs: { label: string; html: string; allowRemote: boolean }[] = [];

async function build(label: string, src: string, allowRemote = false) {
  const { html, doc } = await compile(src, { allowRemote });
  outputs.push({ label, html, allowRemote });
  return { html, doc };
}

test('the corpus holds at least 200 distinct payloads', () => {
  const distinct = new Set([...corpus.strings, ...corpus.cases.map((c) => c.src)]);
  assert.ok(distinct.size >= 200, `${distinct.size} distinct payloads`);
  assert.equal(new Set(corpus.cases.map((c) => c.id)).size, corpus.cases.length, 'case ids are unique');
});

test('the audit catches what it claims to catch', () => {
  const page = (body: string) =>
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${csp(false)}\n<title>t</title>\n<style>a{}</style>\n</head>\n<body>${body}</body></html>`;
  assert.deepEqual(audit(page('<p>ok</p>')), []);
  for (const bad of [
    '<script>x</script>',
    '<p onclick="x">a</p>',
    '<g class="node k-x" onmouseover="alert(1)"></g>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="\u0001javascript:x">x</a>',
    '<img src="/\\xss.example/a.png">',
    '<img src="https:xss.example/a.png">',
    '<img srcset="a.png 1x, //xss.example/b.png 2x">',
    '<a href="data:text/html,x">x</a>',
    '<img src="data:image\\svg+xml,x">',
    '<img src="\u0001//xss.example/a.png">',
    '<div style="background:url(//xss.example/a.png)">x</div>',
    '<p>1 < 2</p>',
    '<svg><foreignObject></foreignObject></svg>',
    '<meta http-equiv="refresh" content="0">',
  ])
    assert.notDeepEqual(audit(page(bad)), [], bad);
  assert.notDeepEqual(audit(page('').replace(csp(false), '')), []);
  assert.notDeepEqual(audit(page('').replace('a{}', ':root{--accent:red}')), []);
  assert.notDeepEqual(audit(page('').replace('a{}', ':root{--accent:#fff;}body{background:url(//x)}')), []);
});

test(`every string in every context: ${corpus.strings.length} strings × ${corpus.contexts.length} contexts`, async () => {
  const fails: string[] = [];
  for (const [i, p] of corpus.strings.entries()) {
    const where = `string ${i} ${JSON.stringify(p).slice(0, 60)}`;
    const { html, doc } = await build(where, contextDoc(p));
    for (const d of doc.diagnostics.filter((x) => x.severity === 'error'))
      fails.push(`${where}: unexpected error ${d.code} on line ${d.line}: ${d.message}`);
    for (const m of markersFor(p)) if (!html.includes(m)) fails.push(`${where}: marker ${m} missing, so its block did not render`);
  }
  assert.deepEqual(fails, []);
});

test(`${corpus.cases.length} single-document cases`, async () => {
  const fails: string[] = [];
  for (const c of corpus.cases) {
    const where = `case ${c.id} ${JSON.stringify(c.src).slice(0, 60)}`;
    const { html, doc } = await build(where, c.src, c.allowRemote);
    const codes = (sev: string) => [...new Set(doc.diagnostics.filter((d) => d.severity === sev).map((d) => d.code))].toSorted();
    if (JSON.stringify(codes('error')) !== JSON.stringify((c.errors ?? []).toSorted()))
      fails.push(`${where}: errors ${JSON.stringify(codes('error'))}, expected ${JSON.stringify(c.errors ?? [])}`);
    for (const w of c.warnings ?? []) if (!codes('warning').includes(w)) fails.push(`${where}: expected warning ${w}`);
    for (const s of c.has ?? []) if (!html.includes(s)) fails.push(`${where}: output lacks ${JSON.stringify(s)}`);
    for (const s of c.hasNot ?? []) if (html.includes(s)) fails.push(`${where}: output has ${JSON.stringify(s)}`);
  }
  assert.deepEqual(fails, []);
});

test('every output passes the audit', () => {
  assert.ok(outputs.length >= corpus.strings.length + corpus.cases.length);
  const fails = outputs.flatMap((o) => audit(o.html, { allowRemote: o.allowRemote }).map((p) => `${o.label}: ${p}`));
  assert.deepEqual(fails, []);
});

test("fragment output is the page's <main>, so the audit of the page covers it (minus the CSP)", async () => {
  for (const src of [contextDoc(corpus.strings[0]), corpus.cases[0].src]) {
    const { html } = await compile(src);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
    assert.equal(await render(parse(src), { fragment: true }), main);
  }
});

/**
 * Load each page with JavaScript on, several tabs at a time, and return every dialog and every request that leaves
 * https://lede.test/. A <base> puts the page at that origin (setContent is about:blank, where `//host` would not
 * resolve and so would never be requested), and lazy images are made eager so one below the fold is requested too.
 */
type Browser = Awaited<ReturnType<typeof chromium.launch>>;
const BASE = '<head><base href="https://lede.test/page.html">';
async function probe(browser: Browser, pages: { label: string; html: string }[], tabs = 8): Promise<string[]> {
  const found: string[] = [];
  const queue = [...pages];
  await Promise.all(
    Array.from({ length: tabs }, async () => {
      const page = await browser.newPage({ javaScriptEnabled: true });
      let cur = { label: '', html: '' };
      page.on('dialog', (d) => {
        found.push(`${cur.label}: a dialog opened (${d.message()})`);
        void d.dismiss();
      });
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (!url.startsWith('https://lede.test/') && !url.startsWith('data:')) found.push(`${cur.label}: request to ${url}`);
        return route.fulfill({ status: 404, body: '' });
      });
      for (let next = queue.shift(); next; next = queue.shift()) {
        const html = next.html.replaceAll('loading="lazy"', 'loading="eager"');
        cur = { label: next.label, html: html.includes('<head>') ? html.replace('<head>', BASE) : BASE + html };
        await page.setContent(cur.html, { waitUntil: 'load' });
        await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
      }
      await page.close();
    }),
  );
  return found;
}

test(
  'in Chromium with the CSP removed, no payload runs and nothing leaves the page',
  { skip: resolveChrome() ? false : 'no Chromium (set CHROME)' },
  async () => {
    const browser = await chromium.launch({ executablePath: resolveChrome()! });
    try {
      // Control: the probe must see a handler run and both spellings of a protocol-relative fetch.
      const control = '<p>x</p><img src="x" onerror="alert(1)"><img src="//xss.example/a.png"><img src="/\\xss.example/b.png">';
      const seen = (await probe(browser, [{ label: 'control', html: control }])).join('\n');
      for (const want of ['a dialog opened', 'request to https://xss.example/a.png', 'request to https://xss.example/b.png'])
        assert.ok(seen.includes(want), `control: ${want} not seen in\n${seen}`);
      // allowRemote pages are left out: remote images are what they allow.
      const pages = outputs.filter((o) => !o.allowRemote).map((o) => ({ label: o.label, html: o.html.replace(csp(false), '') }));
      assert.ok(pages.length > corpus.strings.length, 'the corpus pages were built (run the whole file, not this test alone)');
      assert.deepEqual(await probe(browser, pages), []);
    } finally {
      await browser.close();
    }
  },
);
