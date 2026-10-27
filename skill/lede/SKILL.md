---
name: lede
description: Write a styled, phone-ready, safe web page as a `.lede` file instead of HTML, then compile it to one self-contained zero-JavaScript HTML file. Use when asked for a report, status page, comparison, runbook, architecture or decision page, or any shareable page where layout, dark mode and phone fit should be handled for you. Cuts output tokens 5-7x against hand-written HTML. Not for apps, interactive widgets or pages that need script.
---

# Lede

Write the page as a `.lede` file, never as HTML or CSS, then compile it:

```
lede check page.lede      # diagnostics (add --json for machine-readable)
lede check page.lede --fix   # rewrite the file to repair mechanical slips (unquoted , or ; in a cell, column names, kpi bars, `grid` before ### sections); read the printed repairs, guesses are labelled
lede build page.lede -o page.html   # one file, no script, nothing fetched (without -o the HTML goes to stdout)
```

Fix every diagnostic from `check` before building. The compiler owns layout, color, dark mode and phone layout.

## Reference

Lede is a line-oriented page format. One line is one block; nothing nests or closes (except ``` fences and sequence alt/opt blocks); indentation never matters. You write content; the compiler owns layout, color, dark mode and phone layout, so never write styling.

Text
```
@title Page title            (meta: also @subtitle, @author Name, Role, @date, @width wide)
# Heading 1 / ## Heading 2 / ### Heading 3
Plain lines are paragraphs; consecutive lines join. A blank line ends a paragraph.
- bullet          1. numbered          - [ ] task          - [x] done task
-- sub-bullet     -- 1. sub-step     (one level, under the item above)
> quote line      > — Attribution (last quote line starting with —)
! A note callout.
!! A warning callout.
!!! A critical callout (outage, data loss, stop-the-line).
---               (horizontal rule)
\Escape: a leading backslash makes the line plain text (for prose starting with a keyword like "table" or "data", or with #, -, >, !).
```
Inline: `code`, **bold**, *italic*, [link text](https://example.com).
Code: a ``` fence with an optional language; ```=html fences raw HTML (sanitized).

Data: declare once, reference by name. Rows are separated by `;`, fields by `,`. Quote fields containing `,` or `;`: "Smith, J", "$1,450". A comma inside **bold** does not split the field. The first row is the header.
```
data runs = week,deploys,rollbacks; W1,14,2; W2,19,1; W3,23,3
data runs += W4,31,1; W5,28,2          (append rows later)
```
Charts: `chart KIND DATA [options]`. KIND is `line`, `area`, `bar` (vertical; grouped for several y columns), `hbar` (horizontal; use for long category names or rankings) or `range` (to-scale spans: schedules, deadlines, safe ranges).
```
chart line runs x=week y=deploys,rollbacks title="Deploys per week"
chart bar runs y=deploys labels
data cost = service,usd; Compute,18400; "Storage, S3",6100
chart hbar cost unit=$ title="Cost by service"
data plan = task,start,end; Design,2026-03-02,2026-03-20; Build,2026-03-16,2026-05-08
chart range plan from=start to=end target="2026-05-01 freeze" title="Plan"
```
Options: `x=col` (default: first column), `y=col,col` (default: every numeric column; column names may contain spaces: `y=open bugs,closed bugs`), `title="..."`, `unit=ms` (or `$`, `%`, any suffix), `stack` (bar/hbar/area), `labels` (print values), `min=` / `max=` (axis range), `focus=col` (highlight one series, grey the rest) or `focus="Thu"` (emphasize one bar by its x value), `target="99.9 SLO"` (a dashed reference line at that value, with an optional label), `mark="W3 deploy"` (an event: the x value as written in the column, then a label; repeatable, 2 to 4 per chart, under 24 characters; not hbar). `range` takes `from=col to=col` (numbers or ISO dates), optionally `at=col` (a marker per row) and `bands=400,5000` (labelled threshold ticks, up to 4). `labels=end` labels only the last point; `labels=all` labels every value. `hatch="Thu"` stripes an estimated bar. Series named good/neutral/bad, done/at risk/blocked and similar take status colors. Bars get value labels automatically when they fit. Cells must be plain numbers (no units inside cells; put the unit in `unit=`).

Tables:
```
table runs                                   (all columns)
table runs cols=week,deploys sort=-deploys limit=5 title="Busiest weeks"
table = option,cost,verdict; SQS,low,**chosen**; Kafka,high,overkill    (inline, one-off)
table runs heat                    (rank numeric cells by value; or heat=col,col)
table runs bar=deploys             (a bar behind that column's numbers)
table runs bar=deploys target=rollbacks   (a tick per bar at the target value)
```
`sort=col` ascending, `sort=-col` descending. Cells may use inline markup. A cell that is just a status word (Done, On track, Ready, At risk, In progress, Blocked, Failed, Go, No-go…) renders as a colored status pill, so write the plain word. Numbered lists render as step lists.

Metric tiles: consecutive kpi lines form one row.
```
kpi Uptime | 99.97% | +0.02 pts | good
kpi p99 latency | 182 ms | -12% | good
kpi Cost | $41,200 | +8% | bad
kpi Deploys | =runs.deploys          (last value of a data column)
kpi Migrated | 58% | on track | bar   (progress bar, 0 to 100)
```
A lone kpi line renders as one large hero number. A note that is just a status word or a date shows as a chip. Fields: label | value | change | tone (`good`, `bad`, `neutral`) or a short note. Tone colors the change.

Diagrams: declare, then write lines prefixed with the diagram's name and a colon.
```
diagram arch dir=LR title="Production topology"
arch: user "Customer" user
arch: api "Payments API" svc "ECS, 6 tasks" focus
arch: db "Orders DB" db
arch: user -> api : https
arch: api -> db, cache : sql
arch: q --> worker : async
arch: a <-> b
arch: group priv "Private subnets" api, db
arch: group vpc "VPC 10.0.0.0/16" priv, lb
arch: legend      (a key to node kinds and arrows)
```
- Node: `id "Label" [kind] ["sub label"] [focus]`. Kind is a short lowercase tag: user, svc, fn, db, queue, cache, lb, ext, store, team, decision (diamond; label its exits yes/no)... Use `focus` on the 1–2 nodes that matter most. Undeclared ids become nodes.
- Edge: `a -> b : label`; `-->` dashed (async, reply, optional); `<->` both ways; `-x-` a blocked path that must not exist; chains `a -> b -> c`; fan-out `a -> b, c`. Keep labels short (≤ 3 words).
- Group: `group id "Label" members...`; members may be other group ids, which nests them (account > VPC > subnet).
- An edge may point at a group id (`vpc -> tgw : attach`).
- `dir=LR` (left to right) or `dir=TB` (top to bottom, default).

Sequence diagrams: `diagram NAME sequence`, then participants, messages in order, and notes.
```
diagram login sequence title="Login"
login: browser "Browser" user
login: app "Web app" svc
login: browser -> app : POST /login
login: note app : checks password
login: alt "password ok"
login: app --> browser : 302 + cookie
login: else "bad password"
login: app --> browser : 401
login: end
```
`opt "cond"` also works; blocks do not nest.

Layout:
```
cards             (the ### sections that follow become a grid of cards)
step Rotate the cert | by 03:00 | Ana     (consecutive step lines: numbered step cards, deadline as a chip)
image chart.png "Alt text describing it" caption="Optional caption"
grid 2            (the next 2 blocks sit side by side; `grid 3`, or `grid 2 count=4` for 4 blocks in 2 columns)
```

Rules: keywords (`data chart table kpi diagram image grid cards step`) are lowercase and start the line. Declare every data name and diagram above its first use. Charts for trends, tables for exact values, kpi tiles for headline numbers, diagrams for structure. `bar` for up to 12 points of one series, `line` for longer trends. The one headline number goes on a lone kpi line; a runbook opens with a kpi row of thresholds or contacts. Repeat a chart's data in a table only when exact values matter. `heat` for scorecards, `bar=` for progress or share columns. Write numbers with their unit: 54.7%, $17.2M, 182 ms, never "percent" or "million". `cards` compare options side by side, `step` lists dated actions, `chart range` shows spans on a scale. Lede only: no HTML unless unavoidable, no Markdown tables, no Mermaid.

## Setup

`lede` is the compiler, from the npm package `@lede-lang/cli` (needs Node 22.12 or later). If `lede` is not found, ask the user before installing anything. With their go-ahead run `npm install -g @lede-lang/cli` (`pnpm add -g @lede-lang/cli` if they use pnpm), or for one build without installing, `npx @lede-lang/cli build page.lede -o page.html`. If Node is missing or older, tell the user and stop; do not install Node.
