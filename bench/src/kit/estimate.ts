// The cost estimate printed before any call. Prices are never built in: the caller passes --price-in and --price-out (USD per
// million tokens), so nothing here can go stale. Token counts are estimates (characters / chars-per-token); the real counts come
// from the provider's usage fields and replace them as the run goes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH, type Arm } from './arms.ts';

export const DEFAULT_CHARS_PER_TOKEN = 3.5;
export const estTokens = (text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN) => Math.ceil(text.length / charsPerToken);
export const usd = (inTok: number, outTok: number, priceIn: number, priceOut: number) => (inTok * priceIn + outTok * priceOut) / 1e6;

/**
 * Expected output tokens per page by arm. Source: the mean `tokens` per arm over bench/results/raw-heldout.json (legacy
 * `@anthropic-ai/tokenizer` counts of Haiku and Opus pages, tasks 41-70; D50 finds current Claude counts 1.26 to 1.43 times higher).
 * Arms A, D and E have no row there and are assumed to equal the HTML mean, which is not a measurement. `--est-out B=3000,C=500`
 * overrides any of them.
 */
export function defaultOutputEstimates(resultsDir = join(BENCH, 'results')): { perArm: Record<string, number>; source: string } {
  const file = join(resultsDir, 'raw-heldout.json');
  const fallback = { A: 3000, B: 3000, C: 500, D: 3000, E: 3000 };
  if (!existsSync(file)) return { perArm: fallback, source: 'built-in fallback (raw-heldout.json not found)' };
  const rows = JSON.parse(readFileSync(file, 'utf8')) as { arm: string; tokens: number }[];
  const mean = (arm: string) => {
    const t = rows.filter((r) => r.arm === arm).map((r) => r.tokens);
    return t.length === 0 ? null : Math.round(t.reduce((a, b) => a + b, 0) / t.length);
  };
  const b = mean('B') ?? fallback.B;
  return {
    perArm: { A: mean('A') ?? b, B: b, C: mean('C') ?? fallback.C, D: mean('D') ?? b, E: mean('E') ?? b },
    source: 'bench/results/raw-heldout.json arm means (legacy Claude tokenizer; A, D, E assumed equal to the HTML mean)',
  };
}

export interface ArmEstimate {
  arm: string;
  calls: number;
  inputPerCall: number;
  outputPerCall: number;
  inputTotal: number;
  outputTotal: number;
  /** null when no prices were given. */
  expectedUsd: number | null;
  worstCaseUsd: number | null;
}
export interface Estimate {
  arms: ArmEstimate[];
  calls: number;
  inputTotal: number;
  outputTotal: number;
  expectedUsd: number | null;
  worstCaseUsd: number | null;
  maxTokens: number;
  outputSource: string;
}

export interface EstimateInput {
  arms: Arm[];
  /** Full writer message per arm and task, in the order tasks are run. */
  messages: Map<string, string[]>;
  outputPerArm: Record<string, number>;
  outputSource: string;
  maxTokens: number;
  priceIn?: number | undefined;
  priceOut?: number | undefined;
  charsPerToken?: number | undefined;
}

export function estimate(i: EstimateInput): Estimate {
  const priced = i.priceIn !== undefined && i.priceOut !== undefined;
  const arms: ArmEstimate[] = i.arms.map((a) => {
    const msgs = i.messages.get(a.letter) ?? [];
    const inputTotal = msgs.reduce((s, m) => s + estTokens(m, i.charsPerToken), 0);
    const out = i.outputPerArm[a.letter] ?? i.maxTokens;
    const outputTotal = out * msgs.length;
    return {
      arm: a.letter,
      calls: msgs.length,
      inputPerCall: msgs.length === 0 ? 0 : Math.round(inputTotal / msgs.length),
      outputPerCall: out,
      inputTotal,
      outputTotal,
      expectedUsd: priced ? usd(inputTotal, outputTotal, i.priceIn!, i.priceOut!) : null,
      worstCaseUsd: priced ? usd(inputTotal, i.maxTokens * msgs.length, i.priceIn!, i.priceOut!) : null,
    };
  });
  const sum = (f: (a: ArmEstimate) => number | null) => (priced ? arms.reduce((s, a) => s + (f(a) ?? 0), 0) : null);
  return {
    arms,
    calls: arms.reduce((s, a) => s + a.calls, 0),
    inputTotal: arms.reduce((s, a) => s + a.inputTotal, 0),
    outputTotal: arms.reduce((s, a) => s + a.outputTotal, 0),
    expectedUsd: sum((a) => a.expectedUsd),
    worstCaseUsd: sum((a) => a.worstCaseUsd),
    maxTokens: i.maxTokens,
    outputSource: i.outputSource,
  };
}

export function formatEstimate(e: Estimate, priced: boolean): string {
  const money = (v: number | null) => (v === null ? '-' : `$${v.toFixed(2)}`);
  const lines = ['arm  calls  input/call  output/call  expected  worst-case'];
  for (const a of e.arms)
    lines.push(
      `${a.arm.padEnd(4)} ${String(a.calls).padStart(5)}  ${String(a.inputPerCall).padStart(10)}  ${String(a.outputPerCall).padStart(11)}  ${money(a.expectedUsd).padStart(8)}  ${money(a.worstCaseUsd).padStart(10)}`,
    );
  lines.push(
    `all  ${String(e.calls).padStart(5)}  ${String(e.inputTotal).padStart(10)} in total, ${e.outputTotal} out total  ${money(e.expectedUsd).padStart(8)}  ${money(e.worstCaseUsd).padStart(10)}`,
    `expected = tasks x arms x (est input x price-in + est output x price-out); worst-case = every call writing max-tokens (${e.maxTokens}).`,
    `output estimate source: ${e.outputSource}.`,
    'input estimate: characters / chars-per-token, not a tokenizer count. The cap does not rely on it (see bench/REPLICATE.md).',
  );
  if (!priced) lines.push('no --price-in and --price-out given: dollar columns are empty.');
  return lines.join('\n');
}
