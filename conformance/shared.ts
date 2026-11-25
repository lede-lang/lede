// What run.test.ts and runner.ts share: where the cases are, and which fields of a diagnostic are contract.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const here = import.meta.dirname;

export type Kind = 'cases' | 'errors';

export interface Diag {
  severity: string;
  code: string;
  line: number;
  col: number;
}

/** The contract part of a diagnostic: message wording and `detail` are implementation detail. */
export const contractDiag = (d: Diag): Diag => ({ severity: d.severity, code: d.code, line: d.line, col: d.col });

/** Every `.lede` file of a suite directory, in a stable order. */
export const listCases = (dir: Kind): string[] =>
  readdirSync(join(here, dir))
    .filter((name) => name.endsWith('.lede'))
    .toSorted();

export const expectedPath = (dir: Kind, f: string): string => join(here, dir, f.replace(/\.lede$/, '.json'));
