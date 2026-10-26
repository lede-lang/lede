# Lede

A line-oriented document format for AI-written web artifacts. It compiles to a single
self-contained HTML page with charts, diagrams, light and dark themes and phone layouts, and
no JavaScript.

Site, reference, gallery and a playground that compiles Lede in your browser: [ledelang.dev](https://ledelang.dev/).

```
@title Payments platform review
kpi Uptime | 99.97% | +0.02 pts | good
data traffic = month,EMEA,APAC; Jan,410,380; Feb,430,372; Mar,455,401
chart line traffic title="Requests per month (millions)"

diagram aws dir=LR
aws: api "Payments API" svc focus
aws: db "Orders DB" db
aws: api -> db : sql
aws: group vpc "VPC 10.20.0.0/16" api, db
```

> **Status:** pre-release (0.x). The npm packages below are not published yet; until they are, run from a checkout (Use, below).

## Layout

| Path | What |
|---|---|
| `spec/lede-0.1.md` | Reference spec, with EBNF grammar and error behavior. CC BY 4.0 |
| `spec/model-spec.md` | The text a model reads to write Lede (the thing under test), capped at 2,910 tokens on the Claude 5.5 tokenizer (D55). CC0 |
| `packages/core` | Streaming parser: lines in, typed AST and diagnostics out |
| `packages/render-html` | AST to page: charts, elkjs diagrams, tables, theme |
| `packages/cli` | `lede build`, `lede watch`, `lede check`, `lede ast` |
| `scripts/pack.ts`, `test/pack.test.ts` | Build and pack the npm tarballs; install and run them (`pnpm test:pack`) |
| `conformance/` | `.lede` cases with expected AST JSON, and error cases with expected diagnostics |
| `bench/` | Benchmark: tasks, generated outputs, harness, results |
| `DECISIONS.md` | Design, format, renderer and benchmark-method decisions (ADR log) |

## Install the skill

The skill is `skill/lede/SKILL.md`. The repository is also a plugin marketplace for hosts that install from one:

```sh
npx skills add lede-lang/lede                      # any host the skills CLI supports
/plugin marketplace add lede-lang/lede             # Claude Code, then: /plugin install lede@lede
codex plugin marketplace add lede-lang/lede        # Codex, then install Lede from the Plugins directory
```

Or copy the folder: `cp -r skill/lede ~/.claude/skills/lede`. The skill tells the agent to run `lede`, so install the CLI
too (next section).

## Install the CLI and libraries

Needs Node 22.12+. Once published:

```sh
npm install -g @lede-lang/cli      # the lede command
npm install @lede-lang/html        # compile(src) -> { html, doc } from your own code; brings @lede-lang/core, the parser
```

```js
import { compile } from '@lede-lang/html';
const { html, doc } = await compile('# Hello\n\nkpi Uptime | 99.97% | +0.02 pts | good');
```

The three packages share one version. Before they are published, use a checkout: after `pnpm install` (below),
`alias lede="node $PWD/packages/cli/src/cli.ts"`.

## Use

A checkout needs Node 22.18+ (it runs the TypeScript sources directly) and pnpm.

```sh
pnpm install
node packages/cli/src/cli.ts build examples/kitchen-sink.lede -o out/ks.html
node packages/cli/src/cli.ts check page.lede        # file:line:col diagnostics, exit 1 on errors
node packages/cli/src/cli.ts check page.lede --fix  # repair mechanical slips in place (guesses are labelled)
node packages/cli/src/cli.ts watch page.lede        # rebuilds page.html on save
pnpm test                                           # unit, streaming and conformance tests
pnpm typecheck
pnpm test:pack                                      # pack the three packages, install them with npm, run them
```

Regenerate conformance expectations after an intentional parser change with
`UPDATE=1 node --test conformance/run.test.ts`, then review the JSON diff.

## Benchmark

```sh
node bench/src/run.ts            # render + measure every output in bench/gen (Chromium via playwright-core)
node bench/src/run.ts --edits    # measure the edit round in bench/edits
node bench/src/pairs.ts          # build blind pairwise images for the judge
node bench/src/aggregate.ts      # results/summary.json
```

Results land in `bench/results/`; `DECISIONS.md` records the method and the numbers of each round (D12 to D18, D27 to D38).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first; it covers the tests, the documents that must stay in step and the commit format.
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report a vulnerability through [SECURITY.md](SECURITY.md).
Releases are tagged and described in [CHANGELOG.md](CHANGELOG.md), which is written from the commit messages (D54).

## Licence

The code is Apache-2.0 ([LICENSE](LICENSE)). The full specification (`spec/lede-0.1.md`) is CC BY 4.0, and the model reference
(`spec/model-spec.md`) and the skill (`skill/lede/`) are CC0; see [spec/LICENSE](spec/LICENSE) and
[skill/lede/LICENSE](skill/lede/LICENSE).
