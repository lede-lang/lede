// The server is spawned over stdio and spoken to with the MCP SDK's own client, so these tests are also the check that a real
// client can connect, list tools and call them.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const server = join(import.meta.dirname, '../src/server.ts');
const specFile = join(import.meta.dirname, '../../../spec/model-spec.md');

const clients: Client[] = [];
async function connect(...args: string[]): Promise<Client> {
  const client = new Client({ name: 'lede-mcp-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, ...args], stderr: 'pipe' }));
  clients.push(client);
  return client;
}

interface Called {
  text: string;
  isError: boolean;
  structured: { ok?: boolean; diagnostics?: { severity: string; code: string; line: number; col: number; message: string }[] } | undefined;
}
async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<Called> {
  const r = (await c.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
    structuredContent?: Called['structured'];
  };
  assert.equal(r.content[0].type, 'text');
  return { text: r.content[0].text, isError: r.isError === true, structured: r.structuredContent };
}

let tmp = '';
let outside = '';
let root = '';
let open: Client; // started without --root
let rooted: Client; // started with --root

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'lede-mcp-'));
  root = join(tmp, 'root');
  outside = join(tmp, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(root, 'q.csv'), 'quarter,revenue\nQ1,10\nQ2,14\n');
  writeFileSync(join(outside, 'secret.csv'), 'k,v\nsecret,1\n');
  symlinkSync(outside, join(root, 'link'));
  symlinkSync(join(outside, 'secret.csv'), join(root, 'leak.csv'));
  [open, rooted] = await Promise.all([connect(), connect('--root', root)]);
});

