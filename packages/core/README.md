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

`fix` repairs a source text from its diagnostics. To turn a document into a page, use
[`@lede-lang/html`](https://www.npmjs.com/package/@lede-lang/html); to run it from a shell, use
[`@lede-lang/cli`](https://www.npmjs.com/package/@lede-lang/cli).

- Site, reference and playground: https://ledelang.dev
- Source, specification and issues: https://github.com/lede-lang/lede
- Apache-2.0. An early 0.x release: it will change.
