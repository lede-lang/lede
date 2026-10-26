// Recounts the v0.4 benchmark sources (results/raw-v04.json) with each writer's own tokenizer, through the
// count_tokens endpoint, and writes results/recount-v04.json. raw-v04.json stays as published: its counts come from
// @anthropic-ai/tokenizer, a legacy tokenizer that is not the one the models bill by (D12), and its ratios differ too (D50).
// Costs cover the page's own output tokens only: not thinking, and not the skill or brief the writer reads.
//   ANTHROPIC_API_KEY=... node bench/src/recount.ts
// An `ant auth login` token also works (ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)); either way the org needs credit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = join(import.meta.dirname, '..');
const REPO = join(ROOT, '..');
/** The model each writer directory ran on (D33, D36), and its list output price in dollars per million tokens (October 2026). */
const WRITERS = {
  opus: { model: 'claude-opus-5-5', outputPerMillion: 20 },
  sonnet: { model: 'claude-sonnet-5-5', outputPerMillion: 10 },
  haiku: { model: 'claude-haiku-5-5', outputPerMillion: 0.5 },
} as const;
type Writer = keyof typeof WRITERS;
const EXT = { B: 'html', C: 'lede' } as const;
type Arm = keyof typeof EXT;
/** The tokens-a-second the site assumes for its time figures (FIG. 1 and "8 s instead of 67 s"). */
const TOKENS_PER_SECOND = 60;
const REFERENCES = ['spec/model-spec.md', 'skill/lede/SKILL.md'];

const client = new Anthropic();

const countRaw = async (model: string, text: string) =>
  (await client.messages.countTokens({ model, messages: [{ role: 'user', content: text }] })).input_tokens;

/**
 * count_tokens wraps the text in a user message, which adds a fixed number of tokens. Counting "a", assumed to be
 * one token on every tokenizer, measures that overhead.
 */
const overhead = Object.fromEntries(
  await Promise.all(Object.values(WRITERS).map(async ({ model }) => [model, (await countRaw(model, 'a')) - 1] as const)),
);
const count = async (model: string, text: string) => (await countRaw(model, text)) - overhead[model];

type Row = { model: string; arm: Arm; id: string; tokens: number };
const rows: Row[] = JSON.parse(readFileSync(join(ROOT, 'results', 'raw-v04.json'), 'utf8'));

async function recount(r: Row) {
  const writer = r.model.replace(/-r\d+$/, '') as Writer;
  const { model } = WRITERS[writer];
  const src = readFileSync(join(ROOT, 'gen', r.model, r.arm, `${r.id}.${EXT[r.arm]}`), 'utf8');
  return {
    key: `${r.model}/${r.arm}/${r.id}`,
    writer,
    arm: r.arm,
    id: r.id,
    countModel: model,
    tokens: await count(model, src),
    legacyTokens: r.tokens,
  };
}

/** Maps `items` with at most `size` calls in flight; a slow or retried call holds up only its own worker. */
async function pooled<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

/** The reference each writer reads, counted with that writer's tokenizer (the cap on the model spec is in these units, D55; it was set on the legacy tokenizer, D35). */
const countReferences = async () =>
  Object.fromEntries(
    await Promise.all(
      REFERENCES.map(async (path) => {
        const text = readFileSync(join(REPO, path), 'utf8');
        const perWriter = await Promise.all(Object.entries(WRITERS).map(async ([w, { model }]) => [w, await count(model, text)] as const));
        return [path, Object.fromEntries(perWriter)] as const;
      }),
    ),
  );

// The reference counts need only the overhead, so they run alongside the rows.
const referencePromise = countReferences();
const out = await pooled(rows, 8, recount);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const summary = Object.fromEntries(
  Object.entries(WRITERS).map(([writer, { model, outputPerMillion }]) => {
    const of = (arm: Arm) => out.filter((r) => r.writer === writer && r.arm === arm);
    const [html, lede] = [of('B'), of('C')];
    const meanBy = (key: 'tokens' | 'legacyTokens') => ({ html: mean(html.map((r) => r[key])), lede: mean(lede.map((r) => r[key])) });
    const { html: h, lede: l } = meanBy('tokens');
    const legacy = meanBy('legacyTokens');
    const pair = (f: (x: number) => number) => ({ html: f(h), lede: f(l) });
    return [
      writer,
      {
        model,
        pages: { html: html.length, lede: lede.length },
        meanTokens: pair(Math.round),
        legacyMeanTokens: { html: Math.round(legacy.html), lede: Math.round(legacy.lede) },
        ratio: Math.round((h / l) * 10) / 10,
        dollarsPer1000Pages: pair((x) => (x * outputPerMillion) / 1000),
        secondsPerPage: pair((x) => x / TOKENS_PER_SECOND),
        contextTokensForTenPages: pair((x) => Math.round(x * 10)),
      },
    ];
  }),
);

const reference = await referencePromise;
/** The model reference's cap in these units (D55). Nothing else enforces it, so a recount that finds it exceeded fails. */
const SPEC_CAP = 2910;
const overCap = Object.entries(reference['spec/model-spec.md']).filter(([, tokens]) => tokens > SPEC_CAP);
if (overCap.length) {
  console.error(`spec/model-spec.md is over its ${SPEC_CAP}-token cap (D55): ${overCap.map(([w, t]) => `${w} ${t}`).join(', ')}`);
  process.exitCode = 1;
}

const countedAt = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(ROOT, 'results', 'recount-v04.json'),
  `${JSON.stringify({ countedAt, overhead, tokensPerSecond: TOKENS_PER_SECOND, summary, reference, rows: out }, null, 2)}\n`,
);
console.log(JSON.stringify({ summary, reference }, null, 2));
