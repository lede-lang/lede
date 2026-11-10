# Lede 0.1

Status: **locked for Phase 0** (2026-10-16), with the post-benchmark changes in Appendices B and C, the spike additions in Appendix D, the question words in §4.18 and Appendix G, and the editor words in §4.19 and Appendix G.2. This is the reference specification. The
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
             | note | quote | rule | html-line | keyword-line | bucket-item | diagram-line | text ;

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
keyword-line = data | chart | table | kpi | diagram | image | grid | ask | choose | confirm | export
             | param | toggle | bucket | template | preset ;
bucket-item  = NAME , ":" , WS , REST , [ WS ] , "|" , [ WS ] , TEXT ;   (* only if NAME is a declared bucket set; REST runs to the last | *)
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
ask          = "ask" , WS , NAME , { WS , "lines=" , integer } , [ WS ] , "|" , [ WS ] , REST ;        (* 4.18 *)
choose       = "choose" , WS , NAME , [ WS ] , "|" , options , [ "|" , [ WS ] , REST ] ;
confirm      = "confirm" , WS , NAME , [ WS ] , "|" , [ WS ] , REST ;
export       = "export" , [ WS , WORD ] ;                 (* json | markdown | prompt; a longer line is text *)
param        = "param" , WS , NAME , [ WS , "unit=" , TEXT ] , [ WS ] , "|" , [ WS ] , REST , [ WS ] , "|" , [ WS ] , NUM , WS , NUM , WS , NUM , WS , NUM ;
toggle       = "toggle" , WS , NAME , [ WS , ( "on" | "off" ) ] , [ WS , "needs=" , NAME , { "," , NAME } ] , [ WS ] , "|" , [ WS ] , REST ;
bucket       = "bucket" , WS , NAME , [ WS ] , "|" , options , [ "|" , [ WS ] , REST ] ;
template     = "template" , WS , NAME , [ WS ] , "|" , [ WS ] , REST ;      (* then a fence; "{" NAME "}" in its text is a slot *)
preset       = "preset" , WS , NAME , [ WS ] , "|" , [ WS ] , REST , [ WS ] , "|" , assign , { ";" , assign } ;
assign       = [ WS ] , NAME , [ WS ] , "=" , [ WS ] , TEXT ;             (* NUM: a decimal number; the four are DEFAULT MIN MAX STEP *)
options      = field , { ( "," | ";" ) , field } ;       (* data-cell fields: "," ";" "|" need double quotes *)
NAME         = letter , { letter | digit | "_" | "-" } ;

diagram-stmt = group-stmt | note-stmt | edge-stmt | node-stmt ;
group-stmt   = "group" , [ WS , NODE-ID ] , WS , quoted-string , WS , member , { ( "," | WS ) , member } ;
note-stmt    = "note" , WS , NODE-ID , { "," , NODE-ID } , ":" , REST ;
edge-stmt    = targets , { arrow , targets } , [ ":" , REST ] ;   (* recognised by containing an arrow *)
targets      = NODE-ID , { "," , NODE-ID } ;
arrow        = "->" | "-->" | "<->" ;
node-stmt    = NODE-ID , { WS , ( quoted-string | kind | "focus" | "*" | option ) } ;
```

Keywords are case-sensitive and lowercase. `Table 3 shows…` is prose; `table of contents` is an
error (no data named `of`) and must be written `\table of contents`. The five editor words `param`, `toggle`, `bucket`, `template`
and `preset` are keyword lines only in the shape §4.19 gives (a name, and a `|` after it); `toggle the flag on Monday` is prose.

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
`accent-contrast` on the `@accent` line (a translucent accent is composited first), and the house accent is used,
as for `accent-value`: a page's text contrast does not depend on the writer's color. The theme checked is
the one the accent lands on: with no `theme` the accent applies to the light theme and dark mode keeps the
house accent, so only light is checked; with `theme dark` the dark theme is. The check runs once the whole
document is read, so `@theme` may come after `@accent`. The compiler never darkens or lightens a color: it uses yours whole
or not at all.

### 4.4 Headings
`#`, `##`, `###`. Deeper levels: W `heading-depth`, rendered as `###`. Empty text: E
`empty-heading`. A heading closes an open grid (§4.16). A heading more than one level deeper than the heading before it is W
`heading-skip` with `detail {from, to}` (levels as written); the compiler does not change it.

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
| `min=` `max=` | from data | axis range; `min` must be below `max` |
| `focus=col` | none | that series takes the first color, the rest grey |
| `target="N label"` | none | dashed reference line at N (the axis range includes it), labeled |
| `stack` | off | stack series (`bar`, `hbar`, `area`) |
| `labels` | auto | print values. Bars: on whenever every label fits over its bar; the flag forces it. Lines: the last point |

Bars and areas always include zero. A line chart starts at zero only when its minimum is below
half its maximum; otherwise the axis is padded around the data.
- E `chart-kind`, `missing-data`, `unknown-data`, `unknown-column`, `chart-no-series`,
  `chart-option` (non-numeric `min`/`max`).
- W `non-numeric` (cells left out), `chart-option` (unknown option, `stack` on a line chart, or `min=` not below `max=`: both
  are then ignored). One of the two given alone is ignored by the renderer, with no diagnostic, when it would leave no range
  against the end the data sets (`max=-5` over positive values, `min=100` over smaller ones): the output never holds `NaN`.

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

