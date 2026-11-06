// check-probe.ts on synthetic probe rounds: the counts per tier, the gate on meta warnings, the missing and unexpected pages, the
// briefs structure check that never prints a brief, the words a page uses, and the writer prompt's placeholders. No agent runs here.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BRIEFS,
  TIERS,
  briefProblems,
  gatedCode,
  runBriefs,
  runProbe,
  scorePage,
  teachesOf,
  usedWords,
  type ProbeRun,
  type Result,
} from '../src/check-probe.ts';

const SCRIPT = join(import.meta.dirname, '..', 'src', 'check-probe.ts');
const PROMPT = join(import.meta.dirname, '..', 'prompts', 'probe-writer.md');
const SECRET = 'Marguerite Oyelaran asks for the harbour pilots rota';
const tmp = mkdtempSync(join(tmpdir(), 'lede-check-probe-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let rounds = 0;

const CLEAN = '@title A page\n@description One sentence.\n@accent #2357c6\n# Heading\nSome text.\n';
const BROKEN_CELL = 'data t = a,b; one,Nice; no link\ntable t\n';
const BROKEN = 'chart line nope\n';

const briefs = (stem: string) =>
  Array.from({ length: BRIEFS }, (_, i) => ({
    id: `${stem}-${String(i + 1).padStart(2, '0')}`,
    category: `topic-${i + 1}`,
    brief: `${SECRET} number ${i + 1}. ${'The page is read on phones between meetings. '.repeat(8)}`,
  }));

interface Round {
  run: ProbeRun;
  out: () => string;
  err: () => string;
  dir: string;
  page: (tier: string, n: number) => string;
}

/** A round on disk: briefs.json, a reference file that teaches `teaches`, and 12 clean pages per tier; `change` edits it. */
function round(stem: string, change: (r: Round) => void = () => undefined, teaches = '@description, @accent'): Round {
  const dir = join(tmp, String(rounds++));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'briefs.json'), `${JSON.stringify(briefs(stem), null, 2)}\n`);
  for (const t of TIERS) mkdirSync(join(dir, t));
  const reference = join(dir, `${stem}.md`);
  writeFileSync(reference, `# Lede reference: sample\nScope.\n<!-- teaches: ${teaches} -->\n`);
  let out = '';
  let err = '';
  const page = (tier: string, n: number) => join(dir, tier, `${stem}-${String(n).padStart(2, '0')}.lede`);
  for (const t of TIERS) for (let n = 1; n <= BRIEFS; n++) writeFileSync(page(t, n), CLEAN);
  const r: Round = {
    run: { stem, dir, reference, prompt: 'C-lede-0.6.md', out: (x) => (out += x), err: (x) => (err += x) },
    out: () => out,
    err: () => err,
    dir,
    page,
  };
  change(r);
  return r;
}
const resultOf = (r: Round) => JSON.parse(readFileSync(join(r.dir, 'result.json'), 'utf8')) as Result;

test('a round of clean pages passes, prints the table and writes result.json with the counts', () => {
  const r = round('meta');
  assert.equal(runProbe(r.run), 0, r.err());
  const res = resultOf(r);
  assert.equal(res.pass, true);
  assert.equal(res.expected, 36);
  assert.deepEqual(
    [res.total.pages, res.total.firstTry, res.total.afterFix, res.total.metaWarningPages, res.total.used],
    [36, 36, 36, 0, 36],
  );
  assert.deepEqual(res.total.usedBy, { '@description': 36, '@accent': 36 });
  assert.deepEqual(res.tiers.opus.usedBy, { '@description': 12, '@accent': 12 });
  assert.equal(res.prompt, 'C-lede-0.6.md');
  assert.equal(res.briefs.count, 12);
  assert.match(res.briefs.sha256, /^[0-9a-f]{64}$/);
  assert.match(r.out(), /^tier .*pages.*first-try.*after-fix.*meta-warn.*used$/m);
  assert.match(r.out(), /^haiku\s+12\s+12\s+12\s+0\s+12$/m);
  assert.match(r.out(), /^all\s+36\s+36\s+36\s+0\s+36$/m);
  assert.match(r.out(), /^pass: 36 of 36 valid after fix, no gated meta warning$/m);
  assert.ok(!r.out().includes('harbour'), 'a brief is never printed');
});

