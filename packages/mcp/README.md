# @lede-lang/mcp

An [MCP](https://modelcontextprotocol.io) server for [Lede](https://ledelang.dev), the line-oriented page format models write
instead of HTML. It gives an MCP client three tools and one resource, over stdio:

| Name | What it does |
| --- | --- |
| `lede_check` | Input `source`. Returns `{ ok, diagnostics }`; each diagnostic has the shape of `lede check --json` (severity, code, message, line, col). |
| `lede_compile` | Input `source` and optional `artifact` (as `lede build --artifact`). Returns one self-contained HTML page with no script, as text. A page with errors returns its diagnostics and no HTML. Nothing is written to disk. |
| `lede_spec` | No input. Returns the model reference, the text a model reads before writing Lede. |
| `lede://spec/model` | The same text as a resource. |

The resource is named for what it holds, the model reference, and not for the format version, so it does not read as the full
`spec/lede-0.1.md`.

## Install

This package is not published yet. Every `npx -y @lede-lang/mcp` below applies once it is; from a checkout, run
`pnpm install` and use `node /path/to/lede/packages/mcp/src/server.ts` (Node 22.18 or later) in place of `npx -y @lede-lang/mcp`.

Claude Code (tested from a checkout: `claude mcp add` then `claude mcp list` showed the server connected):

```sh
claude mcp add lede -- npx -y @lede-lang/mcp
```

or in `.mcp.json` (the form `claude mcp add --scope project` writes):

```json
{ "mcpServers": { "lede": { "type": "stdio", "command": "npx", "args": ["-y", "@lede-lang/mcp"] } } }
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`) take the same entry. Untested:

```json
{ "mcpServers": { "lede": { "command": "npx", "args": ["-y", "@lede-lang/mcp"] } } }
```

To let pages read CSV files, add `--root <dir>` to the arguments, for example `"args": ["-y", "@lede-lang/mcp", "--root", "/path/to/data"]`.

## Security defaults

None of these can be changed by a tool input; the input schemas have no such field.

- Raw `html` blocks are sanitized. The CLI's `--unsafe-html` is not available.
- Remote resources are never emitted. `--allow-remote` is not available.
- `--shell` is not available: a compiled page has no script.
- `data x < file.csv` is refused unless the server was started with `--root <dir>`. With it, a path must stay inside that tree, with
  symlinks resolved on both sides (the CLI's own confinement code), and a file is read only up to 5 MB.
- No tool writes a file. Every tool is marked read-only.
- `source` is limited to 1 MB (1,048,576 bytes of UTF-8); a larger one is refused with an error that says so.
- A page with errors is an answer, not a crash: the diagnostics come back and the server keeps running.

## Before publishing

The package is private (`"private": true`) and cannot be packed as it stands:

- `src/tools.ts` imports the CLI's path confinement by relative path, `../../cli/src/confine.ts`, which is not inside this package
  and would not be in its tarball. Either export it from a published package (a Node-only subpath such as
  `@lede-lang/cli/confine`, built to `dist/` like the rest of the CLI) and import it by name, or have this package's build bundle
  that one file into its own `dist/`. Keep one copy of the confinement code either way.
- There is no build: no `tsconfig.build.json`, and `pnpm build` does not reach this package, so the `dist/server.js` that
  `publishConfig.bin` names is never written. Node does not strip types under `node_modules`, so the `src/` entry cannot ship.
- `scripts/pack.ts` (`PACKAGES`) and the release workflow publish only the three other packages; add this one there and to
  `pnpm test:pack` when it goes out.
- The MCP SDK brings about 90 packages (express and hono among them, for transports this server does not use). A hand-written
  stdio JSON-RPC loop for the six methods this server answers would have none; decide before publishing.

## What it does not do

It does not serve over HTTP, watch files, fix pages (`lede check --fix`), inline local images, take a `--theme`, or write output
anywhere. For those use the [`lede` CLI](https://www.npmjs.com/package/@lede-lang/cli).

Apache-2.0. An early 0.x release: it will change.