### 4.18 Questions and the export
Four lines let a page ask and collect. They are blocks in every build mode: `lede build` draws each as a plain control with no
script, and `lede build --shell` (§9) adds a runtime that keeps the answers and copies them out.

```
ask NAME [lines=N] | QUESTION
choose NAME | OPTION, OPTION … [| QUESTION]
confirm NAME | STATEMENT
export [json|markdown|prompt]
```
- NAME matches `[A-Za-z][\w-]*` (so it never holds a control character) and is unique on the page; it is the key in the export. QUESTION and STATEMENT are inline text to
  the end of the line, `|` included. A `choose` with no QUESTION is labelled by its name.
- `ask`: `lines=` is a whole number from 1 to 12; above 1 the field is a text area. `confirm`: an approve-or-reject pair; it takes
  no reason, so a reason is a separate `ask`.
- `choose`: options are separated by `,` or `;` and read as data cells (§4.11): a quoted option may hold `,`, `;` and `|`, and the
  options end at the first `|` outside quotes. Repeated options are removed (W `choose-dup-option`); at least two must remain, none
  may be empty, and `(not chosen)` is reserved (E `choose-options`). Option text is plain text, and it holds no C0 control
  character other than tab (U+0000 to U+0008 and U+000A to U+001F; E `choose-options`, below): a browser rewrites a NUL or a CR in
  a form control's value, so the exported option would differ from the written one. DEL (U+007F) and the C1 controls are allowed.
  The check is made on the options as kept, after each is trimmed, so a vertical tab, form feed or carriage return at an option's
  edge is dropped with the rest of its whitespace and only one inside an option is an error.
- `export`: a bare `export` is `markdown`; `prompt` is the third format (§4.19); one per format (W `export-dup`). The page's export lists every field in source order,
  including fields inside `cards` and `grid`. Fields do not appear in table rows.
- A line that is `ask`, `choose` or `confirm` alone or followed by whitespace is a question line, and fails loudly if malformed
  (§1.5); `export` is a question line only when alone or followed by one word, so `export the data` is text. All four are lowercase:
  `Ask the team` is text, and `\ask the team` writes lowercase text (§4.2). A line with an error makes no block and takes no name.
- E `question-syntax` `{word}`, `question-name` `{word, name}`, `question-dup` `{name, first}`, `choose-options` `{count, empty,
  reserved}` or, for an option with a control character, `{kind, option, char}` (`kind` is `control`, `option` is the option as read and
  `char` the first such character as `U+XXXX`; one error for the line, naming the first such option), `ask-lines` `{value}`, `export-format` `{format}`, `csv-quote`. W `question-option` `{option}`, `choose-dup-option`
  `{option}`, `export-dup` `{format, first}`, `export-orphan` (an `export` and no field), `export-missing` `{fields}` (fields and no
  `export`). The last two are reported when the document ends, so a snapshot of a prefix (§6) may show `export-missing` before
  the `export` line arrives.

AST, one block per line: `{type:"ask", name, text, lines, line}`, `{type:"choose", name, text, options, line}` (`text` is `null`
without a QUESTION), `{type:"confirm", name, text, line}`, `{type:"export", format:"json"|"markdown"|"prompt", line}`.

**The export.** A value per field: `ask` the text with line breaks as `\n` and the ends trimmed; `choose` the option or `null`;
`confirm` `"approved"`, `"rejected"` or `"open"`. A field is _open_ when it is an undecided `confirm` or an unpicked `choose`; an
empty `ask` is not open. The page title is `@title`, else the first `#` heading, as plain text; none is omitted.
- JSON: `{"page"?, "open", "answers"}` as `JSON.stringify(…, null, 2)`, `open` the open names in source order, `answers` an object
  from name to value in source order.
- Markdown, lines joined by `\n`: `# TITLE` and a blank line (when there is a title), `Open: a, b` (`Open: none`), a blank line,
  then `- NAME: VALUE` per field. VALUE is the option, `approved`, `rejected` or `open`; `(not chosen)` for an unpicked `choose`;
  `(empty)` for an empty `ask`; the text of a one-line `ask`. An `ask` that has a line break, a backtick, U+0085, U+2028 or U+2029,
  or equals `(empty)` or `(not chosen)`, is written as `- NAME:`, a blank line, then a fenced block indented two spaces whose fence
  is one backtick longer than the longest run in the value (three at least); empty lines inside stay empty. U+0085, U+2028 and
  U+2029 in the title and in options become a space.
- Both formats carry the same trimmed answers. The template of an ordinary page is the export of the page as written, which is the blank
  page when it has only the words above. The editor words (§4.19) add their values, a `blocked` list and the `prompt` format, and change
  nothing written here.

```json
{ "page": "Release 4.2 go/no-go", "open": ["oncall"],
  "answers": { "owner": "Dana", "risk": "medium", "migration": "approved", "oncall": "open", "notes": "Ship Tuesday." } }
```

Ordinary build rendering: `ask` a one-line field or text area, `choose` a radio group, `confirm` an Approve and a Reject radio
beside the statement, `export` the template of the page as written in a labelled `pre`. No script, no `button`, no `form`. The export
shape is stable within 0.x (D64).

### 4.19 Editor words
Status: **preview**, D65. Five more lines make a page the reader edits and sends back: a number on a slider, a switch with prerequisites,
items sorted into buckets, a text with `{slots}` that fills in, and a one-click set of values. Like the question words (§4.18) they are
blocks in every build mode, and a document without them parses to exactly the AST it had before and compiles to the same bytes (Appendix
G.2). This section is the grammar, how a page draws the words (below), what the three export formats write for them and, last, what
the shell does with them under `--shell`.

