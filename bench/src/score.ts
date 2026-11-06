// Scores a judged round: joins the blind judge's picks (judge-*.jsonl) to the answer key and the task
// categories, writes results/judge/<round>/scored.json and prints win-or-tie per writer and category.
//   node bench/src/score.ts <round> [--ranges 71-100,101-130]
// <round> is a directory under results/judge (an absolute path is used as it is). A round has one judge sample, or several:
// judge-*.jsonl at the root of the round is sample 1 (rounds 1 and 2 keep theirs there, as does the first sample of heldout2),
// and every s<N>/ directory is sample N. With several samples the output is one block per sample and then the mean of the
// samples, with ties shown; `--ranges` adds the same per task-id range (v0.4: regress 71-100, gate 101-130).
// A pair without a judge line is excluded (e.g. one side failed to produce a valid page). A line without `pair` (the header
// record a batch file opens with: judge model and prompt file) is skipped.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const round = process.argv[2];
if (!round) throw new Error('usage: score.ts <round> [--ranges 71-100,101-130]');
const rangesArg = process.argv.includes('--ranges') ? process.argv[process.argv.indexOf('--ranges') + 1] : undefined;
const ranges = (rangesArg?.split(',') ?? []).map((r) => {
  const m = /^(\d+)-(\d+)$/.exec(r);
  if (!m) throw new Error(`--ranges takes id ranges such as 71-100,101-130 (got ${r})`);
  return { label: r, lo: Number(m[1]), hi: Number(m[2]) };
});
const dir = resolve(ROOT, 'results', 'judge', round);
const idKey = (name: string) => /^\d+/.exec(name)![0].padStart(2, '0');
const category = new Map(
  readdirSync(join(ROOT, 'tasks')).map((f) => [idKey(f), JSON.parse(readFileSync(join(ROOT, 'tasks', f), 'utf8')).category as string]),
);
const key = JSON.parse(readFileSync(join(dir, 'key.json'), 'utf8')) as {
  pair: string;
  model: string;
  id: string;
  left: string;
  right: string;
}[];

type Verdict = { pair: string; winner: string; reason: string };
const judgeFiles = (d: string) =>
  readdirSync(d)
    .filter((name) => /^judge-.*\.jsonl$/.test(name))
    .sort()
    .map((name) => join(d, name));
function readSample(files: string[]): Map<string, Verdict> {
  const judged = new Map<string, Verdict>();
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.trim())) {
      const r = JSON.parse(line) as Partial<Verdict>;
      if (r.pair === undefined) continue;
      judged.set(r.pair, r as Verdict);
    }
  }
  return judged;
}
const samples = new Map<string, Map<string, Verdict>>();
const sampleDirs = readdirSync(dir)
  .filter((name) => /^s\d+$/.test(name) && statSync(join(dir, name)).isDirectory())
  .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const rootFiles = judgeFiles(dir);
if (rootFiles.length) samples.set(sampleDirs.includes('s1') ? 'root' : 's1', readSample(rootFiles));
for (const s of sampleDirs) samples.set(s, readSample(judgeFiles(join(dir, s))));
if (samples.size === 0) throw new Error(`${dir}: no judge-*.jsonl at the root or in s<N>/`);

type Scored = { pair: string; model: string; id: string; cat: string; o: 'tie' | 'C' | 'other'; reason: string };
function scoreSample(judged: Map<string, Verdict>): Scored[] {
  return key
    .filter((k) => judged.has(k.pair))
    .map((k) => {
      const j = judged.get(k.pair)!;
      const w = j.winner.toUpperCase();
      const won = w === 'LEFT' ? k.left : w === 'RIGHT' ? k.right : 'tie';
      return {
        pair: k.pair,
        model: k.model,
        id: k.id,
        cat: category.get(idKey(k.id)) ?? '?',
        o: won === 'tie' ? 'tie' : won === 'C' ? 'C' : 'other',
        reason: j.reason,
      };
    });
}
const scoredBySample = new Map([...samples].map(([name, judged]) => [name, scoreSample(judged)] as const));
const several = scoredBySample.size > 1;
const [firstScored] = scoredBySample.values();
writeFileSync(
  join(dir, 'scored.json'),
  `${JSON.stringify(several ? [...scoredBySample].flatMap(([sample, rows]) => rows.map((r) => ({ sample, ...r }))) : firstScored)}\n`,
);

const good = (xs: { o: string }[]) => xs.filter((x) => x.o !== 'other').length;
const pct = (xs: { o: string }[]) => `${good(xs)}/${xs.length} = ${xs.length ? ((100 * good(xs)) / xs.length).toFixed(1) : '-'}%`;
const count = (xs: { o: string }[], o: string) => xs.filter((x) => x.o === o).length;

function report(scored: Scored[], total: number) {
  console.log(`pairs judged ${scored.length} of ${total}`);
  for (const m of new Set(scored.map((s) => s.model))) {
    const mine = scored.filter((s) => s.model === m);
    console.log(`${m}: win-or-tie ${pct(mine)} (wins ${count(mine, 'C')}, ties ${count(mine, 'tie')})`);
    for (const c of [...new Set(mine.map((s) => s.cat))].sort()) console.log(`  ${c}: ${pct(mine.filter((s) => s.cat === c))}`);
  }
  console.log(`overall: ${pct(scored)}`);
  for (const c of [...new Set(scored.map((s) => s.cat))].sort()) console.log(`  ${c}: ${pct(scored.filter((s) => s.cat === c))}`);
}

if (!several) {
  report(firstScored, key.length);
  for (const { label, lo, hi } of ranges) {
    for (const m of new Set(firstScored.map((s) => s.model))) {
      console.log(`${m} ${label}: ${pct(firstScored.filter((s) => s.model === m && Number(s.id) >= lo && Number(s.id) <= hi))}`);
    }
  }
} else {
  for (const [name, scored] of scoredBySample) {
    console.log(`sample ${name}:`);
    report(scored, key.length);
  }
  const names = [...scoredBySample.keys()];
  const last = scoredBySample.get(names.at(-1)!)!;
  const lastByPair = new Map(last.map((s) => [s.pair, s.o]));
  const both = firstScored.filter((s) => lastByPair.has(s.pair));
  console.log(
    `judge self-agreement (${names[0]} and ${names.at(-1)}): ${both.filter((s) => lastByPair.get(s.pair) === s.o).length} / ${both.length}`,
  );
  const models = [...new Set(key.map((k) => k.model))];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`mean of samples (${names.join(', ')}):`);
  const meanLine = (label: string, pick: (s: Scored) => boolean) => {
    const per = [...scoredBySample.values()].map((rows) => rows.filter(pick));
    const n = per.map((p) => p.length);
    const wot = per.map((p) => (p.length ? good(p) / p.length : 0));
    console.log(
      `${label}: mean win-or-tie ${(100 * mean(wot)).toFixed(1)}% (mean wins ${mean(per.map((p) => count(p, 'C'))).toFixed(1)}, mean ties ${mean(per.map((p) => count(p, 'tie'))).toFixed(1)} of ${n.join('/')})`,
    );
  };
  for (const m of models) meanLine(m, (s) => s.model === m);
  meanLine('overall', () => true);
  for (const { label, lo, hi } of ranges) {
    for (const m of models) meanLine(`${m} ${label}`, (s) => s.model === m && Number(s.id) >= lo && Number(s.id) <= hi);
  }
}
