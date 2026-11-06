# Refinement pilot 1 (Sonnet, 12 tuning tasks) — not the D67 verdict

A dress rehearsal of the D67 refinement test, run on 2026-11-06 at the owner's request before the full run. Nothing here
counts toward the D67 verdict, moves a bar or changes a prompt; the full run re-does every step on all 60 tasks per tier in
its own `refine1*` directories. The scorer prints a "verdict" line because it always does; on 12 pairs it is not one
(one pair is 8.3 points, and D67's bars are 10 and 5 points).

## What ran

- Tasks: two per category from tuning tasks 71 to 130, chosen by `random.Random(20261106).sample` per category before any
  page was written (`selection.json`): 71, 72, 78, 79, 81, 111, 90, 117, 91, 125, 97, 99. Held-out tasks 131 to 185 were
  not opened.
- Hints: `bench/src/hints.ts` on the r6 Sonnet pages fired for 1 of the 12 (117) and 11 of all 60 (`hints-pilot1.json`).
- Writers: one isolated Sonnet 5.5 subagent per page (D12), given `refine-revision.md` filled in with `C-lede-0.5.md` or
  `B-html.md`, the brief, its own r6 page (Lede) or baseline page (HTML), and the feedback line (or the hint line).
  25 pages: `bench/gen/sonnet-r97/C`, `sonnet-r97/B`, `sonnet-r97h/C`, saved as written. The pilot rounds are named `r97`
  so they can never be mistaken for, or picked up by, the full run's `r7`/`r7h` directories.
  Deviation from the design: each writer read one file holding its filled-in prompt and wrote its page with the Write tool,
  rather than receiving the prompt inline; it read nothing else, ran nothing and did not validate.
- Render: one `run.ts --rows raw-pilot1 --models sonnet-r6,sonnet,sonnet-r97,sonnet-r97h --min-id 71` at lede `8d71533`
  (v0.2.0), Chromium 1243.
- Pairs: `pairs.ts pilot1-base vs=B models=sonnet-r6` (key filtered to the 12 tasks), `pilot1 … models=sonnet-r97`,
  `pilot1h … models=sonnet-r97h`. Judges: Sonnet 5.5 subagents under `judge-v2.md`, batches of 6, two samples.
- The primary arm's first judging had 75% self-agreement (under the 80% rule, Req 3.3); it is kept in
  `judge/pilot1/rejected-under-80/` and was re-judged once (`judge/pilot1/s1`, `s2`, 91.7%).

## Results (`score.txt`; first judging in `score-first-judging.txt`)

| Arm | s1 | s2 | Mean win-or-tie | Ties |
|---|---|---|---|---|
| Baseline (r6 Lede vs baseline HTML) | 2/12 | 2/12 | 16.7% | 0 |
| Primary (revised Lede vs revised HTML) | 2/12 | 1/12 | 12.5% (first judging 20.8%) | 0 |
| Hint (1 page) | 0/1 | 0/1 | 0% | 0 |

- Ties: none in 50 judgments under `judge-v2.md`.
- Validity as written: 10 of 12 revised Lede pages without errors (91 and 117: `data-row-width`); 12 of 12 after
  `check --fix` on copies (not committed). The baseline r6 pages: 12 of 12. The hinted page: clean.
- Tokens: `recount.ts` needs `ANTHROPIC_API_KEY`, so official counts and spend are pending (`recount-pending.json`). On the
  legacy tokenizer in `raw-pilot1.json` (ratios only), revised Lede grew by a median 182 tokens, revised HTML by 2,204, and
  the HTML-to-Lede ratio went from 8.3 to 9.9.
