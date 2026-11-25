// The wire format with no SDK on either side: newline-delimited JSON-RPC 2.0 on stdin and stdout, and nothing else on stdout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PROTOCOL_VERSIONS } from '../src/server.ts';
import { Rpc } from './rpc.ts';

const GOOD = '# Hi\n';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` against a fresh server and always stops it. */
async function withServer(fn: (s: Rpc) => Promise<void>): Promise<void> {
  const s = new Rpc();
  try {
    await fn(s);
  } finally {
    s.close();
  }
}

test('raw JSON-RPC: initialize, initialized, tools/list, tools/call, ping; stdout holds only responses', () =>
  withServer(async (s) => {
    const init = await s.initialize('2025-03-26');
    assert.equal(init.result.serverInfo.name, 'lede');
    assert.equal(init.id, 1);
    assert.equal((await s.request('tools/list')).result.tools.length, 3);
    assert.equal((await s.call('lede_check', { source: GOOD })).structured?.ok, true);
    assert.deepEqual((await s.request('ping')).result, {});
    for (const l of s.lines) assert.equal((JSON.parse(l) as { jsonrpc: string }).jsonrpc, '2.0');
    assert.equal(s.lines.length, 4, 'one line per request, none for the notification');
  }));

test('protocol version: the client version is echoed when supported, otherwise the latest', () =>
  withServer(async (s) => {
    assert.deepEqual(PROTOCOL_VERSIONS, ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']);
    for (const v of PROTOCOL_VERSIONS) assert.equal((await s.initialize(v)).result.protocolVersion, v);
    assert.equal((await s.initialize('2099-01-01')).result.protocolVersion, PROTOCOL_VERSIONS[0]);
    assert.equal((await s.initialize('nonsense')).result.protocolVersion, PROTOCOL_VERSIONS[0]);
    const bad = await s.request('initialize', { capabilities: {} });
    assert.equal(bad.error.code, -32602, 'no protocolVersion is a bad param');
  }));

test('an unknown method is -32601 with the request id', () =>
  withServer(async (s) => {
    const r = await s.request('prompts/list');
    assert.equal(r.error.code, -32601);
    assert.equal(r.id, 1);
    assert.equal(r.result, undefined);
  }));

test('a malformed JSON line is -32700 with a null id, and the server keeps going', () =>
  withServer(async (s) => {
    s.raw('{"jsonrpc":"2.0","id":1,"method":\n');
    const [first] = await s.lines_(1);
    assert.equal(first.error.code, -32700);
    assert.equal(first.id, null);
    s.raw('not json at all\n');
    assert.equal((await s.lines_(2))[1].error.code, -32700);
    assert.deepEqual((await s.request('ping')).result, {});
  }));

test('invalid requests: a non-object, a missing method and bad params', () =>
  withServer(async (s) => {
    s.raw('42\n');
    s.send({ jsonrpc: '2.0', id: 7 });
    s.send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: [] });
    const out = await s.lines_(3);
    assert.equal(out[0].error.code, -32600);
    assert.equal(out[1].error.code, -32600);
    assert.equal(out[1].id, 7);
    assert.equal(out[2].error.code, -32602);
    assert.equal(out[2].id, 8);
    assert.equal((await s.request('resources/read', {})).error.code, -32602);
    assert.equal((await s.request('tools/call', { arguments: {} })).error.code, -32602);
    assert.equal((await s.request('tools/call', { name: 'lede_check', arguments: [] })).error.code, -32602);
  }));

test('a notification never gets a reply, known method or not, and a client response is ignored', () =>
  withServer(async (s) => {
    s.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    s.send({ jsonrpc: '2.0', method: 'no/such/method', params: { x: 1 } });
    s.send({ jsonrpc: '2.0', method: 'ping' });
    s.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'nope' } });
    s.send({ jsonrpc: '2.0', id: 99, result: {} });
    const r = await s.request('ping');
    await wait(100);
    assert.equal(s.lines.length, 1, 'only the one request was answered');
    assert.equal(r.id, 1);
  }));

test('an unknown tool is -32602 naming it; a known one still works after', () =>
  withServer(async (s) => {
    const r = await s.request('tools/call', { name: 'lede_nope', arguments: {} });
    assert.equal(r.error.code, -32602);
    assert.match(r.error.message, /lede_nope/);
    assert.equal((await s.call('lede_check', { source: GOOD })).isError, false);
  }));

test('tool arguments are checked against the advertised schema: unknown keys, missing, wrong type', () =>
  withServer(async (s) => {
    const listed = (await s.request('tools/list')).result.tools as { name: string; inputSchema: { additionalProperties: boolean } }[];
    for (const t of listed) assert.equal(t.inputSchema.additionalProperties, false, t.name);
    const extra = await s.call('lede_check', { source: GOOD, unsafeHtml: true });
    assert.equal(extra.isError, true);
    assert.match(extra.text, /unknown argument "unsafeHtml"/);
    const spec = await s.call('lede_spec', { anything: 1 });
    assert.equal(spec.isError, true);
    assert.match(spec.text, /unknown argument "anything"/);
    assert.match((await s.call('lede_check', {})).text, /source is required/);
    assert.match((await s.call('lede_compile', { source: GOOD, artifact: 'yes' })).text, /artifact must be a boolean/);
    assert.match((await s.call('lede_check', { source: null })).text, /source must be a string/);
    // __proto__ and friends are keys like any other.
    const r = await s.request('tools/call', { name: 'lede_check', arguments: JSON.parse('{"source":"# x","__proto__":1}') });
    assert.equal(r.result.isError, true);
    // arguments may be left out for a tool that takes none.
    assert.equal((await s.request('tools/call', { name: 'lede_spec' })).result.isError, undefined);
  }));

test('an oversized source is a tool error naming the limit, over the wire', () =>
  withServer(async (s) => {
    const r = await s.call('lede_check', { source: `# T\n\n${'a'.repeat(1024 * 1024)}\n` });
    assert.equal(r.isError, true);
    assert.match(r.text, /limit is 1048576 bytes \(1 MB\)/);
    assert.equal((await s.call('lede_check', { source: GOOD })).isError, false, 'and the server is still up');
  }));

