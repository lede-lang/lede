# Lede reference: pages of tabs
One page built from several Lede files, a tab each, so each section can be written, checked and reviewed on its own.

Split the work: each writer writes one section as a whole page in its own file and runs `lede check` on it. Then one short file, the
manifest, holds the page's own keys, an optional lead and one tab line per section, and `lede build` on it makes the page.
```lede
@title Q4 platform review
@fonts clean

What we spent, what could break, and what we are changing.

tab Overview < overview.lede
tab Costs < costs.lede #9f2c41d07ab3
tab < risks.lede
```
A tab line is `tab`, a label, the arrow shown and a `.lede` path in the same folder or below it. With no label the tab takes the
section's `@title`. Nothing but tab lines and `@` lines may follow the first tab line. The manifest's title, palette and fonts style
every tab, so leave `@accent`, `@fonts` and `@theme` out of the sections; give each section its own `@title`, and a `@meta` line for
its writer or review date. Keep question names different across tabs. At most 12 tabs.

`lede build` prints each tab's hash. Once a section is reviewed, write its hash after it, as on the Costs line: if that file changes
later, the build stops until someone reviews it and moves the hash. A link to another tab is its label in lower case with dashes,
`[the costs](#costs)`.
<!-- teaches: tab -->
