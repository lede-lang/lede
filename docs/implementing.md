# Implement Lede in your language

Lede is a line format a model writes instead of HTML. A second implementation (a parser in another language, say) is welcome, and
the conformance suite in `conformance/` is the contract it is held to.

## What a conforming implementation does

1. Parse a `.lede` source to the document AST: `meta`, `blocks`, `data`.
2. Report the diagnostics: severity, code, line and column.

Rendering is not part of conformance today. The suite does not look at HTML, so a parser-only implementation can pass it in full.
`lede build` in this repository is the only renderer, and what it emits is not pinned by the suite.

## The command protocol

The runner drives any executable that speaks the interface of the reference CLI:

- `<command> ast <file>` prints the parsed document as JSON on stdout.
- `<command> check --json <file>` prints `{ "<file>": [ {severity, code, line, col, ...} ] }` on stdout. A page of tabs (D85) adds an entry per part after it; the runner compares the first.
- `<file>` is an absolute path appended to the command; exit codes are ignored.

Both are documented in `spec/lede-0.1.md` section 9. Compared exactly: `meta`, `blocks`, `data`. Compared on `severity`, `code`,
`line` and `col`, in order: diagnostics. Message wording and the `detail` object are implementation detail and are not compared.

## Run it

```sh
git clone https://github.com/lede-lang/lede && cd lede
pnpm install
node conformance/runner.ts --cmd "./my-lede"                 # per-case pass/fail, then a summary and percentage
node conformance/runner.ts --cmd "./my-lede" --filter errors/ # a subset
node conformance/runner.ts --cmd "./my-lede" --json > result.json   # machine-readable, for a badge
```

Other options: `--timeout MS` per case (default 20000). The exit status is non-zero unless every case passes.
The command runs under `/bin/sh` with the file path single-quoted, so on Windows run it from WSL or another POSIX shell. A timeout
stops that shell; a process your command starts in the background is not stopped with it.
The reference CLI scores 100% (`--cmd "node packages/cli/src/cli.ts"`).

## Reporting a result

Open an issue with the command's name and version, the commit of this repository you ran, and the summary line or `result.json`.
Say which cases fail and why you think they do. A disagreement with a case is worth reporting too: the cases are generated from the
reference parser, so the spec decides which side is right.

## What is normative

- Normative: `spec/lede-0.1.md` (with its EBNF) and the conformance cases.
- Informative: `spec/model-spec.md`, the short text a model reads to write Lede. It is capped in size and omits detail on purpose.

## Licences

The code is Apache-2.0 (`LICENSE`). The full specification, `spec/lede-0.1.md`, is CC BY 4.0. The model reference
`spec/model-spec.md` and the skill in `skill/lede/` are CC0. See `spec/LICENSE`, `skill/lede/LICENSE` and the README.

## Changes to the format

There is no separate RFC process in this repository. `CONTRIBUTING.md` says how a change is proposed: open an issue first, and
decisions are recorded in `DECISIONS.md`.

## Stability

The format is 0.x and the grammar can still change; the README says it will. The suite changes with it, so run it against
each release, and watch `conformance/` in the history, to see what moved.