```
param NAME [unit=U] | LABEL | DEFAULT MIN MAX STEP
toggle NAME [on|off] [needs=A,B] | LABEL
bucket NAME | B1, B2 … [| QUESTION]
NAME: ITEM TEXT | B
template NAME | LABEL            (then a fence: its text is the body)
preset NAME | LABEL | key=value; key=value
export prompt                     (a third format beside json and markdown)
```
- **The shape rule.** A line that starts with `param`, `toggle`, `bucket`, `template` or `preset` and a space is a keyword line only when
  its second token is a NAME and the line has a `|` after it, with anything between (an option the word does not take there is W
  `question-option` and ignored, as on `ask`: `toggle dark big | Dark mode`); for `param` also when the NAME is followed by `unit=`, for
  `toggle` by `on`, `off` or `needs=`, even before a `|` is written. Any other line that starts with one of the words is text: `toggle the
  flag on Monday`, `bucket the tickets by owner`, `preset values are listed below`, `param names are lowercase` and `template files live
  here` are paragraphs, because none has a `|` after its second word (a text line that does has to start with `\`, as below). A line that
  has the shape and is malformed after it fails loudly (§1.5) as E `question-syntax` `{word}`: `toggle dark on` has no `|`, `param x |
  Label | 1 2` has two numbers too few. The words are lowercase, and a leading `\` writes them as text (§4.2). There is no `item` word: an
  item is a `NAME:` line (below), so no prose line changes meaning.
- **Names.** NAME matches `[A-Za-z][\w-]*` and shares one registry with `ask`, `choose` and `confirm`: a repeat is E `question-dup`
  `{name, first}`, whatever the two words. A line with an error makes no block and takes no name. A bucket set's name is the set's
  (not each bucket's). A `preset` has a name but no value in the export, so it is not a field: it does not stop `export-orphan` or count
  in `export-missing`. LABEL and QUESTION are inline text to the end of the line, `|` included, except where a section below says
  otherwise.
- **`param`.** DEFAULT, MIN, MAX and STEP are numbers read as a chart reads a cell (§4.11), except that a `,` must separate thousands
  (`1,500`, `-2,000.5`): a chart drops every comma, which would read `1,5` as 15, so here `1,5` is not a number. The label runs from the
  first `|` to the last, so it may hold `|`. `unit=` is the only option; its value is plain text to the next space (quote it to hold spaces), and an empty
  unit is none. The numbers must satisfy these rules, tested in this order; the first to fail is E `param-range` with its `rule`:
  MIN < MAX (`order`); STEP > 0 (`step`); MIN ≤ DEFAULT ≤ MAX (`range`); DEFAULT − MIN a whole multiple of STEP within 1e-9 (`grid`);
  MAX − MIN a whole multiple of STEP within 1e-9 (`grid-max`), so MAX is itself a value the control can hold and a `preset` can set;
  (MAX − MIN) / STEP at most 1000 (`count`). Anything but four numbers after the last `|` is E `question-syntax`. Any option but
  `unit=` is W `question-option` and ignored.
- **`toggle`.** The state is `off` unless `on` is written. `needs=` lists toggles on the same page, separated by `,` (quote the list if
  it holds a space); repeats are dropped. It is checked when the document ends, so a toggle may need one declared later: a name that is
  not a toggle, or the toggle itself, is E `toggle-needs` at the toggle's line. The first state word wins; any other word, flag or option
  before the `|` is W `question-option` and ignored. A toggle's text runs to the end of the line.
- **`bucket` and its items.** Buckets are read as data cells, as `choose` options are (§4.18): `,` or `;` between them, quotes for a name
  that holds `,`, `;` or `|`, ending at the first `|` outside quotes; what follows is the QUESTION, or none. A set has two to eight
  buckets, distinct after trimming, none empty, none spelled `(not chosen)` or `(empty)`: otherwise E `bucket-names`. A set cannot
  share a name with a data set or a diagram, nor they with it (E `name-clash` `{bucket}`; `--fix` leaves it), and cannot be named `html`, as a
  diagram cannot, because a line `html: …` is a raw block (§4.10) before it could be an item (E `question-name`). After the set, a
  `NAME: ITEM TEXT | B` line whose NAME is that set adds an item, as a `NAME:` line whose NAME is a diagram adds a statement; a set is
  tried before a diagram, and an item line above its set is what it was before (a diagram statement, or text). The item text is what
  precedes the last `|` (or a `"quoted"` text that is followed by exactly one `|`), trimmed; the bucket after it must be one of the set's
  exactly, case included (E `bucket-unknown`). A line with no `|`, no text or no bucket is E `bucket-item`, whose message names the set.
  An item text repeated in one set is W `bucket-dup-item` and the first is kept. Items keep source order. A set that has no item when
  the document ends is W `bucket-empty`.
- **`template`.** The next non-blank line must open a fence (§4.9), and its text is the body; the fence's info string is `lang`. Any
  other line, a raw `=html` fence, or the end of the document there is E `template-fence` at the template's line. `{NAME}`, with NAME a
  letter then letters, digits, `_` or `-`, is a *slot* only when NAME is an `ask`, `choose`, `param` or `toggle` declared above the
  template; every other brace sequence is literal text, with no escape: `{{x}}`, `{"a": 1}` and `{"press": {press}}` (where `{press}` is
  the slot and the outer braces are JSON) are all fine. A `{word}` that names no such field (a `confirm`, a bucket set, a typo) is W
  `template-slot`, once per word at its first use, and stays as written; a body with no slot is W `template-empty`. The block is
  emitted when the fence closes, and an unclosed fence closes as fences do (W `unclosed-fence`).
- **`preset`.** The label runs to the next `|`. The rest is assignments separated by `;`: the first `=` splits key from value, and the
  value runs to the next `;`, so an `ask` value may hold `=` and `|`. A value that starts with `"` and closes before a `;` or the end of
  the line is quoted and may hold `;`. Each key is an `ask`, `choose`, `param` or `toggle` declared above the preset (E `preset-key`;
  a `confirm`, bucket set, template or preset is not one) and each value is valid for it (E `preset-value`): a `choose` option, `on` or
  `off`, a number in range on the `param`'s step grid (read as the `param` numbers are, comma rule included, and stored as the number it
  reads as, `0.90x` as `0.9`), any text for an `ask`. A repeated key keeps its first value (W `question-option`). One bad assignment makes no block. Anything but a label and at least one
  `key=value` is E `question-syntax`.
