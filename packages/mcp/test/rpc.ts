// A minimal stdio client for the tests: it spawns the server and speaks newline-delimited JSON-RPC to it, with no SDK.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { join } from 'node:path';

export const serverPath = join(import.meta.dirname, '../src/server.ts');

export type Msg = Record<string, any>;

export class Rpc {
  readonly lines: string[] = [];
  stderr = '';
  private proc: ChildProcessByStdio<Writable, Readable, Readable>;
  private buf = '';
  private nextId = 1;

  constructor(...args: string[]) {
    this.proc = spawn(process.execPath, [serverPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        this.lines.push(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
      }
    });
    this.proc.stderr.on('data', (d: Buffer) => (this.stderr += d.toString()));
  }

  /** Writes bytes as they are; the caller adds any newline. */
  raw(data: string | Buffer): void {
    this.proc.stdin.write(data);
  }

  endInput(): void {
    this.proc.stdin.end();
  }

  send(m: object): void {
    this.raw(`${JSON.stringify(m)}\n`);
  }

  /** Waits until `n` lines have arrived in all, then returns them parsed. */
  async lines_(n: number): Promise<Msg[]> {
    for (let k = 0; k < 400 && this.lines.length < n; k++) await new Promise((r) => setTimeout(r, 25));
    if (this.lines.length < n) throw new Error(`wanted ${n} lines, got ${this.lines.length}: ${this.lines.join(' | ')}`);
    return this.lines.map((l) => JSON.parse(l) as Msg);
  }

  /** Sends a request and returns its whole response message. */
  async request(method: string, params?: object): Promise<Msg> {
    const id = this.nextId++;
    const seen = this.lines.length;
    this.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    const all = await this.lines_(seen + 1);
    const hit = all.find((m) => m.id === id);
    if (!hit) throw new Error(`no reply to ${id}`);
    return hit;
  }

  async initialize(protocolVersion = '2025-06-18'): Promise<Msg> {
    const r = await this.request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return r;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<Called> {
    const r = await this.request('tools/call', { name, arguments: args });
    if (r.error) throw new Error(`protocol error: ${JSON.stringify(r.error)}`);
    const res = r.result as { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Called['structured'] };
    if (res.content[0].type !== 'text') throw new Error('not text');
    return { text: res.content[0].text, isError: res.isError === true, structured: res.structuredContent };
  }

  close(): void {
    this.proc.kill();
  }
}

export interface Called {
  text: string;
  isError: boolean;
  structured: { ok?: boolean; diagnostics?: { severity: string; code: string; line: number; col: number; message: string }[] } | undefined;
}
