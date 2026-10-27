# @lede-lang/cli

The `lede` command for [Lede](https://ledelang.dev), a line-oriented page format that AI models write instead of HTML. It checks
`.lede` files and compiles each to one self-contained HTML page with charts, diagrams, light and dark themes and a phone layout,
and no JavaScript.

```sh
npm install -g @lede-lang/cli     # Node 22.12 or later

lede check page.lede              # diagnostics; add --fix to repair mechanical slips, --json for machines
lede build page.lede -o page.html # one file, no script, nothing fetched
lede watch page.lede              # rebuild on every save
```

Without installing: `npx @lede-lang/cli build page.lede -o page.html`.

To have an AI agent write the pages, add the skill: `npx skills add lede-lang/lede`, or in Claude Code
`/plugin marketplace add lede-lang/lede` then `/plugin install lede@lede`. The skill tells the agent to run `lede`.

- Site, reference, examples and playground: https://ledelang.dev
- Source, specification and issues: https://github.com/lede-lang/lede
- Apache-2.0. An early 0.x release: it will change.

This package depends on `@lede-lang/core` (the parser) and `@lede-lang/html` (the renderer).
