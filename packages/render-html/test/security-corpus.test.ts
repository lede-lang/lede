// D49: an adversarial corpus over every place untrusted text reaches the HTML. Data lives in
// fixtures/security-corpus.json: `strings` go into every `contexts` template (one document per string), and each
// of `cases` is its own document. Every output must pass `audit`: no script or other
// active element (a `--shell` page: exactly the data block and the hashed runtime), no event-handler attribute, no javascript:/vbscript:/data: URL (data:image only on <img src>),
// no remote fetch unless allowRemote, CSS that cannot be broken out of, and the CSP meta in place.
// The static audit is the gate. When a Chromium resolves, a second pass loads every page with the CSP removed and
// JavaScript on, and fails on any dialog or any request that leaves the page (the CSP is a backstop, not the fix).
// The editor words (spec §4.19) are in the contexts and cases: their controls pass the audit by shape (internal spec,
// lede-lang/meta, Security), and a `--shell` page is driven in Chromium with all three export formats checked against the oracle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Parser } from 'htmlparser2';
import { HEX_COLOR, fieldsOf, parse, type ExportFormat, type QuestionBlock } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { serializeExport } from '../src/export.ts';
import { browserTest, type Browser } from './chrome.ts';
import { heldValues, SNAPSHOT, type Entry } from './held.ts';

interface Case {
  id: string;
  src: string;
  allowRemote?: boolean;
  errors?: string[];
  warnings?: string[];
  has?: string[];
  hasNot?: string[];
  /** Also built with `--shell` and audited as a shell page; the source holds its own field and `export`. */
  shell?: boolean;
  /** The text the driven pass types into every text control of a shell case (default: an image with a handler). */
  payload?: string;
  /** Texts of elements the page forges with the runtime's classes; each must be on the page, and unchanged after the driven pass. */
  inert?: string[];
}
interface Corpus {
  strings: string[];
  /**
   * `skip`: a regex; strings it matches are left out of that context (see the fixture's `about`). `errors`: the context is built on its
   * own, and every string must make it fail with one of these codes (and no other): the page is still audited, and the text never renders.
   */
  contexts: { name: string; lede: string; skip?: string; errors?: string[] }[];
  cases: Case[];
}
const corpus = JSON.parse(readFileSync(new URL('./fixtures/security-corpus.json', import.meta.url), 'utf8')) as Corpus;

// ------------------------------------------------------------------ the audit

