# Contributing to Lede

Thanks for helping. Lede is a small format with a strict contract, so most of this page is about keeping the pieces in step.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report a vulnerability through the process in
[SECURITY.md](SECURITY.md), not in a public issue.

## Before you start

- A bug, a page that compiles wrong or a diagnostic that misleads: open an issue with the `.lede` source and the output.
- A new word, block or option: open an issue first. The model reference is capped (D35, D55), so a word is added only if the
  reference still fits and a benchmark round shows models use it. [DECISIONS.md](DECISIONS.md) records how earlier words were
  judged.
- A typo, a doc fix or a test: send the pull request.

## Set up

Needs Node 22.18+ (the TypeScript sources run directly) and pnpm.

```sh
pnpm install
pnpm test               # about 100 s; the render tests launch Chromium if they find one
pnpm typecheck && pnpm lint && pnpm format:check && pnpm check:examples
pnpm test:pack          # packs the three npm packages and runs them from a temp directory
```

[README.md](README.md) lists the layout and the CLI commands. `lede check --fix` and `lede build` are the fastest way to see a
change.

## What a change needs

- **A test.** Parser behaviour is pinned by `conformance/cases` (expected AST) and `conformance/errors` (expected diagnostics);
  regenerate with `UPDATE=1 node --test conformance/run.test.ts` and read the JSON diff. Anything added to the parser must also
  work mid-stream (`LedeStream`).
- **The spec in step.** `spec/lede-0.1.md` is the full reference, `spec/model-spec.md` is the text a model reads, and
  `skill/lede/SKILL.md` embeds the current model reference verbatim. Change the pieces that the change touches, in the same pull
  request.
- **The public surface documented.** A CLI flag, a `--json` field, a diagnostic code or its `detail` keys, or an exit code goes into
  `spec/lede-0.1.md` §9 and `lede --help` in the same change.
- **A decision entry** in `DECISIONS.md` for a design, format, renderer or benchmark-method change. Read the entries that touch the
  area first.
- **Safety held.** A compiled page has no script and fetches nothing remote unless `--allow-remote` (D10). The security corpus in
  `packages/render-html/test` must keep passing.

Do not edit the frozen benchmark artifacts: `bench/prompts/C-lede-0.1.md` to `0.4.md` and `bench/tasks/` tie published numbers to a
commit. Write a new prompt file and note it in `DECISIONS.md`.

## Commits and pull requests

Work on a branch and open a pull request against `main`. Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): subject`, with the types `feat`, `fix`, `perf`, `revert`, `docs`, `style`, `refactor`, `test`, `build`, `ci` and
`chore`. `pnpm commitlint --from origin/main` checks your branch.

The changelog and the version are written from those messages on merge (D54), so the subject should say what changed for a reader of
the changelog. The project is on 0.x: describe a change that affects consumers in the commit body. A breaking marker is read as a
minor bump, never a major.

Sign off every commit (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/). There is
no contributor agreement to sign.

Two limits catch people out. Body lines in a commit message are at most 100 characters. And a message must not contain the skip-CI
marker (the words "skip ci" in square brackets): GitHub then runs no checks on the pull request, and the required check `test` never
reports. Dependabot's own "Bump ..." subjects are exempt from the subject-case rule.

## Releases

Merging to `main` releases the next patch version (every commit type does, D54): `changelog.yml` tags it, writes `CHANGELOG.md` and
a GitHub release, and commits the version into the packages and plugin manifests. The release starts `release.yml`, which tests and
packs the three npm packages and stages them on npm (D61). A maintainer approves the `npm` environment, then each staged version on
npm with 2FA. Contributors do nothing here.

## Licences

Code is Apache-2.0 ([LICENSE](LICENSE)). The full specification, `spec/lede-0.1.md`, is CC BY 4.0, and the model reference
`spec/model-spec.md` and the skill in `skill/lede/` are CC0 ([spec/LICENSE](spec/LICENSE), [skill/lede/LICENSE](skill/lede/LICENSE)).
Contributions come in under the licence of the files they change.