test('the same pages give the same result.json bytes', () => {
  const r = round('meta');
  runProbe(r.run);
  const first = readFileSync(join(r.dir, 'result.json'), 'utf8');
  runProbe(r.run);
  assert.equal(readFileSync(join(r.dir, 'result.json'), 'utf8'), first);
});

test('a page that --fix repairs is counted valid after fix and not first try, and the report names it with its errors', () => {
  const r = round('meta', (x) => writeFileSync(x.page('sonnet', 5), BROKEN_CELL));
  assert.equal(runProbe(r.run), 0, r.err());
  const res = resultOf(r);
  assert.deepEqual([res.tiers.sonnet.firstTry, res.tiers.sonnet.afterFix, res.total.firstTry, res.total.afterFix], [11, 12, 35, 36]);
  const row = res.pages.find((p) => p.tier === 'sonnet' && p.id === 'meta-05');
  assert.deepEqual([row?.firstTry, row?.afterFix, row?.fixes], [false, true, 1]);
  assert.equal(row?.errors[0].code, 'data-row-width');
  assert.match(r.out(), /^fixed sonnet\/meta-05: 1 error\(s\) first try, 0 after fix$/m);
  assert.match(r.out(), /^pass: 36 of 36/m);
});

test('a page still invalid after fix fails the round, with its diagnostics in the report and in result.json', () => {
  const r = round('meta', (x) => writeFileSync(x.page('haiku', 2), BROKEN));
  assert.equal(runProbe(r.run), 1);
  const res = resultOf(r);
  assert.equal(res.pass, false);
  assert.deepEqual([res.total.afterFix, res.tiers.haiku.afterFix], [35, 11]);
  assert.equal(res.pages.find((p) => p.id === 'meta-02' && p.tier === 'haiku')?.remaining[0].code, 'unknown-data');
  assert.match(r.out(), /^INVALID haiku\/meta-02: 1 error\(s\) first try, 1 after fix$/m);
  assert.match(r.out(), /^ {2}1:\d+ \[unknown-data\]/m);
  assert.match(r.out(), /^MISS: 35 of 36 valid after fix/m);
});

test('a gated meta warning fails a meta round and is only reported in any other', () => {
  const lowContrast = CLEAN.replace('#2357c6', '#aaaaaa');
  const unknownKey = CLEAN.replace('@accent #2357c6', '@colour blue');
  const meta = round('meta', (x) => {
    writeFileSync(x.page('opus', 3), lowContrast);
    writeFileSync(x.page('opus', 4), unknownKey);
  });
  assert.equal(runProbe(meta.run), 1);
  const res = resultOf(meta);
  assert.deepEqual([res.gateMeta, res.total.afterFix, res.total.metaWarningPages, res.pass], [true, 36, 2, false]);
  assert.deepEqual(
    res.pages.filter((p) => p.metaWarnings.length > 0).map((p) => [p.id, p.metaWarnings]),
    [
      ['meta-03', ['accent-contrast']],
      ['meta-04', ['unknown-meta']],
    ],
  );
  assert.match(meta.out(), /^GATED opus\/meta-03: accent-contrast$/m);
  assert.match(meta.out(), /^MISS: 36 of 36 valid after fix, 2 page\(s\) with a gated meta warning$/m);
  const pages = round('pages', (x) => writeFileSync(x.page('opus', 3), lowContrast));
  assert.equal(runProbe(pages.run), 0, pages.err());
  assert.equal(resultOf(pages).gateMeta, false);
  assert.equal(resultOf(pages).total.metaWarningPages, 1, 'still reported');
  assert.match(pages.out(), /^meta warning opus\/pages-03: accent-contrast$/m);
});