/** Elements that run script, fetch, navigate, submit or restyle the page; none may come out of the renderer. */
const DENY = new Set(
  (
    'script iframe frame frameset object embed applet form button select option base link portal noscript ' +
    'template xmp plaintext listing noembed noframes math foreignobject animate set animatemotion animatetransform use image ' +
    'feimage video audio source track isindex keygen dialog marquee bgsound param output datalist'
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

/** The runtime as it sits on disk, hashed here and not by the code under test. A shell page's policy must name exactly this. */
const RUNTIME_FILE = readFileSync(new URL('../src/shell-runtime.js', import.meta.url), 'utf8');
const sri = (text: string): string => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
const RUNTIME_HASH = sri(RUNTIME_FILE);

/** The page policy; a shell page's adds `script-src` for one hash. */
function csp(allowRemote: boolean, scriptHash?: string): string {
  const img = allowRemote ? "'self' data: https:" : "'self' data:";
  const script = scriptHash ? `; script-src '${scriptHash}'` : '';
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; base-uri 'none'; form-action 'none'${script}">`;
}

/**
 * The question controls (spec §4.18) and the editor words' (§4.19) are the only form elements a page may hold. The compiler makes them,
 * and the sanitizer allows none of these tags, so each is judged by shape: its attributes, and the names and kinds it carries against
 * the fields the source declared. A row is keyed by tag, by `input:TYPE`, or by `tag.class` for the class-only elements of the editor
 * words; `fieldset`, `legend` and `label` are listed so they cannot carry anything else either. A checkbox never carries `aria-invalid`
 * in the markup: only the runtime sets it. There is no row for `output`, `select`, `datalist`, `form` or `button` outside a shell page,
 * and none of these takes `id`, `style`, `list`, `form*` or an event handler.
 */
const INPUT = ['type', 'name', 'autocomplete', 'value'];
const CONTROL_ATTRS: Record<string, string[]> = {
  input: INPUT,
  'input:text': INPUT,
  'input:radio': [...INPUT, 'checked'],
  'input:checkbox': [...INPUT, 'checked'],
  'input:range': [...INPUT, 'min', 'max', 'step'],
  'input:number': [...INPUT, 'min', 'max', 'step', 'aria-label'],
  textarea: ['name', 'rows', 'autocomplete'],
  fieldset: ['class'],
  legend: ['class'],
  label: ['class'],
  'div.q q-toggle': ['class'],
  'span.q-nd': ['class'],
  'span.q-st': ['class', 'role'],
  'ul.q-bk': ['class'],
  'ol.q-items': ['class'],
  'li.q-item': ['class'],
  'figure.q q-tpl': ['class'],
  'figcaption.q-t': ['class'],
  'p.q-cnt': ['class'],
  'div.q q-preset': ['class'],
  'button.q-pre': ['type', 'class', 'hidden'],
};
const row = (k: string): string[] | undefined => (Object.hasOwn(CONTROL_ATTRS, k) ? CONTROL_ATTRS[k] : undefined);
const QUESTION_NAME = /^[A-Za-z][\w-]*$/;
/** An item radio is named for its bucket set and its index: the colon is outside the name set, so no field can collide with one. */
const ITEM_NAME = /^[A-Za-z][\w-]*:\d+$/;
const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
const DATA_KEYS = new Set(['v', 'page', 'fields', 'presets', 'formats']);
const FIELD_KEYS = new Set(['n', 'k', 'i', 'u', 'mn', 'mx', 'st', 'd', 'b', 't', 's']);
interface FieldKind {
  name: string;
  kind: string;
  /** A bucket set's item count, which is how many item radios the page must hold for it. */
  items?: number;
}

/**
 * Every way `html` breaks the safety contract (§4.10, §7, D10); empty when it holds. `fields` are the source's question fields.
 * `shell` is a page built with `--shell`: it must hold exactly the JSON block and the runtime, and its policy must name the runtime.
 */
function audit(html: string, opts: { allowRemote?: boolean; fields?: FieldKind[]; shell?: boolean } = {}): string[] {
  const bad: string[] = [];
  const allowRemote = !!opts.allowRemote;
  const shell = !!opts.shell;
  /** In a shell page the runtime's script and its copy, clear and preset buttons are expected; their shape is checked below. */
  const bodyDeny = (name: string) => BODY_DENY.has(name) && !(shell && (name === 'script' || name === 'button'));
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) return ['no </head>'];
  const body = html.slice(headEnd + '</head>'.length);
  const head = html.slice(0, headEnd);
  const policy = csp(allowRemote, shell ? RUNTIME_HASH : undefined);
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

  // Raw, parser-independent: escaped text never yields `<` followed by a letter, so every such `<` is a real tag. A shell page's two
  // script elements are judged separately below and left out here: the runtime's own source is full of `<` and `=>`.
  const scanned = shell ? body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '') : body;
  if (/<(?![a-zA-Z/!])/.test(scanned.replace(/<!doctype html>/i, ''))) bad.push('a bare < in the body: text was not escaped');
  // Attribute values are always double-quoted with `"` escaped, so blanking them leaves only names to inspect.
  for (const m of scanned.matchAll(/<\/?([a-zA-Z][^\s/>]*)([^>]*)>/g)) {
    const name = m[1].toLowerCase();
    if (bodyDeny(name)) bad.push(`raw <${name}> in the body`);
    if (/\son[a-z]+\s*=/i.test(m[2].replace(/"[^"]*"/g, '""'))) bad.push(`raw event handler: ${m[0].slice(0, 120)}`);
    if (/\s(href|src|xlink:href|action|formaction)\s*=\s*"\s*(javascript|vbscript):/i.test(m[2]))
      bad.push(`raw script URL: ${m[0].slice(0, 120)}`);
  }

  // Parsed, as a browser would read the attributes (entities decoded).
  const controls = new Set<string>();
  const ranges = new Map<string, number>();
  const numbers = new Map<string, number>();
  const scripts: { attribs: Record<string, string>; text: string; at: number }[] = [];
  let script: (typeof scripts)[number] | null = null;
  let fieldset = '';
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const parser = new Parser(
    {
      ontext(t) {
        if (script) script.text += t;
      },
      onclosetag(name) {
        if (name === 'fieldset') fieldset = '';
        if (name === 'script') script = null;
      },
      onopentag(name, attribs) {
        const inHead = parser.startIndex < headEnd;
        if (shell && name === 'script' && !inHead) {
          script = { attribs, text: '', at: parser.startIndex };
          scripts.push(script);
        }
        if (shell && name === 'button') {
          const ours = /^q-(clear|copy|pre)$/.test(attribs.class ?? '');
          if (!ours || attribs.type !== 'button' || Object.keys(attribs).some((k) => !['type', 'class', 'hidden'].includes(k)))
            bad.push(`<button ${JSON.stringify(attribs)}> is not a shell button`);
          else if (/^q-(clear|pre)$/.test(attribs.class ?? '') && !('hidden' in attribs))
            bad.push(`<button class="${attribs.class}"> is shown before the runtime reveals it`);
        }
        const hiddenOk =
          shell && ((name === 'div' && attribs.class === 'q-bar') || (name === 'button' && /^q-(clear|pre)$/.test(attribs.class ?? '')));
        if ('hidden' in attribs && !hiddenOk) bad.push(`<${name} hidden>`);
        if ('data-x' in attribs && !(name === 'figure' && /^(json|markdown|prompt)$/.test(attribs['data-x'])))
          bad.push(`<${name} data-x="${attribs['data-x']}">`);
        const type = name === 'textarea' ? 'textarea' : name === 'input' ? (attribs.type ?? '').toLowerCase() : '';
        const allowed = row(name === 'input' ? `input:${type}` : `${name}.${attribs.class ?? ''}`) ?? row(name);
        if (allowed) {
          for (const k of Object.keys(attribs)) if (!allowed.includes(k)) bad.push(`<${name} ${k}=…> is not an allowed control attribute`);
          const cls = attribs.class ?? '';
          if (name === 'fieldset')
            fieldset = /\bq-choose\b/.test(cls)
              ? 'choose'
              : /\bq-confirm\b/.test(cls)
                ? 'confirm'
                : /\bq-bucket\b/.test(cls)
                  ? 'bucket'
                  : '';
          if (name === 'input' || name === 'textarea') {
            if (!['text', 'radio', 'textarea', 'range', 'number', 'checkbox'].includes(type))
              bad.push(`<input type="${attribs.type ?? ''}">`);
            if (attribs.autocomplete !== 'off') bad.push(`<${name}> without autocomplete="off"`);
            const item = type === 'radio' && fieldset === 'bucket';
            if (!(item ? ITEM_NAME : QUESTION_NAME).test(attribs.name ?? '')) bad.push(`<${name} name="${attribs.name ?? ''}">`);
            if ('value' in attribs && type !== 'radio' && !['checkbox', 'range', 'number'].includes(type))
              bad.push(`<${name} value=…> outside a radio`);
            if (name === 'textarea' && !(Number(attribs.rows) >= 2 && Number(attribs.rows) <= 12))
              bad.push(`<textarea rows="${attribs.rows ?? ''}">`);
            if (type === 'radio' && !fieldset) bad.push('a radio outside a .q-choose, .q-confirm or .q-bucket fieldset');
            if (type === 'checkbox' && attribs.value !== 'on') bad.push(`<input type="checkbox" value="${attribs.value ?? ''}">`);
            if (type === 'range' || type === 'number')
              for (const k of ['min', 'max', 'step', 'value'])
                if (!NUMBER.test(attribs[k] ?? '')) bad.push(`<input type="${type}"> ${k}="${attribs[k] ?? ''}" is not a number`);
            if (type === 'number' && !(attribs['aria-label'] ?? '').trim()) bad.push('<input type="number"> without an aria-label');
            if (type === 'range') count(ranges, attribs.name ?? '');
            if (type === 'number') count(numbers, attribs.name ?? '');
            const kind =
              type === 'radio' ? fieldset : type === 'range' || type === 'number' ? 'param' : type === 'checkbox' ? 'toggle' : 'ask';
            controls.add(`${kind}:${attribs.name ?? ''}`);
          }
        }
        if (inHead ? !HEAD_TAGS.has(name) : bodyDeny(name)) bad.push(`<${name}>${inHead ? ' in the head' : ''}`);
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
  if (shell) {
    const end = html.indexOf('</main>');
    if (scripts.length !== 2) bad.push(`${scripts.length} scripts in a shell page; want the JSON block and the runtime`);
    else {
      const [data, run] = scripts;
      if (JSON.stringify(data.attribs) !== JSON.stringify({ type: 'application/json', id: 'lede-shell' }))
        bad.push(`data block attributes ${JSON.stringify(data.attribs)}`);
      if (Object.keys(run.attribs).length) bad.push(`runtime attributes ${JSON.stringify(run.attribs)}`);
      if (data.at < end || run.at < data.at) bad.push('the scripts must follow <main>, data block first');
      if (sri(run.text) !== RUNTIME_HASH) bad.push('the runtime text is not shell-runtime.js');
      if (/[<>&\u{2028}\u{2029}]/u.test(data.text)) bad.push('the data block holds a raw < > & or line separator');
      try {
        const block = JSON.parse(data.text) as { v?: unknown; fields?: Record<string, unknown>[] };
        if (block.v !== 2) bad.push(`data block version ${String(block.v)}; the runtime reads 2`);
        if (Object.keys(block).some((k) => !DATA_KEYS.has(k))) bad.push(`data block keys ${Object.keys(block).join(',')}`);
        for (const f of block.fields ?? [])
          if (Object.keys(f).some((k) => !FIELD_KEYS.has(k))) bad.push(`data block field keys ${Object.keys(f).join(',')}`);
      } catch {
        bad.push('the data block is not JSON');
      }
    }
  }
  // A bucket set is one radio group per item, a param one range and one number box under one name, a template no control at all.
  const want = (opts.fields ?? [])
    .flatMap((f) =>
      f.kind === 'bucket'
        ? Array.from({ length: f.items ?? 0 }, (_, i) => `bucket:${f.name}:${i}`)
        : f.kind === 'template'
          ? []
          : [`${f.kind}:${f.name}`],
    )
    .toSorted();
  if (JSON.stringify([...controls].toSorted()) !== JSON.stringify(want))
    bad.push(`controls ${JSON.stringify([...controls].toSorted())} are not the declared fields ${JSON.stringify(want)}`);
  for (const f of opts.fields ?? [])
    if (f.kind === 'param' && !(ranges.get(f.name) === 1 && numbers.get(f.name) === 1))
      bad.push(`param ${f.name} has ${ranges.get(f.name) ?? 0} range and ${numbers.get(f.name) ?? 0} number inputs; want one of each`);
  return bad;
}

// ------------------------------------------------------------------ building the documents

const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]/g, ' ');
const fill = (tpl: string, p: string) =>
  tpl.replace(/\{([TQC])\}/g, (_, k: string) =>
    k === 'T' ? oneLine(p) : k === 'Q' ? oneLine(p).replaceAll('"', '""') : `"${oneLine(p).replaceAll('"', '""')}"`,
  );
const skipped = (c: Corpus['contexts'][number], p: string) => !!c.skip && new RegExp(c.skip).test(p);
/** The contexts that make one document per string with every other: they must build without an error. */
const contextsFor = (p: string) => corpus.contexts.filter((c) => !c.errors && !skipped(c, p));
/** The contexts that must fail for every string (a name that is no toggle): each is its own document. */
const failingFor = (p: string) => corpus.contexts.filter((c) => c.errors && !skipped(c, p));
const contextDoc = (p: string) =>
  contextsFor(p)
    .map((c) => fill(c.lede, p))
    .join('\n\n');
const markersFor = (p: string) => contextsFor(p).flatMap((c) => c.lede.match(/Mk\d+/g) ?? []);

const fieldKinds = (doc: Awaited<ReturnType<typeof compile>>['doc']): FieldKind[] =>
  fieldsOf(doc.blocks).map((f) =>
    f.type === 'bucket' ? { name: f.name, kind: f.type, items: f.items.length } : { name: f.name, kind: f.type },
  );

const outputs: { label: string; html: string; allowRemote: boolean; fields: FieldKind[] }[] = [];

async function build(label: string, src: string, allowRemote = false) {
  const { html, doc } = await compile(src, { allowRemote });
  outputs.push({ label, html, allowRemote, fields: fieldKinds(doc) });
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
  // Question controls pass only by shape, and only as the fields the source declared.
  const ask = '<label class="q q-ask"><span class="q-t">x</span><input type="text" name="a" autocomplete="off"></label>';
  const fieldA = [{ name: 'a', kind: 'ask' }];
  assert.deepEqual(audit(page(ask), { fields: fieldA }), []);
  assert.deepEqual(audit(page(ask.replace('type="text"', 'type="TEXT"')), { fields: fieldA }), []);
  assert.notDeepEqual(audit(page(ask)), [], 'a control the source did not declare');
  assert.notDeepEqual(audit(page(ask), { fields: [{ name: 'b', kind: 'ask' }] }), [], 'a different name');
  for (const bad of [
    ask.replace('type="text"', 'type="password"'),
    ask.replace('type="text"', 'type="image" src="//xss.example/a.png"'),
    ask.replace('type="text"', 'type="submit"'),
    ask.replace('type="text"', 'type="file"'),
    ask.replace('type="text"', 'type="hidden"'),
    ask.replace('type="text" ', ''),
    ask.replace('autocomplete="off"', 'autocomplete="off" formaction="//xss.example"'),
    ask.replace('autocomplete="off"', 'autocomplete="off" onfocus="x"'),
    ask.replace('autocomplete="off"', 'autocomplete="off" list="l"'),
    ask.replace('autocomplete="off"', 'autocomplete="off" id="a"'),
    ask.replace('autocomplete="off"', ''),
    ask.replace('<label class="q q-ask">', '<label class="q q-ask" style="color:red">'),
    ask.replace('</label>', '<button type="button" class="q-copy">x</button></label>'),
    ask.replace('</label>', '<button type="submit">x</button></label>'),
    ask.replace('<label class="q q-ask">', '<form action="//xss.example"><label class="q q-ask">').replace('</label>', '</label></form>'),
    '<input type="radio" name="a" value="x" autocomplete="off">',
    '<div hidden>x</div>',
    '<figure data-x="js">x</figure>',
  ])
    assert.notDeepEqual(audit(page(bad), { fields: fieldA }), [], bad);
  assert.notDeepEqual(audit(page('').replace('a{}', ':root{--accent:red}')), []);
  assert.notDeepEqual(audit(page('').replace('a{}', ':root{--accent:#fff;}body{background:url(//x)}')), []);
});

/** Every editor word once, and the sentinel and hostile text the rules are about. */
const EDITOR_SRC = [
  'ask a | A',
  'param p unit=ms | P | 5 0 10 1',
  'toggle t | T',
  'toggle u needs=t | U',
  'bucket b | Now, Next',
  'b: one | Now',
  'b: two | Next',
  'template tpl | Tpl',
  '```text',
  '{a} {p}',
  '```',
  'preset ps | Ps | p=7',
  'export prompt',
  'export json',
  'export markdown',
].join('\n');

test('the audit admits the editor words by shape, in both modes, and refuses what a look-alike would add', async () => {
  const plain = await compile(EDITOR_SRC);
  const live = await compile(EDITOR_SRC, { shell: true });
  const fields = fieldKinds(plain.doc);
  assert.deepEqual(
    fields.map((f) => f.kind),
    ['ask', 'param', 'toggle', 'toggle', 'bucket', 'template'],
  );
  assert.deepEqual(audit(plain.html, { fields }), []);
  assert.deepEqual(audit(live.html, { fields, shell: true }), []);
  const html = plain.html;
  const sh = live.html;
  const has = (s: string, h: string) => assert.ok(h.includes(s), `the markup has ${s}`);
  const hasAll = [
    '<input type="range" name="p" min="0"',
    '<input type="checkbox" name="t" value="on" autocomplete="off">',
    '<label class="q q-param">',
    '<ul class="q-bk">',
    '<p class="q-cnt">',
    '<input type="radio" name="b:1" value="Next" autocomplete="off" checked>',
  ];
  for (const x of hasAll) has(x, html);
  has('<button type="button" class="q-pre" hidden>', sh);
  // Each of these is the audit's refusal for one reason, named by its message.
  const refused: [string, string, RegExp, boolean?][] = [
    ['input type=color', html.replace('type="range"', 'type="color"'), /<input type="color">/],
    [
      'type=range with no min',
      html.replace('<input type="range" name="p" min="0"', '<input type="range" name="p"'),
      /<input type="range"> min="" is not a number/,
    ],
    [
      'type=number with a handler value',
      html.replace('<input type="number" name="p" min="0"', '<input type="number" name="p" min="javascript:x"'),
      /min="javascript:x" is not a number/,
    ],
    ['type=number with no aria-label', html.replace(' aria-label="P, value"', ''), /without an aria-label/],
    [
      'a second range for one param',
      html.replace(
        '<input type="number" name="p"',
        '<input type="range" name="p" min="0" max="10" step="1" value="5" autocomplete="off"><input type="number" name="p"',
      ),
      /param p has 2 range and 1 number/,
    ],
    ['a param with no number box', html.replace(/<input type="number"[^>]*>/, ''), /param p has 1 range and 0 number/],
    [
      'a checkbox that is already invalid',
      html.replace('<input type="checkbox" name="t"', '<input type="checkbox" aria-invalid="true" name="t"'),
      /aria-invalid=…> is not an allowed control attribute/,
    ],
    [
      'aria-invalid on a label',
      html.replace('<label class="q q-param">', '<label class="q q-param" aria-invalid="true">'),
      /aria-invalid=…> is not an allowed control attribute/,
    ],
    ['a checkbox that says yes', html.replace('name="t" value="on"', 'name="t" value="yes"'), /<input type="checkbox" value="yes">/],
    ['an item radio for an item that is not there', html.replace('name="b:1"', 'name="b:7"'), /controls .* are not the declared fields/],
    ['an item radio named for no index', html.replaceAll('name="b:0"', 'name="b"'), /<input name="b">/],
    [
      'a radio outside its fieldset',
      html.replace('<fieldset class="q q-bucket">', '<div class="q q-bucket">').replace('</fieldset>', '</div>'),
      /a radio outside/,
    ],
    ['an output', html.replace('</main>', '<output>x</output></main>'), /raw <output>/],
    ['a select', html.replace('</main>', '<select><option>x</option></select></main>'), /raw <select>/],
    [
      'any button in an ordinary page',
      html.replace('</main>', '<button type="button" class="q-pre" hidden>x</button></main>'),
      /raw <button>/,
    ],
    [
      'a style on the count list',
      html.replace('<ul class="q-bk">', '<ul class="q-bk" style="color:red">'),
      /style=…> is not an allowed control attribute/,
    ],
    [
      'a handler on the count line',
      html.replace('<p class="q-cnt">', '<p class="q-cnt" onclick="x">'),
      /onclick=…> is not an allowed control attribute/,
    ],
    [
      'an id on the template figure',
      html.replace('<figure class="q q-tpl">', '<figure class="q q-tpl" id="t">'),
      /id=…> is not an allowed control attribute/,
    ],
    ['a data-x of js', html.replace('data-x="json"', 'data-x="js"'), /data-x="js"/],
    ['a shell button of another class', sh.replace('class="q-pre"', 'class="go"'), /is not a shell button/, true],
    ['a shell button with a handler', sh.replace('class="q-pre"', 'class="q-pre" onclick="x"'), /is not a shell button/, true],
    ['a preset button that is shown', sh.replace('class="q-pre" hidden', 'class="q-pre"'), /is shown before the runtime reveals it/, true],
    [
      'a preset button that submits',
      sh.replace('type="button" class="q-pre"', 'type="submit" class="q-pre"'),
      /is not a shell button/,
      true,
    ],
    ['a data block of version 1', sh.replace('{"v":2', '{"v":1'), /data block version 1/, true],
    ['a data block field with an extra key', sh.replace('{"n":"a","k":"ask"}', '{"n":"a","k":"ask","x":1}'), /data block field keys/, true],
    ['a data block with a raw <', sh.replace('{"v":2', '{"v":2,"page":"<b>"'), /raw </, true],
  ];
  for (const [what, out, re, shell] of refused) {
    assert.notEqual(out, shell ? sh : html, `${what}: the mutation changed the markup`);
    const found = audit(out, { fields, shell: !!shell });
    assert.ok(
      found.some((m) => re.test(m)),
      `${what}: wanted ${re}, got ${JSON.stringify(found)}`,
    );
  }
  assert.notDeepEqual(audit(sh, { fields }), [], 'a shell page is not an ordinary page');
});

test(`every string in every context: ${corpus.strings.length} strings × ${corpus.contexts.length} contexts`, async () => {
  const fails: string[] = [];
  for (const [i, p] of corpus.strings.entries()) {
    const where = `string ${i} ${JSON.stringify(p).slice(0, 60)}`;
    const { html, doc } = await build(where, contextDoc(p));
    for (const d of doc.diagnostics.filter((x) => x.severity === 'error'))
      fails.push(`${where}: unexpected error ${d.code} on line ${d.line}: ${d.message}`);
    for (const m of markersFor(p)) if (!html.includes(m)) fails.push(`${where}: marker ${m} missing, so its block did not render`);
    for (const c of failingFor(p)) {
      const label = `${where} in ${c.name}`;
      const { doc: bad } = await build(label, fill(c.lede, p));
      const codes = [...new Set(bad.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code))];
      if (codes.length === 0 || codes.some((x) => !c.errors?.includes(x)))
        fails.push(`${label}: errors ${JSON.stringify(codes)}, expected only ${JSON.stringify(c.errors)}`);
    }
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
    // A shell case's `has` names shell output (the data block), so it is checked on the shell build only.
    for (const s of c.has ?? []) if (!c.shell && !html.includes(s)) fails.push(`${where}: output lacks ${JSON.stringify(s)}`);
    for (const s of c.hasNot ?? []) if (html.includes(s)) fails.push(`${where}: output has ${JSON.stringify(s)}`);
  }
  assert.deepEqual(fails, []);
});

test('every output passes the audit', () => {
  assert.ok(outputs.length >= corpus.strings.length + corpus.cases.length);
  const fails = outputs.flatMap((o) => audit(o.html, { allowRemote: o.allowRemote, fields: o.fields }).map((p) => `${o.label}: ${p}`));
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
const BASE = '<head><base href="https://lede.test/page.html">';
type Tab = Awaited<ReturnType<Browser['newPage']>>;
async function probe<T extends { label: string; html: string }>(
  browser: Browser,
  pages: T[],
  tabs = 8,
  after?: (page: Tab, item: T) => Promise<string[]>,
): Promise<string[]> {
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
        if (after) found.push(...(await after(page, next)));
      }
      await page.close();
    }),
  );
  return found;
}

