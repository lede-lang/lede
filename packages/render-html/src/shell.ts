// `--shell` (spec §4.18 and §7, D63): the data block, the policy value and the one fixed script. The runtime itself is
// shell-runtime.js; shell-runtime.ts is generated from it (scripts/gen-runtime.ts) so this file has no `node:` import.
import { exportsOf, type ExportBlock, type LedeDocument, type QuestionBlock } from '@lede-lang/core';
import { drawnFields } from './question.ts';
import { RUNTIME, RUNTIME_SHA256 } from './shell-runtime.ts';

/** The shell has something to run only when the page asks a question and offers an export. */
export const wantsShell = (doc: LedeDocument): boolean => drawnFields(doc.blocks).length > 0 && exportsOf(doc.blocks).length > 0;

/** `JSON.stringify` with the characters that could close the element, open a comment or end a line written as escapes. */
const inert = (v: unknown): string =>
  JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** The two script elements, in page order: the inert JSON the runtime reads, then the runtime. */
export function shellScripts(page: string | undefined, fields: QuestionBlock[], exports: ExportBlock[]): string {
  const data = {
    v: 1,
    ...(page ? { page } : {}),
    fields: fields.map((f) => ({ n: f.name, k: f.type })),
    formats: [...new Set(exports.map((e) => e.format))],
  };
  return `<script type="application/json" id="lede-shell">${inert(data)}</script>\n<script>${RUNTIME}</script>`;
}

/** Appended to the ordinary policy: the one script the page may run, named by its hash. */
export const SCRIPT_SRC = `script-src '${RUNTIME_SHA256}'`;
