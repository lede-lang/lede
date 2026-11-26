// Runs `fn` over `items` with at most `limit` calls in flight; results keep the order of `items`.
import { availableParallelism } from 'node:os';

/**
 * The limit the browser checks and the conformance test use: half the cores, at least 2. node --test already runs files side by side,
 * so a pool per core would put cores x cores browser pages or processes on the machine at once.
 */
export const POOL = Math.max(2, Math.ceil(availableParallelism() / 2));

export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
