#!/usr/bin/env node
// lede-mcp: an MCP server over stdio. Tools lede_check, lede_compile and lede_spec; the model reference as lede://spec/model.
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { build, check, InputError, realRoot, specText, type Report, type Root } from './tools.ts';

const HELP = `lede-mcp [--root <dir>]

An MCP server over stdio for Lede. Tools: lede_check, lede_compile, lede_spec. Resource: lede://spec/model.
  --root <dir>   let \`data x < file.csv\` read files, from this directory tree only (symlinks resolved).
                 Without it, file data is refused.
Raw html is always sanitized, remote resources are never emitted, there is no --shell, and no tool writes a file.
`;

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const text = (t: string, rest: Partial<Result> = {}): Result => ({ content: [{ type: 'text', text: t }], ...rest });
const json = (r: Report): Result => text(JSON.stringify(r, null, 2), { structuredContent: { ...r } });

/** A refused input is a tool error the model can read, never a crash. */
async function guarded(run: () => Result | Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof InputError) return text(e.message, { isError: true });
    return text(`lede-mcp: ${e instanceof Error ? e.message : String(e)}`, { isError: true });
  }
}

export function createServer(root: Root): McpServer {
  const server = new McpServer({ name: 'lede', version });

  server.registerTool(
    'lede_check',
    {
      title: 'Check a Lede page',
      description:
        'Parse Lede source and return its diagnostics (severity, code, message, line, col), the shape of `lede check --json`, and ok: true when none is an error.',
      inputSchema: { source: z.string().describe('The Lede source text of one page') },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ source }) => guarded(() => json(check(source, root))),
  );

  server.registerTool(
    'lede_compile',
    {
      title: 'Compile a Lede page to HTML',
      description:
        'Compile Lede source to one self-contained HTML page with no script, returned as text; nothing is written to disk. Raw html blocks are sanitized and remote resources are not emitted. With artifact: true, only title, style and main, for the Claude Artifact tool. When the source has errors the diagnostics are returned and no HTML.',
      inputSchema: {
        source: z.string().describe('The Lede source text of one page'),
        artifact: z.boolean().optional().describe('Write only <title>, <style> and <main>, as `lede build --artifact` does'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ source, artifact }) =>
      guarded(async () => {
        const r = await build(source, root, artifact === true);
        if (r.html === undefined) return { ...json(r), isError: true };
        return text(r.html, { structuredContent: { ok: r.ok, diagnostics: r.diagnostics } });
      }),
  );

  server.registerTool(
    'lede_spec',
    {
      title: 'Lede model reference',
      description: 'The text of the Lede reference a model reads before writing a page.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => guarded(() => text(specText())),
  );

  server.registerResource(
    'model-spec',
    'lede://spec/model',
    { title: 'Lede model reference', description: 'The same text as the lede_spec tool.', mimeType: 'text/markdown' },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: specText() }] }),
  );

  return server;
}

async function main(argv: string[]): Promise<void> {
  let root: Root = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return void process.stdout.write(HELP);
    if (a === '--version' || a === '-v') return void process.stdout.write(`${version}\n`);
    if (a === '--root' || a.startsWith('--root=')) {
      const dir = a === '--root' ? argv[++i] : a.slice('--root='.length);
      if (!dir) throw new Error('--root needs a directory');
      root = realRoot(dir);
    } else throw new Error(`unknown argument ${a}`);
  }
  await createServer(root).connect(new StdioServerTransport());
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`lede-mcp: ${e instanceof Error ? e.message : String(e)}\n${HELP}`);
    process.exitCode = 2;
  });
}
