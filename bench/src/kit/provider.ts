// Writer providers over `fetch`: Anthropic Messages and OpenAI-style chat completions (OpenAI itself or any compatible host).
// One request per call, the prompt as the only user message. Retries are for the transport only (a connection that never opened,
// 408, 429, 5xx): nothing the model wrote is ever looked at, or fed back, between attempts. Token counts are the provider's own `usage`.
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

/** `maybeBilled`: the request reached the provider and may have been charged, so the run counts it at the worst case. */
class ProviderError extends Error {
  readonly maybeBilled: boolean;
  constructor(message: string, maybeBilled = false) {
    super(message);
    this.maybeBilled = maybeBilled;
  }
}
/** A failure that retrying will not fix (a bad key, a bad model id, a refused request, an unreadable reply): the run stops. */
export class FatalProviderError extends ProviderError {}
/** The transport failed (after its retries, or once a request may have reached the provider); the row is an error and the run goes on. */
export class TransportError extends ProviderError {}

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

/**
 * The key for a provider, from the environment only. ANTHROPIC_API_KEY is sent only to https://api.anthropic.com and OPENAI_API_KEY only
 * to https://api.openai.com; any other origin gets LEDE_BENCH_API_KEY or nothing.
 */
export function keyFor(
  kind: ProviderKind,
  baseUrl: string,
  env: Record<string, string | undefined>,
): { name: string; value: string } | null {
  const own = kind === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const names = new URL(baseUrl).origin === new URL(DEFAULT_BASE[kind]).origin ? [own, 'LEDE_BENCH_API_KEY'] : ['LEDE_BENCH_API_KEY'];
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return { name, value: value.trim() };
  }
  return null;
}

export const keyNamesHint = (kind: ProviderKind): string =>
  `LEDE_BENCH_API_KEY (any host), or ${kind === 'anthropic' ? 'ANTHROPIC_API_KEY for api.anthropic.com' : 'OPENAI_API_KEY for api.openai.com'} itself`;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
/** fetch failures where no connection opened, so nothing reached the provider. Any other (a reset, a timeout) may have been billed. */
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

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
        let body: string;
        try {
          res = await doFetch(url, init);
          body = await res.text();
        } catch (e) {
          const cause = (e as { cause?: { code?: unknown } }).cause?.code;
          const code = typeof cause === 'string' ? cause : '';
          last = `network error: ${redact(`${(e as Error).message} ${code}`.trim())}`;
          if (NOT_SENT.has(code)) continue;
          // The request may have reached the provider: asking again could pay twice, so the row ends here.
          throw new TransportError(last, true);
        }
        if (res.ok) {
          try {
            return parse(JSON.parse(body));
          } catch {
            throw new FatalProviderError('the provider returned a reply this kit cannot read (not the documented response shape)', true);
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