test('a missing page, or a file no brief names, fails the round', () => {
  const missing = round('meta', (x) => rmSync(x.page('haiku', 7)));
  assert.equal(runProbe(missing.run), 1);
  assert.match(missing.out(), /^MISSING haiku\/meta-07$/m);
  assert.equal(resultOf(missing).total.pages, 35);
  const extra = round('meta', (x) => writeFileSync(join(x.dir, 'sonnet', 'meta-13.lede'), CLEAN));
  assert.equal(runProbe(extra.run), 1);
  assert.deepEqual(resultOf(extra).unexpected, ['sonnet/meta-13.lede']);
  assert.match(extra.out(), /^UNEXPECTED sonnet\/meta-13\.lede$/m);
});

test('a round that cannot be scored exits 2 and says why', () => {
  const noBriefs = round('meta', (x) => rmSync(join(x.dir, 'briefs.json')));
  assert.equal(runProbe(noBriefs.run), 2);
  assert.match(noBriefs.err(), /briefs\.json/);
  const noComment = round('meta', (x) => writeFileSync(x.run.reference, '# Lede reference: sample\nScope.\n'));
  assert.equal(runProbe(noComment.run), 2);
  assert.match(noComment.err(), /teaches/);
  const noFile = round('meta');
  noFile.run.reference = join(noFile.dir, 'absent.md');
  assert.equal(runProbe(noFile.run), 2);
  const badBriefs = round('meta', (x) => {
    const list = briefs('meta');
    list[3].brief = `${SECRET} ${'in HTML '.repeat(60)}`;
    writeFileSync(join(x.dir, 'briefs.json'), JSON.stringify(list));
  });
  assert.equal(runProbe(badBriefs.run), 2);
  assert.match(badBriefs.err(), /entry 4: a technology word in the brief/);
  assert.ok(!badBriefs.err().includes('HTML') && !badBriefs.err().includes('Marguerite'), 'the error names the rule, not the brief');
});

test('--briefs prints counts and the rule that failed, never a brief', () => {
  const good = round('shell');
  assert.equal(runBriefs(good.run), 0);
  assert.match(good.out(), /: 12 of 12 entries$/m);
  assert.match(good.out(), /^sha256 [0-9a-f]{64}$/m);
  assert.match(good.out(), /^ok$/m);
  const bad = round('shell', (x) => {
    const list: Record<string, unknown>[] = briefs('shell');
    list[1].id = 'shell-09';
    list[2].category = 'Not A Slug';
    list[4].brief = `${SECRET}\n\nsecond paragraph ${'x'.repeat(400)}`;
    list[5].extra = true;
    list[6].category = list[7].category;
    writeFileSync(join(x.dir, 'briefs.json'), JSON.stringify(list.slice(0, 11)));
  });
  assert.equal(runBriefs(bad.run), 1);
  for (const rule of [
    '(set): 11 entries, not 12',
    'entry 2: id is not shell-02',
    'entry 3: category is not a slug',
    'entry 5: brief is not one paragraph',
    'entry 6: fields beyond id, category and brief',
    'entry 8: category repeats an earlier one',
  ])
    assert.match(bad.out(), new RegExp(`^FAIL ${rule.replace(/[()]/g, '\\$&')}$`, 'm'), rule);
  assert.ok(!bad.out().includes('Marguerite') && !bad.out().includes('second paragraph'));
  assert.deepEqual(briefProblems('nope', 'x'), ['(set): the file is not a JSON array']);
});

test('the words a page uses: meta keys at the start of a line, keyword words, at with a number, nothing inside a fence', () => {
  const teaches = ['@description', '@accent', 'fold', 'at', 'swatch', 'donut', 'spark='];
  assert.deepEqual(usedWords(CLEAN, teaches), ['@description', '@accent']);
  assert.deepEqual(usedWords('# T\nfold\n### Appendix\nat 2 nit | x\nswatch tokens\n', teaches), ['fold', 'at', 'swatch']);
  assert.deepEqual(usedWords('# T\nWe arrive at the station.\nat 2, then.\nfolding is nice\n@descriptions are many\n', teaches), []);
  assert.deepEqual(usedWords('# T\n```lede\nfold\n@accent #2357c6\n```\nplain\n', teaches), [], 'a fenced example is not use');
  assert.deepEqual(usedWords('chart donut runs\nkpi 5 | Open spark=1,2,3\n', teaches), ['donut', 'spark=']);
  assert.deepEqual(usedWords('prose donut line\n', teaches), [], 'a taught word after a prose line is not use');
  assert.deepEqual(usedWords('  @accent #2357c6\n', ['@accent']), ['@accent'], 'leading space');
});

