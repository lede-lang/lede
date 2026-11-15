# Weekly triage

Ten minutes a week. Labels assumed: `wanted`, `rfc-wanted`, `bug`, `enhancement`.

## Saved searches

- New and unlabelled: `repo:lede-lang/lede is:issue is:open no:label`
- Wanted, newest first: `repo:lede-lang/lede is:issue is:open label:wanted sort:created-desc`
- Candidates: `repo:lede-lang/lede is:issue is:open label:rfc-wanted`
- Quiet for a month: `repo:lede-lang/lede is:issue is:open updated:<YYYY-MM-DD` (four weeks back)

## Routine

1. Label every unlabelled issue. A broken page or misleading diagnostic is `bug`; "I wanted to write X" is `wanted`.
2. Reproduce each `bug` from its source. No source: ask once.
3. Read each new `wanted` issue and find the closest existing word. Often it is already expressible: answer with the Lede that
   does it, and close it.
4. Count similar `wanted` issues. A need that recurs, or one a benchmark page would plainly hit, becomes `rfc-wanted`.

## From `wanted` to `rfc-wanted`

`CONTRIBUTING.md` sets the rules for a new word: the model reference is capped (D35, D55), a word is added only if the reference
still fits and a benchmark round shows models use it, and the change gets a `DECISIONS.md` entry. Mark `rfc-wanted` only when the
issue names the page, the closest existing word and why it falls short, and say in a comment which of those is missing otherwise.
This repository has no other RFC process; do not invent one in a comment.

## When to close

- Answered by existing syntax, or a duplicate: close with a link.
- Outside Lede's scope (see `docs/when-not-to-use.md`): close with a link.
- Waiting on the reporter for a month: close, and say it can be reopened.

## What to record

For each `wanted` issue, one line in the comment or the closing note: the closest word, and whether it was answered, merged into
another issue, or promoted. 
