// The wire format with no SDK on the client side: newline-delimited JSON-RPC 2.0 on stdin and stdout, and nothing else on stdout.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

const server = join(import.meta.dirname, '../src/server.ts');

test('raw JSON-RPC: initialize, initialized, tools/list, tools/call, ping; stdout holds only responses', async () => {
  const p = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines: string[] = [];
  let buf = '';
  p.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  const send = (m: object) => p.stdin.write(`${JSON.stringify(m)}\n`);
  const reply = async (id: number): Promise<Record<string, any>> => {
    for (let n = 0; n < 200; n++) {
      const hit = lines.map((l) => JSON.parse(l) as { id?: number }).find((m) => m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no reply to ${id}`);
  };
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    });
    const init = await reply(1);
    assert.equal(init.result.serverInfo.name, 'lede');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal((await reply(2)).result.tools.length, 3);
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lede_check', arguments: { source: '# Hi\n' } } });
    assert.equal((await reply(3)).result.structuredContent.ok, true);
    send({ jsonrpc: '2.0', id: 4, method: 'ping' });
    assert.deepEqual((await reply(4)).result, {});
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    const unknown = await reply(5);
    assert.ok(unknown.error || unknown.result.isError, 'an unknown tool is an error, not a crash');
    for (const l of lines) assert.equal((JSON.parse(l) as { jsonrpc: string }).jsonrpc, '2.0');
  } finally {
    p.kill();
  }
});
