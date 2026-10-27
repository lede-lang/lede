# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lede is a line-oriented document format that AI models write instead of HTML. It compiles to one self-contained, zero-JavaScript HTML page (charts, diagrams, light/dark, phone layouts). The GitHub repo is `lede-lang/lede`, created at launch from one commit; the earlier history is in the private archive, `lede-lang/lede-archive`. The domain is `ledelang.dev`; this repo holds the spec, compiler, CLI, skill and benchmark. The website lives in a separate repo, `lede-site` (CDK app plus compiled pages), which calls this repo's CLI through its `LEDE_CLI` variable.

## Commands

Node 22.18+ runs the TypeScript sources directly in development (imports use `.ts` extensions; package entries point at `src/`). pnpm workspace. The only build is for npm (D48): `pnpm build` emits `packages/*/dist/` (gitignored), and each package's `publishConfig` points the packed tarball at `dist/`.

```sh
pnpm install
pnpm test                       # node --test over packages/*/test and conformance/run.test.ts (~100 s; the render tests launch Chromium if found)
pnpm typecheck                  # tsc --noEmit over src, tests, conformance, bench/src, scripts and test
pnpm lint                       # oxlint, type-aware; warnings fail it too. Two rules are off on purpose (config): unsafe-type-assertion, consistent-function-scoping
                                # an intentional `await` in a loop gets an `oxlint-disable-next-line ... -- reason` comment
pnpm format:check               # oxfmt, TypeScript only, 140 columns; `pnpm format` rewrites
pnpm check:examples             # every shipped .lede example must pass `lede check`
pnpm test:pack                  # build, `pnpm pack` the three packages, npm-install them in a temp dir, run the bin and imports (~20 s, needs the npm registry)
                                # CI runs typecheck, lint, format:check, check:examples, test, then test:pack
node --test packages/core/test/fix.test.ts          # one test file
node --test --test-name-pattern="<part of the test name>" packages/core/test/grammar.test.ts   # one test by name
UPDATE=1 node --test conformance/run.test.ts        # regenerate expected AST/diagnostics after an intentional parser change; review the JSON diff
pnpm lede build page.lede -o page.html   # also: check [--json] [--fix], watch, ast
```

`lede check --fix` rewrites the file in place and prints each repair; repairs that choose between readings are labelled "a guess". The benchmark (`node bench/src/run.ts`, `pairs.ts`, `aggregate.ts`) needs Chromium via playwright-core (`CHROME` env or the Playwright cache).

## Architecture

Three packages, one pipeline: `core` parses, `render-html` draws, `cli` wires them.

- `packages/core`: `LedeParser` (`parser.ts`) turns lines into typed blocks plus `Diagnostic`s (each has line, col, a code, and an optional machine-readable `detail`). `LedeStream` wraps it for incremental model output (`write` returns finished blocks, `snapshot` returns a renderable document for the text so far), so anything added to the parser must keep working mid-stream. `fix.ts` repairs source text from those diagnostics: it re-parses after each pass and discards a pass that adds errors.
- `packages/render-html`: `render`/`compile` (`index.ts`) turn a `LedeDocument` into HTML; `chart.ts`, `diagram.ts` (elkjs layout), `sequence.ts`, `theme.ts` (CSS) are the drawers. Output is sanitized and fetches nothing remote unless `--allow-remote`. Rendering is async because of elkjs.
- `packages/cli`: `data x < file.csv` loads are confined to the document's directory tree (symlinks resolved on both sides); keep that check when touching file loading.
- Key invariants: keyword lines fail loudly (a prose line starting with a keyword needs a `\` escape); a diagram name must not equal a data name; table and data cells need quotes around `,` and `;`.

Source of truth is split on purpose, and the pieces must stay in step:
- `spec/lede-0.1.md` (full reference with EBNF) versus `spec/model-spec.md` (the text a model reads, capped at 2,910 tokens on the Claude 5.5 tokenizer, D55, counted with `count_tokens` as `bench/src/recount.ts` does; the cap is a decision, D35, and the file sits at the limit).
- `skill/lede/SKILL.md` embeds the current model reference verbatim; a test in `packages/render-html/test/v04-regress.test.ts` compares it with `bench/prompts/C-lede-0.5.md` (lines 4 to 103).
- `conformance/cases/*.lede` + `.json` (expected AST) and `conformance/errors/` (expected diagnostics) pin parser behaviour.

## Process rules specific to this repo

- This repo is public. Internal material lives in the private repo `lede-lang/meta` (local clone `../lede-meta`): `HANDOFF.md`, `HUMAN_ACTIONS.md`, `ROADMAP.md`, Kiro specs, spike notes, reports and the internal `DECISIONS.md` (D45). Do not recreate any of them here; anything naming accounts, AWS profiles, hosting, domains or launch logistics goes there too.
- `DECISIONS.md` is the record for public design, format, renderer and benchmark-method decisions: add a numbered entry for any such decision, and read the relevant ones before changing the grammar, renderer or spec. Internal decisions go in `lede-lang/meta`'s `DECISIONS.md` with a one-line stub here (`## Dn. (internal; recorded in the private planning repo)`). Both files share one sequence: the next number is one past the highest in either file and in open PR branches of either repo. D10 (compiled output is zero-JS) is the launch safety claim; the opt-in interaction shell (D39, approved as a spike per the D43 stub) must not leak into ordinary `build`.
- Frozen artifacts: `bench/prompts/C-lede-0.1.md` through `0.4.md` and the held-out tasks in `bench/tasks/` tie published numbers to a commit. Do not edit them; write a new prompt file (`C-lede-0.5.md` is current) and note it in `DECISIONS.md`.
- Benchmark and probe writers are isolated subagents that read only the writer prompt and write once with no validation; judges are blind. Fresh tasks come from an agent that has not seen the spec or renderer, hashed before any renderer change (D34). Do not plant failures to test the linter; let them occur and report them.
- Specs are Kiro-style under `.kiro/specs/<feature>/` in `lede-lang/meta`, not here (intent, requirements, design, tasks). Tick tasks and update `HANDOFF.md` there after each one; code comments cite a spec as "(internal spec, lede-lang/meta)", never by a path in this repo.
- Seed strings from `seeded-direction` must never appear in pages, commits or summaries.
- Public surface changes (CLI flags, `--json` shape, diagnostic codes or `detail` keys, exit codes) are documented in `spec/lede-0.1.md` §9 and in `lede --help` in the same change, with no approval step. Add a conformance case or test too. Treat a missing spec update as a defect in the change, not an optional follow-up.
- Commit messages and PR text: body lines at most 100 columns (commitlint), and never the skip-CI marker (the words "skip ci" in square brackets): GitHub then runs no checks on the PR and the required check `test` never reports. Fix a message with `git commit --amend` and `git push --force-with-lease` on your own branch.
- Work on a branch and open a PR; do not commit to `main`. Commits are Conventional Commits and signed off (`git commit -s`, DCO); `CHANGELOG.md` and the version in the three packages and the three plugin manifests are written by `.github/workflows/changelog.yml` from them (D54), never by hand. A consumer-visible change goes in the commit body in plain prose, with no `!` and no `BREAKING CHANGE:` footer.
- The three packages share one version (`workspace:*` is packed as an exact pin). Publishing is `.github/workflows/release.yml`, started by the GitHub release that `changelog.yml` publishes, from the public repository only, and it stages on npm only after the owner approves the `npm` environment; a version goes public only when the owner approves it on npm with 2FA (D48, D58, D61); never `npm publish` from a package directory, which would ship entries that point at `src/`.