after(async () => {
  await Promise.all(clients.map((c) => c.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const GOOD = '# Hello\n\nA paragraph.\n\ndiagram f\nf: a -> b\n';

test('initialize names the server and offers tools and resources', async () => {
  const info = open.getServerVersion();
  assert.equal(info?.name, 'lede');
  assert.ok(open.getServerCapabilities()?.tools);
  assert.ok(open.getServerCapabilities()?.resources);
});

test('tools/list: the three tools, with the input shapes the design fixes', async () => {
  const { tools } = await open.listTools();
  assert.deepEqual(tools.map((t) => t.name).toSorted(), ['lede_check', 'lede_compile', 'lede_spec']);
  const by = Object.fromEntries(
    tools.map((t) => [t.name, t.inputSchema as { properties?: Record<string, { type: string }>; required?: string[] }]),
  );
  assert.equal(by.lede_check.properties?.source.type, 'string');
  assert.deepEqual(by.lede_check.required, ['source']);
  assert.equal(by.lede_compile.properties?.artifact.type, 'boolean');
  assert.deepEqual(by.lede_compile.required, ['source']);
  assert.deepEqual(Object.keys(by.lede_spec.properties ?? {}), [], 'lede_spec takes no input');
  // Nothing in any input schema can widen what a page may do.
  for (const t of tools) assert.doesNotMatch(JSON.stringify(t.inputSchema), /unsafe|remote|shell|root|path|file/i, t.name);
});

test('lede_check: a valid page is ok, an invalid one returns its diagnostics in the CLI shape', async () => {
  const good = await call(open, 'lede_check', { source: GOOD });
  assert.equal(good.isError, false);
  assert.deepEqual(good.structured, { ok: true, diagnostics: [] });
  assert.deepEqual(JSON.parse(good.text), { ok: true, diagnostics: [] });

  const bad = await call(open, 'lede_check', { source: '# Bad\n\nchart lien q\n' });
  assert.equal(bad.isError, false, 'a page with errors is an answer, not a tool failure');
  assert.equal(bad.structured?.ok, false);
  const [d] = bad.structured?.diagnostics ?? [];
  assert.equal(d.severity, 'error');
  assert.equal(d.line, 3);
  assert.equal(typeof d.code, 'string');
  assert.equal(typeof d.col, 'number');
  assert.equal(typeof d.message, 'string');
});

test('lede_compile: one page, no script, nothing written', async () => {
  const r = await call(open, 'lede_compile', { source: GOOD });
  assert.equal(r.isError, false);
  assert.match(r.text, /^<!doctype html>/i);
  assert.match(r.text, /<svg/);
  assert.doesNotMatch(r.text, /<script/i);
  assert.equal(r.structured?.ok, true);
});

test('lede_compile artifact: true gives title, style and main only', async () => {
  const r = await call(open, 'lede_compile', { source: GOOD, artifact: true });
  assert.doesNotMatch(r.text, /^<!doctype/i);
  assert.match(r.text, /^<title>/);
  assert.match(r.text, /<main/);
  assert.doesNotMatch(r.text, /<script/i);
});

test('lede_compile: a page with errors returns diagnostics and no HTML, not a crash', async () => {
  const r = await call(open, 'lede_compile', { source: '# Bad\n\nchart lien q\n' });
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.text, /<html|<main/i);
  assert.equal(r.structured?.ok, false);
  assert.equal(r.structured?.diagnostics?.[0].severity, 'error');
  // And the server still answers.
  assert.equal((await call(open, 'lede_check', { source: GOOD })).structured?.ok, true);
});

test('raw html is sanitized, with no way to ask otherwise', async () => {
  const hostile = '# T\n\nhtml: <p onclick="x()">hi</p><script>alert(1)</script><iframe src="https://evil.example/"></iframe>\n';
  const r = await call(open, 'lede_compile', { source: hostile, unsafeHtml: true, unsafe_html: true });
  assert.doesNotMatch(r.text, /<script/i);
  assert.doesNotMatch(r.text, /onclick/i);
  assert.doesNotMatch(r.text, /<iframe/i);
  assert.doesNotMatch(r.text, /alert\(1\)/);
});

test('a remote image is not emitted, with no way to ask otherwise', async () => {
  for (const src of [
    '# T\n\nimage https://example.com/a.png "A chart"\n',
    '# T\n\nhtml: <p><img src="https://evil.example/?q=1" alt="a"></p>\n',
  ]) {
    const r = await call(open, 'lede_compile', { source: src, allowRemote: true, allow_remote: true });
    assert.doesNotMatch(r.text, /https?:\/\/(example\.com|evil\.example)/, src);
  }
});

test('--shell is not available: a page with a question has no script', async () => {
  const r = await call(open, 'lede_compile', { source: '# Go\n\nask a | Who?\nexport json\n', shell: true });
  assert.doesNotMatch(r.text, /<script/i);
});

test('without --root, file data is refused: absolute, parent and plain paths', async () => {
  for (const p of ['/etc/passwd', '../q.csv', 'q.csv', '../../etc/passwd']) {
    const src = `# T\n\ndata x < ${p}\nchart bar x\n`;
    const c = await call(open, 'lede_check', { source: src });
    assert.equal(c.structured?.ok, false, p);
    assert.ok(
      c.structured?.diagnostics?.some((d) => d.code === 'data-file'),
      p,
    );
    const r = await call(open, 'lede_compile', { source: src });
    assert.equal(r.isError, true, p);
    assert.doesNotMatch(r.text, /root:|Q1/, p);
  }
});

test('with --root, a file inside the tree loads', async () => {
  const r = await call(rooted, 'lede_compile', { source: '# T\n\ndata x < q.csv\nchart bar x title="Revenue"\n' });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /<svg/);
  assert.doesNotMatch(r.text, /<script/i);
});

test('with --root, /etc/passwd, ../ and symlinks that leave the tree are refused', async () => {
  const refused = ['/etc/passwd', '../outside/secret.csv', '../../etc/passwd', 'link/secret.csv', 'leak.csv', 'link/nothing.csv'];
  for (const p of refused) {
    const src = `# T\n\ndata x < ${p}\nchart bar x\n`;
    const c = await call(rooted, 'lede_check', { source: src });
    assert.equal(c.structured?.ok, false, p);
    const d = c.structured?.diagnostics?.find((x) => x.code === 'data-file');
    assert.ok(d, p);
    assert.match(d.message, /outside the document's directory/, p);
    const r = await call(rooted, 'lede_compile', { source: src });
    assert.equal(r.isError, true, p);
    assert.doesNotMatch(r.text, /root:x|secret,1|<svg/, p);
  }
});

test('with --root, a remote URL as a data path is refused', async () => {
  const c = await call(rooted, 'lede_check', { source: '# T\n\ndata x < https://example.com/a.csv\n' });
  assert.equal(c.structured?.ok, false);
});

test('lede_spec and lede://spec/model are the model reference, byte for byte', async () => {
  const want = readFileSync(specFile, 'utf8');
  const tool = await call(open, 'lede_spec');
  assert.equal(tool.isError, false);
  assert.equal(tool.text, want);
  assert.equal(Buffer.from(tool.text).equals(readFileSync(specFile)), true);

  const { resources } = await open.listResources();
  assert.deepEqual(
    resources.map((r) => r.uri),
    ['lede://spec/model'],
  );
  const read = await open.readResource({ uri: 'lede://spec/model' });
  const [content] = read.contents;
  assert.equal('text' in content ? content.text : undefined, want);
});

test('oversize input is refused with a clear error, at the limit it is not', async () => {
  const big = `# T\n\n${'a'.repeat(1024 * 1024)}\n`;
  for (const tool of ['lede_check', 'lede_compile']) {
    const r = await call(open, tool, { source: big });
    assert.equal(r.isError, true, tool);
    assert.match(r.text, /limit is 1048576 bytes \(1 MB\)/, tool);
  }
  // Multi-byte text counts in bytes, not characters.
  const wide = await call(open, 'lede_check', { source: 'é'.repeat(600 * 1024) });
  assert.equal(wide.isError, true);
  const ok = await call(open, 'lede_check', { source: `# T\n\n${'a'.repeat(1024 * 1024 - 8)}\n` });
  assert.equal(ok.isError, false, ok.text);
});

test('a wrong input type is an error the client can read, and the server stays up', async () => {
  const bad = await call(open, 'lede_check', { source: 42 });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /source/);
  assert.equal((await call(open, 'lede_check', { source: GOOD })).structured?.ok, true);
});

test('startup: --root must name a directory, unknown arguments exit 2, --version and --help print', async () => {
  const run = (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((res) => {
      const p = spawn(process.execPath, [server, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout.on('data', (d: Buffer) => (out += d.toString()));
      p.stderr.on('data', (d: Buffer) => (err += d.toString()));
      p.on('close', (code) => res({ code, out, err }));
    });
  const [a, b, c, d] = await Promise.all([run('--root', join(tmp, 'nope')), run('--wat'), run('--version'), run('--help')]);
  assert.equal(a.code, 2);
  assert.match(a.err, /lede-mcp:/);
  assert.equal(b.code, 2);
  assert.match(b.err, /unknown argument --wat/);
  assert.equal(c.code, 0);
  assert.match(c.out, /^\d+\.\d+\.\d+\n$/);
  assert.equal(d.code, 0);
  assert.match(d.out, /^lede-mcp /);
});
