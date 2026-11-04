// `--shell` (spec §4.18 and §7, D63): the data block, the policy value and the one fixed script. The runtime itself is
// shell-runtime.js; shell-runtime.ts is generated from it (scripts/gen-runtime.ts) so this file has no `node:` import.
import { exportsOf, fieldsOf, type ExportBlock, type LedeDocument, type PresetBlock, type QuestionBlock } from '@lede-lang/core';
import { RUNTIME, RUNTIME_SHA256 } from './shell-runtime.ts';

/** The shell has something to run only when the page asks a question and offers an export. */
export const wantsShell = (doc: LedeDocument): boolean => fieldsOf(doc.blocks).length > 0 && exportsOf(doc.blocks).length > 0;

/** `JSON.stringify` with the characters that could close the element, open a comment or end a line written as escapes. */
const inert = (v: unknown): string =>
  JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * One field as the runtime reads it (spec §7, data block v2): its name and kind, then what the runtime cannot read back out of the page.
 * `i` is the value the page was written with, `u` a `param`'s unit, `mn`, `mx` and `st` its bounds and step, `d` the toggles a `toggle`
 * needs, `b` a `bucket`'s names or a `template`'s body, `t` the item texts, `s` a template's slot names. Wave 1 kinds carry no more.
 */
function fieldData(f: QuestionBlock): Record<string, unknown> {
  const base = { n: f.name, k: f.type };
  switch (f.type) {
    case 'param':
      return { ...base, i: f.value, ...(f.unit ? { u: f.unit } : {}), mn: f.min, mx: f.max, st: f.step };
    case 'toggle':
      return { ...base, i: f.on ? 'on' : 'off', ...(f.needs?.length ? { d: f.needs } : {}) };
    case 'bucket':
      return { ...base, b: f.buckets, t: f.items.map((i) => i.text), i: f.items.map((i) => i.bucket) };
    case 'template':
      return { ...base, s: f.slots, b: f.body };
    default:
      return base;
  }
}

/** The two script elements, in page order: the inert JSON the runtime reads, then the runtime. */
export function shellScripts(
  page: string | undefined,
  fields: QuestionBlock[],
  exports: ExportBlock[],
  presets: PresetBlock[] = [],
): string {
  const data = {
    v: 2,
    ...(page ? { page } : {}),
    fields: fields.map(fieldData),
    ...(presets.length ? { presets: presets.map((p) => ({ n: p.name, v: p.values.map((x) => [x.name, x.value]) })) } : {}),
    formats: [...new Set(exports.map((e) => e.format))],
  };
  return `<script type="application/json" id="lede-shell">${inert(data)}</script>\n<script>${RUNTIME}</script>`;
}

/** Appended to the ordinary policy: the one script the page may run, named by its hash. */
export const SCRIPT_SRC = `script-src '${RUNTIME_SHA256}'`;
