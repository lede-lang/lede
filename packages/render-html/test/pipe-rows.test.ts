// Pipe rows (D80, spec §4.11 and §4.14) as the renderer draws them: the same page as the quoted form, a snapshot of a half-written
// table, and the incremental renderer, whose streamed page must equal the whole-page render before any settle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedeStream, parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';
import { drive, normalize } from '../../../bench/src/incremental-model.ts';

const main = (html: string) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

test('a pipe-row page draws exactly as the same page written with quoted rows and `+=`', async () => {
  const piped = [
    '# Costs',
    '',
    'data costs = service,usd,note',
    'costs: Compute | 18,400 | "burst" pricing, Q3',
    'costs: Storage, S3 | 6,100 | **archive tier; cold**',
    '',
    'table costs',
    '',
    'table title="Options" heat = Option | Cost, USD | Verdict',
    ': Managed queue | 1,200 | Fits, mostly; cheap',
    ': Self-hosted | 3,400 | On track',
    '',
  ].join('\n');
  const quoted = [
    '# Costs',
    '',
    'data costs = service,usd,note',
    'data costs += Compute,"18,400","""burst"" pricing, Q3"',
    'data costs += "Storage, S3","6,100","**archive tier; cold**"',
    '',
    'table costs',
    '',
    'table title="Options" heat = Option,"Cost, USD",Verdict; Managed queue,"1,200","Fits, mostly; cheap"; Self-hosted,"3,400",On track',
    '',
  ].join('\n');
  const a = await compile(piped);
  const b = await compile(quoted);
  assert.deepEqual(a.doc.diagnostics, []);
  assert.deepEqual(b.doc.diagnostics, []);
  assert.equal(main(a.html), main(b.html));
  assert.match(a.html, /<strong>archive tier; cold<\/strong>/, 'a field keeps its inline markup');
  assert.match(a.html, /<span class="pill/, 'a status word in a pipe field is still a chip');
});

test('a snapshot of a half-written block-form table draws the rows read so far', async () => {
  const s = new LedeStream();
  s.write('table = Option | Cost\n: Alpha | 1\n: Beta | 2\n');
  const html = await render(s.snapshot(), { fragment: true });
  assert.match(html, /<table/);
  assert.ok(html.includes('Alpha') && html.includes('Beta'));
  s.write(': Gamma | 3\n');
  assert.ok((await render(s.snapshot(), { fragment: true })).includes('Gamma'));
  // The tail, which a live viewer draws, shows the same table.
  assert.equal(s.tail().length, 1);
});

test('the incremental page equals the whole-page render for both forms, at chunks of 1, 7 and 64', async () => {
  const src = [
    '# Costs',
    '',
    'data costs = service,usd',
    'costs: Compute | 18,400',
    'costs: Storage | 6,100',
    'chart hbar costs x=service y=usd',
    '',
    'table = Option | Cost | Verdict',
    ': Queue | 1,200 | On track',
    ': Cluster | 3,400 | Blocked',
    '## Next',
    '',
    'table heat = k,n',
    ': a | 5',
    ': b | 9',
    'Closing words.',
    '',
  ].join('\n');
  const expected = normalize(await render(parse(src), { fragment: true }));
  for (const chunk of [1, 7, 64]) {
    const d = await drive(src, { chunk });
    assert.equal(normalize(d.model.main()), expected, `chunks of ${chunk}`);
    assert.equal(d.end.equal, true, `chunks of ${chunk}: the renderer's own report agrees`);
  }
});
