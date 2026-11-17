#!/usr/bin/env node
// lede-mcp: an MCP server over stdio, with no SDK: newline-delimited JSON-RPC 2.0 on stdin and stdout (the MCP stdio transport).
// Tools lede_check, lede_compile and lede_spec; the model reference as lede://spec/model. Stdout carries protocol messages only.
import { readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { build, check, InputError, realRoot, specText, type Report, type Root } from './tools.ts';

const HELP = `lede-mcp [--root <dir>]

An MCP server over stdio for Lede. Tools: lede_check, lede_compile, lede_spec. Resource: lede://spec/model.
  --root <dir>   let \`data x < file.csv\` read files, from this directory tree only (symlinks resolved).
                 Without it, file data is refused.
Raw html is always sanitized, remote resources are never emitted, there is no --shell, and no tool writes a file.
`;

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** MCP revisions this server speaks, newest first: the SDK's own list (@modelcontextprotocol/sdk 1.32.2, src/types.ts). */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'] as const;

/** The longest single line read from stdin, in bytes; a 1 MB source escapes to at most about 6 MB of JSON. */
const MAX_LINE_BYTES = 16 * 1024 * 1024;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const RESOURCE_NOT_FOUND = -32002;

type Id = string | number;
type Obj = Record<string, unknown>;
type Response = { jsonrpc: '2.0'; id: Id | null } & ({ result: unknown } | { error: { code: number; message: string } });

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface Result {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const text = (t: string, rest: Partial<Result> = {}): Result => ({ content: [{ type: 'text', text: t }], ...rest });
const json = (r: Report): Result => text(JSON.stringify(r, null, 2), { structuredContent: { ...r } });

/** The subset of JSON Schema the tools use: an object of string and boolean properties, no others allowed. */
interface InputSchema {
  type: 'object';
  properties: Record<string, { type: 'string' | 'boolean'; description: string }>;
  required?: string[];
  additionalProperties: false;
}

const SOURCE = { type: 'string', description: 'The Lede source text of one page' } as const;
const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

const TOOLS: { name: string; title: string; description: string; inputSchema: InputSchema; annotations: typeof ANNOTATIONS }[] = [
  {
    name: 'lede_check',
    title: 'Check a Lede page',
    description:
      'Parse Lede source and return its diagnostics (severity, code, message, line, col), the shape of `lede check --json`, and ok: true when none is an error.',
    inputSchema: { type: 'object', properties: { source: SOURCE }, required: ['source'], additionalProperties: false },
    annotations: ANNOTATIONS,
  },
  {
    name: 'lede_compile',
    title: 'Compile a Lede page to HTML',
    description:
      'Compile Lede source to one self-contained HTML page with no script, returned as text; nothing is written to disk. Raw html blocks are sanitized and remote resources are not emitted. With artifact: true, only title, style and main, for the Claude Artifact tool. When the source has errors the diagnostics are returned and no HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        source: SOURCE,
        artifact: { type: 'boolean', description: 'Write only <title>, <style> and <main>, as `lede build --artifact` does' },
      },
      required: ['source'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS,
  },
  {
    name: 'lede_spec',
    title: 'Lede model reference',
    description: 'The text of the Lede reference a model reads before writing a page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ANNOTATIONS,
  },
];

const RESOURCE = {
  uri: 'lede://spec/model',
  name: 'model-spec',
  title: 'Lede model reference',
  description: 'The same text as the lede_spec tool.',
  mimeType: 'text/markdown',
};

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks `args` against the schema the tool advertises; returns the first problem, or null. */
function invalid(schema: InputSchema, args: Obj): string | null {
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(schema.properties, key)) return `unknown argument "${key}"; this tool takes ${describeKeys(schema)}`;
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) return `${key} is required`;
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = args[key];
    if (v !== undefined && typeof v !== prop.type) return `${key} must be a ${prop.type}`;
  }
  return null;
}

const describeKeys = (s: InputSchema) => (Object.keys(s.properties).length ? Object.keys(s.properties).join(', ') : 'no arguments');

/** A refused input is a tool error the model can read, never a crash. */
async function guarded(run: () => Result | Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof InputError) return text(e.message, { isError: true });
    return text(`lede-mcp: ${e instanceof Error ? e.message : String(e)}`, { isError: true });
  }
}

function callTool(root: Root, params: Obj): Promise<Result> | Result {
  const name = params.name;
  if (typeof name !== 'string') throw new RpcError(INVALID_PARAMS, 'tools/call needs a string name');
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new RpcError(INVALID_PARAMS, `unknown tool: ${name}`);
  const args = params.arguments ?? {};
  if (!isObj(args)) throw new RpcError(INVALID_PARAMS, 'arguments must be an object');
  const problem = invalid(tool.inputSchema, args);
  if (problem !== null) return text(`${name}: ${problem}`, { isError: true });
  const source = args.source;
  switch (name) {
    case 'lede_check':
      return guarded(() => json(check(source, root)));
    case 'lede_compile':
      return guarded(async () => {
        const r = await build(source, root, args.artifact === true);
        if (r.html === undefined) return { ...json(r), isError: true };
        return text(r.html, { structuredContent: { ok: r.ok, diagnostics: r.diagnostics } });
      });
    default:
      return guarded(() => text(specText()));
  }
}

function initialize(params: Obj): unknown {
  const asked = params.protocolVersion;
  if (typeof asked !== 'string') throw new RpcError(INVALID_PARAMS, 'initialize needs a string protocolVersion');
  const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
  return { protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'lede', version } };
}