- **`export prompt`** is accepted beside `json` and `markdown`; any other word is E `export-format` `{format}`, and its message names all
  three.
- E `question-syntax` `{word}`, `question-name` `{word, name}`, `question-dup` `{name, first}`, `param-range` `{value, min, max, step,
  rule}`, `toggle-needs` `{name, needs, toggles}` (`needs` is the offending name, `toggles` every toggle on the page),
  `bucket-names` `{count, empty, dup, reserved}`, `bucket-unknown` `{bucket, buckets}`, `bucket-item` `{name}`, `template-fence`
  `{name}`, `preset-key` `{key, fields}`, `preset-value` `{key, value, kind}`, `name-clash` `{bucket}`, `csv-quote`. W
  `question-option` `{option}`, `bucket-dup-item` `{text, first}`, `bucket-empty` `{name}`, `template-slot` `{slot, fields}` (`fields` are
  the fillable fields declared above), `template-empty` `{name}`. `toggle-needs`, `bucket-empty` and `template-fence` at the end of the
  document are reported when the document ends, so a snapshot of a prefix (§6) may show them before the line that settles them.

AST, one block per line, in this key order; `unit`, `needs` and `lang` are omitted when unused, so existing documents keep their AST:
`{type:"param", name, text, value, min, max, step, unit?, line}`, `{type:"toggle", name, text, on, needs?, line}`,
`{type:"bucket", name, text, buckets, items:[{text, bucket, line}], line}` (`text` is `null` without a QUESTION; the items arrive after the
block is emitted), `{type:"template", name, text, body, lang?, slots, line}` (`body` is the fence text, `slots` the ordered unique slot
names; `line` is the `template` line), `{type:"preset", name, text, values:[{name, value}], line}`, and `{type:"export", format:"prompt",
line}`. `fieldsOf` returns the seven field kinds in source order, including those inside `cards` and `grid`; `presetsOf` returns the
presets.

**Drawing.** In every mode each word draws native controls with the proposed value filled in, and no `button`, `form`, `select`, `output`
or `id`. LABEL and QUESTION are inline text (§5); names, numbers, option names and item texts are plain text.
- `param`: a labelled `input type="range"` and an `input type="number"` with the same `name`, `min`, `max`, `step` and `value`, then the
  unit as text. The number box carries the accessible name `LABEL, value`. The number box is the one the export reads.
- `toggle`: an `input type="checkbox"` (`value="on"`, `checked` when the state is `on`) in a label, then, outside the label, `Needs A, B`
  when `needs=` is given and an empty `role="status"` span the shell writes its warning in. The checkbox's name is the label alone.
- `bucket`: the legend is the QUESTION, else the set's name; a row of count tiles, one per bucket, each the number of items written into
  it; then an ordered list with one row per item, each row the item text and a radio group (`name="SET:i"`, i the item's index from 0,
  one radio per bucket, the written one checked). A set with no item draws the tiles and no list. Items never move in the page.
- `template`: the body with each slot replaced by the field's value as written (below), in a labelled `pre`, and the count of its
  characters (Unicode code points) beneath.
- `preset`: `LABEL: key value, key value` as text, a `param` value followed by its unit. With `--shell` a hidden button named LABEL
  precedes the text for the shell to reveal; without it there is no button.

The CSS for these words is added only to a page that draws one, so every other page keeps its bytes.