test('teachesOf reads the comment on the last line and nothing else', () => {
  assert.deepEqual(teachesOf('# T\nScope.\n<!-- teaches: @description, @accent, @theme, @lang -->\n'), [
    '@description',
    '@accent',
    '@theme',
    '@lang',
  ]);
  assert.deepEqual(teachesOf('x\n<!-- teaches: fold -->'), ['fold']);
  assert.equal(teachesOf('<!-- teaches: fold -->\ntext\n'), null);
  assert.equal(teachesOf('# T\n'), null);
  assert.equal(teachesOf('<!-- teaches: a, , b -->\n'), null);
});

test('gatedCode: unknown-meta and accent- codes, and meta-value if a later spec adds it', () => {
  for (const code of ['unknown-meta', 'accent-value', 'accent-contrast', 'meta-value']) assert.equal(gatedCode(code), true, code);
  for (const code of ['heading-depth', 'unknown-data', 'meta', 'metadata']) assert.equal(gatedCode(code), false, code);
});

test('scorePage: first try and after fix are separate, and a gated warning is kept from the repaired page', () => {
  const clean = scorePage(CLEAN, ['@accent']);
  assert.deepEqual([clean.firstTry, clean.afterFix, clean.fixes, clean.gated.length, clean.used], [true, true, 0, 0, ['@accent']]);
  const fixed = scorePage(BROKEN_CELL, []);
  assert.deepEqual([fixed.firstTry, fixed.afterFix, fixed.fixes], [false, true, 1]);
  const stuck = scorePage(BROKEN, []);
  assert.deepEqual([stuck.firstTry, stuck.afterFix, stuck.remaining.length], [false, false, 1]);
  assert.deepEqual(
    scorePage('@accent #aaaaaa\n# Hi\n', []).gated.map((d) => d.code),
    ['accent-contrast'],
  );
});

test('the command line: no stem or a bad option is a usage error, and a stem with no round is exit 2', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(run().status, 2);
  assert.match(run().stderr, /^usage: /);
  assert.equal(run('meta', '--dir').status, 2);
  assert.equal(run('Meta!').status, 2);
  const none = run('meta', '--dir', join(tmp, 'no-such-round'));
  assert.equal(none.status, 2);
  assert.match(none.stderr, /briefs\.json/);
  const r = round('meta');
  const ok = run('meta', '--dir', r.dir, '--reference', r.run.reference, '--prompt', 'C-lede-0.6.md');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^pass: 36 of 36/m);
  assert.equal(resultOf(r).prompt, 'C-lede-0.6.md');
});

test('probe-writer.md has one slug list and the stem in the id, and asks for the shape of bench/article/r2/briefs.json', () => {
  const prompt = readFileSync(PROMPT, 'utf8');
  assert.equal(prompt.split('{{SLUGS}}').length - 1, 1);
  assert.ok(prompt.split('{{STEM}}').length - 1 >= 2);
  assert.equal(prompt.replaceAll('{{SLUGS}}', '').replaceAll('{{STEM}}', '').includes('{{'), false, 'no other placeholder');
  assert.match(prompt, /write 12 briefs/i);
  assert.match(prompt, /"id": "\{\{STEM\}\}-01",\n {2}"category": "the-topic-slug",\n {2}"brief": "\.\.\."/);
  const r2 = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'article', 'r2', 'briefs.json'), 'utf8')) as Record<string, string>[];
  assert.deepEqual(Object.keys(r2[0]), ['id', 'category', 'brief']);
  assert.match(prompt, /No technology words\./);
  assert.match(prompt, /Read no file and run no command\.\n$/);
});
