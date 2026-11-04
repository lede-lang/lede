# @lede-lang/html

The HTML renderer for [Lede](https://ledelang.dev), a line-oriented page format that AI models write instead of HTML. It compiles
a document to one self-contained page with charts, diagrams, light and dark themes and a phone layout. The page has no
JavaScript and fetches nothing remote unless you ask, and output is sanitized. `shell: true` is the one exception: for a page
that asks questions it adds one fixed script, pinned by hash in the page's policy; `RUNTIME` and `RUNTIME_SHA256` are exported for hosts
that write their own policy.

```sh
npm install @lede-lang/html       # Node 22.12 or later; brings @lede-lang/core, the parser
```

```js
import { compile } from '@lede-lang/html';

const { html, doc } = await compile('# Hello\n\nkpi Uptime | 99.97% | +0.02 pts | good');
```

Rendering is async because diagram layout (elkjs) is. The layout engine is loaded when the first flow diagram is laid out, so
a page without one never fetches or evaluates it; `setLayoutEngine(fn)` replaces it (for example with a Web Worker). For a
command line, use [`@lede-lang/cli`](https://www.npmjs.com/package/@lede-lang/cli).

### Incremental rendering

`createIncremental` renders a page while it is being written. Feed it the events of a `LedeStream` from
[`@lede-lang/core`](https://www.npmjs.com/package/@lede-lang/core) and apply the operations it returns to a `<main class="doc">`.
Each operation carries the HTML of one unit (a block, or a run of sections shown as cards); nothing is rendered twice unless
something that unit depends on changed.

```js
import { LedeStream } from '@lede-lang/core';
import { createIncremental } from '@lede-lang/html';

const stream = new LedeStream();
const inc = createIncremental(() => stream.doc.meta, () => stream.doc.data);
const apply = (ops) => ops.forEach(show); // append, replace, remove, tail, prose, masthead, placeholder, style
let drawings = Promise.resolve(); // flow drawings are applied one after another, in the order they were returned
const take = ({ ops, pending }) => {
  apply(ops);
  if (pending) drawings = drawings.then(() => pending).then(apply);
};
const handle = (e) => {
  if (e.kind === 'block') take(inc.push(e.block));
  else if (e.kind === 'seal') take(inc.seal(e.block));
  else take(inc.update('data' in e ? { data: e.data } : e.block)); // a diagram or bucket set that grew, or rows appended
};

for await (const chunk of modelOutput) {
  stream.events(chunk).forEach(handle);
  apply(inc.tail(stream.tail())); // the blocks still being written
}
stream.end(handle);
const done = await inc.end();
await drawings;
apply(done.ops);
```

A drawing that resolves early waits for the ones before it, so units stay in source order. Question words (`ask`, `choose`,
`confirm`, `export`) and editor words (`param`, `toggle`, `template`, `preset`) are blocks of their own and are drawn as `render()`
draws them; a `bucket` set is drawn again in place (`update`) as each item line arrives, and an open `template` fence is shown in
the tail with the text so far. An `export` lists every field of the page, so it is drawn again in place when a field, a bucket item
or the title arrives after it. The `shell` option has no effect on this form.
`end()` compares the page with the whole-page render and corrects what differs (`settle: false` reports without correcting,
which is how the tests measure the incremental path itself). Pages built by `compile` and `render` stay script-free; this
form only produces HTML for a host that applies it.

- Site, reference and playground: https://ledelang.dev
- Source, specification and issues: https://github.com/lede-lang/lede
- Apache-2.0. An early 0.x release: it will change.
