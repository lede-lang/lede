Write the page as one JSON document in the Page UI format below. Output the JSON and nothing else: no code fence, no commentary, no comments inside the JSON. It must parse with JSON.parse. A renderer turns it into a styled page, so write content only: no colors, sizes, CSS or HTML.

<page-ui-schema>
Root object: {"page": {"title": string, "subtitle"?: string, "author"?: string, "date"?: string, "sections": [Section, ...]}}

Section: {"heading": string, "level"?: 1 | 2 | 3 (default 2), "blocks": [Block, ...]}
A Block is an object whose "type" is one of these, with the fields shown ("?" means optional):

- {"type":"text", "text": string}  a paragraph; **bold**, *italic*, `code` and [label](https://url) are allowed inside the string
- {"type":"list", "items": [string, ...], "ordered"?: boolean}
- {"type":"kpi", "tiles": [{"label": string, "value": string, "note"?: string, "trend"?: "up" | "down" | "flat"}, ...]}  headline number tiles
- {"type":"table", "columns": [string, ...], "rows": [[string | number, ...], ...], "align"?: ["left" | "right", ...]}  each row has exactly as many cells as columns
- {"type":"chart", "kind": "line" | "bar" | "pie", "title"?: string, "unit"?: string, "series": [{"name": string, "points": [{"x": string, "y": number}, ...]}, ...]}  a pie has one series; each point is a slice
- {"type":"callout", "tone": "note" | "warning" | "critical", "text": string}
- {"type":"steps", "items": [{"title": string, "detail"?: string, "when"?: string}, ...]}  ordered actions or a timeline
- {"type":"cards", "items": [{"title": string, "text": string, "tag"?: string}, ...]}  parallel options shown side by side
- {"type":"diagram", "kind": "flow" | "sequence", "nodes": [{"id": string, "label": string, "group"?: string}, ...], "edges"?: [{"from": string, "to": string, "label"?: string}, ...]}  for a flow give nodes and edges (edge ends are node ids; group names a box drawn around nodes); for a sequence give nodes as the participants in order and edges as the messages in order
- {"type":"code", "language"?: string, "text": string}
</page-ui-schema>

Rules:
- Every block has a "type" from the list above and only the fields shown for it; leave out an optional field rather than writing null or an empty string.
- Numbers in "y" and in table cells are JSON numbers when the brief gives a plain number (write 1450, not "$1,450"); use a string when the value carries a unit, a currency sign, a percent sign or a range, and say the unit once in "unit" for a chart.
- Table rows must be rectangular: every row has exactly as many cells as there are columns. A chart series has at least two points; a pie has one series.
- Diagram edge ends must be ids of nodes that exist; give each node a short unique id (letters and digits). Put each box a group would draw around nodes in "group" on those nodes.
- Section "level" is 2 unless the brief asks for a sub-section, which is 3. The first section's heading is the first heading the brief asks for; the page "title" is the page's own title.
- Dates are written as the brief gives them. Do not invent facts, numbers or names that the brief does not contain.

Longer example, one section of each of several block types:
{"page":{"title":"Orders platform","subtitle":"Reviewed 2026-09-30","sections":[{"heading":"Overview","blocks":[{"type":"text","text":"Orders enter at the **API gateway** and are stored in the primary database."}]},{"heading":"Architecture","blocks":[{"type":"diagram","kind":"flow","nodes":[{"id":"gw","label":"API Gateway","group":"Edge"},{"id":"svc","label":"Order Service","group":"Core"},{"id":"db","label":"Primary DB","group":"Core"}],"edges":[{"from":"gw","to":"svc","label":"HTTPS"},{"from":"svc","to":"db","label":"SQL"}]}]},{"heading":"Options","blocks":[{"type":"cards","items":[{"title":"Build","text":"Own the code; 6 months.","tag":"slower"},{"title":"Buy","text":"Vendor product; 6 weeks.","tag":"faster"}]},{"type":"table","columns":["Option","Cost per year"],"rows":[["Build",120000],["Buy","$90,000 plus seats"]],"align":["left","right"]}]},{"heading":"Rollout","blocks":[{"type":"steps","items":[{"title":"Canary","detail":"5% of traffic","when":"Mon 12 Oct"},{"title":"Full rollout","when":"Wed 14 Oct"}]},{"type":"callout","tone":"warning","text":"Roll back if the error rate passes 1%."}]}]}}

Short example:
{"page":{"title":"Weekly status","sections":[{"heading":"Highlights","blocks":[{"type":"kpi","tiles":[{"label":"Deploys","value":"47","trend":"up"}]},{"type":"chart","kind":"bar","unit":"PRs","series":[{"name":"Merged","points":[{"x":"W40","y":129},{"x":"W41","y":132}]}]},{"type":"callout","tone":"note","text":"Staging is live."}]}]}}

Write every fact, number and name the brief gives, in the block type that suits it best: tiles for headline numbers, tables for rows, charts for series, steps for ordered actions, cards for parallel options, diagrams for structure and flows. Write the document once.
