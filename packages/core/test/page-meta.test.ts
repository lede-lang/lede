// D70 and D80: `@image` and `@canonical` take an absolute https URL (W `meta-url`), and `@meta Key | value` records a fact for the
// masthead's facts row and a `lede:key` head tag (E `meta-field`). Spec §4.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, META_KEYS, factEntries, factName, httpsUrl, httpsUrlProblem, parse, readFact } from '../src/index.ts';

const diags = (src: string) => parse(src).diagnostics;

test('httpsUrl returns the normalised href of an https URL, and null for anything else', () => {
  assert.equal(httpsUrl('https://x.example/a/../b.png'), 'https://x.example/b.png');
  assert.equal(httpsUrl('HTTPS://X.example'), 'https://x.example/');
  assert.equal(httpsUrl('https://x.example/a.png?q="><script>'), 'https://x.example/a.png?q=%22%3E%3Cscript%3E');
  for (const v of [
    'http://x.example/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA==',
    '/a.png',
    '//xss.example/p',
    'a.png',
    'https://',
    '',
  ])
    assert.equal(httpsUrl(v), null, v);
});

test('httpsUrlProblem names why: relative, data, scheme or invalid', () => {
  assert.equal(httpsUrlProblem('https://x.example/a.png'), null);
  for (const [v, kind] of [
    ['/a.png', 'relative'],
    ['a.png', 'relative'],
    ['//xss.example/p', 'relative'],
    ['', 'relative'],
    ['data:image/png;base64,AA==', 'data'],
    ['DATA:text/html,x', 'data'],
    ['http://x.example/a.png', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['\u0001javascript:alert(1)', 'scheme'],
    ['ftp://x.example/a', 'scheme'],
    ['https://', 'invalid'],
    ['https:', 'invalid'],
  ] as const)
    assert.equal(httpsUrlProblem(v), kind, JSON.stringify(v));
});

test('@image and @canonical are known keys; a valid https URL raises nothing and is stored as written', () => {
  assert.ok(['image', 'canonical', 'meta'].every((k) => META_KEYS.includes(k)));
  const doc = parse('@image https://x.example/a.png\n@canonical https://x.example/p\n# T');
  assert.deepEqual(doc.diagnostics, []);
  assert.deepEqual([doc.meta.image, doc.meta.canonical], ['https://x.example/a.png', 'https://x.example/p']);
});

test('W meta-url on the line, with detail {key, value, kind}', () => {
  for (const [src, kind] of [
    ['@image /a.png', 'relative'],
    ['@canonical //xss.example/p', 'relative'],
    ['@image data:image/png;base64,AA==', 'data'],
    ['@image http://x.example/a.png', 'scheme'],
    ['@canonical javascript:alert(1)', 'scheme'],
    ['@image https://', 'invalid'],
  ] as const) {
    const [d, ...more] = diags(`# T\n${src}`);
    const key = src.slice(1, src.indexOf(' '));
    assert.equal(more.length, 0, src);
    assert.deepEqual([d.severity, d.code, d.line, d.col], ['warning', 'meta-url', 2, 1], src);
    assert.deepEqual(d.detail, { key, value: src.slice(src.indexOf(' ') + 1), kind }, src);
  }
});

test('@meta keeps each valid fact, in order, one per line of meta.meta', () => {
  const doc = parse('@meta Owner | Ana Ruiz\n@meta  Status|Draft \n@meta Note | a | b\n# T');
  assert.deepEqual(doc.diagnostics, []);
  assert.equal(doc.meta.meta, 'Owner | Ana Ruiz\nStatus | Draft\nNote | a | b');
  assert.deepEqual(factEntries(doc.meta), [
    ['Owner', 'Ana Ruiz'],
    ['Status', 'Draft'],
    ['Note', 'a | b'],
  ]);
  assert.deepEqual(factEntries({}), []);
});

test('E meta-field when the | or either side is missing; the fact is not kept, the others are', () => {
  const doc = parse('@meta Owner | Ana\n@meta Owner Ana\n@meta | Ana\n@meta Owner |\n@meta\n@meta Last | x\n# T');
  assert.deepEqual(
    doc.diagnostics.map((d) => [d.severity, d.code, d.line, d.col]),
    [2, 3, 4, 5].map((line) => ['error', 'meta-field', line, 1]),
  );
  assert.deepEqual(factEntries(doc.meta), [
    ['Owner', 'Ana'],
    ['Last', 'x'],
  ]);
  assert.match(doc.diagnostics[0].message, /`\|` between/);
  assert.match(doc.diagnostics[1].message, /no key/);
  assert.match(doc.diagnostics[2].message, /no value/);
});

test('readFact splits at the first |', () => {
  assert.deepEqual(readFact('A | b | c'), ['A', 'b | c']);
  assert.equal(readFact('A'), null);
  assert.equal(readFact(' | b'), null);
  assert.equal(readFact('A | '), null);
});

test('factName: lower case, runs of other characters one hyphen, empty when nothing is left', () => {
  assert.equal(factName('Owner'), 'owner');
  assert.equal(factName('Last  reviewed by'), 'last-reviewed-by');
  assert.equal(factName('  Q3 / Plan! '), 'q3-plan');
  assert.equal(factName('"><script>'), 'script');
  assert.equal(factName('所有者'), '');
});

test('streaming: page metadata read line by line, in chunks of one character, equals the whole parse', () => {
  const src = '@image /nope.png\n@canonical https://x.example/p\n@meta Owner | Ana\n@meta bad\n@meta Stage | Beta\n\n# T\n';
  const s = new LedeStream();
  for (const ch of src) s.write(ch);
  const doc = s.end();
  const whole = parse(src);
  assert.deepEqual(doc.meta, whole.meta);
  assert.deepEqual(doc.diagnostics, whole.diagnostics);
  assert.deepEqual(factEntries(doc.meta), [
    ['Owner', 'Ana'],
    ['Stage', 'Beta'],
  ]);
});
