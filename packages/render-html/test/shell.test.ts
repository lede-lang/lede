// `--shell` (spec §4.18, §7, D63): page assembly, the pinned runtime, and the runtime file's own gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compile, render, RUNTIME, RUNTIME_SHA256, wantsShell } from '../src/index.ts';
import { parse } from '@lede-lang/core';

const SRC = [
  '@title Release 4.2 go/no-go',
  'ask owner | Who signs off?',
  'choose risk | low, medium, high',
  'confirm migration | The migration ran',
  'cards',
  '### Card',
  'ask notes lines=3 | Notes?',
  '## After',
  'export json',
  'export markdown',
].join('\n');

const here = (p: string) => new URL(p, import.meta.url);
const file = readFileSync(here('../src/shell-runtime.js'), 'utf8');
const b64 = (s: string) => `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}`;
const csp = (h: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(h)![1];
const scripts = (h: string) => [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], text: m[2] }));

// ---------------------------------------------------------------- assembly

test('a shell page adds one JSON block, the runtime and a hash in the policy; the rest is the ordinary page', async () => {
  const plain = (await compile(SRC)).html;
  const shell = (await compile(SRC, { shell: true })).html;
  assert.equal(csp(shell), `${csp(plain)}; script-src '${RUNTIME_SHA256}'`);
  const s = scripts(shell);
  assert.equal(s.length, 2);
  assert.equal(s[0].attrs, ' type="application/json" id="lede-shell"');
  assert.equal(s[1].attrs, '');
  assert.equal(s[1].text, RUNTIME);
  assert.ok(shell.indexOf('<script') > shell.indexOf('</main>'), 'scripts follow <main>');
  // Removing the shell's additions gives the ordinary page back.
  const stripped = shell
    .replace(/\n?<script[\s\S]*<\/script>/, '')
    .replace(/<button type="button" class="q-clear" hidden>Clear<\/button>/g, '')
    .replace(/<div class="q-bar" hidden>[\s\S]*?<\/div>/g, '')
    .replace(`; script-src '${RUNTIME_SHA256}'`, '');
  assert.equal(stripped.replace(/\n+<\/body>/, '\n</body>'), plain.replace(/\n+<\/body>/, '\n</body>'));
});

test('the page hash is the digest of the runtime file, of RUNTIME, and of the committed hex', async () => {
  assert.equal(RUNTIME, file);
  assert.equal(RUNTIME_SHA256, b64(file));
  const shell = (await compile(SRC, { shell: true })).html;
  assert.equal(b64(scripts(shell)[1].text), RUNTIME_SHA256);
  assert.equal(readFileSync(here('../src/shell-runtime.sha256'), 'utf8').trim(), createHash('sha256').update(file, 'utf8').digest('hex'));
});

test('the data block holds the title, the fields in source order and the formats, and cannot be broken out of', async () => {
  const { html } = await compile(SRC, { shell: true });
  const block = JSON.parse(scripts(html)[0].text) as Record<string, unknown>;
  assert.deepEqual(block, {
    v: 1,
    page: 'Release 4.2 go/no-go',
    fields: [
      { n: 'owner', k: 'ask' },
      { n: 'risk', k: 'choose' },
      { n: 'migration', k: 'confirm' },
      { n: 'notes', k: 'ask' },
    ],
    formats: ['json', 'markdown'],
  });
  // The parser keeps U+2028 out of a meta line, so the title is set on the document: the escaping must not depend on that.
  const hostile = '</script><meta http-equiv=refresh content=0> & <!-- \u2028 \u2029 "q"';
  const hostileDoc = parse('ask a | q\nexport');
  hostileDoc.meta.title = hostile;
  const out = await render(hostileDoc, { shell: true });
  const text = scripts(out)[0].text;
  assert.doesNotMatch(text, /[<>&\u2028\u2029]/);
  assert.equal((JSON.parse(text) as { page: string }).page, hostile);
  assert.equal(scripts(out).length, 2);
  assert.equal(out.includes('<meta http-equiv=refresh'), false);
});

