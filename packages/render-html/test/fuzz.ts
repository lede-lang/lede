// A seeded generator of hostile answer text, shared by the serializer and runtime checks. Not a `*.test.ts`.

/** A small LCG: the same seed gives the same states, so a failing seed can be rerun. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const PIECES = [
  'a',
  ' ',
  '  ',
  '\n',
  '\r\n',
  '\r',
  '`',
  '```',
  '"',
  '\\',
  '</script>',
  '<!--',
  '\u2028',
  '\u2029',
  '\u0085',
  '😀',
  '- x: y',
  '# h',
  '(empty)',
  '(not chosen)',
  '\t',
];

/** Up to five pieces joined: backticks, quotes, line breaks and separators, the things an export must survive. */
export const text = (r: () => number): string =>
  Array.from({ length: Math.floor(r() * 6) }, () => PIECES[Math.floor(r() * PIECES.length)]).join('');
