// Task sets for the replication kit. Open: 1-130 (tasks 101-130 are the retired gate set, D38.4; 1-100 are tuning and earlier-round
// tasks). Sealed: 131-185, the held-out set of D69. The kit refuses a sealed id before it opens any file, always.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OPEN_MAX = 130;
export const SEALED_MIN = 131;
export const SEALED_MAX = 185;

export const NAMED_SETS: Record<string, readonly [number, number]> = {
  retired: [101, 130],
  tuning: [1, 100],
  open: [1, OPEN_MAX],
};

export interface Task {
  id: string;
  category: string;
  title: string;
  brief: string;
  file: string;
}

export class TaskSelectionError extends Error {}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** `retired`, `open`, `5-12`, `3`, or a comma list of these (`1-5,101,110-112`) to the ordered, de-duplicated ids. */
export function parseTaskSpec(spec: string): number[] {
  const ids = new Set<number>();
  for (const part of spec.split(',').map((s) => s.trim())) {
    const named = NAMED_SETS[part];
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    let lo: number;
    let hi: number;
    if (named) [lo, hi] = named;
    else if (m) [lo, hi] = [Number(m[1]), Number(m[2] ?? m[1])];
    else
      throw new TaskSelectionError(
        `unknown task set or range "${part}"; use ${Object.keys(NAMED_SETS).join(', ')}, a number or a range like 101-110`,
      );
    if (lo > hi || lo < 1) throw new TaskSelectionError(`bad task range "${part}"`);
    // Checked on the numbers, before any file is read.
    if (hi >= SEALED_MIN && lo <= SEALED_MAX)
      throw new TaskSelectionError(
        `tasks ${SEALED_MIN} to ${SEALED_MAX} are sealed (held out for the published rounds) and are never used by this kit; "${part}" includes them`,
      );
    if (hi > OPEN_MAX) throw new TaskSelectionError(`tasks above ${OPEN_MAX} are not open ("${part}")`);
    for (const id of range(lo, hi)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Loads only the files of the ids asked for. Missing ids are an error, not a skip. */
export function loadTasks(tasksDir: string, ids: number[]): Task[] {
  const byId = new Map<number, string>();
  for (const f of readdirSync(tasksDir)) {
    const m = /^(\d+)-.*\.json$/.exec(f);
    if (m) byId.set(Number(m[1]), f);
  }
  return ids.map((id) => {
    if (id >= SEALED_MIN) throw new TaskSelectionError(`task ${id} is sealed`);
    const f = byId.get(id);
    if (f === undefined) throw new TaskSelectionError(`no task file for id ${id} in ${tasksDir}`);
    const t = JSON.parse(readFileSync(join(tasksDir, f), 'utf8')) as { id: string; category: string; title: string; brief: string };
    return { id: String(id).padStart(2, '0'), category: t.category, title: t.title, brief: t.brief, file: f };
  });
}

/** SHA-256 of the selected task files concatenated in numeric id order, the way D34 hashes a set. */
export function taskSetHash(tasksDir: string, tasks: Task[]): string {
  const h = createHash('sha256');
  for (const t of tasks) h.update(readFileSync(join(tasksDir, t.file)));
  return h.digest('hex');
}
