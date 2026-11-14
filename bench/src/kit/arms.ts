// The writer arms of the kit: a letter, the prompt file that is the whole writer prompt, and the extension of what it writes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BENCH = join(import.meta.dirname, '..', '..');
export const PROMPTS = join(BENCH, 'prompts');

/** A bad flag or value: the kit prints it with the usage text and exits 2. */
export class UsageError extends Error {}

export interface Arm {
  letter: string;
  file: string;
  ext: string;
  what: string;
}
export const ARMS: Record<string, Arm> = {
  A: { letter: 'A', file: 'A-markdown.md', ext: 'md', what: 'Markdown with Mermaid' },
  B: { letter: 'B', file: 'B-html.md', ext: 'html', what: 'a full HTML page' },
  C: { letter: 'C', file: 'C-lede-0.5.md', ext: 'lede', what: 'Lede 0.5' },
  D: { letter: 'D', file: 'D-html-preloaded-css.md', ext: 'html', what: 'body HTML over a preloaded stylesheet' },
  E: { letter: 'E', file: 'E-json-ui.md', ext: 'json', what: 'a JSON UI spec (tokens and validity only)' },
};

export function parseArms(spec: string): Arm[] {
  const out: Arm[] = [];
  for (const s of spec.split(',').map((x) => x.trim().toUpperCase())) {
    const arm = ARMS[s];
    if (arm === undefined) throw new UsageError(`unknown arm "${s}"; arms are ${Object.keys(ARMS).join(', ')}`);
    if (!out.includes(arm)) out.push(arm);
  }
  return out;
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const promptText = (arm: Arm, dir = PROMPTS) => readFileSync(join(dir, arm.file), 'utf8');

/** The one message a writer receives: the arm's prompt, then the brief, in the shape of prompts/refine-revision.md (D67). */
export function writerMessage(arm: Arm, brief: string, dir = PROMPTS): string {
  return `${promptText(arm, dir).trimEnd()}\n\nBrief:\n${brief}\n\nWrite the complete page, once. It is your only output: no commentary, and no code fence around it. Read no file and run no command.`;
}
