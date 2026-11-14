// A local stub provider for the kit's tests: an HTTP server that answers like Anthropic Messages or OpenAI chat completions,
// counts requests, and reports fixed usage. No network beyond 127.0.0.1, and no real key anywhere.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Stub {
  url: string;
  requests: { path: string; headers: IncomingMessage['headers']; body: any }[];
  close(): Promise<void>;
}

export interface StubOptions {
  inputTokens?: number;
  outputTokens?: number;
  /** The text of every reply; a function sees the request body. */
  text?: string | ((body: any) => string);
  /** Status codes to answer with, one per request, before falling back to 200. */
  statuses?: number[];
  /** A body to send with a non-200 status. */
  errorBody?: (headers: IncomingMessage['headers']) => string;
  omitUsage?: boolean;
}

export async function startStub(kind: 'anthropic' | 'openai', o: StubOptions = {}): Promise<Stub> {
  const requests: Stub['requests'] = [];
  const statuses = [...(o.statuses ?? [])];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push({ path: req.url ?? '', headers: req.headers, body });
      const status = statuses.shift() ?? 200;
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(o.errorBody?.(req.headers) ?? JSON.stringify({ error: 'stub error' }));
        return;
      }
      const text = typeof o.text === 'function' ? o.text(body) : (o.text ?? 'ok');
      const inT = o.inputTokens ?? 1000;
      const outT = Math.min(o.outputTokens ?? 500, body.max_tokens ?? body.max_completion_tokens ?? Infinity);
      const reply =
        kind === 'anthropic'
          ? {
              model: 'stub-model-returned',
              content: [{ type: 'text', text }],
              stop_reason: 'end_turn',
              ...(o.omitUsage ? {} : { usage: { input_tokens: inT, output_tokens: outT } }),
            }
          : {
              model: 'stub-model-returned',
              choices: [{ message: { content: text }, finish_reason: 'stop' }],
              ...(o.omitUsage
                ? {}
                : { usage: { prompt_tokens: inT, completion_tokens: outT, completion_tokens_details: { reasoning_tokens: 100 } } }),
            };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