**The export for the editor words.** Values: `param` the number in the box, held to MIN..MAX and then moved to the nearest point of the step
grid from MIN (a tie goes up, and the noise of the multiplication is rounded away at nine decimals, so `0.85 + 11 * 0.01` is `0.96`), or the
page's default when the box is empty or not a number; `toggle` `on` or
`off`; `bucket` the bucket each item is in, in the item order (an item with no valid bucket is where it was written); `template` the
body with each slot replaced, once and in one pass over the body, by the slot field's value as text: an `ask` or `choose` its text, a
`param` its number then a space and its unit when it has one, a `toggle` `on` or `off`. An `ask` left empty and a `choose` left unpicked
leave `{name}` as written, a value that itself holds `{other}` is not expanded, and every brace sequence that is not a slot stays. A
toggle is _blocked_ when it is `on` and a toggle it `needs` is `off`; a `needs` name that is no toggle is never met. `open` is as in §4.18.
The export of an ordinary page is the export of the page as written: each `param` at its default, each `toggle` and item where its line
puts it, each `template` filled from those, each `ask` empty, `choose` unpicked and `confirm` open.
- JSON: `{"page"?, "open", "blocked"?, "answers"}`. `blocked` (the blocked toggles' names in source order) is present only on a page
  that has a toggle. In `answers`, a `param` is a number, a `toggle` `"on"` or `"off"`, a `bucket` an object from every bucket's name, in
  order, to the array of the item texts in it, and a `template` the filled text.
- Markdown: after `Open: …`, `Blocked: a, b` or `Blocked: none` when the page has a toggle. Then `- NAME: 0.94 x` for a `param` (the
  unit after a space when there is one) and `- NAME: on` for a `toggle`. A `bucket` is `- NAME:` followed by one line per bucket in
  order, `  - B: item, item`; an item text that holds `,`, `;` or `"`, or is spelled `(none)`, is written as a quoted cell (`"` doubled),
  and an empty bucket is `  - B: (none)`. A `template` is `- NAME:`, a blank line and its text in a fenced block as for a multi-line
  `ask` (`(empty)` when the text is empty). U+0085, U+2028 and U+2029 in item texts and bucket names become a space.
- Prompt: the text an agent applies without diffing. The first line is `Apply these changes to TITLE:` (`Apply these changes:` with no
  title), then a blank line, then one line per changed field in source order and, for a `bucket`, one line per moved item in item order.
  A field is changed when its value differs from the page as written; an `ask`, `choose` and `confirm` compare against blank. The lines:
  `- NAME: VALUE (was OLD)` with OLD `empty`, `not chosen`, `open`, the written number and unit, or `on`/`off` (a multi-line or
  sentinel `ask` writes `- NAME: (was empty)` and then the fence form of §4.18), and `- SET: "ITEM TEXT" moved to B (was A)` with the
  item text always a quoted cell (`"` doubled), so a `:` or `(was` inside it cannot be misread. A reader takes a line of a bucket set's
  name for a move and any other for a field. After a blank line: `Open: a, b` when any field is open, `Blocked: a, b` when any toggle is
  blocked, and `Unchanged: a, b` for every field that has no line, is not open and is not blocked (a set whose items all stayed, and a
  template none of whose slots has a line). A line is left out when its list is empty. When nothing changed the text is the heading, a
  blank line and `No changes.`, with no other line, even if a field is open. A template is derived, so it never has a line of its own and
  its filled text is not repeated: its slots are fields, and a changed one appears by name. A template is listed under `Unchanged` only
  when none of the fields its `{slots}` name changed; when any did, the template is in no list, because what its text now says follows
  from those lines.

**Under `--shell`.** The fixed runtime (§7) acts on all seven field kinds, and every export it writes is, character for character, what the
rules above give for the values the controls hold. On every change it rewrites each export, the warnings, the counts and the filled
templates in one pass, so nothing it shows is older than the last input. The page is a working page without it (the controls are native),
and the runtime adds no element and moves none.
- `param`: the range and the number box follow each other. A number box that is emptied leaves the range where it was, and while the
  box is empty the export uses the page's default. A number typed outside MIN..MAX or off the grid stays in the box as typed (the range
  stops at its end); the export holds it to the range and the grid, as above.
- `toggle`: when it is `on` and a toggle it `needs` is `off`, the runtime sets `aria-invalid="true"` on its checkbox and writes
  `needs A, which is off` (the first unmet name) into the status span outside the label; both go when the need is met. Nothing is
  disabled and nothing is refused: the toggle is _blocked_ in the export (above).
- `bucket`: each count tile follows the radios at once. Items never move in the page.
- `template`: the body is refilled on every change, once and in one pass, and the count beneath is in Unicode code points.
- `preset`: the hidden button of each preset is shown and its text of values is hidden. A click sets the radio, checkbox, text and number
  controls named in the preset (the range follows its number box), rewrites everything as for any change and says `Applied LABEL` beside
  the first export. A preset sets values and sends nothing.
- If the data block cannot be read (§7), the runtime changes nothing and the page stays as the ordinary build draws it.

## 5. Inline markup
`` `code` ``, `**bold**`, `*italic*` or `_italic_`, `[text](url)`. URLs must be `http`,
`https`, `mailto`, relative or `#fragment`; others render as plain text. `\` escapes
`` ` * _ [ ] \ ``. All other text is escaped; inline HTML is not interpreted.

## 6. Streaming

A conforming parser accepts input line by line and emits a block as soon as it is final: a
heading, note, rule, data, chart, table, image or diagram declaration on its own line; a
paragraph, list, quote or kpi row when a line of another kind (or a blank line) arrives; a
fence when it closes; a grid when it fills. Emitted blocks never change, with two exceptions
renderers must handle: a diagram or a bucket set (§4.19) gains statements from later lines, and a chart, table or kpi
reflects rows appended with `data NAME +=`. Question words (§4.18) are final when read; the page-wide warnings `export-missing` and `export-orphan` are reported when the document ends. Among the editor words (§4.19), `param`, `toggle` and `preset` are final when read. A `bucket` is emitted on its
declaration and gains an item from each later `NAME:` line. A half-written bucket set renders as its legend, its count tiles (counting
the items written so far, none right after the `bucket` line) and the item rows so far as static radios; each later item line adds a
row and raises one count, and nothing already drawn moves. A `template` is emitted when its fence closes; a snapshot taken inside the
fence shows it with the text so far, and a snapshot after the `template` line and before the fence shows no template. The warnings
`toggle-needs`, `bucket-empty` and `template-fence` are reported when the document ends. A snapshot of a partial document (with the open
block flushed) is always a valid document. The partial last line (no `\n` yet) is not parsed.

