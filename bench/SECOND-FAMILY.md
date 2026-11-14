# Second model family: a writer round on the 30 retired gate tasks

A method anyone can run. Question: do the Lede token and validity results hold for writers that are not Claude models? Tokens are counted
by each provider's own tokenizer (the `usage` fields), never by the Claude tokenizer.

Tasks 101 to 130 are the retired gate set (D38.4), so they are open for this. Tasks 131 to 185 stay sealed and the kit refuses them.

## Design

- Writer models chosen by whoever runs it: for example one OpenAI model and one open-weights model served by a compatible host. Put the ids in the commands below; they are not fixed here.
- Arms: B (HTML) and C (Lede 0.5) first. D (HTML over a preloaded stylesheet) and E (JSON UI, tokens and validity only) if the cap allows.
- One request per task and arm, the writer prompt unchanged, no validation, no retry that shows the model an error (`bench/REPLICATE.md`).
- Spend is bounded by the `--cap USD` flag the runner sets for each run; the kit refuses to start above it and stops before passing it. The commands below use `--cap <USD>`.

## Commands

Fill in the placeholders. Prices are per million tokens, from the provider's own price page on the day you run.

```sh
pnpm install

# the OpenAI model
export OPENAI_API_KEY=...        # read only for api.openai.com
pnpm bench --dry-run --provider openai-compatible --model <OPENAI_MODEL_ID> --tasks retired --arms B,C,D,E \
  --price-in <USD> --price-out <USD> --max-tokens <N>
pnpm bench --provider openai-compatible --model <OPENAI_MODEL_ID> --tasks retired --arms B,C \
  --price-in <USD> --price-out <USD> --max-tokens <N> --cap <USD> --out bench/out/second-family/openai
# if spend allows, the same --out again with the extra arms; finished rows are not asked again
pnpm bench --provider openai-compatible --model <OPENAI_MODEL_ID> --tasks retired --arms B,C,D,E \
  --price-in <USD> --price-out <USD> --max-tokens <N> --cap <USD> --out bench/out/second-family/openai

# the open-weights model on a compatible host
export LEDE_BENCH_API_KEY=...    # the host's key; never OPENAI_API_KEY
pnpm bench --dry-run --provider openai-compatible --base-url https://<HOST>/v1 --model <OPEN_MODEL_ID> \
  --tasks retired --arms B,C,D,E --price-in <USD> --price-out <USD> --max-tokens <N>
pnpm bench --provider openai-compatible --base-url https://<HOST>/v1 --model <OPEN_MODEL_ID> --tasks retired --arms B,C \
  --price-in <USD> --price-out <USD> --max-tokens <N> --cap <USD> --out bench/out/second-family/open
pnpm bench --provider openai-compatible --base-url https://<HOST>/v1 --model <OPEN_MODEL_ID> --tasks retired --arms B,C,D,E \
  --price-in <USD> --price-out <USD> --max-tokens <N> --cap <USD> --out bench/out/second-family/open
```

Notes. A model that thinks before it answers counts those tokens as output; give it a `--max-tokens` that leaves room for them and read
`reasoningTokens` in the rows. A host that rejects `max_completion_tokens` or `max_tokens` takes the other with `--max-tokens-field`. The
cap bounds spend only as far as the host's `usage` is honest; a host that reports none is charged at the worst case and the table says
`usageMissing`.

## The result table

One table per model, from the end of each run (`pnpm bench measure --out DIR` reprints it):

| arm | pages | valid | built | output tokens (mean, median) | bytes (mean) | ratio to HTML |
| --- | ----- | ----- | ----- | ---------------------------- | ------------ | ------------- |

- valid: Lede pages with no error diagnostic from the real parser; for D and E, the structure checks in `REPLICATE.md`; for B, a complete document.
- built: the real renderer ran (C), or the page assembled (D).
- output tokens: the provider's own `completion_tokens`, counted by that family's tokenizer. Truncated and error rows are left out (the `excluded` column counts them).
- ratio to HTML: the arm's total output tokens over arm B's, on the tasks both finished. The table prints it that way round (Lede over HTML); the report states it as D50 does, HTML tokens divided by Lede tokens, "N times fewer", which is one divided by the printed figure.

Report, beside each table, the Claude-family figures to compare against: kit runs of the same prompt, `C-lede-0.5.md`, where they exist;
otherwise the D37 and D50 figures, with the caveat that they came from subagent writers and other prompts. The two tokenizers differ,
so compare ratios, not raw counts.

## Stop rule

If Lede's validity or its token ratio to HTML is clearly worse on these writers than on the Claude-family writers, that is the
headline of the report, stated first and without softening. "Clearly" is fixed before the run: Lede validity more than 10 points below the
Claude-family rate, or a saving over HTML (HTML tokens divided by Lede tokens) under two thirds of the Claude-family saving (for
example 4.7 times fewer where the Claude family has 7.0 times fewer). That is the same threshold as a Lede-to-HTML ratio more than 1.5
times the Claude-family one. If neither holds, say that the result is consistent
with the Claude-family one, and say that it is two models, one run each. Judged quality is not part of this round.
