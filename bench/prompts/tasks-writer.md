You are writing 55 test tasks. A task is one request that a person makes of an assistant: "make me a page that ...". Each task has the brief (the request, with every name and number the page needs), a checklist of what the finished page must show, the kinds of content it needs, and one follow-up change. The briefs will be handed to writers who see only the brief and must make the page from it alone, so the brief has to hold everything the page needs.

Write 55 tasks, numbered 131 to 185: five for each of eleven categories, in this order.

- `architecture` (131 to 135): how a system, network, data pipeline or flow is built and how its parts connect: the structure, the order of events (the parts and their connections, or messages passed between named parts), and the details of each part.
- `comparison` (136 to 140): a decision page that sets two to four options side by side against stated criteria and a stated load or size, with the numbers that matter and a recommendation.
- `data` (141 to 145): a page that presents a set of figures, such as revenue by region, latency percentiles or survey results, so the reader sees levels, change over time and the outliers.
- `prose` (146 to 150): a page that is mostly written for a reader: an essay for a blog, a team charter, a welcome letter, an explanation. Headings and paragraphs carry it, with at most a few figures or a short list.
- `runbook` (151 to 155): operating instructions or an incident write-up: when to use it, the steps in order with who does them and by when, thresholds and contacts, and for an incident the timeline, the cause and the follow-ups.
- `status` (156 to 160): a periodic status report or dashboard: the headline numbers first, a trend over several weeks, a table by team or area, what needs attention, and what comes next.
- `specs-planning` (161 to 165): a page that sets out several genuinely different ways to build or do something, so the reader can compare them and choose: effort, running cost, risk, what would have to be undone if it fails, and a recommendation.
- `code-review` (166 to 170): a page that helps someone understand or review a change to code: a pull request description for busy reviewers, a review whose notes are each tied to the exact line they are about with a severity on each, or a check of how a configuration really behaves. If a brief pastes code, keep it short (at most 25 lines) and do not use JavaScript.
- `design` (171 to 175): a page for people who make interfaces: a reference sheet of design tokens (colors with hex values, type sizes, spacing steps) with each shown in use, several different visual looks for the same content side by side so a group can choose, or the timings of an animation set out so they can be judged and adjusted.
- `reports` (176 to 180): a report for readers who were not there: a status or results report, an incident report with a timeline and a cause, or an explanation of how a process moves work from step to step, with the branches and the places where it gets stuck.
- `custom-editing` (181 to 185): a page for a person who has to change something in a structured way and take the result away: a triage board that sorts a list of items into groups and puts them in order, a schedule or a settings file checked against its limits with conflicts flagged, or a message template with named blanks shown filled in with sample values. The page gives back something to paste somewhere else.

Each task is one JSON object in this shape.

{
  "id": "131-short-slug",
  "category": "architecture",
  "title": "A short page name",
  "brief": "...",
  "checklist": { "sections": ["..."], "visible": ["..."], "values": ["..."] },
  "needs": ["diagram", "table", "list"],
  "edit": { "request": "...", "expect_visible": [], "expect_values": ["..."], "expect_absent": ["..."] }
}

- `id`: the number, a hyphen and a short lowercase slug of the title with hyphens between words.
- `category`: one of the eleven names above, exactly as written.
- `title`: a short name for the page, three to six words, built on an organization, place or product you have made up.
- `brief`: the request, in the voice of the person who wants the page. Who they are, who will read the page and on what, every number, name and date the page needs, and the names of the sections in double quotes (write them as \" inside the JSON string). Between 700 and 1,800 characters; up to 2,500 when it pastes data, a log or a few lines of code. Write numbers without thousands separators (2486, not 2,486), and say "percent" in words in the brief as the examples do.
- `checklist.sections`: the headings the finished page must show. Each one is quoted in the brief.
- `checklist.visible`: names and labels that must appear as readable text on the page (people, places, items, column names), spelled as in the brief.
- `checklist.values`: numbers, dates and ids the finished page must contain, written exactly as in the brief. Include the figures of a chart's series and of the tables, as the examples do, up to 40 values.
- `needs`: what the page needs, two to five of these words and nothing else: `list` (bulleted or numbered items such as actions, risks or steps), `table` (rows and columns of values), `callout` (a highlighted warning or note), `chart` (numbers plotted, such as a trend over weeks, amounts compared, or spans on a timeline), `kpi` (a few headline numbers shown large), `diagram` (boxes and arrows for a structure or a flow), `sequence` (messages passing between named parts over time). The brief must really ask for each one it lists, with the data to draw it: a chart needs a series of at least five points, a diagram needs the parts and how they connect, a sequence needs the participants and the messages in order. Use `diagram` and `sequence` only when the brief describes a structure or an exchange between parts.
- `edit`: one follow-up change a person might ask for once they have seen the page. `request` is one or two sentences with the new values in them. `expect_visible` lists text that must be readable after the change (it may be empty). `expect_values` lists the new numbers, dates or ids that must be on the page. `expect_absent` lists the old text that must no longer be readable: choose a value that appears only in the place that changes.

Rules.

1. Fresh subjects, names and numbers. Invent every organization, place, person, product and figure. Do not reuse anything from the examples, and do not repeat a subject, a name or a set of numbers within your 55 tasks. Use dates in autumn 2026 for the present, as the examples do. No real companies.
2. No technology words. A brief never names a file format, a markup or styling language, a framework or any tool for building pages (for example HTML, CSS, Markdown, Mermaid, React, SVG, JavaScript), and never says how to build the page. It says what the reader needs to see and do.
3. Every brief says who reads the page and on what: on phones between meetings, projected in a review, printed for a committee, on a laptop at a desk.
4. Every brief stands alone. If it refers to a log, a table of settings, a list of items or a change to code, paste the content into the brief as plain text. Do not say "attached" or "below" without pasting it.
5. Ask for the real thing in plain words, as the person would. For `custom-editing` that means asking for a page where the items can be moved, the values changed within their limits, or the blanks filled, and for what comes out to be easy to paste elsewhere; for `code-review`, a review with the findings on the lines they are about; for `design`, the tokens or looks or timings themselves. Do not water these down and do not name any technology. The checklist and the edit still only list what a page, once opened, shows as text.
6. Vary the tasks: different roles, tones, sizes of page and openings. No two briefs begin the same way.
7. Each checklist item and each `edit` value appears in the brief, so a writer who reads the brief can satisfy it.

Output exactly 55 lines. Each line is one complete task as compact JSON on a single line, in order of id from 131 to 185. Write no code fence, no numbering and no commentary before or after. Read no file and run no command.

Ten finished examples follow. They are pretty-printed to be read; yours are one line each.
