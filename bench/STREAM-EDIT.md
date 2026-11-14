# Streaming and edit cost, Lede against HTML

Rerun, no API key, no browser: `node bench/src/stream-edit-demo.ts`. It reads files in `bench/`, prints both tables and writes
`bench/results/stream-edit-demo.json` (every per-page row).

## 1. Output before the first visible block

Unit: tokens of `@anthropic-ai/tokenizer`, the offline legacy tokenizer (D12), not the writers' own (D50); characters are in the
JSON. Counts, not seconds; at a fixed decode rate seconds scale with tokens (D13).

- Lede: text fed to `LedeStream` one character at a time; the first block `write` returns that is not `data` or `preset`.
- HTML: after `</head>` (else the last `</style>`), the first closing tag of a leaf (h1-h6, p, li, dt, dd, pre, blockquote,
  figcaption, td, th, summary, svg, table) holding text, an `img` or an `svg`. Script, style, template, comments and `hidden` skipped.

Pairs: each Lede page in `bench/gen/*/C` with the same writer's HTML for the same task id (583 pairs). Lede rounds r2 to r6 reuse
the same HTML pages, so rows are not independent. Median [p25-p75]:

| Writer (pairs) | Lede tokens | HTML tokens | HTML/Lede per pair |
| --- | --- | --- | --- |
| haiku (240) | 52 [35-74] | 1040 [867-1164] | 19 |
| opus (240) | 67 [47-85] | 1467 [1224-1917] | 24 |
| sonnet (103) | 61 [46-77] | 1734 [1525-1931] | 29 |

Lede was first in every pair. Most of the HTML figure is the `<style>` block that precedes any body content; that is how these
writers shape HTML, and it is the cost being measured.

## 2. Edit cost

Source: `bench/edit-requests/01-40.txt`, one small change each. Haiku and Opus subagents patched copies of their own pages
(`bench/edits/<writer>/<arm>`, `prep-edits.sh`): 80 HTML and 80 Lede files, all passing `bench/results/edits.json`. They arrived in
the first public commit; DECISIONS.md has no entry for them. The model's own edit output is not stored, only the patched file, so
the table is a minimal patch (line diff, then common prefix and suffix removed per hunk): a lower bound on what a model writes.

| Writer, arm | Changed lines | Chars inserted | Tokens inserted | Page chars |
| --- | --- | --- | --- | --- |
| haiku HTML | 12 [6-36] | 438 [120-1165] | 131 [43-480] | 6673 |
| haiku Lede | 4.5 [4-7] | 78 [38-142] | 25 [13-51] | 1310 |
| opus HTML | 12 [6-23] | 519 [134-1169] | 168 [49-503] | 7670 |
| opus Lede | 5 [4-6] | 82 [42-131] | 25 [19-46] | 1383 |

## Caveats

Claude-family writers only. Lede pages in `gen/*/C` come from several prompt versions; the edited ones are `gen/haiku/C` and
`gen/opus/C`. The first-block rules were written after seeing the file layout, not tuned on outcomes. No wall-clock seconds.
