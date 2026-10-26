Proposed edits to spec/model-spec.md for the three spike grammar additions (spec/lede-0.1.md Appendix D). Lines starting with `>>>` say where text goes and are not part of the proposal; every other non-blank line is the proposed text, verbatim. Nothing here has been applied.

>>> 1. In the "Text" code block, directly after the `- bullet ...` line, add:
-- sub-bullet     -- 1. sub-step     (one level, under the item above)

>>> 2. In the "Options:" sentence, directly after the `target="99.9 SLO"` item (before "Bars get value labels"), add:
, `mark="W3 deploy"` (an event on that x value; repeatable; not hbar)

>>> 3. In the sequence-diagram code block, replace the line `login: app --> browser : 302 + cookie` with:
login: alt "password ok"
login: app --> browser : 302 + cookie
login: else "bad password"
login: app --> browser : 401
login: end

>>> 4. Add one sentence after that code block:
`opt "cond"` also works; blocks do not nest.

>>> Token cost, measured with `@anthropic-ai/tokenizer` `countTokens` (as bench/src/run.ts does) on the whole file after applying edits 1 to 4: 1515 -> 1601, so +86 added tokens (budget 120). The spec was already over its 1,500 target before this change. If a cut is needed, drop edit 4 (about 12 tokens): `opt` is then undocumented but still parses.
