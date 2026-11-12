// D80: `@status Word=tone, ...` re-tones and adds status words wherever the built-in lexicon applies: table cells, the timeline's
// event column, kpi change and note, and step chips. The page's words come first, and match like the built-in ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { css } from '../src/theme.ts';
import { drive, normalize } from '../../../bench/src/incremental-model.ts';

const loadFile = () => 'a,b\n1,2';
const pills = (html: string) => [...html.matchAll(/<span class="pill (\w+)">([^<]*)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);
const out = async (src: string) => (await compile(src)).html;

const TABLE = 'table = Item,Status; a,Shipped; b,parked; c,needs   review.; d,Escalated; e,Beta; f,Blocked; g,Todo; h,Done';
const WORDS = '@status Shipped=good, Parked=neutral, Needs review=warn, Escalated=bad, Beta=info\n@status Blocked=info';

test('page words become chips in a table, case-insensitively, with spaces collapsed and a closing full stop ignored', async () => {
  assert.deepEqual(pills(await out(`${WORDS}\n\n${TABLE}`)), [
    'good:Shipped',
    'neutral:parked',
    'warn:needs   review.',
    'bad:Escalated',
    'info:Beta',
    'info:Blocked',
    'neutral:Todo',
    'good:Done',
  ]);
});

test('the page words win over the built-in lexicon, which still serves every other word', async () => {
  const html = await out(`@status Blocked=info, Done=bad\n\ntable = Item,Status; a,Blocked; b,Done; c,Failed; d,On track`);
  assert.deepEqual(pills(html), ['info:Blocked', 'bad:Done', 'bad:Failed', 'good:On track']);
});

test('without @status the built-in words are as before; the grey ones are the neutral tone', async () => {
  const html = await out('table = Item,Status; a,Todo; b,Done; c,At risk; d,Blocked');
  assert.deepEqual(pills(html), ['neutral:Todo', 'good:Done', 'warn:At risk', 'bad:Blocked']);
  assert.equal(html.includes('@status'), false);
});

test('an entry whose tone is no tone is ignored: the word keeps its built-in meaning, or none', async () => {
  const html = await out('@status Done=loud, Shipped=nope, Zed=loud\n\ntable = Item,Status; a,Done; b,Shipped; c,Zed');
  assert.deepEqual(pills(html), ['good:Done', 'good:Shipped']);
});

test('chips in kpi change and note, step due and a timeline event take page words too', async () => {
  const src = [
    '@status Shipped=good, Parked=neutral, Beta=info',
    '',
    'kpi Releases | 12 | Shipped | Parked',
    '',
    'step Ship it | Beta | the note',
    '',
    'table = When,What; Mon,Shipped; Tue,Parked',
  ].join('\n');
  assert.deepEqual(pills(await out(src)), ['good:Shipped', 'neutral:Parked', 'info:Beta', 'good:Shipped', 'neutral:Parked']);
});

test('a page word with the bad tone marks its row like a built-in blocking word', async () => {
  const html = await out('@status Escalated=bad\n\ntable = Item,Status; a,Shipped; b,Escalated; c,Done; d,Done; e,Done');
  assert.match(html, /<tr class="hl bad">/);
});

test('nothing the @status line says reaches the page unless a cell uses it', async () => {
  const html = await out('@status <b onclick=x>Zed</b>=good, "><script>alert(1)</script>=bad\n\nA paragraph.');
  assert.equal(html.includes('Zed'), false);
  assert.equal(html.includes('alert(1)'), false);
  assert.equal(html.includes('onclick'), false);
  assert.equal(html.includes('<script'), false);
});

test("a defined word that holds markup is matched as text, and the chip shows the cell's own text, escaped", async () => {
  const html = await out('@status <i>x</i>=good\n\ntable = A,B; <i>x</i>,1; y,2');
  assert.equal(html.includes('<i>x</i>'), false);
  assert.deepEqual(pills(html), ['good:&lt;i&gt;x&lt;/i&gt;']);
});

test('--artifact and the fragment carry the same chips as the page', async () => {
  const src = `${WORDS}\n\n${TABLE}`;
  const doc = parse(src, { loadFile });
  const page = await render(doc);
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>') + '</main>'.length);
  assert.equal(await render(doc, { fragment: true }), main);
  const artifact = await render(doc, { artifact: true });
  assert.ok(artifact.includes(main));
  assert.deepEqual(pills(artifact), pills(page));
});

test('the stylesheet has a tone for every chip: info is the accent, neutral the grey', () => {
  const sheet = css({});
  assert.match(sheet, /\.pill\.info\{background:var\(--accent-tint\);color:var\(--accent-ink\)\}/);
  assert.match(sheet, /\.pill\{[^}]*background:var\(--info-bg\);color:var\(--fg2\)\}/, 'the base pill, which `neutral` takes, is grey');
});

// ---- streaming ----------------------------------------------------------------------------------------------------------------

test('streaming: @status at the top reaches every unit before the settle, at chunks of 1, 7 and 64 bytes', async () => {
  const src = `${WORDS}\n\n# Releases\n\n${TABLE}\n\nkpi Releases | 12 | Shipped | Parked\n\nstep Ship it | Beta | the note\n`;
  const expected = normalize(await render(parse(src, { loadFile }), { fragment: true }));
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk, parse: { loadFile }, settle: false });
    assert.equal(normalize(d.model.main()), expected, `chunks of ${chunk}`);
    assert.equal(d.end.equal, true);
    assert.equal(d.end.lateMeta, 0);
  }
});

test('streaming: @status written after a table is read is one settle case, and the settled page equals the whole render', async () => {
  const src = `# Releases\n\ntable = Item,Status; a,Shipped; b,Parked\n\n@status Shipped=info, Parked=bad\n`;
  const expected = normalize(await render(parse(src, { loadFile }), { fragment: true }));
  assert.deepEqual(pills(expected), ['info:Shipped', 'bad:Parked']);
  const d = await drive(src, { chunk: 5, parse: { loadFile }, settle: true });
  assert.equal(normalize(d.model.main()), expected);
  assert.ok(d.end.settled > 0, 'the table was drawn with the built-in words first');
});
