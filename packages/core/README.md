# @lede-lang/core

The parser for [Lede](https://ledelang.dev), a line-oriented page format that AI models write instead of HTML. Lines in, a typed
document and diagnostics out. It also streams: `LedeStream` takes model output as it arrives and returns each finished block.

```sh
npm install @lede-lang/core       # Node 22.12 or later
```

```js
import { parse, fix } from '@lede-lang/core';

const doc = parse('# Hello\n\nkpi Uptime | 99.97% | +0.02 pts | good');
doc.blocks;        // typed blocks
doc.diagnostics;   // each has a line, a column, a code and sometimes a machine-readable `detail`

const { src, applied, remaining } = fix('table t\n...');   // repaired text, what changed, what is left
```

`fix` repairs a source text from its diagnostics.

To show a page while it is being written, feed the stream chunks. `events` returns what became final and what changed in
blocks already returned (a diagram or a bucket set that gained a line, rows appended to a data set, a diagram or set that is
complete); `tail` returns the block still being written, without ending the document:

```js
import { LedeStream } from '@lede-lang/core';

const s = new LedeStream();
for await (const chunk of modelOutput) {
  for (const e of s.events(chunk)) {
    // e.kind is 'block' (e.block is final), 'update' (e.block is a diagram or bucket set that grew, or e.data names a
    // data set that gained rows) or 'seal' (e.block is a diagram or bucket set nothing more is expected for)
  }
  show(s.tail());       // the open paragraph, list, kpi row, fence (a template's, as the template), grid or cards run, as blocks
}
const doc = s.end(); // the blocks it finishes are doc.blocks after those `events` returned; end((e) => …) gives their events
```

`s.doc` is the document being built (meta, data and diagnostics so far), live, for a viewer to read. `snapshot()` re-parses
everything and is for a preview that redraws the whole page each time.

To turn a document into a page, use
[`@lede-lang/html`](https://www.npmjs.com/package/@lede-lang/html); to run it from a shell, use
[`@lede-lang/cli`](https://www.npmjs.com/package/@lede-lang/cli).

- Site, reference and playground: https://ledelang.dev
- Source, specification and issues: https://github.com/lede-lang/lede
- Apache-2.0. An early 0.x release: it will change.
