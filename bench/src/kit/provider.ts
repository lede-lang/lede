// Writer providers over `fetch`: Anthropic Messages and OpenAI-style chat completions (OpenAI itself or any compatible host).
// One request per call, the prompt as the only user message. Retries are for the transport only (network errors, 408, 429, 5xx):
// nothing the model wrote is ever looked at, or fed back, between attempts. Token counts are the provider's own `usage`.
export interface Completion {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Reasoning tokens, when the provider reports them; they are already inside outputTokens and are billed as output. */
  reasoningTokens: number | null;
  model: string;
  truncated: boolean;
}
export interface Provider {
  kind: ProviderKind;
  /** The base URL with any credentials or query removed, safe to print and to store. */
  baseUrl: string;
  complete(prompt: string, maxTokens: number): Promise<Completion>;
}
export type ProviderKind = 'anthropic' | 'openai-compatible';

/** A failure that retrying will not fix (a bad key, a bad model id, a refused request): the run stops. */
export class FatalProviderError extends Error {}
/** The transport kept failing after its retries; the row is recorded as an error and the run goes on. */
export class TransportError extends Error {}

export const DEFAULT_BASE: Record<ProviderKind, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.openai.com/v1',
};

export interface ProviderOptions {
  kind: ProviderKind;
  baseUrl?: string | undefined;
  model: string;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Parameter that carries the output limit on chat completions; default is max_completion_tokens on api.openai.com, else max_tokens. */
  maxTokensField?: string | undefined;
  retries?: number;
}

export function cleanBaseUrl(raw: string): string {
  const u = new URL(raw);
  u.username = '';
  u.password = '';
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/+$/, '');
}

/** The key for a provider, from the environment only. OPENAI_API_KEY is used only for api.openai.com, never sent to another host. */
export function keyFor(
  kind: ProviderKind,
  baseUrl: string,
  env: Record<string, string | undefined>,
): { name: string; value: string } | null {
  const names =
    kind === 'anthropic'
      ? ['ANTHROPIC_API_KEY']
      : new URL(baseUrl).hostname === 'api.openai.com'
        ? ['LEDE_BENCH_API_KEY', 'OPENAI_API_KEY']
        : ['LEDE_BENCH_API_KEY'];
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return { name, value: value.trim() };
  }
  return null;
}

export const keyNamesHint = (kind: ProviderKind): string =>
  kind === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LEDE_BENCH_API_KEY (any compatible host), or OPENAI_API_KEY for api.openai.com itself';

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export function createProvider(o: ProviderOptions): Provider {
  const baseUrl = cleanBaseUrl(o.baseUrl ?? DEFAULT_BASE[o.kind]);
  const key = keyFor(o.kind, baseUrl, o.env);
  if (key === null) throw new FatalProviderError(`no API key: set ${keyNamesHint(o.kind)}`);
  const secret = key.value;
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = o.retries ?? 3;
  const redact = (s: string) => s.split(secret).join('[redacted]').slice(0, 400);
  const onOpenAI = new URL(baseUrl).hostname === 'api.openai.com';
  const limitField = o.maxTokensField ?? (onOpenAI ? 'max_completion_tokens' : 'max_tokens');

  const request = (prompt: string, maxTokens: number): { url: string; init: RequestInit } =>
    o.kind === 'anthropic'
      ? {
          url: `${baseUrl}/v1/messages`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': secret, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: o.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
          },
        }
      : {
          url: `${baseUrl}/chat/completions`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify({ model: o.model, [limitField]: maxTokens, messages: [{ role: 'user', content: prompt }] }),
          },
        };

  const parse = (j: any): Completion => {
    if (o.kind === 'anthropic') {
      const text = ((j.content ?? []) as { type: string; text?: string }[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      return {
        text,
        inputTokens: numOrNull(j.usage?.input_tokens),
        outputTokens: numOrNull(j.usage?.output_tokens),
        reasoningTokens: null,
        model: String(j.model ?? o.model),
        truncated: j.stop_reason === 'max_tokens',
      };
    }
    const choice = j.choices?.[0];
    return {
      text: String(choice?.message?.content ?? ''),
      inputTokens: numOrNull(j.usage?.prompt_tokens),
      outputTokens: numOrNull(j.usage?.completion_tokens),
      reasoningTokens: numOrNull(j.usage?.completion_tokens_details?.reasoning_tokens),
      model: String(j.model ?? o.model),
      truncated: choice?.finish_reason === 'length',
    };
  };

  return {
    kind: o.kind,
    baseUrl,
    async complete(prompt, maxTokens) {
      const { url, init } = request(prompt, maxTokens);
      let last = 'no attempt';
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
        let res: Response;
        try {
          res = await doFetch(url, init);
        } catch (e) {
          last = `network error: ${redact((e as Error).message)}`;
          continue;
        }
        const body = await res.text();
        if (res.ok) {
          try {
            return parse(JSON.parse(body));
          } catch {
            throw new FatalProviderError('the provider returned a reply this kit cannot read (not the documented response shape)');
          }
        }
        last = `HTTP ${res.status}: ${redact(body)}`;
        if (!RETRYABLE.has(res.status)) throw new FatalProviderError(last);
      }
      throw new TransportError(`${last} (after ${retries} retries)`);
    },
  };
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
