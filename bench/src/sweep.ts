// Layout sweep over arbitrary .lede files (regression check for renderer changes).
//   node bench/src/sweep.ts out.json file.lede ...   (paths absolute; run from the checkout whose renderer is measured)
// Writes {page: {req: count}} and prints totals. Compile failures are recorded under "compile".
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { checkFixtures } from './layout-check.ts';
import { resolveChrome } from './shot.ts';

const [outFile, ...files] = process.argv.slice(2);
const byName = new Map(
  files.map((f) => [
    f
      .replace(/^.*\/bench\/gen\//, '')
      .replace(/\//g, '__')
      .replace(/\.lede$/, ''),
    f,
  ]),
);
const browser = await chromium.launch({ executablePath: resolveChrome()! });
const result: Record<string, Record<string, number>> = {};
const total: Record<string, number> = {};
for (const name of byName.keys()) {
  try {
    const found = await checkFixtures([name], browser, (n) => readFileSync(byName.get(n)!, 'utf8'));
    const r: Record<string, number> = {};
    for (const f of found) r[f.req] = (r[f.req] ?? 0) + 1;
    result[name] = r;
    for (const [k, v] of Object.entries(r)) total[k] = (total[k] ?? 0) + v;
  } catch {
    result[name] = { compile: 1 };
    total.compile = (total.compile ?? 0) + 1;
  }
}
await browser.close();
writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify(total), 'pages', byName.size);
