# Lede reference: callout kinds, prose tables and decisions
Three page words beyond the core reference: a kind on a `!` note, a table written one row per line, and a decision record.

Callouts: a `!` note that starts with a kind word and a colon takes that kind and its colour, so a recommendation does not
look like an outage. Kinds: `Recommendation`, `Decision`, `Success`, `Tip`, `Info`, `Question`, `Example`. Keep `!!` for a
warning and `!!!` for an outage or data loss.
```
! Recommendation: Move order events to SQS this quarter.
! Tip: Run check before every build.
```

Prose tables: when cells hold commas or semicolons, write the header with `|` and then one `: ` row per line; nothing
needs quotes. A declared data set takes rows the same way, as `NAME: a | b | c`.
```
table title="Options" = Option | Cost | Verdict
: SQS | low, managed | **chosen**
: Kafka | high; needs a team | overkill
```

Decisions: declare the question, then add options, open questions and who settles it, each line prefixed with the name.
`status=` is `open`, `settled` or `deferred`; an option's last field is `chosen` or `rejected`.
```
decision queue "Which queue carries order events?" status=settled by=2026-12-01
queue: option sqs "SQS" | managed, 14-day retention | chosen
queue: option kafka "Kafka" | replay, ops cost | rejected
queue: question "Do we need replay beyond 14 days?" | no
queue: role decides "Ana Ruiz"
queue: role consulted "Platform team"
```
Rules: one decision per question; name the person who decides. Use a callout kind for a single recommendation and a
decision block when the options and owners matter.
<!-- teaches: callout kinds, pipe rows, decision -->