test('a request split across two stdin chunks is answered once, even inside a multi-byte character', () =>
  withServer(async (s) => {
    const line = Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'lede_check', arguments: { source: '# café 世界\n' } } })}\n`,
    );
    const cut = line.indexOf(Buffer.from('é')) + 1; // between the two bytes of the e-acute
    s.raw(line.subarray(0, cut));
    await wait(100);
    assert.equal(s.lines.length, 0, 'nothing is answered before the line is complete');
    s.raw(line.subarray(cut));
    const [r] = await s.lines_(1);
    assert.equal(r.id, 5);
    assert.equal(r.result.structuredContent.ok, true);
    await wait(50);
    assert.equal(s.lines.length, 1);
  }));

test('two requests in one chunk are both answered, in order; a trailing blank line is ignored', () =>
  withServer(async (s) => {
    const a = JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' });
    const b = JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'lede_check', arguments: { source: GOOD } } });
    s.raw(`${a}\n${b}\n\n`);
    const out = await s.lines_(2);
    assert.deepEqual(
      out.map((m) => m.id),
      [10, 11],
    );
    await wait(50);
    assert.equal(s.lines.length, 2);
  }));

test('a batch is answered with an array, and only for its requests', () =>
  withServer(async (s) => {
    s.raw(
      `${JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ])}\n`,
    );
    const [r] = await s.lines_(1);
    assert.equal(Array.isArray(r), true);
    assert.deepEqual(
      (r as unknown as { id: number }[]).map((m) => m.id),
      [1, 2],
    );
  }));

test('a final request with no newline before EOF is still answered', async () => {
  const s = new Rpc();
  try {
    s.raw(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    s.endInput();
    assert.equal((await s.lines_(1))[0].id, 1);
  } finally {
    s.close();
  }
});

test('nothing but protocol messages reaches stdout, and diagnostics go to stderr', () =>
  withServer(async (s) => {
    await s.initialize();
    await s.request('no/such');
    s.raw('garbage\n');
    await s.lines_(3);
    for (const l of s.lines) assert.equal((JSON.parse(l) as { jsonrpc: string }).jsonrpc, '2.0');
  }));

test('the tools/list response size recorded in the README is the size measured', () =>
  withServer(async (s) => {
    await s.request('tools/list');
    const bytes = Buffer.byteLength(s.lines[0], 'utf8');
    const readme = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8');
    assert.ok(readme.includes(`${bytes.toLocaleString('en-US')} bytes`), `README should state ${bytes} bytes for tools/list`);
    assert.ok(bytes < 4096, 'a tools/list response stays small: it is paid for in every session that connects the server');
  }));
