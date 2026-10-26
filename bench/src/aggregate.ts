// Aggregates raw measurements into results/summary.json and prints a table.
//   node bench/src/aggregate.ts
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { diffLines } from 'diff';

const require = createRequire(import.meta.url);
const { countTokens } = require('@anthropic-ai/tokenizer') as { countTokens: (s: string) => number };
const ROOT = join(import.meta.dirname, '..');
const R = (f: string) => (existsSync(join(ROOT, 'results', f)) ? JSON.parse(readFileSync(join(ROOT, 'results', f), 'utf8')) : []);

type Row = Record<string, any>;
const raw: Row[] = R('raw.json');
const rawDraft: Row[] = R('raw-v0.1.json');
const edits: Row[] = R('edits.json');
const runs: Row[] = R('agent-runs.json');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const pct = (n: number, d: number) => (d ? (100 * n) / d : NaN);
const r1 = (x: number) => Math.round(x * 10) / 10;

function valid(r: Row): boolean {
  if (r.arm === 'C') return (r.errors ?? []).length === 0;
  if (r.arm === 'A') return (r.mermaidErrors ?? 0) === 0 && (r.jsErrors ?? []).length === 0;
  return (r.jsErrors ?? []).length === 0;
}
const DATA_CATS = new Set(['status', 'data', 'comparison']);
const DIAGRAM_CATS = new Set(['architecture']);

function group(rows: Row[], model: string, arm: string) {
  const g = rows.filter((r) => r.model === model && r.arm === arm);
  if (!g.length) return null;
  const fid = (f: (r: Row) => boolean) =>
    r1(
      100 *
        mean(
          g
            .filter(f)
            .map((r) => r.fidelity?.score ?? NaN)
            .filter((x) => !Number.isNaN(x)),
        ),
    );
  return {
    n: g.length,
    tokensMean: Math.round(mean(g.map((r) => r.tokens))),
    tokensMedian: median(g.map((r) => r.tokens)),
    pageKB: r1(mean(g.map((r) => r.pageBytes)) / 1024),
    validPct: r1(pct(g.filter(valid).length, g.length)),
    warnings: g.reduce((a, r) => a + (r.warnings?.length ?? 0), 0),
    ttfmrMean: Math.round(mean(g.map((r) => r.ttfmrTokens).filter((x: number | null) => x !== null))),
    ttfmrMissing: g.filter((r) => r.ttfmrTokens === null).length,
    fidelityAll: fid(() => true),
    fidelityData: fid((r) => DATA_CATS.has(r.category)),
    fidelityDiagram: fid((r) => DIAGRAM_CATS.has(r.category) || (r.needs ?? []).includes('diagram')),
    fidelityProse: fid((r) => r.category === 'prose'),
    overflowPct: r1(pct(g.filter((r) => (r['overflow-light'] ?? 0) > 1).length, g.length)),
    contrastPagesPct: r1(
      pct(
        g.filter((r) => (r['contrast-1280-light'] ?? 0) + (r['contrast-400-light'] ?? 0) + (r['contrast-400-dark'] ?? 0) > 0).length,
        g.length,
      ),
    ),
    contrastDarkPct: r1(pct(g.filter((r) => (r['contrast-400-dark'] ?? 0) > 0).length, g.length)),
    diagramCollisions: g.reduce((a, r) => a + (r.geometry?.collisions?.length ?? 0), 0),
    diagrams: g.reduce((a, r) => a + (r.geometry?.diagrams ?? 0), 0),
  };
}

function editStats(model: string, arm: string) {
  const g = edits.filter((r) => r.model === model && r.arm === arm);
  if (!g.length) return null;
  const ext = { A: 'md', B: 'html', C: 'lede' }[arm]!;
  const diffs = g.map((r) => {
    const before = readFileSync(join(ROOT, 'gen', model, arm, `${r.id}.${ext}`), 'utf8');
    const after = readFileSync(join(ROOT, 'edits', model, arm, `${r.id}.${ext}`), 'utf8');
    const parts = diffLines(before, after);
    const changed = parts.filter((p) => p.added || p.removed);
    return {
      id: r.id,
      changedLines: changed.reduce((a, p) => a + (p.count ?? 0), 0),
      addedTokens: parts.filter((p) => p.added).reduce((a, p) => a + countTokens(p.value), 0),
      untouched: before === after,
    };
  });
  const ok = g.filter((r) => r.edit?.ok && valid(r));
  return {
    n: g.length,
    successPct: r1(pct(ok.length, g.length)),
    checkOnlyPct: r1(pct(g.filter((r) => r.edit?.ok).length, g.length)),
    validAfterPct: r1(pct(g.filter(valid).length, g.length)),
    addedTokensMean: Math.round(mean(diffs.map((d) => d.addedTokens))),
    changedLinesMean: r1(mean(diffs.map((d) => d.changedLines))),
    untouched: diffs.filter((d) => d.untouched).length,
    failures: g
      .filter((r) => !(r.edit?.ok && valid(r)))
      .map((r) => ({ id: r.id, why: [...(r.edit?.fails ?? []), ...(valid(r) ? [] : ['invalid after edit'])] })),
  };
}