A streaming consumer learns of the two exceptions as events, in line order, beside the blocks it is given: `block` (a
block is final), `update` (a `name:` line changed a diagram already given, or a `data NAME +=` line appended rows to that data
name) and `seal` (the first non-blank line that is not a statement of the diagram, or the end of the document: a blank line does
not seal, since writers space statements). A bucket set has the same two events as kinds of their own, `bucket-update` (a
`NAME: ITEM | B` line added an item to a bucket set already given) and `bucket-seal`, so `update` and `seal` carry a diagram, as
they did before bucket sets. A bucket set streams as a diagram does: it is given on its declaration, each item line is a
`bucket-update` and the first other non-blank line seals it. A `name:` line that is rejected, or that repeats what the diagram or
set has (a bad item, an unknown bucket, an item text it already lists), is no update, but it is still a statement of it and does
not seal it. A statement after a seal that changes the diagram or set is an update again, and the next sealing line a second
seal. A diagram or bucket set inside a `grid` or `cards` run that has not been given yet is not on screen, so its lines are no
update. A conforming streaming consumer may also read the open block (paragraph, list, quote, kpi row, step run, fence, grid or
cards run, as a block) without ending the document; a keyword line is never part of it, because it is a block or a diagnostic on
its own line, except that the fence a `template` line opened is read as the template block with the text so far (a `template` line
with no fence yet adds nothing). A bucket set is in it only inside an open `grid` or `cards` run, with the items read so far; one
written anywhere else was given on its declaration.
`LedeStream.events`, `.tail` and `.end` in `@lede-lang/core` are this interface.

## 7. Rendering contract (`@lede-lang/html`)

- A complete page: `<!doctype html>`, `lang`, charset, viewport, one `<style>`; **no
  executable JavaScript**, so the output works under `script-src 'none'`. Question words (§4.18) draw
  plain controls (text, radio, text area) with no script, `button` or `form`, and leave the policy unchanged; the editor words (§4.19)
  add range, number and checkbox inputs, lists and a `pre`, on the same terms. That holds for every page built without `--shell`.
- With `--shell` (§9), a page that has a question and an `export` carries exactly two scripts after `<main>`: an inert
  `application/json` block (version 2: the title, each field's name and kind, for a `param` its default, unit, bounds and step, for a `toggle` its
  state and prerequisites, for a `bucket` its bucket names and item texts, for a `template` its body and slots, then the presets and the
  formats; `<`, `>`, `&`, U+2028 and U+2029 written as `\uXXXX`) and the compiler's one fixed runtime, under 8 KiB. The page policy is
  the ordinary one plus `script-src 'sha256-…'` naming the runtime's SHA-256, so nothing else can run. The runtime sends nothing, keeps
  nothing after the tab closes, and writes only `textContent` (the export, status text and the filled template), the `value` of a text,
  number or range control and the `checked` state of a radio or checkbox (both only to follow a twin control or apply a preset), the
  `hidden` attribute, `aria-invalid` on a toggle's checkbox, and the selection. It rejects a block whose version is not 2 or whose
  fields do not fit their kind, and then does nothing. The model never writes script, in either mode.
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
- The package also exposes an incremental form, `createIncremental(meta, data, opts)`, that takes the blocks of a
  `LedeStream` (§6) as they become final and returns DOM operations carrying the HTML of the unit each one touches; after
  the stream ends, the markup it has built equals the `<main>` that `render()` writes for the whole document, and it carries
  no script. Question words (§4.18) stream as the controls `render()` draws, and so do the editor words (§4.19): `param`, `toggle`,
  `preset` and `template` are drawn when read, a `bucket` set is drawn again in place for each item line (the `bucket-update` of §6; its
  `bucket-seal` adds nothing, since every update drew it in full), and a `template` fence still open is drawn, with the text so far, in the open
  block the consumer reads. The page's stylesheet gains the controls' rules when the first field or `export` arrives and the editors' when
  the first editor word does. An `export` lists the fields, the bucket items and the title read so far and is drawn again, in place,
  when a later field, item or the title changes what it lists. The `shell` option has no effect on this form, which draws the ordinary page. The layout engine for flow diagrams (elkjs) is loaded when the first flow diagram is laid
  out, and `setLayoutEngine(fn)` replaces it.

## 8. Versioning
The spec version is independent of package versions. 0.x minor versions may change grammar
with a migration note; once 1.0 ships, grammar changes follow an RFC process (to be published before 1.0).

## 9. Command line and diagnostics format (`@lede-lang/cli`)

The command is `lede`, the bin of the npm package `@lede-lang/cli` (Node 22.12+; it runs as compiled JavaScript). The library
packages are `@lede-lang/core` (parser) and `@lede-lang/html` (renderer). The three share one version (D48).

`lede check FILE... [--json] [--fix [--dry-run]] [--artifact]` prints every diagnostic and exits 1 if any is an error, 0 otherwise (2 for
a usage error or a missing file). Without `--json`, its last line, on stderr, is `ok` only when no file had a diagnostic of either
severity; otherwise it is the counts summed over every file: `1 warning(s)`, `2 error(s)` or `1 error(s), 2 warning(s)`. A warning leaves
the exit code at 0 but never gets `ok`: read the diagnostics above that line, since the exit code does not carry them. With `--json` there
is no such line. `--artifact` adds the artifact checks (below) to the report; they are warnings, so the exit code is unchanged and the
last line is their count, never `ok`. `lede --help` lists every command and flag.

