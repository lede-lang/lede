// Synthetic judge directories, recounts and hints for the scorer tests. Nothing here is a real round.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Lede wins, a tie, or HTML wins. */
export type Outcome = 'L' | 'T' | 'H';

export interface ModelSpec {
  /** The directory the Lede pages came from, e.g. `sonnet-r7h`. */
  model: string;
  /** Task ids, in the order of the outcomes. */
  ids: number[];
  /** Per judge sample (`s1`, `s2`), one outcome letter per id. */
  samples: Record<string, string>;
}

export const python = () => spawnSync('python3', ['-I', '-c', 'pass']).status === 0;

/**
 * Writes key.json and the samples of a judged round. Sides alternate by pair number, so a scorer that reads the wrong side
 * shows up. Each batch file opens with the header record and holds at most ten pairs. `root: true` writes sample one at the
 * root of the round (rounds 1 and 2 kept theirs there) instead of in s1/.
 */
export function writeRound(dir: string, models: ModelSpec[], options: { root?: boolean; header?: boolean } = {}): void {
  const key: Record<string, string>[] = [];
  const winners = new Map<string, Map<string, string>>();
  let n = 0;
  for (const m of models) {
    m.ids.forEach((id, i) => {
      const pair = `P${String(++n).padStart(3, '0')}`;
      const cLeft = n % 2 === 0;
      key.push({ pair, model: m.model, id: String(id), left: cLeft ? 'C' : 'B', right: cLeft ? 'B' : 'C', vs: 'C-B' });
      for (const [sample, letters] of Object.entries(m.samples)) {
        const o = letters[i] as Outcome | undefined;
        if (o === undefined) throw new Error(`${m.model} ${sample}: no outcome for task ${id}`);
        const winner = o === 'T' ? 'TIE' : (o === 'L') === cLeft ? 'LEFT' : 'RIGHT';
        if (!winners.has(sample)) winners.set(sample, new Map());
        winners.get(sample)!.set(pair, winner);
      }
    });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'key.json'), JSON.stringify(key, null, 1));
  for (const [sample, picks] of winners) {
    const where = options.root && sample === 's1' ? dir : join(dir, sample);
    mkdirSync(where, { recursive: true });
    const lines = [...picks].map(([pair, winner]) => JSON.stringify({ pair, winner, reason: `synthetic ${winner}` }));
    for (let b = 0; b * 10 < lines.length; b++) {
      const batch = lines.slice(b * 10, b * 10 + 10);
      const head = options.header === false ? [] : [JSON.stringify({ judge: 'claude-sonnet-5-5', prompt: 'judge-v2.md' })];
      writeFileSync(join(where, `judge-${String(b + 1).padStart(2, '0')}.jsonl`), `${[...head, ...batch].join('\n')}\n`);
    }
  }
}

/** A recount file with the fields the scorers read: `rows[].key` and `rows[].tokens`. */
export function writeRecount(path: string, rows: Record<string, number>): void {
  writeFileSync(path, JSON.stringify({ rows: Object.entries(rows).map(([key, tokens]) => ({ key, tokens })) }));
}

/** Ten consecutive task ids from 71. */
export const TASKS = Array.from({ length: 10 }, (_, i) => 71 + i);
