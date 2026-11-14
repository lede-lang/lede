# Replicating the writer round

`pnpm bench` runs the writer half of the benchmark with your own API key: it asks a model to write one page per task and arm, then
measures what came back. It judges nothing. Nothing is sent until you give it a key, a model, prices and a spend cap, and without a key it
prints an estimate and stops.

## Run it

```sh
pnpm install
# 1. see what it would cost; no key needed, nothing is sent
pnpm bench --dry-run --model <MODEL_ID> --arms B,C --tasks retired --price-in <USD per M input> --price-out <USD per M output>

# 2. the real run: a key in the environment, and a hard cap
export ANTHROPIC_API_KEY=...            # api.anthropic.com only; any other host takes LEDE_BENCH_API_KEY
pnpm bench --model <MODEL_ID> --arms B,C --tasks retired --price-in <P> --price-out <P> --cap 10
```

| Flag                                      | Meaning                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `--provider anthropic\|openai-compatible` | The request format. `openai-compatible` is chat completions: OpenAI itself or any host that speaks it. |
| `--base-url URL`                          | Defaults to the provider's own API. Set it for a compatible host.                                    |
| `--model ID`                              | The model id as that provider names it. You choose it; the kit has no list.                         |
| `--arms A,B,C,D,E`                        | A Markdown, B HTML, C Lede 0.5, D HTML over a preloaded stylesheet, E a JSON UI spec. Default `B,C`. |
| `--tasks SET`                             | `retired` (101-130, the default), `tuning` (1-100), `open` (1-130), a number, a range `101-110`, or a comma list. |
| `--cap USD`                               | Required for a real run. The run never spends past it.                                              |
| `--price-in`, `--price-out`               | Your price in USD per million tokens. The kit has no price table, so none can be stale.             |
| `--max-tokens N`                          | Output limit per request, default 16000. Raise it for a model that spends tokens thinking.          |
| `--dry-run`                               | Print the estimate and stop. The default whenever no key is set.                                    |
| `--out DIR`                               | Default `bench/out/replicate/<date>-<model>` (gitignored).                                          |

Keys come from the environment only. `ANTHROPIC_API_KEY` is sent only to `https://api.anthropic.com` and `OPENAI_API_KEY` only to
`https://api.openai.com`; any other base URL (a gateway, a compatible host) gets `LEDE_BENCH_API_KEY` and nothing else. A key is never
printed, never written to a file, and is redacted from any error text. The base URL loses any user, password and query string before it
is used or stored, so a host that needs a query parameter (Azure OpenAI's `api-version`) is not supported.

Tasks 131 to 185 are the sealed held-out set. The kit refuses them, alone or inside a range, whatever flags you pass.

## What a writer sees

One request per task and arm: the arm's prompt file (`bench/prompts/`), then `Brief:` and the task's brief, then one closing line asking for
the complete page once, with no code fence. No system prompt, no examples, no retry that shows the model an error. A request is retried only
when nothing can have processed it, with the request unchanged: a connection that never opened, or an HTTP 429. Any other failure (a
reset or a timeout, a 408, a 5xx including a gateway 502 or 504, a 529) is not retried and is charged at the worst case, because the
provider may already have billed a generation. A 401 or 403 error shows the status only, never the body. Redirects are refused, and a
`--base-url` must be https unless the host is localhost, 127.0.0.1 or ::1. A reply that
arrives inside one code fence is unwrapped and the row says `fenceStripped`; nothing else is edited. A rerun with the same `--out` skips
rows already written, error rows included, so an interrupted run does not ask twice; delete a row's line from `rows.jsonl` to ask it
again. `meta.json` in the directory records the model, provider, base URL, `--max-tokens` and each arm's prompt hash; a rerun that
differs in any of them is refused and says which. A last line of `rows.jsonl` cut short by a killed run is dropped with a note.

## What it costs

Before any request the kit prints, per arm and in total:

```
expected   = tasks x arms x ( est input tokens x price-in + est output tokens x price-out ) / 1,000,000
worst case = the same with every reply at --max-tokens
```

Input tokens are estimated as characters / 3.5 (change with `--chars-per-token`); this is not a tokenizer count. Expected output tokens
per page come from the means in `bench/results/raw-heldout.json`, counted with the legacy `@anthropic-ai/tokenizer` for Haiku and Opus
pages (current Claude tokenizers count 1.26 to 1.43 times more, D50). Arms A, D and E have no measurements there and are assumed to equal
the HTML mean. Override any arm with `--est-out B=3000,C=500`. A different model family tokenizes differently, so treat the figure as an
order of magnitude, not a quote.

The run refuses to start if the expected figure is over `--cap`. During the run, spend is the sum of the provider's reported `usage`.
A reply with no usage, an unreadable reply, and a request whose connection failed after it was sent are each charged at the worst case.
Before each request the kit shortens that request's output limit so that, even if the input is as long as its UTF-8 bytes (no tokenizer
makes more tokens than that) and the reply uses every token allowed, spend stays at or under the cap; when less than 500 output tokens
would fit, it stops and says so. It ends with a spend line. The cap rests on the provider honouring the output limit and reporting its
own usage, and on one run per `--out` at a time: two runs writing the same directory each see only their own spend.

