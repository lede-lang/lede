// D79: figures read like hand-set ones. Titles and edge labels are printed as written, in the page's sans; a stack
// prints its total; crowded bar labels wrap instead of dropping out; a bar cell's number sits beside its track; a
// total row is ruled off; a bold number is still a number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@lede-lang/core';
import { compile, render } from '../src/index.ts';

const frag = async (src: string): Promise<string> => {
  const doc = parse(src);
  assert.deepEqual(
    doc.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  return render(doc, { fragment: true });
};
/** The narrow (phone) drawing of the first chart in `html`. */
const narrow = (html: string): string => /<div class="chart-narrow">(<svg[\s\S]*?<\/svg>)/.exec(html)?.[1] ?? '';
const wide = (html: string): string => /<div class="chart-wide">(<svg[\s\S]*?<\/svg>)/.exec(html)?.[1] ?? '';
const texts = (svg: string, cls: string): { x: number; text: string }[] =>
  [...svg.matchAll(new RegExp(`<text class="${cls}" x="([\\d.]+)"[^>]*>([^<]*)</text>`, 'g'))].map((m) => ({
    x: Number(m[1]),
    text: m[2],
  }));

test('figure titles are set in the sans face as written, not in mono capitals', async () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec((await compile('@title T\n\ntext')).html)![1];
  for (const sel of ['figcaption', 'caption']) {
    const rule = new RegExp(`(?:^|[}\\n])${sel}\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    assert.match(rule, /var\(--sans\)/, sel);
    assert.doesNotMatch(rule, /uppercase|var\(--mono\)/, sel);
  }
  assert.doesNotMatch(/\.dg \.elabel\{([^}]*)\}/.exec(css)![1], /var\(--mono\)/);
});

test('edge and message labels are printed as written', async () => {
  const flow = await frag('diagram f dir=LR\nf: a "A" svc\nf: b "B" db\nf: a -> b : reads Orders via SQL\n');
  assert.match(flow, /class="elabel"[^>]*>reads Orders via SQL</);
  const seq = await frag('diagram s sequence\ns: a "A" user\ns: b "B" svc\ns: a -> b : POST /login\ns: b --> a : 302 + cookie\n');
  assert.match(seq, /class="elabel"[^>]*>POST \/login</);
  assert.doesNotMatch(seq, /POST \/LOGIN/);
});

test('a label of wide capitals gets the room it needs', async () => {
  const caps = await frag(`diagram f dir=LR\nf: a -> b : ${'W'.repeat(12)}\n`);
  const thin = await frag(`diagram f dir=LR\nf: a -> b : ${'i'.repeat(12)}\n`);
  const maskW = (h: string) => Number(/<rect class="lmask"[^>]* width="([\d.]+)"/.exec(h)![1]);
  assert.ok(maskW(caps) > maskW(thin), 'the mask follows the text as drawn');
  assert.ok(maskW(caps) >= 12 * 0.86 * 11, 'twelve Ws at 11px fit in the mask');
});

test('a stacked bar chart prints each total without being asked', async () => {
  const html = await frag('data r = m,a,b; Jul,820,410; Aug,760,390; Sep,910,450\nchart bar r stack\n');
  for (const t of ['1,230', '1,150', '1,360']) assert.match(html, new RegExp(`class="val"[^>]*>${t}<`), t);
});

test('bar labels that would touch wrap onto two lines, so no category goes unnamed', async () => {
  const html = await frag('data c = option,usd; Managed Kafka,5850; SQS with SNS,2100; Self-run RabbitMQ,3400\nchart bar c unit=$\n');
  const ticks = texts(narrow(html), 'tick').map((t) => t.text);
  for (const word of ['Managed', 'Kafka', 'SQS with SNS', 'Self-run', 'RabbitMQ'])
    assert.ok(ticks.includes(word), `${word} in ${ticks.join('|')}`);
  // Short labels keep one line and the usual height.
  const short = await frag('data c = k,v; A,1; B,2; C,3\nchart bar c\n');
  assert.match(narrow(short), /viewBox="0 0 360 220"/);
  assert.match(narrow(html), /viewBox="0 0 360 234"/);
});

test('the last value of a line keeps its room when it is wider than the axis labels', async () => {
  const html = await frag('data b = month,basket; Jul,38.4; Aug,39.1; Sep,42.75\nchart line b unit=$ labels\n');
  const svg = wide(html);
  const W = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
  const end = texts(svg, 'val').find((t) => t.text === '$42.75')!;
  // "$42.75" is about 3.2em of a system sans at 12px; the axis labels ("$44") are half that.
  assert.ok(end.x + 3.2 * 12 <= W, `label at ${end.x} of ${W}`);
});

test('an hbar value label the target rule would cross starts past the rule', async () => {
  const html = await frag('data t = cat,h; Billing,3.4; Login and access,1.6; Bugs,3.1\nchart hbar t unit=" h" target="2 target"\n');
  const svg = narrow(html);
  const rule = Number(/<line class="target" x1="([\d.]+)"/.exec(svg)![1]);
  const label = texts(svg, 'val').find((t) => t.text.startsWith('1.6'))!;
  assert.ok(label.x > rule, `label ${label.x} right of rule ${rule}`);
  const clear = texts(svg, 'val').find((t) => t.text.startsWith('3.4'))!;
  assert.ok(clear.x > rule + 20, 'a label nowhere near the rule stays at its bar');
});

test('a bar cell keeps its markup; the table reserves the widest number beside the tracks', async () => {
  const html = await frag('table bar=n = k,n; A,702; B,1548; C,97\n');
  assert.match(html, /<table class="lt[^"]*" style="--nw:5ch"/);
  assert.match(html, /<span class="cb" style="--p:[\d.]+%"><i><\/i>1,548<\/span>/);
  assert.doesNotMatch(await frag('table = k,n; A,702; B,1548\n'), /--nw/);
});

test('a number set in bold is still a number, and a closing total row is ruled off', async () => {
  const html = await frag(
    'table = category,Jul,Q3; Plants,820,**2490**; Tools,410,**1250**; Garden,90,**760**; **Total**,**1320**,**4500**\n',
  );
  assert.match(html, /<th scope="col" class="n"[^>]*>Q3<\/th>/);
  assert.match(html, /<td class="n"[^>]*><strong>2,490<\/strong><\/td>/);
  assert.match(html, /<tr class="tot"[^>]*>.*Total.*<\/tr>/);
  // Not a total: a first row, a short table, or a name that only starts the same way.
  assert.doesNotMatch(await frag('table = k,n; Total,1; B,2; C,3\n'), /class="tot"/);
  assert.doesNotMatch(await frag('table = k,n; A,1; B,3; Total addressable market,4\n'), /class="tot"/);
  assert.doesNotMatch(await frag('table = k,n; A,1; B,3; Overall satisfaction,4\n'), /class="tot"/);
});

test('the total row is not one of the rows: it stays last, is not the pick, and is not ranked or scaled', async () => {
  const src = 'data d = name,v,t; A,10,20; B,5,8; C,7,9; Total,**22**,37\n';
  const sorted = await frag(`${src}table d sort=-v\n`);
  const names = [...sorted.matchAll(/<tr[^>]*><th[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(names.slice(-4), ['A', 'C', 'B', 'Total']);
  assert.match(sorted, /<tr class="tot"/);
  assert.doesNotMatch(sorted, /pick/);
  const limited = await frag(`${src}table d sort=-v limit=2\n`);
  assert.equal(limited.match(/<tr/g)?.length, 4, 'header, two rows, the total');
  // heat: the largest data value is the top level; the total has none.
  const heat = await frag(`${src}table d heat\n`);
  assert.match(heat, /<td class="n h5"[^>]*>10</);
  assert.doesNotMatch(/<tr class="tot"[\s\S]*<\/tr>/.exec(heat)![0], /h[1-5]/);
  // bar= and target= are accepted on a column whose total is bold, and the largest data value fills its track.
  const doc = parse(`${src}table d bar=v target=t\n`);
  assert.deepEqual(doc.diagnostics, []);
  const bars = await render(doc, { fragment: true });
  assert.equal(bars.match(/<span class="cb tgt"/g)?.length, 3);
  assert.doesNotMatch(/<tr class="tot"[\s\S]*<\/tr>/.exec(bars)![0], /class="cb/);
});

test('a bar= target= column keeps one layout when a row has no target', async () => {
  const html = await frag('data e = name,v,t; A,10,20; B,5,; C,7,9\ntable e bar=v target=t\n');
  assert.equal(html.match(/<span class="cb tgt"/g)?.length, 3);
  assert.equal(html.match(/<b class="tg"/g)?.length, 2);
});

test('a year stays a year when one of them is bold', async () => {
  const html = await frag('table = product,launched; A,2021; B,2022; C,**2024**\n');
  assert.doesNotMatch(html, /2,02/);
});

test('a stack whose total is not its height prints nothing unless asked', async () => {
  const mixed = 'data s = q,a,b; Q1,1,2; Q2,-3,2; Q3,4,1\n';
  assert.doesNotMatch(await frag(`${mixed}chart bar s stack\n`), /class="val"/);
  assert.match(await frag(`${mixed}chart bar s stack labels\n`), /class="val"[^>]*>-1</);
  assert.doesNotMatch(await frag('data s = q,a,b; Q1,1,2; Q2,,; Q3,4,1\nchart bar s stack\n'), /class="val"/);
  assert.doesNotMatch(await frag('data s = q,a,b; Q1,1,2; Q2,3,3; Q3,4,1\nchart bar s stack max=4\n'), /class="val"/);
});

test('a stacked hbar total the target rule would cross starts past the rule too', async () => {
  const html = await frag('data t = cat,a,b; X,6,5.5; Y,2,1\nchart hbar t stack labels target="12 goal"\n');
  const svg = wide(html);
  const rule = Number(/<line class="target" x1="([\d.]+)"/.exec(svg)![1]);
  assert.ok(texts(svg, 'val').find((t) => t.text === '11.5')!.x > rule);
});

test('a message that is one very long word is cut in linear time', async () => {
  const t0 = performance.now();
  const html = await frag(`diagram s sequence\ns: a "A" user\ns: b "B" svc\ns: a -> b : ${'x'.repeat(60_000)}\n`);
  assert.match(html, /…<\/text>/);
  assert.ok(performance.now() - t0 < 5000, `${Math.round(performance.now() - t0)} ms`);
});
