# Editor support for Lede

What exists here:

- `textmate/lede.tmLanguage.json`: a TextMate grammar, scope `source.lede`, file type `.lede`. It uses standard scope names
  (`markup.heading`, `markup.quote`, `keyword.control.*`, `string.quoted.double`, `markup.bold` and the like), so existing themes
  colour it. The `html` fence embeds `text.html.basic`, and the usual code fence languages embed their `source.*` grammars.
- `vscode/`: a minimal VS Code extension (private, no dependencies) that registers the language and points at that grammar.

Nothing here is published.

## What a regex grammar cannot know

Lede is read line by line, and most lines are told apart by their start, which a grammar handles well. Three things need the
document, and the grammar does not have it:

- **A `NAME:` line** is a diagram statement, a decision statement, a bucket item or a data row only when `NAME` was declared
  above. The grammar does not know the names, so it claims a `identifier:` line at the start of a line only when what follows has
  a diagram-like or row-like shape: an edge (`->`, `-->`, `<->`, `-x-`), a statement word (`group`, `note`, `legend`, `alt`,
  `opt`, `else`, `end`, `option`, `question`, `role`), a node (`id "Label"`) or pipe fields (` | `). Any other `Word: text` line is
  left as prose. The name must start with a lowercase letter or `_`, since prose lines start with capitals and no declared name in this
  repository's examples does. The cost: a lowercase prose line such as `result: a -> b` is scoped as an edge, and a capitalised
  name, or a declared name whose line has none of those shapes, is not coloured.
- **A `: a | b` table row** belongs to a table only while an inline table is open. The grammar colours any line that starts with `:`.
- **An editor word** (`param`, `toggle`, `bucket`, `template`, `preset`) and `decision` are keyword lines only in a shape, so
  `toggle the flag on Monday` is prose. The grammar copies the parser's shape rules as lookaheads; a test compares both on the same
  lines.

Escaped lines (`\table stakes`) are prose, and a `template` line's fence is coloured as an ordinary fence.

The grammar is checked by `packages/cli/test/textmate-grammar.test.ts`: every pattern compiles as JavaScript (so it avoids
Oniguruma-only syntax), each construct is claimed by the expected rule, and every keyword the parser lists must have a rule.
That test cannot run Oniguruma, so the grammar is untested in a real TextMate engine except as described below.

## Trying it

- **VS Code**: see `vscode/README.md` (the extension development host).
- **Sublime Text, JetBrains (TextMate bundles), others**: untested. In principle any editor that loads `.tmLanguage.json`
  can use the grammar file: Sublime Text reads `.sublime-syntax` and `.tmLanguage` (convert the JSON to a plist first), and
  JetBrains IDEs load a folder holding the grammar plus an `info.plist` as a TextMate bundle (Settings, Editor, TextMate Bundles).
  None of that has been tried.

## GitHub Linguist

GitHub highlights a language from a TextMate grammar submitted to github-linguist. As read in its CONTRIBUTING.md on 2026-11-14,
the bar is counted in files: about 2,000 files per extension indexed on GitHub in the last year, with a reasonable spread across
unique repositories. A submission is therefore far off, and that figure is a reading of a document that changes, so it must be
re-read before any submission and is not stated here as certain. The grammar is licensed with the repository (Apache-2.0).
