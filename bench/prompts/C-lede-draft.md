Write the page in Lede, a line-oriented format that compiles to a styled web page. The complete Lede reference follows.

<lede-reference>
Lede is a line-oriented page format. One line is one block, nothing nests, nothing closes (except ``` fences). Indentation never matters. You write content; the compiler owns layout, color, dark mode and phone layout, so never write CSS or styling.

Text
```
@title Page title            (meta: also @subtitle, @author, @date, @width wide)
# Heading 1 / ## Heading 2 / ### Heading 3
Plain lines are paragraphs; consecutive lines join. A blank line ends a paragraph.
- bullet          1. numbered          - [ ] task          - [x] done task
> quote line      > — Attribution (last quote line starting with —)
! A note callout.
!! A warning callout.
---               (horizontal rule)
\Escape: a leading backslash makes the line plain text (use it when prose starts with a keyword like "table" or "data", or with #, -, >, !).
```
Inline: `code`, **bold**, *italic*, [link text](https://example.com).
Code: a ``` fence with an optional language; ```=html fences raw HTML (sanitized).

Data: declare once, reference by name. Rows are separated by `;`, fields by `,`. Quote fields containing `,` or `;`: "Smith, J". The first row is the header.
```
data runs = week,deploys,rollbacks; W1,14,2; W2,19,1; W3,23,3
data runs += W4,31,1; W5,28,2          (append rows later)
```
A data line must come before the chart, table or kpi that uses it.

Charts: `chart KIND DATA [options]`. KIND is `line`, `area`, `bar` (vertical, grouped when several y columns) or `hbar` (horizontal; use for long category names or rankings).
```
chart line runs x=week y=deploys,rollbacks title="Deploys per week"
chart bar runs y=deploys labels
chart area runs stack
data cost = service,usd; Compute,18400; "Storage, S3",6100
chart hbar cost unit=$ title="Cost by service"
```
Options: `x=col` (default: first column), `y=col,col` (default: every numeric column), `title="..."`, `unit=ms` (or `$`, `%`, any suffix), `stack` (bar/hbar/area), `labels` (print values), `min=` / `max=` (axis range), `focus=col` (highlight one series, grey the rest). Cells must be plain numbers (no units inside cells; put the unit in `unit=`).

Tables:
```
table runs                                   (all columns)
table runs cols=week,deploys sort=-deploys limit=5 title="Busiest weeks"
table = option,cost,verdict; SQS,low,**chosen**; Kafka,high,overkill    (inline, one-off)
```
`sort=col` ascending, `sort=-col` descending. Cells may use inline markup.

Metric tiles: consecutive kpi lines form one row.
```
kpi Uptime | 99.97% | +0.02 pts | good
kpi p99 latency | 182 ms | -12% | good
kpi Cost | $41,200 | +8% | bad
kpi Deploys | =runs.deploys          (last value of a data column; delta computed)
```
Fields: label | value | change | tone (`good`, `bad`, `neutral`) or a short note. Tone colors the change; without it the change is neutral.

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
arch: group prod "Prod account" vpc
```
- Node: `id "Label" [kind] ["sub label"] [focus]`. Kind is a short lowercase tag shown on the box: user, svc, fn, db, queue, cache, lb, ext, store, team... Use `focus` on the 1–2 nodes that matter most. Undeclared ids become nodes labeled with the id.
- Edge: `a -> b : label`; `-->` dashed (async, reply, optional); `<->` both ways; chains `a -> b -> c`; fan-out `a -> b, c`. Keep labels short (≤ 3 words).
- Group: `group id "Label" members...`; members may be other group ids, which nests them (account > VPC > subnet).
- `dir=LR` (left to right) or `dir=TB` (top to bottom, default).

Sequence diagrams: `diagram NAME sequence`, then participants, messages in order, and notes.
```
diagram login sequence title="Login"
login: browser "Browser" user
login: app "Web app" svc
login: browser -> app : POST /login
login: note app : checks password
login: app --> browser : 302 + cookie
```

Layout:
```
image chart.png "Alt text describing it" caption="Optional caption"
grid 2            (the next 2 blocks sit side by side; `grid 3`, or `grid 2 count=4` for 4 blocks in 2 columns)
```

Rules: keywords (`data chart table kpi diagram image grid`) are lowercase and must start the line. Every name you reference must be declared above. Don't nest or indent. Prefer a chart for trends, a table for exact values, kpi tiles for headline numbers, a diagram for structure. Write the whole page in Lede only: no HTML unless nothing else can express it, no Markdown tables, no Mermaid.
</lede-reference>
