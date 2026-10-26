// Ranks diagnostic codes across every page a writer produced, as written, and counts what `check --fix` leaves.
//   node bench/src/tally-diagnostics.ts [out.json]   (default bench/results/diagnostic-tally.json)
// "Before" comes from the CLI (`lede check --json`), the surface writers and agents see. "After" runs the fixer in memory,
// so no page is rewritten. Codes are ranked by the number of pages they occur on, then by count (D52).
import { readdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fix, type Diagnostic } from '@lede-lang/core';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'src', 'cli.ts');
const out = process.argv[2] ?? join(ROOT, 'bench', 'results', 'diagnostic-tally.json');

const ledeIn = (dir: string) =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir))
        .filter((f) => f.endsWith('.lede'))
        .sort()
        .map((f) => `${dir}/${f}`)
    : [];
const corpora = {
  'bench/gen/*/C': readdirSync(join(ROOT, 'bench', 'gen'))
    .sort()
    .flatMap((m) => ledeIn(`bench/gen/${m}/C`)),
  'bench/article/*/as-written': readdirSync(join(ROOT, 'bench', 'article'))
    .sort()
    .flatMap((r) => ledeIn(`bench/article/${r}/as-written`)),
  'examples/**/as-written': readdirSync(join(ROOT, 'examples'))
    .sort()
    .flatMap((e) => ledeIn(`examples/${e}/as-written`)),
};
const files = Object.values(corpora).flat();

/** Data files load from the page's own folder tree, as `lede check` allows, so before and after see the same rows. */
function loadBeside(page: string, p: string): string {
  const dir = realpathSync(resolve(ROOT, dirname(page)));
  const full = realpathSync(resolve(dir, p));
  if (full !== dir && !full.startsWith(dir + sep)) throw new Error(`${p} is outside ${dirname(page)}`);
  return readFileSync(full, 'utf8');
}

// One CLI call over every page; it exits 1 when any page has an error, which is expected here.
const r = spawnSync(process.execPath, [CLI, 'check', '--json', ...files], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
if (r.status !== 0 && r.status !== 1) throw new Error(`lede check failed (${r.status}): ${r.stderr}`);
const before = JSON.parse(r.stdout) as Record<string, Diagnostic[]>;

interface Row {
  code: string;
  severity: string;
  count: number;
  files: number;
  afterFixCount: number;
  afterFixFiles: number;
  pages: string[];
}
const rows = new Map<string, Row>();
const row = (d: Diagnostic) => {
  const k = `${d.severity} ${d.code}`;
  if (!rows.has(k)) rows.set(k, { code: d.code, severity: d.severity, count: 0, files: 0, afterFixCount: 0, afterFixFiles: 0, pages: [] });
  return rows.get(k)!;
};
let invalid = 0;
let invalidAfter = 0;
for (const f of files) {
  const diags = before[f] ?? [];
  if (diags.some((d) => d.severity === 'error')) invalid++;
  for (const d of diags) row(d).count++;
  for (const k of new Set(diags.map(row))) {
    k.files++;
    k.pages.push(f);
  }
  const left = fix(readFileSync(join(ROOT, f), 'utf8'), { loadFile: (p) => loadBeside(f, p) }).remaining;
  if (left.some((d) => d.severity === 'error')) invalidAfter++;
  for (const d of left) row(d).afterFixCount++;
  for (const k of new Set(left.map(row))) k.afterFixFiles++;
}

// A code that appears only after --fix (a repair that leaves a warning behind) is listed last, with no rank.
const ranked = [...rows.values()].sort((a, b) => b.files - a.files || b.count - a.count);
const result = {
  generated: 'node bench/src/tally-diagnostics.ts',
  corpora: Object.fromEntries(Object.entries(corpora).map(([k, v]) => [k, v.length])),
  pages: files.length,
  invalidAsWritten: invalid,
  invalidAfterFix: invalidAfter,
  ranking: ranked.map((x, i) => ({ rank: x.count > 0 ? i + 1 : null, ...x })),
};
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);

console.log(
  `${files.length} pages; ${invalid} invalid as written, ${invalidAfter} after --fix; ${ranked.filter((x) => x.count > 0).length} codes occur as written`,
);
console.log('| # | code | severity | pages | count | pages after --fix | count after --fix |');
console.log('|---|---|---|---|---|---|---|');
for (const x of result.ranking)
  console.log(`| ${x.rank ?? '-'} | \`${x.code}\` | ${x.severity} | ${x.files} | ${x.count} | ${x.afterFixFiles} | ${x.afterFixCount} |`);
console.log(`wrote ${relative(process.cwd(), out)}`);