function judge() {
  const dir = join(ROOT, 'results', 'judge');
  if (!existsSync(dir)) return {};
  const rounds: Record<string, unknown> = {};
  for (const round of readdirSync(dir).sort()) {
    const keyFile = join(dir, round, 'key.json');
    if (!existsSync(keyFile)) continue;
    const key: Row[] = JSON.parse(readFileSync(keyFile, 'utf8'));
    const verdicts: Row[] = readdirSync(join(dir, round))
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) =>
        readFileSync(join(dir, round, f), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l)),
      );
    const byPair = new Map(verdicts.map((v) => [v.pair, v]));
    const out: Record<
      string,
      { win: number; tie: number; loss: number; n: number; winOrTiePct: number; byCategory: Record<string, string> }
    > = {};
    const cats: Record<string, Record<string, [number, number]>> = {};
    for (const k of key) {
      const v = byPair.get(k.pair);
      if (!v) continue;
      const slot = `${k.model}/${k.vs}`;
      out[slot] ??= { win: 0, tie: 0, loss: 0, n: 0, winOrTiePct: 0, byCategory: {} };
      const cSide = k.left === 'C' ? 'LEFT' : 'RIGHT';
      const w = String(v.winner).toUpperCase();
      const good = w === 'TIE' || w === cSide;
      if (w === 'TIE') out[slot].tie++;
      else if (w === cSide) out[slot].win++;
      else out[slot].loss++;
      out[slot].n++;
      const cat = raw.find((r) => r.id === k.id)?.category ?? '?';
      cats[slot] ??= {};
      cats[slot][cat] ??= [0, 0];
      cats[slot][cat][0] += good ? 1 : 0;
      cats[slot][cat][1]++;
    }
    for (const [slot, s] of Object.entries(out)) {
      s.winOrTiePct = r1(pct(s.win + s.tie, s.n));
      s.byCategory = Object.fromEntries(Object.entries(cats[slot]).map(([c, [g, n]]) => [c, `${g}/${n}`]));
    }
    rounds[round] = { verdicts: verdicts.length, pairs: key.length, bySlot: out };
  }
  return rounds;
}

function timing() {
  // Agent wall-clock per output token (all tasks in a batch were written sequentially by one agent).
  const out: Record<string, { msPerOutputToken: number; batches: number }> = {};
  for (const model of ['haiku', 'opus', 'haiku-r2', 'opus-r2'])
    for (const arm of ['A', 'B', 'C']) {
      const b = runs.filter((r) => r.model === model && r.arm === arm && r.batch !== 'edits');
      const toks = raw.filter((r) => r.model === model && r.arm === arm).reduce((a, r) => a + r.tokens, 0);
      if (!b.length || !toks) continue;
      out[`${model}/${arm}`] = { msPerOutputToken: r1(b.reduce((a, r) => a + r.duration_ms, 0) / toks), batches: b.length };
    }
  return out;
}

const models = [...new Set(raw.map((r) => r.model))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const summary: Row = { generated: new Date().toISOString(), models, arms: {}, draft: {}, edits: {}, judge: judge(), timing: timing() };
for (const m of models)
  for (const a of ['A', 'B', 'C']) {
    const g = group(raw, m, a);
    if (g) summary.arms[`${m}/${a}`] = g;
    const d = group(rawDraft, m, a);
    if (d) summary.draft[`${m}/${a}`] = d;
    const e = editStats(m, a);
    if (e) summary.edits[`${m}/${a}`] = e;
  }
// Headline ratios per model (main generation).
summary.ratios = {};
for (const m of ['haiku', 'opus']) {
  const A = summary.arms[`${m}/A`],
    B = summary.arms[`${m}/B`],
    C = summary.arms[`${m}/C`];
  if (!C) continue;
  const per = (arm: string) => {
    const pairs = raw
      .filter((r) => r.model === m && r.arm === arm)
      .map((r) => [r.tokens, raw.find((x) => x.model === m && x.arm === 'C' && x.id === r.id)?.tokens])
      .filter((p) => p[1]);
    return r1(median(pairs.map(([x, c]) => x / c)));
  };
  summary.ratios[m] = {
    BoverC_mean: B ? r1(B.tokensMean / C.tokensMean) : null,
    BoverC_medianPerTask: B ? per('B') : null,
    AoverC_mean: A ? r1(A.tokensMean / C.tokensMean) : null,
  };
}
writeFileSync(join(ROOT, 'results', 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