browserTest(
  'in Chromium with the CSP removed, no payload runs and nothing leaves the page',
  async (browser) => {
    // Control: the probe must see a handler run and both spellings of a protocol-relative fetch.
    const control = '<p>x</p><img src="x" onerror="alert(1)"><img src="//xss.example/a.png"><img src="/\\xss.example/b.png">';
    const seen = (await probe(browser, [{ label: 'control', html: control }])).join('\n');
    for (const want of ['a dialog opened', 'request to https://xss.example/a.png', 'request to https://xss.example/b.png'])
      assert.ok(seen.includes(want), `control: ${want} not seen in\n${seen}`);
    // allowRemote pages are left out: remote images are what they allow.
    const pages = outputs.filter((o) => !o.allowRemote).map((o) => ({ label: o.label, html: o.html.replace(csp(false), '') }));
    assert.ok(pages.length > corpus.strings.length, 'the corpus pages were built (run the whole file, not this test alone)');
    assert.deepEqual(await probe(browser, pages), []);
  },
  600_000,
);

// ------------------------------------------------------------------ shell mode (D63)

const SHELL_SUFFIX = '\n\nask zz | z\n\nexport json\n\nexport markdown\n\nexport prompt';
const PAYLOAD = '<img src=x onerror=alert(1)>';
interface ShellOut {
  label: string;
  html: string;
  fields: FieldKind[];
  blocks: QuestionBlock[];
  payload: string;
  inert: string[];
}
const shellOutputs: ShellOut[] = [];