/** The result of one request; throws an `RpcError` for a protocol error. */
async function dispatch(root: Root, method: string, params: Obj): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return initialize(params);
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      return await callTool(root, params);
    case 'resources/list':
      return { resources: [RESOURCE] };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'resources/read': {
      if (typeof params.uri !== 'string') throw new RpcError(INVALID_PARAMS, 'resources/read needs a string uri');
      if (params.uri !== RESOURCE.uri) throw new RpcError(RESOURCE_NOT_FOUND, `resource not found: ${params.uri}`);
      return { contents: [{ uri: RESOURCE.uri, mimeType: RESOURCE.mimeType, text: specText() }] };
    }
    default:
      throw new RpcError(METHOD_NOT_FOUND, `method not found: ${method}`);
  }
}

const fail = (id: Id | null, code: number, message: string): Response => ({ jsonrpc: '2.0', id, error: { code, message } });

/** One decoded JSON-RPC message in, the response out; `undefined` for a notification or a response from the client (never answered). */
async function handleOne(root: Root, msg: unknown): Promise<Response | undefined> {
  if (!isObj(msg)) return fail(null, INVALID_REQUEST, 'a message must be a JSON object');
  const hasId = Object.hasOwn(msg, 'id');
  const rawId = msg.id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
  if (hasId && id === null && typeof msg.method === 'string') return fail(null, INVALID_REQUEST, 'id must be a string or a number');
  if (typeof msg.method !== 'string') {
    // A result or an error from the client answers a request this server never sent; ignore it. Anything else is malformed.
    if (hasId && ('result' in msg || 'error' in msg)) return undefined;
    return fail(id, INVALID_REQUEST, 'a request needs a string method');
  }
  if (!hasId) return undefined;
  if (msg.jsonrpc !== '2.0') return fail(id, INVALID_REQUEST, 'jsonrpc must be "2.0"');
  const params = msg.params ?? {};
  if (!isObj(params)) return fail(id, INVALID_PARAMS, 'params must be an object');
  try {
    return { jsonrpc: '2.0', id, result: await dispatch(root, msg.method, params) };
  } catch (e) {
    if (e instanceof RpcError) return fail(id, e.code, e.message);
    process.stderr.write(`lede-mcp: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return fail(id, INTERNAL_ERROR, 'internal error');
  }
}

/**
 * One line of stdin to the line to write back, or `undefined` for none. A batch (an array) is answered with an array of the
 * responses it earns, as the 2025-03-26 revision requires; later revisions dropped batches, and a client then never sends one.
 */
export async function handleLine(root: Root, line: string): Promise<string | undefined> {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return JSON.stringify(fail(null, PARSE_ERROR, 'parse error: the line is not valid JSON'));
  }
  if (Array.isArray(msg)) {
    if (msg.length === 0) return JSON.stringify(fail(null, INVALID_REQUEST, 'an empty batch'));
    const out = (await Promise.all((msg as unknown[]).map((m) => handleOne(root, m)))).filter((r) => r !== undefined);
    return out.length ? JSON.stringify(out) : undefined;
  }
  const r = await handleOne(root, msg);
  return r ? JSON.stringify(r) : undefined;
}

/** Reads newline-delimited messages from `input` and writes each response as one line to `output`, in request order. */
export function serve(root: Root, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
  return new Promise((done) => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let pendingBytes = 0;
    let skipping = false; // inside a line longer than the cap: drop it up to the next newline
    const work: (() => Promise<string | undefined> | string | undefined)[] = [];
    let draining = false;
    let ended = false;
    // Answers in request order, one at a time.
    const drain = async () => {
      if (draining) return;
      draining = true;
      for (let job = work.shift(); job; job = work.shift()) {
        // oxlint-disable-next-line no-await-in-loop -- responses go out in the order the requests came in
        const reply = await job();
        if (reply !== undefined) output.write(`${reply}\n`);
      }
      draining = false;
      if (ended) done();
    };
    const emit = (line: string) => {
      work.push(() => handleLine(root, line));
      void drain();
    };
    const take = (chunk: string) => {
      let rest = chunk;
      for (let nl = rest.indexOf('\n'); nl >= 0; nl = rest.indexOf('\n')) {
        const line = pending + rest.slice(0, nl);
        rest = rest.slice(nl + 1);
        pending = '';
        pendingBytes = 0;
        if (skipping) skipping = false;
        else if (line.trim() !== '') emit(line);
      }
      if (skipping) return;
      pending += rest;
      pendingBytes += Buffer.byteLength(rest, 'utf8');
      if (pendingBytes > MAX_LINE_BYTES) {
        pending = '';
        pendingBytes = 0;
        skipping = true;
        work.push(() => JSON.stringify(fail(null, INVALID_REQUEST, 'message too large')));
        void drain();
      }
    };
    input.on('data', (chunk: Buffer | string) => take(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
    input.on('end', () => {
      take(decoder.end());
      if (!skipping && pending.trim() !== '') emit(pending);
      ended = true;
      if (!draining) done();
    });
  });
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
  process.stdout.on('error', () => process.exit(0)); // the client went away
  await serve(root, process.stdin, process.stdout);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`lede-mcp: ${e instanceof Error ? e.message : String(e)}\n${HELP}`);
    process.exitCode = 2;
  });
}
