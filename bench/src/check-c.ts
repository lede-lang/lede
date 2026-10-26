// Lists Lede diagnostics for every generated C output: node bench/src/check-c.ts [out.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@lede-lang/core';
const GEN = join(import.meta.dirname, '..', 'gen');
const out: Record<string, string[]> = {};
let files = 0,
  bad = 0;
for (const m of readdirSync(GEN))
  for (const f of readdirSync(join(GEN, m, 'C')).sort()) {
    files++;
    const d = parse(readFileSync(join(GEN, m, 'C', f), 'utf8')).diagnostics;
    const e = d.filter((x) => x.severity === 'error');
    if (e.length) bad++;
    if (d.length) out[`${m}/${f}`] = d.map((x) => `${x.severity} ${x.line}:${x.col} ${x.code}: ${x.message}`);
  }
console.log(`${files} files, ${bad} with errors (${((100 * (files - bad)) / files).toFixed(1)}% valid)`);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
else for (const [k, v] of Object.entries(out)) console.log(k, '\n  ' + v.join('\n  '));
