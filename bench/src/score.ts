// Scores a judged round: joins the blind judge's picks (judge-*.jsonl) to the answer key and the task
// categories, writes results/judge/<round>/scored.json and prints win-or-tie per writer and category.
//   node bench/src/score.ts <round>
// A pair without a judge line is excluded (e.g. one side failed to produce a valid page).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const round = process.argv[2];
if (!round) throw new Error('usage: score.ts <round>');
const dir = join(ROOT, 'results', 'judge', round);
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
const judged = new Map<string, { winner: string; reason: string }>();
for (const f of readdirSync(dir)
  .filter((name) => /^judge-.*\.jsonl$/.test(name))
  .sort()) {
  for (const line of readFileSync(join(dir, f), 'utf8')
    .split('\n')
    .filter((l) => l.trim())) {
    const r = JSON.parse(line) as { pair: string; winner: string; reason: string };
    judged.set(r.pair, r);
  }
}
const scored = key
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
writeFileSync(join(dir, 'scored.json'), `${JSON.stringify(scored)}\n`);
const pct = (xs: { o: string }[]) =>
  `${xs.filter((x) => x.o !== 'other').length}/${xs.length} = ${xs.length ? ((100 * xs.filter((x) => x.o !== 'other').length) / xs.length).toFixed(1) : '-'}%`;
console.log(`pairs judged ${scored.length} of ${key.length}`);
for (const m of new Set(scored.map((s) => s.model))) {
  const mine = scored.filter((s) => s.model === m);
  console.log(
    `${m}: win-or-tie ${pct(mine)} (wins ${mine.filter((x) => x.o === 'C').length}, ties ${mine.filter((x) => x.o === 'tie').length})`,
  );
  for (const c of [...new Set(mine.map((s) => s.cat))].sort()) console.log(`  ${c}: ${pct(mine.filter((s) => s.cat === c))}`);
}
console.log(`overall: ${pct(scored)}`);
for (const c of [...new Set(scored.map((s) => s.cat))].sort()) console.log(`  ${c}: ${pct(scored.filter((s) => s.cat === c))}`);