test('a page with no field or no export is built as without the flag', async () => {
  for (const src of ['# Hello\n\nText', 'ask a | q', 'export json', '']) {
    assert.equal((await compile(src, { shell: true })).html, (await compile(src)).html, JSON.stringify(src));
    assert.equal(wantsShell(parse(src)), false);
  }
  assert.equal(wantsShell(parse(SRC)), true);
});

test('--artifact keeps the title, style and main, then the scripts, with no meta; fragment has no runtime', async () => {
  const doc = parse(SRC);
  const art = await render(doc, { shell: true, artifact: true });
  assert.match(art, /^<title>/);
  assert.equal(art.includes('<meta'), false);
  assert.equal(scripts(art).length, 2);
  assert.ok(art.indexOf('<script') > art.indexOf('</main>'));
  assert.equal(await render(doc, { shell: true, fragment: true }), await render(doc, { fragment: true }));
  assert.equal((await render(doc, { shell: true, fragment: true })).includes('<script'), false);
});

test('shell with unsafeHtml is refused', async () => {
  await assert.rejects(compile(SRC, { shell: true, unsafeHtml: true }), /unsafe/i);
  assert.equal((await compile(SRC, { unsafeHtml: true })).html.includes('<script'), false);
});

test('a field that has an error is not in the page or the data block', async () => {
  const { html } = await compile('ask a | q\nask a | dup\nask 9x | bad\nexport json', { shell: true });
  assert.deepEqual((JSON.parse(scripts(html)[0].text) as { fields: unknown[] }).fields, [{ n: 'a', k: 'ask' }]);
  assert.equal((html.match(/<input /g) ?? []).length, 1);
});

// ---------------------------------------------------------------- the runtime file

test('the generated module and hash file are current (the 8 KiB, ASCII and no-</script gates run there), and the module has no node: import', () => {
  assert.ok(file.length > 500, 'not a stub');
  const r = spawnSync(process.execPath, [new URL('../../../scripts/gen-runtime.ts', import.meta.url).pathname, '--check'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(readFileSync(here('../src/shell-runtime.ts'), 'utf8'), /\bnode:|\bimport\b|\brequire\b/);
  assert.doesNotMatch(readFileSync(here('../src/shell.ts'), 'utf8'), /from\s+'node:/);
});

const CATEGORIES: [string, RegExp][] = [
  ['code from text', /\beval\b|\bFunction\b|\bconstructor\b|\bwith\s*\(|\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/],
  [
    'network and workers',
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|Worker|\bRTC|BroadcastChannel|importScripts|\bimport\s*\(/,
  ],
  ['storage and identity', /localStorage|sessionStorage|indexedDB|\bcookie\b|\bhistory\b|window\.name/],
  [
    'markup and URLs',
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createElement|appendChild|insertBefore|replaceWith|\.append\b|\.prepend\b|cloneNode|importNode|DOMParser|\.src\b|\.href\b|\blocation\b|\bopen\s*\(|postMessage/,
  ],
  ['global escapes', /globalThis|window\s*\[|\bself\s*\[|\bReflect\b/],
  ['dialogs and clipboard reads', /\balert\s*\(|\bprompt\s*\(|\bconfirm\s*\(|execCommand|readText|clipboard\.read\b/],
];
for (const [name, re] of CATEGORIES)
  test(`the runtime has nothing in the category: ${name}`, () => {
    assert.doesNotMatch(file, re);
  });

test('the runtime assigns only textContent and checked, and passes only allowed literals to attribute and event calls', () => {
  const assigned = [...file.matchAll(/\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(assigned)].filter((n) => n !== 'textContent' && n !== 'checked'),
    [],
  );
  assert.doesNotMatch(file, /\]\s*=(?!=)/, 'no bracket assignment');
  assert.doesNotMatch(file, /\bon[a-z]+\s*=/, 'no handler property');
  const arg = (fn: string) => [...file.matchAll(new RegExp(`${fn}\\(\\s*([^,)]*)`, 'g'))].map((m) => m[1].trim());
  for (const a of [...arg('setAttribute'), ...arg('removeAttribute')]) assert.equal(a, "'hidden'");
  for (const a of arg('addEventListener')) assert.match(a, /^'(input|change|click|pageshow)'$/);
  assert.ok(arg('setAttribute').length > 0 && arg('addEventListener').length >= 4, 'it uses them');
});