`lede build FILE [-o OUT] [--force] [--unsafe-html] [--allow-remote] [--artifact] [--shell]` compiles the first FILE to one page. Diagnostics go to stderr as
for `check`. With `-o` the page is written to OUT and a size line goes to stderr; without it the page goes to stdout. A document with
an error is not written and exits 1, unless `--force`, which renders it anyway and exits 0. `--unsafe-html` keeps `html` blocks
unsanitized (§4.10); `--help` marks it for local files only, but nothing checks that. `--allow-remote` lets images load from remote
URLs (§4.16), in `image` blocks and as `<img>` in `html` blocks. Links render the same with or without it. It adds `https:`, and only
`https:`, to the page CSP's `img-src`, so an `http:` image is written into the page and the browser then blocks it. `--artifact` writes
only `<title>`, the page's `<style>` and its `<main>`, in that order: no doctype, `html`, `head` or `body`, and no `meta` tags or CSP. The
Claude Artifact tool wraps a file in a page of its own and sets those itself. The style and the main are the full page's, byte for byte, so
the light and dark tokens, the `data-theme` override and the zero-script output are the same; only the shell differs. `--artifact` also runs
the artifact checks: each `image` whose source is a local path (§4.16: relative, or starting with `/`) gets W `artifact-image` with
`detail {src, kind}` (`kind` is `local`), because the Artifact host serves the page from its own origin and has no copy of the file; the fix is a `data:` URI or an
uploaded asset. `check --artifact` runs the same checks and nothing else new, so an agent can see them before building. A `data:` or
remote source raises nothing new. `--shell` adds the interaction shell (§7) to a page that has at least one field (`ask`, `choose`, `confirm`, `param`, `toggle`, `bucket`
or `template`) and an `export` line (`export json`, `export markdown` or `export prompt`); any other page is built as without the flag,
and stderr says so. With `--artifact` the data block and runtime follow `<main>` and the
meta tags are still omitted, so the Artifact host's own policy decides whether the runtime runs. `--shell` with `--unsafe-html` is a
usage error: raw `html` could plant its own controls and data block. Exit codes for every
command: 0 on success; 1 for `build` on errors without `--force` and for `check` on errors; 2 for a usage error (no command, an
unknown command, no FILE, `--shell` with `--unsafe-html`) or a missing file; 70 for an internal error, such as OUT not being writable, printed to stderr. Flags a
command does not know are ignored. `--help`, `-h` or `help` prints the help to stdout and exits 0.

`lede watch FILE [-o OUT]` builds FILE to OUT, or to `NAME.html` beside `NAME.lede`, then rebuilds on every change until stopped. It always
renders as if `--force` were given, and honours `--unsafe-html`, `--allow-remote` and `--shell`. With `--shell`, the note that the flag had no
effect is printed on the first build it holds for, and again only if a page that took the shell stops doing so; it is not repeated on every save. `lede ast FILE` prints the parsed document,
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
`name-clash` `{diagram}` (a diagram named like a data set; a clash with a bucket set carries `{bucket}` instead, and `--fix` leaves
it). The question-word codes (§4.18) carry `detail` too (`choose-options` has `{count, empty, reserved}`, or `{kind, option, char}` with
`kind` `control` when an option holds a C0 control character other than tab), and so do the editor-word codes (§4.19): `param-range` `{value, min, max,
step, rule}` (`rule` is `order`, `step`, `range`, `grid`, `grid-max` or `count`), `toggle-needs` `{name, needs, toggles}`, `bucket-names`
`{count, empty, dup, reserved}`, `bucket-unknown` `{bucket, buckets}`, `bucket-item` `{name}`, `bucket-dup-item` `{text, first}`,
`bucket-empty` `{name}`, `template-fence` `{name}`, `template-slot` `{slot, fields}`, `template-empty` `{name}`, `preset-key`
`{key, fields}` and `preset-value` `{key, value, kind}`; `export-format` `{format}` now names `prompt` too. So does `accent-contrast` (§4.3) `{accent, theme, ratio, required, against}`:
`theme` is `light` or `dark`, `ratio` is the lowest contrast found rounded down to two decimals, `required` is `4.5`, and `against` names
the surface (`bg`, `surface` or `accent-tint`). So does `artifact-image` `{src, kind}`: `src` is the image path as written and `kind` is
`local`. So does `heading-skip` (§4.4) `{from, to}`: the level of the heading before and of this one, as written (`--fix` leaves it).
New keys may be added; existing ones are not removed or retyped within 0.x.

`--fix` rewrites each file to repair mechanical slips and prints one line per repair. It repairs:
- a `####` or deeper heading (to `###`);
- an `x=`/`y=` column name that is the unique prefix of a column; a stray word after a column name in `x=`, `y=` or
  `focus=` (`y=customers sort`: the column is quoted, and the word is then reported as an ignored option);
- a diagram named like a data set (renamed `NAME-flow` with its body lines);
- in a `data` row or inline `table =` row: an unquoted `,` inside a cell, an unquoted `;` inside a cell (the text either
  side of it rejoins, whether the `;` left a lone fragment or two short rows), and a header cell split at a thousands comma;
