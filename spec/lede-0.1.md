# Lede 0.1

Status: **locked for Phase 0** (2026-10-16), with the post-benchmark changes in Appendices B and C and the spike additions in Appendix D. This is the reference specification. The
model-facing summary is [`model-spec.md`](model-spec.md); where they differ, this file wins.
The reference implementation is `packages/core` (parser) and `packages/render-html`
(renderer), and the conformance suite in `conformance/` is normative for parsing.

## 1. Design rules

1. **One line is one block.** A block's kind is decided by the start of its line alone.
   Nothing nests and nothing needs closing, except fenced code (§4.9), which is the single
   multi-line construct.
2. **Indentation never matters.** Leading and trailing whitespace is stripped before a line
   is classified. (Inside a fence, indentation is preserved, minus the fence's common indent.)
3. **Declare before use.** A chart, table or kpi may reference only data declared on an earlier
   line; a diagram line may reference only a diagram declared on an earlier line. This is what
   makes Lede streamable: every line can be rendered as soon as it is complete.
4. **The writer states intent; the compiler owns presentation.** There is no syntax for color,
   size, font, spacing or responsive behavior.
5. **Fail loudly.** A line that starts with a keyword but does not parse is an error, never
   silently reinterpreted as prose. A leading `\` is the explicit way to write prose that starts
   like a keyword (§4.2).

## 2. Lexical structure

- Source is UTF-8 text. Lines end at `\n`; a trailing `\r` is removed.
- A **line** after stripping is *blank* if empty.
- **Identifier** (`ID`): `[A-Za-z_][A-Za-z0-9_-]*` for data and diagram names;
  diagram node ids also allow `.` and a leading digit: `[A-Za-z0-9_][A-Za-z0-9_.-]*`.
- **Quoted string**: `"…"`. Inside it, `""` and `\"` are a literal `"`. No other escapes.
- **Option**: `key=value` (no spaces around `=`) or `key="quoted value"`; a **flag** is a bare
  word the block defines (e.g. `stack`). For column-valued options (`x`, `y`, `focus`, `cols`,
  `sort`) an unquoted value extends over following bare words until the next option, flag or
  quoted string, so column names may contain spaces (§4.13).
- **Inline CSV** (data rows): rows separated by `;`, fields by `,`; whitespace around fields is
  trimmed. A field that starts with `"` is quoted and may contain `,` `;` and `""`.

## 3. Grammar (EBNF)

Lines are classified in the order below; the first rule that matches wins. `REST` is the rest of
the line after the matched prefix.

```ebnf
document     = { line , NL } ;
line         = blank | fence-open | escaped | meta | heading | task-item | bullet | ordered
             | note | quote | rule | html-line | keyword-line | diagram-line | text ;

blank        = "" ;
escaped      = "\" , REST ;                         (* REST is paragraph text *)
fence-open   = "```" , { "`" } , [ "=" ] , [ lang ] ;   (* see 4.9; collects until a closing fence *)
meta         = "@" , key , [ WS , REST ] ;
heading      = ( "#" | "##" | "###" ) , [ WS , REST ] ;   (* 4–6 #s: warning, rendered as ### *)
task-item    = "-" , WS , "[" , ( " " | "x" | "X" ) , "]" , WS , REST ;
bullet       = "-" , WS , REST ;
ordered      = digit , { digit } , ( "." | ")" ) , WS , REST ;
note         = ( "!" | "!!" ) , WS , REST ;
quote        = ">" , [ " " ] , REST ;
rule         = "---" , { "-" } ;
html-line    = "html:" , REST ;
keyword-line = data | chart | table | kpi | diagram | image | grid ;
diagram-line = diagram-name , ":" , WS , diagram-stmt ;   (* only if diagram-name was declared *)
text         = REST ;                                (* paragraph line *)

data         = "data" , WS , ID , WS? , ( "=" csv | "+=" csv-rows | "<" path ) ;
csv          = header-row , { ";" , row } ;
csv-rows     = row , { ";" , row } ;
row          = field , { "," , field } ;
field        = quoted-string | { any-char - ( "," | ";" ) } ;

chart        = "chart" , WS , chart-kind , WS , ID , { WS , ( option | "stack" | "labels" ) } ;
chart-kind   = "line" | "area" | "bar" | "hbar" ;
table        = "table" , WS , ( ID , { WS , option } | { option , WS } , "=" , WS , csv ) ;
kpi          = "kpi" , WS , label , "|" , value , [ "|" , delta , [ "|" , tone-or-note ] ] ;
value        = text-field | "=" , ID , "." , column ;
image        = "image" , WS , src , WS , quoted-string , { WS , option } ;
grid         = "grid" , WS , digit , [ WS , "count=" , integer ] ;
diagram      = "diagram" , WS , ID , [ WS , ( "flow" | "sequence" ) ] , { WS , option } ;

diagram-stmt = group-stmt | note-stmt | edge-stmt | node-stmt ;
group-stmt   = "group" , [ WS , NODE-ID ] , WS , quoted-string , WS , member , { ( "," | WS ) , member } ;
note-stmt    = "note" , WS , NODE-ID , { "," , NODE-ID } , ":" , REST ;
edge-stmt    = targets , { arrow , targets } , [ ":" , REST ] ;   (* recognised by containing an arrow *)
targets      = NODE-ID , { "," , NODE-ID } ;
arrow        = "->" | "-->" | "<->" ;
node-stmt    = NODE-ID , { WS , ( quoted-string | kind | "focus" | "*" | option ) } ;
```

Keywords are case-sensitive and lowercase. `Table 3 shows…` is prose; `table of contents` is an
error (no data named `of`) and must be written `\table of contents`.

## 4. Blocks

Each block below lists its syntax, its options, what it renders to, and its errors (E) and
warnings (W). Diagnostic codes are stable identifiers; messages are not normative.

### 4.1 Paragraph
Any line no other rule claims. Consecutive text lines join with a single space into one
paragraph; a blank line or any other block ends it. Inline markup (§5) applies.

### 4.2 Escape
`\` at the start of a line removes itself and forces the rest to be paragraph text, so
`\# not a heading`, `\- not a list`, `\table stakes` are prose.

### 4.3 Meta
`@key value`. Known keys: `title` (document title; if no `#` heading repeats it, it is rendered
as the page heading and `#` headings shift down one level), `subtitle`, `description`, `author`,
`date`, `accent` (a `#hex` color), `theme` (`light` | `dark` forces one), `lang`, `width`
(`wide` widens the reading column), `fonts`. W `unknown-meta` for other keys (still stored).

`accent` must be a CSS hex color (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`); any other value is W
`accent-value` and the house accent is used. The accent colors link and label text, so it needs WCAG AA
text contrast, 4.5:1, against the theme's page background, card surface and note tint; below that it is W
`accent-contrast` on the `@accent` line (a translucent accent is composited first). The theme checked is
the one the accent lands on: with no `theme` the accent applies to the light theme and dark mode keeps the
house accent, so only light is checked; with `theme dark` the dark theme is. The check runs once the whole
document is read, so `@theme` may come after `@accent`. The compiler does not adjust the color.

### 4.4 Headings
`#`, `##`, `###`. Deeper levels: W `heading-depth`, rendered as `###`. Empty text: E
`empty-heading`. A heading closes an open grid (§4.16).

### 4.5 Lists
`- item`, `1. item` (or `1)`), `- [ ] task`, `- [x] done`. Consecutive items of the same kind
form one list; the first number is the start. A text line after a list starts a paragraph (no
lazy continuation).

### 4.6 Quote
`> text`; consecutive quote lines join. If a quote has more than one line and its last line
starts with `—`, `–` or `--`, that line is the attribution.

### 4.7 Notes
`! text` is a note, `!! text` a warning, `!!! text` a critical callout. Each line is its own
callout. `!text` with no space is prose.

### 4.8 Rule
`---` (three or more hyphens, nothing else).

### 4.9 Fences
A line of three or more backticks opens a fence; an optional info string follows. The fence
collects raw lines until a line consisting of at least as many backticks. Common leading
indentation of the body is removed.
- ```` ```lang ```` → code block.
- ```` ```=html ```` → raw HTML block (§4.10). Any other `=format`: E `raw-format`.
- End of document inside a fence: W `unclosed-fence`; the fence closes there.

### 4.10 HTML
`html: <markup>` on one line, or a ```` ```=html ```` fence for several. HTML is **sanitized** by
default to an allowlist of structural and text elements (no `script`, `style`, `iframe`, event
attributes or `javascript:` URLs; `data:` only as an `img` source, and only `data:image/`).
Renderers MUST offer an explicit unsafe mode and MUST NOT enable it by default.

### 4.11 Data
```
data NAME = header,header; v,v; v,v
data NAME += v,v; v,v
data NAME < path/to/file.csv
```
Declares a named table of strings. Types are decided at use (a chart reads cells as numbers).
- E `data-syntax` (malformed), `data-empty` (no header), `data-dup-column`, `csv-quote`
  (unclosed quote), `unknown-data` (`+=` before `=`), `data-file` (file loading unavailable or
  failed; implementations without a file system MUST report this rather than fetch).
- E `data-row-width`: a row with the wrong number of fields (it is padded or truncated so
  rendering can continue).
- W `csv-thousands`: a row with too many fields is repaired when merging an unquoted thousands
  separator (`$1,450` read as `$1` and `450`) gives exactly the right width.
- W `data-redefined`: `=` on an existing name replaces it.
- Data and diagram names share one namespace: E `name-clash`.

Numbers in cells: an optional sign, digits, optional decimals; `,` `$` `€` `£` `%` and a
trailing unit among `ms s gb mb tb x × pt pts` are ignored. Anything else is non-numeric.

### 4.12 Chart
`chart KIND DATA [options] [flags]`, KIND ∈ `line area bar hbar`.

| Option | Default | Meaning |
|---|---|---|
| `x=col` | first column | categories along the x axis (the y axis for `hbar`) |
| `y=col,col` | every other column with a numeric cell | series |
| `title="…"` | none | caption |
| `unit=…` | none | `$` `€` `£` prefix the value; `%` suffixes; anything else suffixes after a space |
| `min=` `max=` | from data | axis range |
| `focus=col` | none | that series takes the first color, the rest grey |
| `target="N label"` | none | dashed reference line at N (the axis range includes it), labeled |
| `stack` | off | stack series (`bar`, `hbar`, `area`) |
| `labels` | auto | print values. Bars: on whenever every label fits over its bar; the flag forces it. Lines: the last point |

Bars and areas always include zero. A line chart starts at zero only when its minimum is below
half its maximum; otherwise the axis is padded around the data.
- E `chart-kind`, `missing-data`, `unknown-data`, `unknown-column`, `chart-no-series`,
  `chart-option` (non-numeric `min`/`max`).
- W `non-numeric` (cells left out), `chart-option` (unknown option or `stack` on a line chart).

### 4.13 Column references
Wherever an option names a column (`x y focus cols sort`, and kpi `=data.col`), the name
matches exactly, or else case-insensitively with runs of spaces collapsed. The canonical
(declared) spelling is stored in the AST.

### 4.14 Table
`table DATA [cols=a,b] [sort=col|-col] [limit=N] [title="…"]`, or the inline one-off form
`table [options] = header; row; row`. Numeric columns (every non-empty cell numeric) are
right-aligned. A cell whose whole text is a status word from the renderer's lexicon (done, on
track, ready, at risk, in progress, blocked, failed, go, no-go, …) renders as a pill that keeps
the word as its text. Sorting is numeric when every cell of the sort column is numeric, else lexical.
- E `unknown-data`, `unknown-column`, `table-option` (bad `limit`). W `table-option` (ignored).

### 4.15 KPI
`kpi LABEL | VALUE [| DELTA [| TONE-OR-NOTE]]`. Consecutive kpi lines form one row of tiles.
- VALUE `=data.column` takes the column's last non-empty cell; if DELTA is empty it is computed
  as last minus previous, signed, at the inputs' precision.
- The 4th field is a tone if it is exactly `good`, `bad` or `neutral`, otherwise a note. Tone
  colors the delta; without one the delta is neutral. Direction is always shown with a glyph,
  so meaning never depends on color.
- E `kpi-syntax` (no `|`, empty label or value), `kpi-ref`. W `kpi-syntax` (> 4 fields).

### 4.16 Image and grid
`image SRC "alt text" [caption="…"]`. Alt text is required (E `image-alt`). A source must be a
relative path, an `http(s)` URL or a `data:image/` URI; any other scheme, a protocol-relative
`//host/…` source and one starting with `\` are E `image-src`. Both checks read SRC as a browser's
URL parser does (leading control characters and spaces dropped, tabs and newlines removed, `\` read
as `/` in a path or an `http(s)` URL), so `/\host/a.png` is protocol-relative. In a `data:` URI `\` is
content, so `data:image\svg+xml,…` is not a `data:image/` URI. Renderers MUST NOT load `http(s)` images unless the
caller opts in; by default they show the alt text in place.

`grid N [count=M]` (N from 1 to 4, M defaults to N) places the next M rendered blocks in N
columns. Data lines, diagram lines and blank lines do not count. A heading closes the grid
early (W `grid-unfilled`), as does the end of the document. Grids do not nest: a `grid` line
inside a grid closes the first one.

### 4.17 Diagrams
`diagram NAME [flow|sequence] [dir=LR|TB|RL|BT] [title="…"]` declares a diagram. Statements
are lines starting `NAME:` and may appear anywhere after the declaration, interleaved with
other blocks. A diagram renders where it is declared.

**Flow** statements:
- Node: `id "Label" [kind] ["sub label"] [focus]`. Order of the extras is free; the first quoted
  string is the label, the second the sub label; a lowercase bare word is the kind (shown as a
  tag); `focus` or `*` marks a focal node (accent color; use on one or two). Re-declaring an id
  updates it. Ids used before declaration become nodes labeled with the id.
- Edge: `a -> b`, `a --> b` (dashed: async, reply, optional), `a <-> b`; chains `a -> b -> c`;
  fan-out `a -> b, c` (every pair across adjacent hops). `: label` after the arrows labels the
  **last hop only**.
- Group: `group [id] "Label" member, member …`. Members are node or group ids; a group listed as
  a member nests inside. A node belongs to the first group that lists it (W `diagram-group`).
  An id that was only *used* in an edge may later be declared as a group; that edge then
  attaches to the group's boundary. Group cycles: E `diagram-group-cycle`.
- E `undeclared-diagram` (a `name: … -> …` line before `diagram name`), `diagram-name`,
  `diagram-redeclared`, `diagram-syntax`. W `diagram-empty`, `diagram-option`.

**Sequence** statements: participants are node statements (in order of first appearance);
`a -> b : msg` is a message, `a --> b : msg` a reply, `a -> a : msg` a self-call;
`note a[, b] : text` places a note after the messages written above it. Fan-out is an error.

Layout (normative for renderers that claim conformance): flow diagrams use a layered layout
with orthogonal edge routing; edge labels never overlap other edges or nodes; edges never pass
through non-endpoint nodes; node sizes sit on a 4px grid. A left-to-right diagram wider than a
phone also gets a top-to-bottom layout that the page uses at phone widths.

## 5. Inline markup
`` `code` ``, `**bold**`, `*italic*` or `_italic_`, `[text](url)`. URLs must be `http`,
`https`, `mailto`, relative or `#fragment`; others render as plain text. `\` escapes
`` ` * _ [ ] \ ``. All other text is escaped; inline HTML is not interpreted.

## 6. Streaming

A conforming parser accepts input line by line and emits a block as soon as it is final: a
heading, note, rule, data, chart, table, image or diagram declaration on its own line; a
paragraph, list, quote or kpi row when a line of another kind (or a blank line) arrives; a
fence when it closes; a grid when it fills. Emitted blocks never change, with two exceptions
renderers must handle: a diagram gains statements from later lines, and a chart, table or kpi
reflects rows appended with `data NAME +=`. A snapshot of a partial document (with the open
block flushed) is always a valid document. The partial last line (no `\n` yet) is not parsed.

## 7. Rendering contract (`@lede-lang/html`)

- A complete page: `<!doctype html>`, `lang`, charset, viewport, one `<style>`; **no
  executable JavaScript**, so the output works under `script-src 'none'`.
- No remote fetches by default (system font stacks, no remote images).
- Light and dark themes from CSS custom properties; `prefers-color-scheme` plus
  `data-theme="light|dark"` on `<html>` to override.
- Usable at 360px wide without page-level horizontal scroll. Charts ship a narrow variant;
  wide tables and diagrams scroll inside their own box.
- Every SVG has `role="img"` with `<title>` and `<desc>` (charts describe range and extremes;
  diagrams list groups and edges); every chart also carries its data as a table in
  `<details>`. Table headers use `<th scope>`.
- Every box that can scroll sideways (tables, diagrams, code blocks, chart data) takes keyboard
  focus (`tabindex="0"`) and has an accessible name.

## 8. Versioning
The spec version is independent of package versions. 0.x minor versions may change grammar
with a migration note; once 1.0 ships, grammar changes follow an RFC process (to be published before 1.0).

## 9. Command line and diagnostics format (`@lede-lang/cli`)

The command is `lede`, the bin of the npm package `@lede-lang/cli` (Node 22.12+; it runs as compiled JavaScript). The library
packages are `@lede-lang/core` (parser) and `@lede-lang/html` (renderer). The three share one version (D48).

`lede check FILE... [--json] [--fix [--dry-run]]` prints every diagnostic and exits 1 if any is an error, 0 otherwise (2 for a usage
error or a missing file). `lede --help` lists every command and flag.

`lede build FILE [-o OUT] [--force] [--unsafe-html] [--allow-remote]` compiles the first FILE to one page. Diagnostics go to stderr as
for `check`. With `-o` the page is written to OUT and a size line goes to stderr; without it the page goes to stdout. A document with
an error is not written and exits 1, unless `--force`, which renders it anyway and exits 0. `--unsafe-html` keeps `html` blocks
unsanitized (§4.10); `--help` marks it for local files only, but nothing checks that. `--allow-remote` lets images load from remote
URLs (§4.16), in `image` blocks and as `<img>` in `html` blocks. Links render the same with or without it. It adds `https:`, and only
`https:`, to the page CSP's `img-src`, so an `http:` image is written into the page and the browser then blocks it. Exit codes for every
command: 0 on success; 1 for `build` on errors without `--force` and for `check` on errors; 2 for a usage error (no command, an
unknown command, no FILE) or a missing file; 70 for an internal error, such as OUT not being writable, printed to stderr. Flags a
command does not know are ignored. `--help`, `-h` or `help` prints the help to stdout and exits 0.

`lede watch FILE [-o OUT]` builds FILE to OUT, or to `NAME.html` beside `NAME.lede`, then rebuilds on every change until stopped. It always
renders as if `--force` were given, and honours `--unsafe-html` and `--allow-remote`. `lede ast FILE` prints the parsed document,
diagnostics included, as JSON on stdout and exits 0 even when the document has errors.

`--json` prints one object keyed by file path; each value is an array of diagnostics:

```json
{ "page.lede": [ { "severity": "error", "code": "data-row-width", "message": "row ... has 5 fields; t has 4 columns (...)",
                   "line": 12, "col": 40, "detail": { "fields": 5, "want": 4, "name": "t" } } ] }
```

`severity` is `error` or `warning`; `line` and `col` are 1-based; `code` is stable and `message` is not (§4). The messages of
the common codes end with what to write instead (`...; put a cell that contains , in double quotes`, `...; did you mean
delay ms?`). `detail` is optional and machine-readable. Codes the fixer reads carry it: `unknown-column` `{column, columns}`,
`data-row-width` `{fields, want, name}`, `csv-thousands` `{fields, want, name}` (`fields` counted before the merge),
`name-clash` `{diagram}` (a diagram named like a data set). So does `accent-contrast` (§4.3) `{accent, theme, ratio, required, against}`:
`theme` is `light` or `dark`, `ratio` is the lowest contrast found rounded down to two decimals, `required` is `4.5`, and `against` names
the surface (`bg`, `surface` or `accent-tint`). New keys may be added; existing ones are not removed or retyped within 0.x.

`--fix` rewrites each file to repair mechanical slips and prints one line per repair. It repairs:
- a `####` or deeper heading (to `###`);
- an `x=`/`y=` column name that is the unique prefix of a column; a stray word after a column name in `x=`, `y=` or
  `focus=` (`y=customers sort`: the column is quoted, and the word is then reported as an ignored option);
- a diagram named like a data set (renamed `NAME-flow` with its body lines);
- in a `data` row or inline `table =` row: an unquoted `,` inside a cell, an unquoted `;` inside a cell (the text either
  side of it rejoins, whether the `;` left a lone fragment or two short rows), and a header cell split at a thousands comma;
- a number the parser already read across an unquoted thousands comma (W `csv-thousands`; the number is quoted);
- `kpi L | 74 of 120 | 61.7% | bar` (W `kpi-bar` with a plain unsigned percent in the change field): the two fields swap;
- `grid N` followed by exactly N `###` sections (W `grid-unfilled`): the line becomes `cards`;
- a name on an inline table (`table vendors = ...`, W `table-option`): the word is dropped, unless another keyword line
  uses it or it is a table option name (`table bar = ...`).

A comma repair tries every run of neighbouring fields as the one cell. It drops a run that would put a non-number into a column
whose other well-formed rows are all numbers, that glues a bare number to text with `, ` (`then fixed, 3`), or that glues two
bare numbers that are not a thousands group (`8,5`); of the rest it
takes the first that reads as prose (a field with spaces, then one starting in lower case or with a digit), else the only one,
else the only one that leaves the row's first cell alone, else nothing. A `;` repair is likewise not made when it would put text
in a numeric column or glue a bare number to text (`3; Bo`). A repair that chooses between readings is marked "a guess": the `,` and `;` row repairs, the header repair,
the kpi swap, the stray-word split (the writer may have meant a column that does not exist) and `grid` to `cards` (cards choose
their own columns, so the grid's column count is not kept). Rules: a repair never changes the line count; it never touches a header row except to rejoin a split cell; each repair is
checked on its own and made only when it leaves fewer errors, or as many errors and fewer warnings; missing data is never invented.
`--dry-run` (with `--fix`) prints the changed lines as `-`/`+` pairs and writes nothing; its exit code is `check`'s on the file as written.

## Appendix A. Changes from the prototype (the original Python `lede.py`, not part of this repo)
- Keyword lines that fail to parse are errors instead of silently becoming prose; `\` escapes.
- `name:` diagram lines only bind to declared diagrams, and `x: a -> b` for an undeclared `x`
  is an error rather than prose.
- Added: `image`, `grid`, `data +=`, inline `table =`, kpi references, `hbar`, `stack`, `labels`,
  `unit`, `focus`, task lists, quote attribution, sequence diagrams, nested groups, edges to
  groups, `-->`/`<->`, fan-out, ```` ```=html ```` fences, HTML sanitizing, CSV quoting rules.
- Layout moved from Graphviz to elkjs (no native dependency; runs in the browser).

## Appendix B. Changes made after the Phase 0 benchmark (draft → 0.1)
Measured on 80 cold-model outputs (`bench/results/c-diagnostics-v0.1.json`):
- **Column names with spaces** (15 of 20 errors): `y=open bugs` now reads the whole name;
  matching is case-insensitive (§2, §4.13).
- **Unquoted thousands separators** in rows: repaired with a warning when unambiguous (§4.11).
- **Edges to groups** (`prodvpc -> tgw` with `prodvpc` a group): now allowed (§4.17).

## Appendix C. Changes after the visual judging round (0.1 → 0.1 + renderer round 2)
The blind judge preferred hand-written HTML in most pairs (report §5). Grammar additions:
`!!!` critical callouts and chart `target=`. Renderer changes (no syntax): status pills, bar
value labels when they fit, point markers on short lines, step-numbered ordered lists, chart and
diagram cards, diagram direction chosen to fit the desktop column, and two fixes (bars below a
raised `min=`; colliding first x-axis labels).

## Appendix D. Spike additions (2026-10)
Status: **spike**, on the `spike/renderer-parity` line. Three additions, chosen as the smallest
syntax that closes gaps found when comparing Lede pages with hand-written HTML. They follow the design rules in §1: one line
is one block, no nesting, no closing lines outside the one sequence-diagram exception below,
indentation never matters, and a malformed line is an error with a fix hint. Every new AST field is
optional and is **omitted** (not `null`, not `[]`) when unused, so documents that do not use these
features parse to exactly the AST they had before. Conformance cases 18 to 21 and errors e07 to e09
are normative.

### D.1 Chart event markers: `mark=`
```
chart line uptime y=rate target="99.9 SLO" mark="W2 deploy v2" mark="Week 3 incident"
```
`mark="CATEGORY label"` marks one x category with a short label. It follows `target="N label"`:
the quoted value starts with the thing being pointed at, then the label. The option repeats; each
occurrence is one marker, kept in source order.
- **Matching.** CATEGORY is a value of the chart's x column, compared exactly (case-sensitive,
  spaces significant). The longest category that is a prefix of the quoted value and is followed by
  a space or the end of the value wins, so `Week 3` beats `Week`, and `W1` never matches `W10 x`.
  The rest, trimmed, is the label and may be empty (`mark=W10`, a bare tick).
- **When.** Checked at the `chart` line against the rows declared so far (declare before use, §1.3);
  rows added later with `data +=` do not rescue an unknown category.
- **Kinds.** `line`, `area`, `bar`. On `hbar` the option is ignored with W `chart-option`.
- **AST.** `ChartBlock.marks?: { x: string; label: string }[]`, where `x` is the category exactly as
  it is spelled in the data. Absent when there are no valid markers.
- **Errors.** E `chart-mark`: no category of the x column starts the value (the message lists the
  first eight categories and says to quote `mark="CATEGORY label"`). The chart is still emitted
  with its valid markers.

### D.2 Sequence diagrams: `alt` / `opt` / `else` / `end`
```
login: alt "password ok"
login: app --> browser : 302 + cookie
login: else "bad password"
login: app --> browser : 401
login: end
login: opt remember me
login: app -> browser : long cookie
login: end
```
Statements in a `sequence` diagram only:

| Line | Meaning |
|---|---|
| `NAME: alt COND` | opens a block; the first branch is labeled COND |
| `NAME: opt COND` | opens a block with a single branch |
| `NAME: else [COND]` | starts the next branch of the open `alt` (COND optional) |
| `NAME: end` | closes the open block |

COND is a quoted string (`""` and `\"` escape as in §2) or the rest of the line, unquoted. Blocks
are **flat**: at most one is open at a time, and `alt`/`opt` while one is open is an error. The
statements may be interleaved with other blocks like any diagram line. Messages and notes between the
opener and `end` belong to the open branch.
- **Reserved words.** In sequence diagrams `alt`, `opt`, `else` and `end` at the start of a
  statement are block keywords, as `note` and `group` already are. A participant may still be
  *named* one of them in messages (`alt -> end : x` is an edge) but not declared (`end "Closer"`
  is no longer a node). **This is the only change to the meaning of input that was valid before
  Appendix D**, apart from D.3. Flow diagrams are unchanged: `flow: end "Done"` is still a node.
- **AST.** `DiagramBlock.frames?: DiagramFrame[]`, present only on a sequence diagram that has at
  least one block, in source order, never overlapping. Positions are indexes into `edges` taken when
  the line was read, as `DiagramNote.after` is; ranges are half-open.
  ```ts
  interface DiagramFrame {
    kind: 'alt' | 'opt';
    branches: { label: string; from: number; to: number | null; line: number }[]; // opt: exactly one
    from: number; to: number | null;   // edges[from .. to) are inside the block
    line: number; endLine: number | null;
  }
  ```
  `to` and `endLine` (and the last branch's `to`) are `null` while the block is open (streaming) or
  never closed. A renderer treats `null` as "through the last message".
- **Errors** (all E, all with a fix hint in the message):
  - `diagram-block-unclosed`: a block is still open at the end of the document (reported at its
    opening line; fix: add `NAME: end`).
  - `diagram-block-stray`: `end` or `else` with no block open, or `else` inside an `opt`.
  - `diagram-block-nested`: `alt`/`opt` while a block is open. The nested opener and its matching
    `end` are ignored (no frame, no second error), so one mistake gives one error.
  - `diagram-block-syntax`: `alt`/`opt` with no condition (the block is still opened).
  - W `diagram-block-syntax`: text after `end` (ignored).
- A snapshot of a partial document (§6) taken inside a block has `to: null` and the
  `diagram-block-unclosed` error; live previews should not show diagnostics for it.

### D.3 Sub-list items: `-- `
```
1. Roll back
-- check the canary
-- 1. drain traffic
2. Verify
```
`--`, a space, then text is a sub-item of the closest top-level item above it in the same list.
After the `--`, an optional `N.` or `N)` makes the sub-item *numbered*, and an optional `[ ]` or
`[x]` makes it a task. Whether the parent is bulleted, numbered or a task does not matter, and
sub-items do not interrupt the list (`1.` `--` `2.` is one list).
- **One level.** Sub-items cannot have sub-items. `---` is a rule (§4.8) and `--- text` stays a
  paragraph. `--text` (no space) and a bare `--` stay prose. `1.5 million` after `-- ` is text, not
  a number (a number needs the `.` or `)` followed by a space).
- **Escape.** `\-- text` is prose, as with any escape (§4.2). `> -- Name` quote attribution is
  unchanged.
- **AST.** Sub-items stay in the parent list's flat `items`, directly after their parent, so a
  renderer that knows nothing of them shows a flat list. A sub-item has `level: 2` and
  `ordered: boolean`; top-level items have neither key. The sub-list of an item is the run of
  consecutive `level: 2` items after it; its numbering (if the first one is `ordered`) starts at 1
  and the written number is not kept; a run that mixes `-- ` and `-- 1.` markers is one sub-list
  whose kind is the first item's.
- **Errors.** E `list-sub-orphan`: a `-- ` line with no list directly above it (after a paragraph,
  a blank line or any other block). It becomes a top-level bullet so rendering continues. Fix: put
  a `- item` or `1. item` line above it, or escape the line with `\`.
- **Compatibility.** A line that begins `-- ` followed by text used to be a paragraph line. That
  is the second change of meaning in this appendix. Searched for it: no benchmark output
  (`bench/gen`), example, prototype page, report or earlier conformance case used one.

### D.4 What changed for existing input
Exactly two meanings changed for input that parsed before: the reserved words in sequence diagrams
(D.2) and `-- text` lines (D.3). Nothing else: no existing diagnostic code, severity or position
changed, and the 40 original tests pass unedited. The model-facing text for these
additions is proposed in `packages/core/test/fixtures/model-spec-grammar-delta.md` (+86 tokens), and the
exact AST shapes for renderers are pinned by the conformance cases.

## Appendix E. Renderer-parity additions (2026-10, grammar v0.3)
Status: **spike**, second renderer-parity spike (D29). Same rules as
Appendix D: every new AST field is optional and **omitted** when unused, so documents that do not use
these features parse to exactly the AST they had before. Conformance cases 22 to 24 and errors e10 to
e12 are normative.

```
table-opt  = … | "heat" | "heat=" cols | "bar=" cols ;
edge-arrow = "->" | "-->" | "<->" | "-x-" | "-x->" ;
```

### E.1 Table `heat` and `bar=`
- `table DATA heat` tints every numeric column by rank; `heat=col,col` limits it to those columns.
  AST: `heat: true` or `heat: ["col", …]` on the table block.
- `table DATA bar=col,col` draws a proportional bar behind the numbers of those columns.
  AST: `bars: ["col", …]`. Both options work on inline tables (`table heat = a,b; …`).
- **Errors.** E `unknown-column`: a named column does not exist (the table is not emitted).
  W `table-option`: a named column is not numeric; it is ignored, and the option is omitted if no
  column remains.

### E.2 Blocked edges: `-x-` and `-x->`
`a -x- b : label` and `a -x-> b : label` declare an edge that must not exist (a forbidden path).
AST: an edge with `style: "blocked"` and `both: false`; chains and fan-out work as for `->`. `-x-`
needs a space on both sides, so an id such as `a-x-b` is still an id. Both spellings parse to the
same edge. Errors are those of any edge (`diagram-syntax` for a missing target).

### E.3 Chart `focus="x value"`
`focus=` may name a value of the chart's x column as well as a series; the chart emphasizes that bar
or point. W `chart-option` only when it is neither a series nor an x value.

### E.4 Bold spans in inline rows
In inline `data` and `table` rows, a `**…**` span whose closing marker comes before the next `;`
is read as one piece: a comma inside it does not split the field. An unbalanced `**` is ordinary
text, so the comma splits as before (and a row-width error follows if the count is wrong).

### E.5 What changed for existing input
Input that parsed before parses identically except: a `**` pair containing a comma in an inline row
now keeps the comma inside its field (previously it split the field), and `chart … focus=VALUE`
no longer warns when VALUE is an x value.

## Appendix F. Vocabulary v0.4 (2026-10, grammar v0.4)
Status: **spike**, third renderer-parity spike (D33). Same rules as
Appendices D and E: every new AST field is optional and **omitted** when unused, so documents that do
not use these features parse to exactly the AST they had before. Misuse falls back with a warning
(the option or field is dropped, or the plain block is used); the only new errors are
`chart-range-kind` and `unknown-column` on `chart range`. Conformance cases 25 to 30 and errors e13 to
e18 are normative.

```ebnf
line         = … | keyword-line | … ;                    (* unchanged order *)
keyword-line = data | chart | table | kpi | diagram | image | grid | cards | step ;
cards        = "cards" ;                                 (* alone on the line; "cards TEXT" is text *)
step         = "step" , WS , title , [ "|" , due , [ "|" , note ] ] ;
chart-kind   = "line" | "area" | "bar" | "hbar" | "range" ;
chart-range  = "chart" , WS , "range" , WS , ID , { WS , ( "from=" col | "to=" col | "at=" col
             | "bands=" value , { "," , value } | option ) } ;
chart-opt    = … | "labels=end" | "labels=all" | "hatch=" ( x-value | quoted-string ) ;
table-opt    = … | "target=" col ;
kpi          = "kpi" , WS , label , "|" , value , { "|" , field } ;   (* a field exactly "bar" after the value is the bar flag *)
diagram-stmt = "legend" | group-stmt | note-stmt | edge-stmt | node-stmt ;   (* "legend" alone *)
```

The keywords are now `data chart table kpi diagram image grid cards step`, all lowercase at the start
of a line, and none can name a diagram (E `diagram-name`). `\cards` and `\step …` are prose (§4.2).

### F.1 `cards`
```
cards
### Managed queue (recommended)
Runs in two zones. **$380** a month.
### Self-hosted cluster
!! Needs a named owner.
```
`cards` alone on a line opens a run. Each following `### Title` starts a card that takes every block up
to the next `###`. The run ends at a `#` or `##` heading, `---`, another `cards` line, a `grid` line or
the end of the document; the closing line is then read as usual.
- **Before the first `###`.** Blocks between `cards` and the first `###` are emitted as usual, before
  the cards, and the run keeps waiting for a `###`. A run that ends with no `###`: W `cards-empty` (at
  the `cards` line); no block.
- **Content.** Paragraphs, lists, notes, quotes, code, images, kpi rows, tables, charts and steps go in
  the card. A `diagram` declared inside a card: W `cards-content`; the diagram is emitted right after
  the cards block and its `NAME:` lines still apply. A `grid` line inside a card: W `cards-content`; it
  ends the run and the grid follows as usual. `data` lines declare data as usual and their `data` blocks
  stay at the top level. A `cards` line while a grid is open closes the grid early (W `grid-unfilled`).
- **Recommended.** A title containing "recommended" is highlighted by the renderer (no AST field).
- **AST.** `{ type: 'cards', items: [{ title, blocks, line }], line }`. `line` is the `cards` line;
  each item's `line` is its `###` line. Headings never appear in `blocks`. `####`+ inside a run is a
  card too (after W `heading-depth`, as in §4.4).
- **Streaming.** The cards block is final, and emitted, when its run ends (§6); blocks before the run
  stream out as before. A snapshot (§6) shows the cards read so far.
- `cards TEXT` (anything after the word) is a paragraph line, so `cards on the table` stays prose.

### F.2 `chart range`
```
chart range plan from=start to=end at=checkpoint target="2026-05-15 code freeze"
chart range hops from=p50 to=p99 at=today bands=50,100 unit=ms
```
One horizontal bar per row from the `from` cell to the `to` cell, on a shared to-scale axis. The row
label is `x=` (default: the first column). `at=col` marks each row's value with a dot. `bands=a,b,c`
draws labelled threshold ticks. `target`, `title`, `unit` and `focus` (an x value) work as for other
charts; `hatch=` (F.6) works too.
- **Axis kind.** Every non-empty `from`, `to` and `at` cell is a number (§4.11), or every one is an ISO
  date `YYYY-MM-DD`; anything else, or a mix: E `chart-range-kind` (the chart is not emitted). Empty
  cells are allowed (the renderer leaves that bar or dot out).
- **Columns.** `from=` and `to=` are required; a missing option or an unknown column (also for `at=`
  and `x=`): E `unknown-column` (not emitted). The values span spaces like `x=` (§2).
- **target.** On a number axis as in §4.12. On a date axis it must start with an ISO date; the AST
  keeps `target.value` a number: **UTC epoch milliseconds of that date** (`Date.UTC(y, m-1, d)`).
  A target that is not of the axis kind: E `chart-option`.
- **bands.** Kept as written (strings), in order. A value not of the axis kind: W `chart-option`,
  dropped. More than 4: W `bands-limit`, the first 4 are kept.
- **Ignored.** `y=`, `stack`, `labels` and `labels=` mean nothing on a range (no diagnostic, and
  `labels` is always `false`). `min=`/`max=` are numbers on a number axis; on a date axis they are
  ignored with W `chart-option`. `mark=`: W `chart-option`, ignored (as on hbar).
- **AST.** A `ChartBlock` with `kind: 'range'`, `y: []`, `stack: false`, `labels: false`, plus `from`
  and `to` (canonical column names) and, when given, `at` and `bands`. Other chart kinds never carry
  these keys, and their option parsing is unchanged.

### F.3 Progress bars with targets
- `table DATA bar=col target=col`: each row gets a tick at its `target` cell on its `bar=` bar. AST:
  `targetCol: "col"` (canonical name). `target=` with no (surviving) `bar=` column, a non-numeric
  column, or an unknown column: W `table-option`, ignored (the table is still emitted). The value
  spans spaces like `cols=`.
- `kpi Label | 58% | | bar`: a field exactly `bar` anywhere after the value is removed from the
  fields and sets `bar: true` on that kpi; the remaining fields are read as in §4.15 (so
  `kpi L | 58% | +3 | good | bar` has delta `+3`, tone `good`, and no >4-fields warning). The value must
  be a number from 0 to 100, with or without `%` (`58%`, `58`, `0.5`); otherwise W `kpi-bar` and no
  `bar` key. For `=data.col` values the check uses the column's last non-empty cell at that line.

### F.4 `step`
```
step Announce the window | by 14:00 | Post in #platform
step Roll the verifiers | in progress
step Write the follow-up
```
`step`, a space, then `Title | due | note`. Consecutive step lines form one block (a blank line or any
other line ends it, as for kpi rows). Missing `due` and `note` are `''`; pipes after the third field
stay in the note. `step` with no title: W `step-syntax`, line ignored. `steps`, `stepwise` and other
words that merely start with "step" are prose; `\step …` is prose. Numbered lists are unchanged.
AST: `{ type: 'steps', items: [{ title, due, note, line }], line }`.

### F.5 Chips
Renderer only: a status word or a date/time phrase in a kpi delta or note, a step `due`, or a table
cell that is only a date/time renders as a chip. No grammar or AST change.

### F.6 Chart annotations
- `labels=end` and `labels=all` set `labels: true` and `labelMode: 'end' | 'all'`. Bare `labels` is
  unchanged and has no `labelMode`. Any other `labels=` value: W `chart-option`, ignored.
- `hatch="x value"` (repeatable; quote values with spaces) lists x values drawn striped, in source
  order without duplicates: `hatch: string[]`. A value that is not exactly a value of the x column:
  W `chart-option`, dropped.
- Semantic series colours: renderer only.

### F.7 Diagram `legend`
`NAME: legend` (the word alone) in a flow diagram sets `legend: true`. In a sequence diagram:
W `legend-kind`, ignored. `NAME: legend "Key"` and edges such as `NAME: x -> legend` still declare or
use a node named `legend`.

### F.8 Numerals
Model-spec text only; no grammar change.

### F.9 What changed for existing input
Input that parsed before parses identically except:
- lines that are exactly `cards`, or start with `step` and a space, were paragraph text and are now
  blocks; `diagram cards` and `diagram step` are now E `diagram-name`;
- `NAME: legend` alone in a flow diagram declared a node `legend`, and now sets the legend (in a
  sequence diagram it declared a participant and is now ignored with W `legend-kind`);
- a kpi field exactly `bar` after the value was a note and is now the bar flag;
- `labels=end|all`, `hatch=` and `chart range` were ignored or E `chart-kind`; table `target=` was
  silently ignored and now reads a column (with W `table-option` on misuse).

Searched for each across the 542 `.lede` files in the repository (benchmark outputs, examples,
conformance): none used a bare `cards` line, a `step ` line, `diagram cards|step`, `: legend`, a kpi
`| bar` field, `labels=`, `hatch=`, table `target=` or `chart range`. All 542 were parsed with the
v0.3 parser (`d89fc20`) and this one: identical ASTs and identical diagnostic codes, severities and
positions. Every earlier conformance case and test passes unedited.
