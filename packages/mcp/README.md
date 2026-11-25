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

## What it costs to run

The server runs locally, as a child process of your MCP client, over stdio. It needs no hosting, no network and no account: nothing
listens on a port. It has no third-party protocol dependency: the stdio JSON-RPC loop is written by hand (about 300 lines,
`src/server.ts`), and the package depends only on the other three Lede packages.

What it costs the model is the size of what the client loads when it connects. The `tools/list` response is 1,591 bytes (the whole
JSON-RPC line, measured by `test/protocol.test.ts`), which is roughly 400 tokens. That token figure is an estimate, bytes divided
by 4, not a count: no tokenizer was run on it. The tool descriptions are the whole of it; `lede_spec` and the resource add the
model reference (see `spec/model-spec.md`) only when the model asks for it.

Protocol revisions answered: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07, the list in the MCP TypeScript SDK
1.32.2. `initialize` answers with the client's revision when it is one of these, and with 2025-11-25 otherwise.

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

The package is private (`"private": true`); the owner publishes it. It builds like the other three (`pnpm build` writes `dist/`,
and `publishConfig` points the packed package at it), and it imports the CLI's confinement as `@lede-lang/cli/confine`. What is
left:

- Try it in a real client. The Claude Code route in "Install" was tried against the earlier SDK-based server; the hand-written
  loop has been driven only by this package's tests (raw JSON-RPC over stdio), not by Claude Code, Claude Desktop or Cursor.
- Add it to `scripts/pack.ts` (`PACKAGES`, after `cli`, which it depends on) and to `test/pack.test.ts`, so that the release
  workflow packs and publishes it and `pnpm test:pack` installs it. Until then neither does, and `scripts/set-version.ts` keeps
  it at the shared version through its own entry.
- Publish it to npm (the owner's step, 2FA), then list it in the MCP registry.

## What it does not do

It does not serve over HTTP, watch files, fix pages (`lede check --fix`), inline local images, take a `--theme`, or write output
anywhere. For those use the [`lede` CLI](https://www.npmjs.com/package/@lede-lang/cli).

Apache-2.0. An early 0.x release: it will change.