- a number the parser already read across an unquoted thousands comma (W `csv-thousands`; the number is quoted);
- `kpi L | 74 of 120 | 61.7% | bar` (W `kpi-bar` with a plain unsigned percent in the change field): the two fields swap;
- any other `kpi` line whose `bar` the compiler could not draw (`kpi L | ~75% | roughly three-quarters | bar`, a signed change, a
  reference value out of range): the `bar` field is dropped. Marked a guess: the page does not change, because no bar was drawn, but
  the writer may have wanted one and should give the value as a percent from 0 to 100;
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
same edge. Errors are those of any edge (`diagram-syntax` for a missing target). The renderer draws the edge dashed, with a circled
X at the middle of its longest straight stretch (on a straight edge, halfway along); not halfway by total length, which can fall on a
bend of a routed edge, next to whatever else arrives there.

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

## Appendix G. Question words (2026-10, grammar v0.5)
Status: **preview**, D63 and D64. `ask`, `choose`, `confirm` and `export` (§4.18) are new keywords, valid in every build mode. Every
new AST block is new; a document without them parses to exactly the AST it had before. Conformance cases 31 to 34 and errors e21 to
e26 are normative. `spec/model-spec.md` does not describe the words yet: models read them from the on-demand reference (D55 cap).

The keywords are now `data chart table kpi diagram image grid cards step ask choose confirm export`, all lowercase at the start of a
line, and none can name a diagram (E `diagram-name`).

### G.1 What changed for existing input
Input that parsed before parses identically except lines that start with a new word: a lowercase line that begins `ask`, `choose` or
`confirm` was paragraph text and is now a question line (an error when malformed), a line that is `export` or `export WORD` likewise,
and `diagram ask`, `choose`, `confirm` and `export` are now E `diagram-name`. Searched across the 803 `.lede` files tracked in the
repository (benchmark outputs, examples, conformance, fixtures), parsed with the v0.4 parser (`d7f43fd`) and this one: identical ASTs
and diagnostics for all 803, and byte-identical compiled pages for all 803. Every earlier conformance case and test passes unedited.

### G.2 Editor words
Status: **preview**, D65. `param`, `toggle`, `bucket`, `template` and `preset`, the `NAME: ITEM | B` lines of a bucket set, and `export
prompt` (§4.19) are new, valid in every build mode. The keywords are now `data chart table kpi diagram image grid cards step ask choose
confirm export param toggle bucket template preset`, and none can name a diagram (E `diagram-name`). Conformance cases 35 to 40 and
errors e27 to e43 are normative. `spec/model-spec.md` does not describe the words: models read them from the on-demand reference (D55
cap).

**What changed for existing input.** Input that parsed before parses identically except: a lowercase line that starts with one of the five
words, a name and then, later on the line, a `|` (for `param` also `unit=`, for `toggle` also `on`, `off` or `needs=`) was paragraph text
and is now an editor line (an error when malformed); `export prompt` was E `export-format` and is a block; the message of E `export-format` now names
`prompt`; and `diagram param`, `toggle`, `bucket`, `template` and `preset` are now E `diagram-name`. A `NAME:` line binds to a bucket set
only when a `bucket NAME` is above it, so a document without a bucket set binds nothing new. Searched across the 814 `.lede` files
tracked on `main` at `de5408c` (benchmark outputs, examples, conformance, fixtures), parsed with the parser at that commit and with this
one: none has a line that starts with one of the five words, and the ASTs and diagnostics (codes, severities, lines, columns and
`detail`) are identical for all 814. The only difference is the message of the E `export-format` in conformance error e24, which
now reads `json, markdown or prompt`. Every earlier conformance case passes unedited.

**What changed for existing pages.** A page built without `--shell` is unchanged; the `--shell` build of a question page changes in its
scripts. The same 814 files, none of which has an editor word, were compiled in seven modes (plain, `--shell`, `--artifact`, `--shell
--artifact`, fragment, `--allow-remote` and `--unsafe-html`) with the renderer at `de5408c` and with the renderer that draws the editor
words: 5,698 pages, of which 5,682 are byte-identical, every page in the five modes that carry no script among them. The other 16 are the
`--shell` and `--shell --artifact` builds of the eight files that ask a question and have an export: `conformance/cases/31-ask`,
`32-choose`, `33-confirm` and `34-export`, `conformance/errors/e22-question-names`, `e23-choose-options` and `e24-ask-lines-export`, and
`examples/parity/questions`. They carry the new runtime, so their data block (version 2 on every shell page, §7), their script and the
hash in their page policy change; with the two script elements and that hash taken out, each is byte-identical to the old build, and any
other file builds as without `--shell` (D64). The markup, the CSS and the `prompt` note exist only on a page that has an editor word or
`export prompt`. A page with an editor word draws the controls of §4.19, and under `--shell` the runtime acts on them. The shell's
behaviour on a question-only page is unchanged.

### G.3 Control characters in `choose` options
A `choose` option that holds a C0 control character other than tab is now E `choose-options` with `detail {kind: "control", option, char}`
(§4.18, issue #22). It parsed before, with the character kept, and a browser then rewrote it in the radio's `value` (NUL became U+FFFD,
CR became LF), so a `--shell` page exported text that the AST did not hold. A question name is unchanged: `[A-Za-z][\w-]*` has never
allowed a control character (E `question-name`), and an editor word whose name has one is not an editor line. None of the 858 `.lede`
files tracked on `main` at `0184535` holds a C0 control character other than tab and line feed, so none can reach the new error.
Conformance error e44 is normative.
