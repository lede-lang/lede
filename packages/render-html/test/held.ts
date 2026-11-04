// What a page's controls hold, read from a browser and turned into the values the reference serializer takes (internal spec, lede-lang/meta).
// Shared by the shell's parity and security checks. Not a `*.test.ts`.
import type { QuestionBlock } from '@lede-lang/core';
import type { Value } from '../src/export.ts';

/** One entry per named control: `[name, type, value, checked]`. Runs in the page. */
export const SNAPSHOT = `[...document.querySelectorAll('main [name]')].map((e) => [e.name, e.type, e.value, e.checked])`;
export type Entry = [name: string, type: string, value: string, checked: boolean];

/**
 * The value each field holds, by the kind's own rule (spec §4.18, §4.19), from the controls' state: the text of an `ask`, the checked radio
 * of a `choose` or `confirm`, the number box of a `param` (empty is `NaN`), the checkbox of a `toggle`, and for each item of a `bucket` the
 * radio checked in its group. A `template` has no control; its slot is a placeholder the serializer ignores.
 */
export function heldValues(blocks: QuestionBlock[], entries: Entry[]): Value[] {
  const of = (name: string) => entries.filter((e) => e[0] === name);
  return blocks.map((f): Value => {
    switch (f.type) {
      case 'ask':
        return of(f.name)[0][2];
      case 'choose':
        return of(f.name).find((e) => e[3])?.[2] ?? null;
      case 'confirm':
        return of(f.name).find((e) => e[3])?.[2] ?? 'open';
      case 'param': {
        const v = of(f.name).find((e) => e[1] === 'number')![2];
        return v === '' ? Number.NaN : Number(v);
      }
      case 'toggle':
        return of(f.name)[0][3] ? 'on' : 'off';
      case 'bucket':
        // By the position of the checked radio, not its `value`: the parser rewrites a NUL in an attribute, so a value need not be the name.
        return f.items.map((it, k) => f.buckets[of(`${f.name}:${k}`).findIndex((e) => e[3])] ?? it.bucket);
      default:
        return null;
    }
  });
}
