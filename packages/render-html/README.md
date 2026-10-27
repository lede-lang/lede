# @lede-lang/html

The HTML renderer for [Lede](https://ledelang.dev), a line-oriented page format that AI models write instead of HTML. It compiles
a document to one self-contained page with charts, diagrams, light and dark themes and a phone layout. The page has no
JavaScript and fetches nothing remote unless you ask, and output is sanitized.

```sh
npm install @lede-lang/html       # Node 22.12 or later; brings @lede-lang/core, the parser
```

```js
import { compile } from '@lede-lang/html';

const { html, doc } = await compile('# Hello\n\nkpi Uptime | 99.97% | +0.02 pts | good');
```

Rendering is async because diagram layout (elkjs) is. For a command line, use
[`@lede-lang/cli`](https://www.npmjs.com/package/@lede-lang/cli).

- Site, reference and playground: https://ledelang.dev
- Source, specification and issues: https://github.com/lede-lang/lede
- Apache-2.0. An early 0.x release: it will change.
