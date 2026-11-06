You are writing 12 briefs. A brief is one request that a person makes of an assistant: "make me a page that ...". The briefs will be handed to writers who see only the brief and must make the page from it alone, so the brief has to hold everything the page needs.

Write 12 briefs, numbered 01 to 12, one for each topic below, in this order. A topic is a slug: lowercase words joined by hyphens. Read it as the subject of the page, the way a person would say it ("quarterly-sales-recap" is a page that recaps a quarter of sales).

{{SLUGS}}

Each brief is one JSON object in this shape.

{
  "id": "{{STEM}}-01",
  "category": "the-topic-slug",
  "brief": "..."
}

- `id`: `{{STEM}}`, a hyphen and the two-digit number of the topic, 01 to 12.
- `category`: the topic's slug, exactly as written above.
- `brief`: the request, in the voice of the person who wants the page. One paragraph of 900 to 1,300 characters with no line break inside it. Who they are, who will read the page and on what, every number, name and date the page needs, and what the reader should be able to see, do or decide.

Rules.

1. Fresh subjects, names and numbers. Invent every organization, place, person, product and figure. Do not reuse anything from the examples, and do not repeat a subject, a name or a set of numbers within your 12 briefs. Use dates in autumn 2026 for the present, as the examples do. No real companies.
2. No technology words. A brief never names a file format, a markup or styling language, a framework or any tool for building pages (for example HTML, CSS, Markdown, Mermaid, React, SVG, JavaScript), never names a feature of one, and never says how to build the page. It says what the reader needs to see and do, in plain words.
3. Every brief says who reads the page and on what: on phones between meetings, projected in a review, printed for a committee, on a laptop at a desk, opened from a link someone pasted into a chat.
4. Every brief stands alone. If it refers to a table of figures, a list, a block of text or a piece of code, paste the content into the brief as plain text. Do not say "attached" or "below" without pasting it. A pasted piece of code is at most 25 lines and is not JavaScript.
5. Ask for the real thing in plain words, as the person would, whatever the topic needs the page to do: show, compare, decide, review, fill in, step through. Give the concrete details they would have to hand: exact values, names and dates; a colour as a name and a hex code; the language the page is to be written in; the one sentence that should describe the page when its link is shared; which line of a pasted piece of code a remark is about; what goes in an appendix and what the reader may skip. Do not water the topic down and do not suggest how the page is made.
6. A topic that names a language is still briefed in English: the brief asks for the page in that language, and gives in that language only the words the page itself must show.
7. Vary the briefs: different roles, tones, sizes of page and openings. No two briefs begin the same way.

Two finished examples follow, for other topics. They show the voice and the level of detail, not subjects to reuse.

[
  {
    "id": "r2-07",
    "category": "reports",
    "brief": "Write the weekly status report for our sequencing core lab, week ending 2026-10-16, for the PI and our two funders. Instrument data (columns: Instrument, Runs completed, Samples processed, Failed QC, Downtime (hrs)): NovaSeq 6000, 7, 1,296, 41, 6.5. MiSeq, 12, 288, 9, 0. Bioanalyzer, 31, 372, 14, 2.0. Qubit, 18, 1,104, 3, 0. Notes from the team: \"NovaSeq lane 3 flow cell error Tuesday; reran, no data loss per vendor\". \"Freezer B alarm Thu 02:10, temp reached -62°C, back to -80 by 05:40; samples intact, confirmed by Dr. Okafor\". Average turnaround was 4.8 days against a target of 5; last week it was 5.6. Backlog is 214 samples waiting, oldest is 9 days old (target: nothing over 5). Library prep kits: 3 left, reorder PO #4471 arrives Oct 22; if it slips past Oct 25 we stop accepting new plates. Next week: MiSeq maintenance Tuesday (4 hrs), onboarding two new users from the Hartwell group. Lead with what the readers need to act on."
  },
  {
    "id": "r2-01",
    "category": "specs-planning",
    "brief": "We run refrigerated deliveries out of one depot in Rotterdam and I need to decide how to handle the 14:00 order cutoff. Make me a page that sets out three ways to implement it so I can compare them and pick one for Monday's planning meeting. Option A: keep the nightly batch planner and add a second run at 13:30. Effort 3 days, about €400/month extra compute, orders that miss 13:30 still wait until the next day. Option B: replace the batch with incremental re-routing every 10 minutes. Effort 4 weeks, €2,850/month, estimated 11% fewer km driven (we drive 18,400 km/week now), risk is that drivers see their routes change mid-shift. Option C: buy the vendor's dynamic dispatch module. 6 weeks to integrate, €6,200/month plus €15,000 setup, 14% fewer km, locks us into their API, 24-month contract. For each option I want effort, running cost, km saved per week, the main risk, and what we would have to undo if it fails. Finish with your recommendation and the one number that would flip it."
  }
]

Output exactly one JSON array holding the 12 objects in order of id, pretty-printed with two-space indentation as in the examples. Write no code fence, no numbering and no commentary before or after. Read no file and run no command.