test('the shell audit catches what it claims to catch', async () => {
  const { html: base, doc } = await compile('ask a | q\nexport json', { shell: true });
  const fields = fieldKinds(doc);
  assert.deepEqual(audit(base, { shell: true, fields }), []);
  const runtime = `<script>${RUNTIME_FILE}</script>`;
  assert.ok(base.includes(runtime));
  const bads: [string, string][] = [
    ['a second script', base.replace('</body>', '<script>x</script></body>')],
    ['a runtime with one changed byte', base.replace(runtime, `<script>${RUNTIME_FILE} </script>`)],
    ['no runtime', base.replace(runtime, '')],
    ['a data block typed as script', base.replace('type="application/json"', 'type="text/javascript"')],
    ['a data block with a raw <', base.replace('{"v":2', '{"v":2,"page":"<b>"')],
    ['a data block with an extra key', base.replace('{"v":2', '{"v":2,"x":1')],
    ['a policy without the hash', base.replace(/; script-src '[^']*'/, '')],
    ['a policy naming another hash', base.replace(/script-src '[^']*'/, "script-src 'sha256-AAAA'")],
    ['a submit button', base.replace('type="button" class="q-copy"', 'type="submit" class="q-copy"')],
    ['a button of another class', base.replace('class="q-copy"', 'class="go"')],
    ['a handler on the copy button', base.replace('class="q-copy"', 'class="q-copy" onclick="x"')],
    ['a script URL', base.replace('</main>', '<a href="javascript:x">y</a></main>')],
    ['a hidden paragraph', base.replace('</main>', '<p hidden>x</p></main>')],
    ['an input with a handler', base.replace('autocomplete="off"', 'autocomplete="off" onfocus="x"')],
  ];
  for (const [what, html] of bads) assert.notDeepEqual(audit(html, { shell: true, fields }), [], what);
  assert.notDeepEqual(audit(base, { fields }), [], 'a shell page is not an ordinary page');
});

test(`shell mode: ${corpus.strings.length} strings in every context, plus the shell cases`, async () => {
  const fails: string[] = [];
  const check = (label: string, html: string, doc: Awaited<ReturnType<typeof compile>>['doc'], payload: string, inert: string[] = []) => {
    const fields = fieldKinds(doc);
    shellOutputs.push({ label, html, fields, blocks: fieldsOf(doc.blocks), payload, inert });
    for (const b of audit(html, { shell: true, fields })) fails.push(`${label}: ${b}`);
    if (!html.includes('id="lede-shell"')) fails.push(`${label}: no runtime was added`);
  };
  for (const [i, p] of corpus.strings.entries()) {
    const label = `shell string ${i} ${JSON.stringify(p).slice(0, 60)}`;
    const { html, doc } = await compile(contextDoc(p) + SHELL_SUFFIX, { shell: true });
    check(label, html, doc, p);
    for (const m of markersFor(p)) if (!html.includes(m)) fails.push(`${label}: marker ${m} missing`);
    for (const c of failingFor(p)) {
      const { html: h, doc: d } = await compile(fill(c.lede, p) + SHELL_SUFFIX, { shell: true });
      check(`${label} in ${c.name}`, h, d, p);
    }
  }
  for (const c of corpus.cases.filter((x) => x.shell)) {
    const label = `shell case ${c.id}`;
    const { html, doc } = await compile(c.src, { shell: true });
    check(label, html, doc, c.payload ?? PAYLOAD, c.inert);
    for (const s of c.has ?? []) if (!html.includes(s)) fails.push(`${label}: output lacks ${JSON.stringify(s)}`);
    for (const s of c.hasNot ?? []) if (html.includes(s)) fails.push(`${label}: output has ${JSON.stringify(s)}`);
    for (const s of c.inert ?? []) if (!html.includes(s)) fails.push(`${label}: the forged text ${JSON.stringify(s)} is not on the page`);
  }
  assert.deepEqual(fails, []);
  assert.ok(shellOutputs.length >= corpus.strings.length + 5);
});

/** The controls driven by a hostile reader, in the page: every text, number and range box takes the payload; every box and switch flips. */
const DRIVE = `((payload) => {
  const main = document.querySelector('main');
  for (const e of main.querySelectorAll('input[type=text], textarea, input[type=number], input[type=range]')) e.value = payload;
  for (const e of main.querySelectorAll('input[type=checkbox]')) e.checked = !e.checked;
  for (const g of new Set([...main.querySelectorAll('input[type=radio]')].map((r) => r.name))) {
    const rs = main.querySelectorAll('input[type=radio][name="' + g + '"]');
    rs[rs.length - 1].checked = true;
  }
  main.dispatchEvent(new Event('input', { bubbles: true }));
  for (const b of main.querySelectorAll('.q-copy')) b.click();
})`;
const PRESETS = `(() => { for (const b of document.querySelectorAll('main .q-pre')) b.click(); })()`;
const NUMBERS = `(() => {
  const main = document.querySelector('main');
  for (const e of main.querySelectorAll('input[type=number]')) e.value = e.max;
  for (const e of main.querySelectorAll('input[type=range]')) e.value = e.min;
  for (const g of new Set([...main.querySelectorAll('input[type=radio]')].map((r) => r.name)))
    main.querySelector('input[type=radio][name="' + g + '"]').checked = true;
  main.dispatchEvent(new Event('input', { bubbles: true }));
})()`;
const STATE = `(() => ({
  page: JSON.parse(document.querySelector('script#lede-shell').textContent).page,
  entries: ${SNAPSHOT},
  out: Object.fromEntries([...document.querySelectorAll('main figure[data-x]')].map((x) => [x.dataset.x, x.querySelector('code').textContent])),
  text: document.querySelector('main').textContent,
}))()`;

/** After a drive: each export equals the oracle's over what the controls hold, and every forged element still has its text. */
async function checkDriven(page: Tab, item: ShellOut, phase: string): Promise<string[]> {
  const got = (await page.evaluate(STATE)) as { page?: string; entries: Entry[]; out: Record<string, string>; text: string };
  const bad: string[] = [];
  if (Object.keys(got.out).length === 0) bad.push(`${item.label}: ${phase}: no export was written`);
  const held = heldValues(item.blocks, got.entries);
  for (const [fmt, text] of Object.entries(got.out))
    if (text !== serializeExport(fmt as ExportFormat, got.page, item.blocks, held))
      bad.push(`${item.label}: ${phase}: ${fmt} export differs from the reference serializer`);
  for (const t of item.inert)
    if (!got.text.includes(t)) bad.push(`${item.label}: ${phase}: the forged element ${JSON.stringify(t)} changed`);
  return bad;
}

browserTest(
  'shell pages in Chromium: the runtime runs under its policy; with the policy removed and every control driven, nothing runs or leaves',
  async (browser) => {
    assert.ok(shellOutputs.length > corpus.strings.length, 'the shell pages were built (run the whole file, not this test alone)');
    const policy = (h: string) => /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(h)![0];
    // With the policy in place the runtime runs: its copy bar is shown.
    const dark = await probe(browser, shellOutputs, 8, async (page, item) => {
      if (!(await page.locator('.q-bar').first().isVisible())) return [`${item.label}: the runtime did not run under its policy`];
      // The bar is shown before the listeners are wired, so typing must reach the export too.
      await page.locator('input[type=text], textarea').first().fill('Qx9');
      const shown = await page.locator('figure[data-x] code').first().textContent();
      return shown?.includes('Qx9') ? [] : [`${item.label}: typing did not reach the export under the policy`];
    });
    assert.deepEqual(dark, []);
    // With the policy removed, drive every control with the payload as the answer, click every preset, set the numbers, and compare each
    // export with the reference serializer over what the controls hold.
    const open = shellOutputs.map((o) => Object.assign({}, o, { html: o.html.replace(policy(o.html), '') }));
    const driven = await probe(browser, open, 8, async (page, item) => {
      const bad = await checkDriven(page, item, 'at load');
      await page.evaluate(`${DRIVE}(${JSON.stringify(item.payload)})`);
      bad.push(...(await checkDriven(page, item, 'payload')));
      await page.evaluate(PRESETS);
      bad.push(...(await checkDriven(page, item, 'presets')));
      await page.evaluate(NUMBERS);
      bad.push(...(await checkDriven(page, item, 'numbers')));
      return bad;
    });
    assert.deepEqual(driven, []);
  },
  600_000,
);
