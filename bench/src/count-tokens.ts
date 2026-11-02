// The count_tokens endpoint less the tokens its wrapper adds, shared by count-text.ts and recount.ts (internal spec,
// lede-lang/meta). count_tokens wraps the text in a user message, which adds a fixed number of tokens; counting "a", assumed to be
// one token on every tokenizer, measures that overhead.
import type Anthropic from '@anthropic-ai/sdk';

const countRaw = async (client: Anthropic, model: string, text: string): Promise<number> =>
  (await client.messages.countTokens({ model, messages: [{ role: 'user', content: text }] })).input_tokens;

/** The tokens `model`'s count_tokens adds to any text. */
export const overheadOf = async (client: Anthropic, model: string): Promise<number> => (await countRaw(client, model, 'a')) - 1;

/** The tokens of `text` alone. A caller that counts many texts with one model measures `overheadOf` once and passes it. */
export async function countTokens(client: Anthropic, model: string, text: string, overhead?: number): Promise<number> {
  const [raw, wrapper] = await Promise.all([countRaw(client, model, text), overhead ?? overheadOf(client, model)]);
  return raw - wrapper;
}