Some models count hidden reasoning as output. Those tokens are billed and are inside `outputTokens`; the row also carries
`reasoningTokens` where the provider reports it.

## What it measures (no model involved)

Per page: output tokens and input tokens from the provider's own `usage`, bytes of what was written, and:

- C (Lede): `valid` is the real parser with no error diagnostic (what `lede check` reports, minus its printing), and `buildOk` is the real renderer running to completion. Warnings are counted.
- B (HTML): a complete document, doctype to `</html>`, that loads no external resource (its prompt forbids them): no http, https or protocol-relative `src` or `href` on `img`, `script`, `link`, `iframe`, `image` or `use`, and no remote `url()` or `@import`. Bytes only; nothing is rendered.
- D (HTML over a preloaded stylesheet): a body fragment inside `<main class="page">` that writes no wrapper, style, link or script, loads no external resource (same rule as B) and has no `url()` in an inline style; the `page` class must be on the `<main>` itself. The kit wraps it with `bench/arms/preloaded.css` to report the page size.
- E (JSON UI): parses as JSON and passes the structure check in `bench/src/kit/json-ui.ts`, which follows the format `bench/prompts/E-json-ui.md` documents. **This arm measures tokens and validity only, not looks.** There is no renderer for it, and nothing in this kit says how it would look.
- A (Markdown): non-empty. Nothing else is checked.

`pnpm bench measure --out DIR` re-measures the saved pages without any network.

The output is `DIR/results.json` (commit hash, whether the worktree was dirty, SHA-256 of each prompt file, of the task set and of the
stylesheet, provider, base URL without credentials, requested and returned model ids, date, prices, cap, spend, the estimate, and one row
per task and arm), `DIR/pages/<arm>/<id>.<ext>` and a summary table: per arm the pages that are valid and built, mean and median output
tokens, mean bytes, and the ratio of its output tokens to HTML's on the tasks both finished. Rows whose reply was truncated at the
output limit, rows that errored and rows with no usage are left out of the token mean, median and ratio; the `excluded` column counts
them per arm, and a row's `stopReason` records any stop other than a normal end or the length limit (a refusal, a content filter).

## Before the first real call

These have not been tried against a real API (the kit is tested against a local stub), so check them on a one-task run first
(`--tasks 101 --arms C --cap 1`):

- Requests are not streamed. Node's `fetch` gives up when no response header arrives within 300 seconds, and a non-streamed reply sends
  its headers only when the whole page is written, so a slow model writing near `--max-tokens` can time out. That row is then charged at
  the worst case and recorded as an error. Lower `--max-tokens` if it happens.
- Some models take a smaller output limit than the default 16000 and refuse the request; the run stops on that first error with the
  provider's message.
- A host that bills reasoning outside the output limit, or that ignores the limit, can pass the cap by that much.

## What it does not reproduce

- The judged rounds. Quality was decided by blind pairwise judges looking at screenshots (`bench/src/pairs.ts`, `bench/prompts/judge-v2.md`, `aggregate.ts`). That needs Chromium, a rendered page per arm and a judge model; this first kit does not do it. To judge your pages, put them under `bench/gen/<model>/<arm>/` as `<id>.md|html|lede`, run `node bench/src/run.ts`, then `node bench/src/pairs.ts <round>`, and judge the composed images yourself or with `judge-v2.md`.
- The sealed held-out set (tasks 131 to 185). It stays sealed for the published rounds.
- Model behaviour on another day. Models change and sample; one run is one draw. The published rounds ran each writer once per task; so does this kit.

## Reporting a replication

Send the reader text, not a form. A good report contains: the commit from `results.json`, the provider, base URL host and model id, the
task set and its SHA-256, the summary table pasted as text, the spend line, and anything you changed (prices, `--max-tokens`,
`--chars-per-token`). Attach `results.json` if you can; it holds no key. Say whether any run stopped early, and if a model's replies were
truncated (`truncated` in the rows) or wrapped in a fence. Do not edit a prompt file to get a better result; if you want a variant,
add a new prompt file and say so.
